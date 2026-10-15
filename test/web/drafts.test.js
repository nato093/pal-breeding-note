import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, descendants } from '../helpers/dom.js';
import { createDevelopmentApi } from '../../dev/mock-api.js';
import { createApi } from '../../web/js/api.js';
import { createStore, safeStorage } from '../../web/js/store.js';
import { createDraftStore } from '../../web/js/drafts.js';
import { createRenamer } from '../../web/js/user-rename.js';
import { openRecordEditor } from '../../web/js/ui/record-editor.js';
import { draftsBand, registerDrafts } from '../../web/js/ui/drafts-band.js';
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

function mount(t, app, { open = true, onToggle } = {}) {
  // 下書きの帯（配合を探すの全件表示の上。register-entry で前の下書きのタブから移した）
  const view = draftsBand(app.context, { open, onToggle });
  app.body.append(view.element);
  t.after(() => view.destroy());
  return view;
}

const rows = (view) => view.element.querySelectorAll('.draft-row');
const message = (row) => row.querySelector('.draft-message');
// 行の式のパル名（読み取り専用。未選択の枠は「未選択」）
const names = (row) => row.querySelector('.draft-equation').children.filter((node) => !node.className.includes('equation-symbol'))
  .map((node) => node.querySelector('strong')?.textContent ?? node.textContent);
const countText = (view) => view.element.querySelector('.drafts-band-title').textContent;

test('ルーティング: 下書きのタブはなくなり、#/drafts は下書きの帯を開いた配合を探すに読み替える', () => {
  const route = parseHash('#/drafts');
  assert.equal(route.view, 'search');
  assert.equal(route.params.get('drafts'), '1');
  assert.equal(buildHash('drafts'), '#/search');
});

test('下書きの帯: 頭の行に開閉のボタン（aria-expanded・aria-controls）と件数「下書き n 件（この端末だけ）」、閉じている間は中身を隠す', async (t) => {
  const app = await setup(t);
  const toggles = [];
  const view = mount(t, app, { open: false, onToggle: (open) => toggles.push(open) });
  const toggle = view.element.querySelector('.drafts-band-toggle');
  const body = view.element.querySelector('.drafts-band-body');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(toggle.getAttribute('aria-controls'), body.id);
  assert.equal(body.hidden, true);
  assert.equal(countText(view), '下書き 0 件（この端末だけ）');
  // 0 件でも「＋ 下書きに追加」は押せる。「すべて登録」は押せない（理由は title）
  assert.equal(buttonNamed(view.element, '＋ 下書きに追加').disabled, false);
  assert.equal(buttonNamed(view.element, 'すべて登録').disabled, true);
  assert.equal(buttonNamed(view.element, 'すべて登録').title, '下書きがありません');
  await toggle.dispatch('click');
  assert.deepEqual(toggles, [true]);
  // 開閉は呼び出し側（配合を探すの URL）が持つ。update({ open }) で合わせる
  view.update({ open: true });
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(body.hidden, false);
  app.drafts.add({ parent1Id: 'Alpaca' });
  assert.equal(countText(view), '下書き 1 件（この端末だけ）');
  // ログアウト中は作れない
  app.store.logout();
  assert.equal(buttonNamed(view.element, '＋ 下書きに追加').disabled, true);
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
  app.drafts.add({ parent1Id: 'Alpaca' });
  assert.equal(rows(view).length, 1);
  assert.equal(warning.hidden, false);
  assert.match(warning.textContent, /保存できませんでした/);
  // 共通の短い警告（ui/dom.js の storageWarning）
  assert.equal(warning.textContent, 'この端末に下書きを保存できませんでした（ページを閉じると消えます）');
  assert.equal(warning.getAttribute('role'), 'alert');
  app.storage.fail = false;
  app.drafts.update(app.drafts.list()[0].id, { parent1Id: 'SheepBall' });
  assert.equal(warning.hidden, true);
});

test('下書き: 行は読み取り専用の式（未選択の枠は「未選択」）で、未選択があれば登録できない。「編集」のモーダルで選ぶと登録できる', async (t) => {
  const app = await setup(t);
  const view = mount(t, app);
  assert.match(view.element.textContent, /下書きはありません/);
  assert.equal(buttonNamed(view.element, 'すべて削除').title, '下書きがありません');
  app.drafts.add({ parent1Id: 'SheepBall' });
  assert.deepEqual([buttonNamed(view.element, 'すべて登録').disabled, buttonNamed(view.element, 'すべて登録').title], [false, '']);
  const [row] = rows(view);
  assert.deepEqual(names(row), ['モコロン', '未選択', '未選択']);
  // 行の中でパルを選ぶ欄はない
  assert.equal(row.querySelector('.picker'), null);
  const register = buttonNamed(row, '登録');
  assert.equal(register.disabled, true);
  assert.equal(register.title, '親1・親2・子を「編集」で選ぶと登録できます');
  await iconNamed(row, '編集').dispatch('click');
  const [dialog] = openDialogs();
  assert.equal(dialog.querySelector('h2').textContent, '下書きを編集');
  const pickTrigger = async (index, query) => {
    await dialog.querySelectorAll('.picker-trigger')[index].dispatch('click');
    const search = dialog.querySelector('.picker-search');
    search.value = query;
    await search.dispatch('input');
    await dialog.querySelectorAll('[role="option"]')[0].dispatch('click');
  };
  await pickTrigger(1, 'フラリーナ');
  await pickTrigger(2, 'セレムーン');
  await buttonNamed(dialog, '下書きに保存').dispatch('click');
  // 行は作り直さず、式と登録のボタンだけ合わせる
  assert.equal(rows(view)[0], row);
  assert.deepEqual(names(row), ['モコロン', 'フラリーナ', 'セレムーン']);
  assert.equal(register.disabled, false);
  assert.equal(register.title, '');
  assert.deepEqual(pals(app.drafts.list()[0]), complete);
  assert.equal(countText(view), '下書き 1 件（この端末だけ）');
  assert.equal(app.calls.length, 0);
});

test('下書き: 登録は通常の登録と同じ内容で送り、応答を待たずに行を隠し、成功したら下書きを消す', async (t) => {
  const app = await setup(t);
  const draft = app.drafts.add({ ...complete, memo: 'メモ' });
  const view = mount(t, app);
  const [row] = rows(view);
  const release = app.hold();
  const done = buttonNamed(row, '登録').dispatch('click');
  await flush();
  // 行はすぐ隠すが、端末の下書きは成功するまで残し、送信中は書き換えさせない。
  assert.equal(rows(view).length, 0);
  assert.match(view.element.textContent, /下書きはありません/);
  assert.equal(app.drafts.list().length, 1);
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
  await buttonNamed(rows(view)[0], '登録').dispatch('click');
  // 隠していた行を戻して理由を出す。
  const [row] = rows(view);
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

test('下書き: すべて登録は問題のない行だけ登録し、未選択・重複・登録しないを選んだ行は理由付きで残す', async (t) => {
  const app = await setup(t, { records: [complete] });
  const ok = app.drafts.add({ parent1Id: 'Alpaca', parent2Id: 'Boar', childId: 'Deer' });
  const incomplete = app.drafts.add({ parent1Id: 'Alpaca' });
  const duplicate = app.drafts.add({ parent1Id: 'FlowerDoll', parent2Id: 'SheepBall', childId: 'MoonQueen' });
  const declined = app.drafts.add({ ...complete, childId: 'CatMage' });
  const accepted = app.drafts.add({ ...complete, childId: 'Eagle' });
  const sameBatch = app.drafts.add({ parent1Id: 'Boar', parent2Id: 'Alpaca', childId: 'Deer' });
  const view = mount(t, app);
  const done = buttonNamed(view.element, 'すべて登録').dispatch('click');
  await flush();
  assert.equal(buttonNamed(view.element, 'すべて登録').disabled, true);
  // 一括登録の途中は「登録しています」（下書きはあるので「下書きがありません」ではない）
  assert.equal(buttonNamed(view.element, 'すべて登録').title, '登録しています');
  assert.equal(buttonNamed(view.element, 'すべて削除').title, '登録しています');
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
  assert.equal(buttonNamed(view.element, 'すべて登録').disabled, false);
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

test('下書き: すべて削除は確認なしで全件を消し、「元に戻す」で同じ順に戻す', async (t) => {
  const app = await setup(t);
  const [first, second, third] = [app.drafts.add({ parent1Id: 'Alpaca' }), app.drafts.add({ parent1Id: 'Boar' }), app.drafts.add({ parent1Id: 'Deer' })];
  const view = mount(t, app);
  const bulkRemove = buttonNamed(view.element, 'すべて削除');
  bulkRemove.focus();
  await bulkRemove.dispatch('click');
  // 端末だけのものなので確認は出さない（共有する配合の削除だけ確認する。判断事項 7）
  assert.equal(openDialogs().length, 0);
  assert.deepEqual(app.drafts.list(), []);
  assert.match(view.element.textContent, /下書きはありません/);
  assert.equal(bulkRemove.disabled, true);
  // 押せなくなった「すべて削除」の代わりに、「＋ 下書きに追加」へフォーカスを移す（その次の Tab でトーストの「元に戻す」）
  assert.equal(document.activeElement, buttonNamed(view.element, '＋ 下書きに追加'));
  const toastNode = app.body.querySelectorAll('.toast').find((node) => node.textContent.startsWith('3 件の下書きを削除しました'));
  assert.ok(toastNode);
  // 戻す前に足した下書きは、そのまま後ろに残る
  const added = app.drafts.add({ parent1Id: 'Kitsunebi' });
  await buttonNamed(toastNode, '元に戻す').dispatch('click');
  assert.deepEqual(app.drafts.list().map((draft) => draft.id), [first.id, second.id, third.id, added.id]);
  assert.equal(rows(view).length, 4);
  assert.equal(bulkRemove.disabled, false);
});

test('下書き: 一括削除の元に戻すは、消した位置（今の長さに丸める）に差し込み、同じ ID は戻さない', async (t) => {
  const app = await setup(t);
  const [first, second, third, fourth] = ['Alpaca', 'Boar', 'Deer', 'Kitsunebi'].map((parent1Id) => app.drafts.add({ parent1Id }));
  const key = app.drafts.scope();
  const removed = app.drafts.removeAll([first.id, third.id, fourth.id, 'missing'], key);
  // index は消す前の位置（小さい順）
  assert.deepEqual(removed.map(({ draft, index }) => [draft.id, index]), [[first.id, 0], [third.id, 2], [fourth.id, 3]]);
  assert.deepEqual(app.drafts.list().map((draft) => draft.id), [second.id]);
  // 消した後に 2 件目を消すと、3・4 番目の位置は今の長さに丸める
  app.drafts.remove(second.id, key);
  const added = app.drafts.add({ parent1Id: 'Boar' });
  // 先に 1 件だけ戻っていたら、その ID は飛ばして数に入れない
  assert.equal(app.drafts.restore(third, 0, key), true);
  assert.equal(app.drafts.restoreMany(removed, key), 2);
  // first は 0 番目へ、fourth は 3 番目（今の長さ 3 に丸めた末尾）へ
  assert.deepEqual(app.drafts.list().map((draft) => draft.id), [first.id, third.id, added.id, fourth.id]);
  // 消せるものがない・名前の変更中は消さずに null。戻すのも 0
  assert.equal(app.drafts.removeAll(['missing'], key), null);
  app.store.state.renaming = true;
  assert.equal(app.drafts.removeAll([first.id], key), null);
  app.store.state.renaming = false;
  const again = app.drafts.removeAll([first.id], key);
  app.store.state.renaming = true;
  assert.equal(app.drafts.restoreMany(again, key), 0);
  assert.equal(app.drafts.restoreMany(again, ''), 0);
  app.store.state.renaming = false;
  // removeMany の戻り値は今までどおり件数
  assert.equal(app.drafts.removeMany([third.id, fourth.id], key), 2);
  assert.equal(app.drafts.removeMany([third.id], key), 0);
});

test('下書き: 一括削除の元に戻すは、名前の変更中なら戻さずにエラーのトーストで知らせる', async (t) => {
  const app = await setup(t);
  app.drafts.add({ parent1Id: 'Alpaca' });
  app.drafts.add({ parent1Id: 'Boar' });
  const view = mount(t, app);
  await buttonNamed(view.element, 'すべて削除').dispatch('click');
  assert.deepEqual(app.drafts.list(), []);
  app.store.state.renaming = true;
  await buttonNamed(app.body.querySelector('.toast-list'), '元に戻す').dispatch('click');
  assert.deepEqual(app.drafts.list(), []);
  const [error] = app.body.querySelector('.toast-alerts').children;
  assert.equal(error.getAttribute('role'), 'alert');
  assert.match(error.textContent, /^元に戻せませんでした/);
  app.store.state.renaming = false;
});

test('下書き: ID の変更が終わった後の元に戻す（一括削除・1 件の削除）は、前の ID のキーへ戻さず 0・false を返す（今のキーなら戻す）', async (t) => {
  const app = await setup(t);
  const [first, second, third] = ['Alpaca', 'Boar', 'Deer'].map((parent1Id) => app.drafts.add({ parent1Id }));
  const oldKey = app.drafts.scope();
  // ストア: 消した時点のキーが今のログインのキーと違えば戻さない
  const removed = app.drafts.removeAll([first.id, second.id], oldKey);
  const single = app.drafts.remove(third.id, oldKey);
  const renamer = createRenamer({ store: app.store, drafts: app.drafts, storage: app.storage, namespace: 'test-note' });
  assert.equal(await renamer.rename('別の名前'), '別の名前');
  assert.notEqual(app.drafts.scope(), oldKey);
  assert.equal(app.drafts.restoreMany(removed, oldKey), 0);
  assert.equal(app.drafts.restore(single.draft, single.index, oldKey), false);
  // 前の ID のキーに書き戻さない（名前の変更で移して消したキー）・今の ID の下書きも増えない
  assert.equal(app.storage.getItem(oldKey), null);
  assert.deepEqual(app.drafts.list(), []);
  // 今のキーなら今までどおり戻せる
  const key = app.drafts.scope();
  const kept = app.drafts.add({ parent1Id: 'Kitsunebi' });
  const again = app.drafts.removeAll([kept.id], key);
  assert.equal(app.drafts.restoreMany(again, key), 1);
});

test('下書き: 一括削除・1 件の削除の後に ID の変更が終わってから「元に戻す」を押すと、戻さずに「元に戻せませんでした」を出す', async (t) => {
  const app = await setup(t);
  app.drafts.add({ parent1Id: 'Alpaca' });
  app.drafts.add({ parent1Id: 'Boar' });
  const view = mount(t, app);
  const [, row] = rows(view);
  await iconNamed(row, '削除').dispatch('click');
  await buttonNamed(view.element, 'すべて削除').dispatch('click');
  assert.deepEqual(app.drafts.list(), []);
  const renamer = createRenamer({ store: app.store, drafts: app.drafts, storage: app.storage, namespace: 'test-note' });
  await renamer.rename('別の名前');
  for (const text of ['下書きを削除しました', '1 件の下書きを削除しました']) {
    const toastNode = app.body.querySelector('.toast-list').children.find((node) => node.textContent.startsWith(text));
    await buttonNamed(toastNode, '元に戻す').dispatch('click');
  }
  assert.deepEqual(app.drafts.list(), []);
  const errors = app.body.querySelector('.toast-alerts').children;
  assert.deepEqual(errors.map((node) => [node.getAttribute('role'), node.textContent.startsWith('元に戻せませんでした')]), [['alert', true], ['alert', true]]);
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
  assert.deepEqual(rows(view).map((node) => names(node)[0]), ['メルパカ', 'イノボウ', 'ツノガミ']);
});

test('下書き: 別の行の送信が終わっても、操作中の行の要素とフォーカスを保つ', async (t) => {
  const app = await setup(t);
  app.drafts.add(complete);
  app.drafts.add({ parent1Id: 'Alpaca' });
  const view = mount(t, app);
  const [sending, editing] = rows(view);
  const release = app.hold();
  const done = buttonNamed(sending, '登録').dispatch('click');
  await flush();
  const edit = iconNamed(editing, '編集');
  edit.focus();
  release();
  await done;
  assert.deepEqual(rows(view), [editing]);
  assert.equal(document.activeElement, edit);
});

test('下書き: 別の行の送信に失敗して行が戻っても、操作中の行は付け直さずフォーカスを保つ', async (t) => {
  const app = await setup(t);
  app.serve((request, next) => request.action === 'create'
    ? { ok: false, code: 'VALIDATION', errors: [{ field: 'registrant', code: 'TOO_LONG' }] } : next(request));
  app.drafts.add(complete);
  app.drafts.add({ parent1Id: 'Alpaca' });
  const view = mount(t, app);
  const [sending, editing] = rows(view);
  const release = app.hold();
  const done = buttonNamed(sending, '登録').dispatch('click');
  await flush();
  assert.deepEqual(rows(view), [editing]);
  const edit = iconNamed(editing, '編集');
  edit.focus();
  release();
  await done;
  const [returned, kept] = rows(view);
  assert.equal(kept, editing);
  assert.equal(message(returned).textContent, '登録者: 文字数が上限を超えています。');
  // 戻った行だけを差し込み、操作中の行は付け直さない（付け直すとフォーカスが外れる）。
  assert.equal(document.activeElement, edit);
});

test('下書き: 送信中で隠れている下書きは、すべて削除の件数にも対象にも含めない', async (t) => {
  const app = await setup(t);
  const sending = app.drafts.add(complete);
  app.drafts.add({ parent1Id: 'Alpaca' });
  const view = mount(t, app);
  const release = app.hold();
  const registering = buttonNamed(rows(view)[0], '登録').dispatch('click');
  await flush();
  assert.equal(countText(view), '下書き 1 件（この端末だけ）');
  await buttonNamed(view.element, 'すべて削除').dispatch('click');
  assert.equal(openDialogs().length, 0);
  assert.deepEqual(app.drafts.list().map((draft) => draft.id), [sending.id]);
  assert.match(app.body.textContent, /1 件の下書きを削除しました/);
  release();
  await registering;
  assert.deepEqual(app.drafts.list(), []);
  assert.equal(app.store.state.records.length, 1);
});

test('下書き: すべて削除は押した時点で見えていた下書きだけを消し、後で送信に失敗して戻った下書きは残す', async (t) => {
  const app = await setup(t);
  app.serve((request, next) => request.action === 'create'
    ? { ok: false, code: 'VALIDATION', errors: [{ field: 'registrant', code: 'TOO_LONG' }] } : next(request));
  const failing = app.drafts.add(complete);
  app.drafts.add({ parent1Id: 'Alpaca' });
  const view = mount(t, app);
  const release = app.hold();
  const registering = buttonNamed(rows(view)[0], '登録').dispatch('click');
  await flush();
  await buttonNamed(view.element, 'すべて削除').dispatch('click');
  assert.match(app.body.textContent, /1 件の下書きを削除しました/);
  release();
  await registering;
  assert.deepEqual(app.drafts.list().map((draft) => draft.id), [failing.id]);
  assert.equal(message(rows(view)[0]).textContent, '登録者: 文字数が上限を超えています。');
});

test('下書き: 登録・削除で行が消えたら、次の行（なければ前の行）の「編集」へフォーカスを移し、行がなくなったら「＋ 下書きに追加」へ', async (t) => {
  const app = await setup(t);
  app.drafts.add(complete);
  app.drafts.add({ parent1Id: 'Alpaca' });
  app.drafts.add({ parent1Id: 'Boar' });
  app.drafts.add({ parent1Id: 'Deer' });
  const view = mount(t, app);
  const [first, second, third, fourth] = rows(view);
  const edit = (row) => iconNamed(row, '編集');
  const release = app.hold();
  buttonNamed(first, '登録').focus();
  const registering = buttonNamed(first, '登録').dispatch('click');
  await flush();
  // 同じ「登録」へ移すと Enter の長押しで次の行まで続けて登録してしまうので、次の行の「編集」へ
  assert.equal(document.activeElement, edit(second));
  // 前後に行があるときは次の行へ移す。
  iconNamed(third, '削除').focus();
  await iconNamed(third, '削除').dispatch('click');
  assert.equal(document.activeElement, edit(fourth));
  // 最後の行なら前の行へ、行がなくなったら「＋ 下書きに追加」へ移す。
  iconNamed(fourth, '削除').focus();
  await iconNamed(fourth, '削除').dispatch('click');
  assert.equal(document.activeElement, edit(second));
  iconNamed(second, '削除').focus();
  await iconNamed(second, '削除').dispatch('click');
  assert.equal(document.activeElement, buttonNamed(view.element, '＋ 下書きに追加'));
  release();
  await registering;
  assert.deepEqual(app.drafts.list(), []);
});

test('下書き: ダブルクリックの 2 回目は、詰まってきた次の行の登録・削除に当てない', async (t) => {
  const app = await setup(t);
  const next = { parent1Id: 'Alpaca', parent2Id: 'Boar', childId: 'Deer' };
  app.drafts.add(complete);
  app.drafts.add(next);
  const view = mount(t, app);
  const [first, second] = rows(view);
  await buttonNamed(first, '登録').dispatch('click', { detail: 1 });
  assert.deepEqual(rows(view), [second]);
  await buttonNamed(second, '登録').dispatch('click', { detail: 2 });
  await iconNamed(second, '削除').dispatch('click', { detail: 2 });
  assert.deepEqual(app.drafts.list().map(pals), [next]);
  assert.equal(app.calls.length, 1);
});

test('下書き: 「＋ 下書きに追加」はモーダルの下書き版で、サーバに送らずに登録者とメモも保存する', async (t) => {
  const app = await setup(t);
  const view = mount(t, app);
  await buttonNamed(view.element, '＋ 下書きに追加').dispatch('click');
  let [dialog] = openDialogs();
  assert.equal(dialog.querySelector('h2').textContent, '下書きに保存');
  assert.ok(buttonNamed(dialog, '続けて下書きに保存'));
  const pickTrigger = async (index, query) => {
    await dialog.querySelectorAll('.picker-trigger')[index].dispatch('click');
    const search = dialog.querySelector('.picker-search');
    search.value = query;
    await search.dispatch('input');
    await dialog.querySelectorAll('[role="option"]')[0].dispatch('click');
  };
  await pickTrigger(0, 'モコロン');
  dialog.querySelector('textarea').value = '親2は未確認';
  await buttonNamed(dialog, '続けて下書きに保存').dispatch('click');
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
  assert.equal(buttonNamed(dialog, '続けて下書きに保存'), undefined);
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
  assert.equal(names(rows(view)[0])[0], 'イノボウ');
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
