import { test } from 'node:test';
import assert from 'node:assert/strict';
import pals from '../../web/data/pals.js';
import passives from '../../web/data/passives.js';
import { buildIndex } from '../../web/js/core/index.js';
import { buildCarrierGraph, shortestRoute } from '../../web/js/core/route.js';
import {
  normalizeOwned, createSpeciesResolver, filterOwned, sortOwned, ownedRows, rowsToCsv, OWNED_COLUMNS,
  ownedRouteStarts, partnerOwnership, ownedBySpecies, canBeParent, ownedCounts, canPairRecord, passiveCounts, palboxPosition, sharedUpload, ownedFromShared,
  keywordTerms, keywordNotes, workEntries, speciesGenderCounts, OWNED_SORTS, sortKey, sortLabel, palboxLabel, parseBoxLabel, eggName, isMutantEgg,
  PLACE_ORDER, PLACE_LABELS, cakeInfo, dpsLabel, boxShort, dpsMissing, ownedContentText,
} from '../../web/js/core/owned.js';
import { palsOfPlayers } from '../../web/js/core/ideal-goals.js';
import { cleanOwnedFarms, validateOwnedUpload, OWNED_FIELDS, OWNED_ADDED_FIELDS, OWNED_MAX_FARMS, OWNED_DPS_GAP_MAX, cleanOwnedPlayer } from '../../web/js/core/owned-shared.js';
import { isParentCandidate } from '../../web/js/core/ideal.js';
import palWork from '../../web/data/work.js';

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

test('所持パル: 配合牧場を状態とタマゴつきでデータに載せ（読めない牧場も残す）、共有には短い鍵で送り（読めない牧場は親を空に）、参加している人に届く', () => {
  const farms = [
    { id: 'F1', baseId: BASE, status: 'ok', parents: [{ instanceId: 'b' }, { instanceId: 'c' }], eggs: [
      { localId: 'e1', characterId: 'SheepBall', itemId: 'PalEgg_Normal_01' },
      { localId: 'e2', characterId: 'BOSS_Anubis', itemId: 'PalEgg_MutationPal_Earth_05' },
      { localId: 'e3', characterId: 'NoSuchPal', itemId: '' },
    ] },
    { id: 'F2', baseId: BASE, status: 'uncertain', parents: [{ instanceId: 'a' }], eggs: [{ localId: 'e4', characterId: 'PinkCat', itemId: 'PalEgg_Normal_01' }] },
    { id: 'F3', baseId: BASE, status: 'ok', parents: [], eggs: [] },
    // 状態とタマゴのない古い解析結果は ok・タマゴ 0 として扱う
    { id: 'F4', baseId: BASE, parents: [{ instanceId: 'd' }] },
  ];
  const withFarms = normalizeOwned({ ...snapshot, breedFarms: farms }, { pals, passives });
  assert.deepEqual(withFarms.farms, [
    { id: 'F1', baseId: BASE, parents: ['b', 'c'], status: 'ok', eggCount: 3, eggs: [
      { id: 'e1', palId: 'SheepBall', mutant: false },
      // 突然変異のタマゴ（PalEgg_MutationPal_*）、中身がマスターにないものは palId ''
      { id: 'e2', palId: 'Anubis', mutant: true }, { id: 'e3', palId: '', mutant: false },
    ], cakes: null },
    // 読めない牧場は、引けた親だけを持って残す（自動登録と親の組の判定には使わない）
    { id: 'F2', baseId: BASE, parents: ['a'], status: 'uncertain', eggCount: 1, eggs: [{ id: 'e4', palId: 'PinkCat', mutant: false }], cakes: null },
    { id: 'F3', baseId: BASE, parents: [], status: 'ok', eggCount: 0, eggs: [], cakes: null },
    // ケーキを読む前の解析結果（cakes がない）は null（分からない。save-extras）
    { id: 'F4', baseId: BASE, parents: ['d'], status: 'ok', eggCount: 0, eggs: [], cakes: null },
  ]);
  assert.deepEqual([withFarms.farmsPartial, withFarms.farmsCounted], [false, true]);
  // 牧場を読む前の解析結果では null（牧場の情報がない。「牧場なし」の [] と区別する）、共有にも載せない
  assert.equal(owned.farms, null);
  assert.equal('farms' in sharedUpload(owned), false);
  assert.deepEqual(normalizeOwned({ ...snapshot, breedFarms: [] }, { pals, passives }).farms, []);
  // 共有は短い鍵（n はタマゴの数、eggs の p は中身・m は突然変異）。読めない牧場は s: 'u' と、どの個体にも当たらない仮の親 2 つ（古い GAS・
  // 旧コードの画面が s を捨てても、置いてある組にも空き牧場にもならない。フェーズ 3 の終わりのレビュー）
  const upload = sharedUpload(withFarms);
  assert.deepEqual(upload.farms, [
    { id: 'F1', baseId: BASE, parents: ['b', 'c'], n: 3, eggs: [{ id: 'e1', p: 'SheepBall' }, { id: 'e2', p: 'Anubis', m: 1 }, { id: 'e3' }] },
    { id: 'F2', baseId: BASE, parents: ['?1', '?2'], s: 'u', n: 1 },
    { id: 'F3', baseId: BASE, parents: [], n: 0, eggs: [] },
    { id: 'F4', baseId: BASE, parents: ['d'], n: 0, eggs: [] },
  ]);
  // 参加している人は、ワールドの行に入った farms を画面の形に戻して受け取る（読めない牧場の中身は送らないので eggs: null）
  const shared = ownedFromShared({ world: { worldName: 'テスト', farms: upload.farms }, ...upload }, { pals, passives });
  assert.deepEqual(shared.farms, [
    withFarms.farms[0],
    { id: 'F2', baseId: BASE, parents: [], status: 'uncertain', eggCount: 1, eggs: null, cakes: null },
    withFarms.farms[2], withFarms.farms[3],
  ]);
  assert.deepEqual([shared.farmsPartial, shared.farmsCounted], [false, true]);
  assert.equal(ownedFromShared({ world: { worldName: 'テスト' }, ...upload }, { pals, passives }).farms, null);
  // 古い形（古い GAS・古いホストの画面。id・baseId・parents だけ）は、タマゴの情報なし（eggs: null・0 個と取り違えない）で、数が分からない形
  const legacy = ownedFromShared({ world: { worldName: 'テスト', farms: [{ id: 'F1', baseId: BASE, parents: ['b', 'c'] }, { id: 'F3', baseId: BASE, parents: [] }] }, ...upload }, { pals, passives });
  assert.deepEqual(legacy.farms.map((farm) => [farm.status, farm.eggs, farm.eggCount]), [['ok', null, 0], ['ok', null, 0]]);
  assert.deepEqual([legacy.farmsPartial, legacy.farmsCounted], [false, false]);
  // 牧場を切った共有（of が受け取った数より多い）は一部だけ
  const cut = ownedFromShared({ world: { worldName: 'テスト', farms: [{ id: 'F1', baseId: BASE, parents: [], n: 0, of: 3 }] }, ...upload }, { pals, passives });
  assert.equal(cut.farmsPartial, true);
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

test('所持パル: 許す個体（所持者）・場所のグループ・パル・パッシブ・キーワードで絞り込む（拠点ごとの絞り込み〔bases〕は D29 でなくした）', () => {
  const ids = (filter) => filterOwned(owned.pals, filter).map((p) => p.id).sort();
  const all = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  assert.deepEqual(ids({}), all);
  // 所持者は画面が作った「許す個体の ID」の Set で絞る（null は絞らない。データにない ID は無視）
  assert.deepEqual(ids({ ids: new Set(['a', 'c', 'zz']) }), ['a', 'c']);
  assert.deepEqual(ids({ ids: null }), all);
  assert.deepEqual(ids({ ids: new Set() }), []);
  // 場所はグループ（タマゴはまとめて egg）。null は絞らない、[]（全部外した）は何も出さない
  assert.deepEqual(ids({ places: ['egg'] }), ['d', 'g']);
  assert.deepEqual(ids({ places: ['party', 'global'] }), ['a', 'f']);
  assert.deepEqual(ids({ places: null }), all);
  assert.deepEqual(ids({ places: [] }), []);
  // 拠点の ID を渡しても絞らない（D29 でなくした）
  assert.deepEqual(ids({ bases: ['ほかの拠点'] }), all);
  assert.deepEqual(ids({ palId: 'SheepBall' }), ['a', 'b', 'c']);
  assert.deepEqual(ids({ passives: ['CraftSpeed_up2', 'Rare'] }), ['a']);
  assert.deepEqual(ids({ query: '職人' }), ['a', 'b', 'd']);
  // 画面が足す文字（目標の印など）もキーワードで一緒に探す（個体の固定の文字とは別に渡す）
  const marks = new Map([['b', ['完成品: モコロンの目標']], ['c', ['モコロンの目標の欲しいパッシブ']]]);
  assert.deepEqual(ids({ query: '完成品', extraTexts: marks }), ['b']);
  assert.deepEqual(ids({ query: 'もころん 目標', extraTexts: marks }), ['b', 'c']);
  assert.deepEqual(ids({ query: '完成品' }), []);
  assert.deepEqual(ids({ places: ['party', 'palbox', 'base', 'dps', 'unknown'], passives: ['CraftSpeed_up2'] }), ['a', 'b']);
  // 良いパッシブ順（ランクの合計）: a は職人気質 3＋希少 4、b・d は職人気質 3（同じ合計は図鑑番号順）
  assert.deepEqual(sortOwned(owned.pals, 'passives').slice(0, 3).map((p) => p.id), ['a', 'b', 'd']);
  // パル濃縮（★の数）と個体値は下限で絞り込む
  assert.deepEqual(ids({ stars: 2 }), ['a']);
  assert.deepEqual(ids({ stars: 3 }), []);
  assert.deepEqual(ids({ talent: { hp: 1, shot: 2, defense: 3 } }), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  assert.deepEqual(ids({ talent: { defense: 4 } }), []);
  assert.deepEqual(sortOwned(owned.pals, 'stars').slice(0, 1).map((p) => p.id), ['a']);
  assert.equal(passiveCounts(owned.pals).get('CraftSpeed_up2'), 3);
});

test('所持パル: パッシブの条件は「全部持つ」「だけ（ほかを持たない）」「なし（パッシブが 0 個。選んだパッシブは見ない）」', () => {
  const ids = (filter) => filterOwned(owned.pals, filter).map((p) => p.id).sort();
  // a: 職人気質・希少、b: 職人気質、d: 職人気質、ほかはパッシブなし
  assert.deepEqual(ids({ passives: ['CraftSpeed_up2'] }), ['a', 'b', 'd']);
  assert.deepEqual(ids({ passives: ['CraftSpeed_up2'], passiveMode: 'include' }), ['a', 'b', 'd']);
  assert.deepEqual(ids({ passives: ['CraftSpeed_up2'], passiveMode: 'only' }), ['b', 'd']);
  assert.deepEqual(ids({ passives: ['Rare', 'CraftSpeed_up2'], passiveMode: 'only' }), ['a']);
  assert.deepEqual(ids({ passives: ['CraftSpeed_up2'], passiveMode: 'none' }), ['c', 'e', 'f', 'g']);
  assert.deepEqual(ids({ passiveMode: 'none' }), ['c', 'e', 'f', 'g']);
});

test('所持パル: 属性はどれかを持つ個体（OR）で絞り込み、属性の名前はマスターの ID（Fire など）で受ける。人間は属性なし', () => {
  const list = normalizeOwned({ ...snapshot, pals: [
    pal('fire', 'Kitsunebi', {}), pal('water', 'Penguin', {}), pal('grass', 'FlowerDoll', {}), pal('human', 'Male_Soldier01', {}),
  ] }, { pals, passives });
  const ids = (elements) => filterOwned(list.pals, { elements }).map((p) => p.id).sort();
  assert.deepEqual(ids([]), ['fire', 'grass', 'human', 'water']);
  assert.deepEqual(ids(['Fire']), ['fire']);
  // 2 つ選ぶと、どちらかを持つ個体（ペンタマは水と氷）
  assert.deepEqual(ids(['Fire', 'Ice']), ['fire', 'water']);
  assert.deepEqual(ids(['Dragon']), []);
});

test('所持パル: 個体値の合計が高い順・低い順に並べ（同じ合計は図鑑番号順）。前の「低い順」の値 talent-low は（talent・asc）に読み替える', () => {
  const list = normalizeOwned({ ...snapshot, pals: [
    pal('mid', 'PinkCat', {}, { talent: { hp: 50, shot: 50, defense: 50 } }),
    pal('top', 'SheepBall', {}, { talent: { hp: 100, shot: 100, defense: 100 } }),
    pal('lo', 'PinkCat', {}, { talent: { hp: 0, shot: 10, defense: 0 } }),
    pal('same', 'SheepBall', {}, { talent: { hp: 60, shot: 40, defense: 50 } }),
  ] }, { pals, passives }).pals;
  // 合計 150 の 2 体は図鑑番号順（モコロン No.1 → ツッパニャン No.2）。向きを変えても、反転するのは最初の比較（合計）だけ
  assert.deepEqual(sortOwned(list, 'talent').map((p) => p.id), ['top', 'same', 'mid', 'lo']);
  assert.deepEqual(sortOwned(list, 'talent', 'asc').map((p) => p.id), ['lo', 'same', 'mid', 'top']);
  assert.deepEqual(sortOwned(list, 'talent-low').map((p) => p.id), ['lo', 'same', 'mid', 'top']);
  assert.deepEqual(sortKey('talent-low'), { key: 'talent', dir: 'asc' });
  assert.deepEqual(sortKey('talent'), { key: 'talent', dir: 'desc' });
  assert.deepEqual(sortKey('hp', 'asc'), { key: 'hp', dir: 'asc' });
  // 知らない値・向きは既定（図鑑番号順・その並べ替えの既定の向き）
  assert.deepEqual(sortKey('passives-count', 'up'), { key: 'dex', dir: 'asc' });
  assert.deepEqual(sortKey('level', 'up'), { key: 'level', dir: 'desc' });
  // 並べ替えは [キー, 既定の向きの名前, 既定の向き, 反対の向きの名前]
  assert.deepEqual(OWNED_SORTS.find(([key]) => key === 'talent'), ['talent', '個体値の合計が高い順', 'desc', '個体値の合計が低い順']);
  assert.deepEqual(OWNED_SORTS.map(([key]) => key), ['dex', 'ownedAt', 'passives', 'level', 'stars', 'talent', 'hp', 'shot', 'defense', 'place']);
  assert.equal(sortLabel('talent', 'asc'), '個体値の合計が低い順');
  assert.equal(sortLabel('hp', 'desc'), 'HP の個体値が高い順');
});

test('所持パル: HP・攻撃・防御の個体値の順、良いパッシブ順（ランクの合計。負のパッシブは引き、マスターにないものは 0）、向きの反転、同じ値なら個体 ID の順', () => {
  const list = normalizeOwned({ ...snapshot, pals: [
    pal('p3', 'PinkCat', {}, { talent: { hp: 80, shot: 10, defense: 50 }, passives: ['CraftSpeed_up2'] }),
    pal('p1', 'SheepBall', {}, { talent: { hp: 20, shot: 90, defense: 50 }, passives: ['Rare', 'CraftSpeed_down1'] }),
    pal('p2', 'SheepBall', {}, { talent: { hp: 50, shot: 50, defense: 90 }, passives: ['NotInMaster', 'Rare'] }),
    pal('p0', 'SheepBall', {}, { talent: { hp: 50, shot: 50, defense: 50 }, passives: [] }),
  ] }, { pals, passives }).pals;
  const order = (key, dir) => sortOwned(list, key, dir).map((p) => p.id);
  assert.deepEqual(order('hp'), ['p3', 'p0', 'p2', 'p1']);
  assert.deepEqual(order('hp', 'asc'), ['p1', 'p0', 'p2', 'p3']);
  assert.deepEqual(order('shot'), ['p1', 'p0', 'p2', 'p3']);
  assert.deepEqual(order('defense'), ['p2', 'p0', 'p1', 'p3']);
  // 希少 4・職人気質 3・不器用 −1。p2 は 4＋0（マスターにない）＝4、p1 は 4−1＝3、p3 は 3（p1 と同じ合計はパッシブの多い p1 が先）
  assert.deepEqual(order('passives'), ['p2', 'p1', 'p3', 'p0']);
  // 反対の向きは最初の比較（ランクの合計）だけを反転し、同じ合計のパッシブの数・図鑑番号の比べ方はそのまま
  assert.deepEqual(order('passives', 'asc'), ['p0', 'p1', 'p3', 'p2']);
  // 同じ値なら最後は個体 ID の順（入力の並びが違っても同じ並び）
  const same = normalizeOwned({ ...snapshot, pals: [pal('z', 'SheepBall', {}), pal('x', 'SheepBall', {}), pal('y', 'SheepBall', {})] }, { pals, passives }).pals;
  for (const [key] of OWNED_SORTS) {
    assert.deepEqual(sortOwned(same, key).map((p) => p.id), ['x', 'y', 'z'], key);
    assert.deepEqual(sortOwned([...same].reverse(), key, 'asc').map((p) => p.id), ['x', 'y', 'z'], key);
  }
});

test('所持パル: ボックス順は所持者 → 場所のグループ → ボックスの位置（ページ・行・列）→ 図鑑番号', () => {
  const list = normalizeOwned({ ...snapshot, pals: [
    pal('b-box-2', 'SheepBall', { kind: 'palbox', playerUid: P2, slotIndex: 31 }),
    pal('a-box-p2', 'SheepBall', { kind: 'palbox', playerUid: P1, slotIndex: 30 }),
    pal('a-party', 'PinkCat', { kind: 'party', playerUid: P1 }),
    pal('a-box-p1-r2', 'PinkCat', { kind: 'palbox', playerUid: P1, slotIndex: 6 }),
    pal('a-box-p1-c2', 'PinkCat', { kind: 'palbox', playerUid: P1, slotIndex: 1 }),
    pal('b-box-1', 'SheepBall', { kind: 'palbox', playerUid: P2, slotIndex: 0 }),
  ] }, { pals, passives }).pals;
  assert.deepEqual(sortOwned(list, 'place').map((p) => p.id), ['a-party', 'a-box-p1-c2', 'a-box-p1-r2', 'a-box-p2', 'b-box-1', 'b-box-2']);
  assert.deepEqual(sortOwned(list, 'place', 'desc').map((p) => p.id), ['b-box-2', 'b-box-1', 'a-box-p2', 'a-box-p1-r2', 'a-box-p1-c2', 'a-party']);
});

test('所持パル: パルボックスの位置（box）はセーブの通し番号と共有の placeLabel で同じになり、placeLabel の書式と parseBoxLabel が往復する', () => {
  const local = normalizeOwned({ ...snapshot, pals: [
    pal('p0', 'SheepBall', { kind: 'palbox', slotIndex: 0 }),
    pal('p36', 'SheepBall', { kind: 'palbox', slotIndex: 36 }),
    pal('party', 'SheepBall', { kind: 'party', slotIndex: 3 }),
    pal('base', 'SheepBall', { kind: 'base', playerUid: '', baseId: BASE }),
    pal('nobox', 'SheepBall', { kind: 'palbox', slotIndex: undefined }),
  ] }, { pals, passives });
  assert.deepEqual(local.pals.map((item) => item.box), [{ page: 1, row: 1, column: 1 }, { page: 2, row: 2, column: 1 }, null, null, null]);
  const shared = ownedFromShared({ world: { worldName: 'テスト' }, ...sharedUpload(local) }, { pals, passives });
  assert.deepEqual(shared.pals.map((item) => item.box), local.pals.map((item) => item.box));
  // 書式（palboxLabel）と読み取り（parseBoxLabel）は往復する。書式を変えると共有から位置が読めなくなる
  for (const index of [0, 5, 29, 30, 959]) {
    const position = palboxPosition(index);
    assert.equal(palboxLabel(position), `パルボックス ${position.page} ページ・${position.row} 行 ${position.column} 列`);
    assert.deepEqual(parseBoxLabel(palboxLabel(position)), position);
  }
  // 古い共有（位置のない「パルボックス」）・形の違う文字・範囲の外の値は null（文字だけを出す）
  for (const label of ['パルボックス', 'パルボックス 2 ページ', 'パルボックス 0 ページ・1 行 1 列', 'パルボックス 1 ページ・6 行 1 列', 'パルボックス 1 ページ・1 行 7 列', ' パルボックス 1 ページ・1 行 1 列', null, 3]) {
    assert.equal(parseBoxLabel(label), null, String(label));
  }
  const old = ownedFromShared({ world: { worldName: 'テスト' }, columns: OWNED_FIELDS, rows: [
    OWNED_FIELDS.map((field) => ({ instanceId: 'old', palId: 'SheepBall', place: 'palbox', placeLabel: 'パルボックス' })[field] ?? ''),
  ] }, { pals, passives });
  assert.deepEqual([old.pals[0].box, old.pals[0].placeLabel], [null, 'パルボックス']);
});

test('所持パル: パル次元ストレージの位置（box）も添字から求め、placeLabel・短い表記・共有の読み戻しはパルボックスと分ける', () => {
  // 2026-10-12 に実セーブで確かめた位置（次元ストレージの添字 → ページ・行・列）
  const local = normalizeOwned({ ...snapshot, pals: [
    pal('d0', 'SheepBall', { kind: 'dps', slotIndex: 0 }),
    pal('d55', 'SheepBall', { kind: 'dps', slotIndex: 55 }),
    pal('d77', 'SheepBall', { kind: 'dps', slotIndex: 77 }),
    pal('d7820', 'SheepBall', { kind: 'dps', slotIndex: 7820 }),
    pal('dnone', 'SheepBall', { kind: 'dps', slotIndex: undefined }),
    pal('box', 'SheepBall', { kind: 'palbox', slotIndex: 55 }),
  ] }, { pals, passives });
  assert.deepEqual(local.pals.map((item) => item.box && [item.box.page, item.box.row, item.box.column]), [[1, 1, 1], [2, 5, 2], [3, 3, 6], [261, 4, 3], null, [2, 5, 2]]);
  assert.deepEqual(local.pals.map((item) => item.placeLabel), [
    'パル次元ストレージ 1 ページ・1 行 1 列', 'パル次元ストレージ 2 ページ・5 行 2 列', 'パル次元ストレージ 3 ページ・3 行 6 列',
    'パル次元ストレージ 261 ページ・4 行 3 列', 'パル次元ストレージ', 'パルボックス 2 ページ・5 行 2 列',
  ]);
  // 所持者は次元ストレージの持ち主のまま
  assert.deepEqual(local.pals.map((item) => item.holder), ['Alice', 'Alice', 'Alice', 'Alice', 'Alice', 'Alice']);
  // 短い表記は、次元ストレージだけ頭に「次元 」（位置が分からなければ空）
  assert.deepEqual(local.pals.map(boxShort), ['次元 P1 · 1-1', '次元 P2 · 5-2', '次元 P3 · 3-6', '次元 P261 · 4-3', '', 'P2 · 5-2']);
  assert.equal(boxShort(byId.a), '');
  assert.equal(boxShort(null), '');
  // 参加者の画面は placeLabel の文字から位置を読み戻す（パルボックスと同じ）
  const shared = ownedFromShared({ world: { worldName: 'テスト' }, ...sharedUpload(local) }, { pals, passives });
  assert.deepEqual(shared.pals.map((item) => item.box), local.pals.map((item) => item.box));
  assert.deepEqual(shared.pals.map((item) => item.placeLabel), local.pals.map((item) => item.placeLabel));
  // パルボックスの書式は変えない（共有の互換。古い画面も同じ書式で位置を読む）
  assert.equal(palboxLabel({ page: 2, row: 5, column: 2 }), 'パルボックス 2 ページ・5 行 2 列');
  assert.deepEqual(parseBoxLabel('パルボックス 2 ページ・5 行 2 列'), { page: 2, row: 5, column: 2 });
  // 書式（dpsLabel）と読み取り（parseBoxLabel の 'dps'）は往復し、場所が違えば読まない（パルボックスの文字を次元ストレージとして読まない・逆も）
  for (const index of [0, 55, 77, 7820]) {
    const position = palboxPosition(index);
    assert.equal(dpsLabel(position), `パル次元ストレージ ${position.page} ページ・${position.row} 行 ${position.column} 列`);
    assert.deepEqual(parseBoxLabel(dpsLabel(position), 'dps'), position);
    assert.equal(parseBoxLabel(dpsLabel(position)), null);
    assert.equal(parseBoxLabel(dpsLabel(position), 'palbox'), null);
    assert.equal(parseBoxLabel(palboxLabel(position), 'dps'), null);
    for (const kind of ['party', 'base', 'global', 'unknown', 'toString', '']) assert.equal(parseBoxLabel(dpsLabel(position), kind), null, kind);
  }
  // 形の違う文字・範囲の外の値は null
  for (const label of ['パル次元ストレージ', 'パル次元ストレージ 2 ページ', 'パル次元ストレージ 0 ページ・1 行 1 列', 'パル次元ストレージ 1 ページ・6 行 1 列',
    'パル次元ストレージ 1 ページ・1 行 7 列', 'パル次元ストレージ 10000 ページ・1 行 1 列', null]) {
    assert.equal(parseBoxLabel(label, 'dps'), null, String(label));
  }
  // 古い共有（位置のない「パル次元ストレージ」）は位置なしで、文字だけを出す
  const old = ownedFromShared({ world: { worldName: 'テスト' }, columns: OWNED_FIELDS, rows: [
    OWNED_FIELDS.map((field) => ({ instanceId: 'old', palId: 'SheepBall', place: 'dps', placeLabel: 'パル次元ストレージ' })[field] ?? ''),
    // 場所が dps 以外なのに次元ストレージの位置の文字（壊れた行）は位置を読まない
    OWNED_FIELDS.map((field) => ({ instanceId: 'odd', palId: 'SheepBall', place: 'base', placeLabel: 'パル次元ストレージ 1 ページ・1 行 1 列' })[field] ?? ''),
  ] }, { pals, passives });
  assert.deepEqual(old.pals.map((item) => [item.box, item.placeLabel, boxShort(item)]), [
    [null, 'パル次元ストレージ', ''], [null, 'パル次元ストレージ 1 ページ・1 行 1 列', ''],
  ]);
});

test('所持パル: ボックス順で、パル次元ストレージも位置の順に並び、パルボックスとは混ざらない（所持者 → 場所 → 位置）', () => {
  const list = normalizeOwned({ ...snapshot, pals: [
    pal('a-dps-p2', 'SheepBall', { kind: 'dps', playerUid: P1, slotIndex: 30 }),
    pal('a-box-p3', 'SheepBall', { kind: 'palbox', playerUid: P1, slotIndex: 60 }),
    pal('a-dps-r2', 'PinkCat', { kind: 'dps', playerUid: P1, slotIndex: 6 }),
    pal('a-dps-none', 'PinkCat', { kind: 'dps', playerUid: P1, slotIndex: undefined }),
    pal('a-box-p1', 'PinkCat', { kind: 'palbox', playerUid: P1, slotIndex: 0 }),
    pal('a-dps-c1', 'PinkCat', { kind: 'dps', playerUid: P1, slotIndex: 0 }),
    pal('b-dps-1', 'SheepBall', { kind: 'dps', playerUid: P2, slotIndex: 1 }),
    pal('a-base', 'SheepBall', { kind: 'base', playerUid: '', baseId: BASE }),
  ] }, { pals, passives }).pals;
  // 拠点 2（所持者は拠点）→ Alice（パルボックス → 次元ストレージ。位置のない個体はグループの最後）→ Bob
  assert.deepEqual(sortOwned(list, 'place').map((p) => p.id), ['a-box-p1', 'a-box-p3', 'a-dps-c1', 'a-dps-r2', 'a-dps-p2', 'a-dps-none', 'b-dps-1', 'a-base']);
  assert.deepEqual(sortOwned(list, 'place', 'desc').map((p) => p.id), ['a-base', 'b-dps-1', 'a-dps-none', 'a-dps-p2', 'a-dps-r2', 'a-dps-c1', 'a-box-p3', 'a-box-p1']);
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
  // 一致した理由: 語ごとに、どの項目のどの値に一致したかを必ず出す（D29。前は一覧に出していないスキル・説明だけで、名前・属性など一覧に出ている
  // 項目で一致したときは何も出さなかった）。名前で一致したら説明は付けない
  const notes = (item, query, extra) => keywordNotes(item, keywordTerms(query), extra);
  const short = (list) => list.map((note) => `${note.label}：${note.name}${note.desc ? `（${note.desc}）` : ''}`);
  assert.deepEqual(notes(a, 'きゃのん'), [{ label: 'アクティブスキル', name: 'エアーキャノン', desc: '' }]);
  // 1 つの語の中の並びは パル名・ニックネーム・属性・性別・特徴・パッシブ・パートナースキル・アクティブスキル・所持者・場所・預けた人・目標の印
  assert.deepEqual(short(notes(b, 'ファイ')), ['パートナースキル：だっこファイヤー', 'アクティブスキル：ファイアーボール']);
  // 空白で区切った語は、語の順に（見えている所に出ている項目でも出す）
  assert.deepEqual(short(notes(a, '無 ラッキー 希少')), ['属性：無', '特徴：ラッキー', 'パッシブ：希少']);
  // スキルの名前と説明の両方に当たったときは説明も添える
  const roll = `アクティブスキル：コロコロモコロン（モコロンの専用スキル。コロコロと転がりながら、敵を追いかける。攻撃後は目が回って動けなくなってしまう。）`;
  assert.deepEqual(short(notes(a, 'モコロン')), ['パル名：モコロン', roll]);
  assert.deepEqual(short(notes(b, 'foxparks')), ['パル名：Foxparks']);
  assert.deepEqual(short(notes(b, 'オス bob アルファ')), ['性別：オス', '所持者：Bob', '特徴：アルファ']);
  assert.deepEqual(short(notes(b, 'パルボックス')), ['場所：パルボックス 2 ページ・1 行 2 列']);
  assert.deepEqual(short(notes(c, 'tama')), ['ニックネーム：Tama']);
  // 拠点の個体は所持者の欄にも拠点の名前が入る。場所と同じ値なら場所として 1 回だけ出す。預けた人も出す
  assert.deepEqual(short(notes(c, '拠点 bob')), ['場所：拠点 2', '預けた人：Bob']);
  // 画面が足す文字（目標の印）も、一致したものだけ
  assert.deepEqual(short(notes(a, '完成品', ['完成品: モコロンの目標', 'ほかの目標の欲しいパッシブ'])), ['目標の印：完成品: モコロンの目標']);
  // 同じ項目に 2 つの語が当たっても 1 回だけ（「モコ」はパートナースキルにも当たる）
  assert.deepEqual(short(notes(a, 'モコ ロン')), ['パル名：モコロン', 'パートナースキル：モコモコの盾', roll]);
  // どこにも当たらない語は理由なし（絞り込みで外れる）
  assert.deepEqual(notes(a, 'ぬぬぬ'), []);
  assert.deepEqual(notes(a, ''), []);
});

test('所持パル: パートナースキル・アクティブスキル・パッシブの説明文でも探し、説明で一致したときは説明を添えて理由に出す（パッシブの名前で一致したときも出す。D29）', () => {
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
  // 説明で一致したときは、名前と説明を出す（語の順に。1 つの語の中はパッシブ・パートナースキル・アクティブスキルの順）
  const notes = (item, query) => keywordNotes(item, keywordTerms(query));
  assert.deepEqual(notes(g, '闇属性'), [{ label: 'パートナースキル', name: '自由な翼竜', desc: g.partnerSkillDesc }]);
  assert.deepEqual(notes(a, '作業速度 空気'), [
    { label: 'パッシブ', name: '希少', desc: '攻撃 +15% 防御 +15% 作業速度 +20%' },
    { label: 'パッシブ', name: '職人気質', desc: '作業速度 +50%' },
    { label: 'アクティブスキル', name: 'エアーキャノン', desc: '高速で飛ぶ空気の塊を発射する。' },
  ]);
  // パッシブの名前で一致したときも出す（前は一覧に出ているので出さなかった）
  assert.deepEqual(notes(a, '職人気質'), [{ label: 'パッシブ', name: '職人気質', desc: '' }]);
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
  const skillAt = upload.columns.indexOf('skillIds');
  // skillIds は後から足した最初の列
  assert.deepEqual(OWNED_FIELDS.slice(skillAt), OWNED_ADDED_FIELDS);
  assert.deepEqual(upload.rows.map((row) => row[skillAt]), ['Unique_SheepBall_Roll|AirCanon', '']);
  const shared = ownedFromShared({ world: { worldName: 'テスト' }, ...upload }, { pals, passives });
  assert.deepEqual(shared.pals.map((p) => [p.skills, p.skillNames, p.partnerSkill, p.elements]), [
    [['Unique_SheepBall_Roll', 'AirCanon'], ['コロコロモコロン', 'エアーキャノン'], 'モコモコの盾', ['無']],
    [[], [], '猫の手も借りたい', ['無']],
  ]);
  assert.deepEqual(filterOwned(shared.pals, { query: 'エアーキャノン' }).map((p) => p.id), ['a']);
  // skillIds 列を足す前に共有されたデータ（GAS が列を返さない。その後に足した eggItemId 列もない）
  const width = skillAt;
  const legacy = ownedFromShared({ world: { worldName: 'テスト' }, columns: upload.columns.slice(0, width), rows: upload.rows.map((row) => row.slice(0, width)) }, { pals, passives });
  assert.deepEqual(legacy.pals.map((p) => p.skills), [[], []]);
});

test('所持パル共有: 後から足した列のない古い画面からの共有も受け付け、足りない列は空にする', () => {
  const upload = (columns, rows) => validateOwnedUpload({
    worldId: 'ABCDEF0123456789ABCDEF0123456789', world: { name: 'World9' }, saveUpdatedAt: '2026-10-05T10:00:00.000Z', columns, rows,
  });
  const row = (id, extra = {}) => OWNED_FIELDS.map((field) => (field === 'instanceId' ? id : extra[field] ?? ''));
  const legacyFields = OWNED_FIELDS.slice(0, OWNED_FIELDS.length - OWNED_ADDED_FIELDS.length);
  assert.deepEqual(OWNED_ADDED_FIELDS, ['skillIds', 'eggItemId', 'ownedAt', 'soul', 'condition']);
  const upTo = (field) => OWNED_FIELDS.indexOf(field) + 1;
  // skillIds だけを知っている画面（eggItemId を足す前の版）・eggItemId までを知っている画面（ownedAt を足す前の版。save-extras）・ownedAt までを
  // 知っている画面（soul・condition を足す前の版 12 の画面。server の share-extras）からの共有も受け付ける
  const withSkills = upload(OWNED_FIELDS.slice(0, upTo('skillIds')), [row('p1', { skillIds: 'A' }).slice(0, upTo('skillIds'))]);
  assert.equal(withSkills.ok, true);
  assert.deepEqual(withSkills.value.rows[0].slice(upTo('skillIds') - 1), ['A', '', '', '', '']);
  const withEggs = upload(OWNED_FIELDS.slice(0, upTo('eggItemId')), [row('p1', { eggItemId: 'PalEgg_Fire_01' }).slice(0, upTo('eggItemId'))]);
  assert.equal(withEggs.ok, true);
  assert.deepEqual(withEggs.value.rows[0].slice(upTo('eggItemId') - 1), ['PalEgg_Fire_01', '', '', '']);
  const withOwnedAt = upload(OWNED_FIELDS.slice(0, upTo('ownedAt')), [row('p1', { ownedAt: '2026-10-15T12:52:16.570Z' }).slice(0, upTo('ownedAt'))]);
  assert.equal(withOwnedAt.ok, true);
  assert.deepEqual(withOwnedAt.value.rows[0].slice(upTo('ownedAt') - 1), ['2026-10-15T12:52:16.570Z', '', '']);
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
  // 後から足す前の 26 列より狭いものも受け付けない
  const short = legacyFields.length - 1;
  assert.deepEqual(upload(OWNED_FIELDS.slice(0, short), [row('p1').slice(0, short)]).errors[0], { field: 'columns', code: 'INVALID_COLUMNS' });
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
  // SheepBall（2 回）。PinkCat はタマゴ（d）なので運び手にしない（親にできる個体だけ。R-15）。経路のないパルは出さない
  assert.deepEqual(starts.map((s) => [s.palId, s.length, s.carriers.map((p) => p.id).sort()]), [
    ['SheepBall', 2, ['a', 'b']],
  ]);
  // PinkCat はタマゴ（d）とグローバルパルボックス（f）だけなので、目標そのものでも候補にしない
  assert.deepEqual(ownedRouteStarts({ graph, pals: owned.pals, to: 'PinkCat', passives: [], shortestRoute }), []);
  assert.deepEqual(ownedRouteStarts({ graph, pals: owned.pals, to: 'SheepBall', passives: [], shortestRoute }).map((s) => [s.palId, s.length]), [['SheepBall', 0]]);
  const bySpecies = ownedBySpecies(owned.pals);
  assert.deepEqual(partnerOwnership(bySpecies, 'SheepBall', ['CraftSpeed_up2']), { total: 3, matching: 2 });
  // 相手親もタマゴ・グローバルパルボックスの個体は数えない（前はグローバルを数えて 1）
  assert.deepEqual(partnerOwnership(bySpecies, 'PinkCat', []), { total: 0, matching: 0 });
  assert.equal(bySpecies.has(''), false);
});

test('継承ルート: 開始の候補の並びは手数・パッシブの多い個体・個体数が同じなら図鑑順（palOrder。前は ID の文字列順。F030）', () => {
  const records = [
    { id: 'r1', parent1Id: 'SheepBall', parent2Id: 'ChickenPal', childId: 'CuteFox', confirmCount: 1 },
    { id: 'r2', parent1Id: 'PinkCat', parent2Id: 'ChickenPal', childId: 'CuteFox', confirmCount: 1 },
  ];
  const index = buildIndex(records, pals);
  const graph = buildCarrierGraph(index);
  const carrier = (id, palId) => ({ id, palId, passives: ['Rare'], egg: false, place: 'palbox', level: 1 });
  const input = { graph, pals: [carrier('p', 'PinkCat'), carrier('s', 'SheepBall')], to: 'CuteFox', passives: ['Rare'], shortestRoute };
  // 図鑑はモコロン（No.1）→ ツッパニャン（No.2）。ID の文字列順なら PinkCat が先
  assert.deepEqual(ownedRouteStarts({ ...input, palOrder: index.palOrder }).map((start) => start.palId), ['SheepBall', 'PinkCat']);
  // palOrder を渡さなければ前のとおり ID の順
  assert.deepEqual(ownedRouteStarts(input).map((start) => start.palId), ['PinkCat', 'SheepBall']);
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
  assert.deepEqual(shared.players[0], { uid: 'u0', name: '不明', level: 0, online: null });
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
  assert.deepEqual(list.farms, [{ id: 'F1', baseId: BASE, parents: ['a'], status: 'ok', eggs: [], eggCount: 0, cakes: null }]);
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

test('所持の集計: 親にできる個体（タマゴ・グローバルパルボックス・マスター外を除く）は理想個体の isParentCandidate と同じ規則で、種族ごとに性別の数を数える', () => {
  // 親にできるか: 理想個体（core/ideal.js）と同じ結果（INV-2 の制限で core/owned.js は core/ideal.js を読まないので、テストで突き合わせる）
  for (const pal of owned.pals) {
    if (!pal.palId) { assert.equal(canBeParent(pal), false, pal.id); continue; }
    assert.equal(canBeParent(pal), isParentCandidate(pal), pal.id);
  }
  assert.deepEqual(owned.pals.filter(canBeParent).map((pal) => pal.id).sort(), ['a', 'b', 'c']);
  const counts = ownedCounts(owned.pals);
  assert.deepEqual(counts.get('SheepBall'), { total: 3, eggs: 0, globals: 0, male: 1, female: 2, unknown: 0 });
  assert.deepEqual(counts.get('PinkCat'), { total: 2, eggs: 1, globals: 1, male: 0, female: 0, unknown: 0 });
  assert.deepEqual(counts.get('ChickenPal'), { total: 1, eggs: 1, globals: 0, male: 0, female: 0, unknown: 0 });
  // マスター外（人間）は数えない
  assert.equal([...counts.keys()].includes(''), false);
  assert.equal(counts.size, 3);
  // 性別の分からない個体は unknown（親にはできるが ♂♀ の組には数えない）
  assert.deepEqual(ownedCounts([{ palId: 'Alpaca', gender: '', egg: false, place: 'palbox' }]).get('Alpaca'), { total: 1, eggs: 0, globals: 0, male: 0, female: 0, unknown: 1 });
  assert.equal(ownedCounts(null).size, 0);
});

test('所持の集計: 記録の両親を今の所持で組めるか（別々の個体の ♂ と ♀。記録の性別があればその向きだけ、空欄なら両方の向き）', () => {
  const counts = new Map([
    ['A', { total: 2, eggs: 0, globals: 0, male: 1, female: 1, unknown: 0 }],
    ['M', { total: 1, eggs: 0, globals: 0, male: 1, female: 0, unknown: 0 }],
    ['F', { total: 1, eggs: 0, globals: 0, male: 0, female: 1, unknown: 0 }],
    ['E', { total: 3, eggs: 2, globals: 1, male: 0, female: 0, unknown: 0 }],
  ]);
  const record = (parent1Id, parent2Id, parent1Gender = '', parent2Gender = '') => ({ parent1Id, parent2Id, parent1Gender, parent2Gender, childId: 'X' });
  // 同じ種族どうしは ♂ と ♀ が 1 体ずつ
  assert.equal(canPairRecord(counts, record('A', 'A')), true);
  assert.equal(canPairRecord(counts, record('M', 'M')), false);
  // 違う種族で性別なし: どちらかの向きで組めればよい
  assert.equal(canPairRecord(counts, record('M', 'F')), true);
  assert.equal(canPairRecord(counts, record('F', 'M')), true);
  assert.equal(canPairRecord(counts, record('M', 'M2')), false);
  // 性別あり: その向きだけ
  assert.equal(canPairRecord(counts, record('M', 'F', 'M', 'F')), true);
  assert.equal(canPairRecord(counts, record('M', 'F', 'F', 'M')), false);
  assert.equal(canPairRecord(counts, record('M', 'F', 'M', '')), true);
  assert.equal(canPairRecord(counts, record('M', 'F', '', 'M')), false);
  assert.equal(canPairRecord(counts, record('A', 'M', 'F', '')), true);
  // 両親が同じ性別の記録（不正）は組めない
  assert.equal(canPairRecord(counts, record('A', 'A', 'M', 'M')), false);
  assert.equal(canPairRecord(counts, record('M', 'F', 'M', 'M')), false);
  // タマゴ・グローバルパルボックスだけの種族は組めない
  assert.equal(canPairRecord(counts, record('E', 'A')), false);
  assert.equal(canPairRecord(new Map(), record('A', 'A')), false);
});

test('所持パル（配合牧場ボード）: 牧場の親と牧場の上のタマゴに印（farm）、タマゴのアイテム ID（eggItemId）と名前、キーワード「配合牧場」「突然変異」・タマゴの名前で探せ、共有でも往復する', () => {
  const eggs = [
    pal('egg1', 'SheepBall', { kind: 'egg-ground', playerUid: '', baseId: BASE, itemId: 'PalEgg_Dark_03' }),
    pal('egg2', 'PinkCat', { kind: 'egg-ground', playerUid: '', baseId: BASE, itemId: 'paleGG_mutationPal_01' }),
  ];
  const host = normalizeOwned({ ...snapshot, pals: [...snapshot.pals, ...eggs], breedFarms: [
    { id: 'F1', baseId: BASE, status: 'ok', parents: [{ instanceId: 'a' }, { instanceId: 'b' }], eggs: [
      { localId: 'egg1', characterId: 'SheepBall', itemId: 'PalEgg_Dark_03' }, { localId: 'egg2', characterId: 'PinkCat', itemId: 'paleGG_mutationPal_01' },
    ] },
  ] }, { pals, passives });
  const byIdOf = (data) => Object.fromEntries(data.pals.map((p) => [p.id, p]));
  const own = byIdOf(host);
  assert.deepEqual(own.a.farm, { id: 'F1', baseId: BASE, role: 'parent', mutant: false });
  assert.deepEqual(own.egg2.farm, { id: 'F1', baseId: BASE, role: 'egg', mutant: true });
  assert.equal(own.c.farm, null);
  // タマゴのアイテム ID（タマゴでない個体は空）と名前（大文字小文字は違っても引ける。表にない ID は空）
  assert.deepEqual([own.egg1.eggItemId, own.a.eggItemId], ['PalEgg_Dark_03', '']);
  assert.equal(eggName('PalEgg_Dark_03'), '暗黒デカタマゴ');
  assert.equal(eggName('paleGG_mutationPal_01'), '突然変異タマゴ');
  assert.equal(eggName('NoSuchEgg'), '');
  assert.deepEqual([isMutantEgg(own.egg1), isMutantEgg(own.egg2), isMutantEgg(own.a)], [false, true, false]);
  const ids = (data, query) => filterOwned(data.pals, { query }).map((p) => p.id).sort();
  assert.deepEqual(ids(host, '配合牧場'), ['a', 'b', 'egg1', 'egg2']);
  assert.deepEqual(ids(host, '突然変異'), ['egg2']);
  assert.deepEqual(ids(host, 'デカタマゴ'), ['egg1']);
  // 共有: eggItemId の列で往復し、牧場の印も付く
  const upload = sharedUpload(host);
  const shared = ownedFromShared({ world: { worldName: 'テスト', farms: upload.farms }, ...upload }, { pals, passives });
  const theirs = byIdOf(shared);
  assert.deepEqual([theirs.egg1.eggItemId, theirs.egg2.farm?.role, isMutantEgg(theirs.egg2)], ['PalEgg_Dark_03', 'egg', true]);
  assert.deepEqual(ids(shared, '配合牧場'), ['a', 'b', 'egg1', 'egg2']);
  // eggItemId の列のない共有（GAS の setup() の前・前の版の画面）では空。牧場の中身を省いた共有では、タマゴに牧場の印は付かない
  const width = OWNED_FIELDS.indexOf('eggItemId');
  const legacy = byIdOf(ownedFromShared({ world: { worldName: 'テスト', farms: [{ id: 'F1', baseId: BASE, parents: ['a', 'b'], n: 2 }] },
    columns: upload.columns.slice(0, width), rows: upload.rows.map((row) => row.slice(0, width)) }, { pals, passives }));
  assert.deepEqual([legacy.egg1.eggItemId, legacy.egg1.farm, legacy.a.farm?.role], ['', null, 'parent']);
});

// game-assets: 作業適性（web/data/work.js。ゲーム本体の表）を種族から引き、キーワードで探す。「採掘3」は採掘 Lv 3 以上（名前の直後の数字は Lv の下限）
test('所持パル: 作業適性を種族から引き、キーワード「採掘」で作業の名前、「採掘3」で Lv 3 以上に絞る。一致の理由は「作業適性：採掘 Lv6」', () => {
  const list = normalizeOwned({ ...snapshot, pals: [
    pal('a', 'Anubis', { kind: 'party' }),
    pal('b', 'PinkCat', { kind: 'party' }),
    pal('c', 'SheepBall', { kind: 'party' }),
    pal('h', 'Male_Soldier01', { kind: 'party' }),
  ] }, { pals, passives }).pals;
  const [a, b, c, h] = list;
  // 種族の値をそのまま指す（共有の列は要らない）。マスターにないもの（人間）は作業適性なし
  assert.equal(a.work, palWork.Anubis);
  assert.deepEqual(h.work, {});
  assert.deepEqual(workEntries(a.work).map(({ name, level }) => `${name}${level}`), ['手作業6', '採掘6', '運搬4']);
  assert.deepEqual(workEntries(undefined), []);
  const ids = (query) => filterOwned(list, { query }).map((p) => p.id).sort();
  assert.deepEqual(ids('採掘'), ['a', 'b']);
  assert.deepEqual(ids('採掘3'), ['a']);
  // 全角の数字・ひらがなもそろえる。Lv が足りなければ当たらない
  assert.deepEqual(ids('採掘６'), ['a']);
  assert.deepEqual(ids('ひおこし'), []);
  assert.deepEqual(ids('採掘7'), []);
  // 数字は何桁でも Lv の下限（文字の部分一致には戻さない）
  assert.deepEqual(ids('採掘100'), []);
  assert.deepEqual(ids('採掘06'), ['a']);
  assert.deepEqual(ids('運搬1'), ['a', 'b', 'c']);
  assert.deepEqual(ids('運搬 手作業2'), ['a']);
  // 作業の名前でない語＋数字は、今までどおり文字の部分一致
  assert.deepEqual(ids('アヌビス3'), []);
  const notes = (item, query) => keywordNotes(item, keywordTerms(query));
  assert.deepEqual(notes(a, '採掘3'), [{ label: '作業適性', name: '採掘 Lv6', desc: '' }]);
  assert.deepEqual(notes(b, '採掘'), [{ label: '作業適性', name: '採掘 Lv1', desc: '' }]);
  // 語の順に。作業適性は属性の次（同じ語の中の並び）
  assert.deepEqual(notes(a, '運搬3 アヌビス').map((note) => `${note.label}：${note.name}`), ['作業適性：運搬 Lv4', 'パル名：アヌビス', 'パートナースキル：砂漠の守護神']);
  // 「牧場」は作業の名前（モコロンは牧場 Lv1）とパートナースキルの説明（家畜牧場）の両方に当たる
  assert.deepEqual(notes(c, '牧場').map((note) => `${note.label}：${note.name}`), ['作業適性：牧場 Lv1', 'パートナースキル：モコモコの盾']);
  // 共有の個体も種族から引く
  const shared = ownedFromShared(sharedUpload(normalizeOwned({ ...snapshot, pals: [pal('a', 'Anubis', { kind: 'party' })] }, { pals, passives })), { pals, passives });
  assert.equal(shared.pals[0].work, palWork.Anubis);
});

// ---- save-extras（入手時刻・魂の強化と状態・プレイ中と Day・観賞用ケージ・牧場のケーキ） ----

test('save-extras: 入手時刻・魂の強化・状態を画面の形に整え、壊れた値は捨てる。項目のない古いスナップショット（IndexedDB）では入手時刻なし・null', () => {
  const list = normalizeOwned({
    ...snapshot,
    pals: [
      pal('n1', 'Anubis', { kind: 'party' }, {
        ownedAt: '2026-10-15T12:52:16.570Z', soul: { hp: 10, attack: 0, defense: '3', craft: 500 },
        condition: { sick: 'Cold', hunger: 'Starvation', sanity: 82.46 },
      }),
      // 形の合わない値（ミリ秒のない時刻・日付だけ・文字の状態の種類）
      pal('n2', 'Anubis', { kind: 'base', playerUid: '', baseId: BASE }, { ownedAt: '2026-10-15T12:52:16Z', soul: 'x', condition: { sick: '<b>', hunger: 5, sanity: 'NaN' } }),
      pal('n3', 'Anubis', { kind: 'palbox' }, { ownedAt: '2026-10-15', condition: { sick: '', hunger: '', sanity: 140 } }),
      // 古いスナップショット（save-extras の項目がない）
      pal('n4', 'Anubis', { kind: 'palbox' }),
    ],
  }, { pals, passives });
  const [n1, n2, n3, n4] = list.pals;
  assert.deepEqual([n1.ownedAt, n1.soul, n1.condition], ['2026-10-15T12:52:16.570Z', { hp: 10, attack: 0, defense: 3, craft: 100 }, { sick: 'Cold', hunger: 'Starvation', sanity: 82.5 }]);
  assert.deepEqual([n2.ownedAt, n2.soul, n2.condition], ['', null, { sick: '', hunger: '', sanity: null }]);
  assert.deepEqual([n3.ownedAt, n3.condition.sanity], ['', 100]);
  assert.deepEqual([n4.ownedAt, n4.soul, n4.condition], ['', null, null]);
  // 病気・空腹は「病気」「空腹」のキーワードでも探せる（理由は特徴）
  assert.deepEqual(filterOwned(list.pals, { query: '病気' }).map((p) => p.id), ['n1']);
  assert.deepEqual(keywordNotes(n1, keywordTerms('空腹')), [{ label: '特徴', name: '空腹', desc: '' }]);
  // 古いスナップショットのプレイヤー（online がない）は分からない（null）。Lv は数のときだけ
  assert.deepEqual(list.players.map((p) => [p.name, p.level, p.online]), [['Alice', 50, null], ['Bob', 40, null]]);
  const players = normalizeOwned({ ...snapshot, players: [{ uid: P1, name: 'Alice', level: 'x', online: true }, { uid: P2, name: 'Bob', level: 47, online: 'yes' }] }, { pals, passives }).players;
  assert.deepEqual(players.map((p) => [p.level, p.online]), [[0, true], [47, null]]);
  // ゲーム内の日数は 1 以上の数か null（0 は分からない）
  assert.equal(owned.world.inGameDay, null);
  assert.equal(normalizeOwned({ ...snapshot, world: { ...snapshot.world, inGameDay: 624 } }, { pals, passives }).world.inGameDay, 624);
  assert.equal(normalizeOwned({ ...snapshot, world: { ...snapshot.world, inGameDay: 0 } }, { pals, passives }).world.inGameDay, null);
  // 範囲外・整数でない値は丸めずに null（共有側の ownedInGameDay と同じ。前は '9e99' を「1000000 日目」にして共有もした）
  for (const day of ['9e99', 1000001, -3, 1.5, 'abc', Infinity]) {
    assert.equal(normalizeOwned({ ...snapshot, world: { ...snapshot.world, inGameDay: day } }, { pals, passives }).world.inGameDay, null, String(day));
  }
  assert.equal(normalizeOwned({ ...snapshot, world: { ...snapshot.world, inGameDay: '1000000' } }, { pals, passives }).world.inGameDay, 1000000);
});

test('save-extras: 入手の新しい順（入手時刻のない個体は向きによらず最後・同じ時刻は図鑑番号 → 個体 ID）と、入手の古い順', () => {
  const list = normalizeOwned({ ...snapshot, pals: [
    pal('x1', 'Anubis', { kind: 'party' }, { ownedAt: '2026-10-15T12:00:00.000Z' }),
    pal('x2', 'SheepBall', { kind: 'party' }, { ownedAt: '2026-10-15T13:00:00.000Z' }),
    pal('x3', 'PinkCat', { kind: 'party' }),
    pal('x4', 'SheepBall', { kind: 'party' }, { ownedAt: '2026-10-15T12:00:00.000Z' }),
    pal('x0', 'SheepBall', { kind: 'party' }, { ownedAt: '2026-10-15T12:00:00.000Z' }),
  ] }, { pals, passives }).pals;
  assert.deepEqual(sortOwned(list, 'ownedAt').map((p) => p.id), ['x2', 'x0', 'x4', 'x1', 'x3']);
  assert.deepEqual(sortOwned(list, 'ownedAt', 'asc').map((p) => p.id), ['x0', 'x4', 'x1', 'x2', 'x3']);
  assert.deepEqual([sortLabel('ownedAt'), sortLabel('ownedAt', 'asc'), sortKey('ownedAt').dir], ['入手の新しい順', '入手の古い順', 'desc']);
});

test('save-extras: 観賞用ケージの個体は拠点の持ち物（所持者は拠点・場所は「観賞用ケージ・拠点 n」）で、場所の並びは拠点の次。預けた人の個体にも数える', () => {
  const list = normalizeOwned({ ...snapshot, pals: [
    pal('d1', 'ChickenPal', { kind: 'display', playerUid: '', baseId: BASE }, { lastOwnerUid: P2 }),
    pal('d2', 'ChickenPal', { kind: 'display', playerUid: '', baseId: '' }),
  ] }, { pals, passives });
  const [d1, d2] = list.pals;
  assert.deepEqual([d1.place, d1.placeGroup, d1.holder, d1.placeLabel, d1.lastOwner], ['display', 'display', '拠点 2', '観賞用ケージ・拠点 2', 'Bob']);
  assert.deepEqual([d2.holder, d2.placeLabel], ['拠点', '観賞用ケージ']);
  assert.equal(PLACE_ORDER.indexOf('display'), PLACE_ORDER.indexOf('base') + 1);
  assert.equal(PLACE_LABELS.display, '観賞用ケージ');
  assert.deepEqual(palsOfPlayers(list, new Set([P2])).map((p) => p.id), ['d1']);
  assert.equal(canBeParent(d1), true);
  // 共有でも場所は display のまま。知らない場所は「不明」として受ける（観賞用ケージを知らない古い画面と同じ扱い）
  const shared = ownedFromShared(sharedUpload(list), { pals, passives });
  assert.deepEqual(shared.pals.map((p) => [p.place, p.placeLabel]), [['display', '観賞用ケージ・拠点 2'], ['display', '観賞用ケージ']]);
  const unknown = ownedFromShared({ world: {}, columns: ['instanceId', 'place'], rows: [['u1', 'aquarium']] }, { pals, passives });
  assert.equal(unknown.pals[0].place, 'unknown');
});

test('save-extras・share-extras: 共有に入手時刻・魂の強化・状態の列（ownedAt・soul・condition）と、players の Lv・プレイ中、world の日数、farms のケーキ（c）を足し、参加者の画面に戻る。古い共有・古い画面の行も受ける', () => {
  const host = normalizeOwned({
    ...snapshot,
    world: { ...snapshot.world, inGameDay: 624 },
    players: [{ uid: P1, name: 'Alice', level: 52, online: true }, { uid: P2, name: 'Bob', level: 0, online: null }],
    breedFarms: [
      { id: 'F1', baseId: BASE, status: 'ok', parents: [], eggs: [], cakes: [{ itemId: 'Cake05', count: 7 }, { itemId: 'bad id', count: 3 }, { itemId: 'Cake02', count: 0 }] },
      // ケーキ切れ・親が読めない牧場のケーキ・ケーキを読む前の牧場
      { id: 'F2', baseId: BASE, status: 'ok', parents: [], eggs: [], cakes: [] },
      { id: 'F3', baseId: BASE, status: 'uncertain', parents: [], eggs: [], cakes: [{ itemId: 'Cake02', count: 51 }] },
      { id: 'F4', baseId: BASE, status: 'ok', parents: [], eggs: [] },
    ],
    pals: [
      pal('a', 'Anubis', { kind: 'party' }, { ownedAt: '2026-10-15T12:52:16.570Z', soul: { hp: 10 }, condition: { sick: 'Cold', sanity: 62.4 } }),
      pal('b', 'PinkCat', { kind: 'party' }),
      pal('c', 'PinkCat', { kind: 'base', baseId: BASE }, { soul: { hp: 0, attack: 0, defense: 0, craft: 1 }, condition: { hunger: 'Starvation', sanity: 'x' } }),
      // タマゴは魂の強化と状態を持たない（送らない）
      pal('d', 'PinkCat', { kind: 'egg-incubator', baseId: BASE }, { soul: { hp: 1 }, condition: { sick: 'Cold', sanity: 100 } }),
    ],
  }, { pals, passives });
  // 牧場のケーキ（壊れた項目・0 個は捨てる）
  assert.deepEqual(host.farms.map((farm) => farm.cakes), [[{ itemId: 'Cake05', count: 7 }], [], [{ itemId: 'Cake02', count: 51 }], null]);
  const upload = sharedUpload(host);
  assert.deepEqual(upload.columns.slice(-3), ['ownedAt', 'soul', 'condition']);
  // 魂の強化は 'hp|attack|defense|craft'、状態は '病気|空腹|SAN'（SAN は整数。読めなければ空）。分からない（読む前のセーブ・タマゴ）は ''
  assert.deepEqual(upload.rows.map((row) => row.slice(-3)), [
    ['2026-10-15T12:52:16.570Z', '10|0|0|0', 'Cold||62'], ['', '', ''], ['', '0|0|0|1', '|Starvation|'], ['', '', ''],
  ]);
  // 分からない値（Lv 0・プレイ中 null）は送らない
  assert.deepEqual(upload.players, [{ uid: P1, name: 'Alice', level: 52, online: true }, { uid: P2, name: 'Bob' }]);
  // ケーキは牧場ごとの短い鍵 c（[] はケーキ切れ、鍵がなければ分からない。読めない牧場にも付ける）
  assert.deepEqual(upload.farms.map((farm) => farm.c), [[{ i: 'Cake05', n: 7 }], [], [{ i: 'Cake02', n: 51 }], undefined]);
  const checked = validateOwnedUpload({ worldId: 'ABCDEF0123456789ABCDEF0123456789', world: { name: 'World9', hostName: 'Alice', inGameDay: 624 }, saveUpdatedAt: '2026-10-15T12:53:00.000Z', ...upload });
  assert.equal(checked.ok, true);
  assert.deepEqual([checked.value.inGameDay, checked.value.players, checked.value.farms], [624, upload.players, upload.farms]);
  // 参加者の画面: 入手時刻・魂の強化と状態（SAN は整数）・Lv・プレイ中・日数・ケーキを受ける。タマゴの魂の強化と状態は分からない（null）
  const shared = ownedFromShared({ world: { worldName: 'World9', inGameDay: 624, players: checked.value.players, farms: checked.value.farms }, columns: OWNED_FIELDS, rows: checked.value.rows }, { pals, passives });
  assert.deepEqual(shared.pals.map((p) => [p.ownedAt, p.soul, p.condition]), [
    ['2026-10-15T12:52:16.570Z', { hp: 10, attack: 0, defense: 0, craft: 0 }, { sick: 'Cold', hunger: '', sanity: 62 }],
    ['', null, null],
    ['', { hp: 0, attack: 0, defense: 0, craft: 1 }, { sick: '', hunger: 'Starvation', sanity: null }],
    ['', null, null],
  ]);
  assert.deepEqual(shared.pals.map((p) => [p.soul, p.condition]).slice(0, 3), host.pals.map((p) => [p.soul, p.condition && { ...p.condition, sanity: p.condition.sanity === null ? null : Math.round(p.condition.sanity) }]).slice(0, 3));
  assert.deepEqual(filterOwned(shared.pals, { query: '空腹' }).map((p) => p.id), ['c']);
  assert.deepEqual(shared.farms.map((farm) => farm.cakes), [[{ itemId: 'Cake05', count: 7 }], [], [{ itemId: 'Cake02', count: 51 }], null]);
  assert.deepEqual(shared.players, [{ uid: P1, name: 'Alice', level: 52, online: true }, { uid: P2, name: 'Bob', level: 0, online: null }]);
  assert.equal(shared.world.inGameDay, 624);
  // ownedAt の列のない古い共有（GAS の setup() の前・前の版の画面）・日数のない古い共有。soul・condition・c もないので分からない
  const width = OWNED_FIELDS.indexOf('ownedAt');
  const oldFarms = checked.value.farms.map(({ c: _cakes, ...farm }) => farm);
  const legacy = ownedFromShared({ world: { worldName: 'World9', players: [{ uid: P1, name: 'Alice' }], farms: oldFarms }, columns: OWNED_FIELDS.slice(0, width), rows: checked.value.rows.map((row) => row.slice(0, width)) }, { pals, passives });
  assert.deepEqual([legacy.pals.map((p) => p.ownedAt), legacy.players[0].online, legacy.world.inGameDay], [['', '', '', ''], null, null]);
  assert.deepEqual([legacy.pals.map((p) => [p.soul, p.condition]), legacy.farms.map((farm) => farm.cakes)], [Array(4).fill([null, null]), [null, null, null, null]]);
  // 版 12 の GAS（soul・condition の列を知らない）に合わせて狭めた 29 列の共有も、魂の強化と状態だけが分からない
  const narrow = OWNED_FIELDS.indexOf('soul');
  const v12 = ownedFromShared({ world: {}, columns: OWNED_FIELDS.slice(0, narrow), rows: checked.value.rows.map((row) => row.slice(0, narrow)) }, { pals, passives });
  assert.deepEqual(v12.pals.map((p) => [p.ownedAt, p.soul, p.condition])[0], ['2026-10-15T12:52:16.570Z', null, null]);
  // 形の壊れたセルは分からない（null）。範囲の外の数は 0〜100 に収める
  const odd = (soul, condition) => ownedFromShared({ world: {}, columns: ['instanceId', 'soul', 'condition'], rows: [['z', soul, condition]] }, { pals, passives }).pals[0];
  for (const [soul, condition] of [['1|2|3', 'Cold|x'], ['a|0|0|0', 'Cold|Hungry|1.5'], ['1|2|3|4|5', 'bad name||1'], ['|||', '||-1']]) {
    assert.deepEqual([odd(soul, condition).soul, odd(soul, condition).condition], [null, null], `${soul} ${condition}`);
  }
  assert.deepEqual([odd('999|0|0|0', '||999').soul.hp, odd('999|0|0|0', '||999').condition.sanity], [100, 100]);
  // 壊れた時刻・日数・Lv は捨てる
  const broken = validateOwnedUpload({
    worldId: 'ABCDEF0123456789ABCDEF0123456789', world: { name: 'World9', inGameDay: 'x' }, saveUpdatedAt: '2026-10-15T12:53:00.000Z',
    players: [{ uid: P1, name: 'Alice', level: 1000, online: 'yes' }], columns: OWNED_FIELDS, rows: [OWNED_FIELDS.map((field) => (field === 'instanceId' ? 'z' : field === 'ownedAt' ? 'きのう' : ''))],
  });
  assert.deepEqual([broken.value.inGameDay, broken.value.players], [null, [{ uid: P1, name: 'Alice' }]]);
  assert.equal(ownedFromShared({ world: {}, columns: OWNED_FIELDS, rows: broken.value.rows }, { pals, passives }).pals[0].ownedAt, '');
});

test('save-extras: ケーキの名前と表の ID（アイコンのファイル名）。表にない ID は ID のまま・アイコンなし', () => {
  assert.deepEqual(cakeInfo('Cake02'), { name: 'キノコケーキ', icon: 'Cake02' });
  assert.deepEqual(cakeInfo('cake05'), { name: 'スペシャルケーキ', icon: 'Cake05' });
  assert.deepEqual(cakeInfo('Cake09'), { name: 'Cake09', icon: '' });
});

// ---- パル次元ストレージの読み漏れ（dps-missing） ----
const P3 = 'ffff0000-0000-0000-0000-000000000003';
const FILE = (uid) => `Players/${uid.replace(/-/g, '').toUpperCase()}`;
const gapSnapshot = ({ inLocker = 118, inLockerMissing = 27, used = [FILE(P1) + '.sav', FILE(P1) + '_dps.sav', FILE(P2) + '.sav'], players = snapshot.players } = {}) => ({
  ...snapshot, players, stats: { inLocker, inLockerMissing }, files: { used: ['Level.sav', ...used], skipped: [] },
});

test('次元ストレージの読み漏れ（dpsMissing）: Players/<uid>.sav は読めたのに _dps.sav を読めていない人を候補にする（Lv の分かる人だけ・ファイル名の大文字小文字は問わない）', () => {
  const gap = dpsMissing(gapSnapshot());
  assert.deepEqual(gap, { expected: 118, missing: 27, candidates: [{ uid: P2, name: 'Bob', file: `${P2.replace(/-/g, '').toUpperCase()}_dps.sav` }] });
  // 候補が 2 人。欠けの数は人数で割らない
  const two = dpsMissing(gapSnapshot({ used: [FILE(P1) + '.sav', FILE(P2).toLowerCase() + '.sav'] }));
  assert.deepEqual([two.missing, two.candidates.map((player) => player.name)], [27, ['Alice', 'Bob']]);
  // .sav も読めていない人（登録されていないプレイヤーのファイルの案内に任せる）・Lv の分からない人は候補にしない → 候補なし
  const none = dpsMissing(gapSnapshot({ used: [FILE(P1) + '.sav', FILE(P1) + '_dps.sav'], players: [...snapshot.players, { uid: P3, name: 'Carol', level: 0 }] }));
  assert.deepEqual(none.candidates, []);
  assert.deepEqual(dpsMissing(gapSnapshot({ used: [FILE(P3) + '.sav'], players: [{ uid: P3, name: 'Carol', level: 0 }] })).candidates, []);
  // 読めていない個体がなければ候補を探さない
  assert.deepEqual(dpsMissing(gapSnapshot({ inLockerMissing: 0 })), { expected: 118, missing: 0, candidates: [] });
});

test('次元ストレージの読み漏れ（dpsMissing）: 数のない古い解析結果・壊れた数は「分からない」（null）。読み漏れが一覧の数より多ければ一覧の数まで', () => {
  for (const stats of [undefined, {}, { inLocker: 118 }, { inLockerMissing: 3 }, { inLocker: 'x', inLockerMissing: 1 }]) {
    assert.equal(dpsMissing({ ...snapshot, stats }), null, JSON.stringify(stats));
  }
  assert.equal(dpsMissing(null), null);
  assert.equal(dpsMissing(gapSnapshot({ inLocker: 5, inLockerMissing: 9 })).missing, 5);
  // files がない（古い形）ときは、読めたファイルが分からないので候補もない
  assert.deepEqual(dpsMissing({ ...snapshot, stats: { inLocker: 3, inLockerMissing: 1 } }).candidates, []);
});

test('次元ストレージの読み漏れ: 候補のプレイヤーにだけ dpsGap（欠けの数）を付けて共有し、GAS の検査（cleanOwnedPlayer）を通って参加者の画面に戻る', () => {
  const host = normalizeOwned(gapSnapshot({ used: [FILE(P1) + '.sav', FILE(P2) + '.sav'] }), { pals, passives });
  assert.deepEqual(host.players.map((player) => [player.name, player.dpsGap]), [['Alice', 27], ['Bob', 27]]);
  // 解析結果に残っていた値は使わない（ここで求めた値だけ）
  const stray = normalizeOwned({ ...snapshot, players: [{ uid: P1, name: 'Alice', level: 50, dpsGap: 5 }] }, { pals, passives });
  assert.equal('dpsGap' in stray.players[0], false);
  const upload = sharedUpload(host);
  assert.deepEqual(upload.players, [{ uid: P1, name: 'Alice', level: 50, dpsGap: 27 }, { uid: P2, name: 'Bob', level: 40, dpsGap: 27 }]);
  // 候補でないプレイヤー・読み漏れのないセーブでは送らない
  assert.equal(JSON.stringify(sharedUpload(normalizeOwned(gapSnapshot({ inLockerMissing: 0 }), { pals, passives })).players).includes('dpsGap'), false);
  assert.deepEqual(sharedUpload(normalizeOwned(gapSnapshot(), { pals, passives })).players.map((player) => player.dpsGap), [undefined, 27]);
  const checked = validateOwnedUpload({ worldId: 'ABCDEF0123456789ABCDEF0123456789', world: { name: 'World9' }, saveUpdatedAt: '2026-10-16T12:00:00.000Z', ...upload });
  assert.deepEqual(checked.value.players, upload.players);
  const shared = ownedFromShared({ world: { worldName: 'World9', players: checked.value.players }, columns: OWNED_FIELDS, rows: checked.value.rows }, { pals, passives });
  assert.deepEqual(shared.players.map((player) => [player.name, player.dpsGap]), [['Alice', 27], ['Bob', 27]]);
  // 古い共有（dpsGap がない）は付けない
  const legacy = ownedFromShared({ world: { players: [{ uid: P1, name: 'Alice' }] }, columns: OWNED_FIELDS, rows: [] }, { pals, passives });
  assert.equal('dpsGap' in legacy.players[0], false);
});

test('次元ストレージの読み漏れ: cleanOwnedPlayer（GAS と共有）は dpsGap を 1〜上限の整数だけ残す。送る側は上限で切る', () => {
  for (const value of [0, -1, 1.5, '3', null, true, OWNED_DPS_GAP_MAX + 1, Infinity]) {
    assert.deepEqual(cleanOwnedPlayer({ uid: P1, name: 'Alice', dpsGap: value }), { uid: P1, name: 'Alice' }, String(value));
  }
  assert.deepEqual(cleanOwnedPlayer({ uid: P1, name: 'Alice', dpsGap: 1 }), { uid: P1, name: 'Alice', dpsGap: 1 });
  assert.deepEqual(cleanOwnedPlayer({ uid: P1, name: 'Alice', dpsGap: OWNED_DPS_GAP_MAX }), { uid: P1, name: 'Alice', dpsGap: OWNED_DPS_GAP_MAX });
  const many = sharedUpload({ ...owned, players: [{ uid: P1, name: 'Alice', level: 1, online: null, dpsGap: OWNED_DPS_GAP_MAX + 5 }] });
  assert.equal(many.players[0].dpsGap, OWNED_DPS_GAP_MAX);
});

test('共有の中身の印の元（ownedContentText。share-upload）: 決まった順の配列の JSON。識別・送った人・ファイルの更新日時は入れず、行・一覧・object の鍵の並びとセルの型によらない', () => {
  const columns = ['instanceId', 'palId', 'level'];
  const base = {
    userId: 'ホスト', worldId: 'ABCDEF0123456789ABCDEF0123456789', saveUpdatedAt: '2026-10-05T10:00:00.000Z',
    world: { name: 'World9', hostName: 'Alice', inGameDay: 12, saveStamp: '638650000000000001', contentHash: 'a'.repeat(64), format: 4, fileCount: 3, missingCount: 0, force: true },
    players: [{ uid: 'u1', name: 'Alice', level: 50, online: true }], bases: [{ id: 'b1', label: '拠点 1' }],
    farms: [{ id: 'f1', baseId: 'b1', parents: ['p1', 'p2'], n: 1, eggs: [{ id: 'e1', p: 'SheepBall' }] }],
    columns, rows: [['p1', 'SheepBall', '5'], ['p2', 'PinkCat', '7']],
  };
  const text = ownedContentText(base);
  assert.equal(text, JSON.stringify([
    base.worldId, 'World9', 'Alice', 12,
    [{ level: 50, name: 'Alice', online: true, uid: 'u1' }], [{ id: 'b1', label: '拠点 1' }],
    [{ baseId: 'b1', eggs: [{ id: 'e1', p: 'SheepBall' }], id: 'f1', n: 1, parents: ['p1', 'p2'] }],
    columns, base.rows,
  ]));
  // 識別・送った人・ファイルの更新日時が違っても、鍵の順が違っても、セルが数でも同じ
  const same = {
    ...base, userId: '別の人', saveUpdatedAt: '2026-10-06T00:00:00.000Z',
    world: { hostName: 'Alice', name: 'World9', inGameDay: 12, saveStamp: '1', force: false },
    players: [{ online: true, uid: 'u1', level: 50, name: 'Alice' }],
    farms: [{ eggs: [{ p: 'SheepBall', id: 'e1' }], parents: ['p1', 'p2'], n: 1, baseId: 'b1', id: 'f1' }],
    rows: [['p1', 'SheepBall', 5], ['p2', 'PinkCat', 7]],
  };
  assert.equal(ownedContentText(same), text);
  // 並びによらない（個体の並びは登録したファイルの順で変わる。PC ごとに登録の順が違うことがある）
  const players = [{ uid: 'u2', name: 'Bob' }, { uid: 'u1', name: 'Alice', level: 50, online: true }];
  const farms = [...base.farms, { id: 'f0', baseId: 'b1', parents: [], n: 0 }];
  const ordered = { ...base, players, farms, bases: [...base.bases, { id: 'b0', label: '拠点 0' }] };
  const reordered = { ...ordered, players: [...players].reverse(), farms: [...farms].reverse(), bases: [...ordered.bases].reverse(), rows: [...base.rows].reverse() };
  assert.equal(ownedContentText(reordered), ownedContentText(ordered));
  assert.deepEqual(JSON.parse(ownedContentText(reordered))[8].map((row) => row[0]), ['p1', 'p2']);
  // 中身が違えば違う（行・列の幅・列の並び・牧場の有無・日数）
  for (const changed of [
    { ...base, rows: [['p1', 'SheepBall', '6'], ['p2', 'PinkCat', '7']] },
    { ...base, columns: columns.slice(0, 2), rows: base.rows.map((row) => row.slice(0, 2)) },
    { ...base, columns: [...columns].reverse(), rows: base.rows.map((row) => [...row].reverse()) },
    { ...base, farms: undefined },
    { ...base, world: { ...base.world, inGameDay: 13 } },
  ]) assert.notEqual(ownedContentText(changed), text);
  // 牧場を送らないときは null、日数がないときも null
  const bare = JSON.parse(ownedContentText({ worldId: 'W', world: { name: 'N', hostName: '' }, players: [], bases: [], columns: [], rows: [] }));
  assert.deepEqual(bare, ['W', 'N', '', null, [], [], null, [], []]);
});

test('共有の中身の印の元（server）: world の追加の情報のうち在庫（items）だけを、配列のときに列の後・行の前に入れる（並びによらない）。セーブの種類・通算の時間・以前の持ち主は入れない', () => {
  const base = { worldId: 'W', world: { name: 'N', hostName: '' }, players: [], bases: [], columns: ['instanceId'], rows: [['p1']] };
  const text = ownedContentText(base);
  const extras = { saveKind: 'server', clock: '638650000000000005', formers: [{ uid: 'u9', pals: 1, farms: 0 }], formersPartial: true, items: null };
  assert.equal(ownedContentText({ ...base, world: { ...base.world, ...extras } }), text);
  const items = [{ id: 'PalPassiveSkillChange_Rare', t: 5, p: [{ l: '拠点 1 の箱', n: 5 }] }, { id: 'PalGenderReverse', t: 2 }];
  const stocked = ownedContentText({ ...base, world: { ...base.world, items } });
  assert.deepEqual(JSON.parse(stocked), ['W', 'N', '', null, [], [], null, ['instanceId'], [items[1], { id: 'PalPassiveSkillChange_Rare', p: [{ l: '拠点 1 の箱', n: 5 }], t: 5 }], [['p1']]]);
  assert.equal(ownedContentText({ ...base, world: { ...base.world, ...extras, items: [...items].reverse() } }), stocked);
  // 在庫が違えば違う（持っていない [] も、分からない形とは違う）
  assert.notEqual(ownedContentText({ ...base, world: { ...base.world, items: [{ ...items[0], t: 4 }, items[1]] } }), stocked);
  assert.notEqual(ownedContentText({ ...base, world: { ...base.world, items: [] } }), text);
});
