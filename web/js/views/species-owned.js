// 1 種族の所持個体の一覧（右のドロワーの中身。route-progress の F032）。継承ルートの相手親の「♂2 ♀1」を押すと開く。
// パッシブを渡すと、それをすべて持つ個体を上に並べて印を付ける。タマゴは別の見出しで下に。行の Lv・★・セルを押すと個体の詳細を同じドロワーで開く
import { el, link, syncList, clearList } from '../ui/dom.js';
import { palsById } from '../ui/pal-icon.js';
import { hasPassives, sortOwned, canBeParent, PLACE_ORDER } from '../core/owned.js';
import { buildHash } from '../router.js';
import { ownedRowItem, openDetailOnClick } from './owned.js';

/**
 * @param {object} context app.js の context（owned・drawer）
 * @param {string} palId 種族
 * @param {{ passives?: string[] }} [options]
 * @returns {{ element: HTMLElement, title: string, destroy(): void } | null} マスターにない種族は null
 */
export function speciesOwnedPanel(context, palId, { passives = [] } = {}) {
  const pal = palsById.get(palId);
  if (!pal) return null;
  const owned = context.owned;
  const element = el('div', 'species-owned');
  const summary = el('p', 'species-owned-summary');
  const parentsHead = el('h3', 'owned-detail-heading', '親にできる個体');
  const parentRows = el('div', 'pal-owned-rows species-owned-rows');
  const othersHead = el('h3', 'owned-detail-heading', 'タマゴ・グローバルパルボックス');
  const otherRows = el('div', 'pal-owned-rows species-owned-rows');
  const open = link('所持パルで開く →', buildHash('owned', { pal: palId, place: PLACE_ORDER.join(','), p: passives.join(',') }), 'species-owned-open');
  element.append(summary, parentsHead, parentRows, othersHead, otherRows, open);
  openDetailOnClick(parentRows, context.drawer);
  openDetailOnClick(otherRows, context.drawer);
  const highlight = passives.length ? { wanted: passives } : undefined;
  const rowOptions = {
    key: (row) => row.id,
    create: (row) => {
      const item = ownedRowItem(row, { detail: Boolean(context.drawer), highlight });
      return { element: item.element, update: (next) => item.update(next, { highlight }), destroy: () => item.destroy() };
    },
  };

  let lastData;
  function render() {
    const data = owned?.state?.owned;
    if (data === lastData) return;
    lastData = data;
    const list = (data?.pals ?? []).filter((item) => item.palId === palId);
    // パッシブをすべて持つ個体を上に（それぞれパッシブのランクが高い順）
    const sorted = sortOwned(list, 'passives');
    const matching = passives.length ? sorted.filter((item) => hasPassives(item, passives)) : [];
    const ordered = passives.length ? [...matching, ...sorted.filter((item) => !hasPassives(item, passives))] : sorted;
    const parents = ordered.filter(canBeParent);
    const others = ordered.filter((item) => !canBeParent(item));
    const males = parents.filter((item) => item.gender === 'M').length;
    const females = parents.filter((item) => item.gender === 'F').length;
    summary.textContent = !data ? '所持パルのデータがありません。'
      : !list.length ? '所持していません。'
        : `所持 ${list.length} 体 · 親になれる ♂${males} ♀${females}${passives.length ? ` · 選んだパッシブをすべて持つ ${matching.length} 体` : ''}`;
    parentsHead.hidden = !parents.length;
    othersHead.hidden = !others.length;
    syncList(parentRows, parents, rowOptions);
    syncList(otherRows, others, rowOptions);
    open.hidden = !list.length;
  }
  render();
  const unsubscribe = owned?.subscribe?.(() => render()) ?? (() => {});
  return {
    element,
    title: `${pal.ja}の所持個体`,
    destroy() {
      unsubscribe();
      clearList(parentRows);
      clearList(otherRows);
    },
  };
}
