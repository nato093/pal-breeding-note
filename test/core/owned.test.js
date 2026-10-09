import { test } from 'node:test';
import assert from 'node:assert/strict';
import pals from '../../web/data/pals.js';
import passives from '../../web/data/passives.js';
import { buildIndex } from '../../web/js/core/index.js';
import { buildCarrierGraph, shortestRoute } from '../../web/js/core/route.js';
import {
  normalizeOwned, createSpeciesResolver, filterOwned, sortOwned, ownedRows, rowsToCsv, OWNED_COLUMNS,
  ownedRouteStarts, partnerOwnership, ownedBySpecies, passiveCounts, palboxPosition, sharedUpload, ownedFromShared,
  keywordTerms, keywordHits,
} from '../../web/js/core/owned.js';
import { cleanOwnedFarms, validateOwnedUpload, OWNED_FIELDS, OWNED_ADDED_FIELDS, OWNED_MAX_FARMS } from '../../web/js/core/owned-shared.js';

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

test('所持パル: 配合牧場（親が読めたもの）をデータに載せ、共有しても参加している人に届く', () => {
  const farms = [
    { id: 'F1', baseId: BASE, status: 'ok', parents: [{ instanceId: 'b' }, { instanceId: 'c' }], eggs: [] },
    { id: 'F2', baseId: BASE, status: 'uncertain', parents: [{ instanceId: 'a' }], eggs: [] },
    { id: 'F3', baseId: BASE, status: 'ok', parents: [], eggs: [] },
  ];
  const withFarms = normalizeOwned({ ...snapshot, breedFarms: farms }, { pals, passives });
  assert.deepEqual(withFarms.farms, [{ id: 'F1', baseId: BASE, parents: ['b', 'c'] }, { id: 'F3', baseId: BASE, parents: [] }]);
  // 牧場を読む前の解析結果では null（牧場の情報がない。「牧場なし」の [] と区別する）、共有にも載せない
  assert.equal(owned.farms, null);
  assert.equal('farms' in sharedUpload(owned), false);
  assert.deepEqual(normalizeOwned({ ...snapshot, breedFarms: [] }, { pals, passives }).farms, []);
  const upload = sharedUpload(withFarms);
  assert.deepEqual(upload.farms, withFarms.farms);
  // 参加している人は、ワールドの行に入った farms を受け取る（牧場を共有する前のデータにはないので null）
  assert.deepEqual(ownedFromShared({ world: { worldName: 'テスト', farms: upload.farms }, ...upload }, { pals, passives }).farms, withFarms.farms);
  assert.equal(ownedFromShared({ world: { worldName: 'テスト' }, ...upload }, { pals, passives }).farms, null);
});
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
  // パルボックスはページと位置まで出す（SlotIndex 0 は 1 ページ目の左上）
  assert.deepEqual([byId.b.holder, byId.b.placeLabel], ['Bob', 'パルボックス 1 ページ・1 行 1 列']);
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

test('所持パル: キーワードはすべての項目から探し、空白で区切るとすべてを含む個体に絞る（数値は含めない）', () => {
  const list = normalizeOwned({ ...snapshot, pals: [
    pal('a', 'SheepBall', { kind: 'party' }, { passives: ['Rare'], isRare: true, level: 30, skills: ['Unique_SheepBall_Roll', 'AirCanon'] }),
    pal('b', 'BOSS_Kitsunebi', { kind: 'palbox', playerUid: P2, slotIndex: 31 }, { gender: 'Male', skills: ['FireBall'] }),
    pal('c', 'PinkCat', { kind: 'base', playerUid: '', baseId: BASE }, { lastOwnerUid: P2, nickname: 'Tama', skills: ['Unknown_Waza', 'Railbolt'] }),
    pal('d', 'PinkCat', { kind: 'egg-inventory', playerUid: P1 }, { lastOwnerUid: P2 }),
  ] }, { pals, passives }).pals;
  const [a, b, c] = list;
  // 種類で決まる項目（英名・属性・パートナースキル）と、覚えているアクティブスキル（名前の表にないものは ID）
  assert.deepEqual([a.en, a.elements, a.partnerSkill, a.skills, a.skillNames],
    ['Lamball', ['無'], 'モコモコの盾', ['Unique_SheepBall_Roll', 'AirCanon'], ['コロコロモコロン', 'エアーキャノン']]);
  // セーブと名前の表で大文字小文字が違う ID（セーブの Railbolt・表の RailBolt）も名前を引く
  assert.deepEqual([b.elements, b.partnerSkill, b.skillNames, c.skillNames], [['炎'], 'だっこファイヤー', ['ファイアーボール'], ['Unknown_Waza', 'サンダーレール']]);
  const ids = (query) => filterOwned(list, { query }).map((p) => p.id).sort();
  assert.deepEqual(ids('モコロン'), ['a']);
  assert.deepEqual(ids('foxparks'), ['b']);
  assert.deepEqual(ids('炎'), ['b']);
  assert.deepEqual(ids('猫の手'), ['c', 'd']);
  assert.deepEqual(ids('エアーキャノン'), ['a']);
  assert.deepEqual(ids('希少'), ['a']);
  assert.deepEqual(ids('オス'), ['b']);
  assert.deepEqual(ids('♀'), ['a', 'c', 'd']);
  assert.deepEqual(ids('アルファ'), ['b']);
  assert.deepEqual(ids('ラッキー'), ['a']);
  assert.deepEqual(ids('タマゴ'), ['d']);
  assert.deepEqual(ids('パルボックス 2 ページ'), ['b']);
  assert.deepEqual(ids('拠点 2'), ['c']);
  // 預けた人は、一覧に出している拠点の個体だけ探す（タマゴの d は Bob が預けていても出さない）
  assert.deepEqual(ids('Bob'), ['b', 'c']);
  // ひらがなとカタカナ・全角と半角・大文字と小文字の違いはそろえる
  assert.deepEqual(ids('ふぁいあーぼーる'), ['b']);
  assert.deepEqual(ids('ＴＡＭＡ'), ['c']);
  assert.deepEqual(ids('lamball'), ['a']);
  // 空白（全角も）で区切ると、すべてを含む個体に絞る
  assert.deepEqual(ids('無　ラッキー'), ['a']);
  assert.deepEqual(ids('猫の手 拠点'), ['c']);
  assert.deepEqual(ids('炎 ラッキー'), []);
  assert.deepEqual(ids('  '), ['a', 'b', 'c', 'd']);
  // レベル・★・個体値は専用の絞り込みがあるので、キーワードでは探さない
  assert.deepEqual(ids('30'), []);
  // 一致した理由: 語を含む項目の値を項目ごとに返す
  assert.deepEqual(keywordHits(a, keywordTerms('きゃのん モコ')), { name: ['モコロン'], partnerSkill: ['モコモコの盾'], skills: ['コロコロモコロン', 'エアーキャノン'] });
  assert.deepEqual(keywordHits(b, keywordTerms('ファイ')), { partnerSkill: ['だっこファイヤー'], skills: ['ファイアーボール'] });
});

test('所持パル: スキルを読む前に読み込んだセーブ（skills がない）でも、スキルなしとして扱う', () => {
  const old = normalizeOwned({ ...snapshot, pals: [pal('a', 'SheepBall', { kind: 'party' })] }, { pals, passives }).pals[0];
  assert.deepEqual([old.skills, old.skillNames, old.partnerSkill], [[], [], 'モコモコの盾']);
  // 人間のキャラクターには属性もパートナースキルもない
  const human = normalizeOwned({ ...snapshot, pals: [pal('e', 'Male_Soldier01', {})] }, { pals, passives }).pals[0];
  assert.deepEqual([human.en, human.elements, human.partnerSkill], ['', [], '']);
});

test('所持パル共有: 覚えているアクティブスキルを skillIds 列で送り、参加している人も探せる。列のない古いデータはスキルなし', () => {
  const host = normalizeOwned({ ...snapshot, pals: [
    pal('a', 'SheepBall', { kind: 'party' }, { skills: ['Unique_SheepBall_Roll', 'AirCanon'] }),
    pal('b', 'PinkCat', { kind: 'party' }),
  ] }, { pals, passives });
  const upload = sharedUpload(host);
  assert.equal(upload.columns.at(-1), 'skillIds');
  assert.deepEqual(upload.rows.map((row) => row.at(-1)), ['Unique_SheepBall_Roll|AirCanon', '']);
  const shared = ownedFromShared({ world: { worldName: 'テスト' }, ...upload }, { pals, passives });
  assert.deepEqual(shared.pals.map((p) => [p.skills, p.skillNames, p.partnerSkill, p.elements]), [
    [['Unique_SheepBall_Roll', 'AirCanon'], ['コロコロモコロン', 'エアーキャノン'], 'モコモコの盾', ['無']],
    [[], [], '猫の手も借りたい', ['無']],
  ]);
  assert.deepEqual(filterOwned(shared.pals, { query: 'エアーキャノン' }).map((p) => p.id), ['a']);
  // skillIds 列を足す前に共有されたデータ（GAS が列を返さない）
  const width = upload.columns.length - 1;
  const legacy = ownedFromShared({ world: { worldName: 'テスト' }, columns: upload.columns.slice(0, width), rows: upload.rows.map((row) => row.slice(0, width)) }, { pals, passives });
  assert.deepEqual(legacy.pals.map((p) => p.skills), [[], []]);
});

test('所持パル共有: 後から足した列のない古い画面からの共有も受け付け、足りない列は空にする', () => {
  const upload = (columns, rows) => validateOwnedUpload({
    worldId: '4A431AC14B58A7E31A76B2A991F79FE8', world: { name: 'LC9' }, saveUpdatedAt: '2026-10-05T10:00:00.000Z', columns, rows,
  });
  const row = (id, extra = {}) => OWNED_FIELDS.map((field) => (field === 'instanceId' ? id : extra[field] ?? ''));
  const legacyFields = OWNED_FIELDS.slice(0, OWNED_FIELDS.length - OWNED_ADDED_FIELDS.length);
  assert.deepEqual(OWNED_ADDED_FIELDS, ['skillIds']);
  const current = upload(OWNED_FIELDS, [row('p1', { skillIds: 'A|B' })]);
  assert.equal(current.ok, true);
  assert.equal(current.value.rows[0][OWNED_FIELDS.indexOf('skillIds')], 'A|B');
  const legacy = upload(legacyFields, [row('p1').slice(0, legacyFields.length)]);
  assert.equal(legacy.ok, true);
  assert.equal(legacy.value.rows[0].length, OWNED_FIELDS.length);
  assert.equal(legacy.value.rows[0][OWNED_FIELDS.indexOf('skillIds')], '');
  // 列と行の幅が合わない・列の順番が違う・知らない列があるものは受け付けない
  assert.deepEqual(upload(legacyFields, [row('p1')]).errors, [{ field: 'rows', code: 'INVALID_ROWS' }]);
  assert.deepEqual(upload([...legacyFields].reverse(), [row('p1').slice(0, legacyFields.length)]).errors[0], { field: 'columns', code: 'INVALID_COLUMNS' });
  assert.deepEqual(upload([...OWNED_FIELDS, 'extra'], [[...row('p1'), '']]).errors[0], { field: 'columns', code: 'INVALID_COLUMNS' });
  assert.deepEqual(upload(OWNED_FIELDS.slice(0, -2), [row('p1').slice(0, -2)]).errors[0], { field: 'columns', code: 'INVALID_COLUMNS' });
  // スキルの ID はほかの列より長く持てる（ほかの列は 200 字まで）
  const long = upload(OWNED_FIELDS, [row('p1', { skillIds: 'x'.repeat(1200), nickname: 'y'.repeat(300) })]).value.rows[0];
  assert.deepEqual([long[OWNED_FIELDS.indexOf('skillIds')].length, long[OWNED_FIELDS.indexOf('nickname')].length], [1000, 200]);
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

test('所持パル: パルボックスの通し番号から、ページ（30 枠）と行・列（横 6 列）を求め、共有しても残る', () => {
  const at = (index) => { const p = palboxPosition(index); return p && [p.page, p.row, p.column]; };
  // 2026-10-08 にゲーム内で、29 が 1 ページ目の最後、30 が 2 ページ目の最初、59 が 2 ページ目の最後、60 が 3 ページ目の最初と確認
  assert.deepEqual([0, 5, 6, 29, 30, 35, 36, 59, 60, 959].map(at), [
    [1, 1, 1], [1, 1, 6], [1, 2, 1], [1, 5, 6], [2, 1, 1], [2, 1, 6], [2, 2, 1], [2, 5, 6], [3, 1, 1], [32, 5, 6],
  ]);
  assert.equal(palboxPosition(-1), null);
  assert.equal(palboxPosition(undefined), null);
  const owned = normalizeOwned({ ...snapshot, pals: [
    pal('p', 'SheepBall', { kind: 'palbox', slotIndex: 36 }),
    pal('q', 'SheepBall', { kind: 'party', slotIndex: 3 }),
  ] }, { pals, passives });
  assert.deepEqual(owned.pals.map((item) => item.placeLabel), ['パルボックス 2 ページ・2 行 1 列', '手持ち']);
  // 参加している人には、共有の placeLabel でそのまま届く
  const shared = ownedFromShared({ world: { worldName: 'テスト' }, ...sharedUpload(owned) }, { pals, passives });
  assert.deepEqual(shared.pals.map((item) => item.placeLabel), ['パルボックス 2 ページ・2 行 1 列', '手持ち']);
});

test('所持パル共有: 配合牧場は形を確かめ、親が 3 体以上・ID のないもの・形の違うものを捨て、件数を限る', () => {
  const long = 'x'.repeat(50);
  assert.deepEqual(cleanOwnedFarms([
    { id: 'F1', baseId: 'B', parents: ['p1', 'p2'] },
    { id: 'F2', baseId: 'B', parents: ['p1', 'p2', 'p3'] },
    { id: '', baseId: 'B', parents: [] },
    { id: long, baseId: 7, parents: ['p1', 3, ''] },
    null,
    'farm',
  ]), [{ id: 'F1', baseId: 'B', parents: ['p1', 'p2'] }, { id: 'x'.repeat(40), baseId: '7', parents: ['p1'] }]);
  assert.deepEqual(cleanOwnedFarms('F1'), []);
  assert.equal(cleanOwnedFarms(Array.from({ length: OWNED_MAX_FARMS + 5 }, (_, i) => ({ id: `F${i}`, parents: [] }))).length, OWNED_MAX_FARMS);
});
