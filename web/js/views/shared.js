import { el, empty, syncList, clearList } from '../ui/dom.js';
import { breedingCard } from '../ui/breeding-card.js';
import { buildHash } from '../router.js';
import { palsById } from '../ui/pal-icon.js';
import { toast } from '../ui/toast.js';

export function viewHeading(title) {
  const header = el('header', 'view-heading');
  header.append(el('h1', '', title));
  return header;
}

export function validId(route, key, context) {
  const id = route.params.get(key) ?? '';
  if (!id || palsById.has(id)) return id;
  toast('パルが見つかりません');
  route.params.delete(key);
  context.replace(buildHash(route.view, route.params, route.id));
  return '';
}

/**
 * 画面の中の条件の変更（パル・パッシブを選ぶなど）で URL を変える。同じ画面なら作り直さず、ビューの applyRoute で合わせる
 * （context.update）。ビューのテストの context は update を持たないので、そのときは navigate に落とす。
 */
export function changeRoute(context, hash) {
  if (context.update) context.update(hash);
  else context.navigate(hash);
}

/** route は今の route（applyRoute で入れ直したもの）を渡す。同じ画面なら作り直さない（changeRoute）。 */
export function navigateSelection(context, route, key, value) {
  const params = new URLSearchParams(route.params);
  if (value) params.set(key, value);
  else params.delete(key);
  changeRoute(context, buildHash(route.view, params, route.id));
}

/** パル選択の値が違うときだけ合わせる（同じ値では描き直さない）。 */
export function syncPicker(picker, value) {
  if (picker && picker.getValue() !== value) picker.setValue(value);
}

/**
 * 配合のカードの key。表示の向き（左に出す親・相手を出す親）と中身の版（etag・updatedAt）を含める。
 * 1 件 2 行の一覧で同じ key にしない・楽観更新（updatedAt が変わる）と送信待ちの登録（pending の etag）で古い表示を残さない
 */
export const cardKey = ({ record, leftParent = '', focusParent = '' }) =>
  `${record.id}|${leftParent ? `L:${leftParent}` : focusParent ? `F:${focusParent}` : ''}|${record.etag ?? ''}|${record.updatedAt ?? ''}`;

/**
 * 配合のカードを key で使い回して描く（同じ配合は同じ要素のまま。中身が変わった配合は key が変わって作り直す）。
 * items は [{ record, leftParent?, focusParent? }]。emptyNode（() => Element）は 0 件のときに出す要素
 */
export function renderCards(target, items, context, { empty: emptyNode } = {}) {
  syncList(target, items, {
    key: cardKey,
    create: ({ record, leftParent = '', focusParent = '' }) => ({ element: breedingCard(record, context, { leftParent, focusParent }) }),
    empty: emptyNode,
  });
}

export function dataPending(target, state) {
  if (state.env) return false;
  // 使い回している行を捨ててから出す（syncList の入れ物に replaceChildren を直接使わない決まり）
  clearList(target);
  target.append(empty(state.error || '登録済みの配合を読み込んでいます…'));
  return true;
}

// blur を待っている入れ物（待っている間に呼ばれたら、最後の描き方だけを後で行う）
const waiting = new WeakMap();

/**
 * container の中にフォーカスがあれば、その要素から離れる（blur）まで render を待つ（開いている選択肢を閉じない・選んでいる途中に作り直さない）。
 * 待たなければすぐ render して true を返す
 */
export function renderWhenIdle(container, render) {
  const doc = globalThis.document;
  const active = doc?.activeElement;
  if (!active || active === doc.body || !container.contains(active)) {
    waiting.delete(container);
    render();
    return true;
  }
  const entry = waiting.get(container);
  if (entry) { entry.render = render; return false; }
  const next = { render };
  waiting.set(container, next);
  active.addEventListener('blur', () => {
    if (waiting.get(container) !== next) return;
    waiting.delete(container);
    // フォーカスが次の要素へ移ってから確かめ直す（同じ入れ物の中へ移ったなら、また待つ）
    queueMicrotask(() => renderWhenIdle(container, next.render));
  }, { once: true });
  return false;
}

const optionKeys = new WeakMap();

/**
 * select の選択肢を choices（[value, label] の並び）に合わせる。並びが前と同じなら作り直さない。
 * 違っても、その select にフォーカスがある間は作り直さず、blur の後に作り直す（renderWhenIdle）。
 * after(select) は選択肢を合わせた後の値合わせ（作り直さなかったときも呼ぶ。待っている間は呼ばない）
 */
export function syncOptions(select, choices, after = () => {}) {
  const key = JSON.stringify(choices);
  if (optionKeys.get(select) === key) {
    // 待っている作り直しがあれば取り消す（今の選択肢に戻った）
    waiting.delete(select);
    after(select);
    return;
  }
  renderWhenIdle(select, () => {
    optionKeys.set(select, key);
    select.replaceChildren(...choices.map(([value, label]) => {
      const node = el('option', '', label);
      node.value = value;
      return node;
    }));
    after(select);
  });
}

/**
 * store の記録が変わったら update で描き直す。返す update は、条件が変わったときにビューが直接呼ぶ。
 * 記録は画面用の変更番号（store.state.revision）で比べる。中身が同じ取得・自動の読み直しでは描き直さない。
 */
export function watchView(store, element, update, pickers = []) {
  let lastRevision = store.state.revision;
  let lastIndex = store.state.index;
  let lastEnv = store.state.env;
  let lastError = store.state.error;
  // 通信中というだけでカードを作り直すと、操作中のフォーカスを失う。
  const unsubscribe = store.subscribe((state) => {
    // 番号を持たない store（テストの偽物など）は、今までどおり index の参照で比べる
    const same = state.revision === undefined ? state.index === lastIndex : state.revision === lastRevision;
    if (same && state.env === lastEnv && state.error === lastError) return;
    lastRevision = state.revision;
    lastIndex = state.index;
    lastEnv = state.env;
    lastError = state.error;
    update(state);
  });
  update(store.state);
  return { element, update, destroy() { unsubscribe(); pickers.forEach((picker) => picker.destroy()); } };
}
