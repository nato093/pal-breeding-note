import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from '../helpers/dom.js';
import { breedingCard } from '../../web/js/ui/breeding-card.js';

const record = { parent1Id: 'SheepBall', parent2Id: 'FlowerDoll', childId: 'MoonQueen',
  registrant: '仲間', memo: '記録のメモ', confirmCount: 8, updatedAt: '2026-10-04T00:00:00Z' };

test('配合行: 親1 ＋ 親2 → 子、登録者・日時・メモ、SVG の編集・削除を表示する', async (t) => {
  installDom(t);
  const edits = [];
  const removals = [];
  const card = breedingCard(record, { register: (item) => edits.push(item), remove: async (item) => removals.push(item) });
  document.body.append(card);
  assert.match(card.querySelector('.breeding-equation').textContent, /モコロン＋.*フラリーナ→.*セレムーン/);
  assert.match(card.querySelector('.card-meta').textContent, /仲間.*更新/);
  assert.equal(card.querySelector('.card-memo').textContent, record.memo);
  assert.doesNotMatch(card.textContent, /確認|操作 ⋯/);
  assert.equal(card.querySelector('details'), null);
  const buttons = card.querySelectorAll('button');
  assert.equal(buttons.length, 2);
  for (const [index, label] of ['編集', '削除'].entries()) {
    const node = buttons[index];
    assert.equal(node.getAttribute('aria-label'), label);
    assert.equal(node.title, label);
    assert.equal(node.textContent, '');
    const svg = node.querySelector('svg');
    assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg');
    assert.equal(svg.getAttribute('aria-hidden'), 'true');
    assert.ok(svg.querySelector('path').getAttribute('d'));
  }
  assert.match(buttons[1].className, /danger-text/);
  await buttons[0].dispatch('click');
  await buttons[1].dispatch('click');
  assert.deepEqual(edits, [record]);
  assert.deepEqual(removals, [record]);
});

test('配合行: focusParent は相手 → 子だけにし、説明行を繰り返さない', (t) => {
  installDom(t);
  for (const [parent, expected, omitted] of [['SheepBall', 'フラリーナ', 'モコロン'], ['FlowerDoll', 'モコロン', 'フラリーナ']]) {
    const card = breedingCard(record, {}, { focusParent: parent });
    const equation = card.querySelector('.breeding-equation');
    assert.ok(equation.textContent.includes(expected));
    assert.ok(!equation.textContent.includes(omitted));
    assert.equal(equation.querySelectorAll('.pal-tile').length, 2);
    assert.ok(!equation.textContent.includes('＋'));
    assert.equal(card.querySelector('.card-context'), null);
  }
});

test('配合行: プレビューも同じ行構成で、操作を出さず、空のメモ行を作らない', (t) => {
  installDom(t);
  const card = breedingCard({ ...record, memo: '', deleted: true }, {}, { preview: true });
  assert.equal(card.querySelectorAll('.pal-tile').length, 3);
  assert.equal(card.querySelectorAll('button').length, 0);
  assert.equal(card.querySelector('.card-memo'), null);
  assert.match(card.textContent, /削除済み/);
});

test('配合行: 指定した親を左に表示し、性別も入れ替えるが記録は変えない', (t) => {
  installDom(t);
  const source = Object.freeze({ ...record, parent1Gender: 'M', parent2Gender: 'F' });
  for (const [leftParent, names, genders] of [
    ['', ['モコロン', 'フラリーナ'], ['♂', '♀']],
    ['SheepBall', ['モコロン', 'フラリーナ'], ['♂', '♀']],
    ['FlowerDoll', ['フラリーナ', 'モコロン'], ['♀', '♂']],
  ]) {
    const card = breedingCard(source, {}, { leftParent });
    const tiles = card.querySelector('.breeding-equation').querySelectorAll('.pal-tile');
    assert.deepEqual(tiles.slice(0, 2).map((tile) => tile.querySelector('strong').textContent), names);
    assert.deepEqual(tiles.slice(0, 2).map((tile) => tile.querySelector('.gender').textContent), genders);
  }
  assert.equal(source.parent1Id, 'SheepBall');
  assert.equal(source.parent1Gender, 'M');
  const same = breedingCard({ ...source, parent2Id: source.parent1Id }, {}, { leftParent: source.parent1Id });
  assert.deepEqual(same.querySelectorAll('.gender').map((node) => node.textContent), ['♂', '♀']);
});
