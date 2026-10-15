import { el, button, empty, field, syncList, clearList, onTextInput, trackHeight, setDisabled } from '../ui/dom.js';
import { palPicker } from '../ui/pal-picker.js';
import { palIcon, palsById } from '../ui/pal-icon.js';
import { searchSelect } from '../ui/search-select.js';
import { breedingCard } from '../ui/breeding-card.js';
import { ownedBadge, ownedBadgeText } from '../ui/owned-badge.js';
import { draftsBand } from '../ui/drafts-band.js';
import { goalToggle } from '../ui/goal-toggle.js';
import { withTransition } from '../ui/motion.js';
import { queryTerms } from '../core/kana.js';
import { userIdKey } from '../core/user.js';
import { ownedCounts, canPairRecord } from '../core/owned.js';
import {
  RECORD_SORTS, RECORD_SORT_DEFAULT, recordSort, searchBase, byRegistrant, registrantCounts, groupRecords, childCounts, pairNote,
} from '../core/record-search.js';
import { buildHash } from '../router.js';
import { viewHeading, validId, changeRoute, watchView, dataPending, syncPicker, recordCountNotes, cardKey, panelItem, panelLine, syncOptions, renderWhenIdle } from './shared.js';
import { tabLabel } from './tabs.js';

// 並べ替えの動き（View Transition）を使う行の数の上限（多いとスナップショットが重い）
const TRANSITION_MAX = 2000;
// 親を 1 体だけ選んだとき、子ごとの要約のチップを出す結果の数（S-38）
const CHILD_CHIPS_MIN = 6;
// 登録者の選択の値（URL は by=<ID> か noreg=1）
const NO_REGISTRANT = 'noreg';
const byValue = (name) => `by:${name}`;

/**
 * 配合を探す（D1。前の配合検索・逆引き・一覧を 1 画面に）。条件帯（sticky）[親1][親2][子][キーワード] と [登録者][並べ替え] … [件数]。
 * URL: p1・p2・c（パル ID）、by（登録者の ID）、noreg=1（登録者未指定）、sort（既定の updated は書かない）、q（キーワード）、
 * ownedfirst=1（両親を所持している組を上へ）・make=1（今の所持で作れる。どちらも所持パルのデータがあるときだけ効く）、
 * drafts=1（下書きの帯を開く。全件表示のときだけ出す。register-entry）。
 * 登録の入口（D2）: 見出しの右に、今の条件に合う登録のボタンを 1 つ（全件表示は「＋ 配合を登録」、親・子を選んで結果があれば
 * 「この組み合わせで別の結果を登録」など。0 件のときは空の状態のボタンだけ）。
 * 何も選ばなければ全件（既定は更新日の新しい順。D6）。引くのは登録済みの記録だけ（INV-2。core/record-search.js）。
 * 所持パルのデータがあれば、カードの親に「♂n ♀m／未所持」、子に「所持 N」を重ねる（owned-overlay。core/owned.js の ownedCounts）
 */
export function searchView(context, route) {
  const element = el('section', 'view find-view');
  const heading = viewHeading(tabLabel('search'));
  const headingActions = el('div', 'view-heading-actions');
  const contextButton = button('', () => context.register(registerInitial()), 'button secondary small find-register');
  contextButton.hidden = true;
  headingActions.append(contextButton);
  heading.append(headingActions);
  element.append(heading);
  let current = route;
  const cond = { p1: '', p2: '', c: '', by: '', noreg: false, sort: RECORD_SORT_DEFAULT, q: '', ownedFirst: false, make: false, drafts: false };
  // URL から読む条件（作るときと、同じ画面のまま URL が変わったとき）
  function readRoute(next) {
    current = next;
    cond.p1 = validId(next, 'p1', context);
    cond.p2 = validId(next, 'p2', context);
    cond.c = validId(next, 'c', context);
    cond.by = (next.params.get('by') ?? '').trim();
    cond.noreg = !cond.by && next.params.get('noreg') === '1';
    cond.sort = recordSort(next.params.get('sort'));
    cond.q = next.params.get('q') ?? '';
    cond.ownedFirst = next.params.get('ownedfirst') === '1';
    cond.make = next.params.get('make') === '1';
    cond.drafts = next.params.get('drafts') === '1';
  }
  readRoute(route);
  // 今の URL の条件を changes で変えたハッシュ（ほかのパラメータは残す。空の値は消す）
  function hashWith(changes) {
    const params = new URLSearchParams(current.params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    return buildHash('search', params);
  }
  const hasFilter = () => Boolean(cond.by || cond.noreg || queryTerms(cond.q).length);
  const hasPal = () => Boolean(cond.p1 || cond.p2 || cond.c);

  // ---- 条件帯（sticky。高さは画面の section の --panel-h に書き続ける〔結果の先頭の scroll-margin-top が使う〕）----
  // 1 段目 [親1] ＋ [親2] → [子] [キーワード]（見出しは入力の上）、2 段目 [登録者][並べ替え] … [件数]（見出しは入力の左）
  const describeParent = () => (context.store.state.env ? recordCountNotes(context.store.state.index, 'parent') : {});
  const describeChild = () => (context.store.state.env ? recordCountNotes(context.store.state.index, 'child') : {});
  const pickers = [['p1', '親1', describeParent], ['p2', '親2', describeParent], ['c', '子', describeChild]].map(([key, label, describe]) => palPicker({
    label, value: cond[key], describe, onChange: (id) => changeRoute(context, hashWith({ [key]: id })),
  }));
  const keyword = el('input');
  keyword.type = 'search';
  keyword.placeholder = 'パル名・メモ・登録者（空白で複数）';
  keyword.autocomplete = 'off';
  keyword.value = cond.q;
  const keywordField = field('キーワード', keyword);
  keywordField.classList.add('find-keyword');
  const symbol = (text, className = '') => {
    const node = el('span', `find-symbol ${className}`.trim(), text);
    node.setAttribute('aria-hidden', 'true');
    return node;
  };
  const panelMain = el('div', 'find-bar-main');
  panelMain.append(pickers[0].element, symbol('＋'), pickers[1].element, symbol('→', 'arrow'), pickers[2].element, keywordField);

  const registrant = searchSelect({ label: '登録者', options: [['', 'すべて']], value: '', onChange: chooseRegistrant });
  const sort = el('select');
  sort.setAttribute('aria-label', '並べ替え');
  syncOptions(sort, RECORD_SORTS.map(([key, label]) => [key, label]));
  sort.value = cond.sort;
  // 件数の行（帯の 2 段目の右端）: 「N 件」と添え書き・新着
  const count = el('p', 'result-note find-count');
  count.setAttribute('aria-live', 'polite');
  const countText = el('span', 'find-count-text');
  const countNote = el('span', 'find-count-note');
  const newButton = button('', () => chooseSort(RECORD_SORT_DEFAULT), 'chip-button find-new');
  newButton.hidden = true;
  count.append(countText, countNote, newButton);
  // 所持の切り替え（所持パルのデータがあるときだけ出す。押しボタン aria-pressed）: 両親を所持している組を上へ（F014・S-16）・
  // 今の所持で作れる（両親を組めて、子をまだ持っていない記録だけ。D-44）
  const toggle = (text, key, title) => {
    // 見た目は所持パルの場所のチップと同じ「押して切り替えるチップ」（オンは地の色と ✓）
    const node = button(text, () => changeRoute(context, hashWith({ [key]: current.params.get(key) === '1' ? '' : '1' })), 'place-chip find-toggle');
    node.title = title;
    node.setAttribute('aria-pressed', 'false');
    return node;
  };
  const ownedFirstToggle = toggle('両親を持つ組を上へ', 'ownedfirst', '今の所持パルで両親を ♂ と ♀ で組める配合を、並びの中で先に出します');
  const makeToggle = toggle('今の所持で作れる', 'make', '今の所持パルで両親を ♂ と ♀ で組めて、子をまだ持っていない配合だけを出します');
  const toggles = el('div', 'find-toggles');
  toggles.setAttribute('role', 'group');
  toggles.setAttribute('aria-label', '所持');
  toggles.append(ownedFirstToggle, makeToggle);
  const ownedItem = panelItem('所持', toggles, { hidden: true, className: 'find-owned' });
  ownedItem.hidden = true;
  const panelSub = el('div', 'find-bar-sub');
  panelSub.append(panelLine(
    panelItem('登録者', registrant.element, { hidden: true, className: 'find-registrant' }),
    panelItem('並べ替え', sort, { tag: 'label', hidden: true, className: 'find-sort' }),
    ownedItem,
  ), count);
  const panel = el('section', 'find-bar');
  panel.setAttribute('aria-label', '配合の条件');
  panel.append(panelMain, panelSub);

  // 子ごとの要約のチップ（親を 1 体だけ選んで結果が多いとき。押すと子で絞る・もう一度で外す）
  const childChips = el('div', 'find-child-chips');
  childChips.setAttribute('role', 'group');
  childChips.setAttribute('aria-label', '子で絞る');
  childChips.hidden = true;
  const results = el('div', 'find-results');
  // 下書きの帯（全件表示のときだけ。開閉は URL の drafts=1 で、履歴は増やさない）
  const bandSlot = el('div', 'find-drafts');
  let band = null;
  element.append(panel, bandSlot, childChips, results);
  const stopTracking = trackHeight(panel, element);

  // ---- 条件の変更 ----
  function chooseRegistrant(value) {
    if (value === NO_REGISTRANT) changeRoute(context, hashWith({ by: '', noreg: '1' }));
    else if (value.startsWith('by:')) changeRoute(context, hashWith({ by: value.slice(3), noreg: '' }));
    else changeRoute(context, hashWith({ by: '', noreg: '' }));
  }
  // 並べ替えは行の順番が変わるので動きを付ける（行が多いときは付けない）。変えたら結果の始まりが見える位置へ
  function chooseSort(value) {
    const next = recordSort(value);
    if (next === cond.sort) return;
    const apply = () => {
      changeRoute(context, hashWith({ sort: next === RECORD_SORT_DEFAULT ? '' : next }));
      revealResults();
    };
    if (shownRows > TRANSITION_MAX) apply();
    else withTransition(apply);
  }
  sort.addEventListener('change', () => chooseSort(sort.value));
  // キーワードは入力を間引き、日本語の変換中は絞らない。1 文字ごとに履歴を積まない（replace）
  const inputs = new AbortController();
  const typed = onTextInput(keyword, (value) => {
    changeRoute(context, hashWith({ q: value.trim() ? value : '' }), { replace: true });
  }, { delay: context.inputDelay ?? 150, signal: inputs.signal });
  // 「条件をすべて解除」: 親・子・登録者・キーワード・今の所持で作れるを外す（並べ替えと「両親を持つ組を上へ」は残す）。
  // 押したボタンは消えるので、フォーカスはキーワードへ
  function clearAll() {
    typed.cancel();
    keyword.value = '';
    changeRoute(context, hashWith({ p1: '', p2: '', c: '', by: '', noreg: '', q: '', make: '' }));
    keyword.focus();
  }

  // 結果の先頭が条件帯の下に隠れているときだけ、そこまで戻す（scroll-margin-top で帯の下に出す）。データの更新では動かさない
  let destroyed = false;
  function revealResults() {
    const run = () => {
      if (destroyed) return;
      const top = results.getBoundingClientRect?.().top;
      const bottom = panel.getBoundingClientRect?.().bottom;
      if (!Number.isFinite(top) || !Number.isFinite(bottom) || top >= bottom - 1) return;
      stopTracking.measure?.();
      results.scrollIntoView?.({ block: 'start' });
    };
    if (typeof globalThis.requestAnimationFrame === 'function') globalThis.requestAnimationFrame(run);
    else run();
  }

  // ---- 新着（G-29）: 他人の登録で、前にこの画面を離れた時刻より後に作られたもの。基準は開いて最初にデータがあるときに読む ----
  let seenAt;
  let seenScope = null;
  function readSeen(state) {
    if (seenAt !== undefined || !state.env || !state.userId || !context.seen) return;
    seenScope = { env: state.env, userId: state.userId };
    seenAt = context.seen.read(state.env, state.userId);
    // 初めて開いたとき（値がない）は全部を新着にせず、今の時刻を書くだけ
    if (!seenAt) context.seen.write(state.env, state.userId, state.serverTime || undefined);
  }
  const seenTime = () => (seenAt ? Date.parse(seenAt) : NaN);
  function isNew(record, me) {
    const since = seenTime();
    if (!Number.isFinite(since) || !record.createdAt) return false;
    if (record.registrant && userIdKey(record.registrant) === me) return false;
    return Date.parse(record.createdAt) > since;
  }

  // ---- 所持パル（データが変わったときだけ数え直す。所持パルのデータが無ければ何も重ねない） ----
  const owned = context.owned;
  let countsFor = null;
  let counts = null;
  function ownedNow() {
    const data = owned?.state?.owned ?? null;
    if (data !== countsFor) {
      countsFor = data;
      counts = Array.isArray(data?.pals) ? ownedCounts(data.pals) : null;
    }
    return counts;
  }
  const badgeOf = (palId, role) => ownedBadge(counts, palId, { role });
  // カードの key に入れる所持の印の文（所持の数が変わったカードだけ作り直す）
  const ownedSig = (record) => (counts ? [record.parent1Id, record.parent2Id].map((id) => ownedBadgeText(counts, id)).join(',') + `>${ownedBadgeText(counts, record.childId, 'child')}` : '');

  // ---- 描画 ----
  let shownRows = 0;
  // 表示中に増えた配合（記録の ID）を一瞬光らせる（V-25）。最初の描画と条件の変更では光らせない
  let shownIds = null;
  let shownCond = '';
  let flash = false;
  const headingKey = (palId, by) => `heading:${by}:${palId}`;
  function createRow(item) {
    if (item.heading) return { element: groupHeading(item) };
    const card = breedingCard(item.record, context, {
      focusParent: item.focusParent ?? '', leftParent: item.leftParent ?? '', omitChild: item.omitChild, compact: true, isNew: item.isNew,
      annotate: counts ? badgeOf : null,
    });
    if (flash && shownIds && !shownIds.has(item.record.id)) card.classList.add('is-new');
    return { element: card };
  }
  function groupHeading({ palId, count: total }) {
    const node = el('div', 'find-group-heading');
    node.setAttribute('role', 'heading');
    node.setAttribute('aria-level', '2');
    const pal = palsById.get(palId);
    if (pal) node.append(palIcon(pal));
    node.append(el('span', 'find-group-name', pal ? `No.${pal.label} ${pal.ja}` : palId), el('span', 'find-group-count', `${total} 件`));
    return node;
  }
  // カードは子を省く（omitChild）かもキーに入れる（並べ替えで群の分け方が変わったとき、子を省いたままのカードを使い回さない）
  const rowKey = (item) => (item.heading ? `${headingKey(item.palId, item.by)}:${item.count}` : `${cardKey(item)}|${item.omitChild ? 'o' : ''}|${item.owned ?? ''}`);

  function update(state) {
    if (destroyed) return;
    for (const picker of pickers) picker.update();
    renderBand();
    if (dataPending(results, state, () => context.store.refresh())) {
      contextButton.hidden = true;
      shownRows = 0;
      shownIds = null;
      showCount(null);
      childChips.hidden = true;
      return;
    }
    readSeen(state);
    const ownedCount = ownedNow();
    renderToggles(ownedCount);
    const terms = queryTerms(cond.q);
    const filter = { p1: cond.p1, p2: cond.p2, c: cond.c, terms };
    const base = searchBase(state.index, state.records, filter, palsById);
    let records = byRegistrant(base, { by: cond.by, noRegistrant: cond.noreg });
    // 今の所持で作れる: 両親を ♂ と ♀ で組めて、子をまだ持っていない記録だけ
    if (ownedCount && cond.make) records = records.filter((record) => canPairRecord(ownedCount, record) && !ownedCount.get(record.childId)?.total);
    renderRegistrants(base, state);
    renderChildChips(state, terms);
    const me = state.userId ? userIdKey(state.userId) : '';
    const newCount = records.reduce((total, record) => total + (isNew(record, me) ? 1 : 0), 0);
    showCount({ total: records.length, note: cond.p1 && cond.p2 ? pairNote(records) : '', newCount });
    renderContext(records.length);
    const single = cond.p1 && cond.p2 ? '' : cond.p1 || cond.p2;
    const groups = groupRecords(records, cond.sort, state.index.palOrder, palsById, { focusParent: single });
    // 両親を所持している組を上へ: 群の中で、組める記録を安定に先へ（同じ側の中は今の並びのまま）
    if (ownedCount && cond.ownedFirst) {
      for (const group of groups) {
        const pairable = group.records.filter((record) => canPairRecord(ownedCount, record));
        if (pairable.length && pairable.length < group.records.length) group.records = [...pairable, ...group.records.filter((record) => !canPairRecord(ownedCount, record))];
      }
    }
    const byParent = cond.sort.startsWith('parent');
    const items = [];
    for (const group of groups) {
      if (group.palId) items.push({ heading: true, palId: group.palId, by: byParent ? 'parent' : 'child', count: group.records.length });
      for (const record of group.records) {
        const extra = { isNew: isNew(record, me), owned: ownedSig(record) };
        if (!group.palId) items.push({ record, leftParent: cond.p1 || (record.parent1Id === cond.p2 ? record.parent2Id : record.parent1Id), ...extra });
        else if (byParent) items.push({ record, focusParent: group.palId, ...extra });
        else items.push({ record, leftParent: cond.p1 || cond.p2 || '', omitChild: true, ...extra });
      }
    }
    const condKey = JSON.stringify(cond);
    flash = shownIds !== null && condKey === shownCond;
    syncList(results, items, { key: rowKey, create: createRow, empty: () => emptyNode(state) });
    keepEmptyGoal();
    results.classList.toggle('is-grouped', groups.some((group) => group.palId));
    flash = false;
    shownCond = condKey;
    shownIds = new Set(records.map((record) => record.id));
    shownRows = records.length;
  }

  // 今の条件の登録の初期値（親 2 体 → その組、親 1 体 → 親1 に、子だけ → 子に。親と子を選んでいれば子も）
  function registerInitial() {
    const parent = cond.p1 || cond.p2;
    if (cond.p1 && cond.p2) return { parent1Id: cond.p1, parent2Id: cond.p2, ...(cond.c ? { childId: cond.c } : {}) };
    if (parent) return { parent1Id: parent, ...(cond.c ? { childId: cond.c } : {}) };
    return cond.c ? { childId: cond.c } : {};
  }
  // 見出しの右の登録のボタン（どの時点でも 1 つ）。結果が 0 件のときは空の状態の登録のボタンだけにする（ここは隠す）
  function renderContext(total) {
    const pal = hasPal();
    const text = !pal ? '＋ 配合を登録' : cond.p1 && cond.p2 ? 'この組み合わせで別の結果を登録' : cond.p1 || cond.p2 ? 'この親で配合を登録' : 'この子の配合を登録';
    if (contextButton.textContent !== text) contextButton.textContent = text;
    contextButton.hidden = pal && !total;
  }
  // 下書きの帯は全件表示（親・子を選んでいない）のときだけ。ログインしていなければ出さない（下書きは ID ごと）
  function renderBand() {
    const show = !hasPal() && Boolean(context.drafts);
    if (!show) {
      if (band) {
        band.destroy();
        band = null;
        bandSlot.replaceChildren();
      }
      return;
    }
    if (!band) {
      band = draftsBand(context, { open: cond.drafts, onToggle: (open) => changeRoute(context, hashWith({ drafts: open ? '1' : '' }), { replace: true }) });
      bandSlot.append(band.element);
    } else band.update({ open: cond.drafts });
  }

  // 所持の切り替えは、所持パルのデータがあるときだけ出す（URL の値は残す）
  function renderToggles(ownedCount) {
    ownedItem.hidden = !ownedCount;
    ownedFirstToggle.setAttribute('aria-pressed', String(cond.ownedFirst));
    makeToggle.setAttribute('aria-pressed', String(cond.make));
  }

  function showCount(info) {
    if (!info) {
      countText.textContent = '';
      countNote.textContent = '';
      newButton.hidden = true;
      return;
    }
    countText.textContent = `${info.total} 件`;
    countNote.textContent = info.note === 'gender' ? ' · 親の性別で子が変わります' : info.note === 'multi' ? ' · 同じ組み合わせで結果が複数あります' : '';
    newButton.hidden = !info.newCount;
    newButton.textContent = info.newCount ? `新着 ${info.newCount} 件` : '';
    // 更新日の新しい順なら新着は上に並んでいるので、押しても変わらない（理由は title）
    setDisabled(newButton, cond.sort === RECORD_SORT_DEFAULT, '更新日の新しい順で、新着は上に並んでいます', { focusable: true });
    if (cond.sort !== RECORD_SORT_DEFAULT) newButton.title = '更新日の新しい順に並べ替えます';
  }

  // 登録者の選択肢（親・子・キーワードで絞った中の件数）。URL の登録者が記録にいなければ 0 件で足す（選んだ値を見失わない）
  function renderRegistrants(base, state) {
    const counts = registrantCounts(base, { users: state.users ?? [], me: state.userId ?? '' });
    const options = counts.map(({ value, label, count: total, kind }) => [
      kind === 'none' ? NO_REGISTRANT : value ? byValue(value) : '', `${label} · ${total} 件`,
    ]);
    let value = '';
    if (cond.noreg) {
      value = NO_REGISTRANT;
      if (!options.some(([key]) => key === NO_REGISTRANT)) options.push([NO_REGISTRANT, '登録者未指定 · 0 件']);
    } else if (cond.by) {
      const key = userIdKey(cond.by);
      const found = counts.find((item) => item.value && item.kind !== 'none' && userIdKey(item.value) === key);
      value = byValue(found ? found.value : cond.by);
      if (!found) options.push([value, `${cond.by} · 0 件`]);
    }
    // 選択肢を開いている間（データの更新で件数が変わったときなど）は作り直さず、離れた後に合わせる
    renderWhenIdle(registrant.element, () => registrant.update({ options, value }));
  }

  function renderChildChips(state, terms) {
    const parent = cond.p1 && cond.p2 ? '' : cond.p1 || cond.p2;
    const source = parent ? byRegistrant(searchBase(state.index, state.records, { p1: parent, terms }, palsById), { by: cond.by, noRegistrant: cond.noreg }) : [];
    const show = source.length >= CHILD_CHIPS_MIN;
    childChips.hidden = !show;
    if (!show) {
      clearList(childChips);
      return;
    }
    syncList(childChips, childCounts(source, state.index.palOrder), {
      key: ({ childId, count: total }) => `${childId}:${total}`,
      create: ({ childId, count: total }) => {
        const pal = palsById.get(childId);
        const chip = button('', () => changeRoute(context, hashWith({ c: cond.c === childId ? '' : childId })), 'find-child-chip');
        if (pal) chip.append(palIcon(pal));
        chip.append(el('span', '', pal?.ja ?? childId), el('span', 'find-child-count', String(total)));
        chip.setAttribute('data-child', childId);
        chip.setAttribute('data-focus', 'chip');
        return { element: chip, update: () => {} };
      },
    });
    for (const chip of childChips.children) {
      const pressed = chip.getAttribute('data-child') === cond.c;
      chip.setAttribute('aria-pressed', String(pressed));
    }
  }

  // 空の状態（押したときの値は今の条件を読む。syncList は同じ文の空の表示を作り直さない）
  let emptyGoal = null;
  let pendingGoal = null;
  // 空の表示の「目標に登録」: 出ている方を残し、出ていない方（作ったが使われなかった・前の表示）は購読を外す
  function keepEmptyGoal() {
    const shown = (toggle) => Boolean(toggle) && results.contains?.(toggle.element);
    if (pendingGoal && shown(pendingGoal)) {
      if (emptyGoal !== pendingGoal) emptyGoal?.destroy();
      emptyGoal = pendingGoal;
    } else pendingGoal?.destroy();
    pendingGoal = null;
    if (emptyGoal && !shown(emptyGoal)) {
      emptyGoal.destroy();
      emptyGoal = null;
    }
  }
  function emptyNode(state) {
    const register = (label, initial) => button(label, () => context.register(initial()), 'button primary');
    if (!state.records.length) return empty('まだ配合が登録されていません。', register('配合を登録', () => ({})), { icon: 'search' });
    // 登録者・キーワードを外せば結果がある（または条件がそれだけ）なら、条件を外す案内
    const palOnly = hasPal() ? searchBase(state.index, state.records, { p1: cond.p1, p2: cond.p2, c: cond.c }, palsById) : state.records;
    if (hasFilter() && palOnly.length) return empty('条件に合う登録はありません。', button('条件をすべて解除', clearAll, 'button secondary'), { icon: 'search' });
    if (counts && cond.make && palOnly.length) {
      return empty('今の所持パルで作れる配合はありません。', button('「今の所持で作れる」を外す', () => changeRoute(context, hashWith({ make: '' })), 'button secondary'), { icon: 'search' });
    }
    if (cond.p1 && cond.p2) {
      return empty('この組み合わせはまだ登録されていません。', register('この組み合わせを登録', () => ({ parent1Id: cond.p1, parent2Id: cond.p2, ...(cond.c ? { childId: cond.c } : {}) })));
    }
    if (cond.p1 || cond.p2) {
      if (cond.c) return empty('この親からこの子が産まれる配合はまだ登録されていません。', register('この親と子で配合を登録', () => ({ parent1Id: cond.p1 || cond.p2, childId: cond.c })));
      return empty('この親を使う配合はまだ登録されていません。', register('この親で配合を登録', () => ({ parent1Id: cond.p1 || cond.p2 })));
    }
    if (cond.c) {
      // 子だけを選んで 0 件: 「☆ 目標に登録」（作れるようになったら知らせる）を主な操作、「この子の配合を登録」を 2 番目に（goals-merge）。
      // 文に子の名前を入れる（syncList は同じ文の空の表示を使い回すので、子を変えたときに前の子の押しボタンを残さない）
      const text = `${palsById.get(cond.c)?.ja ?? cond.c}の配合はまだ登録されていません。`;
      if (!context.ideals?.scope?.()) return empty(text, register('この子の配合を登録', () => ({ childId: cond.c })));
      // syncList は同じ文の空の表示を作り直さないので、作った押しボタンは描いた後に出ている方だけ残す（keepEmptyGoal）
      pendingGoal?.destroy();
      pendingGoal = goalToggle(context, cond.c, { className: 'button primary', label: '目標に登録（作れるようになったら知らせます）' });
      const actions = el('div', 'empty-actions');
      actions.append(pendingGoal.element, button('この子の配合を登録', () => context.register({ childId: cond.c }), 'button secondary'));
      return empty(text, actions);
    }
    return empty('条件に合う登録はありません。', button('条件をすべて解除', clearAll, 'button secondary'), { icon: 'search' });
  }

  const view = watchView(context.store, element, update, pickers);
  // 所持パルのデータが変わったら描き直す（読み込みの状態だけの変化では描き直さない）。開いたときに読み込む
  let lastOwned = owned?.state?.owned ?? null;
  const unsubscribeOwned = owned?.subscribe?.((ownedState) => {
    if (ownedState.owned === lastOwned) return;
    lastOwned = ownedState.owned;
    update(context.store.state);
  }) ?? (() => {});
  owned?.load?.().catch(() => {});
  return {
    ...view,
    applyRoute(next, { reason } = {}) {
      readRoute(next);
      pickers.forEach((picker, index) => syncPicker(picker, cond[['p1', 'p2', 'c'][index]]));
      // 入力中のキーワードの欄は上書きしない（打っている途中の文字・変換を消さない）。ただし戻る・進む・リンクなど外から条件が
      // 変わったときは、欄と結果が食い違わないよう合わせる（間引いて待っている入力は捨てる。移る前に app.js が flushInputs で書いている）
      const outside = Boolean(reason) && reason !== 'update';
      if (outside) typed.cancel();
      if ((outside || globalThis.document?.activeElement !== keyword) && keyword.value !== cond.q) keyword.value = cond.q;
      if (sort.value !== cond.sort) sort.value = cond.sort;
      view.update(context.store.state);
      // 利用者が条件を変えた: 結果の先頭が帯の下に隠れていれば先頭を見せる（O-05 と同じ）
      if (reason === 'update') revealResults();
    },
    // 間引いて待っているキーワードの入力をすぐ当てる（app.js が、移る前に履歴のエントリへ条件を書く前に呼ぶ）
    flushInputs: () => typed.flush(),
    // ショートカット N の登録の初期値（app.js）
    registerInitial,
    destroy() {
      destroyed = true;
      inputs.abort();
      unsubscribeOwned();
      band?.destroy();
      emptyGoal?.destroy();
      pendingGoal?.destroy();
      stopTracking();
      registrant.destroy();
      // 新着の基準を、今の取得の時刻（なければ今）に進める
      if (seenScope && context.seen) context.seen.write(seenScope.env, seenScope.userId, context.store.state.serverTime || undefined);
      view.destroy();
    },
  };
}
