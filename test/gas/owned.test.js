import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGas, FakeSpreadsheet } from './harness.js';
import { OWNED_FIELDS } from '../../web/js/core/owned-shared.js';

const PROPS = { PASSCODE: 'AAAA-BBBB-CCCC-DDDD', TEST_PASSCODE: 'EEEE-FFFF-GGGG-HHHH' };
const plain = (value) => JSON.parse(JSON.stringify(value));
const WORLD_A = '4A431AC14B58A7E31A76B2A991F79FE8';
const WORLD_B = '88DC480846CA4D73A670DA90D96950DC';

function fixture(options = {}) {
  const env = createGas({ properties: PROPS, ...options });
  env.gas.setup();
  env.call = (action, fields = {}, passcode = PROPS.TEST_PASSCODE) => plain(env.gas.handleRequest_(JSON.stringify({ action, passcode, ...fields })));
  env.pals = () => env.spreadsheet.getSheetByName('OwnedPals_test');
  return env;
}

const row = (instanceId, overrides = {}) => OWNED_FIELDS.map((field) => (field === 'instanceId' ? instanceId : overrides[field] ?? ''));
const upload = (worldId, rows, saveUpdatedAt = '2026-10-05T10:00:00.000Z', extra = {}) => ({
  userId: 'ホスト', worldId, world: { name: 'LC9', hostName: 'Etona' }, saveUpdatedAt,
  players: [{ uid: '00000000-0000-0000-0000-000000000001', name: 'Etona' }], bases: [{ id: 'b1', label: '拠点 1' }],
  columns: OWNED_FIELDS, rows, ...extra,
});

test('所持パル共有: setup で本番・テストのシートを作り、ワールドごとに保存して読み出せる', () => {
  const env = fixture();
  for (const name of ['OwnedPals', 'OwnedWorlds', 'OwnedPals_test', 'OwnedWorlds_test']) assert.ok(env.spreadsheet.getSheetByName(name), name);
  assert.deepEqual(env.call('ownedWorlds').worlds, []);
  const stored = env.call('ownedUpload', upload(WORLD_A.toLowerCase(), [row('p1', { palId: 'SheepBall', nickname: '=HYPERLINK("x")' }), row('p2')]));
  assert.equal(stored.ok, true);
  assert.equal(stored.stored, true);
  assert.equal(stored.world.worldId, WORLD_A);
  assert.equal(stored.world.palCount, 2);
  const worlds = env.call('ownedWorlds').worlds;
  assert.deepEqual(worlds.map((w) => [w.worldId, w.worldName, w.hostName, w.uploadedBy, w.palCount]), [[WORLD_A, 'LC9', 'Etona', 'ホスト', 2]]);
  assert.deepEqual(worlds[0].bases, [{ id: 'b1', label: '拠点 1' }]);
  const owned = env.call('owned', { worldId: WORLD_A });
  assert.deepEqual(owned.columns, OWNED_FIELDS);
  assert.deepEqual(owned.rows.map((r) => r[0]), ['p1', 'p2']);
  // 式として解釈される文字列は、シートには ' を付けて書く
  const sheet = env.pals();
  const header = sheet.data[0];
  assert.equal(sheet.data[1][header.indexOf('nickname')], `'=HYPERLINK("x")`);
  const none = env.call('owned', { worldId: WORLD_B });
  assert.deepEqual([none.ok, none.world, none.rows], [true, null, []]);
});

test('所持パル共有: 配合牧場をワールドの行に残して返す。farms 列のない古いシートでも共有でき、setup をやり直すと列を足す', () => {
  const farms = [{ id: 'F1', baseId: 'b1', parents: ['p1', 'p2'] }];
  const env = fixture();
  env.call('ownedUpload', upload(WORLD_A, [row('p1'), row('p2')], '2026-10-05T10:00:00.000Z', { farms }));
  assert.deepEqual(env.call('ownedWorlds').worlds[0].farms, farms);
  assert.deepEqual(env.call('owned', { worldId: WORLD_A }).world.farms, farms);
  // 列を足す前のシート（farms 列がない）
  const old = fixture();
  const sheet = old.spreadsheet.getSheetByName('OwnedWorlds_test');
  const at = sheet.data[0].indexOf('farms');
  for (const line of sheet.data) line.splice(at, 1);
  const stored = old.call('ownedUpload', upload(WORLD_A, [row('p1')], '2026-10-05T10:00:00.000Z', { farms }));
  assert.equal(stored.stored, true);
  // 列がないので牧場の情報はない（null。「牧場なし」の [] とは区別する）
  assert.equal(old.call('ownedWorlds').worlds[0].farms, null);
  // 所有者が setup を実行し直すと、既存の列とデータはそのままで、末尾に farms 列が足され、見出しの保護も付く
  const protections = sheet.protections.length;
  old.gas.setup();
  assert.equal(sheet.data[0][sheet.data[0].length - 1], 'farms');
  assert.equal(sheet.protections.length, protections + 1);
  assert.equal(old.call('ownedWorlds').worlds[0].farms, null);
  assert.equal(old.call('ownedWorlds').worlds[0].worldName, 'LC9');
  old.call('ownedUpload', upload(WORLD_A, [row('p1')], '2026-10-05T11:00:00.000Z', { farms }));
  assert.deepEqual(old.call('ownedWorlds').worlds[0].farms, farms);
  // もう一度 setup しても列は増えない
  old.gas.setup();
  assert.equal(sheet.data[0].filter((header) => header === 'farms').length, 1);
  // 牧場を送らない古い画面からの共有は、牧場の情報なし（null）として残る
  old.call('ownedUpload', upload(WORLD_A, [row('p1')], '2026-10-05T12:00:00.000Z'));
  assert.equal(old.call('ownedWorlds').worlds[0].farms, null);
});

test('所持パル共有: 同じワールドは丸ごと置き換え（消えたパルは消える）、他のワールドは残す', () => {
  const env = fixture({ spreadsheet: new FakeSpreadsheet({ stripQuotes: true }) });
  env.call('ownedUpload', upload(WORLD_A, [row('a1'), row('a2'), row('a3')]));
  env.call('ownedUpload', upload(WORLD_B, [row('b1', { nickname: '=1+1' })], '2026-10-01T00:00:00.000Z', { world: { name: '別', hostName: 'harapi' } }));
  const replaced = env.call('ownedUpload', upload(WORLD_A, [row('a2'), row('a4')], '2026-10-05T11:00:00.000Z'));
  assert.equal(replaced.stored, true);
  assert.deepEqual(env.call('owned', { worldId: WORLD_A }).rows.map((r) => r[0]), ['a2', 'a4']);
  const other = env.call('owned', { worldId: WORLD_B }).rows;
  assert.deepEqual(other.map((r) => r[0]), ['b1']);
  assert.equal(other[0][OWNED_FIELDS.indexOf('nickname')], '=1+1');
  assert.equal(env.call('ownedWorlds').worlds.length, 2);
});

test('所持パル共有: 古いセーブは新しいセーブを上書きしない（競合は新しい方を残す）', () => {
  const env = fixture();
  env.call('ownedUpload', upload(WORLD_A, [row('new')], '2026-10-05T12:00:00.000Z'));
  const stale = env.call('ownedUpload', upload(WORLD_A, [row('old')], '2026-10-05T11:00:00.000Z'));
  assert.equal(stale.ok, true);
  assert.equal(stale.stored, false);
  assert.equal(stale.reason, 'STALE');
  assert.equal(stale.world.saveUpdatedAt, '2026-10-05T12:00:00.000Z');
  assert.deepEqual(env.call('owned', { worldId: WORLD_A }).rows.map((r) => r[0]), ['new']);
  const same = env.call('ownedUpload', upload(WORLD_A, [row('same')], '2026-10-05T12:00:00.000Z'));
  assert.equal(same.stored, true);
});

test('所持パル共有: 形の違うアップロードは書き込まずに拒否し、削除で共有をやめられる', () => {
  const env = fixture();
  for (const [fields, field] of [
    [upload('XYZ', [row('a')]), 'worldId'],
    [upload(WORLD_A, [row('a')], 'not a time'), 'saveUpdatedAt'],
    [upload(WORLD_A, [row('a')], undefined, { columns: ['instanceId'] }), 'columns'],
    [upload(WORLD_A, [['short']]), 'rows'],
    [{ ...upload(WORLD_A, [row('a')]), extra: 1 }, 'extra'],
  ]) {
    const result = env.call('ownedUpload', fields);
    assert.equal(result.code, 'VALIDATION', field);
    assert.equal(result.errors[0].field, field);
  }
  assert.equal(env.pals().getLastRow(), 1);
  env.call('ownedUpload', upload(WORLD_A, [row('a'), row('b')]));
  env.call('ownedUpload', upload(WORLD_B, [row('c')]));
  const removed = env.call('ownedDelete', { worldId: WORLD_A });
  assert.deepEqual([removed.deleted, removed.removed], [true, 2]);
  assert.deepEqual(env.call('ownedWorlds').worlds.map((w) => w.worldId), [WORLD_B]);
  assert.deepEqual(env.call('owned', { worldId: WORLD_B }).rows.map((r) => r[0]), ['c']);
  assert.equal(env.call('ownedDelete', { worldId: WORLD_A }).deleted, false);
});

test('所持パル共有: 大きなアップロードだけ 16 KB を超えて受け付ける', () => {
  const env = fixture();
  const rows = Array.from({ length: 300 }, (_, i) => row(`p${i}`, { palName: 'モコロン'.repeat(5) }));
  const result = env.call('ownedUpload', upload(WORLD_A, rows));
  assert.equal(result.stored, true);
  const big = plain(env.gas.handleRequest_(JSON.stringify({ action: 'snapshot', passcode: PROPS.TEST_PASSCODE, pad: 'x'.repeat(20000) })));
  assert.equal(big.code, 'TOO_LARGE');
});
