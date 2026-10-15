import { el, button, link, empty, statusChip } from './dom.js';
import { openDialog } from './dialog.js';
import { icon } from './icons.js';
import { palIcon, palsById } from './pal-icon.js';
import { captureFocus, restoreFocus } from './focus.js';
import { groupNotifications, notificationCategory, unreadCounts } from '../notifications.js';

const formatDate = (time) => new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric' }).format(new Date(time));

// 種類のチップ（1 つだけ選ぶ）。分類は notifications.js の notificationCategory（表示のときに決める）
const CATEGORY_CHIPS = [['all', 'すべて'], ['release', '更新内容'], ['goal', '目標'], ['auto', '自動登録']];
// パルの画像がない通知の記号（種類ごと。更新内容のお知らせは 1 種類の記号）
const CATEGORY_ICONS = { release: 'info', goal: 'star', auto: 'owned', other: 'bell' };
// ベルのパネルに出す行の数（新しい順。それより前は「すべての通知を見る」の一覧で）
const PANEL_ROWS = 30;

/** 絞り込みの状態（ベルの中に覚える。ページを読み込み直すと既定の「すべて」） */
export const notificationFilter = () => ({ category: 'all', unreadOnly: false });

// まとめた行の「ほか N 件」は、1 行に省略しても残るよう本文と分けた塊（.notification-more）にする
function notificationBody({ body, more }) {
  const paragraph = el('p', 'notification-body');
  if (!more || !body.endsWith(more)) {
    paragraph.append(el('span', 'notification-lead', body));
    return paragraph;
  }
  paragraph.append(el('span', 'notification-lead', body.slice(0, body.length - more.length)), el('span', 'notification-more', more));
  return paragraph;
}

// 行の左の 32px の絵（パルがあればその絵、なければ種類の記号）
function rowVisual(row) {
  const visual = el('span', 'notification-visual');
  const pal = row.palId ? palsById.get(row.palId) : null;
  visual.append(pal ? palIcon(pal) : icon(CATEGORY_ICONS[notificationCategory(row)] ?? 'bell', { className: 'notification-kind-icon' }));
  return visual;
}

/**
 * 通知の 1 行（ベルのパネルと通知一覧で同じ形）。開く先がある行は全体をリンクにし、押したらその行の通知（まとめた行は全部）を既読にして
 * onNavigate（パネル・一覧を閉じる。画面の切り替えはリンクに任せる）。未読の行は「未読」のチップと「既読にする」の小さなボタン
 */
function notificationRow(row, { unread, onRead, onNavigate }) {
  const item = el('li', 'notification-item');
  const isUnread = row.ids.some((id) => unread.has(id));
  item.classList.toggle('is-unread', isUnread);
  const content = row.href ? link('', row.href, 'notification-link') : el('div', 'notification-content');
  content.setAttribute('data-focus-key', `notification:${row.id}:open`);
  // 開く先のない行も、「既読にする」が消えた後のフォーカスの受け先にする（Tab では止まらない）
  if (!row.href) content.setAttribute('tabindex', '-1');
  const text = el('div', 'notification-text');
  const meta = el('p', 'notification-meta');
  const date = el('time', 'notification-date', formatDate(row.time));
  date.setAttribute('datetime', row.date);
  meta.append(el('strong', 'notification-title', row.title), date);
  text.append(meta);
  if (row.body) text.append(notificationBody(row));
  content.append(rowVisual(row), text);
  // 本文は 1 行に省略するので、全文（まとめた行は全部の本文）は重ねたときの説明に
  content.title = row.count > 1 ? row.items.map((entry) => entry.body).join('\n') : row.body;
  if (row.href) {
    content.addEventListener('click', () => {
      onRead(row.ids);
      onNavigate();
    });
  }
  item.append(content);
  // 右の列は既読の行でも幅を取る（未読と既読の行で日付の位置をそろえる）
  const side = el('div', 'notification-side');
  item.append(side);
  if (isUnread) {
    const read = button('', () => onRead(row.ids, { fromButton: true }), 'icon-button notification-read');
    read.append(icon('check'));
    read.setAttribute('aria-label', `「${row.title}」を既読にする`);
    read.title = '既読にする';
    // 押して行の印が消えたら、同じ行の本体へ（「未読だけ」で行ごと消えたら呼び出し側が次の行へ）
    read.setAttribute('data-focus-key', `notification:${row.id}:read`);
    read.setAttribute('data-focus-fallback', `notification:${row.id}:open`);
    side.append(statusChip('未読', 'info', 'unread-chip'), read);
  }
  return item;
}

// 行の並びと既読の状態が変わったときだけ描き直す（記録の取得のたびに作り直すと、操作中のフォーカスを失う）
const listKey = (rows, unread, total) => `${total}\n${rows.map((row) => `${row.ids.join('\t')}:${row.ids.some((id) => unread.has(id)) ? 1 : 0}`).join('\n')}`;

/**
 * 通知の一覧の中身（頭の「すべて既読」・種類のチップと「未読だけ」・行）。ベルのパネルと通知一覧のダイアログで使う。
 * filter（notificationFilter）は呼び出し側が持ち、チップで書き換える（パネルと一覧で同じものを渡すと、選んだ種類が引き継がれる）。
 * limit は出す行の数（パネルは PANEL_ROWS）。開いただけでは既読にしない（「すべて既読」・行の「既読にする」・行を押したときだけ）
 */
function notificationBrowser(notifications, filter, { heading = '', limit = Infinity, onNavigate = () => {} } = {}) {
  const element = el('div', 'notification-browser');
  const head = el('div', 'notification-head');
  const allRead = button('すべて既読', () => {
    const ids = shownRows.flatMap((row) => row.ids).filter((id) => unread.has(id));
    if (ids.length) notifications.markRead(ids);
  }, 'button quiet small notification-all-read');
  allRead.setAttribute('data-focus-key', 'notification:all-read');
  const filters = el('div', 'notification-filters');
  const kinds = el('div', 'notification-kinds');
  kinds.setAttribute('role', 'group');
  kinds.setAttribute('aria-label', '種類');
  const kindButtons = CATEGORY_CHIPS.map(([value, label]) => {
    const chip = button(label, () => {
      if (filter.category === value) return;
      filter.category = value;
      render({ force: true });
    }, 'notification-chip');
    chip.setAttribute('data-value', value);
    kinds.append(chip);
    return chip;
  });
  const unreadOnly = button('未読だけ', () => {
    filter.unreadOnly = !filter.unreadOnly;
    render({ force: true });
  }, 'notification-chip notification-unread-only');
  filters.append(kinds, unreadOnly);
  const body = el('div', 'notification-rows');
  // 見出しがあれば（ベルのパネル）見出しの行の右に、なければ（通知一覧。ダイアログの題名がある）チップの行の右端に「すべて既読」
  if (heading) {
    head.append(el('h2', '', heading), allRead);
    element.append(head);
  } else filters.append(allRead);
  element.append(filters, body);

  let unread = new Set();
  let shownRows = [];
  let shown = null;
  // 「既読にする」で「未読だけ」の行が消えたときに、同じ位置の行へフォーカスを移すための位置
  let readFrom = -1;
  const onRead = (ids, { fromButton = false } = {}) => {
    readFrom = fromButton ? shownRows.findIndex((row) => row.ids.some((id) => ids.includes(id))) : -1;
    notifications.markRead(ids);
  };

  function render({ force = false } = {}) {
    unread = new Set(notifications.unread().map((item) => item.id));
    for (const chip of kindButtons) chip.setAttribute('aria-pressed', String(chip.getAttribute('data-value') === filter.category));
    unreadOnly.setAttribute('aria-pressed', String(filter.unreadOnly));
    const matching = notifications.list().filter((item) => (filter.category === 'all' || notificationCategory(item) === filter.category)
      && (!filter.unreadOnly || unread.has(item.id)));
    const rows = groupNotifications(matching);
    const key = `${filter.category}:${filter.unreadOnly}\n${listKey(rows.slice(0, limit), unread, rows.length)}`;
    allRead.disabled = !rows.some((row) => row.ids.some((id) => unread.has(id)));
    if (key === shown && !force) return;
    shown = key;
    shownRows = rows;
    const token = captureFocus(body);
    const list = el('ul', 'notification-list');
    for (const row of rows.slice(0, limit)) list.append(notificationRow(row, { unread, onRead, onNavigate }));
    body.replaceChildren(rows.length ? list : empty(filter.unreadOnly ? '未読の通知はありません。' : '新しい通知はありません。'));
    // 押した部品が消えたら、同じ役目の部品 → 同じ位置の行 → 「すべて既読」の順に移す
    if (token && !restoreFocus(body, token)) {
      const items = list.children;
      const next = readFrom >= 0 ? items[Math.min(readFrom, items.length - 1)] : null;
      (next?.querySelector('.notification-read') ?? next?.querySelector('[data-focus-key]') ?? allRead).focus({ preventScroll: true });
    }
    readFrom = -1;
  }
  render();
  const unsubscribe = notifications.subscribe(() => render());
  return { element, render, destroy: unsubscribe };
}

/** 既読も含めた全件（自動登録の成功は同じ読み込みの分を 1 行にまとめる）。開いただけでは既読にしない */
export function openNotificationList(notifications, { filter = notificationFilter() } = {}) {
  let browser = null;
  const modal = openDialog('通知一覧', { className: 'notification-dialog', onClose: () => browser?.destroy() });
  browser = notificationBrowser(notifications, filter, { onNavigate: () => modal.close() });
  modal.body.append(browser.element);
  modal.footer.append(button('閉じる', modal.close, 'button secondary'));
  return modal;
}

/**
 * 右上のベル。赤い数字は更新内容のお知らせ以外の未読（同じ読み込みの自動登録 3 件は 1）、お知らせだけが未読なら数字のない点。
 * 要確認の未読が増えたときに 1 回だけ揺らす。開くと既読も含めた通知を新しい順に PANEL_ROWS 行まで出し、下端の「すべての通知を見る →」で
 * 通知一覧を開く。開いただけでは既読にしない。onOpen は開いたときに呼ぶ（app.js がヘッダーのほかのパネルを閉じる）
 */
export function notificationMenu(notifications, { onOpen } = {}) {
  let closePanel = null;
  let browser = null;
  let lastActionable = null;
  const filter = notificationFilter();
  const wrapper = el('div', 'notification-menu');
  const trigger = button('', () => closePanel ? closePanel() : open(), 'icon-button notification-button');
  const panelId = `notifications-${crypto.randomUUID()}`;
  trigger.title = '通知';
  // aria-controls は開いている間だけ（閉じている間はパネルが DOM に無い）
  trigger.setAttribute('aria-expanded', 'false');
  const badge = el('span', 'notification-badge');
  badge.setAttribute('aria-hidden', 'true');
  trigger.append(icon('bell'), badge);
  trigger.addEventListener('animationend', () => trigger.classList.toggle('is-ringing', false));
  wrapper.append(trigger);

  function ring() {
    trigger.classList.toggle('is-ringing', false);
    // 続けて増えたときも頭から揺らす（クラスを付け直す前に一度描かせる）
    void trigger.offsetWidth;
    trigger.classList.toggle('is-ringing', true);
  }

  function update() {
    const { actionable, release } = unreadCounts(notifications);
    badge.textContent = actionable ? (actionable > 99 ? '99+' : String(actionable)) : '';
    badge.hidden = !actionable && !release;
    badge.classList.toggle('is-dot', !actionable && release > 0);
    const parts = [actionable ? `要確認 ${actionable} 件` : '', release ? `お知らせ ${release} 件` : ''].filter(Boolean);
    trigger.setAttribute('aria-label', parts.length ? `通知（${parts.join('・')}）` : '通知');
    if (lastActionable !== null && actionable > lastActionable) ring();
    lastActionable = actionable;
  }

  function open() {
    const panel = el('section', 'notification-panel');
    panel.id = panelId;
    panel.setAttribute('aria-label', '通知');
    browser = notificationBrowser(notifications, filter, { heading: '通知', limit: PANEL_ROWS, onNavigate: () => closePanel?.() });
    const footer = el('div', 'notification-footer');
    footer.append(button('すべての通知を見る →', () => {
      closePanel?.();
      trigger.focus();
      openNotificationList(notifications, { filter });
    }, 'button quiet small notification-show-all'));
    panel.append(browser.element, footer);
    const controller = new AbortController();
    closePanel = () => {
      controller.abort();
      browser?.destroy();
      browser = null;
      panel.remove();
      closePanel = null;
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
    onOpen?.();
  }

  notifications.subscribe(update);
  update();
  return { element: wrapper, update, close() { closePanel?.(); } };
}
