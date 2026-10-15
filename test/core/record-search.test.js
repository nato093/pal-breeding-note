import { test } from 'node:test';
import assert from 'node:assert/strict';
import pals from '../../web/data/pals.js';
import { buildIndex } from '../../web/js/core/index.js';
import { queryTerms } from '../../web/js/core/kana.js';
import {
  RECORD_SORTS, RECORD_SORT_DEFAULT, recordSort, searchBase, byRegistrant, searchRecords, registrantCounts, groupRecords, childCounts, pairNote,
} from '../../web/js/core/record-search.js';

const palsById = new Map(pals.map((pal) => [pal.id, pal]));
const record = (id, parent1Id, parent2Id, childId, extra = {}) => Object.freeze({
  id, parent1Id, parent2Id, childId, registrant: 'アリス', memo: '', updatedAt: '2026-10-01T00:00:00Z', createdAt: '2026-10-01T00:00:00Z', ...extra,
});
// モコロン（SheepBall）・フラリーナ（FlowerDoll）・セレムーン（MoonQueen）・ツッパニャン（PinkCat）・クレメーオ（CatMage）
const records = Object.freeze([
  record('r1', 'FlowerDoll', 'SheepBall', 'MoonQueen', { updatedAt: '2026-10-04T00:00:00Z', memo: 'モコの夜' }),
  record('r2', 'PinkCat', 'SheepBall', 'CatMage', { registrant: 'ボブ', updatedAt: '2026-10-03T00:00:00Z' }),
  record('r3', 'CatMage', 'PinkCat', 'SheepBall', { registrant: 'ＡＬＩＣＥ', updatedAt: '2026-10-02T00:00:00Z' }),
  record('r4', 'FlowerDoll', 'SheepBall', 'PinkCat', { registrant: '', updatedAt: '2026-10-05T00:00:00Z' }),
  record('r5', 'SheepBall', 'SheepBall', 'SheepBall', { registrant: 'alice', updatedAt: '2026-10-01T00:00:00Z' }),
]);
const index = buildIndex(records, pals);
const ids = (list) => list.map((item) => item.id).sort();
const search = (filter) => ids(searchRecords(index, records, filter, palsById));

test('配合を探す: 並べ替えは 5 種で、既定は更新日の新しい順。知らない値は既定', () => {
  assert.deepEqual(RECORD_SORTS.map(([key]) => key), ['updated', 'parent-dex', 'parent-name', 'child-dex', 'child-name']);
  assert.equal(RECORD_SORT_DEFAULT, 'updated');
  assert.equal(recordSort('child-name'), 'child-name');
  assert.equal(recordSort('知らない'), 'updated');
  assert.equal(recordSort(null), 'updated');
  assert.ok(Object.isFrozen(RECORD_SORTS));
});

test('配合を探す: 親1＋親2・片親（親1 でも親2 でも）・子・親＋子・3 つ・なし（全件）で引ける', () => {
  assert.deepEqual(search({ p1: 'SheepBall', p2: 'FlowerDoll' }), ['r1', 'r4']);
  assert.deepEqual(search({ p1: 'PinkCat' }), ['r2', 'r3']);
  assert.deepEqual(search({ p2: 'PinkCat' }), ['r2', 'r3']);
  assert.deepEqual(search({ c: 'SheepBall' }), ['r3', 'r5']);
  // 親＋子:「モコロンと何を組めばセレムーンか」
  assert.deepEqual(search({ p1: 'SheepBall', c: 'MoonQueen' }), ['r1']);
  assert.deepEqual(search({ p2: 'SheepBall', c: 'PinkCat' }), ['r4']);
  // 3 つとも: 一致する登録があるか
  assert.deepEqual(search({ p1: 'FlowerDoll', p2: 'SheepBall', c: 'MoonQueen' }), ['r1']);
  assert.deepEqual(search({ p1: 'FlowerDoll', p2: 'SheepBall', c: 'CatMage' }), []);
  assert.deepEqual(search({}), ['r1', 'r2', 'r3', 'r4', 'r5']);
  // 同じ親どうしも親として引ける
  assert.deepEqual(search({ p1: 'SheepBall', p2: 'SheepBall' }), ['r5']);
});

test('配合を探す: 登録者は ID の大小・全角半角をそろえて比べ、未指定（空）だけも選べる', () => {
  assert.deepEqual(search({ by: 'Alice' }), ['r3', 'r5']);
  assert.deepEqual(search({ by: 'アリス' }), ['r1']);
  assert.deepEqual(search({ by: 'alice' }), ['r3', 'r5']);
  assert.deepEqual(search({ by: 'ＡＬＩＣＥ' }), ['r3', 'r5']);
  assert.deepEqual(search({ noRegistrant: true }), ['r4']);
  // by があれば noRegistrant は見ない
  assert.deepEqual(search({ by: 'ボブ', noRegistrant: true }), ['r2']);
  assert.deepEqual(ids(byRegistrant(records, {})), ['r1', 'r2', 'r3', 'r4', 'r5']);
});

test('配合を探す: キーワードは親・子の和名（ひらがな・カタカナ）・英名・図鑑番号・メモ・登録者で、空白区切りはすべて含む（AND）', () => {
  const byWords = (query) => search({ terms: queryTerms(query) });
  // 「もこ」→ モコロンを含む記録と、メモに「モコ」を含む記録
  assert.deepEqual(byWords('もこ'), ['r1', 'r2', 'r3', 'r4', 'r5']);
  assert.deepEqual(byWords('せれむーん'), ['r1']);
  assert.deepEqual(byWords('moon'), ['r1']);
  assert.deepEqual(byWords('CATMAGE'), ['r2', 'r3']);
  assert.deepEqual(byWords('夜'), ['r1']);
  assert.deepEqual(byWords('ぼぶ'), ['r2']);
  assert.deepEqual(byWords('ﾎﾞﾌﾞ'), ['r2']);
  // r3 は子がモコロン
  assert.deepEqual(byWords('モコロン ツッパニャン'), ['r2', 'r3', 'r4']);
  assert.deepEqual(byWords('モコロン 該当なし'), []);
  // 図鑑番号（No.1 のモコロン）
  const no = palsById.get('SheepBall').label;
  assert.ok(byWords(String(no)).includes('r5'));
  // 条件と組み合わせられる
  assert.deepEqual(ids(searchBase(index, records, { p1: 'SheepBall', terms: queryTerms('ふらりーな') }, palsById)), ['r1', 'r4']);
});

test('配合を探す: 登録者の選択肢は すべて → 自分（0 件でも）→ ほかの登録者（件数の多い順・同数は五十音）→ 未指定。名前は今の ID の書き方', () => {
  assert.deepEqual(registrantCounts(records, { users: ['Alice', 'ボブ', 'アリス'], me: 'アリス' }), [
    { value: '', label: 'すべて', count: 5, kind: 'all' },
    { value: 'アリス', label: 'アリス（自分）', count: 1, kind: 'self' },
    { value: 'Alice', label: 'Alice', count: 2, kind: 'user' },
    { value: 'ボブ', label: 'ボブ', count: 1, kind: 'user' },
    { value: '', label: '登録者未指定', count: 1, kind: 'none' },
  ]);
  // 記録にしか出てこない古い名前（今の ID にない）は、記録の中でいちばん多い書き方
  const old = registrantCounts([records[2], records[4], { ...records[4], id: 'r6' }], { users: [], me: '' });
  assert.deepEqual(old.map(({ label, count }) => [label, count]), [['すべて', 3], ['alice', 3]]);
  // 自分の登録が無くても自分を出す
  assert.deepEqual(registrantCounts([], { me: 'キャロル' }).map(({ label, count }) => [label, count]), [['すべて', 0], ['キャロル（自分）', 0]]);
});

test('配合を探す: 既定（更新日の新しい順）は見出しなしの 1 群', () => {
  const groups = groupRecords(records, 'updated', index.palOrder, palsById);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].palId, '');
  assert.deepEqual(groups[0].records.map((item) => item.id), ['r4', 'r1', 'r2', 'r3', 'r5']);
  assert.deepEqual(groupRecords(records, '知らない', index.palOrder, palsById)[0].records.map((item) => item.id), ['r4', 'r1', 'r2', 'r3', 'r5']);
});

test('配合を探す: 親の並びは 1 件 1 回、並び順で先に来る親の群に入れ、群の中は相手 → 子 → ID の順', () => {
  const groups = groupRecords(records, 'parent-dex', index.palOrder, palsById);
  const shape = groups.map((group) => [group.palId, group.records.map((item) => item.id)]);
  // 図鑑順: モコロン(1) < ツッパニャン(2) < フラリーナ < クレメーオ
  assert.deepEqual(shape.map(([palId]) => palId), ['SheepBall', 'PinkCat']);
  assert.equal(groups.flatMap((group) => group.records).length, records.length);
  assert.deepEqual(new Set(groups.flatMap((group) => group.records.map((item) => item.id))).size, records.length);
  // モコロンの群: 相手の図鑑順（モコロン → ツッパニャン → フラリーナ）、同じ相手は子の順
  assert.deepEqual(shape[0][1], ['r5', 'r2', 'r4', 'r1']);
  assert.deepEqual(shape[1][1], ['r3']);
  // 親を 1 体だけ選んでいれば、その親を含む記録はすべてその親の群
  const focused = groupRecords(searchRecords(index, records, { p1: 'PinkCat' }, palsById), 'parent-dex', index.palOrder, palsById, { focusParent: 'PinkCat' });
  assert.deepEqual(focused.map((group) => [group.palId, group.records.map((item) => item.id)]), [['PinkCat', ['r2', 'r3']]]);
});

test('配合を探す: 子の並びは子の群、群の中は親の組の順。五十音の並びも選べる', () => {
  const groups = groupRecords(records, 'child-dex', index.palOrder, palsById);
  assert.deepEqual(groups.map((group) => [group.palId, group.records.map((item) => item.id)]), [
    ['SheepBall', ['r5', 'r3']], ['PinkCat', ['r4']],
    ...groups.slice(2).map((group) => [group.palId, group.records.map((item) => item.id)]),
  ]);
  const byName = groupRecords(records, 'child-name', index.palOrder, palsById).map((group) => palsById.get(group.palId).ja);
  assert.deepEqual(byName, [...byName].sort(new Intl.Collator('ja').compare));
  const parentNames = groupRecords(records, 'parent-name', index.palOrder, palsById).map((group) => palsById.get(group.palId).ja);
  assert.deepEqual(parentNames, [...parentNames].sort(new Intl.Collator('ja').compare));
});

test('配合を探す: 子ごとの件数は多い順、件数の行の添え書きは同じ組の複数の結果と、親の性別で子が変わる組を見分ける', () => {
  assert.deepEqual(childCounts(searchRecords(index, records, { p1: 'SheepBall' }, palsById), index.palOrder).map(({ childId, count }) => [childId, count]),
    [['SheepBall', 1], ['PinkCat', 1], ['MoonQueen', 1], ['CatMage', 1]].sort((a, b) => index.palOrder.get(a[0]) - index.palOrder.get(b[0])));
  const pair = searchRecords(index, records, { p1: 'SheepBall', p2: 'FlowerDoll' }, palsById);
  assert.equal(pairNote(pair), 'multi');
  assert.equal(pairNote([records[0]]), '');
  // すべての記録に親の性別があり、組ごとに向きが違う（フラリーナ♀ × モコロン♂ → セレムーン、フラリーナ♂ × モコロン♀ → ツッパニャン）
  const gendered = [
    { ...records[0], parent1Gender: 'F', parent2Gender: 'M' },
    { ...records[3], parent1Gender: 'M', parent2Gender: 'F' },
  ];
  assert.equal(pairNote(gendered), 'gender');
  // 片方に性別がなければ「複数」のまま
  assert.equal(pairNote([gendered[0], records[3]]), 'multi');
  // 同じ向きなら「複数」
  assert.equal(pairNote([gendered[0], { ...records[3], parent1Gender: 'F', parent2Gender: 'M' }]), 'multi');
});
