import { el } from './dom.js';
import { palTile } from './pal-icon.js';

function optionView(option) {
  const node = el('div', 'route-partner');
  node.append(palTile(option.partner), el('span', 'confirm-badge', `確認 ${option.record.confirmCount} 回`));
  return node;
}

function chain(route) {
  const wrapper = el('div', 'route-chain');
  wrapper.append(palTile(route.nodes[0]));
  route.steps.forEach((step, index) => {
    const node = el('div', 'route-step');
    node.append(el('span', 'step-number', `${index + 1}`), el('p', 'field-label', '相手親を用意'), optionView(step.representative));
    if (step.options.length > 1) {
      const alternatives = el('details', 'route-alternatives');
      alternatives.append(el('summary', '', `他 ${step.options.length - 1} 件`));
      for (const option of step.options) alternatives.append(optionView(option));
      node.append(alternatives);
    }
    if (step.multiChild || step.options.some(({ record }) => record.parent1Gender || record.parent2Gender)) {
      node.append(el('span', 'warning-chip', '性別条件は未検証'));
    }
    wrapper.append(node, el('span', 'route-arrow', '↓'), palTile(step.to));
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
