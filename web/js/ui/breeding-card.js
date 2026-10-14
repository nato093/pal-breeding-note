import { el, button, formatTime, runButton, statusChip } from './dom.js';
import { icon } from './icons.js';
import { palTile } from './pal-icon.js';
import { toast } from './toast.js';

/** 絵だけの操作のボタン（編集・削除など）。name は ui/icons.js のアイコンの名前、label は読み上げの名前と title */
export function actionIcon(label, name, action, className = '') {
  const node = button('', action, `icon-button card-action ${className}`.trim());
  node.setAttribute('aria-label', label);
  node.title = label;
  node.append(icon(name));
  return node;
}

export function breedingEquation(record, { focusParent = '', leftParent = '' } = {}) {
  const equation = el('div', 'breeding-equation');
  if (focusParent) {
    const first = record.parent1Id === focusParent;
    equation.append(palTile(first ? record.parent2Id : record.parent1Id, {
      gender: first ? record.parent2Gender : record.parent1Gender,
    }));
  } else {
    const swapped = leftParent && record.parent1Id !== leftParent && record.parent2Id === leftParent;
    const [left, right] = swapped ? ['parent2', 'parent1'] : ['parent1', 'parent2'];
    equation.append(palTile(record[`${left}Id`], { gender: record[`${left}Gender`] }), el('span', 'equation-symbol', '＋'),
      palTile(record[`${right}Id`], { gender: record[`${right}Gender`] }));
  }
  equation.append(el('span', 'equation-symbol arrow', '→'), palTile(record.childId));
  return equation;
}

export function breedingCard(record, context = {}, { preview = false, focusParent = '', leftParent = '' } = {}) {
  const card = el('article', 'breeding-card');
  card.setAttribute('aria-label', '登録済みの配合');
  const equation = breedingEquation(record, { focusParent, leftParent });
  const metadata = el('div', 'card-meta');
  metadata.append(el('span', '', record.registrant || '登録者未指定'), el('time', 'updated-time', `更新 ${formatTime(record.updatedAt, true)}`));
  if (record.deleted) metadata.append(statusChip('削除済み', 'warning', 'warning-chip'));
  card.append(equation, metadata);
  if (record.memo) card.append(el('p', 'card-memo', record.memo));
  if (preview) return card;
  const actions = el('div', 'card-actions');
  const edit = actionIcon('編集', 'edit', () => context.register(record));
  const remove = actionIcon('削除', 'remove', async () => {
    // 確認のカードは押した行と同じ左右で出す（相手 → 子の形〔focusParent〕のカードは両親の形のまま）
    await runButton(remove, () => context.remove(record, { leftParent: focusParent ? '' : leftParent }), (error) => toast(error.message, { kind: 'error' }));
  }, 'danger-text');
  // 一覧の差分更新（syncList）で、同じカードの同じボタンへフォーカスを戻すための目印
  edit.setAttribute('data-focus', 'edit');
  remove.setAttribute('data-focus', 'remove');
  actions.append(edit, remove);
  card.append(actions);
  return card;
}
