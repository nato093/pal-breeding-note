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
function observe(before, after) {
  const { history } = findNewBreedings({ breedFarms: before }, { ...deps, history: null });
  return findNewBreedings({ breedFarms: after }, { ...deps, history });
}

test('自動登録の照合: 初めて読んだセーブは記録するだけで、候補を出さない', () => {
  const result = findNewBreedings({ breedFarms: [farm('f1', sheep(), [egg('e1', 'GuardianDog')])] }, { ...deps, history: null });
  assert.deepEqual([result.candidates, result.anomalies], [[], []]);
  assert.deepEqual(result.history, { f1: { parents: 'BOSS_SheepBall-Female|SwordCutlassfish-Male', eggs: ['e1'] } });
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
  assert.deepEqual(findNewBreedings({ pals: [] }, { ...deps, history: {} }), { candidates: [], anomalies: [], history: {} });
});

const candidate = (...pairs) => ({ evidence: pairs.map((depositorUids) => ({ farmId: 'f', eggLocalId: 'e', depositorUids })) });
const players = [{ uid: P1, name: 'Etona' }, { uid: P2, name: 'harapi' }];
const users = ['etona', 'ユーザーB', 'me'];

test('登録者: 親 2 体を同じ人が預けていれば、その人に対応するユーザー（手で選んだもの > 同じ名前）', () => {
  assert.deepEqual(resolveRegistrant(candidate([P1, P1]), { players, users, currentUserId: 'me' }), { userId: 'etona' });
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
