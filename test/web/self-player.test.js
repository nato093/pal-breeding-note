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
