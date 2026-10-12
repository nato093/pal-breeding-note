import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withTransition } from '../../web/js/ui/motion.js';

function install(t, { transition, reduce = false } = {}) {
  for (const name of ['document', 'matchMedia']) {
    const before = Object.getOwnPropertyDescriptor(globalThis, name);
    t.after(() => (before ? Object.defineProperty(globalThis, name, before) : Reflect.deleteProperty(globalThis, name)));
  }
  globalThis.document = transition ? { startViewTransition: transition } : {};
  globalThis.matchMedia = (query) => ({ matches: reduce && query === '(prefers-reduced-motion: reduce)' });
}

test('並べ替えの動き: API が無い・動きを減らす設定なら、すぐ描く', (t) => {
  install(t);
  const calls = [];
  withTransition(() => calls.push('描く'));
  assert.deepEqual(calls, ['描く']);
  install(t, { transition: () => { throw new Error('使わない'); }, reduce: true });
  withTransition(() => calls.push('減らす'));
  assert.deepEqual(calls, ['描く', '減らす']);
});

test('並べ替えの動き: View Transition で描き、前の動きの途中に続けて操作したら、最新はすぐ描く', async (t) => {
  let finish;
  const started = [];
  install(t, {
    transition: (fn) => {
      started.push(fn);
      return { finished: new Promise((resolve) => { finish = resolve; }) };
    },
  });
  const calls = [];
  withTransition(() => calls.push(1));
  assert.equal(started.length, 1);
  // 動きの途中の操作は、動きを付けずにすぐ描く
  withTransition(() => calls.push(2));
  assert.deepEqual(calls, [2]);
  started[0]();
  assert.deepEqual(calls, [2, 1]);
  finish();
  await new Promise((resolve) => setImmediate(resolve));
  withTransition(() => calls.push(3));
  assert.equal(started.length, 2);
});
