import pals, { ELEMENTS } from '../../data/pals.js';
import { WORKS } from '../../data/work.js';
import { el, link } from './dom.js';
import { buildHash } from '../router.js';

export const palsById = new Map(pals.map((pal) => [pal.id, pal]));

// ---- ゲームから取り出した小さなアイコン（web/img/{element,work,item,ui}/。scripts/extract-ui-icons.mjs。game-assets） ----

const imageUrl = (file) => new URL(`../../img/${file}`, import.meta.url).href;

/**
 * ゲームのアイコンの img。width・height を決めて配置を揺らさず、lazy で読む。読めなければ（撤回で画像を消した・取り出す前）、
 * 1 回だけ fallback() の要素に差し替える（null を返すなら外すだけ。どちらでも文字の表示に戻る）。
 * 行の要素の数を増やさないよう、包む要素は作らない（差し替えは親の中で行う）
 * @param {string} file web/img/ の下のパス（例 element/Fire.png）
 * @param {{ size?: number, alt?: string, title?: string, className?: string, fallback?: (() => Node | null) | null }} [options]
 */
export function gameIcon(file, { size = 16, alt = '', title = '', className = '', fallback = null } = {}) {
  const image = el('img', `game-icon${className ? ` ${className}` : ''}`);
  image.alt = alt;
  if (title) image.title = title;
  image.width = size;
  image.height = size;
  image.loading = 'lazy';
  image.decoding = 'async';
  image.addEventListener('error', () => {
    const parent = image.parentElement;
    const next = fallback?.() ?? null;
    if (parent && next) parent.insertBefore(next, image);
    image.remove();
  }, { once: true });
  image.src = imageUrl(file);
  return image;
}

/** 属性の名前（「炎」。マスターの ELEMENTS） */
export const elementName = (element) => ELEMENTS[element] ?? '不明';
// 属性の文字のチップ（画像がないときの表示。前からの見た目）
const elementTextChip = (element) => el('span', `element-chip element-${element}`, elementName(element));

/**
 * 属性のアイコン（ゲームのひし形の地つきの記号）。alt と title は「炎属性」。読めなければ文字のチップ（.element-chip）に 1 回だけ差し替える
 * @param {string} element マスターの属性の鍵（Fire など）
 */
export function elementIcon(element, { size = 16 } = {}) {
  const name = `${elementName(element)}属性`;
  return gameIcon(`element/${encodeURIComponent(element)}.png`, {
    size, alt: name, title: name, className: `element-icon element-${element}`, fallback: () => elementTextChip(element),
  });
}

// タマゴのアイコンの種類（アイテム ID の PalEgg_〈種類〉_NN。大きいタマゴも同じアイコン）。小文字にそろえて引く（セーブと表で大文字小文字が違う）
const EGG_KINDS = new Map(['Normal', 'Dark', 'Dragon', 'Earth', 'Electricity', 'Fire', 'Ice', 'Leaf', 'Water', 'WorldTree', 'MutationPal']
  .map((kind) => [kind.toLowerCase(), kind]));
/** タマゴのアイコンのファイル（web/img/ の下）。突然変異（mutant）は突然変異のタマゴ。分からなければ ''（文字の表示のまま） */
export function eggIconFile(itemId, { mutant = false } = {}) {
  if (mutant) return 'item/egg-MutationPal.png';
  const kind = /^PalEgg_([A-Za-z]+)/i.exec(String(itemId ?? ''))?.[1]?.toLowerCase();
  return kind && EGG_KINDS.has(kind) ? `item/egg-${EGG_KINDS.get(kind)}.png` : '';
}
/** タマゴのアイコン（見た目だけ。名前は横の文字が持つので alt は空）。分からなければ null */
export function eggIcon(itemId, { mutant = false, size = 20, className = 'egg-icon' } = {}) {
  const file = eggIconFile(itemId, { mutant });
  return file ? gameIcon(file, { size, className }) : null;
}

/** 作業適性のアイコン（見た目だけ。名前は横の文字が持つ）。表にアイコンがなければ null */
export function workIcon(key, { size = 16 } = {}) {
  const icon = WORKS[key]?.icon;
  return icon ? gameIcon(`work/${encodeURIComponent(icon)}`, { size, className: 'work-icon' }) : null;
}

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

/**
 * パルの絵（web/img/pals/ の webp。読めなければ属性の色の丸に頭文字のアバター）。large は 128px、size は絵の width・height
 *（図鑑のマスは 48。枠の大きさは CSS で同じにして、読み込む前・アバターでも配置を揺らさない）。silhouette は絵を影にする印のクラス
 *（.pal-icon-silhouette。CSS の filter だけで描き、画像は足さない。図鑑の「子としての登録なし」。paldex）
 */
export function palIcon(pal, { large = false, size = 0, silhouette = false } = {}) {
  const wrapper = el('span', `pal-icon${large ? ' pal-icon-large' : ''}${silhouette ? ' pal-icon-silhouette' : ''}`);
  if (!pal) return wrapper;
  if (!pal.icon) { wrapper.append(avatar(pal)); return wrapper; }
  const image = el('img');
  image.alt = '';
  // 大きい絵は CSS の表示（128px）と同じ大きさにする（S-10。前は 160 を CSS で縮めていた）
  image.width = size || (large ? 128 : 64);
  image.height = size || (large ? 128 : 64);
  image.loading = 'lazy';
  // 読めなければ絵だけを代わりのアバターに替える（右下に重ねたタマゴのアイコンなどは残す。game-assets）
  image.addEventListener('error', () => {
    if (image.parentElement === wrapper) wrapper.insertBefore(avatar(pal), image);
    image.remove();
  }, { once: true });
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

/**
 * 属性の並び（パル詳細のヒーロー・解説の板・個体の詳細）。ゲームの属性のアイコン（20px）と名前。アイコンが読めなければ、その属性は
 * 前からの文字のチップ（.element-chip。地の色に白い文字）に戻す
 */
export function elementChips(pal) {
  const wrapper = el('span', 'element-chips');
  for (const element of pal.el ?? []) {
    const item = el('span', `element-item element-${element}`);
    const toChip = () => {
      item.className = `element-chip element-${element}`;
      item.replaceChildren();
      item.textContent = elementName(element);
      return null;
    };
    // 名前を横に出すので、絵は読み上げない（alt は空）
    item.append(gameIcon(`element/${encodeURIComponent(element)}.png`, { size: 20, className: 'element-icon', fallback: toChip }),
      el('span', 'element-name', elementName(element)));
    wrapper.append(item);
  }
  return wrapper;
}

const GENDER_NAMES = { M: 'オス', F: 'メス' };

// CSS だけで描くゲームの画像（性別の記号の mask-image・所持パルの行の属性の背景）は、読めるかを 1 回だけ確かめ、読めたら html に印の
// クラスを付ける（CSS はその印があるときだけ画像に切り替える。画像を消したら前の文字の表示に戻る）
// files は CSS が使う画像の全部（1 つでも読めなければ印を付けない。片方だけ消えて記号が見えなくなるのを防ぐ）
const probed = new Set();
function probeImage(files, className) {
  if (probed.has(className)) return;
  probed.add(className);
  const doc = globalThis.document;
  if (!doc?.documentElement || typeof globalThis.Image !== 'function') return;
  let left = files.length;
  for (const file of files) {
    const probe = new globalThis.Image();
    probe.addEventListener('load', () => { if (--left === 0) doc.documentElement.classList.add(className); }, { once: true });
    probe.src = imageUrl(file);
  }
}
// 性別の記号（web/img/ui/gender-*.png。ゲームの平らな記号）: html.game-gender のとき、丸い地と文字の ♂♀ を隠し、記号の形を性別の色で塗る
const checkGenderImage = () => probeImage(['ui/gender-M.png', 'ui/gender-F.png'], 'game-gender');
// 所持パルの行の属性（palTile の elements: 'css'）: 9 つの属性の画像が全部読めたら html.game-elements
const checkElementImages = () => probeImage(Object.keys(ELEMENTS).map((element) => `element/${element}.png`), 'game-elements');

/**
 * 性別の印。文字の ♂♀ を色の丸い地に置く（色は CSS のトークン --gender-male・--gender-female）。inline: true なら色だけ
 *（文の中・牧場の行のように、丸い地を置くと行の高さが崩れる所）。読み上げ（aria-label）は「オス」「メス」で、title は付けない。
 * 性別が分からなければ null。
 * 要素は 1 つ（.gender の span。所持パルの 2,000 行の DOM の予算を増やさない）
 */
export function genderMark(gender, { inline = false } = {}) {
  const name = GENDER_NAMES[gender];
  if (!name) return null;
  // 丸い地の印は、ゲームの記号が読めれば見た目だけ記号にする（文字・role・aria-label はそのまま。CSS の html.game-gender）
  if (!inline) checkGenderImage();
  const mark = el('span', `gender gender-${gender}${inline ? ' gender-inline' : ''}`, gender === 'M' ? '♂' : '♀');
  mark.setAttribute('role', 'img');
  // 読み上げの名前だけ（title は付けない。ツールチップで画面に「オス」「メス」と出さない。README の表記の決まり）
  mark.setAttribute('aria-label', name);
  return mark;
}

/**
 * genderFirst: 性別を名前の左に置く（所持パルの一覧）。elements: 属性のアイコン（2 属性なら 2 つ）を置く（オプトイン。
 * 配合カードなど既定の表示は変えない。game-assets）。true は名前の右に img（16px。alt・title「炎属性」。パル選択の候補）、'css' は要素を
 * 足さず、番号の行（No.〈番号〉の small）の ::after に CSS の背景で描く（所持パルの 2,000 行と理想個体の結果。行の要素の数を変えない。
 * 番号の small に has-elements・el1-〈属性〉・el2-〈属性〉のクラス。9 つの属性の画像が全部読めたとき〔html.game-elements〕だけ出す）。
 * 名前の行に置くと、狭い幅〔920px〕・拡大で名前が「…」で切れたため、番号の短い行へ移した（フェーズ 4 の終わりのレビュー）
 */
export function palTile(id, { gender = '', clickable = true, large = false, genderFirst = false, elements = false } = {}) {
  const pal = palsById.get(id);
  if (!pal) return el('span', 'muted', 'パルが見つかりません');
  const wrapper = clickable ? link('', buildHash('pal', {}, id), 'pal-tile') : el('span', 'pal-tile');
  // ホバーの解説の対象（ui/hover-card.js。押せるタイルだけ。候補の行の中のタイルには出さない）
  if (clickable) wrapper.setAttribute('data-pal-id', id);
  const label = el('span', 'pal-label');
  const name = el('strong', '', pal.ja);
  const mark = genderMark(gender);
  const dex = el('small', 'dex-label', `No.${pal.label}`);
  label.append(dex);
  const icons = elements === true ? (pal.el ?? []).map((element) => elementIcon(element)) : [];
  const drawn = elements === 'css' ? (pal.el ?? []).filter((element) => ELEMENTS[element]).slice(0, 2) : [];
  if ((mark && genderFirst) || icons.length) {
    const line = el('span', 'pal-name-line');
    if (mark && genderFirst) line.append(mark);
    line.append(name);
    if (mark && !genderFirst) line.append(mark);
    line.append(...icons);
    label.append(line);
  } else {
    label.append(name);
    if (mark) label.append(mark);
  }
  // 属性を CSS で描く（番号の行。要素を足さない）
  if (drawn.length) {
    dex.classList.add('has-elements', ...drawn.map((element, i) => `el${i + 1}-${element}`));
    checkElementImages();
  }
  wrapper.append(palIcon(pal, { large }), label);
  return wrapper;
}
