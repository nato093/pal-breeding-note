const views = new Set(['search', 'reverse', 'route', 'list', 'owned', 'ideal', 'drafts', 'wishlist', 'pal', 'settings']);

export function parseHash(hash = '') {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const segments = path.split('/').filter(Boolean);
  let id = '';
  try { id = decodeURIComponent(segments[1] ?? ''); } catch { /* 不正な URL は空の入力として扱う。 */ }
  const params = new URLSearchParams(query);
  params.delete('k');
  return { view: views.has(segments[0]) ? segments[0] : 'search', id, params };
}

export function buildHash(view, params = {}, id = '') {
  const query = params instanceof URLSearchParams ? new URLSearchParams(params) : new URLSearchParams();
  if (!(params instanceof URLSearchParams)) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') query.set(key, value);
    }
  }
  const path = `#/${views.has(view) ? view : 'search'}${view === 'pal' ? `/${encodeURIComponent(id)}` : ''}`;
  return query.size ? `${path}?${query}` : path;
}

/**
 * 設定のセーブ連携を開いて、そのワールドで設定することにフォーカスする URL（`#/settings?world=<ID>&open=auto`）。
 * このワールドでの自分が決まっていなければその選択、登録者の対応が未設定ならその選択、などへ移る（views/owned-settings.js の reveal）。
 * 理想個体の「未確認」・自動登録の「プレイヤーの対応が未設定です」・「設定タブの〜」の案内が使う
 */
export function settingsHash(worldId = '') {
  return buildHash('settings', { world: worldId, open: 'auto' });
}

/** route を表すハッシュ（履歴のエントリに残した条件と位置が、同じ URL のものかを確かめる）。 */
export const routeKey = (route) => buildHash(route.view, route.params, route.id);

/** 同じ画面か（条件のクエリだけが違う）。パル詳細は id まで比べる。 */
export function sameScreen(a, b) {
  return Boolean(a && b) && a.view === b.view && a.id === b.id;
}

/** ハッシュが変わるたびに onChange(route, { hash }) を呼ぶ。遷移の理由（タブ・戻るなど）はアプリが決める。 */
export function startRouter(onChange, browser = window) {
  const change = () => {
    const { pathname, search, hash } = browser.location;
    const [path, query = ''] = hash.split('?');
    const params = new URLSearchParams(query);
    const searchParams = new URLSearchParams(search);
    if (params.has('k') || searchParams.has('k')) {
      const cleanSearch = searchParams.has('k');
      const cleanHash = params.has('k');
      params.delete('k');
      searchParams.delete('k');
      const nextSearch = cleanSearch ? (searchParams.size ? `?${searchParams}` : '') : search;
      const nextHash = cleanHash ? `${path}${params.size ? `?${params}` : ''}` : hash;
      browser.history.replaceState(browser.history.state, '', `${pathname}${nextSearch}${nextHash}`);
    }
    onChange(parseHash(browser.location.hash), { hash: browser.location.hash });
  };
  browser.addEventListener('hashchange', change);
  change();
  return () => browser.removeEventListener('hashchange', change);
}
