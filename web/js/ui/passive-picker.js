import passives from '../../data/passives.js';
import { normalizeQuery, queryTerms } from '../core/kana.js';
import { el, button, syncList } from './dom.js';
import { createPopover, scrollWithin } from './popover.js';

export const passivesById = new Map(passives.map((passive) => [passive.id, passive]));
// マスターの並び（ランクの高い順。同じランクの中は ID 順）
const masterOrder = new Map(passives.map((passive, index) => [passive.id, index]));

// ゲームと同じ見た目にする: 暗い帯に名前、右にランクの矢印（矢印の画像はゲームから取り出したもの。色は CSS で付ける）
const rankClass = (rank) => (rank > 0 ? `passive-rank-${Math.min(rank, 5)}` : rank < 0 ? `passive-rank-m${Math.min(-rank, 3)}` : 'passive-rank-0');

/**
 * パッシブの表示（ランクで矢印と色が変わる）。マスターにないものは内部名で出す。
 * compact: 小さいチップ（文の中・候補の行・登録した組み合わせ）。
 * focusGroup: × のフォーカスの目印（ui/focus.js。'passive:<ラベル>'）。× が消えたら同じ名前の追加欄へ、追加欄が押せなければ残った × の最後へ。
 * × の key は 'passive-chip:<ラベル>:<id>'（部品ごとに分ける。作り直した後に、別の画面の同じパッシブの × へ移らないように）
 */
export function passiveChip(id, { onRemove, focusGroup = '', compact = false } = {}) {
  const passive = passivesById.get(id);
  const rank = passive?.rank ?? 0;
  const chip = el('span', `passive-chip ${rankClass(rank)}${compact ? ' compact' : ''}`);
  chip.append(el('span', 'passive-name', passive?.ja ?? id));
  if (rank) {
    const icon = el('span', 'passive-rank');
    icon.setAttribute('aria-hidden', 'true');
    chip.append(icon);
  }
  chip.title = [passive?.ja ?? id, rank ? `ランク ${rank}` : '', passive?.desc ?? ''].filter(Boolean).join('\n');
  if (onRemove) {
    const remove = button('×', onRemove, 'passive-remove');
    remove.setAttribute('aria-label', `${passive?.ja ?? id} を外す`);
    if (focusGroup) {
      remove.setAttribute('data-focus-key', `passive-chip:${focusGroup.replace(/^passive:/, '')}:${id}`);
      remove.setAttribute('data-focus-fallback', focusGroup);
      remove.setAttribute('data-focus-group', focusGroup);
    }
    chip.append(remove);
  }
  return chip;
}

export function passiveList(ids, { compact = false } = {}) {
  const wrapper = el('span', `passive-list${compact ? ' compact' : ''}`);
  for (const id of ids) wrapper.append(passiveChip(id, { compact }));
  return wrapper;
}

const rankOf = (id) => passivesById.get(id)?.rank ?? 0;
const compareItems = (a, b) => b.count - a.count || rankOf(b.id) - rankOf(a.id)
  || (masterOrder.get(a.id) ?? Infinity) - (masterOrder.get(b.id) ?? Infinity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * 候補の群（DOM なし）。groups の順に、所持数のあるパッシブをその群へ（同じパッシブは最初の群だけ）、
 * 所持数のない std のパッシブは「その他」へ。negatives が 'last' なら、ランクが負のものを最後の群「マイナスのパッシブ」へ。
 * マスターに無い内部名も、所持数があれば群に入れる。選んでいるものは出さない。群の中は所持数 → ランク → マスターの順。
 * @returns {{ label: string, items: { id: string, count: number }[] }[]} 空の群は除く
 */
export function passiveGroups({ selected = [], counts = new Map(), countLabel = '所持パルが持っているもの', groups, negatives = 'inline' } = {}) {
  const sources = groups ?? [{ label: countLabel, counts }];
  const placed = new Set(selected);
  const result = sources.map(({ label }) => ({ label, items: [] }));
  const others = { label: 'その他', items: [] };
  const minus = negatives === 'last' ? { label: 'マイナスのパッシブ', items: [] } : null;
  sources.forEach((source, index) => {
    for (const [id, count] of source.counts ?? []) {
      if (!count || placed.has(id)) continue;
      placed.add(id);
      (minus && rankOf(id) < 0 ? minus : result[index]).items.push({ id, count });
    }
  });
  for (const passive of passives) {
    if (placed.has(passive.id) || !passive.std) continue;
    (minus && passive.rank < 0 ? minus : others).items.push({ id: passive.id, count: 0 });
  }
  return [...result, others, ...(minus ? [minus] : [])]
    .map((group) => ({ ...group, items: group.items.sort(compareItems) }))
    .filter((group) => group.items.length);
}

// 探す文字列（和名・英名・効果・内部名）。パッシブは約 120 件なので、そろえた結果を覚えておく
const searchTexts = new Map();
function textsOf(id) {
  let texts = searchTexts.get(id);
  if (!texts) {
    const passive = passivesById.get(id);
    texts = [passive?.ja, passive?.en, passive?.desc, id].filter(Boolean).map(normalizeQuery);
    searchTexts.set(id, texts);
  }
  return texts;
}
/** 語（空白区切り）がすべて、和名・英名・効果・内部名のどれかに含まれるか */
export function passiveMatches(id, terms) {
  const texts = textsOf(id);
  return terms.every((term) => texts.some((text) => text.includes(term)));
}

/**
 * パッシブを最大 max 個まで選ぶ 1 行の部品（[パッシブを追加… ▾] ＋ 選んだチップ）。押すとポップオーバーで名前・効果を検索して選ぶ。
 * 候補を押すと、その場で onChange([...selected, id]) を呼ぶ（未確定の状態を持たない）。ポップオーバーは閉じない。
 * 呼び出し側は作り直さず update を呼ぶ（開いていれば、検索語・入力のフォーカス・矢印の位置を保って候補だけ描き直す）。
 * groups: 候補の群 [{ label, counts: Map<id, n> }]。無ければ counts から「countLabel」の群と「その他」。
 * negatives: 'last'（負のパッシブを最後の群「マイナスのパッシブ」に。理想個体・継承ルート）| 'inline'（所持パル）
 * presets: [{ label, passives }]（登録した組み合わせ。押すと選択をその組で置き換える）
 */
export function passiveSelector({ label, selected = [], counts = new Map(), countLabel = '所持パルが持っているもの', groups,
  negatives = 'inline', presets = [], onChange, max = 4 }) {
  const state = { selected: [...selected], counts, groups, presets };
  const focusGroup = `passive:${label}`;
  const element = el('div', 'field passive-selector');
  const row = el('div', 'passive-row');
  const add = button('', () => (popover.isOpen() ? popover.close() : open()), 'passive-add');
  add.setAttribute('aria-label', `${label}を追加`);
  add.setAttribute('aria-haspopup', 'listbox');
  add.setAttribute('data-focus-key', focusGroup);
  // 閉じたボタンで ↓ を押したら開く（選ばない。native の select のように 1 個ずつ足されることはない）
  add.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' || popover.isOpen()) return;
    event.preventDefault();
    open();
  });
  const chips = el('div', 'passive-chips');
  row.append(add, chips);
  element.append(el('span', 'field-label', label), row);
  const listId = `passives-${crypto.randomUUID()}`;
  let view = null;
  const popover = createPopover({ anchor: add, wrapper: element, className: 'picker-popover passive-popover', focusOut: true, onClose: () => { view = null; } });

  const focusIn = () => {
    const active = document.activeElement;
    return Boolean(active) && (element.contains(active) || popover.element.contains(active));
  };

  function renderButton() {
    const full = state.selected.length >= max;
    add.textContent = full ? `最大 ${max} 個まで` : 'パッシブを追加…';
    add.disabled = full;
  }

  function renderChips() {
    syncList(chips, state.selected, {
      key: (id) => id,
      // × で外すと、押せるようになった追加欄へ（data-focus の付いた部品がないので fallbackFocus）
      create: (id) => ({ element: passiveChip(id, { onRemove: () => onChange(state.selected.filter((item) => item !== id)), focusGroup }) }),
      fallbackFocus: add,
    });
  }

  function open() {
    if (popover.isOpen() || state.selected.length >= max) return;
    const presetBox = el('div', 'passive-presets');
    const input = el('input', 'picker-search');
    input.type = 'search';
    input.placeholder = '名前・効果で探す';
    input.setAttribute('aria-label', `${label}を検索`);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', listId);
    input.setAttribute('aria-expanded', 'true');
    input.autocomplete = 'off';
    const status = el('p', 'muted picker-status');
    status.setAttribute('aria-live', 'polite');
    const list = el('div', 'picker-options passive-options');
    list.id = listId;
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'パッシブの候補');
    popover.element.replaceChildren(presetBox, input, status, list);
    view = { input, status, list, presetBox, presetKey: null, options: [], position: -1, resume: -1 };
    popover.open();
    input.addEventListener('input', () => { view.resume = -1; renderOptions(); });
    input.addEventListener('keydown', onKey);
    renderPresets();
    renderOptions();
    input.focus();
  }

  // 登録した組み合わせ（並びが変わったときだけ作り直す。押したボタンのフォーカスを失わないように）
  function renderPresets() {
    const key = JSON.stringify(state.presets.map((preset) => [preset.label, preset.passives]));
    if (key === view.presetKey) return;
    view.presetKey = key;
    const { presetBox } = view;
    presetBox.hidden = !state.presets.length;
    if (!state.presets.length) { presetBox.replaceChildren(); return; }
    const rows = state.presets.map((preset) => {
      const ids = preset.passives.slice(0, max);
      const names = ids.map((id) => passivesById.get(id)?.ja ?? id).join('、');
      const node = button('', () => onChange(ids), 'passive-preset');
      node.setAttribute('aria-label', `登録した組み合わせ「${preset.label}」で選び直す: ${names}`);
      node.title = preset.label;
      node.addEventListener('mousedown', (event) => event.preventDefault());
      node.append(passiveList(ids, { compact: true }));
      return node;
    });
    presetBox.replaceChildren(el('p', 'passive-group-label', '登録した組み合わせ'), ...rows);
  }

  function renderOptions({ keep = null } = {}) {
    const { input, status, list } = view;
    const terms = queryTerms(input.value);
    const found = passiveGroups({ selected: state.selected, counts: state.counts, countLabel, groups: state.groups, negatives })
      .map((group) => ({ ...group, items: terms.length ? group.items.filter((item) => passiveMatches(item.id, terms)) : group.items }))
      .filter((group) => group.items.length);
    const options = [];
    const nodes = [];
    for (const group of found) {
      const heading = el('p', 'passive-group-label', group.label);
      heading.setAttribute('role', 'presentation');
      nodes.push(heading);
      for (const item of group.items) {
        const option = button('', () => choose(item.id), 'picker-option passive-option');
        // 押した瞬間に検索欄のフォーカスが外れると focusout で閉じ、click が届かない（pal-picker と同じ理由）
        option.addEventListener('mousedown', (event) => event.preventDefault());
        option.id = `${listId}-${options.length}`;
        option.tabIndex = -1;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', 'false');
        option.setAttribute('data-value', item.id);
        option.append(passiveChip(item.id, { compact: true }), el('span', 'passive-option-desc', passivesById.get(item.id)?.desc ?? ''));
        if (item.count) option.append(el('span', 'passive-option-count', `${item.count} 体`));
        options.push({ id: item.id, node: option });
        nodes.push(option);
      }
    }
    list.replaceChildren(...nodes);
    if (!options.length) list.append(el('p', 'muted passive-empty', '当てはまるパッシブがありません。'));
    view.options = options;
    view.position = keep === null ? -1 : options.findIndex((option) => option.id === keep);
    const rest = max - state.selected.length;
    status.textContent = `${options.length} 件のパッシブ · あと ${rest} 個まで選べます`;
    highlight();
  }

  function highlight() {
    const { input, list, options, position } = view;
    options.forEach(({ node }, index) => node.classList.toggle('highlighted', index === position));
    if (position >= 0) {
      input.setAttribute('aria-activedescendant', options[position].node.id);
      scrollWithin(list, options[position].node);
    } else input.removeAttribute('aria-activedescendant');
  }

  function choose(id) {
    // 矢印で選んで決めたときは、次の ↓ で同じ位置（選んだものが抜けて繰り上がった次の候補）から動けるようにする
    if (view) view.resume = view.options.findIndex((option) => option.id === id);
    onChange([...state.selected, id]);
  }

  function onKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); popover.close(); return; }
    const { options } = view;
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      if (!options.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      if (view.position >= 0) view.position = (view.position + step + options.length) % options.length;
      else if (view.resume >= 0) view.position = Math.min(options.length - 1, Math.max(0, step > 0 ? view.resume : view.resume - 1));
      else view.position = step > 0 ? 0 : options.length - 1;
      view.resume = -1;
      highlight();
    }
    // 矢印キーで候補を選んでいないときの Enter は何もしない（パル選択と同じ決まり）
    if (event.key === 'Enter') { event.preventDefault(); if (view.position >= 0) choose(options[view.position].id); }
  }

  renderButton();
  renderChips();
  return {
    element,
    /**
     * 選んだパッシブ・所持数・群・登録した組み合わせを合わせ直す（同じ id のチップは使い回す）。開いていれば候補だけ描き直し、閉じない。
     * max に達したら閉じて、最後のチップの × へフォーカスを移す（フォーカスがこの部品の中にあったときだけ）
     */
    update(next = {}) {
      for (const key of ['selected', 'counts', 'groups', 'presets']) if (key in next) state[key] = next[key];
      state.selected = [...state.selected];
      const focused = focusIn();
      renderButton();
      renderChips();
      if (state.selected.length >= max) {
        popover.close({ focus: false });
        if (focused) chips.lastElementChild?.querySelector('.passive-remove')?.focus();
        return;
      }
      if (!view) return;
      const keep = view.position >= 0 ? view.options[view.position]?.id ?? null : null;
      renderPresets();
      renderOptions({ keep });
    },
    destroy() { popover.destroy(); },
  };
}
