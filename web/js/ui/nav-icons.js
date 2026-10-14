// 左のナビゲーションのアイコン（定義は ui/icons.js。タブの名前で引く）。空の状態（ui/dom.js の empty の icon）も同じ絵を使う
import { icon } from './icons.js';

export function navIcon(view) {
  return icon(view, { className: 'tab-icon' });
}
