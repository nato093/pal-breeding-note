import { el, button, empty } from '../ui/dom.js';
import { palPicker } from '../ui/pal-picker.js';
import { findByChild } from '../core/index.js';
import { viewHeading, validId, navigateSelection, renderCards, watchView, dataPending } from './shared.js';

export function reverseView(context, route) {
  const element = el('section', 'view');
  element.append(viewHeading('この子の親を探す', '生まれるパルから、登録済みの組み合わせを逆引き。'));
  const child = validId(route, 'c', context);
  const picker = palPicker({ label: '生まれる子', value: child, storage: context.store.storage,
    onChange: (id) => navigateSelection(context, route, 'c', id) });
  const panel = el('div', 'selection-panel');
  panel.append(picker.element);
  const results = el('div', 'card-stack');
  element.append(panel, results);
  return watchView(context.store, element, (state) => {
    if (!child) { results.replaceChildren(empty('探したい子を選んでください。')); return; }
    if (dataPending(results, state)) return;
    const records = findByChild(state.index, child);
    if (!records.length) {
      results.replaceChildren(empty('この子の配合はまだ登録されていません', button('この子の配合を登録', () => {
        context.register({ childId: child });
      }, 'button primary')));
      return;
    }
    renderCards(results, records, context);
  }, [picker]);
}
