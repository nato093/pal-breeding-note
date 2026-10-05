import passives from '../../data/passives.js';
import { el, button } from './dom.js';

export const passivesById = new Map(passives.map((passive) => [passive.id, passive]));

// ゲームと同じ見た目にする: 暗い帯に名前、右にランクの矢印（矢印の画像はゲームから取り出したもの。色は CSS で付ける）
const rankClass = (rank) => (rank > 0 ? `passive-rank-${Math.min(rank, 5)}` : rank < 0 ? `passive-rank-m${Math.min(-rank, 3)}` : 'passive-rank-0');

/** パッシブの表示（ランクで矢印と色が変わる）。マスターにないものは内部名で出す。 */
export function passiveChip(id, { onRemove } = {}) {
  const passive = passivesById.get(id);
  const rank = passive?.rank ?? 0;
  const chip = el('span', `passive-chip ${rankClass(rank)}`);
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
    chip.append(remove);
  }
  return chip;
}

export function passiveList(ids) {
  const wrapper = el('span', 'passive-list');
  for (const id of ids) wrapper.append(passiveChip(id));
  return wrapper;
}

/**
 * パッシブを最大 max 個まで選ぶ欄。counts（id → 所持数）にあるものを先に、所持数つきで出す。
 * @param {{ label: string, selected: string[], counts?: Map<string, number>, onChange: (ids: string[]) => void, max?: number }} options
 */
export function passiveSelector({ label, selected, counts = new Map(), onChange, max = 4 }) {
  const wrapper = el('div', 'field passive-selector');
  wrapper.append(el('span', 'field-label', label));
  const chips = el('div', 'passive-list');
  for (const id of selected) chips.append(passiveChip(id, { onRemove: () => onChange(selected.filter((item) => item !== id)) }));
  const select = el('select', 'passive-add');
  select.setAttribute('aria-label', `${label}を追加`);
  const placeholder = el('option', '', selected.length >= max ? `最大 ${max} 個まで` : 'パッシブを追加…');
  placeholder.value = '';
  select.append(placeholder);
  const owned = el('optgroup');
  owned.setAttribute('label', '所持パルが持っているもの');
  const others = el('optgroup');
  others.setAttribute('label', 'その他');
  const ordered = [...passives].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || b.rank - a.rank);
  for (const passive of ordered) {
    if (selected.includes(passive.id)) continue;
    const count = counts.get(passive.id) ?? 0;
    if (!count && !passive.std) continue;
    const option = el('option', '', count ? `${passive.ja}（${count}）` : passive.ja);
    option.value = passive.id;
    (count ? owned : others).append(option);
  }
  // マスターにないパッシブ（ゲームの更新直後など）も選べるようにする
  for (const [id, count] of counts) {
    if (passivesById.has(id) || selected.includes(id)) continue;
    const option = el('option', '', `${id}（${count}）`);
    option.value = id;
    owned.append(option);
  }
  if (owned.children.length) select.append(owned);
  if (others.children.length) select.append(others);
  select.disabled = selected.length >= max;
  select.addEventListener('change', () => {
    if (select.value) onChange([...selected, select.value]);
  });
  wrapper.append(chips, select);
  return wrapper;
}
