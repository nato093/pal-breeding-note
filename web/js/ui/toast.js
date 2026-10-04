import { el, button } from './dom.js';

let region;
export function toast(message, { action, actionLabel = '元に戻す', duration = 3000 } = {}) {
  const host = [...document.querySelectorAll('dialog[open]')].at(-1) ?? document.body;
  if (!region?.isConnected || region.parentElement !== host) {
    region = el('div', 'toast-region');
    region.setAttribute('aria-live', 'polite');
    host.append(region);
  }
  const node = el('div', 'toast');
  node.append(el('span', '', message));
  let timer;
  const dismiss = () => { clearTimeout(timer); node.remove(); };
  if (action) {
    const undo = button(actionLabel, async () => {
      undo.disabled = true;
      clearTimeout(timer);
      try { await action(); dismiss(); } catch (error) {
        dismiss();
        toast(error.message);
      }
    }, 'button toast-action');
    node.append(undo);
  }
  region.append(node);
  timer = setTimeout(dismiss, duration);
  return dismiss;
}
