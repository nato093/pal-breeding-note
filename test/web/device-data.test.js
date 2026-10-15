import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDeviceData, parseDeviceData, deviceFileName, draftsToAdd, mergeGoals, mergeObservationSpecies, importSummary, DEVICE_FORMAT, DEVICE_VERSION, DEVICE_MAX_BYTES,
} from '../../web/js/device-data.js';
import { cleanGoal, speciesGoal, GOAL_LIMIT } from '../../web/js/core/ideal-goals.js';
import { firstObservation } from '../../web/js/core/goal-observations.js';

const WORLD = 'ABCDEF0123456789ABCDEF0123456789';
const DRAFT = { id: '11111111-1111-4111-8111-111111111111', parent1Id: 'SheepBall', parent2Id: 'PinkCat', childId: 'CuteFox', parent1Gender: 'F', parent2Gender: 'M', registrant: '自分', memo: 'メモ', recordId: '' };
const goal = (palId, id = `g-${palId}`) => cleanGoal({ ...speciesGoal(palId, { name: palId }), id, addedAt: '2026-10-01T00:00:00.000Z' });
const time = () => Date.UTC(2026, 9, 15);

function exported(overrides = {}) {
  return buildDeviceData({
    env: 'test', userId: '自分', drafts: [DRAFT], goals: [goal('SheepBall')],
    observations: { version: 1, species: { SheepBall: firstObservation(['FlowerDoll|PinkCat'], '2026-10-15T00:00:00.000Z') } },
    read: ['release:a', 'wishlist:test:SheepBall:x'], notices: [{ id: 'auto-breed:test:unmapped:W:p', date: '2026-10-15T00:00:00.000Z', title: '未設定' }],
    mappings: { [WORLD]: { 'uid-1': '仲間' }, EMPTY: {} }, now: time, ...overrides,
  });
}

test('端末のデータ: 書き出しは形式・版・環境・ID と、下書き（性別は別の対応）・目標・観測・既読・自動登録の通知・登録者の対応だけを持つ', () => {
  const data = exported();
  assert.deepEqual(Object.keys(data), ['format', 'version', 'exportedAt', 'env', 'userId', 'drafts', 'draftGenders', 'goals', 'goalsObs', 'notificationsRead', 'autoBreedingNotices', 'playerMappings']);
  assert.deepEqual([data.format, data.version, data.exportedAt, data.env, data.userId], [DEVICE_FORMAT, DEVICE_VERSION, '2026-10-15T00:00:00.000Z', 'test', '自分']);
  // 下書きは保存の形（性別・送信の登録 ID なし）と、性別の対応（親の ID を控える）
  assert.deepEqual(data.drafts, [{ id: DRAFT.id, parent1Id: 'SheepBall', parent2Id: 'PinkCat', childId: 'CuteFox', registrant: '自分', memo: 'メモ' }]);
  assert.deepEqual(data.draftGenders, { [DRAFT.id]: { parent1Gender: 'F', parent2Gender: 'M', parent1Id: 'SheepBall', parent2Id: 'PinkCat' } });
  // 空の対応は書かない
  assert.deepEqual(data.playerMappings, { [WORLD]: { 'uid-1': '仲間' } });
  // パスワード・記録のキャッシュ・所持パル・牧場の記録は含まない
  assert.doesNotMatch(JSON.stringify(data), /passcode|records|snapshot|farms/);
  assert.equal(deviceFileName('test', new Date(2026, 9, 5)), 'pal-note-device-test-20261005.json');
});

test('端末のデータ: 読み込みは大きさ・JSON・形式・版・環境を確かめて断り、ID が違えば otherUser で知らせる', () => {
  const ok = parseDeviceData(JSON.stringify(exported()), { env: 'test', userId: '自分' });
  assert.equal(ok.ok, true);
  assert.equal(ok.otherUser, '');
  // 下書きは性別を合わせて戻す（控えた親の ID が同じ枠だけ）
  assert.deepEqual([ok.data.drafts[0].parent1Gender, ok.data.drafts[0].parent2Gender], ['F', 'M']);
  assert.equal(ok.data.goals.length, 1);
  assert.deepEqual(ok.data.notificationsRead, ['release:a', 'wishlist:test:SheepBall:x']);
  assert.equal(parseDeviceData('x'.repeat(DEVICE_MAX_BYTES + 1), { env: 'test', userId: '自分' }).reason, 'ファイルが大きすぎます（1MB まで）。');
  assert.match(parseDeviceData('壊れた', { env: 'test', userId: '自分' }).reason, /JSON ではありません/);
  assert.match(parseDeviceData(JSON.stringify({ format: 'other' }), { env: 'test', userId: '自分' }).reason, /書き出しのファイルではありません/);
  assert.match(parseDeviceData(JSON.stringify({ ...exported(), version: 2 }), { env: 'test', userId: '自分' }).reason, /版が違う/);
  // 環境（テスト／本番）が違えば断る
  assert.equal(parseDeviceData(JSON.stringify({ ...exported(), env: 'prod' }), { env: 'test', userId: '自分' }).reason, '本番のデータです。いまはテストなので読み込めません。');
  assert.equal(parseDeviceData(JSON.stringify(exported()), { env: 'test', userId: '仲間' }).otherUser, '自分');
});

test('端末のデータ: 読み込んだ値は信用せず整える（性別の親が違う枠は外す・形の合わない目標・長い既読・対応の形）', () => {
  const raw = {
    ...exported(),
    draftGenders: { [DRAFT.id]: { parent1Gender: 'F', parent2Gender: 'M', parent1Id: 'Anubis', parent2Id: 'PinkCat' } },
    goals: [goal('SheepBall'), { palId: '知らない' }, 'こわれた'],
    notificationsRead: ['release:a', 'release:a', 7, 'x'.repeat(201)],
    playerMappings: { [WORLD.toLowerCase()]: { 'uid-1': '仲間', 'uid-2': 7 }, 'bad': { 'uid-3': '仲間' } },
    autoBreedingNotices: [{ id: 'a' }, 'こわれた'],
  };
  const { data } = parseDeviceData(JSON.stringify(raw), { env: 'test', userId: '自分' });
  assert.deepEqual([data.drafts[0].parent1Gender, data.drafts[0].parent2Gender], ['', 'M']);
  assert.deepEqual(data.goals.map((item) => item.palId), ['SheepBall']);
  assert.deepEqual(data.notificationsRead, ['release:a']);
  assert.deepEqual(data.playerMappings, { [WORLD]: { 'uid-1': '仲間' } });
  assert.equal(data.autoBreedingNotices.length, 1);
});

test('端末のデータ: 併せ方は今のものを優先し、目標は重複と上限で止め、観測は mergeObservation で和にする', () => {
  // 下書き: 同じ id は足さない
  assert.deepEqual(draftsToAdd([DRAFT], [DRAFT, { ...DRAFT, id: '22222222-2222-4222-8222-222222222222' }]).map((draft) => draft.id), ['22222222-2222-4222-8222-222222222222']);
  // 目標: 同じ条件（goalKey）・同じ id は足さず、上限まで
  const current = [goal('SheepBall', 'mine')];
  const merged = mergeGoals(current, [goal('SheepBall', 'other'), goal('PinkCat'), goal('Anubis')], 2);
  assert.deepEqual(merged.goals.map((item) => item.id), ['mine', 'g-PinkCat']);
  assert.deepEqual([merged.added, merged.skipped], [1, 2]);
  assert.equal(mergeGoals([], Array.from({ length: GOAL_LIMIT + 3 }, (_, index) => ({ ...goal('SheepBall', `g${index}`), targets: { hp: index, shot: 0, defense: 0 }, passives: ['Rare'] }))).skipped, 3);
  // 観測: 足した種族だけ併せる（組の和）
  const obs = mergeObservationSpecies(
    { version: 1, species: { SheepBall: firstObservation(['A|B'], '2026-10-14T00:00:00.000Z') } },
    { version: 1, species: { SheepBall: firstObservation(['C|D'], '2026-10-15T00:00:00.000Z'), PinkCat: firstObservation([], '2026-10-15T00:00:00.000Z') } },
    ['SheepBall'],
  );
  assert.deepEqual(obs.species.SheepBall.pairs.sort(), ['A|B', 'C|D']);
  assert.equal(obs.species.PinkCat, undefined);
  // 確認の文
  const { data } = parseDeviceData(JSON.stringify(exported()), { env: 'test', userId: '自分' });
  assert.equal(importSummary(data), '下書き 1・目標 1・既読 2・自動登録の記録 1・登録者の対応 1 件を取り込みます。今のデータは消さずに足します。');
  assert.equal(importSummary({ drafts: [], goals: [], notificationsRead: [], autoBreedingNotices: [], playerMappings: {} }), '');
});
