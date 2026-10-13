import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, installResizeObserver } from '../helpers/dom.js';
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
// パッシブの選択欄: 追加のボタンでポップオーバーを開き（開いていなければ）、候補を押す
const passiveAdd = (view) => view.element.querySelector('.passive-add');
async function pickPassive(view, id) {
  if (passiveAdd(view).getAttribute('aria-expanded') !== 'true') await passiveAdd(view).dispatch('click');
  const option = view.element.querySelector(`[data-value="${id}"]`);
  assert.ok(option, id);
  await option.dispatch('click');
}
// 条件のパネルの押しボタン（パッシブの条件・ケーキ）。label は radiogroup の名前
const radioGroup = (view, label) => view.element.querySelectorAll('[role="radiogroup"]').find((node) => node.getAttribute('aria-label') === label);
const chooseRadio = (view, label, value) => radioGroup(view, label).querySelector(`[data-value="${value}"]`).dispatch('click');
const chosen = (view, label) => radioGroup(view, label).querySelector('[aria-checked="true"]')?.getAttribute('data-value');
// 「☆ 目標として保存」のボタンと、保存の板の名前の欄（板は開いている間だけ画面にある）
const saveButton = (view) => view.element.querySelector('.ideal-save');
const nameInput = (view) => view.element.querySelectorAll('input').find((node) => node.getAttribute('aria-label') === '目標の名前');
// 保存の板を開いて保存する（name を渡せば名前を変える）
function saveAsGoal(view, name) {
  saveButton(view).dispatch('click');
  if (name !== undefined) nameInput(view).value = name;
  nameInput(view).dispatch('keydown', { key: 'Enter' });
}
// 見出しの「目標（N）」で目標のダイアログを開く
function openGoals(view) {
  view.element.querySelector('.ideal-goals-button').dispatch('click');
  return document.body.querySelectorAll('dialog').find((node) => node.className.split(' ').includes('ideal-goals-dialog') && node.open);
}
// 候補の所持数（「希少（3）」の形にそろえる。所持数のない候補は名前だけ）
async function passiveOptions(view) {
  if (passiveAdd(view).getAttribute('aria-expanded') !== 'true') await passiveAdd(view).dispatch('click');
  const texts = view.element.querySelectorAll('[role="option"]').map((node) => {
    const count = node.querySelector('.passive-option-count');
    return `${node.querySelector('.passive-name').textContent}${count ? `（${count.textContent.replace(' 体', '')}）` : ''}`;
  });
  await passiveAdd(view).dispatch('click');
  return texts;
}

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
  // 計算のしくみは結果の下に置かず、見出しの「?」からダイアログで開く
  assert.equal(view.element.querySelector('.ideal-help'), null);
  const help = view.element.querySelector('.view-heading').querySelectorAll('button').find((node) => node.getAttribute('aria-label') === '計算のしくみの説明');
  help.dispatch('click');
  const dialog = document.body.querySelectorAll('dialog').find((node) => node.className.split(' ').includes('ideal-help-dialog'));
  assert.equal(dialog.open, true);
  assert.equal(dialog.querySelector('h2').textContent, '計算のしくみ');
  assert.equal(dialog.querySelector('.ideal-help').children.length, 14);
  assert.match(dialog.textContent, /並び: 理想個体を作るのにおすすめの組を/);
  // 選んだパッシブは選択欄に出る
  assert.deepEqual(view.element.querySelectorAll('.passive-selector')[0].querySelectorAll('.passive-name').map((node) => node.textContent), ['職人気質', '希少']);
  // 選択欄は条件のパネル（.ideal-panel）の 1 段目に、目標と並べて置く
  assert.ok(view.element.querySelector('.ideal-panel-main').querySelector('.passive-selector'));
  assert.equal(owned.loads, 1);
  view.destroy();
  assert.equal(owned.listeners.size, 0);
  // 画面を閉じると、開いていたダイアログも閉じる
  assert.equal(dialog.open, false);
});

test('理想個体画面: 条件を sticky のパネルにまとめる（1 段目: 目標・欲しいパッシブ・保存、2 段目: 所持者・パッシブの条件・個体値・ケーキ・所持の状況）', (t) => {
  install(t);
  const owned = fakeOwned();
  const view = idealView(withIdeals(context(owned), owned), parseHash('#/ideal?to=SheepBall&p=Rare'));
  const children = view.element.children;
  // 並び: 見出し → パネル → 要約 → 足りないパッシブ → 牧場 → 結果（登録の行・登録した一覧の折りたたみはない）
  assert.deepEqual(children.map((node) => node.className), ['view-heading', 'ideal-panel', 'result-note ideal-note', 'ideal-missing-note', 'ideal-farms', 'ideal-results']);
  assert.equal(view.element.querySelector('.ideal-goals'), null);
  assert.equal(view.element.querySelector('.ideal-register'), null);
  const panel = view.element.querySelector('.ideal-panel');
  assert.equal(panel.tagName, 'section');
  assert.equal(panel.getAttribute('aria-label'), '理想個体の条件');
  const [main, sub] = panel.children;
  assert.deepEqual(main.children.map((node) => node.className.split(' ')[0]), ['picker', 'field', 'ideal-save-slot']);
  assert.ok(main.children[1].className.includes('passive-selector'));
  // 2 段目は見出しを入力の左に置いた欄と、右端の所持の状況
  assert.deepEqual(sub.children.map((node) => (node.tagName === 'a' ? node.textContent : node.children[0].textContent)), ['所持者', '条件', '個体値（以上）', 'ケーキ', '所持 ♂1 ♀2 · 全部持つ ♂0 ♀2']);
  assert.equal(sub.children[0].tagName, 'label');
  assert.equal(sub.children[0].querySelector('select').value, '');
  // パッシブの条件・ケーキは押しボタン（短いラベル、長い説明は title）
  assert.deepEqual(radioGroup(view, 'パッシブの条件').children.map((node) => [node.textContent, node.title]),
    [['全部持つ', '欲しいものを全部持つ（他も可）'], ['だけ', '欲しいものだけを持つ']]);
  assert.deepEqual(radioGroup(view, 'ケーキ').children.map((node) => [node.textContent, node.title]),
    [['なし', 'ケーキ・野菜ケーキ'], ['キノコ等', 'キノコケーキ・豪華野菜ケーキ（個体値 +1〜5）'], ['スペシャル', 'スペシャルケーキ（パッシブを 4 個まで継ぐ）']]);
  assert.deepEqual([chosen(view, 'パッシブの条件'), chosen(view, 'ケーキ')], ['include', 'none']);
  // パネルの高さは画面の section の --panel-h に書く（ResizeObserver の無いテストの DOM では 1 回だけ測る）
  assert.equal(view.element.style.getPropertyValue('--panel-h'), '52px');
  view.destroy();
});

test('理想個体画面: パネルの高さは ResizeObserver で追って --panel-h に書き、画面を閉じたら監視をやめる', (t) => {
  install(t);
  const { resize, observed } = installResizeObserver(t);
  const owned = fakeOwned();
  const view = idealView(context(owned), parseHash('#/ideal?to=SheepBall'));
  const panel = view.element.querySelector('.ideal-panel');
  assert.ok(observed(panel));
  resize(panel, 141.5);
  assert.equal(view.element.style.getPropertyValue('--panel-h'), '141.5px');
  // パッシブのチップが改行して 1 行増えた
  resize(panel, 179.5);
  assert.equal(view.element.style.getPropertyValue('--panel-h'), '179.5px');
  view.destroy();
  assert.equal(observed(panel), false);
});

test('理想個体画面: 所持の状況は目標と同じ種族の親の候補の ♂♀（所持者で絞った後）と、欲しいパッシブを全部持つ数。押すと所持パルをその種族とパッシブで開く', async (t) => {
  install(t);
  const owned = fakeOwned();
  const ctx = context(owned);
  let view;
  ctx.update = (hash) => view.applyRoute(parseHash(hash), { reason: 'update' });
  view = idealView(ctx, parseHash('#/ideal'));
  const holding = view.element.querySelector('.ideal-holding');
  // 目標がないときは「—」（場所は残す）で、押せない
  assert.equal(holding.tagName, 'a');
  assert.equal(holding.textContent, '—');
  assert.equal(holding.getAttribute('href'), null);
  assert.equal(holding.title, '親の候補の数（タマゴ・グローバルパルボックスを除き、所持者の絞り込みの後）');
  // モコロン: ♂ m1、♀ f1・f2（性別不明の u1・タマゴの e1 は数えない）
  view.applyRoute(parseHash('#/ideal?to=SheepBall'), { reason: 'update' });
  assert.equal(view.element.querySelector('.ideal-holding'), holding);
  assert.equal(holding.textContent, '所持 ♂1 ♀2');
  assert.equal(holding.getAttribute('href'), '#/owned?pal=SheepBall');
  await pickPassive(view, 'Rare');
  assert.equal(holding.textContent, '所持 ♂1 ♀2 · 全部持つ ♂0 ♀2');
  assert.equal(holding.getAttribute('href'), '#/owned?pal=SheepBall&p=Rare');
  view.destroy();
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
  chooseRadio(view, 'ケーキ', 'talent');
  assert.match(cards(view)[0].textContent, /1 個のタマゴで 31.8%/);
  assert.equal(input(view, '攻撃の目標'), attack);
  view.destroy();
  // 作り直しても、入力した条件のまま
  const again = idealView(context(owned, [], states), parseHash('#/ideal?to=SheepBall'));
  assert.equal(input(again, '攻撃の目標').value, '90');
  assert.equal(chosen(again, 'ケーキ'), 'talent');
});

test('理想個体画面: 個体値の目標はチェックつきの入力。チェックを外すと HP 0 と同じ結果になり、登録の要約は「HP —」。「すべて 100」で全部 100 に戻す', (t) => {
  install(t);
  const owned = fakeOwned([
    palworldPal('m1', 'SheepBall', 'Male', [], { hp: 10, shot: 100, defense: 100 }),
    palworldPal('f1', 'SheepBall', 'Female', [], { hp: 20, shot: 100, defense: 100 }),
  ]);
  const ctx = withIdeals(context(owned), owned);
  const view = idealView(ctx, parseHash('#/ideal?to=SheepBall'));
  // 見出しは 1 回だけ「個体値（以上）」（各欄の「以上」は CSS で隠す）
  assert.ok(view.element.querySelectorAll('.field-label').some((node) => node.textContent === '個体値（以上）'));
  const full100 = cards(view)[0].textContent;
  // HP のチェックを外す（数字は薄く残す）
  const hp = input(view, 'HPを条件にする');
  hp.checked = false;
  hp.dispatch('change');
  assert.equal(input(view, 'HPの目標').value, '100');
  const unchecked = cards(view)[0].textContent;
  assert.notEqual(unchecked, full100);
  // 目標を HP 0 にして開いた画面と同じ結果
  const zero = idealView(context(owned, [], new Map([['ideal', { conditions: { holder: '', mode: 'include', targets: { hp: 0, shot: 100, defense: 100 }, cake: 'none' } }]])),
    parseHash('#/ideal?to=SheepBall'));
  assert.equal(cards(zero)[0].textContent, unchecked);
  zero.destroy();
  // 目標として保存すると保存は 0（条件なし）のまま、保存のボタンの title と目標のダイアログの要約は「HP —」
  assert.match(saveButton(view).title, /^HP —・攻撃 100 以上・防御 100 以上/);
  saveAsGoal(view);
  assert.deepEqual(ctx.ideals.list()[0].targets, { hp: 0, shot: 100, defense: 100 });
  assert.match(openGoals(view).querySelector('.ideal-goal').textContent, /HP —・攻撃 100 以上・防御 100 以上/);
  // 「すべて 100」で全部 100 に戻す
  byLabel(view, 'すべて 100').dispatch('click');
  assert.equal(input(view, 'HPの目標').value, '100');
  assert.equal(input(view, 'HPを条件にする').checked, true);
  assert.equal(cards(view)[0].textContent, full100);
  view.destroy();
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

test('理想個体画面: 所持パルが読み込まれたら作り直し、パッシブを選ぶと URL を変える', async (t) => {
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
  await pickPassive(view, 'Rare');
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

test('理想個体画面: パッシブの所持数はグローバルボックスとタマゴを数えず、切り替えも出さない', async (t) => {
  install(t);
  const view = idealView(context(fakeOwned([
    ...basePals,
    palworldPal('g1', 'SheepBall', 'Female', ['Legend'], full, { kind: 'global', playerUid: '' }),
  ])), parseHash('#/ideal?to=SheepBall'));
  const options = await passiveOptions(view);
  // 職人気質は m1・u1、希少は f1・f2・u1（タマゴの e1 は数えない）。伝説はグローバルボックスだけなので所持数なし
  assert.ok(options.includes('職人気質（2）'), options.slice(0, 5).join(','));
  assert.ok(options.includes('希少（3）'));
  assert.ok(!options.some((text) => /^伝説（/.test(text)));
  // チェックボックスは個体値の目標の 3 つだけ（切り替えのチェックはない）
  assert.deepEqual(view.element.querySelectorAll('input').filter((node) => node.type === 'checkbox').map((node) => node.getAttribute('aria-label')),
    ['HPを条件にする', '攻撃を条件にする', '防御を条件にする']);
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
  chooseRadio(view, 'ケーキ', 'talent');
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
test('理想個体画面: 所持者（すべて／自分の個体／各プレイヤー）で親の候補とパッシブの所持数を絞り、選んだプレイヤーがいなくなったら「すべて」に戻す', async (t) => {
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
  for (const value of [`player:${P1}`, 'mine']) {
    holder.value = value;
    holder.dispatch('change');
    assert.deepEqual(cards(view).map((card) => card.querySelectorAll('.owned-row').map((row) => row.querySelector('.owned-where').textContent).join(' × ')),
      ['Aliceパルボックス × Aliceパルボックス']);
    const counts = await passiveOptions(view);
    assert.ok(counts.includes('希少（2）'));
    assert.ok(!counts.some((text) => /^伝説（|^脳筋（/.test(text)));
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

test('理想個体画面: 「☆ 目標として保存」の板で名前を付けて保存し（Enter）、「目標（N）」のダイアログに完成の状態を出す', (t) => {
  const { body } = install(t);
  const owned = fakeOwned([
    palworldPal('m1', 'SheepBall', 'Male', ['Rare'], full),
    palworldPal('f1', 'SheepBall', 'Female', ['Rare'], { hp: 90, shot: 90, defense: 90 }),
  ]);
  const ctx = withIdeals(context(owned), owned);
  const view = idealView(ctx, parseHash('#/ideal?to=SheepBall&p=Rare'));
  body.append(view.element);
  const save = saveButton(view);
  assert.equal(save.textContent, '☆ 目標として保存');
  assert.equal(save.getAttribute('aria-disabled'), 'false');
  // title は保存される条件の要約（I-20）
  assert.equal(save.title, 'HP 100 以上・攻撃 100 以上・防御 100 以上 · 欲しいものを全部持つ（他も可） · ケーキ・野菜ケーキ');
  assert.equal(view.element.querySelector('.ideal-goals-button').textContent, '目標（0）');
  // 押すと板が開き、名前の欄に自動の名前（パル名＋パッシブ）を入れてフォーカスする
  save.dispatch('click');
  const board = view.element.querySelector('.ideal-save-popover');
  assert.equal(board.getAttribute('role'), 'dialog');
  assert.match(board.textContent, /この端末に保存します/);
  const name = nameInput(view);
  assert.equal(name.value, 'モコロン（希少）');
  assert.equal(document.activeElement, name);
  // 日本語の変換中の Enter では保存しない
  name.value = '最強モコロン';
  name.dispatch('keydown', { key: 'Enter', isComposing: true });
  assert.equal(ctx.ideals.list().length, 0);
  name.dispatch('keydown', { key: 'Enter' });
  assert.deepEqual(ctx.ideals.list().map((goal) => [goal.name, goal.palId, goal.passives.join(','), goal.mode, goal.order]), [['最強モコロン', 'SheepBall', 'Rare', 'include', 'next']]);
  // 板は閉じてボタンへフォーカスを戻す。同じ条件はもう保存できない（押せない印。フォーカスは残す）
  assert.equal(nameInput(view), undefined);
  assert.equal(document.activeElement, save);
  assert.equal(save.textContent, '★ 保存済み');
  assert.equal(save.getAttribute('aria-disabled'), 'true');
  save.dispatch('click');
  assert.equal(nameInput(view), undefined);
  assert.equal(view.element.querySelector('.ideal-goals-button').textContent, '目標（1）');
  // m1 は 3 つとも 100 で希少を持つので完成済み
  const dialog = openGoals(view);
  assert.equal(dialog.querySelector('h2').textContent, '目標');
  assert.match(dialog.querySelector('.ideal-goal').textContent, /最強モコロン.*希少.*HP 100 以上.*完成済み: Alice · パルボックス/);
  // 条件を変えると、また保存できる
  const attack = input(view, '攻撃の目標');
  attack.value = '90';
  attack.dispatch('input');
  assert.equal(save.textContent, '☆ 目標として保存');
  assert.equal(save.getAttribute('aria-disabled'), 'false');
  attack.value = '100';
  attack.dispatch('input');
  assert.equal(save.textContent, '★ 保存済み');
  // アルファの条件はない
  assert.ok(!view.element.querySelectorAll('[role="radio"]').some((node) => node.getAttribute('data-value') === 'alpha'));
  view.destroy();
  assert.equal(dialog.open, false);
});

test('理想個体画面: 保存の板は Esc・キャンセルで閉じてボタンへ戻り、何も保存しない。目標を選ぶ前は保存のボタンが見えず（場所は残す）押せない', async (t) => {
  const { body, events } = install(t);
  const owned = fakeOwned();
  const ctx = withIdeals(context(owned), owned);
  const view = idealView(ctx, parseHash('#/ideal?to=SheepBall'));
  body.append(view.element);
  const save = saveButton(view);
  save.dispatch('click');
  assert.ok(nameInput(view));
  await events.dispatch('keydown', { key: 'Escape' });
  assert.equal(nameInput(view), undefined);
  assert.equal(document.activeElement, save);
  save.dispatch('click');
  view.element.querySelector('.ideal-save-popover').querySelectorAll('button').find((node) => node.textContent === 'キャンセル').dispatch('click');
  assert.equal(nameInput(view), undefined);
  assert.equal(document.activeElement, save);
  assert.equal(ctx.ideals.list().length, 0);
  view.destroy();
  // 目標がないとき: 見えない（visibility で場所は残す）・押せない
  const none = idealView(withIdeals(context(fakeOwned()), owned), parseHash('#/ideal'));
  const hidden = saveButton(none);
  assert.ok(hidden.className.split(' ').includes('is-placeholder'));
  assert.equal(hidden.disabled, true);
  assert.equal(hidden.hidden, false);
  assert.equal(hidden.title, '');
  none.destroy();
  // ログインしていない（目標を保存できない）ときは、保存のボタンも「目標（N）」も出さない
  const guest = idealView(context(fakeOwned()), parseHash('#/ideal?to=SheepBall'));
  assert.equal(guest.element.querySelector('.ideal-save-slot').hidden, true);
  assert.equal(guest.element.querySelector('.ideal-goals-button').hidden, true);
  guest.destroy();
});

test('理想個体画面: 目標のダイアログから外す・元に戻す・呼び出すができ、呼び出すとダイアログを閉じる', async (t) => {
  const { body } = install(t);
  const owned = fakeOwned();
  const ctx = withIdeals(context(owned), owned);
  ctx.ideals.add({ name: '古い目標', palId: 'SheepBall', passives: [], mode: 'include', targets: full, cake: 'none', order: 'next' });
  ctx.ideals.add({ name: '攻撃型', palId: 'SheepBall', passives: ['Rare'], mode: 'only', targets: { hp: 0, shot: 100, defense: 90 }, cake: 'talent', order: 'next' });
  const view = idealView(ctx, parseHash('#/ideal'));
  body.append(view.element);
  assert.equal(view.element.querySelector('.ideal-goals-button').textContent, '目標（2）');
  const dialog = openGoals(view);
  // 名前は .ideal-goal-title の最後の子（パルの絵の中にも strong がある）
  const goalName = (row) => row.querySelector('.ideal-goal-title').children.at(-1).textContent;
  const titles = () => dialog.querySelectorAll('.ideal-goal').map(goalName);
  // 新しい順（完成済みがあれば上）。列: パル・名前／パッシブ／条件の要約／状態／呼び出す・外す
  assert.deepEqual(titles(), ['攻撃型', '古い目標']);
  const [row] = dialog.querySelectorAll('.ideal-goal');
  assert.match(row.querySelector('.passive-list').className, /compact/);
  assert.equal(row.querySelector('.ideal-goal-summary').textContent, 'HP —・攻撃 100 以上・防御 90 以上 · 欲しいものだけを持つ · キノコケーキ・豪華野菜ケーキ');
  // 外すと行が消え、フォーカスは次の行へ。トーストの「元に戻す」で同じ位置に戻る
  const remove = row.querySelectorAll('button').find((node) => node.getAttribute('aria-label') === '「攻撃型」を目標から外す');
  remove.focus();
  remove.dispatch('click');
  assert.deepEqual(titles(), ['古い目標']);
  assert.equal(view.element.querySelector('.ideal-goals-button').textContent, '目標（1）');
  assert.ok(dialog.querySelectorAll('.ideal-goal')[0].contains(document.activeElement));
  const undo = dialog.querySelector('.toast-action');
  assert.ok(undo);
  await undo.dispatch('click');
  assert.deepEqual(titles(), ['攻撃型', '古い目標']);
  // 呼び出す: g つきのリンクで、押すとダイアログを閉じる（遷移はリンクのまま）
  const recall = dialog.querySelectorAll('a').find((node) => node.textContent === '呼び出す');
  const [goal] = ctx.ideals.list();
  assert.equal(recall.href, `#/ideal?to=SheepBall&p=Rare&g=${goal.id}`);
  recall.dispatch('click');
  assert.equal(dialog.open, false);
  // 閉じた後は行を描かない（開き直すと今の行）
  ctx.ideals.add({ name: '新しい目標', palId: 'PinkCat', passives: [], mode: 'include', targets: full, cake: 'none', order: 'next' });
  assert.equal(dialog.querySelectorAll('.ideal-goal').length, 0);
  // 完成済み（モコロンの 2 つ。所持パルの f1 が満たす）を上に、未完成のツッパニャンは下
  const again = openGoals(view);
  assert.deepEqual(again.querySelectorAll('.ideal-goal').map(goalName), ['攻撃型', '古い目標', '新しい目標']);
  assert.deepEqual(again.querySelectorAll('.ideal-goal-status').map((node) => node.className), ['ideal-goal-status ready', 'ideal-goal-status ready', 'ideal-goal-status']);
  view.destroy();
});

test('理想個体画面: この端末に目標を保存できなかったら「目標（N）!」と title で知らせ、ダイアログに警告を出す。古い viewState の goalsOpen は読まない', (t) => {
  install(t);
  const owned = fakeOwned();
  // 前の画面（登録した一覧の折りたたみ）が viewState に残した goalsOpen
  const states = new Map([['ideal', { goalsOpen: true }]]);
  const ctx = withIdeals(context(owned, [], states), owned);
  const failing = new Map();
  ctx.ideals = createIdealStore({
    store: { state: { env: 'test', userId: 'Alice', passcode: '入力', renaming: false, users: ['Alice'] }, subscribe: () => () => {} },
    owned, storage: { getItem: (key) => failing.get(key) ?? null, setItem() { throw new Error('容量超過'); }, removeItem: () => {} },
  });
  const view = idealView(ctx, parseHash('#/ideal?to=SheepBall'));
  // 折りたたみの一覧は出さず、ダイアログも開かない
  assert.equal(view.element.querySelector('details'), null);
  assert.equal(document.body.querySelectorAll('dialog').length, 0);
  const goals = view.element.querySelector('.ideal-goals-button');
  assert.equal(goals.textContent, '目標（0）');
  assert.equal(goals.title, '');
  saveAsGoal(view, '保存できない目標');
  assert.equal(ctx.ideals.saveFailed, true);
  assert.equal(goals.textContent, '目標（1）!');
  assert.equal(goals.title, 'この端末に保存できませんでした');
  const dialog = openGoals(view);
  const warning = dialog.querySelector('.form-errors');
  assert.equal(warning.hidden, false);
  assert.equal(warning.getAttribute('role'), 'alert');
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
  // 保存の 0（条件なし）は、チェックなし・空欄で出す
  assert.deepEqual([value('HPの目標'), value('攻撃の目標'), value('防御の目標')], ['', '100', '90']);
  assert.deepEqual(['HPを条件にする', '攻撃を条件にする', '防御を条件にする'].map((label) => input(view, label).checked), [false, true, true]);
  assert.deepEqual([chosen(view, 'パッシブの条件'), chosen(view, 'ケーキ')], ['only', 'talent']);
  assert.deepEqual(ctx.replacements, ['#/ideal?to=SheepBall&p=Rare']);
  assert.equal(saveButton(view).textContent, '★ 保存済み');
  assert.equal(saveButton(view).getAttribute('aria-disabled'), 'true');
  // 目標のダイアログの「呼び出す」は g つきのリンク
  assert.equal(openGoals(view).querySelector('.ideal-goal').querySelectorAll('a').find((node) => node.textContent === '呼び出す').href, `#/ideal?to=SheepBall&p=Rare&g=${goal.id}`);
  view.destroy();
});

test('理想個体画面: 同じ画面のまま URL が変わっても（applyRoute）パネルを作り直さず、保存の板は目標・パッシブが変わったら閉じる', (t) => {
  const { body } = install(t);
  const owned = fakeOwned();
  const ctx = withIdeals(context(owned), owned);
  const view = idealView(ctx, parseHash('#/ideal?to=SheepBall'));
  body.append(view.element);
  const panel = view.element.querySelector('.ideal-panel');
  const trigger = view.element.querySelector('.picker-trigger');
  const save = saveButton(view);
  save.dispatch('click');
  const name = nameInput(view);
  name.value = '最強モコロン';
  // 同じ route（戻る・進むの読み直しなど）では閉じない
  view.applyRoute(parseHash('#/ideal?to=SheepBall'), { reason: 'history' });
  assert.equal(nameInput(view), name);
  assert.equal(name.value, '最強モコロン');
  // パッシブが変わると閉じる（前の条件の名前で保存しない）。パネルと部品は同じ要素
  view.applyRoute(parseHash('#/ideal?to=SheepBall&p=Rare'), { reason: 'update' });
  assert.equal(nameInput(view), undefined);
  assert.equal(view.element.querySelector('.ideal-panel'), panel);
  assert.equal(view.element.querySelector('.picker-trigger'), trigger);
  assert.equal(saveButton(view), save);
  assert.deepEqual(view.element.querySelector('.passive-selector').querySelectorAll('.passive-name').map((node) => node.textContent), ['希少']);
  // 開き直すと今の条件の名前
  save.dispatch('click');
  assert.equal(nameInput(view).value, 'モコロン（希少）');
  view.applyRoute(parseHash('#/ideal?to=PinkCat&p=Rare'), { reason: 'update' });
  assert.equal(nameInput(view), undefined);
  assert.equal(trigger.getAttribute('aria-label'), '目標: No.2 ツッパニャン');
  save.dispatch('click');
  assert.equal(nameInput(view).value, 'ツッパニャン（希少）');
  // 目標を外すと板を閉じ、保存のボタンは見えず押せない
  view.applyRoute(parseHash('#/ideal'), { reason: 'update' });
  assert.equal(nameInput(view), undefined);
  assert.ok(save.className.split(' ').includes('is-placeholder'));
  assert.equal(save.disabled, true);
  assert.equal(view.element.querySelector('.ideal-panel'), panel);
  view.destroy();
});

test('理想個体画面: 同じ画面のまま g つきの URL が来ると、登録した条件を入力欄にも入れ、URL から g を外す', async (t) => {
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
  // 保存の 0（条件なし）は、チェックなし・空欄で出す（前に出ていた HP 100 も消す）
  assert.deepEqual([value('HPの目標'), value('攻撃の目標'), value('防御の目標')], ['', '100', '90']);
  assert.deepEqual(['HPを条件にする', '攻撃を条件にする', '防御を条件にする'].map((label) => input(view, label).checked), [false, true, true]);
  assert.deepEqual([chosen(view, 'パッシブの条件'), chosen(view, 'ケーキ')], ['only', 'talent']);
  assert.equal(saveButton(view).textContent, '★ 保存済み');
  // ここから作る遷移先の URL に g を残さない
  await pickPassive(view, 'Legend');
  assert.deepEqual(ctx.navigations, ['#/ideal?to=SheepBall&p=Rare%2CLegend']);
  view.destroy();
});

test('理想個体画面: 同じ画面のままパッシブを足す・外しても選択欄を作り直さず、候補を開いたまま続けて選べ、× の後は追加欄へ', async (t) => {
  const { body } = install(t);
  const owned = fakeOwned();
  const ctx = context(owned);
  const updates = [];
  let view;
  ctx.update = (hash) => { updates.push(hash); view.applyRoute(parseHash(hash), { reason: 'update' }); };
  view = idealView(ctx, parseHash('#/ideal?to=SheepBall'));
  body.append(view.element);
  const add = passiveAdd(view);
  await pickPassive(view, 'Rare');
  assert.deepEqual(updates, ['#/ideal?to=SheepBall&p=Rare']);
  assert.deepEqual(ctx.navigations, []);
  assert.equal(passiveAdd(view), add);
  // 候補は開いたまま、検索欄にフォーカスがある（続けて選べる）
  const search = view.element.querySelector('.picker-search');
  assert.ok(search);
  assert.equal(document.activeElement, search);
  assert.equal(view.element.querySelector('[data-value="Rare"]'), null);
  await pickPassive(view, 'Legend');
  assert.equal(updates.at(-1), '#/ideal?to=SheepBall&p=Rare%2CLegend');
  assert.equal(view.element.querySelector('.picker-search'), search);
  await search.dispatch('keydown', { key: 'Escape' });
  assert.equal(document.activeElement, add);
  const remove = view.element.querySelector('.passive-remove');
  remove.focus();
  await remove.dispatch('click');
  assert.equal(updates.at(-1), '#/ideal?to=SheepBall&p=Legend');
  assert.equal(document.activeElement, add);
  view.destroy();
});

test('理想個体画面: 4 個目を足して追加欄が押せなくなったら、残ったチップの最後の × にフォーカスを移し、× で外すと追加欄へ戻す', async (t) => {
  const { body } = install(t);
  const ctx = context(fakeOwned());
  let view;
  ctx.update = (hash) => view.applyRoute(parseHash(hash), { reason: 'update' });
  view = idealView(ctx, parseHash('#/ideal?to=SheepBall&p=Rare,Legend,WorldTree_ATK'));
  body.append(view.element);
  await pickPassive(view, 'WorldTree_DEF');
  assert.equal(passiveAdd(view).disabled, true);
  assert.equal(view.element.querySelector('.picker-search'), null);
  const removes = view.element.querySelectorAll('.passive-remove');
  assert.equal(removes.length, 4);
  assert.equal(document.activeElement, removes.at(-1));
  assert.equal(document.activeElement.getAttribute('data-focus-key'), 'passive-chip:欲しいパッシブ:WorldTree_DEF');
  await removes.at(-1).dispatch('click');
  assert.equal(document.activeElement, passiveAdd(view));
  assert.equal(document.activeElement.disabled, false);
  view.destroy();
});

test('理想個体画面: 目標を選ぶと、欲しいパッシブの候補を「目標と配合の親」と「ほかの所持パル」に分け、マイナスのパッシブは最後の群に', async (t) => {
  install(t);
  const owned = fakeOwned([
    ...basePals,
    palworldPal('p1', 'PinkCat', 'Male', ['Legend', 'CraftSpeed_down1']),
    palworldPal('c1', 'ChickenPal', 'Male', ['Noukin']),
  ]);
  const groupsOf = async (view) => {
    await passiveAdd(view).dispatch('click');
    return view.element.querySelector('.passive-options').querySelectorAll('.passive-group-label').map((node) => node.textContent);
  };
  // ツッパニャン × タマコッコ → モコロンの登録があるので、ツッパニャンとタマコッコは親の候補の種族
  const records = [{ id: 'r1', parent1Id: 'PinkCat', parent2Id: 'ChickenPal', childId: 'SheepBall' }];
  const view = idealView(context(owned, records), parseHash('#/ideal?to=SheepBall'));
  assert.deepEqual(await groupsOf(view), ['モコロンと配合の親が持っているもの', 'その他', 'マイナスのパッシブ']);
  const minus = view.element.querySelector('.passive-options').querySelectorAll('.passive-group-label').at(-1);
  assert.equal(minus.textContent, 'マイナスのパッシブ');
  assert.equal(view.element.querySelector('[data-value="CraftSpeed_down1"]').querySelector('.passive-option-count').textContent, '1 体');
  view.destroy();
  // 登録がなければ、ほかの種族はほかの所持パルの群へ
  const other = idealView(context(owned), parseHash('#/ideal?to=SheepBall'));
  assert.deepEqual(await groupsOf(other), ['モコロンと配合の親が持っているもの', 'ほかの所持パルが持っているもの', 'その他', 'マイナスのパッシブ']);
  assert.equal(other.element.querySelector('[data-value="Legend"]').querySelector('.passive-option-count').textContent, '1 体');
  other.destroy();
  // 目標を選んでいなければ 1 群（と、その他・マイナス）
  const none = idealView(context(owned), parseHash('#/ideal'));
  assert.deepEqual(await groupsOf(none), ['所持パルが持っているもの', 'その他', 'マイナスのパッシブ']);
  none.destroy();
});

test('理想個体画面: 登録した理想個体のパッシブの組み合わせを（重複を除き新しい順に）「登録した組み合わせ」に出し、押すとその組で選び直す', async (t) => {
  install(t);
  const owned = fakeOwned();
  const ctx = withIdeals(context(owned), owned);
  const goal = (name, passiveIds, palId = 'SheepBall') => ctx.ideals.add({ name, palId, passives: passiveIds, mode: 'include', targets: full, cake: 'none', order: 'next' });
  goal('古い', ['Rare']);
  goal('同じ組', ['Rare'], 'PinkCat');
  goal('パッシブなし', []);
  goal('新しい', ['Legend', 'Rare']);
  const view = idealView(ctx, parseHash('#/ideal?to=SheepBall&p=Noukin'));
  await passiveAdd(view).dispatch('click');
  const presets = view.element.querySelectorAll('.passive-preset');
  assert.deepEqual(presets.map((node) => node.title), ['新しい', '同じ組']);
  await presets[0].dispatch('click');
  assert.deepEqual(ctx.navigations, ['#/ideal?to=SheepBall&p=Legend%2CRare']);
  // 登録を足すと、開いたまま組み合わせを入れ直す
  goal('もっと新しい', ['WorldTree_ATK']);
  assert.ok(view.element.querySelector('.picker-search'));
  assert.deepEqual(view.element.querySelectorAll('.passive-preset').map((node) => node.title), ['もっと新しい', '新しい', '同じ組']);
  view.destroy();
});

test('理想個体画面: 余計なパッシブ・配合では作れないパッシブ・「○○を運ぶ経路」のボタンは小さなチップで出す', (t) => {
  install(t);
  const extra = idealView(context(fakeOwned([
    palworldPal('m1', 'SheepBall', 'Male', ['Rare', 'Noukin']),
    palworldPal('f1', 'SheepBall', 'Female', ['Rare']),
  ])), parseHash('#/ideal?to=SheepBall&p=Rare'));
  const note = extra.element.querySelector('.ideal-extras');
  assert.ok(note);
  assert.equal(note.querySelector('.passive-chip').className, 'passive-chip passive-rank-2 compact');
  assert.match(note.textContent, /^余計なパッシブ: 脳筋（これがなければ/);
  extra.destroy();
  const missing = idealView(context(fakeOwned()), parseHash('#/ideal?to=SheepBall&p=Legend'));
  const warning = missing.element.querySelector('.ideal-missing-note').querySelector('.ideal-warning');
  assert.match(warning.querySelector('.passive-chip').className, /compact/);
  const action = missing.element.querySelector('.ideal-carry');
  assert.equal(action.textContent, '伝説を運ぶ経路');
  assert.match(action.querySelector('.passive-chip').className, /compact/);
  // チップの title と重ならないよう、ボタンには title を付けない
  assert.equal(action.title, undefined);
  missing.destroy();
});

test('理想個体画面: 目標を外すとダイアログの行が消えて空の文を出し、所持パルのデータがないときは「未確認」と出す', (t) => {
  install(t);
  const owned = fakeOwned(null);
  const ctx = withIdeals(context(owned), owned);
  ctx.ideals.add({ name: '目標', palId: 'SheepBall', passives: [], mode: 'include', targets: { hp: 100, shot: 100, defense: 100 }, cake: 'none', order: 'next' });
  const view = idealView(ctx, parseHash('#/ideal'));
  const dialog = openGoals(view);
  assert.match(dialog.querySelector('.ideal-goal').textContent, /未確認（所持パルのデータがありません）/);
  // 目標のパルを選ぶまでは保存できない
  assert.equal(saveButton(view).disabled, true);
  const remove = dialog.querySelector('.ideal-goal').querySelectorAll('button').find((node) => node.getAttribute('aria-label') === '「目標」を目標から外す');
  remove.dispatch('click');
  assert.equal(ctx.ideals.list().length, 0);
  assert.equal(dialog.querySelector('.ideal-goal-empty').textContent,
    '保存した目標はまだありません。条件を選んで「☆ 目標として保存」を押すと、ここに並び、完成したら右上のベルで知らせます。');
  view.destroy();
});

test('理想個体画面: g で開いた後にパッシブを変えても、遷移先の URL に g を残さない', async (t) => {
  install(t);
  const owned = fakeOwned();
  const ctx = withIdeals(context(owned), owned);
  ctx.ideals.add({ name: '攻撃型', palId: 'SheepBall', passives: ['Rare'], mode: 'only', targets: { hp: 0, shot: 100, defense: 90 }, cake: 'talent', order: 'next' });
  const [goal] = ctx.ideals.list();
  const view = idealView(ctx, parseHash(`#/ideal?to=SheepBall&p=Rare&g=${goal.id}`));
  await pickPassive(view, 'Legend');
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
  chooseRadio(view, 'パッシブの条件', 'only');
  chooseRadio(view, 'ケーキ', 'special');
  assert.equal(cards(view).length, 0);
  assert.match(view.element.querySelector('.ideal-results').textContent, /スペシャルケーキは空いた枠をランダムなパッシブで埋めるので/);
  view.destroy();
  // 欲しいパッシブなしで「欲しいものだけ」（パッシブなし）は、パッシブを持つ親からは産まれない
  const none = idealView(context(owned), parseHash('#/ideal?to=SheepBall'));
  chooseRadio(none, 'パッシブの条件', 'only');
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
  chooseRadio(view, 'ケーキ', 'talent');
  assert.equal(view.element.querySelectorAll('.ideal-changed').length, 0);
  chooseRadio(view, 'ケーキ', 'none');
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
  // 所持パルが中身の同じまま読み直された（新しいデータ）ときも、計算もカードもそのまま
  owned.state.owned = normalizeOwned(owned.state.data.snapshot, { pals, passives });
  owned.emit();
  assert.equal(cards(view)[0], card);
  // 計算に効く値（個体値）が変わったら計算し直す
  const changed = owned.state.data.snapshot.pals.map((pal) => (pal.instanceId === 'm1' ? { ...pal, talent: { hp: 99, shot: 100, defense: 100 } } : pal));
  owned.state.owned = normalizeOwned({ ...owned.state.data.snapshot, pals: changed }, { pals, passives });
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

test('理想個体画面: 所持者の選択欄は中身が同じなら作り直さず、変わってもフォーカス中は離れるまで待つ。パッシブの選択欄は作り直さず、開いたまま所持数だけ変わる', async (t) => {
  install(t);
  const P2 = 'abcd1234-0000-0000-0000-000000000000';
  const owned = fakeOwned();
  const view = idealView(context(owned), parseHash('#/ideal?to=SheepBall&p=CraftSpeed_up2'));
  document.body.append(view.element);
  const holder = view.element.querySelectorAll('select').find((node) => [...node.children].some((option) => option.value === `player:${P1}`));
  const options = [...holder.children];
  const add = passiveAdd(view);
  // 中身が同じデータの読み直し
  owned.state.owned = normalizeOwned(owned.state.data.snapshot, { pals, passives });
  owned.emit();
  assert.deepEqual([...holder.children], options);
  assert.equal(passiveAdd(view), add);
  // プレイヤーと所持数が変わった。所持者の欄を選んでいる途中は作り直さない
  const snapshot = { ...owned.state.data.snapshot, players: [...owned.state.data.snapshot.players, { uid: P2, name: 'Bob', level: 3 }],
    pals: [...owned.state.data.snapshot.pals, palworldPal('n1', 'SheepBall', 'Female', ['Noukin'], full, { kind: 'palbox', playerUid: P2 })] };
  holder.focus();
  owned.state.owned = normalizeOwned(snapshot, { pals, passives });
  owned.emit();
  assert.deepEqual([...holder.children], options);
  assert.equal(passiveAdd(view), add);
  // 離れたら作り直す
  document.activeElement = document.body;
  await holder.dispatch('blur');
  await settle();
  assert.deepEqual([...holder.children].map((option) => option.textContent), ['すべて', 'Alice', 'Bob']);
  // パッシブの候補を開いて検索している途中に所持数が変わっても（20 秒ごとの確認など）、閉じずに数だけ描き直す
  await add.dispatch('click');
  const search = view.element.querySelector('.picker-search');
  search.value = '脳筋';
  await search.dispatch('input');
  assert.equal(view.element.querySelector('[data-value="Noukin"]').querySelector('.passive-option-count').textContent, '2 体');
  owned.state.owned = normalizeOwned(owned.state.data.snapshot, { pals, passives });
  owned.emit();
  assert.equal(view.element.querySelector('.picker-search'), search);
  assert.equal(document.activeElement, search);
  assert.equal(search.value, '脳筋');
  assert.equal(view.element.querySelector('[data-value="Noukin"]').querySelector('.passive-option-count').textContent, '1 体');
  assert.equal(passiveAdd(view), add);
  view.destroy();
});

// ---- フェーズ 1a のレビューで直したもの ----
test('理想個体画面: 個体値の目標の間引きの途中で画面を閉じたら、閉じた後に計算を始めない。flushInputs は待っている入力をすぐ当てる', async (t) => {
  installDom(t);
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const view = idealView({ ...context(fakeOwned()), inputDelay: 150, sliceBudget: 0 }, parseHash('#/ideal?to=SheepBall&p=CraftSpeed_up2,Rare'));
  t.mock.timers.runAll();
  await settle();
  const results = view.element.querySelector('.ideal-results');
  assert.equal(results.getAttribute('aria-busy'), null);
  const hp = input(view, 'HPの目標');
  hp.value = '91';
  await hp.dispatch('input');
  view.destroy();
  t.mock.timers.tick(150);
  assert.equal(results.getAttribute('aria-busy'), null);
  t.mock.timers.runAll();

  const states = new Map();
  const later = idealView({ ...context(fakeOwned(), [], states), inputDelay: 1000 }, parseHash('#/ideal?to=SheepBall'));
  const shot = input(later, '攻撃の目標');
  shot.value = '60';
  await shot.dispatch('input');
  assert.equal(states.get('ideal').conditions.targets.shot, 100);
  later.flushInputs();
  assert.equal(states.get('ideal').conditions.targets.shot, 60);
  later.destroy();
});

test('理想個体画面: 選んでいる所持者が、フォーカス中の更新で選択肢から消えたら、離れた後に「すべて」に戻して計算し直す', async (t) => {
  install(t);
  const P2 = 'abcd1234-0000-0000-0000-000000000000';
  const owned = fakeOwned();
  const view = idealView(context(owned), parseHash('#/ideal?to=SheepBall'));
  document.body.append(view.element);
  const holder = view.element.querySelectorAll('select').find((node) => [...node.children].some((option) => option.value === `player:${P1}`));
  holder.value = `player:${P1}`;
  await holder.dispatch('change');
  const before = cards(view).length;
  assert.ok(before > 0);
  holder.focus();
  // 同じワールドの更新で、同じ個体がすべて Bob のものになった（Alice は選択肢から消える）
  const moved = basePals.map((pal) => ({ ...pal, location: { ...pal.location, playerUid: P2 } }));
  owned.state.owned = normalizeOwned({ ...owned.state.data.snapshot, players: [{ uid: P2, name: 'Bob', level: 3 }], pals: moved }, { pals, passives });
  owned.emit();
  assert.equal(cards(view).length, 0);
  document.activeElement = document.body;
  await holder.dispatch('blur');
  await settle();
  assert.equal(holder.value, '');
  assert.equal(cards(view).length, before);
  view.destroy();
});

test('理想個体画面: URL のパッシブは重複と内部名の形でない値を除き、マスターにまだ無い内部名は残す', (t) => {
  install(t);
  const view = idealView(context(fakeOwned()), parseHash('#/ideal?to=SheepBall&p=Rare,Rare,知らないパッシブ,Unknown_Passive_X'));
  assert.deepEqual(view.element.querySelectorAll('.passive-remove').map((node) => node.getAttribute('aria-label')), ['希少 を外す', 'Unknown_Passive_X を外す']);
  view.destroy();
});

test('理想個体画面: マスターにまだ無い内部名のパッシブ（所持パルに付いていれば候補に出る）を選ぶと、チップが出て条件に入る', async (t) => {
  install(t);
  const owned = fakeOwned([...basePals, palworldPal('n1', 'SheepBall', 'Male', ['Unknown_Passive_X'])]);
  const ctx = context(owned);
  const view = idealView(ctx, parseHash('#/ideal?to=SheepBall'));
  ctx.update = (hash) => view.applyRoute(parseHash(hash), { reason: 'update' });
  await pickPassive(view, 'Unknown_Passive_X');
  assert.deepEqual(view.element.querySelectorAll('.passive-remove').map((node) => node.getAttribute('aria-label')), ['Unknown_Passive_X を外す']);
  assert.match(view.element.querySelector('.ideal-results').textContent, /Unknown_Passive_X/);
  view.destroy();
});

test('理想個体画面: 計算に効かない値（レベル・ニックネームなど）だけが変わっても計算中の仕事を捨てず、描くときと描いた後は新しいデータの個体を出す', async (t) => {
  install(t);
  // 区切った計算の続き（setTimeout）を手で 1 回ずつ進める
  const queue = [];
  const original = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => { queue.push(fn); return queue.length; };
  t.after(() => { globalThis.setTimeout = original; });
  const list = (level, nickname = '') => Array.from({ length: 120 }, (_, i) => ({
    ...palworldPal(`k${i}`, 'SheepBall', i % 2 ? 'Male' : 'Female', i % 3 ? ['Rare'] : ['CraftSpeed_up2'], { hp: i % 101, shot: 50, defense: 50 }), level, nickname,
  }));
  const hash = '#/ideal?to=SheepBall&p=CraftSpeed_up2,Rare';
  const busy = (view) => view.element.querySelector('.ideal-results').getAttribute('aria-busy') === 'true';
  // 終わるまでに進めた区切りの数
  const finish = async (view) => {
    let ticks = 0;
    for (; busy(view) && queue.length; ticks++) { queue.shift()(); await settle(); }
    return ticks;
  };
  // 世代の表を先に作っておき（表は覚えて使い回す）、表を使い回すときに終わるまでの区切りの数を数える
  const warm = idealView({ ...context(fakeOwned(list(10))), sliceBudget: 0 }, parseHash(hash));
  await finish(warm);
  warm.destroy();
  const counted = idealView({ ...context(fakeOwned(list(10))), sliceBudget: 0 }, parseHash(hash));
  const total = await finish(counted);
  counted.destroy();
  assert.ok(total >= 3, `区切り ${total} 回`);
  const owned = fakeOwned(list(10));
  const view = idealView({ ...context(owned), sliceBudget: 0 }, parseHash(hash));
  queue.shift()();
  await settle();
  assert.ok(busy(view));
  // 計算の途中で、全員のレベルとニックネームだけが変わったデータが届いた（20 秒ごとの読み直しなど）
  owned.state.owned = normalizeOwned({ ...owned.state.data.snapshot, pals: list(30, 'ぽち') }, { pals, passives });
  owned.emit();
  assert.ok(busy(view));
  const rest = await finish(view);
  assert.ok(rest < total, `続きの区切り ${rest} 回（最初からは ${total} 回）`);
  assert.ok(cards(view).length > 0);
  assert.ok(cards(view).every((card) => /Lv 30/.test(card.textContent) && /「ぽち」/.test(card.textContent) && !/Lv 10/.test(card.textContent)));
  // 描いた後に、計算に効かない値だけが変わった: 計算し直さず、カードの個体を新しいデータで描き直す
  owned.state.owned = normalizeOwned({ ...owned.state.data.snapshot, pals: list(40, 'ぽち') }, { pals, passives });
  owned.emit();
  assert.ok(!busy(view));
  assert.ok(cards(view).every((card) => /Lv 40/.test(card.textContent)));
  // 中身が同じデータでは、カードを作り直さない
  const shown = cards(view);
  owned.state.owned = normalizeOwned({ ...owned.state.data.snapshot, pals: list(40, 'ぽち') }, { pals, passives });
  owned.emit();
  assert.deepEqual(cards(view), shown);
  // 個体値が変わったら計算し直す
  owned.state.owned = normalizeOwned({ ...owned.state.data.snapshot, pals: list(40, 'ぽち').map((pal) => ({ ...pal, talent: { hp: 100, shot: 100, defense: 100 } })) }, { pals, passives });
  owned.emit();
  assert.ok(busy(view));
  await finish(view);
  view.destroy();
});
