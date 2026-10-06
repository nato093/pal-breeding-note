// 所持パルの状態。
// - ホスト（この PC にワールドのセーブがある）: セーブを読み込んで画面に出し、スプレッドシートへ共有する
// - 参加している側・連携していない人: スプレッドシートで共有された、ホストの所持パルを出す
// 同じワールドのデータが手元と共有の両方にあるときは、セーブの新しい方を出す。
import pals from '../data/pals.js';
import passives from '../data/passives.js';
import { normalizeOwned, ownedFromShared, sharedUpload } from './core/owned.js';
import { createHandleSource, inspectFiles, readFiles, fileSignature, kindOf, REQUIRED_FILES } from './save/handles.js';

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
    // 保存できなければ例外にする（セーブのファイルの登録など、開き直したときに残っていないと困るもの）
    async setStrict(key, value) {
      const db = await open();
      if (!db) throw new Error('このブラウザには保存できません');
      await run(db, 'readwrite', (store) => store.put(value, key));
      memory.set(key, value);
    },
    async removeStrict(key) {
      const db = await open();
      if (!db) throw new Error('このブラウザには保存できません');
      await run(db, 'readwrite', (store) => store.delete(key));
      memory.delete(key);
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

const WORLD_ID = /^[0-9A-F]{32}$/i;

/**
 * @param {object} options
 * @param {{ scope: () => string, userId: () => string, request: (action: string, input?: object) => Promise<object> }} [options.server]
 *   スプレッドシートとの通信。scope はログイン中の環境（'prod' / 'test'）、ログインしていなければ ''。
 * @param {object} [options.handles] 登録したセーブのファイル（save/handles.js の createHandleSource）。
 */
export function createOwnedStore({
  persist = idbPersist(), settings, namespace = 'pal-note', runImport = runImportInWorker,
  handles = null, now = Date.now, server = null,
  schedule = (fn, ms) => setTimeout(fn, ms), cancel = (id) => clearTimeout(id),
} = {}) {
  const source = handles ?? createHandleSource({ persist, key: `${namespace}.owned.handles` });
  const listeners = new Set();
  const dataKey = `${namespace}.owned`;
  // 旧版（セーブ連携ツール）と同じキー。enabled が true のままの人には、ファイルの登録を案内する
  const settingsKey = `${namespace}.owned.bridge`;
  const sharedKey = (scope) => `${namespace}.owned.shared.${scope}`;
  let saved = {};
  try { saved = JSON.parse(settings?.get(settingsKey)) ?? {}; } catch { saved = {}; }
  let lastAuto = -Infinity;
  let lastShared = -Infinity;
  let lastUpload = -Infinity;
  let uploadTimer = null;
  // 登録の削除・解除を求めるたびに増やす。読み込みの途中で求められたら、その読み込みの結果では共有しない
  let linkEpoch = 0;
  // このページで実際に読み込んだ、登録したファイルの一式の印（開き直した直後の保存済みのデータでは共有しない）
  let verifiedSignature = '';
  // 登録したファイルから読み込んでいる途中のワールド
  let readingWorldId = '';
  // 削除を求められ、まだ消し終えていないワールド（順番待ちの読み込みでも選ばず、共有もしない）
  const removing = new Set();
  let loading = null;
  let loadedScope = null;
  let sharedInflight = null;
  // 読み込みは 1 つずつ行う（自動の読み込みの途中で別のワールドを選んでも、後の操作の結果が残る）
  let chain = Promise.resolve();
  let pending = 0;
  // 旧版の worldDir は「Steam ID/ワールド ID」。末尾のワールド ID に読み替える
  const savedWorldId = String(saved.worldId ?? saved.worldDir ?? '').split('/').pop();
  const state = {
    ready: false, busy: false, progress: '', error: '',
    // 登録したファイルからの自動の読み込み。worldId が空なら、最後に遊んだワールドを読む
    auto: { enabled: saved.enabled === true, status: 'off', worlds: [], worldId: WORLD_ID.test(savedWorldId) ? savedWorldId.toUpperCase() : '', error: '' },
    // この PC での、連携しているワールドの役割（'host' | 'guest' | ''）と ID
    role: '', linkedWorldId: '',
    // 表示するワールド（空なら自動）
    viewWorldId: typeof saved.viewWorldId === 'string' ? saved.viewWorldId : '',
    local: null,
    shared: { worlds: [], current: null, fetchedAt: '', error: '' },
    upload: { status: '', at: '', error: '', worldId: '' },
    // 共有してよいか。このページで、ホストのワールドのセーブを正常に読めたときだけ true（保存済みのデータや判定できないときは共有しない）
    uploadReady: false,
    data: null, owned: null, meta: null,
  };
  const emit = () => listeners.forEach((listener) => listener(state));
  const scope = () => server?.scope?.() || '';
  const linked = () => state.auto.enabled;

  function saveSettings() {
    settings?.set(settingsKey, JSON.stringify({
      enabled: state.auto.enabled, worldId: state.auto.worldId, viewWorldId: state.viewWorldId,
    }));
  }

  // 共有を止め、予約していた共有も取り消す
  function blockUpload() {
    state.uploadReady = false;
    if (uploadTimer !== null) { cancel(uploadTimer); uploadTimer = null; }
  }

  const registeredWorlds = () => source.worlds().map((record) => ({
    id: record.id, dir: record.id, steamId: record.steamId ?? '', kind: record.kind, name: record.name ?? '', hostName: record.hostName ?? '', status: '', role: '', playedAt: '', files: Object.keys(record.files),
  }));

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
    // 手元と共有で、セーブの新しい方を出す（同じなら手元）。参加している側では手元のデータ（前にホストしたときの残り）は出さない
    const useLocal = local && state.role !== 'guest' && (!shared || timeOf(local.world.updatedAt) >= timeOf(shared.world.saveUpdatedAt));
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
      await source.load();
      if (!state.auto.worlds.length) state.auto.worlds = registeredWorlds();
      // 登録したワールドがあれば、自動の読み込みを使う（前の版でフォルダから連携し、自動がオフのまま登録が残っている人も）
      if (!state.auto.enabled && source.worlds().length) {
        state.auto.enabled = true;
        saveSettings();
      }
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
    if (!server || !scope() || !local || !state.uploadReady || state.role !== 'host' || local.world.id !== state.linkedWorldId) return 'skipped';
    if (local.source === 'handles' && (!source.has(local.world.id) || removing.has(local.world.id))) return 'skipped';
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

  // セーブ一式を解析して手元のデータにする（ホストのワールド）。snapshot を渡したときは解析し直さない。
  async function runImportTask(files, { source: from, world, skipped = [], snapshot: parsed = null, epoch = linkEpoch }) {
    state.error = '';
    state.progress = 'セーブを読み込み中…';
    emit();
    try {
      const result = parsed ?? await runImport(files, (message) => { state.progress = message; emit(); });
      // 読む前に消えていたファイルも、読めなかったファイルとして知らせる
      const snapshot = skipped.length && !parsed
        ? { ...result, files: { ...result.files, skipped: [...skipped, ...(result.files?.skipped ?? [])] } } : result;
      const data = {
        version: DATA_VERSION, importedAt: new Date(now()).toISOString(), source: from,
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
      // 読み込みの途中で登録の削除・解除を求められていたら、共有しない
      state.uploadReady = epoch === linkEpoch;
      if (from === 'handles') verifiedSignature = data.world.signature;
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

  // 自動の読み込みを止める。auto でないとき（ボタンなど）は、理由をエラーで返す
  function stop(status, message, auto) {
    state.auto.status = status;
    state.auto.error = message;
    blockUpload();
    if (!auto) throw Object.assign(new Error(message), { code: status });
    return status;
  }

  const worldLabel = (world) => (world.name ? `「${world.name}」` : `ワールド ${world.id.slice(0, 8)}`);

  // 登録したファイルからワールドを読む。auto のときは、前回読んだセーブ一式から変わっていなければ読まない。
  // preview（登録の確認で読んだ結果）があり、そのワールドのファイルが変わっていなければ、それを使う。
  // epoch は呼び出した（キューに入れた）ときの linkEpoch。その後に削除・解除を求められていたら共有しない
  async function autoTask({ auto, preview = null, epoch = linkEpoch }) {
    if (!state.auto.enabled) return 'skipped';
    await load();
    state.auto.status = 'checking';
    state.auto.error = '';
    emit();
    let worlds;
    try {
      worlds = (await source.list()).filter((world) => !removing.has(world.id));
    } catch (error) {
      return stop('error', error.message, auto);
    }
    state.auto.worlds = worlds;
    if (!worlds.length) return stop('empty', 'セーブのファイルが登録されていません。設定タブの「セーブ連携」の「＋ ワールドを登録」で登録してください', auto);
    // 許可のないワールドがあると、どれを最後に遊んだか分からないので、黙って別のワールドを選ばない
    if (worlds.some((world) => world.status === 'permission')) {
      return stop('permission', 'セーブを読むには許可が必要です。「読み込みを許可」を押してください（拒否した場合は、Chrome のサイトの設定で許可を戻すか、ファイルを登録し直してください）', auto);
    }
    const chosen = state.auto.worldId ? worlds.find((world) => world.id === state.auto.worldId) : null;
    // 選んでいなければ、読めるワールドのうち最後に遊んだもの（読めないワールドがあれば知らせる）
    const world = chosen || worlds.find((item) => item.status === 'ok') || worlds[0];
    const broken = chosen ? [] : worlds.filter((item) => item.status !== 'ok' && item.playedAt > world.playedAt);
    state.linkedWorldId = world.id;
    if (world.status !== 'ok') {
      // ホストか参加か判定できないときは、手元のデータで共有しない
      state.role = '';
      return stop('error', `${worldLabel(world)}を読めません（${world.error || '不明なエラー'}）。ファイルを登録し直してください`, auto);
    }
    state.auto.status = 'ready';
    if (state.auto.worldId && !chosen) state.auto.error = '選んだワールドの登録がないため、最後に遊んだワールドを読みます';
    else if (broken.length) state.auto.error = `${broken.map(worldLabel).join('・')}を読めないため、読めるワールドのうち最後に遊んだワールドを読みます`;
    if (world.role === 'guest') {
      state.role = 'guest';
      blockUpload();
      return 'guest';
    }
    state.role = 'host';
    const current = state.local;
    // このページで読み込んだときから変わっていなければ読まない（開き直した直後は、保存済みのデータがあっても一度読む）
    if (auto && current?.source === 'handles' && current.world.id === world.id && current.world.signature === world.signature && verifiedSignature === world.signature) {
      state.uploadReady = epoch === linkEpoch;
      return 'unchanged';
    }
    blockUpload();
    readingWorldId = world.id;
    try {
      if (preview?.snapshot && preview.worldId === world.id && preview.fileSignature === world.fileSignature) {
        await runImportTask([], { source: 'handles', world, snapshot: preview.snapshot, epoch });
      } else {
        let read;
        try {
          read = await source.read(world);
        } catch (error) {
          // 一覧を確かめた後に許可が外れたときも、許可のボタンを出す
          if (error.code === 'NEEDS_PERMISSION') return stop('permission', error.message, auto);
          // ゲームの保存中で読めなかっただけなら、自動のときは次の機会に読み直す
          if (!(auto && error.code === 'NOT_READABLE')) state.error = error.message;
          throw error;
        }
        await runImportTask(read.files, { source: 'handles', world, skipped: read.skipped, epoch });
      }
    } catch (error) {
      if (!auto) throw error;
      return 'error';
    } finally {
      readingWorldId = '';
    }
    source.rename(world.id, { name: state.local.world.name, hostName: state.local.world.hostName }).catch(() => {});
    return 'imported';
  }

  function runAuto(options) {
    const epoch = linkEpoch;
    return serial(() => autoTask({ ...options, epoch })).then(async (result) => {
      if (result === 'imported') uploadLocal().catch(() => {});
      // shared: false のとき（定期の読み直し）は共有を読み直さない
      if (options.shared !== false && (result === 'guest' || result === 'unchanged' || result === 'imported')) {
        await fetchShared({ force: result === 'guest' && !options.auto });
      }
      return result;
    });
  }

  // 登録の確認: ドロップしたファイル（同じワールドの登録済みのファイルと合わせて）を読んでみる。まだ保存・共有はしない。
  async function previewTask({ worldId, steamId, files }) {
    await load();
    const existing = source.get(worldId);
    const merged = { ...(existing?.files ?? {}) };
    for (const file of files) merged[file.path] = file.handle;
    const kind = kindOf(Object.keys(merged));
    const lost = REQUIRED_FILES[kind].filter((path) => !merged[path]);
    if (lost.length) throw new Error(`${lost.join('・')} もドロップしてください`);
    const inspected = await inspectFiles(kind, merged);
    if (inspected.status === 'permission') throw new Error('登録済みのファイルを読む許可がありません。「読み込みを許可」を押してから、もう一度ドロップしてください');
    if (inspected.status !== 'ok') throw new Error(inspected.error);
    const preview = {
      worldId, steamId, kind, role: inspected.role, paths: Object.keys(merged).sort(),
      files: Object.fromEntries(files.map((file) => [file.path, file.handle])),
      replaced: files.filter((file) => existing?.files[file.path]).map((file) => file.path),
      fileSignature: fileSignature(inspected.infos), snapshot: null, name: existing?.name ?? '', hostName: existing?.hostName ?? '', palCount: 0,
    };
    if (kind === 'host') {
      state.progress = 'セーブを読み込み中…';
      emit();
      const read = await readFiles(merged, inspected.files, REQUIRED_FILES[kind]);
      const skipped = [...inspected.missing.map((path) => ({ path, reason: 'ファイルが見つかりません' })), ...read.skipped];
      const result = await runImport(read.files, (message) => { state.progress = message; emit(); });
      preview.snapshot = { ...result, files: { ...result.files, skipped: [...skipped, ...(result.files?.skipped ?? [])] } };
      preview.name = result.world?.name || preview.name;
      preview.hostName = result.world?.hostName || preview.hostName;
      preview.palCount = result.pals.length;
    }
    return preview;
  }

  return {
    state,
    load,
    fetchShared,
    uploadLocal,
    // enable: 登録があれば自動の読み込みをオンにしてから読む
    refreshAuto({ auto = false, enable = false } = {}) {
      if (enable && source.worlds().length && !state.auto.enabled) {
        state.auto.enabled = true;
        saveSettings();
      }
      if (!state.auto.enabled) return Promise.resolve('skipped');
      return runAuto({ auto });
    },
    // 画面の表示・タブの切り替えのたびに呼ぶ。自動の読み込みが有効なら間隔を空けて新しいセーブを読み、共有も読み直す。
    async autoRefresh() {
      await load();
      if (state.auto.enabled && !state.busy && now() - lastAuto >= AUTO_INTERVAL) {
        lastAuto = now();
        return runAuto({ auto: true });
      }
      return fetchShared();
    },
    // 一定の間隔で呼ぶ（タブが裏にあっても）。配合牧場のタマゴを拾われる前に読めるよう、自動の読み込みが有効なときだけ新しいセーブを読む。
    // 共有の読み直しはしない（参加している側の画面は、表示・タブの切り替えのときに autoRefresh で読む）
    async pollAuto() {
      await load();
      if (!state.auto.enabled || state.busy || now() - lastAuto < AUTO_INTERVAL) return 'skipped';
      lastAuto = now();
      return runAuto({ auto: true, shared: false });
    },
    // ログイン・ログアウトで共有の保存先（環境）が変わったときに呼ぶ
    async scopeChanged() {
      await loadShared();
      update();
      return fetchShared({ force: true });
    },
    /** 登録の確認（ドロップしたファイルを読んでみる）。結果を commitRegistration に渡すと登録する。 */
    previewRegistration(input) {
      return serial(() => previewTask(input));
    },
    /** 登録を確定し、自動の読み込みをオンにして読む。 */
    commitRegistration(preview) {
      const epoch = linkEpoch;
      return serial(async () => {
        const { persisted } = await source.commit({ worldId: preview.worldId, steamId: preview.steamId, files: preview.files, name: preview.name, hostName: preview.hostName });
        state.auto.enabled = true;
        saveSettings();
        lastAuto = now();
        return { persisted, result: await autoTask({ auto: false, preview, epoch }) };
      }).then(async (outcome) => {
        if (outcome.result === 'imported') uploadLocal().catch(() => {});
        await fetchShared({ force: true });
        return outcome;
      });
    },
    /** 登録を消す。読み込んでいたワールドなら、手元のデータと共有の予約も消す。 */
    removeWorld(worldId) {
      // 共有している・読み込んでいるワールドなら、読み込みの途中でもすぐに共有を止める（その読み込みの結果では共有しない）。
      // 別のワールドの削除では、いまのワールドの共有の予約は残す
      if ([state.linkedWorldId, state.local?.world.id, readingWorldId].includes(worldId)) {
        linkEpoch++;
        blockUpload();
      }
      removing.add(worldId);
      return serial(async () => {
        try {
          await source.remove(worldId);
        } finally {
          removing.delete(worldId);
        }
        if (state.local?.source === 'handles' && state.local.world.id === worldId) {
          state.local = null;
          await persist.remove(dataKey);
        }
        if (state.auto.enabled && state.linkedWorldId === worldId) {
          blockUpload();
          state.role = '';
          state.linkedWorldId = '';
        }
        if (state.auto.worldId === worldId) state.auto.worldId = '';
        state.auto.worlds = state.auto.worlds.filter((world) => world.id !== worldId);
        if (!source.worlds().length) {
          state.auto.enabled = false;
          state.auto.status = 'off';
          state.auto.error = '';
        }
        saveSettings();
      }).then(() => {
        if (!state.auto.enabled) return fetchShared({ force: true });
        lastAuto = now();
        return runAuto({ auto: true });
      });
    },
    /** 読む許可を求めてから読む。クリックの中で、await を挟まずに呼ぶこと。 */
    grantAndRefresh() {
      const asking = source.requestPermission();
      return asking.then(async ({ granted, total }) => {
        const result = await runAuto({ auto: false });
        return { granted, total, result };
      });
    },
    selectAutoWorld(worldId) {
      state.auto.worldId = worldId;
      saveSettings();
      emit();
      return runAuto({ auto: false });
    },
    setViewWorld(worldId) {
      state.viewWorldId = worldId;
      saveSettings();
      update();
      return fetchShared({ force: true });
    },
    /**
     * ワールドの所持パル（CSV に保存する用）。この PC で読み込んだセーブがあればそれを、なければ共有されたものを使う。
     * @returns {Promise<{ owned: object, importedAt: string } | null>} 所持パルがなければ null
     */
    async ownedOf(worldId) {
      await load();
      const id = String(worldId ?? '').toUpperCase();
      if (state.local?.world.id === id) {
        return { owned: normalizeOwned(state.local.snapshot, { pals, passives }), importedAt: state.local.world.updatedAt || state.local.importedAt };
      }
      let shared = state.shared.current?.world?.worldId === id ? state.shared.current : null;
      if (!shared && server && scope() && state.shared.worlds.some((world) => world.worldId === id)) {
        const response = await server.request('owned', { worldId: id });
        shared = response.world ? { world: response.world, columns: response.columns, rows: response.rows } : null;
      }
      return shared ? { owned: ownedFromShared(shared, { pals, passives }), importedAt: shared.world.saveUpdatedAt ?? '' } : null;
    },
    // スプレッドシートから、ワールドの所持パルを消す（指定がなければ表示しているワールド）
    async deleteShared(target = '') {
      const worldId = String(target || targetWorldId()).toUpperCase();
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
