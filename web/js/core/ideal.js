// 理想個体の親の提案。所持パルから ♂×♀ の 2 体を選び、欲しいパッシブと個体値の目標を満たす子が
// 1 個のタマゴで産まれる確率を出す。
// INV-2 の例外（data/SOURCES.md）: ゲームの遺伝の仕組みの定数と「同じ種族どうしの子は同じ種族」という規則を、
// この提案にだけ使う。定数は Palworld v1.0.5 のゲーム本体（BP_PalGameSetting と配合の処理）で確かめた値。
import { findByChild, findByPair } from './index.js';

export const MAX_WANTED = 4;
// 親から継ぐパッシブの数（1〜4 個）の確率。Combi_PassiveInheritNum = [4, 3, 2, 1]
const INHERIT_COUNT = [0.4, 0.3, 0.2, 0.1];
// 枠が残ったとき、ランダムなパッシブを 0〜3 個足す確率。Combi_PassiveRandomAddNum = [4, 3, 2, 1]
const RANDOM_ADD = [0.4, 0.3, 0.2, 0.1];
const NO_RANDOM = RANDOM_ADD[0];

export const TALENT_KEYS = Object.freeze(['hp', 'shot', 'defense']);
// 個体値を親から写すステータスの組み合わせ（HP・攻撃・防御。1 = どちらかの親の値、0 = 0〜100 の乱数）。
// Combi_TalentInheritNum = [3, 2, 1] で写す数（1〜3）を決める。2 個のときは処理の都合で 3 分の 1 が 3 個とも写すため、
// 3 個とも写すのは 1/6 + 1/9、HP を写すのは 2/3、攻撃・防御は 5/9 になる。
export const TALENT_PATTERNS = Object.freeze([
  { weight: 5 / 18, inherit: [1, 1, 1] },
  { weight: 1 / 9, inherit: [1, 1, 0] },
  { weight: 1 / 9, inherit: [1, 0, 1] },
  { weight: 1 / 6, inherit: [1, 0, 0] },
  { weight: 1 / 6, inherit: [0, 1, 0] },
  { weight: 1 / 6, inherit: [0, 0, 1] },
]);
const INHERIT_RATE = TALENT_KEYS.map((key, s) => TALENT_PATTERNS.reduce((sum, { weight, inherit }) => sum + weight * inherit[s], 0));

// 配合牧場に入れるケーキ。キノコケーキ・豪華野菜ケーキは個体値に +1〜5（ステータスごとに別に引く）、
// スペシャルケーキは継ぐパッシブの数を抽選せず、和集合から 4 個まで継ぐ（残りはランダムで埋まる）。
export const CAKES = Object.freeze([
  ['none', 'ケーキ・野菜ケーキ'],
  ['talent', 'キノコケーキ・豪華野菜ケーキ（個体値 +1〜5）'],
  ['special', 'スペシャルケーキ（パッシブを 4 個まで継ぐ）'],
]);
const BONUS = [1, 2, 3, 4, 5];

export const ORDERS = Object.freeze([
  ['next', '次の 1 回で産まれやすい順'],
  ['generations', '世代を重ねて最短の順'],
]);

export const PASSIVE_MODES = Object.freeze([
  ['include', '欲しいものを全部持つ（他も可）'],
  ['only', '欲しいものだけを持つ'],
]);

function choose(n, r) {
  if (r < 0 || r > n) return 0;
  let value = 1;
  for (let i = 0; i < r; i++) value = value * (n - i) / (i + 1);
  return value;
}

/**
 * 子が欲しいパッシブを持つ確率。親から継ぐ分だけを数え、ランダムに足されて偶然付く分は数えない（下限）。
 * 親のパッシブは和集合から等確率に選ばれるので、どちらの親が持つかや重複は関係しない。
 * @param {number} wanted 欲しいパッシブの数（すべて両親の和集合に含まれるもの）
 * @param {number} pool 両親のパッシブの和集合の数
 * @param {{ mode?: 'include'|'only', cake?: string }} options include は欲しいものを全部持つ（他も可）、only は欲しいものだけ
 */
export function passiveChance(wanted, pool, { mode = 'include', cake = 'none' } = {}) {
  if (wanted > pool || wanted > MAX_WANTED) return 0;
  const special = cake === 'special';
  // スペシャルケーキは足りない枠をランダムで埋めるため、4 個未満の「だけ」にはならない
  const noRandom = special ? 0 : NO_RANDOM;
  if (wanted === 0) return mode === 'include' ? 1 : pool === 0 ? noRandom : 0;
  const counts = special ? [[MAX_WANTED, 1]] : INHERIT_COUNT.map((rate, i) => [i + 1, rate]);
  let total = 0;
  for (const [count, rate] of counts) {
    const picked = Math.min(count, pool);
    if (picked < wanted) continue;
    if (mode !== 'only') total += rate * choose(pool - wanted, picked - wanted) / choose(pool, picked);
    else if (picked === wanted) total += rate / choose(pool, wanted) * (wanted < MAX_WANTED ? noRandom : 1);
  }
  return total;
}

const clampTarget = (value) => {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0;
};

/** 個体値の目標（0〜100 の整数。0 は気にしない）。指定のないものは 100。 */
export function talentTargets(targets = {}) {
  return Object.fromEntries(TALENT_KEYS.map((key) => [key, targets[key] === undefined ? 100 : clampTarget(targets[key])]));
}

// 0〜100 の乱数（等確率として扱う）が target 以上になる確率
const randomAtLeast = (target) => Math.max(0, Math.min(101, 101 - target)) / 101;
// ケーキの加算は 5 通りそれぞれで判定して平均する（平均の +3 で代用すると、97 から 100 を狙う確率が 3/5 ではなく 1 になる）
const inheritedHit = (value, target, bonus) => (bonus ? BONUS.filter((b) => value + b >= target).length / BONUS.length : value >= target ? 1 : 0);
const randomHit = (target, bonus) => (bonus ? BONUS.reduce((sum, b) => sum + randomAtLeast(target - b), 0) / BONUS.length : randomAtLeast(target));
const inheritedMean = (value, bonus) => (bonus ? BONUS.reduce((sum, b) => sum + Math.min(100, value + b), 0) / BONUS.length : value);
const RANDOM_MEAN = [false, true].map((bonus) => {
  let sum = 0;
  for (let r = 0; r <= 100; r++) sum += inheritedMean(r, bonus);
  return sum / 101;
});

function combine(inherited, random) {
  let total = 0;
  for (const { weight, inherit } of TALENT_PATTERNS) {
    let rate = weight;
    for (let s = 0; s < 3; s++) rate *= inherit[s] ? inherited[s] : random[s];
    total += rate;
  }
  return total;
}

/**
 * 子の個体値が目標をすべて満たす確率。ステータスごとに、どちらかの親の値（50/50）を写すか 0〜100 の乱数になる。
 * 3 つのステータスは独立ではない（3 つとも写すことが多い）ため、パターンごとに掛け合わせる。
 * @param {{ hp: number, shot: number, defense: number }} a 親の個体値
 * @param {{ hp: number, shot: number, defense: number }} b もう一方の親の個体値
 * @param {{ hp?: number, shot?: number, defense?: number }} targets 目標（0 は気にしない）
 */
export function talentChance(a, b, targets, { cake = 'none' } = {}) {
  const goal = talentTargets(targets);
  const bonus = cake === 'talent';
  const inherited = TALENT_KEYS.map((key) => (inheritedHit(a[key], goal[key], bonus) + inheritedHit(b[key], goal[key], bonus)) / 2);
  return combine(inherited, TALENT_KEYS.map((key) => randomHit(goal[key], bonus)));
}

/** 子の個体値の期待値（3 つの合計）。 */
export function talentExpectation(a, b, { cake = 'none' } = {}) {
  const bonus = cake === 'talent';
  return TALENT_KEYS.reduce((sum, key, s) => sum
    + INHERIT_RATE[s] * (inheritedMean(a[key], bonus) + inheritedMean(b[key], bonus)) / 2
    + (1 - INHERIT_RATE[s]) * RANDOM_MEAN[Number(bonus)], 0);
}

// 親の性別で子が変わる組み合わせ。ゲーム本体の DT_PalCombiUnique（v1.0.5、全 258 行）で性別の指定があるのはこの組だけ
// （フォレーナ♂ × クレメーオ♀ → クレメーナ、フォレーナ♀ × クレメーオ♂ → フォレーオ）。性別を入れ替えた向きを同じ子とみなさない
const GENDER_DEPENDENT = Object.freeze([['FoxMage', 'CatMage']]);
const genderDependent = (a, b) => GENDER_DEPENDENT.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

// レコードの親の性別条件が、♂ を male・♀ を female の種族にする置き方と合うか（空の条件はどちらでもよい）。
// レコードの親の順番は決まっていないので、両方の向きを調べる
function fitsLayout(record, male, female) {
  const first = record.parent1Gender ?? '';
  const second = record.parent2Gender ?? '';
  return (record.parent1Id === male && record.parent2Id === female && first !== 'F' && second !== 'M')
    || (record.parent1Id === female && record.parent2Id === male && first !== 'M' && second !== 'F');
}

/**
 * 目標の子が産まれる親の種族の置き方（♂の種族 × ♀の種族）。同じ種族どうし（規則）と、登録済みの配合から作る。
 * 親の性別が記録された登録（自動登録など）は、性別を入れ替えても同じ子が産まれるとみなし、入れ替えた向きも
 * swapped（性別を入れ替えた向き・未検証）として候補にする（性別で子が変わる組み合わせは除く）。
 * 置き方に合う登録に目標と別の子があれば ambiguous（目標が産まれるとは限らない）、
 * 性別を入れ替えた向きや、性別条件のある登録、同じ組み合わせから別の子も登録されているものは unverified にする。
 */
export function breedingLayouts(index, target) {
  const layouts = new Map();
  const add = (male, female, source) => {
    const key = `${male}|${female}`;
    if (!layouts.has(key)) layouts.set(key, { male, female, sources: [] });
    if (source) layouts.get(key).sources.push(source);
  };
  add(target, target, { kind: 'same' });
  for (const record of findByChild(index, target)) {
    const { parent1Id: a, parent2Id: b } = record;
    // 両親が同じ性別の登録は配合できないので使わない
    if (record.parent1Gender && record.parent1Gender === record.parent2Gender) continue;
    for (const [male, female] of a === b ? [[a, b]] : [[a, b], [b, a]]) {
      const swapped = !fitsLayout(record, male, female);
      if (swapped && genderDependent(a, b)) continue;
      add(male, female, { kind: 'record', record, swapped });
    }
  }
  for (const layout of layouts.values()) {
    const records = findByPair(index, layout.male, layout.female);
    const fitting = records.filter((record) => fitsLayout(record, layout.male, layout.female));
    // 同じ種族どうしは性別に関係しない（自動登録は親の性別を必ず記録するため、その性別は条件とみなさない）
    const same = layout.sources.some((source) => source.kind === 'same');
    layout.swapped = !same && layout.sources.every((source) => source.swapped);
    layout.ambiguous = fitting.some((record) => record.childId !== target);
    layout.unverified = layout.ambiguous || (!same && (layout.swapped || genderDependent(layout.male, layout.female)
      || fitting.some((record) => record.parent1Gender || record.parent2Gender)
      || new Set(records.map((record) => record.childId)).size > 1));
  }
  return [...layouts.values()];
}

/**
 * 親の候補にできる個体か。タマゴ（孵化するまで牧場に置けない）とグローバルパルボックスの個体は使わない。
 * 産まれたタマゴは、孵化させて受け取ると候補に入る。
 */
export const isParentCandidate = (pal) => !pal.egg && pal.place !== 'global';

const compareIds = (a, b) => (a.male.id < b.male.id ? -1 : a.male.id > b.male.id ? 1 : 0)
  || (a.female.id < b.female.id ? -1 : a.female.id > b.female.id ? 1 : 0);

// 並び（次の 1 回）: 条件を満たしうる組 → 目標が確実に産まれる組 → 1 個のタマゴの成功率 → 個体値の期待値 → 余計なパッシブが少ない → 個体 ID
function compare(a, b) {
  return Number(b.chance > 0) - Number(a.chance > 0) || Number(a.ambiguous) - Number(b.ambiguous)
    || b.chance - a.chance || b.expected - a.expected || a.extraCount - b.extraCount || compareIds(a, b);
}

// 並び（世代を重ねる）: 完成品までのタマゴの平均数が少ない組（届かない組は最後。キノコケーキでは目安 → 上限）
// → 1 個のタマゴの成功率 → 個体値の期待値 → 余計なパッシブの数 → 個体 ID
function compareGenerations(a, b) {
  return (a.generations - b.generations || 0) || (a.generationsUpper - b.generationsUpper || 0) || b.chance - a.chance
    || b.expected - a.expected || a.extraCount - b.extraCount || compareIds(a, b);
}

// 並び（配合の計画）: 組の目的（rank。PLAN_GROUPS の順）→ 同じ組み合わせで別の子も登録されている組（ambiguous）を後ろに →
// 目的ごとの物差し → 個体値の期待値 → 余計なパッシブの数 → 個体 ID（全順序）。
// 完全体作成組は完成までのタマゴの平均（eggs）、パッシブ厳選組は集まる欲しいパッシブの数と全部継ぐ確率、
// 個体値厳選組は個体値がそろうまでのタマゴの平均（talentEggs）で比べる
function comparePlan(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  const head = Number(a.ambiguous) - Number(b.ambiguous);
  if (head) return head;
  const measure = a.rank === 0 ? (a.eggs - b.eggs || 0) || b.chance - a.chance
    : a.rank === 1 ? b.gathered - a.gathered || b.gatherChance - a.gatherChance
      : (a.talentEggs - b.talentEggs || 0) || b.talentChance - a.talentChance;
  return measure || b.expected - a.expected || a.extraCount - b.extraCount || compareIds(a, b);
}

// ---------------------------------------------------------------------------
// 世代を重ねて最短の順。同じ種族どうしで、欲しいパッシブを全部持つ子は同じ性別の親と入れ替えてよいとして、
// 完成品（パッシブの条件と個体値の目標を全部満たす子）が産まれるまでのタマゴの平均数を求める（入れ替えは最適に選ぶ）。
// 仮定: 子の性別は半々。ランダムに足されるパッシブは、欲しいものでも親の余計なものでもない新しいパッシブ。
// 状態は、親ごとの「ステータスが届くか」の 3 ビットと余計なパッシブの数、両親で共有している余計なパッシブの数。
// ケーキなし・スペシャルケーキでは、目標に届かない親の値は役立たない（子の値は写しか乱数）ので 3 ビットで厳密。
// キノコケーキ・豪華野菜ケーキでは目標より下の値が +1〜5 で段階的に上がるので、厳密には解けない。2 つの見積もりを出す。
// - 上限: 「目標−1 以上」だけを届く扱いにし、それより下の親から写した子は届かない扱いにする。実際の平均はこれを超えない
//   （値が高いほど早くなる〔単調〕ので、届く確率を低く見積もった分だけ遅くなる）
// - 目安: 「目標−6 以上」を届く扱いにし、そこから写した子は必ず目標に届くとみなす。目標の少し下からの上昇は早めに、
//   7 下より下からの上昇は数えないので、実際とは上下どちらにもずれうるが、目標の少し下の親が多いときは上限より近い
// どちらも最初の 1 個だけは実際の値で計算する。並べるときは目安を使う。
// ---------------------------------------------------------------------------

const hypergeometric = (population, successes, draws, hits) =>
  choose(successes, hits) * choose(population - successes, draws - hits) / choose(population, draws);

/** 欲しいパッシブを全部持つ子のパッシブの分布（d: 親から継いだ余計の数、e: 余計の合計）。欠ける分は含めない。 */
function usableChildPassives(wanted, pool, cake) {
  if (cake === 'special') {
    const picked = Math.min(MAX_WANTED, pool);
    return picked < wanted ? [] : [{ d: picked - wanted, e: MAX_WANTED - wanted, p: choose(pool - wanted, picked - wanted) / choose(pool, picked) }];
  }
  const out = [];
  INHERIT_COUNT.forEach((rate, i) => {
    const picked = Math.min(i + 1, pool);
    if (picked < wanted) return;
    const all = rate * choose(pool - wanted, picked - wanted) / choose(pool, picked);
    if (picked >= MAX_WANTED) { out.push({ d: picked - wanted, e: picked - wanted, p: all }); return; }
    RANDOM_ADD.forEach((addRate, added) => out.push({ d: picked - wanted, e: picked - wanted + Math.min(added, MAX_WANTED - picked), p: all * addRate }));
  });
  return out;
}

// 子のステータスの結果の確率。s: 目標以上、h: ちょうど目標−1（キノコケーキのときだけ、親として届く扱いになる）
const ALWAYS = Object.freeze({ s: 1, h: 0 });
const NEVER = Object.freeze({ s: 0, h: 0 });
// h は、目標には届かないが「届く」扱いになる範囲（目標−reach〜目標−1）に入る確率
function randomOutcome(target, bonus, reach) {
  if (target <= 0) return ALWAYS;
  if (!bonus) return { s: randomAtLeast(target), h: 0 };
  let h = 0;
  for (const b of BONUS) for (let r = Math.max(0, target - reach - b); r <= Math.min(100, target - 1 - b); r++) h += 1 / 101 / BONUS.length;
  return { s: randomHit(target, true), h };
}
// 実際の値 value の親から写したとき（キノコケーキ）。+1〜5 で目標に届くか、「届く」扱いの範囲に入る
function inheritedOutcome(value, target, reach) {
  if (target <= 0) return ALWAYS;
  const h = BONUS.filter((b) => value + b < target && value + b >= target - reach).length / BONUS.length;
  return { s: inheritedHit(value, target, true), h };
}

/** 両親それぞれから写したときの結果から、子の「届くビット（0..7）+ 8×全部目標以上か」の分布を作る。 */
function childTalentDistribution(fromMale, fromFemale, random) {
  const dist = new Float64Array(16);
  for (const { weight, inherit } of TALENT_PATTERNS) {
    const stat = [0, 1, 2].map((s) => (inherit[s]
      ? { s: (fromMale[s].s + fromFemale[s].s) / 2, h: (fromMale[s].h + fromFemale[s].h) / 2 } : random[s]));
    for (let combo = 0; combo < 27; combo++) {
      let rate = weight;
      let bits = 0;
      let allS = 1;
      for (let s = 0, rest = combo; s < 3; s++, rest = Math.floor(rest / 3)) {
        const kind = rest % 3;
        rate *= kind === 0 ? stat[s].s : kind === 1 ? stat[s].h : 1 - stat[s].s - stat[s].h;
        if (kind !== 2) bits |= 1 << s;
        if (kind !== 0) allS = 0;
      }
      if (rate > 0) dist[bits + 8 * allS] += rate;
    }
  }
  return dist;
}

/**
 * 子のパッシブ（欲しいものを全部持つもの）ごとの、入れ替え先（どちらの親か・余計の数 e・共有数 h）と確率。
 * all はすべて、ineligible はパッシブが完成品の条件を満たさないもの（欲しいものだけ、で余計があるなど）、eligible は満たす確率の合計。
 * ♂ を子と入れ替えると、共有数は「継いだ余計のうち ♀ のもの」（足したものは新しいので共有しない）。子の性別は半々。
 */
function passiveMoves(passives, mode, extrasPool, maleExtras, femaleExtras, ignorePassives) {
  const all = [];
  const ineligible = [];
  let eligible = 0;
  for (const { d, e, p } of passives) {
    const ok = mode !== 'only' || e === 0;
    if (ok) eligible += p;
    for (const [male, other] of [[true, femaleExtras], [false, maleExtras]]) {
      for (let h = 0; h <= Math.min(d, other); h++) {
        const share = ignorePassives ? Number(h === 0) : hypergeometric(extrasPool, other, d, h);
        if (!share) continue;
        const move = { male, e: ignorePassives ? 0 : e, h, p: p * share / 2 };
        all.push(move);
        if (!ok) ineligible.push(move);
      }
    }
  }
  return { all, ineligible, eligible };
}

/**
 * 1 個のタマゴの結果を、成功の確率と、入れ替えられる子（欲しいパッシブを全部持つ）の行き先に分ける。
 * visit(male, childBits, childExtras, shared, rate) に入れ替え先ごとの確率を渡す。
 */
function eggOutcomes({ talent, moves, forced, visit }) {
  let success = 0;
  for (let key = 0; key < 16; key++) {
    const rate = talent[key];
    if (!rate) continue;
    const bits = (key & 7) | forced;
    // 個体値が全部目標以上なら、パッシブも条件を満たす分は完成品
    if (key >= 8) success += rate * moves.eligible;
    for (const move of key >= 8 ? moves.ineligible : moves.all) visit(move.male, bits, move.e, move.h, rate * move.p);
  }
  return success;
}

function buildGenerationTable(wanted, mode, cake, goal, reach) {
  const bonus = cake === 'talent';
  const ignorePassives = mode !== 'only' && wanted === 0;
  const limit = ignorePassives ? 0 : MAX_WANTED - wanted;
  const span = limit + 1;
  const forced = TALENT_KEYS.reduce((bits, key, s) => (goal[key] <= 0 ? bits | (1 << s) : bits), 0);
  const random = TALENT_KEYS.map((key) => randomOutcome(goal[key], bonus, reach));
  const outcomeOf = (bits) => [0, 1, 2].map((s) => ((bits >> s) & 1 ? ALWAYS : NEVER));
  const indexOf = (bm, em, bf, ef, c) => (((bm * span + em) * 8 + bf) * span + ef) * span + c;
  const size = 64 * span ** 3;
  const valid = new Uint8Array(size);
  const success = new Float64Array(size);
  const predecessors = Array.from({ length: size }, () => []);
  const talentCache = new Map();
  const passiveCache = new Map();
  const childPassives = (extrasPool) => {
    if (!passiveCache.has(extrasPool)) {
      passiveCache.set(extrasPool, ignorePassives ? [{ d: 0, e: 0, p: 1 }] : usableChildPassives(wanted, wanted + extrasPool, cake));
    }
    return passiveCache.get(extrasPool);
  };
  const moveCache = new Map();
  const movesFor = (em, ef, c) => {
    const key = (em * span + ef) * span + c;
    if (!moveCache.has(key)) moveCache.set(key, passiveMoves(childPassives(em + ef - c), mode, em + ef - c, em, ef, ignorePassives));
    return moveCache.get(key);
  };
  for (let bm = 0; bm < 8; bm++) for (let bf = 0; bf < 8; bf++) {
    if ((bm & forced) !== forced || (bf & forced) !== forced) continue;
    const talentKey = bm * 8 + bf;
    if (!talentCache.has(talentKey)) talentCache.set(talentKey, childTalentDistribution(outcomeOf(bm), outcomeOf(bf), random));
    const talent = talentCache.get(talentKey);
    for (let em = 0; em <= limit; em++) for (let ef = 0; ef <= limit; ef++) for (let c = 0; c <= Math.min(em, ef); c++) {
      const s = indexOf(bm, em, bf, ef, c);
      valid[s] = 1;
      const next = new Map();
      success[s] = eggOutcomes({
        talent, moves: movesFor(em, ef, c), forced,
        visit: (male, bits, e, shared, rate) => {
          const u = male ? indexOf(bits, e, bf, ef, shared) : indexOf(bm, em, bits, e, shared);
          if (u !== s) next.set(u, (next.get(u) ?? 0) + rate);
        },
      });
      for (const [u, rate] of next) predecessors[u].push(s, rate);
    }
  }
  // V(s) = (1 + Σ P·V(s')) / (成功の確率 + Σ P)。入れ替えるのは V(s') < V(s) のときだけなので、V の小さい状態から確定していく
  const value = new Float64Array(size).fill(Infinity);
  const sum = new Float64Array(size);
  const weight = Float64Array.from(success);
  const tentative = Float64Array.from(success, (rate) => (rate > 0 ? 1 / rate : Infinity));
  const settled = new Uint8Array(size);
  // 仮の平均の小さい順に取り出す（値を下げたら積み直し、古い項目は取り出したときに捨てる）
  const heap = [];
  const push = (s) => {
    heap.push([tentative[s], s]);
    for (let i = heap.length - 1; i > 0;) {
      const parent = (i - 1) >> 1;
      if (heap[parent][0] <= heap[i][0]) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let small = i;
        if (left < heap.length && heap[left][0] < heap[small][0]) small = left;
        if (right < heap.length && heap[right][0] < heap[small][0]) small = right;
        if (small === i) break;
        [heap[small], heap[i]] = [heap[i], heap[small]];
        i = small;
      }
    }
    return top;
  };
  for (let s = 0; s < size; s++) if (valid[s] && Number.isFinite(tentative[s])) push(s);
  while (heap.length) {
    const [at, best] = pop();
    if (settled[best] || at !== tentative[best]) continue;
    settled[best] = 1;
    value[best] = at;
    const list = predecessors[best];
    for (let i = 0; i < list.length; i += 2) {
      const p = list[i];
      if (settled[p] || !(value[best] < tentative[p])) continue;
      sum[p] += list[i + 1] * value[best];
      weight[p] += list[i + 1];
      tentative[p] = (1 + sum[p]) / weight[p];
      push(p);
    }
  }
  return {
    wanted, mode, cake, goal, bonus, reach, ignorePassives, limit, forced, random, movesFor, firstTalent: new Map(),
    value: (bm, em, bf, ef, c) => (ignorePassives ? value[indexOf(bm | forced, 0, bf | forced, 0, 0)] : value[indexOf(bm | forced, em, bf | forced, ef, c)]),
  };
}

// 目安で「届く」扱いにする幅（目標−6 以上。6 下は +5 で目標−1 になり、その次は必ず届くため）
const ESTIMATE_REACH = 6;
const GENERATION_TABLES = new Map();
const GENERATION_TABLE_LIMIT = 8;

/**
 * 設定（欲しい数・条件・ケーキ・目標）ごとの表。作り直さないよう、新しく使ったものから 8 件まで覚える。
 * bound はキノコケーキのときの見積もり（'upper': 上限、'estimate': 目安）。ほかのケーキでは厳密なので関係しない。
 */
export function generationTable({ wanted = 0, mode = 'include', cake = 'none', targets = {}, bound = 'upper' } = {}) {
  const goal = talentTargets(targets);
  const reach = cake !== 'talent' ? 0 : bound === 'estimate' ? ESTIMATE_REACH : 1;
  const key = [wanted, mode, cake, goal.hp, goal.shot, goal.defense, reach].join('|');
  let table = GENERATION_TABLES.get(key);
  if (table) GENERATION_TABLES.delete(key);
  else table = buildGenerationTable(wanted, mode, cake, goal, reach);
  GENERATION_TABLES.set(key, table);
  if (GENERATION_TABLES.size > GENERATION_TABLE_LIMIT) GENERATION_TABLES.delete(GENERATION_TABLES.keys().next().value);
  return table;
}

/**
 * 世代の平均を決める値の段階（0..12）。キノコケーキでは「目標−1 以上」・最初の 1 個の結果が変わる下の各値・それより下を分ける
 * （+1〜5 で「届く」扱いの範囲〔目標−reach 以上〕に入りうるのは 5+reach 下まで）。それ以外は届くかどうかだけ。
 */
function stageOf(value, target, table) {
  if (target <= 0) return 1;
  if (!table.bonus) return Number(value >= target);
  const gap = target - value;
  return gap <= 1 ? 1 : gap <= 5 + table.reach ? gap : 6 + table.reach;
}
const STAGES = 13;
const FIRST_TALENT_LIMIT = 100000;

/** 親の「届くビット」（キノコケーキでは目標−reach 以上）。 */
function reachBits(talent, table) {
  return TALENT_KEYS.reduce((bits, key, s) => (talent[key] >= table.goal[key] - (table.bonus ? table.reach : 0) || table.goal[key] <= 0 ? bits | (1 << s) : bits), 0);
}

/**
 * 実際の 2 体から、完成品が産まれるまでのタマゴの平均数。余計なパッシブの数と共有数は呼び出し側で数える。
 * ケーキなし・スペシャルケーキでは表をそのまま引く。キノコケーキでは最初の 1 個だけ実際の値で遷移を計算し、
 * 今の 2 体のまま続けるか、入れ替えて表の状態へ進むかを選ぶ（入れ替え先の平均の小さい順に足していく）。
 */
export function generationEggs(table, male, female, { maleExtras = 0, femaleExtras = 0, shared = 0 } = {}) {
  const bm = reachBits(male, table);
  const bf = reachBits(female, table);
  if (!table.bonus) return table.value(bm, maleExtras, bf, femaleExtras, shared);
  // 子の個体値の分布は両親の値の段階だけで決まるので、表ごとに覚えておく（多くなりすぎたら捨てる）
  const stages = (talent) => TALENT_KEYS.reduce((code, key, s) => code + stageOf(talent[key], table.goal[key], table) * STAGES ** s, 0);
  const talentKey = stages(male) * STAGES ** 3 + stages(female);
  let talent = table.firstTalent.get(talentKey);
  if (!talent) {
    talent = childTalentDistribution(
      TALENT_KEYS.map((key) => inheritedOutcome(male[key], table.goal[key], table.reach)),
      TALENT_KEYS.map((key) => inheritedOutcome(female[key], table.goal[key], table.reach)), table.random);
    if (table.firstTalent.size >= FIRST_TALENT_LIMIT) table.firstTalent.clear();
    table.firstTalent.set(talentKey, talent);
  }
  const rates = [];
  const values = [];
  const extras = table.ignorePassives ? [0, 0, 0] : [maleExtras, femaleExtras, shared];
  const success = eggOutcomes({
    talent, moves: table.movesFor(...extras), forced: table.forced,
    visit: (male, bits, e, h, rate) => {
      const value = male ? table.value(bits, e, bf, femaleExtras, h) : table.value(bm, maleExtras, bits, e, h);
      if (Number.isFinite(value)) { rates.push(rate); values.push(value); }
    },
  });
  // V = (1 + Σ P·V') / (成功の確率 + Σ P) を、入れ替え先が V より小さいものだけで満たす値を求める。
  // 全部入れた値から始めて、V 以上の入れ替え先を外しては計算し直す（V は下がる一方で、数回で止まる）
  let estimate = Infinity;
  for (;;) {
    let sum = 0;
    let weight = success;
    for (let i = 0; i < values.length; i++) {
      if (values[i] < estimate) { sum += rates[i] * values[i]; weight += rates[i]; }
    }
    const next = weight > 0 ? (1 + sum) / weight : Infinity;
    if (!(next < estimate)) return next;
    estimate = next;
  }
}

/**
 * 所持パルの中から、理想個体の親の組（♂×♀）を確率の高い順に出す。
 * 候補は、タマゴ・グローバルパルボックス・人間・性別不明を除く個体。
 * order が 'generations' のときは、同じ種族どうしで、欲しいパッシブをそれぞれが全部持つ個体だけを候補にし、
 * 世代を重ねて完成品が産まれるまでのタマゴの平均数（generations）の少ない順に並べる。
 * 配合牧場に置く組の計画は idealPlan。
 * @param {{ pals: object[], index: object, target: string, passives?: string[], mode?: 'include'|'only',
 *   targets?: { hp?: number, shot?: number, defense?: number }, cake?: string, order?: 'next'|'generations', limit?: number }} input
 * @returns {{ pairs: object[], total: number, layouts: object[], candidates: number, unknownGender: number, missing: string[],
 *   complete: { M: number, F: number }, tooMany: number }}
 *   total は条件に合う組の数（上位 limit 件に切り詰める前）。missing は候補のどの個体も持たない欲しいパッシブ。
 *   complete は欲しいパッシブを全部持つ ♂・♀ の数、tooMany は世代の計算で扱えない（パッシブが 5 個以上の）個体の数
 */
export function idealPairs({
  pals, index, target, passives = [], mode = 'include', targets = {}, cake = 'none', order = 'next', limit = 20,
}) {
  const wanted = [...new Set(passives)].slice(0, MAX_WANTED);
  const goal = talentTargets(targets);
  const bonus = cake === 'talent';
  const generations = order === 'generations';
  // 世代を重ねると子が目標の種族になり、異種の配合の次の結果は分からないので、同じ種族どうしだけ
  const layouts = breedingLayouts(index, target).filter((layout) => !generations || (layout.male === target && layout.female === target));
  const complete = { M: 0, F: 0 };
  let tooMany = 0;
  const species = new Set(layouts.flatMap((layout) => [layout.male, layout.female]));
  const full = (1 << wanted.length) - 1;
  // 個体ごとの下ごしらえ（欲しいパッシブの持ち方・目標に届く確率・期待値）。組ごとには足し算と掛け算だけにする
  const groups = new Map();
  const held = new Set();
  let candidates = 0;
  let unknownGender = 0;
  for (const pal of pals) {
    if (!species.has(pal.palId) || !isParentCandidate(pal)) continue;
    if (pal.gender !== 'M' && pal.gender !== 'F') { unknownGender++; continue; }
    candidates++;
    const own = [...new Set(pal.passives)];
    let mask = 0;
    wanted.forEach((id, bit) => { if (own.includes(id)) { mask |= 1 << bit; held.add(id); } });
    if (generations) {
      // 世代の計算では、親それぞれが欲しいパッシブを全部持つ（パッシブがそろっている前提）。5 個以上は表で扱えない
      if (mask !== full) continue;
      if (own.length > MAX_WANTED) { tooMany++; continue; }
      complete[pal.gender]++;
    }
    const entry = {
      pal, own, mask, extras: own.filter((id) => !wanted.includes(id)), stage: [0, 0],
      hit: TALENT_KEYS.map((key) => inheritedHit(pal.talent[key], goal[key], bonus)),
      mean: TALENT_KEYS.map((key) => inheritedMean(pal.talent[key], bonus)),
    };
    const key = `${pal.palId}|${pal.gender}`;
    if (!groups.has(key)) groups.set(key, new Map());
    const byMask = groups.get(key);
    if (!byMask.has(mask)) byMask.set(mask, []);
    byMask.get(mask).push(entry);
  }
  const random = TALENT_KEYS.map((key) => randomHit(goal[key], bonus));
  const randomMean = RANDOM_MEAN[Number(bonus)];
  // 和集合の数ごとの確率は、組ごとに計算せず覚えておく
  const passiveRates = [];
  const passiveRate = (pool) => (passiveRates[pool] ??= passiveChance(wanted.length, pool, { mode, cake }));
  const keep = Math.max(1, Math.trunc(Number(limit)) || 1);
  const ranking = generations ? compareGenerations : compare;
  // 表は ♂・♀ がそろうときだけ作る（作るのに時間がかかる）。キノコケーキでは目安と上限の 2 つ
  const tables = generations && complete.M && complete.F
    ? (bonus ? ['estimate', 'upper'] : ['upper']).map((bound) => generationTable({ wanted: wanted.length, mode, cake, targets: goal, bound })) : [];
  if (tables.length) {
    for (const byMask of groups.values()) for (const list of byMask.values()) for (const entry of list) {
      entry.stage = tables.map((table) => TALENT_KEYS.reduce((code, key, s) => code + stageOf(entry.pal.talent[key], goal[key], table) * STAGES ** s, 0));
    }
  }
  // 世代の平均は、両親の値の段階と余計なパッシブの数・共有数だけで決まるので、この呼び出しの間だけ覚えておく
  const eggsCaches = tables.map(() => new Map());
  const generationsOf = (male, female, shared) => tables.map((table, i) => {
    const extras = { maleExtras: male.extras.length, femaleExtras: female.extras.length, shared };
    if (!bonus) return generationEggs(table, male.pal.talent, female.pal.talent, extras);
    const key = (((male.stage[i] * STAGES ** 3 + female.stage[i]) * 5 + extras.maleExtras) * 5 + extras.femaleExtras) * 5 + shared;
    let eggs = eggsCaches[i].get(key);
    if (eggs === undefined) {
      eggs = generationEggs(table, male.pal.talent, female.pal.talent, extras);
      eggsCaches[i].set(key, eggs);
    }
    return eggs;
  });
  const top = [];
  let total = 0;
  const inherited = [0, 0, 0];
  for (const layout of layouts) {
    const males = groups.get(`${layout.male}|M`);
    const females = groups.get(`${layout.female}|F`);
    if (!males || !females) continue;
    for (const [maleMask, maleList] of males) {
      for (const [femaleMask, femaleList] of females) {
        if ((maleMask | femaleMask) !== full) continue;
        for (const male of maleList) {
          for (const female of femaleList) {
            let shared = 0;
            for (const id of male.own) if (female.own.includes(id)) shared++;
            const pool = male.own.length + female.own.length - shared;
            const passive = passiveRate(pool);
            for (let s = 0; s < 3; s++) inherited[s] = (male.hit[s] + female.hit[s]) / 2;
            const talent = combine(inherited, random);
            let expected = 0;
            for (let s = 0; s < 3; s++) expected += INHERIT_RATE[s] * (male.mean[s] + female.mean[s]) / 2 + (1 - INHERIT_RATE[s]) * randomMean;
            total++;
            const candidate = {
              male: male.pal, female: female.pal, ambiguous: layout.ambiguous, chance: passive * talent, expected, extraCount: pool - wanted.length,
            };
            if (generations) {
              let common = 0;
              for (const id of male.extras) if (female.extras.includes(id)) common++;
              // generations は並べるのに使う値（ケーキなし・スペシャルケーキでは厳密な値、キノコケーキでは目安）、generationsUpper は上限
              const [low, high = low] = generationsOf(male, female, common);
              candidate.generations = low;
              candidate.generationsUpper = high;
            }
            if (top.length >= keep && ranking(candidate, top[top.length - 1]) >= 0) continue;
            Object.assign(candidate, { layout, passiveChance: passive, talentChance: talent, poolSize: pool });
            const at = top.findIndex((item) => ranking(candidate, item) < 0);
            top.splice(at < 0 ? top.length : at, 0, candidate);
            if (top.length > keep) top.pop();
          }
        }
      }
    }
  }
  // 表示用の項目は、上位に残った組にだけ作る
  const pairs = top.map((pair) => {
    const pool = [...new Set([...pair.male.passives, ...pair.female.passives])];
    const extras = pool.filter((id) => !wanted.includes(id));
    return {
      male: pair.male, female: pair.female, sources: pair.layout.sources,
      ambiguous: pair.layout.ambiguous, unverified: pair.layout.unverified, swapped: pair.layout.swapped,
      chance: pair.chance, passiveChance: pair.passiveChance, talentChance: pair.talentChance, expected: pair.expected,
      pool, extras, cleanPassiveChance: extras.length ? passiveChance(wanted.length, wanted.length, { mode, cake }) : pair.passiveChance,
      ...(generations ? { generations: pair.generations, generationsUpper: pair.generationsUpper } : {}),
    };
  });
  return { pairs, total, layouts, candidates, unknownGender, missing: wanted.filter((id) => !held.has(id)), complete, tooMany };
}

// ---------------------------------------------------------------------------
// 配合の計画（配合牧場に上から置く組）
// ---------------------------------------------------------------------------

/** 配合の計画の組の目的（この順に並べる）。complete: 完全体作成組、passive: パッシブ厳選組、talent: 個体値厳選組 */
export const PLAN_GROUPS = Object.freeze(['complete', 'passive', 'talent']);

const bitCount = (mask) => {
  let count = 0;
  for (let rest = mask; rest; rest &= rest - 1) count++;
  return count;
};

/**
 * 配合牧場に上から置く組を、別々の個体で limit 組まで選ぶ（同じ個体は 1 つの牧場にしか置けないので、上の組に使った個体は下の組に使わない）。
 * 組は目的で 3 つに分け、PLAN_GROUPS の順に並べる（comparePlan）。
 * - complete（完全体作成組）: 欲しいパッシブと個体値の目標を全部満たす子（完全体）を作れる組。2 体で欲しいパッシブがそろい、
 *   目標のある各ステータスに目標以上（キノコケーキでは +5 で届く目標−5 以上）の親がいて 1 回で作れる組と、同じ種族で両親とも
 *   欲しいパッシブを全部持ち、子を入れ替えながら作れる組。完成までのタマゴの平均の少ない順（1 回で作れる組も、子を入れ替えた方が早ければその平均）
 * - passive（パッシブ厳選組）: 欲しいパッシブを全部、候補のだれかが持つとき、個体値は見ずに、欲しいパッシブを 1 体に集める組
 *   （2 体で、どちらか 1 体より多くの欲しいパッシブがそろう組。途中まで集める組も含む）。集まる数の多い順 → 全部継ぐ確率の高い順
 * - talent（個体値厳選組）: それ以外。欲しいパッシブを候補のだれも持たない（配合では作れない）ときは全部ここになる。
 *   パッシブは後から付ける前提で見ずに、個体値の目標がそろう子が産まれるまでの平均（同じ種族なら子を入れ替えながら）の少ない順
 * パッシブの条件を満たす子が産まれない組（スペシャルケーキで 4 個未満の「欲しいものだけ」など）は、置いても完成しないので出さず、blocked に数える。
 * @param {{ pals: object[], index: object, target: string, passives?: string[], mode?: 'include'|'only',
 *   targets?: { hp?: number, shot?: number, defense?: number }, cake?: string, limit?: number }} input
 * @returns {{ pairs: object[], total: number, layouts: object[], candidates: number, unknownGender: number, missing: string[],
 *   complete: { M: number, F: number }, tooMany: number, blocked: number }}
 *   total は並べた組の数（blocked を除く）。missing は候補のどの個体も持たない欲しいパッシブ（あれば配合では作れない）
 */
export function idealPlan({ pals, index, target, passives = [], mode = 'include', targets = {}, cake = 'none', limit = 20 }) {
  const wanted = [...new Set(passives)].slice(0, MAX_WANTED);
  const goal = talentTargets(targets);
  const bonus = cake === 'talent';
  // キノコケーキで親の値に足される最大
  const reach = bonus ? BONUS.length : 0;
  const layouts = breedingLayouts(index, target);
  const species = new Set(layouts.flatMap((layout) => [layout.male, layout.female]));
  const full = (1 << wanted.length) - 1;
  const complete = { M: 0, F: 0 };
  const sameSpecies = { M: 0, F: 0 };
  let tooMany = 0;
  let candidates = 0;
  let unknownGender = 0;
  const held = new Set();
  const groups = new Map();
  for (const pal of pals) {
    if (!species.has(pal.palId) || !isParentCandidate(pal)) continue;
    if (pal.gender !== 'M' && pal.gender !== 'F') { unknownGender++; continue; }
    candidates++;
    const own = [...new Set(pal.passives)];
    let mask = 0;
    wanted.forEach((id, bit) => { if (own.includes(id)) { mask |= 1 << bit; held.add(id); } });
    // 子を入れ替えながら完全体を作れる個体（目標と同じ種族で、欲しいパッシブを全部持ち、5 個以上ではない）
    const ready = pal.palId === target && mask === full && own.length <= MAX_WANTED;
    if (ready) complete[pal.gender]++;
    else if (pal.palId === target && mask === full) tooMany++;
    if (pal.palId === target) sameSpecies[pal.gender]++;
    const entry = {
      pal, own, mask, count: bitCount(mask), ready, extras: own.filter((id) => !wanted.includes(id)), stage: [], talentStage: [],
      hit: TALENT_KEYS.map((key) => inheritedHit(pal.talent[key], goal[key], bonus)),
      mean: TALENT_KEYS.map((key) => inheritedMean(pal.talent[key], bonus)),
    };
    const key = `${pal.palId}|${pal.gender}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  const missing = wanted.filter((id) => !held.has(id));
  // 欲しいパッシブを全部、候補のだれかが持つなら、配合で 1 体に集められる
  const breedable = !missing.length;
  // パッシブの条件そのものが満たせない（スペシャルケーキで 4 個未満の「欲しいものだけ」）なら、どの組も完成しない
  const impossible = wanted.length > 0 && passiveChance(wanted.length, wanted.length, { mode, cake }) === 0;
  const random = TALENT_KEYS.map((key) => randomHit(goal[key], bonus));
  const randomMean = RANDOM_MEAN[Number(bonus)];
  const passiveRates = [];
  const passiveRate = (pool) => (passiveRates[pool] ??= passiveChance(wanted.length, pool, { mode, cake }));
  const gatherRates = new Map();
  const gatherRate = (count, pool) => {
    const key = count * 64 + pool;
    if (!gatherRates.has(key)) gatherRates.set(key, passiveChance(count, pool, { mode: 'include', cake }));
    return gatherRates.get(key);
  };
  const keep = Math.max(1, Math.trunc(Number(limit)) || 1);
  // 表は ♂・♀ がそろうときだけ作る（作るのに時間がかかる）。キノコケーキでは目安（並べる）と上限（表示）の 2 つ
  const bounds = bonus ? ['estimate', 'upper'] : ['upper'];
  const completeTables = complete.M && complete.F ? bounds.map((bound) => generationTable({ wanted: wanted.length, mode, cake, targets: goal, bound })) : [];
  // 個体値厳選組の表: パッシブを見ない（欲しいパッシブなし・全部持つ）
  const talentTables = sameSpecies.M && sameSpecies.F ? bounds.map((bound) => generationTable({ wanted: 0, mode: 'include', cake, targets: goal, bound })) : [];
  const stageCode = (talent, table) => TALENT_KEYS.reduce((code, key, s) => code + stageOf(talent[key], goal[key], table) * STAGES ** s, 0);
  for (const list of groups.values()) {
    for (const entry of list) {
      entry.stage = completeTables.map((table) => stageCode(entry.pal.talent, table));
      entry.talentStage = talentTables.map((table) => stageCode(entry.pal.talent, table));
    }
  }
  // 世代の平均は、両親の値の段階と余計なパッシブの数・共有数だけで決まるので、この呼び出しの間だけ覚えておく（キノコケーキのとき）
  const completeCaches = completeTables.map(() => new Map());
  const completeEggs = (male, female, shared, i) => {
    const table = completeTables[i];
    const extras = { maleExtras: male.extras.length, femaleExtras: female.extras.length, shared };
    if (!bonus) return generationEggs(table, male.pal.talent, female.pal.talent, extras);
    const key = (((male.stage[i] * STAGES ** 3 + female.stage[i]) * 5 + extras.maleExtras) * 5 + extras.femaleExtras) * 5 + shared;
    let eggs = completeCaches[i].get(key);
    if (eggs === undefined) completeCaches[i].set(key, eggs = generationEggs(table, male.pal.talent, female.pal.talent, extras));
    return eggs;
  };
  const talentCaches = talentTables.map(() => new Map());
  const talentEggs = (male, female, i) => {
    const table = talentTables[i];
    if (!bonus) return generationEggs(table, male.pal.talent, female.pal.talent);
    const key = male.talentStage[i] * STAGES ** 3 + female.talentStage[i];
    let eggs = talentCaches[i].get(key);
    if (eggs === undefined) talentCaches[i].set(key, eggs = generationEggs(table, male.pal.talent, female.pal.talent));
    return eggs;
  };
  // ♂ ごとに良い組から 2×limit 件だけ残す。上から別々の個体の組を選ぶとき、i 番目に選ばれる組は、
  // その ♂ の組のうち、それまでに使われた ♀（i−1 体以下）の組を除いた一番良い組なので、必ずこの中に入る
  const byMale = new Map();
  const perMale = 2 * keep;
  let total = 0;
  let blocked = 0;
  const inherited = [0, 0, 0];
  for (const layout of layouts) {
    const males = groups.get(`${layout.male}|M`);
    const females = groups.get(`${layout.female}|F`);
    if (!males || !females) continue;
    const same = layout.male === target && layout.female === target;
    for (const male of males) {
      for (const female of females) {
        if (impossible) { blocked++; continue; }
        let shared = 0;
        for (const id of male.own) if (female.own.includes(id)) shared++;
        const pool = male.own.length + female.own.length - shared;
        const union = male.mask | female.mask;
        const passive = union === full ? passiveRate(pool) : 0;
        // 欲しいパッシブがそろう組で、パッシブの条件を満たす子が産まれない（親がパッシブを持つのに「パッシブなし」など）
        if (union === full && !passive) { blocked++; continue; }
        for (let s = 0; s < 3; s++) inherited[s] = (male.hit[s] + female.hit[s]) / 2;
        const talent = combine(inherited, random);
        let expected = 0;
        for (let s = 0; s < 3; s++) expected += INHERIT_RATE[s] * (male.mean[s] + female.mean[s]) / 2 + (1 - INHERIT_RATE[s]) * randomMean;
        total++;
        const candidate = {
          male: male.pal, female: female.pal, layout, ambiguous: layout.ambiguous, entries: [male, female],
          chance: passive * talent, passiveChance: passive, talentChance: talent, expected, extraCount: pool - wanted.length, poolSize: pool,
        };
        let list = byMale.get(male.pal.id);
        if (!list) byMale.set(male.pal.id, list = []);
        const worst = list.length >= perMale ? list[list.length - 1] : null;
        // 完全体作成組: 1 回で作れる組と、子を入れ替えながら作れる組
        const oneShot = candidate.chance > 0
          && TALENT_KEYS.every((key) => goal[key] <= 0 || Math.max(male.pal.talent[key], female.pal.talent[key]) + reach >= goal[key]);
        if (union === full && same && male.ready && female.ready) {
          let common = 0;
          for (const id of male.extras) if (female.extras.includes(id)) common++;
          candidate.generations = completeEggs(male, female, common, 0);
          candidate.shared = common;
        }
        const gathered = bitCount(union);
        if (oneShot || Number.isFinite(candidate.generations)) {
          candidate.rank = 0;
          candidate.eggs = Math.min(candidate.generations ?? Infinity, candidate.chance > 0 ? 1 / candidate.chance : Infinity);
        } else if (breedable && gathered > Math.max(male.count, female.count)) {
          candidate.rank = 1;
          candidate.gathered = gathered;
          candidate.gatherChance = gatherRate(gathered, pool);
        } else {
          candidate.rank = 2;
          // この ♂ の上位が、上の目的の組で埋まっていれば入らないので、個体値がそろうまでの平均を求めない
          if (worst && worst.rank < 2) continue;
          if (same && talentTables.length) candidate.talentGenerations = talentEggs(male, female, 0);
          candidate.talentEggs = Math.min(candidate.talentGenerations ?? Infinity, talent > 0 ? 1 / talent : Infinity);
        }
        if (worst && comparePlan(candidate, worst) >= 0) continue;
        const at = list.findIndex((item) => comparePlan(candidate, item) < 0);
        list.splice(at < 0 ? list.length : at, 0, candidate);
        if (list.length > perMale) list.pop();
      }
    }
  }
  // 上から順に、まだ使っていない個体どうしの組を選ぶ
  const top = [];
  const used = new Set();
  for (const candidate of [...byMale.values()].flat().sort(comparePlan)) {
    if (top.length >= keep) break;
    if (used.has(candidate.male.id) || used.has(candidate.female.id)) continue;
    top.push(candidate);
    used.add(candidate.male.id);
    used.add(candidate.female.id);
  }
  // キノコケーキでは、選んだ組にだけ表示する上限を求める
  for (const pair of top) {
    if (!bonus) continue;
    if (pair.rank === 0 && Number.isFinite(pair.generations)) pair.generationsUpper = completeEggs(...pair.entries, pair.shared, 1);
    if (pair.rank === 2 && Number.isFinite(pair.talentGenerations)) pair.talentGenerationsUpper = talentEggs(...pair.entries, 1);
  }
  const pairs = top.map((pair) => {
    const pool = [...new Set([...pair.male.passives, ...pair.female.passives])];
    const extras = pool.filter((id) => !wanted.includes(id));
    const upper = (value, bound) => (bound === undefined ? value : bound);
    return {
      male: pair.male, female: pair.female, sources: pair.layout.sources,
      ambiguous: pair.layout.ambiguous, unverified: pair.layout.unverified, swapped: pair.layout.swapped,
      group: PLAN_GROUPS[pair.rank], chance: pair.chance, passiveChance: pair.passiveChance, talentChance: pair.talentChance, expected: pair.expected,
      pool, extras, cleanPassiveChance: extras.length ? passiveChance(wanted.length, wanted.length, { mode, cake }) : pair.passiveChance,
      ...(pair.rank === 0 ? { eggs: pair.eggs } : {}),
      ...(pair.rank === 0 && Number.isFinite(pair.generations) ? { generations: pair.generations, generationsUpper: upper(pair.generations, pair.generationsUpper) } : {}),
      ...(pair.rank === 1 ? { gathered: pair.gathered, gatherTotal: wanted.length, gatherChance: pair.gatherChance } : {}),
      ...(pair.rank === 2 ? { talentEggs: pair.talentEggs } : {}),
      ...(pair.rank === 2 && Number.isFinite(pair.talentGenerations)
        ? { talentGenerations: pair.talentGenerations, talentGenerationsUpper: upper(pair.talentGenerations, pair.talentGenerationsUpper) } : {}),
    };
  });
  return { pairs, total, layouts, candidates, unknownGender, missing, complete, tooMany, blocked };
}
