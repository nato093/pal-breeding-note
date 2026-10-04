import { el, button, link, empty } from './dom.js';
import { openDialog } from './dialog.js';
import { svgIcon } from './breeding-card.js';

const BELL = 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0';

const formatDate = (time) => new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric' }).format(new Date(time));

// 開く先がある通知は全体をリンクにし、押したら onOpen で通知欄を閉じる（画面の切り替えはリンクに任せる）。
function notificationList(notifications, unread, onOpen) {
  const list = el('ul', 'notification-list');
  for (const notification of notifications) {
    const item = el('li', 'notification-item');
    const content = notification.href ? link('', notification.href, 'notification-link') : item;
    const meta = el('p', 'notification-meta');
    const date = el('time', '', formatDate(notification.time));
    date.setAttribute('datetime', notification.date);
    meta.append(date);
    if (unread.has(notification.id)) meta.append(el('span', 'unread-chip', '未読'));
    content.append(meta, el('strong', 'notification-title', notification.title));
    if (notification.body) content.append(el('p', 'notification-body', notification.body));
    if (content !== item) {
      content.addEventListener('click', onOpen);
      item.append(content);
    }
    list.append(item);
  }
  return list;
}

// 通知の並びが変わったときだけ描き直す（記録の取得のたびに作り直すと、操作中のフォーカスを失う）。
const listKey = (notifications) => notifications.map((notification) => notification.id).join('\n');

// 既読も含めた全件を出す。開いた時点で未読だった通知に印を付け、すべて既読にする。
export function openNotificationList(notifications) {
  const unread = new Set(notifications.unread().map((notification) => notification.id));
  let unsubscribe = () => {};
  const modal = openDialog('通知一覧', { className: 'notification-dialog', onClose: () => unsubscribe() });
  let shown = null;
  // 開いている間に元の記録やウィッシュリストが変わったら、消えた通知を外す。
  const render = () => {
    const all = notifications.list();
    if (listKey(all) === shown) return;
    shown = listKey(all);
    modal.body.replaceChildren(all.length ? notificationList(all, unread, modal.close) : empty('通知はありません。'));
  };
  render();
  unsubscribe = notifications.subscribe(render);
  modal.footer.append(button('閉じる', modal.close, 'button secondary'));
  notifications.markRead([...unread]);
  return modal;
}

// 右上のベル。未読の数を出し、開くと未読の通知を並べて既読にする（既読の通知は設定タブの通知一覧で見る）。
export function notificationMenu(notifications) {
  let closePanel = null;
  let renderPanel = null;
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
    renderPanel?.();
  }

  function open() {
    const opened = new Set(notifications.unread().map((item) => item.id));
    const panel = el('section', 'notification-panel');
    panel.id = panelId;
    panel.setAttribute('aria-label', '通知');
    let shown = null;
    // 開いた時点の未読だけを出し、開いている間に元が消えた通知は外す。
    renderPanel = () => {
      const items = notifications.list().filter((item) => opened.has(item.id));
      if (listKey(items) === shown) return;
      shown = listKey(items);
      panel.replaceChildren(el('h2', '', '通知'), items.length ? notificationList(items, new Set(), () => closePanel?.())
        : el('p', 'muted notification-empty', '新しい通知はありません。これまでの通知は設定タブの「通知一覧」で見られます。'));
    };
    renderPanel();
    const controller = new AbortController();
    closePanel = () => {
      controller.abort();
      panel.remove();
      closePanel = null;
      renderPanel = null;
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
    notifications.markRead([...opened]);
  }

  notifications.subscribe(update);
  update();
  return { element: wrapper, update, close() { closePanel?.(); } };
}
