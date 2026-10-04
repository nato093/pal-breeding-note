const views = new Set(['search', 'reverse', 'route', 'list', 'drafts', 'wishlist', 'pal', 'settings']);

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
    onChange(parseHash(browser.location.hash));
  };
  browser.addEventListener('hashchange', change);
  change();
  return () => browser.removeEventListener('hashchange', change);
}
