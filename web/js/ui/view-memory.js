// 画面の位置と条件の保持（読み込み直しても同じタブの間は残す）。
// - 履歴のエントリ: history.state にはエントリの ID だけを入れ、中身（版・環境・利用者・ワールド・画面・URL・条件・位置）は
//   sessionStorage の <ns>.entries に ID ごとに持つ（スクロールのたびに history.replaceState を呼ばないため）。最大 50 件
// - 読み込み直し用の保存: sessionStorage の <ns>.views に、画面ごとの条件とタブの行き先（ページを離れるときに書く）
// - 最後に開いたタブ: localStorage の <ns>.lastView.<ID> に画面名だけ（ログアウトしても残す）
// 読み戻すときは、版・環境・利用者（・ワールド）が今と違えば使わず、条件は画面ごとの形（schemas）で項目ごとに確かめる。
// 保存できない（storage が無い・例外）ときは何もしない（読み込み直すと既定に戻るだけ）。
import { cleanSaved, idText, int, intOrNull, isObject, screenHref, text, worldId } from '../core/boundary.js';
import { userIdKey } from '../core/user.js';
import { parseHash } from '../router.js';

// 保存の形の版（アプリの版ではない）。形を変えたら上げ、前の形は捨てる
export const MEMORY_VERSION = 1;
export const ENTRIES_MAX = 50;
// 位置を戻すのをやり直す時間の上限（データの読み込み・区切った描画を待つ）
export const RESTORE_MS = 2000;
const SCROLL_MAX = 10_000_000;
const KEY_MAX = 2000;

function parse(value) {
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value); } catch { return null; }
}

function cleanEntry(value) {
  if (!isObject(value) || value.v !== MEMORY_VERSION) return null;
  const id = idText(value.id, 40);
  if (!id) return null;
  return {
    v: MEMORY_VERSION, id, env: text(value.env, 10), user: idText(value.user, 100), world: worldId(value.world),
    view: text(value.view, 20), key: idText(value.key, KEY_MAX), cond: isObject(value.cond) ? value.cond : null,
    scrollY: intOrNull(value.scrollY, { min: 0, max: SCROLL_MAX }), at: int(value.at, { min: 0 }),
  };
}

/**
 * @param {object} deps
 * @param {{ get, set, remove }} deps.storage sessionStorage（store.js の safeStorage で包む）
 * @param {{ get, set, remove }} deps.local localStorage（同じ）
 * @param {() => { env: string, user: string, world: string }} deps.scope 今の環境・利用者（ID）・ワールド（分からなければ ''）
 * @param {Record<string, Record<string, (value: unknown) => unknown>>} deps.schemas 画面 → 条件の形（core/boundary.js の cleanSaved に渡す）
 * @param {string[]} deps.views 最後のタブ・タブの行き先として許す画面名（ナビのタブ）
 * @param {string[]} [deps.worldViews] 条件がワールドに依存する画面（保存したワールドと今のワールドが両方分かっていて違えば使わない）
 */
export function createViewMemory({ storage, local, namespace, scope, schemas = {}, views = [], worldViews = [], now = Date.now, random = Math.random }) {
  const entriesKey = `${namespace}.entries`;
  const viewsKey = `${namespace}.views`;
  const lastKey = (user) => `${namespace}.lastView.${user}`;
  const safely = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
  const read = (target, key) => safely(() => target?.get(key) ?? null, null);
  const write = (target, key, value) => safely(() => target?.set(key, value));
  const userKey = (user) => (typeof user === 'string' && user ? safely(() => userIdKey(user), '') : '');

  // 今の環境・利用者・ワールド（ワールドは分からなければ '' で、そのときは比べない）
  function current() {
    const value = safely(() => scope?.(), null) ?? {};
    return { env: typeof value.env === 'string' ? value.env : '', user: userKey(value.user), world: worldId(value.world) };
  }
  const otherWorld = (saved, here) => Boolean(saved && here && saved !== here);

  function entries() {
    const raw = parse(read(storage, entriesKey));
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const result = [];
    // 新しい方の 50 件だけを見る（壊れた・同じ ID の要素は捨てる）
    for (const item of raw.slice(-ENTRIES_MAX)) {
      const entry = cleanEntry(item);
      if (!entry || seen.has(entry.id)) continue;
      seen.add(entry.id);
      result.push(entry);
    }
    return result;
  }

  const cond = (view, value) => (schemas[view] && isObject(value) ? cleanSaved(value, schemas[view]) : null);

  return {
    newEntryId() {
      return `${now().toString(36)}${random().toString(36).slice(2, 10)}`;
    },
    /** エントリの条件と位置。版・環境・利用者・ワールド・画面・URL のどれかが今と違えば null。scrollY は無ければ null */
    readEntry(id, { view, key }) {
      const entryId = idText(id, 40);
      if (!entryId) return null;
      const entry = entries().find((item) => item.id === entryId);
      const here = current();
      if (!entry || !here.user || entry.env !== here.env || entry.user !== here.user || entry.view !== view || entry.key !== key) return null;
      if (otherWorld(entry.world, here.world)) return null;
      return { cond: cond(view, entry.cond), scrollY: entry.scrollY, world: entry.world };
    },
    /** エントリの条件（画面の形で整えたもの。無い画面は null）と位置を書く。古い順に捨てて最大 50 件 */
    writeEntry(id, { view, key, cond: value = null, scrollY = 0 }) {
      const entryId = idText(id, 40);
      const here = current();
      if (!entryId || !here.user) return;
      const entry = {
        v: MEMORY_VERSION, id: entryId, env: here.env, user: here.user, world: here.world, view: String(view), key: String(key),
        cond: isObject(value) ? value : null, scrollY: int(scrollY, { min: 0, max: SCROLL_MAX }), at: now(),
      };
      const next = [...entries().filter((item) => item.id !== entryId), entry].slice(-ENTRIES_MAX);
      write(storage, entriesKey, JSON.stringify(next));
    },
    /** 読み込み直し用に、画面ごとの条件（views）とタブの行き先（tabs）を書く */
    saveViews({ views: saved = {}, tabs = {} }) {
      const here = current();
      if (!here.user) return;
      write(storage, viewsKey, JSON.stringify({ v: MEMORY_VERSION, env: here.env, user: here.user, world: here.world, views: saved, tabs, at: now() }));
    },
    /**
     * 読み込み直し用の保存。版・環境・利用者が違えば null。保存したワールドと今のワールドが両方分かっていて違えば、
     * ワールドに依存する画面の条件は使わない。起動した時点ではまだ所持パルを読んでおらずワールドが分からないので比べず、
     * 保存したワールドを world で返す（app.js が覚え、所持パルを読んで別のワールドだと分かったら、forgetHolders が所持者だけを外す）。
     * 条件は項目ごとに形を確かめ（合わない項目だけ既定に戻す）、タブの行き先は #/ で始まりその画面のものだけ
     */
    loadViews() {
      const saved = parse(read(storage, viewsKey));
      const here = current();
      if (!isObject(saved) || saved.v !== MEMORY_VERSION || !here.user) return null;
      if (text(saved.env, 10) !== here.env || idText(saved.user, 100) !== here.user) return null;
      const world = worldId(saved.world);
      const other = otherWorld(world, here.world);
      const source = isObject(saved.views) ? saved.views : {};
      const result = {};
      for (const view of Object.keys(schemas)) {
        if (other && worldViews.includes(view)) continue;
        const value = cond(view, source[view]);
        if (value) result[view] = value;
      }
      const hrefs = isObject(saved.tabs) ? saved.tabs : {};
      const tabs = {};
      for (const view of views) {
        const href = screenHref(hrefs[view]);
        if (href && parseHash(href).view === view) tabs[view] = href;
      }
      return { views: result, tabs, world: other ? '' : world };
    },
    /** 最後に開いたタブ（許した画面名だけ。無ければ ''） */
    lastView(user) {
      const key = userKey(user);
      const value = key ? read(local, lastKey(key)) : null;
      return views.includes(value) ? value : '';
    },
    setLastView(user, view) {
      const key = userKey(user);
      if (!key || !views.includes(view) || read(local, lastKey(key)) === view) return;
      write(local, lastKey(key), view);
    },
    /** エントリと読み込み直し用の保存を消す（最後のタブは ID ごとなので残す） */
    clear() {
      safely(() => storage?.remove(entriesKey));
      safely(() => storage?.remove(viewsKey));
    },
  };
}

/**
 * y の位置へスクロールする（描いた後のフレームで）。ページがまだ短い（データの読み込み待ち・区切った描画の途中）なら、
 * 届くまでフレームごとにやり直す（最大 limit ms）。利用者の操作（ホイール・キー・押す）か cancel() で、やり直しをやめる。
 * scrollTo の無い環境では何もしない
 */
export function restoreScroll(y, { win = globalThis.window, doc = globalThis.document, now = Date.now, limit = RESTORE_MS } = {}) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (typeof win?.scrollTo !== 'function') return { cancel };
  const frame = (fn) => (typeof win.requestAnimationFrame === 'function' ? win.requestAnimationFrame(fn) : setTimeout(fn, 0));
  const started = now();
  for (const name of ['wheel', 'keydown', 'pointerdown']) {
    win.addEventListener?.(name, cancel, { once: true, passive: true, signal: controller.signal });
  }
  const attempt = () => {
    if (controller.signal.aborted) return;
    win.scrollTo(0, y);
    const page = doc?.documentElement;
    const room = page ? page.scrollHeight - (win.innerHeight ?? 0) : Infinity;
    if (room < y && now() - started < limit) frame(attempt);
    else cancel();
  };
  frame(attempt);
  return { cancel };
}
