import { test } from 'node:test';
import assert from 'node:assert/strict';
import data from '../../web/data/breeding.js';
import pals from '../../web/data/pals.js';
import { decodeBreeding } from '../../web/js/core/breeding.js';
import { createSpeciesResolver } from '../../web/js/core/owned.js';
import { findNewBreedings, isMutationEgg, resolveRegistrant, mappedUser } from '../../web/js/core/auto-breeding.js';

const deps = { resolveSpecies: createSpeciesResolver(pals), table: decodeBreeding(data) };
const P1 = 'p-1';
const P2 = 'p-2';
const parent = (characterId, gender, depositorUid = P1) => ({ instanceId: `${characterId}-${gender}`, characterId, gender, depositorUid });
const egg = (localId, characterId, itemId = 'PalEgg_Earth_01') => ({ localId, characterId, itemId });
const farm = (id, parents, eggs, status = 'ok') => ({ id, baseId: 'b', status, parents, eggs });
// 前に読んだときの牧場を記録し、その後のセーブで新しく現れたタマゴを見る
const sheep = () => [parent('SwordCutlassfish', 'Male'), parent('BOSS_SheepBall', 'Female')];
// 牧場の外のタマゴ（孵化器など。snapshot.pals の source: 'egg'）
const looseEgg = (instanceId, characterId, itemId = 'PalEgg_Earth_01') => ({ instanceId, source: 'egg', characterId, location: { kind: 'egg-incubator', itemId } });
function observe(before, after, { eggsBefore = [], eggsAfter = [] } = {}) {
  const { history } = findNewBreedings({ breedFarms: before, pals: eggsBefore }, { ...deps, history: null });
  return findNewBreedings({ breedFarms: after, pals: eggsAfter }, { ...deps, history });
}

test('自動登録の照合: 初めて読んだセーブは記録するだけで、候補を出さない', () => {
  const result = findNewBreedings({ breedFarms: [farm('f1', sheep(), [egg('e1', 'GuardianDog')])] }, { ...deps, history: null });
  assert.deepEqual([result.candidates, result.anomalies], [[], []]);
  assert.deepEqual(result.history, {
    farms: { f1: {
      parents: 'BOSS_SheepBall-Female|SwordCutlassfish-Male', eggs: ['e1'],
      pair: { a: { palId: 'SwordCutlassfish', gender: 'M', depositorUid: P1 }, b: { palId: 'SheepBall', gender: 'F', depositorUid: P1 } },
    } },
    eggs: ['e1'],
    breeders: {},
  });
});

test('自動登録の照合: 親が同じ牧場に新しく現れたタマゴを、配合表の子で候補にする（親の並びと性別をそろえる）', () => {
  const { candidates, anomalies } = observe([farm('f1', sheep(), [])], [farm('f1', sheep(), [egg('e1', 'GuardianDog')])]);
  assert.deepEqual(anomalies, []);
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].record, {
    parent1Id: 'SheepBall', parent1Gender: 'F', parent2Id: 'SwordCutlassfish', parent2Gender: 'M', childId: 'GuardianDog',
  });
  assert.deepEqual(candidates[0].evidence, [{ farmId: 'f1', eggLocalId: 'e1', depositorUids: [P1, P1] }]);
});

test('自動登録の照合: 前からあるタマゴ（親を入れ替える前に産まれた古いタマゴ）は見ない', () => {
  // 実セーブで、ヤクモマルのタマゴが親を 7 回入れ替えても牧場に残っていた（2026-10-06）
  const old = egg('old', 'GuardianDog');
  const ghost = [parent('GhostDragon_Fire', 'Male'), parent('RockBeast_Ice', 'Female')];
  const { candidates, anomalies } = observe([farm('f1', ghost, [old])], [farm('f1', ghost, [old])]);
  assert.deepEqual([candidates, anomalies], [[], []]);
});

test('自動登録の照合: 前に読んだときと親が違う牧場のタマゴは、どの親が産んだか分からないので見ない', () => {
  const before = [farm('f1', [parent('GuardianDog', 'Male'), parent('GuardianDog', 'Female')], [])];
  const { candidates, anomalies } = observe(before, [farm('f1', sheep(), [egg('e1', 'GuardianDog')])]);
  assert.deepEqual([candidates, anomalies], [[], []]);
});

test('自動登録の照合: 突然変異タマゴは中身が表と違っても、親の組み合わせの配合（表の子）として候補にする', () => {
  const ghosts = [parent('GhostDragon_Fire', 'Male'), parent('BOSS_GhostDragon_Fire', 'Female')];
  const mutation = egg('m1', 'BOSS_DomeArmorDragon', 'PalEgg_MutationPal_05');
  assert.ok(isMutationEgg(mutation));
  const { candidates, anomalies } = observe([farm('f1', ghosts, [])], [farm('f1', ghosts, [mutation])]);
  assert.deepEqual(anomalies, []);
  assert.equal(candidates[0].record.childId, 'GhostDragon_Fire');
});

test('自動登録の照合: 新しいふつうのタマゴが表と合わないときは、登録せず異常として返す', () => {
  const ghost = [parent('GhostDragon_Fire', 'Male'), parent('IceNarwhal_Fire', 'Female')];
  const { candidates, anomalies } = observe([farm('f1', ghost, [])], [farm('f1', ghost, [egg('e1', 'GuardianDog')])]);
  assert.deepEqual(candidates, []);
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0].actual, 'GuardianDog');
  assert.ok(anomalies[0].expected && anomalies[0].expected !== 'GuardianDog');
});

test('自動登録の照合: 同じ組み合わせは 1 件にまとめ、根拠（牧場・タマゴ）はすべて残す', () => {
  const pair = () => [parent('GhostDragon_Fire', 'Male'), parent('BOSS_GhostDragon_Fire', 'Female')];
  const { candidates } = observe([farm('f1', pair(), []), farm('f2', pair(), [])], [
    farm('f1', pair(), [egg('a', 'GhostDragon_Fire'), egg('b', 'BOSS_GhostDragon_Fire')]),
    farm('f2', pair(), [egg('c', 'GhostDragon_Fire')]),
  ]);
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].evidence.map((e) => e.eggLocalId), ['a', 'b', 'c']);
});

test('自動登録の照合: 親が 1 体・同じ性別・uncertain の牧場は何もしない', () => {
  const cases = [
    [parent('SheepBall', 'Female')],
    [parent('SheepBall', 'Female'), parent('SwordCutlassfish', 'Female')],
  ];
  for (const parents of cases) {
    const { candidates, anomalies } = observe([farm('f1', parents, [])], [farm('f1', parents, [egg('e1', 'SheepBall')])]);
    assert.deepEqual([candidates, anomalies], [[], []]);
  }
  const { candidates } = observe([farm('f1', sheep(), [], 'uncertain')], [farm('f1', sheep(), [egg('e1', 'GuardianDog')], 'uncertain')]);
  assert.deepEqual(candidates, []);
});

test('自動登録の照合: breedFarms のない古いデータは空', () => {
  assert.deepEqual(findNewBreedings({ pals: [] }, { ...deps, history: {} }), { candidates: [], anomalies: [], history: { farms: {}, eggs: [], breeders: {} } });
});

test('自動登録の照合: 産まれてすぐ拾われ、牧場の外で初めて見つかったタマゴは、中身が表の子になる牧場の親の配合とみなす', () => {
  const { candidates } = observe([farm('f1', sheep(), [])], [farm('f1', sheep(), [])], { eggsAfter: [looseEgg('x1', 'GuardianDog')] });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].record.childId, 'GuardianDog');
  assert.deepEqual(candidates[0].evidence, [{ farmId: 'f1', eggLocalId: 'x1', depositorUids: [P1, P1] }]);
});

test('自動登録の照合: 拾った直後に親を入れ替えても、前に読んだときの親で照合する', () => {
  const dogs = [parent('GuardianDog', 'Male'), parent('GuardianDog', 'Female')];
  const { candidates } = observe([farm('f1', sheep(), [])], [farm('f1', dogs, [])], { eggsAfter: [looseEgg('x1', 'GuardianDog')] });
  // 前の親（SheepBall×SwordCutlassfish）も、いまの親（GuardianDog×GuardianDog）も GuardianDog になるので、どちらも候補
  assert.deepEqual(candidates.map((c) => `${c.record.parent1Id}×${c.record.parent2Id}`).sort(), ['GuardianDog×GuardianDog', 'SheepBall×SwordCutlassfish']);
});

test('自動登録の照合: 牧場の外のタマゴは、突然変異タマゴ・どの牧場の子でもないもの・前から見ていたものを使わない', () => {
  const eggsAfter = [
    looseEgg('m1', 'BOSS_DomeArmorDragon', 'PalEgg_MutationPal_05'),
    looseEgg('w1', 'Anubis'),
    looseEgg('old', 'GuardianDog'),
  ];
  const { candidates } = observe([farm('f1', sheep(), [])], [farm('f1', sheep(), [])], { eggsBefore: [looseEgg('old', 'GuardianDog')], eggsAfter });
  assert.deepEqual(candidates, []);
});

test('自動登録の照合: 牧場の上で見たタマゴを孵化器に移しても、二重に数えない', () => {
  const egg1 = egg('e1', 'GuardianDog');
  const first = findNewBreedings({ breedFarms: [farm('f1', sheep(), [])], pals: [] }, { ...deps, history: null });
  const laid = findNewBreedings({ breedFarms: [farm('f1', sheep(), [egg1])], pals: [looseEgg('e1', 'GuardianDog')] }, { ...deps, history: first.history });
  assert.equal(laid.candidates[0].evidence.length, 1);
  const moved = findNewBreedings({ breedFarms: [farm('f1', sheep(), [])], pals: [looseEgg('e1', 'GuardianDog')] }, { ...deps, history: laid.history });
  assert.deepEqual(moved.candidates, []);
});

test('自動登録の照合: 前の版の記録（見たタマゴがない）からは、牧場の外のタマゴを記録するだけ', () => {
  const { history } = findNewBreedings({ breedFarms: [farm('f1', sheep(), [])], pals: [] }, { ...deps, history: null });
  const result = findNewBreedings({ breedFarms: [farm('f1', sheep(), [])], pals: [looseEgg('x1', 'GuardianDog')] }, { ...deps, history: { farms: history.farms, eggs: null } });
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.history.eggs, ['x1']);
});

test('自動登録の照合: 一度見えなくなったタマゴが、別の場所で現れ直しても新しいタマゴと数えない', () => {
  const dogs = [parent('GuardianDog', 'Male'), parent('GuardianDog', 'Female')];
  const read = (farms, pals, history) => findNewBreedings({ breedFarms: farms, pals }, { ...deps, history });
  const first = read([farm('f1', sheep(), [])], [looseEgg('x1', 'GuardianDog')], null);
  // 所持品に移っている間に、そのファイルが読めずに見えなくなった
  const hidden = read([farm('f1', dogs, [])], [], first.history);
  const back = read([farm('f1', dogs, [])], [looseEgg('x1', 'GuardianDog')], hidden.history);
  assert.deepEqual(back.candidates, []);
});

test('自動登録の照合: 前に読んだときの親の組が同じ性別（壊れた記録）なら、照合に使わない', () => {
  const { history } = findNewBreedings({ breedFarms: [farm('f1', sheep(), [])], pals: [] }, { ...deps, history: null });
  history.farms.f1.pair.a.gender = 'F';
  history.farms.f1.pair.b.gender = 'F';
  history.farms.f1.parents = 'old';
  const result = findNewBreedings({ breedFarms: [], pals: [looseEgg('x1', 'GuardianDog')] }, { ...deps, history });
  assert.deepEqual(result.candidates, []);
});

test('自動登録の照合: タマゴを拾ってすぐ牧場を撤去しても、前に読んだときの親で照合する', () => {
  const { candidates } = observe([farm('f1', sheep(), [])], [], { eggsAfter: [looseEgg('x1', 'GuardianDog')] });
  assert.deepEqual(candidates.map((c) => [c.record.parent1Id, c.record.parent2Id, c.record.childId, c.evidence[0].farmId]), [['SheepBall', 'SwordCutlassfish', 'GuardianDog', 'f1']]);
});

// ---- 古代文明の配合器（snapshot.breeders。牧場と同じ形） ----
const breeder = farm;
const frogs = () => [parent('KendoFrog', 'Male'), parent('KendoFrog_Dark', 'Female')];
const ghostPair = () => [parent('GhostDragon_Fire', 'Male'), parent('BOSS_GhostDragon_Fire', 'Female')];
function observeBreeders(before, after, { eggsBefore = [], eggsAfter = [], farmsBefore = [], farmsAfter = [] } = {}) {
  const { history } = findNewBreedings({ breedFarms: farmsBefore, breeders: before, pals: eggsBefore }, { ...deps, history: null });
  return findNewBreedings({ breedFarms: farmsAfter, breeders: after, pals: eggsAfter }, { ...deps, history });
}
const pairText = (c) => `${c.record.parent1Id}(${c.record.parent1Gender})×${c.record.parent2Id}(${c.record.parent2Gender})>${c.record.childId}`;

test('配合器: 初めて読んだ配合器は記録するだけで、記録は牧場（farms）と分けて breeders に持つ', () => {
  const result = findNewBreedings({ breedFarms: [], breeders: [breeder('d1', sheep(), [egg('e1', 'GuardianDog')])] }, { ...deps, history: null });
  assert.deepEqual([result.candidates, result.anomalies], [[], []]);
  assert.deepEqual(result.history.farms, {});
  assert.deepEqual(result.history.breeders.d1.eggs, ['e1']);
  assert.equal(result.history.breeders.d1.parents, 'BOSS_SheepBall-Female|SwordCutlassfish-Male');
  assert.deepEqual(result.history.eggs, ['e1']);
});

test('配合器: 配合器の記録のない記録（前の版のタブが書き戻した）からは、配合器を記録するだけ', () => {
  const { history } = findNewBreedings({ breedFarms: [], breeders: [breeder('d1', sheep(), [])] }, { ...deps, history: null });
  const { candidates, history: next } = findNewBreedings({ breedFarms: [], breeders: [breeder('d1', sheep(), [egg('e1', 'GuardianDog')])], pals: [] },
    { ...deps, history: { farms: history.farms, eggs: history.eggs } });
  assert.deepEqual(candidates, []);
  assert.deepEqual(next.breeders.d1.eggs, ['e1']);
});

test('配合器: 親が同じ配合器に新しく現れたタマゴは、中身が表の子ならその親の配合（根拠は配合器）', () => {
  const { candidates, anomalies } = observeBreeders([breeder('d1', sheep(), [])], [breeder('d1', sheep(), [egg('e1', 'GuardianDog')])]);
  assert.deepEqual(anomalies, []);
  assert.deepEqual(candidates.map(pairText), ['SheepBall(F)×SwordCutlassfish(M)>GuardianDog']);
  assert.deepEqual(candidates[0].evidence, [{ farmId: 'd1', eggLocalId: 'e1', depositorUids: [P1, P1] }]);
});

test('配合器: 中身が親の表の子と合わないタマゴ（入れて孵化させているもの）は、異常として知らせず、牧場の外のタマゴと同じに牧場の親と照合する', () => {
  // 手元のセーブで、親がノクサージュのままの配合器にベラルージュのタマゴが 10 個入っていた（2026-10-19）
  const alone = observeBreeders([breeder('d1', ghostPair(), [])], [breeder('d1', ghostPair(), [egg('e1', 'GuardianDog')])]);
  assert.deepEqual([alone.candidates, alone.anomalies], [[], []]);
  // 牧場で産まれてすぐ拾われ、配合器に入れられたタマゴ（main の前の動きと同じ）
  const fromFarm = observeBreeders([breeder('d1', ghostPair(), [])], [breeder('d1', ghostPair(), [egg('e1', 'GuardianDog')])], {
    farmsBefore: [farm('f1', sheep(), [])], farmsAfter: [farm('f1', sheep(), [])], eggsAfter: [looseEgg('e1', 'GuardianDog')],
  });
  assert.deepEqual(fromFarm.anomalies, []);
  assert.deepEqual(fromFarm.candidates.map((c) => [pairText(c), c.evidence.map((e) => e.farmId)]), [['SheepBall(F)×SwordCutlassfish(M)>GuardianDog', ['f1']]]);
});

test('配合器: どこかで前に見たタマゴ（牧場の上・所持品）を入れても、新しいタマゴと数えない', () => {
  const { candidates } = observeBreeders([breeder('d1', sheep(), [])], [breeder('d1', sheep(), [egg('f-egg', 'GuardianDog'), egg('loose', 'GuardianDog')])], {
    farmsBefore: [farm('f1', [parent('GuardianDog', 'Male'), parent('GuardianDog', 'Female')], [egg('f-egg', 'GuardianDog')])],
    eggsBefore: [looseEgg('loose', 'GuardianDog')],
  });
  assert.deepEqual(candidates, []);
});

test('配合器: 前からあるタマゴは見ない', () => {
  const old = egg('old', 'GuardianDog');
  const { candidates } = observeBreeders([breeder('d1', sheep(), [old])], [breeder('d1', sheep(), [old])]);
  assert.deepEqual(candidates, []);
});

test('配合器: 親が同じなら、突然変異タマゴは親の組み合わせの配合（表の子）とみなす', () => {
  const mutation = egg('m1', 'BOSS_DomeArmorDragon', 'PalEgg_MutationPal_05');
  const { candidates, anomalies } = observeBreeders([breeder('d1', ghostPair(), [])], [breeder('d1', ghostPair(), [mutation])]);
  assert.deepEqual(anomalies, []);
  assert.deepEqual(candidates.map(pairText), ['GhostDragon_Fire(M)×GhostDragon_Fire(F)>GhostDragon_Fire']);
});

test('配合器: 親を入れ替えていても、前の親かいまの親のどちらか 1 組だけの表の子なら、その配合とみなす', () => {
  // 前の親（SheepBall×SwordCutlassfish → GuardianDog）が産んでから入れ替えた
  const prev = observeBreeders([breeder('d1', sheep(), [])], [breeder('d1', ghostPair(), [egg('e1', 'GuardianDog')])]);
  assert.deepEqual(prev.candidates.map(pairText), ['SheepBall(F)×SwordCutlassfish(M)>GuardianDog']);
  assert.deepEqual(prev.candidates[0].evidence.map((e) => e.farmId), ['d1']);
  // いまの親（ヘルバーン）が、入れ替えた後の保存までに産んだ
  const next = observeBreeders([breeder('d1', sheep(), [])], [breeder('d1', ghostPair(), [egg('e1', 'GhostDragon_Fire')])]);
  assert.deepEqual(next.candidates.map(pairText), ['GhostDragon_Fire(M)×GhostDragon_Fire(F)>GhostDragon_Fire']);
  // 親を外した後でも、前の親で照合する
  const removed = observeBreeders([breeder('d1', sheep(), [])], [breeder('d1', [], [egg('e1', 'GuardianDog')])]);
  assert.deepEqual(removed.candidates.map(pairText), ['SheepBall(F)×SwordCutlassfish(M)>GuardianDog']);
});

test('配合器: 親を入れ替えたとき、前の親もいまの親も同じ子になる（違う組み合わせ）なら、どちらか決められないので見ない', () => {
  // SheepBall×SwordCutlassfish も KendoFrog×KendoFrog_Dark も GuardianDog
  const { candidates } = observeBreeders([breeder('d1', sheep(), [])], [breeder('d1', frogs(), [egg('e1', 'GuardianDog')])]);
  assert.deepEqual(candidates, []);
});

test('配合器: 親を入れ替えたときの突然変異タマゴは、どの親か決められないので見ない', () => {
  const mutation = egg('m1', 'BOSS_DomeArmorDragon', 'PalEgg_MutationPal_05');
  const { candidates } = observeBreeders([breeder('d1', sheep(), [])], [breeder('d1', ghostPair(), [mutation])]);
  assert.deepEqual(candidates, []);
});

test('配合器: 配合器の親（いまの親・撤去した配合器の前の親）は、牧場の外のタマゴの照合に使わない', () => {
  const now = observeBreeders([breeder('d1', sheep(), [])], [breeder('d1', sheep(), [])], { eggsAfter: [looseEgg('x1', 'GuardianDog')] });
  assert.deepEqual(now.candidates, []);
  const removed = observeBreeders([breeder('d1', sheep(), [])], [], { eggsAfter: [looseEgg('x1', 'GuardianDog')] });
  assert.deepEqual(removed.candidates, []);
});

test('配合器: 配合器の中のタマゴは、牧場の外のタマゴとして牧場の親と二重に照合しない', () => {
  const { candidates } = observeBreeders([breeder('d1', sheep(), [])], [breeder('d1', sheep(), [egg('e1', 'GuardianDog')])], {
    farmsBefore: [farm('f1', sheep(), [])], farmsAfter: [farm('f1', sheep(), [])], eggsAfter: [looseEgg('e1', 'GuardianDog')],
  });
  assert.deepEqual(candidates[0].evidence.map((e) => e.farmId), ['d1']);
});

test('配合器: 親が 1 体・uncertain の配合器は、親が同じでも照合しない', () => {
  for (const [parents, status] of [[[parent('SheepBall', 'Female')], 'ok'], [sheep(), 'uncertain']]) {
    const { candidates, anomalies } = observeBreeders([breeder('d1', parents, [], status)], [breeder('d1', parents, [egg('e1', 'GuardianDog')], status)]);
    assert.deepEqual([candidates, anomalies], [[], []], JSON.stringify([parents.length, status]));
  }
});

test('配合器: いまの親が読めない（uncertain）配合器では、前に読んだときの親でも決めない（Codex のレビュー）', () => {
  const { candidates } = observeBreeders([breeder('d1', sheep(), [])], [breeder('d1', sheep(), [egg('e1', 'GuardianDog')], 'uncertain')]);
  assert.deepEqual(candidates, []);
});

test('配合器: 同じ配合になる別の人の親に入れ替えたときは、両方の親を根拠に残す（登録者は resolveRegistrant が決める。Codex のレビュー）', () => {
  const of = (depositor) => [
    { instanceId: `sheep-${depositor}`, characterId: 'SheepBall', gender: 'Female', depositorUid: depositor },
    { instanceId: `sword-${depositor}`, characterId: 'SwordCutlassfish', gender: 'Male', depositorUid: depositor },
  ];
  const { candidates } = observeBreeders([breeder('d1', of(P1), [])], [breeder('d1', of(P2), [egg('e1', 'GuardianDog')])]);
  assert.deepEqual(candidates.map(pairText), ['SheepBall(F)×SwordCutlassfish(M)>GuardianDog']);
  assert.deepEqual(candidates[0].evidence.map((e) => e.depositorUids).sort(), [[P1, P1], [P2, P2]]);
  // 2 人が別のユーザーなら、登録者はログイン中のユーザー
  const people = [{ uid: P1, name: 'Dave' }, { uid: P2, name: 'Frank' }];
  assert.deepEqual(resolveRegistrant(candidates[0], { players: people, users: ['dave', 'frank', 'me'], currentUserId: 'me' }), { userId: 'me' });
});

const candidate = (...pairs) => ({ evidence: pairs.map((depositorUids) => ({ farmId: 'f', eggLocalId: 'e', depositorUids })) });
const players = [{ uid: P1, name: 'Dave' }, { uid: P2, name: 'Frank' }];
const users = ['dave', 'ユーザーB', 'me'];

test('登録者: 親 2 体を同じ人が預けていれば、その人に対応するユーザー（手で選んだもの > 同じ名前）', () => {
  assert.deepEqual(resolveRegistrant(candidate([P1, P1]), { players, users, currentUserId: 'me' }), { userId: 'dave' });
  assert.deepEqual(resolveRegistrant(candidate([P1, P1]), { players, users, mapping: { [P1]: 'ユーザーB' }, currentUserId: 'me' }), { userId: 'ユーザーB' });
  assert.deepEqual(resolveRegistrant(candidate([P2, P2], [P2, P2]), { players, users, mapping: { [P2]: 'ユーザーb' }, currentUserId: 'me' }), { userId: 'ユーザーB' });
});

test('登録者: 預けた人が違う・分からない・牧場ごとに食い違うときはログイン中のユーザー', () => {
  const opts = { players, users, currentUserId: 'me' };
  assert.deepEqual(resolveRegistrant(candidate([P1, P2]), opts), { userId: 'me' });
  assert.deepEqual(resolveRegistrant(candidate(['', '']), opts), { userId: 'me' });
  assert.deepEqual(resolveRegistrant(candidate([P1, P1], [P2, P2]), opts), { userId: 'me' });
});

test('登録者: 対応するユーザーがいない・消えたときは未設定（登録しない）', () => {
  assert.deepEqual(resolveRegistrant(candidate([P2, P2]), { players, users, currentUserId: 'me' }), { unmapped: P2 });
  assert.deepEqual(resolveRegistrant(candidate([P2, P2]), { players, users, mapping: { [P2]: '退会した人' }, currentUserId: 'me' }), { unmapped: P2 });
  assert.deepEqual(resolveRegistrant(candidate(['p-9', 'p-9']), { players, users, currentUserId: 'me' }), { unmapped: 'p-9' });
  assert.equal(mappedUser({ uid: 'x', name: '' }, { users }), '');
});
