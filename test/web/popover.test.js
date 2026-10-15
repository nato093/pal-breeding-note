import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from '../helpers/dom.js';
import { createPopover, placeFloating, scrollWithin } from '../../web/js/ui/popover.js';

function setup(t, options = {}) {
  const dom = installDom(t);
  const wrapper = document.createElement('div');
  const anchor = document.createElement('button');
  wrapper.append(anchor);
  dom.body.append(wrapper);
  const log = [];
  const popover = createPopover({ anchor, wrapper, onOpen: () => log.push('open'), onClose: () => log.push('close'), ...options });
  t.after(() => popover.destroy());
  return { ...dom, wrapper, anchor, popover, log };
}

const count = (target, name) => (target.listeners.get(name) ?? []).length;

test('ポップオーバー: open で wrapper の中に付け、外側の pointerdown で閉じる（中の pointerdown では閉じない）', async (t) => {
  const { body, events, wrapper, anchor, popover, log } = setup(t);
  // 閉じている間は、DOM に無い id を指さないよう aria-controls を付けない
  assert.equal(anchor.getAttribute('aria-controls'), null);
  popover.open();
  assert.equal(popover.element.parentElement, wrapper);
  assert.equal(popover.isOpen(), true);
  assert.equal(anchor.getAttribute('aria-expanded'), 'true');
  assert.equal(anchor.getAttribute('aria-controls'), popover.element.id);
  const inner = document.createElement('input');
  popover.element.append(inner);
  await events.dispatch('pointerdown', { target: inner });
  await events.dispatch('pointerdown', { target: anchor });
  assert.equal(popover.isOpen(), true);
  body.focus();
  await events.dispatch('pointerdown', { target: body });
  assert.equal(popover.isOpen(), false);
  assert.equal(popover.element.parentElement, null);
  assert.equal(anchor.getAttribute('aria-expanded'), 'false');
  assert.equal(anchor.getAttribute('aria-controls'), null);
  // 外側を押したときは、押した先にフォーカスを任せる（anchor へ戻さない）
  assert.equal(document.activeElement, body);
  assert.deepEqual(log, ['open', 'close']);
  // 閉じたらリスナーを外す
  assert.equal(count(events, 'pointerdown'), 0);
  assert.equal(count(events, 'keydown'), 0);
});

test('ポップオーバー: Escape で閉じて anchor へフォーカスを戻し、destroy では戻さずにリスナーを外す', async (t) => {
  const { events, anchor, popover, body } = setup(t);
  popover.open();
  await events.dispatch('keydown', { key: 'Enter' });
  assert.equal(popover.isOpen(), true);
  await events.dispatch('keydown', { key: 'Escape' });
  assert.equal(popover.isOpen(), false);
  assert.equal(document.activeElement, anchor);
  popover.open();
  // 2 回開いても二重に付けない
  popover.open();
  assert.equal(count(events, 'pointerdown'), 1);
  body.focus();
  popover.destroy();
  assert.equal(popover.isOpen(), false);
  assert.equal(document.activeElement, body);
  assert.equal(count(events, 'pointerdown'), 0);
  assert.equal(count(events, 'keydown'), 0);
});

test('ポップオーバー: focusOut ならフォーカスが外へ出たときに閉じる（中へ移ったときは閉じない）', async (t) => {
  const { anchor, popover, body } = setup(t, { focusOut: true });
  popover.open();
  const input = document.createElement('input');
  popover.element.append(input);
  input.focus();
  await popover.element.dispatch('focusout');
  await Promise.resolve();
  assert.equal(popover.isOpen(), true);
  body.focus();
  await popover.element.dispatch('focusout');
  await Promise.resolve();
  assert.equal(popover.isOpen(), false);
  assert.equal(document.activeElement, anchor);
});

test('ポップオーバー: focusOut でも、中の別の部品へ移る focusout（relatedTarget が中）では閉じない（Chrome では移る途中は body のため）', async (t) => {
  const { popover, body } = setup(t, { focusOut: true });
  popover.open();
  const first = document.createElement('button');
  const second = document.createElement('button');
  popover.element.append(first, second);
  first.focus();
  // 押した部品へフォーカスが移る途中（activeElement はまだ body）
  body.focus();
  await popover.element.dispatch('focusout', { relatedTarget: second });
  await Promise.resolve();
  assert.equal(popover.isOpen(), true);
  // 外へ出るときは今までどおり閉じる
  await popover.element.dispatch('focusout', { relatedTarget: body });
  await Promise.resolve();
  assert.equal(popover.isOpen(), false);
});

test('ポップオーバー: host があれば host の中に浮かせ、外でのホイール・タッチのスクロール・resize・ダイアログの cancel で閉じる', async (t) => {
  const dom = installDom(t);
  const dialog = document.createElement('dialog');
  dialog.getBoundingClientRect = () => ({ left: 240, width: 800 });
  const wrapper = document.createElement('div');
  const anchor = document.createElement('button');
  anchor.getBoundingClientRect = () => ({ left: 300, top: 200, bottom: 252, width: 200 });
  wrapper.append(anchor);
  dialog.append(wrapper);
  dom.body.append(dialog);
  const popover = createPopover({ anchor, wrapper, host: dialog });
  t.after(() => popover.destroy());
  popover.open();
  assert.equal(popover.element.parentElement, dialog);
  assert.match(popover.element.className, /picker-popover-floating/);
  assert.equal(popover.element.style.getPropertyValue('--picker-left'), '300px');
  assert.equal(popover.element.style.getPropertyValue('--picker-top'), '256px');
  const list = document.createElement('div');
  popover.element.append(list);
  await dom.events.dispatch('scroll', { target: list });
  await dom.events.dispatch('wheel', { target: list });
  assert.equal(popover.isOpen(), true);
  // 利用者が外でホイール・タッチでスクロールしたら閉じる
  await dom.events.dispatch('wheel', { target: dialog });
  assert.equal(popover.isOpen(), false);
  popover.open();
  await dom.events.dispatch('touchmove', { target: dom.body });
  assert.equal(popover.isOpen(), false);
  // それ以外の外のスクロール（データの更新でページが縮み、スクロール位置が丸められたなど）では閉じず、anchor に合わせて置き直す
  popover.open();
  anchor.getBoundingClientRect = () => ({ left: 300, top: 120, bottom: 172, width: 200 });
  await dom.events.dispatch('scroll', { target: dialog });
  assert.equal(popover.isOpen(), true);
  assert.equal(popover.element.style.getPropertyValue('--picker-top'), '176px');
  // anchor が画面の外へ出たら閉じる
  anchor.getBoundingClientRect = () => ({ left: 300, top: -80, bottom: -28, width: 200 });
  await dom.events.dispatch('scroll', { target: dialog });
  assert.equal(popover.isOpen(), false);
  anchor.getBoundingClientRect = () => ({ left: 300, top: 200, bottom: 252, width: 200 });
  popover.open();
  await dom.windowEvents.dispatch('resize');
  assert.equal(popover.isOpen(), false);
  popover.open();
  assert.equal((await dialog.dispatch('cancel')).defaultPrevented, true);
  assert.equal(popover.isOpen(), false);
  for (const [target, name] of [[dom.events, 'scroll'], [dom.events, 'wheel'], [dom.events, 'touchmove'], [dom.windowEvents, 'resize'], [dialog, 'cancel']]) assert.equal(count(target, name), 0, name);
});

test('ポップオーバー: placeFloating は下に 200px 足りず上の方が広ければ上に開き、高さの上限は 560px', (t) => {
  installDom(t);
  const popup = document.createElement('div');
  const anchor = document.createElement('button');
  anchor.getBoundingClientRect = () => ({ left: 100, top: 200, bottom: 240, width: 200 });
  assert.deepEqual(placeFloating(popup, anchor, document.body), { upwards: false });
  assert.equal(popup.style.getPropertyValue('--picker-top'), '244px');
  assert.equal(popup.style.getPropertyValue('--picker-bottom'), 'auto');
  assert.equal(popup.style.getPropertyValue('--picker-max-height'), '560px');
  assert.equal(popup.style.getPropertyValue('--picker-width'), '320px');
  anchor.getBoundingClientRect = () => ({ left: 100, top: 760, bottom: 800, width: 200 });
  assert.deepEqual(placeFloating(popup, anchor, document.body), { upwards: true });
  // 上に開いたら、前の下向きの値は残さない
  assert.equal(popup.style.getPropertyValue('--picker-top'), 'auto');
  assert.equal(popup.style.getPropertyValue('--picker-bottom'), '144px');
  assert.equal(popup.style.getPropertyValue('--picker-max-height'), '560px');
  assert.equal(placeFloating(popup, anchor, document.body, { maxHeight: 400 }).upwards, true);
  assert.equal(popup.style.getPropertyValue('--picker-max-height'), '400px');
});

test('ポップオーバー: scrollWithin は一覧だけを動かし、選んでいる行を真ん中に・矢印の行ははみ出したときだけ端に合わせる', () => {
  // 一覧と行の offsetParent はポップオーバー（一覧の上に検索欄 60px）
  const list = { scrollTop: 0, offsetTop: 60, clientHeight: 300 };
  const row = (top) => ({ offsetTop: 60 + top, offsetHeight: 40, offsetParent: {} });
  scrollWithin(list, row(600), { center: true });
  assert.equal(list.scrollTop, 470);
  // 先頭近くの行は 0 より上へは動かさない
  scrollWithin(list, row(20), { center: true });
  assert.equal(list.scrollTop, 0);
  scrollWithin(list, row(100));
  assert.equal(list.scrollTop, 0);
  scrollWithin(list, row(320));
  assert.equal(list.scrollTop, 60);
  scrollWithin(list, row(40));
  assert.equal(list.scrollTop, 40);
  // 一覧が offsetParent なら offsetTop をそのまま使う
  const own = { scrollTop: 0, offsetTop: 999, clientHeight: 300 };
  scrollWithin(own, { offsetTop: 500, offsetHeight: 40, offsetParent: own });
  assert.equal(own.scrollTop, 240);
  // 位置の分からない環境（テストの DOM）では何もしない
  const fake = { scrollTop: 5 };
  scrollWithin(fake, {});
  assert.equal(fake.scrollTop, 5);
});

test('ポップオーバー: 本文の中で開く板（host なし）が開いている間だけ、html に .has-inline-popover を付ける（トーストを板の下に下げる。浮かせる板は付けない）', async (t) => {
  const { body, wrapper, anchor, popover } = setup(t);
  const html = document.createElement('html');
  document.documentElement = html;
  const marked = () => html.className.split(' ').includes('has-inline-popover');
  popover.open();
  assert.equal(marked(), true);
  // 2 つ目の板が開いている間は、1 つ目を閉じても付けたまま
  const other = document.createElement('div');
  const otherAnchor = document.createElement('button');
  other.append(otherAnchor);
  body.append(other);
  const second = createPopover({ anchor: otherAnchor, wrapper: other });
  second.open();
  popover.close({ focus: false });
  assert.equal(marked(), true);
  second.close({ focus: false });
  assert.equal(marked(), false);
  // 閉じずに外された板（描き直しで wrapper ごと消えた）は、次に開閉したときに数えない
  popover.open();
  wrapper.remove();
  second.open();
  second.close({ focus: false });
  assert.equal(marked(), false);
  // body・ダイアログに浮かせる板（--z-popover でトーストより上）では付けない
  const floating = createPopover({ anchor, wrapper, host: body });
  floating.open();
  assert.equal(marked(), false);
  floating.destroy();
  second.destroy();
});
