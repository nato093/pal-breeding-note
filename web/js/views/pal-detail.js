// パル 1 種の詳細（全画面のパル詳細のページと、右のドロワーで共通。pal-detail）。その種族について知りたいこと（英名・パートナースキル・
// 所持・登録済みの配合）と、次にすること（継承ルート・理想個体・目標・登録）の入口。配合の件数とカードは登録済みの記録を数えるだけ（INV-2）
import { el, link, empty, syncList, clearList, loadingState } from '../ui/dom.js';
import { palsById, palIcon, elementChips, genderMark } from '../ui/pal-icon.js';
import { palPicker } from '../ui/pal-picker.js';
import { goalToggle } from '../ui/goal-toggle.js';
import { navIcon } from '../ui/nav-icons.js';
import { findByChild, findByParent } from '../core/index.js';
import { recordComparator } from '../core/record-sort.js';
import { ownedBySpecies, ownedCounts, sortOwned, PLACE_ORDER } from '../core/owned.js';
import { PARTNER_SKILLS, PARTNER_SKILL_DESCS } from '../../data/skills.js';
import { buildHash } from '../router.js';
import { dataPending, renderCards, palDataNotes, viewHeading } from './shared.js';
import { ownedRowItem, openDetailOnClick } from './owned.js';

/** 配合の節に出すカードの数（それより多ければ「すべて見る」で配合を探すへ。S-04） */
export const PAL_RECORDS_SHOWN = 3;
/** 所持個体の折りたたみに出す数（パッシブのランクが高い順。S-08） */
export const PAL_OWNED_SHOWN = 5;
// パートナースキルの説明を畳む長さ（ドロワーの幅で 2 行を超える目安）
const PARTNER_DESC_FOLD = 64;

// 所持パルのデータごとに 1 回だけ数える（種族ごとの個体と、所持数・親になれる数）
const statsCache = new WeakMap();
function statsOf(pals) {
  let stats = statsCache.get(pals);
  if (!stats) statsCache.set(pals, stats = { bySpecies: ownedBySpecies(pals), counts: ownedCounts(pals) });
  return stats;
}

// 行き先のボタン（リンク。navIcon を 16px で添える）
function actionLink(text, href, view, className = 'button secondary small') {
  const node = link('', href, `${className} pal-action`);
  node.append(navIcon(view), el('span', '', text));
  return node;
}

/**
 * @param {object} context app.js の context（store・owned・ideals・drafts・register・drawer）
 * @param {string} palId マスターの ID
 * @param {{ mode?: 'page'|'drawer', onSwitch?: (palId: string) => void }} [options]
 *   page は見出し（h1）とパル切り替えを持つページ、drawer は見出しをドロワーの h2 に任せる中身（節の見出しは h3）
 * @returns {{ element: HTMLElement, title: string, registerInitial(): object, destroy(): void } | null} 不正な ID は null
 */
export function palDetail(context, palId, { mode = 'page', onSwitch } = {}) {
  const pal = palsById.get(palId);
  if (!pal) return null;
  const drawer = mode === 'drawer';
  const title = `No.${pal.label} ${pal.ja}`;
  const sectionTag = drawer ? 'h3' : 'h2';
  const element = el('div', `pal-detail ${drawer ? 'is-drawer' : 'is-page'}`);
  const subscriptions = [];

  // 見出しとパル切り替え（S-10・S-11）。切り替えの候補は「データあり（登録か所持がある種族）」→「その他」の 2 群（F077）
  const picker = palPicker({
    label: 'パルを切り替え', value: pal.id, placeholder: 'パルを切り替え', popupHost: globalThis.document?.body,
    describe: () => palDataNotes(context.store?.state?.index, context.owned?.state?.owned),
    onChange: (id) => {
      if (!id || id === pal.id) { picker.setValue(pal.id); return; }
      if (onSwitch) onSwitch(id);
      else context.navigate(buildHash('pal', {}, id));
    },
  });
  picker.element.classList.add('pal-switch');
  if (drawer) element.append(picker.element);
  else {
    const heading = viewHeading(title);
    heading.classList.add('pal-detail-heading');
    heading.append(picker.element);
    element.append(heading);
  }

  // ヒーロー（2 列。左に絵と属性、右に英名・パートナースキル・所持の 1 行）。地は第 1 属性の色の淡いグラデーション（S-06・S-10）
  const hero = el('div', `pal-hero element-${pal.el?.[0] ?? 'Neutral'}`);
  const media = el('div', 'pal-hero-media');
  media.append(palIcon(pal, { large: true }), elementChips(pal));
  const info = el('div', 'pal-hero-info');
  info.append(el('p', 'pal-en', pal.en));
  const skill = PARTNER_SKILLS[pal.id];
  if (skill) {
    const partner = el('div', 'pal-partner');
    const name = el('p', 'pal-partner-name');
    name.append(el('span', 'pal-partner-label', 'パートナースキル'), el('strong', '', skill));
    partner.append(name);
    const desc = PARTNER_SKILL_DESCS[pal.id] ?? '';
    // 説明の「○」はゲームのデータの数値の穴（所持パルの注記と同じくそのまま出す）。長ければ畳む
    if (desc.length > PARTNER_DESC_FOLD) {
      const fold = el('details', 'pal-partner-more');
      fold.append(el('summary', '', `${desc.slice(0, PARTNER_DESC_FOLD - 4)}…`), el('p', 'pal-partner-desc', desc));
      partner.append(fold);
    } else if (desc) partner.append(el('p', 'pal-partner-desc', desc));
    info.append(partner);
  }
  // 所持の 1 行（所持パルのデータがある人だけ。O-41・F075）
  const ownedLine = el('p', 'pal-owned-line');
  ownedLine.hidden = true;
  info.append(ownedLine);
  hero.append(media, info);

  // 行き先のボタン（パル詳細のヒーローだけ。S-09・S-12・I-57）
  const actions = el('div', 'pal-hero-actions');
  const goal = goalToggle(context, pal.id, { className: 'button secondary small' });
  subscriptions.push(() => goal.destroy());
  const register = el('button', 'button primary small', 'この子の配合を登録');
  register.type = 'button';
  register.addEventListener('click', () => context.register?.({ childId: pal.id }));
  // ショートカット N でも同じ初期値で開く（app.js が registerInitial を読む。ドロワーでは本文の画面の初期値）
  register.title = drawer ? '' : 'キーボードの N でも開けます';
  if (!drawer) register.setAttribute('aria-keyshortcuts', 'N');
  actions.append(
    actionLink('ここから継承ルート', buildHash('route', { from: pal.id }), 'route'),
    actionLink('ここへの継承ルート', buildHash('route', { to: pal.id }), 'route'),
    actionLink('理想個体で親を探す', buildHash('ideal', { to: pal.id }), 'ideal'),
    goal.element, register,
  );

  // 所持個体の上位 5 体（既定で閉じる。開閉は所持パルの読み直しでも保つ）
  const ownedTop = el('details', 'pal-owned-top');
  ownedTop.hidden = true;
  const ownedSummary = el('summary', '', `所持個体（上位 ${PAL_OWNED_SHOWN} 体）`);
  const ownedRows = el('div', 'pal-owned-rows');
  ownedTop.append(ownedSummary, ownedRows);
  let topPals = [];
  // 行の Lv・★のボタン・セルを押すと、個体の詳細を同じドロワーで開く（ドロワーでは「←」でこのパルへ戻れる。owned-detail）
  openDetailOnClick(ownedRows, context.drawer);
  const rowOptions = {
    key: (row) => row.id,
    create: (row) => {
      const item = ownedRowItem(row, { detail: Boolean(context.drawer) });
      return { element: item.element, update: (next) => item.update(next), destroy: () => item.destroy() };
    },
  };
  // 行は開いている間だけ作る（閉じたら外す）
  const renderTop = () => {
    if (ownedTop.open) syncList(ownedRows, topPals, rowOptions);
    else clearList(ownedRows);
  };
  ownedTop.addEventListener('toggle', renderTop);

  // 配合の 2 節（件数と上位 3 件と「すべて見る」。S-04）
  const section = (heading, href, className) => {
    const box = el('section', `pal-records ${className}`);
    const head = el('div', 'pal-records-head');
    const name = el(sectionTag, 'section-title', heading);
    const more = link('すべて見る →', href, 'pal-records-more');
    more.hidden = true;
    head.append(name, more);
    const cards = el('div', 'card-stack');
    box.append(head, cards);
    return { box, name, more, cards };
  };
  const born = section('このパルが産まれる配合', buildHash('search', { c: pal.id }), 'is-child');
  const parent = section('このパルを親に使う配合（相手 → 子）', buildHash('search', { p1: pal.id }), 'is-parent');
  element.append(hero, actions, ownedTop, born.box, parent.box);

  function renderOwned() {
    const owned = context.owned;
    const data = owned?.state?.owned;
    if (!data || !Array.isArray(data.pals)) {
      ownedLine.hidden = true;
      ownedTop.hidden = true;
      topPals = [];
      clearList(ownedRows);
      return;
    }
    const stats = statsOf(data.pals);
    const entry = stats.counts.get(pal.id);
    ownedLine.hidden = false;
    const label = el('span', 'pal-owned-label', '所持');
    if (!entry?.total) {
      ownedLine.replaceChildren(label, el('span', 'pal-owned-none', '未所持'));
      ownedTop.hidden = true;
      topPals = [];
      clearList(ownedRows);
      return;
    }
    const extras = [entry.eggs ? `タマゴ ${entry.eggs}` : '', entry.globals ? `グローバル ${entry.globals}` : ''].filter(Boolean);
    const parts = [label, el('span', 'pal-owned-total', `${entry.total} 体${extras.length ? `（うち${extras.join('・')}）` : ''}`)];
    const parents = el('span', 'pal-owned-parents');
    parents.append(el('span', '', '親になれる '), genderMark('M', { inline: true }), el('span', '', `${entry.male} `),
      genderMark('F', { inline: true }), el('span', '', String(entry.female)));
    parents.title = '親になれる個体（タマゴ・グローバルパルボックス・性別の分からない個体は数えません）';
    // 所持パルはこの種族の全部の場所・全部の所持者で開く（数と同じ集まり）
    const go = link('所持パルで見る →', buildHash('owned', { pal: pal.id, place: PLACE_ORDER.join(',') }), 'pal-owned-link');
    ownedLine.replaceChildren(...parts, el('span', 'pal-owned-sep', '·'), parents, go);
    topPals = sortOwned(stats.bySpecies.get(pal.id) ?? [], 'passives').slice(0, PAL_OWNED_SHOWN);
    ownedSummary.textContent = `所持個体（上位 ${Math.min(PAL_OWNED_SHOWN, topPals.length)} 体${topPals.length < entry.total ? ` / ${entry.total} 体` : ''}）`;
    ownedTop.hidden = false;
    renderTop();
  }

  const newest = recordComparator('updated');
  function renderRecords(state) {
    if (dataPending(born.cards, state, () => context.store.refresh())) {
      parent.cards.replaceChildren(loadingState('登録済みの配合を読み込み中…'));
      born.more.hidden = true;
      parent.more.hidden = true;
      return;
    }
    const children = [...findByChild(state.index, pal.id)].sort(newest);
    const parents = [...findByParent(state.index, pal.id)].sort(newest);
    // 「この子の配合を登録」は、このパルが産まれる配合が 1 件でもあれば控えめ（secondary）、0 件なら primary（F075）
    register.className = `button small ${children.length ? 'secondary' : 'primary'}`;
    born.name.textContent = `このパルが産まれる配合 ${children.length} 件`;
    parent.name.textContent = `このパルを親に使う配合 ${parents.length} 件（相手 → 子）`;
    born.more.hidden = children.length <= PAL_RECORDS_SHOWN;
    parent.more.hidden = parents.length <= PAL_RECORDS_SHOWN;
    // ドロワー（幅 360〜480px）では 2 行の形のカード（式を幅いっぱいに）
    renderCards(born.cards, children.slice(0, PAL_RECORDS_SHOWN).map((record) => ({ record })), context, {
      empty: () => empty('まだ登録されていません。'), compact: drawer,
    });
    renderCards(parent.cards, parents.slice(0, PAL_RECORDS_SHOWN).map((record) => ({ record, focusParent: pal.id })), context, {
      empty: () => empty('まだ登録されていません。'), compact: drawer,
    });
  }

  // 記録（登録済みの配合）の購読。中身が同じ取得では描き直さない（views/shared.js の watchView と同じ比べ方）
  const store = context.store;
  if (store) {
    let last = null;
    const onStore = (state) => {
      const key = `${state.revision ?? ''}|${state.env ?? ''}|${state.error ?? ''}`;
      if (state.revision === undefined || key !== last) {
        last = key;
        renderRecords(state);
        picker.update();
      }
    };
    subscriptions.push(store.subscribe(onStore));
    onStore(store.state);
  }
  // 所持パルの購読（データが変わったときだけ所持の欄を差し替える）。直接開いたときにもデータが入るよう読み込む
  const owned = context.owned;
  if (owned) {
    let lastData;
    const onOwned = (state) => {
      if (state.owned === lastData) return;
      lastData = state.owned;
      renderOwned();
      picker.update();
    };
    subscriptions.push(owned.subscribe(onOwned));
    onOwned(owned.state);
    owned.load?.()?.catch?.(() => {});
  }

  return {
    element,
    title,
    registerInitial: () => ({ childId: pal.id }),
    destroy() {
      for (const unsubscribe of subscriptions.splice(0)) {
        try { unsubscribe?.(); } catch { /* 外せない購読は残っても描き直すだけ。 */ }
      }
      clearList(ownedRows);
      picker.destroy();
    },
  };
}
