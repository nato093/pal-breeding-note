import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, descendants } from '../helpers/dom.js';
import pals from '../../web/data/pals.js';
import passives from '../../web/data/passives.js';
import { buildIndex } from '../../web/js/core/index.js';
import { normalizeOwned } from '../../web/js/core/owned.js';
import { farmBoard, farmState, FARM_EGGS_SHOWN } from '../../web/js/ui/farm-board.js';

const P1 = '00000000-0000-0000-0000-000000000001';
const hasClass = (node, name) => node.className.split(' ').includes(name);
const byClass = (root, name) => descendants(root).filter((node) => hasClass(node, name));

const individual = (instanceId, characterId, gender, extra = {}) => ({
  instanceId, characterId, gender, level: 20, rank: 1, passives: [], talent: { hp: 10, shot: 20, defense: 30 },
  location: { kind: 'base', playerUid: '', baseId: 'B1' }, lastOwnerUid: P1, ...extra,
});
const eggOf = (instanceId, characterId, itemId = 'PalEgg_Normal_01') => individual(instanceId, characterId, '', { location: { kind: 'egg-ground', playerUid: '', baseId: 'B1', itemId } });

function data({ extraEggs = 0 } = {}) {
  const eggs = Array.from({ length: 3 + extraEggs }, (_, i) => eggOf(`e${i}`, i === 1 ? 'Anubis' : 'SheepBall', i === 1 ? 'PalEgg_MutationPal_01' : 'PalEgg_Normal_01'));
  return normalizeOwned({
    version: 1, world: { name: 'テスト', hostName: 'Alice' }, players: [{ uid: P1, name: 'Alice', level: 50 }], stats: {},
    bases: [{ id: 'B1', number: 1, guildId: 'G', containerId: '', position: null }, { id: 'B2', number: 2, guildId: 'G', containerId: '', position: null }],
    pals: [
      individual('m', 'SheepBall', 'Male', { passives: ['Rare'] }), individual('f', 'FlowerDoll', 'Female'), individual('m2', 'PinkCat', 'Male'),
      individual('x', 'PinkCat', 'Male'), individual('y', 'PinkCat', 'Male'), ...eggs,
    ],
    breedFarms: [
      { id: 'FA', baseId: 'B1', status: 'ok', parents: [{ instanceId: 'm' }, { instanceId: 'f' }], eggs: eggs.map((egg) => ({ localId: egg.instanceId, characterId: egg.characterId, itemId: egg.location.itemId })) },
      { id: 'FB', baseId: 'B1', status: 'ok', parents: [{ instanceId: 'm2' }], eggs: [] },
      { id: 'FC', baseId: 'B2', status: 'ok', parents: [], eggs: [] },
      { id: 'FD', baseId: 'B2', status: 'ok', parents: [{ instanceId: 'x' }, { instanceId: 'y' }], eggs: [] },
      { id: 'FE', baseId: 'B2', status: 'uncertain', parents: [], eggs: [] },
    ],
  }, { pals, passives });
}

function context(owned, records = []) {
  const listeners = new Set();
  const opened = [];
  return {
    owned: { state: { owned }, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }, emit: () => listeners.forEach((fn) => fn()) },
    store: { state: { index: buildIndex(records, pals) }, subscribe: () => () => {} },
    drawer: { open: (entry) => opened.push(entry) },
    opened,
  };
}

test('配合牧場ボード: 拠点の順・同じ拠点の中は A／B の順にカードを並べ、状態（配合中・片親・空き・同性・読めませんでした）を出す', (t) => {
  installDom(t);
  const ctx = context(data());
  const board = farmBoard(ctx);
  const cards = byClass(board.element, 'farm-card');
  assert.deepEqual(cards.map((card) => card.querySelector('h3').textContent), ['拠点 1 の牧場 A', '拠点 1 の牧場 B', '拠点 2 の牧場 A', '拠点 2 の牧場 B', '拠点 2 の牧場 C']);
  assert.deepEqual(cards.map((card) => byClass(card, 'farm-state')[0].textContent), ['配合中', '片親', '空き', '同性', '読めませんでした']);
  assert.equal(board.title, '配合牧場');
  assert.deepEqual(board.summary(), { farms: 5, eggs: 3 });
  // 親の個体（名前・Lv・個体値の合計・預けた人・パッシブ）を押すと、その個体の詳細を開く
  const parent = byClass(cards[0], 'farm-parent')[0];
  assert.match(parent.textContent, /モコロン/);
  assert.match(parent.textContent, /Lv 20 · 個体値 計 60/);
  assert.match(parent.textContent, /Alice が預けた/);
  parent.dispatch('click');
  assert.deepEqual(ctx.opened, [{ kind: 'owned', id: 'm' }]);
  board.destroy();
  assert.equal(farmState({ status: 'ok', parents: ['a', 'b'] }, new Map([['a', { gender: 'F' }], ['b', { gender: 'F' }]])).text, '同性');
  // ♂♀ でもケーキがない（[]）ならタマゴを産まないので、緑の「配合中」にせず警告の「ケーキ切れ」。分からない（null・ない）は「配合中」のまま
  const pair = new Map([['a', { gender: 'M' }], ['b', { gender: 'F' }]]);
  assert.deepEqual(farmState({ status: 'ok', parents: ['a', 'b'], cakes: [] }, pair), { text: 'ケーキ切れ', tone: 'warning' });
  for (const cakes of [null, undefined, [{ itemId: 'Cake02', count: 3 }]]) assert.deepEqual(farmState({ status: 'ok', parents: ['a', 'b'], cakes }, pair), { text: '配合中', tone: 'ready' });
  // 片親・空きは前のまま（ケーキの 1 行が「ケーキ切れ」を出す）
  assert.equal(farmState({ status: 'ok', parents: ['a'], cakes: [] }, pair).text, '片親');
});

test('配合牧場ボード: タマゴの数と中身の絵（突然変異は印）、20 個を超えたら「ほか n 個」。中身の分からない共有・古い形の共有の文', (t) => {
  installDom(t);
  const ctx = context(data({ extraEggs: 22 }));
  const board = farmBoard(ctx);
  const first = byClass(board.element, 'farm-card')[0];
  assert.equal(byClass(first, 'farm-eggs-head')[0].textContent, 'タマゴ 25 個');
  const eggs = byClass(first, 'farm-egg');
  assert.equal(eggs.length, FARM_EGGS_SHOWN);
  assert.ok(hasClass(eggs[1], 'is-mutant'));
  assert.match(eggs[1].querySelector('button').getAttribute('aria-label'), /アヌビスのタマゴ（突然変異タマゴ）・突然変異の詳細/);
  assert.match(byClass(first, 'farm-eggs-note').at(-1).textContent, /ほか 5 個/);
  eggs[0].querySelector('button').dispatch('click');
  assert.deepEqual(ctx.opened.at(-1), { kind: 'owned', id: 'e0' });
  board.destroy();
  // 共有で中身を省いた牧場（eggs: null）と、数の分からない古い形
  const shared = data();
  shared.farms = shared.farms.map((farm) => ({ ...farm, eggs: null }));
  const noContents = farmBoard(context(shared));
  // サーバーのワールドでも意味が通る文（見られる画面を言わない。server の participant-ui）
  assert.match(byClass(noContents.element, 'farm-card')[0].textContent, /タマゴ 3 個中身は共有に入りきらないため省いています/);
  assert.doesNotMatch(byClass(noContents.element, 'farm-card')[0].textContent, /ホストの画面/);
  noContents.destroy();
  shared.farmsCounted = false;
  const legacy = farmBoard(context(shared));
  assert.match(byClass(legacy.element, 'farm-card')[0].textContent, /タマゴの情報なし/);
  assert.equal(legacy.summary().eggs, null);
  legacy.destroy();
  // 一部だけの共有
  shared.farmsPartial = true;
  const partial = farmBoard(context(shared));
  assert.equal(byClass(partial.element, 'farm-board-note')[0].hidden, false);
  assert.match(byClass(partial.element, 'farm-board-note')[0].textContent, /一部/);
  partial.destroy();
});

test('配合牧場ボード: 開いたまま記録を足して索引が変わると、その組の登録の件数を直す', (t) => {
  installDom(t);
  const app = context(data());
  const board = farmBoard(app);
  const link = () => byClass(byClass(board.element, 'farm-card')[0], 'farm-records')[0].textContent;
  assert.equal(link(), 'この組の登録はまだありません');
  app.store.state = { index: buildIndex([{ id: 'r1', parent1Id: 'SheepBall', parent2Id: 'FlowerDoll', childId: 'MoonQueen', parent1Gender: '', parent2Gender: '', registrant: 'A', memo: '', updatedAt: '2026-10-01T00:00:00Z' }], pals) };
  board.update();
  assert.equal(link(), 'この組の登録 1 件を見る');
  board.destroy();
});

test('配合牧場ボード: タマゴの数の分からない古い形の共有から新しい形に替わったら、「タマゴの情報なし」を描き直す', (t) => {
  installDom(t);
  const old = data();
  old.farmsCounted = false;
  for (const farm of old.farms) Object.assign(farm, { eggs: null, eggCount: 0 });
  const app = context(old);
  const board = farmBoard(app);
  assert.match(byClass(board.element, 'farm-card')[1].textContent, /タマゴの情報なし/);
  const next = data();
  for (const farm of next.farms) Object.assign(farm, { eggs: null, eggCount: 0 });
  app.owned.state.owned = next;
  app.owned.emit();
  assert.doesNotMatch(byClass(board.element, 'farm-card')[1].textContent, /タマゴの情報なし/);
  board.destroy();
});

test('配合牧場ボード: その組の登録済みの配合の件数へのリンクだけを出し、子の名前・「→」の式は出さない（INV-2）。牧場の情報がなければ案内', (t) => {
  installDom(t);
  const records = [{ id: 'r1', parent1Id: 'SheepBall', parent2Id: 'FlowerDoll', childId: 'MoonQueen', parent1Gender: '', parent2Gender: '', registrant: 'A', memo: '', updatedAt: '2026-10-01T00:00:00Z' }];
  const board = farmBoard(context(data(), records));
  const first = byClass(board.element, 'farm-card')[0];
  const link = byClass(first, 'farm-records')[0];
  assert.equal(link.textContent, 'この組の登録 1 件を見る');
  assert.equal(link.href, '#/search?p1=SheepBall&p2=FlowerDoll');
  for (const card of byClass(board.element, 'farm-card')) {
    assert.doesNotMatch(card.textContent, /→/);
    assert.doesNotMatch(card.textContent, /セレムーン/);
  }
  board.destroy();
  const none = data();
  none.farms = null;
  const empty = farmBoard(context(none));
  assert.match(byClass(empty.element, 'farm-board-note')[0].textContent, /配合牧場の情報がありません/);
  assert.equal(empty.summary(), null);
  empty.destroy();
});

test('配合牧場ボード: 所持パルを読み直すと描き直し、牧場が 0 件なら「配合牧場はまだありません。」', (t) => {
  installDom(t);
  const owned = data();
  const ctx = context(owned);
  const board = farmBoard(ctx);
  assert.equal(byClass(board.element, 'farm-card').length, 5);
  ctx.owned.state.owned = { ...owned, farms: [] };
  ctx.owned.emit();
  assert.equal(byClass(board.element, 'farm-card').length, 0);
  assert.equal(byClass(board.element, 'farm-board-empty')[0].textContent, '配合牧場はまだありません。');
  board.destroy();
});
