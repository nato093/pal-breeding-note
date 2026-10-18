// プレイヤーの対応のストア（web/js/player-map.js。server の mapping）。GAS の代わりに開発用 API（dev/mock-api.js）を createApi で通す
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDevelopmentApi } from '../../dev/mock-api.js';
import { createApi, ApiError } from '../../web/js/api.js';
import { safeStorage } from '../../web/js/store.js';
import { createPlayerMapStore, PLAYER_MAP_RETRY_MS } from '../../web/js/player-map.js';

const PASS = '対応の試験用';
const WORLD = 'ABCDEF0123456789ABCDEF0123456789';
const OTHER_WORLD = 'FEDCBA9876543210FEDCBA9876543210';
// ダミーのキャラクターの InstanceId と UID
const KEY_A = 'i:aaaaaaaa-0000-0000-0000-00000000000a';
const KEY_B = 'i:bbbbbbbb-0000-0000-0000-00000000000b';
const KEY_U = 'u:cccccccc-0000-0000-0000-00000000000c';
const COPY = `t.autoBreeding.playerMap.test.${WORLD}`;

function memoryStorage() {
  const map = new Map();
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
}

// 開発用 API（ノートの ID は Alice・Bob）と、そこへ送るストア。calls は送った操作。hold で止めると、書き込みは書く前、読みは読んだ後
//（応答を返す前）で止まる
async function setup({ storage = safeStorage(memoryStorage()), endpoint = 'local', env = 'test', fail = null } = {}) {
  const development = createDevelopmentApi();
  const calls = [];
  const control = { gates: {}, fail };
  const api = createApi({ transport: async (request) => {
    if (!request.action.startsWith('playerMap')) return development(request);
    calls.push(request);
    if (control.fail) return { ok: false, code: control.fail };
    if (request.action === 'playerMapSet') await control.gates.playerMapSet;
    const response = await development(request);
    if (request.action === 'playerMap') await control.gates.playerMap;
    return response;
  } });
  await api.request('signup', PASS, { userId: 'Alice' });
  await api.request('signup', PASS, { userId: 'Bob' });
  const clock = { now: Date.parse('2026-10-18T00:00:00.000Z') };
  const scope = { env };
  const make = (overrides = {}) => createPlayerMapStore({
    request: (action, input) => api.request(action, PASS, { userId: 'Alice', ...input }),
    scope: () => scope.env, endpoint: () => endpoint, storage, namespace: 't', now: () => clock.now, ...overrides,
  });
  const maps = make();
  let emitted = 0;
  maps.subscribe(() => { emitted++; });
  // ほかの PC（Bob）が書いた対応（このストアの送信には数えない）
  const otherPc = (entries) => development({ action: 'playerMapSet', passcode: PASS, userId: 'Bob', worldId: WORLD, entries });
  const hold = (actions = ['playerMap', 'playerMapSet']) => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    for (const action of actions) control.gates[action] = gate;
    return () => {
      for (const action of actions) control.gates[action] = null;
      release();
    };
  };
  return { maps, make, api, calls, clock, scope, control, storage, otherPc, hold, get emitted() { return emitted; } };
}

const actions = (calls) => calls.map((call) => call.action);

test('対応のストア: まだ読めていなければ null。読むと鍵 → ID（外した印は空）を返し、写しは読み込み直しても使える', async () => {
  const t = await setup();
  assert.equal(t.maps.entries('test', WORLD), null);
  await t.otherPc([{ key: KEY_A, userId: 'alice' }, { key: KEY_U, userId: '' }]);
  assert.equal(await t.maps.ensure('test', WORLD), true);
  // ノートの ID の表記にそろえて返る
  assert.deepEqual(t.maps.entries('test', WORLD), { [KEY_A]: 'Alice', [KEY_U]: '' });
  // 小文字・大文字のワールド ID は同じ写し。形の違うワールド ID・環境がなければ null
  assert.deepEqual(t.maps.entries('test', WORLD.toLowerCase()), { [KEY_A]: 'Alice', [KEY_U]: '' });
  assert.equal(t.maps.entries('test', 'W1'), null);
  assert.equal(t.maps.entries('', WORLD), null);
  assert.equal(t.maps.entries('prod', WORLD), null);
  // 写しは環境とワールドごとの 1 つのキー
  assert.deepEqual(JSON.parse(t.storage.get(COPY)).entries, { [KEY_A]: 'Alice', [KEY_U]: '' });
  // 読み込み直した（別のストア）でも、読まずに写しを使う
  const reopened = t.make();
  assert.deepEqual(reopened.entries('test', WORLD), { [KEY_A]: 'Alice', [KEY_U]: '' });
  // 壊れた写し・形の違う鍵は、その分だけ捨てる
  t.storage.set(COPY, JSON.stringify({ v: 1, entries: { [KEY_A]: 'Alice', 'x:1': 'Bob', [KEY_B]: 5, [KEY_U]: 'y'.repeat(21) }, fetchedAt: 1 }));
  assert.deepEqual(t.make().entries('test', WORLD), { [KEY_A]: 'Alice' });
  for (const broken of ['壊れた', '[]', JSON.stringify({ v: 2, entries: {} }), JSON.stringify({ v: 1, entries: [] })]) {
    t.storage.set(COPY, broken);
    assert.equal(t.make().entries('test', WORLD), null, broken);
  }
});

test('対応のストア: maxAge より新しい写しなら読まず、同じワールドを同時に読みに行かない。ログイン中の環境でなければ読まない', async () => {
  const t = await setup();
  const release = t.hold();
  const first = t.maps.ensure('test', WORLD, { maxAge: 60_000 });
  const second = t.maps.ensure('test', WORLD, { maxAge: 60_000 });
  assert.equal(first, second);
  release();
  assert.equal(await first, true);
  assert.deepEqual(actions(t.calls), ['playerMap']);
  // 60 秒たつまでは読まない
  t.clock.now += 59_000;
  assert.equal(await t.maps.ensure('test', WORLD, { maxAge: 60_000 }), false);
  assert.equal(t.calls.length, 1);
  t.clock.now += 2_000;
  assert.equal(await t.maps.ensure('test', WORLD, { maxAge: 60_000 }), true);
  assert.equal(t.calls.length, 2);
  // 別のワールドは別に読む
  await t.maps.ensure('test', OTHER_WORLD, { maxAge: 60_000 });
  assert.equal(t.calls.length, 3);
  // ログアウト中・別の環境・形の違うワールド ID では読まない
  t.scope.env = '';
  assert.equal(await t.maps.ensure('test', WORLD), false);
  t.scope.env = 'prod';
  assert.equal(await t.maps.ensure('test', WORLD), false);
  t.scope.env = 'test';
  assert.equal(await t.maps.ensure('test', 'W1'), false);
  assert.equal(t.calls.length, 3);
});

test('対応のストア: 古い GAS（BAD_ACTION）は接続先と環境ごとに 1 時間覚えて null を返し、読みも書きも送らない。1 時間たったら試し直す', async () => {
  const t = await setup();
  await t.otherPc([{ key: KEY_A, userId: 'Alice' }]);
  await t.maps.ensure('test', WORLD);
  const before = t.emitted;
  // GAS を古い版に戻した
  t.control.fail = 'BAD_ACTION';
  t.clock.now += 1;
  assert.equal(await t.maps.ensure('test', WORLD), false);
  assert.equal(t.maps.entries('test', WORLD), null);
  // GAS で動いていたワールドが前の版に戻ったので知らせる
  assert.equal(t.emitted, before + 1);
  const sent = t.calls.length;
  assert.equal(await t.maps.ensure('test', WORLD), false);
  await assert.rejects(t.maps.set('test', WORLD, [{ key: KEY_B, userId: 'Bob' }]), { code: 'BAD_ACTION' });
  assert.equal(t.calls.length, sent);
  // 別の接続先は覚えた分に入らない
  const local = t.make({ endpoint: () => 'other' });
  assert.deepEqual(local.entries('test', WORLD), { [KEY_A]: 'Alice' });
  // 1 時間たつと試し直す（GAS が新しい版に戻っていれば読める）
  t.control.fail = null;
  t.clock.now += PLAYER_MAP_RETRY_MS;
  assert.equal(await t.maps.ensure('test', WORLD), true);
  assert.deepEqual(t.maps.entries('test', WORLD), { [KEY_A]: 'Alice' });
});

test('対応のストア: 読めなかったときも maxAge の間は読み直さない（描くたび・判定のたびに送らない）。maxAge 0 は読みに行く', async () => {
  const t = await setup();
  t.control.fail = 'SHEET_HEADER';
  assert.equal(await t.maps.ensure('test', WORLD, { maxAge: 15_000 }), false);
  t.clock.now += 14_000;
  assert.equal(await t.maps.ensure('test', WORLD, { maxAge: 15_000 }), false);
  assert.equal(t.calls.length, 1);
  // 別のワールドは別に数える
  assert.equal(await t.maps.ensure('test', OTHER_WORLD, { maxAge: 15_000 }), false);
  assert.equal(t.calls.length, 2);
  t.clock.now += 2_000;
  t.control.fail = null;
  assert.equal(await t.maps.ensure('test', WORLD, { maxAge: 15_000 }), true);
  assert.equal(t.calls.length, 3);
  t.control.fail = 'INTERNAL';
  t.clock.now += 1;
  assert.equal(await t.maps.ensure('test', WORLD), false);
  assert.equal(await t.maps.ensure('test', WORLD), false);
  assert.equal(t.calls.length, 5);
});

test('対応のストア: 応答の環境・ワールドが違えば写しにしない', async () => {
  const t = await setup();
  await t.otherPc([{ key: KEY_A, userId: 'Alice' }]);
  for (const patch of [{ env: 'prod' }, { worldId: OTHER_WORLD }]) {
    const maps = t.make({ request: async (action, input) => ({ ...(await t.api.request(action, PASS, { userId: 'Alice', ...input })), ...patch }) });
    assert.equal(await maps.ensure('test', WORLD), false, JSON.stringify(patch));
    assert.equal(maps.entries('test', WORLD), null);
  }
});

test('対応のストア: 読めない（通信の失敗・SHEET_HEADER）ときは写しのままで、例外にしない', async () => {
  const t = await setup();
  await t.otherPc([{ key: KEY_A, userId: 'Alice' }]);
  await t.maps.ensure('test', WORLD);
  for (const code of ['SHEET_HEADER', 'INTERNAL']) {
    t.control.fail = code;
    t.clock.now += 1;
    assert.equal(await t.maps.ensure('test', WORLD), false);
    assert.deepEqual(t.maps.entries('test', WORLD), { [KEY_A]: 'Alice' });
  }
  // 写しがないワールドは null のまま（前の版の対応を使う）
  assert.equal(await t.maps.ensure('test', OTHER_WORLD), false);
  assert.equal(t.maps.entries('test', OTHER_WORLD), null);
});

test('対応のストア: 書くと先に反映して知らせ、送れたら応答で置き換える。失敗したら元に戻して投げる', async () => {
  const t = await setup();
  await t.otherPc([{ key: KEY_A, userId: 'Alice' }]);
  await t.maps.ensure('test', WORLD);
  const release = t.hold();
  const before = t.emitted;
  const writing = t.maps.set('test', WORLD, [{ key: KEY_B.toUpperCase(), userId: 'bob', playerName: 'ボブ' }]);
  // 送っている間も、選んだ対応で動く（鍵は小文字にそろえる）
  assert.deepEqual(t.maps.entries('test', WORLD), { [KEY_A]: 'Alice', [KEY_B]: 'bob' });
  assert.equal(t.emitted, before + 1);
  release();
  assert.deepEqual(await writing, { changed: 1, skipped: 0 });
  // 応答（GAS が Users の表記にそろえた ID）で置き換える
  assert.deepEqual(t.maps.entries('test', WORLD), { [KEY_A]: 'Alice', [KEY_B]: 'Bob' });
  assert.deepEqual(t.calls.at(-1).entries, [{ key: KEY_B, userId: 'bob', playerName: 'ボブ' }]);
  assert.equal(t.calls.at(-1).userId, 'Alice');
  // 外す（'' は外した印として送る）
  await t.maps.set('test', WORLD, [{ key: KEY_A, userId: '' }]);
  assert.deepEqual(t.maps.entries('test', WORLD), { [KEY_A]: '', [KEY_B]: 'Bob' });
  // 失敗（ノートにない ID）: 元に戻して投げる
  const emitted = t.emitted;
  await assert.rejects(t.maps.set('test', WORLD, [{ key: KEY_A, userId: 'ノートにない' }]), { code: 'VALIDATION' });
  assert.deepEqual(t.maps.entries('test', WORLD), { [KEY_A]: '', [KEY_B]: 'Bob' });
  // 反映したときと戻したときの 2 回
  assert.equal(t.emitted, emitted + 2);
  // 形の違う鍵・ID は送らない（全部違えば送らない）
  const sent = t.calls.length;
  assert.deepEqual(await t.maps.set('test', WORLD, [{ key: 'x:1', userId: 'Bob' }, { key: KEY_A, userId: 3 }]), { changed: 0, skipped: 0 });
  assert.equal(t.calls.length, sent);
  // ログアウト中は送らない
  t.scope.env = '';
  await assert.rejects(t.maps.set('test', WORLD, [{ key: KEY_A, userId: 'Bob' }]), ApiError);
  assert.equal(t.calls.length, sent);
});

test('対応のストア: onlyMissing はすでにある鍵（外した印を含む）を先にも後にも書き換えない', async () => {
  const t = await setup();
  await t.otherPc([{ key: KEY_A, userId: 'Bob' }, { key: KEY_U, userId: '' }]);
  await t.maps.ensure('test', WORLD);
  const release = t.hold();
  const writing = t.maps.set('test', WORLD, [{ key: KEY_A, userId: 'Alice' }, { key: KEY_U, userId: 'Alice' }, { key: KEY_B, userId: 'Alice' }], { onlyMissing: true });
  assert.deepEqual(t.maps.entries('test', WORLD), { [KEY_A]: 'Bob', [KEY_U]: '', [KEY_B]: 'Alice' });
  release();
  assert.deepEqual(await writing, { changed: 1, skipped: 2 });
  assert.equal(t.calls.at(-1).onlyMissing, true);
  assert.deepEqual(t.maps.entries('test', WORLD), { [KEY_A]: 'Bob', [KEY_U]: '', [KEY_B]: 'Alice' });
});

test('対応のストア: 50 件ずつ分けて送り、途中で失敗したら送れなかった分だけ戻す', async () => {
  const t = await setup();
  await t.maps.ensure('test', WORLD);
  const key = (index) => `u:${String(index).padStart(8, '0')}-0000-0000-0000-000000000000`;
  const list = Array.from({ length: 120 }, (_, index) => ({ key: key(index), userId: 'Alice' }));
  assert.deepEqual(await t.maps.set('test', WORLD, list), { changed: 120, skipped: 0 });
  assert.deepEqual(t.calls.filter((call) => call.action === 'playerMapSet').map((call) => call.entries.length), [50, 50, 20]);
  assert.equal(Object.keys(t.maps.entries('test', WORLD)).length, 120);
  // 2 回目の分で失敗: 1 回目の 50 件は書けている
  const again = await setup();
  await again.maps.ensure('test', WORLD);
  let sent = 0;
  const maps = again.make({
    request: async (action, input) => {
      if (action === 'playerMapSet' && ++sent === 2) throw new ApiError('CONNECTION');
      return again.api.request(action, PASS, { userId: 'Alice', ...input });
    },
  });
  await assert.rejects(maps.set('test', WORLD, list.slice(0, 100)), { code: 'CONNECTION' });
  const entries = maps.entries('test', WORLD);
  assert.equal(Object.keys(entries).length, 50);
  assert.ok(Object.hasOwn(entries, key(0)) && !Object.hasOwn(entries, key(50)));
});

test('対応のストア: 送っている間に届いた読み直しにも、送っている対応を重ねる。書いた後に届いた古い読みでは巻き戻さない', async () => {
  const t = await setup();
  await t.maps.ensure('test', WORLD);
  // 書き込みを止めている間に、ほかの PC が別の鍵を書き、読み直した
  const releaseWrite = t.hold(['playerMapSet']);
  const writing = t.maps.set('test', WORLD, [{ key: KEY_A, userId: 'Alice' }]);
  await t.otherPc([{ key: KEY_U, userId: 'Bob' }]);
  t.clock.now += 1;
  assert.equal(await t.maps.ensure('test', WORLD), true);
  assert.deepEqual(t.maps.entries('test', WORLD), { [KEY_A]: 'Alice', [KEY_U]: 'Bob' });
  releaseWrite();
  await writing;
  assert.deepEqual(t.maps.entries('test', WORLD), { [KEY_A]: 'Alice', [KEY_U]: 'Bob' });
  // 読んだ後（書く前の中身）で止めた読みが、書いた後に届いた: 使わない
  const releaseRead = t.hold(['playerMap']);
  t.clock.now += 1;
  const reading = t.maps.ensure('test', WORLD);
  await new Promise((resolve) => setImmediate(resolve));
  await t.maps.set('test', WORLD, [{ key: KEY_B, userId: 'Bob' }]);
  releaseRead();
  assert.equal(await reading, false);
  assert.deepEqual(t.maps.entries('test', WORLD), { [KEY_A]: 'Alice', [KEY_U]: 'Bob', [KEY_B]: 'Bob' });
});

test('対応のストア（Codex のレビュー）: 同じワールドの書き込みは 1 つずつ順に送る。先の書き込みの応答が遅れても、後の対応を写しから消さない', async () => {
  const t = await setup();
  await t.maps.ensure('test', WORLD);
  // 先の書き込みは GAS に書けた後、応答だけが遅れる
  let release;
  const late = new Promise((resolve) => { release = resolve; });
  const sent = [];
  const maps = t.make({
    request: async (action, input) => {
      const response = await t.api.request(action, PASS, { userId: 'Alice', ...input });
      if (action !== 'playerMapSet') return response;
      sent.push(input.entries[0].key);
      if (sent.length === 1) await late;
      return response;
    },
  });
  const first = maps.set('test', WORLD, [{ key: KEY_A, userId: 'Alice' }]);
  const second = maps.set('test', WORLD, [{ key: KEY_B, userId: 'Bob' }]);
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(sent, [KEY_A]);
  assert.deepEqual(maps.entries('test', WORLD), { [KEY_A]: 'Alice', [KEY_B]: 'Bob' });
  release();
  await Promise.all([first, second]);
  assert.deepEqual(sent, [KEY_A, KEY_B]);
  assert.deepEqual(maps.entries('test', WORLD), { [KEY_A]: 'Alice', [KEY_B]: 'Bob' });
  // 先の書き込みが失敗しても、後の書き込みは送る
  const failing = t.make({
    request: async (action, input) => {
      if (action === 'playerMapSet' && input.entries[0].key === KEY_A) throw new ApiError('BUSY');
      return t.api.request(action, PASS, { userId: 'Alice', ...input });
    },
  });
  const a = failing.set('test', WORLD, [{ key: KEY_A, userId: 'Bob' }]);
  const b = failing.set('test', WORLD, [{ key: KEY_U, userId: 'Bob' }]);
  await assert.rejects(a, { code: 'BUSY' });
  await b;
  assert.deepEqual(failing.entries('test', WORLD), { [KEY_A]: 'Alice', [KEY_B]: 'Bob', [KEY_U]: 'Bob' });
});

test('対応のストア（Codex のレビュー）: 送っている間は saving が真で、confirmed の entries は送る前の写し（判定に使う）。settled で書き終わるまで待てる', async () => {
  const t = await setup();
  await t.otherPc([{ key: KEY_A, userId: 'Alice' }]);
  await t.maps.ensure('test', WORLD);
  assert.equal(t.maps.saving('test', WORLD), false);
  const release = t.hold(['playerMapSet']);
  const writing = t.maps.set('test', WORLD, [{ key: KEY_B, userId: 'Bob' }]);
  assert.equal(t.maps.saving('test', WORLD.toLowerCase()), true);
  assert.equal(t.maps.saving('test', OTHER_WORLD), false);
  assert.deepEqual(t.maps.entries('test', WORLD), { [KEY_A]: 'Alice', [KEY_B]: 'Bob' });
  assert.deepEqual(t.maps.entries('test', WORLD, { confirmed: true }), { [KEY_A]: 'Alice' });
  let settled = false;
  const waiting = t.maps.settled('test', WORLD).then(() => { settled = true; });
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  release();
  await writing;
  await waiting;
  assert.equal(t.maps.saving('test', WORLD), false);
  assert.deepEqual(t.maps.entries('test', WORLD, { confirmed: true }), { [KEY_A]: 'Alice', [KEY_B]: 'Bob' });
  // 失敗しても settled は例外にしない。まだ読めていないワールドの confirmed は null
  t.control.fail = 'BUSY';
  await assert.rejects(t.maps.set('test', WORLD, [{ key: KEY_U, userId: 'Bob' }]), { code: 'BUSY' });
  await t.maps.settled('test', WORLD);
  assert.deepEqual(t.maps.entries('test', WORLD, { confirmed: true }), { [KEY_A]: 'Alice', [KEY_B]: 'Bob' });
  assert.equal(t.maps.entries('test', OTHER_WORLD, { confirmed: true }), null);
});

test('対応のストア: 中身が変わったときだけ知らせ、外した購読には知らせない', async () => {
  const t = await setup();
  await t.otherPc([{ key: KEY_A, userId: 'Alice' }]);
  await t.maps.ensure('test', WORLD);
  assert.equal(t.emitted, 1);
  // 同じ中身を読み直しても知らせない
  t.clock.now += 1;
  await t.maps.ensure('test', WORLD);
  assert.equal(t.emitted, 1);
  // ほかの PC が変えた分を読むと知らせる
  await t.otherPc([{ key: KEY_A, userId: 'Bob' }]);
  t.clock.now += 1;
  await t.maps.ensure('test', WORLD);
  assert.equal(t.emitted, 2);
  // 同じ対応を書いても知らせない（先に反映した値と応答が同じ）
  await t.maps.set('test', WORLD, [{ key: KEY_A, userId: 'Bob' }]);
  assert.equal(t.emitted, 2);
  let other = 0;
  const stop = t.maps.subscribe(() => { other++; });
  stop();
  await t.maps.set('test', WORLD, [{ key: KEY_A, userId: 'Alice' }]);
  assert.equal(other, 0);
});

test('対応のストア: 保存できない端末でも、開いている間はメモリの写しで動く', async () => {
  for (const storage of [safeStorage(null), { get: () => null, set() {}, trySet: () => false }]) {
    const t = await setup({ storage });
    await t.otherPc([{ key: KEY_A, userId: 'Alice' }]);
    assert.equal(await t.maps.ensure('test', WORLD, { maxAge: 60_000 }), true);
    assert.deepEqual(t.maps.entries('test', WORLD), { [KEY_A]: 'Alice' });
    // メモリの写しの時刻で maxAge を守る
    assert.equal(await t.maps.ensure('test', WORLD, { maxAge: 60_000 }), false);
    await t.maps.set('test', WORLD, [{ key: KEY_B, userId: 'Bob' }]);
    assert.deepEqual(t.maps.entries('test', WORLD), { [KEY_A]: 'Alice', [KEY_B]: 'Bob' });
  }
});

test('対応のストア: 別のタブが写しを書き換えたら（storage イベント）、変わっていれば知らせる。写しでないキーは扱わない', async () => {
  const storage = safeStorage(memoryStorage());
  const t = await setup({ storage });
  await t.otherPc([{ key: KEY_A, userId: 'Alice' }]);
  await t.maps.ensure('test', WORLD);
  const tab = t.make();
  await t.otherPc([{ key: KEY_A, userId: 'Bob' }]);
  t.clock.now += 1;
  await tab.ensure('test', WORLD);
  const before = t.emitted;
  assert.equal(t.maps.reload(COPY), true);
  assert.equal(t.emitted, before + 1);
  assert.deepEqual(t.maps.entries('test', WORLD), { [KEY_A]: 'Bob' });
  // 変わっていなければ知らせない
  assert.equal(t.maps.reload(COPY), true);
  assert.equal(t.emitted, before + 1);
  for (const key of ['t.autoBreeding.players.test.W1', 'other.autoBreeding.playerMap.test.X', null]) assert.equal(t.maps.reload(key), false);
  // このタブが見ていないワールドの写しは知らせない
  await tab.ensure('test', OTHER_WORLD);
  assert.equal(t.maps.reload(`t.autoBreeding.playerMap.test.${OTHER_WORLD}`), true);
  assert.equal(t.emitted, before + 1);
});
