// 図鑑（`#/pal`。パル ID なし。paldex）: 有効な全パルを図鑑順の格子に並べ、仲間が子として登録した件数（登録のない種は絵を影に）・
// 所持の点・目標の星・自分の捕獲数（ホストの画面だけ）を重ねる。マスはパルのタイル（a.pal-tile）なので、押すと右のドロワーでパル詳細
//（app.js の root の click → ui/drawer.js の handlePalLink。Ctrl・中クリックは全画面）。
// 記録・所持パル・目標・自分の更新では、マスを作り直さずに印の変わったマスだけを直す（syncList の update）。集計は更新ごとに 1 回で、
// 記録の索引・所持パルのデータごとに覚える。配合表・遺伝の仕組みは読まない（INV-2。影で示すのは「子としての登録がない」ことだけ）
import { el, syncList, clearList } from '../ui/dom.js';
import { palIcon } from '../ui/pal-icon.js';
import { icon } from '../ui/icons.js';
import { segmented } from '../ui/segmented.js';
import { ownedCounts, ownCaptures } from '../core/owned.js';
import pals from '../../data/pals.js';
import { buildHash } from '../router.js';
import { dataPending, viewHeading } from './shared.js';

/** 絞り込み（[値, ラベル, 説明]。viewState('paldex').filter に残す）。「未所持」は所持パルのデータがあるときだけ出す */
export const PALDEX_FILTERS = Object.freeze([
  ['all', 'すべて', '全部のパル'],
  ['unregistered', '未登録', '仲間がまだ子として登録していないパルだけ'],
  ['unowned', '未所持', '表示しているワールドの所持パルにいないパルだけ'],
]);
const FILTER_DEFAULT = 'all';
/** マスの絵の大きさ（width・height。CSS の枠も同じ。読み込む前・絵のないときも配置を揺らさない） */
export const PALDEX_ICON_SIZE = 48;
// 件数の印の上限（それより多ければ「99+」）
const COUNT_SHOWN_MAX = 99;

const compareId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** 図鑑順（番号 → 亜種 → ID。core/index.js の palOrder と同じ）の有効なパル（今のマスターで 298 体） */
export const PALDEX_PALS = Object.freeze(pals.filter((pal) => pal.active)
  .sort((a, b) => a.no - b.no || Number(a.variant) - Number(b.variant) || compareId(a.id, b.id)));

// 子としての登録の件数（記録の索引ごとに 1 回）と、種族ごとの所持数（所持パルのデータごとに 1 回）
const childCache = new WeakMap();
function childCounts(index) {
  let counts = childCache.get(index);
  if (!counts) {
    counts = new Map();
    for (const pal of PALDEX_PALS) {
      const count = index.byChild?.get(pal.id)?.length ?? 0;
      if (count) counts.set(pal.id, count);
    }
    childCache.set(index, counts);
  }
  return counts;
}
const ownedCache = new WeakMap();
function ownedTotals(list) {
  let counts = ownedCache.get(list);
  if (!counts) ownedCache.set(list, counts = ownedCounts(list));
  return counts;
}

/**
 * 図鑑の印の集計（データの更新ごとに 1 回。マスはこれを引くだけ）。
 * children は子としての登録の件数（記録がまだ読めていなければ null）、owned は種族ごとの所持数（ownedCounts。所持パルのデータが
 * なければ null）、goals は目標の種族、captures は自分の捕獲数（ownCaptures。自分が分からない・参加者・古いデータでは null）
 * @param {{ index?: object | null, ownedData?: object | null, goals?: { palId: string }[], selfUids?: Set<string> }} input
 */
export function paldexMarks({ index = null, ownedData = null, goals = [], selfUids = new Set() } = {}) {
  return {
    children: index ? childCounts(index) : null,
    owned: Array.isArray(ownedData?.pals) ? ownedTotals(ownedData.pals) : null,
    goals: new Set(goals.map((goal) => goal?.palId).filter(Boolean)),
    captures: ownedData ? ownCaptures(ownedData.players, selfUids) : null,
  };
}

/**
 * 1 マスの状態（syncList の 1 行）。owned・capture は分からなければ null。shown は絞り込みで見せるか
 * @param {object} pal マスターのパル
 * @param {ReturnType<typeof paldexMarks>} marks
 * @param {string} filter PALDEX_FILTERS の値（「未所持」は所持パルのデータがあるときだけ渡す）
 */
export function paldexCellState(pal, marks, filter = FILTER_DEFAULT) {
  const count = marks.children?.get(pal.id) ?? 0;
  const owned = marks.owned ? marks.owned.get(pal.id)?.total ?? 0 : null;
  const capture = marks.captures ? marks.captures.get(pal.id) ?? 0 : null;
  const shown = filter === 'unregistered' ? !count : filter === 'unowned' ? owned === 0 : true;
  return { pal, count, owned, goal: marks.goals.has(pal.id), capture, shown };
}

/** マスの読み上げの名前（「No.1 モコロン（子としての登録なし・所持 3 体・目標・捕獲 12）」。印は見た目だけなのでここに全部入れる） */
export function paldexCellLabel({ pal, count, owned, goal, capture }) {
  const parts = [count ? `子としての登録 ${count} 件` : '子としての登録なし'];
  if (owned !== null && owned !== undefined) parts.push(owned ? `所持 ${owned} 体` : '未所持');
  if (goal) parts.push('目標');
  if (capture) parts.push(`捕獲 ${capture}`);
  return `No.${pal.label} ${pal.ja}（${parts.join('・')}）`;
}

// 1 マス（a.pal-tile。番号と件数・絵・名前・所持の点と捕獲数と目標の星）。update は印の変わったときだけ DOM を直す
function paldexCell(initial) {
  const { pal } = initial;
  const cell = el('a', 'pal-tile paldex-cell');
  cell.href = buildHash('pal', {}, pal.id);
  // ホバーの解説の板の対象（ui/hover-card.js。所持と登録の件数を出す）
  cell.setAttribute('data-pal-id', pal.id);
  const count = el('span', 'paldex-count');
  const head = el('span', 'paldex-head');
  head.append(el('small', 'paldex-no', `No.${pal.label}`), count);
  const picture = palIcon(pal, { size: PALDEX_ICON_SIZE });
  picture.classList.add('paldex-icon');
  const owned = el('span', 'paldex-owned');
  const capture = el('span', 'paldex-capture');
  const goal = el('span', 'paldex-goal');
  goal.append(icon('star', { className: 'paldex-star' }));
  const foot = el('span', 'paldex-foot');
  foot.append(owned, capture, goal);
  cell.append(head, picture, el('span', 'paldex-name', pal.ja), foot);
  let shownKey = '';
  const update = (state) => {
    const key = `${state.count}|${state.owned}|${state.goal}|${state.capture}|${state.shown}`;
    if (key === shownKey) return;
    shownKey = key;
    cell.hidden = !state.shown;
    count.hidden = !state.count;
    count.textContent = state.count ? (state.count > COUNT_SHOWN_MAX ? `${COUNT_SHOWN_MAX}+` : String(state.count)) : '';
    // 子としての登録がない種は、実物の絵を CSS の filter で影にする（画像は足さない。X-14）。所持・捕獲している種は、影ではなく淡い白黒の絵に
    //（is-known。ゲームの図鑑の「影＝未捕獲」と逆の意味に読めないように。影・淡い絵・点線の枠の意味は「子としての登録なし」のまま。INV-2）
    cell.classList.toggle('is-unregistered', !state.count);
    cell.classList.toggle('is-known', !state.count && Boolean(state.owned || state.capture));
    picture.classList.toggle('pal-icon-silhouette', !state.count);
    owned.hidden = !state.owned;
    capture.hidden = !state.capture;
    capture.textContent = state.capture ? `捕獲 ${state.capture}` : '';
    goal.hidden = !state.goal;
    cell.setAttribute('aria-label', paldexCellLabel(state));
  };
  update(initial);
  return { element: cell, update };
}

// 印の見方（見た目の見本と短い文。所持と捕獲数は分かるときだけ）
function paldexLegend() {
  const legend = el('p', 'paldex-legend');
  const item = (sample, text) => {
    const node = el('span', 'paldex-legend-item');
    if (sample) {
      sample.setAttribute('aria-hidden', 'true');
      node.append(sample);
    }
    node.append(el('span', '', text));
    legend.append(node);
    return node;
  };
  item(el('span', 'paldex-count', '3'), '子としての登録の件数');
  // 影の意味（ゲームの図鑑の「影＝未捕獲」とは違う）をはっきり書く。所持・捕獲している種は影ではなく淡い絵（is-known）
  const shadow = el('span', 'paldex-legend-shadow');
  item(shadow, '影・淡い絵は、子として登録された配合がまだない種族（所持・捕獲していれば淡い絵）');
  const owned = item(el('span', 'paldex-owned'), '所持');
  const star = el('span', 'paldex-goal');
  star.append(icon('star', { className: 'paldex-star' }));
  item(star, '目標');
  const capture = item(el('span', 'paldex-capture', '捕獲 12'), '自分が捕まえた数（ホストの画面）');
  return {
    element: legend,
    update(marks) {
      owned.hidden = !marks.owned;
      capture.hidden = !marks.captures;
    },
  };
}

/**
 * `#/pal`（ID なし）の図鑑の画面。
 * @param {object} context app.js の context（store・owned・ideals・self・viewState）
 * @returns {{ element: HTMLElement, destroy(): void }}
 */
export function paldexView(context) {
  const element = el('section', 'view paldex-view');
  // 絞り込みは画面の入れ物に残す（タブを替えて戻っても同じ。読み込み直すと既定）
  const memory = context.viewState?.('paldex') ?? {};
  if (!PALDEX_FILTERS.some(([key]) => key === memory.filter)) memory.filter = FILTER_DEFAULT;
  const subscriptions = [];
  let destroyed = false;

  const summary = el('p', 'paldex-summary');
  const filterSlot = el('div', 'paldex-filter');
  // 絞り込みに当たる数（「297 体」。替えたら読み上げる。aria-live。矢印キーで動く格子は作らない〔298 マスと大きいため〕）
  const shownCount = el('span', 'paldex-shown');
  shownCount.setAttribute('aria-live', 'polite');
  filterSlot.append(shownCount);
  const bar = el('div', 'paldex-bar');
  bar.append(summary, filterSlot);
  const legend = paldexLegend();
  const status = el('div', 'paldex-status');
  const none = el('p', 'paldex-none');
  none.hidden = true;
  const grid = el('div', 'paldex-grid');
  grid.setAttribute('aria-label', 'パルの一覧（図鑑順）');
  element.append(viewHeading('図鑑'), bar, legend.element, status, none, grid);

  // 絞り込みの押しボタン（1 つだけ作り、作り直さない。「未所持」は所持パルのデータがあるときだけ出す。作り直すと、データが届いたときに
  // 押したばかりの押しボタンのフォーカスが落ちた。フェーズ 4 の終わりのレビュー）
  const filter = segmented({
    label: '図鑑の絞り込み', value: memory.filter, choices: PALDEX_FILTERS,
    onChange: (next) => {
      memory.filter = next;
      refresh({ filterChanged: true });
    },
  });
  filterSlot.append(filter.element);
  function renderFilter(hasOwned, value) {
    filter.update(value);
    filter.setHidden('unowned', !hasOwned);
  }
  let shownText = '';
  function renderShown(count) {
    const text = `${count} 体`;
    if (text === shownText) return;
    shownText = text;
    shownCount.textContent = text;
  }

  // 絞り込みで隠れるマスでも、フォーカスのあるマスと、右のドロワーで開いているパルのマス（ドロワーを閉じたときの戻り先）は、データの更新では
  // 隠さずに次の更新まで残す（「未登録」で開いたパルをドロワーから登録したときなど。隠すとフォーカス・戻り先が body に落ちる）。
  // 絞り込みを替えたときは残さない。前の更新で出ていたマスだけ（隠れていたマスを出し直さない）
  let lastShown = new Set();
  function keptIds() {
    const kept = new Set();
    const active = globalThis.document?.activeElement;
    const focusedId = active && active !== grid && grid.contains?.(active) ? active.getAttribute?.('data-pal-id') : null;
    if (focusedId) kept.add(focusedId);
    const opened = context.drawer?.isOpen?.() ? context.drawer.current?.() : null;
    if (opened?.kind === 'pal' && opened.id) kept.add(opened.id);
    return kept;
  }

  let summaryKey = '';
  function renderSummary(items, marks, pending) {
    const total = items.length;
    const parts = [];
    if (!pending) parts.push(['子として登録', `${items.filter((item) => item.count).length} / ${total}`]);
    if (marks.owned) parts.push(['所持', `${items.filter((item) => item.owned).length} / ${total}`]);
    if (marks.captures) parts.push(['捕獲（自分）', `${items.filter((item) => item.capture).length} 種`]);
    const key = JSON.stringify(parts);
    if (key === summaryKey) return;
    summaryKey = key;
    summary.replaceChildren(...parts.flatMap(([label, value], index) => {
      const part = el('span', 'paldex-stat');
      part.append(el('span', 'paldex-stat-label', label), el('strong', '', value));
      return index ? [el('span', 'paldex-sep', '·'), part] : [part];
    }));
  }

  function refresh({ filterChanged = false } = {}) {
    if (destroyed) return;
    const state = context.store?.state ?? {};
    // 記録をまだ読めていなければ、読み込み中（失敗なら「もう一度読み込む」）を出し、格子は隠す（全部が影に見えないように）
    const pending = context.store ? dataPending(status, state, () => context.store.refresh()) : false;
    if (!pending && status.children.length) clearList(status);
    const marks = paldexMarks({
      index: pending ? null : state.index, ownedData: context.owned?.state?.owned ?? null,
      goals: context.ideals?.list?.() ?? [], selfUids: context.ideals?.selfUids?.() ?? new Set(),
    });
    // 所持パルのデータがないときの「未所持」は「すべて」として描く（覚えた値は残し、データが来たら戻す）
    const current = memory.filter === 'unowned' && !marks.owned ? 'all' : memory.filter;
    renderFilter(Boolean(marks.owned), current);
    const kept = filterChanged ? null : keptIds();
    let matched = 0;
    const items = PALDEX_PALS.map((pal) => {
      const item = paldexCellState(pal, marks, current);
      if (item.shown) matched++;
      else if (kept?.has(pal.id) && lastShown.has(pal.id)) item.shown = true;
      return item;
    });
    syncList(grid, items, { key: (item) => item.pal.id, create: paldexCell });
    lastShown = new Set(items.filter((item) => item.shown).map((item) => item.pal.id));
    grid.hidden = pending;
    renderSummary(items, marks, pending);
    renderShown(pending ? 0 : matched);
    shownCount.hidden = pending;
    legend.update(marks);
    none.hidden = pending || items.some((item) => item.shown);
    none.textContent = current === 'unowned' ? '所持していないパルはいません。' : '子として登録のないパルはいません。';
  }

  // 記録（登録済みの配合）: 中身が同じ取得では描き直さない（views/shared.js の watchView と同じ比べ方）
  const store = context.store;
  if (store?.subscribe) {
    let last = null;
    subscriptions.push(store.subscribe((state) => {
      const key = `${state.revision ?? ''}|${state.env ?? ''}|${state.error ?? ''}`;
      if (state.revision !== undefined && key === last) return;
      last = key;
      refresh();
    }));
  }
  // 所持パル（データが変わったときだけ）。直接開いたときにもデータが入るよう読み込む
  const owned = context.owned;
  if (owned?.subscribe) {
    let lastData = owned.state?.owned;
    subscriptions.push(owned.subscribe((state) => {
      if (state.owned === lastData) return;
      lastData = state.owned;
      refresh();
    }));
  }
  // 目標の追加・削除と、自分のプレイヤーの変更（このワールドでの自分・プレイヤーの対応。ideals が知らせる）
  if (context.ideals?.subscribe) subscriptions.push(context.ideals.subscribe(() => refresh()));
  if (context.self?.subscribe) subscriptions.push(context.self.subscribe(() => refresh()));
  refresh();
  owned?.load?.()?.catch?.(() => {});

  return {
    element,
    destroy() {
      destroyed = true;
      for (const unsubscribe of subscriptions.splice(0)) {
        try { unsubscribe?.(); } catch { /* 外せない購読は残っても描き直さない（destroyed）。 */ }
      }
      filter.destroy();
      clearList(grid);
    },
  };
}
