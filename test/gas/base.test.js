import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGas } from './harness.js';

// vm 内で作られたオブジェクトは別 realm なので、比較前に素のオブジェクトへ戻す
const plain = (v) => JSON.parse(JSON.stringify(v));

const PROPS = { PASSCODE: 'AAAA-BBBB-CCCC-DDDD', TEST_PASSCODE: 'EEEE-FFFF-GGGG-HHHH' };
const call = (gas, req) => plain(gas.handleRequest_(JSON.stringify(req)));

function authenticatedGas(options = {}) {
  const env = createGas({ properties: PROPS, ...options });
  env.spreadsheet.insertSheet('設定').seed([['項目', '値'], ['共通パスワード', PROPS.PASSCODE]]);
  return env;
}

test('認証: 前後の空白だけを除き、大文字小文字・記号・日本語を完全一致で照合する', () => {
  const { gas, spreadsheet } = authenticatedGas();
  assert.deepEqual(plain(gas.authenticate_('  AAAA-BBBB-CCCC-DDDD  ')), { ok: true, env: 'prod' });
  assert.deepEqual(plain(gas.authenticate_(' EEEE-FFFF-GGGG-HHHH ')), { ok: true, env: 'test' });
  for (const input of ['aaaa-bbbb-cccc-dddd', 'AAAABBBBCCCCDDDD', 'WRONG', undefined]) {
    assert.deepEqual(plain(gas.authenticate_(input)), { ok: false, code: 'AUTH' });
  }
  spreadsheet.getSheetByName('設定').data = [['値', '独自列', '項目'], [' 日本語! aＡ ', '', '共通パスワード']];
  assert.equal(gas.authenticate_('日本語! aＡ').env, 'prod');
  assert.equal(gas.authenticate_('日本語! aA').code, 'AUTH');
});

test('認証: 設定シート・行・値の欠落、テスト値の空、trim 後の同値は全拒否で CONFIG', () => {
  const missing = createGas({ properties: PROPS });
  assert.equal(call(missing.gas, { action: 'ping', passcode: PROPS.TEST_PASSCODE }).code, 'CONFIG');
  for (const rows of [[], [['項目', '値']], [['項目', '値'], ['共通パスワード', ' ']], [['項目'], ['共通パスワード']]]) {
    const env = authenticatedGas();
    env.spreadsheet.getSheetByName('設定').data = rows;
    for (const passcode of [PROPS.TEST_PASSCODE, PROPS.PASSCODE]) assert.equal(call(env.gas, { action: 'ping', passcode }).code, 'CONFIG');
    assert.deepEqual(env.logs.error, []);
  }
  for (const test of ['', ' ', null, ` ${PROPS.PASSCODE} `]) {
    const env = authenticatedGas({ properties: { TEST_PASSCODE: test } });
    assert.equal(env.gas.authenticate_(PROPS.PASSCODE).code, 'CONFIG');
  }
});

test('パスワード生成: 4 文字 × 4 組で、紛らわしい文字を含まない', () => {
  const { gas } = createGas();
  for (let i = 0; i < 50; i++) {
    const code = gas.generatePasscode_();
    assert.match(code, /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
  }
});

test('リクエスト: 不正な入力にも必ず JSON のエラーを返す', () => {
  const { gas } = authenticatedGas();
  assert.equal(plain(gas.handleRequest_('')).code, 'BAD_REQUEST');
  assert.equal(plain(gas.handleRequest_('{')).code, 'BAD_JSON');
  assert.equal(plain(gas.handleRequest_('[1]')).code, 'BAD_REQUEST');
  assert.equal(plain(gas.handleRequest_('x'.repeat(16 * 1024 + 1))).code, 'TOO_LARGE');
  assert.equal(call(gas, { action: 'ping', passcode: 'nope' }).code, 'AUTH');
  assert.equal(call(gas, { action: 'hack', passcode: PROPS.TEST_PASSCODE }).code, 'BAD_ACTION');
  assert.equal(call(gas, { action: 'toString', passcode: PROPS.TEST_PASSCODE }).code, 'BAD_ACTION');
});

test('リクエスト: 診断用の probe は本番パスワードでは使えない', () => {
  const { gas } = authenticatedGas();
  assert.equal(call(gas, { action: 'probe', passcode: PROPS.PASSCODE, text: 'x' }).code, 'FORBIDDEN');
  const ok = call(gas, { action: 'probe', passcode: PROPS.TEST_PASSCODE, text: 'x', tag: 't' });
  assert.equal(ok.ok, true);
  assert.equal(ok.env, 'test');
});

test('リクエスト: 例外時は INTERNAL を返し、ログにパスワードを残さない', () => {
  const { gas, logs } = authenticatedGas();
  // setup 前なのでシートがなく、snapshot は例外になる
  const res = call(gas, { action: 'snapshot', passcode: PROPS.PASSCODE });
  assert.deepEqual(res, { ok: false, code: 'INTERNAL' });
  assert.equal(logs.error.length, 1);
  assert.ok(!logs.error[0].includes(PROPS.PASSCODE));
  assert.ok(!logs.error[0].includes('AAAABBBB'));
});

test('ロック: 書き込みを flush してから解放する。取れなければ BUSY', () => {
  const ok = authenticatedGas();
  call(ok.gas, { action: 'probe', passcode: PROPS.TEST_PASSCODE, text: 'x', tag: 't' });
  const order = ok.events.filter((e) => e !== 'tryLock');
  assert.deepEqual(order.slice(-2), ['flush', 'releaseLock']);

  const busy = authenticatedGas({ lockAvailable: false });
  assert.equal(call(busy.gas, { action: 'probe', passcode: PROPS.TEST_PASSCODE, text: 'x' }).code, 'BUSY');
});

test('setup: 7枚のシートとヘッダーを作り、ログに値を出さず、再実行しても設定を変えない', () => {
  const { gas, spreadsheet, props, logs } = createGas();
  gas.setup();
  assert.deepEqual(spreadsheet.getSheets().map((s) => s.getName()).sort(),
    ['Breedings', 'Breedings_test', 'Log', 'Log_test', 'Users', 'Users_test', '設定']);
  const password = spreadsheet.getSheetByName('設定').data[1][1];
  assert.ok(password && props.store.TEST_PASSCODE);
  assert.notEqual(password, props.store.TEST_PASSCODE);
  assert.equal(props.store.PASSCODE, undefined);
  assert.equal(JSON.stringify(logs).includes(password), false);
  assert.equal(JSON.stringify(logs).includes(props.store.TEST_PASSCODE), false);
  const before = JSON.stringify(spreadsheet.getSheets().map((sheet) => sheet.data));
  const beforeProps = { ...props.store };
  gas.setup();
  assert.equal(JSON.stringify(spreadsheet.getSheets().map((sheet) => sheet.data)), before);
  assert.deepEqual(props.store, beforeProps);
  for (const sheet of spreadsheet.getSheets()) {
    assert.equal(sheet.protections.length, 1);
    assert.equal(sheet.protections[0].warningOnly, true);
    assert.equal(sheet.frozenRows, 1);
    assert.ok(sheet.formats.every((format) => format.fmt === '@'));
  }
});

test('setup: 旧 PASSCODE を数字の文字列のまま移し、プロパティを削除する', () => {
  const { gas, spreadsheet, props } = createGas({ properties: { PASSCODE: '001234', TEST_PASSCODE: PROPS.TEST_PASSCODE } });
  gas.setup();
  assert.equal(spreadsheet.getSheetByName('設定').data[1][1], '001234');
  assert.equal(props.store.PASSCODE, undefined);
  assert.equal(props.store.TEST_PASSCODE, PROPS.TEST_PASSCODE);
  assert.equal(gas.authenticate_('001234').env, 'prod');
});

test('setup: flush と設定の読み戻しを済ませてから旧 PASSCODE を削除する', () => {
  const { gas, spreadsheet, props, events } = createGas({ properties: PROPS });
  const originalRead = gas.readTable_;
  const originalDelete = props.deleteProperty;
  gas.readTable_ = (sheet, headers) => {
    if (sheet.getName() === '設定' && events.includes('flush')) events.push('readBack');
    return originalRead(sheet, headers);
  };
  props.deleteProperty = (key) => {
    if (key === 'PASSCODE') {
      assert.deepEqual(events, ['flush', 'readBack']);
      assert.equal(spreadsheet.getSheetByName('設定').data[1][1], PROPS.PASSCODE);
      events.push('deletePasscode');
    }
    return originalDelete(key);
  };
  gas.setup();
  assert.deepEqual(events, ['flush', 'readBack', 'deletePasscode']);
});

for (const saved of ['', ' ', '異なる値']) {
  test(`setup: 読み戻した値が ${JSON.stringify(saved)} なら例外にして旧 PASSCODE を保持する`, () => {
    const { gas, spreadsheet, props } = createGas({ properties: PROPS });
    gas.SpreadsheetApp.flush = () => { spreadsheet.getSheetByName('設定').data[1][1] = saved; };
    assert.throws(() => gas.setup(), /共通パスワードの移行を確認できませんでした/);
    assert.equal(props.store.PASSCODE, PROPS.PASSCODE);
  });
}

test('setup: flush や読み戻しが失敗しても旧 PASSCODE を保持する', () => {
  for (const failure of ['flush', 'readBack']) {
    const { gas, props, events } = createGas({ properties: PROPS });
    if (failure === 'flush') {
      gas.SpreadsheetApp.flush = () => { throw new Error('書き込み確定の失敗'); };
    } else {
      const original = gas.readTable_;
      gas.readTable_ = (sheet, headers) => {
        if (events.includes('flush')) throw new Error('読み戻しの失敗');
        return original(sheet, headers);
      };
    }
    assert.throws(() => gas.setup(), /失敗/);
    assert.equal(props.store.PASSCODE, PROPS.PASSCODE);
  }
});

test('setup: 設定の列順を尊重し、既存値と独自列を保ち、空の値だけ移行する', () => {
  const { gas, spreadsheet, props } = authenticatedGas();
  const sheet = spreadsheet.getSheetByName('設定');
  sheet.data = [['値', '項目', 'メモ'], ['既存の値', '共通パスワード', '残す']];
  gas.setup();
  assert.deepEqual(sheet.data[1], ['既存の値', '共通パスワード', '残す']);
  assert.equal(props.store.PASSCODE, undefined);
  props.setProperty('PASSCODE', '移行する値');
  sheet.data[1][0] = ' ';
  gas.setup();
  assert.deepEqual(sheet.data[1], ['移行する値', '共通パスワード', '残す']);
  assert.equal(props.store.PASSCODE, undefined);
});

test('snapshot: ヘッダー名で列を対応付け、削除済みと空行を除外する', () => {
  const { gas, spreadsheet } = authenticatedGas();
  gas.setup();
  const sheet = spreadsheet.getSheetByName('Breedings_test');
  const h = gas.BREEDING_HEADERS_;
  const row = (over) => h.map((name) => (over[name] !== undefined ? over[name] : ''));
  sheet.seed([
    h.slice(),
    row({ id: 'r1', parent1Id: 'FlowerDoll', parent2Id: 'GuardianDog', childId: 'MoonQueen', confirmCount: 1 }),
    row({ id: 'r2', parent1Id: 'FlowerDoll', parent2Id: 'MoonQueen', childId: 'SheepBall', confirmCount: 1, deletedAt: '2026-10-03T00:00:00Z' }),
    row({}),
  ]);
  const res = call(gas, { action: 'snapshot', passcode: PROPS.TEST_PASSCODE });
  assert.equal(res.ok, true);
  assert.deepEqual(res.records.map((r) => r.id), ['r1']);
  // 本番シートは空のまま（テスト用パスワードはテスト用シートにしか届かない）
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
