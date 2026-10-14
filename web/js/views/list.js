import { el, field, button, empty, onTextInput } from '../ui/dom.js';
import { palsById } from '../ui/pal-icon.js';
import { withTransition } from '../ui/motion.js';
import { parentRows, recordComparator } from '../core/record-sort.js';
import { viewHeading, renderCards, watchView, dataPending } from './shared.js';
import { tabLabel } from './tabs.js';
import { text, oneOf } from '../core/boundary.js';

// 並べ替えの動き（View Transition）を使う行の数の上限（多いとスナップショットが重い）
const TRANSITION_MAX = 2000;
const SORTS = [['parent-dex', '親の図鑑番号順'], ['parent-name', '親の五十音順'],
  ['child-dex', '子の図鑑番号順'], ['child-name', '子の五十音順'], ['updated', '更新日の新しい順']];

/** 保存して読み戻す絞り込みと並べ替えの形（ui/view-memory.js）。合わない値は ''（＝既定の並べ替え） */
export const LIST_MEMORY = {
  registrant: (value) => text(value, 30),
  sort: (value) => oneOf(value, SORTS.map(([key]) => key), ''),
};

export function listView(context) {
  const element = el('section', 'view');
  element.append(viewHeading(tabLabel('list')));
  const registrant = el('input');
  registrant.type = 'search';
  registrant.placeholder = '登録者名で絞り込む';
  const sort = el('select');
  for (const [key, label] of SORTS) {
    const option = el('option', '', label);
    option.value = key;
    sort.append(option);
  }
  // タブを切り替えて戻ってきても、前の絞り込みと並べ替えのまま出す。読み込み直しても、同じタブ（sessionStorage）の間は残る（app.js が戻す）。
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
  let destroyed = false;
  // 登録者名は入力を間引く（日本語の変換中は絞らない）。画面を閉じたら待っている入力は取り消す
  const inputs = new AbortController();
  const typed = onTextInput(registrant, () => { remember(); update(context.store.state); }, { delay: context.inputDelay ?? 150, signal: inputs.signal });
  // 並べ替えはすぐ（行の順番が変わるので、動きを付ける）。利用者が変えたときは、結果の始まりが見える位置へ（データの更新では動かさない）
  sort.addEventListener('input', () => {
    remember();
    const draw = () => {
      update(context.store.state);
      showStart();
    };
    if (shownRows > TRANSITION_MAX) draw();
    else withTransition(draw);
  });
  // 結果の始まり（件数の行）が固定のヘッダーの下に隠れているときだけ、そこまで戻す（上の余白は html の scroll-padding-top）
  function showStart() {
    if (destroyed) return;
    const header = globalThis.document?.querySelector?.('.app-header')?.getBoundingClientRect().bottom ?? 0;
    if (count.getBoundingClientRect().top < header) count.scrollIntoView?.({ block: 'start' });
  }
  function update(state) {
    // 閉じた後に遅れて呼ばれたとき（並べ替えの動きの後など）は描かない
    if (destroyed) return;
    if (dataPending(results, state, () => context.store.refresh())) { shownRows = 0; return; }
    const entered = registrant.value.trim();
    const query = entered.toLocaleLowerCase('ja');
    const records = state.records.filter((record) => record.registrant.toLocaleLowerCase('ja').includes(query));
    const byParent = sort.value.startsWith('parent');
    const rows = (byParent ? parentRows(records) : records).sort(recordComparator(sort.value, state.index.palOrder, palsById));
    count.textContent = `${records.length} 件の配合 · ${rows.length} 件を表示`;
    shownRows = rows.length;
    // 親の順は 1 件 2 行（左に出す親が違う）。行の key に表示の向きを入れて、同じ配合の 2 行を別の行にする
    // 0 件: 登録が 1 件もなければ登録へ、登録者名で絞って 0 件なら絞り込みを解除へ（押したときは今の入力を読む）
    renderCards(results, rows.map((row) => (byParent ? { record: row.record, leftParent: row.parent1Id } : { record: row })), context, {
      empty: () => (state.records.length
        ? empty(`「${entered}」に合う登録はありません。`, button('絞り込みを解除', clearFilter, 'button secondary'), { icon: 'list' })
        : empty('登録された配合はまだありません。見つけた配合を登録しましょう。', button('配合を登録', () => context.register(), 'button primary'), { icon: 'list' })),
    });
  }
  // 登録者名の絞り込みを空にして描き直す。押したボタンは消えるので、フォーカスは登録者名の欄へ
  function clearFilter() {
    typed.cancel();
    registrant.value = '';
    remember();
    update(context.store.state);
    registrant.focus();
  }
  const view = watchView(context.store, element, update);
  return {
    ...view,
    // 間引いて待っている登録者名の入力をすぐ当てる（app.js が、移る前に履歴のエントリへ条件を書く前に呼ぶ）
    flushInputs: () => typed.flush(),
    destroy() {
      destroyed = true;
      inputs.abort();
      view.destroy();
    },
  };
}
