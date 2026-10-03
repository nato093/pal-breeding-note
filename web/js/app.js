import { createApi } from './api.js';
import { createStore, safeStorage } from './store.js';
import { startRouter, extractInvitation, buildHash } from './router.js';
import { el, button, link, field, formatTime, runButton } from './ui/dom.js';
import { toast } from './ui/toast.js';
import { confirmDialog, closeDialogs } from './ui/dialog.js';
import { breedingCard } from './ui/breeding-card.js';
import { openRecordEditor } from './ui/record-editor.js';
import { searchView } from './views/search.js';
import { reverseView } from './views/reverse.js';
import { inheritanceView } from './views/route.js';
import { listView } from './views/list.js';
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
  let storage;
  try { storage = safeStorage(window.localStorage); } catch { storage = safeStorage(null); }
  const store = createStore({ api: createApi({ transport }), storage, namespace: localDevelopment ? 'pal-note.local' : 'pal-note' });
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
  header.append(brand, status);
  const nav = el('nav', 'navigation');
  nav.setAttribute('aria-label', 'メインナビゲーション');
  const tabs = [['search', '配合検索', '⌕'], ['reverse', '逆引き', '↶'], ['route', '継承ルート', '⌁'], ['list', '一覧', '▤'], ['settings', '設定', '⚙']];
  const tabLinks = new Map();
  for (const [view, label, symbol] of tabs) {
    const tab = link('', buildHash(view), 'nav-tab');
    tab.append(el('span', 'tab-symbol', symbol), el('span', '', label));
    nav.append(tab);
    tabLinks.set(view, tab);
  }
  const main = el('main', 'app-main');
  main.id = 'main';
  const skip = link('メイン画面へ', '#main', 'skip-link');
  skip.addEventListener('click', (event) => { event.preventDefault(); main.tabIndex = -1; main.focus(); });
  const footer = el('footer', 'app-footer');
  footer.append(el('span', '', '登録された配合だけを検索します。'), link('出典と権利表記', 'credits.html'));
  const register = button('＋ 登録', () => {
    if (!store.state.passcode) { toast('先にパスコードを入力してください'); return; }
    context.register();
  }, 'register-button');
  register.setAttribute('aria-label', '配合を登録');
  root.append(skip, banner, header, nav, main, footer, register);
  let route;
  let currentView;
  let showingLogin = false;

  async function mutation(action, input) {
    try { return await store.mutate(action, input); } catch (error) {
      if (error.code === 'CONFLICT') {
        const latest = error.response.latest;
        const preview = el('div', 'card-stack');
        for (const record of latest?.id ? [latest] : Object.values(latest ?? {})) {
          if (record?.id) preview.append(breedingCard(record, {}, { preview: true }));
        }
        await confirmDialog('他の人が先に更新しました', '最新の内容を読み込みます。確認してからもう一度操作してください。', { preview, confirmText: '最新に更新' });
        await store.refresh();
      }
      throw error;
    }
  }

  const context = {
    store,
    navigate(hash) { location.hash = hash; },
    replace(hash) { history.replaceState(null, '', `${location.pathname}${location.search}${hash}`); },
    register(initial) { return openRecordEditor(context, initial); },
    async confirm(record) {
      const result = await mutation('confirm', { id: record.id });
      toast('確認を追加しました');
      return result;
    },
    async merge(source, target, { ask = true } = {}) {
      if (ask) {
        const preview = el('div', 'card-stack');
        preview.append(breedingCard(source, {}, { preview: true }), breedingCard(target, {}, { preview: true }));
        if (!await confirmDialog('登録を統合しますか？', '確認回数を既存の登録にまとめ、元の登録を削除します。', { preview, confirmText: '統合' })) return;
      }
      const result = await mutation('merge', { sourceId: source.id, targetId: target.id, expectedEtags: { source: source.etag, target: target.etag } });
      toast('既存の登録に統合しました');
      return result;
    },
    async remove(record) {
      if (!await confirmDialog('この配合を削除しますか？', '削除後、5 秒間は元に戻せます。', {
        preview: breedingCard(record, {}, { preview: true }), confirmText: '削除', danger: true,
      })) return;
      const result = await mutation('delete', { id: record.id, expectedEtag: record.etag });
      toast('削除しました', { duration: 5000, action: async () => {
        const restored = await mutation('restore', { id: result.record.id, expectedEtag: result.record.etag });
        toast(restored.mergedInto ? '既存の登録に統合しました' : '元に戻しました');
      } });
    },
  };

  const views = { search: searchView, reverse: reverseView, route: inheritanceView, list: listView, pal: palView, settings: settingsView };

  function loginView() {
    const panel = el('section', 'login-panel');
    panel.append(el('span', 'login-mark', '◇'), el('p', 'eyebrow', '仲間とつくる、配合の記録'),
      el('h1', '', '冒険の発見を、\nみんなのノートに。'), el('p', 'muted', '招待リンクを開くか、仲間から受け取ったパスコードを入力してください。'));
    const form = el('form', 'login-form');
    const input = el('input');
    input.type = 'password';
    input.autocomplete = 'current-password';
    input.required = true;
    const errors = el('p', 'form-errors');
    errors.setAttribute('role', 'alert');
    errors.textContent = store.state.error;
    const submit = button('ノートを開く', () => form.requestSubmit(), 'button primary');
    form.append(field('パスコード', input), errors, submit);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!input.value.trim()) return;
      await runButton(submit, async () => { store.setPasscode(input.value); await store.refresh(); }, (error) => toast(error.message));
    });
    panel.append(form, el('p', 'login-note', 'このノートに載るのは、仲間が登録した配合だけ。'));
    main.replaceChildren(panel);
  }

  function render() {
    currentView?.destroy();
    currentView = null;
    showingLogin = !store.state.passcode;
    nav.hidden = showingLogin;
    if (showingLogin) { loginView(); return; }
    for (const [view, tab] of tabLinks) {
      const active = route.view === view;
      tab.classList.toggle('active', active);
      if (active) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
    currentView = views[route.view](context, route);
    main.replaceChildren(currentView.element);
  }

  function consumeInvitation() {
    const invitation = extractInvitation(location.hash);
    if (invitation.passcode !== null) {
      store.setPasscode(invitation.passcode);
      context.replace(invitation.hash);
      return true;
    }
    return false;
  }

  consumeInvitation();
  startRouter((nextRoute) => {
    const invited = consumeInvitation();
    nextRoute.params.delete('k');
    route = nextRoute;
    render();
    if (invited && store.state.passcode) refresh();
  });
  store.subscribe((state) => {
    banner.hidden = state.env !== 'test';
    status.textContent = state.loading ? '記録を更新中…' : state.error || (state.serverTime
      ? `${state.cached ? '前回取得' : '最新取得'} ${formatTime(state.serverTime)}${state.cached ? ' 時点' : ''} · ${state.records.length} 件` : '仲間だけの配合ノート');
    if (showingLogin !== !state.passcode) {
      if (!state.passcode) closeDialogs();
      render();
    }
  });
  async function refresh(options) {
    try { await store.refresh(options); } catch (error) { toast(error.message); }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh({ throttled: true });
  });
  await refresh();
}

try { await boot(); } catch {
  document.getElementById('app').replaceChildren(el('p', 'startup-error', '画面を読み込めませんでした。ページを再読み込みしてください。'));
}
