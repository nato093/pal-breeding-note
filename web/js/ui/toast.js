import { el, button } from './dom.js';
import { icon } from './icons.js';

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
 * 閉じるトーストの中にフォーカスがあれば（キーボードで「元に戻す」・× を押した）、トーストに入る直前にフォーカスがあった要素
 * （まだ文書にあり、押せるもの）へ戻す。なければ表示先の見出し（ダイアログならその h2、本文なら main の h1。tabIndex -1 にする）へ。
 * どれもなければ動かさない。中にフォーカスがなければ（マウスで押した・時間切れ）何もしない
 */
function returnFocus(node, before) {
  const doc = globalThis.document;
  if (!doc || !node.contains(doc.activeElement)) return;
  const usable = (target) => Boolean(target?.isConnected) && typeof target.focus === 'function'
    && !target.disabled && !target.hidden && !node.contains(target);
  if (usable(before)) {
    before.focus({ preventScroll: true });
    return;
  }
  // .toast-list・.toast-alerts → .toast-region → 表示先（一番手前のダイアログか body）
  const host = node.parentElement?.parentElement?.parentElement;
  const heading = host && host !== doc.body ? host.querySelector('h2') : doc.getElementById?.('main')?.querySelector('h1');
  if (!heading?.isConnected) return;
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
}

/**
 * 画面の下中央に短い知らせを出す。戻り値は閉じる関数（何度呼んでもよい）。
 * 操作つき（action）とエラー（kind: 'error'）は 6 秒、文言だけは 3 秒。マウスが乗っている間とフォーカスがある間は止め、
 * 残り時間から再開する（WCAG 2.2.1）。エラーは role=alert で、右端の ×（閉じる）で閉じられる。
 * キーボードで中のボタンを押して閉じたときは、トーストに入る前の要素へフォーカスを戻す（returnFocus）
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
  // トーストに入る直前にフォーカスがあった要素（閉じるときに戻す先）
  let returnTo = null;

  function dismiss() {
    if (closed) return;
    closed = true;
    // 消す・中のボタンを押せなくする前に、フォーカスを戻す（そのままだと body に落ちる）
    returnFocus(node, returnTo);
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
  node.addEventListener('focusin', (event) => {
    // 外から入ったときだけ、入る前の要素を覚える（中の要素どうしで動いたときは書き換えない）
    if (event.relatedTarget && !node.contains(event.relatedTarget)) returnTo = event.relatedTarget;
    focused = true;
    pause();
  });
  node.addEventListener('focusout', (event) => {
    if (event.relatedTarget && node.contains(event.relatedTarget)) return;
    focused = false;
    resume();
  });
  // ダイアログを閉じて表示先を移したとき: フォーカスは前の場所へ戻っているので確かめ直す。マウスも、移した後に pointerleave・
  // pointerenter が届かないことがあるので、乗っているか（:hover。matches がなければ乗っていない）で置き直す。
  // 線は経った時間の分から続ける（付け直すと CSS の animation が初めからになるため）
  moved.set(node, () => {
    focused = node.contains(globalThis.document?.activeElement);
    pointer = Boolean(node.matches?.(':hover'));
    const elapsed = total - (timer === null ? remaining : remaining - (Date.now() - startedAt));
    node.style.setProperty('--toast-delay', `-${Math.max(0, Math.round(elapsed))}ms`);
    if (focused || pointer) pause();
    else resume();
  });

  if (action) {
    const undo = button(actionLabel, async () => {
      if (running || closed) return;
      running = true;
      // 押したボタンを押せなくするとフォーカスが body に落ちるので、その前に戻す（操作の中で別の所へ移すのは構わない）
      returnFocus(node, returnTo);
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
    // × は SVG のアイコン（ui/icons.js の close）。名前は aria-label と title
    const close = button('', dismiss, 'toast-close');
    close.append(icon('close', { className: 'close-icon' }));
    close.setAttribute('aria-label', '閉じる');
    close.title = '閉じる';
    node.append(close);
  }
  currentRegion().querySelector(error ? '.toast-alerts' : '.toast-list').append(node);
  resume();
  return dismiss;
}
