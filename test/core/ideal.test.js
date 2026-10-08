import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../../web/js/core/index.js';
import {
  passiveChance, talentChance, talentExpectation, talentTargets, breedingLayouts, idealPairs, idealPlan, PLAN_GROUPS, isParentCandidate, TALENT_PATTERNS,
  generationTable, generationEggs,
} from '../../web/js/core/ideal.js';

const master = ['A', 'B', 'X', 'Y'].map((id, no) => ({ id, no, variant: false }));
const rec = (id, parent1Id, parent2Id, childId, parent1Gender = '', parent2Gender = '') => ({ id, parent1Id, parent2Id, childId, parent1Gender, parent2Gender });
const index = (records = []) => buildIndex(records, master);
const talent = (hp = 0, shot = 0, defense = 0) => ({ hp, shot, defense });
const pal = (id, palId, gender, passives = [], stats = talent(), extra = {}) => ({
  id, palId, gender, passives, talent: stats, egg: false, place: 'palbox', ...extra,
});
// 両親とも 3 つが 100 のとき、子が 3 つとも 100 になる確率（3 つとも写す・2 つ写して残りが乱数で 100・1 つ写して残り 2 つが乱数で 100）
const ALL_100 = 5 / 18 + 2 / (9 * 101) + 1 / (2 * 101 * 101);
const near = (actual, expected, digits = 9) => assert.ok(Math.abs(actual - expected) < 10 ** -digits, `${actual} ≠ ${expected}`);

test('理想個体: 個体値のパターンの確率は合計 1 で、HP は 2/3、攻撃・防御は 5/9 で親から写る', () => {
  near(TALENT_PATTERNS.reduce((sum, { weight }) => sum + weight, 0), 1);
  const rate = (s) => TALENT_PATTERNS.reduce((sum, { weight, inherit }) => sum + weight * inherit[s], 0);
  near(rate(0), 2 / 3);
  near(rate(1), 5 / 9);
  near(rate(2), 5 / 9);
});

test('理想個体: パッシブの確率（欲しい数・和集合の数・条件ごと。継ぐ数 1〜4 個 = 40/30/20/10%）', () => {
  // [欲しい数, 和集合の数, 全部持つ（他も可）, 欲しいものだけ]
  for (const [wanted, pool, include, only] of [
    [1, 1, 1, 0.4], [1, 2, 0.8, 0.08], [1, 5, 0.4, 0.032],
    [2, 2, 0.6, 0.24], [2, 3, 0.4, 0.04], [2, 4, 0.25, 0.02],
    [3, 3, 0.3, 0.12], [3, 4, 0.15, 0.02],
    [4, 4, 0.1, 0.1], [4, 5, 0.02, 0.02], [4, 6, 0.1 / 15, 0.1 / 15],
  ]) {
    near(passiveChance(wanted, pool), include);
    near(passiveChance(wanted, pool, { mode: 'only' }), only);
  }
  // 個体値のケーキはパッシブに関係しない
  near(passiveChance(2, 3, { cake: 'talent' }), 0.4);
});

test('理想個体: スペシャルケーキは和集合から 4 個まで継ぎ、足りない枠はランダムで埋まる', () => {
  near(passiveChance(2, 4, { cake: 'special' }), 1);
  near(passiveChance(2, 6, { cake: 'special' }), 0.4);
  near(passiveChance(4, 4, { cake: 'special' }), 1);
  near(passiveChance(4, 5, { cake: 'special' }), 0.2);
  near(passiveChance(4, 5, { cake: 'special', mode: 'only' }), 0.2);
  // 4 個未満の「だけ」は、残りの枠がランダムで埋まるのでありえない
  assert.equal(passiveChance(2, 2, { cake: 'special', mode: 'only' }), 0);
});

test('理想個体: 欲しいパッシブがない・和集合に足りない場合の端', () => {
  assert.equal(passiveChance(0, 3), 1);
  near(passiveChance(0, 0, { mode: 'only' }), 0.4);
  assert.equal(passiveChance(0, 2, { mode: 'only' }), 0);
  assert.equal(passiveChance(0, 0, { mode: 'only', cake: 'special' }), 0);
  assert.equal(passiveChance(3, 2), 0);
  assert.equal(passiveChance(5, 6), 0);
});

test('理想個体: 個体値は親の値の中間にならず、100/0 の方が 90/90 より 100 に届きやすい', () => {
  const attack = (value) => ({ hp: 0, shot: value, defense: 0 });
  // 攻撃: 親から写る 5/9 × どちらの親か 1/2、乱数は 0〜100 の 101 通り
  near(talentChance(talent(0, 100), talent(0, 0), attack(100)), 5 / 18 + 4 / 9 / 101);
  near(talentChance(talent(0, 90), talent(0, 90), attack(100)), 4 / 9 / 101);
  near(talentChance(talent(0, 90), talent(0, 90), attack(90)), 5 / 9 + 4 / 9 * 11 / 101);
  near(talentChance(talent(0, 100), talent(0, 0), attack(90)), 5 / 18 + 4 / 9 * 11 / 101);
  // HP は写る確率が 2/3 と高い
  near(talentChance(talent(100), talent(0), { hp: 100, shot: 0, defense: 0 }), 1 / 3 + 1 / 3 / 101);
  // 目標 0 は気にしない
  near(talentChance(talent(), talent(), { hp: 0, shot: 0, defense: 0 }), 1);
  // 期待値は 90/90 の方が高い（攻撃のほか、HP と防御は乱数の平均 50 を写す分を含む）
  near(talentExpectation(talent(0, 100), talent(0, 0)) - talentExpectation(talent(0, 0), talent(0, 0)), 5 / 9 * 50);
  near(talentExpectation(talent(0, 90), talent(0, 90)) - talentExpectation(talent(0, 0), talent(0, 0)), 5 / 9 * 90);
});

test('理想個体: 3 つとも 100 の確率は、3 つとも写すパターンがあるため独立の掛け算より高い', () => {
  const all = (value) => talent(value, value, value);
  near(talentChance(all(100), all(100), all(100)), ALL_100);
  near(talentChance(all(100), all(0), all(100)), 0.0353, 4);
  near(talentChance(talent(100, 100, 0), talent(100, 0, 100), all(100)), 0.0706, 4);
  // 100 がどちらの親にあっても同じ
  near(talentChance(talent(100, 100, 0), talent(0, 0, 100), all(100)), talentChance(all(100), all(0), all(100)));
  // どちらの親も 100 に届くステータスがなければ 0（乱数だけになるパターンがない）
  assert.equal(talentChance(all(90), all(90), all(100)), 0);
  near(talentChance(all(90), all(90), all(90)), 0.3079, 4);
});

test('理想個体: キノコケーキの +1〜5 は 5 通りそれぞれで判定する', () => {
  const attack = { hp: 0, shot: 100, defense: 0 };
  const cake = { cake: 'talent' };
  // 90 は +5 しても 100 に届かないので、乱数の分だけ（乱数 + 1〜5 が 100 以上になる確率は 4/101）
  near(talentChance(talent(0, 90), talent(0, 90), attack, cake), 4 / 9 * 4 / 101);
  // 97 は +3・+4・+5 の 3/5 で届く
  near(talentChance(talent(0, 97), talent(0, 97), attack, cake), 5 / 9 * 3 / 5 + 4 / 9 * 4 / 101);
  near(talentChance(talent(0, 95), talent(0, 95), attack, cake), 5 / 9 / 5 + 4 / 9 * 4 / 101);
  near(talentChance(talent(0, 100), talent(0, 0), attack, cake), 5 / 18 + 4 / 9 * 4 / 101);
  // 期待値は上がるが、100 で頭打ちになる
  const all = talent(100, 100, 100);
  assert.ok(talentExpectation(all, all, cake) > talentExpectation(all, all));
  assert.ok(talentExpectation(all, all, cake) < 300);
  near(talentExpectation(talent(0, 97), talent(0, 97), cake) - talentExpectation(talent(), talent(), cake), 5 / 9 * (100 - 3.6));
});

test('理想個体: 個体値の目標は 0〜100 の整数にそろえ、指定がなければ 100', () => {
  assert.deepEqual(talentTargets({}), { hp: 100, shot: 100, defense: 100 });
  assert.deepEqual(talentTargets({ hp: '95.7', shot: -3, defense: 'x' }), { hp: 95, shot: 0, defense: 0 });
  assert.deepEqual(talentTargets({ hp: 250, shot: 0, defense: 50 }), { hp: 100, shot: 0, defense: 50 });
});

test('理想個体: 親の置き方は同じ種族どうしと登録済みの配合から作り、性別を入れ替えた向きも候補にする', () => {
  const layouts = (records) => breedingLayouts(index(records), 'X')
    .map(({ male, female, ambiguous, unverified, swapped, sources }) => [male, female, ambiguous, unverified, swapped, sources.map((s) => s.record?.id ?? s.kind).join(',')]);
  // 登録がなければ同じ種族どうしだけ
  assert.deepEqual(layouts([]), [['X', 'X', false, false, false, 'same']]);
  // 性別条件がなければ両方の向き
  assert.deepEqual(layouts([rec('r1', 'A', 'B', 'X')]), [
    ['X', 'X', false, false, false, 'same'], ['A', 'B', false, false, false, 'r1'], ['B', 'A', false, false, false, 'r1'],
  ]);
  // 性別が記録された登録（自動登録など）は、記録どおりの向きに加えて、性別を入れ替えた向き（未検証）も候補にする。
  // レコードの親の順番は問わない
  assert.deepEqual(layouts([rec('r1', 'B', 'A', 'X', 'F', 'M')]), [
    ['X', 'X', false, false, false, 'same'], ['B', 'A', false, true, true, 'r1'], ['A', 'B', false, true, false, 'r1'],
  ]);
  assert.deepEqual(layouts([rec('r1', 'A', 'B', 'X', '', 'M')]), [
    ['X', 'X', false, false, false, 'same'], ['A', 'B', false, true, true, 'r1'], ['B', 'A', false, true, false, 'r1'],
  ]);
  // 両親とも同じ性別の登録は配合できないので使わない
  assert.deepEqual(layouts([rec('r1', 'A', 'B', 'X', 'M', 'M')]), [['X', 'X', false, false, false, 'same']]);
  // 同じ組み合わせで別の子も登録されていれば、目標が産まれるとは限らない
  assert.deepEqual(layouts([rec('r1', 'A', 'B', 'X'), rec('r2', 'A', 'B', 'Y')]), [
    ['X', 'X', false, false, false, 'same'], ['A', 'B', true, true, false, 'r1'], ['B', 'A', true, true, false, 'r1'],
  ]);
  // 性別を入れ替えた向きに別の子が登録されていれば、その向きは目標が産まれるとは限らない
  assert.deepEqual(layouts([rec('r1', 'A', 'B', 'X', 'M', 'F'), rec('r2', 'A', 'B', 'Y', 'F', 'M')]), [
    ['X', 'X', false, false, false, 'same'], ['A', 'B', false, true, false, 'r1'], ['B', 'A', true, true, true, 'r1'],
  ]);
  // 同じ種族どうしの登録は、規則の置き方に出どころとして足す
  assert.deepEqual(layouts([rec('r1', 'X', 'X', 'X')]), [['X', 'X', false, false, false, 'same,r1']]);
  // 自動登録は親の性別を必ず記録するが、同じ種族どうしは性別に関係しないので未検証にしない
  assert.deepEqual(layouts([rec('r1', 'X', 'X', 'X', 'M', 'F')]), [['X', 'X', false, false, false, 'same,r1']]);
  // 置き方に合う登録は X だけでも、同じ組み合わせで別の子が登録されていれば未検証
  assert.deepEqual(layouts([rec('r1', 'A', 'B', 'X'), rec('r2', 'A', 'B', 'Y', 'F', 'M')]), [
    ['X', 'X', false, false, false, 'same'], ['A', 'B', false, true, false, 'r1'], ['B', 'A', true, true, false, 'r1'],
  ]);
});

test('理想個体: 候補はタマゴ・人間・性別不明・グローバルボックスを除き、確率の高い組から並べる', () => {
  const pals = [
    pal('m1', 'X', 'M', ['P1', 'J1'], talent(100, 100, 100)),
    pal('m2', 'X', 'M', ['P1'], talent(100, 100, 100)),
    pal('f1', 'X', 'F', ['P2'], talent(100, 100, 100)),
    pal('f2', 'X', 'F', ['P2'], talent(0, 0, 0)),
    pal('f3', 'X', 'F', ['P1', 'P2'], talent(100, 100, 100)),
    pal('e1', 'X', 'F', ['P1', 'P2'], talent(100, 100, 100), { egg: true }),
    pal('u1', 'X', '', ['P1', 'P2'], talent(100, 100, 100)),
    pal('g1', 'X', 'F', ['P1', 'P2'], talent(100, 100, 100), { place: 'global' }),
    pal('h1', '', 'F', ['P1', 'P2'], talent(100, 100, 100)),
    pal('y1', 'Y', 'F', ['P1', 'P2'], talent(100, 100, 100)),
  ];
  const result = idealPairs({ pals, index: index(), target: 'X', passives: ['P1', 'P2'] });
  assert.equal(result.candidates, 5);
  assert.equal(result.unknownGender, 1);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.pairs.map((pair) => `${pair.male.id}×${pair.female.id}`), ['m2×f1', 'm2×f3', 'm1×f1', 'm1×f3', 'm2×f2', 'm1×f2']);
  assert.equal(result.total, 6);
  const [best] = result.pairs;
  near(best.passiveChance, 0.6);
  near(best.talentChance, ALL_100);
  near(best.chance, 0.6 * best.talentChance);
  assert.deepEqual(best.extras, []);
  const extra = result.pairs.find((pair) => pair.male.id === 'm1' && pair.female.id === 'f1');
  assert.deepEqual(extra.pool, ['P1', 'J1', 'P2']);
  assert.deepEqual(extra.extras, ['J1']);
  near(extra.passiveChance, 0.4);
  near(extra.cleanPassiveChance, 0.6);
  assert.deepEqual(best.sources, [{ kind: 'same' }]);
  // グローバルパルボックスの個体と、孵化するまで牧場に置けないタマゴは親の候補にしない
  assert.ok(result.pairs.every((pair) => ![pair.male.id, pair.female.id].some((id) => ['g1', 'e1'].includes(id))));
  assert.deepEqual(pals.filter(isParentCandidate).map((item) => item.id), ['m1', 'm2', 'f1', 'f2', 'f3', 'u1', 'h1', 'y1']);
});

test('理想個体: 欲しいパッシブがそろわない組は出さず、だれも持たないパッシブを返す', () => {
  const pals = [pal('m1', 'X', 'M', ['P1']), pal('m2', 'X', 'M', ['P2']), pal('f1', 'X', 'F', ['P3']), pal('f2', 'X', 'F', [])];
  const spread = idealPairs({ pals, index: index(), target: 'X', passives: ['P1', 'P2'] });
  // P1 と P2 は 2 体の ♂ に分かれているので、どの組でもそろわない
  assert.equal(spread.total, 0);
  assert.deepEqual(spread.missing, []);
  const missing = idealPairs({ pals, index: index(), target: 'X', passives: ['P1', 'P4'] });
  assert.equal(missing.total, 0);
  assert.deepEqual(missing.missing, ['P4']);
  // 欲しいパッシブを指定しなければ、すべての組が対象
  assert.equal(idealPairs({ pals, index: index(), target: 'X' }).total, 4);
});

test('理想個体: 登録済みの異種の配合も候補にし、目標が産まれるとは限らない組は後ろに回す', () => {
  const pals = [
    pal('xm', 'X', 'M', [], talent(50, 50, 50)),
    pal('xf', 'X', 'F', [], talent(50, 50, 50)),
    pal('am', 'A', 'M', [], talent(100, 100, 100)),
    pal('bf', 'B', 'F', [], talent(100, 100, 100)),
    pal('bm', 'B', 'M', [], talent(100, 100, 100)),
    pal('af', 'A', 'F', [], talent(100, 100, 100)),
  ];
  const records = [rec('r1', 'A', 'B', 'X', 'M', 'F'), rec('r2', 'A', 'B', 'Y', 'F', 'M'), rec('r3', 'B', 'Y', 'X'), rec('r4', 'B', 'Y', 'A')];
  const pairs = (list) => idealPairs({ pals: list, index: index(records), target: 'X', targets: { hp: 100, shot: 100, defense: 100 } }).pairs
    .map((pair) => [`${pair.male.id}×${pair.female.id}`, pair.ambiguous, pair.unverified]);
  // A♂×B♀ は X、A♀×B♂ は Y の登録なので、性別を入れ替えた B♂×A♀ は目標が産まれるとは限らない組として、確実な組の後ろに回す。
  // 条件を満たせない組（0%）はさらに後ろ
  assert.deepEqual(pairs(pals), [['am×bf', false, true], ['bm×af', true, true], ['xm×xf', false, false]]);
  // B×Y は X と A の両方が登録されているので、確率が高くても確実な組の後ろに回す
  const withY = [...pals, pal('yf', 'Y', 'F', [], talent(100, 100, 100))];
  assert.deepEqual(pairs(withY), [['am×bf', false, true], ['bm×af', true, true], ['bm×yf', true, true], ['xm×xf', false, false]]);
});

test('理想個体: 性別を入れ替えた向きは、同じ子が産まれるとみなして確実な組と同じように並べる', () => {
  // 自動登録で A♀×B♂ → X だけが記録されている
  const records = [rec('r1', 'A', 'B', 'X', 'F', 'M')];
  const pals = [
    pal('am', 'A', 'M', [], talent(100, 100, 100)), pal('bf', 'B', 'F', [], talent(100, 100, 100)),
    pal('af', 'A', 'F', [], talent(90, 90, 90)), pal('bm', 'B', 'M', [], talent(90, 90, 90)),
  ];
  const result = idealPairs({ pals, index: index(records), target: 'X' });
  assert.deepEqual(result.pairs.map((pair) => [`${pair.male.id}×${pair.female.id}`, pair.ambiguous, pair.unverified, pair.swapped]), [
    ['am×bf', false, true, true], ['bm×af', false, true, false],
  ]);
});

test('理想個体: 上位の件数に切り詰めても、条件に合う組の総数を返す', () => {
  const pals = [];
  for (let i = 0; i < 30; i++) pals.push(pal(`m${String(i).padStart(2, '0')}`, 'X', 'M', [], talent(i, i, i)));
  for (let i = 0; i < 30; i++) pals.push(pal(`f${String(i).padStart(2, '0')}`, 'X', 'F', [], talent(i, i, i)));
  const result = idealPairs({ pals, index: index(), target: 'X', targets: { hp: 0, shot: 0, defense: 0 }, limit: 5 });
  assert.equal(result.total, 900);
  assert.equal(result.pairs.length, 5);
  // 確率がすべて 1 のときは、個体値の期待値の高い組から
  assert.deepEqual(result.pairs.map((pair) => `${pair.male.id}×${pair.female.id}`), ['m29×f29', 'm28×f29', 'm29×f28', 'm27×f29', 'm28×f28']);
});

test('理想個体: 組ごとの確率と期待値は、ケーキと条件のどの組み合わせでも公開の関数と一致する', () => {
  let state = 0x1d3a1;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const ids = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5'];
  const pick = () => [...new Set(Array.from({ length: Math.floor(random() * 5) }, () => ids[Math.floor(random() * ids.length)]))];
  const value = () => [0, 50, 90, 95, 97, 100][Math.floor(random() * 6)];
  const pals = Array.from({ length: 24 }, (_, i) => pal(`i${i}`, 'X', i % 2 ? 'F' : 'M', pick(), talent(value(), value(), value())));
  for (const cake of ['none', 'talent', 'special']) {
    for (const mode of ['include', 'only']) {
      for (const passives of [[], ['P0'], ['P0', 'P1']]) {
        const targets = { hp: 95, shot: 100, defense: 0 };
        const result = idealPairs({ pals, index: index(), target: 'X', passives, mode, targets, cake, limit: 200 });
        assert.equal(result.pairs.length, result.total);
        for (const pair of result.pairs) {
          const pool = new Set([...pair.male.passives, ...pair.female.passives]).size;
          near(pair.passiveChance, passiveChance(passives.length, pool, { mode, cake }));
          near(pair.talentChance, talentChance(pair.male.talent, pair.female.talent, targets, { cake }));
          near(pair.expected, talentExpectation(pair.male.talent, pair.female.talent, { cake }));
          near(pair.chance, pair.passiveChance * pair.talentChance);
        }
      }
    }
  }
});

test('理想個体: パッシブの多い個体どうし（和集合 9 個以上）や、件数の上限が 0 でも計算できる', () => {
  const many = ['P0', 'P1', 'P2', 'P3', 'P4'];
  const pals = [pal('m', 'X', 'M', many), pal('f', 'X', 'F', ['Q0', 'Q1', 'Q2', 'Q3', 'Q4'])];
  const [pair] = idealPairs({ pals, index: index(), target: 'X', passives: ['P0'], targets: { hp: 0, shot: 0, defense: 0 } }).pairs;
  near(pair.passiveChance, passiveChance(1, 10));
  near(passiveChance(1, 10), 0.4 / 10 + 0.3 * 2 / 10 + 0.2 * 3 / 10 + 0.1 * 4 / 10);
  assert.equal(idealPairs({ pals, index: index(), target: 'X', limit: 0 }).pairs.length, 1);
});

test('理想個体: 性別で子が変わるフォレーナ×クレメーオだけは、性別を入れ替えた向きを候補にしない', () => {
  const layouts = (records, target) => breedingLayouts(index(records), target)
    .map(({ male, female, ambiguous, unverified, swapped }) => [male, female, ambiguous, unverified, swapped]);
  // フォレーナ♂ × クレメーオ♀ → クレメーナ（自動登録）。入れ替えたフォレーナ♀ × クレメーオ♂ はフォレーオになるので出さない
  assert.deepEqual(layouts([rec('r1', 'CatMage', 'FoxMage', 'CatMage_Fire', 'F', 'M')], 'CatMage_Fire'), [
    ['CatMage_Fire', 'CatMage_Fire', false, false, false], ['FoxMage', 'CatMage', false, true, false],
  ]);
  // 性別のない登録は両方の向きを出すが、性別で子が変わる組なので未検証
  assert.deepEqual(layouts([rec('r1', 'FoxMage', 'CatMage', 'FoxMage_Dark')], 'FoxMage_Dark'), [
    ['FoxMage_Dark', 'FoxMage_Dark', false, false, false], ['FoxMage', 'CatMage', false, true, false], ['CatMage', 'FoxMage', false, true, false],
  ]);
});

// ---------------------------------------------------------------------------
// 世代を重ねて最短の順
// ---------------------------------------------------------------------------

// 表とは別に書いたシミュレーション（実際のパッシブ ID・重なり・子の性別つき）。入れ替えは表の平均が小さくなるときだけ
function simulateGenerations({ wanted, mode = 'include', cake = 'none', targets }, male, female, runs, seed) {
  const table = generationTable({ wanted: wanted.length, mode, cake, targets });
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  const pick = (weights) => { let x = random(); for (let i = 0; i < weights.length; i++) { if (x < weights[i]) return i; x -= weights[i]; } return weights.length - 1; };
  const meets = (v) => ['hp', 'shot', 'defense'].every((key) => v[key] >= targets[key]);
  const valueOf = (a, b) => {
    const ea = a.passives.filter((id) => !wanted.includes(id));
    const eb = b.passives.filter((id) => !wanted.includes(id));
    return generationEggs(table, a.talent, b.talent, { maleExtras: ea.length, femaleExtras: eb.length, shared: ea.filter((id) => eb.includes(id)).length });
  };
  let total = 0;
  let fresh = 0;
  for (let run = 0; run < runs; run++) {
    let a = male;
    let b = female;
    for (let eggs = 1; ; eggs++) {
      const { inherit } = TALENT_PATTERNS[pick(TALENT_PATTERNS.map((pattern) => pattern.weight))];
      const childTalent = {};
      ['hp', 'shot', 'defense'].forEach((key, s) => { childTalent[key] = inherit[s] ? (random() < 0.5 ? a : b).talent[key] : Math.floor(random() * 101); });
      const pool = [...new Set([...a.passives, ...b.passives])];
      const count = cake === 'special' ? Math.min(4, pool.length) : Math.min(pick([0.4, 0.3, 0.2, 0.1]) + 1, pool.length);
      for (let i = 0; i < count; i++) { const j = i + Math.floor(random() * (pool.length - i)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      const passives = pool.slice(0, count);
      const added = cake === 'special' ? 4 - count : count < 4 ? Math.min(pick([0.4, 0.3, 0.2, 0.1]), 4 - count) : 0;
      for (let i = 0; i < added; i++) passives.push(`R${fresh++}`);
      const usable = wanted.every((id) => passives.includes(id));
      if (usable && meets(childTalent) && (mode !== 'only' || passives.length === wanted.length)) { total += eggs; break; }
      if (!usable) continue;
      const child = { talent: childTalent, passives };
      const [na, nb] = random() < 0.5 ? [child, b] : [a, child];
      if (valueOf(na, nb) < valueOf(a, b)) { a = na; b = nb; }
    }
  }
  return total / runs;
}

const ALL = { hp: 100, shot: 100, defense: 100 };
const parent = (value, passives = []) => ({ talent: talent(...value), passives });

test('理想個体（世代）: 子を入れ替えても速くならない場合は、1 回の成功率の逆数になる', () => {
  // 攻撃だけ目標 100。届く子が出たらそれが完成品なので、入れ替えは役に立たない
  const table = generationTable({ wanted: 0, targets: { hp: 0, shot: 100, defense: 0 } });
  near(generationEggs(table, talent(0, 100, 0), talent(0, 0, 0)), 202 / 57);
  // 目標がすべて 0 なら、最初のタマゴで完成（成功を二重に数えない）
  near(generationEggs(generationTable({ wanted: 0, targets: { hp: 0, shot: 0, defense: 0 } }), talent(), talent()), 1);
  // ♂ と ♀ を入れ替えても同じ
  const all = generationTable({ wanted: 0, targets: ALL });
  near(generationEggs(all, talent(100, 100, 100), talent()), generationEggs(all, talent(), talent(100, 100, 100)));
});

test('理想個体（世代）: 表の平均は、実際のパッシブ・重なり・性別で動かすシミュレーションと一致する', () => {
  for (const [settings, male, female, expected, runs] of [
    [{ wanted: [], targets: ALL }, parent([100, 100, 100]), parent([0, 0, 0]), 10.980, 4000],
    [{ wanted: ['W0', 'W1'], targets: ALL }, parent([100, 100, 100], ['W0', 'W1', 'J1']), parent([0, 0, 0], ['W0', 'W1', 'J1']), 33.425, 3000],
    [{ wanted: ['W0'], mode: 'only', targets: ALL }, parent([100, 0, 100], ['W0', 'J1', 'J2']), parent([0, 100, 0], ['W0', 'J1']), 106.119, 1500],
  ]) {
    const table = generationTable({ ...settings, wanted: settings.wanted.length });
    const ex = (p) => p.passives.filter((id) => !settings.wanted.includes(id));
    const exact = generationEggs(table, male.talent, female.talent,
      { maleExtras: ex(male).length, femaleExtras: ex(female).length, shared: ex(male).filter((id) => ex(female).includes(id)).length });
    near(exact, expected, 3);
    const simulated = simulateGenerations(settings, male, female, runs, 20261008);
    // 平均の標準誤差はおよそ 平均/√回数。4 倍までの差は許す
    assert.ok(Math.abs(simulated - exact) < 4 * exact / Math.sqrt(runs), `厳密 ${exact} / シミュレーション ${simulated}`);
  }
});

test('理想個体（世代）: 余計なパッシブを両親で共有していると、別々のときより早い', () => {
  const table = generationTable({ wanted: 2, targets: ALL });
  near(generationEggs(table, talent(100, 100, 100), talent(), { maleExtras: 1, femaleExtras: 1, shared: 1 }), 33.425, 3);
  near(generationEggs(table, talent(100, 100, 100), talent(), { maleExtras: 1, femaleExtras: 1, shared: 0 }), 40.894, 3);
});

test('理想個体（世代）: 1 回の成功率が 0% でも、子を入れ替えていけば届く。届かない条件は無限大', () => {
  const table = generationTable({ wanted: 0, targets: ALL });
  assert.equal(talentChance(talent(90, 90, 90), talent(90, 90, 90), ALL), 0);
  near(generationEggs(table, talent(90, 90, 90), talent(90, 90, 90)), 486.816, 3);
  // 欲しいものだけ（パッシブなし）の子が条件なのに、親がパッシブを持つと子は必ず何か継ぐ
  const only = generationTable({ wanted: 0, mode: 'only', targets: ALL });
  assert.equal(generationEggs(only, talent(100, 100, 100), talent(), { maleExtras: 1 }), Infinity);
  // スペシャルケーキで欲しいもの 2 個だけ、は残りの枠が必ず埋まるので届かない
  assert.equal(generationEggs(generationTable({ wanted: 2, mode: 'only', cake: 'special', targets: ALL }), talent(100, 100, 100), talent(100, 100, 100)), Infinity);
});

test('理想個体（世代）: キノコケーキは多めの見積もりだが、ケーキなしより早く、目標の少し下の親を最初の 1 個で数える', () => {
  const none = generationTable({ wanted: 0, targets: ALL });
  const cake = generationTable({ wanted: 0, cake: 'talent', targets: ALL });
  const all = (v) => talent(v, v, v);
  for (const v of [90, 95, 99]) assert.ok(generationEggs(cake, all(v), all(v)) < generationEggs(none, all(v), all(v)), String(v));
  // 99 は +1〜5 で必ず 100 になる。95 は 1/5 で届く分を最初の 1 個で数えるので、90 より早い
  assert.ok(generationEggs(cake, all(99), all(99)) < 4);
  assert.ok(generationEggs(cake, all(95), all(95)) < generationEggs(cake, all(90), all(90)));
});

test('理想個体（世代）: 欲しいパッシブをそれぞれ全部持つ同じ種族の ♂・♀ だけを、平均の少ない順に並べる', () => {
  const records = [rec('r1', 'A', 'B', 'X')];
  const pals = [
    pal('m1', 'X', 'M', ['P1', 'P2'], talent(100, 100, 100)),
    pal('m2', 'X', 'M', ['P1'], talent(100, 100, 100)), // P2 がないので世代では使わない
    pal('m3', 'X', 'M', ['P1', 'P2', 'J1', 'J2', 'J3'], talent(100, 100, 100)), // 5 個は計算できない
    pal('f1', 'X', 'F', ['P1', 'P2'], talent(90, 90, 90)),
    pal('f2', 'X', 'F', ['P1', 'P2', 'J1'], talent(100, 0, 100)),
    pal('e1', 'X', 'F', ['P1', 'P2'], talent(0, 100, 0), { egg: true }),
    pal('am', 'A', 'M', ['P1', 'P2'], talent(100, 100, 100)),
    pal('bf', 'B', 'F', ['P1', 'P2'], talent(100, 100, 100)),
  ];
  const input = { pals, index: index(records), target: 'X', passives: ['P1', 'P2'], targets: ALL, order: 'generations' };
  const result = idealPairs(input);
  // タマゴの e1 は親の候補にしない
  assert.deepEqual(result.complete, { M: 1, F: 2 });
  assert.equal(result.tooMany, 1);
  assert.equal(result.total, 2);
  // 異種の登録済み配合（A×B）は対象外。初回 0% の m1×f1 も、平均が有限なら普通に並べる
  const order = result.pairs.map((pair) => `${pair.male.id}×${pair.female.id}`);
  assert.deepEqual([...order].sort(), ['m1×f1', 'm1×f2']);
  const values = result.pairs.map((pair) => pair.generations);
  assert.deepEqual(values, [...values].sort((a, b) => a - b));
  assert.ok(values.every(Number.isFinite));
  // 入力の並び順を変えても同じ結果
  assert.deepEqual(idealPairs({ ...input, pals: [...pals].reverse() }).pairs.map((pair) => `${pair.male.id}×${pair.female.id}`), order);
  // 次の 1 回の並べ方は、これまでどおり和集合でそろう組も出す
  assert.ok(idealPairs({ ...input, order: 'next' }).pairs.some((pair) => pair.male.id === 'm2'));
});

// キノコケーキの上限の確かめ: HP だけを目標にし、実際の値（0〜100）をそのまま状態にした厳密な計算と比べる（表とは別の実装）
function exactSingleStat(target) {
  const size = 101 * 101;
  const pInherit = 2 / 3; // HP を写す確率
  const bonus = [1, 2, 3, 4, 5];
  const randomDist = new Float64Array(101);
  for (let r = 0; r <= 100; r++) for (const u of bonus) randomDist[Math.min(100, r + u)] += 1 / 101 / 5;
  const success = new Float64Array(size);
  const preds = Array.from({ length: size }, () => []);
  for (let m = 0; m <= 100; m++) for (let f = 0; f <= 100; f++) {
    const s = m * 101 + f;
    const child = new Float64Array(101);
    for (const u of bonus) { child[Math.min(100, m + u)] += pInherit / 2 / 5; child[Math.min(100, f + u)] += pInherit / 2 / 5; }
    for (let v = 0; v <= 100; v++) child[v] += (1 - pInherit) * randomDist[v];
    for (let v = 0; v <= 100; v++) {
      if (!child[v]) continue;
      if (v >= target) { success[s] += child[v]; continue; }
      for (const u of [v * 101 + f, m * 101 + v]) if (u !== s) preds[u].push(s, child[v] / 2);
    }
  }
  const value = new Float64Array(size).fill(Infinity);
  const sum = new Float64Array(size);
  const weight = Float64Array.from(success);
  const tentative = Float64Array.from(success, (rate) => (rate > 0 ? 1 / rate : Infinity));
  const settled = new Uint8Array(size);
  for (;;) {
    let best = -1;
    for (let s = 0; s < size; s++) if (!settled[s] && tentative[s] < (best < 0 ? Infinity : tentative[best])) best = s;
    if (best < 0) break;
    settled[best] = 1;
    value[best] = tentative[best];
    for (let i = 0; i < preds[best].length; i += 2) {
      const p = preds[best][i];
      if (settled[p] || !(value[best] < tentative[p])) continue;
      sum[p] += preds[best][i + 1] * value[best];
      weight[p] += preds[best][i + 1];
      tentative[p] = (1 + sum[p]) / weight[p];
    }
  }
  return (m, f) => value[m * 101 + f];
}

test('理想個体（世代）: キノコケーキの上限は実際の値で解いた厳密な値を下回らず、目安は上限以下で、目標の少し下では上限より近い', () => {
  const hp = (value) => talent(value, 0, 0);
  for (const target of [100, 50, 6, 1]) {
    const exact = exactSingleStat(target);
    const table = generationTable({ wanted: 0, cake: 'talent', targets: { hp: target, shot: 0, defense: 0 } });
    const estimateTable = generationTable({ wanted: 0, cake: 'talent', targets: { hp: target, shot: 0, defense: 0 }, bound: 'estimate' });
    for (const [m, f] of [[94, 94], [93, 93], [0, 0], [90, 95], [99, 50], [100, 0], [target - 6, target - 2]].filter(([a, b]) => a >= 0 && b >= 0)) {
      const upper = generationEggs(table, hp(m), hp(f));
      const estimate = generationEggs(estimateTable, hp(m), hp(f));
      assert.ok(upper >= exact(m, f) - 1e-9, `目標 ${target}・${m}×${f}: 上限 ${upper} < 厳密 ${exact(m, f)}`);
      assert.ok(estimate <= upper + 1e-9, `目標 ${target}・${m}×${f}: 目安 ${estimate} > 上限 ${upper}`);
      // 上限が目安の 1.5 倍を超えて離れる（目標の少し下からの上昇を数えない分が大きい）ときは、目安の方が厳密な値に近い
      if (upper > 1.5 * estimate) assert.ok(Math.abs(estimate - exact(m, f)) <= Math.abs(upper - exact(m, f)) + 1e-9, `目標 ${target}・${m}×${f}`);
    }
  }
  // 目標 1 以下なら、+1〜5 でどの値からでも必ず届く
  near(generationEggs(generationTable({ wanted: 0, cake: 'talent', targets: { hp: 1, shot: 0, defense: 0 } }), hp(0), hp(0)), 1);
});

test('理想個体（世代）: キノコケーキで、目標の 6 下（94）と 7 下以下（93）を取り違えない', () => {
  const table = generationTable({ wanted: 0, cake: 'talent', targets: ALL });
  const estimateTable = generationTable({ wanted: 0, cake: 'talent', targets: ALL, bound: 'estimate' });
  const all = (v) => talent(v, v, v);
  // 94 は +5 で 99 になり、次の親として届く扱いになるので、93 より早い
  assert.ok(generationEggs(table, all(94), all(94)) < generationEggs(table, all(93), all(93)));
  // 組ごとの覚え方でも取り違えない（同じ呼び出しで 94 と 93 の組を並べる）
  const pals = [
    pal('m94', 'X', 'M', [], all(94)), pal('f94', 'X', 'F', [], all(94)),
    pal('m93', 'X', 'M', [], all(93)), pal('f93', 'X', 'F', [], all(93)),
  ];
  const result = idealPairs({ pals, index: index(), target: 'X', targets: ALL, cake: 'talent', order: 'generations' });
  for (const pair of result.pairs) {
    near(pair.generations, generationEggs(estimateTable, pair.male.talent, pair.female.talent));
    near(pair.generationsUpper, generationEggs(table, pair.male.talent, pair.female.talent));
  }
  assert.equal(`${result.pairs[0].male.id}×${result.pairs[0].female.id}`, 'm94×f94');
});

test('理想個体（世代）: キノコケーキは目安で並べ、目標の少し下どうしの組を前に出す', () => {
  const pals = [
    pal('m95', 'X', 'M', [], talent(95, 95, 95)), pal('f95', 'X', 'F', [], talent(95, 95, 95)),
    pal('m99', 'X', 'M', [], talent(99, 99, 0)), pal('f99', 'X', 'F', [], talent(0, 0, 99)),
  ];
  const result = idealPairs({ pals, index: index(), target: 'X', targets: ALL, cake: 'talent', order: 'generations' });
  const best = result.pairs[0];
  assert.equal(`${best.male.id}×${best.female.id}`, 'm95×f95');
  assert.ok(best.generations < best.generationsUpper);
  // ケーキなしでは 1 つの厳密な値
  const none = idealPairs({ pals, index: index(), target: 'X', targets: ALL, order: 'generations' });
  for (const pair of none.pairs) assert.equal(pair.generations, pair.generationsUpper);
});

test('理想個体（世代）: 組ごとの平均は、余計なパッシブの数・共有数が違っても取り違えない', () => {
  const pals = [
    pal('m0', 'X', 'M', ['P1'], talent(100, 100, 100)), pal('m1', 'X', 'M', ['P1', 'J1'], talent(100, 100, 100)),
    pal('m2', 'X', 'M', ['P1', 'J1', 'J2'], talent(97, 97, 97)),
    pal('f0', 'X', 'F', ['P1'], talent(96, 0, 96)), pal('f1', 'X', 'F', ['P1', 'J1'], talent(96, 0, 96)),
    pal('f2', 'X', 'F', ['P1', 'J2', 'J3'], talent(0, 99, 0)),
  ];
  for (const cake of ['none', 'talent', 'special']) {
    const result = idealPairs({ pals, index: index(), target: 'X', passives: ['P1'], targets: ALL, cake, order: 'generations', limit: 20 });
    assert.equal(result.pairs.length, 9);
    const upper = generationTable({ wanted: 1, cake, targets: ALL });
    const estimate = generationTable({ wanted: 1, cake, targets: ALL, bound: 'estimate' });
    for (const pair of result.pairs) {
      const ex = (p) => p.passives.filter((id) => id !== 'P1');
      const extras = { maleExtras: ex(pair.male).length, femaleExtras: ex(pair.female).length, shared: ex(pair.male).filter((id) => ex(pair.female).includes(id)).length };
      near(pair.generations, generationEggs(cake === 'talent' ? estimate : upper, pair.male.talent, pair.female.talent, extras));
      near(pair.generationsUpper, generationEggs(upper, pair.male.talent, pair.female.talent, extras));
    }
  }
});

test('理想個体（世代）: スペシャルケーキの有限な平均も、シミュレーションと一致する', () => {
  const settings = { wanted: ['W0', 'W1'], cake: 'special', targets: ALL };
  const male = parent([100, 0, 100], ['W0', 'W1', 'J1']);
  const female = parent([0, 100, 0], ['W0', 'W1']);
  const table = generationTable({ ...settings, wanted: 2 });
  const exact = generationEggs(table, male.talent, female.talent, { maleExtras: 1, femaleExtras: 0, shared: 0 });
  assert.ok(Number.isFinite(exact));
  const runs = 3000;
  const simulated = simulateGenerations(settings, male, female, runs, 77);
  assert.ok(Math.abs(simulated - exact) < 4 * exact / Math.sqrt(runs), `厳密 ${exact} / シミュレーション ${simulated}`);
});

// ---------------------------------------------------------------------------
// 配合の計画（完全体作成組・パッシブ厳選組・個体値厳選組の順に、別々の個体の組を上から選ぶ）
// ---------------------------------------------------------------------------

const planOf = (pals, extra = {}) => idealPlan({ pals, index: index(extra.records ?? []), target: 'X', targets: ALL, ...extra });
const names = (result) => result.pairs.map((pair) => `${pair.male.id}×${pair.female.id}:${pair.group}`);
assert.deepEqual(PLAN_GROUPS, ['complete', 'passive', 'talent']);

test('理想個体（計画）: 完全体を作れる組を一番上に、次に欲しいパッシブを集める組、最後に個体値だけを狙う組', () => {
  const pals = [
    pal('mA', 'X', 'M', ['P1', 'P2'], talent(100, 100, 100)),
    pal('fB', 'X', 'F', ['P1', 'P2'], talent(90, 90, 90)),
    pal('mC', 'X', 'M', ['P1'], talent(50, 50, 50)),
    pal('fD', 'X', 'F', ['P2'], talent(40, 40, 40)),
    pal('mE', 'X', 'M', [], talent(100, 100, 0)),
    pal('fF', 'X', 'F', [], talent(0, 0, 100)),
  ];
  const result = planOf(pals, { passives: ['P1', 'P2'] });
  // mA×fB は両親とも欲しいパッシブを持つので、子を入れ替えながら完全体を作れる。
  // mC×fD は 2 体で欲しいパッシブがそろうが、個体値 100 の親がいないので、まずパッシブを集める。
  // mE×fF は欲しいパッシブを持たないが、各ステータスに 100 の親がいる（個体値だけを狙う）
  assert.deepEqual(names(result), ['mA×fB:complete', 'mC×fD:passive', 'mE×fF:talent']);
  const [complete, passive, talentPair] = result.pairs;
  assert.ok(Number.isFinite(complete.generations) && complete.eggs === Math.min(complete.generations, 1 / complete.chance));
  assert.deepEqual([passive.gathered, passive.gatherTotal], [2, 2]);
  // 和集合 2 個から 2 個とも継ぐのは、継ぐ数が 2 個以上のとき（60%）
  near(passive.gatherChance, 0.6);
  assert.ok(Number.isFinite(talentPair.talentGenerations) && talentPair.talentEggs <= 1 / talentPair.talentChance);
  assert.deepEqual(result.missing, []);
  assert.equal(result.total, 9);
});

test('理想個体（計画）: 強い個体を使い回さず、上の組に使った個体は下の組に出さない', () => {
  const pals = [
    pal('star', 'X', 'M', [], talent(100, 100, 100)),
    pal('m2', 'X', 'M', [], talent(100, 100, 0)),
    pal('f1', 'X', 'F', [], talent(100, 100, 100)),
    pal('f2', 'X', 'F', [], talent(0, 0, 100)),
    pal('f3', 'X', 'F', [], talent(0, 0, 0)),
  ];
  const result = planOf(pals);
  const used = result.pairs.flatMap((pair) => [pair.male.id, pair.female.id]);
  assert.equal(new Set(used).size, used.length);
  assert.deepEqual(result.pairs.map((pair) => `${pair.male.id}×${pair.female.id}`), ['star×f1', 'm2×f2']);
});

test('理想個体（計画）: 1 回で作れる組は、目標のある各ステータスに親から写すだけで届く組（目標 0 は見ない・キノコケーキは目標の 5 下まで）', () => {
  // 世代の平均が出ない異種の組で確かめる（同じ種族なら、子を入れ替えながら完全体を作れるので完全体作成組になる）
  const records = [rec('r1', 'A', 'B', 'X')];
  const groupOf = (male, female, extra = {}) => planOf([pal('m', 'A', 'M', [], talent(...male)), pal('f', 'B', 'F', [], talent(...female))], { records, ...extra }).pairs[0].group;
  // 攻撃と防御に 100 の親がいなければ、HP が 100 でも 1 回では作れない
  assert.equal(groupOf([100, 90, 90], [90, 90, 90]), 'talent');
  assert.equal(groupOf([100, 90, 90], [90, 100, 100]), 'complete');
  // 目標 0（気にしない）のステータスは見ない
  assert.equal(groupOf([100, 0, 100], [0, 0, 0], { targets: { hp: 100, shot: 0, defense: 100 } }), 'complete');
  // キノコケーキは +1〜5 なので、95 なら 100 に届くが 94 では届かない
  assert.equal(groupOf([95, 95, 95], [0, 0, 0], { cake: 'talent' }), 'complete');
  assert.equal(groupOf([94, 95, 95], [0, 0, 0], { cake: 'talent' }), 'talent');
});

test('理想個体（計画）: 完全体作成組は、完成までのタマゴの平均の少ない順（1 回で作れる組でも、平均が多ければ下）', () => {
  const records = [rec('r1', 'A', 'B', 'X')];
  const pals = [
    // 異種の組: 各ステータスに 100 の親がいて 1 回で作れるが、余計なパッシブが多く、平均 約 529 個
    pal('am', 'A', 'M', ['P1', 'J1', 'J2', 'J3'], talent(100, 0, 0)),
    pal('bf', 'B', 'F', ['P2', 'J4', 'J5', 'J6'], talent(0, 100, 100)),
    // 同じ種族の組: 防御に 100 の親がいないので 1 回では作れないが、子を入れ替えながら 平均 約 405 個
    pal('xm', 'X', 'M', ['P1', 'P2'], talent(100, 100, 90)),
    pal('xf', 'X', 'F', ['P1', 'P2'], talent(100, 100, 90)),
  ];
  const result = planOf(pals, { passives: ['P1', 'P2'], records });
  assert.deepEqual(names(result), ['xm×xf:complete', 'am×bf:complete']);
  const [generation, oneShot] = result.pairs;
  near(generation.eggs, generation.generations);
  near(oneShot.eggs, 1 / oneShot.chance);
  assert.ok(generation.eggs < oneShot.eggs);
  // 1 回で作れる同じ種族の組も、子を入れ替えた方が早ければ、その平均で比べる（この 2 体のままより少ない）
  const [swap] = planOf([pal('m100', 'X', 'M', ['P1'], talent(100, 100, 100)), pal('f0', 'X', 'F', ['P1'], talent(0, 0, 0))], { passives: ['P1'] }).pairs;
  assert.ok(swap.generations < 1 / swap.chance);
  near(swap.eggs, swap.generations);
});

test('理想個体（計画）: 欲しいパッシブが 3 体以上に分かれていれば、途中まで集める組もパッシブ厳選組にし、集まる数の多い順に並べる', () => {
  const pals = [
    pal('m1', 'X', 'M', ['P1', 'P2'], talent(50, 50, 50)),
    pal('m2', 'X', 'M', ['P4'], talent(50, 50, 50)),
    pal('f1', 'X', 'F', ['P3'], talent(50, 50, 50)),
    pal('f2', 'X', 'F', ['P3', 'P4'], talent(50, 50, 50)),
  ];
  const result = planOf(pals, { passives: ['P1', 'P2', 'P3', 'P4'] });
  // m1×f2 は 4 個そろう。残りの m2×f1 は P4 と P3 の 2 個を集める
  assert.deepEqual(names(result), ['m1×f2:passive', 'm2×f1:passive']);
  assert.deepEqual(result.pairs.map((pair) => [pair.gathered, pair.gatherTotal]), [[4, 4], [2, 4]]);
  // 1 体で持っている数より増えない組（P3・P4 の f2 と P4 の m2）は、パッシブを集めないので個体値厳選組
  assert.deepEqual(names(planOf([pals[1], pals[3]], { passives: ['P1', 'P2', 'P3', 'P4'] })), ['m2×f2:talent']);
});

test('理想個体（計画）: 欲しいパッシブを候補のだれも持たないときは、配合では作れないので全部を個体値厳選組にする', () => {
  const pals = [
    pal('m1', 'X', 'M', ['P1'], talent(100, 100, 0)),
    pal('f1', 'X', 'F', ['P2'], talent(0, 100, 100)),
    pal('m2', 'X', 'M', [], talent(90, 90, 90)),
    pal('f2', 'X', 'F', [], talent(90, 90, 90)),
  ];
  const result = planOf(pals, { passives: ['P1', 'P2', 'P9'] });
  assert.deepEqual(result.missing, ['P9']);
  // P1・P2 は 2 体で集められるが、P9 は配合では作れないので、パッシブ厳選組は出さない。個体値がそろうまでの平均の少ない順
  assert.deepEqual(names(result), ['m1×f1:talent', 'm2×f2:talent']);
  assert.ok(result.pairs[0].talentEggs < result.pairs[1].talentEggs);
  assert.ok(result.pairs.every((pair) => Number.isFinite(pair.talentGenerations)));
});

test('理想個体（計画）: パッシブの条件を満たす子が産まれない組は出さず、blocked に数える', () => {
  const pals = [
    pal('m1', 'X', 'M', ['P1'], talent(100, 100, 100)),
    pal('f1', 'X', 'F', ['P1'], talent(100, 100, 100)),
    pal('m0', 'X', 'M', [], talent(100, 100, 100)),
    pal('f0', 'X', 'F', [], talent(0, 0, 0)),
  ];
  // スペシャルケーキは空いた枠をランダムで埋めるので、欲しいパッシブが 4 個未満では「欲しいものだけ」にならない（どの組も完成しない）
  const special = planOf(pals, { passives: ['P1'], mode: 'only', cake: 'special' });
  assert.deepEqual(names(special), []);
  assert.deepEqual([special.total, special.blocked], [0, 4]);
  // パッシブを持つ親からは、パッシブのない子は産まれない（パッシブを持たない ♂×♀ だけが残る）
  const none = planOf(pals, { mode: 'only' });
  assert.deepEqual(names(none), ['m0×f0:complete']);
  assert.deepEqual([none.total, none.blocked], [1, 3]);
});

test('理想個体（計画）: タマゴは孵化するまで牧場に置けないので、親の候補にしない', () => {
  const pals = [
    pal('m1', 'X', 'M', [], talent(100, 100, 100)),
    pal('f1', 'X', 'F', [], talent(0, 0, 0)),
    pal('egg', 'X', 'F', [], talent(100, 100, 100), { egg: true, place: 'egg-ground' }),
  ];
  const result = planOf(pals);
  assert.deepEqual(names(result), ['m1×f1:complete']);
  assert.equal(result.candidates, 2);
  const hatched = pals.map((item) => (item.id === 'egg' ? { ...item, egg: false, place: 'palbox' } : item));
  assert.deepEqual(names(planOf(hatched)), ['m1×egg:complete']);
});

test('理想個体（計画）: 同じ値の組は個体 ID で並べ、入力の順に左右されない', () => {
  const pals = ['m2', 'f2', 'm1', 'f1'].map((id) => pal(id, 'X', id[0] === 'm' ? 'M' : 'F', ['P1'], talent(100, 100, 100)));
  const expected = ['m1×f1:complete', 'm2×f2:complete'];
  assert.deepEqual(names(planOf(pals, { passives: ['P1'] })), expected);
  assert.deepEqual(names(planOf([...pals].reverse(), { passives: ['P1'] })), expected);
});

test('理想個体（計画）: 異種の配合・同じ組み合わせで別の子・ケーキ・パッシブの条件・足りないパッシブを混ぜても、上位だけ残した結果は全部並べた結果と同じ', () => {
  let state = 0x4d495844;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  const value = () => [0, 88, 94, 95, 99, 100][Math.floor(random() * 6)];
  const passivePool = ['P1', 'P2', 'P3', 'J1', 'J2', 'J3'];
  // A×B は X、B×A は X と Y（同じ組み合わせで別の子）
  const records = [rec('r1', 'A', 'B', 'X', 'Male', 'Female'), rec('r2', 'B', 'A', 'X', 'Male', 'Female'), rec('r3', 'B', 'A', 'Y', 'Male', 'Female')];
  for (let round = 0; round < 8; round++) {
    const pals = Array.from({ length: 30 }, (_, i) => pal(`k${round}-${i}`, ['X', 'X', 'A', 'B'][Math.floor(random() * 4)], random() < 0.5 ? 'M' : 'F',
      passivePool.filter(() => random() < 0.35), talent(value(), value(), value()), { egg: random() < 0.1 }));
    for (const cake of ['none', 'special', 'talent']) {
      for (const mode of ['include', 'only']) {
        for (const passives of [['P1'], ['P1', 'P2', 'P3'], ['P1', 'P9'], []]) {
          const input = { passives, cake, mode, records };
          const everything = planOf(pals, { ...input, limit: 1000 });
          for (const limit of [1, 3]) {
            const limited = planOf(pals, { ...input, limit });
            assert.deepEqual(names(limited), names(everything).slice(0, limit), `round ${round} ${cake} ${mode} ${passives} ${limit}`);
            assert.deepEqual([limited.total, limited.blocked], [everything.total, everything.blocked]);
          }
        }
      }
    }
  }
});
