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

const cards = (view) => view.element.querySelectorAll('.ideal-pair');
const pairOf = (card) => card.querySelectorAll('.owned-row').map((row) => row.getAttribute('aria-label')).join('×');
// 同じ種族の個体は名前で区別できないので、個体値の表示で見分ける
const talentsOf = (card) => card.querySelectorAll('.owned-talent').map((node) => node.textContent).join(' × ');
const input = (view, label) => view.element.querySelectorAll('input').find((node) => node.getAttribute('aria-label') === label);

test('理想個体画面: URL の目標とパッシブで、所持パルの ♂×♀ を確率の高い順に出す', (t) => {
  installDom(t);
  const owned = fakeOwned();
  const view = idealView(context(owned), parseHash('#/ideal?to=SheepBall&p=CraftSpeed_up2,Rare'));
  const list = cards(view);
  assert.equal(list.length, 2);
  // 余計なパッシブのない f1 が先。タマゴと性別不明は候補にしない
  assert.match(list[0].textContent, /1 個のタマゴで 16\.8%/);
  assert.match(list[0].textContent, /平均 約 6 個に 1 個 · パッシブ 60% × 個体値 28%/);
  assert.match(list[0].textContent, /同じ種族どうし/);
  assert.match(list[1].textContent, /余計なパッシブ: 脳筋（これがなければ、パッシブの確率は 40% → 60%）/);
  assert.equal(view.element.querySelector('.result-note').textContent, '2 組 · 候補 3 体 · 同じ種族どうし · 性別不明の 1 体は除外');
  assert.match(view.element.querySelector('.ideal-help').textContent, /計算のしくみ/);
  // 選んだパッシブは選択欄に出る
  assert.deepEqual(view.element.querySelectorAll('.passive-selector')[0].querySelectorAll('.passive-name').map((node) => node.textContent), ['職人気質', '希少']);
  assert.equal(owned.loads, 1);
  view.destroy();
  assert.equal(owned.listeners.size, 0);
});

test('理想個体画面: 個体値の目標とケーキを変えると結果だけ作り直し、条件はタブを戻っても残る', (t) => {
  installDom(t);
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
  installDom(t);
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
  installDom(t);
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
  installDom(t);
  const owned = fakeOwned(null);
  owned.state.ready = false;
  const ctx = context(owned);
  const view = idealView(ctx, parseHash('#/ideal?to=SheepBall'));
  assert.match(view.element.textContent, /読み込み中/);
  Object.assign(owned.state, { ready: true, owned: fakeOwned().state.owned });
  owned.emit();
  assert.equal(cards(view).length, 2);
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

test('理想個体画面: パッシブの所持数はタマゴとグローバルボックスを数えず、切り替えも出さない', (t) => {
  installDom(t);
  const view = idealView(context(fakeOwned([
    ...basePals,
    palworldPal('g1', 'SheepBall', 'Female', ['Legend'], full, { kind: 'global', playerUid: '' }),
  ])), parseHash('#/ideal?to=SheepBall'));
  const options = view.element.querySelector('.passive-add').querySelectorAll('option').map((node) => node.textContent);
  // 職人気質は m1・u1（タマゴの e1 は数えない）、希少は f1・f2・u1、伝説はグローバルボックスだけなので所持数なし
  assert.ok(options.includes('職人気質（2）'), options.slice(0, 5).join(','));
  assert.ok(options.includes('希少（3）'));
  assert.ok(!options.some((text) => /^伝説（/.test(text)));
  assert.equal(view.element.querySelectorAll('input').filter((node) => node.type === 'checkbox').length, 0);
  assert.doesNotMatch(view.element.textContent, /グローバルボックスの個体も使う/);
});

test('理想個体画面: 自動登録の配合は、性別を入れ替えた向きも注記つきで出す', (t) => {
  installDom(t);
  const owned = fakeOwned([palworldPal('pm', 'PinkCat', 'Male', []), palworldPal('cf', 'ChickenPal', 'Female', [])]);
  // 牧場では ツッパニャン♀ × タマコッコ♂ で産まれた記録
  const records = [{ id: 'r1', parent1Id: 'PinkCat', parent2Id: 'ChickenPal', childId: 'SheepBall', parent1Gender: 'F', parent2Gender: 'M' }];
  const view = idealView(context(owned, records), parseHash('#/ideal?to=SheepBall'));
  const [card] = cards(view);
  assert.match(card.textContent, /登録済みの配合 ツッパニャン♂ × タマコッコ♀/);
  assert.match(card.querySelector('.ideal-warning').textContent, /性別を入れ替えた向きです/);
});
