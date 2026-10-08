import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../../web/js/core/index.js';
import { idealPairs } from '../../web/js/core/ideal.js';

test('性能: 理想個体の提案は、同じ種族の ♂1000 × ♀1000（100 万組）でも 2 秒以内', () => {
  let state = 0x49444541;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const passivePool = Array.from({ length: 12 }, (_, i) => `P${i}`);
  const pals = Array.from({ length: 2000 }, (_, i) => {
    const passives = [...new Set(Array.from({ length: Math.floor(random() * 5) }, () => passivePool[Math.floor(random() * passivePool.length)]))];
    const value = () => Math.floor(random() * 101);
    return { id: `I${i}`, palId: 'X', gender: i % 2 ? 'F' : 'M', egg: false, place: 'palbox', passives, talent: { hp: value(), shot: value(), defense: value() } };
  });
  const index = buildIndex([], [{ id: 'X', no: 1, variant: false }]);
  const measure = (label, input) => {
    const start = performance.now();
    const result = idealPairs({ pals, index, target: 'X', ...input });
    const elapsed = performance.now() - start;
    console.log(`${label}: ${elapsed.toFixed(2)} ms（${result.total} 組）`);
    assert.ok(elapsed < 2000, `${label}が 2 秒を超えました: ${elapsed.toFixed(2)} ms`);
    return result;
  };
  assert.equal(measure('パッシブの指定なし', {}).total, 1000000);
  measure('パッシブ 2 個', { passives: ['P0', 'P1'] });
  measure('パッシブ 4 個・ケーキあり', { passives: ['P0', 'P1', 'P2', 'P3'], cake: 'talent', mode: 'only' });
});

test('性能: 世代を重ねる並べ方は、全員が欲しいパッシブを持つ ♂1000 × ♀1000 と、キノコケーキで値が境目付近にばらける ♂200 × ♀200 でも 2 秒以内', () => {
  let state = 0x47454e53;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const junk = ['J0', 'J1', 'J2'];
  const make = (count, low) => Array.from({ length: count * 2 }, (_, i) => {
    const extras = junk.filter(() => random() < 0.3).slice(0, 2);
    const value = () => low + Math.floor(random() * (101 - low));
    return { id: `G${i}`, palId: 'X', gender: i % 2 ? 'F' : 'M', egg: false, place: 'palbox', passives: ['P0', 'P1', ...extras], talent: { hp: value(), shot: value(), defense: value() } };
  });
  const index = buildIndex([], [{ id: 'X', no: 1, variant: false }]);
  const measure = (label, pals, input) => {
    const start = performance.now();
    const result = idealPairs({ pals, index, target: 'X', passives: ['P0', 'P1'], order: 'generations', ...input });
    const elapsed = performance.now() - start;
    console.log(`${label}: ${elapsed.toFixed(2)} ms（${result.total} 組）`);
    assert.ok(elapsed < 2000, `${label}が 2 秒を超えました: ${elapsed.toFixed(2)} ms`);
    return result;
  };
  assert.equal(measure('世代・ケーキなし ♂1000×♀1000', make(1000, 0), {}).total, 1000000);
  // 配合の計画（3 段で並べ、別々の個体の組を上から選ぶ）
  assert.equal(measure('計画・ケーキなし ♂1000×♀1000', make(1000, 0), { order: 'plan' }).pairs.length, 20);
  measure('世代・キノコケーキ ♂200×♀200（88〜100）', make(200, 88), { cake: 'talent' });
  // 配合の計画は、条件を満たす組すべてで世代の平均を求める。キノコケーキは最初の 1 個を実際の値で計算するので、
  // 値が 0〜100 にばらけるなら ♂1000 × ♀1000、値が目標の近くに集まるなら（世代の並べ方と同じく）♂200 × ♀200 で 2 秒以内
  assert.equal(measure('計画・キノコケーキ ♂1000×♀1000（0〜100）', make(1000, 0), { order: 'plan', cake: 'talent' }).pairs.length, 20);
  assert.equal(measure('計画・キノコケーキ ♂200×♀200（88〜100）', make(200, 88), { order: 'plan', cake: 'talent' }).pairs.length, 20);
});
