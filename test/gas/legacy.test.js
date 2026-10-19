// 古い版の取り出し（test/gas/legacy.js）: 手元では取り出せなければ null（呼び出す側が skip）、CI では黙って飛ばさずに失敗にする
//（docs/server/README.md の T6 の 1。CI の checkout は全部の履歴を取る）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { legacyApi, legacyGasFiles, runningInCi, LEGACY_COMMIT, LEGACY_V12_COMMIT } from './legacy.js';

// どの履歴にもないコミット（取り出せない場合を作る）
const MISSING = '0000000000000000000000000000000000000000';

test('古い版: CI かは環境変数 CI で決める（空・0・false は CI でない）', () => {
  for (const value of ['true', 'TRUE', '1', 'yes']) assert.equal(runningInCi({ CI: value }), true, value);
  for (const value of [undefined, '', ' ', '0', 'false', 'False']) assert.equal(runningInCi(value === undefined ? {} : { CI: value }), false, String(value));
});

test('古い版: 取り出せないとき、手元では null（呼び出す側が skip する）、CI では例外（互換テストを黙って飛ばさない）', async () => {
  assert.equal(legacyGasFiles(MISSING, { ci: false }), null);
  assert.equal(await legacyApi(MISSING, { ci: false }), null);
  assert.throws(() => legacyGasFiles(MISSING, { ci: true }), /fetch-depth: 0/);
  await assert.rejects(legacyApi(MISSING, { ci: true }), /fetch-depth: 0/);
  // 浅い複製のほか、履歴を書き換えてコミットがなくなった場合も案内する
  assert.throws(() => legacyGasFiles(MISSING, { ci: true }), /LEGACY_/);
});

test('古い版（最終レビュー）: 古い版は 40 字の完全なコミット番号で指す（短い番号が別のコミットと重なって取り出せなくならない）', () => {
  for (const commit of [LEGACY_COMMIT, LEGACY_V12_COMMIT]) assert.match(commit, /^[0-9a-f]{40}$/);
});

test('古い版: CI では版 10・版 12 の GAS と画面を取り出せる', { skip: runningInCi() ? false : 'CI だけで確かめる（手元の浅い複製では飛ばす）' }, async () => {
  for (const commit of [LEGACY_COMMIT, LEGACY_V12_COMMIT]) {
    assert.ok(legacyGasFiles(commit).some((file) => file.name === 'Main.js'), commit);
    assert.equal(typeof (await legacyApi(commit)).createApi, 'function', commit);
  }
});

test('古い版: CI（Pages の workflow）の checkout は全部の履歴を取る（fetch-depth: 0）', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/pages.yml', import.meta.url), 'utf8');
  // checkout の step の続きの行（次の「- 」の step の前まで）
  const checkout = /- uses: actions\/checkout@[^\r\n]+\r?\n((?:[ \t]+(?![ \t]|- )[^\r\n]*\r?\n)*)/.exec(workflow);
  assert.ok(checkout, 'actions/checkout の step がありません');
  assert.match(checkout[1], /^\s+fetch-depth: 0\s*$/m);
});

test('CI（最終レビュー）: Pages の deploy は main だけ（workflow_dispatch でブランチを選ぶと、Linux のテストと build だけが動く）', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/pages.yml', import.meta.url), 'utf8');
  const deploy = /^ {2}deploy:\r?\n((?: {4}[^\r\n]*\r?\n|\r?\n)*)/m.exec(workflow);
  assert.ok(deploy, 'deploy の job がありません');
  assert.match(deploy[1], /^ {4}if: github\.ref == 'refs\/heads\/main'\s*$/m);
});
