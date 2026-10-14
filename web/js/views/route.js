import { el, button, empty, link } from '../ui/dom.js';
import { palPicker } from '../ui/pal-picker.js';
import { palTile, palsById } from '../ui/pal-icon.js';
import { routeView } from '../ui/route-view.js';
import { passiveSelector, passiveList } from '../ui/passive-picker.js';
import { findRoutes, shortestRoute } from '../core/route.js';
import { ownedBySpecies, hasPassives, ownedRouteStarts, partnerOwnership, passiveCounts, PLACE_LABELS } from '../core/owned.js';
import { buildHash } from '../router.js';
import { viewHeading, validId, navigateSelection, changeRoute, watchView, dataPending, syncPicker, ownedSpeciesNotes, routeDistanceNotes, passivePresets } from './shared.js';
import { captureFocus, restoreFocus } from '../ui/focus.js';
import { internalName } from '../core/boundary.js';

function holderSummary(carriers) {
  // 要約なので、パルボックスのページと位置までは出さない
  const place = (pal) => (pal.place === 'palbox' ? PLACE_LABELS.palbox : pal.placeLabel);
  const where = (pal) => (pal.egg ? `${pal.holder}（タマゴ）` : pal.holder === place(pal) ? pal.holder : `${pal.holder}・${place(pal)}`);
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

// key は作り直した後に同じチップを探すための目印（start:<palId>・start:all。ui/focus.js の data-focus-key）
function startChip(content, pressed, onClick, key) {
  const chip = button('', onClick, 'start-chip');
  chip.setAttribute('aria-pressed', String(pressed));
  chip.setAttribute('data-focus-key', key);
  chip.append(...content);
  return chip;
}

export function inheritanceView(context, route) {
  const element = el('section', 'view');
  const heading = viewHeading('スキルをつなぐ');
  let current = route;
  let from = '';
  let to = '';
  let passives = [];
  // URL から読む条件（作るときと、同じ画面のまま URL が変わったとき）
  function readRoute(next) {
    current = next;
    from = validId(next, 'from', context);
    to = validId(next, 'to', context);
    // 重複と内部名の形でない値は除く（マスターにまだ無い内部名は、所持パルに付いていれば候補に出て選べるので残す）
    passives = [...new Set((next.params.get('p') ?? '').split(',').filter((id) => internalName(id)))].slice(0, 4);
  }
  readRoute(route);
  const selectPal = (key) => (id) => navigateSelection(context, current, key, id);
  const owned = context.owned;
  // 目標の候補は、所持している種族を先に「♂3 ♀2」つきで。開始の候補は、登録済みの配合で目標まで届くパルを回数の少ない順に先へ
  const toPicker = palPicker({ label: '目標', value: to, describe: () => ownedSpeciesNotes(owned?.state?.owned), onChange: selectPal('to') });
  const describeStart = () => (context.store.state.env ? routeDistanceNotes(context.store.state.graph, to) : {});
  let fromPicker = null;
  const panel = el('div');
  const passiveSlot = el('div', 'route-passives');
  const startChips = el('div', 'start-chips');
  startChips.setAttribute('role', 'group');
  startChips.setAttribute('aria-label', '開始');
  const startFilter = el('div', 'start-filter');
  startFilter.append(el('span', 'field-label', '開始'), startChips);
  const explanation = el('p', 'route-explanation', 'この経路はスキルを運ぶ個体の流れです。相手親は別途用意します');
  const ownedSection = el('section', 'route-owned');
  const results = el('div');

  const setPassives = (ids) => {
    const params = new URLSearchParams(current.params);
    if (ids.length) params.set('p', ids.join(','));
    else params.delete('p');
    changeRoute(context, buildHash('route', params));
  };
  // パッシブの選択欄は 1 回だけ作り、条件・データが変わったら update で合わせる（開いた候補を閉じない）
  const passive = passiveSelector({
    label: '運びたいパッシブ（所持パルから探す）', selected: passives, countLabel: '所持パルが持っているもの（タマゴを含む）',
    negatives: 'last', presets: passivePresets(context.ideals), onChange: setPassives,
  });
  passiveSlot.append(passive.element);

  // 所持パルがあるときは目標とパッシブだけで探し、開始は候補から絞り込む形にする（選ばなくてよい）。
  // ないときは開始と目標を並べて選ぶ。所持パルは後から読み込まれるため、update のたびに形を確かめる。
  let filterLayout = null;
  // 形を変えると選択欄を付け直すので、同じ役目の部品（目標・開始の選択欄・⇄）へフォーカスを戻す
  function arrange(filter) {
    const token = captureFocus(element);
    layout(filter);
    restoreFocus(element, token);
  }
  function layout(filter) {
    filterLayout = filter;
    fromPicker?.destroy();
    if (filter) {
      // 候補の行の右端に置くため、選択欄が画面の外へはみ出さないよう本文の外に出す
      fromPicker = palPicker({ label: '開始', value: from, placeholder: '他のパル…', describe: describeStart, onChange: selectPal('from'), popupHost: document.body });
      panel.className = 'selection-panel route-query';
      panel.replaceChildren(toPicker.element, passiveSlot);
      element.replaceChildren(heading, panel, startFilter, explanation, ownedSection, results);
      return;
    }
    fromPicker = palPicker({ label: '開始', value: from, describe: describeStart, onChange: selectPal('from') });
    const swap = button('⇄', () => {
      const params = new URLSearchParams(current.params);
      params.set('from', to);
      params.set('to', from);
      changeRoute(context, buildHash('route', params));
    }, 'icon-button swap-button');
    swap.setAttribute('aria-label', '開始と目標を入れ替える');
    swap.setAttribute('data-focus-key', 'route:swap');
    panel.className = 'selection-panel pair-selection';
    panel.replaceChildren(fromPicker.element, swap, toPicker.element);
    element.replaceChildren(heading, panel);
    if (owned) element.append(passiveSlot);
    element.append(explanation);
    if (owned) element.append(ownedSection);
    element.append(results);
  }

  // 「すべて」（開始を選ばない）と、パッシブを持つ所持パルの候補を並べる。候補にないパルは「他のパル…」から選ぶ
  function renderStartFilter(starts) {
    const all = startChip([el('span', '', 'すべて')], !from, () => selectPal('from')(''), 'start:all');
    all.classList.add('start-chip-all');
    const chips = [all];
    for (const start of starts) {
      const pressed = from === start.palId;
      const chip = startChip([palTile(start.palId, { clickable: false }), el('small', 'start-chip-count', start.length ? `${start.length}回` : '所持')],
        pressed, () => selectPal('from')(pressed ? '' : start.palId), `start:${start.palId}`);
      chip.title = `${start.length ? `最短 ${start.length} 回の配合` : 'すでに目標のパルを所持'} · ${start.carriers.length} 体`;
      chips.push(chip);
    }
    syncPicker(fromPicker, from && !starts.some((start) => start.palId === from) ? from : '');
    // 押したチップは作り直すと消えるので、同じパルのチップへフォーカスを移す（「他のパル…」の欄は付け直した同じ要素へ）
    const token = captureFocus(startChips);
    startChips.replaceChildren(...chips, fromPicker.element);
    restoreFocus(startChips, token);
  }

  // 所持数はタマゴも含めた所持パル全体で数える（運ぶ個体はタマゴから孵してもよいので）
  function renderPassives(pals) {
    passive.update({ selected: passives, counts: passiveCounts(pals ?? []) });
  }

  function renderOwned(state, pals, starts) {
    renderPassives(pals);
    ownedSection.replaceChildren();
    if (!pals) {
      if (passives.length) ownedSection.append(el('p', 'muted', '所持パルのデータがありません。設定タブの「セーブ連携」でワールドを登録するか、ホストが所持パルを共有すると、パッシブを持つ個体から経路を探せます。'));
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
      const params = new URLSearchParams(current.params);
      params.set('from', start.palId);
      const action = start.length ? link('この経路を見る', buildHash('route', params), 'button secondary') : el('span');
      row.append(palTile(start.palId), info, action);
      list.append(row);
    }
    box.append(list);
    ownedSection.append(box);
  }

  function annotateFor(pals) {
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
    const pals = owned?.state?.owned?.pals ?? null;
    const filter = Boolean(pals);
    if (filter !== filterLayout) arrange(filter);
    // 候補を開いたまま記録・所持パルが変わったら、注記だけ描き直す（閉じない）
    toPicker.update();
    fromPicker?.update();
    const starts = pals && to && passives.length && state.env
      ? ownedRouteStarts({ graph: state.graph, pals, to, passives, shortestRoute }) : [];
    if (filter) renderStartFilter(starts);
    if (owned) renderOwned(state, pals, starts);
    if (!to || (!from && !(owned && passives.length))) {
      // 開始を選ばない形で目標を選んだ後は、所持パルの欄が次の手順を案内する
      if (filter && to) results.replaceChildren();
      else results.replaceChildren(empty(filter ? '目標のパルを選んでください。' : '開始と目標のパルを選んでください。'));
      return;
    }
    if (!from) { results.replaceChildren(); return; }
    if (from === to) { results.replaceChildren(empty('配合は不要です')); return; }
    if (dataPending(results, state)) return;
    const { routes } = findRoutes(state.graph, state.index, from, to, { k: 5, slack: 3 });
    if (!routes.length) {
      results.replaceChildren(empty('登録済みの配合ではたどり着けません', link('目標の逆引きを見る', buildHash('reverse', { c: to }), 'button secondary')));
      return;
    }
    results.replaceChildren(routeView(routes, { annotate: annotateFor(pals) }));
  }
  // 登録した理想個体が変わったら（別のタブを含む）、登録した組み合わせを入れ直す
  const unsubscribeIdeals = context.ideals?.subscribe(() => passive.update({ presets: passivePresets(context.ideals) })) ?? (() => {});
  const pickers = { destroy() { toPicker.destroy(); fromPicker?.destroy(); passive.destroy(); unsubscribeIdeals(); } };
  const view = watchView(context.store, element, update, [pickers]);
  // 同じ画面のまま URL が変わったとき。選択欄は作り直さずに値だけ合わせる（開始と目標の形は arrange が決める）
  function applyRoute(next) {
    readRoute(next);
    syncPicker(toPicker, to);
    if (!filterLayout) syncPicker(fromPicker, from);
    update(context.store.state);
  }
  if (!owned) return { ...view, applyRoute };
  let lastData = owned.state.data;
  // どのワールドの・いつのデータか・読み込みの状態は、ヘッダーのセーブ連携の状態に出す（D29 で、所持パルの欄の先頭のデータ元の 1 行をなくした）
  const unsubscribe = owned.subscribe((ownedState) => {
    if (ownedState.data === lastData) return;
    lastData = ownedState.data;
    update(context.store.state);
  });
  owned.load().then(() => owned.autoRefresh()).catch(() => {});
  return { element, update, applyRoute, destroy() { unsubscribe(); view.destroy(); } };
}
