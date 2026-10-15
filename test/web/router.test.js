import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, buildHash, startRouter, sameScreen, settingsHash, SETTINGS_OPEN, canonicalHash } from '../../web/js/router.js';

test('ルーティング: 旧招待パラメータは認証情報として取り出さない', () => {
  const route = parseHash('#/search?p1=A&k=旧値');
  assert.equal(route.view, 'search');
  assert.equal(route.params.get('p1'), 'A');
  assert.equal(route.params.has('k'), false);
  assert.equal('passcode' in route, false);
});

test('ルーティング: URL の特殊文字、空値、不正なパスを扱う', () => {
  assert.equal(buildHash('search', { p1: '', p2: undefined }), '#/search');
  assert.equal(parseHash('#/unknown').view, 'search');
  assert.equal(parseHash('#/pal/%').id, '');
  assert.equal(parseHash(buildHash('pal', {}, '名前/番号')).id, '名前/番号');
  assert.equal(parseHash(buildHash('search', { p1: 'a+b /?' })).params.get('p1'), 'a+b /?');
});

test('ルーティング: 継承ルートもクエリをそのまま読み込み・生成する', () => {
  const route = parseHash('#/route?from=A&to=B&exclude=C');
  assert.equal(route.params.get('exclude'), 'C');
  assert.equal(buildHash('route', { from: 'A', to: 'B', exclude: 'C' }), '#/route?from=A&to=B&exclude=C');
  assert.equal(buildHash('route', new URLSearchParams('from=A&exclude=C')), '#/route?from=A&exclude=C');
});

test('ルーティング: 起動時とハッシュ変更時に旧 k を URL・パラメータから除去し、検索条件を維持する', () => {
  const events = new Map();
  const replacements = [];
  const routes = [];
  const browser = {
    location: { pathname: '/Pal/', search: '?seed=12&k=旧値&mode=1', hash: '#/search?p1=A&k=旧値&p2=B&k=再度&name=a%2Bb' },
    addEventListener: (name, callback) => events.set(name, callback),
    removeEventListener: (name, callback) => { assert.equal(events.get(name), callback); events.delete(name); },
    history: {
      state: { keep: true },
      replaceState(state, title, value) {
        assert.deepEqual(state, { keep: true });
        replacements.push(value);
        const url = new URL(value, 'https://example.test');
        Object.assign(browser.location, { pathname: url.pathname, search: url.search, hash: url.hash });
      },
    },
  };
  const stop = startRouter((route) => routes.push(route), browser);
  assert.equal(browser.location.search, '?seed=12&mode=1');
  assert.equal(browser.location.hash, '#/search?p1=A&p2=B&name=a%2Bb');
  assert.equal(routes[0].params.has('k'), false);
  assert.deepEqual([...routes[0].params], [['p1', 'A'], ['p2', 'B'], ['name', 'a+b']]);
  browser.location.hash = '#/route?from=A&k=&to=B';
  events.get('hashchange')();
  assert.equal(browser.location.hash, '#/route?from=A&to=B');
  assert.equal(routes[1].view, 'route');
  assert.deepEqual([...routes[1].params], [['from', 'A'], ['to', 'B']]);
  browser.location.hash = '#/search?p1=A%20B';
  events.get('hashchange')();
  assert.equal(browser.location.hash, '#/search?p1=A%20B');
  assert.equal(replacements.length, 2);
  browser.location.hash = '#/search?k=旧値';
  events.get('hashchange')();
  assert.equal(browser.location.hash, '#/search');
  assert.equal(routes[3].params.size, 0);
  stop();
  assert.equal(events.size, 0);
});

test('ルーティング: 同じ画面は view と id で判定し、条件（クエリ）の違いは同じ画面とみなす', () => {
  assert.equal(sameScreen(parseHash('#/search?p1=A'), parseHash('#/search?p1=A&p2=B')), true);
  assert.equal(sameScreen(parseHash('#/search'), parseHash('#/route')), false);
  // パル詳細は id まで比べる
  assert.equal(sameScreen(parseHash('#/pal/A'), parseHash('#/pal/A')), true);
  assert.equal(sameScreen(parseHash('#/pal/A'), parseHash('#/pal/B')), false);
  assert.equal(sameScreen(null, parseHash('#/search')), false);
  assert.equal(sameScreen(parseHash('#/search'), undefined), false);
});

test('ルーティング: 変わったときの知らせに、k を除いた後のハッシュを渡す（理由はアプリが決める）', () => {
  const events = new Map();
  const calls = [];
  const browser = {
    location: { pathname: '/Pal/', search: '', hash: '#/search?p1=A&k=旧値' },
    addEventListener: (name, callback) => events.set(name, callback),
    removeEventListener: (name) => events.delete(name),
    history: {
      state: null,
      replaceState(state, title, value) { Object.assign(browser.location, { hash: new URL(value, 'https://example.test').hash }); },
    },
  };
  const stop = startRouter((route, info) => calls.push([route.view, info]), browser);
  browser.location.hash = '#/route?to=B';
  events.get('hashchange')();
  assert.deepEqual(calls, [['search', { hash: '#/search?p1=A' }], ['route', { hash: '#/route?to=B' }]]);
  stop();
});

test('ルーティング: 設定の行き先は意図（self・registrant・status。前の版の auto）ごとの URL で、知らない意図は auto にする', () => {
  const world = 'ABCDEF0123456789ABCDEF0123456789';
  assert.deepEqual([...SETTINGS_OPEN], ['self', 'registrant', 'status', 'auto']);
  assert.equal(settingsHash(world, 'self'), `#/settings?world=${world}&open=self`);
  assert.equal(settingsHash(world, 'registrant'), `#/settings?world=${world}&open=registrant`);
  assert.equal(settingsHash('', 'status'), '#/settings?open=status');
  // 意図を渡さない・知らない意図は、前の版の決め方（auto）
  assert.equal(settingsHash(world), `#/settings?world=${world}&open=auto`);
  assert.equal(settingsHash(world, 'other'), `#/settings?world=${world}&open=auto`);
});

test('ルーティング: 統合した旧画面（逆引き・一覧・下書き）の URL は配合を探すに読み替え、条件のクエリはそのまま渡す', () => {
  assert.equal(canonicalHash('#/reverse?c=SheepBall'), '#/search?c=SheepBall');
  assert.equal(canonicalHash('#/list'), '#/search');
  assert.equal(canonicalHash('#/list?sort=updated'), '#/search?sort=updated');
  assert.equal(canonicalHash('#/search?p1=A'), null);
  assert.equal(canonicalHash('#/route'), null);
  assert.equal(canonicalHash(''), null);
  // parseHash も読み替えた画面を返す（remember やテストが旧ハッシュを渡しても新しい画面）
  const route = parseHash('#/reverse?c=SheepBall');
  assert.equal(route.view, 'search');
  assert.equal(route.params.get('c'), 'SheepBall');
  assert.equal(parseHash('#/list').view, 'search');
  // 下書き（register-entry）は下書きの帯を開いた配合を探す（drafts=1 を足す）
  assert.equal(canonicalHash('#/drafts'), '#/search?drafts=1');
  assert.equal(canonicalHash('#/drafts?x=1'), '#/search?x=1&drafts=1');
  assert.equal(parseHash('#/drafts').params.get('drafts'), '1');
  // 旧画面の名前では URL を作らない
  assert.equal(buildHash('reverse', { c: 'A' }), '#/search?c=A');
  assert.equal(buildHash('list'), '#/search');
  assert.equal(buildHash('drafts'), '#/search');
});

test('ルーティング: 起動時とハッシュ変更時に旧画面の URL を履歴を増やさず（replaceState・state は保つ）配合を探すへ書き換える', () => {
  const events = new Map();
  const replacements = [];
  const routes = [];
  const browser = {
    location: { pathname: '/Pal/', search: '?seed=1', hash: '#/reverse?c=SheepBall' },
    addEventListener: (name, callback) => events.set(name, callback),
    removeEventListener: (name) => events.delete(name),
    history: {
      state: { palEntry: 'e1' },
      replaceState(state, title, value) {
        assert.deepEqual(state, { palEntry: 'e1' });
        replacements.push(value);
        const url = new URL(value, 'https://example.test');
        Object.assign(browser.location, { pathname: url.pathname, search: url.search, hash: url.hash });
      },
    },
  };
  const stop = startRouter((route, info) => routes.push([route.view, route.params.get('c'), info.hash]), browser);
  assert.deepEqual(replacements, ['/Pal/?seed=1#/search?c=SheepBall']);
  assert.deepEqual(routes, [['search', 'SheepBall', '#/search?c=SheepBall']]);
  // 保存済みの通知の #/list（旧旧の k つきも）
  browser.location.hash = '#/list?k=旧値';
  events.get('hashchange')();
  assert.equal(browser.location.hash, '#/search');
  assert.deepEqual(routes[1], ['search', null, '#/search']);
  // 今の画面の URL は書き換えない
  browser.location.hash = '#/search?p1=A';
  events.get('hashchange')();
  assert.equal(replacements.length, 3);
  stop();
});
