import { el, button, empty, link } from '../ui/dom.js';
import { palPicker } from '../ui/pal-picker.js';
import { routeView } from '../ui/route-view.js';
import { findRoutes } from '../core/route.js';
import { buildHash } from '../router.js';
import { viewHeading, validId, navigateSelection, watchView, dataPending } from './shared.js';

export function inheritanceView(context, route) {
  const element = el('section', 'view');
  element.append(viewHeading('スキルをつなぐ'));
  const from = validId(route, 'from', context);
  const to = validId(route, 'to', context);
  const pickers = [['from', '開始', from], ['to', '目標', to]].map(([key, label, value]) => palPicker({
    label, value, onChange: (id) => navigateSelection(context, route, key, id),
  }));
  const panel = el('div', 'selection-panel pair-selection');
  const swap = button('⇄', () => {
    const params = new URLSearchParams(route.params);
    params.set('from', to);
    params.set('to', from);
    context.navigate(buildHash('route', params));
  }, 'icon-button swap-button');
  swap.setAttribute('aria-label', '開始と目標を入れ替える');
  panel.append(pickers[0].element, swap, pickers[1].element);
  const results = el('div');
  element.append(panel, el('p', 'route-explanation', 'この経路はスキルを運ぶ個体の流れです。相手親は別途用意します'), results);

  function update(state) {
    if (!from || !to) { results.replaceChildren(empty('開始と目標のパルを選んでください。')); return; }
    if (from === to) { results.replaceChildren(empty('配合は不要です')); return; }
    if (dataPending(results, state)) return;
    const { routes } = findRoutes(state.graph, state.index, from, to, { k: 5, slack: 3 });
    if (!routes.length) {
      results.replaceChildren(empty('登録済みの配合ではたどり着けません', link('目標の逆引きを見る', buildHash('reverse', { c: to }), 'button secondary')));
      return;
    }
    results.replaceChildren(routeView(routes));
  }
  return watchView(context.store, element, update, pickers);
}
