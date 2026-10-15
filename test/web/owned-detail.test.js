import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, descendants, FakeElement } from '../helpers/dom.js';
import pals from '../../web/data/pals.js';
import passives from '../../web/data/passives.js';
import { buildIndex } from '../../web/js/core/index.js';
import { buildCarrierGraph } from '../../web/js/core/route.js';
import { normalizeOwned } from '../../web/js/core/owned.js';
import { parseHash } from '../../web/js/router.js';
import { ownedDetail, ownedTitle } from '../../web/js/views/owned-detail.js';
import { ownedView, ownedRowItem, openDetailOnClick } from '../../web/js/views/owned.js';

const P1 = '00000000-0000-0000-0000-000000000001';
const hasClass = (node, name) => node.className.split(' ').includes(name);
const byClass = (root, name) => descendants(root).find((node) => hasClass(node, name));

function snapshot(extra = {}) {
  return {
    version: 1, world: { name: 'テスト', hostName: 'Alice' }, players: [{ uid: P1, name: 'Alice', level: 50 }], bases: [], stats: {},
    pals: [
      { instanceId: 'a', characterId: 'Anubis', nickname: 'あぬ', gender: 'Male', level: 40, rank: 3, passives: ['Rare', 'CraftSpeed_up2'],
        skills: ['AcidRain', 'NoSuchSkill'], talent: { hp: 90, shot: 80, defense: 70 }, isRare: true, location: { kind: 'palbox', playerUid: P1, slotIndex: 31 } },
      { instanceId: 'old', characterId: 'SheepBall', gender: 'Female', level: 5, rank: 1, passives: [], talent: {}, location: { kind: 'party', playerUid: P1 } },
      { instanceId: 'egg', characterId: 'SheepBall', passives: [], talent: {}, location: { kind: 'egg-ground', playerUid: P1 } },
      ...(extra.pals ?? []),
    ],
  };
}

function fakeOwned(data = snapshot()) {
  const listeners = new Set();
  const state = { ready: true, owned: normalizeOwned(data, { pals, passives }) };
  return {
    state,
    load: () => Promise.resolve(),
    autoRefresh: () => Promise.resolve('skipped'),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    emit() { listeners.forEach((listener) => listener(state)); },
  };
}

function fakeDrawer() {
  const opened = [];
  const listeners = new Set();
  let current = null;
  return {
    opened,
    open(entry, options) { opened.push({ entry, opener: options?.opener ?? null }); current = entry; listeners.forEach((fn) => fn(current)); },
    close() { current = null; listeners.forEach((fn) => fn(null)); },
    current: () => current,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

test('個体の詳細: 名前・ニックネーム・Lv・★・印、個体値の 4 セル、パッシブと説明（ランク順）、パートナースキル、アクティブスキル（表にない ID はそのまま）、場所の図', (t) => {
  installDom(t);
  const owned = fakeOwned();
  const detail = ownedDetail({ owned, drawer: fakeDrawer() }, 'a');
  assert.equal(detail.title, 'アヌビス「あぬ」');
  const text = detail.element.textContent;
  assert.match(byClass(detail.element, 'owned-detail-name').textContent, /アヌビス/);
  assert.equal(byClass(detail.element, 'owned-detail-nickname').textContent, '「あぬ」');
  assert.match(byClass(detail.element, 'owned-detail-level').textContent, /^Lv 40/);
  assert.match(text, /ラッキー/);
  assert.equal(byClass(detail.element, 'owned-detail-talent').querySelectorAll('.talent-cell').map((cell) => cell.textContent).join(','), '90,80,70,240');
  const chips = byClass(detail.element, 'owned-detail-passives').querySelectorAll('.passive-chip');
  assert.equal(chips.length, 2);
  // 説明の文がチップの下にある
  assert.ok(byClass(detail.element, 'owned-detail-passives').querySelectorAll('.owned-detail-desc').length >= 1);
  assert.match(byClass(detail.element, 'is-partner').textContent, /砂漠の守護神/);
  const skills = byClass(detail.element, 'owned-detail-skills').querySelectorAll('li').map((item) => item.querySelector('strong').textContent);
  assert.deepEqual(skills, ['アシッドレイン', 'NoSuchSkill']);
  assert.match(byClass(detail.element, 'owned-detail-where').textContent, /Alice/);
  assert.ok(byClass(detail.element, 'box-map'));
  // 行き先: パル詳細（同じドロワー）・親にして配合を探す・逆引き・継承ルート
  const actions = byClass(detail.element, 'owned-detail-actions');
  assert.deepEqual(actions.children.map((node) => node.href ?? node.getAttribute('aria-label')),
    ['アヌビスのパル詳細', '#/search?p1=Anubis', '#/search?c=Anubis', '#/route?to=Anubis']);
  // ドロワーの中の N はその種族を親1 に
  assert.deepEqual(detail.registerInitial(), { parent1Id: 'Anubis' });
  detail.destroy();
});

test('個体の詳細: スキルの記録がない個体は「このセーブには記録がありません」、タマゴは親の検索を出さない。今のデータにいない個体は null', (t) => {
  installDom(t);
  const owned = fakeOwned();
  const old = ownedDetail({ owned }, 'old');
  assert.match(byClass(old.element, 'is-actives').textContent, /このセーブには記録がありません。/);
  assert.match(byClass(old.element, 'is-passives').textContent, /パッシブはありません。/);
  const egg = ownedDetail({ owned }, 'egg');
  assert.match(byClass(egg.element, 'owned-detail-level').textContent, /^—/);
  const hrefs = byClass(egg.element, 'owned-detail-actions').children.map((node) => node.href).filter(Boolean);
  assert.deepEqual(hrefs, ['#/search?c=SheepBall', '#/route?to=SheepBall']);
  assert.equal(egg.registerInitial(), undefined);
  assert.equal(ownedDetail({ owned }, 'nobody'), null);
  old.destroy();
  egg.destroy();
});

test('個体の詳細: キーワードを渡すと一致の理由を全部（説明つき）出し、「パル詳細」は同じドロワーにパル詳細を積む', (t) => {
  installDom(t);
  const drawer = fakeDrawer();
  const detail = ownedDetail({ owned: fakeOwned(), drawer }, 'a', { query: '地 酸' });
  const hits = byClass(detail.element, 'owned-detail-hits');
  assert.ok(hits);
  const lines = hits.querySelectorAll('li').map((item) => item.textContent);
  assert.ok(lines.some((line) => /^属性：/.test(line)), lines.join(' / '));
  assert.ok(lines.some((line) => /^アクティブスキル：アシッドレイン/.test(line) && /酸/.test(line)), lines.join(' / '));
  assert.match(byClass(detail.element, 'is-hits').querySelector('h3').textContent, /キーワード「地 酸」に一致/);
  byClass(detail.element, 'owned-detail-species').dispatch('click');
  assert.deepEqual(drawer.opened.map((item) => item.entry), [{ kind: 'pal', id: 'Anubis' }]);
  detail.destroy();
});

test('個体の詳細: 所持パルを読み直したら同じ個体を引き直して描き直し、いなくなれば「最新のセーブにいません」と「閉じる」', (t) => {
  installDom(t);
  const owned = fakeOwned();
  const drawer = fakeDrawer();
  let closed = 0;
  drawer.close = () => { closed++; };
  const detail = ownedDetail({ owned, drawer }, 'a');
  const changed = snapshot();
  changed.pals[0] = { ...changed.pals[0], level: 41 };
  owned.state.owned = normalizeOwned(changed, { pals, passives });
  owned.emit();
  assert.match(byClass(detail.element, 'owned-detail-level').textContent, /^Lv 41/);
  const gone = snapshot();
  gone.pals = gone.pals.slice(1);
  owned.state.owned = normalizeOwned(gone, { pals, passives });
  owned.emit();
  assert.match(detail.element.textContent, /この個体は最新のセーブにいません（移動・引き渡し・解放）。/);
  descendants(detail.element).find((node) => node.tagName === 'button' && node.textContent === '閉じる').dispatch('click');
  assert.equal(closed, 1);
  detail.destroy();
});

test('所持パルの行: detail の行は Lv・★のセルが詳細を開くボタンになり、パッシブ・個体値・場所・Lv を押すと開く。パル名のリンク・チップ・文字の選択中は開かない', async (t) => {
  installDom(t);
  const owned = fakeOwned();
  const drawer = fakeDrawer();
  const container = new FakeElement('div');
  const item = ownedRowItem(owned.state.owned.pals[0], { detail: true });
  container.append(item.element);
  document.body.append(container);
  openDetailOnClick(container, drawer, { query: () => '闇' });
  assert.equal(item.element.getAttribute('data-instance'), 'a');
  const level = item.element.querySelector('.owned-level');
  assert.equal(level.tagName, 'button');
  assert.equal(level.getAttribute('aria-label'), 'アヌビス「あぬ」の詳細（Lv 40・パル濃縮 ★2）');
  await container.dispatch('click', { target: level, button: 0 });
  assert.deepEqual(drawer.opened.at(-1), { entry: { kind: 'owned', id: 'a', params: { q: '闇' } }, opener: level });
  const talent = item.element.querySelector('.talent-cell');
  await container.dispatch('click', { target: talent, button: 0 });
  assert.equal(drawer.opened.length, 2);
  // パル名のリンク・パッシブのチップは開かない
  await container.dispatch('click', { target: item.element.querySelector('.pal-tile').children[0], button: 0 });
  await container.dispatch('click', { target: item.element.querySelector('.passive-chip'), button: 0 });
  assert.equal(drawer.opened.length, 2);
  // 文字を選んでいる
  globalThis.getSelection = () => ({ toString: () => 'アヌビス' });
  t.after(() => { delete globalThis.getSelection; });
  await container.dispatch('click', { target: talent, button: 0 });
  assert.equal(drawer.opened.length, 2);
  // detail のない行（理想個体の組のカードなど）は Lv のセルが div のまま
  assert.equal(ownedRowItem(owned.state.owned.pals[0]).element.querySelector('.owned-level').tagName, 'div');
});

test('所持パルの画面: 開いている個体の行に aria-current を付け、ドロワーを閉じると外す', (t) => {
  installDom(t);
  const owned = fakeOwned();
  const drawer = fakeDrawer();
  const index = buildIndex([], pals);
  const state = { records: [], index, graph: buildCarrierGraph(index), env: 'test', warnings: [], userId: '仲間' };
  const context = { store: { state, subscribe: () => () => {} }, owned, drawer, navigate: () => {}, replace: () => {}, inputDelay: 0, viewState: () => ({}) };
  const view = ownedView(context, parseHash('#/owned?holder='));
  document.body.append(view.element);
  const rowOf = (id) => view.element.querySelectorAll('.owned-row').find((row) => row.getAttribute('data-instance') === id);
  assert.ok(rowOf('a'));
  rowOf('a').querySelector('.owned-level').dispatch('click');
  view.element.querySelector('.owned-list').dispatch('click', { target: rowOf('a').querySelector('.owned-level'), button: 0 });
  assert.equal(drawer.opened.at(-1).entry.id, 'a');
  assert.equal(rowOf('a').getAttribute('aria-current'), 'true');
  assert.equal(rowOf('old').getAttribute('aria-current'), null);
  drawer.close();
  assert.equal(rowOf('a').getAttribute('aria-current'), null);
  view.destroy();
});

test('個体の詳細: 所持パルを読み込む前（読み込み直した直後に履歴から戻した）は読み込み中を出し、届いたら描いて見出しを直す。読み込んでもいなければ「最新のセーブにいません」', (t) => {
  installDom(t);
  const owned = fakeOwned();
  const loaded = owned.state.owned;
  owned.state.ready = false;
  owned.state.owned = null;
  const titles = [];
  const detail = ownedDetail({ owned, drawer: fakeDrawer() }, 'a', { setTitle: (text) => titles.push(text) });
  assert.ok(detail);
  assert.equal(detail.title, '所持パルの個体');
  assert.match(detail.element.textContent, /所持パルを読み込み中…/);
  // 読み込みの途中の知らせ（ready の前）では描かない
  owned.emit();
  assert.match(detail.element.textContent, /所持パルを読み込み中…/);
  owned.state.owned = loaded;
  owned.state.ready = true;
  owned.emit();
  assert.match(byClass(detail.element, 'owned-detail-level').textContent, /^Lv 40/);
  assert.deepEqual(titles, ['アヌビス「あぬ」']);
  detail.destroy();
  // 読み込みが終わってもいない個体
  const empty = fakeOwned();
  empty.state.ready = false;
  empty.state.owned = null;
  const gone = ownedDetail({ owned: empty }, 'nobody');
  empty.state.ready = true;
  empty.state.owned = loaded;
  empty.emit();
  assert.match(gone.element.textContent, /この個体は最新のセーブにいません/);
  gone.destroy();
});

test('個体の詳細: 読み直して描き直しても、フォーカスを同じ役目の部品（「パル詳細」など）へ引き継ぎ、ニックネームが変わったら見出しを直す', (t) => {
  const { body } = installDom(t);
  const owned = fakeOwned();
  const titles = [];
  const detail = ownedDetail({ owned, drawer: fakeDrawer() }, 'a', { setTitle: (text) => titles.push(text) });
  body.append(detail.element);
  byClass(detail.element, 'owned-detail-species').focus();
  const renamed = snapshot();
  renamed.pals[0] = { ...renamed.pals[0], nickname: 'あぬびす' };
  owned.state.owned = normalizeOwned(renamed, { pals, passives });
  owned.emit();
  assert.equal(document.activeElement, byClass(detail.element, 'owned-detail-species'));
  assert.equal(titles.at(-1), 'アヌビス「あぬびす」');
  // いなくなって「閉じる」だけになったら、中身（フォーカスできるようにする）へ。ドロワーの外には落とさない
  const gone = snapshot();
  gone.pals = gone.pals.slice(1);
  owned.state.owned = normalizeOwned(gone, { pals, passives });
  owned.emit();
  assert.equal(document.activeElement, detail.element);
  assert.equal(detail.element.tabIndex, -1);
  detail.destroy();
});

test('個体の詳細: 題名はニックネームつき', () => {
  assert.equal(ownedTitle({ name: 'モコロン', nickname: '' }), 'モコロン');
  assert.equal(ownedTitle({ name: 'モコロン', nickname: 'もこ' }), 'モコロン「もこ」');
});
