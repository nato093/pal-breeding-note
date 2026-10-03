import { el, button, field, runButton } from './dom.js';
import { openDialog, confirmDialog } from './dialog.js';
import { palPicker } from './pal-picker.js';
import { breedingCard } from './breeding-card.js';
import { palsById } from './pal-icon.js';
import { toast } from './toast.js';
import { findByPair } from '../core/index.js';
import { identityKey } from '../core/pair.js';
import { validateRecordInput } from '../core/validate.js';

const fieldNames = {
  parent1Id: '親1', parent2Id: '親2', childId: '子', parent1Gender: '親1の性別', parent2Gender: '親2の性別',
  registrant: '登録者名', memo: 'メモ', id: '登録の識別情報', opId: '操作の識別情報', record: '配合',
};
const validationMessages = {
  INVALID_PAL_ID: 'パルを選んでください。', INVALID_GENDER: '性別を選び直してください。',
  TOO_LONG: '文字数が上限を超えています。', UNKNOWN_FIELD: '入力項目が正しくありません。',
  INVALID_UUID: '識別情報が正しくありません。画面を開き直してください。',
};

function genderSelect(value) {
  const select = el('select');
  for (const [key, name] of [['', '未指定'], ['M', '♂'], ['F', '♀']]) {
    const option = el('option', '', name);
    option.value = key;
    select.append(option);
  }
  select.value = value ?? '';
  return select;
}

export function openRecordEditor(context, initial = {}) {
  const { store } = context;
  let original = initial.id ? initial : null;
  let createId = crypto.randomUUID();
  const pickers = [];
  let unsubscribe = () => {};
  const modal = openDialog(original ? '配合を編集' : '見つけた配合を登録', {
    className: 'record-dialog', onClose: () => { unsubscribe(); pickers.forEach((picker) => picker.destroy()); },
  });
  const form = el('form', 'record-form');
  const selections = el('div', 'editor-pickers');
  const warning = el('div', 'editor-warning');
  warning.setAttribute('aria-live', 'polite');
  const errors = el('div', 'form-errors');
  errors.setAttribute('role', 'alert');
  const changeNote = el('p', 'warning-text');
  const details = el('details', 'editor-details');
  details.append(el('summary', '', '詳細 · 性別、登録者、メモ'));
  const genders = [genderSelect(initial.parent1Gender), genderSelect(initial.parent2Gender)];
  const registrant = el('input');
  registrant.type = 'text';
  registrant.maxLength = 30;
  registrant.value = initial.registrant ?? store.storage.get('pal-note.registrant') ?? '';
  const memo = el('textarea');
  memo.maxLength = 200;
  memo.rows = 3;
  memo.value = initial.memo ?? '';
  const detailGrid = el('div', 'detail-grid');
  detailGrid.append(field('親1の性別', genders[0]), field('親2の性別', genders[1]), field('登録者名（30文字まで）', registrant));
  details.append(detailGrid, field('メモ（200文字まで）', memo));
  const continuous = el('input');
  continuous.type = 'checkbox';
  const toggle = field('親1を固定して続けて登録', continuous);
  toggle.classList.add('toggle-field');
  if (original) toggle.hidden = true;

  function value() {
    return {
      parent1Id: pickers[0].getValue(), parent2Id: pickers[1].getValue(), childId: pickers[2].getValue(),
      parent1Gender: genders[0].value, parent2Gender: genders[1].value, registrant: registrant.value, memo: memo.value,
    };
  }

  function renderWarnings() {
    warning.replaceChildren();
    if (pickers.length < 3) return;
    const input = value();
    changeNote.textContent = original && identityKey(original) !== identityKey(input)
      ? '親または子を変えると、確認回数は 1 に戻ります。' : '';
    if (!input.parent1Id || !input.parent2Id) return;
    const records = findByPair(store.state.index, input.parent1Id, input.parent2Id).filter((record) => record.id !== original?.id);
    for (const record of records) {
      const row = el('div', 'preflight-record');
      row.append(el('span', '', `この組み合わせは登録済み: → ${palsById.get(record.childId)?.ja ?? '不明'}（確認 ${record.confirmCount} 回）`));
      const confirm = button('私も確認した +1', async () => {
        await runButton(confirm, () => context.confirm(record), (error) => toast(error.message));
      }, 'button secondary');
      row.append(confirm);
      warning.append(row);
    }
    if (input.childId && records.some((record) => record.childId !== input.childId)) {
      warning.append(el('p', 'warning-text', '同じ組み合わせで別の子が登録されています。'));
    }
  }

  for (const [key, label] of [['parent1Id', '親1'], ['parent2Id', '親2'], ['childId', '子']]) {
    const picker = palPicker({ label, value: initial[key] ?? '', storage: store.storage, onChange: renderWarnings });
    pickers.push(picker);
    selections.append(picker.element);
  }
  const submit = button(original ? '変更を保存' : '登録', () => form.requestSubmit(), 'button primary');
  form.append(selections, warning, changeNote, details, toggle, errors);
  modal.body.append(form);
  modal.footer.append(button('キャンセル', modal.close, 'button secondary'), submit);

  function showErrors(items) {
    errors.replaceChildren();
    for (const item of items) errors.append(el('p', '', `${fieldNames[item.field] ?? '入力内容'}: ${validationMessages[item.code] ?? '入力を確認してください。'}`));
    errors.scrollIntoView({ block: 'nearest' });
    if (items.some((item) => ['registrant', 'memo', 'parent1Gender', 'parent2Gender'].includes(item.field))) details.open = true;
  }

  async function send(input, allowDifferentChild = false) {
    const action = original ? 'update' : 'create';
    const payload = original
      ? { id: original.id, expectedEtag: original.etag, record: input }
      : { record: { id: createId, ...input } };
    if (allowDifferentChild) payload.allowDifferentChild = true;
    try {
      await store.mutate(action, payload);
      store.storage.set('pal-note.registrant', input.registrant);
      toast(original ? '変更を保存しました' : '配合を登録しました');
      if (!original && continuous.checked) {
        createId = crypto.randomUUID();
        pickers[1].setValue('');
        pickers[2].setValue('');
        genders[1].value = '';
        memo.value = '';
        errors.replaceChildren();
        renderWarnings();
      } else modal.close();
    } catch (error) {
      const response = error.response ?? {};
      if (error.code === 'VALIDATION') { showErrors(response.errors ?? []); return; }
      if (error.code === 'PAIR_CONFLICT') {
        const preview = el('div', 'card-stack');
        for (const record of response.existing ?? []) preview.append(breedingCard(record, {}, { preview: true }));
        const accepted = await confirmDialog('別の結果として登録しますか？',
          '性別違いなどで本当に結果が違う場合だけ登録してください（性別の入力を推奨）。',
          { preview, confirmText: '別の結果として保存' });
        if (accepted) await send(input, true);
        return;
      }
      if (error.code === 'DUPLICATE') {
        const accepted = await confirmDialog('同じ配合が登録済みです', original
          ? '編集中の登録を既存の登録に統合しますか？' : '既存の登録に「私も確認した +1」を追加しますか？', {
          preview: breedingCard(response.existing, {}, { preview: true }), confirmText: original ? '統合' : '私も確認した +1',
        });
        if (!accepted) return;
        if (original) await context.merge(original, response.existing, { ask: false });
        else await context.confirm(response.existing);
        modal.close();
        return;
      }
      if (error.code === 'CONFLICT') {
        await confirmDialog('他の人が先に更新しました', '最新の内容を読み込みます。入力内容を確認して、もう一度保存してください。', {
          preview: response.latest ? breedingCard(response.latest, {}, { preview: true }) : null, confirmText: '最新の内容を読み込む',
        });
        await store.refresh();
        const latest = store.state.records.find((record) => record.id === original?.id);
        if (!latest) { modal.close(); toast('この登録は見つかりません'); return; }
        original = latest;
        pickers.forEach((picker, index) => picker.setValue(latest[['parent1Id', 'parent2Id', 'childId'][index]]));
        genders[0].value = latest.parent1Gender;
        genders[1].value = latest.parent2Gender;
        registrant.value = latest.registrant;
        memo.value = latest.memo;
        renderWarnings();
        return;
      }
      throw error;
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await runButton(submit, async () => {
      errors.replaceChildren();
      const checked = validateRecordInput(value(), new Set(palsById.keys()));
      if (!checked.ok) { showErrors(checked.errors); return; }
      await send(checked.value);
    }, (error) => { errors.replaceChildren(el('p', '', error.message)); });
  });
  let lastIndex = store.state.index;
  unsubscribe = store.subscribe((state) => {
    if (state.index === lastIndex) return;
    lastIndex = state.index;
    renderWarnings();
  });
  renderWarnings();
  return modal;
}
