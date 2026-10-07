import pals from '../data/pals.js';
import { userIdKey } from './core/user.js';
import { sanitizeText } from './core/validate.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const palIds = new Set(pals.map((pal) => pal.id));
const idle = Object.freeze({ sending: false, error: '' });
export const DRAFT_PALS = ['parent1Id', 'parent2Id', 'childId'];
const CONTENT = [...DRAFT_PALS, 'registrant', 'memo'];

const isUuid = (value) => typeof value === 'string' && UUID_PATTERN.test(value);
const text = (value, max) => sanitizeText(typeof value === 'string' ? value : '', max);

function cleanDraft(value) {
  if (!value || typeof value !== 'object' || !isUuid(value.id)) return null;
  const draft = { id: value.id };
  for (const field of DRAFT_PALS) draft[field] = palIds.has(value[field]) ? value[field] : '';
  draft.registrant = text(value.registrant, 30);
  draft.memo = text(value.memo, 200);
  draft.recordId = isUuid(value.recordId) ? value.recordId : '';
  return draft;
}

function parseDrafts(source) {
  let values;
  try { values = JSON.parse(source); } catch { return []; }
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const drafts = [];
  for (const value of values) {
    const draft = cleanDraft(value);
    if (!draft || seen.has(draft.id)) continue;
    seen.add(draft.id);
    drafts.push(draft);
  }
  return drafts;
}

export function sameDraftContent(a, b) {
  return CONTENT.every((field) => a[field] === b[field]);
}

// 下書きはこの端末にだけ ID・環境ごとに残す。サーバに控えがないため、保存の失敗は握りつぶさず画面で知らせる。
// 送信中・エラーの状態は保存せず、画面を移っても裏の送信の結果を反映できるようにここで持つ。
export function createDraftStore({ store, storage, namespace = 'pal-note' }) {
  const listeners = new Set();
  const cache = new Map();
  const statuses = new Map();
  let saveFailed = false;
  const emit = () => listeners.forEach((listener) => listener());

  function scope() {
    const { env, userId, passcode } = store.state;
    return env && userId && passcode ? `${namespace}.drafts.${env}.${userIdKey(userId)}` : '';
  }

  function load(key) {
    if (!key) return [];
    if (!cache.has(key)) {
      let source = null;
      try { source = storage?.getItem(key) ?? null; } catch { /* 読めない端末は下書きなしとして扱う。 */ }
      cache.set(key, parseDrafts(source));
    }
    return cache.get(key);
  }

  function save(key, drafts) {
    cache.set(key, drafts);
    saveFailed = true;
    try {
      storage.setItem(key, JSON.stringify(drafts));
      saveFailed = false;
    } catch { /* 容量超過・保存の拒否は saveFailed で画面に知らせる。 */ }
    emit();
  }

  // 別のタブの保存を消さないよう、書き換えは保存先の最新の内容に対して行う（保存に失敗している間は手元の内容が最新）。
  function latest(key) {
    if (!saveFailed) cache.delete(key);
    return load(key);
  }

  const sending = (id) => Boolean(statuses.get(id)?.sending);
  // 名前の変更中は書き換えない（変更の後で、新しい名前の保存先へ移すため）
  const locked = () => Boolean(store.state.renaming);

  return {
    scope,
    get saveFailed() { return saveFailed; },
    list(key = scope()) { return load(key); },
    status(id) { return statuses.get(id) ?? idle; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    add(fields = {}, key = scope()) {
      if (!key || locked()) return null;
      const draft = cleanDraft({ registrant: store.state.userId, ...fields, id: crypto.randomUUID(), recordId: '' });
      save(key, [...latest(key), draft]);
      return draft;
    },
    update(id, fields, key = scope()) {
      const drafts = latest(key);
      const index = drafts.findIndex((draft) => draft.id === id);
      // 送信中に変えると、成功したときに送った内容と違う下書きを消してしまう。
      if (index < 0 || sending(id) || locked()) return false;
      const next = cleanDraft({ ...drafts[index], ...fields, id, recordId: drafts[index].recordId });
      if (sameDraftContent(next, drafts[index])) return true;
      // 内容が変わったら、前回送った登録 ID は使い回さない。
      next.recordId = '';
      statuses.delete(id);
      save(key, drafts.map((draft, current) => current === index ? next : draft));
      return true;
    },
    remove(id, key = scope()) {
      const drafts = latest(key);
      const index = drafts.findIndex((draft) => draft.id === id);
      if (index < 0 || sending(id) || locked()) return null;
      statuses.delete(id);
      save(key, drafts.filter((draft, current) => current !== index));
      return { draft: drafts[index], index };
    },
    // 削除した時点の ID・環境の下書きに戻す（元に戻すの前に別の ID でログインしても混ざらない）。
    restore(draft, index, key) {
      const drafts = latest(key);
      if (!key || locked() || drafts.some((item) => item.id === draft.id)) return false;
      save(key, [...drafts.slice(0, index), draft, ...drafts.slice(index)]);
      return true;
    },
    removeMany(ids, key = scope()) {
      const drafts = latest(key);
      const targets = new Set(ids.filter((id) => !sending(id) && drafts.some((draft) => draft.id === id)));
      if (!targets.size || locked()) return 0;
      for (const id of targets) statuses.delete(id);
      save(key, drafts.filter((draft) => !targets.has(draft.id)));
      return targets.size;
    },
    // 登録 ID を先に保存し、応答を受け取れずに残った下書きを同じ ID で送り直せるようにする（サーバは同じ内容なら成功を返す）。
    startSending(id, recordId, key) {
      const drafts = latest(key);
      const index = drafts.findIndex((draft) => draft.id === id);
      if (index < 0 || locked()) return false;
      statuses.set(id, { sending: true, error: '' });
      if (drafts[index].recordId === recordId) emit();
      else save(key, drafts.map((draft, current) => current === index ? { ...draft, recordId } : draft));
      return true;
    },
    // 成功したら、送った内容のままの下書きだけを消す。失敗したら理由を残す。
    finish(id, sent, key, error = '') {
      if (error) {
        statuses.set(id, { sending: false, error });
        emit();
        return;
      }
      statuses.delete(id);
      const drafts = latest(key);
      if (drafts.some((draft) => draft.id === id && sameDraftContent(draft, sent))) save(key, drafts.filter((draft) => draft.id !== id));
      else emit();
    },
    fail(id, error) {
      statuses.set(id, { sending: false, error });
      emit();
    },
    // 別のタブで書き換わったら読み直す。
    reload(key) {
      if (cache.delete(key)) emit();
    },
  };
}
