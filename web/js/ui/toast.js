import { el, button } from './dom.js';

let region;
// 一番手前のダイアログ（なければ本文）に出す。成功の知らせは応答後に出るため、無関係なダイアログに出ることがある。
// そのダイアログを閉じても、残っている知らせ（元に戻すなど）は消さずに次の表示先へ移す。
function currentRegion() {
  const host = [...document.querySelectorAll('dialog[open]')].at(-1) ?? document.body;
  if (region?.isConnected && region.parentElement === host) return region;
  const created = el('div', 'toast-region');
  created.setAttribute('aria-live', 'polite');
  host.append(created);
  if (host !== document.body) host.addEventListener('close', () => {
    if (created.children.length) currentRegion().append(...created.children);
  }, { once: true });
  region = created;
  return created;
}

export function toast(message, { action, actionLabel = '元に戻す', duration = 3000 } = {}) {
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
  currentRegion().append(node);
  timer = setTimeout(dismiss, duration);
  return dismiss;
}
