import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isObject, int, intOrNull, intIn, bool, text, idText, internalName, oneOf, isoTime, list, worldId, screenHref, cleanSaved,
  cleanRecords, cleanUsers, cleanSnapshot, cleanOwnedWorlds, cleanOwnedPayload, cleanPresenceList,
} from '../../web/js/core/boundary.js';
import { OWNED_FIELDS, OWNED_MAX_ROWS, OWNED_DPS_GAP_MAX } from '../../web/js/core/owned-shared.js';

const WORLD = 'ABCDEF0123456789ABCDEF0123456789';

test('境界: int は有限の整数にして範囲に収め、数にならなければ既定の値にする', () => {
  const talent = { min: 0, max: 100 };
  assert.deepEqual(['150', '-5', 'Infinity', 'abc', '', '  ', null, undefined, NaN, Infinity, 12.7, '12', '12.7', 0, '0', true, {}, []].map((value) => int(value, talent)),
    [100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 12, 12, 12, 0, 0, 0, 0, 0]);
  assert.equal(int('abc', { min: 1, max: 999, fallback: 1 }), 1);
  assert.equal(int(0, { min: 1, max: 999, fallback: 1 }), 1);
  assert.equal(int(-3.9), -3);
  assert.equal(int(5000), 5000);
});

test('境界: intIn は範囲の中の整数だけをそのまま使い、範囲の外・数でない値は丸めずに既定の値にする。bool は真偽値だけ', () => {
  const talent = { min: 0, max: 100, fallback: 7 };
  assert.deepEqual([0, 100, 55, 150, -1, 12.5, '12', null, undefined, NaN, Infinity, true].map((value) => intIn(value, talent)),
    [0, 100, 55, 7, 7, 7, 7, 7, 7, 7, 7, 7]);
  assert.equal(intIn(3), 3);
  assert.deepEqual([true, false, 'true', 1, null].map((value) => bool(value, true)), [true, false, true, true, true]);
  assert.equal(bool(undefined, false), false);
});

test('境界: intOrNull は欠けている値（undefined・null・空文字）と 0 を区別する', () => {
  assert.deepEqual([undefined, null, '', 0, '0', '7', 'abc', 150].map((value) => intOrNull(value, { min: 0, max: 100 })), [null, null, null, 0, 0, 7, null, 100]);
  // 壊れた値の既定は null（不明）。fallback を渡せば変えられる
  assert.equal(intOrNull('abc', { fallback: 0 }), 0);
});

test('境界: text は文字列だけを受け取り、制御文字を除いて切り詰める。idText は切り詰めずに長さを確かめる', () => {
  assert.equal(text('ab\u0000c\u007f', 10), 'abc');
  assert.equal(text(' あいうえお ', 3), 'あいう');
  assert.equal(text(123, 10), '');
  assert.equal(text(null, 10, '既定'), '既定');
  assert.equal(text({ toString: () => 'x' }, 10), '');
  assert.equal(idText('a'.repeat(64)), 'a'.repeat(64));
  assert.deepEqual([idText('a'.repeat(65)), idText(''), idText(5), idText('abc', 2)], ['', '', '', '']);
});

test('境界: internalName はゲームの内部名の形（英数字と _ の 1〜64 字）だけを通す。マスターに無い名前も形が合えば通す', () => {
  assert.deepEqual(['Rare', 'CraftSpeed_up2', 'Unknown_Passive_X', 'a'.repeat(64)].map((value) => internalName(value)), ['Rare', 'CraftSpeed_up2', 'Unknown_Passive_X', 'a'.repeat(64)]);
  assert.deepEqual(['', 'a'.repeat(65), '知らないパッシブ', 'Rare,Legend', 'Rare Legend', 'a"b', 'a\nb', 7, null, ['Rare']].map((value) => internalName(value)), Array(10).fill(''));
  assert.equal(internalName('abcd', 3), '');
});

test('境界: oneOf・isoTime・worldId・screenHref', () => {
  assert.equal(oneOf('M', ['M', 'F', ''], ''), 'M');
  assert.equal(oneOf('X', ['M', 'F', ''], ''), '');
  assert.equal(isoTime('2026-10-12T00:00:00.000Z'), '2026-10-12T00:00:00.000Z');
  assert.equal(isoTime('2026-10-12'), '2026-10-12');
  assert.deepEqual([isoTime('いつか'), isoTime(1760000000000), isoTime(null)], ['', '', '']);
  assert.equal(worldId(WORLD.toLowerCase()), WORLD);
  assert.deepEqual([worldId('W1'), worldId(`${WORLD}0`), worldId(null)], ['', '', '']);
  assert.equal(screenHref('#/list'), '#/list');
  assert.deepEqual([screenHref('https://example.com/'), screenHref('javascript:alert(1)'), screenHref(`#/${'a'.repeat(299)}`), screenHref(3)], ['', '', '', '']);
  assert.equal(screenHref(`#/${'a'.repeat(298)}`).length, 300);
  assert.equal(isObject([]), false);
  assert.equal(isObject(null), false);
  assert.equal(isObject({}), true);
});

test('境界: list は配列でなければ空にし、件数の上限・捨てる要素・先勝ちの重複を扱う', () => {
  assert.deepEqual(list('abc'), []);
  assert.deepEqual(list({ length: 2 }), []);
  assert.deepEqual(list([1, null, 2, undefined, 3]), [1, 2, 3]);
  assert.deepEqual(list([1, 2, 3, 4], { max: 2 }), [1, 2]);
  // 上限は残した要素の数で数える（捨てた要素は数えない）
  assert.deepEqual(list([null, 1, null, 2, 3], { max: 2 }), [1, 2]);
  assert.deepEqual(list(['a', 'b', 'c'], { map: (value) => (value === 'b' ? null : value.toUpperCase()) }), ['A', 'C']);
  const items = [{ id: 'x', n: 1 }, { id: 'y', n: 2 }, { id: 'x', n: 3 }];
  assert.deepEqual(list(items, { key: (item) => item.id }), [{ id: 'x', n: 1 }, { id: 'y', n: 2 }]);
});

test('境界: cleanSaved は合わない項目だけを既定の値に戻し、schema にない項目は残さない', () => {
  const schema = {
    sort: (value) => oneOf(value, ['dex', 'level'], 'dex'),
    query: (value) => text(value, 100),
    top: (value) => int(value, { min: 0 }),
    acquiredAt: (value) => intOrNull(value, { min: 0 }),
  };
  assert.deepEqual(cleanSaved({ sort: 'level', query: '  モコロン ', top: '120', acquiredAt: 0, extra: true }, schema),
    { sort: 'level', query: 'モコロン', top: 120, acquiredAt: 0 });
  assert.deepEqual(cleanSaved({ sort: 'unknown', query: 7, top: -5 }, schema), { sort: 'dex', query: '', top: 0, acquiredAt: null });
  for (const broken of [null, 'text', [], 3]) assert.deepEqual(cleanSaved(broken, schema), { sort: 'dex', query: '', top: 0, acquiredAt: null });
});

test('配合の記録: 正しい記録はそのまま、壊れた要素・id のない記録・同じ id の後の記録を捨てる', () => {
  const good = {
    id: 'r1', parent1Id: 'SheepBall', parent2Id: 'PinkCat', childId: 'CuteFox', parent1Gender: 'M', parent2Gender: '',
    registrant: '登録者', memo: 'メモ', confirmCount: 2, createdAt: '2026-10-05T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z', etag: 'e1',
  };
  // 欠けている項目は足さず、知らない項目（deleted など）は残す
  const partial = { id: 'r2', parent1Id: 'A', parent2Id: 'B', childId: 'C', deleted: false };
  assert.deepEqual(cleanRecords([good, partial]), [good, partial]);
  const cleaned = cleanRecords([
    null, 'r', [], { parent1Id: 'A' }, { id: '' }, { id: 5 }, { id: 'x'.repeat(65) },
    good, { ...good, memo: '後の重複' },
    // マスターにない ID も捨てない（新しいパルの登録を古い画面で消さない）
    { id: 'r3', parent1Id: 'NewPal_2027', parent2Id: 7, childId: 'y'.repeat(80), parent1Gender: 'X', registrant: 'z'.repeat(40), memo: 'm'.repeat(250), confirmCount: 'abc', createdAt: 'いつか' },
  ]);
  assert.deepEqual(cleaned.map((record) => record.id), ['r1', 'r3']);
  assert.equal(cleaned[0].memo, 'メモ');
  assert.deepEqual(cleaned[1], {
    id: 'r3', parent1Id: 'NewPal_2027', parent2Id: '', childId: 'y'.repeat(64), parent1Gender: '', registrant: 'z'.repeat(30), memo: 'm'.repeat(200), confirmCount: 0, createdAt: '',
  });
  assert.deepEqual(cleanRecords({ records: [] }), []);
});

test('配合の記録: ユーザーと警告と全件の整え直し', () => {
  assert.deepEqual(cleanUsers(['自分', '', 3, null, '自分', '仲間', 'x'.repeat(65)]), ['自分', '仲間']);
  assert.equal(cleanUsers(Array.from({ length: 1200 }, (_, i) => `u${i}`)).length, 1000);
  const snapshot = { records: [null, { id: 'a', parent1Id: 'A', parent2Id: 'B', childId: 'C' }], warnings: [{ code: 'DUPLICATE_ID' }, 'x', null], users: ['自分'], serverTime: '2026-10-12T00:00:00.000Z', env: 'test' };
  assert.deepEqual(cleanSnapshot(snapshot), {
    records: [{ id: 'a', parent1Id: 'A', parent2Id: 'B', childId: 'C' }], warnings: [{ code: 'DUPLICATE_ID' }], users: ['自分'], serverTime: '2026-10-12T00:00:00.000Z', env: 'test',
  });
  assert.equal(cleanSnapshot({ ...snapshot, warnings: Array.from({ length: 1500 }, () => ({})) }).warnings.length, 1000);
});

const sharedWorld = (overrides = {}) => ({
  worldId: WORLD, worldName: 'World9', hostName: 'Alice', saveUpdatedAt: '2026-10-05T10:00:00.000Z', uploadedAt: '2026-10-05T10:01:00.000Z', uploadedBy: 'ホスト',
  palCount: 3, players: [{ uid: 'u1', name: 'Alice', level: 52, online: true }], bases: [{ id: 'b1', label: '拠点 1' }], farms: [{ id: 'F1', baseId: 'b1', parents: ['p1', 'p2'] }],
  inGameDay: 123,
  ...overrides,
});

test('所持パルの共有: 正しいワールドの行はそのまま、worldId が不正なもの・重複を捨て、項目の長さと件数を限る', () => {
  assert.deepEqual(cleanOwnedWorlds([sharedWorld()]), [sharedWorld()]);
  const lower = sharedWorld({ worldId: WORLD.toLowerCase(), worldName: 'x'.repeat(150), hostName: 7, uploadedAt: 'いつか', palCount: '-3' });
  const [cleaned] = cleanOwnedWorlds([null, sharedWorld({ worldId: 'W1' }), lower, sharedWorld({ worldName: '後の重複' })]);
  assert.deepEqual([cleaned.worldId, cleaned.worldName.length, cleaned.hostName, cleaned.uploadedAt, cleaned.palCount], [WORLD, 100, '', '', 0]);
  assert.equal(cleanOwnedWorlds([null, sharedWorld({ worldId: 'W1' }), lower, sharedWorld()]).length, 1);
  // プレイヤー 100 人・拠点 200 か所まで。uid・id が空のもの、40 字を超えるものは捨てる
  const many = cleanOwnedWorlds([sharedWorld({
    players: [{ uid: '', name: 'x' }, { uid: 'u'.repeat(41) }, 'u', ...Array.from({ length: 150 }, (_, i) => ({ uid: `u${i}`, name: 'n'.repeat(60) }))],
    bases: Array.from({ length: 250 }, (_, i) => ({ id: `b${i}`, label: 'l'.repeat(70) })),
  })])[0];
  assert.deepEqual([many.players.length, many.players[0], many.bases.length, many.bases[0].label.length], [100, { uid: 'u0', name: 'n'.repeat(50) }, 200, 60]);
  // 牧場を共有する前のデータ（farms がない）は null のまま。「牧場なし」の [] と区別する
  assert.equal(cleanOwnedWorlds([sharedWorld({ farms: undefined })])[0].farms, null);
  assert.equal(cleanOwnedWorlds([sharedWorld({ farms: 'F1' })])[0].farms, null);
  assert.deepEqual(cleanOwnedWorlds([sharedWorld({ farms: [] })])[0].farms, []);
  // save-extras: ゲーム内の日数（後から足した列）と、プレイヤーの Lv・プレイ中（players の JSON の中）。古い共有（ない）・壊れた値は
  // 日数が null、Lv・プレイ中は鍵ごと付けない（画面は「分からない」）
  for (const day of [undefined, null, 0, -3, 1.5, '12', 2000000]) assert.equal(cleanOwnedWorlds([sharedWorld({ inGameDay: day })])[0].inGameDay, null);
  const players = cleanOwnedWorlds([sharedWorld({ players: [
    { uid: 'u1', name: 'Alice' }, { uid: 'u2', name: 'Bob', level: '40', online: 'yes' }, { uid: 'u3', name: 'Carol', level: 0, online: false },
    { uid: 'u4', name: 'Dave', level: 1000, online: null }, { uid: 'u5', name: 'Erin', level: 12.5, online: true },
  ] })])[0].players;
  assert.deepEqual(players, [{ uid: 'u1', name: 'Alice' }, { uid: 'u2', name: 'Bob' }, { uid: 'u3', name: 'Carol', online: false }, { uid: 'u4', name: 'Dave' }, { uid: 'u5', name: 'Erin', online: true }]);
  assert.equal(cleanOwnedWorlds(Array.from({ length: 250 }, (_, i) => sharedWorld({ worldId: i.toString(16).toUpperCase().padStart(32, '0') }))).length, 200);
  assert.deepEqual(cleanOwnedWorlds('worlds'), []);
});

test('所持パルの共有（owned-gas）: セーブの中の保存時刻（saveStamp）は文字列で届けば整えて写し（形が違えば空）、届かなければ付けない。ページを開いている PC の一覧', () => {
  assert.equal(cleanOwnedWorlds([sharedWorld({ saveStamp: '0638650000000000001' })])[0].saveStamp, '638650000000000001');
  for (const value of ['', 'abc', '0', '1'.repeat(21)]) assert.equal(cleanOwnedWorlds([sharedWorld({ saveStamp: value })])[0].saveStamp, '', value);
  // 古い GAS・前のキャッシュ（項目がない）・文字列でない値は、今と同じ形（鍵ごと付けない）
  for (const value of [undefined, null, 638650000000000]) assert.equal('saveStamp' in cleanOwnedWorlds([sharedWorld({ saveStamp: value })])[0], false, String(value));
  assert.equal(cleanOwnedPayload({ world: sharedWorld({ saveStamp: '12' }), columns: OWNED_FIELDS, rows: [] }).world.saveStamp, '12');
  const item = { user: '仲間', device: 'device-01', role: 'guest', playing: false, canShare: true, at: '2026-10-05T10:00:00.000Z' };
  assert.deepEqual(cleanPresenceList([item, { ...item, user: 'x'.repeat(30), role: 'owner', playing: 1 }, { ...item, device: 'short' }, { ...item, at: '' }, null]), [
    item, { ...item, user: 'x'.repeat(20), role: 'none', playing: false },
  ]);
  assert.equal(cleanPresenceList(Array.from({ length: 60 }, () => item)).length, 50);
  assert.equal(cleanPresenceList(null), null);
  assert.equal(cleanPresenceList({}), null);
});

test('所持パルの共有（server）: GAS が列 extras から広げた追加の情報は、分かることがあれば GAS と同じ決まった形で写し、なければ付けない（API の応答とキャッシュの復元で同じ）', () => {
  const H = '00000000-0000-0000-0000-000000000001';
  const extras = { saveKind: 'server', clock: '638650000000000005', formers: [{ uid: H, pals: 3, farms: 2 }], items: null };
  const [world] = cleanOwnedWorlds([sharedWorld(extras)]);
  assert.deepEqual(world, sharedWorld(extras));
  assert.deepEqual(cleanOwnedPayload({ world: sharedWorld(extras), columns: OWNED_FIELDS, rows: [] }).world, sharedWorld(extras));
  // 形の違う値は整える（知らない鍵は落とし、分からない項目は '' と null）
  const [broken] = cleanOwnedWorlds([sharedWorld({ saveKind: 'cloud', clock: 'x', formers: [{ uid: H, pals: '3', farms: 2 }, { uid: H, pals: 1, farms: 0, kind: 'host' }], formersPartial: 1 })]);
  assert.deepEqual([broken.saveKind, broken.clock, broken.formers, 'formersPartial' in broken, broken.items], ['', '', [{ uid: H, pals: 1, farms: 0 }], false, null]);
  // 列のない GAS・古い GAS の応答・前のキャッシュ（分かることがない）は今と同じ形
  for (const value of [{}, { saveKind: '', formers: null, items: 'x' }]) {
    const [plain] = cleanOwnedWorlds([sharedWorld(value)]);
    assert.deepEqual(['saveKind', 'clock', 'formers', 'formersPartial', 'items'].filter((key) => key in plain), [], JSON.stringify(value));
  }
});

test('所持パルの共有（dps-missing）:プレイヤーのパル次元ストレージの読み漏れの数（dpsGap）は 1〜上限の整数だけ写す。API の応答とキャッシュの復元で同じ', () => {
  const players = [
    { uid: 'u1', name: 'Alice', dpsGap: 27 }, { uid: 'u2', name: 'Bob', dpsGap: 0 }, { uid: 'u3', name: 'Carol', dpsGap: '27' },
    { uid: 'u4', name: 'Dave', dpsGap: 2.5 }, { uid: 'u5', name: 'Erin', dpsGap: OWNED_DPS_GAP_MAX + 1 }, { uid: 'u6', name: 'Frank', dpsGap: OWNED_DPS_GAP_MAX },
  ];
  const expected = [{ uid: 'u1', name: 'Alice', dpsGap: 27 }, { uid: 'u2', name: 'Bob' }, { uid: 'u3', name: 'Carol' }, { uid: 'u4', name: 'Dave' }, { uid: 'u5', name: 'Erin' }, { uid: 'u6', name: 'Frank', dpsGap: OWNED_DPS_GAP_MAX }];
  assert.deepEqual(cleanOwnedWorlds([sharedWorld({ players })])[0].players, expected);
  assert.deepEqual(cleanOwnedPayload({ world: sharedWorld({ players }), columns: OWNED_FIELDS, rows: [] }).world.players, expected);
});

test('所持パルの共有（server の share-extras）: プレイヤーの捕獲数（captures）と牧場のケーキ（c）は GAS と同じ検査で写す（壊れた値は付けない）。API の応答とキャッシュの復元で同じ', () => {
  const players = [
    { uid: 'u1', name: 'Alice', captures: { SheepBall: 12, 'bad id': 3 } }, { uid: 'u2', name: 'Bob', captures: {} },
    { uid: 'u3', name: 'Carol', captures: 'x' }, { uid: 'u4', name: 'Dave', captures: { SheepBall: 0 } },
  ];
  const farms = [
    { id: 'F1', baseId: 'b1', parents: ['p1', 'p2'], n: 0, c: [{ i: 'Cake02', n: 51 }, { i: 'bad id', n: 1 }] },
    { id: 'F2', baseId: 'b1', parents: [], n: 0, c: [] },
    { id: 'F3', baseId: 'b1', parents: [], n: 0, c: [{ i: 'Cake02', n: -1 }] },
  ];
  const expectedPlayers = [{ uid: 'u1', name: 'Alice', captures: { SheepBall: 12 } }, { uid: 'u2', name: 'Bob', captures: {} }, { uid: 'u3', name: 'Carol' }, { uid: 'u4', name: 'Dave' }];
  const expectedFarms = [{ ...farms[0], c: [{ i: 'Cake02', n: 51 }] }, farms[1], { id: 'F3', baseId: 'b1', parents: [], n: 0 }];
  for (const world of [cleanOwnedWorlds([sharedWorld({ players, farms })])[0], cleanOwnedPayload({ world: sharedWorld({ players, farms }), columns: OWNED_FIELDS, rows: [] }).world]) {
    assert.deepEqual([world.players, world.farms], [expectedPlayers, expectedFarms]);
  }
});

test('所持パルの共有: 1 ワールドの行を列の幅にそろえ、壊れた行と重複を捨て、セルの長さと行数を限る', () => {
  const row = (id, extra = {}) => OWNED_FIELDS.map((field) => (field === 'instanceId' ? id : extra[field] ?? ''));
  const payload = { world: sharedWorld(), columns: OWNED_FIELDS, rows: [row('p1', { palId: 'SheepBall' }), row('p2')] };
  assert.deepEqual(cleanOwnedPayload(payload), payload);
  const at = (field) => OWNED_FIELDS.indexOf(field);
  const cleaned = cleanOwnedPayload({
    world: sharedWorld(), columns: OWNED_FIELDS,
    rows: [null, 'p', row(''), row('p1', { nickname: 'n'.repeat(300), skillIds: 's'.repeat(1200), level: 12 }), row('p1'), row('p3').slice(0, 5), [...row('p4'), 'extra'], [{}, ...row('p5').slice(1)]],
  });
  assert.deepEqual(cleaned.rows.map((cells) => cells[0]), ['p1', 'p3', 'p4']);
  assert.ok(cleaned.rows.every((cells) => cells.length === OWNED_FIELDS.length));
  assert.deepEqual([cleaned.rows[0][at('nickname')].length, cleaned.rows[0][at('skillIds')].length, cleaned.rows[0][at('level')]], [200, 1000, '12']);
  // 列の位置は変えない（文字列でない列名は、どの項目にも使わない ''）
  const columns = cleanOwnedPayload({ world: null, columns: ['instanceId', 5, 'palId'], rows: [['p1', 'x', 'SheepBall']] });
  assert.deepEqual(columns, { world: null, columns: ['instanceId', '', 'palId'], rows: [['p1', 'x', 'SheepBall']] });
  // 行は OWNED_MAX_ROWS まで。world が不正ならデータなし（null）
  const big = cleanOwnedPayload({ world: sharedWorld({ worldId: 'bad' }), columns: ['instanceId'], rows: Array.from({ length: OWNED_MAX_ROWS + 1 }, (_, i) => [`p${i}`]) });
  assert.deepEqual([big.world, big.rows.length], [null, OWNED_MAX_ROWS]);
  for (const broken of [null, [], { columns: 'x', rows: [] }, { columns: [], rows: 'x' }]) assert.equal(cleanOwnedPayload(broken), null);
});
