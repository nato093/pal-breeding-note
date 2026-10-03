import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, parseCsv } from '../../web/js/core/csv.js';

test('CSV: BOM、カンマ、引用符、改行、日本語、空セルの往復', () => {
  const rows = [{ 名前: 'アオバ', メモ: 'カンマ,と"引用"\r\n改行\n続き', 空: '' }];
  const csv = toCsv(rows, ['名前', 'メモ', '空']);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.ok(csv.includes('""引用""'));
  assert.deepEqual(parseCsv(csv), [['名前', 'メモ', '空'], ['アオバ', rows[0].メモ, '']]);
});

test('CSV: 数式対策を全セルとヘッダーに適用し、引用記号を読み込み時に残す', () => {
  const dangerous = ['=1+1', '+1', '-1', '@SUM(A1)', "'引用"];
  assert.deepEqual(parseCsv(toCsv([dangerous], dangerous)), [dangerous.map((cell) => `'${cell}`), dangerous.map((cell) => `'${cell}`)]);
});

test('CSV: 配列行、数値、null、欠落した値を文字列セルにする', () => {
  assert.deepEqual(parseCsv(toCsv([[42, null]], ['a', 'b', 'c'])), [['a', 'b', 'c'], ['42', '', '']]);
  assert.deepEqual(parseCsv(toCsv([], ['a'])), [['a']]);
});

test('parseCsv: BOM の有無、LF/CRLF/CR、最終改行、引用符内の改行に対応する', () => {
  for (const newline of ['\n', '\r\n', '\r']) {
    assert.deepEqual(parseCsv(`a,b${newline}c,${newline}`), [['a', 'b'], ['c', '']]);
  }
  assert.deepEqual(parseCsv('\uFEFF"a\nb","c""d"\n'), [['a\nb', 'c"d']]);
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(parseCsv('\uFEFF'), []);
  assert.deepEqual(parseCsv('""'), [['']]);
  assert.deepEqual(parseCsv(','), [['', '']]);
  assert.deepEqual(parseCsv('\n'), [['']]);
});

test('parseCsv: 閉じていない引用符を拒否する', () => {
  assert.throws(() => parseCsv('a,"閉じていない'), /引用符/);
});
