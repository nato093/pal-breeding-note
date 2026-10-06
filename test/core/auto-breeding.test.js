import { test } from 'node:test';
import assert from 'node:assert/strict';
import data from '../../web/data/breeding.js';
import pals from '../../web/data/pals.js';
import { decodeBreeding } from '../../web/js/core/breeding.js';
import { createSpeciesResolver } from '../../web/js/core/owned.js';
import { findFarmBreedings, resolveRegistrant, mappedUser } from '../../web/js/core/auto-breeding.js';

const deps = { resolveSpecies: createSpeciesResolver(pals), table: decodeBreeding(data) };
const P1 = 'p-1';
const P2 = 'p-2';
const parent = (characterId, gender, depositorUid = P1) => ({ instanceId: `${characterId}-${gender}`, characterId, gender, depositorUid });
const farm = (id, parents, eggs, status = 'ok') => ({ id, baseId: 'b', status, parents, eggs: eggs.map((c, i) => ({ localId: `${id}-egg${i}`, characterId: c })) });

test('自動登録の照合: タマゴが配合表どおりなら候補にし、親の並びと性別をそろえる', () => {
  const { candidates, mismatches } = findFarmBreedings({ breedFarms: [
    farm('f1', [parent('SwordCutlassfish', 'Male'), parent('BOSS_SheepBall', 'Female')], ['GuardianDog']),
  ] }, deps);
  assert.deepEqual(mismatches, []);
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].record, {
    parent1Id: 'SheepBall', parent1Gender: 'F', parent2Id: 'SwordCutlassfish', parent2Gender: 'M', childId: 'GuardianDog',
  });
  assert.deepEqual(candidates[0].evidence, [{ farmId: 'f1', eggLocalId: 'f1-egg0', depositorUids: [P1, P1] }]);
});

test('自動登録の照合: 同じ組み合わせは 1 件にまとめ、根拠（牧場・タマゴ）はすべて残す', () => {
  const pair = () => [parent('GhostDragon_Fire', 'Male'), parent('BOSS_GhostDragon_Fire', 'Female')];
  const { candidates } = findFarmBreedings({ breedFarms: [
    farm('f1', pair(), ['GhostDragon_Fire', 'BOSS_GhostDragon_Fire']),
    farm('f2', pair(), ['GhostDragon_Fire']),
  ] }, deps);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].record.childId, 'GhostDragon_Fire');
  assert.deepEqual(candidates[0].evidence.map((e) => e.eggLocalId), ['f1-egg0', 'f1-egg1', 'f2-egg0']);
});

test('自動登録の照合: 配合表と違うタマゴ（親を入れ替えた後の古いタマゴなど）は不一致として返す', () => {
  const { candidates, mismatches } = findFarmBreedings({ breedFarms: [
    farm('f1', [parent('GhostDragon_Fire', 'Male'), parent('IceNarwhal_Fire', 'Female')], ['GuardianDog']),
  ] }, deps);
  assert.deepEqual(candidates, []);
  assert.equal(mismatches.length, 1);
  assert.equal(mismatches[0].actual, 'GuardianDog');
  assert.ok(mismatches[0].expected && mismatches[0].expected !== 'GuardianDog');
});

test('自動登録の照合: 親がいない・1 体・同じ性別・タマゴなし・uncertain の牧場は何もしない', () => {
  const { candidates, mismatches } = findFarmBreedings({ breedFarms: [
    farm('f1', [], ['GuardianDog']),
    farm('f2', [parent('SheepBall', 'Female')], ['SheepBall']),
    farm('f3', [parent('SheepBall', 'Female'), parent('SwordCutlassfish', 'Female')], ['GuardianDog']),
    farm('f4', [parent('SheepBall', 'Female'), parent('SwordCutlassfish', 'Male')], []),
    farm('f5', [parent('SheepBall', 'Female'), parent('SwordCutlassfish', 'Male')], ['GuardianDog'], 'uncertain'),
  ] }, deps);
  assert.deepEqual([candidates, mismatches], [[], []]);
});

test('自動登録の照合: breedFarms のない古いデータは空', () => {
  assert.deepEqual(findFarmBreedings({ pals: [] }, deps), { candidates: [], mismatches: [] });
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
