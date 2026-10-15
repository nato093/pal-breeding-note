import { test } from 'node:test';
import assert from 'node:assert/strict';
import data from '../../web/data/breeding.js';
import pals from '../../web/data/pals.js';
import { decodeBreeding, breedChild } from '../../web/js/core/breeding.js';
import { createDevelopmentApi } from '../../dev/mock-api.js';
import { createApi, ApiError } from '../../web/js/api.js';
import { createStore, safeStorage } from '../../web/js/store.js';
import { createAutoRegister, safeAutoNotice, AUTO_NOTICE_TITLES } from '../../web/js/auto-register.js';
import { cleanNotification, groupNotifications } from '../../web/js/notifications.js';
import { moveUserStorage } from '../../web/js/user-rename.js';

const PASS = '自動登録の試験用';
const P1 = 'p-1';
const P2 = 'p-2';
const parent = (characterId, gender, depositorUid = P1) => ({ instanceId: `${characterId}-${gender}-${depositorUid}`, characterId, gender, depositorUid });
const farm = (id, parents, eggs) => ({ id, baseId: 'b', status: 'ok', parents, eggs: eggs.map((c, i) => ({ localId: `${id}-${i}`, characterId: c, itemId: 'PalEgg_Earth_01' })) });
// 前に読んだときの牧場（同じ親で、まだタマゴがない）
const emptied = (farms) => farms.map((f) => ({ ...f, eggs: [] }));
// SheepBall×SwordCutlassfish→GuardianDog（手元のセーブで確かめた組み合わせ）
const sheepFarm = (depositor = P1, id = 'f1') => farm(id, [parent('SheepBall', 'Female', depositor), parent('SwordCutlassfish', 'Male', depositor)], ['GuardianDog']);
const dogFarm = (id = 'f2') => farm(id, [parent('GuardianDog', 'Male'), parent('GuardianDog', 'Female')], ['GuardianDog']);

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
}

async function setup({ farms = [sheepFarm()], players = [{ uid: P1, name: '自分' }, { uid: P2, name: 'Frank' }], records = [], login = true, storage: givenStorage = null, worldId = 'W1' } = {}) {
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
      role: 'host', uploadReady: true, busy: false, linkedWorldId: worldId,
      local: { importedAt: '2026-10-05T23:59:00.000Z', world: { id: worldId }, snapshot: { players, breedFarms: emptied(farms) } },
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
  // トーストの操作（「見る」）と、押したときの移り先
  const toastActions = [];
  const navigations = [];
  let noticed = 0;
  const storage = givenStorage ?? safeStorage(memoryStorage());
  const auto = createAutoRegister({
    store, owned, storage, namespace: 't', toast: (message, options) => { toasts.push(message); toastActions.push(options); }, onNotice: () => { noticed++; },
    navigate: (hash) => navigations.push(hash), loadTable: async () => ({ default: data }),
  });
  const run = async () => { auto.evaluate(); await auto.idle(); };
  // 新しく読んだセーブ（牧場にタマゴが現れた）にする
  let reads = 0;
  const lay = (next = farms) => {
    owned.state.local = { ...owned.state.local, importedAt: `2026-10-06T00:00:${String(reads++).padStart(2, '0')}.000Z`, snapshot: { players, breedFarms: next } };
  };
  // ログインしていれば、タマゴのない牧場を一度読んでから、タマゴが現れたセーブにしておく
  if (login) {
    await run();
    lay();
  }
  return {
    store, api, owned, auto, creates, toasts, toastActions, navigations, run, lay, storage,
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

test('自動登録（autoreg-visibility）: 成功のトーストに「見る」。1 件ならその組、2 件以上なら更新日の新しい順の配合を探す', async () => {
  const t = await setup();
  await t.run();
  assert.equal(t.toastActions[0].actionLabel, '見る');
  t.toastActions[0].action();
  assert.deepEqual(t.navigations, ['#/search?p1=SheepBall&p2=SwordCutlassfish']);
  // 2 件のとき
  const two = await setup({ farms: [sheepFarm(), dogFarm()] });
  await two.run();
  assert.equal(two.toasts.at(-1), '配合を自動登録しました（2件）');
  two.toastActions.at(-1).action();
  assert.deepEqual(two.navigations, ['#/search?sort=updated']);
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
  assert.equal(notice.title, '自動登録を保留した配合');
  // 親と、登録済みの子だけを出す。配合表の子（ヤクモマル）は出さない（INV-2）。親の組の記号は用語表の「＋」（前は「×」）
  assert.match(notice.body, /^(モコロン＋オオタチウオ|オオタチウオ＋モコロン)：登録済みの配合（子 ツッパニャン）と食い違うため、保留しました$/);
  assert.doesNotMatch(`${notice.title}${notice.body}`, /ヤクモマル|表は/);
  assert.match(notice.id, /^auto-breed:test:conflict:f1:/);
  // 押すと配合を探すでその組の登録を出す（前は一覧〔#/list〕）
  assert.match(notice.href, /^#\/search\?p1=(SheepBall&p2=SwordCutlassfish|SwordCutlassfish&p2=SheepBall)$/);
  assert.ok(Number.isFinite(Date.parse(notice.date)));
  // 通知欄の行の画像は親1（候補の子は配合表で決めた値なので使わない。bell）
  assert.ok(['SheepBall', 'SwordCutlassfish'].includes(notice.palId));
  assert.equal(notice.palId, notice.href.match(/p1=(\w+)/)[1]);
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

test('自動登録: 新しいふつうのタマゴが配合表と合わないときは、登録せず通知だけ出す', async () => {
  const t = await setup({ farms: [farm('f1', [parent('GhostDragon_Fire', 'Male'), parent('IceNarwhal_Fire', 'Female')], ['GuardianDog'])] });
  await t.run();
  assert.equal(t.creates.length, 0);
  assert.deepEqual(t.auto.notices().map((n) => n.title), ['自動登録しなかったタマゴ']);
  // 親と、観測したタマゴの中身（ヤクモマル）だけを出す。配合表の子（テラナイト）は出さない（INV-2）
  const [notice] = t.auto.notices();
  assert.match(notice.body, /^(ヘルバーン＋モモエール|モモエール＋ヘルバーン) のタマゴ（ヤクモマル）は照合が合わず、自動登録しませんでした$/);
  assert.doesNotMatch(`${notice.title}${notice.body}`, /テラナイト|表は/);
  // 通知欄の行の画像はセーブで見たタマゴの中身（bell）。押すと配合を探すでその親の組（autoreg-visibility。D-03）
  assert.equal(notice.palId, 'GuardianDog');
  assert.match(notice.href, /^#\/search\?p1=(GhostDragon_Fire&p2=IceNarwhal_Fire|IceNarwhal_Fire&p2=GhostDragon_Fire)$/);
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

test('自動登録: オン・オフと登録者の対応を変えると、購読した関数に知らせる（外した後は知らせない）', async () => {
  const t = await setup();
  let calls = 0;
  const unsubscribe = t.auto.subscribe(() => { calls++; });
  t.auto.setEnabled(false);
  assert.equal(calls, 1);
  assert.equal(t.auto.enabled(), false);
  t.auto.setMapping(P2, '仲間');
  assert.equal(calls, 2);
  // ワールドが分からず保存しなかったときは知らせない
  t.auto.setEnabled(true, '');
  assert.equal(calls, 2);
  unsubscribe();
  t.auto.setEnabled(true);
  assert.equal(calls, 2);
  await t.auto.idle();
});

test('自動登録: ログインが後から済んだときも登録する', async () => {
  const t = await setup({ login: false });
  await t.run();
  assert.equal(t.creates.length, 0);
  await t.store.signup('自分', PASS);
  // ログイン後に初めて読んだセーブは記録するだけ。その後に現れたタマゴを登録する
  await t.run();
  assert.equal(t.creates.length, 0);
  t.lay();
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
  // 押すと設定のそのワールドの行を開き、未設定の登録者の選択にフォーカスする（router.js の settingsHash）
  assert.deepEqual(t.auto.notices().map((n) => [n.title, n.href]), [['プレイヤーの対応が未設定です', '#/settings?world=W1&open=registrant']]);
  // 呼び名は設定の欄と同じ「プレイヤーの対応」（roles。C-04）
  assert.equal(t.auto.notices()[0].body, 'Frankの配合を登録できません。設定の「プレイヤーの対応」で選んでください。');
  t.auto.setMapping(P2, '仲間');
  await t.auto.idle();
  assert.deepEqual(registered(t.store), ['SheepBall(F)×SwordCutlassfish(M)>GuardianDog:仲間']);
  assert.deepEqual(t.auto.mapping(), { [P2]: '仲間' });
  // 対応づけたプレイヤーの「未設定」の通知は消え、登録した配合の通知だけが残る
  assert.deepEqual(t.auto.notices().map((n) => n.title), ['配合を自動登録しました']);
});

test('自動登録（autoreg-visibility）: 登録待ちの候補を、登録者未設定と登録済みと違うに分けて親だけで返し（子は返さない）、破棄できる', async () => {
  // P2（Frank）の牧場は登録者が未設定。自分の牧場（モコロン＋オオタチウオ）は、同じ組で別の子（ツッパニャン）が登録済み
  const t = await setup({ farms: [sheepFarm(P2), dogFarm()], records: [{ parent1Id: 'SheepBall', parent2Id: 'SwordCutlassfish', childId: 'PinkCat' }] });
  await t.run();
  const summary = t.auto.pendingSummary();
  assert.equal(summary.unmapped.length, 1);
  assert.deepEqual([summary.unmapped[0].uid, summary.unmapped[0].name], [P2, 'Frank']);
  assert.deepEqual(summary.unmapped[0].parents.sort(), ['SheepBall', 'SwordCutlassfish']);
  // 候補の子（配合表の答え）は結果のどこにも入れない（INV-2）
  assert.doesNotMatch(JSON.stringify(summary), /GuardianDog|childId/);
  assert.deepEqual(Object.keys(summary), ['unmapped', 'conflict']);
  for (const item of [...summary.unmapped, ...summary.conflict]) assert.deepEqual(Object.keys(item).filter((key) => !['uid', 'name', 'parents', 'id'].includes(key)), []);
  // 別のワールド・ログアウト中は空
  assert.deepEqual(t.auto.pendingSummary('W2'), { unmapped: [], conflict: [] });
  // 破棄すると外れ、知らせる
  let changes = 0;
  t.auto.subscribe(() => { changes++; });
  const conflict = summary.conflict[0] ?? null;
  if (conflict) {
    assert.equal(t.auto.discardPending(conflict.id), true);
    assert.equal(t.auto.pendingSummary().conflict.length, 0);
    assert.equal(changes, 1);
  }
  assert.equal(t.auto.discardPending('ない候補'), false);
});

test('自動登録（autoreg-visibility）: 登録済みと違う候補は「登録済みと違う」に入れ、破棄したら送らない', async () => {
  const t = await setup({ records: [{ parent1Id: 'SheepBall', parent2Id: 'SwordCutlassfish', childId: 'PinkCat' }] });
  await t.run();
  const { conflict, unmapped } = t.auto.pendingSummary();
  assert.equal(unmapped.length, 0);
  assert.equal(conflict.length, 1);
  assert.deepEqual(conflict[0].parents.sort(), ['SheepBall', 'SwordCutlassfish']);
  assert.match(conflict[0].id, /^p[0-9a-f]{8}$/);
  assert.doesNotMatch(JSON.stringify(conflict), /GuardianDog/);
  assert.equal(t.auto.discardPending(conflict[0].id), true);
  assert.deepEqual(t.auto.pendingSummary(), { unmapped: [], conflict: [] });
  // 次の読み込みでも、破棄した候補は送らない
  t.lay();
  await t.run();
  assert.equal(t.creates.length, 0);
});

test('自動登録: 同じ名前のユーザーが後から増えたら、その人で登録する', async () => {
  const t = await setup({ farms: [sheepFarm(P2)], players: [{ uid: P2, name: 'Frank' }] });
  await t.run();
  assert.equal(t.creates.length, 0);
  await t.api.request('signup', PASS, { userId: 'Frank' });
  await t.store.refresh();
  await t.run();
  assert.deepEqual(registered(t.store), ['SheepBall(F)×SwordCutlassfish(M)>GuardianDog:Frank']);
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
  assert.deepEqual(t.auto.notices().map((n) => n.title), ['自動登録を保留した配合']);
  // 配合表の子（フォレーオ）は出さず、登録済みの子（クレメーナ）だけ
  assert.match(t.auto.notices()[0].body, /子 クレメーナ）/);
  assert.doesNotMatch(t.auto.notices()[0].body, /フォレーオ|表は/);
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

test('自動登録: 突然変異タマゴが産まれても、親の組み合わせの配合（表の子）として登録し、異常として通知しない', async () => {
  const ghosts = [parent('GhostDragon_Fire', 'Male'), parent('BOSS_GhostDragon_Fire', 'Female')];
  const t = await setup({ farms: [{ ...farm('f1', ghosts, []), eggs: [{ localId: 'm1', characterId: 'BOSS_DomeArmorDragon', itemId: 'PalEgg_MutationPal_05' }] }] });
  await t.run();
  assert.deepEqual(registered(t.store), ['GhostDragon_Fire(M)×GhostDragon_Fire(F)>GhostDragon_Fire:自分']);
  // 異常の通知は出さず、登録した配合の通知だけ。本文は登録したレコードだけで作る（タマゴの中身〔シェルガドラ〕も出さない。INV-2）
  assert.deepEqual(t.auto.notices().map((n) => [n.title, n.body]), [['配合を自動登録しました', 'ヘルバーン♂＋ヘルバーン♀ → ヘルバーン（配合牧場）']]);
  assert.doesNotMatch(t.auto.notices()[0].body, /シェルガドラ|表は|予想は/);
});

test('自動登録: 前の版の「照合が合いません」の通知は出さない', async () => {
  const t = await setup({ farms: [] });
  const key = 't.autoBreeding.notices.test.自分';
  t.storage.set(key, JSON.stringify([{ id: 'auto-breed:test:mismatch:f1:e1', date: '2026-10-06T00:00:00.000Z', title: '配合の照合が合いません', body: '' }]));
  assert.deepEqual(t.auto.notices(), []);
});

test('自動登録: 牧場の上の突然変異タマゴが登録済みと食い違っても、通知に配合表の子もタマゴの中身も出さない', async () => {
  // 突然変異タマゴ（中身は親と関係ないツッパニャン）は、表の子（ヤクモマル）の配合の候補になる。登録済みはタマコッコ
  const mutation = { ...sheepFarm(), eggs: [{ localId: 'f1-0', characterId: 'PinkCat', itemId: 'PalEgg_MutationPal_Dragon_01' }] };
  const t = await setup({ farms: [mutation], records: [{ parent1Id: 'SheepBall', parent2Id: 'SwordCutlassfish', childId: 'ChickenPal' }] });
  await t.run();
  assert.equal(t.creates.length, 0);
  const [notice] = t.auto.notices();
  assert.equal(notice.title, '自動登録を保留した配合');
  assert.match(notice.body, /子 タマコッコ）と食い違うため、保留しました$/);
  assert.doesNotMatch(`${notice.title}${notice.body}`, /ヤクモマル|ツッパニャン|表は/);
});

test('自動登録: 前の版が保存した「プレイヤーの対応が未設定です」の行き先（#/settings・open=auto）は、読み出すときにそのワールドの登録者の行き先にする（id はそのまま）', async () => {
  const t = await setup({ farms: [] });
  const key = 't.autoBreeding.notices.test.自分';
  const date = '2026-10-06T00:00:00.000Z';
  const WORLD = 'ABCDEF0123456789ABCDEF0123456789';
  t.storage.set(key, JSON.stringify([
    { id: `auto-breed:test:unmapped:${WORLD}:00000000-0000-0000-0000-000000000002`, date, title: 'プレイヤーの対応が未設定です', body: 'Frankの配合を登録できません。', href: '#/settings' },
    // 未配信の版（participant-self）が書いた、意図の分かれていない行き先（open=auto。自分が決まっていないと「このワールドでの自分」へ移った）
    { id: `auto-breed:test:unmapped:${WORLD}:p-4`, date, title: 'プレイヤーの対応が未設定です', body: '', href: `#/settings?world=${WORLD}&open=auto` },
    // 未設定の通知でないもの・すでに行き先のあるものは変えない
    { id: 'auto-breed:test:conflict:f2:e2', date, title: '自動登録を保留した配合', body: 'A×B', href: '#/settings' },
    { id: `auto-breed:test:unmapped:${WORLD}:p-3`, date, title: 'プレイヤーの対応が未設定です', body: '', href: '#/list' },
  ]));
  assert.deepEqual(t.auto.notices().map((n) => [n.id, n.href]), [
    [`auto-breed:test:unmapped:${WORLD}:00000000-0000-0000-0000-000000000002`, `#/settings?world=${WORLD}&open=registrant`],
    [`auto-breed:test:unmapped:${WORLD}:p-4`, `#/settings?world=${WORLD}&open=registrant`],
    ['auto-breed:test:conflict:f2:e2', '#/settings'],
    [`auto-breed:test:unmapped:${WORLD}:p-3`, '#/list'],
  ]);
  // 保存し直さない（旧コードのまま開いているタブが読んでも、前と同じ形）
  assert.equal(JSON.parse(t.storage.get(key))[0].href, '#/settings');
});

test('自動登録: 前の版が保存した通知の「表は X」は、読み出すときに外す（id はそのまま）', async () => {
  const t = await setup({ farms: [] });
  const key = 't.autoBreeding.notices.test.自分';
  const date = '2026-10-06T00:00:00.000Z';
  t.storage.set(key, JSON.stringify([
    { id: 'auto-breed:test:anomaly:f1:e1', date, title: '配合の結果が表と違います', body: 'モコロン×ツッパニャン：表はセレムーン、新しいタマゴはフラリーナ' },
    { id: 'auto-breed:test:conflict:f2:e2', date, title: '登録済みの配合と違います', body: 'モコロン×オオタチウオ：表はヤクモマル、登録はツッパニャン・タマコッコ', href: '#/list' },
    { id: 'auto-breed:test:anomaly:f3:e3', date, title: '配合の結果が表と違います', body: '表はセレムーン（形の違う古い文）' },
    { id: 'auto-breed:test:unmapped:W1:p-2', date, title: 'プレイヤーの対応が未設定です', body: 'Frankの配合を登録できません。設定で登録者を選んでください。', href: '#/settings' },
  ]));
  const notices = t.auto.notices();
  assert.deepEqual(notices.map((n) => n.id), ['auto-breed:test:anomaly:f1:e1', 'auto-breed:test:conflict:f2:e2', 'auto-breed:test:anomaly:f3:e3', 'auto-breed:test:unmapped:W1:p-2']);
  assert.deepEqual(notices.map((n) => [n.title, n.body]), [
    ['自動登録しなかったタマゴ', 'モコロン×ツッパニャン のタマゴ（フラリーナ）は照合が合わず、自動登録しませんでした'],
    ['自動登録を保留した配合', 'モコロン×オオタチウオ：登録済みの配合（子 ツッパニャン・タマコッコ）と食い違うため、保留しました'],
    // 形が分からない古い文は、本文を出さず題名だけにする
    ['自動登録しなかったタマゴ', ''],
    // 前の版が保存した本文はそのまま（新しく出す通知は「設定の「プレイヤーの対応」で選んでください。」）
    ['プレイヤーの対応が未設定です', 'Frankの配合を登録できません。設定で登録者を選んでください。'],
  ]);
  assert.equal(notices[1].href, '#/list');
  assert.ok(notices.every((n) => !/表は|セレムーン|ヤクモマル/.test(`${n.title}${n.body}`)));
});

test('自動登録: 名前の変更で新しい名前へ移した前の版の通知も、読み出すときに配合表の子（「表は X」）を外す', async () => {
  const raw = memoryStorage();
  const t = await setup({ farms: [], storage: safeStorage(raw) });
  const date = '2026-10-06T00:00:00.000Z';
  // 前の名前（旧名）で、前の版が保存した通知
  raw.setItem('t.autoBreeding.notices.test.旧名', JSON.stringify([
    { id: 'auto-breed:test:conflict:f2:e2', date, title: '登録済みの配合と違います', body: 'モコロン×オオタチウオ：表はヤクモマル、登録はツッパニャン', href: '#/list' },
    { id: 'auto-breed:test:anomaly:f1:e1', date, title: '配合の結果が表と違います', body: 'モコロン×ツッパニャン：表はセレムーン、新しいタマゴはフラリーナ' },
  ]));
  assert.equal(moveUserStorage(raw, 't', 'test', '旧名', '自分'), true);
  const notices = t.auto.notices();
  assert.deepEqual(notices.map((n) => n.id), ['auto-breed:test:conflict:f2:e2', 'auto-breed:test:anomaly:f1:e1']);
  assert.ok(notices.every((n) => !/表は|ヤクモマル|セレムーン/.test(`${n.title}${n.body}`)), JSON.stringify(notices));
});

test('自動登録: safeAutoNotice は自動登録の保留・見送りの通知だけを直し、ほかの通知はそのまま返す', () => {
  assert.deepEqual(AUTO_NOTICE_TITLES, { anomaly: '自動登録しなかったタマゴ', conflict: '自動登録を保留した配合' });
  const other = { id: 'release:2026-10-12-x', title: '表はどこ？', body: '表は X' };
  assert.equal(safeAutoNotice(other), other);
  const unmapped = { id: 'auto-breed:test:unmapped:W1:p', title: 'プレイヤーの対応が未設定です', body: '表は' };
  assert.equal(safeAutoNotice(unmapped), unmapped);
  // 新しい文はそのまま（読み出すたびに直しても変わらない）
  const fresh = { id: 'auto-breed:test:conflict:f:e', date: 'd', title: '自動登録を保留した配合', body: 'A×B：登録済みの配合（子 C）と食い違うため、保留しました', href: '#/list' };
  assert.deepEqual(safeAutoNotice(fresh), fresh);
  assert.deepEqual(safeAutoNotice(safeAutoNotice({ ...fresh, title: '登録済みの配合と違います', body: 'A×B：表はX、登録はC' })), fresh);
  // 今の版の本文（親の組の記号は「＋」。copy-dead-ends）もそのまま。前の版の本文（「×」）は、読み替えても「×」のまま
  const plus = { ...fresh, body: 'A＋B：登録済みの配合（子 C）と食い違うため、保留しました' };
  assert.deepEqual(safeAutoNotice(plus), plus);
  assert.equal(safeAutoNotice({ id: 'auto-breed:test:anomaly:f:e', title: '配合の結果が表と違います', body: 'A×B：表はX、新しいタマゴはY' }).body,
    'A×B のタマゴ（Y）は照合が合わず、自動登録しませんでした');
  // 本文がない・文字列でない古い通知でも落ちない
  assert.deepEqual(safeAutoNotice({ id: 'auto-breed:test:anomaly:f:e', title: '配合の結果が表と違います' }), { id: 'auto-breed:test:anomaly:f:e', title: '自動登録しなかったタマゴ', body: '' });
  assert.deepEqual(safeAutoNotice({ id: 'auto-breed:test:anomaly:f:e', body: 3 }).body, '3');
});

test('自動登録: ページを開き直しても、前に見たタマゴと登録を終えていない配合を覚えている', async () => {
  const t = await setup({ farms: [sheepFarm(P2)] });
  await t.run();
  assert.equal(t.creates.length, 0); // 登録者が未設定で残る
  const reopened = createAutoRegister({ store: t.store, owned: t.owned, storage: t.storage, namespace: 't', loadTable: async () => ({ default: data }) });
  reopened.setMapping(P2, '仲間');
  await reopened.idle();
  assert.deepEqual(registered(t.store), ['SheepBall(F)×SwordCutlassfish(M)>GuardianDog:仲間']);
  // 同じタマゴは、新しいセーブを読んでも二度と候補にしない
  t.lay();
  reopened.evaluate();
  await reopened.idle();
  assert.equal(registered(t.store).length, 1);
});

// 手元の一覧に反映される前に、別の人がサーバへ登録した配合
const registerElsewhere = (t, record) => t.api.request('create', PASS, {
  opId: crypto.randomUUID(), allowDifferentChild: true,
  record: { id: crypto.randomUUID(), parent1Gender: '', parent2Gender: '', registrant: '仲間', memo: '', ...record },
});

test('自動登録: サーバで食い違いと分かったときは、サーバが返した登録済みの子を通知に出す', async () => {
  const t = await setup();
  await registerElsewhere(t, { parent1Id: 'SheepBall', parent2Id: 'SwordCutlassfish', childId: 'PinkCat' });
  await t.run();
  assert.equal(t.creates.length, 1);
  const [notice] = t.auto.notices();
  assert.equal(notice.title, '自動登録を保留した配合');
  assert.match(notice.body, /子 ツッパニャン）と食い違うため、保留しました$/);
  assert.doesNotMatch(notice.body, /ヤクモマル|表は/);
});

test('自動登録（読み戻しの検証）: サーバの食い違いの応答の登録済みに形の違う要素があっても止まらず、object の要素の子だけを通知に出す', async () => {
  const t = await setup();
  t.store.mutate = async (action) => {
    if (action === 'create') throw new ApiError('PAIR_CONFLICT', { ok: false, code: 'PAIR_CONFLICT', existing: [null, 'PinkCat', 3, ['PinkCat'], { childId: 'PinkCat' }] });
  };
  await t.run();
  const [notice] = t.auto.notices();
  assert.equal(notice?.title, '自動登録を保留した配合');
  assert.match(notice.body, /登録済みの配合（子 ツッパニャン）と食い違うため、保留しました$/);
});

test('自動登録: 性別で変わる組み合わせを別の結果として送った後、性別の並びまで同じ食い違いが増えていたら通知する', async () => {
  const t = await setup({
    farms: [farm('f1', [parent('CatMage', 'Male'), parent('FoxMage', 'Female')], ['FoxMage_Dark'])],
    records: [{ parent1Id: 'CatMage', parent1Gender: 'F', parent2Id: 'FoxMage', parent2Gender: 'M', childId: 'CatMage_Fire' }],
  });
  // 送る前の確かめの後、同じ性別の並びで別の子が登録された
  await registerElsewhere(t, { parent1Id: 'CatMage', parent1Gender: 'M', parent2Id: 'FoxMage', parent2Gender: 'F', childId: 'SheepBall' });
  await t.run();
  assert.equal(t.creates[0].allowDifferentChild, true);
  // 登録はできているので、成功の通知も残す（同じ日時なら、対応の要る通知が先）
  assert.deepEqual(t.auto.notices().map((n) => n.title), ['自動登録を保留した配合', '配合を自動登録しました']);
  // 登録済みの子は両方（並びは登録の順）
  const conflict = t.auto.notices()[0];
  assert.match(conflict.body, /子 (クレメーナ・モコロン|モコロン・クレメーナ)）/);
  assert.doesNotMatch(conflict.body, /フォレーオ|表は/);
});

test('自動登録: サーバで食い違いと分かった配合は、同じセーブの間は送り直さず、一覧を取り直して手元で判定する', async () => {
  const t = await setup();
  await registerElsewhere(t, { parent1Id: 'SheepBall', parent2Id: 'SwordCutlassfish', childId: 'PinkCat' });
  // 実際の画面と同じく、store が変わるたびに判定する
  const unsubscribe = t.store.subscribe(() => t.auto.evaluate());
  await t.run();
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
  await t.auto.idle();
  assert.equal(t.creates.length, 1);
  // 新しいセーブを読んでも、取り直した一覧で食い違いと分かるので送らない
  t.owned.state.local = { ...t.owned.state.local, importedAt: '2026-10-06T05:00:00.000Z' };
  await t.run();
  unsubscribe();
  assert.equal(t.creates.length, 1);
  assert.ok(t.store.state.records.some((r) => r.childId === 'PinkCat'));
});

test('自動登録: 別のタブが新しいセーブで書いた記録を、古いセーブを持つタブが巻き戻さない', async () => {
  const ghosts = [parent('GhostDragon_Fire', 'Male'), parent('BOSS_GhostDragon_Fire', 'Female')];
  const mutation = { localId: 'm1', characterId: 'BOSS_DomeArmorDragon', itemId: 'PalEgg_MutationPal_05' };
  const t = await setup({ farms: [], login: true });
  const tab = (importedAt, updatedAt, eggs) => ({
    state: { role: 'host', uploadReady: true, busy: false, linkedWorldId: 'W1',
      local: { importedAt, world: { id: 'W1', updatedAt }, snapshot: { players: [], breedFarms: [{ ...farm('f1', ghosts, []), eggs }] } } },
  });
  const make = (owned) => createAutoRegister({ store: t.store, owned, storage: t.storage, namespace: 't2', loadTable: async () => ({ default: data }) });
  const ownedA = tab('a1', '2026-10-06T10:00:00.000Z', [mutation]);
  const ownedB = tab('b1', '2026-10-06T10:01:00.000Z', []);
  const a = make(ownedA);
  const b = make(ownedB);
  a.evaluate(); await a.idle(); // A が初めて読む（突然変異タマゴは前からあるもの）
  b.evaluate(); await b.idle(); // B はタマゴを拾った後の新しいセーブ
  a.evaluate(); await a.idle(); // A が古いセーブのまま判定し直す
  assert.equal(t.creates.length, 0);
});

test('自動登録: ブラウザに保存できない端末でも、ページを開いている間は登録する', async () => {
  const t = await setup({ storage: safeStorage(null) });
  await t.run();
  assert.deepEqual(registered(t.store), ['SheepBall(F)×SwordCutlassfish(M)>GuardianDog:自分']);
});

test('自動登録: 保存した記録が壊れていても止まらず、壊れた牧場は記録し直してから登録する', async () => {
  const t = await setup({ farms: [], login: true });
  const ctxKey = 't.autoBreeding.farms.test.W1';
  const sheep = sheepFarm();
  t.storage.set(ctxKey, JSON.stringify({ importedAt: 'x', savedAt: '', farms: { f1: { parents: sheep.parents.map((p) => p.instanceId).sort().join('|'), eggs: {} } }, pending: [{ key: 1 }, null] }));
  t.lay([sheep]);
  await t.run(); // 壊れた牧場は初めて読んだものとして記録し直す（登録しない）
  assert.equal(t.creates.length, 0);
  t.lay([{ ...sheep, eggs: [...sheep.eggs, { localId: 'new', characterId: 'GuardianDog', itemId: 'PalEgg_Earth_01' }] }]);
  await t.run();
  assert.equal(t.creates.length, 1);
});

test('自動登録: 登録の送信中に新しいセーブを読んでも、表と違うタマゴの通知を失わない', async () => {
  const odd = farm('f3', [parent('GhostDragon_Fire', 'Male'), parent('IceNarwhal_Fire', 'Female')], ['GuardianDog']);
  const t = await setup({ farms: [sheepFarm(), odd] });
  const release = t.hold();
  t.auto.evaluate();
  await new Promise((resolve) => setImmediate(resolve));
  t.lay();
  release();
  await t.auto.idle();
  // 送信中だった登録も確定したので、成功の通知も残る
  assert.deepEqual(t.auto.notices().map((n) => n.title), ['自動登録しなかったタマゴ', '配合を自動登録しました']);
});

test('自動登録: ブラウザへの保存が途中から失敗しても、メモリの新しい記録で判定する', async () => {
  const map = memoryStorage();
  let failWrites = false;
  const storage = safeStorage({ ...map, setItem: (k, v) => { if (!failWrites) map.setItem(k, v); } });
  const t = await setup({ storage });
  await t.run();
  assert.equal(t.creates.length, 1);
  failWrites = true;
  const fresh = farm('f9', [parent('GuardianDog', 'Male'), parent('GuardianDog', 'Female')], []);
  t.lay([sheepFarm(), fresh]);
  await t.run();
  t.lay([sheepFarm(), { ...fresh, eggs: [{ localId: 'f9-0', characterId: 'GuardianDog', itemId: 'PalEgg_Earth_01' }] }]);
  await t.run();
  assert.equal(t.creates.length, 2);
});

test('自動登録: タマゴの記録に壊れた要素がある牧場は、記録ごと捨てて前からあるタマゴを新しいものと取り違えない', async () => {
  const t = await setup({ farms: [], login: true });
  const sheep = sheepFarm();
  t.storage.set('t.autoBreeding.farms.test.W1', JSON.stringify({
    importedAt: 'x', savedAt: '', pending: [],
    farms: { f1: { parents: sheep.parents.map((p) => p.instanceId).sort().join('|'), eggs: [null] } },
  }));
  t.lay([sheep]);
  await t.run();
  assert.equal(t.creates.length, 0);
});

test('自動登録: オン・オフはワールドごとに持ち、ほかのワールドは前の設定のまま動く', async () => {
  const t = await setup();
  t.auto.setEnabled(false);
  await t.run();
  assert.equal(t.creates.length, 0);
  assert.equal(t.auto.enabled('W1'), false);
  assert.equal(t.auto.enabled('W2'), true);
  // 別のワールドに切り替えると、そのワールドでは登録する
  const w2 = (farms) => ({ importedAt: `2026-10-06T02:00:0${farms[0].eggs.length}.000Z`, world: { id: 'W2' }, snapshot: { players: [{ uid: P1, name: '自分' }], breedFarms: farms } });
  Object.assign(t.owned.state, { linkedWorldId: 'W2', local: w2(emptied([sheepFarm()])) });
  await t.run();
  t.owned.state.local = w2([sheepFarm()]);
  await t.run();
  assert.equal(t.creates.length, 1);
});

test('自動登録: 決着した配合を外す書き込みだけが保存に失敗しても、同じセーブの間に送り直さない', async () => {
  const map = memoryStorage();
  let failWrites = false;
  const storage = safeStorage({ ...map, setItem: (k, v) => { if (!failWrites) map.setItem(k, v); } });
  const t = await setup({ storage });
  const release = t.hold();
  t.auto.evaluate();
  await new Promise((resolve) => setImmediate(resolve)); // 候補を記録した後、送信の途中
  failWrites = true;
  t.failNextWith('VALIDATION');
  release();
  await t.auto.idle();
  await t.run();
  await t.run();
  assert.equal(t.creates.length, 1);
});

test('自動登録: このタブで登録を終えた配合は、別のタブが同じ記録を書き換えても送り直さない', async () => {
  const map = memoryStorage();
  let failWrites = false;
  const storage = safeStorage({ ...map, setItem: (k, v) => { if (!failWrites) map.setItem(k, v); } });
  const t = await setup({ storage });
  const key = 't.autoBreeding.farms.test.W1';
  const release = t.hold();
  t.auto.evaluate();
  await new Promise((resolve) => setImmediate(resolve)); // 候補を保存先に記録し、送信の途中
  const recorded = JSON.parse(map.getItem(key));
  assert.equal(recorded.pending.length, 1);
  // 決着（重複などの失敗）を外す書き込みだけ失敗する
  failWrites = true;
  t.failNextWith('VALIDATION');
  release();
  await t.auto.idle();
  // 別のタブが、同じセーブ・同じ番号で、決着前の候補が残った記録を書いた
  failWrites = false;
  map.setItem(key, JSON.stringify({ ...recorded, rev: recorded.rev + 1 }));
  await t.run();
  assert.equal(t.creates.length, 1);
});

test('自動登録: 産まれて 2 秒で拾い、牧場の上で一度も見えずに孵化器に入ったタマゴも、その牧場の配合として登録する', async () => {
  const t = await setup({ farms: [emptied([sheepFarm()])[0]] });
  await t.run();
  assert.equal(t.creates.length, 0);
  // 次に読んだセーブでは、牧場は空のまま、孵化器にタマゴがある
  t.owned.state.local = {
    ...t.owned.state.local, importedAt: '2026-10-06T03:00:00.000Z',
    snapshot: { ...t.owned.state.local.snapshot, pals: [{ instanceId: 'inc-1', source: 'egg', characterId: 'GuardianDog', location: { kind: 'egg-incubator', itemId: 'PalEgg_Earth_01' } }] },
  };
  await t.run();
  assert.deepEqual(registered(t.store), ['SheepBall(F)×SwordCutlassfish(M)>GuardianDog:自分']);
});

test('自動登録（読み戻しの検証）: 対応表に数値・長すぎる値が入っていても落ちず、その対応だけ無視する', async () => {
  const t = await setup({ farms: [sheepFarm(P2)] });
  const key = 't.autoBreeding.players.test.W1';
  t.storage.set(key, JSON.stringify({ [P2]: 5, [P1]: 'x'.repeat(21), ['u'.repeat(41)]: '仲間', '': '仲間' }));
  assert.deepEqual(t.auto.mapping(), {});
  await t.run();
  // 対応が無いのと同じ（未設定の通知）。正しい対応は今までどおり使う
  assert.equal(t.creates.length, 0);
  assert.deepEqual(t.auto.notices().map((n) => n.title), ['プレイヤーの対応が未設定です']);
  t.storage.set(key, JSON.stringify({ [P2]: '仲間', [P1]: 7 }));
  assert.deepEqual(t.auto.mapping(), { [P2]: '仲間' });
  await t.run();
  assert.deepEqual(registered(t.store), ['SheepBall(F)×SwordCutlassfish(M)>GuardianDog:仲間']);
  for (const broken of ['[]', '"text"', '3', '壊れた値']) {
    t.storage.set(key, broken);
    assert.deepEqual(t.auto.mapping(), {});
  }
});

test('自動登録（読み戻しの検証）: 保存した通知に日時のないもの・形の違うものがあっても落ちず、その通知だけを出さない', async () => {
  const t = await setup({ farms: [] });
  const key = 't.autoBreeding.notices.test.自分';
  const date = '2026-10-06T00:00:00.000Z';
  t.storage.set(key, JSON.stringify([
    null, 'notice', { id: 5, date }, { id: 'x'.repeat(201), date, title: '長い ID' },
    { id: 'auto-breed:test:unmapped:W1:a', title: '日時なし' },
    { id: 'auto-breed:test:unmapped:W1:b', date: 'いつか', title: '読めない日時' },
    { id: 'auto-breed:test:unmapped:W1:c', date, title: 'あ'.repeat(50), body: 'い'.repeat(250), href: 'https://example.com/' },
    { id: 'auto-breed:test:unmapped:W1:d', date, title: '画面内', body: 7, href: '#/settings' },
  ]));
  const notices = t.auto.notices();
  assert.deepEqual(notices.map((n) => n.id), ['auto-breed:test:unmapped:W1:c', 'auto-breed:test:unmapped:W1:d']);
  // 前の版の「未設定」の行き先（設定タブの先頭）は、そのワールドの行き先に読み替える（外の URL は捨てたまま）
  assert.deepEqual(notices.map((n) => [n.title.length, n.body.length, n.href ?? '']), [[40, 200, ''], [3, 0, '#/settings?world=W1&open=registrant']]);
  // 件数は NOTICE_MAX（50 件）まで
  t.storage.set(key, JSON.stringify(Array.from({ length: 80 }, (_, i) => ({ id: `auto-breed:test:unmapped:W1:${i}`, date, title: '未設定' }))));
  assert.equal(t.auto.notices().length, 50);
});

// 成功の通知（ベルに残す。docs/ui-refactor/phase-1d-small-fixes.md の autoreg-success）
const WORLD = 'ABCDEF0123456789ABCDEF0123456789';
const FIRST_READ = '2026-10-06T00:00:00.000Z';

test('自動登録（成功の通知）: 登録が確定すると、登録したレコードの親・子・拠点と、配合検索のその組への行き先を通知に残す', async () => {
  const t = await setup({ worldId: WORLD });
  Object.assign(t.owned.state, { meta: { worldId: WORLD }, owned: { bases: [{ id: 'b', label: '拠点 1' }] } });
  await t.run();
  const [{ record }] = t.creates;
  assert.deepEqual(t.auto.notices(), [{
    id: `auto-breed:test:registered:${record.id}`, date: FIRST_READ,
    title: '配合を自動登録しました', body: 'モコロン♀＋オオタチウオ♂ → ヤクモマル（拠点 1）',
    href: '#/search?p1=SheepBall&p2=SwordCutlassfish',
    // 通知欄の行の画像は登録した記録の子（bell）
    kind: 'auto-registered', worldId: WORLD, batchId: FIRST_READ, palId: record.childId,
  }]);
  // 配合表だけで決まる言い回しは出さない（INV-2）
  assert.doesNotMatch(t.auto.notices()[0].body, /表は|予想は/);
  assert.equal(t.noticed, 1);
  // ページを見ているときの即時の知らせ（トースト）は今までどおり
  assert.deepEqual(t.toasts, ['配合を自動登録しました（1件）']);
  // 読み直しても同じ通知を重ねない
  await t.run();
  assert.equal(t.auto.notices().length, 1);
  assert.equal(t.noticed, 1);
});

test('自動登録（成功の通知）: 拠点が分からないとき（別のワールドの所持パルを表示中・拠点がない）は「配合牧場」と出す', async () => {
  for (const state of [
    {},
    { meta: { worldId: 'OTHER' }, owned: { bases: [{ id: 'b', label: '拠点 1' }] } },
    { meta: { worldId: 'W1' }, owned: { bases: [{ id: 'c', label: '拠点 2' }] } },
    { meta: { worldId: 'W1' }, owned: null },
  ]) {
    const t = await setup();
    Object.assign(t.owned.state, state);
    await t.run();
    assert.deepEqual(t.auto.notices().map((n) => n.body), ['モコロン♀＋オオタチウオ♂ → ヤクモマル（配合牧場）'], JSON.stringify(state));
  }
});

test('自動登録（成功の通知）: 同じ読み込みで 2 件登録すると、レコードごとに同じ batchId の通知を 2 件残し、通知欄では 1 行にまとまる', async () => {
  const t = await setup({ farms: [sheepFarm(), dogFarm()], worldId: WORLD });
  await t.run();
  assert.equal(t.creates.length, 2);
  const notices = t.auto.notices();
  assert.deepEqual(notices.map((n) => n.id).sort(), t.creates.map((c) => `auto-breed:test:registered:${c.record.id}`).sort());
  assert.deepEqual(notices.map((n) => [n.kind, n.worldId, n.batchId]), [['auto-registered', WORLD, FIRST_READ], ['auto-registered', WORLD, FIRST_READ]]);
  assert.ok(notices.some((n) => /^ヤクモマル(♂＋ヤクモマル♀|♀＋ヤクモマル♂) → ヤクモマル（配合牧場）$/.test(n.body)), JSON.stringify(notices));
  // 登録が確定するごとに保存する
  assert.equal(t.noticed, 2);
  assert.deepEqual(t.toasts, ['配合を自動登録しました（2件）']);
  const rows = groupNotifications(notices.map(cleanNotification));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].body, `${notices[0].body} ほか 1 件`);
});

test('自動登録（成功の通知）: 1 件目の登録の後で止まっても（送信中に別のセーブを読んだ・設定をオフにした）、確定した 1 件目の通知は残す', async () => {
  for (const change of [
    (t) => { t.owned.state.local = { ...t.owned.state.local, importedAt: '2026-10-06T09:00:00.000Z', snapshot: { players: [], breedFarms: [] } }; },
    (t) => t.auto.setEnabled(false),
  ]) {
    const t = await setup({ farms: [sheepFarm(), dogFarm()] });
    const release = t.hold();
    t.auto.evaluate();
    await new Promise((resolve) => setImmediate(resolve));
    change(t);
    release();
    await t.auto.idle();
    assert.equal(t.creates.length, 1);
    assert.deepEqual(t.auto.notices().map((n) => [n.id, n.batchId]), [[`auto-breed:test:registered:${t.creates[0].record.id}`, FIRST_READ]]);
  }
});

// 成功の通知の保存先（既存のキー autoBreeding.notices は旧版のタブも読み書きするので、成功は別のキーに持つ）
const NOTICES_KEY = 't.autoBreeding.notices.test.自分';
const REGISTERED_KEY = 't.autoBreeding.registered.test.自分';
const successNotice = (id, date, world = WORLD) => ({
  id: `auto-breed:test:registered:${id}`, date, title: '配合を自動登録しました', body: `登録 ${id}`, href: '#/search?p1=SheepBall&p2=SwordCutlassfish',
  kind: 'auto-registered', worldId: world, batchId: date,
});
const second = (n) => `2026-10-05T00:${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}.000Z`;
// 旧版（e11f91d。配信中の版）のタブの通知の保存を写したもの（auto-register.js の cleanSavedNotice・readNotices・saveNotices）。
// 既存のキーを読み（id・date・title・body・href だけを写し、kind・worldId・batchId は捨てる。50 件まで）、足して日時の新しい順に
// 50 件で切って書き戻す
function oldTabSaveNotices(storage, key, added) {
  const clean = (value) => {
    if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id || value.id.length > 200) return null;
    if (/^auto-breed:[^:]*:mismatch:/.test(value.id) || !Number.isFinite(Date.parse(value.date))) return null;
    const notice = { id: value.id, date: new Date(value.date).toISOString(), title: String(value.title ?? '').slice(0, 40), body: String(value.body ?? '').slice(0, 200) };
    if (typeof value.href === 'string' && value.href.startsWith('#/')) notice.href = value.href;
    return notice;
  };
  let saved = [];
  try { saved = JSON.parse(storage.get(key)) ?? []; } catch { /* 読めなければ空 */ }
  const before = [];
  for (const value of Array.isArray(saved) ? saved : []) {
    if (before.length >= 50) break;
    const notice = clean(value);
    if (notice) before.push(notice);
  }
  const ids = new Set(before.map((n) => n.id));
  const next = [...before, ...added.filter((n) => !ids.has(n.id) && ids.add(n.id))]
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 50);
  storage.set(key, JSON.stringify(next));
}

test('自動登録（成功の通知）: 旧版のタブが既存のキーを 50 件で切って書き戻しても、未設定・見送りの通知は消えず、成功の通知のまとめ（kind・batchId）も消えない', async () => {
  const t = await setup({ farms: [sheepFarm(), dogFarm()], worldId: WORLD });
  const unmapped = { id: `auto-breed:test:unmapped:${WORLD}:p-2`, date: '2026-10-01T00:00:00.000Z', title: 'プレイヤーの対応が未設定です', body: 'Frankの配合を登録できません。', href: `#/settings?world=${WORLD}&open=registrant` };
  // 見送りの通知 48 件（未設定より新しく、読み込みより古い）と未設定で 49 件
  const anomalies = Array.from({ length: 48 }, (_, i) => ({ id: `auto-breed:test:anomaly:f9:e${i}`, date: second(100 - i), title: '自動登録しなかったタマゴ', body: '' }));
  t.storage.set(NOTICES_KEY, JSON.stringify([...anomalies, unmapped]));
  await t.run();
  assert.equal(t.creates.length, 2);
  // 成功の通知は既存のキーに入れない（旧版のタブが 50 件で切ると、成功の分だけ古い未設定・見送りが押し出されるため）
  assert.deepEqual(JSON.parse(t.storage.get(NOTICES_KEY)).map((n) => n.id), [...anomalies, unmapped].map((n) => n.id));
  assert.deepEqual(JSON.parse(t.storage.get(REGISTERED_KEY)).map((n) => n.id).sort(), t.creates.map((c) => `auto-breed:test:registered:${c.record.id}`).sort());
  // 旧版のタブが新しい見送りを 1 件足して書き戻す
  const added = { id: 'auto-breed:test:anomaly:f9:new', date: '2026-10-06T01:00:00.000Z', title: '自動登録しなかったタマゴ', body: '' };
  oldTabSaveNotices(t.storage, NOTICES_KEY, [added]);
  const notices = t.auto.notices();
  assert.deepEqual(notices.filter((n) => n.kind !== 'auto-registered').map((n) => n.id), [added.id, ...anomalies.map((n) => n.id), unmapped.id]);
  assert.deepEqual(notices.filter((n) => n.kind === 'auto-registered').map((n) => [n.worldId, n.batchId]), [[WORLD, FIRST_READ], [WORLD, FIRST_READ]]);
  // 通知欄では、成功の 2 件が 1 行のまま
  const rows = groupNotifications(notices.map(cleanNotification));
  assert.deepEqual(rows.filter((row) => row.kind === 'auto-registered').map((row) => row.count), [2]);
  // 新しいタブがこの後に既存のキーへ保存しても（次の読み込みで未設定）、どれも消えない
  t.lay([sheepFarm(P2, 'f3')]);
  await t.run();
  assert.equal(t.auto.notices().filter((n) => n.kind === 'auto-registered').length, 2);
  assert.ok(t.auto.notices().some((n) => n.id === unmapped.id));
});

test('自動登録（成功の通知）: 1 回の読み込みで 21 件以上登録しても全部残し、通知欄の 1 行の件数が登録した件数と合う', async () => {
  const table = decodeBreeding(data);
  // 同じ種族どうしの組（子は同じ種族）を 25 か所の牧場に置く
  const species = pals.map((pal) => pal.id).filter((id) => breedChild(table, id, 'M', id, 'F') === id).slice(0, 25);
  assert.equal(species.length, 25);
  const farms = species.map((id, i) => farm(`g${i}`, [parent(id, 'Male'), parent(id, 'Female')], [id]));
  const t = await setup({ farms, worldId: WORLD });
  await t.run();
  assert.equal(t.creates.length, 25);
  assert.deepEqual(t.toasts, ['配合を自動登録しました（25件）']);
  const notices = t.auto.notices();
  assert.equal(notices.length, 25);
  const rows = groupNotifications(notices.map(cleanNotification));
  assert.deepEqual(rows.map((row) => [row.count, row.more]), [[25, 'ほか 24 件']]);
});

test('自動登録（成功の通知）: 成功は新しい読み込み 20 回分を残し（古い読み込みは丸ごと外す）、全体は 200 件まで。未設定・見送りの通知の数とは別に数える', async () => {
  const t = await setup({ worldId: WORLD });
  // 前の読み込み 22 回分（各 2 件。新しい順）
  const batches = Array.from({ length: 22 }, (_, i) => second(200 - i));
  const old = batches.flatMap((date, i) => [successNotice(`b${i}-1`, date), successNotice(`b${i}-2`, date)]);
  const unmapped = { id: `auto-breed:test:unmapped:${WORLD}:p-2`, date: '2026-10-01T00:00:00.000Z', title: 'プレイヤーの対応が未設定です', body: '' };
  t.storage.set(REGISTERED_KEY, JSON.stringify(old));
  t.storage.set(NOTICES_KEY, JSON.stringify([unmapped]));
  // 読み出しも新しい 20 回分（40 件）まで
  assert.deepEqual(t.auto.notices().map((n) => n.id), [...old.slice(0, 40).map((n) => n.id), unmapped.id]);
  await t.run();
  // 新しい読み込みの 1 件と、前の 19 回分（38 件）
  const saved = JSON.parse(t.storage.get(REGISTERED_KEY));
  assert.deepEqual(saved.map((n) => n.id), [`auto-breed:test:registered:${t.creates[0].record.id}`, ...old.slice(0, 38).map((n) => n.id)]);
  assert.deepEqual(saved.map((n) => n.kind), saved.map(() => 'auto-registered'));
  assert.deepEqual(JSON.parse(t.storage.get(NOTICES_KEY)).map((n) => n.id), [unmapped.id]);
  // 全体は 200 件まで: いちばん新しい読み込みは全部、入り切らない読み込みから先は丸ごと外す
  const big = [
    ...Array.from({ length: 150 }, (_, i) => successNotice(`x${i}`, second(300))),
    ...Array.from({ length: 60 }, (_, i) => successNotice(`y${i}`, second(299))),
    ...Array.from({ length: 3 }, (_, i) => successNotice(`z${i}`, second(298))),
  ];
  t.storage.set(REGISTERED_KEY, JSON.stringify(big));
  assert.deepEqual(t.auto.notices().filter((n) => n.kind === 'auto-registered').map((n) => n.id), big.slice(0, 150).map((n) => n.id));
  t.storage.set(REGISTERED_KEY, JSON.stringify(Array.from({ length: 250 }, (_, i) => successNotice(`w${i}`, second(300)))));
  assert.equal(t.auto.notices().filter((n) => n.kind === 'auto-registered').length, 200);
});

test('自動登録（成功の通知）: 既存のキーに残っている成功の形の通知（未配信の版が書いたもの）は読まず、既存のキーに書き戻さない', async () => {
  const t = await setup({ farms: [sheepFarm(P2)], worldId: WORLD });
  const stale = [successNotice('stale-1', second(10)), { ...successNotice('stale-2', second(9)), kind: undefined }];
  t.storage.set(NOTICES_KEY, JSON.stringify(stale));
  assert.deepEqual(t.auto.notices(), []);
  // 次に既存のキーへ保存するとき（未設定の通知）に、成功の形の通知は落ちる
  await t.run();
  assert.deepEqual(JSON.parse(t.storage.get(NOTICES_KEY)).map((n) => n.title), ['プレイヤーの対応が未設定です']);
});

test('自動登録（成功の通知）: 名前の変更で、成功の通知のキーも新しい名前へ移す', async () => {
  const raw = memoryStorage();
  const t = await setup({ farms: [], storage: safeStorage(raw), worldId: WORLD });
  raw.setItem('t.autoBreeding.registered.test.旧名', JSON.stringify([successNotice('moved', second(5))]));
  assert.equal(moveUserStorage(raw, 't', 'test', '旧名', '自分'), true);
  assert.equal(raw.getItem('t.autoBreeding.registered.test.旧名'), null);
  assert.deepEqual(t.auto.notices().map((n) => [n.id, n.kind, n.batchId]), [['auto-breed:test:registered:moved', 'auto-registered', second(5)]]);
});

test('自動登録（settings）: importNotices は保存した通知と同じ確かめ方で整え（配合表の答えを外す）、同じ id は足さず、成功は別のキーに入れる', async () => {
  const t = await setup({ farms: [] });
  const date = '2026-10-06T00:00:00.000Z';
  const added = t.auto.importNotices([
    { id: 'auto-breed:test:registered:r1', date, kind: 'auto-registered', worldId: 'ABCDEF0123456789ABCDEF0123456789', batchId: date, title: '配合を自動登録しました', body: 'モコロン♀＋オオタチウオ♂ → ヤクモマル（拠点 1）' },
    { id: 'auto-breed:test:anomaly:f1:e1', date, title: '配合の結果が表と違います', body: 'モコロン×ツッパニャン：表はセレムーン、新しいタマゴはフラリーナ' },
    { id: 'こわれた' }, 'こわれた',
  ]);
  assert.equal(added, 2);
  const notices = t.auto.notices();
  assert.deepEqual(notices.map((n) => n.id).sort(), ['auto-breed:test:anomaly:f1:e1', 'auto-breed:test:registered:r1']);
  assert.ok(notices.every((n) => !/表は|セレムーン/.test(`${n.title}${n.body}`)));
  assert.ok(t.storage.get('t.autoBreeding.registered.test.自分'));
  assert.equal(t.auto.importNotices(notices), 0);
});
