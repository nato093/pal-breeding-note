import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSelfStore, selfKey, SELF_PREFIX } from '../../web/js/self-player.js';

const WORLD = 'ABCDEF0123456789ABCDEF0123456789';
const OTHER_WORLD = 'FEDCBA9876543210FEDCBA9876543210';
const UID_A = '00000000-0000-0000-0000-000000000001';
const UID_B = 'abcd1234-0000-0000-0000-000000000000';

function memoryStorage() {
  const map = new Map();
  return { map, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key) };
}

function setup({ storage = memoryStorage(), state = {} } = {}) {
  const store = { state: { env: 'test', userId: 'Ｔａｒｏ', passcode: '入力', ...state } };
  const self = createSelfStore({ store, storage });
  const calls = [];
  self.subscribe(() => calls.push('changed'));
  return { store, storage, self, calls };
}

test('このワールドでの自分: キーは環境・ID（大小・全半角をそろえる）・ワールド ID（大文字）で、どれか欠けるか形が違えば空', () => {
  assert.equal(SELF_PREFIX('pal-note'), 'pal-note.ideals.self.');
  assert.equal(selfKey('pal-note', 'prod', 'Ｔａｒｏ', WORLD.toLowerCase()), `pal-note.ideals.self.prod.taro.${WORLD}`);
  assert.equal(selfKey('pal-note', '', 'Taro', WORLD), '');
  assert.equal(selfKey('pal-note', 'prod', '', WORLD), '');
  assert.equal(selfKey('pal-note', 'prod', 'Taro', 'W1'), '');
  const { self, store } = setup();
  assert.equal(self.key(WORLD), `pal-note.ideals.self.test.taro.${WORLD}`);
  // ログイン前（パスワードなし）はキーがない
  store.state.passcode = '';
  assert.equal(self.key(WORLD), '');
});

test('このワールドでの自分: 保存した UID をワールドごとに読み、空で消し、形の合わない値は読まない・保存しない', () => {
  const { self, storage, calls } = setup();
  assert.equal(self.get(WORLD), '');
  assert.equal(self.set(WORLD, UID_A), true);
  assert.equal(storage.map.get(`pal-note.ideals.self.test.taro.${WORLD}`), UID_A);
  assert.equal(self.get(WORLD), UID_A);
  assert.equal(self.get(WORLD.toLowerCase()), UID_A);
  assert.equal(self.get(OTHER_WORLD), '');
  assert.deepEqual(calls, ['changed']);
  // 空で消す
  assert.equal(self.set(WORLD, ''), true);
  assert.equal(storage.map.has(`pal-note.ideals.self.test.taro.${WORLD}`), false);
  assert.equal(self.get(WORLD), '');
  // 形の合わない UID は保存しない（知らせもしない）
  assert.equal(self.set(WORLD, 'not a uid!'), false);
  assert.equal(self.set('W1', UID_A), false);
  assert.equal(storage.map.size, 0);
  assert.equal(calls.length, 2);
  // 別のタブ・古い版が書いた形の合わない値は ''
  storage.map.set(`pal-note.ideals.self.test.taro.${OTHER_WORLD}`, '<script>');
  self.reload(`pal-note.ideals.self.test.taro.${OTHER_WORLD}`);
  assert.equal(self.get(OTHER_WORLD), '');
  storage.map.set(`pal-note.ideals.self.test.taro.${OTHER_WORLD}`, 'f'.repeat(65));
  self.reload(`pal-note.ideals.self.test.taro.${OTHER_WORLD}`);
  assert.equal(self.get(OTHER_WORLD), '');
});

test('このワールドでの自分: 保存できない端末では手元にだけ残して saveFailed を立て、保存できたら戻す', () => {
  const storage = memoryStorage();
  let failing = true;
  const flaky = { ...storage, setItem(key, value) { if (failing) throw new Error('QuotaExceededError'); storage.setItem(key, value); } };
  const { self, calls } = setup({ storage: flaky });
  assert.equal(self.set(WORLD, UID_A), false);
  assert.equal(self.saveFailed, true);
  assert.equal(self.get(WORLD), UID_A);
  assert.equal(calls.length, 1);
  failing = false;
  assert.equal(self.set(WORLD, UID_B), true);
  assert.equal(self.saveFailed, false);
  assert.equal(self.get(WORLD), UID_B);
  // 保存先のない端末（localStorage が使えない）
  const none = setup({ storage: null });
  assert.equal(none.self.get(WORLD), '');
  assert.equal(none.self.set(WORLD, UID_A), false);
  assert.equal(none.self.saveFailed, true);
  assert.equal(none.self.get(WORLD), UID_A);
});

test('このワールドでの自分: reload は SELF_PREFIX のキー（と頭そのもの）だけで読み直して知らせ、ほかのキーでは何もしない', () => {
  const { self, storage, calls } = setup();
  assert.equal(self.get(WORLD), '');
  // 別のタブが書いた
  storage.map.set(`pal-note.ideals.self.test.taro.${WORLD}`, UID_B);
  assert.equal(self.get(WORLD), '');
  for (const key of ['pal-note.ideals.test.taro', 'pal-note.drafts.test.taro', null, undefined]) self.reload(key);
  assert.deepEqual(calls, []);
  self.reload(`pal-note.ideals.self.test.taro.${WORLD}`);
  assert.deepEqual(calls, ['changed']);
  assert.equal(self.get(WORLD), UID_B);
  // 名前の変更の後は、頭だけで全部を読み直す
  storage.map.set(`pal-note.ideals.self.test.taro.${WORLD}`, UID_A);
  self.reload('pal-note.ideals.self.');
  assert.equal(self.get(WORLD), UID_A);
  assert.equal(calls.length, 2);
});

test('このワールドでの自分: saveFailed は今のログイン（環境・ID）のキーの分だけで数え、別のタブが書いたキーの書けなかった値は reload で捨てる', () => {
  const storage = memoryStorage();
  let failing = true;
  const flaky = { ...storage, setItem(key, value) { if (failing) throw new Error('QuotaExceededError'); storage.setItem(key, value); } };
  const { self, store } = setup({ storage: flaky });
  assert.equal(self.set(WORLD, UID_A), false);
  assert.equal(self.saveFailed, true);
  // 別の ID でログインし直した（前の ID の書けなかった値は、その ID に戻るまで数えない）
  store.state.userId = 'Hanako';
  assert.equal(self.saveFailed, false);
  // ID に「.」のある別の人（taro.x）の書けなかった値は、taro の分に数えない
  store.state.userId = 'taro.x';
  assert.equal(self.set(WORLD, UID_B), false);
  assert.equal(self.saveFailed, true);
  store.state.userId = 'taro';
  assert.equal(self.saveFailed, true);
  self.reload(`pal-note.ideals.self.test.taro.${WORLD}`);
  assert.equal(self.saveFailed, false);
  store.state.userId = 'taro.x';
  assert.equal(self.saveFailed, true);
  self.reload(`pal-note.ideals.self.test.taro.x.${WORLD}`);
  store.state.userId = 'taro';
  assert.equal(self.set(WORLD, UID_A), false);
  assert.equal(self.saveFailed, true);
  // 別の環境・ログアウト中も数えない
  store.state.env = 'prod';
  assert.equal(self.saveFailed, false);
  store.state.env = 'test';
  store.state.passcode = '';
  assert.equal(self.saveFailed, false);
  store.state.passcode = '入力';
  // 別のタブがそのキーに書いた（保存先の方が新しい）ら、書けなかった値を捨てて保存先を読む
  failing = false;
  storage.setItem(`pal-note.ideals.self.test.taro.${WORLD}`, UID_B);
  self.reload(`pal-note.ideals.self.test.taro.${OTHER_WORLD}`);
  assert.equal(self.saveFailed, true);
  assert.equal(self.get(WORLD), UID_A);
  self.reload(`pal-note.ideals.self.test.taro.${WORLD}`);
  assert.equal(self.saveFailed, false);
  assert.equal(self.get(WORLD), UID_B);
  // ID の変更の後（頭だけ）は、全部の書けなかった値を捨てる
  failing = true;
  assert.equal(self.set(OTHER_WORLD, UID_A), false);
  assert.equal(self.saveFailed, true);
  self.reload('pal-note.ideals.self.');
  assert.equal(self.saveFailed, false);
  assert.equal(self.get(OTHER_WORLD), '');
});

test('このワールドでの自分: reload の defer は知らせを次の store の通知まで遅らせて 1 回だけ知らせ、changed はすぐ知らせる', () => {
  const listeners = new Set();
  const store = {
    state: { env: 'test', userId: 'Taro', passcode: '入力' },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    emit() { [...listeners].forEach((listener) => listener(store.state)); },
  };
  const storage = memoryStorage();
  const self = createSelfStore({ store, storage });
  const seen = [];
  // 知らせを受けたときに読める自分（ID の変更の途中で、前の ID のキーを読んで一度「分からない」にならないこと）
  self.subscribe(() => seen.push(self.get(WORLD)));
  storage.setItem(`pal-note.ideals.self.test.taro.${WORLD}`, UID_A);
  assert.equal(self.get(WORLD), UID_A);
  // ID の変更で端末のデータを移した（前の ID のキーは消え、ログイン中の ID はまだ前の ID のまま）
  storage.removeItem(`pal-note.ideals.self.test.taro.${WORLD}`);
  storage.setItem(`pal-note.ideals.self.test.jiro.${WORLD}`, UID_A);
  self.reload('pal-note.ideals.self.', { defer: true });
  self.reload('pal-note.ideals.self.', { defer: true });
  assert.deepEqual(seen, []);
  assert.equal(listeners.size, 1);
  // 新しい ID になった store の通知で、1 回だけ知らせる（購読もやめる）
  store.state.userId = 'Jiro';
  store.emit();
  assert.deepEqual(seen, [UID_A]);
  assert.equal(listeners.size, 0);
  store.emit();
  assert.deepEqual(seen, [UID_A]);
  // 登録者の対応が変わった（本人の決め方が、このストアの外で変わった）
  self.changed();
  assert.deepEqual(seen, [UID_A, UID_A]);
});
