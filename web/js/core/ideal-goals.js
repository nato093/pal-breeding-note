// 登録した理想個体（目標）の形と、完成品の判定。遺伝の仕組み（core/ideal.js）は使わない。
import { sanitizeText } from './validate.js';
import { ownedWorldId } from './owned-shared.js';
import { userIdKey } from './user.js';

// 協力プレイのホストの PlayerUId（SAVE_FORMAT.md）。グローバルパルボックスはホストのもの
const HOST_UID = '00000000-0000-0000-0000-000000000001';

export const GOAL_MODES = Object.freeze(['include', 'only']);
export const GOAL_CAKES = Object.freeze(['none', 'talent', 'special']);
export const GOAL_ORDERS = Object.freeze(['next', 'generations']);
// アルファの条件（気にしない／アルファだけ／アルファ以外）
export const GOAL_ALPHAS = Object.freeze(['any', 'alpha', 'normal']);
export const GOAL_STATS = Object.freeze(['hp', 'shot', 'defense']);
export const GOAL_NAME_MAX = 30;
// 1 人が登録できる数と、1 件で覚えるワールドの数（端末の保存を膨らませないため）
export const GOAL_LIMIT = 100;
const WORLD_LIMIT = 20;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const PAL_ID = /^[A-Za-z0-9_]{1,64}$/;

const validTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const oneOf = (list, value, fallback) => (list.includes(value) ? value : fallback);
// 個体値の目標は 0〜100 の整数だけ受け付ける。読めない値は 0（気にしない）ではなく 100 にして、誤って完成扱いにしない
const target = (value) => (Number.isInteger(value) && value >= 0 && value <= 100 ? value : 100);

function cleanWorld(value) {
  if (!value || typeof value !== 'object' || value.checked !== true || !validTime(value.observedAt)) return null;
  const complete = value.complete === true;
  return {
    checked: true, complete,
    completedAt: complete && validTime(value.completedAt) ? value.completedAt : '',
    observedAt: value.observedAt,
    worldName: sanitizeText(value.worldName, 100),
  };
}

/**
 * 登録した理想個体を検証して整える。形が合わないものは null（捨てる）。
 * worlds はワールドごとの完成の記録（checked: そのワールドで判定したか、complete: 完成しているか、
 * completedAt: 未完成から完成に変わったのを見た時刻〈通知に使う〉、observedAt: 判定に使ったセーブの時刻）。
 */
export function cleanGoal(value) {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !ID.test(value.id)) return null;
  if (typeof value.palId !== 'string' || !PAL_ID.test(value.palId)) return null;
  const passives = Array.isArray(value.passives)
    ? [...new Set(value.passives.filter((id) => typeof id === 'string' && PAL_ID.test(id)))].slice(0, 4) : [];
  const targets = Object.fromEntries(GOAL_STATS.map((key) => [key, target(value.targets?.[key])]));
  const worlds = {};
  const entries = value.worlds && typeof value.worlds === 'object' && !Array.isArray(value.worlds) ? Object.entries(value.worlds) : [];
  for (const [worldId, world] of entries) {
    const id = ownedWorldId(worldId);
    const clean = cleanWorld(world);
    if (id && clean) worlds[id] = clean;
  }
  // ワールドが多すぎるときは、最近判定したものを残す
  const kept = Object.entries(worlds).sort(([, a], [, b]) => Date.parse(b.observedAt) - Date.parse(a.observedAt)).slice(0, WORLD_LIMIT);
  return {
    id: value.id,
    name: sanitizeText(value.name, GOAL_NAME_MAX) || value.palId,
    palId: value.palId,
    passives,
    mode: oneOf(GOAL_MODES, value.mode, 'include'),
    targets,
    cake: oneOf(GOAL_CAKES, value.cake, 'none'),
    alpha: oneOf(GOAL_ALPHAS, value.alpha, 'any'),
    order: oneOf(GOAL_ORDERS, value.order, 'next'),
    addedAt: validTime(value.addedAt) ? value.addedAt : '',
    worlds: Object.fromEntries(kept),
  };
}

/** 保存した JSON を読み、検証した一覧にする（同じ ID・同じ目標は先に出たものを残す。名前の変更で 2 つの登録をつないだときなど）。 */
export function parseGoals(source) {
  let values;
  try { values = JSON.parse(source); } catch { return []; }
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const goals = [];
  for (const value of values) {
    const goal = cleanGoal(value);
    if (!goal || seen.has(goal.id) || seen.has(goalKey(goal))) continue;
    seen.add(goal.id);
    seen.add(goalKey(goal));
    goals.push(goal);
  }
  return goals.slice(0, GOAL_LIMIT);
}

/**
 * 同じ目標かを比べるための文字列。完成の条件（パル・欲しいパッシブ・パッシブの条件・個体値の目標・アルファ）だけで比べる
 * （ケーキと並べ方は作り方なので含めない。含めると、同じ完成で通知が重なる）。パッシブの順番は問わない。
 */
export function goalKey(goal) {
  return JSON.stringify([goal.palId, [...goal.passives].sort(), goal.mode, GOAL_STATS.map((key) => goal.targets[key]), goal.alpha]);
}

/**
 * 自分（ログイン中の ID）にあたるセーブのプレイヤー。設定の「登録者の対応」で選んだものを優先し、なければ同じ名前のプレイヤー
 * （配合牧場の自動登録の core/auto-breeding.js の mappedUser と同じ規則。そちらは自動登録の外から読まないので、ここに置く）。
 * @param {{ uid: string, name: string }[]} players
 * @param {{ userId: string, users?: string[], mapping?: Record<string, string> }} identity mapping はプレイヤーの UID → ID
 * @returns {Set<string>} プレイヤーの UID
 */
export function ownPlayerUids(players, { userId, users = [], mapping = {} }) {
  const me = userIdKey(userId);
  const known = new Set(users.map(userIdKey));
  const mine = new Set();
  if (!me) return mine;
  for (const player of players) {
    const chosen = mapping[player.uid];
    const user = chosen ? (known.has(userIdKey(chosen)) ? userIdKey(chosen) : '') : known.has(userIdKey(player.name)) ? userIdKey(player.name) : '';
    if (user === me) mine.add(player.uid);
  }
  return mine;
}

/**
 * プレイヤーの個体: 手持ち・パルボックス・パル次元ストレージ・持っているタマゴ（所持者がそのプレイヤー）、
 * そのプレイヤーが預けた拠点のパル、ホストならグローバルパルボックスの個体。
 * @param {{ players: object[], pals: object[] }} data normalizeOwned / ownedFromShared の結果
 * @param {Set<string>} uids プレイヤーの UID
 */
export function palsOfPlayers(data, uids) {
  // 共有されたデータには預けた人の UID がなく、名前だけがある。同じ名前のプレイヤーが複数いるときは、どちらか分からないので数えない
  const players = data.players ?? [];
  const count = new Map();
  for (const player of players) count.set(player.name, (count.get(player.name) ?? 0) + 1);
  const names = new Set(players.filter((player) => player.name && uids.has(player.uid) && count.get(player.name) === 1).map((player) => player.name));
  // 拠点に置かれたタマゴ（地面・孵化器・保管箱）には最後の持ち主が入らないので、誰の個体にもしない（孵化させて受け取った人の個体になる）
  return data.pals.filter((pal) => (pal.holderUid && uids.has(pal.holderUid))
    || (pal.place === 'base' && (pal.lastOwnerUid ? uids.has(pal.lastOwnerUid) : Boolean(pal.lastOwner) && names.has(pal.lastOwner)))
    || (pal.place === 'global' && uids.has(HOST_UID)));
}

/** 自分の個体（palsOfPlayers の自分の分）。自分のプレイヤーが分からなければ null。 */
export function ownPals(data, identity) {
  const mine = ownPlayerUids(data.players ?? [], identity);
  return mine.size ? palsOfPlayers(data, mine) : null;
}

/**
 * 登録した理想個体の条件を満たす個体（完成品）。目標と同じ種族で、パッシブの条件（全部持つ／欲しいものだけ）と
 * 個体値の目標（0 は気にしない）とアルファの条件を満たすもの。所持しているので、グローバルパルボックスの個体も含める。
 * 性別は問わない。タマゴは数えない（孵化させて受け取ったら完成）。
 * @param {{ palId: string, passives: string[], mode: 'include'|'only', targets: object, alpha: 'any'|'alpha'|'normal' }} goal cleanGoal で整えたもの
 * @param {object[]} pals normalizeOwned の pals
 */
export function goalMatches(goal, pals) {
  const wanted = [...new Set(goal.passives)];
  return pals.filter((pal) => {
    if (!goal.palId || pal.palId !== goal.palId || pal.egg) return false;
    if ((goal.alpha === 'alpha' && !pal.alpha) || (goal.alpha === 'normal' && pal.alpha)) return false;
    const own = new Set(pal.passives);
    if (!wanted.every((id) => own.has(id)) || (goal.mode === 'only' && own.size !== wanted.length)) return false;
    return GOAL_STATS.every((key) => goal.targets[key] <= 0 || pal.talent[key] >= goal.targets[key]);
  });
}
