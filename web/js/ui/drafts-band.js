// 下書きの帯（register-entry。D2）: 配合を探すの全件表示の上に出す折り畳みの帯。前の下書きのタブ（views/drafts.js）の中身をここへ移した。
// 下書きはこの端末だけに保存する（web/js/drafts.js の createDraftStore。保存の形は変えていない）。
import { el, button, syncList, storageWarning, setDisabled } from './dom.js';
import { actionIcon, breedingCard, breedingEquation } from './breeding-card.js';
import { palTile, palsById } from './pal-icon.js';
import { confirmDialog } from './dialog.js';
import { toast } from './toast.js';
import { validationText } from './record-editor.js';
import { errorMessage } from '../api.js';
import { findConflict } from '../core/index.js';
import { validateRecordInput } from '../core/validate.js';
import { DRAFT_PALS, sameDraftContent } from '../drafts.js';

let sequence = 0;

function describeError(error) {
  const items = error.code === 'VALIDATION' ? error.response?.errors : null;
  return items?.length ? items.map(validationText).join(' ') : error.message;
}

// 通常の登録と同じく、手元の登録で重複と別の子を確かめてから送る。送れない理由は行に残す。
async function prepare(context, key, id, approved = null) {
  const { store, drafts } = context;
  const draft = drafts.list(key).find((item) => item.id === id);
  // ログアウトや別の ID でのログインをまたいで、確認・送信しない。
  if (drafts.scope() !== key || !draft || drafts.status(id).sending) return { skipped: true };
  if (DRAFT_PALS.some((field) => !draft[field])) return { error: '未選択の項目があります。' };
  // 別の子の承認は、確認で見せた内容のままの場合だけ有効にする（確認中に別のタブで変わることがある）。
  const allowDifferentChild = Boolean(approved) && sameDraftContent(draft, approved);
  // 親の性別も通す（下書きの性別は別のキーに持つ。drafts.js）
  const checked = validateRecordInput({ ...draft }, new Set(palsById.keys()));
  if (!checked.ok) return { error: checked.errors.map(validationText).join(' ') };
  const record = { id: draft.recordId || crypto.randomUUID(), ...checked.value };
  const conflict = findConflict(store.state.index, record, { checkPair: !allowDifferentChild });
  if (conflict?.code === 'DUPLICATE') return { error: errorMessage('DUPLICATE') };
  if (conflict?.code === 'PAIR_CONFLICT') {
    const preview = el('div', 'card-stack');
    preview.append(el('p', 'result-note', '登録しようとしている下書き'), breedingEquation(record), el('p', 'result-note', '登録済みの配合'));
    for (const existing of conflict.existing) preview.append(breedingCard(existing, {}, { preview: true }));
    const accepted = await confirmDialog('別の結果として登録しますか？', '本当に結果が違う場合だけ登録してください。',
      { preview, confirmText: '別の結果として保存', cancelText: '登録しない' });
    // 確認の間に他の登録が反映されていることがあるため、承認後に判定し直す。
    return accepted ? prepare(context, key, id, draft) : { error: errorMessage('PAIR_CONFLICT') };
  }
  return { draft, record, allowDifferentChild };
}

async function submit(context, key, { draft, record, allowDifferentChild }) {
  const { store, drafts } = context;
  if (!drafts.startSending(draft.id, record.id, key)) return false;
  try {
    await store.mutate('create', allowDifferentChild ? { record, allowDifferentChild } : { record });
  } catch (error) {
    drafts.finish(draft.id, draft, key, describeError(error));
    return false;
  }
  drafts.finish(draft.id, draft, key);
  return true;
}

// 下書きを並び順に 1 件ずつ確かめ、送れるものは送信待ちに積む。送れなかった下書きは理由を付けて残す。
export async function registerDrafts(context, ids) {
  const { store, drafts } = context;
  const key = drafts.scope();
  if (!key) return { registered: 0, kept: 0 };
  const sending = [];
  let kept = 0;
  for (const id of ids) {
    const prepared = await prepare(context, key, id);
    if (prepared.skipped) continue;
    if (prepared.error) {
      kept++;
      drafts.fail(id, prepared.error);
      continue;
    }
    sending.push(submit(context, key, prepared));
  }
  const results = await Promise.all(sending);
  const registered = results.filter(Boolean).length;
  const failed = results.length - registered;
  kept += failed;
  if (ids.length === 1) {
    if (registered) toast('配合を登録しました');
    else if (failed) toast(`配合を登録できませんでした。${drafts.status(ids[0]).error}`, { kind: 'error' });
  } else if (registered || kept) {
    toast(`${registered} 件を登録しました${kept ? `。${kept} 件は下書きに残っています` : ''}`);
  }
  // サーバに断られたときは、他の人の登録を取り込むため最新を取り直す。
  if (failed) {
    try { await store.refresh(); } catch { /* 取得の失敗は同期状態に表示される。 */ }
  }
  return { registered, kept };
}

// 読み取り専用の式（親1 ＋ 親2 → 子）。選んでいない枠は破線の「未選択」
function draftEquation(draft) {
  const equation = el('div', 'breeding-equation draft-equation');
  const slot = (id, gender = '') => (id && palsById.has(id) ? palTile(id, { clickable: false, gender }) : el('span', 'draft-empty', '未選択'));
  equation.append(slot(draft.parent1Id, draft.parent1Gender), el('span', 'equation-symbol', '＋'), slot(draft.parent2Id, draft.parent2Gender),
    el('span', 'equation-symbol arrow', '→'), slot(draft.childId));
  return equation;
}

/**
 * 下書きの 1 行（2 行の形）: 1 行目は読み取り専用の式、2 行目は 登録者 · メモ · 理由の文（1 行で省略し、全文は title）と右端の操作
 * 「登録」（未選択があれば押せない）・「編集」（モーダル）・「削除」（確認なしで消してトーストで「元に戻す」）。理由の文が出ても行の高さを
 * 変えない（前は行の下に 1 行足して、すべて登録で未選択の行が多いと画面が 340px 伸びた）。{ element, update(draft, status) } を返す（syncList の行）。
 * 行が消えたときのフォーカスの移し先は「編集」（data-focus。同じ「登録」「削除」へ移すと、Enter の長押しで次の行まで続けて押してしまう）
 */
function draftRow(context, draft, onRemove) {
  let current = draft;
  let shown = null;
  const row = el('article', 'draft-row');
  row.setAttribute('aria-label', '下書き');
  const equationSlot = el('div', 'draft-equation-slot');
  const meta = el('div', 'card-meta');
  // 押した行はすぐ消えて次の行が詰まるため、ダブルクリックの 2 回目（detail が 2 以上）は次の行に当てない。
  const singleClick = (action) => (event) => (event?.detail > 1 ? undefined : action());
  const register = button('登録', singleClick(() => registerDrafts(context, [current.id])), 'button primary small');
  register.setAttribute('aria-label', 'この下書きを登録');
  const edit = actionIcon('編集', 'edit', () => context.register(current, { draft: true }));
  edit.setAttribute('data-focus', 'edit');
  const actions = el('div', 'card-actions draft-actions');
  actions.append(register, edit, actionIcon('削除', 'remove', singleClick(() => onRemove(current.id)), 'danger-text'));
  const registrant = el('span', 'draft-registrant');
  const memo = el('span', 'draft-memo');
  const message = el('span', 'draft-message');
  message.setAttribute('aria-live', 'polite');
  meta.append(registrant, memo, message);
  row.append(equationSlot, meta, actions);
  return {
    element: row,
    update(next, status) {
      if (shown?.draft === next && shown.status === status) return;
      const palsChanged = !shown || [...DRAFT_PALS, 'parent1Gender', 'parent2Gender'].some((field) => shown.draft[field] !== next[field]);
      shown = { draft: next, status };
      current = next;
      if (palsChanged) equationSlot.replaceChildren(draftEquation(next));
      registrant.textContent = next.registrant || '登録者未指定';
      memo.textContent = next.memo;
      memo.title = next.memo;
      memo.hidden = !next.memo;
      setDisabled(register, DRAFT_PALS.some((field) => !next[field]) || !context.store.state.env,
        DRAFT_PALS.some((field) => !next[field]) ? '親1・親2・子を「編集」で選ぶと登録できます' : '登録済みの配合を読み込んでいます');
      message.textContent = status.error;
      message.title = status.error;
      message.classList.toggle('draft-error', Boolean(status.error));
      message.hidden = !status.error;
    },
  };
}

/**
 * 下書きの帯。頭の行に開閉のボタン「下書き n 件（この端末だけ）」（aria-expanded・aria-controls）と「すべて登録」「＋ 下書きに追加」
 *（0 件でも出し、追加は押せる）。開くと保存の失敗の警告・行の一覧・「すべて削除」。onToggle(open) は開閉のボタンを押したとき
 *（配合を探すが URL の drafts=1 で開閉を持つ）。update({ open }) で開閉を合わせる
 */
export function draftsBand(context, { open = false, onToggle = () => {} } = {}) {
  const { store, drafts } = context;
  const bodyId = `drafts-band-${++sequence}`;
  const element = el('section', 'drafts-band');
  element.setAttribute('aria-label', '下書き');
  const toggle = button('', () => onToggle(!isOpen), 'drafts-band-toggle');
  toggle.setAttribute('aria-controls', bodyId);
  const toggleText = el('span', 'drafts-band-title');
  toggle.append(el('span', 'drafts-band-mark'), toggleText);
  let bulkRunning = false;
  let destroyed = false;
  const registerAll = button('すべて登録', async () => {
    bulkRunning = true;
    update();
    try { await registerDrafts(context, visible().map((draft) => draft.id)); } finally {
      bulkRunning = false;
      update();
    }
  }, 'button primary small');
  const add = button('＋ 下書きに追加', () => context.register({}, { draft: true }), 'button secondary small drafts-band-add');
  const head = el('div', 'drafts-band-head');
  const headActions = el('div', 'drafts-band-actions');
  headActions.append(registerAll, add);
  head.append(toggle, headActions);
  const body = el('div', 'drafts-band-body');
  body.id = bodyId;
  const saveWarning = storageWarning('下書き', 'drafts-warning');
  const list = el('div', 'draft-list');
  const removeAllButton = button('すべて削除', () => removeAll(), 'button secondary small danger-text drafts-band-remove');
  const foot = el('div', 'drafts-band-foot');
  foot.append(removeAllButton);
  body.append(saveWarning, list, foot);
  element.append(head, body);
  let isOpen = Boolean(open);

  // 送信中の下書きは登録済みとして隠す。端末には成功するまで残し、失敗したら理由を付けて行に戻す。
  const visible = (key) => drafts.list(key).filter((draft) => !drafts.status(draft.id).sending);

  function removeOne(id) {
    const key = drafts.scope();
    const removed = drafts.remove(id, key);
    if (!removed) return;
    toast('下書きを削除しました', { action: () => {
      if (!drafts.restore(removed.draft, removed.index, key)) toast('元に戻せませんでした', { kind: 'error' });
    } });
  }

  // 下書きはこの端末だけのものなので、確認せずに消して「元に戻す」を出す（共有する配合の削除だけ確認する。判断事項 7）
  function removeAll() {
    const key = drafts.scope();
    const focused = globalThis.document?.activeElement === removeAllButton;
    // 押した時点で見えている下書きだけを消す（送信中で隠れている下書きは残る）
    const removed = drafts.removeAll(visible(key).map((draft) => draft.id), key);
    if (!removed) return;
    // 押した「すべて削除」は押せなくなってフォーカスを失うので、「＋ 下書きに追加」へ移す（その次の Tab でトーストの「元に戻す」）
    if (focused) add.focus();
    toast(`${removed.length} 件の下書きを削除しました`, { action: () => {
      if (!drafts.restoreMany(removed, key)) toast('元に戻せませんでした', { kind: 'error' });
    } });
  }

  function update() {
    if (destroyed) return;
    const ready = Boolean(drafts.scope());
    setDisabled(add, !ready, 'ログインすると下書きを作れます');
    saveWarning.hidden = !drafts.saveFailed;
    const items = ready ? visible() : [];
    toggleText.textContent = `下書き ${items.length} 件（この端末だけ）`;
    toggle.setAttribute('aria-expanded', String(isOpen));
    element.classList.toggle('is-open', isOpen);
    body.hidden = !isOpen;
    // 押せない理由: 一括登録の途中は「登録しています」、下書きがなければ「下書きがありません」、記録の読み込み前は「読み込んでいます」
    const bulkReason = bulkRunning ? '登録しています' : !items.length ? '下書きがありません' : '登録済みの配合を読み込んでいます';
    setDisabled(registerAll, bulkRunning || !items.length || !store.state.env, bulkReason);
    setDisabled(removeAllButton, bulkRunning || !items.length, bulkRunning ? '登録しています' : '下書きがありません');
    // 閉じている間も行は作っておく（開いたときに組み立て直さない。数は多くない）。同じ下書きの行は使い回し、送信の状態（status）の
    // 変化も update で伝える
    syncList(list, items, {
      key: (draft) => draft.id,
      create: (draft) => {
        const row = draftRow(context, draft, removeOne);
        row.update(draft, drafts.status(draft.id));
        return { element: row.element, update: (next) => row.update(next, drafts.status(next.id)) };
      },
      empty: () => el('p', 'drafts-band-empty', '下書きはありません。「＋ 下書きに追加」から作れます。'),
      fallbackFocus: add,
    });
  }

  const unsubscribeDrafts = drafts.subscribe(update);
  const unsubscribeStore = store.subscribe?.(() => update()) ?? (() => {});
  update();
  return {
    element,
    update({ open: next } = {}) {
      if (next !== undefined) isOpen = Boolean(next);
      update();
    },
    destroy() {
      destroyed = true;
      unsubscribeDrafts();
      unsubscribeStore();
    },
  };
}
