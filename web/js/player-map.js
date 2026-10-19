// プレイヤーの対応（server の mapping。GAS のシート PlayerMap）を読み書きするストア。DOM・window を使わないので、常駐（Node）も使う。
// ワールドごとに「プレイヤーの鍵（core/owned-shared.js の playerMapKey。'i:<InstanceId>'・'u:<uid>'）→ ノートの ID（'' は外した印）」を
// 手元に写して持つ。鍵から UID への解決は auto-register.js の mappingFor だけが行う（docs/server/README.md の「テーマ間の取り決め」）。
// 古い GAS（playerMap を知らず BAD_ACTION を返す）と、まだ一度も読めていないワールドでは entries が null を返し、使う側は前の版の対応
//（この端末の autoBreeding.players）に落とす。
import { ApiError } from './api.js';
import { ownedWorldId, playerMapKey, PLAYER_MAP_SET_MAX, PLAYER_MAP_WORLD_MAX } from './core/owned-shared.js';

// BAD_ACTION と分かってから試し直すまで（owned.js の ownedSince と同じ 1 時間。それまでは前の版の対応を使う）
export const PLAYER_MAP_RETRY_MS = 60 * 60 * 1000;
// 写しの形の版と、ノートの ID の長さ（core/owned-shared.js の cleanPlayerMapEntry と同じ）
const COPY_VERSION = 1;
const USER_MAX = 20;

// 応答の entries（cleanPlayerMapEntries で整えた配列）→ 鍵 → ノートの ID
const entriesObject = (list) => Object.fromEntries((Array.isArray(list) ? list : []).map((entry) => [entry.key, entry.userId]));

// 保存した写し（{ v, entries, fetchedAt }）を確かめて整える。形の違う鍵・値はその対応だけ捨てる。読めなければ null
function parseCopy(text) {
  let value = null;
  try { value = JSON.parse(text); } catch { return null; }
  if (!value || typeof value !== 'object' || value.v !== COPY_VERSION) return null;
  if (!value.entries || typeof value.entries !== 'object' || Array.isArray(value.entries)) return null;
  const entries = {};
  for (const [raw, userId] of Object.entries(value.entries).slice(0, PLAYER_MAP_WORLD_MAX)) {
    const key = playerMapKey(raw);
    if (key && typeof userId === 'string' && userId.length <= USER_MAX) entries[key] = userId;
  }
  return { entries, fetchedAt: Number.isFinite(value.fetchedAt) ? value.fetchedAt : 0 };
}

/**
 * request(action, input): GAS の操作（画面は store.call。書いた人の ID は request が入れる）。scope(): ログイン中の環境（なければ ''）。
 * endpoint(): 接続先（BAD_ACTION を接続先と環境ごとに覚える）。storage: { get, set, trySet? }（safeStorage と同じ形。常駐はファイル）。
 * 写しのキーは '<namespace>.autoBreeding.playerMap.<env>.<ワールド ID〔大文字〕>'。保存できない端末でも、開いている間はメモリの写しで動く
 * @returns {{ entries(env, worldId, options?): Record<string, string> | null, ensure(env, worldId, options?): Promise<boolean>,
 *   set(env, worldId, list, options?): Promise<{ changed: number, skipped: number }>, saving(env, worldId): boolean,
 *   settled(env, worldId): Promise<void>, subscribe(listener): () => void, reload(storageKey): boolean, prefix: string }}
 */
export function createPlayerMapStore({ request, scope = () => '', endpoint = () => '', storage = null, namespace = 'pal-note', now = Date.now }) {
  const prefix = `${namespace}.autoBreeding.playerMap.`;
  const copyKey = (env, worldId) => `${prefix}${env}.${worldId}`;
  const listeners = new Set();
  // できないことの記憶（接続先|環境 → 試し直す時刻）
  const unsupported = new Map();
  // この端末に書けなかった写し（保存先の方が新しければ保存先を使う）
  const memory = new Map();
  // 送っている途中の対応（写しのキー → 鍵 → { userId, onlyMissing, token }）。読み直しの写しにも重ねる（表示用。判定は confirmed で重ねない）
  const overlays = new Map();
  // 送っている途中の書き込み（写しのキー → 終わりを待つ Promise。失敗しても resolve）。同じワールドの書き込みは 1 つずつ順に送る
  const queues = new Map();
  // 読みに行っている途中（同じワールドを同時に読みに行かない）と、写しを書いた回数（読む間に書いたら、その読みは古いので使わない。
  // 別のタブが書いた storage イベントでも進める）
  const reading = new Map();
  const versions = new Map();
  // 読めなかった時刻（写しのキー → 時刻）。maxAge の間は読み直さない（GAS の障害・setup() の前の SHEET_HEADER で、描くたび・判定のたびに送らない）
  const failedAt = new Map();
  // このタブが最後に見た中身（写しのキー → JSON）。別のタブが写しを書き換えたときに、変わったかを比べる
  const seen = new Map();

  const capability = (env) => `${endpoint() ?? ''}|${env}`;
  const supported = (env) => !(unsupported.get(capability(env)) > now());
  const emit = () => listeners.forEach((listener) => listener());

  function readCopy(key) {
    const stored = parseCopy(storage?.get?.(key) ?? null);
    const kept = memory.get(key) ?? null;
    if (!stored) return kept;
    return kept && kept.fetchedAt > stored.fetchedAt ? kept : stored;
  }
  function writeCopy(key, entries) {
    const copy = { entries, fetchedAt: Math.max(now(), (readCopy(key)?.fetchedAt ?? 0) + 1) };
    memory.set(key, copy);
    const text = JSON.stringify({ v: COPY_VERSION, ...copy });
    if (storage?.trySet) storage.trySet(key, text);
    else storage?.set?.(key, text);
    versions.set(key, (versions.get(key) ?? 0) + 1);
  }
  // 写しに、送っている途中の対応を重ねる（onlyMissing の対応は、写しにまだない鍵だけ）
  function withOverlay(key, base) {
    const out = { ...base };
    for (const [entryKey, pending] of overlays.get(key) ?? []) {
      if (!pending.onlyMissing || !Object.hasOwn(base, entryKey)) out[entryKey] = pending.userId;
    }
    return out;
  }
  function current(key, env) {
    const copy = supported(env) ? readCopy(key) : null;
    const value = copy ? withOverlay(key, copy.entries) : null;
    seen.set(key, JSON.stringify(value));
    return value;
  }
  // 中身（entries の値）が変わったときだけ知らせる
  function change(key, env, fn) {
    const before = JSON.stringify(current(key, env));
    fn();
    if (JSON.stringify(current(key, env)) !== before) emit();
  }
  const markUnsupported = (env) => unsupported.set(capability(env), now() + PLAYER_MAP_RETRY_MS);
  // 写しの版（このタブが書いた回数と、写しの時刻）。読む・送る間に変わったら、その応答は古い。時刻も見るのは、別のタブが書いた写しを
  // storage イベントが届く前でも数えるため（最終レビュー）
  const revision = (key) => `${versions.get(key) ?? 0}:${readCopy(key)?.fetchedAt ?? 0}`;

  /**
   * そのワールドの対応（鍵 → ノートの ID。'' は外した印）。古い GAS と分かっている間・まだ一度も読めていなければ null。
   * confirmed: 送っている途中の対応を重ねない（GAS に書けたと分かっている対応だけ。自動登録の判定に使う。Codex のレビュー）
   */
  function entries(env, worldId, { confirmed = false } = {}) {
    const id = ownedWorldId(worldId);
    if (!env || !id) return null;
    if (!confirmed) return current(copyKey(env, id), env);
    const copy = supported(env) ? readCopy(copyKey(env, id)) : null;
    return copy ? { ...copy.entries } : null;
  }

  /**
   * 写しが maxAge より古ければ GAS から読む（同じワールドを同時に読みに行かない）。失敗しても例外にせず写しのまま（BAD_ACTION なら
   * 1 時間覚える。ほかの失敗も maxAge の間は読み直さない）。ログイン中の環境でなければ読まない。読めたら true
   */
  function ensure(env, worldId, { maxAge = 0 } = {}) {
    const id = ownedWorldId(worldId);
    if (!env || !id || !supported(env) || scope() !== env) return Promise.resolve(false);
    const key = copyKey(env, id);
    const copy = readCopy(key);
    if (copy && now() - copy.fetchedAt < maxAge) return Promise.resolve(false);
    if (failedAt.has(key) && now() - failedAt.get(key) < maxAge) return Promise.resolve(false);
    if (reading.has(key)) return reading.get(key);
    const version = revision(key);
    const task = (async () => {
      try {
        const response = await request('playerMap', { worldId: id });
        failedAt.delete(key);
        if (response?.worldId !== id || (response.env && response.env !== env) || revision(key) !== version) return false;
        change(key, env, () => writeCopy(key, entriesObject(response.entries)));
        return true;
      } catch (error) {
        failedAt.set(key, now());
        if (error?.code === 'BAD_ACTION') change(key, env, () => markUnsupported(env));
        return false;
      }
    })().finally(() => reading.delete(key));
    reading.set(key, task);
    return task;
  }

  /**
   * 対応を書く（list: [{ key, userId, playerName? }]。userId の '' は外す）。PLAYER_MAP_SET_MAX 件ずつ送る。先に写しへ重ねて知らせ、
   * 送れたら応答（書いた後の全部）で写しを置き換え（送る間に写しが変わっていれば、書いた鍵だけを重ねる）、失敗したら重ねた分を戻して
   * 投げる（BAD_ACTION なら 1 時間覚える。待つ間にログインの環境が変わったら AUTH）。
   * 同じワールドの書き込みは、前の書き込みが終わってから送る（同時に送ると応答が前後し、先に送った書き込みの応答〔後の書き込みを含まない
   * 全部〕で写しを巻き戻すため。Codex のレビュー）。
   * onlyMissing: すでにある鍵（外した印を含む）は書かない（前の版の対応を一度だけ上げる移行）
   */
  async function set(env, worldId, list, { onlyMissing = false } = {}) {
    const id = ownedWorldId(worldId);
    if (!env || !id || scope() !== env) throw new ApiError('BAD_REQUEST');
    if (!supported(env)) throw new ApiError('BAD_ACTION');
    const byKey = new Map();
    for (const item of Array.isArray(list) ? list : []) {
      const entryKey = playerMapKey(item?.key);
      if (!entryKey || typeof item.userId !== 'string') continue;
      byKey.delete(entryKey);
      byKey.set(entryKey, { key: entryKey, userId: item.userId, playerName: typeof item.playerName === 'string' ? item.playerName : '' });
    }
    const items = [...byKey.values()];
    if (!items.length) return { changed: 0, skipped: 0 };
    const key = copyKey(env, id);
    const token = {};
    if (!overlays.has(key)) overlays.set(key, new Map());
    const overlay = overlays.get(key);
    // 同じ鍵を後から送った対応（別の set）は消さない
    const release = (done) => {
      for (const item of done) if (overlay.get(item.key)?.token === token) overlay.delete(item.key);
      if (!overlay.size && overlays.get(key) === overlay) overlays.delete(key);
    };
    change(key, env, () => { for (const item of items) overlay.set(item.key, { userId: item.userId, onlyMissing, token }); });
    const send = async () => {
      let changed = 0;
      let skipped = 0;
      for (let first = 0; first < items.length; first += PLAYER_MAP_SET_MAX) {
        const chunk = items.slice(first, first + PLAYER_MAP_SET_MAX);
        // 待っている間に古い GAS と分かったら送らない
        if (!supported(env)) {
          change(key, env, () => release(items.slice(first)));
          throw new ApiError('BAD_ACTION');
        }
        // 待っている間にログアウト・ログインし直し（環境が変わった）をしたら送らない。request は送るときのログイン（パスワード・ID）で
        // 送るので、test で選んだ対応を prod に書いてしまう（最終レビュー）。ここから request が資格を読むまでは同期で、割り込みはない
        if (scope() !== env) {
          change(key, env, () => release(items.slice(first)));
          throw new ApiError('AUTH');
        }
        const version = revision(key);
        let response;
        try {
          response = await request('playerMapSet', { worldId: id, entries: chunk, ...(onlyMissing ? { onlyMissing: true } : {}) });
        } catch (error) {
          change(key, env, () => {
            release(items.slice(first));
            if (error?.code === 'BAD_ACTION') markUnsupported(env);
          });
          throw error;
        }
        change(key, env, () => {
          if (response?.worldId === id && (!response.env || response.env === env)) {
            const all = entriesObject(response.entries);
            // 送っている間に写しが変わった（別のタブの書き込み・読み直し）ときは、応答で全部を置き換えず、この回に書いた鍵だけを今の写しに
            // 重ねる（応答は別のタブの書き込みより前の中身かもしれない。捨てると、自分の書き込みが写しから落ちる。最終レビュー）
            if (revision(key) === version) writeCopy(key, all);
            else {
              const mine = chunk.filter((item) => Object.hasOwn(all, item.key)).map((item) => [item.key, all[item.key]]);
              writeCopy(key, { ...(readCopy(key)?.entries ?? {}), ...Object.fromEntries(mine) });
            }
          }
          release(chunk);
        });
        changed += response?.changed ?? 0;
        skipped += response?.skipped ?? 0;
      }
      return { changed, skipped };
    };
    const task = (queues.get(key) ?? Promise.resolve()).then(send);
    const tail = task.then(() => {}, () => {});
    queues.set(key, tail);
    tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
    return task;
  }

  /** そのワールドの書き込み（set）を送っている途中か（先に重ねた対応が、まだ GAS に書けたと分かっていない） */
  function saving(env, worldId) {
    const id = ownedWorldId(worldId);
    return Boolean(env && id) && queues.has(copyKey(env, id));
  }
  /** そのワールドの書き込みが全部終わるまで待つ（失敗しても例外にしない） */
  async function settled(env, worldId) {
    const id = ownedWorldId(worldId);
    if (!env || !id) return;
    const key = copyKey(env, id);
    while (queues.has(key)) await queues.get(key);
  }

  return {
    prefix,
    entries,
    ensure,
    set,
    saving,
    settled,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /**
     * 別のタブの storage イベント（写しのキー）。そのタブが写しを書き換えたので、このタブの対応も変わっていれば知らせる。写しのキーなら true
     */
    reload(storageKey) {
      if (typeof storageKey !== 'string' || !storageKey.startsWith(prefix)) return false;
      const rest = storageKey.slice(prefix.length);
      const env = rest.slice(0, rest.indexOf('.'));
      if (!env) return false;
      // 保存先の方が新しい（このタブが書けずにメモリに残した写しより）。このタブが見ていなかったワールドなら知らせない。
      // それまでに始めた読み・書き込みの応答は古いので、全部では写しにしない（版を進める）
      memory.delete(storageKey);
      versions.set(storageKey, (versions.get(storageKey) ?? 0) + 1);
      const before = seen.get(storageKey);
      if (before !== undefined && JSON.stringify(current(storageKey, env)) !== before) emit();
      return true;
    },
  };
}
