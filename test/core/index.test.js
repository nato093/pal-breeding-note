import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, findByPair, findByChild, findByParent } from '../../web/js/core/index.js';

const pals = [
  { id: 'D', no: 3, variant: false },
  { id: 'C', no: 2, variant: false },
  { id: 'A_V', no: 1, variant: true },
  { id: 'B', no: 1, variant: false },
  { id: 'A', no: 1, variant: false },
];
const record = (id, p1, p2, childId = 'D') => ({ id, parent1Id: p1, parent2Id: p2, childId });

test('buildIndex: マスター順は番号、通常種、ID の順', () => {
  const frozenPals = Object.freeze(pals.map((pal) => Object.freeze({ ...pal })));
  assert.deepEqual([...buildIndex([], frozenPals).palOrder.keys()], ['A', 'B', 'A_V', 'C', 'D']);
  assert.equal(frozenPals[0].id, 'D');
});

test('検索: ペアの対称性、逆引き、親からの検索、A×A の重複排除', () => {
  const aa = record('aa', 'A', 'A');
  const ab = record('ab', 'B', 'A');
  const index = buildIndex([aa, ab], pals);
  assert.deepEqual(findByPair(index, 'A', 'B'), [ab]);
  assert.deepEqual(findByPair(index, 'B', 'A'), [ab]);
  assert.deepEqual(findByPair(index, 'A', 'A'), [aa]);
  assert.deepEqual(findByChild(index, 'D'), [aa, ab]);
  assert.deepEqual(findByParent(index, 'A'), [aa, ab]);
  assert.deepEqual(findByParent(index, 'B'), [ab]);
  assert.deepEqual(findByPair(index, 'A', 'C'), []);
  assert.deepEqual(findByChild(index, 'X'), []);
  assert.deepEqual(findByParent(index, 'X'), []);
});

test('インデックス: 相手の順位、レコード ID の順で入力順に依存しない', () => {
  const records = [record('z', 'A', 'B'), record('a', 'A', 'B'), record('b', 'C', 'A'), record('c', 'A', 'A_V')];
  const original = Object.freeze(records.map(Object.freeze));
  const index = buildIndex(original, pals);
  assert.deepEqual(findByParent(index, 'A').map((rec) => rec.id), ['a', 'z', 'c', 'b']);
  assert.deepEqual(findByPair(index, 'A', 'B').map((rec) => rec.id), ['a', 'z']);
  assert.deepEqual(findByChild(index, 'D').map((rec) => rec.id), ['a', 'z', 'c', 'b']);
  assert.deepEqual(index, buildIndex([...original].reverse(), [...pals].reverse()));
  assert.equal(index.records.find((rec) => rec.id === 'z'), original[0]);
});

test('INV-1: レコード 0 件ならマスターがあっても全検索が空', () => {
  const index = buildIndex([], pals);
  assert.deepEqual(index.records, []);
  assert.deepEqual(findByPair(index, 'A', 'B'), []);
  assert.deepEqual(findByChild(index, 'D'), []);
  assert.deepEqual(findByParent(index, 'A'), []);
});
