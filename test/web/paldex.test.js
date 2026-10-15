// 図鑑（`#/pal` の格子。paldex）: 全パルの格子・子としての登録の件数と影・所持の点・目標の星・自分の捕獲数・絞り込み・差分の更新
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, descendants } from '../helpers/dom.js';
import pals from '../../web/data/pals.js';
import passives from '../../web/data/passives.js';
import { buildIndex } from '../../web/js/core/index.js';
import { normalizeOwned } from '../../web/js/core/owned.js';
import { parseHash } from '../../web/js/router.js';
import { palView } from '../../web/js/views/pal.js';
import { palDetail } from '../../web/js/views/pal-detail.js';
import { PALDEX_PALS, PALDEX_ICON_SIZE } from '../../web/js/views/paldex.js';
import { handlePalLink } from '../../web/js/ui/drawer.js';

const P1 = '00000000-0000-0000-0000-000000000001';
const P2 = '00000000-0000-0000-0000-000000000002';
const hasClass = (node, name) => node.className.split(' ').includes(name);
const byClass = (root, name) => descendants(root).find((node) => hasClass(node, name));
const record = (id, childId, parent1Id = 'SheepBall', parent2Id = 'PinkCat') => ({ id, parent1Id, parent2Id, childId, parent1Gender: '', parent2Gender: '', registrant: '仲間', memo: '', updatedAt: '2026-10-16T00:00:00.000Z' });

function fakeStore(records = [], { env = 'test' } = {}) {
  const listeners = new Set();
  const store = {
    state: { records, index: buildIndex(records, pals), env, revision: 1, warnings: [], userId: 'Alice' },
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    refresh: () => {},
    set(next) {
      store.state = { ...store.state, ...next, revision: store.state.revision + 1 };
      if (next.records) store.state.index = buildIndex(next.records, pals);
      listeners.forEach((fn) => fn(store.state));
    },
  };
  return store;
}

// モコロン 2 体（うちタマゴ 1）・ツッパニャン 1 体。Alice（P1）の捕獲数はモコロン 12・小文字のライガロン（氷）2・人間 4、Bob（P2）はモコロン 30
function snapshot({ captures = true } = {}) {
  const pal = (id, characterId, location) => ({ instanceId: id, characterId, gender: 'Male', level: 10, rank: 1, passives: [], talent: { hp: 1, shot: 1, defense: 1 }, location });
  return {
    version: 1, world: { name: 'テスト', hostName: 'Alice' }, bases: [], stats: {},
    players: [
      { uid: P1, name: 'Alice', level: 50, ...(captures ? { captures: [{ id: 'SheepBall', count: 12 }, { id: 'werewolf_ice', count: 2 }, { id: 'Human', count: 4 }] } : {}) },
      { uid: P2, name: 'Bob', level: 40, ...(captures ? { captures: [{ id: 'SheepBall', count: 30 }] } : {}) },
    ],
    pals: [
      pal('a', 'SheepBall', { kind: 'palbox', playerUid: P1, slotIndex: 0 }), pal('egg', 'SheepBall', { kind: 'egg-ground', playerUid: P1 }),
      pal('c', 'PinkCat', { kind: 'party', playerUid: P2, slotIndex: 0 }),
    ],
  };
}
function fakeOwned(data = normalizeOwned(snapshot(), { pals, passives })) {
  const listeners = new Set();
  const owned = {
    state: { ready: true, owned: data }, loads: 0,
    load() { owned.loads++; return Promise.resolve(); },
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    set(next) { owned.state = { ...owned.state, owned: next }; listeners.forEach((fn) => fn(owned.state)); },
  };
  return owned;
}
function fakeIdeals({ goals = [], self = [P1] } = {}) {
  const listeners = new Set();
  const ideals = {
    goals, self: new Set(self),
    list: () => ideals.goals,
    selfUids: () => ideals.self,
    has: () => false,
    scope: () => 'scope',
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    emit: () => listeners.forEach((fn) => fn()),
  };
  return ideals;
}
function context({ store = fakeStore(), owned = null, ideals = fakeIdeals(), viewStates = new Map() } = {}) {
  const replaced = [];
  return {
    store, owned, ideals, replaced, navigations: [], viewStates,
    navigate(hash) { this.navigations.push(hash); },
    replace: (hash) => replaced.push(hash),
    viewState(name) {
      if (!viewStates.has(name)) viewStates.set(name, {});
      return viewStates.get(name);
    },
  };
}
const gridOf = (view) => byClass(view.element, 'paldex-grid');
const cellsOf = (view) => gridOf(view).children;
const cell = (view, id) => cellsOf(view).find((node) => node.getAttribute('data-pal-id') === id);
const shownIds = (view) => cellsOf(view).filter((node) => !node.hidden).map((node) => node.getAttribute('data-pal-id'));
const visible = (node, name) => !byClass(node, name).hidden;
const radios = (view) => view.element.querySelectorAll('.segmented-option');
const radio = (view, text) => radios(view).find((node) => node.textContent === text);
const stats = (view) => view.element.querySelectorAll('.paldex-stat').map((node) => node.textContent);

test('図鑑: `#/pal`（ID なし）は有効な全パルの格子（図鑑順・48px の lazy の絵）。マスはパルのタイルで、押すとドロワーでパル詳細', (t) => {
  installDom(t);
  const view = palView(context(), parseHash('#/pal'));
  assert.equal(view.element.querySelector('h1').textContent, '図鑑');
  const expected = pals.filter((pal) => pal.active).sort((a, b) => a.no - b.no || Number(a.variant) - Number(b.variant) || (a.id < b.id ? -1 : 1)).map((pal) => pal.id);
  assert.equal(expected.length, 298);
  assert.deepEqual(cellsOf(view).map((node) => node.getAttribute('data-pal-id')), expected);
  assert.deepEqual(PALDEX_PALS.map((pal) => pal.id), expected);
  assert.equal(expected.includes('PlantSlime_Flower'), false);
  const first = cellsOf(view)[0];
  assert.equal(first.tagName, 'a');
  assert.ok(hasClass(first, 'pal-tile'));
  assert.equal(first.href, '#/pal/SheepBall');
  assert.equal(byClass(first, 'paldex-no').textContent, 'No.1');
  assert.equal(byClass(first, 'paldex-name').textContent, 'モコロン');
  // 絵は width・height を 48 に固定して lazy（読み込む前も配置が揺れない）
  const image = first.querySelector('img');
  assert.deepEqual([image.width, image.height, image.loading], [PALDEX_ICON_SIZE, PALDEX_ICON_SIZE, 'lazy']);
  assert.ok(hasClass(byClass(first, 'pal-icon'), 'paldex-icon'));
  // ドロワーの handlePalLink が引き取る（画面を移らずに右のドロワーでパル詳細）
  const opened = [];
  const drawer = { open: (entry, options) => opened.push([entry, options.opener]) };
  let prevented = false;
  const taken = handlePalLink({ target: image, button: 0, preventDefault: () => { prevented = true; } }, view.element, drawer);
  assert.equal(taken, true);
  assert.equal(prevented, true);
  assert.deepEqual(opened, [[{ kind: 'pal', id: 'SheepBall' }, first]]);
  view.destroy();
});

test('図鑑: 子として登録がある種は右上に件数、ない種は絵を影（filter のクラス）にして読み上げに「子としての登録なし」。上に「子として登録 N / 298」', (t) => {
  installDom(t);
  const view = palView(context({ store: fakeStore([record('r1', 'MoonQueen'), record('r2', 'MoonQueen', 'Anubis', 'Anubis'), record('r3', 'PinkCat')]) }), parseHash('#/pal'));
  const moon = cell(view, 'MoonQueen');
  assert.equal(byClass(moon, 'paldex-count').textContent, '2');
  assert.equal(visible(moon, 'paldex-count'), true);
  assert.equal(hasClass(moon, 'is-unregistered'), false);
  assert.equal(hasClass(byClass(moon, 'pal-icon'), 'pal-icon-silhouette'), false);
  assert.match(moon.getAttribute('aria-label'), /（子としての登録 2 件）$/);
  const sheep = cell(view, 'SheepBall');
  assert.equal(visible(sheep, 'paldex-count'), false);
  assert.ok(hasClass(sheep, 'is-unregistered'));
  assert.ok(hasClass(byClass(sheep, 'pal-icon'), 'pal-icon-silhouette'));
  assert.equal(sheep.getAttribute('aria-label'), 'No.1 モコロン（子としての登録なし）');
  assert.equal(cellsOf(view).filter((node) => hasClass(node, 'is-unregistered')).length, 296);
  // 所持パル・捕獲数のデータがなければ、所持の点・捕獲数・「未所持」の絞り込みを出さない
  assert.deepEqual(stats(view), ['子として登録2 / 298']);
  assert.equal(cellsOf(view).some((node) => visible(node, 'paldex-owned') || visible(node, 'paldex-capture')), false);
  // 「未所持」の押しボタンは作るが隠す（データが届いたら出す。作り直さない）
  assert.deepEqual(radios(view).filter((node) => !node.hidden).map((node) => node.textContent), ['すべて', '未登録']);
  view.destroy();
});

test('図鑑: 所持している種に点・目標の種族に星・自分の捕獲数（自分のプレイヤーの分だけ。大文字小文字の違う ID も引く）', (t) => {
  installDom(t);
  const owned = fakeOwned();
  const ideals = fakeIdeals({ goals: [{ id: 'g1', palId: 'PinkCat' }, { id: 'g2', palId: 'MoonQueen', passives: ['Rare'] }] });
  const view = palView(context({ owned, ideals }), parseHash('#/pal'));
  const sheep = cell(view, 'SheepBall');
  assert.equal(visible(sheep, 'paldex-owned'), true);
  assert.equal(visible(sheep, 'paldex-goal'), false);
  // Bob（P2）の 30 回は数えない
  assert.equal(byClass(sheep, 'paldex-capture').textContent, '捕獲 12');
  assert.equal(sheep.getAttribute('aria-label'), 'No.1 モコロン（子としての登録なし・所持 2 体・捕獲 12）');
  const cat = cell(view, 'PinkCat');
  assert.deepEqual([visible(cat, 'paldex-owned'), visible(cat, 'paldex-goal'), visible(cat, 'paldex-capture')], [true, true, false]);
  assert.equal(cat.getAttribute('aria-label'), 'No.2 ツッパニャン（子としての登録なし・所持 1 体・目標）');
  assert.equal(visible(cell(view, 'MoonQueen'), 'paldex-goal'), true);
  assert.equal(byClass(cell(view, 'Werewolf_Ice'), 'paldex-capture').textContent, '捕獲 2');
  assert.equal(cell(view, 'Anubis').getAttribute('aria-label'), `No.${pals.find((pal) => pal.id === 'Anubis').label} アヌビス（子としての登録なし・未所持）`);
  // 子としての登録のない種のうち、所持・捕獲している種は影ではなく淡い絵（is-known。ゲームの「影＝未捕獲」と逆に読めないように）。
  // 影の印（pal-icon-silhouette）と点線の枠（is-unregistered）は「子としての登録なし」のまま
  assert.deepEqual([sheep, cat, cell(view, 'Werewolf_Ice'), cell(view, 'Anubis')].map((node) => [hasClass(node, 'is-unregistered'), hasClass(node, 'is-known'), hasClass(byClass(node, 'pal-icon'), 'pal-icon-silhouette')]), [
    [true, true, true], [true, true, true], [true, true, true], [true, false, true],
  ]);
  assert.equal(byClass(view.element, 'paldex-legend').textContent.includes('影・淡い絵は、子として登録された配合がまだない種族'), true);
  assert.deepEqual(stats(view), ['子として登録0 / 298', '所持2 / 298', '捕獲（自分）2 種']);
  assert.equal(owned.loads, 1);
  // 見方の行: 所持と捕獲数は分かるときだけ
  const legend = view.element.querySelectorAll('.paldex-legend-item');
  assert.equal(legend.filter((node) => !node.hidden).length, 5);
  view.destroy();
  // 自分が分からない（このワールドでの自分も、対応も決まっていない）・捕獲数のないデータ（参加者・古いデータ）では捕獲数を出さない
  for (const [label, input] of [['自分が分からない', { owned: fakeOwned(), ideals: fakeIdeals({ self: [] }) }], ['捕獲数のないデータ', { owned: fakeOwned(normalizeOwned(snapshot({ captures: false }), { pals, passives })) }]]) {
    const other = palView(context(input), parseHash('#/pal'));
    assert.equal(cellsOf(other).some((node) => visible(node, 'paldex-capture')), false, label);
    assert.deepEqual(stats(other), ['子として登録0 / 298', '所持2 / 298'], label);
    other.destroy();
  }
});

test('図鑑: 絞り込み「すべて／未登録／未所持」は viewState に残り、開き直しても同じ。所持パルのデータがなければ「未所持」は「すべて」として描く', (t) => {
  installDom(t);
  const viewStates = new Map();
  const app = context({ store: fakeStore([record('r1', 'MoonQueen')]), owned: fakeOwned(), viewStates });
  const view = palView(app, parseHash('#/pal'));
  assert.equal(shownIds(view).length, 298);
  // 絞り込みに当たる数（替えたら読み上げる。aria-live）
  const count = byClass(view.element, 'paldex-shown');
  assert.deepEqual([count.textContent, count.getAttribute('aria-live')], ['298 体', 'polite']);
  radio(view, '未登録').dispatch('click');
  assert.equal(viewStates.get('paldex').filter, 'unregistered');
  assert.equal(shownIds(view).length, 297);
  assert.equal(count.textContent, '297 体');
  assert.equal(shownIds(view).includes('MoonQueen'), false);
  assert.equal(radio(view, '未登録').getAttribute('aria-checked'), 'true');
  view.destroy();
  // 開き直しても同じ絞り込み
  const again = palView(app, parseHash('#/pal'));
  assert.equal(radio(again, '未登録').getAttribute('aria-checked'), 'true');
  assert.equal(shownIds(again).length, 297);
  radio(again, '未所持').dispatch('click');
  assert.equal(viewStates.get('paldex').filter, 'unowned');
  assert.equal(shownIds(again).length, 296);
  assert.equal(shownIds(again).some((id) => id === 'SheepBall' || id === 'PinkCat'), false);
  again.destroy();
  // 所持パルのデータのない画面では、覚えた「未所持」を残したまま全部を出す
  const none = palView(context({ viewStates }), parseHash('#/pal'));
  assert.equal(shownIds(none).length, 298);
  assert.equal(radio(none, 'すべて').getAttribute('aria-checked'), 'true');
  assert.equal(viewStates.get('paldex').filter, 'unowned');
  none.destroy();
  // 見せるマスがなければ一言（全部の種族が登録済みのとき）
  const all = fakeStore(pals.filter((pal) => pal.active).map((pal, i) => record(`a${i}`, pal.id)));
  const full = palView(context({ store: all, viewStates: new Map([['paldex', { filter: 'unregistered' }]]) }), parseHash('#/pal'));
  assert.equal(shownIds(full).length, 0);
  assert.equal(byClass(full.element, 'paldex-none').hidden, false);
  assert.equal(byClass(full.element, 'paldex-none').textContent, '子として登録のないパルはいません。');
  full.destroy();
});

test('図鑑: 所持パルのデータが後から届いても絞り込みの押しボタンを作り直さず、押したばかりの押しボタンのフォーカスが残る。隠した「未所持」へは矢印で移らない', (t) => {
  const { body } = installDom(t);
  const owned = fakeOwned(null);
  const view = palView(context({ owned }), parseHash('#/pal'));
  body.append(view.element);
  const before = radios(view);
  assert.equal(radio(view, '未所持').hidden, true);
  // 隠した「未所持」は飛ばす（未登録 → すべて へ回る）
  const unregistered = radio(view, '未登録');
  unregistered.dispatch('click');
  unregistered.focus();
  unregistered.dispatch('keydown', { key: 'ArrowRight', preventDefault() {} });
  assert.equal(document.activeElement, radio(view, 'すべて'));
  unregistered.dispatch('keydown', { key: 'End', preventDefault() {} });
  assert.equal(document.activeElement, unregistered);
  assert.equal(unregistered.getAttribute('aria-checked'), 'true');
  // 開いたときの owned.load() が終わってデータが届く
  owned.set(normalizeOwned(snapshot(), { pals, passives }));
  assert.deepEqual(radios(view), before);
  assert.equal(document.activeElement, unregistered);
  assert.equal(radio(view, '未所持').hidden, false);
  unregistered.dispatch('keydown', { key: 'ArrowRight', preventDefault() {} });
  assert.equal(document.activeElement, radio(view, '未所持'));
  view.destroy();
});

test('図鑑: 絞り込みで隠れるマスでも、フォーカスのあるマスとドロワーで開いているパルのマスは、データの更新では次の更新まで残す（絞り込みを替えたら隠す）', (t) => {
  const { body } = installDom(t);
  const store = fakeStore();
  const drawer = { entry: null, isOpen() { return Boolean(this.entry); }, current() { return this.entry; } };
  const app = context({ store, viewStates: new Map([['paldex', { filter: 'unregistered' }]]) });
  app.drawer = drawer;
  const view = palView(app, parseHash('#/pal'));
  body.append(view.element);
  const count = byClass(view.element, 'paldex-shown');
  // フォーカスのあるマス（ドロワーを閉じた後の戻り先）: 仲間の登録が届いても隠さない（数は当たる数だけ）
  const sheep = cell(view, 'SheepBall');
  sheep.focus();
  store.set({ records: [record('r1', 'SheepBall')] });
  assert.equal(sheep.hidden, false);
  assert.equal(hasClass(sheep, 'is-unregistered'), false);
  assert.equal(count.textContent, '297 体');
  // 右のドロワーで開いているパル（フォーカスはドロワーの中）: ドロワーから登録しても隠さない
  body.focus?.();
  document.activeElement = body;
  drawer.entry = { kind: 'pal', id: 'PinkCat' };
  store.set({ records: [record('r1', 'SheepBall'), record('r2', 'PinkCat')] });
  assert.equal(cell(view, 'PinkCat').hidden, false);
  // フォーカスの外れたマスは次の更新で隠す
  assert.equal(cell(view, 'SheepBall').hidden, true);
  // 前の更新で隠れていたマスは、ドロワーで開いても出し直さない
  drawer.entry = { kind: 'pal', id: 'SheepBall' };
  store.set({ records: [record('r1', 'SheepBall'), record('r2', 'PinkCat'), record('r3', 'MoonQueen')] });
  assert.deepEqual(['SheepBall', 'PinkCat', 'MoonQueen'].map((id) => cell(view, id).hidden), [true, true, true]);
  // 絞り込みを替えたら、残したマスも隠す
  cell(view, 'PinkCat').focus();
  radio(view, 'すべて').dispatch('click');
  radio(view, '未登録').dispatch('click');
  assert.equal(cell(view, 'PinkCat').hidden, true);
  assert.equal(count.textContent, '295 体');
  view.destroy();
});

test('図鑑: 記録・所持パル・目標・自分の更新では格子を作り直さず、印の変わったマスだけを直す', (t) => {
  installDom(t);
  const store = fakeStore([record('r1', 'MoonQueen')]);
  const owned = fakeOwned();
  const ideals = fakeIdeals();
  const view = palView(context({ store, owned, ideals }), parseHash('#/pal'));
  const before = [...cellsOf(view)];
  // 変わらないマスの属性は書き直さない
  const anubis = cell(view, 'Anubis');
  let writes = 0;
  const original = anubis.setAttribute.bind(anubis);
  anubis.setAttribute = (...args) => { writes++; original(...args); };
  store.set({ records: [record('r1', 'MoonQueen'), record('r2', 'SheepBall')] });
  assert.deepEqual(cellsOf(view), before);
  assert.equal(hasClass(cell(view, 'SheepBall'), 'is-unregistered'), false);
  assert.equal(hasClass(byClass(cell(view, 'SheepBall'), 'pal-icon'), 'pal-icon-silhouette'), false);
  assert.deepEqual(stats(view)[0], '子として登録2 / 298');
  // 目標を足す（ideals の知らせ）
  ideals.goals = [{ id: 'g1', palId: 'Anubis' }];
  ideals.emit();
  assert.equal(visible(cell(view, 'Anubis'), 'paldex-goal'), true);
  // 所持パルの読み直し（ツッパニャンがいなくなった）
  const data = normalizeOwned({ ...snapshot(), pals: snapshot().pals.filter((pal) => pal.characterId !== 'PinkCat') }, { pals, passives });
  owned.set(data);
  assert.equal(visible(cell(view, 'PinkCat'), 'paldex-owned'), false);
  // 自分が変わった（Bob にした）: 捕獲数は Bob の分
  ideals.self = new Set([P2]);
  ideals.emit();
  assert.equal(byClass(cell(view, 'SheepBall'), 'paldex-capture').textContent, '捕獲 30');
  assert.deepEqual(cellsOf(view), before);
  assert.equal(writes, 1);
  // 同じ版の知らせ（中身が同じ取得）では何もしない
  writes = 0;
  store.set({});
  assert.equal(writes, 0);
  view.destroy();
});

test('図鑑: 記録をまだ読めていない間は「読み込み中」で格子を隠し（全部が影に見えない）、読めたら同じマスで出す', (t) => {
  installDom(t);
  const store = fakeStore([], { env: '' });
  const view = palView(context({ store }), parseHash('#/pal'));
  assert.equal(gridOf(view).hidden, true);
  assert.match(byClass(view.element, 'paldex-status').textContent, /読み込み中/);
  assert.deepEqual(stats(view), []);
  const before = [...cellsOf(view)];
  assert.equal(before.length, 298);
  store.set({ env: 'test', records: [record('r1', 'MoonQueen')] });
  assert.equal(gridOf(view).hidden, false);
  assert.equal(byClass(view.element, 'paldex-status').children.length, 0);
  assert.deepEqual(cellsOf(view), before);
  assert.deepEqual(stats(view), ['子として登録1 / 298']);
  view.destroy();
});

test('図鑑: 不正な ID の `#/pal/<id>` は「パルが見つかりません」と知らせ、URL を `#/pal` に直して図鑑を出す', (t) => {
  installDom(t);
  const app = context();
  const view = palView(app, parseHash('#/pal/NoSuchPal'));
  assert.deepEqual(app.replaced, ['#/pal/']);
  assert.equal(view.element.querySelector('h1').textContent, '図鑑');
  assert.equal(cellsOf(view).length, 298);
  assert.ok(document.body.querySelectorAll('.toast').some((node) => node.textContent.startsWith('パルが見つかりません')));
  view.destroy();
});

test('パル詳細: パル切り替えの横に「図鑑」、ヒーローに自分の「捕獲 N 回」（自分が分からない・捕獲数のないデータでは出さない）', (t) => {
  installDom(t);
  const owned = fakeOwned();
  const ideals = fakeIdeals();
  const app = context({ owned, ideals });
  const page = palDetail(app, 'SheepBall', { mode: 'page' });
  const nav = byClass(page.element, 'pal-detail-nav');
  assert.ok(hasClass(nav.children[0], 'pal-switch'));
  const dex = byClass(nav, 'pal-dex-link');
  assert.equal(dex.href, '#/pal/');
  assert.equal(dex.textContent, '図鑑');
  const line = byClass(page.element, 'pal-capture-line');
  assert.equal(line.hidden, false);
  assert.equal(line.textContent, '捕獲12 回（自分）');
  // 捕まえていない種族は 0 回
  const cat = palDetail(app, 'PinkCat', { mode: 'drawer' });
  assert.equal(byClass(cat.element, 'pal-capture-line').textContent, '捕獲0 回（自分）');
  // ドロワーでも先頭に切り替えと「図鑑」
  assert.ok(hasClass(cat.element.children[0], 'pal-detail-nav'));
  cat.destroy();
  // 自分が分からなくなったら隠す（ideals の知らせ）
  ideals.self = new Set();
  ideals.emit();
  assert.equal(line.hidden, true);
  page.destroy();
  const old = palDetail(context({ owned: fakeOwned(normalizeOwned(snapshot({ captures: false }), { pals, passives })) }), 'SheepBall');
  assert.equal(byClass(old.element, 'pal-capture-line').hidden, true);
  old.destroy();
});
