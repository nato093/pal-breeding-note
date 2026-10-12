// ヘッダーの右端の ID。押すと小さなメニュー（名前の変更・ログアウト）を開く。
// メニューの中身は開いたときだけ作る（設定タブの同じ名前のボタンと取り違えないように）。
import { el, button } from './dom.js';
import { headerPopup } from './header-popup.js';
import { openRenameDialog, confirmLogout } from './account-actions.js';

export function accountMenu(context) {
  const { store, renamer } = context;
  const element = el('div', 'account-chip');
  const trigger = button('', () => popup.toggle(), 'account-button');
  element.append(trigger);

  const popup = headerPopup({ wrapper: element, trigger, create: ({ close }) => {
    const panel = el('section', 'header-panel account-panel');
    panel.setAttribute('aria-label', 'アカウント');
    const id = el('p', 'account-panel-id');
    const rename = button('名前を変更', () => {
      close({ focus: true });
      openRenameDialog(context);
    }, 'header-menu-item');
    const logout = button('ログアウト', () => {
      close({ focus: true });
      confirmLogout(store);
    }, 'header-menu-item danger-text');
    panel.append(el('h2', '', 'ログイン中の ID'), id, ...(renamer ? [rename] : []), logout);
    const render = () => {
      id.textContent = store.state.userId;
      // 途中で止まった名前の変更は、設定タブの「再試行」で同じ内容でやり直す
      rename.hidden = Boolean(renamer?.pending());
      // 名前の変更中は、ログアウトや別の変更をさせない
      rename.disabled = store.state.renaming;
      logout.disabled = store.state.renaming;
    };
    render();
    return { panel, update: render };
  } });

  let shownId = null;
  function update(state = store.state) {
    if (state.userId !== shownId) {
      shownId = state.userId;
      trigger.textContent = state.userId;
      trigger.title = state.userId;
      trigger.setAttribute('aria-label', `ログイン中の ID: ${state.userId}（名前の変更・ログアウト）`);
    }
    popup.update();
  }

  const unsubscribe = store.subscribe(update);
  update();
  return {
    element, update, close: () => popup.close(),
    destroy() {
      popup.close();
      unsubscribe();
    },
  };
}
