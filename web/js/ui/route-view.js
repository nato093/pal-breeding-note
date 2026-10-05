import { el } from './dom.js';
import { breedingEquation } from './breeding-card.js';

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

function chain(route, annotate) {
  const wrapper = el('div', 'route-chain');
  route.steps.forEach((step, index) => {
    const node = stepView(step, index, annotate);
    if (step.multiChild || step.options.some(({ record }) => record.parent1Gender || record.parent2Gender)) {
      node.append(el('span', 'route-warning', '性別条件は未検証'));
    }
    wrapper.append(node);
  });
  return wrapper;
}

export function routeView(routes, { annotate } = {}) {
  const wrapper = el('div', 'route-results');
  routes.forEach((route, index) => {
    const node = el('section', 'route-card');
    node.append(el('h3', '', index === 0
      ? `最短 ${route.length} 回の配合` : `候補 ${index + 1} · ${route.length} 回の配合`), chain(route, annotate));
    wrapper.append(node);
  });
  return wrapper;
}
