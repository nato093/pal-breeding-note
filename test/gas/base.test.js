import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGas } from './harness.js';

// vm 内で作られたオブジェクトは別 realm なので、比較前に素のオブジェクトへ戻す
const plain = (v) => JSON.parse(JSON.stringify(v));

const PROPS = { PASSCODE: 'AAAA-BBBB-CCCC-DDDD', TEST_PASSCODE: 'EEEE-FFFF-GGGG-HHHH' };
const call = (gas, req) => plain(gas.handleRequest_(JSON.stringify(req)));

test('認証: 本番とテストのパスコードで環境が切り替わる（大文字小文字・区切りは無視）', () => {
  const { gas } = createGas({ properties: PROPS });
  assert.deepEqual(plain(gas.authenticate_('aaaabbbbccccdddd')), { ok: true, env: 'prod' });
  assert.deepEqual(plain(gas.authenticate_('EEEE FFFF GGGG HHHH')), { ok: true, env: 'test' });
  assert.deepEqual(plain(gas.authenticate_('WRONG')), { ok: false, code: 'AUTH' });
  assert.deepEqual(plain(gas.authenticate_(undefined)), { ok: false, code: 'AUTH' });
});

test('認証: パスコードが未設定、または本番とテストが同じ値なら全拒否する', () => {
  assert.equal(plain(createGas({ properties: { PASSCODE: 'AAAA' } }).gas.authenticate_('AAAA')).code, 'CONFIG');
  assert.equal(plain(createGas({ properties: { TEST_PASSCODE: 'AAAA' } }).gas.authenticate_('AAAA')).code, 'CONFIG');
  const same = createGas({ properties: { PASSCODE: 'AAAA-BBBB', TEST_PASSCODE: 'aaaabbbb' } });
  assert.equal(plain(same.gas.authenticate_('AAAABBBB')).code, 'CONFIG');
});

test('パスコード生成: 4 文字 × 4 組で、紛らわしい文字を含まない', () => {
  const { gas } = createGas();
  for (let i = 0; i < 50; i++) {
    const code = gas.generatePasscode_();
    assert.match(code, /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
  }
});

test('リクエスト: 不正な入力にも必ず JSON のエラーを返す', () => {
  const { gas } = createGas({ properties: PROPS });
  assert.equal(plain(gas.handleRequest_('')).code, 'BAD_REQUEST');
  assert.equal(plain(gas.handleRequest_('{')).code, 'BAD_JSON');
  assert.equal(plain(gas.handleRequest_('[1]')).code, 'BAD_REQUEST');
  assert.equal(plain(gas.handleRequest_('x'.repeat(16 * 1024 + 1))).code, 'TOO_LARGE');
  assert.equal(call(gas, { action: 'ping', passcode: 'nope' }).code, 'AUTH');
  assert.equal(call(gas, { action: 'hack', passcode: PROPS.TEST_PASSCODE }).code, 'BAD_ACTION');
  assert.equal(call(gas, { action: 'toString', passcode: PROPS.TEST_PASSCODE }).code, 'BAD_ACTION');
});

test('リクエスト: 診断用の probe は本番パスコードでは使えない', () => {
  const { gas } = createGas({ properties: PROPS });
  assert.equal(call(gas, { action: 'probe', passcode: PROPS.PASSCODE, text: 'x' }).code, 'FORBIDDEN');
  const ok = call(gas, { action: 'probe', passcode: PROPS.TEST_PASSCODE, text: 'x', tag: 't' });
  assert.equal(ok.ok, true);
  assert.equal(ok.env, 'test');
});

test('リクエスト: 例外時は INTERNAL を返し、ログにパスコードを残さない', () => {
  const { gas, logs } = createGas({ properties: PROPS });
  // setup 前なのでシートがなく、snapshot は例外になる
  const res = call(gas, { action: 'snapshot', passcode: PROPS.PASSCODE });
  assert.deepEqual(res, { ok: false, code: 'INTERNAL' });
  assert.equal(logs.error.length, 1);
  assert.ok(!logs.error[0].includes(PROPS.PASSCODE));
  assert.ok(!logs.error[0].includes('AAAABBBB'));
});

test('ロック: 書き込みを flush してから解放する。取れなければ BUSY', () => {
  const ok = createGas({ properties: PROPS });
  call(ok.gas, { action: 'probe', passcode: PROPS.TEST_PASSCODE, text: 'x', tag: 't' });
  const order = ok.events.filter((e) => e !== 'tryLock');
  assert.deepEqual(order.slice(-2), ['flush', 'releaseLock']);

  const busy = createGas({ properties: PROPS, lockAvailable: false });
  assert.equal(call(busy.gas, { action: 'probe', passcode: PROPS.TEST_PASSCODE, text: 'x' }).code, 'BUSY');
});

test('setup: 4 枚のシートとヘッダーを作り、パスコードを生成する。再実行しても変えない', () => {
  const { gas, spreadsheet, props, logs } = createGas();
  gas.setup();
  const names = spreadsheet.getSheets().map((s) => s.getName()).sort();
  assert.deepEqual(names, ['Breedings', 'Breedings_test', 'Log', 'Log_test']);
  const headers = spreadsheet.getSheetByName('Breedings').getRange(1, 1, 1, 15).getValues()[0];
  assert.deepEqual(plain(headers), plain(gas.BREEDING_HEADERS_));
  assert.ok(props.store.PASSCODE && props.store.TEST_PASSCODE);
  assert.notEqual(props.store.PASSCODE, props.store.TEST_PASSCODE);
  assert.ok(logs.log.some((l) => l.includes(props.store.PASSCODE)));

  const before = { ...props.store };
  const protectionCount = spreadsheet.getSheetByName('Breedings').protections.length;
  gas.setup();
  assert.deepEqual(props.store, before);
  assert.equal(spreadsheet.getSheetByName('Breedings').protections.length, protectionCount);
});

test('snapshot: ヘッダー名で列を対応付け、削除済みと空行を除外する', () => {
  const { gas, spreadsheet } = createGas({ properties: PROPS });
  gas.setup();
  const sheet = spreadsheet.getSheetByName('Breedings_test');
  const h = gas.BREEDING_HEADERS_;
  const row = (over) => h.map((name) => (over[name] !== undefined ? over[name] : ''));
  sheet.seed([
    h.slice(),
    row({ id: 'r1', parent1Id: 'A', parent2Id: 'B', childId: 'C', confirmCount: 1 }),
    row({ id: 'r2', parent1Id: 'A', parent2Id: 'C', childId: 'D', deletedAt: '2026-10-03T00:00:00Z' }),
    row({}),
  ]);
  const res = call(gas, { action: 'snapshot', passcode: PROPS.TEST_PASSCODE });
  assert.equal(res.ok, true);
  assert.deepEqual(res.records.map((r) => r.id), ['r1']);
  // 本番シートは空のまま（テスト用パスコードはテスト用シートにしか届かない）
  const prod = call(gas, { action: 'snapshot', passcode: PROPS.PASSCODE });
  assert.deepEqual(prod.records, []);
});

test('readTable_: ヘッダーの重複・欠落は例外にする', () => {
  const { gas, spreadsheet } = createGas();
  const s = spreadsheet.insertSheet('X');
  s.seed([['id', 'id']]);
  assert.throws(() => gas.readTable_(s, ['id']), /duplicate header/);
  const t = spreadsheet.insertSheet('Y');
  t.seed([['id']]);
  assert.throws(() => gas.readTable_(t, ['id', 'childId']), /missing header/);
});
