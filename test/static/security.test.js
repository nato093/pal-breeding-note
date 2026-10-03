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

test('静的検査: index の CSP 接続先は GAS の二つのオリジンだけ', async () => {
  const source = await readFile(new URL('../../web/index.html', import.meta.url), 'utf8');
  const csp = source.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  const connect = csp.split(';').map((value) => value.trim()).find((value) => value.startsWith('connect-src '));
  assert.equal(connect, 'connect-src https://script.google.com https://script.googleusercontent.com');
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

test('静的検査: fetch は API クライアントと既存診断に限定する', async () => {
  const files = await filesIn(new URL('../../web/js/', import.meta.url));
  for (const file of files.filter((url) => !/\/(api|diag)\.js$/.test(url.pathname))) {
    assert.doesNotMatch(await readFile(file, 'utf8'), /\bfetch\s*\(/, file.pathname);
  }
});
