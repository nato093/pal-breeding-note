// save-extras の画面: 所持パルの NEW と入手の新しい順・プレイ中と Day と Lv（ヘッダーのセーブ連携・所持者の選択肢）・病気と空腹の印・
// 牧場のケーキ・個体の詳細の魂の強化と状態・NEW の基準の保存（web/js/owned-seen.js）と名前の変更での移し替え
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, descendants } from '../helpers/dom.js';
import pals from '../../web/data/pals.js';
import passives from '../../web/data/passives.js';
import { buildIndex } from '../../web/js/core/index.js';
import { buildCarrierGraph } from '../../web/js/core/route.js';
import { normalizeOwned, ownedFromShared, sharedUpload } from '../../web/js/core/owned.js';
import { parseHash } from '../../web/js/router.js';
import { ownedView, ownedRowItem, rowSignature } from '../../web/js/views/owned.js';
import { ownedDetail } from '../../web/js/views/owned-detail.js';
import { holderChoices } from '../../web/js/views/shared.js';
import { farmBoard, cakeLine } from '../../web/js/ui/farm-board.js';
import { presenceOf, presenceItems, onlineUids } from '../../web/js/ui/owned-status.js';
import { saveStatusModel, saveStatus } from '../../web/js/ui/save-status.js';
import { createOwnedSeen, cleanOwnedSeen, mergeOwnedSeen, seenTime, OWNED_SEEN_WORLDS_MAX } from '../../web/js/owned-seen.js';
import { moveUserStorage } from '../../web/js/user-rename.js';

const P1 = '00000000-0000-0000-0000-000000000001';
const P2 = '00000000-0000-0000-0000-000000000002';
const WORLD = 'ABCDEF0123456789ABCDEF0123456789';
const NOW = Date.parse('2026-10-15T13:00:00.000Z');
const minutesAgo = (minutes) => new Date(NOW - minutes * 60000).toISOString();
const hasClass = (node, name) => String(node.className ?? '').split(' ').includes(name);
const byClass = (root, name) => descendants(root).filter((node) => hasClass(node, name));

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

const individual = (instanceId, characterId, extra = {}) => ({
  instanceId, characterId, gender: 'Female', level: 20, rank: 1, passives: [], talent: { hp: 10, shot: 20, defense: 30 },
  location: { kind: 'palbox', playerUid: P1, slotIndex: 0 }, ...extra,
});

function snapshot({ pals: list, saveAt = minutesAgo(2), players, farms } = {}) {
  return {
    version: 1, world: { name: 'World9', hostName: 'Alice', inGameDay: 624 },
    players: players ?? [{ uid: P1, name: 'Alice', level: 52, online: true }, { uid: P2, name: 'Bob', level: 47, online: false }],
    bases: [{ id: 'B1', number: 1, guildId: 'G', containerId: '', position: null }], stats: {}, saveAt,
    pals: list ?? [
      individual('old', 'SheepBall', { ownedAt: '2026-10-14T10:00:00.000Z' }),
      individual('new1', 'Anubis', { ownedAt: '2026-10-15T12:55:00.000Z' }),
      individual('none', 'PinkCat'),
    ],
    ...(farms ? { breedFarms: farms } : {}),
  };
}

function fakeOwned(snap = snapshot(), { source = 'local' } = {}) {
  const listeners = new Set();
  const state = {
    ready: true, busy: false, progress: '', error: '', role: source === 'local' ? 'host' : '', linkedWorldId: '',
    auto: { enabled: false, status: 'off', worlds: [], worldId: '', error: '' },
    shared: { worlds: [], current: null, fetchedAt: '', error: '' }, upload: { status: '', at: '', error: '', worldId: '' },
    data: null, owned: normalizeOwned(snap, { pals, passives }),
    meta: { worldId: WORLD, worldName: 'World9', hostName: 'Alice', source, saveUpdatedAt: snap.saveAt, importedAt: snap.saveAt, sharedAt: source === 'shared' ? snap.saveAt : '', uploadedBy: 'Alice', palCount: 3 },
  };
  return {
    state,
    load: () => Promise.resolve(),
    autoRefresh: () => Promise.resolve('skipped'),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    emit() { listeners.forEach((listener) => listener(state)); },
    replace(snap2) {
      state.owned = normalizeOwned(snap2, { pals, passives });
      state.meta = { ...state.meta, saveUpdatedAt: snap2.saveAt, importedAt: snap2.saveAt };
      this.emit();
    },
  };
}

function context(owned, { storage = memoryStorage(), userId = 'Dave' } = {}) {
  const index = buildIndex([], pals);
  const state = { records: [], index, graph: buildCarrierGraph(index), env: 'test', warnings: [], userId };
  return {
    store: { state, subscribe: () => () => {} }, owned, navigate: () => {}, inputDelay: 0,
    ownedSeen: createOwnedSeen({ storage, namespace: 'ns' }), storage,
  };
}
const rowsOf = (view) => view.element.querySelectorAll('.owned-row');
const newIds = (view) => rowsOf(view).filter((row) => hasClass(row, 'is-new')).map((row) => row.getAttribute('data-instance'));

test('NEW の基準: ワールドごとの時刻を環境・ID ごとの別のキーに持ち、古い時刻では戻さない。形の合わない値・ログイン前・読み書きできない端末では使わない', () => {
  const storage = memoryStorage({ 'ns.owned.seenAt.test.dave': JSON.stringify({ [WORLD]: '2026-10-15T10:00:00.000Z', bad: '2026-10-15T10:00:00.000Z', ['F'.repeat(32)]: 'きのう' }) });
  const seen = createOwnedSeen({ storage, namespace: 'ns' });
  assert.equal(seen.read('test', 'ＤＡＶＥ', WORLD), '2026-10-15T10:00:00.000Z');
  assert.equal(seen.read('test', 'Dave', 'F'.repeat(32)), null);
  assert.equal(seen.read('', 'Dave', WORLD), null);
  assert.equal(seen.read('test', 'Dave', 'not-a-world'), null);
  seen.write('test', 'Dave', WORLD, '2026-10-15T09:00:00.000Z');
  assert.equal(seen.read('test', 'Dave', WORLD), '2026-10-15T10:00:00.000Z');
  // ミリ秒のない ISO もそろえて書く
  seen.write('test', 'Dave', WORLD, '2026-10-15T11:00:00Z');
  assert.equal(seen.read('test', 'Dave', WORLD), '2026-10-15T11:00:00.000Z');
  assert.deepEqual(Object.keys(JSON.parse(storage.getItem('ns.owned.seenAt.test.dave'))), [WORLD]);
  seen.write('test', 'Dave', WORLD, 'あした');
  assert.equal(seen.read('test', 'Dave', WORLD), '2026-10-15T11:00:00.000Z');
  // ワールドは時刻の新しい順に 50 件まで
  const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [i.toString(16).toUpperCase().padStart(32, '0'), new Date(Date.UTC(2026, 0, 1 + i)).toISOString()]));
  const kept = cleanOwnedSeen(many);
  assert.equal(Object.keys(kept).length, OWNED_SEEN_WORLDS_MAX);
  assert.equal(kept['0'.repeat(32)], undefined);
  assert.deepEqual([seenTime('x'), cleanOwnedSeen('x'), cleanOwnedSeen(null)], ['', {}, {}]);
  // 同じワールドは新しい方（NEW を少なく出す方）
  assert.deepEqual(mergeOwnedSeen({ [WORLD]: '2026-10-15T09:00:00.000Z' }, { [WORLD]: '2026-10-15T10:00:00.000Z' }), { [WORLD]: '2026-10-15T10:00:00.000Z' });
  const broken = () => { throw new Error('使えない'); };
  const none = createOwnedSeen({ storage: { getItem: broken, setItem: broken } });
  assert.equal(none.read('test', 'Dave', WORLD), null);
  assert.doesNotThrow(() => none.write('test', 'Dave', WORLD, '2026-10-15T10:00:00.000Z'));
});

test('NEW の基準: 名前の変更で新しい名前へ移し、移し先にあれば同じワールドは新しい方を残す（別の環境の分は移さない）', () => {
  const storage = memoryStorage();
  const A = 'A'.repeat(32);
  storage.setItem('pal-note.owned.seenAt.prod.taro', JSON.stringify({ [WORLD]: '2026-10-15T10:00:00.000Z', [A]: '2026-10-01T00:00:00.000Z' }));
  storage.setItem('pal-note.owned.seenAt.prod.jiro', JSON.stringify({ [A]: '2026-10-05T00:00:00.000Z' }));
  storage.setItem('pal-note.owned.seenAt.test.taro', JSON.stringify({ [WORLD]: '2026-10-01T00:00:00.000Z' }));
  assert.equal(moveUserStorage(storage, 'pal-note', 'prod', 'Taro', 'Jiro'), true);
  assert.deepEqual(JSON.parse(storage.getItem('pal-note.owned.seenAt.prod.jiro')), { [WORLD]: '2026-10-15T10:00:00.000Z', [A]: '2026-10-05T00:00:00.000Z' });
  assert.equal(storage.getItem('pal-note.owned.seenAt.prod.taro'), null);
  assert.notEqual(storage.getItem('pal-note.owned.seenAt.test.taro'), null);
});

test('所持パルの NEW: 初めて開いたときは付けずに見ていたデータの時刻を保存し、次に開くとそれより後に入手した個体だけに付く（タマゴ・入手時刻のない個体には付かない）', (t) => {
  installDom(t);
  const storage = memoryStorage();
  const owned = fakeOwned();
  const first = ownedView(context(owned, { storage }), parseHash('#/owned'));
  assert.deepEqual(newIds(first), []);
  assert.deepEqual(JSON.parse(storage.getItem('ns.owned.seenAt.test.dave')), { [WORLD]: minutesAgo(2) });
  // 開いている間に読み直して届いた新しい個体にも、この画面の間は付かない（基準は開いたときのもの＝初回は付けない）
  owned.replace(snapshot({ saveAt: minutesAgo(1), pals: [...snapshot().pals, individual('new2', 'PinkCat', { ownedAt: minutesAgo(1.5) })] }));
  assert.deepEqual(newIds(first), []);
  first.destroy();
  // 閉じたときに見ていたデータ（1 分前の保存）の時刻を保存した
  assert.deepEqual(JSON.parse(storage.getItem('ns.owned.seenAt.test.dave')), { [WORLD]: minutesAgo(1) });

  // 2 回目: 1 分前より後に入手した個体だけ（タマゴ・入手時刻のない個体は付かない）
  const next = snapshot({
    saveAt: minutesAgo(0.2),
    pals: [...snapshot().pals, individual('new2', 'PinkCat', { ownedAt: minutesAgo(1.5) }), individual('new3', 'Anubis', { ownedAt: minutesAgo(0.5) }),
      individual('egg', 'SheepBall', { location: { kind: 'egg-ground', playerUid: P1 } })],
  });
  const second = ownedView(context(fakeOwned(next), { storage }), parseHash('#/owned'));
  assert.deepEqual(newIds(second), ['new3']);
  const row = rowsOf(second).find((node) => node.getAttribute('data-instance') === 'new3');
  assert.equal(row.getAttribute('aria-label'), 'アヌビス（新しく入手）');
  // 要素は足さない（CSS の ::before）
  const plain = ownedRowItem(normalizeOwned(next, { pals, passives }).pals.find((pal) => pal.id === 'new3'), {});
  assert.equal(descendants(row).length, descendants(plain.element).length);
  // ログインしていない（環境・ID がない）なら付けず、保存もしない
  const anonymous = context(fakeOwned(next), { storage: memoryStorage(), userId: '' });
  const third = ownedView(anonymous, parseHash('#/owned'));
  assert.deepEqual([newIds(third), anonymous.storage.values.size], [[], 0]);
  second.destroy();
  third.destroy();
});

test('所持パルの NEW: タブが裏に回ったら見ていたデータの時刻を保存する（この画面の NEW はそのまま）。行の署名に NEW を含める', async (t) => {
  const { events } = installDom(t);
  const storage = memoryStorage({ 'ns.owned.seenAt.test.dave': JSON.stringify({ [WORLD]: '2026-10-15T12:00:00.000Z' }) });
  const owned = fakeOwned();
  const view = ownedView(context(owned, { storage }), parseHash('#/owned'));
  assert.deepEqual(newIds(view), ['new1']);
  owned.replace(snapshot({ saveAt: minutesAgo(0.5) }));
  // 見えている間は保存しない
  await events.dispatch('visibilitychange');
  assert.deepEqual(JSON.parse(storage.getItem('ns.owned.seenAt.test.dave')), { [WORLD]: '2026-10-15T12:00:00.000Z' });
  globalThis.document.visibilityState = 'hidden';
  await events.dispatch('visibilitychange');
  assert.deepEqual(JSON.parse(storage.getItem('ns.owned.seenAt.test.dave')), { [WORLD]: minutesAgo(0.5) });
  // この画面の NEW は開いたときの基準のまま
  assert.deepEqual(newIds(view), ['new1']);
  view.destroy();
  const pal = normalizeOwned(snapshot(), { pals, passives }).pals[0];
  assert.notEqual(rowSignature(pal, [], [], true), rowSignature(pal, [], []));
});

// 環境・ログインの ID の変化（store の知らせ）を拾う context（フェーズ 4 の終わりのレビュー）
function liveContext(owned, { storage, env = 'test', userId = 'Dave' }) {
  const app = context(owned, { storage, userId });
  const listeners = new Set();
  app.store.state.env = env;
  app.store.subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  app.store.emit = () => listeners.forEach((fn) => fn(app.store.state));
  return app;
}

test('所持パルの NEW: 所持パルのデータが環境より先に届いても（配合のキャッシュがない端末）、環境が分かったら基準を読んで NEW を付け、閉じたら保存する', (t) => {
  installDom(t);
  const storage = memoryStorage({ 'ns.owned.seenAt.test.dave': JSON.stringify({ [WORLD]: '2026-10-15T12:00:00.000Z' }) });
  // 起動の直後: ログインはしているが、環境は配合の取得が終わるまで null
  const app = liveContext(fakeOwned(), { storage, env: null });
  const view = ownedView(app, parseHash('#/owned'));
  assert.deepEqual(newIds(view), []);
  // 取得が終わって環境が分かる
  app.store.state.env = 'test';
  app.store.emit();
  assert.deepEqual(newIds(view), ['new1']);
  view.destroy();
  assert.deepEqual(JSON.parse(storage.getItem('ns.owned.seenAt.test.dave')), { [WORLD]: minutesAgo(2) });
});

test('所持パルの NEW: 開いたまま名前を変えると、前の名前のキーには書き戻さず（移したキーを戻さない）、新しい名前のキーで続ける', (t) => {
  installDom(t);
  const storage = memoryStorage({ 'ns.owned.seenAt.test.dave': JSON.stringify({ [WORLD]: '2026-10-15T12:00:00.000Z' }) });
  const owned = fakeOwned();
  const app = liveContext(owned, { storage });
  const view = ownedView(app, parseHash('#/owned'));
  assert.deepEqual(newIds(view), ['new1']);
  // 名前の変更（user-rename.js が端末の値を移し、ログイン中の ID が替わる。画面は作り直さない）。知らせより先にデータが届くこともある
  moveUserStorage(storage, 'ns', 'test', 'Dave', 'Eve');
  app.store.state.userId = 'Eve';
  owned.replace(snapshot({ saveAt: minutesAgo(1) }));
  assert.equal(storage.values.has('ns.owned.seenAt.test.dave'), false, '前の名前のキーが書き戻された');
  app.store.emit();
  assert.deepEqual(newIds(view), ['new1']);
  view.destroy();
  assert.deepEqual([...storage.values.keys()], ['ns.owned.seenAt.test.eve']);
  assert.deepEqual(JSON.parse(storage.getItem('ns.owned.seenAt.test.eve')), { [WORLD]: minutesAgo(1) });
  // 知らせもデータも来ないまま閉じても、前の名前のキーには書かない
  const storage2 = memoryStorage({ 'ns.owned.seenAt.test.dave': JSON.stringify({ [WORLD]: '2026-10-15T12:00:00.000Z' }) });
  const app2 = liveContext(fakeOwned(), { storage: storage2 });
  const view2 = ownedView(app2, parseHash('#/owned'));
  moveUserStorage(storage2, 'ns', 'test', 'Dave', 'Eve');
  app2.store.state.userId = 'Eve';
  view2.destroy();
  assert.deepEqual([...storage2.values.keys()], ['ns.owned.seenAt.test.eve']);
});

test('入手の新しい順: 並べ替えに「入手の新しい順」があり、入手時刻のない個体は最後', (t) => {
  installDom(t);
  const owned = fakeOwned();
  const view = ownedView(context(owned), parseHash('#/owned?sort=ownedAt'));
  const sort = view.element.querySelector('.owned-sort');
  assert.equal(sort.value, 'ownedAt');
  assert.deepEqual(rowsOf(view).map((row) => row.getAttribute('data-instance')), ['new1', 'old', 'none']);
  // 図鑑順でないので、種族の見出しは混ぜない
  assert.equal(view.element.querySelectorAll('.owned-species').length, 0);
  view.destroy();
});

test('プレイ中・Day・Lv: ヘッダーのセーブ連携のパネルに、セーブの時刻つきのプレイ中・ゲーム内の日数・Lv。分からない古いデータでは出さない', (t) => {
  installDom(t);
  const owned = fakeOwned();
  const now = () => NOW;
  const items = presenceItems(owned.state, { now });
  assert.deepEqual(items.map(([term]) => term), ['ゲーム内', 'プレイ中', 'Lv']);
  assert.equal(items[0][1], '624 日目');
  assert.match(items[1][1], /^Alice（セーブ \d{2}:\d{2} の時点）$/);
  assert.equal(items[2][1], 'Alice 52 · Bob 47');
  // 押す前の説明（title）にも出す
  assert.match(saveStatusModel(owned.state, { now: NOW }).title, /ゲーム内: 624 日目\nプレイ中: Alice（セーブ/);
  // パネルを開くと行がある
  const status = saveStatus({ owned, now });
  status.element.querySelector('.save-status-button').dispatch('click');
  const panel = status.element.querySelector('.save-status-details') ?? globalThis.document.body.querySelector('.save-status-details');
  assert.ok(panel, 'パネル');
  assert.match(panel.textContent, /ゲーム内624 日目/);
  assert.match(panel.textContent, /プレイ中Alice（セーブ/);
  status.destroy();
  // 参加者（共有）も、プレイ中はホストのセーブの時点の状態なので、共有した時刻ではなくホストのセーブの時刻を添える（Codex のレビュー）
  const guest = fakeOwned(snapshot({ saveAt: minutesAgo(30) }), { source: 'shared' });
  guest.state.meta.sharedAt = minutesAgo(1);
  const saved = new Date(NOW - 30 * 60000);
  const hhmm = `${String(saved.getHours()).padStart(2, '0')}:${String(saved.getMinutes()).padStart(2, '0')}`;
  assert.equal(presenceItems(guest.state, { now })[1][1], `Alice（ホストのセーブ ${hhmm} の時点）`);
  // だれもプレイしていない・プレイ中が分からない（古い共有・古いスナップショット）
  assert.match(presenceItems(fakeOwned(snapshot({ players: [{ uid: P1, name: 'Alice', level: 52, online: false }] })).state, { now })[1][1], /^いません（セーブ/);
  const unknown = fakeOwned({ ...snapshot({ players: [{ uid: P1, name: 'Alice', level: 0 }] }), world: { name: 'World9' } });
  assert.deepEqual(presenceItems(unknown.state, { now }), []);
  assert.equal(presenceOf({ owned: null, meta: null }), null);
});

test('プレイ中: 所持者の選択肢の「（プレイ中）」は保存が新しいときだけ（この PC は 5 分・共有は 10 分。ゲームを閉じた後の最後の保存には残るため）', (t) => {
  installDom(t);
  const now = () => NOW;
  const fresh = fakeOwned();
  assert.deepEqual([...onlineUids(fresh.state, { now })], [P1]);
  assert.deepEqual(holderChoices(fresh.state.owned, null, { online: onlineUids(fresh.state, { now }) }).map(([, label]) => label), ['すべて', 'Alice（プレイ中）', 'Bob']);
  // 自分には付けない（理想個体のパネルの狭い選択欄で「（自分）」が切れないように）
  const ideals = { selfUids: () => new Set([P1]) };
  assert.deepEqual(holderChoices(fresh.state.owned, ideals, { online: new Set([P1, P2]) }).map(([, label]) => label), ['すべて', 'Alice（自分）', 'Bob（プレイ中）']);
  const stale = fakeOwned(snapshot({ saveAt: minutesAgo(6) }));
  assert.deepEqual([...onlineUids(stale.state, { now })], []);
  const shared = fakeOwned(snapshot({ saveAt: minutesAgo(9) }), { source: 'shared' });
  assert.deepEqual([...onlineUids(shared.state, { now })], [P1]);
  // 所持パルの画面の選択肢（今の時刻で決まる）
  const live = fakeOwned(snapshot({ saveAt: new Date().toISOString() }));
  const view = ownedView(context(live), parseHash('#/owned'));
  const labels = () => view.element.querySelector('[aria-label="所持者"]').querySelectorAll('option').map((node) => node.textContent);
  assert.ok(labels().includes('Alice（プレイ中）'), labels().join(','));
  // データが同じまま時間がたって保存が古くなったら（ゲームを閉じた）、次の知らせで「（プレイ中）」を外す（Codex のレビュー）
  live.state.meta = { ...live.state.meta, saveUpdatedAt: new Date(Date.now() - 6 * 60000).toISOString() };
  live.emit();
  assert.ok(labels().includes('Alice') && !labels().includes('Alice（プレイ中）'), labels().join(','));
  view.destroy();
});

test('病気・空腹の印: 拠点・手持ちの行の名前の下に「病気」「空腹」（ある個体だけ）。パルボックスの個体には出さない', (t) => {
  installDom(t);
  const data = normalizeOwned(snapshot({ pals: [
    individual('s', 'Anubis', { location: { kind: 'base', playerUid: '', baseId: 'B1' }, condition: { sick: 'Cold', hunger: 'Starvation', sanity: 70 } }),
    individual('p', 'Anubis', { location: { kind: 'party', playerUid: P1 }, condition: { sick: '', hunger: 'Starvation', sanity: 100 } }),
    individual('b', 'Anubis', { condition: { sick: 'Cold', hunger: '', sanity: 100 } }),
    individual('n', 'Anubis', { location: { kind: 'party', playerUid: P1 }, condition: { sick: '', hunger: '', sanity: 100 } }),
  ] }), { pals, passives });
  const badges = (pal) => byClass(ownedRowItem(pal, {}).element, 'owned-badge').map((node) => node.textContent);
  assert.deepEqual(data.pals.map(badges), [['病気', '空腹'], ['空腹'], [], []]);
});

test('牧場のケーキ: 牧場ボードのカードに種類ごとの数（ゲームのアイコン）、空なら「ケーキ切れ」、分からない（共有）なら出さない', (t) => {
  installDom(t);
  const farms = [
    { id: 'FA', baseId: 'B1', status: 'ok', parents: [], eggs: [], cakes: [{ itemId: 'Cake02', count: 51 }, { itemId: 'Cake03', count: 18 }] },
    { id: 'FB', baseId: 'B1', status: 'ok', parents: [], eggs: [], cakes: [] },
    { id: 'FC', baseId: 'B1', status: 'ok', parents: [], eggs: [] },
  ];
  const data = normalizeOwned(snapshot({ farms }), { pals, passives });
  const board = farmBoard({ owned: { state: { owned: data }, subscribe: () => () => {} }, store: { state: { index: buildIndex([], pals) }, subscribe: () => () => {} } });
  const cards = board.element.querySelectorAll('.farm-card');
  const cakeText = (card) => card.querySelector('.farm-cakes')?.textContent ?? null;
  assert.deepEqual(cards.map(cakeText), ['キノコケーキ ×51野菜ケーキ ×18', 'ケーキ切れ', null]);
  assert.deepEqual(byClass(cards[0], 'cake-icon').map((node) => String(node.src).split('/').slice(-2).join('/')), ['item/cake-Cake02.png', 'item/cake-Cake03.png']);
  assert.ok(hasClass(cards[1].querySelector('.farm-cake-out'), 'is-warning'));
  // 共有のデータ（ケーキは共有しない）では出さない
  const shared = ownedFromShared({ world: { worldName: 'World9', farms: sharedUpload(data).farms }, ...sharedUpload(data) }, { pals, passives });
  assert.deepEqual(shared.farms.map((farm) => farm.cakes), [null, null, null]);
  assert.equal(cakeLine(null), null);
  assert.equal(cakeLine([{ itemId: 'Cake09', count: 2 }]).textContent, 'Cake09 ×2');
  board.destroy();
});

test('個体の詳細: 魂の強化（0 でないものだけ）・病気と空腹の種類・SAN と入手の日時。共有・古いデータ（null）とタマゴでは魂の強化と状態の節を出さない', (t) => {
  installDom(t);
  const data = snapshot({ pals: [
    individual('a', 'Anubis', { ownedAt: '2026-10-15T12:52:16.570Z', soul: { hp: 10, attack: 0, defense: 0, craft: 20 }, condition: { sick: 'Cold', hunger: '', sanity: 82.5 } }),
    individual('z', 'Anubis', { soul: { hp: 0, attack: 0, defense: 0, craft: 0 }, condition: { sick: '', hunger: '', sanity: 100 } }),
    individual('o', 'Anubis'),
  ] });
  const owned = { state: { ready: true, owned: normalizeOwned(data, { pals, passives }) }, subscribe: () => () => {} };
  const detail = (id) => ownedDetail({ owned }, id);
  const a = detail('a').element;
  const section = byClass(a, 'is-condition')[0];
  assert.equal(section.querySelector('h3').textContent, '魂の強化と状態');
  assert.deepEqual(section.querySelectorAll('dt').map((node) => node.textContent), ['魂の強化', '状態', 'SAN']);
  // 見える文は「病気」「空腹」だけ。種類（ゲームの内部名）は title に（本文に英語の内部名を出さない。フェーズ 4 の終わりのレビュー）
  assert.deepEqual(section.querySelectorAll('dd').map((node) => node.textContent), ['HP +10 · 作業速度 +20', '病気', '83']);
  assert.equal(section.querySelectorAll('dd')[1].title, '種類（ゲームの内部名）\n病気: Cold');
  const both = normalizeOwned(snapshot({ pals: [individual('b', 'Anubis', { condition: { sick: 'Sprain', hunger: 'Starvation', sanity: 12 } })] }), { pals, passives });
  const bothDetail = ownedDetail({ owned: { state: { ready: true, owned: both }, subscribe: () => () => {} } }, 'b');
  const state = byClass(bothDetail.element, 'is-condition')[0].querySelectorAll('dd')[0];
  assert.deepEqual([state.textContent, state.title], ['病気 · 空腹', '種類（ゲームの内部名）\n病気: Sprain\n空腹: Starvation']);
  bothDetail.destroy?.();
  assert.ok(byClass(a, 'badge-sick').length);
  const date = new Date('2026-10-15T12:52:16.570Z');
  const pad = (n) => String(n).padStart(2, '0');
  assert.equal(byClass(a, 'owned-detail-acquired')[0].textContent, `入手 ${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`);
  assert.deepEqual(byClass(detail('z').element, 'is-condition')[0].querySelectorAll('dd').map((node) => node.textContent), ['なし', '病気・空腹なし', '100']);
  // 古いスナップショット（魂の強化と状態がない）・入手時刻がない
  assert.deepEqual([byClass(detail('o').element, 'is-condition').length, byClass(detail('o').element, 'owned-detail-acquired').length], [0, 0]);
});
