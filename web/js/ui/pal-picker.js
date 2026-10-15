import pals from '../../data/pals.js';
import { normalizeQuery } from '../core/kana.js';
import { searchPals } from '../core/pal-search.js';
import { el, button } from './dom.js';
import { icon } from './icons.js';
import { palTile, palsById } from './pal-icon.js';
import { createPopover, scrollWithin } from './popover.js';
import { focusInPlace } from './focus.js';

const activePals = pals.filter((pal) => pal.active);
// 番号（頭の 0 を外す）か和名・英名（ひらがな・カタカナ・大文字小文字をそろえる）に完全に一致したか
function isExact(pal, query) {
  const term = normalizeQuery(query);
  if (!term) return false;
  const number = /^\d/.test(term) ? term.replace(/^0+(?=\d)/, '') : term;
  return [String(pal.no), String(pal.label).toLowerCase()].includes(number)
    || [pal.ja, pal.en].some((name) => normalizeQuery(name) === term);
}

export function filterPals(query) {
  return searchPals(activePals, query).map(({ pal }) => pal);
}

// 選んでいる行の右の ✓（定義は ui/icons.js）
const checkMark = () => icon('check', { className: 'picker-check' });

/**
 * パルを 1 体選ぶ欄。押すと候補のポップオーバーを開き、名前・英名・番号・属性・パートナースキルで探せる。
 * describe（省略可）は開くたびと update のたびに呼ぶ関数で、候補の注記を返す:
 *   { order?: Map<palId, number>（小さい順に先へ。無いパルは後ろ）, badges?: Map<palId, string>（行の右の文字）,
 *     dim?: Set<palId>（薄い色の行）, orderLabel?: string（検索語が空のときの件数の行。order の並びの説明）,
 *     groups?: { has: Set<palId>, label: string, rest: string }（検索語が空のときだけ、has のパル → それ以外の 2 群に分けて見出しを付ける。F077） }
 * 検索語があるときは、一致の段階 → order → 図鑑順。↑↓で選んでいないときの Enter は何もしない（ユーザー指定）。
 * 完全に一致した行（番号・名前）か候補が 1 件の行には印（.is-suggested）だけを付け、矢印の位置は動かさない（Enter は矢印で選んだときだけ。F078）。
 * トリガーで文字を打つ・↓↑ を押すと開く（文字は検索欄に入れる）。検索欄の PageUp・PageDown は 10 行ずつ、Home・End は先頭・末尾の行へ
 *（検索語が空か、矢印で行を選んでいるとき。文字を打っている間は検索欄の中のカーソルを動かす）
 */
// triggerLabel: トリガーの読み上げの名前を固定する（ヘッダーのパル検索のように、選んだらすぐ空に戻す欄。省くと「ラベル: 選んでいるパル」）
export function palPicker({ label, value = '', onChange, popupHost, placeholder: initialPlaceholder = 'パルを選択', describe, triggerLabel = '', searchLabel = '' }) {
  let selected = value;
  let placeholder = initialPlaceholder;
  let annotate = describe;
  const wrapper = el('div', 'picker');
  const labelNode = el('span', 'field-label', label);
  const trigger = button('', () => open(), 'picker-trigger');
  // × は SVG のアイコン（ui/icons.js の close）。名前は aria-label
  const clear = button('', () => select(''), 'picker-clear');
  clear.append(icon('close', { className: 'close-icon' }));
  clear.setAttribute('aria-label', `${label}の選択を解除`);
  clear.title = `${label}の選択を解除`;
  const control = el('div', 'picker-control');
  const listId = `pals-${crypto.randomUUID()}`;
  trigger.setAttribute('aria-haspopup', 'listbox');
  // 閉じたトリガーで文字（1 文字・修飾キーなし・変換中でない）か ↓↑ を押すと開く。文字は検索欄に入れて絞る。
  // スペースと Enter はボタンの既定（押すと開く）のまま
  trigger.addEventListener('keydown', (event) => {
    if (popover.isOpen() || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    const typed = typeof event.key === 'string' && event.key.length === 1 && event.key !== ' ' && event.key !== '/' ? event.key : '';
    if (!typed && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    open({ query: typed });
  });
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
    trigger.setAttribute('aria-label', triggerLabel || `${label}: ${pal ? `No.${pal.label} ${pal.ja}` : placeholder}`);
    trigger.classList.toggle('has-selection', Boolean(pal));
    clear.hidden = !pal;
  }

  function select(id) {
    selected = id;
    popover.close();
    renderSelected();
    focusInPlace(trigger);
    onChange(id);
  }

  function open({ query = '' } = {}) {
    if (popover.isOpen()) return;
    const input = el('input', 'picker-search');
    input.type = 'search';
    input.placeholder = '名前・英名・番号で探す';
    input.setAttribute('aria-label', searchLabel || `${label}を検索`);
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
    if (query) input.value = query;
    renderOptions();
    // 開いたら、選んでいる行を一覧の真ん中に見せる（矢印の位置は -1 のまま。群の見出しの行は数えない）
    const index = view.choices.findIndex((choice) => choice.id === selected);
    if (index >= 0) scrollWithin(list, optionNodes()[index], { center: true });
    input.focus();
  }
  const optionNodes = () => view.list.querySelectorAll('[role="option"]');

  // 開いている候補の、選んでいる行の印（is-selected・✓・aria-selected）だけを今の値に合わせる（検索語・矢印の行・一覧の位置は触らない）
  function markSelected() {
    const { list, choices } = view;
    list.querySelectorAll('[role="option"]').forEach((node, index) => {
      const on = choices[index]?.id === selected;
      node.classList.toggle('is-selected', on);
      node.setAttribute('aria-selected', String(on));
      const check = Array.from(node.children).find((child) => child.getAttribute?.('class') === 'picker-check');
      if (on && !check) node.append(checkMark());
      if (!on && check) check.remove();
    });
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
    let choices = results.map(({ pal, note }) => ({ id: pal.id, note }));
    // 群（検索語が空のときだけ）: has のパル → それ以外。群の中の並びはそのまま
    const groups = !searching && info.groups?.has ? info.groups : null;
    let firstRest = -1;
    if (groups) {
      const inside = choices.filter((choice) => groups.has.has(choice.id));
      const rest = choices.filter((choice) => !groups.has.has(choice.id));
      choices = [...inside, ...rest];
      firstRest = inside.length;
      view.groupSizes = [inside.length, rest.length];
    }
    if (!searching) choices.unshift({ id: '', note: '' });
    view.choices = choices;
    view.position = keep === null ? -1 : choices.findIndex((choice) => choice.id === keep);
    // 印だけ（位置は動かさない）: 番号・名前に完全に一致した行か、候補が 1 件の行
    const exact = searching ? results.filter(({ pal }) => isExact(pal, query)).map(({ pal }) => pal.id) : [];
    const suggested = new Set(results.length === 1 ? [results[0].pal.id] : exact.length === 1 ? exact : []);
    status.textContent = searching ? `${results.length} 体のパル` : (info.order && info.orderLabel) || '図鑑順で表示';
    const nodes = choices.map((choice, index) => {
      const option = button('', () => select(choice.id), 'picker-option');
      // 押した瞬間に検索欄のフォーカスが外れると focusout で一覧が閉じ、click が届かない
      //（Safari はボタンにフォーカスを移さないため必ず起きる）。フォーカスを検索欄に残す。
      option.addEventListener('mousedown', (event) => event.preventDefault());
      option.id = `${listId}-${index}`;
      option.tabIndex = -1;
      option.setAttribute('role', 'option');
      // 候補の行は名前の右に属性のアイコン（game-assets。選んだ後の欄〔trigger〕には出さない）
      option.append(choice.id ? palTile(choice.id, { clickable: false, elements: true }) : el('span', '', 'パルを選択'));
      if (choice.note) option.append(el('span', 'picker-note', choice.note));
      const badge = choice.id ? info.badges?.get(choice.id) : '';
      if (badge) option.append(el('span', 'picker-badge', badge));
      if (choice.id && info.dim?.has(choice.id)) option.classList.add('is-dim');
      if (choice.id && suggested.has(choice.id)) option.classList.add('is-suggested');
      if (choice.id === selected) {
        option.classList.add('is-selected');
        option.append(checkMark());
      }
      return option;
    });
    if (groups) {
      // 見出しの行（選べない。読み上げは role=presentation の文字だけ）。解除の行（先頭）の次と、その他の群の頭に入れる
      const heading = (text) => {
        const node = el('div', 'picker-group', text);
        node.setAttribute('role', 'presentation');
        return node;
      };
      const [insideCount, restCount] = view.groupSizes;
      const offset = searching ? 0 : 1;
      if (restCount) nodes.splice(offset + firstRest, 0, heading(`${groups.rest}（${restCount}）`));
      if (insideCount) nodes.splice(offset, 0, heading(`${groups.label}（${insideCount}）`));
    }
    list.replaceChildren(...nodes);
    highlight();
  }

  function onKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); popover.close(); return; }
    const { choices } = view;
    // PageUp・PageDown は 10 行ずつ（端で止まる）、Home・End は先頭・末尾（検索語が空か、矢印で行を選んでいるときだけ）
    const jump = { PageDown: 10, PageUp: -10 }[event.key];
    const edge = (event.key === 'Home' || event.key === 'End') && (!view.input.value || view.position >= 0);
    if ((jump || edge) && choices.length) {
      event.preventDefault();
      if (edge) view.position = event.key === 'Home' ? 0 : choices.length - 1;
      else {
        const from = view.position >= 0 ? view.position : Math.max(0, choices.findIndex((choice) => choice.id === selected));
        view.position = Math.min(choices.length - 1, Math.max(0, from + jump));
      }
      highlight();
      return;
    }
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
    // 候補を開いたまま値が変わったとき（戻る・進む、同じ画面の URL の変更）は、開いた候補の選んでいる行の印も合わせる
    setValue(id) {
      selected = id;
      renderSelected();
      if (view) markSelected();
    },
    getValue() { return selected; },
    /** 候補を開く（ヘッダーのパル検索のショートカット「/」） */
    open: () => open(),
    /**
     * 注記を変える（describe を渡さなければ同じ関数で数え直す）。開いていれば、検索語と矢印の位置を保って候補を描き直す。
     * placeholder を渡すと、選んでいないときの文を変える
     */
    update({ describe: next, placeholder: text } = {}) {
      if (next !== undefined) annotate = next;
      if (text !== undefined && text !== placeholder) {
        placeholder = text;
        renderSelected();
      }
      if (!view) return;
      const keep = view.position >= 0 ? view.choices[view.position]?.id ?? null : null;
      view.info = annotate?.() ?? {};
      renderOptions({ keep });
    },
    destroy() { popover.destroy(); },
  };
}
