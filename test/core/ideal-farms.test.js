import { test } from 'node:test';
import assert from 'node:assert/strict';
import { targetFarms, farmAdvice, farmSignature, planChanges, planPairKey } from '../../web/js/core/ideal-farms.js';

const pal = (id, palId, gender) => ({ id, palId, gender });
const farm = (id, parents, baseId = 'b1') => ({ id, baseId, parents });
const pair = (male, female) => ({ male, female });
const layouts = [{ male: 'X', female: 'X' }, { male: 'A', female: 'B' }];

test('配合牧場: 対象は、親が 2 体とも候補にいて、♂ と ♀ で目標が産まれる向きの組が入っている牧場', () => {
  const pals = [pal('m1', 'X', 'M'), pal('f1', 'X', 'F'), pal('am', 'A', 'M'), pal('bf', 'B', 'F'), pal('ym', 'Y', 'M'), pal('f2', 'X', 'F')];
  const farms = [
    farm('same', ['m1', 'f1']),
    farm('cross', ['am', 'bf']),
    farm('other', ['ym', 'f2']), // 目標が産まれない組
    farm('empty', []),
    farm('one', ['m1']),
    farm('unknown', ['m1', 'gone']), // 候補にいない（所持者で絞った）親
    farm('twoFemales', ['f1', 'f2']),
  ];
  assert.deepEqual(targetFarms(farms, pals, layouts).map((item) => [item.id, item.male.id, item.female.id]), [['same', 'm1', 'f1'], ['cross', 'am', 'bf']]);
  assert.deepEqual(targetFarms(undefined, pals, layouts), []);
});

test('配合牧場: おすすめの上から牧場の数の組と比べ、入っていればそのまま、なければ空いた組へ交換を勧める（親の片方が同じ牧場を優先）', () => {
  const [m1, m2, m3, f1, f2, f3] = ['m1', 'm2', 'm3', 'f1', 'f2', 'f3'].map((id) => pal(id, 'X', id[0] === 'm' ? 'M' : 'F'));
  const pairs = [pair(m1, f1), pair(m2, f2), pair(m3, f3)];
  const farms = [
    { id: 'A', baseId: 'b1', male: m3, female: f2 }, // m3 も f2 も上位 2 組とは別の組で入っている
    { id: 'B', baseId: 'b1', male: m1, female: f1 }, // おすすめ 1 番そのもの
  ];
  const advice = farmAdvice(farms, pairs);
  assert.deepEqual(advice.map((item) => [item.farm.id, item.status, item.rank, item.to]), [['A', 'swap', -1, 1], ['B', 'keep', 0, undefined]]);
  // 2 番の組（m2×f2）は f2 がすでに入っている A に入れ、m3 と入れ替える（1 体で済む）
  assert.deepEqual([advice[0].out.map((item) => item.id), advice[0].in.map((item) => item.id)], [['m3'], ['m2']]);
  // 親が重ならないなら、残っている牧場の先頭に入れる。おすすめが足りなければ none
  const lonely = farmAdvice([{ id: 'C', baseId: 'b1', male: m3, female: f3 }, { id: 'D', baseId: 'b1', male: m2, female: f1 }], [pair(m1, f2)]);
  assert.deepEqual(lonely.map((item) => [item.farm.id, item.status, item.to]), [['C', 'swap', 0], ['D', 'none', undefined]]);
  assert.deepEqual([lonely[0].out.map((item) => item.id), lonely[0].in.map((item) => item.id)], [['m3', 'f3'], ['m1', 'f2']]);
  // 置く組がない牧場でも、ほかの牧場の交換に使う個体は外す（D の f1 はおすすめに使わないので外さない）
  assert.deepEqual(lonely[1].out.map((item) => item.id), []);
  const borrowed = farmAdvice([{ id: 'X', baseId: 'b1', male: m1, female: f1 }, { id: 'Y', baseId: 'b1', male: m2, female: f2 }], [pair(m1, f2)]);
  assert.deepEqual(borrowed.map((item) => [item.status, item.out.map((pal) => pal.id)]), [['swap', ['f1']], ['none', ['f2']]]);
  // 3 番に入っている組は、牧場が 2 か所なら上位 2 組ではないので交換を勧める（順位は出す）
  const third = farmAdvice([{ id: 'E', baseId: 'b1', male: m3, female: f3 }, { id: 'F', baseId: 'b1', male: m1, female: f1 }], pairs);
  assert.deepEqual(third.map((item) => [item.status, item.rank, item.to]), [['swap', 2, 1], ['keep', 0, undefined]]);
});

test('配合牧場: 「変更あり」は、牧場に置く組（上から牧場の数の組）のうち、牧場の中身が最後に変わったときの上から同じ数の組になかった組。牧場の中身が変わったら基準を作り直す', () => {
  const [m1, m2, m3, f1, f2, f3] = ['m1', 'm2', 'm3', 'f1', 'f2', 'f3'].map((id) => pal(id, 'X', id[0] === 'm' ? 'M' : 'F'));
  const farms = [{ id: 'A', baseId: 'b1', male: m1, female: f1 }];
  const signature = farmSignature(farms);
  // 牧場の並びが違っても同じ中身なら同じ
  assert.equal(farmSignature([...farms, { id: 'B', baseId: 'b1', male: m2, female: f2 }]), farmSignature([{ id: 'B', baseId: 'b1', male: m2, female: f2 }, ...farms]));
  const first = planChanges(null, signature, [pair(m1, f1)], 1);
  assert.deepEqual([first.reset, [...first.changed], first.baseline], [true, [], { farms: signature, pairs: ['m1|f1'] }]);
  // 新しい個体が加わって、牧場に置く 1 番が変わった（牧場はそのまま）
  const later = planChanges(first.baseline, signature, [pair(m2, f2), pair(m1, f1)], 1);
  assert.deepEqual([later.reset, [...later.changed]], [false, [planPairKey(m2, f2)]]);
  // 新しく入ったのが牧場に置かない組（上から牧場の数より下）なら付けない
  const below = planChanges(first.baseline, signature, [pair(m1, f1), pair(m2, f2)], 1);
  assert.deepEqual([below.reset, [...below.changed]], [false, []]);
  // 基準では牧場の数より下だった組が、牧場に置く組に上がったときは付ける
  const wide = planChanges(null, signature, [pair(m1, f1), pair(m2, f2), pair(m3, f3)], 1).baseline;
  assert.deepEqual([...planChanges(wide, signature, [pair(m3, f3), pair(m1, f1)], 1).changed], [planPairKey(m3, f3)]);
  // この目標の組を置いた牧場がなければ、どの組にも付けない
  const none = planChanges(null, farmSignature([]), [pair(m1, f1)], 0).baseline;
  assert.deepEqual([...planChanges(none, farmSignature([]), [pair(m2, f2), pair(m1, f1)], 0).changed], []);
  // 牧場に置き直したら、今のおすすめが基準になる
  const moved = planChanges(first.baseline, farmSignature([{ id: 'A', baseId: 'b1', male: m2, female: f2 }]), [pair(m2, f2), pair(m1, f1)], 1);
  assert.deepEqual([moved.reset, [...moved.changed], moved.baseline.pairs], [true, [], ['m2|f2', 'm1|f1']]);
});
