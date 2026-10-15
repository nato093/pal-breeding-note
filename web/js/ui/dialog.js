import { el, button } from './dom.js';
import { icon } from './icons.js';

/**
 * モーダルのダイアログ。×・背景（closeOnBackdrop のとき）・Esc・呼び出し側のキャンセルのボタンは、どれも requestClose(reason) を通る。
 * beforeClose(reason) が false を返したら閉じない（reason: 'dismiss'〔×〕・'cancel'〔キャンセルのボタン〕・'escape'・'backdrop'）。
 * requestClose を通らずに閉じた（ブラウザが Esc の取り消しを無視した・closeDialogs で閉じた）ときは、閉じた後に beforeClose('forced') を
 * 呼ぶ（戻り値は使えない）。close() は確かめずに閉じる（保存に成功した後など）。initialFocus（要素）があれば、開いた後にそこへフォーカス
 * @returns {{ dialog, body, footer, close(): void, requestClose(reason: string): boolean }}
 */
export function openDialog(title, { className = '', onClose, closeOnBackdrop = true, beforeClose, initialFocus } = {}) {
  const previousFocus = document.activeElement;
  const dialog = el('dialog', `dialog ${className}`);
  const heading = el('h2', '', title);
  heading.id = `dialog-${crypto.randomUUID()}`;
  dialog.setAttribute('aria-labelledby', heading.id);
  const header = el('header', 'dialog-header');
  // requestClose か close で閉じたか（閉じた後に、それ以外の閉じ方〔forced〕を見分ける）
  let requested = false;
  const close = () => {
    requested = true;
    return dialog.open ? dialog.close() : undefined;
  };
  const requestClose = (reason) => {
    if (beforeClose && beforeClose(reason) === false) return false;
    close();
    return true;
  };
  // × は SVG のアイコン（ui/icons.js の close）。名前は aria-label
  const dismiss = button('', () => requestClose('dismiss'), 'icon-button dialog-close');
  dismiss.append(icon('close', { className: 'close-icon' }));
  dismiss.setAttribute('aria-label', '閉じる');
  header.append(heading, dismiss);
  const body = el('div', 'dialog-body');
  const footer = el('footer', 'dialog-footer');
  dialog.append(header, body, footer);
  document.body.append(dialog);
  // 閉じたら外すリスナー（Esc・背景のクリック）
  const listeners = new AbortController();
  dialog.addEventListener('close', () => {
    listeners.abort();
    if (!requested && beforeClose) beforeClose('forced');
    dialog.remove();
    onClose?.();
    if (previousFocus?.isConnected) previousFocus.focus();
  }, { once: true });
  // Esc（cancel）: 中の候補（ポップオーバー）を開いていれば、候補が先に閉じる（ui/popover.js が cancel を止める）。開いていなければ、
  // ブラウザの閉じ方を止めて requestClose を通す
  dialog.addEventListener('cancel', (event) => {
    if (dialog.querySelector('[aria-expanded="true"]')) return;
    event.preventDefault();
    requestClose('escape');
  }, { signal: listeners.signal });
  dialog.addEventListener('click', (event) => { if (closeOnBackdrop && event.target === dialog) requestClose('backdrop'); }, { signal: listeners.signal });
  dialog.showModal();
  initialFocus?.focus?.();
  return { dialog, body, footer, close, requestClose };
}

export function confirmDialog(title, text, { preview, confirmText = '続ける', cancelText = 'キャンセル', danger = false } = {}) {
  return new Promise((resolve) => {
    let accepted = false;
    const modal = openDialog(title, { onClose: () => resolve(accepted) });
    // 確かめる文は、ダイアログの説明として読み上げる（aria-describedby）
    const description = el('p', '', text);
    description.id = `dialog-text-${crypto.randomUUID()}`;
    modal.dialog.setAttribute('aria-describedby', description.id);
    modal.body.append(description);
    if (preview) modal.body.append(preview);
    modal.footer.append(button(cancelText, () => modal.requestClose('cancel'), 'button secondary'), button(confirmText, () => {
      accepted = true;
      modal.close();
    }, danger ? 'button danger' : 'button primary'));
  });
}

export function closeDialogs() {
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
}
