import pals from '../../data/pals.js';
import { palMatches, normalizeQuery } from '../core/kana.js';
import { el, button } from './dom.js';
import { palTile, palsById } from './pal-icon.js';
import { openDialog } from './dialog.js';

const activePals = pals.filter((pal) => pal.active);

export function filterPals(query, recent = []) {
  const normalized = normalizeQuery(query);
  const recentOrder = new Map(recent.map((id, index) => [id, index]));
  return activePals.filter((pal) => palMatches(pal, query)).sort((a, b) => {
    const exact = (pal) => normalized !== '' && [pal.no, pal.label].some((value) => normalizeQuery(value) === normalized);
    if (normalized) return Number(exact(b)) - Number(exact(a)) || a.no - b.no || Number(a.variant) - Number(b.variant);
    return (recentOrder.get(a.id) ?? Infinity) - (recentOrder.get(b.id) ?? Infinity) || a.no - b.no;
  });
}

export function palPicker({ label, value = '', onChange, storage, multiple = false }) {
  let selected = value;
  let closePopup;
  const wrapper = el('div', 'picker');
  const labelNode = el('span', 'field-label', label);
  const selectedCard = el('div', 'picker-value');
  const trigger = button('パルを選ぶ', () => open(), 'picker-trigger');
  const listId = `pals-${crypto.randomUUID()}`;
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', `${label}を選ぶ`);
  wrapper.append(labelNode, selectedCard, trigger);

  function recentIds() {
    try {
      const ids = JSON.parse(storage?.get('pal-note.recent') ?? '[]');
      return Array.isArray(ids) ? ids.filter((id) => palsById.get(id)?.active).slice(0, 8) : [];
    } catch { return []; }
  }

  function renderSelected() {
    selectedCard.replaceChildren();
    const pal = palsById.get(selected);
    trigger.textContent = pal && !multiple ? '選び直す' : 'パルを選ぶ';
    if (!pal) return;
    const clear = button('×', () => { selected = ''; renderSelected(); onChange(''); }, 'icon-button');
    clear.setAttribute('aria-label', `${label}の選択を解除`);
    selectedCard.append(palTile(selected, { clickable: false }), clear);
  }

  function select(id) {
    selected = multiple ? '' : id;
    storage?.set('pal-note.recent', JSON.stringify([id, ...recentIds().filter((other) => other !== id)].slice(0, 8)));
    closePopup?.();
    renderSelected();
    onChange(id);
  }

  function open() {
    if (closePopup) return;
    const mobile = matchMedia('(max-width: 767px)').matches;
    const popup = el('div', 'picker-popover');
    const input = el('input', 'picker-search');
    input.type = 'search';
    input.placeholder = '名前・図鑑番号で探す';
    input.setAttribute('aria-label', `${label}を検索`);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', listId);
    input.setAttribute('aria-expanded', 'true');
    input.autocomplete = 'off';
    const list = el('div', 'picker-options');
    list.id = listId;
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'パルの候補');
    const status = el('p', 'muted picker-status');
    status.setAttribute('aria-live', 'polite');
    popup.append(input, status, list);
    let choices = [];
    let position = -1;
    const controller = new AbortController();
    const cleanup = () => {
      controller.abort();
      popup.remove();
      closePopup = null;
      trigger.setAttribute('aria-expanded', 'false');
      if (trigger.isConnected) trigger.focus();
    };
    let modal;
    if (mobile) {
      modal = openDialog(`${label}を選ぶ`, { className: 'picker-sheet', onClose: cleanup });
      modal.body.append(popup);
    } else wrapper.append(popup);
    closePopup = mobile ? modal.close : cleanup;
    trigger.setAttribute('aria-expanded', 'true');

    function highlight() {
      const options = list.querySelectorAll('[role="option"]');
      options.forEach((node, index) => {
        node.classList.toggle('highlighted', index === position);
        node.setAttribute('aria-selected', String(choices[index].id === selected));
      });
      if (position >= 0) {
        input.setAttribute('aria-activedescendant', options[position].id);
        options[position].scrollIntoView({ block: 'nearest' });
      } else input.removeAttribute('aria-activedescendant');
    }

    function renderOptions() {
      const recent = recentIds();
      choices = filterPals(input.value, recent);
      position = -1;
      list.replaceChildren();
      status.textContent = input.value ? `${choices.length} 体のパル` : recent.length ? '最近使ったパル → 図鑑順' : '図鑑順で表示';
      choices.forEach((pal, index) => {
        const option = button('', () => select(pal.id), 'picker-option');
        // 押した瞬間に検索欄のフォーカスが外れると focusout で一覧が閉じ、click が届かない
        //（Safari はボタンにフォーカスを移さないため必ず起きる）。フォーカスを検索欄に残す。
        option.addEventListener('mousedown', (event) => event.preventDefault());
        option.id = `${listId}-${index}`;
        option.tabIndex = -1;
        option.setAttribute('role', 'option');
        option.append(palTile(pal.id, { clickable: false }));
        if (!input.value && recent.includes(pal.id)) option.append(el('small', 'recent-marker', '最近'));
        list.append(option);
      });
      highlight();
    }
    input.addEventListener('input', renderOptions);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePopup(); return; }
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        if (!choices.length) return;
        if (position < 0) position = event.key === 'ArrowDown' ? 0 : choices.length - 1;
        else position = (position + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
        highlight();
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        // 候補を矢印キーで選んでいなければ、絞り込み結果の先頭を選ぶ
        const choice = position >= 0 ? choices[position] : choices[0];
        if (choice) select(choice.id);
      }
    });
    if (!mobile) {
      document.addEventListener('pointerdown', (event) => { if (!wrapper.contains(event.target)) closePopup?.(); }, { signal: controller.signal });
      popup.addEventListener('focusout', () => {
        queueMicrotask(() => { if (closePopup && !wrapper.contains(document.activeElement)) closePopup(); });
      });
    }
    renderOptions();
    input.focus();
  }
  renderSelected();
  return {
    element: wrapper,
    setValue(id) { selected = id; renderSelected(); },
    getValue() { return selected; },
    destroy() { closePopup?.(); },
  };
}
