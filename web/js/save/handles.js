// セーブのファイルを、ドロップで受け取ったハンドル（FileSystemFileHandle）で覚えて読む。
// Chrome・Edge は AppData 配下のフォルダを開けないが、エクスプローラーからドロップしたファイルのハンドルは取得でき、
// IndexedDB に保存して後から読み直せる（「毎回のアクセスを許可」を選ぶと、次からは確認なしで読める）。
// ファイルにはワールド ID が入っていないため、ワールドのフォルダのパスを貼ってもらって ID を得る。
import { judgeRole } from './source.js';

const DATA_VERSION = 1;
const WORLD_PATH = /SaveGames[\\/]+(\d+)[\\/]+([0-9a-f]{32})(?![0-9a-f])/i;
const NAMES = new Map(['Level.sav', 'LevelMeta.sav', 'LocalData.sav'].map((name) => [name.toLowerCase(), name]));

/** 登録に要るファイル（ワールドのフォルダからの相対パス）。Level.sav があればホスト、なければ参加だけ。 */
export const REQUIRED_FILES = { host: ['Level.sav', 'LevelMeta.sav', 'LocalData.sav'], guest: ['LocalData.sav'] };

/**
 * エクスプローラーのアドレス欄などから貼ったパスから、Steam ID とワールド ID を取り出す。
 * folder は貼ったパスのうちワールドのフォルダまで（ドロップするファイルの場所の案内に使う）。
 */
export function parseWorldPath(text) {
  const value = String(text ?? '').trim().replace(/^["']+/, '');
  const match = WORLD_PATH.exec(value);
  if (!match) return null;
  return { steamId: match[1], worldId: match[2].toUpperCase(), folder: value.slice(0, match.index + match[0].length).replace(/\//g, '\\') };
}

/** ドロップしたファイルの名前を、ワールドのフォルダからの相対パスにする。対象外なら ''。 */
export function savePathForName(name) {
  const text = String(name ?? '');
  if (NAMES.has(text.toLowerCase())) return NAMES.get(text.toLowerCase());
  if (/^GlobalPalStorage\.sav$/i.test(text)) return '../GlobalPalStorage.sav';
  if (/^[0-9a-f]{32}(_dps)?\.sav$/i.test(text)) return `Players/${text}`;
  return '';
}

export const kindOf = (paths) => (paths.includes('Level.sav') ? 'host' : 'guest');

/** ドロップした項目からハンドルを取り出せるか（Chrome・Edge だけ）。 */
export function handleDropSupported(win = globalThis) {
  return typeof win.DataTransferItem?.prototype?.getAsFileSystemHandle === 'function';
}

/**
 * ドロップされたファイルのハンドルを集める。ブラウザの制限で、drop イベントの中で（await より前に）呼ぶこと。
 * @returns {Promise<{ supported: boolean, files: { path: string, name: string, handle: object }[], ignored: string[], failed: number, duplicates: string[] }>}
 */
export function handlesFromDrop(dataTransfer) {
  const items = [...(dataTransfer?.items ?? [])].filter((item) => item.kind === 'file');
  if (items.some((item) => typeof item.getAsFileSystemHandle !== 'function')) {
    return Promise.resolve({ supported: false, files: [], ignored: [], failed: 0, duplicates: [] });
  }
  const pending = items.map((item) => item.getAsFileSystemHandle());
  return (async () => {
    const result = { supported: true, files: [], ignored: [], failed: 0, duplicates: [] };
    for (const promise of pending) {
      let handle;
      // AppData 配下のフォルダは、ブラウザがハンドルを渡さない（失敗する）
      try { handle = await promise; } catch { result.failed++; continue; }
      if (!handle || handle.kind !== 'file') { result.failed++; continue; }
      const path = savePathForName(handle.name);
      if (!path) { result.ignored.push(handle.name); continue; }
      result.files.push({ path, name: handle.name, handle });
    }
    // 同じ場所に入るファイルが 2 つ以上あれば、どれが正しいか分からないので、そのパスはどれも受け取らない
    const counts = new Map();
    for (const file of result.files) counts.set(file.path, (counts.get(file.path) ?? 0) + 1);
    result.duplicates = result.files.filter((file) => counts.get(file.path) > 1).map((file) => file.name);
    result.files = result.files.filter((file) => counts.get(file.path) === 1);
    return result;
  })();
}

function errorWithCode(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function fileInfo(handle) {
  const file = await handle.getFile();
  return { file, lastModified: file.lastModified, size: file.size };
}

const isMissing = (error) => error?.name === 'NotFoundError';

function readError(path, error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return errorWithCode(`${path} を読む許可がありません。所持パルのタブの「読み込みを許可」を押してください`, 'NEEDS_PERMISSION');
  }
  if (error?.name === 'NotReadableError') return errorWithCode(`${path} を読めませんでした。ゲームの保存中かもしれません。少し待ってからやり直してください`, 'NOT_READABLE');
  return errorWithCode(`${path} を読めませんでした（${error?.message || error}）`, 'READ_ERROR');
}

/** ファイルの一覧（相対パスごとの更新日時・サイズ）から作る、セーブ一式の変更の印。 */
export function fileSignature(infos) {
  return Object.keys(infos).sort().map((path) => `${path}=${infos[path].lastModified}:${infos[path].size}`).join('|');
}

const timeIso = (ms) => (ms ? new Date(ms).toISOString() : '');

/**
 * ハンドルの読み取り（許可の確認・更新日時・役割）。登録済みのワールドにも、確定前の登録にも使う。
 * @returns {Promise<{ status: 'ok'|'permission'|'missing'|'error', role: string, files: string[], missing: string[], infos: object, error: string }>}
 */
export async function inspectFiles(kind, files) {
  const paths = Object.keys(files);
  for (const path of paths) {
    let state;
    try { state = await files[path].queryPermission({ mode: 'read' }); } catch { state = 'prompt'; }
    if (state !== 'granted') return { status: 'permission', role: '', files: [], missing: [], infos: {}, error: '' };
  }
  const infos = {};
  const missing = [];
  for (const path of paths) {
    try {
      const { lastModified, size } = await fileInfo(files[path]);
      infos[path] = { lastModified, size };
    } catch (error) {
      if (isMissing(error)) { missing.push(path); continue; }
      const failure = readError(path, error);
      return { status: failure.code === 'NEEDS_PERMISSION' ? 'permission' : 'error', role: '', files: [], missing, infos: {}, error: failure.message };
    }
  }
  const lost = REQUIRED_FILES[kind].filter((path) => !infos[path]);
  // 必要なファイルが読めないときは、ホストか参加かを決めない（古いファイルや登録漏れで取り違えないように）
  if (lost.length) return { status: 'missing', role: '', files: Object.keys(infos), missing, infos, error: `${lost.join('・')} が見つかりません` };
  const role = kind === 'guest' ? 'guest' : judgeRole({ levelTime: infos['Level.sav'].lastModified, localTime: infos['LocalData.sav'].lastModified });
  return { status: 'ok', role, files: Object.keys(infos), missing, infos, error: '' };
}

/**
 * ファイルを読む。飛ばすのは必須（required）以外の、ファイルが消えたもの（NotFoundError）だけ。それ以外の失敗は全体を失敗にする。
 * @returns {Promise<{ files: { path: string, bytes: Uint8Array }[], skipped: { path: string, reason: string }[] }>}
 */
export async function readFiles(handles, paths, required = ['Level.sav']) {
  const files = [];
  const skipped = [];
  for (const path of paths) {
    try {
      const { file } = await fileInfo(handles[path]);
      files.push({ path, bytes: new Uint8Array(await file.arrayBuffer()) });
    } catch (error) {
      if (isMissing(error) && !required.includes(path)) { skipped.push({ path, reason: 'ファイルが見つかりません' }); continue; }
      if (isMissing(error)) throw errorWithCode(`${path} が見つかりません。ファイルを登録し直してください`, 'MISSING');
      throw readError(path, error);
    }
  }
  return { files, skipped };
}

/**
 * 登録したワールドのハンドルを IndexedDB に保存し、所持パルの自動の読み込みに使う。
 * persist は idbPersist（get・setStrict・removeStrict）。保存できない環境では、このページを開いている間だけ使う。
 */
export function createHandleSource({ persist, key }) {
  // ワールドごとに persisted（IndexedDB に保存できているか）を持つ。保存できなかった登録は、このページを開いている間だけ使う
  const records = new Map();
  let loading = null;

  const serialize = () => ({
    version: DATA_VERSION,
    worlds: [...records.values()].map(({ id, steamId, kind, files, name, hostName, revision, addedAt }) => ({ id, steamId, kind, files, name, hostName, revision, addedAt })),
  });

  // 書けたら、メモリの登録はすべて保存済みになる
  async function write(next) {
    await persist.setStrict(key, next);
    for (const record of records.values()) record.persisted = true;
  }

  const source = {
    load() {
      loading ??= (async () => {
        let saved = null;
        try { saved = await persist.get(key); } catch { saved = null; }
        if (saved?.version !== DATA_VERSION || !Array.isArray(saved.worlds)) return;
        for (const world of saved.worlds) {
          if (typeof world?.id !== 'string' || !world.files || typeof world.files !== 'object') continue;
          records.set(world.id, { ...world, kind: world.kind === 'guest' ? 'guest' : 'host', revision: Number(world.revision) || 1, persisted: true });
        }
      })();
      return loading;
    },
    /** 登録済みのワールド（登録した順）。 */
    worlds: () => [...records.values()],
    has: (worldId) => records.has(worldId),
    get: (worldId) => records.get(worldId) ?? null,
    /** 登録をすべて保存できているか（false なら、一部はこのページを開いている間だけ使う）。 */
    persisted: () => [...records.values()].every((record) => record.persisted),

    /** 登録したワールドの一覧。最後に遊んだ順（遊んだ時刻がわからないものは後ろ）。 */
    async list() {
      await source.load();
      const worlds = [];
      for (const record of records.values()) {
        const inspected = await inspectFiles(record.kind, record.files);
        const level = inspected.infos['Level.sav']?.lastModified ?? 0;
        const local = inspected.infos['LocalData.sav']?.lastModified ?? 0;
        const files = fileSignature(inspected.infos);
        worlds.push({
          id: record.id, dir: record.id, steamId: record.steamId, kind: record.kind, name: record.name ?? '', hostName: record.hostName ?? '',
          status: inspected.status, role: inspected.role, error: inspected.error, files: inspected.files, missing: inspected.missing,
          updatedAt: timeIso(record.kind === 'guest' ? local : level), playedAt: timeIso(Math.max(level, local)),
          fileSignature: files, signature: `${files}#${record.revision}`,
        });
      }
      return worlds.sort((a, b) => b.playedAt.localeCompare(a.playedAt));
    },

    /** list() で返したワールドを読む。list() の時点で消えていたファイルも skipped に入れる。 */
    async read(world) {
      const record = records.get(world.id);
      if (!record) throw errorWithCode('このワールドは登録されていません', 'NOT_REGISTERED');
      const result = await readFiles(record.files, world.files, REQUIRED_FILES[record.kind]);
      return { files: result.files, skipped: [...(world.missing ?? []).map((path) => ({ path, reason: 'ファイルが見つかりません' })), ...result.skipped] };
    },

    /**
     * 登録を確定する（同じワールドがあれば、ファイルを足す・置き換える）。
     * @returns {Promise<{ record: object, persisted: boolean }>}
     */
    async commit({ worldId, steamId, files, name = '', hostName = '' }, now = Date.now) {
      await source.load();
      const before = records.get(worldId);
      const merged = { ...(before?.files ?? {}), ...files };
      const record = {
        id: worldId, steamId: steamId || before?.steamId || '', kind: kindOf(Object.keys(merged)), files: merged,
        name: name || before?.name || '', hostName: hostName || before?.hostName || '',
        revision: (before?.revision ?? 0) + 1, addedAt: before?.addedAt ?? new Date(now()).toISOString(),
        // 前の版が保存済みなら、この保存に失敗しても保存済みとして扱う（削除に失敗したら知らせるため）
        persisted: before?.persisted ?? false,
      };
      records.set(worldId, record);
      let saved = true;
      try { await write(serialize()); } catch { saved = false; /* 保存できなければ、このページを開いている間だけ使う */ }
      return { record, persisted: saved };
    },

    /** 読み込んだワールドの名前を覚えておく（設定タブの一覧に出す）。保存できなくても続ける。 */
    async rename(worldId, { name, hostName }) {
      const record = records.get(worldId);
      if (!record || (record.name === name && record.hostName === hostName)) return;
      record.name = name || record.name;
      record.hostName = hostName || record.hostName;
      try { await write(serialize()); } catch { /* 名前は次に読み込んだときにまた保存する */ }
    },

    /** 登録を消す。保存できていた登録の削除に失敗したら例外にする（開き直すと戻ってしまうため）。 */
    async remove(worldId) {
      await source.load();
      if (!records.has(worldId)) return;
      const current = serialize();
      try {
        await persist.setStrict(key, { ...current, worlds: current.worlds.filter((world) => world.id !== worldId) });
        for (const record of records.values()) record.persisted = true;
      } catch {
        // 保存済みの登録を消せないと、開き直したときに戻ってしまう
        if (records.get(worldId).persisted) throw errorWithCode('登録を削除できませんでした（ブラウザに保存できません）', 'PERSIST');
      }
      records.delete(worldId);
    },

    async clear() {
      await source.load();
      try {
        await persist.removeStrict(key);
      } catch {
        if ([...records.values()].some((record) => record.persisted)) throw errorWithCode('登録を削除できませんでした（ブラウザに保存できません）', 'PERSIST');
      }
      records.clear();
    },

    /**
     * 読む許可を求める。クリックのすぐ後に、await を挟まず呼ぶこと（間に待ちが入るとブラウザが確認を出さない）。
     * @returns {Promise<{ granted: number, total: number }>}
     */
    requestPermission() {
      const handles = [...records.values()].flatMap((record) => Object.values(record.files));
      return (async () => {
        let granted = 0;
        for (const handle of handles) {
          try { if (await handle.requestPermission({ mode: 'read' }) === 'granted') granted++; } catch { /* 拒否・ユーザー操作切れは数えない */ }
        }
        return { granted, total: handles.length };
      })();
    },
  };
  return source;
}
