import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from '../helpers/dom.js';
import { segmented } from '../../web/js/ui/segmented.js';

const CAKES = [['none', 'なし', 'ケーキ・野菜ケーキ'], ['talent', 'キノコ等', 'キノコケーキ・豪華野菜ケーキ（個体値 +1〜5）'], ['special', 'スペシャル']];

// 部品を作って body に付ける。onChange で受けた値を changes に貯める
function mount(t, options = {}) {
  const dom = installDom(t);
  const changes = [];
  const part = segmented({ label: 'ケーキ', choices: CAKES, value: 'none', onChange: (value) => changes.push(value), ...options });
  t.after(() => part.destroy());
  dom.body.append(part.element);
  const radios = () => part.element.querySelectorAll('[role="radio"]');
  const radio = (value) => radios().find((node) => node.getAttribute('data-value') === value);
  // 選んでいる値・tabindex の並び
  const shown = () => radios().map((node) => [node.getAttribute('data-value'), node.getAttribute('aria-checked'), node.getAttribute('tabindex')]);
  return { ...dom, part, changes, radios, radio, shown };
}

test('押しボタンの選択: radiogroup の中に radio のボタンを並べ、選んでいるものだけ aria-checked と tabindex=0', (t) => {
  const { part, radios, radio, shown } = mount(t);
  assert.equal(part.element.getAttribute('role'), 'radiogroup');
  assert.equal(part.element.getAttribute('aria-label'), 'ケーキ');
  assert.ok(part.element.className.split(' ').includes('segmented'));
  assert.deepEqual(radios().map((node) => [node.tagName, node.type, node.textContent]), [['button', 'button', 'なし'], ['button', 'button', 'キノコ等'], ['button', 'button', 'スペシャル']]);
  // title は長い説明（無ければ付けない）
  assert.equal(radio('talent').title, 'キノコケーキ・豪華野菜ケーキ（個体値 +1〜5）');
  assert.equal(radio('special').title, undefined);
  assert.deepEqual(shown(), [['none', 'true', '0'], ['talent', 'false', '-1'], ['special', 'false', '-1']]);
});

test('押しボタンの選択: 押すと aria-checked が移り、onChange を 1 回だけ呼ぶ。選んでいるものを押しても呼ばない', async (t) => {
  const { changes, radio, shown } = mount(t);
  await radio('talent').dispatch('click');
  assert.deepEqual(changes, ['talent']);
  assert.deepEqual(shown(), [['none', 'false', '-1'], ['talent', 'true', '0'], ['special', 'false', '-1']]);
  await radio('talent').dispatch('click');
  assert.deepEqual(changes, ['talent']);
});

test('押しボタンの選択: ←→（↑↓）で隣へ移って選び、端では反対の端へ回る。Home・End で端へ', async (t) => {
  const { changes, radio, shown } = mount(t);
  radio('none').focus();
  const key = async (name) => {
    const result = await document.activeElement.dispatch('keydown', { key: name });
    assert.equal(result.defaultPrevented, true, name);
  };
  await key('ArrowRight');
  assert.equal(document.activeElement, radio('talent'));
  await key('ArrowDown');
  assert.equal(document.activeElement, radio('special'));
  await key('ArrowRight');
  assert.equal(document.activeElement, radio('none'));
  await key('ArrowLeft');
  assert.equal(document.activeElement, radio('special'));
  await key('ArrowUp');
  assert.equal(document.activeElement, radio('talent'));
  await key('Home');
  assert.equal(document.activeElement, radio('none'));
  await key('End');
  assert.equal(document.activeElement, radio('special'));
  assert.deepEqual(changes, ['talent', 'special', 'none', 'special', 'talent', 'none', 'special']);
  assert.deepEqual(shown().map(([value, checked]) => [value, checked]), [['none', 'false'], ['talent', 'false'], ['special', 'true']]);
  // ほかのキー（Tab など）は止めない
  const tab = await radio('special').dispatch('keydown', { key: 'Tab' });
  assert.equal(tab.defaultPrevented, false);
  assert.equal(changes.length, 7);
});

test('押しボタンの選択: update で外から反映し（onChange は呼ばない）、知らない値ならどれも選ばず先頭を tabindex=0 にする', (t) => {
  const { part, changes, shown } = mount(t);
  part.update('special');
  assert.deepEqual(shown(), [['none', 'false', '-1'], ['talent', 'false', '-1'], ['special', 'true', '0']]);
  part.update('知らない値');
  assert.deepEqual(shown(), [['none', 'false', '0'], ['talent', 'false', '-1'], ['special', 'false', '-1']]);
  assert.deepEqual(changes, []);
});

test('押しボタンの選択: destroy の後は押しても onChange を呼ばない', async (t) => {
  const { part, changes, radio } = mount(t);
  part.destroy();
  await radio('special').dispatch('click');
  await radio('none').dispatch('keydown', { key: 'ArrowRight' });
  assert.deepEqual(changes, []);
});
