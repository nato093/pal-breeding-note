import { test } from 'node:test';
import assert from 'node:assert/strict';
import pals from '../../web/data/pals.js';
import passives from '../../web/data/passives.js';
import { buildIndex } from '../../web/js/core/index.js';
import { buildCarrierGraph, shortestRoute } from '../../web/js/core/route.js';
import {
  normalizeOwned, createSpeciesResolver, filterOwned, sortOwned, ownedRows, rowsToCsv, OWNED_COLUMNS,
  ownedRouteStarts, partnerOwnership, ownedBySpecies, passiveCounts,
} from '../../web/js/core/owned.js';

const P1 = '00000000-0000-0000-0000-000000000001';
const P2 = '4de16e79-0000-0000-0000-000000000000';
const BASE = 'b6800a4a-4b60-f0bb-f425-53bf17b07603';

function pal(instanceId, characterId, location, extra = {}) {
  return {
    instanceId, source: 'level', characterId, nickname: '', gender: 'Female', level: 10, rank: 1, passives: [],
    talent: { hp: 1, shot: 2, defense: 3 }, isRare: false, ownerUid: '', lastOwnerUid: '',
    location: { kind: 'palbox', playerUid: P1, baseId: '', containerId: '', slotIndex: 0, mapObjectId: '', itemId: '', position: null, ...location },
    ...extra,
  };
}

const snapshot = {
  version: 1,
  world: { name: 'テスト', hostName: 'Alice' },
  players: [{ uid: P1, name: 'Alice', level: 50 }, { uid: P2, name: 'Bob', level: 40 }],
  bases: [{ id: BASE, number: 2, guildId: '', containerId: '', position: null }],
  pals: [
    pal('a', 'SheepBall', { kind: 'party' }, { passives: ['CraftSpeed_up2', 'Rare'], isRare: true, rank: 3 }),
    pal('b', 'BOSS_SheepBall', { kind: 'palbox', playerUid: P2 }, { passives: ['CraftSpeed_up2'], gender: 'Male' }),
    pal('c', 'sheepball', { kind: 'base', playerUid: '', baseId: BASE }, { lastOwnerUid: P2 }),
    pal('d', 'PinkCat', { kind: 'egg-ground', playerUid: P1, baseId: BASE, mapObjectId: 'Palegg' }, { passives: ['CraftSpeed_up2'], level: 1 }),
    pal('e', 'Male_Soldier01', { kind: 'palbox' }),
    pal('f', 'PinkCat', { kind: 'global', playerUid: '' }),
    pal('g', 'ChickenPal', { kind: 'egg-inventory', playerUid: '791f552e-0000-0000-0000-000000000000' }),
  ],
  stats: {},
};

const owned = normalizeOwned(snapshot, { pals, passives });
const byId = Object.fromEntries(owned.pals.map((p) => [p.id, p]));

test('所持パル: CharacterID の接頭辞と大文字小文字の違いを吸収してマスターの ID に直す', () => {
  const resolve = createSpeciesResolver(pals);
  assert.deepEqual(resolve('BOSS_SheepBall'), { palId: 'SheepBall', alpha: true });
  assert.deepEqual(resolve('sheepball'), { palId: 'SheepBall', alpha: false });
  assert.deepEqual(resolve('Male_Soldier01'), { palId: '', alpha: false });
  assert.equal(byId.b.alpha, true);
  assert.equal(byId.e.known, false);
  // 人間のキャラクターは、ゲームから取り出した名前とアイコンを使う
  assert.equal(byId.e.name, '島民');
  assert.equal(byId.e.human.icon, 'T_Male_Soldier01_icon_normal.png');
  const human = normalizeOwned({ ...snapshot, pals: [pal('h', 'BOSS_Believer_CrossBow', {}), pal('x', 'Unknown_Thing', {})] }, { pals, passives });
  assert.deepEqual(human.pals.map((p) => [p.name, p.human?.icon ?? '', p.alpha]), [['賞金首 エゴ', 'T_BOSS_NPC_Believer.png', true], ['Unknown_Thing', '', false]]);
});

test('所持パル: 所持者と場所は入れ物で決め、拠点のタマゴは拠点の持ち物にする', () => {
  assert.deepEqual([byId.a.holder, byId.a.placeLabel], ['Alice', '手持ち']);
  assert.deepEqual([byId.b.holder, byId.b.placeLabel], ['Bob', 'パルボックス']);
  assert.deepEqual([byId.c.holder, byId.c.placeLabel, byId.c.lastOwner], ['拠点 2', '拠点 2', 'Bob']);
  assert.deepEqual([byId.d.holder, byId.d.placeLabel, byId.d.egg, byId.d.level], ['拠点 2', 'タマゴ（地面）・拠点 2', true, 0]);
  // グローバルパルボックスは読み込んだ PC のアカウント（ホスト）のもの
  assert.deepEqual([byId.f.holder, byId.f.placeLabel], ['Alice', 'グローバルパルボックス']);
  assert.equal(byId.g.holder, '不明なプレイヤー（791F552E）');
  assert.deepEqual([byId.a.stars, byId.a.lucky, byId.a.gender, byId.b.gender], [2, true, 'F', 'M']);
  assert.deepEqual(byId.a.passiveNames, ['職人気質', '希少']);
});

test('所持パル: 所持者・場所・パル・パッシブ・キーワードで絞り込む', () => {
  const ids = (filter) => filterOwned(owned.pals, filter).map((p) => p.id).sort();
  assert.deepEqual(ids({ holder: `player:${P1}` }), ['a', 'e']);
  assert.deepEqual(ids({ holder: `base:${BASE}` }), ['c', 'd']);
  assert.deepEqual(ids({ holder: 'global' }), ['f']);
  assert.deepEqual(ids({ place: 'egg' }), ['d', 'g']);
  assert.deepEqual(ids({ palId: 'SheepBall' }), ['a', 'b', 'c']);
  assert.deepEqual(ids({ passives: ['CraftSpeed_up2', 'Rare'] }), ['a']);
  assert.deepEqual(ids({ query: '職人' }), ['a', 'b', 'd']);
  assert.deepEqual(ids({ eggs: false, passives: ['CraftSpeed_up2'] }), ['a', 'b']);
  assert.deepEqual(sortOwned(owned.pals, 'passives').slice(0, 1).map((p) => p.id), ['a']);
  // パル濃縮（★の数）と個体値は下限で絞り込む
  assert.deepEqual(ids({ stars: 2 }), ['a']);
  assert.deepEqual(ids({ stars: 3 }), []);
  assert.deepEqual(ids({ talent: { hp: 1, shot: 2, defense: 3 } }), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  assert.deepEqual(ids({ talent: { defense: 4 } }), []);
  assert.deepEqual(sortOwned(owned.pals, 'stars').slice(0, 1).map((p) => p.id), ['a']);
  assert.equal(passiveCounts(owned.pals).get('CraftSpeed_up2'), 3);
});

test('所持パル: 表計算の行は列名どおりで、式として解釈される文字列を無害にする', () => {
  const rows = ownedRows(owned, { importedAt: '2026-10-05T00:00:00.000Z' });
  assert.equal(rows.length, 7);
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), OWNED_COLUMNS.map(([key]) => key).sort());
  const a = rows.find((row) => row.instanceId === 'a');
  assert.deepEqual([a.passive1, a.passive2, a.passive3, a.passiveIds, a.gender, a.lucky], ['職人気質', '希少', '', 'CraftSpeed_up2|Rare', 'メス', 'はい']);
  const csv = rowsToCsv([{ ...a, nickname: '=HYPERLINK("x")', level: -1 }]);
  const [header, line] = csv.trim().split('\r\n');
  assert.equal(header.split(',')[0], '個体ID');
  assert.match(line, /"'=HYPERLINK\(""x""\)"/);
  assert.match(line, /,-1,/);
});

test('継承ルート: パッシブを持つ所持パルから、登録済みの配合だけで目標への最短経路を探す', () => {
  const records = [
    { id: 'r1', parent1Id: 'SheepBall', parent2Id: 'ChickenPal', childId: 'CuteFox', confirmCount: 1 },
    { id: 'r2', parent1Id: 'CuteFox', parent2Id: 'PinkCat', childId: 'Kitsunebi', confirmCount: 1 },
  ];
  const index = buildIndex(records, pals);
  const graph = buildCarrierGraph(index);
  const starts = ownedRouteStarts({ graph, pals: owned.pals, to: 'Kitsunebi', passives: ['CraftSpeed_up2'], shortestRoute });
  // SheepBall（2 回）と PinkCat（タマゴ、1 回）。経路のないパルは出さない
  assert.deepEqual(starts.map((s) => [s.palId, s.length, s.carriers.map((p) => p.id).sort()]), [
    ['PinkCat', 1, ['d']], ['SheepBall', 2, ['a', 'b']],
  ]);
  assert.deepEqual(ownedRouteStarts({ graph, pals: owned.pals, to: 'PinkCat', passives: [], shortestRoute }).map((s) => [s.palId, s.length]), [['PinkCat', 0]]);
  const bySpecies = ownedBySpecies(owned.pals);
  assert.deepEqual(partnerOwnership(bySpecies, 'SheepBall', ['CraftSpeed_up2']), { total: 3, matching: 2 });
  assert.deepEqual(partnerOwnership(bySpecies, 'PinkCat', []), { total: 1, matching: 0 });
  assert.equal(bySpecies.has(''), false);
});
