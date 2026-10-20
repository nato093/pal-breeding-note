import { test } from 'node:test';
import assert from 'node:assert/strict';
import data from '../../web/data/breeding.js';
import pals from '../../web/data/pals.js';
import { decodeBreeding, breedChild } from '../../web/js/core/breeding.js';
import { createDevelopmentApi } from '../../dev/mock-api.js';
import { createApi, ApiError } from '../../web/js/api.js';
import { createStore, safeStorage } from '../../web/js/store.js';
import { createAutoRegister, safeAutoNotice, AUTO_NOTICE_TITLES } from '../../web/js/auto-register.js';
import { createPlayerMapStore } from '../../web/js/player-map.js';
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

// gas: プレイヤーの対応を GAS（開発用 API）に置く（server の mapping。createPlayerMapStore を渡す）。mapCalls は対応の操作、
// mapControl.fail は対応の操作の失敗（'BAD_ACTION' で古い GAS）・failSet は書き込みだけの失敗、gates は操作ごとに止める Promise（止めた後に
// 失敗を決める）、mapClock は対応のストアの時計。paused は古い系統の守り（常駐。server の T5）
async function setup({ farms = [sheepFarm()], players = [{ uid: P1, name: '自分' }, { uid: P2, name: 'Frank' }], records = [], login = true, storage: givenStorage = null, worldId = 'W1', now = null, gas = false, badAction = false, paused = null } = {}) {
  const development = createDevelopmentApi();
  // サーバの手前で止める・次の登録を断る（手動の登録が送信待ちのまま・取り消される場面を作る）
  let serverGate = null;
  let rejectNextCreate = false;
  const mapCalls = [];
  const mapControl = { fail: badAction ? 'BAD_ACTION' : null, failSet: null, gates: {} };
  const api = createApi({ transport: async (request) => {
    await serverGate;
    if (request.action === 'create' && rejectNextCreate) {
      rejectNextCreate = false;
      return { ok: false, code: 'VALIDATION', errors: [] };
    }
    if (request.action.startsWith('playerMap')) {
      mapCalls.push(request);
      await mapControl.gates[request.action];
      const code = mapControl.fail || (request.action === 'playerMapSet' ? mapControl.failSet : null);
      if (code) return { ok: false, code };
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
  const mapClock = { now: Date.parse('2026-10-06T00:00:00.000Z') };
  const playerMaps = gas ? createPlayerMapStore({
    request: (action, input) => store.call(action, { userId: store.state.userId, ...input }),
    scope: () => (store.state.passcode && store.state.userId && store.state.env ? store.state.env : ''),
    endpoint: () => 'local', storage, namespace: 't', now: () => mapClock.now,
  }) : null;
  const auto = createAutoRegister({
    store, owned, storage, namespace: 't', toast: (message, options) => { toasts.push(message); toastActions.push(options); }, onNotice: () => { noticed++; },
    navigate: (hash) => navigations.push(hash), loadTable: async () => ({ default: data }), ...(now ? { now } : {}), playerMaps,
    ...(paused ? { paused } : {}),
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
    store, api, owned, auto, creates, toasts, toastActions, navigations, run, lay, storage, playerMaps, mapCalls, mapControl, mapClock, development,
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

test('自動登録（owned-gas）: 記録の新旧は Level.sav の中の保存時刻で比べる（同期で更新日時だけが新しい同じセーブでは書き直さない）', async () => {
  const ghosts = [parent('GhostDragon_Fire', 'Male'), parent('BOSS_GhostDragon_Fire', 'Female')];
  const t = await setup({ farms: [], login: true });
  const tab = (importedAt, updatedAt, savedAtTicks) => ({
    state: { role: 'host', uploadReady: true, busy: false, linkedWorldId: 'W1',
      local: { importedAt, world: { id: 'W1', updatedAt }, snapshot: { world: { savedAtTicks }, players: [], breedFarms: [farm('f1', ghosts, [])] } } },
  });
  const make = (owned) => createAutoRegister({ store: t.store, owned, storage: t.storage, namespace: 't3', loadTable: async () => ({ default: data }) });
  const saved = () => JSON.parse(t.storage.get('t3.autoBreeding.farms.test.W1'));
  const first = make(tab('a1', '2026-10-06T10:00:00.000Z', '638650000000000010'));
  first.evaluate(); await first.idle();
  assert.deepEqual([saved().importedAt, saved().saveStamp], ['a1', '638650000000000010']);
  // 同じセーブ（同期で更新日時だけが新しい）: 書き直さない
  const synced = make(tab('b1', '2026-10-06T10:05:00.000Z', '638650000000000010'));
  synced.evaluate(); await synced.idle();
  assert.equal(saved().importedAt, 'a1');
  // 中の時刻が新しいセーブ（更新日時は古くても）: 読む
  const newer = make(tab('c1', '2026-10-06T09:00:00.000Z', '638650000000000020'));
  newer.evaluate(); await newer.idle();
  assert.deepEqual([saved().importedAt, saved().saveStamp], ['c1', '638650000000000020']);
  // 中の時刻がない（前の版の記録・読めない）: 今までどおり更新日時で比べる
  const legacy = make(tab('d1', '2026-10-06T09:30:00.000Z', ''));
  legacy.evaluate(); await legacy.idle();
  assert.equal(saved().importedAt, 'd1');
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
  assert.deepEqual(added, { added: 2, skipped: 0 });
  const notices = t.auto.notices();
  assert.deepEqual(notices.map((n) => n.id).sort(), ['auto-breed:test:anomaly:f1:e1', 'auto-breed:test:registered:r1']);
  assert.ok(notices.every((n) => !/表は|セレムーン/.test(`${n.title}${n.body}`)));
  assert.ok(t.storage.get('t.autoBreeding.registered.test.自分'));
  assert.deepEqual(t.auto.importNotices(notices), { added: 0, skipped: 0 });
});

test('自動登録（settings）: importNotices は今の通知を押し出さず、空きに入る分だけ足し、入らなかった数を返す', async () => {
  const t = await setup({ farms: [] });
  const at = (minute) => new Date(Date.UTC(2026, 9, 6, 0, minute)).toISOString();
  const notice = (id, minute) => ({ id: `auto-breed:test:anomaly:${id}`, date: at(minute), title: '配合の結果が表と違います', body: 'モコロン×ツッパニャン' });
  // 今の通知が 49 件（上限 50 件まで残り 1 件）
  const current = Array.from({ length: 49 }, (_, index) => notice(`now${index}`, 10 + index));
  t.storage.set('t.autoBreeding.notices.test.自分', JSON.stringify(current));
  // 取り込む 3 件は、今のどの通知よりも新しい
  const result = t.auto.importNotices([notice('in1', 100), notice('in2', 101), notice('in3', 102)]);
  assert.deepEqual(result, { added: 1, skipped: 2 });
  const ids = t.auto.notices().map((n) => n.id);
  assert.equal(ids.length, 50);
  // 今の 49 件は全部残り、取り込んだうち新しい 1 件だけが入る
  assert.ok(current.every((n) => ids.includes(n.id)));
  assert.ok(ids.includes('auto-breed:test:anomaly:in3'));
  assert.deepEqual(t.auto.importNotices([notice('in4', 1)]), { added: 0, skipped: 1 });
});

// ---- 共有の結果で候補を決める（sync-fixes の host-rotation） ----
// 読んだセーブの証拠は「配合のキー＋セーブの保存時刻」の候補として保留し、そのセーブの共有の結果（owned.js の state.upload）で決める

const BASE = Date.parse('2026-10-06T01:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
// seconds 秒のセーブの中の保存時刻（生のティック）と、それを読んだ日時
const ticks = (seconds) => String(638650000000000000n + BigInt(seconds) * 10_000_000n);
const readAt = (seconds) => new Date(BASE + seconds * 1000).toISOString();
// 時計を動かせる setup（保留の候補の期限は読んだ日時から数えるので、読んだ日時に近い時刻にしておく）
async function rotation(options = {}) {
  const clock = { now: BASE + 10 * 60 * 1000 };
  const t = await setup({ ...options, now: () => clock.now });
  return Object.assign(t, { clock });
}
// 中の保存時刻つきのセーブ（seconds 秒）を読んだ
function readSave(t, seconds, farms) {
  const { local } = t.owned.state;
  t.owned.state.local = {
    ...local, importedAt: readAt(seconds), world: { ...local.world, updatedAt: readAt(seconds) },
    snapshot: { ...local.snapshot, world: { savedAtTicks: ticks(seconds) }, breedFarms: farms },
  };
}
// 共有の結果（owned.js の state.upload）。stamp・savedAt は送ったセーブの中の保存時刻と更新日時、scope・userId は送ったときの環境と ID、
// uploadedBy は今公開されている共有を送った人
function uploadOf(status, seconds, { result = '', worldId = 'W1', uploadedBy = '', stamp = ticks(seconds), savedAt = readAt(seconds), scope = 'test', userId = '自分' } = {}) {
  const published = uploadedBy ? { saveStamp: stamp, uploadedBy, uploadedAt: '' } : null;
  return { status, at: '', error: '', worldId, result, signature: '', stamp, savedAt, scope, userId, published };
}
function answer(t, status, seconds, options = {}) {
  t.owned.state.upload = uploadOf(status, seconds, { worldId: t.owned.state.local.world.id, ...options });
}
// このページがホスト中（推定）。owned.js の state.play（core/playing.js の trackPlay の形）で、直近に 30 秒ごとの保存を 2 回見た
function hosting(t, worldId = 'W1') {
  const at = t.clock.now;
  t.owned.state.play = { worldId, role: 'host', value: 60_000, changes: [{ at: at - 30_000, gap: 30_000 }, { at, gap: 30_000 }] };
}
// 保存した候補の [状態, セーブの保存時刻, 証拠の牧場]
const unitsOf = (t, worldId = 'W1') => (JSON.parse(t.storage.get(`t.autoBreeding.farms.test.${worldId}`)).pending ?? [])
  .map((unit) => [unit.state ?? '', unit.stamp ?? '', unit.evidence.map((e) => e.farmId).join(',')]);
const SHEEP = 'SheepBall(F)×SwordCutlassfish(M)>GuardianDog:自分';

test('自動登録（host-rotation）: 読んだセーブの候補は共有の結果まで保留し、自分の共有（done）で登録する。送っている間・送れなかった・結果なしでは保留のまま', async () => {
  const t = await rotation();
  readSave(t, 0, [sheepFarm()]);
  await t.run();
  assert.equal(t.creates.length, 0);
  assert.deepEqual(unitsOf(t), [['hold', ticks(0), 'f1']]);
  for (const status of ['sending', 'error', '']) {
    answer(t, status, 0);
    await t.run();
  }
  assert.equal(t.creates.length, 0);
  assert.deepEqual(unitsOf(t), [['hold', ticks(0), 'f1']]);
  answer(t, 'done', 0, { result: 'new' });
  await t.run();
  assert.deepEqual(registered(t.store), [SHEEP]);
  assert.deepEqual(t.toasts, ['配合を自動登録しました（1件）']);
  // 登録した配合の候補は外す。同じ結果がまた届いても何もしない
  assert.deepEqual(unitsOf(t), []);
  await t.run();
  assert.equal(t.creates.length, 1);
});

test('自動登録（host-rotation）: 自分の前の送信が届いていた unchanged（done）は登録し、他人の unchanged・same（same）ではそのセーブの候補を捨てる', async () => {
  const mine = await rotation();
  readSave(mine, 0, [sheepFarm()]);
  await mine.run();
  answer(mine, 'done', 0, { result: 'unchanged' });
  await mine.run();
  assert.deepEqual(registered(mine.store), [SHEEP]);
  for (const result of ['unchanged', 'same']) {
    const other = await rotation();
    readSave(other, 0, [sheepFarm()]);
    await other.run();
    answer(other, 'same', 0, { result, uploadedBy: '仲間' });
    await other.run();
    assert.equal(other.creates.length, 0, result);
    assert.deepEqual(unitsOf(other), [], result);
    // 後で自分の新しいセーブが載っても、捨てた候補は登録しない（そのセーブは別の PC の担当）
    readSave(other, 30, [sheepFarm()]);
    await other.run();
    answer(other, 'done', 30, { result: 'newer' });
    await other.run();
    assert.equal(other.creates.length, 0, result);
  }
});

test('自動登録（host-rotation）: 同じセーブを共有済み（same）でも、公開しているのが自分の ID（同じ PC の別のタブ）なら、自分の共有として登録する', async () => {
  const t = await rotation();
  readSave(t, 0, [sheepFarm()]);
  await t.run();
  answer(t, 'same', 0, { result: 'same', uploadedBy: '自分' });
  await t.run();
  assert.deepEqual(registered(t.store), [SHEEP]);
});

test('自動登録（host-rotation）: 他人の same は stamp が同じ候補だけを捨て、それより前のセーブの候補は保留のまま', async () => {
  const t = await rotation({ farms: [sheepFarm(), dogFarm()] });
  readSave(t, 0, [sheepFarm(), emptied([dogFarm()])[0]]);
  await t.run();
  readSave(t, 30, [sheepFarm(), dogFarm()]);
  await t.run();
  assert.deepEqual(unitsOf(t), [['hold', ticks(0), 'f1'], ['hold', ticks(30), 'f2']]);
  answer(t, 'same', 30, { result: 'same' });
  await t.run();
  assert.deepEqual(unitsOf(t), [['hold', ticks(0), 'f1']]);
  assert.equal(t.creates.length, 0);
});

test('自動登録（host-rotation）: 別の人が新しいセーブを共有済み（stale）なら、ホスト中（推定）の間に読んだ候補だけを登録し、ほかは保留のまま', async () => {
  const playing = await rotation();
  hosting(playing);
  readSave(playing, 0, [sheepFarm()]);
  await playing.run();
  answer(playing, 'stale', 0, { result: 'stale' });
  await playing.run();
  assert.deepEqual(registered(playing.store), [SHEEP]);
  const idle = await rotation();
  readSave(idle, 0, [sheepFarm()]);
  await idle.run();
  answer(idle, 'stale', 0, { result: 'stale' });
  await idle.run();
  assert.equal(idle.creates.length, 0);
  assert.deepEqual(unitsOf(idle), [['hold', ticks(0), 'f1']]);
});

test('自動登録（host-rotation）: S1 の応答を失った後に S2 を読み、S2 が自分の共有として載れば、S1 にしかない証拠も登録する', async () => {
  const t = await rotation();
  readSave(t, 0, [sheepFarm()]);
  await t.run();
  answer(t, 'error', 0);
  await t.run();
  // S2 にはタマゴの証拠がない（拾われた後）
  readSave(t, 30, [emptied([sheepFarm()])[0]]);
  await t.run();
  assert.deepEqual(unitsOf(t), [['hold', ticks(0), 'f1']]);
  // 古い GAS（result なし・stored）も done
  answer(t, 'done', 30, { result: '' });
  await t.run();
  assert.deepEqual(registered(t.store), [SHEEP]);
});

test('自動登録（host-rotation）: S1 の応答を失った後に別の人が S2 を載せた（S1 の stale）なら、S1 の候補は捨てずに残す（ホスト中の推定が立つ前に読んだ S1 も）', async () => {
  const t = await rotation();
  readSave(t, 0, [sheepFarm()]);
  await t.run();
  answer(t, 'error', 0);
  await t.run();
  // 後からホスト中の推定が立っても、S1 を読んだときは立っていなかった
  hosting(t);
  answer(t, 'stale', 0, { result: 'stale' });
  await t.run();
  assert.equal(t.creates.length, 0);
  assert.deepEqual(unitsOf(t), [['hold', ticks(0), 'f1']]);
  // その後で自分の共有が載れば登録する
  readSave(t, 60, [sheepFarm()]);
  await t.run();
  answer(t, 'done', 60, { result: 'newer' });
  await t.run();
  assert.deepEqual(registered(t.store), [SHEEP]);
});

test('自動登録（host-rotation）: S1 の送信中に S3 を読んだら、S1 の結果（stale）で決めるのは S1 以前の候補だけ（S3 の候補は決まらない）', async () => {
  const t = await rotation({ farms: [sheepFarm(), dogFarm()] });
  hosting(t);
  readSave(t, 0, [sheepFarm(), emptied([dogFarm()])[0]]);
  await t.run();
  answer(t, 'sending', 0);
  await t.run();
  readSave(t, 60, [sheepFarm(), dogFarm()]);
  await t.run();
  answer(t, 'stale', 0, { result: 'stale' });
  await t.run();
  assert.deepEqual(registered(t.store), [SHEEP]);
  assert.deepEqual(unitsOf(t), [['hold', ticks(60), 'f2']]);
});

test('自動登録（host-rotation）: 同じ配合の証拠が S1 と S3 にあれば、S1 の結果で決まるのは S1 の証拠だけ（登録者も S1 の証拠で決める）', async () => {
  // 同じ配合（モコロン＋オオタチウオ）の牧場が 2 つ。f1 は Frank（対応が未設定）、f2 は自分が親を預けた
  const t = await rotation({ farms: [sheepFarm(P2, 'f1'), sheepFarm(P1, 'f2')] });
  readSave(t, 0, [sheepFarm(P2, 'f1'), emptied([sheepFarm(P1, 'f2')])[0]]);
  await t.run();
  readSave(t, 60, [sheepFarm(P2, 'f1'), sheepFarm(P1, 'f2')]);
  await t.run();
  answer(t, 'done', 0, { result: 'new' });
  await t.run();
  // S1 の証拠（Frank の牧場）だけで判定するので、登録者が決まらずに待つ（S3 の証拠を混ぜると、預けた人が違うので自分で登録してしまう）
  assert.equal(t.creates.length, 0);
  assert.deepEqual(unitsOf(t), [['ok', ticks(0), 'f1'], ['hold', ticks(60), 'f2']]);
  assert.deepEqual(t.auto.notices().map((n) => n.title), ['プレイヤーの対応が未設定です']);
  answer(t, 'done', 60, { result: 'newer' });
  await t.run();
  assert.deepEqual(registered(t.store), [SHEEP]);
  assert.deepEqual(unitsOf(t), []);
});

test('自動登録（host-rotation）: 保留のまま 7 日たった候補は捨てる（7 日ちょうどまでは決められる）', async () => {
  const kept = await rotation();
  readSave(kept, 0, [sheepFarm()]);
  await kept.run();
  kept.clock.now = BASE + 7 * DAY;
  answer(kept, 'done', 0, { result: 'new' });
  await kept.run();
  assert.equal(kept.creates.length, 1);
  const expired = await rotation();
  readSave(expired, 0, [sheepFarm()]);
  await expired.run();
  expired.clock.now = BASE + 7 * DAY + 1;
  answer(expired, 'done', 0, { result: 'new' });
  await expired.run();
  assert.equal(expired.creates.length, 0);
  assert.deepEqual(unitsOf(expired), []);
  // 新しいセーブを読むときにも捨てる
  const absorbed = await rotation({ farms: [sheepFarm(), dogFarm()] });
  readSave(absorbed, 0, [sheepFarm(), emptied([dogFarm()])[0]]);
  await absorbed.run();
  absorbed.clock.now = BASE + 8 * DAY;
  readSave(absorbed, 8 * 24 * 60 * 60, [sheepFarm(), dogFarm()]);
  await absorbed.run();
  assert.deepEqual(unitsOf(absorbed), [['hold', ticks(8 * 24 * 60 * 60), 'f2']]);
});

test('自動登録（host-rotation）: 登録してよいになった候補は、後の他人の共有で取り消さない。プレイヤーの対応が未設定なら待ち、保留の間は登録待ちに数えない', async () => {
  const t = await rotation({ farms: [sheepFarm(P2)] });
  readSave(t, 0, [sheepFarm(P2)]);
  await t.run();
  // 保留は共有の結果を待っているだけなので、登録待ちに数えない
  assert.deepEqual(t.auto.pendingSummary(), { unmapped: [], conflict: [] });
  let changes = 0;
  t.auto.subscribe(() => { changes++; });
  answer(t, 'done', 0, { result: 'new' });
  await t.run();
  assert.equal(t.creates.length, 0);
  assert.ok(changes > 0);
  assert.deepEqual(t.auto.pendingSummary().unmapped.map((item) => item.uid), [P2]);
  // 別の人が同じセーブを共有したと後で分かっても、取り消さない
  answer(t, 'same', 0, { result: 'same' });
  await t.run();
  assert.deepEqual(unitsOf(t), [['ok', ticks(0), 'f1']]);
  t.auto.setMapping(P2, '仲間');
  await t.auto.idle();
  assert.deepEqual(registered(t.store), ['SheepBall(F)×SwordCutlassfish(M)>GuardianDog:仲間']);
});

test('自動登録（host-rotation）: 結果は読み込み中（判定できないとき）に届いても記録し、後で読んだ候補・読み込み直しの後のページにも当てる', async () => {
  const t = await rotation();
  // 読み込みの途中（busy）に、そのセーブの結果が届いた（応答はキャッシュの保存の前に知らせる）
  readSave(t, 0, [sheepFarm()]);
  Object.assign(t.owned.state, { busy: true });
  answer(t, 'done', 0, { result: 'new' });
  await t.run();
  assert.equal(t.creates.length, 0);
  // 新しいセーブを読んで結果が消えた後に、候補を集める
  t.owned.state.upload = { status: '', at: '', error: '', worldId: '', result: '', signature: '', stamp: '', published: null };
  Object.assign(t.owned.state, { busy: false });
  await t.run();
  assert.deepEqual(registered(t.store), [SHEEP]);

  // 読み込み直し: 保留の候補を残したページを閉じ、開き直したページに結果が届く
  const u = await rotation({ farms: [sheepFarm(), dogFarm()] });
  readSave(u, 0, [sheepFarm(), emptied([dogFarm()])[0]]);
  await u.run();
  assert.deepEqual(unitsOf(u), [['hold', ticks(0), 'f1']]);
  const reopened = createAutoRegister({ store: u.store, owned: u.owned, storage: u.storage, namespace: 't', loadTable: async () => ({ default: data }), now: () => u.clock.now });
  answer(u, 'done', 0, { result: 'unchanged' });
  reopened.evaluate();
  await reopened.idle();
  assert.deepEqual(registered(u.store), [SHEEP]);
});

test('自動登録（host-rotation）: 前の版の候補（stamp・状態がない）と識別のないセーブ（stamp が空）の候補は、今までどおり登録する', async () => {
  const t = await setup({ farms: [] });
  const key = 't.autoBreeding.farms.test.W1';
  const saved = JSON.parse(t.storage.get(key));
  const old = {
    key: 'GuardianDog|GuardianDog>GuardianDog',
    record: { parent1Id: 'GuardianDog', parent1Gender: 'M', parent2Id: 'GuardianDog', parent2Gender: 'F', childId: 'GuardianDog' },
    evidence: [{ farmId: 'f2', eggLocalId: 'f2-0', depositorUids: [P1, P1] }],
  };
  t.storage.set(key, JSON.stringify({ ...saved, rev: saved.rev + 1, pending: [old] }));
  await t.run();
  assert.deepEqual(registered(t.store), ['GuardianDog(M)×GuardianDog(F)>GuardianDog:自分']);
  // 識別のないセーブ（中の保存時刻が読めない）の候補は、登録してよいとして記録する
  const plain = await setup({ storage: safeStorage(memoryStorage()) });
  const release = plain.hold();
  plain.auto.evaluate();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(unitsOf(plain), [['ok', '', 'f1']]);
  release();
  await plain.auto.idle();
  assert.deepEqual(registered(plain.store), [SHEEP]);
});

test('自動登録（host-rotation）: ファイルの更新日時だけが新しい同じセーブ（同期で書き換わった）では、候補を増やさない', async () => {
  const t = await rotation({ farms: [sheepFarm(), dogFarm()] });
  readSave(t, 0, [sheepFarm(), emptied([dogFarm()])[0]]);
  await t.run();
  // 中の保存時刻は同じで、更新日時・読んだ日時だけが新しい（中身が違って見えても、同じセーブとして扱う）
  const { local } = t.owned.state;
  t.owned.state.local = { ...local, importedAt: readAt(300), world: { ...local.world, updatedAt: readAt(300) }, snapshot: { ...local.snapshot, breedFarms: [sheepFarm(), dogFarm()] } };
  await t.run();
  assert.deepEqual(unitsOf(t), [['hold', ticks(0), 'f1']]);
});

test('自動登録（host-rotation）: 結果は送ったワールドの記録に残し、同じ種類・同じ stamp は 1 回だけ足す（直近 20 件まで）', async () => {
  const t = await rotation();
  readSave(t, 0, [sheepFarm()]);
  await t.run();
  const verdicts = () => JSON.parse(t.storage.get('t.autoBreeding.farms.test.W1')).verdicts;
  answer(t, 'sending', 0);
  await t.run();
  assert.deepEqual(verdicts(), []);
  answer(t, 'stale', 0, { result: 'stale' });
  await t.run();
  await t.run();
  assert.deepEqual(verdicts(), [{ kind: 'stale', stamp: ticks(0) }]);
  // 別のワールドの結果は、そのワールドの記録に残す（今のワールドの候補は決めない）
  answer(t, 'done', 0, { result: 'new', worldId: 'W2' });
  await t.run();
  assert.deepEqual(JSON.parse(t.storage.get('t.autoBreeding.farms.test.W2')).verdicts, [{ kind: 'mine', stamp: ticks(0) }]);
  assert.equal(t.creates.length, 0);
  for (let i = 1; i <= 25; i++) {
    answer(t, 'stale', i * 30, { result: 'stale' });
    t.auto.evaluate();
  }
  await t.auto.idle();
  assert.equal(verdicts().length, 20);
  assert.deepEqual(verdicts().at(-1), { kind: 'stale', stamp: ticks(25 * 30) });
});

// ---- Codex のレビューの直し（host-rotation） ----

// 次の読み込みの途中（牧場を比べた後、記録を書く前。absorb がホスト中の推定〔owned.state.play〕を読むところ）で、fn を 1 回だけ動かす
function interrupt(t, fn) {
  let play = t.owned.state.play;
  let pending = fn;
  Object.defineProperty(t.owned.state, 'play', {
    configurable: true, enumerable: true,
    get() {
      if (pending) {
        const run = pending;
        pending = null;
        run();
      }
      return play;
    },
    set(value) { play = value; },
  });
}
// 同じ保存先を使う別のタブ（ホストとして判定しない。共有の結果の記録だけをする）
function otherTab(t) {
  const owned = { state: { role: '', linkedWorldId: '', upload: null } };
  const auto = createAutoRegister({ store: t.store, owned, storage: t.storage, namespace: 't', loadTable: async () => ({ default: data }), now: () => t.clock.now });
  return { owned, auto };
}
const verdictsOf = (t, env = 'test', worldId = 'W1') => JSON.parse(t.storage.get(`t.autoBreeding.farms.${env}.${worldId}`) ?? '{}').verdicts ?? [];

test('自動登録（host-rotation・Codex のレビュー）: 別のタブが読み込みの途中に same を記録しても、書き戻しで判定を消さず、捨てた候補を戻さない', async () => {
  const t = await rotation();
  readSave(t, 0, [sheepFarm()]);
  await t.run();
  answer(t, 'error', 0);
  await t.run();
  const tab = otherTab(t);
  // このタブが次のセーブ（S2）を読む途中で、別のタブが「S1 は別の人が共有済み」と記録して S1 の候補を捨てる
  interrupt(t, () => {
    tab.owned.state.upload = uploadOf('same', 0, { result: 'same', uploadedBy: '仲間' });
    tab.auto.evaluate();
  });
  readSave(t, 30, [sheepFarm()]);
  await t.run();
  assert.deepEqual(verdictsOf(t), [{ kind: 'same', stamp: ticks(0) }]);
  assert.deepEqual(unitsOf(t), []);
  // 後で自分の S2 が載っても、捨てた S1 の候補は登録しない
  answer(t, 'done', 30, { result: 'newer' });
  await t.run();
  assert.equal(t.creates.length, 0);
});

test('自動登録（host-rotation・Codex のレビュー）: 別のタブが読み込みの途中に mine を記録しても、書き戻しで保留に戻さず登録する', async () => {
  const t = await rotation();
  readSave(t, 0, [sheepFarm()]);
  await t.run();
  const tab = otherTab(t);
  interrupt(t, () => {
    tab.owned.state.upload = uploadOf('done', 0, { result: 'new' });
    tab.auto.evaluate();
  });
  readSave(t, 30, [sheepFarm()]);
  await t.run();
  assert.deepEqual(verdictsOf(t), [{ kind: 'mine', stamp: ticks(0) }]);
  assert.deepEqual(registered(t.store), [SHEEP]);
});

test('自動登録（host-rotation・Codex のレビュー）: 識別のない（中の保存時刻が読めない）次のセーブが自分の共有として載れば、その更新日時以前の保留の候補を登録する', async () => {
  const t = await rotation();
  readSave(t, 0, [sheepFarm()]);
  await t.run();
  answer(t, 'error', 0);
  await t.run();
  // 次のセーブは中の保存時刻が読めない
  const { local } = t.owned.state;
  t.owned.state.local = { ...local, importedAt: readAt(30), world: { ...local.world, updatedAt: readAt(30) }, snapshot: { ...local.snapshot, world: {} } };
  await t.run();
  // 更新日時が S1 より前の判定・same・stale では決めない（更新日時は同期で書き換わるので、同じセーブの判定には使わない）
  for (const [status, savedAt] of [['done', readAt(-30)], ['same', readAt(30)], ['stale', readAt(30)]]) {
    answer(t, status, 30, { stamp: '', savedAt, result: status === 'done' ? 'new' : status });
    await t.run();
  }
  assert.equal(t.creates.length, 0);
  assert.deepEqual(verdictsOf(t), [{ kind: 'mine', stamp: '', savedAt: readAt(-30) }]);
  answer(t, 'done', 30, { stamp: '', result: 'new' });
  await t.run();
  assert.deepEqual(registered(t.store), [SHEEP]);
  assert.deepEqual(verdictsOf(t).at(-1), { kind: 'mine', stamp: '', savedAt: readAt(30) });
});

test('自動登録（host-rotation・Codex のレビュー）: 環境を切り替えても、前の環境で受けた共有の結果を新しい環境の判定として記録しない', async () => {
  const t = await rotation();
  readSave(t, 0, [sheepFarm()]);
  await t.run();
  answer(t, 'done', 0, { result: 'new' });
  await t.run();
  assert.deepEqual(verdictsOf(t), [{ kind: 'mine', stamp: ticks(0) }]);
  t.store.state.env = 'prod';
  t.auto.evaluate();
  await t.auto.idle();
  assert.deepEqual(verdictsOf(t, 'prod'), []);
});

test('自動登録（host-rotation・Codex のレビュー）: 自分の ID の same は、送ったときの ID と比べる（その後に ID が替わっていても）', async () => {
  const t = await rotation();
  readSave(t, 0, [sheepFarm()]);
  await t.run();
  answer(t, 'same', 0, { result: 'same', uploadedBy: '前の名前', userId: '前の名前' });
  await t.run();
  assert.deepEqual(registered(t.store), [SHEEP]);
});

// ---------------------------------------------------------------------------
// server の mapping: プレイヤーの対応を GAS に置く（鍵は 'i:<InstanceId>'・'u:<uid>'。鍵から UID への解決は mappingFor の 1 か所。
// docs/server/README.md の「テーマ間の取り決め」）。ID・名前はダミー
// ---------------------------------------------------------------------------
const MAP_WORLD = 'ABCDEF0123456789ABCDEF0123456789';
// 協力プレイのホストの UID（H）・サーバーでの作成者の UID（U）・仲間の UID・ワールドにいない人の UID
const H = '00000000-0000-0000-0000-000000000001';
const U = '11111111-2222-3333-4444-555555555555';
const F = '22222222-3333-4444-5555-666666666666';
const GONE = '33333333-4444-5555-6666-777777777777';
// キャラクターの InstanceId（協力プレイとサーバーを往復しても変わらない）
const X = 'abcdef01-0000-0000-0000-000000000001';
const Y = 'abcdef02-0000-0000-0000-000000000002';
const coopPlayers = [{ uid: H, name: 'ホストの名前', instanceId: X }, { uid: F, name: 'Frank', instanceId: Y }];
const serverPlayers = [{ uid: U, name: 'ホストの名前', instanceId: X }, { uid: F, name: 'Frank', instanceId: Y }];
const LEGACY_KEY = `t.autoBreeding.players.test.${MAP_WORLD}`;
const MIGRATED_KEY = `t.autoBreeding.playersMigrated.test.${MAP_WORLD}`;
const pairFarm = (id, depositor) => farm(id, [parent('GuardianDog', 'Male', depositor), parent('GuardianDog', 'Female', depositor)], ['GuardianDog']);
// ほかの PC（仲間）が GAS に書いた対応（この PC の送信には数えない）
const otherPc = (t, entries) => t.development({ action: 'playerMapSet', passcode: PASS, userId: '仲間', worldId: MAP_WORLD, entries });
// 新しく読んだセーブ（プレイヤーと牧場を入れ替える）
let mapReads = 0;
const readWorld = (t, players, breedFarms) => {
  t.owned.state.local = { ...t.owned.state.local, importedAt: `2026-10-07T00:00:${String(mapReads++ % 60).padStart(2, '0')}.${String(mapReads).padStart(3, '0')}Z`, snapshot: { players, breedFarms } };
};
const registrants = (store) => store.state.records.map((record) => record.registrant);
const setCalls = (t) => t.mapCalls.filter((call) => call.action === 'playerMapSet');
// ゲームの保存が続けて見えている記録（core/playing.js の isPlaying が真。この PC がホストとして遊んでいる）
const playingRecord = (worldId, at = Date.now()) => ({ worldId, role: 'host', value: 90_000, changes: [{ at: at - 30_000, gap: 30_000 }, { at, gap: 30_000 }] });
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('自動登録（server の mapping）: 協力プレイ ↔ サーバーで UID が H ⇔ U と入れ替わっても、i:<InstanceId> の対応で同じ登録者になる', async () => {
  const t = await setup({ gas: true, worldId: MAP_WORLD, players: coopPlayers, farms: [sheepFarm(H)] });
  assert.equal(t.auto.mappingMode(MAP_WORLD), 'gas');
  // 協力プレイのホスト（H）を「仲間」に。鍵は H のキャラクターの i:（u:H は以前のホストの鍵なので使わない）
  await t.auto.setMapping(H, '仲間', MAP_WORLD);
  assert.deepEqual(t.playerMaps.entries('test', MAP_WORLD), { [`i:${X}`]: '仲間' });
  assert.equal(setCalls(t).at(-1).entries[0].playerName, 'ホストの名前');
  await t.auto.idle();
  assert.deepEqual(registered(t.store), ['SheepBall(F)×SwordCutlassfish(M)>GuardianDog:仲間']);
  assert.deepEqual(t.auto.mapping(MAP_WORLD), { [H]: '仲間' });
  // サーバーに変換した（H は U に。キャラクターは同じ）。U が預けた牧場のタマゴも同じ人の登録
  readWorld(t, serverPlayers, emptied([pairFarm('f3', U)]));
  await t.run();
  readWorld(t, serverPlayers, [pairFarm('f3', U)]);
  await t.run();
  assert.deepEqual(t.auto.mapping(MAP_WORLD), { [U]: '仲間' });
  assert.deepEqual(registrants(t.store), ['仲間', '仲間']);
  // 協力プレイに戻しても同じ
  readWorld(t, coopPlayers, []);
  assert.deepEqual(t.auto.mapping(MAP_WORLD), { [H]: '仲間' });
});

test('自動登録（server の mapping）: u:H（以前のホスト）は H がプレイヤーにいないときだけ効く。協力プレイのホストは同じ名前の規則のまま', async () => {
  const t = await setup({ gas: true, worldId: MAP_WORLD, players: [{ uid: H, name: '自分', instanceId: X }], farms: [sheepFarm(H)] });
  // サーバーのワールドで以前のホストを「仲間」にした。協力プレイのホストのキャラクターの鍵（i:X）はない
  await otherPc(t, [{ key: `u:${H}`, userId: '仲間' }]);
  t.mapClock.now += 61_000;
  await t.run();
  assert.deepEqual(t.auto.mapping(MAP_WORLD), {});
  assert.deepEqual(registered(t.store), ['SheepBall(F)×SwordCutlassfish(M)>GuardianDog:自分']);
  // サーバーのワールド（H はプレイヤーにいない）: H が預けた牧場は以前のホストの対応で登録する
  readWorld(t, [{ uid: U, name: '自分', instanceId: X }], emptied([pairFarm('f3', H)]));
  await t.run();
  readWorld(t, [{ uid: U, name: '自分', instanceId: X }], [pairFarm('f3', H)]);
  await t.run();
  assert.deepEqual(t.auto.mapping(MAP_WORLD), { [H]: '仲間' });
  assert.deepEqual(registrants(t.store).sort(), ['仲間', '自分']);
});

test('自動登録（server の mapping）: 値が空の鍵（外した印）は同じ名前の規則に戻り、u: にも落ちない。プレイヤーにいない u: の鍵も uid で返す', async () => {
  const t = await setup({ gas: true, worldId: MAP_WORLD, players: [{ uid: F, name: '自分', instanceId: Y }], farms: [] });
  await otherPc(t, [{ key: `i:${Y}`, userId: '' }, { key: `u:${F}`, userId: '仲間' }, { key: `u:${GONE}`, userId: '仲間' }, { key: `u:${H}`, userId: '' }]);
  t.mapClock.now += 61_000;
  await t.auto.refreshMapping(MAP_WORLD, 0);
  assert.deepEqual(t.auto.mapping(MAP_WORLD), { [GONE]: '仲間' });
  // InstanceId のないプレイヤー（古い共有）は u: で引く
  readWorld(t, [{ uid: F, name: '自分' }], []);
  assert.deepEqual(t.auto.mapping(MAP_WORLD), { [F]: '仲間', [GONE]: '仲間' });
});

test('自動登録（server の mapping）: 前の版の対応を一度だけ onlyMissing で上げる。H は手元のホスト（遊んでいる）のスナップショットの i:、ノートにない ID は捨て、GAS にある鍵は上書きしない', async () => {
  const t = await setup({ gas: true, worldId: MAP_WORLD, players: coopPlayers, farms: [sheepFarm(F)] });
  // ほかの PC で、Frank のキャラクターを先に「自分」にしてある
  await otherPc(t, [{ key: `i:${Y}`, userId: '自分' }]);
  const legacy = { [H]: '仲間', [F]: '仲間', [GONE]: '仲間', ghost: 'ノートにない' };
  t.storage.set(LEGACY_KEY, JSON.stringify(legacy));
  t.owned.state.play = playingRecord(MAP_WORLD);
  t.mapClock.now += 61_000;
  await t.run();
  const [sent] = setCalls(t);
  assert.equal(setCalls(t).length, 1);
  assert.equal(sent.onlyMissing, true);
  assert.deepEqual(sent.entries.map((entry) => [entry.key, entry.userId]), [[`i:${X}`, '仲間'], [`i:${Y}`, '仲間'], [`u:${GONE}`, '仲間']]);
  assert.deepEqual(t.playerMaps.entries('test', MAP_WORLD), { [`i:${Y}`]: '自分', [`i:${X}`]: '仲間', [`u:${GONE}`]: '仲間' });
  // GAS にあった対応（自分）で登録する
  assert.deepEqual(registrants(t.store), ['自分']);
  // 印を書き、次からは送らない。前の版の対応は消さない（古いタブと巻き戻しのため）
  assert.equal(t.storage.get(MIGRATED_KEY), JSON.stringify(legacy));
  assert.deepEqual(JSON.parse(t.storage.get(LEGACY_KEY)), legacy);
  t.mapClock.now += 61_000;
  t.lay();
  await t.run();
  await t.auto.refreshMapping(MAP_WORLD, 0);
  assert.equal(setCalls(t).length, 1);
  // 前の版の対応が変わったら（この端末のデータの読み込みなど）、もう一度 onlyMissing で上げる
  t.auto.setLegacyMapping(GONE, '自分', MAP_WORLD);
  await t.auto.idle();
  assert.equal(setCalls(t).length, 2);
  assert.equal(t.playerMaps.entries('test', MAP_WORLD)[`u:${GONE}`], '仲間');
});

test('自動登録（server の mapping）: H の移行は、この PC がホストとして遊んでいる手元のデータのときだけ。表示しているのが共有なら H は上げない', async () => {
  const t = await setup({ gas: true, worldId: MAP_WORLD, players: coopPlayers, farms: [] });
  // 参加者の画面（共有を表示している）で読み直した
  Object.assign(t.owned.state, { role: 'guest', meta: { worldId: MAP_WORLD, source: 'shared' }, owned: { players: coopPlayers } });
  t.storage.set(LEGACY_KEY, JSON.stringify({ [H]: '仲間', [F]: '仲間' }));
  t.mapClock.now += 61_000;
  await t.auto.refreshMapping(MAP_WORLD, 0);
  assert.deepEqual(setCalls(t).map((call) => call.entries.map((entry) => entry.key)), [[`i:${Y}`]]);
  assert.deepEqual(t.playerMaps.entries('test', MAP_WORLD), { [`i:${Y}`]: '仲間' });
  assert.ok(t.storage.get(MIGRATED_KEY));
  // ホストとして遊んでいて手元のデータを表示しているなら、表示の読み直しでも H を移す
  const host = await setup({ gas: true, worldId: MAP_WORLD, players: coopPlayers, farms: [] });
  Object.assign(host.owned.state, { meta: { worldId: MAP_WORLD, source: 'local' }, owned: { players: coopPlayers }, play: playingRecord(MAP_WORLD) });
  host.storage.set(LEGACY_KEY, JSON.stringify({ [H]: '仲間' }));
  // 判定（run）が先に移さないよう、自動登録はオフにしておく
  host.auto.setEnabled(false, MAP_WORLD);
  host.mapClock.now += 61_000;
  await host.auto.refreshMapping(MAP_WORLD, 0);
  assert.deepEqual(host.playerMaps.entries('test', MAP_WORLD), { [`i:${X}`]: '仲間' });
});

test('自動登録（server の mapping）: 上げ終えるまでは、GAS に鍵のないプレイヤー（H を除く）に前の版の対応を使う', async () => {
  const t = await setup({ gas: true, worldId: MAP_WORLD, players: coopPlayers, farms: [sheepFarm(F)] });
  t.storage.set(LEGACY_KEY, JSON.stringify({ [H]: '仲間', [F]: '仲間' }));
  // 書き込みが失敗し続ける（印を書かない）
  t.mapControl.failSet = 'INTERNAL';
  t.mapClock.now += 61_000;
  await t.run();
  assert.equal(t.storage.get(MIGRATED_KEY), null);
  assert.deepEqual(t.auto.mapping(MAP_WORLD), { [F]: '仲間' });
  assert.deepEqual(registrants(t.store), ['仲間']);
  // GAS に鍵があればそちら
  await otherPc(t, [{ key: `i:${Y}`, userId: '自分' }]);
  t.mapClock.now += 61_000;
  await t.auto.refreshMapping(MAP_WORLD, 0);
  assert.deepEqual(t.auto.mapping(MAP_WORLD), { [F]: '自分' });
  // 送れなかった移行は、戻した知らせの判定のたびには送り直さない（60 秒あける）
  await t.auto.idle();
  assert.equal(setCalls(t).length, 1);
});

test('自動登録（server の mapping）: 古い GAS（BAD_ACTION）なら前の版の対応で動き、setMapping はこの端末に書く。判定のたびには読みに行かない', async () => {
  const t = await setup({ gas: true, badAction: true, worldId: MAP_WORLD, players: coopPlayers, farms: [sheepFarm(F)] });
  assert.equal(t.auto.mappingMode(MAP_WORLD), 'legacy');
  await t.auto.setMapping(F, '仲間', MAP_WORLD);
  assert.deepEqual(JSON.parse(t.storage.get(LEGACY_KEY)), { [F]: '仲間' });
  await t.auto.idle();
  assert.deepEqual(registrants(t.store), ['仲間']);
  // 協力プレイのホスト（H がプレイヤー）の前の版の対応は今までどおり効く
  t.auto.setLegacyMapping(H, '自分', MAP_WORLD);
  assert.deepEqual(t.auto.mapping(MAP_WORLD), { [F]: '仲間', [H]: '自分' });
  // 古い GAS と分かってからは送らない（起動の 1 回だけ）
  t.lay();
  await t.run();
  assert.deepEqual(t.mapCalls.map((call) => call.action), ['playerMap']);
  assert.equal(setCalls(t).length, 0);
});

test('自動登録（server の mapping・T1 の反証）: 前の版の H の対応は、サーバーのワールド（H がプレイヤーにいない）で以前のホストの対応として効かない', async () => {
  for (const badAction of [false, true]) {
    const t = await setup({ gas: true, badAction, worldId: MAP_WORLD, players: serverPlayers, farms: [sheepFarm(H)] });
    t.storage.set(LEGACY_KEY, JSON.stringify({ [H]: '仲間' }));
    t.mapClock.now += 61_000;
    await t.run();
    assert.equal(t.creates.length, 0, `badAction: ${badAction}`);
    assert.deepEqual(t.auto.mapping(MAP_WORLD), {});
    // 未設定の通知の名前は「以前のホスト」
    assert.deepEqual(t.auto.notices().map((notice) => notice.body), ['以前のホストの配合を登録できません。設定の「プレイヤーの対応」で選んでください。']);
    assert.deepEqual(t.auto.pendingSummary(MAP_WORLD).unmapped.map((item) => [item.uid, item.name]), [[H, '以前のホスト']]);
    if (badAction) continue;
    // 移行でも H は上げない（手元のデータにも H がいない）
    assert.equal(setCalls(t).length, 0);
    assert.deepEqual(t.playerMaps.entries('test', MAP_WORLD), {});
    // 設定で以前のホストを選ぶと（u:H）登録し、未設定の通知は消える
    await t.auto.setMapping(H, '仲間', MAP_WORLD);
    assert.deepEqual(t.playerMaps.entries('test', MAP_WORLD), { [`u:${H}`]: '仲間' });
    await t.auto.idle();
    assert.deepEqual(registrants(t.store), ['仲間']);
    assert.deepEqual(t.auto.notices().map((notice) => notice.title), ['配合を自動登録しました']);
  }
});

test('自動登録（server の mapping）: ほかの PC で決めた対応を読み直すと、保留していた未設定の候補を次の判定で登録する', async () => {
  const t = await setup({ gas: true, worldId: MAP_WORLD, players: coopPlayers, farms: [sheepFarm(F)] });
  await t.run();
  assert.equal(t.creates.length, 0);
  assert.deepEqual(t.auto.notices().map((notice) => notice.title), ['プレイヤーの対応が未設定です']);
  let changes = 0;
  t.auto.subscribe(() => { changes++; });
  await otherPc(t, [{ key: `i:${Y}`, userId: '仲間' }]);
  // 読み直すまでは前の写しのまま
  assert.deepEqual(t.auto.mapping(MAP_WORLD), {});
  // 表のタブのタイマー（5 分）で読み直した
  t.mapClock.now += 5 * 60_000 + 1000;
  await t.auto.refreshMapping(MAP_WORLD, 5 * 60_000);
  await t.auto.idle();
  assert.ok(changes > 0);
  assert.deepEqual(registrants(t.store), ['仲間']);
  assert.deepEqual(t.auto.notices().map((notice) => notice.title), ['配合を自動登録しました']);
});

test('自動登録（server の mapping）: 手元に古い H が残る参加者は、表示している共有のプレイヤーで引き、設定の欄から選ぶ鍵も同じ一覧で作る', async () => {
  const t = await setup({ gas: true, worldId: MAP_WORLD, players: coopPlayers, farms: [] });
  // 手元には協力プレイのときのセーブ（H がプレイヤー）。表示しているのはサーバーの共有（H は U に）
  Object.assign(t.owned.state, { role: 'guest', meta: { worldId: MAP_WORLD, source: 'shared' }, owned: { players: serverPlayers } });
  await otherPc(t, [{ key: `i:${X}`, userId: '自分' }, { key: `u:${H}`, userId: '仲間' }]);
  t.mapClock.now += 61_000;
  await t.auto.refreshMapping(MAP_WORLD, 0);
  // 手元の古い H で引くと H が i:X の「自分」になり、以前のホスト（u:H）と食い違う
  assert.deepEqual(t.auto.mapping(MAP_WORLD), { [U]: '自分', [H]: '仲間' });
  // 以前のホスト（表示しているデータにいない H）を選ぶと u:H を書く（i:X は変えない）
  await t.auto.setMapping(H, '自分', MAP_WORLD);
  assert.deepEqual(t.playerMaps.entries('test', MAP_WORLD), { [`i:${X}`]: '自分', [`u:${H}`]: '自分' });
});

test('自動登録（server の mapping）: InstanceId のない協力プレイのホストは選べず（u:H を書かない）、失敗しても元のまま', async () => {
  const t = await setup({ gas: true, worldId: MAP_WORLD, players: [{ uid: H, name: 'ホストの名前' }], farms: [] });
  await assert.rejects(t.auto.setMapping(H, '仲間', MAP_WORLD), { code: 'PLAYER_KEY' });
  assert.equal(setCalls(t).length, 0);
  // 送れなかったとき（ノートにない ID）は、先に反映した分を戻して投げる
  readWorld(t, coopPlayers, []);
  await assert.rejects(t.auto.setMapping(F, 'ノートにない', MAP_WORLD), { code: 'VALIDATION' });
  assert.deepEqual(t.auto.mapping(MAP_WORLD), {});
});


test('自動登録（server の mapping・Codex のレビュー）: 対応を保存している間は登録を待ち、保存できなかった（BUSY）対応では登録しない', async () => {
  const t = await setup({ gas: true, worldId: MAP_WORLD, players: coopPlayers, farms: [sheepFarm(F)] });
  await t.run();
  assert.equal(t.creates.length, 0);
  // 書き込みを止めたまま、Frank を「仲間」にする
  let release;
  t.mapControl.gates.playerMapSet = new Promise((resolve) => { release = resolve; });
  const saving = t.auto.setMapping(F, '仲間', MAP_WORLD);
  // 選んだ対応は表示にはすぐ出るが、判定（登録）は保存を待つ
  assert.deepEqual(t.auto.mapping(MAP_WORLD), { [F]: '仲間' });
  t.auto.evaluate();
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(t.creates.length, 0);
  // 保存できなかった（GAS が混んでいる）: 元に戻り、その対応では登録しない
  t.mapControl.failSet = 'BUSY';
  release();
  await assert.rejects(saving, { code: 'BUSY' });
  await t.auto.idle();
  assert.equal(t.creates.length, 0);
  assert.deepEqual(t.auto.mapping(MAP_WORLD), {});
  // 保存できたら登録する
  t.mapControl.gates.playerMapSet = null;
  t.mapControl.failSet = null;
  await t.auto.setMapping(F, '仲間', MAP_WORLD);
  await t.auto.idle();
  assert.deepEqual(registrants(t.store), ['仲間']);
});

test('自動登録（server の mapping・反証のレビュー）: 前の版の H は、この PC がホストとして遊んでいる（保存が続いている）ときだけ上げる。同期で受け取った仲間のセーブでは上げない', async () => {
  // 仲間がホストした回のセーブを SaveSync で受け取った（H は仲間のキャラクター。この PC ではゲームをしていない）
  const MATE = 'abcdef0b-0000-0000-0000-00000000000b';
  const synced = [{ uid: H, name: '仲間の名前', instanceId: MATE }, { uid: F, name: 'Frank', instanceId: Y }];
  const t = await setup({ gas: true, worldId: MAP_WORLD, players: synced, farms: [] });
  // この PC の前の版の対応（自分がホストしたときに H を「自分」にした）
  t.storage.set(LEGACY_KEY, JSON.stringify({ [H]: '自分' }));
  t.mapClock.now += 61_000;
  t.lay();
  await t.run();
  // 手元のデータを表示していても、表示の読み直しでも上げない
  Object.assign(t.owned.state, { meta: { worldId: MAP_WORLD, source: 'local' }, owned: { players: synced } });
  await t.auto.refreshMapping(MAP_WORLD, 0);
  assert.equal(setCalls(t).length, 0);
  assert.deepEqual(t.playerMaps.entries('test', MAP_WORLD), {});
  // 自分がホストして遊び始めた（H は自分のキャラクター）: 上げる
  t.owned.state.play = playingRecord(MAP_WORLD);
  readWorld(t, coopPlayers, []);
  t.owned.state.owned = { players: coopPlayers };
  await t.run();
  assert.deepEqual(setCalls(t).map((call) => call.entries.map((entry) => [entry.key, entry.userId])), [[[`i:${X}`, '自分']]]);
  assert.deepEqual(t.playerMaps.entries('test', MAP_WORLD), { [`i:${X}`]: '自分' });
  assert.equal(t.storage.get(MIGRATED_KEY), JSON.stringify({ [H]: '自分' }));
});

test('自動登録（server の mapping・反証のレビュー）: 最初の移行で H を上げられなくても、後でホストとして遊ぶと H を上げる。上げるまでは遊んでいる判定で前の版の H を使う', async () => {
  const t = await setup({ gas: true, worldId: MAP_WORLD, players: coopPlayers, farms: [] });
  // 参加者の画面（共有を表示している）で最初に移した: H は上げず、ほかを上げる。印は H を除いた分
  Object.assign(t.owned.state, { role: 'guest', meta: { worldId: MAP_WORLD, source: 'shared' }, owned: { players: coopPlayers } });
  t.storage.set(LEGACY_KEY, JSON.stringify({ [H]: '仲間', [F]: '仲間' }));
  t.mapClock.now += 61_000;
  await t.auto.refreshMapping(MAP_WORLD, 0);
  assert.deepEqual(setCalls(t).map((call) => call.entries.map((entry) => entry.key)), [[`i:${Y}`]]);
  assert.equal(t.storage.get(MIGRATED_KEY), JSON.stringify({ [F]: '仲間' }));
  // 表示の読み直しを続けても送り直さない
  t.mapClock.now += 61_000;
  await t.auto.refreshMapping(MAP_WORLD, 0);
  assert.equal(setCalls(t).length, 1);
  // この PC がホストになって遊んでいる（H は自分のキャラクター X）。H が預けた牧場のタマゴ
  Object.assign(t.owned.state, { role: 'host', meta: { worldId: MAP_WORLD, source: 'local' }, play: playingRecord(MAP_WORLD) });
  readWorld(t, coopPlayers, emptied([pairFarm('f3', H)]));
  await t.run();
  readWorld(t, coopPlayers, [pairFarm('f3', H)]);
  await t.run();
  assert.deepEqual(setCalls(t).at(-1).entries.map((entry) => [entry.key, entry.userId]), [[`i:${X}`, '仲間']]);
  assert.deepEqual(t.playerMaps.entries('test', MAP_WORLD), { [`i:${Y}`]: '仲間', [`i:${X}`]: '仲間' });
  assert.equal(t.storage.get(MIGRATED_KEY), JSON.stringify({ [H]: '仲間', [F]: '仲間' }));
  assert.deepEqual(registrants(t.store), ['仲間']);

  // H を上げられない（書き込みの失敗）間も、遊んでいる判定では前の版の H で登録する。遊んでいなければ使わない
  for (const playing of [true, false]) {
    const u = await setup({ gas: true, worldId: MAP_WORLD, players: coopPlayers, farms: [] });
    u.storage.set(LEGACY_KEY, JSON.stringify({ [H]: '仲間' }));
    u.mapControl.failSet = 'INTERNAL';
    if (playing) u.owned.state.play = playingRecord(MAP_WORLD);
    u.mapClock.now += 61_000;
    readWorld(u, coopPlayers, emptied([pairFarm('f3', H)]));
    await u.run();
    readWorld(u, coopPlayers, [pairFarm('f3', H)]);
    await u.run();
    // 遊んでいれば送れなかったので印を書かない。遊んでいなければ H を除いた印（H は後で上げる）
    assert.equal(u.storage.get(MIGRATED_KEY), playing ? null : '{}', `playing: ${playing}`);
    assert.deepEqual(registrants(u.store), playing ? ['仲間'] : [], `playing: ${playing}`);
    // 表示（設定の欄）は GAS の対応だけ
    assert.deepEqual(u.auto.mapping(MAP_WORLD), {});
  }
});

test('自動登録（server の mapping・反証のレビュー）: 対応の読み込みを待つ前に牧場を記録する。読めなかったら 60 秒の間は判定のたびに読み直さない', async () => {
  const t = await setup({ gas: true, worldId: MAP_WORLD, players: coopPlayers, farms: [sheepFarm(F)] });
  const farmsKey = `t.autoBreeding.farms.test.${MAP_WORLD}`;
  // GAS の応答が遅い（障害で 35 秒の打ち切りまで返らない）
  t.mapClock.now += 61_000;
  let release;
  t.mapControl.gates.playerMap = new Promise((resolve) => { release = resolve; });
  t.auto.evaluate();
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(JSON.parse(t.storage.get(farmsKey)).importedAt, t.owned.state.local.importedAt);
  t.mapControl.fail = 'INTERNAL';
  release();
  await t.auto.idle();
  const reads = t.mapCalls.filter((call) => call.action === 'playerMap').length;
  // 次のセーブ（30 秒後）では読みに行かず、そのまま記録する
  t.mapControl.gates.playerMap = null;
  t.mapClock.now += 30_000;
  t.lay();
  await t.run();
  assert.equal(t.mapCalls.filter((call) => call.action === 'playerMap').length, reads);
  assert.equal(JSON.parse(t.storage.get(farmsKey)).importedAt, t.owned.state.local.importedAt);
});

test('自動登録（server の mapping・反証のレビュー）: 判定は、その回のセーブのプレイヤーで引く（表示している共有のプレイヤーではない）', async () => {
  const t = await setup({ gas: true, worldId: MAP_WORLD, players: coopPlayers, farms: [] });
  // H のキャラクター（X）は「自分」、以前のホスト（u:H）は「仲間」
  await otherPc(t, [{ key: `i:${X}`, userId: '自分' }, { key: `u:${H}`, userId: '仲間' }]);
  t.mapClock.now += 61_000;
  // 手元はホストの協力プレイのセーブ（H がプレイヤー）、表示しているのはサーバーの共有（H は U に）
  Object.assign(t.owned.state, { meta: { worldId: MAP_WORLD, source: 'shared' }, owned: { players: serverPlayers } });
  readWorld(t, coopPlayers, emptied([pairFarm('f3', H)]));
  await t.run();
  readWorld(t, coopPlayers, [pairFarm('f3', H)]);
  await t.run();
  // 表示している共有のプレイヤーで引くと、H は以前のホスト（仲間）
  assert.deepEqual(t.auto.mapping(MAP_WORLD), { [U]: '自分', [H]: '仲間' });
  assert.deepEqual(registrants(t.store), ['自分']);
});

// ---- 古い系統の守り（常駐の paused。server の T5。docs/server/README.md の「古い系統の守り」） ----
// paused(worldId, stamp) が真なら、そのセーブの候補を取り込まず、登録の直前の送信もしない。ページは渡さない（上のテストは今の動きのまま）

test('自動登録（server の T5 古い系統の守り）: paused が真の間は候補を取り込まず、牧場の記録も進めない。解除した後の判定で前の記録と比べて登録する', async () => {
  const control = { paused: false, calls: [] };
  const t = await setup({ paused: (worldId, stamp) => { control.calls.push([worldId, stamp]); return control.paused; } });
  const farmsKey = 't.autoBreeding.farms.test.W1';
  const before = t.storage.get(farmsKey);
  control.paused = true;
  await t.run();
  await t.run();
  assert.equal(t.creates.length, 0);
  assert.equal(t.storage.get(farmsKey), before);
  // 判定に渡すのは、そのセーブのワールドと保存時刻（このセーブには保存時刻がない）
  assert.deepEqual(control.calls.at(-1), ['W1', '']);
  control.paused = false;
  await t.run();
  assert.deepEqual(registered(t.store), ['SheepBall(F)×SwordCutlassfish(M)>GuardianDog:自分']);
});

test('自動登録（server の T5 古い系統の守り）: paused にはセーブの保存時刻を渡す。止めている間に届いた共有の結果は、解除の後に取り込んだ候補にも当てる', async () => {
  const stopped = new Set();
  const t = await rotation({ paused: (worldId, stamp) => stopped.has(stamp) });
  stopped.add(ticks(0));
  readSave(t, 0, [sheepFarm()]);
  await t.run();
  assert.deepEqual(unitsOf(t), []);
  answer(t, 'done', 0, { result: 'new' });
  await t.run();
  assert.equal(t.creates.length, 0);
  stopped.delete(ticks(0));
  await t.run();
  assert.deepEqual(registered(t.store), [SHEEP]);
});

test('自動登録（server の T5 古い系統の守り）: 前に登録してよいと決めた候補も、止めた後は送らない（取り込みの後・送っている途中に止めた）', async () => {
  const control = { paused: false };
  const t = await setup({ farms: [sheepFarm(), dogFarm()], paused: () => control.paused });
  // 1 件目を送っている途中に止める
  const release = t.hold();
  t.auto.evaluate();
  await tick();
  assert.equal(t.creates.length, 1);
  control.paused = true;
  release();
  await t.auto.idle();
  assert.equal(t.creates.length, 1);
  // 止めている間は、新しいセーブを読んでも、残っている登録してよい候補を送らない
  t.lay();
  await t.run();
  assert.equal(t.creates.length, 1);
  control.paused = false;
  await t.run();
  assert.equal(t.creates.length, 2);
  assert.equal(registered(t.store).length, 2);
});

test('自動登録（server の T5 古い系統の守り）: forgetFarms は牧場の記録と候補を捨て、次の読み込みは記録するだけ。その後に現れたタマゴを登録する', async () => {
  const t = await rotation();
  const farmsKey = 't.autoBreeding.farms.test.W1';
  readSave(t, 0, [sheepFarm()]);
  await t.run();
  assert.deepEqual(unitsOf(t), [['hold', ticks(0), 'f1']]);
  t.auto.forgetFarms('W1');
  assert.equal(t.storage.get(farmsKey), null);
  // 捨てた候補は、そのセーブの共有の結果が届いても登録しない
  answer(t, 'done', 0, { result: 'new' });
  await t.run();
  assert.equal(t.creates.length, 0);
  // 次の読み込みは記録するだけ（前からあるタマゴは新しいタマゴにしない）
  readSave(t, 30, [sheepFarm()]);
  await t.run();
  answer(t, 'done', 30, { result: 'newer' });
  await t.run();
  assert.equal(t.creates.length, 0);
  assert.equal(JSON.parse(t.storage.get(farmsKey)).saveStamp, ticks(30));
  // その後に現れたタマゴは登録する
  readSave(t, 60, [farm('f1', sheepFarm().parents, ['GuardianDog', 'GuardianDog'])]);
  await t.run();
  answer(t, 'done', 60, { result: 'newer' });
  await t.run();
  assert.deepEqual(registered(t.store), [SHEEP]);
});

// ---- 古代文明の配合器（snapshot.breeders。core/auto-breeding.js の breeder） ----

const sheepBreeder = (eggs) => farm('d1', [parent('SheepBall', 'Female'), parent('SwordCutlassfish', 'Male')], eggs);
// 配合器と牧場の外のタマゴだけのセーブを読む
const readBreeders = (t, at, breeders, pals = []) => {
  t.owned.state.local = { ...t.owned.state.local, importedAt: at, snapshot: { players: [{ uid: P1, name: '自分' }], breedFarms: [], breeders, pals } };
};

test('自動登録（配合器）: 配合器に新しく現れたタマゴを親の配合として登録し、通知の場所は拠点（分からなければ「古代文明の配合器」）', async () => {
  for (const [state, place] of [[{}, '古代文明の配合器'], [{ meta: { worldId: 'W1' }, owned: { bases: [{ id: 'b', label: '拠点 1' }] } }, '拠点 1']]) {
    const t = await setup({ farms: [] });
    Object.assign(t.owned.state, state);
    readBreeders(t, '2026-10-06T01:00:00.000Z', [sheepBreeder([])]);
    await t.run();
    readBreeders(t, '2026-10-06T01:00:30.000Z', [sheepBreeder(['GuardianDog'])]);
    await t.run();
    assert.deepEqual(registered(t.store), ['SheepBall(F)×SwordCutlassfish(M)>GuardianDog:自分']);
    assert.deepEqual(t.auto.notices().map((n) => n.body), [`モコロン♀＋オオタチウオ♂ → ヤクモマル（${place}）`]);
  }
});

test('自動登録（配合器）: 中身が親と合わないタマゴは、登録せず、照合が合わないとも知らせない', async () => {
  const t = await setup({ farms: [] });
  readBreeders(t, '2026-10-06T01:00:00.000Z', [sheepBreeder([])]);
  await t.run();
  readBreeders(t, '2026-10-06T01:00:30.000Z', [sheepBreeder(['Anubis'])]);
  await t.run();
  assert.deepEqual([t.creates, t.auto.notices()], [[], []]);
});

test('自動登録（配合器）: 撤去した配合器の前の親は、保存した記録から読んでも、牧場の外のタマゴの照合に使わない', async () => {
  const t = await setup({ farms: [] });
  readBreeders(t, '2026-10-06T01:00:00.000Z', [sheepBreeder([])]);
  await t.run();
  // 配合器の記録は牧場（farms）と分けて breeders に持つ
  const stored = JSON.parse(t.storage.get('t.autoBreeding.farms.test.W1'));
  assert.deepEqual([stored.farms.d1, stored.breeders.d1.eggs], [undefined, []]);
  readBreeders(t, '2026-10-06T01:00:30.000Z', [], [{ instanceId: 'x1', source: 'egg', characterId: 'GuardianDog', location: { kind: 'egg-incubator', itemId: 'PalEgg_Earth_01' } }]);
  await t.run();
  assert.equal(t.creates.length, 0);
});

test('自動登録（配合器）: 前の版のタブが記録を書き戻して配合器の記録が消えても、誤って登録せず、次の読み込みから登録する（Codex のレビュー）', async () => {
  const t = await setup({ farms: [] });
  readBreeders(t, '2026-10-06T01:00:00.000Z', [sheepBreeder([])]);
  await t.run();
  // 前の版の画面は breeders を知らないので、書き戻すと欄ごと消える
  const key = 't.autoBreeding.farms.test.W1';
  const { breeders, ...old } = JSON.parse(t.storage.get(key));
  assert.ok(breeders);
  t.storage.set(key, JSON.stringify({ ...old, rev: old.rev + 1 }));
  readBreeders(t, '2026-10-06T01:00:30.000Z', [sheepBreeder(['GuardianDog'])], [{ instanceId: 'd1-0', source: 'egg', characterId: 'GuardianDog', location: { kind: 'egg-incubator', itemId: 'PalEgg_Earth_01' } }]);
  await t.run();
  assert.equal(t.creates.length, 0);
  readBreeders(t, '2026-10-06T01:01:00.000Z', [sheepBreeder(['GuardianDog', 'GuardianDog'])]);
  await t.run();
  assert.deepEqual(registered(t.store), ['SheepBall(F)×SwordCutlassfish(M)>GuardianDog:自分']);
});
