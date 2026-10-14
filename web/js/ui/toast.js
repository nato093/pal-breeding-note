import { el, button } from './dom.js';

/** 文言だけの知らせを出す時間 */
export const TOAST_DURATION = 3000;
/** 元に戻す・入力し直すなど操作つきの知らせを出す時間（読んで押すまでの時間） */
export const ACTION_DURATION = 6000;
/** エラーを出す時間（× でも閉じられる） */
export const ERROR_DURATION = 6000;
// 閉じる動きの長さ（app.css の .toast.leaving と同じ）
const LEAVE_MS = 150;

// 消えかけている（.leaving の）トースト。ダイアログを閉じたときに次の表示先へ移さない
const leaving = new WeakSet();
// トースト → 表示先を移した後に、止める・再開するを確かめ直す関数
const moved = new WeakMap();

let region;
// 一番手前のダイアログ（なければ本文）に出す。成功の知らせは応答後に出るため、無関係なダイアログに出ることがある。
// そのダイアログを閉じても、残っている知らせ（元に戻すなど）は消さずに次の表示先へ移す。
// 表示先（.toast-region）は位置を決める入れ物で、中にふつうの知らせ（.toast-list・aria-live="polite"）と
// エラー（.toast-alerts・中のトーストが role=alert）の 2 つのリストを置く（同じ入れ物に入れると二重に読み上げられる）
function currentRegion() {
  const host = [...document.querySelectorAll('dialog[open]')].at(-1) ?? document.body;
  if (region?.isConnected && region.parentElement === host) return region;
  // 前に作った表示先が残っていれば使う（ダイアログに出している間に region が指す先が変わっても、本文に 2 つ作らない）
  const existing = [...host.children].find((node) => node.className === 'toast-region');
  if (existing) return (region = existing);
  const created = el('div', 'toast-region');
  const list = el('div', 'toast-list');
  list.setAttribute('aria-live', 'polite');
  created.append(list, el('div', 'toast-alerts'));
  host.append(created);
  if (host !== document.body) host.addEventListener('close', () => {
    const next = currentRegion();
    for (const name of ['toast-list', 'toast-alerts']) {
      const target = next.querySelector(`.${name}`);
      for (const node of [...created.querySelector(`.${name}`).children]) {
        if (leaving.has(node)) continue;
        target.append(node);
        moved.get(node)?.();
      }
    }
  }, { once: true });
  region = created;
  return created;
}

/**
 * 画面の下中央に短い知らせを出す。戻り値は閉じる関数（何度呼んでもよい）。
 * 操作つき（action）とエラー（kind: 'error'）は 6 秒、文言だけは 3 秒。マウスが乗っている間とフォーカスがある間は止め、
 * 残り時間から再開する（WCAG 2.2.1）。エラーは role=alert で、右端の ×（閉じる）で閉じられる
 * @param {string} message
 * @param {{ action?: () => any, actionLabel?: string, duration?: number, kind?: 'info'|'error' }} [options]
 */
export function toast(message, { action, actionLabel = '元に戻す', duration, kind = 'info' } = {}) {
  const error = kind === 'error';
  const total = duration ?? (error ? ERROR_DURATION : action ? ACTION_DURATION : TOAST_DURATION);
  const node = el('div', `toast${error ? ' toast-error' : ''}${action ? ' with-action' : ''}`);
  if (error) node.setAttribute('role', 'alert');
  // 下端の残り時間の線（CSS の animation）の長さ。style 属性の文字列は使わない
  node.style.setProperty('--toast-duration', `${total}ms`);
  node.append(el('span', 'toast-message', message));
  let timer = null;
  let remaining = total;
  let startedAt = 0;
  let closed = false;
  let running = false;
  let pointer = false;
  let focused = false;

  function dismiss() {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    timer = null;
    // 動きを減らす設定か、matchMedia がない（テストの DOM）ときはすぐ消す
    if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches !== false) {
      node.remove();
      return;
    }
    leaving.add(node);
    node.classList.add('leaving');
    // 薄くなっている間に元に戻すを押し違えないよう、中のボタンを押せなくする
    for (const control of node.querySelectorAll('button')) control.disabled = true;
    setTimeout(() => node.remove(), LEAVE_MS);
  }

  function pause() {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    remaining = Math.max(0, remaining - (Date.now() - startedAt));
    node.classList.toggle('paused', true);
  }

  function resume() {
    if (closed || running || pointer || focused || timer !== null) return;
    node.classList.toggle('paused', false);
    startedAt = Date.now();
    timer = setTimeout(dismiss, remaining);
  }

  node.addEventListener('pointerenter', () => { pointer = true; pause(); });
  node.addEventListener('pointerleave', () => { pointer = false; resume(); });
  node.addEventListener('focusin', () => { focused = true; pause(); });
  node.addEventListener('focusout', (event) => {
    if (event.relatedTarget && node.contains(event.relatedTarget)) return;
    focused = false;
    resume();
  });
  // ダイアログを閉じて表示先を移したとき: フォーカスは前の場所へ戻っているので確かめ直し、線は経った時間の分から続ける
  // （付け直すと CSS の animation が初めからになるため）
  moved.set(node, () => {
    focused = node.contains(globalThis.document?.activeElement);
    const elapsed = total - (timer === null ? remaining : remaining - (Date.now() - startedAt));
    node.style.setProperty('--toast-delay', `-${Math.max(0, Math.round(elapsed))}ms`);
    if (focused) pause();
    else resume();
  });

  if (action) {
    const undo = button(actionLabel, async () => {
      if (running || closed) return;
      running = true;
      undo.disabled = true;
      clearTimeout(timer);
      timer = null;
      try { await action(); dismiss(); } catch (failure) {
        dismiss();
        toast(failure.message, { kind: 'error' });
      }
    }, 'button toast-action');
    node.append(undo);
  }
  if (error) {
    // visual-parts で SVG のアイコンに替える
    const close = button('×', dismiss, 'toast-close');
    close.setAttribute('aria-label', '閉じる');
    close.title = '閉じる';
    node.append(close);
  }
  currentRegion().querySelector(error ? '.toast-alerts' : '.toast-list').append(node);
  resume();
  return dismiss;
}
