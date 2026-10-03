import { el, button, empty } from '../ui/dom.js';
import { breedingCard } from '../ui/breeding-card.js';
import { shareLink, buildHash } from '../router.js';
import { palsById } from '../ui/pal-icon.js';
import { toast } from '../ui/toast.js';

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = el('textarea', 'clipboard-fallback');
    input.value = text;
    input.setAttribute('readonly', '');
    document.body.append(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    if (!copied) throw new Error('コピーできませんでした。ブラウザの共有機能をご利用ください。');
  }
  toast('リンクをコピーしました');
}

export function viewHeading(title, subtitle, { share = true } = {}) {
  const header = el('header', 'view-heading');
  const text = el('div');
  text.append(el('p', 'eyebrow', '仲間とつくる、配合の記録'), el('h1', '', title), el('p', 'muted', subtitle));
  header.append(text);
  if (share) header.append(button('↗ 共有', async () => {
    try { await copyText(shareLink(location.href)); } catch (error) { toast(error.message); }
  }, 'button secondary share-button'));
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

export function navigateSelection(context, route, key, value) {
  const params = new URLSearchParams(route.params);
  if (value) params.set(key, value);
  else params.delete(key);
  context.navigate(buildHash(route.view, params, route.id));
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

export function watchView(store, element, update, pickers = []) {
  let lastIndex = store.state.index;
  let lastEnv = store.state.env;
  let lastError = store.state.error;
  // 通信中というだけでカードを作り直すと、操作中のメニューやフォーカスを失う。
  const unsubscribe = store.subscribe((state) => {
    if (state.index === lastIndex && state.env === lastEnv && state.error === lastError) return;
    lastIndex = state.index;
    lastEnv = state.env;
    lastError = state.error;
    update(state);
  });
  update(store.state);
  return { element, destroy() { unsubscribe(); pickers.forEach((picker) => picker.destroy()); } };
}
