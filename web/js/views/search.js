import { el, button, empty } from '../ui/dom.js';
import { palPicker } from '../ui/pal-picker.js';
import { breedingCard } from '../ui/breeding-card.js';
import { findByPair, findByParent } from '../core/index.js';
import { viewHeading, validId, navigateSelection, watchView, dataPending } from './shared.js';

export function searchView(context, route) {
  const element = el('section', 'view');
  element.append(viewHeading('配合を見つけよう'));
  const p1 = validId(route, 'p1', context);
  const p2 = validId(route, 'p2', context);
  const selections = el('div', 'selection-panel search-selection');
  const pickers = [['p1', '親1', p1], ['p2', '親2', p2]].map(([key, label, value]) => palPicker({
    label, value, onChange: (id) => navigateSelection(context, route, key, id),
  }));
  selections.append(...pickers.map((picker) => picker.element));
  const note = el('p', 'result-note');
  const results = el('div', 'card-stack');
  element.append(selections, note, results);
  return watchView(context.store, element, (state) => {
    note.textContent = '';
    if (!p1 && !p2) { results.replaceChildren(empty('親を選んで、仲間と記録した配合を探しましょう。親1だけでも探せます。')); return; }
    if (dataPending(results, state)) return;
    const records = p1 && p2 ? findByPair(state.index, p1, p2) : findByParent(state.index, p1 || p2);
    if (!records.length) {
      results.replaceChildren(empty(p1 && p2 ? 'この組み合わせはまだ登録されていません' : 'この親を使う配合はまだ登録されていません', button('この組み合わせを登録', () => {
        context.register({ parent1Id: p1, parent2Id: p2 });
      }, 'button primary')));
      return;
    }
    note.textContent = p1 && p2 && records.length > 1 ? '同じ組み合わせで結果が複数登録されています' : `${records.length} 件の登録済み配合`;
    results.replaceChildren();
    for (const record of records) {
      const leftParent = p1 || (record.parent1Id === p2 ? record.parent2Id : record.parent1Id);
      results.append(breedingCard(record, context, { leftParent }));
    }
  }, pickers);
}
