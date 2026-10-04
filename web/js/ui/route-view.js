import { el } from './dom.js';
import { breedingEquation } from './breeding-card.js';

function optionView(step, option, index) {
  const node = el('article', 'breeding-card route-breeding-card');
  node.setAttribute('aria-label', `${index + 1} 回目の配合`);
  node.append(el('span', 'step-number', `${index + 1}`), breedingEquation(option.record, { leftParent: step.from }));
  return node;
}

function chain(route) {
  const wrapper = el('div', 'route-chain');
  route.steps.forEach((step, index) => {
    const node = el('div', 'route-step');
    const representative = optionView(step, step.representative, index);
    if (step.multiChild || step.options.some(({ record }) => record.parent1Gender || record.parent2Gender)) {
      representative.append(el('span', 'route-warning', '性別条件は未検証'));
    }
    node.append(representative);
    if (step.options.length > 1) {
      const alternatives = el('details', 'route-alternatives');
      alternatives.append(el('summary', '', `他 ${step.options.length - 1} 件`));
      for (const option of step.options) {
        if (option !== step.representative) alternatives.append(optionView(step, option, index));
      }
      node.append(alternatives);
    }
    wrapper.append(node);
  });
  return wrapper;
}

export function routeView(routes) {
  const wrapper = el('div', 'route-results');
  routes.forEach((route, index) => {
    const node = el(index === 0 ? 'section' : 'details', 'route-card');
    node.append(el(index === 0 ? 'h3' : 'summary', '', index === 0
      ? `最短 ${route.length} 回の配合` : `候補 ${index + 1} · ${route.length} 回の配合`), chain(route));
    wrapper.append(node);
  });
  return wrapper;
}
