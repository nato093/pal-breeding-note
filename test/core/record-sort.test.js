import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../../web/js/core/index.js';
import { recordComparator } from '../../web/js/core/record-sort.js';

const pals = [
  { id: 'A', no: 3, ja: 'ア', variant: false },
  { id: 'B', no: 1, ja: 'ウ', variant: false },
  { id: 'Bv', no: 1, ja: 'エ', variant: true },
  { id: 'C', no: 2, ja: 'イ', variant: false },
  { id: 'D', no: 4, ja: 'オ', variant: false },
];
const palsById = new Map(pals.map((pal) => [pal.id, pal]));
const records = Object.freeze([
  ['r1', 'A', 'B', 'C'], ['r2', 'B', 'A', 'D'], ['r3', 'B', 'C', 'A'],
  ['r4', 'B', 'C', 'C'], ['r5', 'B', 'C', 'C'], ['r6', 'C', 'B', 'Bv'], ['r7', 'Bv', 'A', 'A'],
].map(([id, parent1Id, parent2Id, childId]) => Object.freeze({ id, parent1Id, parent2Id, childId })));
const { palOrder } = buildIndex(records, pals);

for (const [sort, expected] of [
  ['parent-dex', ['r4', 'r5', 'r3', 'r2', 'r7', 'r6', 'r1']],
  ['parent-name', ['r1', 'r6', 'r2', 'r3', 'r4', 'r5', 'r7']],
  ['child-dex', ['r6', 'r4', 'r5', 'r1', 'r3', 'r7', 'r2']],
  ['child-name', ['r3', 'r7', 'r1', 'r4', 'r5', 'r6', 'r2']],
]) {
  test(`一覧の並べ替え: ${sort} は指定のパルと同順位の優先順・id で固定する`, () => {
    const compare = recordComparator(sort, palOrder, palsById);
    assert.deepEqual([...records].sort(compare).map((record) => record.id), expected);
    assert.deepEqual([...records].reverse().sort(compare).map((record) => record.id), expected);
    assert.deepEqual(records.map((record) => record.id), ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7']);
    assert.equal(compare(records[0], records[0]), 0);
  });
}

test('一覧の並べ替え: 更新日は新しい順、同じ日時は id 順', () => {
  const input = [
    { id: 'c', updatedAt: '2026-10-03T00:00:00Z' },
    { id: 'b', updatedAt: '2026-10-04T00:00:00Z' },
    { id: 'a', updatedAt: '2026-10-04T00:00:00Z' },
  ];
  assert.deepEqual(input.sort(recordComparator('updated')).map((record) => record.id), ['a', 'b', 'c']);
});

test('一覧の並べ替え: 五十音順は日本語照合を使い、同名なら次の親と子を比較する', () => {
  const master = new Map([
    ['same1', { ja: 'ぱる' }], ['same2', { ja: 'ぱる' }],
    ['first', { ja: 'あい' }], ['last', { ja: 'アオ' }],
  ]);
  const input = [
    { id: 'a', parent1Id: 'same1', parent2Id: 'last', childId: 'last' },
    { id: 'b', parent1Id: 'same2', parent2Id: 'first', childId: 'last' },
    { id: 'c', parent1Id: 'same1', parent2Id: 'first', childId: 'first' },
  ];
  assert.deepEqual(input.sort(recordComparator('parent-name', new Map(), master)).map((record) => record.id), ['c', 'b', 'a']);
});
