import { el } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { buildHash } from '../router.js';
import { palDetail } from './pal-detail.js';
import { paldexView } from './paldex.js';

/**
 * 右のドロワーで開くパル詳細（見出しはドロワーの h2。パル ID が不正なら null で、ドロワーが「見つかりません」を出す）。
 * パル切り替えは同じドロワーで差し替える（「←」で前のパルへ戻れる）
 */
export function palDrawer(context, palId) {
  return palDetail(context, palId, { mode: 'drawer', onSwitch: (id) => context.drawer?.open({ kind: 'pal', id }) });
}

/**
 * 全画面のパル詳細（`#/pal/<id>`。直リンク・新しいタブ・ドロワーの「ページで開く」）。ID がなければ図鑑の格子（`#/pal`。paldex）。
 * 不正な ID は「パルが見つかりません」と知らせ、URL を `#/pal` に直して図鑑を出す（前は行き止まりの「見つかりません」と「配合を探すへ」）
 */
export function palView(context, route) {
  if (!route.id) return paldexView(context);
  const detail = palDetail(context, route.id, { mode: 'page' });
  if (!detail) {
    toast('パルが見つかりません');
    context.replace(buildHash('pal'));
    return paldexView(context);
  }
  const element = el('section', 'view pal-view');
  element.append(detail.element);
  return { element, registerInitial: detail.registerInitial, destroy() { detail.destroy(); } };
}
