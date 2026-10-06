import { test } from 'node:test';
import assert from 'node:assert/strict';
import data from '../../web/data/breeding.js';
import { createDevelopmentApi } from '../../dev/mock-api.js';
import { createApi, ApiError } from '../../web/js/api.js';
import { createStore, safeStorage } from '../../web/js/store.js';
import { createAutoRegister } from '../../web/js/auto-register.js';

const PASS = '自動登録の試験用';
const P1 = 'p-1';
const P2 = 'p-2';
const parent = (characterId, gender, depositorUid = P1) => ({ instanceId: `${characterId}-${gender}-${depositorUid}`, characterId, gender, depositorUid });
const farm = (id, parents, eggs) => ({ id, baseId: 'b', status: 'ok', parents, eggs: eggs.map((c, i) => ({ localId: `${id}-${i}`, characterId: c })) });
// SheepBall×SwordCutlassfish→GuardianDog（手元のセーブで確かめた組み合わせ）
const sheepFarm = (depositor = P1, id = 'f1') => farm(id, [parent('SheepBall', 'Female', depositor), parent('SwordCutlassfish', 'Male', depositor)], ['GuardianDog']);
const dogFarm = (id = 'f2') => farm(id, [parent('GuardianDog', 'Male'), parent('GuardianDog', 'Female')], ['GuardianDog']);

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
}

async function setup({ farms = [sheepFarm()], players = [{ uid: P1, name: '自分' }, { uid: P2, name: 'harapi' }], records = [], login = true } = {}) {
  const development = createDevelopmentApi();
  // サーバの手前で止める・次の登録を断る（手動の登録が送信待ちのまま・取り消される場面を作る）
  let serverGate = null;
  let rejectNextCreate = false;
  const api = createApi({ transport: async (request) => {
    await serverGate;
    if (request.action === 'create' && rejectNextCreate) {
      rejectNextCreate = false;
      return { ok: false, code: 'VALIDATION', errors: [] };
    }
    return development(request);
  } });
  const store = createStore({ api, storage: safeStorage(null) });
  if (login) {
    await store.signup('自分', PASS);
    await api.request('signup', PASS, { userId: '仲間' });
    for (const record of records) await store.mutate('create', { record: { id: crypto.randomUUID(), registrant: '仲間', memo: '', ...record }, allowDifferentChild: true });
    await store.refresh();
  }
  const owned = {
    state: {
      role: 'host', uploadReady: true, busy: false, linkedWorldId: 'W1',
      local: { importedAt: '2026-10-06T00:00:00.000Z', world: { id: 'W1' }, snapshot: { players, breedFarms: farms } },
    },
  };
  const creates = [];
  let gate = null;
  let failNext = '';
  const original = store.mutate;
  store.mutate = async (action, payload) => {
    if (action === 'create') creates.push(payload);
    await gate;
    if (failNext) {
      const code = failNext;
      failNext = '';
      throw new ApiError(code);
    }
    return original(action, payload);
  };
  const toasts = [];
  let noticed = 0;
  const storage = safeStorage(memoryStorage());
  const auto = createAutoRegister({
    store, owned, storage, namespace: 't', toast: (message) => toasts.push(message), onNotice: () => { noticed++; },
    loadTable: async () => ({ default: data }),
  });
  const run = async () => { auto.evaluate(); await auto.idle(); };
  return {
    store, api, owned, auto, creates, toasts, run, storage,
    get noticed() { return noticed; },
    original,
    rejectNextCreate() { rejectNextCreate = true; },
    holdServer() {
      let release;
      serverGate = new Promise((resolve) => { release = resolve; });
      return () => { serverGate = null; release(); };
    },
    failNextWith(code) { failNext = code; },
    hold() {
      let release;
      gate = new Promise((resolve) => { release = resolve; });
      return () => { gate = null; release(); };
    },
  };
}

const registered = (store) => store.state.records.map((r) => `${r.parent1Id}(${r.parent1Gender})×${r.parent2Id}(${r.parent2Gender})>${r.childId}:${r.registrant}`);

test('自動登録: 牧場のタマゴが配合表どおりなら、親を預けた人（同じ名前のユーザー）で登録し、知らせる', async () => {
  const t = await setup();
  await t.run();
  assert.deepEqual(registered(t.store), ['SheepBall(F)×SwordCutlassfish(M)>GuardianDog:自分']);
  assert.deepEqual(t.toasts, ['配合を自動登録しました（1件）']);
  // 読み直しても、2 回目は登録しない
  await t.run();
  t.owned.state.local = { ...t.owned.state.local, importedAt: '2026-10-06T00:01:00.000Z' };
  await t.run();
  assert.equal(t.creates.length, 1);
});

test('自動登録: 同じ種族どうしも登録し、登録済みの組み合わせは送らない', async () => {
  const t = await setup({ farms: [sheepFarm(), dogFarm()], records: [{ parent1Id: 'SheepBall', parent2Id: 'SwordCutlassfish', childId: 'GuardianDog' }] });
  await t.run();
  assert.equal(t.creates.length, 1);
  assert.equal(t.creates[0].record.parent1Id, 'GuardianDog');
});

test('自動登録: 同じ組み合わせで別の子が登録済みなら、登録せず「登録済みと違う」と通知する', async () => {
  const t = await setup({ records: [{ parent1Id: 'SheepBall', parent2Id: 'SwordCutlassfish', childId: 'PinkCat' }] });
  await t.run();
  assert.equal(t.creates.length, 0);
  const [notice] = t.auto.notices();
  assert.equal(notice.title, '登録済みの配合と違います');
  assert.match(notice.id, /^auto-breed:test:conflict:f1:/);
  assert.ok(Number.isFinite(Date.parse(notice.date)));
  assert.equal(t.noticed, 1);
});

test('自動登録: 親の性別で子が変わる組み合わせは、別の子が登録済みでも別の結果として登録する', async () => {
  const t = await setup({
    farms: [farm('f1', [parent('CatMage', 'Male'), parent('FoxMage', 'Female')], ['FoxMage_Dark'])],
    records: [{ parent1Id: 'CatMage', parent1Gender: 'F', parent2Id: 'FoxMage', parent2Gender: 'M', childId: 'CatMage_Fire' }],
  });
  await t.run();
  assert.equal(t.creates.length, 1);
  assert.equal(t.creates[0].allowDifferentChild, true);
  assert.equal(t.creates[0].record.childId, 'FoxMage_Dark');
});

test('自動登録: 配合表と合わないタマゴは登録せず通知だけ出す', async () => {
  const t = await setup({ farms: [farm('f1', [parent('GhostDragon_Fire', 'Male'), parent('IceNarwhal_Fire', 'Female')], ['GuardianDog'])] });
  await t.run();
  assert.equal(t.creates.length, 0);
  assert.deepEqual(t.auto.notices().map((n) => n.title), ['配合の照合が合いません']);
  assert.equal(t.noticed, 1);
  // 同じ通知は重ねない
  await t.run();
  assert.equal(t.auto.notices().length, 1);
  assert.equal(t.noticed, 1);
});

test('自動登録: 設定オフ・参加している側・復元しただけのセーブ・読み込み中では動かない', async () => {
  const t = await setup();
  t.auto.setEnabled(false);
  await t.auto.idle();
  for (const change of [{ role: 'guest' }, { uploadReady: false }, { busy: true }, { linkedWorldId: 'OTHER' }]) {
    Object.assign(t.owned.state, change);
    await t.run();
  }
  t.auto.setEnabled(true);
  await t.auto.idle();
  assert.equal(t.creates.length, 0);
  Object.assign(t.owned.state, { role: 'host', uploadReady: true, busy: false, linkedWorldId: 'W1' });
  await t.run();
  assert.equal(t.creates.length, 1);
});

test('自動登録: ログインが後から済んだときも登録する', async () => {
  const t = await setup({ login: false });
  await t.run();
  assert.equal(t.creates.length, 0);
  await t.store.signup('自分', PASS);
  await t.run();
  assert.equal(t.creates.length, 1);
});

test('自動登録: 通信に失敗した組み合わせは、同じセーブの間は送り直さず、新しいセーブを読んだら送り直す', async () => {
  const t = await setup();
  t.failNextWith('CONNECTION');
  await t.run();
  await t.run();
  assert.equal(t.creates.length, 1);
  assert.deepEqual(registered(t.store), []);
  t.owned.state.local = { ...t.owned.state.local, importedAt: '2026-10-06T00:05:00.000Z' };
  await t.run();
  assert.equal(t.creates.length, 2);
  assert.equal(registered(t.store).length, 1);
});

test('自動登録: 送信中に設定をオフにしたり別のセーブを読んだりすると、残りは送らない', async () => {
  for (const change of [
    (t) => t.auto.setEnabled(false),
    (t) => { t.owned.state.local = { ...t.owned.state.local, importedAt: '2026-10-06T09:00:00.000Z', snapshot: { players: [], breedFarms: [] } }; },
    (t) => { t.owned.state.uploadReady = false; },
  ]) {
    const t = await setup({ farms: [sheepFarm(), dogFarm()] });
    const release = t.hold();
    t.auto.evaluate();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(t.creates.length, 1);
    change(t);
    release();
    await t.auto.idle();
    assert.equal(t.creates.length, 1);
  }
});

test('自動登録: 送信中に何度呼ばれても、同じ組み合わせを二重に送らない', async () => {
  const t = await setup({ farms: [sheepFarm(), dogFarm()] });
  const release = t.hold();
  t.auto.evaluate();
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    t.auto.evaluate();
  }
  release();
  await t.auto.idle();
  assert.equal(t.creates.length, 2);
  assert.equal(registered(t.store).length, 2);
});

test('自動登録: 対応が未設定のプレイヤーの配合は通知だけ出し、対応づけたらその人で登録する', async () => {
  const t = await setup({ farms: [sheepFarm(P2)] });
  await t.run();
  assert.equal(t.creates.length, 0);
  assert.deepEqual(t.auto.notices().map((n) => [n.title, n.href]), [['プレイヤーの対応が未設定です', '#/settings']]);
  t.auto.setMapping(P2, '仲間');
  await t.auto.idle();
  assert.deepEqual(registered(t.store), ['SheepBall(F)×SwordCutlassfish(M)>GuardianDog:仲間']);
  assert.deepEqual(t.auto.mapping(), { [P2]: '仲間' });
  // 対応づけたプレイヤーの「未設定」の通知は消える
  assert.deepEqual(t.auto.notices(), []);
});

test('自動登録: 同じ名前のユーザーが後から増えたら、その人で登録する', async () => {
  const t = await setup({ farms: [sheepFarm(P2)], players: [{ uid: P2, name: 'harapi' }] });
  await t.run();
  assert.equal(t.creates.length, 0);
  await t.api.request('signup', PASS, { userId: 'harapi' });
  await t.store.refresh();
  await t.run();
  assert.deepEqual(registered(t.store), ['SheepBall(F)×SwordCutlassfish(M)>GuardianDog:harapi']);
});

test('自動登録: 預けた人が違う親どうしは、ログイン中の ID で登録する', async () => {
  const t = await setup({ farms: [farm('f1', [parent('SheepBall', 'Female', P1), parent('SwordCutlassfish', 'Male', P2)], ['GuardianDog'])] });
  await t.run();
  assert.deepEqual(registered(t.store), ['SheepBall(F)×SwordCutlassfish(M)>GuardianDog:自分']);
});

test('自動登録: 送信中に対応づけを変えたら、残りの組み合わせは新しい対応で登録する', async () => {
  const t = await setup({ farms: [sheepFarm(P2), farm('f2', [parent('GuardianDog', 'Male', P2), parent('GuardianDog', 'Female', P2)], ['GuardianDog'])] });
  const release = t.hold();
  // 対応づけると判定が始まり、1 件目を送っている間に対応を変える
  t.auto.setMapping(P2, '仲間');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(t.creates.length, 1);
  t.auto.setMapping(P2, '自分');
  release();
  await t.auto.idle();
  assert.deepEqual(t.creates.map((c) => c.record.registrant), ['仲間', '自分']);
});

test('自動登録: 登録済みの別の子と親の性別の並びが同じなら、性別で変わる組み合わせでも登録せず通知する', async () => {
  const t = await setup({
    farms: [farm('f1', [parent('CatMage', 'Male'), parent('FoxMage', 'Female')], ['FoxMage_Dark'])],
    records: [{ parent1Id: 'CatMage', parent1Gender: 'M', parent2Id: 'FoxMage', parent2Gender: 'F', childId: 'CatMage_Fire' }],
  });
  await t.run();
  assert.equal(t.creates.length, 0);
  assert.deepEqual(t.auto.notices().map((n) => n.title), ['登録済みの配合と違います']);
});

test('自動登録: ほかの登録が送信待ちの間は判定せず、それが取り消されたら登録する', async () => {
  const t = await setup();
  const release = t.holdServer();
  t.rejectNextCreate();
  const manual = t.original('create', { record: {
    id: crypto.randomUUID(), parent1Id: 'SheepBall', parent1Gender: '', parent2Id: 'SwordCutlassfish', parent2Gender: '', childId: 'GuardianDog', registrant: '自分', memo: '',
  } }).catch((error) => error);
  await t.run();
  assert.equal(t.creates.length, 0);
  release();
  assert.equal((await manual).code, 'VALIDATION');
  await t.run();
  assert.deepEqual(registered(t.store), ['SheepBall(F)×SwordCutlassfish(M)>GuardianDog:自分']);
});

test('自動登録: 認証切れでログアウトされたら止め、ログインし直したら同じセーブでも送り直す', async () => {
  const t = await setup();
  t.failNextWith('AUTH');
  const mutate = t.store.mutate;
  t.store.mutate = async (...args) => {
    try { return await mutate(...args); } catch (error) { if (error.code === 'AUTH') t.store.logout(); throw error; }
  };
  await t.run();
  assert.deepEqual(registered(t.store), []);
  await t.store.login('自分', PASS);
  await t.run();
  assert.equal(t.creates.length, 2);
  assert.equal(registered(t.store).length, 1);
});

test('自動登録: サーバの失敗が続いても、同じセーブの間は送り直さない（store の通知で何度呼ばれても）', async () => {
  const t = await setup({ farms: [sheepFarm(), dogFarm()] });
  const unsubscribe = t.store.subscribe(() => t.auto.evaluate());
  t.failNextWith('INTERNAL');
  await t.run();
  for (let i = 0; i < 3; i++) await t.run();
  unsubscribe();
  assert.equal(t.creates.length, 2);
  assert.equal(registered(t.store).length, 1);
});

test('自動登録: 参加している側のワールドに切り替えて戻っても、その間に変わった登録で判定し直す', async () => {
  const t = await setup({ records: [{ parent1Id: 'SheepBall', parent2Id: 'SwordCutlassfish', childId: 'PinkCat' }] });
  await t.run();
  assert.equal(t.creates.length, 0);
  Object.assign(t.owned.state, { role: 'guest', linkedWorldId: 'W2' });
  await t.run();
  const [conflicting] = t.store.state.records;
  await t.store.mutate('delete', { id: conflicting.id, expectedEtag: conflicting.etag });
  Object.assign(t.owned.state, { role: 'host', linkedWorldId: 'W1' });
  await t.run();
  assert.deepEqual(registered(t.store), ['SheepBall(F)×SwordCutlassfish(M)>GuardianDog:自分']);
});

test('自動登録: ワールドを切り替えて戻ると、その間に変わった登録で判定し直す', async () => {
  const t = await setup({ records: [{ parent1Id: 'SheepBall', parent2Id: 'SwordCutlassfish', childId: 'PinkCat' }] });
  await t.run();
  assert.equal(t.creates.length, 0);
  const w1 = t.owned.state.local;
  Object.assign(t.owned.state, { linkedWorldId: 'W2', local: { ...w1, world: { id: 'W2' }, snapshot: { players: [], breedFarms: [] } } });
  await t.run();
  const [conflicting] = t.store.state.records;
  await t.store.mutate('delete', { id: conflicting.id, expectedEtag: conflicting.etag });
  Object.assign(t.owned.state, { linkedWorldId: 'W1', local: w1 });
  await t.run();
  assert.deepEqual(registered(t.store), ['SheepBall(F)×SwordCutlassfish(M)>GuardianDog:自分']);
});
