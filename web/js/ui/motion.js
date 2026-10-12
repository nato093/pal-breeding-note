// 並べ替えの動き（View Transition）。行の順番が変わるときだけ使う。

let running = null;

/** API が無い・動きを減らす設定・前の動きの途中なら、すぐ fn()（続けての操作は最新だけ描く） */
export function withTransition(fn) {
  const doc = globalThis.document;
  const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (typeof doc?.startViewTransition !== 'function' || reduce || running) { fn(); return; }
  try {
    running = doc.startViewTransition(fn);
  } catch {
    running = null;
    fn();
    return;
  }
  const done = () => { running = null; };
  running.finished.then(done, done);
}
