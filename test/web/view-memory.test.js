import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createViewMemory, restoreScroll, ENTRIES_MAX, MEMORY_VERSION } from '../../web/js/ui/view-memory.js';
import { safeStorage } from '../../web/js/store.js';
import { oneOf, text } from '../../web/js/core/boundary.js';

const WORLD = 'ABCDEF0123456789ABCDEF0123456789';
const OTHER = '0123456789ABCDEF0123456789ABCDEF';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
}

const schemas = {
  list: { registrant: (value) => text(value, 30), sort: (value) => oneOf(value, ['updated', 'parent-dex'], '') },
  owned: { sort: (value) => oneOf(value, ['dex', 'level'], 'dex') },
};

function setup({ scope = { env: 'test', user: 'Alice', world: WORLD }, session = memoryStorage(), local = memoryStorage() } = {}) {
  let clock = 1000;
  const current = { ...scope };
  const memory = createViewMemory({
    storage: safeStorage(session), local: safeStorage(local), namespace: 'ns', scope: () => current,
    schemas, views: ['search', 'list', 'owned'], worldViews: ['owned'], now: () => clock++,
  });
  return { memory, session, local, current };
}

test('位置と条件の保持: エントリは版・環境・利用者・ワールド・画面・URL が合うときだけ読み戻し、条件は画面の形で整える', () => {
  const { memory, current } = setup();
  const id = memory.newEntryId();
  assert.match(id, /^[0-9a-z]+$/);
  assert.notEqual(memory.newEntryId(), id);
  memory.writeEntry(id, { view: 'list', key: '#/list', cond: { registrant: '  ボブ ', sort: 'xxx', extra: 1 }, scrollY: 2500.6 });
  assert.deepEqual(memory.readEntry(id, { view: 'list', key: '#/list' }), { cond: { registrant: 'ボブ', sort: '' }, scrollY: 2500, world: WORLD });
  // 画面・URL が違う
  assert.equal(memory.readEntry(id, { view: 'search', key: '#/list' }), null);
  assert.equal(memory.readEntry(id, { view: 'list', key: '#/list?x=1' }), null);
  assert.equal(memory.readEntry('ない', { view: 'list', key: '#/list' }), null);
  // 利用者（ID の大小・全半角は同じとみなす）・環境・ワールド
  current.user = 'ａｌｉｃｅ';
  assert.ok(memory.readEntry(id, { view: 'list', key: '#/list' }));
  current.user = 'Bob';
  assert.equal(memory.readEntry(id, { view: 'list', key: '#/list' }), null);
  current.user = 'Alice';
  current.env = 'prod';
  assert.equal(memory.readEntry(id, { view: 'list', key: '#/list' }), null);
  current.env = 'test';
  current.world = OTHER;
  assert.equal(memory.readEntry(id, { view: 'list', key: '#/list' }), null);
  // 今のワールドがまだ分からない（読み込み前）ときは比べない
  current.world = '';
  assert.equal(memory.readEntry(id, { view: 'list', key: '#/list' }).world, WORLD);
  // ログインしていなければ読まない・書かない
  current.user = '';
  assert.equal(memory.readEntry(id, { view: 'list', key: '#/list' }), null);
});

test('位置と条件の保持: エントリは新しい方の 50 件まで。版の違う・壊れた要素は捨て、条件の無い画面は cond が null', () => {
  const { memory, session } = setup();
  for (let i = 0; i < ENTRIES_MAX + 5; i++) memory.writeEntry(`e${i}`, { view: 'search', key: `#/search?p1=${i}`, scrollY: i });
  const stored = JSON.parse(session.values.get('ns.entries'));
  assert.equal(stored.length, ENTRIES_MAX);
  assert.equal(stored[0].id, 'e5');
  assert.equal(memory.readEntry('e4', { view: 'search', key: '#/search?p1=4' }), null);
  assert.deepEqual(memory.readEntry('e54', { view: 'search', key: '#/search?p1=54' }), { cond: null, scrollY: 54, world: WORLD });
  // 同じ ID は書き直す（並びの最後へ）
  memory.writeEntry('e5', { view: 'search', key: '#/search?p1=5', scrollY: 900 });
  assert.equal(JSON.parse(session.values.get('ns.entries')).at(-1).scrollY, 900);
  // 版の違う要素・壊れた要素・位置の壊れた要素
  const broken = [null, 'x', { v: MEMORY_VERSION + 1, id: 'old', env: 'test', user: 'alice', view: 'search', key: '#/search' },
    { v: MEMORY_VERSION, id: 'bad', env: 'test', user: 'alice', world: 'W1', view: 'search', key: '#/search', scrollY: 'abc', cond: [] }];
  session.values.set('ns.entries', JSON.stringify(broken));
  assert.equal(memory.readEntry('old', { view: 'search', key: '#/search' }), null);
  // 壊れたワールドの ID は「不明」、位置は「無し」（動かさない）
  assert.deepEqual(memory.readEntry('bad', { view: 'search', key: '#/search' }), { cond: null, scrollY: null, world: '' });
  session.values.set('ns.entries', '{壊れた JSON');
  assert.equal(memory.readEntry('bad', { view: 'search', key: '#/search' }), null);
  memory.writeEntry('fresh', { view: 'search', key: '#/search', scrollY: 1 });
  assert.equal(JSON.parse(session.values.get('ns.entries')).length, 1);
});

test('位置と条件の保持: 読み込み直し用の保存は項目ごとに整え、版・環境・利用者が違えば使わず、ワールドが違えばワールドに依存する画面を捨てる', () => {
  const { memory, session, current } = setup();
  memory.saveViews({ views: { list: { registrant: 'ボブ', sort: 'updated' }, owned: { sort: 'level' } }, tabs: { list: '#/list', owned: '#/owned?x=1' } });
  assert.deepEqual(memory.loadViews(), {
    views: { list: { registrant: 'ボブ', sort: 'updated' }, owned: { sort: 'level' } }, tabs: { list: '#/list', owned: '#/owned?x=1' }, world: WORLD,
  });
  // 形の合わない項目は既定に戻し、タブの行き先は #/ で始まりその画面のものだけ
  const saved = JSON.parse(session.values.get('ns.views'));
  saved.views = { list: { registrant: 7, sort: 'xxx' }, owned: 'x', settings: { a: 1 } };
  saved.tabs = { list: 'https://example.com/#/list', owned: '#/search', search: '#/search?p1=SheepBall', pal: '#/pal/SheepBall' };
  session.values.set('ns.views', JSON.stringify(saved));
  assert.deepEqual(memory.loadViews(), { views: { list: { registrant: '', sort: '' } }, tabs: { search: '#/search?p1=SheepBall' }, world: WORLD });
  // ワールドが違えば、ワールドに依存する画面（owned）の条件は使わない
  saved.views = { list: { registrant: 'ボブ' }, owned: { sort: 'level' } };
  session.values.set('ns.views', JSON.stringify(saved));
  current.world = OTHER;
  assert.deepEqual(memory.loadViews().views, { list: { registrant: 'ボブ', sort: '' } });
  current.world = WORLD;
  // アプリの版（runningVersion）は見ない。保存の形の版・環境・利用者が違えば使わない
  session.values.set('ns.views', JSON.stringify({ ...saved, appVersion: '古い版' }));
  assert.ok(memory.loadViews());
  for (const change of [{ v: MEMORY_VERSION + 1 }, { env: 'prod' }, { user: 'bob' }]) {
    session.values.set('ns.views', JSON.stringify({ ...saved, ...change }));
    assert.equal(memory.loadViews(), null, JSON.stringify(change));
  }
  // clear はエントリと保存を消す（最後のタブは残す）
  memory.writeEntry('e1', { view: 'search', key: '#/search' });
  memory.setLastView('Alice', 'owned');
  memory.clear();
  assert.equal(session.values.has('ns.entries'), false);
  assert.equal(session.values.has('ns.views'), false);
  assert.equal(memory.lastView('Alice'), 'owned');
});

test('位置と条件の保持: 最後のタブは ID ごとに許した画面名だけを覚える', () => {
  const { memory, local } = setup();
  memory.setLastView('Alice', 'owned');
  assert.equal(local.values.get('ns.lastView.alice'), 'owned');
  assert.equal(memory.lastView('ALICE'), 'owned');
  assert.equal(memory.lastView('Bob'), '');
  for (const view of ['pal', 'login', '', null]) memory.setLastView('Alice', view);
  assert.equal(memory.lastView('Alice'), 'owned');
  local.values.set('ns.lastView.alice', 'pal');
  assert.equal(memory.lastView('Alice'), '');
  assert.equal(memory.lastView(''), '');
});

test('位置と条件の保持: storage が無い・例外を投げても落ちず、何も残さない', () => {
  const throwing = { getItem() { throw new Error('拒否'); }, setItem() { throw new Error('拒否'); }, removeItem() { throw new Error('拒否'); } };
  for (const storage of [null, throwing]) {
    const { memory } = setup({ session: storage, local: storage });
    assert.doesNotThrow(() => {
      memory.writeEntry('e1', { view: 'search', key: '#/search', scrollY: 1 });
      memory.saveViews({ views: {}, tabs: {} });
      memory.setLastView('Alice', 'owned');
      memory.clear();
    });
    assert.equal(memory.readEntry('e1', { view: 'search', key: '#/search' }), null);
    assert.equal(memory.loadViews(), null);
    assert.equal(memory.lastView('Alice'), '');
  }
  // safeStorage を通さない storage・scope が例外を投げる場合も
  const raw = createViewMemory({ storage: { get() { throw new Error('x'); }, set() { throw new Error('x'); }, remove() { throw new Error('x'); } },
    local: null, namespace: 'ns', scope: () => { throw new Error('x'); }, schemas });
  assert.doesNotThrow(() => { raw.writeEntry('e1', { view: 'search', key: '#/search' }); raw.clear(); });
  assert.equal(raw.loadViews(), null);
});

test('位置を戻す: 描いた後のフレームで scrollTo し、ページが短ければ届くまでやり直し、操作か上限の時間でやめる', async () => {
  const calls = [];
  const frames = [];
  const listeners = new Map();
  const win = {
    innerHeight: 900, scrollTo: (x, y) => calls.push(y), requestAnimationFrame: (fn) => frames.push(fn),
    addEventListener: (name, fn) => listeners.set(name, fn),
  };
  const doc = { documentElement: { scrollHeight: 1500 } };
  let clock = 0;
  const run = () => frames.splice(0).forEach((fn) => fn());
  restoreScroll(2500, { win, doc, now: () => clock });
  assert.deepEqual(calls, []);
  run();
  assert.deepEqual(calls, [2500]);
  // データが届いてページが伸びると、届いたところで終える
  doc.documentElement.scrollHeight = 4000;
  run();
  assert.deepEqual(calls, [2500, 2500]);
  run();
  assert.equal(frames.length, 0);
  // 利用者の操作でやめる
  doc.documentElement.scrollHeight = 1000;
  restoreScroll(2500, { win, doc, now: () => clock });
  run();
  listeners.get('wheel')();
  run();
  assert.equal(calls.length, 3);
  // 上限の時間（2 秒）を過ぎたらやめる
  const handle = restoreScroll(2500, { win, doc, now: () => clock });
  run();
  clock = 2500;
  run();
  assert.equal(frames.length, 0);
  assert.equal(calls.length, 5);
  // cancel の後は何もしない・scrollTo の無い環境では何もしない
  const later = restoreScroll(10, { win, doc, now: () => clock });
  later.cancel();
  handle.cancel();
  run();
  assert.equal(calls.length, 5);
  assert.doesNotThrow(() => restoreScroll(10, { win: {}, doc }).cancel());
});
