import { el, button, empty } from '../ui/dom.js';
import { palPicker } from '../ui/pal-picker.js';
import { findByChild } from '../core/index.js';
import { viewHeading, validId, navigateSelection, renderCards, watchView, dataPending, syncPicker } from './shared.js';

export function reverseView(context, route) {
  const element = el('section', 'view');
  element.append(viewHeading('この子の親を探す'));
  let current = route;
  let child = '';
  // URL から読む条件（作るときと、同じ画面のまま URL が変わったとき）
  function readRoute(next) {
    current = next;
    child = validId(next, 'c', context);
  }
  readRoute(route);
  const picker = palPicker({ label: '生まれる子', value: child,
    onChange: (id) => navigateSelection(context, current, 'c', id) });
  const panel = el('div', 'selection-panel');
  panel.append(picker.element);
  const results = el('div', 'card-stack');
  element.append(panel, results);
  const view = watchView(context.store, element, (state) => {
    if (!child) { renderCards(results, [], context, { empty: () => empty('探したい子を選んでください。') }); return; }
    if (dataPending(results, state)) return;
    renderCards(results, findByChild(state.index, child).map((record) => ({ record })), context, {
      empty: () => empty('この子の配合はまだ登録されていません', button('この子の配合を登録', () => {
        context.register({ childId: child });
      }, 'button primary')),
    });
  }, [picker]);
  return {
    ...view,
    applyRoute(next) {
      readRoute(next);
      syncPicker(picker, child);
      view.update(context.store.state);
    },
  };
}
