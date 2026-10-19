// 常駐の GAS との通信（tools/server-agent/gas-client.mjs）: 送る 1 回ごと（createApi の自動の再送を含む）の確かめと、検証・再送より前の env の確かめ。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGasClient, ENV_MISMATCH } from '../../tools/server-agent/gas-client.mjs';

const PASS = 'dummy-client-pass-0001';
const URL = 'https://example.invalid/exec';
const ok = (extra = {}) => ({ ok: true, env: 'test', api: 1, serverTime: '2026-10-18T05:00:00.000Z', worlds: [], ...extra });

// fetch の代わり（応答は respond(request) が返す本文。Error なら投げる）
function fakeFetch(respond) {
  const calls = [];
  const fetcher = async (url, init) => {
    const request = JSON.parse(init.body);
    calls.push({ url, init, request });
    const body = await respond(request, calls.length);
    if (body instanceof Error) throw body;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { fetcher, calls, actions: () => calls.map((call) => call.request.action) };
}

test('GAS との通信: fetch は POST・credentials omit・期限つきで送り、期限の中断は TIMEOUT', async () => {
  const net = fakeFetch(() => ok());
  const client = createGasClient({ expected: 'test', url: URL, fetcher: net.fetcher });
  assert.equal((await client.api.request('ownedWorlds', PASS)).env, 'test');
  const [{ url, init, request }] = net.calls;
  assert.deepEqual([url, init.method, init.credentials, init.redirect, request.action, request.passcode], [URL, 'POST', 'omit', 'follow', 'ownedWorlds', PASS]);
  assert.ok(init.signal instanceof AbortSignal);
  const slow = createGasClient({ expected: 'test', url: URL, fetcher: async () => { throw new DOMException('timed out', 'TimeoutError'); } });
  await assert.rejects(slow.api.request('ownedWorlds', PASS), { code: 'TIMEOUT' });
});

test('GAS との通信: 送る直前の確かめ（gate）は createApi の自動の再送の前にも効く', async () => {
  // 止めていなければ createApi は BUSY を 1 回だけ再送する
  const busy = fakeFetch(() => ({ ok: false, code: 'BUSY', env: 'test' }));
  await assert.rejects(createGasClient({ expected: 'test', url: URL, fetcher: busy.fetcher }).api.request('ownedWorlds', PASS), { code: 'BUSY' });
  assert.equal(busy.calls.length, 2);
  // 1 回目の応答を待つ間に止めた: 再送は送らない
  let open = true;
  const stopping = fakeFetch(() => {
    open = false;
    return { ok: false, code: 'BUSY', env: 'test' };
  });
  const client = createGasClient({ expected: 'test', url: URL, fetcher: stopping.fetcher });
  client.setGate(() => (open ? null : Object.assign(new Error('止めています（テスト）'), { code: 'AGENT_STOPPED' })));
  await assert.rejects(client.api.request('ownedWorlds', PASS), { code: 'AGENT_STOPPED' });
  assert.equal(stopping.calls.length, 1);
});

test('GAS との通信: 応答の env は検証・再送より前に比べる。失敗の応答でも違えば ENV_MISMATCH で、それ以後は何も送らない', async () => {
  const net = fakeFetch((request) => (request.action === 'ownedUpload' ? { ok: false, code: 'INVALID_COLUMNS', env: 'prod' } : ok()));
  const client = createGasClient({ expected: 'test', url: URL, fetcher: net.fetcher });
  const seen = [];
  client.onMismatch((got) => seen.push(got));
  await client.api.request('ownedWorlds', PASS);
  await assert.rejects(client.api.request('ownedUpload', PASS, { worldId: 'W' }), { code: ENV_MISMATCH });
  await assert.rejects(client.api.request('ownedWorlds', PASS), { code: ENV_MISMATCH });
  assert.deepEqual([net.actions(), seen, client.mismatch()], [['ownedWorlds', 'ownedUpload'], ['prod'], 'prod']);
  // 成功の応答に env がなければ違うとみなす
  const bare = createGasClient({ expected: 'test', url: URL, fetcher: fakeFetch(() => ({ ...ok(), env: undefined })).fetcher });
  await assert.rejects(bare.api.request('ownedWorlds', PASS), { code: ENV_MISMATCH });
  assert.equal(bare.mismatch(), '');
});

test('GAS との通信: 書き込みは env を確かめてから送る（起動の直後・env のない失敗の後は先に読み取り）。確かめられなければ送らない', async () => {
  let env = 'test';
  let failUpload = null;
  const net = fakeFetch((request) => {
    if (request.action === 'ownedUpload' && failUpload) return failUpload;
    return request.action === 'presence' ? { ...ok(), env, presence: [], saved: true } : { ...ok(), env };
  });
  const client = createGasClient({ expected: 'test', url: URL, fetcher: net.fetcher });
  await client.api.request('presence', PASS, { worldId: 'W', presence: {} });
  assert.deepEqual(net.actions(), ['ownedWorlds', 'presence']);
  assert.equal(net.calls[0].request.passcode, PASS);
  // 確かめた後は読み取りを挟まない
  await client.api.request('presence', PASS, { worldId: 'W', presence: {} });
  assert.deepEqual(net.actions().slice(2), ['presence']);
  // 古い GAS の失敗（env がない）の後
  failUpload = { ok: false, code: 'INVALID_COLUMNS' };
  await assert.rejects(client.api.request('ownedUpload', PASS, { worldId: 'W' }), { code: 'INVALID_COLUMNS' });
  env = 'prod';
  net.calls.length = 0;
  await assert.rejects(client.api.request('presence', PASS, { worldId: 'W', presence: {} }), { code: ENV_MISMATCH });
  assert.deepEqual(net.actions(), ['ownedWorlds']);
  // 確かめの読み取りが env のない失敗なら、その code で送らない
  const denied = fakeFetch((request) => (request.action === 'ownedWorlds' ? { ok: false, code: 'AUTH' } : ok()));
  const fresh = createGasClient({ expected: 'test', url: URL, fetcher: denied.fetcher });
  await assert.rejects(fresh.api.request('presence', PASS, { worldId: 'W', presence: {} }), { code: 'AUTH' });
  assert.deepEqual(denied.actions(), ['ownedWorlds']);
});
