import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi, ApiError, errorMessage, buildRequest } from '../../web/js/api.js';

const snapshot = { records: [], warnings: [], users: [], serverTime: '2026-10-04T00:00:00Z' };
const success = { ok: true, env: 'test', api: 'v1', record: { id: 'A' }, snapshot };

test('API: エラーコードを利用者向けの日本語へ変換する', () => {
  assert.equal(errorMessage('CONNECTION'), 'サーバに接続できません');
  for (const code of ['USER_NOT_FOUND', 'USER_EXISTS', 'AUTH', 'CONFIG', 'BUSY', 'INTERNAL', 'SHEET_HEADER', 'BAD_REQUEST', 'DUPLICATE', 'PAIR_CONFLICT',
    'ID_CONFLICT', 'VALIDATION', 'CONFLICT', 'NOT_FOUND', 'TIMEOUT', 'RESPONSE', 'UNKNOWN']) {
    assert.match(errorMessage(code), /[ぁ-んァ-ヶ一-龠]/);
    assert.doesNotMatch(errorMessage(code), new RegExp(code));
  }
});

test('API: 未知の項目、サーバ管理項目、undefined をリクエストに入れない', () => {
  const request = buildRequest('update', '入力', { opId: 'op', id: 'id', expectedEtag: 'tag', debug: true, allowDifferentChild: undefined,
    record: { id: '余計', parent1Id: 'A', memo: undefined, confirmCount: 999, etag: '余計' } });
  assert.deepEqual(request, { action: 'update', passcode: '入力', opId: 'op', id: 'id', expectedEtag: 'tag', record: { parent1Id: 'A' } });
  assert.deepEqual(buildRequest('create', '入力', { opId: 'op', record: { id: 'id', childId: 'B' } }).record, { id: 'id', childId: 'B' });
});

test('API: POST、JSON 文字列、Cookie 無送信、転送追従で送る', async () => {
  const calls = [];
  const api = createApi({ url: 'https://script.google.com/example', fetcher: async (...args) => {
    calls.push(args);
    return { ok: true, json: async () => success };
  } });
  await api.request('delete', '入力', { opId: '同一操作', id: 'A' });
  const [url, options] = calls[0];
  assert.equal(url, 'https://script.google.com/example');
  assert.equal(options.method, 'POST');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.redirect, 'follow');
  assert.equal(JSON.parse(options.body).opId, '同一操作');
  assert.ok(options.signal instanceof AbortSignal);
});

for (const failure of ['CONNECTION', 'BUSY', 'JSON', 'ENV', 'SNAPSHOT']) {
  test(`API: ${failure} は同じ opId で一度だけ再送する`, async () => {
    const bodies = [];
    const api = createApi({ url: 'https://script.google.com/example', fetcher: async (url, options) => {
      bodies.push(options.body);
      if (bodies.length > 1) return { ok: true, json: async () => success };
      if (failure === 'CONNECTION') throw new TypeError('接続失敗');
      return { ok: true, json: async () => {
        if (failure === 'JSON') throw new SyntaxError('JSON ではない');
        if (failure === 'BUSY') return { ok: false, code: 'BUSY' };
        if (failure === 'ENV') return { ...success, env: undefined };
        return { ...success, snapshot: undefined };
      } };
    } });
    await api.request('delete', '入力', { opId: '同一操作', id: 'A' });
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0], bodies[1]);
  });
}

test('API: 35 秒の代わりに短い期限を注入し、本文読み取りのタイムアウトも再送する', async () => {
  let calls = 0;
  let firstSignal;
  const api = createApi({ url: 'https://script.google.com/example', timeoutMs: 5, fetcher: async (url, options) => {
    calls++;
    if (calls > 1) return { ok: true, json: async () => success };
    firstSignal = options.signal;
    return { ok: true, json: async () => new Promise(() => {}) };
  } });
  await api.request('delete', '入力', { opId: '同一操作', id: 'A' });
  assert.equal(calls, 2);
  assert.equal(firstSignal.aborted, true);
});

test('API: 通信失敗が続いても二回まで、AUTH は再送しない', async () => {
  let calls = 0;
  const offline = createApi({ url: 'https://script.google.com/example', fetcher: async () => { calls++; throw new TypeError(); } });
  await assert.rejects(offline.request('snapshot', '入力'), (error) => error.message === 'サーバに接続できません');
  assert.equal(calls, 2);
  calls = 0;
  const auth = createApi({ transport: async () => { calls++; return { ok: false, code: 'AUTH' }; } });
  await assert.rejects(auth.request('snapshot', '入力'), (error) => error instanceof ApiError && error.code === 'AUTH');
  assert.equal(calls, 1);
});

for (const action of ['login', 'signup']) {
  test(`API: ${action} は ID を送り、snapshot と登録済み表記を受け取る`, async () => {
    const opId = crypto.randomUUID();
    const api = createApi({ transport: async (request) => {
      assert.deepEqual(request, { action, passcode: '入力', userId: '入力ID', ...(action === 'signup' ? { opId } : {}) });
      return { ok: true, env: 'test', api: 1, userId: '入力ID', ...snapshot, users: ['入力ID'] };
    } });
    const result = await api.request(action, '入力', { userId: '入力ID', extra: true, opId });
    assert.equal(result.userId, '入力ID');
    assert.deepEqual(result.users, ['入力ID']);
  });
  for (const change of [{ userId: 123 }, { userId: undefined }, { users: undefined }, { users: [123] }]) {
    test(`API: ${action} の userId・users の不正応答を拒否する ${JSON.stringify(change)}`, async () => {
      const api = createApi({ transport: async () => ({ ok: true, env: 'test', api: 1, userId: 'ID', ...snapshot, ...change }) });
      await assert.rejects(api.request(action, '入力', { userId: 'ID' }), { code: 'RESPONSE' });
    });
  }
}

for (const action of ['snapshot', 'create']) {
  test(`API: ${action} でも users が必要`, async () => {
    const incomplete = { records: [], warnings: [], serverTime: '' };
    const api = createApi({ transport: async () => ({ ...success, ...incomplete, snapshot: incomplete }) });
    await assert.rejects(api.request(action, '入力'), { code: 'RESPONSE' });
  });
}

test('API: 廃止した確認操作を送信しない', () => {
  assert.throws(() => buildRequest('confirm', '入力', { id: 'A' }), { code: 'BAD_REQUEST' });
});

test('API: signup の自動再送は生成した UUID を再利用し、次の登録操作では新しく生成する', async () => {
  const requests = [];
  const api = createApi({ transport: async (request) => {
    requests.push({ ...request });
    if (requests.length === 1) throw new TypeError('応答が欠落しました');
    return { ok: true, env: 'test', api: 1, userId: request.userId, ...snapshot, users: [request.userId] };
  } });
  await api.request('signup', '入力', { userId: '最初のID' });
  assert.equal(requests.length, 2);
  assert.match(requests[0].opId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.deepEqual(requests[0], requests[1]);
  await api.request('signup', '入力', { userId: '次のID' });
  assert.notEqual(requests[2].opId, requests[0].opId);
});
