import { el, button } from './dom.js';

export function openDialog(title, { className = '', onClose } = {}) {
  const previousFocus = document.activeElement;
  const dialog = el('dialog', `dialog ${className}`);
  const heading = el('h2', '', title);
  heading.id = `dialog-${crypto.randomUUID()}`;
  dialog.setAttribute('aria-labelledby', heading.id);
  const header = el('header', 'dialog-header');
  const close = () => dialog.close();
  const dismiss = button('×', close, 'icon-button');
  dismiss.setAttribute('aria-label', '閉じる');
  header.append(heading, dismiss);
  const body = el('div', 'dialog-body');
  const footer = el('footer', 'dialog-footer');
  dialog.append(header, body, footer);
  document.body.append(dialog);
  dialog.addEventListener('close', () => {
    dialog.remove();
    onClose?.();
    if (previousFocus?.isConnected) previousFocus.focus();
  }, { once: true });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });
  dialog.showModal();
  return { dialog, body, footer, close };
}

export function confirmDialog(title, text, { preview, confirmText = '続ける', danger = false } = {}) {
  return new Promise((resolve) => {
    let accepted = false;
    const modal = openDialog(title, { onClose: () => resolve(accepted) });
    modal.body.append(el('p', '', text));
    if (preview) modal.body.append(preview);
    modal.footer.append(button('キャンセル', modal.close, 'button secondary'), button(confirmText, () => {
      accepted = true;
      modal.close();
    }, danger ? 'button danger' : 'button primary'));
  });
}

export function closeDialogs() {
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
}
