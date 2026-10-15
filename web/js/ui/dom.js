// 空の状態のアイコン（navIcon → ui/icons.js の icon はこのファイルの svgElement を使うが、どれもモジュールの読み込みの時点では
// 呼ばないので、互いに読み込んでよい）
import { navIcon } from './nav-icons.js';

export function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = text;
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/**
 * SVG の要素（アイコンの図形）。属性は { 名前: 値 } で、値は文字列にして付ける。属性名が変数になる setAttribute はここだけにし
 *（test/static/security.test.js）、style 属性の文字列とイベントの属性（on*）は大文字小文字によらず投げる
 */
export function svgElement(tag, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (/^(?:style$|on)/i.test(name)) throw new Error(`SVG に付けない属性です: ${name}`);
    node.setAttribute(name, String(value));
  }
  return node;
}

export function button(text, action, className = 'button') {
  const node = el('button', className, text);
  node.type = 'button';
  if (action) node.addEventListener('click', action);
  return node;
}

export function link(text, href, className = '') {
  const node = el('a', className, text);
  node.href = href;
  return node;
}

/** Blob をファイルとして保存させる（配合・所持パルの CSV と、この端末のデータの書き出し。settings で 1 つにまとめた） */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = link('', url);
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** ファイル名の日付（YYYYMMDD。端末の時刻） */
export function dateStamp(now = new Date()) {
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('');
}

export function field(label, input) {
  const wrapper = el('label', 'field');
  wrapper.append(el('span', 'field-label', label), input);
  return wrapper;
}

/**
 * 空の状態（結果がない・まだ選んでいない）。文の p と、あれば次の操作（ボタン・リンク。2 つ以上なら入れ物の div）。
 * icon にタブの名前（'search'・'owned' など。ui/nav-icons.js の navIcon）を渡すと、文の上にそのタブのアイコンを出す
 *（読み上げない。読み込み中・エラーには付けない＝loadingState・errorState）
 */
export function empty(text, action, { icon = '' } = {}) {
  const node = el('div', 'empty-state');
  if (icon) {
    const frame = el('span', 'empty-icon');
    frame.setAttribute('aria-hidden', 'true');
    frame.append(navIcon(icon));
    node.append(frame);
  }
  node.append(el('p', '', text));
  if (action) node.append(action);
  return node;
}

/** 読み込み中の表示。empty と同じ見た目で role="status"（アイコンは付けない） */
export function loadingState(text) {
  const node = empty(text);
  node.classList.add('loading-state');
  node.setAttribute('role', 'status');
  return node;
}

/**
 * 読み込みに失敗したときの表示（role="alert"・エラーの色の左の帯）。retry があればボタン「もう一度読み込む」を付け、押すと retry() を呼ぶ
 *（Promise を返せば終わるまで押せない。失敗の文は呼び出し側が新しい状態で描き直す）
 */
export function errorState(message, retry) {
  const node = el('div', 'error-state');
  node.setAttribute('role', 'alert');
  node.append(el('p', '', message));
  if (retry) {
    const again = button('もう一度読み込む', () => runButton(again, retry, () => {}), 'button secondary small');
    node.append(again);
  }
  return node;
}

/**
 * 設定などへ移る必要がある案内。1 文と、行き先のボタン 1 つ（「設定タブの〜」とだけ書いて行き先のない案内の代わり）。
 * action は { label, href }（リンク）か { label, run }（ボタン）。kind は 'info' か 'warning'
 */
export function setupHint({ text, action, kind = 'info' }) {
  const node = el('div', `setup-hint setup-hint-${kind}`);
  node.append(el('p', '', text));
  if (action?.href) node.append(link(action.label, action.href, 'button secondary small'));
  else if (action?.run) node.append(button(action.label, action.run, 'button secondary small'));
  return node;
}

// 状態の印の色（tone）。CSS の .status-chip.is-<tone>
const TONES = ['ready', 'warning', 'error', 'info', 'neutral'];
const toneOf = (tone) => (TONES.includes(tone) ? tone : 'neutral');

/**
 * 状態の印（未読・削除済み・作成可能・完成済み・変更あり・配置中・自動登録のオン／オフ・読み込みの状態）を 1 つの形にした小さなチップ。
 * tone: 'ready'（できた・使える）| 'warning'（気にしてほしい）| 'error'（失敗）| 'info'（知らせ）| 'neutral'（まだ・対象外）。
 * className は前のクラス名（.unread-chip など。テストと画面の中の探し方を壊さないため残す）
 */
export function statusChip(text, tone = 'neutral', className = '') {
  return el('span', `status-chip is-${toneOf(tone)}${className ? ` ${className}` : ''}`, text);
}

/** 状態の印の tone だけを付け替える（文と前のクラス名はそのまま。テストの DOM に classList.remove が無いので toggle で） */
export function setChipTone(node, tone) {
  const next = toneOf(tone);
  for (const name of TONES) node.classList.toggle(`is-${name}`, name === next);
  return node;
}

/**
 * ボタンを押せなくする・戻す。押せないときは title に理由（マウスを乗せると出る）、押せるときは title を消す
 *（同じ所で一緒に変えて、古い理由を残さない）。focusable なら disabled にせず aria-disabled で押せない印にする
 *（押した後もフォーカスを残したいボタン。押したときの処理は呼び出し側が aria-disabled を見て止める）。
 * runButton の処理中（aria-busy）は理由を出さない（ここを呼ばない）
 */
export function setDisabled(node, disabled, reason = '', { focusable = false } = {}) {
  const off = Boolean(disabled);
  if (focusable) {
    node.disabled = false;
    node.setAttribute('aria-disabled', String(off));
  } else {
    node.disabled = off;
    node.removeAttribute('aria-disabled');
  }
  node.title = off ? reason : '';
  return node;
}

/**
 * この端末への保存に失敗したときの警告（hidden で出し入れする）。what は「下書き」「ウィッシュリスト」「目標」など、
 * className は画面ごとの余白などのクラス（あれば）
 */
export function storageWarning(what, className = '') {
  const node = el('p', `form-errors storage-warning ${className}`.trim(), `この端末に${what}を保存できませんでした（ページを閉じると消えます）`);
  node.setAttribute('role', 'alert');
  return node;
}

export function formatTime(value, full = false) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return '未取得';
  return new Intl.DateTimeFormat('ja-JP', full
    ? { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** ヘッダーに出す短い時刻。今日なら 時:分、違う日なら 月/日 時:分（日付が分からない値は fallback）。 */
export function formatShortTime(value, now = Date.now(), fallback = '未取得') {
  const time = new Date(value);
  if (!value || !Number.isFinite(time.getTime())) return fallback;
  return formatTime(value, !sameDay(time, new Date(now)));
}

export async function runButton(node, action, onError) {
  if (node.disabled) return;
  node.disabled = true;
  node.setAttribute('aria-busy', 'true');
  try { return await action(); } catch (error) { onError(error); }
  finally { node.disabled = false; node.removeAttribute('aria-busy'); }
}

// ---------------------------------------------------------------------------
// キーで要素を使い回す一覧（syncList）。container → { rows: Map<key, row>, keys: Map<Element, key> }
// ---------------------------------------------------------------------------
const lists = new WeakMap();

function listOf(container) {
  let list = lists.get(container);
  // empty: 出している空の表示（同じ文なら作り直さない）
  if (!list) lists.set(container, list = { rows: new Map(), keys: new Map(), empty: null });
  return list;
}

// フォーカスのある要素から container の直下の行と、途中の data-focus の値をたどる（テストの DOM に closest・dataset が無いので getAttribute で）
function focusedRow(container, list) {
  const doc = globalThis.document;
  let node = doc?.activeElement;
  if (!node || node === doc.body) return null;
  let focus = null;
  while (node && node !== container) {
    if (focus === null && typeof node.getAttribute === 'function') focus = node.getAttribute('data-focus');
    if (node.parentElement === container) return list.keys.has(node) ? { element: node, key: list.keys.get(node), focus } : null;
    node = node.parentElement;
  }
  return null;
}

const focusLost = () => {
  const doc = globalThis.document;
  const active = doc?.activeElement;
  return !active || active === doc.body || active.isConnected === false;
};

function focusIn(row, focus) {
  const target = (focus !== null && focus !== undefined ? row.querySelector(`[data-focus="${focus}"]`) : null) ?? row.querySelector('[data-focus]');
  target?.focus({ preventScroll: true });
  return Boolean(target);
}

/**
 * container の子を items に合わせる。同じ key の行は使い回して update、無くなった行だけ destroy、位置の違う行だけ insertBefore。
 * create(item) → { element, update(item), destroy() }。update は中身を書き換えてよいが element は差し替えない。
 * フォーカス: 同期の前にフォーカスのある行の key と、行の中の data-focus の値を覚え、同期の後で同じ行の同じ部品へ focus({ preventScroll: true })。
 *   行が消えたときは、次の行（なければ前の行）の最初の [data-focus] へ。どちらも無ければ fallbackFocus（任意の要素）へ。
 * items が空のとき、empty（任意。() => Element）があればその要素を 1 つだけ出す。出している空の表示と文（textContent）とクラスが
 *   同じなら作り直さない（中のボタンのフォーカスが外れない）。そのため、空の表示の中のボタンが押されたときに使う値は、作った時点の値を
 *   閉じ込めず、呼び出し側の今の値（変数）から読むこと。
 * 決まり: syncList で管理する入れ物に replaceChildren を直接使わない（ほかの表示を出すときは、先に clearList）。
 */
export function syncList(container, items, { key, create, empty, fallbackFocus } = {}) {
  const list = listOf(container);
  const focused = focusedRow(container, list);
  const order = Array.from(container.children);
  const wanted = new Set(items.map(key));
  let lost = null;
  for (const [id, row] of list.rows) {
    if (wanted.has(id)) continue;
    if (focused?.key === id) lost = order.indexOf(row.element);
    row.destroy?.();
    row.element.remove();
    list.rows.delete(id);
    list.keys.delete(row.element);
  }
  const nodes = items.map((item) => {
    const id = key(item);
    let row = list.rows.get(id);
    if (row) row.update?.(item);
    else {
      row = create(item);
      list.rows.set(id, row);
      list.keys.set(row.element, id);
    }
    return row.element;
  });
  if (!nodes.length && empty) {
    const node = empty();
    const kept = list.empty;
    const same = kept && container.children.length === 1 && container.children[0] === kept
      && kept.className === node.className && kept.textContent === node.textContent;
    if (!same) {
      container.replaceChildren(node);
      list.empty = node;
    }
  } else {
    list.empty = null;
    // 付け直すとフォーカスと開いている候補が外れるため、位置の違う行（新しい行・並びの変わった行）だけを差し込む
    nodes.forEach((node, index) => {
      if (container.children[index] !== node) container.insertBefore(node, container.children[index] ?? null);
    });
    while (container.children.length > nodes.length) container.lastElementChild.remove();
  }
  if (!focused || !focusLost()) return;
  const kept = list.rows.get(focused.key);
  if (kept) { focusIn(kept.element, focused.focus); return; }
  if (lost === null) return;
  // キーボードの位置を見失わないよう、消えた行の次の行（なければ前の行）の最初の部品へ移す（同じボタンへ移すと、Enter の長押しで次の行まで続けて操作してしまう）
  const alive = (node) => node.parentElement === container && list.keys.has(node);
  const target = order.slice(lost + 1).find(alive) ?? order.slice(0, lost).reverse().find(alive);
  if (!(target && focusIn(target, null))) fallbackFocus?.focus({ preventScroll: true });
}

/** 管理している行のキー（分割描画で、まだ無い行の数を数えるときに使う） */
export function listKeys(container) {
  return new Set(lists.get(container)?.rows.keys() ?? []);
}

/** すべての行を destroy して空にする（画面の destroy・表示の形を変えるときに呼ぶ） */
export function clearList(container) {
  const list = lists.get(container);
  if (list) for (const row of list.rows.values()) row.destroy?.();
  lists.delete(container);
  container.replaceChildren();
}

/**
 * 自動の更新の後に位置を戻すための目印。offsetTop（固定のヘッダー・パネルの下端）より下で最初に見えている行の key と上端。
 * 行の上端は並びの順に増えるので二分探索で探す。
 */
export function anchorOf(container, offsetTop = 0) {
  const list = lists.get(container);
  if (!list) return null;
  const rows = Array.from(container.children).filter((node) => list.keys.has(node));
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (rows[middle].getBoundingClientRect().bottom <= offsetTop) low = middle + 1;
    else high = middle;
  }
  const row = rows[low];
  return row ? { key: list.keys.get(row), top: row.getBoundingClientRect().top } : null;
}

/** anchorOf で覚えた行が同じ位置に見えるようにスクロールする。行が見つかったら true（行がまだ無い・なくなったときは何もしない） */
export function restoreAnchor(container, anchor) {
  const row = anchor && lists.get(container)?.rows.get(anchor.key);
  if (!row?.element.isConnected) return false;
  const moved = row.element.getBoundingClientRect().top - anchor.top;
  if (moved) globalThis.window?.scrollBy?.(0, moved);
  return true;
}

/**
 * target の高さ（border-box）を host の CSS 変数 name に書き続ける（sticky のパネルの下に重ねる帯の top・scroll-margin-top が使う）。
 * 値は style.setProperty で書き（style 属性の文字列は使わない）、同じ高さでは書き直さない。
 * ResizeObserver が無い環境（テスト）では 1 回だけ測る。戻り値は監視をやめる関数で、その measure() は今すぐ測って書く
 *（ResizeObserver の知らせは requestAnimationFrame の後に来るので、同じフレームの中で高さを使う前に呼ぶ）
 */
export function trackHeight(target, host, name = '--panel-h') {
  let written = '';
  const write = (height) => {
    if (!Number.isFinite(height)) return;
    const value = `${Math.round(height * 100) / 100}px`;
    if (value === written) return;
    written = value;
    host.style.setProperty(name, value);
  };
  const measure = () => {
    const rect = target.getBoundingClientRect();
    write(rect.height ?? rect.bottom - rect.top);
  };
  const Observer = globalThis.ResizeObserver;
  if (typeof Observer !== 'function') {
    measure();
    return Object.assign(() => {}, { measure });
  }
  const observer = new Observer((entries) => {
    const size = entries.at(-1)?.borderBoxSize?.[0];
    if (size) write(size.blockSize);
    else measure();
  });
  observer.observe(target);
  return Object.assign(() => observer.disconnect(), { measure });
}

// ---------------------------------------------------------------------------
// 入力の間引き
// ---------------------------------------------------------------------------

/** 最後の呼び出しから ms 待って 1 回だけ呼ぶ。flush() ですぐ呼び、cancel() で取り消す。ms が 0 なら同期で呼ぶ */
export function debounce(fn, ms) {
  let timer = null;
  let pending = null;
  const run = () => {
    const args = pending;
    timer = null;
    pending = null;
    if (args) fn(...args);
  };
  const debounced = (...args) => {
    if (!ms) { fn(...args); return; }
    pending = args;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(run, ms);
  };
  debounced.flush = () => {
    if (timer !== null) clearTimeout(timer);
    run();
  };
  debounced.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending = null;
  };
  return debounced;
}

/**
 * テキストの入力を間引いて fn(value) を呼ぶ。日本語の変換中（compositionstart〜compositionend・event.isComposing）は呼ばず、確定したときに呼ぶ。
 * change（Enter・欄を離れる）では、待っている呼び出しをすぐ呼ぶ。戻り値の cancel で待っている呼び出しを取り消す
 */
export function onTextInput(input, fn, { delay = 150, signal } = {}) {
  let composing = false;
  const call = debounce(() => fn(input.value), delay);
  const options = signal ? { signal } : {};
  input.addEventListener('compositionstart', () => { composing = true; }, options);
  input.addEventListener('compositionend', () => { composing = false; call(); }, options);
  input.addEventListener('input', (event) => {
    if (composing || event?.isComposing) return;
    call();
  }, options);
  // 待っている呼び出しがあれば、すぐ呼ぶ（もう呼んだ後なら何もしない）
  input.addEventListener('change', () => { if (!composing) call.flush(); }, options);
  signal?.addEventListener('abort', () => call.cancel(), { once: true });
  return { cancel: call.cancel, flush: call.flush };
}
