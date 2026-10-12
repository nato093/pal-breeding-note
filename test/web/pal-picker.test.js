import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterPals, palPicker } from '../../web/js/ui/pal-picker.js';
import pals from '../../web/data/pals.js';
import { installDom } from '../helpers/dom.js';

function mountPicker(t, options = {}) {
  t.after(() => picker.destroy());
  const dom = installDom(t);
  const changes = [];
  const picker = palPicker({ label: '親1', onChange: (id) => changes.push(id), ...options });
  dom.body.append(picker.element);
  return { ...dom, picker, changes, trigger: picker.element.querySelector('button') };
}

for (const { name, dialogRect, triggerRect, expectedLeft, expectedWidth, alignedRight } of [
  {
    name: 'ダイアログ右端では候補を境界内に収め、右端をトリガーにそろえる',
    dialogRect: { left: 240, width: 800 },
    triggerRect: { left: 775, width: 244 },
    expectedLeft: 699,
    expectedWidth: 320,
    alignedRight: true,
  },
  {
    name: '右寄せでも左にはみ出す場合はダイアログの左端に寄せる',
    dialogRect: { left: 240, width: 340 },
    triggerRect: { left: 300, width: 244 },
    expectedLeft: 240,
    expectedWidth: 320,
  },
  {
    name: '候補が左にはみ出す場合はダイアログの左端に寄せる',
    dialogRect: { left: 240, width: 800 },
    triggerRect: { left: 230, width: 244 },
    expectedLeft: 240,
    expectedWidth: 320,
  },
  {
    name: '狭いダイアログでは候補の幅を境界内に収める',
    dialogRect: { left: 240, width: 280 },
    triggerRect: { left: 260, width: 244 },
    expectedLeft: 240,
    expectedWidth: 280,
  },
  {
    name: 'ダイアログ内で収まる候補はトリガーの左端にそろえる',
    dialogRect: { left: 240, width: 800 },
    triggerRect: { left: 260, width: 244 },
    expectedLeft: 260,
    expectedWidth: 320,
  },
  {
    name: 'ダイアログ外では従来どおり画面の右端で調整する',
    triggerRect: { left: 1150, width: 118 },
    expectedLeft: 948,
    expectedWidth: 320,
  },
]) {
  test(`パル選択: ${name}`, async (t) => {
    t.after(() => picker.destroy());
    const { body } = installDom(t);
    const popupHost = document.createElement(dialogRect ? 'dialog' : 'div');
    if (dialogRect) popupHost.getBoundingClientRect = () => dialogRect;
    body.append(popupHost);
    const picker = palPicker({ label: '子', popupHost, onChange() {} });
    popupHost.append(picker.element);
    const trigger = picker.element.querySelector('.picker-trigger');
    trigger.getBoundingClientRect = () => ({ ...triggerRect, top: 200, bottom: 252 });
    await trigger.dispatch('click');
    const popup = popupHost.querySelector('.picker-popover');
    const left = parseFloat(popup.style.getPropertyValue('--picker-left'));
    const width = parseFloat(popup.style.getPropertyValue('--picker-width'));
    assert.equal(left, expectedLeft);
    assert.equal(width, expectedWidth);
    if (dialogRect) {
      assert.ok(left >= dialogRect.left);
      assert.ok(left + width <= dialogRect.left + dialogRect.width);
    }
    if (alignedRight) assert.equal(left + width, triggerRect.left + triggerRect.width);
    assert.equal(popup.style.getPropertyValue('--picker-top'), '256px');
    assert.equal(popup.style.getPropertyValue('--picker-max-height'), '560px');
  });
}

test('パル選択: 非アクティブを除き、図鑑番号の完全一致を先頭へ並べる', () => {
  assert.ok(filterPals('').every((pal) => pal.active));
  const matches = filterPals('１');
  assert.equal(matches[0].no, 1);
  assert.ok(matches.some((pal) => pal.no > 1));
  assert.equal(filterPals('もころん')[0].ja, 'モコロン');
});

test('パル選択: 検索が空のときは常に図鑑順で通常種から並べる', () => {
  const expected = pals.filter((pal) => pal.active).sort((a, b) => a.no - b.no || Number(a.variant) - Number(b.variant));
  assert.deepEqual(filterPals(''), expected);
  assert.deepEqual(filterPals('　'), expected);
});

test('パル選択: 履歴の読み書きや最近の印を使わず、検索件数を表示する', async (t) => {
  const storage = {
    get() { assert.fail('パル選択はローカル保存を読み込まない'); },
    set() { assert.fail('パル選択はローカル保存に書き込まない'); },
  };
  const { picker, trigger } = mountPicker(t, { storage });
  await trigger.dispatch('click');
  assert.equal(picker.element.querySelector('.picker-status').textContent, '図鑑順で表示');
  assert.equal(picker.element.querySelector('.recent-marker'), null);
  const input = picker.element.querySelector('input');
  input.value = 'フラリーナ';
  await input.dispatch('input');
  assert.equal(picker.element.querySelector('.picker-status').textContent, '1 体のパル');
  await picker.element.querySelector('[role="option"]').dispatch('click');
  await trigger.dispatch('click');
  assert.match(picker.element.querySelectorAll('[role="option"]')[1].textContent, /モコロン/);
  assert.doesNotMatch(picker.element.textContent, /最近/);
});

test('パル選択: 一つの選択ボタンで開き、先頭項目で解除できる', async (t) => {
  const { picker, trigger, changes } = mountPicker(t);
  assert.equal(picker.getValue(), '');
  assert.equal(picker.element.querySelectorAll('button').filter((node) => !node.hidden).length, 1);
  assert.equal(trigger.textContent, 'パルを選択');
  assert.equal(trigger.getAttribute('aria-label'), '親1: パルを選択');
  assert.equal(trigger.getAttribute('aria-haspopup'), 'listbox');
  await trigger.dispatch('click');
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  const options = picker.element.querySelectorAll('[role="option"]');
  assert.equal(options[0].textContent, 'パルを選択');
  assert.equal(options[0].getAttribute('aria-selected'), 'true');
  assert.equal((await options[1].dispatch('mousedown')).defaultPrevented, true);
  await options[1].dispatch('click');
  const id = pals.filter((pal) => pal.active).sort((a, b) => a.no - b.no)[0].id;
  assert.equal(picker.getValue(), id);
  assert.match(trigger.getAttribute('aria-label'), /No\.1 モコロン/);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, trigger);
  await trigger.dispatch('click');
  await picker.element.querySelectorAll('[role="option"]')[0].dispatch('click');
  assert.equal(picker.getValue(), '');
  assert.deepEqual(changes, [id, '']);
});

test('パル選択: × は選択中だけ表示し、解除後はトリガーへ戻る', async (t) => {
  const { picker, trigger, changes } = mountPicker(t);
  const clear = picker.element.querySelector('.picker-clear');
  assert.equal(clear.hidden, true);
  picker.setValue('SheepBall');
  assert.equal(clear.hidden, false);
  assert.equal(clear.getAttribute('aria-label'), '親1の選択を解除');
  assert.equal(clear.title, '親1の選択を解除');
  assert.equal(clear.textContent, '×');
  assert.equal(clear.parentElement, trigger.parentElement);
  assert.equal(trigger.querySelector('button'), null);
  await trigger.dispatch('click');
  clear.focus();
  await clear.dispatch('click');
  assert.equal(picker.element.querySelector('.picker-popover'), null);
  assert.equal(picker.getValue(), '');
  assert.deepEqual(changes, ['']);
  assert.equal(clear.hidden, true);
  assert.equal(trigger.textContent, 'パルを選択');
  assert.equal(document.activeElement, trigger);
  picker.setValue('FlowerDoll');
  assert.equal(clear.hidden, false);
  await clear.dispatch('click');
  assert.equal(document.activeElement, trigger);
  assert.deepEqual(changes, ['', '']);
  picker.setValue('SheepBall');
  picker.setValue('');
  assert.equal(clear.hidden, true);
});

test('パル選択: 検索語がある間は解除項目を出さず、矢印で選ぶまで Enter は反応しない', async (t) => {
  const { picker, trigger, changes } = mountPicker(t);
  await trigger.dispatch('click');
  const input = picker.element.querySelector('input');
  await input.dispatch('keydown', { key: 'Enter' });
  assert.deepEqual(changes, []);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  input.value = 'もころん';
  await input.dispatch('input');
  assert.ok(picker.element.querySelectorAll('[role="option"]').every((node) => node.textContent !== 'パルを選択'));
  await input.dispatch('keydown', { key: 'Enter' });
  assert.deepEqual(changes, []);
  await input.dispatch('keydown', { key: 'ArrowDown' });
  assert.ok(input.getAttribute('aria-activedescendant'));
  await input.dispatch('keydown', { key: 'Enter' });
  assert.deepEqual(changes, ['SheepBall']);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
});

test('パル選択: 解除項目を先頭にし、検索変更で矢印選択をリセットする', async (t) => {
  const { picker, trigger, changes } = mountPicker(t);
  await trigger.dispatch('click');
  const options = picker.element.querySelectorAll('[role="option"]');
  assert.equal(options[0].textContent, 'パルを選択');
  assert.match(options[1].textContent, /モコロン/);
  const input = picker.element.querySelector('input');
  await input.dispatch('keydown', { key: 'ArrowUp' });
  assert.equal(input.getAttribute('aria-activedescendant'), options.at(-1).id);
  await input.dispatch('keydown', { key: 'ArrowDown' });
  assert.equal(input.getAttribute('aria-activedescendant'), options[0].id);
  input.value = '001';
  await input.dispatch('input');
  assert.equal(input.getAttribute('aria-activedescendant'), null);
  await input.dispatch('keydown', { key: 'Enter' });
  assert.deepEqual(changes, []);
});

test('パル選択: Escape・外側クリック・フォーカス移動・破棄で閉じ、選択値を保つ', async (t) => {
  const { picker, trigger, body, events, changes } = mountPicker(t, { value: 'SheepBall' });
  await trigger.dispatch('click');
  await picker.element.querySelector('input').dispatch('keydown', { key: 'Escape' });
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  await trigger.dispatch('click');
  await events.dispatch('pointerdown', { target: picker.element.querySelector('input') });
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  await events.dispatch('pointerdown', { target: body });
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  await trigger.dispatch('click');
  body.focus();
  await picker.element.querySelector('.picker-popover').dispatch('focusout');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  await trigger.dispatch('click');
  picker.destroy();
  assert.equal(picker.element.querySelector('.picker-popover'), null);
  assert.equal((events.listeners.get('pointerdown') ?? []).length, 0);
  assert.equal(picker.getValue(), 'SheepBall');
  assert.deepEqual(changes, []);
});

test('パル選択: 「030」で 30 番、先頭一致が上、英名でも探せ、プレースホルダーで伝える', async (t) => {
  assert.equal(filterPals('030')[0].no, 30);
  // 「8」は番号の前方一致（8・8x 番）だけで、18 番などの部分一致は出さない
  const eights = filterPals('8');
  assert.equal(eights[0].no, 8);
  assert.ok(eights.every((pal) => String(pal.label).startsWith('8')), eights.map((pal) => pal.label).join(','));
  assert.equal(filterPals('Lamball')[0].id, 'SheepBall');
  const { picker, trigger } = mountPicker(t);
  await trigger.dispatch('click');
  assert.equal(picker.element.querySelector('input').placeholder, '名前・英名・番号で探す');
});

test('パル選択: 選んでいる行は is-selected と ✓、矢印の行は highlighted で見分け、↓ は選んでいる行の次から動く', async (t) => {
  const { picker, trigger, changes } = mountPicker(t, { value: 'SheepBall' });
  await trigger.dispatch('click');
  const options = () => picker.element.querySelectorAll('[role="option"]');
  const chosen = options().find((node) => node.getAttribute('aria-selected') === 'true');
  assert.match(chosen.textContent, /モコロン/);
  assert.match(chosen.className, /is-selected/);
  assert.equal(chosen.querySelector('svg').namespaceURI, 'http://www.w3.org/2000/svg');
  assert.doesNotMatch(chosen.className, /highlighted/);
  assert.equal(options().filter((node) => /is-selected/.test(node.className)).length, 1);
  const input = picker.element.querySelector('input');
  // 開いた直後は矢印の位置がないので、Enter は何もしない
  await input.dispatch('keydown', { key: 'Enter' });
  assert.deepEqual(changes, []);
  const index = options().indexOf(chosen);
  await input.dispatch('keydown', { key: 'ArrowDown' });
  assert.equal(input.getAttribute('aria-activedescendant'), options()[index + 1].id);
  assert.match(options()[index + 1].className, /highlighted/);
  assert.doesNotMatch(chosen.className, /highlighted/);
  await input.dispatch('keydown', { key: 'Escape' });
  await trigger.dispatch('click');
  await picker.element.querySelector('input').dispatch('keydown', { key: 'ArrowUp' });
  assert.equal(picker.element.querySelector('input').getAttribute('aria-activedescendant'), options()[index - 1].id);
});

test('パル選択: describe の order で先に並べ、badges を行の右に、dim の行を薄くする（order がなければ並びは変えない）', async (t) => {
  const { picker, trigger } = mountPicker(t, {
    describe: () => ({ order: new Map([['FlowerDoll', 0], ['PinkCat', 0]]), badges: new Map([['PinkCat', '♂1 ♀2']]), dim: new Set(['SheepBall']), orderLabel: '所持している種族を先に表示' }),
  });
  await trigger.dispatch('click');
  const options = picker.element.querySelectorAll('[role="option"]');
  assert.equal(options[0].textContent, 'パルを選択');
  // 同じ順位の中は図鑑順（ツッパニャン 2 番 → フラリーナ）
  assert.match(options[1].textContent, /ツッパニャン/);
  assert.match(options[2].textContent, /フラリーナ/);
  assert.equal(options[1].querySelector('.picker-badge').textContent, '♂1 ♀2');
  assert.equal(options[2].querySelector('.picker-badge'), null);
  const lamb = options.find((node) => /モコロン/.test(node.textContent));
  assert.match(lamb.className, /is-dim/);
  assert.equal(picker.element.querySelector('.picker-status').textContent, '所持している種族を先に表示');
  // 検索語があるときは、一致の段階が先（番号の完全一致）
  const input = picker.element.querySelector('input');
  input.value = '1';
  await input.dispatch('input');
  assert.match(picker.element.querySelectorAll('[role="option"]')[0].textContent, /No\.1モコロン/);
  picker.destroy();

  // order がなければ、注記を付けても図鑑順のまま
  const plain = mountPicker(t, { describe: () => ({ badges: new Map([['PinkCat', '親 3 件']]) }) });
  await plain.trigger.dispatch('click');
  const rows = plain.picker.element.querySelectorAll('[role="option"]');
  assert.match(rows[1].textContent, /モコロン/);
  assert.match(rows[2].textContent, /ツッパニャン親 3 件/);
  assert.equal(plain.picker.element.querySelector('.picker-status').textContent, '図鑑順で表示');
});

test('パル選択: 名前以外（パートナースキル）で一致したら添え書きを出す', async (t) => {
  const { picker, trigger } = mountPicker(t);
  await trigger.dispatch('click');
  const input = picker.element.querySelector('input');
  input.value = 'モコモコ';
  await input.dispatch('input');
  const notes = picker.element.querySelectorAll('.picker-note').map((node) => node.textContent);
  assert.deepEqual(notes, ['パートナースキル: モコモコの盾']);
});

test('パル選択: update は開いたまま注記を描き直し、検索語と矢印の位置を保つ', async (t) => {
  let badge = '親 1 件';
  const { picker, trigger, changes } = mountPicker(t, { describe: () => ({ badges: new Map([['SheepBall', badge]]) }) });
  await trigger.dispatch('click');
  const input = picker.element.querySelector('input');
  input.value = 'もこ';
  await input.dispatch('input');
  await input.dispatch('keydown', { key: 'ArrowDown' });
  const active = input.getAttribute('aria-activedescendant');
  badge = '親 2 件';
  picker.update();
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(picker.element.querySelector('input'), input);
  assert.equal(input.value, 'もこ');
  assert.equal(input.getAttribute('aria-activedescendant'), active);
  assert.equal(picker.element.querySelector('.picker-badge').textContent, '親 2 件');
  await input.dispatch('keydown', { key: 'Enter' });
  assert.deepEqual(changes, ['SheepBall']);
  // 閉じているときの update は何もしない
  picker.update({ describe: () => ({}) });
  assert.equal(picker.element.querySelector('.picker-popover'), null);
});

test('パル選択: 候補を開いたまま setValue で値が変わったら、✓ と選択の印を新しい値に合わせ、検索語・矢印の行・一覧は保つ', async (t) => {
  const { picker, trigger } = mountPicker(t, { value: 'SheepBall' });
  await trigger.dispatch('click');
  const input = picker.element.querySelector('input');
  const list = picker.element.querySelector('.picker-options');
  const options = () => picker.element.querySelectorAll('[role="option"]');
  const rows = options();
  await input.dispatch('keydown', { key: 'ArrowDown' });
  const active = input.getAttribute('aria-activedescendant');
  list.scrollTop = 120;
  picker.setValue('PinkCat');
  assert.equal(trigger.getAttribute('aria-label'), '親1: No.2 ツッパニャン');
  assert.deepEqual(options(), rows);
  const marked = options().filter((node) => /is-selected/.test(node.className));
  assert.equal(marked.length, 1);
  assert.match(marked[0].textContent, /ツッパニャン/);
  assert.equal(marked[0].getAttribute('aria-selected'), 'true');
  assert.equal(marked[0].querySelectorAll('svg').length, 1);
  const lamb = options().find((node) => /モコロン/.test(node.textContent));
  assert.equal(lamb.getAttribute('aria-selected'), 'false');
  assert.equal(lamb.querySelectorAll('svg').length, 0);
  assert.equal(input.getAttribute('aria-activedescendant'), active);
  assert.equal(list.scrollTop, 120);
  // 選択を外したときは、先頭の「パルを選択」の行に印
  picker.setValue('');
  assert.match(options().find((node) => /is-selected/.test(node.className)).textContent, /パルを選択/);
});
