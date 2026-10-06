import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBreeding, encodePairs, renderBreeding, NO_CHILD, pairIndex } from '../../scripts/import-breeding.mjs';
import { decodeBreeding, breedChild, isGenderDependent } from '../../web/js/core/breeding.js';

const row = (p1, p2, child, g1 = 'WILDCARD', g2 = 'WILDCARD') => ({
  Parent1InternalName: p1, Parent1Gender: g1, Parent2InternalName: p2, Parent2Gender: g2, ChildInternalName: child,
});
const IDS = ['A', 'B', 'C', 'D'];
const roundTrip = (built) => decodeBreeding({ ids: built.ids, pairs: encodePairs(built.pairs), genderRules: built.genderRules });

test('配合表の生成: 生成→復号→照合が元の行と一致し、親の順序を問わない', () => {
  const built = buildBreeding({ ids: IDS, rows: [row('A', 'A', 'A'), row('A', 'B', 'C'), row('C', 'B', 'D'), row('B', 'C', 'D')] });
  const table = roundTrip(built);
  assert.equal(breedChild(table, 'A', 'M', 'B', 'F'), 'C');
  assert.equal(breedChild(table, 'B', 'M', 'A', 'F'), 'C');
  assert.equal(breedChild(table, 'C', 'F', 'B', 'M'), 'D');
  assert.equal(built.pairs.length, (IDS.length * (IDS.length + 1)) / 2);
  assert.equal(built.pairs[pairIndex(IDS.length, 0, 1)], 2);
});

test('配合表の生成: 表にない組は 0xFFFF（照合できない＝子は空）', () => {
  const built = buildBreeding({ ids: IDS, rows: [row('A', 'B', 'C')] });
  assert.equal(built.pairs[pairIndex(IDS.length, 2, 3)], NO_CHILD);
  assert.equal(breedChild(roundTrip(built), 'C', 'M', 'D', 'F'), '');
});

test('配合表の生成: 同じ組み合わせで子が食い違う行があると失敗する', () => {
  assert.throws(() => buildBreeding({ ids: IDS, rows: [row('A', 'B', 'C'), row('B', 'A', 'D')] }), /食い違/);
  assert.throws(() => buildBreeding({ ids: IDS, rows: [row('A', 'B', 'C', 'MALE', 'FEMALE'), row('B', 'A', 'D', 'FEMALE', 'MALE')] }), /食い違/);
});

test('配合表の生成: パルのマスターにない ID の行は捨てて知らせ、ビルドは続ける', () => {
  const built = buildBreeding({ ids: IDS, rows: [row('A', 'B', 'C'), row('A', 'Zed', 'C'), row('A', 'C', 'Unknown')] });
  assert.deepEqual(built.dropped, ['Unknown', 'Zed']);
  assert.equal(built.pairs[pairIndex(IDS.length, 0, 2)], NO_CHILD);
});

test('配合表の生成: 性別で子が変わる組は、どちらの順で引いても性別どおりになる', () => {
  const built = buildBreeding({ ids: IDS, rows: [row('C', 'D', 'A', 'FEMALE', 'MALE'), row('C', 'D', 'B', 'MALE', 'FEMALE')] });
  const table = roundTrip(built);
  assert.equal(breedChild(table, 'C', 'F', 'D', 'M'), 'A');
  assert.equal(breedChild(table, 'D', 'M', 'C', 'F'), 'A');
  assert.equal(breedChild(table, 'D', 'F', 'C', 'M'), 'B');
  assert.equal(breedChild(table, 'C', '', 'D', ''), '');
  assert.ok(isGenderDependent(table, 'D', 'C'));
  assert.ok(!isGenderDependent(table, 'A', 'B'));
});

test('配合表の復号: 大きさが合わない・範囲外の子は受け付けない', () => {
  const built = buildBreeding({ ids: IDS, rows: [row('A', 'B', 'C')] });
  assert.throws(() => decodeBreeding({ ids: IDS.slice(0, 3), pairs: encodePairs(built.pairs), genderRules: [] }), /大きさ/);
  const broken = built.pairs.slice();
  broken[0] = IDS.length;
  assert.throws(() => decodeBreeding({ ids: IDS, pairs: encodePairs(broken), genderRules: [] }), /範囲外/);
});

test('配合表の出力: 生成したファイルは照合用である旨を書き、そのまま読み込める', async () => {
  const text = renderBreeding(buildBreeding({ ids: IDS, rows: [row('A', 'B', 'C')] }), 'x@y');
  assert.match(text, /照合にだけ使う/);
  const data = await import(`data:text/javascript,${encodeURIComponent(text)}`);
  assert.equal(breedChild(decodeBreeding(data.default), 'A', 'M', 'B', 'F'), 'C');
});
