import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIdealStore, idealNotificationSource } from '../../web/js/ideals.js';
import { cleanNotification } from '../../web/js/notifications.js';
import { moveUserStorage } from '../../web/js/user-rename.js';

const WORLD_A = 'ABCDEF0123456789ABCDEF0123456789';
const WORLD_B = 'FEDCBA9876543210FEDCBA9876543210';
const KEY = 'pal-note.ideals.test.仲間';
const time = (minute) => new Date(Date.UTC(2026, 9, 8, 0, minute)).toISOString();
const talent = (v) => ({ hp: v, shot: v, defense: v });
const ME = 'u-me';
const sheep = (id, value, passives = ['Rare'], holderUid = ME) => ({ id, palId: 'SheepBall', gender: 'M', egg: false, place: 'palbox', passives, talent: talent(value), holderUid, holder: '仲間', placeLabel: 'パルボックス' });
// セーブのプレイヤー（自分は「仲間」と同じ名前のプレイヤー）
const PLAYERS = [{ uid: ME, name: '仲間' }, { uid: 'u-other', name: '他の人' }];
const GOAL = { name: 'モコロン理想', palId: 'SheepBall', passives: ['Rare'], mode: 'include', targets: talent(100), cake: 'none' };

function memoryStorage() {
  const map = new Map();
  return { map, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key) };
}

function fakeSubject(state) {
  const listeners = new Set();
  return { state, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, emit() { listeners.forEach((listener) => listener(state)); } };
}

function setup({ storage = memoryStorage(), pals = null, world = WORLD_A, at = time(0), prefix = 'id' } = {}) {
  const store = fakeSubject({ env: 'test', userId: '仲間', passcode: '入力', renaming: false, users: ['仲間', '他の人'] });
  const owned = fakeSubject({ owned: pals ? { players: PLAYERS, pals } : null, meta: pals ? { worldId: world, worldName: 'テスト', saveUpdatedAt: at } : null });
  let clock = Date.UTC(2026, 9, 8, 1, 0);
  let ids = 0;
  const ideals = createIdealStore({ store, owned, storage, now: () => clock, uuid: () => `${prefix}-${++ids}` });
  const show = (list, worldId = WORLD_A, saveUpdatedAt = time(0)) => {
    owned.state.owned = list ? { players: PLAYERS, pals: list } : null;
    owned.state.meta = list ? { worldId, worldName: worldId === WORLD_A ? 'テスト' : '別', saveUpdatedAt } : null;
    owned.emit();
  };
  const notices = () => idealNotificationSource({ store, ideals })().map(cleanNotification);
  return { store, owned, storage, ideals, show, notices, tick: (ms) => { clock += ms; } };
}

test('理想個体の登録: 追加・同じ条件の重複・ログイン前を見分け、この端末に ID・環境ごとに残す', () => {
  const { ideals, storage, store } = setup();
  assert.equal(ideals.add(GOAL), 'added');
  assert.equal(ideals.add({ ...GOAL, name: '別名', passives: ['Rare'] }), 'duplicate');
  assert.equal(ideals.add({ ...GOAL, mode: 'only' }), 'added');
  assert.deepEqual(ideals.list().map((goal) => [goal.id, goal.mode]), [['id-2', 'only'], ['id-1', 'include']]);
  assert.ok(ideals.has(GOAL));
  assert.equal(JSON.parse(storage.map.get(KEY)).length, 2);
  // 並べ方（order）は保存しない
  assert.ok(JSON.parse(storage.map.get(KEY)).every((goal) => !('order' in goal)));
  // 形が合わない・ログインしていないときは登録しない
  assert.equal(ideals.add({ ...GOAL, palId: 'bad id' }), null);
  store.state.passcode = '';
  assert.equal(ideals.add({ ...GOAL, cake: 'talent' }), null);
});

test('理想個体の登録: 前の版が保存した目標（並べ方 order つき）も読み、次に保存すると order が消える', () => {
  const storage = memoryStorage();
  const old = { id: 'old-1', name: '古い目標', palId: 'SheepBall', passives: ['Rare'], mode: 'include', targets: talent(100), cake: 'none', order: 'generations', addedAt: time(0), worlds: {} };
  storage.map.set(KEY, JSON.stringify([old]));
  const { ideals } = setup({ storage });
  assert.deepEqual(ideals.list().map((goal) => [goal.id, goal.name]), [['old-1', '古い目標']]);
  // 同じ完成の条件は、order が違っても同じ目標
  assert.equal(ideals.add(GOAL), 'duplicate');
  assert.equal(ideals.add({ ...GOAL, mode: 'only' }), 'added');
  const saved = JSON.parse(storage.map.get(KEY));
  assert.deepEqual(saved.map((goal) => goal.id), ['id-1', 'old-1']);
  assert.ok(saved.every((goal) => !('order' in goal)));
});

test('理想個体の登録: 登録した時点で完成していても知らせず、未完成から完成に変わったら知らせる', (t) => {
  const { ideals, show, notices, tick } = setup({ pals: [sheep('a', 100)] });
  ideals.add(GOAL);
  assert.equal(ideals.list()[0].worlds[WORLD_A].complete, true);
  assert.deepEqual(notices(), []);
  // 未完成になり（完成品を手放した）、また完成した
  show([sheep('a', 90)], WORLD_A, time(1));
  assert.equal(ideals.list()[0].worlds[WORLD_A].complete, false);
  tick(60 * 1000);
  show([sheep('b', 100)], WORLD_A, time(2));
  const [notice] = notices();
  assert.equal(notice.title, '理想個体が完成しました');
  assert.equal(notice.body, '「モコロン理想」の条件を満たす個体が「テスト」の所持パルにいます。');
  // 行き先は完成した個体のいる所持パル（目標の種族とパッシブ・タマゴ以外の全部の場所。id と本文は変えない。goals-detail）
  assert.equal(notice.href, '#/owned?pal=SheepBall&p=Rare&place=party%2Cpalbox%2Cbase%2Cdisplay%2Cdps%2Cglobal%2Cunknown');
  assert.match(notice.id, new RegExp(`^ideal:test:id-1:${WORLD_A}:`));
});

test('理想個体の登録: 登録の後、最初に読んだ新しいデータで完成していれば知らせる（登録時のデータで基準を取る）', () => {
  const { ideals, show, notices } = setup({ pals: [sheep('a', 90)] });
  ideals.add(GOAL);
  show([sheep('a', 90), sheep('b', 100)], WORLD_A, time(1));
  assert.equal(notices().length, 1);
});

test('理想個体の登録: データのないときに登録したら、そのワールドで最初に判定したときは知らせない', () => {
  const { ideals, show, notices } = setup();
  ideals.add(GOAL);
  assert.deepEqual(ideals.list()[0].worlds, {});
  show([sheep('a', 100)], WORLD_A, time(1));
  assert.equal(ideals.list()[0].worlds[WORLD_A].complete, true);
  assert.deepEqual(notices(), []);
  // 別のワールドに切り替えても、そのワールドで最初の判定なので知らせない
  show([sheep('b', 100)], WORLD_B, time(2));
  assert.deepEqual(notices(), []);
});

test('理想個体の登録: 同じか古いセーブのデータ（起動時の保存済みデータ・古いタブ）では判定を巻き戻さない', () => {
  const { ideals, show, notices, tick } = setup({ pals: [sheep('a', 90)] });
  ideals.add(GOAL);
  tick(1000);
  show([sheep('b', 100)], WORLD_A, time(5));
  const [notice] = notices();
  // 古いセーブのデータで「未完成」に戻さない（戻すと、新しいデータで重ねて知らせることになる）
  show([sheep('a', 90)], WORLD_A, time(3));
  show([sheep('a', 90)], WORLD_A, time(5));
  assert.equal(ideals.list()[0].worlds[WORLD_A].complete, true);
  assert.deepEqual(notices().map((item) => item.id), [notice.id]);
  // データがないとき（ワールドの切り替え中など）は、記録を消さない
  show(null);
  assert.equal(ideals.list()[0].worlds[WORLD_A].complete, true);
});

test('理想個体の登録: 名前の変更中は書き換えず、終わったら判定し直す', () => {
  const { ideals, store, show, notices } = setup({ pals: [sheep('a', 90)] });
  ideals.add(GOAL);
  store.state.renaming = true;
  assert.equal(ideals.add({ ...GOAL, mode: 'only' }), null);
  show([sheep('b', 100)], WORLD_A, time(1));
  assert.equal(ideals.list()[0].worlds[WORLD_A].complete, false);
  store.state.renaming = false;
  store.emit();
  assert.equal(ideals.list()[0].worlds[WORLD_A].complete, true);
  assert.equal(notices().length, 1);
});

test('理想個体の登録: 外したものは同じ ID・環境にだけ戻し、名前を変えた後や登録し直した後は戻さない', () => {
  const { ideals, store } = setup();
  ideals.add(GOAL);
  ideals.add({ ...GOAL, mode: 'only' });
  const key = ideals.scope();
  const removed = ideals.remove('id-1', key);
  assert.deepEqual(ideals.list().map((goal) => goal.id), ['id-2']);
  assert.equal(ideals.restore(removed.goal, removed.index, key), true);
  assert.deepEqual(ideals.list().map((goal) => goal.id), ['id-2', 'id-1']);
  // 同じ条件を登録し直した後は戻さない
  const again = ideals.remove('id-1', key);
  ideals.add(GOAL);
  assert.equal(ideals.restore(again.goal, again.index, key), false);
  // 名前を変えた後（保存先が変わった）は戻さない
  const other = ideals.remove('id-2', key);
  store.state.userId = '新しい名前';
  assert.equal(ideals.restore(other.goal, other.index, key), false);
});

test('理想個体の登録: 別のタブの保存を読み直し、保存できないときは知らせる', () => {
  const storage = memoryStorage();
  const first = setup({ storage });
  // 実際の ID は UUID なので、タブごとに重ならない
  const second = setup({ storage, prefix: 'other' });
  assert.equal(second.ideals.list().length, 0);
  first.ideals.add(GOAL);
  assert.equal(second.ideals.list().length, 0);
  second.ideals.reload(KEY);
  assert.equal(second.ideals.list().length, 1);
  // 書き換えは保存先の最新の内容に対して行う（別のタブの登録を消さない）
  second.ideals.add({ ...GOAL, mode: 'only' });
  first.ideals.reload(KEY);
  assert.equal(first.ideals.list().length, 2);
  const broken = setup({ storage: { getItem: () => null, setItem() { throw new Error('quota'); }, removeItem() {} } });
  broken.ideals.add(GOAL);
  assert.equal(broken.ideals.saveFailed, true);
  assert.equal(broken.ideals.list().length, 1);
});

test('理想個体の登録: 名前を変えたら、この端末の登録も新しい名前へ移す', () => {
  const storage = memoryStorage();
  storage.setItem('pal-note.ideals.test.古い名前', JSON.stringify([{ id: 'a', palId: 'SheepBall', name: '目標' }]));
  storage.setItem('pal-note.ideals.test.新しい名前', JSON.stringify([{ id: 'b', palId: 'PinkCat', name: '別' }]));
  assert.equal(moveUserStorage(storage, 'pal-note', 'test', '古い名前', '新しい名前'), true);
  assert.equal(storage.getItem('pal-note.ideals.test.古い名前'), null);
  assert.deepEqual(JSON.parse(storage.getItem('pal-note.ideals.test.新しい名前')).map((goal) => goal.id), ['a', 'b']);
});

test('理想個体の登録: 完成を見た時刻はセーブの時刻で、未完成に戻ったら通知が消え、また完成したら新しく知らせる', () => {
  const { ideals, show, notices } = setup({ pals: [sheep('a', 90)] });
  ideals.add(GOAL);
  show([sheep('b', 100)], WORLD_A, time(5));
  assert.equal(ideals.list()[0].worlds[WORLD_A].completedAt, time(5));
  const [first] = notices();
  show([sheep('a', 90)], WORLD_A, time(6));
  assert.deepEqual(notices(), []);
  show([sheep('c', 100)], WORLD_A, time(7));
  assert.deepEqual(notices().map((item) => item.id), [`ideal:test:id-1:${WORLD_A}:${time(7)}`]);
  assert.notEqual(notices()[0].id, first.id);
});

test('理想個体の登録: ワールド ID やセーブの時刻が分からないデータでは判定しない', () => {
  const { ideals, owned } = setup();
  ideals.add(GOAL);
  owned.state.owned = { players: PLAYERS, pals: [sheep('a', 100)] };
  owned.state.meta = { worldId: '', saveUpdatedAt: time(1) };
  owned.emit();
  owned.state.meta = { worldId: WORLD_A, saveUpdatedAt: '' };
  owned.emit();
  assert.deepEqual(ideals.list()[0].worlds, {});
});

test('理想個体の登録: 元に戻すときも登録の上限を超えない', () => {
  const { ideals } = setup();
  for (let i = 0; i < 100; i++) assert.equal(ideals.add({ ...GOAL, targets: { hp: i, shot: 100, defense: 100 } }), 'added');
  assert.equal(ideals.add({ ...GOAL, mode: 'only' }), 'full');
  const key = ideals.scope();
  const removed = ideals.remove(ideals.list()[0].id, key);
  assert.equal(ideals.add({ ...GOAL, mode: 'only' }), 'added');
  assert.equal(ideals.restore(removed.goal, removed.index, key), false);
  assert.equal(ideals.list().length, 100);
});

test('理想個体の登録: 完成の判定は自分の個体だけで、自分のプレイヤーが分からなければ判定しない', () => {
  const { ideals, show, notices, store } = setup({ pals: [sheep('a', 90)] });
  ideals.add(GOAL);
  // ほかのプレイヤーの完成品では知らせない
  show([sheep('a', 90), sheep('x', 100, ['Rare'], 'u-other')], WORLD_A, time(1));
  assert.equal(ideals.list()[0].worlds[WORLD_A].complete, false);
  assert.deepEqual(ideals.mine().map((pal) => pal.id), ['a']);
  // 自分の名前のプレイヤーがいなければ判定しない（記録はそのまま）
  store.state.users = ['別の名前'];
  show([sheep('b', 100)], WORLD_A, time(2));
  assert.equal(ideals.mine(), null);
  assert.equal(ideals.list()[0].worlds[WORLD_A].observedAt, time(1));
  store.state.users = ['仲間', '他の人'];
  show([sheep('b', 100)], WORLD_A, time(3));
  assert.equal(notices().length, 1);
});

test('理想個体の登録: selfUids は表示しているワールドの自分のプレイヤーの UID（所持パルの所持者の「（自分）」に使う）', () => {
  const { ideals, store, show } = setup();
  // 所持パルがなければ空
  assert.deepEqual([...ideals.selfUids()], []);
  show([sheep('a', 90)]);
  assert.deepEqual([...ideals.selfUids()], [ME]);
  // 自分のプレイヤーが分からなければ空（mine() は null）
  store.state.users = ['別の名前'];
  assert.deepEqual([...ideals.selfUids()], []);
  assert.equal(ideals.mine(), null);
});

// 「このワールドでの自分」（selfUid）を選べる形（app.js と同じく identity に selfUid を渡す）。chosen はワールド ID → UID
function setupSelf({ userId = '新人', pals = null, at = time(0), chosen = {}, storage = memoryStorage() } = {}) {
  const store = fakeSubject({ env: 'test', userId, passcode: '入力', renaming: false, users: ['仲間', '他の人', '新人'] });
  const owned = fakeSubject({ owned: pals ? { players: PLAYERS, pals } : null, meta: pals ? { worldId: WORLD_A, worldName: 'テスト', saveUpdatedAt: at } : null });
  let ids = 0;
  const ideals = createIdealStore({
    store, owned, storage, now: () => Date.UTC(2026, 9, 8, 1, 0), uuid: () => `id-${++ids}`,
    identity: (worldId) => ({ userId: store.state.userId, users: store.state.users, mapping: {}, selfUid: chosen[worldId] ?? '' }),
  });
  const show = (list, saveUpdatedAt) => {
    owned.state.owned = { players: PLAYERS, pals: list };
    owned.state.meta = { worldId: WORLD_A, worldName: 'テスト', saveUpdatedAt };
    owned.emit();
  };
  const notices = () => idealNotificationSource({ store, ideals })().map(cleanNotification);
  return { store, owned, ideals, show, notices, chosen };
}

test('理想個体の登録（このワールドでの自分）: 同じセーブの時刻で自分を選ぶと判定し直し、そのとき完成していたものは完成済みにして知らせない', () => {
  // 名前の違う人（新人）は自分のプレイヤーが分からず、判定しない
  const { ideals, notices, chosen } = setupSelf({ pals: [sheep('x', 100, ['Rare'], 'u-other')] });
  ideals.add(GOAL);
  ideals.add({ ...GOAL, name: '未完成の目標', mode: 'only', passives: ['Rare', 'Legend'] });
  assert.deepEqual(ideals.list().map((goal) => goal.worlds), [{}, {}]);
  let emitted = 0;
  ideals.subscribe(() => emitted++);
  chosen[WORLD_A] = 'u-other';
  assert.equal(ideals.identityChanged(), true);
  assert.equal(emitted, 1);
  const [unfinished, done] = ideals.list();
  assert.deepEqual(done.worlds[WORLD_A], { checked: true, complete: true, completedAt: '', observedAt: time(0), worldName: 'テスト' });
  assert.equal(unfinished.worlds[WORLD_A].complete, false);
  assert.deepEqual(notices(), []);
  assert.deepEqual(ideals.mine().map((pal) => pal.id), ['x']);
});

test('理想個体の登録（このワールドでの自分）: 前から完成して知らせていたものは、本人を変えても完成のままなら completedAt を残す', () => {
  const { ideals, show, notices, chosen } = setupSelf({ userId: '仲間', pals: [sheep('a', 90)] });
  ideals.add(GOAL);
  show([sheep('a', 90), sheep('b', 100), sheep('x', 100, ['Rare'], 'u-other')], time(1));
  const [notice] = notices();
  assert.equal(ideals.list()[0].worlds[WORLD_A].completedAt, time(1));
  // 自分を別のプレイヤー（完成品を持っている）にしても、通知は消えず重ならない
  chosen[WORLD_A] = 'u-other';
  ideals.identityChanged();
  assert.equal(ideals.list()[0].worlds[WORLD_A].completedAt, time(1));
  assert.deepEqual(notices().map((item) => item.id), [notice.id]);
  // 完成品を持たないプレイヤーにすると未完成になり、通知も消える
  show([sheep('a', 90), sheep('b', 100), sheep('y', 90, ['Rare'], 'u-other')], time(1));
  ideals.identityChanged();
  assert.equal(ideals.list()[0].worlds[WORLD_A].complete, false);
  assert.deepEqual(notices(), []);
});

test('理想個体の登録（このワールドでの自分）: 選んだ後に新しいセーブで新しく完成したものは知らせ、選んだ時点で完成していたものは後でも知らせない', () => {
  const { ideals, show, notices, chosen } = setupSelf({ pals: [sheep('x', 100, ['Rare'], 'u-other')] });
  ideals.add(GOAL);
  ideals.add({ ...GOAL, name: 'パッシブなし', passives: [], mode: 'only' });
  chosen[WORLD_A] = 'u-other';
  ideals.identityChanged();
  assert.deepEqual(notices(), []);
  // 次のセーブで、パッシブのない完成品を手に入れた
  show([sheep('x', 100, ['Rare'], 'u-other'), sheep('z', 100, [], 'u-other')], time(1));
  assert.deepEqual(notices().map((item) => item.body), ['「パッシブなし」の条件を満たす個体が「テスト」の所持パルにいます。']);
});

test('理想個体の登録（このワールドでの自分）: 自分が分からなくなったら記録を書き換えずに購読者だけ呼び、名前の変更中は書き換えない', () => {
  const { ideals, store, notices, chosen } = setupSelf({ pals: [sheep('x', 100, ['Rare'], 'u-other')] });
  ideals.add(GOAL);
  chosen[WORLD_A] = 'u-other';
  ideals.identityChanged();
  const before = JSON.stringify(ideals.list());
  let emitted = 0;
  ideals.subscribe(() => emitted++);
  // プレイヤーにいない UID（別のワールドの値）を選んでいる＝自分が分からない
  chosen[WORLD_A] = 'u-gone';
  assert.equal(ideals.identityChanged(), false);
  assert.equal(emitted, 1);
  assert.equal(JSON.stringify(ideals.list()), before);
  assert.equal(ideals.mine(), null);
  // 名前の変更中は書き換えない（終わった後の store の通知で判定し直される）
  chosen[WORLD_A] = 'u-me';
  store.state.renaming = true;
  assert.equal(ideals.identityChanged(), false);
  assert.equal(JSON.stringify(ideals.list()), before);
  assert.deepEqual(notices(), []);
});

test('理想個体の登録（このワールドでの自分）: identityKey は表示しているワールドと自分のプレイヤーの UID で、データがなければ空', () => {
  const { ideals, show, chosen } = setupSelf({ userId: '仲間' });
  assert.equal(ideals.identityKey(), '');
  show([sheep('a', 90)], time(0));
  assert.equal(ideals.identityKey(), `${WORLD_A}|u-me`);
  // 読み直し（同じ本人）では変わらない
  show([sheep('a', 95)], time(1));
  assert.equal(ideals.identityKey(), `${WORLD_A}|u-me`);
  chosen[WORLD_A] = 'u-other';
  assert.equal(ideals.identityKey(), `${WORLD_A}|u-other`);
});

test('理想個体の登録（このワールドでの自分）: 古いセーブのタブで判定し直しても、新しいセーブのタブが付けた判定は巻き戻さず、余計な完成の通知を出さない', () => {
  const storage = memoryStorage();
  const key = 'pal-note.ideals.test.新人';
  // 同じワールドを、タブ A は未完成の古いセーブ（0 分）、タブ B は完成品が入った新しいセーブ（5 分）で開いている。どちらも自分が分からない（新人）
  const chosen = {};
  const a = setupSelf({ storage, chosen, pals: [sheep('x', 90, ['Rare'], 'u-other')], at: time(0) });
  const b = setupSelf({ storage, chosen, pals: [sheep('x', 90, ['Rare'], 'u-other'), sheep('y', 100, ['Rare'], 'u-other')], at: time(5) });
  a.ideals.add(GOAL);
  assert.deepEqual(b.ideals.list()[0].worlds, {});
  // B で自分を選ぶ（自分のキーは両方のタブで同じ）。B は新しいセーブで判定し、そのとき完成していたものは知らせない
  chosen[WORLD_A] = 'u-other';
  assert.equal(b.ideals.identityChanged(), true);
  const judgedInB = storage.map.get(key);
  assert.deepEqual(JSON.parse(judgedInB)[0].worlds[WORLD_A], { checked: true, complete: true, completedAt: '', observedAt: time(5), worldName: 'テスト' });
  // A は自分のキーの storage イベントで判定し直そうとするが、B が新しいセーブで付けた判定は古いデータ（未完成）で書き換えない
  //（書き換える目標がなければ保存せず、購読者だけ呼ぶ）
  let emitted = 0;
  a.ideals.subscribe(() => emitted++);
  assert.equal(a.ideals.identityChanged(), false);
  assert.equal(emitted, 1);
  assert.equal(storage.map.get(key), judgedInB);
  a.ideals.reload(key);
  assert.equal(storage.map.get(key), judgedInB);
  assert.equal(a.ideals.list()[0].worlds[WORLD_A].complete, true);
  // B が読み直しても、巻き戻された判定がないので「未完成 → 完成」と知らせない
  b.ideals.reload(key);
  assert.equal(b.ideals.list()[0].worlds[WORLD_A].completedAt, '');
  assert.deepEqual(b.notices(), []);
  assert.deepEqual(a.notices(), []);
});

// ---- 目標の種族の配合の登録の観測（前のウィッシュリストの判定。goals-merge） ----
import { goalObservationSource } from '../../web/js/ideals.js';
import { speciesGoal } from '../../web/js/core/ideal-goals.js';

const sec = (second) => new Date(Date.UTC(2026, 9, 4, 0, 0, second)).toISOString();
const record = (childId, parent1Id = 'SheepBall', parent2Id = 'FlowerDoll') => ({ id: crypto.randomUUID(), parent1Id, parent2Id, childId });
function observing({ records = [], storage = memoryStorage() } = {}) {
  const store = fakeSubject({ env: 'test', userId: '仲間', passcode: '入力', renaming: false, users: ['仲間'], cached: false, serverTime: sec(1), confirmedRecords: records });
  const owned = fakeSubject({ owned: null, meta: null });
  let clock = Date.UTC(2026, 9, 4, 1, 0);
  let ids = 0;
  const ideals = createIdealStore({ store, owned, storage, now: () => clock, uuid: () => `obs-${++ids}` });
  const receive = (next, second, { cached = false } = {}) => {
    Object.assign(store.state, { confirmedRecords: next, serverTime: sec(second), cached });
    clock += 1000;
    store.emit();
  };
  const notices = () => goalObservationSource({ store, ideals })().map(cleanNotification);
  return { store, storage, ideals, receive, notices };
}
const OBS_KEY = 'pal-note.goalsObs.test.仲間';

test('目標の観測: 種族だけの目標を足した時点で作れても知らせず、作れるようになったら「配合が登録されました」（id は前のウィッシュリストと同じ形）', () => {
  const app = observing({ records: [record('MoonQueen')] });
  assert.equal(app.ideals.add(speciesGoal('MoonQueen', { name: 'セレムーン' })), 'added');
  assert.equal(app.ideals.add(speciesGoal('CatMage', { name: 'クレメーオ' })), 'added');
  // 観測は別のキー
  assert.deepEqual(Object.keys(JSON.parse(app.storage.getItem(OBS_KEY)).species).sort(), ['CatMage', 'MoonQueen']);
  assert.deepEqual(app.notices(), []);
  app.receive([record('MoonQueen'), record('CatMage', 'PinkCat', 'Alpaca')], 2);
  const [notice] = app.notices();
  assert.equal(notice.id, `wishlist:test:CatMage:${new Date(Date.UTC(2026, 9, 4, 1, 0, 1)).toISOString()}`);
  assert.equal(notice.title, 'クレメーオの配合が登録されました');
  assert.equal(notice.body, 'メルパカ＋ツッパニャン で作れます。');
  assert.equal(notice.href, '#/search?c=CatMage');
  // 作れる間に別の組が増えたら「配合が増えました」
  app.receive([record('MoonQueen'), record('CatMage', 'PinkCat', 'Alpaca'), record('CatMage', 'Boar', 'Deer')], 3);
  assert.deepEqual(app.notices().map((item) => item.title), ['クレメーオの配合が登録されました', 'クレメーオの配合が増えました']);
  assert.match(app.notices()[1].id, /^wishlist:test:CatMage:Boar\|Deer:/);
  assert.equal(app.ideals.observation('CatMage').pairs.length, 2);
});

test('目標の観測: 「配合が登録されました」の本文の組は今の確定データから作る（削除された組を指さない）', () => {
  const app = observing();
  app.ideals.add(speciesGoal('CatMage'));
  app.receive([record('CatMage', 'PinkCat', 'Alpaca')], 2);
  assert.equal(app.notices()[0].body, 'メルパカ＋ツッパニャン で作れます。');
  app.receive([record('CatMage', 'PinkCat', 'Alpaca'), record('CatMage', 'Boar', 'Deer')], 3);
  assert.match(app.notices()[0].body, /（ほか 1 組）。$/);
  // 最初の組が削除された: 観測の pairs には残るが、本文は今の組
  app.receive([record('CatMage', 'Boar', 'Deer')], 4);
  assert.equal(app.ideals.observation('CatMage').pairs.length, 2);
  const ready = app.notices().find((item) => item.title === 'クレメーオの配合が登録されました');
  assert.doesNotMatch(ready.body, /メルパカ|ツッパニャン|ほか/);
  assert.match(ready.body, /＋.+ で作れます。$/);
});

test('目標の観測: 通知は種族だけの目標がある種族だけ（パッシブつきの目標の種族は観測だけ）。最後の目標を外すと観測も消え、元に戻すと戻る', () => {
  const app = observing();
  app.ideals.add({ ...speciesGoal('CatMage'), passives: ['Rare'] });
  app.receive([record('CatMage')], 2);
  assert.equal(app.ideals.observation('CatMage').craftable, true);
  assert.deepEqual(app.notices(), []);
  const species = observing();
  species.ideals.add(speciesGoal('CatMage'));
  species.receive([record('CatMage')], 2);
  assert.equal(species.notices().length, 1);
  const [goal] = species.ideals.list();
  const removed = species.ideals.remove(goal.id, species.ideals.scope());
  assert.equal(species.ideals.observation('CatMage'), null);
  assert.deepEqual(species.notices(), []);
  assert.equal(species.ideals.restore(removed.goal, removed.index, species.ideals.scope(), removed.observation), true);
  assert.equal(species.notices().length, 1);
});

test('目標の観測: 起動時のキャッシュ・名前の変更中・古いデータでは進めず、別のタブで観測のキーが変わったら読み直す', () => {
  const app = observing();
  app.ideals.add(speciesGoal('CatMage'));
  app.receive([record('CatMage')], 5, { cached: true });
  assert.equal(app.ideals.observation('CatMage').craftable, false);
  app.store.state.renaming = true;
  app.receive([record('CatMage')], 6);
  assert.equal(app.ideals.observation('CatMage').craftable, false);
  app.store.state.renaming = false;
  app.receive([record('CatMage')], 7);
  assert.equal(app.ideals.observation('CatMage').craftable, true);
  // 古いデータ（時刻が前）では巻き戻さない
  app.receive([], 6);
  assert.equal(app.ideals.observation('CatMage').craftable, true);
  // 別のタブが観測のキーを書いた
  const other = JSON.parse(app.storage.getItem(OBS_KEY));
  other.species.CatMage.found = [{ pair: 'Boar|Deer', at: sec(9) }];
  app.storage.setItem(OBS_KEY, JSON.stringify(other));
  app.ideals.reload(OBS_KEY);
  assert.deepEqual(app.ideals.observation('CatMage').found, [{ pair: 'Boar|Deer', at: sec(9) }]);
});

test('目標の観測: ログインした環境・ID ごとに前のウィッシュリストを 1 回移し、旧キーが別のタブで書き戻されたらやり直す', () => {
  const storage = memoryStorage();
  storage.setItem('pal-note.wishlist.test.仲間', JSON.stringify([{ palId: 'CatMage', craftable: true, readyAt: sec(1), observedAt: sec(1), pairs: ['Alpaca|PinkCat'], found: [] }]));
  const app = observing({ storage });
  assert.deepEqual(app.ideals.list().map((goal) => goal.id), ['wish-CatMage']);
  assert.deepEqual(app.ideals.migration(), { status: 'done', migrated: 1, pending: 0 });
  // 移した観測の readyAt のまま、同じ id の通知（既読はそのまま引き継がれる）
  assert.equal(app.notices()[0].id, `wishlist:test:CatMage:${sec(1)}`);
  storage.setItem('pal-note.wishlist.test.仲間', JSON.stringify([{ palId: 'Alpaca' }]));
  app.ideals.reload('pal-note.wishlist.test.仲間');
  assert.deepEqual(app.ideals.list().map((goal) => goal.palId), ['CatMage', 'Alpaca']);
});

test('目標の観測: 上限で移せなかった前のウィッシュリストは、目標を外して空いたら移す（partial のまま残さない）', async () => {
  const storage = memoryStorage();
  const goals = Array.from({ length: 100 }, (_, index) => ({ ...speciesGoal('SheepBall'), id: `g${index}`, passives: [`P${index}`] }));
  storage.setItem('pal-note.ideals.test.仲間', JSON.stringify(goals));
  storage.setItem('pal-note.wishlist.test.仲間', JSON.stringify([{ palId: 'CatMage' }]));
  const app = observing({ storage });
  assert.equal(app.ideals.migration().status, 'partial');
  assert.ok(app.ideals.remove('g0', app.ideals.scope()));
  await Promise.resolve();
  assert.equal(app.ideals.migration().status, 'done');
  assert.deepEqual(app.ideals.list().filter((goal) => goal.palId === 'CatMage').map((goal) => goal.id), ['wish-CatMage']);
});

test('理想個体（settings）: importGoals は重複・上限を除いて今の目標の後ろに足し、ワールドの完成は持ち込まず、観測は足した種族だけ併せる', () => {
  const { ideals, storage } = setup();
  assert.equal(ideals.add(GOAL), 'added');
  const imported = [
    { ...GOAL, id: 'other', name: '同じ条件' },
    { name: 'ツッパニャン', palId: 'PinkCat', passives: [], mode: 'include', targets: talent(0), cake: 'none', id: 'pink', addedAt: '2026-10-01T00:00:00.000Z',
      worlds: { [WORLD_A]: { complete: true, completedAt: '2026-10-02T00:00:00.000Z' } } },
  ];
  const observations = { version: 1, species: { PinkCat: { craftable: true, readyAt: '2026-10-03T00:00:00.000Z', observedAt: '2026-10-03T00:00:00.000Z', pairs: ['A|B'], found: [] } } };
  const result = ideals.importGoals(imported, observations);
  assert.deepEqual(result, { added: 1, skipped: 1, saved: true });
  assert.deepEqual(ideals.list().map((goal) => goal.id), ['id-1', 'pink']);
  // ワールドごとの完成は持ち込まない（新しい端末で古い完成を知らせない）
  assert.deepEqual(ideals.list()[1].worlds, {});
  assert.deepEqual(ideals.observation('PinkCat').pairs, ['A|B']);
  assert.ok(JSON.parse(storage.getItem('pal-note.goalsObs.test.仲間')).species.PinkCat);
  // 同じものをもう一度は足さない
  assert.deepEqual(ideals.importGoals(imported, observations), { added: 0, skipped: 2, saved: true });
});
