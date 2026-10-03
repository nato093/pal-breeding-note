const views = new Set(['search', 'reverse', 'route', 'list', 'pal', 'settings']);

export function parseHash(hash = '') {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const segments = path.split('/').filter(Boolean);
  let id = '';
  try { id = decodeURIComponent(segments[1] ?? ''); } catch { /* 不正な URL は空の入力として扱う。 */ }
  return { view: views.has(segments[0]) ? segments[0] : 'search', id, params: new URLSearchParams(query) };
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

export function extractInvitation(hash) {
  const route = parseHash(hash);
  const passcode = route.params.get('k');
  route.params.delete('k');
  return { passcode, hash: buildHash(route.view, route.params, route.id) };
}

export function invitationLink(origin, pathname, passcode) {
  return `${origin}${pathname}${buildHash('search', { k: passcode })}`;
}

export function shareLink(url) {
  const result = new URL(url);
  result.hash = extractInvitation(result.hash).hash;
  result.searchParams.delete('k');
  return result.href;
}

export function startRouter(onChange, browser = window) {
  const change = () => onChange(parseHash(browser.location.hash));
  browser.addEventListener('hashchange', change);
  change();
  return () => browser.removeEventListener('hashchange', change);
}
