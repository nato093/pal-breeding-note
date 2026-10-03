import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairKey, normalizeRecord, identityKey } from '../../web/js/core/pair.js';

test('pairKey: 対称性、同種、文字列比較を保つ', () => {
  assert.equal(pairKey('B', 'A'), 'A|B');
  assert.equal(pairKey('A', 'B'), pairKey('B', 'A'));
  assert.equal(pairKey('A', 'A'), 'A|A');
  assert.equal(pairKey('2', '10'), '10|2');
});

test('normalizeRecord: 親と性別を一緒に入れ替え、入力を変更しない', () => {
  const record = Object.freeze({ id: 'r1', parent1Id: 'B', parent2Id: 'A', childId: 'C', parent1Gender: 'M', parent2Gender: 'F', memo: '記録' });
  assert.deepEqual(normalizeRecord(record), { ...record, parent1Id: 'A', parent2Id: 'B', parent1Gender: 'F', parent2Gender: 'M' });
  assert.equal(record.parent1Id, 'B');
});

test('normalizeRecord: 順序が正しい場合と同種でも新しいオブジェクトを返す', () => {
  for (const parent2Id of ['A', 'B']) {
    const record = { parent1Id: 'A', parent2Id, parent1Gender: '', parent2Gender: 'M' };
    assert.deepEqual(normalizeRecord(record), record);
    assert.notEqual(normalizeRecord(record), record);
  }
});

test('identityKey: 親の順を無視し、子を区別する', () => {
  const record = { parent1Id: 'B', parent2Id: 'A', childId: 'C' };
  assert.equal(identityKey(record), 'A|B>C');
  assert.equal(identityKey(record), identityKey(normalizeRecord(record)));
  assert.notEqual(identityKey(record), identityKey({ ...record, childId: 'D' }));
});
