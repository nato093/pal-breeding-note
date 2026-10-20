import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHandleSource, inspectFiles } from '../../web/js/save/handles.js';
import { domErrorOf, fileHandle, fileHandles } from '../../tools/server-agent/fs-handles.mjs';
import { memoryPersist } from '../../tools/server-agent/kv-storage.mjs';

const WORLD = 'AAAAAAAA000000000000000000000001';
const PLAYER = '0000000000000000000000000000000A';

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pal-agent-fs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(dir, rel, text, time = null) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  if (time) fs.utimesSync(file, time, time);
  return file;
}

async function rejectsWith(promise, name) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.name, name);
    return true;
  });
}

test('常駐のハンドル: 本物のファイルを FileSystemFileHandle の形で読む', async (t) => {
  const dir = tempDir(t);
  const file = write(dir, 'Level.sav', 'level-bytes', new Date('2026-10-18T05:00:00.123Z'));
  const handle = fileHandle(file);
  assert.equal(handle.kind, 'file');
  assert.equal(handle.name, 'Level.sav');
  assert.equal(await handle.queryPermission({ mode: 'read' }), 'granted');
  assert.equal(await handle.requestPermission({ mode: 'read' }), 'granted');
  const got = await handle.getFile();
  assert.equal(got.lastModified, Math.trunc(fs.statSync(file).mtimeMs));
  assert.equal(got.size, 11);
  const buffer = await got.arrayBuffer();
  assert.ok(buffer instanceof ArrayBuffer);
  assert.equal(Buffer.from(buffer).toString(), 'level-bytes');
});

test('常駐のハンドル: 消えたファイル・フォルダは NotFoundError（必須でなければ飛ばせる）', async (t) => {
  const dir = tempDir(t);
  await rejectsWith(fileHandle(path.join(dir, 'none.sav')).getFile(), 'NotFoundError');
  await rejectsWith(fileHandle(path.join(dir, 'none', 'x.sav')).getFile(), 'NotFoundError');
  fs.mkdirSync(path.join(dir, 'folder.sav'));
  await rejectsWith(fileHandle(path.join(dir, 'folder.sav')).getFile(), 'NotFoundError');
  // getFile の後に消えた
  const file = write(dir, 'gone.sav', 'x');
  const got = await fileHandle(file).getFile();
  fs.rmSync(file);
  await rejectsWith(got.arrayBuffer(), 'NotFoundError');
});

test('常駐のハンドル: getFile の後にファイルが変わったら NotReadableError（ブラウザの File と同じ）', async (t) => {
  const dir = tempDir(t);
  const file = write(dir, 'Level.sav', 'before', new Date('2026-10-18T05:00:00Z'));
  const got = await fileHandle(file).getFile();
  write(dir, 'Level.sav', 'after-save', new Date('2026-10-18T05:00:30Z'));
  await rejectsWith(got.arrayBuffer(), 'NotReadableError');
  // 読み直せば新しい中身が読める
  assert.equal(Buffer.from(await (await fileHandle(file).getFile()).arrayBuffer()).toString(), 'after-save');
});

// fs を差し替える（失敗を注入し、開いたハンドルを閉じたかを数える）
function fakeFs({ statError = '', openError = '', readError = '', changeAfterRead = false } = {}) {
  const calls = { opened: 0, closed: 0 };
  const stats = { mtimeMs: 1000.7, size: 3, isFile: () => true };
  return {
    calls,
    async stat() { if (statError) throw Object.assign(new Error(`${statError}: G:\\secret\\path`), { code: statError }); return stats; },
    async open() {
      if (openError) throw Object.assign(new Error(`${openError}: G:\\secret\\path`), { code: openError });
      calls.opened++;
      let reads = 0;
      return {
        async stat() { return changeAfterRead && reads > 0 ? { ...stats, size: 4 } : stats; },
        async readFile() {
          reads++;
          if (readError) throw Object.assign(new Error(readError), { code: readError });
          return Buffer.from('abc');
        },
        async close() { calls.closed++; },
      };
    },
  };
}

test('常駐のハンドル: 置き換えの途中・削除待ち（EBUSY・EPERM・EACCES）は NotReadableError、ほかは Error（文にパスを入れない）', async () => {
  for (const code of ['EBUSY', 'EPERM', 'EACCES']) {
    await rejectsWith(fileHandle('G:\\x\\Level.sav', { fs: fakeFs({ statError: code }) }).getFile(), 'NotReadableError');
    const opening = fakeFs({ openError: code });
    await rejectsWith((await fileHandle('G:\\x\\Level.sav', { fs: opening }).getFile()).arrayBuffer(), 'NotReadableError');
  }
  const io = fakeFs({ readError: 'EIO' });
  await assert.rejects((await fileHandle('G:\\x\\Level.sav', { fs: io }).getFile()).arrayBuffer(), (error) => {
    assert.equal(error.name, 'Error');
    assert.equal(error.nodeCode, 'EIO');
    return true;
  });
  assert.equal(io.calls.closed, io.calls.opened, '失敗しても閉じる');
  const converted = domErrorOf(Object.assign(new Error('EBUSY: resource busy, open G:\\secret\\path'), { code: 'EBUSY' }));
  assert.equal(converted.name, 'NotReadableError');
  assert.doesNotMatch(converted.message, /secret/);
  assert.doesNotMatch(domErrorOf(new Error('x at G:\\secret\\path')).message, /secret/);
});

test('常駐のハンドル: 読むたびに開いて閉じる（読んでいる間に変わったら NotReadableError）', async () => {
  const ok = fakeFs();
  const got = await fileHandle('G:\\x\\Level.sav', { fs: ok }).getFile();
  assert.equal(got.lastModified, 1000);
  assert.equal(Buffer.from(await got.arrayBuffer()).toString(), 'abc');
  assert.equal(Buffer.from(await got.arrayBuffer()).toString(), 'abc');
  assert.deepEqual(ok.calls, { opened: 2, closed: 2 });
  const changing = fakeFs({ changeAfterRead: true });
  await rejectsWith((await fileHandle('G:\\x\\Level.sav', { fs: changing }).getFile()).arrayBuffer(), 'NotReadableError');
  assert.deepEqual(changing.calls, { opened: 1, closed: 1 });
});

test('常駐のハンドル: 画面と同じ createHandleSource に入れると、サーバーのワールドとして読める', async (t) => {
  const dir = tempDir(t);
  const time = new Date('2026-10-18T05:00:00Z');
  const files = {
    'Level.sav': write(dir, 'Level.sav', 'level', time),
    'LevelMeta.sav': write(dir, 'LevelMeta.sav', 'meta', time),
    [`Players/${PLAYER}.sav`]: write(dir, `Players/${PLAYER}.sav`, 'player', time),
  };
  const handles = fileHandles(files);
  const inspected = await inspectFiles('host', handles, '0');
  assert.equal(inspected.status, 'ok');
  assert.equal(inspected.role, 'host');
  const source = createHandleSource({ persist: memoryPersist(), key: 'pal-note.owned.handles' });
  await source.commit({ worldId: WORLD, steamId: '0', files: handles, name: 'テストのワールド', nameSet: true });
  const [world] = await source.list();
  assert.equal(world.status, 'ok');
  assert.equal(world.role, 'host');
  const read = await source.read(world);
  assert.deepEqual(read.files.map((file) => [file.path, Buffer.from(file.bytes).toString()]).sort(), [
    ['Level.sav', 'level'], ['LevelMeta.sav', 'meta'], [`Players/${PLAYER}.sav`, 'player'],
  ]);
  // 消えた Players のファイルは飛ばす（必須ではない）
  fs.rmSync(files[`Players/${PLAYER}.sav`]);
  const [after] = await source.list();
  assert.equal(after.status, 'ok');
  assert.deepEqual(after.missing, [`Players/${PLAYER}.sav`]);
});
