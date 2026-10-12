import { el, field, empty, syncList, listKeys, clearList, anchorOf, restoreAnchor, debounce, onTextInput } from '../ui/dom.js';
import { palTile, humanIcon } from '../ui/pal-icon.js';
import { palPicker } from '../ui/pal-picker.js';
import { passiveList, passiveSelector } from '../ui/passive-picker.js';
import { worldName, timeLines, ownedNotices, noticeList } from '../ui/owned-status.js';
import { virtualRows } from '../ui/virtual-list.js';
import { withTransition } from '../ui/motion.js';
import { viewHeading, syncPicker, syncOptions, renderWhenIdle } from './shared.js';
import { toast } from '../ui/toast.js';
import { buildHash } from '../router.js';
import { filterOwned, sortOwned, passiveCounts, keywordTerms, keywordNotes, prepareKeywords, OWNED_SORTS, PLACE_ORDER, placeGroupLabel } from '../core/owned.js';

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

function palCell(pal) {
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
  if (badges.children.length) cell.append(badges);
  return cell;
}

/** @param {{ notes?: { label: string, name: string, desc: string }[] }} [options] notes は一致した理由（core/owned.js の keywordNotes） */
export function ownedRow(pal, options) {
  return fillOwnedRow(el('article', 'owned-row'), pal, options);
}

/** 行の要素の中身を pal の内容で入れ直す（一覧で同じ個体の要素を使い回すとき）。 */
export function fillOwnedRow(row, pal, { notes = [] } = {}) {
  row.setAttribute('aria-label', `${pal.name}${pal.nickname ? `（${pal.nickname}）` : ''}`);
  const level = el('div', 'owned-level');
  level.append(el('strong', '', pal.egg ? '孵化前' : `Lv ${pal.level}`), el('small', 'owned-stars', pal.stars ? '★'.repeat(pal.stars) : '☆なし'));
  const where = el('div', 'owned-where');
  where.append(el('strong', '', pal.holder), el('small', 'muted', pal.placeLabel));
  if (pal.place === 'base' && pal.lastOwner) where.append(el('small', 'muted', `預けた人 ${pal.lastOwner}`));
  const passives = el('div', 'owned-passives');
  passives.append(pal.passives.length ? passiveList(pal.passives) : el('span', 'muted', 'パッシブなし'), ...noteLines(notes));
  row.replaceChildren(palCell(pal), level, passives, el('div', 'owned-talent', talentText(pal.talent)), where);
  return row;
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
  const element = el('section', 'view owned-view');
  element.append(viewHeading('所持パル'));
  // タブを切り替えて戻ってきても、前の絞り込みのまま出す（ページを読み込み直すと既定に戻る）。
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
    filter.passives = (next.params.get('p') ?? '').split(',').filter(Boolean).slice(0, 4);
    // 画面内で変えた絞り込みは URL に出ないため、戻ってきたときに古い URL の指定で上書きしないよう外しておく。
    if (memory) context.replace(buildHash('owned'));
    return true;
  }
  readRoute(route);

  // 表示しているデータのワールドと更新時刻、連携の案内（設定の操作は設定タブで行う）
  const summary = el('section', 'owned-summary');
  const title = el('p', 'owned-world');
  const times = el('p', 'owned-times muted');
  const notices = noticeList([]);
  // 許可はクリックの中で求める必要があるため、案内の中にボタンを出す（許可の後にそのまま読み込む）
  const noticeActions = { grant: { label: '読み込みを許可', run: () => owned.grantAndRefresh().catch((error) => toast(error.message)) } };
  summary.append(title, times, notices);

  const filters = el('div', 'selection-panel owned-filters');
  const holder = el('select');
  const place = el('select');
  const query = el('input');
  query.type = 'search';
  query.placeholder = '名前・スキル・属性など（空白で複数）';
  query.value = filter.query;
  const sort = el('select');
  for (const [key, label] of OWNED_SORTS) sort.append(option(key, label));
  const checkbox = (label, checked, key) => {
    const input = el('input');
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
  const talents = el('div', 'owned-talent-filter');
  for (const [key, label] of TALENT_FILTERS) {
    const input = el('input');
    input.type = 'number';
    input.min = '0';
    input.max = '100';
    input.step = '1';
    input.inputMode = 'numeric';
    input.placeholder = '0';
    if (filter.talent[key]) input.value = String(filter.talent[key]);
    input.setAttribute('aria-label', `${label}の個体値（以上）`);
    // 入力を間引き、確定（change）ですぐ絞る
    const apply = debounce(() => {
      filter.talent[key] = Math.max(0, Math.min(100, Math.trunc(Number(input.value)) || 0));
      renderResults();
    }, inputDelay);
    input.addEventListener('input', apply);
    input.addEventListener('change', () => apply.flush());
    const wrapper = el('label');
    wrapper.append(el('span', '', label), input);
    talents.append(wrapper);
  }
  const picker = palPicker({ label: 'パル', value: filter.palId, onChange: (id) => { filter.palId = id; renderResults(); } });
  const passiveSlot = el('div', 'owned-passive-slot');
  filters.append(field('所持者', holder), field('場所', place), picker.element, field('キーワード', query), field('並べ替え', sort),
    field('パル濃縮（★）', stars), group('個体値（以上）', talents), group('表示', toggles), passiveSlot);
  const count = el('p', 'result-note');
  const results = el('div', 'owned-list');
  element.append(summary, filters, count, results);

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
  onTextInput(query, (value) => { filter.query = value; renderResults(); }, { delay: inputDelay });

  function renderSummary(state) {
    const meta = state.meta;
    title.textContent = meta?.source ? `${worldName(meta)} · ${state.owned.pals.length} 体` : (meta ? worldName(meta) : '');
    title.hidden = !title.textContent;
    times.textContent = timeLines(state).join(' · ');
    times.hidden = !times.textContent;
    noticeList(ownedNotices(state), notices, noticeActions);
  }

  // 選択肢にない値は選ばない。読み込み前は選択肢がそろっていないため、選んでいた値は消さずに残す。
  function keepChoice(select, key, state) {
    const valid = [...select.children].some((node) => node.value === filter[key]);
    if (!valid && state.owned) filter[key] = '';
    select.value = valid ? filter[key] : '';
  }

  // 選択肢は、並びが前と同じなら作り直さない（開いている選択肢を閉じない）。違っても、選んでいる途中（フォーカス中）は待つ
  function renderFilters(state) {
    const list = state.owned?.pals ?? [];
    const holders = [['', 'すべて'], ...(state.owned?.players ?? []).map((player) => [`player:${player.uid}`, player.name]),
      ...(state.owned?.bases ?? []).map((base) => [`base:${base.id}`, base.label]),
      ...(filter.globals && list.some((pal) => pal.place === 'global') ? [['global', 'グローバルパルボックス']] : [])];
    syncOptions(holder, holders, () => keepChoice(holder, 'holder', state));
    const places = [['', 'すべて'], ...PLACE_ORDER
      .filter((group) => !((group === 'global' && !filter.globals) || (group === 'egg' && !filter.eggs)))
      .filter((group) => list.some((pal) => pal.placeGroup === group))
      .map((group) => [group, placeGroupLabel(group)])];
    syncOptions(place, places, () => keepChoice(place, 'place', state));
    sort.value = filter.sort;
  }

  // パッシブの選択欄は、選んだパッシブと所持数が同じなら作り直さない。データの更新では、選んでいる途中（フォーカス中）は待つ
  let shownPassives = '';
  function renderPassives(state, { force = false } = {}) {
    const counts = passiveCounts(state.owned?.pals ?? []);
    const signature = JSON.stringify([filter.passives, [...counts]]);
    if (signature === shownPassives) return;
    const draw = () => {
      shownPassives = signature;
      passiveSlot.replaceChildren(passiveSelector({
        label: 'パッシブ（すべて持つ個体）', selected: filter.passives, counts,
        onChange: (ids) => {
          filter.passives = ids;
          renderPassives(owned.state, { force: true });
          renderResults();
          // 作り直した選択欄にフォーカスを戻す（続けて選べるように）
          passiveSlot.querySelector('.passive-add')?.focus();
        },
      }));
    };
    if (force) draw();
    else renderWhenIdle(passiveSlot, () => renderPassives(owned.state, { force: true }));
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
    const job = ++jobSeq;
    fillBudget = FIRST_ROWS;
    const state = owned.state;
    if (!state.owned) {
      count.textContent = '';
      shownCount = 0;
      leaveVirtual();
      clearList(results);
      results.append(empty(state.ready ? '表示できる所持パルがありません。' : '読み込み中…'));
      return;
    }
    const list = sortOwned(filterOwned(state.owned.pals, filter), filter.sort);
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
      virtual.render(list);
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
    let shown = FIRST_ROWS;
    let step = 100;
    syncList(results, list.slice(0, shown), rowOptions);
    let anchored = restoreAnchor(results, anchor);
    const tick = () => {
      if (job !== jobSeq || destroyed) return;
      const start = clock();
      shown = Math.min(list.length, shown + step);
      syncList(results, list.slice(0, shown), rowOptions);
      if (!anchored) anchored = restoreAnchor(results, anchor);
      const spent = clock() - start;
      step = Math.max(STEP_MIN, Math.min(STEP_MAX, Math.round(spent > 0 ? step * (SLICE_MS * 0.75) / spent : STEP_MAX)));
      if (shown < list.length) nextFrame(tick);
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
  function update(state) {
    renderSummary(state);
    if (state.owned !== renderedOwned) {
      renderedOwned = state.owned;
      renderFilters(state);
      renderPassives(state);
      renderResults({ keepPosition: true });
      warmKeywords(state.owned);
    }
  }

  const unsubscribe = owned.subscribe(update);
  renderedOwned = owned.state.owned;
  renderSummary(owned.state);
  renderFilters(owned.state);
  renderPassives(owned.state);
  renderResults();
  warmKeywords(owned.state.owned);
  owned.load().then(() => owned.autoRefresh()).catch(() => {});
  return {
    element, update,
    // 同じ画面のまま絞り込みつきの URL が来たとき。作り直さずに、絞り込みと選択欄・一覧を合わせる（キーワードなどの入力は残す）
    applyRoute(next) {
      if (!readRoute(next)) return;
      syncPicker(picker, filter.palId);
      renderFilters(owned.state);
      renderPassives(owned.state, { force: true });
      renderResults();
    },
    destroy() {
      destroyed = true;
      jobSeq++;
      warmSeq++;
      unsubscribe();
      picker.destroy();
      leaveVirtual();
      clearList(results);
    },
  };
}
