import { el, link, button, empty } from '../ui/dom.js';
import { palsById, palIcon, elementChips } from '../ui/pal-icon.js';
import { findByChild, findByParent } from '../core/index.js';
import { buildHash } from '../router.js';
import { viewHeading, renderCards, watchView, dataPending } from './shared.js';
import { goalToggle } from '../ui/goal-toggle.js';

/** 右のドロワーで開くパル詳細（見出しはドロワーの h2。パル ID が不正なら null で、ドロワーが「見つかりません」を出す） */
export function palDrawer(context, palId) {
  const pal = palsById.get(palId);
  if (!pal) return null;
  const element = el('div', 'pal-drawer');
  const hero = el('div', 'pal-hero');
  hero.append(palIcon(pal, { large: true }), elementChips(pal));
  element.append(hero);
  return { title: `No.${pal.label} ${pal.ja}`, element, destroy() {} };
}

export function palView(context, route) {
  const element = el('section', 'view');
  const pal = palsById.get(route.id);
  if (!pal) {
    context.replace(buildHash('pal'));
    element.append(empty('パルが見つかりません。', link('配合を探すへ', buildHash('search'), 'button primary')));
    return { element, destroy() {} };
  }
  // 見出しはパル名（「No.117 ソルレイス」）。名前が二重に出ないよう、hero は絵と属性だけにする
  element.append(viewHeading(`No.${pal.label} ${pal.ja}`));
  const hero = el('div', 'pal-hero');
  hero.append(palIcon(pal, { large: true }), elementChips(pal));
  const actions = el('div', 'pal-hero-actions');
  // 「この子の配合を登録」は、このパルが産まれる配合が 1 件でもあれば控えめ（secondary）、0 件なら primary（F075。描くたびに合わせる）
  const register = button('この子の配合を登録', () => context.register({ childId: pal.id }), 'button primary');
  // ショートカット N でも同じ初期値で開く（app.js が registerInitial を読む）
  register.title = 'キーボードの N でも開けます';
  register.setAttribute('aria-keyshortcuts', 'N');
  // 「☆ 目標に登録」（種族だけの目標。作れるようになったら・完成したらベルで知らせる。goals-merge）
  const goal = goalToggle(context, pal.id);
  actions.append(link('ここから継承ルート', buildHash('route', { from: pal.id }), 'button secondary'),
    link('ここへの継承ルート', buildHash('route', { to: pal.id }), 'button secondary'), goal.element, register);
  const children = el('div', 'card-stack');
  const parents = el('div', 'card-stack');
  element.append(hero, actions, el('h2', 'section-title', 'このパルが産まれる配合'), children,
    el('h2', 'section-title', 'このパルを親に使う配合（相手 → 子）'), parents);
  const view = watchView(context.store, element, (state) => {
    if (dataPending(children, state, () => context.store.refresh())) { renderCards(parents, [], context); return; }
    const born = findByChild(state.index, pal.id);
    register.className = born.length ? 'button secondary' : 'button primary';
    renderCards(children, born.map((record) => ({ record })), context, {
      empty: () => empty('この子の配合はまだ登録されていません。'),
    });
    renderCards(parents, findByParent(state.index, pal.id).map((record) => ({ record, focusParent: pal.id })), context, {
      empty: () => empty('このパルを親に使う配合はまだ登録されていません。'),
    });
  });
  return { ...view, registerInitial: () => ({ childId: pal.id }), destroy() { goal.destroy(); view.destroy(); } };
}
