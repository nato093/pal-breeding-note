import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, safeStorage, cacheKey, shouldApplyResponse } from '../../web/js/store.js';
import { ApiError } from '../../web/js/api.js';
import pals from '../../web/data/pals.js';

const snapshot = (records = []) => ({ records, warnings: [], serverTime: '2026-10-04T00:00:00Z' });
const response = (records = [], env = 'test') => ({ ok: true, env, api: 'v1', ...snapshot(records) });
const record = { id: '登録', parent1Id: pals[0].id, parent2Id: pals[1].id, childId: pals[2].id };
function memoryStorage() {
  const data = new Map();
  return safeStorage({ getItem: (key) => data.get(key), setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) });
}

test('連番: 適用済みより新しい応答だけ採用する', () => {
  assert.equal(shouldApplyResponse(3, 2), true);
  assert.equal(shouldApplyResponse(2, 2), false);
  assert.equal(shouldApplyResponse(1, 2), false);
});

test('キャッシュ: 環境とローカル用名前空間を分離する', () => {
  assert.notEqual(cacheKey('prod'), cacheKey('test'));
  assert.notEqual(cacheKey('test'), cacheKey('test', 'pal-note.local'));
  assert.throws(() => cacheKey('unknown'), /環境/);
});

test('状態: 遅れた全件取得で書き込み後の状態を巻き戻さない', async () => {
  let finish;
  const store = createStore({ api: { request: async (action) => {
    if (action === 'snapshot') return new Promise((resolve) => { finish = resolve; });
    return { ...response(), record, snapshot: snapshot([record]) };
  } } });
  store.setPasscode('入力');
  const old = store.refresh();
  await store.mutate('create', { record });
  finish(response([]));
  await old;
  assert.deepEqual(store.state.records, [record]);
  assert.equal(store.state.index.byChild.get(record.childId).length, 1);
});

test('キャッシュ: 認証成功した端末だけ起動直後に利用する', async () => {
  const storage = memoryStorage();
  const api = { request: async () => response([record], 'prod') };
  storage.set(cacheKey('test'), JSON.stringify(snapshot([{ id: '別環境' }])));
  const store = createStore({ api, storage });
  store.setPasscode('入力');
  assert.deepEqual(store.state.records, []);
  await store.refresh();
  const restored = createStore({ api, storage });
  assert.equal(restored.state.env, 'prod');
  assert.equal(restored.state.cached, true);
  assert.deepEqual(restored.state.records, [record]);
  assert.equal(storage.get('pal-note.authenticated'), 'prod');
});

test('認証: AUTH でパスコードと両環境のキャッシュを破棄する', async () => {
  const storage = memoryStorage();
  let deny = false;
  const api = { request: async () => { if (deny) throw new ApiError('AUTH'); return response([record]); } };
  const store = createStore({ api, storage });
  store.setPasscode('入力');
  await store.refresh();
  storage.set(cacheKey('prod'), JSON.stringify(snapshot([record])));
  deny = true;
  await assert.rejects(store.refresh(), { code: 'AUTH' });
  assert.equal(store.state.passcode, '');
  assert.equal(store.state.env, null);
  assert.deepEqual(store.state.records, []);
  assert.equal(storage.get('pal-note.passcode'), null);
  assert.equal(storage.get(cacheKey('test')), null);
  assert.equal(storage.get(cacheKey('prod')), null);
  assert.equal(storage.get('pal-note.authenticated'), null);
});

test('認証: 入れ直し前に送った応答を新しいセッションに適用しない', async () => {
  let finish;
  const store = createStore({ api: { request: async () => new Promise((resolve) => { finish = resolve; }) } });
  store.setPasscode('前の入力');
  const pending = store.refresh();
  store.setPasscode('新しい入力');
  finish(response([record]));
  await assert.rejects(pending, { code: 'AUTH' });
  assert.equal(store.state.passcode, '新しい入力');
  assert.deepEqual(store.state.records, []);
});

test('復帰時の全件取得: 30 秒以内は抑制し、30 秒経過したら取得する', async () => {
  let time = 0;
  let calls = 0;
  const store = createStore({ now: () => time, api: { request: async () => { calls++; return response(); } } });
  store.setPasscode('入力');
  await store.refresh();
  time = 29999;
  await store.refresh({ throttled: true });
  assert.equal(calls, 1);
  time = 30000;
  await store.refresh({ throttled: true });
  assert.equal(calls, 2);
});

test('ストレージ: 読み書きが拒否されても例外にしない', () => {
  const storage = safeStorage({ getItem() { throw new Error(); }, setItem() { throw new Error(); }, removeItem() { throw new Error(); } });
  assert.equal(storage.get('key'), null);
  assert.doesNotThrow(() => storage.set('key', 'value'));
  assert.doesNotThrow(() => storage.remove('key'));
});
