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
  image.width = large ? 160 : 64;
  image.height = large ? 160 : 64;
  image.loading = 'lazy';
  image.addEventListener('error', () => wrapper.replaceChildren(avatar(pal)), { once: true });
  image.src = new URL(`../../img/pals/${encodeURIComponent(pal.icon)}`, import.meta.url).href;
  wrapper.append(image);
  return wrapper;
}

export function elementChips(pal) {
  const wrapper = el('span', 'element-chips');
  for (const element of pal.el ?? []) wrapper.append(el('span', `element-chip element-${element}`, ELEMENTS[element] ?? '不明'));
  return wrapper;
}

export function palTile(id, { gender = '', clickable = true, large = false } = {}) {
  const pal = palsById.get(id);
  if (!pal) return el('span', 'muted', 'パルが見つかりません');
  const wrapper = clickable ? link('', buildHash('pal', {}, id), 'pal-tile') : el('span', 'pal-tile');
  const label = el('span', 'pal-label');
  label.append(el('small', 'dex-label', `No.${pal.label}`), el('strong', '', pal.ja));
  if (gender) label.append(el('span', `gender gender-${gender}`, gender === 'M' ? '♂' : '♀'));
  wrapper.append(palIcon(pal, { large }), label);
  return wrapper;
}
