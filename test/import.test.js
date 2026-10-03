import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import pals, { ELEMENTS } from '../web/data/pals.js';
import { CSV_COLUMNS, JS_FIELDS, buildPals } from '../scripts/import-pals.mjs';
import { ALL_SOURCE_URLS } from '../scripts/sources.mjs';

// INV-2: マスターには配合に関する情報を持たせない（許可リストの列だけ）
test('INV-2: pals.js の各パルは許可リストの項目だけを持つ', () => {
  for (const p of pals) assert.deepEqual(Object.keys(p).sort(), [...JS_FIELDS].sort(), p.id);
});

test('INV-2: pals.csv の列は許可リストどおり', () => {
  const header = fs.readFileSync('data/pals.csv', 'utf8').split('\n')[0];
  assert.equal(header, CSV_COLUMNS.join(','));
});

test('INV-2: 取り込み元に配合データ（breeding.json など）を含めない', () => {
  for (const url of ALL_SOURCE_URLS) assert.ok(!/breed/i.test(url), url);
  const script = fs.readFileSync('scripts/import-pals.mjs', 'utf8');
  assert.ok(!/BreedingPower|breeding\.json/.test(script.replace(/^\s*\/\/.*$/gm, '')));
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
