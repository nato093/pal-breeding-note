import { test } from 'node:test';
import assert from 'node:assert/strict';
import pals from '../../web/data/pals.js';
import { buildIndex } from '../../web/js/core/index.js';

// 図鑑（paldex）の予算: 298 マスの格子を作るのと、記録の更新（印の差分だけを直す）がそれぞれ 100ms 以内。ブラウザ（Chrome）での実測は
// docs/ui-refactor/phase-3-4-drawer-data.md の paldex の「実装の記録」。ここはテスト用の DOM で、作る・直す仕事の量を見張る
test('性能: 図鑑の 298 マスを作るのが 100ms 以内・記録 10,000 件の更新で印を直すのが 100ms 以内（作り直さない）。1 マスの要素は 14 個以下', async (t) => {
  const { installDom, descendants } = await import('../helpers/dom.js');
  installDom(t);
  const { paldexView } = await import('../../web/js/views/paldex.js');
  const active = pals.filter((pal) => pal.active);
  let seed = 0x50414c44;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = () => active[Math.floor(rnd() * active.length)].id;
  const records = (n, prefix) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, parent1Id: pick(), parent2Id: pick(), childId: pick(), updatedAt: '2026-10-16T00:00:00.000Z' }));
  const listeners = new Set();
  const store = { state: { index: buildIndex(records(10000, 'r'), pals), env: 'test', revision: 1 }, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }, refresh: () => {} };
  // 所持パル 2,000 体・自分の捕獲数（全種族）・目標 100 件
  const ownedData = {
    pals: Array.from({ length: 2000 }, (_, i) => ({ id: `o${i}`, palId: pick(), place: 'palbox', gender: rnd() < 0.5 ? 'M' : 'F', egg: false })),
    players: [{ uid: 'me', name: 'Alice', captures: Object.fromEntries(active.map((pal, i) => [pal.id, 1 + (i % 40)])) }],
  };
  const goals = Array.from({ length: 100 }, (_, i) => ({ id: `g${i}`, palId: active[i * 2].id }));
  const context = {
    store, owned: { state: { owned: ownedData }, subscribe: () => () => {}, load: () => Promise.resolve() },
    ideals: { list: () => goals, selfUids: () => new Set(['me']), subscribe: () => () => {} }, viewState: () => ({}),
  };
  let start = performance.now();
  const view = paldexView(context);
  const firstMs = performance.now() - start;
  const cells = view.element.querySelector('.paldex-grid').children;
  const perCell = Math.max(...cells.map((cell) => descendants(cell).length));
  console.log(`図鑑の格子（テスト用の DOM）: 298 マスを作る ${firstMs.toFixed(2)} ms・1 マスの要素 ${perCell} 個・全体 ${descendants(view.element).length} 個`);
  assert.equal(cells.length, 298);
  assert.ok(firstMs < 100, `298 マスを作るのが 100ms を超えました: ${firstMs.toFixed(2)} ms`);
  assert.ok(perCell <= 14, `1 マスの要素が 14 個を超えました: ${perCell}`);
  // 記録の更新（別の 10,000 件の索引。件数がほぼ全部のマスで変わる）
  const next = buildIndex(records(10000, 's'), pals);
  const before = [...cells];
  start = performance.now();
  store.state = { ...store.state, index: next, revision: 2 };
  for (const fn of listeners) fn(store.state);
  const updateMs = performance.now() - start;
  console.log(`図鑑の格子（テスト用の DOM）: 記録の更新で印を直す ${updateMs.toFixed(2)} ms`);
  assert.ok(updateMs < 100, `記録の更新が 100ms を超えました: ${updateMs.toFixed(2)} ms`);
  assert.deepEqual(view.element.querySelector('.paldex-grid').children, before);
  view.destroy();
});
