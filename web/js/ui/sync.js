import { toast } from './toast.js';

// 画面は先に更新済み。サーバに断られたら store が元に戻すので、知らせて最新を取り直す。
// notice は先に出した成功の知らせを消す関数で、失敗したら成功と失敗が並ばないように消す。
export async function syncInBackground(store, pending, { notice, failure, retry, done } = {}) {
  let response;
  try { response = await pending; } catch (error) {
    notice?.();
    // ログアウト時はログイン画面で、取り消しは元の操作の失敗で知らせている。
    if (!store.state.passcode || error.code === 'CANCELED') return;
    toast(`${failure}。${error.message}`, retry ? { action: () => retry(error), actionLabel: '入力し直す' } : {});
    try { await store.refresh(); } catch { /* 取得の失敗は同期状態に表示される。 */ }
    return;
  }
  done?.(response);
}
