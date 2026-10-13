import { test } from 'node:test';
import assert from 'node:assert/strict';
import pals from '../../web/data/pals.js';
import passives from '../../web/data/passives.js';
import { buildIndex } from '../../web/js/core/index.js';
import { buildCarrierGraph, shortestRoute } from '../../web/js/core/route.js';
import {
  normalizeOwned, createSpeciesResolver, filterOwned, sortOwned, ownedRows, rowsToCsv, OWNED_COLUMNS,
  ownedRouteStarts, partnerOwnership, ownedBySpecies, passiveCounts, palboxPosition, sharedUpload, ownedFromShared,
  keywordTerms, keywordNotes, speciesGenderCounts, OWNED_SORTS,
} from '../../web/js/core/owned.js';
import { cleanOwnedFarms, validateOwnedUpload, OWNED_FIELDS, OWNED_ADDED_FIELDS, OWNED_MAX_FARMS } from '../../web/js/core/owned-shared.js';

const P1 = '00000000-0000-0000-0000-000000000001';
const P2 = 'abcd1234-0000-0000-0000-000000000000';
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

test('所持パル: 配合牧場を状態つきでデータに載せ（読めない牧場も残す）、共有には読めた牧場だけを今の形で送り、参加している人に届く', () => {
  const farms = [
    { id: 'F1', baseId: BASE, status: 'ok', parents: [{ instanceId: 'b' }, { instanceId: 'c' }], eggs: [] },
    { id: 'F2', baseId: BASE, status: 'uncertain', parents: [{ instanceId: 'a' }], eggs: [] },
    { id: 'F3', baseId: BASE, status: 'ok', parents: [], eggs: [] },
    // 状態のない古い解析結果は ok として扱う
    { id: 'F4', baseId: BASE, parents: [{ instanceId: 'd' }], eggs: [] },
  ];
  const withFarms = normalizeOwned({ ...snapshot, breedFarms: farms }, { pals, passives });
  assert.deepEqual(withFarms.farms, [
    { id: 'F1', baseId: BASE, parents: ['b', 'c'], status: 'ok' },
    // 読めない牧場は、引けた親だけを持って残す（自動登録と親の組の判定には使わない）
    { id: 'F2', baseId: BASE, parents: ['a'], status: 'uncertain' },
    { id: 'F3', baseId: BASE, parents: [], status: 'ok' },
    { id: 'F4', baseId: BASE, parents: ['d'], status: 'ok' },
  ]);
  // 牧場を読む前の解析結果では null（牧場の情報がない。「牧場なし」の [] と区別する）、共有にも載せない
  assert.equal(owned.farms, null);
  assert.equal('farms' in sharedUpload(owned), false);
  assert.deepEqual(normalizeOwned({ ...snapshot, breedFarms: [] }, { pals, passives }).farms, []);
  // 共有には読めた牧場だけを、状態のない今の形で送る（GAS と旧コードの画面は状態を知らず、読めない牧場を普通の牧場として扱うため）
  const upload = sharedUpload(withFarms);
  assert.deepEqual(upload.farms, [
    { id: 'F1', baseId: BASE, parents: ['b', 'c'] }, { id: 'F3', baseId: BASE, parents: [] }, { id: 'F4', baseId: BASE, parents: ['d'] },
  ]);
  assert.ok(upload.farms.every((farm) => !('status' in farm)));
  // 参加している人は、ワールドの行に入った farms を受け取る（状態は ok。牧場を共有する前のデータにはないので null）
  assert.deepEqual(ownedFromShared({ world: { worldName: 'テスト', farms: upload.farms }, ...upload }, { pals, passives }).farms,
    upload.farms.map((farm) => ({ ...farm, status: 'ok' })));
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

test('所持パル: 個体値の合計が高い順・低い順に並べ（同じ合計は図鑑番号順）、低い順は高い順の次の選択肢', () => {
  const list = normalizeOwned({ ...snapshot, pals: [
    pal('mid', 'PinkCat', {}, { talent: { hp: 50, shot: 50, defense: 50 } }),
    pal('top', 'SheepBall', {}, { talent: { hp: 100, shot: 100, defense: 100 } }),
    pal('lo', 'PinkCat', {}, { talent: { hp: 0, shot: 10, defense: 0 } }),
    pal('same', 'SheepBall', {}, { talent: { hp: 60, shot: 40, defense: 50 } }),
  ] }, { pals, passives }).pals;
  // 合計 150 の 2 体は図鑑番号順（モコロン No.1 → ツッパニャン No.2）
  assert.deepEqual(sortOwned(list, 'talent').map((p) => p.id), ['top', 'same', 'mid', 'lo']);
  assert.deepEqual(sortOwned(list, 'talent-low').map((p) => p.id), ['lo', 'same', 'mid', 'top']);
  const keys = OWNED_SORTS.map(([key]) => key);
  assert.equal(keys[keys.indexOf('talent') + 1], 'talent-low');
  assert.deepEqual(OWNED_SORTS.find(([key]) => key === 'talent-low'), ['talent-low', '個体値の合計が低い順']);
});

test('所持パル: キーワードはすべての項目から探し、空白で区切るとすべてを含む個体に絞る（レベル・★・個体値は含めない）', () => {
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
  // レベル・★・個体値は専用の絞り込みがあるので、キーワードでは探さない（a はレベル 30。パッシブの説明の「+15%」などの数値は探す）
  assert.deepEqual(ids('30'), []);
  assert.deepEqual(ids('+15%'), ['a']);
  // 一致した理由: 一覧に出していないスキルは名前で一致したら出す（説明は付けない）。名前や属性など一覧に出ている項目は出さない
  const notes = (item, query) => keywordNotes(item, keywordTerms(query));
  assert.deepEqual(notes(a, 'きゃのん'), [{ label: 'アクティブスキル', name: 'エアーキャノン', desc: '' }]);
  assert.deepEqual(notes(b, 'ファイ').map((note) => [note.label, note.name]), [['アクティブスキル', 'ファイアーボール'], ['パートナースキル', 'だっこファイヤー']]);
  assert.deepEqual(notes(a, '無 ラッキー 希少'), []);
});

test('所持パル: パートナースキル・アクティブスキル・パッシブの説明文でも探し、説明で一致したときは説明を添えて理由に出す', () => {
  const list = normalizeOwned({ ...snapshot, pals: [
    pal('a', 'SheepBall', { kind: 'party' }, { passives: ['Rare', 'CraftSpeed_up2'], skills: ['AirCanon'] }),
    pal('g', 'GhostDragon', { kind: 'party' }, { skills: ['PowerShot'] }),
    pal('h', 'Male_Soldier01', { kind: 'party' }),
  ] }, { pals, passives }).pals;
  const [a, g, h] = list;
  // 説明は、ゲームの表の参照（属性名・パル名など）を名前に置き換え、レベルで変わる数値は ○
  assert.equal(g.partnerSkill, '自由な翼竜');
  assert.equal(g.partnerSkillDesc, '背中に乗って空を飛ぶことができる。このパルの攻撃力と移動速度は、手持ちにいるレイバーン以外の竜属性または闇属性パルの数×○%増加する。');
  assert.equal(a.skillDescs[0], '高速で飛ぶ空気の塊を発射する。');
  assert.deepEqual(a.passiveDescs, ['攻撃 +15% 防御 +15% 作業速度 +20%', '作業速度 +50%']);
  assert.deepEqual([h.partnerSkillDesc, h.skillDescs, h.passiveDescs], ['', [], []]);
  const ids = (query) => filterOwned(list, { query }).map((p) => p.id).sort();
  assert.deepEqual(ids('闇属性'), ['g']);
  assert.deepEqual(ids('空気の塊'), ['a']);
  assert.deepEqual(ids('作業速度'), ['a']);
  assert.deepEqual(ids('盾 作業速度'), ['a']);
  // 説明で一致したときは、名前と説明を出す。パッシブは名前が一覧に出ているので、説明で一致したときだけ出す
  const notes = (item, query) => keywordNotes(item, keywordTerms(query));
  assert.deepEqual(notes(g, '闇属性'), [{ label: 'パートナースキル', name: '自由な翼竜', desc: g.partnerSkillDesc }]);
  assert.deepEqual(notes(a, '作業速度 空気'), [
    { label: 'アクティブスキル', name: 'エアーキャノン', desc: '高速で飛ぶ空気の塊を発射する。' },
    { label: 'パッシブ', name: '希少', desc: '攻撃 +15% 防御 +15% 作業速度 +20%' },
    { label: 'パッシブ', name: '職人気質', desc: '作業速度 +50%' },
  ]);
  assert.deepEqual(notes(a, '職人気質'), []);
  // 名前と説明の両方で一致したときは、説明も添える
  assert.deepEqual(notes(a, 'エアー 空気'), [{ label: 'アクティブスキル', name: 'エアーキャノン', desc: '高速で飛ぶ空気の塊を発射する。' }]);
});

test('所持パル: スキルを読む前に読み込んだセーブ（skills がない）でも、スキルなしとして扱う', () => {
  const old = normalizeOwned({ ...snapshot, pals: [pal('a', 'SheepBall', { kind: 'party' })] }, { pals, passives }).pals[0];
  assert.deepEqual([old.skills, old.skillNames, old.skillDescs, old.partnerSkill], [[], [], [], 'モコモコの盾']);
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
    worldId: 'ABCDEF0123456789ABCDEF0123456789', world: { name: 'World9' }, saveUpdatedAt: '2026-10-05T10:00:00.000Z', columns, rows,
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

test('所持パル共有（読み戻しの検証）: 壊れた値は範囲に収め、個体 ID の重複・パッシブ・人数の上限を守る', () => {
  const row = (id, extra = {}) => OWNED_FIELDS.map((field) => (field === 'instanceId' ? id : extra[field] ?? ''));
  const talents = ['Infinity', '150', '-5', 'abc'];
  const many = Array.from({ length: 20 }, (_, i) => `P${i}`);
  const shared = ownedFromShared({
    world: {
      worldName: 'テスト',
      players: Array.from({ length: 150 }, (_, i) => ({ uid: `u${i}`, name: i === 0 ? '' : `P${i}` })),
      bases: [null, { id: '' }, { id: 'b1', label: '' }],
    },
    columns: OWNED_FIELDS,
    rows: [
      ...talents.map((value, i) => row(`t${i}`, { palId: 'SheepBall', talentHp: value, talentShot: value, talentDefense: value, level: value, rank: value, stars: value })),
      row('t0', { palId: 'PinkCat' }),
      row('m', { palId: 'SheepBall', passiveIds: [...many, 'P0'].join('|'), nickname: 'n'.repeat(80) }),
      null, 'row', row(''), row('x'.repeat(65)),
    ],
  }, { pals, passives });
  const byIdShared = Object.fromEntries(shared.pals.map((p) => [p.id, p]));
  assert.deepEqual(shared.pals.map((p) => p.id), ['t0', 't1', 't2', 't3', 'm']);
  assert.deepEqual(talents.map((_, i) => Object.values(byIdShared[`t${i}`].talent)), [[0, 0, 0], [100, 100, 100], [0, 0, 0], [0, 0, 0]]);
  // レベル 1〜999・ランク 1〜5・★ 0〜4。数にならなければ今までと同じ既定の値
  assert.deepEqual(talents.map((_, i) => [byIdShared[`t${i}`].level, byIdShared[`t${i}`].rank, byIdShared[`t${i}`].stars]), [[1, 1, 0], [150, 5, 4], [1, 1, 0], [1, 1, 0]]);
  // 同じ個体 ID は先の行を使う
  assert.equal(byIdShared.t0.palId, 'SheepBall');
  // パッシブは重複を除き 16 個まで（5 個以上も切り詰めない）
  assert.deepEqual(byIdShared.m.passives, many.slice(0, 16));
  assert.equal(byIdShared.m.nickname.length, 50);
  assert.equal(shared.players.length, 100);
  assert.deepEqual(shared.players[0], { uid: 'u0', name: '不明', level: 0 });
  assert.deepEqual(shared.bases, [{ id: 'b1', label: '拠点' }]);
  // 行・世界が壊れていても落ちない
  assert.deepEqual(ownedFromShared({ world: 'x', columns: OWNED_FIELDS, rows: 'rows' }, { pals, passives }).pals, []);
  assert.deepEqual(ownedFromShared({ world: { players: 'p', bases: 3 }, rows: [] }, { pals, passives }).players, []);
});

test('所持パル（読み戻しの検証）: 手元のセーブの値も範囲に収め、個体 ID のない・重複した個体と壊れた要素を捨てる', () => {
  const list = normalizeOwned({
    ...snapshot,
    players: [null, 'p', { uid: P1, name: 'Alice' }, { name: 'uid なし' }],
    bases: [null, { id: BASE, number: 2, guildId: '', containerId: '', position: null }],
    guilds: 'guilds',
    breedFarms: [null, { id: 'F1', baseId: BASE, status: 'ok', parents: [{ instanceId: 'a' }, null] }],
    pals: [
      pal('a', 'SheepBall', { kind: 'party' }, { talent: { hp: 150, shot: 'Infinity', defense: -5 }, level: 0, rank: 9, passives: ['Rare', 'Rare', 5, '', ...Array.from({ length: 20 }, (_, i) => `P${i}`)] }),
      pal('a', 'PinkCat', { kind: 'party' }),
      pal('', 'PinkCat', { kind: 'party' }),
      { ...pal('b', 'PinkCat', {}), instanceId: undefined },
      null,
      'pal',
      pal('c', 'PinkCat', { kind: 'toString' }, { talent: null, level: '12.7', gender: 'constructor', nickname: 7, skills: 'x' }),
      { ...pal('d', 'PinkCat', {}), location: 'palbox', passives: 'Rare' },
    ],
  }, { pals, passives });
  assert.deepEqual(list.pals.map((p) => p.id), ['a', 'c', 'd']);
  const [a, c, d] = list.pals;
  assert.deepEqual([a.palId, a.talent, a.level, a.rank, a.stars], ['SheepBall', { hp: 100, shot: 0, defense: 0 }, 1, 5, 4]);
  assert.deepEqual(a.passives, ['Rare', ...Array.from({ length: 15 }, (_, i) => `P${i}`)]);
  assert.deepEqual([c.talent, c.level, c.gender, c.nickname, c.skills, c.place], [{ hp: 0, shot: 0, defense: 0 }, 12, '', '', [], 'unknown']);
  assert.deepEqual([d.place, d.passives], ['unknown', []]);
  assert.deepEqual(list.players.map((p) => p.uid), [P1]);
  assert.deepEqual(list.farms, [{ id: 'F1', baseId: BASE, parents: ['a'], status: 'ok' }]);
  // 正しいデータの個体値は今と同じ（欠けている値は 0）
  assert.deepEqual(byId.a.talent, { hp: 1, shot: 2, defense: 3 });
  assert.deepEqual(normalizeOwned({ ...snapshot, pals: [pal('z', 'PinkCat', {}, { talent: {} })] }, { pals, passives }).pals[0].talent, { hp: 0, shot: 0, defense: 0 });
  // 一覧に出すプレイヤーは 100 人まで（所持者の名前は、すべてのプレイヤーから引く）
  const crowd = Array.from({ length: 150 }, (_, i) => ({ uid: `uid-${i}`, name: `プレイヤー${i}`, level: 1 }));
  const big = normalizeOwned({ ...snapshot, players: crowd, pals: [pal('z', 'PinkCat', { kind: 'party', playerUid: 'uid-149' })] }, { pals, passives });
  assert.deepEqual([big.players.length, big.pals[0].holder], [100, 'プレイヤー149']);
  // 文字数の上限: ニックネーム 50・場所 200・所持者 60
  const long = normalizeOwned({ ...snapshot, players: [{ uid: P1, name: 'あ'.repeat(80) }], pals: [pal('z', 'PinkCat', { kind: 'party' }, { nickname: 'n'.repeat(80) })] }, { pals, passives }).pals[0];
  assert.deepEqual([long.nickname.length, long.holder.length], [50, 50]);
});

test('所持パル（読み戻しの検証）: 場所の kind が文字列の列挙値に変換できる配列（["party"]）でも落ちず「不明」にし、正常な個体はそのまま読む', () => {
  const list = normalizeOwned({
    ...snapshot,
    pals: [
      pal('a', 'SheepBall', { kind: ['party'], playerUid: P1 }),
      pal('b', 'PinkCat', { kind: 'party', playerUid: P1 }),
      pal('c', 'PinkCat', { kind: ['egg-ground'], playerUid: P1 }),
      pal('d', 'PinkCat', { kind: { toString: () => 'party' }, playerUid: P1 }),
    ],
  }, { pals, passives });
  assert.deepEqual(list.pals.map((p) => [p.id, p.place, p.egg]), [['a', 'unknown', false], ['b', 'party', false], ['c', 'unknown', false], ['d', 'unknown', false]]);
  assert.equal(list.pals[1].holder, 'Alice');
});

test('所持パル: 種族ごとの性別の数は、タマゴとマスター外（人間など）を数えず、性別の分からない個体は total だけに入れる', () => {
  const counts = speciesGenderCounts(owned.pals);
  // モコロンは a（♀）・b（♂）・c（♀）。ツッパニャンはタマゴの d を数えず、グローバルの f（♀）だけ。タマゴだけのタマコッコは入らない
  assert.deepEqual(counts.get('SheepBall'), { M: 1, F: 2, total: 3 });
  assert.deepEqual(counts.get('PinkCat'), { M: 0, F: 1, total: 1 });
  assert.equal(counts.has('ChickenPal'), false);
  assert.ok(![...counts.keys()].some((id) => !id));
  const unknown = speciesGenderCounts([{ palId: 'SheepBall', gender: '', egg: false }, { palId: 'SheepBall', gender: 'M', egg: false }]);
  assert.deepEqual(unknown.get('SheepBall'), { M: 1, F: 0, total: 2 });
});
