// 配合牧場に今置いてある組と、配合の計画（core/ideal.js の idealPlan）を比べる。DOM には触れない。
// 遺伝の仕組みは使わない（計画の結果とその物差し、目標が産まれる向きの一覧 layouts だけを受け取る）。

/** 組を見分けるキー（♂ と ♀ の個体 ID）。 */
export const planPairKey = (male, female) => `${male.id}|${female.id}`;
const pairKey = planPairKey;

// 所持パルのデータの牧場の形: { id, baseId, parents: 個体 ID[], status?: 'ok' | 'uncertain' }。
// uncertain は親が読めない・食い違う牧場（parents は引けた親だけ）。status のない古いデータ（IndexedDB・共有）は ok とみなす

/** 判定に使える牧場（状態が ok か、状態のない古いデータ）。 */
export const readyFarms = (farms) => (farms ?? []).filter((farm) => !farm.status || farm.status === 'ok');

/**
 * 牧場の情報がそろっているか。判定に使えない牧場（uncertain など）が 1 つでもある、または partial（共有で牧場が一部だけ。
 * farm-data で足す印）なら complete: false（交換推奨・空き牧場・使用中の判定を保留する。欠けた牧場で誤った交換を勧めない）
 * @returns {{ complete: boolean, uncertain: number, partial: boolean }} uncertain は判定に使えない牧場の数
 */
export function farmCompleteness(farms, { partial = false } = {}) {
  const uncertain = (farms ?? []).length - readyFarms(farms).length;
  return { complete: !uncertain && !partial, uncertain, partial: Boolean(partial) };
}

/** 空いている牧場（状態が ok で親が 2 体未満）。 */
export const emptyFarms = (farms) => readyFarms(farms).filter((farm) => farm.parents.length < 2);

// 0 → A、25 → Z、26 → AA
const farmLetter = (index) => (index < 26 ? String.fromCharCode(65 + index) : farmLetter(Math.floor(index / 26) - 1) + farmLetter(index % 26));

/**
 * 牧場の表示名（例「拠点 1 の牧場 A」）。拠点に 2 つ以上あるときだけ、拠点ごとに牧場の ID の順で A, B…を付ける。
 * 読めない牧場も含めた全体の牧場で数え、目標ごとに変えない（記号が目標や読めた牧場の数で変わらない）
 * @param {(baseId: string) => string} baseLabel 拠点の名前（分からなければ空。「拠点の牧場」になる）
 * @returns {Map<string, string>} 牧場 ID → 名前（farms の順）
 */
export function farmNames(farms, baseLabel) {
  const byBase = new Map();
  for (const farm of farms ?? []) {
    if (!byBase.has(farm.baseId)) byBase.set(farm.baseId, []);
    byBase.get(farm.baseId).push(farm.id);
  }
  const letters = new Map();
  for (const ids of byBase.values()) {
    if (ids.length < 2) continue;
    [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).forEach((id, i) => letters.set(id, farmLetter(i)));
  }
  return new Map((farms ?? []).map((farm) => {
    const label = baseLabel(farm.baseId);
    const name = label ? `${label} の牧場` : '拠点の牧場';
    return [farm.id, letters.has(farm.id) ? `${name} ${letters.get(farm.id)}` : name];
  }));
}

/**
 * 目標の牧場（targetIds）以外の牧場（判定に使える牧場だけ）に入っている個体 → その牧場 ID。
 * 理想個体の計画で、ほかの配合に使っている親に「別の配合牧場で使用中」の印を付ける（計画からは外さない）
 * @param {Set<string>} targetIds この目標の組が入っている牧場の ID（所持者で絞る前の候補で求めたもの）
 */
export function farmsInUse(farms, targetIds) {
  const inUse = new Map();
  for (const farm of readyFarms(farms)) {
    if (targetIds.has(farm.id)) continue;
    for (const id of farm.parents) if (!inUse.has(id)) inUse.set(id, farm.id);
  }
  return inUse;
}

/**
 * 今この目標の組が入っている配合牧場。親が 2 体とも候補（pals）にいて、♂ と ♀ で、目標が産まれる向き（layouts）のもの。
 * ほかのパルを配合している牧場・空いている牧場・親が候補にいない（所持者で絞った）牧場・読めない牧場は対象にしない。
 * @param {{ id: string, baseId: string, parents: string[], status?: string }[]} farms 所持パルのデータの farms
 * @param {object[]} pals 計画に渡した個体（所持者で絞ったもの）
 * @param {{ male: string, female: string }[]} layouts 計画の結果の layouts
 */
export function targetFarms(farms, pals, layouts) {
  const byId = new Map(pals.map((pal) => [pal.id, pal]));
  const ways = new Set(layouts.map((layout) => `${layout.male}|${layout.female}`));
  const found = [];
  for (const farm of readyFarms(farms)) {
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
 * 有効数字 12 桁に丸めた値どうしの比較（負なら a が小さい）。core/ideal.js の並びと同じ丸め
 * （このファイルは core/ideal.js を読み込めないので、同じものを持つ）。丸めは単調なので、離れた値は丸めずに比べる
 */
function compareRounded(a, b) {
  if (a === b) return 0;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a < b ? -1 : 1;
  if (Math.abs(a - b) > 1e-9 * Math.max(Math.abs(a), Math.abs(b))) return a - b;
  return Number(a.toPrecision(12)) - Number(b.toPrecision(12));
}

// 組がない（相手がいなくなる）牧場の物差し。どの組よりも悪い
const EMPTY = Object.freeze({ status: 'blocked' });

/**
 * 牧場 1 か所の完成の速さ（1 個のタマゴあたり）。完全体作成組は 1 ÷ 完成までの平均、それ以外の組は 1 個のタマゴで完成する確率
 * （親を替えないときの速さ）。完成しない組・組がない牧場は 0
 */
function farmRate(measure) {
  if (measure?.status !== 'ok') return 0;
  if (measure.rank === 0) return Number.isFinite(measure.eggs) && measure.eggs > 0 ? 1 / measure.eggs : 0;
  return measure.chance > 0 ? measure.chance : 0;
}

// 準備の組どうしの比べ方（負なら a が良い）: 組の目的 → 目的ごとの物差し（丸める）。組がない・完成しない組は一番悪い
function compareMeasure(a, b) {
  const rankA = a?.status === 'ok' ? a.rank : Infinity;
  const rankB = b?.status === 'ok' ? b.rank : Infinity;
  if (rankA !== rankB) return rankA < rankB ? -1 : 1;
  if (rankA === Infinity) return 0;
  if (rankA === 0) return compareRounded(a.eggs, b.eggs);
  if (rankA === 1) return (b.gathered - a.gathered) || compareRounded(b.gatherChance, a.gatherChance);
  return compareRounded(a.talentEggs, b.talentEggs);
}

/**
 * 交換の案を、個体をやり取りする牧場のまとまりごとに、今と比べて採るか決める（measureOf があるとき）。
 * 牧場全体の完成の速さの目安 R（牧場ごとの farmRate の合計）が上がるまとまりだけ交換を勧め、上がらなければ、
 * まとまりの牧場を全部「そのまま」にする（keep。rank は今の組の順位のまま、to・in・out はなし）。
 * 今も案も R = 0（どの牧場もまだ完成できない、準備の組だけ）のときだけ、どの牧場も悪くならず 1 か所以上が良くなる案を採る。
 * R は各牧場が一定の確率で完成するとみなした目安で、入れ替えながら作る過程は数えない（牧場が 1 か所なら正確）。
 * 物差しが分からない組と、同じ組み合わせで別の子も登録されている組（ambiguous。どちらかの登録が間違っている可能性があり、
 * 速さは目標が産まれる前提の値）を含むまとまりは比べられないので、案（おすすめの順）のとおりにする
 */
function settleByRate(advice, pairs, measureOf) {
  // 牧場を頂点にし、交換で入れる個体の移動元の牧場とつなぐ（無向。つながったものは推移的に 1 つのまとまり）。
  // パルボックスやほかの目標の牧場から入れる個体は移動元の頂点がないので、この目標の速さだけで比べる
  const farmOf = new Map();
  advice.forEach((item, i) => {
    farmOf.set(item.farm.male.id, i);
    farmOf.set(item.farm.female.id, i);
  });
  const root = advice.map((_, i) => i);
  const find = (i) => (root[i] === i ? i : (root[i] = find(root[i])));
  advice.forEach((item, i) => {
    for (const pal of item.status === 'swap' ? item.in : []) {
      const from = farmOf.get(pal.id);
      if (from !== undefined) root[find(from)] = find(i);
    }
  });
  const groups = new Map();
  advice.forEach((item, i) => {
    const key = find(i);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  for (const members of groups.values()) {
    // 交換も、ほかの牧場へ個体を出すこともないまとまり（そのまま・置く組のない牧場）は比べない
    if (!members.some((item) => item.status === 'swap' || item.out?.length)) continue;
    const now = members.map((item) => measureOf(planPairKey(item.farm.male, item.farm.female)));
    const next = members.map((item, i) => (item.status === 'swap' ? measureOf(planPairKey(pairs[item.to].male, pairs[item.to].female))
      : item.out?.length ? EMPTY : now[i]));
    if ([...now, ...next].some((measure) => !measure || measure.ambiguous)) continue;
    const before = now.reduce((sum, measure) => sum + farmRate(measure), 0);
    const after = next.reduce((sum, measure) => sum + farmRate(measure), 0);
    const order = compareRounded(after, before);
    const better = order > 0 || (order === 0 && before === 0 && after === 0
      && next.every((measure, i) => compareMeasure(measure, now[i]) <= 0) && next.some((measure, i) => compareMeasure(measure, now[i]) < 0));
    if (better) continue;
    for (const item of members) {
      item.status = 'keep';
      delete item.to;
      delete item.in;
      delete item.out;
    }
  }
}

/**
 * 牧場ごとの判定。対象の牧場が K か所なら、計画の上から K 組を置くべき組とする。
 * 置いてある組がその中にあれば keep（そのまま）、なければ、まだどの牧場にもない組を swap（交換推奨）として割り当てる。
 * 親の片方がすでに入っている牧場を先に選び、1 体の入れ替えで済むようにする。計画の組が足りなければ none。
 * measureOf（組のキー → idealPlan の物差し { status, rank〔組の目的〕, ambiguous, eggs, gathered, gatherChance, talentEggs, chance }）を渡すと、
 * 牧場全体の完成の速さの目安が上がる交換だけを勧める（settleByRate）。見送った牧場は keep で、rank が -1 か K 以上になる。
 * 遺伝の計算は持たず、受け取った数だけを比べる。measureOf がなければ、上から K 組との比較だけで決める
 * @returns {{ farm: object, status: 'keep'|'swap'|'none', rank: number, to?: number, out?: object[], in?: object[] }[]}
 *   rank は置いてある組の計画での順位（0 から。計画になければ -1）、to は交換先の組の順位、out は外す個体、in は入れる個体
 */
export function farmAdvice(farms, pairs, { measureOf } = {}) {
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
  if (measureOf) settleByRate(advice, pairs, measureOf);
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

