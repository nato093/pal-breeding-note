// 配合の計画の基準（配合牧場の中身が最後に変わったときのおすすめの組）を、この端末に残す。
// 牧場の中身が変わるまで「変更あり」を出し続けるため（ページを読み込み直しても消えないように）。条件ごとに、新しいものから LIMIT 件まで。
const LIMIT = 50;
const PAIRS_MAX = 100;

export function createPlanMemory({ storage, namespace = 'pal-note', now = Date.now }) {
  const key = `${namespace}.idealPlan`;
  let cache = null;

  function load() {
    if (cache) return cache;
    let parsed = null;
    try { parsed = JSON.parse(storage?.getItem(key) ?? 'null'); } catch { /* 読めないときは基準なしとして扱う。 */ }
    cache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    return cache;
  }

  return {
    get(id) {
      const value = load()[id];
      if (!value || typeof value.farms !== 'string' || !Array.isArray(value.pairs) || !value.pairs.every((pair) => typeof pair === 'string')) return null;
      // 開いている条件は押し出されないよう、新しさだけ覚えておく（端末への保存は、次に基準を書くときにまとめて行う）
      value.at = now();
      return { farms: value.farms, pairs: value.pairs };
    },
    set(id, { farms, pairs }) {
      const all = load();
      all[id] = { farms, pairs: pairs.slice(0, PAIRS_MAX), at: now() };
      const kept = Object.entries(all).sort(([, a], [, b]) => (b.at ?? 0) - (a.at ?? 0)).slice(0, LIMIT);
      cache = Object.fromEntries(kept);
      try { storage?.setItem(key, JSON.stringify(cache)); } catch { /* 保存できない端末では、開いている間だけ覚える。 */ }
    },
  };
}
