import pals from '../data/pals.js';
import { userIdKey } from './core/user.js';
import { buildHash } from './router.js';

const palsById = new Map(pals.map((pal) => [pal.id, pal]));

const validTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));

// craftable: 最後に判定した「作れるか」 / readyAt: 作れるようになったのを見た時刻（作れない間は空）
// observedAt: 最後の判定に使ったデータの serverTime
function cleanWish(value) {
  if (!value || typeof value !== 'object' || !palsById.has(value.palId)) return null;
  const craftable = value.craftable === true;
  return {
    palId: value.palId,
    addedAt: validTime(value.addedAt) ? value.addedAt : '',
    craftable,
    readyAt: craftable && validTime(value.readyAt) ? value.readyAt : '',
    observedAt: validTime(value.observedAt) ? value.observedAt : '',
  };
}

function parseWishes(source) {
  let values;
  try { values = JSON.parse(source); } catch { return []; }
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const wishes = [];
  for (const value of values) {
    const wish = cleanWish(value);
    if (!wish || seen.has(wish.palId)) continue;
    seen.add(wish.palId);
    wishes.push(wish);
  }
  return wishes;
}

// ウィッシュリストはこの端末にだけ ID・環境ごとに残す。
// 作れるかどうかは、送信待ちを含まない確定データで判定する（失敗する登録で通知しないため）。
// 判定は、各ウィッシュの observedAt より新しいデータを受けたときだけ行う。古いデータのタブや起動時のキャッシュで、
// 新しいデータでの判定を巻き戻さないため。キャッシュは環境ごとでウィッシュより新しいこともあるので、時刻によらず判定しない。
export function createWishlistStore({ store, storage, namespace = 'pal-note', now = Date.now }) {
  const listeners = new Set();
  const cache = new Map();
  let saveFailed = false;
  let childSource = null;
  let children = new Set();
  const emit = () => listeners.forEach((listener) => listener());

  function scope() {
    const { env, userId, passcode } = store.state;
    return env && userId && passcode ? `${namespace}.wishlist.${env}.${userIdKey(userId)}` : '';
  }

  function load(key) {
    if (!key) return [];
    if (!cache.has(key)) {
      let source = null;
      try { source = storage?.getItem(key) ?? null; } catch { /* 読めない端末はウィッシュなしとして扱う。 */ }
      cache.set(key, parseWishes(source));
    }
    return cache.get(key);
  }

  function save(key, wishes) {
    cache.set(key, wishes);
    saveFailed = true;
    try {
      storage.setItem(key, JSON.stringify(wishes));
      saveFailed = false;
    } catch { /* 容量超過・保存の拒否は saveFailed で画面に知らせる。 */ }
    emit();
  }

  // 別のタブの保存を消さないよう、書き換えは保存先の最新の内容に対して行う（保存に失敗している間は手元の内容が最新）。
  function latest(key) {
    if (!saveFailed) cache.delete(key);
    return load(key);
  }

  function confirmedChildren() {
    const records = store.state.confirmedRecords;
    if (records !== childSource) {
      childSource = records;
      children = new Set(records.map((record) => record.childId));
    }
    return children;
  }

  function observe() {
    const { cached, serverTime } = store.state;
    const key = scope();
    const current = Date.parse(serverTime);
    if (!key || cached || !Number.isFinite(current)) return;
    // observedAt が読めないウィッシュは、判定したことがないものとして扱う。
    const stale = (wish) => !(Date.parse(wish.observedAt) >= current);
    if (!load(key).some(stale)) return;
    const wishes = latest(key);
    if (!wishes.some(stale)) return;
    const made = confirmedChildren();
    const time = new Date(now()).toISOString();
    save(key, wishes.map((wish) => {
      if (!stale(wish)) return wish;
      const craftable = made.has(wish.palId);
      return { ...wish, craftable, readyAt: craftable ? (wish.craftable ? wish.readyAt : time) : '', observedAt: serverTime };
    }));
  }

  store.subscribe(observe);
  observe();

  return {
    scope,
    get saveFailed() { return saveFailed; },
    list(key = scope()) { return load(key); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    // 追加した時点で作れるパルは、作れる状態が続く限り通知しない。
    add(palId) {
      const key = scope();
      if (!key || !palsById.has(palId)) return null;
      const wishes = latest(key);
      if (wishes.some((wish) => wish.palId === palId)) return false;
      save(key, [{
        palId, addedAt: new Date(now()).toISOString(), craftable: confirmedChildren().has(palId), readyAt: '', observedAt: store.state.serverTime,
      }, ...wishes]);
      return true;
    },
    remove(palId, key = scope()) {
      const wishes = latest(key);
      const index = wishes.findIndex((wish) => wish.palId === palId);
      if (index < 0) return null;
      save(key, wishes.filter((wish, current) => current !== index));
      return { wish: wishes[index], index };
    },
    // 外した時点の ID・環境に戻し、外している間に届いたデータで判定し直す（別の ID・環境なら、その scope を開いたときに判定する）。
    restore(wish, index, key) {
      const wishes = latest(key);
      if (!key || wishes.some((item) => item.palId === wish.palId)) return false;
      save(key, [...wishes.slice(0, index), wish, ...wishes.slice(index)]);
      observe();
      return true;
    },
    // 別のタブで書き換わったら読み直し、そのタブが古いデータで追加した分も判定する。
    reload(key) {
      if (!cache.delete(key)) return;
      emit();
      observe();
    },
  };
}

export function wishlistNotificationSource({ store, wishlist }) {
  return () => wishlist.list().filter((wish) => wish.readyAt).map((wish) => {
    const name = palsById.get(wish.palId).ja;
    return {
      // 既読の保存先は環境共通のため、環境を含める。
      id: `wishlist:${store.state.env}:${wish.palId}:${wish.readyAt}`,
      date: wish.readyAt,
      title: `${name}が作成可能になりました`,
      body: 'ウィッシュリストのパルです。押すと逆引きで、生まれる配合を確認できます。',
      href: buildHash('reverse', { c: wish.palId }),
    };
  });
}
