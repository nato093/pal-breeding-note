import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from '../helpers/dom.js';
import pals from '../../web/data/pals.js';
import { buildIndex } from '../../web/js/core/index.js';
import { buildCarrierGraph, findRoutes } from '../../web/js/core/route.js';
import { routeView } from '../../web/js/ui/route-view.js';

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
  assert.equal(rows[0].querySelector('.route-warning').textContent, '性別条件は未検証');
  assert.equal(rows[1].querySelector('.route-warning'), null);
  assert.match(view.querySelector('h3').textContent, /最短 2 回の配合/);
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
  assert.deepEqual(rows[0].querySelectorAll('.route-warning').map((node) => node.textContent), ['性別条件は未検証']);
});

test('継承ルート表示: multiChild の警告と最短先頭を保ち、他ルートも折りたたまない', (t) => {
  installDom(t);
  const view = renderRoutes([
    { id: 'a', parent1Id: 'SheepBall', parent2Id: 'FlowerDoll', childId: 'MoonQueen', confirmCount: 10 },
    { id: 'b', parent1Id: 'SheepBall', parent2Id: 'FlowerDoll', childId: 'CatMage', confirmCount: 10 },
    { id: 'c', parent1Id: 'MoonQueen', parent2Id: 'FlowerDoll', childId: 'CatMage', confirmCount: 10 },
  ]);
  assert.deepEqual(view.children.map((node) => node.tagName), ['section', 'section']);
  assert.equal(view.children[0].querySelector('h3').textContent, '最短 1 回の配合');
  assert.equal(view.children[1].querySelector('h3').textContent, '候補 2 · 2 回の配合');
  assert.equal(view.querySelector('details'), null);
  assert.equal(view.children[0].querySelector('.route-warning').textContent, '性別条件は未検証');
  assert.equal(view.children[0].querySelector('.route-options'), null);
});
