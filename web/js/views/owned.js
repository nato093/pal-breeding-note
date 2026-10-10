import { el, field, empty } from '../ui/dom.js';
import { palTile, humanIcon } from '../ui/pal-icon.js';
import { palPicker } from '../ui/pal-picker.js';
import { passiveList, passiveSelector } from '../ui/passive-picker.js';
import { worldName, timeLines, ownedNotices, noticeList } from '../ui/owned-status.js';
import { viewHeading } from './shared.js';
import { toast } from '../ui/toast.js';
import { buildHash } from '../router.js';
import { filterOwned, sortOwned, passiveCounts, keywordTerms, keywordNotes, OWNED_SORTS, PLACE_ORDER, placeGroupLabel } from '../core/owned.js';

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
export function ownedRow(pal, { notes = [] } = {}) {
  const row = el('article', 'owned-row');
  row.setAttribute('aria-label', `${pal.name}${pal.nickname ? `（${pal.nickname}）` : ''}`);
  const level = el('div', 'owned-level');
  level.append(el('strong', '', pal.egg ? '孵化前' : `Lv ${pal.level}`), el('small', 'owned-stars', pal.stars ? '★'.repeat(pal.stars) : '☆なし'));
  const where = el('div', 'owned-where');
  where.append(el('strong', '', pal.holder), el('small', 'muted', pal.placeLabel));
  if (pal.place === 'base' && pal.lastOwner) where.append(el('small', 'muted', `預けた人 ${pal.lastOwner}`));
  const passives = el('div', 'owned-passives');
  passives.append(pal.passives.length ? passiveList(pal.passives) : el('span', 'muted', 'パッシブなし'));
  for (const note of notes) {
    const line = el('p', 'owned-hit');
    line.append(el('span', 'owned-hit-name', `${note.label}：${note.name}`));
    if (note.desc) line.append(el('span', 'owned-hit-desc', note.desc));
    passives.append(line);
  }
  row.append(palCell(pal), level, passives, el('div', 'owned-talent', talentText(pal.talent)), where);
  return row;
}

export function ownedView(context, route) {
  const owned = context.owned;
  const element = el('section', 'view owned-view');
  element.append(viewHeading('所持パル'));
  // タブを切り替えて戻ってきても、前の絞り込みのまま出す（ページを読み込み直すと既定に戻る）。
  const memory = context.viewState?.('owned');
  const filter = memory?.filter ?? {
    holder: '', place: '', palId: '', passives: [], query: '', sort: 'dex', eggs: true, globals: false,
    stars: 0, talent: { hp: 0, shot: 0, defense: 0 },
  };
  if (memory) memory.filter = filter;
  // URL で指定された絞り込みは、覚えている絞り込みより優先する。
  if (['holder', 'place', 'pal', 'p'].some((key) => route.params.has(key))) {
    filter.holder = route.params.get('holder') ?? '';
    filter.place = route.params.get('place') ?? '';
    filter.palId = route.params.get('pal') ?? '';
    filter.passives = (route.params.get('p') ?? '').split(',').filter(Boolean).slice(0, 4);
    // 画面内で変えた絞り込みは URL に出ないため、戻ってきたときに古い URL の指定で上書きしないよう外しておく。
    if (memory) context.replace(buildHash('owned'));
  }

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
    input.addEventListener('input', () => {
      filter.talent[key] = Math.max(0, Math.min(100, Math.trunc(Number(input.value)) || 0));
     
      renderResults();
    });
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

  for (const [node, key] of [[holder, 'holder'], [place, 'place'], [sort, 'sort']]) {
    node.addEventListener('change', () => { filter[key] = node.value; renderResults(); });
  }
  query.addEventListener('input', () => { filter.query = query.value; renderResults(); });

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

  function renderFilters(state) {
    const list = state.owned?.pals ?? [];
    holder.replaceChildren(option('', 'すべて'));
    for (const player of state.owned?.players ?? []) holder.append(option(`player:${player.uid}`, player.name));
    for (const base of state.owned?.bases ?? []) holder.append(option(`base:${base.id}`, base.label));
    if (filter.globals && list.some((pal) => pal.place === 'global')) holder.append(option('global', 'グローバルパルボックス'));
    keepChoice(holder, 'holder', state);
    place.replaceChildren(option('', 'すべて'));
    for (const group of PLACE_ORDER) {
      if ((group === 'global' && !filter.globals) || (group === 'egg' && !filter.eggs)) continue;
      if (list.some((pal) => pal.placeGroup === group)) place.append(option(group, placeGroupLabel(group)));
    }
    keepChoice(place, 'place', state);
    sort.value = filter.sort;
  }

  function renderPassives(state) {
    passiveSlot.replaceChildren(passiveSelector({
      label: 'パッシブ（すべて持つ個体）', selected: filter.passives, counts: passiveCounts(state.owned?.pals ?? []),
      onChange: (ids) => {
        filter.passives = ids;
       
        renderPassives(owned.state);
        renderResults();
        // 作り直した選択欄にフォーカスを戻す（続けて選べるように）
        passiveSlot.querySelector('.passive-add')?.focus();
      },
    }));
  }

  function renderResults() {
    const state = owned.state;
    if (!state.owned) {
      count.textContent = '';
      results.replaceChildren(empty(state.ready ? '表示できる所持パルがありません。' : '読み込み中…'));
      return;
    }
    const list = sortOwned(filterOwned(state.owned.pals, filter), filter.sort);
    const terms = keywordTerms(filter.query);
    count.textContent = `${list.length} 体`;
    results.replaceChildren();
    if (!list.length) results.append(empty('条件に合うパルはいません。'));
    // 件数が多くても、最初からすべて出す
    for (const pal of list) results.append(ownedRow(pal, { notes: terms.length ? keywordNotes(pal, terms) : [] }));
  }

  let renderedOwned;
  function update(state) {
    renderSummary(state);
    if (state.owned !== renderedOwned) {
      renderedOwned = state.owned;
      renderFilters(state);
      renderPassives(state);
      renderResults();
    }
  }

  const unsubscribe = owned.subscribe(update);
  renderedOwned = owned.state.owned;
  renderSummary(owned.state);
  renderFilters(owned.state);
  renderPassives(owned.state);
  renderResults();
  owned.load().then(() => owned.autoRefresh()).catch(() => {});
  return { element, destroy() { unsubscribe(); picker.destroy(); } };
}
