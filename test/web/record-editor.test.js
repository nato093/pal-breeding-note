import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, descendants } from '../helpers/dom.js';
import { openRecordEditor } from '../../web/js/ui/record-editor.js';
import { createDevelopmentApi } from '../../dev/mock-api.js';
import { createApi, ApiError } from '../../web/js/api.js';
import { createStore, safeStorage } from '../../web/js/store.js';

const initial = { parent1Id: 'SheepBall', parent2Id: 'FlowerDoll', childId: 'MoonQueen' };
const buttonNamed = (node, text) => descendants(node).find((child) => child.tagName === 'button' && child.textContent === text);

async function setup(t, { records = [], mutate } = {}) {
  const { body, events, windowEvents } = installDom(t);
  const api = createApi({ transport: createDevelopmentApi() });
  const store = createStore({ api, storage: safeStorage(null) });
  await store.signup('自分', '画面試験用の入力');
  await api.request('signup', '画面試験用の入力', { userId: '仲間' });
  for (const record of records) await store.mutate('create', { record: { id: crypto.randomUUID(), ...record } });
  await store.refresh();
  const calls = [];
  const originalMutate = store.mutate;
  store.mutate = async (action, payload) => {
    calls.push({ action, payload });
    return mutate ? mutate(action, payload) : originalMutate(action, payload);
  };
  const merges = [];
  const context = { store, async merge(...args) { merges.push(args); } };
  return { body, events, windowEvents, store, calls, merges, context };
}

async function selectPal(modal, index, query) {
  const picker = modal.body.querySelectorAll('.picker')[index];
  await picker.querySelector('button').dispatch('click');
  const search = modal.dialog.querySelector('.picker-search');
  search.value = query;
  await search.dispatch('input');
  const option = modal.dialog.querySelectorAll('[role="option"]')[0];
  assert.ok(option, query);
  await option.dispatch('click');
}

for (const editing of [false, true]) {
  test(`${editing ? '編集' : '登録'}画面: 背景クリックは入力を保ち、候補が開いていれば候補だけを閉じる`, async (t) => {
    const { context, events } = await setup(t);
    const modal = openRecordEditor(context, { ...initial, ...(editing ? { id: '編集中' } : {}) });
    const memo = modal.body.querySelector('textarea');
    memo.value = '入力を残す';
    await modal.dialog.dispatch('click');
    assert.equal(modal.dialog.open, true);
    const trigger = modal.body.querySelector('.picker-trigger');
    await trigger.dispatch('click');
    const popup = modal.dialog.querySelector('.picker-popover');
    assert.equal(popup.parentElement, modal.dialog);
    assert.equal(modal.body.querySelector('.picker-popover'), null);
    await events.dispatch('pointerdown', { target: popup.querySelector('input') });
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    await events.dispatch('pointerdown', { target: modal.dialog });
    await modal.dialog.dispatch('click');
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(modal.dialog.querySelector('.picker-popover'), null);
    assert.equal(modal.dialog.open, true);
    assert.equal(memo.value, '入力を残す');
    assert.match(trigger.textContent, /モコロン/);
    await modal.close();
  });
}

test('登録画面: 候補外の本文クリックとフォーカス移動は候補だけを閉じる', async (t) => {
  const { context, events } = await setup(t);
  const modal = openRecordEditor(context, initial);
  const trigger = modal.body.querySelector('.picker-trigger');
  const memo = modal.body.querySelector('textarea');
  await trigger.dispatch('click');
  await events.dispatch('pointerdown', { target: memo });
  assert.equal(modal.dialog.querySelector('.picker-popover'), null);
  assert.equal(modal.dialog.open, true);
  await trigger.dispatch('click');
  const popup = modal.dialog.querySelector('.picker-popover');
  popup.querySelector('input').focus();
  await popup.dispatch('focusout');
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  memo.focus();
  await popup.dispatch('focusout');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(modal.dialog.open, true);
  await modal.close();
});

test('登録画面: Esc は候補を先に閉じ、次の Esc・×・キャンセルは画面を閉じる', async (t) => {
  const { context } = await setup(t);
  let modal = openRecordEditor(context);
  await modal.body.querySelector('.picker-trigger').dispatch('click');
  const escaped = await modal.dialog.querySelector('.picker-search').dispatch('keydown', { key: 'Escape' });
  assert.equal(escaped.defaultPrevented, true);
  assert.equal(escaped.propagationStopped, true);
  assert.equal(modal.dialog.querySelector('.picker-popover'), null);
  assert.equal(modal.dialog.open, true);
  await modal.body.querySelector('.picker-trigger').dispatch('click');
  assert.equal((await modal.dialog.dispatch('cancel')).defaultPrevented, true);
  assert.equal(modal.dialog.open, true);
  await modal.dialog.dispatch('cancel');
  assert.equal(modal.dialog.open, false);
  modal = openRecordEditor(context);
  await modal.dialog.querySelector('.icon-button').dispatch('click');
  assert.equal(modal.dialog.open, false);
  modal = openRecordEditor(context);
  await buttonNamed(modal.footer, 'キャンセル').dispatch('click');
  assert.equal(modal.dialog.open, false);
});

test('登録画面: 候補内スクロールは開いたまま、本文スクロール・リサイズ・終了で候補と監視を片付ける', async (t) => {
  const { context, events, windowEvents } = await setup(t);
  const modal = openRecordEditor(context);
  const trigger = modal.body.querySelector('.picker-trigger');
  await trigger.dispatch('click');
  await events.dispatch('scroll', { target: modal.dialog.querySelector('.picker-options') });
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  await events.dispatch('scroll', { target: modal.body });
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(modal.dialog.open, true);
  await trigger.dispatch('click');
  await windowEvents.dispatch('resize');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  await trigger.dispatch('click');
  await modal.close();
  assert.equal(modal.dialog.querySelector('.picker-popover'), null);
  for (const event of ['scroll', 'pointerdown']) assert.equal(events.listeners.get(event).length, 0);
  assert.equal(windowEvents.listeners.get('resize').length, 0);
  assert.equal(modal.dialog.listeners.get('cancel').length, 0);
});

test('登録画面: 候補はトリガーに合わせて配置し、狭い画面や下端では幅と高さを調整する', async (t) => {
  const { context, windowEvents } = await setup(t);
  const modal = openRecordEditor(context);
  const trigger = modal.body.querySelector('.picker-trigger');
  modal.dialog.getBoundingClientRect = () => ({ left: 240, width: 800 });
  trigger.getBoundingClientRect = () => ({ left: 800, top: 200, bottom: 252, width: 220 });
  await trigger.dispatch('click');
  let popup = modal.dialog.querySelector('.picker-popover');
  assert.equal(popup.style.getPropertyValue('--picker-left'), '700px');
  assert.equal(popup.style.getPropertyValue('--picker-width'), '320px');
  assert.equal(popup.style.getPropertyValue('--picker-top'), '256px');
  assert.equal(popup.style.getPropertyValue('--picker-max-height'), '400px');
  windowEvents.innerWidth = 300;
  windowEvents.innerHeight = 400;
  await windowEvents.dispatch('resize');
  modal.dialog.getBoundingClientRect = () => ({ left: 12, width: 276 });
  trigger.getBoundingClientRect = () => ({ left: 100, top: 320, bottom: 372, width: 176 });
  await trigger.dispatch('click');
  popup = modal.dialog.querySelector('.picker-popover');
  assert.equal(popup.style.getPropertyValue('--picker-left'), '12px');
  assert.equal(popup.style.getPropertyValue('--picker-width'), '276px');
  assert.equal(popup.style.getPropertyValue('--picker-bottom'), '84px');
  assert.equal(popup.style.getPropertyValue('--picker-max-height'), '304px');
  await modal.close();
});

test('登録画面: 未選択から始まり、登録者とメモを常時表示し、通常保存は閉じる', async (t) => {
  const { context, calls } = await setup(t);
  const modal = openRecordEditor(context);
  assert.deepEqual(modal.body.querySelectorAll('.picker-trigger').map((node) => node.textContent), Array(3).fill('パルを選択'));
  assert.deepEqual(modal.footer.children.map((node) => node.textContent), ['キャンセル', '続けて登録', '登録']);
  assert.equal(modal.body.querySelector('details'), null);
  assert.equal(modal.body.querySelector('summary'), null);
  const form = modal.body.querySelector('form');
  const registrant = form.querySelector('select');
  const memo = form.querySelector('textarea');
  assert.deepEqual(form.children.slice(2, 4), [registrant.parentElement, memo.parentElement]);
  assert.deepEqual(form.querySelectorAll('.field-label').map((node) => node.textContent), ['親1', '親2', '子', '登録者', 'メモ（200文字まで）']);
  assert.equal(registrant.value, '自分');
  assert.deepEqual(registrant.children.map((node) => node.value), ['自分', '仲間']);
  assert.equal(modal.body.querySelectorAll('select').length, 1);
  assert.equal(modal.body.querySelectorAll('input').length, 0);
  assert.equal(memo.maxLength, 200);
  await buttonNamed(modal.footer, '登録').dispatch('click');
  assert.equal(calls.length, 0);
  assert.match(modal.body.querySelector('.form-errors').textContent, /親1:.*親2:.*子:/);
  for (const [index, query] of ['モコロン', 'フラリーナ', 'セレムーン'].entries()) await selectPal(modal, index, query);
  registrant.value = '仲間';
  await buttonNamed(modal.footer, '登録').dispatch('click');
  assert.equal(calls[0].action, 'create');
  assert.equal(calls[0].payload.record.registrant, '仲間');
  assert.equal(calls[0].payload.record.parent1Gender, '');
  assert.equal(calls[0].payload.record.parent2Gender, '');
  assert.equal(modal.dialog.open, false);
});

for (const serverValidation of [false, true]) {
  test(`登録画面: ${serverValidation ? 'サーバーの登録者' : 'メモの文字数'}エラーでも入力欄と入力内容を保つ`, async (t) => {
    const { context, calls } = await setup(t, { mutate: serverValidation ? () => {
      throw new ApiError('VALIDATION', { errors: [{ field: 'registrant', code: 'TOO_LONG' }] });
    } : undefined });
    const modal = openRecordEditor(context, initial);
    const registrant = modal.body.querySelector('select');
    const memo = modal.body.querySelector('textarea');
    registrant.value = '仲間';
    memo.value = serverValidation ? '入力したメモ' : 'あ'.repeat(201);
    await buttonNamed(modal.footer, '登録').dispatch('click');
    assert.equal(calls.length, serverValidation ? 1 : 0);
    assert.equal(modal.dialog.open, true);
    assert.equal(modal.body.querySelector('details'), null);
    assert.equal(modal.body.querySelector('select'), registrant);
    assert.equal(modal.body.querySelector('textarea'), memo);
    assert.equal(registrant.value, '仲間');
    assert.equal(memo.value, serverValidation ? '入力したメモ' : 'あ'.repeat(201));
    assert.match(modal.body.querySelector('.form-errors').textContent, serverValidation ? /登録者:.*上限/ : /メモ:.*上限/);
    await modal.close();
  });
}

test('登録画面: 続けて登録は親1・登録者を保ち、残りを消し、別 ID で次を登録する', async (t) => {
  const { context, calls, body } = await setup(t);
  const modal = openRecordEditor(context, initial);
  const registrant = modal.body.querySelector('select');
  registrant.value = '仲間';
  modal.body.querySelector('textarea').value = '最初のメモ';
  await buttonNamed(modal.footer, '続けて登録').dispatch('click');
  assert.equal(modal.dialog.open, true);
  const pickers = modal.body.querySelectorAll('.picker-trigger');
  assert.match(pickers[0].textContent, /モコロン/);
  assert.equal(pickers[1].textContent, 'パルを選択');
  assert.equal(pickers[2].textContent, 'パルを選択');
  assert.equal(registrant.value, '仲間');
  assert.equal(modal.body.querySelector('textarea').value, '');
  assert.equal(document.activeElement, pickers[1]);
  assert.match(body.textContent, /続けて登録できます/);
  await selectPal(modal, 1, 'ツッパニャン');
  await selectPal(modal, 2, 'セレムーン');
  const form = modal.body.querySelector('form');
  const submit = buttonNamed(modal.footer, '登録');
  assert.equal(submit.type, 'submit');
  assert.equal(submit.getAttribute('form'), form.id);
  await form.dispatch('submit');
  assert.equal(modal.dialog.open, false);
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].payload.record.id, calls[1].payload.record.id);
  assert.equal(calls[1].payload.record.memo, '');
  assert.equal(calls[1].payload.record.registrant, '仲間');
});

test('登録画面: 保存中は両ボタンと Enter の二重送信を防ぐ', async (t) => {
  let finish;
  const { context, calls } = await setup(t, { mutate: () => new Promise((resolve) => { finish = resolve; }) });
  const modal = openRecordEditor(context, initial);
  const continuous = buttonNamed(modal.footer, '続けて登録');
  const submit = buttonNamed(modal.footer, '登録');
  const saving = continuous.dispatch('click');
  assert.equal(submit.disabled, true);
  assert.equal(continuous.disabled, true);
  await submit.dispatch('click');
  await continuous.dispatch('click');
  await modal.body.querySelector('form').dispatch('submit');
  assert.equal(calls.length, 1);
  finish({});
  await saving;
  assert.equal(submit.disabled, false);
  assert.equal(continuous.disabled, false);
  await modal.close();
});

test('登録画面: 新規の重複はフォーム内に表示し、閉じずに入力を残す', async (t) => {
  const { context, calls, body } = await setup(t, { records: [initial] });
  const modal = openRecordEditor(context, initial);
  const warning = modal.body.querySelector('.editor-warning');
  assert.match(warning.textContent, /この組み合わせは登録済み: → セレムーン/);
  assert.doesNotMatch(warning.textContent, /確認|\+1/);
  await buttonNamed(modal.footer, '登録').dispatch('click');
  assert.equal(modal.dialog.open, true);
  assert.equal(body.querySelectorAll('dialog').length, 1);
  assert.equal(modal.body.querySelector('.form-errors').textContent, '同じ配合がすでに登録されています。');
  assert.deepEqual(calls.map((call) => call.action), ['create']);
  assert.match(modal.body.querySelectorAll('.picker-trigger')[2].textContent, /セレムーン/);
  await modal.close();
});

for (const registrant of ['古い登録者', '']) {
  test(`登録画面: 編集の一覧外の登録者「${registrant}」と、親を変えない場合の性別を保持する`, async (t) => {
    const { context, store, calls } = await setup(t, { records: [{ ...initial, registrant, parent1Gender: 'M', parent2Gender: 'F' }] });
    const original = store.state.records[0];
    const modal = openRecordEditor(context, original);
    assert.equal(modal.body.querySelector('details'), null);
    assert.equal(modal.body.querySelector('summary'), null);
    assert.deepEqual(modal.footer.children.map((node) => node.textContent), ['キャンセル', '変更を保存']);
    const selected = modal.body.querySelector('select');
    assert.equal(selected.children[0].value, registrant);
    assert.equal(selected.value, registrant);
    await selectPal(modal, 2, 'ツッパニャン');
    await buttonNamed(modal.footer, '変更を保存').dispatch('click');
    assert.equal(calls[0].action, 'update');
    assert.equal(calls[0].payload.record.parent1Gender, original.parent1Gender);
    assert.equal(calls[0].payload.record.parent2Gender, original.parent2Gender);
    assert.equal(calls[0].payload.record.registrant, registrant);
    assert.equal(modal.dialog.open, false);
  });
}

test('登録画面: 親を変更した編集は両方の性別を空にする', async (t) => {
  const { context, store, calls } = await setup(t, { records: [{ ...initial, parent1Gender: 'M', parent2Gender: 'F' }] });
  const modal = openRecordEditor(context, store.state.records[0]);
  await selectPal(modal, 0, 'ツッパニャン');
  await buttonNamed(modal.footer, '変更を保存').dispatch('click');
  assert.equal(calls[0].payload.record.parent1Gender, '');
  assert.equal(calls[0].payload.record.parent2Gender, '');
});

test('登録画面: × で親を解除すると未選択に戻り、保存時に必須エラーを表示する', async (t) => {
  const { context, calls } = await setup(t);
  const modal = openRecordEditor(context, initial);
  const picker = modal.body.querySelectorAll('.picker')[0];
  await picker.querySelector('.picker-clear').dispatch('click');
  assert.equal(picker.querySelector('.picker-trigger').textContent, 'パルを選択');
  assert.equal(document.activeElement, picker.querySelector('.picker-trigger'));
  await buttonNamed(modal.footer, '登録').dispatch('click');
  assert.match(modal.body.querySelector('.form-errors').textContent, /親1:/);
  assert.equal(calls.length, 0);
  await modal.close();
});

test('登録画面: 編集の重複は確認回数の文言なしで統合を提案する', async (t) => {
  const { context, store, merges, body } = await setup(t, { records: [initial], mutate: () => {
    throw new ApiError('DUPLICATE', { existing: store.state.records[0] });
  } });
  const original = store.state.records[0];
  const modal = openRecordEditor(context, original);
  const saving = buttonNamed(modal.footer, '変更を保存').dispatch('click');
  await new Promise((resolve) => setImmediate(resolve));
  const confirm = body.querySelectorAll('dialog')[1];
  assert.ok(confirm);
  assert.match(confirm.textContent, /編集中の登録を既存の登録に統合/);
  assert.doesNotMatch(confirm.textContent, /確認回数|\+1/);
  await buttonNamed(confirm, '統合').dispatch('click');
  await saving;
  assert.deepEqual(merges[0], [original, original, { ask: false }]);
  assert.equal(modal.dialog.open, false);
});

test('登録画面: 別の子の確認を承認すると連続登録のまま保存する', async (t) => {
  const { context, body, calls, store } = await setup(t, { records: [initial] });
  const modal = openRecordEditor(context, { ...initial, childId: 'CatMage' });
  const saving = buttonNamed(modal.footer, '続けて登録').dispatch('click');
  await new Promise((resolve) => setImmediate(resolve));
  const confirm = body.querySelectorAll('dialog')[1];
  assert.match(confirm.textContent, /別の結果として登録しますか/);
  assert.doesNotMatch(confirm.textContent, /性別違い|性別の入力|確認回数/);
  await buttonNamed(confirm, '別の結果として保存').dispatch('click');
  await saving;
  assert.equal(modal.dialog.open, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].payload.allowDifferentChild, true);
  assert.equal(calls[0].payload.record.id, calls[1].payload.record.id);
  assert.equal(store.state.records.length, 2);
  await modal.close();
});

test('登録画面: 競合の読み直しで最新の登録者と性別を保持する', async (t) => {
  const { context, body, calls, store } = await setup(t, { records: [{ ...initial, registrant: '古い登録者', parent1Gender: 'M' }] });
  const original = store.state.records[0];
  const modal = openRecordEditor(context, { ...original, etag: '古い値' });
  const saving = buttonNamed(modal.footer, '変更を保存').dispatch('click');
  await new Promise((resolve) => setImmediate(resolve));
  const confirm = body.querySelectorAll('dialog')[1];
  await buttonNamed(confirm, '最新の内容を読み込む').dispatch('click');
  await saving;
  assert.equal(modal.body.querySelector('select').value, '古い登録者');
  modal.body.querySelector('textarea').value = '再編集';
  await buttonNamed(modal.footer, '変更を保存').dispatch('click');
  assert.equal(calls[1].payload.expectedEtag, original.etag);
  assert.equal(calls[1].payload.record.parent1Gender, original.parent1Gender);
  assert.equal(calls[1].payload.record.parent2Gender, original.parent2Gender);
});
