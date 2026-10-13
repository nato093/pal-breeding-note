import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from '../helpers/dom.js';
import { talentInput } from '../../web/js/ui/talent-input.js';

const KEYS = ['hp', 'shot', 'defense'];
const LABELS = { hp: 'HP', shot: '攻撃', defense: '防御' };

// 部品を作って body に付ける。onChange で受けた値を changes に貯める
function mount(t, options = {}) {
  const dom = installDom(t);
  const changes = [];
  const input = talentInput({
    keys: KEYS, labels: LABELS, value: { hp: 0, shot: 0, defense: 0 },
    ariaLabel: (key) => `${LABELS[key]}の目標`,
    onChange: (value) => changes.push(value),
    ...options,
  });
  t.after(() => input.destroy());
  dom.body.append(input.element);
  const items = () => input.element.querySelectorAll('.talent-input-item');
  const item = (key) => items()[KEYS.indexOf(key)];
  const number = (key) => input.element.querySelectorAll('input').find((node) => node.getAttribute('aria-label') === `${LABELS[key]}の目標`);
  const check = (key) => input.element.querySelectorAll('input').find((node) => node.getAttribute('aria-label') === `${LABELS[key]}を条件にする`);
  const off = (key) => item(key).className.split(' ').includes('is-off');
  const shown = () => KEYS.map((key) => [check(key).checked, number(key).value, off(key)]);
  return { ...dom, input, changes, items, item, number, check, off, shown };
}

async function type(node, value, extra = {}) {
  node.value = value;
  await node.dispatch('input', extra);
}

test('個体値の入力: ステータスごとに ☑ ラベル [数値] 以上 を並べ、値 0 は未チェック・空欄、v>0 はチェックつき・その値で出す', (t) => {
  const { input, items, item, number, check, shown } = mount(t, { value: { hp: 0, shot: 100, defense: 90 } });
  assert.ok(input.element.className.split(' ').includes('talent-input'));
  assert.equal(items().length, 3);
  // 部品の中の並び: チェックボックス・ラベル・数値欄・「以上」
  const [box, label, field, unit] = item('hp').children;
  assert.equal(item('hp').tagName, 'label');
  assert.equal(box, check('hp'));
  assert.equal(box.type, 'checkbox');
  assert.equal(label.textContent, 'HP');
  assert.equal(field, number('hp'));
  assert.equal(unit.className, 'talent-input-unit');
  assert.equal(unit.textContent, '以上');
  // 数値欄の形
  assert.deepEqual([field.type, field.min, field.max, field.step, field.inputMode, field.placeholder, field.title],
    ['number', '0', '100', '1', 'numeric', '—', '空欄かチェックなしは条件なし']);
  assert.equal(check('shot').getAttribute('aria-label'), '攻撃を条件にする');
  // 0 は未チェック・空欄（薄くする）、v>0 はチェックつき・String(v)
  assert.deepEqual(shown(), [[false, '', true], [true, '100', false], [true, '90', false]]);
  // 未チェックの欄も押せる（disabled にしない）
  assert.equal(number('hp').disabled, false);
});

test('個体値の入力: 数字を入れると自動でチェックが付き、間引き（既定 150ms）の後に 1 回だけ onChange を呼ぶ', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { changes, number, check, off } = mount(t);
  await type(number('hp'), '9');
  // チェックは打った時点で付く
  assert.equal(check('hp').checked, true);
  assert.equal(off('hp'), false);
  await type(number('hp'), '95');
  t.mock.timers.tick(149);
  assert.deepEqual(changes, []);
  t.mock.timers.tick(1);
  assert.deepEqual(changes, [{ hp: 95, shot: 0, defense: 0 }]);
  t.mock.timers.tick(1000);
  assert.equal(changes.length, 1);
});

test('個体値の入力: 確定（change）は間引きを待たずに知らせ、欄を丸めた値に書き戻す（101 → 100、0 は空欄・未チェック）', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { changes, number, check, off } = mount(t);
  await type(number('shot'), '101');
  await number('shot').dispatch('change');
  assert.deepEqual(changes, [{ hp: 0, shot: 100, defense: 0 }]);
  assert.equal(number('shot').value, '100');
  assert.equal(check('shot').checked, true);
  // 小数は切り捨てて書き戻す
  await type(number('shot'), '90.7');
  await number('shot').dispatch('change');
  assert.equal(number('shot').value, '90');
  assert.deepEqual(changes.at(-1), { hp: 0, shot: 90, defense: 0 });
  // 0 を入れて確定すると、空欄にしてチェックを外す（値は 0 ＝条件なし）
  await type(number('shot'), '0');
  await number('shot').dispatch('change');
  assert.equal(number('shot').value, '');
  assert.equal(check('shot').checked, false);
  assert.equal(off('shot'), true);
  assert.deepEqual(changes.at(-1), { hp: 0, shot: 0, defense: 0 });
  // 待っている入力のない確定（もう知らせた後）では、もう一度は知らせない
  const before = changes.length;
  await type(number('defense'), '80');
  t.mock.timers.tick(150);
  await number('defense').dispatch('change');
  assert.equal(changes.length, before + 1);
});

test('個体値の入力: チェックを外すと onChange の値は 0 で、欄の数字は残して薄くする。付け直すと残した数字で条件に戻る', async (t) => {
  const { changes, number, check, off } = mount(t, { value: { hp: 90, shot: 0, defense: 0 } });
  check('hp').checked = false;
  await check('hp').dispatch('change');
  assert.deepEqual(changes, [{ hp: 0, shot: 0, defense: 0 }]);
  assert.equal(number('hp').value, '90');
  assert.equal(off('hp'), true);
  check('hp').checked = true;
  await check('hp').dispatch('change');
  assert.deepEqual(changes.at(-1), { hp: 90, shot: 0, defense: 0 });
  assert.equal(off('hp'), false);
});

test('個体値の入力: 空欄のままチェックを付けると数値欄へフォーカスし、空欄のまま離れるとチェックを外す', async (t) => {
  const { changes, number, check, off } = mount(t);
  check('defense').checked = true;
  await check('defense').dispatch('change');
  assert.equal(document.activeElement, number('defense'));
  // 空欄なので値は 0 のまま
  assert.deepEqual(changes, [{ hp: 0, shot: 0, defense: 0 }]);
  await number('defense').dispatch('focus');
  await number('defense').dispatch('blur');
  assert.equal(check('defense').checked, false);
  assert.equal(off('defense'), true);
  // 数字があれば、離れてもチェックは残す
  await type(number('hp'), '50');
  await number('hp').dispatch('blur');
  assert.equal(check('hp').checked, true);
});

test('個体値の入力: 空欄でチェックのある欄から、チェックボックス・ラベルを押して外すとき、離れたときの外しで押した後にまた付かない', async (t) => {
  const { changes, number, check, item } = mount(t);
  check('hp').checked = true;
  await check('hp').dispatch('change');
  await number('hp').dispatch('focus');
  // ラベルの中（数値欄の外）を押す → 数値欄から離れる → 押したチェックボックスの click で外れる
  await item('hp').dispatch('pointerdown', { target: check('hp') });
  check('hp').focus();
  await number('hp').dispatch('blur');
  assert.equal(check('hp').checked, true);
  check('hp').checked = false;
  await check('hp').dispatch('change');
  assert.equal(check('hp').checked, false);
  assert.deepEqual(changes.at(-1), { hp: 0, shot: 0, defense: 0 });
  // 外したときは数値欄へ移さない
  assert.equal(document.activeElement, check('hp'));
  // 押した後の離れでは、いつもどおり空欄ならチェックを外す
  check('shot').checked = true;
  await check('shot').dispatch('change');
  await number('shot').dispatch('focus');
  await number('shot').dispatch('blur');
  assert.equal(check('shot').checked, false);
});

test('個体値の入力: 日本語の変換中は知らせず、変換を確定したら知らせる', async (t) => {
  const { changes, number, check } = mount(t, { debounce: 0 });
  await number('hp').dispatch('compositionstart');
  await type(number('hp'), '７', { isComposing: true });
  await number('hp').dispatch('change');
  assert.deepEqual(changes, []);
  await type(number('hp'), '70');
  await number('hp').dispatch('compositionend');
  assert.deepEqual(changes, [{ hp: 70, shot: 0, defense: 0 }]);
  assert.equal(check('hp').checked, true);
  // isComposing だけが付いた input でも知らせない
  await type(number('shot'), '６', { isComposing: true });
  assert.equal(changes.length, 1);
});

test('個体値の入力: presets のボタンを押すと全部のステータスを書き換え、間引かずに 1 回だけ知らせる', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { input, changes, number, shown } = mount(t, {
    value: { hp: 0, shot: 100, defense: 0 },
    presets: [{ label: 'すべて 90 以上', value: { hp: 90, shot: 90, defense: 90 } }, { label: 'すべて 100', value: { hp: 100, shot: 100, defense: 100 } }],
  });
  const buttons = input.element.querySelectorAll('button');
  assert.deepEqual(buttons.map((node) => [node.textContent, node.className, node.type]),
    [['すべて 90 以上', 'button secondary small', 'button'], ['すべて 100', 'button secondary small', 'button']]);
  // 打っている途中（間引きの待ち）に押しても、知らせるのはボタンの 1 回だけ
  await type(number('hp'), '5');
  await buttons[0].dispatch('click');
  assert.deepEqual(changes, [{ hp: 90, shot: 90, defense: 90 }]);
  assert.deepEqual(shown(), [[true, '90', false], [true, '90', false], [true, '90', false]]);
  t.mock.timers.tick(1000);
  assert.equal(changes.length, 1);
  await buttons[1].dispatch('click');
  assert.deepEqual(changes, [{ hp: 90, shot: 90, defense: 90 }, { hp: 100, shot: 100, defense: 100 }]);
});

test('個体値の入力: update() で外から反映する（違う値だけ書き換え、知らせない。出している値と同じなら、薄くした数字・打っている数字を残す）', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { input, changes, number, check, shown } = mount(t, { value: { hp: 90, shot: 100, defense: 0 } });
  // 外したチェック（数字は薄く残す）は、同じ 0 が来ても消さない
  check('hp').checked = false;
  await check('hp').dispatch('change');
  changes.length = 0;
  input.update({ hp: 0, shot: 100, defense: 0 });
  assert.deepEqual(shown(), [[false, '90', true], [true, '100', false], [false, '', true]]);
  // 違う値は入れ直す。0 は未チェック・空欄、v>0 はチェックつき（登録した目標の呼び出し・戻る・進む）
  input.update({ hp: 0, shot: 0, defense: 80 });
  assert.deepEqual(shown(), [[false, '90', true], [false, '', true], [true, '80', false]]);
  input.update({ hp: 70, shot: 0, defense: 80 });
  assert.deepEqual(shown(), [[true, '70', false], [false, '', true], [true, '80', false]]);
  input.update({ hp: 0, shot: 0, defense: 80 });
  assert.deepEqual(shown(), [[false, '', true], [false, '', true], [true, '80', false]]);
  assert.deepEqual(changes, []);
  // 打っている途中に違う値が来たら、外の値を出し、待っていた入力は知らせない
  await type(number('defense'), '5');
  input.update({ hp: 0, shot: 0, defense: 60 });
  assert.equal(number('defense').value, '60');
  t.mock.timers.tick(1000);
  assert.deepEqual(changes, []);
});

test('個体値の入力: flush() は待っている入力をすぐ知らせ、destroy() の後はタイマーが走らない', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { input, changes, number } = mount(t);
  await type(number('hp'), '40');
  input.flush();
  assert.deepEqual(changes, [{ hp: 40, shot: 0, defense: 0 }]);
  input.flush();
  assert.equal(changes.length, 1);
  await type(number('hp'), '41');
  input.destroy();
  t.mock.timers.tick(1000);
  assert.equal(changes.length, 1);
});

test('個体値の入力: debounce: 0 なら打った時点で知らせる（ビューのテストの inputDelay: 0）', async (t) => {
  const { changes, number } = mount(t, { debounce: 0 });
  await type(number('defense'), '33');
  assert.deepEqual(changes, [{ hp: 0, shot: 0, defense: 33 }]);
  // 空にすると 0（チェックは離れるまで残す）
  await type(number('defense'), '');
  assert.deepEqual(changes.at(-1), { hp: 0, shot: 0, defense: 0 });
});
