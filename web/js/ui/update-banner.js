import { el, button, trackHeight } from './dom.js';

const RETRY_AFTER = 5000;

// 新しい版が配信されたことを知らせる帯。「読み込み直す」は、今の操作を失わないことと、
// 新しい版が実際に配信されていることを確かめてから再読み込みする。
// busy: 再読み込みすると失われる操作（保存・読み込み）の最中なら、その説明を返す
// current: 実行中の版 / served: 配信中の版を返す（servedVersion） / reload: 再読み込み
export function updateBanner({ current, busy, served, reload, delay = setTimeout }) {
  const element = el('section', 'update-banner');
  element.setAttribute('role', 'status');
  element.hidden = true;
  const message = el('p', 'update-banner-message');
  const hint = el('p', 'update-banner-hint');
  const text = el('div', 'update-banner-text');
  text.append(message, hint);
  let version = '';
  let dismissed = '';
  const reloadButton = button('読み込み直す', async () => {
    const waiting = busy();
    if (waiting) { hint.textContent = waiting; return; }
    reloadButton.disabled = true;
    reloadButton.textContent = '確認中…';
    try {
      const latest = await served();
      // 確認している間に始まった操作も守る
      const started = busy();
      if (started) hint.textContent = started;
      else if (!latest || latest === current) hint.textContent = '配信の途中です。少し待ってからもう一度押してください。';
      else {
        reloadButton.textContent = '読み込み中…';
        reload();
        // 再読み込みが取り消されたときに、もう一度押せるようにする
        delay(restore, RETRY_AFTER);
        return;
      }
    } catch {
      hint.textContent = '新しいバージョンを確認できませんでした。もう一度押してください。';
    }
    restore();
  }, 'button primary');
  // 帯が出ている間は文書の根（html）に .has-update-banner を付け、帯の高さを --snackbar-height に書き続ける（CSS がトーストを
  // 帯の上に積む。:has() で帯を探すと、本文の要素を出し入れするたびに画面全体のスタイルを計算し直させるので使わない）。
  // 高さは初めて出したときから測り続け（文が折り返すと高くなる）、出すたびにすぐ測る（ResizeObserver の知らせを待つ間に出た
  // トーストが帯に重ならないように）
  let tracking = null;
  const showing = (visible) => {
    element.hidden = !visible;
    const root = globalThis.document?.documentElement;
    root?.classList.toggle('has-update-banner', visible);
    if (!visible || !root?.style) return;
    tracking ??= trackHeight(element, root, '--snackbar-height');
    tracking.measure();
  };
  const close = button('閉じる', () => {
    dismissed = version;
    showing(false);
  }, 'button secondary');
  const actions = el('div', 'update-banner-actions');
  actions.append(reloadButton, close);
  element.append(text, actions);

  function restore() {
    reloadButton.disabled = false;
    reloadButton.textContent = '読み込み直す';
  }

  return {
    element,
    // 閉じた版のままなら出さない（さらに新しい版が来たら出す）
    show({ version: next, notes }) {
      if (next === dismissed) return;
      version = next;
      const extra = notes.length > 1 ? `（ほか ${notes.length - 1} 件）` : '';
      message.textContent = notes.length ? `新しいバージョンがあります：${notes[0].title}${extra}` : '新しいバージョンがあります';
      hint.textContent = '読み込み直すと反映されます。';
      restore();
      showing(true);
    },
  };
}
