import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOwnedStore, idbPersist } from '../../web/js/owned.js';
import { safeStorage } from '../../web/js/store.js';
import { createDevelopmentApi } from '../../dev/mock-api.js';
import { fakeHandle, hostFiles, asDropped, memoryPersist, T0 } from '../helpers/file-handles.js';

function memoryStorage() {
  const map = new Map();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key), map };
}

const WORLD_A = '4A431AC14B58A7E31A76B2A991F79FE8';
const WORLD_B = '88DC480846CA4D73A670DA90D96950DC';
const PLAYERS = 'Players/00000000000000000000000000000001.sav';

const snapshot = (n, name = 'テスト') => ({
  version: 1, world: { name, hostName: 'Alice' }, players: [{ uid: 'u1', name: 'Alice', level: 1 }], bases: [],
  pals: Array.from({ length: n }, (_, i) => ({
    instanceId: `i${i}`, characterId: 'SheepBall', passives: i === 0 ? ['CraftSpeed_up2'] : [], talent: {}, location: { kind: 'palbox', playerUid: 'u1' },
  })),
  stats: {}, files: { used: [], skipped: [] },
});

// 開発用 API を GAS の代わりに使う
function sharedServer({ scope = 'test', userId = 'ホスト' } = {}) {
  const api = createDevelopmentApi();
  const calls = [];
  const uploads = [];
  let currentScope = scope;
  return {
    calls, uploads,
    setScope(value) { currentScope = value; },
    server: {
      scope: () => currentScope,
      userId: () => userId,
      async request(action, input = {}) {
        calls.push(action);
        if (action === 'ownedUpload') uploads.push(input.worldId);
        const response = await api({ action, passcode: 'local', ...input });
        if (!response.ok) throw Object.assign(new Error(response.code), { code: response.code });
        return response;
      },
    },
  };
}

function setup({ server = null, persist = memoryPersist(), storage = memoryStorage(), runImport = null } = {}) {
  const calls = { imports: 0 };
  let time = 1_000_000;
  const timers = [];
  const make = () => createOwnedStore({
    persist, settings: safeStorage(storage), namespace: 'pal-note.test', server,
    runImport: runImport ?? (async (files, onProgress) => { calls.imports++; onProgress('解析中'); return snapshot(files.length + 1); }),
    now: () => time,
    schedule: (fn, ms) => { timers.push({ fn, ms, cancelled: false }); return timers.length - 1; },
    cancel: (id) => { timers[id].cancelled = true; },
  });
  const store = make();
  const register = async (worldId, files, target = store) => target.commitRegistration(await target.previewRegistration({ worldId, steamId: '7656', files: asDropped(files) }));
  return { store, make, storage, persist, calls, timers, register, advance: (ms) => { time += ms; } };
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

test('所持パル: 必要なファイルが消えたら判定せずに共有を止め、Players が消えたときは知らせて読む', async () => {
  const { store, register, advance } = setup();
  const files = hostFiles();
  await register(WORLD_A, files);
  files[PLAYERS].gone = true;
  files['Level.sav'].time += 60000;
  files['LocalData.sav'].time += 60000;
  advance(25000);
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
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(shared.calls.includes('ownedUpload'));
  // 間隔を空けずに読み直すと、共有は予約になる
  files['Level.sav'].time += 60000;
  files['LocalData.sav'].time += 60000;
  advance(25000);
  assert.equal(await store.autoRefresh(), 'imported');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(timers.length, 1);
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
  storage.map.set('pal-note.test.owned.bridge', JSON.stringify({ enabled: true, worldDir: `76561198382155809/${WORLD_A.toLowerCase()}`, folder: null, viewWorldId: '' }));
  const { store } = setup({ storage });
  assert.equal(store.state.auto.worldId, WORLD_A);
  assert.equal(await store.autoRefresh(), 'empty');
  assert.match(store.state.auto.error, /登録されていません.*＋ ワールドを登録/);
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
  await new Promise((resolve) => setTimeout(resolve, 0));
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

test('所持パル: 共有されているセーブの方が新しいときは、古いセーブを上書きせずに新しい方を出す', async () => {
  const shared = sharedServer();
  const { OWNED_FIELDS } = await import('../../web/js/core/owned-shared.js');
  await shared.server.request('ownedUpload', {
    userId: '別の PC', worldId: WORLD_A, world: { name: 'LC9', hostName: 'Alice' }, saveUpdatedAt: '2026-10-05T09:00:00.000Z',
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
  await register(WORLD_B, { 'LocalData.sav': fakeHandle('LocalData.sav', { time: T0 }) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  files['Level.sav'].time += 60000;
  files['LocalData.sav'].time += 60000;
  advance(25000);
  assert.equal(await store.autoRefresh(), 'imported');
  await new Promise((resolve) => setTimeout(resolve, 0));
  const scheduled = timers.at(-1);
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
  await register(WORLD_A, hostFiles(T0 + 60000));
  await new Promise((resolve) => setTimeout(resolve, 0));
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
