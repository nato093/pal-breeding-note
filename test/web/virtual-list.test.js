import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from '../helpers/dom.js';
import { el } from '../../web/js/ui/dom.js';
import { visibleRange, virtualRows } from '../../web/js/ui/virtual-list.js';

// 行の高さが同じ（height px）一覧の上端の累積
const offsetsOf = (count, height = 50) => Array.from({ length: count + 1 }, (_, i) => i * height);

test('見えている範囲: 先頭・途中・末尾と、前後の overscan', () => {
  const offsets = offsetsOf(100);
  // 一覧の先頭が見えている（10 行ぶんの高さ）
  assert.deepEqual(visibleRange({ offsets, scrollTop: 0, viewport: 500, overscan: 0 }), { start: 0, end: 10 });
  assert.deepEqual(visibleRange({ offsets, scrollTop: 0, viewport: 500, overscan: 3 }), { start: 0, end: 13 });
  // 途中（行の途中から見えていても、その行から）
  assert.deepEqual(visibleRange({ offsets, scrollTop: 1025, viewport: 500, overscan: 0 }), { start: 20, end: 31 });
  assert.deepEqual(visibleRange({ offsets, scrollTop: 1025, viewport: 500, overscan: 5 }), { start: 15, end: 36 });
  // 末尾（overscan で行数を超えない）
  assert.deepEqual(visibleRange({ offsets, scrollTop: 4800, viewport: 500, overscan: 10 }), { start: 86, end: 100 });
  // 一覧が画面より下にある（scrollTop が負）・すでに通り過ぎた
  assert.deepEqual(visibleRange({ offsets, scrollTop: -800, viewport: 500, overscan: 2 }), { start: 0, end: 2 });
  assert.deepEqual(visibleRange({ offsets, scrollTop: 9000, viewport: 500, overscan: 2 }), { start: 98, end: 100 });
  // 行がない
  assert.deepEqual(visibleRange({ offsets: [0], scrollTop: 0, viewport: 500 }), { start: 0, end: 0 });
  // 高さの違う行
  assert.deepEqual(visibleRange({ offsets: [0, 10, 200, 210, 400], scrollTop: 150, viewport: 55, overscan: 0 }), { start: 1, end: 3 });
});

test('見えている範囲だけ描く: 更新で今の位置より前に多数の行が増えても、見ていた行（アンカー）の位置で先に描いて同じ位置に戻す', (t) => {
  const { windowEvents } = installDom(t);
  windowEvents.innerHeight = 600;
  // ページのスクロール（一覧の上端は、スクロールしていなければ画面の上から 100px）
  windowEvents.scrollY = 0;
  windowEvents.scrollBy = (x, y) => { windowEvents.scrollY += y; };
  const container = el('div', 'owned-list');
  document.body.append(container);
  container.getBoundingClientRect = () => ({ top: 100 - windowEvents.scrollY, bottom: 100 - windowEvents.scrollY + 60000, height: 60000 });
  const list = virtualRows(container, {
    key: (item) => item.id, estimate: 60, overscan: 2,
    create: (item) => ({ element: el('article', 'row', item.id), update() {} }),
  });
  const items = Array.from({ length: 1000 }, (_, i) => ({ id: `r${i}` }));
  // 500 行目が画面の上端に来るまでスクロールした
  windowEvents.scrollY = 100 + 500 * 60;
  list.render(items);
  assert.ok(list.rows.children.some((node) => node.textContent === 'r500'));
  // 先頭に 100 行増えた。見ていた行（r500・上端 0px）を新しい全件で探し、その位置で描いてから同じ位置へスクロールする
  const added = [...Array.from({ length: 100 }, (_, i) => ({ id: `n${i}` })), ...items];
  list.render(added, { anchor: { key: 'r500', top: 0 } });
  assert.equal(windowEvents.scrollY, 100 + 600 * 60);
  assert.ok(list.rows.children.some((node) => node.textContent === 'r500'));
  // アンカーが新しい一覧に無いときは、今の位置のまま描く
  list.render(items, { anchor: { key: 'n5', top: 0 } });
  assert.equal(windowEvents.scrollY, 100 + 600 * 60);
  list.destroy();
});

test('見えている範囲だけ描く: 上下の余白で全体の高さを保ち、行を使い回し、destroy で元に戻す', (t) => {
  const { windowEvents } = installDom(t);
  windowEvents.innerHeight = 600;
  const container = el('div', 'owned-list');
  document.body.append(container);
  // 一覧の上端は画面の上から 100px（固定のヘッダーは 0）
  container.getBoundingClientRect = () => ({ top: 100, bottom: 100 + 1000 * 60, height: 1000 * 60 });
  let created = 0;
  const list = virtualRows(container, {
    key: (item) => item.id, estimate: 60, overscan: 2,
    create: (item) => { created++; return { element: el('article', 'row', item.id), update() {} }; },
  });
  const items = Array.from({ length: 1000 }, (_, i) => ({ id: `r${i}` }));
  list.render(items);
  assert.ok(container.className.includes('is-virtual'));
  const [top, rows, bottom] = container.children;
  assert.equal(rows, list.rows);
  // テストの DOM の行は高さを返さないので、行の高さは見積もり（60px）のまま。見えている 500px と前後 2 行だけを置く
  const shown = rows.children.length;
  assert.equal(shown, 11);
  assert.equal(top.style.getPropertyValue('--space'), '0px');
  assert.equal(bottom.style.getPropertyValue('--space'), `${(1000 - shown) * 60}px`);
  const first = rows.children[0];
  // 同じ範囲で描き直しても、行は使い回す
  list.render(items);
  assert.equal(rows.children[0], first);
  assert.equal(created, shown);
  // 下へスクロール（一覧の上端が画面の上へ 30,000px 出た）
  container.getBoundingClientRect = () => ({ top: -30000, bottom: 30000, height: 60000 });
  list.render(items);
  assert.ok(rows.children[0].textContent !== 'r0');
  assert.notEqual(top.style.getPropertyValue('--space'), '0px');
  list.destroy();
  assert.equal(container.children.length, 0);
  assert.ok(!container.className.includes('is-virtual'));
});

test('見えている範囲だけ描く: setEstimate で見積もりを変えると、測って覚えた高さを捨てて全部の行を新しい見積もりにする（所持パルの行の高さの切り替え。D25）', (t) => {
  const { windowEvents } = installDom(t);
  windowEvents.innerHeight = 600;
  const container = el('div', 'owned-list');
  document.body.append(container);
  let scrolled = 0;
  container.getBoundingClientRect = () => ({ top: 100 - scrolled, bottom: 100 - scrolled + 60000, height: 60000 });
  // 描いた行は 64px と測れる
  let rowHeight = 64;
  const list = virtualRows(container, {
    key: (item) => item.id, estimate: 64, overscan: 2,
    create: (item) => {
      const element = el('article', 'row', item.id);
      element.getBoundingClientRect = () => ({ top: 0, bottom: rowHeight, height: rowHeight });
      return { element, update() {} };
    },
  });
  const items = Array.from({ length: 1000 }, (_, i) => ({ id: `r${i}` }));
  list.render(items);
  // 下へスクロールして別の行を描く（先頭の行は 64px と覚えたまま、DOM から外れる）
  scrolled = 30000;
  list.render(items);
  const [top] = container.children;
  const start = Number.parseFloat(top.style.getPropertyValue('--space')) / 64;
  assert.ok(Number.isInteger(start) && start > 0);
  // 全部の行が 80px になった。覚えた 64px を捨てないと、上の余白が描いていない行の 64px のまま残る
  rowHeight = 80;
  list.setEstimate(80);
  list.render(items);
  const offset = Number.parseFloat(top.style.getPropertyValue('--space'));
  assert.equal(offset % 80, 0);
  assert.equal(offset / 80, Number(list.rows.children[0].textContent.slice(1)));
  list.destroy();
});
