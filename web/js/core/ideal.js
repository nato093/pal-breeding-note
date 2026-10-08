// 理想個体の親の提案。所持パルから ♂×♀ の 2 体を選び、欲しいパッシブと個体値の目標を満たす子が
// 1 個のタマゴで産まれる確率を出す。
// INV-2 の例外（data/SOURCES.md）: ゲームの遺伝の仕組みの定数と「同じ種族どうしの子は同じ種族」という規則を、
// この提案にだけ使う。定数は Palworld v1.0.5 のゲーム本体（BP_PalGameSetting と配合の処理）で確かめた値。
import { findByChild, findByPair } from './index.js';

export const MAX_WANTED = 4;
// 親から継ぐパッシブの数（1〜4 個）の確率。Combi_PassiveInheritNum = [4, 3, 2, 1]
const INHERIT_COUNT = [0.4, 0.3, 0.2, 0.1];
// 枠が残ったとき、ランダムなパッシブを 1 つも足さない確率。Combi_PassiveRandomAddNum = [4, 3, 2, 1] の 0 個
const NO_RANDOM = 0.4;

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

/** 親の候補にできる個体か（タマゴとグローバルパルボックスの個体は使わない）。 */
export const isParentCandidate = (pal) => !pal.egg && pal.place !== 'global';

// 並び: 条件を満たしうる組 → 目標が確実に産まれる組 → 1 個のタマゴの成功率 → 個体値の期待値 → 余計なパッシブが少ない → 個体 ID
function compare(a, b) {
  return Number(b.chance > 0) - Number(a.chance > 0) || Number(a.ambiguous) - Number(b.ambiguous)
    || b.chance - a.chance || b.expected - a.expected
    || a.extraCount - b.extraCount || (a.male.id < b.male.id ? -1 : a.male.id > b.male.id ? 1 : 0)
    || (a.female.id < b.female.id ? -1 : a.female.id > b.female.id ? 1 : 0);
}

/**
 * 所持パルの中から、理想個体の親の組（♂×♀）を確率の高い順に出す。
 * 候補は、タマゴ・グローバルパルボックス・人間・性別不明を除く個体。
 * @param {{ pals: object[], index: object, target: string, passives?: string[], mode?: 'include'|'only',
 *   targets?: { hp?: number, shot?: number, defense?: number }, cake?: string, limit?: number }} input
 * @returns {{ pairs: object[], total: number, layouts: object[], candidates: number, unknownGender: number, missing: string[] }}
 *   total は条件に合う組の数（上位 limit 件に切り詰める前）。missing は候補のどの個体も持たない欲しいパッシブ
 */
export function idealPairs({
  pals, index, target, passives = [], mode = 'include', targets = {}, cake = 'none', limit = 20,
}) {
  const wanted = [...new Set(passives)].slice(0, MAX_WANTED);
  const goal = talentTargets(targets);
  const bonus = cake === 'talent';
  const layouts = breedingLayouts(index, target);
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
    const entry = {
      pal, own, mask,
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
            if (top.length >= keep && compare(candidate, top[top.length - 1]) >= 0) continue;
            Object.assign(candidate, { layout, passiveChance: passive, talentChance: talent, poolSize: pool });
            const at = top.findIndex((item) => compare(candidate, item) < 0);
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
    };
  });
  return { pairs, total, layouts, candidates, unknownGender, missing: wanted.filter((id) => !held.has(id)) };
}
