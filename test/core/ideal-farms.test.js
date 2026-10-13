import { test } from 'node:test';
import assert from 'node:assert/strict';
import { targetFarms, farmAdvice, farmSignature, planChanges, planPairKey, readyFarms, farmCompleteness, emptyFarms, farmNames, farmsInUse } from '../../web/js/core/ideal-farms.js';

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

// ---------------------------------------------------------------------------
// 全体の速さの目安で交換を決める（measureOf を渡したとき）
// ---------------------------------------------------------------------------

const [m1, m2, m3, f1, f2, f3, f4] = ['m1', 'm2', 'm3', 'f1', 'f2', 'f3', 'f4'].map((id) => pal(id, 'X', id[0] === 'm' ? 'M' : 'F'));
const placedFarm = (id, male, female) => ({ id, baseId: 'b1', male, female });
// 物差し（idealPlan の measures と同じ形。rank は組の目的: 0 完全体作成組・1 パッシブ厳選組・2 個体値厳選組）
const complete = (eggs) => ({ status: 'ok', rank: 0, eggs, chance: 0 });
const gathering = (gathered, gatherChance, chance = 0) => ({ status: 'ok', rank: 1, gathered, gatherChance, chance });
const measuresOf = (entries) => {
  const map = new Map(Object.entries(entries));
  return (key) => map.get(key);
};
const summary = (advice) => advice.map((item) => [item.farm.id, item.status, item.rank, item.to,
  item.out?.map((p) => p.id), item.in?.map((p) => p.id)]);
// 判定どおりにしたときの、牧場ごとの組（同じ個体が 2 か所に入らないことを確かめる）
const finalPairs = (advice, pairs) => advice.map((item) => (item.status === 'swap' ? pairs[item.to]
  : item.status === 'none' && item.out.length ? null : { male: item.farm.male, female: item.farm.female })).filter(Boolean);
const noOverlap = (advice, pairs) => {
  const ids = finalPairs(advice, pairs).flatMap((item) => [item.male.id, item.female.id]);
  assert.equal(new Set(ids).size, ids.length, ids.join(','));
};

test('配合牧場（全体の速さ）: 1 か所なら、完成までの平均が減るときだけ交換を勧め、同点（丸めて同じ）は「そのまま」', () => {
  const pairs = [pair(m1, f1), pair(m2, f2)];
  const farms = [placedFarm('A', m1, f2)];
  // 今の m1×f2（平均 400 個）より、m1×f1（357 個）が早い
  assert.deepEqual(summary(farmAdvice(farms, pairs, { measureOf: measuresOf({ 'm1|f2': complete(400), 'm1|f1': complete(357) }) })),
    [['A', 'swap', -1, 0, ['f2'], ['f1']]]);
  // 同じ平均なら、上から 1 組に入っていなくても交換しない（見送り: keep で rank が -1）。計算の末尾の誤差だけの差も同点
  for (const eggs of [400, 400 * (1 - 1e-14)]) {
    assert.deepEqual(summary(farmAdvice(farms, pairs, { measureOf: measuresOf({ 'm1|f2': complete(400), 'm1|f1': complete(eggs) }) })),
      [['A', 'keep', -1, undefined, undefined, undefined]]);
  }
  // 今の組が一覧の下の方（順位 1 = おすすめ 2 番）にあるときも、見送れば順位はそのまま（K 以上）
  const lower = farmAdvice([placedFarm('A', m2, f2)], pairs, { measureOf: measuresOf({ 'm2|f2': complete(400), 'm1|f1': complete(400) }) });
  assert.deepEqual(summary(lower), [['A', 'keep', 1, undefined, undefined, undefined]]);
  // 上から 1 組に入っていれば、物差しを見ずにそのまま
  assert.deepEqual(summary(farmAdvice([placedFarm('A', m1, f1)], pairs, { measureOf: measuresOf({}) })), [['A', 'keep', 0, undefined, undefined, undefined]]);
});

test('配合牧場（全体の速さ）: 複数の牧場は、各牧場の 1÷平均 の合計が上がるときだけ交換する', () => {
  // 359・359 の 2 か所を 357・487 にすると、1 か所目は少し早くなるが全体では遅くなる（Codex の反例）
  const pairs = [pair(m1, f2), pair(m2, f1)];
  const farms = [placedFarm('A', m1, f1), placedFarm('B', m2, f2)];
  const worse = farmAdvice(farms, pairs, { measureOf: measuresOf({ 'm1|f1': complete(359.2), 'm2|f2': complete(359.2), 'm1|f2': complete(357.1), 'm2|f1': complete(486.8) }) });
  assert.deepEqual(summary(worse), [['A', 'keep', -1, undefined, undefined, undefined], ['B', 'keep', -1, undefined, undefined, undefined]]);
  // 1000・400 を 100・450 にすると、2 か所目は少し遅くなるが全体では早くなる
  const better = farmAdvice(farms, pairs, { measureOf: measuresOf({ 'm1|f1': complete(1000), 'm2|f2': complete(400), 'm1|f2': complete(100), 'm2|f1': complete(450) }) });
  assert.deepEqual(summary(better), [['A', 'swap', -1, 0, ['f1'], ['f2']], ['B', 'swap', -1, 1, ['f2'], ['f1']]]);
});

test('配合牧場（全体の速さ）: 個体をやり取りする牧場は 1 つのまとまりで決め、却下しても同じ個体が 2 か所に入らない', () => {
  // 連鎖: A は B の f2 を、B は C の f3 を、C はパルボックスの f4 を入れる（A・B・C が 1 つのまとまり）
  const chain = [pair(m1, f2), pair(m2, f3), pair(m3, f4)];
  const farms = [placedFarm('A', m1, f1), placedFarm('B', m2, f2), placedFarm('C', m3, f3)];
  const base = { 'm1|f1': complete(500), 'm2|f2': complete(500), 'm3|f3': complete(500) };
  // A だけ大きく早くなり、B・C は少し遅くなる。全体では早いので、3 か所とも交換
  const up = farmAdvice(farms, chain, { measureOf: measuresOf({ ...base, 'm1|f2': complete(100), 'm2|f3': complete(600), 'm3|f4': complete(600) }) });
  assert.deepEqual(up.map((item) => item.status), ['swap', 'swap', 'swap']);
  noOverlap(up, chain);
  // 全体では遅くなるなら、A だけ早くなっても 3 か所ともそのまま（A だけ交換すると f2 が A と B に入ってしまう）
  const down = farmAdvice(farms, chain, { measureOf: measuresOf({ ...base, 'm1|f2': complete(400), 'm2|f3': complete(2000), 'm3|f4': complete(2000) }) });
  assert.deepEqual(down.map((item) => item.status), ['keep', 'keep', 'keep']);
  noOverlap(down, chain);
  // 循環（A と B で ♀ を入れ替える）も 1 つのまとまり
  const cycle = [pair(m1, f2), pair(m2, f1)];
  const swapped = farmAdvice(farms.slice(0, 2), cycle, { measureOf: measuresOf({ ...base, 'm1|f2': complete(100), 'm2|f1': complete(900) }) });
  assert.deepEqual(swapped.map((item) => item.status), ['swap', 'swap']);
  noOverlap(swapped, cycle);
});

test('配合牧場（全体の速さ）: 置く組のない牧場から借りる交換は、借りた牧場を 0 として比べる。独立したまとまりは別々に決める', () => {
  const farms = [placedFarm('X', m1, f1), placedFarm('Y', m2, f2)];
  const borrow = [pair(m1, f2)];
  // Y の f2 を X に入れると Y は相手がいなくなる（0）。X が十分早くなるなら交換する
  const taken = farmAdvice(farms, borrow, { measureOf: measuresOf({ 'm1|f1': complete(1000), 'm2|f2': complete(1000), 'm1|f2': complete(100) }) });
  assert.deepEqual(summary(taken), [['X', 'swap', -1, 0, ['f1'], ['f2']], ['Y', 'none', -1, undefined, ['f2'], undefined]]);
  // 2 か所の合計より遅くなるなら、X も Y もそのまま
  const kept = farmAdvice(farms, borrow, { measureOf: measuresOf({ 'm1|f1': complete(1000), 'm2|f2': complete(1000), 'm1|f2': complete(600) }) });
  assert.deepEqual(summary(kept), [['X', 'keep', -1, undefined, undefined, undefined], ['Y', 'keep', -1, undefined, undefined, undefined]]);
  noOverlap(kept, borrow);
  // パルボックスの個体だけを入れる 2 か所は、別々のまとまり。早くなる方だけ交換する
  const separate = [pair(m1, f3), pair(m2, f4)];
  const one = farmAdvice(farms, separate, { measureOf: measuresOf({ 'm1|f1': complete(500), 'm2|f2': complete(500), 'm1|f3': complete(300), 'm2|f4': complete(700) }) });
  assert.deepEqual(summary(one), [['X', 'swap', -1, 0, ['f1'], ['f3']], ['Y', 'keep', -1, undefined, undefined, undefined]]);
  noOverlap(one, separate);
});

test('配合牧場（全体の速さ）: 完全体作成組と準備の組が混ざっても、組の目的が変わっても、速さの目安で比べる', () => {
  // 準備の組（まだ完成しない）から完全体作成組へ: 速さが 0 から上がるので交換
  const pairs = [pair(m1, f2)];
  const rise = farmAdvice([placedFarm('A', m1, f1)], pairs, { measureOf: measuresOf({ 'm1|f1': gathering(2, 0.6), 'm1|f2': complete(800) }) });
  assert.deepEqual(rise.map((item) => item.status), ['swap']);
  // 完全体作成組から、1 個のタマゴで完成する確率のある準備の組へ: 確率が 1÷平均 より低ければそのまま
  const fall = farmAdvice([placedFarm('A', m1, f1)], pairs, { measureOf: measuresOf({ 'm1|f1': complete(800), 'm1|f2': gathering(4, 0.9, 0.001) }) });
  assert.deepEqual(fall.map((item) => item.status), ['keep']);
  // 準備の組の牧場が相手を貸して組がなくなっても、全体で早くなるなら交換（借りられた牧場は「置く組がない」のまま）
  const farms = [placedFarm('A', m1, f1), placedFarm('B', m2, f2)];
  const gone = farmAdvice(farms, pairs, { measureOf: measuresOf({ 'm1|f1': complete(400), 'm2|f2': gathering(2, 0.4), 'm1|f2': complete(300) }) });
  assert.deepEqual(gone.map((item) => item.status), ['swap', 'none']);
});

test('配合牧場（全体の速さ）: 速さの目安が同じで 0 より大きければそのまま。どの牧場もまだ完成できないときは、準備の組が良くなるときだけ交換', () => {
  const pairs = [pair(m1, f2)];
  const farms = [placedFarm('A', m1, f1)];
  // 1 個のタマゴで完成する確率は同じ（約 2.55%）で、欲しいパッシブが全部そろう確率だけが上がる（Codex の 3 回目の指摘）
  const same = farmAdvice(farms, pairs, { measureOf: measuresOf({ 'm1|f1': gathering(4, 0.4, 0.0254975), 'm1|f2': gathering(4, 0.6, 0.0254975) }) });
  assert.deepEqual(same.map((item) => item.status), ['keep']);
  // どちらも完成できない（速さ 0）: 集まる数か全部継ぐ確率が上がるなら交換、同じか悪くなるならそのまま
  const prep = (now, next) => farmAdvice(farms, pairs, { measureOf: measuresOf({ 'm1|f1': now, 'm1|f2': next }) }).map((item) => item.status);
  assert.deepEqual(prep(gathering(2, 0.6), gathering(3, 0.3)), ['swap']);
  assert.deepEqual(prep(gathering(2, 0.6), gathering(2, 0.8)), ['swap']);
  assert.deepEqual(prep(gathering(2, 0.6), gathering(2, 0.6)), ['keep']);
  assert.deepEqual(prep(gathering(3, 0.3), gathering(2, 0.9)), ['keep']);
  // パッシブ厳選組は個体値厳選組より上の目的
  assert.deepEqual(prep({ status: 'ok', rank: 2, talentEggs: 50, chance: 0 }, gathering(2, 0.1)), ['swap']);
  // 完成しない組（blocked）からは、どの組でも良くなる
  assert.deepEqual(prep({ status: 'blocked' }, { status: 'ok', rank: 2, talentEggs: Infinity, chance: 0 }), ['swap']);
  // どの牧場も悪くならないときだけ: 1 か所が良くなっても、ほかの牧場が組を失うならそのまま
  const two = [placedFarm('A', m1, f1), placedFarm('B', m2, f2)];
  const lost = farmAdvice(two, pairs, { measureOf: measuresOf({ 'm1|f1': gathering(2, 0.6), 'm2|f2': gathering(2, 0.6), 'm1|f2': gathering(3, 0.6) }) });
  assert.deepEqual(lost.map((item) => item.status), ['keep', 'keep']);
});

test('配合牧場（全体の速さ）: 物差しが分からない組を含むまとまりは、まとまり全体を今の判定のまま（案のとおりの交換推奨）にする', () => {
  const farms = [placedFarm('A', m1, f1), placedFarm('B', m2, f2), placedFarm('C', m3, f3)];
  // A と B は個体をやり取りする（1 つのまとまり）。C は独立
  const pairs = [pair(m1, f2), pair(m2, f1), pair(m3, f4)];
  const advice = farmAdvice(farms, pairs, { measureOf: measuresOf({ 'm1|f1': complete(100), 'm2|f2': complete(100), 'm1|f2': complete(900), 'm3|f3': complete(100), 'm3|f4': complete(900) }) });
  // A・B は m2×f1 の物差しがないので、遅くなりそうでも案のまま。C は比べて見送る
  assert.deepEqual(advice.map((item) => item.status), ['swap', 'swap', 'keep']);
  // 同じ組み合わせで別の子も登録されている組（速さは目標が産まれる前提の値）が今の組か交換先の組にあるまとまりも、比べずに案のまま
  const doubtful = (now, next) => farmAdvice([placedFarm('A', m1, f1)], [pair(m1, f2)], { measureOf: measuresOf({ 'm1|f1': now, 'm1|f2': next }) })
    .map((item) => item.status);
  assert.deepEqual(doubtful({ ...complete(4), ambiguous: true }, complete(242)), ['swap']);
  assert.deepEqual(doubtful(complete(100), { ...complete(900), ambiguous: true }), ['swap']);
  assert.deepEqual(doubtful(complete(100), { ...complete(900), ambiguous: false }), ['keep']);
  // measureOf がなければ、今までどおり上から K 組との比較だけで決める
  assert.deepEqual(summary(farmAdvice(farms, pairs)), summary(farmAdvice(farms, pairs, {})));
  assert.deepEqual(farmAdvice(farms, pairs).map((item) => item.status), ['swap', 'swap', 'swap']);
});

test('配合牧場の状態: 判定に使えるのは状態が ok か、状態のない古いデータの牧場だけ。読めない牧場（uncertain）が 1 つでもあれば情報がそろっていない', () => {
  const ok = { id: 'A', baseId: 'b1', parents: ['m1', 'f1'], status: 'ok' };
  const old = { id: 'B', baseId: 'b1', parents: ['m2', 'f2'] };
  const unread = { id: 'C', baseId: 'b1', parents: ['m3', 'f3'], status: 'uncertain' };
  assert.deepEqual(readyFarms([ok, old, unread]).map((item) => item.id), ['A', 'B']);
  assert.deepEqual(readyFarms(null), []);
  assert.deepEqual(farmCompleteness([ok, old]), { complete: true, uncertain: 0, partial: false });
  assert.deepEqual(farmCompleteness([ok, unread, { ...unread, id: 'D' }]), { complete: false, uncertain: 2, partial: false });
  // 共有で牧場が一部だけ（farm-data で足す印）のときも、そろっていない
  assert.deepEqual(farmCompleteness([ok], { partial: true }), { complete: false, uncertain: 0, partial: true });
  // 牧場の情報がない（null）ときは、欠けた牧場もない
  assert.deepEqual(farmCompleteness(null), { complete: true, uncertain: 0, partial: false });
  // 知らない状態も判定に使わないので、読めない牧場として数える
  assert.deepEqual(farmCompleteness([{ ...ok, status: 'broken' }]), { complete: false, uncertain: 1, partial: false });
});

test('配合牧場の状態: 対象の牧場（この目標の組）は、読めない牧場を使わない（親が 2 体そろっていても）', () => {
  const pals = [pal('m1', 'X', 'M'), pal('f1', 'X', 'F'), pal('m2', 'X', 'M'), pal('f2', 'X', 'F')];
  const farms = [
    { ...farm('A', ['m1', 'f1']), status: 'uncertain' },
    { ...farm('B', ['m2', 'f2']), status: 'ok' },
  ];
  assert.deepEqual(targetFarms(farms, pals, layouts).map((item) => item.id), ['B']);
  // 状態のない古いデータは ok として使う
  assert.deepEqual(targetFarms([farm('A', ['m1', 'f1'])], pals, layouts).map((item) => item.id), ['A']);
});

test('配合牧場の状態: 空いている牧場は、状態が ok で親が 2 体未満の牧場', () => {
  const farms = [
    farm('A', []), farm('B', ['m1']), farm('C', ['m2', 'f2']),
    { ...farm('D', []), status: 'uncertain' }, { ...farm('E', ['m3']), status: 'ok' },
  ];
  assert.deepEqual(emptyFarms(farms).map((item) => item.id), ['A', 'B', 'E']);
  assert.deepEqual(emptyFarms(undefined), []);
});

test('配合牧場の名前: 拠点に 2 つ以上あれば、牧場の ID の順で A・B…を付ける（全体の牧場で数え、読めない牧場も数える）', () => {
  const labels = { b1: '拠点 1', b2: '拠点 2' };
  const farms = [
    farm('F9', ['m1', 'f1'], 'b1'), { ...farm('F2', [], 'b1'), status: 'uncertain' }, farm('F5', [], 'b1'),
    farm('G1', ['m2', 'f2'], 'b2'), farm('H1', [], 'gone'),
  ];
  const names = farmNames(farms, (baseId) => labels[baseId] ?? '');
  assert.deepEqual([...names], [
    ['F9', '拠点 1 の牧場 C'], ['F2', '拠点 1 の牧場 A'], ['F5', '拠点 1 の牧場 B'], ['G1', '拠点 2 の牧場'], ['H1', '拠点の牧場'],
  ]);
  // 並びが変わっても同じ名前（目標ごとに変えない）
  const again = farmNames([...farms].reverse(), (baseId) => labels[baseId] ?? '');
  for (const [id, name] of names) assert.equal(again.get(id), name);
  // 27 個目からは AA・AB…
  const many = farmNames(Array.from({ length: 28 }, (_, i) => farm(`F${String(i).padStart(2, '0')}`, [], 'b1')), () => '拠点 1');
  assert.deepEqual([many.get('F25'), many.get('F26'), many.get('F27')], ['拠点 1 の牧場 Z', '拠点 1 の牧場 AA', '拠点 1 の牧場 AB']);
  assert.deepEqual([...farmNames(null, () => '')], []);
});

test('配合牧場の使用中: 目標の牧場以外の牧場（読めた牧場だけ）に入っている個体と、その牧場', () => {
  const farms = [
    farm('A', ['m1', 'f1']), farm('B', ['m2', 'f2']), farm('C', ['m3']),
    { ...farm('D', ['m4', 'f4']), status: 'uncertain' },
  ];
  const inUse = farmsInUse(farms, new Set(['A']));
  assert.deepEqual([...inUse], [['m2', 'B'], ['f2', 'B'], ['m3', 'C']]);
  assert.deepEqual([...farmsInUse(undefined, new Set())], []);
});
