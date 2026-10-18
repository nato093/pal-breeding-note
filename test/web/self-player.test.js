import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSelfStore, selfKey, SELF_PREFIX } from '../../web/js/self-player.js';
import { ownPlayerUids } from '../../web/js/core/ideal-goals.js';

const WORLD = 'ABCDEF0123456789ABCDEF0123456789';
const OTHER_WORLD = 'FEDCBA9876543210FEDCBA9876543210';
const UID_A = '00000000-0000-0000-0000-000000000001';
const UID_B = 'abcd1234-0000-0000-0000-000000000000';
// 保存する値はプレイヤーの鍵（server の identity）。InstanceId のないプレイヤーと前の版の値（UID）は 'u:<uid>'
const KEY_A = `u:${UID_A}`;
const KEY_B = `u:${UID_B}`;

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

test('このワールドでの自分: 保存したプレイヤーの鍵をワールドごとに読み、空で消し、形の合わない値は読まない・保存しない', () => {
  const { self, storage, calls } = setup();
  assert.equal(self.get(WORLD), '');
  // UID だけを渡すと 'u:' の鍵にして保存する
  assert.equal(self.set(WORLD, UID_A), true);
  assert.equal(storage.map.get(`pal-note.ideals.self.test.taro.${WORLD}`), KEY_A);
  assert.equal(self.get(WORLD), KEY_A);
  assert.equal(self.get(WORLD.toLowerCase()), KEY_A);
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
  assert.equal(self.get(WORLD), KEY_A);
  assert.equal(calls.length, 1);
  failing = false;
  assert.equal(self.set(WORLD, UID_B), true);
  assert.equal(self.saveFailed, false);
  assert.equal(self.get(WORLD), KEY_B);
  // 保存先のない端末（localStorage が使えない）
  const none = setup({ storage: null });
  assert.equal(none.self.get(WORLD), '');
  assert.equal(none.self.set(WORLD, UID_A), false);
  assert.equal(none.self.saveFailed, true);
  assert.equal(none.self.get(WORLD), KEY_A);
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
  assert.equal(self.get(WORLD), KEY_B);
  // 名前の変更の後は、頭だけで全部を読み直す
  storage.map.set(`pal-note.ideals.self.test.taro.${WORLD}`, UID_A);
  self.reload('pal-note.ideals.self.');
  assert.equal(self.get(WORLD), KEY_A);
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
  assert.equal(self.get(WORLD), KEY_A);
  self.reload(`pal-note.ideals.self.test.taro.${WORLD}`);
  assert.equal(self.saveFailed, false);
  assert.equal(self.get(WORLD), KEY_B);
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
  assert.equal(self.get(WORLD), KEY_A);
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
  assert.deepEqual(seen, [KEY_A]);
  assert.equal(listeners.size, 0);
  store.emit();
  assert.deepEqual(seen, [KEY_A]);
  // 登録者の対応が変わった（本人の決め方が、このストアの外で変わった）
  self.changed();
  assert.deepEqual(seen, [KEY_A, KEY_A]);
});

// ---------------------------------------------------------------------------
// server の identity: キャラクターの鍵（i:）・前の版の UID の読み替え・移行（migrate）
// ---------------------------------------------------------------------------
const IID_A = '11111111-2222-3333-4444-555555555555';
const IID_B = '66666666-7777-8888-9999-aaaaaaaaaaaa';
const UID_U = 'abcdef01-0000-0000-0000-000000000000';

test('このワールドでの自分（server の identity）: キャラクターの鍵 i: を小文字で保存し、前の版の UID は u: として読む', () => {
  const { self, storage } = setup();
  assert.equal(self.set(WORLD, `I:${IID_A.toUpperCase()}`), true);
  assert.equal(storage.map.get(`pal-note.ideals.self.test.taro.${WORLD}`), `i:${IID_A}`);
  assert.equal(self.get(WORLD), `i:${IID_A}`);
  // 前の版（プレフィックスのない UID）を別のタブ・前の版の画面が書いた
  storage.map.set(`pal-note.ideals.self.test.taro.${OTHER_WORLD}`, UID_B.toUpperCase());
  assert.equal(self.get(OTHER_WORLD), KEY_B);
  // GUID でない i:・知らないプレフィックスは読まない・保存しない
  assert.equal(self.set(WORLD, 'i:not-a-guid'), false);
  assert.equal(self.set(WORLD, `x:${IID_A}`), false);
  storage.map.set(`pal-note.ideals.self.test.taro.${OTHER_WORLD}`, 'i:1234');
  self.reload(`pal-note.ideals.self.test.taro.${OTHER_WORLD}`);
  assert.equal(self.get(OTHER_WORLD), '');
});

test('このワールドでの自分（server の identity）: migrate は u: の値を同じ UID のプレイヤーの i: に書き直して知らせ、H は手元のホストのデータのときだけ', () => {
  const { self, storage, calls, store } = setup();
  const players = [{ uid: UID_A, name: 'Alice', instanceId: IID_A }, { uid: UID_U, name: 'Bob', instanceId: IID_B }, { uid: UID_B, name: 'Carol' }];
  const stored = () => storage.map.get(`pal-note.ideals.self.test.taro.${WORLD}`);
  // H 以外は共有のデータからでも移す（前の版の値〔UID〕も）。移す前の UID は、InstanceId のない共有で引くために '|' の後ろに覚える
  storage.map.set(`pal-note.ideals.self.test.taro.${WORLD}`, UID_U);
  assert.equal(self.migrate(WORLD, players), true);
  assert.equal(stored(), `i:${IID_B}|${UID_U}`);
  assert.deepEqual([self.get(WORLD), self.lastUid(WORLD)], [`i:${IID_B}`, UID_U]);
  assert.deepEqual(calls, ['changed']);
  // もう i: なら何もしない（知らせない）
  assert.equal(self.migrate(WORLD, players, { hostLocal: true }), false);
  assert.deepEqual(calls, ['changed']);
  // H（UID_A）: 参加者の画面（hostLocal でない）では移さない。手元のホストのデータなら移す
  assert.equal(self.set(WORLD, UID_A), true);
  assert.equal(self.migrate(WORLD, players), false);
  assert.equal(stored(), KEY_A);
  assert.equal(self.migrate(WORLD, players, { hostLocal: true }), true);
  // H は人ごとに決まった UID ではないので覚えない
  assert.deepEqual([stored(), self.lastUid(WORLD)], [`i:${IID_A}`, '']);
  // InstanceId のないプレイヤー・プレイヤーにいない UID は移さない（値はそのまま）
  assert.equal(self.set(WORLD, UID_B), true);
  assert.equal(self.migrate(WORLD, players, { hostLocal: true }), false);
  assert.equal(self.set(WORLD, 'ffffffff-0000-0000-0000-000000000000'), true);
  assert.equal(self.migrate(WORLD, players, { hostLocal: true }), false);
  assert.equal(stored(), 'u:ffffffff-0000-0000-0000-000000000000');
  // ID の変更中・ログイン前・プレイヤーの配列がないときは何もしない
  assert.equal(self.set(WORLD, UID_U), true);
  store.state.renaming = true;
  assert.equal(self.migrate(WORLD, players), false);
  store.state.renaming = false;
  assert.equal(self.migrate(WORLD, null), false);
  store.state.passcode = '';
  assert.equal(self.migrate(WORLD, players), false);
  store.state.passcode = '入力';
  assert.equal(stored(), `u:${UID_U}`);
});

test('このワールドでの自分（server の identity）: 書けない端末・書けずに手元にだけ残している値では migrate しない（saveFailed を立てない）', () => {
  const storage = memoryStorage();
  let failing = false;
  const flaky = { ...storage, setItem(key, value) { if (failing) throw new Error('QuotaExceededError'); storage.setItem(key, value); } };
  const { self, calls } = setup({ storage: flaky });
  const players = [{ uid: UID_U, name: 'Bob', instanceId: IID_B }];
  assert.equal(self.set(WORLD, UID_U), true);
  failing = true;
  assert.equal(self.migrate(WORLD, players), false);
  assert.equal(self.saveFailed, false);
  assert.equal(self.get(WORLD), `u:${UID_U}`);
  // 書けずに手元にだけ残している値は、書けるようになって選び直すまで移さない
  assert.equal(self.set(WORLD, UID_U), false);
  failing = false;
  assert.equal(self.migrate(WORLD, players), false);
  assert.equal(calls.length, 2);
});

test('このワールドでの自分（server の identity）: i: には選んだプレイヤーの UID（H 以外）を lastUid に覚え、u: と空では覚えない', () => {
  const { self, storage } = setup();
  const stored = () => storage.map.get(`pal-note.ideals.self.test.taro.${WORLD}`);
  assert.equal(self.set(WORLD, `i:${IID_B}`, { uid: UID_U.toUpperCase() }), true);
  assert.equal(stored(), `i:${IID_B}|${UID_U}`);
  assert.deepEqual([self.get(WORLD), self.lastUid(WORLD)], [`i:${IID_B}`, UID_U]);
  // 選び直すと前の UID は残さない（H・形の合わない UID は覚えない）
  assert.equal(self.set(WORLD, `i:${IID_A}`, { uid: UID_A }), true);
  assert.deepEqual([stored(), self.lastUid(WORLD)], [`i:${IID_A}`, '']);
  assert.equal(self.set(WORLD, `i:${IID_A}`, { uid: 'a b' }), true);
  assert.equal(stored(), `i:${IID_A}`);
  assert.equal(self.set(WORLD, `u:${UID_U}`, { uid: UID_U }), true);
  assert.deepEqual([stored(), self.lastUid(WORLD)], [`u:${UID_U}`, '']);
  assert.equal(self.set(WORLD, ''), true);
  assert.deepEqual([stored(), self.get(WORLD), self.lastUid(WORLD)], [undefined, '', '']);
  // 別のタブが書いた値も読む。u: の後ろ・H・形の合わない後ろは読まない
  const read = (value) => {
    storage.map.set(`pal-note.ideals.self.test.taro.${OTHER_WORLD}`, value);
    self.reload(`pal-note.ideals.self.test.taro.${OTHER_WORLD}`);
    return [self.get(OTHER_WORLD), self.lastUid(OTHER_WORLD)];
  };
  assert.deepEqual(read(`I:${IID_B.toUpperCase()}|${UID_U.toUpperCase()}`), [`i:${IID_B}`, UID_U]);
  assert.deepEqual(read(`u:${UID_B}|${UID_U}`), [KEY_B, '']);
  assert.deepEqual(read(`i:${IID_B}|${UID_A}`), [`i:${IID_B}`, '']);
  assert.deepEqual(read(`i:${IID_B}|a b`), [`i:${IID_B}`, '']);
  assert.deepEqual(read(`i:bad|${UID_U}`), ['', '']);
  // 書けない端末では手元にだけ残す（lastUid も）
  const none = setup({ storage: null });
  assert.equal(none.self.set(WORLD, `i:${IID_B}`, { uid: UID_U }), false);
  assert.deepEqual([none.self.get(WORLD), none.self.lastUid(WORLD)], [`i:${IID_B}`, UID_U]);
});

test('このワールドでの自分（server の identity）: migrate は i: の値で、引けたプレイヤーの UID（H 以外）を lastUid に覚える（自分は変わらないので知らせない）', () => {
  const { self, storage, calls } = setup();
  const stored = () => storage.map.get(`pal-note.ideals.self.test.taro.${WORLD}`);
  assert.equal(self.set(WORLD, `i:${IID_A}`), true);
  calls.length = 0;
  // 協力プレイ（このキャラクターは H）では覚えない
  assert.equal(self.migrate(WORLD, [{ uid: UID_A, name: 'Alice', instanceId: IID_A }], { hostLocal: true }), false);
  assert.equal(stored(), `i:${IID_A}`);
  // サーバー（同じキャラクターが U）で覚える。もう一度は書かない
  const server = [{ uid: UID_U, name: 'Alice', instanceId: IID_A }, { uid: UID_B, name: 'Bob', instanceId: IID_B }];
  assert.equal(self.migrate(WORLD, server), true);
  assert.deepEqual([stored(), self.lastUid(WORLD)], [`i:${IID_A}|${UID_U}`, UID_U]);
  assert.equal(self.migrate(WORLD, server), false);
  // InstanceId のない共有・いないキャラクターでは何もしない（覚えた UID は消さない）
  assert.equal(self.migrate(WORLD, [{ uid: UID_U, name: 'Alice' }]), false);
  assert.equal(self.migrate(WORLD, [{ uid: UID_B, name: 'Bob', instanceId: IID_B }]), false);
  assert.equal(stored(), `i:${IID_A}|${UID_U}`);
  assert.deepEqual(calls, []);
});

test('このワールドでの自分（server の identity）: migrateShown は表示している所持パルで migrate し、H を移すのは手元のホストのデータ（source local・role host）のときだけ', () => {
  const { self, storage, calls } = setup();
  const stored = () => storage.map.get(`pal-note.ideals.self.test.taro.${WORLD}`);
  const players = [{ uid: UID_A, name: 'Alice', instanceId: IID_A }, { uid: UID_U, name: 'Bob', instanceId: IID_B }];
  const shown = (source, role, extra = {}) => ({ role, meta: { worldId: WORLD.toLowerCase(), source }, owned: { players }, ...extra });
  storage.map.set(`pal-note.ideals.self.test.taro.${WORLD}`, UID_A);
  // この PC がホストの判定のまま、別の PC の新しい共有を表示している・参加者・閲覧者では移さない
  assert.equal(self.migrateShown(shown('shared', 'host')), false);
  assert.equal(self.migrateShown(shown('local', 'guest')), false);
  assert.equal(self.migrateShown(shown('shared', '')), false);
  assert.equal(stored(), UID_A);
  // ワールド・プレイヤーが分からなければ何もしない
  assert.equal(self.migrateShown(shown('local', 'host', { meta: null })), false);
  assert.equal(self.migrateShown(shown('local', 'host', { owned: null })), false);
  assert.equal(self.migrateShown(null), false);
  assert.deepEqual(calls, []);
  // 手元のホストのデータなら H も移す
  assert.equal(self.migrateShown(shown('local', 'host')), true);
  assert.equal(stored(), `i:${IID_A}`);
  assert.deepEqual(calls, ['changed']);
  // H 以外は共有を表示していても移す
  storage.map.set(`pal-note.ideals.self.test.taro.${WORLD}`, UID_U);
  self.reload(`pal-note.ideals.self.test.taro.${WORLD}`);
  assert.equal(self.migrateShown(shown('shared', '')), true);
  assert.equal(stored(), `i:${IID_B}|${UID_U}`);
});

test('このワールドでの自分（server の identity）: 前の版の値から、協力プレイ（H）→ サーバー（U）→ 版 12 の共有（InstanceId なし）→ 版 13 → 協力プレイと往復しても、選んだキャラクターのまま（app.js と同じ流れ）', () => {
  const { self, storage } = setup({ state: { userId: 'Bob' } });
  const strip = (players) => players.map(({ uid, name }) => ({ uid, name }));
  // ログイン中の Bob のキャラクターはゲーム内の名前が GameBob（IID_A）。別の人（UID_B）のゲーム内の名前が Bob
  const coopHost = [{ uid: UID_A, name: 'GameBob', instanceId: IID_A }, { uid: UID_B, name: 'Bob', instanceId: IID_B }];
  const server = [{ uid: UID_U, name: 'GameBob', instanceId: IID_A }, { uid: UID_B, name: 'Bob', instanceId: IID_B }];
  // 表示が替わるたびに app.js と同じく migrateShown を呼び、ideals と同じ identity で自分を決める
  const show = (players, source = 'shared', role = '') => {
    self.migrateShown({ role, meta: { worldId: WORLD, source }, owned: { players } });
    return [...ownPlayerUids(players, { userId: 'Bob', users: ['Bob'], self: self.get(WORLD), selfLastUid: self.lastUid(WORLD) })];
  };
  // 前の版で、協力プレイのホストのときに自分（H）を選んでいた
  storage.map.set(`pal-note.ideals.self.test.bob.${WORLD}`, UID_A);
  assert.deepEqual(show(coopHost, 'local', 'host'), [UID_A]);
  assert.equal(self.get(WORLD), `i:${IID_A}`);
  assert.deepEqual(show(server), [UID_U]);
  assert.equal(self.lastUid(WORLD), UID_U);
  // 版 12 に巻き戻した GAS の共有（InstanceId なし）→ 版 13 に戻す
  assert.deepEqual(show(strip(server)), [UID_U]);
  assert.deepEqual(show(server), [UID_U]);
  // 協力プレイに戻し、古い画面のホストが共有した（この人が H。H は覚えていないので見分けられない。同じ名前の別の人にはしない）
  assert.deepEqual(show(strip(coopHost)), []);
  assert.deepEqual(show(coopHost, 'local', 'host'), [UID_A]);
  assert.deepEqual([self.get(WORLD), self.lastUid(WORLD)], [`i:${IID_A}`, UID_U]);
});
