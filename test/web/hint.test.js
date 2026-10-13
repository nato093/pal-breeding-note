import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from '../helpers/dom.js';
import { hint } from '../../web/js/ui/hint.js';

// 説明の部品を作って body に付ける（t.after で板を片づける）
function mount(t, dom, options) {
  const part = hint(options);
  t.after(() => part.destroy());
  dom.body.append(part.element);
  return part;
}
// 開いている板（body に浮かせる）
const boards = () => document.body.querySelectorAll('.hint-popover');

test('説明の部品: 既定は「?」のボタン。押すと aria-expanded が true になり、板を body に浮かせて中身を textContent で出す', async (t) => {
  const dom = installDom(t);
  const part = mount(t, dom, { label: '除外', content: '性別不明の 1 体' });
  const button = part.element;
  assert.equal(button.tagName, 'button');
  assert.equal(button.type, 'button');
  assert.equal(button.textContent, '?');
  assert.ok(button.className.split(' ').includes('hint-button'));
  assert.equal(button.getAttribute('aria-label'), '除外の説明');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(boards().length, 0);
  await button.dispatch('click');
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  const [board] = boards();
  assert.ok(board);
  // 固定配置（周りの要素を動かさない）。開いてから中身を入れる読み上げの status
  assert.ok(board.className.split(' ').includes('picker-popover-floating'));
  assert.equal(board.getAttribute('role'), 'status');
  assert.equal(board.parentElement, document.body);
  assert.equal(button.getAttribute('aria-controls'), board.id);
  assert.equal(board.textContent, '性別不明の 1 体');
  // もう一度押すと閉じる
  await button.dispatch('click');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(boards().length, 0);
});

test('説明の部品: Esc で閉じてボタンにフォーカスを戻す', async (t) => {
  const dom = installDom(t);
  const part = mount(t, dom, { label: '完全体作成組', content: '欲しいパッシブと個体値の目標を全部満たす子を狙える組です。' });
  part.element.focus();
  await part.element.dispatch('click');
  assert.equal(boards().length, 1);
  dom.body.focus();
  await dom.events.dispatch('keydown', { key: 'Escape' });
  assert.equal(boards().length, 0);
  assert.equal(part.element.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, part.element);
});

test('説明の部品: 板は 1 度に 1 つ。ほかの説明を開くと前の板を閉じる', async (t) => {
  const dom = installDom(t);
  const first = mount(t, dom, { label: '一つ目', content: '一つ目の説明' });
  const second = mount(t, dom, { label: '二つ目', content: '二つ目の説明' });
  await first.element.dispatch('click');
  await second.element.dispatch('click');
  assert.deepEqual(boards().map((node) => node.textContent), ['二つ目の説明']);
  assert.equal(first.element.getAttribute('aria-expanded'), 'false');
  assert.equal(second.element.getAttribute('aria-expanded'), 'true');
});

test('説明の部品: trigger を渡すとその要素を開くボタンにし（「?」は作らない）、中身の関数は開くたびに呼ぶ', async (t) => {
  const dom = installDom(t);
  const trigger = document.createElement('button');
  trigger.textContent = '除外 2';
  let count = 1;
  const part = mount(t, dom, {
    label: '除外', trigger,
    content: () => [`性別不明の ${count} 体`, Object.assign(document.createElement('p'), { textContent: 'パッシブの条件を満たせない 1 組' })],
  });
  assert.equal(part.element, trigger);
  // 見えている文が名前（aria-label で上書きしない）
  assert.equal(trigger.textContent, '除外 2');
  assert.equal(trigger.getAttribute('aria-label'), null);
  await trigger.dispatch('click');
  assert.deepEqual(boards()[0].children.map((node) => node.textContent), ['性別不明の 1 体', 'パッシブの条件を満たせない 1 組']);
  await trigger.dispatch('click');
  count = 3;
  await trigger.dispatch('click');
  assert.match(boards()[0].textContent, /性別不明の 3 体/);
});

test('説明の部品: destroy で板を消し、その後は押しても開かない', async (t) => {
  const dom = installDom(t);
  const part = mount(t, dom, { label: '変更あり', content: '交換推奨の行き先の組です。' });
  await part.element.dispatch('click');
  assert.equal(boards().length, 1);
  part.destroy();
  assert.equal(boards().length, 0);
  assert.equal(part.element.getAttribute('aria-expanded'), 'false');
  await part.element.dispatch('click');
  assert.equal(boards().length, 0);
  // 外側を押して閉じたとき（destroy の前に開き直した別の部品）は、押した先にフォーカスを任せる
  const other = mount(t, dom, { label: '配置中', content: 'セーブで分かった組です。' });
  await other.element.dispatch('click');
  dom.body.focus();
  await dom.events.dispatch('pointerdown', { target: dom.body });
  assert.equal(boards().length, 0);
  assert.equal(document.activeElement, dom.body);
});
