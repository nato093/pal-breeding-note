import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGas, FakeSpreadsheet } from './harness.js';
import { createApi } from '../../web/js/api.js';
import { createStore } from '../../web/js/store.js';

const PROPS = { PASSCODE: '本番の設定 !', TEST_PASSCODE: '試験用の設定 !' };
const plain = (value) => JSON.parse(JSON.stringify(value));
function fixture(options = {}) {
  const env = createGas({ properties: PROPS, spreadsheet: new FakeSpreadsheet({ stripQuotes: true }), ...options });
  env.gas.setup();
  env.events.length = 0;
  env.call = (action, input = {}, passcode = PROPS.TEST_PASSCODE) => plain(env.gas.handleRequest_(JSON.stringify({
    action, passcode, ...(action === 'signup' ? { opId: crypto.randomUUID() } : {}), ...input,
  })));
  env.users = env.spreadsheet.getSheetByName('Users_test');
  return env;
}

test('アカウント: 登録直後にログインでき、snapshot と同じ内容を返す', () => {
  const env = fixture();
  const signup = env.call('signup', { userId: '  登録\u0000者  ' });
  assert.equal(signup.ok, true);
  assert.equal(signup.env, 'test');
  assert.equal(signup.userId, '登録者');
  assert.deepEqual(signup.users, ['登録者']);
  assert.deepEqual(signup.records, []);
  assert.deepEqual(signup.warnings, []);
  assert.equal(typeof signup.serverTime, 'string');
  assert.equal('snapshot' in signup, false);
  assert.equal(env.users.data[1][0], '登録者');
  assert.match(env.users.data[1][1], /^\d{4}-\d{2}-\d{2}T.*Z$/);
  const login = env.call('login', { userId: '登録者' });
  assert.equal(login.userId, '登録者');
  for (const field of ['records', 'warnings', 'users']) assert.deepEqual(login[field], env.call('snapshot')[field]);
  assert.equal(env.cache.puts.length, 1);
  assert.equal(env.spreadsheet.getSheetByName('Log_test').getLastRow(), 1);
});

for (const [saved, login] of [['ＡｂＣ１２', 'abc12'], ['AbC', 'ＡＢＣ'], ['ｶﾀｶﾅ', 'カタカナ'], ['が', 'か\u3099']]) {
  test(`ID比較: ${saved} と ${login} は同一 ID、登録済み表記を返す`, () => {
    const env = fixture();
    assert.equal(env.call('signup', { userId: saved }).ok, true);
    assert.equal(env.call('login', { userId: login }).userId, saved);
    const before = JSON.stringify(env.users.data);
    assert.deepEqual(env.call('signup', { userId: login }), { ok: false, code: 'USER_EXISTS' });
    assert.equal(JSON.stringify(env.users.data), before);
  });
}

for (const action of ['login', 'signup']) {
  for (const [value, code] of [['', 'REQUIRED'], [' \u0000\t ', 'REQUIRED'], ['あ'.repeat(21), 'TOO_LONG'], [null, 'REQUIRED'], [123, 'INVALID_TYPE']]) {
    test(`ID検証: ${action} の ${JSON.stringify(value)} は ${code}`, () => {
      const env = fixture();
      const before = JSON.stringify(env.users.data);
      assert.deepEqual(env.call(action, { userId: value }), { ok: false, code: 'VALIDATION', errors: [{ field: 'userId', code }] });
      assert.equal(JSON.stringify(env.users.data), before);
    });
  }
  test(`アカウント: ${action} は未知の項目を拒否し、認証を先に行う`, () => {
    const env = fixture();
    assert.deepEqual(env.call(action, { userId: 'ID', extra: true }), {
      ok: false, code: 'VALIDATION', errors: [{ field: 'extra', code: 'UNKNOWN_FIELD' }],
    });
    assert.deepEqual(env.call(action, { userId: '', extra: true }, '不正'), { ok: false, code: 'AUTH' });
    env.spreadsheet.getSheetByName('設定').data[1][1] = '';
    assert.deepEqual(env.call(action, { userId: 'ID' }), { ok: false, code: 'CONFIG' });
    assert.equal(env.users.getLastRow(), 1);
  });
}

test('ID検証: 20文字と制御文字を含む入力は除去後の文字数で判定する', () => {
  const env = fixture();
  assert.equal(env.call('signup', { userId: ` ${'あ'.repeat(20)}\u007f ` }).ok, true);
  assert.equal(env.call('signup', { userId: '😀'.repeat(10) }).ok, true);
  assert.equal(env.call('signup', { userId: `${'😀'.repeat(10)}あ` }).errors[0].code, 'TOO_LONG');
  assert.equal(env.call('signup', { userId: '😀'.repeat(11) }).errors[0].code, 'TOO_LONG');
});

test('アカウント: 未登録なら USER_NOT_FOUND、本番とテストの ID を分離する', () => {
  const env = fixture();
  assert.deepEqual(env.call('login', { userId: '未登録' }), { ok: false, code: 'USER_NOT_FOUND' });
  assert.equal(env.call('signup', { userId: '試験用ID' }).ok, true);
  assert.equal(env.call('login', { userId: '試験用ID' }, PROPS.PASSCODE).code, 'USER_NOT_FOUND');
  assert.equal(env.call('signup', { userId: '本番ID' }, PROPS.PASSCODE).ok, true);
  assert.deepEqual(env.call('snapshot').users, ['試験用ID']);
  assert.deepEqual(env.call('snapshot', {}, PROPS.PASSCODE).users, ['本番ID']);
});

test('アカウント: signup の重複検査と追記をロック内で行い、取得できなければ BUSY', () => {
  const env = fixture();
  const original = env.gas.readUsers_;
  env.gas.readUsers_ = (name) => { assert.equal(env.events[0], 'tryLock'); return original(name); };
  env.call('signup', { userId: 'ID' });
  assert.deepEqual(env.events, ['tryLock', 'flush', 'cachePut', 'flush', 'releaseLock']);
  env.events.length = 0;
  assert.equal(env.call('signup', { userId: 'ＩＤ' }).code, 'USER_EXISTS');
  assert.deepEqual(env.events, ['tryLock', 'flush', 'releaseLock']);
  const busy = fixture({ lockAvailable: false });
  assert.equal(busy.call('signup', { userId: 'ID' }).code, 'BUSY');
  assert.equal(busy.users.getLastRow(), 1);
  assert.equal(busy.call('login', { userId: 'ID' }).code, 'USER_NOT_FOUND');
});

for (const prefix of ['=', '+', '-', '@', "'"]) {
  test(`アカウント: ${prefix} 始まりの ID は quoteForSheet 経由で保存・表示する`, () => {
    const env = fixture();
    const userId = `${prefix}名前`;
    assert.equal(env.call('signup', { userId }).userId, userId);
    assert.equal(env.users.data[1][0], `'${userId}`);
    assert.equal(env.call('login', { userId }).userId, userId);
    assert.deepEqual(env.call('snapshot').users, [userId]);
    assert.equal(env.call('signup', { userId }).code, 'USER_EXISTS');
  });
}

test('アカウント: Users の列順に対応し、登録順を保持し、削除を snapshot に反映する', () => {
  const env = fixture();
  env.users.data = [['独自列', 'createdAt', 'userId'], ['残す', '既存の日付', '既存ID']];
  assert.equal(env.call('signup', { userId: '追加ID' }).ok, true);
  assert.equal(env.users.data[2][2], '追加ID');
  assert.deepEqual(env.call('snapshot').users, ['既存ID', '追加ID']);
  env.users.deleteRows(2, 1);
  assert.deepEqual(env.call('snapshot').users, ['追加ID']);
  assert.equal(env.call('login', { userId: '既存ID' }).code, 'USER_NOT_FOUND');
  const writes = env.users.log.slice(-2);
  assert.deepEqual(writes.map((entry) => entry.op), ['setNumberFormat', 'setValues']);
  assert.equal(writes[0].fmt, '@');
});

test('snapshot: mutation とキャッシュ再送の応答も最新の users を含む', () => {
  const env = fixture();
  env.call('signup', { userId: '最初のID' });
  const opId = '00000000-0000-0000-0000-000000000001';
  const record = { id: opId, parent1Id: 'FlowerDoll', parent2Id: 'GuardianDog', childId: 'MoonQueen' };
  const created = env.call('create', { opId, record });
  assert.deepEqual(created.snapshot.users, ['最初のID']);
  env.call('signup', { userId: '次のID' });
  assert.deepEqual(env.call('create', { opId, record }).snapshot.users, ['最初のID', '次のID']);
  const logged = JSON.stringify([env.logs, env.spreadsheet.getSheetByName('Log_test').data, env.cache.get(`op:test:${opId}`), env.cache.puts]);
  assert.equal(logged.includes(PROPS.TEST_PASSCODE), false);
  assert.equal(logged.includes(PROPS.PASSCODE), false);
});

test('setup: 記号・日本語の旧パスワードも移行して完全一致で認証する', () => {
  const env = fixture({ properties: { PASSCODE: '=日本語 !', TEST_PASSCODE: PROPS.TEST_PASSCODE } });
  assert.equal(env.spreadsheet.getSheetByName('設定').data[1][1], "'=日本語 !");
  assert.equal(env.gas.authenticate_('=日本語 !').env, 'prod');
  assert.equal(typeof env.gas.rotatePasscode, 'undefined');
});

test('認証: セルの変更を次のリクエストから反映し、旧 PASSCODE を参照しない', () => {
  const env = fixture();
  const sheet = env.spreadsheet.getSheetByName('設定');
  env.props.setProperty('PASSCODE', '旧プロパティの値');
  sheet.data[1][1] = '新しい値 !';
  assert.equal(env.call('ping', {}, '新しい値 !').env, 'prod');
  assert.equal(env.call('ping', {}, PROPS.PASSCODE).code, 'AUTH');
  assert.equal(env.call('ping', {}, '旧プロパティの値').code, 'AUTH');
  sheet.data[0].push('値');
  assert.deepEqual(env.call('ping'), { ok: false, code: 'CONFIG' });
  assert.deepEqual(env.logs.error, []);
});

test('setup: 値が後方の列にあっても、その列全体をテキストにする', () => {
  const env = fixture();
  const sheet = env.spreadsheet.getSheetByName('設定');
  sheet.data = [['独自列1', '項目', '独自列2', '値'], ['維持', '共通パスワード', '維持', '001234']];
  sheet.formats.length = 0;
  env.gas.setup();
  assert.ok(sheet.formats.some((format) => format.col === 4 && format.numRows === sheet.getMaxRows() && format.numCols === 1 && format.fmt === '@'));
  assert.deepEqual(sheet.data[1], ['維持', '共通パスワード', '維持', '001234']);
});

test('アカウント: 応答用データや Users ヘッダーが不正なら signup は追記しない', () => {
  for (const kind of ['Breedings_test', 'Users_test']) {
    const env = fixture();
    const sheet = env.spreadsheet.getSheetByName(kind);
    sheet.data[0].pop();
    const before = JSON.stringify(env.users.data);
    assert.equal(env.call('signup', { userId: '登録しないID' }).code, 'SHEET_HEADER');
    assert.equal(JSON.stringify(env.users.data), before);
    assert.deepEqual(env.events.slice(-2), ['flush', 'releaseLock']);
  }
});

test('snapshot: Users のヘッダー不備を配合の書き込み前に検出する', () => {
  const env = fixture();
  env.users.data[0].pop();
  const record = { id: '00000000-0000-0000-0000-000000000001', parent1Id: 'FlowerDoll', parent2Id: 'GuardianDog', childId: 'MoonQueen' };
  const result = env.call('create', { opId: record.id, record });
  assert.equal(result.code, 'SHEET_HEADER');
  assert.equal(env.spreadsheet.getSheetByName('Breedings_test').getLastRow(), 1);
  assert.equal(env.spreadsheet.getSheetByName('Log_test').getLastRow(), 1);
  assert.equal(env.cache.puts.length, 0);
});

test('アカウント: signup の追記成功後に応答が欠落しても、同じ opId の再送でログインを完了する', async () => {
  const env = fixture();
  const requests = [];
  const record = { id: crypto.randomUUID(), parent1Id: 'FlowerDoll', parent2Id: 'GuardianDog', childId: 'MoonQueen' };
  const api = createApi({ transport: async (request) => {
    requests.push({ ...request });
    const response = plain(env.gas.handleRequest_(JSON.stringify(request)));
    if (requests.length === 1) {
      assert.equal(response.ok, true);
      assert.deepEqual(response.users, ['再送するID']);
      env.call('signup', { userId: '別のID' });
      env.call('create', { opId: crypto.randomUUID(), record });
      throw new TypeError('応答の受信が失敗しました');
    }
    return response;
  } });
  const store = createStore({ api });
  const result = await store.signup('再送するID', PROPS.TEST_PASSCODE);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1], requests[0]);
  assert.match(requests[0].opId, /^[0-9a-f-]{36}$/);
  assert.equal(result.userId, '再送するID');
  assert.deepEqual(result.users, ['再送するID', '別のID']);
  assert.deepEqual(result.records.map((item) => item.id), [record.id]);
  assert.equal(env.users.getLastRow(), 3);
  assert.equal(store.state.userId, '再送するID');
  assert.equal(store.state.passcode, PROPS.TEST_PASSCODE);
  assert.deepEqual(JSON.parse(env.cache.get(`op:test:${requests[0].opId}`)), { userId: '再送するID' });
  assert.deepEqual(env.cache.puts[0], { key: `op:test:${requests[0].opId}`, seconds: 21600 });
  assert.deepEqual(env.events.slice(0, 5), ['tryLock', 'flush', 'cachePut', 'flush', 'releaseLock']);
});

test('アカウント: signup の再送は最新の warnings・serverTime を返し、opId の英字大小と環境を扱う', () => {
  const env = fixture();
  const opId = 'abcdefab-abcd-abcd-abcd-abcdefabcdef';
  assert.equal(env.call('signup', { userId: '試験ID', opId }).ok, true);
  const original = env.gas.snapshot_;
  env.gas.snapshot_ = (name) => Object.assign(original(name), { serverTime: '最新の時刻', warnings: [{ code: 'DUPLICATE_RECORD', id: '最新' }] });
  const replay = env.call('signup', { userId: '試験ID', opId: opId.toUpperCase() });
  assert.equal(replay.userId, '試験ID');
  assert.equal(replay.serverTime, '最新の時刻');
  assert.deepEqual(replay.warnings, [{ code: 'DUPLICATE_RECORD', id: '最新' }]);
  assert.equal(env.users.getLastRow(), 2);
  assert.equal(env.call('signup', { userId: '本番ID', opId }, PROPS.PASSCODE).userId, '本番ID');
  assert.equal(env.call('signup', { userId: '試験ID' }).code, 'USER_EXISTS');
  assert.equal(env.cache.puts.length, 2);
});

test('アカウント: signup は無効な opId を拒否し、login は opId を受け付けない', () => {
  const env = fixture();
  for (const opId of [undefined, '', '不正', 123, {}]) {
    assert.deepEqual(env.call('signup', { userId: 'ID', opId }), {
      ok: false, code: 'VALIDATION', errors: [{ field: 'opId', code: 'INVALID_UUID' }],
    });
  }
  assert.deepEqual(env.call('login', { userId: 'ID', opId: crypto.randomUUID() }), {
    ok: false, code: 'VALIDATION', errors: [{ field: 'opId', code: 'UNKNOWN_FIELD' }],
  });
  assert.equal(env.users.getLastRow(), 1);
  assert.equal(env.cache.puts.length, 0);
});

test('アカウント: signup の失敗はキャッシュせず、同じ opId で修正して登録できる', () => {
  const env = fixture();
  env.call('signup', { userId: '既存ID' });
  const opId = crypto.randomUUID();
  assert.equal(env.call('signup', { userId: '既存ID', opId }).code, 'USER_EXISTS');
  assert.equal(env.cache.get(`op:test:${opId}`), null);
  assert.equal(env.call('signup', { userId: '新しいID', opId }).ok, true);
});

for (const action of ['login', 'signup']) {
  test(`アカウント: ${action} は Users の全行を一回だけ読み、存在判定と応答に共用する`, () => {
    const env = fixture();
    env.call('signup', { userId: '登録済みID' });
    const original = env.gas.readUsers_;
    let reads = 0;
    env.gas.readUsers_ = (name) => { reads++; return original(name); };
    const result = env.call(action, { userId: action === 'signup' ? '追加ID' : '登録済みID' });
    assert.equal(result.ok, true);
    assert.equal(reads, 1);
    assert.deepEqual(result.users, action === 'signup' ? ['登録済みID', '追加ID'] : ['登録済みID']);
    reads = 0;
    assert.equal(env.call(action, { userId: action === 'signup' ? '登録済みID' : '未登録ID' }).ok, false);
    assert.equal(reads, 1);
  });
}

test('ID検証: UTF-16 で20文字の絵文字 ID を登録者として配合に保存できる', () => {
  const env = fixture();
  const userId = '😀'.repeat(10);
  assert.equal(env.call('signup', { userId }).ok, true);
  const record = { id: crypto.randomUUID(), parent1Id: 'FlowerDoll', parent2Id: 'GuardianDog', childId: 'MoonQueen', registrant: userId };
  const result = env.call('create', { opId: crypto.randomUUID(), record });
  assert.equal(result.ok, true);
  assert.equal(result.record.registrant, userId);
});
