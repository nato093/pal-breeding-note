import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlanMemory } from '../../web/js/ideal-plan-memory.js';

const memoryStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)) };
};

test('配合の計画の基準: 条件ごとに端末に残し、読み込み直しても取り出せる。壊れた値は基準なしとして扱う', () => {
  const storage = memoryStorage();
  let clock = 0;
  const memory = createPlanMemory({ storage, namespace: 'ns', now: () => ++clock });
  assert.equal(memory.get('a'), null);
  memory.set('a', { farms: 'A:m1|f1', pairs: ['m1|f1'] });
  assert.deepEqual(createPlanMemory({ storage, namespace: 'ns' }).get('a'), { farms: 'A:m1|f1', pairs: ['m1|f1'] });
  assert.equal(createPlanMemory({ storage: memoryStorage({ 'ns.idealPlan': '{' }), namespace: 'ns' }).get('a'), null);
  assert.equal(createPlanMemory({ storage: memoryStorage({ 'ns.idealPlan': JSON.stringify({ a: { farms: 1, pairs: [] } }) }), namespace: 'ns' }).get('a'), null);
  // 保存できない端末でも、開いている間は覚える
  const broken = createPlanMemory({ storage: { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } } });
  broken.set('b', { farms: '', pairs: [] });
  assert.deepEqual(broken.get('b'), { farms: '', pairs: [] });
});

test('配合の計画の基準: 新しく使ったものから 50 件まで残す', () => {
  const storage = memoryStorage();
  let clock = 0;
  const memory = createPlanMemory({ storage, namespace: 'ns', now: () => ++clock });
  for (let i = 0; i < 55; i++) memory.set(`k${i}`, { farms: '', pairs: [] });
  const saved = JSON.parse(storage.data.get('ns.idealPlan'));
  assert.equal(Object.keys(saved).length, 50);
  assert.equal(memory.get('k0'), null);
  assert.deepEqual(memory.get('k54'), { farms: '', pairs: [] });
  // 開いた条件（読んだもの）は新しくなり、押し出されない
  assert.deepEqual(memory.get('k5'), { farms: '', pairs: [] });
  memory.set('k55', { farms: '', pairs: [] });
  assert.deepEqual(memory.get('k5'), { farms: '', pairs: [] });
  assert.equal(memory.get('k6'), null);
});
