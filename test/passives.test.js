import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import passives from '../web/data/passives.js';
import { PASSIVE_CSV_COLUMNS, PASSIVE_JS_FIELDS, buildPassives, renderPassives } from '../scripts/import-passives.mjs';

// INV-2: パッシブのマスターにも配合（遺伝の確率など）に関する情報を持たせない
test('INV-2: passives.js の各パッシブは許可リストの項目だけを持つ', () => {
  for (const p of passives) assert.deepEqual(Object.keys(p).sort(), [...PASSIVE_JS_FIELDS].sort(), p.id);
  const script = fs.readFileSync('scripts/import-passives.mjs', 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(script, /RandomInheritance|Breeding|breeding\.json/);
});

test('INV-2: passives.csv の列は許可リストどおり', () => {
  const header = fs.readFileSync('data/passives.csv', 'utf8').split(/\r?\n/)[0];
  assert.equal(header, PASSIVE_CSV_COLUMNS.join(','));
});

test('パッシブのマスター: ID は英数字と _ だけで重複せず、日本語名がある', () => {
  const ids = passives.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const p of passives) {
    assert.match(p.id, /^[A-Za-z0-9_]+$/);
    assert.ok(p.ja && p.ja !== '-', p.id);
  }
  assert.ok(passives.length >= 300, `パッシブ数 ${passives.length}`);
  // セーブで実際に見るものは名前を引ける（ゲームの表記と同じ）
  const byId = new Map(passives.map((p) => [p.id, p]));
  assert.equal(byId.get('CraftSpeed_up2').ja, '職人気質');
  assert.equal(byId.get('Rare').ja, '希少');
});

test('buildPassives: 名前のない開発用のものを除き、ランクの高い順に並べる', () => {
  const db = {
    PassiveSkills: [
      { InternalName: 'TestSkill1', Rank: 1, LocalizedNames: { ja: '-', en: 'en Text' } },
      { InternalName: 'Unnamed', Rank: 1, LocalizedNames: null },
      { InternalName: 'B', Rank: 1, LocalizedNames: { ja: 'び', en: 'B' }, IsStandardPassiveSkill: true, LocalizedDescriptions: { ja: '効果\n2 行' }, RandomInheritanceWeight: 5 },
      { InternalName: 'A', Rank: 4, LocalizedNames: { ja: 'え', en: 'A' } },
    ],
  };
  const built = buildPassives(db);
  assert.deepEqual(built, [
    { id: 'A', ja: 'え', en: 'A', rank: 4, std: false, desc: '' },
    { id: 'B', ja: 'び', en: 'B', rank: 1, std: true, desc: '効果 2 行' },
  ]);
  assert.doesNotMatch(renderPassives(built).js, /Weight|Inherit/);
});
