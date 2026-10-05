import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOwnedStore, idbPersist } from '../../web/js/owned.js';
import { safeStorage } from '../../web/js/store.js';
import { createDevelopmentApi } from '../../dev/mock-api.js';

function memoryStorage() {
  const map = new Map();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key), map };
}

const WORLD_A = '4A431AC14B58A7E31A76B2A991F79FE8';
const WORLD_B = '88DC480846CA4D73A670DA90D96950DC';

const snapshot = (n, name = 'テスト') => ({
  version: 1, world: { name, hostName: 'Alice' }, players: [{ uid: 'u1', name: 'Alice', level: 1 }], bases: [],
  pals: Array.from({ length: n }, (_, i) => ({
    instanceId: `i${i}`, characterId: 'SheepBall', passives: i === 0 ? ['CraftSpeed_up2'] : [], talent: {}, location: { kind: 'palbox', playerUid: 'u1' },
  })),
  stats: {}, files: { used: [], skipped: [] },
});

const hostWorld = (id, updatedAt = '2026-10-05T01:00:00.000Z', files = ['Level.sav']) => ({ id, dir: `s/${id}`, role: 'host', updatedAt, playedAt: updatedAt, signature: updatedAt, files });

// 開発用 API を GAS の代わりに使う
function sharedServer({ scope = 'test', userId = 'ホスト' } = {}) {
  const api = createDevelopmentApi();
  const calls = [];
  let currentScope = scope;
  return {
    calls,
    setScope(value) { currentScope = value; },
    server: {
      scope: () => currentScope,
      userId: () => userId,
      async request(action, input = {}) {
        calls.push(action);
        const response = await api({ action, passcode: 'local', ...input });
        if (!response.ok) throw Object.assign(new Error(response.code), { code: response.code });
        return response;
      },
    },
  };
}

function setup({ worlds = [hostWorld(WORLD_A)], offline = false, server = null, persist = idbPersist('test', null), storage = memoryStorage() } = {}) {
  const calls = { list: 0, read: [], imports: 0 };
  let time = 1_000_000;
  let list = worlds;
  const timers = [];
  const store = createOwnedStore({
    persist, settings: safeStorage(storage), namespace: 'pal-note.test', server,
    runImport: async (files, onProgress) => { calls.imports++; onProgress('解析中'); return snapshot(files.length + 1); },
    bridge: {
      list: async () => { calls.list++; if (offline) throw Object.assign(new Error('つながりません'), { code: 'BRIDGE_OFFLINE' }); return list; },
      read: async (world) => { calls.read.push(world.dir); return world.files.map((path) => ({ path, bytes: new Uint8Array(1) })); },
    },
    now: () => time,
    schedule: (fn, ms) => timers.push({ fn, ms }),
  });
  return { store, storage, persist, calls, timers, advance: (ms) => { time += ms; }, setWorlds: (next) => { list = next; } };
}

test('所持パル: 連携ツールは有効にしたときだけ使い、設定はこのブラウザに残す', async () => {
  const { store, storage, calls } = setup();
  assert.equal(await store.refreshBridge(), 'skipped');
  assert.equal(calls.list, 0);
  store.setBridgeEnabled(true);
  assert.deepEqual(JSON.parse(storage.map.get('pal-note.test.owned.bridge')), { enabled: true, worldDir: '', folder: null, viewWorldId: '' });
  assert.equal(await store.refreshBridge(), 'imported');
  assert.equal(store.state.role, 'host');
  assert.equal(store.state.data.source, 'bridge');
  assert.equal(store.state.meta.source, 'local');
  assert.equal(store.state.owned.pals.length, 2);
  assert.equal(store.state.bridge.status, 'ready');
});

test('所持パル: 自動の読み込みは間隔を空け、セーブが変わったときだけ読み直す', async () => {
  const { store, calls, advance, setWorlds } = setup();
  store.setBridgeEnabled(true);
  assert.equal(await store.autoRefresh(), 'imported');
  assert.equal(await store.autoRefresh(), 'skipped');
  advance(25000);
  assert.equal(await store.autoRefresh(), 'unchanged');
  assert.equal(calls.imports, 1);
  setWorlds([hostWorld(WORLD_A, '2026-10-05T02:00:00.000Z', ['Level.sav', 'LevelMeta.sav'])]);
  advance(25000);
  assert.equal(await store.autoRefresh(), 'imported');
  assert.equal(store.state.owned.pals.length, 3);
});

test('所持パル: 連携ツールがないときは自動では失敗を出さず、手動では知らせる', async () => {
  const { store } = setup({ offline: true });
  store.setBridgeEnabled(true);
  assert.equal(await store.autoRefresh(), 'offline');
  assert.equal(store.state.bridge.status, 'offline');
  await assert.rejects(store.refreshBridge(), /つながりません/);
});

test('所持パル: 選んだワールドを読み、次の起動でも出し、連携の解除で読み込んだセーブを消す', async () => {
  const worlds = [hostWorld(WORLD_B, '2026-10-05T03:00:00.000Z'), hostWorld(WORLD_A, '2026-10-05T01:00:00.000Z', ['Level.sav', 'x'])];
  const { store, persist, storage, calls } = setup({ worlds });
  store.setBridgeEnabled(true);
  await store.selectBridgeWorld(`s/${WORLD_A}`);
  assert.deepEqual(calls.read, [`s/${WORLD_A}`]);
  const again = createOwnedStore({ persist, settings: safeStorage(storage), namespace: 'pal-note.test', runImport: async () => snapshot(0) });
  await again.load();
  assert.equal(again.state.data.world.id, WORLD_A);
  assert.equal(again.state.bridge.worldDir, `s/${WORLD_A}`);
  assert.equal(again.state.owned.pals.length, 3);
  await again.unlink();
  assert.deepEqual([again.state.data, again.state.local, again.state.bridge.enabled, again.state.role], [null, null, false, '']);
  assert.equal(await persist.get('pal-note.test.owned'), null);
});

test('所持パル: 自動の読み込みの途中でワールドを選び直しても、後の選択の結果が残る', async () => {
  const worlds = [hostWorld(WORLD_A, '2026-10-05T03:00:00.000Z'), hostWorld(WORLD_B, '2026-10-05T01:00:00.000Z', ['Level.sav', 'x'])];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const store = createOwnedStore({
    persist: idbPersist('race', null),
    runImport: async (files) => snapshot(files.length),
    bridge: {
      list: async () => worlds,
      read: async (world) => { if (world.id === WORLD_A) await gate; return world.files.map((path) => ({ path, bytes: new Uint8Array(1) })); },
    },
  });
  store.setBridgeEnabled(true);
  const auto = store.autoRefresh();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(store.state.busy, true);
  const choose = store.selectBridgeWorld(`s/${WORLD_B}`);
  release();
  assert.equal(await auto, 'imported');
  assert.equal(await choose, 'imported');
  assert.equal(store.state.data.world.id, WORLD_B);
  assert.equal(store.state.busy, false);
});

test('所持パル: ホストは読み込んだセーブを共有し、参加している側はホストの共有を表示する', async () => {
  const shared = sharedServer();
  const host = setup({ server: shared.server });
  host.store.setBridgeEnabled(true);
  await host.store.refreshBridge();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(shared.calls.includes('ownedUpload'));
  assert.equal(host.store.state.upload.status, 'done');
  assert.equal(host.store.state.meta.sharedAt !== '', true);
  assert.equal(host.store.state.meta.uploadedBy, 'ホスト');

  // 参加している側: 連携ツールにはこのワールドの LocalData.sav しかない
  const guest = setup({ server: shared.server, worlds: [{ id: WORLD_A, dir: `s/${WORLD_A}`, role: 'guest', updatedAt: '2026-10-05T05:00:00.000Z', playedAt: '2026-10-05T05:00:00.000Z', files: [] }] });
  guest.store.setBridgeEnabled(true);
  assert.equal(await guest.store.refreshBridge(), 'guest');
  assert.equal(guest.calls.imports, 0);
  assert.equal(guest.store.state.role, 'guest');
  assert.equal(guest.store.state.meta.source, 'shared');
  assert.equal(guest.store.state.owned.pals.length, 2);
  assert.deepEqual(guest.store.state.owned.pals.find((pal) => pal.id === 'i0').passives, ['CraftSpeed_up2']);
  assert.equal(guest.store.state.owned.pals[0].name, 'モコロン');

  // 同じ PC が参加している側になったら、手元に前の読み込みがあってもホストの共有を出す
  host.setWorlds([{ id: WORLD_A, dir: `s2/${WORLD_A}`, role: 'guest', updatedAt: '2026-10-05T05:00:00.000Z', playedAt: '2026-10-05T05:00:00.000Z', files: [] }]);
  assert.equal(await host.store.refreshBridge(), 'guest');
  assert.deepEqual([host.store.state.role, host.store.state.meta.source], ['guest', 'shared']);
});

test('所持パル: 連携していない人は、いちばん新しく共有されたワールドか、選んだワールドを見る', async () => {
  const shared = sharedServer();
  const { OWNED_FIELDS } = await import('../../web/js/core/owned-shared.js');
  const upload = (worldId, n, saveUpdatedAt) => shared.server.request('ownedUpload', {
    userId: 'ホスト', worldId, world: { name: worldId.slice(0, 4), hostName: 'Alice' }, saveUpdatedAt,
    players: [], bases: [], columns: OWNED_FIELDS, rows: Array.from({ length: n }, (_, i) => [`${worldId}-${i}`, ...Array(OWNED_FIELDS.length - 1).fill('')]),
  });
  await upload(WORLD_A, 2, '2026-10-05T01:00:00.000Z');
  await upload(WORLD_B, 5, '2026-10-05T09:00:00.000Z');
  const viewer = setup({ server: shared.server, worlds: [] });
  await viewer.store.fetchShared({ force: true });
  assert.equal(viewer.store.state.meta.worldId, WORLD_B);
  assert.equal(viewer.store.state.owned.pals.length, 5);
  await viewer.store.setViewWorld(WORLD_A);
  assert.equal(viewer.store.state.meta.worldId, WORLD_A);
  assert.equal(viewer.store.state.owned.pals.length, 2);
  // ログインしていないときは共有を読まない
  shared.setScope('');
  const before = shared.calls.length;
  assert.equal(await viewer.store.fetchShared({ force: true }), 'skipped');
  assert.equal(shared.calls.length, before);
});

test('所持パル: 共有されているセーブの方が新しいときは、古いセーブを上書きせずに新しい方を出す', async () => {
  const shared = sharedServer();
  const { OWNED_FIELDS } = await import('../../web/js/core/owned-shared.js');
  await shared.server.request('ownedUpload', {
    userId: '別の PC', worldId: WORLD_A, world: { name: 'LC9', hostName: 'Alice' }, saveUpdatedAt: '2026-10-05T09:00:00.000Z',
    players: [], bases: [], columns: OWNED_FIELDS, rows: [['newer', ...Array(OWNED_FIELDS.length - 1).fill('')]],
  });
  const host = setup({ server: shared.server, worlds: [hostWorld(WORLD_A, '2026-10-05T01:00:00.000Z')] });
  host.store.setBridgeEnabled(true);
  await host.store.refreshBridge();
  assert.equal(await host.store.uploadLocal({ force: true }), 'stale');
  assert.equal(host.store.state.upload.status, 'stale');
  assert.equal(host.store.state.meta.source, 'shared');
  assert.deepEqual(host.store.state.owned.pals.map((pal) => pal.id), ['newer']);
});

test('所持パル: フォルダで参加している側のワールドを選ぶと、読み込まずにホストの共有を待つ', async () => {
  const shared = sharedServer();
  const { store, calls, storage } = setup({ server: shared.server });
  assert.equal(await store.importFolderWorld({ id: WORLD_B.toLowerCase(), role: 'guest', files: [] }), null);
  assert.equal(calls.imports, 0);
  assert.deepEqual([store.state.role, store.state.linkedWorldId, store.state.meta.worldId, store.state.meta.source], ['guest', WORLD_B, WORLD_B, undefined]);
  assert.deepEqual(JSON.parse(storage.map.get('pal-note.test.owned.bridge')).folder, { id: WORLD_B, role: 'guest', name: '' });
});

test('所持パル: 読み込みに失敗したらエラーを出し、読み込み中の印を外す', async () => {
  const failing = createOwnedStore({ persist: idbPersist('x', null), runImport: async () => { throw new Error('Level.sav を読めませんでした'); } });
  await assert.rejects(failing.importFiles([], { source: 'folder', world: { id: WORLD_A } }), /読めませんでした/);
  assert.equal(failing.state.error, 'Level.sav を読めませんでした');
  assert.equal(failing.state.busy, false);
});

test('所持パル: 連携ツールのファイルが途中で消えても、Level.sav があれば読み込む', async () => {
  const { readBridgeWorld } = await import('../../web/js/save/bridge.js');
  const fetchImpl = async (url) => {
    const name = new URL(url).searchParams.get('name');
    if (name === 'Players/gone.sav') return new Response('', { status: 404 });
    return new Response(new Uint8Array([name.length]));
  };
  const files = await readBridgeWorld({ dir: 'w', files: ['Level.sav', 'Players/gone.sav', 'LevelMeta.sav'] }, { fetchImpl });
  assert.deepEqual(files.map((f) => f.path), ['Level.sav', 'LevelMeta.sav']);
  const missingLevel = async () => new Response('', { status: 404 });
  await assert.rejects(readBridgeWorld({ dir: 'w', files: ['Level.sav'] }, { fetchImpl: missingLevel }), /ファイルがありません/);
  const offline = async () => { throw new TypeError('failed'); };
  await assert.rejects(readBridgeWorld({ dir: 'w', files: ['Level.sav'] }, { fetchImpl: offline }), (error) => error.code === 'BRIDGE_OFFLINE');
});
