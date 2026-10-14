import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from '../helpers/dom.js';
import { breedingCard } from '../../web/js/ui/breeding-card.js';
import { genderMark, palTile } from '../../web/js/ui/pal-icon.js';

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

test('配合行: 削除済みの配合は状態のチップ（statusChip の warning。前のクラス名 warning-chip は残す）', (t) => {
  installDom(t);
  const card = breedingCard({ ...record, deleted: true }, {}, { preview: true });
  const chip = card.querySelector('.warning-chip');
  assert.deepEqual([chip.tagName, chip.className, chip.textContent], ['span', 'status-chip is-warning warning-chip', '削除済み']);
  assert.equal(breedingCard(record, {}, { preview: true }).querySelector('.warning-chip'), null);
});

test('genderMark: 性別の印は文字の ♂♀ のまま（色の丸い地は CSS）、読み上げは「オス」「メス」。inline なら文の中に置く色だけの印', (t) => {
  installDom(t);
  const male = genderMark('M');
  assert.equal(male.tagName, 'span');
  assert.equal(male.className, 'gender gender-M');
  assert.deepEqual([male.textContent, male.getAttribute('role'), male.getAttribute('aria-label'), male.title], ['♂', 'img', 'オス', 'オス']);
  const female = genderMark('F', { inline: true });
  assert.equal(female.className, 'gender gender-F gender-inline');
  assert.deepEqual([female.textContent, female.getAttribute('role'), female.getAttribute('aria-label')], ['♀', 'img', 'メス']);
  // 性別が分からない（空・知らない値）ときは印を作らない
  assert.equal(genderMark(''), null);
  assert.equal(genderMark('X'), null);
  // palTile（所持パルの行・配合カード・パル選択）は同じ部品を使う。性別の要素を増やさない（2,000 行の DOM の予算）
  const tile = palTile('SheepBall', { gender: 'F', genderFirst: true });
  const mark = tile.querySelector('.gender');
  assert.deepEqual([mark.className, mark.textContent, mark.getAttribute('aria-label')], ['gender gender-F', '♀', 'メス']);
  assert.equal(tile.querySelectorAll('.gender').length, 1);
  assert.equal(palTile('SheepBall').querySelector('.gender'), null);
});
