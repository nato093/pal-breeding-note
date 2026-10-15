import { el, link } from './dom.js';
import { breedingEquation } from './breeding-card.js';
import { passiveChip } from './passive-picker.js';
import { buildHash } from '../router.js';

// 最初の経路のカードの見出しの下に 1 回だけ出す説明（前は画面に常に出していた。R-27・F038）
export const ROUTE_NOTE = '左のパルがパッシブを運びます。相手親は別に用意してください。';
const GENDER_NOTE_HELP = '経路は種族だけで探しています。記録の ♂♀ の向きと、手持ちの個体の性別が合うかは確かめていません。';

// 同じ段の配合が複数あるときは、続けて行う配合と取り違えないよう段番号は1つにして枠でまとめる
function stepView(step, index, annotate) {
  const node = el('article', 'breeding-card route-breeding-card');
  node.setAttribute('aria-label', `${index + 1} 回目の配合`);
  node.append(el('span', 'step-number', `${index + 1}`));
  const equations = step.options.map(({ record }) => breedingEquation(record, { leftParent: step.from }));
  // 相手親の所持状況など、呼び出し側が足す注記（配合ごと）
  const notes = step.options.map((option) => (annotate ? annotate(step, option) : null));
  if (equations.length === 1) {
    node.append(...equations);
    if (notes[0]) node.append(notes[0]);
    return node;
  }
  const options = el('div', 'route-options');
  options.append(el('p', 'route-options-label', `${equations.length} 通り・どれか 1 つ`));
  equations.forEach((equation, position) => {
    options.append(equation);
    if (notes[position]) options.append(notes[position]);
  });
  node.append(options);
  return node;
}

// 段の注意（どちらも段に 1 回だけ。統合プランの R-25）:
// - 同じ組から別の子も登録されている（警告）。押すとその組の配合を探す
// - 段の配合の記録に親の性別がある（ほぼ自動登録の配合）。経路は種族だけで探すので、向きは確かめていない（注記）
function stepNotes(step) {
  const notes = [];
  if (step.multiChild) {
    const partner = step.multiPartner || step.options[0]?.partner || '';
    const warning = link('同じ組で別の子も登録あり', buildHash('search', { p1: step.from, p2: partner }), 'status-chip is-warning route-warning');
    warning.title = '同じ親の組み合わせから別の子も登録されています。押すとこの組の配合を探します。';
    notes.push(warning);
  }
  if (step.options.some(({ record }) => record.parent1Gender || record.parent2Gender)) {
    const note = el('span', 'status-chip is-neutral route-note', '性別の向きは未確認');
    note.title = GENDER_NOTE_HELP;
    notes.push(note);
  }
  if (!notes.length) return null;
  const line = el('div', 'route-step-notes');
  line.append(...notes);
  return line;
}

function chain(route, annotate) {
  const wrapper = el('div', 'route-chain');
  route.steps.forEach((step, index) => {
    const node = stepView(step, index, annotate);
    const notes = stepNotes(step);
    if (notes) node.append(notes);
    wrapper.append(node);
  });
  return wrapper;
}

/**
 * 経路のカードを並べる。annotate(step, option) は配合ごとの注記、badge(route) は見出しの右に置く要素（相手親の所持の段の数など。
 * どちらも任意。返さなければ何も足さない）。passives（運ぶパッシブ）と note（説明）は、最初のカードの見出しにだけ出す
 * （passives は見出しの横に小さいチップ、note は見出しの下に small。R-23・R-27）
 */
export function routeView(routes, { annotate, badge, passives = [], note = '' } = {}) {
  const wrapper = el('div', 'route-results');
  routes.forEach((route, index) => {
    const node = el('section', 'route-card');
    // 画面の h1 の次の見出し（h2。大きさは CSS の .route-card h2 で前の h3 と同じ 15px）
    const heading = el('h2', '', index === 0
      ? `最短 ${route.length} 回の配合` : `候補 ${index + 1} · ${route.length} 回の配合`);
    const carried = index === 0 && passives.length ? el('span', 'route-card-passives') : null;
    if (carried) {
      carried.setAttribute('role', 'group');
      carried.setAttribute('aria-label', '運ぶパッシブ');
      carried.append(...passives.map((id) => passiveChip(id, { compact: true })));
    }
    const extra = badge ? badge(route) : null;
    if (carried || extra) {
      const head = el('div', 'route-card-head');
      head.append(heading, ...[carried, extra].filter(Boolean));
      node.append(head);
    } else node.append(heading);
    if (index === 0 && note) node.append(el('small', 'route-card-note', note));
    node.append(chain(route, annotate));
    wrapper.append(node);
  });
  return wrapper;
}
