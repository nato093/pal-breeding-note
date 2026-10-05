// セーブの解凍・解析を画面と別のスレッドで行う（大きいワールドでも画面が固まらないように）。
import { readWorldFiles } from './import.js';

self.addEventListener('message', async (event) => {
  const { id, files } = event.data ?? {};
  try {
    const snapshot = await readWorldFiles(files.map((file) => ({ path: file.path, bytes: new Uint8Array(file.buffer) })), {
      onProgress: (message) => self.postMessage({ id, type: 'progress', message }),
    });
    self.postMessage({ id, type: 'done', snapshot });
  } catch (error) {
    self.postMessage({ id, type: 'error', message: error?.message || 'セーブを読み込めませんでした' });
  }
});
