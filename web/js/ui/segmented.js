import { el, button } from './dom.js';

// 隣へ移るキー（←↑ は前、→↓ は次。端では反対の端へ回る）と、端へ移るキー
const STEPS = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };

/**
 * 押しボタンの選択（1 つだけ選ぶ）。div[role=radiogroup] の中に button[role=radio] を並べ、選んでいるものだけ tabindex=0
 * （ロービングタブインデックス）。←→（↑↓）で隣へ移って選び、Home・End で端へ。
 * choices は [value, 短いラベル, title?] の配列（title は長い説明。値の意味の文は呼び出し側が渡す）。
 * 遺伝の仕組み（core/ideal.js）は import しない（INV-2 の import の制限。ケーキ・パッシブの条件の文は views/ideal.js が渡す）。
 * @param {{ label: string, choices: [string, string, string?][], value: string, onChange: (value: string) => void }} options
 * @returns {{ element: HTMLElement, update(value: string): void, badge(value: string | null, options?: { text?: string, note?: string }): void, destroy(): void }}
 *   update は外からの反映（onChange は呼ばない）。知らない値ならどれも選ばず、先頭を Tab で入れる位置にする。
 *   badge は value の押しボタンに小さな印（span.segmented-badge。見た目だけで、読み上げは隠した文「（text）」）を付け、title に note を
 *   1 行足す（ほかの押しボタンの印は外す。null・知らない値なら外すだけ）。印は CSS でボタンの角に重ね、ボタンの幅と高さを変えない
 */
export function segmented({ label, choices, value, onChange }) {
  const element = el('div', 'segmented');
  element.setAttribute('role', 'radiogroup');
  element.setAttribute('aria-label', label);
  let current = value;
  let destroyed = false;

  const radios = choices.map(([key, text, title], index) => {
    const node = button(text, () => choose(key), 'segmented-option');
    node.setAttribute('role', 'radio');
    node.setAttribute('data-value', key);
    if (title) node.title = title;
    node.addEventListener('keydown', (event) => {
      const step = STEPS[event.key];
      const next = step ? (index + step + choices.length) % choices.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault();
      choose(choices[next][0]);
      radios[next].focus();
    });
    element.append(node);
    return node;
  });

  // 選んでいる印と、Tab で入る位置（選んでいるもの。無ければ先頭）
  function show() {
    const selected = choices.findIndex(([key]) => key === current);
    radios.forEach((node, index) => {
      node.setAttribute('aria-checked', String(index === selected));
      node.setAttribute('tabindex', index === (selected < 0 ? 0 : selected) ? '0' : '-1');
    });
  }

  function choose(key) {
    if (destroyed || key === current) return;
    current = key;
    show();
    onChange(key);
  }

  // 印（badge）: 付けている押しボタンと、足した要素・指定（同じ指定なら作り直さない）
  let marked = null;
  function badge(value, { text = '', note = '' } = {}) {
    const index = value == null ? -1 : choices.findIndex(([key]) => key === value);
    const spec = index < 0 ? '' : `${index}\u0001${text}\u0001${note}`;
    if ((marked?.spec ?? '') === spec) return;
    if (marked) {
      for (const node of marked.nodes) node.remove();
      radios[marked.index].title = choices[marked.index][2] ?? '';
      marked = null;
    }
    if (index < 0) return;
    const radio = radios[index];
    const nodes = [el('span', 'segmented-badge', text), el('span', 'visually-hidden', `（${text}）`)];
    nodes[0].setAttribute('aria-hidden', 'true');
    radio.append(...nodes);
    const title = choices[index][2];
    if (note) radio.title = title ? `${title}\n${note}` : note;
    marked = { index, spec, nodes };
  }

  show();
  return {
    element,
    update(next) {
      current = next;
      show();
    },
    badge,
    destroy() { destroyed = true; },
  };
}
