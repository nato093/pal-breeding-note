// アイコンの定義（1 か所に集める）。線画は 24px の格子・線・角丸で描き、色は文字色（currentColor）。線の太さは CSS で決める
//（svg の属性の 2 は既定）。要素は ui/dom.js の svgElement（createElementNS）で作る（HTML の文字列は使わない）。
// 配信する画像に生成画像は使わない（data/SOURCES.md の「画像の扱い」）
import { svgElement } from './dom.js';

/**
 * 名前 → 図形の並び（`<tag attr="…"/>` の決まった形の文字列。shape() が要素にする）。box を持つものはその格子（既定 24）。
 * ナビのアイコンは views/tabs.js の TABS のキー（navIcon と空の状態の empty の icon）。逆引き・一覧のアイコンは find-merge、下書きのアイコンは register-entry で消し、ウィッシュリストの星は goals-merge で star にした
 */
export const ICONS = Object.freeze({
  search: ['<circle cx="10.5" cy="10.5" r="6.5"/>', '<path d="m15.5 15.5 5 5"/>'],
  route: ['<circle cx="6" cy="19" r="2.5"/>', '<circle cx="18" cy="5" r="2.5"/>', '<path d="M8.5 19H17a3.5 3.5 0 0 0 0-7H7a3.5 3.5 0 0 1 0-7h8.5"/>'],
  owned: ['<rect x="3" y="4" width="18" height="5" rx="1.5"/>', '<path d="M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9"/>', '<path d="M10 13h4"/>'],
  ideal: ['<path d="M7 4h10l4 5-9 11L3 9z"/>', '<path d="M3 9h18"/>', '<path d="m10 4-2 5 4 11 4-11-2-5"/>'],
  // 星（「☆ 目標に登録」。前はウィッシュリストのタブのアイコン。goals-merge でタブを外して名前を star に）
  star: ['<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z"/>'],
  settings: ['<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/>', '<circle cx="15" cy="7" r="2"/>', '<circle cx="9" cy="17" r="2"/>'],
  // 配合カード・目標・ウィッシュリストの行の操作（ui/breeding-card.js の actionIcon）
  edit: ['<path d="M14 5l5 5M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/>'],
  remove: ['<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>'],
  // ヘッダーのベル（ui/notifications.js）
  bell: ['<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>'],
  // 通知欄の更新内容のお知らせの記号（パルの画像がない行。bell）
  info: ['<circle cx="12" cy="12" r="9"/>', '<path d="M12 11v5.5"/>', '<path d="M12 7.6v.01"/>'],
  // 閉じる・外す「×」（ダイアログ・パル選択の解除・パッシブのチップ・エラーのトースト。名前はボタンの aria-label）
  close: ['<path d="M6 6l12 12M18 6 6 18"/>'],
  // パル選択の選んでいる行の ✓（前は 16px の格子の M3 8.5 6.5 12 13 4.5）
  check: ['<path d="M4.5 12.75 9.75 18 19.5 6.75"/>'],
  // 組の目的の札（理想個体）: 王冠＝完全体作成組、つながった 2 つの輪＝パッシブ厳選組、3 本のバー＝個体値厳選組。12px の格子の塗り（線なし）
  'group-complete': { box: 12, shapes: ['<path d="M1.5 9.8 1 3.4l2.8 2.2L6 1.8l2.2 3.8L11 3.4l-.5 6.4z" fill="currentColor" stroke="none"/>'] },
  'group-passive': { box: 12, shapes: ['<circle cx="4.2" cy="6" r="2.8" stroke-width="1.4"/>', '<circle cx="7.8" cy="6" r="2.8" stroke-width="1.4"/>'] },
  'group-talent': {
    box: 12,
    shapes: ['<rect x="1" y="7" width="2.4" height="4" rx="0.5" fill="currentColor" stroke="none"/>', '<rect x="4.8" y="4" width="2.4" height="7" rx="0.5" fill="currentColor" stroke="none"/>',
      '<rect x="8.6" y="1" width="2.4" height="10" rx="0.5" fill="currentColor" stroke="none"/>'],
  },
});

// 上の決まった形の図形の文字列を要素にする（属性は svgElement で付ける。style・on* は投げる）
function shape(markup) {
  const [, tag, attributes] = markup.match(/^<(\w+)\s+(.*?)\/>$/);
  return svgElement(tag, Object.fromEntries([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value])));
}

/**
 * アイコンの svg（読み上げない・フォーカスしない）。知らない名前は中身のない svg（投げない）。
 * className で大きさ・線の太さを CSS から決める（ナビは tab-icon、閉じる × は close-icon など）
 */
export function icon(name, { className = 'icon' } = {}) {
  const entry = ICONS[name];
  const { box = 24, shapes = [] } = Array.isArray(entry) ? { shapes: entry } : entry ?? {};
  const svg = svgElement('svg', {
    class: className, viewBox: `0 0 ${box} ${box}`, 'aria-hidden': 'true', focusable: 'false',
    fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  });
  for (const markup of shapes) svg.append(shape(markup));
  return svg;
}
