// パル手術台（UI 改善フェーズ 4 の implants）: 手術台で付けられるパッシブの表（web/data/implants.js。ゲーム本体から取り出したもの）を引く。
// DOM に触れない。INV-2: 手術台は配合ではない。配合表と遺伝の仕組み（core/ideal.js）は読まない。
import implants from '../../data/implants.js';
import { goalAddable } from './ideal-goals.js';
import { internalName } from './boundary.js';

// 種類の呼び名（ゲームのアイテム名の頭と同じ。アイテムのない行は「インプラント不要」）
export const IMPLANT_KINDS = Object.freeze({ free: 'インプラント不要', reusable: 'インプラント', consumable: '使い切りインプラント' });
// 欲しいパッシブの数の上限（core/ideal.js の MAX_WANTED と同じ 4。こちらから core/ideal.js は読まない）
const WANTED_MAX = 4;

const byPassive = new Map(implants.map((entry) => [entry.passiveId, Object.freeze({ item: entry.item, itemName: entry.itemName, kind: entry.kind })]));

/** パル手術台で付けられるなら { item, itemName, kind }（kind は free・reusable・consumable。free は item・itemName が空）、付けられなければ null */
export const implantOf = (passiveId) => byPassive.get(passiveId) ?? null;

/** パル手術台で付けられるか */
export const canImplant = (passiveId) => byPassive.has(passiveId);

/** 必要なもの（「使い切りインプラント：神速」「インプラント：脳筋」、アイテムのない行は「インプラント不要」）。付けられなければ '' */
export function implantNeed(passiveId) {
  const entry = implantOf(passiveId);
  if (!entry) return '';
  return entry.kind === 'free' ? IMPLANT_KINDS.free : entry.itemName || IMPLANT_KINDS[entry.kind];
}

/**
 * 手術で完成できる個体（目標の一覧の「手術で完成できる」。X-26）。判定は手術台の表だけで、在庫は見ない。完成している個体は返さない。
 * 条件（core/ideal-goals.js の goalAddable）: 目標の種族でタマゴでない・個体値の目標を満たす・足りないパッシブが 1 個以上で
 * すべて手術台で付けられる・「欲しいものだけ」なら余計なパッシブの数が足りないパッシブの数以下・付けた後のパッシブが 4 個を超えない
 * @param {object} goal cleanGoal で整えたもの
 * @param {object[]} pals 個体（自分の個体）
 * @returns {{ pal: object, add: string[] }[]} add は手術で付けるパッシブ。付ける数の少ない順 → Lv の高い順
 */
export function goalNear(goal, pals) {
  return goalAddable(goal, pals, canImplant);
}

/**
 * 理想個体の URL の s（手術で付ける前提で計画から除いたパッシブ。X-22）を確かめる。パッシブ ID の形・重なりなし・手術台で付けられる・
 * 欲しいパッシブ（p）と重ならない・p と合わせて 4 個まで、を満たすものだけを残す（順は URL のまま）
 * @param {string} value URL の s の値（カンマ区切り）
 * @param {string[]} wanted URL の p（確かめた後の欲しいパッシブ）
 * @returns {{ ids: string[], changed: boolean }} changed は値を捨てた・並べ直したとき（URL を置き換える）
 */
export function cleanSurgery(value, wanted) {
  const raw = String(value ?? '').split(',').filter(Boolean);
  const ids = [];
  for (const id of raw) {
    if (ids.length + wanted.length >= WANTED_MAX) break;
    if (internalName(id) && canImplant(id) && !wanted.includes(id) && !ids.includes(id)) ids.push(id);
  }
  return { ids, changed: ids.join(',') !== raw.join(',') };
}
