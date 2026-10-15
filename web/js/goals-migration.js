// 前のウィッシュリスト（<namespace>.wishlist.<env>.<userIdKey>）を、理想個体の「種族だけの目標」と観測（goalsObs）へ移す（goals-merge。D5）。
// 繰り返しても同じ結果になるよう、目標の id は決まった形（wish-<palId>）にし、同じ条件の目標があればそれに併せる。保存は自分で書いて
// 読み戻し、すべて移せたときだけ旧キーを消す（途中で止まっても、次の起動で続きから）。目標が上限（100 件）のときは「未移行」として残す。
import pals from '../data/pals.js';
import { cleanGoal, parseGoals, goalKey, speciesGoal, GOAL_LIMIT } from './core/ideal-goals.js';
import { cleanEntry, mergeObservation, parseObservations } from './core/goal-observations.js';

const palsById = new Map(pals.map((pal) => [pal.id, pal]));
const validTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));

/** 旧ウィッシュリストの 1 件（マスターにないパルは捨てる。前の wishlist.js の cleanWish と同じ） */
export function cleanWish(value) {
  if (!value || typeof value !== 'object' || !palsById.has(value.palId)) return null;
  const entry = cleanEntry(value);
  return { palId: value.palId, addedAt: validTime(value.addedAt) ? value.addedAt : '', ...entry };
}

/** 旧ウィッシュリストの保存値（同じパルは先を残す） */
export function parseWishes(source) {
  let values;
  try { values = JSON.parse(source); } catch { return []; }
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const wishes = [];
  for (const value of values) {
    const wish = cleanWish(value);
    if (!wish || seen.has(wish.palId)) continue;
    seen.add(wish.palId);
    wishes.push(wish);
  }
  return wishes;
}

export const wishlistKey = (namespace, env, userKey) => `${namespace}.wishlist.${env}.${userKey}`;
export const goalsKey = (namespace, env, userKey) => `${namespace}.ideals.${env}.${userKey}`;
export const observationsKey = (namespace, env, userKey) => `${namespace}.goalsObs.${env}.${userKey}`;

/**
 * 移す。status: 'none'（旧キーがない・空）・'done'（すべて移して旧キーを消した）・'partial'（上限で残りがある。旧キーは残す）・
 * 'failed'（書き込み・読み戻しに失敗。旧キーは残す）。migrated は今回の実行で記録した数、pending は残っている数
 * @returns {{ status: 'none'|'done'|'partial'|'failed', migrated: number, pending: number }}
 */
export function migrateWishlist({ storage, namespace = 'pal-note', env, userKey, now = Date.now }) {
  const wishKey = wishlistKey(namespace, env, userKey);
  const goalKeyName = goalsKey(namespace, env, userKey);
  const obsKey = observationsKey(namespace, env, userKey);
  const read = (key) => { try { return storage?.getItem(key) ?? null; } catch { return undefined; } };
  const source = read(wishKey);
  if (source === undefined) return { status: 'failed', migrated: 0, pending: 0 };
  const wishes = source === null ? [] : parseWishes(source);
  if (!wishes.length) {
    // 空（形の壊れた値を含む）の旧キーは片づける
    if (source !== null) {
      try { storage.removeItem(wishKey); } catch { /* 消せなくても、次の起動でまた空として扱う。 */ }
    }
    return { status: 'none', migrated: 0, pending: 0 };
  }
  const goalsSource = read(goalKeyName);
  const obsSource = read(obsKey);
  if (goalsSource === undefined || obsSource === undefined) return { status: 'failed', migrated: 0, pending: 0 };
  const goals = parseGoals(goalsSource);
  const observations = parseObservations(obsSource);
  const record = observations.migration.wishlist;
  const byKey = new Map(goals.map((goal) => [goalKey(goal), goal]));
  const usedIds = new Set(goals.map((goal) => goal.id));
  const pending = [];
  const added = [];
  let migrated = 0;
  for (const wish of wishes) {
    // 移したことがあれば飛ばす（目標が消えていても作り直さない＝利用者が外した。前の版のタブが旧キーに書き戻しても戻らない）
    if (record.migrated[wish.palId]) continue;
    const name = palsById.get(wish.palId)?.ja ?? wish.palId;
    const candidate = cleanGoal({ ...speciesGoal(wish.palId, { name, addedAt: wish.addedAt }), id: 'check' });
    const same = byKey.get(goalKey(candidate));
    let goalId = same?.id ?? '';
    if (!goalId) {
      if (goals.length + added.length >= GOAL_LIMIT) {
        pending.push(wish.palId);
        continue;
      }
      // 決まった id（やり直しても同じ）。別の条件で使われていればずらす
      let id = `wish-${wish.palId}`.slice(0, 64);
      for (let suffix = 2; usedIds.has(id); suffix++) id = `wish-${wish.palId}-${suffix}`.slice(0, 64);
      usedIds.add(id);
      const goal = cleanGoal({ ...candidate, id });
      added.push(goal);
      byKey.set(goalKey(goal), goal);
      goalId = id;
    }
    const { palId, addedAt, ...entry } = wish;
    observations.species[palId] = mergeObservation(observations.species[palId] ?? null, entry);
    record.migrated[palId] = goalId;
    migrated++;
  }
  record.pending = pending;
  const nextGoals = [...goals, ...added];
  // ① 目標を書いて読み戻す（書けない・見つからなければ何も記録しない＝次の実行でやり直す）
  try {
    if (added.length) storage.setItem(goalKeyName, JSON.stringify(nextGoals));
  } catch {
    return { status: 'failed', migrated: 0, pending: pending.length };
  }
  const savedIds = new Set(parseGoals(read(goalKeyName)).map((goal) => goal.id));
  if (!added.every((goal) => savedIds.has(goal.id))) return { status: 'failed', migrated: 0, pending: pending.length };
  // ② 観測と移行の記録を書いて読み戻す（書けなければ、次の実行で同じ目標〔決まった id・同じ条件〕に併せて続きから）
  try {
    storage.setItem(obsKey, JSON.stringify(observations));
  } catch {
    return { status: 'failed', migrated: 0, pending: pending.length };
  }
  const savedObs = parseObservations(read(obsKey));
  const recorded = savedObs.migration.wishlist.migrated;
  if (!wishes.every((wish) => pending.includes(wish.palId) || recorded[wish.palId])) return { status: 'failed', migrated: 0, pending: pending.length };
  // ③ 既読の写しは要らない（新しい通知も前のウィッシュリストと同じ id の形で出す。ideals.js の goalObservationSource）
  if (pending.length) return { status: 'partial', migrated, pending: pending.length };
  // ④ すべて移せたら、旧キーを消して終わった時刻を書く
  try {
    savedObs.migration.wishlist.doneAt = new Date(now()).toISOString();
    storage.setItem(obsKey, JSON.stringify(savedObs));
    storage.removeItem(wishKey);
  } catch {
    return { status: 'failed', migrated, pending: 0 };
  }
  return { status: 'done', migrated, pending: 0 };
}
