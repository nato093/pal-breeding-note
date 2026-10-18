// 常駐のセーブの見張り（tools/server-agent/watch-client.mjs）。Observer なしの createSaveWatcher を、偽のハンドルと仮の時計で動かす。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalWatchClient } from '../../tools/server-agent/watch-client.mjs';
import { fakeHandle, T0 } from '../helpers/file-handles.js';

const W1 = 'AAAAAAAA000000000000000000000001';
const W2 = 'BBBBBBBB000000000000000000000002';
const PLAYER = 'Players/0000000000000000000000000000000a.sav';

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
};

// 仮の時計（setTimeout・setInterval の代わり）
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

function setup() {
  const clock = virtualClock();
  const settled = [];
  const modes = [];
  const client = createLocalWatchClient({
    onSettled: (message) => settled.push(message), onMode: (mode) => modes.push(mode),
    setTimer: clock.setTimer, clearTimer: clock.clearTimer, every: clock.every, stopEvery: clock.stopEvery,
  });
  return { clock, client, settled, modes };
}

const target = (worldId, files) => ({ worldId, host: true, files: Object.entries(files).map(([path, handle]) => ({ path, handle })) });

test('常駐の見張り: Observer なしで 5 秒ごとに確かめ（mode は poll）、一式を書き終えたら知らせる。Players の中も拾う', async () => {
  const { clock, client, settled, modes } = setup();
  const files = { 'Level.sav': fakeHandle('Level.sav'), 'LevelMeta.sav': fakeHandle('LevelMeta.sav'), [PLAYER]: fakeHandle('a.sav') };
  client.update([target(W1, files)]);
  await clock.advance(0);
  assert.deepEqual(modes, ['poll']);
  assert.deepEqual(settled, []);
  // サーバーの保存（Level.sav → LevelMeta.sav → Players）
  for (const handle of Object.values(files)) handle.time = T0 + 30_000;
  await clock.advance(5_000);
  await clock.advance(1_000);
  assert.equal(settled.length, 1);
  assert.equal(settled[0].worldId, W1);
  assert.deepEqual([...settled[0].changed].sort(), ['Level.sav', 'LevelMeta.sav', PLAYER].sort());
  assert.equal(settled[0].lastAt, T0 + 30_000);
  // 変わらなければ知らせない
  await clock.advance(30_000);
  assert.equal(settled.length, 1);
  // Players の中だけが変わっても拾う（Observer はないので 5 秒ごとの確認だけ。フォルダを押さえない）
  files[PLAYER].time = T0 + 60_000;
  await clock.advance(5_000);
  await clock.advance(10_000);
  assert.deepEqual(settled.at(-1).changed, [PLAYER]);
});

test('常駐の見張り: update([]) で止める（タイマーを残さない）。対象を替えたら前の対象の知らせは捨てる', async () => {
  const { clock, client, settled } = setup();
  const first = { 'Level.sav': fakeHandle('Level.sav') };
  const second = { 'Level.sav': fakeHandle('Level.sav') };
  client.update([target(W1, first)]);
  await clock.advance(0);
  assert.ok(clock.size() > 0);
  client.update([]);
  await clock.advance(0);
  assert.equal(clock.size(), 0);
  first['Level.sav'].time = T0 + 30_000;
  await clock.advance(60_000);
  assert.deepEqual(settled, []);
  // 張り直すと、その時の印を基準にする（止めている間の変化は知らせない）
  client.update([target(W1, first)]);
  await clock.advance(10_000);
  assert.deepEqual(settled, []);
  // 対象を替えた: 前の対象（W1）の変化は知らせず、今の対象（W2）だけ
  client.update([target(W2, second)]);
  await clock.advance(0);
  first['Level.sav'].time = T0 + 90_000;
  second['Level.sav'].time = T0 + 90_000;
  await clock.advance(6_000);
  assert.deepEqual(settled.map((message) => message.worldId), [W2]);
  client.stop();
  await clock.advance(0);
  assert.equal(clock.size(), 0);
});
