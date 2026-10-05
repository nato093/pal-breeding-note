import { el } from './dom.js';

// 裏で送っている操作の進み具合のバー。1 件の中の進み具合は取れないため、済んだ件数で伸ばし、
// 送っている最中であることは流れる光（CSS）で示す。送信待ちがなくなったら隠す。
export function syncProgress() {
  const element = el('div', 'sync-progress');
  element.setAttribute('role', 'progressbar');
  element.setAttribute('aria-label', 'サーバへの保存');
  element.setAttribute('aria-valuemin', 0);
  element.append(el('div', 'sync-progress-fill'));
  element.hidden = true;
  return {
    element,
    update({ syncing, syncDone, syncTotal }) {
      element.hidden = !syncing;
      if (!syncing) return;
      element.setAttribute('aria-valuemax', syncTotal);
      element.setAttribute('aria-valuenow', syncDone);
      element.style.setProperty('--progress', `${syncDone / syncTotal * 100}%`);
    },
  };
}
