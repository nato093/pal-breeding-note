import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../../web/js/core/index.js';
import {
  passiveChance, talentChance, talentExpectation, talentTargets, breedingLayouts, idealPairs, isParentCandidate, TALENT_PATTERNS,
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
  // タマゴとグローバルパルボックスの個体は、親の候補にしない
  assert.ok(result.pairs.every((pair) => ![pair.male.id, pair.female.id].some((id) => ['e1', 'g1'].includes(id))));
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
