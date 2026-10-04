import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, descendants } from '../helpers/dom.js';
import { createDevelopmentApi } from '../../dev/mock-api.js';
import { createApi } from '../../web/js/api.js';
import { createStore, safeStorage } from '../../web/js/store.js';
import { createDraftStore } from '../../web/js/drafts.js';
import { openRecordEditor } from '../../web/js/ui/record-editor.js';
import { draftsView, registerDrafts } from '../../web/js/views/drafts.js';
import { parseHash, buildHash } from '../../web/js/router.js';

const complete = { parent1Id: 'SheepBall', parent2Id: 'FlowerDoll', childId: 'MoonQueen' };
const buttonNamed = (node, text) => descendants(node).find((child) => child.tagName === 'button' && child.textContent === text);
const iconNamed = (node, label) => node.querySelector(`button[aria-label="${label}"]`);
const openDialogs = () => document.body.querySelectorAll('dialog').filter((dialog) => dialog.open);
const flush = () => new Promise((resolve) => setImmediate(resolve));
const pals = (draft) => ({ parent1Id: draft.parent1Id, parent2Id: draft.parent2Id, childId: draft.childId });

function memoryStorage() {
  const values = new Map();
  return {
    values, fail: false,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) {
      if (this.fail) throw new Error('QuotaExceededError');
      values.set(key, String(value));
    },
    removeItem(key) { values.delete(key); },
  };
}

async function setup(t, { records = [], storage = memoryStorage() } = {}) {
  const { body } = installDom(t);
  const development = createDevelopmentApi();
  let held = null;
  let serve = (request) => development(request);
  const api = createApi({ transport: async (request) => { await held; return serve(request, development); } });
  const store = createStore({ api, storage: safeStorage(null) });
  await store.signup('自分', '画面試験用の入力');
  for (const record of records) await store.mutate('create', { record: { id: crypto.randomUUID(), ...record }, allowDifferentChild: true });
  await store.refresh();
  const calls = [];
  const originalMutate = store.mutate;
  store.mutate = (action, payload) => {
    calls.push({ action, payload });
    return originalMutate(action, payload);
  };
  const drafts = createDraftStore({ store, storage, namespace: 'test-note' });
  const context = { store, drafts, register: (initial, options) => openRecordEditor(context, initial, options) };
  return {
    body, store, drafts, storage, calls, context, api,
    // 以降のサーバ応答を止め、返した関数で再開する。
    hold() {
      let release;
      held = new Promise((resolve) => { release = resolve; });
      return () => { held = null; release(); };
    },
    serve(next) { serve = next; },
  };
}

function mount(t, app) {
  const view = draftsView(app.context);
  app.body.append(view.element);
  t.after(() => view.destroy());
  return view;
}

const rows = (view) => view.element.querySelectorAll('.draft-row');
const message = (row) => row.querySelector('.draft-message');

async function choose(picker, query) {
  await picker.querySelector('.picker-trigger').dispatch('click');
  const input = picker.querySelector('input');
  input.value = query;
  await input.dispatch('input');
  await picker.querySelectorAll('[role="option"]')[0].dispatch('click');
}

test('ルーティング: 下書きのタブを開ける', () => {
  assert.equal(parseHash('#/drafts').view, 'drafts');
  assert.equal(buildHash('drafts'), '#/drafts');
});

test('下書き: ID・環境ごとに保存し、不正な保存内容は読み捨て、ログアウト中は作らない', async (t) => {
  const app = await setup(t);
  const key = app.drafts.scope();
  assert.equal(key, 'test-note.drafts.test.自分');
  const draft = app.drafts.add({ parent1Id: 'SheepBall' });
  assert.deepEqual(draft, { id: draft.id, parent1Id: 'SheepBall', parent2Id: '', childId: '', registrant: '自分', memo: '', recordId: '' });
  assert.deepEqual(JSON.parse(app.storage.values.get(key)), [draft]);
  const id = crypto.randomUUID();
  app.storage.values.set(key, JSON.stringify([null, { id: 'UUID ではない' },
    { id, parent1Id: '存在しない', parent2Id: 'SheepBall', childId: 7, registrant: 5, memo: 'メモ', recordId: '不正' },
    { id, parent1Id: 'SheepBall' }]));
  app.drafts.reload(key);
  assert.deepEqual(app.drafts.list(), [{ id, parent1Id: '', parent2Id: 'SheepBall', childId: '', registrant: '', memo: 'メモ', recordId: '' }]);
  app.storage.values.set(key, '壊れた JSON');
  app.drafts.reload(key);
  assert.deepEqual(app.drafts.list(), []);
  assert.deepEqual(app.drafts.list('test-note.drafts.prod.自分'), []);
  app.store.logout();
  assert.equal(app.drafts.scope(), '');
  assert.equal(app.drafts.add(), null);
});

test('下書き: 端末に保存できなければ警告し、入力は画面に残す', async (t) => {
  const app = await setup(t);
  const view = mount(t, app);
  const warning = view.element.querySelector('.drafts-warning');
  assert.equal(warning.hidden, true);
  app.storage.fail = true;
  await buttonNamed(view.element, '＋ 空の下書きを追加').dispatch('click');
  assert.equal(rows(view).length, 1);
  assert.equal(warning.hidden, false);
  assert.match(warning.textContent, /保存できませんでした/);
  app.storage.fail = false;
  app.drafts.update(app.drafts.list()[0].id, { parent1Id: 'SheepBall' });
  assert.equal(warning.hidden, true);
});

test('下書き: 追加した空の行でパル名から直接選び、3 つ揃うと登録できる', async (t) => {
  const app = await setup(t);
  const view = mount(t, app);
  assert.match(view.element.textContent, /下書きはありません/);
  assert.equal(buttonNamed(view.element, '一括登録').disabled, true);
  await buttonNamed(view.element, '＋ 空の下書きを追加').dispatch('click');
  const [row] = rows(view);
  assert.deepEqual(row.querySelectorAll('.picker-trigger').map((node) => node.textContent), ['パルを選択', 'パルを選択', 'パルを選択']);
  assert.equal(document.activeElement, row.querySelector('.picker-trigger'));
  assert.equal(iconNamed(row, '編集').tagName, 'button');
  const register = buttonNamed(row, '登録');
  assert.equal(register.disabled, true);
  const pickers = row.querySelectorAll('.picker');
  await choose(pickers[0], 'モコロン');
  await choose(pickers[1], 'フラリーナ');
  assert.equal(register.disabled, true);
  await choose(pickers[2], 'セレムーン');
  // 行を作り直さないので、選んだ欄にフォーカスが残る。
  assert.equal(rows(view)[0], row);
  assert.equal(document.activeElement, pickers[2].querySelector('.picker-trigger'));
  assert.equal(register.disabled, false);
  assert.deepEqual(pals(app.drafts.list()[0]), complete);
  assert.equal(view.element.querySelector('.result-note').textContent, '1 件の下書き');
  assert.equal(app.calls.length, 0);
});

test('下書き: 登録は通常の登録と同じ内容で送り、送信中は行を操作できず、成功したら行を消す', async (t) => {
  const app = await setup(t);
  const draft = app.drafts.add({ ...complete, memo: 'メモ' });
  const view = mount(t, app);
  const [row] = rows(view);
  const release = app.hold();
  const done = buttonNamed(row, '登録').dispatch('click');
  await flush();
  assert.equal(message(row).textContent, '登録中…');
  assert.equal(row.querySelector('.draft-equation').inert, true);
  assert.equal(row.querySelector('.draft-actions').inert, true);
  assert.equal(buttonNamed(view.element, '一括削除').disabled, true);
  assert.equal(app.drafts.update(draft.id, { memo: '変更' }), false);
  assert.equal(app.drafts.remove(draft.id), null);
  assert.equal(app.drafts.removeMany([draft.id]), 0);
  const [{ action, payload }] = app.calls;
  assert.equal(action, 'create');
  assert.deepEqual(payload, { record: { id: app.drafts.list()[0].recordId, ...complete,
    parent1Gender: '', parent2Gender: '', registrant: '自分', memo: 'メモ' } });
  // 一覧には応答を待たずに反映される。
  assert.ok(app.store.state.records.some((record) => record.id === payload.record.id));
  release();
  await done;
  assert.deepEqual(app.drafts.list(), []);
  assert.equal(rows(view).length, 0);
  assert.match(app.body.textContent, /配合を登録しました/);
  assert.equal(app.store.state.records.length, 1);
});

test('下書き: 手元で分かる重複は送らずに行へ理由を出し、下書きを残す', async (t) => {
  const app = await setup(t, { records: [complete] });
  app.drafts.add({ parent1Id: 'FlowerDoll', parent2Id: 'SheepBall', childId: 'MoonQueen' });
  const view = mount(t, app);
  const [row] = rows(view);
  await buttonNamed(row, '登録').dispatch('click');
  assert.equal(app.calls.length, 0);
  assert.equal(message(row).textContent, '同じ配合がすでに登録されています。');
  assert.match(message(row).className, /draft-error/);
  assert.equal(app.drafts.list().length, 1);
  // 内容を変えたら古い理由は消す。
  app.drafts.update(app.drafts.list()[0].id, { childId: 'CatMage' });
  assert.equal(message(row).hidden, true);
});

test('下書き: サーバに断られたら行に理由を出して残し、送り直しは同じ登録 ID を使う', async (t) => {
  const app = await setup(t);
  app.serve((request, next) => request.action === 'create'
    ? { ok: false, code: 'VALIDATION', errors: [{ field: 'registrant', code: 'TOO_LONG' }] } : next(request));
  const draft = app.drafts.add(complete);
  const view = mount(t, app);
  const [row] = rows(view);
  await buttonNamed(row, '登録').dispatch('click');
  assert.equal(message(row).textContent, '登録者: 文字数が上限を超えています。');
  assert.match(app.body.textContent, /配合を登録できませんでした。登録者: 文字数が上限を超えています。/);
  assert.equal(app.store.state.records.length, 0);
  const { recordId } = app.drafts.list()[0];
  assert.ok(recordId);
  app.serve((request, next) => next(request));
  await buttonNamed(row, '登録').dispatch('click');
  assert.equal(app.calls[1].payload.record.id, recordId);
  assert.deepEqual(app.drafts.list(), []);
  assert.equal(app.drafts.status(draft.id).error, '');
});

test('下書き: 応答を受け取れずに残った下書きは、同じ登録 ID の送り直しで成功として片付く', async (t) => {
  const app = await setup(t);
  const draft = app.drafts.add(complete);
  // 送信時に保存した登録 ID で、サーバにはすでに登録済みの状態を作る。
  const recordId = crypto.randomUUID();
  app.drafts.startSending(draft.id, recordId, app.drafts.scope());
  await app.api.request('create', '画面試験用の入力', { opId: crypto.randomUUID(),
    record: { id: recordId, ...complete, parent1Gender: '', parent2Gender: '', registrant: '自分', memo: '' } });
  await app.store.refresh();
  app.drafts.finish(draft.id, { ...draft, memo: '送った内容とは違う' }, app.drafts.scope());
  assert.equal(app.drafts.list()[0].recordId, recordId);
  await registerDrafts(app.context, [draft.id]);
  assert.deepEqual(app.drafts.list(), []);
  assert.equal(app.store.state.records.length, 1);
});

test('下書き: 一括登録は問題のない行だけ登録し、未選択・重複・登録しないを選んだ行は理由付きで残す', async (t) => {
  const app = await setup(t, { records: [complete] });
  const ok = app.drafts.add({ parent1Id: 'Alpaca', parent2Id: 'Boar', childId: 'Deer' });
  const incomplete = app.drafts.add({ parent1Id: 'Alpaca' });
  const duplicate = app.drafts.add({ parent1Id: 'FlowerDoll', parent2Id: 'SheepBall', childId: 'MoonQueen' });
  const declined = app.drafts.add({ ...complete, childId: 'CatMage' });
  const accepted = app.drafts.add({ ...complete, childId: 'Eagle' });
  const sameBatch = app.drafts.add({ parent1Id: 'Boar', parent2Id: 'Alpaca', childId: 'Deer' });
  const view = mount(t, app);
  const done = buttonNamed(view.element, '一括登録').dispatch('click');
  await flush();
  assert.equal(buttonNamed(view.element, '一括登録').disabled, true);
  let [dialog] = openDialogs();
  assert.match(dialog.textContent, /別の結果として登録しますか？.*登録しようとしている下書き.*クレメーオ.*登録済みの配合.*セレムーン/);
  await buttonNamed(dialog, '登録しない').dispatch('click');
  await flush();
  [dialog] = openDialogs();
  assert.match(dialog.textContent, /エアムルグ/);
  await buttonNamed(dialog, '別の結果として保存').dispatch('click');
  await done;
  assert.deepEqual(app.drafts.list().map((draft) => draft.id), [incomplete.id, duplicate.id, declined.id, sameBatch.id]);
  assert.deepEqual(rows(view).map((row) => message(row).textContent), [
    '未選択の項目があります。', '同じ配合がすでに登録されています。',
    '同じ組み合わせで別の子が登録されています。', '同じ配合がすでに登録されています。',
  ]);
  const created = app.calls.filter((call) => call.action === 'create').map((call) => call.payload);
  assert.deepEqual(created.map((payload) => payload.record.childId), [ok.childId, accepted.childId]);
  assert.deepEqual(created.map((payload) => payload.allowDifferentChild), [undefined, true]);
  assert.equal(app.store.state.records.length, 3);
  assert.match(app.body.textContent, /2 件を登録しました。4 件は下書きに残っています/);
  assert.equal(buttonNamed(view.element, '一括登録').disabled, false);
});

test('下書き: 確認の間にログアウトしたら、残りの下書きを送らない', async (t) => {
  const app = await setup(t, { records: [complete] });
  app.drafts.add({ ...complete, childId: 'CatMage' });
  app.drafts.add({ parent1Id: 'Alpaca', parent2Id: 'Boar', childId: 'Deer' });
  const ids = app.drafts.list().map((draft) => draft.id);
  const done = registerDrafts(app.context, ids);
  await flush();
  app.store.logout();
  await buttonNamed(openDialogs()[0], '別の結果として保存').dispatch('click');
  await done;
  assert.equal(app.calls.length, 0);
});

test('下書き: 一括削除は確認してから全件を消す', async (t) => {
  const app = await setup(t);
  app.drafts.add(complete);
  app.drafts.add();
  const view = mount(t, app);
  let done = buttonNamed(view.element, '一括削除').dispatch('click');
  await buttonNamed(openDialogs()[0], 'キャンセル').dispatch('click');
  await done;
  assert.equal(rows(view).length, 2);
  done = buttonNamed(view.element, '一括削除').dispatch('click');
  assert.match(openDialogs()[0].textContent, /すべての下書きを削除しますか？.*2 件/);
  await buttonNamed(openDialogs()[0], '削除').dispatch('click');
  await done;
  assert.deepEqual(app.drafts.list(), []);
  assert.match(view.element.textContent, /下書きはありません/);
  assert.match(app.body.textContent, /2 件の下書きを削除しました/);
});

test('下書き: 1 行の削除は確認なしで消し、元に戻すと同じ位置に戻る', async (t) => {
  const app = await setup(t);
  const [first, second, third] = [app.drafts.add({ parent1Id: 'Alpaca' }), app.drafts.add({ parent1Id: 'Boar' }), app.drafts.add({ parent1Id: 'Deer' })];
  const view = mount(t, app);
  const [, row] = rows(view);
  await iconNamed(row, '削除').dispatch('click');
  assert.equal(openDialogs().length, 0);
  assert.deepEqual(app.drafts.list().map((draft) => draft.id), [first.id, third.id]);
  assert.equal(rows(view).length, 2);
  await buttonNamed(app.body, '元に戻す').dispatch('click');
  assert.deepEqual(app.drafts.list().map((draft) => draft.id), [first.id, second.id, third.id]);
  assert.deepEqual(rows(view).map((node) => node.querySelector('.picker-trigger').textContent.replace(/No\.\d+/, '')), ['メルパカ', 'イノボウ', 'ツノガミ']);
});

test('下書き: 別の行の送信が終わっても、開いている候補と行を保つ', async (t) => {
  const app = await setup(t);
  app.drafts.add(complete);
  app.drafts.add({ parent1Id: 'Alpaca' });
  const view = mount(t, app);
  const [sending, editing] = rows(view);
  const release = app.hold();
  const done = buttonNamed(sending, '登録').dispatch('click');
  await flush();
  const trigger = editing.querySelector('.picker-trigger');
  await trigger.dispatch('click');
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  release();
  await done;
  assert.deepEqual(rows(view), [editing]);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.ok(editing.querySelector('.picker-popover'));
  view.destroy();
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
});

test('下書き: 下書きに登録はモーダルの下書き版で、サーバに送らずに登録者とメモも保存する', async (t) => {
  const app = await setup(t);
  const view = mount(t, app);
  await buttonNamed(view.element, '＋ 下書きに登録').dispatch('click');
  let [dialog] = openDialogs();
  assert.equal(dialog.querySelector('h2').textContent, '下書きに登録');
  assert.ok(buttonNamed(dialog, '続けて下書きに登録'));
  const pickTrigger = async (index, query) => {
    await dialog.querySelectorAll('.picker-trigger')[index].dispatch('click');
    const search = dialog.querySelector('.picker-search');
    search.value = query;
    await search.dispatch('input');
    await dialog.querySelectorAll('[role="option"]')[0].dispatch('click');
  };
  await pickTrigger(0, 'モコロン');
  dialog.querySelector('textarea').value = '親2は未確認';
  await buttonNamed(dialog, '続けて下書きに登録').dispatch('click');
  assert.equal(dialog.open, true);
  assert.equal(dialog.querySelector('textarea').value, '');
  await pickTrigger(1, 'フラリーナ');
  await buttonNamed(dialog, '下書きに保存').dispatch('click');
  assert.equal(dialog.open, false);
  assert.deepEqual(app.drafts.list().map((draft) => [pals(draft), draft.registrant, draft.memo]), [
    [{ parent1Id: 'SheepBall', parent2Id: '', childId: '' }, '自分', '親2は未確認'],
    [{ parent1Id: 'SheepBall', parent2Id: 'FlowerDoll', childId: '' }, '自分', ''],
  ]);
  assert.equal(app.calls.length, 0);

  const [row] = rows(view);
  await iconNamed(row, '編集').dispatch('click');
  [dialog] = openDialogs();
  assert.equal(dialog.querySelector('h2').textContent, '下書きを編集');
  assert.equal(buttonNamed(dialog, '続けて下書きに登録'), undefined);
  assert.match(dialog.querySelectorAll('.picker-trigger')[0].textContent, /モコロン/);
  assert.equal(dialog.querySelector('textarea').value, '親2は未確認');
  await pickTrigger(2, 'セレムーン');
  dialog.querySelector('textarea').value = '確認済み';
  dialog.querySelector('select').value = '';
  await buttonNamed(dialog, '下書きに保存').dispatch('click');
  assert.equal(dialog.open, false);
  const [edited] = app.drafts.list();
  assert.deepEqual([pals(edited), edited.registrant, edited.memo], [{ parent1Id: 'SheepBall', parent2Id: '', childId: 'MoonQueen' }, '', '確認済み']);
  assert.equal(rows(view)[0], row);
  assert.match(row.textContent, /登録者未指定.*確認済み/);
  assert.equal(app.calls.length, 0);
});

test('下書き: 別のタブで書き換わったら読み直して表示する', async (t) => {
  const app = await setup(t);
  app.drafts.add({ parent1Id: 'Alpaca' });
  const view = mount(t, app);
  const key = app.drafts.scope();
  const id = crypto.randomUUID();
  app.storage.values.set(key, JSON.stringify([{ id, parent1Id: 'Boar' }]));
  app.drafts.reload(key);
  assert.deepEqual(app.drafts.list().map((draft) => draft.id), [id]);
  assert.match(rows(view)[0].querySelector('.picker-trigger').textContent, /イノボウ/);
});

test('下書き: 2 つのタブで続けて書き換えても、互いの保存を消さない', async (t) => {
  const app = await setup(t);
  const other = createDraftStore({ store: app.store, storage: app.storage, namespace: 'test-note' });
  app.drafts.list();
  other.list();
  const first = app.drafts.add({ memo: 'タブA' });
  const second = other.add({ memo: 'タブB' });
  app.drafts.update(first.id, { parent1Id: 'SheepBall' });
  assert.deepEqual(JSON.parse(app.storage.values.get(app.drafts.scope())).map((draft) => [draft.id, draft.memo, draft.parent1Id]),
    [[first.id, 'タブA', 'SheepBall'], [second.id, 'タブB', '']]);
});

test('下書き: 確認の間に内容が変わったら、承認を使わずに確かめ直す', async (t) => {
  const app = await setup(t, { records: [complete] });
  const draft = app.drafts.add({ ...complete, childId: 'CatMage' });
  let done = registerDrafts(app.context, [draft.id]);
  await flush();
  // 別のタブで、別の子が登録済みの別の結果に書き換わった。
  app.drafts.update(draft.id, { childId: 'Eagle' });
  await buttonNamed(openDialogs()[0], '別の結果として保存').dispatch('click');
  await flush();
  const [dialog] = openDialogs();
  assert.match(dialog.textContent, /エアムルグ/);
  await buttonNamed(dialog, '登録しない').dispatch('click');
  await done;
  assert.equal(app.calls.length, 0);
  done = registerDrafts(app.context, [draft.id]);
  await flush();
  // 承認後、別の子のない組み合わせに書き換わったら、承認の印を付けずに送る。
  app.drafts.update(draft.id, { parent1Id: 'Alpaca', parent2Id: 'Boar', childId: 'Deer' });
  await buttonNamed(openDialogs()[0], '別の結果として保存').dispatch('click');
  await done;
  assert.deepEqual(app.calls.map((call) => [call.payload.record.childId, call.payload.allowDifferentChild]), [['Deer', undefined]]);
});
