import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startSliced } from '../../web/js/ui/slice.js';

// 1 回 next() を呼ぶたびに時計を進めるジェネレーター（steps 回 yield して value を返す）
function* work(clock, steps, value = 'done', cost = 10) {
  for (let i = 0; i < steps; i++) {
    clock.time += cost;
    yield i;
  }
  return value;
}

test('区切った計算: 最初の区切りで終われば、同期で結果を返す', () => {
  const clock = { time: 0 };
  const result = startSliced(work(clock, 2), { budget: 30, now: () => clock.time });
  assert.deepEqual(result, { done: true, value: 'done' });
});

test('区切った計算: 終わらなければ、schedule で区切りごとに進め、promise で結果を返す', async () => {
  const clock = { time: 0 };
  const queued = [];
  const slices = [];
  const result = startSliced(work(clock, 10, '結果'), {
    budget: 30, now: () => clock.time, schedule: (fn) => queued.push(fn), onSlice: (ms) => slices.push(ms),
  });
  assert.equal(result.done, false);
  assert.equal(typeof result.cancel, 'function');
  // 1 回の区切りは budget まで（10ms ずつなので 3 回で 30ms）
  assert.deepEqual(slices, [30]);
  let rounds = 0;
  while (queued.length) {
    rounds++;
    queued.shift()();
  }
  assert.equal(rounds, 3);
  assert.equal(await result.promise, '結果');
  assert.ok(slices.every((ms) => ms <= 30), slices.join(','));
});

test('区切った計算: cancel と signal の abort で古い計算を捨て、promise は null で解決し、ジェネレーターを閉じる', async () => {
  const clock = { time: 0 };
  const queued = [];
  let closed = 0;
  function* closing() {
    try { yield* work(clock, 10); } finally { closed++; }
  }
  const first = startSliced(closing(), { budget: 30, now: () => clock.time, schedule: (fn) => queued.push(fn) });
  first.cancel();
  queued.splice(0).forEach((fn) => fn());
  assert.equal(await first.promise, null);
  assert.equal(closed, 1);
  const controller = new AbortController();
  const second = startSliced(closing(), { budget: 30, now: () => clock.time, schedule: (fn) => queued.push(fn), signal: controller.signal });
  controller.abort();
  queued.splice(0).forEach((fn) => fn());
  assert.equal(await second.promise, null);
  assert.equal(closed, 2);
  // 始める前に abort 済みなら、計算しない
  const aborted = new AbortController();
  aborted.abort();
  const third = startSliced(closing(), { budget: 30, now: () => clock.time, signal: aborted.signal });
  assert.equal(third.done, false);
  assert.equal(await third.promise, null);
});

test('区切った計算: 計算の中で投げた例外は promise の reject になる', async () => {
  const clock = { time: 0 };
  const queued = [];
  function* failing() {
    yield* work(clock, 5);
    throw new Error('計算の失敗');
  }
  const result = startSliced(failing(), { budget: 30, now: () => clock.time, schedule: (fn) => queued.push(fn) });
  while (queued.length) queued.shift()();
  await assert.rejects(result.promise, /計算の失敗/);
});

test('区切った計算: 最初の区切りだけ上限（firstBudget）を変えられる（呼び出し側が先に使った時間と合わせて収める）', async () => {
  const clock = { time: 0 };
  const queued = [];
  const slices = [];
  const result = startSliced(work(clock, 6), { budget: 30, firstBudget: 10, now: () => clock.time, schedule: (fn) => queued.push(fn), onSlice: (ms) => slices.push(ms) });
  assert.equal(result.done, false);
  while (queued.length) queued.shift()();
  assert.equal(await result.promise, 'done');
  assert.deepEqual(slices, [10, 30, 20]);
});
