import { el, button, empty } from '../ui/dom.js';
import { palPicker } from '../ui/pal-picker.js';
import { actionIcon, icons, breedingCard, breedingEquation } from '../ui/breeding-card.js';
import { palsById } from '../ui/pal-icon.js';
import { confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { validationText } from '../ui/record-editor.js';
import { errorMessage } from '../api.js';
import { findConflict } from '../core/index.js';
import { validateRecordInput } from '../core/validate.js';
import { DRAFT_PALS, sameDraftContent } from '../drafts.js';
import { viewHeading, watchView, dataPending } from './shared.js';

const palLabels = { parent1Id: '親1', parent2Id: '親2', childId: '子' };

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
  const checked = validateRecordInput({ ...draft, parent1Gender: '', parent2Gender: '' }, new Set(palsById.keys()));
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
    else if (failed) toast(`配合を登録できませんでした。${drafts.status(ids[0]).error}`);
  } else if (registered || kept) {
    toast(`${registered} 件を登録しました${kept ? `。${kept} 件は下書きに残っています` : ''}`);
  }
  // サーバに断られたときは、他の人の登録を取り込むため最新を取り直す。
  if (failed) {
    try { await store.refresh(); } catch { /* 取得の失敗は同期状態に表示される。 */ }
  }
  return { registered, kept };
}

function draftRow(context, draft, onRemove) {
  const { drafts } = context;
  let current = draft;
  let shown = null;
  const row = el('article', 'draft-row');
  row.setAttribute('aria-label', '下書き');
  const equation = el('div', 'breeding-equation draft-equation');
  const pickers = DRAFT_PALS.map((field) => {
    const picker = palPicker({ label: palLabels[field], value: draft[field], onChange: (id) => {
      if (!drafts.update(current.id, { [field]: id })) picker.setValue(current[field]);
    } });
    return picker;
  });
  equation.append(pickers[0].element, el('span', 'equation-symbol', '＋'), pickers[1].element,
    el('span', 'equation-symbol arrow', '→'), pickers[2].element);
  const meta = el('div', 'card-meta');
  const register = button('登録', () => registerDrafts(context, [current.id]), 'button primary small');
  register.setAttribute('aria-label', 'この下書きを登録');
  const actions = el('div', 'card-actions draft-actions');
  actions.append(register, actionIcon('編集', icons.edit, () => context.register(current, { draft: true })),
    actionIcon('削除', icons.remove, () => onRemove(current.id), 'danger-text'));
  const memo = el('p', 'draft-memo');
  const message = el('p', 'draft-message');
  message.setAttribute('aria-live', 'polite');
  row.append(equation, meta, actions, memo, message);
  return {
    element: row,
    update(next, status) {
      if (shown?.draft === next && shown.status === status) return;
      shown = { draft: next, status };
      current = next;
      DRAFT_PALS.forEach((field, index) => { if (pickers[index].getValue() !== next[field]) pickers[index].setValue(next[field]); });
      meta.replaceChildren(el('span', '', next.registrant || '登録者未指定'));
      memo.textContent = next.memo;
      memo.hidden = !next.memo;
      register.disabled = status.sending || DRAFT_PALS.some((field) => !next[field]);
      // 送信中は送った内容と下書きを一致させておくため、選択・編集・削除を止める。
      equation.inert = status.sending;
      actions.inert = status.sending;
      row.classList.toggle('sending', status.sending);
      message.textContent = status.sending ? '登録中…' : status.error;
      message.classList.toggle('draft-error', !status.sending && Boolean(status.error));
      message.hidden = !message.textContent;
    },
    destroy() { pickers.forEach((picker) => picker.destroy()); },
  };
}

export function draftsView(context) {
  const { store, drafts } = context;
  const element = el('section', 'view drafts-view');
  const heading = viewHeading('下書き');
  heading.classList.add('drafts-heading');
  let bulkRunning = false;
  let destroyed = false;
  const bulkRegister = button('一括登録', async () => {
    bulkRunning = true;
    update();
    try { await registerDrafts(context, drafts.list().map((draft) => draft.id)); } finally {
      bulkRunning = false;
      update();
    }
  }, 'button primary small');
  const bulkRemove = button('一括削除', () => removeAll(), 'button secondary small danger-text');
  const headingActions = el('div', 'heading-actions');
  headingActions.append(bulkRegister, bulkRemove);
  heading.append(headingActions);
  const addWithDialog = button('＋ 下書きに登録', () => context.register({}, { draft: true }), 'button secondary small');
  const count = el('p', 'result-note');
  const toolbar = el('div', 'drafts-toolbar');
  toolbar.append(addWithDialog, count);
  const storageWarning = el('p', 'form-errors drafts-warning',
    'この端末に下書きを保存できませんでした。ページを閉じると、保存できなかった変更は失われます。');
  storageWarning.setAttribute('role', 'alert');
  const list = el('div', 'card-stack draft-list');
  const addEmpty = button('＋ 空の下書きを追加', () => {
    const draft = drafts.add();
    rows.get(draft?.id)?.element.querySelector('.picker-trigger')?.focus();
  }, 'button secondary drafts-add');
  element.append(heading, toolbar, storageWarning, list, addEmpty);
  const rows = new Map();

  function removeOne(id) {
    const key = drafts.scope();
    const removed = drafts.remove(id, key);
    if (!removed) return;
    toast('下書きを削除しました', { action: () => { drafts.restore(removed.draft, removed.index, key); } });
  }

  async function removeAll() {
    const key = drafts.scope();
    const total = drafts.list(key).length;
    if (!total) return;
    if (!await confirmDialog('すべての下書きを削除しますか？', `${total} 件の下書きを削除します。この操作は元に戻せません。`,
      { confirmText: '削除', danger: true })) return;
    if (drafts.scope() !== key) return;
    // 確認の間に送信が始まった下書きは残る。
    const removed = drafts.removeMany(drafts.list(key).map((draft) => draft.id), key);
    if (removed) toast(`${removed} 件の下書きを削除しました`);
  }

  function clearRows() {
    for (const row of rows.values()) row.destroy();
    rows.clear();
  }

  function update() {
    if (destroyed) return;
    const ready = Boolean(drafts.scope());
    addWithDialog.disabled = !ready;
    addEmpty.disabled = !ready;
    storageWarning.hidden = !drafts.saveFailed;
    const items = drafts.list();
    const sending = items.some((draft) => drafts.status(draft.id).sending);
    bulkRegister.disabled = bulkRunning || !items.length;
    bulkRemove.disabled = bulkRunning || sending || !items.length;
    if (dataPending(list, store.state)) {
      clearRows();
      count.textContent = '';
      return;
    }
    count.textContent = `${items.length} 件の下書き`;
    const ids = new Set(items.map((draft) => draft.id));
    for (const [id, row] of rows) {
      if (ids.has(id)) continue;
      row.destroy();
      row.element.remove();
      rows.delete(id);
    }
    for (const draft of items) {
      if (!rows.has(draft.id)) {
        rows.set(draft.id, draftRow(context, draft, removeOne));
        list.append(rows.get(draft.id).element);
      }
      rows.get(draft.id).update(draft, drafts.status(draft.id));
    }
    if (!items.length) {
      list.replaceChildren(empty('下書きはありません。「＋ 空の下書きを追加」か「＋ 下書きに登録」から作れます。'));
      return;
    }
    // 付け直すとフォーカスと開いている候補が外れるため、並びが変わったとき（元に戻すなど）だけ並べ直す。
    const nodes = items.map((draft) => rows.get(draft.id).element);
    const children = Array.from(list.children);
    if (children.length !== nodes.length || children.some((node, index) => node !== nodes[index])) list.replaceChildren(...nodes);
  }

  const unsubscribe = drafts.subscribe(update);
  const view = watchView(store, element, update);
  return {
    element,
    destroy() {
      destroyed = true;
      view.destroy();
      unsubscribe();
      clearRows();
    },
  };
}
