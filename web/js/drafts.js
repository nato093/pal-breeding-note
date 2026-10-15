import pals from '../data/pals.js';
import { userIdKey } from './core/user.js';
import { sanitizeText } from './core/validate.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const palIds = new Set(pals.map((pal) => pal.id));
const idle = Object.freeze({ sending: false, error: '' });
export const DRAFT_PALS = ['parent1Id', 'parent2Id', 'childId'];
export const DRAFT_GENDERS = ['parent1Gender', 'parent2Gender'];
const CONTENT = [...DRAFT_PALS, ...DRAFT_GENDERS, 'registrant', 'memo'];
// 下書きのキーに書く項目（前の版の cleanDraft と同じ形。前の版のタブが storage イベントで読み直して書き戻しても消えない項目だけ）
const STORED = ['id', ...DRAFT_PALS, 'registrant', 'memo', 'recordId'];
const gender = (value) => (value === 'M' || value === 'F' ? value : '');

const isUuid = (value) => typeof value === 'string' && UUID_PATTERN.test(value);
const text = (value, max) => sanitizeText(typeof value === 'string' ? value : '', max);

// メモリ上の下書き: 保存の項目と親の性別（M・F・''）。性別はパルを選んだ枠だけに残す
function cleanDraft(value) {
  if (!value || typeof value !== 'object' || !isUuid(value.id)) return null;
  const draft = { id: value.id };
  for (const field of DRAFT_PALS) draft[field] = palIds.has(value[field]) ? value[field] : '';
  draft.parent1Gender = draft.parent1Id ? gender(value.parent1Gender) : '';
  draft.parent2Gender = draft.parent2Id ? gender(value.parent2Gender) : '';
  draft.registrant = text(value.registrant, 30);
  draft.memo = text(value.memo, 200);
  draft.recordId = isUuid(value.recordId) ? value.recordId : '';
  return draft;
}

function parseJson(source) {
  try { return JSON.parse(source); } catch { return null; }
}

/**
 * 下書きのキーの値と、性別のキーの値（{ [下書き id]: { parent1Gender, parent2Gender, parent1Id, parent2Id } }）を合わせる。
 * 性別は、控えた親の ID が今の下書きの親と同じ枠だけ使う（前の版のタブでパルを変えた下書きに、前のパルの性別を残さない）
 */
function parseDrafts(source, genderSource = null) {
  const values = parseJson(source);
  if (!Array.isArray(values)) return [];
  const genders = parseJson(genderSource);
  const genderOf = (id) => (genders && typeof genders === 'object' && !Array.isArray(genders) && Object.hasOwn(genders, id) ? genders[id] : null);
  const seen = new Set();
  const drafts = [];
  for (const value of values) {
    const saved = value && typeof value === 'object' ? genderOf(value.id) : null;
    const draft = cleanDraft({
      ...value,
      parent1Gender: saved && saved.parent1Id === value.parent1Id ? saved.parent1Gender : '',
      parent2Gender: saved && saved.parent2Id === value.parent2Id ? saved.parent2Gender : '',
    });
    if (!draft || seen.has(draft.id)) continue;
    seen.add(draft.id);
    drafts.push(draft);
  }
  return drafts;
}

const storedDraft = (draft) => Object.fromEntries(STORED.map((field) => [field, draft[field]]));
// 性別のキーに書く値（性別のある下書きだけ。親の ID を控える）。どれもなければ null（キーを消す）
function storedGenders(drafts) {
  const entries = drafts.filter((draft) => draft.parent1Gender || draft.parent2Gender)
    .map((draft) => [draft.id, { parent1Gender: draft.parent1Gender, parent2Gender: draft.parent2Gender, parent1Id: draft.parent1Id, parent2Id: draft.parent2Id }]);
  return entries.length ? Object.fromEntries(entries) : null;
}

export function sameDraftContent(a, b) {
  return CONTENT.every((field) => a[field] === b[field]);
}

// 下書きはこの端末にだけ ID・環境ごとに残す。サーバに控えがないため、保存の失敗は握りつぶさず画面で知らせる。
// 送信中・エラーの状態は保存せず、画面を移っても裏の送信の結果を反映できるようにここで持つ。
// 親の性別（register-dialog）は、前の版のタブが下書きのキーを自分の形（性別なし）で書き戻しても消えないよう、別のキー
// <namespace>.draftGenders.<env>.<userIdKey> に下書き id ごとに持つ（下書きを消せば、次の保存で性別も消える）。
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
  const draftsPrefix = `${namespace}.drafts.`;
  const gendersPrefix = `${namespace}.draftGenders.`;
  // 下書きのキー → 性別のキー（同じ環境・ID）
  const genderKey = (key) => (key.startsWith(draftsPrefix) ? `${gendersPrefix}${key.slice(draftsPrefix.length)}` : '');

  function load(key) {
    if (!key) return [];
    if (!cache.has(key)) {
      let source = null;
      let genders = null;
      try {
        source = storage?.getItem(key) ?? null;
        genders = storage?.getItem(genderKey(key)) ?? null;
      } catch { /* 読めない端末は下書きなしとして扱う。 */ }
      cache.set(key, parseDrafts(source, genders));
    }
    return cache.get(key);
  }

  function save(key, drafts) {
    cache.set(key, drafts);
    saveFailed = true;
    try {
      storage.setItem(key, JSON.stringify(drafts.map(storedDraft)));
      const genders = storedGenders(drafts);
      if (genders) storage.setItem(genderKey(key), JSON.stringify(genders));
      else storage.removeItem?.(genderKey(key));
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
  // 元に戻すのは、消した時点のキーが今のログインのキーと同じときだけ。ID を変えた後（変更で前のキーは新しいキーへ移して消している）・
  // 別の ID でログインした後に、前のキーへ書き戻して戻せたように見せない
  const restorable = (key) => Boolean(key) && key === scope() && !locked();

  // 送信中でない ids の下書きをまとめて消し、元に戻すための { draft, index }[]（index は消す前の位置。小さい順）を返す。消せなければ null
  function removeAll(ids, key = scope()) {
    const drafts = latest(key);
    const targets = new Set(ids.filter((id) => !sending(id) && drafts.some((draft) => draft.id === id)));
    if (!targets.size || locked()) return null;
    for (const id of targets) statuses.delete(id);
    const removed = drafts.flatMap((draft, index) => (targets.has(draft.id) ? [{ draft, index }] : []));
    save(key, drafts.filter((draft) => !targets.has(draft.id)));
    return removed;
  }

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
    // 削除した時点の ID・環境の下書きに戻す。今のログインのキーと違えば（ID の変更の後・別の ID でログインした後）戻さず false
    restore(draft, index, key) {
      if (!restorable(key)) return false;
      const drafts = latest(key);
      if (drafts.some((item) => item.id === draft.id)) return false;
      save(key, [...drafts.slice(0, index), draft, ...drafts.slice(index)]);
      return true;
    },
    // 消した件数を返す（元に戻すときは removeAll）
    removeMany(ids, key = scope()) {
      return removeAll(ids, key)?.length ?? 0;
    },
    removeAll,
    // removeAll で消した下書きを、消した時点の ID・環境に index の小さい順に差し込み直す（index は今の長さに丸める。
    // 同じ ID がもうあれば飛ばす）。戻した数を返す。今のログインのキーと違えば（restore と同じ）戻さず 0
    restoreMany(items, key) {
      if (!restorable(key) || !Array.isArray(items)) return 0;
      const drafts = [...latest(key)];
      const ids = new Set(drafts.map((draft) => draft.id));
      let restored = 0;
      for (const { draft, index } of [...items].sort((a, b) => a.index - b.index)) {
        if (ids.has(draft.id)) continue;
        drafts.splice(Math.min(index, drafts.length), 0, draft);
        ids.add(draft.id);
        restored++;
      }
      if (restored) save(key, drafts);
      return restored;
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
    // 別のタブで書き換わったら読み直す（性別のキーが変わったときは、同じ環境・ID の下書きのキーを読み直す）。
    reload(key) {
      const target = typeof key === 'string' && key.startsWith(gendersPrefix) ? `${draftsPrefix}${key.slice(gendersPrefix.length)}` : key;
      if (cache.delete(target)) emit();
    },
  };
}
