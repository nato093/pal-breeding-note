// ヘッダーの右端の ID。押すと小さなメニュー（名前の変更・ログアウト）を開く。
// メニューの中身は開いたときだけ作る（設定タブの同じ名前のボタンと取り違えないように）。
import { el, button } from './dom.js';
import { createPopover } from './popover.js';
import { openRenameDialog, confirmLogout } from './account-actions.js';

export function accountMenu(context) {
  const { store, renamer } = context;
  const element = el('div', 'account-chip');
  const trigger = button('', () => (popup.isOpen() ? popup.close({ focus: false }) : popup.open()), 'account-button');
  element.append(trigger);

  // 開いている間の書き換え（閉じているときは null）
  let renderPanel = null;
  const popup = createPopover({
    anchor: trigger, wrapper: element, tag: 'section', className: 'header-panel account-panel',
    onOpen: () => { renderPanel = buildPanel(); },
    onClose: () => { renderPanel = null; popup.element.replaceChildren(); },
  });
  popup.element.setAttribute('aria-label', 'アカウント');
  function buildPanel() {
    const id = el('p', 'account-panel-id');
    // メニューを閉じてボタンへフォーカスを戻してから、ダイアログを開く（閉じた後のフォーカスがボタンに戻る）
    const rename = button('名前を変更', () => {
      popup.close();
      openRenameDialog(context);
    }, 'header-menu-item');
    const logout = button('ログアウト', () => {
      popup.close();
      confirmLogout(store);
    }, 'header-menu-item danger-text');
    popup.element.replaceChildren(el('h2', '', 'ログイン中の ID'), id, ...(renamer ? [rename] : []), logout);
    const render = () => {
      id.textContent = store.state.userId;
      // 途中で止まった名前の変更は、設定タブの「再試行」で同じ内容でやり直す
      rename.hidden = Boolean(renamer?.pending());
      // 名前の変更中は、ログアウトや別の変更をさせない
      rename.disabled = store.state.renaming;
      logout.disabled = store.state.renaming;
    };
    render();
    return render;
  }

  let shownId = null;
  function update(state = store.state) {
    if (state.userId !== shownId) {
      shownId = state.userId;
      trigger.textContent = state.userId;
      trigger.title = state.userId;
      trigger.setAttribute('aria-label', `ログイン中の ID: ${state.userId}（名前の変更・ログアウト）`);
    }
    renderPanel?.();
  }

  const unsubscribe = store.subscribe(update);
  update();
  return {
    element, update, close: () => popup.close({ focus: false }),
    destroy() {
      popup.destroy();
      unsubscribe();
    },
  };
}
