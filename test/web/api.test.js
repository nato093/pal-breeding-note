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

test('API（server の participant-ui）: presence は決まった項目だけを送り、常駐の印 resident も残す（presence・ownedSince の両方。なければ付けない）', () => {
  const presence = { pageId: 'page-0001', device: 'device-01', user: 'サーバー', role: 'host', playing: true, canShare: true, resident: true, extra: 'x' };
  const { extra: _extra, ...sent } = presence;
  assert.deepEqual(buildRequest('presence', '入力', { worldId: 'W', presence }).presence, sent);
  assert.deepEqual(buildRequest('ownedSince', '入力', { worldId: 'W', uploadedAt: '', presence }).presence, sent);
  const { resident: _resident, ...page } = sent;
  assert.deepEqual(buildRequest('presence', '入力', { worldId: 'W', presence: { ...page, resident: undefined } }).presence, page);
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

// 読み戻しの境界（core/boundary.js）: 形を確かめた後で、要素ごとに整える
const WORLD = 'ABCDEF0123456789ABCDEF0123456789';
const ownedWorld = (worldId = WORLD, extra = {}) => ({
  worldId, worldName: 'World9', hostName: 'Alice', saveUpdatedAt: '2026-10-05T10:00:00.000Z', uploadedAt: '2026-10-05T10:01:00.000Z',
  uploadedBy: 'ホスト', palCount: 1, players: [], bases: [], farms: null, inGameDay: null, ...extra,
});
const ownedBase = { ok: true, env: 'test', api: 1, serverTime: '2026-10-05T10:02:00.000Z' };
const respond = (body) => createApi({ transport: async () => body });

test('API: 共有のワールドの一覧は、worldId が不正な要素と重複を捨て、正しい応答はそのまま返す', async () => {
  const good = { ...ownedBase, worlds: [ownedWorld()] };
  assert.deepEqual(await respond(good).request('ownedWorlds', '入力'), good);
  const other = 'FEDCBA9876543210FEDCBA9876543210';
  const result = await respond({ ...ownedBase, worlds: [ownedWorld('W1'), ownedWorld(), ownedWorld(WORLD, { worldName: '後の重複' }), ownedWorld(other.toLowerCase())] }).request('ownedWorlds', '入力');
  assert.deepEqual(result.worlds.map((world) => [world.worldId, world.worldName]), [[WORLD, 'World9'], [other, 'World9']]);
});

test('API: 共有の所持パルは、行数を OWNED_MAX_ROWS に限り、配列でない行・重複した個体を捨てる', async () => {
  const { OWNED_FIELDS, OWNED_MAX_ROWS } = await import('../../web/js/core/owned-shared.js');
  const row = (id) => [id, ...Array(OWNED_FIELDS.length - 1).fill('')];
  const good = { ...ownedBase, world: ownedWorld(), columns: OWNED_FIELDS, rows: [row('p1'), row('p2')] };
  // 受け取った生の行の数（捨てる前）は receivedRows に残す（画面が palCount と比べる。share-fetch）
  assert.deepEqual(await respond(good).request('owned', '入力', { worldId: WORLD }), { ...good, receivedRows: 2 });
  const big = await respond({ ...good, rows: Array.from({ length: OWNED_MAX_ROWS + 1 }, (_, i) => row(`p${i}`)) }).request('owned', '入力', { worldId: WORLD });
  assert.deepEqual([big.rows.length, big.receivedRows], [OWNED_MAX_ROWS, OWNED_MAX_ROWS + 1]);
  const broken = await respond({ ...good, rows: [null, 'p', row('p1'), row('p1'), 5, row('p2')] }).request('owned', '入力', { worldId: WORLD });
  assert.deepEqual([broken.rows.map((cells) => cells[0]), broken.receivedRows], [['p1', 'p2'], 6]);
  // 共有されていないワールド（world: null）はそのまま
  assert.equal((await respond({ ...good, world: null, rows: [] }).request('owned', '入力', { worldId: WORLD })).world, null);
  // 形が根本から違う応答は今までどおり受け付けない
  await assert.rejects(respond({ ...good, rows: 'rows' }).request('owned', '入力', { worldId: WORLD }), { code: 'RESPONSE' });
});

test('API: 共有の結果のワールドが読めなければ、応答を受け付けない', async () => {
  const good = { ...ownedBase, stored: true, world: ownedWorld() };
  assert.deepEqual(await respond(good).request('ownedUpload', '入力', { worldId: WORLD }), good);
  await assert.rejects(respond({ ...good, world: ownedWorld('W1') }).request('ownedUpload', '入力', { worldId: WORLD }), { code: 'RESPONSE' });
});

test('API: 全件の記録は、id のない要素・同じ id の後の要素を捨て、正しい応答はそのまま返す', async () => {
  const record = { id: 'r1', parent1Id: 'SheepBall', parent2Id: 'PinkCat', childId: 'CuteFox', parent1Gender: '', parent2Gender: 'F',
    registrant: '登録者', memo: '', confirmCount: 1, createdAt: '2026-10-05T00:00:00.000Z', updatedAt: '2026-10-05T00:00:00.000Z', etag: 'e1' };
  const good = { ok: true, env: 'test', api: 1, records: [record], warnings: [], users: ['登録者'], serverTime: '2026-10-05T00:00:00.000Z' };
  assert.deepEqual(await respond(good).request('snapshot', '入力'), good);
  const broken = await respond({ ...good, records: [null, { parent1Id: 'A' }, record, { ...record, memo: '後の重複' }, 'r'], users: ['登録者', '', '登録者'] }).request('snapshot', '入力');
  assert.deepEqual([broken.records, broken.users], [[record], ['登録者']]);
  // 書き込みの応答に入っている全件も同じく整える
  const created = await respond({ ok: true, env: 'test', api: 1, record, snapshot: { ...good, records: [record, null] } }).request('create', '入力', { opId: 'op', record });
  assert.deepEqual(created.snapshot.records, [record]);
  assert.deepEqual(created.record, record);
});

// プレイヤーの対応（server の mapping。GAS の playerMap・playerMapSet）
const mapKey = (n) => `i:11111111-2222-4333-8444-${String(n).padStart(12, '0')}`;
const mapEntry = (n, extra = {}) => ({ key: mapKey(n), userId: 'Taro', playerName: 'Alice', updatedBy: 'Bob', updatedAt: '2026-10-18T00:00:00.000Z', ...extra });

test('API（mapping）: playerMap・playerMapSet は決まった項目だけを送り、entries の 1 件も key・userId・playerName だけにする', () => {
  assert.deepEqual(buildRequest('playerMap', '入力', { worldId: WORLD, entries: [], debug: 1 }), { action: 'playerMap', passcode: '入力', worldId: WORLD });
  const request = buildRequest('playerMapSet', '入力', {
    userId: 'Bob', worldId: WORLD, onlyMissing: true, debug: 1,
    entries: [{ key: mapKey(1), userId: 'Taro', playerName: 'Alice', updatedBy: 'x', updatedAt: 'y' }, { key: mapKey(2), userId: '' }, null],
  });
  assert.deepEqual(request, {
    action: 'playerMapSet', passcode: '入力', userId: 'Bob', worldId: WORLD, onlyMissing: true,
    entries: [{ key: mapKey(1), userId: 'Taro', playerName: 'Alice' }, { key: mapKey(2), userId: '' }, null],
  });
});

test('API（mapping）: 応答は env・api・serverTime・worldId・entries の配列を確かめ、対応の要素を整える（形の違う要素を捨て、同じ鍵は後）', async () => {
  const good = { ok: true, env: 'test', api: 1, worldId: WORLD, entries: [mapEntry(1), mapEntry(2, { userId: '', playerName: '' })], serverTime: '2026-10-18T00:00:01.000Z' };
  assert.deepEqual(await respond(good).request('playerMap', '入力', { worldId: WORLD }), good);
  const messy = await respond({
    ...good, worldId: WORLD.toLowerCase(),
    entries: [null, mapEntry(1), { key: 'x', userId: 'Taro' }, mapEntry(3, { userId: 5 }), mapEntry(1, { key: mapKey(1).toUpperCase(), userId: 'Hanako', updatedAt: 'いつか' })],
  }).request('playerMap', '入力', { worldId: WORLD });
  assert.deepEqual([messy.worldId, messy.entries], [WORLD, [{ ...mapEntry(1), userId: 'Hanako', updatedAt: '' }]]);
  const set = { ...good, changed: 1, skipped: 2 };
  assert.deepEqual(await respond(set).request('playerMapSet', '入力', { worldId: WORLD }), set);
  assert.deepEqual(await respond({ ...set, changed: 'x', skipped: undefined }).request('playerMapSet', '入力', { worldId: WORLD }), { ...set, changed: 0, skipped: 0 });
  for (const broken of [{ entries: null }, { entries: {} }, { worldId: 'W1' }, { worldId: undefined }, { serverTime: undefined }, { env: 'dev' }, { api: undefined }]) {
    await assert.rejects(respond({ ...good, ...broken }).request('playerMap', '入力', { worldId: WORLD }), { code: 'RESPONSE' }, JSON.stringify(broken));
  }
  // 古い GAS（版 12）は BAD_ACTION（画面は前の localStorage の対応に落とす）。断られた中身もそのまま渡す
  await assert.rejects(respond({ ok: false, code: 'BAD_ACTION' }).request('playerMap', '入力', { worldId: WORLD }), { code: 'BAD_ACTION' });
  const errors = [{ field: 'entries.0.userId', code: 'USER_NOT_FOUND' }];
  await assert.rejects(respond({ ok: false, code: 'VALIDATION', errors }).request('playerMapSet', '入力', { worldId: WORLD }), (error) => {
    assert.deepEqual([error.code, error.response.errors], ['VALIDATION', errors]);
    return true;
  });
});
