import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from '../helpers/dom.js';
import pals from '../../web/data/pals.js';
import { buildIndex } from '../../web/js/core/index.js';
import { buildCarrierGraph } from '../../web/js/core/route.js';
import { parseHash } from '../../web/js/router.js';
import { searchView } from '../../web/js/views/search.js';
import { inheritanceView } from '../../web/js/views/route.js';
import { listView } from '../../web/js/views/list.js';
import { settingsView } from '../../web/js/views/settings.js';
import { palView } from '../../web/js/views/pal.js';

function context(records = [{ id: '配合', parent1Id: 'FlowerDoll', parent2Id: 'SheepBall', childId: 'MoonQueen',
  parent1Gender: 'F', parent2Gender: 'M', registrant: '仲間', updatedAt: '2026-10-04T00:00:00Z', confirmCount: 10 }]) {
  const index = buildIndex(records, pals);
  const state = { records, index, graph: buildCarrierGraph(index), env: 'test', warnings: [], userId: '仲間' };
  const navigations = [];
  return { store: { state, subscribe: () => () => {} }, navigations, navigate: (hash) => navigations.push(hash) };
}

test('配合検索: 親は初期未選択で、入れ替え・共有・見出しの装飾を出さない', (t) => {
  installDom(t);
  const view = searchView(context(), parseHash('#/search'));
  assert.deepEqual(view.element.querySelectorAll('.picker-trigger').map((node) => node.textContent), ['パルを選択', 'パルを選択']);
  assert.equal(view.element.querySelector('.swap-button'), null);
  const heading = view.element.querySelector('.view-heading');
  assert.equal(heading.children.length, 1);
  assert.equal(heading.children[0].tagName, 'h1');
  assert.doesNotMatch(heading.textContent, /共有|仲間とつくる|記録した組み合わせから/);
  view.destroy();
});

for (const [params, names, genders] of [
  ['p1=SheepBall', ['モコロン', 'フラリーナ', 'セレムーン'], ['♂', '♀']],
  ['p2=SheepBall', ['フラリーナ', 'モコロン', 'セレムーン'], ['♀', '♂']],
  ['p1=FlowerDoll', ['フラリーナ', 'モコロン', 'セレムーン'], ['♀', '♂']],
  ['p2=FlowerDoll', ['モコロン', 'フラリーナ', 'セレムーン'], ['♂', '♀']],
  ['p1=SheepBall&p2=FlowerDoll', ['モコロン', 'フラリーナ', 'セレムーン'], ['♂', '♀']],
]) {
  test(`配合検索: ${params} の選択欄に合わせて両親と性別を並べる`, (t) => {
    installDom(t);
    const view = searchView(context(), parseHash(`#/search?${params}`));
    assert.equal(view.element.querySelectorAll('.breeding-card').length, 1);
    const equation = view.element.querySelector('.breeding-equation');
    assert.deepEqual(equation.querySelectorAll('strong').map((node) => node.textContent), names);
    assert.deepEqual(equation.querySelectorAll('.gender').map((node) => node.textContent), genders);
    assert.match(equation.textContent, /＋.*→/);
    assert.equal(view.element.querySelector('.result-note').textContent, '1 件の登録済み配合');
    view.destroy();
  });
}

test('継承ルート: 除外設定と確認回数を出さず、旧 URL でも経路を表示し、入れ替えは残す', async (t) => {
  installDom(t);
  const app = context();
  const view = inheritanceView(app, parseHash('#/route?from=SheepBall&to=MoonQueen&exclude=FlowerDoll'));
  assert.equal(view.element.querySelectorAll('.picker').length, 2);
  assert.doesNotMatch(view.element.textContent, /相手親に使わない|除外|確認.*回/);
  assert.match(view.element.textContent, /最短 1 回の配合/);
  assert.ok(view.element.textContent.includes('この経路はスキルを運ぶ個体の流れです。相手親は別途用意します'));
  const swap = view.element.querySelector('.swap-button');
  assert.equal(swap.getAttribute('aria-label'), '開始と目標を入れ替える');
  await swap.dispatch('click');
  assert.equal(app.navigations[0], '#/route?from=MoonQueen&to=SheepBall&exclude=FlowerDoll');
  view.destroy();
});

test('配合検索: 同じ両親に複数の結果がある注記を保ち、すべて選択欄の順に表示する', (t) => {
  installDom(t);
  const original = context().store.state.records[0];
  const view = searchView(context([original, { ...original, id: '別の配合', childId: 'CatMage' }]),
    parseHash('#/search?p1=SheepBall&p2=FlowerDoll'));
  assert.equal(view.element.querySelector('.result-note').textContent, '同じ組み合わせで結果が複数登録されています');
  assert.ok(view.element.querySelectorAll('.breeding-equation').every((node) => node.querySelector('strong').textContent === 'モコロン'));
  view.destroy();
});

test('配合検索: × は該当する親だけを URL から解除する', async (t) => {
  const { body } = installDom(t);
  const app = context();
  const view = searchView(app, parseHash('#/search?p1=SheepBall&p2=FlowerDoll'));
  body.append(view.element);
  const picker = view.element.querySelectorAll('.picker')[0];
  await picker.querySelector('.picker-clear').dispatch('click');
  assert.equal(app.navigations[0], '#/search?p2=FlowerDoll');
  assert.equal(document.activeElement, picker.querySelector('.picker-trigger'));
  view.destroy();
});

test('パル詳細: このパルを親に使う配合は相手 → 子を維持する', (t) => {
  installDom(t);
  const view = palView(context(), parseHash('#/pal/SheepBall'));
  assert.ok(view.element.textContent.includes('このパルを親に使う配合（相手 → 子）'));
  const equation = view.element.querySelector('.breeding-equation');
  assert.deepEqual(equation.querySelectorAll('strong').map((node) => node.textContent), ['フラリーナ', 'セレムーン']);
  assert.doesNotMatch(equation.textContent, /＋/);
  view.destroy();
});

test('一覧: 5 種の並べ替えを選択でき、親の並び順は親ごとに展開して左の親を基準に並び、登録者名で絞り込める', async (t) => {
  installDom(t);
  const source = context().store.state.records[0];
  const app = context([
    { ...source, id: '新しい', parent1Id: 'FlowerDoll', childId: 'SheepBall' },
    { ...source, id: '古い', parent1Id: 'SheepBall', parent2Id: 'CatMage', childId: 'MoonQueen', updatedAt: '2026-10-01T00:00:00Z' },
  ]);
  const view = listView(app);
  const select = view.element.querySelector('select');
  assert.deepEqual(select.children.map((node) => node.textContent), [
    '親の図鑑番号順', '親の五十音順', '子の図鑑番号順', '子の五十音順', '更新日の新しい順',
  ]);
  assert.deepEqual(select.children.map((node) => node.value), ['parent-dex', 'parent-name', 'child-dex', 'child-name', 'updated']);
  assert.equal(select.value, 'parent-dex');
  const firstNames = () => view.element.querySelector('.breeding-equation').querySelectorAll('strong').map((node) => node.textContent);
  assert.equal(firstNames()[2], 'セレムーン');
  // 親の並び順では 1 件を親ごとに展開し、その位置の親を左に出す。
  const leftNames = () => view.element.querySelectorAll('.breeding-equation').map((node) => node.querySelector('strong').textContent);
  assert.deepEqual(leftNames(), ['モコロン', 'モコロン', 'クレメーオ', 'フラリーナ']);
  assert.equal(view.element.querySelector('.result-note').textContent, '2 件の配合 · 4 件を表示');
  for (const [sort, child] of [['parent-dex', 'セレムーン'], ['parent-name', 'セレムーン'],
    ['child-dex', 'モコロン'], ['child-name', 'セレムーン'], ['updated', 'モコロン']]) {
    select.value = sort;
    await select.dispatch('input');
    assert.equal(firstNames()[2], child);
  }
  // パルでの絞り込みは配合検索・逆引き・パル詳細に任せ、一覧には置かない。
  assert.equal(view.element.querySelector('.picker'), null);
  assert.equal(view.element.querySelectorAll('.breeding-card').length, 2);
  const registrant = view.element.querySelectorAll('input')[0];
  registrant.value = '該当なし';
  await registrant.dispatch('input');
  assert.equal(view.element.querySelectorAll('.breeding-card').length, 0);
  view.destroy();
});

test('設定: アカウントを末尾に移し、他の順序とログイン ID を保つ', (t) => {
  installDom(t);
  const view = settingsView(context());
  const sections = view.element.querySelectorAll('.settings-card');
  assert.deepEqual(sections.map((node) => node.querySelector('h2').textContent), [
    'データの状態', '記録を書き出す', '整合性の警告', 'アカウント',
  ]);
  assert.match(sections[3].textContent, /ログイン中の ID: 仲間.*ログアウト/);
  view.destroy();
});
