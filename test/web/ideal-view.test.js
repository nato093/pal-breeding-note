import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from '../helpers/dom.js';
import pals from '../../web/data/pals.js';
import passives from '../../web/data/passives.js';
import { buildIndex } from '../../web/js/core/index.js';
import { buildCarrierGraph } from '../../web/js/core/route.js';
import { normalizeOwned } from '../../web/js/core/owned.js';
import { parseHash, buildHash } from '../../web/js/router.js';
import { idealView, percent, eggsText } from '../../web/js/views/ideal.js';
import { createIdealStore } from '../../web/js/ideals.js';

const P1 = '00000000-0000-0000-0000-000000000001';
const full = { hp: 100, shot: 100, defense: 100 };
const palworldPal = (instanceId, characterId, gender, passiveIds, talent = full, location = { kind: 'palbox', playerUid: P1 }) => ({
  instanceId, characterId, gender, level: 10, rank: 1, passives: passiveIds, talent, location,
});
const basePals = [
  palworldPal('m1', 'SheepBall', 'Male', ['CraftSpeed_up2']),
  palworldPal('f1', 'SheepBall', 'Female', ['Rare']),
  palworldPal('f2', 'SheepBall', 'Female', ['Rare', 'Noukin']),
  palworldPal('u1', 'SheepBall', '', ['CraftSpeed_up2', 'Rare']),
  palworldPal('e1', 'SheepBall', 'Female', ['CraftSpeed_up2', 'Rare'], full, { kind: 'egg-ground', playerUid: P1 }),
];

function fakeOwned(list = basePals) {
  const listeners = new Set();
  const snapshot = { version: 1, world: { name: 'テスト', hostName: 'Alice' }, players: [{ uid: P1, name: 'Alice', level: 50 }], bases: [], pals: list, stats: {} };
  const state = { ready: true, data: { snapshot }, owned: list ? normalizeOwned(snapshot, { pals, passives }) : null };
  return {
    state, loads: 0,
    load() { this.loads++; return Promise.resolve(); },
    autoRefresh: () => Promise.resolve('skipped'),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    emit() { listeners.forEach((listener) => listener(state)); },
    listeners,
  };
}

function context(owned, records = [], states = new Map()) {
  const index = buildIndex(records, pals);
  const state = { records, index, graph: buildCarrierGraph(index), env: 'test', warnings: [], userId: '仲間' };
  const navigations = [];
  return {
    store: { state, subscribe: () => () => {} }, owned, navigations, navigate: (hash) => navigations.push(hash), replace() {},
    viewState(view) { if (!states.has(view)) states.set(view, {}); return states.get(view); },
  };
}

// 画面は開いている間 20 秒ごとに読み直すので、タイマーはモックにする（開いたままの画面がテストを止めないように）
function install(t) {
  installDom(t);
  t.mock.timers.enable({ apis: ['setInterval'] });
}

const cards = (view) => view.element.querySelectorAll('.ideal-pair');
const pairOf = (card) => card.querySelectorAll('.owned-row').map((row) => row.getAttribute('aria-label')).join('×');
// 同じ種族の個体は名前で区別できないので、個体値の表示で見分ける
const talentsOf = (card) => card.querySelectorAll('.owned-talent').map((node) => node.textContent).join(' × ');
const input = (view, label) => view.element.querySelectorAll('input').find((node) => node.getAttribute('aria-label') === label);

test('理想個体画面: URL の目標とパッシブで、所持パルの ♂×♀ を確率の高い順に出す', (t) => {
  install(t);
  const owned = fakeOwned();
  const view = idealView(context(owned), parseHash('#/ideal?to=SheepBall&p=CraftSpeed_up2,Rare'));
  const list = cards(view);
  assert.equal(list.length, 3);
  // 余計なパッシブのない組が先（タマゴの e1 も中身が分かるので候補。性別不明は候補にしない）
  assert.match(list[0].textContent, /1 個のタマゴで 16\.8%/);
  assert.match(list[0].textContent, /タマゴ/);
  assert.match(list[1].textContent, /1 個のタマゴで 16\.8%/);
  assert.match(list[0].textContent, /平均 約 6 個に 1 個 · パッシブ 60% × 個体値 28%/);
  assert.match(list[0].textContent, /同じ種族どうし/);
  assert.match(list[2].textContent, /余計なパッシブ: 脳筋（これがなければ、パッシブの確率は 40% → 60%）/);
  assert.equal(view.element.querySelector('.result-note').textContent, '3 組 · 候補 4 体 · 同じ種族どうし · 性別不明の 1 体は除外 · 20 秒ごとに確認');
  assert.match(view.element.querySelector('.ideal-help').textContent, /計算のしくみ/);
  // 選んだパッシブは選択欄に出る
  assert.deepEqual(view.element.querySelectorAll('.passive-selector')[0].querySelectorAll('.passive-name').map((node) => node.textContent), ['職人気質', '希少']);
  assert.equal(owned.loads, 1);
  view.destroy();
  assert.equal(owned.listeners.size, 0);
});

test('理想個体画面: 個体値の目標とケーキを変えると結果だけ作り直し、条件はタブを戻っても残る', (t) => {
  install(t);
  const owned = fakeOwned([
    palworldPal('m1', 'SheepBall', 'Male', [], { hp: 100, shot: 0, defense: 100 }),
    palworldPal('m2', 'SheepBall', 'Male', [], { hp: 90, shot: 90, defense: 90 }),
    palworldPal('f1', 'SheepBall', 'Female', [], { hp: 90, shot: 90, defense: 90 }),
  ]);
  const states = new Map();
  const view = idealView(context(owned, [], states), parseHash('#/ideal?to=SheepBall'));
  const attack = input(view, '攻撃の目標');
  assert.equal(attack.value, '100');
  // 3 つとも 100 が目標なら、100 を持つ m1 の組が先。90 どうしは届かない
  assert.deepEqual(cards(view).map(talentsOf), ['HP 100 / 攻 0 / 防 100 × HP 90 / 攻 90 / 防 90', 'HP 90 / 攻 90 / 防 90 × HP 90 / 攻 90 / 防 90']);
  assert.match(cards(view)[1].textContent, /目標に届きません/);
  assert.match(cards(view)[1].textContent, /個体値の目標に届くステータスを持っていない/);
  // 目標を 90 にすると、90 どうしの方が届きやすい
  for (const label of ['HPの目標', '攻撃の目標', '防御の目標']) {
    const node = input(view, label);
    node.value = '90';
    node.dispatch('input');
  }
  assert.equal(input(view, '攻撃の目標'), attack);
  assert.deepEqual(cards(view).map(talentsOf), ['HP 90 / 攻 90 / 防 90 × HP 90 / 攻 90 / 防 90', 'HP 100 / 攻 0 / 防 100 × HP 90 / 攻 90 / 防 90']);
  assert.match(cards(view)[0].textContent, /1 個のタマゴで 30.8%/);
  // ケーキを変えると、結果だけ計算し直す（+1〜5 で 90 からでも目標の 90 以上は変わらず、乱数の分が上がる）
  const cake = view.element.querySelectorAll('select').find((node) => [...node.children].some((option) => option.value === 'talent'));
  cake.value = 'talent';
  cake.dispatch('change');
  assert.match(cards(view)[0].textContent, /1 個のタマゴで 31.8%/);
  assert.equal(input(view, '攻撃の目標'), attack);
  view.destroy();
  // 作り直しても、入力した条件のまま
  const again = idealView(context(owned, [], states), parseHash('#/ideal?to=SheepBall'));
  assert.equal(input(again, '攻撃の目標').value, '90');
  assert.equal(again.element.querySelectorAll('select').find((node) => [...node.children].some((option) => option.value === 'talent')).value, 'talent');
});

test('理想個体画面: 登録済みの異種の配合の親も出し、別の子も登録されている組は注記する', (t) => {
  install(t);
  const owned = fakeOwned([
    palworldPal('pm', 'PinkCat', 'Male', []),
    palworldPal('cf', 'ChickenPal', 'Female', []),
    palworldPal('sm', 'SheepBall', 'Male', [], { hp: 50, shot: 50, defense: 50 }),
    palworldPal('sf', 'SheepBall', 'Female', [], { hp: 50, shot: 50, defense: 50 }),
  ]);
  const records = [
    { id: 'r0', parent1Id: 'SheepBall', parent2Id: 'SheepBall', childId: 'SheepBall', parent1Gender: 'M', parent2Gender: 'F' },
    { id: 'r1', parent1Id: 'PinkCat', parent2Id: 'ChickenPal', childId: 'SheepBall', parent1Gender: '', parent2Gender: '' },
    { id: 'r2', parent1Id: 'PinkCat', parent2Id: 'ChickenPal', childId: 'Carbunclo', parent1Gender: '', parent2Gender: '' },
  ];
  const view = idealView(context(owned, records), parseHash('#/ideal?to=SheepBall'));
  const [card, same] = cards(view);
  assert.match(card.textContent, /登録済みの配合 ツッパニャン♂ × タマコッコ♀/);
  assert.match(card.querySelector('.ideal-warning').textContent, /別の子も登録されています/);
  // 同じ種族どうしは、自動登録で性別が記録されていても「性別条件は未検証」を出さない（0% の組なので後ろ）
  assert.match(same.textContent, /同じ種族どうし/);
  assert.equal(same.querySelector('.ideal-warning'), null);
  // 同じ種族どうしのレコードは数えない
  assert.match(view.element.querySelector('.result-note').textContent, /同じ種族どうしと登録済みの配合 1 件/);
});

test('理想個体画面: 所持パル・目標がないときと、欲しいパッシブがそろわないときの案内', (t) => {
  install(t);
  const none = idealView(context(fakeOwned(null)), parseHash('#/ideal?to=SheepBall'));
  assert.match(none.element.textContent, /所持パルのデータがありません/);
  const noTarget = idealView(context(fakeOwned()), parseHash('#/ideal'));
  assert.match(noTarget.element.textContent, /目標のパルを選んでください/);
  // 候補のだれも持たないパッシブは、そのパッシブを運ぶ経路へ案内する
  const missing = idealView(context(fakeOwned()), parseHash('#/ideal?to=SheepBall&p=Legend'));
  assert.match(missing.element.textContent, /伝説 を持つ個体が候補にいません/);
  const action = missing.element.querySelectorAll('a').find((node) => /伝説を運ぶ経路/.test(node.textContent));
  assert.equal(action.href, '#/route?to=SheepBall&p=Legend');
  // 持っている個体はいるが、1 組の ♂×♀ にはそろわない
  const spread = idealView(context(fakeOwned([
    palworldPal('m1', 'SheepBall', 'Male', ['CraftSpeed_up2']),
    palworldPal('m2', 'SheepBall', 'Male', ['Rare']),
    palworldPal('f1', 'SheepBall', 'Female', []),
  ])), parseHash('#/ideal?to=SheepBall&p=CraftSpeed_up2,Rare'));
  assert.match(spread.element.textContent, /欲しいパッシブが 1 組の親にそろいません/);
});

test('理想個体画面: 所持パルが読み込まれたら作り直し、パッシブを選ぶと URL を変える', (t) => {
  install(t);
  const owned = fakeOwned(null);
  owned.state.ready = false;
  const ctx = context(owned);
  const view = idealView(ctx, parseHash('#/ideal?to=SheepBall'));
  assert.match(view.element.textContent, /読み込み中/);
  Object.assign(owned.state, { ready: true, owned: fakeOwned().state.owned });
  owned.emit();
  assert.equal(cards(view).length, 3);
  // 欲しいパッシブを選んでいなければ、余計なパッシブは確率に関係しないので注記しない
  assert.doesNotMatch(view.element.textContent, /余計なパッシブ/);
  const add = view.element.querySelector('.passive-add');
  add.value = 'Rare';
  add.dispatch('change');
  assert.deepEqual(ctx.navigations, ['#/ideal?to=SheepBall&p=Rare']);
});

test('理想個体: URL とタブの往復、確率とタマゴの数の表示', () => {
  assert.equal(parseHash('#/ideal?to=SheepBall').view, 'ideal');
  assert.equal(buildHash('ideal', { to: 'SheepBall', p: 'Rare' }), '#/ideal?to=SheepBall&p=Rare');
  assert.equal(percent(1), '100%');
  assert.equal(percent(0.6), '60%');
  assert.equal(percent(0.9996), '99.9%');
  assert.equal(percent(0.28218), '28.2%');
  assert.equal(percent(0.017598), '1.76%');
  assert.equal(percent(0.0044004), '0.44%');
  assert.equal(percent(0.000353), '0.035%');
  assert.equal(percent(1e-7), '0.0001% 未満');
  assert.equal(percent(0), '0%');
  assert.equal(eggsText(0), 'この組では届きません');
  assert.equal(eggsText(0.99), 'ほぼ毎回');
  assert.equal(eggsText(0.7), '平均 約 1.4 個に 1 個');
  assert.equal(eggsText(0.168), '平均 約 6 個に 1 個');
  assert.equal(eggsText(0.0044004), '平均 約 227 個に 1 個');
  assert.equal(eggsText(1e-7), '平均 100 万個以上に 1 個');
});

test('理想個体画面: パッシブの所持数はグローバルボックスを数えず（タマゴは数える）、切り替えも出さない', (t) => {
  install(t);
  const view = idealView(context(fakeOwned([
    ...basePals,
    palworldPal('g1', 'SheepBall', 'Female', ['Legend'], full, { kind: 'global', playerUid: '' }),
  ])), parseHash('#/ideal?to=SheepBall'));
  const options = view.element.querySelector('.passive-add').querySelectorAll('option').map((node) => node.textContent);
  // 職人気質は m1・u1・タマゴの e1、希少は f1・f2・u1・e1。伝説はグローバルボックスだけなので所持数なし
  assert.ok(options.includes('職人気質（3）'), options.slice(0, 5).join(','));
  assert.ok(options.includes('希少（4）'));
  assert.ok(!options.some((text) => /^伝説（/.test(text)));
  assert.equal(view.element.querySelectorAll('input').filter((node) => node.type === 'checkbox').length, 0);
  assert.doesNotMatch(view.element.textContent, /グローバルボックスの個体も使う/);
});

test('理想個体画面: 自動登録の配合は、性別を入れ替えた向きも注記つきで出す', (t) => {
  install(t);
  const owned = fakeOwned([palworldPal('pm', 'PinkCat', 'Male', []), palworldPal('cf', 'ChickenPal', 'Female', [])]);
  // 牧場では ツッパニャン♀ × タマコッコ♂ で産まれた記録
  const records = [{ id: 'r1', parent1Id: 'PinkCat', parent2Id: 'ChickenPal', childId: 'SheepBall', parent1Gender: 'F', parent2Gender: 'M' }];
  const view = idealView(context(owned, records), parseHash('#/ideal?to=SheepBall'));
  const [card] = cards(view);
  assert.match(card.textContent, /登録済みの配合 ツッパニャン♂ × タマコッコ♀/);
  assert.match(card.querySelector('.ideal-warning').textContent, /性別を入れ替えた向きです/);
});

test('理想個体画面: 「世代を重ねて最短の順」では、平均のタマゴ数で並べ、パッシブを全部持つ ♂・♀ の数を出す', (t) => {
  install(t);
  const owned = fakeOwned([
    palworldPal('m1', 'SheepBall', 'Male', ['CraftSpeed_up2', 'Rare'], { hp: 90, shot: 90, defense: 90 }),
    palworldPal('m2', 'SheepBall', 'Male', ['CraftSpeed_up2'], { hp: 100, shot: 100, defense: 100 }),
    palworldPal('f1', 'SheepBall', 'Female', ['CraftSpeed_up2', 'Rare'], { hp: 90, shot: 90, defense: 90 }),
    palworldPal('f2', 'SheepBall', 'Female', ['CraftSpeed_up2', 'Rare'], { hp: 100, shot: 0, defense: 100 }),
  ]);
  const states = new Map();
  const view = idealView(context(owned, [], states), parseHash('#/ideal?to=SheepBall&p=CraftSpeed_up2,Rare'));
  const order = view.element.querySelectorAll('select').find((node) => [...node.children].some((option) => option.value === 'generations'));
  order.value = 'generations';
  order.dispatch('change');
  const list = cards(view);
  assert.equal(list.length, 2);
  // 1 回の成功率が 0% の組も、子を入れ替えていけば届くので平均を出す
  for (const card of list) assert.match(card.textContent, /世代を重ねて 平均 約 [\d,.]+ 個/);
  assert.match(list[0].textContent, /この 2 体のままなら 約/);
  assert.match(list[1].textContent, /この 2 体のままでは届きません/);
  assert.doesNotMatch(list[1].textContent, /個体値の目標に届くステータスを持っていない/);
  assert.equal(view.element.querySelector('.result-note').textContent, '2 組 · 欲しいパッシブを全部持つ ♂ 1 体・♀ 2 体 · 同じ種族どうし · 20 秒ごとに確認');
  // キノコケーキは目安で並べ、離れているときは上限を「多くても」で添える
  const cake = view.element.querySelectorAll('select').find((node) => [...node.children].some((option) => option.value === 'talent'));
  cake.value = 'talent';
  cake.dispatch('change');
  assert.match(cards(view)[0].textContent, /キノコケーキは目安/);
  assert.ok(cards(view).some((card) => /（多くても約 [\d,.]+ 個）/.test(card.textContent)));
  view.destroy();
  // 並べ方もタブを戻ったときに残る
  const again = idealView(context(owned, [], states), parseHash('#/ideal?to=SheepBall&p=CraftSpeed_up2,Rare'));
  assert.equal(again.element.querySelectorAll('select').find((node) => [...node.children].some((option) => option.value === 'generations')).value, 'generations');
  again.destroy();
});

test('理想個体画面: 世代の並べ方で、パッシブを全部持つ ♂ か ♀ がいなければ理由を出す', (t) => {
  install(t);
  const owned = fakeOwned([
    palworldPal('m1', 'SheepBall', 'Male', ['CraftSpeed_up2', 'Rare']),
    palworldPal('f1', 'SheepBall', 'Female', ['Rare']),
  ]);
  const states = new Map([['ideal', { conditions: { order: 'generations', mode: 'include', targets: { hp: 100, shot: 100, defense: 100 }, cake: 'none' } }]]);
  const view = idealView(context(owned, [], states), parseHash('#/ideal?to=SheepBall&p=CraftSpeed_up2,Rare'));
  assert.match(view.element.textContent, /欲しいパッシブを全部持つモコロンは ♂ 1 体・♀ 0 体です/);
  view.destroy();
});

test('理想個体画面: 開いている間は 20 秒ごとに読み直し、閉じた後は読まない', async (t) => {
  install(t);
  let release;
  const owned = fakeOwned();
  let refreshes = 0;
  owned.autoRefresh = () => { refreshes++; return Promise.resolve('skipped'); };
  owned.load = () => new Promise((resolve) => { release = resolve; });
  const view = idealView(context(owned), parseHash('#/ideal?to=SheepBall'));
  t.mock.timers.tick(20 * 1000 + 500);
  t.mock.timers.tick(20 * 1000 + 500);
  assert.equal(refreshes, 2);
  // タブが裏にある間は読まない
  document.visibilityState = 'hidden';
  t.mock.timers.tick(20 * 1000 + 500);
  assert.equal(refreshes, 2);
  document.visibilityState = 'visible';
  t.mock.timers.tick(20 * 1000 + 500);
  assert.equal(refreshes, 3);
  view.destroy();
  t.mock.timers.tick(60 * 1000);
  // 閉じた後に最初の読み込みが終わっても、読み直さない
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(refreshes, 3);
});

test('理想個体画面: 開いて最初の読み込みが終わったら、一度読み直す', async (t) => {
  install(t);
  const owned = fakeOwned();
  let refreshes = 0;
  owned.autoRefresh = () => { refreshes++; return Promise.resolve('skipped'); };
  const view = idealView(context(owned), parseHash('#/ideal?to=SheepBall'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(refreshes, 1);
  view.destroy();
});

test('理想個体画面: 新しく産まれたタマゴや孵化を読み込んだら、並べ直して最新の個体を出す', (t) => {
  install(t);
  const list = [
    palworldPal('m1', 'SheepBall', 'Male', [], { hp: 100, shot: 100, defense: 100 }),
    palworldPal('f1', 'SheepBall', 'Female', [], { hp: 0, shot: 0, defense: 0 }),
  ];
  const owned = fakeOwned(list);
  const view = idealView(context(owned), parseHash('#/ideal?to=SheepBall'));
  assert.equal(cards(view).length, 1);
  // 配合牧場に、3 つとも 100 のメスのタマゴが産まれた
  const egg = palworldPal('e1', 'SheepBall', 'Female', [], { hp: 100, shot: 100, defense: 100 }, { kind: 'egg-ground', playerUid: P1 });
  owned.state.owned = fakeOwned([...list, egg]).state.owned;
  owned.emit();
  const [first] = cards(view);
  assert.match(first.textContent, /孵化前/);
  // 孵化すると、同じ個体がパルボックスのパルとして出る
  owned.state.owned = fakeOwned([...list, { ...egg, location: { kind: 'palbox', playerUid: P1, slotIndex: 0 } }]).state.owned;
  owned.emit();
  assert.doesNotMatch(cards(view)[0].textContent, /孵化前/);
  assert.match(cards(view)[0].textContent, /パルボックス 1 ページ・1 行 1 列/);
  view.destroy();
});

test('理想個体画面: 所持者で親の候補とパッシブの所持数を絞り、選んだ所持者がいなくなったら「すべて」に戻す', (t) => {
  install(t);
  const P2 = '4de16e79-0000-0000-0000-000000000000';
  const BASE = 'b6800a4a-4b60-f0bb-f425-53bf17b07603';
  const list = [
    palworldPal('a1', 'SheepBall', 'Male', ['Rare']),
    palworldPal('a2', 'SheepBall', 'Female', ['Rare']),
    palworldPal('b1', 'SheepBall', 'Female', ['Legend'], full, { kind: 'palbox', playerUid: P2 }),
    palworldPal('c1', 'SheepBall', 'Male', ['Noukin'], full, { kind: 'base', playerUid: '', baseId: BASE }),
  ];
  const snapshotOf = (pals) => ({
    version: 1, world: { name: 'テスト', hostName: 'Alice' }, bases: [{ id: BASE, number: 2, guildId: '', containerId: '', position: null }],
    players: [{ uid: P1, name: 'Alice', level: 50 }, { uid: P2, name: 'Bob', level: 40 }], pals, stats: {},
  });
  const owned = fakeOwned(list);
  owned.state.owned = normalizeOwned(snapshotOf(list), { pals, passives });
  const states = new Map();
  const view = idealView(context(owned, [], states), parseHash('#/ideal?to=SheepBall'));
  const holder = view.element.querySelectorAll('select').find((node) => [...node.children].some((option) => option.value === `player:${P1}`));
  assert.deepEqual([...holder.children].map((option) => option.textContent), ['すべて', 'Alice', 'Bob', '拠点 2']);
  // すべてなら ♂ 2 体 × ♀ 2 体
  assert.equal(cards(view).length, 4);
  holder.value = `player:${P1}`;
  holder.dispatch('change');
  assert.equal(cards(view).length, 1);
  const counts = () => view.element.querySelector('.passive-add').querySelectorAll('option').map((node) => node.textContent);
  assert.ok(counts().includes('希少（2）'));
  assert.ok(!counts().some((text) => /^伝説（|^脳筋（/.test(text)));
  holder.value = `base:${BASE}`;
  holder.dispatch('change');
  assert.equal(cards(view).length, 0);
  assert.match(view.element.textContent, /オスとメスの組を作れる個体がいません/);
  view.destroy();
  // 選んだ所持者は残る。読み込んだデータにいなくなったら「すべて」に戻す
  const without = list.filter((pal) => pal.instanceId !== 'c1');
  owned.state.owned = normalizeOwned({ ...snapshotOf(without), bases: [] }, { pals, passives });
  const again = idealView(context(owned, [], states), parseHash('#/ideal?to=SheepBall'));
  const select = again.element.querySelectorAll('select').find((node) => [...node.children].some((option) => option.value === `player:${P1}`));
  assert.equal(select.value, '');
  assert.equal(cards(again).length, 2);
  again.destroy();
});

// 理想個体の登録（この端末に保存）を画面につなぐ
function withIdeals(ctx, owned, storage = new Map()) {
  let ids = 0;
  const memory = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) };
  // 所持パルのテストデータのプレイヤーは Alice なので、Alice としてログインしている
  const loginStore = { state: { env: 'test', userId: 'Alice', passcode: '入力', renaming: false, users: ['Alice'] }, subscribe: () => () => {} };
  ctx.ideals = createIdealStore({ store: loginStore, owned, storage: memory, uuid: () => `goal-${++ids}` });
  ctx.replacements = [];
  ctx.replace = (hash) => ctx.replacements.push(hash);
  return ctx;
}
const byLabel = (view, label) => view.element.querySelectorAll('button').find((node) => node.textContent === label);

test('理想個体画面: 今の条件を名前を付けて登録し、一覧に完成の状態を出す', (t) => {
  install(t);
  const owned = fakeOwned([
    palworldPal('m1', 'SheepBall', 'Male', ['Rare'], full),
    palworldPal('f1', 'SheepBall', 'Female', ['Rare'], { hp: 90, shot: 90, defense: 90 }),
  ]);
  const ctx = withIdeals(context(owned), owned);
  const view = idealView(ctx, parseHash('#/ideal?to=SheepBall&p=Rare'));
  const name = view.element.querySelectorAll('input').find((node) => node.getAttribute('aria-label') === '登録する名前');
  assert.equal(name.placeholder, 'モコロン（希少）');
  name.value = '最強モコロン';
  byLabel(view, 'この条件を登録').dispatch('click');
  assert.deepEqual(ctx.ideals.list().map((goal) => [goal.name, goal.palId, goal.passives.join(','), goal.mode, goal.order]), [['最強モコロン', 'SheepBall', 'Rare', 'include', 'next']]);
  // 同じ条件はもう登録できない
  assert.equal(byLabel(view, '登録済み').disabled, true);
  const box = view.element.querySelector('.ideal-goals');
  assert.match(box.querySelector('summary').textContent, /登録した理想個体（1 件）/);
  // m1 は 3 つとも 100 で希少を持つので完成済み
  assert.match(box.querySelector('.ideal-goal').textContent, /最強モコロン.*完成済み: Alice · パルボックス/);
  // 条件を変えると、また登録できる
  const attack = view.element.querySelectorAll('input').find((node) => node.getAttribute('aria-label') === '攻撃の目標');
  attack.value = '90';
  attack.dispatch('input');
  assert.equal(byLabel(view, 'この条件を登録').disabled, false);
  view.destroy();
});

test('理想個体画面: 一覧や通知から開くと（g）、登録した条件をそのまま使い、URL から外す', (t) => {
  install(t);
  const owned = fakeOwned();
  const states = new Map();
  const ctx = withIdeals(context(owned, [], states), owned);
  ctx.ideals.add({ name: '攻撃型', palId: 'SheepBall', passives: ['Rare'], mode: 'only', targets: { hp: 0, shot: 100, defense: 90 }, cake: 'talent', order: 'generations' });
  const [goal] = ctx.ideals.list();
  const view = idealView(ctx, parseHash(`#/ideal?to=SheepBall&p=Rare&g=${goal.id}`));
  const value = (label) => view.element.querySelectorAll('input').find((node) => node.getAttribute('aria-label') === label).value;
  assert.deepEqual([value('HPの目標'), value('攻撃の目標'), value('防御の目標')], ['0', '100', '90']);
  const selectHaving = (key) => view.element.querySelectorAll('select').find((node) => [...node.children].some((option) => option.value === key));
  assert.deepEqual([selectHaving('only').value, selectHaving('talent').value, selectHaving('generations').value], ['only', 'talent', 'generations']);
  assert.deepEqual(ctx.replacements, ['#/ideal?to=SheepBall&p=Rare']);
  assert.equal(byLabel(view, '登録済み').disabled, true);
  // 一覧の「呼び出す」は g つきのリンク
  assert.equal(view.element.querySelector('.ideal-goal').querySelectorAll('a').find((node) => node.textContent === '呼び出す').href, `#/ideal?to=SheepBall&p=Rare&g=${goal.id}`);
  view.destroy();
});

test('理想個体画面: 登録を外すと一覧から消え、所持パルのデータがないときは「未確認」と出す', (t) => {
  install(t);
  const owned = fakeOwned(null);
  const ctx = withIdeals(context(owned), owned);
  ctx.ideals.add({ name: '目標', palId: 'SheepBall', passives: [], mode: 'include', targets: { hp: 100, shot: 100, defense: 100 }, cake: 'none', order: 'next' });
  const view = idealView(ctx, parseHash('#/ideal'));
  assert.match(view.element.querySelector('.ideal-goal').textContent, /未確認（所持パルのデータがありません）/);
  // 目標のパルを選ぶまでは登録できない
  assert.equal(byLabel(view, 'この条件を登録').disabled, true);
  const remove = view.element.querySelector('.ideal-goal').querySelectorAll('button').find((node) => node.getAttribute('aria-label') === '「目標」の登録を外す');
  remove.dispatch('click');
  assert.equal(ctx.ideals.list().length, 0);
  assert.match(view.element.querySelector('.ideal-goals').textContent, /登録した理想個体はまだありません/);
  view.destroy();
});

test('理想個体画面: g で開いた後にパッシブを変えても、遷移先の URL に g を残さない', (t) => {
  install(t);
  const owned = fakeOwned();
  const ctx = withIdeals(context(owned), owned);
  ctx.ideals.add({ name: '攻撃型', palId: 'SheepBall', passives: ['Rare'], mode: 'only', targets: { hp: 0, shot: 100, defense: 90 }, cake: 'talent', order: 'next' });
  const [goal] = ctx.ideals.list();
  const view = idealView(ctx, parseHash(`#/ideal?to=SheepBall&p=Rare&g=${goal.id}`));
  const add = view.element.querySelector('.passive-add');
  add.value = 'Legend';
  add.dispatch('change');
  assert.deepEqual(ctx.navigations, ['#/ideal?to=SheepBall&p=Rare%2CLegend']);
  view.destroy();
});
