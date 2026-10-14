import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from '../helpers/dom.js';
import { openDialog } from '../../web/js/ui/dialog.js';
import { toast, TOAST_DURATION, ACTION_DURATION, ERROR_DURATION } from '../../web/js/ui/toast.js';

const hasClass = (node, name) => node.className.split(' ').includes(name);
// テストの時計（setTimeout と Date を進める）。ms だけ進めた後に、トーストが残っているかを見る
function clock(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  return (ms) => t.mock.timers.tick(ms);
}
// 動きを減らす設定（matchMedia）を差し替える。返す関数に true・false を渡すとその設定、null なら matchMedia を消す（テストの DOM と同じ）
function motion(t) {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
  t.after(() => (before ? Object.defineProperty(globalThis, 'matchMedia', before) : Reflect.deleteProperty(globalThis, 'matchMedia')));
  return (reduce) => {
    if (reduce === null) Reflect.deleteProperty(globalThis, 'matchMedia');
    else globalThis.matchMedia = (query) => ({ matches: query === '(prefers-reduced-motion: reduce)' && reduce });
  };
}

test('トースト: 文言だけは 3 秒、操作つきとエラーは 6 秒で消え、残り時間の長さを --toast-duration で渡す', (t) => {
  const { body } = installDom(t);
  const tick = clock(t);
  assert.deepEqual([TOAST_DURATION, ACTION_DURATION, ERROR_DURATION], [3000, 6000, 6000]);
  toast('保存しました');
  toast('削除しました', { action() {} });
  toast('保存できませんでした', { kind: 'error' });
  const [info, undo, error] = ['保存しました', '削除しました', '保存できませんでした']
    .map((text) => body.querySelectorAll('.toast').find((node) => node.textContent.startsWith(text)));
  // 残り時間の線の長さは style 属性の文字列ではなく setProperty で渡す
  assert.equal(info.style.getPropertyValue('--toast-duration'), '3000ms');
  assert.equal(undo.style.getPropertyValue('--toast-duration'), '6000ms');
  assert.equal(error.style.getPropertyValue('--toast-duration'), '6000ms');
  tick(2999);
  assert.equal(body.querySelectorAll('.toast').length, 3);
  tick(1);
  assert.equal(info.isConnected, false);
  tick(2999);
  assert.equal(undo.isConnected, true);
  assert.equal(error.isConnected, true);
  tick(1);
  assert.equal(body.querySelectorAll('.toast').length, 0);
  // 長さを渡したときはその長さ（今までの呼び出し方）
  toast('すぐ消える', { duration: 1000 });
  assert.equal(body.querySelector('.toast').style.getPropertyValue('--toast-duration'), '1000ms');
  tick(1000);
  assert.equal(body.querySelectorAll('.toast').length, 0);
});

test('トースト: マウスが乗っている間は止め（線も .paused で止める）、離れたら残り時間から再開する', async (t) => {
  const { body } = installDom(t);
  const tick = clock(t);
  toast('削除しました', { action() {} });
  const node = body.querySelector('.toast');
  tick(2000);
  await node.dispatch('pointerenter');
  assert.ok(hasClass(node, 'paused'));
  tick(60_000);
  assert.equal(node.isConnected, true);
  await node.dispatch('pointerleave');
  assert.equal(hasClass(node, 'paused'), false);
  tick(3999);
  assert.equal(node.isConnected, true);
  tick(1);
  assert.equal(node.isConnected, false);
});

test('トースト: フォーカスがある間は止め、マウスもフォーカスもなくなったら残り時間から再開する', async (t) => {
  const { body } = installDom(t);
  const tick = clock(t);
  const outside = document.createElement('button');
  body.append(outside);
  toast('削除しました', { action() {} });
  const node = body.querySelector('.toast');
  const undo = node.querySelector('button');
  tick(1000);
  await node.dispatch('focusin', { target: undo });
  assert.ok(hasClass(node, 'paused'));
  await node.dispatch('pointerenter');
  // 中の要素どうしでフォーカスが動いたときは止めたまま
  await node.dispatch('focusout', { target: undo, relatedTarget: undo });
  tick(10_000);
  assert.equal(node.isConnected, true);
  // マウスが離れても、フォーカスが残っていれば止めたまま
  await node.dispatch('pointerleave');
  tick(10_000);
  assert.equal(node.isConnected, true);
  assert.ok(hasClass(node, 'paused'));
  await node.dispatch('focusout', { target: undo, relatedTarget: outside });
  assert.equal(hasClass(node, 'paused'), false);
  tick(4999);
  assert.equal(node.isConnected, true);
  tick(1);
  assert.equal(node.isConnected, false);
});

test('トースト: エラーは role=alert で .toast-alerts に、ふつうの知らせは aria-live="polite" の .toast-list に出す。エラーの × で閉じる', async (t) => {
  const { body } = installDom(t);
  clock(t);
  toast('保存しました');
  const close = toast('削除できませんでした。サーバでエラーが発生しました', { kind: 'error' });
  assert.equal(typeof close, 'function');
  const region = body.querySelector('.toast-region');
  // 読み上げが二重にならないよう、位置を決める入れ物には aria-live を付けず、2 つのリストに分ける
  assert.equal(region.getAttribute('aria-live'), null);
  const [list, alerts] = region.children;
  assert.equal(list.className, 'toast-list');
  assert.equal(list.getAttribute('aria-live'), 'polite');
  assert.equal(alerts.className, 'toast-alerts');
  assert.equal(alerts.getAttribute('aria-live'), null);
  assert.deepEqual(list.children.map((node) => node.textContent), ['保存しました']);
  const [error] = alerts.children;
  assert.ok(hasClass(error, 'toast-error'));
  assert.equal(error.getAttribute('role'), 'alert');
  assert.equal(list.children[0].getAttribute('role'), null);
  const dismiss = error.querySelector('.toast-close');
  assert.equal(dismiss.tagName, 'button');
  assert.equal(dismiss.getAttribute('aria-label'), '閉じる');
  // × は文字ではなく SVG のアイコン（ui/icons.js の close。トーストの文の読み上げに混ざらない）
  assert.equal(dismiss.textContent, '');
  assert.equal(dismiss.querySelector('svg').getAttribute('class'), 'close-icon');
  assert.equal(error.textContent, '削除できませんでした。サーバでエラーが発生しました');
  // ふつうの知らせには × を付けない
  assert.equal(list.querySelector('.toast-close'), null);
  await dismiss.dispatch('click');
  assert.equal(error.isConnected, false);
  assert.equal(list.children.length, 1);
});

test('トースト: 元に戻すを押すと操作を呼んで閉じ、操作が失敗したらエラーのトーストで知らせる', async (t) => {
  const { body } = installDom(t);
  clock(t);
  let undone = 0;
  toast('削除しました', { action: async () => { undone++; } });
  const node = body.querySelector('.toast');
  assert.ok(hasClass(node, 'with-action'));
  await node.querySelector('.toast-action').dispatch('click');
  assert.equal(undone, 1);
  assert.equal(node.isConnected, false);
  toast('外しました', { action: async () => { throw new Error('元に戻せませんでした'); } });
  await body.querySelector('.toast-action').dispatch('click');
  assert.equal(body.querySelector('.toast-list').children.length, 0);
  const [error] = body.querySelector('.toast-alerts').children;
  assert.equal(error.textContent.startsWith('元に戻せませんでした'), true);
  assert.equal(error.getAttribute('role'), 'alert');
});

test('トースト: matchMedia がない・動きを減らす設定ではすぐ消し、そうでなければ .leaving を付けてボタンを押せなくし 150ms 後に消す', (t) => {
  const { body } = installDom(t);
  const tick = clock(t);
  const reduce = motion(t);
  reduce(null);
  let dismiss = toast('削除しました', { action() {} });
  let node = body.querySelector('.toast');
  dismiss();
  assert.equal(node.isConnected, false);
  reduce(true);
  dismiss = toast('削除しました', { action() {} });
  node = body.querySelector('.toast');
  dismiss();
  assert.equal(node.isConnected, false);
  reduce(false);
  dismiss = toast('削除しました', { action() {} });
  node = body.querySelector('.toast');
  dismiss();
  assert.ok(hasClass(node, 'leaving'));
  assert.equal(node.querySelector('.toast-action').disabled, true);
  // 2 回目は何もしない（時間切れの dismiss と重なっても 1 回だけ）
  dismiss();
  tick(149);
  assert.equal(node.isConnected, true);
  tick(1);
  assert.equal(node.isConnected, false);
});

test('トースト: ダイアログを閉じたら、ふつうの知らせは次の表示先の .toast-list へ、エラーは .toast-alerts へ移す（消えかけのものは移さない）', async (t) => {
  const { body } = installDom(t);
  const tick = clock(t);
  motion(t)(false);
  toast('本文の知らせ');
  const modal = openDialog('目標');
  toast('外しました', { action() {} });
  toast('元に戻せませんでした', { kind: 'error' });
  const leaving = toast('消えかけ');
  leaving();
  const regions = () => body.querySelectorAll('.toast-region');
  assert.equal(regions().length, 2);
  tick(1000);
  await modal.close();
  // 本文の表示先は 1 つのまま（作り直さない）
  assert.equal(regions().length, 1);
  const [region] = regions();
  assert.deepEqual(region.querySelector('.toast-list').children.map((node) => node.textContent.replace('元に戻す', '')), ['本文の知らせ', '外しました']);
  assert.deepEqual(region.querySelector('.toast-alerts').children.map((node) => node.textContent.replace('×', '')), ['元に戻せませんでした']);
  assert.equal(body.querySelectorAll('.toast').some((node) => node.textContent === '消えかけ'), false);
  // 付け直すと線の animation が初めからになるので、経った時間の分だけ先から始める
  const undo = region.querySelector('.toast-list').children[1];
  assert.equal(undo.style.getPropertyValue('--toast-delay'), '-1000ms');
  tick(4999);
  assert.equal(undo.isConnected, true);
  tick(1);
  assert.ok(hasClass(undo, 'leaving'));
  tick(150);
  assert.equal(undo.isConnected, false);
});
