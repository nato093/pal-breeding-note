// 重い計算（ジェネレーター）を少しずつ進め、間で画面に戻す。計算の中身は知らない（理想個体の計算などを import しない）。

const clock = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());

/**
 * ジェネレーターを 1 回 budget ms までずつ進める。最初の区切りで終われば同期で { done: true, value } を返す（小さなデータ・テストは同期のまま）。
 * 終わらなければ { done: false, promise, cancel }。cancel() か signal の abort で古い計算を捨てる（promise は null で解決）。
 * 計算の中で投げた例外は promise の reject になる。
 * firstBudget は最初の区切りだけの上限（呼び出し側が同じ処理の中で先に時間を使ったとき、合わせて budget に収める。既定は budget）。
 * onSlice(ms) は区切りごとの時間（計測用。任意）
 */
export function startSliced(iterator, { budget = 30, firstBudget = budget, now = clock, schedule = (fn) => setTimeout(fn, 0), signal, onSlice } = {}) {
  // 1 区切りぶん進める。終わったら { value }、まだなら null
  const run = (limit = budget) => {
    const start = now();
    try {
      for (;;) {
        const step = iterator.next();
        if (step.done) return { value: step.value };
        if (now() - start >= limit) return null;
      }
    } finally {
      onSlice?.(now() - start);
    }
  };
  if (signal?.aborted) {
    iterator.return?.();
    return { done: false, promise: Promise.resolve(null), cancel() {} };
  }
  const first = run(firstBudget);
  if (first) return { done: true, value: first.value };
  let finished = false;
  let settle;
  const promise = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  const cancel = () => {
    if (finished) return;
    finished = true;
    // 作りかけのもの（世代の表など）を残さないよう、ジェネレーターを閉じる
    try { iterator.return?.(); } catch { /* 閉じるときの例外は捨てる */ }
    settle.resolve(null);
  };
  signal?.addEventListener('abort', cancel, { once: true });
  const tick = () => {
    if (finished) return;
    let result;
    try { result = run(); } catch (error) {
      finished = true;
      settle.reject(error);
      return;
    }
    if (!result) { schedule(tick); return; }
    finished = true;
    settle.resolve(result.value);
  };
  schedule(tick);
  return { done: false, promise, cancel };
}
