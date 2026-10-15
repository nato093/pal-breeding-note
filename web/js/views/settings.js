import { el, button, link, formatTime, runButton } from '../ui/dom.js';
import { palsById } from '../ui/pal-icon.js';
import { toast } from '../ui/toast.js';
import { openRenameDialog, confirmLogout } from '../ui/account-actions.js';
import { toCsv } from '../core/csv.js';
import { identityKey } from '../core/pair.js';
import { ownedWorldId } from '../core/owned-shared.js';
import { buildHash, parseHash, SETTINGS_OPEN } from '../router.js';
import { viewHeading, watchView } from './shared.js';
import { tabLabel } from './tabs.js';
import { ownedSettingsCard } from './owned-settings.js';

const warningMessages = {
  DUPLICATE_RECORD: '同じ配合が重複して登録されています。', DUPLICATE_ID: '登録の識別情報が重複しています。',
  UNKNOWN_PAL: 'マスターにないパルが含まれています。', BAD_COUNT: '確認回数が正しくありません。',
};

function exportCsv(records) {
  const columns = ['ID', '親1 ID', '親1 名前', '親2 ID', '親2 名前', '子 ID', '子 名前', '親1 性別', '親2 性別', '登録者', 'メモ', '確認回数', '登録日時', '更新日時'];
  const rows = records.map((record) => [record.id, record.parent1Id, palsById.get(record.parent1Id)?.ja ?? '',
    record.parent2Id, palsById.get(record.parent2Id)?.ja ?? '', record.childId, palsById.get(record.childId)?.ja ?? '',
    record.parent1Gender, record.parent2Gender, record.registrant, record.memo, record.confirmCount, record.createdAt, record.updatedAt]);
  const url = URL.createObjectURL(new Blob([toCsv(rows, columns)], { type: 'text/csv;charset=utf-8' }));
  const anchor = link('', url);
  const now = new Date();
  const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('');
  anchor.download = `pal-breedings-${date}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function settingsView(context, route = parseHash('#/settings')) {
  const { store } = context;
  const element = el('section', 'view settings-view');
  element.append(viewHeading(tabLabel('settings')));
  const connection = el('section', 'settings-card');
  const env = el('p', 'environment-label');
  const time = el('p', 'muted');
  const refresh = button('最新に更新', async () => {
    await runButton(refresh, async () => { await store.refresh(); toast('最新の記録に更新しました'); }, (error) => toast(error.message, { kind: 'error' }));
  }, 'button secondary');
  connection.append(el('h2', '', 'データの状態'), env, time, refresh);
  const access = el('section', 'settings-card');
  const accountId = el('p');
  const renameNote = el('p', 'muted');
  const rename = button('ID を変更', () => openRenameDialog(context), 'button secondary');
  // 途中で止まった ID の変更は、同じ内容でやり直す（別の ID への変更と混ざらないように）
  const retry = button('ID の変更を再試行', async () => {
    await runButton(retry, async () => {
      const userId = await context.renamer.retry();
      toast(`ID を「${userId}」に変更しました`);
    }, (error) => toast(error.message, { kind: 'error' }));
  }, 'button primary');
  const logout = button('ログアウト', () => confirmLogout(store), 'button quiet danger-text');
  const accountActions = el('div', 'settings-actions');
  if (context.renamer) accountActions.append(rename, retry);
  accountActions.append(logout);
  access.append(el('h2', '', 'アカウント'), accountId, ...(context.renamer ? [renameNote] : []), accountActions);
  const backup = el('section', 'settings-card');
  backup.append(el('h2', '', '記録を書き出す'), el('p', 'muted', '有効な登録全件を、パルの名前付き CSV に保存します。'),
    button('CSV エクスポート', () => exportCsv(store.state.records), 'button secondary'));
  const warnings = el('section', 'settings-card');
  const warningList = el('div', 'warning-list');
  warnings.append(el('h2', '', '整合性の警告'), warningList);
  // 所持パルのセーブ連携（所持パルの画面がない環境・テストでは出さない）
  const ownedCard = context.owned ? ownedSettingsCard(context) : null;
  // 通知の履歴はベルの「すべての通知を見る」から開く（bell で「通知」カードをなくした）
  element.append(connection, ...(ownedCard ? [ownedCard.element] : []), backup, warnings, access);
  // アカウントは、配合の一覧が変わらない操作（名前の変更の完了・再試行）でも変わるので、store が変わるたびに描き直す
  function renderAccount(state) {
    accountId.textContent = `ログイン中の ID: ${state.userId}`;
    const pending = context.renamer?.pending();
    renameNote.textContent = pending ? `「${pending.oldId}」から「${pending.newId}」への ID の変更が終わっていません。再試行してください。`
      : 'ID を変えると、これまでの配合の登録者名もすべて新しい ID になります。';
    rename.hidden = Boolean(pending);
    retry.hidden = !pending;
    // 名前の変更中は、ログアウトや別の変更をさせない
    rename.disabled = state.renaming;
    logout.disabled = state.renaming;
  }
  // 整合性の警告と前回取得の時刻は、記録が同じでも変わる（記録の変更番号が増えない）ので、それらが変わったときも描き直す
  const dataKey = (state) => JSON.stringify([state.warnings, state.serverTime, state.cached, state.env]);
  let shownData = '';
  const unsubscribeAccount = store.subscribe((state) => {
    renderAccount(state);
    if (dataKey(state) !== shownData) renderData(state);
  });
  renderAccount(store.state);
  function renderData(state) {
    shownData = dataKey(state);
    env.textContent = `環境: ${state.env === 'test' ? 'テスト' : state.env === 'prod' ? '本番' : '確認中'}`;
    time.textContent = `前回取得: ${formatTime(state.serverTime, true)}${state.cached ? '（キャッシュ）' : ''}`;
    warningList.replaceChildren();
    if (!state.warnings.length) warningList.append(el('p', 'muted', state.env ? '警告はありません。' : '読み込み中…'));
    for (const warning of state.warnings) {
      const row = el('div', 'integrity-warning');
      row.append(el('p', '', `${warning.rowNumber ? `${warning.rowNumber} 行目: ` : ''}${warningMessages[warning.code] ?? '保存先の内容を管理者に確認してください。'}`));
      if (warning.code === 'DUPLICATE_RECORD') {
        const source = state.records.find((record) => record.id === warning.id);
        const target = source && state.records.find((record) => record.id !== source.id && identityKey(record) === identityKey(source));
        if (target) {
          const merge = button('統合', async () => {
            await runButton(merge, () => context.merge(source, target), (error) => toast(error.message, { kind: 'error' }));
          }, 'button secondary');
          row.append(merge);
        }
      }
      warningList.append(row);
    }
  }
  const view = watchView(store, element, renderData);
  // 設定の行き先（`#/settings?world=<ID>&open=<意図>`。router.js の settingsHash・SETTINGS_OPEN）: セーブ連携の、意図の所
  //（このワールドでの自分・そのワールドの未設定の登録者・状態の欄の操作。前の版の auto は前の決め方）へフォーカスする。
  // 作るときと、同じ画面のまま URL が変わったとき（設定を開いたまま通知を押したなど）に読む。
  // 読んだら URL から world・open を外す（戻る・進む・読み込み直しで、もう一度開いてフォーカスを動かさない）
  function applyRoute(next) {
    const open = next?.params?.get('open');
    if (!SETTINGS_OPEN.includes(open)) return;
    ownedCard?.reveal({ worldId: ownedWorldId(next.params.get('world')), open });
    context.replace?.(buildHash('settings'));
  }
  applyRoute(route);
  return { element, applyRoute, destroy() { view.destroy(); unsubscribeAccount(); ownedCard?.destroy(); } };
}
