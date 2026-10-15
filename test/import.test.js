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

// game-assets: 作業適性は pals.js ではなく別の生成ファイル（web/data/work.js。ゲーム本体の表から npm run extract:work）に持つ。
// INV-2: 同じ表にある配合の値（CombiRank など）が混じらない（値は作業の鍵と 1 以上の整数だけ）
test('INV-2: 作業適性（web/data/work.js）は作業の鍵と 1 以上の整数だけで、配合の値を含めない', async () => {
  const { default: work, WORKS } = await import('../web/data/work.js');
  const keys = Object.keys(WORKS);
  assert.ok(keys.length >= 10, `作業の種類 ${keys.length}`);
  for (const [key, kind] of Object.entries(WORKS)) {
    assert.match(key, /^[A-Za-z]+$/);
    assert.deepEqual(Object.keys(kind).sort(), ['icon', 'ja'], key);
    assert.ok(kind.ja && kind.ja !== key, `${key} の日本語名`);
    if (kind.icon) assert.ok(fs.existsSync(`web/img/work/${kind.icon}`), kind.icon);
  }
  // パル ID はマスターと同じ（全員）。値は作業の鍵 → 1 以上の整数だけ
  assert.deepEqual(Object.keys(work).sort(), pals.map((p) => p.id).sort());
  for (const [id, entry] of Object.entries(work)) {
    for (const [key, level] of Object.entries(entry)) {
      assert.ok(keys.includes(key), `${id}: ${key}`);
      assert.ok(Number.isInteger(level) && level >= 1, `${id}.${key} = ${level}`);
    }
  }
  const source = fs.readFileSync('web/data/work.js', 'utf8');
  assert.doesNotMatch(source.replace(/^\s*\/\/.*$/gm, ''), /Combi|Breed|Rarity|Price/i);
  assert.match(source, /自動生成/);
  assert.match(source, /手で編集しない/);
  // 取り出しのスクリプトも、残すのは WorkSuitability_* の列だけ
  const script = fs.readFileSync('scripts/extract-work.mjs', 'utf8');
  assert.match(script, /keep: \(name\) => columns\.includes\(name\)/);
});

// implants: パル手術台の表（web/data/implants.js。ゲーム本体から npm run extract:implants）。INV-2: 手術台は配合ではない。
// 取り込むのはパッシブ・アイテム・種類だけで、表の数値（Price）や配合の値を含めない。表のパッシブ ID はすべて passives.js にある
test('INV-2: 手術台の表（web/data/implants.js）はパッシブ・アイテム・種類だけで、パッシブ ID はすべて passives.js にある', async () => {
  const { default: implants, GENDER_REVERSE_ITEM, GENDER_REVERSE_NAME } = await import('../web/data/implants.js');
  const { default: passives } = await import('../web/data/passives.js');
  const ids = new Set(passives.map((passive) => passive.id));
  assert.equal(implants.length, 54);
  assert.equal(new Set(implants.map((entry) => entry.passiveId)).size, implants.length);
  for (const entry of implants) {
    assert.deepEqual(Object.keys(entry).sort(), ['item', 'itemName', 'kind', 'passiveId'], entry.passiveId);
    assert.ok(ids.has(entry.passiveId), `passives.js にない: ${entry.passiveId}`);
    if (entry.kind === 'free') assert.deepEqual([entry.item, entry.itemName], ['', ''], entry.passiveId);
    else if (entry.kind === 'reusable') {
      assert.match(entry.item, /^PalPassiveSkillChange_(?!Consumable_)/, entry.passiveId);
      assert.match(entry.itemName, /^インプラント：/, entry.passiveId);
    } else {
      assert.equal(entry.kind, 'consumable', entry.passiveId);
      assert.match(entry.item, /^PalPassiveSkillChange_Consumable_/, entry.passiveId);
      assert.match(entry.itemName, /^使い切りインプラント：/, entry.passiveId);
    }
  }
  // v1.0.5 の表: アイテム不要 19・インプラント 14・使い切り 21
  assert.deepEqual(['free', 'reusable', 'consumable'].map((kind) => implants.filter((entry) => entry.kind === kind).length), [19, 14, 21]);
  assert.deepEqual([GENDER_REVERSE_ITEM, GENDER_REVERSE_NAME], ['PalGenderReverse', 'パルリバーサー']);
  const source = fs.readFileSync('web/data/implants.js', 'utf8');
  assert.match(source, /自動生成/);
  assert.match(source, /手で編集しない/);
  // 値はどれも文字列（表の数値〔Price〕を書き出さない。SalePrice_Up_1 などパッシブ ID の中の語は除く）
  assert.doesNotMatch(source.replace(/^\s*\/\/.*$/gm, ''), /"price"|:\s*-?\d|Combi|Breed/i);
  // 判定の関数（core/implants.js）は配合表・遺伝の仕組みを読まない（読むのは表と、目標の判定・値の形の確かめだけ）
  const core = fs.readFileSync('web/js/core/implants.js', 'utf8');
  assert.deepEqual([...core.matchAll(/from '([^']+)'/g)].map((match) => match[1]), ['../../data/implants.js', './ideal-goals.js', './boundary.js']);
  // 取り出しのスクリプトも、残すのはパッシブとアイテムの列だけ（Price は読み進めるために読むが残さない）
  const script = fs.readFileSync('scripts/extract-implants.mjs', 'utf8');
  assert.match(script, /const KEEP = \['PassiveSkill', 'RequireItemId'\];/);
  assert.match(script, /keep: \(name\) => KEEP\.includes\(name\)/);
});
