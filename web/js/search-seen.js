// 配合を探すの「新」の印の基準（前にこの画面を離れた時刻）。この端末に、環境・ID ごとに ISO の時刻を 1 つ持つ。
// 読めない・書けない端末では、新着なしとして扱う（印を出さないだけ）。
import { userIdKey } from './core/user.js';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export function createSearchSeen({ storage, namespace = 'pal-note', now = () => new Date().toISOString() }) {
  const key = (env, userId) => (env && userId ? `${namespace}.search.seenAt.${env}.${userIdKey(userId)}` : '');
  return {
    key,
    /** 保存してある時刻（なければ・形が合わなければ null） */
    read(env, userId) {
      const name = key(env, userId);
      if (!name) return null;
      let value = null;
      try { value = storage?.getItem(name) ?? null; } catch { return null; }
      return typeof value === 'string' && ISO.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
    },
    /** time（省略時は今）を書く */
    write(env, userId, time = now()) {
      const name = key(env, userId);
      if (!name || typeof time !== 'string' || !ISO.test(time)) return;
      try { storage?.setItem(name, time); } catch { /* 書けなければ、次に開いたときも同じ基準のまま。 */ }
    },
  };
}
