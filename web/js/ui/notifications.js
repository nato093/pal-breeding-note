import { el, button, empty } from './dom.js';
import { openDialog } from './dialog.js';
import { svgIcon } from './breeding-card.js';

const BELL = 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0';

const formatDate = (time) => new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric' }).format(new Date(time));

function notificationList(notifications, unread = new Set()) {
  const list = el('ul', 'notification-list');
  for (const notification of notifications) {
    const item = el('li', 'notification-item');
    const meta = el('p', 'notification-meta');
    const date = el('time', '', formatDate(notification.time));
    date.setAttribute('datetime', notification.date);
    meta.append(date);
    if (unread.has(notification.id)) meta.append(el('span', 'unread-chip', '未読'));
    item.append(meta, el('strong', 'notification-title', notification.title));
    if (notification.body) item.append(el('p', 'notification-body', notification.body));
    list.append(item);
  }
  return list;
}

// 既読も含めた全件を出す。開いた時点で未読だった通知に印を付け、すべて既読にする。
export function openNotificationList(notifications) {
  const all = notifications.list();
  const unread = new Set(notifications.unread().map((notification) => notification.id));
  const modal = openDialog('通知一覧', { className: 'notification-dialog' });
  modal.body.append(all.length ? notificationList(all, unread) : empty('通知はありません。'));
  modal.footer.append(button('閉じる', modal.close, 'button secondary'));
  notifications.markRead([...unread]);
  return modal;
}

// 右上のベル。未読の数を出し、開くと未読の通知を並べて既読にする（既読の通知は設定タブの通知一覧で見る）。
export function notificationMenu(notifications) {
  let closePanel = null;
  const wrapper = el('div', 'notification-menu');
  const trigger = button('', () => closePanel ? closePanel() : open(), 'icon-button notification-button');
  const panelId = `notifications-${crypto.randomUUID()}`;
  trigger.title = '通知';
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', panelId);
  const badge = el('span', 'notification-badge');
  badge.setAttribute('aria-hidden', 'true');
  trigger.append(svgIcon(BELL), badge);
  wrapper.append(trigger);

  function update() {
    const count = notifications.unread().length;
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.hidden = count === 0;
    trigger.setAttribute('aria-label', count ? `通知（未読 ${count} 件）` : '通知');
  }

  function open() {
    const items = notifications.unread();
    const panel = el('section', 'notification-panel');
    panel.id = panelId;
    panel.setAttribute('aria-label', '通知');
    panel.append(el('h2', '', '通知'), items.length ? notificationList(items)
      : el('p', 'muted notification-empty', '新しい通知はありません。これまでの通知は設定タブの「通知一覧」で見られます。'));
    const controller = new AbortController();
    closePanel = () => {
      controller.abort();
      panel.remove();
      closePanel = null;
      trigger.setAttribute('aria-expanded', 'false');
    };
    wrapper.append(panel);
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', (event) => { if (!wrapper.contains(event.target)) closePanel?.(); }, { signal: controller.signal });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      closePanel?.();
      trigger.focus();
    }, { signal: controller.signal });
    notifications.markRead(items.map((item) => item.id));
  }

  notifications.subscribe(update);
  update();
  return { element: wrapper, update, close() { closePanel?.(); } };
}
