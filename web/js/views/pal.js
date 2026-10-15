import { el, link, empty } from '../ui/dom.js';
import { buildHash } from '../router.js';
import { palDetail } from './pal-detail.js';

/**
 * 右のドロワーで開くパル詳細（見出しはドロワーの h2。パル ID が不正なら null で、ドロワーが「見つかりません」を出す）。
 * パル切り替えは同じドロワーで差し替える（「←」で前のパルへ戻れる）
 */
export function palDrawer(context, palId) {
  return palDetail(context, palId, { mode: 'drawer', onSwitch: (id) => context.drawer?.open({ kind: 'pal', id }) });
}

/** 全画面のパル詳細（`#/pal/<id>`。直リンク・新しいタブ・ドロワーの「ページで開く」） */
export function palView(context, route) {
  const element = el('section', 'view pal-view');
  const detail = palDetail(context, route.id, { mode: 'page' });
  if (!detail) {
    context.replace(buildHash('pal'));
    element.append(empty('パルが見つかりません。', link('配合を探すへ', buildHash('search'), 'button primary')));
    return { element, destroy() {} };
  }
  element.append(detail.element);
  return { element, registerInitial: detail.registerInitial, destroy() { detail.destroy(); } };
}
