import { el, field, empty, button, link, syncList, listKeys, clearList, anchorOf, restoreAnchor, onTextInput, trackHeight } from '../ui/dom.js';
import { palTile, humanIcon, palsById } from '../ui/pal-icon.js';
import { palPicker } from '../ui/pal-picker.js';
import { passiveChip, passiveList, passiveSelector, passivesById } from '../ui/passive-picker.js';
import { hint } from '../ui/hint.js';
import { navIcon } from '../ui/nav-icons.js';
import { talentInput } from '../ui/talent-input.js';
import { segmented } from '../ui/segmented.js';
import { searchSelect } from '../ui/search-select.js';
import { createPopover } from '../ui/popover.js';
import { ownedNotices, noticeList, ownedSourceLine } from '../ui/owned-status.js';
import { virtualRows } from '../ui/virtual-list.js';
import { withTransition } from '../ui/motion.js';
import { viewHeading, syncPicker, syncOptions, renderWhenIdle, ownedSpeciesNotes, keepRefreshing, changeRoute } from './shared.js';
import { toast } from '../ui/toast.js';
import { buildHash } from '../router.js';
import {
  filterOwned, sortOwned, sortKey, sortLabel, keywordTerms, keywordNotes, prepareKeywords, OWNED_SORTS, PLACE_ORDER, placeGroupLabel, shortUid,
} from '../core/owned.js';
import { palsOfPlayers, goalMarks } from '../core/ideal-goals.js';
import { normalizeQuery, queryTerms } from '../core/kana.js';
import { cleanSaved, list, internalName, idText, text, oneOf, intIn, BASES_MAX } from '../core/boundary.js';
import { ELEMENTS } from '../../data/pals.js';

function option(value, label) {
  const node = el('option', '', label);
  node.value = value;
  return node;
}

const STAR_FILTERS = [['', 'すべて'], ['1', '★1 以上'], ['2', '★2 以上'], ['3', '★3 以上'], ['4', '★4']];
const TALENT_FILTERS = [['hp', 'HP'], ['shot', '攻撃'], ['defense', '防御']];
const TALENT_LABELS = Object.fromEntries(TALENT_FILTERS);
const TALENT_PRESETS = [
  { label: 'すべて 90 以上', value: { hp: 90, shot: 90, defense: 90 } },
  { label: 'すべて 100', value: { hp: 100, shot: 100, defense: 100 } },
];
// URL の個体値の名前（hp・at・df）
const TALENT_PARAMS = { hp: 'hp', shot: 'at', defense: 'df' };
const SORT_KEYS = OWNED_SORTS.map(([key]) => key);
// 並べ替えの既定の向き（キーごと）
const SORT_DIRS = new Map(OWNED_SORTS.map(([key, , dir]) => [key, dir]));
// 並べ替えの選択肢の値（既定の向きならキーだけ、反対の向きは「キー:向き」）
const sortValue = (key, dir) => (dir === SORT_DIRS.get(key) ? key : `${key}:${dir}`);
// パッシブの条件（押しボタン。値は core/owned.js の filterOwned の passiveMode）
const PASSIVE_MODES = [
  ['include', '全部', '選んだパッシブを全部持つ個体'],
  ['only', 'だけ', '選んだパッシブを全部持ち、ほかのパッシブを持たない個体'],
  ['none', 'なし', 'パッシブを 1 つも持たない個体（選んだパッシブは使いません）'],
];
const ELEMENT_KEYS = Object.keys(ELEMENTS);
/** 場所のチップの既定（グローバルパルボックスだけを外す。前の「グローバルボックスを表示」の既定オフと同じ） */
export const DEFAULT_PLACES = Object.freeze(PLACE_ORDER.filter((group) => group !== 'global'));

const talentAtLeast = (value) => intIn(value, { min: 0, max: 100, fallback: 0 });
const placeList = (value) => list(value, { max: PLACE_ORDER.length, map: (group) => oneOf(group, PLACE_ORDER, null), key: (group) => group });
/**
 * 保存して読み戻す絞り込みの形（ui/view-memory.js が sessionStorage・履歴のエントリから読むときに、項目ごとに確かめる）。
 * 合わない項目は既定の値に戻す。読み戻した値は migrateFilter で今の形にする（前の形の項目 place・eggs・globals・所持者の base:／global も
 * ここで受けて読み替える。今の形の保存には書かない＝無ければ undefined）
 */
export const OWNED_MEMORY = {
  // 所持者: すべて・自分の個体（mine）・プレイヤー（player:<uid>）。拠点（base:<id>）・グローバルパルボックス（global）は前の形
  holder: (value) => (typeof value === 'string' && value.length <= 80 && (value === '' || value === 'mine' || value === 'global' || /^(player|base):\S/.test(value)) ? value : ''),
  // 選んだ場所のグループ（PLACE_ORDER の値）。無い（前の形の保存）ときは undefined で、migrateFilter が place・eggs・globals から作る
  places: (value) => (Array.isArray(value) ? placeList(value) : undefined),
  // 拠点の ID（空ならすべての拠点）
  bases: (value) => list(value, { max: BASES_MAX, map: (id) => idText(id, 40) || null, key: (id) => id }),
  // 属性（マスターの ID〔Fire など〕。どれかを持つ個体）
  elements: (value) => list(value, { max: ELEMENT_KEYS.length, map: (key) => oneOf(key, ELEMENT_KEYS, null), key: (key) => key }),
  palId: (value) => (typeof value === 'string' && palsById.has(value) ? value : ''),
  // パッシブは内部名の形の ID だけ（重複は除く）。マスターにまだ無い内部名も残す（所持パルに付いていれば候補に出て選べる）
  passives: (value) => list(value, { max: 4, map: (id) => internalName(id) || null, key: (id) => id }),
  passiveMode: (value) => oneOf(value, PASSIVE_MODES.map(([key]) => key), 'include'),
  query: (value) => text(value, 100),
  // 並べ替えのキー（前の値 talent-low も受け、migrateFilter が talent・asc に読み替える）と向き（無ければそのキーの既定）
  sort: (value) => oneOf(value, [...SORT_KEYS, 'talent-low'], 'dex'),
  dir: (value) => oneOf(value, ['asc', 'desc'], undefined),
  stars: (value) => intIn(value, { min: 0, max: 4, fallback: 0 }),
  talent: (value) => cleanSaved(value, { hp: talentAtLeast, shot: talentAtLeast, defense: talentAtLeast }),
  // 前の形（1c の owned-toolbar より前）の項目。読み戻して migrateFilter に渡すだけ
  place: (value) => oneOf(value, ['', ...PLACE_ORDER], undefined),
  eggs: (value) => (typeof value === 'boolean' ? value : undefined),
  globals: (value) => (typeof value === 'boolean' ? value : undefined),
};

/**
 * 絞り込みの値を今の形にする（古い viewState・保存・URL も同じ口で読み替える。どの値も OWNED_MEMORY で確かめる）。
 * 前の形: place（1 つ）→ places: [place]、place '' → 既定、eggs: false → places から 'egg' を外す、globals: true → 'global' を足す、
 * 所持者 base:<id> → 所持者なし・bases: [id]・places: ['base', 'egg']（拠点のタマゴも拠点の持ち物。eggs: false なら 'base' だけ）、
 * 所持者 global → 所持者なし・places: ['global']。places は PLACE_ORDER の順に並べる。
 * place と eggs・globals の組み合わせで places が空になる古い保存（{ place: 'egg', eggs: false } など）は、place を選んでいない既定に戻す
 * @returns {{ holder: string, places: string[], bases: string[], elements: string[], palId: string, passives: string[],
 *   passiveMode: string, query: string, sort: string, dir: 'asc' | 'desc', stars: number, talent: { hp: number, shot: number, defense: number } }}
 */
export function migrateFilter(old) {
  const saved = cleanSaved(old, OWNED_MEMORY);
  let places = saved.places;
  if (!places) {
    const shown = (groups) => groups.filter((group) => !(group === 'egg' && saved.eggs === false) && !(group === 'global' && saved.globals !== true));
    places = shown(saved.place ? [saved.place] : [...PLACE_ORDER]);
    // 古い保存の矛盾した組み合わせ（場所「タマゴ」でタマゴを隠す・場所「グローバル」でグローバルを出さない）で 0 件にしない。
    // そのときは場所を選んでいない既定（タマゴ・グローバルの表示はそのまま）に戻す
    if (!places.length) places = shown([...PLACE_ORDER]);
  }
  let { holder, bases } = saved;
  if (holder.startsWith('base:')) {
    const id = idText(holder.slice(5), 40);
    bases = id ? [id] : [];
    places = saved.eggs === false ? ['base'] : ['base', 'egg'];
    holder = '';
  } else if (holder === 'global') {
    places = ['global'];
    holder = '';
  }
  return {
    holder, places: PLACE_ORDER.filter((group) => places.includes(group)), bases, elements: saved.elements, palId: saved.palId,
    passives: saved.passives, passiveMode: saved.passiveMode, query: saved.query, ...sortOf(saved.sort, saved.dir), stars: saved.stars, talent: saved.talent,
  };
}

// 並べ替え（キーと向き。前の値 talent-low は talent・asc）
function sortOf(value, dir) {
  const { key, dir: resolved } = sortKey(value, dir);
  return { sort: key, dir: resolved };
}

// URL の絞り込みの名前（どれかがあれば、URL がすべての条件を決める。sort・dir は並べ替えだけで、あれば入れる）
const FILTER_PARAMS = ['holder', 'place', 'base', 'el', 'pal', 'p', 'pm', 'q', 'stars', 'hp', 'at', 'df'];
const commaList = (value) => (value ?? '').split(',').filter(Boolean);

/**
 * URL の絞り込み（holder・place〔カンマ区切り。前の 1 つの形も同じ〕・base・el・pal・p・pm・q・stars・hp・at・df）を、
 * 確かめてから今の形にする（未知の場所・属性・パル、範囲の外の数、長すぎる文字は捨てる）。絞り込みの名前が 1 つも無ければ null。
 * URL に無い条件は既定（リンクが条件のすべてを決める）。前の形の所持者（base:・global）は migrateFilter で読み替える
 */
export function filterFromParams(params) {
  if (!FILTER_PARAMS.some((key) => params.has(key))) return null;
  const number = (key) => {
    const raw = params.get(key);
    return raw === null || raw === '' ? 0 : Number(raw);
  };
  return migrateFilter({
    holder: params.get('holder') ?? '',
    ...(params.has('place') ? { places: commaList(params.get('place')) } : {}),
    bases: commaList(params.get('base')), elements: commaList(params.get('el')), palId: params.get('pal') ?? '',
    passives: commaList(params.get('p')), passiveMode: params.get('pm') ?? 'include', query: params.get('q') ?? '',
    stars: number('stars'), talent: Object.fromEntries(TALENT_FILTERS.map(([key]) => [key, number(TALENT_PARAMS[key])])),
  });
}

/** 絞り込みを URL の形にする（リンクをコピー）。場所は既定でも必ず入れる（開いたタブの覚えている条件より URL を使わせる） */
export function filterParams(filter) {
  const params = new URLSearchParams();
  if (filter.holder) params.set('holder', filter.holder);
  params.set('place', filter.places.join(','));
  if (filter.bases.length) params.set('base', filter.bases.join(','));
  if (filter.elements.length) params.set('el', filter.elements.join(','));
  if (filter.palId) params.set('pal', filter.palId);
  if (filter.passives.length) params.set('p', filter.passives.join(','));
  if (filter.passiveMode !== 'include') params.set('pm', filter.passiveMode);
  if (filter.query) params.set('q', filter.query);
  if (filter.sort !== 'dex' || filter.dir !== SORT_DIRS.get(filter.sort)) params.set('sort', filter.sort);
  if (filter.dir !== SORT_DIRS.get(filter.sort)) params.set('dir', filter.dir);
  if (filter.stars) params.set('stars', String(filter.stars));
  for (const [key] of TALENT_FILTERS) if (filter.talent[key] > 0) params.set(TALENT_PARAMS[key], String(filter.talent[key]));
  return params;
}

// 絞り込みの入れ物（viewState と共有）を、作り直さずに next の項目だけにする（前の形の項目は消す）
function adopt(target, next) {
  for (const key of Object.keys(target)) if (!Object.hasOwn(next, key)) delete target[key];
  Object.assign(target, next);
}

// 一覧の描き方（性能の予算: 2,000 行で最初の 200 行が 100ms 以内・全行が 1 秒以内。2,000 行を超えたら見えている範囲だけ描く）
const FIRST_ROWS = 200;
// 描き直し 1 回で、すぐ中身を書き換える既にある行の数（先頭から）。残りは区切って書き換える（キーワードを打つと多くの行の一致の理由が
// 変わり、2,000 行で 200 行ずつすぐ書き換えると入力が 100ms 以上止まったため。窓に入る行〔約 10 行〕より十分多い）
const FILL_NOW = 60;
// 行の高さ（px。CSS の .owned-row の高さと同じ。見えている範囲だけ描く一覧の、まだ測っていない行の見積もり）
const ROW_ESTIMATE = 80;
const VIRTUAL_OVER = 2000;
// 残りの行を足す 1 回の区切り（16ms 以内）。前の区切りの速さで、足す行数を 25〜400 の間で増減する
const SLICE_MS = 16;
const STEP_MIN = 25;
const STEP_MAX = 400;
const clock = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());
const nextFrame = (fn) => (typeof globalThis.requestAnimationFrame === 'function' ? globalThis.requestAnimationFrame(fn) : setTimeout(fn, 0));
// 列見出し: [並べ替えのキー, 見出しの文字, 読み上げの名前]。押すとそのキー（既定の向き）、もう一度で反対の向き
const HEAD_COLUMNS = {
  dex: ['dex', 'パル', 'パル（図鑑番号）'],
  level: ['level', 'Lv', 'レベル'],
  stars: ['stars', '★', 'パル濃縮（★）'],
  passives: ['passives', 'パッシブ', '良いパッシブ'],
  hp: ['hp', 'HP', 'HP の個体値'],
  shot: ['shot', '攻', '攻撃の個体値'],
  defense: ['defense', '防', '防御の個体値'],
  talent: ['talent', '計', '個体値の合計'],
  place: ['place', '所持者・場所', '所持者・場所'],
};
// 向きの言い方（列見出しの読み上げ。「HP の個体値で並べ替え（高い順）」）
const HIGH_LOW = { desc: '高い順', asc: '低い順' };
const HEAD_WORDS = {
  dex: { asc: '小さい順', desc: '大きい順' }, passives: { desc: '良い順', asc: '低い順' }, level: HIGH_LOW, stars: { desc: '多い順', asc: '少ない順' },
  talent: HIGH_LOW, hp: HIGH_LOW, shot: HIGH_LOW, defense: HIGH_LOW, place: { asc: 'ボックスの順', desc: '逆の順' },
};
// 場所の検索欄を出す拠点の数
const BASE_SEARCH_OVER = 12;

// 行に出す値の署名（一致の理由・印を除く）と、一致の理由の署名。理由を入れ忘れると、キーワードを変えても古い理由が残る
const boxText = (box) => (box ? `${box.page}.${box.row}.${box.column}` : '');
// 個体のデータ（読み込みごとに作り直され、中は変えない）ごとに 1 回だけ作る（キーワードを打つたびに 2,000 行ぶん作らない）
const baseSignatures = new WeakMap();
function baseSignature(pal) {
  let signature = baseSignatures.get(pal);
  if (signature === undefined) {
    signature = [pal.palId, pal.known, pal.name, pal.human?.icon ?? '', pal.level, pal.rank, pal.stars,
      pal.passives.join(','), pal.talent.hp, pal.talent.shot, pal.talent.defense, pal.holder, pal.place, pal.placeLabel, boxText(pal.box), pal.nickname,
      pal.gender, pal.egg, pal.lucky, pal.alpha, pal.lastOwner].join('\u0001');
    baseSignatures.set(pal, signature);
  }
  return signature;
}
const notesSignature = (notes) => notes.map((note) => `${note.label}:${note.name}:${note.desc}`).join('|');
/** 行に出す値の署名（一致の理由 notes と印 marks を含む）。同じなら行を書き換えない（理想個体の描き直しの判定も使う） */
export const rowSignature = (pal, notes = [], marks = []) => `${baseSignature(pal)}\u0002${notesSignature(notes)}\u0002${marks.join('\u0001')}`;

// ---- 所持パルの 1 行（所持パルの一覧・理想個体の組のカード）。列は [パル][Lv・★][パッシブ][個体値 4 セル][所持者・場所]（CSS の --owned-cols） ----
// 個体値のセル（列見出しの HP・攻・防・計と同じ並び）。名前は読み上げの文に使う
const TALENT_CELLS = [['hp', 'HP'], ['shot', '攻撃'], ['defense', '防御'], ['total', '合計']];
// 1 つの行に出すパッシブの数。5 個以上なら 3 個と「+N」（残りは押すと板に出す。行の中には広げない）
const PASSIVE_SLOTS = 4;

// 行の操作（所持パルの画面だけ）の行き先。配合を探す（search）はフェーズ 2 の find-merge で行き先が変わるので、ここ 1 か所で作る
const positivePassives = (pal) => pal.passives.filter((id) => (passivesById.get(id)?.rank ?? 0) > 0);
/** 行の操作のリンク（目標に・ここから継承ルート・親1 にして配合を探す）。理想個体と継承ルートへは正のランクのパッシブだけを渡す */
export function ownedRowLinks(pal) {
  const p = positivePassives(pal).join(',');
  return [
    { key: 'ideal', icon: 'ideal', label: '目標に（理想個体）', href: buildHash('ideal', { to: pal.palId, p }) },
    { key: 'route', icon: 'route', label: 'ここから継承ルート', href: buildHash('route', { from: pal.palId, p }) },
    { key: 'search', icon: 'search', label: '親1 にして配合を探す', href: buildHash('search', { p1: pal.palId }) },
  ];
}
// 行の操作を出せる個体（パルのマスターにある・タマゴでない）
const canAct = (pal) => pal.known && !pal.egg && Boolean(pal.palId);

// パル（絵と名前・性別）。名前のリンクは data-focus="pal"（行の中を書き換えても、同じ部品へフォーカスを戻す目印）
function palCellTile(pal) {
  if (pal.known) {
    const tile = palTile(pal.palId, { gender: pal.gender, genderFirst: true });
    if (tile.tagName === 'a') tile.setAttribute('data-focus', 'pal');
    return tile;
  }
  // 人間のキャラクターなど、パルのマスターにないもの。ゲームから取り出した名前とアイコンがあれば出す
  const unknown = el('span', 'pal-tile owned-unknown');
  if (pal.human?.icon) unknown.append(humanIcon(pal.human.icon));
  const label = el('span', 'pal-label');
  const name = el('strong', '', pal.name);
  if (pal.gender) {
    const line = el('span', 'pal-name-line');
    line.append(el('span', `gender gender-${pal.gender}`, pal.gender === 'M' ? '♂' : '♀'), name);
    label.append(line);
  } else label.append(name);
  unknown.append(label);
  return unknown;
}

// 行の中に出す目標の印の数。残りは「+N」（押すと板に一覧。板の中身は開いたときに作る）。目標が多いと 1 行に印が 100 個並び、
// 2,000 行で DOM の予算〔80,000〕を超えたため。キーワードで印を探すのは DOM と別（filterOwned の extraTexts）で、すべての印を見る
const MARK_SLOTS = 2;

// 名前の下のバッジ（ニックネーム・タマゴ・ラッキー・アルファ・印）。1 行（入り切らない分は隠し、title に全部）。バッジがなければ null。
// 印が MARK_SLOTS を超えたら「+N」のボタン（data-focus="marks-more"）を足し、説明の部品を hints に入れる
function palCellBadges(pal, marks, hints) {
  const fixed = [];
  if (pal.nickname) fixed.push(['owned-badge badge-nickname', `「${pal.nickname}」`]);
  if (pal.egg) fixed.push(['owned-badge badge-egg', 'タマゴ']);
  if (pal.lucky) fixed.push(['owned-badge badge-lucky', 'ラッキー']);
  if (pal.alpha) fixed.push(['owned-badge badge-alpha', 'アルファ']);
  if (!fixed.length && !marks.length) return null;
  const shown = marks.slice(0, MARK_SLOTS);
  const line = el('span', 'owned-badges');
  line.append(...[...fixed, ...shown.map((mark) => ['owned-badge badge-mark', mark])].map(([className, text]) => el('span', className, text)));
  line.title = [...fixed.map(([, text]) => text), ...marks].join('\n');
  const rest = marks.slice(shown.length);
  if (rest.length) {
    const more = button(`+${rest.length}`, null, 'owned-badge mark-more');
    // 読み上げの名前にも見えている「+N」を入れる（見えている文で呼びかけても押せるように）
    more.setAttribute('aria-label', `+${rest.length}（ほかの目標の印 ${rest.length} 個）`);
    more.setAttribute('data-focus', 'marks-more');
    more.title = rest.join('\n');
    line.append(more);
    hints.push(hint({ label: 'ほかの目標の印', trigger: more, content: () => {
      const list = el('div', 'mark-list');
      list.append(...rest.map((mark) => el('span', 'owned-badge badge-mark', mark)));
      return [list];
    } }));
  }
  return line;
}

// 行の中でフォーカスのある部品の目印（data-focus。部品から先祖へたどる）。フォーカスが行の外・目印のない部品なら null
function focusMark(row) {
  const active = globalThis.document?.activeElement;
  if (!active || !row.contains(active)) return null;
  for (let node = active; node && node !== row; node = node.parentElement) {
    const mark = typeof node.getAttribute === 'function' ? node.getAttribute('data-focus') : null;
    if (mark) return mark;
  }
  return null;
}
const focusLost = () => {
  const doc = globalThis.document;
  return !doc?.activeElement || doc.activeElement === doc.body || doc.activeElement.isConnected === false;
};

// レベル（タマゴは「—」。文字はセルに直接）と、パル濃縮の 4 枠（塗りの ★ は文字、輪郭の ☆ は CSS が data-off から出す。
// SVG にせず要素 1 つ。2,000 行で要素の数を増やさないため）
function fillLevelCell(cell, pal) {
  const filled = Math.max(0, Math.min(4, pal.stars));
  const stars = el('span', 'owned-stars', '★'.repeat(filled));
  stars.setAttribute('role', 'img');
  stars.setAttribute('aria-label', filled ? `パル濃縮 ★${filled}` : 'パル濃縮なし');
  stars.setAttribute('data-off', '☆'.repeat(4 - filled));
  cell.textContent = pal.egg ? '—' : `Lv ${pal.level}`;
  cell.append(stars);
}

// パッシブの並び（行の中だけランクの高い順。同じランクは保存の順）を 2×2 の固定の枠（セルそのものが grid）に。5 個以上なら 3 個と「+N」。
// 欲しいパッシブ（wanted。1 つ以上のときだけ）があれば、欲しいものに ✓ を付け、それ以外を薄くする。パッシブなしは枠が空（文字は出さない）。
// after は枠の後ろに残す要素（一致の理由の 1 行）
function fillPassiveList(list, ids, wanted, hints, after) {
  const ordered = ids.map((id, index) => ({ id, index, rank: passivesById.get(id)?.rank ?? 0 }))
    .sort((a, b) => b.rank - a.rank || a.index - b.index).map((item) => item.id);
  const shown = ordered.length > PASSIVE_SLOTS ? ordered.slice(0, PASSIVE_SLOTS - 1) : ordered;
  const set = wanted?.length ? new Set(wanted) : null;
  const chips = shown.map((id) => {
    const chip = passiveChip(id);
    if (!set) return chip;
    if (!set.has(id)) {
      chip.classList.add('is-extra');
      return chip;
    }
    chip.classList.add('is-wanted');
    const check = el('span', 'passive-check', '✓');
    check.setAttribute('role', 'img');
    check.setAttribute('aria-label', '欲しいパッシブ');
    chip.insertBefore(check, chip.children[0] ?? null);
    return chip;
  });
  list.replaceChildren(...chips);
  const rest = ordered.slice(shown.length);
  if (!rest.length) {
    if (after) list.append(after);
    return;
  }
  const more = button(`+${rest.length}`, null, 'passive-more');
  // 読み上げの名前にも見えている「+N」を入れる（見えている文で呼びかけても押せるように）
  more.setAttribute('aria-label', `+${rest.length}（ほかのパッシブ ${rest.length} 個）`);
  more.setAttribute('data-focus', 'passive-more');
  more.title = rest.map((id) => passivesById.get(id)?.ja ?? id).join('\n');
  list.append(more);
  if (after) list.append(after);
  hints.push(hint({ label: 'ほかのパッシブ', trigger: more, content: () => [passiveList(rest)] }));
}

// キーワードに一致した、一覧に出していない項目（スキル・説明）。1 行に横に並べ（入り切らない分は省略）、title に全文
function fillHits(line, notes) {
  line.replaceChildren(...notes.map((note) => {
    const hit = el('span', 'owned-hit');
    hit.append(el('span', 'owned-hit-name', `${note.label}：${note.name}`));
    if (note.desc) hit.append(el('span', 'owned-hit-desc', note.desc));
    return hit;
  }));
  line.title = notes.map((note) => `${note.label}：${note.name}${note.desc ? `（${note.desc}）` : ''}`).join('\n');
}

// 個体値の 4 セル（HP・攻・防・計）。数字と、下のミニバー（--v。計は合計の 1/3）。目標（targets）があれば、目標の縦線（--t）と
// 目標以上は .met、目標未満は .short と差（−N。値の下に小さく〔D23〕）。読み上げは欄の aria-label にまとめる
function fillTalentCell(cell, talent, targets) {
  const total = talent.hp + talent.shot + talent.defense;
  const spoken = [];
  cell.replaceChildren(...TALENT_CELLS.map(([key, name]) => {
    const value = key === 'total' ? total : talent[key];
    const item = el('span', 'talent-cell', String(value));
    item.setAttribute('data-key', key);
    item.style.setProperty('--v', String(key === 'total' ? Math.round(total / 3) : value));
    const target = key === 'total' ? 0 : targets?.[key] ?? 0;
    if (target <= 0) {
      spoken.push(`${name} ${value}`);
      return item;
    }
    item.classList.add('has-target');
    item.style.setProperty('--t', String(target));
    if (value >= target) {
      item.classList.add('met');
      spoken.push(`${name} ${value}（目標 ${target} 以上）`);
    } else {
      item.classList.add('short');
      item.append(el('span', 'talent-diff', `−${target - value}`));
      spoken.push(`${name} ${value}（目標 ${target} まで あと ${target - value}）`);
    }
    return item;
  }));
  cell.setAttribute('aria-label', `個体値 ${spoken.join('・')}`);
}

// 所持者と場所。拠点の個体は拠点の名前と「Alice が預けた」（場所の行は重ねない）。パルボックスは「P2 · 1-6」と 6×5 の小さな図
//（title に場所の全文）。位置が分からなければ場所の文字
function fillWhereCell(cell, pal) {
  if (pal.place === 'base' && pal.holder === pal.placeLabel) {
    cell.replaceChildren(el('strong', '', pal.holder), ...(pal.lastOwner ? [el('small', 'muted', `${pal.lastOwner} が預けた`)] : []));
    cell.title = '';
    return;
  }
  if (!pal.box) {
    cell.replaceChildren(el('strong', '', pal.holder), el('small', 'muted', pal.placeLabel));
    cell.title = '';
    return;
  }
  // 短い表記と図は見た目だけ（読み上げは隠し、場所の全文「パルボックス 2 ページ・1 行 2 列」を見た目は隠した文で読ませる）
  const place = el('small', 'muted owned-box', `P${pal.box.page} · ${pal.box.row}-${pal.box.column}`);
  place.setAttribute('aria-hidden', 'true');
  // 図は要素 1 つ（枠は背景の線、位置の印は ::after を --r・--c の枠に置く）
  const map = el('span', 'box-map');
  map.style.setProperty('--r', String(pal.box.row));
  map.style.setProperty('--c', String(pal.box.column));
  place.append(map);
  cell.replaceChildren(el('strong', '', pal.holder), place, el('span', 'visually-hidden', pal.placeLabel));
  cell.title = pal.placeLabel;
}

/**
 * 所持パルの 1 行の部品。options: { notes, highlight, marks, actions, hints }。
 * notes は一致した理由（core/owned.js の keywordNotes）、highlight は理想個体の組の親で欲しいパッシブと個体値の目標との差を見せる
 * （{ wanted, targets }）、marks は名前の下の印（span.owned-badge.badge-mark）、actions は行の操作を出せる行か（所持パルの画面だけ。
 * 操作の要素は showActions で、初めて触れた行にだけ作る）、hints は「+N」の説明の部品を入れる配列（作り直す側が destroy する。省くと行が持つ）。
 * update は変わったセルだけを書き換え、書き換えたら true（同じ値なら何もしない）。書き換えたセルにフォーカスがあったら、同じ役目の部品
 * （data-focus。名前のリンク pal・「+N」passive-more／marks-more・行の操作 action-<key>）へ戻す。印は MARK_SLOTS 個までと「+N」
 * @returns {{ element: HTMLElement, pal: object, update(pal: object, options?: object): boolean, showActions(): boolean,
 *   hideActions(next?: Element): boolean, destroy(): void }}
 */
export function ownedRowItem(pal, options) {
  const element = el('article', 'owned-row');
  const cells = {
    pal: el('div', 'owned-pal'), level: el('div', 'owned-level'), passives: el('div', 'owned-passives'),
    talent: el('div', 'owned-talent'), where: el('div', 'owned-where'),
  };
  cells.talent.setAttribute('role', 'img');
  let hitsLine = null;
  element.append(cells.pal, cells.level, cells.passives, cells.talent, cells.where);
  const shown = {};
  let ownHints = [];
  let badgeHints = [];
  // パルのセルの中: 名前のリンク（絵と名前）とバッジの 1 行。印だけが変わったときに名前のリンクを作り直さない（フォーカスが落ちる）
  let tileNode = null;
  let badgeLine = null;
  let actions = null;
  let eligible = false;
  let current = pal;
  // セルごとの値の署名。変わったセルだけを作り直す
  const write = (name, key, fill) => {
    if (shown[name] === key) return false;
    shown[name] = key;
    fill();
    return true;
  };
  const actionsKey = (target) => `${target.palId}\u0002${positivePassives(target).join(',')}`;
  function fillActions() {
    actions.replaceChildren(...ownedRowLinks(current).map((item) => {
      const node = link('', item.href, `owned-row-action action-${item.key}`);
      node.setAttribute('aria-label', item.label);
      node.setAttribute('data-focus', `action-${item.key}`);
      node.title = item.label;
      node.append(navIcon(item.icon));
      return node;
    }));
  }
  const item = {
    element,
    get pal() { return current; },
    update(next, { notes = [], highlight, marks = [], actions: withActions = false, hints } = {}) {
      current = next;
      // 書き換えるセルにフォーカスがあったら、書き換えた後に同じ役目の部品（data-focus）へ戻す
      const focused = focusMark(element);
      let changed = false;
      changed = write('label', `${next.name}\u0001${next.nickname}`, () => {
        element.setAttribute('aria-label', `${next.name}${next.nickname ? `（${next.nickname}）` : ''}`);
      }) || changed;
      changed = write('tile', [next.palId, next.known, next.name, next.human?.icon ?? '', next.gender].join('\u0002'), () => {
        const tile = palCellTile(next);
        cells.pal.insertBefore(tile, tileNode ?? cells.pal.children[0] ?? null);
        tileNode?.remove();
        tileNode = tile;
      }) || changed;
      changed = write('badges', [next.nickname, next.egg, next.lucky, next.alpha, marks.join('\u0001')].join('\u0002'), () => {
        for (const old of badgeHints) old.destroy();
        badgeHints = [];
        const line = palCellBadges(next, marks, hints ?? badgeHints);
        if (line) cells.pal.insertBefore(line, badgeLine);
        badgeLine?.remove();
        badgeLine = line;
      }) || changed;
      changed = write('level', `${next.egg}:${next.level}:${next.stars}`, () => fillLevelCell(cells.level, next)) || changed;
      changed = write('passives', `${next.passives.join(',')}\u0002${highlight?.wanted?.join(',') ?? ''}`, () => {
        for (const old of ownHints) old.destroy();
        ownHints = [];
        fillPassiveList(cells.passives, next.passives, highlight?.wanted, hints ?? ownHints, hitsLine);
      }) || changed;
      changed = write('hits', notesSignature(notes), () => {
        if (!notes.length) {
          hitsLine?.remove();
          hitsLine = null;
          return;
        }
        if (!hitsLine) {
          hitsLine = el('p', 'owned-hits');
          cells.passives.append(hitsLine);
        }
        fillHits(hitsLine, notes);
      }) || changed;
      const targets = highlight?.targets;
      changed = write('talent', `${next.talent.hp}:${next.talent.shot}:${next.talent.defense}:${targets ? TALENT_CELLS.map(([key]) => targets[key] ?? 0).join(',') : ''}`,
        () => fillTalentCell(cells.talent, next.talent, targets)) || changed;
      changed = write('where', [next.place, next.holder, next.placeLabel, boxText(next.box), next.lastOwner].join('\u0002'), () => fillWhereCell(cells.where, next)) || changed;
      eligible = withActions && canAct(next);
      if (actions && !eligible) {
        actions.remove();
        actions = null;
        shown.actions = '';
      } else if (actions) write('actions', actionsKey(next), fillActions);
      if (focused && changed && focusLost()) element.querySelector(`[data-focus="${focused}"]`)?.focus({ preventScroll: true });
      return changed;
    },
    /** 行の操作（目標に・ここから継承ルート・親1 にして配合を探す）を出す。出せない行（タマゴ・人間・理想個体のカード）は false */
    showActions() {
      if (!eligible) return false;
      if (actions) return true;
      actions = el('div', 'owned-row-actions');
      element.append(actions);
      shown.actions = actionsKey(current);
      fillActions();
      return true;
    },
    /**
     * 行の操作を外す（ポインターもフォーカスも離れた行。触れた行に付けたままにすると、DOM が増え続けるため）。
     * next（これからフォーカスが入る要素。既定は今のフォーカス）が操作の中なら外さずに false
     */
    hideActions(next = globalThis.document?.activeElement) {
      if (!actions) return true;
      if (next && actions.contains(next)) return false;
      actions.remove();
      actions = null;
      shown.actions = '';
      return true;
    },
    destroy() {
      for (const old of [...ownHints, ...badgeHints]) old.destroy();
      ownHints = [];
      badgeHints = [];
    },
  };
  item.update(pal, options);
  return item;
}

/** 所持パルの 1 行の要素（理想個体の組のカード・テストで使う薄い包み）。オプションは ownedRowItem と同じ */
export const ownedRow = (pal, options) => ownedRowItem(pal, options).element;

export function ownedView(context, route) {
  const owned = context.owned;
  // 入力の間引きの待ち時間（テストの context は 0 にして同期で確かめる）
  const inputDelay = context.inputDelay ?? 150;
  // 間引いて待っている入力（画面を閉じるときに取り消し、移る前の保存の前に flushInputs で当てる）
  const inputs = new AbortController();
  const pendingInputs = [];
  const element = el('section', 'view owned-view');
  element.append(viewHeading('所持パル'));
  // タブを切り替えて戻ってきても、前の絞り込みのまま出す。読み込み直しても、同じタブ（sessionStorage）の間は残る（app.js が戻す）。
  // 入れ物は viewState と共有し、前の形（古い保存・旧コードの viewState）は migrateFilter で今の形に読み替える
  const memory = context.viewState?.('owned');
  const filter = memory?.filter && typeof memory.filter === 'object' ? memory.filter : {};
  adopt(filter, migrateFilter(filter));
  if (memory) memory.filter = filter;
  // URL で指定された絞り込みは、覚えている絞り込みより優先する（作るときと、同じ画面のまま URL が変わったとき）。
  // 絞り込みの名前が 1 つでもあれば URL が条件のすべてを決める（URL に無い条件は既定。並べ替えは sort があるときだけ変える）。
  // 入れたら true を返す
  function readRoute(next) {
    const fromUrl = filterFromParams(next.params);
    const sortParam = next.params.has('sort') ? sortOf(next.params.get('sort'), next.params.get('dir')) : null;
    if (!fromUrl && sortParam === null) return false;
    if (fromUrl) adopt(filter, { ...fromUrl, ...(sortParam ?? { sort: filter.sort, dir: filter.dir }) });
    else Object.assign(filter, sortParam);
    // 画面内で変えた絞り込みは URL に出ないため、戻ってきたときに古い URL の指定で上書きしないよう外しておく。
    if (memory) context.replace(buildHash('owned'));
    return true;
  }
  readRoute(route);

  // データ元の 1 行（どのワールドの・どこから・いつのデータか。右端に読み込みの状態のスロット）と、対応が要るときだけの案内。
  // 設定の操作（ワールドの切り替え・今すぐ読み込む）は設定タブで行う。データがないときだけ、案内に設定へ行くボタンを出す
  const summary = el('section', 'owned-summary');
  const notices = noticeList([]);
  // 許可はクリックの中で求める必要があるため、案内の中にボタンを出す（許可の後にそのまま読み込む）
  const noticeActions = {
    grant: { label: '読み込みを許可', run: () => owned.grantAndRefresh().catch((error) => toast(error.message)) },
    settings: { label: 'セーブ連携を開く', run: () => context.navigate('#/settings') },
    unknownPlace: { label: '見る', run: () => changeRoute(context, buildHash('owned', { place: 'unknown' })) },
  };
  const sourceLine = ownedSourceLine({ actions: { grant: noticeActions.grant } });
  summary.append(sourceLine.element, notices);

  // ---- 絞り込みの部品（作るのは 1 回だけ。条件・データが変わったら update・値の書き換えで合わせる） ----
  // 利用者が条件を変えた: 一覧・件数・効いている条件を描き直し、一覧の先頭がパネルの下に隠れていれば先頭を見せる（O-05）
  function changed() {
    renderResults();
    revealResults();
  }
  const query = el('input');
  query.type = 'search';
  query.placeholder = '名前・スキル・属性など';
  query.title = '名前・スキル・属性など（空白で区切ると、すべてを含むパル）';
  query.value = filter.query;
  const sort = el('select', 'owned-sort');
  sort.setAttribute('aria-label', '並べ替え');
  // 並べ替えの選択肢（値は sortValue）。個体値の合計が低い順は高い順の次（X-30）。列見出しで選んだ反対の向き（HP の個体値が低い順など）は、
  // 選んでいる間だけそのキーの次に足す（選択肢を倍にしない）
  function sortChoices() {
    const choices = [];
    for (const [key, label, , reverse] of OWNED_SORTS) {
      choices.push([key, label]);
      if (key === 'talent') choices.push([sortValue('talent', 'asc'), reverse]);
    }
    const current = sortValue(filter.sort, filter.dir);
    if (!choices.some(([value]) => value === current)) {
      choices.splice(choices.findIndex(([value]) => value === filter.sort) + 1, 0, [current, sortLabel(filter.sort, filter.dir)]);
    }
    return choices;
  }
  for (const [value, label] of sortChoices()) sort.append(option(value, label));
  sort.value = sortValue(filter.sort, filter.dir);
  const stars = el('select');
  stars.setAttribute('aria-label', 'パル濃縮（★）');
  for (const [value, label] of STAR_FILTERS) stars.append(option(value, label));
  stars.value = filter.stars ? String(filter.stars) : '';
  stars.addEventListener('change', () => { filter.stars = Number(stars.value) || 0; changed(); });
  // 個体値の下限（☑ HP [90]。チェックを外すか空欄で条件なし＝0。「以上」は見出しに 1 回）。数字の入力は間引き、確定（change）・チェック・
  // 「まとめて ▾」の「すべて …」ですぐ絞る
  const talents = talentInput({
    keys: TALENT_FILTERS.map(([key]) => key), labels: TALENT_LABELS, value: filter.talent,
    ariaLabel: (key) => `${TALENT_LABELS[key]}の個体値（以上）`,
    debounce: inputDelay,
    onChange: (value) => { filter.talent = { ...value }; changed(); },
  });
  // 「すべて 90 以上」「すべて 100」は 1 つの小さなメニューにまとめる（パネルの 2 段目を 2 行に収めるため。押すと 3 つとも入れて 1 回だけ絞る）
  const talentBox = el('div', 'owned-talent-filter');
  const presetSlot = el('span', 'talent-preset-slot');
  const presetButton = button('まとめて', () => (presetMenu.isOpen() ? presetMenu.close() : presetMenu.open()), 'talent-preset-button');
  presetButton.setAttribute('aria-haspopup', 'menu');
  presetButton.setAttribute('aria-label', '個体値をまとめて入れる');
  presetSlot.append(presetButton);
  const presetMenu = createPopover({ anchor: presetButton, wrapper: presetSlot, className: 'picker-popover talent-preset-menu', focusOut: true,
    onOpen: () => presetMenu.element.querySelector('button')?.focus() });
  presetMenu.element.setAttribute('role', 'menu');
  presetMenu.element.tabIndex = -1;
  presetMenu.element.setAttribute('aria-label', '個体値をまとめて入れる');
  for (const preset of TALENT_PRESETS) {
    const item = button(preset.label, () => {
      presetMenu.close();
      talents.update(preset.value);
      filter.talent = { ...preset.value };
      changed();
    }, 'talent-preset-item');
    item.setAttribute('role', 'menuitem');
    // メニューの項目は Tab では止まらず（Tab はメニューの外へ出て閉じる）、↑↓・Home・End で移る（menu の作法）
    item.tabIndex = -1;
    presetMenu.element.append(item);
  }
  presetMenu.element.addEventListener('keydown', (event) => {
    const items = [...presetMenu.element.querySelectorAll('[role="menuitem"]')];
    const index = items.indexOf(globalThis.document?.activeElement);
    const to = { ArrowDown: index + 1, ArrowUp: index < 0 ? items.length - 1 : index - 1, Home: 0, End: items.length - 1 }[event.key];
    if (to === undefined || !items.length) return;
    event.preventDefault();
    items[(to + items.length) % items.length].focus();
  });
  talentBox.append(talents.element, presetSlot);
  // 所持している種族を先に「♂3 ♀2」つきで出す
  const picker = palPicker({ label: 'パル', value: filter.palId, describe: () => ownedSpeciesNotes(owned.state.owned),
    onChange: (id) => { filter.palId = id; changed(); } });
  // パッシブの選択欄は 1 回だけ作り、絞り込み・データが変わったら update で合わせる（開いた候補を閉じない）。
  // 所持数は、選んでいるパッシブも含めた今の絞り込みの結果の中の数（renderResults が数える）。条件「なし」の間は押せない
  const passive = passiveSelector({
    label: 'パッシブ', selected: filter.passives, countLabel: 'いまの絞り込みの中で持っているもの', negatives: 'inline',
    onChange: (ids) => {
      filter.passives = ids;
      passive.update({ selected: ids });
      changed();
    },
  });
  // パッシブの条件（全部持つ／だけ／なし）
  const modeChoice = segmented({ label: 'パッシブの条件', choices: PASSIVE_MODES, value: filter.passiveMode,
    onChange: (value) => { filter.passiveMode = value; changed(); } });
  // 所持者（すべて／自分の個体／プレイヤー）。意味は理想個体と同じ（そのプレイヤーが預けた拠点のパル・ホストならグローバルパルボックスも含む）。
  // 選択肢が 12 件を超えたら検索つきの選択にする
  const holderSelect = searchSelect({ label: '所持者', options: [['', 'すべて']], value: filter.holder,
    onChange: (value) => { filter.holder = value; changed(); } });

  // 場所のチップ（件数つき・複数選択。件数は絞り込む前の数で、0 の場所は出さない）。拠点が 2 つ以上なら、拠点のチップの右の ▾ で拠点を選ぶ
  const placeBox = el('div', 'place-chips');
  placeBox.setAttribute('role', 'group');
  placeBox.setAttribute('aria-label', '場所');
  const placeChips = new Map();
  const baseSlot = el('span', 'place-bases-slot');
  const baseMore = button('▾', () => (basePopover.isOpen() ? basePopover.close() : basePopover.open()), 'place-chip-more');
  baseMore.setAttribute('aria-haspopup', 'dialog');
  baseSlot.append(baseMore);
  const basePopover = createPopover({ anchor: baseMore, wrapper: baseSlot, className: 'picker-popover place-bases', focusOut: true,
    onOpen: () => renderBases({ focus: true }) });
  basePopover.element.setAttribute('role', 'dialog');
  // 中の余白を押してもフォーカスが中に残る（focusOut で閉じない）ように、板そのものもフォーカスを受けられるようにする（下の 3 つも同じ）
  basePopover.element.tabIndex = -1;
  basePopover.element.setAttribute('aria-label', '拠点を選ぶ');
  const baseSearch = el('input', 'picker-search');
  baseSearch.type = 'search';
  baseSearch.placeholder = '拠点の名前で探す';
  baseSearch.setAttribute('aria-label', '拠点を検索');
  baseSearch.addEventListener('input', () => renderBases());
  const baseList = el('div', 'place-base-list');
  const baseClear = button('すべての拠点', () => {
    filter.bases = [];
    // 押すとこのボタンは押せなくなり（disabled）、フォーカスが body に落ちて板が閉じるので、先に板の先頭（検索欄か最初の拠点）へ移す
    if (globalThis.document?.activeElement === baseClear) (baseSearch.parentElement ? baseSearch : baseList.querySelector('input'))?.focus();
    renderPlaces(owned.state);
    changed();
  }, 'button secondary small');
  basePopover.element.append(baseList, baseClear);
  for (const group of PLACE_ORDER) {
    const chip = button('', () => togglePlace(group), 'place-chip');
    chip.setAttribute('data-value', group);
    chip.append(el('span', 'place-chip-label', placeGroupLabel(group)), el('span', 'place-chip-count', ''));
    placeBox.append(chip);
    if (group === 'base') placeBox.append(baseSlot);
    placeChips.set(group, chip);
  }
  function togglePlace(group) {
    const on = !filter.places.includes(group);
    filter.places = PLACE_ORDER.filter((item) => (item === group ? on : filter.places.includes(item)));
    renderPlaces(owned.state);
    changed();
  }
  // 拠点ごとのチェック（拠点が 12 を超えたら検索欄つき）。チェックは使い回し、変わった値だけを書き換える
  function baseRow(base) {
    const row = el('label', 'place-base');
    const check = el('input');
    check.type = 'checkbox';
    const name = el('span', 'place-base-name');
    const count = el('span', 'place-base-count');
    row.append(check, name, count);
    let id = base.id;
    check.addEventListener('change', () => {
      filter.bases = check.checked ? [...new Set([...filter.bases, id])] : filter.bases.filter((item) => item !== id);
      renderPlaces(owned.state);
      changed();
    });
    const item = {
      element: row,
      update(next) {
        id = next.id;
        const n = statsOf(owned.state.owned).baseCounts.get(next.id) ?? 0;
        if (name.textContent !== next.label) name.textContent = next.label;
        if (count.textContent !== `${n} 体`) count.textContent = `${n} 体`;
        check.checked = filter.bases.includes(next.id);
        check.setAttribute('aria-label', `${next.label}（${n} 体）`);
      },
    };
    item.update(base);
    return item;
  }
  function renderBases({ focus = false } = {}) {
    if (!basePopover.isOpen()) return;
    const all = owned.state.owned?.bases ?? [];
    const searching = all.length > BASE_SEARCH_OVER;
    if (searching && baseSearch.parentElement !== basePopover.element) basePopover.element.insertBefore(baseSearch, baseList);
    if (!searching && baseSearch.parentElement) baseSearch.remove();
    const terms = searching ? queryTerms(baseSearch.value) : [];
    const shown = all.filter((base) => terms.every((term) => normalizeQuery(base.label).includes(term)));
    syncList(baseList, shown, { key: (base) => base.id, create: baseRow, empty: () => el('p', 'muted', '当てはまる拠点がありません。') });
    baseClear.disabled = !filter.bases.length;
    if (focus) (searching ? baseSearch : baseList.querySelector('input'))?.focus();
  }

  // 属性（9 個のトグルを ▾ で開く。複数は OR）。ボタンには選んだ数だけを出し（幅を変えずパネルの段が増えない）、名前は aria-label・
  // title と状態の行の条件のチップに出す
  const elementSlot = el('div', 'owned-element-slot');
  const elementButton = button('', () => (elementPopover.isOpen() ? elementPopover.close() : elementPopover.open()), 'owned-element-button');
  elementButton.setAttribute('aria-haspopup', 'dialog');
  elementSlot.append(elementButton);
  const elementPopover = createPopover({ anchor: elementButton, wrapper: elementSlot, className: 'picker-popover owned-element-popover', focusOut: true,
    onOpen: () => elementToggles.get(filter.elements[0] ?? ELEMENT_KEYS[0])?.focus() });
  elementPopover.element.setAttribute('role', 'dialog');
  elementPopover.element.tabIndex = -1;
  elementPopover.element.setAttribute('aria-label', '属性で絞り込む');
  const toggleBox = el('div', 'element-toggles');
  const elementToggles = new Map(ELEMENT_KEYS.map((key) => {
    const toggle = button(ELEMENTS[key], () => toggleElement(key), `element-chip element-toggle element-${key}`);
    toggle.setAttribute('data-value', key);
    toggleBox.append(toggle);
    return [key, toggle];
  }));
  elementPopover.element.append(el('p', 'owned-element-note', '選んだ属性のどれかを持つパル'), toggleBox);
  let elementsShown = null;
  function renderElements() {
    for (const [key, toggle] of elementToggles) toggle.setAttribute('aria-pressed', String(filter.elements.includes(key)));
    const key = filter.elements.join(',');
    if (key === elementsShown) return;
    elementsShown = key;
    const names = filter.elements.map((name) => ELEMENTS[name]).join('・');
    elementButton.replaceChildren(el('span', 'owned-element-label', '属性'), ...(filter.elements.length ? [el('span', 'owned-element-count', String(filter.elements.length))] : []));
    elementButton.setAttribute('aria-label', `属性: ${names || 'すべて'}`);
    elementButton.title = names ? `属性: ${names}` : '属性で絞り込む';
  }
  function toggleElement(key) {
    const on = !filter.elements.includes(key);
    filter.elements = ELEMENT_KEYS.filter((item) => (item === key ? on : filter.elements.includes(item)));
    renderElements();
    changed();
  }

  // ---- 状態の行: 件数と内訳・効いている条件のチップ（入り切らない分は +n）・すべて解除・リンクをコピー・並べ替え・理想個体／継承ルートへ ----
  const count = el('p', 'result-note owned-count');
  const chipBox = el('div', 'filter-chips');
  chipBox.setAttribute('role', 'group');
  chipBox.setAttribute('aria-label', '効いている条件');
  // 1 行に入り切らずに隠れたチップの「+n」。押すと隠れたチップを板に並べ、そこでも × で外せる（隠れたチップは inert にして Tab で止めない）
  const chipMoreSlot = el('span', 'filter-more-slot');
  const chipMore = button('', () => (chipPopover.isOpen() ? chipPopover.close() : chipPopover.open()), 'filter-more is-empty');
  chipMore.setAttribute('aria-haspopup', 'dialog');
  chipMoreSlot.append(chipMore);
  const chipPopover = createPopover({ anchor: chipMore, wrapper: chipMoreSlot, className: 'picker-popover filter-more-popover', focusOut: true,
    onOpen: () => renderHiddenChips({ focus: 0 }) });
  chipPopover.element.setAttribute('role', 'dialog');
  chipPopover.element.tabIndex = -1;
  chipPopover.element.setAttribute('aria-label', '隠れている条件');
  const resetButton = button('すべて解除', () => resetAll(), 'button secondary small owned-reset');
  const copySlot = el('span', 'owned-copy-slot');
  const copyButton = button('リンクをコピー', () => copyLink(), 'button secondary small owned-copy');
  copySlot.append(copyButton);
  // コピーできなかったとき（権限がない・HTTP など）は、リンクを欄に出して選ぶ
  let linkUrl = '';
  const linkInput = el('input');
  linkInput.type = 'text';
  linkInput.readOnly = true;
  linkInput.setAttribute('aria-label', 'この条件のリンク');
  // 板はコピーできなかったときだけ開く。ふだんのボタンは開閉のボタンではないので、開いていない間は aria-expanded を付けない
  //（createPopover は anchor にいつも aria-expanded="false" を付ける）
  const linkPopover = createPopover({ anchor: copyButton, wrapper: copySlot, className: 'picker-popover owned-link-field', focusOut: true,
    onOpen: () => {
      linkInput.value = linkUrl;
      linkInput.focus();
      linkInput.select?.();
    },
    onClose: () => copyButton.removeAttribute('aria-expanded') });
  copyButton.removeAttribute('aria-expanded');
  linkPopover.element.setAttribute('role', 'dialog');
  linkPopover.element.tabIndex = -1;
  linkPopover.element.setAttribute('aria-label', 'この条件のリンク');
  linkPopover.element.append(el('p', 'owned-link-note', 'コピーできませんでした。下のリンクを選んでコピーしてください。'), linkInput);
  // 理想個体・継承ルートへのリンク（O-40）。状態の行に収めるため文は短く、長い名前は aria-label と title に
  const panelLink = (text, label) => {
    const node = link(text, '#/', 'owned-panel-link');
    node.setAttribute('aria-label', label);
    node.title = label;
    return node;
  };
  const idealLink = panelLink('理想個体 →', 'この条件で理想個体を開く');
  // 目標の印（O-52）を出すか（既定はオン。画面の表示の好みなので絞り込みの条件には入れず、viewState にだけ覚える〔読み込み直すとオン〕）。
  // 登録した目標がないときは隠す
  const marksToggle = el('label', 'owned-marks-toggle');
  const marksCheck = el('input');
  marksCheck.type = 'checkbox';
  marksCheck.checked = memory?.showMarks !== false;
  marksToggle.append(marksCheck, el('span', '', '目標の印'));
  marksToggle.title = '登録した目標の完成品と、目標の欲しいパッシブを持つ個体に印を付けます（印の文字もキーワードで探せます）';
  marksToggle.hidden = true;
  const routeLink = panelLink('継承ルート →', 'このパッシブを運ぶ継承ルートを開く');

  // ---- パネル（sticky。高さは画面の section の --panel-h に書き続ける〔owned-rows の列見出しの top・scroll-margin-top が使う〕） ----
  const panelItem = (caption, control, { tag = 'div', hidden = false, className = '' } = {}) => {
    const node = el(tag, `owned-panel-item ${className}`.trim());
    const label = el('span', 'field-label', caption);
    if (hidden) label.setAttribute('aria-hidden', 'true');
    node.append(label, control);
    return node;
  };
  const panel = el('section', 'owned-panel');
  panel.setAttribute('aria-label', '所持パルの絞り込み');
  const panelMain = el('div', 'owned-panel-main');
  const keywordField = field('キーワード', query);
  keywordField.classList.add('owned-keyword');
  panelMain.append(picker.element, passive.element, keywordField);
  const panelSub = el('div', 'owned-panel-sub');
  panelSub.append(
    panelItem('所持者', holderSelect.element, { hidden: true, className: 'owned-holder-item' }),
    panelItem('場所', placeBox, { hidden: true, className: 'owned-places' }),
    panelItem('パッシブ', modeChoice.element, { hidden: true }),
    panelItem('個体値（以上）', talentBox),
    panelItem('★', stars, { tag: 'label', hidden: true, className: 'owned-stars-item' }),
    elementSlot,
  );
  const statusRow = el('div', 'owned-status-row');
  statusRow.append(count, chipBox, chipMoreSlot, marksToggle, resetButton, copySlot, sort, idealLink, routeLink);
  panel.append(panelMain, panelSub, statusRow);
  // ---- 列見出し（F069。押すとその並べ替え、もう一度で向きを反対に）。syncList の行の入れ物とは別の要素で、列の幅は CSS の
  // --owned-cols を行と共有する。パネルの下に貼り付く。並べ替えの選択（状態の行）と同じ filter.sort・filter.dir を使う ----
  const head = el('div', 'owned-list-head');
  head.setAttribute('role', 'toolbar');
  // 状態の行の並べ替えの選択（aria-label「並べ替え」）と名前を分ける
  head.setAttribute('aria-label', '列見出しで並べ替え');
  const headButtons = new Map();
  const headButton = ([key, text, name]) => {
    const node = button('', () => pressHead(key), 'owned-head-button');
    node.setAttribute('data-value', key);
    const arrow = el('span', 'owned-head-arrow');
    arrow.setAttribute('aria-hidden', 'true');
    node.append(el('span', 'owned-head-text', text), arrow);
    headButtons.set(key, { node, name, arrow });
    return node;
  };
  const headGroup = (className, columns) => {
    const group = el('div', className);
    group.append(...columns.map(headButton));
    return group;
  };
  head.append(
    headButton(HEAD_COLUMNS.dex),
    headGroup('owned-head-level', [HEAD_COLUMNS.level, HEAD_COLUMNS.stars]),
    headButton(HEAD_COLUMNS.passives),
    headGroup('owned-head-talent', [HEAD_COLUMNS.hp, HEAD_COLUMNS.shot, HEAD_COLUMNS.defense, HEAD_COLUMNS.talent]),
    headButton(HEAD_COLUMNS.place),
  );
  // 列見出しは 1 つのタブ止まり（押している見出し）で、←→・Home・End で見出しの間を移る（toolbar の決まり）
  head.addEventListener('keydown', (event) => {
    const nodes = [...headButtons.values()].map((item) => item.node);
    const index = nodes.indexOf(globalThis.document?.activeElement);
    if (index < 0) return;
    const to = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: nodes.length - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    const target = nodes[(to + nodes.length) % nodes.length];
    for (const node of nodes) node.tabIndex = node === target ? 0 : -1;
    target.focus();
  });
  function renderHead() {
    for (const [key, { node, name, arrow }] of headButtons) {
      const pressed = key === filter.sort;
      const dir = pressed ? filter.dir : SORT_DIRS.get(key);
      const label = `${name}で並べ替え（${HEAD_WORDS[key][dir]}）`;
      node.setAttribute('aria-pressed', String(pressed));
      node.setAttribute('aria-label', label);
      node.title = label;
      node.tabIndex = pressed ? 0 : -1;
      const mark = pressed ? (dir === 'desc' ? '▼' : '▲') : '';
      if (arrow.textContent !== mark) arrow.textContent = mark;
    }
  }
  // 見出しを押す: 同じキーなら向きを反対に、違うキーならそのキーの既定の向き
  function pressHead(key) {
    Object.assign(filter, key === filter.sort ? { dir: filter.dir === 'asc' ? 'desc' : 'asc' } : { sort: key, dir: SORT_DIRS.get(key) });
    applySort();
  }
  const results = el('div', 'owned-list');
  element.append(summary, panel, head, results);
  renderHead();
  const stopTracking = trackHeight(panel, element);
  // 固定の部分（パネルと、貼り付いた列見出し）の下端。自動の更新の後に見ていた行を同じ位置に戻すとき・見えている範囲だけ描くとき・
  // 一覧の先頭が隠れているかを見るときの基準
  const fixedBottom = () => {
    const bottom = panel.getBoundingClientRect?.().bottom ?? 0;
    if (head.hidden) return bottom;
    const rect = head.getBoundingClientRect?.();
    const height = rect ? rect.bottom - rect.top : 0;
    return bottom + (Number.isFinite(height) ? height : 0);
  };
  // 効いている条件のチップが 1 行に入り切らないときの「+n」（幅が変わったら数え直す）
  const chipObserver = typeof globalThis.ResizeObserver === 'function' ? new globalThis.ResizeObserver(() => measureChips()) : null;
  chipObserver?.observe(chipBox);

  // 部品の表示を絞り込みの値にそろえる（戻る・進む・URL・すべて解除・条件のチップの ×。作ったときに値を入れた部品も合わせる）
  function showFilter() {
    if (query.value !== filter.query) query.value = filter.query;
    stars.value = filter.stars ? String(filter.stars) : '';
    talents.update(filter.talent);
    syncPicker(picker, filter.palId);
    modeChoice.update(filter.passiveMode);
    showSort();
    holderSelect.update({ value: filter.holder });
    renderPlaces(owned.state);
    renderElements();
  }

  // 並べ替えの選択と列見出しを、今の並べ替えにそろえる
  function showSort() {
    const current = sortValue(filter.sort, filter.dir);
    syncOptions(sort, sortChoices(), (node) => { if (node.value !== current) node.value = current; });
    renderHead();
  }
  // 並べ替えは行の順番が変わるので動きを付ける（行が多いとスナップショットが重いので、2,000 行を超えるときは付けない。
  // 動きを減らす設定では withTransition が付けない）
  function applySort() {
    showSort();
    if (shownCount > VIRTUAL_OVER) changed();
    else withTransition(() => changed());
  }
  sort.addEventListener('change', () => {
    const [key, dir] = sort.value.split(':');
    Object.assign(filter, sortOf(key, dir));
    applySort();
  });
  // キーワードは入力を間引き、日本語の変換中は絞らない
  const keywordInput = onTextInput(query, (value) => { filter.query = value; changed(); }, { delay: inputDelay, signal: inputs.signal });
  pendingInputs.push(keywordInput);

  // 案内は、確かめている・読んでいる間（busy）は前の結果のまま残す（確認のたびに状態が「確認中」になって、
  // 許可・エラーの帯が消えてまた出ないように）。終わったら結果で描き直し、同じ案内なら要素も作り直さない
  let noticesKey = null;
  function renderSummary(state) {
    sourceLine.update(state);
    if (noticesKey !== null && (state.busy || state.auto?.status === 'checking')) return;
    const list = ownedNotices(state);
    const key = JSON.stringify(list);
    if (key === noticesKey) return;
    // 案内の帯はパネルより上にあるので、出入りすると下の一覧が上下する（一覧は overflow-anchor: none）。一覧の先頭がパネルの下に
    // 隠れるまでスクロールしているときは、帯は画面の外なので、書き換えた分だけスクロールして一覧を同じ位置に保つ。
    // ページの上の方を見ているときは動かさない（新しい帯が見えるように）
    const before = noticesKey !== null ? scrolledTop() : null;
    noticesKey = key;
    noticeList(list, notices, noticeActions);
    if (before === null) return;
    const moved = results.getBoundingClientRect().top - before;
    if (moved) globalThis.window?.scrollBy?.(0, moved);
  }
  // 一覧の先頭がパネル（と列見出し）の下に隠れているときの、一覧の上端の位置。隠れていなければ null
  function scrolledTop() {
    const top = results.getBoundingClientRect?.().top;
    return Number.isFinite(top) && top < fixedBottom() - 1 ? top : null;
  }

  // ---- データごとに 1 回だけ作るもの（場所の件数・拠点の件数・所持者の許す個体） ----
  let stats = null;
  function statsOf(data) {
    if (stats?.data === data) return stats;
    const counts = new Map();
    const baseCounts = new Map();
    for (const pal of data?.pals ?? []) {
      counts.set(pal.placeGroup, (counts.get(pal.placeGroup) ?? 0) + 1);
      if (pal.baseId) baseCounts.set(pal.baseId, (baseCounts.get(pal.baseId) ?? 0) + 1);
    }
    stats = { data, counts, baseCounts, baseIds: new Set([...(data?.bases ?? []).map((base) => base.id), ...baseCounts.keys()]) };
    return stats;
  }
  // 所持者で許す個体の ID の Set（理想個体と同じ意味）。データ・所持者・自分のプレイヤーが変わったときだけ作り直す。
  // （フェーズ 1d の participant-self は「自分」が変わったときに holderIds を null にしてから描き直す）
  let holderIds = null;
  function allowedIds(data) {
    if (!filter.holder || !data) return { ids: null, unknown: false };
    const self = filter.holder === 'mine' ? [...(context.ideals?.selfUids?.() ?? [])].join(',') : '';
    if (holderIds?.data === data && holderIds.holder === filter.holder && holderIds.self === self) return holderIds;
    let pals;
    let unknown = false;
    if (filter.holder === 'mine') {
      pals = context.ideals?.mine?.() ?? null;
      unknown = pals === null;
    } else pals = palsOfPlayers(data, new Set([filter.holder.replace(/^player:/, '')]));
    holderIds = { data, holder: filter.holder, self, ids: new Set((pals ?? []).map((pal) => pal.id)), unknown };
    return holderIds;
  }
  // 所持者の選択肢: すべて・自分の個体（ログイン中）・プレイヤー（自分を先頭に「（自分）」、同じ名前が 2 人以上なら UID の頭 8 字を添える）
  function holderChoices(data) {
    const players = data?.players ?? [];
    const self = context.ideals?.selfUids?.() ?? new Set();
    const names = new Map();
    for (const player of players) names.set(player.name, (names.get(player.name) ?? 0) + 1);
    const label = (player) => {
      if (self.has(player.uid)) return `${player.name || '不明なプレイヤー'}（自分）`;
      return !player.name || names.get(player.name) > 1 ? `${player.name || '不明なプレイヤー'}（${shortUid(player.uid)}）` : player.name;
    };
    const ordered = [...players.filter((player) => self.has(player.uid)), ...players.filter((player) => !self.has(player.uid))];
    return [['', 'すべて'], ...(context.ideals ? [['mine', '自分の個体']] : []), ...ordered.map((player) => [`player:${player.uid}`, label(player)])];
  }

  // 選択肢にない値は選ばない。読み込み前は選択肢がそろっていないため、選んでいた値は消さずに残す。
  // 選んでいる途中（フォーカス中）は作り直さず、離れてから作り直す。待っていた作り直し（blur の後）で選んでいた値を外したときは、
  // 一覧とパッシブの数も数え直す（renderFilters の中からのときは、呼んだ側がこの後で描く）
  let syncingFilters = false;
  let holderOptions = [['', 'すべて']];
  function renderHolders(state) {
    const choices = holderChoices(state.owned);
    holderOptions = choices;
    renderWhenIdle(holderSelect.element, () => {
      const valid = choices.some(([value]) => value === filter.holder);
      if (!valid && owned.state.owned && filter.holder) {
        filter.holder = '';
        if (!syncingFilters) renderResults();
      }
      holderSelect.update({ options: choices, value: valid ? filter.holder : '' });
    });
  }
  // データにない拠点（別のワールド・なくなった拠点）は外す（読み込み前は残す）
  function pruneBases(state) {
    if (!state.owned || !filter.bases.length) return;
    const known = statsOf(state.owned).baseIds;
    const kept = filter.bases.filter((id) => known.has(id));
    if (kept.length === filter.bases.length) return;
    filter.bases = kept;
    if (!syncingFilters) renderResults();
  }
  function renderPlaces(state) {
    const { counts } = statsOf(state.owned);
    for (const [group, chip] of placeChips) {
      const n = counts.get(group) ?? 0;
      chip.hidden = n === 0;
      chip.setAttribute('aria-pressed', String(filter.places.includes(group)));
      chip.setAttribute('aria-label', `${placeGroupLabel(group)}（${n} 体）`);
      const countNode = chip.children[1];
      if (countNode.textContent !== String(n)) countNode.textContent = String(n);
    }
    const hideMore = (state.owned?.bases?.length ?? 0) < 2 || placeChips.get('base').hidden;
    baseSlot.hidden = hideMore;
    baseMore.hidden = hideMore;
    baseMore.classList.toggle('is-active', filter.bases.length > 0);
    baseMore.setAttribute('aria-label', filter.bases.length ? `拠点を選ぶ（${filter.bases.length} か所を選択中）` : '拠点を選ぶ');
    if (hideMore && basePopover.isOpen()) basePopover.close({ focus: false });
    renderBases();
  }
  function renderFilters(state) {
    syncingFilters = true;
    try {
      renderHolders(state);
      pruneBases(state);
      renderPlaces(state);
      renderElements();
      showSort();
    } finally {
      syncingFilters = false;
    }
  }

  // ---- 効いている条件（既定から変えた条件だけ。× でその条件だけを既定に戻す） ----
  const sameList = (a, b) => a.length === b.length && a.every((item, index) => item === b[index]);
  function placesText() {
    const labels = (groups) => groups.map(placeGroupLabel).join('・');
    if (!filter.places.length) return 'なし';
    const removed = DEFAULT_PLACES.filter((group) => !filter.places.includes(group));
    const added = filter.places.filter((group) => !DEFAULT_PLACES.includes(group));
    if (!removed.length) return `${labels(added)}も含む`;
    if (filter.places.length <= 3) return labels(filter.places);
    return `${labels(removed)}を除く${added.length ? `・${labels(added)}を含む` : ''}`;
  }
  function activeConditions(state) {
    const items = [];
    const add = (key, text, clear) => items.push({ key, text, clear });
    if (filter.holder) {
      const name = holderOptions.find(([value]) => value === filter.holder)?.[1] ?? filter.holder.replace(/^player:/, '');
      add('holder', `所持者: ${name}`, () => { filter.holder = ''; });
    }
    if (!sameList(filter.places, DEFAULT_PLACES)) add('places', `場所: ${placesText()}`, () => { filter.places = [...DEFAULT_PLACES]; });
    if (filter.bases.length) {
      const baseName = (id) => state.owned?.bases?.find((base) => base.id === id)?.label ?? '拠点';
      add('bases', `拠点: ${filter.bases.map(baseName).join('・')}`, () => { filter.bases = []; });
    }
    if (filter.elements.length) add('elements', `属性: ${filter.elements.map((key) => ELEMENTS[key]).join('・')}`, () => { filter.elements = []; });
    if (filter.palId) add('pal', `パル: ${palsById.get(filter.palId)?.ja ?? filter.palId}`, () => { filter.palId = ''; });
    if (filter.passiveMode === 'none') add('passiveMode', 'パッシブなし', () => { filter.passiveMode = 'include'; });
    else {
      for (const id of filter.passives) {
        add(`passive:${id}`, `パッシブ: ${passivesById.get(id)?.ja ?? id}`, () => { filter.passives = filter.passives.filter((item) => item !== id); });
      }
      if (filter.passiveMode === 'only') add('passiveMode', 'パッシブの条件: だけ', () => { filter.passiveMode = 'include'; });
    }
    if (filter.stars) add('stars', STAR_FILTERS.find(([value]) => value === String(filter.stars))?.[1] ?? `★${filter.stars} 以上`, () => { filter.stars = 0; });
    for (const [key, label] of TALENT_FILTERS) {
      if (filter.talent[key] > 0) add(`talent:${key}`, `${label} ${filter.talent[key]} 以上`, () => { filter.talent = { ...filter.talent, [key]: 0 }; });
    }
    if (filter.query) {
      add('query', `キーワード: ${filter.query}`, () => {
        keywordInput.cancel();
        filter.query = '';
      });
    }
    return items;
  }
  // 条件のチップ（× でその条件を外す）。状態の行と「+n」の板で同じ形
  function chipButton(condition, onClear) {
    const chip = button('', onClear, 'filter-chip');
    const textNode = el('span', 'filter-chip-text');
    const remove = el('span', 'filter-chip-x', '×');
    remove.setAttribute('aria-hidden', 'true');
    chip.append(textNode, remove);
    const show = (next) => {
      if (textNode.textContent !== next.text) textNode.textContent = next.text;
      chip.setAttribute('aria-label', `${next.text} を外す`);
      chip.title = next.text;
    };
    show(condition);
    return { chip, show };
  }
  // 状態の行のチップの入れ物 → そのチップの今の条件（「+n」の板に隠れたチップを出すとき）
  const chipConditions = new WeakMap();
  function chipRow(first) {
    let current = first;
    const wrap = el('span', 'filter-chip-item');
    const { chip, show } = chipButton(first, () => {
      current.clear();
      showFilter();
      changed();
    });
    // × で外した後は、次のチップ（無ければ前のチップ）へ。チップが無くなればキーワードへ（syncList の fallbackFocus）
    chip.setAttribute('data-focus', 'chip');
    wrap.append(chip);
    chipConditions.set(wrap, () => current);
    return {
      element: wrap,
      update(next) {
        current = next;
        show(next);
      },
    };
  }
  function renderChips(state) {
    const items = activeConditions(state);
    // 隠れていたチップも、外した後のフォーカスの行き先になれるよう inert を外しておく（どれが隠れるかは描いた後に measureChips が決め直す）
    for (const wrap of chipBox.children) wrap.inert = false;
    syncList(chipBox, items, { key: (item) => item.key, create: chipRow, fallbackFocus: query });
    resetButton.disabled = !items.length;
    afterLayout(measureChips);
  }
  // 「+n」の板: 隠れたチップを並べる。focus は板を作り直した後にフォーカスを置く項目の番号（範囲の外なら最後の項目）。
  // 隠れたチップがなくなったら板を閉じ、状態の行の最後のチップ（無ければキーワード）へ
  let hiddenChips = [];
  const chipList = el('div', 'filter-more-list');
  chipPopover.element.append(chipList);
  function renderHiddenChips({ focus = null } = {}) {
    if (!chipPopover.isOpen()) return;
    const conditions = hiddenChips.map((wrap) => chipConditions.get(wrap)?.()).filter(Boolean);
    const inside = chipPopover.element.contains(globalThis.document?.activeElement);
    if (!conditions.length) {
      chipPopover.close({ focus: false });
      if (inside) lastChipOrQuery().focus({ preventScroll: true });
      return;
    }
    // 作り直す間もフォーカスを板の中に残す（外れると focusOut で板が閉じる）。外していないときは同じ番号の項目へ戻す
    const current = [...chipList.children].indexOf(globalThis.document?.activeElement);
    if (inside) chipPopover.element.focus({ preventScroll: true });
    if (inside && pendingChipFocus === null && current >= 0) pendingChipFocus = current;
    chipList.replaceChildren(...conditions.map((condition, index) => chipButton(condition, () => {
      // 外した後は同じ番号の項目（無ければ前の項目）へ。描き直した後の measureChips で板を作り直すときに使う
      pendingChipFocus = index;
      condition.clear();
      showFilter();
      changed();
    }).chip));
    const at = focus ?? (inside ? pendingChipFocus : null);
    pendingChipFocus = null;
    if (at !== null) chipList.children[Math.min(at, chipList.children.length - 1)]?.focus({ preventScroll: true });
  }
  let pendingChipFocus = null;
  const lastChipOrQuery = () => chipBox.lastElementChild?.querySelector('.filter-chip') ?? query;
  // 次の描画の前に 1 回だけ呼ぶ（同じ関数は 1 回にまとめる）。requestAnimationFrame が無い環境（テスト）ではすぐ呼ぶ
  const layoutJobs = new Set();
  function afterLayout(job) {
    if (typeof globalThis.requestAnimationFrame !== 'function') { job(); return; }
    if (!layoutJobs.size) {
      globalThis.requestAnimationFrame(() => {
        const jobs = [...layoutJobs];
        layoutJobs.clear();
        if (!destroyed) for (const run of jobs) run();
      });
    }
    layoutJobs.add(job);
  }
  // 1 行目より下に回ったチップの数を「+n」に出す（チップの入れ物は 1 行分の高さで、はみ出しは隠す。名前は title に）。
  // 隠れたチップは inert（Tab で止まらず、読み上げにも出さない。中身は「+n」の板で見る）。隠れるチップにフォーカスがあれば「+n」へ
  function measureChips() {
    const items = [...chipBox.children];
    const top = items[0]?.getBoundingClientRect?.().top;
    const hidden = Number.isFinite(top) ? items.filter((node) => (node.getBoundingClientRect?.().top ?? top) > top + 1) : [];
    const active = globalThis.document?.activeElement;
    const focusHidden = hidden.some((node) => node.contains(active));
    // 「+n」にフォーカスがあるまま隠れるチップがなくなったら（「+n」が見えなくなる）、最後のチップかキーワードへ
    const focusMore = active === chipMore && !hidden.length;
    for (const node of items) node.inert = hidden.includes(node);
    hiddenChips = hidden;
    const text = hidden.length ? `+${hidden.length}` : '';
    if (chipMore.textContent !== text) chipMore.textContent = text;
    chipMore.title = hidden.map((node) => node.querySelector('.filter-chip-text')?.textContent ?? '').join('\n');
    // 読み上げの名前にも見えている「+n」を入れる
    if (hidden.length) chipMore.setAttribute('aria-label', `${text}（隠れている条件 ${hidden.length} 個）`);
    else chipMore.removeAttribute('aria-label');
    chipMore.classList.toggle('is-empty', !hidden.length);
    if (focusHidden) chipMore.focus({ preventScroll: true });
    else if (focusMore) lastChipOrQuery().focus({ preventScroll: true });
    renderHiddenChips();
  }
  // 理想個体・継承ルートへのリンク（O-40）。理想個体には正のランクのパッシブだけを渡す
  function renderLinks() {
    idealLink.hidden = !filter.palId;
    if (filter.palId) {
      const wanted = filter.passives.filter((id) => (passivesById.get(id)?.rank ?? 0) > 0);
      idealLink.href = buildHash('ideal', { to: filter.palId, p: wanted.join(',') });
    }
    const carry = filter.passiveMode !== 'none' && filter.passives.length > 0;
    routeLink.hidden = !carry;
    if (carry) routeLink.href = buildHash('route', { p: filter.passives.join(',') });
  }
  // 件数の行: 「N / 全 M 体 · ♂a ♀b タマゴ c」。グローバルパルボックスを外していて数があれば title に。自分のプレイヤーが分からなければその旨
  function renderCount(state, shown, totals, holder) {
    if (!state.owned) {
      count.textContent = '';
      count.title = '';
      return;
    }
    const detail = holder.unknown ? '自分のプレイヤーが分かりません' : `♂${totals.M} ♀${totals.F}${totals.eggs ? ` タマゴ ${totals.eggs}` : ''}`;
    const text = `${shown} / ${state.owned.pals.length} 体 · ${detail}`;
    if (count.textContent !== text) count.textContent = text;
    const globals = statsOf(state.owned).counts.get('global') ?? 0;
    count.title = !filter.places.includes('global') && globals ? `グローバル ${globals} 体は非表示` : '';
  }
  // 絞り込んだ結果のパッシブの所持数と ♂♀・タマゴの数（結果を 1 回だけ走査する）
  function totalsOf(list) {
    const counts = new Map();
    let M = 0;
    let F = 0;
    let eggs = 0;
    for (const pal of list) {
      for (const id of pal.passives) counts.set(id, (counts.get(id) ?? 0) + 1);
      if (pal.egg) eggs++;
      else if (pal.gender === 'M') M++;
      else if (pal.gender === 'F') F++;
    }
    return { counts, M, F, eggs };
  }
  // 条件を変えたとき、一覧の先頭がパネルの下に隠れているときだけ、一覧の先頭を見せる（scroll-margin-top でパネルの下に出す）
  // 位置を読むのは次の描画の前（入力・押した処理の中で、描き換えた一覧のレイアウトを強制しない。2,000 行で 1 回の処理が長くならないように）
  function revealResults() {
    afterLayout(() => {
      if (destroyed) return;
      const top = results.getBoundingClientRect?.().top;
      const bottom = fixedBottom();
      if (!Number.isFinite(top) || !Number.isFinite(bottom) || top >= bottom - 1) return;
      // 同じ操作でパネルの高さが変わった（パッシブのチップの改行など）ときは、ResizeObserver の知らせがまだ来ていないので
      // --panel-h（scroll-margin-top が使う）が前の値のまま。今の高さを書いてから動かす（前は 1 行目の上 約 30px が列見出しに隠れた）
      stopTracking.measure?.();
      results.scrollIntoView({ block: 'start' });
    });
  }
  function resetAll() {
    const active = globalThis.document?.activeElement;
    // 0 件の表示の「条件をすべて解除」は消え、状態の行の「すべて解除」は押せなくなる（disabled でフォーカスが body に落ちる）ので、
    // どちらから押したときもキーワードへ移す
    const moveFocus = results.contains(active) || active === resetButton;
    keywordInput.cancel();
    adopt(filter, { ...migrateFilter({}), sort: filter.sort, dir: filter.dir });
    showFilter();
    changed();
    if (moveFocus) query.focus({ preventScroll: true });
  }
  // コピーの要求の番号（クリップボードの返事を待つ間に画面を閉じた・もう一度押したときは、前の返事で板を開かない）
  let copySeq = 0;
  async function copyLink() {
    flushInputs();
    const seq = ++copySeq;
    const url = `${globalThis.location?.origin ?? ''}${globalThis.location?.pathname ?? ''}${buildHash('owned', filterParams(filter))}`;
    linkUrl = url;
    let copied = false;
    try {
      await globalThis.navigator.clipboard.writeText(url);
      copied = true;
    } catch {
      // 権限がない・HTTP（clipboard がない）など。例外は出さず、下で欄に出して選ぶ
    }
    // 返事を待つ間に閉じた画面の板・document のリスナーを付け直さない
    if (destroyed || seq !== copySeq) return;
    if (copied) {
      linkPopover.close({ focus: false });
      toast('リンクをコピーしました');
    } else if (linkPopover.isOpen()) {
      linkInput.value = linkUrl;
      linkInput.focus();
      linkInput.select?.();
    } else linkPopover.open();
  }
  function flushInputs() {
    for (const input of pendingInputs) input.flush();
    talents.flush();
  }

  // ---- 一覧（行は個体の ID で使い回す。中身が同じ行は触らない） ----
  let terms = [];
  let termsKey = '';
  // 1 回の描き直しで、すぐ書き換える既にある行の数（先頭から。FILL_NOW）。残りの書き換えは区切って行う（キーワードで一致の理由が多くの行で
  // 変わるときに止まらないように）。作ったばかりの行はいつもすぐ中身を入れる
  let fillBudget = FILL_NOW;
  const deferred = new Map();
  let flushing = false;
  function flushDeferred() {
    if (flushing || !deferred.size) return;
    flushing = true;
    const tick = () => {
      if (destroyed) { deferred.clear(); flushing = false; return; }
      const start = clock();
      for (const [item, next] of deferred) {
        deferred.delete(item);
        item.fill(next);
        if (clock() - start >= SLICE_MS * 0.75) break;
      }
      if (deferred.size) nextFrame(tick);
      else flushing = false;
    };
    nextFrame(tick);
  }
  // 行に渡すもの（キーワードに一致した理由・目標の印・行の操作）
  const rowOptionsOf = (pal) => ({ notes: terms.length ? keywordNotes(pal, terms) : [], marks: shownMarks?.get(pal.id) ?? [], actions: true });
  // 行の要素 → 行の部品（行の操作を、触れた行にだけ作るとき）
  const rowParts = new WeakMap();
  // 一覧の 1 行（ownedRowItem を、区切った書き換えに乗せる）。作ったばかりの行と、先頭から決まった数（FILL_NOW）の行はすぐ書き換え、
  // 残りは区切って書き換える（区切る行は、一致の理由・印を求めるのも書き換えるときにする）。中身は変わったセルだけを書き換える
  //（一致の理由だけが変わったら理由の行だけ）
  function listRow(pal) {
    let last = pal;
    let lastTerms = termsKey;
    let lastMarks = marksStamp;
    const first = rowOptionsOf(pal);
    const row = ownedRowItem(pal, first);
    let signature = rowSignature(pal, first.notes, first.marks);
    rowParts.set(row.element, row);
    const item = {
      element: row.element,
      // 今のキーワード・印で next の中身にする（同じなら何もしない）
      fill(next) {
        const options = rowOptionsOf(next);
        const nextSignature = rowSignature(next, options.notes, options.marks);
        if (nextSignature === signature) return;
        row.update(next, options);
        signature = nextSignature;
      },
      update(next) {
        // 区切って足すときは同じ個体で何度も呼ばれるので、個体・キーワード・印が同じなら何もしない
        if (next === last && termsKey === lastTerms && marksStamp === lastMarks) return;
        last = next;
        lastTerms = termsKey;
        lastMarks = marksStamp;
        if (fillBudget <= 0) { deferred.set(item, next); return; }
        fillBudget--;
        deferred.delete(item);
        item.fill(next);
      },
      destroy() {
        deferred.delete(item);
        row.destroy();
      },
    };
    return item;
  }
  // 行の操作（F063・O-38）は、初めて触れた行（ポインターが乗った・フォーカスが入った行）にだけ作る（2,000 行ぶんを最初から作らない）
  const rowOf = (target) => {
    for (let node = target; node && node !== results; node = node.parentElement) {
      const row = rowParts.get(node);
      if (row) return row;
    }
    return null;
  };
  // 操作を出しておく行は、ポインターが乗っている行とフォーカスのある行の 2 つまで（離れた行の操作は外す。触れた行に付けたままにすると、
  // 1,500 行ほど触れたところで DOM の予算を超えるため）。フォーカスが操作の中にある行は外さない
  const actionRows = { pointer: null, focus: null };
  function touchRow(kind, row, next) {
    const previous = actionRows[kind];
    if (previous === row) return;
    actionRows[kind] = row;
    row?.showActions();
    if (previous && previous !== actionRows.pointer && previous !== actionRows.focus) previous.hideActions(next);
  }
  results.addEventListener('pointerover', (event) => touchRow('pointer', rowOf(event.target)), { signal: inputs.signal });
  results.addEventListener('pointerleave', () => touchRow('pointer', null), { signal: inputs.signal });
  results.addEventListener('focusin', (event) => touchRow('focus', rowOf(event.target), event.target), { signal: inputs.signal });
  // 一覧の外へフォーカスが出たとき（一覧の中の移動は、続く focusin で付け替える）
  results.addEventListener('focusout', (event) => {
    if (!event.relatedTarget || !results.contains(event.relatedTarget)) touchRow('focus', null, event.relatedTarget ?? null);
  }, { signal: inputs.signal });

  // ---- 目標の印（O-52）。登録した目標とデータから、どちらかが変わったときに 1 回だけ作る（core/ideal-goals.js の goalMarks） ----
  const ideals = context.ideals;
  let marks = { data: undefined, key: null, map: new Map(), count: 0 };
  // 印を作り直した回数（行の書き換えの判定に使う）
  let marksVersion = 0;
  let shownMarks = null;
  let marksStamp = '';
  const goalsKey = (goals) => JSON.stringify(goals.map((goal) => [goal.id, goal.name, goal.palId, goal.passives, goal.mode, goal.targets]));
  function marksOf(data) {
    const goals = ideals?.list?.() ?? [];
    const key = goalsKey(goals);
    if (marks.data === data && marks.key === key) return marks.map;
    marks = { data, key, map: data && goals.length ? goalMarks(goals, data.pals) : new Map(), count: goals.length };
    marksVersion++;
    return marks.map;
  }
  marksCheck.addEventListener('change', () => {
    if (memory) memory.showMarks = marksCheck.checked;
    renderResults();
  });
  // 目標を保存・外したとき（ほかのタブも）。完成の判定の書き直しなど、印に関わらない保存では描き直さない
  const stopGoals = ideals?.subscribe?.(() => {
    if (destroyed || goalsKey(ideals.list()) === marks.key) return;
    renderResults({ keepPosition: true });
  }) ?? (() => {});
  // 0 件のとき。中の「条件をすべて解除」は今の条件を読む（syncList は同じ文の空の表示を作り直さない）
  let emptyText = '条件に合うパルはいません。';
  const rowOptions = {
    key: (pal) => pal.id, create: listRow,
    empty: () => empty(emptyText, button('条件をすべて解除', () => resetAll(), 'button secondary')),
  };
  // 描画の仕事の番号（条件の変更・データの更新・画面の破棄で古い仕事を止める）
  let jobSeq = 0;
  let destroyed = false;
  let virtual = null;
  let shownCount = 0;
  const leaveVirtual = () => {
    if (!virtual) return;
    virtual.destroy();
    virtual = null;
  };
  // keepPosition: データの更新のとき（条件の変更では戻さない）、見ていた行を同じ位置に戻す
  function renderResults({ keepPosition = false } = {}) {
    // 閉じた後に遅れて呼ばれたとき（並べ替えの動きの後など）は描かない
    if (destroyed) return;
    const job = ++jobSeq;
    fillBudget = FILL_NOW;
    const state = owned.state;
    renderChips(state);
    renderLinks();
    const none = filter.passiveMode === 'none';
    if (!state.owned) {
      renderCount(state, 0, null, { unknown: false });
      shownCount = 0;
      head.hidden = true;
      results.classList.toggle('is-empty', true);
      marksToggle.hidden = true;
      passive.update({ selected: filter.passives, counts: new Map(), disabled: none });
      leaveVirtual();
      clearList(results);
      results.append(empty(state.ready ? '表示できる所持パルがありません。' : '読み込み中…'));
      return;
    }
    const holder = allowedIds(state.owned);
    // 目標の印（表示がオンのときだけ。印の文字もキーワードで探す）
    const markMap = marksOf(state.owned);
    marksToggle.hidden = !marks.count;
    shownMarks = marksCheck.checked && marks.count ? markMap : null;
    marksStamp = shownMarks ? `on:${marksVersion}` : 'off';
    const matched = filterOwned(state.owned.pals, { ...filter, ids: holder.ids, extraTexts: shownMarks });
    const totals = totalsOf(matched);
    passive.update({ selected: filter.passives, counts: totals.counts, disabled: none });
    const list = sortOwned(matched, filter.sort, filter.dir);
    terms = keywordTerms(filter.query);
    termsKey = terms.join(' ');
    // 空の表示だけのときは帯を敷かない（CSS の .owned-list.is-empty。:has() は行の出し入れのたびに全体を計算し直させるので使わない）
    results.classList.toggle('is-empty', !list.length);
    head.hidden = !list.length;
    renderCount(state, list.length, totals, holder);
    emptyText = holder.unknown
      ? '自分のプレイヤーが分からないため、自分の個体で絞れません（所持者を「すべて」にすると全員の個体が出ます）。'
      : '条件に合うパルはいません。';
    shownCount = list.length;
    const anchor = keepPosition ? anchorOf(virtual ? virtual.rows : results, fixedBottom()) : null;
    // 2,000 行を超えたら、見えている範囲だけを描く
    if (list.length > VIRTUAL_OVER) {
      if (!virtual) {
        clearList(results);
        virtual = virtualRows(results, { key: rowOptions.key, create: listRow, estimate: ROW_ESTIMATE, topOffset: fixedBottom });
      }
      // 見ていた行の位置で先に描く（今の位置より前に多数の行が増えても戻せる）。測った高さとのずれは restoreAnchor で直す
      virtual.render(list, { anchor });
      restoreAnchor(virtual.rows, anchor);
      flushDeferred();
      return;
    }
    leaveVirtual();
    const existing = listKeys(results);
    let fresh = 0;
    for (const pal of list) if (!existing.has(pal.id)) fresh++;
    // 件数が多くても、最初からすべて出す（もっと見るはない）。まだ無い行が多いときだけ、先頭の 200 行をすぐ出して残りを区切って足す
    if (fresh <= FIRST_ROWS) {
      syncList(results, list, rowOptions);
      restoreAnchor(results, anchor);
      flushDeferred();
      return;
    }
    // 出す行 = 残る既存の行 ∪ 先頭の 200 行。既存の行は消さずに使い回し（一覧が縮んで位置が飛ばない）、
    // まだ無い行を並び順に step 件ずつ足していく
    const present = new Set();
    list.forEach((pal, i) => { if (i < FIRST_ROWS || existing.has(pal.id)) present.add(pal.id); });
    const inPresent = () => list.filter((pal) => present.has(pal.id));
    let next = FIRST_ROWS;
    let step = 100;
    syncList(results, inPresent(), rowOptions);
    let anchored = restoreAnchor(results, anchor);
    const tick = () => {
      if (job !== jobSeq || destroyed) return;
      const start = clock();
      for (let added = 0; next < list.length && added < step; next++) {
        if (present.has(list[next].id)) continue;
        present.add(list[next].id);
        added++;
      }
      syncList(results, inPresent(), rowOptions);
      if (!anchored) anchored = restoreAnchor(results, anchor);
      const spent = clock() - start;
      step = Math.max(STEP_MIN, Math.min(STEP_MAX, Math.round(spent > 0 ? step * (SLICE_MS * 0.75) / spent : STEP_MAX)));
      if (next < list.length) nextFrame(tick);
      else flushDeferred();
    };
    nextFrame(tick);
  }

  // キーワードで探す文字列を、入力の前に区切って作っておく（行が多いと、初めてのキーワードの入力で止まるため）
  let warmSeq = 0;
  function warmKeywords(data) {
    const seq = ++warmSeq;
    const list = data?.pals ?? [];
    let next = 0;
    const tick = () => {
      if (seq !== warmSeq || destroyed) return;
      const start = clock();
      while (next < list.length && clock() - start < SLICE_MS / 2) {
        const end = Math.min(list.length, next + 200);
        for (; next < end; next++) prepareKeywords(list[next]);
      }
      if (next < list.length) setTimeout(tick, 0);
    };
    if (list.length > FIRST_ROWS) setTimeout(tick, 0);
  }

  let renderedOwned;
  let renderedReady;
  function update(state) {
    renderSummary(state);
    // データが変わったとき。データが無いままでも、読み込みが終わったら（ready）「読み込み中…」を案内に描き直す
    if (state.owned === renderedOwned && (state.owned || state.ready === renderedReady)) return;
    renderedOwned = state.owned;
    renderedReady = state.ready;
    renderFilters(state);
    // 候補を開いたままでも、所持数だけ描き直す（閉じない）
    picker.update();
    renderResults({ keepPosition: true });
    warmKeywords(state.owned);
  }

  const unsubscribe = owned.subscribe(update);
  renderedOwned = owned.state.owned;
  renderedReady = owned.state.ready;
  renderSummary(owned.state);
  renderFilters(owned.state);
  renderResults();
  warmKeywords(owned.state.owned);
  owned.load().then(() => owned.autoRefresh()).catch(() => {});
  // 開いている間は読み直す（参加している人も、ホストが共有し直した所持パルが入る）
  const stopRefreshing = keepRefreshing(owned);
  return {
    element, update,
    // 同じ画面のまま絞り込みつきの URL が来たとき（URL が条件のすべてを決める）・戻る・進むで app.js が履歴のエントリの条件を filter に
    // 入れ直したとき（restored。前の形の条件も migrateFilter で読み替える）。作り直さずに、部品の表示と一覧を合わせる
    applyRoute(next, { restored = false } = {}) {
      if (restored) adopt(filter, migrateFilter(filter));
      const fromUrl = readRoute(next);
      if (!fromUrl && !restored) return;
      keywordInput.cancel();
      showFilter();
      renderFilters(owned.state);
      renderResults();
    },
    // 間引いて待っている入力（キーワード・個体値）をすぐ当てる（app.js が、移る前に履歴のエントリへ条件を書く前に呼ぶ）
    flushInputs,
    destroy() {
      destroyed = true;
      stopRefreshing();
      stopGoals();
      stopTracking();
      chipObserver?.disconnect();
      sourceLine.destroy();
      inputs.abort();
      for (const input of pendingInputs) input.cancel();
      talents.destroy();
      modeChoice.destroy();
      holderSelect.destroy();
      basePopover.destroy();
      presetMenu.destroy();
      elementPopover.destroy();
      linkPopover.destroy();
      chipPopover.destroy();
      jobSeq++;
      warmSeq++;
      unsubscribe();
      picker.destroy();
      passive.destroy();
      leaveVirtual();
      clearList(results);
    },
  };
}
