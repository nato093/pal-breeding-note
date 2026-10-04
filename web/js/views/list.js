import { el, field, button, empty } from '../ui/dom.js';
import { breedingCard } from '../ui/breeding-card.js';
import { palsById } from '../ui/pal-icon.js';
import { parentRows, recordComparator } from '../core/record-sort.js';
import { viewHeading, watchView, dataPending } from './shared.js';

export function listView(context) {
  const element = el('section', 'view');
  element.append(viewHeading('みんなの配合ノート'));
  let limit = 50;
  const registrant = el('input');
  registrant.type = 'search';
  registrant.placeholder = '登録者名で絞り込む';
  const sort = el('select');
  for (const [key, label] of [['parent-dex', '親の図鑑番号順'], ['parent-name', '親の五十音順'],
    ['child-dex', '子の図鑑番号順'], ['child-name', '子の五十音順'], ['updated', '更新日の新しい順']]) {
    const option = el('option', '', label);
    option.value = key;
    sort.append(option);
  }
  const filters = el('div', 'selection-panel list-filters');
  filters.append(field('登録者名', registrant), field('並べ替え', sort));
  const count = el('p', 'result-note');
  const results = el('div', 'card-stack');
  const more = button('もっと見る', () => { limit += 50; update(context.store.state); }, 'button secondary load-more');
  element.append(filters, count, results, more);
  for (const input of [registrant, sort]) input.addEventListener('input', () => { limit = 50; update(context.store.state); });
  function update(state) {
    more.hidden = true;
    if (dataPending(results, state)) return;
    const query = registrant.value.trim().toLocaleLowerCase('ja');
    const records = state.records.filter((record) => record.registrant.toLocaleLowerCase('ja').includes(query));
    const byParent = sort.value.startsWith('parent');
    const rows = (byParent ? parentRows(records) : records).sort(recordComparator(sort.value, state.index.palOrder, palsById));
    count.textContent = `${records.length} 件の配合 · ${Math.min(limit, rows.length)} 件を表示`;
    results.replaceChildren();
    if (!records.length) results.append(empty('条件に合う登録はありません。見つけた配合を登録しましょう。',
      button('配合を登録', () => context.register(), 'button primary')));
    for (const row of rows.slice(0, limit)) {
      results.append(byParent ? breedingCard(row.record, context, { leftParent: row.parent1Id }) : breedingCard(row, context));
    }
    more.hidden = rows.length <= limit;
  }
  return watchView(context.store, element, update);
}
