import { el, field, empty, loadingState, button, link, syncList, listKeys, clearList, anchorOf, restoreAnchor, onTextInput, trackHeight, setDisabled } from '../ui/dom.js';
import { palTile, palIcon, humanIcon, palsById, genderMark, gameIcon, eggIcon, eggIconFile } from '../ui/pal-icon.js';
import { palPicker } from '../ui/pal-picker.js';
import { passiveChip, passiveList, passiveSelector, passivesById } from '../ui/passive-picker.js';
import { hint } from '../ui/hint.js';
import { talentInput } from '../ui/talent-input.js';
import { segmented } from '../ui/segmented.js';
import { searchSelect } from '../ui/search-select.js';
import { createPopover } from '../ui/popover.js';
import { icon } from '../ui/icons.js';
import { ownedNotices, noticeList, grantWithReport, onlineUids, onlineKey, mappingOptions } from '../ui/owned-status.js';
import { virtualRows } from '../ui/virtual-list.js';
import { farmBoard, cakesOut } from '../ui/farm-board.js';
import { withTransition } from '../ui/motion.js';
import {
  viewHeading, syncPicker, syncOptions, renderWhenIdle, ownedSpeciesNotes, changeRoute, holderChoices, holderValue, HOLDER_DEFAULT,
  fieldHead, panelItem, panelLine,
} from './shared.js';
import { tabLabel } from './tabs.js';
import { openWorldDialog } from './owned-settings.js';
import { toast } from '../ui/toast.js';
import { buildHash, settingsHash } from '../router.js';
import {
  filterOwned, sortOwned, sortKey, sortLabel, keywordTerms, keywordNotes, prepareKeywords, OWNED_SORTS, PLACE_ORDER, placeGroupLabel, eggName, isMutantEgg, boxShort,
} from '../core/owned.js';
import { palsOfPlayers, goalMarks } from '../core/ideal-goals.js';
import { cleanSaved, list, internalName, idText, text, oneOf, intIn, BASES_MAX } from '../core/boundary.js';
import { userIdKey } from '../core/user.js';
import { seenTime } from '../owned-seen.js';
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
  ['include', '全部持つ', '選んだパッシブを全部持つ個体'],
  ['only', 'だけ', '選んだパッシブを全部持ち、ほかのパッシブを持たない個体'],
  ['none', 'なし', 'パッシブを 1 つも持たない個体（選んだパッシブは使いません）'],
];
const ELEMENT_KEYS = Object.keys(ELEMENTS);
/** 場所のチップの既定（グローバルパルボックスだけを外す。前の「グローバルボックスを表示」の既定オフと同じ） */
export const DEFAULT_PLACES = Object.freeze(PLACE_ORDER.filter((group) => group !== 'global'));

const talentAtLeast = (value) => intIn(value, { min: 0, max: 100, fallback: 0 });
const placeList = (value) => list(value, { max: PLACE_ORDER.length, map: (group) => oneOf(group, PLACE_ORDER, null), key: (group) => group });
// 場所の一覧の版（2 は観賞用ケージ display を足した版。save-extras）。前の版の既定（グローバル以外のすべて）とすべての場所の条件は、前は
//「不明」として出ていた観賞用ケージの個体が消えないよう display を足して読み替える（版 2 で利用者がケージだけを外した条件はそのまま）
export const PLACES_VERSION = 2;
const LEGACY_PLACE_SETS = [['party', 'palbox', 'base', 'dps', 'egg', 'unknown'], ['party', 'palbox', 'base', 'dps', 'global', 'egg', 'unknown']];
const samePlaces = (a, b) => a.length === b.length && a.every((group) => b.includes(group));
/**
 * 保存して読み戻す絞り込みの形（ui/view-memory.js が sessionStorage・履歴のエントリから読むときに、項目ごとに確かめる）。
 * 合わない項目は既定の値に戻す。読み戻した値は migrateFilter で今の形にする（前の形の項目 place・eggs・globals・所持者の base:／global も
 * ここで受けて読み替える。今の形の保存には書かない＝無ければ undefined）
 */
export const OWNED_MEMORY = {
  // 所持者: すべて（''）・自分（mine。既定）・プレイヤー（player:<uid>）。拠点（base:<id>）・グローバルパルボックス（global）は前の形。
  // 無い・形の合わない値は既定の自分（D29。前は「すべて」）
  holder: (value) => (typeof value === 'string' && value.length <= 80 && (value === '' || value === 'mine' || value === 'global' || /^(player|base):\S/.test(value)) ? value : HOLDER_DEFAULT),
  // 選んだ場所のグループ（PLACE_ORDER の値）。無い（前の形の保存）ときは undefined で、migrateFilter が place・eggs・globals から作る
  places: (value) => (Array.isArray(value) ? placeList(value) : undefined),
  // 場所の一覧の版（PLACES_VERSION。無い・違う値は前の版で、migrateFilter が前の既定の一覧に観賞用ケージを足す）
  placesVersion: (value) => (value === PLACES_VERSION ? value : undefined),
  // 拠点の ID（D29 より前の形。拠点ごとの絞り込みはなくした）。読み戻して migrateFilter に渡すだけ（場所を拠点とタマゴの中にする）。
  // 無ければ undefined（今の形の保存には書かない）
  bases: (value) => (Array.isArray(value) ? list(value, { max: BASES_MAX, map: (id) => idText(id, 40) || null, key: (id) => id }) : undefined),
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
 * 所持者 base:<id> → 所持者なし・places: ['base', 'egg']（拠点のタマゴも拠点の持ち物。eggs: false なら 'base' だけ）、
 * 所持者 global → 所持者なし・places: ['global']、拠点の ID（bases・URL の base。D29 で拠点ごとの絞り込みをなくした）→ places を拠点と
 * タマゴの中だけにする（どちらもなければ ['base', 'egg']。どの拠点かは見ない）。places は PLACE_ORDER の順に並べる。
 * place と eggs・globals の組み合わせで places が空になる古い保存（{ place: 'egg', eggs: false } など）は、place を選んでいない既定に戻す
 * @returns {{ holder: string, places: string[], elements: string[], palId: string, passives: string[],
 *   passiveMode: string, query: string, sort: string, dir: 'asc' | 'desc', stars: number, talent: { hp: number, shot: number, defense: number } }}
 */
export function migrateFilter(old) {
  const saved = cleanSaved(old, OWNED_MEMORY);
  let places = saved.places;
  // 前の版の既定・すべての場所（観賞用ケージ display がない。前の保存・前のリンク）には display を足す
  if (places && saved.placesVersion !== PLACES_VERSION && LEGACY_PLACE_SETS.some((set) => samePlaces(set, places))) places = [...places, 'display'];
  if (!places) {
    const shown = (groups) => groups.filter((group) => !(group === 'egg' && saved.eggs === false) && !(group === 'global' && saved.globals !== true));
    places = shown(saved.place ? [saved.place] : [...PLACE_ORDER]);
    // 古い保存の矛盾した組み合わせ（場所「タマゴ」でタマゴを隠す・場所「グローバル」でグローバルを出さない）で 0 件にしない。
    // そのときは場所を選んでいない既定（タマゴ・グローバルの表示はそのまま）に戻す
    if (!places.length) places = shown([...PLACE_ORDER]);
  }
  let { holder } = saved;
  if (holder.startsWith('base:')) {
    places = saved.eggs === false ? ['base'] : ['base', 'egg'];
    holder = '';
  } else if (holder === 'global') {
    places = ['global'];
    holder = '';
  } else if (saved.bases?.length) {
    const atBase = places.filter((group) => group === 'base' || group === 'egg');
    places = atBase.length ? atBase : ['base', 'egg'];
  }
  return {
    holder, places: PLACE_ORDER.filter((group) => places.includes(group)), placesVersion: PLACES_VERSION, elements: saved.elements, palId: saved.palId,
    passives: saved.passives, passiveMode: saved.passiveMode, query: saved.query, ...sortOf(saved.sort, saved.dir), stars: saved.stars, talent: saved.talent,
  };
}

// 並べ替え（キーと向き。前の値 talent-low は talent・asc）
function sortOf(value, dir) {
  const { key, dir: resolved } = sortKey(value, dir);
  return { sort: key, dir: resolved };
}

// URL の絞り込みの名前（どれかがあれば、URL がすべての条件を決める。sort・dir は並べ替えだけで、あれば入れる）。
// base は D29 より前のリンクの拠点（場所を拠点とタマゴにする読み替えにだけ使う）
const FILTER_PARAMS = ['holder', 'place', 'base', 'el', 'pal', 'p', 'pm', 'q', 'stars', 'hp', 'at', 'df'];
const commaList = (value) => (value ?? '').split(',').filter(Boolean);

/**
 * URL の絞り込み（holder・place〔カンマ区切り。前の 1 つの形も同じ〕・base〔前の形〕・el・pal・p・pm・q・stars・hp・at・df）を、
 * 確かめてから今の形にする（未知の場所・属性・パル、範囲の外の数、長すぎる文字は捨てる）。絞り込みの名前が 1 つも無ければ null。
 * URL に無い条件は既定（リンクが条件のすべてを決める）。ただし所持者が無いときは「すべて」（D29 で所持者の既定を自分にしたが、前に写した
 * リンク・場所の分からないパルの「見る」の意味を変えない）。前の形の所持者（base:・global）と拠点（base）は migrateFilter で読み替える
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
// 行の高さ（px。CSS の --owned-row-h・--owned-row-band-h と同じ。見えている範囲だけ描く一覧の、まだ測っていない行の見積もり）。
// 下の段（目標の印・キーワードに一致した理由）を取るときは全部の行が ROW_ESTIMATE_BAND、取らないときは ROW_ESTIMATE（D25）
const ROW_ESTIMATE = 64;
const ROW_ESTIMATE_BAND = 80;
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
  passives: ['passives', 'パッシブ', 'パッシブのランク'],
  hp: ['hp', 'HP', 'HP の個体値'],
  shot: ['shot', '攻', '攻撃の個体値'],
  defense: ['defense', '防', '防御の個体値'],
  talent: ['talent', '計', '個体値の合計'],
  place: ['place', '所持者・場所', '所持者・場所'],
};
// 向きの言い方（列見出しの読み上げ。「HP の個体値で並べ替え（高い順）」）。並べ替えの選択の名前（core/owned.js の OWNED_SORTS
//「HP の個体値が高い順」）と同じ言い方にそろえる
const HIGH_LOW = { desc: '高い順', asc: '低い順' };
const HEAD_WORDS = {
  dex: { asc: '小さい順', desc: '大きい順' }, passives: HIGH_LOW, level: HIGH_LOW, stars: { desc: '多い順', asc: '少ない順' },
  talent: HIGH_LOW, hp: HIGH_LOW, shot: HIGH_LOW, defense: HIGH_LOW, place: { asc: 'ボックス順', desc: 'ボックスの逆順' },
};
// 行に出す値の署名（一致の理由・印を除く）と、一致の理由の署名。理由を入れ忘れると、キーワードを変えても古い理由が残る
const boxText = (box) => (box ? `${box.page}.${box.row}.${box.column}` : '');
// 個体のデータ（読み込みごとに作り直され、中は変えない）ごとに 1 回だけ作る（キーワードを打つたびに 2,000 行ぶん作らない）
const baseSignatures = new WeakMap();
function baseSignature(pal) {
  let signature = baseSignatures.get(pal);
  if (signature === undefined) {
    signature = [pal.palId, pal.known, pal.name, pal.human?.icon ?? '', pal.level, pal.rank, pal.stars,
      pal.passives.join(','), pal.talent.hp, pal.talent.shot, pal.talent.defense, pal.holder, pal.place, pal.placeLabel, boxText(pal.box), pal.nickname,
      pal.gender, pal.egg, pal.lucky, pal.alpha, pal.lastOwner, pal.eggItemId ?? '', pal.farm?.role ?? '', isMutantEgg(pal), conditionBadges(pal).join(',')].join('\u0001');
    baseSignatures.set(pal, signature);
  }
  return signature;
}
const notesSignature = (notes) => notes.map((note) => `${note.label}:${note.name}:${note.desc}`).join('|');
/** 行に出す値の署名（一致の理由 notes と印 marks、NEW の印 isNew を含む）。同じなら行を書き換えない（理想個体の描き直しの判定も使う） */
export const rowSignature = (pal, notes = [], marks = [], isNew = false) => `${baseSignature(pal)}\u0002${notesSignature(notes)}\u0002${marks.join('\u0001')}\u0002${isNew ? 'new' : ''}`;

/**
 * 行の名前の下に出す状態の印（save-extras。F070）: 拠点・手持ちの個体の「病気」「空腹」だけ（行を太らせない。ある個体だけ。魂の強化と SAN は
 * 個体の詳細のドロワー）。パルボックス・保管庫の個体は作業しないので出さない
 */
export function conditionBadges(pal) {
  if (!pal?.condition || !['base', 'party'].includes(pal.place)) return [];
  return [pal.condition.sick ? '病気' : '', pal.condition.hunger ? '空腹' : ''].filter(Boolean);
}

// ---- 所持パルの 1 行（所持パルの一覧・理想個体の組のカード）。列は [パル][Lv・★][パッシブ][個体値 4 セル][所持者・場所]（CSS の --owned-cols） ----
// 個体値のセル（列見出しの HP・攻・防・計と同じ並び）。名前は読み上げの文に使う
const TALENT_CELLS = [['hp', 'HP'], ['shot', '攻撃'], ['defense', '防御'], ['total', '合計']];
// 1 つの行に出すパッシブの数。5 個以上なら 3 個と「+N」（残りは押すと板に出す。行の中には広げない）
const PASSIVE_SLOTS = 4;

// 行に操作のボタンは置かない（2026-10-14 のユーザーのフィードバック〔D29〕。前は触れた行の右端に「親にして検索」のボタンを浮かせていたが、
// 所持者・場所の列に重なった）。パル名のリンクからパル詳細（配合の親・子の一覧）へ進める。親にして配合を探す・逆引き・継承ルートの検索は、
// フェーズ 3 の個体の詳細（owned-detail のドロワー）にまとめて置く

// パル（絵と名前・性別）。名前のリンクは data-focus="pal"（行の中を書き換えても、同じ部品へフォーカスを戻す目印）
function palCellTile(pal) {
  if (pal.known) {
    // 名前の右に属性のアイコン（game-assets）。要素を足さず CSS の背景で描く（行の要素の数の上限を変えない。ui/pal-icon.js の palTile）
    const tile = palTile(pal.palId, { gender: pal.gender, genderFirst: true, elements: 'css' });
    // リンク（パルのマスターにある種族）のときだけ。ブラウザの tagName は大文字
    if (tile.tagName?.toLowerCase() === 'a') tile.setAttribute('data-focus', 'pal');
    // タマゴは種族の絵の右下に、タマゴの種類（突然変異は突然変異のタマゴ）のアイコン。分からなければ出さない（名前の下の文字のバッジは残す）
    const egg = pal.egg ? eggIcon(pal.eggItemId, { mutant: isMutantEgg(pal) }) : null;
    if (egg) tile.children[0]?.append(egg);
    return tile;
  }
  // 人間のキャラクターなど、パルのマスターにないもの。ゲームから取り出した名前とアイコンがあれば出す
  const unknown = el('span', 'pal-tile owned-unknown');
  if (pal.human?.icon) unknown.append(humanIcon(pal.human.icon));
  const label = el('span', 'pal-label');
  const name = el('strong', '', pal.name);
  const mark = genderMark(pal.gender);
  if (mark) {
    const line = el('span', 'pal-name-line');
    line.append(mark, name);
    label.append(line);
  } else label.append(name);
  unknown.append(label);
  return unknown;
}

// 行の下の段に並べる目標の印の数（D25）。5 つ目からは「+N」（押すと板に一覧。板の中身は開いたときに作る）。目標が多いと 1 行に印が
// 100 個並び、2,000 行で DOM の予算〔80,000〕を超えたため（B2）。キーワードで印を探すのは DOM と別（filterOwned の extraTexts）で、
// すべての印を見る。前は名前の下に 1 個だった（パルの列〔1100px で約 170px〕に 2 個入らなかった）のを、行の幅いっぱいの下の段に移して 4 個にした
const MARK_SLOTS = 4;

// 名前の下のバッジ（ニックネーム・タマゴ・ラッキー・アルファと、理想個体のカードの「別の配合牧場で使用中」など badges の文）。
// 1 行（入り切らない分は隠し、title に全部）。バッジがなければ null
// タマゴはゲームのタマゴの名前（表にあれば。「暗黒デカタマゴ」）、配合牧場の親と牧場の上のタマゴは「配合牧場」、突然変異のタマゴは「突然変異」（farm-board）
function palCellBadges(pal, badges) {
  const fixed = [];
  if (pal.nickname) fixed.push(['owned-badge badge-nickname', `「${pal.nickname}」`]);
  if (pal.egg) fixed.push(['owned-badge badge-egg', eggName(pal.eggItemId) || 'タマゴ']);
  if (isMutantEgg(pal)) fixed.push(['owned-badge badge-mutant', '突然変異']);
  if (pal.farm) fixed.push(['owned-badge badge-farm', pal.farm.role === 'egg' ? '配合牧場のタマゴ' : '配合牧場']);
  if (pal.lucky) fixed.push(['owned-badge badge-lucky', 'ラッキー']);
  if (pal.alpha) fixed.push(['owned-badge badge-alpha', 'アルファ']);
  // 拠点・手持ちの病気・空腹（save-extras。種類は個体の詳細のドロワー）
  for (const text of conditionBadges(pal)) fixed.push([`owned-badge ${text === '病気' ? 'badge-sick' : 'badge-hungry'}`, text]);
  for (const text of badges) fixed.push(['owned-badge badge-mark', text]);
  if (!fixed.length) return null;
  const line = el('span', 'owned-badges');
  line.append(...fixed.map(([className, text]) => {
    const node = el('span', className, text);
    // 配合牧場の印は文字の左にゲームの配合牧場のアイコン（game-assets。読めなければ文字だけ）
    if (className.includes('badge-farm')) node.insertBefore(gameIcon('ui/breed-farm.png', { size: 14, className: 'farm-icon' }), node.firstChild ?? null);
    return node;
  }));
  line.title = fixed.map(([, text]) => text).join('\n');
  return line;
}

// 「+N」の説明の板（ui/hint.js）は、初めて押したときに作って、その 1 回で開く（作った部品は hints に入れる）。2,000 行ぶんの板の部品
//（popover の要素・リスナー）を最初から作らないため。目標の印の「+N」はほとんどの行に付きうり、全部の行に作ると、キーワードを消して
// 2,000 行を足し直すたびに捨てる部品が増え、GC で 150〜390ms 止まった（D25 の計測）
function laterHint(trigger, label, content, hints) {
  trigger.classList.add('hint-trigger');
  trigger.setAttribute('aria-expanded', 'false');
  let made = null;
  // 作った後の開閉は hint の部品が受ける（押している最中に足したリスナーは、その 1 回には呼ばれない）
  trigger.addEventListener('click', () => {
    if (made) return;
    made = hint({ label, trigger, content });
    hints.push(made);
    made.open();
  });
}

// 行の下の段の印（4 つまで。省略されても読めるよう、それぞれ title に全文）と、5 つ目からの「+N」のボタン（data-focus="marks-more"）。
// 「+N」の説明の部品は、押したときに作って hints に入れる
function markNodes(marks, hints) {
  const nodes = marks.slice(0, MARK_SLOTS).map((mark) => {
    const node = el('span', 'owned-badge badge-mark', mark);
    node.title = mark;
    return node;
  });
  const rest = marks.slice(nodes.length);
  if (!rest.length) return nodes;
  const more = button(`+${rest.length}`, null, 'owned-badge mark-more');
  // 読み上げの名前にも見えている「+N」を入れる（見えている文で呼びかけても押せるように）
  more.setAttribute('aria-label', `+${rest.length}（ほかの目標の印 ${rest.length} 個）`);
  more.setAttribute('data-focus', 'marks-more');
  more.title = rest.join('\n');
  laterHint(more, 'ほかの目標の印', () => {
    const list = el('div', 'mark-list');
    list.append(...rest.map((mark) => el('span', 'owned-badge badge-mark', mark)));
    return [list];
  }, hints);
  return [...nodes, more];
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
export function fillLevelCell(cell, pal) {
  const filled = Math.max(0, Math.min(4, pal.stars));
  const stars = el('span', 'owned-stars', '★'.repeat(filled));
  stars.setAttribute('role', 'img');
  stars.setAttribute('aria-label', filled ? `パル濃縮 ★${filled}` : 'パル濃縮なし');
  stars.setAttribute('data-off', '☆'.repeat(4 - filled));
  cell.textContent = pal.egg ? '—' : `Lv ${pal.level}`;
  cell.append(stars);
}

// パッシブの並び（行の中だけランクの高い順。同じランクは保存の順）を 2×2 の固定の枠（セルそのものが grid）に。5 個以上なら 3 個と「+N」。
// 欲しいパッシブ（wanted。1 つ以上のときだけ）があれば、欲しいものに ✓ を付け、それ以外を薄くする。パッシブなしは枠が空（文字は出さない）
function fillPassiveList(list, ids, wanted, hints) {
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
  if (!rest.length) return;
  const more = button(`+${rest.length}`, null, 'passive-more');
  // 読み上げの名前にも見えている「+N」を入れる（見えている文で呼びかけても押せるように）
  more.setAttribute('aria-label', `+${rest.length}（ほかのパッシブ ${rest.length} 個）`);
  more.setAttribute('data-focus', 'passive-more');
  more.title = rest.map((id) => passivesById.get(id)?.ja ?? id).join('\n');
  list.append(more);
  laterHint(more, 'ほかのパッシブ', () => [passiveList(rest)], hints);
}

// キーワードに一致した理由の、行に並べる項目（見出し）の数。残りは「ほか N 件」（全文は title）。理由の段落の要素は 2＋この数まで
//（2,000 行の全部の行に理由が出ても要素を増やしすぎない）
const HIT_GROUPS = 4;
// 縮めない短い項目の文字数（「パートナースキル：猫の手も借りたい」の 17 字より短いもの）
const HIT_SHORT = 16;
const noteText = (note) => `${note.name}${note.desc ? `（${note.desc}）` : ''}`;
// キーワードに一致した理由（core/owned.js の keywordNotes。D29 で一致したすべての項目にした）。行の下の段の印の後ろに 1 行で、項目（見出し）ごとに
// 1 つの要素「パッシブ：職人気質（作業速度 +50%）・希少」にまとめて横に並べる（それぞれ入り切らない分は省略）。title に 1 件ずつの全文
function fillHits(line, notes) {
  const groups = new Map();
  for (const note of notes) {
    if (!groups.has(note.label)) groups.set(note.label, []);
    groups.get(note.label).push(noteText(note));
  }
  const shown = [...groups].slice(0, HIT_GROUPS);
  line.replaceChildren(...shown.map(([label, texts]) => {
    const text = `${label}：${texts.join('・')}`;
    // 短い項目（「パル名：アヌビス」「属性：闇」など）は縮めない。長い項目（説明つきなど）だけを縮めて省略する（前は説明の長い項目と一緒に
    // 短い項目まで縮み、「パル名：ア…」になった）
    const hit = el('span', text.length <= HIT_SHORT ? 'owned-hit is-short' : 'owned-hit', text);
    hit.title = text;
    return hit;
  }));
  if (groups.size > shown.length) line.append(el('span', 'owned-hit-more', `ほか ${groups.size - shown.length} 件`));
  line.title = notes.map((note) => `${note.label}：${noteText(note)}`).join('\n');
}

// 個体値の 4 セル（HP・攻・防・計）。数字と、下のミニバー（--v。計は合計の 1/3）。目標（targets）があれば、目標の縦線（--t）と
// 目標以上は .met、目標未満は .short。目標までの差（−N。D23）は、2026-10-14 のユーザーのフィードバック（D30）で出さなくした。
// 読み上げは欄の aria-label にまとめる（個体の詳細のドロワー〔views/owned-detail.js〕も使う）
export function fillTalentCell(cell, talent, targets) {
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
      spoken.push(`${name} ${value}（目標 ${target} 未満）`);
    }
    return item;
  }));
  cell.setAttribute('aria-label', `個体値 ${spoken.join('・')}`);
}

// 所持者と場所。拠点の個体は拠点の名前と「Alice が預けた」（場所の行は重ねない）。パルボックスは「P2 · 1-6」、パル次元ストレージは
// 「次元 P2 · 1-6」と 6×5 の小さな図（title に場所の全文）。位置が分からなければ場所の文字（個体の詳細のドロワーも使う）
export function fillWhereCell(cell, pal) {
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
  const place = el('small', 'muted owned-box', boxShort(pal));
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
 * 所持パルの 1 行の部品。options: { notes, highlight, marks, badges, hints, isNew, detail }。
 * notes は一致した理由（core/owned.js の keywordNotes）、highlight は理想個体の組の親で欲しいパッシブと個体値が目標に届いているかを見せる
 * （{ wanted, targets }）、marks は目標の印（行の下の段 div.owned-band に MARK_SLOTS 個までと「+N」。D25）、badges は名前の下のバッジの
 * 1 行に足す文（理想個体のカードの「別の配合牧場で使用中」）、hints は「+N」の説明の部品を入れる配列（作り直す側が destroy する。
 * 省くと行が持つ）。isNew は入手の NEW（save-extras。行に is-new と読み上げの「（新しく入手）」）。行の操作のボタンはない（D29）。
 * detail（作るときだけ見る）は個体の詳細を開ける行で、Lv・★のセルをボタンにする
 *（押す・Enter で右のドロワーに個体の詳細。要素を増やさない。開くのは一覧の委譲のリスナー。owned-detail）。行には data-instance に個体 ID。
 * 下の段は印か一致の理由があるときだけ作る（行の高さは一覧の has-band が決める。全部の行が同じ高さ）。
 * update は変わったセルだけを書き換え、書き換えたら true（同じ値なら何もしない）。書き換えたセルにフォーカスがあったら、同じ役目の部品
 * （data-focus。名前のリンク pal・「+N」passive-more／marks-more）へ戻す
 * @returns {{ element: HTMLElement, pal: object, update(pal: object, options?: object): boolean, destroy(): void }}
 */
export function ownedRowItem(pal, options) {
  const element = el('article', 'owned-row');
  const detail = Boolean(options?.detail);
  const level = detail ? button('', null, 'owned-level owned-detail-open') : el('div', 'owned-level');
  if (detail) level.setAttribute('data-focus', 'detail');
  const cells = {
    pal: el('div', 'owned-pal'), level, passives: el('div', 'owned-passives'),
    talent: el('div', 'owned-talent'), where: el('div', 'owned-where'),
  };
  cells.talent.setAttribute('role', 'img');
  element.append(cells.pal, cells.level, cells.passives, cells.talent, cells.where);
  const shown = {};
  let ownHints = [];
  let markHints = [];
  // パルのセルの中: 名前のリンク（絵と名前）とバッジの 1 行。バッジだけが変わったときに名前のリンクを作り直さない（フォーカスが落ちる）
  let tileNode = null;
  let badgeLine = null;
  // 行の下の段（D25）: 目標の印（と「+N」）と、キーワードに一致した理由の 1 行。どちらもなければ段ごと外す
  let band = null;
  let marked = [];
  let hitsLine = null;
  const ensureBand = () => {
    if (!band) {
      band = el('div', 'owned-band');
      element.append(band);
    }
    return band;
  };
  const dropEmptyBand = () => {
    if (!band || marked.length || hitsLine) return;
    band.remove();
    band = null;
  };
  let current = pal;
  // セルごとの値の署名。変わったセルだけを作り直す
  const write = (name, key, fill) => {
    if (shown[name] === key) return false;
    shown[name] = key;
    fill();
    return true;
  };
  const item = {
    element,
    get pal() { return current; },
    update(next, { notes = [], highlight, marks = [], badges = [], hints, isNew = false } = {}) {
      current = next;
      // 書き換えるセルにフォーカスがあったら、書き換えた後に同じ役目の部品（data-focus）へ戻す
      const focused = focusMark(element);
      let changed = false;
      // NEW（前に所持パルを見たときより後に入手した個体。save-extras）は要素を足さず、行のクラス（CSS の ::before で絵の左上に「NEW」）と
      // 読み上げの名前に入れる（行の要素の数の上限〔test:perf〕を変えない）
      changed = write('label', `${next.id}\u0001${next.name}\u0001${next.nickname}\u0001${isNew}`, () => {
        element.setAttribute('aria-label', `${next.name}${next.nickname ? `（${next.nickname}）` : ''}${isNew ? '（新しく入手）' : ''}`);
        element.setAttribute('data-instance', next.id);
        element.classList.toggle('is-new', isNew);
      }) || changed;
      changed = write('tile', [next.palId, next.known, next.name, next.human?.icon ?? '', next.gender,
        next.egg ? eggIconFile(next.eggItemId, { mutant: isMutantEgg(next) }) : ''].join('\u0002'), () => {
        const tile = palCellTile(next);
        cells.pal.insertBefore(tile, tileNode ?? cells.pal.children[0] ?? null);
        tileNode?.remove();
        tileNode = tile;
      }) || changed;
      changed = write('badges', [next.nickname, next.egg, next.eggItemId ?? '', isMutantEgg(next), next.farm?.role ?? '', next.lucky, next.alpha, conditionBadges(next).join(','), badges.join('\u0001')].join('\u0002'), () => {
        const line = palCellBadges(next, badges);
        if (line) cells.pal.insertBefore(line, badgeLine);
        badgeLine?.remove();
        badgeLine = line;
      }) || changed;
      changed = write('level', `${next.egg}:${next.level}:${next.stars}:${detail ? `${next.name}:${next.nickname}` : ''}`, () => {
        fillLevelCell(cells.level, next);
        if (!detail) return;
        const name = `${next.name}${next.nickname ? `「${next.nickname}」` : ''}`;
        cells.level.setAttribute('aria-label', `${name}の詳細（${next.egg ? 'タマゴ' : `Lv ${next.level}`}・パル濃縮 ★${next.stars}）`);
        cells.level.title = '個体の詳細を右に開く';
      }) || changed;
      changed = write('passives', `${next.passives.join(',')}\u0002${highlight?.wanted?.join(',') ?? ''}`, () => {
        for (const old of ownHints) old.destroy();
        ownHints = [];
        fillPassiveList(cells.passives, next.passives, highlight?.wanted, hints ?? ownHints);
      }) || changed;
      // 下の段: 印（印の後ろに一致の理由）。印だけ・理由だけが変わったときは、変わった方だけを入れ直す
      changed = write('marks', marks.join('\u0001'), () => {
        for (const old of markHints) old.destroy();
        markHints = [];
        for (const node of marked) node.remove();
        marked = marks.length ? markNodes(marks, hints ?? markHints) : [];
        if (marked.length) {
          const host = ensureBand();
          for (const node of marked) host.insertBefore(node, hitsLine);
        }
        dropEmptyBand();
      }) || changed;
      changed = write('hits', notesSignature(notes), () => {
        if (!notes.length) {
          hitsLine?.remove();
          hitsLine = null;
          dropEmptyBand();
          return;
        }
        if (!hitsLine) {
          hitsLine = el('p', 'owned-hits');
          ensureBand().append(hitsLine);
        }
        fillHits(hitsLine, notes);
      }) || changed;
      const targets = highlight?.targets;
      changed = write('talent', `${next.talent.hp}:${next.talent.shot}:${next.talent.defense}:${targets ? TALENT_CELLS.map(([key]) => targets[key] ?? 0).join(',') : ''}`,
        () => fillTalentCell(cells.talent, next.talent, targets)) || changed;
      changed = write('where', [next.place, next.holder, next.placeLabel, boxText(next.box), next.lastOwner].join('\u0002'), () => fillWhereCell(cells.where, next)) || changed;
      if (focused && changed && focusLost()) element.querySelector(`[data-focus="${focused}"]`)?.focus({ preventScroll: true });
      return changed;
    },
    destroy() {
      for (const old of [...ownHints, ...markHints]) old.destroy();
      ownHints = [];
      markHints = [];
    },
  };
  item.update(pal, options);
  return item;
}

// 個体の詳細を開くセル（Lv・★のボタン・パッシブ・個体値・場所・下の段）
const DETAIL_CELLS = ['owned-level', 'owned-passives', 'owned-talent', 'owned-where', 'owned-band'];
// クリックの対象から行と個体 ID を引く。パル名のリンク・ほかのボタン（「+N」）・パッシブのチップ（押すと解説の板を固定）なら null
function detailTarget(event, container) {
  let cell = null;
  for (let node = event.target; node && node !== container; node = node.parentElement) {
    const tag = String(node.tagName ?? '').toLowerCase();
    const classes = String(node.className ?? '').split(' ');
    if (classes.includes('owned-row')) {
      const id = node.getAttribute('data-instance');
      return cell && id ? { row: node, id } : null;
    }
    if (classes.includes('owned-detail-open')) cell = node;
    else if (tag === 'a' || tag === 'button' || node.getAttribute?.('data-passive-id')) return null;
    if (!cell && DETAIL_CELLS.some((name) => classes.includes(name))) cell = node;
  }
  return null;
}

/**
 * 所持パルの行の入れ物（一覧・パル詳細の上位 5 体）に、個体の詳細を右のドロワーで開くクリックの委譲のリスナーを 1 つ付ける（owned-detail）。
 * 行の Lv・★のボタン（キーボードはこれで開く）と、パッシブ・個体値・場所のセル・下の段を押すと開く。文字を選んでいるときは開かない。
 * query は所持パルで入れているキーワード（一致の理由の全文を出す）。ドロワーがなければ何もしない
 */
export function openDetailOnClick(container, drawer, { query = () => '' } = {}) {
  if (!drawer) return;
  container.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button > 0) return;
    if (String(globalThis.getSelection?.()?.toString?.() ?? '')) return;
    const hit = detailTarget(event, container);
    if (!hit) return;
    const words = String(query() ?? '').slice(0, 200);
    const opener = hit.row.querySelector('.owned-detail-open') ?? hit.row;
    drawer.open({ kind: 'owned', id: hit.id, ...(words ? { params: { q: words } } : {}) }, { opener });
  });
}

/**
 * 図鑑順のとき、種族が変わる所に見出しの行を入れる（F068。goals-detail）。見出しは { id: 'species:<palId>', heading: true, palId, count, male,
 * female, eggs, maxLevel, collapsed }。畳んだ種族（collapsed の palId。パルのマスターにない個体は 'other'）の個体の行は出さない。
 * 数は絞り込んだ後の一覧の数（見出しの下に並ぶ個体の数）
 */
export function withSpeciesHeads(list, collapsed = new Set()) {
  const groups = new Map();
  for (const pal of list) {
    const key = pal.palId || 'other';
    let group = groups.get(key);
    if (!group) groups.set(key, group = { id: `species:${key}`, heading: true, palId: pal.palId || '', key, count: 0, male: 0, female: 0, eggs: 0, maxLevel: 0 });
    group.count++;
    if (pal.egg) group.eggs++;
    else {
      if (pal.gender === 'M') group.male++;
      else if (pal.gender === 'F') group.female++;
      group.maxLevel = Math.max(group.maxLevel, pal.level);
    }
  }
  const items = [];
  let current = null;
  for (const pal of list) {
    const key = pal.palId || 'other';
    if (key !== current) {
      current = key;
      items.push({ ...groups.get(key), collapsed: collapsed.has(key) });
    }
    if (!collapsed.has(key)) items.push(pal);
  }
  return items;
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
  element.append(viewHeading(tabLabel('owned')));
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

  // 対応が要るときだけの案内の帯（案内がなければ入れ物ごと隠す）。どのワールドの・いつのデータか・読み込み中かはヘッダーのセーブ連携の
  // 状態に任せる（D29 で、上に出していたデータ元の 1 行をなくした）。設定の操作（ワールドの切り替え・今すぐ読み込む）は設定タブで行う。
  // データがないときだけ、案内に設定へ行くボタンを出す
  const summary = el('section', 'owned-summary');
  const notices = noticeList([]);
  summary.hidden = true;
  // 許可はクリックの中で求める必要があるため、案内の中にボタンを出す（許可の後にそのまま読み込む）。
  // 案内は 1 文と行き先のボタン（「設定タブの〜」とだけ書かない。copy-dead-ends）: ワールドの登録・編集はこの画面からモーダルを開き、
  // 読めないエラーは設定のセーブ連携の状態の欄（今すぐ読み込む・許可。router.js の settingsHash の 'status'）へ
  const linkedWorld = () => owned.state.auto?.worlds?.find((world) => world.id === owned.state.linkedWorldId) ?? null;
  const noticeActions = {
    grant: { label: '読み込みを許可', run: () => grantWithReport(owned) },
    register: { label: 'ワールドを登録', run: () => openWorldDialog(context) },
    settings: { label: 'セーブ連携を開く', run: () => context.navigate(settingsHash(owned.state.linkedWorldId ?? '', 'status')) },
    editWorld: {
      label: 'ワールドを編集',
      run: () => {
        const world = linkedWorld();
        if (world) openWorldDialog(context, { world });
        else context.navigate(settingsHash(owned.state.linkedWorldId ?? '', 'status'));
      },
    },
    unknownPlace: { label: '見る', run: () => changeRoute(context, buildHash('owned', { place: 'unknown' })) },
  };
  summary.append(notices);

  // ---- 絞り込みの部品（作るのは 1 回だけ。条件・データが変わったら update・値の書き換えで合わせる） ----
  // 利用者が条件を変えた: 一覧・件数・効いている条件を描き直し、一覧の先頭がパネルの下に隠れていれば先頭を見せる（O-05）
  function changed() {
    renderResults({ reveal: true });
    revealResults();
  }
  const query = el('input');
  query.type = 'search';
  query.placeholder = '名前・スキル・属性など';
  // 作業の名前＋数字は Lv の下限（画面のどこにも書いていなかった。フェーズ 4 の終わりのレビュー）
  query.title = '名前・スキル・属性・作業適性など（空白で区切ると、すべてを含むパル）\n例: 「採掘3」は採掘 Lv3 以上の種族（Lv4 以上も当たる）';
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
  // 所持者（すべて／自分のプレイヤー名〔既定〕／ほかのプレイヤー）。意味は理想個体と同じ（そのプレイヤーが預けた拠点のパル・ホストなら
  // グローバルパルボックスも含む）。選択肢が 12 件を超えたら検索つきの選択にする。選択肢の値は holderNow（自分が分からなければ mine は「すべて」）
  const holderNow = () => holderValue(filter.holder, context.ideals);
  const holderSelect = searchSelect({ label: '所持者', options: [['', 'すべて']], value: holderNow(),
    onChange: (value) => { filter.holder = value; changed(); } });

  // 場所のチップ（複数選択。0 体の場所は出さない）。件数は出さない（D29「場所の選択肢にパルの数が書かれているが、これも不要」）。
  // 前は拠点のチップの右に ▾（拠点ごとのチェックの板）があったが、拠点のチップとの違いが分からないのでなくした（D29）
  const placeBox = el('div', 'place-chips');
  placeBox.setAttribute('role', 'group');
  placeBox.setAttribute('aria-label', '場所');
  const placeChips = new Map();
  for (const group of PLACE_ORDER) {
    const chip = button(placeGroupLabel(group), () => togglePlace(group), 'place-chip');
    chip.setAttribute('data-value', group);
    placeBox.append(chip);
    placeChips.set(group, chip);
  }
  function togglePlace(group) {
    const on = !filter.places.includes(group);
    filter.places = PLACE_ORDER.filter((item) => (item === group ? on : filter.places.includes(item)));
    renderPlaces(owned.state);
    changed();
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

  // ---- 状態の行（結果の行）: 件数と内訳・効いている条件のチップ（入り切らない分は +n）・すべて解除・並べ替え。
  // 理想個体／継承ルートへのリンクは、パル・パッシブの見出しの行（D28） ----
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
  // 理想個体・継承ルートへのリンク（O-40）。もとにした欄（パル・パッシブ）の見出しの行の右端に置く（D28。前は状態の行の右端で、
  // 条件のチップの場所を狭めていた）。文は短く、長い名前は aria-label と title に
  const panelLink = (text, label) => {
    const node = link(text, '#/', 'owned-panel-link');
    node.setAttribute('aria-label', label);
    node.title = label;
    return node;
  };
  const idealLink = panelLink('理想個体 →', 'この条件で理想個体を開く');
  // 目標の印（O-52）を出すか（既定はオン。画面の表示の好みなので絞り込みの条件には入れず、viewState にだけ覚える〔読み込み直すとオン〕）。
  // 保存した目標がないときは隠す
  const marksToggle = el('label', 'owned-marks-toggle');
  const marksCheck = el('input');
  marksCheck.type = 'checkbox';
  marksCheck.checked = memory?.showMarks !== false;
  marksToggle.append(marksCheck, el('span', '', '目標の印'));
  marksToggle.title = '保存した目標の完成品と、目標の欲しいパッシブを持つ個体に印を付けます（印の文字もキーワードで探せます）';
  marksToggle.hidden = true;
  const routeLink = panelLink('継承ルート →', 'このパッシブを運ぶ継承ルートを開く');

  // ---- パネル（sticky。高さは画面の section の --panel-h に書き続ける〔owned-rows の列見出しの top・scroll-margin-top が使う〕） ----
  // 見出しと区切りは理想個体のパネルと同じ部品・同じ CSS の決まり（views/shared.js の fieldHead・panelItem・panelLine。D28）:
  //   1 段目 [パル（見出しの行に「理想個体 →」）][パッシブ（見出しの行にパッシブの条件と「継承ルート →」）][キーワード]（見出しは入力の上）
  //   2 段目 1 行目 [所持者][個体値（以上）][★][属性 ▾]、2 行目 [場所のチップ]（見出しは入力の左、欄の間に縦の区切り線）
  //   結果の行（状態の行）[件数][効いている条件のチップ][+n] … [目標の印][すべて解除][並べ替え]
  const panel = el('section', 'owned-panel');
  panel.setAttribute('aria-label', '所持パルの絞り込み');
  const panelMain = el('div', 'owned-panel-main');
  const keywordField = field('キーワード', query);
  keywordField.classList.add('owned-keyword');
  fieldHead(picker.element, idealLink);
  // パッシブの条件（全部持つ／だけ／なし）はパッシブの欄の見出しの行に置く（前は 2 段目に「パッシブ」の見出しでもう 1 回出していた）
  fieldHead(passive.element, modeChoice.element, routeLink);
  panelMain.append(picker.element, passive.element, keywordField);
  const panelSub = el('div', 'owned-panel-sub');
  panelSub.append(
    panelLine(
      panelItem('所持者', holderSelect.element, { hidden: true, className: 'owned-holder-item' }),
      panelItem('個体値（以上）', talentBox, { className: 'owned-talent-item' }),
      panelItem('★', stars, { tag: 'label', hidden: true, className: 'owned-stars-item' }),
      elementSlot,
    ),
    panelLine(panelItem('場所', placeBox, { hidden: true, className: 'owned-places' })),
  );
  // 並べ替えの選択にも見出し（読み上げの名前は select の aria-label「並べ替え」のまま）
  const sortField = el('label', 'owned-sort-field');
  const sortCaption = el('span', 'field-label', '並べ替え');
  sortCaption.setAttribute('aria-hidden', 'true');
  sortField.append(sortCaption, sort);
  // 図鑑順のときの種族の見出しの畳み（F068）。畳んだ種族は viewState に残す（タブを替えても残る）。「種族を畳む／開く」は全部の種族
  const collapsed = new Set(Array.isArray(memory?.collapsed) ? memory.collapsed : []);
  const saveCollapsed = () => { if (memory) memory.collapsed = [...collapsed]; };
  let speciesKeys = [];
  const foldAll = button('', () => {
    const all = speciesKeys.length && speciesKeys.every((key) => collapsed.has(key));
    if (all) collapsed.clear();
    else for (const key of speciesKeys) collapsed.add(key);
    saveCollapsed();
    renderResults({ keepPosition: true });
  }, 'button secondary small owned-fold-all');
  foldAll.hidden = true;
  const renderFoldAll = () => {
    const show = filter.sort === 'dex' && speciesKeys.length > 1;
    foldAll.hidden = !show;
    if (!show) return;
    const text = speciesKeys.every((key) => collapsed.has(key)) ? '種族を開く' : '種族を畳む';
    if (foldAll.textContent !== text) foldAll.textContent = text;
    foldAll.title = text === '種族を開く' ? '畳んだ種族をすべて開く' : '図鑑順の種族の見出しをすべて畳む';
  };
  function toggleSpecies(key) {
    if (collapsed.has(key)) collapsed.delete(key);
    else collapsed.add(key);
    saveCollapsed();
    renderResults({ keepPosition: true });
  }
  const statusRow = el('div', 'owned-status-row');
  statusRow.append(count, chipBox, chipMoreSlot, marksToggle, resetButton, foldAll, sortField);
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
  // ---- 配合牧場の帯（farm-board。N-06）。全部の牧場の親・タマゴ・預けた人。既定は閉じる（開閉は viewState。タブを替えても残る）。
  // カードは開いている間だけ作り、閉じたら外す（所持パルの 2,000 行の予算に入れない）。「右に開く」は同じボードを右のドロワーで。
  // 固定の条件のパネルより上（スクロールで流れる位置）。牧場の情報がないデータ（牧場を読む前のセーブ・共有する前のデータ）では出さない ----
  const farmBand = el('section', 'farm-band');
  farmBand.setAttribute('aria-label', '配合牧場');
  farmBand.hidden = true;
  const farmHead = el('div', 'farm-band-head');
  const farmToggle = button('', () => setFarmsOpen(!farmsOpen), 'farm-band-toggle');
  // 見出しは ▶ の後にゲームの配合牧場のアイコン（game-assets。読めなければ文字だけ）と文字
  const farmToggleText = el('span', 'farm-band-text');
  farmToggle.append(gameIcon('ui/breed-farm.png', { size: 20, className: 'farm-icon' }), farmToggleText);
  const farmBody = el('div', 'farm-band-body');
  farmBody.id = `farm-band-${Math.random().toString(36).slice(2, 10)}`;
  farmBody.hidden = true;
  farmToggle.setAttribute('aria-controls', farmBody.id);
  const farmOpenDrawer = button('右に開く', () => context.drawer?.open({ kind: 'farms', id: '' }, { opener: farmOpenDrawer }), 'button secondary small farm-band-open');
  farmOpenDrawer.title = '配合牧場を右のパネルで開く（一覧を見たまま確かめる）';
  farmHead.append(farmToggle, farmOpenDrawer);
  farmBand.append(farmHead, farmBody);
  let farmsOpen = Boolean(memory?.farmsOpen);
  let board = null;
  function setFarmsOpen(open) {
    farmsOpen = open;
    if (memory) memory.farmsOpen = open;
    renderFarmBand();
  }
  function renderFarmBand() {
    const data = owned.state.owned;
    const farms = Array.isArray(data?.farms) ? data.farms : null;
    farmBand.hidden = !farms;
    farmOpenDrawer.hidden = !context.drawer;
    if (!farms) {
      board?.destroy();
      board = null;
      farmBody.replaceChildren();
      return;
    }
    const eggs = data.farmsCounted === false ? null : farms.reduce((sum, farm) => sum + farm.eggCount, 0);
    // ケーキ切れの牧場の数（ケーキの分かる牧場だけ。閉じたままでも気づけるように警告の色で。フェーズ 4 の終わりのレビュー）
    const out = farms.filter(cakesOut).length;
    const text = `配合牧場（${farms.length} か所${eggs === null ? '' : ` · タマゴ ${eggs} 個`}`;
    if (farmToggleText.textContent !== `${text}${out ? ` · ケーキ切れ ${out}` : ''}）`) {
      farmToggleText.replaceChildren(el('span', '', text), ...(out ? [el('span', '', ' · '), el('span', 'farm-band-alert', `ケーキ切れ ${out}`)] : []), el('span', '', '）'));
    }
    farmToggle.setAttribute('aria-expanded', String(farmsOpen));
    farmBody.hidden = !farmsOpen;
    if (farmsOpen && !board) {
      board = farmBoard(context, { mode: 'band' });
      farmBody.append(board.element);
    } else if (!farmsOpen && board) {
      board.destroy();
      board = null;
      farmBody.replaceChildren();
    }
  }
  renderFarmBand();
  const stopFarms = owned.subscribe(() => renderFarmBand());
  element.append(summary, farmBand, panel, head, results);
  // ---- 個体の詳細（右のドロワー。owned-detail）。行の Lv・★のボタンと、パッシブ・個体値・場所のセル・下の段を押すと開く。リスナーは一覧の
  // 入れ物に 1 つだけ（行ごとに付けない）。パル名のリンク（パル詳細）・「+N」などのボタン・パッシブのチップ（押すと解説の板を固定）と、
  // 文字を選んでいるときは開かない。開いている個体の行に aria-current と淡い地 ----
  const drawer = context.drawer;
  let openedId = drawer?.current()?.kind === 'owned' ? drawer.current().id : '';
  function markOpened(row, id) {
    const on = Boolean(openedId) && id === openedId;
    if (on) row.setAttribute('aria-current', 'true');
    else if (row.getAttribute('aria-current')) row.removeAttribute('aria-current');
  }
  openDetailOnClick(results, drawer, { query: () => filter.query });
  const stopDrawer = drawer?.subscribe?.((current) => {
    const next = current?.kind === 'owned' ? current.id : '';
    if (next === openedId) return;
    openedId = next;
    for (const row of results.querySelectorAll('[aria-current="true"]')) row.removeAttribute('aria-current');
    if (!openedId) return;
    for (const row of results.querySelectorAll('.owned-row')) if (row.getAttribute('data-instance') === openedId) row.setAttribute('aria-current', 'true');
  }) ?? (() => {});
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
    holderSelect.update({ value: holderNow() });
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
    if (noticesKey !== null && (state.busy || state.auto?.status === 'checking')) return;
    const list = ownedNotices(state, {
      userId: context.store.state.userId, selfUids: context.ideals?.selfUids?.() ?? new Set(), ...mappingOptions(context.autoRegister, state),
    });
    const key = JSON.stringify(list);
    if (key === noticesKey) return;
    // 案内の帯はパネルより上にあるので、出入りすると下の一覧が上下する（一覧は overflow-anchor: none）。一覧の先頭がパネルの下に
    // 隠れるまでスクロールしているときは、帯は画面の外なので、書き換えた分だけスクロールして一覧を同じ位置に保つ。
    // ページの上の方を見ているときは動かさない（新しい帯が見えるように）
    const before = noticesKey !== null ? scrolledTop() : null;
    noticesKey = key;
    noticeList(list, notices, noticeActions);
    summary.hidden = notices.hidden;
    if (before === null) return;
    const moved = results.getBoundingClientRect().top - before;
    if (moved) globalThis.window?.scrollBy?.(0, moved);
  }
  // 一覧の先頭がパネル（と列見出し）の下に隠れているときの、一覧の上端の位置。隠れていなければ null
  function scrolledTop() {
    const top = results.getBoundingClientRect?.().top;
    return Number.isFinite(top) && top < fixedBottom() - 1 ? top : null;
  }

  // ---- データごとに 1 回だけ作るもの（場所ごとの数〔0 体の場所のチップを隠す・グローバルの数〕・所持者の許す個体） ----
  let stats = null;
  function statsOf(data) {
    if (stats?.data === data) return stats;
    const counts = new Map();
    for (const pal of data?.pals ?? []) counts.set(pal.placeGroup, (counts.get(pal.placeGroup) ?? 0) + 1);
    stats = { data, counts };
    return stats;
  }
  // 所持者で許す個体の ID の Set（理想個体と同じ意味）。データ・所持者・自分のプレイヤーが変わったときだけ作り直す。
  // 自分のプレイヤーが分からないときの自分（既定）は「すべて」（holderValue）なので、0 件にはしない（D29。前は「自分のプレイヤーが分かりません」で 0 件）
  const selfKey = () => [...(context.ideals?.selfUids?.() ?? [])].join(',');
  let holderIds = null;
  function allowedIds(data) {
    const holder = holderNow();
    if (!holder || !data) return null;
    const self = holder === 'mine' ? selfKey() : '';
    if (holderIds?.data === data && holderIds.holder === holder && holderIds.self === self) return holderIds.ids;
    const pals = holder === 'mine' ? context.ideals?.mine?.() : palsOfPlayers(data, new Set([holder.slice('player:'.length)]));
    holderIds = { data, holder, self, ids: new Set((pals ?? []).map((pal) => pal.id)) };
    return holderIds.ids;
  }

  // 選択肢にない値は選ばない。読み込み前は選択肢がそろっていないため、選んでいた値は消さずに残す。
  // 選んでいる途中（フォーカス中）は作り直さず、離れてから作り直す。待っていた作り直し（blur の後）で選んでいた値を外したときは、
  // 一覧とパッシブの数も数え直す（renderFilters の中からのときは、呼んだ側がこの後で描く）
  let syncingFilters = false;
  let holderOptions = [['', 'すべて']];
  // 選択肢を作ったときの自分のプレイヤー（ログインの ID・ユーザーの一覧が後から届いて変わったら、選択肢と一覧を描き直す）
  let shownSelf = null;
  // 選択肢を作ったときのプレイ中の仲間（ui/owned-status.js の onlineKey。保存が古くなると変わる）
  let shownOnline = null;
  function renderHolders(state) {
    // 所持者の選択肢（理想個体と同じ名前。views/shared.js）
    // いまプレイ中の人には「（プレイ中）」（保存が新しいときだけ。save-extras）
    const online = onlineUids(state);
    shownOnline = [...online].sort().join(',');
    const choices = holderChoices(state.owned, context.ideals, { online });
    holderOptions = choices;
    shownSelf = selfKey();
    renderWhenIdle(holderSelect.element, () => {
      // 選んでいたプレイヤーがいなくなったら既定（自分。分からなければ「すべて」）に戻す
      if (!choices.some(([value]) => value === holderNow()) && owned.state.owned) {
        filter.holder = HOLDER_DEFAULT;
        if (!syncingFilters) renderResults();
      }
      holderSelect.update({ options: choices, value: holderNow() });
    });
  }
  function renderPlaces(state) {
    const { counts } = statsOf(state.owned);
    for (const [group, chip] of placeChips) {
      chip.hidden = !counts.get(group);
      chip.setAttribute('aria-pressed', String(filter.places.includes(group)));
    }
  }
  function renderFilters(state) {
    syncingFilters = true;
    try {
      renderHolders(state);
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
    // 所持者は既定（自分。分からなければ「すべて」）と違うときだけ。「すべて」も既定と違えば出す（× で既定に戻す）
    const holder = holderNow();
    if (holder !== holderValue(HOLDER_DEFAULT, context.ideals)) {
      const name = holderOptions.find(([value]) => value === holder)?.[1] ?? holder.replace(/^player:/, '');
      add('holder', `所持者: ${name}`, () => { filter.holder = HOLDER_DEFAULT; });
    }
    if (!sameList(filter.places, DEFAULT_PLACES)) add('places', `場所: ${placesText()}`, () => { filter.places = [...DEFAULT_PLACES]; });
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
    // × は飾り（名前はチップの aria-label）。SVG のアイコンでパッシブのチップの × と同じ形・大きさ（ui/icons.js の close）
    const remove = el('span', 'filter-chip-x');
    remove.setAttribute('aria-hidden', 'true');
    remove.append(icon('close', { className: 'close-icon' }));
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
    setDisabled(resetButton, !items.length, '既定から変えた条件はありません');
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
  // 件数の行: 「N / M 体 · ♂a ♀b タマゴ c」。グローバルパルボックスを外していて数があれば title に
  function renderCount(state, shown, totals) {
    if (!state.owned) {
      count.textContent = '';
      count.title = '';
      return;
    }
    const detail = `♂${totals.M} ♀${totals.F}${totals.eggs ? ` タマゴ ${totals.eggs}` : ''}`;
    const text = `${shown} / ${state.owned.pals.length} 体 · ${detail}`;
    // 出ている数を太く、内訳は薄く（結果の行だと一目で分かるように。D28）。文は前と同じ
    if (count.textContent !== text) {
      count.replaceChildren(el('strong', 'owned-count-shown', String(shown)), el('span', '', ` / ${state.owned.pals.length} 体`),
        el('span', 'owned-count-detail', ` · ${detail}`));
    }
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
  function flushInputs() {
    for (const input of pendingInputs) input.flush();
    talents.flush();
  }

  // ---- 入手の NEW（save-extras。O-26・F053）: 前に所持パルの画面で見ていたデータのセーブの時刻（web/js/owned-seen.js。ワールドごと）より後に
  // 入手した個体に印。基準はこの画面を開いて、そのワールドのデータが届いたときに 1 回だけ読み、開いている間は変えない（読み直しで届いた
  // 新しい個体にも NEW が付く）。初めて開いた（保存がない）ときは NEW を付けず、そのときのデータの時刻を保存する。この画面を離れるとき・
  // タブが裏に回ったとき・別のワールドに替えたときに、見ていたデータのセーブの時刻を保存する（次に開いたときの基準） ----
  const seenStore = context.ownedSeen;
  // 今の基準（key は環境・ID・ワールド。since は時刻の文字列で、'' は NEW を付けない）と、見ているデータ
  let newSince = { key: '', since: '' };
  let viewed = null;
  const isNewPal = (pal) => Boolean(newSince.since) && Boolean(pal.ownedAt) && pal.ownedAt > newSince.since && !pal.heading;
  // 見ていたときと環境・ログインの ID が違うか（名前の変更・ログインし直し。ログアウトした〔空〕ときは違うとみなさない）
  const otherScope = (seen, env, userId) => Boolean(env && env !== seen.env) || Boolean(userId && userIdKey(userId) !== userIdKey(seen.userId));
  function saveSeen() {
    if (!viewed) return;
    // 名前を変えた後は、前の ID のキーに書き戻さない（user-rename.js が移して消したキーが戻る）
    if (otherScope(viewed, context.store?.state?.env ?? '', context.store?.state?.userId ?? '')) return;
    seenStore?.write(viewed.env, viewed.userId, viewed.worldId, viewed.at);
  }
  /** 基準を合わせる（データ・環境・ログインの ID が変わったとき）。NEW の基準が変わったら true（呼び出し側が行を描き直す） */
  function trackNew(state) {
    const env = context.store?.state?.env ?? '';
    const userId = context.store?.state?.userId ?? '';
    const worldId = state.meta?.worldId ?? '';
    const at = state.owned && state.meta?.source ? seenTime(state.meta.saveUpdatedAt) : '';
    if (!seenStore || !env || !userId || !worldId || !at) return false;
    const key = `${env}\u0001${userIdKey(userId)}\u0001${worldId}`;
    let changed = false;
    if (newSince.key !== key) {
      // 同じ環境・ID のまま別のワールドに替わったら、前に見ていたワールドの時刻を保存してから新しい基準を読む。環境・ID が変わったら
      //（名前の変更など）前に見ていた時刻は書かずに捨てる
      if (viewed && viewed.key !== key && !otherScope(viewed, env, userId)) saveSeen();
      const stored = seenStore.read(env, userId, worldId);
      changed = (stored ?? '') !== newSince.since;
      newSince = { key, since: stored ?? '' };
      if (!stored) seenStore.write(env, userId, worldId, at);
    }
    viewed = { key, env, userId, worldId, at };
    return changed;
  }
  // タブが裏に回ったら（ゲームに戻る・ページを閉じる前にも来る）、見ていたデータの時刻を保存する（この画面の NEW はそのまま）
  globalThis.document?.addEventListener?.('visibilitychange', () => {
    if (globalThis.document?.visibilityState === 'hidden') saveSeen();
  }, { signal: inputs.signal });

  // ---- 一覧（行は個体の ID で使い回す。中身が同じ行は触らない） ----
  let terms = [];
  let termsKey = '';
  // 行の下の段（目標の印・キーワードに一致した理由）の場所を取っているか（一覧の has-band。全部の行の高さが変わる。D25）
  let bandShown = false;
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
  // 行に渡すもの（キーワードに一致した理由・目標の印）
  const rowOptionsOf = (pal) => {
    const marks = shownMarks?.get(pal.id) ?? [];
    // 一致した理由には、キーワードで一緒に探している目標の印も入れる（filterOwned の extraTexts と同じ文字）
    return { notes: terms.length ? keywordNotes(pal, terms, marks) : [], marks, isNew: isNewPal(pal) };
  };
  // 一覧の 1 行（ownedRowItem を、区切った書き換えに乗せる）。作ったばかりの行と、先頭から決まった数（FILL_NOW）の行はすぐ書き換え、
  // 残りは区切って書き換える（区切る行は、一致の理由・印を求めるのも書き換えるときにする）。中身は変わったセルだけを書き換える
  //（一致の理由だけが変わったら理由の行だけ）
  // 種族の見出しの行（F068）: 畳むボタン（絵・名前・「5 体 · ♂3 ♀2 · タマゴ 1 · 最高 Lv 37」）と、その種族の理想個体・継承ルート・配合を探すへの小さなリンク
  function speciesHead(item) {
    const element = el('div', 'owned-species');
    const toggle = button('', () => toggleSpecies(item.key), 'owned-species-toggle');
    toggle.setAttribute('data-focus-key', `species:${item.key}`);
    const master = palsById.get(item.palId);
    const name = el('strong', 'owned-species-name', master ? `No.${master.label} ${master.ja}` : 'パル以外（人間など）');
    const facts = el('span', 'owned-species-facts');
    toggle.append(...(master ? [palIcon(master)] : []), name, facts);
    element.append(toggle);
    if (master) {
      const links = el('span', 'owned-species-links');
      const named = (text, href, name) => {
        const node = link(text, href, 'owned-species-link');
        node.setAttribute('aria-label', name);
        return node;
      };
      links.append(named('理想個体', buildHash('ideal', { to: master.id }), `${master.ja}の理想個体`),
        named('継承ルート', buildHash('route', { to: master.id }), `${master.ja}への継承ルート`),
        named('産まれる配合', buildHash('search', { c: master.id }), `${master.ja}が産まれる配合`));
      element.append(links);
    }
    const update = (next) => {
      const text = `${next.count} 体 · ♂${next.male} ♀${next.female}${next.eggs ? ` · タマゴ ${next.eggs}` : ''}${next.maxLevel ? ` · 最高 Lv ${next.maxLevel}` : ''}`;
      if (facts.textContent !== text) facts.textContent = text;
      toggle.setAttribute('aria-expanded', String(!next.collapsed));
      element.classList.toggle('is-collapsed', next.collapsed);
    };
    update(item);
    return { element, update, fill: update, destroy() {} };
  }
  function listRow(pal) {
    if (pal.heading) return speciesHead(pal);
    let last = pal;
    let lastTerms = termsKey;
    let lastMarks = marksStamp;
    let lastNew = newSince.since;
    const first = rowOptionsOf(pal);
    // ドロワーがあれば Lv・★のセルを個体の詳細を開くボタンにする（owned-detail）
    const row = ownedRowItem(pal, { ...first, detail: Boolean(context.drawer) });
    markOpened(row.element, pal.id);
    let signature = rowSignature(pal, first.notes, first.marks, first.isNew);
    const item = {
      element: row.element,
      // 今のキーワード・印で next の中身にする（同じなら何もしない）
      fill(next) {
        markOpened(row.element, next.id);
        const options = rowOptionsOf(next);
        const nextSignature = rowSignature(next, options.notes, options.marks, options.isNew);
        if (nextSignature === signature) return;
        row.update(next, options);
        signature = nextSignature;
      },
      update(next) {
        // 区切って足すときは同じ個体で何度も呼ばれるので、個体・キーワード・印・NEW の基準が同じなら何もしない
        if (next === last && termsKey === lastTerms && marksStamp === lastMarks && newSince.since === lastNew) return;
        last = next;
        lastTerms = termsKey;
        lastMarks = marksStamp;
        lastNew = newSince.since;
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
  const rowOptions = {
    key: (pal) => pal.id, create: listRow,
    empty: () => empty('条件に合うパルはいません。', button('条件をすべて解除', () => resetAll(), 'button secondary'), { icon: 'owned' }),
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
  // keepPosition: データの更新のとき（条件の変更では戻さない）、見ていた行を同じ位置に戻す。
  // reveal: 利用者が条件を変えた（この後で一覧の先頭を見せる〔revealResults〕ので、行の高さが変わっても見ていた行は戻さない）
  function renderResults({ keepPosition = false, reveal = false } = {}) {
    // 閉じた後に遅れて呼ばれたとき（並べ替えの動きの後など）は描かない
    if (destroyed) return;
    const job = ++jobSeq;
    fillBudget = FILL_NOW;
    const state = owned.state;
    renderChips(state);
    renderLinks();
    const none = filter.passiveMode === 'none';
    if (!state.owned) {
      renderCount(state, 0, null);
      shownCount = 0;
      head.hidden = true;
      results.classList.toggle('is-empty', true);
      marksToggle.hidden = true;
      passive.update({ selected: filter.passives, counts: new Map(), disabled: none });
      leaveVirtual();
      clearList(results);
      results.append(state.ready ? empty('表示できる所持パルがありません。', null, { icon: 'owned' }) : loadingState('所持パルを読み込み中…'));
      return;
    }
    const ids = allowedIds(state.owned);
    // 目標の印（表示がオンのときだけ。印の文字もキーワードで探す）
    const markMap = marksOf(state.owned);
    marksToggle.hidden = !marks.count;
    shownMarks = marksCheck.checked && marks.count ? markMap : null;
    marksStamp = shownMarks ? `on:${marksVersion}` : 'off';
    const matched = filterOwned(state.owned.pals, { ...filter, ids, extraTexts: shownMarks });
    const totals = totalsOf(matched);
    passive.update({ selected: filter.passives, counts: totals.counts, disabled: none });
    const list = sortOwned(matched, filter.sort, filter.dir);
    terms = keywordTerms(filter.query);
    termsKey = terms.join(' ');
    // 行の下の段を取るのは「目標の印を出していて、保存した目標が 1 つ以上ある」か「キーワードがある」とき（D25）。どちらも利用者の操作でだけ
    // 変わるので、データの読み直し（10 秒ごとなど）では行の高さが変わらない。印のない行も同じ高さにする
    const band = Boolean(shownMarks) || terms.length > 0;
    const bandChanged = band !== bandShown;
    // 空の表示だけのときは帯を敷かない（CSS の .owned-list.is-empty。:has() は行の出し入れのたびに全体を計算し直させるので使わない）
    results.classList.toggle('is-empty', !list.length);
    head.hidden = !list.length;
    renderCount(state, list.length, totals);
    // 図鑑順のときは種族の見出しを混ぜる（F068。ほかの並べ替えでは出さない）。以後の描き方は見出しを含めた items で行う
    //（見えている範囲だけ描くか・並べ替えの動きを付けるかも、見出しを含めた行の数で決める）
    const items = filter.sort === 'dex' ? withSpeciesHeads(list, collapsed) : list;
    shownCount = items.length;
    speciesKeys = filter.sort === 'dex' ? items.filter((item) => item.heading).map((item) => item.key) : [];
    renderFoldAll();
    // 見ていた行を同じ位置に戻す: データの更新のときと、行の高さが変わる（下の段の出し入れ）のに一覧の先頭が固定の部分の下に隠れているとき
    //（上の行の高さが変わって、見ていた行が動く。条件を変えたときは、この後で一覧の先頭を見せるので戻さない）。高さを変える前に覚える
    const holdRow = keepPosition || (bandChanged && !reveal && scrolledTop() !== null);
    const anchor = holdRow ? anchorOf(virtual ? virtual.rows : results, fixedBottom()) : null;
    if (bandChanged) {
      bandShown = band;
      results.classList.toggle('has-band', band);
    }
    const estimate = band ? ROW_ESTIMATE_BAND : ROW_ESTIMATE;
    // 2,000 行を超えたら、見えている範囲だけを描く
    if (items.length > VIRTUAL_OVER) {
      if (!virtual) {
        clearList(results);
        virtual = virtualRows(results, { key: rowOptions.key, create: listRow, estimate, topOffset: fixedBottom });
      }
      // 行の高さが変わったら、測って覚えた高さを捨てて見積もりを変える（全部の行が同じ高さ）
      virtual.setEstimate(estimate);
      // 見ていた行の位置で先に描く（今の位置より前に多数の行が増えても戻せる）。測った高さとのずれは restoreAnchor で直す
      virtual.render(items, { anchor });
      restoreAnchor(virtual.rows, anchor);
      flushDeferred();
      return;
    }
    leaveVirtual();
    const existing = listKeys(results);
    let fresh = 0;
    for (const pal of items) if (!existing.has(pal.id)) fresh++;
    // 件数が多くても、最初からすべて出す（もっと見るはない）。まだ無い行が多いときだけ、先頭の 200 行をすぐ出して残りを区切って足す
    if (fresh <= FIRST_ROWS) {
      syncList(results, items, rowOptions);
      restoreAnchor(results, anchor);
      flushDeferred();
      return;
    }
    // 出す行 = 残る既存の行 ∪ 先頭の 200 行。既存の行は消さずに使い回し（一覧が縮んで位置が飛ばない）、
    // まだ無い行を並び順に step 件ずつ足していく
    const present = new Set();
    items.forEach((pal, i) => { if (i < FIRST_ROWS || existing.has(pal.id)) present.add(pal.id); });
    const inPresent = () => items.filter((pal) => present.has(pal.id));
    let next = FIRST_ROWS;
    let step = 100;
    syncList(results, inPresent(), rowOptions);
    let anchored = restoreAnchor(results, anchor);
    const tick = () => {
      if (job !== jobSeq || destroyed) return;
      const start = clock();
      for (let added = 0; next < items.length && added < step; next++) {
        if (present.has(items[next].id)) continue;
        present.add(items[next].id);
        added++;
      }
      syncList(results, inPresent(), rowOptions);
      if (!anchored) anchored = restoreAnchor(results, anchor);
      const spent = clock() - start;
      step = Math.max(STEP_MIN, Math.min(STEP_MAX, Math.round(spent > 0 ? step * (SLICE_MS * 0.75) / spent : STEP_MAX)));
      if (next < items.length) nextFrame(tick);
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
    if (state.owned === renderedOwned && (state.owned || state.ready === renderedReady)) {
      // データが同じでも、時間がたって保存が古くなったら「（プレイ中）」を外すため、所持者の選択肢だけ描き直す（save-extras。Codex のレビュー）
      if (onlineKey(state) !== shownOnline) renderHolders(state);
      return;
    }
    renderedOwned = state.owned;
    renderedReady = state.ready;
    trackNew(state);
    renderFilters(state);
    // 候補を開いたままでも、所持数だけ描き直す（閉じない）
    picker.update();
    renderResults({ keepPosition: true });
    warmKeywords(state.owned);
  }

  const unsubscribe = owned.subscribe(update);
  // 自分のプレイヤー（ログインの ID・ユーザーの一覧・登録者の対応・このワールドでの自分で決まる）が後から分かった・変わったら、
  // 所持者の選択肢と一覧（件数・行・パッシブの所持数）を描き直す（既定の自分は、分かるまで「すべて」として描いている）。
  // 許す個体の Set（holderIds）は自分の UID の並びも鍵にしているので作り直される。このワールドでの自分は設定や別のタブで変わる（context.self）
  // 環境・ログインの ID が後から分かった・変わったときも、NEW の基準を合わせる（配合のキャッシュがない端末では、所持パルのデータが環境より
  // 先に届く。開いたまま名前を変えたら、前の ID の基準は書かずに捨てる。trackNew。フェーズ 4 の終わりのレビュー）
  const selfChanged = () => {
    if (destroyed) return;
    const sinceChanged = trackNew(owned.state);
    // 参加者のパル次元ストレージの読み漏れの案内は、自分のプレイヤーで出し分ける（同じ案内なら描き直さない）
    renderSummary(owned.state);
    if (selfKey() === shownSelf) {
      if (sinceChanged) renderResults({ keepPosition: true });
      return;
    }
    renderFilters(owned.state);
    renderResults({ keepPosition: true });
  };
  const stopSelf = context.store?.subscribe?.(selfChanged) ?? (() => {});
  const stopSelfChoice = context.self?.subscribe?.(selfChanged) ?? (() => {});
  renderedOwned = owned.state.owned;
  renderedReady = owned.state.ready;
  trackNew(owned.state);
  renderSummary(owned.state);
  renderFilters(owned.state);
  renderResults();
  warmKeywords(owned.state.owned);
  // 開いたときに 1 回読み直す。開いている間の読み直しは、どの画面でも app.js の 10 秒ごとのタイマーが行う（画面はタイマーを持たない。share-fetch）
  owned.load().then(() => owned.autoRefresh()).catch(() => {});
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
      // 見ていたデータのセーブの時刻を、次に開いたときの NEW の基準にする（save-extras）
      saveSeen();
      stopSelf();
      stopSelfChoice();
      stopGoals();
      stopTracking();
      chipObserver?.disconnect();
      inputs.abort();
      for (const input of pendingInputs) input.cancel();
      talents.destroy();
      modeChoice.destroy();
      holderSelect.destroy();
      presetMenu.destroy();
      elementPopover.destroy();
      chipPopover.destroy();
      jobSeq++;
      warmSeq++;
      unsubscribe();
      stopFarms();
      board?.destroy();
      stopDrawer();
      picker.destroy();
      passive.destroy();
      leaveVirtual();
      clearList(results);
    },
  };
}
