// 題名とファビコン（autoreg-visibility。G-31・X-18 の第 1 段）。表のときは題名を「画面名 · パル配合ノート」にし、タブが裏にある間だけ
// 要確認の未読の数（更新内容のお知らせは数えない。notifications.js の unreadCounts）と、読み込みが許可待ちで止まっていることを
// 題名の頭とファビコンの右上の丸に出す（ゲーム中に別のタブから気づけるように）。表に戻ったら元に戻す。
// ファビコンの SVG は定数と整数だけで組み立てる（利用者の文字列を入れない。style 属性も使わない）。data: の画像は今の CSP で許されている
import { unreadCounts } from './notifications.js';

// web/favicon.svg の 2 つの path（ライトの色。favicon.svg を変えたらここも直す）
const FAVICON_SHAPES = '<path fill="#067b70" d="M17 0H31A17 17 0 0 1 48 17V31A17 17 0 0 1 31 48H4A4 4 0 0 1 0 44V17A17 17 0 0 1 17 0Z"/>'
  + '<path fill="none" stroke="#ffffff" stroke-width="3" stroke-linejoin="miter" d="M24 11L37 24L24 37L11 24Z"/>';
// 右上の丸の色（M3 の error。--md-sys-color-error のライトの値）
const BADGE_FILL = '#b3261e';
const LABELS = new Set(['!', '1', '2', '3', '4', '5', '6', '7', '8', '9', '9+']);

/** 丸の文字（数は 1〜9 と「9+」） */
export const badgeLabel = (count) => (count > 9 ? '9+' : String(Math.max(1, Math.floor(count))));

/** 右上の丸を重ねたファビコンの SVG（label は '!'・'1'〜'9'・'9+' だけ。ほかの値は丸を付けない） */
export function faviconSvg(label) {
  const badge = LABELS.has(label)
    ? `<circle cx="35" cy="13" r="13" fill="${BADGE_FILL}" stroke="#ffffff" stroke-width="2"/>`
      + `<text x="35" y="19.5" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${label.length > 1 ? 15 : 19}" font-weight="700" fill="#ffffff">${label}</text>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">${FAVICON_SHAPES}${badge}</svg>`;
}

/**
 * @param {{ document: Document, notifications?: object, owned?: object, baseTitle?: string }} options
 * @returns {{ setScreen(label: string): void, update(): void, destroy(): void }}
 */
export function createAttention({ document: doc, notifications, owned, baseTitle = 'パル配合ノート' }) {
  const icon = doc.head?.querySelector?.('link[rel="icon"]') ?? null;
  const originalIcon = icon?.getAttribute('href') ?? 'favicon.svg';
  let screen = '';
  let shownTitle = null;
  let shownIcon = originalIcon;

  // 数か状態が変わったときだけ書き換える（同じ値なら触らない）
  function update() {
    const hidden = doc.visibilityState === 'hidden';
    const auto = owned?.state?.auto;
    const stopped = Boolean(auto?.enabled && auto.status === 'permission');
    const count = hidden && notifications ? unreadCounts(notifications).actionable : 0;
    const base = screen ? `${screen} · ${baseTitle}` : baseTitle;
    const title = hidden ? `${count ? `(${count}) ` : ''}${stopped ? '(!) 読み込み停止 · ' : ''}${base}` : base;
    if (title !== shownTitle) {
      shownTitle = title;
      doc.title = title;
    }
    const label = !hidden ? '' : stopped ? '!' : count ? badgeLabel(count) : '';
    const href = label ? `data:image/svg+xml,${encodeURIComponent(faviconSvg(label))}` : originalIcon;
    if (icon && href !== shownIcon) {
      shownIcon = href;
      icon.setAttribute('href', href);
    }
  }

  const unsubscribes = [notifications?.subscribe?.(update), owned?.subscribe?.(update)].filter(Boolean);
  doc.addEventListener?.('visibilitychange', update);
  update();
  return {
    /** 表の題名の画面名（タブの名前。パル詳細はパルの名前。ログイン画面は ''） */
    setScreen(label) {
      screen = label || '';
      update();
    },
    update,
    destroy() {
      for (const unsubscribe of unsubscribes) unsubscribe();
      doc.removeEventListener?.('visibilitychange', update);
    },
  };
}
