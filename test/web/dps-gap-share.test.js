// パル次元ストレージの読み漏れ（dps-missing）を参加者に知らせる経路の往復:
// ホストの画面の送信（sharedUpload）→ GAS の検査（validateOwnedUpload の cleanOwnedPlayer）→ API の検査（api.js の validateResponse →
// core/boundary.js の cleanSharedPlayers）→ IndexedDB のキャッシュの復元 → 参加者の案内（ui/owned-status.js の ownedNotices）。
// 開発用 API（dev/mock-api.js）でも同じに動くこと、古い GAS（players の知らない項目を捨てる）でも壊れないことも確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGas } from '../gas/harness.js';
import { createApi } from '../../web/js/api.js';
import { createOwnedStore } from '../../web/js/owned.js';
import { safeStorage } from '../../web/js/store.js';
import { ownedNotices } from '../../web/js/ui/owned-status.js';
import { ownPlayerUids } from '../../web/js/core/ideal-goals.js';
import { createDevelopmentApi } from '../../dev/mock-api.js';
import { fakeHandle, hostFiles, asDropped, memoryPersist, settleUpload } from '../helpers/file-handles.js';

const PROPS = { PASSCODE: 'AAAA-BBBB-CCCC-DDDD', TEST_PASSCODE: 'EEEE-FFFF-GGGG-HHHH' };
const WORLD = 'ABCDEF0123456789ABCDEF0123456789';
const ALICE = '00000000-0000-0000-0000-000000000001';
const BOB = '00000000-0000-0000-0000-000000000002';
const hex = (uid) => uid.replace(/-/g, '');
const HOST_TEXT = 'Level.sav ではパル次元ストレージに 118 体いますが、27 体を読めていません。Players\\00000000000000000000000000000002_dps.sav（Bob）が登録されていないかもしれません。';
const GUEST_TEXT = 'ワールド全体で、パル次元ストレージの 27 体が出ていません。ホストの登録にあなたの Players\\00000000000000000000000000000002_dps.sav がないかもしれません。ホストに足してもらってください。';

// ホストの PC で読んだセーブ（Alice の _dps.sav は読めたが、後から次元ストレージを使い始めた Bob の _dps.sav は登録されていない）
const hostSnapshot = () => ({
  version: 1, world: { name: 'World9', hostName: 'Alice' },
  players: [{ uid: ALICE, name: 'Alice', level: 50 }, { uid: BOB, name: 'Bob', level: 40 }], bases: [],
  pals: [{ instanceId: 'i0', characterId: 'SheepBall', passives: [], talent: {}, location: { kind: 'dps', playerUid: ALICE, slotIndex: 0 } }],
  stats: { inLocker: 118, inLockerMissing: 27 },
  files: { used: ['Level.sav', 'LevelMeta.sav', `Players/${hex(ALICE)}.sav`, `Players/${hex(ALICE)}_dps.sav`, `Players/${hex(BOB)}.sav`], skipped: [] },
});

function memoryStorage() {
  const map = new Map();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key) };
}

// 本物の GAS のコード（test/gas/harness.js）を、画面と同じ api.js の検査を通して呼ぶ
function gasServer({ oldGas = false } = {}) {
  const env = createGas({ properties: PROPS });
  env.gas.setup();
  if (oldGas) {
    // dpsGap を知らない前の版の GAS（players の知らない項目は黙って捨てる）
    env.gas.cleanOwnedPlayer = (player) => {
      if (!player || typeof player !== 'object' || !player.uid) return null;
      return { uid: String(player.uid).slice(0, 40), name: String(player.name ?? '').slice(0, 50), ...(player.level > 0 ? { level: player.level } : {}) };
    };
  }
  const api = createApi({ transport: (request) => JSON.parse(JSON.stringify(env.gas.handleRequest_(JSON.stringify(request)))) });
  return {
    env,
    server: { scope: () => 'test', userId: () => 'ホスト', request: (action, input = {}) => api.request(action, PROPS.TEST_PASSCODE, input) },
  };
}

// 開発用 API（dev/mock-api.js）
function mockServer() {
  const api = createDevelopmentApi();
  return {
    server: {
      scope: () => 'test', userId: () => 'ホスト',
      async request(action, input = {}) {
        const response = await api({ action, passcode: 'local', ...input });
        if (!response.ok) throw Object.assign(new Error(response.code), { code: response.code });
        return response;
      },
    },
  };
}

// 通信できない画面（キャッシュの復元だけを確かめる）
const offline = { scope: () => 'test', userId: () => 'ホスト', request: async () => { throw Object.assign(new Error('CONNECTION'), { code: 'CONNECTION' }); } };

function makeStore({ server, persist = memoryPersist(), storage = memoryStorage() }) {
  const store = createOwnedStore({
    persist, settings: safeStorage(storage), namespace: 'pal-note.test', server,
    runImport: async () => hostSnapshot(), now: () => 1_000_000, schedule: () => 0, cancel: () => {},
  });
  const register = async (files) => store.commitRegistration(await store.previewRegistration({ worldId: WORLD, steamId: '7656', files: asDropped(files) }));
  return { store, persist, storage, register };
}

const gapNotices = (state, options) => ownedNotices(state, options).filter((notice) => /次元ストレージ/.test(notice.text));

async function roundTrip(server) {
  // ホスト: 読んだセーブの案内を出し、候補の Bob にだけ dpsGap を付けて共有する
  const host = makeStore({ server });
  await host.register(hostFiles(undefined, { players: [hex(ALICE), hex(BOB)] }));
  await settleUpload(host.store);
  assert.equal(host.store.state.upload.status, 'done');
  assert.deepEqual(gapNotices(host.store.state), [{ text: HOST_TEXT, kind: 'warning', action: 'editWorld' }]);
  // IndexedDB に残した手元のデータ（cleanLocalData）を開き直しても、stats が通って同じ案内が出る
  const reopened = makeStore({ server: offline, persist: host.persist, storage: host.storage });
  await reopened.store.load();
  assert.deepEqual(reopened.store.state.local.snapshot.stats, { inLocker: 118, inLockerMissing: 27 });
  assert.deepEqual(gapNotices(reopened.store.state), [{ text: HOST_TEXT, kind: 'warning', action: 'editWorld' }]);

  // 参加者（Bob の PC）: 共有を読み、自分が候補なら案内。自分は「このワールドでの自分」と同じ決め方（ownPlayerUids）
  const guest = makeStore({ server });
  assert.equal((await guest.register({ 'LocalData.sav': fakeHandle('LocalData.sav') })).result, 'guest');
  const state = guest.store.state;
  assert.equal(state.meta.source, 'shared');
  assert.deepEqual(state.owned.players.map((player) => [player.name, player.dpsGap]), [['Alice', undefined], ['Bob', 27]]);
  const byName = ownPlayerUids(state.owned.players, { userId: 'Bob', users: ['Bob'] });
  assert.deepEqual(gapNotices(state, { selfUids: byName }), [{ text: GUEST_TEXT, kind: 'warning' }]);
  // ノートの ID がゲーム内の名前と違っても、設定で選んだ自分（selfUid）が候補なら出す
  assert.deepEqual(gapNotices(state, { selfUids: ownPlayerUids(state.owned.players, { userId: '仲間', users: ['仲間'], selfUid: BOB }) }), [{ text: GUEST_TEXT, kind: 'warning' }]);
  // 候補でない人（Alice）・自分の分からない人には出さない
  assert.deepEqual(gapNotices(state, { selfUids: ownPlayerUids(state.owned.players, { userId: 'Alice', users: ['Alice'] }) }), []);
  assert.deepEqual(gapNotices(state), []);

  // キャッシュの復元（通信できなくても、前に読んだ共有の dpsGap が戻る）
  const restored = makeStore({ server: offline, persist: guest.persist, storage: guest.storage });
  await restored.store.load();
  assert.equal(restored.store.state.meta.source, 'shared');
  assert.deepEqual(restored.store.state.owned.players.find((player) => player.uid === BOB).dpsGap, 27);
  assert.deepEqual(gapNotices(restored.store.state, { selfUids: new Set([BOB]) }), [{ text: GUEST_TEXT, kind: 'warning' }]);
}

test('dps-missing の往復: ホストの送信 → GAS の検査 → API の検査 → キャッシュの復元 → 参加者の案内', async () => {
  const { env, server } = gasServer();
  await roundTrip(server);
  // シートの players の JSON には、候補の Bob にだけ dpsGap が入る（列は増えない）
  const sheet = env.spreadsheet.getSheetByName('OwnedWorlds_test');
  const players = JSON.parse(sheet.data[1][sheet.data[0].indexOf('players')]);
  assert.deepEqual(players, [{ uid: ALICE, name: 'Alice', level: 50 }, { uid: BOB, name: 'Bob', level: 40, dpsGap: 27 }]);
});

test('dps-missing の往復: 開発用 API（dev/mock-api.js）でも同じに動く', async () => {
  await roundTrip(mockServer().server);
});

test('dps-missing の往復: 古い GAS（players の知らない項目を捨てる）でも共有は止まらず、参加者には案内が出ないだけ（ホストの案内は出る）', async () => {
  const { server } = gasServer({ oldGas: true });
  const host = makeStore({ server });
  await host.register(hostFiles(undefined, { players: [hex(ALICE), hex(BOB)] }));
  await settleUpload(host.store);
  assert.equal(host.store.state.upload.status, 'done');
  assert.deepEqual(gapNotices(host.store.state).map((notice) => notice.text), [HOST_TEXT]);
  const guest = makeStore({ server });
  await guest.register({ 'LocalData.sav': fakeHandle('LocalData.sav') });
  assert.equal(guest.store.state.owned.pals.length, 1);
  assert.equal(guest.store.state.owned.players.some((player) => 'dpsGap' in player), false);
  assert.deepEqual(gapNotices(guest.store.state, { selfUids: new Set([BOB]) }), []);
});
