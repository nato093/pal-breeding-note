// ブラウザの FileSystemFileHandle の形で、Node のファイルを読む（画面と同じ web/js/save/handles.js・watch.js に渡すため）。
// stat と読み込みだけ。読むたびに開いて閉じ、ハンドルを開いたままにしない（ServerSync のバックアップ・同期・削除を止めない。
// Chrome の Observer が Players を押さえて SaveSync を止めた事故の形にしない）。Node は Windows で読み・書き・削除を共有して開くので、
// 読んでいる間もサーバーの保存（置き換え）を妨げない。
// 失敗は handles.js が見る DOMException の名前に変える。消えた → NotFoundError（必須でなければ飛ばす）、
// 置き換えの途中・削除待ち（EBUSY・EPERM・EACCES）→ NotReadableError（NotAllowedError にすると「許可待ち」で止まるため）。
import fsPromises from 'node:fs/promises';
import path from 'node:path';

const NOT_FOUND = new Set(['ENOENT', 'ENOTDIR', 'EISDIR']);
const NOT_READABLE = new Set(['EBUSY', 'EPERM', 'EACCES']);

/**
 * Node の失敗を DOMException の名前の失敗に変える。文にパスを入れない（ログ・画面の状態に出さないため）。
 * @returns {Error} name が NotFoundError・NotReadableError・Error のどれか。nodeCode に元の code を残す
 *   （DOMException の code は読み取り専用の数なので、別の名前にする）
 */
export function domErrorOf(error) {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(error.code) ? error.code : '';
  const withCode = (failure) => Object.defineProperty(failure, 'nodeCode', { value: code, enumerable: true });
  if (NOT_FOUND.has(code)) return withCode(new DOMException('ファイルが見つかりません', 'NotFoundError'));
  if (NOT_READABLE.has(code)) return withCode(new DOMException(`ファイルを読めません（${code}）`, 'NotReadableError'));
  return withCode(new Error(`ファイルを読めませんでした（${code || 'ERROR'}）`));
}

const changed = (stats, snapshot) => Math.trunc(stats.mtimeMs) !== snapshot.lastModified || stats.size !== snapshot.size;
const changedError = () => new DOMException('読んでいる間にファイルが変わりました', 'NotReadableError');

/**
 * FileSystemFileHandle の形のハンドル（kind・name・queryPermission・requestPermission・getFile）。
 * getFile() は stat の写し（lastModified・size）と arrayBuffer() を返す。arrayBuffer() は開いて、写しと同じファイルか確かめてから読み、
 * 読んだ後にも確かめて閉じる（違えば NotReadableError。ブラウザの File と同じ振る舞い）。fs は差し替えられる（テスト）。
 */
export function fileHandle(absPath, { fs = fsPromises } = {}) {
  return {
    kind: 'file',
    name: path.basename(absPath),
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
    async getFile() {
      let stats;
      try { stats = await fs.stat(absPath); } catch (error) { throw domErrorOf(error); }
      if (!stats.isFile()) throw domErrorOf({ code: 'EISDIR' });
      const snapshot = { lastModified: Math.trunc(stats.mtimeMs), size: stats.size };
      return {
        name: path.basename(absPath), type: '', ...snapshot,
        async arrayBuffer() {
          let handle;
          try {
            handle = await fs.open(absPath, 'r');
            if (changed(await handle.stat(), snapshot)) throw changedError();
            const bytes = await handle.readFile();
            if (changed(await handle.stat(), snapshot)) throw changedError();
            // 大きなファイルは専用の領域に読まれるので写さずに返す（小さなものは共有の領域の一部なので写す）
            const whole = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;
            return whole ? bytes.buffer : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          } catch (error) {
            throw error instanceof DOMException ? error : domErrorOf(error);
          } finally {
            await handle?.close().catch(() => {});
          }
        },
      };
    },
  };
}

/** listWorldFiles（discover.mjs）の { 相対パス: 絶対パス } を、handles.js に渡す { 相対パス: ハンドル } にする */
export function fileHandles(files, options) {
  return Object.fromEntries(Object.entries(files).map(([rel, abs]) => [rel, fileHandle(abs, options)]));
}
