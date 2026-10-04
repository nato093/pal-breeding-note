import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, safeStorage, cacheKey, shouldApplyResponse } from '../../web/js/store.js';
import { ApiError } from '../../web/js/api.js';
import pals from '../../web/data/pals.js';

const snapshot = (records = [], users = ['登録者']) => ({ records, users, warnings: [], serverTime: '2026-10-04T00:00:00Z' });
const response = (records = [], env = 'test', users) => ({ ok: true, env, api: 'v1', ...snapshot(records, users) });
const account = (records = [], env = 'test') => ({ ...response(records, env), userId: '登録者' });
const record = { id: '登録', parent1Id: pals[0].id, parent2Id: pals[1].id, childId: pals[2].id };
function memoryStorage(credentials = false) {
  const data = new Map(credentials ? [['pal-note.passcode', '入力'], ['pal-note.userId', '登録者']] : []);
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

test('状態: 遅れた全件取得で書き込み後の状態を巻き戻さず、古い users でもログアウトしない', async () => {
  let finish;
  const store = createStore({ storage: memoryStorage(true), api: { request: async (action) => {
    if (action === 'snapshot') return new Promise((resolve) => { finish = resolve; });
    return { ...response(), record, snapshot: snapshot([record]) };
  } } });
  const old = store.refresh();
  await store.mutate('create', { record });
  finish(response([], 'test', []));
  await old;
  assert.deepEqual(store.state.records, [record]);
  assert.equal(store.state.index.byChild.get(record.childId).length, 1);
  assert.equal(store.state.passcode, '入力');
});

for (const action of ['create', 'update', 'merge', 'delete', 'restore']) {
  test(`状態: ${action} の業務エラーは呼び出し元に返し、同期状態と取得済みデータを保つ`, async () => {
    for (const code of ['DUPLICATE', 'PAIR_CONFLICT', 'ID_CONFLICT', 'VALIDATION', 'CONFLICT', 'NOT_FOUND']) {
      for (const previousError of ['', '前回の全件取得に失敗しました']) {
        const error = new ApiError(code, { existing: record });
        const storage = memoryStorage(true);
        const store = createStore({ storage, api: { request: async (sentAction) => {
          if (sentAction === 'snapshot') return response([record]);
          assert.equal(sentAction, action);
          throw error;
        } } });
        await store.refresh();
        store.state.error = previousError;
        const cached = storage.get(cacheKey('test'));
        const errors = [];
        store.subscribe((state) => errors.push(state.error));
        await assert.rejects(store.mutate(action, { id: record.id }), (caught) => caught === error);
        assert.equal(store.state.error, previousError);
        assert.ok(errors.every((message) => message === previousError));
        assert.equal(store.state.loading, false);
        assert.equal(store.state.passcode, '入力');
        assert.deepEqual(store.state.records, [record]);
        assert.equal(storage.get(cacheKey('test')), cached);
      }
    }
  });
}

test('状態: 全件取得の失敗は業務エラーのコードでも同期状態に表示する', async () => {
  for (const code of ['DUPLICATE', 'PAIR_CONFLICT', 'ID_CONFLICT', 'VALIDATION', 'CONFLICT', 'NOT_FOUND']) {
    const error = new ApiError(code);
    const store = createStore({ storage: memoryStorage(true), api: { request: async () => { throw error; } } });
    await assert.rejects(store.refresh(), { code });
    assert.equal(store.state.error, error.message);
    assert.equal(store.state.loading, false);
  }
});

for (const code of ['CONNECTION', 'TIMEOUT', 'RESPONSE', 'INTERNAL', 'AUTH', 'USER_NOT_FOUND']) {
  test(`状態: 全件取得と配合操作の ${code} は同期状態に表示する`, async () => {
    for (const action of ['snapshot', 'create', 'update', 'merge', 'delete', 'restore']) {
      const error = new ApiError(code);
      const store = createStore({ storage: memoryStorage(true), api: { request: async () => { throw error; } } });
      await assert.rejects(action === 'snapshot' ? store.refresh() : store.mutate(action, {}), { code });
      assert.equal(store.state.error, error.message);
      assert.equal(store.state.loading, false);
      if (code === 'AUTH') assert.equal(store.state.passcode, '');
    }
  });
}

for (const action of ['login', 'signup']) {
  test(`認証: ${action} 成功後にだけ登録済み表記とパスワードを保存する`, async () => {
    const storage = memoryStorage();
    let finish;
    const store = createStore({ storage, api: { request: async (sentAction, password, input) => {
      assert.equal(sentAction, action);
      assert.equal(password, '日本語 !');
      assert.equal(input.userId, ' 登録者 ');
      return new Promise((resolve) => { finish = resolve; });
    } } });
    const pending = store[action](' 登録者 ', ' 日本語 ! ');
    assert.equal(storage.get('pal-note.passcode'), null);
    assert.equal(storage.get('pal-note.userId'), null);
    finish(account([record], 'prod'));
    await pending;
    assert.equal(store.state.userId, '登録者');
    assert.deepEqual(store.state.users, ['登録者']);
    assert.equal(storage.get('pal-note.passcode'), '日本語 !');
    assert.equal(storage.get('pal-note.userId'), '登録者');
    const restored = createStore({ storage, api: {} });
    assert.equal(restored.state.cached, true);
    assert.equal(restored.state.env, 'prod');
    assert.deepEqual(restored.state.records, [record]);
    assert.equal(storage.get(cacheKey('test')), null);
  });
}

for (const code of ['AUTH', 'USER_NOT_FOUND', 'USER_EXISTS', 'VALIDATION', 'CONNECTION']) {
  test(`認証: ${code} の入力を保存しない`, async () => {
    const storage = memoryStorage();
    storage.set('pal-note.userId', '前のID');
    const store = createStore({ storage, api: { request: async () => { throw new ApiError(code); } } });
    await assert.rejects(store.signup('失敗するID', '誤入力'), { code });
    assert.equal(storage.get('pal-note.passcode'), null);
    assert.equal(storage.get('pal-note.userId'), '前のID');
    assert.equal(store.state.userId, '前のID');
    assert.equal(store.state.passcode, '');
    assert.equal(store.state.error, new ApiError(code).message);
  });
}

test('キャッシュ: パスワードだけの旧端末、未認証端末、旧形式のキャッシュは利用しない', async () => {
  for (const kind of ['旧端末', '未認証', '旧キャッシュ']) {
    const storage = memoryStorage(true);
    storage.set(cacheKey('prod'), JSON.stringify(snapshot([record])));
    storage.set('pal-note.authenticated', 'prod');
    if (kind === '旧端末') storage.remove('pal-note.userId');
    if (kind === '未認証') storage.remove('pal-note.authenticated');
    if (kind === '旧キャッシュ') {
      const old = snapshot([record]);
      delete old.users;
      storage.set(cacheKey('prod'), JSON.stringify(old));
    }
    let calls = 0;
    const store = createStore({ storage, api: { request: async () => { calls++; return response(); } } });
    assert.deepEqual(store.state.records, []);
    assert.equal(store.state.cached, false);
    if (kind === '旧端末') { await store.refresh(); assert.equal(calls, 0); }
  }
});

test('認証: AUTH でパスワードと両環境のキャッシュを破棄し、ID を残す', async () => {
  const storage = memoryStorage(true);
  let deny = false;
  const api = { request: async () => { if (deny) throw new ApiError('AUTH'); return response([record]); } };
  const store = createStore({ api, storage });
  await store.refresh();
  storage.set(cacheKey('prod'), JSON.stringify(snapshot([record])));
  deny = true;
  await assert.rejects(store.refresh(), { code: 'AUTH' });
  assert.equal(store.state.passcode, '');
  assert.equal(store.state.env, null);
  assert.deepEqual(store.state.records, []);
  assert.deepEqual(store.state.users, []);
  assert.equal(storage.get('pal-note.passcode'), null);
  assert.equal(storage.get(cacheKey('test')), null);
  assert.equal(storage.get(cacheKey('prod')), null);
  assert.equal(storage.get('pal-note.authenticated'), null);
  assert.equal(storage.get('pal-note.userId'), '登録者');
});

for (const action of ['snapshot', 'delete']) {
  test(`認証: ${action} の users から ID が消えたらログアウトする`, async () => {
    const storage = memoryStorage(true);
    const store = createStore({ storage, api: { request: async () => ({ ...response([], 'test', []), record, snapshot: snapshot([], []) }) } });
    await assert.rejects(action === 'snapshot' ? store.refresh() : store.mutate(action, { id: record.id }), { code: 'USER_NOT_FOUND' });
    assert.equal(store.state.passcode, '');
    assert.match(store.state.error, /ID が見つかりません/);
    assert.equal(storage.get('pal-note.userId'), '登録者');
    assert.equal(storage.get(cacheKey('test')), null);
  });
}

test('認証: キャッシュから消えた ID は起動時にログアウトし、比較キーが同じ ID は残す', async () => {
  const storage = memoryStorage(true);
  storage.set('pal-note.authenticated', 'test');
  storage.set(cacheKey('test'), JSON.stringify(snapshot([record], [])));
  const removed = createStore({ storage, api: {} });
  assert.equal(removed.state.passcode, '');
  assert.match(removed.state.error, /ID が見つかりません/);
  storage.set('pal-note.passcode', '入力');
  storage.set('pal-note.userId', 'ＡｂＣ');
  const retained = createStore({ storage, api: { request: async () => response([], 'test', ['abc']) } });
  await retained.refresh();
  assert.equal(retained.state.passcode, '入力');
});

for (const action of ['snapshot', 'login', 'signup']) {
  test(`認証: ${action} の通信中にログアウトしたら遅延応答を破棄する`, async () => {
    let finish;
    const storage = memoryStorage(action === 'snapshot');
    const store = createStore({ storage, api: { request: async () => new Promise((resolve) => { finish = resolve; }) } });
    const pending = action === 'snapshot' ? store.refresh() : store[action]('登録者', '入力');
    store.logout();
    finish(account([record]));
    await assert.rejects(pending, { code: 'AUTH' });
    assert.equal(store.state.passcode, '');
    assert.deepEqual(store.state.records, []);
    assert.equal(storage.get('pal-note.passcode'), null);
    assert.equal(storage.get(cacheKey('test')), null);
    assert.equal(store.state.loading, false);
  });
}

test('認証: 新しいログイン後に届いた旧セッションの AUTH でログアウトしない', async () => {
  let deny;
  const store = createStore({ storage: memoryStorage(true), api: { request: async (action) => {
    if (action === 'snapshot') return new Promise((resolve, reject) => { deny = reject; });
    return account();
  } } });
  const old = store.refresh();
  await store.login('登録者', '新しい入力');
  deny(new ApiError('AUTH'));
  await assert.rejects(old, { code: 'AUTH' });
  assert.equal(store.state.passcode, '新しい入力');
  assert.equal(store.state.error, '');
});

test('復帰時の全件取得: 30 秒以内は抑制し、30 秒経過したら取得する', async () => {
  let time = 0;
  let calls = 0;
  const store = createStore({ storage: memoryStorage(true), now: () => time, api: { request: async () => { calls++; return response(); } } });
  await store.refresh();
  time = 29999;
  await store.refresh({ throttled: true });
  assert.equal(calls, 1);
  time = 30000;
  await store.refresh({ throttled: true });
  assert.equal(calls, 2);
});

test('ストレージ: 読み書きが拒否されてもログイン・ログアウトできる', async () => {
  const storage = safeStorage({ getItem() { throw new Error(); }, setItem() { throw new Error(); }, removeItem() { throw new Error(); } });
  assert.equal(storage.get('key'), null);
  const store = createStore({ storage, api: { request: async () => account() } });
  await store.login('登録者', '入力');
  assert.equal(store.state.userId, '登録者');
  store.logout();
  assert.equal(store.state.passcode, '');
});

test('認証: AUTH のログイン失敗でも旧端末のパスワードとキャッシュを消す', async () => {
  const storage = memoryStorage();
  storage.set('pal-note.passcode', '旧端末の値');
  storage.set(cacheKey('prod'), JSON.stringify(snapshot([record])));
  const store = createStore({ storage, api: { request: async () => { throw new ApiError('AUTH'); } } });
  await assert.rejects(store.login('誤入力ID', '誤入力'), { code: 'AUTH' });
  assert.equal(storage.get('pal-note.passcode'), null);
  assert.equal(storage.get(cacheKey('prod')), null);
});
