import { el, link, empty } from '../ui/dom.js';
import { palPicker } from '../ui/pal-picker.js';
import { palTile, palsById } from '../ui/pal-icon.js';
import { actionIcon, icons } from '../ui/breeding-card.js';
import { toast } from '../ui/toast.js';
import { findByChild } from '../core/index.js';
import { buildHash } from '../router.js';
import { viewHeading, watchView, dataPending } from './shared.js';

// 一覧の「作成可能」は、逆引きと同じく画面に出ているデータ（送信待ちを含む）で判定する。通知の判定は wishlist.js が確定データで行う。
export function wishlistView(context) {
  const { store, wishlist } = context;
  const element = el('section', 'view wishlist-view');
  const panel = el('div', 'selection-panel');
  const storageWarning = el('p', 'form-errors wishlist-warning',
    'この端末にウィッシュリストを保存できませんでした。ページを閉じると、保存できなかった変更は失われます。');
  storageWarning.setAttribute('role', 'alert');
  const note = el('p', 'result-note');
  const results = el('div');
  element.append(viewHeading('ウィッシュリスト'),
    el('p', 'wishlist-explanation', '作りたいパルを追加しておくと、配合が登録されて作れるようになったときに右上のベルで知らせます。'),
    panel, storageWarning, note, results);
  let picker;
  let destroyed = false;
  let shown = null;

  function mountPicker(focus = false) {
    picker?.destroy();
    picker = palPicker({ label: '作りたいパル', onChange: add });
    panel.replaceChildren(picker.element);
    if (focus) picker.element.querySelector('.picker-trigger')?.focus();
  }

  // 選んだらすぐ追加し、続けて選べるよう選択欄を空に戻す。
  function add(id) {
    if (!id) return;
    const added = wishlist.add(id);
    if (added === null) toast('配合を読み込んでから追加してください');
    else if (!added) toast(`${palsById.get(id).ja}はすでにウィッシュリストにあります`);
    mountPicker(true);
  }

  function remove(palId) {
    const key = wishlist.scope();
    const removed = wishlist.remove(palId, key);
    if (!removed) return;
    toast(`${palsById.get(palId).ja}をウィッシュリストから外しました`, { action: () => { wishlist.restore(removed.wish, removed.index, key); } });
  }

  function row(palId, craftable) {
    const item = el('li', `wishlist-row${craftable ? ' craftable' : ''}`);
    const main = craftable ? link('', buildHash('reverse', { c: palId }), 'wishlist-main') : el('div', 'wishlist-main');
    main.append(palTile(palId, { clickable: false }), el('span', `wishlist-status${craftable ? ' ready' : ''}`, craftable ? '作成可能' : 'まだ作れません'));
    if (craftable) main.append(el('span', 'wishlist-hint', '逆引きで見る →'));
    item.append(main, actionIcon(`${palsById.get(palId).ja}をウィッシュリストから外す`, icons.remove, () => remove(palId), 'danger-text'));
    return item;
  }

  function update() {
    if (destroyed) return;
    storageWarning.hidden = !wishlist.saveFailed;
    if (dataPending(results, store.state)) {
      note.textContent = '';
      shown = null;
      return;
    }
    const wishes = wishlist.list();
    const craftable = new Set(wishes.filter((wish) => findByChild(store.state.index, wish.palId).length).map((wish) => wish.palId));
    // 作れるパルを上に、それぞれ追加の新しい順に並べる。
    const ordered = [...wishes.filter((wish) => craftable.has(wish.palId)), ...wishes.filter((wish) => !craftable.has(wish.palId))];
    // 記録を取得するたびに作り直すと、操作中のフォーカスを失うため、並びと状態が変わったときだけ描き直す。
    const key = ordered.map((wish) => `${wish.palId}:${craftable.has(wish.palId)}`).join(',');
    if (key === shown) return;
    shown = key;
    note.textContent = wishes.length ? `${wishes.length} 件のパル` : '';
    if (!wishes.length) {
      results.replaceChildren(empty('作りたいパルはまだありません。上の選択欄から追加できます。'));
      return;
    }
    const list = el('ul', 'wishlist');
    for (const wish of ordered) list.append(row(wish.palId, craftable.has(wish.palId)));
    results.replaceChildren(list);
  }

  mountPicker();
  const unsubscribe = wishlist.subscribe(update);
  const view = watchView(store, element, update);
  return {
    element,
    destroy() {
      destroyed = true;
      view.destroy();
      unsubscribe();
      picker.destroy();
    },
  };
}
