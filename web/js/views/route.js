import { el, button, empty, link } from '../ui/dom.js';
import { palPicker } from '../ui/pal-picker.js';
import { palTile, palsById } from '../ui/pal-icon.js';
import { routeView } from '../ui/route-view.js';
import { passiveSelector, passiveList } from '../ui/passive-picker.js';
import { findRoutes, shortestRoute } from '../core/route.js';
import { ownedBySpecies, hasPassives, ownedRouteStarts, partnerOwnership, passiveCounts } from '../core/owned.js';
import { buildHash } from '../router.js';
import { viewHeading, validId, navigateSelection, watchView, dataPending } from './shared.js';

function holderSummary(carriers) {
  const where = (pal) => (pal.egg ? `${pal.holder}（タマゴ）` : pal.holder === pal.placeLabel ? pal.holder : `${pal.holder}・${pal.placeLabel}`);
  const names = [...new Set(carriers.map(where))];
  return names.length > 2 ? `${names.slice(0, 2).join('、')} ほか` : names.join('、');
}

// 所持しているパルの個体（パッシブと場所）を短く並べる
function carrierList(carriers) {
  const list = el('ul', 'route-carriers');
  // パッシブの多い個体、レベルの高い個体から
  const sorted = [...carriers].sort((a, b) => b.passives.length - a.passives.length || b.level - a.level);
  for (const pal of sorted) {
    const item = el('li', 'route-carrier');
    item.append(el('span', 'route-carrier-where', `${pal.egg ? 'タマゴ · ' : `Lv ${pal.level} · `}${pal.holder} · ${pal.placeLabel}`),
      pal.passives.length ? passiveList(pal.passives) : el('span', 'muted', 'パッシブなし'));
    list.append(item);
  }
  return list;
}

export function inheritanceView(context, route) {
  const element = el('section', 'view');
  element.append(viewHeading('スキルをつなぐ'));
  const from = validId(route, 'from', context);
  const to = validId(route, 'to', context);
  const passives = (route.params.get('p') ?? '').split(',').filter(Boolean).slice(0, 4);
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
  const owned = context.owned;
  const passiveSlot = el('div', 'route-passives');
  const ownedSection = el('section', 'route-owned');
  const results = el('div');
  element.append(panel);
  if (owned) element.append(passiveSlot);
  element.append(el('p', 'route-explanation', 'この経路はスキルを運ぶ個体の流れです。相手親は別途用意します'));
  if (owned) element.append(ownedSection);
  element.append(results);

  const setPassives = (ids) => {
    const params = new URLSearchParams(route.params);
    if (ids.length) params.set('p', ids.join(','));
    else params.delete('p');
    context.navigate(buildHash('route', params));
  };

  function renderOwned(state, ownedState) {
    const pals = ownedState?.owned?.pals;
    passiveSlot.replaceChildren(passiveSelector({
      label: '運びたいパッシブ（所持パルから探す）', selected: passives, counts: passiveCounts(pals ?? []), onChange: setPassives,
    }));
    ownedSection.replaceChildren();
    if (!pals) {
      if (passives.length) ownedSection.append(el('p', 'muted', '所持パルのデータがありません。設定タブでセーブ連携を設定するか、ホストが所持パルを共有すると、パッシブを持つ個体から経路を探せます。'));
      return;
    }
    const bySpecies = ownedBySpecies(pals);
    if (from && passives.length) {
      const carriers = (bySpecies.get(from) ?? []).filter((pal) => hasPassives(pal, passives));
      const box = el('div', 'route-owned-box');
      box.append(el('h3', '', `開始の${palsById.get(from)?.ja ?? from}でパッシブを持つ所持個体`),
        carriers.length ? carrierList(carriers) : el('p', 'muted', '該当する個体を所持していません。'));
      ownedSection.append(box);
    }
    if (!to || !state.env || (from && !passives.length)) return;
    if (!from && !passives.length) {
      ownedSection.append(el('p', 'muted', '運びたいパッシブを選ぶと、そのパッシブを持つ所持パルから目標までの経路を探します。'));
      return;
    }
    if (from) return;
    const starts = ownedRouteStarts({ graph: state.graph, pals, to, passives, shortestRoute });
    const box = el('div', 'route-owned-box');
    box.append(el('h3', '', 'パッシブを持つ所持パルから始める'));
    if (!starts.length) {
      const total = pals.filter((pal) => pal.palId && hasPassives(pal, passives)).length;
      box.append(el('p', 'muted', total
        ? `該当する所持パルは ${total} 体いますが、登録済みの配合では目標にたどり着けません。`
        : '選んだパッシブをすべて持つ所持パルはいません。'));
      ownedSection.append(box);
      return;
    }
    const list = el('div', 'route-starts');
    for (const start of starts) {
      const row = el('div', 'route-start');
      const info = el('div', 'route-start-info');
      info.append(el('strong', '', start.length ? `最短 ${start.length} 回の配合` : 'すでに目標のパルを所持'),
        el('small', 'muted', `${start.carriers.length} 体 · ${holderSummary(start.carriers)}`));
      const params = new URLSearchParams(route.params);
      params.set('from', start.palId);
      const action = start.length ? link('この経路を見る', buildHash('route', params), 'button secondary') : el('span');
      row.append(palTile(start.palId), info, action);
      list.append(row);
    }
    box.append(list);
    ownedSection.append(box);
  }

  function annotateFor(ownedState) {
    const pals = ownedState?.owned?.pals;
    if (!pals) return undefined;
    const bySpecies = ownedBySpecies(pals);
    return (step, option) => {
      const { total, matching } = partnerOwnership(bySpecies, option.partner, passives);
      const name = palsById.get(option.partner)?.ja ?? option.partner;
      const text = total
        ? `相手親の${name}: 所持 ${total} 体${passives.length ? `（うちパッシブ一致 ${matching} 体）` : ''}`
        : `相手親の${name}: 未所持`;
      return el('span', `route-owned-note${total ? '' : ' unowned'}`, text);
    };
  }

  function update(state) {
    const ownedState = owned?.state;
    if (owned) renderOwned(state, ownedState);
    if (!to || (!from && !(owned && passives.length))) { results.replaceChildren(empty('開始と目標のパルを選んでください。')); return; }
    if (!from) { results.replaceChildren(); return; }
    if (from === to) { results.replaceChildren(empty('配合は不要です')); return; }
    if (dataPending(results, state)) return;
    const { routes } = findRoutes(state.graph, state.index, from, to, { k: 5, slack: 3 });
    if (!routes.length) {
      results.replaceChildren(empty('登録済みの配合ではたどり着けません', link('目標の逆引きを見る', buildHash('reverse', { c: to }), 'button secondary')));
      return;
    }
    results.replaceChildren(routeView(routes, { annotate: annotateFor(ownedState) }));
  }
  const view = watchView(context.store, element, update, pickers);
  if (!owned) return view;
  let lastData = owned.state.data;
  const unsubscribe = owned.subscribe((ownedState) => {
    if (ownedState.data === lastData) return;
    lastData = ownedState.data;
    update(context.store.state);
  });
  owned.load().then(() => owned.autoRefresh()).catch(() => {});
  return { element, destroy() { unsubscribe(); view.destroy(); } };
}
