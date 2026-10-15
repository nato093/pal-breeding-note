// 配合牧場ボード（farm-board。N-06・F049・F050）。全部の配合牧場（空き・片親・読めない牧場も）の親・タマゴの数と中身・預けた人を 1 か所で見る。
// 所持パルの帯（views/owned.js）と右のドロワーで同じものを使う。出すのはセーブの実物（親・タマゴの中身）と登録済みの配合の件数だけ（INV-2）。
// 牧場の親から子を求めて出さない（「→ 子」を書かない）。交換推奨は理想個体の画面にあるので出さない
import { el, button, link, syncList, clearList, statusChip } from './dom.js';
import { palsById, palIcon, genderMark } from './pal-icon.js';
import { passiveChip } from './passive-picker.js';
import { farmNames } from '../core/ideal-farms.js';
import { findByPair } from '../core/index.js';
import { eggName } from '../core/owned.js';
import { buildHash } from '../router.js';

/** カードに中身の絵を並べるタマゴの数（共有で送る数と同じ。残りは「ほか n 個」） */
export const FARM_EGGS_SHOWN = 20;
// 牧場のタマゴの上限（ゲームで確かめた値）。確かめるまでは「もうすぐいっぱい」のチップを出さない（N-08。2026-10-15 のユーザーの答え）
export const FARM_EGG_CAP = 0;

/**
 * 牧場の状態（チップの文と色）。読めない牧場・空き（親 0）・片親（1 体）・同性（同じ性別の 2 体）・配合中（♂♀）
 * @param {{ status?: string, parents: string[] }} farm
 * @param {Map<string, object>} byId 個体 ID → 個体
 */
export function farmState(farm, byId) {
  if (farm.status === 'uncertain') return { text: '読めませんでした', tone: 'error' };
  if (!farm.parents.length) return { text: '空き', tone: 'neutral' };
  if (farm.parents.length === 1) return { text: '片親', tone: 'warning' };
  const genders = farm.parents.map((id) => byId.get(id)?.gender ?? '');
  if (genders.every(Boolean) && genders[0] === genders[1]) return { text: '同性', tone: 'warning' };
  return { text: '配合中', tone: 'ready' };
}

/** 牧場の並び（拠点の並び → 同じ拠点の中は名前〔A／B〕の順）と名前 */
function orderedFarms(farms, bases) {
  const labels = new Map((bases ?? []).map((base) => [base.id, base.label]));
  const baseOrder = new Map((bases ?? []).map((base, index) => [base.id, index]));
  const names = farmNames(farms, (baseId) => labels.get(baseId) ?? '');
  const list = farms.map((farm, index) => ({ farm, name: names.get(farm.id) ?? '拠点の牧場', index }));
  list.sort((a, b) => (baseOrder.get(a.farm.baseId) ?? Infinity) - (baseOrder.get(b.farm.baseId) ?? Infinity)
    || (a.name < b.name ? -1 : a.name > b.name ? 1 : a.index - b.index));
  return list;
}

/**
 * @param {object} context app.js の context（owned・store・drawer）
 * @param {{ mode?: 'band'|'drawer' }} [options]
 * @returns {{ element: HTMLElement, title: string, update(): void, destroy(): void, summary(): { farms: number, eggs: number } | null }}
 */
export function farmBoard(context, { mode = 'drawer' } = {}) {
  const owned = context.owned;
  const element = el('div', `farm-board is-${mode}`);
  const note = el('p', 'farm-board-note');
  note.hidden = true;
  const cards = el('div', 'farm-cards');
  element.append(note, cards);

  // 個体（親・タマゴ）を押すと、その個体の詳細を同じドロワー（帯ならドロワー）で開く
  const openOwned = (id, opener) => context.drawer?.open({ kind: 'owned', id }, { opener });

  function parentNode(id, byId) {
    const pal = byId.get(id);
    if (!pal) {
      const missing = el('span', 'farm-parent is-missing', '見つからない個体');
      missing.title = '所持パルのデータにない個体です（読み込み直すと出ることがあります）';
      return missing;
    }
    const node = button('', null, 'farm-parent');
    node.addEventListener('click', () => openOwned(pal.id, node));
    const master = pal.known ? palsById.get(pal.palId) : null;
    const name = el('span', 'farm-parent-name');
    const mark = genderMark(pal.gender);
    if (mark) name.append(mark);
    name.append(el('strong', '', pal.name));
    const total = pal.talent.hp + pal.talent.shot + pal.talent.defense;
    const facts = el('small', 'farm-parent-facts', `Lv ${pal.level} · 個体値 計 ${total}`);
    const info = el('span', 'farm-parent-info');
    info.append(name, facts);
    if (pal.lastOwner) info.append(el('small', 'farm-parent-owner', `${pal.lastOwner} が預けた`));
    node.append(master ? palIcon(master) : el('span', 'pal-icon'), info);
    if (pal.passives.length) {
      const chips = el('span', 'farm-parent-passives');
      chips.append(...pal.passives.slice(0, 4).map((passive) => passiveChip(passive, { compact: true })));
      node.append(chips);
    }
    node.setAttribute('aria-label', `${pal.name}${pal.nickname ? `「${pal.nickname}」` : ''}の詳細（${farmParentLabel(pal)}）`);
    return node;
  }
  const farmParentLabel = (pal) => `${pal.gender === 'M' ? 'オス' : pal.gender === 'F' ? 'メス' : '性別不明'}・Lv ${pal.level}`;

  function eggsNode(farm, data, byId) {
    const box = el('div', 'farm-eggs');
    const head = el('p', 'farm-eggs-head');
    if (data.farmsCounted === false) {
      head.textContent = 'タマゴの情報なし（ホストの画面か、新しい共有で見られます）';
      box.append(head);
      return box;
    }
    head.textContent = `タマゴ ${farm.eggCount} 個`;
    if (FARM_EGG_CAP > 0 && farm.eggCount >= FARM_EGG_CAP - 2) head.append(statusChip(`もうすぐいっぱい（${farm.eggCount}/${FARM_EGG_CAP}）`, 'warning', 'farm-eggs-full'));
    box.append(head);
    if (!farm.eggs) {
      if (farm.eggCount) box.append(el('p', 'farm-eggs-note', '中身はホストの画面で見られます'));
      return box;
    }
    if (!farm.eggs.length) return box;
    const list = el('ul', 'farm-egg-list');
    for (const egg of farm.eggs.slice(0, FARM_EGGS_SHOWN)) {
      const master = palsById.get(egg.palId);
      const item = el('li', `farm-egg${egg.mutant ? ' is-mutant' : ''}`);
      const pal = byId.get(egg.id);
      const label = `${master?.ja ?? '中身の分からない'}のタマゴ${pal?.eggItemId && eggName(pal.eggItemId) ? `（${eggName(pal.eggItemId)}）` : ''}${egg.mutant ? '・突然変異' : ''}`;
      const icon = master ? palIcon(master) : el('span', 'pal-icon farm-egg-unknown', '?');
      if (pal) {
        const open = button('', null, 'farm-egg-open');
        open.append(icon);
        open.setAttribute('aria-label', `${label}の詳細`);
        open.title = label;
        open.addEventListener('click', () => openOwned(pal.id, open));
        item.append(open);
      } else {
        icon.setAttribute('role', 'img');
        icon.setAttribute('aria-label', label);
        icon.title = label;
        item.append(icon);
      }
      list.append(item);
    }
    box.append(list);
    const rest = farm.eggCount - Math.min(farm.eggs.length, FARM_EGGS_SHOWN);
    if (rest > 0) box.append(el('p', 'farm-eggs-note', `ほか ${rest} 個`));
    return box;
  }

  // その組の登録済みの配合の件数（記録の件数だけ。子の名前・予測は出さない）
  function recordsNode(farm, byId) {
    const parents = farm.parents.map((id) => byId.get(id)).filter((pal) => pal?.known);
    if (farm.status === 'uncertain' || parents.length !== 2) return null;
    const index = context.store?.state?.index;
    if (!index?.byPair) return null;
    const count = findByPair(index, parents[0].palId, parents[1].palId).length;
    const href = buildHash('search', { p1: parents[0].palId, p2: parents[1].palId });
    return link(count ? `この組の登録 ${count} 件を見る` : 'この組の登録はまだありません', href, 'farm-records');
  }

  function cardOf({ farm, name }, data, byId) {
    const card = el('article', 'farm-card');
    card.setAttribute('aria-label', name);
    const head = el('div', 'farm-card-head');
    const state = farmState(farm, byId);
    head.append(el('h3', 'farm-card-title', name), statusChip(state.text, state.tone, 'farm-state'));
    card.append(head);
    const parents = el('div', 'farm-parents');
    if (farm.status === 'uncertain' && !farm.parents.length) parents.append(el('p', 'farm-parents-note', '親を読めませんでした（読み込み直すと直ることがあります）'));
    else if (!farm.parents.length) parents.append(el('p', 'farm-parents-note', '親を置いていません'));
    else parents.append(...farm.parents.map((id) => parentNode(id, byId)));
    card.append(parents, eggsNode(farm, data, byId));
    const records = recordsNode(farm, byId);
    if (records) card.append(records);
    return card;
  }

  // カードの中身の署名（同じなら作り直さない。親・タマゴ・個体の値・記録の索引で変わる）
  const cardKey = ({ farm, name }, byId) => JSON.stringify([farm.id, name, farm.status, farm.parents.map((id) => {
    const pal = byId.get(id);
    return pal ? [pal.id, pal.gender, pal.level, pal.passives, pal.talent, pal.lastOwner, pal.nickname] : id;
  }), farm.eggs, farm.eggCount]);

  let lastData;
  let lastIndex;
  let summary = null;
  function update() {
    const data = owned?.state?.owned;
    const index = context.store?.state?.index;
    if (data === lastData && index === lastIndex) return;
    lastData = data;
    lastIndex = index;
    const farms = Array.isArray(data?.farms) ? data.farms : null;
    if (!farms) {
      summary = null;
      note.hidden = false;
      note.textContent = data ? 'このデータには配合牧場の情報がありません（牧場を読む前のセーブか、牧場を共有する前のデータです）。' : '所持パルのデータがありません。';
      clearList(cards);
      return;
    }
    summary = { farms: farms.length, eggs: data.farmsCounted === false ? null : farms.reduce((sum, farm) => sum + farm.eggCount, 0) };
    note.hidden = !data.farmsPartial;
    if (data.farmsPartial) note.textContent = '牧場の情報が一部です（共有の上限のため）。';
    const byId = new Map(data.pals.map((pal) => [pal.id, pal]));
    const list = orderedFarms(farms, data.bases);
    syncList(cards, list, {
      key: (item) => cardKey(item, byId),
      create: (item) => ({ element: cardOf(item, data, byId) }),
      empty: () => el('p', 'farm-board-empty', '配合牧場はまだありません。'),
    });
  }

  const unsubscribeOwned = owned?.subscribe?.(() => update()) ?? (() => {});
  const unsubscribeStore = context.store?.subscribe?.(() => update()) ?? (() => {});
  update();
  return {
    element,
    title: '配合牧場',
    update,
    summary: () => summary,
    destroy() {
      unsubscribeOwned();
      unsubscribeStore();
      clearList(cards);
    },
  };
}
