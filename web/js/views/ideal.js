import { el, field, empty, link, button } from '../ui/dom.js';
import { palPicker } from '../ui/pal-picker.js';
import { palsById, palTile } from '../ui/pal-icon.js';
import { passiveSelector, passivesById, passiveList } from '../ui/passive-picker.js';
import { actionIcon, icons } from '../ui/breeding-card.js';
import { toast } from '../ui/toast.js';
import { goalMatches, palsOfPlayers, GOAL_LIMIT, GOAL_NAME_MAX, GOAL_STATS } from '../core/ideal-goals.js';
import { passiveCounts } from '../core/owned.js';
import { idealPairs, isParentCandidate, MAX_WANTED, CAKES, PASSIVE_MODES, ALPHAS, TALENT_KEYS } from '../core/ideal.js';
import { buildHash } from '../router.js';
import { ownedRow } from './owned.js';
import { viewHeading, validId, navigateSelection, watchView, dataPending } from './shared.js';

// 一度に出す組の数（条件に合う組がもっと多いときは、件数だけを出す）
const LIMIT = 20;
const TALENT_LABELS = { hp: 'HP', shot: '攻撃', defense: '防御' };
// 開いている間、孵化させて受け取ったパルを取り込むためにセーブ（参加している人は共有）を確かめる間隔。
// 所持パルの自動の読み込みは 20 秒以上空ける（owned.js の AUTO_INTERVAL）ので、タイマーのずれで読み飛ばさないよう少し足す
const REFRESH_INTERVAL = 20 * 1000 + 500;
const REFRESH_NOTE = '20 秒ごとに確認';

function option(value, label) {
  const node = el('option', '', label);
  node.value = value;
  return node;
}

function select(choices, value, onChange) {
  const node = el('select');
  for (const [key, label] of choices) node.append(option(key, label));
  node.value = value;
  node.addEventListener('change', () => onChange(node.value));
  return node;
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

/** 1 個のタマゴの成功率から、成功するまでに産ませるタマゴの平均の目安。 */
export function eggsText(rate) {
  if (rate <= 0) return 'この組では届きません';
  const eggs = 1 / rate;
  if (eggs < 1.05) return 'ほぼ毎回';
  if (eggs >= 1e6) return '平均 100 万個以上に 1 個';
  // 10 個未満は丸めると差が消えるので、小数 1 桁まで出す
  return `平均 約 ${eggs < 10 ? Number(eggs.toFixed(1)) : Math.round(eggs).toLocaleString('ja-JP')} 個に 1 個`;
}

const countText = (eggs) => (eggs >= 1e6 ? '100 万個以上'
  : `約 ${eggs < 10 ? Number(eggs.toFixed(1)) : Math.round(eggs).toLocaleString('ja-JP')} 個`);

/** 世代を重ねたときの、完成品が産まれるまでのタマゴの平均。upper は上限（キノコケーキで目安と離れるときだけ添える）。 */
export function generationsText(eggs, upper = eggs) {
  if (!Number.isFinite(eggs)) return 'この条件では届きません';
  const text = `世代を重ねて 平均 ${countText(eggs)}`;
  return Number.isFinite(upper) && upper > eggs * 1.05 ? `${text}（多くても${countText(upper)}）` : text;
}

const palName = (id) => palsById.get(id)?.ja ?? id;
const passiveNames = (ids) => ids.map((id) => passivesById.get(id)?.ja ?? id).join('、');

function sourceText(pair) {
  if (pair.sources.some((source) => source.kind === 'same')) return '同じ種族どうし';
  return `登録済みの配合 ${palName(pair.male.palId)}♂ × ${palName(pair.female.palId)}♀`;
}

// 配合の計画の段（core/ideal.js の comparePlan）
const TIER_LABELS = ['1 回で作れる', '世代を重ねる', 'その他の組'];

function pairCard(pair, rank, { cake = 'none' } = {}) {
  const card = el('article', `ideal-pair tier-${pair.tier}`);
  card.setAttribute('aria-label', `${rank + 1} 番目の組`);
  const head = el('div', 'ideal-pair-head');
  const chance = el('div', 'ideal-chance');
  const generations = Number.isFinite(pair.generations);
  chance.append(el('span', `ideal-tier tier-${pair.tier}`, TIER_LABELS[pair.tier] ?? ''));
  if (generations) {
    // 子を同じ性別の親と入れ替えながら続けたときの平均と、この 2 体のまま続けたときの平均を並べる
    const same = pair.chance > 0 ? `この 2 体のままなら${eggsText(pair.chance).replace(/^平均/, '')}` : 'この 2 体のままでは届きません';
    chance.append(el('strong', '', generationsText(pair.generations, pair.generationsUpper)),
      el('small', 'muted', [same, `1 個のタマゴで ${percent(pair.chance)}`, pair.alphaChance < 1 ? `アルファ ${percent(pair.alphaChance)} を含む` : '',
        cake === 'talent' ? 'キノコケーキは目安' : ''].filter(Boolean).join(' · ')));
  } else {
    chance.append(el('strong', '', pair.chance > 0 ? `1 個のタマゴで ${percent(pair.chance)}` : '目標に届きません'),
      el('small', 'muted', `${eggsText(pair.chance)} · パッシブ ${percent(pair.passiveChance)} × 個体値 ${percent(pair.talentChance)}`
        + (pair.alphaChance < 1 ? ` × アルファ ${percent(pair.alphaChance)}` : '')));
  }
  head.append(el('span', 'step-number', String(rank + 1)), chance, el('span', 'ideal-source', sourceText(pair)));
  const notes = el('ul', 'ideal-notes');
  const note = (text, className = '') => notes.append(el('li', className, text));
  // 余計なパッシブは、確率を下げているときだけ出す（欲しいパッシブを選ばない「全部持つ」などでは関係しない）
  if (pair.extras.length && pair.cleanPassiveChance > pair.passiveChance) {
    note(`余計なパッシブ: ${passiveNames(pair.extras)}（これがなければ、パッシブの確率は ${percent(pair.passiveChance)} → ${percent(pair.cleanPassiveChance)}）`);
  }
  if (!pair.passiveChance) note('この組とケーキでは、パッシブの条件を満たせません。');
  // 世代を重ねる組では、子を入れ替えていけば届くことがあるので出さない
  if (!pair.talentChance && !generations) note('どちらの親も、個体値の目標に届くステータスを持っていないため、この組では届きません。');
  if (pair.ambiguous) note('同じ組み合わせで別の子も登録されています。確率は目標のパルが産まれた場合のものです。', 'ideal-warning');
  else if (pair.swapped) note('登録済みの配合の性別を入れ替えた向きです（同じ子が産まれるとみなしています。未検証）', 'ideal-warning');
  else if (pair.unverified) note('性別条件は未検証', 'ideal-warning');
  card.append(head, ownedRow(pair.male), ownedRow(pair.female));
  if (notes.children.length) card.append(notes);
  return card;
}

const choiceLabel = (choices, value) => choices.find(([key]) => key === value)?.[1] ?? value;
const goalHash = (goal) => buildHash('ideal', { to: goal.palId, p: goal.passives.join(','), g: goal.id });

/** 登録した条件の要約（個体値の目標・パッシブの条件・ケーキ）。 */
function goalSummary(goal) {
  const targets = GOAL_STATS.map((key) => `${TALENT_LABELS[key]} ${goal.targets[key] || '気にしない'}`).join('・');
  return [targets, choiceLabel(PASSIVE_MODES, goal.mode), choiceLabel(CAKES, goal.cake).replace(/（.*）$/, ''),
    goal.alpha === 'any' ? '' : choiceLabel(ALPHAS, goal.alpha)].filter(Boolean).join(' · ');
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

function explanation() {
  const details = el('details', 'ideal-help');
  details.append(el('summary', '', '計算のしくみ'));
  const list = el('ul');
  for (const text of [
    'パッシブ: 両親のパッシブを合わせて重複を除いた中から、1〜4 個（40/30/20/10%）を同じ確率で選んで継ぎます。どちらの親が持っていても同じで、欲しいもの以外のパッシブが少ないほど、欲しいものがそろいやすくなります。',
    'ランダムに付くパッシブで偶然そろう分は数えていないため、実際より少し低めの値です。',
    '個体値: ステータスごとに、どちらかの親の値をそのまま写すか、0〜100 の乱数になります（親の値の中間にはなりません）。親から写る確率は HP が 2/3、攻撃と防御が 5/9 です。',
    'キノコケーキ・豪華野菜ケーキは、個体値にステータスごとに +1〜5 します。スペシャルケーキは、継ぐ数を抽選せず、両親のパッシブから 4 個まで継ぎます（足りない枠はランダムで埋まります）。',
    '並び: 配合牧場に上から置く組を、別々の個体で並べます（上の組から順に、まだ使っていない個体どうしの組を選びます）。牧場が 3 つなら上から 3 組を置き、産まれたタマゴを孵化させて受け取り、並び直したら、また上から置いてください。タマゴは孵化するまで牧場に置けないので、親の候補にしません。',
    '「1 回で作れる」と「世代を重ねる」の組を、完成品（パッシブの条件と個体値の目標を全部満たす子）が産まれるまでのタマゴの平均の少ない順にまとめて並べます。',
    '「1 回で作れる」: 目標のパルが産まれる組（登録済みの配合を含む）で、両親で欲しいパッシブがそろい、目標のある各ステータスに目標以上（キノコケーキでは目標の 5 下以上）の親がいる組です。どのステータスも親から写るだけで目標に届くので、1 個のタマゴで完成品が産まれることがあります。',
    '「世代を重ねる」: 同じ種族で、両親とも欲しいパッシブを全部持つ組です（1 回で作れる組でも、同じ種族で両親とも欲しいパッシブを全部持てば、世代の平均を出します）。欲しいパッシブを全部持つ子が産まれたら同じ性別の親と入れ替えながら続けたときの平均です（入れ替えは最も早くなるように選ぶ。この 2 体のまま続けるのより多くはなりません）。子の性別は半々、ランダムに足されるパッシブは新しいものとして計算しています。世代の平均が出ない組（異種の配合など）は、この 2 体のまま続けたときの平均で比べます。',
    '「その他の組」: それ以外の、2 体でやっと欲しいパッシブがそろう組や、個体値の目標に届く親がいない異種の配合などです。上の 2 つの後に、1 個のタマゴで完成品が産まれる確率の高い順に並べます。パッシブの条件を満たす子が産まれない組（スペシャルケーキで 4 個未満の「欲しいものだけ」など）は出しません。',
    'キノコケーキ・豪華野菜ケーキでは、目標より下の値が +1〜5 で段階的に上がるため、厳密には計算できません。目標の 6 下までは届くとみなした目安で並べ、目標の 1 下までしか届かないとみなした上限（実際はこれより少ない）を「多くても」として添えます。目安は、目標の少し下の親どうしでは実際に近く、ずっと下の親では多めに出ます。',
    '開いている間は 20 秒ごとにセーブを確かめ、孵化させて受け取ったパルも候補に入れて並べ直します（参加している人は、ホストが共有した内容で並べ直します）。',
    'アルファ: 配合で産まれた子は、親がアルファかどうかによらず約 5% でアルファになります（wiki.gg とコミュニティの実測の値で、ゲームのデータでは確かめていません）。「アルファだけ」は成功率に 5%、「アルファ以外」は 95% を掛け、アルファの条件だけ満たさなかった完成品も親として入れ替えに使えるものとして計算します。タマゴを拾ったときにアルファにするパートナースキルは数えていません。',
    '突然変異の子（別の種族になる）は数えていません。アルファの確率のほかは、Palworld v1.0.5 のゲームの仕組みで計算しています。',
  ]) list.append(el('li', '', text));
  details.append(list);
  return details;
}

export function idealView(context, route) {
  const owned = context.owned;
  const element = el('section', 'view ideal-view');
  const to = validId(route, 'to', context);
  const passives = [...new Set((route.params.get('p') ?? '').split(',').filter(Boolean))].slice(0, MAX_WANTED);
  // 画面の中の条件は、タブを切り替えても残す（ページを読み込み直すと既定に戻る）
  const memory = context.viewState?.('ideal');
  const conditions = memory?.conditions ?? { holder: '', mode: 'include', targets: { hp: 100, shot: 100, defense: 100 }, cake: 'none', alpha: 'any' };
  conditions.holder ??= '';
  conditions.alpha ??= 'any';
  if (memory) memory.conditions = conditions;
  const ideals = context.ideals;
  // 通知や一覧から開いたとき（g）は、登録した条件をそのまま使い（同じパルとパッシブでも条件が違う登録があるため）、URL から外す
  const goalId = route.params.get('g');
  if (goalId) {
    const goal = ideals?.find(goalId);
    if (goal) Object.assign(conditions, { mode: goal.mode, cake: goal.cake, targets: { ...goal.targets }, alpha: goal.alpha });
    else toast('登録した理想個体が見つかりません');
    // 元の params から外す（ここから作る遷移先の URL や、作り直した画面に g を残さない）
    route.params.delete('g');
    context.replace(buildHash('ideal', route.params));
  }

  const toPicker = palPicker({ label: '目標', value: to, onChange: (id) => navigateSelection(context, route, 'to', id) });
  const passiveSlot = el('div', 'ideal-passives');
  const query = el('div', 'selection-panel route-query');
  query.append(toPicker.element, passiveSlot);

  const targets = el('div', 'owned-talent-filter');
  for (const key of TALENT_KEYS) {
    const input = el('input');
    input.type = 'number';
    input.min = '0';
    input.max = '100';
    input.step = '1';
    input.inputMode = 'numeric';
    input.placeholder = '0';
    input.value = String(conditions.targets[key]);
    input.setAttribute('aria-label', `${TALENT_LABELS[key]}の目標`);
    input.addEventListener('input', () => {
      conditions.targets[key] = Math.max(0, Math.min(100, Math.trunc(Number(input.value)) || 0));
      renderResults();
    });
    const wrapper = el('label');
    wrapper.append(el('span', '', TALENT_LABELS[key]), input);
    targets.append(wrapper);
  }
  // 複数の入力をまとめた欄（label で包むと最初の入力にしか結びつかないため div にする）
  const group = (label, control) => {
    const wrapper = el('div', 'owned-filter-group');
    wrapper.append(el('span', 'field-label', label), control);
    return wrapper;
  };
  // 親にする個体の所持者（すべて／自分の個体／各プレイヤー）。プレイヤーの個体は、所持者がそのプレイヤーの個体と、
  // そのプレイヤーが預けた拠点のパル（core/ideal-goals.js の palsOfPlayers）。自分の個体は登録者の対応か同じ名前で決める
  const holderSelect = el('select');
  holderSelect.addEventListener('change', () => {
    conditions.holder = holderSelect.value;
    renderPassives(owned?.state?.owned?.pals);
    renderResults();
  });
  function renderHolders() {
    const data = owned?.state?.owned;
    holderSelect.replaceChildren(option('', 'すべて'));
    if (ideals) holderSelect.append(option('mine', '自分の個体'));
    for (const player of data?.players ?? []) holderSelect.append(option(`player:${player.uid}`, player.name));
    // 選択肢にない所持者は選ばない（読み込む前は選択肢がそろっていないので、選んでいた値を消さずに残す）
    const valid = [...holderSelect.children].some((node) => node.value === conditions.holder);
    if (!valid && data) conditions.holder = '';
    holderSelect.value = valid ? conditions.holder : '';
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
  const panel = el('div', 'selection-panel ideal-conditions');
  panel.append(
    field('所持者', holderSelect),
    field('パッシブの条件', select(PASSIVE_MODES, conditions.mode, (value) => { conditions.mode = value; renderResults(); })),
    group('個体値の目標（0 は気にしない）', targets),
    field('ケーキ', select(CAKES, conditions.cake, (value) => { conditions.cake = value; renderResults(); })),
    field('アルファ', select(ALPHAS, conditions.alpha, (value) => { conditions.alpha = value; renderResults(); })));

  const note = el('p', 'result-note');
  const results = el('div', 'ideal-results');

  // 今の条件（パル・欲しいパッシブ・パッシブの条件・個体値の目標・ケーキ・アルファ）を、名前を付けて登録する
  const alphaName = () => (conditions.alpha === 'alpha' ? 'アルファの' : '');
  const defaultName = () => `${alphaName()}${palName(to)}${passives.length ? `（${passiveNames(passives)}）` : ''}`.slice(0, GOAL_NAME_MAX);
  const goalConditions = () => ({
    palId: to, passives, mode: conditions.mode, targets: { ...conditions.targets }, cake: conditions.cake, alpha: conditions.alpha, order: 'next',
  });
  const nameInput = el('input');
  nameInput.type = 'text';
  nameInput.maxLength = GOAL_NAME_MAX;
  nameInput.setAttribute('aria-label', '登録する名前');
  const registerButton = button('この条件を登録', () => registerGoal(), 'button secondary');
  const registerRow = el('div', 'ideal-register');
  registerRow.append(el('span', 'field-label', '理想個体として登録'), nameInput, registerButton);
  registerRow.hidden = !ideals;
  function renderRegister() {
    if (!ideals) return;
    const registered = Boolean(to) && ideals.has(goalConditions());
    nameInput.placeholder = to ? defaultName() : '目標のパルを選ぶと登録できます';
    registerButton.textContent = registered ? '登録済み' : 'この条件を登録';
    registerButton.disabled = !to || registered;
  }
  function registerGoal() {
    if (!to) return;
    const name = nameInput.value.trim() || defaultName();
    const result = ideals.add({ ...goalConditions(), name });
    if (result === 'added') {
      nameInput.value = '';
      toast(`「${name}」を登録しました。完成したら右上のベルで知らせます`);
    } else if (result === 'duplicate') toast('この条件はすでに登録しています');
    else if (result === 'full') toast(`登録できるのは ${GOAL_LIMIT} 件までです`);
    else if (context.store.state.renaming) toast('名前の変更が終わってから登録してください');
    else toast('ログインしてから登録してください');
  }

  // 登録した理想個体の一覧（折りたたみ。開いているかはタブを切り替えても残す）
  const goalsBox = el('details', 'ideal-goals');
  goalsBox.hidden = !ideals;
  goalsBox.open = Boolean(memory?.goalsOpen);
  goalsBox.addEventListener('toggle', () => { if (memory) memory.goalsOpen = goalsBox.open; });
  const goalsSummary = el('summary', '', '登録した理想個体');
  const goalsWarning = el('p', 'form-errors', 'この端末に登録を保存できませんでした。ページを閉じると、保存できなかった変更は失われます。');
  goalsWarning.setAttribute('role', 'alert');
  const goalsList = el('ul', 'ideal-goal-list');
  goalsBox.append(goalsSummary, goalsWarning, goalsList);
  let shownGoals = null;
  function removeGoal(goal) {
    const key = ideals.scope();
    const removed = ideals.remove(goal.id, key);
    if (!removed) {
      if (context.store.state.renaming) toast('名前の変更が終わってから外してください');
      return;
    }
    toast(`「${goal.name}」の登録を外しました`, {
      action: () => { if (!ideals.restore(removed.goal, removed.index, key)) toast('元に戻せませんでした'); },
    });
  }
  function goalRow(goal, status) {
    const row = el('li', `ideal-goal${status.done ? ' done' : ''}`);
    const main = el('div', 'ideal-goal-main');
    const title = el('div', 'ideal-goal-title');
    title.append(palsById.has(goal.palId) ? palTile(goal.palId, { clickable: false }) : el('span', 'muted', goal.palId), el('strong', '', goal.name));
    main.append(title);
    if (goal.passives.length) main.append(passiveList(goal.passives));
    main.append(el('small', 'muted', goalSummary(goal)), el('span', `ideal-goal-status${status.done ? ' ready' : ''}`, status.text));
    row.append(main, link('呼び出す', goalHash(goal), 'button secondary'),
      actionIcon(`「${goal.name}」の登録を外す`, icons.remove, () => removeGoal(goal), 'danger-text'));
    return row;
  }
  function renderGoals() {
    if (!ideals) return;
    goalsWarning.hidden = !ideals.saveFailed;
    const goals = ideals.list();
    const pals = ideals.mine();
    const rows = goals.map((goal) => ({ goal, status: goalStatus(goal, pals) }));
    // 完成済みを上に（それぞれ登録の新しい順）
    const ordered = [...rows.filter((item) => item.status.done), ...rows.filter((item) => !item.status.done)];
    // 所持パルを読み直すたびに作り直すと、操作中のフォーカスを失うので、中身が変わったときだけ描き直す
    const key = JSON.stringify(ordered.map(({ goal, status }) => [goal.id, goal.name, status.text]));
    if (key === shownGoals) return;
    shownGoals = key;
    goalsSummary.textContent = `登録した理想個体（${goals.length} 件）`;
    goalsList.replaceChildren(...(ordered.length ? ordered.map(({ goal, status }) => goalRow(goal, status))
      : [el('li', 'muted', '登録した理想個体はまだありません。条件を選んで「この条件を登録」を押すと、ここに並び、完成したら右上のベルで知らせます。')]));
  }

  element.append(viewHeading('理想個体'), goalsBox, query, panel, registerRow, note, results, explanation());

  const setPassives = (ids) => {
    const params = new URLSearchParams(route.params);
    if (ids.length) params.set('p', ids.join(','));
    else params.delete('p');
    context.navigate(buildHash('ideal', params));
  };

  function renderPassives(pals) {
    passiveSlot.replaceChildren(passiveSelector({
      // 所持数も、親の候補にしない個体（グローバルパルボックス）を除いて数える
      label: '欲しいパッシブ', selected: passives, counts: passiveCounts(ofHolder((pals ?? []).filter(isParentCandidate))), onChange: setPassives,
    }));
  }

  function noPairs(result) {
    const lines = [];
    if (conditions.holder === 'mine' && ideals?.mine() === null) {
      lines.push('セーブのどのプレイヤーが自分か分かりません。設定タブの「登録者の対応」で選ぶか、所持者を「すべて」にしてください。');
    } else if (!result.candidates) lines.push(`${palName(to)}（と登録済みの配合の親）を、オスとメスで所持していません。`);
    else if (result.missing.length) lines.push(`欲しいパッシブのうち、${passiveNames(result.missing)} を持つ個体が候補にいません。`);
    else if (result.blocked) {
      lines.push(conditions.cake === 'special' && conditions.mode === 'only' && passives.length < 4
        ? 'スペシャルケーキは空いた枠をランダムなパッシブで埋めるので、欲しいパッシブが 4 個未満では「欲しいものだけ」の子は産まれません。ケーキかパッシブの条件を変えてください。'
        : 'パッシブを持つ親からは、パッシブのない子は産まれません。パッシブを持たない ♂ と ♀ の組がありません。');
    } else if (passives.length) lines.push('欲しいパッシブが 1 組の親にそろいません。3 体以上に分かれているか、オスとメスの組み合わせが合いません。先にいくつかのパッシブをまとめた個体を作ってください。');
    else lines.push('オスとメスの組を作れる個体がいません。');
    if (holderName()) lines.push(`（所持者を「${holderName()}」に絞っています）`);
    const node = empty(lines.join(''));
    // 候補にないパッシブは、そのパッシブを持つ所持パルから目標へ運ぶ経路を探せる
    if (result.missing.length) {
      const actions = el('div', 'ideal-missing');
      for (const id of result.missing) actions.append(link(`${passiveNames([id])}を運ぶ経路`, buildHash('route', { to, p: id }), 'button secondary'));
      node.append(actions);
    }
    return node;
  }

  const holderName = () => (conditions.holder ? [...holderSelect.children].find((node) => node.value === conditions.holder)?.textContent ?? '' : '');
  function summaryText(result) {
    const holderNote = holderName() ? `所持者: ${holderName()}` : '';
    // 同じ種族どうしのレコードは規則と重なるので、異種の配合だけを数える
    const records = new Set(result.layouts.filter((layout) => layout.male !== to || layout.female !== to)
      .flatMap((layout) => layout.sources.map((source) => source.record.id)));
    return [
      `${result.total} 組のうち、別々の個体で作れる上位 ${result.pairs.length} 組`,
      `候補 ${result.candidates} 体`,
      holderNote,
      records.size ? `同じ種族どうしと登録済みの配合 ${records.size} 件` : '同じ種族どうし',
      result.unknownGender ? `性別不明の ${result.unknownGender} 体は除外` : '',
      result.tooMany ? `パッシブが 5 個以上の ${result.tooMany} 体は世代の計算から除外` : '',
      result.blocked ? `パッシブの条件を満たせない ${result.blocked} 組は除外` : '',
      REFRESH_NOTE,
    ].filter(Boolean).join(' · ');
  }

  function renderResults() {
    renderRegister();
    const state = context.store.state;
    const pals = owned?.state?.owned?.pals ?? null;
    note.textContent = '';
    if (!pals) {
      results.replaceChildren(empty(owned && !owned.state.ready ? '読み込み中…'
        : '所持パルのデータがありません。設定タブの「セーブ連携」でワールドを登録するか、ホストが所持パルを共有すると、理想個体の親を探せます。'));
      return;
    }
    if (!to) { results.replaceChildren(empty('目標のパルを選んでください。')); return; }
    if (dataPending(results, state)) return;
    const result = idealPairs({
      pals: ofHolder(pals), index: state.index, target: to, passives,
      mode: conditions.mode, targets: conditions.targets, cake: conditions.cake, alpha: conditions.alpha, order: 'plan', limit: LIMIT,
    });
    note.textContent = summaryText(result);
    if (!result.total) { results.replaceChildren(noPairs(result)); return; }
    const options = { cake: conditions.cake };
    results.replaceChildren(...result.pairs.map((pair, rank) => pairCard(pair, rank, options)));
  }

  function update() {
    renderHolders();
    renderPassives(owned?.state?.owned?.pals);
    renderResults();
    renderGoals();
  }

  const pickers = { destroy() { toPicker.destroy(); } };
  const view = watchView(context.store, element, update, [pickers]);
  // 登録が変わったら（別のタブ・完成の判定を含む）、一覧と「登録済み」を描き直す
  const unsubscribeGoals = ideals?.subscribe(() => { renderRegister(); renderGoals(); }) ?? (() => {});
  if (!owned) return { element, destroy() { unsubscribeGoals(); view.destroy(); } };
  let lastOwned = owned.state.owned;
  let lastReady = owned.state.ready;
  const unsubscribe = owned.subscribe((ownedState) => {
    if (ownedState.owned === lastOwned && ownedState.ready === lastReady) return;
    lastOwned = ownedState.owned;
    lastReady = ownedState.ready;
    update();
  });
  // 開いている間は 20 秒ごとに読み直し、孵化させて受け取ったパルも順位に入れる。閉じた後と、タブが裏にある間は読まない
  // （裏にある間のセーブの読み直しは、全画面共通の 1 分ごとの読み直しに任せる）
  let destroyed = false;
  const refresh = () => {
    if (destroyed || globalThis.document?.visibilityState === 'hidden') return;
    owned.autoRefresh().catch(() => {});
  };
  owned.load().then(refresh).catch(() => {});
  const timer = setInterval(refresh, REFRESH_INTERVAL);
  return { element, destroy() { destroyed = true; clearInterval(timer); unsubscribe(); unsubscribeGoals(); view.destroy(); } };
}
