import pals from '../../data/pals.js';
import { palMatches, normalizeQuery } from '../core/kana.js';
import { el, button } from './dom.js';
import { palTile, palsById } from './pal-icon.js';

const activePals = pals.filter((pal) => pal.active);

export function filterPals(query) {
  const normalized = normalizeQuery(query);
  return activePals.filter((pal) => palMatches(pal, query)).sort((a, b) => {
    const exact = (pal) => normalized !== '' && [pal.no, pal.label].some((value) => normalizeQuery(value) === normalized);
    return Number(exact(b)) - Number(exact(a)) || a.no - b.no || Number(a.variant) - Number(b.variant);
  });
}

export function palPicker({ label, value = '', onChange, popupHost }) {
  let selected = value;
  let closePopup;
  const wrapper = el('div', 'picker');
  const labelNode = el('span', 'field-label', label);
  const trigger = button('', () => open(), 'picker-trigger');
  const clear = button('×', () => select(''), 'picker-clear');
  clear.setAttribute('aria-label', `${label}の選択を解除`);
  clear.title = `${label}の選択を解除`;
  const control = el('div', 'picker-control');
  const listId = `pals-${crypto.randomUUID()}`;
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  control.append(trigger, clear);
  wrapper.append(labelNode, control);

  function renderSelected() {
    const pal = palsById.get(selected);
    trigger.replaceChildren(pal ? palTile(selected, { clickable: false }) : el('span', '', 'パルを選択'));
    trigger.setAttribute('aria-label', `${label}: ${pal ? `No.${pal.label} ${pal.ja}` : 'パルを選択'}`);
    trigger.classList.toggle('has-selection', Boolean(pal));
    clear.hidden = !pal;
  }

  function select(id) {
    selected = id;
    closePopup?.();
    renderSelected();
    trigger.focus();
    onChange(id);
  }

  function open() {
    if (closePopup) return;
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
    (popupHost ?? wrapper).append(popup);
    closePopup = cleanup;
    trigger.setAttribute('aria-expanded', 'true');

    const contains = (node) => wrapper.contains(node) || popup.contains(node);

    if (popupHost) {
      // 本文のスクロール領域から外し、候補が縦方向に切れないようにする。
      popup.classList.add('picker-popover-floating');
      const rect = trigger.getBoundingClientRect();
      const dialogRect = popupHost.tagName.toLowerCase() === 'dialog' ? popupHost.getBoundingClientRect() : null;
      const minLeft = Math.max(12, dialogRect?.left ?? 12);
      const maxRight = Math.min(window.innerWidth - 12, dialogRect ? dialogRect.left + dialogRect.width : window.innerWidth - 12);
      const width = Math.min(Math.max(320, rect.width), maxRight - minLeft);
      let left = rect.left;
      if (dialogRect && left + width > maxRight) left = rect.left + rect.width - width;
      left = Math.max(minLeft, Math.min(left, maxRight - width));
      const below = Math.max(0, window.innerHeight - rect.bottom - 16);
      const above = Math.max(0, rect.top - 16);
      const upwards = below < 200 && above > below;
      popup.style.setProperty('--picker-left', `${left}px`);
      popup.style.setProperty('--picker-width', `${width}px`);
      popup.style.setProperty('--picker-max-height', `${Math.min(400, upwards ? above : below)}px`);
      popup.style.setProperty(upwards ? '--picker-bottom' : '--picker-top', `${upwards ? window.innerHeight - rect.top + 4 : rect.bottom + 4}px`);
      document.addEventListener('scroll', (event) => {
        if (!popup.contains(event.target)) cleanup();
      }, { capture: true, signal: controller.signal });
      window.addEventListener('resize', cleanup, { signal: controller.signal });
      popupHost.addEventListener('cancel', (event) => { event.preventDefault(); cleanup(); }, { signal: controller.signal });
    }

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
      choices = filterPals(input.value);
      if (!normalizeQuery(input.value)) choices.unshift({ id: '' });
      position = -1;
      list.replaceChildren();
      status.textContent = input.value ? `${choices.length} 体のパル` : '図鑑順で表示';
      choices.forEach((pal, index) => {
        const option = button('', () => select(pal.id), 'picker-option');
        // 押した瞬間に検索欄のフォーカスが外れると focusout で一覧が閉じ、click が届かない
        //（Safari はボタンにフォーカスを移さないため必ず起きる）。フォーカスを検索欄に残す。
        option.addEventListener('mousedown', (event) => event.preventDefault());
        option.id = `${listId}-${index}`;
        option.tabIndex = -1;
        option.setAttribute('role', 'option');
        option.append(pal.id ? palTile(pal.id, { clickable: false }) : el('span', '', 'パルを選択'));
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
      // 矢印キーで候補を選んでいないときの Enter は何もしない（ユーザー指定）
      if (event.key === 'Enter') { event.preventDefault(); if (position >= 0) select(choices[position].id); }
    });
    document.addEventListener('pointerdown', (event) => { if (!contains(event.target)) closePopup?.(); }, { signal: controller.signal });
    popup.addEventListener('focusout', () => {
      queueMicrotask(() => { if (closePopup && !contains(document.activeElement)) closePopup(); });
    });
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
