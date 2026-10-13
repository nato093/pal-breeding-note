// 押すと説明の小さな板を開く部品（理想個体の組の札・除外の内訳など）。板は ui/popover.js で body に浮かせる（固定配置）ので、
// 開いても周りの要素は動かない。中身は textContent だけで組む（HTML の文字列は受けない）。
import { el, button } from './dom.js';
import { createPopover } from './popover.js';

// 板は 1 度に 1 つ（ほかの説明を開いたら前の板を閉じる）
let current = null;

// 中身（文字列・要素・その配列。関数なら開くたびに呼ぶ）を板に入れる要素にする。文字列は段落にする
function contentNodes(content) {
  const made = typeof content === 'function' ? content() : content;
  return (Array.isArray(made) ? made : [made])
    .filter((item) => item !== null && item !== undefined && item !== false && item !== '')
    .map((item) => (typeof item === 'string' ? el('p', 'hint-text', item) : item));
}

/**
 * 押すと説明の小さな板を開くボタン（クリック・Enter・Space で開閉、Esc で閉じてボタンにフォーカスを戻す。
 * 外側を押したときは、押した先にフォーカスを任せる〔ui/popover.js と同じ〕）。
 * trigger を渡すと、その要素（タグなど）を開くボタンとして使う（見えている文が名前のまま。aria-label は付けない）。
 * 渡さなければ「?」のボタン（aria-label「〈label〉の説明」）を作る。
 * content は文字列か、板の中身（文字列・要素・その配列）を返す関数（開くたびに呼ぶ）。
 * @param {{ label: string, content: string | (() => any), trigger?: HTMLElement }} options
 * open() はボタンを押したのと同じく板を開く（押したときに部品を作る呼び出し側が、その押した 1 回で開くため）。
 * @returns {{ element: HTMLElement, open: () => void, close: () => void, destroy: () => void }}
 */
export function hint({ label, content, trigger }) {
  const element = trigger ?? button('?', null, 'hint-button');
  if (trigger) element.classList.add('hint-trigger');
  else element.setAttribute('aria-label', `${label}の説明`);
  const listeners = new AbortController();
  let destroyed = false;
  const self = {};
  const popover = createPopover({
    anchor: element, wrapper: element, host: document.body, className: 'picker-popover hint-popover',
    place: { minWidth: 280, maxHeight: 320 },
    onOpen() {
      if (current && current !== self) current.close();
      current = self;
      // 付けた後に中身を入れる（板は読み上げの status なので、入れた文が読まれる）
      popover.element.replaceChildren(...contentNodes(content));
    },
    onClose() {
      if (current === self) current = null;
      popover.element.replaceChildren();
    },
  });
  popover.element.setAttribute('role', 'status');
  self.close = () => popover.close({ focus: false });
  element.addEventListener('click', () => {
    if (destroyed) return;
    if (popover.isOpen()) popover.close();
    else popover.open();
  }, { signal: listeners.signal });
  return {
    element,
    open() {
      if (!destroyed && !popover.isOpen()) popover.open();
    },
    close: self.close,
    destroy() {
      destroyed = true;
      listeners.abort();
      popover.destroy();
    },
  };
}
