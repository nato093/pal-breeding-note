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
