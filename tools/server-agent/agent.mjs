// 常駐の組み立てと動き（docs/server/README.md の T5「動き」）。画面と同じストア（createStore・createOwnedStore・createAutoRegister・
// createPlayerMapStore）を Node で組み立て、ブラウザに頼る所（ファイルのハンドル・IndexedDB・localStorage・Worker・タイマー）だけを差し替える。
// - 対象のサーバーが動いている間（server-state.mjs。止まってから 60 秒の猶予を含む）だけ、ワールドを登録して読む（attach）。10 秒ごとに
//   Players を見直して増えたファイルを足し、5 分ごとに配合の全件を読み直す
// - 止まったら（detach）、見張り・読み直しと送信の予約・自動登録の判定を止める。最後の保存の送信は最大 60 秒だけ待ち、送れなくても止める。
//   登録は残すが、止まっている間は読まない（予約は動いたときまで預かる）
// - presence は常駐が自分で送る（owned.js の reportPresence も、ownedSince に載せる presence も使わない）。止まっている間も送る（playing false）
// - 認証の失敗は 30 分ごと、通信の失敗は 15 秒〜5 分の段でログインし直す。応答の env が設定と違えば、何も書かずに終了コード 2
//   （応答の env は gas-client.mjs が、失敗の応答を含めて送る 1 回ごとに確かめる）
// - 共有は、実際に送る 1 回ごと（createApi の自動の再送を含む）に、始めたときと同じ attach の間で、動いているか最後の送信の期限の前かを確かめる
// - <データ>\<env>\stop.request・accept.request を 2 秒ごとに見る（動いている常駐に、止める・古い系統を受け入れるを伝える）
// 新しいロジック（同一性・共有の中身・自動登録の判定）は持たない。web/js の core とストアの直しを使う。
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ApiError, buildRequest } from '../../web/js/api.js';
import { createStore, safeStorage } from '../../web/js/store.js';
import { createOwnedStore } from '../../web/js/owned.js';
import { createAutoRegister } from '../../web/js/auto-register.js';
import { createPlayerMapStore } from '../../web/js/player-map.js';
import { createHandleSource, readFiles, SERVER_SAVE_ID } from '../../web/js/save/handles.js';
import { readWorldFiles } from '../../web/js/save/import.js';
import { isPlaying } from '../../web/js/core/playing.js';
import { cleanPresenceInput, ownedSaveStamp } from '../../web/js/core/owned-shared.js';
import { memoryPersist } from './kv-storage.mjs';
import { fileHandle, fileHandles } from './fs-handles.mjs';
import { listWorldFiles } from './discover.mjs';
import { createLocalWatchClient } from './watch-client.mjs';
import { createLineageGuard, lineageError, lineageOfSnapshot, LINEAGE_BLOCKED, LINEAGE_PENDING } from './lineage-guard.mjs';
import { ENV_MISMATCH } from './gas-client.mjs';

/** GAS が受ける共有の本文の上限（gas/Main.js の MAX_UPLOAD_CHARS。test/server-agent/agent.test.js で照らす）。上限は変えない */
export const GAS_MAX_UPLOAD_CHARS = 4 * 1024 * 1024;
export const TICK_MS = 10_000;
export const PRESENCE_MS = 60_000;
export const REQUEST_POLL_MS = 2_000;
export const REFRESH_MS = 5 * 60_000;
export const FINAL_SEND_MS = 60_000;
export const AUTH_RETRY_MS = 30 * 60_000;
export const LOGIN_RETRY_STEPS = Object.freeze([15_000, 30_000, 60_000, 120_000, 300_000]);
/** 止まっている間に共有を求められたときの code（owned.js の再試行の段に入らない） */
export const AGENT_STOPPED = 'AGENT_STOPPED';
/** 今の attach より前（前に動いていた間）に読んだセーブの共有を求められたときの code（同じく再試行の段に入らない。読み直したセーブを送る） */
export const AGENT_STALE = 'AGENT_STALE';
// presence を見直す間隔と、間隔より少し早く来た回も送る幅（owned.js の PRESENCE_SLACK と同じ）
const PRESENCE_CHECK_MS = 10_000;
const PRESENCE_SLACK_MS = 5_000;
// 古い GAS（presence を知らない）と分かってから試し直すまで
const UNSUPPORTED_RETRY_MS = 60 * 60_000;
// 判定待ちのまま送れなかったセーブを、もう一度判定する間隔
const LINEAGE_RECHECK_MS = 30_000;
// 受け入れの要求で、公開の値を読めない・セーブを読めないときに試し直す間隔
const ACCEPT_RETRY_MS = 30_000;
// 受け入れの要求（accept.request に書いた時刻）を使う長さ。これより古い・時刻の読めない要求は捨てる（前の起動の残り・試し直しの間に残った
// 要求で、意図しない時点のセーブを受け入れないため）
export const ACCEPT_REQUEST_MAX_AGE_MS = 10 * 60_000;
// 止めるときに、送っている途中の共有を待つ長さ
const SHUTDOWN_WAIT_MS = 15_000;
// 今の attach の間に読んだセーブの保存時刻を残す数
const FRESH_MAX = 16;
// 上限を超えたことをログに出し直す間隔（30 秒ごとの保存のたびには出さない）
const TOO_LARGE_LOG_MS = 10 * 60_000;
// ログインの失敗のうち、間を短く試し直すもの（通信・混雑・サーバーの一時的なエラー）。ほか（AUTH・USER_NOT_FOUND など）は 30 分ごと
const NETWORK_CODES = new Set(['TIMEOUT', 'CONNECTION', 'BUSY', 'INTERNAL', 'RESPONSE']);
// 最後の送信で送り直す失敗（owned.js の UPLOAD_RETRY_CODES と、古い系統の守りの判定待ち）
const RETRY_CODES = new Set([...NETWORK_CODES, LINEAGE_PENDING]);
// ページと PC の ID の形（core/owned-shared.js の cleanPresenceInput と同じ）
const PRESENCE_ID = /^[A-Za-z0-9_-]{8,64}$/;
const READ_STOPPED = new Set(['error', 'permission', 'empty']);
const TIMED_OUT = Symbol('timed-out');

const randomId = () => randomBytes(16).toString('hex');

/** 共有の本文の文字数（GAS の body.length と同じ UTF-16 の数。パスワードの分も入る。値は外に出さない） */
export function uploadChars(passcode, input) {
  return JSON.stringify(buildRequest('ownedUpload', passcode, input)).length;
}

/**
 * api（createApi の形）を包み、ownedUpload の本文の文字数を測る。GAS の上限を超えるなら送らずに TOO_LARGE にする（owned.js は送り直さない）。
 * onMeasure({ chars, limit, rows, refused }) は測るたびに呼ぶ
 */
export function withUploadLimit(api, { limit = GAS_MAX_UPLOAD_CHARS, onMeasure = () => {} } = {}) {
  return {
    async request(action, passcode, input) {
      if (action === 'ownedUpload') {
        const chars = uploadChars(passcode, input);
        const refused = chars > limit;
        onMeasure({ chars, limit, rows: Array.isArray(input?.rows) ? input.rows.length : 0, refused });
        if (refused) throw new ApiError('TOO_LARGE');
      }
      return api.request(action, passcode, input);
    },
  };
}

/** localStorage の形のメモリだけの保存先（ストアのログインの情報。パスワードを KV のファイルに置かない） */
function memoryStorage() {
  const map = new Map();
  return { getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key) };
}

/**
 * 見張りの門。開いている間だけ、owned.js が送る対象を見張りに渡す。閉じたら見張りを止め（update([])）、開いたら最後の対象で張り直す
 *（owned.js は同じ対象なら送り直さないため）
 */
function watchGate(factory) {
  let client = null;
  let targets = [];
  let open = false;
  return {
    factory(callbacks) {
      client = factory({
        onSettled: (message) => { if (open) callbacks.onSettled(message); },
        onMode: (mode) => callbacks.onMode(mode),
      });
      return {
        update(next) {
          targets = Array.isArray(next) ? next : [];
          if (open) client.update(targets);
        },
        stop() {
          targets = [];
          client.update([]);
        },
      };
    },
    open() {
      open = true;
      if (client && targets.length) client.update(targets);
    },
    close() {
      open = false;
      client?.update([]);
    },
  };
}

/**
 * @param {object} options
 * @param {object} options.config loadConfig（config.mjs）の結果。passcode は列挙しない項目
 * @param {object} options.world discoverWorld（discover.mjs）の見つけたワールド（worldId・worldDir）
 * @param {{ getItem, setItem, removeItem, flush?: () => Promise<void> }} options.storage KV（kv-storage.mjs）
 * @param {{ debug, info, warn, error }} options.log 常駐のログ（log.mjs。ID・パス・IP は伏せる。プレイヤー名と GAS の応答の中身は渡さない）
 * @param {{ check: () => Promise<object> }} options.monitor サーバーの稼働（server-state.mjs の createServerMonitor）
 * @param {object} options.client GAS との通信（gas-client.mjs の createGasClient。テストは開発用 API の transport）。送る 1 回ごとの確かめ（setGate）と
 *   応答の env の違い（onMismatch）に使う
 * @param {{ request: Function }} [options.api] 送る api（既定は client.api。--dry-run は書き込みを記録だけにした api〔dry-run.mjs〕）
 * @param {Function} [options.runImport] セーブの解析（既定は readWorldFiles をこのスレッドで）
 * @param {Function} [options.watch] セーブの見張り（既定は watch-client.mjs。createOwnedStore の watch の形）
 * @param {Function} [options.listFiles] ワールドのファイルの一覧（discover.mjs の listWorldFiles）
 * @param {boolean} [options.forceHost] サーバーが止まっていても読む（--once --force-host。test 環境だけ）
 * @param {number} [options.uploadLimit] 共有の本文の上限（テストで小さくする）
 */
export function createAgent({
  config, world, storage, log, monitor, client, api = client.api,
  runImport = (files, onProgress) => readWorldFiles(files, { onProgress }),
  watch = createLocalWatchClient, listFiles = listWorldFiles, fs = fsPromises,
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
  namespace = 'pal-note', pageId = randomId(), forceHost = false, uploadLimit = GAS_MAX_UPLOAD_CHARS,
}) {
  const worldId = world.worldId;
  const kv = safeStorage(storage);
  const sleep = (ms) => new Promise((resolve) => setTimer(resolve, Math.max(0, ms)));

  // ---- GAS ----

  // 応答の env が設定と違えば（ログインでも、その後のどの応答でも。失敗の応答も）、それ以後は何も送らずに終了コード 2 で止める（gas-client.mjs）
  let envMismatch = false;
  client.onMismatch((got) => {
    envMismatch = true;
    log.error('env-mismatch', { expected: config.env, got, reason: '応答の環境が設定と違うため、それ以後は何も書かずに止めます' });
    requestStop(2);
    // パスワードをメモリからも外す（止めた後なので、ログインし直しの予約はしない）
    store.logout();
  });
  let tooLargeLoggedAt = -Infinity;
  const measured = { chars: 0, rows: 0, refused: false };
  const limitedApi = withUploadLimit(api, {
    limit: uploadLimit,
    onMeasure: (result) => {
      Object.assign(measured, result);
      if (!result.refused) {
        log.debug('upload-size', { chars: result.chars, limit: result.limit });
        return;
      }
      if (now() - tooLargeLoggedAt < TOO_LARGE_LOG_MS) return;
      tooLargeLoggedAt = now();
      log.warn('upload-too-large', { chars: result.chars, limit: result.limit, pals: result.rows, reason: 'GAS の本文の上限を超えるため共有しません' });
    },
  });
  // ログインの情報はメモリだけ（パスワードを KV に置かない。起動のたびに設定の ID でログインする）
  const store = createStore({ api: limitedApi, storage: safeStorage(memoryStorage()), namespace, now });
  // ログイン中で、応答の env が設定と同じときだけ環境を返す（違う環境の共有・自動登録・presence を送らない）
  const scope = () => {
    const s = store.state;
    return s.passcode && s.userId && s.env === config.env ? s.env : '';
  };
  const loggedIn = () => Boolean(scope());
  const call = (action, input) => store.call(action, input);

  // 読んでいる（attached）か、止まった直後の最後の送信の間（finalWindow。期限 finalDeadline まで）だけ共有する
  let attached = false;
  let finalWindow = false;
  let finalDeadline = 0;
  // attach の世代。attach したとき・最後の送信の間が終わったときに進める。共有の送信と古い系統の判定は、始めたときの世代のままのときだけ続ける
  //（最後の送信の期限の後・次の attach の後に、前の間に始めた送信の再送・判定の結果を使わないため）
  let generation = 0;
  const sendWindow = () => !stopped && (attached || (finalWindow && now() < finalDeadline));
  // 共有の送信を始めたときの世代（AsyncLocalStorage で、createApi の自動の再送を含む送る 1 回ごとの確かめ〔sendRefusal〕まで運ぶ）
  const uploadTicket = new AsyncLocalStorage();
  // 今の attach の間（止まった直後の最後の送信を含む）に読んだセーブの保存時刻。attach のたびに空にする。ここにないセーブ（前に動いていた間に
  // 読んだ手元のデータ）は、古い系統の判定にも共有にも自動登録にも使わない（A→B→A の引き継ぎで、B の続きを受け取る前の古いデータで止めたり
  // 送ったりしないため。止まっている間と同じ扱い）
  const freshStamps = new Set();
  const isFresh = (stamp) => Boolean(stamp) && freshStamps.has(stamp);
  // 動いている間は 30 秒ごとに増えるので、新しい方の FRESH_MAX だけ残す（送るのはいつも手元の最新のセーブ）
  const markFresh = (stamp) => {
    freshStamps.delete(stamp);
    freshStamps.add(stamp);
    while (freshStamps.size > FRESH_MAX) freshStamps.delete(freshStamps.values().next().value);
  };
  const refusalOf = (code, message) => Object.assign(new Error(message), { code });
  // 共有を断る理由（送ってよければ null）。古い系統の判定の前と、送る直前（判定を待つ間に止まった・最後の送信の期限が過ぎた・次の attach に
  // 替わった送信を送らないため）と、実際に送る 1 回ごと（sendRefusal）で確かめる
  function uploadRefusal(input) {
    if (!sendWindow()) return refusalOf(AGENT_STOPPED, 'サーバーが止まっているため共有しません');
    if (!isFresh(ownedSaveStamp(input?.world?.saveStamp))) {
      return refusalOf(AGENT_STALE, 'サーバーが動く前に読んだセーブのため共有しません（読み直してから送ります）');
    }
    return null;
  }
  // 実際に送る 1 回ごと（createApi の自動の再送を含む。gas-client.mjs の gate）の確かめ。止めた後は何も送らない。共有は、始めたときと同じ
  // attach の世代で、動いているか最後の送信の期限の前で、今の attach の間に読んだ判定済みのセーブのときだけ送る
  function sendRefusal(request) {
    if (stopped) return refusalOf(AGENT_STOPPED, '常駐を止めたため送りません');
    if (request?.action !== 'ownedUpload') return null;
    if (uploadTicket.getStore()?.generation !== generation) {
      return refusalOf(AGENT_STALE, '前に動いていた間に始めた共有のため送りません（読み直してから送ります）');
    }
    const refusal = uploadRefusal(request);
    if (refusal) return refusal;
    const stamp = ownedSaveStamp(request.world?.saveStamp);
    if (guard.paused(worldId, stamp)) return lineageError(guard.status(worldId, stamp).state === 'blocked' ? LINEAGE_BLOCKED : LINEAGE_PENDING);
    return null;
  }
  client.setGate(sendRefusal);

  // owned.js が ownedSince に載せる presence は外す（presence は常駐が自分で送る）
  const base = {
    scope,
    userId: () => store.state.userId,
    endpoint: () => config.apiUrl,
    request(action, input) {
      if (action === 'ownedSince' && input && typeof input === 'object' && 'presence' in input) {
        const { presence, ...rest } = input;
        return call(action, rest);
      }
      if (action === 'ownedUpload') {
        const refusal = uploadRefusal(input);
        if (refusal) return Promise.reject(refusal);
      }
      return call(action, input);
    },
  };

  let autoRegister = null;
  const guard = createLineageGuard({
    server: base, storage: kv, namespace, log, onAccept: (id, env) => autoRegister?.forgetFarms(id, env),
    // 判定は、送ってよい間の同じ attach の世代のときだけ状態に残す（最後の送信の期限の後・次の attach の後に、前に始めた判定の結果で止めない）
    session: () => (sendWindow() ? generation : null),
  });

  let lastUploadError = '';
  const server = {
    ...guard.server,
    async request(action, input) {
      if (action !== 'ownedUpload') return guard.server.request(action, input);
      const refusal = uploadRefusal(input);
      if (refusal) {
        lastUploadError = refusal.code;
        throw refusal;
      }
      try {
        const response = await uploadTicket.run({ generation }, () => guard.server.request(action, input));
        lastUploadError = '';
        return response;
      } catch (error) {
        lastUploadError = error?.code || 'ERROR';
        throw error;
      }
    },
  };

  // ---- 所持パル（画面と同じストア） ----

  const source = createHandleSource({ persist: memoryPersist(), key: `${namespace}.owned.handles` });
  // owned.js の予約（読み直し・送り直し・行の数の読み直し）。止まっている間に来た予約は、次に動いたときまで預かる（owned.js の予約の印を
  // 残したまま捨てると、動いた後の予約が通らないため）
  const parked = new Set();
  // 置いている予約（預かっている分を含む。止めるときに全部消す）
  const scheduled = new Set();
  const schedule = (fn, ms) => {
    const handle = { fn, timer: null };
    scheduled.add(handle);
    handle.timer = setTimer(() => {
      handle.timer = null;
      if (!attached) {
        parked.add(handle);
        return;
      }
      scheduled.delete(handle);
      fn();
    }, ms);
    return handle;
  };
  const cancel = (handle) => {
    if (!handle) return;
    if (handle.timer !== null) clearTimer(handle.timer);
    handle.timer = null;
    parked.delete(handle);
    scheduled.delete(handle);
  };
  const gate = watchGate(watch);
  const owned = createOwnedStore({
    persist: memoryPersist(), settings: kv, namespace, runImport, handles: source, now, server,
    schedule, cancel, hidden: () => false, watch: gate.factory, pageId, resident: true,
  });

  const playerMaps = createPlayerMapStore({
    // 書いた人の ID（playerMapSet の userId）はログイン中の ID
    request: (action, input) => call(action, { userId: store.state.userId, ...input }),
    scope, endpoint: () => config.apiUrl, storage: kv, namespace, now,
  });
  autoRegister = config.autoRegister === false ? null : createAutoRegister({
    store, owned, storage: kv, namespace, now, playerMaps,
    // 止まっている間・前に動いていた間に読んだセーブ・古い系統の判定が済むまで・止めている間は、候補を取り込まず登録も送らない
    paused: (id, stamp) => !attached || !isFresh(ownedSaveStamp(stamp)) || guard.paused(id, stamp),
    toast: (message) => log.info('auto-register', { message }),
    onNotice: () => noteNotices(),
  });

  // ---- 状態の変化とログ ----

  let lastScope = '';
  let loginRetryAt = 0;
  let loginStep = 0;
  let lastRefresh = -Infinity;
  // ログイン・環境が変わったら、共有の保存先を切り替える（app.js の store.subscribe と同じ）。ログイン中に外れたのは認証の失敗（store.js が
  // AUTH でログアウトする）なので、30 分後にログインし直す
  function syncScope() {
    const next = scope();
    if (next !== lastScope) {
      const before = lastScope;
      lastScope = next;
      if (before && !next && !stopped) {
        loginRetryAt = now() + AUTH_RETRY_MS;
        log.warn('logged-out', { retryMinutes: AUTH_RETRY_MS / 60_000 });
      }
      owned.scopeChanged().catch(() => {});
    }
    autoRegister?.evaluate();
  }
  store.subscribe(syncScope);

  let readKey = '';
  let uploadKey = '';
  let uploadSeen = '';
  let localKey = '';
  function noteOwned() {
    const o = owned.state;
    const key = `${o.auto.status}|${o.auto.error}|${o.error}`;
    if (key !== readKey) {
      readKey = key;
      if (READ_STOPPED.has(o.auto.status) || o.error) log.warn('read-failed', { status: o.auto.status, error: o.auto.error || o.error });
    }
    const local = o.local;
    if (local && local.importedAt !== localKey) {
      localKey = local.importedAt;
      const players = Array.isArray(local.snapshot?.players) ? local.snapshot.players : [];
      log.debug('read', {
        pals: local.snapshot?.pals?.length ?? 0, players: players.length, online: players.filter((player) => player?.online === true).length,
        day: local.snapshot?.world?.inGameDay ?? 0,
      });
    }
    // 共有の結果は、種類が変わったときだけ info・warn に出す（30 秒ごとの同じ結果・同じ失敗は debug）
    const upload = o.upload;
    const next = `${upload.status}|${upload.result}|${upload.error}`;
    if (!upload.status || upload.status === 'sending' || `${upload.signature}|${next}` === uploadSeen) return;
    uploadSeen = `${upload.signature}|${next}`;
    const fields = { status: upload.status, result: upload.result || '', ...(upload.error ? { error: upload.error } : {}) };
    if (next === uploadKey) log.debug('upload', fields);
    else if (upload.status === 'error') log.warn('upload', fields);
    else log.info('upload', fields);
    uploadKey = next;
  }
  // 読み込んだ手元のデータ（読むたびに別のオブジェクト）。attach の間に読んだものの保存時刻を freshStamps に足す
  let seenLocal = null;
  owned.subscribe(() => {
    const local = owned.state.local;
    if (local && local !== seenLocal) {
      seenLocal = local;
      const stamp = ownedSaveStamp(local.snapshot?.world?.savedAtTicks);
      if ((attached || finalWindow) && local.world.id === worldId && stamp) markFresh(stamp);
    }
    autoRegister?.evaluate();
    noteOwned();
  });
  // 判定が済んだ・受け入れた: 自動登録をやり直す。受け入れたら、読んでいるセーブを送り直す（今の attach の間に読んだものだけ。uploadRefusal）
  guard.subscribe((event) => {
    autoRegister?.evaluate();
    if (event.type === 'accepted' && attached) owned.uploadLocal({ force: true }).catch(() => {});
  });

  // 自動登録の通知の数（件名ごと。本文にはプレイヤー名が入るので出さない）
  let noticeKey = '';
  function noteNotices() {
    if (!autoRegister) return;
    const counts = {};
    for (const notice of autoRegister.notices()) counts[notice.title] = (counts[notice.title] ?? 0) + 1;
    const key = JSON.stringify(counts);
    if (key === noticeKey) return;
    noticeKey = key;
    log.info('auto-register-notices', { counts });
  }

  // ---- ログイン ----

  // 'ok'・'auth'（30 分後に試し直す）・'network'（15 秒〜5 分の段）・'env'（応答の環境が設定と違う。何も書かずに止める）・'config'
  async function login() {
    if (!config.userId || !config.passcode) return 'config';
    try {
      await store.login(config.userId, config.passcode);
    } catch (error) {
      const code = error?.code || 'ERROR';
      // 応答の環境が設定と違う（withEnvCheck がログに出して止めている）
      if (code === ENV_MISMATCH) return 'env';
      if (NETWORK_CODES.has(code)) {
        const delay = LOGIN_RETRY_STEPS[Math.min(loginStep, LOGIN_RETRY_STEPS.length - 1)];
        loginStep++;
        loginRetryAt = now() + delay;
        log.warn('login-failed', { code, retrySeconds: delay / 1000 });
        return 'network';
      }
      loginStep = 0;
      loginRetryAt = now() + AUTH_RETRY_MS;
      log.warn('login-failed', {
        code, retryMinutes: AUTH_RETRY_MS / 60_000,
        ...(code === 'USER_NOT_FOUND' ? { hint: '常駐の ID がありません。--signup で作ってください' } : {}),
      });
      return 'auth';
    }
    loginStep = 0;
    loginRetryAt = 0;
    lastRefresh = now();
    log.info('logged-in', { env: store.state.env });
    syncScope();
    return 'ok';
  }

  async function ensureLogin() {
    if (loggedIn()) return 'ok';
    if (now() < loginRetryAt) return 'waiting';
    const result = await login();
    if (result === 'env' || result === 'config') requestStop(2);
    return result;
  }

  // ---- 読み込み（attach・detach） ----

  let lastServer = null;
  let reading = null;
  let attachWaitLogged = false;

  async function attach() {
    const files = await listFiles(world.worldDir);
    if (!files['Level.sav'] || !files['LevelMeta.sav']) {
      if (!attachWaitLogged) log.warn('attach-waiting', { reason: 'Level.sav・LevelMeta.sav がまだありません' });
      attachWaitLogged = true;
      return false;
    }
    attachWaitLogged = false;
    // 名前は設定の worldName があれば明示する（サーバーのセーブの名前は汎用の Autosave_W なので、なければ前の共有の名前。owned.js の worldNameOf）
    await source.commit({ worldId, steamId: SERVER_SAVE_ID, files: fileHandles(files), name: config.worldName, nameSet: Boolean(config.worldName) });
    // 前に動いていた間に読んだセーブは使わない（読み直したものから使う）
    freshStamps.clear();
    generation++;
    attached = true;
    log.info('attached', { worldId, files: Object.keys(files).length });
    gate.open();
    // 止まっている間に預かった予約を、動いたいま実行する
    for (const handle of [...parked]) {
      parked.delete(handle);
      scheduled.delete(handle);
      handle.fn();
    }
    reading = owned.refreshAuto({ auto: true, enable: true }).catch(() => 'error').finally(() => { reading = null; });
    return true;
  }

  // 10 秒ごと: Players に増えたファイルを登録に足し、読み直す（新しく参加した人。消えたファイルは owned.js の保留に任せる）
  async function addNewFiles() {
    const files = await listFiles(world.worldDir);
    const known = source.get(worldId)?.files ?? {};
    const added = Object.keys(files).filter((rel) => !Object.hasOwn(known, rel));
    if (!added.length) return 0;
    await source.commit({ worldId, steamId: SERVER_SAVE_ID, files: fileHandles(Object.fromEntries(added.map((rel) => [rel, files[rel]]))) });
    log.info('files-added', { files: added.length });
    owned.refreshFromWatch(worldId).catch(() => {});
    return added.length;
  }

  const localStamp = () => ownedSaveStamp(owned.state.local?.snapshot?.world?.savedAtTicks);
  // 今の手元のセーブを送り終えたか（自分の共有が載った・同じセーブを共有済み・もっと新しい共有がある）
  function sentLatest() {
    const local = owned.state.local;
    const upload = owned.state.upload;
    return Boolean(local) && upload.worldId === local.world.id && upload.signature === (local.world.signature ?? '')
      && ['done', 'same', 'stale'].includes(upload.status);
  }
  // promise か期限の早い方（期限なら TIMED_OUT）
  function untilDeadline(promise, deadline) {
    let timer = null;
    const limit = new Promise((resolve) => { timer = setTimer(() => resolve(TIMED_OUT), Math.max(0, deadline - now())); });
    return Promise.race([promise, limit]).finally(() => clearTimer(timer));
  }

  // 止まった後の最後の送信（期限まで）。送り直してよい失敗なら 15 秒おきに試す。結果の種類を返す
  async function finalSend(deadline) {
    while (owned.state.busy && now() < deadline) await sleep(200);
    for (;;) {
      if (sentLatest()) return 'sent';
      if (owned.state.local?.world.id !== worldId) return 'none';
      if (now() >= deadline) return 'timeout';
      const result = await untilDeadline(owned.uploadLocal({ force: true }).catch(() => 'error'), deadline);
      if (sentLatest()) return 'sent';
      if (result === TIMED_OUT) return 'timeout';
      if (result === 'skipped') return 'skipped';
      if (!RETRY_CODES.has(lastUploadError)) return lastUploadError ? `error:${lastUploadError}` : String(result);
      await sleep(Math.min(15_000, deadline - now()));
    }
  }

  async function detach(reason) {
    if (!attached) return;
    finalDeadline = now() + FINAL_SEND_MS;
    finalWindow = true;
    attached = false;
    gate.close();
    log.info('detaching', { reason });
    try {
      const result = await finalSend(finalDeadline);
      log.info('detached', { lastUpload: result });
    } finally {
      finalWindow = false;
      generation++;
    }
  }

  // 判定待ちのまま送れなかったセーブ（公開の値を読めなかった）を、読めるようになったら判定して送る（owned.js はこの失敗を送り直さない）。
  // 前に動いていた間に読んだセーブは判定しない（attach の後の読み込みを待つ）
  let lineageCheckedAt = -Infinity;
  async function recheckLineage() {
    const local = owned.state.local;
    const stamp = localStamp();
    const upload = owned.state.upload;
    if (!local || !isFresh(stamp) || !loggedIn() || lastUploadError !== LINEAGE_PENDING || upload.status !== 'error' || upload.stamp !== stamp) return;
    if (now() - lineageCheckedAt < LINEAGE_RECHECK_MS) return;
    lineageCheckedAt = now();
    if (await guard.check(worldId, lineageOfSnapshot(local.snapshot)) === 'ok') await owned.uploadLocal({ force: true }).catch(() => {});
  }

  // ---- 10 秒ごと ----

  let ticking = false;
  let serverKey = '';
  async function tick() {
    if (stopped || ticking) return;
    ticking = true;
    try {
      await ensureLogin();
      if (stopped) return;
      const state = await monitor.check();
      lastServer = state;
      const key = `${state.state}|${state.source}`;
      if (key !== serverKey) {
        serverKey = key;
        log.info('server-state', { state: state.state, source: state.source, ...(state.reasons?.length ? { reasons: state.reasons } : {}) });
      }
      const want = forceHost || state.active;
      if (want && !attached) await attach();
      else if (!want && attached) await detach(state.state);
      if (!attached || stopped) return;
      await addNewFiles();
      if (loggedIn() && now() - lastRefresh >= REFRESH_MS) {
        lastRefresh = now();
        store.refresh().catch(() => {});
      }
      await recheckLineage();
    } catch (error) {
      log.error('tick-failed', { error });
    } finally {
      ticking = false;
    }
  }

  // ---- presence（常駐が自分で送る） ----

  const deviceKey = `${namespace}.owned.device.${worldId}`;
  function deviceId() {
    const stored = kv.get(deviceKey);
    if (typeof stored === 'string' && PRESENCE_ID.test(stored)) return stored;
    const created = randomId();
    kv.set(deviceKey, created);
    return created;
  }

  /** 送る presence（cleanPresenceInput の形）。playing はサーバーが動いていて保存が続いているか、canShare は読めているか */
  function presenceValue() {
    const o = owned.state;
    const running = lastServer?.state === 'running' || forceHost;
    const playing = attached && running && isPlaying(o.play, { worldId, role: 'host' }, now());
    const canShare = attached && o.local?.world.id === worldId && o.role === 'host' && !READ_STOPPED.has(o.auto.status);
    return cleanPresenceInput({ pageId, device: deviceId(), user: store.state.userId, role: 'host', playing, canShare, resident: true });
  }

  let presenceSent = { key: '', at: -Infinity };
  let presenceSending = false;
  let presenceUnsupportedUntil = -Infinity;
  /**
   * presence を送る（60 秒ごと。playing・canShare が変わったら間隔によらず）。ログインしていないときは送らない。失敗しても例外にしない
   * @returns {Promise<'sent'|'skipped'|'error'>}
   */
  async function sendPresence({ force = false } = {}) {
    if (!loggedIn() || presenceSending || now() < presenceUnsupportedUntil) return 'skipped';
    const presence = presenceValue();
    if (!presence) return 'skipped';
    const key = JSON.stringify([scope(), presence.playing, presence.canShare]);
    if (!force && key === presenceSent.key && now() - presenceSent.at < PRESENCE_MS - PRESENCE_SLACK_MS) return 'skipped';
    presenceSent = { key, at: now() };
    presenceSending = true;
    try {
      await base.request('presence', { worldId, presence });
      log.debug('presence', { playing: presence.playing, canShare: presence.canShare });
      return 'sent';
    } catch (error) {
      if (error?.code === 'BAD_ACTION') presenceUnsupportedUntil = now() + UNSUPPORTED_RETRY_MS;
      log.debug('presence-failed', { code: error?.code || 'ERROR' });
      return 'error';
    } finally {
      presenceSending = false;
    }
  }

  // ---- 受け入れ（--accept-world） ----

  // 今のセーブ（Level.sav）を読み、古い系統の守りが比べる値にする
  async function readSaveValues() {
    const files = await listFiles(world.worldDir);
    if (!files['Level.sav']) throw Object.assign(new Error('Level.sav が見つかりません'), { code: 'MISSING' });
    const read = await readFiles({ 'Level.sav': fileHandle(files['Level.sav']) }, ['Level.sav'], ['Level.sav']);
    return lineageOfSnapshot(await runImport(read.files, () => {}));
  }

  /**
   * 古い系統の受け入れ。そのときのセーブの値と、GAS から読んだ公開の世代の uploadedAt を基準にする（lineage-guard.mjs の accept）。
   * 動いていて今の attach の間に読んだセーブがあれば、そのセーブの値にする（受け入れの後に送るのはそのセーブなので。ディスクの次の保存を
   * 基準にすると、まだ読んでいない手元のセーブがそれより古く、受け入れの直後にまた止まる）。なければ今の Level.sav を読む
   * @returns {Promise<{ ok: boolean, retry: boolean, code?: string }>} retry は、読めるようになってから試し直すもの
   */
  async function acceptWorld() {
    if ((await ensureLogin()) !== 'ok') {
      log.warn('accept-failed', { code: 'NOT_READY', reason: 'ログインできていません' });
      return { ok: false, retry: true, code: 'NOT_READY' };
    }
    const local = owned.state.local;
    let values = attached && local?.world.id === worldId && isFresh(localStamp()) ? lineageOfSnapshot(local.snapshot) : null;
    try {
      values ??= await readSaveValues();
    } catch (error) {
      log.warn('accept-failed', { code: error?.code || 'SAVE_UNREADABLE', reason: 'セーブを読めません' });
      return { ok: false, retry: true, code: error?.code || 'SAVE_UNREADABLE' };
    }
    try {
      await guard.accept(worldId, values);
      log.info('accepted', { worldId });
      return { ok: true, retry: false };
    } catch (error) {
      log.warn('accept-failed', { code: error?.code || 'ERROR', reason: error?.message ?? '' });
      return { ok: false, retry: ['UNREADABLE', 'NOT_READY'].includes(error?.code), code: error?.code || 'ERROR' };
    }
  }

  // ---- 要求のファイル（2 秒ごと） ----

  const requestFile = (name) => path.join(config.envDir, name);
  const exists = async (file) => {
    try { await fs.access(file); return true; } catch { return false; }
  };
  let acceptRetryAt = -Infinity;
  async function checkRequests() {
    if (stopped) return;
    if (await exists(requestFile('stop.request'))) {
      await fs.unlink(requestFile('stop.request')).catch(() => {});
      log.info('stop-requested', {});
      requestStop(0);
      return;
    }
    if (now() < acceptRetryAt || !(await exists(requestFile('accept.request')))) return;
    const written = Date.parse(String(await fs.readFile(requestFile('accept.request'), 'utf8').catch(() => '')).trim());
    if (!Number.isFinite(written) || Math.abs(now() - written) > ACCEPT_REQUEST_MAX_AGE_MS) {
      await fs.unlink(requestFile('accept.request')).catch(() => {});
      log.warn('accept-expired', { reason: '受け入れの要求が古いか、書いた時刻が読めないため捨てました（受け入れるなら、もう一度 --accept-world を実行してください）' });
      return;
    }
    const outcome = await acceptWorld();
    if (outcome.retry) acceptRetryAt = now() + ACCEPT_RETRY_MS;
    else await fs.unlink(requestFile('accept.request')).catch(() => {});
  }

  // ---- 動かす・止める ----

  let stopped = false;
  let stopCode = 0;
  let closing = null;
  let resolveDone = () => {};
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const loops = new Set();

  function loop(fn, ms) {
    const entry = { timer: null };
    loops.add(entry);
    const run = async () => {
      entry.timer = null;
      if (stopped) return;
      try { await fn(); } catch (error) { log.error('loop-failed', { error }); }
      if (!stopped) entry.timer = setTimer(run, ms);
    };
    run();
  }

  /**
   * 見張り・予約・ループを止め、送っている途中の共有を少し待ち、KV を書き出す
   * @returns {Promise<boolean>} KV を全部書けたか（false なら、止めた状態・受け入れの基準・候補の記録の変更を失う）
   */
  function close() {
    closing ??= (async () => {
      stopped = true;
      for (const entry of loops) if (entry.timer !== null) clearTimer(entry.timer);
      loops.clear();
      attached = false;
      gate.close();
      for (const handle of [...scheduled]) cancel(handle);
      const end = now() + SHUTDOWN_WAIT_MS;
      while (owned.state.upload.status === 'sending' && now() < end) await sleep(200);
      const saved = (await storage.flush?.()) !== false;
      if (!saved) log.error('kv-unsaved', { reason: '常駐の状態（state.json）を保存できませんでした。データのフォルダに書けるか確かめてください' });
      return saved;
    })();
    return closing;
  }

  // 止める。KV を書けなければ、正常な終了（0）にしない（2。run-agent.ps1 は起動し直さない。止める求めに従ったまま、ログに理由を残す）
  function requestStop(code = 0) {
    if (stopped) return;
    stopCode = code;
    close().then((saved) => {
      if (!saved && stopCode === 0) stopCode = 2;
      log.info('stopped', { code: stopCode });
      resolveDone(stopCode);
    });
  }

  /** 常駐として動かす（10 秒ごとのサーバーの確認・presence の見直し、2 秒ごとの要求のファイル）。止まったら終了コードで解決する */
  function start() {
    loop(tick, TICK_MS);
    loop(sendPresence, PRESENCE_CHECK_MS);
    loop(checkRequests, REQUEST_POLL_MS);
    return done;
  }

  // 読み込み・共有・自動登録が落ち着くまで待つ（--once とテスト）。期限（deadline。既定は今から timeoutMs）は自動登録の判定・登録を待つ間も
  // 含めて実際の時間で数え、過ぎたら false
  async function settle({ timeoutMs = 120_000, deadline = Date.now() + timeoutMs } = {}) {
    const turn = () => new Promise((resolve) => setTimeout(resolve, 5));
    const quiet = () => !reading && !owned.state.busy && owned.state.upload.status !== 'sending';
    const registered = async () => {
      if (!autoRegister) return true;
      let timer = null;
      const limit = new Promise((resolve) => { timer = setTimeout(() => resolve(false), Math.max(0, deadline - Date.now())); });
      try {
        return await Promise.race([autoRegister.idle().then(() => true), limit]);
      } finally {
        clearTimeout(timer);
      }
    };
    for (;;) {
      await turn();
      if (quiet()) {
        if (!(await registered())) return false;
        await turn();
        if (quiet()) return true;
      }
      if (Date.now() >= deadline) return false;
    }
  }

  // --once の読み込みと共有の結果。0 送れた・1 想定外（読めない・通信の失敗・判定待ち）・2 再起動しても直らない（止めた状態・上限・形の誤りなど）
  function onceUploadCode() {
    if (sentLatest()) return 0;
    if (owned.state.local?.world.id !== worldId || !isFresh(localStamp())) {
      log.warn('once-failed', { reason: 'セーブを読めませんでした' });
      return 1;
    }
    log.warn('once-failed', { code: lastUploadError || 'UNKNOWN', reason: '共有できませんでした' });
    return lastUploadError && !RETRY_CODES.has(lastUploadError) ? 2 : 1;
  }

  /**
   * 1 回だけ動かす（--once）。ログインし、サーバーが動いていれば（forceHost・dryRun なら止まっていても）今のセーブを読んで送り、presence を
   * 1 回送って終わる。終了コードを返す（読めない・送れない・待ちきれないときは 0 にしない。onceUploadCode）
   */
  async function runOnce({ dryRun = false, timeoutMs = 120_000 } = {}) {
    // どの終わり方（ログインの失敗・例外を含む）でも KV を書き出してから終わる（壊れた state.json から止めた状態にした分などを失わない）
    let code = 1;
    try {
      code = await onceSteps({ dryRun, timeoutMs });
    } finally {
      const saved = await close();
      if (envMismatch || !saved) code = 2;
    }
    return code;
  }

  async function onceSteps({ dryRun, timeoutMs }) {
    // 読み込み・共有・自動登録・presence の待ちのすべてに、1 つの期限を使う
    const deadline = Date.now() + timeoutMs;
    const result = await login();
    if (result !== 'ok') return result === 'network' ? 1 : 2;
    lastServer = await monitor.check();
    let code = 0;
    let timedOut = false;
    const settled = async () => {
      if (await settle({ deadline })) return true;
      if (!timedOut) log.warn('once-timeout', { seconds: timeoutMs / 1000, reason: '読み込み・共有・自動登録が終わるのを待ちきれませんでした' });
      timedOut = true;
      return false;
    };
    if (forceHost || dryRun || lastServer.active) {
      if (!(await attach())) return 2;
      code = (await settled()) ? onceUploadCode() : 1;
    } else {
      log.info('once-skipped', { reason: 'サーバーが動いていないため読みません', state: lastServer.state });
    }
    if ((await sendPresence({ force: true })) === 'error') code ||= 1;
    if (!(await settled())) code ||= 1;
    return code;
  }

  return {
    store, owned, autoRegister, playerMaps, guard, source,
    login, tick, sendPresence, acceptWorld, checkRequests, settle, runOnce, start, close,
    /** 止める（シグナル・stop.request）。止まったら start() の Promise が終了コードで解決する */
    stop: requestStop,
    attached: () => attached,
    measured: () => ({ ...measured }),
    presenceValue,
  };
}
