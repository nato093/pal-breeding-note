import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, descendants } from '../helpers/dom.js';
import pals from '../../web/data/pals.js';
import passives from '../../web/data/passives.js';
import { PARTNER_SKILLS } from '../../web/data/skills.js';
import { buildIndex } from '../../web/js/core/index.js';
import { normalizeOwned, PLACE_ORDER } from '../../web/js/core/owned.js';
import { palDetail, PAL_RECORDS_SHOWN } from '../../web/js/views/pal-detail.js';
import { installHoverCards } from '../../web/js/ui/hover-card.js';
import { passiveChip } from '../../web/js/ui/passive-picker.js';
import { palTile } from '../../web/js/ui/pal-icon.js';

const P1 = '00000000-0000-0000-0000-000000000001';
const hasClass = (node, name) => node.className.split(' ').includes(name);
const byClass = (root, name) => descendants(root).find((node) => hasClass(node, name));

// モコロンの個体 7 体（タマゴ 1・グローバル 1）と、ツッパニャン 1 体
function ownedSnapshot() {
  const sheep = (id, extra = {}) => ({ instanceId: id, characterId: 'SheepBall', gender: 'Female', level: 10, rank: 1, passives: [], talent: { hp: 10, shot: 10, defense: 10 }, location: { kind: 'palbox', playerUid: P1, slotIndex: 1 }, ...extra });
  return {
    version: 1, world: { name: 'テスト', hostName: 'Alice' }, players: [{ uid: P1, name: 'Alice', level: 50 }], bases: [], stats: {},
    pals: [
      sheep('a', { gender: 'Male', passives: ['Rare', 'CraftSpeed_up2'] }), sheep('b', { gender: 'Male' }), sheep('c'), sheep('d'), sheep('e', { passives: ['Rare'] }),
      sheep('egg', { location: { kind: 'egg-ground', playerUid: P1 } }), sheep('glob', { location: { kind: 'global', playerUid: '' } }),
      { instanceId: 'p', characterId: 'PinkCat', gender: 'Male', level: 3, rank: 1, passives: [], talent: {}, location: { kind: 'party', playerUid: P1 } },
    ],
  };
}

function fakeOwned(snapshot = ownedSnapshot()) {
  const listeners = new Set();
  const state = { ready: true, owned: snapshot ? normalizeOwned(snapshot, { pals, passives }) : null };
  return {
    state, loads: 0,
    load() { this.loads++; return Promise.resolve(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    emit() { listeners.forEach((listener) => listener(state)); },
  };
}

function fakeIdeals() {
  const goals = [];
  const listeners = new Set();
  const added = [];
  return {
    goals, added,
    list: () => goals,
    add(goal) { added.push(goal); goals.push({ ...goal, id: `g${goals.length}` }); listeners.forEach((fn) => fn()); return 'added'; },
    remove(id) { const index = goals.findIndex((goal) => goal.id === id); const [goal] = goals.splice(index, 1); listeners.forEach((fn) => fn()); return { goal, index }; },
    restore() { return true; },
    scope: () => 'scope',
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

function context({ records = [], owned = null, ideals = fakeIdeals() } = {}) {
  const index = buildIndex(records, pals);
  const listeners = new Set();
  const state = { records, index, env: 'test', revision: 1, warnings: [], userId: '仲間' };
  const navigations = [];
  return {
    store: { state, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }, refresh: () => {}, emit: () => listeners.forEach((fn) => fn(state)) },
    owned, ideals, navigations, navigate: (hash) => navigations.push(hash), registered: [], register(initial) { this.registered.push(initial); },
  };
}

const record = (id, parent1Id, parent2Id, childId, updatedAt) => ({ id, parent1Id, parent2Id, childId, parent1Gender: '', parent2Gender: '', registrant: '仲間', memo: '', updatedAt });

test('パル詳細: 見出しは「No.〈番号〉 〈名前〉」、ヒーローに英名とパートナースキル、行き先のボタン（継承ルート 2・理想個体・目標・登録）', (t) => {
  installDom(t);
  const detail = palDetail(context(), 'MoonQueen');
  const pal = pals.find((item) => item.id === 'MoonQueen');
  assert.equal(detail.title, `No.${pal.label} ${pal.ja}`);
  assert.equal(detail.element.querySelector('h1').textContent, detail.title);
  assert.equal(byClass(detail.element, 'pal-en').textContent, pal.en);
  assert.match(byClass(detail.element, 'pal-partner').textContent, new RegExp(PARTNER_SKILLS.MoonQueen));
  // 第 1 属性の色の地
  assert.ok(hasClass(byClass(detail.element, 'pal-hero'), `element-${pal.el[0]}`));
  const actions = byClass(detail.element, 'pal-hero-actions');
  assert.deepEqual(actions.children.map((node) => node.href ?? node.textContent),
    ['#/route?from=MoonQueen', '#/route?to=MoonQueen', '#/ideal?to=MoonQueen', '目標に保存', 'この子の配合を登録']);
  // 所持パルのデータがなければ所持の欄は出さない
  assert.equal(byClass(detail.element, 'pal-owned-line').hidden, true);
  assert.equal(byClass(detail.element, 'pal-owned-top').hidden, true);
  // 「この子の配合を登録」はそのパルを子にして開く
  const app = context();
  const other = palDetail(app, 'MoonQueen');
  other.element.querySelectorAll('button').find((node) => node.textContent === 'この子の配合を登録').dispatch('click');
  assert.deepEqual(app.registered, [{ childId: 'MoonQueen' }]);
  assert.deepEqual(other.registerInitial(), { childId: 'MoonQueen' });
  detail.destroy();
  other.destroy();
  // 不正な ID は null
  assert.equal(palDetail(context(), 'NoSuchPal'), null);
});

test('パル詳細: 所持パルがあると「所持 n 体（うちタマゴ・グローバル）· 親になれる ♂♀ · 所持パルで見る」と、閉じた上位 5 体（開くと行を作り、読み直しても開いたまま）', (t) => {
  installDom(t);
  const owned = fakeOwned();
  const detail = palDetail(context({ owned }), 'SheepBall');
  assert.equal(owned.loads, 1);
  const line = byClass(detail.element, 'pal-owned-line');
  assert.equal(line.hidden, false);
  assert.match(line.textContent, /所持7 体（うちタマゴ 1・グローバル 1）/);
  assert.match(byClass(line, 'pal-owned-parents').textContent, /親になれる ♂2 ♀3/);
  assert.equal(byClass(line, 'pal-owned-link').href, `#/owned?pal=SheepBall&place=${encodeURIComponent(PLACE_ORDER.join(','))}`);
  const top = byClass(detail.element, 'pal-owned-top');
  assert.equal(top.hidden, false);
  assert.equal(top.open, undefined);
  assert.equal(top.querySelector('summary').textContent, '所持個体（上位 5 体 / 7 体）');
  // 閉じている間は行を作らない
  assert.equal(top.querySelectorAll('.owned-row').length, 0);
  top.open = true;
  top.dispatch('toggle');
  const rows = top.querySelectorAll('.owned-row');
  assert.equal(rows.length, 5);
  // パッシブのランクが高い順（レア＋作業速度の a が先頭）
  assert.match(rows[0].textContent, /もこ|モコロン/);
  // 所持パルを読み直しても開いたまま、行は同じ要素
  owned.state.owned = normalizeOwned(ownedSnapshot(), { pals, passives });
  owned.emit();
  assert.equal(top.open, true);
  assert.equal(top.querySelectorAll('.owned-row').length, 5);
  // 持っていない種族は「未所持」で、上位の欄は出さない
  const none = palDetail(context({ owned }), 'MoonQueen');
  assert.match(byClass(none.element, 'pal-owned-line').textContent, /未所持/);
  assert.equal(byClass(none.element, 'pal-owned-top').hidden, true);
  detail.destroy();
  none.destroy();
});

test('パル詳細: 配合の 2 節は件数と更新日の新しい順の上位 3 件。4 件以上のときだけ「すべて見る」（配合を探すの子・親の URL）', (t) => {
  installDom(t);
  const records = [
    record('r1', 'SheepBall', 'PinkCat', 'MoonQueen', '2026-10-01T00:00:00Z'),
    record('r2', 'FlowerDoll', 'PinkCat', 'MoonQueen', '2026-10-04T00:00:00Z'),
    record('r3', 'ChickenPal', 'PinkCat', 'MoonQueen', '2026-10-03T00:00:00Z'),
    record('r4', 'Alpaca', 'PinkCat', 'MoonQueen', '2026-10-02T00:00:00Z'),
    record('r5', 'MoonQueen', 'PinkCat', 'SheepBall', '2026-10-02T00:00:00Z'),
  ];
  const detail = palDetail(context({ records }), 'MoonQueen');
  const sections = detail.element.querySelectorAll('.pal-records');
  assert.equal(sections[0].querySelector('h2').textContent, 'このパルが産まれる配合 4 件');
  assert.equal(sections[1].querySelector('h2').textContent, 'このパルを親に使う配合 1 件（相手 → 子）');
  const born = sections[0].querySelectorAll('.breeding-card');
  assert.equal(born.length, PAL_RECORDS_SHOWN);
  // 新しい順（r2 → r3 → r4）。カードの式の親の名前で確かめる
  const ja = (id) => pals.find((pal) => pal.id === id).ja;
  assert.deepEqual(born.map((card) => card.querySelector('.breeding-equation').textContent.includes(ja('FlowerDoll'))), [true, false, false]);
  assert.ok(born[1].querySelector('.breeding-equation').textContent.includes(ja('ChickenPal')));
  assert.ok(born[2].querySelector('.breeding-equation').textContent.includes(ja('Alpaca')));
  const more = sections[0].querySelector('.pal-records-more');
  assert.equal(more.hidden, false);
  assert.equal(more.href, '#/search?c=MoonQueen');
  assert.equal(sections[1].querySelector('.pal-records-more').hidden, true);
  assert.equal(sections[1].querySelector('.pal-records-more').href, '#/search?p1=MoonQueen');
  // 産まれる配合があるので「この子の配合を登録」は控えめ
  assert.equal(detail.element.querySelectorAll('button').find((node) => node.textContent === 'この子の配合を登録').className, 'button small secondary');
  detail.destroy();
});

test('パル詳細: 「目標に保存」は種族だけの目標（パッシブなし・個体値 0・order なし）を保存し、もう一度押すと外す', (t) => {
  installDom(t);
  const ideals = fakeIdeals();
  const detail = palDetail(context({ ideals }), 'SheepBall');
  const goal = byClass(detail.element, 'goal-toggle');
  goal.dispatch('click', { detail: 1 });
  assert.equal(ideals.added.length, 1);
  const [saved] = ideals.added;
  assert.equal(saved.palId, 'SheepBall');
  assert.deepEqual(saved.passives, []);
  assert.deepEqual(Object.values(saved.targets), [0, 0, 0]);
  assert.equal('order' in saved, false);
  assert.equal(goal.getAttribute('aria-pressed'), 'true');
  goal.dispatch('click', { detail: 1 });
  assert.equal(ideals.goals.length, 0);
  assert.equal(goal.getAttribute('aria-pressed'), 'false');
  detail.destroy();
});

test('パル詳細: ドロワーでは見出しを出さず（ドロワーの h2）、節は h3。パルの切り替えは onSwitch、ページでは navigate', async (t) => {
  installDom(t);
  const switched = [];
  const app = context();
  const inDrawer = palDetail(app, 'SheepBall', { mode: 'drawer', onSwitch: (id) => switched.push(id) });
  assert.equal(inDrawer.element.querySelector('h1'), null);
  assert.ok(inDrawer.element.querySelector('h3'));
  assert.ok(hasClass(inDrawer.element, 'is-drawer'));
  const trigger = byClass(inDrawer.element, 'pal-switch').querySelector('.picker-trigger');
  document.body.append(inDrawer.element);
  await trigger.dispatch('click');
  const input = descendants(document.body).find((node) => node.tagName === 'input' && node.getAttribute('aria-label') === 'パルを切り替えを検索');
  input.value = 'ツッパニャン';
  await input.dispatch('input');
  await input.dispatch('keydown', { key: 'ArrowDown' });
  await input.dispatch('keydown', { key: 'Enter' });
  assert.deepEqual(switched, ['PinkCat']);
  const page = palDetail(app, 'SheepBall', { mode: 'page' });
  document.body.append(page.element);
  await byClass(page.element, 'pal-switch').querySelector('.picker-trigger').dispatch('click');
  const pageInput = descendants(document.body).filter((node) => node.tagName === 'input' && node.getAttribute('aria-label') === 'パルを切り替えを検索').at(-1);
  pageInput.value = 'ツッパニャン';
  await pageInput.dispatch('input');
  await pageInput.dispatch('keydown', { key: 'ArrowDown' });
  await pageInput.dispatch('keydown', { key: 'Enter' });
  assert.deepEqual(app.navigations, ['#/pal/PinkCat']);
  inDrawer.destroy();
  page.destroy();
});

test('解説の板: パルのタイル・パッシブのチップに止まると少し後に板を出し（title は外す）、離れる・Esc で外す。チップは押すと固定する', (t) => {
  const { body } = installDom(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const owned = fakeOwned();
  const root = document.createElement('div');
  body.append(root);
  const tile = palTile('SheepBall');
  const chip = passiveChip('Rare');
  root.append(tile, chip);
  const index = buildIndex([record('r1', 'SheepBall', 'PinkCat', 'MoonQueen', '2026-10-01T00:00:00Z')], pals);
  const cards = installHoverCards(root, { context: { owned, store: { state: { index } } }, delay: 200 });
  assert.equal(tile.getAttribute('data-pal-id'), 'SheepBall');
  assert.equal(chip.getAttribute('data-passive-id'), 'Rare');
  root.dispatch('pointerover', { target: tile.children[1], pointerType: 'mouse' });
  t.mock.timers.tick(199);
  assert.equal(cards.current(), null);
  t.mock.timers.tick(1);
  assert.deepEqual(cards.current(), { kind: 'pal', id: 'SheepBall', pinned: false });
  assert.equal(cards.element.isConnected, true);
  assert.match(cards.element.textContent, /モコロン/);
  assert.match(cards.element.textContent, /所持 ♂2 ♀3（全 7 体）/);
  assert.match(cards.element.textContent, /登録 産まれる 0 件・親 1 件/);
  assert.equal(tile.getAttribute('aria-describedby'), cards.element.id);
  // 離れると外す
  root.dispatch('pointerout', { target: tile, relatedTarget: body });
  assert.equal(cards.current(), null);
  assert.equal(cards.element.isConnected, false);
  // チップ: title を外して板を出し、離れたら戻す
  const title = chip.title;
  assert.ok(title);
  root.dispatch('pointerover', { target: chip, pointerType: 'mouse' });
  assert.equal(chip.title, '');
  t.mock.timers.tick(200);
  assert.match(cards.element.textContent, /希少/);
  assert.match(cards.element.textContent, /所持パルのうち 2 体が持っています/);
  root.dispatch('keydown', { key: 'Escape' });
  assert.equal(cards.current(), null);
  assert.equal(chip.title, title);
  // 押すと固定し、離れても残り、もう一度押すと外す
  root.dispatch('click', { target: chip });
  assert.deepEqual(cards.current(), { kind: 'passive', id: 'Rare', pinned: true });
  root.dispatch('pointerout', { target: chip, relatedTarget: body });
  assert.equal(cards.current().pinned, true);
  root.dispatch('click', { target: chip });
  assert.equal(cards.current(), null);
  // タッチでは出さない
  root.dispatch('pointerover', { target: tile, pointerType: 'touch' });
  t.mock.timers.tick(500);
  assert.equal(cards.current(), null);
  // フォーカスでも出す（キーボード）。Enter で固定
  const focusable = passiveChip('Rare', { focusable: true });
  root.append(focusable);
  assert.equal(focusable.tabIndex, 0);
  root.dispatch('focusin', { target: focusable });
  t.mock.timers.tick(200);
  assert.equal(cards.current().kind, 'passive');
  root.dispatch('keydown', { key: 'Enter', target: focusable });
  assert.equal(cards.current().pinned, true);
  cards.destroy();
  assert.equal(cards.current(), null);
});
