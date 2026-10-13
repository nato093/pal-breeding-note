import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from '../helpers/dom.js';
import passives from '../../web/data/passives.js';
import { passiveSelector, passiveGroups, passiveChip } from '../../web/js/ui/passive-picker.js';
import { captureFocus, restoreFocus } from '../../web/js/ui/focus.js';

// 呼び出し側と同じく、onChange を受けたら作り直さずに update で選んだものを合わせる
function mount(t, options = {}) {
  const dom = installDom(t);
  const changes = [];
  const follow = options.follow ?? true;
  const selector = passiveSelector({
    label: '欲しいパッシブ', selected: [],
    onChange: (ids) => { changes.push(ids); if (follow) selector.update({ selected: ids }); },
    ...options,
  });
  t.after(() => selector.destroy());
  dom.body.append(selector.element);
  const add = selector.element.querySelector('.passive-add');
  const option = (id) => selector.element.querySelector(`[data-value="${id}"]`);
  const options_ = () => selector.element.querySelectorAll('[role="option"]');
  const groupLabels = () => selector.element.querySelector('.passive-options').querySelectorAll('.passive-group-label').map((node) => node.textContent);
  const search = () => selector.element.querySelector('.picker-search');
  return { ...dom, selector, changes, add, option, options: options_, groupLabels, search };
}

test('パッシブ選択: 追加のボタンと選んだチップを 1 行に並べ、ボタンで開くポップオーバーで選ぶ', async (t) => {
  const { selector, add, search } = mount(t, { selected: ['Rare'] });
  const row = selector.element.querySelector('.passive-row');
  assert.equal(row.children[0], add);
  assert.equal(row.children[1].className, 'passive-chips');
  assert.equal(row.querySelectorAll('.passive-chip').length, 1);
  assert.equal(add.textContent, 'パッシブを追加…');
  assert.equal(add.getAttribute('aria-label'), '欲しいパッシブを追加');
  assert.equal(add.getAttribute('aria-haspopup'), 'listbox');
  assert.equal(add.getAttribute('data-focus-key'), 'passive:欲しいパッシブ');
  assert.equal(add.getAttribute('aria-expanded'), 'false');
  assert.equal(search(), null);
  await add.dispatch('click');
  assert.equal(add.getAttribute('aria-expanded'), 'true');
  assert.equal(document.activeElement, search());
  assert.equal(search().placeholder, '名前・効果で探す');
  // もう一度押すと閉じて、ボタンへ
  await add.dispatch('click');
  assert.equal(search(), null);
  assert.equal(document.activeElement, add);
});

test('パッシブ選択: 閉じたボタンで ↓ を押すと開くだけで、勝手に追加しない', async (t) => {
  const { add, changes, search } = mount(t);
  add.focus();
  const pressed = await add.dispatch('keydown', { key: 'ArrowDown' });
  assert.equal(pressed.defaultPrevented, true);
  assert.ok(search());
  assert.deepEqual(changes, []);
});

test('パッシブ選択: 候補を押すとその場で onChange を 1 回呼び、ポップオーバーは開いたまま続けて選べる', async (t) => {
  const { add, changes, option, search, selector } = mount(t, { counts: new Map([['Rare', 2]]) });
  await add.dispatch('click');
  assert.equal((await option('Rare').dispatch('mousedown')).defaultPrevented, true);
  await option('Rare').dispatch('click');
  assert.deepEqual(changes, [['Rare']]);
  assert.ok(search());
  assert.equal(document.activeElement, search());
  // 選んだものは候補から外れ、チップになる
  assert.equal(option('Rare'), null);
  assert.deepEqual(selector.element.querySelectorAll('.passive-remove').map((node) => node.getAttribute('aria-label')), ['希少 を外す']);
  await option('Legend').dispatch('click');
  assert.deepEqual(changes, [['Rare'], ['Rare', 'Legend']]);
  assert.match(selector.element.querySelector('.picker-status').textContent, /あと 2 個まで選べます/);
});

test('パッシブ選択: 名前・英名・効果で探せ、空白で区切るとすべてを含むものに絞る', async (t) => {
  const { add, options, search } = mount(t);
  await add.dispatch('click');
  const input = search();
  input.value = '攻撃';
  await input.dispatch('input');
  const ids = options().map((node) => node.getAttribute('data-value'));
  const expected = passives.filter((passive) => passive.std && [passive.ja, passive.en, passive.desc].some((text) => text.includes('攻撃'))).map((passive) => passive.id);
  assert.deepEqual([...ids].sort(), [...expected].sort());
  input.value = 'legend';
  await input.dispatch('input');
  assert.deepEqual(options().map((node) => node.getAttribute('data-value')), ['Legend']);
  input.value = '攻撃 防御';
  await input.dispatch('input');
  assert.ok(options().length > 0);
  assert.ok(options().every((node) => /攻撃/.test(node.textContent) && /防御/.test(node.textContent)));
  input.value = '見つからない語';
  await input.dispatch('input');
  assert.equal(options().length, 0);
  assert.match(input.parentElement.textContent, /当てはまるパッシブがありません/);
});

test('パッシブ選択: 候補の行は小さいチップ・効果・所持数「N 体」。群は所持数のあるもの → その他で、所持数 → ランクの順', async (t) => {
  const { add, option, groupLabels, options } = mount(t, { counts: new Map([['Noukin', 5], ['Rare', 2], ['Legend', 2]]), countLabel: 'いまの絞り込みの中で持っているもの' });
  await add.dispatch('click');
  assert.deepEqual(groupLabels(), ['いまの絞り込みの中で持っているもの', 'その他']);
  assert.deepEqual(options().slice(0, 3).map((node) => node.getAttribute('data-value')), ['Noukin', 'Legend', 'Rare']);
  const row = option('Noukin');
  assert.match(row.querySelector('.passive-chip').className, /compact/);
  assert.equal(row.querySelector('.passive-option-count').textContent, '5 体');
  assert.ok(row.querySelector('.passive-option-desc').textContent.length > 0);
  // 所持数のない候補には数を出さない
  assert.equal(option('WorldTree_ATK').querySelector('.passive-option-count'), null);
  // 群の見出しは矢印で選ぶ対象にしない
  const headings = add.parentElement.parentElement.querySelectorAll('.passive-group-label');
  assert.ok(headings.every((node) => node.getAttribute('role') === 'presentation'));
});

test('パッシブ選択: update で所持数が変わっても閉じず、検索語・フォーカス・矢印の位置を保つ', async (t) => {
  const { add, selector, search, option } = mount(t, { counts: new Map([['Rare', 1]]) });
  await add.dispatch('click');
  const input = search();
  input.value = '希少';
  await input.dispatch('input');
  await input.dispatch('keydown', { key: 'ArrowDown' });
  const active = input.getAttribute('aria-activedescendant');
  assert.equal(option('Rare').id, active);
  selector.update({ counts: new Map([['Rare', 7]]) });
  assert.equal(search(), input);
  assert.equal(input.value, '希少');
  assert.equal(document.activeElement, input);
  assert.equal(option('Rare').querySelector('.passive-option-count').textContent, '7 体');
  assert.equal(input.getAttribute('aria-activedescendant'), option('Rare').id);
  assert.match(option('Rare').className, /highlighted/);
});

test('パッシブ選択: ↑↓ で選んでいないときの Enter は何もせず、矢印で選んだ候補だけを Enter で足す', async (t) => {
  const { add, changes, search, options } = mount(t);
  await add.dispatch('click');
  const input = search();
  await input.dispatch('keydown', { key: 'Enter' });
  assert.deepEqual(changes, []);
  await input.dispatch('keydown', { key: 'ArrowDown' });
  const first = options()[0].getAttribute('data-value');
  await input.dispatch('keydown', { key: 'Enter' });
  assert.deepEqual(changes, [[first]]);
  // 足した直後は矢印の位置がないので、Enter をもう一度押しても足さない
  await input.dispatch('keydown', { key: 'Enter' });
  assert.equal(changes.length, 1);
  // ↓ で、抜けて繰り上がった次の候補から動く
  const next = options()[0].getAttribute('data-value');
  await input.dispatch('keydown', { key: 'ArrowDown' });
  assert.equal(input.getAttribute('aria-activedescendant'), options()[0].id);
  await input.dispatch('keydown', { key: 'Enter' });
  assert.deepEqual(changes.at(-1), [first, next]);
  // Escape で閉じて追加のボタンへ
  const escaped = await input.dispatch('keydown', { key: 'Escape' });
  assert.equal(escaped.propagationStopped, true);
  assert.equal(search(), null);
  assert.equal(document.activeElement, add);
});

test('パッシブ選択: max 個に達したら閉じて最後のチップの × へ、× で外すと追加のボタンへフォーカスを移す', async (t) => {
  const { add, option, search, selector } = mount(t, { selected: ['Rare', 'Legend', 'Noukin'] });
  await add.dispatch('click');
  await option('WorldTree_ATK').dispatch('click');
  assert.equal(search(), null);
  assert.equal(add.disabled, true);
  assert.equal(add.textContent, '最大 4 個まで');
  assert.equal(document.activeElement.getAttribute('data-focus-key'), 'passive-chip:欲しいパッシブ:WorldTree_ATK');
  // 押せないボタンでは開かない
  await add.dispatch('click');
  await add.dispatch('keydown', { key: 'ArrowDown' });
  assert.equal(search(), null);
  await document.activeElement.dispatch('click');
  assert.equal(add.disabled, false);
  assert.equal(document.activeElement, add);
  assert.equal(selector.element.querySelectorAll('.passive-chip').length, 3);
});

test('パッシブ選択: 同じ id のチップは update で使い回し、フォーカスが外にあれば max でもフォーカスを動かさない', (t) => {
  const { selector, body } = mount(t, { selected: ['Rare'] });
  const chip = selector.element.querySelector('.passive-chip');
  selector.update({ selected: ['Rare', 'Legend'] });
  assert.equal(selector.element.querySelector('.passive-chip'), chip);
  body.focus();
  selector.update({ selected: ['Rare', 'Legend', 'Noukin', 'WorldTree_ATK'] });
  assert.equal(document.activeElement, body);
});

test('パッシブ選択: negatives が last なら負のパッシブを最後の群「マイナスのパッシブ」に、inline なら群の中に混ぜる', () => {
  const counts = new Map([['CraftSpeed_down1', 3], ['Rare', 1]]);
  const last = passiveGroups({ counts, negatives: 'last' });
  assert.deepEqual(last.map((group) => group.label), ['所持パルが持っているもの', 'その他', 'マイナスのパッシブ']);
  const minus = last.at(-1).items;
  assert.ok(minus.every(({ id }) => passives.find((passive) => passive.id === id).rank < 0));
  assert.deepEqual(minus[0], { id: 'CraftSpeed_down1', count: 3 });
  assert.ok(!last.slice(0, -1).some((group) => group.items.some(({ id }) => passives.find((passive) => passive.id === id)?.rank < 0)));
  const inline = passiveGroups({ counts, negatives: 'inline' });
  assert.deepEqual(inline.map((group) => group.label), ['所持パルが持っているもの', 'その他']);
  assert.deepEqual(inline[0].items.map(({ id }) => id), ['CraftSpeed_down1', 'Rare']);
});

test('パッシブ選択: groups を渡すと、その群の順に分け（同じパッシブは最初の群だけ）、マスターに無い内部名も出す', async (t) => {
  const groups = [
    { label: 'モコロンと配合の親が持っているもの', counts: new Map([['Rare', 2]]) },
    { label: 'ほかの所持パルが持っているもの', counts: new Map([['Rare', 4], ['Legend', 1], ['Unknown_Passive_X', 3]]) },
  ];
  assert.deepEqual(passiveGroups({ groups, negatives: 'last' }).slice(0, 2).map((group) => [group.label, group.items]), [
    ['モコロンと配合の親が持っているもの', [{ id: 'Rare', count: 2 }]],
    ['ほかの所持パルが持っているもの', [{ id: 'Unknown_Passive_X', count: 3 }, { id: 'Legend', count: 1 }]],
  ]);
  const { add, option, groupLabels } = mount(t, { groups, negatives: 'last' });
  await add.dispatch('click');
  assert.deepEqual(groupLabels(), ['モコロンと配合の親が持っているもの', 'ほかの所持パルが持っているもの', 'その他', 'マイナスのパッシブ']);
  assert.match(option('Unknown_Passive_X').textContent, /Unknown_Passive_X/);
  assert.equal(option('Unknown_Passive_X').querySelector('.passive-option-count').textContent, '3 体');
});

test('パッシブ選択: 保存した目標の組み合わせを押すと、選択をその組で置き換える（1 回の onChange）', async (t) => {
  const presets = [{ label: '作業用', passives: ['CraftSpeed_up2', 'Rare'] }, { label: '戦闘用', passives: ['Legend', 'PAL_ALLAttack_up3', 'Noukin', 'Rare', 'WorldTree_ATK'] }];
  const { add, changes, selector, search } = mount(t, { selected: ['Legend'], presets });
  await add.dispatch('click');
  const box = selector.element.querySelector('.passive-presets');
  assert.equal(box.hidden, false);
  assert.match(box.textContent, /^保存した目標の組み合わせ/);
  const buttons = box.querySelectorAll('.passive-preset');
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].getAttribute('aria-label'), '保存した目標の組み合わせ「作業用」で選び直す: 職人気質、希少');
  assert.equal(buttons[0].querySelectorAll('.passive-chip').length, 2);
  await buttons[0].dispatch('click');
  assert.deepEqual(changes, [['CraftSpeed_up2', 'Rare']]);
  assert.ok(search());
  // 組の数が max を超えていても max 個まで
  await buttons[1].dispatch('click');
  assert.deepEqual(changes.at(-1), ['Legend', 'PAL_ALLAttack_up3', 'Noukin', 'Rare']);
  assert.equal(search(), null);
  // 保存した目標の組み合わせが無ければ欄ごと隠す
  selector.update({ selected: [], presets: [] });
  await add.dispatch('click');
  assert.equal(selector.element.querySelector('.passive-presets').hidden, true);
});

test('パッシブ選択: Escape・外側の pointerdown・destroy で閉じ、document のリスナーを外す', async (t) => {
  const { add, search, events, body, selector } = mount(t);
  await add.dispatch('click');
  await events.dispatch('pointerdown', { target: search() });
  assert.ok(search());
  await events.dispatch('pointerdown', { target: body });
  assert.equal(search(), null);
  await add.dispatch('click');
  selector.destroy();
  assert.equal(search(), null);
  assert.equal((events.listeners.get('pointerdown') ?? []).length, 0);
  assert.equal((events.listeners.get('keydown') ?? []).length, 0);
});

test('パッシブのチップ: compact で小さいチップにし、× の目印は部品のラベルと ID', (t) => {
  installDom(t);
  const chip = passiveChip('Rare', { compact: true });
  assert.equal(chip.className, 'passive-chip passive-rank-4 compact');
  assert.equal(chip.querySelector('.passive-remove'), null);
  const removable = passiveChip('Rare', { onRemove() {}, focusGroup: 'passive:欲しいパッシブ' });
  assert.doesNotMatch(removable.className, /compact/);
  assert.equal(removable.querySelector('.passive-remove').getAttribute('data-focus-key'), 'passive-chip:欲しいパッシブ:Rare');
});

test('パッシブ選択: × のフォーカスの目印は部品のラベルごとなので、作り直した後に別の部品の同じパッシブの × へは移らない', (t) => {
  const { body } = installDom(t);
  const root = document.createElement('div');
  body.append(root);
  const carry = passiveSelector({ label: '運びたいパッシブ', selected: ['Rare'], onChange() {} });
  const filter = passiveSelector({ label: 'パッシブ（すべて持つ個体）', selected: ['Rare'], onChange() {} });
  t.after(() => { carry.destroy(); filter.destroy(); });
  root.append(carry.element);
  carry.element.querySelector('.passive-remove').focus();
  const token = captureFocus(root);
  // 別の画面に作り直した（同じパッシブを選んだ別の部品だけがある）
  root.replaceChildren(filter.element);
  assert.equal(restoreFocus(root, token), false);
  assert.equal(document.activeElement, body);
});

test('パッシブ選択: update の disabled で追加のボタンと × を押せなくし（開いていれば閉じる）、選んだチップは残す', async (t) => {
  const { selector, add, search } = mount(t, { selected: ['Rare'] });
  await add.dispatch('click');
  assert.ok(search());
  selector.update({ disabled: true });
  assert.equal(search(), null);
  assert.equal(add.disabled, true);
  assert.ok(selector.element.className.split(' ').includes('is-disabled'));
  assert.deepEqual(selector.element.querySelectorAll('.passive-remove').map((node) => node.disabled), [true]);
  assert.equal(selector.element.querySelectorAll('.passive-chip').length, 1);
  // 押せない間は開かない
  await add.dispatch('click');
  assert.equal(search(), null);
  // 選び直しても × は押せないまま
  selector.update({ selected: ['Rare', 'Legend'] });
  assert.deepEqual(selector.element.querySelectorAll('.passive-remove').map((node) => node.disabled), [true, true]);
  selector.update({ disabled: false });
  assert.equal(add.disabled, false);
  assert.ok(!selector.element.className.split(' ').includes('is-disabled'));
  assert.deepEqual(selector.element.querySelectorAll('.passive-remove').map((node) => node.disabled), [false, false]);
});

test('パッシブ選択: 候補の一覧の高さを窓の下端までに収める（固定のパネルの中で開いても下がはみ出さない。狭すぎるときは 160px）。組み合わせの段が変われば測り直す', async (t) => {
  const { add, selector, windowEvents } = mount(t, { presets: [{ label: '作業用', passives: ['CraftSpeed_up2', 'Rare'] }] });
  const list = () => selector.element.querySelector('.passive-options');
  // テストの DOM の一覧の上端は 200px。窓の高さ 600px なら、窓の下端から 12px 空けて 388px
  windowEvents.innerHeight = 600;
  await add.dispatch('click');
  assert.equal(list().style.getPropertyValue('--passive-options-max'), '388px');
  // 組み合わせの段が変わると一覧の上端が動くので測り直す（窓が低くなったときも、開き直さずに合う）
  windowEvents.innerHeight = 300;
  selector.update({ presets: [] });
  assert.equal(list().style.getPropertyValue('--passive-options-max'), '160px');
  // ブラウザでは、開くときの動き（transform で縮めて出す）の途中の getBoundingClientRect ではなく、板を置いた要素の位置＋板と一覧の offsetTop で測る
  windowEvents.innerHeight = 600;
  const board = list().parentElement;
  const host = { getBoundingClientRect: () => ({ top: 50 }), clientTop: 1 };
  Object.assign(list(), { offsetParent: board, offsetTop: 150 });
  Object.assign(board, { offsetParent: host, offsetTop: 40 });
  selector.update({ presets: [{ label: '作業用', passives: ['Rare'] }] });
  assert.equal(list().style.getPropertyValue('--passive-options-max'), `${600 - (50 + 1 + 40 + 150) - 12}px`);
});
