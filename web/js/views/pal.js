import { el, link, button, empty } from '../ui/dom.js';
import { palsById, palTile, elementChips } from '../ui/pal-icon.js';
import { findByChild, findByParent } from '../core/index.js';
import { buildHash } from '../router.js';
import { viewHeading, renderCards, watchView, dataPending } from './shared.js';

export function palView(context, route) {
  const element = el('section', 'view');
  const pal = palsById.get(route.id);
  if (!pal) {
    context.replace(buildHash('pal'));
    element.append(empty('パルが見つかりません', link('配合検索へ', buildHash('search'), 'button primary')));
    return { element, destroy() {} };
  }
  element.append(viewHeading('パルの配合ノート', 'このパルにつながる、みんなの記録。'));
  const hero = el('div', 'pal-hero');
  hero.append(palTile(pal.id, { large: true, clickable: false }), elementChips(pal));
  const actions = el('div', 'pal-hero-actions');
  actions.append(link('ここから継承ルート', buildHash('route', { from: pal.id }), 'button secondary'),
    link('ここへの継承ルート', buildHash('route', { to: pal.id }), 'button secondary'),
    button('この子の配合を登録', () => context.register({ childId: pal.id }), 'button primary'));
  const children = el('div', 'card-stack');
  const parents = el('div', 'card-stack');
  element.append(hero, actions, el('h2', 'section-title', 'このパルが生まれる配合'), children,
    el('h2', 'section-title', 'このパルを親に使う配合（相手 → 子）'), parents);
  return watchView(context.store, element, (state) => {
    if (dataPending(children, state)) { parents.replaceChildren(); return; }
    const childRecords = findByChild(state.index, pal.id);
    const parentRecords = findByParent(state.index, pal.id);
    renderCards(children, childRecords, context);
    renderCards(parents, parentRecords, context, { focusParent: pal.id });
    if (!childRecords.length) children.append(empty('この子の配合はまだ登録されていません。'));
    if (!parentRecords.length) parents.append(empty('このパルを親に使う配合はまだ登録されていません。'));
  });
}
