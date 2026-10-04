import { el, button, formatTime, runButton } from './dom.js';
import { palTile } from './pal-icon.js';
import { toast } from './toast.js';

export const icons = {
  edit: 'M14 5l5 5M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z',
  remove: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
};

export function svgIcon(path) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const drawing = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  drawing.setAttribute('d', path);
  svg.append(drawing);
  return svg;
}

export function actionIcon(label, path, action, className = '') {
  const node = button('', action, `icon-button card-action ${className}`.trim());
  node.setAttribute('aria-label', label);
  node.title = label;
  node.append(svgIcon(path));
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
  if (record.deleted) metadata.append(el('span', 'warning-chip', '削除済み'));
  card.append(equation, metadata);
  if (record.memo) card.append(el('p', 'card-memo', record.memo));
  if (preview) return card;
  const actions = el('div', 'card-actions');
  const edit = actionIcon('編集', icons.edit, () => context.register(record));
  const remove = actionIcon('削除', icons.remove, async () => {
    await runButton(remove, () => context.remove(record), (error) => toast(error.message));
  }, 'danger-text');
  actions.append(edit, remove);
  card.append(actions);
  return card;
}
