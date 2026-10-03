import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createGas } from './harness.js';

const PROPS = { PASSCODE: 'AAAA-BBBB-CCCC-DDDD', TEST_PASSCODE: 'EEEE-FFFF-GGGG-HHHH' };
const plain = (value) => JSON.parse(JSON.stringify(value));
const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const input = (overrides = {}) => ({
  parent1Id: 'FlowerDoll', parent2Id: 'GuardianDog', childId: 'MoonQueen',
  parent1Gender: 'M', parent2Gender: 'F', registrant: '登録者', memo: '記録', ...overrides,
});
const stored = (overrides = {}) => ({
  id: uuid(1), ...input(), confirmCount: 1,
  createdAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z', deletedAt: '',
  ...overrides,
});

function fixture(options = {}) {
  const env = createGas({ properties: PROPS, ...options });
  env.gas.setup();
  env.events.length = 0;
  env.sheet = env.spreadsheet.getSheetByName('Breedings_test');
  env.logSheet = env.spreadsheet.getSheetByName('Log_test');
  let nextOp = 100;
  env.call = (action, fields = {}, passcode = PROPS.TEST_PASSCODE) => plain(env.gas.handleRequest_(JSON.stringify({
    action, passcode, ...(action === 'snapshot' ? {} : { opId: uuid(nextOp++) }), ...fields,
  })));
  env.create = (id = uuid(1), overrides = {}, fields = {}) => env.call('create', {
    record: { id, ...input(overrides) }, ...fields,
  });
  env.snapshot = () => env.call('snapshot');
  env.seed = (records, headers = plain(env.gas.BREEDING_HEADERS_)) => {
    env.sheet.data = [headers, ...records.map((record) => headers.map((field) => record[field] ?? ''))];
  };
  return env;
}

function assertFailureUnchanged(env, action, fields, code) {
  const before = JSON.stringify([env.sheet.data, env.logSheet.data]);
  const cachePuts = env.cache.puts.length;
  const result = env.call(action, fields);
  assert.equal(result.ok, false);
  assert.equal(result.code, code);
  assert.equal(JSON.stringify([env.sheet.data, env.logSheet.data]), before);
  assert.equal(env.cache.puts.length, cachePuts);
  return result;
}

test('登録: 親と性別を正規化し、表示名・初期値・最新 snapshot を返す', () => {
  const env = fixture();
  const result = env.create(uuid(1), {
    parent1Id: 'GuardianDog', parent2Id: 'FlowerDoll', parent1Gender: 'F', parent2Gender: 'M',
  });
  assert.equal(result.ok, true);
  assert.equal(result.env, 'test');
  assert.equal(result.api, 1);
  assert.equal(result.record.parent1Id, 'FlowerDoll');
  assert.equal(result.record.parent1Gender, 'M');
  assert.equal(result.record.parent2Gender, 'F');
  assert.equal(result.record.confirmCount, 1);
  assert.equal(result.record.createdAt, result.record.updatedAt);
  assert.match(result.record.createdAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  assert.match(result.record.etag, /^[A-Za-z0-9_-]{16}$/);
  assert.deepEqual(result.snapshot.records, [result.record]);
  assert.deepEqual(result.snapshot.warnings, []);
  assert.match(result.snapshot.serverTime, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  assert.deepEqual(Object.keys(result.record).sort(), [
    'id', 'parent1Id', 'parent2Id', 'childId', 'parent1Gender', 'parent2Gender',
    'registrant', 'memo', 'confirmCount', 'createdAt', 'updatedAt', 'etag',
  ].sort());
  const h = env.sheet.data[0];
  for (const [field, palId] of [['parent1Name', 'FlowerDoll'], ['parent2Name', 'GuardianDog'], ['childName', 'MoonQueen']]) {
    assert.equal(env.sheet.data[1][h.indexOf(field)], env.gas.PAL_MASTER_[palId]);
  }
});

test('登録: 同じ ID・正規化後の同じ内容は新しい opId でも冪等に成功する', () => {
  const env = fixture();
  const first = env.create();
  const second = env.create(uuid(1), {
    parent1Id: 'GuardianDog', parent2Id: 'FlowerDoll', parent1Gender: 'F', parent2Gender: 'M',
  });
  assert.equal(second.idempotent, true);
  assert.deepEqual(second.record, first.record);
  assert.equal(env.sheet.getLastRow(), 2);
  assert.equal(env.logSheet.getLastRow(), 2);
});

for (const [field, value] of Object.entries({
  parent1Id: 'SheepBall', parent2Id: 'SheepBall', childId: 'SheepBall',
  parent1Gender: 'F', parent2Gender: 'M', registrant: '別の人', memo: '別の記録',
})) {
  test(`登録: 同じ ID の ${field} が異なると ID_CONFLICT`, () => {
    const env = fixture();
    env.create();
    assertFailureUnchanged(env, 'create', { record: { id: uuid(1), ...input({ [field]: value }) } }, 'ID_CONFLICT');
  });
}

test('登録: 削除済みの ID も同じ内容なら成功し、違う内容なら ID_CONFLICT', () => {
  const env = fixture();
  const first = env.create();
  const deleted = env.call('delete', { id: uuid(1), expectedEtag: first.record.etag });
  const repeated = env.create();
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.record.etag, deleted.record.etag);
  assert.deepEqual(repeated.snapshot.records, []);
  assertFailureUnchanged(env, 'create', { record: { id: uuid(1), ...input({ memo: '変更' }) } }, 'ID_CONFLICT');
});

test('登録: 同一配合は性別・メモの違いにかかわらず DUPLICATE', () => {
  const env = fixture();
  const first = env.create();
  const result = assertFailureUnchanged(env, 'create', {
    record: { id: uuid(2), ...input({ parent1Gender: '', memo: '別の記録' }) }, allowDifferentChild: true,
  }, 'DUPLICATE');
  assert.deepEqual(result.existing, first.record);
});

test('登録: 同ペア・別の子は PAIR_CONFLICT、明示許可と新しい opId で登録できる', () => {
  const env = fixture();
  const first = env.create();
  const record = { id: uuid(2), ...input({ childId: 'SheepBall' }) };
  const opId = uuid(501);
  const result = assertFailureUnchanged(env, 'create', { record, opId }, 'PAIR_CONFLICT');
  assert.deepEqual(result.existing, [first.record]);
  assert.equal(env.cache.get(`op:test:${opId}`), null);
  assert.equal(env.call('create', { record, opId: uuid(502), allowDifferentChild: true }).ok, true);
  assert.equal(env.snapshot().records.length, 2);
});

test('冪等性: 失敗した同じ opId も許可付きで再試行できる', () => {
  const env = fixture();
  env.create();
  const fields = { opId: uuid(501), record: { id: uuid(2), ...input({ childId: 'SheepBall' }) } };
  assert.equal(env.call('create', fields).code, 'PAIR_CONFLICT');
  assert.equal(env.call('create', { ...fields, allowDifferentChild: true }).ok, true);
});

function prepareOperation(env, action) {
  if (action === 'create') return { record: { id: uuid(1), ...input() } };
  const first = env.create().record;
  if (action === 'confirm') return { id: first.id };
  if (action === 'update') return { id: first.id, expectedEtag: first.etag, record: input({ memo: '更新済み' }) };
  if (action === 'delete') return { id: first.id, expectedEtag: first.etag };
  if (action === 'restore') {
    const deleted = env.call('delete', { id: first.id, expectedEtag: first.etag }).record;
    return { id: first.id, expectedEtag: deleted.etag };
  }
  const source = env.create(uuid(2), { parent1Id: 'MoonQueen', parent2Id: 'SheepBall', childId: 'FlowerDoll' }).record;
  return { sourceId: source.id, targetId: first.id, expectedEtags: { source: source.etag, target: first.etag } };
}

for (const action of ['create', 'confirm', 'update', 'merge', 'delete', 'restore']) {
  test(`冪等性: ${action} の同じ opId は変更・Log を一回だけ反映する`, () => {
    const env = fixture();
    const fields = { ...prepareOperation(env, action), opId: uuid(999) };
    const beforeLogs = env.logSheet.getLastRow();
    const first = env.call(action, fields);
    assert.equal(first.ok, true);
    const after = JSON.stringify([env.sheet.data, env.logSheet.data]);
    const cachePuts = env.cache.puts.length;
    const second = env.call(action, fields);
    assert.equal(second.ok, true);
    assert.deepEqual(second.record, first.record);
    assert.equal(JSON.stringify([env.sheet.data, env.logSheet.data]), after);
    assert.equal(env.logSheet.getLastRow(), beforeLogs + 1);
    assert.equal(env.cache.puts.length, cachePuts);
    assert.deepEqual(env.cache.puts.at(-1), { key: `op:test:${fields.opId}`, seconds: 21600 });
    assert.equal('snapshot' in JSON.parse(env.cache.get(`op:test:${fields.opId}`)), false);
    assert.equal(env.cache.get(`op:test:${fields.opId}`).includes(PROPS.TEST_PASSCODE), false);
  });

  test(`基盤: ${action} はロック内で書き込み、flush の後に releaseLock する`, () => {
    const env = fixture();
    const fields = prepareOperation(env, action);
    env.events.length = 0;
    const writes = [];
    for (const sheet of [env.sheet, env.logSheet]) {
      const original = sheet.setCell.bind(sheet);
      sheet.setCell = (...args) => { writes.push(env.events.slice()); original(...args); };
    }
    assert.equal(env.call(action, fields).ok, true);
    assert.equal(env.events[0], 'tryLock');
    assert.deepEqual(env.events.slice(-2), ['flush', 'releaseLock']);
    assert.ok(writes.length > 0);
    assert.ok(writes.every((events) => events[0] === 'tryLock' && !events.includes('releaseLock')));
    assert.ok(env.events.indexOf('flush') < env.events.indexOf('cachePut'));
  });

  test(`基盤: ${action} はロックを取得できなければ BUSY で何も変更しない`, () => {
    const env = fixture();
    const fields = prepareOperation(env, action);
    env.gas.LockService.getScriptLock = () => ({
      tryLock: () => false,
      releaseLock: () => assert.fail('未取得のロックを解放している'),
    });
    assertFailureUnchanged(env, action, fields, 'BUSY');
  });

  test(`入力検証: ${action} は欠落・不正な opId を拒否する`, () => {
    const env = fixture();
    const fields = prepareOperation(env, action);
    for (const opId of [undefined, '', 'invalid', 1, {}, '00000000-0000-0000-0000-00000000000g']) {
      assertFailureUnchanged(env, action, { ...fields, opId }, 'VALIDATION');
    }
  });
}

test('冪等性: 保存した結果を返しつつ snapshot は最新の状態にする', () => {
  const env = fixture();
  const first = env.create(uuid(1), {}, { opId: uuid(901) });
  const confirmed = env.call('confirm', { id: uuid(1) });
  const repeated = env.create(uuid(1), {}, { opId: uuid(901) });
  assert.deepEqual(repeated.record, first.record);
  assert.deepEqual(repeated.snapshot.records, [confirmed.record]);
});

test('冪等性: opId の英字の大文字小文字で二重加算しない', () => {
  const env = fixture();
  env.create();
  const opId = 'abcdefab-abcd-abcd-abcd-abcdefabcdef';
  assert.equal(env.call('confirm', { id: uuid(1), opId }).record.confirmCount, 2);
  assert.equal(env.call('confirm', { id: uuid(1), opId: opId.toUpperCase() }).record.confirmCount, 2);
});

test('環境分離: テストの書き込みは本番に入らず、キャッシュと Log も環境ごとに分かれる', () => {
  const env = fixture();
  const fields = { record: { id: uuid(1), ...input() }, opId: uuid(801) };
  assert.equal(env.call('create', fields).env, 'test');
  const prod = env.spreadsheet.getSheetByName('Breedings');
  const prodLog = env.spreadsheet.getSheetByName('Log');
  assert.equal(prod.getLastRow(), 1);
  assert.equal(prodLog.getLastRow(), 1);
  // 本物のサービスには接続せず、偽シート上だけで本番側のルーティングを検査する。
  const production = env.call('create', fields, PROPS.PASSCODE);
  assert.equal(production.env, 'prod');
  assert.equal(prod.getLastRow(), 2);
  assert.equal(prodLog.getLastRow(), 2);
  assert.ok(env.cache.get(`op:prod:${fields.opId}`));
  assert.ok(env.cache.get(`op:test:${fields.opId}`));
  assert.equal(env.call('confirm', { id: uuid(1) }).record.confirmCount, 2);
  assert.equal(env.call('snapshot', {}, PROPS.PASSCODE).records[0].confirmCount, 1);
});

test('確認: etag を要求せずに回数を加算し、削除済みと存在しない ID は NOT_FOUND', () => {
  const env = fixture();
  const first = env.create();
  const confirmed = env.call('confirm', { id: uuid(1) });
  assert.equal(confirmed.record.confirmCount, 2);
  assert.notEqual(confirmed.record.etag, first.record.etag);
  env.call('delete', { id: uuid(1), expectedEtag: confirmed.record.etag });
  assertFailureUnchanged(env, 'confirm', { id: uuid(1) }, 'NOT_FOUND');
  assertFailureUnchanged(env, 'confirm', { id: uuid(2) }, 'NOT_FOUND');
});

test('同時編集: ロックの取得までに増えた確認回数を読み直して加算する', () => {
  const env = fixture();
  env.create();
  const column = env.sheet.data[0].indexOf('confirmCount');
  env.gas.LockService.getScriptLock = () => ({
    tryLock: () => {
      env.sheet.data[1][column] = '5';
      env.events.push('tryLock');
      return true;
    },
    releaseLock: () => env.events.push('releaseLock'),
  });
  const result = env.call('confirm', { id: uuid(1) });
  assert.equal(result.record.confirmCount, 6);
  assert.equal(result.snapshot.records[0].confirmCount, 6);
});

test('更新: メモ・性別だけの変更は確認回数と createdAt を維持する', () => {
  const env = fixture();
  env.create();
  const confirmed = env.call('confirm', { id: uuid(1) }).record;
  const result = env.call('update', { id: uuid(1), expectedEtag: confirmed.etag, record: input({ memo: '変更', parent1Gender: '' }) });
  assert.equal(result.ok, true);
  assert.equal(result.record.confirmCount, 2);
  assert.equal(result.record.createdAt, confirmed.createdAt);
  assert.equal(result.record.memo, '変更');
});

for (const overrides of [{ parent1Id: 'SheepBall' }, { parent2Id: 'SheepBall' }, { childId: 'SheepBall' }]) {
  test(`更新: ${Object.keys(overrides)[0]} が変わると確認回数を 1 に戻す`, () => {
    const env = fixture();
    env.create();
    const confirmed = env.call('confirm', { id: uuid(1) }).record;
    const result = env.call('update', { id: uuid(1), expectedEtag: confirmed.etag, record: input(overrides) });
    assert.equal(result.ok, true);
    assert.equal(result.record.confirmCount, 1);
  });
}

test('更新: 親の入力順を反転しても同一配合なら確認回数を維持する', () => {
  const env = fixture();
  env.create();
  const confirmed = env.call('confirm', { id: uuid(1) }).record;
  const result = env.call('update', { id: uuid(1), expectedEtag: confirmed.etag, record: input({
    parent1Id: 'GuardianDog', parent2Id: 'FlowerDoll', parent1Gender: 'F', parent2Gender: 'M',
  }) });
  assert.equal(result.record.confirmCount, 2);
  assert.equal(result.record.parent1Gender, 'M');
});

test('更新: 自分以外の同一配合なら DUPLICATE を返す', () => {
  const env = fixture();
  const first = env.create().record;
  env.create(uuid(2), { parent1Id: 'MoonQueen', parent2Id: 'SheepBall', childId: 'FlowerDoll' });
  const result = assertFailureUnchanged(env, 'update', {
    id: first.id, expectedEtag: first.etag,
    record: input({ parent1Id: 'SheepBall', parent2Id: 'MoonQueen', childId: 'FlowerDoll' }),
  }, 'DUPLICATE');
  assert.equal(result.existing.id, uuid(2));
});

test('更新: 配合を変えるとペア競合を検査し、許可付きで更新できる', () => {
  const env = fixture();
  const first = env.create(uuid(1), { parent1Id: 'MoonQueen', parent2Id: 'SheepBall', childId: 'FlowerDoll' }).record;
  env.create(uuid(2));
  const fields = { id: first.id, expectedEtag: first.etag, record: input({ childId: 'SheepBall' }) };
  assertFailureUnchanged(env, 'update', fields, 'PAIR_CONFLICT');
  assert.equal(env.call('update', { ...fields, allowDifferentChild: true }).ok, true);
});

test('更新: 既存の別の子があってもメモのみの更新ならペア競合にしない', () => {
  const env = fixture();
  const first = env.create().record;
  env.create(uuid(2), { childId: 'SheepBall' }, { allowDifferentChild: true });
  assert.equal(env.call('update', { id: first.id, expectedEtag: first.etag, record: input({ memo: '追記' }) }).ok, true);
});

for (const action of ['update', 'delete', 'restore']) {
  test(`競合: ${action} の etag 不一致は最新レコードを返し、何も変更しない`, () => {
    const env = fixture();
    const fields = prepareOperation(env, action);
    const result = assertFailureUnchanged(env, action, { ...fields, expectedEtag: '古い版' }, 'CONFLICT');
    assert.equal(result.latest.id, uuid(1));
    assert.notEqual(result.latest.etag, '古い版');
  });
}

test('競合: シートの値を直接変更すると etag が変わり、古い更新を拒否する', () => {
  const env = fixture();
  const first = env.create().record;
  env.sheet.data[1][env.sheet.data[0].indexOf('memo')] = '手で変更';
  const result = assertFailureUnchanged(env, 'update', {
    id: first.id, expectedEtag: first.etag, record: input({ memo: '古い画面から更新' }),
  }, 'CONFLICT');
  assert.equal(result.latest.memo, '手で変更');
  assert.notEqual(result.latest.etag, first.etag);
});

for (const stale of ['source', 'target']) {
  test(`統合: ${stale} の etag 不一致なら両方の最新値を返し、片方だけを変更しない`, () => {
    const env = fixture();
    const fields = prepareOperation(env, 'merge');
    const result = assertFailureUnchanged(env, 'merge', {
      ...fields, expectedEtags: { ...fields.expectedEtags, [stale]: '古い版' },
    }, 'CONFLICT');
    assert.equal(result.latest.source.id, fields.sourceId);
    assert.equal(result.latest.target.id, fields.targetId);
    assert.equal(env.snapshot().records.length, 2);
  });
}

test('統合: 同一配合なら source の確認回数を加算し、source を論理削除する', () => {
  const env = fixture();
  env.seed([stored({ id: uuid(1), confirmCount: 4 }), stored({ id: uuid(2), confirmCount: 3 })]);
  const [target, source] = env.snapshot().records;
  const result = env.call('merge', { sourceId: source.id, targetId: target.id, expectedEtags: { source: source.etag, target: target.etag } });
  assert.equal(result.record.confirmCount, 7);
  assert.equal(result.removed, source.id);
  assert.deepEqual(result.snapshot.records, [result.record]);
  assert.deepEqual(result.snapshot.warnings, []);
  assert.equal(env.sheet.getLastRow(), 3);
  assert.ok(env.sheet.data[2][env.sheet.data[0].indexOf('deletedAt')]);
  assert.equal(env.logSheet.getLastRow(), 2);
  const before = JSON.parse(env.logSheet.data[1][3]);
  const after = JSON.parse(env.logSheet.data[1][4]);
  assert.deepEqual(before.map((record) => record.confirmCount), [3, 4]);
  assert.equal(after[1].confirmCount, 7);
  assert.ok(after[0].deletedAt);
});

test('統合: 異なる配合なら source の回数に関係なく 1 だけ加算する', () => {
  const env = fixture();
  const fields = prepareOperation(env, 'merge');
  env.call('confirm', { id: fields.sourceId });
  const source = env.call('confirm', { id: fields.sourceId }).record;
  const result = env.call('merge', { ...fields, expectedEtags: { ...fields.expectedEtags, source: source.etag } });
  assert.equal(result.record.confirmCount, 2);
});

test('統合: source と target は別の有効レコードでなければならない', () => {
  const env = fixture();
  const fields = prepareOperation(env, 'merge');
  assertFailureUnchanged(env, 'merge', { ...fields, sourceId: fields.targetId }, 'VALIDATION');
  assertFailureUnchanged(env, 'merge', { ...fields, sourceId: uuid(3) }, 'NOT_FOUND');
  env.call('delete', { id: fields.sourceId, expectedEtag: fields.expectedEtags.source });
  assertFailureUnchanged(env, 'merge', fields, 'NOT_FOUND');
});

test('削除・復元: 削除後の etag と deleted を返し、新しい opId の二重操作も冪等に扱う', () => {
  const env = fixture();
  const first = env.create().record;
  const deleted = env.call('delete', { id: first.id, expectedEtag: first.etag });
  assert.equal(deleted.record.deleted, true);
  assert.notEqual(deleted.record.etag, first.etag);
  assert.equal('deletedAt' in deleted.record, false);
  assert.deepEqual(deleted.snapshot.records, []);
  const again = env.call('delete', { id: first.id, expectedEtag: '古い版' });
  assert.equal(again.idempotent, true);
  assert.deepEqual(again.record, deleted.record);
  const restored = env.call('restore', { id: first.id, expectedEtag: deleted.record.etag });
  assert.equal(restored.record.deleted, false);
  assert.equal(restored.snapshot.records.length, 1);
  const logRows = env.logSheet.getLastRow();
  const repeated = env.call('restore', { id: first.id, expectedEtag: '古い版' });
  assert.equal(repeated.idempotent, true);
  assert.deepEqual(repeated.record, restored.record);
  assert.equal(env.logSheet.getLastRow(), logRows);
});

test('復元: 同一配合が有効なら既存側だけを +1 し、再送でも二重加算しない', () => {
  const env = fixture();
  const first = env.create().record;
  const deleted = env.call('delete', { id: first.id, expectedEtag: first.etag }).record;
  const active = env.create(uuid(2)).record;
  const fields = { id: first.id, expectedEtag: deleted.etag, opId: uuid(701) };
  const result = env.call('restore', fields);
  assert.equal(result.mergedInto, active.id);
  assert.equal(result.record.id, active.id);
  assert.equal(result.record.confirmCount, 2);
  assert.equal(result.record.deleted, false);
  assert.deepEqual(result.snapshot.records.map((record) => record.id), [active.id]);
  assert.equal(env.call('restore', fields).record.confirmCount, 2);
  assert.equal(env.snapshot().records[0].confirmCount, 2);
  assert.equal(env.logSheet.getLastRow(), 5);
  assert.ok(env.sheet.data[1][env.sheet.data[0].indexOf('deletedAt')]);
});

for (const action of ['update', 'delete', 'restore']) {
  test(`未存在: ${action} は NOT_FOUND を返す`, () => {
    const env = fixture();
    assertFailureUnchanged(env, action, { id: uuid(1), expectedEtag: 'なし', ...(action === 'update' ? { record: input() } : {}) }, 'NOT_FOUND');
  });
}

for (const action of ['create', 'update']) {
  for (const [name, overrides] of [
    ['マスター外 ID', { childId: '存在しないパル' }],
    ['不正な性別', { parent1Gender: 'X' }],
    ['長すぎる登録者', { registrant: 'あ'.repeat(31) }],
    ['長すぎるメモ', { memo: 'あ'.repeat(201) }],
    ['未知の項目', { confirmCount: 99 }],
  ]) {
    test(`入力検証: ${action} は ${name} を拒否する`, () => {
      const env = fixture();
      const fields = prepareOperation(env, action);
      const result = assertFailureUnchanged(env, action, { ...fields, record: { ...fields.record, ...overrides } }, 'VALIDATION');
      assert.ok(result.errors.length > 0);
    });
  }
}

test('入力検証: ID・sourceId・targetId は UUID を必須とする', () => {
  const env = fixture();
  for (const action of ['create', 'confirm', 'update', 'merge', 'delete', 'restore']) {
    const fields = prepareOperation(fixture(), action);
    const invalid = action === 'create' ? { ...fields, record: { ...fields.record, id: '不正' } }
      : action === 'merge' ? { ...fields, sourceId: '不正' } : { ...fields, id: '不正' };
    assertFailureUnchanged(env, action, invalid, 'VALIDATION');
    if (action === 'merge') assertFailureUnchanged(env, action, { ...fields, targetId: '不正' }, 'VALIDATION');
  }
});

test('入力検証: 自由入力は制御文字除去・trim 後に保存する', () => {
  const env = fixture();
  const result = env.create(uuid(1), { registrant: '  登録\u0000者  ', memo: '\n メモ\t ' });
  assert.equal(result.record.registrant, '登録者');
  assert.equal(result.record.memo, 'メモ');
});

for (const prefix of ['=', '+', '-', '@', "'"]) {
  test(`書き込み: ${prefix} 始まりの自由入力は quoteForSheet を通す`, () => {
    const env = fixture();
    const value = `${prefix}1+1`;
    const result = env.create(uuid(1), { registrant: value, memo: value });
    assert.equal(result.ok, true);
    for (const field of ['registrant', 'memo']) {
      const saved = env.sheet.data[1][env.sheet.data[0].indexOf(field)];
      assert.equal(saved, `'${value}`);
      // 実機は先頭の引用用 ' を外して返すが、偽物は保存値をそのまま返す。
      assert.equal(result.record[field], saved);
    }
    const updated = env.call('update', { id: uuid(1), expectedEtag: result.record.etag, record: input({ registrant: value, memo: value }) });
    assert.equal(updated.record.memo, `'${value}`);
  });
}

test('書き込み: ヘッダーの列順に合わせ、全列を setValues 一回で書き、先に @ 書式を設定する', () => {
  const env = fixture();
  const headers = [...plain(env.gas.BREEDING_HEADERS_).reverse(), '独自列'];
  env.seed([], headers);
  env.sheet.log.length = 0;
  env.logSheet.log.length = 0;
  const created = env.create().record;
  assert.equal(env.sheet.data[1][headers.indexOf('id')], uuid(1));
  assert.equal(env.sheet.data[1][headers.indexOf('childName')], env.gas.PAL_MASTER_.MoonQueen);
  for (const sheet of [env.sheet, env.logSheet]) {
    assert.deepEqual(sheet.log.map((entry) => entry.op), ['setNumberFormat', 'setValues']);
    assert.equal(sheet.log[0].fmt, '@');
  }
  env.sheet.data[1][headers.indexOf('独自列')] = '人の追記';
  env.sheet.log.length = 0;
  assert.equal(env.call('update', { id: created.id, expectedEtag: created.etag, record: input({ memo: '更新' }) }).ok, true);
  assert.equal(env.sheet.data[1][headers.indexOf('独自列')], '人の追記');
  assert.deepEqual(env.sheet.log.map((entry) => entry.op), ['setNumberFormat', 'setValues']);
});

test('Log: 変更前後の JSON と操作を記録し、パスコードやリクエストを含めない', () => {
  const env = fixture();
  const first = env.create().record;
  const result = env.call('confirm', { id: first.id });
  const log = env.logSheet.data[2];
  assert.equal(log[1], 'confirm');
  assert.equal(log[2], first.id);
  assert.equal(JSON.parse(log[3]).confirmCount, 1);
  assert.equal(JSON.parse(log[4]).confirmCount, 2);
  assert.equal(log[0], result.record.updatedAt);
  assert.equal(JSON.stringify(env.logSheet.data).includes(PROPS.TEST_PASSCODE), false);
  assert.equal(JSON.stringify(env.logSheet.data).includes('opId'), false);
});

test('Log: before・after に quoteForSheet を適用し、Log の列順にも従う', () => {
  const env = fixture();
  const headers = ['after', 'recordId', 'before', 'action', 'at'];
  env.logSheet.data = [headers];
  const seen = [];
  const original = env.gas.quoteForSheet;
  env.gas.quoteForSheet = (value) => { seen.push(value); return original(value); };
  env.create();
  assert.ok(seen.includes('null'));
  assert.ok(seen.some((value) => typeof value === 'string' && value.startsWith('{') && JSON.parse(value).id === uuid(1)));
  assert.equal(env.logSheet.data[1][headers.indexOf('action')], 'create');
  assert.equal(JSON.parse(env.logSheet.data[1][headers.indexOf('after')]).id, uuid(1));
});

test('整合性: 親・性別と数値文字列を読み込み時に正規化する', () => {
  const env = fixture();
  env.seed([stored({ parent1Id: 'GuardianDog', parent2Id: 'FlowerDoll', parent1Gender: 'F', parent2Gender: 'M', confirmCount: '3' })]);
  const record = env.snapshot().records[0];
  assert.equal(record.parent1Id, 'FlowerDoll');
  assert.equal(record.parent1Gender, 'M');
  assert.equal(record.parent2Gender, 'F');
  assert.equal(record.confirmCount, 3);
  assert.deepEqual(env.snapshot().warnings, []);
});

test('etag: 表示名を除く正規化後の全内容を SHA-256・URL 安全 Base64 の先頭 16 文字にする', () => {
  const env = fixture();
  const record = stored({ parent1Id: 'GuardianDog', parent2Id: 'FlowerDoll', parent1Gender: 'F', parent2Gender: 'M', confirmCount: '3' });
  env.seed([record]);
  const normalized = { ...record, parent1Id: 'FlowerDoll', parent2Id: 'GuardianDog', parent1Gender: 'M', parent2Gender: 'F', confirmCount: 3 };
  const expected = crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('base64url').slice(0, 16);
  assert.equal(env.snapshot().records[0].etag, expected);
});

test('etag: 表示名の修正は無視し、親順を交換して性別も交換した行は同じ etag にする', () => {
  const env = fixture();
  env.seed([stored()]);
  const first = env.snapshot().records[0];
  const h = env.sheet.data[0];
  env.sheet.data[1][h.indexOf('parent1Name')] = '表示名だけ変更';
  assert.equal(env.snapshot().records[0].etag, first.etag);
  env.seed([stored({ parent1Id: 'GuardianDog', parent2Id: 'FlowerDoll', parent1Gender: 'F', parent2Gender: 'M' })]);
  assert.equal(env.snapshot().records[0].etag, first.etag);
});

for (const field of ['parent1Id', 'parent2Id', 'childId']) {
  test(`整合性: マスター外の ${field} は UNKNOWN_PAL で除外する`, () => {
    const env = fixture();
    env.seed([stored({ [field]: '不明なパル' })]);
    const result = env.snapshot();
    assert.deepEqual(result.records, []);
    assert.deepEqual(result.warnings, [{ code: 'UNKNOWN_PAL', rowNumber: 2, id: uuid(1) }]);
    assert.equal(plain(env.gas.readRecords_('test')).rows.length, 1);
  });
}

test('整合性: 削除済みも含む同じ ID の全行を DUPLICATE_ID で除外する', () => {
  const env = fixture();
  env.seed([stored(), stored({ deletedAt: '2026-10-03T01:00:00.000Z' }), stored({ id: uuid(2), childId: 'SheepBall' })]);
  const result = env.snapshot();
  assert.deepEqual(result.records.map((record) => record.id), [uuid(2)]);
  assert.deepEqual(result.warnings, [2, 3].map((rowNumber) => ({ code: 'DUPLICATE_ID', rowNumber, id: uuid(1) })));
  assertFailureUnchanged(env, 'create', { record: { id: uuid(1), ...input() } }, 'ID_CONFLICT');
});

for (const confirmCount of [0, -1, 1.5, '', '不正', 'Infinity', 'NaN']) {
  test(`整合性: 確認回数 ${JSON.stringify(confirmCount)} は BAD_COUNT で除外する`, () => {
    const env = fixture();
    env.seed([stored({ confirmCount })]);
    assert.deepEqual(env.snapshot().records, []);
    assert.deepEqual(env.snapshot().warnings, [{ code: 'BAD_COUNT', rowNumber: 2, id: uuid(1) }]);
  });
}

test('整合性: 空の ID は他の列に不備があっても警告なく無視し、削除済みは内部 rows に残す', () => {
  const env = fixture();
  env.seed([stored({ id: '', childId: '不明', confirmCount: -1 }), stored({ deletedAt: '削除日時' })]);
  assert.deepEqual(env.snapshot().records, []);
  assert.deepEqual(env.snapshot().warnings, []);
  const rows = plain(env.gas.readRecords_('test')).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rowNumber, 3);
  assert.equal(rows[0].record.deletedAt, '削除日時');
});

test('整合性: 同一配合の有効行は両方残し、各行に DUPLICATE_RECORD を警告する', () => {
  const env = fixture();
  env.seed([
    stored(), stored({ id: uuid(2), parent1Id: 'GuardianDog', parent2Id: 'FlowerDoll' }),
    stored({ id: uuid(3), deletedAt: '削除日時' }), stored({ id: uuid(4), confirmCount: 0 }),
  ]);
  const result = env.snapshot();
  assert.deepEqual(result.records.map((record) => record.id), [uuid(1), uuid(2)]);
  assert.deepEqual(result.warnings.filter((warning) => warning.code === 'DUPLICATE_RECORD'), [
    { code: 'DUPLICATE_RECORD', rowNumber: 2, id: uuid(1) },
    { code: 'DUPLICATE_RECORD', rowNumber: 3, id: uuid(2) },
  ]);
});

for (const kind of ['欠落', '重複', '空']) {
  test(`ヘッダー: データシートの ${kind} は JSON の SHEET_HEADER で返す`, () => {
    const env = fixture();
    const headers = plain(env.gas.BREEDING_HEADERS_);
    if (kind === '欠落') headers.splice(headers.indexOf('memo'), 1);
    if (kind === '重複') headers.push('id');
    env.sheet.data = kind === '空' ? [] : [headers];
    assert.deepEqual(env.snapshot(), { ok: false, code: 'SHEET_HEADER' });
    const output = env.gas.doPost({ postData: { contents: JSON.stringify({ action: 'snapshot', passcode: PROPS.TEST_PASSCODE }) } });
    assert.equal(output.mime, 'application/json');
    assert.deepEqual(JSON.parse(output.text), { ok: false, code: 'SHEET_HEADER' });
    assertFailureUnchanged(env, 'create', { record: { id: uuid(1), ...input() } }, 'SHEET_HEADER');
  });
}

test('ヘッダー: Log に不備があればレコードを書き換える前に SHEET_HEADER で中断する', () => {
  const env = fixture();
  const first = env.create().record;
  env.logSheet.data[0] = ['at', 'action', 'recordId', 'before'];
  assertFailureUnchanged(env, 'confirm', { id: first.id }, 'SHEET_HEADER');
  // 直接追加した有効行を使い、統合でもヘッダー検査が先に走ることを確かめる。
  env.seed([stored(), stored({ id: uuid(2), parent1Id: 'MoonQueen', parent2Id: 'SheepBall', childId: 'FlowerDoll' })]);
  const [target, source] = env.snapshot().records;
  assertFailureUnchanged(env, 'merge', {
    sourceId: source.id, targetId: target.id, expectedEtags: { source: source.etag, target: target.etag },
  }, 'SHEET_HEADER');
});

test('基盤: 書き込み中の例外も JSON 化し、flush の後にロックを解放する', () => {
  const env = fixture();
  env.sheet.setCell = () => { throw new Error('偽サービスの書き込み失敗'); };
  const result = env.create();
  assert.deepEqual(result, { ok: false, code: 'INTERNAL' });
  assert.deepEqual(env.events.slice(-2), ['flush', 'releaseLock']);
  assert.equal(env.cache.puts.length, 0);
});

test('snapshot: ロックを取得せず、有効レコード・警告・serverTime を返す', () => {
  const env = fixture({ lockAvailable: false });
  const result = env.snapshot();
  assert.equal(result.ok, true);
  assert.deepEqual(result.records, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(typeof result.serverTime, 'string');
  assert.deepEqual(env.events, []);
});
