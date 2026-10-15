import { el, button, empty, link, setupHint, syncList, clearList } from '../ui/dom.js';
import { palPicker } from '../ui/pal-picker.js';
import { palTile, palsById, genderMark } from '../ui/pal-icon.js';
import { routeView, ROUTE_NOTE } from '../ui/route-view.js';
import { passiveSelector } from '../ui/passive-picker.js';
import { findRoutes, shortestRoute } from '../core/route.js';
import { ownedBySpecies, hasPassives, ownedRouteStarts, partnerOwnership, passiveCounts, ownedCounts, canBeParent, PLACE_LABELS } from '../core/owned.js';
import { buildHash, settingsHash } from '../router.js';
import { viewHeading, validId, navigateSelection, changeRoute, watchView, dataPending, syncPicker, ownedSpeciesNotes, routeDistanceNotes, passivePresets } from './shared.js';
import { tabLabel } from './tabs.js';
import { ownedRowItem } from './owned.js';
import { captureFocus, restoreFocus } from '../ui/focus.js';
import { internalName } from '../core/boundary.js';

function holderSummary(carriers) {
  // 要約なので、パルボックスのページと位置までは出さない（開始の候補は親にできる個体だけなので、タマゴの分かれ道はない。R-15）
  const place = (pal) => (pal.place === 'palbox' ? PLACE_LABELS.palbox : pal.placeLabel);
  const where = (pal) => (pal.holder === place(pal) ? pal.holder : `${pal.holder}・${place(pal)}`);
  const names = [...new Set(carriers.map(where))];
  return names.length > 2 ? `${names.slice(0, 2).join('、')} ほか` : names.join('、');
}

// 開始のチップの 2 段目（「最短 2 回 · 3 体 · Alice・パルボックス」。目標そのものを持っていれば「所持 · 1 体 · …」）
const startSummary = (start) => `${start.length ? `最短 ${start.length} 回` : '所持'} · ${start.carriers.length} 体 · ${holderSummary(start.carriers)}`;

// 開始の所持個体の一覧で、上に出す数（それより多ければ残りを「ほか N 体」に畳む）
const CARRIERS_SHOWN = 5;
// 「ほか N 体」を開いたときに作る行の上限（残りは「所持パルで開く」で見る）
const CARRIERS_MORE_MAX = 100;

// 記録の相手親の性別（相手親と開始が同じ種族の記録は、どちらの性別か分からないので空）
function recordedPartnerGender(record, partner) {
  if (record.parent1Id === record.parent2Id) return '';
  if (record.parent1Id === partner) return record.parent1Gender ?? '';
  if (record.parent2Id === partner) return record.parent2Gender ?? '';
  return '';
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
  const element = el('section', 'view route-view');
  const heading = viewHeading(tabLabel('route'));
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
  // 開始の選択欄は開始のチップの行の右端に置く（候補のチップがあるときは「他のパル…」の点線の見た目）。
  // 選択欄が画面の外へはみ出さないよう、候補は本文の外に出す
  const fromPicker = palPicker({ label: '開始', value: from, describe: describeStart, onChange: selectPal('from'), popupHost: document.body });
  // 形は 1 つ（R-05）: 「[目標][運びたいパッシブ]」の行 → 所持パルがないときの 1 行 → 「開始: [すべて][候補…][開始の選択欄]」の行 →
  // 経路 → 開始の所持個体。開始を切り替えても経路の先頭の位置が変わらないよう、所持個体は経路の下に置く（R-07）
  const panel = el('div', 'selection-panel route-query');
  const passiveSlot = el('div', 'route-passives');
  const hintSlot = el('div', 'route-hint');
  hintSlot.hidden = true;
  const startChips = el('div', 'start-chips');
  startChips.setAttribute('role', 'group');
  startChips.setAttribute('aria-label', '開始');
  // 候補がないときの 1 行（パッシブを持つ所持パルはいるが目標に届かない、など）
  const startNote = el('p', 'start-note muted');
  startNote.hidden = true;
  const startFilter = el('div', 'start-filter');
  startFilter.append(el('span', 'field-label', '開始'), startChips, startNote);
  const results = el('div', 'route-result-slot');
  // 開始の所持個体（所持パルの行の部品 ownedRowItem。6 体以上は上の 5 体と「ほか N 体」）。作っておき、出さないときは隠す
  const ownedSection = el('section', 'route-owned');
  ownedSection.hidden = true;
  const ownedBox = el('div', 'route-owned-box');
  const ownedHead = el('div', 'route-owned-head');
  const ownedTitle = el('h2', '');
  const ownedLink = link('所持パルで開く', buildHash('owned'), 'route-owned-open');
  ownedHead.append(ownedTitle, ownedLink);
  const ownedRows = el('div', 'route-owned-rows');
  const ownedMore = el('details', 'route-owned-more');
  const ownedMoreSummary = el('summary', '');
  const ownedMoreRows = el('div', 'route-owned-rows');
  const ownedMoreNote = el('p', 'muted route-owned-more-note');
  ownedMoreNote.hidden = true;
  ownedMore.append(ownedMoreSummary, ownedMoreRows, ownedMoreNote);
  const ownedEmpty = el('p', 'muted');
  ownedBox.append(ownedHead, ownedRows, ownedMore, ownedEmpty);
  ownedSection.append(ownedBox);
  panel.append(toPicker.element, passiveSlot);
  element.append(heading, panel, hintSlot, startFilter, results, ownedSection);

  const setPassives = (ids) => {
    const params = new URLSearchParams(current.params);
    if (ids.length) params.set('p', ids.join(','));
    else params.delete('p');
    changeRoute(context, buildHash('route', params));
  };
  // パッシブの選択欄は 1 回だけ作り、条件・データが変わったら update で合わせる（開いた候補を閉じない）。
  // 未選択の文が次の手順の案内を兼ねる（前の 41 字の案内は消した。R-27）
  const passive = passiveSelector({
    label: '運びたいパッシブ', placeholder: '運びたいパッシブを選ぶ', selected: passives,
    countLabel: '所持パルが持っているもの（タマゴ・グローバルパルボックスを除く）',
    negatives: 'last', presets: passivePresets(context.ideals), onChange: setPassives,
  });
  passiveSlot.append(passive.element);

  // 所持パルのデータがないか（読み込みを終えて、データがない。読み込みの前は「ある」として形を変えない）
  const ownedMissing = () => !owned || (owned.state.ready && !owned.state.owned);

  // 所持パルがないとき: パッシブの欄を出さず、選択欄の下に 1 行と「設定を開く」（R-28。行き先はセーブ連携の状態）
  let hintHref = null;
  function renderHint(missing) {
    passiveSlot.hidden = missing;
    const href = missing && owned ? settingsHash(owned.state.linkedWorldId ?? '', 'status') : '';
    if (href === hintHref) return;
    hintHref = href;
    hintSlot.hidden = !href;
    hintSlot.replaceChildren(...(href ? [setupHint({ text: '所持パルを読み込むと、パッシブを持つ個体から探せます。', action: { label: '設定を開く', href } })] : []));
  }

  // 開始のチップ: 候補があれば「すべて」（開始を選ばない）と候補（1 段目はパル、2 段目は「最短 N 回 · n 体 · 持ち主」）。
  // 候補にないパルは右端の選択欄から選ぶ。候補がないときは選択欄だけ（ふつうの見た目）
  function renderStartFilter(starts, note) {
    const chips = [];
    if (starts.length) {
      const all = startChip([el('span', '', 'すべて')], !from, () => selectPal('from')(''), 'start:all');
      all.classList.add('start-chip-all');
      chips.push(all);
      for (const start of starts) {
        const pressed = from === start.palId;
        const summary = startSummary(start);
        const chip = startChip([palTile(start.palId, { clickable: false }), el('small', 'start-chip-count', summary)],
          pressed, () => selectPal('from')(pressed ? '' : start.palId), `start:${start.palId}`);
        // 2 段目は長いと省略する（持ち主が多いとき。全文は title）
        chip.title = `${palsById.get(start.palId)?.ja ?? start.palId} · ${summary}`;
        chips.push(chip);
      }
    }
    startChips.classList.toggle('has-starts', starts.length > 0);
    fromPicker.update({ placeholder: starts.length ? '他のパル…' : 'パルを選択' });
    syncPicker(fromPicker, from && !starts.some((start) => start.palId === from) ? from : '');
    // 押したチップは作り直すと消えるので、同じパルのチップへフォーカスを移す（選択欄は付け直した同じ要素へ）
    const token = captureFocus(startChips);
    startChips.replaceChildren(...chips, fromPicker.element);
    restoreFocus(startChips, token);
    startNote.hidden = !note;
    startNote.textContent = note;
  }

  // 候補がないときの文。開始の候補は親にできる個体だけ（タマゴ・グローバルパルボックスの個体は外した。R-15）。外した個体があれば添える
  function startNoteFor(pals) {
    const matching = pals.filter((pal) => pal.palId && hasPassives(pal, passives));
    const total = matching.filter(canBeParent).length;
    const skipped = matching.length - total;
    return `${total
      ? `該当する所持パルは ${total} 体いますが、登録済みの配合では目標にたどり着けません。`
      : '選んだパッシブをすべて持つ所持パルはいません。'}${skipped ? 'タマゴ・グローバルパルボックスの個体は含めていません。' : ''}`;
  }

  // 所持数は開始の候補と同じ数え方（親にできる個体だけ。タマゴ・グローバルパルボックスの個体は数えない）
  function renderPassives(pals) {
    passive.update({ selected: passives, counts: passiveCounts((pals ?? []).filter(canBeParent)) });
  }

  // 開始の所持個体の行（所持パルの一覧と同じ部品。運びたいパッシブを強調する）
  const rowOptions = {
    key: (pal) => pal.id,
    create: (pal) => {
      const item = ownedRowItem(pal, { highlight: { wanted: passives } });
      return { element: item.element, update: (next) => item.update(next, { highlight: { wanted: passives } }), destroy: () => item.destroy() };
    },
  };
  // 「ほか N 体」の行は開いている間だけ作る（閉じたら外す。所持パルが多い種族で、見ない行を作らない）
  let restCarriers = [];
  function renderMore() {
    if (!ownedMore.open) {
      clearList(ownedMoreRows);
      ownedMoreNote.hidden = true;
      return;
    }
    syncList(ownedMoreRows, restCarriers.slice(0, CARRIERS_MORE_MAX), rowOptions);
    const over = restCarriers.length - CARRIERS_MORE_MAX;
    ownedMoreNote.hidden = over <= 0;
    if (over > 0) ownedMoreNote.textContent = `ほか ${over} 体は「所持パルで開く」で見られます。`;
  }
  ownedMore.addEventListener('toggle', renderMore);
  function clearOwned() {
    restCarriers = [];
    clearList(ownedRows);
    renderMore();
  }
  function renderOwned(stats) {
    const show = Boolean(stats && from && passives.length);
    ownedSection.hidden = !show;
    if (!show) { clearOwned(); return; }
    ownedTitle.textContent = `開始の${palsById.get(from)?.ja ?? from}でパッシブを持つ所持個体`;
    ownedLink.href = buildHash('owned', { pal: from, p: passives.join(',') });
    const matching = (stats.bySpecies.get(from) ?? []).filter((pal) => hasPassives(pal, passives));
    // 運び手は開始の候補と同じく親にできる個体だけ。パッシブの多い個体、レベルの高い個体から
    const carriers = matching.filter(canBeParent).sort((a, b) => b.passives.length - a.passives.length || b.level - a.level);
    restCarriers = carriers.slice(CARRIERS_SHOWN);
    syncList(ownedRows, carriers.slice(0, CARRIERS_SHOWN), rowOptions);
    renderMore();
    ownedMore.hidden = !restCarriers.length;
    ownedMoreSummary.textContent = `ほか ${restCarriers.length} 体`;
    ownedEmpty.hidden = carriers.length > 0;
    ownedEmpty.textContent = matching.length > carriers.length
      ? '親にできる個体を所持していません（タマゴ・グローバルパルボックスの個体は含めていません）。' : '該当する個体を所持していません。';
  }

  // 所持パルのデータごとに 1 回だけ数える（種族ごとの個体・性別ごとの親にできる数。owned-overlay）
  let ownedFor = null;
  let ownedStats = null;
  function statsOf(pals) {
    if (ownedFor !== pals) {
      ownedFor = pals;
      ownedStats = pals ? { bySpecies: ownedBySpecies(pals), counts: ownedCounts(pals) } : null;
    }
    return ownedStats;
  }
  // 相手親を組める（親にできる ♂ か ♀ を 1 体以上持っている）か
  const partnerOwned = (counts, palId) => {
    const entry = counts.get(palId);
    return Boolean(entry && (entry.male || entry.female));
  };

  // 相手親の注記: 「相手親の X: ♂2 ♀1（うちパッシブ一致 M 体）」と「所持パルで見る」。親にできる個体（タマゴ・グローバルパルボックスを除く）で数える。
  // 記録に相手親の性別があれば「（記録では ♀）」を添える（所持個体から組めるかと、記録の向きを分けて示す。R-25）
  function annotateFor(stats) {
    if (!stats) return undefined;
    return (step, option) => {
      const { matching } = partnerOwnership(stats.bySpecies, option.partner, passives);
      const entry = stats.counts.get(option.partner);
      const name = palsById.get(option.partner)?.ja ?? option.partner;
      const node = el('span', 'route-owned-note');
      // 文字は span に入れる（テストの偽の DOM は文字列の append を持たない）
      const text = (value) => el('span', '', value);
      const gender = recordedPartnerGender(option.record, option.partner);
      const recorded = gender ? [text('（記録では '), genderMark(gender, { inline: true }), text('）')] : [];
      if (!entry?.total) {
        node.classList.add('unowned');
        node.append(text(`相手親の${name}: 未所持`), ...recorded);
        return node;
      }
      if (!entry.male && !entry.female) {
        node.classList.add('unowned');
        node.append(text(`相手親の${name}: タマゴ等のみ（親にできる個体なし）`));
      } else {
        node.append(text(`相手親の${name}: `), genderMark('M', { inline: true }), text(`${entry.male} `), genderMark('F', { inline: true }), text(String(entry.female)));
        if (passives.length) node.append(text(`（うちパッシブ一致 ${matching} 体）`));
      }
      node.append(...recorded, link('所持パルで見る', buildHash('owned', { pal: option.partner }), 'route-owned-link'));
      return node;
    };
  }

  // 所持パルがあるとき: 「N 通り」の中を、相手親を組める配合 → 組めない配合の順に安定に並べ直し（同じ側の中は今の図鑑順。R-17）、
  // 同じ回数の経路の中を、相手親を持っていない段の少ない順に安定に並べ直す（R-21）。findRoutes の結果は書き換えず、写しを返す
  function arrangeRoutes(routes, stats) {
    if (!stats) return routes;
    const sorted = routes.map((route, order) => {
      const steps = route.steps.map((step) => {
        const owns = step.options.filter((option) => partnerOwned(stats.counts, option.partner));
        if (!owns.length || owns.length === step.options.length) return step;
        return { ...step, options: [...owns, ...step.options.filter((option) => !partnerOwned(stats.counts, option.partner))] };
      });
      const missing = steps.filter((step) => !step.options.some((option) => partnerOwned(stats.counts, option.partner))).length;
      return { route: { ...route, steps }, missing, order };
    });
    sorted.sort((a, b) => a.route.length - b.route.length || a.missing - b.missing || a.order - b.order);
    // 長さの順は findRoutes のまま（同じ長さの中だけ動かす）
    return sorted.map((item) => item.route);
  }
  // 経路の見出しの右の「相手親 2/3 段で所持」（その段のどれかの配合の相手親を組めれば所持）
  function badgeFor(stats) {
    if (!stats) return undefined;
    return (route) => {
      const owned = route.steps.filter((step) => step.options.some((option) => partnerOwned(stats.counts, option.partner))).length;
      const node = el('span', `route-owned-badge${owned === route.steps.length ? ' is-all' : ''}`, `相手親 ${owned}/${route.steps.length} 段で所持`);
      node.title = '各段の配合のどれかで、相手親を ♂ か ♀ で 1 体以上持っている段の数（タマゴ・グローバルパルボックスの個体は数えません）';
      return node;
    };
  }

  function renderResults(state, stats, starts, missing) {
    if (!to || !from) {
      // 開始の候補のチップがあれば、チップが次の手順を案内する
      if (to && starts.length) { results.replaceChildren(); return; }
      results.replaceChildren(empty(!to && !from ? '開始と目標のパルを選んでください。' : !to ? '目標のパルを選んでください。' : '開始のパルを選んでください。'));
      return;
    }
    if (from === to) { results.replaceChildren(empty('配合は不要です。')); return; }
    if (dataPending(results, state, () => context.store.refresh())) return;
    const { routes } = findRoutes(state.graph, state.index, from, to, { k: 5, slack: 3 });
    if (!routes.length) {
      results.replaceChildren(empty('登録済みの配合ではたどり着けません。', link('目標の配合を見る', buildHash('search', { c: to }), 'button secondary')));
      return;
    }
    results.replaceChildren(routeView(arrangeRoutes(routes, stats), {
      annotate: annotateFor(stats), badge: badgeFor(stats), passives: missing ? [] : passives, note: ROUTE_NOTE,
    }));
  }

  function update(state) {
    const pals = owned?.state?.owned?.pals ?? null;
    const missing = ownedMissing();
    renderHint(missing);
    // 候補を開いたまま記録・所持パルが変わったら、注記だけ描き直す（閉じない）
    toPicker.update();
    fromPicker.update();
    const ready = Boolean(pals && to && passives.length && state.env);
    const starts = ready ? ownedRouteStarts({ graph: state.graph, pals, to, passives, shortestRoute, palOrder: state.index?.palOrder }) : [];
    renderStartFilter(starts, ready && !starts.length ? startNoteFor(pals) : '');
    renderPassives(pals);
    const stats = statsOf(pals);
    renderResults(state, stats, starts, missing);
    renderOwned(stats);
  }
  // 登録した理想個体が変わったら（別のタブを含む）、登録した組み合わせを入れ直す
  const unsubscribeIdeals = context.ideals?.subscribe(() => passive.update({ presets: passivePresets(context.ideals) })) ?? (() => {});
  const pickers = { destroy() { toPicker.destroy(); fromPicker.destroy(); passive.destroy(); unsubscribeIdeals(); clearOwned(); } };
  const view = watchView(context.store, element, update, [pickers]);
  // 同じ画面のまま URL が変わったとき。選択欄は作り直さずに値だけ合わせる（開始の選択欄の値は renderStartFilter が合わせる）
  function applyRoute(next) {
    readRoute(next);
    syncPicker(toPicker, to);
    update(context.store.state);
  }
  if (!owned) return { ...view, applyRoute };
  let lastData = owned.state.data;
  let lastReady = owned.state.ready;
  // どのワールドの・いつのデータか・読み込みの状態は、ヘッダーのセーブ連携の状態に出す（D29 で、所持パルの欄の先頭のデータ元の 1 行をなくした）。
  // 読み込みを終えた（データがないと分かった）ときも描き直す
  const unsubscribe = owned.subscribe((ownedState) => {
    if (ownedState.data === lastData && ownedState.ready === lastReady) return;
    lastData = ownedState.data;
    lastReady = ownedState.ready;
    update(context.store.state);
  });
  owned.load().then(() => owned.autoRefresh()).catch(() => {});
  return { element, update, applyRoute, destroy() { unsubscribe(); view.destroy(); } };
}
