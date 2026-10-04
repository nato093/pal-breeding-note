import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, buildHash, startRouter } from '../../web/js/router.js';

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
