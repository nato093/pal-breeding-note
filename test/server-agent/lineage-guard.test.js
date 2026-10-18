import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import data from '../../web/data/breeding.js';
import { createDevelopmentApi } from '../../dev/mock-api.js';
import { createApi } from '../../web/js/api.js';
import { createStore, safeStorage } from '../../web/js/store.js';
import { createOwnedStore } from '../../web/js/owned.js';
import { createAutoRegister } from '../../web/js/auto-register.js';
import { createKvStorage } from '../../tools/server-agent/kv-storage.mjs';
import {
  createLineageGuard, compareLineage, lineageOfSnapshot, lineageOfUpload, LINEAGE_BLOCKED, LINEAGE_PENDING,
} from '../../tools/server-agent/lineage-guard.mjs';
import { hostFiles, asDropped, memoryPersist, settleUpload } from '../helpers/file-handles.js';

const W = 'ABCDEF0123456789ABCDEF0123456789';
const NS = 't';
const STATE_KEY = `${NS}.agent.lineage.test.${W}`;
const FARMS_KEY = `${NS}.autoBreeding.farms.test.${W}`;
// セーブの中の保存時刻（Level.sav の Timestamp。PC の時刻のティック）と、ワールドが動いた通算の時間（RealDateTimeTicks。分のティック）
const stampAt = (seconds) => String(638650000000000000n + BigInt(seconds) * 10_000_000n);
const clockAt = (minutes) => String(BigInt(minutes) * 600_000_000n);
const save = (seconds, minutes, day) => ({ stamp: stampAt(seconds), clock: minutes === null ? '' : clockAt(minutes), inGameDay: day });

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k), map };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

// GAS の代わり（公開の世代と届いた送信）。世代の uploadedAt は GAS のサーバーの時計（gas.time）で作る（PC の時計とは別）。
// fail は操作ごとの失敗の code、gates は操作ごとに止める Promise
function fakeGas({ start = Date.parse('2026-10-18T05:00:00.000Z') } = {}) {
  const gas = { time: start, worlds: new Map(), uploads: [], calls: [], fail: {}, gates: {}, scope: 'test' };
  gas.publish = (worldId, { clock = '', inGameDay = null, uploadedBy = '仲間' } = {}) => {
    gas.time += 60_000;
    const world = { worldId, uploadedAt: new Date(gas.time).toISOString(), uploadedBy, inGameDay, saveStamp: '', ...(clock ? { clock } : {}) };
    gas.worlds.set(worldId, world);
    return world;
  };
  gas.server = {
    scope: () => gas.scope, userId: () => 'サーバー', endpoint: () => 'local',
    async request(action, input = {}) {
      gas.calls.push(action);
      await gas.gates[action];
      const code = gas.fail[action];
      if (code) throw Object.assign(new Error(code), { code });
      if (action === 'ownedWorlds') return { worlds: [...gas.worlds.values()].map((world) => ({ ...world })) };
      if (action === 'ownedUpload') {
        gas.uploads.push(input);
        const world = gas.publish(input.worldId, { clock: input.world?.clock ?? '', inGameDay: input.world?.inGameDay ?? null, uploadedBy: input.userId });
        return { stored: true, result: 'newer', world };
      }
      return { action };
    },
  };
  return gas;
}
// 共有の送信（owned.js の sendLocal が送る形のうち、守りが見る項目）
const uploadOf = (values, worldId = W) => ({
  userId: 'サーバー', worldId,
  world: { name: 'テスト', saveStamp: values.stamp, ...(values.clock ? { clock: values.clock } : {}), ...(values.inGameDay ? { inGameDay: values.inGameDay } : {}) },
  players: [], bases: [], columns: [], rows: [],
});
const guardOf = (gas, storage, options = {}) => createLineageGuard({ server: gas.server, storage, namespace: NS, ...options });
const codeOf = (promise) => promise.then(() => 'sent', (error) => error.code);

test('古い系統の守り: 比べ方は同じ単位どうし（両方に clock があれば clock、なければ両方の日数、それもなければ比べない）。混ぜない', () => {
  assert.equal(compareLineage(save(0, 100, 5), save(0, 200, 3)), -1);
  assert.equal(compareLineage(save(0, 200, 3), save(0, 100, 5)), 1);
  assert.equal(compareLineage(save(0, 100, 3), save(9, 100, 9)), 0);
  // どちらかに clock がなければ日数（clock の大小は見ない）
  assert.equal(compareLineage(save(0, 900, 5), save(0, null, 10)), -1);
  assert.equal(compareLineage(save(0, null, 10), save(0, 900, 5)), 1);
  // 日数もどちらかになければ比べない
  assert.equal(compareLineage(save(0, null, 0), save(0, 100, 5)), null);
  assert.equal(compareLineage(save(0, 100, 5), { clock: '', inGameDay: null }), null);
  // 桁の違う clock（先頭の 0 を除いて数として比べる）
  assert.equal(compareLineage({ clock: '0999' }, { clock: '1000' }), -1);
  // 読み込んだセーブと送信から取り出す値
  assert.deepEqual(lineageOfSnapshot({ world: { savedAtTicks: stampAt(1), clock: clockAt(2), inGameDay: 3 } }), { stamp: stampAt(1), clock: clockAt(2), inGameDay: 3 });
  assert.deepEqual(lineageOfUpload(uploadOf({ stamp: stampAt(1), clock: '', inGameDay: 0 })), { stamp: stampAt(1), clock: '', inGameDay: 0 });
});

test('古い系統の守り: clock と日数を混ぜない（clock どうしなら日数が大きくても古い・日数どうしなら clock が大きくても古い・比べられなければ送る）', async () => {
  const cases = [
    // [公開の値, セーブ, 結果]
    [{ clock: '', inGameDay: 10 }, save(0, 900, 5), 'blocked'],
    [{ clock: clockAt(900), inGameDay: 10 }, save(0, 100, 20), 'blocked'],
    [{ clock: clockAt(100), inGameDay: 10 }, save(0, 900, 5), 'ok'],
    [{ clock: clockAt(900), inGameDay: 10 }, save(0, null, 0), 'ok'],
    [{ clock: '', inGameDay: null }, save(0, 100, 1), 'ok'],
  ];
  for (const [published, values, expected] of cases) {
    const gas = fakeGas();
    gas.publish(W, published);
    const guard = guardOf(gas, safeStorage(memoryStorage()));
    assert.equal(await guard.check(W, values), expected, JSON.stringify([published, values]));
    assert.equal(guard.paused(W, values.stamp), expected !== 'ok');
  }
});

test('古い系統の守り: 起動したとき・新しいセーブは判定待ち。公開の値を読んで確かめたら、その stamp に限って解除する', async () => {
  const gas = fakeGas();
  gas.publish(W, { clock: clockAt(100), inGameDay: 10 });
  const storage = safeStorage(memoryStorage());
  const guard = guardOf(gas, storage);
  const events = [];
  guard.subscribe((event) => events.push(event.type));
  assert.equal(guard.paused(W, stampAt(0)), true);
  // 読んでいる間も判定待ち
  let release;
  gas.gates.ownedWorlds = new Promise((resolve) => { release = resolve; });
  const checking = guard.check(W, save(0, 110, 10));
  await tick();
  assert.equal(guard.paused(W, stampAt(0)), true);
  // 同じセーブの判定は 1 回だけ読む
  const again = guard.check(W, save(0, 110, 10));
  release();
  assert.deepEqual([await checking, await again], ['ok', 'ok']);
  assert.equal(gas.calls.filter((action) => action === 'ownedWorlds').length, 1);
  assert.deepEqual(events, ['verified']);
  assert.equal(guard.paused(W, stampAt(0)), false);
  // 次のセーブはまた判定待ち
  assert.equal(guard.paused(W, stampAt(30)), true);
  // 再起動したら（同じ KV でも）判定待ちから
  assert.equal(guardOf(gas, storage).paused(W, stampAt(0)), true);
  // 保存時刻・ワールド・ログインのどれかがなければ判定待ちのまま
  assert.equal(await guard.check(W, { clock: clockAt(110), inGameDay: 10 }), 'pending');
  assert.equal(guard.paused(W, ''), true);
  gas.scope = '';
  assert.equal(guard.paused(W, stampAt(0)), true);
});

test('古い系統の守り: 共有の送信（ownedUpload）は、判定が済むまで送らない。読めない間は送らず、owned.js の再試行の段に入らない code にする', async () => {
  const gas = fakeGas();
  gas.publish(W, { clock: clockAt(100), inGameDay: 10 });
  const guard = guardOf(gas, safeStorage(memoryStorage()));
  // ほかの操作はそのまま通す
  assert.deepEqual(await guard.server.request('presence', { worldId: W }), { action: 'presence' });
  assert.deepEqual([guard.server.scope(), guard.server.userId(), guard.server.endpoint()], ['test', 'サーバー', 'local']);
  // 読んでいる間は待ち、確かめてから送る
  let release;
  gas.gates.ownedWorlds = new Promise((resolve) => { release = resolve; });
  const sending = codeOf(guard.server.request('ownedUpload', uploadOf(save(0, 110, 10))));
  await tick();
  assert.equal(gas.uploads.length, 0);
  release();
  assert.equal(await sending, 'sent');
  assert.equal(gas.uploads.length, 1);
  // 公開の値を読めない間（通信の失敗）は送らない
  gas.gates.ownedWorlds = null;
  gas.fail.ownedWorlds = 'CONNECTION';
  assert.equal(await codeOf(guard.server.request('ownedUpload', uploadOf(save(30, 111, 10)))), LINEAGE_PENDING);
  assert.equal(gas.uploads.length, 1);
  assert.equal(await guard.check(W, save(30, 111, 10)), 'pending');
  assert.equal(guard.paused(W, stampAt(30)), true);
  // 保存時刻のない送信も送らない
  gas.fail.ownedWorlds = null;
  assert.equal(await codeOf(guard.server.request('ownedUpload', uploadOf({ stamp: '', clock: clockAt(112), inGameDay: 10 }))), LINEAGE_PENDING);
  // 読めるようになったら送る
  assert.equal(await codeOf(guard.server.request('ownedUpload', uploadOf(save(30, 111, 10)))), 'sent');
  assert.equal(gas.uploads.length, 2);
  // owned.js の再試行の段（UPLOAD_RETRY_CODES）に入らない
  for (const code of [LINEAGE_PENDING, LINEAGE_BLOCKED]) assert.ok(!['TIMEOUT', 'CONNECTION', 'BUSY', 'INTERNAL', 'RESPONSE'].includes(code));
});

test('古い系統の守り: 公開の値より古いセーブは止め、止めた状態は再起動しても（KV のファイル）・後で値が追い越しても解除しない', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pal-agent-lineage-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'test', 'state.json');
  const kv = createKvStorage({ file, namespace: NS, delayMs: 5 });
  const gas = fakeGas();
  // 協力プレイで進めた新しい系統が公開されている
  gas.publish(W, { clock: clockAt(1000), inGameDay: 20 });
  const warnings = [];
  const guard = guardOf(gas, safeStorage(kv), { log: { warn: (event, fields) => warnings.push([event, fields]), info: () => {} } });
  const events = [];
  guard.subscribe((event) => events.push(event.type));
  // 古いサーバーのワールド（保存時刻は新しいが、通算の時間は短い）
  assert.equal(await codeOf(guard.server.request('ownedUpload', uploadOf(save(600, 900, 18)))), LINEAGE_BLOCKED);
  assert.equal(gas.uploads.length, 0);
  assert.deepEqual(events, ['blocked']);
  assert.deepEqual(warnings, [['lineage-blocked', { worldId: W, against: 'published', unit: 'clock', save: clockAt(900), other: clockAt(1000) }]]);
  assert.equal(guard.paused(W, stampAt(600)), true);
  // 遊び続けて公開の値を追い越しても解除しない
  assert.equal(await guard.check(W, save(9000, 2000, 30)), 'blocked');
  assert.equal(await codeOf(guard.server.request('ownedUpload', uploadOf(save(9000, 2000, 30)))), LINEAGE_BLOCKED);
  assert.equal(gas.uploads.length, 0);
  assert.equal(guard.paused(W, stampAt(9000)), true);
  assert.equal(guard.status(W).state, 'blocked');
  // 再起動（KV をファイルから読み直す）しても止めたまま
  await kv.flush();
  const restarted = guardOf(gas, safeStorage(createKvStorage({ file, namespace: NS })));
  assert.equal(restarted.paused(W, stampAt(9000)), true);
  assert.equal(await restarted.check(W, save(9030, 2001, 30)), 'blocked');
  assert.deepEqual(restarted.status(W).blocked, { against: 'published', save: { clock: clockAt(900), inGameDay: 18 }, other: { clock: clockAt(1000), inGameDay: 20 } });
  // 別のワールドは止めない
  const other = 'FEDCBA9876543210FEDCBA9876543210';
  assert.equal(await restarted.check(other, save(9030, 1, 1)), 'ok');
});

test('古い系統の守り: この常駐が前に送った値より小さいセーブも止める（公開の値が読めても、それより古くなくても）', async () => {
  const gas = fakeGas();
  const storage = safeStorage(memoryStorage());
  const guard = guardOf(gas, storage);
  assert.equal(await codeOf(guard.server.request('ownedUpload', uploadOf(save(0, 500, 10)))), 'sent');
  // 公開されている値が消えた（GAS の行を消した）後に、前に送ったより古いセーブ
  gas.worlds.clear();
  assert.equal(await guard.check(W, save(30, 400, 9)), 'blocked');
  assert.equal(guard.status(W).blocked.against, 'sent');
  // 前に送った値は単位ごとに残す（clock のない送信でも、前の clock を消さない）
  const fresh = guardOf(fakeGas(), safeStorage(memoryStorage()));
  await fresh.server.request('ownedUpload', uploadOf(save(0, 500, 10)));
  await fresh.server.request('ownedUpload', uploadOf(save(30, null, 11)));
  assert.equal(await fresh.check(W, save(60, 499, 12)), 'blocked');
});

test('古い系統の守り: 壊れた状態は止めた状態として扱う（受け入れで戻る）', async () => {
  const gas = fakeGas();
  gas.publish(W, { clock: clockAt(100), inGameDay: 10 });
  const storage = safeStorage(memoryStorage());
  storage.set(STATE_KEY, '{壊れた');
  const guard = guardOf(gas, storage);
  assert.equal(await guard.check(W, save(0, 200, 11)), 'blocked');
  await guard.accept(W, save(0, 200, 11));
  assert.equal(await guard.check(W, save(30, 201, 11)), 'ok');
});

test('古い系統の守り: 届いたか分からない送信（通信の失敗）も、送ったもの（b）として残す。受け入れの後に公開された世代は、uploadedAt が読めなくても比べる', async () => {
  const gas = fakeGas();
  gas.publish(W, { clock: clockAt(100), inGameDay: 10 });
  const storage = safeStorage(memoryStorage());
  const guard = guardOf(gas, storage);
  gas.fail.ownedUpload = 'CONNECTION';
  assert.equal(await codeOf(guard.server.request('ownedUpload', uploadOf(save(60, 300, 12)))), 'CONNECTION');
  assert.deepEqual(guard.status(W).sent, { clock: clockAt(300), inGameDay: 12 });
  gas.fail.ownedUpload = '';
  assert.equal(await guard.check(W, save(90, 200, 11)), 'blocked');
  assert.equal(guard.status(W).blocked.against, 'sent');

  // 受け入れの後に公開された世代の uploadedAt が読めない: 後に公開されたものとして比べる（見落とさない）
  const other = fakeGas();
  other.publish(W, { clock: clockAt(100), inGameDay: 10 });
  const accepted = guardOf(other, safeStorage(memoryStorage()));
  await accepted.accept(W, save(600, 100, 10));
  other.worlds.set(W, { ...other.publish(W, { clock: clockAt(500), inGameDay: 15 }), uploadedAt: 'not-a-time' });
  assert.equal(await accepted.check(W, save(630, 101, 10)), 'blocked');
});

test('古い系統の守り: 受け入れは、公開の世代がない・読めないときは行わない', async () => {
  const gas = fakeGas();
  const guard = guardOf(gas, safeStorage(memoryStorage()));
  await assert.rejects(guard.accept(W, save(0, 100, 10)), { code: 'NO_PUBLISHED' });
  gas.publish(W, { clock: clockAt(200), inGameDay: 12 });
  await guard.check(W, save(0, 100, 10));
  gas.fail.ownedWorlds = 'TIMEOUT';
  await assert.rejects(guard.accept(W, save(0, 100, 10)), { code: 'UNREADABLE' });
  assert.equal(guard.status(W).state, 'blocked');
  gas.scope = '';
  await assert.rejects(guard.accept(W, save(0, 100, 10)), { code: 'NOT_READY' });
});

test('古い系統の守り: 判定の途中で判定してよい間（session。常駐の attach の世代）が替わった・受け入れたら、その判定の結果で止めも解除もしない', async () => {
  // 判定の途中で session が替わり（最後の送信の期限・次の attach）、その間に新しい系統が公開された
  const gas = fakeGas();
  gas.publish(W, { clock: clockAt(100), inGameDay: 10 });
  let session = 1;
  const guard = guardOf(gas, safeStorage(memoryStorage()), { session: () => session });
  let release;
  gas.gates.ownedWorlds = new Promise((resolve) => { release = resolve; });
  const stale = guard.check(W, save(0, 150, 10));
  await tick();
  session = 2;
  gas.gates.ownedWorlds = null;
  gas.publish(W, { clock: clockAt(200), inGameDay: 11 });
  release();
  assert.equal(await stale, 'pending');
  assert.equal(guard.status(W, stampAt(0)).state, 'pending', '止めた状態にしない・解除もしない');
  // 判定してよい間でなければ（null）判定しない（公開の値も読まない）
  session = null;
  const calls = gas.calls.length;
  assert.equal(await guard.check(W, save(30, 250, 12)), 'pending');
  assert.equal(gas.calls.length, calls);
  // 今の間に判定し直せば、効く
  session = 3;
  assert.equal(await guard.check(W, save(0, 150, 10)), 'blocked');

  // 判定の途中で受け入れた: 受け入れの前に始めた古いセーブの判定で、受け入れた値（b）と比べて止めない
  const gas2 = fakeGas();
  gas2.publish(W, { clock: clockAt(200), inGameDay: 11 });
  const guard2 = guardOf(gas2, safeStorage(memoryStorage()));
  let release2;
  gas2.gates.ownedWorlds = new Promise((resolve) => { release2 = resolve; });
  const before = guard2.check(W, save(0, 150, 10));
  await tick();
  gas2.gates.ownedWorlds = null;
  await guard2.accept(W, save(30, 151, 10));
  release2();
  assert.equal(await before, 'pending');
  assert.notEqual(guard2.status(W).state, 'blocked');
  assert.equal(await guard2.check(W, save(30, 151, 10)), 'ok');
});

test('古い系統の守り: 受け入れの直後の読み込みでも再起動の後でも止まらない。受け入れの後に公開された新しい系統は見落とさない', async () => {
  const gas = fakeGas();
  const generation = gas.publish(W, { clock: clockAt(1000), inGameDay: 20 });
  const storage = safeStorage(memoryStorage());
  storage.set(FARMS_KEY, JSON.stringify({ rev: 3, pending: [{ key: 'k' }] }));
  const accepted = [];
  const guard = guardOf(gas, storage, { onAccept: (worldId, env) => accepted.push([worldId, env]) });
  const events = [];
  guard.subscribe((event) => events.push(event.type));
  assert.equal(await guard.check(W, save(600, 900, 18)), 'blocked');
  // 意図して古い系統で続ける（バックアップから戻した）
  assert.deepEqual(await guard.accept(W, save(600, 900, 18)), { uploadedAt: generation.uploadedAt });
  assert.deepEqual(events, ['blocked', 'accepted']);
  assert.deepEqual(guard.status(W, stampAt(600)), {
    state: 'ok', blocked: null, baseline: { uploadedAt: generation.uploadedAt, clock: clockAt(900), inGameDay: 18 }, sent: { clock: clockAt(900), inGameDay: 18 },
  });
  // 止めていた間の候補と牧場の記録を捨てる（KV と、動いている自動登録）
  assert.equal(storage.get(FARMS_KEY), null);
  assert.deepEqual(accepted, [[W, 'test']]);
  // 受け入れたセーブはそのまま送れる。直後の読み込み（受け入れたときの公開の世代より小さいまま）も止まらない
  assert.equal(guard.paused(W, stampAt(600)), false);
  assert.equal(await codeOf(guard.server.request('ownedUpload', uploadOf(save(600, 900, 18)))), 'sent');
  assert.equal(await codeOf(guard.server.request('ownedUpload', uploadOf(save(630, 901, 18)))), 'sent');
  // 再起動の後も止まらない
  const restarted = guardOf(gas, storage);
  assert.equal(await restarted.check(W, save(660, 902, 18)), 'ok');
  // 受け入れの後に、別の PC が新しい系統を公開した
  gas.publish(W, { clock: clockAt(1500), inGameDay: 25 });
  assert.equal(await restarted.check(W, save(690, 903, 18)), 'blocked');
});

for (const [label, skew] of [['進んでいる', 400 * 24 * 60 * 60 * 1000], ['遅れている', -400 * 24 * 60 * 60 * 1000]]) {
  test(`古い系統の守り: PC の時計が${label}ときも、受け入れの基準（GAS の uploadedAt）が効く`, async (t) => {
    const gasStart = Date.parse('2026-10-18T05:00:00.000Z');
    t.mock.timers.enable({ apis: ['Date'], now: gasStart + skew });
    const gas = fakeGas({ start: gasStart });
    gas.publish(W, { clock: clockAt(1000), inGameDay: 20 });
    const storage = safeStorage(memoryStorage());
    const guard = guardOf(gas, storage);
    assert.equal(await guard.check(W, save(600, 900, 18)), 'blocked');
    await guard.accept(W, save(600, 900, 18));
    // 受け入れたときの公開の世代では止めない（PC の時計で基準を作ると、遅れているときにまた止まる）
    assert.equal(await guard.check(W, save(630, 901, 18)), 'ok');
    assert.equal(await guardOf(gas, storage).check(W, save(660, 902, 18)), 'ok');
    // その後の公開は見落とさない（PC の時計で基準を作ると、進んでいるときに見落とす）
    t.mock.timers.tick(60_000);
    gas.publish(W, { clock: clockAt(1500), inGameDay: 25 });
    assert.equal(await guardOf(gas, storage).check(W, save(690, 903, 18)), 'blocked');
  });
}

// ---- 結合: 画面と同じストア（createOwnedStore・createAutoRegister）を、守りを挟んで組み立てる（常駐の agent.mjs の形） ----

const PASS = '古い系統の試験用';
const P1 = 'p-1';
const parent = (characterId, gender) => ({ instanceId: `${characterId}-${gender}`, characterId, gender, depositorUid: P1 });
const sheepFarm = (eggs) => ({
  id: 'f1', baseId: 'b', status: 'ok', parents: [parent('SheepBall', 'Female'), parent('SwordCutlassfish', 'Male')],
  eggs: eggs.map((characterId, i) => ({ localId: `f1-${i}`, characterId, itemId: 'PalEgg_Earth_01' })),
});
const SHEEP = 'SheepBall(F)×SwordCutlassfish(M)>GuardianDog:サーバー';
const registered = (store) => store.state.records.map((r) => `${r.parent1Id}(${r.parent1Gender})×${r.parent2Id}(${r.parent2Gender})>${r.childId}:${r.registrant}`);
// 読み込んだセーブ（seconds 秒に保存・通算 minutes 分・day 日目）
const snapshotOf = ({ seconds, minutes, day, eggs = [], name = 'テスト' }) => ({
  version: 1, world: { name, hostName: '', savedAtTicks: stampAt(seconds), clock: clockAt(minutes), inGameDay: day },
  players: [{ uid: P1, name: 'サーバー', level: 1 }], bases: [],
  pals: [{ instanceId: 'i0', characterId: 'SheepBall', passives: [], talent: {}, location: { kind: 'palbox', playerUid: P1 } }],
  breedFarms: [sheepFarm(eggs)], stats: {}, files: { used: [], skipped: [] },
});

// GAS（開発用 API。時計は GAS のサーバーの時計）。control.gates・fail は操作ごとに止める・失敗させる、uploads は GAS に届いた共有の送信の数
async function gasOf() {
  const clock = { gas: Date.parse('2026-10-18T05:00:00.000Z') };
  const development = createDevelopmentApi({ now: () => clock.gas });
  const control = { gates: {}, fail: {}, uploads: 0 };
  const api = createApi({ transport: async (request) => {
    await control.gates[request.action];
    const code = control.fail[request.action];
    if (code) return { ok: false, code };
    if (request.action === 'ownedUpload') control.uploads++;
    return development(request);
  } });
  await api.request('signup', PASS, { userId: 'サーバー' });
  await api.request('signup', PASS, { userId: '仲間' });
  return { clock, control, api };
}

// 1 台の PC（常駐か協力プレイのホストの画面）。guarded なら守りを挟み、自動登録に paused を渡す。kv は再起動しても残る保存先
async function pcOf(gas, { userId = 'サーバー', guarded = true, kv = memoryStorage(), steamId = '0', first }) {
  const storage = safeStorage(kv);
  const store = createStore({ api: gas.api, storage: safeStorage(null) });
  await store.login(userId, PASS);
  await store.refresh();
  const inner = {
    scope: () => (store.state.passcode && store.state.userId && store.state.env ? store.state.env : ''),
    userId: () => store.state.userId,
    request: (action, input) => store.call(action, input),
    endpoint: () => 'local',
  };
  const pc = { store, current: first, time: Date.parse('2026-10-18T05:00:00.000Z'), timers: [], files: hostFiles(), auto: null };
  pc.guard = guarded ? createLineageGuard({ server: inner, storage, namespace: NS, onAccept: (worldId, env) => pc.auto?.forgetFarms(worldId, env) }) : null;
  pc.owned = createOwnedStore({
    persist: memoryPersist(), settings: storage, namespace: NS, server: pc.guard ? pc.guard.server : inner,
    runImport: async () => pc.current, now: () => pc.time,
    schedule: (fn, ms) => { pc.timers.push({ fn, ms }); return pc.timers.length - 1; }, cancel: () => {},
    hidden: () => false, resident: guarded,
  });
  pc.auto = createAutoRegister({
    store, owned: pc.owned, storage, namespace: NS, loadTable: async () => ({ default: data }), now: () => pc.time,
    ...(pc.guard ? { paused: pc.guard.paused } : {}),
  });
  pc.owned.subscribe(pc.auto.evaluate);
  // 判定が済んだ・受け入れた: 自動登録をやり直す（常駐の agent.mjs の形）
  pc.guard?.subscribe(() => pc.auto.evaluate());
  pc.settle = async () => {
    await settleUpload(pc.owned);
    for (let i = 0; i < 5; i++) {
      await pc.auto.idle();
      await tick();
    }
  };
  // 次のセーブを読む（30 秒後。ファイルの更新日時を進めて、5 秒ごとの確認と同じく読み直す）
  pc.read = async (snapshot) => {
    pc.current = snapshot;
    pc.time += 30_000;
    for (const handle of Object.values(pc.files)) handle.time += 30_000;
    await pc.owned.pollAuto();
  };
  await pc.owned.commitRegistration(await pc.owned.previewRegistration({ worldId: W, steamId, files: asDropped(pc.files) }));
  await pc.settle();
  return pc;
}

test('古い系統の守り（結合）: 判定が済むまで共有も登録もしない。確かめたら共有し、その共有の結果で登録する', async () => {
  const gas = await gasOf();
  const kv = memoryStorage();
  const pc = await pcOf(gas, { kv, first: snapshotOf({ seconds: 0, minutes: 100, day: 10 }) });
  assert.equal(gas.control.uploads, 1);
  // 最初の読み込みで牧場を記録した（タマゴはまだない）
  assert.equal(JSON.parse(kv.getItem(FARMS_KEY)).saveStamp, stampAt(0));
  // 次のセーブでタマゴが現れたが、公開の値を読んでいる途中
  let release;
  gas.control.gates.ownedWorlds = new Promise((resolve) => { release = resolve; });
  await pc.read(snapshotOf({ seconds: 30, minutes: 101, day: 10, eggs: ['GuardianDog'] }));
  for (let i = 0; i < 20; i++) await tick();
  await pc.auto.idle();
  assert.equal(pc.owned.state.upload.status, 'sending');
  assert.equal(gas.control.uploads, 1);
  assert.equal(JSON.parse(kv.getItem(FARMS_KEY)).saveStamp, stampAt(0));
  assert.deepEqual(registered(pc.store), []);
  assert.equal(pc.guard.paused(W, stampAt(30)), true);
  release();
  gas.control.gates.ownedWorlds = null;
  await pc.settle();
  assert.deepEqual([pc.owned.state.upload.status, gas.control.uploads], ['done', 2]);
  assert.deepEqual(registered(pc.store), [SHEEP]);
});

test('古い系統の守り（結合）: 公開の値を読めない間は共有も登録もせず、再試行の段にも入らない。読めたら確かめて送り直す', async () => {
  const gas = await gasOf();
  const kv = memoryStorage();
  const pc = await pcOf(gas, { kv, first: snapshotOf({ seconds: 0, minutes: 100, day: 10 }) });
  gas.control.fail.ownedWorlds = 'CONNECTION';
  const timers = pc.timers.length;
  await pc.read(snapshotOf({ seconds: 30, minutes: 101, day: 10, eggs: ['GuardianDog'] }));
  await pc.settle();
  assert.deepEqual([pc.owned.state.upload.status, gas.control.uploads], ['error', 1]);
  assert.match(pc.owned.state.upload.error, /照らせていない/);
  assert.equal(pc.timers.length, timers);
  assert.deepEqual(registered(pc.store), []);
  assert.equal(JSON.parse(kv.getItem(FARMS_KEY)).saveStamp, stampAt(0));
  // 読めるようになった: 常駐は読んだセーブを判定し直し、送り直す（agent.mjs の形）
  gas.control.fail.ownedWorlds = null;
  assert.equal(await pc.guard.check(W, lineageOfSnapshot(pc.owned.state.local.snapshot)), 'ok');
  await pc.owned.uploadLocal({ force: true });
  await pc.settle();
  assert.deepEqual([pc.owned.state.upload.status, gas.control.uploads], ['done', 2]);
  assert.deepEqual(registered(pc.store), [SHEEP]);
});

test('古い系統の守り（結合）: 協力プレイで進めた後に古いサーバーを起動しても共有を上書きせず、自動登録もしない。受け入れたら記録だけから始め、再起動の後も止まらない', async () => {
  const gas = await gasOf();
  const kv = memoryStorage();
  const agent = await pcOf(gas, { kv, first: snapshotOf({ seconds: 0, minutes: 100, day: 10 }) });
  // 協力プレイに戻して進めた（ホストの画面が共有。守りはない）
  gas.clock.gas += 60 * 60 * 1000;
  const host = await pcOf(gas, { userId: '仲間', guarded: false, steamId: '7656', first: snapshotOf({ seconds: 3600, minutes: 160, day: 13 }) });
  assert.equal(gas.control.uploads, 2);
  // 古いサーバーのインスタンスを起動した（保存時刻は新しいが、通算の時間は短い）。タマゴも現れた
  gas.clock.gas += 60 * 60 * 1000;
  agent.time += 2 * 60 * 60 * 1000;
  await agent.read(snapshotOf({ seconds: 7200, minutes: 101, day: 10, eggs: ['GuardianDog'] }));
  await agent.settle();
  assert.equal(gas.control.uploads, 2);
  assert.match(agent.owned.state.upload.error, /古い系統/);
  assert.deepEqual(registered(agent.store), []);
  const [published] = (await gas.api.request('ownedWorlds', PASS)).worlds;
  assert.deepEqual([published.uploadedBy, published.clock], ['仲間', clockAt(160)]);
  // 遊び続けて公開の値を追い越しても止めたまま
  await agent.read(snapshotOf({ seconds: 7230, minutes: 200, day: 15, eggs: ['GuardianDog', 'GuardianDog'] }));
  await agent.settle();
  assert.equal(gas.control.uploads, 2);
  assert.deepEqual(registered(agent.store), []);
  // 再起動しても止めたまま
  const restarted = await pcOf(gas, { kv, first: snapshotOf({ seconds: 7260, minutes: 201, day: 15, eggs: ['GuardianDog', 'GuardianDog'] }) });
  assert.equal(gas.control.uploads, 2);
  assert.equal(restarted.guard.status(W).state, 'blocked');
  // 受け入れ（--accept-world）: 止めていた間の牧場の記録を捨て、記録だけから。受け入れの直後は止まらない
  await restarted.guard.accept(W, lineageOfSnapshot(restarted.owned.state.local.snapshot));
  await restarted.owned.uploadLocal({ force: true });
  await restarted.settle();
  assert.deepEqual([restarted.owned.state.upload.status, gas.control.uploads], ['done', 3]);
  assert.deepEqual(registered(restarted.store), []);
  assert.equal(JSON.parse(kv.getItem(FARMS_KEY)).saveStamp, stampAt(7260));
  // 次のセーブ: 前からあるタマゴは登録せず、新しく現れたタマゴを登録する
  await restarted.read(snapshotOf({ seconds: 7290, minutes: 202, day: 15, eggs: ['GuardianDog', 'GuardianDog', 'GuardianDog'] }));
  await restarted.settle();
  assert.deepEqual([restarted.owned.state.upload.status, gas.control.uploads], ['done', 4]);
  assert.deepEqual(registered(restarted.store), [SHEEP]);
  // 再起動の後も止まらない
  const again = await pcOf(gas, { kv, first: snapshotOf({ seconds: 7320, minutes: 203, day: 15, eggs: ['GuardianDog', 'GuardianDog', 'GuardianDog'] }) });
  assert.deepEqual([again.owned.state.upload.status, again.guard.status(W, stampAt(7320)).state], ['done', 'ok']);
  assert.equal(gas.control.uploads, 5);
  assert.ok(host);
});
