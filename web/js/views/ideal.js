import { el, field, empty, link } from '../ui/dom.js';
import { palPicker } from '../ui/pal-picker.js';
import { palsById } from '../ui/pal-icon.js';
import { passiveSelector, passivesById } from '../ui/passive-picker.js';
import { passiveCounts } from '../core/owned.js';
import { idealPairs, isParentCandidate, MAX_WANTED, CAKES, PASSIVE_MODES, TALENT_KEYS } from '../core/ideal.js';
import { buildHash } from '../router.js';
import { ownedRow } from './owned.js';
import { viewHeading, validId, navigateSelection, watchView, dataPending } from './shared.js';

// 一度に出す組の数（条件に合う組がもっと多いときは、件数だけを出す）
const LIMIT = 20;
const TALENT_LABELS = { hp: 'HP', shot: '攻撃', defense: '防御' };

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

const palName = (id) => palsById.get(id)?.ja ?? id;
const passiveNames = (ids) => ids.map((id) => passivesById.get(id)?.ja ?? id).join('、');

function sourceText(pair) {
  if (pair.sources.some((source) => source.kind === 'same')) return '同じ種族どうし';
  return `登録済みの配合 ${palName(pair.male.palId)}♂ × ${palName(pair.female.palId)}♀`;
}

function pairCard(pair, rank) {
  const card = el('article', 'ideal-pair');
  card.setAttribute('aria-label', `${rank + 1} 番目の組`);
  const head = el('div', 'ideal-pair-head');
  const chance = el('div', 'ideal-chance');
  chance.append(el('strong', '', pair.chance > 0 ? `1 個のタマゴで ${percent(pair.chance)}` : '目標に届きません'),
    el('small', 'muted', `${eggsText(pair.chance)} · パッシブ ${percent(pair.passiveChance)} × 個体値 ${percent(pair.talentChance)}`));
  head.append(el('span', 'step-number', String(rank + 1)), chance, el('span', 'ideal-source', sourceText(pair)));
  const notes = el('ul', 'ideal-notes');
  const note = (text, className = '') => notes.append(el('li', className, text));
  // 余計なパッシブは、確率を下げているときだけ出す（欲しいパッシブを選ばない「全部持つ」などでは関係しない）
  if (pair.extras.length && pair.cleanPassiveChance > pair.passiveChance) {
    note(`余計なパッシブ: ${passiveNames(pair.extras)}（これがなければ、パッシブの確率は ${percent(pair.passiveChance)} → ${percent(pair.cleanPassiveChance)}）`);
  }
  if (!pair.passiveChance) note('この組とケーキでは、パッシブの条件を満たせません。');
  if (!pair.talentChance) note('どちらの親も、個体値の目標に届くステータスを持っていないため、この組では届きません。');
  if (pair.ambiguous) note('同じ組み合わせで別の子も登録されています。確率は目標のパルが産まれた場合のものです。', 'ideal-warning');
  else if (pair.swapped) note('登録済みの配合の性別を入れ替えた向きです（同じ子が産まれるとみなしています。未検証）', 'ideal-warning');
  else if (pair.unverified) note('性別条件は未検証', 'ideal-warning');
  card.append(head, ownedRow(pair.male), ownedRow(pair.female));
  if (notes.children.length) card.append(notes);
  return card;
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
    '突然変異やアルファの子は数えていません。Palworld v1.0.5 のゲームの仕組みで計算しています。',
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
  const conditions = memory?.conditions ?? { mode: 'include', targets: { hp: 100, shot: 100, defense: 100 }, cake: 'none' };
  if (memory) memory.conditions = conditions;

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
  const panel = el('div', 'selection-panel ideal-conditions');
  panel.append(
    field('パッシブの条件', select(PASSIVE_MODES, conditions.mode, (value) => { conditions.mode = value; renderResults(); })),
    group('個体値の目標（0 は気にしない）', targets),
    field('ケーキ', select(CAKES, conditions.cake, (value) => { conditions.cake = value; renderResults(); })));

  const note = el('p', 'result-note');
  const results = el('div', 'ideal-results');
  element.append(viewHeading('理想個体'), query, panel, note, results, explanation());

  const setPassives = (ids) => {
    const params = new URLSearchParams(route.params);
    if (ids.length) params.set('p', ids.join(','));
    else params.delete('p');
    context.navigate(buildHash('ideal', params));
  };

  function renderPassives(pals) {
    passiveSlot.replaceChildren(passiveSelector({
      // 所持数も、親の候補にしない個体（タマゴ・グローバルパルボックス）を除いて数える
      label: '欲しいパッシブ', selected: passives, counts: passiveCounts((pals ?? []).filter(isParentCandidate)), onChange: setPassives,
    }));
  }

  function noPairs(result) {
    const lines = [];
    if (!result.candidates) lines.push(`${palName(to)}（と登録済みの配合の親）を、オスとメスで所持していません。`);
    else if (result.missing.length) lines.push(`欲しいパッシブのうち、${passiveNames(result.missing)} を持つ個体が候補にいません。`);
    else if (passives.length) lines.push('欲しいパッシブが 1 組の親にそろいません。3 体以上に分かれているか、オスとメスの組み合わせが合いません。先にいくつかのパッシブをまとめた個体を作ってください。');
    else lines.push('オスとメスの組を作れる個体がいません。');
    const node = empty(lines.join(''));
    // 候補にないパッシブは、そのパッシブを持つ所持パルから目標へ運ぶ経路を探せる
    if (result.missing.length) {
      const actions = el('div', 'ideal-missing');
      for (const id of result.missing) actions.append(link(`${passiveNames([id])}を運ぶ経路`, buildHash('route', { to, p: id }), 'button secondary'));
      node.append(actions);
    }
    return node;
  }

  function summaryText(result) {
    // 同じ種族どうしのレコードは規則と重なるので、異種の配合だけを数える
    const records = new Set(result.layouts.filter((layout) => layout.male !== to || layout.female !== to)
      .flatMap((layout) => layout.sources.map((source) => source.record.id)));
    return [
      `${result.total} 組${result.total > LIMIT ? `（確率の高い ${LIMIT} 組を表示）` : ''}`,
      `候補 ${result.candidates} 体`,
      records.size ? `同じ種族どうしと登録済みの配合 ${records.size} 件` : '同じ種族どうし',
      result.unknownGender ? `性別不明の ${result.unknownGender} 体は除外` : '',
    ].filter(Boolean).join(' · ');
  }

  function renderResults() {
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
    const result = idealPairs({ pals, index: state.index, target: to, passives, ...conditions, limit: LIMIT });
    note.textContent = summaryText(result);
    if (!result.total) { results.replaceChildren(noPairs(result)); return; }
    results.replaceChildren(...result.pairs.map(pairCard));
  }

  function update() {
    renderPassives(owned?.state?.owned?.pals);
    renderResults();
  }

  const pickers = { destroy() { toPicker.destroy(); } };
  const view = watchView(context.store, element, update, [pickers]);
  if (!owned) return view;
  let lastOwned = owned.state.owned;
  let lastReady = owned.state.ready;
  const unsubscribe = owned.subscribe((ownedState) => {
    if (ownedState.owned === lastOwned && ownedState.ready === lastReady) return;
    lastOwned = ownedState.owned;
    lastReady = ownedState.ready;
    update();
  });
  owned.load().then(() => owned.autoRefresh()).catch(() => {});
  return { element, destroy() { unsubscribe(); view.destroy(); } };
}
