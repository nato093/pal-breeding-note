// 押した位置から薄く広がる波紋（M3 のリップル）。見た目は app.css の .ripple。
const TARGETS = '.nav-tab, .button, .register-button, .card-action, .picker-option, .start-chip, .swap-button';

export function installRipple(root = document) {
  root.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    // 動きを減らす設定では出さない（CSS の動きも止まるため、残った要素が消えなくなる）
    if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const host = event.target.closest?.(TARGETS);
    if (!host || host.disabled) return;
    const rect = host.getBoundingClientRect();
    // 押した位置から一番遠い角まで届く大きさにする
    const size = 2 * Math.hypot(Math.max(event.clientX - rect.left, rect.right - event.clientX),
      Math.max(event.clientY - rect.top, rect.bottom - event.clientY));
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.setAttribute('aria-hidden', 'true');
    ripple.style.setProperty('--ripple-x', `${event.clientX - rect.left}px`);
    ripple.style.setProperty('--ripple-y', `${event.clientY - rect.top}px`);
    ripple.style.setProperty('--ripple-size', `${size}px`);
    host.classList.add('ripple-host');
    host.append(ripple);
    // 途中で「動きを減らす」に切り替わるとアニメーションが取り消されて終わりの合図が来ないため、取り消しでも消す
    for (const name of ['animationend', 'animationcancel']) ripple.addEventListener(name, () => ripple.remove(), { once: true });
  }, { capture: true, passive: true });
}
