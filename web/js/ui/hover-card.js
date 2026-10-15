// ホバーの解説の板（F059）。パルのタイル（data-pal-id）とパッシブのチップ（data-passive-id）に、少し止まる・フォーカスすると軽い板を出す。
// 委譲のリスナーを root に 1 組だけ置く（行ごとにリスナーを付けない。所持パルの 2,000 行の予算）。板は body に 1 つだけ浮かせる。
// パルのタイルはクリックで右のドロワーを開くので、板はホバーとフォーカスだけ。パッシブのチップはクリック・Enter で板を固定し、
// もう一度押す・外側を押す・Esc で外す（リンク・ボタンの中のチップは固定しない）。件数は登録済みの記録と所持パルを数えるだけ（INV-2）
import { el } from './dom.js';
import { palsById, palIcon, elementChips } from './pal-icon.js';
import { passivesById } from './passive-picker.js';
import { placeFloating } from './popover.js';
import { ownedCounts, passiveCounts } from '../core/owned.js';

/** 板を出すまでの時間（ms。通りすがりのカーソルでは出さない） */
export const HOVER_DELAY = 200;

let sequence = 0;
// 所持パルのデータごとに 1 回だけ数える（種族ごとの所持数と、パッシブごとの所持数）
const countCache = new WeakMap();
function countsOf(pals) {
  let counts = countCache.get(pals);
  if (!counts) countCache.set(pals, counts = { species: ownedCounts(pals), passives: passiveCounts(pals) });
  return counts;
}

// 板の対象: 近い順に data-pal-id か data-passive-id を持つ要素（root の外には出ない）
function targetOf(node, root) {
  for (let current = node; current && current !== root; current = current.parentElement) {
    const passive = current.getAttribute?.('data-passive-id');
    if (passive) return { node: current, kind: 'passive', id: passive };
    const pal = current.getAttribute?.('data-pal-id');
    if (pal) return { node: current, kind: 'pal', id: pal };
  }
  return null;
}
// チップがリンク・ボタン（× を除く）の中にあれば固定しない（入れ子の操作を作らない）
function insideControl(node, root) {
  for (let current = node.parentElement; current && current !== root; current = current.parentElement) {
    const tag = String(current.tagName ?? '').toLowerCase();
    if (tag === 'a' || tag === 'button') return true;
  }
  return false;
}

/** 解説の中身（パル）: 絵・No.・名前・属性と、所持 n 体 · 親になれる ♂n ♀m・登録 n 件（パル詳細と同じ数え方） */
export function palCardContent(palId, { index, owned } = {}) {
  const pal = palsById.get(palId);
  if (!pal) return null;
  const box = el('div', 'hover-card-pal');
  const head = el('div', 'hover-card-head');
  const names = el('div', 'hover-card-names');
  names.append(el('small', 'dex-label', `No.${pal.label}`), el('strong', '', pal.ja));
  head.append(palIcon(pal), names);
  box.append(head, elementChips(pal));
  const facts = [];
  if (Array.isArray(owned?.pals)) {
    const entry = countsOf(owned.pals).species.get(palId);
    facts.push(entry?.total ? `所持 ${entry.total} 体 · 親になれる ♂${entry.male} ♀${entry.female}` : '未所持');
  }
  if (index?.byChild) {
    const born = index.byChild.get(palId)?.length ?? 0;
    const used = index.byParent.get(palId)?.length ?? 0;
    facts.push(`登録 産まれる ${born} 件・親 ${used} 件`);
  }
  if (facts.length) box.append(el('p', 'hover-card-facts', facts.join(' · ')));
  return box;
}

/** 解説の中身（パッシブ）: 名前・ランク・説明と、所持 n 体（所持パルが持っている数。タマゴを含む） */
export function passiveCardContent(passiveId, { owned } = {}) {
  const passive = passivesById.get(passiveId);
  const box = el('div', 'hover-card-passive');
  const head = el('p', 'hover-card-title');
  head.append(el('strong', '', passive?.ja ?? passiveId));
  if (passive?.rank) head.append(el('span', 'hover-card-rank', `ランク ${passive.rank}`));
  box.append(head);
  if (passive?.desc) box.append(el('p', 'hover-card-desc', passive.desc));
  if (Array.isArray(owned?.pals)) {
    const count = countsOf(owned.pals).passives.get(passiveId) ?? 0;
    box.append(el('p', 'hover-card-facts', count ? `所持パルのうち ${count} 体が持っています` : '所持パルは持っていません'));
  }
  return box;
}

/**
 * @param {HTMLElement} root 委譲の入れ物（#app）
 * @param {{ context: object, delay?: number, doc?: Document }} options context は store（記録の索引）と owned（所持パル）
 * @returns {{ element: HTMLElement, show(target: { node: Element, kind: string, id: string }, options?: { pinned?: boolean }): void,
 *   hide(): void, current(): object | null, destroy(): void }}
 */
export function installHoverCards(root, { context, delay = HOVER_DELAY, doc = globalThis.document } = {}) {
  const card = el('div', 'hover-card');
  card.id = `hover-card-${++sequence}`;
  card.setAttribute('role', 'tooltip');
  let shown = null;
  let pinned = false;
  let timer = null;
  let controller = null;
  // 板を出している間だけ title を外す（ブラウザの説明と二重に出さない）
  let stashed = null;
  const stashTitle = (node) => {
    if (stashed?.node === node) return;
    restoreTitle();
    if (node.title) {
      stashed = { node, title: node.title };
      node.title = '';
    }
  };
  function restoreTitle() {
    if (stashed && !stashed.node.title) stashed.node.title = stashed.title;
    stashed = null;
  }
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  function hide() {
    cancel();
    if (!shown) { restoreTitle(); return; }
    shown.node.removeAttribute?.('aria-describedby');
    shown.node.classList?.toggle?.('is-hover-pinned', false);
    shown = null;
    pinned = false;
    controller?.abort();
    controller = null;
    card.remove();
    restoreTitle();
  }

  function show(target, { pinned: pin = false } = {}) {
    cancel();
    const content = target.kind === 'pal'
      ? palCardContent(target.id, { index: context?.store?.state?.index, owned: context?.owned?.state?.owned })
      : passiveCardContent(target.id, { owned: context?.owned?.state?.owned });
    if (!content || !target.node.isConnected) { hide(); return; }
    if (shown && shown.node !== target.node) hide();
    card.replaceChildren(content);
    shown = target;
    pinned = pin;
    target.node.classList?.toggle?.('is-hover-pinned', pin);
    target.node.setAttribute?.('aria-describedby', card.id);
    stashTitle(target.node);
    if (!card.isConnected) doc?.body?.append(card);
    placeFloating(card, target.node, null, { minWidth: 240, maxHeight: 320 });
    if (!controller) {
      controller = new AbortController();
      const { signal } = controller;
      // 本文のスクロール・窓の大きさの変更で外す（板が対象から離れる）。固定した板は外側の pointerdown でも外す
      doc?.addEventListener?.('scroll', () => hide(), { capture: true, passive: true, signal });
      globalThis.window?.addEventListener?.('resize', () => hide(), { signal });
      doc?.addEventListener?.('pointerdown', (event) => {
        if (shown && !shown.node.contains?.(event.target) && !card.contains(event.target)) hide();
      }, { signal });
    }
  }

  function schedule(target) {
    cancel();
    timer = setTimeout(() => {
      timer = null;
      show(target);
    }, delay);
  }

  const onOver = (event) => {
    if (event.pointerType === 'touch') return;
    const target = targetOf(event.target, root);
    if (!target) return;
    if (shown?.node === target.node) { cancel(); return; }
    if (pinned) return;
    // 板の対象は title の説明を出さない（板と二重に出さない）
    stashTitle(target.node);
    schedule(target);
  };
  const onOut = (event) => {
    if (pinned) return;
    const target = targetOf(event.target, root);
    if (!target) return;
    // 同じ対象の中・板への移動では外さない
    const next = event.relatedTarget;
    if (next && (target.node.contains?.(next) || card.contains(next))) return;
    cancel();
    if (shown?.node === target.node) hide();
    else restoreTitle();
  };
  const onFocusIn = (event) => {
    const target = targetOf(event.target, root);
    if (!target) return;
    if (shown?.node === target.node) return;
    if (pinned) hide();
    schedule(target);
  };
  const onFocusOut = (event) => {
    if (pinned) return;
    const target = targetOf(event.target, root);
    if (!target) return;
    const next = event.relatedTarget;
    if (next && target.node.contains?.(next)) return;
    cancel();
    if (shown?.node === target.node) hide();
  };
  const onClick = (event) => {
    const target = targetOf(event.target, root);
    if (!target) return;
    // パルのタイルは押すとドロワーを開くので、板は外す
    if (target.kind !== 'passive') { hide(); return; }
    // × などのボタン・リンクを押したとき、リンクの中のチップは固定しない
    const tag = String(event.target?.tagName ?? '').toLowerCase();
    if (tag === 'button' || tag === 'a' || insideControl(target.node, root)) return;
    if (pinned && shown?.node === target.node) { hide(); return; }
    show(target, { pinned: true });
  };
  const onKey = (event) => {
    if (event.key === 'Escape' && (shown || timer !== null)) {
      hide();
      // ドロワーの Esc（後で呼ばれる）を止める（板だけ外す）
      event.preventDefault?.();
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && event.target?.getAttribute?.('data-passive-id')) {
      const target = targetOf(event.target, root);
      if (!target || insideControl(target.node, root)) return;
      event.preventDefault?.();
      if (pinned && shown?.node === target.node) hide();
      else show(target, { pinned: true });
    }
  };
  root.addEventListener('pointerover', onOver);
  root.addEventListener('pointerout', onOut);
  root.addEventListener('focusin', onFocusIn);
  root.addEventListener('focusout', onFocusOut);
  root.addEventListener('click', onClick);
  // Esc は先に受ける（capture）。ドロワーの Esc より先に板だけを外す
  root.addEventListener('keydown', onKey, { capture: true });

  return {
    element: card,
    show,
    hide,
    current: () => (shown ? { kind: shown.kind, id: shown.id, pinned } : null),
    destroy() {
      hide();
      root.removeEventListener?.('pointerover', onOver);
      root.removeEventListener?.('pointerout', onOut);
      root.removeEventListener?.('focusin', onFocusIn);
      root.removeEventListener?.('focusout', onFocusOut);
      root.removeEventListener?.('click', onClick);
      root.removeEventListener?.('keydown', onKey, { capture: true });
    },
  };
}
