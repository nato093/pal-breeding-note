import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDevelopmentApi } from '../../dev/mock-api.js';
import { FakeElement, descendants, installResizeObserver } from '../helpers/dom.js';
import releaseNotes from '../../web/js/release-notes.js';
import pals from '../../web/data/pals.js';
import { OWNED_FIELDS } from '../../web/js/core/owned-shared.js';
import { TABS } from '../../web/js/views/tabs.js';

const find = (predicate) => descendants(document.body).find(predicate);
const byClass = (name) => find((node) => node.className.split(' ').includes(name));
const byText = (text) => find((node) => node.tagName === 'button' && node.textContent === text);
const input = (autocomplete) => find((node) => node.autocomplete === autocomplete);
const flush = () => new Promise((resolve) => setImmediate(resolve));
const isCard = (node) => node.className.split(' ').includes('breeding-card');
let imports = 0;

// pushState を true にすると、history に pushState を足す（足さないときは、無い環境として動くことを確かめる）。
// session（初めの値の object）を渡すと window に sessionStorage を、scroll を true にすると scrollY・innerHeight・scrollTo（呼ばれた位置を記録）を足す。
// resize を true にすると ResizeObserver を足す（返す resize(target, 高さ) で知らせ、observed(target) で監視しているかを見る）
async function boot(t, { initial = {}, api = createDevelopmentApi(), hash = '#/settings', pushState = false, session, scroll = false, resize = false } = {}) {
  for (const name of ['document', 'window', 'location', 'history', 'fetch', 'setInterval']) {
    const before = Object.getOwnPropertyDescriptor(globalThis, name);
    t.after(() => before ? Object.defineProperty(globalThis, name, before) : Reflect.deleteProperty(globalThis, name));
  }
  const root = new FakeElement('div');
  root.id = 'app';
  const body = new FakeElement('body');
  body.append(root);
  // document のリスナーは記録だけする（ショートカット N のテストで keydown を呼ぶ。ほかは呼ばない）
  const documentEvents = new Map();
  globalThis.document = {
    body, createElement: (name) => new FakeElement(name), createElementNS: (namespace, name) => new FakeElement(name),
    getElementById: (id) => descendants(body).find((node) => node.id === id),
    addEventListener: (name, handler) => documentEvents.set(name, handler), querySelectorAll: (selector) => body.querySelectorAll(selector),
    querySelector: (selector) => body.querySelector(selector),
  };
  const values = new Map(Object.entries(initial));
  const events = new Map();
  globalThis.window = {
    localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) },
    addEventListener: (name, handler) => events.set(name, handler),
  };
  const sessionValues = new Map(Object.entries(session ?? {}));
  if (session) {
    window.sessionStorage = {
      getItem: (key) => sessionValues.get(key) ?? null, setItem: (key, value) => sessionValues.set(key, value), removeItem: (key) => sessionValues.delete(key),
    };
  }
  const scrolls = [];
  if (scroll) Object.assign(window, { scrollY: 0, innerHeight: 900, scrollTo(x, y) { scrolls.push(y); window.scrollY = y; } });
  globalThis.location = { hostname: 'example.test', hash, search: '?k=旧招待値', pathname: '/Pal/' };
  window.location = location;
  const replacements = [];
  const replaceStates = [];
  const pushes = [];
  const moveTo = (url) => {
    const next = new URL(url, 'https://example.test');
    Object.assign(location, { pathname: next.pathname, search: next.search, hash: next.hash });
  };
  globalThis.history = {
    state: null,
    replaceState(state, title, url) {
      replacements.push(url);
      replaceStates.push(state);
      this.state = state;
      moveTo(url);
    },
  };
  // ブラウザと同じく、pushState は hashchange を起こさない
  if (pushState) history.pushState = (state, title, url) => { pushes.push(url); history.state = state; moveTo(url); };
  window.history = history;
  const calls = [];
  // 所持パルの共有（owned*）は配合の操作と別に数える
  const ownedCalls = [];
  globalThis.fetch = async (url, options) => {
    const request = JSON.parse(options.body);
    (request.action.startsWith('owned') ? ownedCalls : calls).push(request);
    return { ok: true, json: async () => api(request) };
  };
  const resizing = resize ? installResizeObserver(t) : {};
  // 定期の処理は記録だけする（本物のタイマーを残すとテストが終わらない）
  const intervals = [];
  globalThis.setInterval = (fn, ms) => intervals.push({ fn, ms });
  await import(`../../web/js/app.js?case=${++imports}`);
  assert.equal(byClass('startup-error'), undefined);
  const changeHash = (next) => { location.hash = next; events.get('hashchange')(); };
  return {
    ...resizing, values, sessionValues, scrolls, calls, ownedCalls, replacements, replaceStates, pushes, events, documentEvents, intervals, changeHash,
    // ブラウザと同じく、リンク・タブで移った先は state のない新しいエントリになる
    go(next) { history.state = null; changeHash(next); },
    // 戻る・進む: ブラウザと同じく、そのエントリの state に戻ってから popstate が来て、URL のハッシュが変わったときだけ続けて hashchange が来る
    back(next, state) {
      history.state = state;
      const moved = location.hash !== next;
      location.hash = next;
      events.get('popstate')?.();
      if (moved) events.get('hashchange')();
    },
  };
}

// ログイン画面で隠す（ログインした後に出す）部品。sync-line は同期状況（取得の失敗のチップを含む）
const signedInParts = ['navigation', 'notification-menu', 'save-status', 'account-chip', 'sync-line', 'header-pal-search'];
// 読み上げで読まれる文（hidden・aria-hidden・inert の中は読まれない）
const readable = (node) => (node.hidden || node.inert || node.getAttribute('aria-hidden') === 'true'
  ? '' : node.text + node.children.map(readable).join(''));

function assertLoginOnly() {
  assert.ok(byClass('login-form'));
  assert.equal(byClass('app-footer'), undefined);
  // 隠すだけの「◇」（.login-mark）は作らない
  assert.equal(byClass('login-mark'), undefined);
  for (const name of signedInParts) assert.equal(byClass(name).hidden, true, name);
  assert.equal(byClass('sync-status').disabled, true);
  assert.equal(byClass('brand').inert, true);
  // ログイン画面の並びは #app の .is-login（CSS。:has() は本文の出し入れのたびに全体のスタイルを計算し直させるので使わない。owned-rows）
  assert.ok(document.getElementById('app').className.split(' ').includes('is-login'));
  // ヘッダーで読まれるのは、テスト環境のチップだけ（同期状況の文・ログインのエラーは読まれない）
  assert.match(readable(byClass('app-header')), /^(テスト環境)?$/);
}

test('画面: 登録したセーブは 1 分ごとに読み直す（タブが裏にあっても）', async (t) => {
  const { intervals } = await boot(t);
  assert.deepEqual(intervals.map((timer) => timer.ms), [60 * 1000]);
  assert.doesNotThrow(() => intervals[0].fn());
});

test('画面: 未ログイン時は ID とパスワードを表示し、旧招待 URL でもログインしない', async (t) => {
  const { calls } = await boot(t);
  assertLoginOnly();
  assert.equal(calls.length, 0);
  assert.ok(input('username'));
  assert.ok(input('current-password'));
  assert.ok(byText('ログイン'));
  assert.ok(byText('新規登録'));
  assert.doesNotMatch(document.body.textContent, /招待リンク|パスコード/);
});

test('画面: パスワードだけを保存した旧端末もログイン画面を表示する', async (t) => {
  const { calls } = await boot(t, { initial: { 'pal-note.passcode': '旧パスワード', 'pal-note.authenticated': 'test' } });
  assertLoginOnly();
  assert.equal(calls.length, 0);
});

test('画面: 失敗をフォーム内に表示し、新規登録・ログアウト・ID の再入力を行う', async (t) => {
  const { values } = await boot(t);
  input('username').value = 'ＡｂＣ';
  input('current-password').value = '入力';
  await byText('ログイン').dispatch('click');
  assert.match(byClass('form-errors').textContent, /^この ID は見つかりません。初めての方は新規登録へ。$/);
  // ログインのエラーはフォームにだけ出す（ヘッダーの同期状況は隠したまま）
  assertLoginOnly();
  assert.equal(values.has('pal-note.passcode'), false);
  await byText('新規登録').dispatch('click');
  assert.equal(find((node) => node.tagName === 'h1').textContent, '新規登録');
  assert.equal(input('username').value, 'ＡｂＣ');
  input('username').value = 'あ'.repeat(21);
  input('new-password').value = '入力';
  await byText('登録してログイン').dispatch('click');
  assert.match(byClass('form-errors').textContent, /20 文字以内/);
  input('username').value = 'ＡｂＣ';
  await byText('登録してログイン').dispatch('click');
  assert.equal(byClass('login-form'), undefined);
  for (const name of signedInParts) assert.equal(byClass(name).hidden, false, name);
  assert.equal(byClass('brand').inert, false);
  assert.equal(byClass('sync-status').disabled, false);
  assert.equal(byClass('account-button').textContent, 'ＡｂＣ');
  const settings = byClass('settings-view');
  assert.match(settings.textContent, /ログイン中: ＡｂＣ/);
  assert.doesNotMatch(settings.textContent, /仲間を招待|パスコード|新しいパスワード|出典と権利表記/);
  assert.equal(values.get('pal-note.passcode'), '入力');
  const canceled = byText('ログアウト').dispatch('click');
  assert.match(find((node) => node.tagName === 'dialog').textContent, /ログアウトしますか/);
  await byText('キャンセル').dispatch('click');
  await canceled;
  assert.ok(byClass('settings-view'));
  const otherDialog = new FakeElement('dialog');
  document.body.append(otherDialog);
  otherDialog.showModal();
  const logout = byText('ログアウト').dispatch('click');
  const confirm = find((node) => node.tagName === 'dialog' && node !== otherDialog);
  await descendants(confirm).find((node) => node.tagName === 'button' && node.textContent === 'ログアウト').dispatch('click');
  await logout;
  assertLoginOnly();
  assert.equal(otherDialog.open, false);
  assert.equal(values.has('pal-note.passcode'), false);
  assert.equal(values.has('pal-note.cache.test'), false);
  assert.equal(values.get('pal-note.userId'), 'ＡｂＣ');
  assert.equal(input('username').value, 'ＡｂＣ');
  input('current-password').value = '誤入力';
  await byText('ログイン').dispatch('click');
  assert.match(byClass('form-errors').textContent, /パスワードが違います/);
  assert.equal(values.has('pal-note.passcode'), false);
  await byText('新規登録').dispatch('click');
  input('username').value = 'abc';
  input('new-password').value = '入力';
  await byText('登録してログイン').dispatch('click');
  assert.match(byClass('form-errors').textContent, /すでに使われています/);
  await byText('ログインに戻る').dispatch('click');
  input('current-password').value = '入力';
  await byText('ログイン').dispatch('click');
  assert.ok(byClass('settings-view'));
  assert.equal(values.get('pal-note.userId'), 'ＡｂＣ');
});

test('画面: 配合を探すの削除アイコンから確認・キャンセル・削除・元に戻すを行う', async (t) => {
  const { calls } = await boot(t, {
    initial: { 'pal-note.userId': '架空データ', 'pal-note.passcode': '入力' },
    api: createDevelopmentApi({ seed: '2' }), hash: '#/search',
  });
  const cards = () => descendants(document.body).filter((node) => isCard(node));
  const remove = () => find((node) => node.tagName === 'button' && node.getAttribute('aria-label') === '削除');
  assert.equal(cards().length, 2);
  assert.equal(byClass('app-footer'), undefined);
  // ロゴの副題（キャッチコピー）はなくした（copy-dead-ends）
  assert.equal(byClass('brand').textContent, 'パル配合ノート');
  // ロゴの菱形は CSS で描く印で、中身の文字（前は隠しているだけの「◇」）を持たず、読み上げない
  assert.deepEqual([byClass('brand-mark').textContent, byClass('brand-mark').getAttribute('aria-hidden')], ['', 'true']);
  assert.doesNotMatch(byClass('brand').textContent, /仲間と残す、冒険の発見。/);
  const canceled = remove().dispatch('click');
  assert.match(find((node) => node.tagName === 'dialog').textContent, /この配合を削除しますか/);
  await byText('キャンセル').dispatch('click');
  await canceled;
  assert.equal(cards().length, 2);
  const deletion = remove().dispatch('click');
  const preview = find((node) => node.tagName === 'dialog').querySelector('.breeding-card');
  assert.equal(preview.querySelectorAll('button').length, 0);
  await byText('削除').dispatch('click');
  await deletion;
  assert.equal(cards().length, 1);
  // 成功の知らせ（と元に戻す）は、サーバの応答を受けてから出す。
  assert.equal(byText('元に戻す'), undefined);
  await flush();
  assert.match(document.body.textContent, /削除しました/);
  await byText('元に戻す').dispatch('click');
  assert.equal(cards().length, 2);
  assert.doesNotMatch(document.body.textContent, /元に戻しました/);
  await flush();
  assert.equal(cards().length, 2);
  assert.match(document.body.textContent, /元に戻しました/);
  assert.deepEqual(calls.map((call) => call.action), ['snapshot', 'delete', 'restore']);
});

test('画面: 元に戻す前に他の人が同じ配合を登録していたら、統合の知らせだけを応答後に出す', async (t) => {
  const development = createDevelopmentApi({ seed: '2' });
  let deleted;
  const api = async (request) => {
    const { passcode } = request;
    if (request.action === 'delete') deleted = (await development({ action: 'snapshot', passcode })).records.find((record) => record.id === request.id);
    if (request.action === 'restore') {
      const fields = ['parent1Id', 'parent2Id', 'childId', 'parent1Gender', 'parent2Gender', 'registrant', 'memo'];
      const record = Object.fromEntries(fields.map((field) => [field, deleted[field]]));
      await development({ action: 'create', passcode, opId: crypto.randomUUID(), record: { id: crypto.randomUUID(), ...record } });
    }
    return development(request);
  };
  const { calls } = await boot(t, { initial: { 'pal-note.userId': '架空データ', 'pal-note.passcode': '入力' }, api, hash: '#/search' });
  const deletion = find((node) => node.tagName === 'button' && node.getAttribute('aria-label') === '削除').dispatch('click');
  await byText('削除').dispatch('click');
  await deletion;
  await flush();
  await byText('元に戻す').dispatch('click');
  assert.doesNotMatch(document.body.textContent, /既存の登録に統合しました/);
  await flush();
  assert.match(document.body.textContent, /既存の登録に統合しました/);
  assert.doesNotMatch(document.body.textContent, /元に戻しました/);
  assert.deepEqual(calls.map((call) => call.action), ['snapshot', 'delete', 'restore']);
});

test('画面: 削除が失敗したら結果に戻し、削除の知らせと元に戻すは出さずに失敗だけを知らせる', async (t) => {
  const development = createDevelopmentApi({ seed: '2' });
  const api = async (request) => request.action === 'delete' ? { ok: false, code: 'INTERNAL' } : development(request);
  const { calls } = await boot(t, { initial: { 'pal-note.userId': '架空データ', 'pal-note.passcode': '入力' }, api, hash: '#/search' });
  const cards = () => descendants(document.body).filter((node) => isCard(node));
  const deletion = find((node) => node.tagName === 'button' && node.getAttribute('aria-label') === '削除').dispatch('click');
  await byText('削除').dispatch('click');
  await deletion;
  assert.equal(cards().length, 1);
  assert.equal(byText('元に戻す'), undefined);
  await flush();
  assert.equal(cards().length, 2);
  assert.equal(byText('元に戻す'), undefined);
  assert.doesNotMatch(document.body.textContent, /削除しました/);
  assert.match(document.body.textContent, /削除できませんでした。サーバでエラーが発生しました/);
  assert.deepEqual(calls.map((call) => call.action), ['snapshot', 'delete', 'snapshot']);
});

test('画面: 削除は応答前に結果から消し、送信待ちの間だけページを閉じる前に確認する', async (t) => {
  const development = createDevelopmentApi({ seed: '2' });
  let release;
  const api = async (request) => {
    if (request.action === 'delete') await new Promise((resolve) => { release = resolve; });
    return development(request);
  };
  const { events } = await boot(t, { initial: { 'pal-note.userId': '架空データ', 'pal-note.passcode': '入力' }, api, hash: '#/search' });
  const cards = () => descendants(document.body).filter((node) => isCard(node));
  const leave = () => {
    const event = { prevented: false, preventDefault() { this.prevented = true; } };
    events.get('beforeunload')(event);
    return event;
  };
  assert.equal(leave().prevented, false);
  const deletion = find((node) => node.tagName === 'button' && node.getAttribute('aria-label') === '削除').dispatch('click');
  await byText('削除').dispatch('click');
  await deletion;
  assert.equal(cards().length, 1);
  const event = leave();
  assert.equal(event.prevented, true);
  assert.equal(event.returnValue, true);
  await flush();
  release();
  await flush();
  assert.equal(cards().length, 1);
  assert.equal(leave().prevented, false);
});

test('画面: ヘッダーは 1 行に ロゴ → テスト環境 → パル検索 → 同期状況 → セーブ連携 → ベル → ID の順で並ぶ（Tab の順。常設の「＋ 登録」はない）', async (t) => {
  await boot(t, { initial: { 'pal-note.userId': '架空データ', 'pal-note.passcode': '入力' }, api: createDevelopmentApi({ seed: '2' }), hash: '#/search' });
  const header = byClass('app-header');
  assert.deepEqual(header.children.map((node) => node.className.split(' ').at(-1)),
    ['brand', 'env-chip', 'header-pal-search', 'header-status', 'save-status', 'notification-menu', 'account-chip']);
  // パル検索のトリガーの読み上げの名前とショートカット
  const search = byClass('header-pal-search').querySelector('.picker-trigger');
  assert.equal(search.getAttribute('aria-label'), 'パルを探す（/）');
  assert.equal(search.getAttribute('aria-keyshortcuts'), '/');
  assert.equal(byClass('register-button'), undefined);
  assert.equal(byClass('header-actions'), undefined);
  assert.equal(byClass('environment-banner'), undefined);
  // ベル・登録はヘッダーの中（main より前）にあり、ルートの子はスキップリンク・ヘッダー・ナビ・更新の帯・本文と、本文の後ろの右のドロワーだけ
  assert.deepEqual(document.getElementById('app').children.map((node) => node.className.split(' ')[0]),
    ['skip-link', 'app-header', 'navigation', 'update-banner', 'app-main', 'side-drawer']);
  assert.equal(byClass('side-drawer').tagName, 'aside');
  assert.equal(byClass('side-drawer').hidden, true);
  // ログインした後はログイン画面の並び（.is-login）を外す
  assert.equal(document.getElementById('app').className.split(' ').includes('is-login'), false);
  // 開発 API はテスト環境なので、ロゴの右にチップを出す
  assert.equal(byClass('env-chip').hidden, false);
  assert.equal(byClass('env-chip').textContent, 'テスト環境');
  // 同期状況は押せるボタンで、読み上げの告知（aria-live）は付けない
  const status = byClass('sync-status');
  assert.equal(status.tagName, 'button');
  assert.equal(status.getAttribute('aria-live'), null);
  assert.equal(status.title, '最新に更新');
  assert.match(byClass('sync-label').textContent, /最新取得/);
  assert.equal(byClass('account-button').textContent, '架空データ');
  assert.equal(byClass('account-button').getAttribute('aria-label'), 'ログイン中の ID: 架空データ（ID の変更・ログアウト）');
  // メニューの中身は開いたときだけ作る（設定タブの「ログアウト」と取り違えない）
  assert.equal(byClass('account-panel'), undefined);
});

test('画面: ヘッダーのパネル（ベル・セーブ連携・ID）は、どれかを開くとほかを閉じ、ボタンの aria-controls は開いている間だけ付ける', async (t) => {
  await boot(t, { initial: { 'pal-note.userId': '架空データ', 'pal-note.passcode': '入力' }, api: createDevelopmentApi({ seed: '2' }), hash: '#/search' });
  const panels = ['notification-panel', 'save-status-panel', 'account-panel'];
  const opened = () => panels.filter((name) => byClass(name));
  const [bell, save, account] = ['notification-button', 'save-status-button', 'account-button'].map(byClass);
  for (const trigger of [bell, save, account]) assert.equal(trigger.getAttribute('aria-controls'), null);
  // キーボード（Enter）でも同じ click なので、外側の pointerdown を待たずにほかを閉じる
  await save.dispatch('click');
  assert.deepEqual(opened(), ['save-status-panel']);
  assert.equal(save.getAttribute('aria-controls'), byClass('save-status-panel').id);
  assert.equal(byClass('save-status-panel').getAttribute('role'), 'dialog');
  await bell.dispatch('click');
  assert.deepEqual(opened(), ['notification-panel']);
  assert.deepEqual([save.getAttribute('aria-controls'), save.getAttribute('aria-expanded')], [null, 'false']);
  assert.equal(bell.getAttribute('aria-controls'), byClass('notification-panel').id);
  await account.dispatch('click');
  assert.deepEqual(opened(), ['account-panel']);
  assert.deepEqual([bell.getAttribute('aria-controls'), bell.getAttribute('aria-expanded')], [null, 'false']);
  assert.equal(byClass('account-panel').getAttribute('role'), 'dialog');
  assert.deepEqual([save.getAttribute('aria-haspopup'), account.getAttribute('aria-haspopup')], ['dialog', 'dialog']);
  await save.dispatch('click');
  assert.deepEqual(opened(), ['save-status-panel']);
  // 開いているボタンをもう一度押すと閉じる（ほかは開かない）
  await save.dispatch('click');
  assert.deepEqual(opened(), []);
});

test('画面: 同期状況を押すと記録を取り直してトーストを出し、失敗しても前回の時刻と件数を残して「更新できませんでした」を出す', async (t) => {
  const development = createDevelopmentApi({ seed: '2' });
  let fail = false;
  const api = async (request) => (fail && request.action === 'snapshot' ? { ok: false, code: 'INTERNAL' } : development(request));
  const { calls } = await boot(t, { initial: { 'pal-note.userId': '架空データ', 'pal-note.passcode': '入力' }, api, hash: '#/search' });
  const status = byClass('sync-status');
  const failure = byClass('sync-error');
  const before = status.textContent;
  // 取得した直後に日付が変わっても落ちないよう、違う日の形（月/日 時:分）も許す
  assert.match(before, /^最新取得 (\d{1,2}\/\d{1,2} )?\d{2}:\d{2} · \d+ 件$/);
  assert.equal(failure.hidden, true);
  const snapshots = () => calls.filter((call) => call.action === 'snapshot').length;
  const count = snapshots();
  await status.dispatch('click');
  assert.equal(snapshots(), count + 1);
  assert.match(byClass('toast-region').textContent, /最新の記録に更新しました/);
  assert.equal(failure.hidden, true);
  fail = true;
  await status.dispatch('click');
  assert.equal(snapshots(), count + 2);
  // 時刻と件数は残し、失敗はボタンの隣のチップに出す（ボタンの文は変えない）
  assert.equal(status.textContent, before);
  assert.equal(failure.hidden, false);
  assert.equal(failure.textContent, '更新できませんでした');
  assert.match(failure.title, /サーバでエラーが発生しました/);
  assert.match(byClass('toast-region').textContent, /サーバでエラーが発生しました/);
  // 取り直せたらチップを消す
  fail = false;
  await status.dispatch('click');
  assert.equal(failure.hidden, true);
});

test('画面: 裏で送っている間はヘッダーに保存中の件数とバーを出し、送り終えたらすぐ消す', async (t) => {
  const development = createDevelopmentApi({ seed: '2' });
  let release;
  const api = async (request) => {
    if (request.action === 'delete') await new Promise((resolve) => { release = resolve; });
    return development(request);
  };
  await boot(t, { initial: { 'pal-note.userId': '架空データ', 'pal-note.passcode': '入力' }, api, hash: '#/search' });
  const status = byClass('sync-status');
  const bar = byClass('sync-progress');
  assert.equal(bar.hidden, true);
  assert.match(status.textContent, /最新取得/);
  for (let count = 0; count < 2; count++) {
    const deletion = find((node) => node.tagName === 'button' && node.getAttribute('aria-label') === '削除').dispatch('click');
    await byText('削除').dispatch('click');
    await deletion;
  }
  assert.equal(status.textContent, 'サーバに保存中… 0 / 2 件');
  // 保存中は押せない（文は薄くしない。CSS）
  assert.equal(status.disabled, true);
  assert.equal(bar.hidden, false);
  assert.equal(bar.getAttribute('aria-valuenow'), '0');
  assert.equal(bar.getAttribute('aria-valuemax'), '2');
  assert.equal(bar.style.getPropertyValue('--progress'), '0%');
  await flush();
  release();
  await flush();
  assert.equal(status.textContent, 'サーバに保存中… 1 / 2 件');
  assert.equal(bar.getAttribute('aria-valuenow'), '1');
  assert.equal(bar.style.getPropertyValue('--progress'), '50%');
  release();
  await flush();
  assert.equal(bar.hidden, true);
  assert.match(status.textContent, /最新取得/);
  assert.equal(status.disabled, false);
});

for (const [hash, next, label] of [
  ['#/search?p1=SheepBall&p2=FlowerDoll', '#/search?p2=FlowerDoll', '親1'],
  ['#/search?c=SheepBall', '#/search', '子'],
  ['#/route?from=SheepBall&to=MoonQueen', '#/route?to=MoonQueen', '開始'],
]) {
  test(`画面: ${label} の × で URL を変えても画面を作り直さず、同じトリガーにフォーカスを残す`, async (t) => {
    const { changeHash } = await boot(t, {
      initial: { 'pal-note.userId': '架空データ', 'pal-note.passcode': '入力' },
      api: createDevelopmentApi({ seed: '2' }), hash,
    });
    const view = document.getElementById('main').children[0];
    const clear = find((node) => node.getAttribute('aria-label') === `${label}の選択を解除`);
    assert.ok(clear);
    const original = clear.parentElement.querySelector('.picker-trigger');
    await clear.dispatch('click');
    assert.equal(location.hash, next);
    // テストの history には pushState が無いので location.hash に入れている。ブラウザなら来る hashchange を起こしても変わらない
    changeHash(next);
    const trigger = find((node) => node.getAttribute('aria-label') === `${label}: パルを選択`);
    assert.equal(trigger, original);
    assert.equal(document.activeElement, trigger);
    assert.equal(document.getElementById('main').children[0], view);
  });
}

const signedIn = { 'pal-note.userId': '架空データ', 'pal-note.passcode': '入力' };
const navTab = (label) => find((node) => node.className.split(' ').includes('nav-tab') && node.textContent.endsWith(label));

// パル選択の候補から名前で選ぶ
async function choosePal(picker, name) {
  await picker.querySelector('.picker-trigger').dispatch('click');
  const search = picker.querySelector('input');
  search.value = name;
  await search.dispatch('input');
  await picker.querySelectorAll('[role="option"]').find((option) => option.textContent.includes(name)).dispatch('click');
}

test('画面: 同じ画面で親を選ぶと、作り直さずに結果と URL を変えて履歴を 1 件足し、戻ると同じ画面のまま前の選択に戻る', async (t) => {
  const development = createDevelopmentApi();
  await development({ action: 'signup', passcode: '入力', opId: crypto.randomUUID(), userId: '架空データ' });
  await development({ action: 'create', passcode: '入力', opId: crypto.randomUUID(), record: {
    id: crypto.randomUUID(), parent1Id: 'SheepBall', parent2Id: 'FlowerDoll', childId: 'MoonQueen',
    parent1Gender: '', parent2Gender: '', registrant: '架空データ', memo: '',
  } });
  const { changeHash, pushes } = await boot(t, { initial: signedIn, api: development, hash: '#/search?p1=SheepBall', pushState: true });
  const main = document.getElementById('main');
  const view = main.children[0];
  const [first, second] = view.querySelectorAll('.picker');
  const firstTrigger = first.querySelector('.picker-trigger');
  assert.equal(view.querySelectorAll('.breeding-card').length, 1);
  await choosePal(second, 'ツッパニャン');
  assert.equal(location.hash, '#/search?p1=SheepBall&p2=PinkCat');
  assert.deepEqual(pushes, ['/Pal/#/search?p1=SheepBall&p2=PinkCat']);
  assert.equal(main.children[0], view);
  assert.equal(first.querySelector('.picker-trigger'), firstTrigger);
  assert.equal(view.querySelectorAll('.breeding-card').length, 0);
  assert.match(view.textContent, /この組み合わせはまだ登録されていません/);
  assert.equal(navTab('配合を探す').href, '#/search?p1=SheepBall&p2=PinkCat');
  // 戻る（hashchange だけが来る）と、同じ画面のまま前の選択と結果に戻る
  changeHash('#/search?p1=SheepBall');
  assert.equal(main.children[0], view);
  assert.equal(second.querySelector('.picker-trigger').getAttribute('aria-label'), '親2: パルを選択');
  assert.equal(view.querySelectorAll('.breeding-card').length, 1);
  assert.equal(pushes.length, 1);
});

test('画面: 別の画面へ移るときと、パル詳細で別のパルを開くときは作り直す', async (t) => {
  const { changeHash } = await boot(t, { initial: signedIn, api: createDevelopmentApi({ seed: '2' }), hash: '#/search?p1=SheepBall' });
  const main = document.getElementById('main');
  const search = main.children[0];
  changeHash('#/route?to=SheepBall');
  assert.notEqual(main.children[0], search);
  assert.equal(search.isConnected, false);
  assert.equal(main.querySelector('h1').textContent, '継承ルート');
  // 旧 URL（逆引き）は、配合を探すの画面のまま（同じ画面なので作り直さない）
  changeHash('#/search');
  const merged = main.children[0];
  changeHash('#/reverse?c=SheepBall');
  assert.equal(location.hash, '#/search?c=SheepBall');
  assert.equal(main.children[0], merged);
  assert.equal(main.querySelector('h1').textContent, '配合を探す');
  changeHash('#/pal/SheepBall');
  const sheep = main.children[0];
  changeHash('#/pal/FlowerDoll');
  assert.notEqual(main.children[0], sheep);
  assert.equal(sheep.isConnected, false);
  // パル詳細の見出しはパル名（hero は絵と属性だけで、名前を二重に出さない）
  const pal = pals.find((item) => item.id === 'FlowerDoll');
  assert.equal(main.querySelector('h1').textContent, `No.${pal.label} フラリーナ`);
  assert.doesNotMatch(main.querySelector('.pal-hero').textContent, /フラリーナ/);
});

test('画面: ログアウトしてから同じ URL でログインし直すと、画面を作り直して前の選択を引き継がない', async (t) => {
  const { changeHash } = await boot(t, { initial: signedIn, api: createDevelopmentApi({ seed: '2' }), hash: '#/search?p1=SheepBall' });
  const main = document.getElementById('main');
  const before = main.children[0];
  await choosePal(before.querySelectorAll('.picker')[1], 'ツッパニャン');
  assert.equal(main.children[0], before);
  assert.equal(navTab('配合を探す').href, '#/search?p1=SheepBall&p2=PinkCat');
  changeHash('#/settings');
  const logout = byText('ログアウト').dispatch('click');
  await descendants(find((node) => node.tagName === 'dialog')).find((node) => node.tagName === 'button' && node.textContent === 'ログアウト').dispatch('click');
  await logout;
  assertLoginOnly();
  assert.equal(navTab('配合を探す').href, '#/search');
  changeHash('#/search?p1=SheepBall');
  assertLoginOnly();
  input('current-password').value = '入力';
  await byText('ログイン').dispatch('click');
  const after = main.children[0];
  assert.notEqual(after, before);
  assert.deepEqual(after.querySelectorAll('.picker-trigger').map((node) => node.getAttribute('aria-label')), ['親1: No.1 モコロン', '親2: パルを選択', '子: パルを選択']);
  assert.equal(navTab('配合を探す').href, '#/search?p1=SheepBall');
});

test('画面: 不正な ID を URL から外すときは履歴の state を消さず、外した後の URL から同じ画面のまま選び直せる', async (t) => {
  const { changeHash, replaceStates } = await boot(t, { initial: signedIn, api: createDevelopmentApi({ seed: '2' }), hash: '#/search' });
  history.state = { palEntry: '前のエントリ' };
  changeHash('#/search?c=存在しない');
  assert.equal(location.hash, '#/search');
  assert.deepEqual(replaceStates.at(-1), { palEntry: '前のエントリ' });
  assert.equal(history.state.palEntry, '前のエントリ');
  assert.equal(navTab('配合を探す').href, '#/search');
  const view = document.getElementById('main').children[0];
  await choosePal(view.querySelectorAll('.picker')[2], 'モコロン');
  assert.equal(location.hash, '#/search?c=SheepBall');
  assert.equal(document.getElementById('main').children[0], view);
});

test('画面: タブを切り替えても選んだパルと絞り込みを残し、ログアウトすると忘れる', async (t) => {
  const { changeHash } = await boot(t, {
    initial: { 'pal-note.userId': '架空データ', 'pal-note.passcode': '入力' },
    api: createDevelopmentApi({ seed: '2' }), hash: '#/search?p1=SheepBall',
  });
  const tab = (label) => find((node) => node.className.split(' ').includes('nav-tab') && node.textContent.endsWith(label));
  const keyword = () => find((node) => node.placeholder === 'パル名・メモ・登録者（空白で複数）');
  // キーワードは URL（q）に入れ、タブの行き先にも覚える（テストの history に pushState が無いので、location.hash で入る）
  keyword().value = '該当なし';
  await keyword().dispatch('input');
  // キーワードの入力は間引くので、確定（change）で絞り込む
  await keyword().dispatch('change');
  assert.equal(location.hash, `#/search?p1=SheepBall&q=${encodeURIComponent('該当なし')}`);
  // モコロンの親の登録がないので、親の案内（キーワードを外しても 0 件）
  assert.match(document.body.textContent, /この親を使う配合はまだ登録されていません。/);
  changeHash(tab('継承ルート').href);
  assert.equal(location.hash, '#/route');
  // 配合を探すのタブとロゴは、前に選んだ親とキーワードのままの画面へ戻る
  assert.equal(tab('配合を探す').href, `#/search?p1=SheepBall&q=${encodeURIComponent('該当なし')}`);
  assert.equal(byClass('brand').href, tab('配合を探す').href);
  changeHash(tab('配合を探す').href);
  assert.ok(find((node) => node.getAttribute('aria-label') === '親1の選択を解除'));
  assert.equal(keyword().value, '該当なし');
  assert.match(document.body.textContent, /この親を使う配合はまだ登録されていません。/);
  // 不正な ID を URL から消したら、タブにも消した後の URL を覚える
  changeHash('#/search?c=存在しない');
  assert.equal(tab('配合を探す').href, '#/search');
  changeHash('#/settings');
  const logout = byText('ログアウト').dispatch('click');
  const confirm = find((node) => node.tagName === 'dialog');
  await descendants(confirm).find((node) => node.tagName === 'button' && node.textContent === 'ログアウト').dispatch('click');
  await logout;
  assertLoginOnly();
  assert.equal(tab('配合を探す').href, '#/search');
  assert.equal(tab('継承ルート').href, '#/route');
});

for (const signup of [false, true]) {
  test(`画面: 未ログインのハッシュ変更でも ${signup ? '新規登録' : 'ログイン'} フォームの入力とエラーを保持する`, async (t) => {
    const { changeHash, calls, replacements } = await boot(t, { hash: '#/search?p1=A&k=旧値&p2=B' });
    assertLoginOnly();
    assert.equal(new URLSearchParams(location.search).has('k'), false);
    assert.equal(new URLSearchParams(location.hash.split('?')[1]).has('k'), false);
    if (signup) await byText('新規登録').dispatch('click');
    const form = byClass('login-form');
    const userId = input('username');
    const password = input(signup ? 'new-password' : 'current-password');
    userId.value = '入力中のID';
    password.value = '入力中のパスワード';
    byClass('form-errors').textContent = '表示中のエラー';
    changeHash('#/settings?k=別の旧値&filter=残す');
    assertLoginOnly();
    assert.equal(byClass('login-form'), form);
    assert.equal(input('username'), userId);
    assert.equal(userId.value, '入力中のID');
    assert.equal(password.value, '入力中のパスワード');
    assert.equal(byClass('form-errors').textContent, '表示中のエラー');
    assert.equal(location.hash, '#/settings?filter=%E6%AE%8B%E3%81%99');
    assert.equal(replacements.length, 2);
    changeHash('#/route');
    assert.equal(byClass('login-form'), form);
    assert.equal(calls.length, 0);
    if (signup) {
      changeHash('#/settings');
      await byText('登録してログイン').dispatch('click');
      assert.ok(byClass('settings-view'));
      assert.equal(byClass('brand').inert, false);
    }
  });
}

test('画面: #/drafts は下書きの帯を開いた配合を探すに着き（履歴を増やさない）、帯から下書きを作って端末に保存し、登録すると記録に加わる', async (t) => {
  const { values, calls, events, replacements } = await boot(t, {
    initial: { 'pal-note.userId': '架空データ', 'pal-note.passcode': '入力' },
    api: createDevelopmentApi({ seed: '2' }), hash: '#/drafts',
  });
  assert.equal(location.hash, '#/search?drafts=1');
  assert.ok(replacements.some((url) => url.endsWith('#/search?drafts=1')));
  // 下書きのタブはない。配合を探すのタブが今の画面
  assert.equal(navTab('下書き'), undefined);
  assert.equal(navTab('配合を探す').getAttribute('aria-current'), 'page');
  const band = byClass('drafts-band');
  assert.ok(band);
  const toggle = band.querySelector('.drafts-band-toggle');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(toggle.textContent, '下書き 0 件（この端末だけ）');
  const key = 'pal-note.drafts.test.架空データ';
  // 0 件でも「＋ 下書きに追加」で作れる
  await descendants(band).find((node) => node.tagName === 'button' && node.textContent === '＋ 下書きに追加').dispatch('click');
  const dialog = find((node) => node.tagName === 'dialog' && node.open);
  assert.equal(dialog.querySelector('h2').textContent, '下書きに保存');
  dialog.querySelector('textarea').value = 'あとで確認';
  await byText('下書きに保存').dispatch('click');
  assert.equal(JSON.parse(values.get(key))[0].memo, 'あとで確認');
  assert.equal(calls.filter((call) => call.action === 'create').length, 0);
  assert.equal(toggle.textContent, '下書き 1 件（この端末だけ）');
  // 別のタブで書き換わった下書きを読み直す。
  const id = crypto.randomUUID();
  values.set(key, JSON.stringify([{ id, parent1Id: 'Alpaca', parent2Id: 'Boar', childId: 'Deer', registrant: '架空データ', memo: '' }]));
  events.get('storage')({ key });
  const rows = () => descendants(document.body).filter((node) => node.className.split(' ').includes('draft-row'));
  assert.equal(rows().length, 1);
  await descendants(rows()[0]).find((node) => node.tagName === 'button' && node.textContent === '登録').dispatch('click');
  assert.equal(rows().length, 0);
  assert.deepEqual(JSON.parse(values.get(key)), []);
  assert.equal(calls.at(-1).action, 'create');
  assert.ok(JSON.parse(values.get('pal-note.cache.test')).records.some((record) => record.parent1Id === 'Alpaca' && record.childId === 'Deer'));
  // 閉じると URL から drafts を外す（履歴は増やさない）。親を選ぶと帯は出さない
  await toggle.dispatch('click');
  assert.equal(location.hash, '#/search');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
});

test('画面: ショートカット N で登録を開く（配合を探すで選んだ親を初期値に）。文字の入力中・変換中・長押し・修飾キー・ダイアログを開いている間は開かない', async (t) => {
  const { documentEvents } = await boot(t, { initial: signedIn, api: createDevelopmentApi({ seed: '2' }), hash: '#/search?p1=SheepBall' });
  const keydown = documentEvents.get('keydown');
  assert.ok(keydown);
  const press = (extra = {}) => {
    const event = { key: 'n', isComposing: false, repeat: false, ctrlKey: false, altKey: false, metaKey: false, prevented: false, preventDefault() { this.prevented = true; }, ...extra };
    keydown(event);
    return event;
  };
  const openDialog = () => find((node) => node.tagName === 'dialog' && node.open);
  for (const extra of [{ isComposing: true }, { repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { key: 'm' }]) {
    assert.equal(press(extra).prevented, false, JSON.stringify(extra));
    assert.equal(openDialog(), undefined, JSON.stringify(extra));
  }
  // 入力欄にフォーカスがあれば開かない
  const keyword = find((node) => node.placeholder === 'パル名・メモ・登録者（空白で複数）');
  keyword.focus();
  assert.equal(press().prevented, false);
  keyword.blur?.();
  document.body.focus?.();
  document.activeElement = document.body;
  const event = press({ key: 'N' });
  assert.equal(event.prevented, true);
  const dialog = openDialog();
  assert.ok(dialog);
  assert.match(dialog.querySelectorAll('.picker-trigger')[0].textContent, /モコロン/);
  // ダイアログを開いている間は開かない（2 つ目を重ねない）
  assert.equal(press().prevented, false);
});

test('画面: ショートカット「/」でヘッダーのパル検索を開き、選んだパルを右のドロワーで開いて検索を空に戻す。入力欄・変換中・ダイアログ中は開かない。ドロワーの中の N はそのパルを子に開く', async (t) => {
  const { documentEvents } = await boot(t, { initial: signedIn, api: createDevelopmentApi({ seed: '2' }), hash: '#/search' });
  const keydown = documentEvents.get('keydown');
  const press = (extra = {}) => {
    const event = { key: '/', isComposing: false, repeat: false, ctrlKey: false, altKey: false, metaKey: false, prevented: false, preventDefault() { this.prevented = true; }, ...extra };
    keydown(event);
    return event;
  };
  const search = byClass('header-pal-search');
  const trigger = search.querySelector('.picker-trigger');
  // 変換中・修飾キー・入力欄では開かない（入力欄の「/」は文字として入る）
  for (const extra of [{ isComposing: true }, { ctrlKey: true }, { altKey: true }]) {
    assert.equal(press(extra).prevented, false, JSON.stringify(extra));
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  }
  const keyword = find((node) => node.placeholder === 'パル名・メモ・登録者（空白で複数）');
  keyword.focus();
  assert.equal(press().prevented, false);
  document.activeElement = document.body;
  assert.equal(press().prevented, true);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  // 候補は浮かせて body に置く。名前で絞って ↓ → Enter で選ぶと、ドロワーで開き、検索は空に戻る
  const input = find((node) => node.tagName === 'input' && node.getAttribute('aria-label') === 'パルを名前・英名・番号で探す');
  assert.ok(input);
  input.value = 'セレムーン';
  await input.dispatch('input');
  await input.dispatch('keydown', { key: 'ArrowDown' });
  await input.dispatch('keydown', { key: 'Enter' });
  assert.equal(byClass('side-drawer').hidden, false);
  assert.match(byClass('side-drawer-title').textContent, /セレムーン/);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(trigger.getAttribute('aria-label'), 'パルを探す（/）');
  assert.equal(document.activeElement, byClass('side-drawer-title'));
  // ドロワーの中にフォーカスがあるときの N は、そのパルを子にして登録を開く
  assert.equal(press({ key: 'n' }).prevented, true);
  const dialog = find((node) => node.tagName === 'dialog' && node.open);
  assert.ok(dialog);
  assert.match(dialog.querySelectorAll('.picker-trigger')[2].textContent, /セレムーン/);
  // ダイアログを開いている間は「/」で開かない
  assert.equal(press().prevented, false);
});

test('画面: ショートカット N は登録のボタンに案内（title・aria-keyshortcuts）があり、開いた帯などでは止めず候補を開いた部品だけで止める。パル詳細ではそのパルを子に開く', async (t) => {
  const { documentEvents, changeHash } = await boot(t, { initial: signedIn, api: createDevelopmentApi({ seed: '2' }), hash: '#/search?p1=SheepBall' });
  const keydown = documentEvents.get('keydown');
  const press = () => {
    const event = { key: 'n', isComposing: false, repeat: false, ctrlKey: false, altKey: false, metaKey: false, prevented: false, preventDefault() { this.prevented = true; } };
    keydown(event);
    return event;
  };
  const register = byClass('find-register');
  assert.deepEqual([register.title, register.getAttribute('aria-keyshortcuts')], ['キーボードの N でも開けます', 'N']);
  const openDialog = () => find((node) => node.tagName === 'dialog' && node.open);
  // 候補を開いている部品（aria-haspopup で aria-expanded=true）では開かない
  const popup = { tagName: 'BUTTON', getAttribute: (name) => ({ 'aria-expanded': 'true', 'aria-haspopup': 'listbox' })[name] ?? null };
  document.activeElement = popup;
  assert.equal(press().prevented, false);
  // 開いた帯・details など（aria-haspopup のない aria-expanded=true）では止めない
  document.activeElement = { tagName: 'BUTTON', getAttribute: (name) => (name === 'aria-expanded' ? 'true' : null) };
  assert.equal(press().prevented, true);
  await openDialog().querySelectorAll('button').find((node) => node.textContent === '閉じる').dispatch('click');
  assert.equal(openDialog(), undefined);
  // パル詳細: 「この子の配合を登録」と同じく、そのパルを子にして開く
  changeHash('#/pal/MoonQueen');
  document.activeElement = document.body;
  const childButton = find((node) => node.tagName === 'button' && node.textContent === 'この子の配合を登録');
  assert.equal(childButton.getAttribute('aria-keyshortcuts'), 'N');
  assert.equal(press().prevented, true);
  assert.match(openDialog().querySelectorAll('.picker-trigger')[2].textContent, /セレムーン/);
});

test('画面: 初めての端末では更新内容のお知らせを既読から始めて数字を出さず、別のタブで既読が変われば点を出し、開いても既読にしない', async (t) => {
  // どのお知らせよりも 7 日以上後の時刻（直近 7 日のお知らせは未読のまま。G-22）
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2099-01-01T00:00:00.000Z') });
  const { values, events } = await boot(t, {
    initial: { 'pal-note.userId': '架空データ', 'pal-note.passcode': '入力' }, api: createDevelopmentApi({ seed: '2' }),
  });
  const key = 'pal-note.notifications.read.架空データ';
  const bell = byClass('notification-button');
  const badge = byClass('notification-badge');
  const titles = (node) => node.querySelectorAll('.notification-title').map((title) => title.textContent);
  // 既読の記録のない ID はお知らせを既読から（G-22）。新しい人に過去のお知らせの未読が残り続けない
  assert.equal(badge.hidden, true);
  assert.equal(bell.getAttribute('aria-label'), '通知');
  assert.equal(JSON.parse(values.get(key)).length, releaseNotes.length);
  // 別のタブで既読が書き換わったら読み直す（お知らせだけが未読なら数字のない点）
  values.set(key, JSON.stringify(releaseNotes.slice(1).map((note) => `release:${note.id}`)));
  events.get('storage')({ key });
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, '');
  assert.equal(bell.getAttribute('aria-label'), '通知（お知らせ 1 件）');
  await bell.dispatch('click');
  assert.equal(bell.getAttribute('aria-expanded'), 'true');
  // パネルは既読も含めて新しい順（30 行まで）。開いただけでは既読にしない
  assert.deepEqual(titles(byClass('notification-panel')), releaseNotes.slice(0, 30).map((note) => note.title));
  assert.equal(byClass('notification-panel').querySelectorAll('.unread-chip').length, 1);
  assert.equal(badge.hidden, false);
  await bell.dispatch('click');
  assert.equal(byClass('notification-panel'), undefined);
  assert.equal(bell.getAttribute('aria-expanded'), 'false');
  // 設定タブの「通知一覧」はなくした（履歴はベルの「すべての通知を見る」）
  assert.equal(byText('通知一覧'), undefined);
});

test('画面: パル詳細の「☆ 目標に保存」で種族だけの目標にし、作れるようになったらベルで「配合が登録されました」と知らせ、目標の行に配合の数を出す', async (t) => {
  const development = createDevelopmentApi({ seed: '2' });
  let second = 0;
  // 同じミリ秒の応答で判定が止まらないよう、サーバ時刻を 1 秒ずつ進める。
  const api = async (request) => {
    const response = await development(request);
    if (typeof response.serverTime === 'string') response.serverTime = new Date(Date.UTC(2026, 9, 4, 0, 0, ++second)).toISOString();
    if (response.snapshot) response.snapshot.serverTime = new Date(Date.UTC(2026, 9, 4, 0, 0, ++second)).toISOString();
    return response;
  };
  const { values, changeHash } = await boot(t, { initial: { 'pal-note.userId': '架空データ', 'pal-note.passcode': '入力' }, api, hash: '#/search' });
  // ウィッシュリストのタブはない（タブは 5 本）
  assert.equal(navTab('ウィッシュリスト'), undefined);
  assert.equal(descendants(byClass('navigation')).filter((node) => node.className.split(' ').includes('nav-tab')).length, 5);
  const made = new Set(JSON.parse(values.get('pal-note.cache.test')).records.map((record) => record.childId));
  const target = pals.find((pal) => pal.active && !made.has(pal.id));
  changeHash(`#/pal/${target.id}`);
  const toggle = byClass('goal-toggle');
  assert.equal(toggle.textContent, '目標に保存');
  await toggle.dispatch('click');
  assert.equal(toggle.textContent, '目標に保存済み');
  const [goal] = JSON.parse(values.get('pal-note.ideals.test.架空データ'));
  assert.deepEqual([goal.palId, goal.passives, goal.targets], [target.id, [], { hp: 0, shot: 0, defense: 0 }]);
  // 観測は別のキー（前の版のタブが書き換えない）
  assert.ok(JSON.parse(values.get('pal-note.goalsObs.test.架空データ')).species[target.id]);
  const badge = byClass('notification-badge');
  const unread = Number(badge.textContent);
  // 仲間がほかの端末で登録し、こちらは最新の記録を取り直す。
  await development({ action: 'create', passcode: '入力', opId: crypto.randomUUID(), allowDifferentChild: true, record: {
    id: crypto.randomUUID(), parent1Id: 'SheepBall', parent2Id: 'FlowerDoll', childId: target.id,
    parent1Gender: '', parent2Gender: '', registrant: '仲間', memo: '',
  } });
  await byClass('sync-status').dispatch('click');
  await flush();
  assert.equal(badge.textContent, String(unread + 1));
  await byClass('notification-button').dispatch('click');
  const panel = byClass('notification-panel');
  const link = panel.querySelector('.notification-link');
  assert.equal(link.querySelector('.notification-title').textContent, `${target.ja}の配合が登録されました`);
  assert.match(link.textContent, /モコロン＋フラリーナ で作れます|フラリーナ＋モコロン で作れます/);
  assert.equal(link.href, `#/search?c=${target.id}`);
  await link.dispatch('click');
  assert.equal(byClass('notification-panel'), undefined);
  // 前のウィッシュリストの URL は、目標のダイアログを開いた理想個体に着く
  changeHash('#/wishlist');
  assert.equal(location.hash, '#/ideal');
  const dialog = find((node) => node.tagName === 'dialog' && node.open);
  // 見出しに件数（完成の数は、所持パルのデータがない〔未確認〕ので出さない。goals-detail）
  assert.equal(dialog.querySelector('h2').textContent, '目標（1 件）');
  const row = dialog.querySelector('.ideal-goal');
  assert.match(row.textContent, /パルだけ/);
  assert.match(row.querySelector('.ideal-goal-records').textContent, /^配合: 登録済み 1 件/);
  assert.equal(row.querySelector('.ideal-goal-records').href, `#/search?c=${target.id}`);
});

test('画面: 配合を探すで子だけを選んで 0 件のとき、子を変えると文と「目標に保存」が新しい子に変わる（前の子を登録しない）', async (t) => {
  const { values, changeHash } = await boot(t, { initial: signedIn, api: createDevelopmentApi({ seed: '2' }), hash: '#/search' });
  const made = new Set(JSON.parse(values.get('pal-note.cache.test')).records.map((record) => record.childId));
  const [first, second] = pals.filter((pal) => pal.active && !made.has(pal.id));
  changeHash(`#/search?c=${first.id}`);
  const main = document.getElementById('main');
  assert.equal(main.querySelector('.empty-state').querySelector('p').textContent, `${first.ja}の配合はまだ登録されていません。`);
  changeHash(`#/search?c=${second.id}`);
  assert.equal(main.querySelector('.empty-state').querySelector('p').textContent, `${second.ja}の配合はまだ登録されていません。`);
  await main.querySelector('.goal-toggle').dispatch('click');
  const goals = JSON.parse(values.get('pal-note.ideals.test.架空データ'));
  assert.deepEqual(goals.map((goal) => goal.palId), [second.id]);
  // ダブルクリックの 2 回目は捨てる（登録してすぐ外さない）
  await main.querySelector('.goal-toggle').dispatch('click', { detail: 2 });
  assert.equal(main.querySelector('.goal-toggle').textContent, '目標に保存済み');
});

test('画面: 旧ウィッシュリストのデータがあれば起動したときに目標へ移し、旧キーを消す。もう一度起動しても増えない', async (t) => {
  const development = createDevelopmentApi({ seed: '2' });
  const initial = { ...signedIn, 'pal-note.wishlist.test.架空データ': JSON.stringify([{ palId: 'SheepBall', addedAt: '2026-10-01T00:00:00Z' }, { palId: 'PinkCat' }]) };
  const { values } = await boot(t, { initial, api: development, hash: '#/ideal' });
  await flush();
  const goals = JSON.parse(values.get('pal-note.ideals.test.架空データ'));
  assert.deepEqual(goals.map((goal) => [goal.id, goal.palId, goal.name]), [['wish-SheepBall', 'SheepBall', 'モコロン'], ['wish-PinkCat', 'PinkCat', 'ツッパニャン']]);
  assert.equal(values.has('pal-note.wishlist.test.架空データ'), false);
  const obs = JSON.parse(values.get('pal-note.goalsObs.test.架空データ'));
  assert.deepEqual(obs.migration.wishlist.migrated, { SheepBall: 'wish-SheepBall', PinkCat: 'wish-PinkCat' });
  assert.equal(byClass('ideal-goals-button').textContent, '目標（2）');
});

test('画面: 設定から ID を変えると、ログイン中の ID・登録者名が新しい ID になり、前の ID のエントリと保存を消す', async (t) => {
  const { values, calls, sessionValues, events } = await boot(t, { session: {} });
  await byText('新規登録').dispatch('click');
  input('username').value = 'Taro';
  input('new-password').value = '入力';
  await byText('登録してログイン').dispatch('click');
  // 名前の変更の説明はモーダルの側だけ（設定のカードには出さない。C-40）
  assert.doesNotMatch(byClass('settings-view').textContent, /登録者名もすべて/);
  const dialogInput = () => descendants(find((node) => node.tagName === 'dialog' && node.open)).find((node) => node.tagName === 'input');
  byText('ID を変更').dispatch('click');
  assert.match(find((node) => node.tagName === 'dialog' && node.open).textContent, /これまでの配合の登録者名も、すべて新しい ID に変わります/);
  assert.equal(dialogInput().value, 'Taro');
  dialogInput().value = 'あ'.repeat(21);
  await byText('変更する').dispatch('click');
  await flush();
  assert.match(byClass('form-errors').textContent, /^ID は 20 文字以内で入力してください。$/);
  events.get('pagehide')();
  assert.ok(sessionValues.has('pal-note.entries'));
  assert.ok(sessionValues.has('pal-note.views'));
  dialogInput().value = 'Jiro';
  await byText('変更する').dispatch('click');
  await flush();
  assert.equal(find((node) => node.tagName === 'dialog' && node.open), undefined);
  assert.match(byClass('settings-view').textContent, /ログイン中: Jiro/);
  // 完了したら「終わっていません」の表示を残さず、ログアウトもできる
  assert.doesNotMatch(byClass('settings-view').textContent, /終わっていません/);
  assert.equal(byText('ID を変更').hidden, false);
  assert.equal(byText('ID の変更を再試行').hidden, true);
  assert.equal(byText('ログアウト').disabled, false);
  assert.equal(values.get('pal-note.userId'), 'Jiro');
  assert.equal(values.has('pal-note.rename'), false);
  assert.equal(sessionValues.has('pal-note.entries'), false);
  assert.equal(sessionValues.has('pal-note.views'), false);
  assert.deepEqual(calls.filter((request) => request.action === 'rename').map((request) => [request.userId, request.newUserId]), [['Taro', 'Jiro']]);
});

test('画面: 理想個体のタブから開け、所持パルがなければ案内を出す', async (t) => {
  const { changeHash } = await boot(t, {
    initial: { 'pal-note.userId': '架空データ', 'pal-note.passcode': '入力' },
    api: createDevelopmentApi({ seed: '2' }), hash: '#/search',
  });
  const tab = find((node) => node.className.split(' ').includes('nav-tab') && node.textContent.endsWith('理想個体'));
  assert.equal(tab.href, '#/ideal');
  changeHash('#/ideal?to=SheepBall');
  await flush();
  assert.equal(tab.getAttribute('aria-current'), 'page');
  assert.equal(byClass('ideal-view').querySelector('h1').textContent, '理想個体');
  assert.match(byClass('ideal-view').textContent, /所持パルのデータがありません/);
});

test('画面: 理想個体の条件のパネルの高さを画面の --panel-h に書き、ほかのタブへ移ると監視をやめる（ResizeObserver）', async (t) => {
  const { go, resize, observed } = await boot(t, { initial: signedIn, api: createDevelopmentApi({ seed: '2' }), hash: '#/ideal?to=SheepBall', resize: true });
  const view = byClass('ideal-view');
  const panel = view.querySelector('.ideal-panel');
  assert.ok(observed(panel));
  resize(panel, 141.5);
  assert.equal(view.style.getPropertyValue('--panel-h'), '141.5px');
  go('#/search');
  assert.notEqual(byClass('ideal-view'), view);
  assert.equal(observed(panel), false);
});

test('画面: 新しいバージョンの案内の「読み込み直す」は、入力画面（ダイアログ）が開いている間は読み込み直さず、閉じるよう案内する', async (t) => {
  await boot(t, { initial: signedIn, api: createDevelopmentApi({ seed: '2' }), hash: '#/search' });
  const banner = byClass('update-banner');
  // 登録の画面を開く（見出しの右の「＋ 配合を登録」）
  await byClass('find-register').dispatch('click');
  assert.ok(find((node) => node.tagName === 'dialog' && node.open));
  const reload = descendants(banner).find((node) => node.tagName === 'button' && node.textContent === '読み込み直す');
  await reload.dispatch('click');
  assert.equal(banner.querySelector('.update-banner-hint').textContent, '開いている入力画面を閉じてから、もう一度押してください。');
  assert.equal(reload.disabled, false);
});

// ---- 位置と条件の保持（keep-state） ----
const frame = () => new Promise((resolve) => setTimeout(resolve, 0));
const clickLink = (anchor) => document.getElementById('app').dispatch('click', { target: anchor });
const inputLabeled = (label) => find((node) => node.tagName === 'input' && node.getAttribute('aria-label') === label);
const selectHaving = (value) => find((node) => node.tagName === 'select' && node.children.some((option) => option.value === value));
// 押しボタンの選択（role=radiogroup。理想個体のパッシブの条件・ケーキ）で選んでいる値
const radioChecked = (label) => find((node) => node.getAttribute('role') === 'radiogroup' && node.getAttribute('aria-label') === label)
  ?.children.find((node) => node.getAttribute('aria-checked') === 'true')?.getAttribute('data-value');
const entriesOf = (sessionValues) => JSON.parse(sessionValues.get('pal-note.entries') ?? '[]');
const WORLD_A = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const WORLD_B = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const PLAYER = '00000000000000000000000000000001';

// 配合の全件のキャッシュ（ログイン済みで読み込み直したとき、起動の時点で環境が分かる）
async function cachedSignIn(development) {
  const snapshot = await development({ action: 'snapshot', passcode: '入力' });
  const { records, warnings, serverTime, users } = snapshot;
  return { ...signedIn, 'pal-note.authenticated': 'test', 'pal-note.cache.test': JSON.stringify({ records, warnings, serverTime, users }) };
}

// 開発 API に 1 ワールドの所持パルを共有しておく（所持者のプレイヤーは PLAYER）。extra で個体の列を書き換える。players でセーブのプレイヤーを変える
async function shareWorld(development, worldId, extra = {}, players = [{ uid: PLAYER, name: 'アリス' }]) {
  const row = Object.fromEntries(OWNED_FIELDS.map((field) => [field, '']));
  Object.assign(row, { instanceId: `pal-${worldId.slice(0, 4)}`, palId: 'SheepBall', palName: 'モコロン', gender: 'M', level: '10', rank: '1', stars: '0',
    talentHp: '50', talentShot: '50', talentDefense: '50', lucky: 'false', alpha: 'false', egg: 'false', place: 'palbox', placeLabel: 'パルボックス',
    holderUid: PLAYER, holder: 'アリス' }, extra);
  const response = await development({
    action: 'ownedUpload', passcode: '入力', userId: '架空データ', worldId, world: { name: 'ワールド', hostName: 'アリス' },
    saveUpdatedAt: new Date().toISOString(), players, bases: [], farms: [],
    columns: OWNED_FIELDS, rows: [OWNED_FIELDS.map((field) => row[field])],
  });
  assert.equal(response.stored, true);
}

// 共有の所持パルが届くまで待つ（所持者の選択肢にプレイヤーが出るまで）
async function untilShared() {
  for (let i = 0; i < 50 && !selectHaving(`player:${PLAYER}`); i++) await flush();
  assert.ok(selectHaving(`player:${PLAYER}`), '共有の所持パルが届かない');
}

test('画面: タブで戻るとその画面を離れたときの位置に、本文のリンクで別の画面へ移ると先頭から表示する', async (t) => {
  const development = createDevelopmentApi();
  await development({ action: 'signup', passcode: '入力', opId: crypto.randomUUID(), userId: '架空データ' });
  await development({ action: 'create', passcode: '入力', opId: crypto.randomUUID(), record: {
    id: crypto.randomUUID(), parent1Id: 'SheepBall', parent2Id: 'FlowerDoll', childId: 'MoonQueen',
    parent1Gender: '', parent2Gender: '', registrant: '架空データ', memo: '',
  } });
  const { go, scrolls } = await boot(t, { initial: signedIn, api: development, hash: '#/search?p1=SheepBall', scroll: true });
  // 起動では動かさない（ブラウザが先頭から開く）
  await frame();
  assert.deepEqual(scrolls, []);
  const tab = async (label) => {
    await clickLink(navTab(label));
    go(navTab(label).href);
    await frame();
  };
  await tab('継承ルート');
  assert.deepEqual(scrolls, [0]);
  window.scrollY = 2500;
  await tab('配合を探す');
  assert.deepEqual(scrolls, [0, 0]);
  window.scrollY = 400;
  await tab('継承ルート');
  assert.equal(scrolls.at(-1), 2500);
  await tab('配合を探す');
  assert.equal(scrolls.at(-1), 400);
  // カードのパル名は右のドロワーで開き、本文の位置は動かさない（drawer）
  window.scrollY = 500;
  const palLink = find((node) => node.tagName === 'a' && String(node.href).startsWith('#/pal/'));
  assert.ok(palLink);
  const moves = scrolls.length;
  await clickLink(palLink);
  await frame();
  assert.equal(scrolls.length, moves);
  assert.equal(byClass('side-drawer').hidden, false);
  assert.equal(document.getElementById('main').querySelector('.pal-hero'), null);
  // ドロワーの「ページで開く」（本文のリンク）でパル詳細の画面へ移ると先頭から。ドロワーは閉じる
  const page = byClass('side-drawer-page');
  await clickLink(page);
  go(page.href);
  await frame();
  assert.equal(scrolls.at(-1), 0);
  assert.ok(document.getElementById('main').querySelector('.pal-hero'));
  assert.equal(byClass('side-drawer').hidden, true);
});

test('画面: パルのタイルを押すと右のドロワーで開き、本文の画面は作り直さない。戻るで閉じ、タブを替えると閉じる', async (t) => {
  const development = createDevelopmentApi();
  await development({ action: 'signup', passcode: '入力', opId: crypto.randomUUID(), userId: '架空データ' });
  await development({ action: 'create', passcode: '入力', opId: crypto.randomUUID(), record: {
    id: crypto.randomUUID(), parent1Id: 'SheepBall', parent2Id: 'FlowerDoll', childId: 'MoonQueen',
    parent1Gender: '', parent2Gender: '', registrant: '架空データ', memo: '',
  } });
  const { go, back, pushes } = await boot(t, { initial: signedIn, api: development, hash: '#/search', pushState: true });
  for (let i = 0; i < 20 && !find(isCard); i++) await flush();
  const view = document.getElementById('main').children[0];
  const before = history.state;
  const tile = find((node) => node.tagName === 'a' && node.className.split(' ').includes('pal-tile') && node.href === '#/pal/MoonQueen');
  assert.ok(tile);
  await clickLink(tile.children[1]);
  const drawer = byClass('side-drawer');
  assert.equal(drawer.hidden, false);
  assert.match(byClass('side-drawer-title').textContent, /セレムーン/);
  // 本文は同じ画面のまま（作り直していない）。URL は変えずに履歴を 1 件積む（keep-state のエントリの ID は引き継ぐ）
  assert.equal(document.getElementById('main').children[0], view);
  assert.equal(location.hash, '#/search');
  assert.deepEqual(pushes, ['/Pal/#/search']);
  assert.equal(history.state.palEntry, before.palEntry);
  assert.equal(history.state.drawer.entry.id, 'MoonQueen');
  // 戻る（同じ URL・同じエントリの ID）でドロワーだけ閉じる
  back('#/search', before);
  assert.equal(drawer.hidden, true);
  assert.equal(document.getElementById('main').children[0], view);
  // もう一度開いてタブを替えると閉じる
  await clickLink(tile.children[1]);
  assert.equal(drawer.hidden, false);
  await clickLink(navTab('継承ルート'));
  go(navTab('継承ルート').href);
  assert.equal(drawer.hidden, true);
});

test('画面: `#/pal`（ID なし）は図鑑の格子（題名も「図鑑」）。マスを押すと画面を移らずにドロワーでパル詳細を開く（中にも「図鑑」のリンク）', async (t) => {
  const development = createDevelopmentApi();
  await development({ action: 'signup', passcode: '入力', opId: crypto.randomUUID(), userId: '架空データ' });
  await development({ action: 'create', passcode: '入力', opId: crypto.randomUUID(), record: {
    id: crypto.randomUUID(), parent1Id: 'SheepBall', parent2Id: 'FlowerDoll', childId: 'MoonQueen',
    parent1Gender: '', parent2Gender: '', registrant: '架空データ', memo: '',
  } });
  const { pushes } = await boot(t, { initial: signedIn, api: development, hash: '#/pal', pushState: true });
  const isMoon = (node) => node.tagName === 'a' && node.getAttribute('data-pal-id') === 'MoonQueen' && node.className.split(' ').includes('paldex-cell');
  for (let i = 0; i < 20 && !(find(isMoon) && !find(isMoon).className.split(' ').includes('is-unregistered')); i++) await flush();
  const view = document.getElementById('main').children[0];
  assert.equal(view.querySelector('h1').textContent, '図鑑');
  assert.match(document.title, /^図鑑 · /);
  const moon = find(isMoon);
  assert.equal(byClass('paldex-grid').children.length, 298);
  assert.match(moon.getAttribute('aria-label'), /子としての登録 1 件/);
  await clickLink(moon.children[1]);
  assert.equal(byClass('side-drawer').hidden, false);
  assert.match(byClass('side-drawer-title').textContent, /セレムーン/);
  assert.equal(document.getElementById('main').children[0], view);
  assert.equal(location.hash, '#/pal');
  assert.deepEqual(pushes, ['/Pal/#/pal']);
  // ドロワーの中のパル詳細にも「図鑑」（ほかの画面から開いたドロワーで押すと、ドロワーを閉じて本文が図鑑になる）
  const dex = find((node) => node.className.split(' ').includes('pal-dex-link') && byClass('side-drawer').contains(node));
  assert.equal(dex.href, '#/pal/');
});

test('画面: 図鑑（`#/pal/`）の上で開いたドロワーの「図鑑」は、今の本文と同じ URL なのでドロワーを閉じて本文を見せる（× と同じ）', async (t) => {
  const development = createDevelopmentApi();
  await development({ action: 'signup', passcode: '入力', opId: crypto.randomUUID(), userId: '架空データ' });
  const { pushes } = await boot(t, { initial: signedIn, api: development, hash: '#/pal/', pushState: true });
  const isSheep = (node) => node.tagName === 'a' && node.getAttribute('data-pal-id') === 'SheepBall' && node.className.split(' ').includes('paldex-cell');
  for (let i = 0; i < 20 && !find(isSheep); i++) await flush();
  const view = document.getElementById('main').children[0];
  await clickLink(find(isSheep).children[1]);
  assert.equal(byClass('side-drawer').hidden, false);
  assert.deepEqual(pushes, ['/Pal/#/pal/']);
  const dex = find((node) => node.className.split(' ').includes('pal-dex-link') && byClass('side-drawer').contains(node));
  const clicked = await clickLink(dex);
  assert.equal(clicked.defaultPrevented, true);
  assert.equal(byClass('side-drawer').hidden, true);
  assert.equal(history.state.drawer, undefined);
  assert.equal(location.hash, '#/pal/');
  assert.equal(document.getElementById('main').children[0], view);
});

test('画面: ドロワーを開いたまま本文にフォーカスを移しても Esc で閉じる（入力欄では閉じない）。開いたまま検索語を打ったエントリは、× で前のエントリへ戻らない印になる', async (t) => {
  const development = createDevelopmentApi();
  await development({ action: 'signup', passcode: '入力', opId: crypto.randomUUID(), userId: '架空データ' });
  await development({ action: 'create', passcode: '入力', opId: crypto.randomUUID(), record: {
    id: crypto.randomUUID(), parent1Id: 'SheepBall', parent2Id: 'FlowerDoll', childId: 'MoonQueen',
    parent1Gender: '', parent2Gender: '', registrant: '架空データ', memo: '',
  } });
  const { documentEvents } = await boot(t, { initial: signedIn, api: development, hash: '#/search', pushState: true });
  for (let i = 0; i < 20 && !find(isCard); i++) await flush();
  const tile = find((node) => node.tagName === 'a' && node.className.split(' ').includes('pal-tile') && node.href === '#/pal/MoonQueen');
  await clickLink(tile.children[1]);
  const drawer = byClass('side-drawer');
  assert.equal(drawer.hidden, false);
  assert.equal(history.state.drawer.pushed, true);
  // 検索語を打つ（履歴は置き換え）。ドロワーを積んだときの URL ではなくなるので、× で戻らない印にする
  const keyword = find((node) => node.placeholder === 'パル名・メモ・登録者（空白で複数）');
  keyword.value = 'セレ';
  await keyword.dispatch('input');
  await keyword.dispatch('change');
  assert.equal(location.hash, `#/search?q=${encodeURIComponent('セレ')}`);
  assert.equal(drawer.hidden, false);
  assert.equal(history.state.drawer.pushed, false);
  const keydown = documentEvents.get('keydown');
  const escape = () => {
    const event = { key: 'Escape', isComposing: false, repeat: false, ctrlKey: false, altKey: false, metaKey: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    keydown(event);
    return event;
  };
  // 入力欄にフォーカスがある間の Esc（欄を空にする既定の動き）では閉じない
  keyword.focus();
  assert.equal(escape().defaultPrevented, false);
  assert.equal(drawer.hidden, false);
  // 本文（body）にフォーカスがあれば閉じる
  document.activeElement = document.body;
  assert.equal(escape().defaultPrevented, true);
  assert.equal(drawer.hidden, true);
  assert.equal(history.state.drawer, undefined);
  assert.equal(location.hash, `#/search?q=${encodeURIComponent('セレ')}`);
});

test('画面: 戻る・進むでは、そのときの履歴のエントリの条件と位置に戻し、別の利用者・別のワールドのエントリは使わない', async (t) => {
  const development = createDevelopmentApi({ seed: '2' });
  const { go, back, scrolls, sessionValues } = await boot(t, { initial: signedIn, api: development, hash: '#/ideal?to=SheepBall', session: {}, scroll: true });
  const first = history.state.palEntry;
  assert.ok(first);
  const setTarget = async (label, value) => {
    const input = inputLabeled(label);
    input.value = value;
    // 入力は間引くので、確定（change）で計算する
    await input.dispatch('input');
    await input.dispatch('change');
  };
  // 条件 X（所持者「すべて」・HP 50）で 300px まで読んでから、配合を探すへ（所持パルのデータがないので、所持者の選択肢は「すべて」だけ。
  // 自分の選択肢は自分のプレイヤーが分かるときだけ出す。D29）
  const holder = selectHaving('');
  holder.value = '';
  await holder.dispatch('change');
  await setTarget('HPの目標（以上）', '50');
  window.scrollY = 300;
  await clickLink(navTab('配合を探す'));
  go(navTab('配合を探す').href);
  const second = history.state.palEntry;
  assert.notEqual(second, first);
  assert.deepEqual(entriesOf(sessionValues).find((entry) => entry.id === first).cond, { holder: '', mode: 'include', targets: { hp: 50, shot: 100, defense: 100 }, cake: 'none' });
  // 理想個体のタブで戻って条件 Y（HP 70）にする（新しいエントリ）
  await clickLink(navTab('理想個体'));
  go(navTab('理想個体').href);
  await setTarget('HPの目標（以上）', '70');
  assert.equal(inputLabeled('HPの目標（以上）').value, '70');
  // 2 回戻ると、最初のエントリの条件 X と位置に戻る
  back('#/search', { palEntry: second });
  back('#/ideal?to=SheepBall', { palEntry: first });
  await frame();
  assert.equal(inputLabeled('HPの目標（以上）').value, '50');
  assert.equal(scrolls.at(-1), 300);
  // 別の利用者・別の環境・保存の形の版が違うエントリは使わない（画面には今の条件が残る。ワールドは次のテスト）
  await setTarget('HPの目標（以上）', '80');
  for (const change of [{ user: '別の人' }, { env: 'prod' }, { v: 2 }]) {
    const entries = entriesOf(sessionValues).map((entry) => (entry.id === first ? { ...entry, ...change, cond: { ...entry.cond, targets: { hp: 10, shot: 100, defense: 100 } } } : entry));
    sessionValues.set('pal-note.entries', JSON.stringify(entries));
    back('#/search', { palEntry: second });
    back('#/ideal?to=SheepBall', { palEntry: first });
    assert.equal(inputLabeled('HPの目標（以上）').value, '80', JSON.stringify(change));
  }
});

test('画面: 別のタブで「このワールドでの自分」を選んだら（storage イベント）、理想個体の目標の状態を描き直し、完成済みにしても通知は出さない', async (t) => {
  const development = createDevelopmentApi({ seed: '2' });
  // 共有された所持パル（アリスのモコロン）。ログインしている「架空データ」はセーブのプレイヤー名と違うので、自分が分からない
  await shareWorld(development, WORLD_A);
  const goals = [{ id: 'goal-1', name: 'モコロン', palId: 'SheepBall', passives: [], mode: 'include', targets: { hp: 0, shot: 0, defense: 0 }, cake: 'none', order: 'next', worlds: {} }];
  const { values, events } = await boot(t, { initial: { ...signedIn, 'pal-note.ideals.test.架空データ': JSON.stringify(goals) }, api: development, hash: '#/ideal?to=SheepBall' });
  await untilShared();
  await byClass('ideal-goals-button').dispatch('click');
  const status = () => byClass('ideal-goal-status').textContent;
  assert.equal(status(), '未確認');
  assert.equal(byClass('ideal-goal-action').href, `#/settings?world=${WORLD_A}&open=self`);
  const before = Number(byClass('notification-badge').textContent);
  const key = `pal-note.ideals.self.test.架空データ.${WORLD_A}`;
  values.set(key, PLAYER);
  events.get('storage')({ key });
  assert.match(status(), /^完成済み: アリス/);
  assert.equal(byClass('ideal-goals-reason').hidden, true);
  // 選んだ時点で完成していたものは知らせない
  assert.equal(JSON.parse(values.get('pal-note.ideals.test.架空データ'))[0].worlds[WORLD_A].completedAt, '');
  assert.equal(Number(byClass('notification-badge').textContent), before);
  // 所持者の選択肢も、自分（アリス）の名前になる
  assert.ok(selectHaving('mine'));
});

test('画面: 理想個体の「設定で選ぶ」で設定へ移ると、「このワールドでの自分」にフォーカスして URL から行き先を外し、選ぶとこの端末に保存する', async (t) => {
  const development = createDevelopmentApi({ seed: '2' });
  await shareWorld(development, WORLD_A);
  const goals = [{ id: 'goal-1', name: 'モコロン', palId: 'SheepBall', passives: [], mode: 'include', targets: { hp: 0, shot: 0, defense: 0 }, cake: 'none', order: 'next', worlds: {} }];
  const { values, go } = await boot(t, { initial: { ...signedIn, 'pal-note.ideals.test.架空データ': JSON.stringify(goals) }, api: development, hash: '#/ideal?to=SheepBall' });
  await untilShared();
  await byClass('ideal-goals-button').dispatch('click');
  const action = byClass('ideal-goal-action');
  await action.dispatch('click');
  assert.equal(find((node) => node.tagName === 'dialog' && node.open), undefined);
  go(action.href);
  assert.ok(byClass('settings-view'));
  assert.equal(location.hash, '#/settings');
  // 画面を付けた後に移る
  await frame();
  const select = document.activeElement;
  assert.equal(select.getAttribute('aria-label'), 'このワールドでの自分');
  assert.deepEqual(select.children.map((node) => node.textContent), ['未設定（自分の個体を判定しません）', 'アリス']);
  select.value = PLAYER;
  await select.dispatch('change');
  assert.equal(values.get(`pal-note.ideals.self.test.架空データ.${WORLD_A}`), PLAYER);
  assert.equal(JSON.parse(values.get('pal-note.ideals.test.架空データ'))[0].worlds[WORLD_A].complete, true);
});

test('画面: 別のタブで「登録者の対応」を変えたら（storage イベント）、本人の変化として理想個体の目標の状態と所持者の選択肢を描き直し、完成済みにしても通知は出さない', async (t) => {
  const development = createDevelopmentApi({ seed: '2' });
  await shareWorld(development, WORLD_A);
  const goals = [{ id: 'goal-1', name: 'モコロン', palId: 'SheepBall', passives: [], mode: 'include', targets: { hp: 0, shot: 0, defense: 0 }, cake: 'none', worlds: {} }];
  const { values, events } = await boot(t, { initial: { ...signedIn, 'pal-note.ideals.test.架空データ': JSON.stringify(goals) }, api: development, hash: '#/ideal?to=SheepBall' });
  await untilShared();
  await byClass('ideal-goals-button').dispatch('click');
  const status = () => byClass('ideal-goal-status').textContent;
  assert.equal(status(), '未確認');
  assert.equal(selectHaving('mine'), undefined);
  const before = Number(byClass('notification-badge').textContent);
  // 関係のないキー・別の環境の対応表では何もしない
  for (const key of ['pal-note.autoBreeding.settings', `pal-note.autoBreeding.players.prod.${WORLD_A}`]) {
    values.set(key, JSON.stringify({ [PLAYER]: '架空データ' }));
    events.get('storage')({ key });
  }
  assert.equal(status(), '未確認');
  // 別のタブの設定で、アリスの登録者をログイン中の ID（架空データ）にした
  const key = `pal-note.autoBreeding.players.test.${WORLD_A}`;
  values.set(key, JSON.stringify({ [PLAYER]: '架空データ' }));
  events.get('storage')({ key });
  assert.match(status(), /^完成済み: アリス/);
  assert.equal(JSON.parse(values.get('pal-note.ideals.test.架空データ'))[0].worlds[WORLD_A].completedAt, '');
  assert.equal(Number(byClass('notification-badge').textContent), before);
  assert.ok(selectHaving('mine'));
});

test('画面: ID の変更中は「このワールドでの自分」を選べず、変更中に別のタブで自分が変わったら、変更が終わってから 1 回判定し直す（通知は出さない）', async (t) => {
  const development = createDevelopmentApi({ seed: '2' });
  const BOB = '00000000000000000000000000000002';
  // 共有された所持パル（アリスのモコロン）。プレイヤーはアリスとボブで、この端末の自分はボブ（モコロンを持っていない）
  await shareWorld(development, WORLD_A, {}, [{ uid: PLAYER, name: 'アリス' }, { uid: BOB, name: 'ボブ' }]);
  const goals = [{ id: 'goal-1', name: 'モコロン', palId: 'SheepBall', passives: [], mode: 'include', targets: { hp: 0, shot: 0, defense: 0 }, cake: 'none', worlds: {} }];
  const selfKey = `pal-note.ideals.self.test.架空データ.${WORLD_A}`;
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const api = async (request) => {
    if (request.action === 'rename') await held;
    return development(request);
  };
  const { values, events, calls } = await boot(t, { initial: { ...signedIn, 'pal-note.ideals.test.架空データ': JSON.stringify(goals), [selfKey]: BOB }, api, hash: '#/settings' });
  // ワールドごとのキー（このワールドでの自分）を ID の変更で移すには、保存先のキーの一覧が要る
  Object.defineProperty(window.localStorage, 'length', { get: () => values.size });
  window.localStorage.key = (index) => [...values.keys()][index] ?? null;
  const selfSelect = () => find((node) => node.tagName === 'select' && node.getAttribute('aria-label') === 'このワールドでの自分');
  for (let i = 0; i < 50 && !selfSelect()?.children.some((option) => option.value === BOB); i++) await flush();
  assert.equal(selfSelect().value, BOB);
  const judged = () => JSON.parse(values.get('pal-note.ideals.test.架空データ'))[0].worlds[WORLD_A];
  assert.equal(judged().complete, false);
  const before = Number(byClass('notification-badge').textContent);
  // ID を変える（サーバの応答を待たせる）
  byText('ID を変更').dispatch('click');
  descendants(find((node) => node.tagName === 'dialog' && node.open)).find((node) => node.tagName === 'input').value = 'Jiro';
  const renaming = byText('変更する').dispatch('click');
  for (let i = 0; i < 50 && !calls.some((request) => request.action === 'rename'); i++) await flush();
  assert.equal(selfSelect().disabled, true);
  assert.equal(selfSelect().title, 'ID の変更が終わってから選んでください');
  // 変更中に、別のタブで自分をアリス（モコロンを持っている）にした。変更中は判定し直さない
  values.set(selfKey, PLAYER);
  events.get('storage')({ key: selfKey });
  assert.equal(judged().complete, false);
  release();
  await renaming;
  for (let i = 0; i < 10; i++) await flush();
  assert.match(byClass('settings-view').textContent, /ログイン中: Jiro/);
  // 変更が終わってから、新しい ID の保存先で 1 回判定し直す（そのとき完成していたものは知らせない）
  assert.equal(values.get(`pal-note.ideals.self.test.jiro.${WORLD_A}`), PLAYER);
  const after = JSON.parse(values.get('pal-note.ideals.test.jiro'))[0].worlds[WORLD_A];
  assert.deepEqual([after.complete, after.completedAt], [true, '']);
  assert.equal(Number(byClass('notification-badge').textContent), before);
  assert.equal(selfSelect().disabled, false);
  assert.equal(selfSelect().value, PLAYER);
});

test('画面: 設定を開いたまま設定の行き先のリンク（ヘッダーのセーブ連携の「設定を開く」）を押しても、履歴を増やさずにその場で行き先へ移る', async (t) => {
  const { pushes, replacements } = await boot(t, { initial: signedIn, api: createDevelopmentApi({ seed: '2' }), hash: '#/settings', pushState: true });
  await flush();
  await byClass('save-status-button').dispatch('click');
  const open = byClass('save-status-settings');
  assert.equal(open.href, '#/settings?open=status');
  const before = replacements.length;
  const clicked = await clickLink(open);
  // ブラウザの移動（新しいエントリと hashchange）を止め、今のエントリのまま行き先を当てて URL から外す
  assert.equal(clicked.defaultPrevented, true);
  assert.deepEqual(pushes, []);
  assert.deepEqual(replacements.slice(before).map((url) => url.replace(/^[^#]*/, '')), ['#/settings?open=status', '#/settings']);
  assert.equal(location.hash, '#/settings');
  // 登録したワールドがないので、セーブ連携のカードの見出しへ
  assert.equal(document.activeElement, byClass('owned-settings').querySelector('h2'));
  // 別の画面からの行き先・設定への行き先でないリンクは、今までどおりブラウザが移る（印だけ付ける）
  const toSearch = new FakeElement('a');
  toSearch.href = '#/search';
  assert.equal((await clickLink(toSearch)).defaultPrevented, false);
});

test('画面: 戻る・進むのエントリは、表示中のワールドと違うワールドで書いたものを使わない', async (t) => {
  const development = createDevelopmentApi({ seed: '2' });
  await shareWorld(development, WORLD_B);
  const { back, sessionValues } = await boot(t, { initial: signedIn, api: development, hash: '#/ideal', session: {} });
  await untilShared();
  const entry = (world, query) => ({ v: 1, id: `owned-${world}`, env: 'test', user: '架空データ', world, view: 'owned', key: '#/owned', cond: { query }, scrollY: 0, at: 1 });
  sessionValues.set('pal-note.entries', JSON.stringify([entry(WORLD_A, '別のワールド'), entry(WORLD_B, '同じワールド')]));
  const keyword = () => byClass('owned-keyword').querySelector('input');
  back('#/owned', { palEntry: `owned-${WORLD_A}` });
  assert.equal(keyword().value, '');
  back('#/ideal', { palEntry: 'x' });
  back('#/owned', { palEntry: `owned-${WORLD_B}` });
  assert.equal(keyword().value, '同じワールド');
});

test('画面: 読み込み直したら、同じタブで保存した所持パルの絞り込み・理想個体の条件・タブの行き先に戻し、形の合わない項目と、なくなった画面（一覧）の保存は使わない', async (t) => {
  const development = createDevelopmentApi({ seed: '2' });
  const saved = {
    v: 1, env: 'test', user: '架空データ', world: '',
    views: {
      owned: { query: 'もこ', sort: 'xxx', stars: 2, eggs: false, globals: true, talent: { hp: 150, shot: 40, defense: -1 }, passives: ['Legend', 7], palId: 'SheepBall' },
      ideal: { holder: 'mine', mode: 'only', targets: { hp: 90, shot: 150, defense: 80 }, cake: 'talent', name: '保存しない' },
      list: { registrant: 'ボブ', sort: 'updated' },
    },
    tabs: { search: '#/search?p1=SheepBall', list: 'https://example.com/#/list' },
  };
  const { go } = await boot(t, { initial: await cachedSignIn(development), api: development, hash: '#/owned', session: { 'pal-note.views': JSON.stringify(saved) } });
  const keyword = find((node) => node.tagName === 'input' && node.type === 'search');
  assert.equal(keyword.value, 'もこ');
  assert.equal(selectHaving('passives').value, 'dex');
  assert.equal(selectHaving('4').value, '2');
  assert.deepEqual(['HPの個体値（以上）', '攻撃の個体値（以上）', '防御の個体値（以上）'].map((label) => inputLabeled(label).value), ['', '40', '']);
  // 個体値は 40 の攻撃だけがチェックつき。前の形の表示の切り替え（タマゴを隠す・グローバルボックスを表示）は場所のチップに読み替える
  assert.deepEqual(['HPを条件にする', '攻撃を条件にする', '防御を条件にする'].map((label) => inputLabeled(label).checked), [false, true, false]);
  const chips = Object.fromEntries(descendants(document.getElementById('main')).filter((node) => node.className.split(' ').includes('place-chip'))
    .map((node) => [node.getAttribute('data-value'), node.getAttribute('aria-pressed')]));
  assert.deepEqual(chips, { party: 'true', palbox: 'true', base: 'true', display: 'true', dps: 'true', global: 'true', egg: 'false', unknown: 'true' });
  assert.ok(find((node) => node.getAttribute('aria-label') === 'パル: No.1 モコロン'));
  // パッシブは文字列の ID だけ
  assert.ok(find((node) => node.getAttribute('data-focus-key') === 'passive-chip:パッシブ:Legend'));
  assert.equal(descendants(document.getElementById('main')).filter((node) => String(node.getAttribute('data-focus-key')).startsWith('passive-chip:')).length, 1);
  assert.equal(navTab('配合を探す').href, '#/search?p1=SheepBall');
  assert.equal(navTab('一覧'), undefined);
  go('#/ideal?to=SheepBall');
  assert.deepEqual(['HPの目標（以上）', '攻撃の目標（以上）', '防御の目標（以上）'].map((label) => inputLabeled(label).value), ['90', '100', '80']);
  assert.equal(radioChecked('パッシブの条件'), 'only');
  assert.equal(radioChecked('ケーキ'), 'talent');
  // 所持者（保存は自分）は、所持パルのデータがなく自分のプレイヤーが分からないので「すべて」として出す（D29）
  assert.equal(selectHaving('').value, '');
  // 旧一覧の保存（list）は使わない（配合を探すの条件は URL にある）
  go('#/list');
  assert.equal(location.hash, '#/search');
  assert.equal(find((node) => node.placeholder === 'パル名・メモ・登録者（空白で複数）').value, '');
  assert.equal(selectHaving('updated').value, 'updated');
});

for (const change of [{ v: 2 }, { env: 'prod' }, { user: '別の人' }]) {
  test(`画面: 読み込み直したときの保存は、${JSON.stringify(change)} が違えば使わない`, async (t) => {
    const development = createDevelopmentApi({ seed: '2' });
    const saved = { v: 1, env: 'test', user: '架空データ', world: '', views: { owned: { query: 'ボブ' } }, tabs: {}, ...change };
    await boot(t, { initial: await cachedSignIn(development), api: development, hash: '#/owned', session: { 'pal-note.views': JSON.stringify(saved) } });
    assert.equal(byClass('owned-keyword').querySelector('input').value, '');
  });
}

for (const [world, expected] of [[WORLD_A, ''], [WORLD_B, `player:${PLAYER}`]]) {
  test(`画面: 読み込み直したとき、${world === WORLD_A ? '別の' : '同じ'}ワールドで保存した所持者の条件は、表示するワールドが分かったところで${expected ? '残す' : '外す'}`, async (t) => {
    const development = createDevelopmentApi({ seed: '2' });
    await shareWorld(development, WORLD_B);
    const saved = { v: 1, env: 'test', user: '架空データ', world, views: { owned: { holder: `player:${PLAYER}` }, ideal: { holder: `player:${PLAYER}` } }, tabs: {} };
    const { go } = await boot(t, { initial: await cachedSignIn(development), api: development, hash: '#/owned', session: { 'pal-note.views': JSON.stringify(saved) } });
    await untilShared();
    assert.equal(selectHaving(`player:${PLAYER}`).value, expected);
    go('#/ideal');
    assert.equal(selectHaving(`player:${PLAYER}`).value, expected);
  });
}

const lastView = 'pal-note.lastView.架空データ';
for (const [hash, last, expected] of [['', 'owned', '#/owned'], ['#/', 'route', '#/route'], ['#/settings', 'owned', '#/settings'], ['', 'pal', ''], ['', '知らない', ''], ['', 'list', ''], ['#/', 'reverse', '#/']]) {
  test(`画面: 最後に開いたタブが ${last} で「${hash}」を開くと ${expected || 'ハッシュなし（配合を探す）'} から始める`, async (t) => {
    await boot(t, { initial: { ...signedIn, [lastView]: last }, api: createDevelopmentApi({ seed: '2' }), hash });
    assert.equal(location.hash, expected);
  });
}

test('画面: ハッシュのない URL で開くと、保存したタブの行き先のまま最後のタブから始め、開いたタブ（パル詳細を除く）を ID ごとに覚える', async (t) => {
  // タブの行き先を保存していれば、その条件のまま開く
  const development = createDevelopmentApi({ seed: '2' });
  const saved = { v: 1, env: 'test', user: '架空データ', world: '', views: {}, tabs: { search: '#/search?p1=SheepBall' } };
  await boot(t, { initial: { ...(await cachedSignIn(development)), [lastView]: 'search' }, api: development, hash: '', session: { 'pal-note.views': JSON.stringify(saved) } });
  assert.equal(location.hash, '#/search?p1=SheepBall');
  // 開いたタブを覚える
  const { values, go } = await boot(t, { initial: signedIn, api: createDevelopmentApi({ seed: '2' }), hash: '#/search' });
  assert.equal(values.get(lastView), 'search');
  go('#/ideal');
  assert.equal(values.get(lastView), 'ideal');
  go('#/pal/SheepBall');
  assert.equal(values.get(lastView), 'ideal');
});

test('画面: ページを離れるときに今のエントリと読み込み直し用の保存を書き、ログアウトで消す（最後のタブは残す）', async (t) => {
  const { values, sessionValues, events, changeHash } = await boot(t, { initial: signedIn, api: createDevelopmentApi({ seed: '2' }), hash: '#/owned', session: {} });
  const keyword = byClass('owned-keyword').querySelector('input');
  keyword.value = 'ボブ';
  await keyword.dispatch('input');
  await keyword.dispatch('change');
  events.get('pagehide')();
  const saved = JSON.parse(sessionValues.get('pal-note.views'));
  assert.deepEqual([saved.v, saved.env, saved.user, saved.views.owned.query], [1, 'test', '架空データ', 'ボブ']);
  assert.equal(saved.tabs.owned, '#/owned');
  // 保存するのは条件と位置だけ（パスワード・記録の中身は入れない）
  assert.doesNotMatch(sessionValues.get('pal-note.views') + sessionValues.get('pal-note.entries'), /入力|動作確認用/);
  const [entry] = entriesOf(sessionValues);
  assert.deepEqual([entry.id, entry.view, entry.key, entry.cond.query], [history.state.palEntry, 'owned', '#/owned', 'ボブ']);
  changeHash('#/settings');
  const logout = byText('ログアウト').dispatch('click');
  await descendants(find((node) => node.tagName === 'dialog')).find((node) => node.tagName === 'button' && node.textContent === 'ログアウト').dispatch('click');
  await logout;
  assertLoginOnly();
  assert.equal(sessionValues.has('pal-note.views'), false);
  assert.equal(sessionValues.has('pal-note.entries'), false);
  assert.equal(values.get('pal-note.lastView.架空データ'), 'settings');
});

test('画面: 画面を作り直すときは、同じ役目の部品（data-focus-key）があればフォーカスを引き継ぎ、無ければ何もしない', async (t) => {
  const { back } = await boot(t, { initial: signedIn, api: createDevelopmentApi({ seed: '2' }), hash: '#/search?p1=SheepBall' });
  // 配合を探すの親 1 の選択欄 → 設定（同じ役目の部品がない）
  find((node) => node.getAttribute('aria-label') === '親1: No.1 モコロン').focus();
  back('#/settings', null);
  assert.equal(document.activeElement, document.body);
  // 継承ルートの目標の選択欄 → 戻るで理想個体へ（目標の選択欄がある）
  back('#/route?to=MoonQueen', null);
  find((node) => node.getAttribute('data-focus-key') === 'picker:目標').focus();
  back('#/ideal?to=SheepBall', null);
  assert.equal(document.activeElement.getAttribute('data-focus-key'), 'picker:目標');
  assert.ok(byClass('ideal-view').contains(document.activeElement));
});

test('画面: 同じ画面の中で戻る・進む（作り直さない）ときも、エントリの条件を入力欄に戻し、新しいエントリには新しい ID を付ける', async (t) => {
  const { back, pushes, sessionValues } = await boot(t, {
    initial: signedIn, api: createDevelopmentApi({ seed: '2' }), hash: '#/ideal?to=SheepBall', session: {}, pushState: true,
  });
  const view = byClass('ideal-view');
  const first = history.state.palEntry;
  const hp = () => inputLabeled('HPの目標（以上）');
  const setHp = async (value) => {
    hp().value = value;
    await hp().dispatch('input');
    await hp().dispatch('change');
  };
  await setHp('50');
  await view.querySelector('.passive-add').dispatch('click');
  await view.querySelector('[data-value="Rare"]').dispatch('click');
  assert.deepEqual(pushes, ['/Pal/#/ideal?to=SheepBall&p=Rare']);
  const second = history.state.palEntry;
  assert.ok(second);
  assert.notEqual(second, first);
  // 押す前のエントリには、そのときの条件を書いてある
  assert.equal(entriesOf(sessionValues).find((entry) => entry.id === first).cond.targets.hp, 50);
  await setHp('70');
  back('#/ideal?to=SheepBall', { palEntry: first });
  assert.equal(byClass('ideal-view'), view);
  assert.equal(hp().value, '50');
  assert.equal(view.querySelectorAll('.passive-remove').length, 0);
  // 進むと、離れたときの最新の条件（HP 70）に戻る（スクロールしていなくても、離れるエントリに書いておく）
  back('#/ideal?to=SheepBall&p=Rare', { palEntry: second });
  assert.equal(byClass('ideal-view'), view);
  assert.equal(hp().value, '70');
  assert.equal(view.querySelectorAll('.passive-remove').length, 1);
  assert.equal(entriesOf(sessionValues).find((entry) => entry.id === second).cond.targets.hp, 70);
});

test('画面: マスターにまだ無い内部名のパッシブを選ぶとチップが出て、戻る・進む・読み込み直しでも残る（所持パル・理想個体）', async (t) => {
  const development = createDevelopmentApi({ seed: '2' });
  // 所持パルに、パッシブのマスターにまだ無い内部名（ゲームの更新で増えたもの）が付いている
  await shareWorld(development, WORLD_B, { passiveIds: 'Unknown_Passive_X' });
  const initial = await cachedSignIn(development);
  const { go, back, events, sessionValues } = await boot(t, { initial, api: development, hash: '#/owned', session: {}, pushState: true });
  await untilShared();
  const main = () => document.getElementById('main');
  const chip = () => descendants(main()).find((node) => String(node.getAttribute('data-focus-key')).endsWith(':Unknown_Passive_X'));
  const pick = async () => {
    await main().querySelector('.passive-add').dispatch('click');
    await main().querySelector('[data-value="Unknown_Passive_X"]').dispatch('click');
  };
  // 所持パル（条件は履歴のエントリと読み込み直し用の保存に持つ）
  await pick();
  assert.ok(chip());
  assert.equal(main().querySelector('.result-note').textContent, '1 / 1 体 · ♂1 ♀0');
  const ownedEntry = history.state.palEntry;
  // 理想個体（条件は URL の p）
  await clickLink(navTab('理想個体'));
  go('#/ideal?to=SheepBall');
  const beforePick = history.state.palEntry;
  await pick();
  assert.equal(location.hash, '#/ideal?to=SheepBall&p=Unknown_Passive_X');
  assert.ok(chip());
  const idealEntry = history.state.palEntry;
  // 戻る・進む
  back('#/ideal?to=SheepBall', { palEntry: beforePick });
  assert.equal(chip(), undefined);
  back('#/owned', { palEntry: ownedEntry });
  assert.ok(chip());
  back('#/ideal?to=SheepBall', { palEntry: beforePick });
  back('#/ideal?to=SheepBall&p=Unknown_Passive_X', { palEntry: idealEntry });
  assert.ok(chip());
  // 読み込み直し（同じタブの sessionStorage から戻す）
  events.get('pagehide')();
  const reloaded = await boot(t, { initial, api: development, hash: '#/ideal?to=SheepBall&p=Unknown_Passive_X', session: Object.fromEntries(sessionValues) });
  assert.ok(chip());
  reloaded.go('#/owned');
  await untilShared();
  assert.ok(chip());
});

test('画面: 作り直す画面へ戻って進むと、離れたときの最新の条件（所持パルのキーワード）に戻る', async (t) => {
  const { go, back, events } = await boot(t, { initial: signedIn, api: createDevelopmentApi({ seed: '2' }), hash: '#/search', session: {}, pushState: true });
  const start = history.state.palEntry;
  await clickLink(navTab('所持パル'));
  go(navTab('所持パル').href);
  const ownedEntry = history.state.palEntry;
  // 裏に回った（ページを離れたときと同じく、今のエントリを書く。このときのキーワードは空）
  events.get('pagehide')();
  const keyword = () => find((node) => node.tagName === 'input' && node.type === 'search');
  keyword().value = 'もこ';
  await keyword().dispatch('input');
  await keyword().dispatch('change');
  back('#/search', { palEntry: start });
  back('#/owned', { palEntry: ownedEntry });
  assert.equal(keyword().value, 'もこ');
});

test('画面: 打ってから間引きの間（150ms）にタブを押しても、離れるエントリには打った後の条件を書き、閉じた画面は後から描かない', async (t) => {
  const { go, sessionValues } = await boot(t, { initial: signedIn, api: createDevelopmentApi({ seed: '2' }), hash: '#/search', session: {} });
  const first = history.state.palEntry;
  const keyword = find((node) => node.placeholder === 'パル名・メモ・登録者（空白で複数）');
  const list = byClass('find-results');
  const shown = list.querySelectorAll('.breeding-card').length;
  assert.ok(shown > 0);
  keyword.value = '該当なし';
  await keyword.dispatch('input');
  await clickLink(navTab('継承ルート'));
  go(navTab('継承ルート').href);
  assert.equal(list.isConnected, false);
  // 離れる前に、間引いて待っていたキーワードを当てる（URL とタブの行き先に入る）
  assert.equal(navTab('配合を探す').href, `#/search?q=${encodeURIComponent('該当なし')}`);
  assert.equal(entriesOf(sessionValues).find((entry) => entry.id === first).key, `#/search?q=${encodeURIComponent('該当なし')}`);
  // 間引きの時間が過ぎても、閉じた画面は描き直さない
  const left = list.querySelectorAll('.breeding-card').length;
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(list.querySelectorAll('.breeding-card').length, left);
});

test('画面: 同じ URL のエントリどうし（理想個体の「呼び出す」で g を外す）を戻る・進むと、hashchange が来なくてもエントリの条件に戻す', async (t) => {
  const { go, back } = await boot(t, { initial: signedIn, api: createDevelopmentApi({ seed: '2' }), hash: '#/ideal?to=SheepBall', session: {}, pushState: true });
  const hp = () => inputLabeled('HPの目標（以上）');
  const setHp = async (value) => {
    hp().value = value;
    await hp().dispatch('input');
    await hp().dispatch('change');
  };
  const first = history.state.palEntry;
  // HP 50 の条件を目標に保存してから、HP 70 にする
  await setHp('50');
  await byText('☆ 目標に保存').dispatch('click');
  await byText('保存').dispatch('click');
  await setHp('70');
  // 見出しの「目標（1）」で目標のダイアログを開く
  await byText('目標（1）').dispatch('click');
  const recall = find((node) => String(node.getAttribute('data-focus-key')).startsWith('goal:'));
  assert.ok(recall);
  // 「呼び出す」: 保存した条件（HP 50）を入れ、URL から g を外す（前のエントリと同じ URL になる）。ダイアログは閉じる
  await recall.dispatch('click');
  assert.equal(find((node) => node.tagName === 'dialog' && node.open), undefined);
  await clickLink(recall);
  go(recall.href);
  assert.equal(location.hash, '#/ideal?to=SheepBall');
  assert.equal(hp().value, '50');
  const second = history.state.palEntry;
  assert.notEqual(second, first);
  // 戻る・進む（URL が同じなので popstate だけが来る）
  back('#/ideal?to=SheepBall', { palEntry: first });
  assert.equal(hp().value, '70');
  back('#/ideal?to=SheepBall', { palEntry: second });
  assert.equal(hp().value, '50');
});

test('画面: 戻る・進むで popstate と hashchange が続けて来ても、描くのは 1 回（URL が変わったときは hashchange で描く）', async (t) => {
  const { go, events } = await boot(t, { initial: signedIn, api: createDevelopmentApi({ seed: '2' }), hash: '#/search', session: {} });
  const main = document.getElementById('main');
  const search = main.children[0];
  const start = history.state.palEntry;
  await clickLink(navTab('継承ルート'));
  go(navTab('継承ルート').href);
  const list = main.children[0];
  assert.notEqual(list, search);
  history.state = { palEntry: start };
  location.hash = '#/search';
  events.get('popstate')?.();
  assert.equal(main.children[0], list);
  events.get('hashchange')();
  const shown = main.children[0];
  assert.notEqual(shown, list);
  assert.equal(shown.querySelector('h1').textContent, '配合を探す');
  // 同じエントリ・同じ URL の popstate（読み込んだときなど）では描き直さない
  events.get('popstate')?.();
  assert.equal(main.children[0], shown);
});

test('画面: 中身の無いエントリ（50 件の上限・名前の変更で消えた）へ戻る・進むで違う画面に移ると先頭から、同じ画面なら動かさない', async (t) => {
  const { go, back, scrolls, sessionValues } = await boot(t, { initial: signedIn, api: createDevelopmentApi({ seed: '2' }), hash: '#/search', session: {}, scroll: true });
  const listEntry = history.state.palEntry;
  await clickLink(navTab('継承ルート'));
  go(navTab('継承ルート').href);
  await frame();
  window.scrollY = 800;
  sessionValues.delete('pal-note.entries');
  const before = scrolls.length;
  back('#/search', { palEntry: listEntry });
  await frame();
  assert.deepEqual(scrolls.slice(before), [0]);
  // 同じ画面の中（URL だけ違う）では動かさない
  window.scrollY = 300;
  sessionValues.delete('pal-note.entries');
  back('#/search?x=1', { palEntry: '消えたエントリ' });
  await frame();
  assert.deepEqual(scrolls.slice(before), [0]);
});

test('画面: ログイン画面は見出しが「ログイン」「新規登録」だけで、説明は新規登録のときだけ。INV-2 の注記は残し、最初のフォーカスは ID の欄（入っていればパスワード）', async (t) => {
  await boot(t);
  const panel = byClass('login-panel');
  assert.equal(panel.querySelector('h1').textContent, 'ログイン');
  // キャッチコピー（eyebrow・見出し）と、ログインでは要らない説明はなくした
  assert.doesNotMatch(panel.textContent, /仲間とつくる|冒険の発見|ID と共通パスワードを入力/);
  assert.equal(byClass('eyebrow'), undefined);
  assert.equal(byClass('login-lead'), undefined);
  assert.deepEqual(panel.querySelectorAll('.field-label').map((node) => node.textContent), ['ID（20 文字まで）', '共通パスワード']);
  assert.equal(byClass('login-note').textContent, 'このノートに載るのは、仲間が登録した配合だけ。');
  assert.equal(document.activeElement, input('username'));
  // ID は 20 文字まで（register-dialog の D-17）
  assert.equal(input('username').maxLength, 20);
  input('username').value = 'Alice';
  await byText('新規登録').dispatch('click');
  assert.equal(byClass('login-panel').querySelector('h1').textContent, '新規登録');
  assert.equal(byClass('login-lead').textContent, 'ID は配合の登録者名になります（後で変更できます）。パスワードは仲間から聞いた共通のものです。');
  assert.equal(byClass('login-note').textContent, 'このノートに載るのは、仲間が登録した配合だけ。');
  // ID が入っていればパスワードの欄へ
  assert.equal(document.activeElement, input('new-password'));
});

test('画面: 前の ID が残っている端末のログイン画面は、パスワードの欄にフォーカスする', async (t) => {
  await boot(t, { initial: { 'pal-note.userId': 'Alice' } });
  assert.equal(input('username').value, 'Alice');
  assert.equal(document.activeElement, input('current-password'));
});

test('画面: タブの見出し（h1）はタブの名前と同じ（views/tabs.js の TABS から引く。ナビのタブも同じ名前と並び）', async (t) => {
  const { changeHash } = await boot(t, { initial: signedIn, api: createDevelopmentApi({ seed: '2' }), hash: '#/search' });
  const main = document.getElementById('main');
  const tabs = descendants(byClass('navigation')).filter((node) => node.className.split(' ').includes('nav-tab'));
  assert.deepEqual(tabs.map((node) => node.textContent), TABS.map(([, label]) => label));
  for (const [view, label] of TABS) {
    changeHash(`#/${view}`);
    assert.equal(main.querySelector('h1').textContent, label, view);
    assert.equal(navTab(label).getAttribute('aria-current'), 'page', view);
  }
});

test('画面: ベルの下端の「すべての通知を見る →」でパネルを閉じて通知一覧を開き、閉じたらベルへ（「すべて既読」で既読に）', async (t) => {
  const key = 'pal-note.notifications.read.架空データ';
  // お知らせをすべて既読にした端末
  const read = JSON.stringify(releaseNotes.map((note) => `release:${note.id}`));
  const { values } = await boot(t, { initial: { ...signedIn, [key]: read }, api: createDevelopmentApi({ seed: '2' }) });
  const bell = byClass('notification-button');
  await bell.dispatch('click');
  const panel = byClass('notification-panel');
  assert.doesNotMatch(panel.textContent, /設定タブ/);
  await panel.querySelector('.notification-show-all').dispatch('click');
  assert.equal(byClass('notification-panel'), undefined);
  assert.equal(bell.getAttribute('aria-expanded'), 'false');
  const dialog = find((node) => node.tagName === 'dialog' && node.open);
  assert.equal(dialog.querySelector('h2').textContent, '通知一覧');
  assert.equal(dialog.querySelectorAll('.notification-title').length, releaseNotes.length);
  // お知らせはすでに既読なので「すべて既読」は押せない
  assert.equal(dialog.querySelector('.notification-all-read').disabled, true);
  assert.equal(JSON.parse(values.get(key)).length, releaseNotes.length);
  await dialog.querySelectorAll('button').find((node) => node.textContent === '閉じる').dispatch('click');
  assert.equal(document.activeElement, bell);
});

test('画面: キャッシュのない初回の取得に失敗したら、画面に文と「もう一度読み込む」を出し、押すと取り直して結果を出す', async (t) => {
  const development = createDevelopmentApi({ seed: '2' });
  let fail = true;
  const api = (request) => (request.action === 'snapshot' && fail ? { ok: false, code: 'INTERNAL' } : development(request));
  const { calls } = await boot(t, { initial: signedIn, api, hash: '#/search' });
  await flush();
  const main = document.getElementById('main');
  const failed = main.querySelector('.error-state');
  assert.equal(failed.getAttribute('role'), 'alert');
  assert.equal(failed.querySelector('p').textContent, 'サーバでエラーが発生しました。時間をおいてお試しください。');
  // 同じ文は画面（errorState）とヘッダーの同期状況に出ているので、トーストは重ねない（delete-undo）
  assert.equal(byClass('sync-status').textContent, 'サーバでエラーが発生しました。時間をおいてお試しください。');
  assert.equal(document.body.querySelectorAll('.toast').length, 0);
  const snapshots = () => calls.filter((request) => request.action === 'snapshot').length;
  const before = snapshots();
  fail = false;
  await failed.querySelector('button').dispatch('click');
  await flush();
  assert.equal(snapshots(), before + 1);
  assert.equal(main.querySelector('.error-state'), null);
  assert.equal(main.querySelector('.find-count-text').textContent, '2 件');
  assert.ok(main.querySelectorAll('.breeding-card').length > 0);
});

test('画面: 前回の配合を出しているときの取得の失敗は、エラーのトースト（role=alert・×）で知らせる', async (t) => {
  const development = createDevelopmentApi({ seed: '2' });
  const initial = await cachedSignIn(development);
  const api = (request) => (request.action === 'snapshot' ? { ok: false, code: 'INTERNAL' } : development(request));
  await boot(t, { initial, api, hash: '#/search' });
  await flush();
  // 旧 URL（一覧）は配合を探すに読み替える
  assert.equal(location.hash, '#/search');
  const main = document.getElementById('main');
  // 画面は前回の配合のまま（errorState は出さない）
  assert.equal(main.querySelector('.error-state'), null);
  assert.ok(main.querySelectorAll('.breeding-card').length > 0);
  assert.equal(byClass('sync-error').hidden, false);
  assert.equal(byClass('toast-list').children.length, 0);
  const [error] = byClass('toast-alerts').children;
  assert.equal(error.getAttribute('role'), 'alert');
  assert.match(error.textContent, /^サーバでエラーが発生しました/);
  await error.querySelector('.toast-close').dispatch('click');
  assert.equal(byClass('toast-alerts').children.length, 0);
});

test('画面: 親 2 だけを選んだ配合を探すの行を削除するとき、確認のカードの親の左右を押した行とそろえる', async (t) => {
  const { changeHash } = await boot(t, { initial: signedIn, api: createDevelopmentApi({ seed: '2' }), hash: '#/search' });
  const names = (card) => card.querySelector('.breeding-equation').querySelectorAll('.pal-tile').map((tile) => tile.querySelector('strong').textContent);
  const cardsNow = () => descendants(document.getElementById('main')).filter(isCard);
  // 同じ親どうしでない最初の配合の左の親を、親 2 に選ぶ（その親が右に出る）
  const first = cardsNow().find((card) => names(card)[0] !== names(card)[1]);
  const [left, right] = names(first);
  const leftId = pals.find((pal) => pal.ja === left).id;
  changeHash(`#/search?p2=${leftId}`);
  const cards = cardsNow();
  assert.ok(cards.some((card) => names(card)[0] === right && names(card)[1] === left));
  for (const card of cards) {
    const removing = card.querySelector('button[aria-label="削除"]').dispatch('click');
    const dialog = find((node) => node.tagName === 'dialog' && node.open);
    assert.match(dialog.textContent, /仲間の画面からも消えます。削除後 6 秒間は元に戻せます。/);
    assert.deepEqual(names(dialog.querySelector('.breeding-card')), names(card));
    await find((node) => node.tagName === 'button' && node.textContent === 'キャンセル').dispatch('click');
    await removing;
  }
});

test('画面（autoreg-visibility）: 題名は「画面名 · パル配合ノート」（パル詳細はパルの名前、ログイン画面は「パル配合ノート」）', async (t) => {
  const { changeHash } = await boot(t, { initial: signedIn, api: createDevelopmentApi({ seed: '2' }), hash: '#/settings' });
  assert.equal(document.title, '設定 · パル配合ノート');
  changeHash('#/search');
  assert.equal(document.title, '配合を探す · パル配合ノート');
  changeHash('#/pal/SheepBall');
  assert.equal(document.title, 'モコロン · パル配合ノート');
});

test('画面（autoreg-visibility）: 自動の読み込みが止まっている（登録なし・読めない・許可待ち）と、所持パルのタブに「!」と読み上げの文', async (t) => {
  // 前の版で連携をオンにしたまま、登録したワールドがない（所持パルを開くと読みに行き、登録なしで止まる）
  const { values } = await boot(t, { initial: { ...signedIn, 'pal-note.owned.bridge': JSON.stringify({ enabled: true }) }, api: createDevelopmentApi({ seed: '2' }), hash: '#/owned' });
  for (let i = 0; i < 10; i++) await flush();
  // タブの文字は「所持パル!」になるので data-view で探す（読み上げは aria-label）
  const tab = find((node) => node.className.split(' ').includes('nav-tab') && node.getAttribute('data-view') === 'owned');
  const badge = tab.querySelector('.nav-badge');
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, '!');
  assert.equal(tab.getAttribute('aria-label'), '所持パル（読み込みが止まっています）');
  assert.equal(JSON.parse(values.get('pal-note.owned.bridge')).enabled, true);
});

test('画面（settings）: 整合性の警告が 1 件以上なら設定のタブに数のバッジと読み上げの文、行き先は警告のカード（#/settings?open=warnings。同じ警告では 1 回だけ）', async (t) => {
  const development = createDevelopmentApi({ seed: '2' });
  let warnings = [{ code: 'UNKNOWN_PAL', rowNumber: 3 }];
  const api = async (request) => {
    const response = await development(request);
    // 全件の応答（snapshot の action は全件をそのまま、ほかの操作は snapshot の中に返す）に警告を入れる
    if (Array.isArray(response.warnings)) response.warnings = warnings;
    if (response.snapshot) response.snapshot.warnings = warnings;
    return response;
  };
  const { changeHash } = await boot(t, { initial: signedIn, api, hash: '#/search' });
  for (let i = 0; i < 5; i++) await flush();
  const tab = find((node) => node.className.split(' ').includes('nav-tab') && node.getAttribute('data-view') === 'settings');
  const badge = tab.querySelector('.nav-badge');
  assert.deepEqual([badge.hidden, badge.textContent], [false, '1']);
  assert.equal(tab.getAttribute('aria-label'), '設定（整合性の警告 1 件）');
  assert.equal(tab.href, '#/settings?open=warnings');
  // 設定では警告のカードが出て、見出しに件数
  changeHash('#/settings?open=warnings');
  const card = byClass('settings-warnings');
  assert.equal(card.hidden, false);
  assert.equal(card.querySelector('h3').textContent, '整合性の警告（1 件）');
  // 読んだら URL から open を外す
  assert.equal(location.hash, '#/settings');
  // 見出しへフォーカスを移すのは描いた後（次の回）
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.activeElement, card.querySelector('h3'));
  // 見た警告のあいだは、設定のタブは覚えた行き先へ（毎回警告のカードへ戻さない）。警告が変わったらまた警告のカードへ
  changeHash('#/search');
  assert.equal(tab.href, '#/settings');
  warnings = [{ code: 'UNKNOWN_PAL', rowNumber: 3 }, { code: 'UNKNOWN_PAL', rowNumber: 4 }];
  await byClass('sync-status').dispatch('click');
  for (let i = 0; i < 5; i++) await flush();
  assert.equal(badge.textContent, '2');
  assert.equal(tab.href, '#/settings?open=warnings');
});
