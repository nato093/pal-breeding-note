import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { renderShared } from '../../scripts/build-gas.mjs';
import { createGas } from '../gas/harness.js';

test('GAS: 同じ入力を再変換した内容と Shared.js が一致する', async () => {
  const sources = [];
  for (const name of ['pair.js', 'validate.js', 'user.js']) {
    sources.push({ name, source: await readFile(new URL(`../../web/js/core/${name}`, import.meta.url), 'utf8') });
  }
  const disk = await readFile(new URL('../../gas/Shared.js', import.meta.url), 'utf8');
  assert.equal(disk, renderShared(sources));
  assert.match(disk, /^\/\/ 自動生成・手で編集しない/);
  assert.doesNotMatch(disk, /^export /m);
});

test('GAS 生成: 通常、複数行、副作用、動的 import を拒否する', () => {
  for (const source of ["import x from './x.js';", "import\n { x } from './x.js';", "import './x.js';", "export function f() { return import('./x.js'); }"]) {
    assert.throws(() => renderShared([{ name: 'pair.js', source }]), /import は使用できません/);
    assert.throws(() => renderShared([{ name: 'validate.js', source }]), /import は使用できません/);
  }
});

test('GAS: 全ファイルの同一 vm 読み込みで衝突せず、共有関数を使用できる', () => {
  const { gas } = createGas();
  assert.equal(gas.pairKey('B', 'A'), 'A|B');
  assert.equal(gas.identityKey({ parent1Id: 'B', parent2Id: 'A', childId: 'C' }), 'A|B>C');
  assert.equal(gas.normalizeRecord({ parent1Id: 'B', parent2Id: 'A', parent1Gender: 'M', parent2Gender: 'F' }).parent1Gender, 'F');
  assert.equal(gas.sanitizeText(' あ\u0000 ', 30), 'あ');
  assert.equal(gas.validateRecordInput({ parent1Id: 'A', parent2Id: 'B', childId: 'C' }, new Set(['A', 'B', 'C'])).ok, true);
  assert.equal(gas.needsSheetQuote('=1'), true);
  assert.equal(gas.quoteForSheet('=1'), "'=1");
  assert.equal(typeof gas.trimPassword_, 'function');
  assert.equal(typeof gas.readTable_, 'function');
});

test('静的検査: core は API、状態保存、ブラウザ環境、通信を参照しない', async () => {
  const directory = new URL('../../web/js/core/', import.meta.url);
  const files = (await readdir(directory)).filter((file) => file.endsWith('.js'));
  assert.ok(files.includes('record-sort.js'));
  for (const file of files) {
    const source = await readFile(new URL(file, directory), 'utf8');
    assert.doesNotMatch(source, /\b(?:api|store)\.js\b|\b(?:document|window|localStorage|fetch)\b/, file);
  }
});
