// セーブのファイルの見張り（web/js/save/watch.js。sync-fixes の save-watch）。偽の FileSystemObserver・タイマー・Worker で確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OBSERVE_FILES, observable, createSaveWatcher, createWatchClient } from '../../web/js/save/watch.js';
import { fakeHandle, T0 } from '../helpers/file-handles.js';

const PLAYER = 'Players/00000000000000000000000000000001.sav';
const DPS = 'Players/00000000000000000000000000000001_dps.sav';
const GLOBAL = '../GlobalPalStorage.sav';

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
};

// 仮の時計（setTimeout・setInterval の代わり）。advance で、期限の来たタイマーを早い順に動かす
function virtualClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  const add = (fn, ms, repeat) => {
    const id = ++seq;
    timers.set(id, { due: now + ms, fn, ms, repeat });
    return id;
  };
  return {
    setTimer: (fn, ms) => add(fn, ms, false),
    clearTimer: (id) => { timers.delete(id); },
    every: (fn, ms) => add(fn, ms, true),
    stopEvery: (id) => { timers.delete(id); },
    now: () => now,
    size: () => timers.size,
    async advance(ms) {
      const end = now + ms;
      await flush();
      for (;;) {
        const [entry] = [...timers.entries()].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due || a[0] - b[0]);
        if (!entry) break;
        const [id, timer] = entry;
        now = timer.due;
        if (timer.repeat) timer.due += timer.ms;
        else timers.delete(id);
        timer.fn();
        await flush();
      }
      now = end;
      await flush();
    },
  };
}

// 偽の FileSystemObserver。observe に渡ったハンドルを全部残す（refuse(handle) が true のハンドルは observe で失敗する）
function fakeObserverClass({ refuse = () => false } = {}) {
  class FakeObserver {
    constructor(callback) {
      this.callback = callback;
      this.observed = [];
      this.disconnected = false;
      FakeObserver.instances.push(this);
    }
    async observe(handle) {
      FakeObserver.calls.push(handle);
      if (FakeObserver.refuse(handle)) throw Object.assign(new Error('refused'), { name: 'InvalidStateError' });
      this.observed.push(handle);
    }
    disconnect() { this.disconnected = true; }
    // 通知（Chrome 155 の形: root は observe したハンドル、changedHandle は変わったハンドル）
    notify(type, handle) {
      this.callback([{ type, root: handle, changedHandle: handle, relativePathComponents: [] }], this);
    }
  }
  FakeObserver.instances = [];
  FakeObserver.calls = [];
  FakeObserver.refuse = refuse;
  return FakeObserver;
}

// ホストのワールドの一式（直下の 3 つ・Players の 2 つ・GlobalPalStorage.sav）
function worldFiles(time = T0) {
  return {
    'Level.sav': fakeHandle('Level.sav', { time }),
    'LevelMeta.sav': fakeHandle('LevelMeta.sav', { time }),
    'LocalData.sav': fakeHandle('LocalData.sav', { time }),
    [PLAYER]: fakeHandle('00000000000000000000000000000001.sav', { time }),
    [DPS]: fakeHandle('00000000000000000000000000000001_dps.sav', { time }),
    [GLOBAL]: fakeHandle('GlobalPalStorage.sav', { time }),
  };
}
// owned.js の watchTargets と同じ形（observe は直下のファイルだけ）。observeAll なら呼び出し側の誤りとして全部に observe を付ける
const target = (worldId, files, { host = true, observeAll = false } = {}) => ({
  worldId, host, files: Object.entries(files).map(([path, handle]) => ({ path, handle, observe: observeAll || observable(path) })),
});

function setup({ Observer = fakeObserverClass(), ...options } = {}) {
  const clock = virtualClock();
  const posts = [];
  const watcher = createSaveWatcher({ Observer, post: (message) => posts.push(message), ...clock, ...options });
  return {
    clock, posts, watcher, Observer,
    settled: () => posts.filter((message) => message.type === 'settled'),
    modes: () => posts.filter((message) => message.type === 'mode').map((message) => message.mode),
  };
}

// ゲームの保存（置き換え）。時刻と大きさを変える
const save = (handle, time) => {
  handle.time = time;
  handle.size += 1;
};

test('見張り（save-watch）: Observer に渡してよいのはワールドのフォルダの直下の Level.sav・LevelMeta.sav・LocalData.sav だけ', () => {
  assert.deepEqual([...OBSERVE_FILES], ['Level.sav', 'LevelMeta.sav', 'LocalData.sav']);
  for (const path of OBSERVE_FILES) assert.equal(observable(path), true, path);
  for (const path of [PLAYER, DPS, GLOBAL, 'Players\\00000000000000000000000000000001.sav', 'sub/Level.sav', '..\\Level.sav', 'WorldOption.sav', '', null, undefined]) {
    assert.equal(observable(path), false, String(path));
  }
});

test('見張り（save-watch）: Players・GlobalPalStorage.sav のハンドルは、呼び出し側が誤って observe を付けても Observer に渡さない（5 秒ごとの確認だけ）', async () => {
  const { clock, watcher, Observer, modes, settled } = setup();
  const files = worldFiles();
  await watcher.watch({ generation: 1, targets: [target('W1', files, { observeAll: true })] });
  await flush();
  const passed = Observer.calls;
  assert.deepEqual(passed.map((handle) => handle.name).sort(), ['Level.sav', 'LevelMeta.sav', 'LocalData.sav']);
  for (const path of [PLAYER, DPS, GLOBAL]) assert.ok(!passed.includes(files[path]), path);
  assert.deepEqual(modes(), ['observer']);
  // Players の変化は Worker の 5 秒ごとの確認で拾う（ホストのワールドなので Level.sav が来るまでは maxWait まで待つ）
  save(files[DPS], T0 + 30000);
  await clock.advance(5000);
  assert.deepEqual(settled(), []);
  await clock.advance(10000);
  assert.deepEqual(settled().map(({ changed, reason }) => [changed, reason]), [[[DPS], 'max']]);
  // 張り直しを含めても、Players・GlobalPalStorage.sav は 1 度も渡らない
  Observer.instances[0].notify('disappeared', files['Level.sav']);
  await clock.advance(2000);
  assert.ok(Observer.calls.every((handle) => ['Level.sav', 'LevelMeta.sav', 'LocalData.sav'].includes(handle.name)));
});

test('見張り（save-watch）: 張り直しの getFile()・observe() を待っている間に対象を送り直したら、古い Observer に張らない（張れてしまっても切る。Codex のレビュー）', async () => {
  const { clock, watcher, Observer } = setup();
  const files = worldFiles();
  await watcher.watch({ generation: 1, targets: [target('W1', files)] });
  await flush();
  const old = Observer.instances[0];
  const level = files['Level.sav'];
  const getFile = level.getFile.bind(level);
  // 張り直しの getFile() の途中で、別のワールドに替える
  let release;
  level.getFile = async () => {
    await new Promise((resolve) => { release = resolve; });
    return getFile();
  };
  const before = Observer.calls.length;
  old.notify('disappeared', level);
  await clock.advance(10);
  assert.equal(typeof release, 'function');
  await watcher.watch({ generation: 2, targets: [target('W2', worldFiles(T0 + 1))] });
  release();
  await flush();
  assert.equal(old.disconnected, true);
  assert.ok(!Observer.calls.slice(before).includes(level), '止めた見張りの Level.sav に observe() した');
  // observe() の途中で替えたら、張れた後にその Observer を切る
  const files3 = worldFiles(T0 + 2);
  await watcher.watch({ generation: 3, targets: [target('W3', files3)] });
  await flush();
  const third = Observer.instances.at(-1);
  let disconnects = 0;
  third.disconnect = () => { disconnects++; third.disconnected = true; };
  let finish;
  third.observe = (handle) => new Promise((resolve) => {
    finish = () => { third.observed.push(handle); resolve(); };
  });
  third.notify('disappeared', files3['Level.sav']);
  await clock.advance(10);
  assert.equal(typeof finish, 'function');
  await watcher.watch({ generation: 4, targets: [target('W4', worldFiles(T0 + 3))] });
  assert.equal(disconnects, 1);
  finish();
  await flush();
  assert.equal(disconnects, 2, '張れた後に古い Observer を切っていない');
});

test('見張り（save-watch）: 画面側の対象（observe は直下だけ）でも Players を Observer に渡さず、ワールドごとに 1 つの Observer', async () => {
  const { watcher, Observer } = setup();
  const a = worldFiles();
  const b = { 'Level.sav': fakeHandle('Level.sav'), 'LocalData.sav': fakeHandle('LocalData.sav') };
  await watcher.watch({ generation: 1, targets: [target('W1', a), target('W2', b)] });
  await flush();
  assert.equal(Observer.instances.length, 2);
  assert.deepEqual(Observer.instances.map((observer) => observer.observed.map((handle) => handle.name)), [['Level.sav', 'LevelMeta.sav', 'LocalData.sav'], ['Level.sav', 'LocalData.sav']]);
  assert.ok(!Observer.calls.some((handle) => [a[PLAYER], a[DPS], a[GLOBAL]].includes(handle)));
});

test('見張り（save-watch）: ホストのワールドは LocalData.sav だけでは quiet を数えず、Level.sav が来たら 1 秒で settled（Players は見直しで拾う）', async () => {
  const { clock, watcher, Observer, settled } = setup();
  const files = worldFiles();
  await watcher.watch({ generation: 3, targets: [target('W1', files)] });
  await flush();
  const [observer] = Observer.instances;
  // LocalData.sav が先に書かれる（P0: Level.sav まで最大 2.74 秒）
  save(files['LocalData.sav'], T0 + 30000);
  observer.notify('disappeared', files['LocalData.sav']);
  await clock.advance(2500);
  assert.deepEqual(settled(), []);
  // Level.sav → LevelMeta.sav → Players が数 ms でそろう
  save(files['Level.sav'], T0 + 32500);
  observer.notify('disappeared', files['Level.sav']);
  save(files['LevelMeta.sav'], T0 + 32502);
  observer.notify('disappeared', files['LevelMeta.sav']);
  save(files[PLAYER], T0 + 32503);
  save(files[DPS], T0 + 32504);
  await clock.advance(900);
  assert.deepEqual(settled(), []);
  await clock.advance(200);
  const [message] = settled();
  assert.deepEqual(message, {
    type: 'settled', generation: 3, worldId: 'W1', changed: ['Level.sav', 'LevelMeta.sav', 'LocalData.sav', PLAYER, DPS],
    firstAt: T0 + 30000, lastAt: T0 + 32504, reason: 'quiet',
  });
  // 書き終えた後は何も知らせない（印は今のものが基準になる）
  await clock.advance(20000);
  assert.equal(settled().length, 1);
});

test('見張り（save-watch）: ホストのワールドで Level.sav が来なければ maxWait（最初の変化から 10 秒）で settled、ホストでないワールドは最後の変化から 1 秒', async () => {
  const host = setup();
  const files = worldFiles();
  await host.watcher.watch({ generation: 1, targets: [target('W1', files)] });
  await flush();
  save(files['LocalData.sav'], T0 + 30000);
  host.Observer.instances[0].notify('disappeared', files['LocalData.sav']);
  await host.clock.advance(9900);
  assert.deepEqual(host.settled(), []);
  await host.clock.advance(200);
  assert.deepEqual(host.settled().map(({ changed, reason }) => [changed, reason]), [[['LocalData.sav'], 'max']]);

  const guest = setup();
  const local = { 'LocalData.sav': fakeHandle('LocalData.sav') };
  await guest.watcher.watch({ generation: 1, targets: [target('W2', local, { host: false })] });
  await flush();
  save(local['LocalData.sav'], T0 + 30000);
  guest.Observer.instances[0].notify('disappeared', local['LocalData.sav']);
  await guest.clock.advance(1100);
  assert.deepEqual(guest.settled().map(({ worldId, changed, reason }) => [worldId, changed, reason]), [['W2', ['LocalData.sav'], 'quiet']]);
});

test('見張り（save-watch）: disappeared・errored は変化として数えて張り直し（getFile が通ったら observe → 照らし合わせ）、appeared・modified・moved は照らし合わせだけ', async () => {
  const { clock, watcher, Observer, settled } = setup();
  const local = { 'LocalData.sav': fakeHandle('LocalData.sav') };
  await watcher.watch({ generation: 1, targets: [target('W1', local, { host: false })] });
  await flush();
  const [observer] = Observer.instances;
  assert.equal(Observer.calls.length, 1);
  // 置き換えの途中（10 ms の時点ではまだ消えている）→ 50 ms の段で張り直せる
  local['LocalData.sav'].gone = true;
  observer.notify('errored', local['LocalData.sav']);
  await clock.advance(10);
  assert.equal(Observer.calls.length, 1);
  local['LocalData.sav'].gone = false;
  save(local['LocalData.sav'], T0 + 30000);
  await clock.advance(50);
  assert.equal(Observer.calls.length, 2);
  await clock.advance(1000);
  assert.deepEqual(settled().map(({ changed }) => changed), [['LocalData.sav']]);
  // modified・appeared・moved: 印が変わっていなければ数えない
  for (const type of ['modified', 'appeared', 'moved']) observer.notify(type, local['LocalData.sav']);
  await clock.advance(2000);
  assert.equal(settled().length, 1);
  save(local['LocalData.sav'], T0 + 60000);
  observer.notify('modified', local['LocalData.sav']);
  await clock.advance(1000);
  assert.equal(settled().length, 2);
  // 張り直しはしない（observe は 2 回のまま）
  assert.equal(Observer.calls.length, 2);
});

test('見張り（save-watch）: 4 段（10・50・250・1000 ms）で張り直せなければ、そのファイルは 5 秒ごとの確認に落ちる（どれも見張れなければ poll）', async () => {
  const refused = new Set();
  const Observer = fakeObserverClass({ refuse: (handle) => refused.has(handle) });
  const { clock, watcher, modes, settled } = setup({ Observer });
  const local = { 'LocalData.sav': fakeHandle('LocalData.sav') };
  await watcher.watch({ generation: 1, targets: [target('W1', local, { host: false })] });
  await flush();
  assert.deepEqual(modes(), ['observer']);
  refused.add(local['LocalData.sav']);
  save(local['LocalData.sav'], T0 + 30000);
  Observer.instances[0].notify('disappeared', local['LocalData.sav']);
  await clock.advance(10 + 50 + 250 + 999);
  assert.deepEqual(modes(), ['observer']);
  await clock.advance(1);
  // 1 + 4 段の observe。全部の段で通らなかったので poll に落ちる
  assert.equal(Observer.calls.length, 5);
  assert.deepEqual(modes(), ['observer', 'poll']);
  // 張り直しの間の変化は、通知を数えた分で知らせる
  assert.deepEqual(settled().map(({ changed }) => changed), [['LocalData.sav']]);
  // その後の変化は 5 秒ごとの確認で拾う
  save(local['LocalData.sav'], T0 + 60000);
  await clock.advance(6000);
  assert.deepEqual(settled().map(({ changed }) => changed), [['LocalData.sav'], ['LocalData.sav']]);
  // 次の watch() で張り直す
  refused.clear();
  await watcher.watch({ generation: 2, targets: [target('W1', local, { host: false })] });
  await flush();
  assert.deepEqual(modes(), ['observer', 'poll', 'observer']);
});

test('見張り（save-watch）: unknown はそのワールドの全ファイル（Players も）を照らし合わせる', async () => {
  const { clock, watcher, Observer, settled } = setup();
  const files = worldFiles();
  await watcher.watch({ generation: 1, targets: [target('W1', files)] });
  await flush();
  save(files['Level.sav'], T0 + 30000);
  save(files[PLAYER], T0 + 30001);
  Observer.instances[0].callback([{ type: 'unknown', root: files['LocalData.sav'], relativePathComponents: [] }]);
  await clock.advance(1100);
  assert.deepEqual(settled().map(({ changed, reason }) => [changed, reason]), [[['Level.sav', PLAYER], 'quiet']]);
});

test('見張り（save-watch）: 世代番号。張り直したら前の Observer を止め、古い通知・タイマー・張り直しの結果は捨てる', async () => {
  const { clock, watcher, Observer, settled, posts } = setup();
  const files = worldFiles();
  await watcher.watch({ generation: 1, targets: [target('W1', files)] });
  await flush();
  const [old] = Observer.instances;
  // 古い見張りで変化を数え始めた（maxWait のタイマー・張り直しの待ちがある）ところで張り直す
  save(files['LocalData.sav'], T0 + 30000);
  old.notify('disappeared', files['LocalData.sav']);
  await watcher.watch({ generation: 2, targets: [target('W1', files)] });
  await flush();
  assert.equal(old.disconnected, true);
  const callsAfter = Observer.calls.length;
  // 古い Observer の通知は捨てる
  save(files['Level.sav'], T0 + 31000);
  old.notify('disappeared', files['Level.sav']);
  await clock.advance(11000);
  // 新しい見張りの基準は張り直したときの印（その後に変わった Level.sav は 5 秒の確認で拾い、新しい世代で知らせる）
  assert.ok(settled().every((message) => message.generation === 2), JSON.stringify(posts));
  assert.deepEqual(settled().map(({ changed }) => changed), [['Level.sav']]);
  // 古い張り直しは observe しない（新しい Observer の 3 つだけ）
  assert.equal(Observer.calls.length, callsAfter);
  assert.deepEqual(posts.filter((message) => message.type === 'mode').map(({ generation, mode }) => [generation, mode]), [[1, 'observer'], [2, 'observer']]);
});

test('見張り（save-watch）: Observer がない・作れないときは poll（5 秒ごとの確認で、Players・GlobalPalStorage.sav の変化も拾う）', async () => {
  const { clock, watcher, modes, settled } = setup({ Observer: null });
  const files = worldFiles();
  await watcher.watch({ generation: 1, targets: [target('W1', files)] });
  assert.deepEqual(modes(), ['poll']);
  save(files['Level.sav'], T0 + 30000);
  save(files[GLOBAL], T0 + 30001);
  await clock.advance(5000);
  await clock.advance(1000);
  assert.deepEqual(settled().map(({ changed }) => changed), [['Level.sav', GLOBAL]]);

  class Broken { constructor() { throw new Error('not supported'); } }
  const other = setup({ Observer: Broken });
  await other.watcher.watch({ generation: 1, targets: [target('W1', worldFiles())] });
  assert.deepEqual(other.modes(), ['poll']);
});

test('見張り（save-watch）: stop で Observer・タイマー・5 秒の確認を全部止め、その後は何も知らせない', async () => {
  const { clock, watcher, Observer, posts } = setup();
  const files = worldFiles();
  await watcher.watch({ generation: 1, targets: [target('W1', files)] });
  await flush();
  save(files['LocalData.sav'], T0 + 30000);
  Observer.instances[0].notify('disappeared', files['LocalData.sav']);
  const before = posts.length;
  watcher.stop();
  assert.equal(Observer.instances[0].disconnected, true);
  assert.equal(clock.size(), 0);
  save(files['Level.sav'], T0 + 31000);
  Observer.instances[0].notify('disappeared', files['Level.sav']);
  await clock.advance(20000);
  assert.equal(posts.length, before);
});

test('見張り（save-watch）: 許可が外れた（NotAllowedError）ことも印の変化として 1 回だけ知らせる。消えたファイルは changed に入れるが時刻には使わない', async () => {
  const { clock, watcher, settled } = setup({ Observer: null });
  const files = worldFiles();
  await watcher.watch({ generation: 1, targets: [target('W1', files, { host: false })] });
  for (const handle of Object.values(files)) handle.permission = 'prompt';
  await clock.advance(6000);
  assert.deepEqual(settled().map(({ changed, firstAt, lastAt }) => [changed.length, firstAt, lastAt]), [[6, null, null]]);
  await clock.advance(30000);
  assert.equal(settled().length, 1);
  for (const handle of Object.values(files)) handle.permission = 'granted';
  await clock.advance(6000);
  assert.equal(settled().length, 2);
  // 消えたファイルは changed に入れ、時刻は残ったファイルだけで決める
  files[DPS].gone = true;
  save(files['Level.sav'], T0 + 50000);
  save(files['LocalData.sav'], T0 + 49000);
  await clock.advance(6000);
  assert.deepEqual(settled().at(-1), {
    type: 'settled', generation: 1, worldId: 'W1', changed: ['Level.sav', 'LocalData.sav', DPS], firstAt: T0 + 49000, lastAt: T0 + 50000, reason: 'quiet',
  });
});

test('見張り（save-watch）: 5 秒ごとの確認は、前の回が終わっていなければ飛ばす', async () => {
  const { clock, watcher } = setup({ Observer: null });
  const files = { 'LocalData.sav': fakeHandle('LocalData.sav') };
  let reads = 0;
  let release = null;
  const getFile = files['LocalData.sav'].getFile.bind(files['LocalData.sav']);
  files['LocalData.sav'].getFile = async () => {
    reads++;
    if (release === null && reads > 1) await new Promise((resolve) => { release = resolve; });
    return getFile();
  };
  await watcher.watch({ generation: 1, targets: [target('W1', files, { host: false })] });
  await clock.advance(5000);
  assert.equal(reads, 2);
  // 1 回目の確認が終わっていないので、次の 2 回は飛ばす
  await clock.advance(10000);
  assert.equal(reads, 2);
  release();
  await flush();
  await clock.advance(5000);
  assert.equal(reads, 3);
});

// 画面のスレッドの側（偽の Worker）
function fakeWorker() {
  const listeners = new Map();
  const worker = {
    sent: [], terminated: false,
    addEventListener: (type, fn) => listeners.set(type, fn),
    postMessage(message) { worker.sent.push(message); },
    terminate() { worker.terminated = true; },
    emit: (type, event) => listeners.get(type)?.(event),
  };
  return worker;
}

test('見張りの画面側（save-watch）: Worker のない環境（Node）では落ちずに timer にする', () => {
  assert.equal(typeof globalThis.Worker, 'undefined');
  const modes = [];
  const client = createWatchClient({ onMode: (mode) => modes.push(mode) });
  client.update([{ worldId: 'W1', host: true, files: [] }]);
  client.update([{ worldId: 'W1', host: true, files: [] }]);
  assert.deepEqual(modes, ['timer', 'timer']);
  client.stop();
});

test('見張りの画面側（save-watch）: 世代番号を付けて送り、違う世代の知らせは捨てる。対象が空なら Worker を止め、次の対象で作り直す', () => {
  const workers = [];
  const settled = [];
  const modes = [];
  const client = createWatchClient({
    createWorker: () => { const worker = fakeWorker(); workers.push(worker); return worker; },
    onSettled: (message) => settled.push(message), onMode: (mode) => modes.push(mode),
  });
  const targets = [{ worldId: 'W1', host: true, files: [] }];
  client.update(targets);
  client.update(targets);
  assert.equal(workers.length, 1);
  assert.deepEqual(workers[0].sent.map(({ type, generation }) => [type, generation]), [['watch', 1], ['watch', 2]]);
  assert.equal(workers[0].sent[1].targets, targets);
  workers[0].emit('message', { data: { type: 'settled', generation: 1, worldId: 'W1', changed: ['Level.sav'] } });
  workers[0].emit('message', { data: { type: 'mode', generation: 1, mode: 'poll' } });
  assert.deepEqual([settled, modes], [[], []]);
  workers[0].emit('message', { data: { type: 'mode', generation: 2, mode: 'observer' } });
  workers[0].emit('message', { data: { type: 'settled', generation: 2, worldId: 'W1', changed: ['Level.sav'] } });
  assert.deepEqual(modes, ['observer']);
  assert.deepEqual(settled.map((message) => message.worldId), ['W1']);
  client.update([]);
  assert.equal(workers[0].terminated, true);
  // 止めた後に届いた知らせは捨てる
  workers[0].emit('message', { data: { type: 'settled', generation: 2, worldId: 'W1', changed: [] } });
  assert.equal(settled.length, 1);
  client.update(targets);
  assert.equal(workers.length, 2);
  assert.deepEqual(workers[1].sent.map(({ generation }) => generation), [4]);
});

test('見張りの画面側（save-watch）: Worker が error・messageerror なら timer にして止め、このページの間は作り直さない', () => {
  for (const type of ['error', 'messageerror']) {
    const workers = [];
    const modes = [];
    const client = createWatchClient({
      createWorker: () => { const worker = fakeWorker(); workers.push(worker); return worker; },
      onMode: (mode) => modes.push(mode),
    });
    client.update([{ worldId: 'W1', host: true, files: [] }]);
    workers[0].emit(type, { message: 'failed' });
    assert.equal(workers[0].terminated, true, type);
    client.update([{ worldId: 'W1', host: true, files: [] }]);
    assert.deepEqual([workers.length, modes], [1, ['timer', 'timer']], type);
  }
});
