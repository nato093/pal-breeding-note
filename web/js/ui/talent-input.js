import { el, button, debounce } from './dom.js';

// 欄の文字を保存の形の値（0〜100 の整数）にする。読めない値・負の値は 0（条件なし）
const clamp = (text) => Math.max(0, Math.min(100, Math.trunc(Number(text)) || 0));

/**
 * 個体値の下限の入力（ステータスごとに ☑ ラベル [数値] 以上）。値の形は保存と同じ { hp, shot, defense }（0〜100 の整数。0 は条件なし）。
 * 画面ではチェックを外すか空欄で条件なし（D4）。保存の「0＝条件なし」はこの部品の境界で変換する。
 * キーとラベルは呼び出し側が渡す（遺伝の仕組み core/ideal.js を import しない。INV-2 の import の制限）。
 * @param {{ keys: string[], labels: Record<string, string>, value: Record<string, number>,
 *   ariaLabel: (key: string) => string, presets?: { label: string, value: Record<string, number> }[],
 *   onChange: (value: Record<string, number>) => void, debounce?: number }} options
 *   debounce は数値の入力を間引く時間（ms。既定 150。0 なら打った時点で知らせる）
 * @returns {{ element: HTMLElement, update(value: Record<string, number>): void, flush(): void, destroy(): void }}
 *   update は外からの反映（知らせない）、flush は間引いて待っている入力をすぐ知らせる
 */
export function talentInput({ keys, labels, value = {}, ariaLabel, presets = [], onChange, debounce: delay = 150 }) {
  const element = el('div', 'talent-input');
  // ステータスごとの checked と draft（入力欄の文字）。チェックを外しても draft は残す（値は保持して薄く出す）
  const states = new Map();
  let composing = false;
  let destroyed = false;

  const read = () => Object.fromEntries(keys.map((key) => {
    const state = states.get(key);
    return [key, state.checked && state.draft !== '' ? clamp(state.draft) : 0];
  }));
  const later = debounce(() => { if (!destroyed) onChange(read()); }, delay);
  // 間引かずに知らせる（待っている入力は、この 1 回に含める）
  const now = () => {
    later.cancel();
    if (!destroyed) onChange(read());
  };
  // チェックの印と、チェックのない欄を薄くするクラス（入力中の欄の文字は書き換えない）
  const mark = (state) => {
    state.check.checked = state.checked;
    state.item.classList.toggle('is-off', !state.checked);
  };
  const show = (state) => {
    mark(state);
    state.number.value = state.draft;
  };
  // 外から来た値: v>0 はチェックつき・その値、0 はチェックなし・空欄
  const apply = (state, v) => {
    state.checked = v > 0;
    state.draft = v > 0 ? String(v) : '';
    show(state);
  };

  for (const key of keys) {
    const item = el('label', 'talent-input-item');
    const check = el('input');
    check.type = 'checkbox';
    check.setAttribute('aria-label', `${labels[key]}を条件にする`);
    const number = el('input');
    number.type = 'number';
    number.min = '0';
    number.max = '100';
    number.step = '1';
    number.inputMode = 'numeric';
    number.placeholder = '—';
    number.title = '空欄かチェックなしは条件なし';
    number.setAttribute('aria-label', ariaLabel(key));
    item.append(check, el('span', 'talent-input-label', labels[key]), number, el('span', 'talent-input-unit', '以上'));
    // pressed: 数値欄の外（チェックボックス・ラベル）を押している。押したことで数値欄から離れたときは、空欄でもチェックを外さない
    //（外すと、続く click でチェックがまた付き、空欄のチェックを押して外せなくなる）
    const state = { item, check, number, checked: false, draft: '', pressed: false };
    states.set(key, state);
    apply(state, clamp(value[key]));

    // 打った文字。数字が入ったらチェックを付け、間引いてから知らせる
    const typed = () => {
      state.draft = number.value;
      if (state.draft !== '' && !state.checked) {
        state.checked = true;
        mark(state);
      }
      later();
    };
    number.addEventListener('compositionstart', () => { composing = true; });
    number.addEventListener('compositionend', () => { composing = false; typed(); });
    number.addEventListener('input', (event) => {
      if (composing || event?.isComposing) return;
      typed();
    });
    // 確定（Enter・欄を離れる）: 待っている入力をすぐ知らせ、欄を丸めた値に書き戻す（101 → 100。0 は空欄にしてチェックを外す。値は変わらない）
    number.addEventListener('change', () => {
      if (composing) return;
      if (number.value !== state.draft) typed();
      later.flush();
      if (state.draft === '') return;
      const v = clamp(state.draft);
      state.draft = v > 0 ? String(v) : '';
      if (!v) state.checked = false;
      show(state);
    });
    number.addEventListener('focus', () => { state.pressed = false; });
    // 空欄のまま離れたら、チェックを外す（値は 0 のまま）
    number.addEventListener('blur', () => {
      if (state.pressed || state.draft !== '' || !state.checked) return;
      state.checked = false;
      mark(state);
    });
    item.addEventListener('pointerdown', (event) => { if (event?.target !== number) state.pressed = true; });
    check.addEventListener('change', () => {
      state.pressed = false;
      state.checked = check.checked;
      mark(state);
      now();
      // 空欄にチェックを付けたら、続けて数字を打てるように数値欄へ
      if (state.checked && state.draft === '') number.focus();
    });
    element.append(item);
  }

  for (const preset of presets) {
    element.append(button(preset.label, () => {
      for (const key of keys) apply(states.get(key), clamp(preset.value[key]));
      now();
    }, 'button secondary small'));
  }

  return {
    element,
    /** 外からの反映（登録した目標の呼び出し・戻る・進む）。出している値と同じステータスは触らない（薄くした数字・打っている途中の数字を残す） */
    update(next = {}) {
      later.cancel();
      const current = read();
      for (const key of keys) {
        const v = clamp(next[key]);
        if (v !== current[key]) apply(states.get(key), v);
      }
    },
    flush() { later.flush(); },
    destroy() {
      destroyed = true;
      later.cancel();
    },
  };
}
