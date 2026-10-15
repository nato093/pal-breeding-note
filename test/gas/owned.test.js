import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGas, FakeSpreadsheet } from './harness.js';
import { OWNED_FIELDS } from '../../web/js/core/owned-shared.js';

const PROPS = { PASSCODE: 'AAAA-BBBB-CCCC-DDDD', TEST_PASSCODE: 'EEEE-FFFF-GGGG-HHHH' };
const plain = (value) => JSON.parse(JSON.stringify(value));
const WORLD_A = 'ABCDEF0123456789ABCDEF0123456789';
const WORLD_B = 'FEDCBA9876543210FEDCBA9876543210';

function fixture(options = {}) {
  const env = createGas({ properties: PROPS, ...options });
  env.gas.setup();
  env.call = (action, fields = {}, passcode = PROPS.TEST_PASSCODE) => plain(env.gas.handleRequest_(JSON.stringify({ action, passcode, ...fields })));
  env.pals = () => env.spreadsheet.getSheetByName('OwnedPals_test');
  return env;
}

const row = (instanceId, overrides = {}) => OWNED_FIELDS.map((field) => (field === 'instanceId' ? instanceId : overrides[field] ?? ''));
const upload = (worldId, rows, saveUpdatedAt = '2026-10-05T10:00:00.000Z', extra = {}) => ({
  userId: 'ホスト', worldId, world: { name: 'World9', hostName: 'Dave' }, saveUpdatedAt,
  players: [{ uid: '00000000-0000-0000-0000-000000000001', name: 'Dave' }], bases: [{ id: 'b1', label: '拠点 1' }],
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
  assert.deepEqual(worlds.map((w) => [w.worldId, w.worldName, w.hostName, w.uploadedBy, w.palCount]), [[WORLD_A, 'World9', 'Dave', 'ホスト', 2]]);
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
  assert.equal(old.call('ownedWorlds').worlds[0].worldName, 'World9');
  old.call('ownedUpload', upload(WORLD_A, [row('p1')], '2026-10-05T11:00:00.000Z', { farms }));
  assert.deepEqual(old.call('ownedWorlds').worlds[0].farms, farms);
  // もう一度 setup しても列は増えない
  old.gas.setup();
  assert.equal(sheet.data[0].filter((header) => header === 'farms').length, 1);
  // 牧場を送らない古い画面からの共有は、牧場の情報なし（null）として残る
  old.call('ownedUpload', upload(WORLD_A, [row('p1')], '2026-10-05T12:00:00.000Z'));
  assert.equal(old.call('ownedWorlds').worlds[0].farms, null);
});

test('所持パル共有: 覚えているアクティブスキル（skillIds 列）を残して返す。列のない古いシート・古い画面からの共有でも動き、setup をやり直すと列を足す', () => {
  const skillAt = OWNED_FIELDS.indexOf('skillIds');
  const env = fixture();
  env.call('ownedUpload', upload(WORLD_A, [row('p1', { skillIds: 'AirCanon|PowerShot' })]));
  assert.equal(env.call('owned', { worldId: WORLD_A }).rows[0][skillAt], 'AirCanon|PowerShot');
  // 列を足す前のシート（skillIds 列がない）
  const old = fixture();
  const sheet = old.pals();
  const at = sheet.data[0].indexOf('skillIds');
  for (const line of sheet.data) line.splice(at, 1);
  const stored = old.call('ownedUpload', upload(WORLD_A, [row('p1', { skillIds: 'AirCanon' })]));
  assert.equal(stored.stored, true);
  // 列がないので書かずに、空として返す（ほかの列はそのまま）
  const before = old.call('owned', { worldId: WORLD_A });
  assert.deepEqual(before.columns, OWNED_FIELDS);
  assert.deepEqual([before.rows[0][0], before.rows[0][skillAt]], ['p1', '']);
  // skillIds 列を知らない古い画面（開いたままのページ）からの共有も受け付ける
  const legacyFields = OWNED_FIELDS.slice(0, skillAt);
  const legacy = old.call('ownedUpload', upload(WORLD_A, [row('p2').slice(0, skillAt)], '2026-10-05T11:00:00.000Z', { columns: legacyFields }));
  assert.equal(legacy.stored, true);
  assert.deepEqual(old.call('owned', { worldId: WORLD_A }).rows.map((r) => [r[0], r[skillAt]]), [['p2', '']]);
  // 所有者が setup を実行し直すと、既存の列とデータはそのままで、末尾に skillIds 列が足される
  old.gas.setup();
  assert.equal(sheet.data[0][sheet.data[0].length - 1], 'skillIds');
  assert.equal(old.call('owned', { worldId: WORLD_A }).rows[0][0], 'p2');
  old.call('ownedUpload', upload(WORLD_A, [row('p3', { skillIds: 'FireBall' })], '2026-10-05T12:00:00.000Z'));
  assert.deepEqual(old.call('owned', { worldId: WORLD_A }).rows.map((r) => [r[0], r[skillAt]]), [['p3', 'FireBall']]);
  old.gas.setup();
  assert.equal(sheet.data[0].filter((header) => header === 'skillIds').length, 1);
});

test('所持パル共有: 同じワールドは丸ごと置き換え（消えたパルは消える）、他のワールドは残す', () => {
  const env = fixture({ spreadsheet: new FakeSpreadsheet({ stripQuotes: true }) });
  env.call('ownedUpload', upload(WORLD_A, [row('a1'), row('a2'), row('a3')]));
  env.call('ownedUpload', upload(WORLD_B, [row('b1', { nickname: '=1+1' })], '2026-10-01T00:00:00.000Z', { world: { name: '別', hostName: 'Frank' } }));
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

test('所持パル共有: 配合牧場のタマゴ（短い鍵 s・eggs・n）も残して返し、大きな farms でもワールドの行のセルは 45,000 字以下で個体の行は全部保存する', () => {
  const env = fixture();
  const farms = [
    { id: 'F1', baseId: 'b1', parents: ['p1', 'p2'], n: 2, eggs: [{ id: 'e1', p: 'SheepBall' }, { id: 'e2', p: 'Anubis', m: 1 }] },
    { id: 'F2', baseId: 'b1', parents: [], s: 'u', n: 1 },
  ];
  env.call('ownedUpload', upload(WORLD_A, [row('p1'), row('p2')], '2026-10-05T10:00:00.000Z', { farms }));
  // 読めない牧場の親は、GAS でも仮の親 2 つにして残す（古い画面が s を捨てても空き牧場に数えない）
  assert.deepEqual(env.call('owned', { worldId: WORLD_A }).world.farms, [farms[0], { ...farms[1], parents: ['?1', '?2'] }]);
  const id = (prefix, i) => `${prefix}${i}`.padEnd(40, 'x');
  const big = Array.from({ length: 200 }, (_, i) => ({
    id: id('F', i), baseId: id('B', i), parents: [id('P', i), id('Q', i)], n: 20,
    eggs: Array.from({ length: 20 }, (_, j) => ({ id: id(`E${i}-`, j), p: 'SheepBall', m: 1 })),
  }));
  const rows = Array.from({ length: 50 }, (_, i) => row(`p${i}`));
  const stored = env.call('ownedUpload', upload(WORLD_A, rows, '2026-10-05T11:00:00.000Z', { farms: big }));
  assert.equal(stored.stored, true);
  const sheet = env.spreadsheet.getSheetByName('OwnedWorlds_test');
  const cell = sheet.data[1][sheet.data[0].indexOf('farms')];
  assert.ok(String(cell).length <= 45000, String(String(cell).length));
  const back = env.call('owned', { worldId: WORLD_A });
  assert.equal(back.rows.length, 50);
  assert.equal(back.world.farms.length, 200);
  assert.ok(back.world.farms.every((farm) => farm.n === 20 && !('eggs' in farm)));
});

test('所持パル共有: タマゴのアイテム ID（eggItemId 列）を残して返す。列のない古いシートでは書かずに空で返し、setup をやり直すと列を足す', () => {
  const eggAt = OWNED_FIELDS.indexOf('eggItemId');
  // eggItemId の後に ownedAt（save-extras）
  assert.equal(eggAt, OWNED_FIELDS.length - 2);
  const env = fixture();
  env.call('ownedUpload', upload(WORLD_A, [row('e1', { egg: '1', eggItemId: 'PalEgg_Dark_03' })]));
  assert.equal(env.call('owned', { worldId: WORLD_A }).rows[0][eggAt], 'PalEgg_Dark_03');
  const old = fixture();
  const sheet = old.pals();
  const at = sheet.data[0].indexOf('eggItemId');
  for (const line of sheet.data) line.splice(at, 1);
  assert.equal(old.call('ownedUpload', upload(WORLD_A, [row('e1', { eggItemId: 'PalEgg_Dark_03' })])).stored, true);
  const before = old.call('owned', { worldId: WORLD_A });
  assert.deepEqual([before.rows[0][0], before.rows[0][eggAt]], ['e1', '']);
  // eggItemId を知らない前の版の画面（skillIds まで）からの共有も受け付ける
  const legacy = old.call('ownedUpload', upload(WORLD_A, [row('e2').slice(0, eggAt)], '2026-10-05T11:00:00.000Z', { columns: OWNED_FIELDS.slice(0, eggAt) }));
  assert.equal(legacy.stored, true);
  old.gas.setup();
  assert.equal(sheet.data[0][sheet.data[0].length - 1], 'eggItemId');
  old.call('ownedUpload', upload(WORLD_A, [row('e3', { eggItemId: 'PalEgg_Fire_01' })], '2026-10-05T12:00:00.000Z'));
  assert.deepEqual(old.call('owned', { worldId: WORLD_A }).rows.map((r) => [r[0], r[eggAt]]), [['e3', 'PalEgg_Fire_01']]);
});

test('所持パル共有: 入手時刻（ownedAt 列）とゲーム内の日数（ワールドの inGameDay 列）を残して返す。列のない古いシートでは書かずに読み、setup をやり直すと列を足す（save-extras）', () => {
  const ownedAt = OWNED_FIELDS.indexOf('ownedAt');
  assert.equal(ownedAt, OWNED_FIELDS.length - 1);
  const time = '2026-10-15T12:52:16.570Z';
  const players = [{ uid: '00000000-0000-0000-0000-000000000001', name: 'Dave', level: 52, online: true }, { uid: '00000000-0000-0000-0000-000000000002', name: 'Frank', online: false }];
  const env = fixture();
  const stored = env.call('ownedUpload', upload(WORLD_A, [row('p1', { ownedAt: time })], '2026-10-05T10:00:00.000Z', {
    world: { name: 'World9', hostName: 'Dave', inGameDay: 123 }, players,
  }));
  assert.equal(stored.world.inGameDay, 123);
  const world = env.call('ownedWorlds').worlds[0];
  // Lv とプレイ中は players の JSON の中（列は増えない）、日数はワールドの行の列
  assert.deepEqual([world.inGameDay, world.players], [123, players]);
  const back = env.call('owned', { worldId: WORLD_A });
  assert.deepEqual([back.world.inGameDay, back.rows[0][ownedAt]], [123, time]);
  // 日数を送らない画面（前の版）・壊れた値は空のまま（null）
  env.call('ownedUpload', upload(WORLD_A, [row('p1')], '2026-10-05T11:00:00.000Z', { world: { name: 'World9', hostName: 'Dave', inGameDay: 'x' } }));
  assert.equal(env.call('ownedWorlds').worlds[0].inGameDay, null);

  // 列を足す前のシート（ownedAt・inGameDay の列がない）。共有は止まらず、新しい値は書かずに空で返す
  const old = fixture();
  const pals = old.pals();
  const palAt = pals.data[0].indexOf('ownedAt');
  for (const line of pals.data) line.splice(palAt, 1);
  const worlds = old.spreadsheet.getSheetByName('OwnedWorlds_test');
  const dayAt = worlds.data[0].indexOf('inGameDay');
  for (const line of worlds.data) line.splice(dayAt, 1);
  const before = old.call('ownedUpload', upload(WORLD_A, [row('p1', { ownedAt: time })], '2026-10-05T10:00:00.000Z', {
    world: { name: 'World9', hostName: 'Dave', inGameDay: 123 }, players,
  }));
  assert.deepEqual([before.stored, before.world.inGameDay], [true, null]);
  assert.equal(old.call('ownedWorlds').worlds[0].inGameDay, null);
  assert.equal(old.call('owned', { worldId: WORLD_A }).rows[0][ownedAt], '');
  // ownedAt を知らない前の版の画面（eggItemId まで）からの共有も受け付ける
  const legacy = old.call('ownedUpload', upload(WORLD_A, [row('p2').slice(0, ownedAt)], '2026-10-05T11:00:00.000Z', { columns: OWNED_FIELDS.slice(0, ownedAt) }));
  assert.equal(legacy.stored, true);
  old.gas.setup();
  assert.equal(pals.data[0][pals.data[0].length - 1], 'ownedAt');
  assert.equal(worlds.data[0][worlds.data[0].length - 1], 'inGameDay');
  old.call('ownedUpload', upload(WORLD_A, [row('p3', { ownedAt: time })], '2026-10-05T12:00:00.000Z', { world: { name: 'World9', hostName: 'Dave', inGameDay: 124 } }));
  assert.deepEqual(old.call('owned', { worldId: WORLD_A }).rows.map((r) => [r[0], r[ownedAt]]), [['p3', time]]);
  assert.equal(old.call('ownedWorlds').worlds[0].inGameDay, 124);
});
