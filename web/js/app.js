import { createApi } from './api.js';
import { createStore, safeStorage } from './store.js';
import { createDraftStore } from './drafts.js';
import { createNotificationStore, releaseNoteSource } from './notifications.js';
import { createWishlistStore, wishlistNotificationSource } from './wishlist.js';
import { createIdealStore, idealNotificationSource } from './ideals.js';
import { createSelfStore } from './self-player.js';
import { createPlanMemory } from './ideal-plan-memory.js';
import { createOwnedStore, idbPersist } from './owned.js';
import { createAutoRegister } from './auto-register.js';
import { createRenamer } from './user-rename.js';
import { startRouter, buildHash, parseHash, sameScreen, routeKey, SETTINGS_OPEN } from './router.js';
import { el, button, link, field, runButton, debounce } from './ui/dom.js';
import { createViewMemory, restoreScroll } from './ui/view-memory.js';
import { captureFocus, restoreFocus } from './ui/focus.js';
import { cleanSaved, idText, isObject, worldId } from './core/boundary.js';
import { userIdKey } from './core/user.js';
import { toast, ACTION_DURATION } from './ui/toast.js';
import { syncInBackground } from './ui/sync.js';
import { syncProgress } from './ui/sync-progress.js';
import { syncStatus } from './ui/sync-status.js';
import { saveStatus } from './ui/save-status.js';
import { accountMenu } from './ui/account-menu.js';
import { confirmDialog, closeDialogs } from './ui/dialog.js';
import { breedingCard } from './ui/breeding-card.js';
import { openRecordEditor } from './ui/record-editor.js';
import { notificationMenu } from './ui/notifications.js';
import { updateBanner } from './ui/update-banner.js';
import { navIcon } from './ui/nav-icons.js';
import { installRipple } from './ui/ripple.js';
import { runningVersion, createVersionWatcher, servedVersion, CHECK_INTERVAL } from './version.js';
import releaseNotes from './release-notes.js';
import { searchView } from './views/search.js';
import { reverseView } from './views/reverse.js';
import { inheritanceView } from './views/route.js';
import { listView, LIST_MEMORY } from './views/list.js';
import { ownedView, OWNED_MEMORY } from './views/owned.js';
import { idealView, IDEAL_MEMORY } from './views/ideal.js';
import { draftsView } from './views/drafts.js';
import { wishlistView } from './views/wishlist.js';
import { palView } from './views/pal.js';
import { settingsView } from './views/settings.js';
import { TABS } from './views/tabs.js';

// 登録したセーブを読み直す間隔
const SAVE_POLL_INTERVAL = 60 * 1000;
// スクロールした位置を今の履歴のエントリに書くまでの間引き
const SCROLL_SAVE_DELAY = 300;
// 画面ごとに保存する条件（viewState の中の入れ物の名前。'' は viewState そのもの）と、その形（各画面が export する）
const CONDITIONS = { owned: ['filter', OWNED_MEMORY], ideal: ['conditions', IDEAL_MEMORY], list: ['', LIST_MEMORY] };
// 条件がワールドに依存する画面（所持者がワールドのプレイヤー）
const WORLD_VIEWS = ['owned', 'ideal'];

async function boot() {
  // 開発用モジュールは配信物に含めず、ループバックの明示指定時だけ読み込む。
  const developmentKey = ['mo', 'ck'].join('');
  const localDevelopment = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
    && new URLSearchParams(location.search).get(developmentKey) === '1';
  let transport;
  if (localDevelopment) {
    const development = await import(`/dev/${developmentKey}-api.js`);
    transport = development.createDevelopmentApi({ seed: new URLSearchParams(location.search).get('seed') });
  }
  let browserStorage = null;
  try { browserStorage = window.localStorage; } catch { /* 保存できない端末でも画面は使える。 */ }
  const namespace = localDevelopment ? 'pal-note.local' : 'pal-note';
  const store = createStore({
    api: createApi({ transport }), storage: safeStorage(browserStorage), namespace,
    onUserIdChange: (previous, next, env) => renamer.followServer(previous, next, env),
  });
  const drafts = createDraftStore({ store, storage: browserStorage, namespace });
  const wishlist = createWishlistStore({ store, storage: browserStorage, namespace });
  // 所持パル（セーブから読み込んだ一覧）はログインと関係なく、このブラウザに保存する。
  const owned = createOwnedStore({
    persist: idbPersist(namespace), settings: safeStorage(browserStorage), namespace,
    // 共有（スプレッドシート）はログイン中の環境ごと
    server: {
      scope: () => (store.state.passcode && store.state.userId && store.state.env ? store.state.env : ''),
      userId: () => store.state.userId,
      request: (action, input) => store.call(action, input),
    },
  });
  let ownedScope = '';
  // 配合牧場からの自動登録（ホストのセーブを読み込んだとき）。合わなかったものは通知に出す。
  const autoRegister = createAutoRegister({
    store, owned, storage: safeStorage(browserStorage), namespace, toast, onNotice: () => notifications.changed(),
  });
  // このワールドでの自分（設定で選ぶ。この端末に ID・環境・ワールドごと）
  const self = createSelfStore({ store, storage: browserStorage, namespace });
  // 登録した理想個体（この端末に ID・環境ごと）。自分の個体で完成を判定して知らせる。
  // 自分のプレイヤーは「このワールドでの自分」、なければ配合牧場の自動登録と同じ「登録者の対応」（なければ同じ名前）で決める
  const ideals = createIdealStore({
    store, owned, storage: browserStorage, namespace,
    identity: (worldId) => ({ userId: store.state.userId, users: store.state.users, mapping: autoRegister.mapping(worldId), selfUid: self.get(worldId) }),
  });
  // 本人が変わったら（このワールドでの自分・登録者の対応。別のタブの変更も）、同じセーブのまま完成を判定し直す（そのとき完成している
  // ものは知らせない）。ID の変更中は判定し直せない（ideals.js）ので、変更中に来た分は、変更が終わった store の通知で 1 回だけ判定し直す
  //（この store の購読は ideals より後に足すので、変更中に届いた新しいセーブの判定〔完成を知らせる〕が先に済む）
  let identityLater = false;
  self.subscribe(() => {
    if (store.state.renaming) identityLater = true;
    else ideals.identityChanged();
  });
  store.subscribe((state) => {
    if (!identityLater || state.renaming) return;
    identityLater = false;
    ideals.identityChanged();
  });
  const notifications = createNotificationStore({
    store, storage: browserStorage, namespace,
    sources: [releaseNoteSource, wishlistNotificationSource({ store, wishlist }), idealNotificationSource({ store, ideals }), autoRegister.notices],
  });
  const renamer = createRenamer({ store, drafts, wishlist, ideals, self, notifications, storage: browserStorage, namespace });
  renamer.resumeLocal();
  const root = document.getElementById('app');
  const header = el('header', 'app-header');
  const brand = link('', buildHash('search'), 'brand');
  // 狭い窓では文字を隠してマークだけにする（CSS）ので、名前は aria-label で持つ
  brand.setAttribute('aria-label', 'パル配合ノート（配合検索へ）');
  // 菱形の印は CSS のマスクで描く（中身の文字は持たない。読み上げで「◇」と読まれないよう aria-hidden）
  const mark = el('span', 'brand-mark');
  mark.setAttribute('aria-hidden', 'true');
  const brandText = el('span', 'brand-text');
  // ロゴの副題（キャッチコピー）は copy-dead-ends でなくした（見出しはタブ名にそろえる）
  brandText.append(el('strong', '', 'パル配合ノート'));
  brand.append(mark, brandText);
  // テスト環境はロゴの右のチップ（後から帯が入って本文がずれないように、ヘッダーの中に置く）
  const envChip = el('span', 'env-chip', 'テスト環境');
  envChip.hidden = true;
  // 同期状況は押すと最新に更新する（読み上げの告知は付けない）。ログイン画面では隠す（render）
  const sync = syncStatus({ store, locked: () => showingLogin });
  const progress = syncProgress();
  const headerStatus = el('div', 'header-status');
  headerStatus.append(sync.element, progress.element);
  const nav = el('nav', 'navigation');
  nav.setAttribute('aria-label', 'メインナビゲーション');
  // タブの並びと名前は views/tabs.js（各画面の見出しも同じ名前を引く）
  const tabLinks = new Map();
  for (const [view, label] of TABS) {
    const tab = link('', buildHash(view), 'nav-tab');
    // グループの区切りの余白は CSS が data-view で付ける
    tab.setAttribute('data-view', view);
    const symbol = el('span', 'tab-symbol');
    symbol.append(navIcon(view));
    tab.append(symbol, el('span', '', label));
    nav.append(tab);
    tabLinks.set(view, tab);
  }
  // タブを切り替えても、各画面の選択（URL）と絞り込み（画面内の入力）を残す。読み込み直しても、同じタブ（sessionStorage）の間は残る
  //（ページを離れるときに保存し、起動したときに戻す。戻る・進むでは、そのときの履歴のエントリの条件と位置に戻す。ui/view-memory.js）。
  const viewStates = new Map();
  const viewState = (view) => {
    if (!viewStates.has(view)) viewStates.set(view, {});
    return viewStates.get(view);
  };
  // タブの行き先（読み込み直し用に保存する）
  const tabHrefs = new Map();
  // 所持パル・理想個体の条件が前提にしているワールド（所持者はワールドのプレイヤーなので、別のワールドに替わったら外す）
  let conditionWorld = '';
  let sessionStore = null;
  try { sessionStore = window.sessionStorage; } catch { /* 保存できない端末では、読み込み直すと既定に戻るだけ。 */ }
  const memory = createViewMemory({
    storage: safeStorage(sessionStore), local: safeStorage(browserStorage), namespace,
    scope: () => ({ env: store.state.env ?? '', user: store.state.userId, world: worldId(owned.state.meta?.worldId) || conditionWorld }),
    schemas: Object.fromEntries(Object.entries(CONDITIONS).map(([view, [, schema]]) => [view, schema])),
    views: TABS.map(([view]) => view), worldViews: WORLD_VIEWS,
  });
  function setTabHref(view, href) {
    const tab = tabLinks.get(view);
    if (!tab) return;
    tab.href = href;
    tabHrefs.set(view, href);
    if (view === 'search') brand.href = href;
  }
  function remember(next) {
    if (!tabLinks.has(next.view)) return;
    setTabHref(next.view, buildHash(next.view, next.params, next.id));
    memory.setLastView(store.state.userId, next.view);
  }
  // ログアウトしたら、次にログインする人へ前の人の選択を引き継がない（最後に開いたタブは ID ごとなので残す）。
  function forget() {
    viewStates.clear();
    tabHrefs.clear();
    for (const [view, tab] of tabLinks) tab.href = buildHash(view);
    brand.href = buildHash('search');
    conditionWorld = '';
    memory.clear();
  }
  // 画面の条件の写し（保存する形の項目だけ）と、保存した条件を viewState に入れる（画面が持っている入れ物はそのまま使う）
  function snapshotCond(view) {
    const state = viewStates.get(view);
    if (!CONDITIONS[view] || !state) return null;
    const [slot, schema] = CONDITIONS[view];
    const source = slot ? state[slot] : state;
    return isObject(source) ? cleanSaved(source, schema) : null;
  }
  function applyCond(view, cond, world = '') {
    if (!CONDITIONS[view] || !isObject(cond)) return;
    const [slot] = CONDITIONS[view];
    const state = viewState(view);
    if (slot) state[slot] = Object.assign(isObject(state[slot]) ? state[slot] : {}, cond);
    else Object.assign(state, cond);
    if (world && WORLD_VIEWS.includes(view)) conditionWorld = world;
  }
  // 別のワールドに替わったら、プレイヤーを選んだ所持者の条件を既定（自分）に戻す（そのワールドのプレイヤーとは限らない）。
  // 自分（mine）と「すべて」（''）はどのワールドでも同じ意味なので残す（D29 で所持者の既定を自分にした。前はどれも「すべて」に戻した）
  function forgetHolders() {
    for (const target of [viewStates.get('owned')?.filter, viewStates.get('ideal')?.conditions]) {
      if (isObject(target) && typeof target.holder === 'string' && target.holder.startsWith('player:')) target.holder = 'mine';
    }
  }
  const main = el('main', 'app-main');
  main.id = 'main';
  const skip = link('メイン画面へ', '#main', 'skip-link');
  skip.addEventListener('click', (event) => { event.preventDefault(); main.tabIndex = -1; main.focus(); });
  const register = button('＋ 登録', () => {
    if (!store.state.passcode || !store.state.userId) return;
    context.register();
  }, 'register-button');
  register.setAttribute('aria-label', '配合を登録');
  // ヘッダーのパネル（ベル・セーブ連携・ID）は 1 つだけ開く。キーボードで別のボタンを押したときは外側の pointerdown が来ないので、開いたときにほかを閉じる
  const closeOthers = (opened) => { for (const part of [bell, save, account]) if (part !== opened) part.close(); };
  const bell = notificationMenu(notifications, { onOpen: () => closeOthers(bell) });
  const save = saveStatus({ owned, autoRegister, store, onOpen: () => closeOthers(save) });
  // 名前の変更とログアウトに使うのは store と renamer だけ（context はこの後で作る）
  const account = accountMenu({ store, renamer, onOpen: () => closeOthers(account) });
  // 並び（＝Tab の順）: ロゴ → 同期状況 → セーブ連携 → ベル → 登録 → ID
  header.append(brand, envChip, headerStatus, save.element, bell.element, register, account.element);
  // 新しい版の配信を知らせる案内（画面の下端に固定。本文の流れの外）。再読み込みすると、送信待ちの操作や読み込み中のセーブ、開いている入力画面が失われる。
  const version = runningVersion();
  const update = updateBanner({
    current: version,
    busy: () => {
      if (store.state.syncing) return 'サーバへの保存が終わってから、もう一度押してください。';
      if (owned.state.busy || owned.state.upload.status === 'sending') return '所持パルの読み込み・共有が終わってから、もう一度押してください。';
      // 登録の画面・ワールドの登録・名前の変更などの入力を、読み込み直して失わないように
      if (document.querySelector?.('dialog[open]')) return '開いている入力画面を閉じてから、もう一度押してください。';
      return '';
    },
    served: () => servedVersion(location.href),
    reload: () => location.reload(),
  });
  root.append(skip, header, nav, update.element, main);
  installRipple();
  // 位置はアプリが戻す（戻る・進む・読み込み直しは、履歴のエントリに保存した位置）
  try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch { /* 戻せないブラウザでは今までどおり。 */ }
  let route;
  let currentView;
  let showingLogin = false;
  // 画面に出している route（作り直した後・applyRoute の後に入れる）と、そのときログイン中だったか（'in' | 'out'）
  let shownRoute = null;
  let shownAuth = '';
  // 画面に出しているエントリの ID と URL のハッシュ（描いた後に入れる。ログイン画面では ''）。戻る・進むで離れるエントリに条件を書くのと、
  // 同じ URL のエントリどうしの戻る・進む（popstate だけが来る）を見分けるのに使う
  let shownEntry = '';
  let shownHash = '';
  // 次の hashchange の理由（'navigate'・'tab'）。1 回使ったら消す。印がなければ戻る・進む・手入力
  let intent = null;
  let booted = false;
  const authKey = () => (store.state.passcode && store.state.userId ? 'in' : 'out');
  const urlOf = (hash) => `${location.pathname}${location.search}${hash}`;
  // 履歴のエントリの ID（history.state の palEntry。中身は ui/view-memory.js が sessionStorage に持つ）
  const entryId = () => idText(isObject(history.state) ? history.state.palEntry : '', 40);
  const scrollTop = () => Number(window.scrollY) || 0;
  // 新しく来たエントリ（リンク・タブで移った・初めて開いた）に ID を付ける。history.state のほかの鍵は消さない
  function ensureEntry() {
    if (entryId()) return;
    const state = isObject(history.state) ? history.state : {};
    try { history.replaceState({ ...state, palEntry: memory.newEntryId() }, '', urlOf(location.hash)); } catch { /* 付けられなければ、位置と条件を残さないだけ。 */ }
  }
  function writeEntry({ id, shown, y }) {
    if (!id || !shown) return;
    memory.writeEntry(id, { view: shown.view, key: routeKey(shown), cond: snapshotCond(shown.view), scrollY: y });
  }
  // スクロールした位置は間引いて書く。戻る・進むの hashchange の時点では、もう次のエントリになっているので、
  // スクロールしたときのエントリと画面を覚えておき、次の遷移の始めにも書き切る
  let scrolled = null;
  const saveScrolled = debounce(() => {
    const last = scrolled;
    scrolled = null;
    if (last) writeEntry(last);
  }, SCROLL_SAVE_DELAY);
  // 画面が間引いて待っている入力（打ってすぐタブ・リンクを押したときのキーワードなど）を、条件を書く前に当てる
  const flushInputs = () => currentView?.flushInputs?.();
  // 今のエントリの条件と位置を書く（移る前・ページを離れるとき）
  function saveEntry() {
    saveScrolled.cancel();
    scrolled = null;
    if (showingLogin) return;
    flushInputs();
    writeEntry({ id: entryId(), shown: shownRoute, y: scrollTop() });
  }
  // 読み込み直し用の保存（ページを離れるとき）: 画面ごとの条件とタブの行き先
  function saveViews() {
    if (showingLogin || !store.state.passcode || !store.state.userId) return;
    const saved = {};
    for (const view of Object.keys(CONDITIONS)) {
      const cond = snapshotCond(view);
      if (cond) saved[view] = cond;
    }
    memory.saveViews({ views: saved, tabs: Object.fromEntries(tabHrefs) });
  }
  // 位置を戻す（データの読み込み・区切った描画で高さが足りなければ、届くまでやり直す）。次の遷移・利用者の操作でやめる
  let scrolling = null;
  function moveTo(y) {
    scrolling?.cancel();
    scrolling = restoreScroll(y);
  }

  const context = {
    store,
    drafts,
    wishlist,
    ideals,
    // このワールドでの自分（設定のセーブ連携で選ぶ。理想個体・所持パルは変わったら描き直す）
    self,
    // 理想個体の配合の計画の基準（配合牧場の中身が最後に変わったときのおすすめ）
    planMemory: createPlanMemory({ storage: browserStorage, namespace }),
    notifications,
    owned,
    autoRegister,
    renamer,
    navigate(hash) {
      // 同じハッシュの代入では hashchange が来ないので、印を残さない（次の戻る・進むに付いてしまう）。
      // 移る前に、今のエントリの条件と位置を書いておく（hashchange の時点では、もう次のエントリになっている）
      if (location.hash !== hash) {
        saveEntry();
        intent = 'navigate';
      }
      location.hash = hash;
    },
    // 同じ画面の条件の変更（パル・パッシブを選ぶなど）。画面を作り直さず、ビューの applyRoute で合わせる。
    // 履歴は今までと同じく 1 選択＝1 件。違う画面・作り直すしかない画面では navigate と同じ
    update(hash, { replace = false } = {}) {
      const next = parseHash(hash);
      if (showingLogin || !currentView?.applyRoute || !sameScreen(shownRoute, next)) { context.navigate(hash); return; }
      // 同じ URL（押されている「すべて」をもう一度押すなど）では、履歴を増やさない
      if (location.hash === hash) return;
      saveEntry();
      if (replace) history.replaceState(history.state, '', urlOf(hash));
      // 新しいエントリには新しい ID を付ける（条件と位置は、次に離れるときに書く）
      else if (typeof history.pushState === 'function') history.pushState({ palEntry: memory.newEntryId() }, '', urlOf(hash));
      // pushState の無い環境。後で hashchange が来ても、applyRoute は同じ route では結果が変わらない
      else location.hash = hash;
      route = next;
      render('update');
    },
    // 画面を作る途中・applyRoute の中での URL の正規化（不正な ID を外すなど）。履歴の state は消さず、描き直さない
    replace(hash) {
      history.replaceState(history.state, '', urlOf(hash));
      if (showingLogin) return;
      shownHash = location.hash;
      route = parseHash(hash);
      if (sameScreen(shownRoute, route)) shownRoute = route;
      remember(route);
    },
    // 画面ごとの入力を残す入れ物（画面を作り直しても同じものを返す）
    viewState,
    register(initial, options) { return openRecordEditor(context, initial, options); },
    async merge(source, target, { ask = true, retry } = {}) {
      if (ask) {
        const preview = el('div', 'card-stack');
        preview.append(breedingCard(source, {}, { preview: true }), breedingCard(target, {}, { preview: true }));
        if (!await confirmDialog('登録を統合しますか？', '既存の登録に統合し、元の登録を削除します。', { preview, confirmText: '統合' })) return;
      }
      syncInBackground(store, store.mutate('merge', {
        sourceId: source.id, targetId: target.id, expectedEtags: { source: source.etag, target: target.etag },
      }), { done: () => toast('既存の登録に統合しました'), failure: '統合できませんでした', retry });
    },
    // 共有する配合なので確認してから消す（判断事項 7）。確認のカードの親の左右は、押した行（leftParent）とそろえる
    async remove(record, { leftParent = '' } = {}) {
      if (!await confirmDialog('この配合を削除しますか？', `仲間の画面からも消えます。削除後 ${ACTION_DURATION / 1000} 秒間は元に戻せます。`, {
        preview: breedingCard(record, {}, { preview: true, leftParent }), confirmText: '削除', danger: true,
      })) return;
      syncInBackground(store, store.mutate('delete', { id: record.id, expectedEtag: record.etag }), {
        failure: '削除できませんでした',
        done: () => toast('削除しました', { action: () => {
          // 削除前の版を渡すと、store が削除後の版に引き継いで送る。
          syncInBackground(store, store.mutate('restore', { id: record.id, expectedEtag: record.etag }), {
            failure: '元に戻せませんでした',
            done: (restored) => toast(restored.mergedInto ? '既存の登録に統合しました' : '元に戻しました'),
          });
        } }),
      });
    },
  };

  const views = { search: searchView, reverse: reverseView, route: inheritanceView, list: listView, owned: ownedView, ideal: idealView, drafts: draftsView, wishlist: wishlistView, pal: palView, settings: settingsView };

  function loginView(signup = false, previousId = store.state.userId) {
    // 見出しは「ログイン」「新規登録」だけ（キャッチコピーはなくした）。説明は新規登録のときだけ
    const panel = el('section', 'login-panel');
    panel.append(el('h1', '', signup ? '新規登録' : 'ログイン'));
    if (signup) panel.append(el('p', 'muted login-lead', 'ID は配合の登録者名になります（後で変更できます）。パスワードは仲間から聞いた共通のものです。'));
    const form = el('form', 'login-form');
    const userId = el('input');
    userId.autocomplete = 'username';
    userId.required = true;
    userId.value = previousId;
    const password = el('input');
    password.type = 'password';
    password.autocomplete = signup ? 'new-password' : 'current-password';
    password.required = true;
    const errors = el('p', 'form-errors');
    errors.setAttribute('role', 'alert');
    errors.textContent = store.state.error;
    const submit = button(signup ? '登録してログイン' : 'ログイン', () => form.requestSubmit(), 'button primary');
    form.append(field('ID（20 文字まで）', userId), field('共通パスワード', password), errors, submit);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      await runButton(submit, () => signup ? store.signup(userId.value, password.value) : store.login(userId.value, password.value),
        (error) => {
          const invalidId = error.response?.errors?.find((item) => item.field === 'userId');
          if (invalidId) {
            errors.textContent = invalidId.code === 'TOO_LONG' ? 'ID は 20 文字以内で入力してください。' : 'ID を入力してください。';
            return;
          }
          errors.textContent = error.message;
        });
    });
    const switchForm = button(signup ? 'ログインに戻る' : '新規登録', () => {
      store.state.error = '';
      loginView(!signup, userId.value);
    }, 'button secondary');
    const switchPanel = el('div', 'login-switch');
    if (!signup) switchPanel.append(el('p', 'muted', 'アカウントをお持ちでない方'));
    switchPanel.append(switchForm);
    // 注記は INV-2（配合の候補は登録済みの記録だけ）を利用者に伝える文なので残す
    panel.append(form, switchPanel, el('p', 'login-note', 'このノートに載るのは、仲間が登録した配合だけ。'));
    main.replaceChildren(panel);
    // すぐ入力できるよう、ID が入っていればパスワード、空なら ID の欄へ
    (userId.value ? password : userId).focus();
  }

  function markTabs(current) {
    for (const [view, tab] of tabLinks) {
      const active = current.view === view;
      tab.classList.toggle('active', active);
      if (active) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
  }

  // 位置: 同じ画面の条件の変更はそのまま、リンクで違う画面へは先頭、タブで違う画面へはその画面を離れたときの位置、
  // 戻る・進む・起動はエントリに保存した位置、ログインの切り替えは先頭。
  // 戻る・進むで位置の無いエントリ（ID のない新しいエントリ＝ヘッダーの通知・ダイアログのリンク・手入力で来た、
  // ID はあるが中身が 50 件の上限・名前の変更で消えたエントリ）は、違う画面なら先頭から。「動かさない」は同じ画面のときだけ
  function placeScroll(reason, previous, entry) {
    const changed = !sameScreen(previous, route);
    let y = null;
    if (reason === 'auth') y = 0;
    else if (reason === 'navigate') y = changed ? 0 : null;
    else if (reason === 'tab') y = changed ? viewState(route.view).scrollY ?? 0 : null;
    else if (reason === 'history' || reason === 'boot') {
      y = entry?.scrollY ?? null;
      if (y === null && reason === 'history' && changed) y = 0;
    }
    if (Number.isFinite(y)) moveTo(y);
  }

  // 遷移の適用。reason は 'boot'（起動）・'auth'（ログインの有無が変わった）・'navigate'（context.navigate・リンク）・'tab'（ナビのタブ）・
  // 'update'（context.update＝同じ画面の条件の変更）・'history'（印のない hashchange＝戻る・進む・手入力。同じ URL のエントリどうしの戻る・進むは popstate）。
  // 順番は ① 条件を当てる → ② 描く（作り直すか applyRoute）→ ③ 位置を戻す
  function render(reason = 'auth') {
    const needsLogin = !store.state.passcode || !store.state.userId;
    if (showingLogin && needsLogin) return;
    // 前のエントリでスクロールした位置を書き切り、前の遷移で始めた位置の戻しをやめる
    saveScrolled.flush();
    scrolling?.cancel();
    scrolling = null;
    // 戻る・進むでは、この時点で history.state がもう次のエントリなので、表示していたエントリ（離れるエントリ）に、
    // 離れるときの条件と位置を書く（スクロールしていなくても、最後に変えた条件で「進む」で戻れるように）
    if (shownEntry && shownEntry !== entryId() && !showingLogin) {
      flushInputs();
      writeEntry({ id: shownEntry, shown: shownRoute, y: scrollTop() });
    }
    const auth = authKey();
    const previous = shownRoute;
    // ① 戻る・進む・起動は、そのエントリに保存した条件（版・環境・利用者・ワールド・URL が今と合うものだけ）
    const entry = !needsLogin && (reason === 'history' || reason === 'boot')
      ? memory.readEntry(entryId(), { view: route.view, key: routeKey(route) }) : null;
    if (entry?.cond) applyCond(route.view, entry.cond, entry.world);
    // 同じ画面（view と id が同じ）で、ログインの有無も変わっていなければ作り直さず、ビューが条件と結果を合わせる
    //（入力中の値・開いた欄・フォーカスが残る）。applyRoute を持たない画面は作り直す
    if (!needsLogin && currentView?.applyRoute && auth === shownAuth && sameScreen(shownRoute, route)) {
      remember(route);
      markTabs(route);
      shownRoute = route;
      // restored: 戻る・進むで、そのエントリの条件を viewState に入れ直した（ビューは入力欄も合わせる）
      currentView.applyRoute(route, { reason, restored: Boolean(entry?.cond) });
      placeScroll(reason, previous, entry);
      ensureEntry();
      markShown();
      return;
    }
    // 画面を作り直すと部品も新しくなるため、同じ役目の部品（data-focus-key）へフォーカスを引き継ぐ
    const focus = captureFocus(main);
    // 離れる画面の位置を覚える（タブで戻ったとき用）
    if (previous) viewState(previous.view).scrollY = scrollTop();
    currentView?.destroy();
    currentView = null;
    shownRoute = null;
    showingLogin = needsLogin;
    shownAuth = auth;
    brand.inert = showingLogin;
    // ログイン画面の並び（CSS の #app.is-login。:has() は本文の出し入れのたびに全体のスタイルを計算し直させるので使わない）
    root.classList.toggle('is-login', showingLogin);
    nav.hidden = showingLogin;
    register.hidden = showingLogin;
    bell.element.hidden = showingLogin;
    save.element.hidden = showingLogin;
    account.element.hidden = showingLogin;
    // 同期状況（取得の失敗の文を含む）もログイン画面では出さない。ログインのエラーはフォームに出る
    sync.element.hidden = showingLogin;
    sync.update(store.state);
    if (showingLogin) {
      bell.close(); save.close(); account.close(); forget(); loginView();
      shownEntry = '';
      shownHash = '';
      if (reason === 'auth') moveTo(0);
      return;
    }
    // 画面の部品が URL を書き換える（不正な ID を消すなど）ときは、context.replace が route を入れ直して覚え直す。
    remember(route);
    markTabs(route);
    currentView = views[route.view](context, route);
    // 作る途中の context.replace で route が入れ替わることがあるので、作った後に入れる
    shownRoute = route;
    main.replaceChildren(currentView.element);
    restoreFocus(main, focus);
    placeScroll(reason, previous, entry);
    ensureEntry();
    markShown();
  }
  // 描いた後の今のエントリと URL を覚える（ensureEntry の後）
  function markShown() {
    shownEntry = entryId();
    shownHash = location.hash;
  }

  // ナビのタブ・本文やヘッダーのリンクで移るときは、移る前に今のエントリを書き、次の hashchange に理由を付ける
  //（タブ: その画面を離れたときの位置へ、それ以外: 先頭から）。document ではなく root に付ける（テストの偽の document でも動く）
  const anchorOf = (node) => {
    for (let current = node; current && current !== root; current = current.parentElement) {
      if (String(current.tagName ?? '').toLowerCase() === 'a') return current;
    }
    return null;
  };
  const plainClick = (event) => !(event.defaultPrevented || event.button > 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey);
  const hrefOf = (anchor) => (anchor ? String(anchor.getAttribute?.('href') ?? anchor.href ?? '') : '');
  // 設定を開いたまま、設定の行き先（`#/settings?…&open=<意図>`。views/settings.js が読んだら URL から外す）のリンクを押したときは、
  // 履歴を増やさずに今のエントリのまま行き先を当てる。増やすと、外した後の `#/settings` が 2 件続き、「戻る」が 1 回空振りする。
  // 行き先はその場でフォーカスを移すだけで、条件の変更（同じ画面の 1 選択＝1 履歴）ではないので増やさない。当てたら true。
  // later は当てる時機（既定はすぐ）
  function sameScreenDestination(event, hash, later = (apply) => apply()) {
    if (showingLogin || !hash.startsWith('#/') || hash === location.hash) return false;
    const next = parseHash(hash);
    if (next.view !== 'settings' || !SETTINGS_OPEN.includes(next.params.get('open')) || !currentView?.applyRoute || !sameScreen(shownRoute, next)) return false;
    event.preventDefault();
    later(() => context.update(hash, { replace: true }));
    return true;
  }
  root.addEventListener('click', (event) => {
    if (!plainClick(event)) return;
    const anchor = anchorOf(event.target);
    const hash = hrefOf(anchor);
    if (!hash.startsWith('#/') || hash === location.hash) return;
    if (sameScreenDestination(event, hash)) return;
    saveEntry();
    intent = String(anchor.className).split(' ').includes('nav-tab') ? 'tab' : 'navigate';
  });
  // ダイアログ（body に置く。設定の「通知一覧」など）の中のリンクも、同じ画面への行き先なら同じく履歴を増やさない。
  // リンクを押して閉じたダイアログは、閉じた後（close イベント。後から来る）でフォーカスを開いたボタンへ戻すので、行き先はその後に当てる
  //（close が来ないときのために、少し後にも 1 回だけ当てる）
  const afterClose = (dialog) => (apply) => {
    if (!dialog || dialog.open) { apply(); return; }
    let done = false;
    const once = () => { if (!done) { done = true; apply(); } };
    dialog.addEventListener('close', once, { once: true });
    setTimeout(once, 100);
  };
  document.addEventListener?.('click', (event) => {
    if (!plainClick(event) || root.contains?.(event.target)) return;
    sameScreenDestination(event, hrefOf(event.target?.closest?.('a') ?? null), afterClose(event.target?.closest?.('dialog')));
  });
  window.addEventListener('scroll', () => {
    if (showingLogin) return;
    scrolled = { id: entryId(), shown: shownRoute, y: scrollTop() };
    saveScrolled();
  }, { passive: true });
  // ページを離れる・裏に回るとき（読み込み直す前を含む）に、今のエントリと読み込み直し用の保存を書く
  const persist = () => {
    saveEntry();
    saveViews();
  };
  window.addEventListener('pagehide', persist);

  // 読み込み直したとき: 同じタブで前に保存した条件とタブの行き先を戻し、ハッシュのない URL なら最後に開いたタブから始める
  //（ブックマーク・通知のリンクなど、ハッシュがあればそれを使う）。今のエントリの条件は、この後の起動の描画で当てる
  if (store.state.passcode && store.state.userId) {
    const saved = memory.loadViews();
    if (saved) {
      for (const [view, cond] of Object.entries(saved.views)) applyCond(view, cond, saved.world);
      for (const [view, href] of Object.entries(saved.tabs)) setTabHref(view, href);
    }
    if (['', '#', '#/'].includes(location.hash)) {
      const view = memory.lastView(store.state.userId);
      if (view) history.replaceState(history.state, '', urlOf(saved?.tabs[view] ?? buildHash(view)));
    }
  }
  // 表示するワールドが替わったら所持者の条件を外す（画面より先に知らせを受けるよう、画面を作る前に登録する）
  owned.subscribe((state) => {
    const world = worldId(state.meta?.worldId);
    if (!world || world === conditionWorld) return;
    if (conditionWorld) forgetHolders();
    conditionWorld = world;
  });
  // ID が替わったら（名前の変更・別の ID でのログイン）、前の ID のエントリと保存を消す
  let memoryUser = store.state.userId ? userIdKey(store.state.userId) : '';

  startRouter((nextRoute) => {
    const reason = booted ? intent ?? 'history' : 'boot';
    booted = true;
    intent = null;
    route = nextRoute;
    render(reason);
  });
  // 同じ URL のエントリどうし（理想個体の「呼び出す」で g を外すと、URL が同じでエントリの違う履歴が並ぶ）を戻る・進むと、
  // hashchange が来ない。popstate で URL が表示中のまま、エントリだけが替わったときは、ここで戻る・進むとして描く。
  // URL が替わったときは、続けて来る hashchange（ルーター）に任せる（2 回描かない。リンクの移動でも popstate を出すブラウザでも同じ）
  window.addEventListener('popstate', () => {
    if (!booted || showingLogin || location.hash !== shownHash || entryId() === shownEntry) return;
    intent = null;
    route = parseHash(location.hash);
    render('history');
  });
  store.subscribe((state) => {
    envChip.hidden = state.env !== 'test';
    const userKey = state.userId ? userIdKey(state.userId) : '';
    if (userKey !== memoryUser) {
      if (memoryUser && userKey) memory.clear();
      memoryUser = userKey;
    }
    const scope = state.passcode && state.userId && state.env ? state.env : '';
    if (scope !== ownedScope) {
      ownedScope = scope;
      owned.scopeChanged().catch(() => {});
    }
    // ログイン中の ID が変わると既読の保存先が、記録が変わるとウィッシュリストの通知が変わる。
    notifications.changed();
    // ログインや記録の取得がセーブの読み込みより後に済んだときも、自動登録を確かめる
    autoRegister.evaluate();
    progress.update(state);
    if (showingLogin !== (!state.passcode || !state.userId)) {
      if (!state.passcode || !state.userId) closeDialogs();
      render('auth');
    }
    sync.update(state);
  });
  // 取得の失敗は、ヘッダーの同期状況（と、まだ何も読めていなければ画面の errorState の「もう一度読み込む」）に出る。
  // トーストは、前に読んだ配合を出したままのとき（裏の読み直しの失敗）だけエラーで重ねる。ログアウトしたらログイン画面で知らせる
  async function refresh(options) {
    try { await store.refresh(options); } catch (error) {
      if (store.state.passcode && store.state.env) toast(error.message, { kind: 'error' });
    }
  }
  // 送信待ちの操作は、サーバに届く前にページを閉じると失われる。
  window.addEventListener('beforeunload', (event) => {
    if (!store.state.syncing) return;
    event.preventDefault();
    event.returnValue = true;
  });
  wishlist.subscribe(notifications.changed);
  ideals.subscribe(notifications.changed);
  owned.subscribe(autoRegister.evaluate);
  // 別のタブで下書き・ウィッシュリスト・理想個体の登録・このワールドでの自分・登録者の対応・既読を書き換えたら読み直す。
  window.addEventListener('storage', (event) => {
    drafts.reload(event.key);
    wishlist.reload(event.key);
    ideals.reload(event.key);
    self.reload(event.key);
    // 登録者の対応（自動登録の対応表）は自分のプレイヤーの決め方にも使うので、本人の変化として知らせる（このタブで変えたときと同じく、
    // 判定し直しと理想個体・所持パル・設定の描き直し）
    if (autoRegister.reload(event.key)) self.changed();
    notifications.reload(event.key);
  });
  // 配信された版（version.json）を 5 分ごとと、タブに戻ったときに確かめる。版の無いローカルでは確かめない。
  const watcher = createVersionWatcher({
    current: version, bundledNoteIds: releaseNotes.map((note) => note.id), onUpdate: update.show,
  });
  if (version) {
    setInterval(() => { if (document.visibilityState === 'visible') watcher.check(); }, CHECK_INTERVAL);
    watcher.check();
  }
  // セーブのファイルを登録していれば、タブが裏にあっても 1 分ごとに読み直す（配合牧場の自動登録で、タマゴを拾う前に読むため）。
  // 長く裏にあるタブのタイマーは、ブラウザが 1 分に 1 回まで遅らせる。
  // 古いデータの印（時刻で変わる）も、このときに確かめ直す
  setInterval(() => {
    owned.pollAuto().catch(() => {});
    save.update();
  }, SAVE_POLL_INTERVAL);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persist();
    if (document.visibilityState === 'visible') {
      watcher.check();
      refresh({ throttled: true });
      // セーブのファイルを登録していれば、ゲームで進んだ分を読み直す。
      owned.autoRefresh().catch(() => {});
    }
  });
  await refresh();
}

try { await boot(); } catch {
  document.getElementById('app').replaceChildren(el('p', 'startup-error', '画面を読み込めませんでした。ページを再読み込みしてください。'));
}
