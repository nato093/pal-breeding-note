import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from '../helpers/dom.js';
import { searchSelect } from '../../web/js/ui/search-select.js';

const players = (count) => Array.from({ length: count }, (_, i) => [`player:${i}`, i % 2 ? `Bob${i}` : `ありす${i}`]);

// 部品を作って body に付ける。onChange で受けた値を changes に貯める
function mount(t, options = {}) {
  const dom = installDom(t);
  const changes = [];
  const part = searchSelect({ label: '所持者', options: [['', 'すべて'], ...players(3)], value: '', onChange: (value) => changes.push(value), ...options });
  t.after(() => part.destroy());
  dom.body.append(part.element);
  const select = () => part.element.querySelector('select');
  const trigger = () => part.element.querySelector('.search-select-trigger');
  const search = () => part.element.querySelector('.picker-search');
  const shown = () => part.element.querySelectorAll('[role="option"]').map((node) => node.textContent);
  return { ...dom, part, changes, select, trigger, search, shown };
}

test('検索つきの選択: 選択肢が 12 件以下なら普通の select で、選ぶと onChange を呼ぶ。update は呼ばない', async (t) => {
  const { part, changes, select, trigger } = mount(t, { value: 'player:1' });
  assert.ok(part.element.className.split(' ').includes('search-select'));
  assert.equal(trigger(), null);
  assert.equal(select().getAttribute('aria-label'), '所持者');
  assert.deepEqual(select().children.map((node) => [node.value, node.textContent]), [['', 'すべて'], ['player:0', 'ありす0'], ['player:1', 'Bob1'], ['player:2', 'ありす2']]);
  assert.equal(select().value, 'player:1');
  select().value = 'player:2';
  await select().dispatch('change');
  assert.deepEqual(changes, ['player:2']);
  // 外からの反映（同じ選択肢なら作り直さない）
  const before = select();
  const options = select().children;
  part.update({ options: [['', 'すべて'], ...players(3)], value: '' });
  assert.equal(select(), before);
  assert.deepEqual(select().children, options);
  assert.equal(select().value, '');
  assert.deepEqual(changes, ['player:2']);
});

test('検索つきの選択: 12 件を超えたら、押すと検索欄つきの候補を開き、読みをそろえた部分一致で絞って選べる', async (t) => {
  const { part, changes, select, trigger, search, shown } = mount(t, { options: [['', 'すべて'], ...players(13)], value: 'player:3' });
  assert.equal(select(), null);
  assert.equal(trigger().textContent, 'Bob3');
  assert.equal(trigger().getAttribute('aria-label'), '所持者: Bob3');
  assert.equal(trigger().getAttribute('aria-haspopup'), 'listbox');
  await trigger().dispatch('click');
  assert.equal(document.activeElement, search());
  assert.equal(search().getAttribute('aria-label'), '所持者を検索');
  assert.equal(shown().length, 14);
  // 選んでいるものに印
  assert.equal(part.element.querySelector('[aria-selected="true"]').textContent, 'Bob3');
  // ひらがなとカタカナの違いはそろえる
  search().value = 'アリス1';
  await search().dispatch('input');
  assert.deepEqual(shown(), ['ありす10', 'ありす12']);
  await part.element.querySelector('[data-value="player:12"]').dispatch('click');
  assert.deepEqual(changes, ['player:12']);
  assert.equal(search(), null);
  assert.equal(document.activeElement, trigger());
});

test('検索つきの選択: 矢印で選んだときだけ Enter で決め、Esc で閉じてボタンへ戻る', async (t) => {
  const { changes, trigger, search, part } = mount(t, { options: [['', 'すべて'], ...players(13)], value: '' });
  await trigger().dispatch('click');
  // 矢印で選んでいない Enter は何もしない
  await search().dispatch('keydown', { key: 'Enter', preventDefault() {} });
  assert.deepEqual(changes, []);
  search().value = 'bob';
  await search().dispatch('input');
  await search().dispatch('keydown', { key: 'ArrowDown', preventDefault() {} });
  await search().dispatch('keydown', { key: 'ArrowDown', preventDefault() {} });
  assert.equal(part.element.querySelector('.highlighted').textContent, 'Bob3');
  await search().dispatch('keydown', { key: 'Enter', preventDefault() {} });
  assert.deepEqual(changes, ['player:3']);
  await trigger().dispatch('click');
  await search().dispatch('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.equal(search(), null);
  assert.equal(document.activeElement, trigger());
  // 当てはまらないときは文を出す
  await trigger().dispatch('click');
  search().value = '該当なし';
  await search().dispatch('input');
  assert.match(part.element.querySelector('.picker-status').textContent, /当てはまる候補がありません/);
});

test('検索つきの選択: update で件数が閾値をまたぐと select と検索つきのボタンを入れ替え、知らない値のときは先頭の選択肢の名前を出す', (t) => {
  const { part, select, trigger } = mount(t);
  part.update({ options: [['', 'すべて'], ...players(20)], value: 'player:19' });
  assert.equal(select(), null);
  assert.equal(trigger().textContent, 'Bob19');
  part.update({ options: [['', 'すべて'], ...players(20)], value: 'player:99' });
  assert.equal(trigger().textContent, 'すべて');
  part.update({ options: [['', 'すべて'], ...players(2)], value: 'player:1' });
  assert.equal(trigger(), null);
  assert.equal(select().value, 'player:1');
});

test('検索つきの選択: 日本語の変換中（isComposing・keyCode 229）の矢印・Enter・Esc は候補の操作に使わない（B4: 変換を確定する Enter で候補を選んでいた）', async (t) => {
  const { changes, trigger, search, part } = mount(t, { options: [['', 'すべて'], ...players(13)], value: '' });
  await trigger().dispatch('click');
  search().value = 'bob';
  await search().dispatch('input');
  await search().dispatch('keydown', { key: 'ArrowDown', preventDefault() {} });
  assert.equal(part.element.querySelector('.highlighted').textContent, 'Bob1');
  // 変換中の矢印は候補を動かさず、Enter（変換の確定）で選ばず、Esc（変換の取り消し）で閉じない
  let prevented = false;
  await search().dispatch('keydown', { key: 'ArrowDown', isComposing: true, preventDefault() { prevented = true; } });
  assert.equal(part.element.querySelector('.highlighted').textContent, 'Bob1');
  await search().dispatch('keydown', { key: 'Enter', isComposing: true, preventDefault() { prevented = true; } });
  await search().dispatch('keydown', { key: 'Enter', keyCode: 229, preventDefault() { prevented = true; } });
  await search().dispatch('keydown', { key: 'Escape', isComposing: true, preventDefault() { prevented = true; }, stopPropagation() {} });
  assert.deepEqual(changes, []);
  assert.equal(prevented, false);
  assert.ok(search());
  // 確定した後の Enter で選ぶ
  await search().dispatch('keydown', { key: 'Enter', preventDefault() {} });
  assert.deepEqual(changes, ['player:1']);
});
