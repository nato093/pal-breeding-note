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

test('押しボタンの選択: badge で 1 つの押しボタンに小さな印（見た目は隠して読み上げは「（最速）」）と title の補足を付け、別の値・null で付け替え・外す', async (t) => {
  const { part, changes, radio } = mount(t);
  const badges = () => part.element.querySelectorAll('.segmented-badge');
  part.badge('talent', { text: '最速', note: 'この条件でいちばん早く完成できるケーキ' });
  assert.equal(badges().length, 1);
  const [mark] = badges();
  assert.equal(mark.parentElement, radio('talent'));
  assert.equal(mark.textContent, '最速');
  assert.equal(mark.getAttribute('aria-hidden'), 'true');
  // 読み上げの名前は「キノコ等（最速）」。押しボタンの文字は残す
  assert.equal(radio('talent').textContent, 'キノコ等最速（最速）');
  assert.equal(radio('talent').querySelector('.visually-hidden').textContent, '（最速）');
  assert.equal(radio('talent').title, 'キノコケーキ・豪華野菜ケーキ（個体値 +1〜5）\nこの条件でいちばん早く完成できるケーキ');
  // 同じ指定では作り直さない
  part.badge('talent', { text: '最速', note: 'この条件でいちばん早く完成できるケーキ' });
  assert.equal(badges()[0], mark);
  // 付け替えると前の印と title の補足を外す。title の無い押しボタンは補足だけ
  part.badge('special', { text: '最速', note: '補足' });
  assert.deepEqual(badges().map((node) => node.parentElement), [radio('special')]);
  assert.equal(radio('talent').textContent, 'キノコ等');
  assert.equal(radio('talent').title, 'キノコケーキ・豪華野菜ケーキ（個体値 +1〜5）');
  assert.equal(radio('special').title, '補足');
  // 印の付いた押しボタンを押すと、ふつうに選ぶ（印は選択と関係しない）
  await radio('special').dispatch('click');
  assert.deepEqual(changes, ['special']);
  part.badge(null);
  assert.equal(badges().length, 0);
  assert.equal(radio('special').textContent, 'スペシャル');
  assert.equal(radio('special').title, '');
  // 知らない値は印を付けない
  part.badge('知らない値', { text: '最速' });
  assert.equal(badges().length, 0);
});

test('押しボタンの選択: setHidden は押しボタンを作り直さずに隠す・出す。隠した押しボタンへは矢印・Home・End で移らない', async (t) => {
  const { part, changes, radio, radios } = mount(t);
  const before = radios();
  part.setHidden('special', true);
  assert.equal(radio('special').hidden, true);
  assert.deepEqual(radios(), before);
  const press = (node, key) => node.dispatch('keydown', { key, preventDefault() {} });
  radio('none').focus();
  await press(radio('none'), 'ArrowLeft');
  assert.equal(document.activeElement, radio('talent'));
  await press(radio('talent'), 'ArrowRight');
  assert.equal(document.activeElement, radio('none'));
  await press(radio('none'), 'End');
  assert.equal(document.activeElement, radio('talent'));
  assert.deepEqual(changes, ['talent', 'none', 'talent']);
  // 出し直すと、また移れる
  part.setHidden('special', false);
  await press(radio('talent'), 'ArrowRight');
  assert.equal(document.activeElement, radio('special'));
  // 知らない値は何もしない
  part.setHidden('unknown', true);
  assert.equal(radios().some((node) => node.hidden), false);
});
