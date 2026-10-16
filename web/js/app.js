import { createApi } from './api.js';
import { API_URL } from './config.js';
import { createStore, safeStorage } from './store.js';
import { createDraftStore } from './drafts.js';
import { createNotificationStore, releaseNoteSource } from './notifications.js';
import { createIdealStore, idealNotificationSource, goalObservationSource } from './ideals.js';
import { createSelfStore } from './self-player.js';
import { createPlanMemory } from './ideal-plan-memory.js';
import { createSearchSeen } from './search-seen.js';
import { createOwnedSeen } from './owned-seen.js';
import { createReverserHidden } from './reverser-hidden.js';
import { createOwnedStore, idbPersist } from './owned.js';
import { createAutoRegister } from './auto-register.js';
import { createAttention } from './attention.js';
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
import { createDrawer, handlePalLink } from './ui/drawer.js';
import { palPicker } from './ui/pal-picker.js';
import { installHoverCards } from './ui/hover-card.js';
import { palsById } from './ui/pal-icon.js';
import { installRipple } from './ui/ripple.js';
import { runningVersion, createVersionWatcher, servedVersion, CHECK_INTERVAL } from './version.js';
import releaseNotes from './release-notes.js';
import { searchView } from './views/search.js';
import { inheritanceView } from './views/route.js';
import { ownedView, OWNED_MEMORY } from './views/owned.js';
import { idealView, IDEAL_MEMORY } from './views/ideal.js';
import { palView, palDrawer } from './views/pal.js';
import { ownedDetail } from './views/owned-detail.js';
import { farmBoard } from './ui/farm-board.js';
import { speciesOwnedPanel } from './views/species-owned.js';
import { settingsView, RIGHTS_NOTE } from './views/settings.js';
import { palDataNotes } from './views/shared.js';
import { TABS, tabLabel } from './views/tabs.js';
import { ownedWorldId } from './core/owned-shared.js';

// 所持パルを読み直す間隔（全画面で 1 本。表のタブなら共有も、裏のタブでは登録したセーブだけ。share-fetch）
const SAVE_POLL_INTERVAL = 10 * 1000;
// スクロールした位置を今の履歴のエントリに書くまでの間引き
const SCROLL_SAVE_DELAY = 300;
// 画面ごとに保存する条件（viewState の中の入れ物の名前。'' は viewState そのもの）と、その形（各画面が export する）
// （配合を探すの条件は URL にあるので、ここには持たない）
const CONDITIONS = { owned: ['filter', OWNED_MEMORY], ideal: ['conditions', IDEAL_MEMORY] };
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
    // as は開発用の役割の切り替え（viewer: 共有ワールドを 1 つ入れて、未連携で共有を見ている人の画面を確かめる。roles）
    const search = new URLSearchParams(location.search);
    transport = development.createDevelopmentApi({ seed: search.get('seed'), as: search.get('as') });
  }
  let browserStorage = null;
  try { browserStorage = window.localStorage; } catch { /* 保存できない端末でも画面は使える。 */ }
  const namespace = localDevelopment ? 'pal-note.local' : 'pal-note';
  const store = createStore({
    api: createApi({ transport }), storage: safeStorage(browserStorage), namespace,
    onUserIdChange: (previous, next, env) => renamer.followServer(previous, next, env),
  });
  const drafts = createDraftStore({ store, storage: browserStorage, namespace });
  // 所持パル（セーブから読み込んだ一覧）はログインと関係なく、このブラウザに保存する。
  const owned = createOwnedStore({
    persist: idbPersist(namespace), settings: safeStorage(browserStorage), namespace,
    // 共有（スプレッドシート）はログイン中の環境ごと
    server: {
      scope: () => (store.state.passcode && store.state.userId && store.state.env ? store.state.env : ''),
      userId: () => store.state.userId,
      request: (action, input) => store.call(action, input),
      // 接続先（GAS ができることを接続先と環境ごとに覚える。開発用 API は別の接続先）
      endpoint: () => (transport ? 'local' : API_URL),
    },
  });
  let ownedScope = '';
  // 配合牧場からの自動登録（ホストのセーブを読み込んだとき）。合わなかったものは通知に出す。
  const autoRegister = createAutoRegister({
    store, owned, storage: safeStorage(browserStorage), namespace, toast, onNotice: () => notifications.changed(),
    // 成功のトーストの「見る」（context は後で作るので、押したときに引く）
    navigate: (hash) => context.navigate(hash),
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
    // 目標の種族の配合の登録（前のウィッシュリストの通知。id は同じ形）と、目標の完成
    sources: [releaseNoteSource, goalObservationSource({ store, ideals }), idealNotificationSource({ store, ideals }), autoRegister.notices],
  });
  // 題名とファビコン（裏のタブで要確認の未読と読み込みの停止を出す。autoreg-visibility）
  const attention = createAttention({ document, notifications, owned });
  // 理想個体のパルリバーサーの案内を消した目標（この端末に環境・ID ごと。仲間と共有しない。implants・D17）。名前の変更でも移す
  const reverserHidden = createReverserHidden({ storage: browserStorage, namespace });
  const renamer = createRenamer({ store, drafts, ideals, self, notifications, reverserHidden, storage: browserStorage, namespace });
  renamer.resumeLocal();
  const root = document.getElementById('app');
  const header = el('header', 'app-header');
  const brand = link('', buildHash('search'), 'brand');
  // 狭い窓では文字を隠してマークだけにする（CSS）ので、名前は aria-label で持つ
  brand.setAttribute('aria-label', 'パル配合ノート（配合を探すへ）');
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
  // 理想個体のタブの「完成した目標 n」（表示しているワールドで完成済みの目標の数。0 なら隠す。F004）。文字・hidden・aria-label だけを
  // 書き換える（画面は描き直さない）
  const idealTab = tabLinks.get('ideal');
  const goalBadge = el('span', 'nav-badge');
  goalBadge.hidden = true;
  goalBadge.setAttribute('aria-hidden', 'true');
  idealTab?.append(goalBadge);
  // 所持パルのタブの「!」（自動の読み込みが止まっている〔許可待ち・読めない・登録なし〕とき。警告の色。G-36）。文字・hidden・aria-label だけを書き換える
  const ownedTab = tabLinks.get('owned');
  const ownedBadge = el('span', 'nav-badge is-warning');
  ownedBadge.hidden = true;
  ownedBadge.setAttribute('aria-hidden', 'true');
  ownedTab?.append(ownedBadge);
  // 設定のタブの整合性の警告の数（1 件以上のとき。ベルの数字と同じ赤。押すと警告のカードへ〔#/settings?open=warnings〕。C-12）
  const settingsTab = tabLinks.get('settings');
  const warningBadge = el('span', 'nav-badge is-error');
  warningBadge.hidden = true;
  warningBadge.setAttribute('aria-hidden', 'true');
  settingsTab?.append(warningBadge);
  const warningCount = () => (store.state.passcode ? store.state.warnings?.length ?? 0 : 0);
  // 設定を開いて見た警告（同じ警告のあいだは、設定のタブを警告のカードへ向けない）
  const warningKey = () => (warningCount() ? JSON.stringify(store.state.warnings) : '');
  let seenWarnings = '';
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
    // 整合性の警告があり、まだ設定で見ていなければ、設定のタブは警告のカードへ（覚える行き先は今までどおり）
    tab.href = view === 'settings' && warningCount() && warningKey() !== seenWarnings ? buildHash('settings', { open: 'warnings' }) : href;
    tabHrefs.set(view, href);
    if (view === 'search') brand.href = href;
  }
  function remember(next) {
    if (!tabLinks.has(next.view)) return;
    if (next.view === 'settings') seenWarnings = warningKey();
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
  // ヘッダーのパネル（ベル・セーブ連携・ID）は 1 つだけ開く。キーボードで別のボタンを押したときは外側の pointerdown が来ないので、開いたときにほかを閉じる
  const closeOthers = (opened) => { for (const part of [bell, save, account]) if (part !== opened) part.close(); };
  const bell = notificationMenu(notifications, { onOpen: () => closeOthers(bell) });
  // 「配合牧場を見る」は右のドロワー（context の後で作るので、押したときに引く。farm-board）
  // 自分のプレイヤー（参加者のパル次元ストレージの読み漏れの案内。dps-missing）は理想個体と同じ決め方（ideals.selfUids）
  const save = saveStatus({
    owned, autoRegister, store, onOpen: () => closeOthers(save), openFarms: (opener) => drawer.open({ kind: 'farms', id: '' }, { opener }),
    selfUids: () => ideals.selfUids(),
  });
  // 名前の変更とログアウトに使うのは store と renamer だけ（context はこの後で作る）
  const account = accountMenu({ store, renamer, onOpen: () => closeOthers(account) });
  // ヘッダーのパル検索（G-03。どの画面からでも、選んだパルを右のドロワーで開く。選んだら空に戻す）。ショートカットは「/」。
  // 候補は「データあり（登録か所持がある種族）」→「その他」の 2 群（F077）。ドロワーは context の後で作るので、選んだときに引く
  const palSearch = palPicker({
    label: 'パルを探す', placeholder: 'パルを探す', popupHost: document.body, triggerLabel: 'パルを探す（/）', searchLabel: 'パルを名前・英名・番号で探す',
    describe: () => palDataNotes(store.state.index, owned.state.owned),
    onChange: (id) => {
      if (!id) return;
      palSearch.setValue('');
      drawer.open({ kind: 'pal', id }, { opener: palSearchTrigger });
    },
  });
  palSearch.element.classList.add('header-pal-search');
  const palSearchTrigger = palSearch.element.querySelector('.picker-trigger');
  palSearchTrigger?.setAttribute('aria-keyshortcuts', '/');
  if (palSearchTrigger) palSearchTrigger.title = 'パルを探す（/）';
  // 並び（＝Tab の順）: ロゴ → パル検索 → 同期状況 → セーブ連携 → ベル → ID。常設の「＋ 登録」は外し、登録の入口は配合を探す・パル詳細の
  // 文脈のボタンと、ショートカット N にした（register-entry。D2）
  header.append(brand, envChip, palSearch.element, headerStatus, save.element, bell.element, account.element);
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
    ideals,
    // このワールドでの自分（設定のセーブ連携で選ぶ。理想個体・所持パルは変わったら描き直す）
    self,
    // 理想個体の配合の計画の基準（配合牧場の中身が最後に変わったときのおすすめ）
    planMemory: createPlanMemory({ storage: browserStorage, namespace }),
    // 配合を探すの「新」の印の基準（前にその画面を離れた時刻。この端末に環境・ID ごと）
    seen: createSearchSeen({ storage: browserStorage, namespace }),
    // 所持パルの「NEW」の基準（ワールドごとに、前に所持パルの画面で見ていたデータのセーブの時刻。この端末に環境・ID ごと。save-extras）
    ownedSeen: createOwnedSeen({ storage: browserStorage, namespace }),
    // 理想個体のパルリバーサーの案内を消した目標（上で作ったもの）
    reverserHidden,
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
      // 置き換えでは、開いているドロワーを「積んだときの URL ではない」印にする（× で戻ると、置き換えた条件ごと前のエントリへ戻るため）
      if (replace) history.replaceState({ ...history.state, ...drawer.carry() }, '', urlOf(hash));
      // 新しいエントリには新しい ID を付ける（条件と位置は、次に離れるときに書く）
      // 開いているドロワーは引き継ぐ（同じ画面の条件の変更では閉じない。引き継いだエントリはドロワーが積んだものではない印つき）
      else if (typeof history.pushState === 'function') history.pushState({ palEntry: memory.newEntryId(), ...drawer.carry() }, '', urlOf(hash));
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

  const views = { search: searchView, route: inheritanceView, owned: ownedView, ideal: idealView, pal: palView, settings: settingsView };
  // 右のサイドドロワー（D3。本文に重ねる・1 度に 1 つ）。中身は種類ごとの表で渡す（drawer.js は中身を知らない）。本文の画面とは別に持ち、
  // 画面を作り直してもドロワーは壊さない
  const drawerContents = {
    pal: (entry) => palDrawer(context, entry.id),
    // 所持パルの個体の詳細（params.q は所持パルで入れていたキーワード。一致の理由の全文を出す。owned-detail）
    owned: (entry, _context, { setTitle } = {}) => ownedDetail(context, entry.id, { query: entry.params?.q ?? '', setTitle }),
    // 全部の配合牧場（所持パルの帯の「右に開く」・セーブ連携のパネル・理想個体の配合牧場の詳細から。farm-board）
    farms: () => farmBoard(context, { mode: 'drawer' }),
    // 1 種族の所持個体（継承ルートの相手親のチップから。params.p は運ぶパッシブ。route-progress）
    species: (entry) => speciesOwnedPanel(context, entry.id, { passives: (entry.params?.p ?? '').split(',').filter(Boolean).slice(0, 4) }),
  };
  const drawer = createDrawer({ context, render: drawerContents, main, url: () => urlOf(location.hash) });
  context.drawer = drawer;
  root.append(drawer.element);
  // パルのタイル・パッシブのチップの解説の板（F059。委譲のリスナー 1 組）
  const hoverCards = installHoverCards(root, { context });

  function loginView(signup = false, previousId = store.state.userId) {
    // 見出しは「ログイン」「新規登録」だけ（キャッチコピーはなくした）。説明は新規登録のときだけ
    const panel = el('section', 'login-panel');
    panel.append(el('h1', '', signup ? '新規登録' : 'ログイン'));
    if (signup) panel.append(el('p', 'muted login-lead', 'ID は配合の登録者名になります（後で変更できます）。パスワードは仲間から聞いた共通のものです。'));
    const form = el('form', 'login-form');
    const userId = el('input');
    userId.autocomplete = 'username';
    userId.required = true;
    // ID は 20 文字まで（サーバの検証と同じ。D-17）
    userId.maxLength = 20;
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
    panel.append(form, switchPanel, el('p', 'login-note', 'このノートに載るのは、仲間が登録した配合だけ。'), el('p', 'login-note login-rights', RIGHTS_NOTE));
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
    // 題名の画面名（タブの名前。パル詳細はパルの名前、ID のない・不正な `#/pal` は図鑑。attention.js）
    attention.setScreen(current.view === 'pal' ? palsById.get(current.id)?.ja ?? '図鑑' : tabLabel(current.view));
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
    // 解説の板は画面が替わると対象を見失うので外す
    hoverCards.hide();
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
      placeDrawer(reason);
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
    bell.element.hidden = showingLogin;
    palSearch.element.hidden = showingLogin;
    save.element.hidden = showingLogin;
    account.element.hidden = showingLogin;
    // 同期状況（取得の失敗の文を含む）もログイン画面では出さない。ログインのエラーはフォームに出る
    sync.element.hidden = showingLogin;
    sync.update(store.state);
    if (showingLogin) {
      attention.setScreen('');
      drawer.close({ reason: 'logout' });
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
    placeDrawer(reason);
    markShown();
  }
  // ドロワー: リンク・タブで移った（新しいエントリ）・ログインの切り替えでは閉じる。戻る・進む・起動は、そのエントリの history.state に合わせる
  //（版・環境・利用者が違えば開かない）。同じ画面の条件の変更（update）は開いたまま
  function placeDrawer(reason) {
    if (reason === 'history' || reason === 'boot') drawer.sync();
    else if (reason !== 'update') drawer.close({ reason: 'route' });
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
    // パルのタイルの普通のクリックは、画面を移らずに右のドロワーで開く（Ctrl・中クリックは今までどおり全画面のパル詳細）
    if (!showingLogin && handlePalLink(event, root, drawer)) return;
    if (!plainClick(event)) return;
    const anchor = anchorOf(event.target);
    const hash = hrefOf(anchor);
    if (!hash.startsWith('#/')) return;
    // 同じ URL か（書き方だけ違う URL も同じとみなす。更新内容の通知の `#/pal` と、buildHash の `#/pal/` など）
    const sameUrl = hash === location.hash || routeKey(parseHash(hash)) === routeKey(parseHash(location.hash));
    if (sameUrl) {
      // ドロワーの中の、今の本文と同じ URL へのリンク（図鑑を開いたまま、ドロワーのパル詳細の「図鑑」を押したなど）は、移る先がないので
      // ドロワーを閉じて本文を見せる（× と同じ。paldex）
      if (drawer.isOpen() && drawer.element.contains?.(anchor)) {
        event.preventDefault();
        drawer.close({ reason: 'dismiss' });
      } else if (hash !== location.hash) {
        // 書き方だけ違う同じ URL へは移らない（移ると同じ画面を作り直し、履歴が 1 件増える。フェーズ 4 の終わりのレビュー）
        event.preventDefault();
      }
      return;
    }
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
  // ショートカット（G-06）: N は配合の登録を開く（配合を探すで親・子を選んでいればそれを初期値に。ドロワーの中にフォーカスがあれば、その
  // パル詳細の子を初期値に。register-entry）、「/」はヘッダーのパル検索を開く（pal-detail）。文字を打っている・日本語の変換中・長押し・
  // 修飾キーつき・ログイン画面・ダイアログが開いている・候補を開いている間は何もしない
  const shortcutBlocked = (event) => {
    if (event.isComposing || event.repeat || event.ctrlKey || event.altKey || event.metaKey || showingLogin) return true;
    if (!store.state.passcode || !store.state.userId) return true;
    if (document.querySelector?.('dialog[open]')) return true;
    const active = document.activeElement;
    const tag = String(active?.tagName ?? '').toLowerCase();
    // 候補・ポップオーバーを開いている部品（aria-haspopup で開いている）だけ止める（開いた下書きの帯・details などでは止めない）
    const popupOpen = active?.getAttribute?.('aria-expanded') === 'true' && Boolean(active?.getAttribute?.('aria-haspopup'));
    return ['input', 'select', 'textarea'].includes(tag) || Boolean(active?.isContentEditable) || popupOpen;
  };
  // 本文にフォーカスがあるとき（「本文へ戻る」・本文を押した後）の Esc でも、右のドロワーを閉じる（ドロワーの中の Esc は drawer.js が受ける。
  // 解説の板の Esc は先に受けて preventDefault）。文字の入力欄・候補やパネルを開いている間・ダイアログ・ヘッダーにフォーカスがあるときは閉じない
  function escapeDrawer(event) {
    if (!drawer.isOpen() || event.defaultPrevented || event.isComposing || showingLogin) return;
    if (document.querySelector?.('dialog[open]')) return;
    const active = document.activeElement;
    if (active && active !== document.body && !main.contains(active)) return;
    const tag = String(active?.tagName ?? '').toLowerCase();
    if (['input', 'select', 'textarea'].includes(tag) || active?.isContentEditable) return;
    if ([...(document.querySelectorAll?.('[aria-expanded="true"]') ?? [])].some((node) => node.getAttribute?.('aria-haspopup'))) return;
    event.preventDefault();
    drawer.close({ reason: 'dismiss' });
  }
  document.addEventListener?.('keydown', (event) => {
    const key = event.key;
    if (key === 'Escape') { escapeDrawer(event); return; }
    if (key !== 'n' && key !== 'N' && key !== '/') return;
    if (shortcutBlocked(event)) return;
    event.preventDefault();
    if (key === '/') { palSearch.open(); return; }
    const inDrawer = drawer.isOpen() && drawer.element.contains?.(document.activeElement);
    const initial = inDrawer ? drawer.content()?.registerInitial?.() : currentView?.registerInitial?.();
    context.register(initial ?? undefined);
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
    if (conditionWorld) {
      forgetHolders();
      // 別のワールドに替わったら、前のワールドの個体・牧場を出しているドロワーは閉じる
      drawer.close({ reason: 'world' });
    }
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
    // ドロワーを開いた・閉じたエントリどうし（URL もエントリの ID も同じ）は、ドロワーだけを合わせる
    if (booted && !showingLogin) drawer.sync();
    if (!booted || showingLogin || location.hash !== shownHash || entryId() === shownEntry) return;
    intent = null;
    route = parseHash(location.hash);
    render('history');
  });
  store.subscribe((state) => {
    envChip.hidden = state.env !== 'test';
    const userKey = state.userId ? userIdKey(state.userId) : '';
    if (userKey !== memoryUser) {
      // ID が替わったら（名前の変更・別の ID）、前の ID で開いたドロワーは閉じる
      if (memoryUser) drawer.close({ reason: 'user' });
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
  ideals.subscribe(notifications.changed);
  // 理想個体のタブの完成した目標の数（目標・所持パルが変わったとき）
  const renderGoalBadge = () => {
    if (!idealTab) return;
    const worldId = ownedWorldId(owned.state.meta?.worldId);
    const count = worldId ? ideals.list().filter((goal) => goal.worlds[worldId]?.complete).length : 0;
    const text = count ? `完成 ${count}` : '';
    if (goalBadge.textContent !== text) goalBadge.textContent = text;
    goalBadge.hidden = !count;
    const label = count ? `${tabLabel('ideal')}（完成した目標 ${count} 件）` : '';
    if (label) idealTab.setAttribute('aria-label', label);
    else idealTab.removeAttribute('aria-label');
  };
  ideals.subscribe(renderGoalBadge);
  owned.subscribe(renderGoalBadge);
  renderGoalBadge();
  // 設定のタブの整合性の警告の数（記録を取るたび。文字・hidden・aria-label・行き先だけを書き換える）
  let shownWarnings = -1;
  let shownWarningKey = '';
  const renderWarningBadge = () => {
    if (!settingsTab) return;
    const count = warningCount();
    const key = warningKey();
    if (count === shownWarnings && key === shownWarningKey) return;
    shownWarnings = count;
    shownWarningKey = key;
    warningBadge.textContent = count ? String(count > 99 ? '99+' : count) : '';
    warningBadge.hidden = !count;
    if (count) settingsTab.setAttribute('aria-label', `${tabLabel('settings')}（整合性の警告 ${count} 件）`);
    else settingsTab.removeAttribute('aria-label');
    setTabHref('settings', tabHrefs.get('settings') ?? buildHash('settings'));
  };
  store.subscribe(renderWarningBadge);
  renderWarningBadge();
  // 所持パルのタブの「!」
  const renderOwnedBadge = () => {
    if (!ownedTab) return;
    const auto = owned.state.auto;
    const stopped = Boolean(auto?.enabled && ['permission', 'error', 'empty'].includes(auto.status));
    // 隠している間は文字も空（タブの名前の文字に混ざらないように。理想個体のバッジと同じ）
    const text = stopped ? '!' : '';
    if (ownedBadge.textContent !== text) ownedBadge.textContent = text;
    ownedBadge.hidden = !stopped;
    if (stopped) ownedTab.setAttribute('aria-label', `${tabLabel('owned')}（読み込みが止まっています）`);
    else ownedTab.removeAttribute('aria-label');
  };
  owned.subscribe(renderOwnedBadge);
  renderOwnedBadge();
  owned.subscribe(autoRegister.evaluate);
  // 別のタブで下書き・目標（と観測・前のウィッシュリスト）・このワールドでの自分・登録者の対応・既読を書き換えたら読み直す。
  window.addEventListener('storage', (event) => {
    drafts.reload(event.key);
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
  // 所持パルの読み直しは、どの画面でもこの 10 秒ごとの 1 本で行う（画面ごとのタイマーは持たない。share-fetch）。
  // 表のタブなら共有も読み直す（autoRefresh。ホストのセーブは 20 秒以上空ける）。裏のタブでは共有を読まず（D26）、セーブのファイルを
  // 登録していれば読み直す（pollAuto。配合牧場の自動登録で、タマゴを拾う前に読むため）。長く裏にあるタブのタイマーは、ブラウザが
  // 1 分に 1 回まで遅らせる。古いデータの印（時刻で変わる）も、このときに確かめ直す
  setInterval(() => {
    const refreshing = document.visibilityState === 'hidden' ? owned.pollAuto() : owned.autoRefresh();
    refreshing.catch(() => {});
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
