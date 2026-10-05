// 所持パルの状態。
// - ホスト（この PC にワールドのセーブがある）: セーブを読み込んで画面に出し、スプレッドシートへ共有する
// - 参加している側・連携していない人: スプレッドシートで共有された、ホストの所持パルを出す
// 同じワールドのデータが手元と共有の両方にあるときは、セーブの新しい方を出す。
import pals from '../data/pals.js';
import passives from '../data/passives.js';
import { normalizeOwned, ownedFromShared, sharedUpload } from './core/owned.js';
import { listBridgeWorlds, readBridgeWorld } from './save/bridge.js';
import { readWorldEntries } from './save/source.js';

const DATA_VERSION = 1;
const AUTO_INTERVAL = 20000;
const SHARED_INTERVAL = 30000;
// 自動のアップロードの間隔（ゲームは数分おきに保存するので、毎回は送らない）
const UPLOAD_INTERVAL = 60000;

/** IndexedDB のキー・値の保存先。使えない環境ではメモリに置く（再読み込みで消える）。 */
export function idbPersist(name = 'pal-note', indexedDB = globalThis.indexedDB) {
  const memory = new Map();
  let opening = null;
  const open = () => {
    if (!indexedDB) return Promise.resolve(null);
    opening ??= new Promise((resolve) => {
      try {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('kv');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
    return opening;
  };
  const run = (db, mode, action) => new Promise((resolve, reject) => {
    const tx = db.transaction('kv', mode);
    const request = action(tx.objectStore('kv'));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  const attempt = async (mode, action, fallback) => {
    const db = await open();
    if (!db) return fallback();
    try { return await run(db, mode, action); } catch { return fallback(); }
  };
  return {
    async get(key) {
      return (await attempt('readonly', (store) => store.get(key), () => memory.get(key))) ?? null;
    },
    async set(key, value) {
      memory.set(key, value);
      await attempt('readwrite', (store) => store.put(value, key), () => undefined);
    },
    async remove(key) {
      memory.delete(key);
      await attempt('readwrite', (store) => store.delete(key), () => undefined);
    },
  };
}

const importOnMainThread = (files, onProgress) => import('./save/import.js').then(({ readWorldFiles }) => readWorldFiles(files, { onProgress }));

/** セーブの解析を Web Worker で行う（使えない・読み込めないときは画面のスレッドで行う）。 */
export function runImportInWorker(files, onProgress = () => {}) {
  let worker;
  try {
    worker = new Worker(new URL('./save/worker.js', import.meta.url), { type: 'module' });
  } catch {
    return importOnMainThread(files, onProgress);
  }
  // 転送するとこちらのバッファは使えなくなるので、Worker が動かなかったときのために写しを送る
  const payload = files.map((file) => ({ path: file.path, buffer: file.bytes.slice().buffer }));
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);
    let started = false;
    const finish = () => worker.terminate();
    worker.addEventListener('message', ({ data }) => {
      if (data?.id !== id) return;
      started = true;
      if (data.type === 'progress') { onProgress(data.message); return; }
      finish();
      if (data.type === 'done') resolve(data.snapshot);
      else reject(new Error(data.message));
    });
    const failed = (event) => {
      finish();
      // Worker のスクリプト自体を読めなかったとき（古いブラウザ・配信の不具合）は画面のスレッドでやり直す
      if (!started) importOnMainThread(files, onProgress).then(resolve, reject);
      else reject(new Error(event?.message || 'セーブを読み込めませんでした'));
    };
    worker.addEventListener('error', failed);
    worker.addEventListener('messageerror', failed);
    worker.postMessage({ id, files: payload }, payload.map((file) => file.buffer));
  });
}

function validData(value) {
  return value && typeof value === 'object' && value.version === DATA_VERSION && value.snapshot && Array.isArray(value.snapshot.pals) ? value : null;
}

function validShared(value) {
  return value && typeof value === 'object' && Array.isArray(value.worlds) ? value : null;
}

const timeOf = (value) => {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
};

/**
 * @param {object} options
 * @param {{ scope: () => string, userId: () => string, request: (action: string, input?: object) => Promise<object> }} [options.server]
 *   スプレッドシートとの通信。scope はログイン中の環境（'prod' / 'test'）、ログインしていなければ ''。
 */
export function createOwnedStore({
  persist = idbPersist(), settings, namespace = 'pal-note', runImport = runImportInWorker,
  bridge = { list: listBridgeWorlds, read: readBridgeWorld }, now = Date.now, server = null,
  schedule = (fn, ms) => setTimeout(fn, ms),
} = {}) {
  const listeners = new Set();
  const dataKey = `${namespace}.owned`;
  const settingsKey = `${namespace}.owned.bridge`;
  const sharedKey = (scope) => `${namespace}.owned.shared.${scope}`;
  let saved = {};
  try { saved = JSON.parse(settings?.get(settingsKey)) ?? {}; } catch { saved = {}; }
  let lastAuto = -Infinity;
  let lastShared = -Infinity;
  let lastUpload = -Infinity;
  let uploadTimer = null;
  let loading = null;
  let loadedScope = null;
  let sharedInflight = null;
  // 読み込みは 1 つずつ行う（自動の読み込みの途中で別のワールドを選んでも、後の操作の結果が残る）
  let chain = Promise.resolve();
  let pending = 0;
  const folderWorld = saved.folder && typeof saved.folder.id === 'string' ? saved.folder : null;
  const state = {
    ready: false, busy: false, progress: '', error: '',
    // worldDir が空なら、最後に遊んだワールドを読む
    bridge: { enabled: saved.enabled === true, status: 'off', worlds: [], worldDir: typeof saved.worldDir === 'string' ? saved.worldDir : '', error: '' },
    // フォルダで選んだワールド（ブラウザはフォルダを覚えられないので、ID と役割だけ覚える）
    folder: folderWorld,
    // この PC での、連携しているワールドの役割（'host' | 'guest' | ''）と ID
    role: '', linkedWorldId: '',
    // 表示するワールド（空なら自動）
    viewWorldId: typeof saved.viewWorldId === 'string' ? saved.viewWorldId : '',
    local: null,
    shared: { worlds: [], current: null, fetchedAt: '', error: '' },
    upload: { status: '', at: '', error: '', worldId: '' },
    data: null, owned: null, meta: null,
  };
  if (!state.bridge.enabled && folderWorld) { state.role = folderWorld.role; state.linkedWorldId = folderWorld.id; }
  const emit = () => listeners.forEach((listener) => listener(state));
  const scope = () => server?.scope?.() || '';
  const linked = () => state.bridge.enabled || Boolean(state.folder);

  function saveSettings() {
    settings?.set(settingsKey, JSON.stringify({
      enabled: state.bridge.enabled, worldDir: state.bridge.worldDir, folder: state.folder, viewWorldId: state.viewWorldId,
    }));
  }

  // 表示するワールド: 連携しているワールド → 設定で選んだワールド → いちばん新しく共有されたワールド
  function targetWorldId() {
    if (state.linkedWorldId) return state.linkedWorldId;
    if (state.viewWorldId) return state.viewWorldId;
    if (state.local && !state.shared.worlds.length) return state.local.world.id;
    return [...state.shared.worlds].sort((a, b) => timeOf(b.saveUpdatedAt) - timeOf(a.saveUpdatedAt))[0]?.worldId ?? '';
  }

  let normalizedFrom = null;
  function recompute() {
    const target = targetWorldId();
    const local = state.local && state.local.world.id === target ? state.local : null;
    const current = state.shared.current;
    const shared = current?.world && current.world.worldId === target ? current : null;
    const sharedMeta = state.shared.worlds.find((world) => world.worldId === target) ?? shared?.world ?? null;
    // 手元と共有で、セーブの新しい方を出す（同じなら手元）。参加している側では、共有があればホストの共有を出す
    const useLocal = local && (!shared || (state.role !== 'guest' && timeOf(local.world.updatedAt) >= timeOf(shared.world.saveUpdatedAt)));
    const source = useLocal ? local : shared;
    if (source !== normalizedFrom) {
      normalizedFrom = source;
      state.owned = !source ? null : useLocal
        ? normalizeOwned(local.snapshot, { pals, passives })
        : ownedFromShared(shared, { pals, passives });
    }
    state.data = source;
    state.meta = !source ? (target ? { worldId: target, worldName: sharedMeta?.worldName ?? '', hostName: sharedMeta?.hostName ?? '' } : null) : {
      worldId: target,
      worldName: useLocal ? local.world.name : shared.world.worldName,
      hostName: useLocal ? local.world.hostName : shared.world.hostName,
      source: useLocal ? 'local' : 'shared',
      saveUpdatedAt: useLocal ? local.world.updatedAt || local.importedAt : shared.world.saveUpdatedAt,
      importedAt: useLocal ? local.importedAt : '',
      sharedAt: sharedMeta?.uploadedAt ?? '',
      uploadedBy: sharedMeta?.uploadedBy ?? '',
      palCount: useLocal ? local.snapshot.pals.length : shared.rows.length,
    };
  }

  const update = () => { recompute(); emit(); };

  async function loadShared() {
    const key = scope();
    if (loadedScope === key) return;
    loadedScope = key;
    const cached = key ? validShared(await persist.get(sharedKey(key))) : null;
    state.shared = { worlds: cached?.worlds ?? [], current: cached?.current ?? null, fetchedAt: cached?.fetchedAt ?? '', error: '' };
  }

  async function load() {
    loading ??= (async () => {
      const local = validData(await persist.get(dataKey));
      // 古い版で保存したデータは、Level.sav から読んだものなのでホスト扱い
      if (local) local.world = { ...local.world, id: String(local.world.id ?? '').toUpperCase(), role: local.world.role || 'host' };
      state.local = local;
      if (local && !state.linkedWorldId && linked()) state.linkedWorldId = local.world.id;
      if (local && state.linkedWorldId === local.world.id && !state.role) state.role = 'host';
      await loadShared();
      state.ready = true;
      update();
    })();
    return loading;
  }

  function serial(task) {
    pending++;
    state.busy = true;
    emit();
    const result = chain.then(task, task).finally(() => {
      pending--;
      if (!pending) { state.busy = false; state.progress = ''; }
      update();
    });
    chain = result.catch(() => {});
    return result;
  }

  // ---- スプレッドシート ----

  async function fetchShared({ force = false } = {}) {
    if (!server || !scope()) return 'skipped';
    await load();
    await loadShared();
    if (!force && now() - lastShared < SHARED_INTERVAL) return 'skipped';
    sharedInflight ??= (async () => {
      lastShared = now();
      const key = scope();
      try {
        const list = await server.request('ownedWorlds');
        if (scope() !== key) return 'skipped';
        state.shared.worlds = list.worlds;
        state.shared.error = '';
        const target = targetWorldId();
        const meta = list.worlds.find((world) => world.worldId === target);
        const current = state.shared.current;
        if (!meta) {
          if (current?.world?.worldId === target) state.shared.current = null;
        } else if (!current || current.world?.worldId !== target || current.world.uploadedAt !== meta.uploadedAt) {
          const owned = await server.request('owned', { worldId: target });
          if (scope() !== key) return 'skipped';
          state.shared.current = owned.world ? { world: owned.world, columns: owned.columns, rows: owned.rows } : null;
        }
        state.shared.fetchedAt = new Date(now()).toISOString();
        await persist.set(sharedKey(key), { worlds: state.shared.worlds, current: state.shared.current, fetchedAt: state.shared.fetchedAt });
        return 'fetched';
      } catch (error) {
        state.shared.error = error.message;
        return 'error';
      } finally {
        sharedInflight = null;
        update();
      }
    })();
    return sharedInflight;
  }

  // ホストのセーブを共有する。古いセーブは GAS が受け付けない（新しい方を残す）。
  async function uploadLocal({ force = false } = {}) {
    const local = state.local;
    if (!server || !scope() || !local || state.role !== 'host' || local.world.id !== state.linkedWorldId) return 'skipped';
    const wait = UPLOAD_INTERVAL - (now() - lastUpload);
    if (!force && wait > 0) {
      // 間隔を空けて、そのときの最新を送る
      uploadTimer ??= schedule(() => { uploadTimer = null; uploadLocal({ force: true }).catch(() => {}); }, wait);
      return 'scheduled';
    }
    lastUpload = now();
    state.upload = { status: 'sending', at: state.upload.at, error: '', worldId: local.world.id };
    emit();
    const owned = normalizeOwned(local.snapshot, { pals, passives });
    const payload = sharedUpload(owned);
    try {
      const response = await server.request('ownedUpload', {
        userId: server.userId?.() ?? '', worldId: local.world.id,
        world: { name: local.world.name || owned.world?.name || '', hostName: local.world.hostName || owned.world?.hostName || '' },
        saveUpdatedAt: local.world.updatedAt || local.importedAt, ...payload,
      });
      const others = state.shared.worlds.filter((world) => world.worldId !== response.world.worldId);
      state.shared.worlds = [...others, response.world];
      if (response.stored) {
        state.shared.current = { world: response.world, columns: payload.columns, rows: payload.rows.map((row) => row.map(String)) };
        state.upload = { status: 'done', at: response.world.uploadedAt, error: '', worldId: local.world.id };
        await persist.set(sharedKey(scope()), { worlds: state.shared.worlds, current: state.shared.current, fetchedAt: state.shared.fetchedAt });
      } else {
        // 共有されている方が新しい（別の PC から共有された）ので、そちらを読む
        state.upload = { status: 'stale', at: '', error: '', worldId: local.world.id };
        await fetchShared({ force: true });
      }
      return response.stored ? 'uploaded' : 'stale';
    } catch (error) {
      state.upload = { status: 'error', at: '', error: error.message, worldId: local.world.id };
      return 'error';
    } finally {
      update();
    }
  }

  // ---- セーブの読み込み ----

  async function runImportTask(files, { source, world }) {
    state.error = '';
    state.progress = 'セーブを読み込み中…';
    emit();
    try {
      const snapshot = await runImport(files, (message) => { state.progress = message; emit(); });
      const data = {
        version: DATA_VERSION, importedAt: new Date(now()).toISOString(), source,
        world: {
          id: String(world.id ?? '').toUpperCase(), dir: world.dir ?? '', role: 'host',
          name: snapshot.world?.name || world.name || '', hostName: snapshot.world?.hostName || world.hostName || '',
          updatedAt: world.updatedAt ?? '', signature: world.signature ?? '',
        },
        snapshot,
      };
      state.local = data;
      state.role = 'host';
      state.linkedWorldId = data.world.id;
      await persist.set(dataKey, data);
      return data;
    } catch (error) {
      state.error = error.message;
      throw error;
    }
  }

  function afterImport(result) {
    uploadLocal().catch(() => {});
    return result;
  }

  function importFiles(files, meta) {
    return serial(() => runImportTask(files, meta)).then(afterImport);
  }

  // フォルダで選んだワールド。参加している側のワールド（LocalData.sav だけ）は、共有された所持パルを出す
  function importFolderWorld(world) {
    return serial(async () => {
      state.bridge.enabled = false;
      state.bridge.status = 'off';
      state.folder = { id: String(world.id).toUpperCase(), role: world.role === 'guest' ? 'guest' : 'host', name: world.name ?? '' };
      saveSettings();
      if (state.folder.role === 'guest') {
        state.role = 'guest';
        state.linkedWorldId = state.folder.id;
        return null;
      }
      return runImportTask(await readWorldEntries(world), { source: 'folder', world });
    }).then(async (result) => {
      if (result) return afterImport(result);
      await fetchShared({ force: true });
      return null;
    });
  }

  // 連携ツールからワールドを読む。auto のときは、前回読んだセーブ一式から変わっていなければ読まない。
  async function bridgeTask({ auto }) {
    if (!state.bridge.enabled) return 'skipped';
    await load();
    state.bridge.status = 'checking';
    state.bridge.error = '';
    emit();
    let worlds;
    try {
      worlds = await bridge.list();
    } catch (error) {
      state.bridge.status = error.code === 'BRIDGE_OFFLINE' || error.code === 'BRIDGE_TIMEOUT' ? 'offline' : 'error';
      state.bridge.error = error.message;
      if (!auto) throw error;
      return 'offline';
    }
    state.bridge.worlds = worlds;
    state.bridge.status = 'ready';
    const world = (state.bridge.worldDir && worlds.find((item) => item.dir === state.bridge.worldDir)) || worlds[0];
    if (!world) {
      state.bridge.status = 'empty';
      state.bridge.error = 'セーブのフォルダにワールドが見つかりません（連携ツールの --dir を確認してください）';
      if (!auto) throw new Error(state.bridge.error);
      return 'empty';
    }
    if (state.bridge.worldDir && world.dir !== state.bridge.worldDir) {
      state.bridge.error = '選んだワールドが見つからないため、最後に遊んだワールドを読みます';
    }
    const worldId = String(world.id).toUpperCase();
    if (world.role === 'guest') {
      state.role = 'guest';
      state.linkedWorldId = worldId;
      return 'guest';
    }
    const current = state.local;
    state.role = 'host';
    state.linkedWorldId = worldId;
    if (auto && current?.source === 'bridge' && current.world.dir === world.dir
      && current.world.updatedAt === world.updatedAt && (current.world.signature ?? '') === (world.signature ?? '')) return 'unchanged';
    try {
      await runImportTask(await bridge.read(world), { source: 'bridge', world });
    } catch (error) {
      if (!auto) throw error;
      return 'error';
    }
    return 'imported';
  }

  function runBridge(options) {
    return serial(() => bridgeTask(options)).then(async (result) => {
      if (result === 'imported') uploadLocal().catch(() => {});
      if (result === 'guest' || result === 'unchanged' || result === 'imported') await fetchShared({ force: result === 'guest' && !options.auto });
      return result;
    });
  }

  return {
    state,
    load,
    importFiles,
    importFolderWorld,
    fetchShared,
    uploadLocal,
    refreshBridge({ auto = false } = {}) {
      if (!state.bridge.enabled) return Promise.resolve('skipped');
      return runBridge({ auto });
    },
    // 画面の表示・タブの切り替えのたびに呼ぶ。連携ツールが有効なら間隔を空けて新しいセーブを読み、共有も読み直す。
    async autoRefresh() {
      await load();
      if (state.bridge.enabled && !state.busy && now() - lastAuto >= AUTO_INTERVAL) {
        lastAuto = now();
        return runBridge({ auto: true });
      }
      return fetchShared();
    },
    // ログイン・ログアウトで共有の保存先（環境）が変わったときに呼ぶ
    async scopeChanged() {
      await loadShared();
      update();
      return fetchShared({ force: true });
    },
    setBridgeEnabled(enabled) {
      state.bridge.enabled = Boolean(enabled);
      if (enabled) state.folder = null;
      else { state.bridge.status = 'off'; state.bridge.error = ''; }
      saveSettings();
      update();
    },
    selectBridgeWorld(dir) {
      state.bridge.worldDir = dir;
      saveSettings();
      emit();
      return runBridge({ auto: false });
    },
    setViewWorld(worldId) {
      state.viewWorldId = worldId;
      saveSettings();
      update();
      return fetchShared({ force: true });
    },
    // 連携の設定を外す（このブラウザに読み込んだセーブも消す）。共有された所持パルは引き続き見られる
    unlink() {
      return serial(async () => {
        state.bridge = { ...state.bridge, enabled: false, status: 'off', worldDir: '', worlds: [], error: '' };
        state.folder = null;
        state.role = '';
        state.linkedWorldId = '';
        state.local = null;
        state.error = '';
        state.upload = { status: '', at: '', error: '', worldId: '' };
        saveSettings();
        await persist.remove(dataKey);
      }).then(() => fetchShared({ force: true }));
    },
    // スプレッドシートから、表示しているワールドの所持パルを消す
    async deleteShared() {
      const worldId = targetWorldId();
      if (!server || !scope() || !worldId) return false;
      const response = await server.request('ownedDelete', { worldId });
      state.shared.worlds = state.shared.worlds.filter((world) => world.worldId !== worldId);
      if (state.shared.current?.world?.worldId === worldId) state.shared.current = null;
      await persist.set(sharedKey(scope()), { worlds: state.shared.worlds, current: state.shared.current, fetchedAt: state.shared.fetchedAt });
      update();
      return response.deleted;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
