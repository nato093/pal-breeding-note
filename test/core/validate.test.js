import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeText, validateRecordInput, needsSheetQuote, quoteForSheet } from '../../web/js/core/validate.js';

const palIdSet = new Set(['A', 'B', 'C']);
const valid = { parent1Id: 'A', parent2Id: 'B', childId: 'C' };

test('sanitizeText: 文字列化、制御文字除去、trim、最大長の順に処理する', () => {
  assert.equal(sanitizeText(' \u0000あ\tい\nう\rえ\u007f\u0085お ', 3), 'あいう');
  assert.equal(sanitizeText(12345, 3), '123');
  assert.equal(sanitizeText(null, 10), '');
  assert.equal(sanitizeText(undefined, 10), '');
  assert.equal(sanitizeText('あ', 0), '');
});

test('validateRecordInput: 許可項目だけ返し、未指定の任意項目を空文字にする', () => {
  const input = Object.freeze({ ...valid, unknown: '無視', confirmCount: 999, id: '無視' });
  assert.deepEqual(validateRecordInput(input, palIdSet), {
    ok: true, value: { ...valid, parent1Gender: '', parent2Gender: '', registrant: '', memo: '' },
  });
  assert.equal(input.unknown, '無視');
});

test('validateRecordInput: マスター外、欠落、型違いの ID を拒否する', () => {
  for (const invalid of ['X', '', undefined, null, 1]) {
    assert.deepEqual(validateRecordInput({ ...valid, parent1Id: invalid }, palIdSet), {
      ok: false, errors: [{ field: 'parent1Id', code: 'INVALID_PAL_ID' }],
    });
  }
  assert.deepEqual(validateRecordInput(null, palIdSet).errors.map((error) => error.field), ['parent1Id', 'parent2Id', 'childId']);
});

test('validateRecordInput: 性別 M/F/空だけを許す', () => {
  for (const gender of ['M', 'F', '']) {
    assert.equal(validateRecordInput({ ...valid, parent1Gender: gender, parent2Gender: gender }, palIdSet).ok, true);
  }
  assert.deepEqual(validateRecordInput({ ...valid, parent1Gender: 'm', parent2Gender: 0 }, palIdSet), {
    ok: false, errors: [{ field: 'parent1Gender', code: 'INVALID_GENDER' }, { field: 'parent2Gender', code: 'INVALID_GENDER' }],
  });
});

test('validateRecordInput: 登録者 30 文字、メモ 200 文字の境界を検証する', () => {
  assert.equal(validateRecordInput({ ...valid, registrant: 'あ'.repeat(30), memo: 'い'.repeat(200) }, palIdSet).ok, true);
  assert.deepEqual(validateRecordInput({ ...valid, registrant: 'あ'.repeat(31), memo: 'い'.repeat(201) }, palIdSet), {
    ok: false, errors: [{ field: 'registrant', code: 'TOO_LONG' }, { field: 'memo', code: 'TOO_LONG' }],
  });
  const result = validateRecordInput({ ...valid, registrant: `  ${'あ'.repeat(30)}\u0000 `, memo: 123 }, palIdSet);
  assert.equal(result.ok, true);
  assert.equal(result.value.registrant, 'あ'.repeat(30));
  assert.equal(result.value.memo, '123');
});

test('表計算用引用: 5 種の危険な先頭文字だけにアポストロフィを付ける', () => {
  for (const prefix of ['=', '+', '-', '@', "'"]) {
    assert.equal(needsSheetQuote(`${prefix}式`), true);
    assert.equal(quoteForSheet(`${prefix}式`), `'${prefix}式`);
  }
  for (const text of ['', '通常', 'a=1', ' =1']) {
    assert.equal(needsSheetQuote(text), false);
    assert.equal(quoteForSheet(text), text);
  }
  assert.equal(quoteForSheet(123), '123');
});
