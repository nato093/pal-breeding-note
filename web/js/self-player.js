// このワールドでの自分（セーブのプレイヤーの UID）を、ID・環境・ワールドごとにこの端末に 1 つだけ残す（DOM には触れない）。
// 参加している人や、ゲーム内の名前とノートの ID が違う人が、設定で自分を選ぶ。理想個体の完成の判定と、理想個体・所持パルの
// 所持者の「自分」に使う（core/ideal-goals.js の ownPlayerUids の selfUid。選んだ UID がそのワールドのプレイヤーにいるときだけ効く）。
// 自動登録の「登録者の対応」（auto-register.js の setMapping）には入れない（A → B と変えたときに A の対応が残り、両方が自分になるため）。
// 仲間には共有しない（GAS は変えない）。
import { userIdKey } from './core/user.js';
import { ownedWorldId } from './core/owned-shared.js';
import { idText } from './core/boundary.js';

// セーブのプレイヤーの UID（GUID の 16 進とハイフン）。形の合わない値は保存しない・読まない
const UID = /^[0-9A-Fa-f-]{1,64}$/;
const cleanUid = (value) => {
  const uid = idText(value, 64);
  return UID.test(uid) ? uid : '';
};

/** 保存キーの頭（別のタブの storage イベントの見分けと、名前の変更での移し替えに使う） */
export const SELF_PREFIX = (namespace) => `${namespace}.ideals.self.`;

/** 保存キー 'pal-note.ideals.self.<env>.<userIdKey>.<ワールド ID〔大文字〕>'。どれか欠ける・ワールド ID の形が違えば '' */
export function selfKey(namespace, env, userId, worldId) {
  const user = typeof userId === 'string' && userId ? userIdKey(userId) : '';
  const world = ownedWorldId(worldId);
  return namespace && env && user && world ? `${SELF_PREFIX(namespace)}${env}.${user}.${world}` : '';
}

/**
 * このワールドでの自分の保存。ログイン中（store.state の env・userId・passcode）の分だけ読み書きする。
 * 保存できない端末（localStorage が使えない・容量不足）でも、ページを開いている間は効くよう、手元にも持つ。
 * @returns {{ key(worldId): string, get(worldId): string, set(worldId, uid): boolean, readonly saveFailed: boolean,
 *   reload(storageKey): void, subscribe(listener): () => void }}
 */
export function createSelfStore({ store, storage, namespace = 'pal-note' }) {
  const listeners = new Set();
  // 読んだ値（キー → UID。無ければ ''）と、この端末に書けなかった値（ページを開いている間はこちらを使う）
  const cache = new Map();
  const unsaved = new Map();
  let saveFailed = false;
  const emit = () => listeners.forEach((listener) => listener());

  function key(worldId) {
    const { env, userId, passcode } = store.state;
    return passcode ? selfKey(namespace, env, userId, worldId) : '';
  }

  function read(storageKey) {
    if (unsaved.has(storageKey)) return unsaved.get(storageKey);
    if (!cache.has(storageKey)) {
      let value = null;
      try { value = storage?.getItem(storageKey) ?? null; } catch { /* 読めない端末は未設定として扱う。 */ }
      cache.set(storageKey, cleanUid(value));
    }
    return cache.get(storageKey);
  }

  return {
    key,
    /** 保存した UID（形が合わなければ ''）。そのワールドのプレイヤーにいるかは使う側（ownPlayerUids）が確かめる */
    get(worldId) {
      const storageKey = key(worldId);
      return storageKey ? read(storageKey) : '';
    },
    /** '' なら消す。保存できたら true。ログイン前・形の合わない UID は何もせず false。保存できなければ手元にだけ残して saveFailed を立て、false */
    set(worldId, uid) {
      const storageKey = key(worldId);
      const value = uid ? cleanUid(uid) : '';
      if (!storageKey || (uid && !value)) return false;
      let saved = false;
      try {
        if (value) storage.setItem(storageKey, value);
        else storage.removeItem(storageKey);
        saved = true;
      } catch { /* 保存できない端末・容量超過は saveFailed で知らせる。 */ }
      if (saved) {
        unsaved.delete(storageKey);
        cache.set(storageKey, value);
      } else unsaved.set(storageKey, value);
      saveFailed = unsaved.size > 0;
      emit();
      return saved;
    },
    get saveFailed() { return saveFailed; },
    /** 別のタブの storage イベント・名前の変更の後。キーが SELF_PREFIX で始まれば読み直して知らせる（SELF_PREFIX そのものなら全部） */
    reload(storageKey) {
      if (typeof storageKey !== 'string' || !storageKey.startsWith(SELF_PREFIX(namespace))) return;
      cache.clear();
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
