import { el, button, empty } from '../ui/dom.js';
import { palPicker } from '../ui/pal-picker.js';
import { findByPair, findByParent } from '../core/index.js';
import { viewHeading, validId, navigateSelection, renderCards, watchView, dataPending, syncPicker, recordCountNotes } from './shared.js';
import { tabLabel } from './tabs.js';

export function searchView(context, route) {
  const element = el('section', 'view');
  element.append(viewHeading(tabLabel('search')));
  let current = route;
  let p1 = '';
  let p2 = '';
  // URL から読む条件（作るときと、同じ画面のまま URL が変わったとき）
  function readRoute(next) {
    current = next;
    p1 = validId(next, 'p1', context);
    p2 = validId(next, 'p2', context);
  }
  readRoute(route);
  const selections = el('div', 'selection-panel search-selection');
  // 候補の並びは変えず、親としての登録件数を添える（記録を読み込む前は何も添えない）
  const describe = () => (context.store.state.env ? recordCountNotes(context.store.state.index, 'parent') : {});
  const pickers = [['p1', '親1', p1], ['p2', '親2', p2]].map(([key, label, value]) => palPicker({
    label, value, describe, onChange: (id) => navigateSelection(context, current, key, id),
  }));
  selections.append(...pickers.map((picker) => picker.element));
  const note = el('p', 'result-note');
  const results = el('div', 'card-stack');
  element.append(selections, note, results);
  const view = watchView(context.store, element, (state) => {
    // 候補を開いたまま記録が変わったら、件数だけ描き直す（閉じない）
    for (const picker of pickers) picker.update();
    note.textContent = '';
    if (!p1 && !p2) { renderCards(results, [], context, { empty: () => empty('親を選んで、仲間と記録した配合を探しましょう。親1だけでも探せます。') }); return; }
    if (dataPending(results, state, () => context.store.refresh())) return;
    const records = p1 && p2 ? findByPair(state.index, p1, p2) : findByParent(state.index, p1 || p2);
    if (!records.length) {
      // 親を 1 体だけ選んでいれば、その親を親 1 に入れて登録を開く（両方なら今の組み合わせ）。押したときの親は今の値を読む（syncList は同じ文の空の表示を作り直さない）
      renderCards(results, [], context, { empty: () => (p1 && p2
        ? empty('この組み合わせはまだ登録されていません。', button('この組み合わせを登録', () => context.register({ parent1Id: p1, parent2Id: p2 }), 'button primary'))
        : empty('この親を使う配合はまだ登録されていません。', button('この親の配合を登録', () => context.register({ parent1Id: p1 || p2 }), 'button primary'))) });
      return;
    }
    note.textContent = p1 && p2 && records.length > 1 ? '同じ組み合わせで結果が複数登録されています' : `${records.length} 件の登録済み配合`;
    renderCards(results, records.map((record) => ({ record, leftParent: p1 || (record.parent1Id === p2 ? record.parent2Id : record.parent1Id) })), context);
  }, pickers);
  return {
    ...view,
    applyRoute(next) {
      readRoute(next);
      syncPicker(pickers[0], p1);
      syncPicker(pickers[1], p2);
      view.update(context.store.state);
    },
  };
}
