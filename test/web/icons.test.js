import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from '../helpers/dom.js';
import { ICONS, icon } from '../../web/js/ui/icons.js';
import { navIcon } from '../../web/js/ui/nav-icons.js';
import { actionIcon } from '../../web/js/ui/breeding-card.js';
import { TABS } from '../../web/js/views/tabs.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const attributes = (node, names) => names.map((name) => node.getAttribute(name));

test('icon: createElementNS で 24px の格子の線画の svg を作り（読み上げない・色は文字色）、知らない名前は中身のない svg を返す', (t) => {
  installDom(t);
  const svg = icon('close');
  assert.equal(svg.tagName, 'svg');
  assert.equal(svg.namespaceURI, SVG_NS);
  assert.deepEqual(attributes(svg, ['class', 'viewBox', 'aria-hidden', 'focusable', 'fill', 'stroke', 'stroke-linecap', 'stroke-linejoin']),
    ['icon', '0 0 24 24', 'true', 'false', 'none', 'currentColor', 'round', 'round']);
  // 閉じる「×」は 2 本の斜めの線（文字の × ではない）
  assert.equal(svg.children.length, 1);
  assert.equal(svg.children[0].namespaceURI, SVG_NS);
  assert.equal(svg.children[0].getAttribute('d'), 'M6 6l12 12M18 6 6 18');
  assert.equal(svg.textContent, '');
  // class は呼び出し側で変えられる
  assert.equal(icon('bell', { className: 'bell-icon' }).getAttribute('class'), 'bell-icon');
  // 知らない名前でも投げない（中身のない svg）
  const unknown = icon('no-such-icon');
  assert.equal(unknown.tagName, 'svg');
  assert.equal(unknown.children.length, 0);
});

test('icon: ナビのタブ・編集・削除・ベル・閉じる・✓・組の目的の 3 つを 1 か所（ICONS）に持つ', (t) => {
  installDom(t);
  const names = [...TABS.map(([view]) => view), 'edit', 'remove', 'bell', 'close', 'check', 'group-complete', 'group-passive', 'group-talent'];
  for (const name of names) {
    assert.ok(name in ICONS, name);
    assert.ok(icon(name).children.length > 0, name);
  }
  // 定義は凍結してある（呼び出し側が書き換えない）
  assert.ok(Object.isFrozen(ICONS));
  // 組の目的の札のアイコンは 12px の格子の塗りの図形（線は付けない＝前の views/ideal.js の groupIcon と同じ見た目）
  const crown = icon('group-complete', { className: 'ideal-tier-icon' });
  assert.deepEqual(attributes(crown, ['class', 'viewBox']), ['ideal-tier-icon', '0 0 12 12']);
  assert.deepEqual(attributes(crown.children[0], ['fill', 'stroke']), ['currentColor', 'none']);
  assert.equal(icon('group-talent').children.length, 3);
});

test('navIcon・actionIcon: ナビと配合カードのボタンのアイコンは icons.js の定義を名前で使う', (t) => {
  installDom(t);
  for (const [view] of TABS) {
    const svg = navIcon(view);
    assert.equal(svg.getAttribute('class'), 'tab-icon');
    assert.equal(svg.children.length, icon(view).children.length, view);
  }
  const clicks = [];
  const remove = actionIcon('削除', 'remove', () => clicks.push('remove'), 'danger-text');
  assert.equal(remove.className, 'icon-button card-action danger-text');
  assert.deepEqual([remove.getAttribute('aria-label'), remove.title], ['削除', '削除']);
  const svg = remove.children[0];
  assert.equal(svg.tagName, 'svg');
  assert.equal(svg.children[0].getAttribute('d'), icon('remove').children[0].getAttribute('d'));
  remove.dispatch('click');
  assert.deepEqual(clicks, ['remove']);
});
