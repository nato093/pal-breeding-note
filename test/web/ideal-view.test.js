import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, installResizeObserver, FakeElement } from '../helpers/dom.js';
import pals from '../../web/data/pals.js';
import passives from '../../web/data/passives.js';
import { buildIndex } from '../../web/js/core/index.js';
import { buildCarrierGraph } from '../../web/js/core/route.js';
import { normalizeOwned } from '../../web/js/core/owned.js';
import { parseHash, buildHash } from '../../web/js/router.js';
import { idealView } from '../../web/js/views/ideal.js';
import { ownedRow, filterFromParams } from '../../web/js/views/owned.js';
import { createIdealStore } from '../../web/js/ideals.js';
import { createSelfStore } from '../../web/js/self-player.js';

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
// 所持者の選択（画面の中の select はこれだけ）
const holderOf = (view) => view.element.querySelector('select');
const pairOf = (card) => card.querySelectorAll('.owned-row').map((row) => row.getAttribute('aria-label')).join('×');
// 同じ種族の個体は名前で区別できないので、個体値の表示で見分ける
// 組の ♂♀ 行の個体値（4 セルの読み上げ aria-label。目標以上・未満の注は外す。目標までの差〔−N〕は D30 で出さなくした）
const talentsOf = (card) => card.querySelectorAll('.owned-talent').map((node) => node.getAttribute('aria-label')
  .replace(/^個体値 /, '').replace(/（目標 \d+ (以上|未満)）/g, '')).join(' × ');
// カードの見た目の文と、個体値の読み上げ（目標に届いているかの注を含む）。数値の行がないので、条件の違いは読み上げで見分ける
const cardText = (card) => `${card.textContent}|${card.querySelectorAll('.owned-talent').map((node) => node.getAttribute('aria-label')).join('|')}`;
// 組のカードに出さなくなった数値・説明の文（D30: 完成までの平均・内訳・「同じ種族どうし」・登録済みの配合・キノコケーキの目安）
const NUMBERS = /平均|タマゴで|約 [\d,.]+ 個|\d%|子と入れ替えながら|この 2 体のまま|同じ種族どうし|登録済みの配合|目安|上限|見ていません/;
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
  assert.doesNotMatch(list[0].textContent, /タマゴ ·|孵化/);
  // カードは [番号][札] の 1 行と ♂♀ の 2 行だけ。完成までの平均などの数値の行・内訳の文・「同じ種族どうし」は出さない（D30）
  const [head, male, female] = list[0].children;
  assert.deepEqual(list[0].children.map((node) => node.className), ['ideal-pair-head', 'owned-row', 'owned-row']);
  assert.deepEqual(head.children.map((node) => node.className), ['step-number', 'ideal-tags']);
  assert.ok(male && female);
  assert.doesNotMatch(list[0].textContent, NUMBERS);
  assert.equal(list[0].querySelector('.ideal-chance'), null);
  assert.equal(list[0].querySelector('.ideal-source'), null);
  // 結果の上の要約の行（「上位 N 組…」・除外）はない（D30）
  assert.equal(view.element.querySelector('.ideal-summary'), null);
  assert.equal(view.element.querySelector('.ideal-excluded'), null);
  // 並べ方の切り替えはない
  assert.ok(!view.element.querySelectorAll('select').some((node) => [...node.children].some((option) => option.value === 'generations')));
  // 計算のしくみの説明（見出しの「?」とダイアログ）はない（D30。前は「?」で 4 つの見出しの説明を開いた）
  assert.equal(view.element.querySelector('.view-help-button'), null);
  assert.ok(!view.element.querySelectorAll('button').some((node) => node.textContent === '?' || /計算のしくみ/.test(node.getAttribute('aria-label') ?? '')));
  assert.deepEqual(view.element.querySelector('.view-heading').querySelectorAll('button').map((node) => node.className.split(' ').at(-1)), ['ideal-goals-button']);
  // 選んだパッシブは選択欄に出る
  assert.deepEqual(view.element.querySelectorAll('.passive-selector')[0].querySelectorAll('.passive-name').map((node) => node.textContent), ['職人気質', '希少']);
  // 選択欄は条件のパネル（.ideal-panel）の 1 段目に、目標と並べて置く
  assert.ok(view.element.querySelector('.ideal-panel-main').querySelector('.passive-selector'));
  assert.equal(owned.loads, 1);
  view.destroy();
  assert.equal(owned.listeners.size, 0);
});

test('理想個体画面: 条件を sticky のパネルにまとめる（1 段目: 目標・欲しいパッシブ〔見出しの行にパッシブの条件〕・保存、2 段目: 所持者・個体値・ケーキ・所持の状況）', (t) => {
  install(t);
  const owned = fakeOwned();
  const view = idealView(withIdeals(context(owned), owned), parseHash('#/ideal?to=SheepBall&p=Rare'));
  const children = view.element.children;
  // 並び: 見出し → パネル → 足りないパッシブ → 牧場の帯 → 牧場の詳細 → 結果（登録の行・登録した一覧の折りたたみはない。
  // データ元の 1 行は上のバーのセーブ連携の表示と重なるのでなくした〔D29〕。要約の行もなくした〔D30〕）
  assert.deepEqual(children.map((node) => node.className), ['view-heading', 'ideal-panel', 'ideal-missing-note', 'ideal-farm-strip', 'ideal-farms', 'ideal-results']);
  assert.equal(view.element.querySelector('.ideal-goals'), null);
  assert.equal(view.element.querySelector('.ideal-register'), null);
  const panel = view.element.querySelector('.ideal-panel');
  assert.equal(panel.tagName, 'section');
  assert.equal(panel.getAttribute('aria-label'), '理想個体の条件');
  const [main, sub] = panel.children;
  assert.deepEqual(main.children.map((node) => node.className.split(' ')[0]), ['picker', 'field', 'ideal-save-slot']);
  assert.ok(main.children[1].className.includes('passive-selector'));
  // パッシブの条件は欲しいパッシブの見出しの行に置く（D28。所持パルのパネルと同じ部品。前は 2 段目の「条件」）
  const passiveHead = main.children[1].children[0];
  assert.equal(passiveHead.className, 'field-head');
  assert.equal(passiveHead.querySelector('.field-label').textContent, '欲しいパッシブ');
  assert.equal(passiveHead.querySelector('[role="radiogroup"]').getAttribute('aria-label'), 'パッシブの条件');
  // 2 段目は 2 行（所持者・個体値 ／ ケーキ・右端の所持の状況）。見出しは入力の左
  assert.deepEqual(sub.children.map((line) => line.className), ['panel-line', 'panel-line']);
  assert.deepEqual(sub.children.map((line) => line.children.map((node) => (node.tagName === 'a' ? node.textContent : node.children[0].textContent))),
    [['所持者', '個体値（以上）'], ['ケーキ', '所持 ♂1 ♀2 · 全部持つ ♂0 ♀2']]);
  assert.equal(panel.querySelectorAll('.field-label').some((node) => node.textContent === '条件'), false);
  const holderItem = sub.children[0].children[0];
  assert.equal(holderItem.tagName, 'label');
  // 所持者の既定は自分（D29。前は「すべて」）
  assert.equal(holderItem.querySelector('select').value, 'mine');
  // パッシブの条件・ケーキは押しボタン（短いラベル、長い説明は title の 1 行目。2 行目はケーキの「最速」の印の説明〔D30〕）
  const label = (node) => node.textContent.replace('最速（最速）', '');
  assert.deepEqual(radioGroup(view, 'パッシブの条件').children.map((node) => [label(node), node.title]),
    [['全部持つ', '欲しいものを全部持つ（他も可）'], ['だけ', '欲しいものだけを持つ']]);
  assert.deepEqual(radioGroup(view, 'ケーキ').children.map((node) => [label(node), node.title.split('\n')[0]]),
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
  // Alice としてログインしている（所持者の既定は自分 = Alice。テストの個体はみな Alice のもの）
  const ctx = withIdeals(context(owned), owned);
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
  // 数と同じ集まりになるよう、タマゴとグローバルパルボックスを除いた場所も渡す（D27。前は場所を渡さず、開いた先にタマゴの e1 も出た）。
  // 所持者（既定の自分）も渡す
  assert.equal(holding.getAttribute('href'), '#/owned?pal=SheepBall&holder=mine&place=party%2Cpalbox%2Cbase%2Cdps%2Cunknown');
  assert.deepEqual(filterFromParams(parseHash(holding.getAttribute('href')).params).places, ['party', 'palbox', 'base', 'dps', 'unknown']);
  await pickPassive(view, 'Rare');
  assert.equal(holding.textContent, '所持 ♂1 ♀2 · 全部持つ ♂0 ♀2');
  assert.equal(holding.getAttribute('href'), '#/owned?pal=SheepBall&p=Rare&holder=mine&place=party%2Cpalbox%2Cbase%2Cdps%2Cunknown');
  // 「すべて」のときは所持者を渡さない（所持パルの URL では、所持者がなければ「すべて」）
  const holder = holderOf(view);
  holder.value = '';
  holder.dispatch('change');
  const params = parseHash(holding.getAttribute('href')).params;
  assert.deepEqual([params.get('pal'), params.get('p'), params.get('holder')], ['SheepBall', 'Rare', null]);
  assert.equal(filterFromParams(params).holder, '');
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
  const attack = input(view, '攻撃の目標（以上）');
  assert.equal(attack.value, '100');
  // 3 つとも 100 が目標なら、1 回では作れないが、子を入れ替えながら完全体を作れる。100 を 2 つ持つ m1 と組む方が完成に近い（♀ は 1 体なので 1 組）。
  // 目標に届かない個体値は読み上げで「目標 100 未満」（差の −N は D30 で出さなくした）
  assert.deepEqual(cards(view).map(talentsOf), ['HP 100・攻撃 0・防御 100・合計 200 × HP 90・攻撃 90・防御 90・合計 270']);
  assert.match(cards(view)[0].querySelectorAll('.owned-talent')[1].getAttribute('aria-label'), /^個体値 HP 90（目標 100 未満）/);
  assert.match(cards(view)[0].textContent, /完全体作成組/);
  // 目標を 90 にすると、90 どうしなら 1 回で作れて、確率も高い
  for (const label of ['HPの目標（以上）', '攻撃の目標（以上）', '防御の目標（以上）']) {
    const node = input(view, label);
    node.value = '90';
    node.dispatch('input');
  }
  assert.equal(input(view, '攻撃の目標（以上）'), attack);
  assert.deepEqual(cards(view).map(talentsOf), ['HP 90・攻撃 90・防御 90・合計 270 × HP 90・攻撃 90・防御 90・合計 270']);
  assert.match(cards(view)[0].textContent, /完全体作成組/);
  // ケーキを変えると、結果だけ計算し直す（カードは作り直し、入力欄は同じ要素）
  const before = cards(view)[0];
  chooseRadio(view, 'ケーキ', 'talent');
  assert.notEqual(cards(view)[0], before);
  assert.deepEqual(cards(view).map(talentsOf), ['HP 90・攻撃 90・防御 90・合計 270 × HP 90・攻撃 90・防御 90・合計 270']);
  assert.equal(input(view, '攻撃の目標（以上）'), attack);
  view.destroy();
  // 作り直しても、入力した条件のまま
  const again = idealView(context(owned, [], states), parseHash('#/ideal?to=SheepBall'));
  assert.equal(input(again, '攻撃の目標（以上）').value, '90');
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
  const full100 = cardText(cards(view)[0]);
  // HP のチェックを外す（数字は薄く残す）
  const hp = input(view, 'HPを条件にする');
  hp.checked = false;
  hp.dispatch('change');
  assert.equal(input(view, 'HPの目標（以上）').value, '100');
  const unchecked = cardText(cards(view)[0]);
  assert.notEqual(unchecked, full100);
  // 目標を HP 0 にして開いた画面と同じ結果
  const zero = idealView(context(owned, [], new Map([['ideal', { conditions: { holder: '', mode: 'include', targets: { hp: 0, shot: 100, defense: 100 }, cake: 'none' } }]])),
    parseHash('#/ideal?to=SheepBall'));
  assert.equal(cardText(cards(zero)[0]), unchecked);
  zero.destroy();
  // 目標として保存すると保存は 0（条件なし）のまま、保存のボタンの title と目標のダイアログの要約は「HP —」
  assert.match(saveButton(view).title, /^HP —・攻撃 100 以上・防御 100 以上/);
  saveAsGoal(view);
  assert.deepEqual(ctx.ideals.list()[0].targets, { hp: 0, shot: 100, defense: 100 });
  assert.match(openGoals(view).querySelector('.ideal-goal').textContent, /HP —・攻撃 100 以上・防御 100 以上/);
  // 「すべて 100」で全部 100 に戻す
  byLabel(view, 'すべて 100').dispatch('click');
  assert.equal(input(view, 'HPの目標（以上）').value, '100');
  assert.equal(input(view, 'HPを条件にする').checked, true);
  assert.equal(cardText(cards(view)[0]), full100);
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
  // 別の子も登録されている組は、目標が産まれるとは限らないので後ろ。親の種族は ♂♀ の行で分かる（「登録済みの配合 ◯♂ × ◯♀」の文は D30 でなくした）
  const [same, card] = cards(view);
  assert.equal(pairOf(card), 'ツッパニャン×タマコッコ');
  assert.doesNotMatch(card.textContent, /登録済みの配合/);
  assert.match(card.querySelector('.ideal-warning').textContent, /別の子も登録されています/);
  // 同じ種族どうしは、自動登録で性別が記録されていても「性別条件は未検証」を出さない。「同じ種族どうし」の文も出さない（D30）
  assert.equal(pairOf(same), 'モコロン×モコロン');
  assert.doesNotMatch(same.textContent, /同じ種族どうし/);
  assert.equal(same.querySelector('.ideal-warning'), null);
});

test('理想個体画面: 所持パル・目標がないときと、欲しいパッシブがそろわないときの案内', (t) => {
  install(t);
  const none = idealView(context(fakeOwned(null)), parseHash('#/ideal?to=SheepBall'));
  assert.match(none.element.textContent, /所持パルのデータがありません/);
  const noTarget = idealView(context(fakeOwned()), parseHash('#/ideal'));
  assert.match(noTarget.element.textContent, /目標のパルを選んでください/);
  // 候補のだれも持たないパッシブは配合では作れないので、個体値厳選組だけを並べ、そのパッシブを運ぶ継承ルートへも案内する
  const missing = idealView(context(fakeOwned()), parseHash('#/ideal?to=SheepBall&p=Legend'));
  assert.equal(missing.element.querySelector('.ideal-missing-note').querySelector('.ideal-warning').textContent, '伝説 を持つ親の候補がいません。いまは個体値厳選組だけを出しています。');
  assert.ok(cards(missing).length && cards(missing).every((card) => /個体値厳選組/.test(card.textContent)));
  const action = missing.element.querySelectorAll('a').find((node) => /伝説を運ぶ継承ルート/.test(node.textContent));
  assert.equal(action.href, '#/route?to=SheepBall&p=Legend');
  // 組が 1 つもないときは「個体値厳選組だけを出しています」とは言わない（「別に手に入れて」も言わない）
  const nothing = idealView(context(fakeOwned([])), parseHash('#/ideal?to=SheepBall&p=Legend'));
  assert.equal(nothing.element.querySelector('.ideal-missing-note').querySelector('.ideal-warning').textContent, '伝説 を持つ親の候補がいません。');
  // 足りないパッシブがなければ案内は出さない
  assert.equal(idealView(context(fakeOwned()), parseHash('#/ideal?to=SheepBall&p=Rare')).element.querySelector('.ideal-missing-note').textContent, '');
});

test('理想個体画面: 所持パルのデータがないときは 1 文と「セーブ連携を開く」（設定タブの〜とだけ書かない）、読み込み中は「所持パルを読み込み中…」（copy-dead-ends）', (t) => {
  install(t);
  const none = idealView(context(fakeOwned(null)), parseHash('#/ideal?to=SheepBall'));
  const emptyState = none.element.querySelector('.ideal-results').querySelector('.empty-state');
  assert.equal(emptyState.querySelector('p').textContent, '所持パルのデータがありません。');
  assert.equal(emptyState.querySelector('.empty-icon').getAttribute('aria-hidden'), 'true');
  const open = emptyState.querySelector('a');
  assert.equal(open.textContent, 'セーブ連携を開く');
  assert.equal(open.href, '#/settings?open=auto');
  assert.doesNotMatch(none.element.textContent, /設定タブ/);
  none.destroy();
  const owned = fakeOwned(null);
  owned.state.ready = false;
  const loading = idealView(context(owned), parseHash('#/ideal?to=SheepBall'));
  const status = loading.element.querySelector('.ideal-results').children[0];
  assert.equal(status.textContent, '所持パルを読み込み中…');
  assert.equal(status.getAttribute('role'), 'status');
  loading.destroy();
});

test('理想個体画面: 目標のパルを ♂ と ♀ で持っていないときは、次の一手に「逆引きで親を探す」と「ウィッシュリストに追加」（追加したら押せない「ウィッシュリストにあります」）', async (t) => {
  install(t);
  const wishes = [];
  const wishlist = { scope: () => 'test.仲間', list: () => wishes, add(palId) { wishes.push({ palId }); return true; } };
  const ctx = { ...context(fakeOwned([palworldPal('x1', 'PinkCat', 'Male', [], full)])), wishlist };
  const view = idealView(ctx, parseHash('#/ideal?to=SheepBall'));
  document.body.append(view.element);
  const emptyState = view.element.querySelector('.ideal-results').querySelector('.empty-state');
  assert.match(emptyState.querySelector('p').textContent, /^モコロンの ♂ と ♀（または登録済みの配合でモコロンが産まれる親の組）を所持していません。/);
  assert.ok(emptyState.querySelector('.empty-icon'));
  const reverse = emptyState.querySelector('a');
  assert.equal(reverse.textContent, '逆引きで親を探す');
  assert.equal(reverse.href, '#/reverse?c=SheepBall');
  const add = emptyState.querySelector('button');
  assert.equal(add.textContent, 'ウィッシュリストに追加');
  add.focus();
  await add.dispatch('click');
  assert.deepEqual(wishes, [{ palId: 'SheepBall' }]);
  assert.equal(add.textContent, 'ウィッシュリストにあります');
  assert.equal(add.disabled, true);
  // 押せなくする前に、隣の「逆引きで親を探す」へフォーカスを移す
  assert.equal(document.activeElement, reverse);
  view.destroy();
  // すでにあれば最初から押せない。ログインしていない（scope が空）ときは出さない
  const listed = idealView({ ...context(fakeOwned([palworldPal('x1', 'PinkCat', 'Male', [], full)])), wishlist }, parseHash('#/ideal?to=SheepBall'));
  assert.equal(listed.element.querySelector('.ideal-results').querySelector('button').disabled, true);
  listed.destroy();
  const guest = idealView({ ...context(fakeOwned([palworldPal('x1', 'PinkCat', 'Male', [], full)])), wishlist: { ...wishlist, scope: () => '' } }, parseHash('#/ideal?to=SheepBall'));
  assert.equal(guest.element.querySelector('.ideal-results').querySelector('button'), null);
  assert.ok(guest.element.querySelector('.ideal-results').querySelector('a'));
  guest.destroy();
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

test('理想個体: URL とタブの往復（確率とタマゴの数の表示は D30 でなくした）', () => {
  assert.equal(parseHash('#/ideal?to=SheepBall').view, 'ideal');
  assert.equal(buildHash('ideal', { to: 'SheepBall', p: 'Rare' }), '#/ideal?to=SheepBall&p=Rare');
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
  assert.equal(pairOf(card), 'ツッパニャン×タマコッコ');
  assert.match(card.querySelector('.ideal-warning').textContent, /性別を入れ替えた向きです/);
});

test('理想個体画面: 完全体作成組・パッシブ厳選組・個体値厳選組の順に、目的の札で別々の個体を出す（目的ごとの数字は D30 でなくした）', (t) => {
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
  assert.deepEqual(list.map(pairOf), ['モコロン×モコロン', 'ツッパニャン×タマコッコ', 'モコロン×モコロン']);
  // どの目的の組も、数値の行（完成まで・そろうまでの平均・1 個のタマゴの確率）と内訳の文は出さない。キノコケーキでも同じ（目安・上限の文もない）
  for (const card of list) assert.doesNotMatch(card.textContent, NUMBERS);
  chooseRadio(view, 'ケーキ', 'talent');
  for (const card of cards(view)) assert.doesNotMatch(card.textContent, NUMBERS);
  view.destroy();
});
test('理想個体画面: 欲しいパッシブ以外のパッシブは、確率の注記を出さず（D30）、♂♀ の行で薄くする', (t) => {
  install(t);
  const view = idealView(context(fakeOwned([
    palworldPal('m1', 'SheepBall', 'Male', ['CraftSpeed_up2']),
    palworldPal('f2', 'SheepBall', 'Female', ['Rare', 'Noukin']),
  ])), parseHash('#/ideal?to=SheepBall&p=CraftSpeed_up2,Rare'));
  const [card] = cards(view);
  assert.equal(card.querySelector('.ideal-extras'), null);
  assert.equal(card.querySelector('.ideal-notes'), null);
  assert.doesNotMatch(card.textContent, /余計なパッシブ|確率/);
  const female = card.querySelectorAll('.owned-row')[1];
  assert.deepEqual(female.querySelectorAll('.passive-chip').map((chip) => chip.className.split(' ').filter((name) => /^is-/.test(name)).join(' ')), ['is-wanted', 'is-extra']);
  view.destroy();
});

test('理想個体画面: 開いている間は 10 秒ごとに読み直し、閉じた後は読まない（D26 で 20.5 秒から 10 秒にした）', async (t) => {
  install(t);
  let release;
  const owned = fakeOwned();
  let refreshes = 0;
  owned.autoRefresh = () => { refreshes++; return Promise.resolve('skipped'); };
  owned.load = () => new Promise((resolve) => { release = resolve; });
  const view = idealView(context(owned), parseHash('#/ideal?to=SheepBall'));
  t.mock.timers.tick(10 * 1000);
  t.mock.timers.tick(10 * 1000);
  assert.equal(refreshes, 2);
  // タブが裏にある間は読まない
  document.visibilityState = 'hidden';
  t.mock.timers.tick(10 * 1000);
  assert.equal(refreshes, 2);
  document.visibilityState = 'visible';
  t.mock.timers.tick(10 * 1000);
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
  assert.equal(talentsOf(cards(view)[0]), 'HP 100・攻撃 100・防御 100・合計 300 × HP 0・攻撃 0・防御 0・合計 0');
  // 配合牧場に、3 つとも 100 のメスのタマゴが産まれた。孵化するまで牧場に置けないので、候補にしない
  const egg = palworldPal('e1', 'SheepBall', 'Female', [], { hp: 100, shot: 100, defense: 100 }, { kind: 'egg-ground', playerUid: P1 });
  owned.state.owned = fakeOwned([...list, egg]).state.owned;
  owned.emit();
  assert.deepEqual(cards(view).map(talentsOf), ['HP 100・攻撃 100・防御 100・合計 300 × HP 0・攻撃 0・防御 0・合計 0']);
  // 孵化すると、同じ個体がパルボックスのパルとして、3 つとも 100 の ♂ との組で出る
  owned.state.owned = fakeOwned([...list, { ...egg, location: { kind: 'palbox', playerUid: P1, slotIndex: 0 } }]).state.owned;
  owned.emit();
  assert.equal(talentsOf(cards(view)[0]), 'HP 100・攻撃 100・防御 100・合計 300 × HP 100・攻撃 100・防御 100・合計 300');
  // パルボックスの位置は「P1 · 1-1」と小さな図（場所の全文は title。owned-rows で前の「パルボックス 1 ページ・1 行 1 列」の文字から変えた）
  assert.ok(cards(view)[0].querySelectorAll('.owned-where').some((node) => node.title === 'パルボックス 1 ページ・1 行 1 列' && /P1 · 1-1/.test(node.textContent)));
  view.destroy();
});
test('理想個体画面: 所持者（すべて／自分のプレイヤー名／各プレイヤー）で親の候補とパッシブの所持数を絞り、既定は自分。選んだプレイヤーがいなくなったら既定（自分）に戻す（D29）', async (t) => {
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
  const holder = holderOf(view);
  // 拠点は選択肢に出さない。自分は自分のプレイヤー名に「（自分）」を付けて先頭（所持パルの所持者と同じ名前。A7）。前は「自分の個体」と
  // 「Alice（自分）」が別に並んでいた（D29）
  assert.deepEqual([...holder.children].map((option) => [option.value, option.textContent]), [['', 'すべて'], ['mine', 'Alice（自分）'], [`player:${P2}`, 'Bob']]);
  // 既定は自分
  assert.equal(holder.value, 'mine');
  assert.equal(cards(view).length, 1);
  // すべてなら ♂ 2 体・♀ 2 体で、別々の個体の組は 2 組
  holder.value = '';
  holder.dispatch('change');
  assert.equal(cards(view).length, 2);
  // 前の保存の自分の player:<uid> も自分として扱う
  for (const value of [`player:${P1}`, 'mine']) {
    holder.value = value;
    holder.dispatch('change');
    assert.deepEqual(cards(view).map((card) => card.querySelectorAll('.owned-row').map((row) => row.querySelector('.owned-where').textContent).join(' × ')),
      ['Aliceパルボックス × Aliceパルボックス']);
    const counts = await passiveOptions(view);
    assert.ok(counts.includes('希少（2）'));
    assert.ok(!counts.some((text) => /^伝説（|^脳筋（/.test(text)));
  }
  // Bob の個体は、Bob のパルボックスと Bob が預けた拠点のパル
  holder.value = `player:${P2}`;
  holder.dispatch('change');
  assert.equal(cards(view).length, 1);
  assert.match(cards(view)[0].textContent, /拠点 2/);
  view.destroy();
  // 選んだプレイヤーがデータにいなくなったら既定（自分）に戻す
  const without = list.filter((pal) => !['b1', 'c1'].includes(pal.instanceId));
  owned.state.owned = normalizeOwned(snapshotOf(without, both.slice(0, 1)), { pals, passives });
  const again = idealView(withIdeals(context(owned, [], states), owned), parseHash('#/ideal?to=SheepBall'));
  assert.equal(holderOf(again).value, 'mine');
  assert.equal(states.get('ideal').conditions.holder, 'mine');
  assert.equal(cards(again).length, 1);
  again.destroy();
});

test('理想個体画面: 自分のプレイヤーが後から分かったら（ログインの ID・ユーザーの一覧が届いた）、所持者の選択肢と結果を描き直す（既定の自分は分かるまで「すべて」。D29）', (t) => {
  install(t);
  const P2 = 'abcd1234-0000-0000-0000-000000000000';
  const list = [
    palworldPal('a1', 'SheepBall', 'Male', ['Rare']),
    palworldPal('a2', 'SheepBall', 'Female', ['Rare']),
    palworldPal('b1', 'SheepBall', 'Female', ['Legend'], full, { kind: 'palbox', playerUid: P2 }),
    palworldPal('b2', 'SheepBall', 'Male', ['Legend'], full, { kind: 'palbox', playerUid: P2 }),
  ];
  const owned = fakeOwned(list);
  owned.state.owned = normalizeOwned({ version: 1, world: { name: 'テスト', hostName: 'Alice' }, bases: [], stats: {}, pals: list,
    players: [{ uid: P1, name: 'Alice', level: 50 }, { uid: P2, name: 'Bob', level: 40 }] }, { pals, passives });
  const ctx = context(owned);
  const listeners = new Set();
  // ユーザーの一覧がまだ届いていない（ログインの ID と同じ名前のプレイヤーが分からない）
  Object.assign(ctx.store.state, { userId: 'Alice', passcode: '入力', renaming: false, users: [] });
  ctx.store.subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
  ctx.ideals = createIdealStore({ store: ctx.store, owned, storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
  const view = idealView(ctx, parseHash('#/ideal?to=SheepBall'));
  assert.equal(holderOf(view).value, '');
  assert.ok(cards(view).length > 1);
  ctx.store.state.users = ['Alice'];
  for (const listener of [...listeners]) listener(ctx.store.state);
  assert.equal(holderOf(view).value, 'mine');
  assert.deepEqual([...holderOf(view).children].map((option) => option.textContent), ['すべて', 'Alice（自分）', 'Bob']);
  assert.equal(cards(view).length, 1);
  const before = listeners.size;
  view.destroy();
  assert.ok(listeners.size < before);
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
  // 並べ方（order）は保存しない（画面の並べ方の選択はない）
  assert.deepEqual(ctx.ideals.list().map((goal) => [goal.name, goal.palId, goal.passives.join(','), goal.mode, 'order' in goal]), [['最強モコロン', 'SheepBall', 'Rare', 'include', false]]);
  // 板は閉じてボタンへフォーカスを戻す。同じ条件はもう保存できない（押せない印。フォーカスは残す）
  assert.equal(nameInput(view), undefined);
  assert.equal(document.activeElement, save);
  assert.equal(save.textContent, '★ 保存済み');
  assert.equal(save.getAttribute('aria-disabled'), 'true');
  // 押せない理由を先に、保存した条件の要約を次の行に（setDisabled の title）
  assert.equal(save.title, '同じ条件の目標があります\nHP 100 以上・攻撃 100 以上・防御 100 以上 · 欲しいものを全部持つ（他も可） · ケーキ・野菜ケーキ');
  save.dispatch('click');
  assert.equal(nameInput(view), undefined);
  assert.equal(view.element.querySelector('.ideal-goals-button').textContent, '目標（1）');
  // m1 は 3 つとも 100 で希少を持つので完成済み
  const dialog = openGoals(view);
  assert.equal(dialog.querySelector('h2').textContent, '目標');
  assert.match(dialog.querySelector('.ideal-goal').textContent, /最強モコロン.*希少.*HP 100 以上.*完成済み: Alice · パルボックス/);
  // 条件を変えると、また保存できる
  const attack = input(view, '攻撃の目標（以上）');
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
  // 見えないボタンだが、押せない理由は同じ形で持つ（setDisabled）
  assert.equal(hidden.title, '目標のパルを選ぶと保存できます');
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
  // 状態は状態のチップ（完成済みは ready、未完成は neutral。前のクラス名 ideal-goal-status は残す）
  assert.deepEqual(again.querySelectorAll('.ideal-goal-status').map((node) => node.className.split(' ').filter((name) => name.startsWith('is-'))), [['is-ready'], ['is-ready'], ['is-neutral']]);
  assert.ok(again.querySelectorAll('.ideal-goal-status').every((node) => node.className.split(' ').includes('status-chip')));
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
  assert.equal(warning.textContent, 'この端末に目標を保存できませんでした（ページを閉じると消えます）');
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
  assert.deepEqual([value('HPの目標（以上）'), value('攻撃の目標（以上）'), value('防御の目標（以上）')], ['', '100', '90']);
  assert.deepEqual(['HPを条件にする', '攻撃を条件にする', '防御を条件にする'].map((label) => input(view, label).checked), [false, true, true]);
  assert.deepEqual([chosen(view, 'パッシブの条件'), chosen(view, 'ケーキ')], ['only', 'talent']);
  assert.deepEqual(ctx.replacements, ['#/ideal?to=SheepBall&p=Rare']);
  assert.equal(saveButton(view).textContent, '★ 保存済み');
  assert.equal(saveButton(view).getAttribute('aria-disabled'), 'true');
  // 目標のダイアログの「呼び出す」は g つきのリンク
  assert.equal(openGoals(view).querySelector('.ideal-goal').querySelectorAll('a').find((node) => node.textContent === '呼び出す').href, `#/ideal?to=SheepBall&p=Rare&g=${goal.id}`);
  view.destroy();
  // 外した目標の g で開いたときは、言い方をそろえて「保存した目標が見つかりません」（A9）
  const missing = idealView(ctx, parseHash('#/ideal?to=SheepBall&g=goal-unknown'));
  assert.ok(document.body.querySelectorAll('.toast').some((node) => node.textContent === '保存した目標が見つかりません'));
  missing.destroy();
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
  assert.deepEqual([value('HPの目標（以上）'), value('攻撃の目標（以上）'), value('防御の目標（以上）')], ['', '100', '90']);
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

test('理想個体画面: 保存した目標のパッシブの組み合わせを（重複を除き新しい順に）「保存した目標の組み合わせ」に出し、押すとその組で選び直す', async (t) => {
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

test('理想個体画面: 配合では作れないパッシブ・「○○を運ぶ経路」のボタンは小さなチップで出す（余計なパッシブの注記は D30 でなくした）', (t) => {
  install(t);
  const missing = idealView(context(fakeOwned()), parseHash('#/ideal?to=SheepBall&p=Legend'));
  const warning = missing.element.querySelector('.ideal-missing-note').querySelector('.ideal-warning');
  assert.match(warning.querySelector('.passive-chip').className, /compact/);
  const action = missing.element.querySelector('.ideal-carry');
  assert.equal(action.textContent, '伝説を運ぶ継承ルート');
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
  // 行き止まりにしない: 「セーブ連携を開く」で設定のセーブ連携へ（copy-dead-ends）
  const action = dialog.querySelector('.ideal-goal-action');
  assert.equal(action.hidden, false);
  assert.equal(action.textContent, 'セーブ連携を開く');
  assert.equal(action.href, '#/settings?open=auto');
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

test('理想個体画面: パッシブの条件を満たす子が産まれないときは理由を出し、自分のプレイヤーが分からないときは「すべて」で計算する（D29）', (t) => {
  install(t);
  const owned = fakeOwned([
    palworldPal('m1', 'SheepBall', 'Male', ['Rare']),
    palworldPal('f1', 'SheepBall', 'Female', ['Rare']),
  ]);
  const view = idealView(context(owned), parseHash('#/ideal?to=SheepBall&p=Rare'));
  chooseRadio(view, 'パッシブの条件', 'only');
  chooseRadio(view, 'ケーキ', 'special');
  assert.equal(cards(view).length, 0);
  assert.match(view.element.querySelector('.ideal-results').textContent, /スペシャルケーキでは、欲しいパッシブが 4 個未満だと「欲しいものだけ」の子は産まれません。/);
  view.destroy();
  // 欲しいパッシブなしで「欲しいものだけ」（パッシブなし）は、パッシブを持つ親からは産まれない
  const none = idealView(context(owned), parseHash('#/ideal?to=SheepBall'));
  chooseRadio(none, 'パッシブの条件', 'only');
  assert.match(none.element.querySelector('.ideal-results').textContent, /パッシブを持つ親からは、パッシブのない子は産まれません/);
  none.destroy();
  // ログイン中の ID と同じ名前のプレイヤーがセーブにいない（登録者の対応もない）と、自分の選択肢は出さず「すべて」で計算する
  //（D29。前は「自分の個体」を選ぶと 0 組で「セーブのどのプレイヤーが自分か分かりません」）
  const ctx = withIdeals(context(owned), owned);
  ctx.ideals = createIdealStore({
    store: { state: { env: 'test', userId: 'Zed', passcode: '入力', renaming: false, users: ['Zed'] }, subscribe: () => () => {} },
    owned, storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  });
  const mine = idealView(ctx, parseHash('#/ideal?to=SheepBall&p=Rare'));
  assert.deepEqual([...holderOf(mine).children].map((option) => option.value), ['', `player:${P1}`]);
  assert.equal(holderOf(mine).value, '');
  assert.ok(cards(mine).length > 0);
  assert.doesNotMatch(mine.element.querySelector('.ideal-results').textContent, /分かりません/);
  mine.destroy();
});

// 牧場のテストの所持パル: m1×f1 は 3 つとも 100、m2(100,100,90)、f2(90,90,90)、m3・f3 は 0。PinkCat はほかの配合
const farmPals = () => [
  palworldPal('m1', 'SheepBall', 'Male', [], { hp: 100, shot: 100, defense: 100 }),
  palworldPal('f1', 'SheepBall', 'Female', [], { hp: 100, shot: 100, defense: 100 }),
  palworldPal('m2', 'SheepBall', 'Male', [], { hp: 100, shot: 100, defense: 90 }),
  palworldPal('f2', 'SheepBall', 'Female', [], { hp: 90, shot: 90, defense: 90 }),
  palworldPal('m3', 'SheepBall', 'Male', [], { hp: 0, shot: 0, defense: 0 }),
  palworldPal('f3', 'SheepBall', 'Female', [], { hp: 0, shot: 0, defense: 0 }),
  palworldPal('cm', 'PinkCat', 'Male', []),
  palworldPal('cf', 'PinkCat', 'Female', []),
];
const ok = (id, baseId, parents) => ({ id, baseId, parents, status: 'ok' });
const texts = (nodes) => nodes.map((node) => node.textContent);
const classes = (node) => node.className.split(' ');

test('理想個体画面: 配合牧場の組をおすすめの上から同じ数の組と比べ、そのまま・交換推奨を絵の行で出し、カードに配置中・交換先の札を付ける', (t) => {
  install(t);
  const owned = fakeOwned(farmPals());
  // 拠点 1 に牧場 2 か所（A・B）、拠点 2 に 1 か所。この目標の組は A（m1×f1 はおすすめ 1 番）と B（m3×f2 はおすすめにない）。拠点 2 の PinkCat の牧場は対象外
  owned.state.owned.bases = [{ id: 'b1', label: '拠点 1' }, { id: 'b2', label: '拠点 2' }];
  owned.state.owned.farms = [ok('A', 'b1', ['m1', 'f1']), ok('B', 'b1', ['m3', 'f2']), ok('C', 'b2', ['cm', 'cf'])];
  const view = idealView(context(owned), parseHash('#/ideal?to=SheepBall'));
  const box = view.element.querySelector('.ideal-farms');
  assert.equal(box.querySelector('h2').textContent, '配合牧場の詳細（置いている 2 か所・交換推奨 1）');
  const rows = box.querySelectorAll('.ideal-farm');
  // 同じ拠点の 2 つの牧場は「牧場 A」「牧場 B」（I-27）
  assert.deepEqual(rows.map((row) => row.querySelector('.ideal-farm-name').textContent), ['拠点 1 の牧場 A', '拠点 1 の牧場 B']);
  assert.deepEqual(rows.map((row) => row.querySelector('.ideal-farm-status').textContent), ['そのまま（おすすめ 1 番）', '交換推奨 → おすすめ 2 番']);
  // 今の 2 体は絵・名前と性別・個体値（I-28）
  assert.deepEqual(texts(rows[1].querySelector('.ideal-farm-pair').querySelectorAll('.ideal-farm-pal-name')), ['モコロン♂', 'モコロン♀']);
  assert.deepEqual(texts(rows[1].querySelector('.ideal-farm-pair').querySelectorAll('.ideal-farm-talent')), ['HP 0・攻 0・防 0', 'HP 90・攻 90・防 90']);
  // おすすめ 2 番（m2×f2）は f2 が入っている牧場に入れ、m3 と入れ替える（完成までの平均が減るので交換を勧める）。
  // 2×2 の小表（列: 今／交換後、行: ♂／♀）は、入れ替わる ♂ の行のセルに印
  const table = rows[1].querySelector('.ideal-farm-swap');
  assert.deepEqual(texts(table.querySelectorAll('th')), ['', '今', '交換後', '♂', '♀']);
  assert.deepEqual(table.querySelectorAll('td').map((cell) => [cell.className, cell.querySelector('.ideal-farm-talent').textContent]), [
    ['is-changed', 'HP 0・攻 0・防 0'], ['is-changed', 'HP 100・攻 100・防 90'], ['', 'HP 90・攻 90・防 90'], ['', 'HP 90・攻 90・防 90'],
  ]);
  // 外す・入れる個体は 1 行 1 体で、持ち主と場所つき（X-28）
  const moves = rows[1].querySelectorAll('.ideal-farm-move');
  assert.deepEqual(moves.map((move) => [move.querySelector('.ideal-farm-move-label').textContent, move.querySelector('.ideal-farm-talent').textContent,
    move.querySelector('.ideal-farm-owner').textContent, move.querySelector('.ideal-farm-place').textContent]), [
    ['外す', 'HP 0・攻 0・防 0', 'Alice', 'パルボックス'], ['入れる', 'HP 100・攻 100・防 90', 'Alice', 'パルボックス'],
  ]);
  // カードの札: 牧場の組に「拠点 1 の牧場 A に配置中」、交換先の組に「→ 拠点 1 の牧場 B へ」。境目の線はない（D14）
  assert.equal(cards(view)[0].querySelector('.ideal-placed').textContent, '拠点 1 の牧場 A に配置中');
  // 「配置中」は状態のチップ（statusChip と同じ形の info。前のクラス名 ideal-placed は残す。押すと説明が開くボタンのまま）
  assert.equal(cards(view)[0].querySelector('.ideal-placed').tagName, 'button');
  assert.ok(cards(view)[0].querySelector('.ideal-placed').className.startsWith('status-chip is-info ideal-placed'));
  assert.equal(cards(view)[0].querySelector('.ideal-farm-to'), null);
  assert.equal(cards(view)[1].querySelector('.ideal-farm-to').textContent, '→ 拠点 1 の牧場 B へ');
  assert.doesNotMatch(cards(view)[1].textContent, /配置中/);
  assert.equal(view.element.querySelector('.ideal-farm-boundary'), null);
  view.destroy();
  // 牧場の情報がない（牧場を共有する前の）データなら、帯も詳細も出さず、「変更あり」も付けない
  owned.state.owned.farms = null;
  const plain = idealView(context(owned), parseHash('#/ideal?to=SheepBall'));
  assert.equal(plain.element.querySelector('.ideal-farm-strip').hidden, true);
  assert.equal(plain.element.querySelector('.ideal-farms').textContent, '');
  assert.equal(plain.element.querySelectorAll('.ideal-changed').length, 0);
  // 所持パルのデータがなくなったら、前の判定を残さない
  owned.state.owned = { ...owned.state.owned, farms: [{ id: 'A', baseId: '', parents: ['m1', 'f1'] }] };
  owned.emit();
  assert.equal(plain.element.querySelector('.ideal-farm-strip').hidden, false);
  assert.notEqual(plain.element.querySelector('.ideal-farms').textContent, '');
  owned.state.owned = null;
  owned.emit();
  assert.equal(plain.element.querySelector('.ideal-farm-strip').hidden, true);
  assert.equal(plain.element.querySelector('.ideal-farm-strip').children.length, 0);
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
  assert.equal(talentsOf(cards(view)[0]), 'HP 97・攻撃 99・防御 96・合計 292 × HP 100・攻撃 14・防御 96・合計 210');
  assert.equal(cards(view)[0].querySelector('.ideal-farm-to').textContent, '→ 拠点の牧場へ');
  const row = view.element.querySelector('.ideal-farm');
  assert.equal(row.querySelector('.ideal-farm-status').textContent, '交換推奨 → おすすめ 1 番');
  assert.deepEqual(row.querySelectorAll('.ideal-farm-move').map((move) => [move.querySelector('.ideal-farm-move-label').textContent,
    move.querySelector('.ideal-farm-pal-name').textContent, move.querySelector('.ideal-farm-talent').textContent, move.querySelector('.ideal-farm-owner').textContent]), [
    ['外す', 'ゴウカブキ♀', 'HP 97・攻 99・防 96', 'Alice'], ['入れる', 'ゴウカブキ♀', 'HP 100・攻 14・防 96', 'Alice'],
  ]);
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
  // 交換推奨が 0 のときは見出しに数を出さない（D27）
  assert.equal(box().querySelector('h2').textContent, '配合牧場の詳細（置いている 2 か所）');
  const rows = () => box().querySelectorAll('.ideal-farm');
  assert.match(rows()[1].textContent, /そのまま（おすすめ 2 番）/);
  // 牧場の組が同点の中で先に並ぶ（同じ拠点の 2 か所なので A・B）
  assert.equal(cards(view)[1].querySelector('.ideal-placed').textContent, '拠点の牧場 B に配置中');
  // 個体値の期待値だけが高い同点の ♀（99,99,99。100 には届かない）を孵化させて受け取っても、入れ替えを勧めず「変更あり」も付けない
  owned.state.owned = fakeOwned([...list, palworldPal('f9', 'SheepBall', 'Female', [], { hp: 99, shot: 99, defense: 99 })]).state.owned;
  owned.state.owned.farms = farms;
  owned.emit();
  // 交換推奨が 0 のときは見出しに数を出さない（D27）
  assert.equal(box().querySelector('h2').textContent, '配合牧場の詳細（置いている 2 か所）');
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
  assert.equal(box.querySelector('h2').textContent, '配合牧場の詳細（置いている 2 か所）');
  // 今の組はどちらもおすすめの一覧にない（m1・f2・m2・f1 は上の 2 組で使う）ので、チップは「そのまま（おすすめにない組）」で押せない。
  // 前はチップの下の行に「おすすめの一覧にない組 · 完成まで 平均 約 N 個」（D15）を出していたが、数字とその行は D30 でなくした
  const rows = box.querySelectorAll('.ideal-farm');
  assert.deepEqual(rows.map((row) => [row.querySelector('.ideal-farm-status').textContent, row.querySelector('.ideal-farm-reason').textContent]), [
    ['そのまま（おすすめにない組）', '入れ替えても全体の速さの目安が上がりません'],
    ['そのまま（おすすめにない組）', '入れ替えても全体の速さの目安が上がりません'],
  ]);
  assert.equal(box.querySelector('.ideal-farm-measure'), null);
  assert.doesNotMatch(box.textContent, /平均|約 [\d,.]+ 個|\d%/);
  for (const row of rows) {
    assert.equal(row.querySelector('.ideal-farm-main').tagName, 'div');
    assert.equal(row.querySelectorAll('button').length, 0);
    assert.doesNotMatch(row.textContent, /外す|入れる/);
  }
  // 帯は番号なしの「✓ そのまま」で、押せない
  assert.deepEqual(view.element.querySelector('.ideal-farm-strip').querySelectorAll('.ideal-farm-cell')
    .map((cell) => [cell.tagName, cell.querySelector('.ideal-farm-cell-state').textContent]), [['div', '✓ そのまま'], ['div', '✓ そのまま']]);
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
  assert.match(talentsOf(cards(view)[0]), /HP 100・攻撃 100・防御 100・合計 300$/);
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

test('理想個体画面: 牧場の帯（1 行）と詳細の行を押すと、data-key で該当の組のカードへ移り、1 秒光る（作り直しても付け直す・動きを減らす設定では動かさずに移る）', (t) => {
  installDom(t);
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const scrolled = t.mock.method(FakeElement.prototype, 'scrollIntoView');
  const owned = fakeOwned(farmPals());
  owned.state.owned.farms = [ok('A', '', ['m1', 'f1']), ok('B', '', ['m3', 'f2'])];
  const view = idealView(context(owned), parseHash('#/ideal?to=SheepBall'));
  const strip = view.element.querySelector('.ideal-farm-strip');
  assert.equal(strip.hidden, false);
  assert.equal(strip.getAttribute('aria-label'), '配合牧場の判定');
  const cells = strip.querySelectorAll('.ideal-farm-cell');
  assert.deepEqual(cells.map((cell) => [cell.tagName, cell.querySelector('.ideal-farm-cell-name').textContent, cell.querySelector('.ideal-farm-cell-state').textContent]), [
    ['button', '拠点の牧場 A', '✓ 1 番'], ['button', '拠点の牧場 B', '⇄ 2 番へ'],
  ]);
  // 帯の絵は ♂ と ♀ の 2 体（性別の印つき）
  assert.deepEqual(texts(cells[1].querySelectorAll('.gender')), ['♂', '♀']);
  assert.equal(cells[1].getAttribute('aria-label'), '拠点の牧場 B（モコロン♂＋モコロン♀）: 交換推奨 → おすすめ 2 番。押すとその組へ移ります');
  // カードは ♂ と ♀ の個体 ID で探せる
  assert.deepEqual(cards(view).map((card) => card.getAttribute('data-key')), ['m1|f1', 'm2|f2', 'm3|f3']);
  cells[1].dispatch('click');
  assert.equal(scrolled.mock.callCount(), 1);
  assert.equal(scrolled.mock.calls[0].this, cards(view)[1]);
  assert.deepEqual(scrolled.mock.calls[0].arguments, [{ block: 'center', behavior: 'smooth' }]);
  assert.ok(classes(cards(view)[1]).includes('is-flash'));
  // 光っている間に結果を作り直しても（計算に効かない値だけが変わった読み直し）、新しいカードに付け直す
  const before = cards(view)[1];
  owned.state.owned = { ...owned.state.owned, pals: owned.state.owned.pals.map((pal) => ({ ...pal, level: pal.level + 1 })) };
  owned.emit();
  assert.notEqual(cards(view)[1], before);
  assert.ok(classes(cards(view)[1]).includes('is-flash'));
  // 1 秒で消える
  t.mock.timers.tick(1000);
  assert.ok(!classes(cards(view)[1]).includes('is-flash'));
  // 詳細の行（上の段のボタン）も押すとそのカードへ。動きを減らす設定では、なめらかに動かさない
  globalThis.matchMedia = (query) => ({ matches: query === '(prefers-reduced-motion: reduce)' });
  t.after(() => { delete globalThis.matchMedia; });
  const main = view.element.querySelectorAll('.ideal-farm')[0].querySelector('.ideal-farm-main');
  assert.equal(main.tagName, 'button');
  main.dispatch('click');
  assert.equal(scrolled.mock.calls.at(-1).this, cards(view)[0]);
  assert.deepEqual(scrolled.mock.calls.at(-1).arguments, [{ block: 'center', behavior: 'auto' }]);
  assert.ok(classes(cards(view)[0]).includes('is-flash'));
  view.destroy();
});

test('理想個体画面: 牧場の帯は、この目標の組を置いた牧場があるときだけ出し、ないときは文も出さず場所も取らない（D30）。入り切らない分は「ほか n か所」', (t) => {
  install(t);
  const scrolled = t.mock.method(FakeElement.prototype, 'scrollIntoView');
  const owned = fakeOwned(farmPals());
  owned.state.owned.farms = [];
  const view = idealView(context(owned), parseHash('#/ideal'));
  const strip = view.element.querySelector('.ideal-farm-strip');
  const box = view.element.querySelector('.ideal-farms');
  assert.equal(strip.hidden, true);
  // この目標の組を置いた牧場がない: 帯も詳細も出さない（前は「この目標の組を置いた牧場はありません」と出して場所を残した）
  view.applyRoute(parseHash('#/ideal?to=SheepBall'));
  assert.equal(strip.hidden, true);
  assert.equal(strip.textContent, '');
  assert.equal(box.hidden, true);
  assert.equal(box.textContent, '');
  // 牧場に置いたことがセーブから分かったら出す。外したら、また隠す
  owned.state.owned = { ...owned.state.owned, farms: [ok('A', '', ['m1', 'f1'])] };
  owned.emit();
  assert.equal(strip.hidden, false);
  assert.equal(strip.querySelectorAll('.ideal-farm-cell').length, 1);
  assert.equal(box.hidden, false);
  owned.state.owned = { ...owned.state.owned, farms: [] };
  owned.emit();
  assert.equal(strip.hidden, true);
  assert.equal(box.hidden, true);
  view.destroy();
  // 4 か所あれば、帯は 3 か所まで並べ、残りは「ほか 1 か所」（押すと下の詳細へ）
  const many = fakeOwned([...farmPals(),
    palworldPal('m4', 'SheepBall', 'Male', [], { hp: 50, shot: 50, defense: 50 }), palworldPal('f4', 'SheepBall', 'Female', [], { hp: 50, shot: 50, defense: 50 })]);
  many.state.owned.farms = [ok('A', '', ['m1', 'f1']), ok('B', '', ['m2', 'f2']), ok('C', '', ['m3', 'f3']), ok('D', '', ['m4', 'f4'])];
  const full4 = idealView(context(many), parseHash('#/ideal?to=SheepBall'));
  const strip4 = full4.element.querySelector('.ideal-farm-strip');
  assert.equal(strip4.querySelectorAll('.ideal-farm-cell').length, 3);
  const more = strip4.querySelector('.ideal-farm-more');
  assert.equal(more.textContent, 'ほか 1 か所');
  // 詳細は既定で閉じているので、「ほか n か所」は詳細を開いてから移る（D22）
  assert.equal(full4.element.querySelector('.ideal-farms-fold').open, false);
  more.dispatch('click');
  assert.equal(scrolled.mock.calls.at(-1).this, full4.element.querySelector('.ideal-farms'));
  assert.equal(full4.element.querySelector('.ideal-farms').querySelectorAll('.ideal-farm').length, 4);
  assert.equal(full4.element.querySelector('.ideal-farms-fold').open, true);
  full4.destroy();
});

test('理想個体画面: 配合牧場の詳細は既定で閉じた 1 行（見出しだけ）で出し、開閉を viewState に残す。再計算や判定が変わっても閉じず、出すものがないときは隠す（D22・D30）', (t) => {
  install(t);
  const owned = fakeOwned(farmPals());
  owned.state.owned.farms = [ok('A', '', ['m1', 'f1']), ok('B', '', ['m3', 'f2'])];
  const states = new Map();
  const view = idealView(context(owned, [], states), parseHash('#/ideal?to=SheepBall'));
  const box = view.element.querySelector('.ideal-farms');
  const fold = box.querySelector('.ideal-farms-fold');
  // 詳細は details で、既定は閉じる。summary は見出しの文だけ（中身は閉じていても DOM にある）
  assert.equal(fold.tagName, 'details');
  assert.equal(fold.open, false);
  const head = fold.children[0];
  assert.equal(head.tagName, 'summary');
  assert.equal(head.textContent, '配合牧場の詳細（置いている 2 か所・交換推奨 1）');
  assert.equal(head.querySelector('h2').textContent, head.textContent);
  assert.equal(head.querySelectorAll('.ideal-farm').length, 0);
  assert.equal(fold.querySelectorAll('.ideal-farm').length, 2);
  // 帯から組へ移るときは、詳細を開かない
  view.element.querySelector('.ideal-farm-strip').querySelectorAll('.ideal-farm-cell')[1].dispatch('click');
  assert.equal(fold.open, false);
  assert.equal(states.get('ideal').farmsOpen, undefined);
  // 開くと viewState に残す
  fold.open = true;
  fold.dispatch('toggle');
  assert.equal(states.get('ideal').farmsOpen, true);
  // 計算に効かない値だけが変わった読み直し（描き直し）でも、同じ要素のまま開いている
  owned.state.owned = { ...owned.state.owned, pals: owned.state.owned.pals.map((pal) => ({ ...pal, level: pal.level + 1 })) };
  owned.emit();
  assert.equal(box.querySelector('.ideal-farms-fold'), fold);
  assert.equal(fold.open, true);
  // 判定が変わっても（牧場 B に 2 番の組を置いた → 交換推奨 0）、閉じない
  owned.state.owned = { ...owned.state.owned, farms: [ok('A', '', ['m1', 'f1']), ok('B', '', ['m2', 'f2'])] };
  owned.emit();
  assert.equal(box.querySelector('.ideal-farms-fold'), fold);
  assert.equal(fold.open, true);
  // 交換推奨が 0 のときは数を出さない（D27。閉じた 1 行は短く、判定は帯で見える）
  assert.equal(fold.children[0].textContent, '配合牧場の詳細（置いている 2 か所）');
  // この目標の組を置いた牧場も空き牧場もなくなったら、帯も詳細も隠す（D30。前は帯と 1 行の場所を残した）。戻れば開いたまま
  owned.state.owned = { ...owned.state.owned, farms: [ok('C', '', ['cm', 'cf'])] };
  owned.emit();
  assert.equal(box.hidden, true);
  assert.equal(box.children.length, 0);
  assert.equal(box.textContent, '');
  assert.equal(view.element.querySelector('.ideal-farm-strip').hidden, true);
  owned.state.owned = { ...owned.state.owned, farms: [ok('A', '', ['m1', 'f1']), ok('B', '', ['m3', 'f2'])] };
  owned.emit();
  assert.equal(box.querySelector('.ideal-farms-fold'), fold);
  assert.equal(fold.open, true);
  view.destroy();
  // タブを切り替えて戻っても開いたまま。閉じれば、次も閉じている
  const again = idealView(context(owned, [], states), parseHash('#/ideal?to=SheepBall'));
  const reopened = again.element.querySelector('.ideal-farms-fold');
  assert.equal(reopened.open, true);
  reopened.open = false;
  reopened.dispatch('toggle');
  assert.equal(states.get('ideal').farmsOpen, false);
  again.destroy();
  const closed = idealView(context(owned, [], states), parseHash('#/ideal?to=SheepBall'));
  assert.equal(closed.element.querySelector('.ideal-farms-fold').open, false);
  // 目標を選んでいない・牧場の情報がないときは、場所も取らない
  closed.applyRoute(parseHash('#/ideal'));
  assert.equal(closed.element.querySelector('.ideal-farms').hidden, true);
  closed.destroy();
  owned.state.owned = { ...owned.state.owned, farms: null };
  const plain = idealView(context(owned, [], new Map()), parseHash('#/ideal?to=SheepBall'));
  assert.equal(plain.element.querySelector('.ideal-farms').hidden, true);
  plain.destroy();
});

test('理想個体画面: 読めない牧場が 1 つでもあれば、交換推奨・空き牧場・使用中の判定を保留して理由を出す（配置中の札は出す）', (t) => {
  install(t);
  const owned = fakeOwned(farmPals());
  // 拠点 1 の C は親が読めない。m2 は空いている牧場 E と、ほかの配合の牧場 F にも入っている
  owned.state.owned.bases = [{ id: 'b1', label: '拠点 1' }];
  owned.state.owned.farms = [
    ok('A', 'b1', ['m1', 'f1']), ok('B', 'b1', ['m3', 'f2']), { id: 'C', baseId: 'b1', parents: ['m2'], status: 'uncertain' },
    ok('E', 'b1', []), ok('F', 'b1', ['cm', 'f3']),
  ];
  const view = idealView(context(owned), parseHash('#/ideal?to=SheepBall'));
  const strip = view.element.querySelector('.ideal-farm-strip');
  assert.equal(strip.textContent, '牧場の判定を保留（読めない牧場が 1 か所あります）');
  assert.equal(strip.querySelectorAll('.ideal-farm-cell').length, 0);
  const box = view.element.querySelector('.ideal-farms');
  // 見出しに交換推奨・空きを出さない。理由の 1 行
  assert.equal(box.querySelector('h2').textContent, '配合牧場の詳細（置いている 2 か所）');
  assert.equal(box.querySelector('.ideal-farm-pending').textContent, '読めない牧場が 1 か所あるため、交換推奨・空き牧場・使用中の判定を保留しています');
  // 行は今の組の絵だけ。状態は「判定を保留」で、押せない。2×2・入れる／外す・空き牧場の案内はない
  const rows = box.querySelectorAll('.ideal-farm');
  assert.deepEqual(rows.map((row) => [row.className, row.querySelector('.ideal-farm-status').textContent]), [
    ['ideal-farm pending', '判定を保留'], ['ideal-farm pending', '判定を保留'],
  ]);
  assert.equal(box.querySelectorAll('button').length, 0);
  assert.equal(box.querySelector('.ideal-farm-swap'), null);
  assert.equal(box.querySelector('.ideal-farm-move'), null);
  assert.equal(box.querySelector('.ideal-farm-empty'), null);
  // セーブの事実の「配置中」は出し、交換先の札・使用中の印は出さない
  assert.equal(cards(view)[0].querySelector('.ideal-placed').textContent, '拠点 1 の牧場 A に配置中');
  assert.equal(view.element.querySelector('.ideal-farm-to'), null);
  assert.equal(view.element.querySelector('.badge-mark'), null);
  // 読めるようになったら、判定・空き・使用中が出る
  owned.state.owned = { ...owned.state.owned, farms: owned.state.owned.farms.map((farm) => ({ ...farm, status: 'ok' })) };
  owned.emit();
  assert.equal(view.element.querySelector('.ideal-farm-pending'), null);
  assert.match(view.element.querySelector('.ideal-farms').querySelector('h2').textContent, /・交換推奨 1・空き 2）$/);
  assert.ok(view.element.querySelector('.ideal-farm-to'));
  assert.ok(view.element.querySelector('.badge-mark'));
  view.destroy();
});

test('理想個体画面: 判定を保留している間は「変更あり」の札と件数の文を出さない（D13）。読めるようになれば戻る', (t) => {
  install(t);
  const list = [
    palworldPal('m1', 'SheepBall', 'Male', [], { hp: 90, shot: 90, defense: 90 }),
    palworldPal('f1', 'SheepBall', 'Female', [], { hp: 90, shot: 90, defense: 90 }),
  ];
  const owned = fakeOwned(list);
  const farms = [{ id: 'A', baseId: '', parents: ['m1', 'f1'] }];
  owned.state.owned.farms = farms;
  const view = idealView(context(owned, [], new Map()), parseHash('#/ideal?to=SheepBall'));
  // 3 つとも 100 の ♀ を孵化させて受け取った（牧場はそのまま）。交換推奨の行き先に「変更あり」
  const hatched = palworldPal('f9', 'SheepBall', 'Female', [], { hp: 100, shot: 100, defense: 100 });
  owned.state.owned = fakeOwned([...list, hatched]).state.owned;
  owned.state.owned.farms = farms;
  owned.emit();
  assert.equal(view.element.querySelectorAll('.ideal-changed').length, 1);
  assert.ok(view.element.querySelector('.ideal-changed-note'));
  // 「変更あり」は状態のチップの warning（tertiary は primary と同じ色で「完成済み」などの ready と見分けられないため）
  assert.ok(view.element.querySelector('.ideal-changed').className.startsWith('status-chip is-warning ideal-changed'));
  // ほかの牧場が読めなくなった（この目標の牧場は同じ）。保留中は「変更あり」も件数の文も出さない
  owned.state.owned = { ...owned.state.owned, farms: [...farms, { id: 'U', baseId: '', parents: [], status: 'uncertain' }] };
  owned.emit();
  assert.equal(view.element.querySelectorAll('.ideal-changed').length, 0);
  assert.equal(view.element.querySelector('.ideal-changed-note'), null);
  assert.equal(view.element.querySelector('.ideal-farm-strip').textContent, '牧場の判定を保留（読めない牧場が 1 か所あります）');
  // 読めるようになれば（牧場の中身は変わっていないので、基準はそのまま）戻る
  owned.state.owned = { ...owned.state.owned, farms };
  owned.emit();
  assert.equal(view.element.querySelectorAll('.ideal-changed').length, 1);
  assert.ok(view.element.querySelector('.ideal-changed-note'));
  view.destroy();
});

test('理想個体画面: 空き牧場には、牧場に残す組・交換先の組の個体を使わないおすすめの組を、空きの数だけ案内し、押すと（畳まれていれば開いて）その組へ移る（D16）。所持者がすべて・自分のときに出す（D30）', (t) => {
  install(t);
  const scrolled = t.mock.method(FakeElement.prototype, 'scrollIntoView');
  const same = { hp: 100, shot: 50, defense: 100 };
  const zero = { hp: 0, shot: 0, defense: 0 };
  const list = [
    ...['1', '2', '3'].flatMap((n) => [palworldPal(`m${n}`, 'SheepBall', 'Male', [], same), palworldPal(`f${n}`, 'SheepBall', 'Female', [], same)]),
    palworldPal('m4', 'SheepBall', 'Male', [], zero), palworldPal('f4', 'SheepBall', 'Female', [], zero),
  ];
  // 牧場 A に 1 番（そのまま）。拠点 1 の E は空き、拠点 2 の G は親が 1 体だけ（空き）
  const owned = fakeOwned(list);
  owned.state.owned.bases = [{ id: 'b1', label: '拠点 1' }, { id: 'b2', label: '拠点 2' }];
  owned.state.owned.farms = [ok('A', 'b1', ['m1', 'f1']), ok('E', 'b1', []), ok('G', 'b2', ['m4'])];
  const view = idealView(context(owned, [], new Map()), parseHash('#/ideal?to=SheepBall&p=Legend'));
  const box = view.element.querySelector('.ideal-farms');
  assert.equal(box.querySelector('h2').textContent, '配合牧場の詳細（置いている 1 か所・空き 2）');
  // 1 番（m1×f1）は牧場 A に残るので案内しない。2 番・3 番は同じ見込みで畳まれている
  const note = box.querySelector('.ideal-farm-empty');
  assert.equal(note.textContent, '空き 2 か所（拠点 1・拠点 2）。空いた牧場に置くなら おすすめ 2 番・3 番');
  const picks = note.querySelectorAll('.ideal-farm-pick');
  assert.deepEqual(picks.map((pick) => pick.getAttribute('aria-label')), ['おすすめ 2 番の組へ移る', 'おすすめ 3 番の組へ移る']);
  const fold = view.element.querySelector('.ideal-same');
  assert.equal(fold.open, false);
  picks[0].dispatch('click');
  assert.equal(fold.open, true);
  assert.equal(scrolled.mock.calls.at(-1).this, cards(view)[1]);
  assert.equal(cards(view)[1].parentElement, fold);
  view.destroy();
  // 所持者が自分（既定。Alice としてログイン）でも案内する（D30。D29 で既定が自分になり、前は「すべて」を選ばないと出なかった）
  const mine = idealView(withIdeals(context(owned, [], new Map()), owned), parseHash('#/ideal?to=SheepBall&p=Legend'));
  assert.equal(holderOf(mine).value, 'mine');
  assert.equal(mine.element.querySelector('.ideal-farm-empty').textContent, '空き 2 か所（拠点 1・拠点 2）。空いた牧場に置くなら おすすめ 2 番・3 番');
  assert.match(mine.element.querySelector('.ideal-farms').querySelector('h2').textContent, /・空き 2）$/);
  mine.destroy();
  // ほかのプレイヤー（1 人）で絞っているときは、空き牧場を案内しない（その人の個体の組を案内することになるため）
  const states = new Map([['ideal', { conditions: { holder: `player:${P1}`, mode: 'include', targets: { ...full }, cake: 'none' } }]]);
  const other = idealView(context(owned, [], states), parseHash('#/ideal?to=SheepBall&p=Legend'));
  assert.equal(other.element.querySelector('.ideal-farm-empty'), null);
  assert.doesNotMatch(other.element.querySelector('.ideal-farms').querySelector('h2').textContent, /空き/);
  other.destroy();
  // この目標の組を置いた牧場がなくても、空きがあれば詳細に数と案内を出す（帯は出さない。D30）
  owned.state.owned.farms = [ok('E', 'b1', [])];
  const empty = idealView(context(owned, [], new Map()), parseHash('#/ideal?to=SheepBall&p=Legend'));
  assert.equal(empty.element.querySelector('.ideal-farm-strip').hidden, true);
  assert.equal(empty.element.querySelector('.ideal-farms').querySelector('h2').textContent, '配合牧場の詳細（置いている 0 か所・空き 1）');
  assert.equal(empty.element.querySelector('.ideal-farm-empty').textContent, '空き 1 か所（拠点 1）。空いた牧場に置くなら おすすめ 1 番');
  empty.destroy();
  // 組が 1 つもない目標（♂ だけ）では、案内する組がないので空き牧場も出さない（詳細ごと隠れる）
  const males = fakeOwned([palworldPal('m1', 'SheepBall', 'Male', []), palworldPal('m2', 'SheepBall', 'Male', [])]);
  males.state.owned.farms = [ok('E', '', [])];
  const none = idealView(context(males, [], new Map()), parseHash('#/ideal?to=SheepBall'));
  assert.equal(cards(none).length, 0);
  assert.equal(none.element.querySelector('.ideal-farm-empty'), null);
  assert.equal(none.element.querySelector('.ideal-farms').hidden, true);
  none.destroy();
});

test('理想個体画面: 交換を見送った牧場の組（そのまま）の個体を使う組は、空き牧場に案内しない', (t) => {
  install(t);
  // A（m1×f1）と B（m2×f2）は入れ替えると全体で遅くなるので「そのまま」。おすすめの 1 番 m1×f2・2 番 m2×f1 は、その個体を使う
  const owned = fakeOwned([
    palworldPal('m1', 'SheepBall', 'Male', [], { hp: 100, shot: 100, defense: 100 }),
    palworldPal('m2', 'SheepBall', 'Male', [], { hp: 100, shot: 100, defense: 0 }),
    palworldPal('f1', 'SheepBall', 'Female', [], { hp: 100, shot: 0, defense: 0 }),
    palworldPal('f2', 'SheepBall', 'Female', [], { hp: 100, shot: 0, defense: 100 }),
    palworldPal('m5', 'SheepBall', 'Male', [], { hp: 0, shot: 0, defense: 0 }),
    palworldPal('f5', 'SheepBall', 'Female', [], { hp: 0, shot: 0, defense: 0 }),
  ]);
  owned.state.owned.farms = [ok('A', '', ['m1', 'f1']), ok('B', '', ['m2', 'f2']), ok('E', '', [])];
  const view = idealView(context(owned, [], new Map()), parseHash('#/ideal?to=SheepBall'));
  assert.deepEqual(view.element.querySelectorAll('.ideal-farm').map((row) => row.querySelector('.ideal-farm-status').textContent), ['そのまま（おすすめにない組）', 'そのまま（おすすめにない組）']);
  assert.deepEqual(cards(view).map((card) => card.getAttribute('data-key')).slice(0, 3), ['m1|f2', 'm2|f1', 'm5|f5']);
  assert.equal(view.element.querySelector('.ideal-farm-empty').textContent, '空き 1 か所（拠点）。空いた牧場に置くなら おすすめ 3 番');
  view.destroy();
});

test('理想個体画面: 別の配合牧場に入っている親に「別の配合牧場で使用中」の印（カードの行と入れる個体の行）。自分の個体の行は太字', (t) => {
  install(t);
  const owned = fakeOwned([
    palworldPal('m1', 'SheepBall', 'Male', [], { hp: 100, shot: 100, defense: 100 }),
    palworldPal('f1', 'SheepBall', 'Female', [], { hp: 100, shot: 100, defense: 100 }),
    palworldPal('m2', 'SheepBall', 'Male', [], { hp: 90, shot: 90, defense: 90 }),
    palworldPal('f2', 'SheepBall', 'Female', [], { hp: 90, shot: 90, defense: 90 }),
    palworldPal('m3', 'SheepBall', 'Male', [], { hp: 0, shot: 0, defense: 0 }),
    palworldPal('cf', 'PinkCat', 'Female', []),
  ]);
  // A（m3×f1）はこの目標の牧場。B（m1×PinkCat）はほかの配合の牧場
  owned.state.owned.farms = [ok('A', '', ['m3', 'f1']), ok('B', '', ['m1', 'cf'])];
  const view = idealView(withIdeals(context(owned), owned), parseHash('#/ideal?to=SheepBall'));
  const [first] = cards(view);
  assert.equal(first.getAttribute('data-key'), 'm1|f1');
  const [male, female] = first.querySelectorAll('.owned-row');
  assert.deepEqual(texts(male.querySelectorAll('.badge-mark')), ['別の配合牧場で使用中（拠点の牧場 B）']);
  assert.deepEqual(texts(female.querySelectorAll('.badge-mark')), []);
  // カードの行の印は今までどおり名前の下（バッジの 1 行）。所持パルの一覧の下の段（D25）は作らない（カードの行は 64px のまま）
  assert.deepEqual(texts(male.querySelector('.owned-badges').querySelectorAll('.badge-mark')), ['別の配合牧場で使用中（拠点の牧場 B）']);
  assert.equal(male.querySelector('.owned-band'), null);
  // 牧場 A は m3 を外して m1 を入れる。入れる m1 にも印。自分（Alice）の個体の行は太字（is-mine）
  const moves = view.element.querySelectorAll('.ideal-farm-move');
  assert.deepEqual(moves.map((move) => [move.className, texts(move.querySelectorAll('.badge-mark'))]), [
    ['ideal-farm-move out is-mine', []], ['ideal-farm-move in is-mine', ['別の配合牧場で使用中（拠点の牧場 B）']],
  ]);
  view.destroy();
});

test('理想個体画面: 2 体の持ち主が違う組に「◯◯・◯◯ の個体」の札（拠点のパルは預けた人。分からなければ出さない）', async (t) => {
  install(t);
  const owned = fakeOwned([
    palworldPal('m1', 'SheepBall', 'Male', [], full), palworldPal('f1', 'SheepBall', 'Female', [], full),
    palworldPal('m2', 'SheepBall', 'Male', [], { hp: 90, shot: 90, defense: 90 }), palworldPal('f2', 'SheepBall', 'Female', [], { hp: 90, shot: 90, defense: 90 }),
  ]);
  const byId = new Map(owned.state.owned.pals.map((pal) => [pal.id, pal]));
  Object.assign(byId.get('f1'), { holder: 'Carol' });
  // 拠点のパルは預けた人（lastOwner）。預けた人が分からなければ出さない
  Object.assign(byId.get('m2'), { place: 'base', holder: '拠点 1', lastOwner: 'Bob' });
  Object.assign(byId.get('f2'), { place: 'base', holder: '拠点 1', lastOwner: '' });
  const view = idealView(context(owned), parseHash('#/ideal?to=SheepBall'));
  const owners = cards(view)[0].querySelector('.ideal-owners');
  assert.equal(owners.tagName, 'button');
  assert.equal(owners.textContent, 'Alice・Carol の個体');
  await owners.dispatch('click');
  assert.equal(document.body.querySelectorAll('.hint-popover')[0].textContent, '♂ は Alice、♀ は Carol の個体です（拠点のパルは預けた人）。');
  assert.equal(cards(view)[1].querySelector('.ideal-owners'), null);
  view.destroy();
});

test('理想個体画面: 交換を見送った「そのまま」で、今の組がおすすめの一覧にあれば番号を付けて押せる（D15）', (t) => {
  install(t);
  const scrolled = t.mock.method(FakeElement.prototype, 'scrollIntoView');
  // 条件は HP 90 以上と欲しいパッシブ（希少）。希少を持つのは pm だけで、1 番の m1×f1 は個体値はそろう（個体値厳選組の 1 番）が
  // パッシブがそろわず完成しない（1 個のタマゴで完成する確率 0）。牧場の pm×cf（登録済みの配合）は HP が乱数しだいで 90 以上に
  // なりうる（確率 約 3.6%）ので、入れ替えると全体の速さの目安が下がる
  const owned = fakeOwned([
    palworldPal('m1', 'SheepBall', 'Male', [], full), palworldPal('f1', 'SheepBall', 'Female', [], full),
    palworldPal('pm', 'PinkCat', 'Male', ['Rare'], { hp: 80, shot: 0, defense: 0 }), palworldPal('cf', 'ChickenPal', 'Female', [], { hp: 80, shot: 0, defense: 0 }),
  ]);
  const records = [{ id: 'r1', parent1Id: 'PinkCat', parent2Id: 'ChickenPal', childId: 'SheepBall', parent1Gender: '', parent2Gender: '' }];
  owned.state.owned.farms = [ok('A', '', ['pm', 'cf'])];
  const states = new Map([['ideal', { conditions: { holder: '', mode: 'include', targets: { hp: 90, shot: 0, defense: 0 }, cake: 'none' } }]]);
  const view = idealView(context(owned, records, states), parseHash('#/ideal?to=SheepBall&p=Rare'));
  assert.deepEqual(cards(view).map((card) => card.getAttribute('data-key')), ['m1|f1', 'pm|cf']);
  const row = view.element.querySelector('.ideal-farm');
  assert.equal(row.querySelector('.ideal-farm-status').textContent, 'そのまま（おすすめ 2 番）');
  assert.equal(row.querySelector('.ideal-farm-reason').textContent, '入れ替えても全体の速さの目安が上がりません');
  assert.equal(row.querySelector('.ideal-farm-measure'), null);
  assert.equal(view.element.querySelector('.ideal-farm-cell').querySelector('.ideal-farm-cell-state').textContent, '✓ 2 番');
  row.querySelector('.ideal-farm-main').dispatch('click');
  assert.equal(scrolled.mock.calls.at(-1).this, cards(view)[1]);
  view.destroy();
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
  const holding = view.element.querySelector('.ideal-holding').textContent;
  view.update();
  owned.emit();
  assert.equal(cards(view)[0], card);
  assert.equal(view.element.querySelector('.ideal-holding').textContent, holding);
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
  const hp = input(view, 'HPの目標（以上）');
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
  const holding = view.element.querySelector('.ideal-holding').textContent;
  // 条件を 2 回続けて変える。計算している間は前の結果（カード・所持の状況）を残し、最後の条件の結果だけを描く
  const hp = input(view, 'HPの目標（以上）');
  hp.value = '94';
  hp.dispatch('input');
  assert.equal(results.getAttribute('aria-busy'), 'true');
  assert.equal(cards(view)[0], card);
  assert.equal(view.element.querySelector('.ideal-holding').textContent, holding);
  hp.value = '93';
  hp.dispatch('input');
  t.mock.timers.runAll();
  await settle();
  assert.equal(results.getAttribute('aria-busy'), null);
  // 同じ条件を同期で計算した画面と同じ結果
  const expected = idealView({ ...context(fakeOwned()), sliceBudget: Infinity, viewState: ctx.viewState }, parseHash('#/ideal?to=SheepBall&p=CraftSpeed_up2,Rare'));
  assert.equal(cardText(cards(view)[0]), cardText(cards(expected)[0]));
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
  const hp = input(view, 'HPの目標（以上）');
  hp.value = '91';
  await hp.dispatch('input');
  view.destroy();
  t.mock.timers.tick(150);
  assert.equal(results.getAttribute('aria-busy'), null);
  t.mock.timers.runAll();

  const states = new Map();
  const later = idealView({ ...context(fakeOwned(), [], states), inputDelay: 1000 }, parseHash('#/ideal?to=SheepBall'));
  const shot = input(later, '攻撃の目標（以上）');
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

// ---------------------------------------------------------------------------
// ideal-results: 要約・数値・説明・組の親の強調
// ---------------------------------------------------------------------------
const hintBoards = () => document.body.querySelectorAll('.hint-popover');

test('理想個体画面: 結果の上の要約の行（「上位 N 組（全 M 組・候補 K 体） · …」と「除外 N」）は出さない。組がないときの理由は結果の欄に出す（D30）', (t) => {
  install(t);
  const owned = fakeOwned();
  const view = idealView(withIdeals(context(owned), owned), parseHash('#/ideal?to=SheepBall&p=CraftSpeed_up2,Rare'));
  assert.equal(view.element.querySelector('.ideal-summary'), null);
  assert.equal(view.element.querySelector('.ideal-excluded'), null);
  assert.equal(view.element.querySelector('.result-note'), null);
  assert.doesNotMatch(view.element.textContent, /上位 \d+ 組|候補 \d+ 体|除外|の個体$/);
  // パッシブの条件を満たせない組だけのとき: 結果の欄に理由と所持者
  chooseRadio(view, 'パッシブの条件', 'only');
  chooseRadio(view, 'ケーキ', 'special');
  assert.equal(cards(view).length, 0);
  assert.equal(view.element.querySelector('.ideal-results').querySelector('p').textContent,
    'スペシャルケーキでは、欲しいパッシブが 4 個未満だと「欲しいものだけ」の子は産まれません。（所持者を「Alice（自分）」に絞っています）');
  view.destroy();
});

test('理想個体画面: データ元の 1 行は出さず（上のバーのセーブ連携の表示と重なるため。D29）、確認・読み込みの状態が変わっても結果は描き直さない', (t) => {
  installDom(t);
  const owned = fakeOwned();
  Object.assign(owned.state, { busy: false, auto: { enabled: true, status: 'permission', worlds: [], worldId: '', error: 'セーブを読むには許可が必要です' } });
  const view = idealView(context(owned), parseHash('#/ideal?to=SheepBall&p=CraftSpeed_up2,Rare'));
  assert.equal(view.element.querySelector('.owned-source'), null);
  // 許可が切れても画面に「読み込みを許可」は出さない（上のバーのセーブ連携の表示を押すと許可を求める）
  assert.equal(view.element.querySelectorAll('button').filter((node) => node.textContent === '読み込みを許可').length, 0);
  assert.equal(view.element.querySelector('.ideal-checked'), null);
  const [card] = cards(view);
  const text = view.element.querySelector('.ideal-holding');
  const before = text.textContent;
  // 1 分ごとの確認の途中と、確かめ終えたとき
  Object.assign(owned.state, { busy: true, auto: { ...owned.state.auto, status: 'checking' } });
  owned.emit();
  Object.assign(owned.state, { busy: false, auto: { ...owned.state.auto, status: 'ready', error: '' } });
  owned.emit();
  assert.equal(cards(view)[0], card);
  assert.equal(view.element.querySelector('.ideal-holding'), text);
  assert.equal(text.textContent, before);
  view.destroy();
});

test('理想個体画面: 見込みが同じ個体値厳選組の 2 組目以降を「同じ見込みの組」に畳み、並びの先頭と牧場の判定が指す組は外に残す（番号は振り直さない）', (t) => {
  install(t);
  const same = { hp: 100, shot: 50, defense: 100 };
  const zero = { hp: 0, shot: 0, defense: 0 };
  const list = [
    ...['1', '2', '3'].flatMap((n) => [palworldPal(`m${n}`, 'SheepBall', 'Male', [], same), palworldPal(`f${n}`, 'SheepBall', 'Female', [], same)]),
    palworldPal('m4', 'SheepBall', 'Male', [], zero), palworldPal('f4', 'SheepBall', 'Female', [], zero),
  ];
  const numbers = (nodes) => nodes.map((node) => node.querySelector('.step-number').textContent);
  // 欲しいパッシブ（伝説）を候補のだれも持たないので、全部が個体値厳選組。攻撃 100 以上の親がいないので、上の 3 組は同じ見込み
  const states = new Map();
  const plain = idealView(context(fakeOwned(list), [], states), parseHash('#/ideal?to=SheepBall&p=Legend'));
  const results = plain.element.querySelector('.ideal-results');
  assert.deepEqual(results.children.map((node) => node.tagName), ['article', 'details', 'article']);
  const details = results.querySelector('.ideal-same');
  assert.equal(details.querySelector('.ideal-same-title').textContent, '同じ見込みの組 ほか 2 組');
  assert.equal(details.querySelector('.ideal-same-reason').textContent, '攻撃 100 以上の親が候補にいないため、どの組も同じ見込みです。');
  assert.deepEqual(numbers(details.querySelectorAll('.ideal-pair')), ['2', '3']);
  // 畳んだカードも DOM に残る（番号は振り直さない）
  assert.deepEqual(numbers(cards(plain)), ['1', '2', '3', '4']);
  assert.equal(details.open, false);
  // 開閉は viewState に残す（タブを切り替えて戻っても開いたまま）
  details.open = true;
  details.dispatch('toggle');
  plain.destroy();
  const again = idealView(context(fakeOwned(list), [], states), parseHash('#/ideal?to=SheepBall&p=Legend'));
  assert.equal(again.element.querySelector('.ideal-same').open, true);
  // キノコケーキでは目標の 5 下から届くので、理由は「攻撃 95 以上」
  chooseRadio(again, 'ケーキ', 'talent');
  assert.equal(again.element.querySelector('.ideal-same-reason').textContent, '攻撃 95 以上の親が候補にいないため、どの組も同じ見込みです。');
  again.destroy();
  // 牧場 A に 1 番（そのまま）、牧場 B に 0 の組。B は 2 番への交換推奨なので、2 番は畳まずに外に残し、3 番だけを畳む
  const owned = fakeOwned(list);
  owned.state.owned.farms = [{ id: 'A', baseId: '', parents: ['m1', 'f1'] }, { id: 'B', baseId: '', parents: ['m4', 'f4'] }];
  const view = idealView(context(owned, [], new Map()), parseHash('#/ideal?to=SheepBall&p=Legend'));
  const rows = view.element.querySelectorAll('.ideal-farm');
  assert.match(rows[0].textContent, /そのまま（おすすめ 1 番）/);
  assert.match(rows[1].textContent, /交換推奨 → おすすめ 2 番/);
  const shown = view.element.querySelector('.ideal-results').children;
  assert.deepEqual(shown.map((node) => node.tagName), ['article', 'article', 'details', 'article']);
  assert.deepEqual(numbers(shown[2].querySelectorAll('.ideal-pair')), ['3']);
  assert.equal(shown[2].querySelector('.ideal-same-title').textContent, '同じ見込みの組 ほか 1 組');
  view.destroy();
  // 見込みが違えば畳まない（個体値がばらばらの組）
  const varied = idealView(context(fakeOwned([
    palworldPal('m1', 'SheepBall', 'Male', [], { hp: 100, shot: 90, defense: 100 }), palworldPal('f1', 'SheepBall', 'Female', [], same),
    palworldPal('m2', 'SheepBall', 'Male', [], zero), palworldPal('f2', 'SheepBall', 'Female', [], same),
  ])), parseHash('#/ideal?to=SheepBall&p=Legend'));
  assert.equal(varied.element.querySelector('.ideal-same'), null);
  varied.destroy();
});

test('理想個体画面: 組の ♂♀ 行で、欲しいパッシブに ✓・それ以外は薄く、目標未満の個体値は細字（差の −N は D30 で出さない）。所持パルの画面の行（highlight なし）には印を付けない', (t) => {
  install(t);
  const owned = fakeOwned([
    palworldPal('m1', 'SheepBall', 'Male', ['CraftSpeed_up2', 'Noukin'], { hp: 100, shot: 80, defense: 100 }),
    palworldPal('f1', 'SheepBall', 'Female', ['Rare'], { hp: 100, shot: 100, defense: 0 }),
  ]);
  // 防御は条件なし（0）
  const states = new Map([['ideal', { conditions: { holder: '', mode: 'include', targets: { hp: 100, shot: 100, defense: 0 }, cake: 'none' } }]]);
  const view = idealView(context(owned, [], states), parseHash('#/ideal?to=SheepBall&p=CraftSpeed_up2,Rare'));
  const [male, female] = cards(view)[0].querySelectorAll('.owned-row');
  // パッシブ: 欲しいものは先頭に ✓、それ以外は薄く
  const chips = male.querySelectorAll('.passive-chip');
  assert.deepEqual(chips.map((chip) => chip.className.split(' ').filter((name) => /^is-/.test(name)).join(' ')), ['is-wanted', 'is-extra']);
  const check = chips[0].children[0];
  assert.equal(check.className, 'passive-check');
  assert.equal(check.textContent, '✓');
  assert.equal(check.getAttribute('aria-label'), '欲しいパッシブ');
  assert.ok(female.querySelector('.passive-chip').className.split(' ').includes('is-wanted'));
  // 個体値: HP・攻・防・計の 4 セル（owned-rows。前は区切りの文字つきの 3 つ）。目標以上は met、未満は short（目標までの差〔−N。D23〕は
  // D30 で出さなくした）、目標 0（条件なし）と合計は何もしない。目標のあるセルは縦線の位置（--t）。読み上げは欄の aria-label にまとめる
  const cells = male.querySelector('.owned-talent').querySelectorAll('.talent-cell');
  assert.deepEqual(cells.map((cell) => [cell.getAttribute('data-key'), cell.className, cell.textContent, cell.style.getPropertyValue('--t')]), [
    ['hp', 'talent-cell has-target met', '100', '100'],
    ['shot', 'talent-cell has-target short', '80', '100'],
    ['defense', 'talent-cell', '100', ''],
    ['total', 'talent-cell', '280', ''],
  ]);
  assert.equal(male.querySelector('.talent-diff'), null);
  assert.equal(male.querySelector('.owned-talent').getAttribute('role'), 'img');
  assert.equal(male.querySelector('.owned-talent').getAttribute('aria-label'), '個体値 HP 100（目標 100 以上）・攻撃 80（目標 100 未満）・防御 100・合計 280');
  view.destroy();
  // 欲しいパッシブを選んでいないときは、パッシブを薄くしない
  const none = idealView(context(owned, [], states), parseHash('#/ideal?to=SheepBall'));
  assert.equal(cards(none)[0].querySelectorAll('.passive-chip').filter((chip) => /is-(wanted|extra)/.test(chip.className)).length, 0);
  none.destroy();
  // 所持パルの画面の行（highlight なし）は、同じ 4 セルで目標の印・差がなく、パッシブに印を付けない
  const row = ownedRow(owned.state.owned.pals.find((pal) => pal.id === 'm1'));
  assert.deepEqual(row.querySelectorAll('.talent-cell').map((cell) => [cell.className, cell.textContent]),
    [['talent-cell', '100'], ['talent-cell', '80'], ['talent-cell', '100'], ['talent-cell', '280']]);
  assert.equal(row.querySelector('.owned-talent').getAttribute('aria-label'), '個体値 HP 100・攻撃 80・防御 100・合計 280');
  assert.equal(row.querySelector('.talent-diff'), null);
  assert.equal(row.querySelector('.passive-check'), null);
  assert.ok(row.querySelectorAll('.passive-chip').every((chip) => !/is-(wanted|extra)/.test(chip.className)));
});

test('理想個体画面: 組の札（組の目的・変更あり・配置中）は押すと説明が開くボタン（組の目的は SVG のアイコンつき）。カードを作り直すと開いていた板は閉じる', async (t) => {
  const { body } = install(t);
  const owned = fakeOwned([palworldPal('m1', 'SheepBall', 'Male', [], full), palworldPal('f1', 'SheepBall', 'Female', [], full)]);
  owned.state.owned.farms = [{ id: 'A', baseId: '', parents: ['m1', 'f1'] }];
  const view = idealView(context(owned), parseHash('#/ideal?to=SheepBall'));
  body.append(view.element);
  const [card] = cards(view);
  const tier = card.querySelector('.ideal-tier');
  assert.equal(tier.tagName, 'button');
  assert.equal(tier.textContent, '完全体作成組');
  const icon = tier.querySelector('svg');
  assert.equal(icon.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(icon.getAttribute('aria-hidden'), 'true');
  await tier.dispatch('click');
  assert.match(hintBoards()[0].textContent, /^この 2 体（子と入れ替えながらを含む）で、欲しいパッシブと個体値の目標を全部満たす子を狙える組です。/);
  // 配置中の札（1 度に開く板は 1 つ）
  const placed = card.querySelector('.ideal-placed');
  assert.equal(placed.tagName, 'button');
  await placed.dispatch('click');
  assert.deepEqual(hintBoards().map((node) => node.textContent), ['セーブで、この組がその牧場に入っていると分かった組です。']);
  // 条件を変えてカードを作り直すと、開いていた板は閉じる
  chooseRadio(view, 'ケーキ', 'talent');
  assert.notEqual(cards(view)[0], card);
  assert.equal(hintBoards().length, 0);
  // 個体値厳選組の札にもアイコンと説明
  const talentOnly = idealView(context(fakeOwned()), parseHash('#/ideal?to=SheepBall&p=Legend'));
  const talentTier = cards(talentOnly)[0].querySelector('.ideal-tier');
  assert.ok(talentTier.querySelector('svg'));
  await talentTier.dispatch('click');
  assert.equal(hintBoards()[0].textContent, 'パッシブは見ずに、個体値の目標をそろえる組です。');
  talentOnly.destroy();
  assert.equal(hintBoards().length, 0);
  view.destroy();
});

test('理想個体画面: 計算のしくみの「?」とダイアログはなく（D30）、どのケーキでも組のカードに数値と内訳の文を出さない', (t) => {
  install(t);
  const owned = fakeOwned([
    palworldPal('m1', 'SheepBall', 'Male', ['CraftSpeed_up2', 'Rare'], { hp: 80, shot: 60, defense: 40 }),
    palworldPal('f1', 'SheepBall', 'Female', ['CraftSpeed_up2'], { hp: 30, shot: 90, defense: 70 }),
    palworldPal('m2', 'PinkCat', 'Male', ['CraftSpeed_up2'], { hp: 50, shot: 50, defense: 50 }),
    palworldPal('f2', 'ChickenPal', 'Female', ['Rare'], { hp: 40, shot: 40, defense: 40 }),
  ]);
  const records = [{ id: 'r1', parent1Id: 'PinkCat', parent2Id: 'ChickenPal', childId: 'SheepBall', parent1Gender: '', parent2Gender: '' }];
  const shown = idealView(context(owned, records), parseHash('#/ideal?to=SheepBall&p=CraftSpeed_up2,Rare'));
  assert.equal(shown.element.querySelector('.view-help-button'), null);
  assert.equal(document.body.querySelectorAll('dialog').filter((node) => /ideal-help/.test(node.className)).length, 0);
  for (const cake of ['none', 'talent', 'special']) {
    chooseRadio(shown, 'ケーキ', cake);
    assert.ok(cards(shown).length);
    for (const card of cards(shown)) {
      assert.equal(card.querySelector('.ideal-chance'), null);
      assert.doesNotMatch(card.textContent, NUMBERS);
    }
  }
  shown.destroy();
});

// フェーズ 1b・1c の終わりのレビューの直し（理想個体）
// 牧場 A に 1 番（そのまま）、牧場 B に 0 の組（2 番への交換推奨）、E は空き（3 番を案内）。伝説はだれも持たないので全部が個体値厳選組で、3 番は畳まれる
const reviewPals = () => {
  const same = { hp: 100, shot: 50, defense: 100 };
  const zero = { hp: 0, shot: 0, defense: 0 };
  return [
    ...['1', '2', '3'].flatMap((n) => [palworldPal(`m${n}`, 'SheepBall', 'Male', [], same), palworldPal(`f${n}`, 'SheepBall', 'Female', [], same)]),
    palworldPal('m4', 'SheepBall', 'Male', [], zero), palworldPal('f4', 'SheepBall', 'Female', [], zero),
  ];
};
const reviewFarms = () => [ok('A', 'b1', ['m1', 'f1']), ok('B', 'b1', ['m4', 'f4']), ok('E', 'b1', [])];
// 計算に効かない値（レベル）だけが変わった読み直し（20 秒ごとの確認）。組の行の値が変わるので、帯・詳細・カードを作り直す
function bumpLevels(owned) {
  owned.state.owned = { ...owned.state.owned, pals: owned.state.owned.pals.map((pal) => ({ ...pal, level: pal.level + 1 })) };
  owned.emit();
}

test('理想個体画面: 描き直しで帯のセル・詳細の行・空き牧場の番号・カードの札と行の部品・同じ見込みの組の見出し・継承ルートのボタンを作り直しても、フォーカスは同じ役目の部品へ戻す（開いていた札の説明の板は閉じる）', async (t) => {
  const { body } = install(t);
  const owned = fakeOwned(reviewPals());
  owned.state.owned.bases = [{ id: 'b1', label: '拠点 1' }];
  owned.state.owned.farms = reviewFarms();
  const view = idealView(context(owned, [], new Map()), parseHash('#/ideal?to=SheepBall&p=Legend'));
  body.append(view.element);
  const strip = () => view.element.querySelector('.ideal-farm-strip');
  const parts = {
    'farm-cell:B': () => strip().querySelectorAll('.ideal-farm-cell')[1],
    'farm-row:A': () => view.element.querySelectorAll('.ideal-farm-main')[0],
    'farm-pick:m3|f3': () => view.element.querySelector('.ideal-farm-pick'),
    'tag:m1|f1:group': () => cards(view)[0].querySelector('.ideal-tier'),
    'tag:m1|f1:placed': () => cards(view)[0].querySelector('.ideal-placed'),
    'tag:m2|f2:farmTo': () => cards(view)[1].querySelector('.ideal-farm-to'),
    'pair:m1|f1:F:pal': () => cards(view)[0].querySelectorAll('.owned-row')[1].querySelector('[data-focus="pal"]'),
    'same:m3|f3': () => view.element.querySelector('.ideal-same-summary'),
    'carry:Legend': () => view.element.querySelector('.ideal-carry'),
  };
  for (const [key, find] of Object.entries(parts)) {
    const before = find();
    assert.ok(before, key);
    before.focus();
    bumpLevels(owned);
    const after = find();
    // 部品は作り直している（同じ要素を使い回していない）が、フォーカスは同じ役目の新しい部品にある
    assert.notEqual(after, before, key);
    assert.equal(document.activeElement, after, key);
    assert.equal(after.getAttribute('data-focus-key'), key);
  }
  // 札の説明の板を開いたまま作り直すと、板は閉じ、フォーカスは同じ組の同じ札へ
  const placed = parts['tag:m1|f1:placed']();
  placed.focus();
  await placed.dispatch('click');
  assert.equal(hintBoards().length, 1);
  bumpLevels(owned);
  assert.equal(hintBoards().length, 0);
  assert.equal(document.activeElement, parts['tag:m1|f1:placed']());
  // 計算し直したとき（受け取った個体が増えた）も同じ
  const tier = parts['tag:m1|f1:group']();
  tier.focus();
  owned.state.owned = fakeOwned([...reviewPals(), palworldPal('m5', 'SheepBall', 'Male', [], { hp: 0, shot: 0, defense: 0 })]).state.owned;
  owned.state.owned.bases = [{ id: 'b1', label: '拠点 1' }];
  owned.state.owned.farms = reviewFarms();
  owned.emit();
  assert.notEqual(parts['tag:m1|f1:group'](), tier);
  assert.equal(document.activeElement, parts['tag:m1|f1:group']());
  // 札がなくなったら（組から配置中の札が消えた）、同じ組の目的の札へ
  parts['tag:m1|f1:placed']().focus();
  owned.state.owned = { ...owned.state.owned, farms: [ok('B', 'b1', ['m4', 'f4']), ok('E', 'b1', [])] };
  owned.emit();
  assert.equal(cards(view)[0].querySelector('.ideal-placed'), null);
  assert.equal(document.activeElement, parts['tag:m1|f1:group']());
  view.destroy();
});

test('理想個体画面: 牧場の判定を保留している間に計算し直しても、読めるようになったら「変更あり」を出す（開き直さなくても）', (t) => {
  install(t);
  const list = [
    palworldPal('m1', 'SheepBall', 'Male', [], { hp: 90, shot: 90, defense: 90 }),
    palworldPal('f1', 'SheepBall', 'Female', [], { hp: 90, shot: 90, defense: 90 }),
  ];
  const owned = fakeOwned(list);
  const farms = [{ id: 'A', baseId: '', parents: ['m1', 'f1'] }];
  owned.state.owned.farms = farms;
  const view = idealView(context(owned, [], new Map()), parseHash('#/ideal?to=SheepBall'));
  // 3 つとも 100 の ♀ を受け取ったのと同じ読み直しで、ほかの牧場が読めなくなった（判定を保留したまま計算し直す）
  const hatched = palworldPal('f9', 'SheepBall', 'Female', [], { hp: 100, shot: 100, defense: 100 });
  owned.state.owned = fakeOwned([...list, hatched]).state.owned;
  owned.state.owned.farms = [...farms, { id: 'U', baseId: '', parents: [], status: 'uncertain' }];
  owned.emit();
  assert.equal(view.element.querySelector('.ideal-farm-strip').textContent, '牧場の判定を保留（読めない牧場が 1 か所あります）');
  assert.equal(view.element.querySelectorAll('.ideal-changed').length, 0);
  // 読めるようになった（この目標の牧場は同じなので計算はし直さない）。交換推奨の行き先に「変更あり」
  owned.state.owned = { ...owned.state.owned, farms };
  owned.emit();
  assert.match(view.element.querySelector('.ideal-farm').textContent, /交換推奨 → おすすめ 1 番/);
  assert.equal(view.element.querySelectorAll('.ideal-changed').length, 1);
  assert.match(cards(view)[0].textContent, /変更あり/);
  assert.match(view.element.querySelector('.ideal-farms').textContent, /新しく入った組が 1 組/);
  view.destroy();
});

test('理想個体画面: 帯・詳細の行・空き牧場の番号から組へ移ったら、動かした後にカードへフォーカスを移す（スクロールはしない focus）。作り直してもカードに戻す', (t) => {
  const { body } = install(t);
  const scrolled = t.mock.method(FakeElement.prototype, 'scrollIntoView');
  const focused = t.mock.method(FakeElement.prototype, 'focus');
  const owned = fakeOwned(reviewPals());
  owned.state.owned.bases = [{ id: 'b1', label: '拠点 1' }];
  owned.state.owned.farms = reviewFarms();
  const view = idealView(context(owned, [], new Map()), parseHash('#/ideal?to=SheepBall&p=Legend'));
  body.append(view.element);
  const cell = view.element.querySelectorAll('.ideal-farm-cell')[1];
  cell.focus();
  cell.dispatch('click');
  const card = cards(view)[1];
  assert.equal(scrolled.mock.calls.at(-1).this, card);
  // ページ内リンクの作法: カードを tabIndex -1 にして、動かした後に preventScroll の focus
  assert.equal(document.activeElement, card);
  assert.equal(card.tabIndex, -1);
  assert.equal(focused.mock.calls.at(-1).this, card);
  assert.deepEqual(focused.mock.calls.at(-1).arguments, [{ preventScroll: true }]);
  // 読み直しでカードを作り直しても、移った先のカードにフォーカスを戻す
  bumpLevels(owned);
  assert.notEqual(cards(view)[1], card);
  assert.equal(document.activeElement, cards(view)[1]);
  assert.equal(cards(view)[1].tabIndex, -1);
  // 空き牧場の番号から畳まれた組へ移っても、開いてからカードへ
  view.element.querySelector('.ideal-farm-pick').dispatch('click');
  assert.equal(view.element.querySelector('.ideal-same').open, true);
  assert.equal(document.activeElement, cards(view)[2]);
  // 詳細の行からも
  view.element.querySelectorAll('.ideal-farm-main')[0].dispatch('click');
  assert.equal(document.activeElement, cards(view)[0]);
  view.destroy();
});

test('理想個体画面: 牧場の帯のセルの 2 体は、絵の「♂＋♀」を読ませず、見た目は隠した文で「名前♂＋名前♀」と読ませる（押せないセルでも、どの組か分かる。親の組の記号は用語表の「＋」）', (t) => {
  install(t);
  const owned = fakeOwned([
    palworldPal('m1', 'SheepBall', 'Male', [], { hp: 100, shot: 100, defense: 100 }),
    palworldPal('m2', 'SheepBall', 'Male', [], { hp: 100, shot: 100, defense: 0 }),
    palworldPal('f1', 'SheepBall', 'Female', [], { hp: 100, shot: 0, defense: 0 }),
    palworldPal('f2', 'SheepBall', 'Female', [], { hp: 100, shot: 0, defense: 100 }),
  ]);
  // 交換を見送った「そのまま」で、今の組がおすすめの一覧にない（帯のセルは押せない）
  owned.state.owned.farms = [{ id: 'A', baseId: '', parents: ['m1', 'f1'] }, { id: 'B', baseId: '', parents: ['m2', 'f2'] }];
  const view = idealView(context(owned, [], new Map()), parseHash('#/ideal?to=SheepBall'));
  const cells = view.element.querySelector('.ideal-farm-strip').querySelectorAll('.ideal-farm-cell');
  assert.deepEqual(cells.map((cell) => cell.tagName), ['div', 'div']);
  for (const cell of cells) {
    assert.equal(cell.querySelector('.ideal-farm-cell-pals').getAttribute('aria-hidden'), 'true');
    assert.equal(cell.querySelector('.visually-hidden').textContent, '（モコロン♂＋モコロン♀）');
    assert.equal(cell.querySelector('.ideal-farm-cell-x').textContent, '＋');
  }
  view.destroy();
});

test('理想個体画面: 所持者の選択肢の名前は所持パルとそろえる（自分は自分のプレイヤー名に「（自分）」を付けて先頭、同じ名前が 2 人以上なら UID の頭 8 字を添える）', (t) => {
  install(t);
  const P2 = 'abcd1234-0000-0000-0000-000000000000';
  const P3 = 'ef567890-0000-0000-0000-000000000000';
  const owned = fakeOwned();
  owned.state.owned = normalizeOwned({
    version: 1, world: { name: 'テスト', hostName: 'Alice' }, bases: [], stats: {}, pals: basePals,
    players: [{ uid: P2, name: 'Bob', level: 40 }, { uid: P1, name: 'Alice', level: 50 }, { uid: P3, name: 'Bob', level: 30 }],
  }, { pals, passives });
  const view = idealView(withIdeals(context(owned), owned), parseHash('#/ideal?to=SheepBall'));
  const holder = holderOf(view);
  assert.deepEqual([...holder.children].map((option) => [option.value, option.textContent]), [
    ['', 'すべて'], ['mine', 'Alice（自分）'], [`player:${P2}`, 'Bob（ABCD1234）'], [`player:${P3}`, 'Bob（EF567890）'],
  ]);
  // 組がないときの所持者の注記も選択肢の名前（Bob〔ABCD1234〕は個体を持たない）
  holder.value = `player:${P2}`;
  holder.dispatch('change');
  assert.match(view.element.querySelector('.ideal-results').querySelector('p').textContent, /（所持者を「Bob（ABCD1234）」に絞っています）$/);
  view.destroy();
});

test('理想個体画面: 保存の板の「保存」をマウスで押すと保存する（名前の欄から「保存」へフォーカスが移る途中の focusout で板を閉じない。ideal-save-click の回帰）', async (t) => {
  const { body } = install(t);
  const owned = fakeOwned();
  const ctx = withIdeals(context(owned), owned);
  const view = idealView(ctx, parseHash('#/ideal?to=SheepBall'));
  body.append(view.element);
  saveButton(view).dispatch('click');
  nameInput(view).value = 'マウスで保存';
  const board = view.element.querySelector('.ideal-save-popover');
  const submit = board.querySelectorAll('button').find((node) => node.textContent === '保存');
  // Chrome では、押した部品へフォーカスが移る途中（focusout の後の microtask）の activeElement は body
  body.focus();
  await board.dispatch('focusout', { relatedTarget: submit });
  await Promise.resolve();
  assert.ok(nameInput(view), '板が閉じた');
  submit.focus();
  await submit.dispatch('click');
  assert.deepEqual(ctx.ideals.list().map((goal) => goal.name), ['マウスで保存']);
  assert.equal(nameInput(view), undefined);
  assert.equal(saveButton(view).textContent, '★ 保存済み');
  view.destroy();
});

test('理想個体画面: 組が 0 のときは要約（前の「組なし（候補 N 体）」。D27）を出さず、結果の欄の案内だけ（D30）', (t) => {
  install(t);
  const owned = fakeOwned([palworldPal('m1', 'SheepBall', 'Male', []), palworldPal('m2', 'SheepBall', 'Male', [])]);
  const view = idealView(context(owned), parseHash('#/ideal?to=SheepBall'));
  assert.equal(view.element.querySelector('.ideal-summary'), null);
  assert.doesNotMatch(view.element.textContent, /組なし|候補 2 体/);
  assert.equal(view.element.querySelector('.ideal-results').querySelector('p').textContent, '♂ と ♀ の組を作れる個体がいません。');
  view.destroy();
});

// ---------------------------------------------------------------------------
// ケーキの提案（D30「ケーキ以外の条件を入れたら、どのケーキだと最速で作成できるかも提案してほしい」）
// ---------------------------------------------------------------------------
// 「最速」の印が付いているケーキの押しボタンの値（印は 1 つだけ）
const fastestOf = (view) => radioGroup(view, 'ケーキ').querySelectorAll('.segmented-badge').map((node) => node.parentElement.getAttribute('data-value'));

test('理想個体画面: ケーキ以外の条件が決まったら 3 通りのケーキで計画を求め、いちばん早く完成できるケーキの押しボタンに「最速」の印を付ける。押すとそのケーキに切り替わる（D30）', async (t) => {
  install(t);
  // 個体値 96 の 2 体（目標 100）: キノコケーキ（+1〜5）なら 1 回で届くので、ケーキなし・スペシャルよりずっと早い
  const owned = fakeOwned([
    palworldPal('m1', 'SheepBall', 'Male', [], { hp: 96, shot: 96, defense: 96 }),
    palworldPal('f1', 'SheepBall', 'Female', [], { hp: 96, shot: 96, defense: 96 }),
  ]);
  const view = idealView(context(owned), parseHash('#/ideal?to=SheepBall'));
  assert.equal(chosen(view, 'ケーキ'), 'none');
  assert.deepEqual(fastestOf(view), ['talent']);
  const option = radioGroup(view, 'ケーキ').querySelector('[data-value="talent"]');
  const badge = option.querySelector('.segmented-badge');
  assert.equal(badge.textContent, '最速');
  assert.equal(badge.getAttribute('aria-hidden'), 'true');
  assert.equal(option.querySelector('.visually-hidden').textContent, '（最速）');
  assert.equal(option.title, 'キノコケーキ・豪華野菜ケーキ（個体値 +1〜5）\nこの条件でいちばん早く完成できるケーキ（押すと切り替えます）');
  // 印の付いた押しボタンを押すと、そのケーキで計算し直す（印はそのまま。ケーキを変えても比べ直さない）
  const before = cards(view)[0];
  await option.dispatch('click');
  assert.equal(chosen(view, 'ケーキ'), 'talent');
  assert.notEqual(cards(view)[0], before);
  assert.deepEqual(fastestOf(view), ['talent']);
  assert.equal(radioGroup(view, 'ケーキ').querySelector('[data-value="talent"]').querySelector('.segmented-badge'), badge);
  // 目標を 90 にすると、どのケーキでも 1 回で作れて差は 1 割未満なので、手間の少ない「なし」
  for (const label of ['HPの目標（以上）', '攻撃の目標（以上）', '防御の目標（以上）']) {
    const node = input(view, label);
    node.value = '90';
    node.dispatch('input');
  }
  assert.deepEqual(fastestOf(view), ['none']);
  assert.equal(option.title, 'キノコケーキ・豪華野菜ケーキ（個体値 +1〜5）');
  // 目標を外すと印も外す
  view.applyRoute(parseHash('#/ideal'));
  assert.deepEqual(fastestOf(view), []);
  view.destroy();
});

test('理想個体画面: 欲しいパッシブを片親ずつ持つならスペシャルケーキが最速。作れないケーキは比べず、どのケーキでも作れなければ印を付けない（D30）', (t) => {
  install(t);
  const owned = fakeOwned([
    palworldPal('m1', 'SheepBall', 'Male', ['CraftSpeed_up2', 'Rare'], full),
    palworldPal('f1', 'SheepBall', 'Female', ['Legend', 'Noukin'], full),
  ]);
  const view = idealView(context(owned), parseHash('#/ideal?to=SheepBall&p=CraftSpeed_up2,Rare,Legend,Noukin'));
  assert.deepEqual(fastestOf(view), ['special']);
  view.destroy();
  // 欲しいものだけ・1 つ: スペシャルケーキでは作れない（比べない）。なしとキノコ等の差は 1 割未満なので「なし」
  const states = new Map([['ideal', { conditions: { holder: '', mode: 'only', targets: { ...full }, cake: 'special' } }]]);
  const only = idealView(context(fakeOwned([
    palworldPal('m2', 'SheepBall', 'Male', ['Rare'], full), palworldPal('f2', 'SheepBall', 'Female', ['Rare'], full),
  ]), [], states), parseHash('#/ideal?to=SheepBall&p=Rare'));
  assert.equal(cards(only).length, 0);
  assert.deepEqual(fastestOf(only), ['none']);
  only.destroy();
  // 欲しいパッシブを候補のだれも持たない（個体値厳選組だけ）なら、どのケーキでも完全体作成組はできないので印なし
  const missing = idealView(context(owned), parseHash('#/ideal?to=SheepBall&p=Legend,PAL_ALLAttack_up3'));
  assert.ok(cards(missing).length);
  assert.deepEqual(fastestOf(missing), []);
  missing.destroy();
});

test('理想個体画面: ケーキの提案は今の選択の計画を先に出し、ほかの 2 通りは描いた後に区切って求める。条件を変えたら古い計算を捨て、条件ごとに覚えて同じなら計算し直さない（D30）', async (t) => {
  install(t);
  // 区切った計算の続き（setTimeout）を手で 1 回ずつ進める
  const queue = [];
  const original = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => { queue.push(fn); return queue.length; };
  t.after(() => { globalThis.setTimeout = original; });
  const step = async () => { queue.shift()(); await settle(); };
  const owned = fakeOwned([
    palworldPal('m1', 'SheepBall', 'Male', [], { hp: 96, shot: 96, defense: 96 }),
    palworldPal('f1', 'SheepBall', 'Female', [], { hp: 96, shot: 96, defense: 96 }),
  ]);
  // ほかのテストと世代の表を共有しない目標（表を新しく作るので、区切りが何回も入る）
  const targets = { hp: 98, shot: 97, defense: 99 };
  const states = new Map([['ideal', { conditions: { holder: '', mode: 'include', targets: { ...targets }, cake: 'none' } }]]);
  const ctx = { ...context(owned, [], states), sliceBudget: 0 };
  const view = idealView(ctx, parseHash('#/ideal?to=SheepBall'));
  const busy = () => view.element.querySelector('.ideal-results').getAttribute('aria-busy') === 'true';
  assert.ok(busy());
  assert.deepEqual(fastestOf(view), []);
  // 今の選択（ケーキなし）の計画を先に描く。この時点では、ほかのケーキはまだ求めていない（印なし・続きの区切りが待っている）
  let mainSteps = 0;
  while (busy()) { await step(); mainSteps++; }
  assert.ok(mainSteps >= 2, `今の計画の区切り ${mainSteps} 回`);
  assert.equal(cards(view).length, 1);
  assert.deepEqual(fastestOf(view), []);
  assert.ok(queue.length > 0);
  // 残りのケーキを区切って求め終えたら、印を付ける（結果の欄は「計算中」にしない）
  let cakeSteps = 0;
  while (queue.length) {
    await step();
    cakeSteps++;
    assert.ok(!busy());
  }
  assert.ok(cakeSteps >= 2, `ケーキの比べ方の区切り ${cakeSteps} 回`);
  assert.deepEqual(fastestOf(view), ['talent']);
  // 計算に効かない値（レベル）だけが変わった読み直し（20 秒ごとの確認など）では、計算し直さない（続きの区切りが入らない）
  owned.state.owned = { ...owned.state.owned, pals: owned.state.owned.pals.map((pal) => ({ ...pal, level: pal.level + 1 })) };
  owned.emit();
  assert.equal(queue.length, 0);
  assert.deepEqual(fastestOf(view), ['talent']);
  // 条件を変えると、印をすぐ外す。新しい条件で比べている途中にさらに条件を変えると、途中の計算は捨てる
  const hp = input(view, 'HPの目標（以上）');
  hp.value = '90';
  await hp.dispatch('input');
  assert.deepEqual(fastestOf(view), []);
  while (busy()) await step();
  assert.ok(queue.length > 0);
  await step();
  hp.value = '91';
  await hp.dispatch('input');
  assert.deepEqual(fastestOf(view), []);
  while (queue.length) await step();
  // 最後の条件（HP 91）で比べた結果だけを出す（同期で計算した画面と同じ）
  const expected = idealView({ ...context(fakeOwned(owned.state.data.snapshot.pals), [], new Map([['ideal', { conditions: { holder: '', mode: 'include', targets: { ...targets, hp: 91 }, cake: 'none' } }]])) },
    parseHash('#/ideal?to=SheepBall'));
  assert.deepEqual(fastestOf(view), fastestOf(expected));
  expected.destroy();
  // 前に比べ終えた条件（HP 98）に戻ると、覚えている結果ですぐ印を出す（今の計画は計算し直すが、ケーキの比べ方は続きを入れない）
  hp.value = '98';
  await hp.dispatch('input');
  assert.deepEqual(fastestOf(view), ['talent']);
  while (queue.length) await step();
  assert.deepEqual(fastestOf(view), ['talent']);
  // 比べている途中で画面を閉じたら、それ以上計算しない
  hp.value = '92';
  await hp.dispatch('input');
  while (busy()) await step();
  assert.ok(queue.length > 0);
  view.destroy();
  while (queue.length) await step();
  assert.deepEqual(fastestOf(view), []);
});

// ---------------------------------------------------------------------------
// participant-self: このワールドでの自分を選ぶ・変えると、同じデータのまま描き直し、目標の「未確認」から設定へ行ける
// ---------------------------------------------------------------------------
const SELF_WORLD = 'ABCDEF0123456789ABCDEF0123456789';
const SELF_P2 = 'abcd1234-0000-0000-0000-000000000000';
// Alice（P1）と Bob（SELF_P2）がモコロンを 2 体ずつ持つワールドに、名前の違う「仲間」としてログインしている（自分が分からない）。
// app.js と同じく、理想個体の登録の本人に「このワールドでの自分」を渡し、変わったら判定し直す
function selfIdeal() {
  const list = [
    palworldPal('a1', 'SheepBall', 'Male', ['Rare']),
    palworldPal('a2', 'SheepBall', 'Female', ['Rare']),
    palworldPal('b1', 'SheepBall', 'Female', ['Legend'], full, { kind: 'palbox', playerUid: SELF_P2 }),
    palworldPal('b2', 'SheepBall', 'Male', ['Legend'], full, { kind: 'palbox', playerUid: SELF_P2 }),
  ];
  const owned = fakeOwned(list);
  owned.state.owned = normalizeOwned({ version: 1, world: { name: 'テスト', hostName: 'Alice' }, bases: [], stats: {}, pals: list,
    players: [{ uid: P1, name: 'Alice', level: 50 }, { uid: SELF_P2, name: 'Bob', level: 40 }] }, { pals, passives });
  owned.state.meta = { worldId: SELF_WORLD, worldName: 'テスト', saveUpdatedAt: '2026-10-05T00:00:00.000Z' };
  const ctx = context(owned);
  const listeners = new Set();
  Object.assign(ctx.store.state, { userId: '仲間', passcode: '入力', renaming: false, users: ['仲間'] });
  ctx.store.subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
  ctx.self = createSelfStore({ store: ctx.store, storage });
  let ids = 0;
  ctx.ideals = createIdealStore({
    store: ctx.store, owned, storage, uuid: () => `goal-${++ids}`,
    identity: (worldId) => ({ userId: ctx.store.state.userId, users: ctx.store.state.users, mapping: {}, selfUid: ctx.self.get(worldId) }),
  });
  ctx.self.subscribe(() => ctx.ideals.identityChanged());
  return { ctx, owned };
}

test('理想個体画面（このワールドでの自分）: 所持パルのデータが同じまま自分を選ぶ・変えると、所持者の選択肢と結果を計算し直す（読み直しでは計算しない）', (t) => {
  install(t);
  const { ctx, owned } = selfIdeal();
  const view = idealView(ctx, parseHash('#/ideal?to=SheepBall'));
  // 自分が分からない間は「すべて」で計算している（D29）
  assert.equal(holderOf(view).value, '');
  assert.deepEqual([...holderOf(view).children].map((option) => option.textContent), ['すべて', 'Alice', 'Bob']);
  assert.ok(cards(view).length > 1);
  ctx.self.set(SELF_WORLD, SELF_P2);
  assert.equal(holderOf(view).value, 'mine');
  assert.deepEqual([...holderOf(view).children].map((option) => option.textContent), ['すべて', 'Bob（自分）', 'Alice']);
  // Bob の 2 体（伝説）の組だけ
  assert.equal(cards(view).length, 1);
  assert.match(cards(view)[0].textContent, /伝説/);
  assert.doesNotMatch(cards(view)[0].textContent, /希少/);
  const bobCard = cards(view)[0];
  // 自分を Alice に変えると、Alice の個体で計算し直す
  ctx.self.set(SELF_WORLD, P1);
  assert.deepEqual([...holderOf(view).children].map((option) => option.textContent), ['すべて', 'Alice（自分）', 'Bob']);
  assert.equal(cards(view).length, 1);
  assert.notEqual(cards(view)[0], bobCard);
  assert.match(cards(view)[0].textContent, /希少/);
  // 同じ本人のままの読み直し（10 秒ごと）では計算し直さない（カードを作り直さない）
  const aliceCard = cards(view)[0];
  owned.state.owned = { ...owned.state.owned };
  owned.emit();
  ctx.self.reload('pal-note.ideals.self.');
  assert.equal(cards(view)[0], aliceCard);
  view.destroy();
});

test('理想個体画面（このワールドでの自分）: 自分が分からない目標は「未確認」と「設定で選ぶ」（押すとダイアログを閉じる）。選ぶと完成済みになり、通知は出ない', async (t) => {
  install(t);
  const { ctx } = selfIdeal();
  ctx.ideals.add({ name: 'Bob の伝説', palId: 'SheepBall', passives: ['Legend'], mode: 'include', targets: full, cake: 'none', order: 'next' });
  const view = idealView(ctx, parseHash('#/ideal?to=SheepBall'));
  let dialog = openGoals(view);
  const row = dialog.querySelector('.ideal-goal');
  assert.equal(row.querySelector('.ideal-goal-status').textContent, '未確認（このワールドでの自分が未設定）');
  const action = row.querySelector('.ideal-goal-action');
  assert.equal(action.hidden, false);
  assert.equal(action.textContent, '設定で選ぶ');
  assert.equal(action.href, `#/settings?world=${SELF_WORLD}&open=auto`);
  await action.dispatch('click');
  assert.equal(dialog.open, false);
  // 設定で選んだ（同じセーブのまま）: 完成済みになるが、選んだ時点の完成は知らせない（completedAt なし）
  ctx.self.set(SELF_WORLD, SELF_P2);
  assert.deepEqual(ctx.ideals.list()[0].worlds[SELF_WORLD], { checked: true, complete: true, completedAt: '', observedAt: '2026-10-05T00:00:00.000Z', worldName: 'テスト' });
  dialog = openGoals(view);
  const done = dialog.querySelector('.ideal-goal');
  assert.match(done.querySelector('.ideal-goal-status').textContent, /^完成済み: Bob/);
  assert.equal(done.querySelector('.ideal-goal-action').hidden, true);
  view.destroy();
});
