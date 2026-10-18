// 古い系統の守り（docs/server/README.md の T5「古い系統の守り」・決定 18）。協力プレイで進めた後に取り込み直していない古いサーバーのワールドを
// 起動しても、新しい共有を古い中身で上書きしない（保存時刻はいつも新しいので、GAS の新旧の比べ方では防げない）。状態は KV に残す。
// - 比べ方: 同じ単位どうしだけ。両方に clock（Level.sav の RealDateTimeTicks）があれば clock、どちらかになければ日数（inGameDay）、
//   日数もどちらかになければ比べない（送ってよい）。ティックと日数を混ぜたり、大きい方を取ったりしない
// - 比べる相手: (a) GAS で公開されている同じワールドの値（受け入れの基準の uploadedAt より後の世代だけ。受け入れていなければ全部）、
//   (b) この常駐が前に送った値。どちらかより小さければ古い系統
// - 判定待ち: 起動したとき・セーブを読んだたびに、そのセーブ（保存時刻 stamp）は判定待ち。公開の値を読んで古い系統でないと確かめたら、その stamp に
//   限って解除する（メモリだけ。再起動したらまた判定待ち）。読んでいる間・読めない間も判定待ち
// - 止めた状態は KV に残し、明示の受け入れ（--accept-world）まで解除しない（再起動しても、後で値が公開の値を追い越しても）
// - 受け入れの基準は、受け入れたときに GAS から読んだ公開の世代の uploadedAt（GAS のサーバーの時計）。PC の時計は使わない
import { ownedSaveStamp, ownedWorldId } from '../../web/js/core/owned-shared.js';
import { isoTime } from '../../web/js/core/boundary.js';
import { autoRegisterFarmsKey } from '../../web/js/auto-register.js';

// 共有を止めた理由（owned.js の再試行の段〔UPLOAD_RETRY_CODES〕に入らない code。次に読んだセーブの送信で、もう一度判定する）
export const LINEAGE_BLOCKED = 'LINEAGE_BLOCKED';
export const LINEAGE_PENDING = 'LINEAGE_PENDING';
const MESSAGES = {
  [LINEAGE_BLOCKED]: '古い系統のセーブのため、共有と自動登録を止めています（受け入れるときは --accept-world）',
  [LINEAGE_PENDING]: '公開されている共有と照らせていないため、共有と自動登録を待っています',
};
// 受け入れられなかった理由
export const ACCEPT_ERRORS = Object.freeze({
  NOT_READY: 'ログインしていないか、ワールドが分からないため受け入れられません',
  UNREADABLE: '公開されている共有を読めないため受け入れられません（読めるようになってからやり直してください）',
  NO_PUBLISHED: 'このワールドは公開されていないため受け入れられません',
});
// 解除した stamp を残す数（ワールドごと。同じ時に判定した古いセーブの分）
const VERIFIED_MAX = 8;

const lineageError = (code) => Object.assign(new Error(MESSAGES[code]), { code });

/** 比べる値（stamp: Level.sav の保存時刻、clock: RealDateTimeTicks の 10 進の文字列、inGameDay: 1 以上の整数）。分からない項目は '' か 0 */
export function lineageValues(value) {
  const source = value && typeof value === 'object' ? value : {};
  const day = source.inGameDay;
  return {
    stamp: ownedSaveStamp(source.stamp),
    clock: ownedSaveStamp(source.clock),
    inGameDay: Number.isSafeInteger(day) && day > 0 ? day : 0,
  };
}

/** 読み込んだセーブ（save/palworld.js の buildSnapshot）の比べる値 */
export const lineageOfSnapshot = (snapshot) => lineageValues({
  stamp: snapshot?.world?.savedAtTicks, clock: snapshot?.world?.clock, inGameDay: snapshot?.world?.inGameDay,
});

/** 共有の送信（ownedUpload の入力。owned.js の sendLocal）の比べる値 */
export const lineageOfUpload = (input) => lineageValues({
  stamp: input?.world?.saveStamp, clock: input?.world?.clock, inGameDay: input?.world?.inGameDay,
});

const compareTicks = (a, b) => {
  if (a.length !== b.length) return a.length > b.length ? 1 : -1;
  return a === b ? 0 : a > b ? 1 : -1;
};

/** a と b の新旧（1・0・-1）。両方に clock があれば clock、なければ両方の日数で比べ、比べられなければ null */
export function compareLineage(a, b) {
  const left = lineageValues(a);
  const right = lineageValues(b);
  if (left.clock && right.clock) return compareTicks(left.clock, right.clock);
  if (left.inGameDay && right.inGameDay) return Math.sign(left.inGameDay - right.inGameDay);
  return null;
}

// KV に残す値（stamp は残さない。clock と日数だけ）
const kept = (value) => {
  const { clock, inGameDay } = lineageValues(value);
  return { clock, inGameDay };
};

// 前に送った値（単位ごとに大きい方。送る前に古い系統でないと確かめてあるので、同じ系統の中で進む）
const larger = (a, b) => ({
  clock: !a.clock || (b.clock && compareTicks(b.clock, a.clock) > 0) ? b.clock : a.clock,
  inGameDay: Math.max(a.inGameDay, b.inGameDay),
});

/** KV に残す状態のキー（環境・ワールドごと） */
export const lineageStateKey = (namespace, env, worldId) => `${namespace}.agent.lineage.${env}.${worldId}`;

/**
 * 状態のファイル（state.json）が壊れていて空から始めたとき（kv-storage の brokenState）に、そのワールドを止めた状態（against: 'unreadable'）に
 * する。前の止めた状態・受け入れの基準・前に送った値を失ったまま、古い系統を送らないため（受け入れで戻る）
 * @param {{ set: (key: string, value: string) => void }} storage KV（safeStorage の形）
 */
export function blockUnreadable(storage, { namespace = 'pal-note', env, worldId }) {
  const id = ownedWorldId(worldId);
  if (!env || !id) return false;
  storage.set(lineageStateKey(namespace, env, id), JSON.stringify({ blocked: { against: 'unreadable', save: kept(null), other: kept(null) }, baseline: null, sent: null }));
  return true;
}

// GAS のサーバーの時刻（uploadedAt）が base より後か。読めなければ後とみなす（比べる側に倒す）
const laterThan = (at, base) => {
  const time = Date.parse(at ?? '');
  return !Number.isFinite(time) || time > Date.parse(base);
};

/**
 * @param {object} options
 * @param {{ scope: () => string, userId?: () => string, endpoint?: () => string, request: (action: string, input?: object) => Promise<object> }} options.server
 *   GAS との通信（createOwnedStore に渡す形）。公開の値は request('ownedWorlds') で読む。scope はログイン中の環境（KV のキーに使う）
 * @param {{ get: (key: string) => string|null, set: (key: string, value: string) => void, remove: (key: string) => void }} options.storage
 *   KV（store.js の safeStorage(createKvStorage(...)) の形）
 * @param {(worldId: string, env: string) => void} [options.onAccept] 受け入れたときに、動いている自動登録の牧場の記録を捨てる
 *   （createAutoRegister の forgetFarms）。KV の牧場の記録は、渡さなくても捨てる
 * @param {{ info: Function, warn: Function }} [options.log] 常駐のログ（log.mjs。値と理由だけを出す）
 * @returns 次のもの。動いている常駐は subscribe で、自動登録の判定（autoRegister.evaluate）と、受け入れの後の共有（owned.uploadLocal）をやり直す
 *   - server: request を包んだもの（createOwnedStore に渡す）。ownedUpload は、そのセーブを判定し、古い系統でないと確かめたときだけ送る
 *   - paused(worldId, stamp): 判定待ち・止めている間は true（createAutoRegister に渡す）
 *   - check(worldId, values): 公開の値を読んで判定する（'ok'・'blocked'・'pending'。例外にしない。セーブを読んだたびに呼ぶ）
 *   - accept(worldId, values): 受け入れ（--accept-world）。受け入れられなければ例外（code は ACCEPT_ERRORS の鍵）
 *   - status(worldId): 今の状態（--check・ログ）
 */
export function createLineageGuard({ server, storage, namespace = 'pal-note', onAccept = null, log = null }) {
  const scope = () => server.scope?.() || '';
  const stateKey = (env, worldId) => lineageStateKey(namespace, env, worldId);
  // 解除した stamp（env|worldId → stamp の Set）・読んでいる途中の判定（env|worldId|stamp → Promise）
  const verified = new Map();
  const inflight = new Map();
  const listeners = new Set();
  const emit = (event) => listeners.forEach((listener) => listener(event));

  // KV の状態。壊れていれば止めた状態とみなす（止めた状態を失って古い系統を送らないため。受け入れで戻る）
  function readState(env, worldId) {
    const empty = { blocked: null, baseline: null, sent: null };
    const raw = storage.get(stateKey(env, worldId));
    if (raw === null || raw === undefined) return empty;
    let value = null;
    try { value = JSON.parse(raw); } catch { value = null; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...empty, blocked: { against: 'unreadable', save: kept(null), other: kept(null) } };
    const blocked = value.blocked && typeof value.blocked === 'object'
      ? { against: typeof value.blocked.against === 'string' ? value.blocked.against : 'unreadable', save: kept(value.blocked.save), other: kept(value.blocked.other) }
      : value.blocked ? { against: 'unreadable', save: kept(null), other: kept(null) } : null;
    const at = isoTime(value.baseline?.uploadedAt);
    return {
      blocked,
      baseline: at ? { uploadedAt: at, ...kept(value.baseline) } : null,
      sent: value.sent && typeof value.sent === 'object' ? kept(value.sent) : null,
    };
  }
  const writeState = (env, worldId, state) => storage.set(stateKey(env, worldId), JSON.stringify(state));

  const verifiedOf = (env, worldId) => verified.get(`${env}|${worldId}`);
  function markVerified(env, worldId, stamp) {
    const key = `${env}|${worldId}`;
    const set = verified.get(key) ?? new Set();
    set.delete(stamp);
    set.add(stamp);
    while (set.size > VERIFIED_MAX) set.delete(set.values().next().value);
    verified.set(key, set);
  }

  function paused(worldId, stamp) {
    const env = scope();
    const id = ownedWorldId(worldId);
    const value = ownedSaveStamp(stamp);
    if (!env || !id || !value || readState(env, id).blocked) return true;
    return !verifiedOf(env, id)?.has(value);
  }

  // GAS で公開されている同じワールド（なければ null）。読めなければ例外
  async function readPublished(worldId) {
    const response = await server.request('ownedWorlds');
    const worlds = Array.isArray(response?.worlds) ? response.worlds : [];
    return worlds.find((world) => ownedWorldId(world?.worldId) === worldId) ?? null;
  }

  function block(env, worldId, values, against, other) {
    const state = readState(env, worldId);
    writeState(env, worldId, { ...state, blocked: { against, save: kept(values), other: kept(other) } });
    verified.delete(`${env}|${worldId}`);
    const unit = values.clock && lineageValues(other).clock ? 'clock' : 'day';
    log?.warn?.('lineage-blocked', { worldId, against, unit, save: unit === 'clock' ? values.clock : values.inGameDay, other: unit === 'clock' ? lineageValues(other).clock : lineageValues(other).inGameDay });
    emit({ type: 'blocked', worldId, env });
  }

  async function verify(env, worldId, values) {
    let published;
    try {
      published = await readPublished(worldId);
    } catch (error) {
      log?.info?.('lineage-pending', { code: error?.code || 'ERROR' });
      return 'pending';
    }
    // 読んでいる間にログイン・環境が替わった
    if (scope() !== env) return 'pending';
    // 読んでいる間に止めた・受け入れた分も見る（読んだ後の状態で比べる）
    const state = readState(env, worldId);
    if (state.blocked) return 'blocked';
    const fresh = published && (!state.baseline || laterThan(published.uploadedAt, state.baseline.uploadedAt)) ? published : null;
    if (fresh && compareLineage(values, fresh) < 0) {
      block(env, worldId, values, 'published', fresh);
      return 'blocked';
    }
    if (state.sent && compareLineage(values, state.sent) < 0) {
      block(env, worldId, values, 'sent', state.sent);
      return 'blocked';
    }
    const first = !verifiedOf(env, worldId)?.has(values.stamp);
    markVerified(env, worldId, values.stamp);
    if (first) emit({ type: 'verified', worldId, env, stamp: values.stamp });
    return 'ok';
  }

  /** そのセーブを判定する（'ok'・'blocked'・'pending'）。同じセーブの判定が読んでいる途中なら、それを待つ */
  function check(worldId, save) {
    const env = scope();
    const id = ownedWorldId(worldId);
    const values = lineageValues(save);
    if (!env || !id || !values.stamp) return Promise.resolve('pending');
    if (readState(env, id).blocked) return Promise.resolve('blocked');
    if (verifiedOf(env, id)?.has(values.stamp)) return Promise.resolve('ok');
    const key = `${env}|${id}|${values.stamp}`;
    if (!inflight.has(key)) inflight.set(key, verify(env, id, values).finally(() => inflight.delete(key)));
    return inflight.get(key);
  }

  // 送った値を (b) に残す（送る前に残す。届いたか分からない送信も、送ったものとして比べる）
  function recordSent(env, worldId, values) {
    const state = readState(env, worldId);
    const next = larger(state.sent ?? kept(null), kept(values));
    if (state.sent && next.clock === state.sent.clock && next.inGameDay === state.sent.inGameDay) return;
    writeState(env, worldId, { ...state, sent: next });
  }

  async function request(action, input) {
    if (action !== 'ownedUpload') return server.request(action, input);
    const env = scope();
    const id = ownedWorldId(input?.worldId);
    const values = lineageOfUpload(input);
    const result = await check(id, values);
    // 判定の後（読んでいる間）に止めた・環境が替わったときも送らない
    if (result !== 'ok' || scope() !== env || paused(id, values.stamp)) {
      throw lineageError(result === 'blocked' || (env && id && readState(env, id).blocked) ? LINEAGE_BLOCKED : LINEAGE_PENDING);
    }
    recordSent(env, id, values);
    return server.request(action, input);
  }

  /**
   * 受け入れ（--accept-world）。そのときのセーブの値と、GAS から読んだ公開の世代の uploadedAt を基準として残し、(b) も受け入れたセーブの値にする。
   * 止めていた間の候補と牧場の記録を捨てる（次の読み込みは記録するだけ）。公開の世代がない・読めないときは受け入れない
   * @returns {Promise<{ uploadedAt: string }>}
   */
  async function accept(worldId, save) {
    const env = scope();
    const id = ownedWorldId(worldId);
    const values = lineageValues(save);
    const fail = (code) => Object.assign(new Error(ACCEPT_ERRORS[code]), { code });
    if (!env || !id) throw fail('NOT_READY');
    let published;
    try {
      published = await readPublished(id);
    } catch {
      throw fail('UNREADABLE');
    }
    if (scope() !== env) throw fail('NOT_READY');
    const uploadedAt = isoTime(published?.uploadedAt);
    if (!uploadedAt) throw fail('NO_PUBLISHED');
    writeState(env, id, { blocked: null, baseline: { uploadedAt, ...kept(values) }, sent: kept(values) });
    verified.delete(`${env}|${id}`);
    if (values.stamp) markVerified(env, id, values.stamp);
    storage.remove(autoRegisterFarmsKey(namespace, env, id));
    onAccept?.(id, env);
    log?.info?.('lineage-accepted', { worldId: id, clock: values.clock, inGameDay: values.inGameDay });
    emit({ type: 'accepted', worldId: id, env, stamp: values.stamp });
    return { uploadedAt };
  }

  /** 今の状態（'blocked'・'ok'〔stamp を解除済み〕・'pending'）と、止めた理由・受け入れの基準・前に送った値 */
  function status(worldId, stamp = '') {
    const env = scope();
    const id = ownedWorldId(worldId);
    if (!env || !id) return { state: 'pending', blocked: null, baseline: null, sent: null };
    const state = readState(env, id);
    return { state: state.blocked ? 'blocked' : paused(id, stamp) ? 'pending' : 'ok', ...state };
  }

  return {
    server: {
      scope,
      userId: () => server.userId?.() ?? '',
      endpoint: () => server.endpoint?.() ?? '',
      request,
    },
    paused,
    check,
    accept,
    status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
