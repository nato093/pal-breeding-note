import { el, field, empty, syncList, listKeys, clearList, anchorOf, restoreAnchor, onTextInput } from '../ui/dom.js';
import { palTile, humanIcon, palsById } from '../ui/pal-icon.js';
import { palPicker } from '../ui/pal-picker.js';
import { passiveList, passiveSelector } from '../ui/passive-picker.js';
import { talentInput } from '../ui/talent-input.js';
import { ownedNotices, noticeList, ownedSourceLine } from '../ui/owned-status.js';
import { virtualRows } from '../ui/virtual-list.js';
import { withTransition } from '../ui/motion.js';
import { viewHeading, syncPicker, syncOptions, ownedSpeciesNotes, keepRefreshing, changeRoute } from './shared.js';
import { toast } from '../ui/toast.js';
import { buildHash } from '../router.js';
import { filterOwned, sortOwned, passiveCounts, keywordTerms, keywordNotes, prepareKeywords, OWNED_SORTS, PLACE_ORDER, placeGroupLabel } from '../core/owned.js';
import { cleanSaved, list, internalName, text, oneOf, intIn, bool } from '../core/boundary.js';

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

const talentAtLeast = (value) => intIn(value, { min: 0, max: 100, fallback: 0 });
/**
 * 保存して読み戻す絞り込みの形（ui/view-memory.js が sessionStorage・履歴のエントリから読むときに、項目ごとに確かめる）。
 * 合わない項目は既定の値に戻す。1c の owned-toolbar で絞り込みの形（場所のチップ・所持者）を変えたら、ここも直す
 */
export const OWNED_MEMORY = {
  // 所持者: すべて・プレイヤー（player:<uid>）・拠点（base:<id>）・グローバルパルボックス
  holder: (value) => (typeof value === 'string' && value.length <= 80 && (value === '' || value === 'global' || /^(player|base):\S/.test(value)) ? value : ''),
  place: (value) => oneOf(value, ['', ...PLACE_ORDER], ''),
  palId: (value) => (typeof value === 'string' && palsById.has(value) ? value : ''),
  // パッシブは内部名の形の ID だけ（重複は除く）。マスターにまだ無い内部名も残す（所持パルに付いていれば候補に出て選べる）
  passives: (value) => list(value, { max: 4, map: (id) => internalName(id) || null, key: (id) => id }),
  query: (value) => text(value, 100),
  sort: (value) => oneOf(value, OWNED_SORTS.map(([key]) => key), 'dex'),
  eggs: (value) => bool(value, true),
  globals: (value) => bool(value, false),
  stars: (value) => intIn(value, { min: 0, max: 4, fallback: 0 }),
  talent: (value) => cleanSaved(value, { hp: talentAtLeast, shot: talentAtLeast, defense: talentAtLeast }),
};
// 一覧の描き方（性能の予算: 2,000 行で最初の 200 行が 100ms 以内・全行が 1 秒以内。2,000 行を超えたら見えている範囲だけ描く）
const FIRST_ROWS = 200;
const VIRTUAL_OVER = 2000;
// 残りの行を足す 1 回の区切り（16ms 以内）。前の区切りの速さで、足す行数を 25〜400 の間で増減する
const SLICE_MS = 16;
const STEP_MIN = 25;
const STEP_MAX = 400;
const clock = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());
const nextFrame = (fn) => (typeof globalThis.requestAnimationFrame === 'function' ? globalThis.requestAnimationFrame(fn) : setTimeout(fn, 0));
// 固定のヘッダーの下端（自動の更新の後に、見ていた行を同じ位置に戻すときの基準）
const headerBottom = () => globalThis.document?.querySelector?.('.app-header')?.getBoundingClientRect().bottom ?? 0;

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
  const memory = context.viewState?.('owned');
  const filter = memory?.filter ?? {
    holder: '', place: '', palId: '', passives: [], query: '', sort: 'dex', eggs: true, globals: false,
    stars: 0, talent: { hp: 0, shot: 0, defense: 0 },
  };
  if (memory) memory.filter = filter;
  // URL で指定された絞り込みは、覚えている絞り込みより優先する（作るときと、同じ画面のまま URL が変わったとき）。
  // 指定があって絞り込みを入れたら true を返す
  function readRoute(next) {
    if (!['holder', 'place', 'pal', 'p'].some((key) => next.params.has(key))) return false;
    filter.holder = next.params.get('holder') ?? '';
    filter.place = next.params.get('place') ?? '';
    filter.palId = next.params.get('pal') ?? '';
    // 重複と内部名の形でない値は除く（マスターにまだ無い内部名は残す）
    filter.passives = [...new Set((next.params.get('p') ?? '').split(',').filter((id) => internalName(id)))].slice(0, 4);
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

  const filters = el('div', 'selection-panel owned-filters');
  const holder = el('select');
  const place = el('select');
  const query = el('input');
  query.type = 'search';
  query.placeholder = '名前・スキル・属性など（空白で複数）';
  query.value = filter.query;
  const sort = el('select');
  for (const [key, label] of OWNED_SORTS) sort.append(option(key, label));
  const toggleInputs = new Map();
  const checkbox = (label, checked, key) => {
    const input = el('input');
    toggleInputs.set(key, input);
    input.type = 'checkbox';
    input.checked = checked;
    const wrapper = el('label', 'owned-toggle');
    wrapper.append(input, el('span', '', label));
    input.addEventListener('change', () => { filter[key] = input.checked; renderFilters(owned.state); renderResults(); });
    return wrapper;
  };
  const toggles = el('div', 'owned-toggles');
  toggles.append(checkbox('タマゴも表示', filter.eggs, 'eggs'), checkbox('グローバルボックスを表示', filter.globals, 'globals'));
  // 複数の入力をまとめた欄（label で包むと最初の入力にしか結びつかないため div にする）
  const group = (label, control, className = '') => {
    const wrapper = el('div', `owned-filter-group ${className}`.trim());
    wrapper.append(el('span', 'field-label', label), control);
    return wrapper;
  };
  const stars = el('select');
  for (const [value, label] of STAR_FILTERS) stars.append(option(value, label));
  stars.value = filter.stars ? String(filter.stars) : '';
  stars.addEventListener('change', () => { filter.stars = Number(stars.value) || 0; renderResults(); });
  // 個体値の下限（☑ HP [90] 以上。チェックを外すか空欄で条件なし＝0）。数字の入力は間引き、確定（change）・チェック・「すべて …」ですぐ絞る
  const talents = talentInput({
    keys: TALENT_FILTERS.map(([key]) => key), labels: TALENT_LABELS, value: filter.talent,
    ariaLabel: (key) => `${TALENT_LABELS[key]}の個体値（以上）`,
    presets: [
      { label: 'すべて 90 以上', value: { hp: 90, shot: 90, defense: 90 } },
      { label: 'すべて 100', value: { hp: 100, shot: 100, defense: 100 } },
    ],
    debounce: inputDelay,
    onChange: (value) => { filter.talent = { ...value }; renderResults(); },
  });
  // 所持している種族を先に「♂3 ♀2」つきで出す
  const picker = palPicker({ label: 'パル', value: filter.palId, describe: () => ownedSpeciesNotes(owned.state.owned),
    onChange: (id) => { filter.palId = id; renderResults(); } });
  // パッシブの選択欄は 1 回だけ作り、絞り込み・データが変わったら update で合わせる（開いた候補を閉じない）。
  // 所持数は、選んでいるパッシブも含めた今の絞り込みの結果の中の数（renderResults が数える）
  const passive = passiveSelector({
    label: 'パッシブ（すべて持つ個体）', selected: filter.passives, countLabel: 'いまの絞り込みの中で持っているもの', negatives: 'inline',
    onChange: (ids) => {
      filter.passives = ids;
      passive.update({ selected: ids });
      renderResults();
    },
  });
  const passiveSlot = el('div', 'owned-passive-slot');
  passiveSlot.append(passive.element);
  filters.append(field('所持者', holder), field('場所', place), picker.element, field('キーワード', query), field('並べ替え', sort),
    field('パル濃縮（★）', stars), group('個体値（以上）', talents.element), group('表示', toggles), passiveSlot);
  const count = el('p', 'result-note');
  const results = el('div', 'owned-list');
  element.append(summary, filters, count, results);

  // 戻る・進むで条件を入れ直したとき（app.js が履歴のエントリから filter に戻す）、入力欄にも出す
  function showFilter() {
    query.value = filter.query;
    stars.value = filter.stars ? String(filter.stars) : '';
    talents.update(filter.talent);
    for (const [key, input] of toggleInputs) input.checked = filter[key];
  }

  for (const [node, key] of [[holder, 'holder'], [place, 'place']]) {
    node.addEventListener('change', () => { filter[key] = node.value; renderResults(); });
  }
  // 並べ替えは行の順番が変わるので動きを付ける（行が多いとスナップショットが重いので、2,000 行を超えるときは付けない）
  sort.addEventListener('change', () => {
    filter.sort = sort.value;
    if (shownCount > VIRTUAL_OVER) renderResults();
    else withTransition(() => renderResults());
  });
  // キーワードは入力を間引き、日本語の変換中は絞らない
  pendingInputs.push(onTextInput(query, (value) => { filter.query = value; renderResults(); }, { delay: inputDelay, signal: inputs.signal }));

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

  // 選択肢にない値は選ばない。読み込み前は選択肢がそろっていないため、選んでいた値は消さずに残す。
  // フォーカス中で待っていた作り直し（blur の後）で選んでいた値を外したときは、一覧とパッシブの数も数え直す
  //（renderFilters の中からのときは、呼んだ側がこの後で描く）
  let syncingFilters = false;
  function keepChoice(select, key) {
    const valid = [...select.children].some((node) => node.value === filter[key]);
    if (!valid && owned.state.owned && filter[key]) {
      filter[key] = '';
      if (!syncingFilters) renderResults();
    }
    select.value = valid ? filter[key] : '';
  }

  // 選択肢は、並びが前と同じなら作り直さない（開いている選択肢を閉じない）。違っても、選んでいる途中（フォーカス中）は待つ
  function renderFilters(state) {
    syncingFilters = true;
    try {
      const list = state.owned?.pals ?? [];
      const holders = [['', 'すべて'], ...(state.owned?.players ?? []).map((player) => [`player:${player.uid}`, player.name]),
        ...(state.owned?.bases ?? []).map((base) => [`base:${base.id}`, base.label]),
        ...(filter.globals && list.some((pal) => pal.place === 'global') ? [['global', 'グローバルパルボックス']] : [])];
      syncOptions(holder, holders, () => keepChoice(holder, 'holder'));
      const places = [['', 'すべて'], ...PLACE_ORDER
        .filter((group) => !((group === 'global' && !filter.globals) || (group === 'egg' && !filter.eggs)))
        .filter((group) => list.some((pal) => pal.placeGroup === group))
        .map((group) => [group, placeGroupLabel(group)])];
      syncOptions(place, places, () => keepChoice(place, 'place'));
      sort.value = filter.sort;
    } finally {
      syncingFilters = false;
    }
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
  const rowOptions = { key: (pal) => pal.id, create: ownedRowItem, empty: () => empty('条件に合うパルはいません。') };
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
    if (!state.owned) {
      count.textContent = '';
      shownCount = 0;
      passive.update({ selected: filter.passives, counts: new Map() });
      leaveVirtual();
      clearList(results);
      results.append(empty(state.ready ? '表示できる所持パルがありません。' : '読み込み中…'));
      return;
    }
    const matched = filterOwned(state.owned.pals, filter);
    passive.update({ selected: filter.passives, counts: passiveCounts(matched) });
    const list = sortOwned(matched, filter.sort);
    terms = keywordTerms(filter.query);
    termsKey = terms.join(' ');
    count.textContent = `${list.length} 体`;
    shownCount = list.length;
    const anchor = keepPosition ? anchorOf(virtual ? virtual.rows : results, headerBottom()) : null;
    // 2,000 行を超えたら、見えている範囲だけを描く
    if (list.length > VIRTUAL_OVER) {
      if (!virtual) {
        clearList(results);
        virtual = virtualRows(results, { key: rowOptions.key, create: ownedRowItem, estimate: 60, topOffset: headerBottom });
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
    // 同じ画面のまま絞り込みつきの URL が来たとき。作り直さずに、絞り込みと選択欄・一覧を合わせる（キーワードなどの入力は残す）。
    // 戻る・進むで app.js が履歴のエントリの条件を filter に入れ直したとき（restored）は、キーワードなどの入力欄にも出す
    applyRoute(next, { restored = false } = {}) {
      const fromUrl = readRoute(next);
      if (!fromUrl && !restored) return;
      if (restored) showFilter();
      syncPicker(picker, filter.palId);
      renderFilters(owned.state);
      renderResults();
    },
    // 間引いて待っている入力（キーワード・個体値）をすぐ当てる（app.js が、移る前に履歴のエントリへ条件を書く前に呼ぶ）
    flushInputs() {
      for (const input of pendingInputs) input.flush();
      talents.flush();
    },
    destroy() {
      destroyed = true;
      stopRefreshing();
      sourceLine.destroy();
      inputs.abort();
      for (const input of pendingInputs) input.cancel();
      talents.destroy();
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
