// 所持パルの「NEW」の印の基準（save-extras）。ワールドごとに「前に所持パルの画面で見ていたデータのセーブの時刻」を、この端末に環境・ID ごとの
// 別のキー（`<namespace>.owned.seenAt.<env>.<userIdKey>`。中は { ワールド ID: ISO の時刻 }）に持つ。旧コードのタブが知らない新しいキーなので、
// 既存のキーの中には足さない（README の 5-1）。読めない・書けない端末では、基準なし（NEW を付けない）として扱う。
import { userIdKey } from './core/user.js';
import { isObject, worldId } from './core/boundary.js';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
// 覚えるワールドの数（超えたら時刻の古いワールドから捨てる）
export const OWNED_SEEN_WORLDS_MAX = 50;

const isTime = (value) => typeof value === 'string' && ISO.test(value) && Number.isFinite(Date.parse(value));

/** 時刻を toISOString の形にそろえる（ISO でなければ ''）。比べるときは文字の順＝時刻の順 */
export function seenTime(value) {
  if (isTime(value)) return value;
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : '';
}

/** 保存した値（{ ワールド ID: 時刻 }）を確かめて整える。形の合わない項目は捨てる。ワールドは時刻の新しい順に OWNED_SEEN_WORLDS_MAX 件まで */
export function cleanOwnedSeen(value) {
  if (!isObject(value)) return {};
  const entries = Object.entries(value).filter(([id, time]) => worldId(id) === id && isTime(time));
  entries.sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0));
  return Object.fromEntries(entries.slice(0, OWNED_SEEN_WORLDS_MAX));
}

/** 名前の変更で移すときに合わせる（同じワールドは新しい方〔NEW を少なく出す方〕を残す。user-rename.js） */
export function mergeOwnedSeen(source, target) {
  const merged = { ...cleanOwnedSeen(target) };
  for (const [id, time] of Object.entries(cleanOwnedSeen(source))) if (!merged[id] || merged[id] < time) merged[id] = time;
  return cleanOwnedSeen(merged);
}

export function createOwnedSeen({ storage, namespace = 'pal-note' }) {
  const key = (env, userId) => (env && userId ? `${namespace}.owned.seenAt.${env}.${userIdKey(userId)}` : '');
  const readAll = (name) => {
    let source = null;
    try { source = storage?.getItem(name) ?? null; } catch { return null; }
    if (source === null) return {};
    try { return cleanOwnedSeen(JSON.parse(source)); } catch { return {}; }
  };
  return {
    key,
    /** そのワールドの基準の時刻。保存がない（初めて開いた）・読めない・ログイン前は null */
    read(env, userId, world) {
      const name = key(env, userId);
      const id = worldId(world);
      if (!name || !id) return null;
      return readAll(name)?.[id] ?? null;
    },
    /** そのワールドの基準を time にする（今の基準より古い時刻では戻さない）。書けなければ何もしない */
    write(env, userId, world, time) {
      const name = key(env, userId);
      const id = worldId(world);
      const value = seenTime(time);
      if (!name || !id || !value) return;
      const all = readAll(name);
      if (!all || (all[id] && all[id] >= value)) return;
      try { storage?.setItem(name, JSON.stringify(cleanOwnedSeen({ ...all, [id]: value }))); } catch { /* 書けなければ、次に開いたときも同じ基準のまま。 */ }
    },
  };
}
