import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serveStatic } from '../../scripts/dev-server.mjs';

async function get(url, method = 'GET') {
  const result = {};
  await serveStatic({ url, method }, {
    writeHead(status, headers) { result.status = status; result.headers = headers; },
    end(body) { result.body = body; },
  });
  return result;
}

test('静的サーバ: 公開画面、ES モジュール、開発用 API を正しい MIME で配信する', async () => {
  for (const [url, contentType] of [['/', 'text/html; charset=utf-8'], ['/js/app.js', 'text/javascript; charset=utf-8'],
    ['/dev/mock-api.js', 'text/javascript; charset=utf-8'], ['/css/app.css', 'text/css; charset=utf-8']]) {
    const response = await get(url);
    assert.equal(response.status, 200, url);
    assert.equal(response.headers['Content-Type'], contentType, url);
    assert.ok(response.body.length > 0);
  }
});

test('静的サーバ: HEAD の本文は空、不明ファイルと配信範囲外は拒否する', async () => {
  assert.equal((await get('/js/app.js', 'HEAD')).body, undefined);
  assert.equal((await get('/missing')).status, 404);
  assert.equal((await get('/credits.html')).status, 404);
  assert.equal((await get('/%2e%2e%2fpackage.json')).status, 404);
  assert.equal((await get('/dev/%2e%2e%2fAGENTS.md')).status, 404);
  assert.equal((await get('/.git/config')).status, 404);
  assert.equal((await get('/', 'POST')).status, 405);
});
