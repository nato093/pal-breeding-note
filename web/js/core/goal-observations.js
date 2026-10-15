// 目標の種族ごとの「配合の登録の観測」（前のウィッシュリストの判定。goals-merge）。保存の形と、1 件の判定・併せ方。DOM・保存先は持たない。
// 保存の形（<namespace>.goalsObs.<env>.<userIdKey>。前の版のタブはこのキーを知らないので書き換えない）:
// { version: 1,
//   species: { [palId]: { craftable, readyAt, observedAt, pairs: string[] | null, found: [{ pair, at }] } },
//   migration: { wishlist: { migrated: { [palId]: goalId }, pending: string[], doneAt: string } } }
// craftable: 最後に判定した「作れるか」 / readyAt: 作れるようになったのを見た時刻（作れない間は空）
// observedAt: 最後の判定に使ったデータのサーバ時刻
// pairs: これまでに見た、その種族が産まれる親の組（null は未確認で、次の判定で通知せずに覚える）
// found: 作れる間に新しく見つかった組と、その時刻（その組の配合がなくなったら外す）
import { pairKey } from './pair.js';

export const OBSERVATIONS_VERSION = 1;
// 種族の数の上限（目標の上限 100 件と、移す前のウィッシュリストの分）
const SPECIES_LIMIT = 300;
const PAL_ID = /^[A-Za-z0-9_]{1,64}$/;
const GOAL_ID = /^[A-Za-z0-9_-]{1,64}$/;
// Object の組み込みの名前（constructor・__proto__ など）は外す（species・migrated を palId で引いたときに継承したものを拾うため）
const palIdOk = (id) => typeof id === 'string' && PAL_ID.test(id) && !Object.hasOwn(Object.prototype, id);

const validTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** 親の組（「A|B」）の形だけを確かめる。マスターにないパルの組も残す（捨てると次の判定で新しく見えて重ねて知らせるため） */
export function cleanPair(value) {
  const ids = typeof value === 'string' ? value.split('|') : [];
  return ids.length === 2 && ids.every(palIdOk) ? pairKey(ids[0], ids[1]) : '';
}

/** 1 種族の観測を整える（形が合わなければ null） */
export function cleanEntry(value) {
  if (!isObject(value)) return null;
  const craftable = value.craftable === true;
  const found = craftable && Array.isArray(value.found) ? value.found : [];
  return {
    craftable,
    readyAt: craftable && validTime(value.readyAt) ? value.readyAt : '',
    observedAt: validTime(value.observedAt) ? value.observedAt : '',
    pairs: Array.isArray(value.pairs) ? [...new Set(value.pairs.map(cleanPair).filter(Boolean))] : null,
    found: found.map((item) => ({ pair: cleanPair(item?.pair), at: item?.at })).filter((item) => item.pair && validTime(item.at)),
  };
}

/** 保存した値を整える（読めない・形が合わないものは空の形にする） */
export function cleanObservations(value) {
  const source = isObject(value) && value.version === OBSERVATIONS_VERSION ? value : {};
  const species = {};
  for (const [palId, entry] of Object.entries(isObject(source.species) ? source.species : {}).slice(0, SPECIES_LIMIT)) {
    const clean = palIdOk(palId) ? cleanEntry(entry) : null;
    if (clean) species[palId] = clean;
  }
  const wish = isObject(source.migration?.wishlist) ? source.migration.wishlist : {};
  const migrated = {};
  for (const [palId, goalId] of Object.entries(isObject(wish.migrated) ? wish.migrated : {}).slice(0, SPECIES_LIMIT)) {
    if (palIdOk(palId) && typeof goalId === 'string' && GOAL_ID.test(goalId)) migrated[palId] = goalId;
  }
  const pending = Array.isArray(wish.pending) ? [...new Set(wish.pending.filter(palIdOk))].slice(0, SPECIES_LIMIT) : [];
  return {
    version: OBSERVATIONS_VERSION,
    species,
    migration: { wishlist: { migrated, pending, doneAt: validTime(wish.doneAt) ? wish.doneAt : '' } },
  };
}

/** 保存した JSON の文字列から読む */
export function parseObservations(source) {
  let value = null;
  try { value = JSON.parse(source); } catch { value = null; }
  return cleanObservations(value);
}

/** 初めての観測（その時点の組を覚えるだけで、作れても知らせない。登録した時点で作れるものは知らせない） */
export function firstObservation(currentPairs, serverTime) {
  return { craftable: currentPairs.length > 0, readyAt: '', observedAt: validTime(serverTime) ? serverTime : '', pairs: [...currentPairs], found: [] };
}

/**
 * 1 種族の観測を、新しいデータ（currentPairs は今の登録の親の組、serverTime はそのデータの時刻、time は今の時刻）で進める。
 * 作れる状態が続いている間に増えた組だけを found に足す（作れるようになったときは readyAt だけ）。一度見た組は、消えてから
 * また登録されても知らせない（削除の元に戻すなどで重ねて知らせないため）。根拠の配合がなくなった found は消す
 */
export function observeSpecies(entry, currentPairs, serverTime, time) {
  const current = [...new Set(currentPairs)];
  const craftable = current.length > 0;
  const added = entry.craftable && craftable && entry.pairs ? current.filter((pair) => !entry.pairs.includes(pair)) : [];
  return {
    ...entry, craftable, readyAt: craftable ? (entry.craftable ? entry.readyAt : time) : '', observedAt: serverTime,
    pairs: [...new Set([...entry.pairs ?? [], ...current])],
    found: [...entry.found.filter((item) => current.includes(item.pair)), ...added.map((pair) => ({ pair, at: time }))],
  };
}

const later = (a, b) => (Date.parse(a) >= Date.parse(b) ? a : b);
const earlier = (a, b) => (!a ? b : !b ? a : Date.parse(a) <= Date.parse(b) ? a : b);

/** 2 つの観測を併せる（pairs・found は和、craftable は observedAt の新しい方、readyAt は早い方） */
export function mergeObservation(a, b) {
  if (!a) return b;
  if (!b) return a;
  const newer = Date.parse(b.observedAt) > Date.parse(a.observedAt) ? b : a;
  const craftable = newer.craftable;
  const found = new Map();
  for (const item of [...a.found, ...b.found]) if (!found.has(item.pair) || Date.parse(item.at) < Date.parse(found.get(item.pair).at)) found.set(item.pair, item);
  return {
    craftable,
    readyAt: craftable ? earlier(a.craftable ? a.readyAt : '', b.craftable ? b.readyAt : '') : '',
    observedAt: a.observedAt && b.observedAt ? later(a.observedAt, b.observedAt) : a.observedAt || b.observedAt,
    pairs: a.pairs || b.pairs ? [...new Set([...a.pairs ?? [], ...b.pairs ?? []])] : null,
    found: craftable ? [...found.values()] : [],
  };
}

/** 保存の値どうしを併せる（名前の変更で移し先にもあったとき。source を優先し、species は mergeObservation、移行の記録は和） */
export function mergeObservations(source, target) {
  const a = cleanObservations(source);
  const b = cleanObservations(target);
  const species = { ...b.species };
  for (const [palId, entry] of Object.entries(a.species)) species[palId] = mergeObservation(entry, b.species[palId]);
  const [wa, wb] = [a.migration.wishlist, b.migration.wishlist];
  return cleanObservations({
    version: OBSERVATIONS_VERSION, species,
    migration: { wishlist: {
      migrated: { ...wb.migrated, ...wa.migrated },
      pending: [...new Set([...wa.pending, ...wb.pending])].filter((palId) => !wa.migrated[palId] && !wb.migrated[palId]),
      doneAt: wa.doneAt && wb.doneAt ? later(wa.doneAt, wb.doneAt) : '',
    } },
  });
}
