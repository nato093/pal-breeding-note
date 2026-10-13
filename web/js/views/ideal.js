import { el, empty, link, button, syncList, clearList, trackHeight, formatTime } from '../ui/dom.js';
import { startSliced } from '../ui/slice.js';
import { segmented } from '../ui/segmented.js';
import { createPopover } from '../ui/popover.js';
import { hint } from '../ui/hint.js';
import { dateTime } from '../ui/owned-status.js';
import { openDialog } from '../ui/dialog.js';
import { palPicker } from '../ui/pal-picker.js';
import { palsById, palTile } from '../ui/pal-icon.js';
import { passiveSelector, passivesById, passiveList, passiveChip } from '../ui/passive-picker.js';
import { talentInput } from '../ui/talent-input.js';
import { actionIcon, icons } from '../ui/breeding-card.js';
import { toast } from '../ui/toast.js';
import { goalMatches, palsOfPlayers, GOAL_LIMIT, GOAL_NAME_MAX, GOAL_STATS } from '../core/ideal-goals.js';
import { passiveCounts } from '../core/owned.js';
import { idealPlanSteps, breedingLayouts, isParentCandidate, MAX_WANTED, CAKES, PASSIVE_MODES, TALENT_KEYS, PLAN_GROUPS } from '../core/ideal.js';
import { targetFarms, farmAdvice, farmSignature, planChanges, planPairKey } from '../core/ideal-farms.js';
import { buildHash } from '../router.js';
import { ownedRow, rowSignature } from './owned.js';
import { viewHeading, validId, navigateSelection, changeRoute, watchView, dataPending, syncPicker, syncOptions, ownedSpeciesNotes, passivePresets } from './shared.js';
import { cleanSaved, oneOf, intIn, internalName } from '../core/boundary.js';

// 一度に出す組の数（条件に合う組がもっと多いときは、件数だけを出す）
const LIMIT = 20;
const TALENT_LABELS = { hp: 'HP', shot: '攻撃', defense: '防御' };
// 条件のパネルの押しボタンの短いラベル（長い説明は core/ideal.js の PASSIVE_MODES・CAKES の文を title に出す）
const MODE_LABELS = { include: '全部持つ', only: 'だけ' };
const CAKE_LABELS = { none: 'なし', talent: 'キノコ等', special: 'スペシャル' };
const shortChoices = (choices, labels) => choices.map(([key, text]) => [key, labels[key] ?? text, text]);

const targetValue = (value) => intIn(value, { min: 0, max: 100, fallback: 100 });
/**
 * 保存して読み戻す条件の形（ui/view-memory.js が sessionStorage・履歴のエントリから読むときに、項目ごとに確かめる）。
 * 合わない項目は既定の値に戻す。登録する名前・配合牧場の基準（planBaselines）は保存しない
 */
export const IDEAL_MEMORY = {
  // 所持者: すべて・自分の個体（mine）・プレイヤー（player:<uid>）
  holder: (value) => (typeof value === 'string' && value.length <= 48 && (value === '' || value === 'mine' || /^player:\S/.test(value)) ? value : ''),
  mode: (value) => oneOf(value, PASSIVE_MODES.map(([key]) => key), 'include'),
  targets: (value) => cleanSaved(value, Object.fromEntries(TALENT_KEYS.map((key) => [key, targetValue]))),
  cake: (value) => oneOf(value, CAKES.map(([key]) => key), 'none'),
};
// 開いている間、孵化させて受け取ったパルを取り込むためにセーブ（参加している人は共有）を確かめる間隔。
// 所持パルの自動の読み込みは 20 秒以上空ける（owned.js の AUTO_INTERVAL）ので、タイマーのずれで読み飛ばさないよう少し足す
const REFRESH_INTERVAL = 20 * 1000 + 500;
// 区切った計算の 1 回の区切り（ms）。最初の区切りで終われば同期で描く（stable-render の D18: 1 区切り 50ms 以内）
const SLICE_BUDGET = 30;
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

/** 確率の表示。1% 未満は有効数字 2 桁にする。 */
export function percent(rate) {
  if (rate <= 0) return '0%';
  if (rate >= 1 - 1e-9) return '100%';
  const value = rate * 100;
  if (value < 0.0001) return '0.0001% 未満';
  // 1 未満を丸めて 100% と出さない
  if (value >= 99.9) return '99.9%';
  if (value >= 10) return `${Number(value.toFixed(1))}%`;
  if (value >= 1) return `${Number(value.toFixed(2))}%`;
  return `${Number(value.toPrecision(2))}%`;
}

// タマゴの数（10 個未満は丸めると差が消えるので、小数 1 桁まで出す）
const countText = (eggs) => (eggs >= 1e6 ? '100 万個以上'
  : `約 ${eggs < 10 ? Number(eggs.toFixed(1)) : Math.round(eggs).toLocaleString('ja-JP')} 個`);

/** 1 個のタマゴの成功率から、成功するまでに産ませるタマゴの平均の目安（「平均 約 N 個」）。 */
export function eggsText(rate) {
  if (rate <= 0) return 'この組では届きません';
  const eggs = 1 / rate;
  if (eggs < 1.05) return 'ほぼ毎回';
  return `平均 ${countText(eggs)}`;
}

/**
 * 子と入れ替えながら続けたときの、完成品が産まれるまでのタマゴの平均（「完成まで 平均 約 N 個」）。
 * upper は平均の上限（キノコケーキで目安と離れるときだけ添える）。lead は何がそろうまでか（個体値厳選組は「個体値がそろうまで」）
 */
export function generationsText(eggs, upper = eggs, lead = '完成まで') {
  if (!Number.isFinite(eggs)) return 'この条件では届きません';
  const text = `${lead} 平均 ${countText(eggs)}`;
  return Number.isFinite(upper) && upper > eggs * 1.05 ? `${text}（平均の上限 ${countText(upper)}）` : text;
}

const palName = (id) => palsById.get(id)?.ja ?? id;
const passiveNames = (ids) => ids.map((id) => passivesById.get(id)?.ja ?? id).join('、');

function sourceText(pair) {
  if (pair.sources.some((source) => source.kind === 'same')) return '同じ種族どうし';
  return `登録済みの配合 ${palName(pair.male.palId)}♂ × ${palName(pair.female.palId)}♀`;
}

// 配合の計画の組の目的（core/ideal.js の PLAN_GROUPS）
const GROUP_LABELS = { complete: '完全体作成組', passive: 'パッシブ厳選組', talent: '個体値厳選組' };
// 組のカードの札（組の目的・変更あり・配置中）を押すと開く説明（ui/hint.js）
const TAG_HINTS = {
  complete: 'この 2 体（子と入れ替えながらを含む）で、欲しいパッシブと個体値の目標を全部満たす子を狙える組です。同じ種族なら、両親合わせて欲しいパッシブがそろえば入ります。',
  passive: '完全体作成組に当たらず、両親を合わせると欲しいパッシブが片親より多く集まる組です。個体値は見ません。',
  talent: 'パッシブは見ずに、個体値の目標をそろえる組です。',
  changed: '交換推奨の行き先の組のうち、牧場の中身が最後に変わったときにはなかった組です。',
  placed: 'セーブで、この組がその牧場に入っていると分かった組です。',
};

// 組の目的のアイコン（12px の SVG。王冠＝完全体作成組、つながった 2 つの輪＝パッシブ厳選組、3 本のバー＝個体値厳選組）。
// フェーズ 1d の visual-parts で ui/icons.js に移す
const SVG_NS = 'http://www.w3.org/2000/svg';
const GROUP_SHAPES = {
  complete: [['path', { d: 'M1.5 9.8 1 3.4l2.8 2.2L6 1.8l2.2 3.8L11 3.4l-.5 6.4z', fill: 'currentColor' }]],
  passive: [['circle', { cx: 4.2, cy: 6, r: 2.8 }], ['circle', { cx: 7.8, cy: 6, r: 2.8 }]].map(([tag, shape]) => [tag, { ...shape, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4 }]),
  talent: [[1, 7, 4], [4.8, 4, 7], [8.6, 1, 10]].map(([x, y, height]) => ['rect', { x, y, width: 2.4, height, rx: 0.5, fill: 'currentColor' }]),
};
function svgNode(tag, attributes) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}
function groupIcon(group) {
  const icon = svgNode('svg', { viewBox: '0 0 12 12', width: 12, height: 12, 'aria-hidden': 'true', focusable: 'false', class: 'ideal-tier-icon' });
  for (const [tag, attributes] of GROUP_SHAPES[group] ?? []) icon.append(svgNode(tag, attributes));
  return icon;
}

// 組の目的ごとの見出し（太字）と内訳（小さい字）。量はどれも「…まで 平均 約 N 個」の形にそろえる
function pairMeasure(pair, cake) {
  const estimate = cake === 'talent' ? 'キノコケーキは目安' : '';
  const join = (parts) => parts.filter(Boolean).join(' · ');
  if (pair.group === 'passive') {
    const what = pair.gathered === pair.gatherTotal ? '欲しいパッシブが全部そろう' : `欲しいパッシブ ${pair.gatherTotal} 個のうち ${pair.gathered} 個がそろう`;
    return [`${what}まで ${eggsText(pair.gatherChance)}`, join([`1 個のタマゴで ${percent(pair.gatherChance)}`, '個体値は見ていません'])];
  }
  if (pair.group === 'talent') {
    const generations = Number.isFinite(pair.talentGenerations);
    const head = generations ? generationsText(pair.talentGenerations, pair.talentGenerationsUpper, '個体値がそろうまで')
      : `個体値がそろうまで ${eggsText(pair.talentChance)}`;
    return [head, join([`1 個のタマゴで ${percent(pair.talentChance)}`, 'パッシブは見ていません', generations ? estimate : ''])];
  }
  if (Number.isFinite(pair.generations)) {
    // 子を同じ性別の親と入れ替えながら続けたときの平均と、この 2 体のまま続けたときの平均を並べる
    const same = pair.chance > 0 ? `この 2 体のままなら ${eggsText(pair.chance).replace(/^平均 /, '')}` : 'この 2 体のままでは届きません';
    return [generationsText(pair.generations, pair.generationsUpper), join(['子と入れ替えながら', same, `1 個のタマゴで ${percent(pair.chance)}`, estimate])];
  }
  return [`完成まで ${eggsText(pair.chance)}`, join([`1 個のタマゴで ${percent(pair.chance)}`, `パッシブ ${percent(pair.passiveChance)} × 個体値 ${percent(pair.talentChance)}`])];
}

/**
 * 組のカード。札（組の目的・変更あり・配置中）は押すと説明が開くボタンで、作った説明の部品は hints に入れる
 *（カードを作り直すときに、呼んだ側が destroy して開いている板を閉じる）。
 * highlight（{ wanted, targets }）は ♂♀ の行で欲しいパッシブと個体値の目標との差を見せる（views/owned.js の ownedRow）
 */
function pairCard(pair, rank, { cake = 'none', placed = '', changed = false, highlight, hints = [] } = {}) {
  const card = el('article', `ideal-pair group-${pair.group}`);
  card.setAttribute('aria-label', `${rank + 1} 番目の組`);
  const head = el('div', 'ideal-pair-head');
  const chance = el('div', 'ideal-chance');
  const tags = el('div', 'ideal-tags');
  const tag = (className, text, help, icon) => {
    const node = button('', null, className);
    if (icon) node.append(icon);
    node.append(el('span', '', text));
    hints.push(hint({ label: text, trigger: node, content: help }));
    return node;
  };
  tags.append(tag(`ideal-tier group-${pair.group}`, GROUP_LABELS[pair.group] ?? '', TAG_HINTS[pair.group] ?? '', groupIcon(pair.group)));
  if (changed) tags.append(tag('ideal-changed', '変更あり', TAG_HINTS.changed));
  if (placed) tags.append(tag('ideal-placed', `${placed}に配置中`, TAG_HINTS.placed));
  const [strong, small] = pairMeasure(pair, cake);
  chance.append(tags, el('strong', '', strong), el('small', 'muted', small));
  head.append(el('span', 'step-number', String(rank + 1)), chance, el('span', 'ideal-source', sourceText(pair)));
  const notes = el('ul', 'ideal-notes');
  const note = (text, className = '') => notes.append(el('li', className, text));
  // 余計なパッシブは、完全体作成組で確率を下げているときだけ出す（欲しいパッシブを選ばない「全部持つ」などでは関係しない）
  if (pair.group === 'complete' && pair.extras.length && pair.cleanPassiveChance > pair.passiveChance) {
    const item = el('li', 'ideal-extras');
    item.append(el('span', '', '余計なパッシブ: '), passiveList(pair.extras, { compact: true }),
      el('span', '', `（これがなければ、パッシブの確率は ${percent(pair.passiveChance)} → ${percent(pair.cleanPassiveChance)}）`));
    notes.append(item);
  }
  if (pair.ambiguous) note('同じ組み合わせで別の子も登録されています。どちらかの登録が間違っている可能性があります。確率は目標のパルが産まれた場合のものです。', 'ideal-warning');
  else if (pair.swapped) note('登録済みの配合の性別を入れ替えた向きです（同じ子が産まれるとみなしています。未検証）', 'ideal-warning');
  else if (pair.unverified) note('性別条件は未検証', 'ideal-warning');
  card.append(head, ownedRow(pair.male, { highlight }), ownedRow(pair.female, { highlight }));
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
const goalHash = (goal) => buildHash('ideal', { to: goal.palId, p: goal.passives.join(','), g: goal.id });

/** 登録した条件の要約（個体値の目標・パッシブの条件・ケーキ）。個体値は「HP —・攻撃 100 以上」（保存の 0 は条件なし） */
function goalSummary(goal) {
  const targets = GOAL_STATS.map((key) => `${TALENT_LABELS[key]} ${goal.targets[key] ? `${goal.targets[key]} 以上` : '—'}`).join('・');
  return [targets, choiceLabel(PASSIVE_MODES, goal.mode), choiceLabel(CAKES, goal.cake).replace(/（.*）$/, '')].join(' · ');
}

/**
 * 一覧での完成の状態（自分の個体で判定する）。所持パルのデータがない・自分のプレイヤーが分からないときは、
 * 完成していないとは言えないので「未確認」にする。
 */
function goalStatus(goal, pals) {
  if (pals === undefined) return { done: false, text: '未確認（所持パルのデータがありません）' };
  if (pals === null) return { done: false, text: '未確認（セーブのどのプレイヤーが自分か分かりません。設定タブの「登録者の対応」で選んでください）' };
  const found = goalMatches(goal, pals);
  if (!found.length) return { done: false, text: '未完成' };
  const [first] = found;
  const where = `${first.holder} · ${first.placeLabel}`;
  return { done: true, text: `完成済み: ${where}${found.length > 1 ? ` ほか ${found.length - 1} 体` : ''}` };
}

// 計算のしくみ（見出しの「?」のダイアログ）。4 つの見出しに、各 1〜3 文。
// 「異種の親は登録済みの配合だけを使います」は INV-2 の例外 (b)（理想個体の確率計算だけ遺伝の仕組みを使う）の説明なので必ず残す
const HELP_SECTIONS = [
  ['並び方と組の種類', [
    '配合牧場に上から置く順に、別々の個体で最大 20 組を並べます。同じ個体は 2 回使いません。牧場には、配合牧場の判定で交換を勧めた組を置いてください（上から K 組が、いつも最終の配置とは限りません）。',
    '「完全体作成組」は欲しいパッシブと個体値の目標を全部満たす子を作れる組です。2 体で欲しいパッシブがそろい、条件のある各ステータスに目標以上の親がいて 1 回で作れる組（種族は問わない）と、同じ種族で両親合わせて欲しいパッシブがそろい、産まれた子と入れ替えながら作る組（どちらの親が持っていても同じ。欲しい以外のパッシブが少ないほど早い）です。「パッシブ厳選組」は完全体作成組に当たらず、両親を合わせると片親だけより多く欲しいパッシブが集まる組（途中まで集める組や、異なる種族の組も含む）、「個体値厳選組」はパッシブを見ずに個体値をそろえる組です。',
    '異種の親は登録済みの配合だけを使います。タマゴとグローバルパルボックスの個体は親にしません。',
  ]],
  ['数字の意味', [
    '「完成まで 平均 約 N 個」は、完成品が産まれるまでに産ませるタマゴの平均です。同じ種族の組は、産まれた子を親と入れ替えながら続けた場合の平均です。',
    'ランダムに付くパッシブで偶然そろう分は数えないので、実際より少し多めに出ます。突然変異とアルファの子は数えません。',
    'Palworld v1.0.5 のゲームの仕組み（パッシブは両親の分から 1〜4 個、個体値は親から写るか 0〜100 の乱数）で計算しています。',
  ]],
  ['ケーキ', [
    'キノコケーキ・豪華野菜ケーキは個体値に +1〜5 するため目安で並べ、目安と離れるときは「平均の上限」を添えます。',
    'スペシャルケーキは両親のパッシブから 4 個まで継ぎ、足りない枠はランダムで埋まります。そのため欲しいパッシブが 4 個未満の「欲しいものだけ」は作れません。',
  ]],
  ['配合牧場と「変更あり」', [
    // 交換の決め方は ideal-calc で直した文（入れ替えに関わる牧場・D19 の一文）のまま
    '入れ替えると、牧場全体の完成の速さの目安（各牧場の 1÷完成までの平均 の合計。完全体作成組以外は 1 個のタマゴで完成する確率）が上がるときだけ交換を勧めます。上がらなければ「そのまま」です。入れ替えに関わる牧場がどれもまだ完成できない（準備の組だけの）ときは、それらの牧場がどれも悪くならず、1 か所以上が良くなるときだけ勧めます。親の片方が同じ組を優先し、1 体の入れ替えで済むようにします。同じ組み合わせで別の子も登録されている組が関わる牧場は、どちらかの登録が間違っている可能性があるので、速さでは比べず、おすすめの順のとおりにします。',
    '「変更あり」は、交換推奨の行き先の組のうち、牧場の中身が最後に変わったときにはなかった組に付き、牧場の親を入れ替えたとセーブから分かると消えます。',
    '開いている間はセーブ（参加している人はホストの共有）を確かめ直し、受け取ったパルも入れて並べ直します。',
  ]],
];
function helpSections() {
  const help = el('div', 'ideal-help');
  for (const [title, texts] of HELP_SECTIONS) {
    const section = el('section', 'ideal-help-section');
    section.append(el('h3', '', title), ...texts.map((text) => el('p', '', text)));
    help.append(section);
  }
  return help;
}

export function idealView(context, route) {
  const owned = context.owned;
  const element = el('section', 'view ideal-view');
  // 画面の中の条件は、タブを切り替えても残す。読み込み直しても、同じタブ（sessionStorage）の間は残る（app.js が戻す）
  const memory = context.viewState?.('ideal');
  const conditions = memory?.conditions ?? { holder: '', mode: 'include', targets: { hp: 100, shot: 100, defense: 100 }, cake: 'none' };
  conditions.holder ??= '';
  if (memory) memory.conditions = conditions;
  const ideals = context.ideals;
  // 入力の間引きの待ち時間（テストの context は 0 にして同期で確かめる）
  const inputDelay = context.inputDelay ?? 150;
  // 区切った計算の 1 回の区切り（テストの context は Infinity にして、計算を同期で確かめる）
  const sliceBudget = context.sliceBudget ?? SLICE_BUDGET;
  let current = route;
  let to = '';
  let passives = [];
  // URL から読む条件（作るときと、同じ画面のまま URL が変わったとき）。登録した理想個体の条件を入れたら true を返す
  function readRoute(next) {
    current = next;
    to = validId(next, 'to', context);
    // 重複とマスターにない ID は除く（知らない ID のチップを出さない）
    passives = [...new Set((next.params.get('p') ?? '').split(',').filter((id) => internalName(id)))].slice(0, MAX_WANTED);
    // 通知や一覧から開いたとき（g）は、登録した条件をそのまま使い（同じパルとパッシブでも条件が違う登録があるため）、URL から外す
    const goalId = next.params.get('g');
    if (!goalId) return false;
    const goal = ideals?.find(goalId);
    if (goal) Object.assign(conditions, { mode: goal.mode, cake: goal.cake, targets: { ...goal.targets } });
    else toast('登録した理想個体が見つかりません');
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
    ariaLabel: (key) => `${TALENT_LABELS[key]}の目標`,
    presets: [{ label: 'すべて 100', value: { hp: 100, shot: 100, defense: 100 } }],
    debounce: inputDelay,
    onChange: (value) => { conditions.targets = { ...value }; renderResults(); },
  });
  // 親にする個体の所持者（すべて／自分の個体／各プレイヤー）。プレイヤーの個体は、所持者がそのプレイヤーの個体と、
  // そのプレイヤーが預けた拠点のパル（core/ideal-goals.js の palsOfPlayers）。自分の個体は登録者の対応か同じ名前で決める
  const holderSelect = el('select');
  holderSelect.addEventListener('change', () => {
    conditions.holder = holderSelect.value;
    renderPassives(owned?.state?.owned?.pals);
    renderResults();
  });
  // 選択肢の並びが前と同じなら作り直さない。違っても、選んでいる途中（フォーカス中）は待つ
  let syncingHolders = false;
  function renderHolders() {
    const data = owned?.state?.owned;
    const choices = [['', 'すべて'], ...(ideals ? [['mine', '自分の個体']] : []), ...(data?.players ?? []).map((player) => [`player:${player.uid}`, player.name])];
    syncingHolders = true;
    try {
      syncOptions(holderSelect, choices, () => {
        // 選択肢にない所持者は選ばない（読み込む前は選択肢がそろっていないので、選んでいた値を消さずに残す）
        const valid = [...holderSelect.children].some((node) => node.value === conditions.holder);
        const latest = owned?.state?.owned;
        if (!valid && latest && conditions.holder) {
          conditions.holder = '';
          // フォーカス中で待っていた作り直し（blur の後）で外したときは、パッシブの数と結果も計算し直す
          //（renderHolders の中からのときは、呼んだ側がこの後で描く）
          if (!syncingHolders) {
            renderPassives(latest.pals);
            renderResults();
          }
        }
        holderSelect.value = valid ? conditions.holder : '';
      });
    } finally {
      syncingHolders = false;
    }
  }
  // 選んだ所持者の個体だけ（すべてのときはそのまま。自分のプレイヤーが分からないときは空）
  function ofHolder(pals) {
    const data = owned?.state?.owned;
    if (!conditions.holder || !data) return pals;
    const allowed = conditions.holder === 'mine' ? ideals?.mine() ?? []
      : palsOfPlayers(data, new Set([conditions.holder.replace(/^player:/, '')]));
    const ids = new Set((allowed ?? []).map((pal) => pal.id));
    return pals.filter((pal) => ids.has(pal.id));
  }
  // パッシブの条件とケーキは押しボタン（値と計算は前の select と同じ。長い説明は title）。押したらすぐ計算する
  const modeChoice = segmented({ label: 'パッシブの条件', choices: shortChoices(PASSIVE_MODES, MODE_LABELS), value: conditions.mode,
    onChange: (value) => { conditions.mode = value; renderResults(); } });
  const cakeChoice = segmented({ label: 'ケーキ', choices: shortChoices(CAKES, CAKE_LABELS), value: conditions.cake,
    onChange: (value) => { conditions.cake = value; renderResults(); } });
  // 同じ画面のまま登録した理想個体を呼び出したとき（g）・戻る・進むで条件を入れ直したとき、入れた条件を入力欄にも出す
  function showConditions() {
    talent.update(conditions.targets);
    modeChoice.update(conditions.mode);
    cakeChoice.update(conditions.cake);
  }

  // 所持の状況（I-53）: 目標と同じ種族の親の候補の数（idealPlan の数。所持者で絞った後）。押すと所持パルをその種族とパッシブで開く。
  // 目標がないときは「—」で幅を保ち、文字だけ書き換える（要素は作り直さない）
  const holding = el('a', 'ideal-holding', '—');
  holding.title = '親の候補の数（タマゴ・グローバルパルボックスを除き、所持者の絞り込みの後）';
  function renderHolding(result) {
    const text = result && to ? `所持 ♂${result.sameSpecies.M} ♀${result.sameSpecies.F}${passives.length
      ? ` · 全部持つ ♂${result.complete.M} ♀${result.complete.F}` : ''}` : '—';
    if (holding.textContent !== text) holding.textContent = text;
    if (result && to) holding.setAttribute('href', buildHash('owned', { pal: to, p: passives.join(',') }));
    else holding.removeAttribute('href');
  }

  // 今の条件（パル・欲しいパッシブ・パッシブの条件・個体値の目標・ケーキ）を、名前を付けて目標として保存する（この端末だけ）。
  // 名前の変更・条件の更新はしない（外して保存し直す。I-18）
  const defaultName = () => `${palName(to)}${passives.length ? `（${passiveNames(passives)}）` : ''}`.slice(0, GOAL_NAME_MAX);
  const goalConditions = () => ({ palId: to, passives, mode: conditions.mode, targets: { ...conditions.targets }, cake: conditions.cake, order: 'next' });
  const saveSlot = el('div', 'ideal-save-slot');
  saveSlot.hidden = !ideals;
  // 目標がないときは見えないまま場所を残す（選んだときに右が動かない）。保存済みは押せない印（aria-disabled）にし、フォーカスは残す
  const saveButton = button('☆ 目標として保存', () => {
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
  saveBoard.element.setAttribute('aria-label', '目標として保存');
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
    const registered = Boolean(to) && ideals.has(goalConditions());
    const text = registered ? '★ 保存済み' : '☆ 目標として保存';
    if (saveButton.textContent !== text) saveButton.textContent = text;
    saveButton.classList.toggle('is-placeholder', !to);
    saveButton.disabled = !to;
    saveButton.setAttribute('aria-disabled', String(registered));
    saveButton.title = to ? goalSummary(goalConditions()) : '';
    // 保存できなくなったら（目標を外した・保存済みになった）板を閉じる
    if ((!to || registered) && saveBoard.isOpen()) saveBoard.close({ focus: Boolean(to) });
  }
  function saveGoal() {
    if (!to || !ideals) return;
    const goal = goalConditions();
    const name = nameInput.value.trim() || defaultName();
    const result = ideals.add({ ...goal, name });
    saveBoard.close();
    if (result === 'added') toast(`「${name}」を保存しました（${goalSummary(goal)}）。完成したら右上のベルで知らせます`);
    else if (result === 'duplicate') toast('この条件はすでに保存しています');
    else if (result === 'full') toast(`保存できる目標は ${GOAL_LIMIT} 件までです`);
    else if (context.store.state.renaming) toast('名前の変更が終わってから保存してください');
    else toast('ログインしてから保存してください');
  }

  // 条件のパネル（sticky の 2 段）。1 段目: 目標・欲しいパッシブ・保存、2 段目: 所持者・パッシブの条件・個体値・ケーキ・所持の状況
  //（2 段目は幅に応じて折り返す）。高さは画面の section の --panel-h に書き続ける（下の帯・scroll-margin-top が使う）
  const panel = el('section', 'ideal-panel');
  panel.setAttribute('aria-label', '理想個体の条件');
  const panelMain = el('div', 'ideal-panel-main');
  panelMain.append(toPicker.element, passive.element, saveSlot);
  // 2 段目の欄（見出しを入力の左に置く）。押しボタンの見出しは radiogroup の名前と重ねて読まれないよう隠す
  const panelItem = (caption, control, { tag = 'div', hidden = false } = {}) => {
    const node = el(tag, 'ideal-panel-item');
    const label = el('span', 'field-label', caption);
    if (hidden) label.setAttribute('aria-hidden', 'true');
    node.append(label, control);
    return node;
  };
  const panelSub = el('div', 'ideal-panel-sub');
  panelSub.append(panelItem('所持者', holderSelect, { tag: 'label' }), panelItem('条件', modeChoice.element, { hidden: true }),
    panelItem('個体値（以上）', talent.element), panelItem('ケーキ', cakeChoice.element, { hidden: true }), holding);
  panel.append(panelMain, panelSub);
  const stopTracking = trackHeight(panel, element);

  // 要約の行（1 行に固定。中は固定の 3 つの子: 件数などの文〔入り切らない分は省略して title に全文〕・除外の内訳を開くボタン・最終確認の時刻）。
  // 子は作り直さず、文字だけ書き換える（条件を変えても行の高さと位置が変わらない）
  const summary = el('div', 'result-note ideal-summary');
  const summaryText = el('span', 'ideal-summary-text');
  // 除外がないときは見えないまま幅を残す（hidden にしない）
  const excludedButton = button('除外 0', null, 'ideal-excluded is-placeholder');
  excludedButton.disabled = true;
  let excludedLines = [];
  const excludedHint = hint({ label: '除外', trigger: excludedButton, content: () => excludedLines });
  const checked = el('span', 'ideal-checked');
  summary.append(summaryText, excludedButton, checked);
  // 最後にセーブ（参加している人は共有）を確かめ終えた時刻（20 秒ごとの確認。まだなら 0）
  let lastChecked = 0;
  // 欲しいパッシブが配合では作れないときの案内と、配合牧場の判定
  const missingBox = el('div', 'ideal-missing-note');
  const farmBox = el('section', 'ideal-farms');
  const results = el('div', 'ideal-results');
  // 配合牧場の中身が最後に変わったときのおすすめ（「変更あり」の基準）。アプリでは端末に残し、テストなどでは画面の中で覚える
  const planMemory = context.planMemory ?? (() => {
    const kept = memory?.planBaselines ?? new Map();
    if (memory) memory.planBaselines = kept;
    return { get: (id) => kept.get(id) ?? null, set: (id, value) => kept.set(id, value) };
  })();

  // 見出しの右端: 保存した目標のダイアログを開く「目標（N）」と、計算のしくみの「?」
  const goalsButton = button('', () => openGoals(), 'button secondary small ideal-goals-button');
  goalsButton.setAttribute('aria-haspopup', 'dialog');
  goalsButton.hidden = !ideals;
  const helpButton = button('?', () => openHelp(), 'icon-button view-help-button');
  helpButton.setAttribute('aria-label', '計算のしくみの説明');
  helpButton.setAttribute('aria-haspopup', 'dialog');
  const heading = viewHeading('理想個体');
  const headingActions = el('div', 'view-heading-actions');
  headingActions.append(goalsButton, helpButton);
  heading.append(headingActions);
  let helpModal = null;
  function openHelp() {
    if (helpModal) return;
    helpModal = openDialog('計算のしくみ', { className: 'ideal-help-dialog', onClose: () => { helpModal = null; } });
    helpModal.body.append(helpSections());
    helpModal.footer.append(button('閉じる', helpModal.close, 'button secondary'));
  }

  // 保存した目標のダイアログ（表。完成済みを上に）。開いている間は、登録・所持パルが変わるたびに行を合わせる（同じ行は作り直さない）
  let goalsModal = null;
  let goalsClose = null;
  const goalsWarning = el('p', 'form-errors', 'この端末に目標を保存できませんでした。ページを閉じると、保存できなかった変更は失われます。');
  goalsWarning.setAttribute('role', 'alert');
  const goalsList = el('ul', 'ideal-goal-list');
  function openGoals() {
    if (!ideals || goalsModal) return;
    goalsModal = openDialog('目標', { className: 'ideal-goals-dialog', onClose: () => { goalsModal = null; goalsClose = null; clearList(goalsList); } });
    goalsClose = button('閉じる', goalsModal.close, 'button secondary');
    goalsModal.body.append(goalsWarning, goalsList);
    goalsModal.footer.append(goalsClose);
    renderGoals();
  }
  function removeGoal(goal) {
    const key = ideals.scope();
    const removed = ideals.remove(goal.id, key);
    if (!removed) {
      if (context.store.state.renaming) toast('名前の変更が終わってから外してください');
      return;
    }
    toast(`「${goal.name}」を目標から外しました`, {
      action: () => { if (!ideals.restore(removed.goal, removed.index, key)) toast('元に戻せませんでした'); },
    });
  }
  // 1 行（列: パル・名前／パッシブ／条件の要約／状態／呼び出す・外す）。保存した目標の中身は変わらないので、update は状態だけ
  function goalRow({ goal, status }) {
    const row = el('li', 'ideal-goal');
    const title = el('div', 'ideal-goal-title');
    title.append(palsById.has(goal.palId) ? palTile(goal.palId, { clickable: false }) : el('span', 'muted', goal.palId), el('strong', '', goal.name));
    const state = el('span', 'ideal-goal-status');
    const recall = link('呼び出す', goalHash(goal), 'button secondary small');
    // 一覧を合わせ直しても、押した「呼び出す」にフォーカスを戻す（ui/dom.js の syncList・ui/focus.js）
    recall.setAttribute('data-focus-key', `goal:${goal.id}`);
    recall.setAttribute('data-focus', 'recall');
    // ダイアログは画面の遷移で閉じないので、呼び出したら閉じる（リンクの遷移はそのまま進む）
    recall.addEventListener('click', () => goalsModal?.close());
    const remove = actionIcon(`「${goal.name}」を目標から外す`, icons.remove, () => removeGoal(goal), 'danger-text');
    remove.setAttribute('data-focus', 'remove');
    row.append(title, goal.passives.length ? passiveList(goal.passives, { compact: true }) : el('span', 'muted', '—'),
      el('small', 'muted ideal-goal-summary', goalSummary(goal)), state, recall, remove);
    const update = (item) => {
      row.classList.toggle('done', item.status.done);
      state.classList.toggle('ready', item.status.done);
      if (state.textContent !== item.status.text) state.textContent = item.status.text;
    };
    update({ status });
    return { element: row, update };
  }
  function renderGoals() {
    if (!ideals) return;
    const goals = ideals.list();
    const count = `目標（${goals.length}）${ideals.saveFailed ? '!' : ''}`;
    if (goalsButton.textContent !== count) goalsButton.textContent = count;
    goalsButton.title = ideals.saveFailed ? 'この端末に保存できませんでした' : '';
    if (!goalsModal) return;
    goalsWarning.hidden = !ideals.saveFailed;
    const pals = ideals.mine();
    const rows = goals.map((goal) => ({ goal, status: goalStatus(goal, pals) }));
    // 完成済みを上に（それぞれ保存の新しい順）
    const ordered = [...rows.filter((item) => item.status.done), ...rows.filter((item) => !item.status.done)];
    syncList(goalsList, ordered, {
      key: (item) => item.goal.id, create: goalRow, fallbackFocus: goalsClose,
      empty: () => el('li', 'muted ideal-goal-empty', '保存した目標はまだありません。条件を選んで「☆ 目標として保存」を押すと、ここに並び、完成したら右上のベルで知らせます。'),
    });
  }

  element.append(heading, panel, summary, missingBox, farmBox, results);

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
    if (conditions.holder === 'mine' && ideals?.mine() === null) {
      lines.push('セーブのどのプレイヤーが自分か分かりません。設定タブの「登録者の対応」で選ぶか、所持者を「すべて」にしてください。');
    } else if (!result.candidates) lines.push(`${palName(to)}の ♂ と ♀（または登録済みの配合で${palName(to)}が産まれる親の組）を所持していません。`);
    else if (result.blocked) {
      lines.push(conditions.cake === 'special' && conditions.mode === 'only' && passives.length < 4
        ? 'スペシャルケーキでは、欲しいパッシブが 4 個未満だと「欲しいものだけ」の子は産まれません。'
        : 'パッシブを持つ親からは、パッシブのない子は産まれません。パッシブを持たない ♂ と ♀ の組がありません。');
    } else lines.push('♂ と ♀ の組を作れる個体がいません。');
    if (holderName()) lines.push(`（所持者を「${holderName()}」に絞っています）`);
    return empty(lines.join(''));
  }

  // 欲しいパッシブを候補のだれも持たないときは、個体値厳選組だけを並べていることを知らせる。
  // そのパッシブを持つ所持パル（別の種族など）から目標へ運ぶ継承ルートも探せる
  function renderMissing(result) {
    missingBox.replaceChildren();
    if (!result?.missing.length) return;
    const listed = result.total ? 'いまは個体値厳選組だけを出しています。' : '';
    const warning = el('p', 'ideal-warning');
    warning.append(passiveList(result.missing, { compact: true }), el('span', '', ` を持つ親の候補がいません。${listed}`));
    missingBox.append(warning);
    const actions = el('div', 'ideal-missing');
    // ボタンの中に小さなチップ（チップの title と重ならないよう、ボタンには title を付けない）
    for (const id of result.missing) {
      const action = link('', buildHash('route', { to, p: id }), 'button secondary ideal-carry');
      action.append(passiveChip(id, { compact: true }), el('span', '', 'を運ぶ継承ルート'));
      actions.append(action);
    }
    missingBox.append(actions);
  }

  // 個体の短い説明（牧場の判定で、どの個体を入れ替えるか分かるように）
  const palText = (pal) => `${pal.name}${pal.gender === 'M' ? '♂' : '♀'}（HP ${pal.talent.hp}・攻 ${pal.talent.shot}・防 ${pal.talent.defense}）`;
  // 牧場の名前（拠点の名前。拠点が分からなければ「拠点の牧場」）
  const farmName = (baseId) => {
    const label = owned?.state?.owned?.bases?.find((base) => base.id === baseId)?.label;
    return label ? `${label} の牧場` : '拠点の牧場';
  };

  // 配合牧場の判定。今この目標の組を置いている牧場を、おすすめの上から同じ数の組と比べ、全体の速さの目安が上がる交換だけを出す。
  // uncertain(item) は、同じ組み合わせで別の子も登録されている組（牧場の組・交換先の組）の呼び名の一覧
  function renderFarms(advice, changed, uncertain) {
    farmBox.replaceChildren();
    if (!advice?.length) return;
    const swaps = advice.filter((item) => item.status === 'swap').length;
    farmBox.append(el('h3', '', `配合牧場（この目標の組を置いている ${advice.length} か所 · 交換推奨 ${swaps} か所）`));
    if (changed) farmBox.append(el('p', 'ideal-changed-note', `牧場の中身が最後に変わってから、交換推奨の行き先に新しく入った組が ${changed} 組あります（「変更あり」）。`));
    const list = el('ul', 'ideal-farm-list');
    for (const item of advice) {
      const row = el('li', `ideal-farm ${item.status}`);
      const now = `${palText(item.farm.male)} × ${palText(item.farm.female)}`;
      const where = farmName(item.farm.baseId);
      row.append(el('strong', '', where), el('span', '', now));
      // 上から K 組に入っていない「そのまま」は、交換を見送った牧場（入れ替えても全体の速さの目安が上がらない）
      if (item.status === 'keep') {
        row.append(el('span', 'ideal-farm-status keep', item.rank >= 0 && item.rank < advice.length
          ? `そのまま（おすすめ ${item.rank + 1} 番）` : 'そのまま（入れ替えても全体の速さの目安が上がりません）'));
      }
      else if (item.status === 'swap') {
        row.append(el('span', 'ideal-farm-status swap', `交換推奨 → おすすめ ${item.to + 1} 番`));
        const detail = [
          item.out.length ? `外す: ${item.out.map(palText).join('・')}` : '',
          item.in.length ? `入れる: ${item.in.map((pal) => `${palText(pal)}（${pal.holder} · ${pal.placeLabel}）`).join('・')}` : '',
        ].filter(Boolean).join(' / ');
        row.append(el('small', 'muted', detail));
      } else {
        row.append(el('span', 'ideal-farm-status none', item.rank >= 0 ? `おすすめ ${item.rank + 1} 番（ほかに置く組がありません）` : 'おすすめにない組（ほかに置く組がありません）'));
        if (item.out.length) row.append(el('small', 'muted', `外す: ${item.out.map(palText).join('・')}（ほかの牧場に入れます）`));
      }
      const doubtful = uncertain(item);
      if (doubtful.length) {
        row.append(el('small', 'ideal-warning', `⚠ ${doubtful.join('と')}は、同じ組み合わせで別の子も登録されています。どちらかの登録が間違っている可能性があるので、速さでは比べず、おすすめの順で判定しています。`));
      }
      list.append(row);
    }
    farmBox.append(list);
  }

  const holderName = () => (conditions.holder ? [...holderSelect.children].find((node) => node.value === conditions.holder)?.textContent ?? '' : '');
  // 要約の文:「上位 N 組（全 M 組・候補 K 体） · 登録済みの配合 n 件（なければ 同じ種族どうし） · Alice の個体」
  function summaryLine(result) {
    // 同じ種族どうしのレコードは規則と重なるので、異種の配合だけを数える
    const records = new Set(result.layouts.filter((layout) => layout.male !== to || layout.female !== to)
      .flatMap((layout) => layout.sources.map((source) => source.record.id)));
    const holder = holderName();
    return [
      `上位 ${result.pairs.length} 組（全 ${result.total} 組・候補 ${result.candidates} 体）`,
      records.size ? `登録済みの配合 ${records.size} 件` : '同じ種族どうし',
      !holder ? '' : conditions.holder === 'mine' ? holder : `${holder} の個体`,
    ].filter(Boolean).join(' · ');
  }
  // 要約の行の文と除外のボタン（結果がないときは空。子は作り直さない）
  function renderSummary(result) {
    const text = result ? summaryLine(result) : '';
    if (summaryText.textContent !== text) summaryText.textContent = text;
    summaryText.title = text;
    excludedLines = result ? [
      result.unknownGender ? `性別不明の ${result.unknownGender} 体` : '',
      result.tooMany ? `パッシブが 5 個以上の ${result.tooMany} 体（入れ替えの計算から除外）` : '',
      result.blocked ? `パッシブの条件を満たせない ${result.blocked} 組` : '',
    ].filter(Boolean) : [];
    const count = result ? result.unknownGender + result.tooMany + result.blocked : 0;
    const label = `除外 ${count}`;
    if (excludedButton.textContent !== label) excludedButton.textContent = label;
    excludedButton.classList.toggle('is-placeholder', !count);
    excludedButton.disabled = !count;
    if (!count) excludedHint.close();
  }
  // 最終確認の時刻とセーブの時刻（文字だけ書き換える。20 秒ごとの確認で結果は作り直さない）
  function renderChecked() {
    const saved = owned?.state?.meta?.saveUpdatedAt;
    const text = owned ? [`最終確認 ${lastChecked ? formatTime(lastChecked) : '—'}`, saved ? `セーブ ${dateTime(saved)}` : ''].filter(Boolean).join(' · ') : '';
    if (checked.textContent !== text) checked.textContent = text;
  }

  // 結果の欄を入れ替える。前のカードの札の説明（開いている板）は閉じて片づける
  let cardHints = [];
  function showResults(nodes, hints = []) {
    for (const item of cardHints) item.destroy();
    cardHints = hints;
    results.replaceChildren(...nodes);
  }

  // 同じ見込みの組を畳んだまとまり（開閉は viewState に残す。タブを切り替えても残り、読み込み直すと閉じる）
  const sameState = memory ?? {};
  function sameGroup(short) {
    const details = el('details', 'ideal-same');
    details.open = Boolean(sameState.sameOpen);
    details.addEventListener('toggle', () => { sameState.sameOpen = details.open; });
    const head = el('summary', 'ideal-same-summary');
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
        group = sameGroup(short);
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
    renderSummary(null);
    renderHolding(null);
    missingBox.replaceChildren();
    farmBox.replaceChildren();
  }

  function renderResults() {
    // 閉じた後に遅れて呼ばれたとき（間引いた入力など）は、計算を始めない
    if (destroyed) return;
    const started = clock();
    renderSave();
    const state = context.store.state;
    const pals = owned?.state?.owned?.pals ?? null;
    if (!pals) {
      clearPlan();
      showResults([empty(owned && !owned.state.ready ? '読み込み中…'
        : '所持パルのデータがありません。設定タブの「セーブ連携」でワールドを登録するか、ホストが所持パルを共有すると、理想個体の親を探せます。')]);
      return;
    }
    if (!to) { clearPlan(); showResults([empty('目標のパルを選んでください。')]); return; }
    if (!state.env) { clearPlan(); showResults([]); dataPending(results, state); return; }
    const candidates = ofHolder(pals);
    // 配合牧場の中身（ホストのセーブ、または共有されたもの。牧場を共有する前のデータにはない）。
    // 今の牧場の組を計画で優先・見張るので、計画より先に求める
    const farms = owned?.state?.owned?.farms;
    const layouts = breedingLayouts(state.index, to);
    const placedFarms = Array.isArray(farms) ? targetFarms(farms, candidates.filter(isParentCandidate), layouts) : [];
    const signature = farmSignature(placedFarms);
    const memoryId = JSON.stringify([state.env ?? '', owned?.state?.meta?.worldId ?? '', to, [...passives].sort(), conditions.mode,
      TALENT_KEYS.map((key) => conditions.targets[key]), conditions.cake, conditions.holder]);
    const baseline = Array.isArray(farms) ? planMemory.get(memoryId) : null;
    const placedKeys = new Set(placedFarms.map((farm) => planPairKey(farm.male, farm.female)));
    // 物差しが同じ組どうしでは、今の牧場の組と前の基準の上位を先にする（値の小さな差で交換推奨や「変更あり」が出ないように）
    const prefer = { placed: placedKeys, baseline: new Set(baseline?.farms === signature ? baseline.pairs.slice(0, placedFarms.length) : []) };
    // 計算の署名: 配合の index・候補の個体の計算に効く値・実効の条件・本人・牧場の署名・優先する組。
    // prefer は並びを変えるので、入れないと、別のタブが基準を書き換えたときなどに古い並びが残る
    const self = conditions.holder === 'mine' ? (ideals?.mine()?.map((pal) => pal.id).join(',') ?? 'unknown') : '';
    const species = new Set(layouts.flatMap((layout) => [layout.male, layout.female]));
    const key = `${JSON.stringify([state.revision ?? null, objectRev(state.index), state.env, to, [...passives].sort(),
      conditions.mode, TALENT_KEYS.map((name) => conditions.targets[name]), conditions.cake, conditions.holder, self, signature,
      [...prefer.placed].sort(), [...prefer.baseline].sort()])}\u0003${candidateSignature(candidates, species)}`;
    // 同じ計算をしている途中（計算に効かない値だけが変わった）。終わって描くときに、新しいデータの個体に入れ替える
    if (job?.key === key) return;
    // 出している結果と同じ条件に戻った（計算している途中なら、その計算は捨てる）。データだけが変わっていれば個体を入れ替えて描き直す
    if (key === shownKey) {
      job?.cancel();
      job = null;
      setComputing(false);
      if (shown) drawLatest(shown);
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
    const plan = {
      placedFarms, signature, memoryId, baseline, farms, cake: conditions.cake, data: owned.state.owned,
      highlight: { wanted: [...passives], targets: { ...conditions.targets } }, short,
    };
    const steps = idealPlanSteps({
      pals: candidates, index: state.index, target: to, passives: [...passives],
      mode: conditions.mode, targets: { ...conditions.targets }, cake: conditions.cake, limit: LIMIT, prefer, watch: placedKeys,
    });
    // 最初の区切りは、ここまでの下ごしらえ（所持パルが多いと数十 ms）と合わせて 1 区切りに収める
    const run = startSliced(steps, { budget: sliceBudget, firstBudget: Math.max(0, sliceBudget - (clock() - started)) });
    if (run.done) {
      setComputing(false);
      showPlan(run.value, plan);
      shownKey = key;
      return;
    }
    // 終わらなければ、前の結果を残したまま「計算中」にする（高さは変えない）。何も出していなければ「計算中…」を出す
    const current = { key, cancel: run.cancel };
    job = current;
    if (!shownKey) {
      renderSummary(null);
      renderHolding(null);
      missingBox.replaceChildren();
      farmBox.replaceChildren();
      showResults([empty('計算中…')]);
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
  // 画面に出す、データから引く値（組と牧場の個体の行の署名・所持者の名前・牧場の拠点の名前）。同じなら描き直さない
  const displayKey = ({ result, plan }) => [...result.pairs.flatMap((pair) => [pair.male, pair.female]), ...plan.placedFarms.flatMap((farm) => [farm.male, farm.female])]
    .map((pal) => rowSignature(pal, [])).concat(holderName(), plan.placedFarms.map((farm) => farmName(farm.baseId))).join('\u0003');
  // 描いている結果を、今のデータの個体で描き直す（データが変わっていて、出す値も変わったときだけ）
  function drawLatest(current) {
    if (owned.state.owned === current.plan.data) return;
    const latest = withLatestPals(current);
    const display = displayKey(latest);
    shown = { ...latest, changed: current.changed, display };
    if (display !== current.display) drawPlan(latest.result, latest.plan, current.changed);
  }

  // 計算の結果を描く。「変更あり」の基準（planMemory）もここで更新する
  function showPlan(result, plan) {
    const { placedFarms, signature, memoryId, baseline, farms } = plan;
    let changed = new Set();
    if (Array.isArray(farms)) {
      const next = planChanges(baseline, signature, result.pairs, placedFarms.length);
      if (next.reset) planMemory.set(memoryId, next.baseline);
      // 「変更あり」は、採った交換推奨の行き先の組だけ（交換推奨と同じ考え方）
      const swapTargets = new Set(farmAdviceOf(result, placedFarms).advice.filter((item) => item.status === 'swap')
        .map((item) => planPairKey(result.pairs[item.to].male, result.pairs[item.to].female)));
      changed = new Set([...next.changed].filter((key) => swapTargets.has(key)));
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

  // 要約・所持の状況・足りないパッシブ・配合牧場の判定・組のカードを描く
  function drawPlan(result, { placedFarms, cake, highlight, short = [] }, changed) {
    renderSummary(result);
    renderHolding(result);
    renderMissing(result);
    const { measureOf, advice } = farmAdviceOf(result, placedFarms);
    renderFarms(advice, changed.size, (item) => [
      measureOf(planPairKey(item.farm.male, item.farm.female))?.ambiguous ? '牧場の組' : '',
      item.status === 'swap' && result.pairs[item.to].ambiguous ? '交換先の組' : '',
    ].filter(Boolean));
    if (!result.total) { showResults([noPairs(result)]); return; }
    const placed = new Map(placedFarms.map((farm) => [planPairKey(farm.male, farm.female), farmName(farm.baseId)]));
    // 牧場の判定が指している組（そのままの組・交換先の組）は畳まない
    const pointed = new Set(advice.flatMap((item) => (item.status === 'swap' ? [item.to] : item.rank >= 0 ? [item.rank] : [])));
    const hints = [];
    const nodes = result.pairs.map((pair, rank) => {
      const key = planPairKey(pair.male, pair.female);
      return pairCard(pair, rank, { cake, placed: placed.get(key) ?? '', changed: changed.has(key), highlight, hints });
    });
    showResults(foldSame(result.pairs, nodes, pointed, short), hints);
  }

  function update() {
    renderChecked();
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
  }

  // 間引いて待っている個体値の入力をすぐ当てる（app.js が、移る前に履歴のエントリへ条件を書く前に呼ぶ）
  const flushInputs = () => talent.flush();
  const pickers = {
    destroy() {
      destroyed = true;
      talent.destroy();
      job?.cancel();
      job = null;
      toPicker.destroy();
      passive.destroy();
      modeChoice.destroy();
      cakeChoice.destroy();
      saveBoard.destroy();
      excludedHint.destroy();
      for (const item of cardHints) item.destroy();
      stopTracking();
      // ダイアログは画面の遷移で閉じないので、画面を閉じるときに閉じる
      goalsModal?.close();
      helpModal?.close();
    },
  };
  const view = watchView(context.store, element, update, [pickers]);
  // 保存した目標が変わったら（別のタブ・完成の判定を含む）、目標の数・ダイアログの行・「保存済み」を描き直す
  const unsubscribeGoals = ideals?.subscribe(() => { renderSave(); renderGoals(); passive.update({ presets: passivePresets(ideals) }); }) ?? (() => {});
  if (!owned) return { element, update, applyRoute, flushInputs, destroy() { unsubscribeGoals(); view.destroy(); } };
  let lastOwned = owned.state.owned;
  let lastReady = owned.state.ready;
  const unsubscribe = owned.subscribe((ownedState) => {
    if (ownedState.owned === lastOwned && ownedState.ready === lastReady) return;
    lastOwned = ownedState.owned;
    lastReady = ownedState.ready;
    update();
  });
  // 開いている間は 20 秒ごとに読み直し、孵化させて受け取ったパルも順位に入れる。閉じた後と、タブが裏にある間は読まない
  // （裏にある間のセーブの読み直しは、全画面共通の 1 分ごとの読み直しに任せる。destroyed は区切った計算と同じ印）。
  // 確かめ終えたら（読めなかったときは除く）、要約の行の「最終確認」の時刻だけを書き換える（結果は作り直さない）
  const refresh = async () => {
    if (destroyed || globalThis.document?.visibilityState === 'hidden') return;
    let outcome;
    try {
      outcome = await owned.autoRefresh();
    } catch {
      return;
    }
    if (destroyed || outcome === 'error') return;
    lastChecked = Date.now();
    renderChecked();
  };
  owned.load().then(refresh).catch(() => {});
  const timer = setInterval(refresh, REFRESH_INTERVAL);
  return { element, update, applyRoute, flushInputs, destroy() { destroyed = true; clearInterval(timer); unsubscribe(); unsubscribeGoals(); view.destroy(); } };
}
