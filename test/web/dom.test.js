import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, installResizeObserver } from '../helpers/dom.js';
import { el, button, syncList, listKeys, clearList, anchorOf, restoreAnchor, debounce, onTextInput, trackHeight, svgElement, empty, storageWarning } from '../../web/js/ui/dom.js';

// 行の部品（{ element, update, destroy }）。作った数・更新・破棄を数える
function rows() {
  const log = { created: [], updated: [], destroyed: [] };
  const create = (item) => {
    log.created.push(item.id);
    const element = el('article', 'row');
    const label = el('span', 'label', item.label);
    const edit = button('編集', null, 'edit');
    edit.setAttribute('data-focus', 'edit');
    const remove = button('削除', null, 'remove');
    remove.setAttribute('data-focus', 'remove');
    element.append(label, edit, remove);
    return {
      element,
      update(next) { log.updated.push(next.id); label.textContent = next.label; },
      destroy() { log.destroyed.push(item.id); },
    };
  };
  return { log, options: { key: (item) => item.id, create } };
}
const items = (...ids) => ids.map((id) => ({ id, label: `行 ${id}` }));
const labels = (container) => container.children.map((node) => node.querySelector('.label').textContent);

test('syncList: 同じ key の要素を使い回して update し、消えた行だけ destroy する', (t) => {
  installDom(t);
  const container = el('div');
  const { log, options } = rows();
  syncList(container, items('a', 'b', 'c'), options);
  const [a, b, c] = container.children;
  assert.deepEqual(log.created, ['a', 'b', 'c']);
  syncList(container, [{ id: 'a', label: '変えた a' }, { id: 'c', label: '行 c' }], options);
  assert.deepEqual(container.children, [a, c]);
  assert.deepEqual(log.created, ['a', 'b', 'c']);
  assert.deepEqual(log.destroyed, ['b']);
  assert.deepEqual(labels(container), ['変えた a', '行 c']);
  assert.ok(!b.parentElement);
  assert.deepEqual([...listKeys(container)], ['a', 'c']);
});

test('syncList: 並びが変わったときは、位置の違う行だけを insertBefore する', (t) => {
  installDom(t);
  const container = el('div');
  const { options } = rows();
  syncList(container, items('a', 'b', 'c', 'd'), options);
  const before = [...container.children];
  let moved = 0;
  const insert = container.insertBefore.bind(container);
  container.insertBefore = (node, reference) => { moved++; return insert(node, reference); };
  // d を先頭へ（ほかの 3 行は位置が 1 つずつずれるだけで、動かすのは d だけ）
  syncList(container, items('d', 'a', 'b', 'c'), options);
  assert.equal(moved, 1);
  assert.deepEqual(container.children, [before[3], before[0], before[1], before[2]]);
  moved = 0;
  syncList(container, items('d', 'a', 'b', 'c'), options);
  assert.equal(moved, 0);
});

test('syncList: 同期の後で、同じ行の同じ部品（data-focus）にフォーカスを戻す', (t) => {
  installDom(t);
  const container = el('div');
  document.body.append(container);
  const { options } = rows();
  syncList(container, items('a', 'b', 'c'), options);
  const remove = container.children[2].querySelector('[data-focus="remove"]');
  remove.focus();
  // 並べ替えで c の行を動かす（付け直すとフォーカスが外れる）
  syncList(container, items('c', 'a', 'b'), options);
  assert.equal(document.activeElement, remove);
});

test('syncList: フォーカスのある行が消えたら、次の行（なければ前の行）の最初の部品へ移し、どちらも無ければ fallbackFocus へ', (t) => {
  installDom(t);
  const container = el('div');
  const fallback = button('追加');
  document.body.append(container, fallback);
  const { options } = rows();
  syncList(container, items('a', 'b', 'c'), options);
  container.children[1].querySelector('[data-focus="remove"]').focus();
  syncList(container, items('a', 'c'), options);
  // 同じボタンではなく、次の行の最初の部品（Enter の長押しで続けて消さない）
  assert.equal(document.activeElement, container.children[1].querySelector('[data-focus="edit"]'));
  container.children[1].querySelector('[data-focus="remove"]').focus();
  syncList(container, items('a'), options);
  assert.equal(document.activeElement, container.children[0].querySelector('[data-focus="edit"]'));
  container.children[0].querySelector('[data-focus="edit"]').focus();
  syncList(container, [], { ...options, fallbackFocus: fallback });
  assert.equal(document.activeElement, fallback);
});

test('syncList: 空のときは empty の要素を 1 つだけ出し、行が来たら消す。clearList はすべて destroy して空にする', (t) => {
  installDom(t);
  const container = el('div');
  const { log, options } = rows();
  const empty = () => el('p', 'empty', 'ありません');
  syncList(container, [], { ...options, empty });
  assert.deepEqual(container.children.map((node) => node.className), ['empty']);
  syncList(container, items('a', 'b'), { ...options, empty });
  assert.deepEqual(labels(container), ['行 a', '行 b']);
  syncList(container, [], { ...options, empty });
  assert.deepEqual(container.children.map((node) => node.className), ['empty']);
  assert.deepEqual(log.destroyed, ['a', 'b']);
  syncList(container, items('c'), options);
  clearList(container);
  assert.equal(container.children.length, 0);
  assert.deepEqual(log.destroyed, ['a', 'b', 'c']);
  assert.equal(listKeys(container).size, 0);
  // 空にした後は作り直す
  syncList(container, items('c'), options);
  assert.deepEqual(log.created, ['a', 'b', 'c', 'c']);
});

test('syncList: 空の表示は入れ物ごとに覚え、同じ文なら作り直さない（中のボタンのフォーカスが外れない）。文が変われば入れ替える', (t) => {
  installDom(t);
  const container = el('div');
  document.body.append(container);
  const { options } = rows();
  const empty = (text) => () => {
    const node = el('div', 'empty', text);
    node.append(button('登録', null, 'register'));
    return node;
  };
  syncList(container, [], { ...options, empty: empty('ありません') });
  const [shown] = container.children;
  const register = shown.querySelector('.register');
  register.focus();
  syncList(container, [], { ...options, empty: empty('ありません') });
  assert.equal(container.children[0], shown);
  assert.equal(document.activeElement, register);
  syncList(container, [], { ...options, empty: empty('別の文') });
  assert.notEqual(container.children[0], shown);
  assert.equal(container.children[0].textContent, '別の文登録');
  // 行が来たら空の表示を外し、空に戻ったらまた 1 つだけ出す
  syncList(container, items('a'), options);
  assert.deepEqual(labels(container), ['行 a']);
  syncList(container, [], { ...options, empty: empty('別の文') });
  assert.deepEqual(container.children.map((node) => node.textContent), ['別の文登録']);
});

test('anchorOf・restoreAnchor: 固定のヘッダーの下で最初に見えている行を覚え、同期の後で同じ位置に戻す', (t) => {
  const { windowEvents } = installDom(t);
  const container = el('div');
  document.body.append(container);
  const { options } = rows();
  syncList(container, items('a', 'b', 'c', 'd'), options);
  // 行の高さ 50px。今は c がヘッダー（下端 56px）の直下にある
  let offset = -60;
  const place = () => container.children.forEach((node, i) => {
    node.getBoundingClientRect = () => ({ top: offset + i * 50, bottom: offset + (i + 1) * 50, height: 50 });
  });
  place();
  const anchor = anchorOf(container, 56);
  assert.deepEqual(anchor, { key: 'c', top: 40 });
  // 上に 2 行足されて c が 100px 下がった
  syncList(container, items('x', 'y', 'a', 'b', 'c', 'd'), options);
  place();
  const scrolls = [];
  windowEvents.scrollBy = (x, y) => scrolls.push([x, y]);
  assert.equal(restoreAnchor(container, anchor), true);
  assert.deepEqual(scrolls, [[0, 100]]);
  assert.equal(restoreAnchor(container, { key: 'z', top: 0 }), false);
  assert.equal(anchorOf(el('div'), 0), null);
});

test('debounce: 最後の呼び出しから ms 待って 1 回だけ呼び、flush ですぐ、cancel で取り消す。0 なら同期', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const run = debounce((value) => calls.push(value), 150);
  run(1);
  run(2);
  t.mock.timers.tick(149);
  assert.deepEqual(calls, []);
  t.mock.timers.tick(1);
  assert.deepEqual(calls, [2]);
  run(3);
  run.flush();
  assert.deepEqual(calls, [2, 3]);
  run.flush();
  assert.deepEqual(calls, [2, 3]);
  run(4);
  run.cancel();
  t.mock.timers.tick(500);
  assert.deepEqual(calls, [2, 3]);
  const sync = debounce((value) => calls.push(value), 0);
  sync(5);
  assert.deepEqual(calls, [2, 3, 5]);
});

test('onTextInput: 入力を間引き、日本語の変換中（compositionstart〜compositionend・isComposing）は呼ばず、確定と change で呼ぶ', async (t) => {
  installDom(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const input = el('input');
  const values = [];
  onTextInput(input, (value) => values.push(value), { delay: 150 });
  input.value = 'も';
  await input.dispatch('input');
  t.mock.timers.tick(150);
  assert.deepEqual(values, ['も']);
  await input.dispatch('compositionstart');
  input.value = 'もこ';
  await input.dispatch('input', { isComposing: true });
  input.value = 'もころ';
  await input.dispatch('input');
  t.mock.timers.tick(500);
  assert.deepEqual(values, ['も']);
  input.value = 'モコロン';
  await input.dispatch('compositionend');
  t.mock.timers.tick(150);
  assert.deepEqual(values, ['も', 'モコロン']);
  // 変換を通さない入力で isComposing が付いているときも呼ばない
  input.value = 'x';
  await input.dispatch('input', { isComposing: true });
  t.mock.timers.tick(500);
  assert.deepEqual(values, ['も', 'モコロン']);
  // change（Enter・欄を離れる）は待っている呼び出しをすぐ呼ぶ
  input.value = 'あ';
  await input.dispatch('input');
  await input.dispatch('change');
  assert.deepEqual(values, ['も', 'モコロン', 'あ']);
  t.mock.timers.tick(500);
  assert.deepEqual(values, ['も', 'モコロン', 'あ']);
  // signal で外すと、それ以上呼ばない
  const controller = new AbortController();
  const other = el('input');
  const seen = [];
  onTextInput(other, (value) => seen.push(value), { delay: 150, signal: controller.signal });
  other.value = 'a';
  await other.dispatch('input');
  controller.abort();
  t.mock.timers.tick(500);
  await other.dispatch('input');
  t.mock.timers.tick(500);
  assert.deepEqual(seen, []);
});

test('trackHeight: target の高さを host の CSS 変数に書き続け、同じ高さでは書き直さない。戻り値で監視をやめる', (t) => {
  installDom(t);
  const { resize, observed } = installResizeObserver(t);
  const panel = el('section');
  const host = el('section');
  const writes = [];
  const set = host.style.setProperty;
  host.style.setProperty = (name, value) => { writes.push([name, value]); set(name, value); };
  const stop = trackHeight(panel, host);
  assert.ok(observed(panel));
  resize(panel, 128.4);
  assert.equal(host.style.getPropertyValue('--panel-h'), '128.4px');
  // 同じ高さの知らせ（中の部品だけが変わった）では書かない
  resize(panel, 128.4);
  resize(panel, 166);
  assert.deepEqual(writes, [['--panel-h', '128.4px'], ['--panel-h', '166px']]);
  // measure() は知らせを待たずに今の高さを書く（同じフレームの中で高さを使う前に呼ぶ。B6）
  panel.getBoundingClientRect = () => ({ top: 64, bottom: 274, height: 210 });
  stop.measure();
  assert.equal(host.style.getPropertyValue('--panel-h'), '210px');
  resize(panel, 210);
  assert.equal(writes.length, 3);
  // 名前を変えられる（別の要素の高さを同じ host に）
  const strip = el('div');
  trackHeight(strip, host, '--strip-h');
  resize(strip, 44);
  assert.equal(host.style.getPropertyValue('--strip-h'), '44px');
  // やめた後は書かない
  stop();
  resize(panel, 300);
  assert.equal(host.style.getPropertyValue('--panel-h'), '210px');
});

test('trackHeight: ResizeObserver が無い環境では 1 回だけ測って書き、やめる関数は何もしない', (t) => {
  installDom(t);
  assert.equal(globalThis.ResizeObserver, undefined);
  const panel = el('section');
  const host = el('section');
  // テストの DOM の getBoundingClientRect は top 200・bottom 252（高さ 52）
  const stop = trackHeight(panel, host);
  assert.equal(host.style.getPropertyValue('--panel-h'), '52px');
  assert.doesNotThrow(stop);
});

test('svgElement: SVG の要素を名前空間つきで作り、属性を文字列にして付ける。style とイベントの属性（on*）は大文字小文字によらず投げる', (t) => {
  installDom(t);
  const node = svgElement('circle', { cx: 4, r: 2.5, 'aria-hidden': 'true' });
  assert.equal(node.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(node.tagName, 'circle');
  assert.deepEqual([node.getAttribute('cx'), node.getAttribute('r'), node.getAttribute('aria-hidden')], ['4', '2.5', 'true']);
  for (const name of ['style', 'STYLE', 'onload', 'OnClick']) assert.throws(() => svgElement('svg', { [name]: 'x' }), new RegExp(name), name);
});

test('empty: 文（と操作）だけの空の表示で、隠すだけの「◇」を作らない', (t) => {
  installDom(t);
  const action = button('追加する');
  const node = empty('まだありません。', action);
  assert.equal(node.className, 'empty-state');
  assert.deepEqual(node.children.map((child) => child.tagName), ['p', 'button']);
  assert.equal(node.textContent, 'まだありません。追加する');
  assert.equal(node.querySelector('.empty-symbol'), null);
  assert.deepEqual(empty('なし').children.map((child) => child.tagName), ['p']);
});

test('storageWarning: この端末への保存に失敗したときの共通の短い警告（role="alert"・画面ごとのクラスを足せる）', (t) => {
  installDom(t);
  const node = storageWarning('下書き', 'drafts-warning');
  assert.equal(node.tagName, 'p');
  assert.equal(node.className, 'form-errors storage-warning drafts-warning');
  assert.equal(node.getAttribute('role'), 'alert');
  assert.equal(node.textContent, 'この端末に下書きを保存できませんでした（ページを閉じると消えます）');
  assert.equal(storageWarning('目標').className, 'form-errors storage-warning');
});
