// 選択肢が多いときだけ検索欄つきになる選択（所持パルの所持者。フェーズ 2 の登録者の選択でも使う）。
import { el, button } from './dom.js';
import { createPopover, scrollWithin } from './popover.js';
import { normalizeQuery, queryTerms } from '../core/kana.js';

let sequence = 0;

/**
 * 選択肢が threshold（既定 12）を超えたら、検索欄つきのポップオーバーで選ぶ select の代わり。以下なら普通の select を出す。
 * 検索は core/kana.js の normalizeQuery でそろえた部分一致（空白で区切ると、すべてを含むもの）。候補の Enter は矢印で選んだときだけ
 * （パル選択と同じ決まり）。Esc で閉じてボタンへ戻る。
 * @param {{ label: string, options: [string, string][], value: string, onChange: (value: string) => void, threshold?: number }} options
 *   options は [value, label] の並び
 * @returns {{ element: HTMLElement, update(next: { options?: [string, string][], value?: string }): void, destroy(): void }}
 *   element は div.search-select（中は select〔aria-label＝label〕か、button.search-select-trigger とポップオーバー）。
 *   update は外からの反映（onChange は呼ばない）。選択肢が前と同じなら作り直さない。件数が閾値をまたぐと中身を入れ替えるので、
 *   選んでいる途中（フォーカス中）に作り直さないのは呼び出し側で待つ（views/shared.js の renderWhenIdle）。
 *   知らない値のときは、ボタンに先頭の選択肢の名前を出す（select はどれも選ばない）
 */
export function searchSelect({ label, options, value = '', onChange, threshold = 12 }) {
  const element = el('div', 'search-select');
  const state = { options: [], value, key: null, mode: '' };
  let destroyed = false;
  let view = null;

  const select = el('select');
  select.setAttribute('aria-label', label);
  select.addEventListener('change', () => {
    if (destroyed) return;
    state.value = select.value;
    onChange(select.value);
  });

  const trigger = button('', () => (popover.isOpen() ? popover.close() : open()), 'search-select-trigger');
  trigger.setAttribute('aria-haspopup', 'listbox');
  // 閉じたボタンで ↓ を押したら開く（選ばない）
  trigger.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' || popover.isOpen()) return;
    event.preventDefault();
    open();
  });
  const listId = `search-select-${++sequence}`;
  const popover = createPopover({
    anchor: trigger, wrapper: element, className: 'picker-popover search-select-popover', focusOut: true, onClose: () => { view = null; },
  });

  const optionText = (key) => (state.options.find(([item]) => item === key) ?? state.options[0])?.[1] ?? '';

  function showValue() {
    if (state.mode === 'select') {
      select.value = state.value;
      return;
    }
    const text = optionText(state.value);
    if (trigger.textContent !== text) trigger.textContent = text;
    trigger.setAttribute('aria-label', `${label}: ${text}`);
  }

  function render() {
    const mode = state.options.length > threshold ? 'search' : 'select';
    if (mode !== state.mode) {
      popover.close({ focus: false });
      element.replaceChildren(mode === 'select' ? select : trigger);
      state.mode = mode;
    }
    if (mode === 'select') {
      select.replaceChildren(...state.options.map(([item, text]) => {
        const node = el('option', '', text);
        node.value = item;
        return node;
      }));
    } else if (view) renderOptions();
    showValue();
  }

  function setOptions(next) {
    const key = JSON.stringify(next);
    if (key === state.key) return false;
    state.key = key;
    state.options = next.map(([item, text]) => [String(item), String(text)]);
    return true;
  }

  function open() {
    if (popover.isOpen() || destroyed) return;
    const input = el('input', 'picker-search');
    input.type = 'search';
    input.placeholder = '名前で探す';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', `${label}を検索`);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', listId);
    input.setAttribute('aria-expanded', 'true');
    const status = el('p', 'muted picker-status');
    status.setAttribute('aria-live', 'polite');
    const list = el('div', 'picker-options search-select-options');
    list.id = listId;
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', label);
    popover.element.replaceChildren(input, status, list);
    view = { input, status, list, items: [], position: -1 };
    popover.open();
    input.addEventListener('input', () => renderOptions());
    input.addEventListener('keydown', onKey);
    renderOptions();
    // 選んでいるものを一覧の真ん中に
    const selected = view.items.find((item) => item.key === state.value);
    if (selected) scrollWithin(list, selected.node, { center: true });
    input.focus();
  }

  function renderOptions() {
    const { input, status, list } = view;
    const terms = queryTerms(input.value);
    const found = state.options.filter(([, text]) => {
      const normalized = normalizeQuery(text);
      return terms.every((term) => normalized.includes(term));
    });
    view.items = found.map(([key, text], index) => {
      const node = button(text, () => choose(key), 'picker-option search-select-option');
      // 押した瞬間に検索欄のフォーカスが外れると focusout で閉じ、click が届かない（pal-picker と同じ理由）
      node.addEventListener('mousedown', (event) => event.preventDefault());
      node.id = `${listId}-${index}`;
      node.tabIndex = -1;
      node.setAttribute('role', 'option');
      node.setAttribute('data-value', key);
      node.setAttribute('aria-selected', String(key === state.value));
      node.classList.toggle('is-selected', key === state.value);
      return { key, node };
    });
    list.replaceChildren(...view.items.map((item) => item.node));
    status.textContent = found.length ? `${found.length} 件` : '当てはまる候補がありません。';
    view.position = -1;
    highlight();
  }

  function highlight() {
    const { input, list, items, position } = view;
    items.forEach(({ node }, index) => node.classList.toggle('highlighted', index === position));
    if (position >= 0) {
      input.setAttribute('aria-activedescendant', items[position].node.id);
      scrollWithin(list, items[position].node);
    } else input.removeAttribute('aria-activedescendant');
  }

  function choose(key) {
    popover.close();
    if (destroyed || key === state.value) return;
    state.value = key;
    showValue();
    onChange(key);
  }

  function onKey(event) {
    // 日本語の変換中のキー（変換の確定の Enter・候補を選ぶ矢印・取り消しの Esc）は変換のためのもので、候補の操作に使わない
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation?.();
      popover.close();
      return;
    }
    const { items } = view;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!items.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      view.position = view.position >= 0 ? (view.position + step + items.length) % items.length : step > 0 ? 0 : items.length - 1;
      highlight();
      return;
    }
    // 矢印キーで候補を選んでいないときの Enter は何もしない
    if (event.key === 'Enter') {
      event.preventDefault();
      if (view.position >= 0) choose(items[view.position].key);
    }
  }

  setOptions(options);
  render();
  return {
    element,
    update(next = {}) {
      if ('value' in next) state.value = String(next.value ?? '');
      if (next.options && setOptions(next.options)) render();
      else showValue();
    },
    destroy() {
      destroyed = true;
      popover.destroy();
    },
  };
}
