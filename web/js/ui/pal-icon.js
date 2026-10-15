import pals, { ELEMENTS } from '../../data/pals.js';
import { el, link } from './dom.js';
import { buildHash } from '../router.js';

export const palsById = new Map(pals.map((pal) => [pal.id, pal]));

function avatar(pal) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 80 80');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('pal-avatar', `element-${pal.el?.[0] ?? 'Neutral'}`);
  const circle = document.createElementNS(ns, 'circle');
  circle.setAttribute('cx', '40');
  circle.setAttribute('cy', '40');
  circle.setAttribute('r', '37');
  const initial = document.createElementNS(ns, 'text');
  initial.setAttribute('x', '40');
  initial.setAttribute('y', '43');
  initial.classList.add('avatar-initial');
  initial.textContent = [...pal.ja][0] ?? '?';
  const number = document.createElementNS(ns, 'text');
  number.setAttribute('x', '40');
  number.setAttribute('y', '63');
  number.classList.add('avatar-number');
  number.textContent = `No.${pal.label}`;
  svg.append(circle, initial, number);
  return svg;
}

export function palIcon(pal, { large = false } = {}) {
  const wrapper = el('span', `pal-icon${large ? ' pal-icon-large' : ''}`);
  if (!pal) return wrapper;
  if (!pal.icon) { wrapper.append(avatar(pal)); return wrapper; }
  const image = el('img');
  image.alt = '';
  // 大きい絵は CSS の表示（128px）と同じ大きさにする（S-10。前は 160 を CSS で縮めていた）
  image.width = large ? 128 : 64;
  image.height = large ? 128 : 64;
  image.loading = 'lazy';
  image.addEventListener('error', () => wrapper.replaceChildren(avatar(pal)), { once: true });
  image.src = new URL(`../../img/pals/${encodeURIComponent(pal.icon)}`, import.meta.url).href;
  wrapper.append(image);
  return wrapper;
}

/** 人間のキャラクターのアイコン（ゲームから取り出した web/img/humans/ の画像）。読めなければ何も出さない。 */
export function humanIcon(file) {
  const wrapper = el('span', 'pal-icon');
  const image = el('img');
  image.alt = '';
  image.width = 64;
  image.height = 64;
  image.loading = 'lazy';
  image.addEventListener('error', () => wrapper.replaceChildren(), { once: true });
  image.src = new URL(`../../img/humans/${encodeURIComponent(file)}`, import.meta.url).href;
  wrapper.append(image);
  return wrapper;
}

export function elementChips(pal) {
  const wrapper = el('span', 'element-chips');
  for (const element of pal.el ?? []) wrapper.append(el('span', `element-chip element-${element}`, ELEMENTS[element] ?? '不明'));
  return wrapper;
}

const GENDER_NAMES = { M: 'オス', F: 'メス' };

/**
 * 性別の印。文字の ♂♀ を色の丸い地に置く（色は CSS のトークン --gender-male・--gender-female）。inline: true なら色だけ
 *（文の中・牧場の行のように、丸い地を置くと行の高さが崩れる所）。読み上げ（aria-label）は「オス」「メス」で、title は付けない。
 * 性別が分からなければ null。
 * 要素は 1 つ（.gender の span。所持パルの 2,000 行の DOM の予算を増やさない）
 */
export function genderMark(gender, { inline = false } = {}) {
  const name = GENDER_NAMES[gender];
  if (!name) return null;
  const mark = el('span', `gender gender-${gender}${inline ? ' gender-inline' : ''}`, gender === 'M' ? '♂' : '♀');
  mark.setAttribute('role', 'img');
  // 読み上げの名前だけ（title は付けない。ツールチップで画面に「オス」「メス」と出さない。README の表記の決まり）
  mark.setAttribute('aria-label', name);
  return mark;
}

/** genderFirst: 性別を名前の左に置く（所持パルの一覧） */
export function palTile(id, { gender = '', clickable = true, large = false, genderFirst = false } = {}) {
  const pal = palsById.get(id);
  if (!pal) return el('span', 'muted', 'パルが見つかりません');
  const wrapper = clickable ? link('', buildHash('pal', {}, id), 'pal-tile') : el('span', 'pal-tile');
  // ホバーの解説の対象（ui/hover-card.js。押せるタイルだけ。候補の行の中のタイルには出さない）
  if (clickable) wrapper.setAttribute('data-pal-id', id);
  const label = el('span', 'pal-label');
  const name = el('strong', '', pal.ja);
  const mark = genderMark(gender);
  label.append(el('small', 'dex-label', `No.${pal.label}`));
  if (mark && genderFirst) {
    const line = el('span', 'pal-name-line');
    line.append(mark, name);
    label.append(line);
  } else {
    label.append(name);
    if (mark) label.append(mark);
  }
  wrapper.append(palIcon(pal, { large }), label);
  return wrapper;
}
