// 右のサイドドロワー（非モーダル・本文に重ねて押し出さない・1 度に 1 つ。D3）。パル詳細・個体の詳細・牧場・相手親の個体などを、
// 今の画面（一覧・検索結果・計画）とスクロール位置を失わずに見せる入れ物。中身は app.js が種類ごとの表（render）で渡し、ここは中身を知らない。
// <dialog> は使わない（ui/toast.js が一番手前の dialog[open] にトーストを出す・closeDialogs に巻き込まれるため）。
// 履歴: 開くときは URL を変えずに pushState（hashchange は起きない）、開いたまま中身を替えるときは replaceState。× と Esc は
// 自分で積んだエントリなら history.back()。戻る・進む・読み込み直しは history.state.drawer に合わせる（sync）。
// history.state は keep-state（palEntry）と共有するので、必ず展開してから書き、ほかの鍵を消さない
import { el, button, link } from './dom.js';
import { icon } from './icons.js';
import { buildHash } from '../router.js';
import { idText, isObject } from '../core/boundary.js';
import { userIdKey } from '../core/user.js';

/** history.state.drawer の形の版（違う版は開き直さずに消す） */
export const DRAWER_VERSION = 1;
/** 「← 前へ」で戻れる数 */
export const DRAWER_STACK_MAX = 5;
/** 中身の種類（パル詳細・所持パルの個体・配合牧場・種族の所持個体） */
export const DRAWER_KINDS = Object.freeze(['pal', 'owned', 'farms', 'species']);

let sequence = 0;

/** 中身の指定 { kind, id, params? }。形が合わなければ null（履歴から読んだ値・呼び出し側の値のどちらも通す） */
export function cleanEntry(value) {
  if (!isObject(value) || !DRAWER_KINDS.includes(value.kind)) return null;
  const id = idText(value.id, 80);
  if (!id && value.kind !== 'farms') return null;
  const params = {};
  if (isObject(value.params)) {
    for (const [key, item] of Object.entries(value.params).slice(0, 8)) {
      if (/^[a-z][a-z0-9]{0,15}$/i.test(key) && typeof item === 'string' && item.length <= 200) params[key] = item;
    }
  }
  return Object.keys(params).length ? { kind: value.kind, id, params } : { kind: value.kind, id };
}

const sameEntry = (a, b) => Boolean(a && b) && a.kind === b.kind && a.id === b.id
  && JSON.stringify(a.params ?? {}) === JSON.stringify(b.params ?? {});

/** history.state.drawer を確かめる。版・形が合わなければ null */
export function cleanDrawerState(value) {
  if (!isObject(value) || value.v !== DRAWER_VERSION) return null;
  const entry = cleanEntry(value.entry);
  if (!entry || typeof value.env !== 'string' || typeof value.user !== 'string') return null;
  const stack = Array.isArray(value.stack) ? value.stack.map(cleanEntry).filter(Boolean).slice(-DRAWER_STACK_MAX) : [];
  // id は開いた 1 回ごとの印（同じ画面の条件の変更で引き継いだエントリも同じ）。前の形（id なし）も受ける
  const id = typeof value.id === 'string' && /^[a-z0-9-]{1,40}$/.test(value.id) ? value.id : '';
  return { v: DRAWER_VERSION, env: value.env, user: value.user, entry, stack, pushed: value.pushed === true, ...(id ? { id } : {}) };
}

/**
 * @param {{ context: object, render?: Record<string, (entry: object, context: object) => ({ title: string, element: HTMLElement,
 *   destroy?: () => void, href?: string } | null)>, main?: HTMLElement, history?: History, doc?: Document,
 *   scope?: () => ({ env: string, user: string } | null), url?: () => string }} options
 *   scope はログイン中の環境と利用者（userIdKey）。ログインしていなければ null（開かない）。url は今の URL（replaceState に渡す）
 */
export function createDrawer({ context, render = {}, main = null, history: browserHistory = globalThis.history, doc = globalThis.document, scope, url }) {
  const currentScope = scope ?? (() => {
    const state = context?.store?.state;
    return state?.passcode && state?.userId ? { env: state.env ?? '', user: userIdKey(state.userId) } : null;
  });
  const currentUrl = url ?? (() => {
    const place = globalThis.location;
    return place ? `${place.pathname ?? ''}${place.search ?? ''}${place.hash ?? ''}` : '';
  });
  const titleId = `side-drawer-title-${++sequence}`;
  const element = el('aside', 'side-drawer');
  element.hidden = true;
  element.setAttribute('aria-labelledby', titleId);
  const header = el('header', 'side-drawer-header');
  // 見出しの行は [← 前へ][題名][ページで開く][×]。題名の幅を取るため、操作はアイコン（名前は aria-label・title）
  const back = button('', () => previous(), 'icon-button side-drawer-back');
  back.append(icon('back', { className: 'side-drawer-icon' }));
  back.setAttribute('aria-label', '前の内容へ戻る');
  back.hidden = true;
  const heading = el('h2', 'side-drawer-title');
  heading.id = titleId;
  heading.tabIndex = -1;
  // 「本文へ戻る」はドロワーを開いたまま、フォーカスを開いた所（なければ本文）へ移す。普段は見えず、フォーカスが来たら見出しの行の下に出る（CSS）
  const skip = button('本文へ戻る', () => returnFocus(), 'side-drawer-skip');
  const page = link('', '', 'icon-button side-drawer-page');
  page.append(icon('open-page', { className: 'side-drawer-icon' }));
  page.setAttribute('aria-label', 'ページで開く');
  page.title = 'ページで開く（全画面）';
  page.hidden = true;
  const close = button('', () => dismiss(), 'icon-button side-drawer-close');
  close.setAttribute('aria-label', 'パネルを閉じる');
  close.title = '閉じる（Esc）';
  close.append(icon('close', { className: 'close-icon' }));
  header.append(skip, back, heading, page, close);
  const body = el('div', 'side-drawer-body');
  element.append(header, body);

  let entry = null;
  let stack = [];
  let content = null;
  let opener = null;
  // 開いている中身が変わったときに知らせる先（所持パルの一覧の「開いている行」の印など）
  const listeners = new Set();
  let notified = null;
  const notify = () => {
    const key = entry ? JSON.stringify(entry) : null;
    if (key === notified) return;
    notified = key;
    for (const listener of [...listeners]) {
      try { listener(entry ? { ...entry } : null); } catch { /* 知らせる先の失敗でドロワーを止めない。 */ }
    }
  };

  // 開いた 1 回ごとの ID と、引き継いだエントリで閉じた ID（そのドロワーを持つ前のエントリへ戻っても開き直さない。このページの間だけ覚える）
  let instance = '';
  const dismissed = new Set();
  const historyState = () => (isObject(browserHistory?.state) ? browserHistory.state : {});
  function writeHistory(kind, drawerState) {
    const { drawer: _, ...rest } = historyState();
    const next = drawerState ? { ...rest, drawer: drawerState } : rest;
    try {
      if (kind === 'push' && typeof browserHistory?.pushState === 'function') browserHistory.pushState(next, '', currentUrl());
      else if (kind !== 'push' && typeof browserHistory?.replaceState === 'function') browserHistory.replaceState(next, '', currentUrl());
      else return false;
      return true;
    } catch { return false; }
  }
  const stateOf = (pushed) => {
    const where = currentScope();
    return { v: DRAWER_VERSION, env: where?.env ?? '', user: where?.user ?? '', entry, stack: [...stack], pushed, ...(instance ? { id: instance } : {}) };
  };

  const documentElement = () => doc?.documentElement ?? null;
  function markOpen(open) {
    const root = documentElement();
    if (!root?.setAttribute) return;
    if (open) root.setAttribute('data-side-drawer', 'open');
    else root.removeAttribute?.('data-side-drawer');
  }
  const usable = (node) => Boolean(node?.isConnected) && typeof node.focus === 'function' && !element.contains(node);
  // 開いた所（なければ本文の見出し、なければ本文）
  function focusTarget() {
    if (usable(opener)) return opener;
    const title = main?.querySelector?.('h1');
    if (title?.isConnected) {
      if (title.tabIndex === undefined || title.tabIndex < 0) title.tabIndex = -1;
      return title;
    }
    return main?.isConnected ? main : null;
  }
  function returnFocus() {
    const target = focusTarget();
    if (!target) return;
    if (target === main && (main.tabIndex === undefined || main.tabIndex < 0)) main.tabIndex = -1;
    target.focus({ preventScroll: true });
  }

  function destroyContent() {
    const old = content;
    content = null;
    try { old?.destroy?.(); } catch { /* 中身の片づけの失敗でドロワーを閉じられなくしない。 */ }
  }
  function notFound() {
    const box = el('div', 'side-drawer-missing');
    box.append(el('p', '', '見つかりません。消されたか、読み込み直して変わった可能性があります。'),
      button('閉じる', () => dismiss(), 'button secondary small'));
    return { title: '見つかりません', element: box, destroy() {} };
  }
  // 中身を作って入れ替える（前の中身は必ず destroy）
  function show(next) {
    destroyContent();
    entry = next;
    let made = null;
    // 中身が後から見出しを直す（読み込みを待った個体の詳細・ニックネームの変更）。入れ替わった後の古い中身からは効かない
    const setTitle = (text) => {
      if (made && content === made && typeof text === 'string' && heading.textContent !== text) heading.textContent = text;
    };
    try { made = render[next.kind]?.(next, context, { setTitle }) ?? null; } catch { made = null; }
    content = made && made.element ? made : notFound();
    heading.textContent = content.title ?? '';
    const href = content.href ?? (next.kind === 'pal' && made ? buildHash('pal', {}, next.id) : '');
    page.hidden = !href;
    page.href = href || '#';
    back.hidden = stack.length === 0;
    back.title = stack.length ? '前の内容へ戻る' : '';
    body.replaceChildren(content.element);
    if (body.scrollTop) body.scrollTop = 0;
    element.hidden = false;
    markOpen(true);
    notify();
  }
  // DOM を閉じる（履歴は触らない）。フォーカスが中にあれば開いた所へ戻す
  function hide() {
    if (!entry && element.hidden) return;
    const focused = Boolean(doc?.activeElement) && element.contains(doc.activeElement);
    destroyContent();
    entry = null;
    stack = [];
    instance = '';
    body.replaceChildren();
    element.hidden = true;
    markOpen(false);
    if (focused) returnFocus();
    opener = null;
    notify();
  }

  /**
   * 中身を開く。閉じていれば履歴を 1 件積み（URL は変えない）、開いていれば今の中身を「← 前へ」の積み上げに入れて差し替える（履歴は増やさない）。
   * 同じ中身なら見出しへフォーカスを移すだけ
   */
  function open(value, { opener: from = null } = {}) {
    const next = cleanEntry(value);
    if (!next || !currentScope()) return;
    if (from && !element.contains(from)) opener = from;
    if (entry && sameEntry(entry, next)) { heading.focus({ preventScroll: true }); return; }
    if (entry) {
      stack = [...stack, entry].slice(-DRAWER_STACK_MAX);
      const pushed = cleanDrawerState(historyState().drawer)?.pushed === true;
      show(next);
      writeHistory('replace', stateOf(pushed));
    } else {
      stack = [];
      instance = `${Date.now().toString(36)}-${++sequence}`;
      show(next);
      if (!writeHistory('push', stateOf(true))) writeHistory('replace', stateOf(false));
    }
    heading.focus({ preventScroll: true });
  }

  function previous() {
    if (!stack.length) return;
    const prior = stack.at(-1);
    stack = stack.slice(0, -1);
    const pushed = cleanDrawerState(historyState().drawer)?.pushed === true;
    show(prior);
    writeHistory('replace', stateOf(pushed));
    heading.focus({ preventScroll: true });
  }

  // 利用者が閉じた（×・Esc・中の「閉じる」）。自分で積んだエントリなら戻る（popstate の sync でも閉じるが、先に閉じておく）
  function dismiss() {
    if (!entry) return;
    const own = cleanDrawerState(historyState().drawer)?.pushed === true;
    const closing = instance;
    hide();
    if (own && typeof browserHistory?.back === 'function') browserHistory.back();
    else {
      // 引き継いだエントリで閉じた: 同じドロワーを持つ前のエントリ（開いた所・条件を変える前）へ「戻る」で入っても開き直さない
      if (closing) dismissed.add(closing);
      writeHistory('replace', null);
    }
  }

  /**
   * 閉じる。reason: 'dismiss'（利用者。自分で積んだエントリなら戻る）・'history'（戻る・進む。DOM だけ）・それ以外（画面の移動・ログアウト・
   * ID の変更・ワールドの切り替え。DOM を閉じ、今のエントリに drawer があれば消す。履歴は戻さない）
   */
  function closeDrawer({ reason = 'dismiss', fromHistory = false } = {}) {
    if (reason === 'dismiss' && !fromHistory) { dismiss(); return; }
    hide();
    if (fromHistory || reason === 'history') return;
    if (historyState().drawer !== undefined) writeHistory('replace', null);
  }

  /**
   * 今の履歴のエントリ（戻る・進む・読み込み直し）に合わせて開く・閉じる。版・環境・利用者が今と違う drawer は開かずに消す
   */
  function sync(state = browserHistory?.state) {
    const raw = isObject(state) ? state.drawer : undefined;
    const saved = cleanDrawerState(raw);
    const where = currentScope();
    if (!saved) {
      hide();
      if (raw !== undefined && where) writeHistory('replace', null);
      return;
    }
    if (!where) { hide(); return; }
    // 起動の直後で環境（テスト／本番）がまだ分からないときは、開かずに残す（違う環境として消さない）
    if (!where.env && saved.env) { hide(); return; }
    // 引き継いだエントリで閉じたドロワー（このページで × を押した）は開き直さずに消す
    if (saved.id && dismissed.has(saved.id)) {
      hide();
      writeHistory('replace', null);
      return;
    }
    if (saved.env !== where.env || saved.user !== where.user) {
      hide();
      writeHistory('replace', null);
      return;
    }
    if (entry && sameEntry(entry, saved.entry)) {
      stack = saved.stack;
      instance = saved.id ?? instance;
      back.hidden = stack.length === 0;
      return;
    }
    stack = saved.stack;
    show(saved.entry);
    instance = saved.id ?? '';
  }

  /** 同じ画面の条件の変更（context.update の pushState）で新しいエントリに引き継ぐ drawer（自分で積んだものではない印つき）。閉じていれば {} */
  function carry() {
    return entry ? { drawer: stateOf(false) } : {};
  }

  // Esc: フォーカスがドロワーの中にあり、中の候補（aria-expanded の部品）が開いていず、モーダルのダイアログもないときだけ閉じる。
  // 候補の Esc は document で受けるので、ここ（先に呼ばれる）では候補が開いていれば何もしない
  element.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || !entry) return;
    if (doc?.querySelector?.('dialog[open]')) return;
    if (element.querySelector('[aria-expanded="true"]')) return;
    event.preventDefault?.();
    dismiss();
  });

  return {
    element,
    open,
    close: closeDrawer,
    sync,
    carry,
    current: () => (entry ? { ...entry } : null),
    restore: (state) => sync(state),
    isOpen: () => Boolean(entry),
    /** 開いている中身（テスト・ほかの部品が中身の update を呼ぶ） */
    content: () => content,
    /** 開いている中身（{ kind, id, params } か null）が変わったら呼ぶ。外す関数を返す */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() { hide(); },
  };
}

/**
 * パルのタイル（a.pal-tile の `#/pal/<id>`）の普通のクリックをドロワーで開く（修飾キー・中クリック・dialog の中は今までどおり全画面）。
 * root の click から呼び、引き取ったら true（app.js のリンクの処理を続けない）。href は残す（新しいタブ・直リンク・読み上げ）
 */
export function handlePalLink(event, root, drawer) {
  if (event.defaultPrevented || event.button > 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return false;
  let anchor = null;
  for (let node = event.target; node && node !== root; node = node.parentElement) {
    const tag = String(node.tagName ?? '').toLowerCase();
    if (tag === 'dialog') return false;
    if (!anchor && tag === 'a') anchor = node;
  }
  if (!anchor || !String(anchor.className ?? '').split(' ').includes('pal-tile')) return false;
  const href = String(anchor.getAttribute?.('href') ?? anchor.href ?? '');
  const match = href.match(/^#\/pal\/([^?#]+)/);
  if (!match) return false;
  let id = '';
  try { id = decodeURIComponent(match[1]); } catch { return false; }
  if (!id) return false;
  event.preventDefault();
  drawer.open({ kind: 'pal', id }, { opener: anchor });
  return true;
}
