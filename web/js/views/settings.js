import { el, button, link, field, formatTime, runButton } from '../ui/dom.js';
import { palsById } from '../ui/pal-icon.js';
import { toast } from '../ui/toast.js';
import { confirmDialog, openDialog } from '../ui/dialog.js';
import { openNotificationList } from '../ui/notifications.js';
import { toCsv } from '../core/csv.js';
import { identityKey } from '../core/pair.js';
import { viewHeading, watchView } from './shared.js';
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

const renameErrors = {
  REQUIRED: '名前を入力してください。', TOO_LONG: '名前は20文字以内で入力してください。', SAME_ID: '今と同じ名前です。',
};

function openRenameDialog({ store, renamer }) {
  const modal = openDialog('名前を変更', { closeOnBackdrop: false });
  const form = el('form', 'rename-form');
  const input = el('input');
  input.autocomplete = 'username';
  input.required = true;
  input.value = store.state.userId;
  const errors = el('p', 'form-errors');
  errors.setAttribute('role', 'alert');
  form.append(field('新しい名前（1〜20文字）', input),
    el('p', 'muted', 'これまでの配合の登録者名も、すべて新しい名前に変わります。ほかの端末では、新しい名前で入り直してください。'), errors);
  const submit = button('変更する', () => form.requestSubmit(), 'button primary');
  modal.body.append(form);
  modal.footer.append(button('キャンセル', modal.close, 'button secondary'), submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await runButton(submit, async () => {
      const userId = await renamer.rename(input.value);
      modal.close();
      toast(`名前を「${userId}」に変更しました`);
    }, (error) => {
      const invalid = error.response?.errors?.find((item) => ['userId', 'newUserId'].includes(item.field));
      errors.textContent = invalid ? renameErrors[invalid.code] ?? error.message
        : error.code === 'USER_EXISTS' ? 'この名前はすでに使われています。別の名前を入力してください。' : error.message;
    });
  });
  input.focus();
  input.select?.();
  return modal;
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
  const renameNote = el('p', 'muted');
  const rename = button('名前を変更', () => openRenameDialog(context), 'button secondary');
  // 途中で止まった名前の変更は、同じ内容でやり直す（別の名前への変更と混ざらないように）
  const retry = button('名前の変更を再試行', async () => {
    await runButton(retry, async () => {
      const userId = await context.renamer.retry();
      toast(`名前を「${userId}」に変更しました`);
    }, (error) => toast(error.message));
  }, 'button primary');
  const logout = button('ログアウト', async () => {
    if (await confirmDialog('ログアウトしますか？', 'この端末のパスワードと配合キャッシュを消去します。次回は ID と共通パスワードでログインしてください。',
      { confirmText: 'ログアウト', danger: true })) store.logout();
  }, 'button quiet danger-text');
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
  const notices = el('section', 'settings-card');
  notices.append(el('h2', '', '通知'), el('p', 'muted', '既読になったものも含めて、これまでの通知を確認できます。'),
    button('通知一覧', () => openNotificationList(context.notifications), 'button secondary'));
  // 所持パルのセーブ連携（所持パルの画面がない環境・テストでは出さない）
  const ownedCard = context.owned ? ownedSettingsCard(context) : null;
  element.append(connection, ...(ownedCard ? [ownedCard.element] : []), backup, warnings, notices, access);
  // アカウントは、配合の一覧が変わらない操作（名前の変更の完了・再試行）でも変わるので、store が変わるたびに描き直す
  function renderAccount(state) {
    accountId.textContent = `ログイン中の ID: ${state.userId}`;
    const pending = context.renamer?.pending();
    renameNote.textContent = pending ? `「${pending.oldId}」から「${pending.newId}」への名前の変更が終わっていません。再試行してください。`
      : '名前を変えると、これまでの配合の登録者名もすべて新しい名前になります。';
    rename.hidden = Boolean(pending);
    retry.hidden = !pending;
    // 名前の変更中は、ログアウトや別の変更をさせない
    rename.disabled = state.renaming;
    logout.disabled = state.renaming;
  }
  const unsubscribeAccount = store.subscribe(renderAccount);
  renderAccount(store.state);
  const view = watchView(store, element, (state) => {
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
  return { element, destroy() { view.destroy(); unsubscribeAccount(); ownedCard?.destroy(); } };
}
