// 所持パルの状態。
// - ホスト（この PC にワールドのセーブがある）: セーブを読み込んで画面に出し、スプレッドシートへ共有する
// - 参加している側・連携していない人: スプレッドシートで共有された、ホストの所持パルを出す
// 同じワールドのデータが手元と共有の両方にあるときは、セーブの新しい方を出す。
import pals from '../data/pals.js';
import passives from '../data/passives.js';
import { normalizeOwned, ownedFromShared, sharedUpload, ownedContentText } from './core/owned.js';
import { OWNED_MAX_ROWS, OWNED_ADDED_FIELDS, OWNED_FORMAT, OWNED_RESULTS, compareSaves, ownedSaveStamp } from './core/owned-shared.js';
import { isObject, isoTime, text, worldId, cleanOwnedWorlds, cleanOwnedPayload } from './core/boundary.js';
import { userIdKey } from './core/user.js';
import { createHandleSource, inspectFiles, readFiles, fileSignature, kindOf, REQUIRED_FILES } from './save/handles.js';
import { createWatchClient, observable } from './save/watch.js';
import { errorMessage } from './api.js';

const DATA_VERSION = 1;
// 定期の確認（app.js の 10 秒ごとのタイマー）でセーブを読む間隔。ゲームの保存は見張り（save/watch.js）が知らせるので、これは安全網
//（見張りの Worker を作れないブラウザでは、これだけで読む。sync-fixes の save-watch）
const AUTO_INTERVAL = 20000;
// 読み直しの保留（sync-fixes の save-watch）: 読んだ一式を採用せずに、前の手元のデータ・表示・共有を残したまま読み直す。
// 読む前と後でファイルの印が違う（保存の途中に読んだ。P0 で Level.sav と LevelMeta.sav が食い違った）ときは 1 秒後
const HOLD_CHANGED_DELAY = 1000;
// 登録したファイルの読み・解凍・解析の失敗と一時的な消失（スナップショットの files.skipped）は、最初に見た時刻からこの段で読み直す。
// 最後の段（ゲームの保存の間隔 30 秒をまたぐ）でも同じ形なら、壊れた・消えたとみなして今までどおり飛ばして採用する
const HOLD_SKIPPED_STEPS = [1000, 3000, 10000, 30000];
// 見張りから読んだとき（transient）の読めない失敗（保存の途中の置き換え）は、最初の失敗からこの段で読み直し、3 回目もだめなら今の扱い
const HOLD_UNREADABLE_STEPS = [1000, 3000, 10000];
// 見張りから読むときに、読めない失敗として待つ読み込みのエラー（handles.js の readFiles）
const UNREADABLE_CODES = new Set(['NOT_READABLE', 'MISSING']);
// 共有の読み直しの間隔（表のタブなら、どの画面でも app.js の 10 秒ごとのタイマーで読み直す。裏のタブでは読まない。D26）。
// タイマーが少し早く来た回が次の回に回らないよう、SHARED_SLACK だけ短くても読む。読むのは今のワールドの ownedSince（GAS の G）で、
// 中身はホストが送り直したとき（uploadedAt が変わったとき）だけ届く（sync-fixes の share-fetch）
const SHARED_INTERVAL = 10000;
const SHARED_SLACK = 1000;
// 共有されたワールドの一覧（ownedWorlds）を読み直す間隔。起動・ログインの切り替え・force・目当てのワールドが一覧にないときは、間隔によらず読む
const WORLDS_INTERVAL = 5 * 60 * 1000;
// 古い GAS（ownedSince を知らず BAD_ACTION を返す）と分かってから、ownedSince を試し直すまで（それまでは一覧 → owned の 2 回呼び）
const SINCE_RETRY = 60 * 60 * 1000;
// 受け取った行の数が palCount と違う・PARTIAL（共有の書き込みと重なった）ときに、前の表示を残して読み直すまでの間と回数
const PARTIAL_DELAY = 5000;
const PARTIAL_RETRIES = 3;
// ownedSince の「変わっていない」応答で入れ替えるワールドの項目（所持パルの変換〔core/owned.js の ownedFromShared〕は読まない項目）
const SINCE_FIELDS = ['uploadedAt', 'uploadedBy', 'saveUpdatedAt', 'palCount', 'saveStamp'];
// ownedFromShared が読むワールドの項目。共有のデータがこれ以外（SINCE_FIELDS など）だけ違うときは、所持パルを作り直さない
const OWNED_WORLD_FIELDS = ['worldName', 'hostName', 'inGameDay', 'players', 'bases', 'farms'];
// 応答で受け取った生の行の数（重複・壊れた行を除く前。api.js が receivedRows に入れる。入っていなければ rows の数）
const receivedRows = (response) => (Number.isInteger(response.receivedRows) ? response.receivedRows : response.rows.length);
// 読み込みの途中にワールド・保存先が替わった（応答を捨てる）
const STALE = Symbol('stale');
// 共有の送り始めの最短の間隔（ゲームは約 30 秒ごとに保存する。送っている間に読んだセーブは、終わった後に最新を 1 回送る。sync-fixes の share-upload）
const UPLOAD_MIN_GAP = 15000;
// 送れなかったときに送り直すまでの間（続けて失敗するたびに次の段。最後の段のまま繰り返す。送れたら最初の段に戻す）
const UPLOAD_RETRY_DELAYS = [15000, 30000, 60000, 120000, 300000];
// 送り直す失敗（通信・混雑・サーバーの一時的なエラー・応答の読み取り）。VALIDATION・AUTH・TOO_LARGE など、同じ中身では通らない失敗は
// 送り直さない（次に新しいセーブを読んだときに送る）
const UPLOAD_RETRY_CODES = new Set(['TIMEOUT', 'CONNECTION', 'BUSY', 'INTERNAL', 'RESPONSE']);
// 古い GAS に合わせて狭めた列の幅を、全部の列で試し直すまでの間（save-extras）
const UPLOAD_WIDTH_RETRY = 60 * 60 * 1000;
// 古い GAS が列の幅の違う共有を断ったか（core/owned-shared.js の validateOwnedUpload の INVALID_COLUMNS。api.js の ApiError の response.errors）
const columnsRejected = (error) => error?.code === 'VALIDATION'
  && (Array.isArray(error.response?.errors) ? error.response.errors : []).some((item) => item?.field === 'columns' && item?.code === 'INVALID_COLUMNS');
// 共有の送信の結果（state.upload）の空の形
const emptyUpload = () => ({ status: '', at: '', error: '', worldId: '', result: '', signature: '', stamp: '', published: null });

/**
 * 共有の中身の印（world.contentHash）。core/owned.js の ownedContentText を UTF-8 にした SHA-256 の 16 進（64 字）。
 * crypto.subtle のない環境（古いブラウザ・安全でない接続）では ''（識別なしとして送り、GAS は今までどおり更新日時で比べる）
 */
export async function ownedContentHash(upload) {
  try {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(ownedContentText(upload)));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return '';
  }
}

// 読めたファイルの数（GlobalPalStorage.sav も数える。LocalData.sav は解析しないので入らない）と、登録してあるのに読めなかったファイルの数
//（消えていた・読めなかった・種類が違う）。解析の結果の files.used・files.skipped（save/import.js）から、同じパスは 1 つに数える
const fileCountOf = (snapshot) => (Array.isArray(snapshot?.files?.used) ? new Set(snapshot.files.used).size : 0);
const missingCountOf = (snapshot) => (Array.isArray(snapshot?.files?.skipped) ? new Set(snapshot.files.skipped.map((file) => file?.path)).size : 0);

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

// 手元のセーブのデータが、共有できる行数の 5 倍を超えていたら壊れているとみなす（黙って一部を捨てない）
const LOCAL_PALS_MAX = OWNED_MAX_ROWS * 5;

// 解析結果の一覧は、object の要素だけにする（配列でなければ項目ごと外す。breedFarms がないのは牧場を読む前のデータ）
const objectsOf = (items, keep = () => true) => (Array.isArray(items) ? items.filter((item) => isObject(item) && keep(item)) : undefined);

/**
 * IndexedDB から読んだ手元のセーブのデータ。形が違えば null（データなし。登録したファイルから読み直せる）。
 * 個体ごとの値は、画面用の変換（core/owned.js の normalizeOwned）で確かめる。ただし、案内（ui/owned-status.js）・設定の登録者の対応
 * （views/owned-settings.js）・自動登録（auto-register.js・core/auto-breeding.js）は解析結果をそのまま読むので、
 * プレイヤー・個体・拠点・ギルド・牧場は object の要素だけ（プレイヤーは uid が文字列のものだけ）に絞っておく
 */
function cleanLocalData(value) {
  if (!isObject(value) || value.version !== DATA_VERSION || !isObject(value.world) || !isObject(value.snapshot)
    || !Array.isArray(value.snapshot.pals) || value.snapshot.pals.length > LOCAL_PALS_MAX) return null;
  const id = worldId(value.world.id);
  if (!id) return null;
  const { snapshot } = value;
  const cleaned = {
    ...snapshot,
    players: objectsOf(snapshot.players, (player) => typeof player.uid === 'string'),
    pals: objectsOf(snapshot.pals), bases: objectsOf(snapshot.bases), guilds: objectsOf(snapshot.guilds), breedFarms: objectsOf(snapshot.breedFarms),
  };
  // 古い版で保存したデータは、Level.sav から読んだものなのでホスト扱い
  return { ...value, snapshot: cleaned, importedAt: isoTime(value.importedAt), source: text(value.source, 20), world: { ...value.world, id, role: value.world.role || 'host' } };
}

/** IndexedDB に保存した共有のキャッシュ。worlds が配列でなければ null。今のワールドの所持パル（current）は形が違えば null */
function cleanSharedCache(value) {
  if (!isObject(value) || !Array.isArray(value.worlds)) return null;
  const current = cleanOwnedPayload(value.current);
  return { worlds: cleanOwnedWorlds(value.worlds), current: current?.world ? current : null, fetchedAt: isoTime(value.fetchedAt) };
}

const WORLD_ID = /^[0-9A-F]{32}$/i;

// セーブの新旧を比べる形（core/owned-shared.js の compareSaves）。手元は Level.sav の中の保存時刻（snapshot.world.savedAtTicks）と
// ファイルの更新日時、共有はワールドの行の saveStamp と saveUpdatedAt（どちらかに保存時刻がなければ更新日時で比べる）
const localSave = (local) => ({ stamp: local.snapshot?.world?.savedAtTicks, updatedAt: local.world.updatedAt });
const sharedSave = (world) => ({ stamp: world.saveStamp, updatedAt: world.saveUpdatedAt });

/**
 * @param {object} options
 * @param {{ scope: () => string, userId: () => string, request: (action: string, input?: object) => Promise<object>, endpoint?: () => string }} [options.server]
 *   スプレッドシートとの通信。scope はログイン中の環境（'prod' / 'test'）、ログインしていなければ ''。endpoint は接続先（API の URL）で、
 *   GAS ができること（ownedSince）を接続先と環境ごとに覚えるのに使う。
 * @param {object} [options.handles] 登録したセーブのファイル（save/handles.js の createHandleSource）。
 * @param {() => boolean} [options.hidden] タブが裏にあるか（共有の読み直しの再試行は、裏では行わない。D26）
 * @param {(callbacks: { onSettled: (message: object) => void, onMode: (mode: string) => void }) => { update: (targets: object[]) => void, stop: () => void }} [options.watch]
 *   セーブのファイルの見張り（save/watch.js の createWatchClient。テストは偽物を渡す）。対象ができたときに 1 回だけ作る
 */
export function createOwnedStore({
  persist = idbPersist(), settings, namespace = 'pal-note', runImport = runImportInWorker,
  handles = null, now = Date.now, server = null,
  schedule = (fn, ms) => setTimeout(fn, ms), cancel = (id) => clearTimeout(id),
  hidden = () => globalThis.document?.visibilityState === 'hidden',
  watch = createWatchClient,
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
  // 共有の送信（uploadLocal）: 最後に送り始めた時刻・予約（間隔・再試行）・送っている途中の Promise（1 つずつ送る）・送っている間に
  // 新しいセーブを読んだか（dirty）・続けて失敗した数と次に送ってよい時刻（再試行の段）・送り始めた数・止めた数（blockUpload）
  let lastUpload = -Infinity;
  let uploadTimer = null;
  let uploading = null;
  let uploadDirty = false;
  let retryStep = 0;
  let retryAt = -Infinity;
  let uploadSeq = 0;
  let uploadEpoch = 0;
  // 送るはずだった予約・送っている間の 1 回を、共有を止めている間（セーブの読み直しの途中）に取り消した・飛ばした。読み直せずに今のセーブの
  // まま（runAuto の 'unchanged'）になったら、もう一度 uploadLocal を呼ぶ
  let uploadOwed = false;
  // 登録の確定で読んだ手元のデータ（それを送るときだけ world.force を付ける。別のセーブを読んだら付けない）
  let commitLocal = null;
  // 共有で GAS が受け付けた列の幅と、幅を狭めた時刻（古い GAS。uploadLocal）
  let uploadWidth = Infinity;
  let uploadWidthAt = -Infinity;
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
  let sharedLoading = null;
  let sharedInflight = null;
  // 共有を読んでいる途中に強制の読み直しを求められたら、終わってからもう 1 回読む
  let sharedFollow = null;
  // 共有の保存先（scope）が替わるたびに増やす。前の保存先への応答は捨てる
  let sharedEpoch = 0;
  // ワールドの一覧を最後に読んだ時刻
  let listedAt = -Infinity;
  // GAS ができないこと（接続先|環境|操作 → 試し直す時刻）。古い GAS の ownedSince は BAD_ACTION
  const unsupported = new Map();
  // 行の数の食い違い・PARTIAL の読み直し（どのワールドの何回目か）
  let partial = { key: '', count: 0, timer: null };
  // 読み込みは 1 つずつ行う（自動の読み込みの途中で別のワールドを選んでも、後の操作の結果が残る）
  let chain = Promise.resolve();
  let pending = 0;
  // 読み直しの保留（save-watch）。保留しているワールド・読み直しのタイマー（1 本）・読み直しを見張りから読んだときと同じに扱うか・
  // 登録したファイルの失敗と消失の形（パスと理由の集合）と最初に見た時刻・見張りから読んだときの読めない失敗を最初に見た時刻
  const emptyHold = () => ({ worldId: '', timer: null, transient: false, skipped: null, unreadable: null });
  let hold = emptyHold();
  // 30 秒続いて受け入れた失敗・消失の形（ワールドごと。メモリだけ）。同じ形なら次から待たずに採用し、全部読めたら忘れる
  const acceptedShapes = new Map();
  // セーブのファイルの見張り（save/watch.js）。送った対象の印（同じなら送り直さない）・対象のワールド・今のワールド・読み込みの後の 1 回
  let watcher = null;
  let watchKey = '';
  let watchedIds = new Set();
  let watchCurrent = '';
  let watchFollow = null;
  let watchFollowId = '';
  // 旧版の worldDir は「Steam ID/ワールド ID」。末尾のワールド ID に読み替える
  const savedWorldId = String(saved.worldId ?? saved.worldDir ?? '').split('/').pop();
  const state = {
    ready: false, busy: false, progress: '', error: '',
    // 登録したファイルからの自動の読み込み。worldId が空なら、最後に遊んだワールドを読む
    // stoppedAt: 許可待ちで止まった時刻（ISO。止まったときに 1 回だけ入れ、読めたら空にする。autoreg-visibility）
    auto: { enabled: saved.enabled === true, status: 'off', worlds: [], worldId: WORLD_ID.test(savedWorldId) ? savedWorldId.toUpperCase() : '', error: '', stoppedAt: '' },
    // この PC での、連携しているワールドの役割（'host' | 'guest' | ''）と ID
    role: '', linkedWorldId: '',
    // 表示するワールド（空なら自動）
    viewWorldId: worldId(saved.viewWorldId),
    local: null,
    shared: { worlds: [], current: null, fetchedAt: '', error: '' },
    // 共有の送信の結果（uploadLocal。sync-fixes の share-upload）。status: 'sending'・'done'（自分の共有が載っている。new・newer・resent・
    // 自分の前の送信が届いていた unchanged・古い GAS の stored）・'same'（同じセーブを別の人〔か同じ ID の別のタブ・PC〕が共有済み。same・
    // 他人の unchanged）・'stale'（共有されているセーブの方が新しい）・'error'・''。result は GAS の結果の種類（古い GAS は ''）、
    // signature・stamp は送ったスナップショットの印（state.local.world.signature）と Level.sav の中の保存時刻、published は応答の
    // 今公開されているワールドの { saveStamp, uploadedBy, uploadedAt }。新しいセーブを読んだら消す（送っている途中・送れなかった知らせは残す）
    upload: emptyUpload(),
    // 共有してよいか。このページで、ホストのワールドのセーブを正常に読めたときだけ true（保存済みのデータや判定できないときは共有しない）
    uploadReady: false,
    // セーブのファイルの見張り（sync-fixes の save-watch）。mode: 'observer'（ファイルの変更）・'poll'（Worker の 5 秒ごとの確認）・
    // 'timer'（Worker を作れない。app.js の定期の確認だけ）・''（見張っていない）。lastSave は今のワールドの最後の保存
    //（at: 書き終えた時刻〔変わったファイルの更新日時の最大〕の ISO・files: 変わったファイルの数・spanMs: 書き始めから書き終わりまで）
    watch: { mode: '', lastSave: null },
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

  function cancelUploadTimer() {
    if (uploadTimer !== null) { cancel(uploadTimer); uploadTimer = null; }
  }
  // 共有を止め、予約（間隔・再試行）・送っている間に読んだセーブの 1 回（dirty）・再試行の段・登録の確定の印を全部消す（登録の削除・解除・
  // 参加者・読めないとき）。送っている途中の送信は止められないが、終わっても次を予約しない（uploadEpoch）
  function blockUpload() {
    state.uploadReady = false;
    uploadEpoch++;
    cancelUploadTimer();
    uploadDirty = false;
    uploadOwed = false;
    retryStep = 0;
    retryAt = -Infinity;
    commitLocal = null;
  }
  // セーブを読み直す間だけ共有を止める（読み終えたら uploadLocal が予約し直す）。再試行の段は残す（新しいセーブを読むたびに段が戻ると、
  // 送れない間も保存のたびに送ってしまう）。取り消した予約は、読み直せなかったときに uploadOwed で戻す
  function holdUpload() {
    state.uploadReady = false;
    if (uploadTimer !== null) uploadOwed = true;
    cancelUploadTimer();
  }

  const registeredWorlds = () => source.worlds().map((record) => ({
    id: record.id, dir: record.id, steamId: record.steamId ?? '', kind: record.kind, name: record.name ?? '', hostName: record.hostName ?? '', status: '', role: '', playedAt: '', files: Object.keys(record.files),
  }));

  // 表示するワールド: 連携しているワールド → 設定で選んだワールド → いちばん新しく共有されたワールド（worlds は共有されたワールドの一覧）
  function targetWorldId(worlds = state.shared.worlds) {
    if (state.linkedWorldId) return state.linkedWorldId;
    if (state.viewWorldId) return state.viewWorldId;
    if (state.local && !worlds.length) return state.local.world.id;
    // いちばん新しいセーブ（同じなら先の方）
    return worlds.reduce((best, world) => (!best || compareSaves(sharedSave(world), sharedSave(best)) > 0 ? world : best), null)?.worldId ?? '';
  }

  // 共有のデータで、所持パルの変換が読む中身（行・列・OWNED_WORLD_FIELDS）が同じか（ownedSince の「変わっていない」応答で時刻などだけを入れ替えたとき）
  const sameSharedContent = (a, b) => Boolean(a?.rows && b?.rows) && a.rows === b.rows && a.columns === b.columns
    && OWNED_WORLD_FIELDS.every((field) => a.world?.[field] === b.world?.[field]);

  let normalizedFrom = null;
  function recompute() {
    const target = targetWorldId();
    const local = state.local && state.local.world.id === target ? state.local : null;
    const current = state.shared.current;
    const shared = current?.world && current.world.worldId === target ? current : null;
    const sharedMeta = state.shared.worlds.find((world) => world.worldId === target) ?? shared?.world ?? null;
    // 手元と共有で、セーブの新しい方を出す（同じなら手元）。参加している側では手元のデータ（前にホストしたときの残り）は出さない
    const useLocal = local && state.role !== 'guest' && (!shared || compareSaves(localSave(local), sharedSave(shared.world)) >= 0);
    const source = useLocal ? local : shared;
    if (source !== normalizedFrom) {
      // 共有の時刻・共有した人などだけが変わったときは、所持パルを作り直さない（画面が作り直されない）
      if (useLocal || !sameSharedContent(source, normalizedFrom)) {
        state.owned = !source ? null : useLocal
          ? normalizeOwned(local.snapshot, { pals, passives })
          : ownedFromShared(shared, { pals, passives });
      }
      normalizedFrom = source;
    }
    state.data = source;
    state.meta = !source ? (target ? { worldId: target, worldName: sharedMeta?.worldName ?? '', hostName: sharedMeta?.hostName ?? '' } : null) : {
      worldId: target,
      worldName: useLocal ? local.world.name : shared.world.worldName,
      hostName: useLocal ? local.world.hostName : shared.world.hostName,
      source: useLocal ? 'local' : 'shared',
      saveUpdatedAt: useLocal ? local.world.updatedAt || local.importedAt : shared.world.saveUpdatedAt,
      importedAt: useLocal ? local.importedAt : '',
      // 共有を出すときは、出している版の時刻と共有した人（一覧の方が新しくても、中身を読めるまでは前の版。share-fetch の安全網）
      sharedAt: (useLocal ? sharedMeta : shared.world)?.uploadedAt ?? '',
      uploadedBy: (useLocal ? sharedMeta : shared.world)?.uploadedBy ?? '',
      palCount: useLocal ? local.snapshot.pals.length : shared.rows.length,
    };
  }

  const update = () => { recompute(); emit(); };

  // 共有の保存先（ログイン中の環境）のキャッシュを読む。保存先が替わったら、読み込みの途中の応答を捨て、次は一覧から読む
  function loadShared() {
    const key = scope();
    if (loadedScope === key) return sharedLoading?.key === key ? sharedLoading.promise : Promise.resolve();
    loadedScope = key;
    sharedEpoch++;
    listedAt = -Infinity;
    stopPartial();
    const promise = (async () => {
      const cached = key ? cleanSharedCache(await persist.get(sharedKey(key))) : null;
      if (loadedScope !== key) return;
      state.shared = { worlds: cached?.worlds ?? [], current: cached?.current ?? null, fetchedAt: cached?.fetchedAt ?? '', error: '' };
    })();
    sharedLoading = { key, promise };
    return promise;
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
      const local = cleanLocalData(await persist.get(dataKey));
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
      if (!pending) {
        state.busy = false;
        state.progress = '';
      }
      update();
    });
    chain = result.catch(() => {});
    return result;
  }

  // ---- スプレッドシート ----

  // GAS ができること（接続先と環境ごと。古い GAS は ownedSince を知らない）
  const capabilityKey = (action, env = scope()) => `${server?.endpoint?.() ?? ''}|${env}|${action}`;
  const supports = (action) => !(unsupported.get(capabilityKey(action)) > now());

  // ワールドの時刻・共有した人など（SINCE_FIELDS）だけを from から入れる。何も変わらなければ同じ物を返す
  function withSinceFields(world, from) {
    const merged = { ...world };
    for (const field of SINCE_FIELDS) if (from[field] !== undefined) merged[field] = from[field];
    return JSON.stringify(merged) === JSON.stringify(world) ? world : merged;
  }
  // 一覧のワールドを入れ替える（なければ足す。同じ中身なら一覧をそのまま返す）
  function upsertWorld(worlds, world) {
    const index = worlds.findIndex((item) => item.worldId === world.worldId);
    if (index < 0) return [...worlds, world];
    if (worlds[index] === world || JSON.stringify(worlds[index]) === JSON.stringify(world)) return worlds;
    return worlds.map((item, i) => (i === index ? world : item));
  }

  function stopPartial() {
    if (partial.timer !== null) cancel(partial.timer);
    partial = { key: '', count: 0, timer: null };
  }
  // 受け取った行の数が palCount と違う・PARTIAL: 前の表示を残し（キャッシュにも書かない）、5 秒後に読み直す（3 回まで）。
  // それでも合わなければ、次の定期の読み直しに任せる（表示しているデータがなければ、読めなかったことを知らせる）
  function partialRead(key, message) {
    if (partial.key !== key) stopPartial();
    partial.key = key;
    if (partial.timer !== null) return 'partial';
    if (partial.count >= PARTIAL_RETRIES) {
      state.shared.error = message;
      return 'partial';
    }
    partial.count++;
    partial.timer = schedule(() => {
      partial.timer = null;
      // タブが裏にある間は読まない（表に戻ったときの読み直しで読む。D26）
      return hidden() ? 'skipped' : fetchShared({ retry: true }).catch(() => 'error');
    }, PARTIAL_DELAY);
    return 'partial';
  }

  /**
   * 共有を読み直す。force は一覧も必ず読む（ワールドの選び直し・ログインの切り替えなど）。retry は行の数の食い違いの読み直し（間隔を空けない）。
   * 読んでいる途中なら、その結果を返す（force のときは、終わってからもう 1 回読む）。
   */
  async function fetchShared({ force = false, retry = false } = {}) {
    if (!server || !scope()) return 'skipped';
    await load();
    await loadShared();
    if (sharedInflight) {
      if (!force) return sharedInflight;
      sharedFollow ??= sharedInflight.then(() => {
        sharedFollow = null;
        return fetchShared({ force: true });
      });
      return sharedFollow;
    }
    if (!force && !retry && now() - lastShared < SHARED_INTERVAL - SHARED_SLACK) return 'skipped';
    sharedInflight = readShared({ force }).finally(() => {
      sharedInflight = null;
      update();
    });
    return sharedInflight;
  }

  // 共有を 1 回読む。今のワールドの共有を持っていれば ownedSince を 1 回だけ呼ぶ（古い GAS なら一覧 → owned の 2 回呼び）。
  // 応答はこの関数の中で集め、最後にまとめて state に入れる（途中で保存先・ワールド・共有のデータが替わったら、何も入れずに捨てる）
  async function readShared({ force }) {
    lastShared = now();
    const key = scope();
    const epoch = sharedEpoch;
    const before = { worlds: state.shared.worlds, current: state.shared.current };
    const { current } = before;
    let worlds = before.worlds;
    let target = '';
    // target を決めたときの一覧（中身を受け取って一覧を直した後も、表示するワールドが替わっていないかをこれで確かめる）
    let chosenFrom = worlds;
    // この回に一覧を読んだ時刻（読んでいなければ null）
    let listed = null;
    const same = () => scope() === key && sharedEpoch === epoch && state.shared.worlds === before.worlds && state.shared.current === current;
    // 応答を受け取った直後と、state に入れる直前に確かめる（その間にも送信・削除の応答が割り込める）
    const fresh = () => same() && targetWorldId(chosenFrom) === target;
    const check = () => { if (!fresh()) throw STALE; };
    const have = () => (current?.world?.worldId === target ? current : null);
    const listWorlds = async () => {
      const list = await server.request('ownedWorlds');
      if (!same()) throw STALE;
      // 同じ中身なら前の一覧のまま（キャッシュを書き直さない）
      if (JSON.stringify(list.worlds) !== JSON.stringify(worlds)) worlds = list.worlds;
      listed = now();
      chosenFrom = worlds;
      target = targetWorldId(worlds);
    };
    // 一覧で分かること: 共有がない（消えた）・持っている版と同じ。分からなければ null（中身を読む）
    const fromList = () => {
      const entry = worlds.find((world) => world.worldId === target);
      const own = have();
      if (!entry) return { current: own ? null : current };
      if (own && own.world.uploadedAt === entry.uploadedAt) {
        // 所持パルは同じでも、共有した人の名前が変わっていることがある（ID の変更）。何も変わっていなければ置き換えない
        const world = withSinceFields(own.world, entry);
        return { current: world === own.world ? own : { ...own, world } };
      }
      return null;
    };
    // owned・ownedSince（変わった）の中身。行の数が palCount と違えば受け取らない
    const fromPayload = (response) => {
      if (!response.world) {
        worlds = worlds.filter((world) => world.worldId !== target);
        return { current: have() ? null : current };
      }
      if (response.world.worldId !== target || receivedRows(response) !== response.world.palCount) return { partial: true };
      worlds = upsertWorld(worlds, response.world);
      return { current: { world: response.world, columns: response.columns, rows: response.rows } };
    };
    const readSince = async () => {
      const own = have();
      const since = own?.world.uploadedAt ?? '';
      let response;
      try {
        response = await server.request('ownedSince', { worldId: target, uploadedAt: since });
      } catch (error) {
        // 共有の書き込みと重なった（GAS が行の数の違いを返した）
        if (error?.code === 'PARTIAL') { check(); return { partial: true }; }
        if (error?.code !== 'BAD_ACTION') throw error;
        // 古い GAS。送った先の環境では、1 時間は今までの 2 回呼びにする
        unsupported.set(capabilityKey('ownedSince', key), now() + SINCE_RETRY);
        check();
        return null;
      }
      check();
      if (response.changed) return fromPayload(response);
      if (!own || response.uploadedAt !== since) return { partial: true };
      const world = withSinceFields(own.world, response);
      worlds = upsertWorld(worlds, world);
      return { current: world === own.world ? own : { ...own, world } };
    };
    const readOwned = async () => {
      let response;
      try {
        response = await server.request('owned', { worldId: target });
      } catch (error) {
        if (error?.code !== 'PARTIAL') throw error;
        check();
        return { partial: true };
      }
      check();
      return fromPayload(response);
    };
    try {
      const wanted = targetWorldId(worlds);
      if (force || !supports('ownedSince') || now() - listedAt >= WORLDS_INTERVAL || !wanted || !worlds.some((world) => world.worldId === wanted)) {
        await listWorlds();
      } else {
        target = wanted;
      }
      let outcome = !target ? { current } : listed !== null ? fromList() : null;
      if (!outcome && supports('ownedSince')) outcome = await readSince();
      if (!outcome && listed === null) {
        // 古い GAS（ownedSince を知らない）。今までの 2 回呼び（一覧 → owned）に落とす
        await listWorlds();
        outcome = !target ? { current } : fromList();
      }
      outcome ??= await readOwned();
      check();
      if (outcome.partial) {
        // 読んだ一覧は使う（5 分は読み直さない。キャッシュには書かない）。表示する所持パルと時刻は前の版のまま（current。recompute は
        // 共有を出すとき current の時刻を出す）。ただし一覧で表示するワールドが替わる（いちばん新しく共有されたワールドが替わった）ときは、
        // そのワールドの中身を読めていないので、前の一覧と表示のまま（次の回は一覧から読み直す。前のワールドの読み直しに戻らない）。
        // 何も表示していなければ、替わっても一覧を使う（ワールドの名前は出せる）
        if (listed !== null) {
          if (targetWorldId(before.worlds) === target || !state.data) {
            state.shared.worlds = worlds;
            listedAt = listed;
          } else {
            listedAt = -Infinity;
          }
        }
        return partialRead(`${key}|${epoch}|${target}`, errorMessage('PARTIAL'));
      }
      stopPartial();
      if (listed !== null) listedAt = listed;
      const changed = worlds !== before.worlds || outcome.current !== current;
      state.shared.worlds = worlds;
      state.shared.current = outcome.current;
      state.shared.error = '';
      state.shared.fetchedAt = new Date(now()).toISOString();
      // 何も変わっていなければ書かない（20,000 行の所持パルを 10 秒ごとに書き直さない）
      if (changed) await persist.set(sharedKey(key), { worlds: state.shared.worlds, current: state.shared.current, fetchedAt: state.shared.fetchedAt });
      return 'fetched';
    } catch (error) {
      if (error === STALE) return 'skipped';
      if (same()) state.shared.error = error.message;
      return 'error';
    }
  }

  // 共有してよいか（ホストとして、このページで読んだ、登録の残っているワールドのセーブ）
  const canUpload = (local) => Boolean(server && scope() && local && state.uploadReady && state.role === 'host' && local.world.id === state.linkedWorldId)
    && !(local.source === 'handles' && (!source.has(local.world.id) || removing.has(local.world.id)));

  // 予約した時刻に、そのときの最新を送る（間隔・再試行の待ちは予約の時刻で済んでいる）
  function scheduleUpload(wait) {
    uploadTimer ??= schedule(() => { uploadTimer = null; uploadLocal({ force: true, resume: true }).catch(() => {}); }, wait);
  }

  /**
   * ホストのセーブを共有する（古いセーブは GAS が受け付けない。新しい方を残す。sync-fixes の share-upload）。
   * 1 つずつ送る: 送っている間に呼ばれたら dirty にし、終わった後に最新を 1 回送る。送り始めの間を UPLOAD_MIN_GAP 空け、空いていなければ
   * 予約する。送れなかったら（UPLOAD_RETRY_CODES）UPLOAD_RETRY_DELAYS の段で予約し直す。
   * force は間隔・再試行の待ちを空けずに今送る（送っている途中なら終わってから。その後の 1 回が始まっていれば、それを待つ）。
   * commit は登録の確定（commitRegistration）から送るとき（そのセーブを送るときだけ GAS に world.force を送る）。
   * resume は予約・送っている間の 1 回から呼ぶとき（共有を止めている間で送れなければ uploadOwed に残す）。
   * @returns {Promise<'skipped'|'queued'|'scheduled'|'uploaded'|'unchanged'|'same'|'stale'|'error'>}
   */
  async function uploadLocal({ force = false, commit = false, resume = false } = {}) {
    const local = state.local;
    if (!canUpload(local)) {
      // セーブの読み直しの途中（holdUpload）など。止めた理由が登録の削除・解除なら blockUpload が消す
      if (resume) uploadOwed = true;
      return 'skipped';
    }
    uploadOwed = false;
    if (commit) commitLocal = local;
    if (uploading) {
      if (!force) {
        uploadDirty = true;
        return 'queued';
      }
      const seq = uploadSeq;
      await uploading;
      // 終わった後の 1 回（dirty）がもう送り始めていれば、それが最新を送っている
      if (uploading && uploadSeq > seq) return (await uploading).result;
      return uploadLocal({ force: true });
    }
    const wait = Math.max(lastUpload + UPLOAD_MIN_GAP, retryAt) - now();
    if (!force && wait > 0) {
      scheduleUpload(wait);
      return 'scheduled';
    }
    cancelUploadTimer();
    uploadDirty = false;
    const epoch = uploadEpoch;
    const sending = sendLocal(local);
    uploading = sending;
    let outcome;
    try {
      outcome = await sending;
    } finally {
      if (uploading === sending) uploading = null;
    }
    // 送っている間に共有を止めた（登録の削除・解除・別のワールドに替わったなど）なら、このセーブの再試行の段は動かさない（blockUpload が
    // 消した）。止めた後に呼ばれた分（dirty。blockUpload が消した後に立った）は、今のワールドのセーブなので送る
    if (epoch === uploadEpoch) {
      if (outcome.retry) {
        retryStep++;
        const delay = UPLOAD_RETRY_DELAYS[Math.min(retryStep, UPLOAD_RETRY_DELAYS.length) - 1];
        retryAt = now() + delay;
        cancelUploadTimer();
        scheduleUpload(delay);
      } else {
        retryStep = 0;
        retryAt = -Infinity;
      }
    }
    if (uploadDirty) {
      uploadDirty = false;
      uploadLocal({ resume: true }).catch(() => {});
    }
    return outcome.result;
  }

  // 1 回送る（例外にしない）。{ result, retry }（retry は送り直す失敗）を返す
  async function sendLocal(local) {
    lastUpload = now();
    uploadSeq++;
    const signature = local.world.signature ?? '';
    const stamp = ownedSaveStamp(local.snapshot?.world?.savedAtTicks);
    state.upload = { ...emptyUpload(), status: 'sending', at: state.upload.at, worldId: local.world.id, signature, stamp };
    emit();
    // 送った先の保存先（ログイン中の環境）。応答が届くまでに替わったら、その応答は今の共有に入れない
    const key = scope();
    const epoch = sharedEpoch;
    const userId = server.userId?.() ?? '';
    const force = commitLocal === local;
    // 登録の確定の後に別のセーブを読んだ（送るのはいつも今の手元のデータなので、前の印はもう使わない）
    if (!force) commitLocal = null;
    const changed = () => scope() !== key || sharedEpoch !== epoch;
    try {
      const owned = normalizeOwned(local.snapshot, { pals, passives });
      const payload = sharedUpload(owned);
      // ゲーム内の日数（save-extras）とセーブの識別（owned-gas）は、GAS の最上位の項目を増やさないよう world の中に入れる（古い GAS は捨てるだけ）
      const world = {
        name: local.world.name || owned.world?.name || '', hostName: local.world.hostName || owned.world?.hostName || '',
        ...(owned.world?.inGameDay ? { inGameDay: owned.world.inGameDay } : {}),
      };
      const head = { userId, worldId: local.world.id, saveUpdatedAt: local.world.updatedAt || local.importedAt };
      const counts = { fileCount: fileCountOf(local.snapshot), missingCount: missingCountOf(local.snapshot) };
      // 古い GAS（後から足した列を知らない）は列の幅が違う共有を INVALID_COLUMNS で断るので、末尾の列を 1 つずつ外して送り直し、受け付けた
      // 幅を覚える（UPLOAD_WIDTH_RETRY ごとに全部の列で試し直す。GAS を後から更新しても戻る）。画面を GAS より先に配信しても共有は止まらない
      //（足した列〔入手時刻など〕だけが届かない。save-extras の Codex のレビュー）。中身の印（contentHash）は狭めた後の中身で計算し、形の版
      //（format）は外した列の数だけ下げる（新しい GAS が狭めた共有を受けていても、全部の列で送り直したときに resent で書き直される）
      const full = payload.columns.length;
      const start = uploadWidth < full && now() - uploadWidthAt < UPLOAD_WIDTH_RETRY ? uploadWidth : full;
      let width = start;
      let sent;
      let response;
      for (;;) {
        sent = width >= full ? payload : { ...payload, columns: payload.columns.slice(0, width), rows: payload.rows.map((row) => row.slice(0, width)) };
        const contentHash = await ownedContentHash({ worldId: head.worldId, world, ...sent });
        const identity = { saveStamp: stamp, contentHash, format: OWNED_FORMAT - (full - width), ...counts, force };
        try {
          response = await server.request('ownedUpload', { ...head, world: { ...world, ...identity }, ...sent });
          break;
        } catch (error) {
          if (!columnsRejected(error) || width <= full - OWNED_ADDED_FIELDS.length) throw error;
          width--;
        }
      }
      // 全部の列で試して狭めたときだけ時刻を残す（覚えた幅で送ったときは、試し直す時刻を延ばさない）
      if (start === full && width < full) uploadWidthAt = now();
      uploadWidth = width;
      if (commitLocal === local) commitLocal = null;
      if (changed()) {
        // 送っている間にログイン・環境が替わった。前の保存先への応答なので、今の共有とキャッシュには入れない
        state.upload = emptyUpload();
        return { result: 'skipped', retry: false };
      }
      const result = OWNED_RESULTS.includes(response.result) ? response.result : '';
      const published = { saveStamp: response.world.saveStamp ?? '', uploadedBy: response.world.uploadedBy ?? '', uploadedAt: response.world.uploadedAt ?? '' };
      // 自分の共有が載っているか（応答を失った後の再送・読み込み直しで、前の自分の送信が届いていた unchanged も）。送った人は ID で比べる
      const mine = Boolean(userId) && userIdKey(published.uploadedBy) === userIdKey(userId);
      const status = response.stored || (result === 'unchanged' && mine) ? 'done' : ['same', 'unchanged'].includes(result) ? 'same' : 'stale';
      state.upload = { status, at: published.uploadedAt, error: '', worldId: local.world.id, result, signature, stamp, published };
      const others = state.shared.worlds.filter((item) => item.worldId !== response.world.worldId);
      state.shared.worlds = [...others, response.world];
      const wrote = response.stored || result === 'unchanged';
      // 書いた・同じ中身が載っている。送っている間に表示するワールドが替わっていたら、一覧だけに入れる（今のワールドの所持パルは置き換えない）
      if (wrote && response.world.worldId === targetWorldId()) {
        state.shared.current = { world: response.world, columns: sent.columns, rows: sent.rows.map((row) => row.map(String)) };
      }
      // 結果はすぐ知らせる（キャッシュの保存・読み直しを待つ間に新しいセーブを読むと、runImportTask が結果を消すため）
      update();
      if (wrote) {
        await persist.set(sharedKey(key), { worlds: state.shared.worlds, current: state.shared.current, fetchedAt: state.shared.fetchedAt });
      } else if (status === 'stale') {
        // 共有されている方が新しい（別の PC から共有された）ので、そちらを読む。same（同じセーブの別の中身）は、この PC では手元のセーブを
        // 出すので読まない（次の定期の読み直しで入る）
        await fetchShared({ force: true });
      }
      return { result: response.stored ? 'uploaded' : result === 'unchanged' ? 'unchanged' : status, retry: false };
    } catch (error) {
      if (changed()) {
        state.upload = emptyUpload();
        return { result: 'error', retry: false };
      }
      const retry = UPLOAD_RETRY_CODES.has(error?.code);
      state.upload = { ...emptyUpload(), status: 'error', error: error?.message ?? String(error), worldId: local.world.id, signature, stamp };
      if (!retry && commitLocal === local) commitLocal = null;
      return { result: 'error', retry };
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
      // 前のセーブを送った結果は消す（送っている途中と、送れなかった知らせは次の応答まで残す。share-upload）
      if (!['sending', 'error'].includes(state.upload.status)) state.upload = emptyUpload();
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
    // 許可待ちで止まった時刻は、止まったときだけ入れる（続けて止まっている間・ほかの理由で止まっている間は上書きしない）
    if (status === 'permission' && !state.auto.stoppedAt) state.auto.stoppedAt = new Date(now()).toISOString();
    clearHold();
    blockUpload();
    if (!auto) throw Object.assign(new Error(message), { code: status });
    return status;
  }

  const worldLabel = (world) => (world.name ? `「${world.name}」` : `ワールド ${world.id.slice(0, 8)}`);

  // ---- 読み直しの保留（sync-fixes の save-watch） ----

  function clearHold() {
    if (hold.timer !== null) cancel(hold.timer);
    hold = emptyHold();
  }
  // そのワールドの保留（別のワールドの保留は捨てる）
  function holdOf(worldId) {
    if (hold.worldId !== worldId) {
      clearHold();
      hold.worldId = worldId;
    }
    return hold;
  }
  // 読み直しを予約する（タイマーは 1 本。transient は見張りから読んだときと同じに扱うか）
  function scheduleReread(delay, transient) {
    if (hold.timer !== null) cancel(hold.timer);
    hold.transient = transient;
    hold.timer = schedule(() => {
      hold.timer = null;
      if (!state.auto.enabled) return 'skipped';
      lastAuto = now();
      return runAuto({ auto: true, transient: hold.transient, watchWorldId: hold.worldId, shared: false }).catch(() => 'error');
    }, Math.max(0, delay));
  }
  // 登録したファイルの失敗・消失の形（パスと理由の集合。並びによらない）
  const shapeOf = (skipped) => [...new Set(skipped.map((item) => `${item?.path ?? ''}\u0000${item?.reason ?? ''}`))].sort().join('\n');

  /**
   * 登録したファイルの失敗・消失（files.skipped）があれば、初めて見た形なら採用せずに、最初に見た時刻から HOLD_SKIPPED_STEPS で読み直す。
   * 同じ形が最後の段まで続いたら受け入れて覚え（同じ形なら次から待たない）、今までどおり飛ばして採用する。true なら保留
   */
  function holdSkipped(worldId, skipped, transient) {
    const items = Array.isArray(skipped) ? skipped : [];
    if (!items.length) {
      acceptedShapes.delete(worldId);
      return false;
    }
    const shape = shapeOf(items);
    if (acceptedShapes.get(worldId) === shape) return false;
    const current = holdOf(worldId);
    // 形が変われば待ち直す
    if (current.skipped?.shape !== shape) current.skipped = { shape, since: now() };
    const elapsed = now() - current.skipped.since;
    const step = HOLD_SKIPPED_STEPS.find((ms) => ms > elapsed);
    if (step === undefined) {
      acceptedShapes.set(worldId, shape);
      return false;
    }
    scheduleReread(current.skipped.since + step - now(), transient);
    return true;
  }
  /** 見張りから読んだときの読めない失敗。最初の失敗から HOLD_UNREADABLE_STEPS で読み直し、3 回目の読み直しもだめなら false（今の扱い）。 */
  function holdUnreadable(worldId) {
    const current = holdOf(worldId);
    current.unreadable ??= { since: now() };
    const elapsed = now() - current.unreadable.since;
    const step = HOLD_UNREADABLE_STEPS.find((ms) => ms > elapsed);
    if (step === undefined) {
      current.unreadable = null;
      return false;
    }
    scheduleReread(current.unreadable.since + step - now(), true);
    return true;
  }

  // 読んだファイルを解析する（まだ採用しない）。読む前に消えていたファイルも、読めなかったファイルとして足す
  async function parseFiles(files, skipped) {
    state.error = '';
    state.progress = 'セーブを読み込み中…';
    emit();
    const result = await runImport(files, (message) => { state.progress = message; emit(); });
    return skipped.length ? { ...result, files: { ...result.files, skipped: [...skipped, ...(result.files?.skipped ?? [])] } } : result;
  }

  // 登録したファイルからワールドを読む。auto のときは、前回読んだセーブ一式から変わっていなければ読まない。
  // preview（登録の確認で読んだ結果）があり、そのワールドのファイルが変わっていなければ、それを使う。
  // epoch は呼び出した（キューに入れた）ときの linkEpoch。その後に削除・解除を求められていたら共有しない。
  // 見張りの対象は、一覧を読んだ後（読めなかったときも）に送り直す（同じ対象なら送らない）
  async function autoTask(options) {
    try {
      return await readAuto(options);
    } finally {
      updateWatch();
    }
  }

  // transient は見張りから読んだとき（refreshFromWatch とその読み直し）。保存の途中のファイルの置き換えで読めなくても、エラーを出さずに読み直す。
  // watchWorldId は見張りが知らせた（読み直しを保留した）ワールド。読み直しを保留したら 'held'（前の手元のデータ・表示・共有は残す）
  async function readAuto({ auto, preview = null, epoch = linkEpoch, transient = false, watchWorldId = '' }) {
    if (!state.auto.enabled) return 'skipped';
    await load();
    // 前のエラーは結果が出るまで残す（確かめるたびにエラーの行が消えてまた出ないように）
    const previous = state.auto.status;
    state.auto.status = 'checking';
    emit();
    let worlds;
    try {
      worlds = (await source.list()).filter((world) => !removing.has(world.id));
    } catch (error) {
      return stop('error', error.message, auto);
    }
    state.auto.worlds = worlds;
    if (!worlds.length) return stop('empty', 'セーブのファイルが登録されていません', auto);
    // 許可のないワールドがあると、どれを最後に遊んだか分からないので、黙って別のワールドを選ばない
    if (worlds.some((world) => world.status === 'permission')) {
      // 文はヘッダー・所持パル・設定の案内と同じ短い文（ui/owned-status.js の PERMISSION_TEXT。直し方は画面の permissionNotice が添える）
      return stop('permission', 'セーブを読む許可が必要です', auto);
    }
    const chosen = state.auto.worldId ? worlds.find((world) => world.id === state.auto.worldId) : null;
    // 見張りから読んだときに、選んだワールド（選んでいなければ、見張りが知らせたワールドか今のワールド）の必須のファイルが一時的に読めない
    //（保存の途中の置き換え）なら、別のワールドに替えたり止めたりせずに読み直す。読めないワールドは更新日時が分からず一覧の後ろに回るので、
    // 一覧の先頭では決めない（先頭の古いワールドに替わってしまう。Codex のレビュー）
    const suspects = chosen ? [chosen] : [watchWorldId, state.linkedWorldId].map((id) => worlds.find((item) => item.id === id)).filter(Boolean);
    const preferred = suspects.find((item) => ['missing', 'error'].includes(item.status));
    if (transient && preferred && holdUnreadable(preferred.id)) {
      state.auto.status = previous === 'checking' ? 'ready' : previous;
      return 'held';
    }
    // 選んでいなければ、読めるワールドのうち最後に遊んだもの（読めないワールドがあれば知らせる）
    const world = chosen || worlds.find((item) => item.status === 'ok') || worlds[0];
    const broken = chosen ? [] : worlds.filter((item) => item.status !== 'ok' && item.playedAt > world.playedAt);
    // 別のワールドに替わったら、前のワールドの保留は捨てる
    if (hold.worldId && hold.worldId !== world.id) clearHold();
    state.linkedWorldId = world.id;
    if (world.status !== 'ok') {
      // ホストか参加か判定できないときは、手元のデータで共有しない
      state.role = '';
      return stop('error', `${worldLabel(world)}を読めません（${world.error || '不明なエラー'}）。ファイルを登録し直してください`, auto);
    }
    state.auto.status = 'ready';
    state.auto.error = '';
    state.auto.stoppedAt = '';
    if (state.auto.worldId && !chosen) state.auto.error = '選んだワールドの登録がないため、最後に遊んだワールドを読みます';
    else if (broken.length) state.auto.error = `${broken.map(worldLabel).join('・')}を読めないため、読めるワールドのうち最後に遊んだワールドを読みます`;
    if (world.role === 'guest') {
      state.role = 'guest';
      clearHold();
      blockUpload();
      return 'guest';
    }
    state.role = 'host';
    const current = state.local;
    // このページで読み込んだときから変わっていなければ読まない（開き直した直後は、保存済みのデータがあっても一度読む）
    if (auto && current?.source === 'handles' && current.world.id === world.id && current.world.signature === world.signature && verifiedSignature === world.signature) {
      clearHold();
      state.uploadReady = epoch === linkEpoch;
      return 'unchanged';
    }
    // 読み終えるまで共有しない。同じワールドの新しいセーブなら再試行の段は残す（別のワールドに替わるなら全部消す）
    if (current?.world.id === world.id) holdUpload();
    else blockUpload();
    // 保留する（採用しない）ときは、このページで読んだ前の完全なデータの共有を続ける（holdUpload で取り消した予約は runAuto が戻す）
    const held = () => {
      if (current?.source === 'handles' && current.world.id === world.id && verifiedSignature === current.world.signature) state.uploadReady = epoch === linkEpoch;
      return 'held';
    };
    readingWorldId = world.id;
    try {
      if (preview?.snapshot && preview.worldId === world.id && preview.fileSignature === world.fileSignature) {
        // 登録の確定は、読めなかったファイルがあってもすぐ採用する（その形は受け入れたものとして覚える）
        const skipped = preview.snapshot.files?.skipped ?? [];
        if (skipped.length) acceptedShapes.set(world.id, shapeOf(skipped));
        else acceptedShapes.delete(world.id);
        await runImportTask([], { source: 'handles', world, snapshot: preview.snapshot, epoch });
      } else {
        let read;
        try {
          read = await source.read(world);
        } catch (error) {
          // 一覧を確かめた後に許可が外れたときも、許可のボタンを出す
          if (error.code === 'NEEDS_PERMISSION') return stop('permission', error.message, auto);
          if (transient && UNREADABLE_CODES.has(error.code) && holdUnreadable(world.id)) return held();
          // ゲームの保存中で読めなかっただけなら、自動のときは次の機会に読み直す
          if (!(auto && error.code === 'NOT_READABLE')) state.error = error.message;
          throw error;
        }
        // 読む前と後で印が違う: 保存の途中に読んだかもしれない（ファイルどうしが食い違う）ので採用せず、1 秒後に読み直す
        if (typeof read.fileSignature === 'string' && read.fileSignature !== world.fileSignature) {
          holdOf(world.id);
          scheduleReread(HOLD_CHANGED_DELAY, transient);
          return held();
        }
        let snapshot;
        try {
          snapshot = await parseFiles(read.files, read.skipped ?? []);
        } catch (error) {
          // Level.sav を読めない・解析できない
          if (transient && holdUnreadable(world.id)) return held();
          state.error = error.message;
          throw error;
        }
        if (holdSkipped(world.id, snapshot.files?.skipped, transient)) return held();
        await runImportTask([], { source: 'handles', world, snapshot, epoch });
      }
    } catch (error) {
      if (!auto) throw error;
      return 'error';
    } finally {
      readingWorldId = '';
    }
    clearHold();
    source.rename(world.id, { name: state.local.world.name, hostName: state.local.world.hostName }).catch(() => {});
    return 'imported';
  }

  function runAuto(options) {
    const epoch = linkEpoch;
    return serial(() => autoTask({ ...options, epoch })).then(async (result) => {
      // 読み直しの間に取り消した予約は、読み直せずに今のセーブのまま（unchanged）・保留（held）でも送り直す（share-upload・save-watch）
      if (result === 'imported' || ((result === 'unchanged' || result === 'held') && uploadOwed)) uploadLocal().catch(() => {});
      // shared: false のとき（定期の読み直し・見張りから）は共有を読み直さない
      if (options.shared !== false && ['guest', 'unchanged', 'imported', 'held'].includes(result)) {
        await fetchShared({ force: result === 'guest' && !options.auto });
      }
      return result;
    });
  }

  // ---- セーブのファイルの見張り（sync-fixes の save-watch） ----

  // 今のワールド（連携しているワールド。なければ一覧の先頭＝最後に遊んだワールド）
  const currentWatchWorld = () => state.linkedWorldId || state.auto.worlds[0]?.id || '';

  /**
   * 見張る対象。登録したワールドのうち、直近の list() で許可があった（status が 'permission' でない）もの。保存の途中などで一時的に読めない
   *（'missing'・'error'）ワールドも外さない（外すと、戻ったことに Worker が気づけず、画面のタイマー頼みになる。Codex のレビュー）。
   * 使うワールドを選んでいればそれだけ。
   * 今のワールドは登録した全ファイル、ほかのワールドは Level.sav・LocalData.sav だけ（最後に遊んだワールドが替わったことに気づくため）。
   * observe（Observer に渡す）は今のワールドのフォルダの直下のファイルだけ。Players・../GlobalPalStorage.sav は Worker の 5 秒ごとの確認だけ
   *（Players の中を見張ると、SaveSync が同期を受け取るときに止まり、ワールドが消えた状態になる。2026-10-17 の P0 の事故）。ほかのワールドも
   * 5 秒ごとの確認だけにする（気づくのが数秒遅れても困らない。Chrome が押さえるフォルダを今のワールドの 1 つにする）
   */
  function watchTargets() {
    if (!state.auto.enabled) return [];
    const worlds = state.auto.worlds.filter((world) => !removing.has(world.id) && source.has(world.id));
    const pinned = state.auto.worldId ? worlds.find((world) => world.id === state.auto.worldId) : null;
    const currentId = currentWatchWorld();
    return (pinned ? [pinned] : worlds).filter((world) => world.status && world.status !== 'permission').map((world) => {
      const record = source.get(world.id);
      const current = world.id === currentId;
      const files = Object.entries(record.files)
        .filter(([path]) => current || path === 'Level.sav' || path === 'LocalData.sav')
        .map(([path, handle]) => ({ path, handle, observe: current && observable(path) }));
      return { worldId: world.id, host: record.kind === 'host', current, revision: record.revision ?? 0, files };
    });
  }

  // 見張りの対象を送り直す（同じ対象〔ワールド ID・パス・revision・今のワールドか〕なら送らない）。自動が無効・対象なしなら止める
  function updateWatch() {
    const currentId = currentWatchWorld();
    if (currentId !== watchCurrent) {
      watchCurrent = currentId;
      state.watch.lastSave = null;
    }
    const targets = watchTargets();
    const key = JSON.stringify(targets.map((target) => [target.worldId, target.host, target.current, target.revision, target.files.map((file) => file.path)]));
    if (key === watchKey) return;
    watchKey = key;
    watchedIds = new Set(targets.map((target) => target.worldId));
    if (!targets.length) {
      watcher?.stop();
      state.watch = { mode: '', lastSave: null };
      return;
    }
    watcher ??= watch({
      onSettled,
      onMode: (mode) => {
        if (!watchedIds.size || state.watch.mode === mode) return;
        state.watch.mode = mode;
        emit();
      },
    });
    watcher.update(targets.map(({ worldId: id, host, files }) => ({ worldId: id, host, files })));
  }

  // 見張りが、一式を書き終えたワールドを知らせた
  function onSettled(message) {
    const id = typeof message?.worldId === 'string' ? message.worldId : '';
    if (!watchedIds.has(id)) return;
    const changed = Array.isArray(message.changed) ? message.changed : [];
    if (id === currentWatchWorld() && Number.isFinite(message.lastAt)) {
      const first = Number.isFinite(message.firstAt) ? message.firstAt : message.lastAt;
      state.watch.lastSave = { at: new Date(message.lastAt).toISOString(), files: changed.length, spanMs: Math.max(0, message.lastAt - first) };
      emit();
    }
    refreshFromWatch(id).catch(() => {});
  }

  /**
   * 見張りの知らせで読み直す（自動の読み込みが有効で、そのワールドが対象のときだけ）。共有は読み直さない。
   * 読み込み中・順番待ちがあれば、それが終わってから 1 回だけ読む（知らせが続けて来ても読み込みを積み上げない）
   */
  function refreshFromWatch(worldId) {
    if (!state.auto.enabled || !watchedIds.has(worldId)) return Promise.resolve('skipped');
    // まとめた知らせのうち最後のワールド（一時的に読めなければ、そのワールドで保留する）
    watchFollowId = worldId;
    if (watchFollow) return watchFollow;
    const run = () => {
      lastAuto = now();
      return runAuto({ auto: true, transient: true, watchWorldId: watchFollowId, shared: false });
    };
    if (!pending) return run();
    watchFollow = chain.then(() => {
      watchFollow = null;
      return state.auto.enabled ? run() : 'skipped';
    });
    return watchFollow;
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
    // 表のタブで約 10 秒ごと（app.js のタイマー）と、画面の表示・タブに戻ったときに呼ぶ。自動の読み込みが有効なら間隔を空けて新しいセーブを読み、
    // 共有も読み直す（SHARED_INTERVAL）
    async autoRefresh() {
      await load();
      if (state.auto.enabled && !state.busy && now() - lastAuto >= AUTO_INTERVAL) {
        lastAuto = now();
        return runAuto({ auto: true });
      }
      return fetchShared();
    },
    // タブが裏にある間に約 10 秒ごと（app.js のタイマー）に呼ぶ。配合牧場のタマゴを拾われる前に読めるよう、自動の読み込みが有効なときだけ
    // 新しいセーブを読む。共有の読み直しはしない（裏のタブでは共有を読まない。D26。表に戻ったら autoRefresh で読む）
    async pollAuto() {
      await load();
      if (!state.auto.enabled || state.busy || now() - lastAuto < AUTO_INTERVAL) return 'skipped';
      lastAuto = now();
      return runAuto({ auto: true, shared: false });
    },
    // セーブのファイルの見張り（save/watch.js）が、一式を書き終えたワールドを知らせたときに読み直す（タブが裏でも。sync-fixes の save-watch）
    refreshFromWatch,
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
        // 登録の確定で読んだセーブは、別の人が同じセーブを共有していても、悪くならなければ書き直してよい（GAS の force。share-upload）
        if (outcome.result === 'imported') uploadLocal({ commit: true }).catch(() => {});
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
      // 消すワールドの読み直しの保留・受け入れた失敗の形を捨て、見張りからも外す
      if (hold.worldId === worldId) clearHold();
      acceptedShapes.delete(worldId);
      updateWatch();
      return serial(async () => {
        try {
          await source.remove(worldId);
        } finally {
          removing.delete(worldId);
          updateWatch();
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
        // 登録を消した・自動の読み込みが無効になった（対象がなければ見張りを止める）
        updateWatch();
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
