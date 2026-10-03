import { el, button, formatTime, runButton } from './dom.js';
import { palTile, palsById } from './pal-icon.js';
import { toast } from './toast.js';

export function breedingCard(record, context = {}, { preview = false, focusParent = '' } = {}) {
  const card = el('article', 'breeding-card');
  card.setAttribute('aria-label', '登録済みの配合');
  const equation = el('div', 'breeding-equation');
  if (focusParent) {
    card.append(el('p', 'card-context', `${palsById.get(focusParent)?.ja ?? '選択したパル'}を親に使う配合（相手 → 子）`));
    const first = record.parent1Id === focusParent;
    equation.append(palTile(first ? record.parent2Id : record.parent1Id, {
      gender: first ? record.parent2Gender : record.parent1Gender,
    }));
  } else {
    equation.append(palTile(record.parent1Id, { gender: record.parent1Gender }), el('span', 'equation-symbol', '＋'),
      palTile(record.parent2Id, { gender: record.parent2Gender }));
  }
  equation.append(el('span', 'equation-symbol arrow', '→'), palTile(record.childId));
  const metadata = el('div', 'card-meta');
  metadata.append(el('span', 'confirm-badge', `✓ 確認 ${record.confirmCount} 回`),
    el('span', '', record.registrant || '名前未登録'), el('time', 'updated-time', `更新 ${formatTime(record.updatedAt, true)}`));
  if (record.deleted) metadata.append(el('span', 'warning-chip', '削除済み'));
  card.append(equation, metadata);
  if (record.memo) card.append(el('p', 'card-memo', record.memo));
  if (preview) return card;
  const menu = el('details', 'card-menu');
  menu.append(el('summary', '', '操作 ⋯'));
  const actions = el('div', 'card-actions');
  const confirm = button('私も確認した +1', async () => {
    await runButton(confirm, () => context.confirm(record), (error) => toast(error.message));
  }, 'button secondary');
  actions.append(confirm, button('編集', () => context.register(record), 'button secondary'),
    button('削除', async () => {
      await runButton(remove, () => context.remove(record), (error) => toast(error.message));
    }, 'button quiet danger-text'));
  const remove = actions.lastElementChild;
  menu.append(actions);
  card.append(menu);
  return card;
}
