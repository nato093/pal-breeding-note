import { el, field, empty, button, link, syncList, listKeys, clearList, anchorOf, restoreAnchor, onTextInput, trackHeight } from '../ui/dom.js';
import { palTile, humanIcon, palsById } from '../ui/pal-icon.js';
import { palPicker } from '../ui/pal-picker.js';
import { passiveList, passiveSelector, passivesById } from '../ui/passive-picker.js';
import { talentInput } from '../ui/talent-input.js';
import { segmented } from '../ui/segmented.js';
import { searchSelect } from '../ui/search-select.js';
import { createPopover } from '../ui/popover.js';
import { ownedNotices, noticeList, ownedSourceLine } from '../ui/owned-status.js';
import { virtualRows } from '../ui/virtual-list.js';
import { withTransition } from '../ui/motion.js';
import { viewHeading, syncPicker, renderWhenIdle, ownedSpeciesNotes, keepRefreshing, changeRoute } from './shared.js';
import { toast } from '../ui/toast.js';
import { buildHash } from '../router.js';
import {
  filterOwned, sortOwned, keywordTerms, keywordNotes, prepareKeywords, OWNED_SORTS, PLACE_ORDER, placeGroupLabel, shortUid,
} from '../core/owned.js';
import { palsOfPlayers } from '../core/ideal-goals.js';
import { normalizeQuery, queryTerms } from '../core/kana.js';
import { cleanSaved, list, internalName, idText, text, oneOf, intIn, BASES_MAX } from '../core/boundary.js';
import { ELEMENTS } from '../../data/pals.js';

function option(value, label) {
  const node = el('option', '', label);
  node.value = value;
  return node;
}

function talentText(talent) {
  return `HP ${talent.hp} / 攻 ${talent.shot} / 防 ${talent.defense}`;
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
  sort: (value) => oneOf(value, SORT_KEYS, 'dex'),
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
 * 所持者 global → 所持者なし・places: ['global']。places は PLACE_ORDER の順に並べる
 * @returns {{ holder: string, places: string[], bases: string[], elements: string[], palId: string, passives: string[],
 *   passiveMode: string, query: string, sort: string, stars: number, talent: { hp: number, shot: number, defense: number } }}
 */
export function migrateFilter(old) {
  const saved = cleanSaved(old, OWNED_MEMORY);
  let places = saved.places;
  if (!places) {
    places = saved.place ? [saved.place] : [...PLACE_ORDER];
    if (saved.eggs === false) places = places.filter((group) => group !== 'egg');
    if (saved.globals !== true) places = places.filter((group) => group !== 'global');
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
    passives: saved.passives, passiveMode: saved.passiveMode, query: saved.query, sort: saved.sort, stars: saved.stars, talent: saved.talent,
  };
}

// URL の絞り込みの名前（どれかがあれば、URL がすべての条件を決める。sort は並べ替えだけで、あれば入れる）
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
  if (filter.sort !== 'dex') params.set('sort', filter.sort);
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
const VIRTUAL_OVER = 2000;
// 残りの行を足す 1 回の区切り（16ms 以内）。前の区切りの速さで、足す行数を 25〜400 の間で増減する
const SLICE_MS = 16;
const STEP_MIN = 25;
const STEP_MAX = 400;
const clock = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());
const nextFrame = (fn) => (typeof globalThis.requestAnimationFrame === 'function' ? globalThis.requestAnimationFrame(fn) : setTimeout(fn, 0));
// 場所の検索欄を出す拠点の数
const BASE_SEARCH_OVER = 12;

// 行に出す値の署名（一致の理由を除く）と、一致の理由の署名。理由を入れ忘れると、キーワードを変えても古い理由が残る
const baseSignature = (pal) => [pal.palId, pal.known, pal.name, pal.human?.icon ?? '', pal.level, pal.rank, pal.stars,
  pal.passives.join(','), pal.talent.hp, pal.talent.shot, pal.talent.defense, pal.holder, pal.place, pal.placeLabel, pal.nickname,
  pal.gender, pal.egg, pal.lucky, pal.alpha, pal.lastOwner].join('\u0001');
const notesSignature = (notes) => notes.map((note) => `${note.label}:${note.name}:${note.desc}`).join('|');
export const rowSignature = (pal, notes) => `${baseSignature(pal)}\u0002${notesSignature(notes)}`;

// marks は行の印（理想個体の組の親の「別の配合牧場で使用中」など。owned-rows の O-52 の印も同じ口を使う）
function palCell(pal, marks = []) {
  const cell = el('div', 'owned-pal');
  if (pal.known) cell.append(palTile(pal.palId, { gender: pal.gender, genderFirst: true }));
  else {
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
    cell.append(unknown);
  }
  const badges = el('span', 'owned-badges');
  if (pal.nickname) badges.append(el('span', 'owned-badge', `「${pal.nickname}」`));
  if (pal.egg) badges.append(el('span', 'owned-badge badge-egg', 'タマゴ'));
  if (pal.lucky) badges.append(el('span', 'owned-badge badge-lucky', 'ラッキー'));
  if (pal.alpha) badges.append(el('span', 'owned-badge badge-alpha', 'アルファ'));
  for (const mark of marks) badges.append(el('span', 'owned-badge badge-mark', mark));
  if (badges.children.length) cell.append(badges);
  return cell;
}

/**
 * @param {{ notes?: { label: string, name: string, desc: string }[], highlight?: { wanted: string[], targets: { hp: number, shot: number, defense: number } }, marks?: string[] }} [options]
 *   notes は一致した理由（core/owned.js の keywordNotes）。highlight は理想個体の組の親で、欲しいパッシブと個体値の目標との差を見せる
 *   （無いとき〔所持パルの画面〕の行の中身・textContent は今までと同じ）。marks は名前の下の印（.owned-badges の span.owned-badge.badge-mark）
 */
export function ownedRow(pal, options) {
  return fillOwnedRow(el('article', 'owned-row'), pal, options);
}

/** 行の要素の中身を pal の内容で入れ直す（一覧で同じ個体の要素を使い回すとき）。オプションは ownedRow と同じ */
export function fillOwnedRow(row, pal, { notes = [], highlight, marks = [] } = {}) {
  row.setAttribute('aria-label', `${pal.name}${pal.nickname ? `（${pal.nickname}）` : ''}`);
  const level = el('div', 'owned-level');
  level.append(el('strong', '', pal.egg ? '孵化前' : `Lv ${pal.level}`), el('small', 'owned-stars', pal.stars ? '★'.repeat(pal.stars) : '☆なし'));
  const where = el('div', 'owned-where');
  where.append(el('strong', '', pal.holder), el('small', 'muted', pal.placeLabel));
  if (pal.place === 'base' && pal.lastOwner) where.append(el('small', 'muted', `預けた人 ${pal.lastOwner}`));
  const passives = el('div', 'owned-passives');
  passives.append(passiveCell(pal.passives, highlight?.wanted), ...noteLines(notes));
  row.replaceChildren(palCell(pal, marks), level, passives, talentCell(pal.talent, highlight?.targets), where);
  return row;
}

// パッシブの並び。欲しいパッシブ（wanted。1 つ以上のときだけ）があれば、欲しいものに ✓ を付け、それ以外を薄くする
function passiveCell(ids, wanted) {
  if (!ids.length) return el('span', 'muted', 'パッシブなし');
  const list = passiveList(ids);
  if (!wanted?.length) return list;
  const set = new Set(wanted);
  [...list.children].forEach((chip, index) => {
    if (!set.has(ids[index])) {
      chip.classList.add('is-extra');
      return;
    }
    chip.classList.add('is-wanted');
    const check = el('span', 'passive-check', '✓');
    check.setAttribute('role', 'img');
    check.setAttribute('aria-label', '欲しいパッシブ');
    chip.insertBefore(check, chip.children[0] ?? null);
  });
  return list;
}

const TALENT_SHORT = { hp: 'HP', shot: '攻', defense: '防' };
// 個体値の欄。目標（targets）があれば、ステータスごとのセル（span.talent-cell[data-key]）にして、
// 目標以上は .met、目標未満は .short と差（−N）を見せる（目標 0 は条件なしなので何もしない）。
// 目標がなければ今までどおり 1 つの文（所持パルの画面。行の数を増やさない）。owned-rows で 4 セルにする
function talentCell(talent, targets) {
  if (!targets) return el('div', 'owned-talent', talentText(talent));
  const cell = el('div', 'owned-talent');
  TALENT_FILTERS.forEach(([key, name], index) => {
    // 区切りは見た目だけ（テストの DOM に文字のノードがないので span にする）
    if (index) {
      const separator = el('span', 'talent-sep', ' / ');
      separator.setAttribute('aria-hidden', 'true');
      cell.append(separator);
    }
    const value = talent[key];
    const target = targets[key] ?? 0;
    const item = el('span', 'talent-cell', `${TALENT_SHORT[key]} ${value}`);
    item.setAttribute('data-key', key);
    item.setAttribute('role', 'img');
    if (target > 0 && value >= target) {
      item.classList.add('met');
      item.setAttribute('aria-label', `${name} ${value}（目標 ${target} 以上）`);
    } else if (target > 0) {
      item.classList.add('short');
      item.append(el('span', 'talent-diff', `−${target - value}`));
      item.setAttribute('aria-label', `${name} ${value}（目標 ${target} まで あと ${target - value}）`);
    } else item.setAttribute('aria-label', `${name} ${value}`);
    cell.append(item);
  });
  return cell;
}

// 一致した理由の行（パッシブの欄の下）
function noteLines(notes) {
  return notes.map((note) => {
    const line = el('p', 'owned-hit');
    line.append(el('span', 'owned-hit-name', `${note.label}：${note.name}`));
    if (note.desc) line.append(el('span', 'owned-hit-desc', note.desc));
    return line;
  });
}

// 一致した理由だけが変わった行は、パッシブの欄の理由の行だけを入れ直す（キーワードの入力のたびに行全体を作り直さない）
function replaceNotes(row, notes) {
  const passives = row.children[2];
  while (passives.children.length > 1) passives.lastElementChild.remove();
  passives.append(...noteLines(notes));
}

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
    const sortParam = next.params.has('sort') ? oneOf(next.params.get('sort'), SORT_KEYS, 'dex') : null;
    if (!fromUrl && sortParam === null) return false;
    if (fromUrl) adopt(filter, { ...fromUrl, sort: sortParam ?? filter.sort });
    else filter.sort = sortParam;
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
  for (const [key, label] of OWNED_SORTS) sort.append(option(key, label));
  sort.value = filter.sort;
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
    presetMenu.element.append(item);
  }
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
  const chipMore = el('span', 'filter-more is-empty');
  chipMore.setAttribute('aria-hidden', 'true');
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
  const linkPopover = createPopover({ anchor: copyButton, wrapper: copySlot, className: 'picker-popover owned-link-field', focusOut: true,
    onOpen: () => {
      linkInput.value = linkUrl;
      linkInput.focus();
      linkInput.select?.();
    } });
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
  statusRow.append(count, chipBox, chipMore, resetButton, copySlot, sort, idealLink, routeLink);
  panel.append(panelMain, panelSub, statusRow);
  const results = el('div', 'owned-list');
  element.append(summary, panel, results);
  const stopTracking = trackHeight(panel, element);
  // パネルの下端（自動の更新の後に見ていた行を同じ位置に戻すときと、見えている範囲だけ描くときの基準）
  const panelBottom = () => panel.getBoundingClientRect?.().bottom ?? 0;
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
    sort.value = filter.sort;
    holderSelect.update({ value: filter.holder });
    renderPlaces(owned.state);
    renderElements();
  }

  // 並べ替えは行の順番が変わるので動きを付ける（行が多いとスナップショットが重いので、2,000 行を超えるときは付けない）
  sort.addEventListener('change', () => {
    filter.sort = sort.value;
    if (shownCount > VIRTUAL_OVER) changed();
    else withTransition(() => changed());
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
    noticesKey = key;
    noticeList(list, notices, noticeActions);
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
      sort.value = filter.sort;
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
  function chipRow(first) {
    let current = first;
    const wrap = el('span', 'filter-chip-item');
    const chip = button('', () => {
      current.clear();
      showFilter();
      changed();
    }, 'filter-chip');
    // × で外した後は、次のチップ（無ければ前のチップ）へ。チップが無くなればキーワードへ（syncList の fallbackFocus）
    chip.setAttribute('data-focus', 'chip');
    const textNode = el('span', 'filter-chip-text');
    const remove = el('span', 'filter-chip-x', '×');
    remove.setAttribute('aria-hidden', 'true');
    chip.append(textNode, remove);
    wrap.append(chip);
    const item = {
      element: wrap,
      update(next) {
        current = next;
        if (textNode.textContent !== next.text) textNode.textContent = next.text;
        chip.setAttribute('aria-label', `${next.text} を外す`);
        chip.title = next.text;
      },
    };
    item.update(first);
    return item;
  }
  function renderChips(state) {
    const items = activeConditions(state);
    syncList(chipBox, items, { key: (item) => item.key, create: chipRow, fallbackFocus: query });
    resetButton.disabled = !items.length;
    afterLayout(measureChips);
  }
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
  // 1 行目より下に回ったチップの数を「+n」に出す（チップの入れ物は 1 行分の高さで、はみ出しは隠す。名前は title に）
  function measureChips() {
    const items = [...chipBox.children];
    const top = items[0]?.getBoundingClientRect?.().top;
    const hidden = Number.isFinite(top) ? items.filter((node) => (node.getBoundingClientRect?.().top ?? top) > top + 1) : [];
    const text = hidden.length ? `+${hidden.length}` : '';
    if (chipMore.textContent !== text) chipMore.textContent = text;
    chipMore.title = hidden.map((node) => node.querySelector('.filter-chip-text')?.textContent ?? '').join('\n');
    chipMore.classList.toggle('is-empty', !hidden.length);
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
      const bottom = panel.getBoundingClientRect?.().bottom;
      if (!Number.isFinite(top) || !Number.isFinite(bottom) || top >= bottom) return;
      results.scrollIntoView({ block: 'start' });
    });
  }
  function resetAll() {
    const inside = results.contains(globalThis.document?.activeElement);
    keywordInput.cancel();
    adopt(filter, { ...migrateFilter({}), sort: filter.sort });
    showFilter();
    changed();
    // 0 件の表示の「条件をすべて解除」は消えるので、キーワードへ
    if (inside) query.focus({ preventScroll: true });
  }
  async function copyLink() {
    flushInputs();
    linkUrl = `${globalThis.location?.origin ?? ''}${globalThis.location?.pathname ?? ''}${buildHash('owned', filterParams(filter))}`;
    try {
      await globalThis.navigator.clipboard.writeText(linkUrl);
      linkPopover.close({ focus: false });
      toast('リンクをコピーしました');
    } catch {
      // 権限がない・HTTP（clipboard がない）など。例外は出さず、欄に出して選ぶ
      if (linkPopover.isOpen()) {
        linkInput.value = linkUrl;
        linkInput.focus();
        linkInput.select?.();
      } else linkPopover.open();
    }
  }
  function flushInputs() {
    for (const input of pendingInputs) input.flush();
    talents.flush();
  }

  // ---- 一覧（行は個体の ID で使い回す。中身が同じ行は触らない） ----
  let terms = [];
  let termsKey = '';
  // 1 回の描き直しで、すぐ書き換える行の数（先頭から）。残りの書き換えは区切って行う（キーワードで一致の理由が多くの行で変わるときに止まらないように）
  let fillBudget = FIRST_ROWS;
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
  function ownedRowItem(pal) {
    let base = '';
    let shownNotes = null;
    let last = null;
    let lastTerms = null;
    const element = el('article', 'owned-row');
    const item = {
      element,
      // next: { pal, notes }
      fill({ pal: target, notes }) {
        const nextBase = baseSignature(target);
        const nextNotes = notesSignature(notes);
        if (nextBase !== base) fillOwnedRow(element, target, { notes });
        else if (nextNotes !== shownNotes) replaceNotes(element, notes);
        base = nextBase;
        shownNotes = nextNotes;
      },
      update(next) {
        // 区切って足すときは同じ個体で何度も呼ばれるので、個体とキーワードが同じなら何もしない
        if (next === last && termsKey === lastTerms) return;
        last = next;
        lastTerms = termsKey;
        const notes = terms.length ? keywordNotes(next, terms) : [];
        if (baseSignature(next) === base && notesSignature(notes) === shownNotes) { deferred.delete(item); return; }
        // まだ中身のない行（作ったばかり）と、先頭から決まった数の行はすぐ書き換え、残りは区切って書き換える
        if (base && fillBudget <= 0) { deferred.set(item, { pal: next, notes }); return; }
        fillBudget--;
        deferred.delete(item);
        item.fill({ pal: next, notes });
      },
      destroy() { deferred.delete(item); },
    };
    item.update(pal);
    return item;
  }
  // 0 件のとき。中の「条件をすべて解除」は今の条件を読む（syncList は同じ文の空の表示を作り直さない）
  let emptyText = '条件に合うパルはいません。';
  const rowOptions = {
    key: (pal) => pal.id, create: ownedRowItem,
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
    fillBudget = FIRST_ROWS;
    const state = owned.state;
    renderChips(state);
    renderLinks();
    const none = filter.passiveMode === 'none';
    if (!state.owned) {
      renderCount(state, 0, null, { unknown: false });
      shownCount = 0;
      passive.update({ selected: filter.passives, counts: new Map(), disabled: none });
      leaveVirtual();
      clearList(results);
      results.append(empty(state.ready ? '表示できる所持パルがありません。' : '読み込み中…'));
      return;
    }
    const holder = allowedIds(state.owned);
    const matched = filterOwned(state.owned.pals, { ...filter, ids: holder.ids });
    const totals = totalsOf(matched);
    passive.update({ selected: filter.passives, counts: totals.counts, disabled: none });
    const list = sortOwned(matched, filter.sort);
    terms = keywordTerms(filter.query);
    termsKey = terms.join(' ');
    renderCount(state, list.length, totals, holder);
    emptyText = holder.unknown
      ? '自分のプレイヤーが分からないため、自分の個体で絞れません（所持者を「すべて」にすると全員の個体が出ます）。'
      : '条件に合うパルはいません。';
    shownCount = list.length;
    const anchor = keepPosition ? anchorOf(virtual ? virtual.rows : results, panelBottom()) : null;
    // 2,000 行を超えたら、見えている範囲だけを描く
    if (list.length > VIRTUAL_OVER) {
      if (!virtual) {
        clearList(results);
        virtual = virtualRows(results, { key: rowOptions.key, create: ownedRowItem, estimate: 60, topOffset: panelBottom });
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
