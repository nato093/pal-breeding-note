import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement } from '../helpers/dom.js';
import { createAttention, faviconSvg, badgeLabel } from '../../web/js/attention.js';

const WORLD = 'ABCDEF0123456789ABCDEF0123456789';
// 未読の通知（要確認＝目標・自動登録、お知らせ＝release:）
const goal = (n) => ({ id: `wishlist:test:SheepBall:${n}`, date: '2026-10-15', title: '配合が登録されました' });
const release = (n) => ({ id: `release:${n}`, date: '2026-10-15', title: 'お知らせ' });
const success = (n) => ({ id: `auto-breed:test:registered:${n}`, date: '2026-10-15', kind: 'auto-registered', worldId: WORLD, batchId: 'b1', title: '配合を自動登録しました' });

// 偽の document（head の link[rel=icon]・title・visibilityState・visibilitychange）と通知・所持パルのストア
function setup({ unread = [], auto = { enabled: true, status: 'ready' } } = {}) {
  const visibility = new Set();
  const subscribers = { notifications: new Set(), owned: new Set() };
  const head = new FakeElement('head');
  const icon = new FakeElement('link');
  icon.setAttribute('rel', 'icon');
  icon.setAttribute('href', 'favicon.svg');
  head.append(icon);
  const writes = { title: 0, icon: 0 };
  const setAttribute = icon.setAttribute.bind(icon);
  icon.setAttribute = (name, value) => { if (name === 'href') writes.icon++; setAttribute(name, value); };
  let title = 'パル配合ノート';
  const doc = {
    head, visibilityState: 'visible',
    get title() { return title; },
    set title(value) { writes.title++; title = value; },
    addEventListener: (name, listener) => { if (name === 'visibilitychange') visibility.add(listener); },
    removeEventListener: (name, listener) => { if (name === 'visibilitychange') visibility.delete(listener); },
  };
  const state = { unread };
  const subscribe = (set) => (listener) => { set.add(listener); return () => set.delete(listener); };
  const notifications = { unread: () => state.unread, subscribe: subscribe(subscribers.notifications) };
  const owned = { state: { auto }, subscribe: subscribe(subscribers.owned) };
  const attention = createAttention({ document: doc, notifications, owned });
  const hide = (hidden) => {
    doc.visibilityState = hidden ? 'hidden' : 'visible';
    for (const listener of visibility) listener();
  };
  const emit = () => { for (const listener of [...subscribers.notifications, ...subscribers.owned]) listener(); };
  const svg = () => {
    const href = icon.getAttribute('href');
    return href.startsWith('data:image/svg+xml,') ? decodeURIComponent(href.slice('data:image/svg+xml,'.length)) : '';
  };
  return { attention, doc, icon, state, owned, hide, emit, svg, writes, visibility, subscribers };
}

test('題名: 表のときは「画面名 · パル配合ノート」（画面名がなければ「パル配合ノート」）。ファビコンは favicon.svg のまま', () => {
  const { attention, doc, icon } = setup({ unread: [goal(1)] });
  assert.equal(doc.title, 'パル配合ノート');
  attention.setScreen('配合を探す');
  assert.equal(doc.title, '配合を探す · パル配合ノート');
  // 表のときは未読があっても数を出さない
  assert.equal(icon.getAttribute('href'), 'favicon.svg');
  attention.setScreen('');
  assert.equal(doc.title, 'パル配合ノート');
});

test('題名: 裏のときだけ、要確認の未読の数を頭に「(3) 」、ファビコンに右上の丸（data: の SVG）。お知らせは数えず、表に戻ると元に戻す', () => {
  const { attention, doc, icon, hide, svg, state, emit } = setup({ unread: [goal(1), goal(2), success(1), success(2), release(1), release(2)] });
  attention.setScreen('理想個体');
  hide(true);
  // 同じ読み込みの自動登録 2 件は 1 と数える（通知欄の行と同じ）。お知らせ 2 件は数えない
  assert.equal(doc.title, '(3) 理想個体 · パル配合ノート');
  assert.match(icon.getAttribute('href'), /^data:image\/svg\+xml,/);
  assert.match(svg(), />3<\/text>/);
  assert.doesNotMatch(svg(), /style/);
  // お知らせだけなら出さない
  state.unread = [release(1)];
  emit();
  assert.equal(doc.title, '理想個体 · パル配合ノート');
  assert.equal(icon.getAttribute('href'), 'favicon.svg');
  // 10 件以上は「9+」
  state.unread = Array.from({ length: 12 }, (_, index) => goal(index));
  emit();
  assert.equal(doc.title, '(12) 理想個体 · パル配合ノート');
  assert.match(svg(), />9\+<\/text>/);
  hide(false);
  assert.equal(doc.title, '理想個体 · パル配合ノート');
  assert.equal(icon.getAttribute('href'), 'favicon.svg');
});

test('題名: 読み込みが許可待ちで止まっていれば、裏のときに「(!) 読み込み停止 · 」とファビコンの「!」（数があれば題名に両方）', () => {
  const { attention, doc, owned, hide, svg, emit, state } = setup();
  attention.setScreen('所持パル');
  owned.state.auto = { enabled: true, status: 'permission' };
  emit();
  assert.equal(doc.title, '所持パル · パル配合ノート');
  hide(true);
  assert.equal(doc.title, '(!) 読み込み停止 · 所持パル · パル配合ノート');
  assert.match(svg(), />!<\/text>/);
  state.unread = [goal(1)];
  emit();
  assert.equal(doc.title, '(1) (!) 読み込み停止 · 所持パル · パル配合ノート');
  // ファビコンは止まっていることを先に
  assert.match(svg(), />!<\/text>/);
  // 自動の読み込みがオフなら止まっているとは言わない
  owned.state.auto = { enabled: false, status: 'permission' };
  emit();
  assert.equal(doc.title, '(1) 所持パル · パル配合ノート');
});

test('題名: 数か状態が変わったときだけ書き換え、destroy で購読を外す', () => {
  const { attention, writes, emit, hide, visibility, subscribers } = setup({ unread: [goal(1)] });
  const before = { ...writes };
  emit();
  attention.update();
  assert.deepEqual(writes, before);
  hide(true);
  assert.deepEqual([writes.title - before.title, writes.icon - before.icon], [1, 1]);
  emit();
  assert.deepEqual([writes.title - before.title, writes.icon - before.icon], [1, 1]);
  attention.destroy();
  assert.equal(visibility.size, 0);
  assert.deepEqual([subscribers.notifications.size, subscribers.owned.size], [0, 0]);
});

test('ファビコンの SVG: 丸の文字は「!」「1」〜「9」「9+」だけ（ほかの値は丸を付けない）。style を使わない', () => {
  assert.equal(badgeLabel(1), '1');
  assert.equal(badgeLabel(9), '9');
  assert.equal(badgeLabel(10), '9+');
  for (const label of ['!', '1', '9+']) {
    const svg = faviconSvg(label);
    assert.match(svg, new RegExp(`>${label.replace('+', '\\+')}</text>`));
    assert.doesNotMatch(svg, /style/);
  }
  assert.doesNotMatch(faviconSvg('<script>alert(1)</script>'), /script|<text/);
  assert.doesNotMatch(faviconSvg(''), /<circle/);
});

test('題名: document に head や link[rel=icon] がなくても題名だけ書き換える（テストの偽の document・古いページ）', () => {
  const doc = { visibilityState: 'hidden', title: '' };
  const attention = createAttention({ document: doc, notifications: { unread: () => [goal(1)], subscribe: () => () => {} }, owned: null });
  attention.setScreen('設定');
  assert.equal(doc.title, '(1) 設定 · パル配合ノート');
});
