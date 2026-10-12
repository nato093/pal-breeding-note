// ヘッダーの小さなパネル（セーブ連携の状態・ID のメニュー）。ベルの通知欄（notifications.js）と同じ作りで、
// 開いたときだけ中身を作り、外側を押すか Esc で閉じる（リスナーは AbortController で外す）。
// popovers のテーマで ui/popover.js に移す。

/**
 * create({ close }) は開くたびに呼ばれ、{ panel, update? } を返す。update は開いている間の書き換え（閉じない）。
 */
export function headerPopup({ wrapper, trigger, create }) {
  const panelId = `header-popup-${crypto.randomUUID()}`;
  let current = null;
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', panelId);

  function close({ focus = false } = {}) {
    if (!current) return;
    current.controller.abort();
    current.panel.remove();
    current = null;
    trigger.setAttribute('aria-expanded', 'false');
    if (focus) trigger.focus();
  }

  function open() {
    if (current) return;
    const controller = new AbortController();
    const made = create({ close });
    made.panel.id = panelId;
    current = { ...made, controller };
    wrapper.append(made.panel);
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', (event) => { if (!wrapper.contains(event.target)) close(); }, { signal: controller.signal });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close({ focus: true });
    }, { signal: controller.signal });
  }

  return {
    open,
    close,
    toggle() { if (current) close(); else open(); },
    isOpen: () => Boolean(current),
    update() { current?.update?.(); },
  };
}
