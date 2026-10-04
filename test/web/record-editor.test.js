import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, descendants } from '../helpers/dom.js';
import { openRecordEditor } from '../../web/js/ui/record-editor.js';
import { createDevelopmentApi } from '../../dev/mock-api.js';
import { createApi, ApiError } from '../../web/js/api.js';
import { createStore, safeStorage } from '../../web/js/store.js';
import { toast } from '../../web/js/ui/toast.js';

const initial = { parent1Id: 'SheepBall', parent2Id: 'FlowerDoll', childId: 'MoonQueen' };
const buttonNamed = (node, text) => descendants(node).find((child) => child.tagName === 'button' && child.textContent === text);
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function setup(t, { records = [], mutate } = {}) {
  const { body, events, windowEvents } = installDom(t);
  const development = createDevelopmentApi();
  let held = null;
  let serve = (request) => development(request);
  const api = createApi({ transport: async (request) => { await held; return serve(request, development); } });
  const store = createStore({ api, storage: safeStorage(null) });
  await store.signup('自分', '画面試験用の入力');
  await api.request('signup', '画面試験用の入力', { userId: '仲間' });
  for (const record of records) await store.mutate('create', { record: { id: crypto.randomUUID(), ...record }, allowDifferentChild: true });
  await store.refresh();
  const calls = [];
  const originalMutate = store.mutate;
  store.mutate = async (action, payload) => {
    calls.push({ action, payload });
    return mutate ? mutate(action, payload) : originalMutate(action, payload);
  };
  const merges = [];
  const context = { store, async merge(...args) { merges.push(args); }, register: (initial) => openRecordEditor(context, initial) };
  return {
    body, events, windowEvents, store, api, calls, merges, context,
    // 以降のサーバ応答を止め、返した関数で再開する。
    hold() {
      let release;
      held = new Promise((resolve) => { release = resolve; });
      return () => { held = null; release(); };
    },
    serve(next) { serve = next; },
  };
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

test('登録画面: メモの文字数エラーでも入力欄と入力内容を保つ', async (t) => {
  const { context, calls } = await setup(t);
  const modal = openRecordEditor(context, initial);
  const registrant = modal.body.querySelector('select');
  const memo = modal.body.querySelector('textarea');
  registrant.value = '仲間';
  memo.value = 'あ'.repeat(201);
  await buttonNamed(modal.footer, '登録').dispatch('click');
  assert.equal(calls.length, 0);
  assert.equal(modal.dialog.open, true);
  assert.equal(modal.body.querySelector('details'), null);
  assert.equal(modal.body.querySelector('select'), registrant);
  assert.equal(modal.body.querySelector('textarea'), memo);
  assert.equal(registrant.value, '仲間');
  assert.equal(memo.value, 'あ'.repeat(201));
  assert.match(modal.body.querySelector('.form-errors').textContent, /メモ:.*上限/);
  await modal.close();
});

test('登録画面: サーバに断られたら登録を取り消し、「入力し直す」で入力内容のまま開き直す', async (t) => {
  const { context, store, body, hold, serve } = await setup(t);
  serve((request, next) => request.action === 'create'
    ? { ok: false, code: 'VALIDATION', errors: [{ field: 'registrant', code: 'TOO_LONG' }] } : next(request));
  const release = hold();
  const modal = openRecordEditor(context, initial);
  modal.body.querySelector('select').value = '仲間';
  modal.body.querySelector('textarea').value = '入力したメモ';
  await buttonNamed(modal.footer, '登録').dispatch('click');
  assert.equal(modal.dialog.open, false);
  assert.equal(store.state.records.length, 1);
  assert.doesNotMatch(body.textContent, /配合を登録しました/);
  release();
  await flush();
  assert.equal(store.state.records.length, 0);
  // 成功の知らせは出さず、失敗の知らせだけを出す。
  assert.doesNotMatch(body.textContent, /配合を登録しました/);
  assert.match(body.textContent, /配合を登録できませんでした。入力内容を確認してください。/);
  await buttonNamed(body, '入力し直す').dispatch('click');
  const reopened = body.querySelector('dialog');
  assert.equal(reopened.open, true);
  assert.deepEqual(reopened.querySelectorAll('.picker-trigger').map((node) => node.textContent.match(/モコロン|フラリーナ|セレムーン/)?.[0]),
    ['モコロン', 'フラリーナ', 'セレムーン']);
  assert.equal(reopened.querySelector('select').value, '仲間');
  assert.equal(reopened.querySelector('textarea').value, '入力したメモ');
  await reopened.close();
});

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
  await flush();
  assert.match(body.textContent, /配合を登録しました/);
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

test('登録画面: 保存はサーバの応答を待たずに閉じ、登録済みの配合にすぐ反映し、成功の知らせは応答後に出す', async (t) => {
  const { context, store, calls, hold, body } = await setup(t);
  const release = hold();
  const modal = openRecordEditor(context, initial);
  await buttonNamed(modal.footer, '続けて登録').dispatch('click');
  assert.equal(modal.dialog.open, true);
  assert.equal(store.state.records.length, 1);
  assert.equal(store.state.syncing, true);
  await selectPal(modal, 1, 'ツッパニャン');
  await selectPal(modal, 2, 'セレムーン');
  await buttonNamed(modal.footer, '登録').dispatch('click');
  assert.equal(modal.dialog.open, false);
  assert.equal(store.state.records.length, 2);
  assert.equal(calls.length, 2);
  assert.doesNotMatch(body.textContent, /配合を登録しました/);
  release();
  await flush();
  assert.match(body.textContent, /配合を登録しました/);
  assert.equal(store.state.syncing, false);
  assert.equal(store.state.records.length, 2);
  assert.ok(store.state.records.every((record) => !record.etag.startsWith('pending:')));
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
  assert.deepEqual(calls, []);
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

test('登録画面: 編集の重複は確認回数の文言なしで統合を提案し、閉じてから統合して知らせを残す', async (t) => {
  const { context, store, body, calls } = await setup(t, { records: [initial, { ...initial, childId: 'CatMage' }] });
  const merges = [];
  context.merge = async (...args) => { merges.push(args); toast('統合の知らせ'); };
  const existing = store.state.records.find((record) => record.childId === initial.childId);
  const original = store.state.records.find((record) => record.childId === 'CatMage');
  const modal = openRecordEditor(context, original);
  await selectPal(modal, 2, 'セレムーン');
  modal.body.querySelector('textarea').value = '統合前の入力';
  const saving = buttonNamed(modal.footer, '変更を保存').dispatch('click');
  await flush();
  const confirm = body.querySelectorAll('dialog')[1];
  assert.ok(confirm);
  assert.match(confirm.textContent, /編集中の登録を既存の登録に統合/);
  assert.doesNotMatch(confirm.textContent, /確認回数|\+1/);
  await buttonNamed(confirm, '統合').dispatch('click');
  await saving;
  const [source, target, options] = merges[0];
  assert.deepEqual([source, target, options.ask], [original, existing, false]);
  assert.deepEqual(calls, []);
  assert.equal(modal.dialog.open, false);
  assert.match(body.textContent, /統合の知らせ/);
  // 裏で送った統合が失敗したら、入力し直しで開く。競合時は応答の最新の内容を使う。
  // 登録が消えていたら（NOT_FOUND）、入力内容を新しい登録として開く。
  for (const [error, title, child, memo] of [
    [new ApiError('INTERNAL'), '配合を編集', /セレムーン/, '統合前の入力'],
    [new ApiError('NOT_FOUND'), '見つけた配合を登録', /セレムーン/, '統合前の入力'],
    [new ApiError('CONFLICT', { latest: { source: { ...original, memo: '他の人のメモ' }, target: existing } }), '配合を編集', /クレメーオ/, '他の人のメモ'],
  ]) {
    const reopened = options.retry(error);
    assert.equal(reopened.dialog.querySelector('h2').textContent, title);
    assert.match(reopened.body.querySelectorAll('.picker-trigger')[2].textContent, child);
    assert.equal(reopened.body.querySelector('textarea').value, memo);
    await reopened.close();
  }
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
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.allowDifferentChild, true);
  assert.equal(store.state.records.length, 2);
  await modal.close();
});

test('登録画面: 他の人の更新と競合したら元に戻し、全件取得を待たずに「入力し直す」で最新の内容を開く', async (t) => {
  const { context, body, calls, store, api, hold } = await setup(t, { records: [{ ...initial, registrant: '古い登録者', parent1Gender: 'M' }] });
  const original = store.state.records[0];
  // 他の人が登録者とメモを変更する。この端末の全件はまだ古い。
  const { record: latest } = await api.request('update', '画面試験用の入力', {
    opId: crypto.randomUUID(), id: original.id, expectedEtag: original.etag,
    record: { ...initial, parent1Gender: 'M', parent2Gender: '', registrant: '仲間', memo: '他の人のメモ' },
  });
  const modal = openRecordEditor(context, original);
  modal.body.querySelector('textarea').value = '競合した入力';
  await buttonNamed(modal.footer, '変更を保存').dispatch('click');
  assert.equal(modal.dialog.open, false);
  assert.equal(store.state.records[0].memo, '競合した入力');
  const release = hold();
  await flush();
  assert.equal(store.state.records[0].memo, '');
  assert.equal(store.state.records[0].etag, original.etag);
  assert.match(body.textContent, /変更を保存できませんでした。他の人が先に更新しました/);
  assert.doesNotMatch(body.textContent, /変更を保存しました/);
  await buttonNamed(body, '入力し直す').dispatch('click');
  const reopened = body.querySelector('dialog');
  assert.equal(reopened.querySelector('select').value, '仲間');
  assert.equal(reopened.querySelector('textarea').value, '他の人のメモ');
  reopened.querySelector('textarea').value = '再編集';
  await buttonNamed(reopened, '変更を保存').dispatch('click');
  assert.equal(calls[1].payload.expectedEtag, latest.etag);
  assert.equal(calls[1].payload.record.parent1Gender, original.parent1Gender);
  assert.equal(calls[1].payload.record.parent2Gender, original.parent2Gender);
  assert.doesNotMatch(body.textContent, /変更を保存しました/);
  release();
  await flush();
  assert.match(body.textContent, /変更を保存しました/);
  assert.equal(store.state.records[0].memo, '再編集');
  assert.equal(store.state.syncing, false);
});
