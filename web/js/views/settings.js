import { el, button, link, formatTime, runButton } from '../ui/dom.js';
import { palsById } from '../ui/pal-icon.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/dialog.js';
import { toCsv } from '../core/csv.js';
import { identityKey } from '../core/pair.js';
import { viewHeading, watchView } from './shared.js';

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

export function settingsView(context) {
  const { store } = context;
  const element = el('section', 'view settings-view');
  element.append(viewHeading('ノートの設定'));
  const connection = el('section', 'settings-card');
  const env = el('p', 'environment-label');
  const time = el('p', 'muted');
  const refresh = button('最新に更新', async () => {
    await runButton(refresh, async () => { await store.refresh(); toast('最新の記録に更新しました'); }, (error) => toast(error.message));
  }, 'button secondary');
  connection.append(el('h2', '', 'データの状態'), env, time, refresh);
  const access = el('section', 'settings-card');
  const accountId = el('p');
  access.append(el('h2', '', 'アカウント'), accountId,
    button('ログアウト', async () => {
      if (await confirmDialog('ログアウトしますか？', 'この端末のパスワードと配合キャッシュを消去します。次回は ID と共通パスワードでログインしてください。',
        { confirmText: 'ログアウト', danger: true })) store.logout();
    }, 'button quiet danger-text'));
  const backup = el('section', 'settings-card');
  backup.append(el('h2', '', '記録を書き出す'), el('p', 'muted', '有効な登録全件を、パルの名前付き CSV に保存します。'),
    button('CSV エクスポート', () => exportCsv(store.state.records), 'button secondary'));
  const warnings = el('section', 'settings-card');
  const warningList = el('div', 'warning-list');
  warnings.append(el('h2', '', '整合性の警告'), warningList);
  element.append(connection, backup, warnings, access);
  return watchView(store, element, (state) => {
    accountId.textContent = `ログイン中の ID: ${state.userId}`;
    env.textContent = `環境: ${state.env === 'test' ? 'テスト' : state.env === 'prod' ? '本番' : '確認中'}`;
    time.textContent = `前回取得: ${formatTime(state.serverTime, true)}${state.cached ? '（キャッシュ）' : ''}`;
    warningList.replaceChildren();
    if (!state.warnings.length) warningList.append(el('p', 'muted', state.env ? '警告はありません。' : '取得後に表示します。'));
    for (const warning of state.warnings) {
      const row = el('div', 'integrity-warning');
      row.append(el('p', '', `${warning.rowNumber ? `${warning.rowNumber} 行目: ` : ''}${warningMessages[warning.code] ?? '保存先の内容を管理者に確認してください。'}`));
      if (warning.code === 'DUPLICATE_RECORD') {
        const source = state.records.find((record) => record.id === warning.id);
        const target = source && state.records.find((record) => record.id !== source.id && identityKey(record) === identityKey(source));
        if (target) {
          const merge = button('統合', async () => {
            await runButton(merge, () => context.merge(source, target), (error) => toast(error.message));
          }, 'button secondary');
          row.append(merge);
        }
      }
      warningList.append(row);
    }
  });
}
