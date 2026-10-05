import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDevelopmentApi } from '../../dev/mock-api.js';
import { FakeElement, descendants } from '../helpers/dom.js';
import releaseNotes from '../../web/js/release-notes.js';
import pals from '../../web/data/pals.js';

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

async function boot(t, { initial = {}, api = createDevelopmentApi(), hash = '#/settings' } = {}) {
  for (const name of ['document', 'window', 'location', 'history', 'fetch']) {
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
  };
  const values = new Map(Object.entries(initial));
  const events = new Map();
  globalThis.window = {
    localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) },
    addEventListener: (name, handler) => events.set(name, handler),
  };
  globalThis.location = { hostname: 'example.test', hash, search: '?k=旧招待値', pathname: '/Pal/' };
  window.location = location;
  const replacements = [];
  globalThis.history = {
    state: null,
    replaceState(state, title, url) {
      replacements.push(url);
      const next = new URL(url, 'https://example.test');
      Object.assign(location, { pathname: next.pathname, search: next.search, hash: next.hash });
    },
  };
  window.history = history;
  const calls = [];
  // 所持パルの共有（owned*）は配合の操作と別に数える
  const ownedCalls = [];
  globalThis.fetch = async (url, options) => {
    const request = JSON.parse(options.body);
    (request.action.startsWith('owned') ? ownedCalls : calls).push(request);
    return { ok: true, json: async () => api(request) };
  };
  await import(`../../web/js/app.js?case=${++imports}`);
  assert.equal(byClass('startup-error'), undefined);
  return { values, calls, ownedCalls, replacements, events, changeHash(next) { location.hash = next; events.get('hashchange')(); } };
}

function assertLoginOnly() {
  assert.ok(byClass('login-form'));
  assert.equal(byClass('app-footer'), undefined);
  for (const name of ['navigation', 'register-button', 'notification-menu']) assert.equal(byClass(name).hidden, true);
  assert.equal(byClass('brand').inert, true);
}

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
  for (const name of ['navigation', 'register-button', 'notification-menu']) assert.equal(byClass(name).hidden, false);
  assert.equal(byClass('brand').inert, false);
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
});

for (const [hash, next, label] of [
  ['#/search?p1=SheepBall&p2=FlowerDoll', '#/search?p2=FlowerDoll', '親1'],
  ['#/reverse?c=SheepBall', '#/reverse', '生まれる子'],
  ['#/route?from=SheepBall&to=MoonQueen', '#/route?to=MoonQueen', '開始'],
]) {
  test(`画面: ${label} の × で URL を変更しても新しいトリガーにフォーカスを戻す`, async (t) => {
    const { changeHash } = await boot(t, {
      initial: { 'pal-note.userId': '架空データ', 'pal-note.passcode': '入力' },
      api: createDevelopmentApi({ seed: '2' }), hash,
    });
    const clear = find((node) => node.getAttribute('aria-label') === `${label}の選択を解除`);
    assert.ok(clear);
    const original = clear.parentElement.querySelector('.picker-trigger');
    await clear.dispatch('click');
    assert.equal(location.hash, next);
    changeHash(next);
    const trigger = find((node) => node.getAttribute('aria-label') === `${label}: パルを選択`);
    assert.notEqual(trigger, original);
    assert.equal(document.activeElement, trigger);
  });
}

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
  await byText('閉じる').dispatch('click');
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
