import { createApi } from './api.js';
import { createStore, safeStorage } from './store.js';
import { createDraftStore } from './drafts.js';
import { createNotificationStore, releaseNoteSource } from './notifications.js';
import { createWishlistStore, wishlistNotificationSource } from './wishlist.js';
import { createIdealStore, idealNotificationSource } from './ideals.js';
import { createPlanMemory } from './ideal-plan-memory.js';
import { createOwnedStore, idbPersist } from './owned.js';
import { createAutoRegister } from './auto-register.js';
import { createRenamer } from './user-rename.js';
import { startRouter, buildHash, parseHash, sameScreen } from './router.js';
import { el, button, link, field, runButton } from './ui/dom.js';
import { toast } from './ui/toast.js';
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
import { listView } from './views/list.js';
import { ownedView } from './views/owned.js';
import { idealView } from './views/ideal.js';
import { draftsView } from './views/drafts.js';
import { wishlistView } from './views/wishlist.js';
import { palView } from './views/pal.js';
import { settingsView } from './views/settings.js';

// 登録したセーブを読み直す間隔
const SAVE_POLL_INTERVAL = 60 * 1000;

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
  // 登録した理想個体（この端末に ID・環境ごと）。自分の個体で完成を判定して知らせる。
  // 自分のプレイヤーは、配合牧場の自動登録と同じ「登録者の対応」（なければ同じ名前）で決める
  const ideals = createIdealStore({
    store, owned, storage: browserStorage, namespace,
    identity: (worldId) => ({ userId: store.state.userId, users: store.state.users, mapping: autoRegister.mapping(worldId) }),
  });
  const notifications = createNotificationStore({
    store, storage: browserStorage, namespace,
    sources: [releaseNoteSource, wishlistNotificationSource({ store, wishlist }), idealNotificationSource({ store, ideals }), autoRegister.notices],
  });
  const renamer = createRenamer({ store, drafts, wishlist, ideals, notifications, storage: browserStorage, namespace });
  renamer.resumeLocal();
  const root = document.getElementById('app');
  const header = el('header', 'app-header');
  const brand = link('', buildHash('search'), 'brand');
  // 狭い窓では文字を隠してマークだけにする（CSS）ので、名前は aria-label で持つ
  brand.setAttribute('aria-label', 'パル配合ノート（配合検索へ）');
  const mark = el('span', 'brand-mark', '◇');
  const brandText = el('span', 'brand-text');
  brandText.append(el('strong', '', 'パル配合ノート'), el('small', '', '仲間と残す、冒険の発見。'));
  brand.append(mark, brandText);
  // テスト環境はロゴの右のチップ（後から帯が入って本文がずれないように、ヘッダーの中に置く）
  const envChip = el('span', 'env-chip', 'テスト環境');
  envChip.hidden = true;
  // 同期状況は押すと最新に更新する（読み上げの告知は付けない）
  const sync = syncStatus({ store, locked: () => showingLogin });
  const progress = syncProgress();
  const headerStatus = el('div', 'header-status');
  headerStatus.append(sync.element, progress.element);
  const nav = el('nav', 'navigation');
  nav.setAttribute('aria-label', 'メインナビゲーション');
  // 並びは 探す｜記録｜所持｜設定 の順（区切りの余白は CSS）
  const tabs = [['search', '配合検索'], ['reverse', '逆引き'], ['route', '継承ルート'], ['list', '一覧'], ['drafts', '下書き'], ['wishlist', 'ウィッシュリスト'], ['owned', '所持パル'], ['ideal', '理想個体'], ['settings', '設定']];
  const tabLinks = new Map();
  for (const [view, label] of tabs) {
    const tab = link('', buildHash(view), 'nav-tab');
    // グループの区切りの余白は CSS が data-view で付ける
    tab.setAttribute('data-view', view);
    const symbol = el('span', 'tab-symbol');
    symbol.append(navIcon(view));
    tab.append(symbol, el('span', '', label));
    nav.append(tab);
    tabLinks.set(view, tab);
  }
  // タブを切り替えても、各画面の選択（URL）と絞り込み（画面内の入力）を残す。メモリにだけ持つため、ページを読み込み直すと消える。
  const viewStates = new Map();
  function remember(next) {
    const href = buildHash(next.view, next.params, next.id);
    const tab = tabLinks.get(next.view);
    if (tab) tab.href = href;
    if (next.view === 'search') brand.href = href;
  }
  // ログアウトしたら、次にログインする人へ前の人の選択を引き継がない。
  function forget() {
    viewStates.clear();
    for (const [view, tab] of tabLinks) tab.href = buildHash(view);
    brand.href = buildHash('search');
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
  const bell = notificationMenu(notifications);
  const save = saveStatus({ owned, autoRegister, store });
  // 名前の変更とログアウトに使うのは store と renamer だけ（context はこの後で作る）
  const account = accountMenu({ store, renamer });
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
  let route;
  let currentView;
  let showingLogin = false;
  // 画面に出している route（作り直した後・applyRoute の後に入れる）と、そのときログイン中だったか（'in' | 'out'）
  let shownRoute = null;
  let shownAuth = '';
  // 次の hashchange の理由（'navigate'。keep-state で 'tab' も付ける）。1 回使ったら消す。印がなければ戻る・進む・手入力
  let intent = null;
  let booted = false;
  const authKey = () => (store.state.passcode && store.state.userId ? 'in' : 'out');
  const urlOf = (hash) => `${location.pathname}${location.search}${hash}`;

  const context = {
    store,
    drafts,
    wishlist,
    ideals,
    // 理想個体の配合の計画の基準（配合牧場の中身が最後に変わったときのおすすめ）
    planMemory: createPlanMemory({ storage: browserStorage, namespace }),
    notifications,
    owned,
    autoRegister,
    renamer,
    navigate(hash) {
      // 同じハッシュの代入では hashchange が来ないので、印を残さない（次の戻る・進むに付いてしまう）
      if (location.hash !== hash) intent = 'navigate';
      location.hash = hash;
    },
    // 同じ画面の条件の変更（パル・パッシブを選ぶなど）。画面を作り直さず、ビューの applyRoute で合わせる。
    // 履歴は今までと同じく 1 選択＝1 件。違う画面・作り直すしかない画面では navigate と同じ
    update(hash, { replace = false } = {}) {
      const next = parseHash(hash);
      if (showingLogin || !currentView?.applyRoute || !sameScreen(shownRoute, next)) { context.navigate(hash); return; }
      // 同じ URL（押されている「すべて」をもう一度押すなど）では、履歴を増やさない
      if (location.hash === hash) return;
      if (replace) history.replaceState(history.state, '', urlOf(hash));
      else if (typeof history.pushState === 'function') history.pushState(null, '', urlOf(hash));
      // pushState の無い環境。後で hashchange が来ても、applyRoute は同じ route では結果が変わらない
      else location.hash = hash;
      route = next;
      render('update');
    },
    // 画面を作る途中・applyRoute の中での URL の正規化（不正な ID を外すなど）。履歴の state は消さず、描き直さない
    replace(hash) {
      history.replaceState(history.state, '', urlOf(hash));
      if (showingLogin) return;
      route = parseHash(hash);
      if (sameScreen(shownRoute, route)) shownRoute = route;
      remember(route);
    },
    // 画面ごとの入力を残す入れ物（画面を作り直しても同じものを返す）
    viewState(view) {
      if (!viewStates.has(view)) viewStates.set(view, {});
      return viewStates.get(view);
    },
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
    async remove(record) {
      if (!await confirmDialog('この配合を削除しますか？', '削除後、3 秒間は元に戻せます。', {
        preview: breedingCard(record, {}, { preview: true }), confirmText: '削除', danger: true,
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
    const panel = el('section', 'login-panel');
    panel.append(el('span', 'login-mark', '◇'), el('p', 'eyebrow', '仲間とつくる、配合の記録'),
      el('h1', '', signup ? '新規登録' : '冒険の発見を、\nみんなのノートに。'),
      el('p', 'muted', 'ID と共通パスワードを入力してください。'));
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
    form.append(field('ID（1〜20文字）', userId), field('パスワード', password), errors, submit);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      await runButton(submit, () => signup ? store.signup(userId.value, password.value) : store.login(userId.value, password.value),
        (error) => {
          const invalidId = error.response?.errors?.find((item) => item.field === 'userId');
          if (invalidId) {
            errors.textContent = invalidId.code === 'TOO_LONG' ? 'ID は20文字以内で入力してください。' : 'ID を入力してください。';
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
    panel.append(form, switchPanel, el('p', 'login-note', 'このノートに載るのは、仲間が登録した配合だけ。'));
    main.replaceChildren(panel);
  }

  function markTabs(current) {
    for (const [view, tab] of tabLinks) {
      const active = current.view === view;
      tab.classList.toggle('active', active);
      if (active) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
  }

  // 遷移の適用。reason は 'boot'（起動）・'auth'（ログインの有無が変わった）・'navigate'（context.navigate）・
  // 'update'（context.update＝同じ画面の条件の変更）・'history'（印のない hashchange＝戻る・進む・手入力）
  function render(reason = 'auth') {
    const needsLogin = !store.state.passcode || !store.state.userId;
    if (showingLogin && needsLogin) return;
    const auth = authKey();
    // 同じ画面（view と id が同じ）で、ログインの有無も変わっていなければ作り直さず、ビューが条件と結果を合わせる
    //（入力中の値・開いた欄・フォーカスが残る）。applyRoute を持たない画面は作り直す
    if (!needsLogin && currentView?.applyRoute && auth === shownAuth && sameScreen(shownRoute, route)) {
      remember(route);
      markTabs(route);
      shownRoute = route;
      currentView.applyRoute(route, { reason });
      return;
    }
    const pickerLabel = document.activeElement?.getAttribute('aria-haspopup') === 'listbox'
      ? document.activeElement.getAttribute('aria-label') : null;
    const passiveLabel = String(document.activeElement?.className ?? '').split(' ').includes('passive-add')
      ? document.activeElement.getAttribute('aria-label') : null;
    currentView?.destroy();
    currentView = null;
    shownRoute = null;
    showingLogin = needsLogin;
    shownAuth = auth;
    brand.inert = showingLogin;
    nav.hidden = showingLogin;
    register.hidden = showingLogin;
    bell.element.hidden = showingLogin;
    save.element.hidden = showingLogin;
    account.element.hidden = showingLogin;
    sync.update(store.state);
    if (showingLogin) { bell.close(); save.close(); account.close(); forget(); loginView(); return; }
    // 画面の部品が URL を書き換える（不正な ID を消すなど）ときは、context.replace が route を入れ直して覚え直す。
    remember(route);
    markTabs(route);
    currentView = views[route.view](context, route);
    // 作る途中の context.replace で route が入れ替わることがあるので、作った後に入れる
    shownRoute = route;
    main.replaceChildren(currentView.element);
    // 画面を作り直したときは部品も新しくなるため、同じ選択欄へフォーカスを引き継ぐ（同じ画面の条件の変更では作り直さない）。
    if (pickerLabel) {
      Array.from(main.querySelectorAll('.picker-trigger')).find((picker) => picker.getAttribute('aria-label') === pickerLabel)?.focus();
    }
    if (passiveLabel) {
      Array.from(main.querySelectorAll('.passive-add')).find((select) => select.getAttribute('aria-label') === passiveLabel)?.focus();
    }
  }

  startRouter((nextRoute) => {
    const reason = booted ? intent ?? 'history' : 'boot';
    booted = true;
    intent = null;
    route = nextRoute;
    render(reason);
  });
  store.subscribe((state) => {
    envChip.hidden = state.env !== 'test';
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
  async function refresh(options) {
    try { await store.refresh(options); } catch (error) { toast(error.message); }
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
  // 別のタブで下書き・ウィッシュリスト・理想個体の登録・既読を書き換えたら読み直す。
  window.addEventListener('storage', (event) => {
    drafts.reload(event.key);
    wishlist.reload(event.key);
    ideals.reload(event.key);
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
