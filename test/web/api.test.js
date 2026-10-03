import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi, ApiError, errorMessage, buildRequest } from '../../web/js/api.js';

const snapshot = { records: [], warnings: [], serverTime: '2026-10-04T00:00:00Z' };
const success = { ok: true, env: 'test', api: 'v1', record: { id: 'A' }, snapshot };

test('API: エラーコードを利用者向けの日本語へ変換する', () => {
  assert.equal(errorMessage('CONNECTION'), 'サーバに接続できません');
  for (const code of ['AUTH', 'CONFIG', 'BUSY', 'INTERNAL', 'SHEET_HEADER', 'BAD_REQUEST', 'DUPLICATE', 'PAIR_CONFLICT',
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
  await api.request('confirm', '入力', { opId: '同一操作', id: 'A' });
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
    await api.request('confirm', '入力', { opId: '同一操作', id: 'A' });
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
  await api.request('confirm', '入力', { opId: '同一操作', id: 'A' });
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
