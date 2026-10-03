import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../../web/js/core/index.js';
import { buildCarrierGraph, findRoutes } from '../../web/js/core/route.js';

test('性能: パル 300 体、ランダム 1 万件で各処理が 2 秒以内', () => {
  let state = 0x50414c33;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const pals = Array.from({ length: 300 }, (_, no) => ({ id: `P${no}`, no, variant: false }));
  const randomPal = () => pals[Math.floor(random() * pals.length)].id;
  const records = Array.from({ length: 10000 }, (_, position) => ({
    id: `R${position}`, parent1Id: randomPal(), parent2Id: randomPal(), childId: randomPal(), confirmCount: 1 + Math.floor(random() * 10),
  }));
  const measure = (label, operation) => {
    const start = performance.now();
    const value = operation();
    const elapsed = performance.now() - start;
    console.log(`${label}: ${elapsed.toFixed(2)} ms`);
    assert.ok(elapsed < 2000, `${label}が 2 秒を超えました: ${elapsed.toFixed(2)} ms`);
    return value;
  };
  const index = measure('インデックス構築', () => buildIndex(records, pals));
  const graph = measure('グラフ構築', () => buildCarrierGraph(index));
  const result = measure('経路探索（最大 5 本）', () => findRoutes(graph, index, 'P0', 'P299'));
  assert.equal(result.routes.length, 5);
});
