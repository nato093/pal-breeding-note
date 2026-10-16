// パル次元ストレージの読み漏れ（dps-missing）: buildSnapshot が Level.sav の InLockerCharacterInstanceIDArray の個体のうち、
// 読めた _dps.sav にない数を、個体 ID の集合の差で数える（数だけを残す）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot } from '../../web/js/save/palworld.js';

const P1 = '00000000-0000-0000-0000-000000000001';
const P2 = '00000000-0000-0000-0000-000000000002';

// parseLevel の結果の形（buildSnapshot が読む項目だけ）
function level(inLockerInstanceIds) {
  return {
    kind: 'level', savedAtTicks: null, realDateTimeTicks: null, gameDateTimeTicks: null,
    players: [], pals: [], guilds: [], bases: [], guildStorages: [], eggs: [], containerOwners: {}, displayCages: [],
    itemCounts: [], itemOwners: {}, breedFarms: [], malformed: {},
    ...(inLockerInstanceIds ? { inLockerInstanceIds } : {}),
  };
}

// parsePalStorage の結果の 1 体
const dpsPal = (instanceId, arrayIndex) => ({
  instanceId, keyPlayerUid: '', arrayIndex, characterId: 'SheepBall', nickname: '', gender: 'Female', level: 1, rank: 1,
  passives: [], skills: [], talent: { hp: 0, shot: 0, defense: 0 }, isRare: false, ownerUid: '', lastOwnerUid: '', ownedAt: '', soul: {}, condition: {},
});
const dps = (playerUid, ids) => ({ playerUid, data: { kind: 'dps', slotCount: ids.length, pals: ids.map((id, i) => dpsPal(id, i)), malformed: {} } });

test('次元ストレージの読み漏れ: Level.sav の ID {A,B} と読めた _dps.sav の ID {A,C} なら、Level.sav 2 体・読めていない 1 体（数だけを残す）', () => {
  const snap = buildSnapshot({ level: level(['A', 'B']), dps: [dps(P1, ['A', 'C'])] });
  assert.deepEqual([snap.stats.inLocker, snap.stats.inLockerMissing], [2, 1]);
  // 個体の ID は stats に残さない
  assert.equal(JSON.stringify(snap.stats).includes('"B"'), false);
  // _dps.sav にだけある個体（C）は欠けに数えない。読めた個体は今どおり次元ストレージとして出る
  assert.deepEqual(snap.pals.map((pal) => [pal.instanceId, pal.location.kind]), [['A', 'dps'], ['C', 'dps']]);
});

test('次元ストレージの読み漏れ: 2 人の _dps.sav がそろえば 0。1 人分が欠けると、その人の個体の数だけ読めていない（だれの分かは残さない）', () => {
  const all = buildSnapshot({ level: level(['A', 'B', 'C', 'D']), dps: [dps(P1, ['A', 'B']), dps(P2, ['C', 'D'])] });
  assert.deepEqual([all.stats.inLocker, all.stats.inLockerMissing], [4, 0]);
  const one = buildSnapshot({ level: level(['A', 'B', 'C', 'D']), dps: [dps(P1, ['A', 'B'])] });
  assert.deepEqual([one.stats.inLocker, one.stats.inLockerMissing], [4, 2]);
  // 同じ ID が Level.sav の一覧に 2 回あっても 1 体として数える
  const twice = buildSnapshot({ level: level(['A', 'A', 'B']), dps: [dps(P1, ['A'])] });
  assert.deepEqual([twice.stats.inLocker, twice.stats.inLockerMissing], [2, 1]);
});

test('次元ストレージの読み漏れ: 読めなかった _dps.sav（中身がない）は読めた分に数えない。一覧のない Level.sav（ほかのワールド・古いセーブ）は 0 体', () => {
  const broken = buildSnapshot({ level: level(['A', 'B']), dps: [dps(P1, ['A']), { playerUid: P2, data: null }, { playerUid: P2, data: { pals: 'x' } }] });
  assert.deepEqual([broken.stats.inLocker, broken.stats.inLockerMissing], [2, 1]);
  const none = buildSnapshot({ level: level(), dps: [dps(P1, ['A'])] });
  assert.deepEqual([none.stats.inLocker, none.stats.inLockerMissing], [0, 0]);
  const empty = buildSnapshot({ level: level([]) });
  assert.deepEqual([empty.stats.inLocker, empty.stats.inLockerMissing], [0, 0]);
});
