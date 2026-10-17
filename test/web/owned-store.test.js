import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createOwnedStore, idbPersist } from '../../web/js/owned.js';
import { ownedContentText } from '../../web/js/core/owned.js';
import { safeStorage } from '../../web/js/store.js';
import { createDevelopmentApi } from '../../dev/mock-api.js';
import { fakeHandle, hostFiles, asDropped, memoryPersist, settleUpload, T0 } from '../helpers/file-handles.js';
import { installDom } from '../helpers/dom.js';
import pals from '../../web/data/pals.js';
import { buildIndex } from '../../web/js/core/index.js';
import { buildCarrierGraph } from '../../web/js/core/route.js';
import { parseHash } from '../../web/js/router.js';
import { ownedView } from '../../web/js/views/owned.js';
import { ownedSettingsCard } from '../../web/js/views/owned-settings.js';
import { OWNED_FIELDS, OWNED_FORMAT } from '../../web/js/core/owned-shared.js';
import { isPlaying, emptyPlay, playTicksMs } from '../../web/js/core/playing.js';

function memoryStorage() {
  const map = new Map();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key), map };
}

const WORLD_A = 'ABCDEF0123456789ABCDEF0123456789';
const WORLD_B = 'FEDCBA9876543210FEDCBA9876543210';
const PLAYERS = 'Players/00000000000000000000000000000001.sav';

const snapshot = (n, name = 'テスト') => ({
  version: 1, world: { name, hostName: 'Alice' }, players: [{ uid: 'u1', name: 'Alice', level: 1 }], bases: [],
  pals: Array.from({ length: n }, (_, i) => ({
    instanceId: `i${i}`, characterId: 'SheepBall', passives: i === 0 ? ['CraftSpeed_up2'] : [], talent: {}, location: { kind: 'palbox', playerUid: 'u1' },
  })),
  stats: {}, files: { used: [], skipped: [] },
});

// 開発用 API を GAS の代わりに使う（環境〔scope〕ごとに別の API。同じ GAS でもパスワードでシートが分かれるのと同じ）。
// rewrite(action, input, pass) で応答を差し替えられる（undefined なら開発用 API の応答。pass() で開発用 API の応答を取れる）
function sharedServer({ scope = 'test', userId = 'ホスト', rewrite = null } = {}) {
  const apis = new Map();
  const apiOf = (key) => {
    if (!apis.has(key)) apis.set(key, createDevelopmentApi());
    return apis.get(key);
  };
  const calls = [];
  const uploads = [];
  let currentScope = scope;
  let currentEndpoint = 'https://example.test/exec';
  return {
    calls, uploads,
    setScope(value) { currentScope = value; },
    setEndpoint(value) { currentEndpoint = value; },
    server: {
      scope: () => currentScope,
      userId: () => userId,
      endpoint: () => currentEndpoint,
      async request(action, input = {}) {
        calls.push(action);
        if (action === 'ownedUpload') uploads.push(input.worldId);
        const api = apiOf(currentScope);
        const pass = () => api({ action, passcode: 'local', ...input });
        const response = (await rewrite?.(action, input, pass)) ?? await pass();
        if (!response.ok) throw Object.assign(new Error(response.code), { code: response.code });
        return response;
      },
    },
  };
}

// watch はセーブのファイルの見張り（save/watch.js の createWatchClient）の代わり。渡さなければ本物（Node には Worker がないので 'timer'）
function setup({ server = null, persist = memoryPersist(), storage = memoryStorage(), runImport = null, hidden = () => false, watch = null } = {}) {
  const calls = { imports: 0 };
  let time = 1_000_000;
  const timers = [];
  const make = () => createOwnedStore({
    persist, settings: safeStorage(storage), namespace: 'pal-note.test', server,
    runImport: runImport ?? (async (files, onProgress) => { calls.imports++; onProgress('解析中'); return snapshot(files.length + 1); }),
    now: () => time,
    schedule: (fn, ms) => { timers.push({ fn, ms, cancelled: false }); return timers.length - 1; },
    cancel: (id) => { timers[id].cancelled = true; },
    hidden,
    ...(watch ? { watch } : {}),
  });
  const store = make();
  const register = async (worldId, files, target = store) => target.commitRegistration(await target.previewRegistration({ worldId, steamId: '7656', files: asDropped(files) }));
  return { store, make, storage, persist, calls, timers, register, advance: (ms) => { time += ms; }, time: () => time };
}

test('所持パル: 登録したファイルを読み込み、登録と設定はこのブラウザに残す', async () => {
  const { store, make, storage, calls, register } = setup();
  assert.equal(await store.refreshAuto(), 'skipped');
  const preview = await store.previewRegistration({ worldId: WORLD_A, steamId: '7656', files: asDropped(hostFiles()) });
  assert.deepEqual([preview.kind, preview.role, preview.name, preview.palCount], ['host', 'host', 'テスト', 5]);
  // 確認の段階では、まだ保存も共有もしない
  assert.equal(store.state.local, null);
  const outcome = await store.commitRegistration(preview);
  assert.deepEqual(outcome, { persisted: true, result: 'imported' });
  // 確認で読んだ結果をそのまま使う（読み直さない）
  assert.equal(calls.imports, 1);
  assert.deepEqual(JSON.parse(storage.map.get('pal-note.test.owned.bridge')), { enabled: true, worldId: '', viewWorldId: '' });
  assert.deepEqual([store.state.role, store.state.data.source, store.state.meta.source, store.state.owned.pals.length, store.state.auto.status], ['host', 'handles', 'local', 5, 'ready']);
  assert.equal(store.state.uploadReady, true);
  const again = make();
  await again.load();
  assert.deepEqual(again.state.auto.worlds.map((world) => [world.id, world.name, world.kind]), [[WORLD_A, 'テスト', 'host']]);
  assert.equal(again.state.data.world.id, WORLD_A);
  // 開き直した直後は、読み直すまで共有しない
  assert.equal(again.state.uploadReady, false);
  assert.equal(await register(WORLD_B, { 'Level.sav': fakeHandle('Level.sav') }).catch((error) => error.message), 'LevelMeta.sav・LocalData.sav もドロップしてください');
});

test('所持パル: 自動の読み込みは間隔を空け、セーブが変わったときだけ読み直す', async () => {
  const { store, calls, advance, register } = setup();
  const files = hostFiles();
  await register(WORLD_A, files);
  assert.equal(await store.autoRefresh(), 'skipped');
  advance(25000);
  assert.equal(await store.autoRefresh(), 'unchanged');
  assert.equal(calls.imports, 1);
  files['Level.sav'].time += 60000;
  files['LocalData.sav'].time += 60000;
  advance(25000);
  assert.equal(await store.autoRefresh(), 'imported');
  assert.equal(calls.imports, 2);
});

test('所持パル: 共有の読み直し（app.js の 10 秒ごとの autoRefresh）は 10 秒空ける。タイマーが少し早く来ても次の回に回らないよう 1 秒の余裕（D26・share-fetch）', async () => {
  const shared = sharedServer();
  const { store, advance } = setup({ server: shared.server });
  await store.load();
  shared.calls.length = 0;
  await store.autoRefresh();
  assert.ok(shared.calls.includes('ownedWorlds'));
  shared.calls.length = 0;
  advance(8999);
  assert.equal(await store.autoRefresh(), 'skipped');
  assert.deepEqual(shared.calls, []);
  advance(1);
  await store.autoRefresh();
  // 共有がない（目当てのワールドがない）ので、一覧を読む
  assert.deepEqual(shared.calls, ['ownedWorlds']);
});

test('所持パル: 定期の読み直しは、自動の読み込みが有効なときだけセーブを読み、共有は読み直さない', async () => {
  const shared = sharedServer();
  const { store, calls, advance, register } = setup({ server: shared.server });
  // 登録がない（参加している側など）ときは何もしない
  shared.calls.length = 0;
  assert.equal(await store.pollAuto(), 'skipped');
  assert.deepEqual(shared.calls, []);
  const files = hostFiles();
  await register(WORLD_A, files);
  advance(60000);
  shared.calls.length = 0;
  assert.equal(await store.pollAuto(), 'unchanged');
  assert.ok(!shared.calls.includes('ownedWorlds'));
  files['Level.sav'].time += 60000;
  files['LocalData.sav'].time += 60000;
  // 前に読んでから間がないときは読まない
  assert.equal(await store.pollAuto(), 'skipped');
  advance(60000);
  assert.equal(await store.pollAuto(), 'imported');
  assert.equal(calls.imports, 2);
});

test('所持パル: 許可がないときは自動では読まず、許可を求めてから読む', async () => {
  const { make, register, advance } = setup();
  const files = hostFiles();
  await register(WORLD_A, files);
  for (const handle of Object.values(files)) handle.permission = 'prompt';
  const reopened = make();
  advance(25000);
  assert.equal(await reopened.autoRefresh(), 'permission');
  assert.equal(reopened.state.auto.status, 'permission');
  await assert.rejects(reopened.refreshAuto(), /許可が必要です/);
  const granted = await reopened.grantAndRefresh();
  assert.deepEqual(granted, { granted: 4, total: 4, result: 'imported' });
  assert.equal(reopened.state.uploadReady, true);
});

test('所持パル（autoreg-visibility）: 許可待ちで止まった時刻は止まったときだけ入れ、続けて止まっている間は変えず、読めたら空にする。文は短い 1 文', async () => {
  const { store, advance, register } = setup();
  const files = hostFiles();
  await register(WORLD_A, files);
  assert.equal(store.state.auto.stoppedAt, '');
  for (const handle of Object.values(files)) handle.permission = 'prompt';
  advance(25000);
  assert.equal(await store.autoRefresh(), 'permission');
  const stoppedAt = store.state.auto.stoppedAt;
  assert.equal(stoppedAt, new Date(1_025_000).toISOString());
  // 文は画面の案内と同じ短い 1 文（直し方は画面の permissionNotice が添える）
  assert.equal(store.state.auto.error, 'セーブを読む許可が必要です');
  // 続けて止まっている間（1 分ごとの確認・確認中の checking を挟む）は最初の時刻のまま
  advance(60000);
  assert.equal(await store.autoRefresh(), 'permission');
  assert.equal(store.state.auto.stoppedAt, stoppedAt);
  // 読めたら空にする
  for (const handle of Object.values(files)) handle.permission = 'granted';
  advance(60000);
  await store.autoRefresh();
  assert.equal(store.state.auto.status, 'ready');
  assert.equal(store.state.auto.stoppedAt, '');
});

test('所持パル: 最後に遊んだワールドを読み、選んだワールドがあればそれを読む', async () => {
  const { store, storage, register } = setup();
  await register(WORLD_A, hostFiles(T0));
  await register(WORLD_B, hostFiles(T0 + 60000));
  assert.equal(await store.refreshAuto(), 'imported');
  assert.equal(store.state.data.world.id, WORLD_B);
  await store.selectAutoWorld(WORLD_A);
  assert.equal(store.state.data.world.id, WORLD_A);
  assert.equal(JSON.parse(storage.map.get('pal-note.test.owned.bridge')).worldId, WORLD_A);
});

test('所持パル: 前にホストしたワールドに参加したら、手元の古いデータを出さず、共有もしない', async () => {
  const { store, register, advance } = setup();
  const files = hostFiles();
  await register(WORLD_A, files);
  // 参加すると LocalData.sav だけが新しくなる
  files['LocalData.sav'].time = T0 + 30000;
  advance(25000);
  assert.equal(await store.autoRefresh(), 'guest');
  assert.deepEqual([store.state.role, store.state.uploadReady, store.state.owned, store.state.meta.source], ['guest', false, null, undefined]);
  assert.equal(await store.uploadLocal({ force: true }), 'skipped');
});

test('所持パル: 必要なファイルが消えたら判定せずに共有を止め、Players が消えたときはまず保留し、30 秒たっても同じなら知らせて読む（save-watch）', async () => {
  const { store, register, advance } = setup();
  const files = hostFiles();
  await register(WORLD_A, files);
  const before = store.state.local;
  files[PLAYERS].gone = true;
  files['Level.sav'].time += 60000;
  files['LocalData.sav'].time += 60000;
  advance(25000);
  // 一時的な消失かもしれないので、前のデータを残して読み直しを待つ
  assert.equal(await store.autoRefresh(), 'held');
  assert.equal(store.state.local, before);
  advance(30000);
  assert.equal(await store.autoRefresh(), 'imported');
  assert.deepEqual(store.state.data.snapshot.files.skipped.map((file) => file.path), [PLAYERS]);
  files['LocalData.sav'].gone = true;
  advance(25000);
  assert.equal(await store.autoRefresh(), 'error');
  assert.deepEqual([store.state.role, store.state.uploadReady, store.state.auto.status], ['', false, 'error']);
  assert.match(store.state.auto.error, /LocalData\.sav が見つかりません/);
});

test('所持パル: ファイルを読めないときは飛ばさずに失敗にし、前の読み込みを残す', async () => {
  const { store, register } = setup();
  const files = hostFiles();
  await register(WORLD_A, files);
  const before = store.state.local;
  files['Level.sav'].time += 60000;
  files['LocalData.sav'].time += 60000;
  files[PLAYERS].error = 'NotReadableError';
  await assert.rejects(store.refreshAuto(), /ゲームの保存中かもしれません/);
  assert.equal(store.state.local, before);
  assert.equal(store.state.uploadReady, false);
});

test('所持パル: 参加しただけのワールドは LocalData.sav だけで登録し、読み込まずにホストの共有を待つ', async () => {
  const { store, calls, register } = setup();
  const outcome = await register(WORLD_B, { 'LocalData.sav': fakeHandle('LocalData.sav') });
  assert.equal(outcome.result, 'guest');
  assert.equal(calls.imports, 0);
  assert.deepEqual([store.state.role, store.state.linkedWorldId], ['guest', WORLD_B]);
});

test('所持パル: 登録を削除すると、読み込んだデータと共有の予約を消す', async () => {
  const shared = sharedServer();
  const { store, timers, register, advance, persist } = setup({ server: shared.server });
  const files = hostFiles();
  await register(WORLD_A, files);
  await settleUpload(store);
  assert.ok(shared.calls.includes('ownedUpload'));
  // 間隔（15 秒）を空けずに読み直すと、共有は予約になる
  files['Level.sav'].time += 60000;
  files['LocalData.sav'].time += 60000;
  advance(5000);
  assert.equal(await store.refreshAuto(), 'imported');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 10000);
  await store.removeWorld(WORLD_A);
  assert.equal(timers[0].cancelled, true);
  assert.deepEqual([store.state.local, store.state.role, store.state.linkedWorldId, store.state.auto.enabled], [null, '', '', false]);
  assert.equal(await persist.get('pal-note.test.owned'), null);
  assert.equal(await timers[0].fn(), undefined);
  assert.equal(shared.calls.filter((action) => action === 'ownedUpload').length, 1);
});

test('所持パル: 保存できないブラウザでは、その場限りで登録し、削除もできる', async () => {
  const persist = memoryPersist();
  persist.strict = false;
  const { store, register } = setup({ persist });
  assert.deepEqual(await register(WORLD_A, hostFiles()), { persisted: false, result: 'imported' });
  await store.removeWorld(WORLD_A);
  assert.deepEqual(store.state.auto.worlds, []);
});

test('所持パル: 保存できていた登録の削除に失敗したら、消さずに知らせる', async () => {
  const persist = memoryPersist();
  const { store, register } = setup({ persist });
  await register(WORLD_A, hostFiles());
  persist.strict = false;
  await assert.rejects(store.removeWorld(WORLD_A), /削除できませんでした/);
  assert.equal(store.state.auto.worlds.length, 1);
  assert.equal(store.state.local.world.id, WORLD_A);
});

test('所持パル: 旧版でセーブ連携ツールを使っていた人には、ファイルの登録を案内する', async () => {
  const storage = memoryStorage();
  storage.map.set('pal-note.test.owned.bridge', JSON.stringify({ enabled: true, worldDir: `76561190123456789/${WORLD_A.toLowerCase()}`, folder: null, viewWorldId: '' }));
  const { store } = setup({ storage });
  assert.equal(store.state.auto.worldId, WORLD_A);
  assert.equal(await store.autoRefresh(), 'empty');
  assert.equal(store.state.auto.error, 'セーブのファイルが登録されていません');
});

test('所持パル: 読み込みの途中でワールドを選び直しても、後の選択の結果が残る', async () => {
  const { store, register } = setup();
  const a = hostFiles(T0 + 60000);
  await register(WORLD_A, a);
  await register(WORLD_B, hostFiles(T0));
  let release;
  a['Level.sav'].gate = new Promise((resolve) => { release = resolve; });
  a['Level.sav'].time += 1;
  a['LocalData.sav'].time += 1;
  const first = store.refreshAuto();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(store.state.busy, true);
  const choose = store.selectAutoWorld(WORLD_B);
  release();
  assert.equal(await first, 'imported');
  assert.equal(await choose, 'imported');
  assert.equal(store.state.data.world.id, WORLD_B);
  assert.equal(store.state.busy, false);
});

test('所持パル: ホストは読み込んだセーブを共有し、参加している側はホストの共有を表示する', async () => {
  const shared = sharedServer();
  const host = setup({ server: shared.server });
  await host.register(WORLD_A, hostFiles());
  await settleUpload(host.store);
  assert.ok(shared.calls.includes('ownedUpload'));
  assert.equal(host.store.state.upload.status, 'done');
  assert.equal(host.store.state.meta.sharedAt !== '', true);
  assert.equal(host.store.state.meta.uploadedBy, 'ホスト');

  const guest = setup({ server: shared.server });
  assert.equal((await guest.register(WORLD_A, { 'LocalData.sav': fakeHandle('LocalData.sav') })).result, 'guest');
  assert.equal(guest.calls.imports, 0);
  assert.equal(guest.store.state.role, 'guest');
  assert.equal(guest.store.state.meta.source, 'shared');
  assert.equal(guest.store.state.owned.pals.length, 5);
  assert.deepEqual(guest.store.state.owned.pals.find((pal) => pal.id === 'i0').passives, ['CraftSpeed_up2']);
  assert.equal(guest.store.state.owned.pals[0].name, 'モコロン');
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
  const viewer = setup({ server: shared.server });
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

test('所持パル: 共有を読み直しても何も変わっていなければ、所持パルを作り直さない（名前が変わったときは反映する）', async () => {
  const shared = sharedServer();
  const { OWNED_FIELDS } = await import('../../web/js/core/owned-shared.js');
  await shared.server.request('signup', { userId: 'ホスト', opId: crypto.randomUUID() });
  await shared.server.request('ownedUpload', {
    userId: 'ホスト', worldId: WORLD_A, world: { name: 'A', hostName: 'Alice' }, saveUpdatedAt: '2026-10-05T01:00:00.000Z',
    players: [], bases: [], columns: OWNED_FIELDS, rows: [[`${WORLD_A}-0`, ...Array(OWNED_FIELDS.length - 1).fill('')]],
  });
  const viewer = setup({ server: shared.server });
  await viewer.store.fetchShared({ force: true });
  const first = viewer.store.state.owned;
  const current = viewer.store.state.shared.current;
  await viewer.store.fetchShared({ force: true });
  assert.equal(viewer.store.state.shared.current, current);
  assert.equal(viewer.store.state.owned, first);
  // 共有した人の名前が変わったときは、新しい名前にする
  await shared.server.request('rename', { opId: crypto.randomUUID(), userId: 'ホスト', newUserId: 'ホスト2' });
  await viewer.store.fetchShared({ force: true });
  assert.equal(viewer.store.state.meta.uploadedBy, 'ホスト2');
});

test('所持パル: 共有されているセーブの方が新しいときは、古いセーブを上書きせずに新しい方を出す', async () => {
  const shared = sharedServer();
  const { OWNED_FIELDS } = await import('../../web/js/core/owned-shared.js');
  await shared.server.request('ownedUpload', {
    userId: '別の PC', worldId: WORLD_A, world: { name: 'World9', hostName: 'Alice' }, saveUpdatedAt: '2026-10-05T09:00:00.000Z',
    players: [], bases: [], columns: OWNED_FIELDS, rows: [['newer', ...Array(OWNED_FIELDS.length - 1).fill('')]],
  });
  const host = setup({ server: shared.server });
  await host.register(WORLD_A, hostFiles(T0));
  assert.equal(await host.store.uploadLocal({ force: true }), 'stale');
  assert.equal(host.store.state.upload.status, 'stale');
  assert.equal(host.store.state.meta.source, 'shared');
  assert.deepEqual(host.store.state.owned.pals.map((pal) => pal.id), ['newer']);
});

test('所持パル: IndexedDB が使えないときは、登録の保存を失敗として返す', async () => {
  const persist = idbPersist('none', null);
  await assert.rejects(persist.setStrict('k', 1), /保存できません/);
  await assert.rejects(persist.removeStrict('k'), /保存できません/);
});

test('所持パル: 読み込みの途中で登録の削除を求めたら、その読み込みの結果では共有しない', async () => {
  const shared = sharedServer();
  const { store, register, advance } = setup({ server: shared.server });
  const files = hostFiles();
  await register(WORLD_A, files);
  await settleUpload(store);
  await register(WORLD_B, { 'LocalData.sav': fakeHandle('LocalData.sav', { time: T0 - 60000 }) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const uploads = () => shared.calls.filter((action) => action === 'ownedUpload').length;
  const before = uploads();
  let release;
  files['Level.sav'].gate = new Promise((resolve) => { release = resolve; });
  files['Level.sav'].time += 120000;
  files['LocalData.sav'].time += 120000;
  advance(120000);
  const reading = store.autoRefresh();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const removing = store.removeWorld(WORLD_A);
  release();
  assert.equal(await reading, 'imported');
  await removing;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(uploads(), before);
  assert.deepEqual([store.state.uploadReady, store.state.local], [false, null]);
});

test('所持パル: 開き直した直後は保存済みのデータで済ませず、一度読んでから共有する', async () => {
  const { make, register, calls } = setup();
  await register(WORLD_A, hostFiles());
  const reopened = make();
  await reopened.load();
  assert.equal(reopened.state.uploadReady, false);
  assert.equal(await reopened.autoRefresh(), 'imported');
  assert.equal(calls.imports, 2);
  assert.equal(reopened.state.uploadReady, true);
});

test('所持パル: 読む途中で許可が外れたら、許可のボタンを出す', async () => {
  const { store, register } = setup();
  const files = hostFiles();
  await register(WORLD_A, files);
  files['Level.sav'].time += 60000;
  files['LocalData.sav'].time += 60000;
  // 一覧を確かめたときは読めて、中身を読むときに許可が外れていた
  files[PLAYERS].readError = 'NotAllowedError';
  await assert.rejects(store.refreshAuto(), /読む許可がありません/);
  assert.equal(store.state.auto.status, 'permission');
});

test('所持パル: 最後に遊んだワールドが読めないときは、読めるワールドを読んで知らせる', async () => {
  const { store, register } = setup();
  await register(WORLD_A, hostFiles(T0));
  const newer = hostFiles(T0 + 60000);
  await register(WORLD_B, newer);
  newer['LevelMeta.sav'].gone = true;
  assert.equal(await store.refreshAuto(), 'imported');
  assert.equal(store.state.data.world.id, WORLD_A);
  assert.match(store.state.auto.error, /「テスト」を読めないため/);
});

test('所持パル: 別のワールドの登録を削除しても、いまのワールドの共有の予約は残す', async () => {
  const shared = sharedServer();
  const { store, timers, register, advance } = setup({ server: shared.server });
  const files = hostFiles(T0 + 60000);
  await register(WORLD_A, files);
  await settleUpload(store);
  await register(WORLD_B, { 'LocalData.sav': fakeHandle('LocalData.sav', { time: T0 }) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  files['Level.sav'].time += 60000;
  files['LocalData.sav'].time += 60000;
  advance(5000);
  assert.equal(await store.refreshAuto(), 'imported');
  await new Promise((resolve) => setTimeout(resolve, 0));
  const scheduled = timers.at(-1);
  assert.equal(scheduled.ms, 10000);
  assert.equal(scheduled.cancelled, false);
  await store.removeWorld(WORLD_B);
  assert.equal(scheduled.cancelled, false);
  assert.equal(store.state.uploadReady, true);
});

test('所持パル: 順番待ちの読み込みは、削除を求められたワールドを選ばず、共有もしない', async () => {
  const shared = sharedServer();
  const { store, register, advance } = setup({ server: shared.server });
  const b = hostFiles(T0);
  await register(WORLD_B, b);
  await settleUpload(store);
  await register(WORLD_A, hostFiles(T0 + 60000));
  await settleUpload(store);
  assert.equal(store.state.linkedWorldId, WORLD_A);
  const before = shared.uploads.length;
  // 連携しているのは A のまま、B で遊んで B の方が新しくなった。共有の間隔も空いた。読み込みを頼んだ直後に B の削除を求める
  b['Level.sav'].time = T0 + 180000;
  b['LocalData.sav'].time = T0 + 180000;
  advance(120000);
  const reading = store.refreshAuto().then((result) => [result, store.state.data.world.id]);
  const removing = store.removeWorld(WORLD_B);
  // 順番待ちだった読み込みは、削除を求められた B ではなく A を読む
  assert.deepEqual(await reading, ['imported', WORLD_A]);
  await removing;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(shared.uploads.slice(before).filter((id) => id === WORLD_B), []);
});

test('所持パル: 前の版でフォルダから連携し、自動がオフのまま登録が残っていても、登録したワールドを自動で読む', async () => {
  const { make, storage, persist, register } = setup();
  await register(WORLD_A, hostFiles());
  // 前の版の設定（フォルダで連携 → 自動はオフ）
  storage.map.set('pal-note.test.owned.bridge', JSON.stringify({ enabled: false, worldId: '', folder: { id: WORLD_B, role: 'host', name: '' }, viewWorldId: '' }));
  const reopened = make();
  await reopened.load();
  assert.equal(reopened.state.auto.enabled, true);
  assert.deepEqual(JSON.parse(storage.map.get('pal-note.test.owned.bridge')), { enabled: true, worldId: '', viewWorldId: '' });
  assert.ok(persist);
});

test('所持パル: ワールドを指定して、CSV 用の所持パルを取り出し、共有した所持パルを消せる', async () => {
  const shared = sharedServer();
  const { store, register } = setup({ server: shared.server });
  await register(WORLD_A, hostFiles());
  await store.uploadLocal({ force: true });
  // この PC で読み込んだワールドは、読み込んだセーブから
  const local = await store.ownedOf(WORLD_A.toLowerCase());
  assert.equal(local.owned.pals.length, 5);
  // 読み込んでも共有されてもいないワールドは null
  assert.equal(await store.ownedOf(WORLD_B), null);
  assert.ok(store.state.shared.worlds.some((world) => world.worldId === WORLD_A));
  assert.equal(await store.deleteShared(WORLD_A), true);
  assert.ok(!store.state.shared.worlds.some((world) => world.worldId === WORLD_A));
});

test('所持パル（読み戻しの検証）: IndexedDB の手元のデータは、ワールド ID が不正・形が違えば「データなし」として扱う', async () => {
  const saved = (world, extra = {}) => ({ version: 1, importedAt: '2026-10-05T00:00:00.000Z', source: 'handles', world, snapshot: snapshot(2), ...extra });
  for (const broken of [
    saved({ id: 'W1', name: 'テスト' }), saved({ name: 'ID なし' }), saved('world'), saved({ id: WORLD_A }, { snapshot: { pals: 'pals' } }),
    saved({ id: WORLD_A }, { version: 2 }), saved({ id: WORLD_A }, { snapshot: { pals: { length: 3 } } }), 'data', null,
  ]) {
    const { store, persist } = setup();
    persist.map.set('pal-note.test.owned', broken);
    await store.load();
    assert.equal(store.state.local, null, JSON.stringify(broken));
    assert.equal(store.state.owned, null);
  }
  // 正しいデータは今と同じく読み、ワールド ID は大文字にそろえる。日時が読めなければ空にする
  const { store, persist } = setup();
  persist.map.set('pal-note.test.owned', saved({ id: WORLD_A.toLowerCase(), name: 'テスト' }, { importedAt: 'いつか' }));
  await store.load();
  assert.deepEqual([store.state.local.world.id, store.state.local.world.role, store.state.local.importedAt, store.state.owned.pals.length], [WORLD_A, 'host', '', 2]);
});

test('所持パル（読み戻しの検証）: IndexedDB の手元のセーブのプレイヤー・個体・拠点・ギルド・牧場に壊れた要素があっても、その要素だけを捨てて所持タブと設定タブを描く', async (t) => {
  installDom(t);
  const { make, persist, register } = setup();
  await register(WORLD_A, hostFiles());
  const saved = persist.map.get('pal-note.test.owned');
  persist.map.set('pal-note.test.owned', {
    ...saved,
    snapshot: {
      ...saved.snapshot,
      players: [null, 'p', { uid: 7, name: '数の uid', level: 1 }, { name: 'uid なし', level: 1 }, ...saved.snapshot.players],
      pals: [null, 'pal', ...saved.snapshot.pals],
      bases: [null, 3], guilds: [null], breedFarms: [null, 'farm'],
      files: { used: [PLAYERS], skipped: [] },
    },
  });
  const store = make();
  await store.load();
  const { snapshot: local } = store.state.local;
  assert.deepEqual([local.players.map((player) => player.uid), local.pals.length, local.bases, local.guilds, local.breedFarms], [['u1'], saved.snapshot.pals.length, [], [], []]);
  assert.equal(store.state.owned.pals.length, saved.snapshot.pals.length);
  const index = buildIndex([], pals);
  const context = {
    store: { state: { records: [], index, graph: buildCarrierGraph(index), env: 'test', warnings: [], users: ['Alice'], userId: 'Alice' }, subscribe: () => () => {} },
    owned: store, navigate() {}, inputDelay: 0,
    autoRegister: { enabled: () => true, setEnabled() {}, mapping: () => ({}), setMapping() {} },
  };
  // 所持タブ（案内に、登録していないプレイヤーのファイルを出すところで null のプレイヤーを読んでいた）
  const view = ownedView(context, parseHash('#/owned'));
  assert.equal(view.element.querySelectorAll('.owned-row').length, saved.snapshot.pals.length);
  view.destroy();
  // 設定タブ（登録者の対応で、セーブのプレイヤーを並べる）
  const card = ownedSettingsCard(context);
  assert.deepEqual(card.element.querySelectorAll('.owned-breeding-player').map((row) => row.children[0].textContent), ['Alice']);
  card.destroy();
});

test('所持パル（読み戻しの検証）: 共有のキャッシュは要素ごとに整え、今のワールドの行が配列でなければ使わない', async () => {
  const { OWNED_FIELDS } = await import('../../web/js/core/owned-shared.js');
  const world = { worldId: WORLD_A, worldName: 'A', hostName: 'Alice', saveUpdatedAt: '2026-10-05T01:00:00.000Z', uploadedAt: '2026-10-05T01:01:00.000Z', uploadedBy: 'ホスト', palCount: 1, players: [], bases: [], farms: null };
  const row = (id) => [id, ...Array(OWNED_FIELDS.length - 1).fill('')];
  const cache = (current) => ({ worlds: [null, { ...world, worldId: 'W1' }, world, world], current, fetchedAt: '2026-10-05T01:02:00.000Z' });
  const open = async (value) => {
    const shared = sharedServer();
    const { store, persist } = setup({ server: shared.server });
    persist.map.set('pal-note.test.owned.shared.test', value);
    await store.load();
    return store;
  };
  const good = await open(cache({ world, columns: OWNED_FIELDS, rows: [row('p1'), null, row('p1'), row('p2')] }));
  assert.deepEqual(good.state.shared.worlds.map((item) => item.worldId), [WORLD_A]);
  assert.deepEqual(good.state.shared.current.rows.map((cells) => cells[0]), ['p1', 'p2']);
  assert.deepEqual([good.state.meta.worldId, good.state.owned.pals.length], [WORLD_A, 2]);
  for (const current of [{ world, columns: OWNED_FIELDS, rows: 'rows' }, { world: { ...world, worldId: 'W1' }, columns: OWNED_FIELDS, rows: [] }, 'current', null]) {
    const store = await open(cache(current));
    assert.equal(store.state.shared.current, null, JSON.stringify(current));
    assert.equal(store.state.owned, null);
    assert.equal(store.state.shared.worlds.length, 1);
  }
  // worlds が配列でないキャッシュは今までどおり使わない
  const none = await open({ worlds: 'worlds', current: null });
  assert.deepEqual(none.state.shared.worlds, []);
});

test('所持パル（読み戻しの検証）: セーブ連携の設定の表示するワールドは、32 桁の ID でなければ自動にする', async () => {
  for (const [viewWorldId, expected] of [[WORLD_B.toLowerCase(), WORLD_B], ['W1', ''], [7, ''], [null, '']]) {
    const storage = memoryStorage();
    storage.map.set('pal-note.test.owned.bridge', JSON.stringify({ enabled: false, worldId: '', viewWorldId }));
    const { store } = setup({ storage });
    assert.equal(store.state.viewWorldId, expected);
  }
});

// ---------------------------------------------------------------------------
// owned-status: busy は自動登録が見るので変えない（画面用の読み込みの状態 activity と最後に確かめた時刻 checkedAt は、データ元の 1 行と一緒に
// なくした。D29）
// ---------------------------------------------------------------------------
// emit のたびの状態を記録する
function record(store, pick) {
  const seen = [];
  store.subscribe((state) => seen.push(pick(state)));
  return seen;
}
// 同じ値が続く記録を 1 つにまとめる
const steps = (values) => values.filter((value, i) => i === 0 || JSON.stringify(value) !== JSON.stringify(values[i - 1]));

test('所持パル（owned-status）: 変わっていないセーブの確認でも busy の動きは今までと同じ（画面用の activity・checkedAt は持たない。D29）', async () => {
  const { store, advance, register } = setup();
  await register(WORLD_A, hostFiles());
  advance(25000);
  const seen = record(store, (state) => state.busy);
  assert.equal(await store.autoRefresh(), 'unchanged');
  // busy: 読み直すか決める前に true、終わったら false（自動登録はこれを見る）
  assert.deepEqual(steps(seen), [true, false]);
  assert.deepEqual([store.state.busy, store.state.progress], [false, '']);
  assert.deepEqual(['activity', 'checkedAt'].filter((key) => key in store.state), []);
});

test('所持パル（owned-status）: 確認の始めには auto.error を消さず（設定のエラーの行が点滅しない）、結果が出たら入れ直す', async () => {
  const { store, advance, register } = setup();
  const files = hostFiles();
  await register(WORLD_A, files);
  for (const handle of Object.values(files)) handle.permission = 'prompt';
  advance(25000);
  assert.equal(await store.autoRefresh(), 'permission');
  const message = store.state.auto.error;
  assert.match(message, /許可が必要です/);
  // 許可が戻ったセーブを確かめる途中（checking）も、前のエラーを残す
  for (const handle of Object.values(files)) handle.permission = 'granted';
  advance(25000);
  const seen = record(store, (state) => [state.auto.status, state.auto.error]);
  assert.equal(await store.autoRefresh(), 'unchanged');
  assert.deepEqual(seen.find(([status]) => status === 'checking'), ['checking', message]);
  assert.deepEqual([store.state.auto.status, store.state.auto.error], ['ready', '']);
});

test('所持パル（owned-status）: 登録がない（empty）ときの文は短くする（設定の欄・ヘッダーにも出るので「設定で」と書かない。copy-dead-ends）', async () => {
  const storage = memoryStorage();
  storage.map.set('pal-note.test.owned.bridge', JSON.stringify({ enabled: true, worldId: '', viewWorldId: '' }));
  const { store } = setup({ storage });
  assert.equal(await store.autoRefresh(), 'empty');
  assert.equal(store.state.auto.error, 'セーブのファイルが登録されていません');
});

test('所持パル: 古い GAS（後から足した列を知らない）が列の幅の違う共有を断ったら、末尾の列を外して送り直し、受け付けた幅を覚えて 1 時間ごとに試し直す（save-extras）', async () => {
  const shared = sharedServer();
  const { OWNED_FIELDS } = await import('../../web/js/core/owned-shared.js');
  const { ApiError } = await import('../../web/js/api.js');
  // 入手時刻の列（ownedAt）を足す前の GAS の検証と同じ: 知っている列より広い共有は INVALID_COLUMNS・INVALID_ROWS
  let known = OWNED_FIELDS.length - 1;
  const widths = [];
  const inputs = [];
  const old = {
    ...shared.server,
    async request(action, input = {}) {
      if (action === 'ownedUpload') {
        widths.push(input.columns.length);
        inputs.push(input);
        if (input.columns.length > known) {
          throw new ApiError('VALIDATION', { ok: false, code: 'VALIDATION', errors: [{ field: 'columns', code: 'INVALID_COLUMNS' }, { field: 'rows', code: 'INVALID_ROWS' }] });
        }
      }
      return shared.server.request(action, input);
    },
  };
  const host = setup({ server: old });
  await host.register(WORLD_A, hostFiles(T0));
  await settleUpload(host.store);
  assert.deepEqual(widths, [OWNED_FIELDS.length, OWNED_FIELDS.length - 1]);
  assert.equal(host.store.state.upload.status, 'done');
  assert.deepEqual(host.store.state.shared.current.columns, OWNED_FIELDS.slice(0, -1));
  // 中身の印は狭めた後の中身で計算し、形の版は外した列の数だけ下げる（share-upload）
  assert.deepEqual(inputs.map((input) => input.world.format), [OWNED_FORMAT, OWNED_FORMAT - 1]);
  assert.notEqual(inputs[1].world.contentHash, inputs[0].world.contentHash);
  for (const input of inputs) assert.equal(input.world.contentHash, sha256(ownedContentText(input)));
  // 次の共有は覚えた幅で 1 回だけ送る
  host.advance(60000);
  assert.equal(await host.store.uploadLocal({ force: true }), 'uploaded');
  assert.deepEqual(widths.slice(2), [OWNED_FIELDS.length - 1]);
  // 1 時間たったら全部の列で試し直す（GAS を更新していれば、そのまま通る）
  known = OWNED_FIELDS.length;
  host.advance(60 * 60 * 1000);
  assert.equal(await host.store.uploadLocal({ force: true }), 'uploaded');
  assert.deepEqual(widths.slice(3), [OWNED_FIELDS.length]);
  // 列の幅でない検証の失敗は送り直さない。足した列を全部外しても断られたら諦める
  known = 0;
  host.advance(60 * 60 * 1000);
  assert.equal(await host.store.uploadLocal({ force: true }), 'error');
  assert.equal(host.store.state.upload.status, 'error');
});

// ---------------------------------------------------------------------------
// share-fetch（docs/sync-fixes/README.md の 4）: 参加者の読み直し。今のワールドは ownedSince を 1 回・一覧は 5 分ごと・古い GAS は 2 回呼び・
// 行の数の安全網・古い応答を捨てる
// ---------------------------------------------------------------------------
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const sharedRow = (id) => [id, ...Array(OWNED_FIELDS.length - 1).fill('')];
let publishClock = Date.parse('2026-10-05T01:00:00.000Z');
// 別の PC のホストが共有する（呼ぶたびにセーブの時刻を進める）。今の環境（shared の scope）の開発用 API に入る
async function publish(shared, { worldId = WORLD_A, prefix = 'p', n = 2, user = 'ホスト' } = {}) {
  publishClock += 60000;
  const response = await shared.server.request('ownedUpload', {
    userId: user, worldId, world: { name: worldId.slice(0, 4), hostName: 'Alice' }, saveUpdatedAt: new Date(publishClock).toISOString(),
    players: [], bases: [], columns: OWNED_FIELDS, rows: Array.from({ length: n }, (_, i) => sharedRow(`${prefix}${i}`)),
  });
  assert.equal(response.stored, true);
  return response.world;
}
const ids = (store) => (store.state.owned?.pals ?? []).map((pal) => pal.id).sort();
const sharedCache = (persist, scope = 'test') => persist.get(`pal-note.test.owned.shared.${scope}`);
// 間隔を空けて autoRefresh を 1 回呼び、その間の操作を返す
const refreshCalls = async (shared, viewer, step = 10000) => {
  shared.calls.length = 0;
  viewer.advance(step);
  await viewer.store.autoRefresh();
  return [...shared.calls];
};

test('所持パル（share-fetch）: 今のワールドの共有を持っていれば ownedSince を 1 回。変わっていなければ時刻・共有した人だけを入れ替え、所持パルは作り直さない', async () => {
  const shared = sharedServer();
  await shared.server.request('signup', { userId: 'ホスト', opId: crypto.randomUUID() });
  const first = await publish(shared, { prefix: 'a' });
  const viewer = setup({ server: shared.server });
  await viewer.store.load();
  shared.calls.length = 0;
  assert.equal(await viewer.store.autoRefresh(), 'fetched');
  // 起動: 一覧を読み、まだ持っていないので ownedSince（版なし）で中身を受け取る
  assert.deepEqual(shared.calls, ['ownedWorlds', 'ownedSince']);
  assert.deepEqual(ids(viewer.store), ['a0', 'a1']);
  const { owned } = viewer.store.state;
  const { current } = viewer.store.state.shared;
  // 変わっていない: ownedSince を 1 回だけ（一覧は読まない）。共有のデータも所持パルも同じ物のまま
  assert.deepEqual(await refreshCalls(shared, viewer), ['ownedSince']);
  assert.equal(viewer.store.state.shared.current, current);
  assert.equal(viewer.store.state.owned, owned);
  // 共有した人の ID が変わった（同じ版）: 共有した人だけを入れ替え、所持パルは作り直さない
  await shared.server.request('rename', { opId: crypto.randomUUID(), userId: 'ホスト', newUserId: 'ホスト2' });
  assert.deepEqual(await refreshCalls(shared, viewer), ['ownedSince']);
  assert.equal(viewer.store.state.meta.uploadedBy, 'ホスト2');
  assert.equal(viewer.store.state.shared.current.world.uploadedBy, 'ホスト2');
  assert.equal(viewer.store.state.shared.current.rows, current.rows);
  assert.equal(viewer.store.state.owned, owned);
  // 変わった: 中身を受け取って作り直し、確定としてキャッシュにも書く
  const second = await publish(shared, { prefix: 'b', n: 3 });
  assert.notEqual(second.uploadedAt, first.uploadedAt);
  assert.deepEqual(await refreshCalls(shared, viewer), ['ownedSince']);
  assert.deepEqual(ids(viewer.store), ['b0', 'b1', 'b2']);
  assert.notEqual(viewer.store.state.owned, owned);
  assert.deepEqual([viewer.store.state.meta.sharedAt, viewer.store.state.meta.palCount], [second.uploadedAt, 3]);
  assert.equal((await sharedCache(viewer.persist)).current.world.uploadedAt, second.uploadedAt);
  // 共有が消えた（ownedSince の world が null）ら出さない
  await shared.server.request('ownedDelete', { worldId: WORLD_A });
  assert.deepEqual(await refreshCalls(shared, viewer), ['ownedSince']);
  assert.deepEqual([viewer.store.state.owned, viewer.store.state.shared.worlds], [null, []]);
});

test('所持パル（share-fetch）: ワールドの一覧は起動・force・目当てのワールドがない・前回から 5 分のときだけ読む', async () => {
  const shared = sharedServer();
  await publish(shared, { prefix: 'a' });
  const viewer = setup({ server: shared.server });
  await viewer.store.load();
  shared.calls.length = 0;
  await viewer.store.autoRefresh();
  assert.deepEqual(shared.calls, ['ownedWorlds', 'ownedSince']);
  // 5 分までは今のワールドの ownedSince だけ
  for (let elapsed = 10000; elapsed < 5 * 60 * 1000; elapsed += 10000) {
    assert.deepEqual(await refreshCalls(shared, viewer), ['ownedSince'], `${elapsed} ms`);
  }
  // 5 分たったら一覧を読む（持っている版と同じなら、中身は読まない）
  assert.deepEqual(await refreshCalls(shared, viewer), ['ownedWorlds']);
  assert.deepEqual(await refreshCalls(shared, viewer), ['ownedSince']);
  // force（登録の確定・ワールドの選び直しなど）は一覧も読む
  shared.calls.length = 0;
  assert.equal(await viewer.store.fetchShared({ force: true }), 'fetched');
  assert.deepEqual(shared.calls, ['ownedWorlds']);
  // 目当てのワールドが一覧にない（まだ共有されていないワールドを選んだ）間は、毎回一覧を読む
  shared.calls.length = 0;
  await viewer.store.setViewWorld(WORLD_B);
  assert.deepEqual(shared.calls, ['ownedWorlds']);
  assert.equal(viewer.store.state.owned, null);
  assert.deepEqual(await refreshCalls(shared, viewer), ['ownedWorlds']);
  await publish(shared, { worldId: WORLD_B, prefix: 'b' });
  assert.deepEqual(await refreshCalls(shared, viewer), ['ownedWorlds', 'ownedSince']);
  assert.deepEqual(ids(viewer.store), ['b0', 'b1']);
  assert.deepEqual(await refreshCalls(shared, viewer), ['ownedSince']);
  // ログインの切り替え（保存先が替わる）も一覧から読む
  shared.setScope('prod');
  shared.calls.length = 0;
  await viewer.store.scopeChanged();
  assert.deepEqual(shared.calls, ['ownedWorlds']);
});

test('所持パル（share-fetch）: 古い GAS（ownedSince が BAD_ACTION）なら、接続先と環境ごとに 1 時間覚えて、一覧 → owned の 2 回呼びに落とす', async () => {
  let oldGas = true;
  const shared = sharedServer({ rewrite: (action) => (oldGas && action === 'ownedSince' ? { ok: false, code: 'BAD_ACTION' } : undefined) });
  await publish(shared, { prefix: 'a' });
  shared.setScope('prod');
  await publish(shared, { prefix: 'a' });
  shared.setScope('test');
  const viewer = setup({ server: shared.server });
  await viewer.store.load();
  shared.calls.length = 0;
  const markedAt = viewer.time();
  assert.equal(await viewer.store.autoRefresh(), 'fetched');
  // 試して BAD_ACTION なら、同じ回のうちに owned で読む
  assert.deepEqual(shared.calls, ['ownedWorlds', 'ownedSince', 'owned']);
  assert.deepEqual(ids(viewer.store), ['a0', 'a1']);
  assert.equal(viewer.store.state.shared.error, '');
  // 覚えている間は ownedSince を呼ばない（変わっていなければ一覧だけ、変わっていれば一覧 → owned）
  assert.deepEqual(await refreshCalls(shared, viewer), ['ownedWorlds']);
  await publish(shared, { prefix: 'b' });
  assert.deepEqual(await refreshCalls(shared, viewer), ['ownedWorlds', 'owned']);
  assert.deepEqual(ids(viewer.store), ['b0', 'b1']);
  // 接続先が違えば試し直す（BAD_ACTION なら一覧を読み、持っている版と同じ）
  shared.setEndpoint('https://example.test/other');
  assert.deepEqual(await refreshCalls(shared, viewer), ['ownedSince', 'ownedWorlds']);
  shared.setEndpoint('https://example.test/exec');
  // 環境が違っても試し直す
  shared.setScope('prod');
  shared.calls.length = 0;
  await viewer.store.scopeChanged();
  assert.deepEqual(shared.calls, ['ownedWorlds', 'ownedSince', 'owned']);
  shared.setScope('test');
  shared.calls.length = 0;
  await viewer.store.scopeChanged();
  assert.deepEqual(shared.calls, ['ownedWorlds']);
  // GAS を新しくしても、覚えてから 1 時間たつまでは 2 回呼びのまま。1 時間たったら ownedSince を試し直す
  oldGas = false;
  assert.deepEqual(await refreshCalls(shared, viewer, markedAt + 60 * 60 * 1000 - 10000 - viewer.time()), ['ownedWorlds']);
  assert.deepEqual(await refreshCalls(shared, viewer), ['ownedSince']);
  assert.deepEqual(ids(viewer.store), ['b0', 'b1']);
});

test('所持パル（share-fetch）: 受け取った行の数が palCount と違う・PARTIAL なら、前の表示を残し（キャッシュにも書かない）、5 秒後に読み直す（3 回まで）', async () => {
  let mode = '';
  let hidden = false;
  const shared = sharedServer({
    rewrite: async (action, input, pass) => {
      if (!['owned', 'ownedSince'].includes(action) || !mode) return undefined;
      if (mode === 'partial') return { ok: false, code: 'PARTIAL' };
      // 共有の書き込みと重なって行が 1 つ欠けた（古い GAS は数を確かめずに返す）
      const response = await pass();
      if (response.changed !== false) response.rows = response.rows.slice(1);
      return response;
    },
  });
  await publish(shared, { prefix: 'a' });
  const viewer = setup({ server: shared.server, hidden: () => hidden });
  await viewer.store.autoRefresh();
  const first = viewer.store.state.shared.current;
  const { owned } = viewer.store.state;
  const kept = async () => {
    assert.equal(viewer.store.state.shared.current, first);
    assert.equal(viewer.store.state.owned, owned);
    assert.equal(viewer.store.state.meta.sharedAt, first.world.uploadedAt);
    assert.equal((await sharedCache(viewer.persist)).current.world.uploadedAt, first.world.uploadedAt);
  };
  const second = await publish(shared, { prefix: 'b', n: 3 });
  mode = 'short';
  viewer.advance(10000);
  assert.equal(await viewer.store.autoRefresh(), 'partial');
  await kept();
  // 5 秒後に読み直す。3 回まで
  for (let retry = 1; retry <= 3; retry++) {
    const timer = viewer.timers.at(-1);
    assert.deepEqual([viewer.timers.length, timer.ms, timer.cancelled], [retry, 5000, false]);
    viewer.advance(5000);
    assert.equal(await timer.fn(), 'partial');
    await kept();
  }
  // それでも合わなければ、次の定期の読み直しに任せる（表示しているデータがあるので、案内には出ない）
  assert.equal(viewer.timers.length, 3);
  assert.match(viewer.store.state.shared.error, /共有の書き込みと重なった/);
  viewer.advance(10000);
  assert.equal(await viewer.store.autoRefresh(), 'partial');
  assert.equal(viewer.timers.length, 3);
  // 合えば受け取り、キャッシュにも書く
  mode = '';
  viewer.advance(10000);
  assert.equal(await viewer.store.autoRefresh(), 'fetched');
  assert.deepEqual(ids(viewer.store), ['b0', 'b1', 'b2']);
  assert.equal(viewer.store.state.shared.error, '');
  assert.equal((await sharedCache(viewer.persist)).current.world.uploadedAt, second.uploadedAt);
  // PARTIAL（新しい GAS が数の違いを返す）も同じ。タブが裏にある間は、予約した読み直しでも読まない
  const third = await publish(shared, { prefix: 'c' });
  mode = 'partial';
  viewer.advance(10000);
  assert.equal(await viewer.store.autoRefresh(), 'partial');
  assert.deepEqual(ids(viewer.store), ['b0', 'b1', 'b2']);
  hidden = true;
  shared.calls.length = 0;
  assert.equal(await viewer.timers.at(-1).fn(), 'skipped');
  assert.deepEqual(shared.calls, []);
  // 読み直しで合えば受け取り、予約していた読み直しは取り消す
  hidden = false;
  viewer.advance(10000);
  assert.equal(await viewer.store.autoRefresh(), 'partial');
  const pending = viewer.timers.at(-1);
  mode = '';
  viewer.advance(10000);
  assert.equal(await viewer.store.autoRefresh(), 'fetched');
  assert.equal(pending.cancelled, true);
  assert.deepEqual(ids(viewer.store), ['c0', 'c1']);
  assert.equal(viewer.store.state.meta.sharedAt, third.uploadedAt);
  // 表示しているデータがない（初めて読む）なら、3 回読み直しても合わなければ読めなかったことを知らせる
  mode = 'short';
  const fresh = setup({ server: shared.server });
  assert.equal(await fresh.store.autoRefresh(), 'partial');
  for (let retry = 1; retry <= 3; retry++) assert.equal(await fresh.timers.at(-1).fn(), 'partial');
  assert.deepEqual([fresh.store.state.owned, fresh.timers.length], [null, 3]);
  // 一覧は使う（どのワールドの共有かは出せる）
  assert.deepEqual([fresh.store.state.meta.worldId, fresh.store.state.meta.worldName], [WORLD_A, WORLD_A.slice(0, 4)]);
  assert.match(fresh.store.state.shared.error, /共有の書き込みと重なった/);
  assert.equal((await sharedCache(fresh.persist))?.current ?? null, null);
});

test('所持パル（share-fetch）: ワールドや保存先（ログイン・環境）を変えた後に届いた古い応答は捨てる', async () => {
  let gate = null;
  let release = () => {};
  const shared = sharedServer({
    rewrite: async (action, input, pass) => {
      if (!gate || action !== 'ownedSince') return undefined;
      const response = await pass();
      await gate;
      return response;
    },
  });
  const hold = () => { gate = new Promise((resolve) => { release = resolve; }); };
  const open = () => { gate = null; release(); };
  await publish(shared, { worldId: WORLD_A, prefix: 'a' });
  await publish(shared, { worldId: WORLD_B, prefix: 'b' });
  const viewer = setup({ server: shared.server });
  await viewer.store.setViewWorld(WORLD_A);
  assert.deepEqual(ids(viewer.store), ['a0', 'a1']);
  // 共有のデータの先頭の個体（uploadedAt はワールドが違えば同じミリ秒になりうるので、中身で見分ける）
  const seen = record(viewer.store, (state) => state.shared.current?.rows[0]?.[0] ?? '');
  // ワールドを選び直す前に頼んだ、前のワールドの応答は使わない（選び直した後に、選んだワールドを読み直す）
  await publish(shared, { worldId: WORLD_A, prefix: 'x' });
  hold();
  viewer.advance(10000);
  const reading = viewer.store.autoRefresh();
  await tick();
  const switching = viewer.store.setViewWorld(WORLD_B);
  open();
  assert.equal(await reading, 'skipped');
  assert.equal(await switching, 'fetched');
  assert.deepEqual(ids(viewer.store), ['b0', 'b1']);
  assert.ok(!seen.includes('x0'));
  // ログインの切り替えで保存先が替わった後に届いた、前の保存先の応答も使わない（どちらのキャッシュにも書かない）
  const before = (await sharedCache(viewer.persist)).current.world.uploadedAt;
  await publish(shared, { worldId: WORLD_B, prefix: 'y' });
  hold();
  viewer.advance(10000);
  const old = viewer.store.autoRefresh();
  await tick();
  shared.setScope('prod');
  const changing = viewer.store.scopeChanged();
  open();
  assert.equal(await old, 'skipped');
  await changing;
  // prod には共有がない
  assert.deepEqual([viewer.store.state.owned, viewer.store.state.shared.worlds], [null, []]);
  assert.ok(!seen.includes('y0'));
  assert.equal((await sharedCache(viewer.persist, 'prod'))?.current ?? null, null);
  assert.equal((await sharedCache(viewer.persist)).current.world.uploadedAt, before);
});

test('所持パル（share-fetch）: 読んでいる間に共有の削除が終わったら、読んだ応答で消したワールドを戻さない（応答の検査の後、反映の前に割り込まれても）', async () => {
  let gate = null;
  const shared = sharedServer({
    rewrite: async (action, input, pass) => {
      if (!gate || !['ownedSince', 'ownedDelete'].includes(action)) return undefined;
      // ownedSince は削除の前の中身（削除と重なった読み込み）
      const response = await pass();
      await gate;
      return response;
    },
  });
  await publish(shared, { prefix: 'a' });
  const viewer = setup({ server: shared.server });
  await viewer.store.autoRefresh();
  await publish(shared, { prefix: 'b' });
  let release;
  gate = new Promise((resolve) => { release = resolve; });
  viewer.advance(10000);
  const reading = viewer.store.autoRefresh();
  await tick();
  const deleting = viewer.store.deleteShared(WORLD_A);
  await tick();
  gate = null;
  release();
  assert.equal(await deleting, true);
  assert.equal(await reading, 'skipped');
  assert.deepEqual([viewer.store.state.shared.worlds, viewer.store.state.shared.current, viewer.store.state.owned], [[], null, null]);
  const cache = await sharedCache(viewer.persist);
  assert.deepEqual([cache.worlds, cache.current], [[], null]);
});

test('所持パル（share-fetch）: 一覧を読んだ回の中身が PARTIAL でも、一覧は使い（5 分は読み直さない）、表示は前の版のまま（時刻も前の版）', async () => {
  let partialFor = '';
  const shared = sharedServer({ rewrite: (action, input) => (action === 'ownedSince' && input.worldId === partialFor ? { ok: false, code: 'PARTIAL' } : undefined) });
  // ワールドを選んでいない人（いちばん新しく共有されたワールドを見る）。古い A1 ＜ B2 ＜ 新しい A2 の順に共有された
  const first = await publish(shared, { prefix: 'a' });
  const viewer = setup({ server: shared.server });
  await viewer.store.autoRefresh();
  await publish(shared, { worldId: WORLD_B, prefix: 'b' });
  const second = await publish(shared, { prefix: 'x' });
  partialFor = WORLD_A;
  // 前に一覧を読んでから 5 分たった回: 一覧を読み、中身は PARTIAL
  assert.deepEqual(await refreshCalls(shared, viewer, 5 * 60 * 1000), ['ownedWorlds', 'ownedSince']);
  // 一覧は読んだとおりに入れ、いちばん新しい A を見たまま。所持パルと時刻は前の版（A1）
  assert.deepEqual(viewer.store.state.shared.worlds.map((world) => [world.worldId, world.uploadedAt]).sort(), [[WORLD_A, second.uploadedAt], [WORLD_B, viewer.store.state.shared.worlds.find((world) => world.worldId === WORLD_B).uploadedAt]].sort());
  assert.deepEqual([viewer.store.state.meta.worldId, viewer.store.state.meta.sharedAt], [WORLD_A, first.uploadedAt]);
  assert.deepEqual(ids(viewer.store), ['a0', 'a1']);
  assert.equal((await sharedCache(viewer.persist)).current.world.uploadedAt, first.uploadedAt);
  // 5 秒後の読み直しと、続く定期の読み直しでは、一覧を読み直さない（A を読む）
  shared.calls.length = 0;
  viewer.advance(5000);
  assert.equal(await viewer.timers.at(-1).fn(), 'partial');
  assert.deepEqual(shared.calls, ['ownedSince']);
  assert.deepEqual(await refreshCalls(shared, viewer), ['ownedSince']);
  // 合えば受け取る
  partialFor = '';
  assert.deepEqual(await refreshCalls(shared, viewer), ['ownedSince']);
  assert.deepEqual(ids(viewer.store), ['x0', 'x1']);
  assert.equal(viewer.store.state.meta.sharedAt, second.uploadedAt);
  // 一覧で、いちばん新しいワールドが替わった回（B3）の中身が PARTIAL なら、選び直さずに前の一覧と表示のまま（次の回に一覧から読み直す）
  await publish(shared, { worldId: WORLD_B, prefix: 'y' });
  partialFor = WORLD_B;
  assert.deepEqual(await refreshCalls(shared, viewer, 5 * 60 * 1000), ['ownedWorlds', 'ownedSince']);
  assert.deepEqual([viewer.store.state.meta.worldId, ids(viewer.store)], [WORLD_A, ['x0', 'x1']]);
  partialFor = '';
  assert.deepEqual(await refreshCalls(shared, viewer), ['ownedWorlds', 'ownedSince']);
  assert.deepEqual([viewer.store.state.meta.worldId, ids(viewer.store)], [WORLD_B, ['y0', 'y1']]);
  // 一覧を読んで間もないときに「自動」へ選び直し、新しく選ばれるワールドが PARTIAL でも、次の読み直しは一覧から（前のワールドに戻らない）
  await publish(shared, { prefix: 'w' });
  await viewer.store.setViewWorld(WORLD_A);
  assert.deepEqual(ids(viewer.store), ['w0', 'w1']);
  await publish(shared, { worldId: WORLD_B, prefix: 'z' });
  partialFor = WORLD_B;
  shared.calls.length = 0;
  assert.equal(await viewer.store.setViewWorld(''), 'partial');
  assert.deepEqual(shared.calls, ['ownedWorlds', 'ownedSince']);
  assert.deepEqual([viewer.store.state.meta.worldId, ids(viewer.store)], [WORLD_A, ['w0', 'w1']]);
  partialFor = '';
  shared.calls.length = 0;
  viewer.advance(5000);
  assert.equal(await viewer.timers.at(-1).fn(), 'fetched');
  assert.deepEqual(shared.calls, ['ownedWorlds', 'ownedSince']);
  assert.deepEqual([viewer.store.state.meta.worldId, ids(viewer.store)], [WORLD_B, ['z0', 'z1']]);
});

test('所持パル（share-fetch）: 変わらない回はキャッシュを書き直さず、読んでいる途中の force は終わってから 1 回にまとめ、ワールドを替えたら予約した読み直しを取り消す', async () => {
  let gate = null;
  let partialOn = false;
  const shared = sharedServer({
    rewrite: async (action, input, pass) => {
      if (partialOn && action === 'ownedSince' && input.worldId === WORLD_A) return { ok: false, code: 'PARTIAL' };
      if (!gate || action !== 'ownedWorlds') return undefined;
      await gate;
      return pass();
    },
  });
  await publish(shared, { worldId: WORLD_A, prefix: 'a' });
  await publish(shared, { worldId: WORLD_B, prefix: 'b' });
  const persist = memoryPersist();
  const writes = [];
  const set = persist.set;
  persist.set = (key, value) => { if (key.includes('.owned.shared.')) writes.push(key); return set(key, value); };
  const viewer = setup({ server: shared.server, persist });
  await viewer.store.setViewWorld(WORLD_A);
  assert.equal(writes.length, 1);
  for (let i = 0; i < 3; i++) await refreshCalls(shared, viewer);
  assert.equal(writes.length, 1);
  // 読んでいる途中の force は、終わってからの 1 回にまとめる
  let release;
  gate = new Promise((resolve) => { release = resolve; });
  shared.calls.length = 0;
  const first = viewer.store.fetchShared({ force: true });
  await tick();
  const follows = [viewer.store.fetchShared({ force: true }), viewer.store.fetchShared({ force: true })];
  gate = null;
  release();
  assert.deepEqual(await Promise.all([first, ...follows]), ['fetched', 'fetched', 'fetched']);
  assert.deepEqual(shared.calls, ['ownedWorlds', 'ownedWorlds']);
  // A の読み直しを予約している間に B へ替えたら、予約を取り消す
  await publish(shared, { worldId: WORLD_A, prefix: 'x' });
  partialOn = true;
  viewer.advance(10000);
  assert.equal(await viewer.store.autoRefresh(), 'partial');
  const pending = viewer.timers.at(-1);
  await viewer.store.setViewWorld(WORLD_B);
  assert.equal(pending.cancelled, true);
  assert.deepEqual(ids(viewer.store), ['b0', 'b1']);
});

test('所持パル（share-fetch）: 共有の送信の応答も、送っている間に保存先（ログイン・環境）が替わったら今の共有とキャッシュに入れない', async () => {
  let gate = null;
  let release = () => {};
  const shared = sharedServer({
    rewrite: async (action, input, pass) => {
      if (!gate || action !== 'ownedUpload') return undefined;
      const response = await pass();
      await gate;
      return response;
    },
  });
  const host = setup({ server: shared.server });
  gate = new Promise((resolve) => { release = resolve; });
  await host.register(WORLD_A, hostFiles());
  assert.equal(host.store.state.upload.status, 'sending');
  shared.setScope('prod');
  await host.store.scopeChanged();
  gate = null;
  release();
  await tick();
  await tick();
  assert.deepEqual([host.store.state.upload.status, host.store.state.shared.worlds, host.store.state.shared.current], ['', [], null]);
  assert.equal(await sharedCache(host.persist, 'prod'), null);
  // 手元のセーブはそのまま出す
  assert.equal(host.store.state.meta.source, 'local');
});

// ---------------------------------------------------------------------------
// share-upload（docs/sync-fixes/README.md の 5）: 送っている間は dirty にして終わった後に最新を 1 回・最短 15 秒・再試行の段・
// 識別（saveStamp・contentHash・format・fileCount・missingCount・force）を送る・応答をスナップショットの印と組にして残す
// ---------------------------------------------------------------------------
const tickOf = (n) => String(638650000000000000n + BigInt(n));
const PLAYERS_2 = 'Players/00000000000000000000000000000002.sav';
// 中の保存時刻（生のティック）つきのスナップショット。n は個体の数、used・skipped は読めたファイル・読めなかったファイル
const stampedSnapshot = (ticks, n = 2, { used = ['Level.sav', 'LevelMeta.sav', PLAYERS], skipped = [] } = {}) => ({
  ...snapshot(n), world: { name: 'テスト', hostName: 'Alice', savedAtTicks: ticks }, files: { used, skipped },
});
const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

// 送った ownedUpload の入力を sent に残す開発用 API。hold() で次からの応答を止め（戻り値の関数で返す）、control.failures の先頭の
// コードで失敗させ、control.lose の回数だけ「書いた後に応答を失う（TIMEOUT）」
function uploadServer(options = {}) {
  const sent = [];
  const control = { gate: null, failures: [], lose: 0 };
  const shared = sharedServer({
    ...options,
    rewrite: async (action, input, pass) => {
      if (action !== 'ownedUpload') return undefined;
      sent.push(input);
      if (control.gate) await control.gate;
      const code = control.failures.shift();
      if (code) return { ok: false, code };
      if (control.lose > 0) {
        control.lose--;
        await pass();
        return { ok: false, code: 'TIMEOUT' };
      }
      return undefined;
    },
  });
  const hold = () => {
    let release;
    control.gate = new Promise((resolve) => { release = resolve; });
    return () => { control.gate = null; release(); };
  };
  // 同じ開発用 API を、別の ID で使う（別の人の PC）
  const as = (userId) => ({ ...shared.server, userId: () => userId });
  return { ...shared, sent, control, hold, as };
}
const until = async (check, message = '待っていた状態になりません') => {
  for (let i = 0; i < 200 && !check(); i++) await tick();
  assert.ok(check(), message);
};
// 取り消されていない共有の予約（timers のうち、取り消し・発火していないもの）
const pendingTimers = (host) => host.timers.filter((item) => !item.cancelled && !item.fired);
// いちばん後の予約の時刻まで進めて動かし、送り終わるまで待つ。予約の待ち時間を返す
async function fireUpload(host) {
  const timer = pendingTimers(host).at(-1);
  assert.ok(timer, '共有の予約がありません');
  timer.fired = true;
  host.advance(timer.ms);
  timer.fn();
  await settleUpload(host.store);
  return timer.ms;
}
// セーブが変わった（ファイルの時刻を進めて読み直す）
async function readNewSave(host, files, { ms = 1000 } = {}) {
  files['Level.sav'].time += 30000;
  files['LocalData.sav'].time += 30000;
  host.advance(ms);
  assert.equal(await host.store.refreshAuto(), 'imported');
}

test('所持パル（share-upload）: 送っている間に読んだセーブは dirty にし、終わった後に最新を 1 回だけ送る（2 回読んでも 1 回）', async () => {
  const up = uploadServer();
  let next = stampedSnapshot(tickOf(1), 2);
  const host = setup({ server: up.server, runImport: async () => next });
  const files = hostFiles();
  const release = up.hold();
  await host.register(WORLD_A, files);
  await until(() => up.sent.length === 1);
  assert.equal(host.store.state.upload.status, 'sending');
  // 送っている間（GAS の書き込みは十数秒かかる）に 2 回新しいセーブを読む。送り始めからは 15 秒より空いた
  next = stampedSnapshot(tickOf(2), 3);
  await readNewSave(host, files, { ms: 10000 });
  next = stampedSnapshot(tickOf(3), 4);
  await readNewSave(host, files, { ms: 10000 });
  assert.equal(up.sent.length, 1);
  assert.equal(host.store.state.upload.status, 'sending');
  assert.deepEqual(pendingTimers(host), []);
  release();
  await until(() => up.sent.length === 2);
  await settleUpload(host.store);
  // 2 回目は最新のセーブ（間の 1 つは送らない）。その後は何も予約しない
  assert.deepEqual(up.sent.map((input) => [input.world.saveStamp, input.rows.length]), [[tickOf(1), 2], [tickOf(3), 4]]);
  assert.deepEqual([host.store.state.upload.status, host.store.state.upload.stamp], ['done', tickOf(3)]);
  assert.deepEqual(pendingTimers(host), []);
  await tick();
  assert.equal(up.sent.length, 2);
});

test('所持パル（share-upload）: 送り始めの間は 15 秒空ける（空いていなければ予約し、その間に読んだセーブは予約のときの最新を送る）', async () => {
  const up = uploadServer();
  let next = stampedSnapshot(tickOf(1), 2);
  const host = setup({ server: up.server, runImport: async () => next });
  const files = hostFiles();
  await host.register(WORLD_A, files);
  await settleUpload(host.store);
  assert.equal(up.sent.length, 1);
  next = stampedSnapshot(tickOf(2), 3);
  await readNewSave(host, files, { ms: 5000 });
  assert.deepEqual(pendingTimers(host).map((timer) => timer.ms), [10000]);
  // 予約の間にもう 1 回読んでも、予約は 1 つ（時刻は送り始めから 15 秒のまま）
  next = stampedSnapshot(tickOf(3), 4);
  await readNewSave(host, files, { ms: 3000 });
  assert.deepEqual(pendingTimers(host).map((timer) => timer.ms), [7000]);
  assert.equal(up.sent.length, 1);
  assert.equal(await fireUpload(host), 7000);
  assert.deepEqual(up.sent.map((input) => input.world.saveStamp), [tickOf(1), tickOf(3)]);
  // 15 秒たっていれば、すぐ送る
  next = stampedSnapshot(tickOf(4), 4);
  await readNewSave(host, files, { ms: 15000 });
  await settleUpload(host.store);
  assert.deepEqual([up.sent.length, pendingTimers(host).length], [3, 0]);
});

test('所持パル（share-upload）: 送れなかったら 15・30・60・120・300 秒で送り直し（300 秒のまま繰り返す）、送れたら最初の段に戻す。待っている間に新しいセーブを読んでも早めない', async () => {
  const up = uploadServer();
  let next = stampedSnapshot(tickOf(1), 2);
  const host = setup({ server: up.server, runImport: async () => next });
  const files = hostFiles();
  up.control.failures.push('CONNECTION', 'TIMEOUT', 'BUSY', 'INTERNAL', 'RESPONSE', 'CONNECTION');
  await host.register(WORLD_A, files);
  await settleUpload(host.store);
  assert.deepEqual([host.store.state.upload.status, host.store.state.upload.error], ['error', 'CONNECTION']);
  const waits = [];
  for (let i = 0; i < 5; i++) waits.push(await fireUpload(host));
  assert.deepEqual(waits, [15000, 30000, 60000, 120000, 300000]);
  // 6 回目の失敗の後も 300 秒。待っている間に新しいセーブを読んでも、予約の時刻（再試行の段）は変えない
  assert.deepEqual(pendingTimers(host).map((timer) => timer.ms), [300000]);
  next = stampedSnapshot(tickOf(2), 3);
  await readNewSave(host, files, { ms: 100000 });
  assert.deepEqual(pendingTimers(host).map((timer) => timer.ms), [200000]);
  assert.equal(up.sent.length, 6);
  // 送れたら段を戻す（最新のセーブを送る）
  await fireUpload(host);
  assert.deepEqual([up.sent.length, up.sent.at(-1).world.saveStamp, host.store.state.upload.status], [7, tickOf(2), 'done']);
  assert.deepEqual(pendingTimers(host), []);
  up.control.failures.push('CONNECTION');
  next = stampedSnapshot(tickOf(3), 3);
  await readNewSave(host, files, { ms: 15000 });
  await settleUpload(host.store);
  assert.deepEqual(pendingTimers(host).map((timer) => timer.ms), [15000]);
});

test('所持パル（share-upload）: VALIDATION・AUTH・TOO_LARGE などは送り直さない（次に新しいセーブを読んだときに送る）', async () => {
  for (const code of ['VALIDATION', 'AUTH', 'TOO_LARGE', 'CONFIG']) {
    const up = uploadServer();
    let next = stampedSnapshot(tickOf(1), 2);
    const host = setup({ server: up.server, runImport: async () => next });
    const files = hostFiles();
    up.control.failures.push(code);
    await host.register(WORLD_A, files);
    await settleUpload(host.store);
    assert.deepEqual([host.store.state.upload.status, pendingTimers(host).length], ['error', 0], code);
    next = stampedSnapshot(tickOf(2), 2);
    await readNewSave(host, files, { ms: 15000 });
    await settleUpload(host.store);
    assert.deepEqual([up.sent.length, host.store.state.upload.status], [2, 'done'], code);
  }
});

test('所持パル（share-upload）: 登録の削除・許可切れで、予約・送っている間の 1 回・再試行の段を全部消す', async () => {
  // 再試行の予約がある間に登録を消す
  const up = uploadServer();
  let next = stampedSnapshot(tickOf(1), 2);
  const host = setup({ server: up.server, runImport: async () => next });
  const files = hostFiles();
  up.control.failures.push('CONNECTION');
  await host.register(WORLD_A, files);
  await settleUpload(host.store);
  const [retry] = pendingTimers(host);
  await host.store.removeWorld(WORLD_A);
  assert.equal(retry.cancelled, true);
  // 送っている途中に登録を消すと、終わった後の 1 回も再試行も予約しない
  const up2 = uploadServer();
  const host2 = setup({ server: up2.server, runImport: async () => next });
  const files2 = hostFiles();
  const release = up2.hold();
  await host2.register(WORLD_A, files2);
  await until(() => up2.sent.length === 1);
  next = stampedSnapshot(tickOf(2), 3);
  await readNewSave(host2, files2, { ms: 20000 });
  up2.control.failures.push('CONNECTION');
  await host2.store.removeWorld(WORLD_A);
  release();
  await settleUpload(host2.store);
  await tick();
  assert.deepEqual([up2.sent.length, pendingTimers(host2).length], [1, 0]);
  // 許可が外れて止まると再試行の段も消える（許可が戻った後の失敗は 15 秒から）
  const up3 = uploadServer();
  const host3 = setup({ server: up3.server, runImport: async () => next });
  const files3 = hostFiles();
  up3.control.failures.push('CONNECTION', 'CONNECTION', 'CONNECTION');
  await host3.register(WORLD_A, files3);
  await settleUpload(host3.store);
  assert.equal(await fireUpload(host3), 15000);
  const [waiting] = pendingTimers(host3);
  assert.equal(waiting.ms, 30000);
  for (const handle of Object.values(files3)) handle.permission = 'prompt';
  host3.advance(1000);
  assert.equal(await host3.store.refreshAuto({ auto: true }), 'permission');
  assert.equal(waiting.cancelled, true);
  for (const handle of Object.values(files3)) handle.permission = 'granted';
  next = stampedSnapshot(tickOf(3), 3);
  await readNewSave(host3, files3, { ms: 15000 });
  await settleUpload(host3.store);
  assert.deepEqual(pendingTimers(host3).map((timer) => timer.ms), [15000]);
});

test('所持パル（share-upload）: 送る world に識別（saveStamp・contentHash・format・fileCount・missingCount・force）を入れ、最上位の項目は増やさない', async () => {
  const up = uploadServer();
  const skipped = [{ path: PLAYERS_2, reason: 'ファイルが見つかりません' }, { path: PLAYERS_2, reason: '重複' }];
  const next = stampedSnapshot(tickOf(7), 3, { used: ['Level.sav', 'LevelMeta.sav', PLAYERS, '../GlobalPalStorage.sav'], skipped });
  const host = setup({ server: up.server, runImport: async () => next });
  await host.register(WORLD_A, hostFiles());
  await settleUpload(host.store);
  const [input] = up.sent;
  assert.deepEqual(Object.keys(input).sort(), ['bases', 'columns', 'players', 'rows', 'saveUpdatedAt', 'userId', 'world', 'worldId']);
  const { contentHash, ...identity } = input.world;
  // GlobalPalStorage.sav も読めたファイルに数え、読めなかったファイルは同じパスを 1 つに数える。登録の確定から送ったので force
  assert.deepEqual(identity, { name: 'テスト', hostName: 'Alice', saveStamp: tickOf(7), format: OWNED_FORMAT, fileCount: 4, missingCount: 1, force: true });
  // 中身の印は、送った中身（識別・送った人・セーブのファイルの更新日時を除く）の SHA-256
  assert.match(contentHash, /^[0-9a-f]{64}$/);
  assert.equal(contentHash, sha256(ownedContentText(input)));
  // 中の保存時刻のない古い解析結果は saveStamp が空（GAS は識別なしとして、今の更新日時で比べる）
  const up2 = uploadServer();
  const host2 = setup({ server: up2.server });
  await host2.register(WORLD_A, hostFiles());
  await settleUpload(host2.store);
  assert.equal(up2.sent[0].world.saveStamp, '');
  assert.equal(host2.store.state.upload.status, 'done');
});

test('所持パル（share-upload）: contentHash は同じ中身なら同じ（送った人・ファイルの更新日時・時刻によらない）、中身が違えば違う', async () => {
  const up = uploadServer();
  let next = stampedSnapshot(tickOf(1), 2);
  const host = setup({ server: up.server, runImport: async () => next });
  const files = hostFiles();
  await host.register(WORLD_A, files);
  await settleUpload(host.store);
  // 同じセーブを読み直した（ファイルの更新日時だけが変わった）
  await readNewSave(host, files, { ms: 15000 });
  await settleUpload(host.store);
  // 別の人の PC で同じセーブを読んだ
  const other = setup({ server: up.as('別の人'), runImport: async () => next });
  await other.register(WORLD_A, hostFiles(T0 + 5000));
  await settleUpload(other.store);
  // 中身が違う（個体が 1 体多い）
  next = stampedSnapshot(tickOf(1), 3);
  await readNewSave(host, files, { ms: 15000 });
  await settleUpload(host.store);
  const hashes = up.sent.map((input) => input.world.contentHash);
  assert.equal(up.sent.length, 4);
  assert.equal(new Set(up.sent.slice(0, 3).map((input) => input.saveUpdatedAt)).size, 3);
  assert.deepEqual(up.sent.slice(0, 3).map((input) => input.userId), ['ホスト', 'ホスト', '別の人']);
  assert.deepEqual([hashes[1], hashes[2]], [hashes[0], hashes[0]]);
  assert.notEqual(hashes[3], hashes[0]);
});

test('所持パル（share-upload）: 結果の種類（new・unchanged・newer・resent・same・stale）を、送ったスナップショットの印・保存時刻と公開されている共有と組にして残す', async () => {
  const up = uploadServer();
  let mine = stampedSnapshot(tickOf(10), 2);
  const host = setup({ server: up.server, runImport: async () => mine });
  const files = hostFiles();
  await host.register(WORLD_A, files);
  await settleUpload(host.store);
  const pick = (store) => {
    const { status, result, signature, stamp, published } = store.state.upload;
    return { status, result, signature: signature === store.state.local.world.signature && signature !== '', stamp, by: published?.uploadedBy, at: published?.uploadedAt === store.state.shared.worlds.find((world) => world.worldId === WORLD_A)?.uploadedAt, publishedStamp: published?.saveStamp };
  };
  assert.deepEqual(pick(host.store), { status: 'done', result: 'new', signature: true, stamp: tickOf(10), by: 'ホスト', at: true, publishedStamp: tickOf(10) });
  // 同じ中身の送り直し（自分）は unchanged でも自分の共有が載っている（done）
  assert.equal(await host.store.uploadLocal({ force: true }), 'unchanged');
  assert.deepEqual(pick(host.store), { status: 'done', result: 'unchanged', signature: true, stamp: tickOf(10), by: 'ホスト', at: true, publishedStamp: tickOf(10) });
  // 別の人の PC（同期で同じセーブを持っている）: 同じ中身は他人の unchanged、劣った中身（読めなかったファイルがある）は same。どちらもエラーにしない
  let theirs = stampedSnapshot(tickOf(10), 2);
  const other = setup({ server: up.as('別の人'), runImport: async () => theirs });
  const otherFiles = hostFiles(T0 + 5000);
  await other.register(WORLD_A, otherFiles);
  await settleUpload(other.store);
  assert.deepEqual(pick(other.store), { status: 'same', result: 'unchanged', signature: true, stamp: tickOf(10), by: 'ホスト', at: true, publishedStamp: tickOf(10) });
  theirs = stampedSnapshot(tickOf(10), 2, { skipped: [{ path: PLAYERS_2, reason: 'ファイルが見つかりません' }] });
  otherFiles['Level.sav'].time += 30000;
  otherFiles['LocalData.sav'].time += 30000;
  other.advance(15000);
  // 読めなかったファイルのある一式は、まず保留し、同じ形が 30 秒続いたら採用する（save-watch）
  assert.equal(await other.store.refreshAuto(), 'held');
  other.advance(30000);
  assert.equal(await other.store.refreshAuto(), 'imported');
  await settleUpload(other.store);
  assert.deepEqual(pick(other.store), { status: 'same', result: 'same', signature: true, stamp: tickOf(10), by: 'ホスト', at: true, publishedStamp: tickOf(10) });
  assert.equal(other.store.state.upload.error, '');
  // 自分の送り直しで中身がよくなった（読めたファイルが増えた）は resent、新しいセーブは newer
  mine = stampedSnapshot(tickOf(10), 2, { used: ['Level.sav', 'LevelMeta.sav', PLAYERS, PLAYERS_2] });
  await readNewSave(host, files, { ms: 15000 });
  await settleUpload(host.store);
  assert.deepEqual([host.store.state.upload.status, host.store.state.upload.result], ['done', 'resent']);
  mine = stampedSnapshot(tickOf(20), 2);
  await readNewSave(host, files, { ms: 15000 });
  await settleUpload(host.store);
  assert.deepEqual(pick(host.store), { status: 'done', result: 'newer', signature: true, stamp: tickOf(20), by: 'ホスト', at: true, publishedStamp: tickOf(20) });
  // 共有されている方が新しい（別の人の古いセーブ）は stale で、新しい方を読んで出す
  theirs = stampedSnapshot(tickOf(15), 2);
  await readNewSave(other, otherFiles, { ms: 15000 });
  await settleUpload(other.store);
  assert.deepEqual(pick(other.store), { status: 'stale', result: 'stale', signature: true, stamp: tickOf(15), by: 'ホスト', at: true, publishedStamp: tickOf(20) });
  assert.equal(other.store.state.meta.source, 'shared');
});

test('所持パル（share-upload）: 書き込みは成功したが応答を失ったら送り直し、再送は unchanged（公開されている共有は自分の送信）で done になる', async () => {
  const up = uploadServer();
  const host = setup({ server: up.server, runImport: async () => stampedSnapshot(tickOf(3), 2) });
  up.control.lose = 1;
  await host.register(WORLD_A, hostFiles());
  await settleUpload(host.store);
  assert.deepEqual([host.store.state.upload.status, host.store.state.upload.error], ['error', 'TIMEOUT']);
  assert.equal(await fireUpload(host), 15000);
  assert.equal(up.sent.length, 2);
  assert.equal(up.sent[1].world.contentHash, up.sent[0].world.contentHash);
  const { status, result, published } = host.store.state.upload;
  assert.deepEqual([status, result, published.uploadedBy, published.saveStamp], ['done', 'unchanged', 'ホスト', tickOf(3)]);
  assert.deepEqual(pendingTimers(host), []);
  // 共有の中身も手元に入る（同じ中身が載っている）
  assert.equal(host.store.state.shared.current.rows.length, 2);
});

test('所持パル（share-upload）: ページを読み込み直しても、同じセーブは unchanged（自分の共有）で書き直さない。前のページの結果は持ち越さない', async () => {
  const up = uploadServer();
  const host = setup({ server: up.server, runImport: async () => stampedSnapshot(tickOf(4), 2) });
  await host.register(WORLD_A, hostFiles());
  await settleUpload(host.store);
  const firstAt = host.store.state.upload.published.uploadedAt;
  const reopened = host.make();
  await reopened.load();
  assert.deepEqual(reopened.state.upload, { status: '', at: '', error: '', worldId: '', result: '', signature: '', stamp: '', savedAt: '', scope: '', userId: '', published: null });
  host.advance(60000);
  assert.equal(await reopened.autoRefresh(), 'imported');
  await settleUpload(reopened);
  assert.deepEqual([reopened.state.upload.status, reopened.state.upload.result, reopened.state.upload.published.uploadedAt], ['done', 'unchanged', firstAt]);
});

test('所持パル（share-upload）: 古い GAS（result・saveStamp を返さず stored だけ）でも今どおり動く', async () => {
  const legacy = (response) => {
    if (!response.ok) return response;
    const { result, cleanup, ...rest } = response;
    const { saveStamp, ...world } = rest.world;
    return { ...rest, world, ...(rest.stored ? {} : { reason: 'STALE' }) };
  };
  const shared = sharedServer({ rewrite: async (action, input, pass) => (action === 'ownedUpload' ? legacy(await pass()) : undefined) });
  const host = setup({ server: shared.server, runImport: async () => stampedSnapshot(tickOf(5), 2) });
  await host.register(WORLD_A, hostFiles(T0));
  await settleUpload(host.store);
  const { status, result, published } = host.store.state.upload;
  assert.deepEqual([status, result, published.saveStamp, published.uploadedBy], ['done', '', '', 'ホスト']);
  // 共有の方が新しい（古い GAS は stored: false だけ）は stale で、新しい方を読む
  await shared.server.request('ownedUpload', {
    userId: '別の PC', worldId: WORLD_A, world: { name: 'World9', hostName: 'Alice' }, saveUpdatedAt: new Date(T0 + 60 * 60 * 1000).toISOString(),
    players: [], bases: [], columns: OWNED_FIELDS, rows: [sharedRow('newer')],
  });
  host.advance(15000);
  assert.equal(await host.store.uploadLocal(), 'stale');
  assert.deepEqual([host.store.state.upload.status, host.store.state.upload.result, ids(host.store)], ['stale', '', ['newer']]);
});

test('所持パル（share-upload）: 登録の確定から送るときだけ world.force（間隔で予約しても付けたまま）。別の人が載せた同じセーブも、悪くならなければ書き直す', async () => {
  const up = uploadServer();
  // 別の人の PC が、同じセーブ（中の時刻が同じ）を Players の 1 つを読めないまま先に共有した
  const theirs = setup({ server: up.as('別の人'), runImport: async () => stampedSnapshot(tickOf(6), 2, { skipped: [{ path: PLAYERS_2, reason: 'ファイルが見つかりません' }] }) });
  await theirs.register(WORLD_A, hostFiles(T0 + 5000));
  await settleUpload(theirs.store);
  // この PC で全部のファイルを登録した（登録の確定）: 別の人の共有でも、悪くならないので resent で書き直す
  let next = stampedSnapshot(tickOf(6), 2);
  const host = setup({ server: up.server, runImport: async () => next });
  const files = hostFiles();
  await host.register(WORLD_A, files);
  await settleUpload(host.store);
  assert.deepEqual([up.sent.at(-1).world.force, host.store.state.upload.result], [true, 'resent']);
  // 送ってから 15 秒たたずにファイルを足して登録し直すと、予約して送るが force は付けたまま
  host.advance(5000);
  await host.register(WORLD_A, { [PLAYERS_2]: fakeHandle('00000000000000000000000000000002.sav') });
  assert.deepEqual(pendingTimers(host).map((timer) => timer.ms), [10000]);
  await fireUpload(host);
  assert.equal(up.sent.at(-1).world.force, true);
  // その後のふつうの読み込みでは付けない
  next = stampedSnapshot(tickOf(7), 2);
  await readNewSave(host, files, { ms: 15000 });
  await settleUpload(host.store);
  assert.equal(up.sent.at(-1).world.force, false);
  // 三人目の PC が同じセーブを、より多くのファイルで登録して書き直した後は、この PC のふつうの送り直し（登録の確定でない）は same で書かない
  const later = setup({ server: up.as('三人目'), runImport: async () => stampedSnapshot(tickOf(7), 2, { used: ['Level.sav', 'LevelMeta.sav', PLAYERS, PLAYERS_2, '../GlobalPalStorage.sav'] }) });
  await later.register(WORLD_A, hostFiles(T0 + 9000));
  await settleUpload(later.store);
  assert.equal(later.store.state.upload.result, 'resent');
  later.advance(15000);
  assert.equal(await later.store.uploadLocal(), 'unchanged');
  host.advance(15000);
  assert.equal(await host.store.uploadLocal(), 'same');
  assert.equal(up.sent.at(-1).world.force, false);
});

test('所持パル（share-upload）: 新しいセーブを読んだら前の結果を消す（送れなかった知らせは次の応答まで残す）。案内は今読んでいるセーブの結果だけ', async () => {
  const { ownedNotices, uploadNotice } = await import('../../web/js/ui/owned-status.js');
  const up = uploadServer();
  const host = setup({ server: up.server, runImport: async () => stampedSnapshot(tickOf(8), 2) });
  await host.register(WORLD_A, hostFiles(T0));
  await settleUpload(host.store);
  let next = stampedSnapshot(tickOf(8), 2);
  const other = setup({ server: up.as('別の人'), runImport: async () => next });
  const files = hostFiles(T0 + 5000);
  await other.register(WORLD_A, files);
  await settleUpload(other.store);
  assert.equal(other.store.state.upload.status, 'same');
  assert.deepEqual(uploadNotice(other.store.state), { text: '同じセーブが共有済み（ホスト の PC から）', kind: 'info' });
  assert.ok(ownedNotices(other.store.state).some((notice) => notice.text === '同じセーブが共有済み（ホスト の PC から）'));
  // 15 秒たたずに新しいセーブを読んだ（送るのは予約）: 前の結果は消え、案内も出ない
  next = stampedSnapshot(tickOf(9), 2);
  await readNewSave(other, files, { ms: 3000 });
  assert.deepEqual(other.store.state.upload, { status: '', at: '', error: '', worldId: '', result: '', signature: '', stamp: '', savedAt: '', scope: '', userId: '', published: null });
  assert.equal(uploadNotice(other.store.state), null);
  // 送れなかった知らせは、新しいセーブを読んでも次の応答まで残す
  up.control.failures.push('CONNECTION');
  await fireUpload(other);
  assert.equal(other.store.state.upload.status, 'error');
  next = stampedSnapshot(tickOf(10), 2);
  await readNewSave(other, files, { ms: 3000 });
  assert.equal(other.store.state.upload.status, 'error');
  // 前のセーブを送った結果は、印が今のセーブと違えば案内に出さない
  const state = { ...other.store.state, upload: { ...other.store.state.upload, status: 'same', signature: 'old', published: { uploadedBy: 'ホスト' } } };
  assert.equal(uploadNotice(state), null);
});

test('所持パル（share-upload）: 送っている間に別のワールドのセーブを読んだら、前のワールドの再試行は捨てるが、新しいワールドの送信は終わった後に送る', async () => {
  const up = uploadServer();
  const host = setup({ server: up.server, runImport: async () => stampedSnapshot(tickOf(1), 2) });
  const release = up.hold();
  await host.register(WORLD_A, hostFiles(T0));
  await until(() => up.sent.length === 1);
  up.control.failures.push('CONNECTION');
  // 送っている間に、もっと新しく遊んだワールド B を登録して読む（共有を止めて切り替え、B の送信は dirty で待つ）
  host.advance(20000);
  await host.register(WORLD_B, hostFiles(T0 + 60000));
  assert.equal(host.store.state.linkedWorldId, WORLD_B);
  release();
  await until(() => up.sent.length === 2);
  await settleUpload(host.store);
  // A の失敗の再試行は予約しない。B は送れた
  assert.deepEqual(up.sent.map((input) => input.worldId), [WORLD_A, WORLD_B]);
  assert.deepEqual([host.store.state.upload.status, host.store.state.upload.worldId, pendingTimers(host).length], ['done', WORLD_B, 0]);
});

test('所持パル（share-upload）: 予約の間に読み直したセーブが読めず、今のセーブのまま（unchanged）になっても、取り消した予約を戻して送る', async () => {
  const up = uploadServer();
  const host = setup({ server: up.server, runImport: async () => stampedSnapshot(tickOf(1), 2) });
  const files = hostFiles();
  up.control.failures.push('CONNECTION');
  await host.register(WORLD_A, files);
  await settleUpload(host.store);
  const [retry] = pendingTimers(host);
  assert.equal(retry.ms, 15000);
  // 「今すぐ読み込む」で読み直したが、ゲームの保存中で読めなかった（予約は読み直しの間に取り消される）
  files['Level.sav'].readError = 'NotReadableError';
  await assert.rejects(host.store.refreshAuto(), /ゲームの保存中かもしれません/);
  assert.equal(retry.cancelled, true);
  files['Level.sav'].readError = '';
  // 次の定期の確かめはセーブが変わっていない（unchanged）。再試行の時刻を過ぎていれば、すぐ送る
  host.advance(21000);
  assert.equal(await host.store.autoRefresh(), 'unchanged');
  await settleUpload(host.store);
  assert.deepEqual([up.sent.length, host.store.state.upload.status], [2, 'done']);
  // 変わっていない回が続いても、もう送らない
  host.advance(21000);
  assert.equal(await host.store.autoRefresh(), 'unchanged');
  await settleUpload(host.store);
  assert.equal(up.sent.length, 2);
});

test('所持パル（share-upload）: 結果は、キャッシュの保存を待つ間に新しいセーブの解析が終わって消えても、その前に購読者へ知らせる（7 の自動登録が応答を取りこぼさない）', async () => {
  const up = uploadServer();
  const persist = memoryPersist();
  let host;
  // 共有のキャッシュの保存（送れた後）を止める
  let cacheGate = null;
  let blocked = false;
  const set = persist.set;
  persist.set = async (key, value) => {
    if (cacheGate && key.includes('.owned.shared.') && host.store.state.upload.status === 'done') {
      blocked = true;
      await cacheGate;
    }
    return set(key, value);
  };
  // セーブの解析を止める（解析の途中では画面に知らせない）
  let parseGate = null;
  let next = stampedSnapshot(tickOf(1), 2);
  host = setup({ server: up.server, persist, runImport: async () => { if (parseGate) await parseGate; return next; } });
  const seen = [];
  host.store.subscribe((state) => seen.push(`${state.upload.status}:${state.upload.result}:${state.upload.stamp}`));
  const files = hostFiles();
  const releaseUpload = up.hold();
  await host.register(WORLD_A, files);
  await until(() => up.sent.length === 1);
  // 送っている間に新しいセーブを読み始め、解析の途中で止める
  let releaseParse;
  parseGate = new Promise((resolve) => { releaseParse = resolve; });
  next = stampedSnapshot(tickOf(2), 2);
  files['Level.sav'].time += 30000;
  files['LocalData.sav'].time += 30000;
  host.advance(1000);
  const reading = host.store.refreshAuto();
  await until(() => host.store.state.progress === 'セーブを読み込み中…');
  // 応答が届き（結果を入れて）、キャッシュの保存を待つ間に解析が終わる（新しいセーブを読んだので結果を消す）
  let releaseCache;
  cacheGate = new Promise((resolve) => { releaseCache = resolve; });
  releaseUpload();
  await until(() => blocked);
  parseGate = null;
  releaseParse();
  assert.equal(await reading, 'imported');
  // 前のセーブの結果は消えた（新しいセーブは、送っている途中の 1 回が終わった後に送る）が、消える前に購読者は done を受け取っている
  assert.equal(host.store.state.upload.status, '');
  assert.ok(seen.includes(`done:new:${tickOf(1)}`), seen.join(' '));
  cacheGate = null;
  releaseCache();
  await settleUpload(host.store);
  await fireUpload(host);
  assert.deepEqual(up.sent.map((input) => input.world.saveStamp), [tickOf(1), tickOf(2)]);
});

// ---- セーブのファイルの見張り・読み直しの保留（sync-fixes の save-watch） ----

const DPS = 'Players/00000000000000000000000000000001_dps.sav';
const withDps = (time = T0) => ({ ...hostFiles(time), [DPS]: fakeHandle('00000000000000000000000000000001_dps.sav', { time }) });
// ゲームの保存（Level.sav と LocalData.sav の時刻を進める）
const newSave = (files) => {
  files['Level.sav'].time += 30000;
  files['LocalData.sav'].time += 30000;
};
// 見張り（save/watch.js の createWatchClient）の代わり。送られた対象と、owned.js が渡した知らせの受け口を残す
function fakeWatch() {
  const fake = { created: 0, updates: [], stops: 0, callbacks: null };
  fake.client = (callbacks) => {
    fake.created++;
    fake.callbacks = callbacks;
    return { update: (targets) => { fake.updates.push(targets); }, stop: () => { fake.stops++; } };
  };
  return fake;
}
// 対象の形（Observer に渡すファイルには * を付ける）
const targetShape = (targets) => targets.map(({ worldId, host, files }) => [worldId, host, files.map(({ path, observe }) => `${path}${observe ? '*' : ''}`)]);
// 読み直しの予約（ms の待ち）の時刻まで進めて動かし、その読み込みの結果を返す
async function fireReread(host, ms) {
  const timer = pendingTimers(host).filter((item) => item.ms === ms).at(-1);
  assert.ok(timer, `${ms} ms の読み直しの予約がありません: ${pendingTimers(host).map((item) => item.ms).join(',')}`);
  timer.fired = true;
  host.advance(ms);
  return timer.fn();
}

test('所持パル（save-watch）: 見張る対象は読めたワールドだけ。今のワールドは登録した全ファイル（Observer は直下だけで、Players・GlobalPalStorage.sav は 5 秒の確認）、ほかは Level.sav・LocalData.sav を 5 秒の確認だけ。同じ対象は送り直さない', async () => {
  const fake = fakeWatch();
  const { store, register, advance } = setup({ watch: fake.client });
  const a = { ...withDps(T0 + 60000), '../GlobalPalStorage.sav': fakeHandle('GlobalPalStorage.sav', { time: T0 + 60000 }) };
  const b = hostFiles(T0);
  await register(WORLD_A, a);
  await register(WORLD_B, b);
  assert.equal(fake.created, 1);
  const last = () => fake.updates.at(-1);
  assert.deepEqual(targetShape(last()), [
    [WORLD_A, true, ['Level.sav*', 'LevelMeta.sav*', 'LocalData.sav*', PLAYERS, DPS, '../GlobalPalStorage.sav']],
    [WORLD_B, true, ['Level.sav', 'LocalData.sav']],
  ]);
  // Players の中・上のフォルダのファイルは、Observer の対象にしない（SaveSync の同期を止めないため）。Observer は今のワールドだけ
  for (const target of fake.updates.flat()) {
    for (const file of target.files) if (file.observe) assert.ok(!/[\\/]/.test(file.path), file.path);
    assert.ok(target.files.every((file) => file.handle && typeof file.handle.getFile === 'function'));
  }
  // 同じ対象なら送り直さない
  const count = fake.updates.length;
  advance(25000);
  assert.equal(await store.autoRefresh(), 'unchanged');
  assert.equal(fake.updates.length, count);
  // 許可のないワールドは外す
  b['Level.sav'].permission = 'prompt';
  advance(25000);
  assert.equal(await store.autoRefresh(), 'permission');
  assert.deepEqual(last().map((target) => target.worldId), [WORLD_A]);
  // 使うワールドを選んだら、そのワールドだけ（今のワールドなので全ファイル）
  b['Level.sav'].permission = 'granted';
  await store.selectAutoWorld(WORLD_B);
  assert.deepEqual(targetShape(last()), [[WORLD_B, true, ['Level.sav*', 'LevelMeta.sav*', 'LocalData.sav*', PLAYERS]]]);
  assert.equal(fake.stops, 0);
});

test('所持パル（save-watch）: Observer も Worker もない環境（Node）では見張りが timer になり、登録をすべて消したら見張りを止める', async () => {
  const { store, register } = setup();
  assert.deepEqual(store.state.watch, { mode: '', lastSave: null });
  await register(WORLD_A, hostFiles());
  assert.equal(store.state.watch.mode, 'timer');
  await store.removeWorld(WORLD_A);
  assert.deepEqual(store.state.watch, { mode: '', lastSave: null });
  // 偽の見張りでも、登録を消したら stop を呼ぶ
  const fake = fakeWatch();
  const other = setup({ watch: fake.client });
  await other.register(WORLD_A, hostFiles());
  fake.callbacks.onMode('observer');
  assert.equal(other.store.state.watch.mode, 'observer');
  await other.store.removeWorld(WORLD_A);
  assert.equal(fake.stops > 0, true);
  assert.deepEqual(other.store.state.watch, { mode: '', lastSave: null });
});

test('所持パル（save-watch）: refreshFromWatch は見張りから読み（共有は読まない）、読み込み中・順番待ちの間の知らせは 1 回にまとめる。最後の保存は今のワールドの知らせから', async () => {
  const fake = fakeWatch();
  const shared = sharedServer();
  const { store, register, advance, calls } = setup({ server: shared.server, watch: fake.client });
  const files = hostFiles();
  await register(WORLD_A, files);
  await settleUpload(store);
  // 見張っていないワールドは読まない
  assert.equal(await store.refreshFromWatch(WORLD_B), 'skipped');
  shared.calls.length = 0;
  let release;
  files['Level.sav'].gate = new Promise((resolve) => { release = resolve; });
  newSave(files);
  advance(1000);
  const first = store.refreshFromWatch(WORLD_A);
  await tick();
  assert.equal(store.state.busy, true);
  // 読み込みの途中に続けて来た知らせは、終わった後の 1 回にまとめる
  const at = T0 + 30000;
  fake.callbacks.onSettled({ type: 'settled', generation: 1, worldId: WORLD_A, changed: ['LocalData.sav', 'Level.sav', 'LevelMeta.sav', PLAYERS], firstAt: at, lastAt: at + 800, reason: 'quiet' });
  const second = store.refreshFromWatch(WORLD_A);
  assert.equal(store.refreshFromWatch(WORLD_A), second);
  assert.deepEqual(store.state.watch.lastSave, { at: new Date(at + 800).toISOString(), files: 4, spanMs: 800 });
  // 見張っていないワールドの知らせは捨てる
  fake.callbacks.onSettled({ type: 'settled', generation: 1, worldId: WORLD_B, changed: ['LocalData.sav'], firstAt: at + 5000, lastAt: at + 5000, reason: 'quiet' });
  assert.equal(store.state.watch.lastSave.files, 4);
  files['Level.sav'].gate = null;
  release();
  assert.equal(await first, 'imported');
  assert.equal(await second, 'unchanged');
  assert.equal(calls.imports, 2);
  // 共有は読まない（読んだセーブの送信は今までどおり）
  assert.deepEqual(shared.calls.filter((action) => ['ownedWorlds', 'ownedSince', 'owned'].includes(action)), []);
});

test('所持パル（save-watch）: 読む前と後でファイルの印が違えば（保存の途中に読んだ）採用せず、前のデータを残して 1 秒後に読み直す', async () => {
  const host = setup();
  const { store, register, advance, calls } = host;
  const files = hostFiles();
  await register(WORLD_A, files);
  const before = store.state.local;
  let release;
  files['Level.sav'].gate = new Promise((resolve) => { release = resolve; });
  newSave(files);
  advance(25000);
  const reading = store.autoRefresh();
  await tick();
  // Level.sav を読んでいる間に LevelMeta.sav が書かれた
  files['LevelMeta.sav'].time += 30000;
  files['Level.sav'].gate = null;
  release();
  assert.equal(await reading, 'held');
  assert.equal(store.state.local, before);
  assert.equal(calls.imports, 1);
  assert.deepEqual([store.state.error, store.state.auto.status, store.state.busy], ['', 'ready', false]);
  assert.equal(await fireReread(host, 1000), 'imported');
  assert.equal(calls.imports, 2);
  assert.notEqual(store.state.local, before);
  assert.deepEqual(pendingTimers(host), []);
});

test('所持パル（save-watch）: 登録した _dps.sav の一時的な消失は採用せず 1・3・10・30 秒で読み直し、戻れば全部読んで採用する（開き直した直後の最初の読み込みでも）', async () => {
  const host = setup();
  const { store, register, advance } = host;
  const files = withDps();
  await register(WORLD_A, files);
  const before = store.state.local;
  files[DPS].gone = true;
  newSave(files);
  advance(25000);
  assert.equal(await store.autoRefresh(), 'held');
  // 前の完全なデータ・表示を残し、共有もそのまま
  assert.deepEqual([store.state.local, store.state.uploadReady, store.state.error], [before, true, '']);
  assert.deepEqual(pendingTimers(host).map((timer) => timer.ms), [1000]);
  assert.equal(await fireReread(host, 1000), 'held');
  // 次は最初に見た時刻から 3 秒
  assert.deepEqual(pendingTimers(host).map((timer) => timer.ms), [2000]);
  files[DPS].gone = false;
  assert.equal(await fireReread(host, 2000), 'imported');
  assert.deepEqual(store.state.local.snapshot.files.skipped, []);
  assert.deepEqual(pendingTimers(host), []);
  // 開き直した直後の最初の読み込みでも同じ（保存済みのデータを出したまま、共有はしない）
  files[DPS].gone = true;
  newSave(files);
  const reopened = host.make();
  await reopened.load();
  const saved = reopened.state.local;
  assert.equal(await reopened.autoRefresh(), 'held');
  assert.deepEqual([reopened.state.local, reopened.state.uploadReady], [saved, false]);
  files[DPS].gone = false;
  assert.equal(await fireReread(host, 1000), 'imported');
  assert.equal(reopened.state.uploadReady, true);
});

test('所持パル（save-watch）: 30 秒を超えて消えたままなら飛ばして採用し、同じ形なら次から待たない。形が変われば待ち直し、全部読めたら忘れる', async () => {
  const host = setup();
  const { store, register, advance } = host;
  const files = withDps();
  await register(WORLD_A, files);
  files[DPS].gone = true;
  newSave(files);
  advance(25000);
  assert.equal(await store.autoRefresh(), 'held');
  for (const ms of [1000, 2000, 7000]) assert.equal(await fireReread(host, ms), 'held', String(ms));
  assert.equal(await fireReread(host, 20000), 'imported');
  assert.deepEqual(store.state.local.snapshot.files.skipped.map((file) => file.path), [DPS]);
  // 消したままの次のセーブは、待たずに採用する（毎回 30 秒遅れない）
  newSave(files);
  advance(25000);
  assert.equal(await store.autoRefresh(), 'imported');
  // 形が変わった（Players も消えた）ので待ち直す
  files[PLAYERS].gone = true;
  newSave(files);
  advance(25000);
  assert.equal(await store.autoRefresh(), 'held');
  // 全部戻れば採用し、受け入れた形を忘れる（次に _dps.sav が消えたら、また待つ）
  files[PLAYERS].gone = false;
  files[DPS].gone = false;
  assert.equal(await fireReread(host, 1000), 'imported');
  assert.deepEqual(store.state.local.snapshot.files.skipped, []);
  files[DPS].gone = true;
  newSave(files);
  advance(25000);
  assert.equal(await store.autoRefresh(), 'held');
});

test('所持パル（save-watch）: 印の変わらない壊れたファイル（解析で読めない）も保留し、30 秒たって同じなら飛ばして採用する（その後は読み直さない）', async () => {
  let broken = false;
  const runImport = async (files) => ({ ...snapshot(files.length + 1), files: { used: [], skipped: broken ? [{ path: DPS, reason: '解凍後の大きさが合いません' }] : [] } });
  const host = setup({ runImport });
  const { store, register, advance } = host;
  const files = withDps();
  await register(WORLD_A, files);
  broken = true;
  newSave(files);
  advance(25000);
  assert.equal(await store.autoRefresh(), 'held');
  advance(30000);
  assert.equal(await store.autoRefresh(), 'imported');
  assert.deepEqual(store.state.local.snapshot.files.skipped, [{ path: DPS, reason: '解凍後の大きさが合いません' }]);
  assert.deepEqual(pendingTimers(host), []);
  advance(25000);
  assert.equal(await store.autoRefresh(), 'unchanged');
});

test('所持パル（save-watch）: 見張りから読んだときの読めない失敗（解析・NOT_READABLE）は、エラーを出さずに 1・3・10 秒で読み直し、3 回目もだめなら今の扱い（定期の確認ではすぐ）', async () => {
  let failing = false;
  const fake = fakeWatch();
  const runImport = async (files) => {
    if (failing) throw new Error('Level.sav を解析できませんでした（テスト）');
    return snapshot(files.length + 1);
  };
  const host = setup({ watch: fake.client, runImport });
  const { store, register, advance } = host;
  const files = hostFiles();
  await register(WORLD_A, files);
  const before = store.state.local;
  failing = true;
  newSave(files);
  advance(1000);
  assert.equal(await store.refreshFromWatch(WORLD_A), 'held');
  assert.deepEqual([store.state.error, store.state.auto.status, store.state.local], ['', 'ready', before]);
  assert.equal(await fireReread(host, 1000), 'held');
  assert.equal(await fireReread(host, 2000), 'held');
  assert.equal(await fireReread(host, 7000), 'error');
  assert.match(store.state.error, /解析できませんでした/);
  assert.equal(store.state.local, before);
  assert.deepEqual(pendingTimers(host), []);
  // 読めるようになれば読む（エラーも消える）
  failing = false;
  advance(1000);
  assert.equal(await store.refreshFromWatch(WORLD_A), 'imported');
  assert.equal(store.state.error, '');
  // ゲームの保存中（NotReadableError）も同じく待つ
  files['Level.sav'].readError = 'NotReadableError';
  newSave(files);
  advance(1000);
  assert.equal(await store.refreshFromWatch(WORLD_A), 'held');
  files['Level.sav'].readError = '';
  assert.equal(await fireReread(host, 1000), 'imported');
  // 定期の確認（見張りからでない）では、今までどおりすぐ失敗にする
  failing = true;
  newSave(files);
  advance(25000);
  assert.equal(await store.autoRefresh(), 'error');
  assert.match(store.state.error, /解析できませんでした/);
  assert.deepEqual(pendingTimers(host), []);
});

test('所持パル（save-watch）: 見張りから読んだときに必須のファイルが一時的に消えていても、別のワールドに替えたり止めたりせずに読み直す', async () => {
  const fake = fakeWatch();
  const host = setup({ watch: fake.client });
  const { store, register, advance } = host;
  const a = hostFiles(T0 + 60000);
  await register(WORLD_B, hostFiles(T0));
  await register(WORLD_A, a);
  assert.equal(store.state.linkedWorldId, WORLD_A);
  a['Level.sav'].gone = true;
  a['LocalData.sav'].time += 30000;
  advance(1000);
  assert.equal(await store.refreshFromWatch(WORLD_A), 'held');
  assert.deepEqual([store.state.linkedWorldId, store.state.data.world.id, store.state.auto.status, store.state.role], [WORLD_A, WORLD_A, 'ready', 'host']);
  a['Level.sav'].gone = false;
  a['Level.sav'].time += 30000;
  assert.equal(await fireReread(host, 1000), 'imported');
  assert.equal(store.state.data.world.id, WORLD_A);
});

test('所持パル（save-watch）: 今のワールドが一時的に読めず（getFile の NotReadableError）一覧の後ろに回っても、古いワールドに替えずに保留し、見張りからも外さない（Codex のレビュー）', async () => {
  const fake = fakeWatch();
  const host = setup({ watch: fake.client });
  const { store, register, advance } = host;
  const a = hostFiles(T0 + 60000);
  await register(WORLD_B, hostFiles(T0));
  await register(WORLD_A, a);
  assert.equal(store.state.linkedWorldId, WORLD_A);
  // 保存の途中で A の更新日時を読めない（A は一覧の先頭でなくなり、古い B が先頭になる）
  a['Level.sav'].error = 'NotReadableError';
  a['LocalData.sav'].error = 'NotReadableError';
  advance(1000);
  assert.equal(await store.refreshFromWatch(WORLD_A), 'held');
  assert.deepEqual([store.state.linkedWorldId, store.state.data.world.id, store.state.role], [WORLD_A, WORLD_A, 'host']);
  // 読めない間も A を見張り続ける（戻ったことに Worker が気づける）
  assert.ok(fake.updates.at(-1).some((target) => target.worldId === WORLD_A));
  a['Level.sav'].error = '';
  a['LocalData.sav'].error = '';
  newSave(a);
  assert.equal(await fireReread(host, 1000), 'imported');
  assert.equal(store.state.data.world.id, WORLD_A);
  // B が知らせても、読めない今のワールド A で保留する（まとめた知らせも同じ）
  a['Level.sav'].error = 'NotReadableError';
  a['LocalData.sav'].error = 'NotReadableError';
  advance(1000);
  assert.equal(await store.refreshFromWatch(WORLD_B), 'held');
  assert.equal(store.state.linkedWorldId, WORLD_A);
});

test('所持パル（save-watch）: 保留の間も前の完全なデータの共有を止めない（取り消した再試行の予約は、今のセーブのまま戻す）', async () => {
  const up = uploadServer();
  let next = stampedSnapshot(tickOf(1), 2);
  const host = setup({ server: up.server, runImport: async () => next });
  const files = withDps();
  up.control.failures.push('CONNECTION');
  await host.register(WORLD_A, files);
  await settleUpload(host.store);
  const [retry] = pendingTimers(host);
  assert.equal(retry.ms, 15000);
  // 新しいセーブを読んだが、_dps.sav が一時的に消えていた（保留）
  next = stampedSnapshot(tickOf(2), 3);
  files[DPS].gone = true;
  newSave(files);
  host.advance(5000);
  assert.equal(await host.store.refreshAuto({ auto: true }), 'held');
  await tick();
  assert.equal(retry.cancelled, true);
  // 再試行の予約（時刻は最初の段のまま）と、読み直しの予約
  assert.deepEqual(pendingTimers(host).map((timer) => timer.ms).sort((x, y) => x - y), [1000, 10000]);
  assert.equal(host.store.state.uploadReady, true);
  const resend = pendingTimers(host).find((timer) => timer.ms === 10000);
  resend.fired = true;
  host.advance(10000);
  resend.fn();
  await settleUpload(host.store);
  assert.deepEqual(up.sent.map((input) => input.world.saveStamp), [tickOf(1), tickOf(1)]);
  assert.equal(host.store.state.upload.status, 'done');
});

test('所持パル（save-watch）: 別のワールドに替わった・登録を消したら、読み直しの予約を止める', async () => {
  const host = setup();
  const { store, register, advance } = host;
  const files = withDps();
  await register(WORLD_A, files);
  files[DPS].gone = true;
  newSave(files);
  advance(25000);
  assert.equal(await store.autoRefresh(), 'held');
  const [waiting] = pendingTimers(host);
  // もっと新しく遊んだワールド B を登録して読む
  await register(WORLD_B, hostFiles(T0 + 120000));
  assert.equal(store.state.linkedWorldId, WORLD_B);
  assert.equal(waiting.cancelled, true);
  // 登録を消す
  const other = setup();
  const otherFiles = withDps();
  await other.register(WORLD_A, otherFiles);
  otherFiles[DPS].gone = true;
  newSave(otherFiles);
  other.advance(25000);
  assert.equal(await other.store.autoRefresh(), 'held');
  const [timer] = pendingTimers(other);
  await other.store.removeWorld(WORLD_A);
  assert.equal(timer.cancelled, true);
  assert.equal(await timer.fn(), 'skipped');
});

// ---- ゲーム中の推定（sync-fixes の host-rotation） ----

// seconds 秒のセーブの中の保存時刻（生のティック）
const secondsTick = (seconds) => String(638650000000000000n + BigInt(seconds) * 10_000_000n);
// 今のワールド・今の役割でゲーム中か（画面と同じ使い方）
const playingOf = (host) => isPlaying(host.store.state.play, { worldId: host.store.state.linkedWorldId, role: host.store.state.role }, host.time());

test('所持パル（host-rotation）: ホストは登録したファイルから読んだ Level.sav の中の保存時刻でゲーム中を数える（最初の読み込みは基準だけ・2 分で外れる）', async () => {
  let seconds = 0;
  const host = setup({ runImport: async () => stampedSnapshot(secondsTick(seconds)) });
  const files = hostFiles();
  await host.register(WORLD_A, files);
  // 登録の確定で読んだセーブは基準だけ
  assert.deepEqual(host.store.state.play, { worldId: WORLD_A, role: 'host', value: playTicksMs(secondsTick(0)), changes: [] });
  assert.equal(playingOf(host), false);
  seconds = 30;
  newSave(files);
  host.advance(30000);
  assert.equal(await host.store.autoRefresh(), 'imported');
  assert.equal(playingOf(host), false);
  // 変わっていないセーブの確認では数えない
  host.advance(25000);
  assert.equal(await host.store.autoRefresh(), 'unchanged');
  seconds = 60;
  newSave(files);
  host.advance(20000);
  assert.equal(await host.store.autoRefresh(), 'imported');
  assert.deepEqual(host.store.state.play.changes.map((change) => change.gap), [30000, 30000]);
  assert.equal(playingOf(host), true);
  // 直近 2 分に変化がなければ外れる
  host.advance(2 * 60 * 1000 + 1);
  assert.equal(playingOf(host), false);
});

test('所持パル（host-rotation）: 参加者は一覧の LocalData.sav の更新日時でゲーム中を数える。役割が変われば数え直す', async () => {
  const host = setup();
  const files = hostFiles();
  await host.register(WORLD_A, files);
  assert.equal(host.store.state.play.role, 'host');
  // 参加すると LocalData.sav だけが新しくなる（参加者と判定した値を基準に数え直す）
  files['LocalData.sav'].time = T0 + 30000;
  host.advance(25000);
  assert.equal(await host.store.autoRefresh(), 'guest');
  assert.deepEqual(host.store.state.play, { worldId: WORLD_A, role: 'guest', value: T0 + 30000, changes: [] });
  for (const step of [1, 2]) {
    files['LocalData.sav'].time += 30000;
    host.advance(25000);
    assert.equal(await host.store.autoRefresh(), 'guest', String(step));
  }
  assert.deepEqual(host.store.state.play.changes.map((change) => change.gap), [30000, 30000]);
  assert.equal(playingOf(host), true);
  // 参加しただけのワールド（LocalData.sav だけの登録）も同じ
  const guest = setup();
  const local = fakeHandle('LocalData.sav');
  assert.equal((await guest.register(WORLD_B, { 'LocalData.sav': local })).result, 'guest');
  assert.deepEqual(guest.store.state.play, { worldId: WORLD_B, role: 'guest', value: T0, changes: [] });
  local.time += 30000;
  guest.advance(25000);
  assert.equal(await guest.store.autoRefresh(), 'guest');
  assert.deepEqual(guest.store.state.play.changes, [{ at: guest.time(), gap: 30000 }]);
});

test('所持パル（host-rotation）: 見張りの対象が変わったら（見張りのやり直し）ゲーム中の推定を数え直す。初めて見張るときは読んだ基準を残す', async () => {
  const fake = fakeWatch();
  let seconds = 0;
  const host = setup({ watch: fake.client, runImport: async () => stampedSnapshot(secondsTick(seconds)) });
  const files = hostFiles();
  await host.register(WORLD_A, files);
  assert.equal(fake.updates.length, 1);
  assert.equal(host.store.state.play.value, playTicksMs(secondsTick(0)));
  for (const next of [30, 60]) {
    seconds = next;
    newSave(files);
    host.advance(30000);
    assert.equal(await host.store.refreshFromWatch(WORLD_A), 'imported');
  }
  assert.equal(playingOf(host), true);
  // 同じ対象のままなら送り直さず、数え直さない
  assert.equal(fake.updates.length, 1);
  // 登録を編集してファイルを足した（見張りの対象が変わった）
  await host.register(WORLD_A, { [PLAYERS_2]: fakeHandle('00000000000000000000000000000002.sav') });
  assert.equal(fake.updates.length, 2);
  assert.deepEqual(host.store.state.play, emptyPlay());
  assert.equal(playingOf(host), false);
  // 次に読んだ値が基準
  seconds = 90;
  newSave(files);
  host.advance(30000);
  assert.equal(await host.store.refreshFromWatch(WORLD_A), 'imported');
  assert.deepEqual(host.store.state.play, { worldId: WORLD_A, role: 'host', value: playTicksMs(secondsTick(90)), changes: [] });
});

// ---- Codex のレビューの直し（host-rotation） ----

test('所持パル（host-rotation・Codex のレビュー）: 共有の結果に、送ったセーブの更新日時（saveUpdatedAt と同じ値）と、送ったときの環境・ID を残す（送っている間・送れなかったときも）', async () => {
  const up = uploadServer();
  const host = setup({ server: up.server, runImport: async () => stampedSnapshot(tickOf(1), 2) });
  const release = up.hold();
  await host.register(WORLD_A, hostFiles());
  await until(() => up.sent.length === 1);
  const savedAt = host.store.state.local.world.updatedAt;
  assert.equal(up.sent[0].saveUpdatedAt, savedAt);
  const pick = () => {
    const { status, savedAt: at, scope, userId } = host.store.state.upload;
    return [status, at, scope, userId];
  };
  assert.deepEqual(pick(), ['sending', savedAt, 'test', 'ホスト']);
  release();
  await settleUpload(host.store);
  assert.deepEqual(pick(), ['done', savedAt, 'test', 'ホスト']);
  up.control.failures.push('VALIDATION');
  assert.equal(await host.store.uploadLocal({ force: true }), 'error');
  assert.deepEqual(pick(), ['error', savedAt, 'test', 'ホスト']);
});

test('所持パル（host-rotation・Codex のレビュー）: 共有を確かめたワールドを shared.fetchedWorldId に残す（取得に成功したときだけ。保存先が替われば空）', async () => {
  let failing = false;
  const shared = sharedServer({ rewrite: (action) => (failing && action !== 'ownedUpload' ? { ok: false, code: 'CONNECTION' } : undefined) });
  await publish(shared, { worldId: WORLD_A });
  await publish(shared, { worldId: WORLD_B });
  const viewer = setup({ server: shared.server });
  await viewer.store.load();
  assert.equal(viewer.store.state.shared.fetchedWorldId, '');
  await viewer.store.setViewWorld(WORLD_A);
  assert.equal(viewer.store.state.shared.fetchedWorldId, WORLD_A);
  // 別のワールドに替えて、その取得に失敗した: 確かめたのは前のワールドのまま
  failing = true;
  await viewer.store.setViewWorld(WORLD_B);
  assert.deepEqual([viewer.store.state.shared.fetchedWorldId, Boolean(viewer.store.state.shared.error)], [WORLD_A, true]);
  failing = false;
  await viewer.store.setViewWorld(WORLD_B);
  assert.equal(viewer.store.state.shared.fetchedWorldId, WORLD_B);
  // 保存先（ログイン中の環境）が替われば空（読めなければ空のまま）
  failing = true;
  shared.setScope('prod');
  await viewer.store.scopeChanged();
  assert.equal(viewer.store.state.shared.fetchedWorldId, '');
});

// ---------------------------------------------------------------------------
// page-presence（docs/sync-fixes/README.md の 8）: ページを開いている PC。ログインしているページは今のワールドについて 60 秒に 1 回送る
//（共有の読み直しの ownedSince に載せ、載せる回がなければ reportPresence で別に送る）
// ---------------------------------------------------------------------------
// 共有の操作に加えて、送った presence（[操作, ワールド, presence]。ownedSince に載せたものも）を記録する
function presenceServer({ rewrite = null, ...options } = {}) {
  const sent = [];
  const shared = sharedServer({
    ...options,
    rewrite: (action, input, pass) => {
      if (input.presence) sent.push([action, input.worldId, input.presence]);
      return rewrite?.(action, input, pass);
    },
  });
  return { ...shared, sent };
}
const deviceKey = (worldId) => `pal-note.test.owned.device.${worldId}`;
// app.js の 10 秒ごとのタイマーと同じ（表のタブは autoRefresh、裏のタブは pollAuto。その後に reportPresence）
async function timerTick(target, { hidden = false, step = 10000 } = {}) {
  target.advance(step);
  await (hidden ? target.store.pollAuto() : target.store.autoRefresh());
  return target.store.reportPresence();
}

test('所持パル（page-presence）: 表のタブは 10 秒ごとの ownedSince に 60 秒に 1 回 presence を載せ、別には送らない。ownedSince を呼ばない回（一覧の 5 分ごと）は別に送る', async () => {
  const shared = presenceServer({ userId: 'Bob' });
  await publish(shared, { prefix: 'a' });
  const viewer = setup({ server: shared.server });
  await viewer.store.load();
  shared.calls.length = 0;
  await viewer.store.autoRefresh();
  assert.deepEqual(shared.calls, ['ownedWorlds', 'ownedSince']);
  assert.equal(await viewer.store.reportPresence(), 'skipped');
  assert.deepEqual(shared.calls, ['ownedWorlds', 'ownedSince']);
  // 値: 連携していない（none）・ゲーム中でない・共有できない。device はワールドごとに localStorage に残す
  const device = viewer.storage.map.get(deviceKey(WORLD_A));
  assert.match(device, /^[0-9a-f]{32}$/);
  assert.equal(shared.sent.length, 1);
  const [action, worldId, presence] = shared.sent[0];
  assert.deepEqual([action, worldId], ['ownedSince', WORLD_A]);
  assert.match(presence.pageId, /^[0-9a-f]{32}$/);
  assert.notEqual(presence.pageId, device);
  assert.deepEqual(presence, { pageId: presence.pageId, device, user: 'Bob', role: 'none', playing: false, canShare: false });
  // 応答の一覧（この PC のページ）を今のワールドの一覧として残す
  const { pages } = viewer.store.state;
  assert.deepEqual([pages.worldId, pages.device, pages.list.map((page) => [page.user, page.device, page.role])], [WORLD_A, device, [['Bob', device, 'none']]]);
  assert.ok(Number.isFinite(Date.parse(pages.serverTime)));
  // 別の PC のページが送った（Alice のホストのページ）。載せない回の ownedSince の応答でも一覧は入れ替わる
  await shared.server.request('presence', { worldId: WORLD_A, presence: { pageId: 'alice-page-0001', device: 'alice-device-01', user: 'Alice', role: 'host', playing: true, canShare: true } });
  shared.sent.length = 0;
  for (let elapsed = 10000; elapsed < 5 * 60 * 1000; elapsed += 10000) {
    shared.calls.length = 0;
    assert.equal(await timerTick(viewer), 'skipped', `${elapsed} ms`);
    assert.deepEqual(shared.calls, ['ownedSince'], `${elapsed} ms`);
  }
  assert.deepEqual(viewer.store.state.pages.list.map((page) => [page.user, page.role]).sort(), [['Alice', 'host'], ['Bob', 'none']]);
  // 載せたのは 60・120・180・240 秒の ownedSince（同じページの ID）
  assert.deepEqual(shared.sent.map(([name, id, value]) => [name, id, value.pageId]), Array(4).fill(['ownedSince', WORLD_A, presence.pageId]));
  // 5 分は一覧だけを読む回（ownedSince を呼ばない）なので、別に送る
  shared.calls.length = 0;
  assert.equal(await timerTick(viewer), 'sent');
  assert.deepEqual(shared.calls, ['ownedWorlds', 'presence']);
  shared.calls.length = 0;
  assert.equal(await timerTick(viewer), 'skipped');
  assert.deepEqual(shared.calls, ['ownedSince']);
  assert.equal(shared.sent.length, 5);
});

test('所持パル（page-presence）: 裏のタブは共有を読まずに presence だけを 60 秒ごとに送る（タイマーが 1 分ごとまで遅れても、少し早く来ても 5 秒の余裕の中なら送る）', async () => {
  const shared = presenceServer({ userId: 'Bob' });
  await publish(shared, { prefix: 'a' });
  const viewer = setup({ server: shared.server });
  await viewer.store.load();
  await viewer.store.scopeChanged();
  assert.equal(shared.sent.length, 1);
  shared.calls.length = 0;
  for (let i = 0; i < 5; i++) assert.equal(await timerTick(viewer, { hidden: true }), 'skipped');
  assert.deepEqual(shared.calls, []);
  assert.equal(await timerTick(viewer, { hidden: true }), 'sent');
  assert.deepEqual(shared.calls, ['presence']);
  shared.calls.length = 0;
  assert.equal(await timerTick(viewer, { hidden: true, step: 56000 }), 'sent');
  assert.equal(await timerTick(viewer, { hidden: true, step: 54000 }), 'skipped');
  assert.equal(await timerTick(viewer, { hidden: true, step: 6000 }), 'sent');
  assert.deepEqual(shared.calls, ['presence', 'presence']);
  // 送った応答の一覧を残す
  assert.deepEqual([viewer.store.state.pages.worldId, viewer.store.state.pages.list.length], [WORLD_A, 1]);
  // ログインしていなければ送らない
  shared.setScope('');
  shared.calls.length = 0;
  assert.equal(await timerTick(viewer, { hidden: true, step: 60000 }), 'skipped');
  assert.deepEqual(shared.calls, []);
});

test('所持パル（page-presence）: 値は判定の結果（role）・ゲーム中の推定・共有できる（ホストの一式の登録＋読む許可）。値が変わったら間隔によらず次の回に送る', async () => {
  const shared = presenceServer();
  const host = setup({ server: shared.server });
  const files = hostFiles();
  await host.register(WORLD_A, files);
  await settleUpload(host.store);
  host.advance(60000);
  await host.store.reportPresence();
  const last = () => shared.sent.at(-1);
  assert.deepEqual([last()[1], last()[2].role, last()[2].playing, last()[2].canShare], [WORLD_A, 'host', false, true]);
  const count = shared.sent.length;
  // 同じ値なら 60 秒たつまで送らない
  host.advance(10000);
  assert.equal(await host.store.reportPresence(), 'skipped');
  // ゲーム中になった（直近 2 分に 30 秒ごとの変化を 2 回見た）: すぐ送る
  host.store.state.play = { worldId: WORLD_A, role: 'host', value: 60000, changes: [{ at: host.time() - 40000, gap: 30000 }, { at: host.time() - 10000, gap: 30000 }] };
  assert.equal(await host.store.reportPresence(), 'sent');
  assert.deepEqual([shared.sent.length, last()[2].playing], [count + 1, true]);
  // 読む許可が外れた: 共有できない
  for (const handle of Object.values(files)) handle.permission = 'prompt';
  host.advance(10000);
  await host.store.refreshAuto({ auto: true });
  assert.equal(host.store.state.auto.status, 'permission');
  assert.equal(await host.store.reportPresence(), 'sent');
  assert.deepEqual([last()[2].role, last()[2].canShare], ['host', false]);
  // 参加者（LocalData.sav だけの登録）は guest で、共有できない
  const guest = setup({ server: shared.server });
  await guest.register(WORLD_A, { 'LocalData.sav': fakeHandle('LocalData.sav') });
  guest.advance(60000);
  assert.equal(await guest.store.reportPresence(), 'sent');
  const first = last()[2];
  assert.deepEqual([first.role, first.canShare], ['guest', false]);
  // 2 つ目のタブ（同じ localStorage）: 同じ PC の ID・違うページの ID
  const tab = guest.make();
  await tab.load();
  await tab.fetchShared({ force: true });
  guest.advance(60000);
  assert.equal(await tab.reportPresence(), 'sent');
  const second = last()[2];
  assert.equal(second.device, first.device);
  assert.notEqual(second.pageId, first.pageId);
});

test('所持パル（page-presence）: ワールドを替えたら間隔によらず、そのワールドについて送る（PC の ID はワールドごと）。環境が替わったら一覧を空にする', async () => {
  const shared = presenceServer({ userId: 'Bob' });
  await publish(shared, { worldId: WORLD_A, prefix: 'a' });
  await publish(shared, { worldId: WORLD_B, prefix: 'b' });
  const viewer = setup({ server: shared.server });
  await viewer.store.load();
  await viewer.store.setViewWorld(WORLD_A);
  await viewer.store.reportPresence();
  assert.equal(shared.sent.at(-1)[1], WORLD_A);
  await viewer.store.setViewWorld(WORLD_B);
  await viewer.store.reportPresence();
  const [, worldId, presence] = shared.sent.at(-1);
  assert.equal(worldId, WORLD_B);
  assert.equal(presence.device, viewer.storage.map.get(deviceKey(WORLD_B)));
  assert.notEqual(presence.device, viewer.storage.map.get(deviceKey(WORLD_A)));
  assert.equal(viewer.store.state.pages.worldId, WORLD_B);
  // 開き直したページ: 同じ PC の ID・新しいページの ID
  const again = viewer.make();
  await again.load();
  await again.setViewWorld(WORLD_B);
  await again.reportPresence();
  assert.equal(shared.sent.at(-1)[2].device, presence.device);
  assert.notEqual(shared.sent.at(-1)[2].pageId, presence.pageId);
  shared.setScope('prod');
  await viewer.store.scopeChanged();
  assert.deepEqual([viewer.store.state.pages.worldId, viewer.store.state.pages.list], ['', null]);
});

test('所持パル（page-presence）: 古い GAS（BAD_ACTION）なら 1 時間は送らない（ownedSince の BAD_ACTION でも覚える）。presence の失敗は共有・読み込みを失敗させない', async () => {
  let oldGas = true;
  let failing = false;
  let unknownList = false;
  const shared = presenceServer({
    userId: 'Bob',
    rewrite: async (action, input, pass) => {
      if (oldGas && ['ownedSince', 'presence'].includes(action)) return { ok: false, code: 'BAD_ACTION' };
      if (failing && action === 'presence') return { ok: false, code: 'CONNECTION' };
      // サーバーのキャッシュを読めなかった（一覧が null）
      if (unknownList && action === 'ownedSince') return { ...(await pass()), presence: null };
      return undefined;
    },
  });
  await publish(shared, { prefix: 'a' });
  const viewer = setup({ server: shared.server });
  await viewer.store.load();
  shared.calls.length = 0;
  assert.equal(await viewer.store.autoRefresh(), 'fetched');
  // ownedSince の BAD_ACTION で presence も古いと覚え、別には送らない（ownedSince に載せた 1 回だけ）
  assert.deepEqual(shared.calls, ['ownedWorlds', 'ownedSince', 'owned']);
  assert.equal(await viewer.store.reportPresence(), 'skipped');
  assert.equal(await timerTick(viewer, { step: 60000 }), 'skipped');
  assert.deepEqual(shared.sent.map(([action]) => action), ['ownedSince']);
  assert.deepEqual([viewer.store.state.pages.list, viewer.store.state.shared.error], [null, '']);
  assert.deepEqual(ids(viewer.store), ['a0', 'a1']);
  // 裏のタブ（ownedSince を呼ばない）で presence の BAD_ACTION を受けたときも覚える
  const background = setup({ server: shared.server, persist: viewer.persist });
  await background.store.load();
  assert.equal(await background.store.reportPresence(), 'error');
  assert.equal(await timerTick(background, { hidden: true, step: 60000 }), 'skipped');
  assert.equal(await timerTick(background, { hidden: true, step: 60 * 60 * 1000 - 60000 - 1 }), 'skipped');
  // 1 時間たったら試し直す
  oldGas = false;
  assert.equal(await timerTick(background, { hidden: true, step: 1 }), 'sent');
  // 一覧を読めない応答（null）でも共有は読め、一覧は前のまま
  const { pages } = background.store.state;
  assert.equal(pages.list.length, 1);
  unknownList = true;
  assert.equal(await background.store.autoRefresh(), 'fetched');
  background.advance(10000);
  shared.calls.length = 0;
  assert.equal(await background.store.autoRefresh(), 'fetched');
  assert.deepEqual(shared.calls, ['ownedSince']);
  assert.equal(background.store.state.pages, pages);
  // 送れなかった（通信）: 例外にせず 'error'。共有のエラーにもしない。次は 60 秒後
  failing = true;
  assert.equal(await timerTick(background, { hidden: true, step: 60000 }), 'error');
  assert.equal(background.store.state.shared.error, '');
  assert.deepEqual(ids(background.store), ['a0', 'a1']);
  assert.equal(await timerTick(background, { hidden: true }), 'skipped');
  failing = false;
  assert.equal(await timerTick(background, { hidden: true, step: 50000 }), 'sent');
});

test('所持パル（page-presence）: ホストと参加者のページが同じ開発用 API に送ると、互いの一覧に出る（ヘッダーのパネルの行）', async () => {
  const { openPagesLines } = await import('../../web/js/ui/owned-status.js');
  const shared = presenceServer();
  const host = setup({ server: shared.server });
  await host.register(WORLD_A, hostFiles());
  await settleUpload(host.store);
  host.advance(60000);
  await host.store.reportPresence();
  const guest = setup({ server: shared.server });
  await guest.register(WORLD_A, { 'LocalData.sav': fakeHandle('LocalData.sav') });
  guest.advance(60000);
  assert.equal(await guest.store.reportPresence(), 'sent');
  // 開発用 API は 1 つの ID（ホスト）なので、同じ人の 2 台の PC として出る
  const lines = openPagesLines(guest.store.state, { now: guest.time });
  assert.equal(lines.length, 2);
  assert.ok(lines.every((line) => line.startsWith('● ホスト')));
  assert.ok(lines.some((line) => /^● ホスト（(PC 2・)?この PC） · たった今 · 参加者$/.test(line)), lines.join('\n'));
  assert.ok(lines.some((line) => /^● ホスト(（PC 2）)? · たった今 · ホスト用のセーブあり · 共有できる$/.test(line)), lines.join('\n'));
});

// ---- Codex のレビューの直し（page-presence） ----

test('所持パル（page-presence・Codex のレビュー）: 遅れて届いた前のワールドの presence の応答は捨てる（その間に受け取った今のワールドの一覧を戻さない）', async () => {
  let gate = null;
  const shared = presenceServer({
    userId: 'Bob',
    rewrite: async (action) => {
      if (action === 'presence' && gate) await gate;
      return undefined;
    },
  });
  await publish(shared, { worldId: WORLD_A, prefix: 'a' });
  await publish(shared, { worldId: WORLD_B, prefix: 'b' });
  const viewer = setup({ server: shared.server });
  await viewer.store.load();
  await viewer.store.setViewWorld(WORLD_A);
  viewer.advance(60000);
  let release;
  gate = new Promise((resolve) => { release = resolve; });
  shared.calls.length = 0;
  const late = viewer.store.reportPresence();
  await until(() => shared.calls.includes('presence'));
  // A の応答を待つ間に B に替え、B の一覧を受け取った
  await viewer.store.setViewWorld(WORLD_B);
  const { pages } = viewer.store.state;
  assert.equal(pages.worldId, WORLD_B);
  gate = null;
  release();
  assert.equal(await late, 'skipped');
  assert.equal(viewer.store.state.pages, pages);
});

test('所持パル（page-presence・Codex のレビュー）: 一覧の確認の後の読み込みで許可が外れた（自動の読み込みが許可待ちで止まった。一覧の status は ok のまま）間は、共有できるを false で送る', async () => {
  const shared = presenceServer();
  const host = setup({ server: shared.server });
  const files = hostFiles();
  await host.register(WORLD_A, files);
  await settleUpload(host.store);
  host.advance(60000);
  await host.store.reportPresence();
  assert.equal(shared.sent.at(-1)[2].canShare, true);
  // 新しいセーブ。一覧の確認（更新日時・大きさ）は通るが、中身を読むと許可がない
  files['Level.sav'].time += 60000;
  files['Level.sav'].readError = 'NotAllowedError';
  host.advance(25000);
  assert.equal(await host.store.refreshAuto({ auto: true }), 'permission');
  assert.deepEqual([host.store.state.auto.status, host.store.state.auto.worlds.find((world) => world.id === WORLD_A).status], ['permission', 'ok']);
  assert.equal(await host.store.reportPresence(), 'sent');
  assert.deepEqual([shared.sent.at(-1)[2].role, shared.sent.at(-1)[2].canShare], ['host', false]);
});

test('所持パル（page-presence・Codex のレビュー）: 一覧を受け取った後に GAS を古い版に戻すと、BAD_ACTION を覚えたときに前の一覧も消して知らせる（ownedSince でも presence でも）', async () => {
  const { openPagesLines } = await import('../../web/js/ui/owned-status.js');
  let oldGas = false;
  const shared = presenceServer({
    userId: 'Bob',
    rewrite: (action) => (oldGas && ['ownedSince', 'presence'].includes(action) ? { ok: false, code: 'BAD_ACTION' } : undefined),
  });
  await publish(shared, { prefix: 'a' });
  // 表のタブ（ownedSince に載せる）と裏のタブ（presence を別に送る）
  const viewer = setup({ server: shared.server });
  await viewer.store.load();
  await viewer.store.autoRefresh();
  assert.equal(openPagesLines(viewer.store.state, { now: viewer.time }).length, 1);
  const background = setup({ server: shared.server, persist: viewer.persist });
  await background.store.load();
  assert.equal(await background.store.reportPresence(), 'sent');
  assert.equal(openPagesLines(background.store.state, { now: background.time }).length, 2);
  // 版 10 に戻した
  oldGas = true;
  const emitted = { viewer: 0, background: 0 };
  viewer.store.subscribe(() => { emitted.viewer++; });
  background.store.subscribe(() => { emitted.background++; });
  viewer.advance(10000);
  shared.calls.length = 0;
  assert.equal(await viewer.store.autoRefresh(), 'fetched');
  assert.deepEqual(shared.calls, ['ownedSince', 'ownedWorlds']);
  assert.deepEqual([viewer.store.state.pages.list, openPagesLines(viewer.store.state, { now: viewer.time })], [null, []]);
  assert.ok(emitted.viewer > 0);
  background.advance(60000);
  assert.equal(await background.store.reportPresence(), 'error');
  assert.deepEqual([background.store.state.pages.list, openPagesLines(background.store.state, { now: background.time })], [null, []]);
  assert.ok(emitted.background > 0);
});
