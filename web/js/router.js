const views = new Set(['search', 'route', 'owned', 'ideal', 'pal', 'settings']);

// 統合してなくなった画面 → 移った先の画面と足すクエリ（もとの条件のクエリはそのまま渡す）。ブックマーク・保存済みの通知の href の旧 URL を
// 読み替える。逆引き（#/reverse?c=）と一覧（#/list）は配合を探す（find-merge）、下書き（#/drafts）は下書きの帯を開いた配合を探す
//（register-entry）、ウィッシュリスト（#/wishlist）は目標のダイアログを開いた理想個体（goals-merge）
const LEGACY = Object.freeze({
  reverse: { view: 'search' },
  list: { view: 'search' },
  drafts: { view: 'search', add: { drafts: '1' } },
  wishlist: { view: 'ideal', add: { goals: '1' } },
});

function splitHash(hash) {
  const [path, query = ''] = String(hash ?? '').replace(/^#/, '').split('?');
  return { segments: path.split('/').filter(Boolean), query };
}

export function parseHash(hash = '') {
  const { segments, query } = splitHash(hash);
  let id = '';
  try { id = decodeURIComponent(segments[1] ?? ''); } catch { /* 不正な URL は空の入力として扱う。 */ }
  const params = new URLSearchParams(query);
  params.delete('k');
  const legacy = LEGACY[segments[0]];
  if (legacy) {
    for (const [key, value] of Object.entries(legacy.add ?? {})) params.set(key, value);
    return { view: legacy.view, id: '', params };
  }
  return { view: views.has(segments[0]) ? segments[0] : 'search', id, params };
}

/** 旧画面の URL（LEGACY）なら移った先の画面のハッシュを、そうでなければ null を返す（`#/reverse?c=X` → `#/search?c=X`、`#/drafts` → `#/search?drafts=1`）。 */
export function canonicalHash(hash) {
  const { segments, query } = splitHash(hash);
  const legacy = LEGACY[segments[0]];
  if (!legacy) return null;
  const params = new URLSearchParams(query);
  for (const [key, value] of Object.entries(legacy.add ?? {})) params.set(key, value);
  return buildHash(legacy.view, params);
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
 * 設定の行き先の意図（URL の open の値）。設定のセーブ連携を開いて、意図ごとの所へフォーカスする（views/owned-settings.js の reveal）。
 * - self: このワールドでの自分の選択（理想個体の「未確認（このワールドでの自分が未設定）」の「設定で選ぶ」）
 * - registrant: そのワールドの行を開いて、未設定の登録者の選択（自動登録の「プレイヤーの対応が未設定です」）
 * - status: カードの状態の欄の操作（読み込みの許可・今すぐ読み込む）かカードの見出し（データがない・読めないときの「セーブ連携を開く」、
 *   ヘッダーのセーブ連携の「設定を開く」）
 * - auto: 前の版の決め方（自分が決まっていなければ自分 → 未設定の登録者 → 自動登録のチェック → 自分 → 見出し）。前に保存した通知・
 *   ブックマークの `open=auto` のため受け付け続ける
 */
export const SETTINGS_OPEN = Object.freeze(['self', 'registrant', 'status', 'auto']);

/**
 * 設定のセーブ連携を開いて、そのワールドで open の意図の所へフォーカスする URL（`#/settings?world=<ID>&open=<意図>`。SETTINGS_OPEN）。
 * ワールド ID はそのまま入れる（設定の画面が大文字にそろえて比べる）。'' なら `#/settings?open=<意図>`
 */
export function settingsHash(worldId = '', open = 'auto') {
  return buildHash('settings', { world: worldId, open: SETTINGS_OPEN.includes(open) ? open : 'auto' });
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
    // 旧画面の URL は、履歴を増やさずに移った先の URL へ書き換える（戻るで旧 URL に戻って読み替え直す、を繰り返さない）
    const canonical = canonicalHash(browser.location.hash);
    if (canonical) browser.history.replaceState(browser.history.state, '', `${browser.location.pathname}${browser.location.search}${canonical}`);
    onChange(parseHash(browser.location.hash), { hash: browser.location.hash });
  };
  browser.addEventListener('hashchange', change);
  change();
  return () => browser.removeEventListener('hashchange', change);
}
