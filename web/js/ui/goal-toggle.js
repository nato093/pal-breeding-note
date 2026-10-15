// 「☆ 目標に保存」の押しボタン（goals-merge。D5）。その種族を「種族だけの目標」（パッシブなし・個体値の条件なし）として保存・外す。
// パル詳細と、配合を探すで子だけを選んで 0 件のときに置く。登録した目標は理想個体の目標の一覧に並び、配合が登録されたらベルで知らせる。
import { el, button } from './dom.js';
import { icon } from './icons.js';
import { palsById } from './pal-icon.js';
import { toast } from './toast.js';
import { speciesGoal, goalKey, cleanGoal } from '../core/ideal-goals.js';

/**
 * @param {object} context ideals（目標のストア）を持つ
 * @param {string} palId
 * @param {{ className?: string, label?: string }} [options] label は未保存のときの文（既定「目標に保存」）
 * @returns {{ element: HTMLButtonElement, update(): void, destroy(): void }} ideals の変化で表示を合わせる
 */
const SAVED = '目標に保存済み';

export function goalToggle(context, palId, { className = 'button secondary', label = '目標に保存' } = {}) {
  const ideals = context.ideals;
  const name = palsById.get(palId)?.ja ?? palId;
  const conditions = speciesGoal(palId, { name });
  const key = goalKey(cleanGoal({ ...conditions, id: 'check' }));
  // ダブルクリックの 2 回目（detail が 2 以上）は捨てる（登録してすぐ外さない）
  const element = button('', (event) => { if (!(event?.detail > 1)) toggle(); }, `${className} goal-toggle`.trim());
  // 星は前のウィッシュリストのタブのアイコン（ui/icons.js の star）。登録済みは塗る（CSS）
  const mark = icon('star', { className: 'goal-toggle-star' });
  // 文は長い方で幅を取る（押して「目標に保存済み」に変わっても、ボタンの幅と隣の部品の位置を変えない。CSS の ::after）
  const text = el('span', 'goal-toggle-text');
  text.setAttribute('data-size', label.length >= SAVED.length ? label : SAVED);
  element.append(mark, text);
  const registered = () => (ideals?.list() ?? []).find((goal) => goalKey(goal) === key) ?? null;

  function update() {
    const goal = registered();
    element.setAttribute('aria-pressed', String(Boolean(goal)));
    element.classList.toggle('is-registered', Boolean(goal));
    const next = goal ? SAVED : label;
    if (text.textContent !== next) text.textContent = next;
    element.title = goal ? '押すと目標から外します' : `${name}を目標にします（作れるようになったらベルで知らせます）`;
    element.hidden = !ideals;
  }

  function toggle() {
    if (!ideals) return;
    const goal = registered();
    if (goal) {
      const scope = ideals.scope();
      const removed = ideals.remove(goal.id, scope);
      if (!removed) {
        if (context.store?.state?.renaming) toast('ID の変更が終わってから外してください');
        return;
      }
      toast(`${name}を目標から外しました`, { action: () => {
        if (!ideals.restore(removed.goal, removed.index, scope, removed.observation)) toast('元に戻せませんでした', { kind: 'error' });
      } });
      return;
    }
    const result = ideals.add(conditions);
    if (result === 'full') toast('目標は 100 件までです', { kind: 'error' });
    else if (result === null) toast(context.store?.state?.renaming ? 'ID の変更が終わってから保存してください' : 'ログインしてから保存してください');
    else if (result === 'added') toast(`${name}を目標に保存しました（作れるようになったら知らせます）`);
  }

  const unsubscribe = ideals?.subscribe(update) ?? (() => {});
  update();
  return { element, update, destroy: unsubscribe };
}
