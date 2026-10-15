import { el, empty, link, button, syncList, clearList, trackHeight, storageWarning, loadingState, statusChip, setChipTone, setDisabled } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { captureFocus, restoreFocus } from '../ui/focus.js';
import { startSliced } from '../ui/slice.js';
import { segmented } from '../ui/segmented.js';
import { createPopover } from '../ui/popover.js';
import { hint } from '../ui/hint.js';
import { openDialog } from '../ui/dialog.js';
import { palPicker } from '../ui/pal-picker.js';
import { palsById, palTile, palIcon, genderMark, elementIcon, gameIcon } from '../ui/pal-icon.js';
import { passiveSelector, passivesById, passiveList, passiveChip } from '../ui/passive-picker.js';
import { talentInput } from '../ui/talent-input.js';
import { actionIcon } from '../ui/breeding-card.js';
import { toast } from '../ui/toast.js';
import { eggMatches, goalProgress, palsOfPlayers, isSpeciesGoal, GOAL_LIMIT, GOAL_NAME_MAX, GOAL_STATS } from '../core/ideal-goals.js';
import { goalOwnedHash } from '../ideals.js';
import { passiveCounts, ownedCounts, ownedRouteStarts, itemStock, stockText } from '../core/owned.js';
import { implantOf, implantNeed, canImplant, cleanSurgery, IMPLANT_KINDS } from '../core/implants.js';
import { shortestRoute } from '../core/route.js';
import { findByChild } from '../core/index.js';
import { goalToggle } from '../ui/goal-toggle.js';
import { onlineUids, onlineKey } from '../ui/owned-status.js';
import { cakeLine } from '../ui/farm-board.js';
import {
  idealPlanSteps, breedingLayouts, isParentCandidate, planSpeed, cakeSpeedSteps, fastestCake, MAX_WANTED, CAKES, PASSIVE_MODES, TALENT_KEYS, PLAN_GROUPS,
} from '../core/ideal.js';
import { targetFarms, farmAdvice, farmSignature, planChanges, planPairKey, farmCompleteness, emptyFarms, farmNames, farmsInUse } from '../core/ideal-farms.js';
import { buildHash, settingsHash } from '../router.js';
import { ownedWorldId } from '../core/owned-shared.js';
import { ownedRow, rowSignature, DEFAULT_PLACES } from './owned.js';
import {
  viewHeading, validId, navigateSelection, changeRoute, watchView, dataPending, syncPicker, syncOptions, ownedSpeciesNotes, passivePresets, keepRefreshing,
  holderChoices, holderValue, HOLDER_DEFAULT, fieldHead, panelItem, panelLine,
} from './shared.js';
import { tabLabel } from './tabs.js';
import { cleanSaved, oneOf, intIn, internalName } from '../core/boundary.js';

// 一度に出す組の数（条件に合う組がもっと多いときは、件数だけを出す）
const LIMIT = 20;
const TALENT_LABELS = { hp: 'HP', shot: '攻撃', defense: '防御' };
// 条件のパネルの押しボタンの短いラベル（長い説明は core/ideal.js の PASSIVE_MODES・CAKES の文を title に出す）
const MODE_LABELS = { include: '全部持つ', only: 'だけ' };
const CAKE_LABELS = { none: 'なし', talent: 'キノコ等', special: 'スペシャル' };
// ケーキの押しボタンのアイコン（web/img/item/ の下。core/ideal.js の CAKES の鍵 → ゲームのケーキのアイテム ID）
const CAKE_ICONS = { none: 'cake-Cake', talent: 'cake-Cake02', special: 'cake-Cake05' };
const shortChoices = (choices, labels) => choices.map(([key, text]) => [key, labels[key] ?? text, text]);

const targetValue = (value) => intIn(value, { min: 0, max: 100, fallback: 100 });
/**
 * 保存して読み戻す条件の形（ui/view-memory.js が sessionStorage・履歴のエントリから読むときに、項目ごとに確かめる）。
 * 合わない項目は既定の値に戻す。登録する名前・配合牧場の基準（planBaselines）は保存しない
 */
export const IDEAL_MEMORY = {
  // 所持者: すべて（''）・自分（mine。既定）・プレイヤー（player:<uid>）。無い・形の合わない値は既定の自分（D29。前は「すべて」）
  holder: (value) => (typeof value === 'string' && value.length <= 48 && (value === '' || value === 'mine' || /^player:\S/.test(value)) ? value : HOLDER_DEFAULT),
  mode: (value) => oneOf(value, PASSIVE_MODES.map(([key]) => key), 'include'),
  targets: (value) => cleanSaved(value, Object.fromEntries(TALENT_KEYS.map((key) => [key, targetValue]))),
  cake: (value) => oneOf(value, CAKES.map(([key]) => key), 'none'),
};
// 区切った計算の 1 回の区切り（ms）。最初の区切りで終われば同期で描く（stable-render の D18: 1 区切り 50ms 以内）
const SLICE_BUDGET = 30;
// 配合牧場の帯（高さ固定の 1 行）に並べる牧場の数。入り切らない分は「ほか n か所」（押すと下の詳細へ）
const STRIP_FARMS = 3;
// 牧場の判定から組へ移ったとき、カードを光らせる時間（ms）
const FLASH_MS = 1000;
// ケーキの提案で覚える条件の数（新しく使った条件から。D30）と、「最速」の印を付けた押しボタンの title に足す文
const CAKE_MEMORY = 8;
const CAKE_NOTE = 'この条件でいちばん早く完成できるケーキ（押すと切り替えます）';
// パル手術台（implants）: 手術で付ける分を除いて計画しているとき（URL の s）に「目標に保存」を押せない理由と、インプラントの種類のアイコン
//（web/img/item/ の下。game-assets で取り出したもの。アイテムのない行は出さない）
const SURGERY_SAVE_REASON = '手術を含めずに計画すると保存できます';
const IMPLANT_ICONS = { reusable: 'PalPassiveSkillChange', consumable: 'PalPassiveSkillChange_Consumable' };
const clock = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());

// 中身が変わったときだけ作り直されるもの（配合の index）を、計算の署名に入れる番号にする
const objectIds = new WeakMap();
let objectSeq = 0;
const objectRev = (data) => (!data || typeof data !== 'object' ? 0 : objectIds.get(data) ?? (objectIds.set(data, ++objectSeq), objectSeq));

/**
 * 計算に効く個体の値（ID・種族・性別・パッシブ・個体値）の署名。親になれる個体（目標の配合の種族で、タマゴ・グローバルパルボックスでない）だけ。
 * レベル・場所・ニックネームなどは計算に効かないので入れない（それだけが変わった読み直しで、計算中の仕事を捨てて最初からやり直さない。
 * 描いている組の個体は、描くときに新しいデータの個体に入れ替える）
 */
function candidateSignature(pals, species) {
  let signature = '';
  for (const pal of pals) {
    if (!species.has(pal.palId) || !isParentCandidate(pal)) continue;
    signature += `${pal.id}\u0001${pal.palId}\u0001${pal.gender}\u0001${pal.passives.join(',')}\u0001${pal.talent.hp},${pal.talent.shot},${pal.talent.defense}\u0002`;
  }
  return signature;
}

// 組のカードの数値（「完成まで 平均 約 N 個」・内訳の「1 個のタマゴで N%」など）・確率の注記・「同じ種族どうし」・登録済みの配合の文は、
// 2026-10-14 のユーザーのフィードバック（D30）でなくした（percent・eggsText・generationsText・pairMeasure・sourceText を消した）。
// 並び（core/ideal.js の comparePlan）は変えていない

const palName = (id) => palsById.get(id)?.ja ?? id;
const passiveNames = (ids) => ids.map((id) => passivesById.get(id)?.ja ?? id).join('、');

// 配合の計画の組の目的（core/ideal.js の PLAN_GROUPS）
const GROUP_LABELS = { complete: '完全体作成組', passive: 'パッシブ厳選組', talent: '個体値厳選組' };
// 組のカードの札（組の目的・変更あり・配置中）を押すと開く説明（ui/hint.js）
const TAG_HINTS = {
  complete: 'この 2 体（子と入れ替えながらを含む）で、欲しいパッシブと個体値の目標を全部満たす子を狙える組です。同じ種族なら、両親合わせて欲しいパッシブがそろえば入ります。',
  passive: '完全体作成組に当たらず、両親を合わせると欲しいパッシブが片親より多く集まる組です。個体値は見ません。',
  talent: 'パッシブは見ずに、個体値の目標をそろえる組です。',
  changed: '交換推奨の行き先の組のうち、牧場の中身が最後に変わったときにはなかった組です。',
  placed: 'セーブで、この組がその牧場に入っていると分かった組です。',
  farmTo: '配合牧場の判定で、この組をその牧場の今の組と入れ替えることを勧めています（交換推奨）。',
};
// 名前の後ろに「に配置中」「へ」を続ける（「牧場 A に」のように、英数字で終わる名前の後だけ空ける）
const joinName = (name, rest) => `${name}${/[0-9A-Za-z]$/.test(name) ? ' ' : ''}${rest}`;
// 個体の持ち主（手持ち・パルボックスなどは所持者、拠点のパルは預けた人）。分からなければ空
const ownerOf = (pal) => (pal.place === 'base' ? pal.lastOwner || '' : pal.holder === '不明' ? '' : pal.holder || '');

// 組の目的のアイコン（12px。王冠＝完全体作成組、つながった 2 つの輪＝パッシブ厳選組、3 本のバー＝個体値厳選組。定義は ui/icons.js）
const groupIcon = (group) => icon(`group-${group}`, { className: 'ideal-tier-icon' });

/**
 * 組のカード: 番号と札の 1 行、♂♀ の行、（あれば）登録の注意。数値の行・内訳の文・「同じ種族どうし」は出さない（D30）。
 * 札（組の目的・変更あり・配置中・交換先の牧場・持ち主）は押すと説明が開くボタンで、作った説明の部品は hints に入れる
 *（カードを作り直すときに、呼んだ側が destroy して開いている板を閉じる）。
 * highlight（{ wanted, targets }）は ♂♀ の行で欲しいパッシブと、個体値が目標に届いているかを見せる（views/owned.js の ownedRow）。
 * placed はこの組が入っている牧場の名前、farmTo は交換推奨でこの組を置く牧場の名前、marks(pal) は親の行の印（別の配合牧場で使用中）。
 * data-key（♂と♀の個体 ID）で、牧場の判定から押したときにこのカードを探す。
 * 押せる部品には data-focus-key（カード card:<key>・札 tag:<key>:<種類>・♂♀ の行の部品 pair:<key>:<M|F>:<data-focus>）を付け、
 * 描き直しでカードを作り直しても、フォーカスを同じ役目の部品へ戻す（drawPlan の captureFocus・restoreFocus）
 */
function pairCard(pair, rank, { placed = '', changed = false, farmTo = '', highlight, hints = [], marks = () => [] } = {}) {
  const key = planPairKey(pair.male, pair.female);
  const card = el('article', `ideal-pair group-${pair.group}`);
  card.setAttribute('aria-label', `${rank + 1} 番目の組`);
  card.setAttribute('data-key', key);
  card.setAttribute('data-focus-key', `card:${key}`);
  const head = el('div', 'ideal-pair-head');
  const tags = el('div', 'ideal-tags');
  const tag = (kind, className, text, help, icon) => {
    const node = button('', null, className);
    node.setAttribute('data-focus-key', `tag:${key}:${kind}`);
    // 札がなくなったら（「変更あり」が消えたなど）、同じ組の目的の札へ
    if (kind !== 'group') node.setAttribute('data-focus-fallback', `tag:${key}:group`);
    if (icon) node.append(icon);
    node.append(el('span', '', text));
    hints.push(hint({ label: text, trigger: node, content: help }));
    return node;
  };
  tags.append(tag('group', `ideal-tier group-${pair.group}`, GROUP_LABELS[pair.group] ?? '', TAG_HINTS[pair.group] ?? '', groupIcon(pair.group)));
  // 状態の印は状態のチップ（ui/dom.js の statusChip と同じクラス）の形。「変更あり」は warning（tertiary は primary と同じ色で、
  // 完成済みなどの ready と見分けられないため）、「配置中」は info。押すと説明が開くボタンのまま
  if (changed) tags.append(tag('changed', 'status-chip is-warning ideal-changed', '変更あり', TAG_HINTS.changed));
  if (placed) tags.append(tag('placed', 'status-chip is-info ideal-placed', joinName(placed, 'に配置中'), TAG_HINTS.placed));
  if (farmTo) tags.append(tag('farmTo', 'ideal-farm-to', `→ ${joinName(farmTo, 'へ')}`, TAG_HINTS.farmTo));
  // 2 体の持ち主が違う組（X-28。だれと相談して置くか）。どちらかが分からなければ出さない
  const owners = [ownerOf(pair.male), ownerOf(pair.female)];
  if (owners.every(Boolean) && owners[0] !== owners[1]) {
    tags.append(tag('owners', 'ideal-owners', `${owners.join('・')} の個体`, `♂ は ${owners[0]}、♀ は ${owners[1]} の個体です（拠点のパルは預けた人）。`));
  }
  head.append(el('span', 'step-number', String(rank + 1)), tags);
  // 登録の注意だけを下に出す（余計なパッシブの確率の注記は D30 でなくした。余計なパッシブは ♂♀ の行で薄く見せる）
  const notes = el('ul', 'ideal-notes');
  const note = (text, className = '') => notes.append(el('li', className, text));
  if (pair.ambiguous) note('同じ組み合わせで別の子も登録されています。どちらかの登録が間違っている可能性があります。', 'ideal-warning');
  else if (pair.swapped) note('登録済みの配合の性別を入れ替えた向きです（同じ子が産まれるとみなしています。未検証）', 'ideal-warning');
  else if (pair.unverified) note('性別条件は未検証', 'ideal-warning');
  // ♂♀ の行（列見出しはないので、個体値の 4 セルは CSS で小さな見出しを付ける）。「+N」の説明の部品も hints に入れる。
  // 行の部品の目印（data-focus。名前のリンク pal・「+N」）から data-focus-key を作る（「+N」がなくなったら同じ行の名前のリンクへ）
  const rows = [[pair.male, 'M'], [pair.female, 'F']].map(([pal, sex]) => {
    // 「別の配合牧場で使用中」は名前の下のバッジの 1 行に（所持パルの一覧の目標の印の下の段〔D25〕は使わず、カードの行は 64px のまま）
    const row = ownedRow(pal, { highlight, badges: marks(pal), hints });
    for (const node of row.querySelectorAll('[data-focus]')) {
      const focus = node.getAttribute('data-focus');
      node.setAttribute('data-focus-key', `pair:${key}:${sex}:${focus}`);
      if (focus !== 'pal') node.setAttribute('data-focus-fallback', `pair:${key}:${sex}:pal`);
    }
    return row;
  });
  card.append(head, ...rows);
  if (notes.children.length) card.append(notes);
  return card;
}

// 同じ見込みの個体値厳選組を畳むときの比べ方（見込みは世代の平均があればそれ、なければ 1 個のタマゴの確率。
// 解く順番で末尾の桁がずれる値を同じとみなすため、有効数字 12 桁で比べる。core/ideal.js の compareRounded と同じ考え方）
const prospect = (pair) => (Number.isFinite(pair.talentGenerations) ? pair.talentGenerations : pair.talentChance);
const sameNumber = (a, b) => a === b || (Number.isFinite(a) && Number.isFinite(b) && a.toPrecision(12) === b.toPrecision(12));
const sameProspect = (a, b) => a.group === 'talent' && b.group === 'talent'
  && Number.isFinite(a.talentGenerations) === Number.isFinite(b.talentGenerations) && sameNumber(prospect(a), prospect(b));

const choiceLabel = (choices, value) => choices.find(([key]) => key === value)?.[1] ?? value;
const goalHash = (goal) => (isSpeciesGoal(goal) ? buildHash('ideal', { to: goal.palId }) : buildHash('ideal', { to: goal.palId, p: goal.passives.join(','), g: goal.id }));

/** 登録した条件の要約（個体値の目標・パッシブの条件・ケーキ）。個体値は「HP —・攻撃 100 以上」（保存の 0 は条件なし）。種族だけの目標は「条件なし」 */
function goalSummary(goal) {
  if (isSpeciesGoal(goal)) return '条件なし（そのパルがいれば完成）';
  const targets = GOAL_STATS.map((key) => `${TALENT_LABELS[key]} ${goal.targets[key] ? `${goal.targets[key]} 以上` : '—'}`).join('・');
  return [targets, choiceLabel(PASSIVE_MODES, goal.mode), choiceLabel(CAKES, goal.cake).replace(/（.*）$/, '')].join(' · ');
}

/**
 * 一覧での完成の状態（自分の個体で判定する）。所持パルのデータがない・自分のプレイヤーが分からないときは、
 * 完成していないとは言えないので「未確認」にする。理由は行ごとに繰り返さず、目標のダイアログの表の上に 1 回だけ出す（goalsReason。roles。C-06）
 */
// all は全部の個体（孵化待ちのタマゴを数える。自分の個体のタマゴと、拠点に置かれた持ち主のないタマゴ。farm-board）。
// 未完成なら gap に、いちばん近い自分の個体との差（「パッシブ 3/4 · 攻撃あと 8」。同じ種族がいなければ「未所持」。goals-detail の I-24）
const GAP_LABELS = { hp: 'HP', shot: '攻撃', defense: '防御' };
function goalGap(goal, near) {
  if (!near) return '未所持';
  const parts = [];
  if (near.passives.total) parts.push(`パッシブ ${near.passives.have}/${near.passives.total}`);
  const shorts = GOAL_STATS.filter((key) => near.short[key] > 0).map((key) => `${GAP_LABELS[key]}あと ${near.short[key]}`);
  if (shorts.length) parts.push(...shorts);
  else if (GOAL_STATS.some((key) => goal.targets[key] > 0)) parts.push('個体値は届いています');
  if (near.extra) parts.push(`余計なパッシブ ${near.extra}`);
  return parts.join(' · ');
}
// 手術で完成できる個体の 1 行（implants の X-26）: 「アヌビス♂ Lv52（拠点 1）＋神速（使い切りインプラント・在庫 4）」。2 体以上なら
//「 · ほか n 体」。目標の一覧の状態の欄は狭いので、アイテムは種類だけ（アイテム名は「使い切りインプラント：〈パッシブ〉」で、パッシブ名と重なる）、
// パルボックスの場所は行と同じ短い形（P4 · 2-5）。在庫は手元で読んだホストのデータ（data の items）のときだけ添える（参加者・在庫を読む前の
// データは添えない）
function surgeryLine({ pal, add, count }, data) {
  const sex = pal.gender === 'M' ? '♂' : pal.gender === 'F' ? '♀' : '';
  const adds = add.map((id) => {
    const entry = implantOf(id);
    const stock = entry?.item ? stockText(itemStock(data, entry.item), { short: true }) : '';
    return `＋${passivesById.get(id)?.ja ?? id}（${[IMPLANT_KINDS[entry?.kind] ?? '', stock].filter(Boolean).join('・')}）`;
  }).join('');
  const where = pal.box ? `P${pal.box.page} · ${pal.box.row}-${pal.box.column}` : pal.placeLabel;
  const head = `${pal.name}${sex} Lv${pal.level}${where ? `（${where}）` : ''}${adds}`;
  return count > 1 ? `${head} · ほか ${count - 1} 体` : head;
}
// data は所持パルのデータ（在庫を添えるため。implants）
function goalStatus(goal, pals, all = null, data = null) {
  if (pals === undefined || pals === null) return { done: false, text: '未確認', unknown: true };
  // 完成品と、なければいちばん近い個体、手術台で足りないパッシブを付ければ完成する個体（種族ごとの索引で 1 回に求める。同じ種族の目標 100 件 ×
  // 20,000 行でも止まらない）。手術で完成できても完成の通知（ベル）は鳴らさない（完成の判定は ideals.js の goalMatches のまま）
  const { found, nearest, addable } = goalProgress(goal, pals, { canAdd: canImplant });
  if (!found.length) {
    const hatching = all ? eggMatches(goal, all, pals).length : 0;
    if (addable) {
      return { done: false, surgery: true, text: `手術で完成できる${hatching ? `（孵化待ちに ${hatching} 個）` : ''}`, hatching, gap: surgeryLine(addable, data) };
    }
    // 種族だけの目標は、持っていれば完成なので差は「未所持」だけ
    const gap = isSpeciesGoal(goal) ? '未所持' : goalGap(goal, nearest);
    return { done: false, text: hatching ? `未完成（孵化待ちに ${hatching} 個）` : '未完成', hatching, gap };
  }
  const [first] = found;
  const where = `${first.holder} · ${first.placeLabel}`;
  return { done: true, text: `完成済み: ${where}${found.length > 1 ? ` ほか ${found.length - 1} 体` : ''}` };
}

export function idealView(context, route) {
  const owned = context.owned;
  const element = el('section', 'view ideal-view');
  // 画面の中の条件は、タブを切り替えても残す。読み込み直しても、同じタブ（sessionStorage）の間は残る（app.js が戻す）
  const memory = context.viewState?.('ideal');
  // 所持者の既定は自分（D29）。自分のプレイヤーが分からないときは「すべて」として計算する（holderNow）
  const conditions = memory?.conditions ?? { holder: HOLDER_DEFAULT, mode: 'include', targets: { hp: 100, shot: 100, defense: 100 }, cake: 'none' };
  conditions.holder ??= HOLDER_DEFAULT;
  if (memory) memory.conditions = conditions;
  const ideals = context.ideals;
  // 入力の間引きの待ち時間（テストの context は 0 にして同期で確かめる）
  const inputDelay = context.inputDelay ?? 150;
  // 区切った計算の 1 回の区切り（テストの context は Infinity にして、計算を同期で確かめる）
  const sliceBudget = context.sliceBudget ?? SLICE_BUDGET;
  let current = route;
  let to = '';
  let passives = [];
  // パル手術台で付ける前提で、計画から除いた欲しいパッシブ（URL の s。implants の X-22）。目標の保存・history.state の条件には入れない
  let surgery = [];
  // URL から読む条件（作るときと、同じ画面のまま URL が変わったとき）。登録した理想個体の条件を入れたら true を返す
  // goals=1（前のウィッシュリストの URL #/wishlist の読み替え）で開いたら、目標のダイアログを開いて URL から外す
  let openGoalsLater = false;
  function readRoute(next) {
    current = next;
    if (next.params.get('goals') === '1') {
      next.params.delete('goals');
      openGoalsLater = true;
      context.replace?.(buildHash('ideal', next.params));
    }
    to = validId(next, 'to', context);
    // 重複とマスターにない ID は除く（知らない ID のチップを出さない）
    passives = [...new Set((next.params.get('p') ?? '').split(',').filter((id) => internalName(id)))].slice(0, MAX_WANTED);
    // 手術で付ける前提のパッシブ（s）: パッシブ ID の形・手術台で付けられる・p と重ならない・p と合わせて 4 個まで（core/implants.js の
    // cleanSurgery）。合わないものは捨てて URL を置き換える（履歴を増やさない）
    const surgeryParam = next.params.get('s');
    const checked = cleanSurgery(surgeryParam ?? '', passives);
    surgery = checked.ids;
    if (surgeryParam !== null && checked.changed) {
      if (surgery.length) next.params.set('s', surgery.join(','));
      else next.params.delete('s');
      context.replace?.(buildHash('ideal', next.params));
    }
    // 通知や一覧から開いたとき（g）は、登録した条件をそのまま使い（同じパルとパッシブでも条件が違う登録があるため）、URL から外す
    const goalId = next.params.get('g');
    if (!goalId) return false;
    const goal = ideals?.find(goalId);
    if (goal) Object.assign(conditions, { mode: goal.mode, cake: goal.cake, targets: { ...goal.targets } });
    else toast('保存した目標が見つかりません');
    // 元の params から外す（ここから作る遷移先の URL や、作り直した画面に g を残さない）
    next.params.delete('g');
    context.replace(buildHash('ideal', next.params));
    return Boolean(goal);
  }
  readRoute(route);

  // 所持している種族を先に「♂3 ♀2」つきで出す
  const toPicker = palPicker({ label: '目標', value: to, describe: () => ownedSpeciesNotes(owned?.state?.owned),
    onChange: (id) => navigateSelection(context, current, 'to', id) });
  // 欲しいパッシブの選択欄は 1 回だけ作り、条件・データが変わったら update で合わせる（開いた候補を閉じない）
  const passive = passiveSelector({ label: '欲しいパッシブ', selected: passives, negatives: 'last', presets: passivePresets(ideals), onChange: (ids) => setPassives(ids) });

  // 個体値の目標（☑ HP [100]。チェックを外すか空欄で条件なし＝保存は 0。「以上」は見出しに 1 回だけ出す）。数字の入力は間引き
  //（打っている途中の値で重い計算を回さない）、確定（change）・チェック・「すべて 100」ですぐ計算する。
  // 間引いて待っている入力は、閉じるときに取り消し、移る前の保存の前に flushInputs で当てる
  const talent = talentInput({
    keys: TALENT_KEYS, labels: TALENT_LABELS, value: conditions.targets,
    // 「以上」は見出しに 1 回だけ出すので、読み上げの名前に入れる（所持パルの「HPの個体値（以上）」と同じ）
    ariaLabel: (key) => `${TALENT_LABELS[key]}の目標（以上）`,
    presets: [{ label: 'すべて 100', value: { hp: 100, shot: 100, defense: 100 } }],
    debounce: inputDelay,
    onChange: (value) => { conditions.targets = { ...value }; renderResults(); },
  });
  // 親にする個体の所持者（すべて／自分のプレイヤー名〔既定〕／ほかのプレイヤー）。プレイヤーの個体は、所持者がそのプレイヤーの個体と、
  // そのプレイヤーが預けた拠点のパル（core/ideal-goals.js の palsOfPlayers）。自分は登録者の対応か同じ名前で決める（分からなければ「すべて」）
  const holderNow = () => holderValue(conditions.holder, ideals);
  // 選択肢を作ったときの自分のプレイヤー（後から分かった・変わったら描き直す。下の store の購読）
  const selfKey = () => [...(ideals?.selfUids?.() ?? [])].join(',');
  let shownSelf = null;
  // 選択肢を作ったときのプレイ中の仲間（保存が古くなると変わる。save-extras）
  let shownOnline = null;
  const holderSelect = el('select');
  holderSelect.addEventListener('change', () => {
    conditions.holder = holderSelect.value;
    renderPassives(owned?.state?.owned?.pals);
    renderResults();
  });
  // 選択肢の並びが前と同じなら作り直さない。違っても、選んでいる途中（フォーカス中）は待つ。
  // 名前は所持パルの所持者と同じ（自分のプレイヤーは「（自分）」を付けて先頭、同じ名前は UID の頭 8 字。views/shared.js）
  let syncingHolders = false;
  function renderHolders() {
    // いまプレイ中の人には「（プレイ中）」（保存が新しいときだけ。save-extras）
    const online = owned?.state ? onlineUids(owned.state) : new Set();
    shownOnline = [...online].sort().join(',');
    const choices = holderChoices(owned?.state?.owned, ideals, { online });
    shownSelf = selfKey();
    syncingHolders = true;
    try {
      syncOptions(holderSelect, choices, () => {
        // 選択肢にない所持者は選ばず、既定（自分。分からなければ「すべて」）に戻す（読み込む前は選択肢がそろっていないので、選んでいた値を
        // 消さずに残す）
        const valid = [...holderSelect.children].some((node) => node.value === holderNow());
        const latest = owned?.state?.owned;
        if (!valid && latest) {
          conditions.holder = HOLDER_DEFAULT;
          // フォーカス中で待っていた作り直し（blur の後）で外したときは、パッシブの数と結果も計算し直す
          //（renderHolders の中からのときは、呼んだ側がこの後で描く）
          if (!syncingHolders) {
            renderPassives(latest.pals);
            renderResults();
          }
        }
        holderSelect.value = holderNow();
      });
    } finally {
      syncingHolders = false;
    }
  }
  // 選んだ所持者の個体だけ（すべてのときはそのまま。自分のプレイヤーが分からないときは空）
  function ofHolder(pals) {
    const data = owned?.state?.owned;
    const holder = holderNow();
    if (!holder || !data) return pals;
    const allowed = holder === 'mine' ? ideals?.mine() ?? []
      : palsOfPlayers(data, new Set([holder.slice('player:'.length)]));
    const ids = new Set((allowed ?? []).map((pal) => pal.id));
    return pals.filter((pal) => ids.has(pal.id));
  }
  // パッシブの条件とケーキは押しボタン（値と計算は前の select と同じ。長い説明は title）。押したらすぐ計算する
  const modeChoice = segmented({ label: 'パッシブの条件', choices: shortChoices(PASSIVE_MODES, MODE_LABELS), value: conditions.mode,
    onChange: (value) => { conditions.mode = value; renderResults(); } });
  const cakeChoice = segmented({ label: 'ケーキ', choices: shortChoices(CAKES, CAKE_LABELS), value: conditions.cake,
    onChange: (value) => { conditions.cake = value; renderResults(); } });
  // ケーキの押しボタンの左にゲームのケーキのアイコン（なし＝ケーキ・キノコ等＝キノコケーキ・スペシャル＝スペシャルケーキ。game-assets）。
  // 文字は残す。読めなければアイコンだけ外す
  for (const [value, file] of Object.entries(CAKE_ICONS)) {
    const radio = cakeChoice.element.querySelector(`[data-value="${value}"]`);
    radio?.insertBefore(gameIcon(`item/${file}.png`, { size: 18, className: 'cake-icon' }), radio.firstChild ?? null);
  }
  // 同じ画面のまま登録した理想個体を呼び出したとき（g）・戻る・進むで条件を入れ直したとき、入れた条件を入力欄にも出す
  function showConditions() {
    talent.update(conditions.targets);
    modeChoice.update(conditions.mode);
    cakeChoice.update(conditions.cake);
  }

  // 所持の状況（I-53）: 目標と同じ種族の親の候補の数（idealPlan の数。所持者で絞った後）。押すと所持パルをその種族とパッシブ
  //（所持者で絞っていれば同じ所持者。所持パルの URL の holder）で開く。親の候補はタマゴとグローバルパルボックスを除くので、
  // 開いた先も同じ集まりになるよう、その 2 つを除いた場所（所持パルの URL の place）も渡す（D27。前は場所を渡さず、タマゴも出た）。
  // 目標がないときは「—」で幅を保ち、文字だけ書き換える（要素は作り直さない）
  const HOLDING_PLACES = DEFAULT_PLACES.filter((group) => group !== 'egg').join(',');
  const holding = el('a', 'ideal-holding', '—');
  holding.title = '親の候補の数（タマゴ・グローバルパルボックスを除き、所持者の絞り込みの後）';
  function renderHolding(result) {
    const text = result && to ? `所持 ♂${result.sameSpecies.M} ♀${result.sameSpecies.F}${passives.length
      ? ` · 全部持つ ♂${result.complete.M} ♀${result.complete.F}` : ''}` : '—';
    if (holding.textContent !== text) holding.textContent = text;
    if (result && to) holding.setAttribute('href', buildHash('owned', { pal: to, p: passives.join(','), holder: holderNow(), place: HOLDING_PLACES }));
    else holding.removeAttribute('href');
  }

  // 今の条件（パル・欲しいパッシブ・パッシブの条件・個体値の目標・ケーキ）を、名前を付けて目標として保存する（この端末だけ）。
  // 名前の変更・条件の更新はしない（外して保存し直す。I-18）
  const defaultName = () => `${palName(to)}${passives.length ? `（${passiveNames(passives)}）` : ''}`.slice(0, GOAL_NAME_MAX);
  const goalConditions = () => ({ palId: to, passives, mode: conditions.mode, targets: { ...conditions.targets }, cake: conditions.cake });
  const saveSlot = el('div', 'ideal-save-slot');
  saveSlot.hidden = !ideals;
  // 目標がないときは見えないまま場所を残す（選んだときに右が動かない）。保存済みは押せない印（aria-disabled）にし、フォーカスは残す
  const saveButton = button('☆ 目標に保存', () => {
    if (!to || saveButton.getAttribute('aria-disabled') === 'true') return;
    if (saveBoard.isOpen()) saveBoard.close();
    else saveBoard.open();
  }, 'button secondary ideal-save');
  saveButton.setAttribute('aria-haspopup', 'dialog');
  saveSlot.append(saveButton);
  // 保存の小さな板（名前・注記・キャンセル・保存）。Enter で保存、Esc で閉じてボタンへ戻る
  const nameInput = el('input');
  nameInput.type = 'text';
  nameInput.maxLength = GOAL_NAME_MAX;
  nameInput.setAttribute('aria-label', '目標の名前');
  const saveBoard = createPopover({
    anchor: saveButton, wrapper: saveSlot, className: 'picker-popover ideal-save-popover', focusOut: true,
    onOpen() {
      nameInput.value = defaultName();
      nameInput.focus();
      nameInput.select?.();
    },
  });
  saveBoard.element.setAttribute('role', 'dialog');
  saveBoard.element.setAttribute('aria-label', '目標に保存');
  const nameField = el('label', 'field');
  nameField.append(el('span', 'field-label', '名前'), nameInput);
  const saveActions = el('div', 'ideal-save-actions');
  saveActions.append(button('キャンセル', () => saveBoard.close(), 'button secondary small'), button('保存', () => saveGoal(), 'button primary small'));
  saveBoard.element.append(nameField, el('p', 'ideal-save-note', 'この端末に保存します。完成したら右上のベルで知らせます。'), saveActions);
  nameInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    saveGoal();
  });
  function renderSave() {
    if (!ideals) return;
    const registered = Boolean(to) && !surgery.length && ideals.has(goalConditions());
    const text = registered ? '★ 目標に保存済み' : '☆ 目標に保存';
    if (saveButton.textContent !== text) saveButton.textContent = text;
    saveButton.classList.toggle('is-placeholder', !to);
    // 目標がないときは押せない（見えないまま場所を残す）。保存済みは押せない印（aria-disabled）でフォーカスを残す。
    // title は押せない理由と、保存される条件の要約（I-20）
    if (!to) setDisabled(saveButton, true, '目標のパルを選ぶと保存できます');
    // 手術で付ける分を除いて計画しているとき（s）は、目標を配合で作る条件のまま保存するため押せない（implants の X-22）
    else if (surgery.length) setDisabled(saveButton, true, SURGERY_SAVE_REASON, { focusable: true });
    else {
      const summary = goalSummary(goalConditions());
      setDisabled(saveButton, registered, '同じ条件の目標があります', { focusable: true });
      saveButton.title = registered ? `同じ条件の目標があります\n${summary}` : summary;
    }
    // 保存できなくなったら（目標を外した・保存済みになった・手術で付ける分を除いた）板を閉じる
    if ((!to || registered || surgery.length) && saveBoard.isOpen()) saveBoard.close({ focus: Boolean(to) });
  }
  function saveGoal() {
    if (!to || !ideals || surgery.length) return;
    const goal = goalConditions();
    const name = nameInput.value.trim() || defaultName();
    const result = ideals.add({ ...goal, name });
    saveBoard.close();
    if (result === 'added') toast(`「${name}」を保存しました（${goalSummary(goal)}）。完成したら右上のベルで知らせます`);
    else if (result === 'duplicate') toast('この条件はすでに保存しています');
    else if (result === 'full') toast(`保存できる目標は ${GOAL_LIMIT} 件までです`);
    else if (context.store.state.renaming) toast('ID の変更が終わってから保存してください');
    else toast('ログインしてから保存してください');
  }

  // 条件のパネル（sticky の 2 段）。見出しと区切りは所持パルのパネルと同じ部品・同じ CSS の決まり（views/shared.js の fieldHead・
  // panelItem・panelLine。D28）:
  //   1 段目 [目標][欲しいパッシブ（見出しの行にパッシブの条件）][保存]（見出しは入力の上）
  //   2 段目 1 行目 [所持者][個体値（以上）]、2 行目 [ケーキ] と右端の所持の状況（見出しは入力の左、欄の間に縦の区切り線）
  // 高さは画面の section の --panel-h に書き続ける（下の帯・scroll-margin-top が使う）
  const panel = el('section', 'ideal-panel');
  panel.setAttribute('aria-label', '理想個体の条件');
  const panelMain = el('div', 'ideal-panel-main');
  // パッシブの条件（全部持つ／だけ）は、条件をかける欲しいパッシブの見出しの行に置く（前は 2 段目の「条件」で、何の条件か分かりにくかった）
  fieldHead(passive.element, modeChoice.element);
  panelMain.append(toPicker.element, passive.element, saveSlot);
  const panelSub = el('div', 'ideal-panel-sub');
  panelSub.append(
    panelLine(panelItem('所持者', holderSelect, { tag: 'label' }), panelItem('個体値（以上）', talent.element)),
    panelLine(panelItem('ケーキ', cakeChoice.element, { hidden: true }), holding),
  );
  panel.append(panelMain, panelSub);
  const stopTracking = trackHeight(panel, element);

  // 結果の上の要約の行（「上位 N 組（全 M 組・候補 K 体） · 登録済みの配合 n 件 · ◯◯ の個体」と「除外 N」）は、2026-10-14 のユーザーの
  // フィードバック（D30）でなくした。組がないときの理由は結果の欄の案内（noPairs）に出す。どのワールドの・いつのデータかは、ヘッダーの
  // セーブ連携の状態に出す（D29）
  // 欲しいパッシブが配合では作れないときの案内と、配合牧場の判定（sticky の帯と、その下の詳細）。
  // 帯の高さは固定（判定が変わっても変わらない）。この目標の組を置いた牧場がない（保留でもない）ときは帯を出さず、場所も取らない（D30。
  // 前は「この目標の組を置いた牧場はありません」と出して場所を残していた。目標を変えたときに下が動くのは利用者の操作なのでよい）
  const missingBox = el('div', 'ideal-missing-note');
  // 手術で付ける前提で計画しているとき（URL の s）の帯（implants の X-22。renderSurgeryBand）。s がなければ隠して場所も取らない
  const surgeryBand = el('div', 'ideal-surgery-band');
  surgeryBand.hidden = true;
  // 孵化させると完成するタマゴ（今の条件を満たすタマゴ。所持者で絞った個体のタマゴと、拠点に置かれた持ち主のないタマゴ。F048・N-16）。
  // 押すと所持パルをタマゴ・その種族・欲しいパッシブで開く。0 個なら出さない（目標を変えたときに下が動くのは利用者の操作なのでよい）
  const hatchBox = el('p', 'ideal-hatch');
  hatchBox.hidden = true;
  const hatchLink = link('', '#', 'ideal-hatch-link');
  hatchBox.append(hatchLink);
  function renderHatch(pals, candidates) {
    const eggs = pals && to ? eggMatches({ palId: to, passives, mode: conditions.mode, targets: conditions.targets }, pals, holderNow() ? candidates : null) : [];
    hatchBox.hidden = !eggs.length;
    if (!eggs.length) return;
    const places = [...new Set(eggs.map((pal) => pal.placeLabel || pal.holder))];
    const text = `孵化させると完成: タマゴ ${eggs.length} 個（${places.slice(0, 2).join('・')}${places.length > 2 ? ' ほか' : ''}）`;
    if (hatchLink.textContent !== text) hatchLink.textContent = text;
    hatchLink.href = buildHash('owned', { pal: to, place: 'egg', p: passives.join(','), holder: '' });
    hatchLink.title = '所持パルでタマゴを開く（孵化させて受け取ると目標が完成します）';
  }
  const farmStrip = el('div', 'ideal-farm-strip');
  farmStrip.setAttribute('role', 'group');
  farmStrip.setAttribute('aria-label', '配合牧場の判定');
  farmStrip.hidden = true;
  // 詳細は既定で閉じた 1 行（見出しだけ。D22）で、押すと開く。開閉は viewState に残す（同じ見込みの組の畳みと同じ。タブを切り替えても残り、
  // 読み込み直すと閉じる）。details は作り直さず見出しの文と中身だけを書き換えるので、再計算や判定が変わっても開閉は変わらない。
  // 出すものがないときは details を外して section を隠す（D30。前は帯が出ている間は 1 行の場所を残していた）
  const farmBox = el('section', 'ideal-farms');
  farmBox.hidden = true;
  const farmFold = el('details', 'ideal-farms-fold');
  farmFold.open = Boolean(memory?.farmsOpen);
  farmFold.addEventListener('toggle', () => { if (memory) memory.farmsOpen = farmFold.open; });
  const farmHead = el('summary', 'ideal-farms-summary');
  farmHead.setAttribute('data-focus-key', 'farm-fold');
  // 画面の h1 の次の見出し（h2。大きさは CSS の .ideal-farms-summary h2 で前の h3 と同じ 14px）
  const farmTitle = el('h2');
  farmHead.append(farmTitle);
  const farmBody = el('div', 'ideal-farms-body');
  farmFold.append(farmHead, farmBody);
  const openFarms = () => {
    farmFold.open = true;
    if (memory) memory.farmsOpen = true;
  };
  const results = el('div', 'ideal-results');
  // 配合牧場の中身が最後に変わったときのおすすめ（「変更あり」の基準）。アプリでは端末に残し、テストなどでは画面の中で覚える
  const planMemory = context.planMemory ?? (() => {
    const kept = memory?.planBaselines ?? new Map();
    if (memory) memory.planBaselines = kept;
    return { get: (id) => kept.get(id) ?? null, set: (id, value) => kept.set(id, value) };
  })();

  // 見出しの右端: 保存した目標のダイアログを開く「目標（N）」。計算のしくみの「?」とダイアログは、2026-10-14 のユーザーのフィードバック
  //（D30「計算の仕組みの説明は不要」）でなくした（INV-2 の例外 b の一文「異種の親は登録済みの配合だけを使います」もいっしょに。
  // INV-2 そのもの〔配合表を読まない・core/ideal.js の import の制限〕はコードとテストで守る）
  const goalsButton = button('', () => openGoals(), 'button secondary small ideal-goals-button');
  goalsButton.setAttribute('aria-haspopup', 'dialog');
  goalsButton.hidden = !ideals;
  const heading = viewHeading(tabLabel('ideal'));
  const headingActions = el('div', 'view-heading-actions');
  headingActions.append(goalsButton);
  heading.append(headingActions);

  // 保存した目標のダイアログ（表。完成済みを上に）。開いている間は、登録・所持パルが変わるたびに行を合わせる（同じ行は作り直さない）
  let goalsModal = null;
  let goalsClose = null;
  const goalsWarning = storageWarning('目標');
  const goalsList = el('ul', 'ideal-goal-list');
  function openGoals() {
    if (!ideals || goalsModal) return;
    goalsModal = openDialog('目標', { className: 'ideal-goals-dialog', onClose: () => { goalsModal = null; goalsClose = null; clearList(goalsList); } });
    // 見出しの横に「この端末だけ」（目標はこの端末にだけ残る。設定の「この端末のデータ」と同じ印）
    const header = goalsModal.dialog.querySelector('header');
    header?.insertBefore(statusChip('この端末だけ', 'neutral', 'device-only-chip'), header.children[1] ?? null);
    goalsClose = button('閉じる', goalsModal.close, 'button secondary');
    goalsModal.body.append(goalsWarning, migrationNote, goalsReason, goalsList);
    goalsModal.footer.append(goalsClose);
    renderGoals();
  }
  function removeGoal(goal) {
    const key = ideals.scope();
    const removed = ideals.remove(goal.id, key);
    if (!removed) {
      if (context.store.state.renaming) toast('ID の変更が終わってから外してください');
      return;
    }
    toast(`「${goal.name}」を目標から外しました`, {
      action: () => { if (!ideals.restore(removed.goal, removed.index, key, removed.observation)) toast('元に戻せませんでした', { kind: 'error' }); },
    });
  }
  // 1 行（列: パル・名前〔パルだけの目標はタグ〕・配合と所持／パッシブ／条件の要約／状態〔と「設定で選ぶ」〕／呼び出す・外す）。
  // 保存した目標の中身は変わらないので、update は状態と配合・所持の数だけ
  function goalRow({ goal, status, facts }) {
    const row = el('li', 'ideal-goal');
    const title = el('div', 'ideal-goal-title');
    const nameCell = el('div', 'ideal-goal-name');
    nameCell.append(el('strong', '', goal.name));
    // 名前の右に属性のアイコン（game-assets）
    for (const element of palsById.get(goal.palId)?.el ?? []) nameCell.append(elementIcon(element));
    if (isSpeciesGoal(goal)) nameCell.append(statusChip('パルだけ', 'info', 'ideal-goal-tag'));
    // 配合の登録（画面のデータの登録済みの数。押すと配合を探すでその子）と、所持パルがあれば所持の数（親になれる数）
    const records = link('', buildHash('search', { c: goal.palId }), 'ideal-goal-records');
    records.addEventListener('click', () => goalsModal?.close());
    const holding = el('span', 'ideal-goal-holding');
    const facts1 = el('div', 'ideal-goal-facts');
    facts1.append(records, holding);
    nameCell.append(facts1);
    // 絵だけ（36px。目標の名前にパル名が入るので、名前を 2 回出さない。I-22）
    const master = palsById.get(goal.palId);
    title.append(master ? palIcon(master) : el('span', 'muted', goal.palId), nameCell);
    const state = statusChip('', 'neutral', 'ideal-goal-status');
    const stateCell = el('div', 'ideal-goal-state');
    // 完成済みは、状態を押すと所持パルでその個体を開く（目標の種族とパッシブ・タマゴ以外の全部の場所。I-25）
    const found = link('', goalOwnedHash(goal), 'ideal-goal-found');
    found.title = '所持パルで完成した個体を見る';
    found.addEventListener('click', () => goalsModal?.close());
    const gap = el('small', 'ideal-goal-gap');
    stateCell.append(state, gap);
    const recall = link('呼び出す', goalHash(goal), 'button secondary small');
    // 一覧を合わせ直しても、押した「呼び出す」にフォーカスを戻す（ui/dom.js の syncList・ui/focus.js）
    recall.setAttribute('data-focus-key', `goal:${goal.id}`);
    recall.setAttribute('data-focus', 'recall');
    // ダイアログは画面の遷移で閉じないので、呼び出したら閉じる（リンクの遷移はそのまま進む）
    recall.addEventListener('click', () => goalsModal?.close());
    const remove = actionIcon(`「${goal.name}」を目標から外す`, 'remove', () => removeGoal(goal), 'danger-text');
    remove.setAttribute('data-focus', 'remove');
    row.append(title, goal.passives.length ? passiveList(goal.passives, { compact: true }) : el('span', 'muted', '—'),
      el('small', 'muted ideal-goal-summary', goalSummary(goal)), stateCell, recall, remove);
    const update = (item) => {
      const recordText = item.facts.records ? `配合: 登録済み ${item.facts.records} 件 →` : '配合: 未登録';
      if (records.textContent !== recordText) records.textContent = recordText;
      const holdText = item.facts.holding;
      if (holding.textContent !== holdText) holding.textContent = holdText;
      holding.hidden = !holdText;
      row.classList.toggle('done', item.status.done);
      // 手術で完成できる（implants）は完成済みと未完成の間の色（info）
      setChipTone(state, item.status.done ? 'ready' : item.status.surgery ? 'info' : item.status.unknown ? 'warning' : 'neutral');
      if (state.textContent !== item.status.text) state.textContent = item.status.text;
      // 完成済みは状態のピルをリンクの中へ（押すと所持パル）。それ以外はふつうのピル
      if (item.status.done && state.parentElement !== found) { found.append(state); stateCell.insertBefore(found, gap); }
      if (!item.status.done && state.parentElement === found) { stateCell.insertBefore(state, found); found.remove(); }
      // リンクの名前に行き先を入れる（見た目は状態のピル）
      if (item.status.done) found.setAttribute('aria-label', `${item.status.text}（所持パルで見る）`);
      // 差は項目ごとに折らない（「·」の所でだけ折る）。手術で完成できる個体の 1 行は長いので、項目の中でも折る（is-surgery）
      gap.classList.toggle('is-surgery', Boolean(item.status.surgery));
      const gapText = item.status.gap ?? '';
      if (gap.textContent !== gapText) {
        gap.replaceChildren(...gapText.split(' · ').filter(Boolean).flatMap((part, i) => [...(i ? [el('span', 'ideal-goal-gap-sep', ' · ')] : []), el('span', 'ideal-goal-gap-part', part)]));
      }
      gap.hidden = !gapText;
    };
    update({ status, facts });
    return { element: row, update };
  }
  // 所持の数（目標の種族の全数と親になれる数）は所持パルのデータごとに 1 回だけ数える
  let countsFor = null;
  let counts = null;
  const holdingOf = (palId) => {
    const data = owned?.state?.owned;
    if (data !== countsFor) {
      countsFor = data;
      counts = Array.isArray(data?.pals) ? ownedCounts(data.pals) : null;
    }
    if (!counts) return '';
    const entry = counts.get(palId);
    return entry ? `所持 ${entry.total} 体（親になれる ${entry.male + entry.female}）` : '所持 0 体';
  };
  // 「未確認」の理由と行き先（表の上に 1 回だけ。自分のプレイヤーが分からない → このワールドでの自分、所持パルのデータがない → セーブ連携。C-06）
  const goalsReason = el('p', 'ideal-goals-reason');
  goalsReason.setAttribute('role', 'status');
  const reasonText = el('span');
  const reasonAction = link('', '#/settings', 'button secondary small ideal-goal-action');
  // ダイアログは画面の遷移で閉じないので、押したら閉じる（リンクの遷移はそのまま進む。ベルの通知と同じ）
  reasonAction.addEventListener('click', () => goalsModal?.close());
  goalsReason.append(reasonText, reasonAction);
  goalsReason.hidden = true;
  // 前のウィッシュリストを移せていないときの 1 行と、読み取り専用の一覧
  const migrationNote = el('p', 'ideal-goal-migration');
  migrationNote.setAttribute('role', 'status');
  const migrationText = el('span');
  const legacyButton = button('旧ウィッシュリストを見る', () => openLegacyWishes(), 'button secondary small');
  migrationNote.append(migrationText, legacyButton);
  migrationNote.hidden = true;
  function openLegacyWishes() {
    const wishes = ideals.legacyWishes();
    const modal = openDialog('旧ウィッシュリスト（読み取り専用）', { className: 'ideal-legacy-dialog' });
    const list = el('ul', 'ideal-legacy-list');
    const index = context.store.state.index;
    for (const wish of wishes) {
      const item = el('li', 'ideal-legacy-item');
      const made = index ? findByChild(index, wish.palId).length : 0;
      item.append(palsById.has(wish.palId) ? palTile(wish.palId, { clickable: false }) : el('span', 'muted', wish.palId),
        el('span', 'muted', made ? '配合あり' : '未登録'));
      list.append(item);
    }
    modal.body.append(el('p', 'muted', '目標に移せていないパルも含めた、前のウィッシュリストです。ここでは追加・削除はできません。'),
      wishes.length ? list : el('p', 'muted', '旧ウィッシュリストは空です。'));
    modal.footer.append(button('閉じる', () => modal.close(), 'button secondary'));
  }
  function renderGoals() {
    if (!ideals) return;
    const goals = ideals.list();
    // 完成の数（表示しているワールドで完成済みの目標。レールの「完成 n」と同じ数え方）。自分のプレイヤー・所持パルが分からない（未確認）ときは出さない
    const doneWorld = ownedWorldId(owned?.state?.meta?.worldId);
    const mine = ideals.mine();
    const doneCount = doneWorld && mine && goals.length ? goals.filter((goal) => goal.worlds?.[doneWorld]?.complete).length : null;
    const count = `目標（${goals.length}${doneCount === null ? '' : ` · 完成 ${doneCount}`}）${ideals.saveFailed ? '!' : ''}`;
    if (goalsButton.textContent !== count) goalsButton.textContent = count;
    goalsButton.title = ideals.saveFailed ? 'この端末に保存できませんでした' : '';
    if (!goalsModal) return;
    const title = goalsModal.dialog.querySelector('h2');
    const titleText = `目標（${goals.length} 件${doneCount === null ? '' : ` · 完成 ${doneCount}`}）`;
    if (title && title.textContent !== titleText) title.textContent = titleText;
    goalsWarning.hidden = !ideals.saveFailed;
    const migration = ideals.migration?.() ?? { status: 'none' };
    migrationNote.hidden = !['partial', 'failed'].includes(migration.status);
    migrationText.textContent = migration.status === 'partial'
      ? `ウィッシュリストの ${migration.pending} 件をまだ目標に移せていません（目標が ${GOAL_LIMIT} 件の上限です）。`
      : 'ウィッシュリストを目標に移せませんでした。';
    const pals = ideals.mine();
    const worldId = ownedWorldId(owned?.state?.meta?.worldId);
    const index = context.store.state.index;
    const reason = !goals.length ? null : pals === undefined
      ? { text: '所持パルのデータがないため、完成を確かめられません。', label: 'セーブ連携を開く', href: settingsHash(worldId, 'status') }
      : pals === null ? { text: '自分のプレイヤーが分からないため、完成を確かめられません。', label: '設定で選ぶ', href: settingsHash(worldId, 'self') } : null;
    goalsReason.hidden = !reason;
    reasonAction.hidden = !reason;
    if (reason) {
      if (reasonText.textContent !== reason.text) reasonText.textContent = reason.text;
      if (reasonAction.textContent !== reason.label) reasonAction.textContent = reason.label;
      reasonAction.href = reason.href;
    }
    const rows = goals.map((goal) => ({
      goal, status: goalStatus(goal, pals, owned?.state?.owned?.pals ?? null, owned?.state?.owned ?? null),
      facts: { records: index ? findByChild(index, goal.palId).length : 0, holding: holdingOf(goal.palId) },
    }));
    // 未完成（まだ作るもの）を上に、完成済みは下に薄く（それぞれ保存の新しい順。判断事項 8・I-21）
    const ordered = [...rows.filter((item) => !item.status.done), ...rows.filter((item) => item.status.done)];
    syncList(goalsList, ordered, {
      key: (item) => item.goal.id, create: goalRow, fallbackFocus: goalsClose,
      empty: () => el('li', 'muted ideal-goal-empty', '目標はまだありません。条件を選んで「☆ 目標に保存」を押すか、パル詳細の「☆ 目標に保存」から足すと、完成や配合の登録をベルで知らせます。'),
    });
  }

  element.append(heading, panel, surgeryBand, missingBox, hatchBox, farmStrip, farmBox, results);

  const setPassives = (ids) => {
    const params = new URLSearchParams(current.params);
    if (ids.length) params.set('p', ids.join(','));
    else params.delete('p');
    changeRoute(context, buildHash('ideal', params));
  };

  // 欲しいパッシブの候補の所持数。親の候補にしない個体（タマゴ・グローバルパルボックス）を除き、所持者で絞って数える。
  // 目標を選んでいるときは、目標と登録済みの配合の親の種族（計算が親にする個体）と、ほかの所持パルに分ける（I-49）
  function renderPassives(pals) {
    const candidates = ofHolder((pals ?? []).filter(isParentCandidate));
    const state = context.store.state;
    if (!to || !state.env) {
      passive.update({ selected: passives, counts: passiveCounts(candidates), groups: undefined });
      return;
    }
    const species = new Set(breedingLayouts(state.index, to).flatMap((layout) => [layout.male, layout.female]));
    passive.update({ selected: passives, groups: [
      { label: `${palName(to)}と配合の親が持っているもの`, counts: passiveCounts(candidates.filter((pal) => species.has(pal.palId))) },
      { label: 'ほかの所持パルが持っているもの', counts: passiveCounts(candidates.filter((pal) => !species.has(pal.palId))) },
    ] });
  }

  function noPairs(result) {
    const lines = [];
    // 自分のプレイヤーが分からないときの自分（既定）は「すべて」で計算するので、「自分か分かりません」の文はなくした（D29）
    if (!result.candidates) lines.push(`${palName(to)}の ♂ と ♀（または登録済みの配合で${palName(to)}が産まれる親の組）を所持していません。`);
    else if (result.blocked) {
      lines.push(conditions.cake === 'special' && conditions.mode === 'only' && passives.length < 4
        ? 'スペシャルケーキでは、欲しいパッシブが 4 個未満だと「欲しいものだけ」の子は産まれません。'
        : 'パッシブを持つ親からは、パッシブのない子は産まれません。パッシブを持たない ♂ と ♀ の組がありません。');
    } else lines.push('♂ と ♀ の組を作れる個体がいません。');
    if (holderName()) lines.push(`（所持者を「${holderName()}」に絞っています）`);
    return empty(lines.join(''), result.candidates ? null : missingActions(to), { icon: 'ideal' });
  }
  // 目標のパルを ♂ と ♀ で持っていないときの次の一手: 配合を探すで親を探す・「☆ 目標に登録」（種族だけの目標。作れるようになったら
  // ベルで知らせる。ログインしていなければ出さない。前は「ウィッシュリストに追加」。goals-merge）
  let missingToggle = null;
  function missingActions(target) {
    const actions = el('div', 'empty-actions');
    const reverse = link('配合を探すで親を探す', buildHash('search', { c: target }), 'button secondary');
    actions.append(reverse);
    if (!ideals?.scope?.()) return actions;
    missingToggle?.destroy();
    missingToggle = goalToggle(context, target);
    actions.append(missingToggle.element);
    return actions;
  }

  // 欲しいパッシブを候補のだれも持たないときは、個体値厳選組だけを並べていることを知らせる。
  // そのパッシブを持つ所持パル（別の種族など）から目標へ運ぶ継承ルートも探せる
  // 足りないパッシブを運ぶ継承ルートの最短（目標・そのパッシブ 1 つの ownedRouteStarts の先頭。R-32）。記録・所持パル・目標が同じ間は覚えておく
  //（再計算・10 秒ごとの読み直しで同じデータなら BFS をし直さない）
  let carryMemo = { key: null, map: new Map() };
  function carryOf(id) {
    const state = context.store.state;
    const pals = owned?.state?.owned?.pals ?? null;
    if (!state.graph || !pals) return undefined;
    if (carryMemo.key?.[0] !== state.graph || carryMemo.key?.[1] !== pals || carryMemo.key?.[2] !== to) carryMemo = { key: [state.graph, pals, to], map: new Map() };
    if (!carryMemo.map.has(id)) {
      const [best] = ownedRouteStarts({ graph: state.graph, pals, to, passives: [id], shortestRoute, palOrder: state.index?.palOrder });
      carryMemo.map.set(id, best ?? null);
    }
    return carryMemo.map.get(id);
  }
  // パル手術台の案内の 1 行（implants の X-20）: 「[チップ]: パル手術台で付けられます（[アイコン]使い切りインプラント：神速） · 在庫 4（拠点 1 の箱）」。
  // アイテムのない行は「（インプラント不要）」、インプラント（使い切りでないもの）は 1 個あれば何度でも使える旨を添える。付けられないものは
  //「[チップ]: 手術台では付けられません」。在庫は手元で読んだホストのデータのときだけ（参加者・在庫を読む前のデータは添えない）
  function surgeryItem(id) {
    const entry = implantOf(id);
    const item = el('li', `ideal-surgery-item${entry ? '' : ' is-none'}`);
    item.append(passiveChip(id, { compact: true }));
    if (!entry) {
      item.append(el('span', '', ': 手術台では付けられません'));
      return item;
    }
    item.append(el('span', '', ': パル手術台で付けられます（'));
    if (IMPLANT_ICONS[entry.kind]) item.append(gameIcon(`item/${IMPLANT_ICONS[entry.kind]}.png`, { size: 16, className: 'ideal-surgery-icon' }));
    item.append(el('span', '', `${implantNeed(id)}${entry.kind === 'reusable' ? '。1 個あれば何度でも使えます' : ''}）`));
    const stock = entry.item ? itemStock(owned?.state?.owned, entry.item) : null;
    if (stock) item.append(el('small', 'ideal-surgery-stock', ` · ${stockText(stock)}`));
    return item;
  }
  // 手術で付ける前提で計画しているとき（URL の s。X-22）の結果の上の帯: 「[神速][勇敢] はパル手術台で付ける前提で計画しています。」と、
  // パッシブごとの案内の行（必要なインプラントと在庫）、「手術を含めずに計画する」（s を p に戻す）。同じ内容なら作り直さない（10 秒ごとの読み直しで
  // フォーカスを落とさない）
  let surgeryKey = '';
  function renderSurgeryBand() {
    const show = Boolean(to && surgery.length);
    const stocks = show ? surgery.map((id) => stockText(itemStock(owned?.state?.owned, implantOf(id)?.item ?? ''))).join('|') : '';
    const key = show ? JSON.stringify([to, passives, surgery, stocks]) : '';
    if (key === surgeryKey) return;
    surgeryKey = key;
    surgeryBand.hidden = !show;
    if (!show) { surgeryBand.replaceChildren(); return; }
    const focus = captureFocus(surgeryBand);
    const head = el('p', 'ideal-surgery-head');
    head.append(passiveList(surgery, { compact: true }), el('span', '', ' はパル手術台で付ける前提で計画しています。'));
    const back = link('手術を含めずに計画する', buildHash('ideal', { to, p: [...passives, ...surgery].join(',') }), 'ideal-surgery-back');
    back.title = '手術で付ける分も欲しいパッシブに戻して、配合だけで計画します';
    back.setAttribute('data-focus-key', 'surgery-back');
    head.append(back);
    const list = el('ul', 'ideal-surgery-list');
    list.append(...surgery.map(surgeryItem));
    surgeryBand.replaceChildren(head, list);
    restoreFocus(surgeryBand, focus);
  }
  // renderMissing で描いたときの s（s だけが変わると計画は同じなので、案内のリンクだけを描き直す。renderResults）
  let missingSurgery = null;
  function renderMissing(result) {
    missingSurgery = surgery.join(',');
    missingBox.replaceChildren();
    if (!result?.missing.length) {
      // 欲しいパッシブが 2 つ以上でどれも候補にいるときは、継承ルートで運ぶ（目標とパッシブを写した明示のリンク。I-58）
      if (result && to && passives.length >= 2) {
        const cross = link('継承ルートで運ぶ →', buildHash('route', { to, p: passives.join(',') }), 'ideal-route-cross');
        cross.title = '同じ目標とパッシブで継承ルートを開く';
        cross.setAttribute('data-focus-key', 'route-cross');
        missingBox.append(cross);
      }
      return;
    }
    const listed = result.total ? 'いまは個体値厳選組だけを出しています。' : '';
    const warning = el('p', 'ideal-warning');
    warning.append(passiveList(result.missing, { compact: true, focusable: true }), el('span', '', ` を持つ親の候補がいません。${listed}`));
    missingBox.append(warning);
    // パル手術台の案内（implants の X-20）: 足りないパッシブごとに、手術台で付けられるか・必要なインプラント・在庫（「別に手に入れてください」で
    // 止めない）。付けられる分があれば、それを除いた計画へのリンク（X-22。計画の既定は配合だけ〔判断事項 3〕なので、リンクで移るだけ）
    const surgeryList = el('ul', 'ideal-surgery-list');
    surgeryList.append(...result.missing.map(surgeryItem));
    missingBox.append(surgeryList);
    const implantable = result.missing.filter(canImplant);
    if (implantable.length) {
      const names = implantable.map((id) => passivesById.get(id)?.ja ?? id).join('・');
      const plan = link(`手術で付ける分（${names}）を除いて計画する →`,
        buildHash('ideal', { to, p: passives.filter((id) => !implantable.includes(id)).join(','), s: [...surgery, ...implantable].join(',') }), 'ideal-surgery-plan');
      plan.title = '欲しいパッシブから手術で付ける分を外して、配合の計画を立て直します（目標の条件は変えません）';
      plan.setAttribute('data-focus-key', 'surgery-plan');
      missingBox.append(plan);
    }
    // 運ぶ継承ルート（route-progress の R-32）は今までどおり並べる（手術と運ぶの両方を比べられる）
    const actions = el('div', 'ideal-missing');
    // ボタンの中に小さなチップ（チップの title と重ならないよう、ボタンには title を付けない）。所持パルから運べれば最短の回数と開始を添え、
    // 運べなければリンクにせず文字だけ（R-32）。所持パルのデータ・記録がまだなければ今までどおりのリンク
    for (const id of result.missing) {
      const carry = carryOf(id);
      if (carry === null) {
        const none = el('span', 'ideal-carry is-none');
        none.append(passiveChip(id, { compact: true }), el('span', '', ': 所持パルから運べません'));
        actions.append(none);
        continue;
      }
      const action = link('', buildHash('route', { to, p: id }), 'button secondary ideal-carry');
      action.setAttribute('data-focus-key', `carry:${id}`);
      const via = carry && carry.length ? `（最短 ${carry.length} 回・開始 ${palsById.get(carry.palId)?.ja ?? carry.palId}）` : '';
      action.append(passiveChip(id, { compact: true }), el('span', '', `を運ぶ継承ルート${via}`));
      actions.append(action);
    }
    missingBox.append(actions);
  }

  // 牧場の行の個体（絵・名前と性別・個体値。passives なら小さなパッシブのチップも）。同じ種族の 2 体は個体値で見分ける
  const talentLine = (pal) => `HP ${pal.talent.hp}・攻 ${pal.talent.shot}・防 ${pal.talent.defense}`;
  // 性別は文字の ♂♀ の色だけ（牧場の行・帯の小さな絵の横。丸い地は置かない）。分からなければ何も置かない
  const genderOf = (pal) => [genderMark(pal.gender, { inline: true })].filter(Boolean);
  function farmPal(pal, { passives = false } = {}) {
    const node = el('span', 'ideal-farm-pal');
    const name = el('span', 'ideal-farm-pal-name');
    name.append(el('strong', '', pal.name), ...genderOf(pal));
    node.append(palIcon(palsById.get(pal.palId)), name, el('small', 'ideal-farm-talent', talentLine(pal)));
    if (passives && pal.passives.length) node.append(passiveList(pal.passives, { compact: true }));
    return node;
  }
  // 入れる・外す個体の持ち主（拠点のパルは預けた人）
  const ownerText = (pal) => (pal.place === 'base' ? (pal.lastOwner ? `${pal.lastOwner} が預けた` : pal.holder) : pal.holder);

  // 配合牧場の情報（今のデータの牧場から。計算の後に読み直したデータで描くときも、ここから求め直す）。牧場の情報がなければ null。
  // 名前は全体の牧場で A／B を付け（I-27）、使用中の印は所持者で絞る前の親の候補で決める（I-32）。
  // 読めない牧場がある・共有で牧場が一部だけ（farmsPartial。farm-data）なら complete: false で、交換推奨・空き牧場・使用中の判定を保留する。
  // タマゴの中身だけを省いた共有では保留しない。牧場の数の分からない古い形の共有（farmsCounted: false）では、親のない牧場が読めない牧場かも
  // しれないので、空き牧場だけを数えない
  function farmContext(data, layouts) {
    const all = Array.isArray(data?.farms) ? data.farms : null;
    if (!all) return null;
    const labels = new Map((data.bases ?? []).map((base) => [base.id, base.label]));
    const { complete, uncertain, partial } = farmCompleteness(all, { partial: data.farmsPartial === true });
    const own = complete ? targetFarms(all, (data.pals ?? []).filter(isParentCandidate), layouts) : [];
    return {
      names: farmNames(all, (baseId) => labels.get(baseId) ?? ''), complete, uncertain, partial,
      inUse: complete ? farmsInUse(all, new Set(own.map((farm) => farm.id))) : new Map(),
      empties: complete && data.farmsCounted !== false ? emptyFarms(all) : [],
      baseLabel: (baseId) => labels.get(baseId) || '拠点',
      // 牧場 ID → ケーキ（[{ itemId, count }]。ホストの画面だけ。共有・ケーキを読む前のセーブは null。save-extras）
      cakes: new Map(all.map((farm) => [farm.id, farm.cakes ?? null])),
    };
  }

  // 牧場の判定の文（詳細の行のチップ・帯の短い文）と、押したときに移る組の順位（移る組がなければ -1）。
  // 「そのまま」で上から K 組（size）より下か一覧にない組は、交換を見送った牧場（skipped。ideal-calc）。
  // 一覧にない「そのまま」はチップに「（おすすめにない組）」（D30。前はチップの下の行に「おすすめの一覧にない組 · 完成まで 平均 約 N 個」〔D15〕）
  function farmState(item, size) {
    const listed = item.rank >= 0;
    if (item.status === 'swap') return { chip: `交換推奨 → おすすめ ${item.to + 1} 番`, short: `⇄ ${item.to + 1} 番へ`, target: item.to, skipped: false };
    if (item.status === 'keep') {
      return { chip: listed ? `そのまま（おすすめ ${item.rank + 1} 番）` : 'そのまま（おすすめにない組）', short: listed ? `✓ ${item.rank + 1} 番` : '✓ そのまま',
        target: item.rank, skipped: !listed || item.rank >= size };
    }
    return { chip: listed ? `おすすめ ${item.rank + 1} 番（ほかに置く組がありません）` : 'おすすめにない組（ほかに置く組がありません）',
      short: listed ? `— ${item.rank + 1} 番` : '—', target: item.rank, skipped: false };
  }

  // 空き牧場に案内する組（D16）: 判定のあとの置き場（そのままの牧場の今の組・交換先の組・置く組のない牧場に残る個体）に使う個体を除き、
  // おすすめを上から見て、♂・♀ のどちらも使っていない組を空きの数だけ（選んだ組どうしも個体を重ねない）
  function emptyPicks(advice, pairs, count) {
    const used = new Set();
    for (const item of advice) {
      const { male, female } = item.farm;
      if (item.status === 'swap') [pairs[item.to].male, pairs[item.to].female].forEach((pal) => used.add(pal.id));
      else if (item.status === 'keep') [male, female].forEach((pal) => used.add(pal.id));
      else [male, female].filter((pal) => !item.out.some((out) => out.id === pal.id)).forEach((pal) => used.add(pal.id));
    }
    const picks = [];
    pairs.forEach((pair, rank) => {
      if (picks.length >= count || used.has(pair.male.id) || used.has(pair.female.id)) return;
      picks.push(rank);
      used.add(pair.male.id);
      used.add(pair.female.id);
    });
    return picks;
  }

  // 帯の 1 か所: [牧場の名前][♂の絵]＋[♀の絵]→[✓ 2 番｜✓ そのまま｜⇄ 1 番へ｜—]。移る組がなければ押せない（D15）。
  // 絵の「♂＋♀」は読ませず、見た目は隠した文で「（名前♂＋名前♀）」と読ませる（押せないセルは aria-label がないので、どの組か分かるように）。
  // 親の組の記号は用語表の「＋」（copy-dead-ends。前は「×」）
  function stripCell({ item, name, state, key }) {
    const cell = key ? button('', () => jumpTo(key), `ideal-farm-cell ${item.status}`) : el('div', `ideal-farm-cell ${item.status} is-static`);
    if (key) cell.setAttribute('data-focus-key', `farm-cell:${item.farm.id}`);
    const pals = el('span', 'ideal-farm-cell-pals');
    pals.setAttribute('aria-hidden', 'true');
    [item.farm.male, item.farm.female].forEach((pal, index) => {
      if (index) pals.append(el('span', 'ideal-farm-cell-x', '＋'));
      const cellPal = el('span', 'ideal-farm-cell-pal');
      cellPal.append(palIcon(palsById.get(pal.palId)), ...genderOf(pal));
      pals.append(cellPal);
    });
    const arrow = el('span', 'ideal-farm-cell-arrow', '→');
    arrow.setAttribute('aria-hidden', 'true');
    cell.append(el('span', 'ideal-farm-cell-name', name), pals, el('span', 'visually-hidden', `（${item.farm.male.name}♂＋${item.farm.female.name}♀）`),
      arrow, el('span', 'ideal-farm-cell-state', state.short));
    const label = `${name}（${item.farm.male.name}♂＋${item.farm.female.name}♀）: ${state.chip}`;
    cell.title = label;
    if (key) cell.setAttribute('aria-label', `${label}。押すとその組へ移ります`);
    return cell;
  }
  // 判定を保留している理由（読めない牧場・共有で牧場が一部だけ）。because は「〜ため」に続ける形
  const pendingReason = (farm, { because = false } = {}) => (farm.uncertain
    ? `読めない牧場が ${farm.uncertain} か所${because ? 'ある' : 'あります'}`
    : `共有の上限で牧場の情報が一部${because ? 'の' : 'です'}`);
  // 帯の中身（高さは固定）。保留中は理由の 1 行。この目標の組を置いた牧場がなければ帯を出さない（D30。空き牧場の数は詳細の 1 行に出る）
  function renderStrip({ farm, rows, pending }) {
    farmStrip.replaceChildren();
    farmStrip.hidden = !farm || (!pending && !rows.length);
    if (farmStrip.hidden) return;
    if (pending) {
      farmStrip.append(el('span', 'ideal-farm-strip-note is-pending', `牧場の判定を保留（${pendingReason(farm)}）`));
      return;
    }
    farmStrip.append(...rows.slice(0, STRIP_FARMS).map(stripCell));
    if (rows.length > STRIP_FARMS) {
      // 残りの牧場は詳細にあるので、閉じていれば開いてから移る
      const more = button(`ほか ${rows.length - STRIP_FARMS} か所`, () => {
        openFarms();
        farmBox.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
      }, 'ideal-farm-more');
      more.setAttribute('data-focus-key', 'farm-more');
      farmStrip.append(more);
    }
  }

  // 交換推奨の 2×2 の小表（列: 今／交換後、行: ♂／♀）。入れ替わる行のセルに印（is-changed）
  function swapTable(item, next) {
    const table = el('table', 'ideal-farm-swap');
    const head = el('tr');
    for (const text of ['', '今', '交換後']) {
      const cell = el('th', '', text);
      cell.setAttribute('scope', 'col');
      head.append(cell);
    }
    const thead = el('thead');
    thead.append(head);
    const body = el('tbody');
    for (const [label, now, after] of [['♂', item.farm.male, next.male], ['♀', item.farm.female, next.female]]) {
      const changed = now.id !== after.id;
      const line = el('tr');
      const title = el('th', '', label);
      title.setAttribute('scope', 'row');
      line.append(title);
      for (const pal of [now, after]) {
        const cell = el('td', changed ? 'is-changed' : '');
        cell.append(farmPal(pal));
        line.append(cell);
      }
      body.append(line);
    }
    table.append(thead, body);
    return table;
  }
  // 外す・入れる個体（1 行 1 体。持ち主・場所・パッシブ。自分の個体は太字、別の配合牧場で使っている個体に印）
  function moveList(outs, ins, { mine, marks }) {
    const list = el('ul', 'ideal-farm-moves');
    const line = (pal, kind) => {
      const item = el('li', `ideal-farm-move ${kind}${mine.has(pal.id) ? ' is-mine' : ''}`);
      item.append(el('span', 'ideal-farm-move-label', kind === 'in' ? '入れる' : '外す'), farmPal(pal),
        el('span', 'ideal-farm-owner', ownerText(pal)), el('span', 'ideal-farm-place', pal.placeLabel));
      if (pal.passives.length) item.append(passiveList(pal.passives, { compact: true }));
      for (const mark of marks(pal)) item.append(el('span', 'owned-badge badge-mark', mark));
      return item;
    };
    list.append(...outs.map((pal) => line(pal, 'out')), ...ins.map((pal) => line(pal, 'in')));
    return list;
  }
  // 詳細の 1 行（牧場の名前・今の 2 体・状態のチップ）。移る組があれば行（の上の段）を押すとその組へ移る
  function farmRow({ item, name, state, key }, view) {
    const { pending } = view;
    const status = pending ? 'pending' : item.status;
    const row = el('li', `ideal-farm ${status}`);
    const main = key && !pending ? button('', () => jumpTo(key), 'ideal-farm-main') : el('div', 'ideal-farm-main');
    if (key && !pending) main.setAttribute('data-focus-key', `farm-row:${item.farm.id}`);
    const pair = el('span', 'ideal-farm-pair');
    pair.append(farmPal(item.farm.male, { passives: true }), el('span', 'ideal-farm-x', '＋'), farmPal(item.farm.female, { passives: true }));
    main.append(el('strong', 'ideal-farm-name', name), pair, el('span', `ideal-farm-status ${status}`, pending ? '判定を保留' : state.chip));
    // 交換を見送った「そのまま」（D15）は、チップの横に理由
    if (!pending && state.skipped) main.append(el('span', 'ideal-farm-reason', '入れ替えても全体の速さの目安が上がりません'));
    row.append(main);
    // その牧場のケーキの残り（ホストの画面だけ。0 個なら「ケーキ切れ」。save-extras）
    const cakes = cakeLine(view.farm?.cakes?.get(item.farm.id), { className: 'ideal-farm-cakes' });
    if (cakes) row.append(cakes);
    if (pending) return row;
    if (item.status === 'swap') row.append(swapTable(item, view.pairs[item.to]), moveList(item.out, item.in, view));
    else if (item.status === 'none' && item.out.length) {
      row.append(el('small', 'ideal-farm-reason', '外す個体は、ほかの牧場の交換推奨に使います'), moveList(item.out, [], view));
    }
    const doubtful = view.doubtful(item);
    if (doubtful.length) {
      row.append(el('small', 'ideal-warning', `⚠ ${doubtful.join('と')}は、同じ組み合わせで別の子も登録されています。どちらかの登録が間違っている可能性があるので、速さでは比べず、おすすめの順で判定しています。`));
    }
    return row;
  }
  // 空き牧場の案内（I-29・D16。仲間の拠点の牧場も含むので、勧める程度の文）。番号は押すとその組へ移る
  function emptyNote(view) {
    const { empties, picks, farm, pairs } = view;
    const note = el('p', 'ideal-farm-empty');
    const bases = [...new Set(empties.map((item) => farm.baseLabel(item.baseId)))];
    note.append(el('span', '', `空き ${empties.length} か所（${bases.join('・')}）。`));
    if (!picks.length) {
      note.append(el('span', 'muted', 'おすすめには、牧場に置く組と個体が重ならない組がありません。'));
      return note;
    }
    note.append(el('span', '', '空いた牧場に置くなら おすすめ '));
    picks.forEach((rank, index) => {
      if (index) note.append(el('span', '', '・'));
      const key = planPairKey(pairs[rank].male, pairs[rank].female);
      const pick = button(`${rank + 1} 番`, () => jumpTo(key), 'ideal-farm-pick');
      pick.setAttribute('aria-label', `おすすめ ${rank + 1} 番の組へ移る`);
      // 描き直しで番号が変わっても、同じ組へ移る番号へフォーカスを戻す
      pick.setAttribute('data-focus-key', `farm-pick:${key}`);
      note.append(pick);
    });
    return note;
  }
  // 牧場の詳細（帯の下の通常の流れ。閉じた 1 行の summary が見出し）。中身は「変更あり」の件数・保留の理由・牧場の行・空き牧場の案内。
  // 出すものがなければ details を外して隠す（開閉はそのまま覚えておく。D30 で、閉じた 1 行の場所を残すのをやめた）
  function renderFarmBox(view) {
    const { farm, rows, pending, empties, changed } = view;
    farmBody.replaceChildren();
    farmBox.hidden = !farm || (!rows.length && !empties.length);
    if (farmBox.hidden) {
      farmBox.replaceChildren();
      return;
    }
    // 閉じた 1 行の文は短く（D27）:「配合牧場の詳細（置いている 2 か所・交換推奨 1・空き 2）」。交換推奨・空きは判定できるときだけで、
    // 0 のときは出さない（閉じていても、牧場ごとの判定は上の帯で見える）
    const swaps = pending ? 0 : rows.filter((row) => row.item.status === 'swap').length;
    const counts = [`置いている ${rows.length} か所`];
    if (swaps) counts.push(`交換推奨 ${swaps}`);
    if (empties.length) counts.push(`空き ${empties.length}`);
    const title = `配合牧場の詳細（${counts.join('・')}）`;
    if (farmTitle.textContent !== title) farmTitle.textContent = title;
    // 狭い幅では見出しを省略記号で 1 行に収めるので、全文は title に
    farmHead.title = title;
    if (changed) farmBody.append(el('p', 'ideal-changed-note', `牧場の中身が最後に変わってから、交換推奨の行き先に新しく入った組が ${changed} 組あります（「変更あり」）。`));
    if (pending) farmBody.append(el('p', 'ideal-farm-pending', `${pendingReason(farm, { because: true })}ため、交換推奨・空き牧場・使用中の判定を保留しています`));
    // 目標と関係ない牧場も含めた全部の牧場（右のドロワー。farm-board）
    if (context.drawer) {
      const all = button('全部の牧場を見る', () => context.drawer.open({ kind: 'farms', id: '' }, { opener: all }), 'button secondary small ideal-farms-all');
      all.setAttribute('data-focus-key', 'farms-all');
      farmBody.append(all);
    }
    if (rows.length) {
      const list = el('ul', 'ideal-farm-list');
      list.append(...rows.map((row) => farmRow(row, view)));
      farmBody.append(list);
    }
    if (empties.length) farmBody.append(emptyNote(view));
    if (farmFold.parentElement !== farmBox) farmBox.append(farmFold);
  }

  // 牧場の判定から組へ移る（I-30）。畳まれた組なら開いてから、カードを画面の中ほどへ動かし、1 秒光らせる（動きを減らす設定では色だけ）。
  // 光らせている組は data-key で覚え、その間に結果を作り直しても付け直す（drawPlan）。
  // 動かした後にカードへフォーカスを移す（ページ内リンクの作法。読み上げでもキーボードでも移った先が分かり、Tab はカードの中から続く。
  // ideal-farms では押したボタンに残していたのを、フェーズ 1b・1c の終わりのレビューで変えた）
  const reducedMotion = () => Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const cardOf = (key) => [...results.querySelectorAll('.ideal-pair')].find((card) => card.getAttribute('data-key') === key) ?? null;
  let flash = null;
  function jumpTo(key) {
    const card = cardOf(key);
    if (!card) return;
    const fold = card.parentElement;
    if (fold && String(fold.className).split(' ').includes('ideal-same') && !fold.open) {
      fold.open = true;
      sameState.sameOpen = true;
    }
    card.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    // 動かすのは scrollIntoView に任せる（focus でも動かすと、なめらかな動きを止めて別の位置へ動かしうる）
    card.tabIndex = -1;
    card.focus({ preventScroll: true });
    if (flash) {
      clearTimeout(flash.timer);
      cardOf(flash.key)?.classList.toggle('is-flash', false);
    }
    // 同じカードを続けて押しても光り直すよう、外した後に一度読んでから付け直す（読むと、外した状態が描画に反映される）
    void card.offsetWidth;
    card.classList.add('is-flash');
    flash = { key, timer: setTimeout(() => {
      cardOf(key)?.classList.toggle('is-flash', false);
      flash = null;
    }, FLASH_MS) };
  }

  const holderName = () => {
    const holder = holderNow();
    return holder ? [...holderSelect.children].find((node) => node.value === holder)?.textContent ?? '' : '';
  };
  // 結果の欄を入れ替える。前のカードの札の説明（開いている板）は閉じて片づける
  let cardHints = [];
  function showResults(nodes, hints = []) {
    for (const item of cardHints) item.destroy();
    cardHints = hints;
    results.replaceChildren(...nodes);
  }
  // 登録済みの配合をまだ読み込めていない（読み込み中・失敗して「もう一度読み込む」）。同じ表示なら作り直さない（dataPending）
  function showPending(state) {
    for (const item of cardHints) item.destroy();
    cardHints = [];
    dataPending(results, state, () => context.store.refresh());
  }

  // 同じ見込みの組を畳んだまとまり（開閉は viewState に残す。タブを切り替えても残り、読み込み直すと閉じる）
  const sameState = memory ?? {};
  function sameGroup(short, firstKey) {
    const details = el('details', 'ideal-same');
    details.open = Boolean(sameState.sameOpen);
    details.addEventListener('toggle', () => { sameState.sameOpen = details.open; });
    const head = el('summary', 'ideal-same-summary');
    // 描き直しで作り直しても、同じ組から始まるまとまりの見出しへフォーカスを戻す
    head.setAttribute('data-focus-key', `same:${firstKey}`);
    const title = el('span', 'ideal-same-title');
    head.append(title, el('small', 'ideal-same-reason', short.length
      ? `${short.join('・')}の親が候補にいないため、どの組も同じ見込みです。` : 'どの組も見込みが同じです。'));
    details.append(head);
    let count = 0;
    return {
      element: details,
      add(card) {
        details.append(card);
        title.textContent = `同じ見込みの組 ほか ${++count} 組`;
      },
    };
  }
  // 個体値厳選組が続き、見込みが前の組と同じ組を畳む（I-37）。並びの先頭の 1 組と、牧場の判定が指している組（pointed）は畳まない。
  // 番号は振り直さず、並びも変えない（畳まない組が間に入ったら、まとまりを分ける）。畳んだカードも DOM に残す
  function foldSame(pairs, nodes, pointed, short) {
    const shown = [];
    let group = null;
    pairs.forEach((pair, rank) => {
      if (!(rank > 0 && sameProspect(pairs[rank - 1], pair) && !pointed.has(rank))) {
        group = null;
        shown.push(nodes[rank]);
        return;
      }
      if (!group) {
        group = sameGroup(short, planPairKey(pair.male, pair.female));
        shown.push(group.element);
      }
      group.add(nodes[rank]);
    });
    return shown;
  }

  // 計算中の仕事（区切った計算）と、いま表示している計算の署名（同じなら計算も DOM も触らない）
  let job = null;
  let shownKey = '';
  // 描いている結果（計算に効かない値だけが変わったデータでは、計算し直さずに個体を入れ替えて描き直す）
  let shown = null;
  let destroyed = false;

  // ケーキの提案（D30「ケーキ以外の条件を入れたら、どのケーキだと最速で作成できるかも提案してほしい」）: 目標とケーキ以外の条件
  //（パッシブ・条件・個体値の目標・所持者と候補の個体）が同じ計算ごとに、3 通りのケーキの速さ（core/ideal.js の planSpeed。1 番の
  // 完全体作成組の完成までの平均で、並びと同じ物差し。作れなければ null）を覚え、いちばん早いケーキ（fastestCake。差が 1 割未満なら
  // 手間の少ない方）のケーキの押しボタンに「最速」の印を付ける。押せばそのケーキに切り替わる（押しボタンのまま）。
  // 今の選択の計画を先に出し、ほかのケーキは描いた後に区切って求める（今の計画を計算している間は止め、描いた後に残りから続ける）。
  // 条件が変わったら古い計算を捨てる。覚えるのは新しく使った条件から CAKE_MEMORY 件まで（10 秒ごとの読み直しで、計算に効く値が同じなら計算し直さない）
  const cakeSpeeds = new Map();
  let cakeKey = '';
  let cakeJob = null;
  function speedsOf(key) {
    let speeds = cakeSpeeds.get(key);
    if (speeds) cakeSpeeds.delete(key);
    else speeds = new Map();
    cakeSpeeds.set(key, speeds);
    if (cakeSpeeds.size > CAKE_MEMORY) cakeSpeeds.delete(cakeSpeeds.keys().next().value);
    return speeds;
  }
  function stopCakes() {
    cakeJob?.cancel();
    cakeJob = null;
  }
  // 今の条件の速さが 3 通りそろっていれば印を付ける（そろっていない・作れないときは外す）
  function showFastest() {
    const speeds = cakeKey ? cakeSpeeds.get(cakeKey) : null;
    cakeChoice.badge(speeds ? fastestCake(speeds) : null, { text: '最速', note: CAKE_NOTE });
  }
  // ケーキ以外の条件が変わったら、古い計算を捨てて印を外す（覚えている条件なら、すぐ印を出す）
  function setCakeKey(key) {
    if (key === cakeKey) return;
    cakeKey = key;
    if (cakeJob && cakeJob.key !== key) stopCakes();
    showFastest();
  }
  // 描いた計画の速さを覚え、まだ分からないケーキを区切って求める（今の計画を計算している間は始めない）。
  // spent は同じ処理の中で先に使った時間（最初の区切りと合わせて 1 区切りに収める。分からなければ最初の区切りはすぐ返す）
  function compareCakes(plan, result, spent = Infinity) {
    if (destroyed || !plan.cakeKey || plan.cakeKey !== cakeKey || job) return;
    const speeds = speedsOf(plan.cakeKey);
    speeds.set(plan.cake, planSpeed(result));
    // 欲しいパッシブを候補のだれも持たなければ、どのケーキでも完全体作成組はできない（計算しない）
    if (result.missing.length) for (const [cake] of CAKES) speeds.set(cake, null);
    const rest = CAKES.map(([cake]) => cake).filter((cake) => !speeds.has(cake));
    if (!rest.length || cakeJob?.key === plan.cakeKey) {
      showFastest();
      return;
    }
    stopCakes();
    const steps = cakeSpeedSteps(plan.cakeInput, rest, (cake, speed) => speeds.set(cake, speed));
    const run = startSliced(steps, { budget: sliceBudget, firstBudget: Number.isFinite(sliceBudget) ? Math.max(0, sliceBudget - spent) : sliceBudget });
    if (run.done) {
      showFastest();
      return;
    }
    const current = { key: plan.cakeKey, cancel: run.cancel };
    cakeJob = current;
    finishCakes(current, run.promise);
  }
  async function finishCakes(current, promise) {
    try {
      await promise;
    } catch (error) {
      if (cakeJob === current) cakeJob = null;
      throw error;
    }
    if (destroyed || cakeJob !== current) return;
    cakeJob = null;
    showFastest();
  }
  function setComputing(on) {
    results.classList.toggle('is-computing', on);
    if (on) results.setAttribute('aria-busy', 'true');
    else results.removeAttribute('aria-busy');
  }
  // 結果を出さないとき（データがない・読み込み中など）は、前の判定を残さず、次に条件がそろったら必ず計算する
  function clearPlan() {
    job?.cancel();
    job = null;
    shownKey = '';
    shown = null;
    setComputing(false);
    setCakeKey('');
    renderHolding(null);
    clearFarms();
  }
  // 足りないパッシブの案内・牧場の帯と詳細を出さない（帯と詳細は場所も取らない）
  function clearFarms() {
    missingBox.replaceChildren();
    farmStrip.replaceChildren();
    farmStrip.hidden = true;
    farmBox.replaceChildren();
    farmBox.hidden = true;
  }

  function renderResults() {
    // 閉じた後に遅れて呼ばれたとき（間引いた入力など）は、計算を始めない
    if (destroyed) return;
    const started = clock();
    renderSave();
    renderSurgeryBand();
    const state = context.store.state;
    const pals = owned?.state?.owned?.pals ?? null;
    renderHatch(pals, pals ? ofHolder(pals) : null);
    if (!pals) {
      clearPlan();
      // データがなければ 1 文と行き先（セーブ連携。登録したワールドがあれば、その行を開く）
      showResults([owned && !owned.state.ready ? loadingState('所持パルを読み込み中…')
        : empty('所持パルのデータがありません。', link('セーブ連携を開く', settingsHash(owned?.state?.linkedWorldId ?? '', 'status'), 'button secondary'), { icon: 'ideal' })]);
      return;
    }
    if (!to) { clearPlan(); showResults([empty('目標のパルを選んでください。')]); return; }
    if (!state.env) { clearPlan(); showPending(state); return; }
    const candidates = ofHolder(pals);
    // 配合牧場の中身（ホストのセーブ、または共有されたもの。牧場を共有する前のデータにはない）。
    // 今の牧場の組を計画で優先・見張るので、計画より先に求める
    const farms = owned?.state?.owned?.farms;
    const layouts = breedingLayouts(state.index, to);
    const placedFarms = Array.isArray(farms) ? targetFarms(farms, candidates.filter(isParentCandidate), layouts) : [];
    const signature = farmSignature(placedFarms);
    const memoryId = JSON.stringify([state.env ?? '', owned?.state?.meta?.worldId ?? '', to, [...passives].sort(), conditions.mode,
      TALENT_KEYS.map((key) => conditions.targets[key]), conditions.cake, holderNow()]);
    const baseline = Array.isArray(farms) ? planMemory.get(memoryId) : null;
    const placedKeys = new Set(placedFarms.map((farm) => planPairKey(farm.male, farm.female)));
    // 物差しが同じ組どうしでは、今の牧場の組と前の基準の上位を先にする（値の小さな差で交換推奨や「変更あり」が出ないように）
    const prefer = { placed: placedKeys, baseline: new Set(baseline?.farms === signature ? baseline.pairs.slice(0, placedFarms.length) : []) };
    // 計算の署名: 配合の index・候補の個体の計算に効く値・実効の条件・本人・牧場の署名・優先する組。
    // prefer は並びを変えるので、入れないと、別のタブが基準を書き換えたときなどに古い並びが残る。
    // 本人は自分の個体の並びと identityKey（表示しているワールドと自分のプレイヤー。自分の個体の太字・空き牧場の案内に効く）。
    // 本人を変えたときだけ計算し直し、10 秒ごとの読み直しで同じなら計算しない
    const holder = holderNow();
    const self = holder === 'mine' ? (ideals?.mine()?.map((pal) => pal.id).join(',') ?? 'unknown') : '';
    const identity = ideals?.identityKey?.() ?? '';
    const species = new Set(layouts.flatMap((layout) => [layout.male, layout.female]));
    const candidateKey = candidateSignature(candidates, species);
    const key = `${JSON.stringify([state.revision ?? null, objectRev(state.index), state.env, to, [...passives].sort(),
      conditions.mode, TALENT_KEYS.map((name) => conditions.targets[name]), conditions.cake, holder, self, identity, signature,
      [...prefer.placed].sort(), [...prefer.baseline].sort()])}\u0003${candidateKey}`;
    // ケーキの提案の鍵: 計算の署名からケーキと牧場（優先・見張り）を除いたもの（ケーキを切り替えても変わらない）
    const nextCakeKey = `${JSON.stringify([state.revision ?? null, objectRev(state.index), state.env, to, [...passives].sort(),
      conditions.mode, TALENT_KEYS.map((name) => conditions.targets[name]), holder, self])}\u0003${candidateKey}`;
    setCakeKey(nextCakeKey);
    // 同じ計算をしている途中（計算に効かない値だけが変わった）。終わって描くときに、新しいデータの個体に入れ替える
    if (job?.key === key) return;
    // 出している結果と同じ条件に戻った（計算している途中なら、その計算は捨てる）。データだけが変わっていれば個体を入れ替えて描き直す
    if (key === shownKey) {
      job?.cancel();
      job = null;
      setComputing(false);
      if (shown) {
        drawLatest(shown);
        // s（手術で付ける前提のパッシブ）だけが変わった（計画は同じ）ときは、足りないパッシブの案内（「手術で付ける分を除いて計画する」の
        // リンクの s）だけを描き直す（implants）
        if (missingSurgery !== surgery.join(',')) {
          const focus = captureFocus(missingBox);
          renderMissing(shown.result);
          restoreFocus(missingBox, focus);
        }
        // 今の計画の計算で止めていたケーキの比べ方を、残りから続ける
        compareCakes(shown.plan, shown.result, clock() - started);
      }
      return;
    }
    job?.cancel();
    job = null;
    // 組の ♂♀ 行で見せる欲しいパッシブと個体値の目標（計算したときの条件。描くのが後になっても同じ条件で見せる）と、
    // 候補のだれも届かないステータス（同じ見込みの組を畳むときの理由。キノコケーキでは目標の 5 下から届く）
    const reach = (key) => Math.max(0, conditions.targets[key] - (conditions.cake === 'talent' ? 5 : 0));
    const parents = candidates.filter((pal) => species.has(pal.palId) && isParentCandidate(pal) && (pal.gender === 'M' || pal.gender === 'F'));
    const short = TALENT_KEYS.filter((name) => conditions.targets[name] > 0 && !parents.some((pal) => pal.talent[name] >= reach(name)))
      .map((name) => `${TALENT_LABELS[name]} ${reach(name)} 以上`);
    // ケーキの比べ方に渡す入力（ケーキ以外は今の計画と同じ）
    const cakeInput = { pals: candidates, index: state.index, target: to, passives: [...passives], mode: conditions.mode, targets: { ...conditions.targets } };
    const plan = {
      placedFarms, signature, memoryId, baseline, farms, layouts, holder, cake: conditions.cake, data: owned.state.owned,
      highlight: { wanted: [...passives], targets: { ...conditions.targets } }, short, cakeKey: nextCakeKey, cakeInput,
    };
    const steps = idealPlanSteps({ ...cakeInput, cake: conditions.cake, limit: LIMIT, prefer, watch: placedKeys });
    // 最初の区切りは、ここまでの下ごしらえ（所持パルが多いと数十 ms）と合わせて 1 区切りに収める
    const run = startSliced(steps, { budget: sliceBudget, firstBudget: Math.max(0, sliceBudget - (clock() - started)) });
    if (run.done) {
      setComputing(false);
      showPlan(run.value, plan);
      shownKey = key;
      compareCakes(plan, run.value, clock() - started);
      return;
    }
    // 終わらなければ、前の結果を残したまま「計算中」にする（高さは変えない）。何も出していなければ「計算中…」を出す。
    // ケーキの比べ方は、今の計画を先に出すために止める（描いた後に残りから続ける）
    stopCakes();
    const current = { key, cancel: run.cancel };
    job = current;
    if (!shownKey) {
      renderHolding(null);
      clearFarms();
      showResults([loadingState('計算中…')]);
    }
    setComputing(true);
    finishPlan(current, run.promise, plan);
  }

  // 区切った計算が終わったら、その仕事がまだ最新のときだけ描く
  async function finishPlan(current, promise, plan) {
    let result;
    try {
      result = await promise;
    } catch (error) {
      if (job === current) { job = null; setComputing(false); }
      throw error;
    }
    if (destroyed || job !== current || result === null) return;
    job = null;
    setComputing(false);
    // 計算している間にデータが読み直されていたら（計算に効かない値だけの変化）、組の個体を新しいデータに入れ替えて描く
    const latest = owned.state.owned !== plan.data ? withLatestPals({ result, plan }) : { result, plan };
    showPlan(latest.result, latest.plan);
    shownKey = current.key;
    compareCakes(latest.plan, latest.result);
  }

  // 結果の組・牧場の個体を、今のデータの同じ ID の個体に入れ替える（計算に効く値は同じなので、組と順位はそのまま）
  function withLatestPals({ result, plan }) {
    const byId = new Map((owned.state.owned?.pals ?? []).map((pal) => [pal.id, pal]));
    const swap = (pal) => byId.get(pal.id) ?? pal;
    return {
      result: { ...result, pairs: result.pairs.map((pair) => ({ ...pair, male: swap(pair.male), female: swap(pair.female) })) },
      plan: { ...plan, data: owned.state.owned, placedFarms: plan.placedFarms.map((farm) => ({ ...farm, male: swap(farm.male), female: swap(farm.female) })) },
    };
  }
  // 画面に出す、データから引く値（組と牧場の個体の行の署名・所持者の名前・全部の牧場〔名前・状態・使用中・空き〕と拠点の名前・足りないパッシブの
  // 手術台の案内に添える在庫〔implants〕）。同じなら描き直さない
  const displayKey = ({ result, plan }) => [...result.pairs.flatMap((pair) => [pair.male, pair.female]), ...plan.placedFarms.flatMap((farm) => [farm.male, farm.female])]
    .map((pal) => rowSignature(pal, [])).concat(holderName(), JSON.stringify([plan.data?.farms ?? null, (plan.data?.bases ?? []).map((base) => [base.id, base.label])]),
      result.missing.map((id) => stockText(itemStock(plan.data, implantOf(id)?.item ?? ''))).join('|'))
    .join('\u0003');
  // 描いている結果を、今のデータの個体で描き直す（データが変わっていて、出す値も変わったときだけ）
  function drawLatest(current) {
    if (owned.state.owned === current.plan.data) return;
    const latest = withLatestPals(current);
    const display = displayKey(latest);
    shown = { ...latest, changed: current.changed, display };
    if (display !== current.display) drawPlan(latest.result, latest.plan, current.changed);
  }

  // 計算の結果を描く。「変更あり」の基準（planMemory）もここで更新する。
  // changed は基準になかった組（交換推奨の行き先で絞る前）。絞るのは drawPlan（判定を保留している間に計算しても、計算し直さずに
  // 読めるようになったとき〔drawLatest〕に絞り直せるように。前は絞った後の空の集合を残し、開き直すまで「変更あり」が戻らなかった）
  function showPlan(result, plan) {
    const { placedFarms, signature, memoryId, baseline, farms } = plan;
    let changed = new Set();
    if (Array.isArray(farms)) {
      const next = planChanges(baseline, signature, result.pairs, placedFarms.length);
      if (next.reset) planMemory.set(memoryId, next.baseline);
      changed = next.changed;
    }
    shown = { result, plan, changed, display: displayKey({ result, plan }) };
    drawPlan(result, plan, changed);
  }

  // 配合牧場の判定。今の牧場の組は見張った物差しから、交換先の組（おすすめの組）は一覧から引く
  function farmAdviceOf(result, placedFarms) {
    const listed = new Map(result.pairs.map((pair) => [planPairKey(pair.male, pair.female), {
      status: 'ok', rank: PLAN_GROUPS.indexOf(pair.group), ambiguous: pair.ambiguous, eggs: pair.eggs, gathered: pair.gathered,
      gatherChance: pair.gatherChance, talentEggs: pair.talentEggs, chance: pair.chance,
    }]));
    const measureOf = (key) => result.measures.get(key) ?? listed.get(key);
    return { measureOf, advice: farmAdvice(placedFarms, result.pairs, { measureOf }) };
  }

  // 要約・所持の状況・足りないパッシブ・配合牧場の判定（帯と詳細）・組のカードを描く。牧場の名前・完全性・使用中・空きは、
  // 描くときのデータ（plan.data。計算の後に読み直したデータ）から求める。読めない牧場があれば判定を保留し、交換推奨・空き牧場・使用中・
  //「変更あり」を出さない（D13。セーブの事実の「配置中」は出す）。
  // 作り直す部品（帯のセル・詳細の行・空き牧場の番号・カードと札・行の部品・畳みの見出し）にあったフォーカスは、描いた後に同じ役目の部品
  //（data-focus-key）へ戻す。10 秒ごとの読み直しや再計算で、キーボードの位置を body に落とさない（開いていた札の説明の板は閉じる）
  function drawPlan(result, plan, changed) {
    const focus = captureFocus(element);
    paintPlan(result, plan, changed, focus);
    restoreFocus(element, focus);
  }
  function paintPlan(result, plan, changed, focus) {
    const { placedFarms, highlight, short = [] } = plan;
    renderHolding(result);
    renderMissing(result);
    const farm = farmContext(plan.data, plan.layouts ?? []);
    const pending = Boolean(farm && !farm.complete);
    const judged = farm && !pending ? farmAdviceOf(result, placedFarms) : null;
    const keyOf = (pair) => planPairKey(pair.male, pair.female);
    const rankOf = new Map(result.pairs.map((pair, rank) => [keyOf(pair), rank]));
    const names = farm?.names ?? new Map();
    const nameOf = (id) => names.get(id) ?? '拠点の牧場';
    // 牧場ごとの判定（保留中は判定せず、今の組の順位だけ）。押したときに移る組のキー（移る組がなければ空）
    const advice = judged?.advice ?? placedFarms.map((item) => ({ farm: item, status: 'keep', rank: rankOf.get(keyOf(item)) ?? -1 }));
    const rows = advice.map((item) => {
      const state = farmState(item, placedFarms.length);
      return { item, name: nameOf(item.farm.id), state, key: state.target >= 0 ? keyOf(result.pairs[state.target]) : '' };
    });
    // 空き牧場は、判定がそろっていて、所持者が「すべて」か自分のときだけ（仲間の拠点の牧場も含む）。D30 で既定の自分でも出すようにした
    //（D29 で既定が自分になり、「すべて」を選ばないと出なくなっていた）。ほかのプレイヤーを選んでいるときは、その人の個体の組を
    // 空き牧場に案内することになるので出さない。組が 1 つもないときも、案内する組がないので出さない（D30。既定の自分で出すようになり、
    // 組のない目標でも詳細の 1 行が出ていた）
    const empties = judged && result.total && (!plan.holder || plan.holder === 'mine') ? farm.empties : [];
    const marks = (pal) => (farm?.inUse.has(pal.id) ? [`別の配合牧場で使用中（${nameOf(farm.inUse.get(pal.id))}）`] : []);
    // 交換推奨の行き先の組に「→ ◯◯へ」の札（D14。境目の線の代わりに、置く組を札で示す）
    const farmTo = new Map(advice.filter((item) => item.status === 'swap').map((item) => [keyOf(result.pairs[item.to]), nameOf(item.farm.id)]));
    // 「変更あり」は、採った交換推奨の行き先の組だけ（D10）。判定を保留している間は交換推奨がないので付けない（D13）
    const shownChanged = judged ? new Set([...changed].filter((key) => farmTo.has(key))) : new Set();
    const view = {
      farm, rows, pending, empties, changed: shownChanged.size, pairs: result.pairs, marks,
      picks: judged ? emptyPicks(judged.advice, result.pairs, empties.length) : [],
      mine: new Set((ideals?.mine() ?? []).map((pal) => pal.id)),
      doubtful: (item) => (judged ? [
        judged.measureOf(keyOf(item.farm))?.ambiguous ? '牧場の組' : '',
        item.status === 'swap' && result.pairs[item.to].ambiguous ? '交換先の組' : '',
      ].filter(Boolean) : []),
    };
    renderStrip(view);
    renderFarmBox(view);
    if (!result.total) { showResults([noPairs(result)]); return; }
    const placed = new Map(placedFarms.map((item) => [keyOf(item), nameOf(item.id)]));
    // 牧場の判定が指している組（そのままの組・交換先の組。保留中は牧場に入っている組）は畳まない
    const pointed = new Set(advice.flatMap((item) => (item.status === 'swap' ? [item.to] : item.rank >= 0 ? [item.rank] : [])));
    const hints = [];
    const nodes = result.pairs.map((pair, rank) => {
      const key = keyOf(pair);
      const card = pairCard(pair, rank, {
        placed: placed.get(key) ?? '', changed: shownChanged.has(key), farmTo: farmTo.get(key) ?? '', highlight, hints, marks,
      });
      // 光らせている途中に作り直したら、新しいカードにも付け直す
      if (flash?.key === key) card.classList.add('is-flash');
      // 組へ移ってカードにフォーカスがあったときは、作り直したカードもフォーカスを受けられるようにする（restoreFocus が戻す）
      if (focus?.key === `card:${key}`) card.tabIndex = -1;
      return card;
    });
    showResults(foldSame(result.pairs, nodes, pointed, short), hints);
  }

  function update() {
    renderHolders();
    // 候補を開いたまま所持パルが変わったら、所持数だけ描き直す（閉じない）
    toPicker.update();
    renderPassives(owned?.state?.owned?.pals);
    renderResults();
    renderGoals();
  }

  // 同じ画面のまま URL が変わったとき（目標・パッシブを選ぶ、戻る・進む、目標のダイアログや通知の「呼び出す」）。
  // 画面を作り直さないので、条件のパネル・開いた候補・条件の入力は残る。
  // 戻る・進むで app.js が履歴のエントリの条件を conditions に入れ直したとき（restored）は、入力欄にも出す
  function applyRoute(next, { restored = false } = {}) {
    const before = `${to}|${passives.join(',')}`;
    const fromGoal = readRoute(next);
    // 保存の板を開いたまま目標・パッシブが変わったら閉じる（前の条件の名前のまま保存しない）
    if (`${to}|${passives.join(',')}` !== before) saveBoard.close();
    if (fromGoal || restored) showConditions();
    if (restored) renderHolders();
    syncPicker(toPicker, to);
    renderPassives(owned?.state?.owned?.pals);
    renderResults();
    openPendingGoals();
  }
  // goals=1 で開いた・来たときは、目標のダイアログを開く（1 回だけ）
  function openPendingGoals() {
    if (!openGoalsLater) return;
    openGoalsLater = false;
    openGoals();
  }

  // 間引いて待っている個体値の入力をすぐ当てる（app.js が、移る前に履歴のエントリへ条件を書く前に呼ぶ）
  const flushInputs = () => talent.flush();
  const pickers = {
    destroy() {
      destroyed = true;
      if (flash) clearTimeout(flash.timer);
      talent.destroy();
      job?.cancel();
      job = null;
      stopCakes();
      toPicker.destroy();
      passive.destroy();
      modeChoice.destroy();
      cakeChoice.destroy();
      saveBoard.destroy();
      for (const item of cardHints) item.destroy();
      stopTracking();
      // ダイアログは画面の遷移で閉じないので、画面を閉じるときに閉じる
      goalsModal?.close();
      missingToggle?.destroy();
    },
  };
  const view = watchView(context.store, element, update, [pickers]);
  openPendingGoals();
  // 保存した目標が変わったら（別のタブ・完成の判定を含む）、目標の数・ダイアログの行・「保存済み」を描き直す
  const unsubscribeGoals = ideals?.subscribe(() => { renderSave(); renderGoals(); passive.update({ presets: passivePresets(ideals) }); }) ?? (() => {});
  if (!owned) return { element, update, applyRoute, flushInputs, destroy() { unsubscribeGoals(); view.destroy(); } };
  let lastOwned = owned.state.owned;
  let lastReady = owned.state.ready;
  const unsubscribe = owned.subscribe((ownedState) => {
    if (ownedState.owned === lastOwned && ownedState.ready === lastReady) {
      // データが同じでも、時間がたって保存が古くなったら「（プレイ中）」を外すため、所持者の選択肢だけ描き直す（save-extras）
      if (!destroyed && onlineKey(ownedState) !== shownOnline) renderHolders();
      return;
    }
    lastOwned = ownedState.owned;
    lastReady = ownedState.ready;
    update();
  });
  // 自分のプレイヤー（ログインの ID・ユーザーの一覧・登録者の対応・このワールドでの自分で決まる）が後から分かった・変わったら、
  // 所持者の選択肢・パッシブの所持数・結果・牧場の判定・目標の一覧を描き直す（既定の自分は、分かるまで「すべて」で計算している。
  // 記録の変更番号が変わらない更新でも気づくように、watchView とは別に見る）。このワールドでの自分は設定や別のタブで変わる（context.self）
  const selfChanged = () => {
    if (!destroyed && selfKey() !== shownSelf) update();
  };
  const stopSelf = context.store.subscribe(selfChanged);
  const stopSelfChoice = context.self?.subscribe?.(selfChanged) ?? (() => {});
  // 開いている間は 10 秒ごとに読み直し、孵化させて受け取ったパルも順位に入れる（views/shared.js の keepRefreshing）。
  // 閉じた後と、タブが裏にある間は読まない（destroyed は区切った計算と同じ印）
  owned.load().then(() => {
    if (!destroyed && globalThis.document?.visibilityState !== 'hidden') return owned.autoRefresh();
  }).catch(() => {});
  const stopRefreshing = keepRefreshing(owned);
  return {
    element, update, applyRoute, flushInputs,
    destroy() { destroyed = true; stopRefreshing(); unsubscribe(); stopSelf(); stopSelfChoice(); unsubscribeGoals(); view.destroy(); },
  };
}
