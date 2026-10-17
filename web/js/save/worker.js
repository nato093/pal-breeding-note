// セーブの解凍・解析を画面と別のスレッドで行う（大きいワールドでも画面が固まらないように）。
// type: 'watch'・'stop' はセーブのファイルの見張り（save/watch.js。sync-fixes の save-watch）。見張りの Worker は解析の Worker と別に作る
// （save/watch.js の createWatchClient。owned.js が作る）。画面のタイマーは裏のタブで 1 分ごとまで遅れるが、Worker の中は裏でも遅れない（P0）
import { readWorldFiles } from './import.js';
import { createSaveWatcher } from './watch.js';

let watcher = null;

self.addEventListener('message', async (event) => {
  const data = event.data ?? {};
  if (data.type === 'stop') {
    watcher?.stop();
    return;
  }
  if (data.type === 'watch') {
    watcher ??= createSaveWatcher({ Observer: self.FileSystemObserver ?? null, post: (message) => self.postMessage(message) });
    watcher.watch({ generation: data.generation, targets: data.targets }).catch(() => {});
    return;
  }
  const { id, files } = data;
  try {
    const snapshot = await readWorldFiles(files.map((file) => ({ path: file.path, bytes: new Uint8Array(file.buffer) })), {
      onProgress: (message) => self.postMessage({ id, type: 'progress', message }),
    });
    self.postMessage({ id, type: 'done', snapshot });
  } catch (error) {
    self.postMessage({ id, type: 'error', message: error?.message || 'セーブを読み込めませんでした' });
  }
});
