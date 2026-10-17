// 古い版（本番の GAS の版 10 と、今配信している画面。e984786）のコードを、Git の履歴から取り出す。
// 「古い GAS＋新しい画面」「新しい GAS＋古い画面」の組み合わせのテストに使う（docs/sync-fixes/README.md の 3）。
// 履歴のない作業ツリー（浅い複製の CI など）では null を返し、呼び出す側のテストは skip する。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const LEGACY_COMMIT = 'e984786';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function gitShow(commit, file) {
  return execFileSync('git', ['show', `${commit}:${file}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

/** 古い版の gas/*.js（createGas の files）。取り出せなければ null */
export function legacyGasFiles(commit = LEGACY_COMMIT) {
  try {
    const names = execFileSync('git', ['ls-tree', '--name-only', commit, 'gas/'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split(/\r?\n/).filter((name) => name.endsWith('.js')).sort();
    if (!names.length) return null;
    return names.map((file) => ({ name: path.basename(file), code: gitShow(commit, file) }));
  } catch {
    return null;
  }
}

// 古い画面の api.js が読み込むファイル（import の先まで）
const LEGACY_API_FILES = ['web/js/api.js', 'web/js/config.js', 'web/js/core/boundary.js', 'web/js/core/validate.js', 'web/js/core/owned-shared.js'];

/** 古い版の画面の api.js（createApi など）。一時フォルダに書き出して読み込む。取り出せなければ null */
export async function legacyApi(commit = LEGACY_COMMIT) {
  let dir = '';
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pal-legacy-api-'));
    for (const file of LEGACY_API_FILES) {
      const target = path.join(dir, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, gitShow(commit, file), 'utf8');
    }
    return await import(pathToFileURL(path.join(dir, 'web/js/api.js')).href);
  } catch {
    return null;
  } finally {
    // 読み込んだ後のモジュールはメモリにあるので、ファイルは消してよい
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
}
