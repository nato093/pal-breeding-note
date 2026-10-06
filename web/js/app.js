import { createApi } from './api.js';
import { createStore, safeStorage } from './store.js';
import { createDraftStore } from './drafts.js';
import { createNotificationStore, releaseNoteSource } from './notifications.js';
import { createWishlistStore, wishlistNotificationSource } from './wishlist.js';
import { createOwnedStore, idbPersist } from './owned.js';
import { createAutoRegister } from './auto-register.js';
import { startRouter, buildHash, parseHash } from './router.js';
import { el, button, link, field, formatTime, runButton } from './ui/dom.js';
import { toast } from './ui/toast.js';
import { syncInBackground } from './ui/sync.js';
import { syncProgress } from './ui/sync-progress.js';
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
import { draftsView } from './views/drafts.js';
import { wishlistView } from './views/wishlist.js';
import { palView } from './views/pal.js';
import { settingsView } from './views/settings.js';

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
  const store = createStore({ api: createApi({ transport }), storage: safeStorage(browserStorage), namespace });
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
  const notifications = createNotificationStore({
    store, storage: browserStorage, namespace,
    sources: [releaseNoteSource, wishlistNotificationSource({ store, wishlist }), autoRegister.notices],
  });
  const root = document.getElementById('app');
  const banner = el('div', 'environment-banner', 'テスト環境');
  banner.hidden = true;
  const header = el('header', 'app-header');
  const brand = link('', buildHash('search'), 'brand');
  const mark = el('span', 'brand-mark', '◇');
  const brandText = el('span');
  brandText.append(el('strong', '', 'パル配合ノート'), el('small', '', '仲間と残す、冒険の発見。'));
  brand.append(mark, brandText);
  const status = el('p', 'sync-status');
  status.setAttribute('aria-live', 'polite');
  const progress = syncProgress();
  const headerStatus = el('div', 'header-status');
  headerStatus.append(status, progress.element);
  header.append(brand, headerStatus);
  const nav = el('nav', 'navigation');
  nav.setAttribute('aria-label', 'メインナビゲーション');
  // 並びは 探す｜記録｜所持｜設定 の順（区切りの余白は CSS）
  const tabs = [['search', '配合検索'], ['reverse', '逆引き'], ['route', '継承ルート'], ['list', '一覧'], ['drafts', '下書き'], ['wishlist', 'ウィッシュリスト'], ['owned', '所持パル'], ['settings', '設定']];
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
  const actions = el('div', 'header-actions');
  actions.append(bell.element, register);
  // 新しい版の配信を知らせる帯。再読み込みすると、送信待ちの操作や読み込み中のセーブが失われる。
  const version = runningVersion();
  const update = updateBanner({
    current: version,
    busy: () => {
      if (store.state.syncing) return 'サーバへの保存が終わってから、もう一度押してください。';
      if (owned.state.busy || owned.state.upload.status === 'sending') return '所持パルの読み込み・共有が終わってから、もう一度押してください。';
      return '';
    },
    served: () => servedVersion(location.href),
    reload: () => location.reload(),
  });
  root.append(skip, banner, header, nav, update.element, main, actions);
  installRipple();
  let route;
  let currentView;
  let showingLogin = false;

  const context = {
    store,
    drafts,
    wishlist,
    notifications,
    owned,
    autoRegister,
    navigate(hash) { location.hash = hash; },
    replace(hash) {
      history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
      if (!showingLogin) remember(parseHash(hash));
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

  const views = { search: searchView, reverse: reverseView, route: inheritanceView, list: listView, owned: ownedView, drafts: draftsView, wishlist: wishlistView, pal: palView, settings: settingsView };

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

  function render() {
    const needsLogin = !store.state.passcode || !store.state.userId;
    if (showingLogin && needsLogin) return;
    const pickerLabel = document.activeElement?.getAttribute('aria-haspopup') === 'listbox'
      ? document.activeElement.getAttribute('aria-label') : null;
    const passiveLabel = String(document.activeElement?.className ?? '').split(' ').includes('passive-add')
      ? document.activeElement.getAttribute('aria-label') : null;
    currentView?.destroy();
    currentView = null;
    showingLogin = needsLogin;
    brand.inert = showingLogin;
    nav.hidden = showingLogin;
    register.hidden = showingLogin;
    bell.element.hidden = showingLogin;
    if (showingLogin) { bell.close(); forget(); loginView(); return; }
    // 画面の部品が URL を書き換える（不正な ID を消すなど）ときは context.replace が覚え直す。
    remember(route);
    for (const [view, tab] of tabLinks) {
      const active = route.view === view;
      tab.classList.toggle('active', active);
      if (active) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
    currentView = views[route.view](context, route);
    main.replaceChildren(currentView.element);
    // 選択の解除で URL が変わると部品も作り直されるため、同じ選択欄へフォーカスを引き継ぐ。
    if (pickerLabel) {
      Array.from(main.querySelectorAll('.picker-trigger')).find((picker) => picker.getAttribute('aria-label') === pickerLabel)?.focus();
    }
    // パッシブを選ぶと URL が変わって画面が作り直されるため、続けて選べるよう同じ選択欄へフォーカスを戻す。
    if (passiveLabel) {
      Array.from(main.querySelectorAll('.passive-add')).find((select) => select.getAttribute('aria-label') === passiveLabel)?.focus();
    }
  }

  startRouter((nextRoute) => {
    route = nextRoute;
    render();
  });
  store.subscribe((state) => {
    banner.hidden = state.env !== 'test';
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
    status.textContent = state.syncing ? `サーバに保存中… ${state.syncDone} / ${state.syncTotal} 件`
      : state.loading ? '記録を更新中…' : state.error || (state.serverTime
      ? `${state.cached ? '前回取得' : '最新取得'} ${formatTime(state.serverTime)}${state.cached ? ' 時点' : ''} · ${state.records.length} 件` : '仲間だけの配合ノート');
    if (showingLogin !== (!state.passcode || !state.userId)) {
      if (!state.passcode || !state.userId) closeDialogs();
      render();
    }
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
  owned.subscribe(autoRegister.evaluate);
  // 別のタブで下書き・ウィッシュリスト・既読を書き換えたら読み直す。
  window.addEventListener('storage', (event) => {
    drafts.reload(event.key);
    wishlist.reload(event.key);
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
