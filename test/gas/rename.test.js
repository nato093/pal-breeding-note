import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createGas, FakeSpreadsheet } from './harness.js';

const PROPS = { PASSCODE: '本番の設定 !', TEST_PASSCODE: '試験用の設定 !' };
const plain = (value) => JSON.parse(JSON.stringify(value));
const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const WORLD = '0123456789ABCDEF0123456789ABCDEF';
const TIME = '2026-10-03T00:00:00.000Z';
const record = (n, overrides = {}) => ({
  id: uuid(n), parent1Id: 'FlowerDoll', parent2Id: 'GuardianDog', childId: 'MoonQueen',
  parent1Gender: ['M', 'F', 'M', 'F', ''][n % 5], parent2Gender: ['F', 'F', 'M', 'M', ''][n % 5],
  registrant: 'Taro', memo: '', confirmCount: 1, createdAt: TIME, updatedAt: TIME, deletedAt: '', ...overrides,
});

function fixture(options = {}) {
  const env = createGas({ properties: PROPS, spreadsheet: new FakeSpreadsheet({ stripQuotes: true }), ...options });
  env.gas.setup();
  env.call = (action, input = {}, passcode = PROPS.TEST_PASSCODE) => plain(env.gas.handleRequest_(JSON.stringify({
    action, passcode, ...(['signup', 'rename'].includes(action) ? { opId: crypto.randomUUID() } : {}), ...input,
  })));
  env.sheet = (name) => env.spreadsheet.getSheetByName(name);
  env.seedRecords = (records) => {
    const headers = plain(env.gas.BREEDING_HEADERS_);
    env.sheet('Breedings_test').data = [headers, ...records.map((item) => headers.map((field) => item[field] ?? ''))];
  };
  env.seedWorlds = (rows) => {
    const headers = plain(env.gas.OWNED_WORLD_HEADERS_);
    env.sheet('OwnedWorlds_test').data = [headers, ...rows.map((item) => headers.map((field) => item[field] ?? ''))];
  };
  env.logRows = () => env.sheet('Log_test').data.slice(1).filter((line) => line.some((value) => value !== ''));
  env.events.length = 0;
  return env;
}

function registrants(env) {
  const [headers, ...rows] = env.sheet('Breedings_test').data;
  return rows.map((line) => line[headers.indexOf('registrant')]);
}

test('名前の変更: Users・登録者名（削除済み・表記ゆれを含む）・共有者名をそろえ、Log に開始と完了を残す', () => {
  const env = fixture();
  env.call('signup', { userId: 'Taro' });
  env.call('signup', { userId: '花子' });
  env.seedRecords([
    record(1), record(2, { registrant: 'ＴＡＲＯ', memo: "'=1+1" }), record(3, { registrant: '花子' }),
    record(4, { registrant: 'taro', deletedAt: TIME }), record(5, { registrant: 'Taro2' }),
  ]);
  env.seedWorlds([{ worldId: WORLD, uploadedBy: 'taro', palCount: '0', players: '[]', bases: '[]' }]);
  const opId = crypto.randomUUID();
  const result = env.call('rename', { opId, userId: 'Taro', newUserId: 'Jiro' });
  assert.equal(result.ok, true);
  assert.equal(result.userId, 'Jiro');
  assert.deepEqual(result.users, ['Jiro', '花子']);
  assert.deepEqual(result.records.map((item) => item.registrant), ['Jiro', 'Jiro', '花子', 'Taro2']);
  assert.deepEqual(registrants(env), ['Jiro', 'Jiro', '花子', 'Jiro', 'Taro2']);
  assert.ok(result.records.every((item) => item.updatedAt === TIME));
  // 対象外のセル（数式除けの引用符付きのメモ）は書き直さない
  const [headers, , second] = env.sheet('Breedings_test').data;
  assert.equal(second[headers.indexOf('memo')], "'=1+1");
  assert.equal(env.call('ownedWorlds').worlds[0].uploadedBy, 'Jiro');
  assert.equal(env.call('login', { userId: 'Taro' }).code, 'USER_NOT_FOUND');
  assert.equal(env.call('login', { userId: 'jiro' }).userId, 'Jiro');
  const logs = env.logRows();
  assert.deepEqual(logs.map((line) => [line[1], line[2]]), [['rename', opId], ['renamed', opId]]);
  assert.deepEqual(JSON.parse(logs[1][4]), { userId: 'Jiro', records: 3 });
  assert.equal(env.sheet('Breedings_test').log.filter((entry) => entry.op === 'getRangeList').length, 1);
});

test('名前の変更: 古い etag の更新は CONFLICT になり、新しい名前の最新版を返す', () => {
  const env = fixture();
  env.call('signup', { userId: 'Taro' });
  env.seedRecords([record(1), record(2)]);
  const before = env.call('snapshot').records;
  env.call('rename', { userId: 'Taro', newUserId: 'Jiro' });
  const update = env.call('update', { opId: crypto.randomUUID(), id: uuid(1), expectedEtag: before[0].etag, record: { memo: 'x' } });
  assert.equal(update.code, 'CONFLICT');
  assert.equal(update.latest.registrant, 'Jiro');
  assert.equal(env.call('delete', { opId: crypto.randomUUID(), id: uuid(2), expectedEtag: before[1].etag }).code, 'CONFLICT');
  const merge = env.call('merge', {
    opId: crypto.randomUUID(), sourceId: uuid(1), targetId: uuid(2), expectedEtags: { source: before[0].etag, target: before[1].etag },
  });
  assert.equal(merge.code, 'CONFLICT');
});

test('名前の変更: 他の人の名前・同じ名前・未登録・不正な入力は断り、何も書かない', () => {
  const env = fixture();
  env.call('signup', { userId: 'Taro' });
  env.call('signup', { userId: 'Hanako' });
  env.seedRecords([record(1)]);
  const state = () => JSON.stringify(['Users_test', 'Breedings_test', 'Log_test'].map((name) => env.sheet(name).data));
  const before = state();
  for (const [input, expected] of [
    [{ userId: 'Taro', newUserId: 'ｈａｎａｋｏ' }, { ok: false, code: 'USER_EXISTS' }],
    [{ userId: 'Taro', newUserId: 'Taro' }, { ok: false, code: 'VALIDATION', errors: [{ field: 'newUserId', code: 'SAME_ID' }] }],
    [{ userId: '未登録', newUserId: '新しい名前' }, { ok: false, code: 'USER_NOT_FOUND' }],
    [{ userId: 'Taro', newUserId: '' }, { ok: false, code: 'VALIDATION', errors: [{ field: 'newUserId', code: 'REQUIRED' }] }],
    [{ userId: 'Taro', newUserId: 'あ'.repeat(21) }, { ok: false, code: 'VALIDATION', errors: [{ field: 'newUserId', code: 'TOO_LONG' }] }],
    [{ userId: '', newUserId: 'Jiro' }, { ok: false, code: 'VALIDATION', errors: [{ field: 'userId', code: 'REQUIRED' }] }],
    [{ userId: 'Taro', newUserId: 'Jiro', extra: 1 }, { ok: false, code: 'VALIDATION', errors: [{ field: 'extra', code: 'UNKNOWN_FIELD' }] }],
    [{ userId: 'Taro', newUserId: 'Jiro', opId: 'x' }, { ok: false, code: 'VALIDATION', errors: [{ field: 'opId', code: 'INVALID_UUID' }] }],
  ]) {
    assert.deepEqual(env.call('rename', input), expected);
    assert.equal(state(), before);
  }
  assert.deepEqual(env.call('rename', { userId: 'Taro', newUserId: 'Jiro' }, '不正'), { ok: false, code: 'AUTH' });
});

test('名前の変更: 大小だけの変更は表記を置き換える', () => {
  const env = fixture();
  env.call('signup', { userId: 'taro' });
  env.seedRecords([record(1, { registrant: 'TARO' })]);
  const result = env.call('rename', { userId: 'taro', newUserId: 'Taro' });
  assert.equal(result.userId, 'Taro');
  assert.deepEqual(result.users, ['Taro']);
  assert.deepEqual(registrants(env), ['Taro']);
});

test('名前の変更: 同じ opId の再送は、キャッシュが消えても旧名が再登録されても完了済みとして返す', () => {
  const env = fixture();
  env.call('signup', { userId: 'Taro' });
  env.seedRecords([record(1)]);
  const opId = crypto.randomUUID();
  assert.equal(env.call('rename', { opId, userId: 'Taro', newUserId: 'Jiro' }).userId, 'Jiro');
  assert.equal(env.call('rename', { opId, userId: 'Taro', newUserId: 'Jiro' }).userId, 'Jiro');
  env.cache.remove(`op:test:${opId}`);
  env.call('signup', { userId: 'Taro' });
  env.seedRecords([record(1, { registrant: 'Jiro' }), record(2, { registrant: 'Taro' })]);
  const retried = env.call('rename', { opId, userId: 'Taro', newUserId: 'Jiro' });
  assert.equal(retried.userId, 'Jiro');
  assert.deepEqual(retried.users, ['Jiro', 'Taro']);
  assert.deepEqual(registrants(env), ['Jiro', 'Taro']);
  assert.equal(env.logRows().length, 2);
});

test('名前の変更: 途中で止まっても、同じ opId で続きから行える（開始の記録は重ねない）', () => {
  const env = fixture();
  env.call('signup', { userId: 'Taro' });
  env.seedRecords([record(1)]);
  env.seedWorlds([{ worldId: WORLD, uploadedBy: 'Taro', palCount: '0', players: '[]', bases: '[]' }]);
  const opId = crypto.randomUUID();
  const write = env.gas.writeCells_;
  let calls = 0;
  // 配合を書き換えた後、共有者名を書き換える前に止まったことにする
  env.gas.writeCells_ = (...args) => {
    if (++calls === 2) throw new Error('中断');
    return write(...args);
  };
  assert.equal(env.call('rename', { opId, userId: 'Taro', newUserId: 'Jiro' }).code, 'INTERNAL');
  assert.deepEqual(registrants(env), ['Jiro']);
  assert.deepEqual(env.call('snapshot').users, ['Taro']);
  env.gas.writeCells_ = write;
  const resumed = env.call('rename', { opId, userId: 'Taro', newUserId: 'Jiro' });
  assert.equal(resumed.userId, 'Jiro');
  assert.deepEqual(resumed.users, ['Jiro']);
  assert.equal(env.call('ownedWorlds').worlds[0].uploadedBy, 'Jiro');
  assert.deepEqual(env.logRows().map((line) => line[1]), ['rename', 'renamed']);
});

test('名前の変更: Users まで書き換えて止まっても、完了の記録を残して返す', () => {
  const env = fixture();
  env.call('signup', { userId: 'Taro' });
  const opId = crypto.randomUUID();
  const append = env.gas.appendRecordLog_;
  env.gas.appendRecordLog_ = (...args) => {
    if (args[2] === 'renamed') throw new Error('中断');
    return append(...args);
  };
  assert.equal(env.call('rename', { opId, userId: 'Taro', newUserId: 'Jiro' }).code, 'INTERNAL');
  assert.deepEqual(env.call('snapshot').users, ['Jiro']);
  env.gas.appendRecordLog_ = append;
  assert.equal(env.call('rename', { opId, userId: 'Taro', newUserId: 'Jiro' }).userId, 'Jiro');
  assert.deepEqual(env.logRows().map((line) => line[1]), ['rename', 'renamed']);
});

for (const prefix of ['=', '+', '-', '@', "'"]) {
  test(`名前の変更: ${prefix} 始まりの名前は quoteForSheet を通して書く`, () => {
    const env = fixture();
    env.call('signup', { userId: 'Taro' });
    env.seedRecords([record(1)]);
    const userId = `${prefix}名前`;
    const result = env.call('rename', { userId: 'Taro', newUserId: userId });
    assert.equal(result.userId, userId);
    assert.deepEqual(result.users, [userId]);
    assert.equal(result.records[0].registrant, userId);
    const [headers, line] = env.sheet('Breedings_test').data;
    assert.equal(line[headers.indexOf('registrant')], `'${userId}`);
    assert.equal(env.sheet('Users_test').data[1][0], `'${userId}`);
  });
}

test('名前の変更: 対象の行がなくても書き込みを呼ばずに終わり、ロックの中で行う', () => {
  const env = fixture();
  env.call('signup', { userId: 'Taro' });
  env.events.length = 0;
  assert.equal(env.call('rename', { userId: 'Taro', newUserId: 'Jiro' }).userId, 'Jiro');
  assert.equal(env.events[0], 'tryLock');
  assert.equal(env.events.at(-1), 'releaseLock');
  assert.equal(env.sheet('Breedings_test').log.some((entry) => entry.op === 'getRangeList'), false);
  const busy = fixture({ lockAvailable: false });
  assert.equal(busy.call('rename', { userId: 'Taro', newUserId: 'Jiro' }).code, 'BUSY');
});
