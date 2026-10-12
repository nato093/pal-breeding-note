import { el, field, button, empty, onTextInput } from '../ui/dom.js';
import { palsById } from '../ui/pal-icon.js';
import { withTransition } from '../ui/motion.js';
import { parentRows, recordComparator } from '../core/record-sort.js';
import { viewHeading, renderCards, watchView, dataPending } from './shared.js';

// 並べ替えの動き（View Transition）を使う行の数の上限（多いとスナップショットが重い）
const TRANSITION_MAX = 2000;

export function listView(context) {
  const element = el('section', 'view');
  element.append(viewHeading('みんなの配合ノート'));
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
  // タブを切り替えて戻ってきても、前の絞り込みと並べ替えのまま出す。
  const memory = context.viewState?.('list') ?? {};
  if (memory.registrant) registrant.value = memory.registrant;
  if (memory.sort) sort.value = memory.sort;
  const filters = el('div', 'selection-panel list-filters');
  filters.append(field('登録者名', registrant), field('並べ替え', sort));
  const count = el('p', 'result-note');
  const results = el('div', 'card-stack');
  // 件数が多くても、最初からすべて出す
  element.append(filters, count, results);
  const remember = () => {
    memory.registrant = registrant.value;
    memory.sort = sort.value;
  };
  let shownRows = 0;
  // 登録者名は入力を間引く（日本語の変換中は絞らない）。並べ替えはすぐ（行の順番が変わるので、動きを付ける）
  onTextInput(registrant, () => { remember(); update(context.store.state); }, { delay: context.inputDelay ?? 150 });
  sort.addEventListener('input', () => {
    remember();
    const draw = () => update(context.store.state);
    if (shownRows > TRANSITION_MAX) draw();
    else withTransition(draw);
  });
  function update(state) {
    if (dataPending(results, state)) { shownRows = 0; return; }
    const query = registrant.value.trim().toLocaleLowerCase('ja');
    const records = state.records.filter((record) => record.registrant.toLocaleLowerCase('ja').includes(query));
    const byParent = sort.value.startsWith('parent');
    const rows = (byParent ? parentRows(records) : records).sort(recordComparator(sort.value, state.index.palOrder, palsById));
    count.textContent = `${records.length} 件の配合 · ${rows.length} 件を表示`;
    shownRows = rows.length;
    // 親の順は 1 件 2 行（左に出す親が違う）。行の key に表示の向きを入れて、同じ配合の 2 行を別の行にする
    renderCards(results, rows.map((row) => (byParent ? { record: row.record, leftParent: row.parent1Id } : { record: row })), context, {
      empty: () => empty('条件に合う登録はありません。見つけた配合を登録しましょう。', button('配合を登録', () => context.register(), 'button primary')),
    });
  }
  return watchView(context.store, element, update);
}
