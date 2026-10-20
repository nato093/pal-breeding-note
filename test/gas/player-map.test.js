// プレイヤーの対応（gas/PlayerMap.js。server の mapping）。シート PlayerMap・PlayerMap_test と操作 playerMap・playerMapSet
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createGas, FakeSpreadsheet } from './harness.js';
import { legacyGasFiles, LEGACY_V12_COMMIT } from './legacy.js';
import { createDevelopmentApi } from '../../dev/mock-api.js';
import { PLAYER_MAP_SET_MAX, PLAYER_MAP_WORLD_MAX } from '../../web/js/core/owned-shared.js';

const PROPS = { PASSCODE: 'AAAA-BBBB-CCCC-DDDD', TEST_PASSCODE: 'EEEE-FFFF-GGGG-HHHH' };
const plain = (value) => JSON.parse(JSON.stringify(value));
const WORLD_A = 'ABCDEF0123456789ABCDEF0123456789';
const WORLD_B = 'FEDCBA9876543210FEDCBA9876543210';
const HEADERS = ['worldId', 'key', 'userId', 'playerName', 'updatedBy', 'updatedAt'];
// ダミーのキャラクターの InstanceId と鍵。H は協力プレイのホストの UID（以前のホスト）
const iid = (n) => `11111111-2222-4333-8444-${String(n).padStart(12, '0')}`;
const key = (n) => `i:${iid(n)}`;
const H_KEY = 'u:00000000-0000-0000-0000-000000000001';

function fixture(options = {}) {
  const env = createGas({ properties: PROPS, spreadsheet: new FakeSpreadsheet({ stripQuotes: true }), ...options });
  env.gas.setup();
  env.call = (action, fields = {}, passcode = PROPS.TEST_PASSCODE) => plain(env.gas.handleRequest_(JSON.stringify({ action, passcode, ...fields })));
  env.signup = (ids, passcode = PROPS.TEST_PASSCODE) => ids.forEach((userId) => env.call('signup', { userId, opId: crypto.randomUUID() }, passcode));
  env.set = (entries, extra = {}, passcode) => env.call('playerMapSet', { userId: 'Bob', worldId: WORLD_A, entries, ...extra }, passcode);
  env.read = (worldId = WORLD_A, passcode) => env.call('playerMap', { worldId }, passcode);
  env.sheet = (name = 'PlayerMap_test') => env.spreadsheet.getSheetByName(name);
  env.rows = (name) => env.sheet(name).data.slice(1).filter((line) => line.some((value) => value !== ''));
  env.events.length = 0;
  return env;
}

// 応答の対応から、時刻を除いた形（鍵・ID・名前・書いた人）
const shape = (entries) => entries.map(({ key: k, userId, playerName, updatedBy }) => [k, userId, playerName, updatedBy]);

test('対応（setup）: 本番とテストの PlayerMap を見出しつき・書式なしテキストで作り、2 回実行しても行と列を変えない', () => {
  const env = fixture();
  for (const name of ['PlayerMap', 'PlayerMap_test']) {
    const sheet = env.sheet(name);
    assert.deepEqual(sheet.data[0], HEADERS, name);
    assert.equal(sheet.frozenRows, 1);
    assert.equal(sheet.protections.length, 1);
    assert.ok(sheet.formats.length && sheet.formats.every((format) => format.fmt === '@'));
  }
  env.signup(['Taro']);
  env.set([{ key: key(1), userId: 'Taro', playerName: 'Alice' }]);
  const before = JSON.stringify(['PlayerMap', 'PlayerMap_test'].map((name) => env.sheet(name).data));
  env.gas.setup();
  assert.equal(JSON.stringify(['PlayerMap', 'PlayerMap_test'].map((name) => env.sheet(name).data)), before);
  assert.equal(env.read().entries[0].userId, 'Taro');
});

test('対応: 書いて読める。鍵とワールド ID の大文字小文字をそろえ、ほかのワールド・本番とテストは混ざらない', () => {
  const env = fixture();
  env.signup(['Taro']);
  env.signup(['Hanako'], PROPS.PASSCODE);
  const empty = env.read();
  assert.deepEqual([empty.ok, empty.env, empty.worldId, empty.entries], [true, 'test', WORLD_A, []]);
  const stored = env.call('playerMapSet', {
    userId: 'Bob', worldId: WORLD_A.toLowerCase(), entries: [{ key: `I:${iid(1).toUpperCase()}`, userId: 'Taro', playerName: 'Alice' }],
  });
  assert.equal(stored.ok, true);
  assert.deepEqual([stored.worldId, stored.changed, stored.skipped], [WORLD_A, 1, 0]);
  assert.deepEqual(stored.entries, [{ key: key(1), userId: 'Taro', playerName: 'Alice', updatedBy: 'Bob', updatedAt: stored.serverTime }]);
  assert.match(stored.serverTime, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  assert.deepEqual(env.rows('PlayerMap_test'), [[WORLD_A, key(1), 'Taro', 'Alice', 'Bob', stored.serverTime]]);
  assert.deepEqual(env.read().entries, stored.entries);
  assert.deepEqual(env.read(WORLD_A.toLowerCase()).entries, stored.entries);
  assert.deepEqual(env.read(WORLD_B).entries, []);
  // 本番は別のシート（テストの対応は見えず、本番に書いてもテストは変わらない）
  assert.deepEqual(env.read(WORLD_A, PROPS.PASSCODE).entries, []);
  const prod = env.set([{ key: key(1), userId: 'hanako' }], {}, PROPS.PASSCODE);
  assert.deepEqual([prod.env, shape(prod.entries)], ['prod', [[key(1), 'Hanako', '', 'Bob']]]);
  assert.deepEqual(env.rows('PlayerMap').map((line) => line[2]), ['Hanako']);
  assert.deepEqual(shape(env.read().entries), [[key(1), 'Taro', 'Alice', 'Bob']]);
});

test('対応: ノートの ID は Users の表記で保存する（ＴＡＲＯ → Taro）。書いた人の ID は送られたまま', () => {
  const env = fixture();
  env.signup(['Taro']);
  const stored = env.call('playerMapSet', { userId: 'ｂｏｂ', worldId: WORLD_A, entries: [{ key: key(1), userId: 'ＴＡＲＯ' }] });
  assert.deepEqual(shape(stored.entries), [[key(1), 'Taro', '', 'ｂｏｂ']]);
});

test('対応: 数式として読まれる ID・名前は引用符を付けて書き、文字のまま読む', () => {
  const env = fixture();
  env.signup(['=Taro']);
  const stored = env.call('playerMapSet', {
    userId: '+Bob', worldId: WORLD_A, entries: [{ key: key(1), userId: '=Taro', playerName: '=HYPERLINK("x")' }],
  });
  assert.deepEqual(shape(stored.entries), [[key(1), '=Taro', '=HYPERLINK("x")', '+Bob']]);
  const [line] = env.rows('PlayerMap_test');
  assert.deepEqual(line.slice(2, 5), ["'=Taro", `'=HYPERLINK("x")`, "'+Bob"]);
  assert.deepEqual(shape(env.read().entries), shape(stored.entries));
});

test('対応: 検査で断ったときは何も書かない（形は鍵の外で、ノートにない ID は鍵の中で Users を読んでから）', () => {
  const env = fixture();
  env.signup(['Taro']);
  env.set([{ key: key(1), userId: 'Taro' }]);
  const state = () => JSON.stringify(env.sheet().data);
  const before = state();
  const many = Array.from({ length: PLAYER_MAP_SET_MAX + 1 }, (_, i) => ({ key: key(i + 10), userId: '' }));
  const cases = [
    [{ extra: 1 }, [{ field: 'extra', code: 'UNKNOWN_FIELD' }]],
    [{ worldId: 'W1' }, [{ field: 'worldId', code: 'INVALID_WORLD' }]],
    [{ userId: undefined }, [{ field: 'userId', code: 'REQUIRED' }]],
    [{ userId: 'あ'.repeat(21) }, [{ field: 'userId', code: 'TOO_LONG' }]],
    [{ onlyMissing: 'yes' }, [{ field: 'onlyMissing', code: 'INVALID_TYPE' }]],
    [{ entries: [] }, [{ field: 'entries', code: 'INVALID_ENTRIES' }]],
    [{ entries: 'x' }, [{ field: 'entries', code: 'INVALID_ENTRIES' }]],
    [{ entries: many }, [{ field: 'entries', code: 'TOO_MANY' }]],
    [{ entries: [null] }, [{ field: 'entries.0', code: 'INVALID_ENTRY' }]],
    [{ entries: [{ key: key(2), userId: 'Taro', updatedBy: 'x' }] }, [{ field: 'entries.0.updatedBy', code: 'UNKNOWN_FIELD' }]],
    // プレフィックスのない UID（前の版の形）・形の違う鍵
    [{ entries: [{ key: iid(2), userId: 'Taro' }, { key: 'i:abc', userId: 'Taro' }] }, [
      { field: 'entries.0.key', code: 'INVALID_KEY' }, { field: 'entries.1.key', code: 'INVALID_KEY' },
    ]],
    [{ entries: [{ key: key(2) }] }, [{ field: 'entries.0.userId', code: 'REQUIRED' }]],
    [{ entries: [{ key: key(2), userId: 'あ'.repeat(21) }] }, [{ field: 'entries.0.userId', code: 'TOO_LONG' }]],
    [{ entries: [{ key: key(2), userId: 'Taro', playerName: 5 }] }, [{ field: 'entries.0.playerName', code: 'INVALID_TYPE' }]],
  ];
  for (const [fields, errors] of cases) {
    env.events.length = 0;
    const result = env.call('playerMapSet', { userId: 'Bob', worldId: WORLD_A, entries: [{ key: key(2), userId: 'Taro' }], ...fields });
    assert.deepEqual(result, { ok: false, env: 'test', code: 'VALIDATION', errors }, JSON.stringify(fields));
    assert.equal(env.events.includes('tryLock'), false, JSON.stringify(fields));
    assert.equal(state(), before);
  }
  // ノートにない ID は 1 件でもあれば、ほかの件も書かない
  env.events.length = 0;
  const unknown = env.set([{ key: key(2), userId: 'Taro' }, { key: key(3), userId: '未登録' }]);
  assert.deepEqual(unknown, { ok: false, env: 'test', code: 'VALIDATION', errors: [{ field: 'entries.1.userId', code: 'USER_NOT_FOUND' }] });
  assert.deepEqual([env.events[0], env.events.at(-1)], ['tryLock', 'releaseLock']);
  assert.equal(state(), before);
  assert.deepEqual(env.call('playerMap', { worldId: 'x' }), { ok: false, env: 'test', code: 'VALIDATION', errors: [{ field: 'worldId', code: 'INVALID_WORLD' }] });
});

test('対応: 上書き・外した印（墓標）・onlyMissing（外した印もあるとみなす）と changed・skipped。同じ内容の送り直しは書かない', () => {
  const env = fixture();
  env.signup(['Taro', 'Hanako']);
  const first = env.set([{ key: key(1), userId: 'Taro' }, { key: key(2), userId: 'Taro' }]);
  assert.deepEqual([first.changed, first.skipped], [2, 0]);
  // 上書きは同じ行を書き換える（行は増えない）
  const over = env.set([{ key: key(1), userId: 'Hanako', playerName: 'Alice' }]);
  assert.deepEqual([over.changed, over.skipped, env.rows('PlayerMap_test').length], [1, 0, 2]);
  // 同じ内容は書かない（書いた時刻も変えない）
  const writes = env.sheet().log.filter((entry) => entry.op === 'setValues').length;
  const same = env.call('playerMapSet', { userId: 'Carol', worldId: WORLD_A, entries: [{ key: key(1), userId: 'hanako', playerName: 'Alice' }] });
  assert.deepEqual([same.changed, same.skipped], [0, 1]);
  assert.equal(env.sheet().log.filter((entry) => entry.op === 'setValues').length, writes);
  assert.deepEqual(same.entries.find((entry) => entry.key === key(1)), over.entries.find((entry) => entry.key === key(1)));
  // 外した対応は行を消さずに userId '' の印にする
  const cleared = env.set([{ key: key(2), userId: '' }]);
  assert.deepEqual(shape(cleared.entries), [[key(1), 'Hanako', 'Alice', 'Bob'], [key(2), '', '', 'Bob']]);
  assert.equal(env.rows('PlayerMap_test').length, 2);
  // onlyMissing: ある鍵（外した印を含む）は書かず、ない鍵だけ足す
  const migrated = env.set([{ key: key(2), userId: 'Taro' }, { key: key(3), userId: 'Taro' }, { key: H_KEY, userId: 'Hanako' }], { onlyMissing: true });
  assert.deepEqual([migrated.changed, migrated.skipped], [2, 1]);
  assert.deepEqual(shape(env.read().entries), [
    [key(1), 'Hanako', 'Alice', 'Bob'], [key(2), '', '', 'Bob'], [key(3), 'Taro', '', 'Bob'], [H_KEY, 'Hanako', '', 'Bob'],
  ]);
  assert.equal(env.rows('PlayerMap_test').length, 4);
});

test('対応: 1 回の中の同じ鍵は後の方を使う', () => {
  const env = fixture();
  env.signup(['Taro', 'Hanako']);
  const stored = env.set([{ key: key(1), userId: 'Taro' }, { key: key(2), userId: 'Taro' }, { key: key(1).toUpperCase(), userId: 'Hanako' }]);
  assert.deepEqual([stored.changed, shape(stored.entries)], [2, [[key(2), 'Taro', '', 'Bob'], [key(1), 'Hanako', '', 'Bob']]]);
  assert.equal(env.rows('PlayerMap_test').length, 2);
});

test('対応: 同じ鍵の行が重複していたら（所有者が手で足した）、読むのも書き換えるのも最後の行。形の違う行は使わない', () => {
  const env = fixture();
  env.signup(['Taro', 'Hanako']);
  const at = '2026-10-18T00:00:00.000Z';
  env.sheet().seed([
    HEADERS,
    [WORLD_A, key(1), 'Taro', 'Alice', 'Bob', at],
    [WORLD_A.toLowerCase(), key(1).toUpperCase(), 'Hanako', 'Alice', 'Carol', at],
    [WORLD_B, key(1), 'Taro', '', 'Bob', at],
    [WORLD_A, 'not-a-key', 'Taro', '', 'Bob', at],
    [WORLD_A, key(2), 'あ'.repeat(21), '', 'Bob', at],
  ]);
  assert.deepEqual(shape(env.read().entries), [[key(1), 'Hanako', 'Alice', 'Carol']]);
  const stored = env.set([{ key: key(1), userId: 'Taro', playerName: 'Alice' }]);
  assert.deepEqual(shape(stored.entries), [[key(1), 'Taro', 'Alice', 'Bob']]);
  const lines = env.sheet().data;
  assert.deepEqual([lines[1][2], lines[2][2], lines[3][2]], ['Taro', 'Taro', 'Taro']);
  assert.deepEqual(lines[2].slice(4), ['Bob', stored.serverTime]);
  assert.deepEqual(lines[1].slice(4), ['Bob', at]);
  // 形の違う行の鍵（key(2) の ID が長すぎる）は、ない鍵として末尾に足す
  env.set([{ key: key(2), userId: 'Hanako' }]);
  assert.deepEqual(env.sheet().data.slice(1).map((line) => line[1]).at(-1), key(2));
  assert.deepEqual(shape(env.read().entries).map((entry) => entry.slice(0, 2)), [[key(1), 'Taro'], [key(2), 'Hanako']]);
});

test('対応: 鍵を増やして 1 ワールド 200 を超える書き込みは、何も書かずに TOO_MANY。今ある鍵の書き換えと、ほかのワールドへの書き込みはできる', () => {
  const env = fixture();
  env.signup(['Taro']);
  const keys = Array.from({ length: PLAYER_MAP_WORLD_MAX + 1 }, (_, i) => key(i + 1));
  for (let start = 0; start < PLAYER_MAP_WORLD_MAX - 1; start += PLAYER_MAP_SET_MAX) {
    const batch = keys.slice(start, Math.min(start + PLAYER_MAP_SET_MAX, PLAYER_MAP_WORLD_MAX - 1)).map((k) => ({ key: k, userId: '' }));
    assert.equal(env.set(batch).ok, true);
  }
  assert.equal(env.read().entries.length, PLAYER_MAP_WORLD_MAX - 1);
  const before = JSON.stringify(env.sheet().data);
  // 2 つ足すと 201（1 つ目も書かない）
  const over = env.set([{ key: keys[PLAYER_MAP_WORLD_MAX - 1], userId: 'Taro' }, { key: keys[PLAYER_MAP_WORLD_MAX], userId: 'Taro' }]);
  assert.deepEqual(over, { ok: false, env: 'test', code: 'VALIDATION', errors: [{ field: 'worldId', code: 'TOO_MANY' }] });
  assert.equal(JSON.stringify(env.sheet().data), before);
  assert.equal(env.set([{ key: keys[PLAYER_MAP_WORLD_MAX - 1], userId: 'Taro' }]).changed, 1);
  assert.equal(env.read().entries.length, PLAYER_MAP_WORLD_MAX);
  assert.equal(env.set([{ key: keys[PLAYER_MAP_WORLD_MAX], userId: 'Taro' }]).errors[0].code, 'TOO_MANY');
  assert.equal(env.set([{ key: keys[0], userId: 'Taro' }]).changed, 1);
  assert.equal(env.set([{ key: keys[PLAYER_MAP_WORLD_MAX], userId: 'Taro' }], { worldId: WORLD_B }).changed, 1);
});

test('対応: 本文の上限（16KB）に 50 件（20 字の ID・50 字の名前。JSON で倍になる文字）が入る', () => {
  const env = fixture();
  const userId = '"'.repeat(20);
  env.signup([userId]);
  const entries = Array.from({ length: PLAYER_MAP_SET_MAX }, (_, i) => ({ key: key(i + 1), userId, playerName: '\\'.repeat(50) }));
  const body = JSON.stringify({ action: 'playerMapSet', passcode: PROPS.TEST_PASSCODE, userId, worldId: WORLD_A, entries });
  assert.ok(body.length <= env.gas.MAX_BODY_CHARS, String(body.length));
  const stored = plain(env.gas.handleRequest_(body));
  assert.deepEqual([stored.ok, stored.changed, stored.entries[0].playerName], [true, PLAYER_MAP_SET_MAX, '\\'.repeat(50)]);
});

test('対応: 書き込みは鍵の中で行い、flush してから解放する。鍵が取れなければ BUSY で何も書かない。読むときは鍵を取らない', () => {
  const env = fixture();
  env.signup(['Taro']);
  env.events.length = 0;
  env.set([{ key: key(1), userId: 'Taro' }]);
  assert.equal(env.events[0], 'tryLock');
  assert.deepEqual(env.events.slice(-2), ['flush', 'releaseLock']);
  env.events.length = 0;
  env.read();
  assert.equal(env.events.includes('tryLock'), false);
  const busy = fixture({ lockAvailable: false });
  assert.deepEqual(busy.set([{ key: key(1), userId: '' }]), { ok: false, env: 'test', code: 'BUSY' });
  assert.deepEqual(busy.rows('PlayerMap_test'), []);
});

test('対応: シートがない（GAS を更新して setup() を実行する前）なら playerMap・playerMapSet は SHEET_HEADER。ほかの操作は動き、setup() の後は使える', () => {
  const env = fixture();
  env.signup(['Taro']);
  env.spreadsheet.deleteSheet(env.sheet());
  assert.deepEqual(env.read(), { ok: false, env: 'test', code: 'SHEET_HEADER' });
  assert.deepEqual(env.set([{ key: key(1), userId: 'Taro' }]), { ok: false, env: 'test', code: 'SHEET_HEADER' });
  assert.equal(env.call('ownedWorlds').ok, true);
  assert.deepEqual(env.call('snapshot').users, ['Taro']);
  // 見出しが壊れていても SHEET_HEADER（書かない）
  env.gas.setup();
  env.sheet().data[0][2] = 'user';
  assert.deepEqual(env.set([{ key: key(1), userId: 'Taro' }]), { ok: false, env: 'test', code: 'SHEET_HEADER' });
  env.sheet().data[0][2] = 'userId';
  assert.equal(env.set([{ key: key(1), userId: 'Taro' }]).changed, 1);
});

test('対応: 開発用 API（dev/mock-api.js）は GAS と同じ規則で同じ応答を返す（時刻を除く）', async () => {
  const env = fixture();
  const mock = createDevelopmentApi({ passcode: PROPS.TEST_PASSCODE });
  const both = async (action, fields) => {
    const gas = env.call(action, fields);
    const local = await mock({ action, passcode: PROPS.TEST_PASSCODE, ...fields });
    const strip = (result) => {
      const { serverTime: _time, api: _api, ...rest } = result;
      return rest.entries ? { ...rest, entries: rest.entries.map(({ updatedAt: _at, ...entry }) => entry) } : rest;
    };
    assert.deepEqual(strip(local), strip(gas), `${action} ${JSON.stringify(fields)}`);
    return gas;
  };
  for (const userId of ['Taro', 'Hanako']) await both('signup', { userId, opId: crypto.randomUUID() });
  const set = (entries, extra = {}) => both('playerMapSet', { userId: 'Bob', worldId: WORLD_A, entries, ...extra });
  await set([{ key: key(1), userId: 'ｔａｒｏ', playerName: 'Alice' }, { key: key(2), userId: 'Hanako' }]);
  await set([{ key: key(1), userId: 'Taro', playerName: 'Alice' }]);
  await set([{ key: key(2), userId: '' }, { key: H_KEY, userId: 'Taro' }]);
  await set([{ key: key(2), userId: 'Taro' }, { key: key(3), userId: 'Hanako' }], { onlyMissing: true });
  await set([{ key: key(4), userId: '未登録' }]);
  await set([{ key: 'u:', userId: 'Taro' }, { key: key(5), userId: 'Taro', extra: 1 }]);
  await both('playerMap', { worldId: WORLD_A.toLowerCase() });
  await both('playerMap', { worldId: WORLD_B });
  // ID の変更で対応の ID と書いた人の ID も書き換える
  await set([{ key: key(6), userId: 'Hanako' }], { userId: 'taro' });
  await both('rename', { opId: crypto.randomUUID(), userId: 'Taro', newUserId: 'Jiro' });
  const renamed = await both('playerMap', { worldId: WORLD_A });
  assert.deepEqual(shape(renamed.entries), [
    [key(1), 'Jiro', 'Alice', 'Bob'], [key(2), '', '', 'Bob'], [H_KEY, 'Jiro', '', 'Bob'], [key(3), 'Hanako', '', 'Bob'], [key(6), 'Hanako', '', 'Jiro'],
  ]);
});

const oldV12Files = legacyGasFiles(LEGACY_V12_COMMIT);

test('対応: 古い GAS（版 12）に送ると BAD_ACTION（画面は前の localStorage の対応に落とす）', { skip: oldV12Files ? false : `Git の履歴に ${LEGACY_V12_COMMIT} がない（浅い複製）` }, () => {
  const old = createGas({ properties: PROPS, files: oldV12Files });
  old.gas.setup();
  const call = (action, fields) => plain(old.gas.handleRequest_(JSON.stringify({ action, passcode: PROPS.TEST_PASSCODE, ...fields })));
  assert.deepEqual(call('playerMap', { worldId: WORLD_A }), { ok: false, code: 'BAD_ACTION' });
  assert.deepEqual(call('playerMapSet', { userId: 'Bob', worldId: WORLD_A, entries: [{ key: key(1), userId: '' }] }), { ok: false, code: 'BAD_ACTION' });
  // 版 12 の setup() は PlayerMap を作らない（版 13 の setup() を実行し直すまでシートはない）
  assert.equal(old.spreadsheet.getSheetByName('PlayerMap_test'), null);
});
