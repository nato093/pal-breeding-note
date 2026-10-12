import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, FakeElement } from '../helpers/dom.js';
import { captureFocus, restoreFocus } from '../../web/js/ui/focus.js';

function node(tag, attributes = {}) {
  const element = new FakeElement(tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

// パッシブの選択欄と同じ形（チップの × と追加欄）
function selector(selected, { full = false } = {}) {
  const wrapper = node('div');
  for (const id of selected) {
    wrapper.append(node('button', { 'data-focus-key': `passive-chip:${id}`, 'data-focus-fallback': 'passive:欲しい', 'data-focus-group': 'passive:欲しい' }));
  }
  const add = node('select', { 'data-focus-key': 'passive:欲しい' });
  add.disabled = full;
  wrapper.append(add);
  return wrapper;
}

test('フォーカス: 作り直しても、同じ key の要素へ戻す（先祖の key も拾う）', (t) => {
  const { body } = installDom(t);
  const root = node('div');
  body.append(root);
  const chip = node('button', { 'data-focus-key': 'start:SheepBall' });
  const inner = node('span');
  chip.append(inner);
  root.append(chip);
  inner.focus();
  const token = captureFocus(root);
  assert.deepEqual(token, { key: 'start:SheepBall', fallback: null });
  const next = node('button', { 'data-focus-key': 'start:SheepBall' });
  root.replaceChildren(node('button', { 'data-focus-key': 'start:all' }), next);
  assert.equal(document.activeElement, body);
  assert.equal(restoreFocus(root, token), true);
  assert.equal(document.activeElement, next);
});

test('フォーカス: key が無くなったら fallback、押せなければ同じ group の最後の要素、どれも無ければ何もしない', (t) => {
  const { body } = installDom(t);
  const root = node('div');
  body.append(root);
  // チップの × で外す → 同じ id のチップは無いので、追加欄（fallback）へ
  root.append(selector(['A', 'B']));
  root.querySelector('[data-focus-key="passive-chip:B"]').focus();
  let token = captureFocus(root);
  root.replaceChildren(selector(['A']));
  restoreFocus(root, token);
  assert.equal(document.activeElement, root.querySelector('select'));
  // 4 個目を足して追加欄が押せなくなった → 残ったチップの最後の ×
  token = captureFocus(root);
  root.replaceChildren(selector(['A', 'B', 'C', 'D'], { full: true }));
  restoreFocus(root, token);
  assert.equal(document.activeElement, root.querySelector('[data-focus-key="passive-chip:D"]'));
  // 見つからなければ何もしない（見出しへは移さない）
  token = captureFocus(root);
  root.replaceChildren(node('h1'));
  assert.equal(restoreFocus(root, token), false);
  assert.equal(document.activeElement, body);
  // key の無い要素・root の外のフォーカスは覚えない
  const outside = node('button', { 'data-focus-key': 'outside' });
  body.append(outside);
  outside.focus();
  assert.equal(captureFocus(root), null);
  root.append(node('button'));
  root.children.at(-1).focus();
  assert.equal(captureFocus(root), null);
  assert.equal(restoreFocus(root, null), false);
});

test('フォーカス: 作り直さずにフォーカスが残っていれば動かさない。hidden の要素へは移さない', (t) => {
  const { body } = installDom(t);
  const root = node('div');
  body.append(root);
  const trigger = node('button', { 'data-focus-key': 'picker:親1' });
  const clear = node('button', { 'data-focus-key': 'picker-clear:親1', 'data-focus-fallback': 'picker:親1' });
  root.append(trigger, clear);
  clear.focus();
  const token = captureFocus(root);
  // × を押すと解除の × は隠れ、選択欄にフォーカスが移っている
  clear.hidden = true;
  trigger.focus();
  assert.equal(restoreFocus(root, token), false);
  assert.equal(document.activeElement, trigger);
  // 作り直して × が hidden のまま → 選択欄（fallback）へ
  const nextTrigger = node('button', { 'data-focus-key': 'picker:親1' });
  const nextClear = node('button', { 'data-focus-key': 'picker-clear:親1', 'data-focus-fallback': 'picker:親1' });
  nextClear.hidden = true;
  root.replaceChildren(nextTrigger, nextClear);
  restoreFocus(root, token);
  assert.equal(document.activeElement, nextTrigger);
});
