import { el, button, field, runButton } from './dom.js';
import { openDialog, confirmDialog } from './dialog.js';
import { palPicker } from './pal-picker.js';
import { breedingCard } from './breeding-card.js';
import { palsById } from './pal-icon.js';
import { toast } from './toast.js';
import { syncInBackground } from './sync.js';
import { findByPair, findConflict } from '../core/index.js';
import { identityKey } from '../core/pair.js';
import { validateRecordInput } from '../core/validate.js';

const fieldNames = {
  parent1Id: '親1', parent2Id: '親2', childId: '子', parent1Gender: '親1の性別', parent2Gender: '親2の性別',
  registrant: '登録者', memo: 'メモ', id: '登録の識別情報', opId: '操作の識別情報', record: '配合',
};
const validationMessages = {
  INVALID_PAL_ID: 'パルを選んでください。', INVALID_GENDER: '性別データが正しくありません。管理者に確認してください。',
  TOO_LONG: '文字数が上限を超えています。', UNKNOWN_FIELD: '入力項目が正しくありません。',
  INVALID_UUID: '識別情報が正しくありません。画面を開き直してください。',
};

export function validationText(item) {
  return `${fieldNames[item.field] ?? '入力内容'}: ${validationMessages[item.code] ?? '入力を確認してください。'}`;
}

// 裏で送った保存が失敗したら、入力内容で開き直す。他の人の更新と競合したときは最新の内容で開く。
function reopen(context, original, input, error) {
  // 登録が消えていたら（他の人の削除や、元に戻した登録の統合）、入力内容を新しい登録として開く。
  if (!original || error.code === 'NOT_FOUND') return context.register(input);
  const conflict = error.code === 'CONFLICT';
  // 競合時は全件取得の完了を待たず、サーバが返した最新の内容を使う（統合の競合は元の登録の分）。
  const latest = (conflict && [error.response?.latest, error.response?.latest?.source].find((record) => record?.id === original.id))
    || context.store.state.records.find((record) => record.id === original.id);
  if (!latest) return context.register(input);
  return context.register(conflict ? latest : { ...latest, ...input });
}

export function openRecordEditor(context, initial = {}, { draft = false } = {}) {
  const { store } = context;
  const original = !draft && initial.id ? initial : null;
  // 下書き版はサーバへ送らず、開いたときの ID・環境の下書きに保存する。
  const draftId = draft ? initial.id ?? '' : '';
  const draftKey = draft ? context.drafts.scope() : '';
  let createId = crypto.randomUUID();
  const pickers = [];
  let unsubscribe = () => {};
  const title = draft ? (draftId ? '下書きを編集' : '下書きに登録') : original ? '配合を編集' : '見つけた配合を登録';
  const modal = openDialog(title, {
    className: 'record-dialog', closeOnBackdrop: false,
    onClose: () => { unsubscribe(); pickers.forEach((picker) => picker.destroy()); },
  });
  const form = el('form', 'record-form');
  form.id = `record-${crypto.randomUUID()}`;
  const selections = el('div', 'editor-pickers');
  const warning = el('div', 'editor-warning');
  warning.setAttribute('aria-live', 'polite');
  const errors = el('div', 'form-errors');
  errors.setAttribute('role', 'alert');
  const registrant = el('select');

  function setRegistrant(value) {
    registrant.replaceChildren();
    const users = [...store.state.users];
    if (!users.includes(value)) users.unshift(value);
    for (const userId of users) {
      const option = el('option', '', userId || '未指定');
      option.value = userId;
      registrant.append(option);
    }
    registrant.value = value;
  }
  setRegistrant(original ? original.registrant ?? '' : initial.registrant ?? store.state.userId);
  const memo = el('textarea');
  memo.maxLength = 200;
  memo.rows = 3;
  memo.value = initial.memo ?? '';

  function value() {
    const sameParents = original && original.parent1Id === pickers[0].getValue() && original.parent2Id === pickers[1].getValue();
    return {
      parent1Id: pickers[0].getValue(), parent2Id: pickers[1].getValue(), childId: pickers[2].getValue(),
      parent1Gender: sameParents ? original.parent1Gender ?? '' : '',
      parent2Gender: sameParents ? original.parent2Gender ?? '' : '', registrant: registrant.value, memo: memo.value,
    };
  }

  function renderWarnings() {
    warning.replaceChildren();
    if (pickers.length < 3) return;
    const input = value();
    if (!input.parent1Id || !input.parent2Id) return;
    const records = findByPair(store.state.index, input.parent1Id, input.parent2Id).filter((record) => record.id !== original?.id);
    for (const record of records) {
      const row = el('div', 'preflight-record');
      row.append(el('span', '', `この組み合わせは登録済み: → ${palsById.get(record.childId)?.ja ?? '不明'}`));
      warning.append(row);
    }
    if (input.childId && records.some((record) => record.childId !== input.childId)) {
      warning.append(el('p', 'warning-text', '同じ組み合わせで別の子が登録されています。'));
    }
  }

  for (const [key, label] of [['parent1Id', '親1'], ['parent2Id', '親2'], ['childId', '子']]) {
    const picker = palPicker({ label, value: initial[key] ?? '', popupHost: modal.dialog, onChange: renderWarnings });
    pickers.push(picker);
    selections.append(picker.element);
  }
  const submit = button(draft ? '下書きに保存' : original ? '変更を保存' : '登録', null, 'button primary');
  submit.type = 'submit';
  submit.setAttribute('form', form.id);
  const continuous = original || draftId ? null : button(draft ? '続けて下書きに登録' : '続けて登録', () => save(true), 'button secondary');
  form.append(selections, warning, field('登録者', registrant), field('メモ（200文字まで）', memo), errors);
  modal.body.append(form);
  modal.footer.append(button('キャンセル', modal.close, 'button secondary'));
  if (continuous) modal.footer.append(continuous);
  modal.footer.append(submit);

  function showErrors(items) {
    errors.replaceChildren();
    for (const item of items) errors.append(el('p', '', validationText(item)));
    errors.scrollIntoView({ block: 'nearest' });
  }

  async function send(input, keepOpen, allowDifferentChild = false) {
    // 確認が要る重複と別の子は、閉じる前に手元の登録で判定する。
    const identityChanged = !original || identityKey(input) !== identityKey(original);
    const conflict = findConflict(store.state.index, { id: original?.id ?? createId, ...input },
      { checkPair: identityChanged && !allowDifferentChild });
    if (conflict?.code === 'PAIR_CONFLICT') {
      const preview = el('div', 'card-stack');
      for (const record of conflict.existing) preview.append(breedingCard(record, {}, { preview: true }));
      const accepted = await confirmDialog('別の結果として登録しますか？',
        '本当に結果が違う場合だけ登録してください。',
        { preview, confirmText: '別の結果として保存' });
      if (accepted) await send(input, keepOpen, true);
      return;
    }
    if (conflict?.code === 'DUPLICATE') {
      if (!original) { errors.replaceChildren(el('p', '', '同じ配合がすでに登録されています。')); return; }
      const accepted = await confirmDialog('同じ配合が登録済みです', '編集中の登録を既存の登録に統合しますか？', {
        preview: breedingCard(conflict.existing, {}, { preview: true }), confirmText: '統合',
      });
      if (!accepted) return;
      // 統合は既存の登録に移る操作なので、編集画面は閉じてから送る。
      modal.close();
      await context.merge(original, conflict.existing, { ask: false, retry: (error) => reopen(context, original, input, error) });
      return;
    }
    const payload = original
      ? { id: original.id, expectedEtag: original.etag, record: input }
      : { record: { id: createId, ...input } };
    if (allowDifferentChild) payload.allowDifferentChild = true;
    const pending = store.mutate(original ? 'update' : 'create', payload);
    if (!original && keepOpen) prepareNext(input);
    else modal.close();
    syncInBackground(store, pending, {
      failure: original ? '変更を保存できませんでした' : '配合を登録できませんでした',
      retry: (error) => reopen(context, original, input, error),
      done: () => toast(original ? '変更を保存しました' : '配合を登録しました'),
    });
  }

  // 続けて登録するときは親1と登録者を残し、次の入力に備える。
  function prepareNext(input) {
    createId = crypto.randomUUID();
    pickers[0].setValue(input.parent1Id);
    pickers[1].setValue('');
    pickers[2].setValue('');
    setRegistrant(input.registrant);
    memo.value = '';
    errors.replaceChildren();
    renderWarnings();
    pickers[1].element.querySelector('button').focus();
  }

  function saveDraft(keepOpen) {
    // 下書きはパルの未選択を許し、登録者とメモは通常の登録と同じ規則で確かめる。
    const checked = validateRecordInput(value(), new Set(['', ...palsById.keys()]));
    if (!checked.ok) { showErrors(checked.errors); return; }
    const { parent1Id, parent2Id, childId, registrant: name, memo: text } = checked.value;
    const fields = { parent1Id, parent2Id, childId, registrant: name, memo: text };
    const saved = draftId ? context.drafts.update(draftId, fields, draftKey) : context.drafts.add(fields, draftKey);
    if (!saved) { errors.replaceChildren(el('p', '', '下書きを保存できませんでした。画面を開き直してください。')); return; }
    if (keepOpen) {
      prepareNext(checked.value);
      toast('下書きに登録しました。続けて登録できます');
      return;
    }
    modal.close();
    toast(draftId ? '下書きを保存しました' : '下書きに登録しました');
  }

  async function save(keepOpen = false) {
    await runButton(submit, async () => {
      if (continuous) continuous.disabled = true;
      try {
        errors.replaceChildren();
        if (draft) { saveDraft(keepOpen); return; }
        const checked = validateRecordInput(value(), new Set(palsById.keys()));
        if (!checked.ok) { showErrors(checked.errors); return; }
        await send(checked.value, keepOpen);
      } finally { if (continuous) continuous.disabled = false; }
    }, (error) => { errors.replaceChildren(el('p', '', error.message)); });
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await save();
  });
  let lastIndex = store.state.index;
  let lastUsers = store.state.users;
  unsubscribe = store.subscribe((state) => {
    if (state.users !== lastUsers) {
      lastUsers = state.users;
      setRegistrant(registrant.value);
    }
    if (state.index === lastIndex) return;
    lastIndex = state.index;
    renderWarnings();
  });
  renderWarnings();
  return modal;
}
