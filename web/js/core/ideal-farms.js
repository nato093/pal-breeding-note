// 配合牧場に今置いてある組と、配合の計画（core/ideal.js の idealPlan）を比べる。DOM には触れない。
// 遺伝の仕組みは使わない（計画の結果と、目標が産まれる向きの一覧 layouts だけを受け取る）。

/** 組を見分けるキー（♂ と ♀ の個体 ID）。 */
export const planPairKey = (male, female) => `${male.id}|${female.id}`;
const pairKey = planPairKey;

/**
 * 今この目標の組が入っている配合牧場。親が 2 体とも候補（pals）にいて、♂ と ♀ で、目標が産まれる向き（layouts）のもの。
 * ほかのパルを配合している牧場・空いている牧場・親が候補にいない（所持者で絞った）牧場は対象にしない。
 * @param {{ id: string, baseId: string, parents: string[] }[]} farms 所持パルのデータの farms
 * @param {object[]} pals 計画に渡した個体（所持者で絞ったもの）
 * @param {{ male: string, female: string }[]} layouts 計画の結果の layouts
 */
export function targetFarms(farms, pals, layouts) {
  const byId = new Map(pals.map((pal) => [pal.id, pal]));
  const ways = new Set(layouts.map((layout) => `${layout.male}|${layout.female}`));
  const found = [];
  for (const farm of farms ?? []) {
    if (farm.parents.length !== 2) continue;
    const parents = farm.parents.map((id) => byId.get(id));
    const male = parents.find((pal) => pal?.gender === 'M');
    const female = parents.find((pal) => pal?.gender === 'F');
    if (!male || !female || !ways.has(`${male.palId}|${female.palId}`)) continue;
    found.push({ id: farm.id, baseId: farm.baseId, male, female });
  }
  return found;
}

/**
 * 牧場ごとの判定。対象の牧場が K か所なら、計画の上から K 組を置くべき組とする。
 * 置いてある組がその中にあれば keep（そのまま）、なければ、まだどの牧場にもない組を swap（交換推奨）として割り当てる。
 * 親の片方がすでに入っている牧場を先に選び、1 体の入れ替えで済むようにする。計画の組が足りなければ none。
 * @returns {{ farm: object, status: 'keep'|'swap'|'none', rank: number, to?: number, out?: object[], in?: object[] }[]}
 *   rank は置いてある組の計画での順位（0 から。計画になければ -1）、to は交換先の組の順位、out は外す個体、in は入れる個体
 */
export function farmAdvice(farms, pairs) {
  const top = pairs.slice(0, farms.length);
  const rankOf = new Map(pairs.map((pair, i) => [pairKey(pair.male, pair.female), i]));
  const advice = farms.map((farm) => {
    const rank = rankOf.get(pairKey(farm.male, farm.female)) ?? -1;
    return { farm, rank, status: rank >= 0 && rank < top.length ? 'keep' : '' };
  });
  const placed = new Set(advice.filter((item) => item.status === 'keep').map((item) => item.rank));
  const waiting = advice.filter((item) => !item.status);
  top.forEach((pair, i) => {
    if (placed.has(i) || !waiting.length) return;
    const shares = waiting.findIndex(({ farm }) => farm.male.id === pair.male.id || farm.female.id === pair.female.id);
    const [item] = waiting.splice(Math.max(0, shares), 1);
    const now = [item.farm.male, item.farm.female];
    const next = [pair.male, pair.female];
    Object.assign(item, {
      status: 'swap', to: i,
      out: now.filter((pal) => !next.some((other) => other.id === pal.id)),
      in: next.filter((pal) => !now.some((other) => other.id === pal.id)),
    });
  });
  // 置く組がない牧場でも、ほかの牧場の交換に使う個体は外す
  const moving = new Set(top.flatMap((pair) => [pair.male.id, pair.female.id]));
  for (const item of waiting) {
    item.status = 'none';
    item.out = [item.farm.male, item.farm.female].filter((pal) => moving.has(pal.id));
  }
  return advice;
}

/** 対象の牧場の中身（どの牧場にどの組か）。変わったら、置き直したとみなす。 */
export function farmSignature(farms) {
  return farms.map((farm) => `${farm.id}:${pairKey(farm.male, farm.female)}`).sort().join(',');
}

/**
 * 「変更あり」の判定。牧場に置く組（対象の牧場が size か所なら、計画の上から size 組）のうち、
 * 基準（牧場の中身が最後に変わったときの計画）の上から size 組になかった組を返す。それより下の組は牧場に関係しないので返さない。
 * 牧場の中身が基準と違えば、今の計画を新しい基準にする（印は消える）。
 * @param {{ farms: string, pairs: string[] } | null} baseline
 * @param {number} size 対象の牧場の数
 * @returns {{ baseline: { farms: string, pairs: string[] }, changed: Set<string>, reset: boolean }}
 */
export function planChanges(baseline, signature, pairs, size) {
  const keys = pairs.map((pair) => pairKey(pair.male, pair.female));
  if (!baseline || baseline.farms !== signature) return { baseline: { farms: signature, pairs: keys }, changed: new Set(), reset: true };
  // 牧場の中身が同じなら、対象の牧場の数も基準と同じ
  const before = new Set(baseline.pairs.slice(0, size));
  return { baseline, changed: new Set(keys.slice(0, size).filter((key) => !before.has(key))), reset: false };
}

