import { ApiError } from './api.js';
import { userIdKey, validateUserId } from './core/user.js';

// サーバで実行されなかったことが確かなエラー。記録を消して、名前を入力し直せるようにする。
const NOT_EXECUTED = new Set(['VALIDATION', 'USER_EXISTS', 'USER_NOT_FOUND', 'AUTH']);

function readJson(storage, key) {
  let source = null;
  try { source = storage?.getItem(key) ?? null; } catch { return undefined; }
  if (source === null) return undefined;
  try { return JSON.parse(source); } catch { return undefined; }
}

function writeJson(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch { return false; }
}

function storageKeys(storage) {
  try { return Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key) => typeof key === 'string'); } catch { return []; }
}

/**
 * この端末に名前ごとに保存しているデータを、新しい名前へ移す（rename した環境の分だけ）。
 * 移し先が既にあれば、移す元を先にして連結する（各ストアは読み込むときに先に出たものを残すので、改名した本人のデータが優先される）。
 * 移し先に保存できたものだけ元を消す。大小・全半角だけの変更でキーが同じなら、その場で中身だけを書き換える。
 * @returns {boolean} すべて保存できたか
 */
export function moveUserStorage(storage, namespace, env, oldId, newId) {
  if (!storage) return true;
  const oldKey = userIdKey(oldId);
  const newKey = userIdKey(newId);
  const isOld = (value) => typeof value === 'string' && userIdKey(value) === oldKey;
  const renameDraft = (draft) => (draft && typeof draft === 'object' && isOld(draft.registrant) ? { ...draft, registrant: newId } : draft);
  const lists = [
    { prefix: `${namespace}.drafts.${env}.`, change: (items) => items.map(renameDraft) },
    { prefix: `${namespace}.wishlist.${env}.` },
    { prefix: `${namespace}.autoBreeding.notices.${env}.` },
    // 既読は環境を含まないので、別の環境の同じ名前のために元を残す
    { prefix: `${namespace}.notifications.read.`, keep: true },
  ];
  let ok = true;
  for (const { prefix, change = (items) => items, keep = false } of lists) {
    const from = `${prefix}${oldKey}`;
    const to = `${prefix}${newKey}`;
    const source = readJson(storage, from);
    if (!Array.isArray(source)) continue;
    if (from === to) {
      ok = writeJson(storage, to, change(source)) && ok;
      continue;
    }
    const target = readJson(storage, to);
    if (!writeJson(storage, to, [...change(source), ...(Array.isArray(target) ? target : [])])) {
      ok = false;
      continue;
    }
    if (!keep) {
      try { storage.removeItem(from); } catch { /* 消せなくても、移し先が先に読まれる。 */ }
    }
  }
  // 自動登録の、セーブのプレイヤーと登録者の対応表（ワールドごと）
  const mappingPrefix = `${namespace}.autoBreeding.players.${env}.`;
  for (const key of storageKeys(storage).filter((item) => item.startsWith(mappingPrefix))) {
    const mapping = readJson(storage, key);
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) continue;
    const entries = Object.entries(mapping);
    if (!entries.some(([, userId]) => isOld(userId))) continue;
    ok = writeJson(storage, key, Object.fromEntries(entries.map(([uid, userId]) => [uid, isOld(userId) ? newId : userId]))) && ok;
  }
  return ok;
}

/**
 * 自分の名前を変える。サーバでの変更と、この端末のデータの移動をまとめて行う。
 * 途中で止まっても同じ opId でやり直せるよう、終わるまで予定を端末に残す。
 */
export function createRenamer({ store, drafts, wishlist, notifications, storage, namespace = 'pal-note' }) {
  const planKey = `${namespace}.rename`;

  function readPlan() {
    const plan = readJson(storage, planKey);
    const text = (value) => typeof value === 'string' && value !== '';
    return plan && ['prod', 'test'].includes(plan.env) && text(plan.opId) && text(plan.oldId) && text(plan.newId) ? plan : null;
  }
  function clearPlan() {
    try { storage?.removeItem(planKey); } catch { /* 残っても、次に同じ予定をやり直すだけ。 */ }
  }
  const localSaveFailed = () => Boolean(drafts?.saveFailed || wishlist?.saveFailed);

  // 端末内のデータを移し、各ストアのキャッシュを捨てて描き直させる
  function moveLocal(plan) {
    const ok = moveUserStorage(storage, namespace, plan.env, plan.oldId, plan.newId);
    const keys = (prefix) => [`${prefix}${userIdKey(plan.oldId)}`, `${prefix}${userIdKey(plan.newId)}`];
    for (const key of keys(`${namespace}.drafts.${plan.env}.`)) drafts?.reload(key);
    for (const key of keys(`${namespace}.wishlist.${plan.env}.`)) wishlist?.reload(key);
    for (const key of keys(`${namespace}.notifications.read.`)) notifications?.reload(key);
    return ok;
  }

  async function run(plan, fresh) {
    if (localSaveFailed()) throw new ApiError('LOCAL_SAVE');
    await store.beginRename();
    try {
      // 待っている間に保存に失敗していたら、メモリにしかないデータを失わないよう始めない
      if (localSaveFailed()) throw new ApiError('LOCAL_SAVE');
      if (fresh && !storage) throw new ApiError('STORAGE');
      if (fresh && !writeJson(storage, planKey, plan)) throw new ApiError('STORAGE');
      let moved = true;
      // サーバでは済んでいて、この端末のデータの移動だけが残っている
      if (store.state.userId === plan.newId) moved = moveLocal(plan);
      else {
        try {
          await store.sendRename(plan, (response) => { moved = moveLocal({ ...plan, newId: response.userId }); });
        } catch (error) {
          if (NOT_EXECUTED.has(error.code)) clearPlan();
          throw error;
        }
      }
      if (!moved) throw new ApiError('LOCAL_MOVE');
      clearPlan();
      return store.state.userId;
    } finally {
      store.endRename();
    }
  }

  return {
    // やり直しを待っている変更（いまの環境・名前のものだけ）
    pending() {
      const plan = readPlan();
      const { env, userId } = store.state;
      if (!plan || plan.env !== env || !userId) return null;
      return [plan.oldId, plan.newId].some((id) => userIdKey(id) === userIdKey(userId)) ? plan : null;
    },
    async rename(newUserId) {
      if (this.pending()) throw new ApiError('RENAMING');
      const checked = validateUserId(newUserId);
      if (!checked.ok) throw new ApiError('VALIDATION', { errors: checked.errors });
      const { env, userId } = store.state;
      if (checked.value === userId) throw new ApiError('VALIDATION', { errors: [{ field: 'newUserId', code: 'SAME_ID' }] });
      return run({ env, opId: crypto.randomUUID(), oldId: userId, newId: checked.value }, true);
    },
    retry() {
      const plan = this.pending();
      if (!plan) return Promise.resolve(store.state.userId);
      return run(plan, false);
    },
    // 別の端末で大小・全半角だけ名前を変えたとき、サーバの表記に合わせて下書きの登録者もそろえる
    followServer(previous, next, env) {
      if (!localSaveFailed()) moveLocal({ env, oldId: previous, newId: next });
    },
    // ページを開いたとき、サーバでは済んでいて端末の移動だけが残っていれば移す（通信はしない）
    resumeLocal() {
      const plan = this.pending();
      if (!plan || store.state.userId !== plan.newId || localSaveFailed()) return false;
      if (!moveLocal(plan)) return false;
      clearPlan();
      return true;
    },
  };
}
