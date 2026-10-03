import { el, button, empty } from '../ui/dom.js';
import { palPicker } from '../ui/pal-picker.js';
import { findByPair, findByParent } from '../core/index.js';
import { buildHash } from '../router.js';
import { viewHeading, validId, navigateSelection, renderCards, watchView, dataPending } from './shared.js';

export function searchView(context, route) {
  const element = el('section', 'view');
  element.append(viewHeading('配合を見つけよう', '記録した組み合わせから、次の一体へ。'));
  const p1 = validId(route, 'p1', context);
  const p2 = validId(route, 'p2', context);
  const selections = el('div', 'selection-panel pair-selection');
  const pickers = [['p1', '親1', p1], ['p2', '親2', p2]].map(([key, label, value]) => palPicker({
    label, value, storage: context.store.storage, onChange: (id) => navigateSelection(context, route, key, id),
  }));
  const swap = button('⇄', () => context.navigate(buildHash('search', { p1: p2, p2: p1 })), 'icon-button swap-button');
  swap.setAttribute('aria-label', '親1と親2を入れ替える');
  selections.append(pickers[0].element, swap, pickers[1].element);
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
    note.textContent = p1 && p2 ? records.length > 1 ? '同じ組み合わせで結果が複数登録されています' : `${records.length} 件の登録済み配合`
      : `${p1 ? '親1' : '親2'}を使う登録済み配合（相手 → 子）`;
    renderCards(results, records, context, p1 && p2 ? {} : { focusParent: p1 || p2 });
  }, pickers);
}
