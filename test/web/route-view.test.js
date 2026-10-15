import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from '../helpers/dom.js';
import pals from '../../web/data/pals.js';
import { buildIndex } from '../../web/js/core/index.js';
import { buildCarrierGraph, findRoutes } from '../../web/js/core/route.js';
import { routeView, ROUTE_NOTE } from '../../web/js/ui/route-view.js';

function renderRoutes(records, from = 'SheepBall', to = 'CatMage') {
  const index = buildIndex(records, pals);
  const { routes } = findRoutes(buildCarrierGraph(index), index, from, to);
  return routeView(routes);
}

test('継承ルート表示: 前の子を左親につなぎ、性別を保って配合行と段番号を表示する', (t) => {
  installDom(t);
  const records = [
    Object.freeze({ id: 'a', parent1Id: 'FlowerDoll', parent2Id: 'SheepBall', childId: 'MoonQueen',
      parent1Gender: 'F', parent2Gender: 'M', confirmCount: 10, registrant: '登録者', memo: 'メモ', updatedAt: '2026-10-04' }),
    Object.freeze({ id: 'b', parent1Id: 'PinkCat', parent2Id: 'MoonQueen', childId: 'CatMage', confirmCount: 10 }),
  ];
  const view = renderRoutes(records);
  const rows = view.querySelectorAll('.route-breeding-card');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.querySelector('.step-number').textContent), ['1', '2']);
  assert.deepEqual(rows.map((row) => row.querySelectorAll('strong').map((node) => node.textContent)), [
    ['モコロン', 'フラリーナ', 'セレムーン'], ['セレムーン', 'ツッパニャン', 'クレメーオ'],
  ]);
  assert.deepEqual(rows[0].querySelectorAll('.gender').map((node) => node.textContent), ['♂', '♀']);
  // 記録に親の性別がある段は「性別の向きは未確認」の注記（警告ではない。経路は種族だけで探すため。R-25）
  const note = rows[0].querySelector('.route-note');
  assert.equal(note.textContent, '性別の向きは未確認');
  assert.equal(note.title, '経路は種族だけで探しています。記録の ♂♀ の向きと、手持ちの個体の性別が合うかは確かめていません。');
  assert.equal(rows[0].querySelector('.route-warning'), null);
  assert.equal(rows[1].querySelector('.route-step-notes'), null);
  assert.doesNotMatch(view.textContent, /性別条件は未検証/);
  assert.match(view.querySelector('h2').textContent, /最短 2 回の配合/);
  for (const row of rows) {
    assert.match(row.className, /breeding-card/);
    assert.match(row.textContent, /＋.*→/);
    assert.equal(row.querySelectorAll('.pal-icon').length, 3);
    assert.equal(row.querySelector('.card-meta'), null);
    assert.equal(row.querySelector('.card-actions'), null);
    assert.equal(row.querySelector('.card-memo'), null);
  }
  assert.doesNotMatch(view.textContent, /相手親を用意|↓|登録者|更新|メモ/);
});

test('継承ルート表示: 同じ段の配合は折りたたまず、段番号1つの枠に全部同じ扱いで並べる', (t) => {
  installDom(t);
  const view = renderRoutes([
    { id: 'a', parent1Id: 'SheepBall', parent2Id: 'SheepBall', childId: 'MoonQueen', confirmCount: 1, parent1Gender: 'M' },
    { id: 'b', parent1Id: 'FlowerDoll', parent2Id: 'SheepBall', childId: 'MoonQueen', confirmCount: 10 },
    { id: 'c', parent1Id: 'SheepBall', parent2Id: 'CatMage', childId: 'MoonQueen', confirmCount: 1 },
  ], 'SheepBall', 'MoonQueen');
  assert.equal(view.querySelector('details'), null);
  const rows = view.querySelectorAll('.route-breeding-card');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].querySelectorAll('.step-number').map((node) => node.textContent), ['1']);
  const options = rows[0].querySelector('.route-options');
  assert.equal(options.querySelector('.route-options-label').textContent, '3 通り・どれか 1 つ');
  const equations = options.querySelectorAll('.breeding-equation');
  // 確認回数の多い配合（フラリーナ）を先頭に寄せず、相手親の並び順のままにする
  assert.deepEqual(equations.map((equation) => equation.querySelectorAll('strong')[1].textContent), ['モコロン', 'クレメーオ', 'フラリーナ']);
  assert.ok(equations.every((equation) => equation.querySelectorAll('strong')[0].textContent === 'モコロン'));
  // 注記は段に 1 回だけ
  assert.deepEqual(rows[0].querySelector('.route-step-notes').children.map((node) => node.textContent), ['性別の向きは未確認']);
});

test('継承ルート表示: multiChild の段は「同じ組で別の子も登録あり」（押すとその組の配合を探す）。最短先頭を保ち、他ルートも折りたたまない', (t) => {
  installDom(t);
  const view = renderRoutes([
    { id: 'a', parent1Id: 'SheepBall', parent2Id: 'FlowerDoll', childId: 'MoonQueen', confirmCount: 10 },
    { id: 'b', parent1Id: 'SheepBall', parent2Id: 'FlowerDoll', childId: 'CatMage', confirmCount: 10 },
    { id: 'c', parent1Id: 'MoonQueen', parent2Id: 'FlowerDoll', childId: 'CatMage', confirmCount: 10 },
  ]);
  assert.deepEqual(view.children.map((node) => node.tagName), ['section', 'section']);
  assert.equal(view.children[0].querySelector('h2').textContent, '最短 1 回の配合');
  assert.equal(view.children[1].querySelector('h2').textContent, '候補 2 · 2 回の配合');
  assert.equal(view.querySelector('details'), null);
  const warning = view.children[0].querySelector('.route-warning');
  assert.equal(warning.textContent, '同じ組で別の子も登録あり');
  assert.equal(warning.tagName, 'a');
  assert.equal(warning.href, '#/search?p1=SheepBall&p2=FlowerDoll');
  // 親の性別のない記録なので、性別の注記はない
  assert.equal(view.children[0].querySelector('.route-note'), null);
  assert.equal(view.children[0].querySelector('.route-options'), null);
});

test('継承ルート表示: passives と note は最初のカードの見出しにだけ出す（運ぶパッシブの小さいチップと、見出しの下の説明）', (t) => {
  installDom(t);
  const records = [
    { id: 'a', parent1Id: 'SheepBall', parent2Id: 'FlowerDoll', childId: 'MoonQueen', confirmCount: 1 },
    { id: 'b', parent1Id: 'SheepBall', parent2Id: 'PinkCat', childId: 'CatMage', confirmCount: 1 },
    { id: 'c', parent1Id: 'MoonQueen', parent2Id: 'PinkCat', childId: 'CatMage', confirmCount: 1 },
  ];
  const index = buildIndex(records, pals);
  const { routes } = findRoutes(buildCarrierGraph(index), index, 'SheepBall', 'CatMage');
  const view = routeView(routes, { passives: ['CraftSpeed_up2', 'Rare'], note: ROUTE_NOTE });
  const cards = view.querySelectorAll('.route-card');
  assert.equal(cards.length, 2);
  const carried = cards[0].querySelector('.route-card-head').querySelector('.route-card-passives');
  assert.equal(carried.getAttribute('aria-label'), '運ぶパッシブ');
  assert.deepEqual(carried.querySelectorAll('.passive-chip').map((chip) => chip.className.includes('compact')), [true, true]);
  assert.equal(cards[0].querySelector('.route-card-note').textContent, '左のパルがパッシブを運びます。相手親は別に用意してください。');
  assert.equal(cards[1].querySelector('.route-card-passives'), null);
  assert.equal(cards[1].querySelector('.route-card-note'), null);
  // 渡さなければ前の形のまま（見出しだけ）
  assert.equal(routeView(routes).querySelector('.route-card').children[0].tagName, 'h2');
});

test('継承ルート表示: badge(route) を渡すと見出しの右に置き、渡さなければ見出しだけ（前の形のまま）', (t) => {
  installDom(t);
  const records = [Object.freeze({ id: 'b', parent1Id: 'PinkCat', parent2Id: 'SheepBall', childId: 'CatMage', confirmCount: 1 })];
  const index = buildIndex(records, pals);
  const { routes } = findRoutes(buildCarrierGraph(index), index, 'SheepBall', 'CatMage');
  const plain = routeView(routes);
  assert.equal(plain.querySelector('.route-card').children[0].tagName, 'h2');
  assert.equal(plain.querySelector('.route-card-head'), null);
  const withBadge = routeView(routes, { badge: (route) => { const node = document.createElement('span'); node.textContent = `${route.steps.length} 段`; return node; } });
  const head = withBadge.querySelector('.route-card-head');
  assert.deepEqual(head.children.map((node) => node.textContent), ['最短 1 回の配合', '1 段']);
  // null を返せば何も足さない
  assert.equal(routeView(routes, { badge: () => null }).querySelector('.route-card-head'), null);
});
