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
    // 入力の間引きと計算の区切りをなくし、条件を変えた直後の結果を同期で確かめる（区切った計算は専用のテストで確かめる）
    inputDelay: 0, sliceBudget: Infinity,
  };
}

// 画面は開いている間 20 秒ごとに読み直すので、タイマーはモックにする（開いたままの画面がテストを止めないように）
function install(t) {
  const dom = installDom(t);
  t.mock.timers.enable({ apis: ['setInterval'] });
  return dom;
}

const cards = (view) => view.element.querySelectorAll('.ideal-pair');
const pairOf = (card) => card.querySelectorAll('.owned-row').map((row) => row.getAttribute('aria-label')).join('×');
// 同じ種族の個体は名前で区別できないので、個体値の表示で見分ける
const talentsOf = (card) => card.querySelectorAll('.owned-talent').map((node) => node.textContent).join(' × ');
const input = (view, label) => view.element.querySelectorAll('input').find((node) => node.getAttribute('aria-label') === label);

test('理想個体画面: URL の目標とパッシブで、配合牧場に置く組を別々の個体で上から出す', (t) => {
  install(t);
  const owned = fakeOwned();
  const view = idealView(context(owned), parseHash('#/ideal?to=SheepBall&p=CraftSpeed_up2,Rare'));
  const list = cards(view);
  // ♂ は m1 だけなので、別々の個体で作れる組は 1 組（タマゴの e1 は孵化するまで牧場に置けないので、性別不明は性別が分からないので候補にしない）
  assert.equal(list.length, 1);
  assert.match(list[0].textContent, /完全体作成組/);
  assert.match(list[0].textContent, /1 個のタマゴで 16\.8%/);
  assert.doesNotMatch(list[0].textContent, /タマゴ ·|孵化/);
  // 両親合わせて欲しいパッシブがそろう同じ種族の組なので、子を入れ替えながら作るときの平均も出す
  assert.match(list[0].textContent, /世代を重ねて 平均 約 6 個この 2 体のままなら 約 6 個に 1 個/);
  assert.match(list[0].textContent, /同じ種族どうし/);
  assert.equal(view.element.querySelector('.result-note').textContent, '2 組のうち、別々の個体で作れる上位 1 組 · 候補 3 体 · 同じ種族どうし · 性別不明の 1 体は除外 · 20 秒ごとに確認');
  // 並べ方の切り替えはない
  assert.ok(!view.element.querySelectorAll('select').some((node) => [...node.children].some((option) => option.value === 'generations')));
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
  // 3 つとも 100 が目標なら、1 回では作れないが、子を入れ替えながら完全体を作れる。100 を 2 つ持つ m1 と組む方が完成に近い（♀ は 1 体なので 1 組）
  assert.deepEqual(cards(view).map(talentsOf), ['HP 100 / 攻 0 / 防 100 × HP 90 / 攻 90 / 防 90']);
  assert.match(cards(view)[0].textContent, /完全体作成組.*世代を重ねて 平均/);
  // 目標を 90 にすると、90 どうしなら 1 回で作れて、確率も高い
  for (const label of ['HPの目標', '攻撃の目標', '防御の目標']) {
    const node = input(view, label);
    node.value = '90';
    node.dispatch('input');
  }
  assert.equal(input(view, '攻撃の目標'), attack);
  assert.deepEqual(cards(view).map(talentsOf), ['HP 90 / 攻 90 / 防 90 × HP 90 / 攻 90 / 防 90']);
  assert.match(cards(view)[0].textContent, /完全体作成組/);
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
  // 別の子も登録されている組は、目標が産まれるとは限らないので後ろ
  const [same, card] = cards(view);
  assert.match(card.textContent, /登録済みの配合 ツッパニャン♂ × タマコッコ♀/);
  assert.match(card.querySelector('.ideal-warning').textContent, /別の子も登録されています/);
  // 同じ種族どうしは、自動登録で性別が記録されていても「性別条件は未検証」を出さない
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
  // 候補のだれも持たないパッシブは配合では作れないので、個体値厳選組だけを並べ、そのパッシブを運ぶ経路へも案内する
  const missing = idealView(context(fakeOwned()), parseHash('#/ideal?to=SheepBall&p=Legend'));
  assert.match(missing.element.querySelector('.ideal-missing-note').textContent, /伝説 を持つ個体が候補にいないため、配合では作れません。個体値厳選組を並べています/);
  assert.ok(cards(missing).length && cards(missing).every((card) => /個体値厳選組/.test(card.textContent)));
  const action = missing.element.querySelectorAll('a').find((node) => /伝説を運ぶ経路/.test(node.textContent));
  assert.equal(action.href, '#/route?to=SheepBall&p=Legend');
  // 組が 1 つもないときは「個体値厳選組を並べています」とは言わない
  const nothing = idealView(context(fakeOwned([])), parseHash('#/ideal?to=SheepBall&p=Legend'));
  assert.match(nothing.element.querySelector('.ideal-missing-note').textContent, /配合では作れません。足りないパッシブは別に手に入れてください/);
  // 足りないパッシブがなければ案内は出さない
  assert.equal(idealView(context(fakeOwned()), parseHash('#/ideal?to=SheepBall&p=Rare')).element.querySelector('.ideal-missing-note').textContent, '');
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
  assert.equal(cards(view).length, 1);
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

test('理想個体画面: パッシブの所持数はグローバルボックスとタマゴを数えず、切り替えも出さない', (t) => {
  install(t);
  const view = idealView(context(fakeOwned([
    ...basePals,
    palworldPal('g1', 'SheepBall', 'Female', ['Legend'], full, { kind: 'global', playerUid: '' }),
  ])), parseHash('#/ideal?to=SheepBall'));
  const options = view.element.querySelector('.passive-add').querySelectorAll('option').map((node) => node.textContent);
  // 職人気質は m1・u1、希少は f1・f2・u1（タマゴの e1 は数えない）。伝説はグローバルボックスだけなので所持数なし
  assert.ok(options.includes('職人気質（2）'), options.slice(0, 5).join(','));
  assert.ok(options.includes('希少（3）'));
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

test('理想個体画面: 完全体作成組・パッシブ厳選組・個体値厳選組の順に、目的の札と目的ごとの数字で別々の個体を出す', (t) => {
  install(t);
  // 同じ種族で両親合わせて欲しいパッシブがそろう組は完全体作成組になるので、パッシブ厳選組は異なる種族の組（1 回では作れない）で確かめる
  const owned = fakeOwned([
    palworldPal('m1', 'SheepBall', 'Male', ['CraftSpeed_up2', 'Rare'], { hp: 100, shot: 100, defense: 100 }),
    palworldPal('f1', 'SheepBall', 'Female', ['CraftSpeed_up2', 'Rare'], { hp: 100, shot: 100, defense: 100 }),
    palworldPal('m2', 'PinkCat', 'Male', ['CraftSpeed_up2'], { hp: 50, shot: 50, defense: 50 }),
    palworldPal('f2', 'ChickenPal', 'Female', ['Rare'], { hp: 40, shot: 40, defense: 40 }),
    palworldPal('m3', 'SheepBall', 'Male', [], { hp: 100, shot: 100, defense: 0 }),
    palworldPal('f3', 'SheepBall', 'Female', [], { hp: 0, shot: 0, defense: 100 }),
  ]);
  const records = [{ id: 'r1', parent1Id: 'PinkCat', parent2Id: 'ChickenPal', childId: 'SheepBall', parent1Gender: '', parent2Gender: '' }];
  const view = idealView(context(owned, records), parseHash('#/ideal?to=SheepBall&p=CraftSpeed_up2,Rare'));
  const list = cards(view);
  assert.deepEqual(list.map((card) => card.querySelector('.ideal-tier').textContent), ['完全体作成組', 'パッシブ厳選組', '個体値厳選組']);
  // 完全体作成組: 子を入れ替えながら完全体が産まれるまでの平均
  assert.match(list[0].textContent, /世代を重ねて 平均 約 [\d,.]+ 個/);
  // パッシブ厳選組: 欲しいパッシブが全部そろう確率（個体値は見ない）
  assert.match(list[1].textContent, /欲しいパッシブが全部そろう確率 60%.*個体値は見ていません/);
  // 個体値厳選組: 個体値がそろうまでの平均（パッシブは見ない）
  assert.match(list[2].textContent, /個体値がそろうまで 平均 約 [\d,.]+ 個.*パッシブは見ていません/);
  // キノコケーキでは、世代の組は目安で並べ、離れているときは上限を「多くても」で添える
  const cake = view.element.querySelectorAll('select').find((node) => [...node.children].some((option) => option.value === 'talent'));
  cake.value = 'talent';
  cake.dispatch('change');
  assert.match(cards(view)[0].textContent, /キノコケーキは目安/);
  view.destroy();
});
test('理想個体画面: 欲しいパッシブ以外のパッシブが確率を下げているときは注記する', (t) => {
  install(t);
  const view = idealView(context(fakeOwned([
    palworldPal('m1', 'SheepBall', 'Male', ['CraftSpeed_up2']),
    palworldPal('f2', 'SheepBall', 'Female', ['Rare', 'Noukin']),
  ])), parseHash('#/ideal?to=SheepBall&p=CraftSpeed_up2,Rare'));
  assert.match(cards(view)[0].textContent, /余計なパッシブ: 脳筋（これがなければ、パッシブの確率は 40% → 60%）/);
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

test('理想個体画面: 産まれたタマゴは候補にせず、孵化を読み込んだら並べ直して最新の個体を出す', (t) => {
  install(t);
  const zero = { hp: 0, shot: 0, defense: 0 };
  const list = [
    palworldPal('m1', 'SheepBall', 'Male', [], { hp: 100, shot: 100, defense: 100 }),
    palworldPal('f1', 'SheepBall', 'Female', [], zero),
  ];
  const owned = fakeOwned(list);
  const view = idealView(context(owned), parseHash('#/ideal?to=SheepBall'));
  assert.equal(talentsOf(cards(view)[0]), 'HP 100 / 攻 100 / 防 100 × HP 0 / 攻 0 / 防 0');
  // 配合牧場に、3 つとも 100 のメスのタマゴが産まれた。孵化するまで牧場に置けないので、候補にしない
  const egg = palworldPal('e1', 'SheepBall', 'Female', [], { hp: 100, shot: 100, defense: 100 }, { kind: 'egg-ground', playerUid: P1 });
  owned.state.owned = fakeOwned([...list, egg]).state.owned;
  owned.emit();
  assert.deepEqual(cards(view).map(talentsOf), ['HP 100 / 攻 100 / 防 100 × HP 0 / 攻 0 / 防 0']);
  // 孵化すると、同じ個体がパルボックスのパルとして、3 つとも 100 の ♂ との組で出る
  owned.state.owned = fakeOwned([...list, { ...egg, location: { kind: 'palbox', playerUid: P1, slotIndex: 0 } }]).state.owned;
  owned.emit();
  assert.equal(talentsOf(cards(view)[0]), 'HP 100 / 攻 100 / 防 100 × HP 100 / 攻 100 / 防 100');
  assert.match(cards(view)[0].textContent, /パルボックス 1 ページ・1 行 1 列/);
  view.destroy();
});
test('理想個体画面: 所持者（すべて／自分の個体／各プレイヤー）で親の候補とパッシブの所持数を絞り、選んだプレイヤーがいなくなったら「すべて」に戻す', (t) => {
  install(t);
  const P2 = 'abcd1234-0000-0000-0000-000000000000';
  const BASE = 'b6800a4a-4b60-f0bb-f425-53bf17b07603';
  const list = [
    palworldPal('a1', 'SheepBall', 'Male', ['Rare']),
    palworldPal('a2', 'SheepBall', 'Female', ['Rare']),
    palworldPal('b1', 'SheepBall', 'Female', ['Legend'], full, { kind: 'palbox', playerUid: P2 }),
    // Bob が拠点に預けたパル（拠点のパルは、預けた人の個体として扱う）
    { ...palworldPal('c1', 'SheepBall', 'Male', ['Noukin'], full, { kind: 'base', playerUid: '', baseId: BASE }), lastOwnerUid: P2 },
  ];
  const snapshotOf = (pals, players) => ({
    version: 1, world: { name: 'テスト', hostName: 'Alice' }, bases: [{ id: BASE, number: 2, guildId: '', containerId: '', position: null }],
    players, pals, stats: {},
  });
  const both = [{ uid: P1, name: 'Alice', level: 50 }, { uid: P2, name: 'Bob', level: 40 }];
  const owned = fakeOwned(list);
  owned.state.owned = normalizeOwned(snapshotOf(list, both), { pals, passives });
  const states = new Map();
  // Alice としてログインしている（自分の個体 = Alice の個体）
  const ctx = withIdeals(context(owned, [], states), owned);
  const view = idealView(ctx, parseHash('#/ideal?to=SheepBall'));
  const holder = view.element.querySelectorAll('select').find((node) => [...node.children].some((option) => option.value === `player:${P1}`));
  // 拠点は選択肢に出さない
  assert.deepEqual([...holder.children].map((option) => option.textContent), ['すべて', '自分の個体', 'Alice', 'Bob']);
  // すべてなら ♂ 2 体・♀ 2 体で、別々の個体の組は 2 組
  assert.equal(cards(view).length, 2);
  const counts = () => view.element.querySelector('.passive-add').querySelectorAll('option').map((node) => node.textContent);
  for (const value of [`player:${P1}`, 'mine']) {
    holder.value = value;
    holder.dispatch('change');
    assert.deepEqual(cards(view).map((card) => card.querySelectorAll('.owned-row').map((row) => row.querySelector('.owned-where').textContent).join(' × ')),
      ['Aliceパルボックス × Aliceパルボックス']);
    assert.ok(counts().includes('希少（2）'));
    assert.ok(!counts().some((text) => /^伝説（|^脳筋（/.test(text)));
  }
  assert.match(view.element.querySelector('.result-note').textContent, /所持者: 自分の個体/);
  // Bob の個体は、Bob のパルボックスと Bob が預けた拠点のパル
  holder.value = `player:${P2}`;
  holder.dispatch('change');
  assert.equal(cards(view).length, 1);
  assert.match(cards(view)[0].textContent, /拠点 2/);
  view.destroy();
  // 選んだプレイヤーがデータにいなくなったら「すべて」に戻す
  const without = list.filter((pal) => !['b1', 'c1'].includes(pal.instanceId));
  owned.state.owned = normalizeOwned(snapshotOf(without, both.slice(0, 1)), { pals, passives });
  const again = idealView(withIdeals(context(owned, [], states), owned), parseHash('#/ideal?to=SheepBall'));
  const select = again.element.querySelectorAll('select').find((node) => [...node.children].some((option) => option.value === `player:${P1}`));
  assert.equal(select.value, '');
  assert.equal(cards(again).length, 1);
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
  attack.value = '100';
  attack.dispatch('input');
  assert.equal(byLabel(view, '登録済み').disabled, true);
  // アルファの条件はない
  assert.ok(!view.element.querySelectorAll('select').some((node) => [...node.children].some((option) => option.value === 'alpha')));
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
  assert.deepEqual([selectHaving('only').value, selectHaving('talent').value], ['only', 'talent']);
  assert.deepEqual(ctx.replacements, ['#/ideal?to=SheepBall&p=Rare']);
  assert.equal(byLabel(view, '登録済み').disabled, true);
  // 一覧の「呼び出す」は g つきのリンク
  assert.equal(view.element.querySelector('.ideal-goal').querySelectorAll('a').find((node) => node.textContent === '呼び出す').href, `#/ideal?to=SheepBall&p=Rare&g=${goal.id}`);
  view.destroy();
});

test('理想個体画面: 同じ画面のまま URL が変わると（applyRoute）、登録する名前はパッシブの変更では残し、目標が変わったら消す', (t) => {
  install(t);
  const owned = fakeOwned();
  const ctx = withIdeals(context(owned), owned);
  const view = idealView(ctx, parseHash('#/ideal?to=SheepBall'));
  const name = input(view, '登録する名前');
  const trigger = view.element.querySelector('.picker-trigger');
  const goals = view.element.querySelector('.ideal-goals');
  goals.open = true;
  name.value = '最強モコロン';
  view.applyRoute(parseHash('#/ideal?to=SheepBall&p=Rare'), { reason: 'update' });
  assert.equal(input(view, '登録する名前'), name);
  assert.equal(name.value, '最強モコロン');
  assert.equal(name.placeholder, 'モコロン（希少）');
  assert.equal(view.element.querySelector('.picker-trigger'), trigger);
  assert.equal(view.element.querySelector('.ideal-goals'), goals);
  assert.equal(goals.open, true);
  assert.deepEqual(view.element.querySelector('.passive-selector').querySelectorAll('.passive-name').map((node) => node.textContent), ['希少']);
  // 同じ route でもう一度呼んでも変わらない
  view.applyRoute(parseHash('#/ideal?to=SheepBall&p=Rare'), { reason: 'history' });
  assert.equal(name.value, '最強モコロン');
  view.applyRoute(parseHash('#/ideal?to=PinkCat&p=Rare'), { reason: 'update' });
  assert.equal(name.value, '');
  assert.equal(trigger.getAttribute('aria-label'), '目標: No.2 ツッパニャン');
  assert.equal(name.placeholder, 'ツッパニャン（希少）');
  view.destroy();
});

test('理想個体画面: 同じ画面のまま g つきの URL が来ると、登録した条件を入力欄にも入れ、URL から g を外す', (t) => {
  install(t);
  const owned = fakeOwned();
  const ctx = withIdeals(context(owned), owned);
  ctx.ideals.add({ name: '攻撃型', palId: 'SheepBall', passives: ['Rare'], mode: 'only', targets: { hp: 0, shot: 100, defense: 90 }, cake: 'talent', order: 'next' });
  const [goal] = ctx.ideals.list();
  const view = idealView(ctx, parseHash('#/ideal?to=SheepBall'));
  assert.deepEqual(ctx.replacements, []);
  view.applyRoute(parseHash(`#/ideal?to=SheepBall&p=Rare&g=${goal.id}`), { reason: 'history' });
  assert.deepEqual(ctx.replacements, ['#/ideal?to=SheepBall&p=Rare']);
  const value = (label) => input(view, label).value;
  assert.deepEqual([value('HPの目標'), value('攻撃の目標'), value('防御の目標')], ['0', '100', '90']);
  const selectHaving = (key) => view.element.querySelectorAll('select').find((node) => [...node.children].some((option) => option.value === key));
  assert.deepEqual([selectHaving('only').value, selectHaving('talent').value], ['only', 'talent']);
  assert.equal(byLabel(view, '登録済み').disabled, true);
  // ここから作る遷移先の URL に g を残さない
  const add = view.element.querySelector('.passive-add');
  add.value = 'Legend';
  add.dispatch('change');
  assert.deepEqual(ctx.navigations, ['#/ideal?to=SheepBall&p=Rare%2CLegend']);
  view.destroy();
});

test('理想個体画面: 同じ画面のままパッシブを足す・外すと、作り直した選択欄の追加欄にフォーカスを移す', async (t) => {
  const { body } = install(t);
  const owned = fakeOwned();
  const ctx = context(owned);
  const updates = [];
  let view;
  ctx.update = (hash) => { updates.push(hash); view.applyRoute(parseHash(hash), { reason: 'update' }); };
  view = idealView(ctx, parseHash('#/ideal?to=SheepBall'));
  body.append(view.element);
  const add = view.element.querySelector('.passive-add');
  add.focus();
  add.value = 'Rare';
  await add.dispatch('change');
  assert.deepEqual(updates, ['#/ideal?to=SheepBall&p=Rare']);
  assert.deepEqual(ctx.navigations, []);
  assert.notEqual(view.element.querySelector('.passive-add'), add);
  assert.equal(document.activeElement, view.element.querySelector('.passive-add'));
  const remove = view.element.querySelector('.passive-remove');
  remove.focus();
  await remove.dispatch('click');
  assert.equal(updates.at(-1), '#/ideal?to=SheepBall');
  assert.equal(document.activeElement, view.element.querySelector('.passive-add'));
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

test('理想個体画面: パッシブの条件を満たす子が産まれないときと、自分のプレイヤーが分からないときは、理由を出す', (t) => {
  install(t);
  const owned = fakeOwned([
    palworldPal('m1', 'SheepBall', 'Male', ['Rare']),
    palworldPal('f1', 'SheepBall', 'Female', ['Rare']),
  ]);
  const view = idealView(context(owned), parseHash('#/ideal?to=SheepBall&p=Rare'));
  const selectHaving = (key) => view.element.querySelectorAll('select').find((node) => [...node.children].some((option) => option.value === key));
  const choose = (key) => { const node = selectHaving(key); node.value = key; node.dispatch('change'); };
  choose('only');
  choose('special');
  assert.equal(cards(view).length, 0);
  assert.match(view.element.querySelector('.ideal-results').textContent, /スペシャルケーキは空いた枠をランダムなパッシブで埋めるので/);
  view.destroy();
  // 欲しいパッシブなしで「欲しいものだけ」（パッシブなし）は、パッシブを持つ親からは産まれない
  const none = idealView(context(owned), parseHash('#/ideal?to=SheepBall'));
  const mode = none.element.querySelectorAll('select').find((node) => [...node.children].some((option) => option.value === 'only'));
  mode.value = 'only';
  mode.dispatch('change');
  assert.match(none.element.querySelector('.ideal-results').textContent, /パッシブを持つ親からは、パッシブのない子は産まれません/);
  none.destroy();
  // ログイン中の ID と同じ名前のプレイヤーがセーブにいない（登録者の対応もない）と、自分の個体では絞れない
  const ctx = withIdeals(context(owned), owned);
  ctx.ideals = createIdealStore({
    store: { state: { env: 'test', userId: 'Zed', passcode: '入力', renaming: false, users: ['Zed'] }, subscribe: () => () => {} },
    owned, storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  });
  const mine = idealView(ctx, parseHash('#/ideal?to=SheepBall&p=Rare'));
  const holder = mine.element.querySelectorAll('select').find((node) => [...node.children].some((option) => option.value === 'mine'));
  holder.value = 'mine';
  holder.dispatch('change');
  assert.equal(cards(mine).length, 0);
  assert.match(mine.element.querySelector('.ideal-results').textContent, /セーブのどのプレイヤーが自分か分かりません/);
  mine.destroy();
});

test('理想個体画面: 配合牧場の組をおすすめの上から同じ数の組と比べ、そのまま・交換推奨を出し、カードに配置中と出す', (t) => {
  install(t);
  const owned = fakeOwned([
    palworldPal('m1', 'SheepBall', 'Male', [], { hp: 100, shot: 100, defense: 100 }),
    palworldPal('f1', 'SheepBall', 'Female', [], { hp: 100, shot: 100, defense: 100 }),
    palworldPal('m2', 'SheepBall', 'Male', [], { hp: 100, shot: 100, defense: 90 }),
    palworldPal('f2', 'SheepBall', 'Female', [], { hp: 90, shot: 90, defense: 90 }),
    palworldPal('m3', 'SheepBall', 'Male', [], { hp: 0, shot: 0, defense: 0 }),
    palworldPal('f3', 'SheepBall', 'Female', [], { hp: 0, shot: 0, defense: 0 }),
    palworldPal('cm', 'PinkCat', 'Male', []),
    palworldPal('cf', 'PinkCat', 'Female', []),
  ]);
  // 牧場 2 か所にこの目標の組（m1×f1 はおすすめ 1 番、m3×f2 はおすすめにない）。PinkCat の牧場は対象外
  owned.state.owned.farms = [
    { id: 'A', baseId: '', parents: ['m1', 'f1'] },
    { id: 'B', baseId: '', parents: ['m3', 'f2'] },
    { id: 'C', baseId: '', parents: ['cm', 'cf'] },
  ];
  const view = idealView(context(owned), parseHash('#/ideal?to=SheepBall'));
  const box = view.element.querySelector('.ideal-farms');
  assert.match(box.querySelector('h3').textContent, /この目標の組を置いている 2 か所 · 交換推奨 1 か所/);
  const rows = box.querySelectorAll('.ideal-farm');
  assert.match(rows[0].textContent, /そのまま（おすすめ 1 番）/);
  // おすすめ 2 番（m2×f2）は f2 が入っている牧場に入れ、m3 と入れ替える（完成までの平均が減るので交換を勧める）
  assert.match(rows[1].textContent, /交換推奨 → おすすめ 2 番/);
  assert.match(rows[1].textContent, /外す: モコロン♂（HP 0・攻 0・防 0） \/ 入れる: モコロン♂（HP 100・攻 100・防 90）（Alice · パルボックス）/);
  assert.match(cards(view)[0].textContent, /拠点の牧場に配置中/);
  assert.doesNotMatch(cards(view)[1].textContent, /配置中/);
  view.destroy();
  // 牧場の情報がない（牧場を共有する前の）データなら出さず、「変更あり」も付けない
  owned.state.owned.farms = null;
  const plain = idealView(context(owned), parseHash('#/ideal?to=SheepBall'));
  assert.equal(plain.element.querySelector('.ideal-farms').textContent, '');
  assert.equal(plain.element.querySelectorAll('.ideal-changed').length, 0);
  // 所持パルのデータがなくなったら、前の判定を残さない
  owned.state.owned = { ...owned.state.owned, farms: [{ id: 'A', baseId: '', parents: ['m1', 'f1'] }] };
  owned.emit();
  assert.notEqual(plain.element.querySelector('.ideal-farms').textContent, '');
  owned.state.owned = null;
  owned.emit();
  assert.equal(plain.element.querySelector('.ideal-farms').textContent, '');
  plain.destroy();
});

test('理想個体画面: 両親合わせて欲しいパッシブがそろう組が早ければ、牧場の組からの交換を勧める（画像の 4 体）', (t) => {
  install(t);
  const wanted = ['Deffence_up3', 'MutationPal_Immortal', 'PAL_ALLAttack_up3', 'CoolTimeReduction_Up_1'];
  const owned = fakeOwned([
    palworldPal('A', 'KabukiMan', 'Male', wanted, { hp: 97, shot: 99, defense: 96 }),
    palworldPal('B', 'KabukiMan', 'Female', wanted, { hp: 97, shot: 99, defense: 96 }),
    palworldPal('C', 'KabukiMan', 'Male', ['MutationPal_Immortal', 'WorkSuitabilityAddRank_MonsterFarm_2', 'Deffence_up3', 'PAL_ALLAttack_up3'], { hp: 97, shot: 98, defense: 96 }),
    palworldPal('D', 'KabukiMan', 'Female', ['CoolTimeReduction_Up_1'], { hp: 100, shot: 14, defense: 96 }),
  ]);
  owned.state.owned.farms = [{ id: 'F4', baseId: '', parents: ['A', 'B'] }];
  const view = idealView(context(owned), parseHash(`#/ideal?to=KabukiMan&p=${wanted.join(',')}`));
  // 1 番は ♂A×♀D（♀D は冷静沈着だけだが、A と合わせて 4 つそろい、HP 100 がある）
  assert.equal(talentsOf(cards(view)[0]), 'HP 97 / 攻 99 / 防 96 × HP 100 / 攻 14 / 防 96');
  assert.match(cards(view)[0].textContent, /完全体作成組世代を重ねて 平均 約 3,592 個/);
  const row = view.element.querySelector('.ideal-farm');
  assert.match(row.textContent, /交換推奨 → おすすめ 1 番/);
  assert.match(row.textContent, /外す: ゴウカブキ♀（HP 97・攻 99・防 96） \/ 入れる: ゴウカブキ♀（HP 100・攻 14・防 96）（Alice · パルボックス）/);
  view.destroy();
});

test('理想個体画面: 完成までの平均が同じ組しかないときは、交換推奨も「変更あり」も出さない', (t) => {
  install(t);
  const list = [
    palworldPal('m1', 'SheepBall', 'Male', [], { hp: 100, shot: 100, defense: 100 }),
    palworldPal('f1', 'SheepBall', 'Female', [], { hp: 100, shot: 100, defense: 100 }),
    palworldPal('m2', 'SheepBall', 'Male', [], { hp: 90, shot: 90, defense: 90 }),
    palworldPal('f2', 'SheepBall', 'Female', [], { hp: 90, shot: 90, defense: 90 }),
    palworldPal('m3', 'SheepBall', 'Male', [], { hp: 0, shot: 0, defense: 0 }),
  ];
  // 牧場 B の m3(0,0,0)×f2(90,90,90) と、パルボックスの m2(90,90,90)×f2 は、どちらも 100 に届く親がいないので平均 約 487 個の同点
  const owned = fakeOwned(list);
  const farms = [{ id: 'A', baseId: '', parents: ['m1', 'f1'] }, { id: 'B', baseId: '', parents: ['m3', 'f2'] }];
  owned.state.owned.farms = farms;
  const view = idealView(context(owned, [], new Map()), parseHash('#/ideal?to=SheepBall'));
  const box = () => view.element.querySelector('.ideal-farms');
  assert.match(box().querySelector('h3').textContent, /交換推奨 0 か所/);
  const rows = () => box().querySelectorAll('.ideal-farm');
  assert.match(rows()[1].textContent, /そのまま（おすすめ 2 番）/);
  // 牧場の組が同点の中で先に並ぶ
  assert.match(cards(view)[1].textContent, /拠点の牧場に配置中/);
  // 個体値の期待値だけが高い同点の ♀（99,99,99。100 には届かない）を孵化させて受け取っても、入れ替えを勧めず「変更あり」も付けない
  owned.state.owned = fakeOwned([...list, palworldPal('f9', 'SheepBall', 'Female', [], { hp: 99, shot: 99, defense: 99 })]).state.owned;
  owned.state.owned.farms = farms;
  owned.emit();
  assert.match(box().querySelector('h3').textContent, /交換推奨 0 か所/);
  assert.match(rows()[1].textContent, /そのまま（おすすめ 2 番）/);
  assert.equal(view.element.querySelectorAll('.ideal-changed').length, 0);
  assert.doesNotMatch(box().textContent, /新しく入った組/);
  view.destroy();
});

test('理想個体画面: 入れ替えると 1 か所は早くなるが、牧場全体では遅くなるときは、交換を見送って「そのまま」と出す', (t) => {
  install(t);
  const owned = fakeOwned([
    palworldPal('m1', 'SheepBall', 'Male', [], { hp: 100, shot: 100, defense: 100 }),
    palworldPal('m2', 'SheepBall', 'Male', [], { hp: 100, shot: 100, defense: 0 }),
    palworldPal('f1', 'SheepBall', 'Female', [], { hp: 100, shot: 0, defense: 0 }),
    palworldPal('f2', 'SheepBall', 'Female', [], { hp: 100, shot: 0, defense: 100 }),
  ]);
  // A（m1×f1・平均 約 10 個）と B（m2×f2・約 14 個）。おすすめは m1×f2（約 7 個）と m2×f1（約 241 個）で、入れ替えると全体では遅い
  owned.state.owned.farms = [{ id: 'A', baseId: '', parents: ['m1', 'f1'] }, { id: 'B', baseId: '', parents: ['m2', 'f2'] }];
  const view = idealView(context(owned, [], new Map()), parseHash('#/ideal?to=SheepBall'));
  const box = view.element.querySelector('.ideal-farms');
  assert.match(box.querySelector('h3').textContent, /この目標の組を置いている 2 か所 · 交換推奨 0 か所/);
  for (const row of box.querySelectorAll('.ideal-farm')) {
    assert.match(row.textContent, /そのまま（入れ替えても全体の速さの目安が上がりません）/);
    assert.doesNotMatch(row.textContent, /外す|入れる/);
  }
  assert.equal(view.element.querySelectorAll('.ideal-changed').length, 0);
  view.destroy();
});

test('理想個体画面: 牧場の組か交換先の組に、同じ組み合わせで別の子も登録されているときは、速さで比べずにおすすめの順で判定し、登録の間違いの可能性を出す', (t) => {
  install(t);
  const owned = fakeOwned([
    palworldPal('pm', 'PinkCat', 'Male', []),
    palworldPal('cf', 'ChickenPal', 'Female', []),
    palworldPal('mx', 'SheepBall', 'Male', [], { hp: 100, shot: 100, defense: 0 }),
    palworldPal('fx', 'SheepBall', 'Female', [], { hp: 0, shot: 0, defense: 0 }),
  ]);
  const records = [
    { id: 'r1', parent1Id: 'PinkCat', parent2Id: 'ChickenPal', childId: 'SheepBall', parent1Gender: '', parent2Gender: '' },
    { id: 'r2', parent1Id: 'PinkCat', parent2Id: 'ChickenPal', childId: 'Carbunclo', parent1Gender: '', parent2Gender: '' },
  ];
  // 牧場のツッパニャン×タマコッコは、目標が産まれるなら平均 約 4 個で速いが、別の子も登録されているので、確実な 1 番の組への交換を勧める
  owned.state.owned.farms = [{ id: 'A', baseId: '', parents: ['pm', 'cf'] }];
  const view = idealView(context(owned, records, new Map()), parseHash('#/ideal?to=SheepBall'));
  const row = view.element.querySelector('.ideal-farm');
  assert.match(row.textContent, /交換推奨 → おすすめ 1 番/);
  assert.match(row.querySelector('.ideal-warning').textContent,
    /^⚠ 牧場の組は、同じ組み合わせで別の子も登録されています。どちらかの登録が間違っている可能性があるので、速さでは比べず、おすすめの順で判定しています。$/);
  assert.match(cards(view)[1].querySelector('.ideal-warning').textContent, /別の子も登録されています。どちらかの登録が間違っている可能性があります。/);
  view.destroy();
  // 別の子の登録がない組どうしなら、注記は出さない
  owned.state.owned.farms = [{ id: 'A', baseId: '', parents: ['mx', 'fx'] }];
  const plain = idealView(context(owned, records.slice(0, 1), new Map()), parseHash('#/ideal?to=SheepBall'));
  assert.equal(plain.element.querySelector('.ideal-farm').querySelector('.ideal-warning'), null);
  plain.destroy();
});

test('理想個体画面: 牧場の中身が最後に変わってから新しくおすすめに入った組に「変更あり」を付け、牧場を置き直すと消す', (t) => {
  install(t);
  const list = [
    palworldPal('m1', 'SheepBall', 'Male', [], { hp: 90, shot: 90, defense: 90 }),
    palworldPal('f1', 'SheepBall', 'Female', [], { hp: 90, shot: 90, defense: 90 }),
  ];
  const owned = fakeOwned(list);
  const farms = [{ id: 'A', baseId: '', parents: ['m1', 'f1'] }];
  owned.state.owned.farms = farms;
  const states = new Map();
  const view = idealView(context(owned, [], states), parseHash('#/ideal?to=SheepBall'));
  assert.equal(view.element.querySelectorAll('.ideal-changed').length, 0);
  // 3 つとも 100 の ♀ を孵化させて受け取った（牧場はそのまま）。おすすめの 1 番が変わり、牧場には交換推奨が出る
  const hatched = palworldPal('f9', 'SheepBall', 'Female', [], { hp: 100, shot: 100, defense: 100 });
  owned.state.owned = fakeOwned([...list, hatched]).state.owned;
  owned.state.owned.farms = farms;
  owned.emit();
  assert.match(cards(view)[0].textContent, /変更あり/);
  assert.match(talentsOf(cards(view)[0]), /HP 100 \/ 攻 100 \/ 防 100$/);
  assert.match(view.element.querySelector('.ideal-farms').textContent, /新しく入った組が 1 組/);
  assert.match(view.element.querySelector('.ideal-farm').textContent, /交換推奨 → おすすめ 1 番/);
  // 条件を変えると別の基準（変えた条件で初めて見るので印はない）。戻すと、もとの基準で印が戻る
  const cake = view.element.querySelectorAll('select').find((node) => [...node.children].some((option) => option.value === 'talent'));
  cake.value = 'talent';
  cake.dispatch('change');
  assert.equal(view.element.querySelectorAll('.ideal-changed').length, 0);
  cake.value = 'none';
  cake.dispatch('change');
  assert.match(cards(view)[0].textContent, /変更あり/);
  // タブを切り替えても、牧場の中身が変わるまで残る
  view.destroy();
  const again = idealView(context(owned, [], states), parseHash('#/ideal?to=SheepBall'));
  assert.match(cards(again)[0].textContent, /変更あり/);
  // 牧場に置き直したことがセーブから分かったら消える
  owned.state.owned = fakeOwned([...list, hatched]).state.owned;
  owned.state.owned.farms = [{ id: 'A', baseId: '', parents: ['m1', 'f9'] }];
  owned.emit();
  assert.equal(again.element.querySelectorAll('.ideal-changed').length, 0);
  assert.match(again.element.querySelector('.ideal-farm').textContent, /そのまま（おすすめ 1 番）/);
  again.destroy();
});

test('理想個体画面: 牧場に置かない組（上から牧場の数より下）や、この目標の組を置いた牧場がないときは「変更あり」を付けない', (t) => {
  install(t);
  const list = [
    palworldPal('m1', 'SheepBall', 'Male', [], { hp: 100, shot: 100, defense: 100 }),
    palworldPal('f1', 'SheepBall', 'Female', [], { hp: 100, shot: 100, defense: 100 }),
  ];
  // 50 の ♂ と ♀ を孵化させて受け取った。おすすめの 2 番に入るが、牧場は 1 か所で 1 番のまま
  const hatched = [
    palworldPal('m2', 'SheepBall', 'Male', [], { hp: 50, shot: 50, defense: 50 }),
    palworldPal('f2', 'SheepBall', 'Female', [], { hp: 50, shot: 50, defense: 50 }),
  ];
  const owned = fakeOwned(list);
  owned.state.owned.farms = [{ id: 'A', baseId: '', parents: ['m1', 'f1'] }];
  const view = idealView(context(owned, [], new Map()), parseHash('#/ideal?to=SheepBall'));
  owned.state.owned = fakeOwned([...list, ...hatched]).state.owned;
  owned.state.owned.farms = [{ id: 'A', baseId: '', parents: ['m1', 'f1'] }];
  owned.emit();
  assert.equal(cards(view).length, 2);
  assert.equal(view.element.querySelectorAll('.ideal-changed').length, 0);
  assert.doesNotMatch(view.element.querySelector('.ideal-farms').textContent, /新しく入った組/);
  assert.match(view.element.querySelector('.ideal-farm').textContent, /そのまま（おすすめ 1 番）/);
  view.destroy();
  // この目標の組を置いた牧場がないときは、新しい組がおすすめに入っても付けない
  const empty = fakeOwned(list);
  empty.state.owned.farms = [];
  const plain = idealView(context(empty, [], new Map()), parseHash('#/ideal?to=SheepBall'));
  empty.state.owned = fakeOwned([...list, ...hatched]).state.owned;
  empty.state.owned.farms = [];
  empty.emit();
  assert.equal(plain.element.querySelectorAll('.ideal-changed').length, 0);
  plain.destroy();
});

// ---------------------------------------------------------------------------
// stable-render: 同じなら計算も DOM も触らない・区切った計算・選択肢を作り直さない
// ---------------------------------------------------------------------------
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('理想個体画面: 同じデータ・同じ条件で描き直しても（20 秒ごとの確認など）、計算もカードも作り直さない。条件やデータが変われば作り直す', (t) => {
  install(t);
  const owned = fakeOwned();
  const view = idealView(context(owned), parseHash('#/ideal?to=SheepBall&p=CraftSpeed_up2,Rare'));
  const [card] = cards(view);
  const note = view.element.querySelector('.result-note').textContent;
  view.update();
  owned.emit();
  assert.equal(cards(view)[0], card);
  assert.equal(view.element.querySelector('.result-note').textContent, note);
  // 所持パルの中身が読み直された（新しいデータ）ときは計算し直す
  owned.state.owned = normalizeOwned(owned.state.data.snapshot, { pals, passives });
  owned.emit();
  assert.notEqual(cards(view)[0], card);
  const again = cards(view)[0];
  // 条件を変えたら作り直す
  const hp = input(view, 'HPの目標');
  hp.value = '90';
  hp.dispatch('input');
  assert.notEqual(cards(view)[0], again);
  view.destroy();
});

test('理想個体画面: 計算が 1 回の区切りで終わらないときは「計算中」にし（前の結果は残す）、終わったら描く。条件を変えると古い計算を捨てる', async (t) => {
  installDom(t);
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const owned = fakeOwned();
  // 区切りを 0ms にして、必ず区切る（新しい世代の表を作るように、ほかのテストと違う目標にする）
  const ctx = { ...context(owned), sliceBudget: 0 };
  const states = new Map([['ideal', { conditions: { holder: '', mode: 'include', targets: { hp: 97, shot: 96, defense: 95 }, cake: 'none' } }]]);
  ctx.viewState = (name) => { if (!states.has(name)) states.set(name, {}); return states.get(name); };
  const view = idealView(ctx, parseHash('#/ideal?to=SheepBall&p=CraftSpeed_up2,Rare'));
  const results = view.element.querySelector('.ideal-results');
  // まだ何も出していないので「計算中…」だけを出す
  assert.equal(results.getAttribute('aria-busy'), 'true');
  assert.ok(results.className.includes('is-computing'));
  assert.match(results.textContent, /計算中…/);
  assert.equal(cards(view).length, 0);
  t.mock.timers.runAll();
  await settle();
  assert.equal(results.getAttribute('aria-busy'), null);
  assert.ok(!results.className.includes('is-computing'));
  assert.equal(cards(view).length, 1);
  const [card] = cards(view);
  const note = view.element.querySelector('.result-note').textContent;
  // 条件を 2 回続けて変える。計算している間は前の結果（カード・要約）を残し、最後の条件の結果だけを描く
  const hp = input(view, 'HPの目標');
  hp.value = '94';
  hp.dispatch('input');
  assert.equal(results.getAttribute('aria-busy'), 'true');
  assert.equal(cards(view)[0], card);
  assert.equal(view.element.querySelector('.result-note').textContent, note);
  hp.value = '93';
  hp.dispatch('input');
  t.mock.timers.runAll();
  await settle();
  assert.equal(results.getAttribute('aria-busy'), null);
  // 同じ条件を同期で計算した画面と同じ結果
  const expected = idealView({ ...context(fakeOwned()), sliceBudget: Infinity, viewState: ctx.viewState }, parseHash('#/ideal?to=SheepBall&p=CraftSpeed_up2,Rare'));
  assert.equal(cards(view)[0].textContent, cards(expected)[0].textContent);
  assert.notEqual(cards(view)[0], card);
  expected.destroy();
  // 計算の途中で画面を閉じたら、それ以上描かない
  hp.value = '92';
  hp.dispatch('input');
  const shown = cards(view)[0];
  view.destroy();
  t.mock.timers.runAll();
  await settle();
  assert.equal(cards(view)[0], shown);
  assert.equal(results.getAttribute('aria-busy'), 'true');
});

test('理想個体画面: 所持者とパッシブの選択欄は、中身が同じなら作り直さず、変わってもフォーカス中は離れるまで待つ', async (t) => {
  install(t);
  const P2 = 'abcd1234-0000-0000-0000-000000000000';
  const owned = fakeOwned();
  const view = idealView(context(owned), parseHash('#/ideal?to=SheepBall&p=CraftSpeed_up2'));
  document.body.append(view.element);
  const holder = view.element.querySelectorAll('select').find((node) => [...node.children].some((option) => option.value === `player:${P1}`));
  const options = [...holder.children];
  const passiveAdd = view.element.querySelector('.passive-add');
  // 中身が同じデータの読み直し
  owned.state.owned = normalizeOwned(owned.state.data.snapshot, { pals, passives });
  owned.emit();
  assert.deepEqual([...holder.children], options);
  assert.equal(view.element.querySelector('.passive-add'), passiveAdd);
  // プレイヤーと所持数が変わった。所持者の欄を選んでいる途中は作り直さない
  const snapshot = { ...owned.state.data.snapshot, players: [...owned.state.data.snapshot.players, { uid: P2, name: 'Bob', level: 3 }],
    pals: [...owned.state.data.snapshot.pals, palworldPal('n1', 'SheepBall', 'Female', ['Noukin'], full, { kind: 'palbox', playerUid: P2 })] };
  holder.focus();
  owned.state.owned = normalizeOwned(snapshot, { pals, passives });
  owned.emit();
  assert.deepEqual([...holder.children], options);
  // パッシブの欄はフォーカスがないので、所持数が変わればすぐ作り直す
  assert.notEqual(view.element.querySelector('.passive-add'), passiveAdd);
  // 離れたら作り直す
  document.activeElement = document.body;
  await holder.dispatch('blur');
  await settle();
  assert.deepEqual([...holder.children].map((option) => option.textContent), ['すべて', 'Alice', 'Bob']);
  // パッシブの欄を選んでいる途中も待つ
  const add = view.element.querySelector('.passive-add');
  add.focus();
  owned.state.owned = normalizeOwned(owned.state.data.snapshot, { pals, passives });
  owned.emit();
  assert.equal(view.element.querySelector('.passive-add'), add);
  document.activeElement = document.body;
  await add.dispatch('blur');
  await settle();
  assert.notEqual(view.element.querySelector('.passive-add'), add);
  view.destroy();
});
