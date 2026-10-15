import { el, button, field, runButton } from './dom.js';
import { openDialog, confirmDialog } from './dialog.js';
import { palPicker } from './pal-picker.js';
import { breedingCard, breedingEquation } from './breeding-card.js';
import { palTile, palsById } from './pal-icon.js';
import { toast } from './toast.js';
import { syncInBackground } from './sync.js';
import { genderToggle } from './gender-toggle.js';
import { ownedBadge } from './owned-badge.js';
import { findByPair, findByParent, findConflict } from '../core/index.js';
import { identityKey } from '../core/pair.js';
import { validateRecordInput } from '../core/validate.js';
import { ownedCounts } from '../core/owned.js';
import { userIdKey } from '../core/user.js';

// 確認の枠に出す登録済みの子の数（超えた分は「ほか N 件」）と、参照列に出す親の登録済みの配合の数
const CHECK_MAX = 3;
const PARENT_RECORDS_MAX = 4;
const collator = new Intl.Collator('ja');

const fieldNames = {
  parent1Id: '親1', parent2Id: '親2', childId: '子', parent1Gender: '親1の性別', parent2Gender: '親2の性別',
  registrant: '登録者', memo: 'メモ', id: '登録の識別情報', opId: '操作の識別情報', record: '配合',
};
const validationMessages = {
  INVALID_PAL_ID: 'パルを選んでください。', INVALID_GENDER: '性別のデータが正しくありません。開き直してください。',
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

/**
 * 配合の登録・編集のモーダル（draft なら下書き版）。左右 2 列: 上に式の並びの選択欄「親1 ＋ 親2 → 子」と親の性別（任意）、
 * 左に登録者とメモ・エラー、右に参照列（高さを固定した確認の枠・その親の登録済みの配合・所持数）。
 * 新規の入力があるまま ×・Esc・キャンセルで閉じたら下書きに残し、トーストの「破棄」で消せる（register-dialog。F019）
 */
export function openRecordEditor(context, initial = {}, { draft = false } = {}) {
  const { store } = context;
  const original = !draft && initial.id ? initial : null;
  // 下書き版はサーバへ送らず、開いたときの ID・環境の下書きに保存する。
  const draftId = draft ? initial.id ?? '' : '';
  const draftKey = draft ? context.drafts.scope() : '';
  let createId = crypto.randomUUID();
  const pickers = [];
  const genders = [];
  let unsubscribe = () => {};
  const title = draft ? (draftId ? '下書きを編集' : '下書きに保存') : original ? '配合を編集' : '見つけた配合を登録';
  const modal = openDialog(title, {
    className: 'record-dialog', closeOnBackdrop: false, beforeClose: (reason) => evacuate(reason),
    onClose: () => { unsubscribe(); pickers.forEach((picker) => picker.destroy()); genders.forEach((toggle) => toggle.destroy()); },
  });
  const form = el('form', 'record-form');
  form.id = `record-${crypto.randomUUID()}`;
  const selections = el('div', 'editor-pickers');
  const genderRow = el('div', 'editor-genders');
  const errors = el('div', 'form-errors');
  errors.setAttribute('role', 'alert');
  errors.id = `record-errors-${crypto.randomUUID()}`;
  const registrant = el('select');

  // 登録者の選択肢: 自分を先頭、残りは五十音順（今の値が一覧になければ先頭に足す。空は「未指定」）
  function setRegistrant(value) {
    registrant.replaceChildren();
    const me = store.state.userId;
    const others = [...store.state.users].filter((userId) => userIdKey(userId) !== userIdKey(me ?? '')).sort(collator.compare);
    const users = me ? [me, ...others] : others;
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
  memo.rows = 2;
  memo.value = initial.memo ?? '';

  function value() {
    return {
      parent1Id: pickers[0].getValue(), parent2Id: pickers[1].getValue(), childId: pickers[2].getValue(),
      parent1Gender: pickers[0].getValue() ? genders[0].getValue() : '', parent2Gender: pickers[1].getValue() ? genders[1].getValue() : '',
      registrant: registrant.value, memo: memo.value,
    };
  }

  // ---- 参照列（右）: 確認の枠（高さを固定。入力でメモ欄・フッターが動かない）・その親の登録済みの配合・所持数 ----
  const check = el('div', 'editor-check');
  check.setAttribute('aria-live', 'polite');
  const parentRecords = el('div', 'editor-parent-records');
  const ownedLine = el('div', 'editor-owned');
  const reference = el('aside', 'editor-reference');
  reference.setAttribute('aria-label', '登録済みの配合と所持数');
  reference.append(check, parentRecords, ownedLine);
  // 所持数は開いたときの所持パルで 1 回だけ数える（データが無ければ出さない）
  const ownedPals = context.owned?.state?.owned?.pals;
  const counts = Array.isArray(ownedPals) ? ownedCounts(ownedPals) : null;

  function renderReference() {
    if (pickers.length < 3) return;
    const input = value();
    check.replaceChildren();
    check.classList.toggle('is-warning', false);
    pickers[2].element.classList.toggle('is-warning', false);
    if (!input.parent1Id || !input.parent2Id) {
      check.append(el('p', 'editor-check-hint', '親1・親2 を選ぶと、登録済みの配合を確かめます。'));
    } else {
      const records = findByPair(store.state.index, input.parent1Id, input.parent2Id).filter((record) => record.id !== original?.id);
      if (!records.length) check.append(el('p', 'editor-check-hint', 'まだ登録されていない組み合わせです。'));
      else {
        check.append(el('p', 'editor-check-title', 'この組み合わせは登録済み:'));
        const list = el('div', 'editor-check-children');
        // 子の絵を押すと、子の選択欄にその子を入れる
        for (const record of records.slice(0, CHECK_MAX)) {
          const choose = button('', () => {
            pickers[2].setValue(record.childId);
            renderReference();
          }, 'editor-check-child');
          choose.append(palTile(record.childId, { clickable: false }));
          choose.title = 'この子を選ぶ';
          list.append(choose);
        }
        if (records.length > CHECK_MAX) list.append(el('span', 'editor-check-more', `ほか ${records.length - CHECK_MAX} 件`));
        check.append(list);
        if (input.childId && records.some((record) => record.childId !== input.childId)) {
          check.classList.add('is-warning');
          pickers[2].element.classList.add('is-warning');
          check.append(el('p', 'warning-text', '同じ組み合わせで別の子が登録されています。'));
        }
      }
    }
    // その親の登録済みの配合（親1、なければ親2。相手 → 子）
    parentRecords.replaceChildren();
    const parent = input.parent1Id || input.parent2Id;
    if (parent) {
      const records = findByParent(store.state.index, parent);
      parentRecords.append(el('p', 'editor-reference-title', `${palsById.get(parent)?.ja ?? parent} の登録済みの配合 ${records.length} 件`));
      for (const record of records.slice(0, PARENT_RECORDS_MAX)) parentRecords.append(breedingEquation(record, { focusParent: parent }));
      if (records.length > PARENT_RECORDS_MAX) parentRecords.append(el('p', 'editor-check-more', `ほか ${records.length - PARENT_RECORDS_MAX} 件`));
    }
    // 所持数（所持パルのデータがあるときだけ。親ごとに ♂n ♀m）
    ownedLine.replaceChildren();
    if (counts && (input.parent1Id || input.parent2Id)) {
      ownedLine.append(el('span', 'editor-reference-title', '所持'));
      for (const [key, label] of [['parent1Id', '親1'], ['parent2Id', '親2']]) {
        if (!input[key]) continue;
        const item = el('span', 'editor-owned-item');
        item.append(el('span', '', label), ownedBadge(counts, input[key]));
        ownedLine.append(item);
      }
    }
  }

  // 検証の失敗を、最初の未選択の欄に結ぶ（aria-invalid と枠の色。エラー文と aria-describedby）。選び直したら外す
  function clearInvalid(picker) {
    const trigger = picker.element.querySelector('.picker-trigger');
    trigger?.removeAttribute('aria-invalid');
    trigger?.removeAttribute('aria-describedby');
    picker.element.classList.toggle('is-invalid', false);
  }

  for (const [index, [key, label]] of [['parent1Id', '親1'], ['parent2Id', '親2'], ['childId', '子']].entries()) {
    const picker = palPicker({ label, value: initial[key] ?? '', popupHost: modal.dialog, onChange: () => {
      clearInvalid(picker);
      // その枠のパルを変えたら、その枠の性別だけ空に戻す（D-15）
      if (index < 2) genders[index].setValue('');
      renderReference();
    } });
    pickers.push(picker);
  }
  for (const [index, label] of ['親1の性別', '親2の性別'].entries()) {
    genders.push(genderToggle({ label, value: initial[`parent${index + 1}Gender`] ?? '' }));
  }
  const symbol = (text, className = '') => {
    const node = el('span', `equation-symbol ${className}`.trim(), text);
    node.setAttribute('aria-hidden', 'true');
    return node;
  };
  selections.append(pickers[0].element, symbol('＋'), pickers[1].element, symbol('→', 'arrow'), pickers[2].element);
  genderRow.append(genders[0].element, el('span'), genders[1].element);
  const submit = button(draft ? '下書きに保存' : original ? '変更を保存' : '登録', null, 'button primary');
  submit.type = 'submit';
  submit.setAttribute('form', form.id);
  const continuous = original || draftId ? null : button(draft ? '続けて下書きに保存' : '続けて登録', () => save(true), 'button secondary');
  const main = el('div', 'editor-main');
  const details = el('div', 'editor-details');
  details.append(field('登録者', registrant), field('メモ（200文字まで）', memo));
  main.append(details, errors);
  const columns = el('div', 'editor-columns');
  columns.append(main, reference);
  form.append(selections, genderRow, columns);
  modal.body.append(form);
  modal.footer.append(button('キャンセル', () => modal.requestClose('cancel'), 'button secondary'));
  if (continuous) modal.footer.append(continuous);
  modal.footer.append(submit);

  function showErrors(items) {
    errors.replaceChildren();
    for (const item of items) errors.append(el('p', '', validationText(item)));
    // 最初の未選択のパルの欄に印を付けてフォーカスする（どれも選んであれば、エラー文が見える位置へ）
    const missing = pickers.find((picker) => !picker.getValue());
    const palError = items.some((item) => ['parent1Id', 'parent2Id', 'childId'].includes(item.field));
    if (missing && palError) {
      const trigger = missing.element.querySelector('.picker-trigger');
      trigger.setAttribute('aria-invalid', 'true');
      trigger.setAttribute('aria-describedby', errors.id);
      missing.element.classList.add('is-invalid');
      trigger.focus();
      return;
    }
    errors.scrollIntoView?.({ block: 'nearest' });
  }

  // ---- 閉じるときの下書きへの退避（F019）: 新規で、開いたとき（続けて登録の直後）から入力が変わり、パルかメモが入っているときだけ ----
  let baseline = '';
  const snapshot = () => JSON.stringify(value());
  const markBaseline = () => { baseline = snapshot(); };
  function evacuable() {
    if (original || draft || !context.drafts) return false;
    const input = value();
    return snapshot() !== baseline && Boolean(input.parent1Id || input.parent2Id || input.childId || input.memo.trim());
  }
  // 閉じてよければ true。退避に失敗したら（ログインしていない・ID の変更中・端末に保存できない）フォームを残して false
  function evacuate(reason) {
    if (!evacuable()) return true;
    const checked = validateRecordInput(value(), new Set(['', ...palsById.keys()]));
    const input = value();
    const key = context.drafts.scope();
    let saved = null;
    if (checked.ok) {
      const { parent1Id, parent2Id, childId, parent1Gender, parent2Gender, registrant: name, memo: text } = checked.value;
      saved = context.drafts.add({ parent1Id, parent2Id, childId, parent1Gender, parent2Gender, registrant: name, memo: text }, key);
      if (saved && context.drafts.saveFailed) {
        context.drafts.remove(saved.id, key);
        saved = null;
      }
    }
    if (!saved) {
      if (reason === 'forced') {
        // 止められずに閉じた（ログアウトでは知らせない）。入力のまま開き直せるようにする
        if (context.drafts.scope()) toast('入力を下書きに残せませんでした', { kind: 'error', actionLabel: '開き直す', action: () => context.register(input) });
        return true;
      }
      if (!checked.ok) showErrors(checked.errors);
      else errors.replaceChildren(el('p', '', '下書きに残せませんでした。登録するか、内容を控えてから閉じてください。'));
      return false;
    }
    toast('下書きに残しました', { actionLabel: '破棄', action: () => context.drafts.remove(saved.id, key) });
    return true;
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

  // 続けて登録するときは親1（と性別）と登録者を残し、次の入力に備える。
  function prepareNext(input) {
    createId = crypto.randomUUID();
    pickers[0].setValue(input.parent1Id);
    pickers[1].setValue('');
    pickers[2].setValue('');
    genders[1].setValue('');
    setRegistrant(input.registrant);
    memo.value = '';
    errors.replaceChildren();
    renderReference();
    markBaseline();
    pickers[1].element.querySelector('button').focus();
  }

  function saveDraft(keepOpen) {
    // 下書きはパルの未選択を許し、登録者とメモは通常の登録と同じ規則で確かめる。
    const checked = validateRecordInput(value(), new Set(['', ...palsById.keys()]));
    if (!checked.ok) { showErrors(checked.errors); return; }
    const { parent1Id, parent2Id, childId, parent1Gender, parent2Gender, registrant: name, memo: text } = checked.value;
    const fields = { parent1Id, parent2Id, childId, parent1Gender, parent2Gender, registrant: name, memo: text };
    const saved = draftId ? context.drafts.update(draftId, fields, draftKey) : context.drafts.add(fields, draftKey);
    if (!saved) { errors.replaceChildren(el('p', '', '下書きを保存できませんでした。画面を開き直してください。')); return; }
    if (keepOpen) {
      prepareNext(checked.value);
      toast('下書きに保存しました。続けて保存できます');
      return;
    }
    modal.close();
    toast(draftId ? '下書きを保存しました' : '下書きに保存しました');
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
    renderReference();
  });
  renderReference();
  markBaseline();
  // 最初の未選択のパルの欄へ（どれも選んであれば登録のボタンへ。D-17）
  (pickers.find((picker) => !picker.getValue())?.element.querySelector('.picker-trigger') ?? submit).focus();
  return modal;
}
