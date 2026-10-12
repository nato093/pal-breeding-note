import { el, empty } from '../ui/dom.js';
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

/** パル選択の値が違うときだけ合わせる（同じ値で描き直すと、選んだパルの画像が現れる動きがもう一度出る）。 */
export function syncPicker(picker, value) {
  if (picker && picker.getValue() !== value) picker.setValue(value);
}

/**
 * container の中を作り直す（render）。中にフォーカスがあって作り直しで外れたら、target(前の要素) が返す要素へ移す。
 * 画面を作り直さない遷移では、押したチップやパッシブの選択欄をビューが作り直すため、そのままでは body に落ちる。
 * （戻し方の一般化は keep-state の ui/focus.js で行う）
 */
export function keepFocus(container, render, target) {
  const doc = globalThis.document;
  const before = doc?.activeElement;
  const inside = Boolean(before) && before !== doc.body && container.contains(before);
  render();
  if (!inside) return;
  const now = doc.activeElement;
  if (now && now !== doc.body) return;
  target(before)?.focus();
}

export function renderCards(target, records, context, options) {
  target.replaceChildren();
  for (const record of records) target.append(breedingCard(record, context, options));
}

export function dataPending(target, state) {
  if (state.env) return false;
  target.replaceChildren(empty(state.error || '登録済みの配合を読み込んでいます…'));
  return true;
}

/** store の記録が変わったら update で描き直す。返す update は、条件が変わったときにビューが直接呼ぶ。 */
export function watchView(store, element, update, pickers = []) {
  let lastIndex = store.state.index;
  let lastEnv = store.state.env;
  let lastError = store.state.error;
  // 通信中というだけでカードを作り直すと、操作中のフォーカスを失う。
  const unsubscribe = store.subscribe((state) => {
    if (state.index === lastIndex && state.env === lastEnv && state.error === lastError) return;
    lastIndex = state.index;
    lastEnv = state.env;
    lastError = state.error;
    update(state);
  });
  update(store.state);
  return { element, update, destroy() { unsubscribe(); pickers.forEach((picker) => picker.destroy()); } };
}
