import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDevelopmentApi } from '../../dev/mock-api.js';
import { FakeElement, descendants, installResizeObserver } from '../helpers/dom.js';
import releaseNotes from '../../web/js/release-notes.js';
import pals from '../../web/data/pals.js';
import { OWNED_FIELDS } from '../../web/js/core/owned-shared.js';

const find = (predicate) => descendants(document.body).find(predicate);
const byClass = (name) => find((node) => node.className.split(' ').includes(name));
const byText = (text) => find((node) => node.tagName === 'button' && node.textContent === text);
const input = (autocomplete) => find((node) => node.autocomplete === autocomplete);
const flush = () => new Promise((resolve) => setImmediate(resolve));
// 親の並び順は 1 件を親ごとに展開するため、1 件 1 枚で数えたい確認では更新日順に切り替える。
async function sortOneCardPerRecord() {
  const sort = find((node) => node.tagName === 'select');
  sort.value = 'updated';
  await sort.dispatch('input');
}
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
  globalThis.document = {
    body, createElement: (name) => new FakeElement(name), createElementNS: (namespace, name) => new FakeElement(name),
    getElementById: (id) => descendants(body).find((node) => node.id === id),
    addEventListener() {}, querySelectorAll: (selector) => body.querySelectorAll(selector),
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
    ...resizing, values, sessionValues, scrolls, calls, ownedCalls, replacements, replaceStates, pushes, events, intervals, changeHash,
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
const signedInParts = ['navigation', 'register-button', 'notification-menu', 'save-status', 'account-chip', 'sync-line'];
// 読み上げで読まれる文（hidden・aria-hidden・inert の中は読まれない）
const readable = (node) => (node.hidden || node.inert || node.getAttribute('aria-hidden') === 'true'
  ? '' : node.text + node.children.map(readable).join(''));

function assertLoginOnly() {
  assert.ok(byClass('login-form'));
  assert.equal(byClass('app-footer'), undefined);
  for (const name of signedInParts) assert.equal(byClass(name).hidden, true, name);
  assert.equal(byClass('sync-status').disabled, true);
  assert.equal(byClass('brand').inert, true);
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
  assert.match(byClass('form-errors').textContent, /登録されていません/);
  // ログインのエラーはフォームにだけ出す（ヘッダーの同期状況は隠したまま）
  assertLoginOnly();
  assert.equal(values.has('pal-note.passcode'), false);
  await byText('新規登録').dispatch('click');
  assert.equal(find((node) => node.tagName === 'h1').textContent, '新規登録');
  assert.equal(input('username').value, 'ＡｂＣ');
  input('username').value = 'あ'.repeat(21);
  input('new-password').value = '入力';
  await byText('登録してログイン').dispatch('click');
  assert.match(byClass('form-errors').textContent, /20文字以内/);
  input('username').value = 'ＡｂＣ';
  await byText('登録してログイン').dispatch('click');
  assert.equal(byClass('login-form'), undefined);
  for (const name of signedInParts) assert.equal(byClass(name).hidden, false, name);
  assert.equal(byClass('brand').inert, false);
  assert.equal(byClass('sync-status').disabled, false);
  assert.equal(byClass('account-button').textContent, 'ＡｂＣ');
  const settings = byClass('settings-view');
  assert.match(settings.textContent, /ログイン中の ID: ＡｂＣ/);
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

test('画面: 一覧の削除アイコンから確認・キャンセル・削除・元に戻すを行う', async (t) => {
  const { calls } = await boot(t, {
    initial: { 'pal-note.userId': '架空データ', 'pal-note.passcode': '入力' },
    api: createDevelopmentApi({ seed: '2' }), hash: '#/list',
  });
  const cards = () => descendants(document.body).filter((node) => node.className === 'breeding-card');
  await sortOneCardPerRecord();
  const remove = () => find((node) => node.tagName === 'button' && node.getAttribute('aria-label') === '削除');
  assert.equal(cards().length, 2);
  assert.equal(byClass('app-footer'), undefined);
  assert.match(byClass('brand').textContent, /仲間と残す、冒険の発見。/);
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
  const { calls } = await boot(t, { initial: { 'pal-note.userId': '架空データ', 'pal-note.passcode': '入力' }, api, hash: '#/list' });
  await sortOneCardPerRecord();
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

test('画面: 削除が失敗したら一覧に戻し、削除の知らせと元に戻すは出さずに失敗だけを知らせる', async (t) => {
  const development = createDevelopmentApi({ seed: '2' });
  const api = async (request) => request.action === 'delete' ? { ok: false, code: 'INTERNAL' } : development(request);
  const { calls } = await boot(t, { initial: { 'pal-note.userId': '架空データ', 'pal-note.passcode': '入力' }, api, hash: '#/list' });
  const cards = () => descendants(document.body).filter((node) => node.className === 'breeding-card');
  await sortOneCardPerRecord();
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

test('画面: 削除は応答前に一覧から消し、送信待ちの間だけページを閉じる前に確認する', async (t) => {
  const development = createDevelopmentApi({ seed: '2' });
  let release;
  const api = async (request) => {
    if (request.action === 'delete') await new Promise((resolve) => { release = resolve; });
    return development(request);
  };
  const { events } = await boot(t, { initial: { 'pal-note.userId': '架空データ', 'pal-note.passcode': '入力' }, api, hash: '#/list' });
  const cards = () => descendants(document.body).filter((node) => node.className === 'breeding-card');
  await sortOneCardPerRecord();
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

test('画面: ヘッダーは 1 行に ロゴ → テスト環境 → 同期状況 → セーブ連携 → ベル → 登録 → ID の順で並ぶ（Tab の順）', async (t) => {
  await boot(t, { initial: { 'pal-note.userId': '架空データ', 'pal-note.passcode': '入力' }, api: createDevelopmentApi({ seed: '2' }), hash: '#/list' });
  const header = byClass('app-header');
  assert.deepEqual(header.children.map((node) => node.className.split(' ')[0]),
    ['brand', 'env-chip', 'header-status', 'save-status', 'notification-menu', 'register-button', 'account-chip']);
  assert.equal(byClass('header-actions'), undefined);
  assert.equal(byClass('environment-banner'), undefined);
  // ベル・登録はヘッダーの中（main より前）にあり、ルートの子はスキップリンク・ヘッダー・ナビ・更新の帯・本文だけ
  assert.deepEqual(document.getElementById('app').children.map((node) => node.className.split(' ')[0]),
    ['skip-link', 'app-header', 'navigation', 'update-banner', 'app-main']);
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
  assert.equal(byClass('account-button').getAttribute('aria-label'), 'ログイン中の ID: 架空データ（名前の変更・ログアウト）');
  // メニューの中身は開いたときだけ作る（設定タブの「ログアウト」と取り違えない）
  assert.equal(byClass('account-panel'), undefined);
});

test('画面: ヘッダーのパネル（ベル・セーブ連携・ID）は、どれかを開くとほかを閉じ、ボタンの aria-controls は開いている間だけ付ける', async (t) => {
  await boot(t, { initial: { 'pal-note.userId': '架空データ', 'pal-note.passcode': '入力' }, api: createDevelopmentApi({ seed: '2' }), hash: '#/list' });
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
  const { calls } = await boot(t, { initial: { 'pal-note.userId': '架空データ', 'pal-note.passcode': '入力' }, api, hash: '#/list' });
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
  await boot(t, { initial: { 'pal-note.userId': '架空データ', 'pal-note.passcode': '入力' }, api, hash: '#/list' });
  await sortOneCardPerRecord();
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
  ['#/reverse?c=SheepBall', '#/reverse', '生まれる子'],
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
  assert.equal(navTab('配合検索').href, '#/search?p1=SheepBall&p2=PinkCat');
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
  changeHash('#/reverse?c=SheepBall');
  assert.notEqual(main.children[0], search);
  assert.equal(search.isConnected, false);
  assert.match(main.textContent, /この子の親を探す/);
  changeHash('#/pal/SheepBall');
  const sheep = main.children[0];
  changeHash('#/pal/FlowerDoll');
  assert.notEqual(main.children[0], sheep);
  assert.equal(sheep.isConnected, false);
  assert.match(main.querySelector('.pal-hero').textContent, /フラリーナ/);
});

test('画面: ログアウトしてから同じ URL でログインし直すと、画面を作り直して前の選択を引き継がない', async (t) => {
  const { changeHash } = await boot(t, { initial: signedIn, api: createDevelopmentApi({ seed: '2' }), hash: '#/search?p1=SheepBall' });
  const main = document.getElementById('main');
  const before = main.children[0];
  await choosePal(before.querySelectorAll('.picker')[1], 'ツッパニャン');
  assert.equal(main.children[0], before);
  assert.equal(navTab('配合検索').href, '#/search?p1=SheepBall&p2=PinkCat');
  changeHash('#/settings');
  const logout = byText('ログアウト').dispatch('click');
  await descendants(find((node) => node.tagName === 'dialog')).find((node) => node.tagName === 'button' && node.textContent === 'ログアウト').dispatch('click');
  await logout;
  assertLoginOnly();
  assert.equal(navTab('配合検索').href, '#/search');
  changeHash('#/search?p1=SheepBall');
  assertLoginOnly();
  input('current-password').value = '入力';
  await byText('ログイン').dispatch('click');
  const after = main.children[0];
  assert.notEqual(after, before);
  assert.deepEqual(after.querySelectorAll('.picker-trigger').map((node) => node.getAttribute('aria-label')), ['親1: No.1 モコロン', '親2: パルを選択']);
  assert.equal(navTab('配合検索').href, '#/search?p1=SheepBall');
});

test('画面: 不正な ID を URL から外すときは履歴の state を消さず、外した後の URL から同じ画面のまま選び直せる', async (t) => {
  const { changeHash, replaceStates } = await boot(t, { initial: signedIn, api: createDevelopmentApi({ seed: '2' }), hash: '#/search' });
  history.state = { palEntry: '前のエントリ' };
  changeHash('#/reverse?c=存在しない');
  assert.equal(location.hash, '#/reverse');
  assert.deepEqual(replaceStates.at(-1), { palEntry: '前のエントリ' });
  assert.equal(history.state.palEntry, '前のエントリ');
  assert.equal(navTab('逆引き').href, '#/reverse');
  const view = document.getElementById('main').children[0];
  await choosePal(view.querySelector('.picker'), 'モコロン');
  assert.equal(location.hash, '#/reverse?c=SheepBall');
  assert.equal(document.getElementById('main').children[0], view);
});

test('画面: タブを切り替えても選んだパルと絞り込みを残し、ログアウトすると忘れる', async (t) => {
  const { changeHash } = await boot(t, {
    initial: { 'pal-note.userId': '架空データ', 'pal-note.passcode': '入力' },
    api: createDevelopmentApi({ seed: '2' }), hash: '#/search?p1=SheepBall',
  });
  const tab = (label) => find((node) => node.className.split(' ').includes('nav-tab') && node.textContent.endsWith(label));
  const registrant = () => find((node) => node.placeholder === '登録者名で絞り込む');
  changeHash(tab('一覧').href);
  assert.equal(location.hash, '#/list');
  registrant().value = '該当なし';
  await registrant().dispatch('input');
  // 登録者名の入力は間引くので、確定（change）で絞り込む
  await registrant().dispatch('change');
  assert.match(document.body.textContent, /条件に合う登録はありません/);
  // 配合検索のタブとロゴは、前に選んだ親のままの画面へ戻る
  assert.equal(tab('配合検索').href, '#/search?p1=SheepBall');
  assert.equal(byClass('brand').href, '#/search?p1=SheepBall');
  changeHash(tab('配合検索').href);
  assert.ok(find((node) => node.getAttribute('aria-label') === '親1の選択を解除'));
  changeHash(tab('一覧').href);
  assert.equal(registrant().value, '該当なし');
  assert.match(document.body.textContent, /条件に合う登録はありません/);
  // 不正な ID を URL から消したら、タブにも消した後の URL を覚える
  changeHash('#/reverse?c=存在しない');
  assert.equal(tab('逆引き').href, '#/reverse');
  changeHash('#/settings');
  const logout = byText('ログアウト').dispatch('click');
  const confirm = find((node) => node.tagName === 'dialog');
  await descendants(confirm).find((node) => node.tagName === 'button' && node.textContent === 'ログアウト').dispatch('click');
  await logout;
  assertLoginOnly();
  assert.equal(tab('配合検索').href, '#/search');
  assert.equal(tab('一覧').href, '#/list');
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
    changeHash('#/list');
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

test('画面: 下書きタブで下書きを作って端末に保存し、登録すると一覧の記録に加わる', async (t) => {
  const { values, calls, events } = await boot(t, {
    initial: { 'pal-note.userId': '架空データ', 'pal-note.passcode': '入力' },
    api: createDevelopmentApi({ seed: '2' }), hash: '#/drafts',
  });
  const tab = find((node) => node.className.split(' ').includes('nav-tab') && node.textContent.includes('下書き'));
  assert.equal(tab.getAttribute('aria-current'), 'page');
  assert.ok(byClass('drafts-view'));
  const key = 'pal-note.drafts.test.架空データ';
  await byText('＋ 下書きに登録').dispatch('click');
  const dialog = find((node) => node.tagName === 'dialog' && node.open);
  assert.equal(dialog.querySelector('h2').textContent, '下書きに登録');
  dialog.querySelector('textarea').value = 'あとで確認';
  await byText('下書きに保存').dispatch('click');
  assert.equal(JSON.parse(values.get(key))[0].memo, 'あとで確認');
  assert.equal(calls.filter((call) => call.action === 'create').length, 0);
  // 別のタブで書き換わった下書きを読み直す。
  const id = crypto.randomUUID();
  values.set(key, JSON.stringify([{ id, parent1Id: 'Alpaca', parent2Id: 'Boar', childId: 'Deer', registrant: '架空データ', memo: '' }]));
  events.get('storage')({ key });
  const rows = () => descendants(document.body).filter((node) => node.className.split(' ').includes('draft-row'));
  assert.equal(rows().length, 1);
  await byText('登録').dispatch('click');
  assert.equal(rows().length, 0);
  assert.deepEqual(JSON.parse(values.get(key)), []);
  assert.equal(calls.at(-1).action, 'create');
  assert.ok(JSON.parse(values.get('pal-note.cache.test')).records.some((record) => record.parent1Id === 'Alpaca' && record.childId === 'Deer'));
});

test('画面: 右上のベルに未読の数を出し、開くと既読にして、既読も設定タブの通知一覧で見られる', async (t) => {
  const { values, events } = await boot(t, {
    initial: { 'pal-note.userId': '架空データ', 'pal-note.passcode': '入力' }, api: createDevelopmentApi({ seed: '2' }),
  });
  const key = 'pal-note.notifications.read.架空データ';
  const bell = byClass('notification-button');
  const badge = byClass('notification-badge');
  const titles = (node) => node.querySelectorAll('.notification-title').map((title) => title.textContent);
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, String(releaseNotes.length));
  assert.equal(bell.getAttribute('aria-label'), `通知（未読 ${releaseNotes.length} 件）`);
  await bell.dispatch('click');
  assert.equal(bell.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(titles(byClass('notification-panel')), releaseNotes.map((note) => note.title));
  assert.equal(badge.hidden, true);
  assert.equal(bell.getAttribute('aria-label'), '通知');
  assert.equal(JSON.parse(values.get(key)).length, releaseNotes.length);
  await bell.dispatch('click');
  assert.equal(byClass('notification-panel'), undefined);
  assert.equal(bell.getAttribute('aria-expanded'), 'false');
  await bell.dispatch('click');
  assert.match(byClass('notification-panel').textContent, /新しい通知はありません/);
  await bell.dispatch('click');
  // 別のタブで既読が書き換わったら読み直す。
  values.set(key, JSON.stringify([`release:${releaseNotes[0].id}`]));
  events.get('storage')({ key });
  assert.equal(badge.textContent, String(releaseNotes.length - 1));
  await byText('通知一覧').dispatch('click');
  const dialog = find((node) => node.tagName === 'dialog' && node.open);
  assert.deepEqual(titles(dialog), releaseNotes.map((note) => note.title));
  assert.equal(dialog.querySelectorAll('.unread-chip').length, releaseNotes.length - 1);
  assert.equal(badge.hidden, true);
  // 画面には更新の帯の「閉じる」もあるため、通知一覧の中のボタンを押す
  await dialog.querySelectorAll('button').find((node) => node.textContent === '閉じる').dispatch('click');
  assert.equal(dialog.open, false);
});

test('画面: ウィッシュリストに追加したパルが作れるようになったらベルで知らせ、通知と一覧から逆引きへのリンクを出す', async (t) => {
  const development = createDevelopmentApi({ seed: '2' });
  let second = 0;
  // 同じミリ秒の応答で判定が止まらないよう、サーバ時刻を 1 秒ずつ進める。
  const api = async (request) => {
    const response = await development(request);
    if (typeof response.serverTime === 'string') response.serverTime = new Date(Date.UTC(2026, 9, 4, 0, 0, ++second)).toISOString();
    if (response.snapshot) response.snapshot.serverTime = new Date(Date.UTC(2026, 9, 4, 0, 0, ++second)).toISOString();
    return response;
  };
  const { values, changeHash } = await boot(t, {
    initial: { 'pal-note.userId': '架空データ', 'pal-note.passcode': '入力' }, api, hash: '#/wishlist',
  });
  const tab = find((node) => node.className.split(' ').includes('nav-tab') && node.textContent.includes('ウィッシュリスト'));
  assert.equal(tab.getAttribute('aria-current'), 'page');
  const made = new Set(JSON.parse(values.get('pal-note.cache.test')).records.map((record) => record.childId));
  const target = pals.find((pal) => pal.active && !made.has(pal.id));
  const picker = byClass('wishlist-view').querySelector('.picker');
  await picker.querySelector('.picker-trigger').dispatch('click');
  const search = picker.querySelector('input');
  search.value = target.ja;
  await search.dispatch('input');
  await picker.querySelectorAll('[role="option"]').find((option) => option.textContent.includes(target.ja)).dispatch('click');
  assert.match(byClass('wishlist-row').textContent, /まだ作れません/);
  assert.deepEqual(JSON.parse(values.get('pal-note.wishlist.test.架空データ')).map((wish) => wish.palId), [target.id]);
  const badge = byClass('notification-badge');
  const unread = Number(badge.textContent);
  // 仲間がほかの端末で登録し、こちらは最新の記録を取り直す。
  await development({ action: 'create', passcode: '入力', opId: crypto.randomUUID(), allowDifferentChild: true, record: {
    id: crypto.randomUUID(), parent1Id: 'SheepBall', parent2Id: 'FlowerDoll', childId: target.id,
    parent1Gender: '', parent2Gender: '', registrant: '仲間', memo: '',
  } });
  changeHash('#/settings');
  await byText('最新に更新').dispatch('click');
  await flush();
  assert.equal(badge.textContent, String(unread + 1));
  await byClass('notification-button').dispatch('click');
  const panel = byClass('notification-panel');
  const link = panel.querySelector('.notification-link');
  assert.equal(link.querySelector('.notification-title').textContent, `${target.ja}が作成可能になりました`);
  assert.equal(link.href, `#/reverse?c=${target.id}`);
  // fake DOM はリンクの既定動作（ハッシュの切り替え）を持たないため、閉じることまでを確かめ、遷移は実ブラウザで確かめる。
  await link.dispatch('click');
  assert.equal(byClass('notification-panel'), undefined);
  changeHash('#/wishlist');
  const row = byClass('wishlist-row');
  assert.match(row.textContent, /作成可能/);
  assert.equal(row.querySelector('a').href, `#/reverse?c=${target.id}`);
});

test('画面: 設定から名前を変えると、ログイン中の ID・登録者名が新しい名前になり、前の ID のエントリと保存を消す', async (t) => {
  const { values, calls, sessionValues, events } = await boot(t, { session: {} });
  await byText('新規登録').dispatch('click');
  input('username').value = 'Taro';
  input('new-password').value = '入力';
  await byText('登録してログイン').dispatch('click');
  assert.match(byClass('settings-view').textContent, /これまでの配合の登録者名もすべて新しい名前になります/);
  const dialogInput = () => descendants(find((node) => node.tagName === 'dialog' && node.open)).find((node) => node.tagName === 'input');
  byText('名前を変更').dispatch('click');
  assert.equal(dialogInput().value, 'Taro');
  dialogInput().value = 'あ'.repeat(21);
  await byText('変更する').dispatch('click');
  await flush();
  assert.match(byClass('form-errors').textContent, /20文字以内/);
  events.get('pagehide')();
  assert.ok(sessionValues.has('pal-note.entries'));
  assert.ok(sessionValues.has('pal-note.views'));
  dialogInput().value = 'Jiro';
  await byText('変更する').dispatch('click');
  await flush();
  assert.equal(find((node) => node.tagName === 'dialog' && node.open), undefined);
  assert.match(byClass('settings-view').textContent, /ログイン中の ID: Jiro/);
  // 完了したら「終わっていません」の表示を残さず、ログアウトもできる
  assert.doesNotMatch(byClass('settings-view').textContent, /終わっていません/);
  assert.equal(byText('名前を変更').hidden, false);
  assert.equal(byText('名前の変更を再試行').hidden, true);
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
  // 登録の画面を開く
  await byClass('register-button').dispatch('click');
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

// 開発 API に 1 ワールドの所持パルを共有しておく（所持者のプレイヤーは PLAYER）。extra で個体の列を書き換える
async function shareWorld(development, worldId, extra = {}) {
  const row = Object.fromEntries(OWNED_FIELDS.map((field) => [field, '']));
  Object.assign(row, { instanceId: `pal-${worldId.slice(0, 4)}`, palId: 'SheepBall', palName: 'モコロン', gender: 'M', level: '10', rank: '1', stars: '0',
    talentHp: '50', talentShot: '50', talentDefense: '50', lucky: 'false', alpha: 'false', egg: 'false', place: 'palbox', placeLabel: 'パルボックス',
    holderUid: PLAYER, holder: 'アリス' }, extra);
  const response = await development({
    action: 'ownedUpload', passcode: '入力', userId: '架空データ', worldId, world: { name: 'ワールド', hostName: 'アリス' },
    saveUpdatedAt: new Date().toISOString(), players: [{ uid: PLAYER, name: 'アリス' }], bases: [], farms: [],
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
  await tab('一覧');
  assert.deepEqual(scrolls, [0]);
  window.scrollY = 2500;
  await tab('配合検索');
  assert.deepEqual(scrolls, [0, 0]);
  window.scrollY = 400;
  await tab('一覧');
  assert.equal(scrolls.at(-1), 2500);
  await tab('配合検索');
  assert.equal(scrolls.at(-1), 400);
  // 本文のリンク（カードのパル名）で詳細へ移ると先頭から
  window.scrollY = 500;
  const palLink = find((node) => node.tagName === 'a' && String(node.href).startsWith('#/pal/'));
  assert.ok(palLink);
  await clickLink(palLink);
  go(palLink.href);
  await frame();
  assert.equal(scrolls.at(-1), 0);
  assert.ok(document.getElementById('main').querySelector('.pal-hero'));
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
  // 条件 X（所持者「自分の個体」・HP 50）で 300px まで読んでから、配合検索へ
  const holder = selectHaving('mine');
  holder.value = 'mine';
  await holder.dispatch('change');
  await setTarget('HPの目標', '50');
  window.scrollY = 300;
  await clickLink(navTab('配合検索'));
  go(navTab('配合検索').href);
  const second = history.state.palEntry;
  assert.notEqual(second, first);
  assert.deepEqual(entriesOf(sessionValues).find((entry) => entry.id === first).cond, { holder: 'mine', mode: 'include', targets: { hp: 50, shot: 100, defense: 100 }, cake: 'none' });
  // 理想個体のタブで戻って条件 Y（HP 70）にする（新しいエントリ）
  await clickLink(navTab('理想個体'));
  go(navTab('理想個体').href);
  await setTarget('HPの目標', '70');
  assert.equal(inputLabeled('HPの目標').value, '70');
  // 2 回戻ると、最初のエントリの条件 X と位置に戻る
  back('#/search', { palEntry: second });
  back('#/ideal?to=SheepBall', { palEntry: first });
  await frame();
  assert.equal(inputLabeled('HPの目標').value, '50');
  assert.equal(selectHaving('mine').value, 'mine');
  assert.equal(scrolls.at(-1), 300);
  // 別の利用者・別の環境・保存の形の版が違うエントリは使わない（画面には今の条件が残る。ワールドは次のテスト）
  await setTarget('HPの目標', '80');
  for (const change of [{ user: '別の人' }, { env: 'prod' }, { v: 2 }]) {
    const entries = entriesOf(sessionValues).map((entry) => (entry.id === first ? { ...entry, ...change, cond: { ...entry.cond, targets: { hp: 10, shot: 100, defense: 100 } } } : entry));
    sessionValues.set('pal-note.entries', JSON.stringify(entries));
    back('#/search', { palEntry: second });
    back('#/ideal?to=SheepBall', { palEntry: first });
    assert.equal(inputLabeled('HPの目標').value, '80', JSON.stringify(change));
  }
});

test('画面: 戻る・進むのエントリは、表示中のワールドと違うワールドで書いたものを使わない', async (t) => {
  const development = createDevelopmentApi({ seed: '2' });
  await shareWorld(development, WORLD_B);
  const { back, sessionValues } = await boot(t, { initial: signedIn, api: development, hash: '#/owned', session: {} });
  await untilShared();
  const entry = (world, registrant) => ({ v: 1, id: `list-${world}`, env: 'test', user: '架空データ', world, view: 'list', key: '#/list', cond: { registrant, sort: '' }, scrollY: 0, at: 1 });
  sessionValues.set('pal-note.entries', JSON.stringify([entry(WORLD_A, '別のワールド'), entry(WORLD_B, '同じワールド')]));
  const registrant = () => find((node) => node.placeholder === '登録者名で絞り込む');
  back('#/list', { palEntry: `list-${WORLD_A}` });
  assert.equal(registrant().value, '');
  back('#/owned', { palEntry: 'x' });
  back('#/list', { palEntry: `list-${WORLD_B}` });
  assert.equal(registrant().value, '同じワールド');
});

test('画面: 読み込み直したら、同じタブで保存した所持パルの絞り込み・理想個体の条件・一覧の並べ替えに戻し、形の合わない項目は既定に戻す', async (t) => {
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
  assert.deepEqual(chips, { party: 'true', palbox: 'true', base: 'true', dps: 'true', global: 'true', egg: 'false', unknown: 'true' });
  assert.ok(find((node) => node.getAttribute('aria-label') === 'パル: No.1 モコロン'));
  // パッシブは文字列の ID だけ
  assert.ok(find((node) => node.getAttribute('data-focus-key') === 'passive-chip:パッシブ:Legend'));
  assert.equal(descendants(document.getElementById('main')).filter((node) => String(node.getAttribute('data-focus-key')).startsWith('passive-chip:')).length, 1);
  assert.equal(navTab('配合検索').href, '#/search?p1=SheepBall');
  assert.equal(navTab('一覧').href, '#/list');
  go('#/ideal?to=SheepBall');
  assert.deepEqual(['HPの目標', '攻撃の目標', '防御の目標'].map((label) => inputLabeled(label).value), ['90', '100', '80']);
  assert.equal(radioChecked('パッシブの条件'), 'only');
  assert.equal(radioChecked('ケーキ'), 'talent');
  assert.equal(selectHaving('mine').value, 'mine');
  go('#/list');
  assert.equal(find((node) => node.placeholder === '登録者名で絞り込む').value, 'ボブ');
  assert.equal(selectHaving('updated').value, 'updated');
});

for (const change of [{ v: 2 }, { env: 'prod' }, { user: '別の人' }]) {
  test(`画面: 読み込み直したときの保存は、${JSON.stringify(change)} が違えば使わない`, async (t) => {
    const development = createDevelopmentApi({ seed: '2' });
    const saved = { v: 1, env: 'test', user: '架空データ', world: '', views: { list: { registrant: 'ボブ', sort: 'updated' } }, tabs: {}, ...change };
    await boot(t, { initial: await cachedSignIn(development), api: development, hash: '#/list', session: { 'pal-note.views': JSON.stringify(saved) } });
    assert.equal(find((node) => node.placeholder === '登録者名で絞り込む').value, '');
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
for (const [hash, last, expected] of [['', 'owned', '#/owned'], ['#/', 'list', '#/list'], ['#/settings', 'owned', '#/settings'], ['', 'pal', ''], ['', '知らない', '']]) {
  test(`画面: 最後に開いたタブが ${last} で「${hash}」を開くと ${expected || 'ハッシュなし（配合検索）'} から始める`, async (t) => {
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
  const { values, sessionValues, events, changeHash } = await boot(t, { initial: signedIn, api: createDevelopmentApi({ seed: '2' }), hash: '#/list', session: {} });
  const registrant = find((node) => node.placeholder === '登録者名で絞り込む');
  registrant.value = 'ボブ';
  await registrant.dispatch('input');
  await registrant.dispatch('change');
  events.get('pagehide')();
  const saved = JSON.parse(sessionValues.get('pal-note.views'));
  assert.deepEqual([saved.v, saved.env, saved.user, saved.views.list], [1, 'test', '架空データ', { registrant: 'ボブ', sort: 'parent-dex' }]);
  assert.equal(saved.tabs.list, '#/list');
  // 保存するのは条件と位置だけ（パスワード・記録の中身は入れない）
  assert.doesNotMatch(sessionValues.get('pal-note.views') + sessionValues.get('pal-note.entries'), /入力|動作確認用/);
  const [entry] = entriesOf(sessionValues);
  assert.deepEqual([entry.id, entry.view, entry.key, entry.cond], [history.state.palEntry, 'list', '#/list', { registrant: 'ボブ', sort: 'parent-dex' }]);
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
  // 配合検索の親 1 の選択欄 → 逆引き（同じ役目の部品がない）
  find((node) => node.getAttribute('aria-label') === '親1: No.1 モコロン').focus();
  back('#/reverse?c=SheepBall', null);
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
  const hp = () => inputLabeled('HPの目標');
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
  const { go, sessionValues } = await boot(t, { initial: signedIn, api: createDevelopmentApi({ seed: '2' }), hash: '#/list', session: {} });
  const first = history.state.palEntry;
  const registrant = find((node) => node.placeholder === '登録者名で絞り込む');
  const list = byClass('card-stack');
  assert.ok(list.querySelectorAll('.breeding-card').length > 0);
  registrant.value = '該当なし';
  await registrant.dispatch('input');
  await clickLink(navTab('配合検索'));
  go(navTab('配合検索').href);
  assert.equal(list.isConnected, false);
  assert.deepEqual(entriesOf(sessionValues).find((entry) => entry.id === first).cond, { registrant: '該当なし', sort: 'parent-dex' });
  // 間引きの時間が過ぎても、閉じた一覧は描き直さない
  const left = list.querySelectorAll('.breeding-card').length;
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(list.querySelectorAll('.breeding-card').length, left);
});

test('画面: 同じ URL のエントリどうし（理想個体の「呼び出す」で g を外す）を戻る・進むと、hashchange が来なくてもエントリの条件に戻す', async (t) => {
  const { go, back } = await boot(t, { initial: signedIn, api: createDevelopmentApi({ seed: '2' }), hash: '#/ideal?to=SheepBall', session: {}, pushState: true });
  const hp = () => inputLabeled('HPの目標');
  const setHp = async (value) => {
    hp().value = value;
    await hp().dispatch('input');
    await hp().dispatch('change');
  };
  const first = history.state.palEntry;
  // HP 50 の条件を目標として保存してから、HP 70 にする
  await setHp('50');
  await byText('☆ 目標として保存').dispatch('click');
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
  await clickLink(navTab('一覧'));
  go(navTab('一覧').href);
  const list = main.children[0];
  assert.notEqual(list, search);
  history.state = { palEntry: start };
  location.hash = '#/search';
  events.get('popstate')?.();
  assert.equal(main.children[0], list);
  events.get('hashchange')();
  const shown = main.children[0];
  assert.notEqual(shown, list);
  assert.match(shown.textContent, /配合を見つけよう/);
  // 同じエントリ・同じ URL の popstate（読み込んだときなど）では描き直さない
  events.get('popstate')?.();
  assert.equal(main.children[0], shown);
});

test('画面: 中身の無いエントリ（50 件の上限・名前の変更で消えた）へ戻る・進むで違う画面に移ると先頭から、同じ画面なら動かさない', async (t) => {
  const { go, back, scrolls, sessionValues } = await boot(t, { initial: signedIn, api: createDevelopmentApi({ seed: '2' }), hash: '#/list', session: {}, scroll: true });
  const listEntry = history.state.palEntry;
  await clickLink(navTab('配合検索'));
  go(navTab('配合検索').href);
  await frame();
  window.scrollY = 800;
  sessionValues.delete('pal-note.entries');
  const before = scrolls.length;
  back('#/list', { palEntry: listEntry });
  await frame();
  assert.deepEqual(scrolls.slice(before), [0]);
  // 同じ画面の中（URL だけ違う）では動かさない
  window.scrollY = 300;
  sessionValues.delete('pal-note.entries');
  back('#/list?x=1', { palEntry: '消えたエントリ' });
  await frame();
  assert.deepEqual(scrolls.slice(before), [0]);
});
