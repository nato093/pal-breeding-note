// 配合のカード・継承ルート・登録の画面に重ねる「その種族を何体持っているか」の小さな印。数は core/owned.js の ownedCounts。
import { el, link } from './dom.js';
import { genderMark } from './pal-icon.js';
import { buildHash } from '../router.js';

/** 親にできない個体の内訳つきの全文（title） */
function ownedTitle(entry) {
  const blocked = entry.eggs + entry.globals + entry.unknown;
  const detail = blocked ? `（うちタマゴ ${entry.eggs}・グローバルパルボックス ${entry.globals}・性別不明 ${entry.unknown} は親にできません）` : '';
  return `所持 ${entry.total} 体${detail}`;
}

/**
 * 所持の印。押すと所持パルをその種族で開く（`#/owned?pal=<ID>`）。
 * - 親（role 'parent'）: 親にできる ♂・♀ の数（「♂2 ♀1」。性別の記号は色だけの genderMark）。1 体もなければ薄い字の「未所持」、
 *   持っているが親にできない個体（タマゴ・グローバルパルボックス・性別不明）だけなら「タマゴ等のみ」。全文は title
 * - 子（role 'child'）: 1 体以上のときだけ「所持 N」（なければ null）
 * @param {Map<string, { total, eggs, globals, male, female, unknown }>} counts
 * @returns {HTMLElement | null}
 */
export function ownedBadge(counts, palId, { role = 'parent' } = {}) {
  const entry = counts?.get(palId);
  if (role === 'child') {
    if (!entry?.total) return null;
    const node = link(`所持 ${entry.total}`, buildHash('owned', { pal: palId }), 'owned-count is-child');
    node.title = ownedTitle(entry);
    return node;
  }
  if (!entry?.total) {
    const none = el('span', 'owned-count is-none', '未所持');
    return none;
  }
  const node = link('', buildHash('owned', { pal: palId }), 'owned-count');
  node.title = ownedTitle(entry);
  if (!entry.male && !entry.female) {
    node.classList.add('is-blocked');
    node.textContent = 'タマゴ等のみ';
    return node;
  }
  // 「♂2 ♀1」（0 の性別も出す。並びを固定して見比べやすく）。読み上げは「オス 2 メス 1」（genderMark の aria-label）
  node.append(genderMark('M', { inline: true }), el('span', 'owned-count-num', String(entry.male)),
    genderMark('F', { inline: true }), el('span', 'owned-count-num', String(entry.female)));
  return node;
}

/** 印の文（カードの key に入れて、所持の数が変わったカードだけ作り直す） */
export function ownedBadgeText(counts, palId, role = 'parent') {
  const entry = counts?.get(palId);
  if (!entry?.total) return '';
  return role === 'child' ? `c${entry.total}` : `${entry.male}/${entry.female}/${entry.total}/${entry.eggs}/${entry.globals}/${entry.unknown}`;
}
