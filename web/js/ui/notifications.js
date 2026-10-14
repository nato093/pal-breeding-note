import { el, button, link, empty, statusChip } from './dom.js';
import { openDialog } from './dialog.js';
import { icon } from './icons.js';
import { groupNotifications } from '../notifications.js';

const formatDate = (time) => new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric' }).format(new Date(time));

// まとめた行の「ほか N 件」は、折り返しで「ほ／か」と分かれないよう 1 つの塊（.notification-more）にする
function notificationBody({ body, more }) {
  if (!more || !body.endsWith(more)) return el('p', 'notification-body', body);
  const paragraph = el('p', 'notification-body', body.slice(0, body.length - more.length));
  paragraph.append(el('span', 'notification-more', more));
  return paragraph;
}

// 開く先がある通知は全体をリンクにし、押したら onOpen で通知欄を閉じる（画面の切り替えはリンクに任せる）。
// rows は groupNotifications の行。まとめた行は、まとめた通知のどれかが未読なら未読の印を付け、全部の本文を重ねたときの説明に出す
function notificationList(rows, unread, onOpen) {
  const list = el('ul', 'notification-list');
  for (const notification of rows) {
    const item = el('li', 'notification-item');
    const content = notification.href ? link('', notification.href, 'notification-link') : item;
    const meta = el('p', 'notification-meta');
    const date = el('time', '', formatDate(notification.time));
    date.setAttribute('datetime', notification.date);
    meta.append(date);
    if (notification.ids.some((id) => unread.has(id))) meta.append(statusChip('未読', 'info', 'unread-chip'));
    content.append(meta, el('strong', 'notification-title', notification.title));
    if (notification.body) content.append(notificationBody(notification));
    if (notification.count > 1) content.title = notification.items.map((item) => item.body).join('\n');
    if (content !== item) {
      content.addEventListener('click', onOpen);
      item.append(content);
    }
    list.append(item);
  }
  return list;
}

// 行の並び（まとめた通知の id）が変わったときだけ描き直す（記録の取得のたびに作り直すと、操作中のフォーカスを失う）。
const listKey = (rows) => rows.map((row) => row.ids.join('\t')).join('\n');

// 既読も含めた全件を出す（自動登録の成功は同じ読み込みの分を 1 行にまとめる）。開いた時点で未読だった通知に印を付け、すべて既読にする。
export function openNotificationList(notifications) {
  const unread = new Set(notifications.unread().map((notification) => notification.id));
  let unsubscribe = () => {};
  const modal = openDialog('通知一覧', { className: 'notification-dialog', onClose: () => unsubscribe() });
  let shown = null;
  // 開いている間に元の記録やウィッシュリストが変わったら、消えた通知を外す。
  const render = () => {
    const rows = groupNotifications(notifications.list());
    if (listKey(rows) === shown) return;
    shown = listKey(rows);
    modal.body.replaceChildren(rows.length ? notificationList(rows, unread, modal.close) : empty('通知はありません。'));
  };
  render();
  unsubscribe = notifications.subscribe(render);
  modal.footer.append(button('閉じる', modal.close, 'button secondary'));
  notifications.markRead([...unread]);
  return modal;
}

// 右上のベル。未読の数を出し、開くと未読の通知を並べて既読にする（既読の通知は、未読がないときのボタン「これまでの通知」と設定の通知一覧で見る）。
// 数とパネルは通知一覧と同じまとめ表示の行で数える（同じ読み込みの自動登録 3 件は 1）。既読にするのは元の通知の id 全部。
// onOpen は開いたときに呼ぶ（app.js がヘッダーのほかのパネルを閉じる）
export function notificationMenu(notifications, { onOpen } = {}) {
  let closePanel = null;
  let renderPanel = null;
  const wrapper = el('div', 'notification-menu');
  const trigger = button('', () => closePanel ? closePanel() : open(), 'icon-button notification-button');
  const panelId = `notifications-${crypto.randomUUID()}`;
  trigger.title = '通知';
  // aria-controls は開いている間だけ（閉じている間はパネルが DOM に無い）
  trigger.setAttribute('aria-expanded', 'false');
  const badge = el('span', 'notification-badge');
  badge.setAttribute('aria-hidden', 'true');
  trigger.append(icon('bell'), badge);
  wrapper.append(trigger);

  function update() {
    const count = groupNotifications(notifications.unread()).length;
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
      const rows = groupNotifications(notifications.list().filter((item) => opened.has(item.id)));
      if (listKey(rows) === shown) return;
      shown = listKey(rows);
      panel.replaceChildren(el('h2', '', '通知'), rows.length ? notificationList(rows, new Set(), () => closePanel?.()) : emptyPanel());
    };
    // 未読がないとき: 1 文と、既読も含めた通知一覧を開くボタン（パネルを閉じ、一覧を閉じたらベルへフォーカスを戻す）
    const emptyPanel = () => {
      const node = el('div', 'notification-empty');
      node.append(el('p', 'muted', '新しい通知はありません。'), button('これまでの通知', () => {
        closePanel?.();
        trigger.focus();
        openNotificationList(notifications);
      }, 'button secondary small'));
      return node;
    };
    renderPanel();
    const controller = new AbortController();
    closePanel = () => {
      controller.abort();
      panel.remove();
      closePanel = null;
      renderPanel = null;
      trigger.setAttribute('aria-expanded', 'false');
      trigger.removeAttribute('aria-controls');
    };
    wrapper.append(panel);
    trigger.setAttribute('aria-expanded', 'true');
    trigger.setAttribute('aria-controls', panelId);
    document.addEventListener('pointerdown', (event) => { if (!wrapper.contains(event.target)) closePanel?.(); }, { signal: controller.signal });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      closePanel?.();
      trigger.focus();
    }, { signal: controller.signal });
    notifications.markRead([...opened]);
    onOpen?.();
  }

  notifications.subscribe(update);
  update();
  return { element: wrapper, update, close() { closePanel?.(); } };
}
