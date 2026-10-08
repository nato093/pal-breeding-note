// 登録した理想個体（目標）の形と、完成品の判定。遺伝の仕組み（core/ideal.js）は使わない。
import { sanitizeText } from './validate.js';
import { ownedWorldId } from './owned-shared.js';
import { userIdKey } from './user.js';

// 協力プレイのホストの PlayerUId（SAVE_FORMAT.md）。グローバルパルボックスはホストのもの
const HOST_UID = '00000000-0000-0000-0000-000000000001';

export const GOAL_MODES = Object.freeze(['include', 'only']);
export const GOAL_CAKES = Object.freeze(['none', 'talent', 'special']);
export const GOAL_ORDERS = Object.freeze(['next', 'generations']);
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
 * 同じ目標かを比べるための文字列。完成の条件（パル・欲しいパッシブ・パッシブの条件・個体値の目標）だけで比べる
 * （ケーキと並べ方は作り方なので含めない。含めると、同じ完成で通知が重なる）。パッシブの順番は問わない。
 */
export function goalKey(goal) {
  return JSON.stringify([goal.palId, [...goal.passives].sort(), goal.mode, GOAL_STATS.map((key) => goal.targets[key])]);
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
 * 自分の個体: 手持ち・パルボックス・パル次元ストレージ・自分が持っているタマゴ（所持者が自分）、自分が預けた拠点のパル、
 * 自分がホストならグローバルパルボックスの個体。自分のプレイヤーが分からなければ null。
 * @param {{ players: object[], pals: object[] }} data normalizeOwned / ownedFromShared の結果
 */
export function ownPals(data, identity) {
  const mine = ownPlayerUids(data.players ?? [], identity);
  if (!mine.size) return null;
  // 共有されたデータには預けた人の UID がなく、名前だけがある
  const names = new Set((data.players ?? []).filter((player) => mine.has(player.uid)).map((player) => player.name));
  return data.pals.filter((pal) => (pal.holderUid && mine.has(pal.holderUid))
    || (pal.place === 'base' && (pal.lastOwnerUid ? mine.has(pal.lastOwnerUid) : names.has(pal.lastOwner)))
    || (pal.place === 'global' && mine.has(HOST_UID)));
}

/**
 * 登録した理想個体の条件を満たす個体（完成品）。目標と同じ種族で、パッシブの条件（全部持つ／欲しいものだけ）と
 * 個体値の目標（0 は気にしない）を満たすもの。所持しているので、タマゴ（中身が分かるもの）とグローバルパルボックスの個体も含める。
 * 性別は問わない。中身の分からないタマゴ（性別が空）は数えない。
 * @param {{ palId: string, passives: string[], mode: 'include'|'only', targets: object }} goal cleanGoal で整えたもの
 * @param {object[]} pals normalizeOwned の pals
 */
export function goalMatches(goal, pals) {
  const wanted = [...new Set(goal.passives)];
  return pals.filter((pal) => {
    if (!goal.palId || pal.palId !== goal.palId || (pal.egg && !pal.gender)) return false;
    const own = new Set(pal.passives);
    if (!wanted.every((id) => own.has(id)) || (goal.mode === 'only' && own.size !== wanted.length)) return false;
    return GOAL_STATS.every((key) => goal.targets[key] <= 0 || pal.talent[key] >= goal.targets[key]);
  });
}
