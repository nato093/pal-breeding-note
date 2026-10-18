// 常駐の組み立てと動き（tools/server-agent/agent.mjs。docs/server/README.md の T5「動き」）。画面と同じストアを開発用 API（dev/mock-api.js）と
// 一時フォルダのサーバーのワールド、偽の解析・サーバーの稼働・見張り・仮の時計で動かす。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createKvStorage } from '../../tools/server-agent/kv-storage.mjs';
import { createAgent, withUploadLimit, uploadChars, GAS_MAX_UPLOAD_CHARS } from '../../tools/server-agent/agent.mjs';
import {
  W, PASS, U1, U2, T0, SHEEP, registered, snapshotOf, serverWorld, gasOf, memoryLog, instanceOf, clockAt,
} from '../helpers/server-agent.js';

// 仮の時計（setTimeout の代わり）。advance で、期限の来たタイマーを早い順に動かす（間に実際の時間も少し待つ）
function virtualClock(start = T0) {
  let time = start;
  let seq = 0;
  const timers = new Map();
  const turns = async () => {
    for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 2));
  };
  return {
    now: () => time,
    setTimer: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { due: time + Math.max(0, Number(ms) || 0), fn });
      return id;
    },
    clearTimer: (id) => { timers.delete(id); },
    async advance(ms) {
      const end = time + ms;
      // 動いている処理が、今の時刻のうちにタイマーを置き終えるのを待つ
      await turns();
      for (;;) {
        const [entry] = [...timers.entries()].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due || a[0] - b[0]);
        if (!entry) break;
        timers.delete(entry[0]);
        time = Math.max(time, entry[1].due);
        entry[1].fn();
        await turns();
      }
      time = end;
      await turns();
    },
  };
}

// サーバーの稼働（server-state.mjs の check の形）。state を running・grace・stopped に変えて使う
function fakeServer(state = 'running') {
  const server = { state, checks: 0 };
  server.check = async () => {
    server.checks++;
    return { state: server.state, active: ['running', 'grace'].includes(server.state), source: 'serversync', pid: null, serverState: '', stoppedFor: null, reasons: [] };
  };
  return server;
}

// 見張り（createOwnedStore の watch の形）。update の対象を残し、settle で一式を書き終えた知らせを送る
function fakeWatch() {
  const watch = { updates: [], callbacks: null };
  watch.factory = (callbacks) => {
    watch.callbacks = callbacks;
    return { update: (targets) => watch.updates.push(targets.map((target) => target.worldId)), stop: () => watch.updates.push([]) };
  };
  watch.settle = (worldId = W) => watch.callbacks?.onSettled({ worldId, changed: ['Level.sav'], firstAt: null, lastAt: null, reason: 'quiet' });
  return watch;
}

// 1 台の常駐（KV は kvFile。同じ kvFile で作り直すと再起動）
function agentOf({ gas, clock, site, kvFile = path.join(site.dataDir, 'test', 'state.json'), server = fakeServer(), current, uploadLimit, env = 'test', kvFs }) {
  const pc = { current, reads: [], watch: fakeWatch(), server, log: memoryLog(), clock, site, kvFile };
  pc.kv = createKvStorage({ file: kvFile, setTimer: clock.setTimer, clearTimer: clock.clearTimer, ...(kvFs ? { fs: kvFs } : {}) });
  pc.agent = createAgent({
    config: { env, userId: 'サーバー', passcode: PASS, apiUrl: 'local', envDir: path.dirname(kvFile), worldName: '', autoRegister: true },
    world: { worldId: W, worldDir: site.worldDir }, storage: pc.kv, log: pc.log.logger, monitor: server, api: gas.api,
    // current が null の間は、保存の途中で読めなかったことにする。importGate（Promise）を置くと、解析がそれを待つ（読み込みの途中に別の処理を動かす）
    runImport: async (files) => {
      pc.reads.push(files.map((file) => file.path).sort());
      const current = pc.current;
      await pc.importGate;
      if (!current) throw new Error('Level.sav を読めませんでした（テスト）');
      return current;
    },
    watch: pc.watch.factory, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    ...(uploadLimit ? { uploadLimit } : {}),
  });
  // 次のセーブ（30 秒後に保存した中身）。ファイルの更新日時を進め、見張りの知らせで読む
  pc.save = async ({ minutes, day = 10, eggs = [], players = [U1] }) => {
    await clock.advance(30_000);
    pc.current = snapshotOf({ seconds: (clock.now() - T0) / 1000, minutes, day, eggs, players });
    site.save(clock.now());
    pc.watch.settle();
    await pc.agent.settle();
  };
  pc.start = async ({ minutes, day = 10, eggs = [], players = [U1] }) => {
    pc.current = snapshotOf({ seconds: (clock.now() - T0) / 1000, minutes, day, eggs, players });
    site.save(clock.now());
    assert.equal(await pc.agent.login(), 'ok');
    await pc.agent.tick();
    await pc.agent.settle();
  };
  pc.presence = () => gas.writes('presence').at(-1)?.request.presence;
  return pc;
}

const FARMS_KEY = `pal-note.autoBreeding.farms.test.${W}`;
const playersOf = (world) => Object.fromEntries((world?.players ?? []).map((player) => [player.uid, player.instanceId]));

test('常駐（結合）: ログイン → attach → 共有と presence → Players が増えたら読み直す → 新しいタマゴを判定の後に登録 → 止まったら最後に送って presence だけ', async (t) => {
  const clock = virtualClock();
  const gas = await gasOf({ now: clock.now });
  const site = serverWorld(t);
  const pc = agentOf({ gas, clock, site });
  // ログインして、サーバーが動いているので読む（attach）。最初の共有は new
  await pc.start({ minutes: 100 });
  assert.equal(pc.agent.attached(), true);
  assert.deepEqual(pc.reads, [['LevelMeta.sav', 'Level.sav', `Players/${U1}.sav`, `Players/${U1}_dps.sav`].sort()]);
  assert.deepEqual([pc.agent.owned.state.upload.status, pc.agent.owned.state.upload.result], ['done', 'new']);
  let world = await gas.published();
  assert.deepEqual([world.uploadedBy, world.saveKind, world.hostName, world.clock], ['サーバー', 'server', '', clockAt(100)]);
  assert.deepEqual(playersOf(world), { [U1]: instanceOf(U1) });
  assert.deepEqual(pc.watch.updates.at(-1), [W]);
  // presence は常駐が送る（role host・resident・読めている）。owned.js が ownedSince に載せる presence は送らない
  assert.equal(await pc.agent.sendPresence(), 'sent');
  assert.deepEqual(
    (({ role, resident, canShare, playing, user }) => ({ role, resident, canShare, playing, user }))(pc.presence()),
    { role: 'host', resident: true, canShare: true, playing: false, user: 'サーバー' },
  );
  assert.equal(gas.writes('presence').length, 1);
  assert.equal(await pc.agent.sendPresence(), 'skipped');
  // owned.js が共有の読み直し（ownedSince）に載せる presence は送らない
  await clock.advance(20_000);
  await pc.agent.owned.fetchShared();
  assert.ok(gas.control.calls.includes('ownedSince'));
  assert.equal(gas.control.sincePresence, 0);

  // 新しく参加した人の Players のファイル: 10 秒ごとの見直しで登録に足して読み直す
  site.addPlayer(U2);
  await clock.advance(30_000);
  pc.current = snapshotOf({ seconds: 30, minutes: 101, day: 10, players: [U1, U2] });
  site.save(clock.now());
  await pc.agent.tick();
  await pc.agent.settle();
  assert.ok(pc.reads.at(-1).includes(`Players/${U2}.sav`) && pc.reads.at(-1).includes(`Players/${U2}_dps.sav`));
  world = await gas.published();
  assert.deepEqual(playersOf(world), { [U1]: instanceOf(U1), [U2]: instanceOf(U2) });

  // 牧場に新しいタマゴ: 共有の結果（mine）の判定の後に登録する。前からあるタマゴは登録し直さない
  await pc.save({ minutes: 102, eggs: ['GuardianDog'], players: [U1, U2] });
  assert.deepEqual(registered(pc.agent.store), [SHEEP]);
  await pc.save({ minutes: 103, eggs: ['GuardianDog'], players: [U1, U2] });
  await pc.save({ minutes: 104, eggs: ['GuardianDog'], players: [U1, U2] });
  assert.deepEqual(registered(pc.agent.store), [SHEEP]);
  // 保存が続いている（サーバーが動いている）ので playing
  assert.equal(await pc.agent.sendPresence(), 'sent');
  assert.equal(pc.presence().playing, true);

  // 止まった: 猶予の間の最後の保存は読んで送る
  pc.server.state = 'grace';
  await pc.agent.tick();
  await pc.save({ minutes: 105, eggs: ['GuardianDog'], players: [U1, U2] });
  const uploads = gas.writes('ownedUpload').length;
  // 猶予の間はまだ読むが、サーバーは止まっているので playing ではない
  assert.equal(await pc.agent.sendPresence(), 'sent');
  assert.deepEqual([pc.presence().playing, pc.presence().canShare], [false, true]);
  assert.equal((await gas.published()).clock, clockAt(105));
  // 猶予の後: 見張りを止め（update([])）、読み込みも共有も自動登録もしない
  pc.server.state = 'stopped';
  await pc.agent.tick();
  assert.equal(pc.agent.attached(), false);
  assert.deepEqual(pc.watch.updates.at(-1), []);
  assert.match(pc.log.text(), /detached lastUpload="sent"/);
  const reads = pc.reads.length;
  await clock.advance(30_000);
  site.save(clock.now());
  pc.watch.settle();
  await pc.agent.tick();
  await pc.agent.settle();
  await clock.advance(10 * 60_000);
  assert.deepEqual([pc.reads.length, gas.writes('ownedUpload').length], [reads, uploads]);
  // 共有を求められても送らない（owned.js の再試行の段に入らない code）
  assert.equal(await pc.agent.owned.uploadLocal({ force: true }), 'error');
  assert.equal(pc.agent.owned.state.upload.error, 'サーバーが止まっているため共有しません');
  assert.equal(gas.writes('ownedUpload').length, uploads);
  // presence だけは送る（playing false・読めていない）
  assert.equal(await pc.agent.sendPresence(), 'sent');
  assert.deepEqual(
    (({ role, resident, canShare, playing }) => ({ role, resident, canShare, playing }))(pc.presence()),
    { role: 'host', resident: true, canShare: false, playing: false },
  );
  const device = pc.presence().device;

  // KV のファイル（再起動で残すもの）にパスワードがない。ログにも出ない
  await pc.agent.close();
  const saved = fs.readFileSync(pc.kvFile, 'utf8');
  assert.ok(!saved.includes(PASS));
  assert.ok(saved.includes(`pal-note.agent.lineage.test.${W}`) && saved.includes(`pal-note.autoBreeding.farms.test.${W}`));
  assert.ok(!pc.log.text().includes(PASS));

  // 止まっている間に常駐を再起動した: 読まず・共有せず、presence だけ（同じ PC の ID）
  const restarted = agentOf({ gas, clock, site, server: fakeServer('stopped') });
  const before = gas.writes().length;
  assert.equal(await restarted.agent.login(), 'ok');
  await restarted.agent.tick();
  await restarted.agent.settle();
  assert.equal(await restarted.agent.sendPresence(), 'sent');
  assert.deepEqual(restarted.reads, []);
  assert.deepEqual(gas.writes().slice(before).map((item) => item.action), ['presence']);
  assert.deepEqual(
    (({ role, resident, canShare, playing, device: id }) => ({ role, resident, canShare, playing, device: id }))(restarted.presence()),
    { role: 'host', resident: true, canShare: false, playing: false, device },
  );
  // また動いたら読んで送る
  restarted.server.state = 'running';
  await clock.advance(30_000);
  restarted.current = snapshotOf({ seconds: (clock.now() - T0) / 1000, minutes: 106, day: 10, eggs: ['GuardianDog'], players: [U1, U2] });
  site.save(clock.now());
  await restarted.agent.tick();
  await restarted.agent.settle();
  assert.equal(restarted.reads.length, 1);
  assert.deepEqual([restarted.agent.owned.state.upload.status, (await gas.published()).clock], ['done', clockAt(106)]);
  assert.equal(gas.writes('create').length, 1);
  await restarted.agent.close();
});

test('常駐（結合）: 最後の保存の送信は最大 60 秒だけ待ち、送れなくても読み込みと共有を止める。送れなかった分は次に動いたときに送る', async (t) => {
  const clock = virtualClock();
  const gas = await gasOf({ now: clock.now });
  const site = serverWorld(t);
  const pc = agentOf({ gas, clock, site });
  await pc.start({ minutes: 100 });
  pc.server.state = 'grace';
  gas.control.fail.ownedUpload = 'CONNECTION';
  await pc.save({ minutes: 101 });
  assert.equal(pc.agent.owned.state.upload.status, 'error');
  pc.server.state = 'stopped';
  const detaching = pc.agent.tick();
  let finished = false;
  detaching.then(() => { finished = true; });
  const startedAt = clock.now();
  for (let i = 0; i < 30 && !finished; i++) await clock.advance(5_000);
  assert.equal(finished, true);
  assert.ok(clock.now() - startedAt <= 75_000);
  assert.equal(pc.agent.attached(), false);
  assert.match(pc.log.text(), /detached lastUpload="(timeout|error:CONNECTION)"/);
  // 止まった後は送り直さない（owned.js の再試行の予約は、次に動いたときまで預かる）
  const attempts = gas.control.calls.filter((action) => action === 'ownedUpload').length;
  await clock.advance(30 * 60_000);
  assert.equal(gas.control.calls.filter((action) => action === 'ownedUpload').length, attempts);
  // 次に動いたとき: 預かった予約と読み込みで送る
  gas.control.fail.ownedUpload = '';
  pc.server.state = 'running';
  await clock.advance(30_000);
  pc.current = snapshotOf({ seconds: (clock.now() - T0) / 1000, minutes: 102, day: 10 });
  site.save(clock.now());
  await pc.agent.tick();
  await pc.agent.settle();
  await clock.advance(30_000);
  await pc.agent.settle();
  assert.deepEqual([pc.agent.owned.state.upload.status, (await gas.published()).clock], ['done', clockAt(102)]);

  // 最後の送信が 1 回失敗しても、60 秒の中で送り直して送れたら、それで止める
  pc.server.state = 'grace';
  gas.control.fail.ownedUpload = 'CONNECTION';
  await pc.save({ minutes: 103 });
  pc.server.state = 'stopped';
  const before = gas.control.calls.filter((action) => action === 'ownedUpload').length;
  const again = pc.agent.tick();
  let stopped = false;
  again.then(() => { stopped = true; });
  for (let i = 0; i < 100 && gas.control.calls.filter((action) => action === 'ownedUpload').length < before + 2; i++) await clock.advance(0);
  assert.equal(stopped, false);
  gas.control.fail.ownedUpload = '';
  for (let i = 0; i < 30 && !stopped; i++) await clock.advance(5_000);
  assert.equal(stopped, true);
  assert.match(pc.log.text(), /detached lastUpload="sent"/);
  assert.equal((await gas.published()).clock, clockAt(103));
  await pc.agent.close();
});

test('常駐（結合）: 止まった後の最後の送信で決まった候補は、止まっている間は登録せず、次に動いたときに登録する', async (t) => {
  const clock = virtualClock();
  const gas = await gasOf({ now: clock.now });
  const site = serverWorld(t);
  const pc = agentOf({ gas, clock, site });
  await pc.start({ minutes: 100 });
  pc.server.state = 'grace';
  // 新しいタマゴのセーブを読み、共有を送っている途中で止まる
  let release;
  gas.control.gates.ownedUpload = new Promise((resolve) => { release = resolve; });
  await clock.advance(30_000);
  pc.current = snapshotOf({ seconds: (clock.now() - T0) / 1000, minutes: 101, day: 10, eggs: ['GuardianDog'] });
  site.save(clock.now());
  pc.watch.settle();
  for (let i = 0; i < 200 && gas.writes('ownedUpload').length < 2; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(gas.writes('ownedUpload').length, 2);
  pc.server.state = 'stopped';
  const detaching = pc.agent.tick();
  await clock.advance(0);
  release();
  gas.control.gates.ownedUpload = null;
  await detaching;
  await pc.agent.settle();
  // 共有は載った（mine）が、止まっているので登録しない
  assert.equal((await gas.published()).clock, clockAt(101));
  assert.deepEqual(gas.writes('create'), []);
  // 次に動いたとき: 決まっていた候補を登録する
  pc.server.state = 'running';
  await clock.advance(30_000);
  pc.current = snapshotOf({ seconds: (clock.now() - T0) / 1000, minutes: 102, day: 10, eggs: ['GuardianDog'] });
  site.save(clock.now());
  await pc.agent.tick();
  await pc.agent.settle();
  assert.deepEqual(registered(pc.agent.store), [SHEEP]);
  await pc.agent.close();
});

test('常駐（結合）: 止まっている間に来た読み直しの予約は、動いたときまで預かる。動いている間は 5 分ごとに配合の全件を読み直す', async (t) => {
  const clock = virtualClock();
  const gas = await gasOf({ now: clock.now });
  const site = serverWorld(t);
  const pc = agentOf({ gas, clock, site });
  await pc.start({ minutes: 100 });
  const snapshots = () => gas.control.calls.filter((action) => action === 'snapshot').length;
  const first = snapshots();
  await clock.advance(60_000);
  await pc.agent.tick();
  assert.equal(snapshots(), first);
  await clock.advance(4 * 60_000);
  await pc.agent.tick();
  assert.equal(snapshots(), first + 1);
  // 保存の途中で読めなかった（読み直しを 1 秒後に予約した）ところで止まった
  pc.server.state = 'grace';
  await clock.advance(30_000);
  site.save(clock.now());
  const original = pc.current;
  pc.current = null;
  pc.watch.settle();
  await pc.agent.settle();
  const reads = pc.reads.length;
  pc.current = original;
  pc.server.state = 'stopped';
  await pc.agent.tick();
  assert.equal(pc.agent.attached(), false);
  await clock.advance(10 * 60_000);
  assert.equal(pc.reads.length, reads);
  assert.equal(snapshots(), first + 1);
  // 動いたら読む
  pc.server.state = 'running';
  await pc.agent.tick();
  await pc.agent.settle();
  assert.ok(pc.reads.length > reads);
  await pc.agent.close();
});

test('常駐（結合）: サーバーが動いているか決められない（unknown）間は読まず、共有も自動登録もしない', async (t) => {
  const clock = virtualClock();
  const gas = await gasOf({ now: clock.now });
  const site = serverWorld(t);
  const pc = agentOf({ gas, clock, site, server: fakeServer('unknown') });
  pc.current = snapshotOf({ seconds: 0, minutes: 100, day: 10, eggs: ['GuardianDog'] });
  assert.equal(await pc.agent.login(), 'ok');
  await pc.agent.tick();
  await pc.agent.settle();
  assert.equal(pc.agent.attached(), false);
  assert.deepEqual([pc.reads, gas.writes('ownedUpload'), gas.writes('create')], [[], [], []]);
  await pc.agent.close();
});

test('常駐（結合）: Level.sav・LevelMeta.sav がまだないワールドは登録せずに待ち、できたら読む', async (t) => {
  const clock = virtualClock();
  const gas = await gasOf({ now: clock.now });
  const site = serverWorld(t);
  fs.rmSync(path.join(site.worldDir, 'Level.sav'));
  const pc = agentOf({ gas, clock, site });
  pc.current = snapshotOf({ seconds: 0, minutes: 100, day: 10 });
  assert.equal(await pc.agent.login(), 'ok');
  await pc.agent.tick();
  await pc.agent.tick();
  assert.equal(pc.agent.attached(), false);
  assert.equal(pc.agent.source.worlds().length, 0);
  assert.equal(pc.log.text().match(/attach-waiting/g).length, 1);
  fs.writeFileSync(path.join(site.worldDir, 'Level.sav'), 'x');
  site.save(clock.now());
  await pc.agent.tick();
  await pc.agent.settle();
  assert.equal(pc.agent.attached(), true);
  assert.deepEqual([pc.reads.length, pc.agent.owned.state.upload.status], [1, 'done']);
  await pc.agent.close();
});

test('常駐（結合）: 公開の値を読めずに判定待ちのまま送れなかったセーブは、読めるようになったら判定して送る', async (t) => {
  const clock = virtualClock();
  const gas = await gasOf({ now: clock.now });
  const site = serverWorld(t);
  const pc = agentOf({ gas, clock, site });
  await pc.start({ minutes: 100 });
  gas.control.fail.ownedWorlds = 'CONNECTION';
  await pc.save({ minutes: 101 });
  assert.match(pc.agent.owned.state.upload.error, /照らせていない/);
  // 読めない間は 30 秒ごとに試し直すだけ
  await clock.advance(10_000);
  await pc.agent.tick();
  assert.equal(pc.agent.owned.state.upload.status, 'error');
  gas.control.fail.ownedWorlds = '';
  await clock.advance(10_000);
  await pc.agent.tick();
  await pc.agent.settle();
  assert.equal(pc.agent.owned.state.upload.status, 'error');
  await clock.advance(20_000);
  await pc.agent.tick();
  await pc.agent.settle();
  assert.deepEqual([pc.agent.owned.state.upload.status, (await gas.published()).clock], ['done', clockAt(101)]);
  await pc.agent.close();
});

test('常駐（結合）: 応答の env が設定と違えば、何も書かずに終了コード 2 で止まる（KV のファイルも作らない）', async (t) => {
  const clock = virtualClock();
  const gas = await gasOf({ now: clock.now });
  gas.control.env = 'prod';
  const site = serverWorld(t);
  const pc = agentOf({ gas, clock, site });
  pc.current = snapshotOf({ seconds: 0, minutes: 100, day: 10 });
  assert.equal(await pc.agent.start(), 2);
  assert.deepEqual(gas.writes(), []);
  assert.deepEqual(pc.reads, []);
  assert.equal(pc.agent.store.state.passcode, '');
  assert.equal(fs.existsSync(pc.kvFile), false);
  assert.match(pc.log.text(), /env-mismatch expected="test" got="prod"/);
  assert.ok(!pc.log.text().includes(PASS));
});

test('常駐（結合）: ログインの後の応答で env が設定と違うと分かったら、それ以後は何も送らずに終了コード 2 で止まる', async (t) => {
  const clock = virtualClock();
  const gas = await gasOf({ now: clock.now });
  const site = serverWorld(t);
  const pc = agentOf({ gas, clock, site });
  await pc.start({ minutes: 100 });
  assert.equal((await gas.published()).clock, clockAt(100));
  // 共有の読み直し（読み取り）の応答が prod になった
  gas.control.env = 'prod';
  await pc.agent.owned.fetchShared({ force: true }).catch(() => {});
  const calls = gas.control.calls.length;
  // それ以後は、新しいセーブを読んでも共有せず、presence も送らない（GAS に何も届かない）
  await pc.save({ minutes: 101 });
  assert.equal(await pc.agent.sendPresence({ force: true }), 'skipped');
  assert.equal(await pc.agent.start(), 2);
  assert.equal(gas.control.calls.length, calls);
  assert.match(pc.log.text(), /env-mismatch expected="test" got="prod"/);
  assert.equal(pc.agent.store.state.passcode, '');
  assert.ok(!pc.log.text().includes(PASS));
});

test('常駐: ログインの失敗は、認証なら 30 分ごと・通信なら 15 秒〜5 分の段で試し直す。認証が外れたら 30 分後にログインし直す', async (t) => {
  const clock = virtualClock();
  const gas = await gasOf({ now: clock.now });
  const site = serverWorld(t);
  const pc = agentOf({ gas, clock, site, server: fakeServer('stopped') });
  const logins = () => gas.control.calls.filter((action) => action === 'login').length;
  gas.control.fail.login = 'CONNECTION';
  await pc.agent.tick();
  // createApi は通信の失敗を 1 回だけ送り直す
  assert.equal(logins(), 2);
  for (const [index, step] of [15, 30, 60, 120, 300, 300].entries()) {
    await clock.advance(step * 1000 - 1000);
    await pc.agent.tick();
    assert.equal(logins(), 2 + 2 * index, `${step} 秒の前は試さない`);
    await clock.advance(1000);
    await pc.agent.tick();
  }
  assert.equal(logins(), 14);
  gas.control.fail.login = 'AUTH';
  await clock.advance(300_000);
  await pc.agent.tick();
  assert.equal(logins(), 15);
  await clock.advance(29 * 60_000);
  await pc.agent.tick();
  assert.equal(logins(), 15);
  gas.control.fail.login = '';
  await clock.advance(60_000);
  await pc.agent.tick();
  assert.equal(logins(), 16);
  assert.equal(await pc.agent.sendPresence(), 'sent');
  // ログイン中に認証が外れた（パスワードの変更）: ログアウトし、30 分後にログインし直す
  gas.control.fail.presence = 'AUTH';
  await clock.advance(60_000);
  assert.equal(await pc.agent.sendPresence(), 'error');
  assert.equal(pc.agent.store.state.passcode, '');
  gas.control.fail.presence = '';
  await pc.agent.tick();
  assert.equal(logins(), 16);
  await clock.advance(30 * 60_000);
  await pc.agent.tick();
  assert.equal(logins(), 17);
  assert.match(pc.log.text(), /logged-out/);
  await pc.agent.close();
});

test('常駐: stop.request で、KV を書き出して 0 で終わる', async (t) => {
  const clock = virtualClock();
  const gas = await gasOf({ now: clock.now });
  const site = serverWorld(t);
  const pc = agentOf({ gas, clock, site, server: fakeServer('stopped') });
  pc.current = snapshotOf({ seconds: 0, minutes: 100, day: 10 });
  const done = pc.agent.start();
  await clock.advance(10_000);
  assert.equal(pc.agent.store.state.env, 'test');
  fs.mkdirSync(path.dirname(pc.kvFile), { recursive: true });
  fs.writeFileSync(path.join(path.dirname(pc.kvFile), 'stop.request'), '');
  await clock.advance(2_000);
  assert.equal(await done, 0);
  assert.equal(fs.existsSync(path.join(path.dirname(pc.kvFile), 'stop.request')), false);
  assert.match(pc.log.text(), /stop-requested/);
  assert.ok(fs.existsSync(pc.kvFile));
});

test('常駐: --once は、読み込み・共有が落ち着くのを待ちきれなければ 1 で終わる', async (t) => {
  const clock = virtualClock();
  const gas = await gasOf({ now: clock.now });
  const site = serverWorld(t);
  const pc = agentOf({ gas, clock, site });
  pc.current = snapshotOf({ seconds: 0, minutes: 100, day: 10 });
  // 解析が終わらない
  pc.importGate = new Promise(() => {});
  assert.equal(await pc.agent.runOnce({ timeoutMs: 200 }), 1);
  assert.match(pc.log.text(), /once-timeout/);
});

test('常駐: 止めるときに状態のファイル（state.json）を保存できなければ、ログに出して終了コード 2 にする（正常な終了にしない）', async (t) => {
  const clock = virtualClock();
  const gas = await gasOf({ now: clock.now });
  const site = serverWorld(t);
  // rename がいつも失敗する（やり直さない失敗）
  const kvFs = {
    readFileSync: fs.readFileSync, renameSync: fs.renameSync,
    promises: { mkdir: fs.promises.mkdir, writeFile: fs.promises.writeFile, rename: async () => { throw Object.assign(new Error('EIO（テスト）'), { code: 'EIO' }); } },
  };
  const pc = agentOf({ gas, clock, site, server: fakeServer('stopped'), kvFs });
  const done = pc.agent.start();
  await clock.advance(10_000);
  assert.equal(pc.kv.pending(), true);
  fs.mkdirSync(path.dirname(pc.kvFile), { recursive: true });
  fs.writeFileSync(path.join(path.dirname(pc.kvFile), 'stop.request'), '');
  await clock.advance(2_000);
  assert.equal(await done, 2);
  assert.match(pc.log.text(), /kv-unsaved/);
  assert.match(pc.log.text(), /stopped code=2/);
});

test('常駐（2 台）: A が止まって B が建てる引き継ぎ。共有は新しい方・自動登録は重ならない・全員の InstanceId は同じ・古いワールドの A は止める', async (t) => {
  const clock = virtualClock();
  const gas = await gasOf({ now: clock.now });
  const siteA = serverWorld(t, { players: [U1, U2] });
  const siteB = serverWorld(t, { players: [U1, U2] });
  const players = [U1, U2];
  const a = agentOf({ gas, clock, site: siteA });
  const b = agentOf({ gas, clock, site: siteB, server: fakeServer('stopped') });
  // B の常駐も動いている（サーバーは止まっている）
  assert.equal(await b.agent.login(), 'ok');
  await b.agent.tick();
  // A のサーバーで遊ぶ: 共有し、牧場の新しいタマゴを登録する
  await a.start({ minutes: 100, players });
  await a.save({ minutes: 101, eggs: ['GuardianDog'], players });
  assert.deepEqual(registered(a.agent.store), [SHEEP]);
  const beforeHandoff = await gas.published();
  assert.deepEqual(playersOf(beforeHandoff), { [U1]: instanceOf(U1), [U2]: instanceOf(U2) });
  // A を止める（ServerSync の共有で、B の PC が同じワールドを受け取る）
  a.server.state = 'stopped';
  await a.agent.tick();
  assert.equal(a.agent.attached(), false);
  // B が建てる: 受け取ったワールドの続き。前の共有より新しい系統なので共有し（newer）、前からあるタマゴは登録し直さない
  b.server.state = 'running';
  await clock.advance(60_000);
  b.current = snapshotOf({ seconds: (clock.now() - T0) / 1000, minutes: 102, day: 10, eggs: ['GuardianDog'], players });
  siteB.save(clock.now());
  await b.agent.tick();
  await b.agent.settle();
  assert.deepEqual([b.agent.owned.state.upload.status, b.agent.owned.state.upload.result], ['done', 'newer']);
  await b.agent.store.refresh();
  assert.deepEqual(registered(b.agent.store), [SHEEP]);
  // B のサーバーで同じ親の新しいタマゴ: A が登録した配合と同じなので、B は送らずに候補を終える（重ならない）
  await b.save({ minutes: 103, eggs: ['GuardianDog', 'GuardianDog'], players });
  await b.save({ minutes: 104, eggs: ['GuardianDog', 'GuardianDog'], players });
  assert.equal(gas.writes('create').length, 1);
  assert.deepEqual(registered(b.agent.store), [SHEEP]);
  assert.deepEqual(JSON.parse(b.kv.getItem(FARMS_KEY)).pending, []);
  // B の自動登録は最後のセーブまで取り込んでいる（止まっていたのではない）
  assert.equal(JSON.parse(b.kv.getItem(FARMS_KEY)).saveStamp, b.current.world.savedAtTicks);
  const afterHandoff = await gas.published();
  assert.equal(afterHandoff.clock, clockAt(104));
  assert.deepEqual(playersOf(afterHandoff), playersOf(beforeHandoff));
  // B を止めた後、A の PC で古いインスタンス（引き継ぐ前のワールド）を起動した: 新しい共有を古い中身で上書きせず、自動登録もしない
  b.server.state = 'stopped';
  await b.agent.tick();
  a.server.state = 'running';
  await clock.advance(60_000);
  a.current = snapshotOf({ seconds: (clock.now() - T0) / 1000, minutes: 101, day: 10, eggs: ['GuardianDog', 'GuardianDog', 'GuardianDog'], players });
  siteA.save(clock.now());
  await a.agent.tick();
  await a.agent.settle();
  await a.save({ minutes: 102, eggs: ['GuardianDog', 'GuardianDog', 'GuardianDog', 'GuardianDog'], players });
  assert.match(a.agent.owned.state.upload.error, /古い系統/);
  assert.equal(a.agent.guard.status(W).state, 'blocked');
  assert.deepEqual([(await gas.published()).uploadedAt, (await gas.published()).clock], [afterHandoff.uploadedAt, clockAt(104)]);
  assert.equal(gas.writes('create').length, 1);
  // 受け入れ（accept.request。書いた時刻が入る）: 今のセーブを基準にし、牧場の記録だけから始める
  fs.mkdirSync(path.dirname(a.kvFile), { recursive: true });
  fs.writeFileSync(path.join(path.dirname(a.kvFile), 'accept.request'), new Date(clock.now()).toISOString());
  await a.agent.checkRequests();
  await a.agent.settle();
  assert.equal(fs.existsSync(path.join(path.dirname(a.kvFile), 'accept.request')), false);
  assert.equal(a.agent.guard.status(W).state === 'blocked', false);
  assert.equal((await gas.published()).clock, clockAt(102));
  assert.equal(gas.writes('create').length, 1);
  await a.agent.close();
  await b.agent.close();
});

// 期限まで仮の時計を進める（done が真になるか、回数の上限まで）
async function advanceUntil(clock, done, { step = 5_000, times = 30 } = {}) {
  for (let i = 0; i < times && !done(); i++) await clock.advance(step);
}
const realTurns = async (n = 20) => {
  for (let i = 0; i < n; i++) await new Promise((resolve) => setTimeout(resolve, 2));
};

test('常駐（結合）: 動いている常駐の受け入れは、読み込んだセーブを基準にする（ディスクに次の保存が出ていても、受け入れの直後に止まらない）', async (t) => {
  const clock = virtualClock();
  const gas = await gasOf({ now: clock.now });
  const site = serverWorld(t);
  const pc = agentOf({ gas, clock, site });
  await pc.start({ minutes: 100 });
  // 協力プレイで進めた続き（通算 200 分）が公開されている
  await clock.advance(60_000);
  const other = agentOf({ gas, clock, site: serverWorld(t) });
  await other.start({ minutes: 200 });
  await other.agent.close();
  // 古いインスタンスのセーブ（150 分）を読むと止まる
  await pc.save({ minutes: 150 });
  assert.equal(pc.agent.guard.status(W).state, 'blocked');
  // サーバーが次の保存（151 分）を書いたが、見張りはまだ読んでいない（5 秒ごとの確認の前）。ここで受け入れる
  await clock.advance(30_000);
  pc.current = snapshotOf({ seconds: (clock.now() - T0) / 1000, minutes: 151, day: 10 });
  site.save(clock.now());
  fs.mkdirSync(path.dirname(pc.kvFile), { recursive: true });
  fs.writeFileSync(path.join(path.dirname(pc.kvFile), 'accept.request'), new Date(clock.now()).toISOString());
  await pc.agent.checkRequests();
  await pc.agent.settle();
  assert.notEqual(pc.agent.guard.status(W).state, 'blocked', '受け入れの直後に止まらない');
  assert.deepEqual([pc.agent.owned.state.upload.status, (await gas.published()).clock], ['done', clockAt(150)]);
  // 次の保存を読んでも止まらずに送る
  pc.watch.settle();
  await pc.agent.settle();
  await clock.advance(30_000);
  await pc.agent.settle();
  assert.notEqual(pc.agent.guard.status(W).state, 'blocked');
  assert.equal((await gas.published()).clock, clockAt(151));
  await pc.agent.close();
});

test('常駐: 古い（10 分より前に書いた）・時刻の読めない accept.request は受け入れずに捨てる（前の起動の残り・試し直しの間に残ったもの）', async (t) => {
  const clock = virtualClock();
  const gas = await gasOf({ now: clock.now });
  const site = serverWorld(t);
  const pc = agentOf({ gas, clock, site });
  await pc.start({ minutes: 100 });
  await clock.advance(60_000);
  const other = agentOf({ gas, clock, site: serverWorld(t) });
  await other.start({ minutes: 200 });
  await other.agent.close();
  await pc.save({ minutes: 150 });
  assert.equal(pc.agent.guard.status(W).state, 'blocked');
  const request = path.join(path.dirname(pc.kvFile), 'accept.request');
  fs.mkdirSync(path.dirname(request), { recursive: true });
  for (const written of [new Date(clock.now() - 11 * 60_000).toISOString(), '', 'not a time']) {
    fs.writeFileSync(request, written);
    await pc.agent.checkRequests();
    await pc.agent.settle();
    assert.equal(fs.existsSync(request), false, `捨てる: ${written}`);
    assert.equal(pc.agent.guard.status(W).state, 'blocked', `受け入れない: ${written}`);
  }
  assert.equal(pc.log.text().match(/accept-expired/g).length, 3);
  // 新しい要求は受け入れる
  fs.writeFileSync(request, new Date(clock.now() - 60_000).toISOString());
  await pc.agent.checkRequests();
  await pc.agent.settle();
  assert.notEqual(pc.agent.guard.status(W).state, 'blocked');
  await pc.agent.close();
});

test('常駐（2 台）: A→B→A の引き継ぎで、A が前に動いていた間に読んだセーブは、判定にも共有にも使わない（読み直してから判定して送る）', async (t) => {
  const clock = virtualClock();
  const gas = await gasOf({ now: clock.now });
  const siteA = serverWorld(t);
  const siteB = serverWorld(t);
  const a = agentOf({ gas, clock, site: siteA });
  const b = agentOf({ gas, clock, site: siteB, server: fakeServer('stopped') });
  assert.equal(await b.agent.login(), 'ok');
  await a.start({ minutes: 100 });
  // A の最後の保存（101 分）は、公開の値を読めずに判定待ちのまま止まる
  a.server.state = 'grace';
  gas.control.fail.ownedWorlds = 'CONNECTION';
  await a.save({ minutes: 101 });
  assert.match(a.agent.owned.state.upload.error, /照らせていない/);
  a.server.state = 'stopped';
  let finished = false;
  a.agent.tick().then(() => { finished = true; });
  await advanceUntil(clock, () => finished);
  assert.equal(a.agent.attached(), false);
  gas.control.fail.ownedWorlds = '';
  await clock.advance(10 * 60_000);
  // B が受け取ったワールドの続き（130 分）で建てて公開する
  b.server.state = 'running';
  b.current = snapshotOf({ seconds: (clock.now() - T0) / 1000, minutes: 130, day: 11 });
  siteB.save(clock.now());
  await b.agent.tick();
  await b.agent.settle();
  assert.equal((await gas.published()).clock, clockAt(130));
  b.server.state = 'stopped';
  await b.agent.tick();
  // A の PC が同期で受け取った続き（140 分）で建てる。解析に時間がかかる間に、10 秒ごとの処理が動く
  a.server.state = 'running';
  await clock.advance(60_000);
  const uploads = gas.writes('ownedUpload').length;
  let release;
  a.importGate = new Promise((resolve) => { release = resolve; });
  a.current = snapshotOf({ seconds: (clock.now() - T0) / 1000, minutes: 140, day: 11 });
  siteA.save(clock.now());
  await a.agent.tick();
  await clock.advance(30_000);
  await a.agent.tick();
  assert.notEqual(a.agent.guard.status(W).state, 'blocked', '読み込みの前の古いセーブで止めない');
  assert.equal(gas.writes('ownedUpload').length, uploads, '読み込みの前の古いセーブを送らない');
  release();
  a.importGate = null;
  await a.agent.settle();
  await clock.advance(30_000);
  await a.agent.settle();
  assert.notEqual(a.agent.guard.status(W).state, 'blocked');
  assert.deepEqual([a.agent.owned.state.upload.status, (await gas.published()).clock], ['done', clockAt(140)]);
  assert.ok(gas.writes('ownedUpload').slice(uploads).every((item) => item.request.world.clock === clockAt(140)));
  await a.agent.close();
  await b.agent.close();
});

test('常駐（2 台）: 止まる前に送れなかった最後の保存の送り直しの予約は、引き継ぎの後に A が動いても古いセーブを送らない', async (t) => {
  const clock = virtualClock();
  const gas = await gasOf({ now: clock.now });
  const siteA = serverWorld(t);
  const siteB = serverWorld(t);
  const a = agentOf({ gas, clock, site: siteA });
  const b = agentOf({ gas, clock, site: siteB, server: fakeServer('stopped') });
  assert.equal(await b.agent.login(), 'ok');
  await a.start({ minutes: 100 });
  a.server.state = 'grace';
  gas.control.fail.ownedUpload = 'CONNECTION';
  await a.save({ minutes: 101 });
  a.server.state = 'stopped';
  let finished = false;
  a.agent.tick().then(() => { finished = true; });
  await advanceUntil(clock, () => finished);
  assert.equal(a.agent.attached(), false);
  gas.control.fail.ownedUpload = '';
  // 止まっている間に送り直しの予約の時刻が来る（預かる）
  await clock.advance(10 * 60_000);
  b.server.state = 'running';
  b.current = snapshotOf({ seconds: (clock.now() - T0) / 1000, minutes: 130, day: 11 });
  siteB.save(clock.now());
  await b.agent.tick();
  await b.agent.settle();
  b.server.state = 'stopped';
  await b.agent.tick();
  // A が受け取った続き（140 分）で建てる: 預かった予約は、読み込みの前の古いセーブ（101 分）を送らない
  a.server.state = 'running';
  await clock.advance(60_000);
  const uploads = gas.writes('ownedUpload').length;
  a.current = snapshotOf({ seconds: (clock.now() - T0) / 1000, minutes: 140, day: 11 });
  siteA.save(clock.now());
  await a.agent.tick();
  await a.agent.settle();
  await clock.advance(30_000);
  await a.agent.settle();
  assert.deepEqual(gas.writes('ownedUpload').slice(uploads).map((item) => item.request.world.clock), [clockAt(140)]);
  assert.notEqual(a.agent.guard.status(W).state, 'blocked');
  assert.equal((await gas.published()).clock, clockAt(140));
  await a.agent.close();
  await b.agent.close();
});

test('常駐（結合）: 最後の送信の期限が過ぎた後に、待っていた古い系統の判定が済んでも送らない', async (t) => {
  const clock = virtualClock();
  const gas = await gasOf({ now: clock.now });
  const site = serverWorld(t);
  const pc = agentOf({ gas, clock, site });
  await pc.start({ minutes: 100 });
  // 猶予の間の保存の共有が、公開の値を読む所（判定）で止まったまま、サーバーが止まる
  pc.server.state = 'grace';
  let release;
  gas.control.gates.ownedWorlds = new Promise((resolve) => { release = resolve; });
  await clock.advance(30_000);
  pc.current = snapshotOf({ seconds: (clock.now() - T0) / 1000, minutes: 101, day: 10 });
  site.save(clock.now());
  pc.watch.settle();
  await realTurns();
  pc.server.state = 'stopped';
  let finished = false;
  pc.agent.tick().then(() => { finished = true; });
  await advanceUntil(clock, () => finished);
  assert.equal(finished, true);
  assert.equal(pc.agent.attached(), false);
  assert.match(pc.log.text(), /detached lastUpload="timeout"/);
  const uploads = gas.writes('ownedUpload').length;
  // 期限の後に公開の値が読めた: 止まっているので送らない
  release();
  gas.control.gates.ownedWorlds = null;
  await realTurns();
  await pc.agent.settle();
  assert.equal(gas.writes('ownedUpload').length, uploads);
  assert.equal((await gas.published()).clock, clockAt(100));
  await pc.agent.close();
});

test('常駐: 送る本文の文字数を測る（GAS の body.length と同じ）。上限を超えるワールドは理由をログに出して送らない', async (t) => {
  // 上限は gas/Main.js の MAX_UPLOAD_CHARS と同じ
  const main = fs.readFileSync(new URL('../../gas/Main.js', import.meta.url), 'utf8');
  const [, expression] = /var MAX_UPLOAD_CHARS = ([^;]+);/.exec(main);
  assert.equal(GAS_MAX_UPLOAD_CHARS, expression.split('*').reduce((product, part) => product * Number(part.trim()), 1));

  // 包んだ api: 測った文字数は送る本文と同じ。上限を超えれば送らずに TOO_LARGE
  const sent = [];
  const inner = { request: async (action, passcode, input) => { sent.push(action); return { action, input }; } };
  const measured = [];
  const limited = withUploadLimit(inner, { limit: 300, onMeasure: (value) => measured.push(value) });
  const small = { userId: 'サーバー', worldId: W, world: {}, saveUpdatedAt: new Date(T0).toISOString(), players: [], bases: [], farms: [], columns: [], rows: [] };
  await limited.request('ownedUpload', PASS, small);
  assert.equal(measured[0].chars, uploadChars(PASS, small));
  assert.equal(measured[0].chars, JSON.stringify({ action: 'ownedUpload', passcode: PASS, ...small }).length);
  const large = { ...small, rows: Array.from({ length: 30 }, () => ['x'.repeat(10)]) };
  await assert.rejects(limited.request('ownedUpload', PASS, large), { code: 'TOO_LARGE' });
  assert.deepEqual([sent, measured[1].refused], [['ownedUpload'], true]);
  await limited.request('ownedWorlds', PASS);
  assert.equal(measured.length, 2);

  // 常駐で: 2,000 体のワールドの本文を測り（上限の内側）、送った本文の文字数と同じ。小さな上限なら送らずにログに理由
  const clock = virtualClock();
  const gas = await gasOf({ now: clock.now });
  const site = serverWorld(t);
  const pc = agentOf({ gas, clock, site });
  pc.current = { ...snapshotOf({ seconds: 0, minutes: 100, day: 10 }), pals: snapshotOf({ seconds: 0, minutes: 100, day: 10, pals: 2000 }).pals };
  site.save(clock.now());
  assert.equal(await pc.agent.login(), 'ok');
  await pc.agent.tick();
  await pc.agent.settle();
  const [upload] = gas.writes('ownedUpload');
  assert.equal(upload.request.rows.length, 2000);
  assert.equal(pc.agent.measured().chars, upload.chars);
  assert.ok(upload.chars > 100_000 && upload.chars < GAS_MAX_UPLOAD_CHARS);
  await pc.agent.close();

  const tight = agentOf({ gas, clock, site: serverWorld(t), uploadLimit: 1000 });
  await tight.start({ minutes: 101 });
  assert.equal(gas.writes('ownedUpload').length, 1);
  assert.equal(tight.agent.owned.state.upload.status, 'error');
  assert.equal(tight.agent.measured().refused, true);
  assert.match(tight.log.text(), /upload-too-large chars=\d+ limit=1000 pals=1 reason="GAS の本文の上限を超えるため共有しません"/);
  await tight.agent.close();
});
