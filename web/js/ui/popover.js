// 開いたり閉じたりする小さな部品（パル選択の候補・パッシブ選択・ヘッダーのパネル）の共通の土台。
// document・window のリスナーは開いている間だけ付け、閉じるときに AbortController でまとめて外す。
import { el } from './dom.js';

let sequence = 0;

/**
 * anchor の位置から popup の left・width・max-height と上下を決め、CSS 変数（--picker-left・--picker-width・
 * --picker-max-height・--picker-top か --picker-bottom）に書く。host がダイアログなら、その左右の中に収める。
 * 下に 200px 足りず、上の方が広ければ上に開く。
 * @returns {{ upwards: boolean }}
 */
export function placeFloating(popup, anchor, host, { minWidth = 320, maxHeight = 560 } = {}) {
  const rect = anchor.getBoundingClientRect();
  const dialogRect = host?.tagName?.toLowerCase() === 'dialog' ? host.getBoundingClientRect() : null;
  const minLeft = Math.max(12, dialogRect?.left ?? 12);
  const maxRight = Math.min(window.innerWidth - 12, dialogRect ? dialogRect.left + dialogRect.width : window.innerWidth - 12);
  const width = Math.min(Math.max(minWidth, rect.width), maxRight - minLeft);
  let left = rect.left;
  if (dialogRect && left + width > maxRight) left = rect.left + rect.width - width;
  left = Math.max(minLeft, Math.min(left, maxRight - width));
  const below = Math.max(0, window.innerHeight - rect.bottom - 16);
  const above = Math.max(0, rect.top - 16);
  const upwards = below < 200 && above > below;
  popup.style.setProperty('--picker-left', `${left}px`);
  popup.style.setProperty('--picker-width', `${width}px`);
  popup.style.setProperty('--picker-max-height', `${Math.min(maxHeight, upwards ? above : below)}px`);
  // 開き直したとき（位置の計算のし直し）に、前の向きの値を残さない
  popup.style.setProperty(upwards ? '--picker-top' : '--picker-bottom', 'auto');
  popup.style.setProperty(upwards ? '--picker-bottom' : '--picker-top', `${upwards ? window.innerHeight - rect.top + 4 : rect.bottom + 4}px`);
  return { upwards };
}

/**
 * 一覧の中で row が見える位置になるよう、一覧だけをスクロールする（scrollIntoView はページや本文も動かすので使わない）。
 * center なら真ん中に、そうでなければはみ出したときだけ端に合わせる。
 * 開くときの動き（transform で縮めて出す）の途中でも同じ値になるよう、getBoundingClientRect ではなく offsetTop で測る
 */
export function scrollWithin(list, row, { center = false } = {}) {
  if (!row || ![row.offsetTop, row.offsetHeight, list.offsetTop, list.clientHeight, list.scrollTop].every(Number.isFinite)) return;
  // 一覧の中身の先頭からの位置（一覧が row の offsetParent でなければ、同じ offsetParent からの差）
  const top = row.offsetParent === list ? row.offsetTop : row.offsetTop - list.offsetTop;
  const bottom = top + row.offsetHeight;
  if (center) list.scrollTop = Math.max(0, top - (list.clientHeight - row.offsetHeight) / 2);
  else if (top < list.scrollTop) list.scrollTop = top;
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
}

/**
 * 開閉と外側の操作。open() で element を付ける（host があれば host＝document.body かダイアログの中に浮かせ、
 * 無ければ wrapper の中）。外側（wrapper と element の外）の pointerdown・Escape で閉じ、focusOut なら
 * フォーカスが外へ出たときも閉じる。浮かせているときは、element の外でのホイール・タッチのスクロール（利用者がページを動かした）・
 * resize・ダイアログの cancel でも閉じる。それ以外の外のスクロール（データの更新でページが縮み、スクロール位置が丸められたなど）では
 * 閉じず、anchor が画面の中にあれば置き直す（画面の外へ出たら閉じる）。
 * onOpen は付けた後（中身を作る）、onClose は外した後に呼ぶ。
 * @param {{ anchor: Element, wrapper: Element, host?: Element | null, className?: string, tag?: string, focusOut?: boolean,
 *   place?: { minWidth?: number, maxHeight?: number }, onOpen?: () => void, onClose?: () => void }} options
 */
export function createPopover({ anchor, wrapper, host = null, className = 'picker-popover', tag = 'div', focusOut = false, place, onOpen, onClose }) {
  const element = el(tag, className);
  element.id = `popover-${++sequence}`;
  if (host) element.classList.add('picker-popover-floating');
  // aria-controls は開いている間だけ（閉じている間は element が DOM に無いので、無い id を指さない）
  anchor.setAttribute('aria-expanded', 'false');
  let controller = null;
  const inside = (node) => wrapper.contains(node) || element.contains(node);

  function reposition() {
    if (host && controller) placeFloating(element, anchor, host, place);
  }

  /** focus: 閉じた後に anchor へフォーカスを戻す（anchor が画面に残っているときだけ） */
  function close({ focus = true } = {}) {
    if (!controller) return;
    controller.abort();
    controller = null;
    element.remove();
    anchor.setAttribute('aria-expanded', 'false');
    anchor.removeAttribute('aria-controls');
    if (focus && anchor.isConnected) anchor.focus();
    onClose?.();
  }

  function open() {
    if (controller) return;
    controller = new AbortController();
    const { signal } = controller;
    (host ?? wrapper).append(element);
    anchor.setAttribute('aria-expanded', 'true');
    anchor.setAttribute('aria-controls', element.id);
    document.addEventListener('pointerdown', (event) => { if (!inside(event.target)) close({ focus: false }); }, { signal });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); }, { signal });
    if (focusOut) {
      element.addEventListener('focusout', () => {
        queueMicrotask(() => { if (controller && !inside(document.activeElement)) close(); });
      }, { signal });
    }
    if (host) {
      reposition();
      // 利用者が本文をスクロールした（ホイール・タッチ）・窓の大きさを変えたときは anchor と離れるので閉じる（候補の中のスクロールでは閉じない）
      const userScroll = (event) => { if (!element.contains(event.target)) close(); };
      document.addEventListener('wheel', userScroll, { capture: true, passive: true, signal });
      document.addEventListener('touchmove', userScroll, { capture: true, passive: true, signal });
      // そのほかのスクロール（開いたまま描き直してページが縮み、位置が丸められたなど）では、anchor が見えていれば置き直す
      document.addEventListener('scroll', (event) => {
        if (element.contains(event.target)) return;
        const rect = anchor.getBoundingClientRect();
        if (rect.bottom > 0 && rect.top < window.innerHeight) reposition();
        else close();
      }, { capture: true, signal });
      window.addEventListener('resize', () => close(), { signal });
      if (host.tagName?.toLowerCase() === 'dialog') host.addEventListener('cancel', (event) => { event.preventDefault(); close(); }, { signal });
    }
    onOpen?.();
  }

  return {
    element,
    open,
    close,
    isOpen: () => Boolean(controller),
    reposition,
    destroy() { close({ focus: false }); },
  };
}
