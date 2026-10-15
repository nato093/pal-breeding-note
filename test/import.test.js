import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import pals, { ELEMENTS } from '../web/data/pals.js';
import { CSV_COLUMNS, JS_FIELDS, buildPals } from '../scripts/import-pals.mjs';
import { ALL_SOURCE_URLS } from '../scripts/sources.mjs';

// INV-2: マスターには配合に関する情報を持たせない（許可リストの列だけ）
test('INV-2: pals.js の各パルは許可リストの項目だけを持つ', () => {
  for (const p of pals) assert.deepEqual(Object.keys(p).sort(), [...JS_FIELDS].sort(), p.id);
});

test('INV-2: pals.csv の列は許可リストどおり', () => {
  const header = fs.readFileSync('data/pals.csv', 'utf8').split(/\r?\n/)[0];
  assert.equal(header, CSV_COLUMNS.join(','));
});

test('INV-2: マスターの取り込み元に配合データ（breeding.json など）を含めない', () => {
  for (const url of ALL_SOURCE_URLS) assert.ok(!/breed/i.test(url), url);
  const script = fs.readFileSync('scripts/import-pals.mjs', 'utf8');
  assert.ok(!/BreedingPower|breeding\.json/.test(script.replace(/^\s*\/\/.*$/gm, '')));
});

// INV-2 の例外: 配合表は自動登録の照合にだけ使う。画面（表示・検索）から読めないよう、読み込む場所を限る
test('INV-2: 配合表を読むのは自動登録だけ', () => {
  const files = fs.readdirSync('web/js', { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => path.join('web/js', f).replaceAll('\\', '/'));
  // ' " ` のどれでも・どこからの相対でも、解決した後のパスで数える（importsIn）。解決できない動的 import でも配合表を読まない
  const imports = new Map(files.map((file) => [file, importsIn(fs.readFileSync(file, 'utf8'), file)]));
  const importing = (target) => files.filter((file) => imports.get(file).includes(target)).sort();
  assert.deepEqual(importing('web/data/breeding.js'), ['web/js/auto-register.js']);
  assert.deepEqual(importing('web/js/core/breeding.js'), ['web/js/auto-register.js', 'web/js/core/auto-breeding.js']);
  assert.deepEqual(importing('web/js/core/auto-breeding.js'), ['web/js/auto-register.js', 'web/js/views/owned-settings.js']);
  for (const [file, specs] of imports) for (const spec of specs.filter((item) => item.includes('${'))) assert.doesNotMatch(spec, /breed/, file);
  // 設定画面が使うのは、プレイヤーと登録者の対応づけ（配合表は使わない）
  assert.match(fs.readFileSync('web/js/views/owned-settings.js', 'utf8'), /import \{ mappedUser \} from '\.\.\/core\/auto-breeding\.js'/);
});

// 読み込むモジュールの指定（静的 import・export from・動的 import。' " ` のどれでも）を、file からの相対で解決した web/js/… の形にする。
// ? と # の後ろは外す。${} を含むテンプレート文字列は解決できないので、その文字列のまま返す
function importsIn(source, file) {
  return [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"`])([^'"`]+)\1/g)].map(([, , spec]) => {
    if (spec.includes('${') || !spec.startsWith('.')) return spec;
    return path.posix.normalize(path.posix.join(path.posix.dirname(file), spec.replace(/[?#].*$/, '')));
  });
}

test('INV-2: import の検査は、バッククォートの動的 import・別の経路・クエリ付きも同じモジュールとして見る', () => {
  const source = "import { a } from './x.js';\nconst m = await import(`../core/ideal.js?v=1`);\nimport * as b from \"../../js/core/ideal.js#top\";\nexport { c } from '../core/./ideal.js';\nimport(`./${name}.js`);";
  assert.deepEqual(importsIn(source, 'web/js/views/sample.js'), [
    'web/js/views/x.js', 'web/js/core/ideal.js', 'web/js/core/ideal.js', 'web/js/core/ideal.js', './${name}.js',
  ]);
});

// INV-2 の例外: 遺伝の仕組み（core/ideal.js）は理想個体の提案にだけ使う。配合表は読まない
test('INV-2: 遺伝の仕組みを使うのは理想個体の画面だけ', () => {
  const files = fs.readdirSync('web/js', { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => path.join('web/js', f).replaceAll('\\', '/'));
  const imports = new Map(files.map((file) => [file, importsIn(fs.readFileSync(file, 'utf8'), file)]));
  assert.deepEqual(files.filter((file) => imports.get(file).includes('web/js/core/ideal.js')).sort(), ['web/js/views/ideal.js']);
  // 解決できない動的 import（${} を含むテンプレート文字列）で ideal.js を読まない
  for (const [file, specs] of imports) for (const spec of specs.filter((item) => item.includes('${'))) assert.doesNotMatch(spec, /ideal/, file);
  const ideal = fs.readFileSync('web/js/core/ideal.js', 'utf8');
  assert.deepEqual([...ideal.matchAll(/from '([^']+)'/g)].map((match) => match[1]), ['./index.js']);
});

test('マスター: ID は英数字と _ だけで重複しない', () => {
  const ids = pals.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9_]+$/);
  assert.ok(pals.length >= 290, `パル数 ${pals.length}`);
});

test('マスター: 日本語名がすべてあり、重複しない', () => {
  const names = pals.map((p) => p.ja);
  assert.ok(names.every(Boolean));
  assert.equal(new Set(names).size, names.length);
});

test('マスター: 図鑑に載っていない PlantSlime_Flower はパル選択に出さない（ID は残す）', () => {
  const flower = pals.find((p) => p.id === 'PlantSlime_Flower');
  assert.equal(flower.active, false);
  assert.equal(pals.filter((p) => !p.active).length, 1);
});

test('マスター: 属性は既知の属性名だけ', () => {
  for (const p of pals) for (const e of p.el) assert.ok(ELEMENTS[e], `${p.id}: ${e}`);
});

test('マスター: gas/PalMaster.js と pals.js の ID が一致する', () => {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync('gas/PalMaster.js', 'utf8'), ctx);
  const master = JSON.parse(JSON.stringify(ctx.PAL_MASTER_));
  assert.deepEqual(Object.keys(master).sort(), pals.map((p) => p.id).sort());
  for (const p of pals) assert.equal(master[p.id], p.ja);
});

test('buildPals: 名前で突合できない属性は図鑑ラベルで補い、画像の有無を反映する', () => {
  const db = {
    Elements: [{ Name: 'Water', LocalizedNames: { ja: '水属性' } }, { Name: 'Ground', LocalizedNames: { ja: '地属性' } }],
    Pals: [
      { InternalName: 'Alpha', Id: { PalDexNo: 5, IsVariant: false }, Name: 'Alpha', LocalizedNames: { en: 'Alpha', ja: 'アルファ' } },
      { InternalName: 'Alpha_Ground', Id: { PalDexNo: 5, IsVariant: true }, Name: 'Alpha Terra', LocalizedNames: { en: 'Alpha Terra', ja: 'アルファ地' } },
    ],
  };
  const elementsCsv = '﻿Paldex,Name,Elements\n5,Alpha,Water\n5B,Alpha Lux,Water/Ground\n';
  const { pals: built, report, elementNames } = buildPals({ db, elementsCsv, iconFiles: ['T_Alpha_icon_normal.webp'] });
  assert.deepEqual(built.map((p) => [p.palId, p.dexLabel, p.elements.join('|'), p.icon]), [
    ['Alpha', '5', 'Water', 'Alpha.webp'],
    ['Alpha_Ground', '5B', 'Water|Ground', ''],
  ]);
  assert.deepEqual(report.missingIcon, ['Alpha_Ground']);
  assert.deepEqual(elementNames, { Water: '水', Ground: '地' });
});
