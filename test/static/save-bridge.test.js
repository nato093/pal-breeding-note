import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createBridgeServer, findWorlds, resolveSaveFile } from '../../scripts/save-bridge.mjs';

function tempSaves(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pal-saves-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (rel, text = 'x') => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  write('7656/AAAA/Level.sav', 'level-a');
  write('7656/AAAA/Players/00000000000000000000000000000001.sav');
  write('7656/AAAA/Players/savesync.sav');
  write('7656/AAAA/backup/world/x/Level.sav');
  write('7656/GlobalPalStorage.sav', 'global');
  write('secret.sav', 'secret');
  const old = new Date('2026-01-01T00:00:00Z');
  write('7656/BBBB/Level.sav');
  fs.utimesSync(path.join(root, '7656/BBBB/Level.sav'), old, old);
  return root;
}

async function listen(t, root) {
  const server = createBridgeServer({ root, log: () => {} });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address();
  return (pathname, headers = {}) => fetch(`http://127.0.0.1:${port}${pathname}`, { headers: { Origin: 'https://nato093.github.io', ...headers } });
}

test('連携ツール: ワールドを新しい順に見つけ、バックアップや別のファイルは含めない', (t) => {
  const root = tempSaves(t);
  const worlds = findWorlds(root);
  assert.deepEqual(worlds.map((w) => [w.dir, w.files]), [
    ['7656/AAAA', ['Level.sav', 'Players/00000000000000000000000000000001.sav', '../GlobalPalStorage.sav']],
    ['7656/BBBB', ['Level.sav', '../GlobalPalStorage.sav']],
  ]);
  assert.equal(resolveSaveFile(root, '7656/AAAA', '../../secret.sav'), null);
  assert.equal(resolveSaveFile(root, '7656/AAAA', 'Players/../../BBBB/Level.sav'), null);
  assert.equal(resolveSaveFile(root, '7656/AAAA', '../GlobalPalStorage.sav'), path.join(root, '7656', 'GlobalPalStorage.sav'));
});

test('連携ツール: 許可した配信元にだけ、ワールド内のセーブを返す', async (t) => {
  const root = tempSaves(t);
  const get = await listen(t, root);
  const list = await get('/worlds');
  assert.equal(list.status, 200);
  assert.equal(list.headers.get('access-control-allow-origin'), 'https://nato093.github.io');
  assert.deepEqual((await list.json()).worlds.map((w) => w.dir), ['7656/AAAA', '7656/BBBB']);
  const file = await get('/file?world=7656/AAAA&name=Level.sav');
  assert.equal(await file.text(), 'level-a');
  assert.equal(await (await get('/file?world=7656/AAAA&name=../GlobalPalStorage.sav')).text(), 'global');
  assert.equal((await get('/file?world=7656/AAAA&name=../../secret.sav')).status, 404);
  assert.equal((await get('/file?world=..&name=secret.sav')).status, 404);
  assert.equal((await get('/worlds', { Origin: 'https://example.com' })).status, 403);
  const preflight = await fetch(list.url, { method: 'OPTIONS', headers: { Origin: 'https://nato093.github.io', 'Access-Control-Request-Private-Network': 'true' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');
});

test('連携ツール: Origin のない要求・不正な URL では止まらず、何も返さない', async (t) => {
  const root = tempSaves(t);
  const server = createBridgeServer({ root, log: () => {} });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const raw = (requestPath, headers = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: requestPath, headers }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.end();
  });
  assert.equal(await raw('/file?world=7656/AAAA&name=Level.sav'), 403);
  assert.equal(await raw('//[', { Origin: 'https://nato093.github.io' }), 400);
  assert.equal(await raw('/worlds', { Origin: 'https://nato093.github.io', Host: 'evil.example:80' }), 421);
  assert.equal(await raw('/worlds', { Origin: 'http://localhost:5173' }), 403);
  assert.equal(await raw('/worlds', { Origin: 'https://nato093.github.io' }), 200);
});

test('連携ツール: ワールドのフォルダを直接指定しても、外のファイルやリンク先は読まない', (t) => {
  const root = tempSaves(t);
  const world = path.join(root, '7656', 'AAAA');
  assert.deepEqual(findWorlds(world).map((w) => [w.dir, w.files]), [['.', ['Level.sav', 'Players/00000000000000000000000000000001.sav']]]);
  try {
    fs.symlinkSync(path.join(root, 'secret.sav'), path.join(world, 'Players', '00000000000000000000000000000002.sav'));
  } catch {
    t.diagnostic('この環境ではシンボリックリンクを作れないため、リンク先の確認を省く（Windows の既定の権限など）');
    return;
  }
  assert.equal(resolveSaveFile(world, '.', 'Players/00000000000000000000000000000002.sav'), null);
  assert.ok(!findWorlds(world)[0].files.includes('Players/00000000000000000000000000000002.sav'));
});
