import releaseNotes from './release-notes.js';
import { userIdKey } from './core/user.js';
import { sanitizeText } from './core/validate.js';
import { screenHref, worldId as cleanWorldId } from './core/boundary.js';

// 通知欄に収まる長さ。更新内容のお知らせはテストでこの長さを守り、ほかの通知は超えた分を省いて表示する。
export const TITLE_MAX = 20;
export const BODY_MAX = 60;
// 通知の種類（通知欄のまとめ表示に使う）。更新内容のお知らせなど、種類のない通知には付けない。フェーズ 2 の bell で種類を足す
export const NOTIFICATION_KINDS = Object.freeze(['auto-registered']);
// 同じワールド・同じまとめの単位（batchId）の通知を通知欄で 1 行にまとめる種類
const GROUPED_KINDS = new Set(['auto-registered']);
// まとめの単位（自動登録はセーブを読み込んだ日時）。英数字と : . _ + - の 1〜64 字
const BATCH = /^[0-9A-Za-z:._+-]{1,64}$/;
// 通知の id の長さと、この端末に残す既読の数の上限（極端に長い・多い保存データで描画が詰まらないように）
const ID_MAX = 200;
const READ_MAX = 2000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function clip(value, max) {
  const text = sanitizeText(typeof value === 'string' ? value : '', Infinity);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// 日付だけの指定は、端末の時刻でその日の 0 時として扱う。
export function notificationTime(date) {
  const match = typeof date === 'string' ? date.match(DATE_ONLY) : null;
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime() : Date.parse(date);
}

/**
 * 通知の種類・ワールド・まとめの単位のうち、正しい値だけを写す（不正な値・ない値は付けない）。
 * 自動登録の保存した通知の読み戻し（auto-register.js）も同じ確かめ方を使う
 * @returns {{ kind?: string, worldId?: string, batchId?: string }} worldId は 32 桁の 16 進の大文字
 */
export function notificationTags(value) {
  const tags = {};
  if (NOTIFICATION_KINDS.includes(value?.kind)) tags.kind = value.kind;
  const world = cleanWorldId(value?.worldId);
  if (world) tags.worldId = world;
  if (typeof value?.batchId === 'string' && BATCH.test(value.batchId)) tags.batchId = value.batchId;
  return tags;
}

// どの種類の通知も、この形にそろえて通知欄に出す。
// id: 既読の判定に使う変わらない文字列 / date: 'YYYY-MM-DD' か ISO 日時 / title・body: 表示する文
// href: 押したときに開く画面（任意）。外部の URL や script を開かないよう、画面内のハッシュ（#/…）だけを受け付ける。
// kind・worldId・batchId: 通知の種類・ワールド・まとめの単位（任意。notificationTags）
// id が 200 字を超える通知は出さない。href は 300 字まで（超えたら外す）。
export function cleanNotification(value) {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id || value.id.length > ID_MAX) return null;
  const time = notificationTime(value.date);
  const title = clip(value.title, TITLE_MAX);
  if (!Number.isFinite(time) || !title) return null;
  const notification = { id: value.id, date: value.date, time, title, body: clip(value.body, BODY_MAX) };
  const href = screenHref(value.href);
  if (href) notification.href = href;
  return Object.assign(notification, notificationTags(value));
}

/**
 * 通知欄に出す行にまとめる。自動登録の成功（kind: 'auto-registered'）は、同じワールド・同じ読み込み（batchId）の分を 1 行にする。
 * 行の本文は最初の通知の本文に「 ほか N 件」を足したもの（「ほか N 件」が切れないよう、本文の方を縮めて BODY_MAX に収める）。
 * 足した「ほか N 件」は more にも入れる（通知欄が折り返しで分けずに出すため）。
 * id・日時・題名・行き先も最初の通知のもの。既読はまとめた通知の id ごと（ids）。kind のない通知・batchId のない通知は 1 件 1 行
 * @param {object[]} list cleanNotification を通した通知（新しい順）
 * @returns {{ ids: string[], count: number, items: object[], more?: string, id: string, date: string, time: number, title: string, body: string, href?: string, kind?: string, worldId?: string, batchId?: string }[]}
 *   並びは list の順（まとめた行は、まとめた中でいちばん上の通知の位置に置く）。items はまとめた元の通知
 */
export function groupNotifications(list) {
  const rows = [];
  const groups = new Map();
  for (const notification of list) {
    const key = GROUPED_KINDS.has(notification.kind) && notification.batchId
      ? `${notification.kind}\n${notification.worldId ?? ''}\n${notification.batchId}` : '';
    const group = key ? groups.get(key) : null;
    if (group) {
      group.items.push(notification);
      continue;
    }
    const row = { ...notification, items: [notification] };
    if (key) groups.set(key, row);
    rows.push(row);
  }
  return rows.map((row) => {
    const { items } = row;
    if (items.length === 1) return { ...row, ids: [row.id], count: 1 };
    const more = `ほか ${items.length - 1} 件`;
    const lead = clip(row.body, BODY_MAX - more.length - 1);
    return { ...row, ids: items.map((item) => item.id), count: items.length, body: lead ? `${lead} ${more}` : more, more };
  });
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
    // 新しく既読にしたものは末尾に足すので、多すぎるときは末尾（新しい方）を残す
    return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && id.length <= ID_MAX).slice(-READ_MAX) : [];
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
      // 保存するのも新しい方の READ_MAX 件まで（読み出しと同じ）
      try { storage?.setItem(key, JSON.stringify([...next].slice(-READ_MAX))); } catch { /* 保存できなくても、開いている間は既読として扱う。 */ }
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
