// 配信する web/ を書き換え、開いているページが新しい版に気づけるようにする（GitHub Actions で配信の直前に実行する）。
// - 相対参照の .js / .css に ?v=<版> を付ける。読み込み直したとき、キャッシュに残った古いファイルを使わせないため
// - index.html などに版を埋め込み、version.json に版と更新内容の一覧を書き出す（ページが定期的に読みに来る）
// リポジトリの web/ を書き換えないよう、ローカルではコピーに対して実行する: node scripts/build-release.mjs <ディレクトリ>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const VERSION_PATTERN = /^[0-9a-f]{7,40}$/;
const NOTES_MAX = 20;

// 文字列リテラルで書いた相対 .js の指定子（import・export・副作用の import・動的 import・new URL(…, import.meta.url)）
const JS_SPECIFIER = /(\bfrom\s*|\bimport\s*\(?\s*|\bnew\s+URL\s*\(\s*)(['"])(\.\.?\/[^'"?#]+\.js)\2/g;
// HTML の相対参照の .js / .css
const HTML_REFERENCE = /(\b(?:src|href)=)(["'])(?![a-z]+:|\/|#)([^"'?#]+\.(?:js|css))\2/g;
// 書き換え漏れの検査用。上の形に当てはまらない書き方でも、?v の無い相対 .js の文字列が残っていたら止める
const UNVERSIONED_JS = /(['"`])\.\.?\/[^'"`?#\s]+\.js\1/;
const UNVERSIONED_HTML = /\b(?:src|href)=(["'])(?![a-z]+:|\/|#)[^"'?#]+\.(?:js|css)\1/;

function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(file) : [file];
  });
}

function currentVersion() {
  const version = process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  return version.toLowerCase();
}

export function versionScript(source, version) {
  return source.replace(JS_SPECIFIER, (_, prefix, quote, specifier) => `${prefix}${quote}${specifier}?v=${version}${quote}`);
}

export function versionHtml(source, version) {
  const referenced = source.replace(HTML_REFERENCE, (_, prefix, quote, reference) => `${prefix}${quote}${reference}?v=${version}${quote}`);
  return referenced.replace('<head>', `<head>\n  <meta name="app-version" content="${version}">`);
}

export async function buildRelease(directory, version = currentVersion()) {
  if (!VERSION_PATTERN.test(version)) throw new Error(`版の形式が不正です: ${version}`);
  const files = filesIn(directory);
  const sources = files.filter((file) => /\.(js|html)$/.test(file));
  // 二重に付けると参照が壊れるため、書き換え済みのものは受け付けない（毎回、書き換え前のコピーから作る）
  for (const file of sources) {
    const built = file.endsWith('.html') ? /<meta name="app-version"/ : /\.js\?v=[0-9a-f]/;
    if (built.test(fs.readFileSync(file, 'utf8'))) throw new Error(`書き換え済みです: ${file}`);
  }
  // 全部を確かめてから書き込む（途中で止まっても、書きかけの配信物を残さない）
  const rewritten = sources.map((file) => {
    const source = fs.readFileSync(file, 'utf8');
    const next = file.endsWith('.html') ? versionHtml(source, version) : versionScript(source, version);
    const left = file.endsWith('.html') ? UNVERSIONED_HTML.exec(next) : UNVERSIONED_JS.exec(next);
    if (left) throw new Error(`?v を付けられなかった参照があります: ${path.relative(directory, file)}: ${left[0]}`);
    return [file, next];
  });
  for (const [file, next] of rewritten) fs.writeFileSync(file, next);
  const { default: releaseNotes } = await import(`${pathToFileURL(path.join(directory, 'js/release-notes.js')).href}?v=${version}`);
  const notes = releaseNotes.slice(0, NOTES_MAX).map(({ id, title }) => ({ id, title }));
  fs.writeFileSync(path.join(directory, 'version.json'), `${JSON.stringify({ version, notes })}\n`);
  return { version, files: sources.length, notes: notes.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = path.resolve(process.argv[2] ?? 'web');
  try {
    const result = await buildRelease(directory);
    console.log(`版 ${result.version} を書き込みました（${result.files} ファイル・更新内容 ${result.notes} 件）`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
