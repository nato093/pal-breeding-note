import { el, field, button, empty } from '../ui/dom.js';
import { palPicker } from '../ui/pal-picker.js';
import { breedingCard } from '../ui/breeding-card.js';
import { viewHeading, watchView, dataPending } from './shared.js';

export function listView(context) {
  const element = el('section', 'view');
  element.append(viewHeading('みんなの配合ノート', '見つけた組み合わせを、一冊に。', { share: false }));
  let selected = '';
  let limit = 50;
  const picker = palPicker({ label: 'パルで絞り込む（親・子）', storage: context.store.storage,
    onChange: (id) => { selected = id; limit = 50; update(context.store.state); } });
  const registrant = el('input');
  registrant.type = 'search';
  registrant.placeholder = '登録者名で絞り込む';
  const sort = el('select');
  for (const [key, label] of [['updated', '更新日の新しい順'], ['dex', '図鑑順']]) {
    const option = el('option', '', label);
    option.value = key;
    sort.append(option);
  }
  const filters = el('div', 'selection-panel list-filters');
  filters.append(picker.element, field('登録者名', registrant), field('並べ替え', sort));
  const count = el('p', 'result-note');
  const results = el('div', 'card-stack');
  const more = button('もっと見る', () => { limit += 50; update(context.store.state); }, 'button secondary load-more');
  element.append(filters, count, results, more);
  for (const input of [registrant, sort]) input.addEventListener('input', () => { limit = 50; update(context.store.state); });
  function update(state) {
    more.hidden = true;
    if (dataPending(results, state)) return;
    const query = registrant.value.trim().toLocaleLowerCase('ja');
    const records = state.records.filter((record) => (!selected || [record.parent1Id, record.parent2Id, record.childId].includes(selected))
      && record.registrant.toLocaleLowerCase('ja').includes(query)).sort((a, b) => {
      if (sort.value === 'dex') {
        const rank = (id) => state.index.palOrder.get(id) ?? Infinity;
        return rank(a.childId) - rank(b.childId) || rank(a.parent1Id) - rank(b.parent1Id)
          || rank(a.parent2Id) - rank(b.parent2Id) || a.id.localeCompare(b.id);
      }
      return b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
    });
    count.textContent = `${records.length} 件の配合 · ${Math.min(limit, records.length)} 件を表示`;
    results.replaceChildren();
    if (!records.length) results.append(empty('条件に合う登録はありません。見つけた配合を登録しましょう。',
      button('配合を登録', () => context.register(), 'button primary')));
    for (const record of records.slice(0, limit)) results.append(breedingCard(record, context));
    more.hidden = records.length <= limit;
  }
  return watchView(context.store, element, update, [picker]);
}
