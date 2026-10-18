import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKvStorage, memoryPersist, volatileKey } from '../../tools/server-agent/kv-storage.mjs';

const SECRET = 'dummy-shared-pass-0000';

function tempFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pal-agent-kv-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'test', 'state.json');
}

// 書き込みを数え、rename の失敗を注入できる fs
function countingFs({ renameFailures = [] } = {}) {
  const counts = { writeFile: 0, rename: 0 };
  const failures = [...renameFailures];
  return {
    counts,
    readFileSync: fs.readFileSync,
    copyFileSync: fs.copyFileSync,
    promises: {
      mkdir: fs.promises.mkdir,
      async writeFile(...args) { counts.writeFile++; return fs.promises.writeFile(...args); },
      async rename(from, to) {
        counts.rename++;
        const code = failures.shift();
        if (code) throw Object.assign(new Error(`${code}: ${to}`), { code });
        return fs.promises.rename(from, to);
      },
    },
  };
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('常駐の KV: localStorage の形（同期）で読み書きし、1 秒まとめてファイルに書く', async (t) => {
  const file = tempFile(t);
  const counting = countingFs();
  const kv = createKvStorage({ file, fs: counting, delayMs: 20 });
  assert.equal(kv.getItem('pal-note.userId'), null);
  kv.setItem('pal-note.userId', 'サーバー');
  kv.setItem('pal-note.owned.settings', JSON.stringify({ auto: true }));
  kv.setItem('pal-note.count', 3);
  kv.removeItem('pal-note.count');
  assert.equal(kv.getItem('pal-note.userId'), 'サーバー');
  assert.equal(kv.getItem('pal-note.count'), null);
  assert.equal(fs.existsSync(file), false, 'すぐには書かない');
  assert.equal(kv.pending(), true);
  for (let i = 0; i < 200 && kv.pending(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(counting.counts.writeFile, 1, 'まとめて 1 回');
  assert.deepEqual(readJson(file), { 'pal-note.owned.settings': '{"auto":true}', 'pal-note.userId': 'サーバー' });
  assert.equal(fs.existsSync(`${file}.tmp`), false, 'tmp から rename する');
  assert.equal(kv.pending(), false);
  // 同じ値なら書かない
  kv.setItem('pal-note.userId', 'サーバー');
  assert.equal(kv.pending(), false);
  // 読み直す
  const again = createKvStorage({ file });
  assert.equal(again.getItem('pal-note.userId'), 'サーバー');
});

test('常駐の KV: パスワード・ログインの印・全件のキャッシュはファイルに書かない（メモリでは使える）', async (t) => {
  const file = tempFile(t);
  const kv = createKvStorage({ file, delayMs: 10_000 });
  kv.setItem('pal-note.passcode', SECRET);
  kv.setItem('pal-note.authenticated', 'test');
  kv.setItem('pal-note.cache.test', JSON.stringify({ records: [], secret: SECRET }));
  kv.setItem('pal-note.cache.prod', '{}');
  assert.equal(kv.pending(), false, 'これらだけなら書き込みを予約しない');
  kv.setItem('pal-note.userId', 'サーバー');
  await kv.flush();
  assert.equal(kv.getItem('pal-note.passcode'), SECRET);
  assert.equal(kv.getItem('pal-note.cache.test').includes(SECRET), true);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(!text.includes(SECRET));
  assert.deepEqual(Object.keys(JSON.parse(text)), ['pal-note.userId']);
  // 前の版や手で書いた state.json にあっても読まない
  fs.writeFileSync(file, JSON.stringify({ 'pal-note.passcode': SECRET, 'pal-note.cache.test': SECRET, 'pal-note.userId': 'サーバー', 'pal-note.n': 1 }));
  const reloaded = createKvStorage({ file });
  assert.equal(reloaded.getItem('pal-note.passcode'), null);
  assert.equal(reloaded.getItem('pal-note.cache.test'), null);
  assert.equal(reloaded.getItem('pal-note.n'), null, '文字列でない値は捨てる');
  reloaded.setItem('pal-note.x', '1');
  await reloaded.flush();
  assert.ok(!fs.readFileSync(file, 'utf8').includes(SECRET));
  assert.equal(volatileKey('other.passcode', 'other'), true);
  assert.equal(volatileKey('pal-note.passcodes'), false);
});

test('常駐の KV: 壊れた JSON は写しを残して空から始める。state.json は次の書き込みまで残す（書く前に終わっても、次の起動でまた壊れていると分かる）', async (t) => {
  const file = tempFile(t);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ "pal-note.userId": ');
  const errors = [];
  const kv = createKvStorage({ file, onError: (code) => errors.push(code), now: () => Date.parse('2026-10-18T05:00:00Z') });
  assert.deepEqual(errors, ['BROKEN_STATE']);
  assert.equal(kv.getItem('pal-note.userId'), null);
  assert.equal(kv.brokenState(), true, '壊れていたことを返す（常駐は古い系統の守りを止めた状態にする）');
  assert.equal(createKvStorage({ file: tempFile(t) }).brokenState(), false);
  assert.equal(kv.brokenFile(), `${file}.broken-2026-10-18T05-00-00-000Z`);
  assert.equal(fs.readFileSync(kv.brokenFile(), 'utf8'), '{ "pal-note.userId": ');
  // 止めた状態を足したが、書き出す前に終わった: 次の起動でも壊れていると分かる
  kv.setItem('pal-note.agent.lineage.test.W', '{"blocked":{"against":"unreadable"}}');
  assert.equal(fs.readFileSync(file, 'utf8'), '{ "pal-note.userId": ');
  assert.equal(createKvStorage({ file }).brokenState(), true);
  // 書き出したら、足した中身に置き換わる
  kv.setItem('pal-note.userId', 'サーバー');
  await kv.flush();
  assert.deepEqual(readJson(file), { 'pal-note.agent.lineage.test.W': '{"blocked":{"against":"unreadable"}}', 'pal-note.userId': 'サーバー' });
  assert.equal(createKvStorage({ file }).brokenState(), false);
  fs.writeFileSync(file, '[1, 2]');
  assert.equal(createKvStorage({ file }).getItem('0'), null);
});

test('常駐の KV: JSON として読めても、値が文字列でなければ壊れている（値を黙って捨てない。常駐は止めた状態にする）', (t) => {
  const file = tempFile(t);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (const value of [{ blocked: { against: 'published' } }, null, 5, true, ['x']]) {
    const text = JSON.stringify({ 'pal-note.userId': 'サーバー', 'pal-note.agent.lineage.test.W': value });
    fs.writeFileSync(file, text);
    const errors = [];
    const kv = createKvStorage({ file, onError: (code) => errors.push(code) });
    assert.equal(kv.brokenState(), true, JSON.stringify(value));
    assert.deepEqual(errors, ['BROKEN_STATE']);
    assert.equal(kv.getItem('pal-note.agent.lineage.test.W'), null);
    assert.equal(fs.readFileSync(file, 'utf8'), text, '書き出すまで残す');
  }
  // 書かないキー（パスワードなど）は形を問わず読まない
  fs.writeFileSync(file, JSON.stringify({ 'pal-note.userId': 'サーバー', 'pal-note.passcode': 1 }));
  const kv = createKvStorage({ file });
  assert.deepEqual([kv.brokenState(), kv.getItem('pal-note.userId'), kv.getItem('pal-note.passcode')], [false, 'サーバー', null]);
});

test('常駐の KV: state.json があるのに読めなければ、空から始めずに例外にする（EBUSY などはやり直す）', (t) => {
  const file = tempFile(t);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ 'pal-note.agent.lineage': '{"blocked":true}' }));
  const failing = (codes) => {
    const queue = [...codes];
    return { ...countingFs(), readFileSync: (...args) => {
      const code = queue.shift();
      if (code) throw Object.assign(new Error(`${code}: ${file}`), { code });
      return fs.readFileSync(...args);
    } };
  };
  const kv = createKvStorage({ file, fs: failing(['EBUSY', 'EPERM', 'EACCES']) });
  assert.equal(kv.getItem('pal-note.agent.lineage'), '{"blocked":true}');
  for (const codes of [['EBUSY', 'EBUSY', 'EBUSY', 'EBUSY'], ['EIO']]) {
    assert.throws(() => createKvStorage({ file, fs: failing(codes) }), (error) => {
      assert.equal(error.code, 'STATE_UNREADABLE');
      assert.ok(!error.message.includes(path.dirname(file)), '文にパスを入れない');
      return true;
    });
  }
  assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify({ 'pal-note.agent.lineage': '{"blocked":true}' }), '上書きしない');
});

test('常駐の KV: rename の EPERM・EBUSY は 100ms おきに 3 回までやり直す', async (t) => {
  const file = tempFile(t);
  const retried = countingFs({ renameFailures: ['EPERM', 'EBUSY', 'EPERM'] });
  const kv = createKvStorage({ file, fs: retried, delayMs: 10_000 });
  kv.setItem('pal-note.a', '1');
  const started = Date.now();
  await kv.flush();
  assert.ok(Date.now() - started >= 250, '100ms ずつ待つ');
  assert.equal(retried.counts.rename, 4);
  assert.deepEqual(readJson(file), { 'pal-note.a': '1' });
  assert.equal(kv.pending(), false);

  // 4 回とも失敗したら知らせ、書けていない印を残す（次の flush で書く）
  const errors = [];
  const failing = countingFs({ renameFailures: ['EBUSY', 'EBUSY', 'EBUSY', 'EBUSY', 'EACCES'] });
  const second = createKvStorage({ file, fs: failing, delayMs: 10_000, onError: (code) => errors.push(code) });
  second.setItem('pal-note.a', '2');
  await second.flush();
  assert.deepEqual(errors, ['EBUSY']);
  assert.equal(second.pending(), true);
  assert.deepEqual(readJson(file), { 'pal-note.a': '1' }, '前の state.json が残る');
  await second.flush();
  assert.deepEqual(readJson(file), { 'pal-note.a': '2' });
  assert.equal(second.pending(), false);
  // ほかの失敗はやり直さない
  const other = countingFs({ renameFailures: ['ENOSPC'] });
  const third = createKvStorage({ file, fs: other, delayMs: 10_000, onError: (code) => errors.push(code) });
  third.setItem('pal-note.a', '3');
  await third.flush();
  assert.equal(other.counts.rename, 1);
  assert.equal(errors.at(-1), 'ENOSPC');
});

test('常駐の KV: rename が失敗し続けると flush は false を返す（保存できていないことを呼び出し元に返す）。そのまま起動し直すと前の state.json から始まる', async (t) => {
  const file = tempFile(t);
  const first = createKvStorage({ file, delayMs: 10_000 });
  first.setItem('pal-note.agent.lineage.test.W', '{"blocked":null}');
  assert.equal(await first.flush(), true);
  const errors = [];
  const stuck = countingFs({ renameFailures: Array(20).fill('EPERM') });
  const kv = createKvStorage({ file, fs: stuck, delayMs: 10_000, onError: (code) => errors.push(code) });
  kv.setItem('pal-note.agent.lineage.test.W', '{"blocked":{"against":"published"}}');
  assert.equal(await kv.flush(), false);
  assert.equal(await kv.flush(), false);
  assert.equal(kv.pending(), true);
  assert.deepEqual(errors, ['EPERM', 'EPERM']);
  // 保存できなかった変更は、起動し直すと失われる（だから呼び出し元は正常な終了にしない）
  assert.equal(createKvStorage({ file }).getItem('pal-note.agent.lineage.test.W'), '{"blocked":null}');
  // 何も変えていなければ true
  assert.equal(await createKvStorage({ file }).flush(), true);
});

test('常駐の KV: 書いている間の変更は、終わった後にまとめて書く', async (t) => {
  const file = tempFile(t);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const slow = countingFs();
  const writeFile = slow.promises.writeFile;
  slow.promises.writeFile = async (...args) => { await gate; return writeFile(...args); };
  const kv = createKvStorage({ file, fs: slow, delayMs: 5 });
  kv.setItem('pal-note.a', '1');
  await new Promise((resolve) => setTimeout(resolve, 20));
  kv.setItem('pal-note.a', '2');
  kv.setItem('pal-note.b', '3');
  release();
  await kv.flush();
  assert.deepEqual(readJson(file), { 'pal-note.a': '2', 'pal-note.b': '3' });
  assert.equal(slow.counts.writeFile, 2);
});

test('常駐の KV: memoryPersist は idbPersist と同じ形（メモリだけ）', async () => {
  const persist = memoryPersist();
  assert.equal(await persist.get('x'), null);
  await persist.set('x', { a: 1 });
  await persist.setStrict('y', [1]);
  assert.deepEqual(await persist.get('x'), { a: 1 });
  assert.deepEqual(await persist.get('y'), [1]);
  await persist.remove('x');
  await persist.removeStrict('y');
  assert.equal(await persist.get('x'), null);
  assert.equal(await persist.get('y'), null);
});
