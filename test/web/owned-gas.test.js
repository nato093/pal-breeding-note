// owned-gas（docs/sync-fixes/README.md の 3）の画面の側と、版の組み合わせ:
// - api.js: ownedSince・presence の操作・項目・応答の検査、ownedUpload の応答の新しい項目（result・cleanup・world.saveStamp）、PARTIAL
// - 開発用 API（dev/mock-api.js）が GAS と同じ結果を返すこと
// - API の受信 → 保存（IndexedDB のキャッシュ）→ 復元 → compareSaves の往復
// - 古い GAS（本番の版 10。e984786）＋新しい画面、新しい GAS＋古い画面（今配信している api.js）、新しい版に戻した後の古い版の行
// - server の share-extras: 捕獲数・在庫・ケーキ・魂の強化と状態の往復と、版 12（c1a29e7）の GAS・画面との組み合わせ
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGas, FakeSpreadsheet } from '../gas/harness.js';
import { legacyGasFiles, legacyApi, LEGACY_V12_COMMIT } from '../gas/legacy.js';
import { ownedContentText, itemStock } from '../../web/js/core/owned.js';
import { createApi, buildRequest, errorMessage, ApiError } from '../../web/js/api.js';
import { createOwnedStore } from '../../web/js/owned.js';
import { safeStorage } from '../../web/js/store.js';
import { createDevelopmentApi } from '../../dev/mock-api.js';
import { OWNED_FIELDS, OWNED_FORMAT } from '../../web/js/core/owned-shared.js';
import { fakeHandle, hostFiles, asDropped, memoryPersist, settleUpload, T0 } from '../helpers/file-handles.js';

const PROPS = { PASSCODE: 'AAAA-BBBB-CCCC-DDDD', TEST_PASSCODE: 'EEEE-FFFF-GGGG-HHHH' };
const WORLD = 'ABCDEF0123456789ABCDEF0123456789';
const ALICE = '00000000-0000-0000-0000-000000000001';
const stamp = (n) => String(638650000000000000n + BigInt(n));
const identity = ({ n = 1, hash = 'a'.repeat(64), format = 1, fileCount = 6, missingCount = 0, force } = {}) => ({
  saveStamp: stamp(n), contentHash: hash, format, fileCount, missingCount, ...(force === undefined ? {} : { force }),
});
const row = (instanceId) => OWNED_FIELDS.map((field) => (field === 'instanceId' ? instanceId : ''));
const rowsOf = (prefix, count) => Array.from({ length: count }, (_, i) => row(`${prefix}${i}`));
const uploadInput = ({ rows = rowsOf('p', 2), time = '2026-10-05T10:00:00.000Z', id, user = 'ホスト' } = {}) => ({
  userId: user, worldId: WORLD, world: { name: 'World9', hostName: 'Alice', ...(id ?? {}) }, saveUpdatedAt: time,
  players: [{ uid: ALICE, name: 'Alice' }], bases: [], columns: OWNED_FIELDS, rows,
});
// 版 12 までの GAS・画面の列（soul・condition〔server の share-extras〕を足す前の 29 列）で送る形。古い GAS は 31 列を INVALID_COLUMNS で断る
const OLD_WIDTH = OWNED_FIELDS.indexOf('soul');
const legacyInput = (options) => {
  const input = uploadInput(options);
  return { ...input, columns: input.columns.slice(0, OLD_WIDTH), rows: input.rows.map((cells) => cells.slice(0, OLD_WIDTH)) };
};
const plain = (value) => JSON.parse(JSON.stringify(value));
const page = (n, extra = {}) => ({ pageId: `page-${String(n).padStart(4, '0')}`, device: `device-${n}`.padEnd(8, '0'), user: `仲間${n}`, role: 'guest', playing: false, canShare: false, ...extra });

function gas(options = {}) {
  const env = createGas({ properties: PROPS, ...options });
  env.gas.setup();
  env.raw = (action, fields = {}, passcode = PROPS.TEST_PASSCODE) => plain(env.gas.handleRequest_(JSON.stringify({ action, passcode, ...fields })));
  env.api = createApi({ transport: (request) => plain(env.gas.handleRequest_(JSON.stringify(request))) });
  env.request = (action, input) => env.api.request(action, PROPS.TEST_PASSCODE, input);
  return env;
}

// ---------------------------------------------------------------------------
// api.js
// ---------------------------------------------------------------------------

const base = { ok: true, env: 'test', api: 1, serverTime: '2026-10-05T10:02:00.000Z' };
const respond = (body) => createApi({ transport: async () => body });
const sharedWorld = (extra = {}) => ({
  worldId: WORLD, worldName: 'World9', hostName: 'Alice', saveUpdatedAt: '2026-10-05T10:00:00.000Z', uploadedAt: '2026-10-05T10:01:00.000Z',
  uploadedBy: 'ホスト', palCount: 1, players: [], bases: [], farms: null, inGameDay: null, ...extra,
});
const presenceItem = (extra = {}) => ({ user: '仲間', device: 'device-01', role: 'host', playing: true, canShare: true, at: '2026-10-05T10:01:30.000Z', ...extra });

test('owned-gas の api: ownedSince・presence の項目を送り、presence は知らない項目を落とす。ownedUpload の最上位の項目は増やさない', () => {
  assert.deepEqual(buildRequest('ownedSince', 'p', { worldId: WORLD, uploadedAt: 'u', presence: { ...page(1), at: 'x', secret: 1 }, extra: 1 }), {
    action: 'ownedSince', passcode: 'p', worldId: WORLD, uploadedAt: 'u', presence: page(1),
  });
  assert.deepEqual(buildRequest('presence', 'p', { worldId: WORLD, presence: page(2) }), { action: 'presence', passcode: 'p', worldId: WORLD, presence: page(2) });
  const upload = buildRequest('ownedUpload', 'p', { ...uploadInput({ id: identity() }), saveStamp: stamp(1), force: true });
  assert.deepEqual(Object.keys(upload).sort(), ['action', 'bases', 'columns', 'passcode', 'players', 'rows', 'saveUpdatedAt', 'userId', 'world', 'worldId']);
  assert.equal(upload.world.saveStamp, stamp(1));
});

test('owned-gas の api: ownedSince の 2 通りの応答と presence の一覧を整え、形の違う応答は受け付けない', async () => {
  const unchanged = { ...base, changed: false, uploadedAt: '2026-10-05T10:01:00.000Z', uploadedBy: 'ホスト', saveUpdatedAt: '2026-10-05T10:00:00.000Z', palCount: 3, saveStamp: stamp(1), presence: [presenceItem()] };
  assert.deepEqual(await respond(unchanged).request('ownedSince', 'p', { worldId: WORLD }), unchanged);
  const messy = await respond({ ...unchanged, uploadedBy: 'x'.repeat(30), palCount: '-1', saveStamp: 'abc', presence: [presenceItem({ role: 'admin', playing: 'yes' }), presenceItem({ device: 'bad device' }), presenceItem({ at: 'いつか' }), 'x'] })
    .request('ownedSince', 'p', { worldId: WORLD });
  assert.deepEqual([messy.uploadedBy.length, messy.palCount, messy.saveStamp], [20, 0, '']);
  assert.deepEqual(messy.presence, [presenceItem({ role: 'none', playing: false })]);
  // 古い形の応答（saveStamp がない）は項目を足さない。presence が null（サーバーのキャッシュを読めなかった）はそのまま
  const { saveStamp, ...withoutStamp } = unchanged;
  const old = await respond({ ...withoutStamp, presence: null }).request('ownedSince', 'p', { worldId: WORLD });
  assert.deepEqual(['saveStamp' in old, old.presence], [false, null]);
  const changed = { ...base, changed: true, world: sharedWorld({ saveStamp: stamp(2) }), columns: OWNED_FIELDS, rows: [row('p1')], presence: [] };
  // 受け取った生の行の数（重複・壊れた行を除く前。画面が palCount と比べる。share-fetch）を receivedRows に残す
  assert.deepEqual(await respond(changed).request('ownedSince', 'p', { worldId: WORLD }), { ...changed, receivedRows: 1 });
  const messyRows = await respond({ ...changed, rows: [row('p1'), row('p1'), null, row('')] }).request('ownedSince', 'p', { worldId: WORLD });
  assert.deepEqual([messyRows.rows.length, messyRows.receivedRows], [1, 4]);
  const owned = await respond({ ...base, world: sharedWorld(), columns: OWNED_FIELDS, rows: [row('p1'), row('p1')] }).request('owned', 'p', { worldId: WORLD });
  assert.deepEqual([owned.rows.length, owned.receivedRows], [1, 2]);
  assert.equal((await respond({ ...changed, world: null, rows: [] }).request('ownedSince', 'p', { worldId: WORLD })).world, null);
  for (const broken of [{ ...unchanged, changed: 'no' }, { ...unchanged, uploadedAt: 3 }, { ...unchanged, presence: {} }, { ...changed, rows: 'x' }]) {
    await assert.rejects(respond(broken).request('ownedSince', 'p', { worldId: WORLD }), { code: 'RESPONSE' });
  }
  const presence = await respond({ ...base, presence: [presenceItem(), null], saved: true }).request('presence', 'p', { worldId: WORLD, presence: page(1) });
  assert.deepEqual([presence.presence, presence.saved], [[presenceItem()], true]);
  assert.equal((await respond({ ...base, presence: null, saved: 'x' }).request('presence', 'p', { worldId: WORLD, presence: page(1) })).saved, false);
  await assert.rejects(respond({ ...base, presence: 'x' }).request('presence', 'p', { worldId: WORLD, presence: page(1) }), { code: 'RESPONSE' });
});

test('owned-gas の api: ownedUpload の応答の result・cleanup・world.saveStamp を残し、形の違う値と古い GAS の応答は付いていないものとして扱う', async () => {
  const good = { ...base, stored: false, result: 'unchanged', cleanup: true, world: sharedWorld({ saveStamp: stamp(3) }) };
  assert.deepEqual(await respond(good).request('ownedUpload', 'p', uploadInput()), good);
  const odd = await respond({ ...good, result: 'later', cleanup: 'yes', world: sharedWorld({ saveStamp: '0x1' }) }).request('ownedUpload', 'p', uploadInput());
  assert.deepEqual(['result' in odd, 'cleanup' in odd, odd.world.saveStamp], [false, false, '']);
  const legacy = await respond({ ...base, stored: true, world: sharedWorld() }).request('ownedUpload', 'p', uploadInput());
  assert.deepEqual(['result' in legacy, 'saveStamp' in legacy.world], [false, false]);
  // 共有の書き込みと重なった読み込み（PARTIAL）は再試行できるエラー
  await assert.rejects(respond({ ok: false, code: 'PARTIAL' }).request('owned', 'p', { worldId: WORLD }), { code: 'PARTIAL', message: errorMessage('PARTIAL') });
  assert.match(errorMessage('PARTIAL'), /^共有の書き込みと重なりました。少し待つと自動で読み直します。$/);
});

// ---------------------------------------------------------------------------
// 開発用 API と GAS の一致
// ---------------------------------------------------------------------------

test('owned-gas の開発用 API: 結果の種類・ownedSince・presence が GAS と同じ（api.js を通す）', async () => {
  const env = gas();
  const mock = createDevelopmentApi();
  const mockApi = createApi({ transport: (request) => mock(request) });
  const servers = { gas: (action, input) => env.request(action, input), mock: (action, input) => mockApi.request(action, 'local', input) };
  const steps = [
    uploadInput({ id: identity({ n: 10 }) }),
    uploadInput({ id: identity({ n: 20 }), time: '2026-10-05T09:00:00.000Z' }),
    uploadInput({ id: identity({ n: 15 }), time: '2026-10-06T00:00:00.000Z' }),
    uploadInput({ id: identity({ n: 20 }), user: 'ゲスト' }),
    uploadInput({ id: identity({ n: 20, hash: 'b'.repeat(64), fileCount: 7 }) }),
    uploadInput({ id: identity({ n: 20, hash: 'c'.repeat(64), fileCount: 8 }), user: 'ゲスト' }),
    uploadInput({ id: identity({ n: 20, hash: 'c'.repeat(64), fileCount: 7, force: true }), user: 'ゲスト' }),
    uploadInput({ time: '2026-10-05T08:00:00.000Z' }),
    uploadInput({ time: '2026-10-07T00:00:00.000Z', rows: rowsOf('z', 3) }),
  ];
  const results = {};
  for (const [name, call] of Object.entries(servers)) {
    results[name] = [];
    for (const step of steps) {
      const response = await call('ownedUpload', step);
      results[name].push([response.result, response.stored, response.cleanup, response.world.saveStamp, response.world.uploadedBy]);
    }
    const current = await call('ownedWorlds');
    const uploadedAt = current.worlds[0].uploadedAt;
    const same = await call('ownedSince', { worldId: WORLD, uploadedAt, presence: page(1) });
    results[name].push([same.changed, same.palCount, same.saveStamp, same.presence.map((item) => item.user)]);
    const changed = await call('ownedSince', { worldId: WORLD, uploadedAt: 'old', presence: page(2, { role: 'host' }) });
    results[name].push([changed.changed, changed.rows.map((r) => r[0]), changed.presence.map((item) => [item.user, item.role])]);
    const presence = await call('presence', { worldId: WORLD, presence: page(1, { playing: true }) });
    results[name].push([presence.saved, presence.presence.map((item) => [item.user, item.playing])]);
    await assert.rejects(call('presence', { worldId: WORLD, presence: page(3, { role: 'x' }) }), { code: 'VALIDATION' });
  }
  assert.deepEqual(results.mock, results.gas);
  assert.deepEqual(results.gas.slice(0, 9).map((item) => item[0]), ['new', 'newer', 'stale', 'unchanged', 'resent', 'same', 'resent', 'stale', 'newer']);
});

test('owned-gas の開発用 API: presence は 6 時間で消え、1 ワールド 50 件まで', async () => {
  let clock = Date.parse('2026-10-05T10:00:00.000Z');
  const mock = createDevelopmentApi({ now: () => clock });
  const call = (fields) => mock({ action: 'presence', passcode: 'local', worldId: WORLD, ...fields });
  await call({ presence: page(1) });
  clock += 6 * 3600 * 1000;
  assert.deepEqual((await call({ presence: page(2) })).presence.map((item) => item.user), ['仲間2']);
  for (let n = 10; n < 70; n++) await call({ presence: page(n) });
  assert.equal((await call({ presence: page(70) })).presence.length, 50);
});

// ---------------------------------------------------------------------------
// API の受信 → 保存 → 復元 → compareSaves
// ---------------------------------------------------------------------------

function memoryStorage() {
  const map = new Map();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key) };
}

const hostSnapshot = (savedAtTicks) => ({
  version: 1, world: { name: 'World9', hostName: 'Alice', savedAtTicks },
  players: [{ uid: ALICE, name: 'Alice', level: 50 }], bases: [],
  pals: [{ instanceId: 'local-1', characterId: 'SheepBall', passives: [], talent: {}, location: { kind: 'palbox', playerUid: ALICE, slotIndex: 0 } }],
  stats: {}, files: { used: ['Level.sav', 'LevelMeta.sav', 'Players/00000000000000000000000000000001.sav'], skipped: [] },
});

// ホストの画面だけだった情報（server の share-extras）を持つセーブ: 捕獲数・在庫・牧場のケーキ・魂の強化と状態
const extrasSnapshot = (savedAtTicks) => {
  const base = hostSnapshot(savedAtTicks);
  return {
    ...base,
    players: [{ ...base.players[0], captures: [{ id: 'SheepBall', count: 12 }] }],
    pals: [{ ...base.pals[0], soul: { hp: 10, attack: 0, defense: 0, craft: 0 }, condition: { sick: 'Cold', hunger: '', sanity: 61.6 } }],
    breedFarms: [{ id: 'F1', baseId: '', status: 'ok', parents: [], eggs: [], cakes: [{ itemId: 'Cake02', count: 51 }] }],
    items: [{ itemId: 'PalGenderReverse', count: 3, where: 'guild', id: 'g1', object: '' }],
  };
};
const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
// 共有を受けた参加者の画面の 5 つ（捕獲数・在庫・ケーキ・魂の強化・状態）
const extrasOf = (data) => [
  data.players[0]?.captures ?? null, itemStock(data, 'PalGenderReverse'), data.farms?.[0]?.cakes ?? null, data.pals[0]?.soul ?? null, data.pals[0]?.condition ?? null,
];
const SHARED_EXTRAS = [
  { SheepBall: 12 }, { total: 3, places: [{ label: 'ギルド保管庫', count: 3 }] }, [{ itemId: 'Cake02', count: 51 }],
  { hp: 10, attack: 0, defense: 0, craft: 0 }, { sick: 'Cold', hunger: '', sanity: 62 },
];

function makeStore({ server, persist = memoryPersist(), storage = memoryStorage(), snapshot }) {
  const store = createOwnedStore({
    persist, settings: safeStorage(storage), namespace: 'pal-note.test', server,
    runImport: async () => snapshot, now: () => T0 + 60 * 60 * 1000, schedule: () => 0, cancel: () => {},
  });
  const register = async (files) => store.commitRegistration(await store.previewRegistration({ worldId: WORLD, steamId: '7656', files: asDropped(files) }));
  return { store, persist, storage, register };
}
const offline = { scope: () => 'test', userId: () => 'ホスト', request: async () => { throw Object.assign(new Error('CONNECTION'), { code: 'CONNECTION' }); } };

test('owned-gas の往復: 共有の saveStamp は API の受信 → キャッシュ → 復元を通り、手元と共有の選択は中の保存時刻で比べる', async () => {
  const env = gas();
  // 別の PC のホストが、中の時刻の新しいセーブを共有した（ファイルの更新日時は、この PC の同期の後の日時より古い）
  const published = env.raw('ownedUpload', uploadInput({ id: identity({ n: 20 }), time: new Date(T0 - 60 * 1000).toISOString(), rows: rowsOf('shared', 3), user: '別のホスト' }));
  assert.equal(published.world.saveStamp, stamp(20));
  // この PC は同じワールドの古いセーブ（中の時刻 n=10）を持ち、同期で更新日時だけが新しい。共有の送信は届かない
  const server = {
    scope: () => 'test', userId: () => 'ホスト',
    request: async (action, input = {}) => {
      if (action === 'ownedUpload') throw Object.assign(new Error('CONNECTION'), { code: 'CONNECTION' });
      return env.api.request(action, PROPS.TEST_PASSCODE, input);
    },
  };
  const host = makeStore({ server, snapshot: hostSnapshot(stamp(10)) });
  await host.register(hostFiles(T0));
  await host.store.fetchShared({ force: true });
  await settleUpload(host.store);
  const state = host.store.state;
  assert.equal(state.shared.current.world.saveStamp, stamp(20));
  assert.equal(state.local.snapshot.world.savedAtTicks, stamp(10));
  // 更新日時なら手元（T0）が新しいが、中の保存時刻で比べて共有を出す
  assert.ok(Date.parse(state.local.world.updatedAt) > Date.parse(state.shared.current.world.saveUpdatedAt));
  assert.deepEqual([state.meta.source, state.owned.pals.length], ['shared', 3]);
  // キャッシュ（IndexedDB）から開き直しても、saveStamp と savedAtTicks が戻り、同じ選択になる
  const reopened = makeStore({ server: offline, persist: host.persist, storage: host.storage, snapshot: hostSnapshot(stamp(10)) });
  await reopened.store.load();
  assert.equal(reopened.store.state.shared.current.world.saveStamp, stamp(20));
  assert.deepEqual([reopened.store.state.role, reopened.store.state.meta.source], ['host', 'shared']);
  // 同じセーブ（中の時刻が同じ）なら手元を出す
  const same = makeStore({ server, snapshot: hostSnapshot(stamp(20)) });
  await same.register(hostFiles(T0));
  await same.store.fetchShared({ force: true });
  assert.equal(same.store.state.meta.source, 'local');
  // 共有に中の時刻がない（古い GAS・識別のない共有）なら、今までどおり更新日時で比べる（手元が新しい）
  env.raw('ownedUpload', uploadInput({ time: new Date(T0 - 30 * 1000).toISOString(), rows: rowsOf('legacy', 2) }));
  const legacy = makeStore({ server, snapshot: hostSnapshot(stamp(10)) });
  await legacy.register(hostFiles(T0));
  await legacy.store.fetchShared({ force: true });
  assert.deepEqual([legacy.store.state.shared.current.world.saveStamp, legacy.store.state.meta.source], ['', 'local']);
});

test('owned-gas の往復: 表示するワールドの既定（いちばん新しく共有されたワールド）も中の保存時刻で選ぶ', async () => {
  const env = gas();
  const other = 'FEDCBA9876543210FEDCBA9876543210';
  env.raw('ownedUpload', uploadInput({ id: identity({ n: 30 }), time: '2026-10-05T09:00:00.000Z' }));
  env.raw('ownedUpload', { ...uploadInput({ id: identity({ n: 20 }), time: '2026-10-05T11:00:00.000Z' }), worldId: other });
  const viewer = createOwnedStore({
    persist: memoryPersist(), settings: safeStorage(memoryStorage()), namespace: 'pal-note.test',
    server: { scope: () => 'test', userId: () => '見る人', request: (action, input) => env.request(action, input) },
    now: () => T0, schedule: () => 0, cancel: () => {},
  });
  await viewer.fetchShared({ force: true });
  assert.equal(viewer.state.meta.worldId, WORLD);
});

// ---------------------------------------------------------------------------
// share-upload: 画面の送信（識別つき）→ GAS（harness）・開発用 API の往復
// ---------------------------------------------------------------------------

test('share-upload の往復: 画面が送る識別は GAS（harness）と開発用 API の検査を通り、2 回目の同じ送信は unchanged（自分の共有）で書き直さない', async () => {
  const env = gas();
  const mock = createDevelopmentApi();
  const mockApi = createApi({ transport: (request) => mock(request) });
  const servers = {
    gas: { scope: () => 'test', userId: () => 'ホスト', request: (action, input = {}) => env.api.request(action, PROPS.TEST_PASSCODE, input) },
    mock: { scope: () => 'test', userId: () => 'ホスト', request: (action, input = {}) => mockApi.request(action, 'local', input) },
  };
  const results = {};
  for (const [name, server] of Object.entries(servers)) {
    const host = makeStore({ server, snapshot: hostSnapshot(stamp(30)) });
    await host.register(hostFiles(T0));
    await settleUpload(host.store);
    const first = host.store.state.upload;
    const again = await host.store.uploadLocal({ force: true });
    const second = host.store.state.upload;
    results[name] = [first.status, first.result, again, second.status, second.result, second.published.uploadedAt === first.published.uploadedAt, second.published.saveStamp];
  }
  assert.deepEqual(results.mock, results.gas);
  assert.deepEqual(results.gas, ['done', 'new', 'unchanged', 'done', 'unchanged', true, stamp(30)]);
  // GAS の列 saveKey に、画面が送った識別（保存時刻・中身の印・形の版・読めたファイル 3・読めなかったファイル 0）が残る
  const sheet = env.spreadsheet.getSheetByName('OwnedWorlds_test');
  const saveKey = String(sheet.data[1][sheet.data[0].indexOf('saveKey')]);
  assert.match(saveKey, new RegExp(`\\|${stamp(30)}\\|[0-9a-f]{64}\\|${OWNED_FORMAT}\\|3\\|0$`));
});

test('share-upload の往復: 古い GAS に合わせて列を狭めた共有を新しい GAS が受けていても、全部の列で試し直すと resent で書き直す（形の版を下げて送るため）', async () => {
  const env = gas();
  let clock = T0;
  let rejectFull = true;
  const server = {
    scope: () => 'test', userId: () => 'ホスト',
    async request(action, input = {}) {
      // GAS を更新する前に覚えた幅（入手時刻の列を知らない GAS が断った）
      if (action === 'ownedUpload' && rejectFull && input.columns.length === OWNED_FIELDS.length) {
        throw new ApiError('VALIDATION', { ok: false, code: 'VALIDATION', errors: [{ field: 'columns', code: 'INVALID_COLUMNS' }] });
      }
      return env.api.request(action, PROPS.TEST_PASSCODE, input);
    },
  };
  const store = createOwnedStore({
    persist: memoryPersist(), settings: safeStorage(memoryStorage()), namespace: 'pal-note.test', server,
    runImport: async () => hostSnapshot(stamp(40)), now: () => clock, schedule: () => 0, cancel: () => {},
  });
  await store.commitRegistration(await store.previewRegistration({ worldId: WORLD, steamId: '7656', files: asDropped(hostFiles(T0)) }));
  await settleUpload(store);
  assert.deepEqual([store.state.upload.result, store.state.shared.current.columns.length], ['new', OWNED_FIELDS.length - 1]);
  // 1 時間たって全部の列で試し直す。同じセーブ・同じ人で、形の版が上がったので書き直す
  rejectFull = false;
  clock += 60 * 60 * 1000;
  assert.equal(await store.uploadLocal({ force: true }), 'uploaded');
  assert.equal(store.state.upload.result, 'resent');
  assert.equal((await env.request('owned', { worldId: WORLD })).rows[0].length, OWNED_FIELDS.length);
  assert.equal(await store.uploadLocal({ force: true }), 'unchanged');
});

test('share-extras の往復: ホストの画面が捕獲数・在庫・ケーキ・魂の強化と状態を送り（在庫は world の中で中身の印に入る・形の版 10）、GAS（harness）と開発用 API を通って参加者の画面に同じ値が出る', async () => {
  const env = gas();
  const mock = createDevelopmentApi();
  const mockApi = createApi({ transport: (request) => mock(request) });
  const backends = {
    gas: (action, input) => env.api.request(action, PROPS.TEST_PASSCODE, input),
    mock: (action, input) => mockApi.request(action, 'local', input),
  };
  for (const [name, call] of Object.entries(backends)) {
    const sent = [];
    const server = {
      scope: () => 'test', userId: () => 'ホスト',
      request: (action, input = {}) => {
        if (action === 'ownedUpload') sent.push(input);
        return call(action, input);
      },
    };
    const host = makeStore({ server, snapshot: extrasSnapshot(stamp(50)) });
    await host.register(hostFiles(T0));
    await settleUpload(host.store);
    assert.equal(host.store.state.upload.result, 'new', name);
    const [input] = sent;
    // 在庫は world の中（最上位の項目は増やさない）。列は 31、形の版は OWNED_FORMAT
    assert.deepEqual([input.world.items, 'items' in input, input.columns.length, input.world.format], [
      [{ id: 'PalGenderReverse', t: 3, p: [{ l: 'ギルド保管庫', n: 3 }] }], false, OWNED_FIELDS.length, OWNED_FORMAT,
    ], name);
    assert.deepEqual([input.players[0].captures, input.farms[0].c, input.rows[0].slice(-2)], [{ SheepBall: 12 }, [{ i: 'Cake02', n: 51 }], ['10|0|0|0', 'Cold||62']], name);
    // 中身の印は在庫も入れた送る中身の SHA-256
    assert.equal(input.world.contentHash, sha256(ownedContentText(input)), name);
    // 参加者の画面（LocalData.sav だけ）
    const guest = makeStore({ server, snapshot: hostSnapshot(stamp(50)) });
    assert.equal((await guest.register({ 'LocalData.sav': fakeHandle('LocalData.sav') })).result, 'guest', name);
    assert.equal(guest.store.state.meta.source, 'shared', name);
    assert.deepEqual(extrasOf(guest.store.state.owned), SHARED_EXTRAS, name);
  }
});

// ---------------------------------------------------------------------------
// 版の組み合わせ（古い版は Git の履歴から取り出す。浅い複製では skip）
// ---------------------------------------------------------------------------

const oldGasFiles = legacyGasFiles();
const skipOld = oldGasFiles ? false : 'Git の履歴に e984786 がない（浅い複製）';

test('owned-gas の組み合わせ: 古い GAS（版 10）＋新しい画面。world の中の識別は捨てられ、ownedSince・presence は BAD_ACTION', { skip: skipOld }, async () => {
  const env = gas({ files: oldGasFiles });
  const stored = await env.request('ownedUpload', legacyInput({ id: identity({ n: 5, force: true }) }));
  assert.equal(stored.stored, true);
  assert.deepEqual(['result' in stored, 'cleanup' in stored, 'saveStamp' in stored.world], [false, false, false]);
  const again = await env.request('ownedUpload', legacyInput({ id: identity({ n: 5 }), rows: rowsOf('q', 1) }));
  assert.equal(again.stored, true, '古い GAS は同じ時刻なら上書きする');
  assert.deepEqual((await env.request('owned', { worldId: WORLD })).rows.map((r) => r[0]), ['q0']);
  await assert.rejects(env.request('ownedSince', { worldId: WORLD, uploadedAt: again.world.uploadedAt }), { code: 'BAD_ACTION' });
  await assert.rejects(env.request('presence', { worldId: WORLD, presence: page(1) }), { code: 'BAD_ACTION' });
  // 新しい画面の所持パルの画面（ホストの共有 → 参加者の表示）も今までどおり動く
  const fresh = gas({ files: oldGasFiles });
  const server = { scope: () => 'test', userId: () => 'ホスト', request: (action, input = {}) => fresh.request(action, input) };
  const host = makeStore({ server, snapshot: hostSnapshot(stamp(9)) });
  await host.register(hostFiles(T0));
  await settleUpload(host.store);
  assert.equal(host.store.state.upload.status, 'done');
  // 古い GAS は結果の種類と saveStamp を返さない（share-upload の結果は stored だけで決める）
  assert.deepEqual([host.store.state.upload.result, host.store.state.upload.published.saveStamp], ['', '']);
  const guest = makeStore({ server, snapshot: hostSnapshot(stamp(9)) });
  assert.equal((await guest.register({ 'LocalData.sav': fakeHandle('LocalData.sav') })).result, 'guest');
  assert.deepEqual([guest.store.state.meta.source, guest.store.state.owned.pals.length], ['shared', 1]);
});

const v12GasFiles = legacyGasFiles(LEGACY_V12_COMMIT);
const skipV12 = v12GasFiles ? false : `Git の履歴に ${LEGACY_V12_COMMIT} がない（浅い複製）`;

test('share-extras の組み合わせ: 版 12 の GAS＋新しい画面。31 列を断られたら 29 列（形の版 8）に狭めて送り、共有は止まらない（5 つは届かないだけ）', { skip: skipV12 }, async () => {
  const env = gas({ files: v12GasFiles });
  const sent = [];
  const server = {
    scope: () => 'test', userId: () => 'ホスト',
    request: (action, input = {}) => {
      if (action === 'ownedUpload') sent.push(input);
      return env.request(action, input);
    },
  };
  const host = makeStore({ server, snapshot: extrasSnapshot(stamp(60)) });
  await host.register(hostFiles(T0));
  await settleUpload(host.store);
  assert.deepEqual([host.store.state.upload.status, host.store.state.upload.result], ['done', 'new']);
  // 末尾の列を 1 つずつ外して送り直し、外した列の数だけ形の版を下げる。中身の印は狭めた後の中身
  assert.deepEqual(sent.map((input) => [input.columns.length, input.world.format]), [[31, 10], [30, 9], [29, 8]]);
  assert.equal(sent.at(-1).world.contentHash, sha256(ownedContentText(sent.at(-1))));
  // 版 12 は新しい鍵（captures・c・world の items）を捨てる。参加者（新しい画面）には今と同じく出ない
  const guest = makeStore({ server, snapshot: hostSnapshot(stamp(60)) });
  assert.equal((await guest.register({ 'LocalData.sav': fakeHandle('LocalData.sav') })).result, 'guest');
  assert.deepEqual(extrasOf(guest.store.state.owned), [null, null, null, null, null]);
  assert.equal(guest.store.state.owned.pals.length, 1);
});

test('share-extras の組み合わせ: 新しい GAS＋版 12 の画面（api.js）。新しい列と鍵のある応答も古い検査を通って新しい鍵は捨てられ、古い画面の 29 列の共有も受ける', { skip: skipV12 }, async () => {
  const old = await legacyApi(LEGACY_V12_COMMIT);
  if (!old) return;
  const env = gas();
  const server = { scope: () => 'test', userId: () => 'ホスト', request: (action, input = {}) => env.request(action, input) };
  const host = makeStore({ server, snapshot: extrasSnapshot(stamp(70)) });
  await host.register(hostFiles(T0));
  await settleUpload(host.store);
  const api = old.createApi({ transport: (request) => plain(env.gas.handleRequest_(JSON.stringify(request))) });
  const call = (action, input) => api.request(action, PROPS.TEST_PASSCODE, input);
  const [listed] = (await call('ownedWorlds')).worlds;
  assert.deepEqual([listed.players, listed.farms[0].c, 'items' in listed], [[{ uid: ALICE, name: 'Alice', level: 50 }], undefined, false]);
  const owned = await call('owned', { worldId: WORLD });
  assert.deepEqual([owned.columns.length, owned.rows[0].length, owned.rows[0].slice(-2)], [OWNED_FIELDS.length, OWNED_FIELDS.length, ['10|0|0|0', 'Cold||62']]);
  assert.equal((await call('ownedSince', { worldId: WORLD, uploadedAt: '' })).changed, true);
  // 開いたままの版 12 の画面が新しいセーブを共有する（29 列・新しい鍵なし）。その世代だけ、参加者の画面で 5 つが分からない
  const stored = await call('ownedUpload', legacyInput({ rows: rowsOf('old', 1), time: new Date(T0 + 2 * 60 * 60 * 1000).toISOString() }));
  assert.equal(stored.stored, true);
  const guest = makeStore({ server, snapshot: hostSnapshot(stamp(70)) });
  assert.equal((await guest.register({ 'LocalData.sav': fakeHandle('LocalData.sav') })).result, 'guest');
  assert.deepEqual([guest.store.state.owned.pals.map((pal) => pal.id), extrasOf(guest.store.state.owned)], [['old0'], [null, null, null, null, null]]);
});

test('owned-gas の組み合わせ: 新しい GAS＋古い画面（今配信している api.js）。新しい応答の項目は古い検査を通り、読めるのは今の世代だけ', { skip: skipOld }, async () => {
  const old = await legacyApi();
  if (!old) return;
  const env = gas();
  const api = old.createApi({ transport: (request) => plain(env.gas.handleRequest_(JSON.stringify(request))) });
  const call = (action, input) => api.request(action, PROPS.TEST_PASSCODE, input);
  // 古い画面は識別を送らない（更新日時で比べる）。列は soul・condition を足す前の 29 列
  const first = await call('ownedUpload', legacyInput({ rows: rowsOf('a', 2) }));
  const second = await call('ownedUpload', legacyInput({ rows: rowsOf('b', 3), time: '2026-10-05T11:00:00.000Z' }));
  assert.deepEqual([first.stored, second.stored, second.result], [true, true, 'newer']);
  const stale = await call('ownedUpload', legacyInput({ rows: rowsOf('c', 1), time: '2026-10-05T09:00:00.000Z' }));
  assert.deepEqual([stale.stored, stale.reason], [false, 'STALE']);
  // 2 世代がシートにあっても、古い画面の読み込みには今の世代だけが届く
  const owned = await call('owned', { worldId: WORLD });
  assert.deepEqual(owned.rows.map((r) => r[0]), ['b0', 'b1', 'b2']);
  assert.equal((await call('ownedWorlds')).worlds[0].palCount, 3);
  // 共有の書き込みと重なった読み込み（PARTIAL）は、古い画面では失敗として扱われる（次の読み直しで戻る）
  env.spreadsheet.getSheetByName('OwnedPals_test').deleteRows(4, 1);
  await assert.rejects(call('owned', { worldId: WORLD }), { code: 'PARTIAL' });
  assert.equal((await call('ownedDelete', { worldId: WORLD })).deleted, true);
  // 新しい画面が識別つきで共有したセーブを、同じ更新日時で古い画面（同期を受け取った PC の古いタブ。プレイヤーの入れ替え後・登録が少ない）が
  // 劣った中身で送っても上書きしない（same）。古い api.js は stored: false の応答を受け付ける（古い画面は 'stale' として 1 回読み直すだけで、
  // 次に新しいセーブを読むまで送り直さない）
  const host = await env.request('ownedUpload', uploadInput({ id: identity({ n: 7 }), rows: rowsOf('h', 2) }));
  assert.equal(host.result, 'new');
  const synced = await call('ownedUpload', legacyInput({ rows: rowsOf('s', 1), user: 'ゲスト' }));
  assert.deepEqual([synced.stored, synced.result, synced.world.uploadedBy, synced.world.uploadedAt], [false, 'same', 'ホスト', host.world.uploadedAt]);
  assert.deepEqual((await call('owned', { worldId: WORLD })).rows.map((r) => r[0]), ['h0', 'h1']);
  assert.equal((await env.request('ownedWorlds')).worlds[0].saveStamp, stamp(7));
});

test('owned-gas の組み合わせ: 巻き戻した古い版（行数を足さずに全部を消して書き直す）が、圧縮の後に体数の増えたセーブを書いても共有が空にならない', { skip: skipOld }, () => {
  for (const [sizes, grown] of [[[600, 600], 601], [[1200], 1300], [[30, 30], 2000]]) {
    const spreadsheet = new FakeSpreadsheet();
    const next = gas({ spreadsheet });
    const previous = createGas({ files: oldGasFiles, spreadsheet, props: next.props, cacheEntries: next.cache.entries });
    const oldCall = (action, fields = {}) => plain(previous.gas.handleRequest_(JSON.stringify({ action, passcode: PROPS.TEST_PASSCODE, ...fields })));
    sizes.forEach((size, i) => next.raw('ownedUpload', uploadInput({ id: identity({ n: i + 1 }), rows: rowsOf(`g${i}-`, size), time: `2026-10-05T1${i}:00:00.000Z` })));
    next.gas.compactOwned('test');
    const stored = oldCall('ownedUpload', legacyInput({ rows: rowsOf('grown', grown), time: '2026-10-05T20:00:00.000Z' }));
    assert.equal(stored.stored, true, `${sizes} → ${grown}: ${JSON.stringify(stored)}`);
    assert.equal(oldCall('owned', { worldId: WORLD }).rows.length, grown);
  }
});

test('owned-gas の組み合わせ: 巻き戻し（古い版）の間の書き込み → 新しい版に戻すと、古い版の行に残った saveKey を識別として使わない', { skip: skipOld }, () => {
  const spreadsheet = new FakeSpreadsheet();
  const next = gas({ spreadsheet });
  // 同じスプレッドシート・Script Properties・キャッシュを読む古い版
  const previous = createGas({ files: oldGasFiles, spreadsheet, props: next.props, cacheEntries: next.cache.entries });
  const oldCall = (action, fields = {}) => plain(previous.gas.handleRequest_(JSON.stringify({ action, passcode: PROPS.TEST_PASSCODE, ...fields })));
  // 新しい版の書き込み（識別あり・2 世代）
  next.raw('ownedUpload', uploadInput({ id: identity({ n: 1 }), rows: rowsOf('a', 2), time: '2026-10-05T09:00:00.000Z' }));
  const written = next.raw('ownedUpload', uploadInput({ id: identity({ n: 2 }), rows: rowsOf('b', 2), time: '2026-10-05T10:00:00.000Z' }));
  // 巻き戻し: 本番を古い版に戻し、compactOwned で今の世代だけにする（古い版は世代を見ずに worldId の全部の行を読む）
  next.gas.compactOwned('test');
  assert.deepEqual(oldCall('owned', { worldId: WORLD }).rows.map((r) => r[0]), ['b0', 'b1']);
  // 遅れて届いた新しい版の書き込みは何も書かない
  assert.equal(next.raw('ownedUpload', uploadInput({ id: identity({ n: 3 }), time: '2026-10-05T10:30:00.000Z' })).code, 'BUSY');
  // 巻き戻している間の古い版の書き込み（新しいセーブ）。知らない列 saveKey は書かない
  //（新しい版の世代の時刻は同じミリ秒なら 1 ミリ秒ずつ進めるので、古い版の時刻がそれと重ならないよう少し待つ）
  const until = Date.now() + 5;
  while (Date.now() < until);
  const during = oldCall('ownedUpload', legacyInput({ rows: rowsOf('c', 2), time: '2026-10-05T11:00:00.000Z' }));
  assert.equal(during.stored, true);
  // 新しい版に戻す
  next.gas.resumeOwned('test');
  const sheet = spreadsheet.getSheetByName('OwnedWorlds_test');
  // compact をしなかった場合と同じ状況（古い版の行に前の識別が残っている）も確かめる
  sheet.data[1][sheet.data[0].indexOf('saveKey')] = `${written.world.uploadedAt}|${stamp(2)}|${'a'.repeat(64)}|1|6|0`;
  assert.equal(next.raw('ownedWorlds').worlds[0].saveStamp, '');
  // 新しい版の再送（前の識別と同じセーブ・ファイルが増えた）: 識別を使えば resent で古いセーブに戻してしまうが、更新日時で比べて stale
  const resend = next.raw('ownedUpload', uploadInput({ id: identity({ n: 2, hash: 'b'.repeat(64), fileCount: 7 }), rows: rowsOf('b', 2), time: '2026-10-05T10:00:00.000Z' }));
  assert.deepEqual([resend.result, resend.stored, resend.world.uploadedAt], ['stale', false, during.world.uploadedAt]);
  assert.deepEqual(next.raw('owned', { worldId: WORLD }).rows.map((r) => r[0]), ['c0', 'c1']);
  // 次の新しいセーブからは識別を使う
  const fresh = next.raw('ownedUpload', uploadInput({ id: identity({ n: 4 }), rows: rowsOf('d', 1), time: '2026-10-05T12:00:00.000Z' }));
  assert.deepEqual([fresh.result, fresh.world.saveStamp], ['newer', stamp(4)]);
  assert.equal(next.raw('ownedUpload', uploadInput({ id: identity({ n: 4 }), rows: rowsOf('d', 1), time: '2026-10-05T12:30:00.000Z' })).result, 'unchanged');
});
