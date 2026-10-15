// パルリバーサーの案内（理想個体。implants・D17）を「パルリバーサーを使わずに作る」で消した目標の記録。この端末だけ（仲間と共有しない）。
// 環境・ID ごとの別のキー `<namespace>.reverserHidden.<env>.<userIdKey>` に、目標の見分け方の文字列（reverserTarget）の配列を新しい順に
// REVERSER_HIDDEN_MAX 件まで持つ。旧コードのタブが知らない新しいキーなので、既存のキー（目標の `<namespace>.ideals.<env>.` など）の中には
// 足さない（README の 5-1）。名前の変更では web/js/user-rename.js が配列のまま移す。
// 読み戻しは core/boundary.js の list で確かめ、形の合わない項目は捨てる（壊れていれば空）。書けない端末では、開いている間だけ覚える
import { userIdKey } from './core/user.js';
import { list, idText, internalName } from './core/boundary.js';

export const REVERSER_HIDDEN_MAX = 200;
// 目標の見分け方の文字列の長さの上限（種族の ID・パッシブ 4 個・個体値 3 つ。ID は 64 字まで）
const TARGET_MAX = 512;
const PASSIVES_MAX = 4;

const talentValue = (value) => (Number.isInteger(value) && value >= 0 && value <= 100 ? value : null);

/**
 * 目標の見分け方: 種族＋欲しいパッシブ（順不同）＋個体値の目標（0＝条件なしにそろえた HP・攻撃・防御）。
 * ケーキとパッシブの条件の種類は含めない（変えても同じ目標として、消した案内を出さない。D17）。形の合わない値なら ''
 * @param {string} palId
 * @param {string[]} passives
 * @param {number[]} talents [HP, 攻撃, 防御]（0〜100 の整数）
 */
export function reverserTarget(palId, passives, talents) {
  const id = internalName(palId);
  const ids = Array.isArray(passives) ? [...new Set(passives)] : null;
  if (!id || !ids || ids.length > PASSIVES_MAX || !ids.every((item) => internalName(item))) return '';
  const values = Array.isArray(talents) && talents.length === 3 ? talents.map(talentValue) : [];
  if (values.length !== 3 || values.includes(null)) return '';
  return JSON.stringify([id, ids.sort(), values]);
}

// 保存した 1 項目が、reverserTarget で作った形のままか（並べ直した・空白を入れたものは別の目標とみなさず捨てる）
function cleanTarget(value) {
  const source = idText(value, TARGET_MAX);
  if (!source) return null;
  let parsed = null;
  try { parsed = JSON.parse(source); } catch { return null; }
  if (!Array.isArray(parsed) || parsed.length !== 3) return null;
  return reverserTarget(parsed[0], parsed[1], parsed[2]) === source ? source : null;
}

/** 保存した値を確かめて整える。配列でなければ空、形の合わない項目と重なり（後の方）は捨てて REVERSER_HIDDEN_MAX 件まで */
export const cleanReverserHidden = (value) => list(value, { max: REVERSER_HIDDEN_MAX, map: cleanTarget, key: (item) => item });

export function createReverserHidden({ storage, namespace = 'pal-note' }) {
  const key = (env, userId) => (env && userId ? `${namespace}.reverserHidden.${env}.${userIdKey(userId)}` : '');
  // 書けなかった（書けない端末・容量切れ）・ログインの前の分。キー（ログインの前は ''）→ 配列
  const memory = new Map();
  const read = (name) => {
    if (memory.has(name)) return memory.get(name);
    if (!name) return [];
    let source = null;
    try { source = storage?.getItem(name) ?? null; } catch { return []; }
    if (source === null) return [];
    try { return cleanReverserHidden(JSON.parse(source)); } catch { return []; }
  };
  const write = (name, items) => {
    try {
      if (!name || !storage) throw new Error('no storage');
      if (items.length) storage.setItem(name, JSON.stringify(items));
      else storage.removeItem(name);
      memory.delete(name);
    } catch {
      memory.set(name, items);
    }
  };
  return {
    key,
    /** 消した目標の見分け方の文字列（新しい順） */
    list: (env, userId) => read(key(env, userId)),
    has: (env, userId, target) => Boolean(target) && read(key(env, userId)).includes(target),
    /** 目標の案内を消す（先頭に足し、REVERSER_HIDDEN_MAX 件を超えたら古いものから捨てる） */
    hide(env, userId, target) {
      if (!target) return;
      const name = key(env, userId);
      write(name, [target, ...read(name).filter((item) => item !== target)].slice(0, REVERSER_HIDDEN_MAX));
    },
    /** 1 件だけ戻す（消した直後の「元に戻す」） */
    show(env, userId, target) {
      const name = key(env, userId);
      const items = read(name);
      if (items.includes(target)) write(name, items.filter((item) => item !== target));
    },
    /** 消した案内を全部戻す */
    clear(env, userId) {
      const name = key(env, userId);
      if (read(name).length) write(name, []);
    },
  };
}
