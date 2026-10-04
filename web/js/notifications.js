import releaseNotes from './release-notes.js';
import { userIdKey } from './core/user.js';
import { sanitizeText } from './core/validate.js';

// 通知欄に収まる長さ。更新内容のお知らせはテストでこの長さを守り、ほかの通知は超えた分を省いて表示する。
export const TITLE_MAX = 20;
export const BODY_MAX = 60;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function clip(value, max) {
  const text = sanitizeText(typeof value === 'string' ? value : '', Infinity);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// 日付だけの指定は、端末の時刻でその日の 0 時として扱う。
export function notificationTime(date) {
  const match = typeof date === 'string' ? date.match(DATE_ONLY) : null;
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime() : Date.parse(date);
}

// どの種類の通知も、この形にそろえて通知欄に出す。
// id: 既読の判定に使う変わらない文字列 / date: 'YYYY-MM-DD' か ISO 日時 / title・body: 表示する文
// href: 押したときに開く画面（任意）。外部の URL や script を開かないよう、画面内のハッシュ（#/…）だけを受け付ける。
export function cleanNotification(value) {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id) return null;
  const time = notificationTime(value.date);
  const title = clip(value.title, TITLE_MAX);
  if (!Number.isFinite(time) || !title) return null;
  const notification = { id: value.id, date: value.date, time, title, body: clip(value.body, BODY_MAX) };
  if (typeof value.href === 'string' && value.href.startsWith('#/')) notification.href = value.href;
  return notification;
}

export const releaseNoteSource = () => releaseNotes.map((note) => ({ ...note, id: `release:${note.id}` }));

// 通知の中身は sources（通知の配列を返す関数）から集める。新しい種類の通知は sources に足す。
// 既読はこの端末に ID ごとに残す（サーバには送らない）。
export function createNotificationStore({ store, storage, namespace = 'pal-note', sources = [releaseNoteSource] }) {
  const listeners = new Set();
  const cache = new Map();
  const emit = () => listeners.forEach((listener) => listener());

  function scope() {
    const { userId, passcode } = store.state;
    return userId && passcode ? `${namespace}.notifications.read.${userIdKey(userId)}` : '';
  }

  function stored(key) {
    let ids = [];
    try { ids = JSON.parse(storage?.getItem(key) ?? '[]'); } catch { /* 読めない端末はすべて未読として扱う。 */ }
    return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
  }

  function readIds(key) {
    if (!cache.has(key)) cache.set(key, new Set(stored(key)));
    return cache.get(key);
  }

  function list() {
    const seen = new Set();
    const notifications = [];
    for (const source of sources) {
      for (const value of source()) {
        const notification = cleanNotification(value);
        if (!notification || seen.has(notification.id)) continue;
        seen.add(notification.id);
        notifications.push(notification);
      }
    }
    // 同じ日時なら、sources の並び順を保つ。
    return notifications.sort((a, b) => b.time - a.time);
  }

  return {
    scope,
    list,
    unread(key = scope()) {
      if (!key) return [];
      const read = readIds(key);
      return list().filter((notification) => !read.has(notification.id));
    },
    markRead(ids, key = scope()) {
      if (!key) return;
      const read = readIds(key);
      if (ids.every((id) => read.has(id))) return;
      // 別のタブで既読にした分を消さないよう、保存先の最新の内容に足す（保存に失敗した分は手元に残す）。
      const next = new Set([...stored(key), ...read, ...ids]);
      cache.set(key, next);
      try { storage?.setItem(key, JSON.stringify([...next])); } catch { /* 保存できなくても、開いている間は既読として扱う。 */ }
      emit();
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    // 通知の元（記録・ウィッシュリスト）が変わったら、未読の数と開いている通知を描き直させる。
    changed: emit,
    // 別のタブで既読にしたら読み直す。
    reload(key) {
      if (cache.delete(key)) emit();
    },
  };
}
