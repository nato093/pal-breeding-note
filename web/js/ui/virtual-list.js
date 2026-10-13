// 行が多いときに、見えている範囲（と前後の少し）だけを DOM に置く一覧。行の要素は syncList で使い回す。
import { el, syncList, clearList } from './dom.js';

/**
 * 見えている行の範囲（純粋関数）。offsets[i] は i 行目の上端（offsets.length は行数 +1、最後は全体の高さ）。
 * scrollTop は一覧の上端から見えている範囲の上端までの距離（一覧が画面より下にあれば負）、viewport は見えている高さ。
 * @returns {{ start: number, end: number }} start 以上 end 未満の行を置く（前後に overscan 行ずつ足す）
 */
export function visibleRange({ offsets, scrollTop, viewport, overscan = 10 }) {
  const count = offsets.length - 1;
  if (count <= 0) return { start: 0, end: 0 };
  // 下端が scrollTop より下にある最初の行
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (offsets[middle + 1] <= scrollTop) low = middle + 1;
    else high = middle;
  }
  const first = low;
  // 上端が見えている範囲の下端以上になる最初の行
  const bottom = scrollTop + viewport;
  low = first;
  high = count;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (offsets[middle] < bottom) low = middle + 1;
    else high = middle;
  }
  const last = Math.max(low, first);
  return { start: Math.max(0, Math.min(first, count) - overscan), end: Math.min(count, last + overscan) };
}

const nextFrame = (fn) => (typeof globalThis.requestAnimationFrame === 'function'
  ? globalThis.requestAnimationFrame(fn) : setTimeout(fn, 16));
const cancelFrame = (id) => (typeof globalThis.cancelAnimationFrame === 'function' ? globalThis.cancelAnimationFrame(id) : clearTimeout(id));

/**
 * container に上下の余白（spacer）と、見えている行だけを置く。行の高さは描いた後に測って key ごとに覚える（測っていない行は estimate）。
 * create(item) → { element, update(item), destroy() }（syncList と同じ）。topOffset() は固定のヘッダー・パネルの下端（画面の上からの px）。
 * 知っておく制限: 画面の外の行は DOM に無いので、ブラウザのページ内検索と Tab では届かない（キーワードの絞り込みで探す）
 * render(items, { anchor }) の anchor は anchorOf（ui/dom.js）で覚えた { key, top }。新しい全件の中で同じ key の行を探し、
 * その行が前と同じ画面の位置（top）に来るスクロール位置で先に描いてから、そこへスクロールする
 *（今の位置で描いてから探すと、前に多くの行が増えたとき行が描く範囲の外になって戻せない）。行が無ければ今の位置で描く
 * @returns {{ rows: Element, render(items: object[], options?: { anchor?: { key: string, top: number } | null }): void,
 *   setEstimate(value: number): void, destroy(): void }}
 *   rows は行の入れ物（anchorOf・restoreAnchor に渡す）
 */
export function virtualRows(container, { key, create, estimate = 60, overscan = 10, topOffset = () => 0 }) {
  const top = el('div', 'virtual-spacer');
  const rows = el('div', 'virtual-rows');
  const bottom = el('div', 'virtual-spacer');
  top.setAttribute('aria-hidden', 'true');
  bottom.setAttribute('aria-hidden', 'true');
  container.replaceChildren(top, rows, bottom);
  container.classList.add('is-virtual');
  const heights = new Map();
  let items = [];
  let offsets = [0];
  let frame = null;
  const controller = new AbortController();

  function layout() {
    offsets = new Array(items.length + 1);
    offsets[0] = 0;
    for (let i = 0; i < items.length; i++) offsets[i + 1] = offsets[i] + (heights.get(key(items[i])) ?? estimate);
  }

  // listTop: 一覧の上端の画面の位置（渡さなければ今の位置）
  function paint(listTop = container.getBoundingClientRect().top) {
    const win = globalThis.window;
    const viewTop = topOffset();
    const viewport = Math.max(0, (win?.innerHeight ?? 0) - viewTop);
    const scrollTop = viewTop - listTop;
    const { start, end } = visibleRange({ offsets, scrollTop, viewport, overscan });
    const shown = items.slice(start, end);
    syncList(rows, shown, { key, create });
    // 描いた行の高さを覚える（測っていなかった行・高さの変わった行があれば、上端の累積を作り直す）
    let changed = false;
    shown.forEach((item, i) => {
      const height = rows.children[i]?.getBoundingClientRect().height;
      const id = key(item);
      if (height > 0 && heights.get(id) !== height) { heights.set(id, height); changed = true; }
    });
    if (changed) layout();
    top.style.setProperty('--space', `${offsets[start]}px`);
    bottom.style.setProperty('--space', `${offsets[items.length] - offsets[end]}px`);
  }

  const schedule = () => {
    if (frame !== null) return;
    frame = nextFrame(() => { frame = null; paint(); });
  };
  globalThis.window?.addEventListener?.('scroll', schedule, { passive: true, signal: controller.signal });
  globalThis.window?.addEventListener?.('resize', schedule, { signal: controller.signal });

  return {
    rows,
    render(next, { anchor = null } = {}) {
      items = next;
      layout();
      const index = anchor ? items.findIndex((item) => key(item) === anchor.key) : -1;
      if (index < 0) { paint(); return; }
      // 見ていた行が anchor.top に来るときの一覧の上端で描き（余白でページの高さも合わせてから）、その差だけスクロールする
      const listTop = anchor.top - offsets[index];
      paint(listTop);
      const moved = container.getBoundingClientRect().top - listTop;
      if (moved) globalThis.window?.scrollBy?.(0, moved);
    },
    /**
     * 測っていない行の見積もりを変え、測って覚えた高さを捨てる（全部の行の高さが一度に変わったとき。所持パルの行の下の段の出し入れ）。
     * 次の render から使う。同じ値なら何もしない
     */
    setEstimate(value) {
      if (value === estimate) return;
      estimate = value;
      heights.clear();
    },
    destroy() {
      controller.abort();
      if (frame !== null) cancelFrame(frame);
      frame = null;
      clearList(rows);
      container.replaceChildren();
      container.classList.toggle('is-virtual', false);
    },
  };
}
