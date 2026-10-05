import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

async function filesIn(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) files.push(...await filesIn(url));
    else files.push(url);
  }
  return files;
}

test('静的検査: web の描画に HTML 文字列や禁止された style 属性を使わない', async () => {
  const files = await filesIn(new URL('../../web/', import.meta.url));
  for (const file of files.filter((url) => /\.(js|html)$/.test(url.pathname))) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\s*\.\s*write\s*\(/, file.pathname);
    assert.doesNotMatch(source, /\bstyle\s*=\s*['"]|setAttribute\s*\(\s*['"]style['"]/i, file.pathname);
  }
});

test('静的検査: index の CSP 接続先は GAS の二つのオリジンと、この PC のセーブ連携ツールだけ', async () => {
  const source = await readFile(new URL('../../web/index.html', import.meta.url), 'utf8');
  const csp = source.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  const connect = csp.split(';').map((value) => value.trim()).find((value) => value.startsWith('connect-src '));
  assert.equal(connect, 'connect-src https://script.google.com https://script.googleusercontent.com http://127.0.0.1:5175');
  assert.match(source, /name="robots" content="noindex"/);
  assert.match(source, /name="viewport"/);
  assert.doesNotMatch(source, /rel="manifest"/);
});

test('静的検査: 開発 API の複製は web の配信物に存在しない', async () => {
  const files = await filesIn(new URL('../../web/', import.meta.url));
  for (const file of files.filter((url) => /\.(js|html|css)$/.test(url.pathname))) {
    assert.doesNotMatch(file.pathname, /mock/i);
    assert.doesNotMatch(await readFile(file, 'utf8'), /mock/i, file.pathname);
  }
  const app = await readFile(new URL('../../web/js/app.js', import.meta.url), 'utf8');
  assert.match(app, /location\.hostname/);
  assert.match(app, /localhost/);
  assert.match(app, /await import\(`/);
});

test('静的検査: 開発 API の初期レコードは空で、seed 指定時だけ生成する', async () => {
  const source = await readFile(new URL('../../dev/mock-api.js', import.meta.url), 'utf8');
  assert.match(source, /const records = new Map\(\)/);
  assert.match(source, /seed !== null && seed !== undefined/);
  assert.doesNotMatch(source, /fetch\s*\(/);
});

test('静的検査: セーブ連携ツールへの通信は save/bridge.js だけが 127.0.0.1 に行う', async () => {
  const bridge = await readFile(new URL('../../web/js/save/bridge.js', import.meta.url), 'utf8');
  assert.match(bridge, /export const BRIDGE_ORIGIN = 'http:\/\/127\.0\.0\.1:5175';/);
  assert.match(bridge, /\$\{BRIDGE_ORIGIN\}\$\{path\}/);
  const files = await filesIn(new URL('../../web/js/', import.meta.url));
  for (const file of files.filter((url) => !/\/save\/bridge\.js$/.test(url.pathname))) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /127\.0\.0\.1:|localhost:5175|fetchImpl/, file.pathname);
  }
});

test('静的検査: fetch は API クライアントと既存診断に限定する', async () => {
  const files = await filesIn(new URL('../../web/js/', import.meta.url));
  for (const file of files.filter((url) => !/\/(api|diag)\.js$/.test(url.pathname))) {
    assert.doesNotMatch(await readFile(file, 'utf8'), /\bfetch\s*\(/, file.pathname);
  }
});

test('静的検査: 廃止した共有・確認・登録者保存・権利ページの参照を残さない', async () => {
  const files = await filesIn(new URL('../../web/', import.meta.url));
  assert.ok(!files.some((file) => file.pathname.endsWith('/credits.html')));
  for (const file of files.filter((url) => /\.(js|html|css)$/.test(url.pathname))) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /credits\.html|credits-page|credits-link|shareLink|copyText|app-footer|share-button|pal-note\.registrant|context\.confirm|confirm-badge|card-menu|card-context|picker-value|toggle-field/, file.pathname);
  }
  const picker = await readFile(new URL('../../web/js/ui/pal-picker.js', import.meta.url), 'utf8');
  assert.doesNotMatch(picker, /\bmultiple\b/);
  const user = await readFile(new URL('../../web/js/core/user.js', import.meta.url), 'utf8');
  assert.doesNotMatch(user, /\bvar\b/);
});

test('静的検査: 最近使ったパルの保存キー・表示・処理を残さない', async () => {
  const files = await filesIn(new URL('../../web/', import.meta.url));
  for (const file of files.filter((url) => /\.(js|html|css)$/.test(url.pathname))) {
    assert.doesNotMatch(await readFile(file, 'utf8'), /pal-note\.recent|recent-marker|recentIds|recentOrder|最近使ったパル/, file.pathname);
  }
});
