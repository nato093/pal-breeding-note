// 古い版のコードを、Git の履歴から取り出す。「古い GAS＋新しい画面」「新しい GAS＋古い画面」の組み合わせのテストに使う
//（docs/sync-fixes/README.md の 3・docs/server/README.md の T2）。
// - LEGACY_COMMIT（e984786）: GAS の版 10 と、そのときの画面（sync-fixes の前）
// - LEGACY_V12_COMMIT（c1a29e7）: GAS の版 12 と、そのときの画面（sync-fixes の後・server の前。今の本番）
// 取り出せないとき（履歴のない浅い複製など）は、手元では null を返し、呼び出す側のテストは skip する。
// CI（環境変数 CI が真。GitHub Actions は CI=true を置く）では例外にして、互換テストを黙って飛ばさずに失敗させる
//（.github/workflows/pages.yml の checkout は fetch-depth: 0 で全部の履歴を取る。docs/server/README.md の T6 の 1）。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const LEGACY_COMMIT = 'e984786';
export const LEGACY_V12_COMMIT = 'c1a29e7';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** CI で動いているか（環境変数 CI が空・'0'・'false' 以外） */
export function runningInCi(env = process.env) {
  const value = String(env.CI ?? '').trim().toLowerCase();
  return value !== '' && value !== '0' && value !== 'false';
}

// 取り出せなかったとき。CI では例外（テストのファイルごと失敗にする）、手元では null（呼び出す側が skip する）
function missing(commit, ci) {
  if (ci) {
    throw new Error(`古い版 ${commit} を Git の履歴から取り出せません。CI では互換テストを飛ばさずに失敗にします`
      + '（.github/workflows/pages.yml の actions/checkout に fetch-depth: 0 が要ります）');
  }
  return null;
}

function gitShow(commit, file) {
  return execFileSync('git', ['show', `${commit}:${file}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

/** 古い版の gas/*.js（createGas の files）。取り出せなければ null（CI では例外） */
export function legacyGasFiles(commit = LEGACY_COMMIT, { ci = runningInCi() } = {}) {
  let files = null;
  try {
    const names = execFileSync('git', ['ls-tree', '--name-only', commit, 'gas/'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split(/\r?\n/).filter((name) => name.endsWith('.js')).sort();
    if (names.length) files = names.map((file) => ({ name: path.basename(file), code: gitShow(commit, file) }));
  } catch {
    files = null;
  }
  return files ?? missing(commit, ci);
}

// 古い画面の api.js が読み込むファイル（import の先まで）
const LEGACY_API_FILES = ['web/js/api.js', 'web/js/config.js', 'web/js/core/boundary.js', 'web/js/core/validate.js', 'web/js/core/owned-shared.js'];

/** 古い版の画面の api.js（createApi など）。一時フォルダに書き出して読み込む。取り出せなければ null（CI では例外） */
export async function legacyApi(commit = LEGACY_COMMIT, { ci = runningInCi() } = {}) {
  let dir = '';
  let module = null;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pal-legacy-api-'));
    for (const file of LEGACY_API_FILES) {
      const target = path.join(dir, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, gitShow(commit, file), 'utf8');
    }
    module = await import(pathToFileURL(path.join(dir, 'web/js/api.js')).href);
  } catch {
    module = null;
  } finally {
    // 読み込んだ後のモジュールはメモリにあるので、ファイルは消してよい
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
  return module ?? missing(commit, ci);
}
