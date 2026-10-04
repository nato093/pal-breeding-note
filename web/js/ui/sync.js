import { toast } from './toast.js';

// 画面は先に更新済み。成功の知らせは done でサーバの応答を受けてから出す（下書きの登録と同じ）。
// サーバに断られたら store が元に戻すので、知らせて最新を取り直す。
export async function syncInBackground(store, pending, { failure, retry, done } = {}) {
  let response;
  try { response = await pending; } catch (error) {
    // ログアウト時はログイン画面で、取り消しは元の操作の失敗で知らせている。
    if (!store.state.passcode || error.code === 'CANCELED') return;
    toast(`${failure}。${error.message}`, retry ? { action: () => retry(error), actionLabel: '入力し直す' } : {});
    try { await store.refresh(); } catch { /* 取得の失敗は同期状態に表示される。 */ }
    return;
  }
  done?.(response);
}
