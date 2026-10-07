import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDevelopmentApi } from '../../dev/mock-api.js';
import { createApi, buildRequest } from '../../web/js/api.js';
import { createStore, safeStorage } from '../../web/js/store.js';
import { createDraftStore } from '../../web/js/drafts.js';
import { createWishlistStore } from '../../web/js/wishlist.js';
import { createNotificationStore } from '../../web/js/notifications.js';
import { createRenamer, moveUserStorage } from '../../web/js/user-rename.js';

const PASSCODE = '名前の変更の試験';
const record = { parent1Id: 'SheepBall', parent2Id: 'FlowerDoll', childId: 'MoonQueen' };

function memoryStorage() {
  const values = new Map();
  return {
    values,
    failing: new Set(),
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) {
      if (this.failing.has(key) || this.failing.has('*')) throw new Error('QuotaExceededError');
      values.set(key, String(value));
    },
    removeItem(key) { values.delete(key); },
  };
}
const read = (storage, key) => JSON.parse(storage.getItem(key));

async function device(development, userId, { storage = memoryStorage(), signup = true } = {}) {
  let serve = (request) => development(request);
  const sent = [];
  const api = createApi({ transport: async (request) => { sent.push(request); return serve(request); } });
  let renamer;
  const store = createStore({
    api, storage: safeStorage(storage), onUserIdChange: (previous, next, env) => renamer.followServer(previous, next, env),
  });
  if (signup) await store.signup(userId, PASSCODE);
  else await store.login(userId, PASSCODE);
  const drafts = createDraftStore({ store, storage });
  const wishlist = createWishlistStore({ store, storage });
  const notifications = createNotificationStore({ store, storage, sources: [] });
  renamer = createRenamer({ store, drafts, wishlist, notifications, storage });
  return { store, drafts, wishlist, notifications, renamer, storage, sent, serve: (next) => { serve = next; } };
}

test('API: rename は opId・userId・newUserId だけを送る', () => {
  assert.deepEqual(buildRequest('rename', 'p', { opId: 'o', userId: 'a', newUserId: 'b', extra: 1 }),
    { action: 'rename', passcode: 'p', opId: 'o', userId: 'a', newUserId: 'b' });
});

test('端末内の移動: 変えた環境の分だけ移し、移し先と連結して元を消す（既読は元も残す）', () => {
  const storage = memoryStorage();
  storage.setItem('pal-note.drafts.prod.taro', JSON.stringify([{ id: 'a', registrant: 'TARO' }, { id: 'b', registrant: '花子' }]));
  storage.setItem('pal-note.drafts.prod.jiro', JSON.stringify([{ id: 'a', registrant: '前の人' }, { id: 'c', registrant: 'jiro' }]));
  storage.setItem('pal-note.drafts.test.taro', JSON.stringify([{ id: 'd', registrant: 'Taro' }]));
  storage.setItem('pal-note.wishlist.prod.taro', JSON.stringify([{ palId: 'SheepBall' }]));
  storage.setItem('pal-note.autoBreeding.notices.prod.taro', JSON.stringify([{ id: 'n' }]));
  storage.setItem('pal-note.notifications.read.taro', JSON.stringify(['r']));
  storage.setItem('pal-note.autoBreeding.players.prod.W1', JSON.stringify({ u1: 'ｔａｒｏ', u2: '花子' }));
  storage.setItem('pal-note.autoBreeding.players.test.W1', JSON.stringify({ u1: 'Taro' }));
  assert.equal(moveUserStorage(storage, 'pal-note', 'prod', 'Taro', 'Jiro'), true);
  // 改名した本人の下書きが先（読み込むときに同じ ID は先のものが残る）
  assert.deepEqual(read(storage, 'pal-note.drafts.prod.jiro'), [
    { id: 'a', registrant: 'Jiro' }, { id: 'b', registrant: '花子' }, { id: 'a', registrant: '前の人' }, { id: 'c', registrant: 'jiro' },
  ]);
  assert.equal(storage.getItem('pal-note.drafts.prod.taro'), null);
  assert.deepEqual(read(storage, 'pal-note.drafts.test.taro'), [{ id: 'd', registrant: 'Taro' }]);
  assert.deepEqual(read(storage, 'pal-note.wishlist.prod.jiro'), [{ palId: 'SheepBall' }]);
  assert.deepEqual(read(storage, 'pal-note.autoBreeding.notices.prod.jiro'), [{ id: 'n' }]);
  assert.deepEqual(read(storage, 'pal-note.notifications.read.jiro'), ['r']);
  assert.deepEqual(read(storage, 'pal-note.notifications.read.taro'), ['r']);
  assert.deepEqual(read(storage, 'pal-note.autoBreeding.players.prod.W1'), { u1: 'Jiro', u2: '花子' });
  assert.deepEqual(read(storage, 'pal-note.autoBreeding.players.test.W1'), { u1: 'Taro' });
});

test('端末内の移動: 大小だけの変更はキーが同じなので、中身だけを書き換えて消さない', () => {
  const storage = memoryStorage();
  storage.setItem('pal-note.drafts.prod.taro', JSON.stringify([{ id: 'a', registrant: 'taro' }]));
  storage.setItem('pal-note.wishlist.prod.taro', JSON.stringify([{ palId: 'SheepBall' }]));
  assert.equal(moveUserStorage(storage, 'pal-note', 'prod', 'taro', 'Taro'), true);
  assert.deepEqual(read(storage, 'pal-note.drafts.prod.taro'), [{ id: 'a', registrant: 'Taro' }]);
  assert.deepEqual(read(storage, 'pal-note.wishlist.prod.taro'), [{ palId: 'SheepBall' }]);
});

test('端末内の移動: 移し先に保存できなければ元を残し、失敗を返す', () => {
  const storage = memoryStorage();
  storage.setItem('pal-note.drafts.prod.taro', JSON.stringify([{ id: 'a', registrant: 'Taro' }]));
  storage.failing.add('pal-note.drafts.prod.jiro');
  assert.equal(moveUserStorage(storage, 'pal-note', 'prod', 'Taro', 'Jiro'), false);
  assert.deepEqual(read(storage, 'pal-note.drafts.prod.taro'), [{ id: 'a', registrant: 'Taro' }]);
});

test('名前の変更: 登録者名・下書き・ウィッシュリストを新しい名前にそろえ、予定の記録を消す', async () => {
  const development = createDevelopmentApi();
  const me = await device(development, 'Taro');
  await me.store.mutate('create', { record: { id: crypto.randomUUID(), ...record, registrant: 'Taro' } });
  const draft = me.drafts.add({ parent1Id: 'SheepBall' });
  assert.equal(draft.registrant, 'Taro');
  assert.equal(me.wishlist.add('SheepBall'), true);
  assert.equal(me.drafts.list().length, 1);
  assert.equal(await me.renamer.rename('  Jiro  '), 'Jiro');
  assert.equal(me.store.state.userId, 'Jiro');
  assert.equal(me.storage.getItem('pal-note.userId'), 'Jiro');
  assert.deepEqual(me.store.state.users, ['Jiro']);
  assert.deepEqual(me.store.state.records.map((item) => item.registrant), ['Jiro']);
  assert.deepEqual(me.drafts.list().map((item) => [item.id, item.registrant]), [[draft.id, 'Jiro']]);
  assert.deepEqual(me.wishlist.list().map((item) => item.palId), ['SheepBall']);
  assert.equal(me.storage.getItem('pal-note.rename'), null);
  assert.equal(me.renamer.pending(), null);
  assert.equal(me.store.state.renaming, false);
  const rename = me.sent.find((request) => request.action === 'rename');
  assert.deepEqual([rename.userId, rename.newUserId], ['Taro', 'Jiro']);
});

test('名前の変更: 実行中の通信が終わるまで待ち、その間は新しい操作・下書きの書き換えを断る', async () => {
  const development = createDevelopmentApi();
  const me = await device(development, 'Taro');
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  me.serve(async (request) => { if (request.action === 'create') await held; return development(request); });
  const created = me.store.mutate('create', { record: { id: crypto.randomUUID(), ...record, registrant: 'Taro' } });
  const renaming = me.renamer.rename('Jiro');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(me.store.state.renaming, true);
  assert.equal(me.sent.some((request) => request.action === 'rename'), false);
  await assert.rejects(me.store.mutate('delete', { id: crypto.randomUUID(), expectedEtag: 'x' }), { code: 'RENAMING' });
  await assert.rejects(me.store.call('ownedWorlds'), { code: 'RENAMING' });
  await assert.rejects(me.store.login('Taro', PASSCODE), { code: 'RENAMING' });
  assert.equal(await me.store.refresh(), undefined);
  assert.equal(me.drafts.add(), null);
  assert.equal(me.wishlist.add('SheepBall'), null);
  release();
  await created;
  assert.equal(await renaming, 'Jiro');
  // 待っていた登録も、新しい名前にそろう
  assert.deepEqual(me.store.state.records.map((item) => item.registrant), ['Jiro']);
  const actions = me.sent.map((request) => request.action);
  assert.ok(actions.indexOf('create') < actions.indexOf('rename'));
});

test('名前の変更: 通信に失敗したら予定を残し、同じ opId で再試行する。実行されなかったエラーでは予定を消す', async () => {
  const development = createDevelopmentApi();
  const other = await device(development, '花子');
  const me = await device(development, 'Taro');
  me.serve(async () => ({ ok: false, code: 'INTERNAL' }));
  await assert.rejects(me.renamer.rename('Jiro'), { code: 'INTERNAL' });
  const plan = me.renamer.pending();
  assert.deepEqual([plan.oldId, plan.newId], ['Taro', 'Jiro']);
  assert.equal(me.store.state.renaming, false);
  await assert.rejects(me.renamer.rename('Saburo'), { code: 'RENAMING' });
  me.serve((request) => development(request));
  assert.equal(await me.renamer.retry(), 'Jiro');
  const opIds = me.sent.filter((request) => request.action === 'rename').map((request) => request.opId);
  assert.equal(new Set(opIds).size, 1);
  assert.equal(me.renamer.pending(), null);
  await assert.rejects(me.renamer.rename('花子'), { code: 'USER_EXISTS' });
  assert.equal(me.renamer.pending(), null);
  assert.equal(other.store.state.userId, '花子');
});

test('名前の変更: 入力の誤り・保存の失敗では始めない', async () => {
  const development = createDevelopmentApi();
  const me = await device(development, 'Taro');
  await assert.rejects(me.renamer.rename(''), (error) => error.code === 'VALIDATION' && error.response.errors[0].code === 'REQUIRED');
  await assert.rejects(me.renamer.rename('Taro'), (error) => error.code === 'VALIDATION' && error.response.errors[0].code === 'SAME_ID');
  me.storage.failing.add('pal-note.rename');
  await assert.rejects(me.renamer.rename('Jiro'), { code: 'STORAGE' });
  me.storage.failing.clear();
  me.storage.failing.add('pal-note.drafts.test.taro');
  me.drafts.add();
  assert.equal(me.drafts.saveFailed, true);
  await assert.rejects(me.renamer.rename('Jiro'), { code: 'LOCAL_SAVE' });
  assert.equal(me.sent.some((request) => request.action === 'rename'), false);
  assert.equal(me.store.state.renaming, false);
});

test('名前の変更: 端末のデータを移せなくても名前は変え、次に開いたときに移す', async () => {
  const development = createDevelopmentApi();
  const storage = memoryStorage();
  const me = await device(development, 'Taro', { storage });
  me.drafts.add();
  storage.failing.add('pal-note.drafts.test.jiro');
  await assert.rejects(me.renamer.rename('Jiro'), { code: 'LOCAL_MOVE' });
  assert.equal(me.store.state.userId, 'Jiro');
  assert.equal(me.renamer.pending().newId, 'Jiro');
  assert.equal(read(storage, 'pal-note.drafts.test.taro').length, 1);
  storage.failing.clear();
  assert.equal(me.renamer.resumeLocal(), true);
  assert.equal(me.renamer.pending(), null);
  assert.equal(me.drafts.list().length, 1);
});

test('名前の変更: 別の端末で大小だけ変えたら、次の取得でサーバの表記と下書きの登録者にそろう', async () => {
  const development = createDevelopmentApi();
  const me = await device(development, 'taro');
  const phone = await device(development, 'TARO', { signup: false });
  assert.equal(phone.store.state.userId, 'taro');
  phone.drafts.add();
  assert.equal(await me.renamer.rename('Taro'), 'Taro');
  await phone.store.refresh();
  assert.equal(phone.store.state.userId, 'Taro');
  assert.equal(phone.storage.getItem('pal-note.userId'), 'Taro');
  assert.deepEqual(phone.drafts.list().map((item) => item.registrant), ['Taro']);
  // 大小だけ違う全角も同じ名前としてそろう（キーが同じなので下書きは同じ保存先）
  assert.equal(phone.storage.values.has('pal-note.drafts.test.taro'), true);
});
