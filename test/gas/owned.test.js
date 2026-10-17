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

// ---------------------------------------------------------------------------
// owned-gas（docs/sync-fixes/README.md の 3）: 世代の書き込み（F1）・結果の種類・PARTIAL・ownedSince・presence・compactOwned
// ---------------------------------------------------------------------------

const stamp = (n) => String(638650000000000000n + BigInt(n));
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
// セーブの識別（画面が world の中に入れて送る。テーマ 5）
const identity = ({ n = 1, hash = HASH_A, format = 1, fileCount = 6, missingCount = 0, force } = {}) => ({
  saveStamp: stamp(n), contentHash: hash, format, fileCount, missingCount, ...(force === undefined ? {} : { force }),
});
const rowsOf = (prefix, count) => Array.from({ length: count }, (_, i) => row(`${prefix}${i}`));
// 識別つきの共有（user は共有した人）
const send = (env, { worldId = WORLD_A, rows = rowsOf('p', 2), time = '2026-10-05T10:00:00.000Z', id, user = 'ホスト', passcode } = {}) => env.call('ownedUpload', {
  ...upload(worldId, rows, time, { world: { name: 'World9', hostName: 'Dave', ...(id ?? {}) } }), userId: user,
}, passcode);
// そのワールドの行の世代（updatedAt）ごとの数
function generations(env, worldId = WORLD_A, sheet = env.pals()) {
  const [header, ...lines] = sheet.data;
  const counts = {};
  for (const line of lines) {
    if (line[header.indexOf('worldId')] !== worldId) continue;
    const at = line[header.indexOf('updatedAt')];
    counts[at] = (counts[at] ?? 0) + 1;
  }
  return counts;
}
const worldsSheet = (env, name = 'OwnedWorlds_test') => env.spreadsheet.getSheetByName(name);
const worldCell = (env, field, name) => {
  const sheet = worldsSheet(env, name);
  return sheet.data[1]?.[sheet.data[0].indexOf(field)];
};

test('owned-gas F1: シート全体を消さず、他のワールドの行を書き直さず、最後の行の下に足して、そのワールドは 2 世代までにする', () => {
  const env = fixture();
  send(env, { worldId: WORLD_B, rows: rowsOf('b', 3) });
  const first = send(env, { rows: rowsOf('a', 2) });
  const before = env.pals().data.slice(1, 4).map((line) => line.join('\u0001'));
  env.spreadsheet.journal.length = 0;
  const second = send(env, { rows: rowsOf('c', 2), time: '2026-10-05T11:00:00.000Z' });
  const third = send(env, { rows: rowsOf('d', 2), time: '2026-10-05T12:00:00.000Z' });
  assert.deepEqual([first.result, second.result, third.result], ['new', 'newer', 'newer']);
  const ops = env.spreadsheet.journal.filter((entry) => entry.sheet === 'OwnedPals_test');
  assert.equal(ops.filter((entry) => entry.op === 'clearContent').length, 0);
  // 書き込みは足した行（最後の行の下）だけ。B の行（2〜4 行目）は書き直さない
  assert.ok(ops.filter((entry) => entry.op === 'setValues').every((entry) => entry.row > 4), JSON.stringify(ops));
  assert.deepEqual(env.pals().data.slice(1, 4).map((line) => line.join('\u0001')), before);
  // 2 世代（今と 1 つ前）だけが残り、読むのは今の世代だけ
  assert.deepEqual(generations(env), { [second.world.uploadedAt]: 2, [third.world.uploadedAt]: 2 });
  assert.deepEqual(env.call('owned', { worldId: WORLD_A }).rows.map((r) => r[0]), ['d0', 'd1']);
  assert.deepEqual(env.call('owned', { worldId: WORLD_B }).rows.map((r) => r[0]), ['b0', 'b1', 'b2']);
  // 世代の時刻は前の世代より後（同じミリ秒の送り直しでも）
  assert.ok(Date.parse(third.world.uploadedAt) > Date.parse(second.world.uploadedAt));
  assert.equal(third.cleanup, true);
});

test('owned-gas F1: ①→flush→②（公開）→flush→③ の順。書いている途中（公開の前）に読んでも前の世代を返す', () => {
  const env = fixture();
  send(env, { rows: rowsOf('old', 2) });
  send(env, { rows: rowsOf('mid', 2), time: '2026-10-05T10:30:00.000Z' });
  let during = null;
  // ② の書き込みの直前（OwnedWorlds の setValues）に読む
  worldsSheet(env).failNext('setValues', { when: () => { during = env.call('owned', { worldId: WORLD_A }); return false; } });
  env.spreadsheet.journal.length = 0;
  const stored = send(env, { rows: rowsOf('new', 3), time: '2026-10-05T11:00:00.000Z' });
  assert.equal(stored.stored, true);
  assert.deepEqual(during.rows.map((r) => r[0]), ['mid0', 'mid1']);
  const order = env.spreadsheet.journal.filter((entry) => ['flush', 'setValues', 'deleteRows'].includes(entry.op))
    .map((entry) => (entry.op === 'flush' ? 'flush' : `${entry.sheet}:${entry.op}`));
  assert.deepEqual(order, ['OwnedPals_test:setValues', 'flush', 'OwnedWorlds_test:setValues', 'flush', 'OwnedPals_test:deleteRows', 'flush']);
  assert.deepEqual(env.call('owned', { worldId: WORLD_A }).rows.map((r) => r[0]), ['new0', 'new1', 'new2']);
});

test('owned-gas F1: シートの行数が足りなければ余裕（1000 行）をつけて末尾に足し、世代を消してもシートの行数は減らさない', () => {
  const env = fixture();
  const sheet = env.pals();
  send(env, { rows: rowsOf('a', 600) });
  send(env, { rows: rowsOf('b', 600), time: '2026-10-05T11:00:00.000Z' });
  assert.ok(env.spreadsheet.journal.some((entry) => entry.sheet === 'OwnedPals_test' && entry.op === 'insertRowsAfter'));
  send(env, { rows: rowsOf('c', 600), time: '2026-10-05T12:00:00.000Z' });
  // 1201 行が要るので 1000 行の余裕をつけて 2201 行。最初の世代を消しても、同じ数を末尾に足し戻すので減らない
  assert.deepEqual([sheet.getMaxRows(), sheet.getLastRow()], [2201, 1201]);
  assert.equal(env.call('owned', { worldId: WORLD_A }).rows.length, 600);
  send(env, { rows: rowsOf('d', 700), time: '2026-10-05T13:00:00.000Z' });
  assert.deepEqual(env.call('owned', { worldId: WORLD_A }).rows.map((r) => r[0]).slice(-1), ['d699']);
  assert.equal(Object.keys(generations(env)).length, 2);
  assert.equal(sheet.getMaxRows(), 2201);
});

test('owned-gas 読み込み: 読む間に別のワールドの削除で行が動いても、範囲のエラーにならず読み直す', () => {
  const env = fixture();
  send(env, { worldId: WORLD_B, rows: rowsOf('b', 1200) });
  send(env, { rows: rowsOf('a', 3) });
  let done = false;
  // 所持パルの行の読み（見出しからの全部の行）の範囲を取る直前（最後の行を読んだ後）に、B の削除が入る（行が上に詰まる）
  env.pals().failNext('getRange', {
    when: (detail) => {
      if (detail.row !== 1 || detail.count < 2 || done) return false;
      done = true;
      env.call('ownedDelete', { worldId: WORLD_B });
      return false;
    },
  });
  const owned = env.call('owned', { worldId: WORLD_A });
  assert.deepEqual([owned.ok, owned.rows.map((r) => r[0])], [true, ['a0', 'a1', 'a2']]);
  // 読み込みの途中の例外も 1 回だけ読み直す（2 回続けば今までどおりの失敗）
  env.pals().failNext('getValues', { when: (detail) => detail.row === 1 && detail.count > 1 });
  assert.equal(env.call('owned', { worldId: WORLD_A }).rows.length, 3);
  worldsSheet(env).failNext('getValues');
  assert.equal(env.call('ownedWorlds').worlds.length, 1);
  env.pals().failNext('getValues', { times: 2, when: (detail) => detail.row === 1 && detail.count > 1 });
  assert.equal(env.call('owned', { worldId: WORLD_A }).code, 'INTERNAL');
});

test('owned-gas F1: 識別のない行（updatedAt＝uploadedAt・saveKey が空）を読み、次の共有で 1 つ前として残す', () => {
  const env = fixture();
  const old = env.call('ownedUpload', upload(WORLD_A, rowsOf('o', 2)));
  assert.deepEqual([old.result, old.world.saveStamp, worldCell(env, 'saveKey')], ['new', '', '']);
  assert.deepEqual(env.call('owned', { worldId: WORLD_A }).rows.map((r) => r[0]), ['o0', 'o1']);
  const next = send(env, { rows: rowsOf('n', 1), time: '2026-10-05T11:00:00.000Z', id: identity() });
  assert.equal(next.result, 'newer');
  assert.deepEqual(generations(env), { [old.world.uploadedAt]: 2, [next.world.uploadedAt]: 1 });
});

test('owned-gas 結果の種類: 表の全行（new・newer・stale・unchanged・resent・same）と応答の今公開されている world', () => {
  const env = fixture();
  const check = (response, result, stored) => {
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.deepEqual([response.result, response.stored], [result, stored]);
    assert.equal(typeof response.cleanup, 'boolean');
  };
  check(send(env, { id: identity({ n: 10 }) }), 'new', true);
  // 新しいセーブ（ファイルの更新日時が古くても、中の保存時刻で比べる）
  const newer = send(env, { id: identity({ n: 20, missingCount: 1 }), time: '2026-10-05T09:00:00.000Z' });
  check(newer, 'newer', true);
  assert.deepEqual([newer.world.saveStamp, newer.world.uploadedBy], [stamp(20), 'ホスト']);
  // 古いセーブ（ファイルの更新日時が新しくても）。応答は今公開されている world
  const stale = send(env, { id: identity({ n: 15 }), time: '2026-10-06T00:00:00.000Z' });
  check(stale, 'stale', false);
  assert.deepEqual([stale.reason, stale.world.saveStamp, stale.world.uploadedAt], ['STALE', stamp(20), newer.world.uploadedAt]);
  // 同じセーブ・同じ識別（同期の後に別の PC が読んだ・応答を失った後の再送）。誰からでも書かない
  const unchanged = send(env, { id: identity({ n: 20, missingCount: 1 }), time: '2026-10-07T00:00:00.000Z', user: 'ゲスト' });
  check(unchanged, 'unchanged', false);
  assert.deepEqual([unchanged.world.uploadedBy, unchanged.world.uploadedAt], ['ホスト', newer.world.uploadedAt]);
  // 同じ人の送り直しで中身がよくなった（読めなかったファイルが戻った・ファイルが増えた・形の版が上がった）
  check(send(env, { id: identity({ n: 20, hash: HASH_B, missingCount: 0 }) }), 'resent', true);
  check(send(env, { id: identity({ n: 20, hash: HASH_A, fileCount: 7 }) }), 'resent', true);
  check(send(env, { id: identity({ n: 20, hash: HASH_B, fileCount: 7, format: 2 }) }), 'resent', true);
  // 別の人のよい中身・同じ人の劣った中身（古いタブ）・よいところと悪いところがある中身・変わらない質の別の中身は same（書かない）
  check(send(env, { id: identity({ n: 20, hash: HASH_A, fileCount: 8, format: 2 }), user: 'ゲスト' }), 'same', false);
  check(send(env, { id: identity({ n: 20, hash: HASH_A, fileCount: 6, format: 2 }) }), 'same', false);
  check(send(env, { id: identity({ n: 20, hash: HASH_A, fileCount: 8, format: 1 }) }), 'same', false);
  check(send(env, { id: identity({ n: 20, hash: HASH_A, fileCount: 7, format: 2 }) }), 'same', false);
  // 登録の確定（force）は別の人でも、どれも悪くならなければ書く。悪くなるなら書かない
  check(send(env, { id: identity({ n: 20, hash: HASH_A, fileCount: 7, format: 2, force: true }), user: 'ゲスト' }), 'resent', true);
  check(send(env, { id: identity({ n: 20, hash: HASH_B, fileCount: 7, missingCount: 1, format: 2, force: true }) }), 'same', false);
  const world = env.call('ownedWorlds').worlds[0];
  assert.deepEqual([world.uploadedBy, world.saveStamp], ['ゲスト', stamp(20)]);
  assert.equal(worldCell(env, 'saveKey'), `${world.uploadedAt}|${stamp(20)}|${HASH_A}|2|7|0`);
});

test('owned-gas 結果の種類: どちらかに識別がなければ今の更新日時の比較。今の行に識別があり届いた方にない同じ時刻は same（書かない）、今の行に識別がなければ同じ時刻なら上書き。書いたら saveKey は届いた値か空', () => {
  const env = fixture();
  // 届いた方に識別がない（古い画面）
  const first = send(env, { id: identity({ n: 10 }), time: '2026-10-05T10:00:00.000Z' });
  const key = worldCell(env, 'saveKey');
  const legacyStale = send(env, { time: '2026-10-05T09:00:00.000Z' });
  assert.deepEqual([legacyStale.result, legacyStale.stored], ['stale', false]);
  // 同じ時刻（同期を受け取った PC の古いタブ。プレイヤーの入れ替え後・登録が少ない劣った中身かもしれない）は、誰からでも書かない
  const legacySame = send(env, { rows: rowsOf('x', 1), time: '2026-10-05T10:00:00.000Z', user: 'ゲスト' });
  assert.deepEqual([legacySame.result, legacySame.stored, legacySame.reason], ['same', false, undefined]);
  assert.deepEqual([legacySame.world.saveStamp, legacySame.world.uploadedAt, legacySame.world.uploadedBy], [stamp(10), first.world.uploadedAt, 'ホスト']);
  assert.equal(worldCell(env, 'saveKey'), key);
  assert.deepEqual(env.call('owned', { worldId: WORLD_A }).rows.map((r) => r[0]), ['p0', 'p1']);
  // 新しい時刻なら今どおり書く（識別は空になる）
  const legacyNewer = send(env, { time: '2026-10-05T10:00:01.000Z' });
  assert.deepEqual([legacyNewer.result, legacyNewer.stored, legacyNewer.world.saveStamp], ['newer', true, '']);
  assert.equal(worldCell(env, 'saveKey'), '');
  // 今の行に識別がない（空の saveKey）: 空どうしを同じセーブとは見ない（unchanged にしない）。同じ時刻なら上書き
  const again = send(env, { time: '2026-10-05T10:00:01.000Z' });
  assert.deepEqual([again.result, again.stored], ['newer', true]);
  // 今の行に識別がなく、届いた方にある: 更新日時で比べ（同じ時刻なら上書き）、書いたら届いた識別を残す
  const withId = send(env, { id: identity({ n: 5 }), time: '2026-10-05T10:00:01.000Z' });
  assert.deepEqual([withId.result, withId.stored, withId.world.saveStamp], ['newer', true, stamp(5)]);
  assert.equal(send(env, { id: identity({ n: 99 }), time: '2026-10-05T10:00:00.500Z' }).result, 'newer', '両方に識別があれば保存時刻で比べる');
  // saveKey の列がない（setup() を実行し直す前）: 識別は残せず、更新日時で比べる
  const old = fixture();
  const sheet = worldsSheet(old);
  const at = sheet.data[0].indexOf('saveKey');
  for (const line of sheet.data) line.splice(at, 1);
  const a = send(old, { id: identity({ n: 10 }), time: '2026-10-05T10:00:00.000Z' });
  assert.deepEqual([a.result, a.world.saveStamp], ['new', '']);
  assert.equal(send(old, { id: identity({ n: 10 }), time: '2026-10-05T10:00:00.000Z' }).result, 'newer');
  assert.equal(send(old, { id: identity({ n: 99 }), time: '2026-10-05T09:00:00.000Z' }).result, 'stale');
  // setup() で列を足すと識別を使い始める
  old.gas.setup();
  assert.equal(sheet.data[0][sheet.data[0].length - 1], 'saveKey');
  send(old, { id: identity({ n: 10 }), time: '2026-10-05T10:00:00.000Z' });
  assert.equal(send(old, { id: identity({ n: 10 }), time: '2026-10-05T11:00:00.000Z' }).result, 'unchanged');
  // 形の違う識別（どれかが欠ける・壊れている）は断らず、識別なしとして扱う
  for (const broken of [{ saveStamp: 'abc' }, { ...identity(), contentHash: 'xyz' }, { ...identity(), format: 0 }, { ...identity(), fileCount: -1 }, { ...identity(), missingCount: 1.5 }]) {
    const response = send(old, { id: broken, time: '2026-10-05T12:00:00.000Z' });
    assert.deepEqual([response.ok, response.result, response.world.saveStamp], [true, 'newer', ''], JSON.stringify(broken));
  }
});

test('owned-gas 結果の種類: saveKey の先頭の uploadedAt が行と違えば（古い版の GAS が後から書いた）識別として使わない', () => {
  const env = fixture();
  const first = send(env, { id: identity({ n: 10 }) });
  // 古い版の GAS が uploadedAt だけを書き換えた（知らない列 saveKey は前の値のまま残る）
  const sheet = worldsSheet(env);
  sheet.data[1][sheet.data[0].indexOf('uploadedAt')] = '2026-10-05T10:30:00.000Z';
  assert.ok(worldCell(env, 'saveKey').startsWith(`${first.world.uploadedAt}|`));
  assert.equal(env.call('ownedWorlds').worlds[0].saveStamp, '');
  // 同じ識別でも unchanged にせず、更新日時で比べて書く
  assert.equal(send(env, { id: identity({ n: 10 }) }).result, 'newer');
});

test('owned-gas 読み込み: 行の数が palCount と違えば 1 回だけ読み直し、それでも違えば PARTIAL。palCount 0 は正しい空', () => {
  const env = fixture();
  send(env, { rows: rowsOf('p', 3) });
  // 今の世代の行が 1 つ消えた（直接の編集など）
  env.pals().deleteRows(2, 1);
  env.spreadsheet.journal.length = 0;
  const partial = env.call('owned', { worldId: WORLD_A });
  assert.deepEqual([partial.ok, partial.code], [false, 'PARTIAL']);
  // 一覧と行を 2 回ずつ読んだ（worldId の全部の行には落とさない）
  const reads = env.spreadsheet.journal.filter((entry) => entry.op === 'getValues' && entry.sheet === 'OwnedPals_test');
  assert.equal(reads.length, 2);
  // 0 体の共有は正しい空
  send(env, { rows: [], time: '2026-10-05T11:00:00.000Z' });
  const empty = env.call('owned', { worldId: WORLD_A });
  assert.deepEqual([empty.ok, empty.rows, empty.world.palCount], [true, [], 0]);
});

test('owned-gas 読み込み: 読み手がワールドの行を読んだ後に 2 回の共有があっても、読み直して今の世代を返す', () => {
  const env = fixture();
  send(env, { rows: rowsOf('g1-', 2) });
  let times = 0;
  // 1 回目の所持パルの行の読み（見出しからの全部の行）の直前に、2 回の共有が入る（読み手が持つ世代は ③ で消える）
  env.pals().failNext('getValues', {
    when: (detail) => {
      if (detail.row !== 1 || detail.count < 2 || times) return false;
      times++;
      send(env, { rows: rowsOf('g2-', 2), time: '2026-10-05T11:00:00.000Z' });
      send(env, { rows: rowsOf('g3-', 3), time: '2026-10-05T12:00:00.000Z' });
      return false;
    },
  });
  const owned = env.call('owned', { worldId: WORLD_A });
  assert.equal(times, 1);
  assert.deepEqual(owned.rows.map((r) => r[0]), ['g3-0', 'g3-1', 'g3-2']);
  assert.equal(owned.world.palCount, 3);
  // 古い world を持つ画面の ownedSince も今の世代を返す
  const since = env.call('ownedSince', { worldId: WORLD_A, uploadedAt: '2026-10-05T00:00:00.000Z' });
  assert.deepEqual([since.changed, since.rows.length], [true, 3]);
});

test('owned-gas 失敗: ② の前に落ちた行は公開されず、次の共有の ③ で消える。③ の失敗は共有の成功と分け、同じ要求の再送で掃除される', () => {
  const env = fixture();
  const first = send(env, { rows: rowsOf('a', 2), id: identity({ n: 1 }) });
  // ② の前（ワールドの行の書き込み）で落ちる
  worldsSheet(env).failNext('setValues');
  const failed = send(env, { rows: rowsOf('x', 2), time: '2026-10-05T11:00:00.000Z', id: identity({ n: 2 }) });
  assert.deepEqual([failed.ok, failed.code], [false, 'INTERNAL']);
  assert.deepEqual(env.call('owned', { worldId: WORLD_A }).rows.map((r) => r[0]), ['a0', 'a1']);
  assert.equal(Object.keys(generations(env)).length, 2, '孤児の世代が残っている');
  // 次の共有で、孤児は消える（今と 1 つ前だけ）
  const second = send(env, { rows: rowsOf('b', 2), time: '2026-10-05T12:00:00.000Z', id: identity({ n: 3 }) });
  assert.deepEqual(generations(env), { [first.world.uploadedAt]: 2, [second.world.uploadedAt]: 2 });
  // ③ が失敗しても共有は成功（cleanup: false）。古い世代は残る
  env.pals().failNext('deleteRows');
  const third = send(env, { rows: rowsOf('c', 2), time: '2026-10-05T13:00:00.000Z', id: identity({ n: 4 }) });
  assert.deepEqual([third.stored, third.result, third.cleanup], [true, 'newer', false]);
  assert.equal(Object.keys(generations(env)).length, 3);
  assert.deepEqual(env.call('owned', { worldId: WORLD_A }).rows.map((r) => r[0]), ['c0', 'c1']);
  // 応答を失った画面が同じ要求を送り直す → unchanged（書かない）で、残った世代を消す
  const resend = send(env, { rows: rowsOf('c', 2), time: '2026-10-05T13:00:00.000Z', id: identity({ n: 4 }) });
  assert.deepEqual([resend.stored, resend.result, resend.cleanup], [false, 'unchanged', true]);
  assert.deepEqual(generations(env), { [second.world.uploadedAt]: 2, [third.world.uploadedAt]: 2 });
});

test('owned-gas 削除: 塊ごとの deleteRows で、他のワールドの世代と交錯しても、そのワールドの行だけを消す', () => {
  const env = fixture();
  send(env, { worldId: WORLD_A, rows: rowsOf('a', 2) });
  send(env, { worldId: WORLD_B, rows: rowsOf('b', 2) });
  send(env, { worldId: WORLD_A, rows: rowsOf('c', 2), time: '2026-10-05T11:00:00.000Z' });
  send(env, { worldId: WORLD_B, rows: rowsOf('d', 3), time: '2026-10-05T11:00:00.000Z' });
  env.spreadsheet.journal.length = 0;
  const removed = env.call('ownedDelete', { worldId: WORLD_A });
  assert.deepEqual([removed.deleted, removed.removed], [true, 4]);
  // A の 2 世代は離れた 2 つの塊（下から消す）
  assert.deepEqual(env.spreadsheet.journal.filter((entry) => entry.sheet === 'OwnedPals_test' && entry.op === 'deleteRows').map((entry) => [entry.row, entry.count]), [[6, 2], [2, 2]]);
  assert.deepEqual(generations(env, WORLD_A), {});
  assert.deepEqual(env.call('ownedWorlds').worlds.map((world) => world.worldId), [WORLD_B]);
  assert.deepEqual(env.call('owned', { worldId: WORLD_B }).rows.map((r) => r[0]), ['d0', 'd1', 'd2']);
  // B の次の共有も、今と 1 つ前を残して正しく消す
  const next = send(env, { worldId: WORLD_B, rows: rowsOf('e', 1), time: '2026-10-05T12:00:00.000Z' });
  assert.equal(Object.keys(generations(env, WORLD_B)).length, 2);
  assert.deepEqual(env.call('owned', { worldId: WORLD_B }).rows.map((r) => r[0]), ['e0']);
  assert.equal(next.cleanup, true);
  // 最後のワールドを消す（固定していない行を全部消すことになるときは、先に 1 行足す）
  const only = fixture();
  send(only, { rows: rowsOf('z', 2) });
  only.pals().maxRows = 3;
  assert.equal(only.call('ownedDelete', { worldId: WORLD_A }).removed, 2);
  assert.equal(only.pals().getLastRow(), 1);
  assert.equal(only.call('ownedDelete', { worldId: WORLD_A }).deleted, false);
});

test('owned-gas ownedSince: 変わらない・変わった・ワールドがない・PARTIAL の 4 通り', () => {
  const env = fixture();
  const first = send(env, { rows: rowsOf('a', 2), id: identity({ n: 7 }) });
  const same = env.call('ownedSince', { worldId: WORLD_A, uploadedAt: first.world.uploadedAt });
  assert.deepEqual(same, {
    ok: true, env: 'test', api: 1, changed: false, uploadedAt: first.world.uploadedAt, uploadedBy: 'ホスト', saveUpdatedAt: '2026-10-05T10:00:00.000Z',
    palCount: 2, saveStamp: stamp(7), presence: [], serverTime: same.serverTime,
  });
  const second = send(env, { rows: rowsOf('b', 3), time: '2026-10-05T11:00:00.000Z' });
  const changed = env.call('ownedSince', { worldId: WORLD_A, uploadedAt: first.world.uploadedAt });
  assert.deepEqual([changed.changed, changed.world.uploadedAt, changed.rows.map((r) => r[0]), changed.columns, changed.presence], [true, second.world.uploadedAt, ['b0', 'b1', 'b2'], OWNED_FIELDS, []]);
  // 何も持っていない画面（uploadedAt が空）も中身を受け取る
  assert.equal(env.call('ownedSince', { worldId: WORLD_A }).changed, true);
  const none = env.call('ownedSince', { worldId: WORLD_B, uploadedAt: first.world.uploadedAt });
  assert.deepEqual([none.changed, none.world, none.rows], [true, null, []]);
  env.pals().deleteRows(2 + 2, 1);
  const partial = env.call('ownedSince', { worldId: WORLD_A, uploadedAt: first.world.uploadedAt });
  assert.deepEqual([partial.ok, partial.code], [false, 'PARTIAL']);
  assert.equal(env.call('ownedSince', { worldId: 'XYZ' }).code, 'VALIDATION');
});

const page = (n, extra = {}) => ({ pageId: `page-${String(n).padStart(4, '0')}`, device: `device-${n % 3}`, user: `仲間${n}`, role: 'guest', playing: false, canShare: false, ...extra });

test('owned-gas presence: ページごとのキーと索引に 6 時間残し、ownedSince に相乗りでき、env を分ける。値は検査し、時刻はサーバー', () => {
  const env = fixture();
  const saved = env.call('presence', { worldId: WORLD_A, presence: page(1, { role: 'host', playing: true, canShare: true, at: '2000-01-01T00:00:00.000Z', extra: 'x' }) });
  assert.equal(saved.saved, true);
  assert.deepEqual(saved.presence.map(({ at, ...rest }) => rest), [{ user: '仲間1', device: 'device-1', role: 'host', playing: true, canShare: true }]);
  assert.ok(Date.parse(saved.presence[0].at) > Date.parse('2026-01-01T00:00:00.000Z'), 'at はサーバーの時刻');
  assert.deepEqual(env.cache.puts.map((put) => [put.key, put.seconds]), [
    [`presence:test:${WORLD_A}:page-0001`, 21600], [`presence:test:${WORLD_A}`, 21600],
  ]);
  // ownedSince に相乗り（ワールドが共有されていなくても記録する）
  const since = env.call('ownedSince', { worldId: WORLD_A, uploadedAt: '', presence: page(2) });
  assert.deepEqual(since.presence.map((item) => item.user), ['仲間2', '仲間1']);
  // 本番のパスワードでは本番の一覧（テストの記録は見えない）
  const prod = env.call('presence', { worldId: WORLD_A, presence: page(3) }, PROPS.PASSCODE);
  assert.deepEqual([prod.env, prod.presence.map((item) => item.user)], ['prod', ['仲間3']]);
  assert.deepEqual(env.call('ownedSince', { worldId: WORLD_A }).presence.map((item) => item.user), ['仲間2', '仲間1']);
  // 形の違う値は presence 操作では VALIDATION、ownedSince では記録しないだけ
  for (const broken of [null, page(4, { pageId: 'short' }), page(4, { device: 'a b c d e f g h' }), page(4, { role: 'admin' }), page(4, { playing: 'yes' }), page(4, { user: 3 })]) {
    assert.equal(env.call('presence', { worldId: WORLD_A, presence: broken }).code, 'VALIDATION', JSON.stringify(broken));
  }
  const ignored = env.call('ownedSince', { worldId: WORLD_A, presence: page(5, { role: 'admin' }) });
  assert.deepEqual([ignored.ok, ignored.presence.length], [true, 2]);
  assert.equal(env.call('presence', { worldId: 'XYZ', presence: page(6) }).code, 'VALIDATION');
});

test('owned-gas presence: 索引は短い鍵（0.5 秒）の中で足し、取れなければページのキーだけを書く。上限 50・期限切れの除去', () => {
  const env = fixture();
  env.events.length = 0;
  env.call('presence', { worldId: WORLD_A, presence: page(1) });
  assert.deepEqual(env.events, ['cachePut', 'tryLock', 'cachePut', 'releaseLock']);
  assert.deepEqual(env.lock.waits, [500]);
  // 鍵が取れない（共有の書き込みの最中）: ページのキーは書き、索引には足さない（次の送信で戻る）
  env.lock.available = (ms) => ms !== 500;
  const busy = env.call('presence', { worldId: WORLD_A, presence: page(2) });
  assert.deepEqual([busy.ok, busy.saved, busy.presence.map((item) => item.user)], [true, false, ['仲間1']]);
  assert.ok(env.cache.entries.has(`presence:test:${WORLD_A}:page-0002`));
  env.lock.available = true;
  assert.deepEqual(env.call('presence', { worldId: WORLD_A, presence: page(2) }).presence.map((item) => item.user), ['仲間2', '仲間1']);
  // 6 時間より前の索引の要素とページの値は除く
  const indexKey = `presence:test:${WORLD_A}`;
  const index = JSON.parse(env.cache.entries.get(indexKey));
  const old = Date.now() - 7 * 3600 * 1000;
  env.cache.entries.set(indexKey, JSON.stringify([...index, { id: 'page-old', at: old }]));
  env.cache.entries.set(`presence:test:${WORLD_A}:page-old`, JSON.stringify({ ...page(9), at: new Date(old).toISOString() }));
  assert.equal(env.call('ownedSince', { worldId: WORLD_A }).presence.length, 2);
  env.call('presence', { worldId: WORLD_A, presence: page(3) });
  assert.ok(!JSON.parse(env.cache.entries.get(indexKey)).some((item) => item.id === 'page-old'));
  // 索引に残っていても、ページの値が 6 時間より前なら出さない
  env.cache.entries.set(`presence:test:${WORLD_A}:page-0003`, JSON.stringify({ ...page(3), at: new Date(old).toISOString() }));
  assert.deepEqual(env.call('ownedSince', { worldId: WORLD_A }).presence.map((item) => item.user), ['仲間2', '仲間1']);
  // 1 ワールド 50 件まで（古い方を外す）
  for (let n = 10; n < 70; n++) env.call('presence', { worldId: WORLD_A, presence: page(n) });
  const list = env.call('ownedSince', { worldId: WORLD_A }).presence;
  assert.equal(list.length, 50);
  assert.equal(JSON.parse(env.cache.entries.get(indexKey)).length, 50);
  assert.ok(list.some((item) => item.user === '仲間69'));
});

test('owned-gas presence: キャッシュが失敗しても本体の操作は成功する（一覧は null＝分からない）', () => {
  const env = fixture();
  const first = send(env, { rows: rowsOf('a', 1) });
  for (const op of ['put', 'get', 'getAll']) {
    env.cache.fail.clear();
    env.cache.fail.add(op);
    const since = env.call('ownedSince', { worldId: WORLD_A, uploadedAt: first.world.uploadedAt, presence: page(1) });
    assert.deepEqual([since.ok, since.changed], [true, false], op);
    if (op !== 'put') assert.equal(since.presence, null, op);
    const owned = env.call('ownedSince', { worldId: WORLD_A, uploadedAt: '', presence: page(1) });
    assert.deepEqual([owned.ok, owned.rows.length], [true, 1], op);
  }
  env.cache.fail.clear();
  env.cache.fail.add('put');
  const presence = env.call('presence', { worldId: WORLD_A, presence: page(2) });
  assert.deepEqual([presence.ok, presence.saved], [true, false]);
});

test('owned-gas compactOwned: 指定した環境だけを今の世代にして saveKey を空にし、停止の印の後の書き込みは何も書かずに BUSY', () => {
  const env = fixture();
  for (const passcode of [PROPS.TEST_PASSCODE, PROPS.PASSCODE]) {
    send(env, { rows: rowsOf('a', 2), id: identity({ n: 1 }), passcode });
    send(env, { rows: rowsOf('b', 2), id: identity({ n: 2 }), time: '2026-10-05T11:00:00.000Z', passcode });
  }
  const prodPals = env.spreadsheet.getSheetByName('OwnedPals');
  const prodBefore = JSON.stringify([prodPals.data, worldsSheet(env, 'OwnedWorlds').data]);
  // env の指定がない・違うなら何もしない
  for (const value of [undefined, '', 'PROD', 'all']) assert.throws(() => env.gas.compactOwned(value), /env/);
  assert.deepEqual(Object.keys(env.props.store).filter((key) => key.startsWith('OWNED_PAUSED_')), []);
  const result = env.gas.compactOwnedTest();
  assert.deepEqual([result.env, result.worlds, result.removed, result.paused], ['test', 1, 2, true]);
  assert.equal(Object.keys(generations(env)).length, 1);
  assert.equal(worldCell(env, 'saveKey'), '');
  assert.equal(env.call('ownedWorlds').worlds[0].saveStamp, '');
  // 本番の行・saveKey・停止の印は変わらない
  assert.equal(JSON.stringify([prodPals.data, worldsSheet(env, 'OwnedWorlds').data]), prodBefore);
  assert.ok(env.props.store.OWNED_PAUSED_test);
  assert.equal(env.props.store.OWNED_PAUSED_prod, undefined);
  // 停止の印の後の新しい版の書き込み・削除は何も書かない
  const pals = JSON.stringify(env.pals().data);
  assert.equal(send(env, { rows: rowsOf('c', 2), id: identity({ n: 3 }), time: '2026-10-05T12:00:00.000Z' }).code, 'BUSY');
  assert.equal(env.call('ownedDelete', { worldId: WORLD_A }).code, 'BUSY');
  assert.equal(JSON.stringify(env.pals().data), pals);
  // 読むのは止めない。本番の書き込みも止めない
  assert.deepEqual(env.call('owned', { worldId: WORLD_A }).rows.map((r) => r[0]), ['b0', 'b1']);
  assert.equal(send(env, { rows: rowsOf('p', 1), id: identity({ n: 9 }), time: '2026-10-05T13:00:00.000Z', passcode: PROPS.PASSCODE }).stored, true);
  // resumeOwned で印を消すと書ける。最初の共有は更新日時の比較で動く
  assert.throws(() => env.gas.resumeOwned('x'), /env/);
  env.gas.resumeOwnedTest();
  assert.equal(env.props.store.OWNED_PAUSED_test, undefined);
  assert.equal(send(env, { rows: rowsOf('c', 2), id: identity({ n: 2 }), time: '2026-10-05T12:00:00.000Z' }).result, 'newer');
});
