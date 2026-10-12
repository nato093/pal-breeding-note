// 作り直す前後で、キーボードのフォーカスを同じ役目の部品へ引き継ぐ（data-focus-key で探す）。
// - data-focus-key: 部品の役目（'picker:<ラベル>'・'passive:<ラベル>'・'passive-chip:<ラベル>:<id>'・'start:<palId>' など）
// - data-focus-fallback: 同じ key の部品が見つからないときの代わり（チップの × → 追加欄）
// - data-focus-group: 見つけた部品が押せない（disabled・hidden）ときに移る仲間（最後の 1 つへ）。
//   部品に group が無ければ、key と同じ名前の group を探す（4 個目を足して押せなくなった追加欄 → 残ったチップの最後の ×）
// テストの DOM に closest・dataset が無いので、parentElement と getAttribute でたどる。
// 探すときも [data-focus-key="…"] の CSS の文字列は作らず、getAttribute の値で比べる（URL の値から作った key に " や改行が入っても落ちない）。

const usable = (node) => !node.disabled && !node.hidden;
// root の中で、属性 name の値が value の要素（並びの順）
const withAttribute = (root, name, value) => Array.from(root.querySelectorAll(`[${name}]`)).filter((node) => node.getAttribute(name) === value);

/** 作り直す前に、root の中のフォーカスのある要素（か先祖）の data-focus-key と data-focus-fallback を覚える。無ければ null */
export function captureFocus(root) {
  const doc = globalThis.document;
  let node = doc?.activeElement;
  if (!root || !node || node === doc.body || !root.contains(node)) return null;
  while (node && node !== root) {
    const key = typeof node.getAttribute === 'function' ? node.getAttribute('data-focus-key') : null;
    if (key) return { key, fallback: node.getAttribute('data-focus-fallback') };
    node = node.parentElement;
  }
  return null;
}

/**
 * 作り直した後に「同じ key → fallback」の順に、data-focus-key の値が同じ要素を探して focus({ preventScroll: true })。
 * 見つけた要素が押せなければ、同じ data-focus-group の最後の要素へ。フォーカスがまだ root の中に残っていれば何もしない。
 * どれも見つからなければ何もしない（見出しへは移さない）。移したら true
 */
export function restoreFocus(root, token) {
  if (!root || !token) return false;
  const doc = globalThis.document;
  const active = doc?.activeElement;
  if (active && active !== doc.body && active.isConnected !== false && root.contains(active)) return false;
  for (const key of [token.key, token.fallback]) {
    if (!key) continue;
    const [target] = withAttribute(root, 'data-focus-key', key);
    if (!target) continue;
    if (usable(target)) {
      target.focus({ preventScroll: true });
      return true;
    }
    const group = target.getAttribute('data-focus-group') ?? key;
    const members = withAttribute(root, 'data-focus-group', group).filter((node) => node !== target && usable(node));
    const last = members.at(-1);
    if (last) {
      last.focus({ preventScroll: true });
      return true;
    }
  }
  return false;
}
