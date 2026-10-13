import { el, empty, syncList, clearList } from '../ui/dom.js';
import { breedingCard } from '../ui/breeding-card.js';
import { buildHash } from '../router.js';
import { palsById } from '../ui/pal-icon.js';
import { toast } from '../ui/toast.js';
import { speciesGenderCounts, shortUid } from '../core/owned.js';
import { distancesTo } from '../core/route.js';

export function viewHeading(title) {
  const header = el('header', 'view-heading');
  header.append(el('h1', '', title));
  return header;
}

export function validId(route, key, context) {
  const id = route.params.get(key) ?? '';
  if (!id || palsById.has(id)) return id;
  toast('パルが見つかりません');
  route.params.delete(key);
  context.replace(buildHash(route.view, route.params, route.id));
  return '';
}

/**
 * 画面の中の条件の変更（パル・パッシブを選ぶなど）で URL を変える。同じ画面なら作り直さず、ビューの applyRoute で合わせる
 * （context.update）。ビューのテストの context は update を持たないので、そのときは navigate に落とす。
 */
export function changeRoute(context, hash) {
  if (context.update) context.update(hash);
  else context.navigate(hash);
}

/** route は今の route（applyRoute で入れ直したもの）を渡す。同じ画面なら作り直さない（changeRoute）。 */
export function navigateSelection(context, route, key, value) {
  const params = new URLSearchParams(route.params);
  if (value) params.set(key, value);
  else params.delete(key);
  changeRoute(context, buildHash(route.view, params, route.id));
}

/**
 * 開いている間、interval ごとに owned.autoRefresh() を呼ぶ（タブが裏にある間は呼ばない）。戻り値で止める（画面の destroy で呼ぶ）。
 * 孵化させて受け取ったパル・ホストが共有し直した所持パルを、開いたままの画面に入れるため。
 * 10 秒ごと（D26。前は 20.5 秒で、参加している人の画面への反映が最大 約 41 秒だった。今は最大 約 20 秒）。共有の読み直しは owned.js の
 * 10 秒の制限（SHARED_INTERVAL）で、タイマーが少し早く来た回は次の回に回る。ホストのセーブの読み直しは 20 秒以上空ける（AUTO_INTERVAL）。
 * 裏にある間のセーブの読み直しは、全画面共通の 1 分ごとの読み直し（app.js）に任せる
 */
export function keepRefreshing(owned, { interval = 10000 } = {}) {
  const timer = setInterval(() => {
    if (globalThis.document?.visibilityState === 'hidden') return;
    owned.autoRefresh().catch(() => {});
  }, interval);
  return () => clearInterval(timer);
}

/** パル選択の値が違うときだけ合わせる（同じ値では描き直さない）。 */
export function syncPicker(picker, value) {
  if (picker && picker.getValue() !== value) picker.setValue(value);
}

/**
 * 所持者の選択肢 [値, 名前]（所持パル・理想個体で同じ）: すべて・自分の個体（ログイン中〔ideals がある〕だけ）・プレイヤー（player:<uid>。
 * 自分のプレイヤー〔ideals.selfUids〕は「（自分）」を付けて先頭、名前がない・同じ名前が 2 人以上なら UID の頭 8 字を添える）
 */
export function holderChoices(data, ideals) {
  const players = data?.players ?? [];
  const self = ideals?.selfUids?.() ?? new Set();
  const names = new Map();
  for (const player of players) names.set(player.name, (names.get(player.name) ?? 0) + 1);
  const label = (player) => {
    if (self.has(player.uid)) return `${player.name || '不明なプレイヤー'}（自分）`;
    return !player.name || names.get(player.name) > 1 ? `${player.name || '不明なプレイヤー'}（${shortUid(player.uid)}）` : player.name;
  };
  const ordered = [...players.filter((player) => self.has(player.uid)), ...players.filter((player) => !self.has(player.uid))];
  return [['', 'すべて'], ...(ideals ? [['mine', '自分の個体']] : []), ...ordered.map((player) => [`player:${player.uid}`, label(player)])];
}

// ---------------------------------------------------------------------------
// 固定の条件のパネル（理想個体・所持パル）の部品。2 つのパネルで同じ形・同じ CSS の決まりにする（D28）:
//   1 段目の欄は見出しを入力の上に置き、見出しの行（div.field-head）に、その欄の条件（パッシブの条件）やリンクを添える。
//   2 段目は行（div.panel-line）ごとに欄（.panel-item。見出しを入力の左）を並べ、欄の間に縦の区切り線（CSS）を引く
// ---------------------------------------------------------------------------
/**
 * 欄（パル選択・パッシブ選択など、最初の子が見出し span.field-label の要素）の見出しを、見出しの行 div.field-head に入れ、
 * extras（押しボタン・リンクなど）を見出しの後ろに並べる。見出しの行の要素を返す
 */
export function fieldHead(field, ...extras) {
  const label = field.children[0];
  const head = el('div', 'field-head');
  field.insertBefore(head, label);
  head.append(label, ...extras);
  return head;
}
/**
 * 2 段目の欄（見出しを入力の左に置く）。押しボタンの見出しは radiogroup の名前と重ねて読まれないよう隠す（hidden）。
 * select などの 1 つの入力なら tag: 'label' にして見出しで入力を選べるようにする
 */
export function panelItem(caption, control, { tag = 'div', hidden = false, className = '' } = {}) {
  const node = el(tag, `panel-item ${className}`.trim());
  const label = el('span', 'field-label', caption);
  if (hidden) label.setAttribute('aria-hidden', 'true');
  node.append(label, control);
  return node;
}
/** 2 段目の 1 行（欄を左から並べる。区切り線は CSS が欄の間に引く） */
export function panelLine(...items) {
  const line = el('div', 'panel-line');
  line.append(...items);
  return line;
}

// ---------------------------------------------------------------------------
// パル選択の注記（ui/pal-picker.js の describe が返すもの）。データ（所持パル・記録の index・graph）が
// 新しくなったときだけ数え、開くたびには Map を引くだけにする
// ---------------------------------------------------------------------------
const ownedNotes = new WeakMap();
const recordNotes = new WeakMap();
const distanceNotes = new WeakMap();
const allPalIds = () => [...palsById.keys()];

/** 所持している種族を先に並べ、「♂3 ♀2」（性別の分からない個体だけなら「3 体」）を添える。タマゴは数えない。データが無ければ注記なし */
export function ownedSpeciesNotes(data) {
  if (!Array.isArray(data?.pals)) return {};
  let notes = ownedNotes.get(data);
  if (!notes) {
    const badges = new Map();
    const order = new Map();
    for (const [id, { M, F, total }] of speciesGenderCounts(data.pals)) {
      badges.set(id, M || F ? `♂${M} ♀${F}` : `${total} 体`);
      order.set(id, 0);
    }
    notes = { order, badges, orderLabel: '所持している種族を先に表示' };
    ownedNotes.set(data, notes);
  }
  return notes;
}

/** 記録を探す画面の選択欄。並びは変えず、親（kind 'parent'）・子（'child'）としての登録件数を添え、0 件は薄くする */
export function recordCountNotes(index, kind) {
  if (!index?.byParent) return {};
  let cached = recordNotes.get(index);
  if (!cached) recordNotes.set(index, cached = {});
  if (!cached[kind]) {
    const word = kind === 'child' ? '子' : '親';
    const badges = new Map();
    for (const [id, records] of kind === 'child' ? index.byChild : index.byParent) {
      if (records.length) badges.set(id, `${word} ${records.length} 件`);
    }
    cached[kind] = { badges, dim: new Set(allPalIds().filter((id) => !badges.has(id))) };
  }
  return cached[kind];
}

/** 継承ルートの開始の選択欄。登録済みの記録の graph で目標まで届くパルを、回数の少ない順に先へ（「N 回」）。届かないパルは薄く後ろに */
export function routeDistanceNotes(graph, to) {
  if (!graph || !to) return {};
  const distances = distancesTo(graph, to);
  let notes = distanceNotes.get(distances);
  if (!notes) {
    const badges = new Map([...distances].map(([id, count]) => [id, count ? `${count} 回` : '目標']));
    notes = { order: distances, badges, dim: new Set(allPalIds().filter((id) => !distances.has(id))), orderLabel: '目標まで少ない回数の順に表示' };
    distanceNotes.set(distances, notes);
  }
  return notes;
}

/**
 * パッシブの選択欄の「登録した組み合わせ」。登録した理想個体（新しい順）のうちパッシブのあるものから、
 * 同じ組み合わせを除いて limit 件まで。label は目標の名前。登録の仕組みが無ければ空
 */
export function passivePresets(ideals, limit = 5) {
  const presets = [];
  const seen = new Set();
  for (const goal of ideals?.list() ?? []) {
    if (!goal.passives?.length) continue;
    const key = [...goal.passives].sort().join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    presets.push({ label: goal.name, passives: [...goal.passives] });
    if (presets.length >= limit) break;
  }
  return presets;
}

/**
 * 配合のカードの key。表示の向き（左に出す親・相手を出す親）と中身の版（etag・updatedAt）を含める。
 * 1 件 2 行の一覧で同じ key にしない・楽観更新（updatedAt が変わる）と送信待ちの登録（pending の etag）で古い表示を残さない
 */
export const cardKey = ({ record, leftParent = '', focusParent = '' }) =>
  `${record.id}|${leftParent ? `L:${leftParent}` : focusParent ? `F:${focusParent}` : ''}|${record.etag ?? ''}|${record.updatedAt ?? ''}`;

/**
 * 配合のカードを key で使い回して描く（同じ配合は同じ要素のまま。中身が変わった配合は key が変わって作り直す）。
 * items は [{ record, leftParent?, focusParent? }]。emptyNode（() => Element）は 0 件のときに出す要素
 */
export function renderCards(target, items, context, { empty: emptyNode } = {}) {
  syncList(target, items, {
    key: cardKey,
    create: ({ record, leftParent = '', focusParent = '' }) => ({ element: breedingCard(record, context, { leftParent, focusParent }) }),
    empty: emptyNode,
  });
}

export function dataPending(target, state) {
  if (state.env) return false;
  // 使い回している行を捨ててから出す（syncList の入れ物に replaceChildren を直接使わない決まり）
  clearList(target);
  target.append(empty(state.error || '登録済みの配合を読み込んでいます…'));
  return true;
}

// blur を待っている入れ物（待っている間に呼ばれたら、最後の描き方だけを後で行う）
const waiting = new WeakMap();

/**
 * container の中にフォーカスがあれば、その要素から離れる（blur）まで render を待つ（開いている選択肢を閉じない・選んでいる途中に作り直さない）。
 * 待たなければすぐ render して true を返す
 */
export function renderWhenIdle(container, render) {
  const doc = globalThis.document;
  const active = doc?.activeElement;
  if (!active || active === doc.body || !container.contains(active)) {
    waiting.delete(container);
    render();
    return true;
  }
  const entry = waiting.get(container);
  if (entry) { entry.render = render; return false; }
  const next = { render };
  waiting.set(container, next);
  active.addEventListener('blur', () => {
    if (waiting.get(container) !== next) return;
    waiting.delete(container);
    // フォーカスが次の要素へ移ってから確かめ直す（同じ入れ物の中へ移ったなら、また待つ）
    queueMicrotask(() => renderWhenIdle(container, next.render));
  }, { once: true });
  return false;
}

const optionKeys = new WeakMap();

/**
 * select の選択肢を choices（[value, label] の並び）に合わせる。並びが前と同じなら作り直さない。
 * 違っても、その select にフォーカスがある間は作り直さず、blur の後に作り直す（renderWhenIdle）。
 * after(select) は選択肢を合わせた後の値合わせ（作り直さなかったときも呼ぶ。待っている間は呼ばない）
 */
export function syncOptions(select, choices, after = () => {}) {
  const key = JSON.stringify(choices);
  if (optionKeys.get(select) === key) {
    // 待っている作り直しがあれば取り消す（今の選択肢に戻った）
    waiting.delete(select);
    after(select);
    return;
  }
  renderWhenIdle(select, () => {
    optionKeys.set(select, key);
    select.replaceChildren(...choices.map(([value, label]) => {
      const node = el('option', '', label);
      node.value = value;
      return node;
    }));
    after(select);
  });
}

/**
 * store の記録が変わったら update で描き直す。返す update は、条件が変わったときにビューが直接呼ぶ。
 * 記録は画面用の変更番号（store.state.revision）で比べる。中身が同じ取得・自動の読み直しでは描き直さない。
 */
export function watchView(store, element, update, pickers = []) {
  let lastRevision = store.state.revision;
  let lastIndex = store.state.index;
  let lastEnv = store.state.env;
  let lastError = store.state.error;
  // 通信中というだけでカードを作り直すと、操作中のフォーカスを失う。
  const unsubscribe = store.subscribe((state) => {
    // 番号を持たない store（テストの偽物など）は、今までどおり index の参照で比べる
    const same = state.revision === undefined ? state.index === lastIndex : state.revision === lastRevision;
    if (same && state.env === lastEnv && state.error === lastError) return;
    lastRevision = state.revision;
    lastIndex = state.index;
    lastEnv = state.env;
    lastError = state.error;
    update(state);
  });
  update(store.state);
  return { element, update, destroy() { unsubscribe(); pickers.forEach((picker) => picker.destroy()); } };
}
