// 常駐のセーブの見張り（docs/server/README.md の T5）。画面の Worker の中で動く createSaveWatcher（web/js/save/watch.js）を、Observer なしで
// このプロセスの中で動かし、画面の createWatchClient と同じ形（update(targets)・stop()）を返す（createOwnedStore の watch に渡す）。
// Observer がないので、見張りは 5 秒ごとの getFile()（fs-handles.mjs の stat）だけになる（mode は 'poll'）。フォルダもファイルも開いたままに
// しないので、ServerSync のバックアップ・同期・削除を止めない（Chrome の Observer が Players を押さえて SaveSync を止めた事故の形にしない）。
import { createSaveWatcher } from '../../web/js/save/watch.js';

/**
 * @param {{ onSettled?: (message: object) => void, onMode?: (mode: string) => void, setTimer?: Function, clearTimer?: Function,
 *   every?: Function, stopEvery?: Function, pollMs?: number, quietMs?: number, maxWaitMs?: number }} options
 *   タイマーと間隔は createSaveWatcher にそのまま渡す（テストは仮の時計）
 * @returns {{ update: (targets: object[]) => void, stop: () => void }}
 */
export function createLocalWatchClient({ onSettled = () => {}, onMode = () => {}, ...options } = {}) {
  let generation = 0;
  // 世代の違う知らせ（前の対象の見張りの残り）は捨てる（画面の createWatchClient と同じ）
  const watcher = createSaveWatcher({
    ...options,
    Observer: null,
    post: (message) => {
      if (!message || message.generation !== generation) return;
      if (message.type === 'settled') onSettled(message);
      else if (message.type === 'mode') onMode(message.mode);
    },
  });

  const client = {
    update(targets = []) {
      generation++;
      if (!Array.isArray(targets) || !targets.length) {
        watcher.stop();
        return;
      }
      watcher.watch({ generation, targets }).catch(() => {});
    },
    stop() {
      client.update([]);
    },
  };
  return client;
}
