// アカウントの操作（名前の変更・ログアウト）。設定タブとヘッダーの ID のメニューで使う。
import { el, button, field, runButton } from './dom.js';
import { toast } from './toast.js';
import { confirmDialog, openDialog } from './dialog.js';

const renameErrors = {
  REQUIRED: '名前を入力してください。', TOO_LONG: '名前は20文字以内で入力してください。', SAME_ID: '今と同じ名前です。',
};

export function openRenameDialog({ store, renamer }) {
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

/** ログアウトの確認。承認したらログアウトして true を返す。 */
export async function confirmLogout(store) {
  if (!await confirmDialog('ログアウトしますか？', 'この端末のパスワードと配合キャッシュを消去します。次回は ID と共通パスワードでログインしてください。',
    { confirmText: 'ログアウト', danger: true })) return false;
  store.logout();
  return true;
}
