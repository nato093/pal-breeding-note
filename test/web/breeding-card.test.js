import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, descendants } from '../helpers/dom.js';
import { breedingCard } from '../../web/js/ui/breeding-card.js';
import { genderMark, palTile, palIcon, palsById, elementIcon, eggIcon, eggIconFile, gameIcon } from '../../web/js/ui/pal-icon.js';

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
  assert.deepEqual([male.textContent, male.getAttribute('role'), male.getAttribute('aria-label')], ['♂', 'img', 'オス']);
  // ツールチップ（title）で画面に「オス」「メス」と出さない（README の表記の決まり。読み上げの名前 aria-label だけ）
  assert.equal(male.title ?? '', '');
  assert.equal(male.getAttribute('title'), null);
  const female = genderMark('F', { inline: true });
  assert.equal(female.className, 'gender gender-F gender-inline');
  assert.deepEqual([female.textContent, female.getAttribute('role'), female.getAttribute('aria-label'), female.title ?? ''], ['♀', 'img', 'メス', '']);
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

// game-assets: 属性のアイコンは palTile の elements のオプトインだけ。配合カードなど既定の表示は変えない
test('palTile: 既定では属性のアイコンを出さず（配合カードも同じ）、elements: true なら名前の右に属性のアイコン（alt・title は「炎属性」）', (t) => {
  installDom(t);
  const plain = palTile('JetDragon');
  assert.equal(plain.querySelectorAll('img').filter((node) => node.className.includes('element-icon')).length, 0);
  assert.equal(plain.querySelector('.pal-name-line'), null);
  const card = breedingCard(record, { onEdit() {}, onDelete() {} });
  assert.equal(card.querySelectorAll('img').filter((node) => node.className.includes('element-icon')).length, 0);
  // src は web/img/element/ の画像、大きさは 16px で決める（配置を揺らさない）
  const tile = palTile('IceDeer', { elements: true, clickable: false });
  const icons = tile.querySelector('.pal-name-line').children.slice(1);
  assert.deepEqual(icons.map((node) => [node.tagName, node.alt, node.title, node.width, node.height, node.loading]), [
    ['img', '氷属性', '氷属性', 16, 16, 'lazy'],
  ]);
  assert.match(icons[0].src, /\/img\/element\/Ice\.png$/);
  // 性別つき（所持パルの行）は ♂♀ → 名前 → 属性（2 属性なら 2 つ。マスターの並び）
  const owned = palTile('BluePlatypus_Fire', { gender: 'M', genderFirst: true, elements: true });
  assert.deepEqual(owned.querySelector('.pal-name-line').children.map((node) => node.textContent || node.alt), ['♂', 'モモノスケ', '水属性', '炎属性']);
  // 'css' は要素を足さず、番号の行（No. の small）のクラス（CSS の ::after の背景）で描く（所持パルの 2,000 行の要素の数を変えない。
  // 名前の行に置くと 920px で名前が「…」で切れたので、名前の行は性別と名前だけ。フェーズ 4 の終わりのレビュー）
  const cssTile = palTile('BluePlatypus_Fire', { gender: 'M', genderFirst: true, elements: 'css' });
  const css = cssTile.querySelector('.pal-name-line');
  assert.deepEqual([css.className, css.children.length], ['pal-name-line', 2]);
  assert.deepEqual([cssTile.querySelector('.dex-label').className, cssTile.querySelector('.dex-label').textContent], ['dex-label has-elements el1-Water el2-Fire', 'No.5B']);
  assert.equal(descendants(cssTile).length, descendants(palTile('BluePlatypus_Fire', { gender: 'M', genderFirst: true })).length);
  const genderless = palTile('SheepBall', { elements: 'css' });
  assert.equal(genderless.querySelector('.pal-name-line'), null);
  assert.equal(genderless.querySelector('strong').className, '');
  assert.equal(genderless.querySelector('.dex-label').className, 'dex-label has-elements el1-Neutral');
  assert.equal(descendants(genderless).length, descendants(palTile('SheepBall')).length);
});

test('ゲームのアイコン: 読めなければ 1 回だけ文字の表示に戻す（属性は文字のチップ、タマゴ・配合牧場などは外す）', async (t) => {
  installDom(t);
  const host = document.createElement('span');
  const icon = elementIcon('Fire');
  host.append(icon);
  await icon.dispatch('error');
  assert.deepEqual(host.children.map((node) => [node.tagName, node.className, node.textContent]), [['span', 'element-chip element-Fire', '炎']]);
  const egg = gameIcon('item/egg-Fire.png');
  host.replaceChildren(egg);
  await egg.dispatch('error');
  assert.equal(host.children.length, 0);
  // タマゴの種類: アイテム ID の PalEgg_〈種類〉（大文字小文字は問わない・大きいタマゴも同じ）、突然変異は突然変異のタマゴ、分からなければなし
  assert.equal(eggIconFile('PalEgg_Fire_05'), 'item/egg-Fire.png');
  assert.equal(eggIconFile('paleGG_worldtree_01'), 'item/egg-WorldTree.png');
  assert.equal(eggIconFile('PalEgg_Normal_01'), 'item/egg-Normal.png');
  assert.equal(eggIconFile('PalEgg_Fire_01', { mutant: true }), 'item/egg-MutationPal.png');
  assert.equal(eggIconFile('PalEgg_MutationPal_03'), 'item/egg-MutationPal.png');
  assert.equal(eggIconFile(''), '');
  assert.equal(eggIconFile('PalEgg_Space_01'), '');
  assert.equal(eggIcon(undefined), null);
  assert.equal(eggIcon('PalEgg_Dark_02').alt, '');
  // パルの絵が読めないときは絵だけをアバターに替え、右下に重ねたタマゴのアイコンは残す
  const picture = palIcon(palsById.get('SheepBall'));
  const overlay = eggIcon('PalEgg_Fire_01');
  picture.append(overlay);
  await picture.children[0].dispatch('error');
  assert.deepEqual(picture.children.map((node) => node.tagName), ['svg', 'img']);
  assert.equal(picture.children[1], overlay);
});
