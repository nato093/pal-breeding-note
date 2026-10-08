import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIdealStore, idealNotificationSource } from '../../web/js/ideals.js';
import { cleanNotification } from '../../web/js/notifications.js';
import { moveUserStorage } from '../../web/js/user-rename.js';

const WORLD_A = '4A431AC14B58A7E31A76B2A991F79FE8';
const WORLD_B = '88DC480846CA4D73A670DA90D96950DC';
const KEY = 'pal-note.ideals.test.仲間';
const time = (minute) => new Date(Date.UTC(2026, 9, 8, 0, minute)).toISOString();
const talent = (v) => ({ hp: v, shot: v, defense: v });
const ME = 'u-me';
const sheep = (id, value, passives = ['Rare'], holderUid = ME) => ({ id, palId: 'SheepBall', gender: 'M', egg: false, place: 'palbox', passives, talent: talent(value), holderUid, holder: '仲間', placeLabel: 'パルボックス' });
// セーブのプレイヤー（自分は「仲間」と同じ名前のプレイヤー）
const PLAYERS = [{ uid: ME, name: '仲間' }, { uid: 'u-other', name: '他の人' }];
const GOAL = { name: 'モコロン理想', palId: 'SheepBall', passives: ['Rare'], mode: 'include', targets: talent(100), cake: 'none', order: 'next' };

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
  // 形が合わない・ログインしていないときは登録しない
  assert.equal(ideals.add({ ...GOAL, palId: 'bad id' }), null);
  store.state.passcode = '';
  assert.equal(ideals.add({ ...GOAL, order: 'generations' }), null);
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
  assert.equal(notice.href, `#/ideal?to=SheepBall&p=Rare&g=id-1`);
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
