import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildRelease, versionScript, versionHtml } from '../../scripts/build-release.mjs';
import releaseNotes from '../../web/js/release-notes.js';

const web = fileURLToPath(new URL('../../web/', import.meta.url));
const script = fileURLToPath(new URL('../../scripts/build-release.mjs', import.meta.url));
const VERSION = '0123456789abcdef0123456789abcdef01234567';

// 配信物（画像は除く）を一時ディレクトリに写し、ES モジュールとして読めるよう package.json を置く。
function copyWeb(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pal-release-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'web');
  fs.cpSync(web, target, { recursive: true, filter: (source) => !source.includes(`${path.sep}img${path.sep}`) && !source.endsWith('version.json') });
  fs.writeFileSync(path.join(directory, 'package.json'), '{ "type": "module" }');
  return target;
}

function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(file) : [file];
  });
}

test('配信の書き換え: 相対 .js の指定子だけに ?v を付ける（画像・開発用・外部は変えない）', () => {
  const source = [
    "import { a } from './a.js';", 'import {\n  b,\n} from "../b.js";', "export { c } from './c.js';",
    "const d = import('./save/d.js');", "new Worker(new URL('./save/worker.js', import.meta.url));",
    'new URL(`../../img/pals/${file}`, import.meta.url);', 'await import(`/dev/${key}-api.js`);', "import x from 'node:fs';",
  ].join('\n');
  const result = versionScript(source, 'abc1234');
  for (const specifier of ["'./a.js?v=abc1234'", '"../b.js?v=abc1234"', "'./c.js?v=abc1234'", "'./save/d.js?v=abc1234'", "'./save/worker.js?v=abc1234'"]) {
    assert.ok(result.includes(specifier), specifier);
  }
  assert.ok(result.includes('`../../img/pals/${file}`'));
  assert.ok(result.includes('`/dev/${key}-api.js`'));
  assert.ok(result.includes("'node:fs'"));
  const html = versionHtml('<head>\n  <link rel="stylesheet" href="css/app.css">\n  <script type="module" src="js/app.js"></script>\n  <a href="https://example.test/x.js"></a>', 'abc1234');
  assert.match(html, /<head>\n  <meta name="app-version" content="abc1234">\n/);
  assert.match(html, /href="css\/app\.css\?v=abc1234"/);
  assert.match(html, /src="js\/app\.js\?v=abc1234"/);
  assert.match(html, /href="https:\/\/example\.test\/x\.js"/);
});

test('配信の書き換え: 全ての参照に版を付け、version.json を書き出し、書き換え後もモジュールとして読める', async (t) => {
  const target = copyWeb(t);
  const result = await buildRelease(target, VERSION);
  assert.equal(result.version, VERSION);
  for (const file of filesIn(target).filter((name) => /\.js$/.test(name))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const [, specifier] of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bnew\s+URL\s*\(\s*)['"](\.\.?\/[^'"]+)['"]/g)) {
      assert.ok(specifier.endsWith(`.js?v=${VERSION}`), `${file}: ${specifier}`);
      // 参照先のファイルが実在する
      assert.ok(fs.existsSync(path.resolve(path.dirname(file), specifier.split('?')[0])), `${file}: ${specifier}`);
    }
  }
  const index = fs.readFileSync(path.join(target, 'index.html'), 'utf8');
  assert.match(index, new RegExp(`<meta name="app-version" content="${VERSION}">`));
  assert.match(index, new RegExp(`src="js/app\\.js\\?v=${VERSION}"`));
  assert.match(index, new RegExp(`href="css/app\\.css\\?v=${VERSION}"`));
  assert.match(fs.readFileSync(path.join(target, 'diag.html'), 'utf8'), new RegExp(`\\.js\\?v=${VERSION}"`));
  const manifest = JSON.parse(fs.readFileSync(path.join(target, 'version.json'), 'utf8'));
  assert.deepEqual(manifest, { version: VERSION, notes: releaseNotes.slice(0, 20).map(({ id, title }) => ({ id, title })) });
  // 書き換えた参照をたどってモジュールを読み込める（画面を起動する app.js・diag.js と Worker 本体は除く）
  for (const file of filesIn(path.join(target, 'js')).filter((name) => /\.js$/.test(name) && !/[\\/](app|diag|worker)\.js$/.test(name))) {
    await import(`${pathToFileURL(file).href}?v=${VERSION}`);
  }
  const { runningVersion } = await import(`${pathToFileURL(path.join(target, 'js/version.js')).href}?v=${VERSION}`);
  assert.equal(runningVersion(), VERSION);
});

test('配信の書き換え: 書き換え済み・形式外の版は受け付けず、コマンドは失敗で終わる', async (t) => {
  const target = copyWeb(t);
  await assert.rejects(buildRelease(target, 'main'), /版の形式/);
  await buildRelease(target, VERSION);
  await assert.rejects(buildRelease(target, VERSION), /書き換え済み/);
  assert.throws(() => execFileSync(process.execPath, [script, target], { env: { ...process.env, GITHUB_SHA: VERSION }, stdio: 'pipe' }));
});

test('配信の書き換え: 副作用の import にも付け、知らない書き方の相対 .js が残ったら失敗する', async (t) => {
  assert.equal(versionScript("import './side.js';", 'abc1234'), "import './side.js?v=abc1234';");
  const target = copyWeb(t);
  fs.writeFileSync(path.join(target, 'js', 'unknown.js'), "const module = './unknown-form.js';\nexport default module;\n");
  await assert.rejects(buildRelease(target, VERSION), /\?v を付けられなかった参照があります: js[\\/]unknown\.js/);
});
