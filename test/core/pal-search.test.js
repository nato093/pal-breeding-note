import { test } from 'node:test';
import assert from 'node:assert/strict';
import pals, { ELEMENTS } from '../../web/data/pals.js';
import { searchPals, TIERS } from '../../web/js/core/pal-search.js';

const active = pals.filter((pal) => pal.active);
const ids = (query, options) => searchPals(active, query, options).map(({ pal }) => pal.id);

test('パル選択の検索: 語が無ければ全部を図鑑順で返す', () => {
  const expected = [...active].sort((a, b) => a.no - b.no || Number(a.variant) - Number(b.variant)).map((pal) => pal.id);
  assert.deepEqual(ids(''), expected);
  assert.deepEqual(ids('　 '), expected);
});

test('パル選択の検索: 番号の頭の 0 を外し、番号の完全一致 → 前方一致 → 名前の先頭一致 → 部分一致の順', () => {
  const thirty = searchPals(active, '030');
  assert.equal(thirty[0].pal.no, 30);
  assert.equal(thirty[0].tier, TIERS.NUMBER);
  const eight = searchPals(active, '8');
  assert.equal(eight[0].pal.no, 8);
  // 8 の次は 80 番台（前方一致）。18 番・28 番などの部分一致は出さない
  assert.ok(eight.slice(1).every(({ pal, tier }) => tier === TIERS.NUMBER_PREFIX && String(pal.label).startsWith('8')));
  assert.ok(!eight.some(({ pal }) => pal.no === 18));
  const ra = searchPals(active, 'ら');
  const first = ra.findIndex(({ tier }) => tier !== TIERS.NAME_PREFIX);
  assert.ok(first > 0);
  assert.ok(ra.slice(0, first).every(({ pal }) => pal.ja.startsWith('ラ')));
  assert.ok(ra.slice(first).every(({ pal, tier }) => tier === TIERS.NAME && pal.ja.includes('ラ') && !pal.ja.startsWith('ラ')));
});

test('パル選択の検索: 英名でも探し、内部 ID は完全一致だけ（「grass」で _Grass の部分一致を出さない）', () => {
  assert.equal(ids('Lamball')[0], 'SheepBall');
  assert.equal(ids('sheepball')[0], 'SheepBall');
  const grass = searchPals(active, 'grass');
  // 出るのは草属性のパル（属性の完全一致）だけで、ID の部分一致の段階はない
  assert.ok(grass.length > 0);
  assert.ok(grass.every(({ pal, tier }) => tier === TIERS.ELEMENT && pal.el.includes('Grass')), grass.map(({ pal }) => pal.id).join(','));
});

test('パル選択の検索: 属性は名前に完全に一致したとき（「闇」「闇属性」「dark」）だけ', () => {
  const dark = active.filter((pal) => pal.el.includes('Dark')).map((pal) => pal.id).sort();
  for (const query of ['闇', '闇属性', 'dark', 'Dark']) {
    const found = searchPals(active, query).filter(({ tier }) => tier === TIERS.ELEMENT).map(({ pal }) => pal.id).sort();
    assert.deepEqual(found, dark, query);
  }
  assert.equal(ELEMENTS.Dark, '闇');
  // 属性の名前の一部（「属性」）では一致しない
  assert.ok(!searchPals(active, '属性').some(({ tier }) => tier === TIERS.ELEMENT));
});

test('パル選択の検索: パートナースキルは 2 文字以上の語で、名前の一致の後に添え書きつきで並べる', () => {
  const skills = { SheepBall: 'モコモコの盾', PinkCat: 'ひっかきモコ' };
  const found = searchPals(active, 'もこ', { partnerSkills: skills });
  const lamb = found.find(({ pal }) => pal.id === 'SheepBall');
  // モコロンは名前の先頭一致なので、添え書きなし
  assert.equal(lamb.tier, TIERS.NAME_PREFIX);
  assert.equal(lamb.note, '');
  const cat = found.find(({ pal }) => pal.id === 'PinkCat');
  assert.equal(cat.tier, TIERS.PARTNER);
  assert.equal(cat.note, 'パートナースキル: ひっかきモコ');
  assert.ok(found.indexOf(cat) > found.findLastIndex(({ tier }) => tier < TIERS.PARTNER));
  // 1 文字ではスキルを見ない
  assert.ok(!searchPals(active, 'ひ', { partnerSkills: skills }).some(({ pal }) => pal.id === 'PinkCat' && !pal.ja.includes('ヒ')));
});

test('パル選択の検索: 空白で区切った語をすべて含むパル（「炎 竜」で炎と竜の両方の属性）', () => {
  const both = searchPals(active, '炎 竜').map(({ pal }) => pal);
  assert.ok(both.length > 0);
  assert.ok(both.every((pal) => pal.el.includes('Fire') && pal.el.includes('Dragon')), both.map((pal) => pal.id).join(','));
  assert.deepEqual(both.map((pal) => pal.id).sort(), active.filter((pal) => pal.el.includes('Fire') && pal.el.includes('Dragon')).map((pal) => pal.id).sort());
});
