import pals from '../../data/pals.js';
import { normalizeQuery } from '../core/kana.js';
import { searchPals } from '../core/pal-search.js';
import { el, button } from './dom.js';
import { palTile, palsById } from './pal-icon.js';
import { createPopover, scrollWithin } from './popover.js';

const activePals = pals.filter((pal) => pal.active);

export function filterPals(query) {
  return searchPals(activePals, query).map(({ pal }) => pal);
}

const SVG = 'http://www.w3.org/2000/svg';
// 選んでいる行の右の ✓（HTML の文字列を使わずに描く）
function checkMark() {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'picker-check');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', 'M3 8.5 6.5 12 13 4.5');
  svg.append(path);
  return svg;
}

/**
 * パルを 1 体選ぶ欄。押すと候補のポップオーバーを開き、名前・英名・番号・属性・パートナースキルで探せる。
 * describe（省略可）は開くたびと update のたびに呼ぶ関数で、候補の注記を返す:
 *   { order?: Map<palId, number>（小さい順に先へ。無いパルは後ろ）, badges?: Map<palId, string>（行の右の文字）,
 *     dim?: Set<palId>（薄い色の行）, orderLabel?: string（検索語が空のときの件数の行。order の並びの説明） }
 * 検索語があるときは、一致の段階 → order → 図鑑順。↑↓で選んでいないときの Enter は何もしない（ユーザー指定）。
 */
export function palPicker({ label, value = '', onChange, popupHost, placeholder = 'パルを選択', describe }) {
  let selected = value;
  let annotate = describe;
  const wrapper = el('div', 'picker');
  const labelNode = el('span', 'field-label', label);
  const trigger = button('', () => open(), 'picker-trigger');
  const clear = button('×', () => select(''), 'picker-clear');
  clear.setAttribute('aria-label', `${label}の選択を解除`);
  clear.title = `${label}の選択を解除`;
  const control = el('div', 'picker-control');
  const listId = `pals-${crypto.randomUUID()}`;
  trigger.setAttribute('aria-haspopup', 'listbox');
  // 部品を作り直した後に、同じ役目の要素へフォーカスを戻す目印（ui/focus.js）。解除の × が消えたら選択欄へ
  trigger.setAttribute('data-focus-key', `picker:${label}`);
  clear.setAttribute('data-focus-key', `picker-clear:${label}`);
  clear.setAttribute('data-focus-fallback', `picker:${label}`);
  control.append(trigger, clear);
  wrapper.append(labelNode, control);

  // 開いている間の候補（描き直しのたびに入れ替える）
  let view = null;
  const popover = createPopover({
    anchor: trigger, wrapper, host: popupHost ?? null, focusOut: true,
    onClose: () => { view = null; },
  });

  function renderSelected() {
    const pal = palsById.get(selected);
    trigger.replaceChildren(pal ? palTile(selected, { clickable: false }) : el('span', '', placeholder));
    trigger.setAttribute('aria-label', `${label}: ${pal ? `No.${pal.label} ${pal.ja}` : placeholder}`);
    trigger.classList.toggle('has-selection', Boolean(pal));
    clear.hidden = !pal;
  }

  function select(id) {
    selected = id;
    popover.close();
    renderSelected();
    trigger.focus();
    onChange(id);
  }

  function open() {
    if (popover.isOpen()) return;
    const input = el('input', 'picker-search');
    input.type = 'search';
    input.placeholder = '名前・英名・番号で探す';
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
    popover.element.replaceChildren(input, status, list);
    view = { input, list, status, choices: [], position: -1, info: annotate?.() ?? {} };
    popover.open();
    input.addEventListener('input', () => renderOptions());
    input.addEventListener('keydown', onKey);
    renderOptions();
    // 開いたら、選んでいる行を一覧の真ん中に見せる（矢印の位置は -1 のまま）
    const index = view.choices.findIndex((choice) => choice.id === selected);
    if (index >= 0) scrollWithin(list, list.children[index], { center: true });
    input.focus();
  }

  function highlight() {
    const { input, list, choices, position } = view;
    const options = list.querySelectorAll('[role="option"]');
    options.forEach((node, index) => {
      node.classList.toggle('highlighted', index === position);
      node.setAttribute('aria-selected', String(choices[index].id === selected));
    });
    if (position >= 0) {
      input.setAttribute('aria-activedescendant', options[position].id);
      scrollWithin(list, options[position]);
    } else input.removeAttribute('aria-activedescendant');
  }

  // keep: 描き直す前に矢印で選んでいた候補（id）。同じ候補があれば、その位置に矢印を残す
  function renderOptions({ keep = null } = {}) {
    const { input, list, status, info } = view;
    const query = input.value;
    const searching = Boolean(normalizeQuery(query));
    const results = searchPals(activePals, query);
    if (info.order) {
      const rank = ({ pal }) => info.order.get(pal.id) ?? Infinity;
      // 並べ替えは安定なので、同じ順位の中は一致の段階と図鑑順のまま
      results.sort((a, b) => a.tier - b.tier || rank(a) - rank(b));
    }
    const choices = results.map(({ pal, note }) => ({ id: pal.id, note }));
    if (!searching) choices.unshift({ id: '', note: '' });
    view.choices = choices;
    view.position = keep === null ? -1 : choices.findIndex((choice) => choice.id === keep);
    status.textContent = searching ? `${results.length} 体のパル` : (info.order && info.orderLabel) || '図鑑順で表示';
    list.replaceChildren(...choices.map((choice, index) => {
      const option = button('', () => select(choice.id), 'picker-option');
      // 押した瞬間に検索欄のフォーカスが外れると focusout で一覧が閉じ、click が届かない
      //（Safari はボタンにフォーカスを移さないため必ず起きる）。フォーカスを検索欄に残す。
      option.addEventListener('mousedown', (event) => event.preventDefault());
      option.id = `${listId}-${index}`;
      option.tabIndex = -1;
      option.setAttribute('role', 'option');
      option.append(choice.id ? palTile(choice.id, { clickable: false }) : el('span', '', 'パルを選択'));
      if (choice.note) option.append(el('span', 'picker-note', choice.note));
      const badge = choice.id ? info.badges?.get(choice.id) : '';
      if (badge) option.append(el('span', 'picker-badge', badge));
      if (choice.id && info.dim?.has(choice.id)) option.classList.add('is-dim');
      if (choice.id === selected) {
        option.classList.add('is-selected');
        option.append(checkMark());
      }
      return option;
    }));
    highlight();
  }

  function onKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); popover.close(); return; }
    const { choices } = view;
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      if (!choices.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      // 矢印で選んでいないときは、選んでいる行の次（↑ は前）から動き始める
      const from = view.position >= 0 ? view.position : choices.findIndex((choice) => choice.id === selected);
      if (from < 0) view.position = step > 0 ? 0 : choices.length - 1;
      else view.position = (from + step + choices.length) % choices.length;
      highlight();
    }
    // 矢印キーで候補を選んでいないときの Enter は何もしない（ユーザー指定）
    if (event.key === 'Enter') { event.preventDefault(); if (view.position >= 0) select(choices[view.position].id); }
  }

  renderSelected();
  return {
    element: wrapper,
    setValue(id) { selected = id; renderSelected(); },
    getValue() { return selected; },
    /** 注記を変える（describe を渡さなければ同じ関数で数え直す）。開いていれば、検索語と矢印の位置を保って候補を描き直す */
    update({ describe: next } = {}) {
      if (next !== undefined) annotate = next;
      if (!view) return;
      const keep = view.position >= 0 ? view.choices[view.position]?.id ?? null : null;
      view.info = annotate?.() ?? {};
      renderOptions({ keep });
    },
    destroy() { popover.destroy(); },
  };
}
