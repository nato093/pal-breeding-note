import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, descendants } from '../helpers/dom.js';
import pals from '../../web/data/pals.js';
import { buildIndex } from '../../web/js/core/index.js';
import { createDevelopmentApi } from '../../dev/mock-api.js';
import { createApi } from '../../web/js/api.js';
import { createStore, safeStorage } from '../../web/js/store.js';
import { createNotificationStore } from '../../web/js/notifications.js';
import { createWishlistStore, wishlistNotificationSource } from '../../web/js/wishlist.js';
import { wishlistView } from '../../web/js/views/wishlist.js';
import { parseHash, buildHash } from '../../web/js/router.js';

const TARGET = 'MoonQueen';
const KEY = 'test-note.wishlist.test.自分';
const time = (second) => new Date(Date.UTC(2026, 9, 4, 0, 0, second)).toISOString();
const breeding = (childId = TARGET, id = crypto.randomUUID()) => ({ id, parent1Id: 'SheepBall', parent2Id: 'FlowerDoll', childId });
const palName = (id) => pals.find((pal) => pal.id === id).ja;
const ids = (notifications) => notifications.list().map((notification) => notification.id);
const flush = () => new Promise((resolve) => setImmediate(resolve));

function memoryStorage() {
  const values = new Map();
  return {
    values, fail: false, writes: 0,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) {
      if (this.fail) throw new Error('QuotaExceededError');
      this.writes += 1;
      values.set(key, String(value));
    },
  };
}

// store の購読者から見える動きだけを再現する。
function fakeStore({ records = [], second = 0, ...state }) {
  const listeners = new Set();
  const store = {
    state: {
      env: 'test', userId: '自分', passcode: '入力', cached: false, serverTime: time(second),
      confirmedRecords: records, index: buildIndex(records, pals), ...state,
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    emit() { listeners.forEach((listener) => listener(store.state)); },
    // サーバの全件（cached なら起動時のキャッシュ）を受けたとき: 確定データと時刻が変わる。
    receive(next, nextSecond, { cached = false } = {}) {
      Object.assign(store.state, { confirmedRecords: next, index: buildIndex(next, pals), serverTime: time(nextSecond), cached });
      store.emit();
    },
    // 送信待ちを重ねたとき・失敗して外したとき: 画面のデータだけが変わる。
    show(next) {
      store.state.index = buildIndex(next, pals);
      store.emit();
    },
  };
  return store;
}

function setup({ storage = memoryStorage(), clock = 1000, ...options } = {}) {
  const store = fakeStore(options);
  let current = clock;
  const wishlist = createWishlistStore({ store, storage, namespace: 'test-note', now: () => current });
  const notifications = createNotificationStore({
    store, storage, namespace: 'test-note', sources: [wishlistNotificationSource({ store, wishlist })],
  });
  return { store, storage, wishlist, notifications, tick() { current += 1000; } };
}

test('ルーティング: ウィッシュリストのタブを開ける', () => {
  assert.equal(parseHash('#/wishlist').view, 'wishlist');
  assert.equal(buildHash('wishlist'), '#/wishlist');
});

test('ウィッシュリスト: ID・環境ごとに保存し、重複・不正なパル・未ログインでは追加せず、壊れた保存値は読み捨てる', () => {
  const app = setup();
  assert.equal(app.wishlist.add(TARGET), true);
  assert.equal(app.wishlist.add(TARGET), false);
  assert.equal(app.wishlist.add('存在しないパル'), null);
  assert.equal(app.wishlist.add('Alpaca'), true);
  assert.deepEqual(app.wishlist.list().map((wish) => wish.palId), ['Alpaca', TARGET]);
  assert.deepEqual(JSON.parse(app.storage.values.get(KEY)).map((wish) => wish.palId), ['Alpaca', TARGET]);
  app.store.state.env = 'prod';
  assert.deepEqual(app.wishlist.list(), []);
  Object.assign(app.store.state, { env: 'test', userId: '仲間' });
  assert.deepEqual(app.wishlist.list(), []);
  app.store.state.passcode = '';
  assert.equal(app.wishlist.add(TARGET), null);

  const storage = memoryStorage();
  storage.values.set(KEY, JSON.stringify([{ palId: TARGET, craftable: 'yes', readyAt: '2026-10-04', observedAt: 'いつか' },
    { palId: TARGET }, { palId: '存在しないパル' }, null]));
  // 判定したことがないウィッシュは、最新のデータで判定し直す。
  assert.deepEqual(setup({ storage }).wishlist.list(), [{ palId: TARGET, addedAt: '', craftable: false, readyAt: '', observedAt: time(0), pairs: [], found: [] }]);
  storage.values.set(KEY, '壊れた値');
  assert.deepEqual(setup({ storage }).wishlist.list(), []);
});

test('ウィッシュリスト: 別のタブの保存を消さずに足し、保存できなければ知らせて手元に残す', () => {
  const app = setup();
  app.wishlist.add(TARGET);
  const [saved] = JSON.parse(app.storage.values.get(KEY));
  app.storage.values.set(KEY, JSON.stringify([{ ...saved, palId: 'Alpaca' }, saved]));
  app.wishlist.add('Boar');
  assert.deepEqual(app.wishlist.list().map((wish) => wish.palId), ['Boar', 'Alpaca', TARGET]);
  app.storage.fail = true;
  app.wishlist.add('Deer');
  assert.equal(app.wishlist.saveFailed, true);
  assert.deepEqual(app.wishlist.list().map((wish) => wish.palId), ['Deer', 'Boar', 'Alpaca', TARGET]);
});

test('ウィッシュリスト: 追加時に作れるパルは、追加前の配合だけが消えても、作れる状態が続く限り通知しない', () => {
  const before = breeding();
  const app = setup({ records: [before] });
  app.wishlist.add(TARGET);
  assert.equal(app.wishlist.list()[0].craftable, true);
  const after = breeding();
  app.store.receive([before, after], 1);
  app.store.receive([after], 2);
  assert.deepEqual(ids(app.notifications), []);
});

test('ウィッシュリスト: 追加後に作れるようになったら通知し、逆引きを開く。新しいデータが無ければ判定も保存もしない', () => {
  const app = setup();
  app.wishlist.add(TARGET);
  const writes = app.storage.writes;
  app.store.emit();
  assert.equal(app.storage.writes, writes);
  assert.deepEqual(ids(app.notifications), []);
  app.tick();
  app.store.receive([breeding()], 1);
  const wish = app.wishlist.list()[0];
  assert.equal(wish.readyAt, new Date(2000).toISOString());
  assert.deepEqual(app.notifications.list(), [{
    id: `wishlist:test:${TARGET}:${wish.readyAt}`, date: wish.readyAt, time: 2000,
    title: 'セレムーンが作成可能になりました', body: 'ウィッシュリストのパルです。押すと逆引きで、生まれる配合を確認できます。',
    href: '#/reverse?c=MoonQueen',
  }]);
  assert.equal(app.storage.writes, writes + 1);
});

test('ウィッシュリスト: 作れる状態で別の組み合わせが増えたら、パル名と親を付けて別の文言で知らせる', () => {
  const first = breeding();
  const other = { ...breeding(), parent1Id: 'Alpaca', parent2Id: 'Boar' };
  const app = setup({ records: [first] });
  app.wishlist.add(TARGET);
  app.tick();
  app.store.receive([first, other], 1);
  const at = new Date(2000).toISOString();
  assert.deepEqual(app.wishlist.list()[0].found, [{ pair: 'Alpaca|Boar', at }]);
  assert.deepEqual(app.notifications.list(), [{
    id: `wishlist:test:${TARGET}:Alpaca|Boar:${at}`, date: at, time: 2000,
    title: 'セレムーンの配合が増えました', body: `${palName('Alpaca')}＋${palName('Boar')}でも作れるようになりました。押すと逆引きで確認できます。`,
    href: '#/reverse?c=MoonQueen',
  }]);
  // 親の左右を入れ替えただけの登録は、同じ組み合わせとして扱う。
  app.tick();
  app.store.receive([first, other, { ...breeding(), parent1Id: 'FlowerDoll', parent2Id: 'SheepBall' }, { ...other, parent1Id: 'Boar', parent2Id: 'Alpaca' }], 2);
  assert.equal(app.wishlist.list()[0].found.length, 1);
  // 根拠の配合が消えたら通知も消し、また登録されても重ねて知らせない。
  app.tick();
  app.store.receive([first], 3);
  assert.deepEqual(ids(app.notifications), []);
  app.tick();
  app.store.receive([first, other], 4);
  assert.deepEqual(app.wishlist.list()[0].found, []);
  assert.deepEqual(ids(app.notifications), []);
});

test('ウィッシュリスト: 手元のマスターにないパルが親の組み合わせも覚え、通知は落とさずに出して、読み直しても重ねて知らせない', () => {
  const app = setup({ records: [breeding()] });
  app.wishlist.add(TARGET);
  app.tick();
  const unknown = { ...breeding(), parent1Id: 'Boar', parent2Id: '未来のパル' };
  app.store.receive([breeding(), unknown], 1);
  assert.deepEqual(app.notifications.list().map((notification) => notification.body),
    [`${palName('Boar')}＋不明なパルでも作れるようになりました。押すと逆引きで確認できます。`]);
  const reloaded = setup({ storage: app.storage, records: [breeding(), unknown] });
  reloaded.store.receive([breeding(), unknown], 2);
  assert.deepEqual(ids(reloaded.notifications), ids(app.notifications));
});

test('ウィッシュリスト: 作れるようになったときは「作成可能」だけを知らせ、作れなくなったら増えた配合の通知も消す', () => {
  const app = setup();
  app.wishlist.add(TARGET);
  app.store.receive([breeding(), { ...breeding(), parent1Id: 'Alpaca', parent2Id: 'Boar' }], 1);
  assert.deepEqual(app.notifications.list().map((notification) => notification.title), ['セレムーンが作成可能になりました']);
  app.tick();
  app.store.receive([breeding(), { ...breeding(), parent1Id: 'Alpaca', parent2Id: 'Boar' }, { ...breeding(), parent1Id: 'Deer', parent2Id: 'Boar' }], 2);
  assert.deepEqual(app.notifications.list().map((notification) => notification.title), ['セレムーンの配合が増えました', 'セレムーンが作成可能になりました']);
  app.store.receive([], 3);
  assert.deepEqual(ids(app.notifications), []);
  assert.deepEqual(app.wishlist.list()[0].found, []);
});

test('ウィッシュリスト: 組み合わせを覚える前の保存内容は、次の判定で今の組み合わせを覚えるだけで知らせない', () => {
  const storage = memoryStorage();
  storage.values.set(KEY, JSON.stringify([{ palId: TARGET, addedAt: time(0), craftable: true, readyAt: '', observedAt: time(0) }]));
  const app = setup({ storage, records: [breeding()] });
  app.store.receive([breeding(), { ...breeding(), parent1Id: 'Alpaca', parent2Id: 'Boar' }], 1);
  assert.deepEqual(ids(app.notifications), []);
  assert.deepEqual(app.wishlist.list()[0].pairs, ['FlowerDoll|SheepBall', 'Alpaca|Boar']);
  app.store.receive([breeding(), { ...breeding(), parent1Id: 'Alpaca', parent2Id: 'Boar' }, { ...breeding(), parent1Id: 'Deer', parent2Id: 'Boar' }], 2);
  assert.equal(ids(app.notifications).length, 1);
});

for (const [name, change] of [
  ['編集で子が変わって', (record) => [{ ...record, childId: TARGET }]],
  ['削除した配合が元に戻って', (record) => [record, breeding(TARGET, `${record.id}-戻した`)]],
]) {
  test(`ウィッシュリスト: ${name}作れるようになっても、登録日時によらず通知する`, () => {
    const other = { ...breeding('Alpaca'), createdAt: time(0) };
    const app = setup({ records: [other] });
    app.wishlist.add(TARGET);
    app.store.receive(change(other).map((record) => ({ ...record, createdAt: time(0) })), 1);
    assert.equal(ids(app.notifications).length, 1);
  });
}

test('ウィッシュリスト: 送信待ちの登録では通知せず確定で通知し、失敗した送信待ちを見て追加しても後の登録で通知する', () => {
  const pending = breeding();
  const app = setup();
  app.wishlist.add(TARGET);
  app.store.show([pending]);
  assert.deepEqual(ids(app.notifications), []);
  app.store.receive([pending], 1);
  assert.equal(ids(app.notifications).length, 1);

  const failed = setup();
  failed.store.show([pending]);
  failed.wishlist.add(TARGET);
  assert.equal(failed.wishlist.list()[0].craftable, false);
  failed.store.show([]);
  assert.deepEqual(ids(failed.notifications), []);
  failed.store.receive([breeding()], 1);
  assert.equal(ids(failed.notifications).length, 1);
});

test('ウィッシュリスト: 作れなくなったら通知を消し、また作れるようになったら新しい通知にする。外すと通知も消える', () => {
  const app = setup();
  app.wishlist.add(TARGET);
  app.store.receive([breeding()], 1);
  const [first] = ids(app.notifications);
  app.store.receive([], 2);
  assert.deepEqual(ids(app.notifications), []);
  assert.equal(app.wishlist.list()[0].readyAt, '');
  app.tick();
  app.store.receive([breeding()], 3);
  const [second] = ids(app.notifications);
  assert.ok(second && second !== first);
  app.wishlist.remove(TARGET);
  assert.deepEqual(ids(app.notifications), []);
});

test('ウィッシュリスト: 起動時のキャッシュは新しくても判定せず、古いデータでは判定を巻き戻さない', () => {
  const app = setup();
  app.wishlist.add(TARGET);
  const writes = app.storage.writes;
  app.store.receive([breeding()], 5, { cached: true });
  assert.deepEqual(ids(app.notifications), []);
  assert.equal(app.storage.writes, writes);
  app.store.receive([breeding()], 6);
  const notified = ids(app.notifications);
  assert.equal(notified.length, 1);
  app.store.receive([], 4);
  assert.deepEqual(ids(app.notifications), notified);
});

test('ウィッシュリスト: 時刻は新しいのに内容が古いデータを受けても、次の新しいデータで正しい状態に戻る', () => {
  const app = setup();
  app.wishlist.add(TARGET);
  app.store.receive([breeding()], 5);
  app.store.receive([], 6);
  assert.deepEqual(ids(app.notifications), []);
  app.tick();
  app.store.receive([breeding()], 7);
  assert.equal(ids(app.notifications).length, 1);
});

test('ウィッシュリスト: 元に戻すと外している間のデータで判定し直し、別の ID に切り替えた後は元の ID に戻すだけにする', () => {
  const record = breeding();
  const app = setup();
  app.wishlist.add(TARGET);
  app.store.receive([record], 1);
  const key = app.wishlist.scope();
  let removed = app.wishlist.remove(TARGET, key);
  app.store.receive([], 2);
  app.wishlist.restore(removed.wish, removed.index, key);
  assert.deepEqual(ids(app.notifications), []);
  assert.equal(app.wishlist.list()[0].craftable, false);

  removed = app.wishlist.remove(TARGET, key);
  app.tick();
  app.store.receive([record], 3);
  app.wishlist.restore(removed.wish, removed.index, key);
  assert.equal(ids(app.notifications).length, 1);

  removed = app.wishlist.remove(TARGET, key);
  app.store.state.userId = '仲間';
  app.store.receive([], 4);
  assert.equal(app.wishlist.restore(removed.wish, removed.index, key), true);
  assert.deepEqual(app.wishlist.list(), []);
  assert.deepEqual(JSON.parse(app.storage.values.get(key)), [removed.wish]);
});

test('ウィッシュリスト: 古いデータのタブで追加した分を新しいデータのタブが判定し、古いタブは巻き戻さない', () => {
  const storage = memoryStorage();
  const fresh = setup({ storage, records: [breeding()], second: 5 });
  const stale = setup({ storage, second: 3 });
  stale.wishlist.add(TARGET);
  assert.equal(stale.wishlist.list()[0].craftable, false);
  fresh.wishlist.reload(KEY);
  assert.equal(ids(fresh.notifications).length, 1);
  stale.wishlist.reload(KEY);
  stale.store.emit();
  assert.equal(stale.wishlist.list()[0].craftable, true);
  assert.deepEqual(ids(stale.notifications), ids(fresh.notifications));
});

test('ウィッシュリスト: 同じパル・同じ時刻でも環境ごとに通知を分け、一方の既読が他方に影響しない', () => {
  const storage = memoryStorage();
  const testApp = setup({ storage });
  const prodApp = setup({ storage, env: 'prod' });
  for (const app of [testApp, prodApp]) {
    app.wishlist.add(TARGET);
    app.store.receive([breeding()], 1);
  }
  const [testId] = ids(testApp.notifications);
  const [prodId] = ids(prodApp.notifications);
  assert.notEqual(testId, prodId);
  testApp.notifications.markRead([testId]);
  prodApp.notifications.reload('test-note.notifications.read.自分');
  assert.deepEqual(prodApp.notifications.unread().map((notification) => notification.id), [prodId]);
});

test('ウィッシュリスト: 実際の store でも、送信待ちの間は通知せず、確定したら通知し、失敗した登録では通知しない', async () => {
  const development = createDevelopmentApi();
  let second = 0;
  let held = null;
  let serve = (request) => development(request);
  // 同じミリ秒の応答で判定が止まらないよう、サーバ時刻を 1 秒ずつ進める。
  const api = createApi({ transport: async (request) => {
    await held;
    const response = await serve(request);
    if (typeof response.serverTime === 'string') response.serverTime = time(++second);
    if (response.snapshot) response.snapshot.serverTime = time(++second);
    return response;
  } });
  const store = createStore({ api, storage: safeStorage(null) });
  await store.signup('自分', '画面試験用の入力');
  const storage = memoryStorage();
  const wishlist = createWishlistStore({ store, storage, namespace: 'test-note' });
  const notifications = createNotificationStore({ store, storage, namespace: 'test-note', sources: [wishlistNotificationSource({ store, wishlist })] });
  wishlist.add(TARGET);
  let release;
  held = new Promise((resolve) => { release = resolve; });
  const saving = store.mutate('create', { record: breeding() });
  await flush();
  assert.equal(store.state.records.length, 1);
  assert.deepEqual(ids(notifications), []);
  held = null;
  release();
  await saving;
  assert.equal(ids(notifications).length, 1);

  wishlist.add('Alpaca');
  serve = async () => ({ ok: false, code: 'CONFLICT' });
  await assert.rejects(store.mutate('create', { record: { ...breeding('Alpaca'), parent1Id: 'Boar' } }));
  assert.equal(ids(notifications).some((id) => id.includes('Alpaca')), false);
});

async function choose(view, id) {
  const picker = view.element.querySelector('.picker');
  await picker.querySelector('.picker-trigger').dispatch('click');
  const input = picker.querySelector('input');
  input.value = palName(id);
  await input.dispatch('input');
  await picker.querySelectorAll('[role="option"]').find((option) => option.textContent.includes(palName(id))).dispatch('click');
}

test('ウィッシュリスト画面: 選ぶとすぐ追加して選択欄を空に戻し、作れるパルを上に並べて逆引きへのリンクにする', async (t) => {
  const { body } = installDom(t);
  const app = setup({ records: [breeding()] });
  const view = wishlistView({ store: app.store, wishlist: app.wishlist });
  body.append(view.element);
  t.after(() => view.destroy());
  assert.match(view.element.textContent, /作りたいパルはまだありません/);
  await choose(view, TARGET);
  await choose(view, 'Alpaca');
  assert.equal(view.element.querySelector('.picker-trigger').textContent, 'パルを選択');
  assert.equal(document.activeElement, view.element.querySelector('.picker-trigger'));
  const rows = view.element.querySelectorAll('.wishlist-row');
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /セレムーン.*作成可能.*逆引きで見る/);
  assert.equal(rows[0].querySelector('a').href, '#/reverse?c=MoonQueen');
  assert.match(rows[1].textContent, /メルパカ.*まだ作れません/);
  assert.equal(rows[1].querySelector('a'), null);
  await choose(view, TARGET);
  assert.match(body.textContent, /セレムーンはすでにウィッシュリストにあります/);
  assert.equal(view.element.querySelectorAll('.wishlist-row').length, 2);
});

test('ウィッシュリスト画面: 外すと一覧から消え、元に戻すと同じ位置に戻る', async (t) => {
  const { body } = installDom(t);
  const app = setup();
  for (const id of ['Deer', 'Alpaca', TARGET]) app.wishlist.add(id);
  const view = wishlistView({ store: app.store, wishlist: app.wishlist });
  body.append(view.element);
  t.after(() => view.destroy());
  const names = () => view.element.querySelectorAll('.wishlist-row').map((row) => row.querySelector('strong').textContent);
  assert.deepEqual(names(), ['セレムーン', 'メルパカ', 'ツノガミ']);
  await view.element.querySelector('button[aria-label="メルパカをウィッシュリストから外す"]').dispatch('click');
  assert.deepEqual(names(), ['セレムーン', 'ツノガミ']);
  await descendants(body).find((node) => node.tagName === 'button' && node.textContent === '元に戻す').dispatch('click');
  assert.deepEqual(names(), ['セレムーン', 'メルパカ', 'ツノガミ']);
});
