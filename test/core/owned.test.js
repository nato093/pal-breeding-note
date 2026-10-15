import { test } from 'node:test';
import assert from 'node:assert/strict';
import pals from '../../web/data/pals.js';
import passives from '../../web/data/passives.js';
import { buildIndex } from '../../web/js/core/index.js';
import { buildCarrierGraph, shortestRoute } from '../../web/js/core/route.js';
import {
  normalizeOwned, createSpeciesResolver, filterOwned, sortOwned, ownedRows, rowsToCsv, OWNED_COLUMNS,
  ownedRouteStarts, partnerOwnership, ownedBySpecies, canBeParent, ownedCounts, canPairRecord, passiveCounts, palboxPosition, sharedUpload, ownedFromShared,
  keywordTerms, keywordNotes, speciesGenderCounts, OWNED_SORTS, sortKey, sortLabel, palboxLabel, parseBoxLabel,
} from '../../web/js/core/owned.js';
import { cleanOwnedFarms, validateOwnedUpload, OWNED_FIELDS, OWNED_ADDED_FIELDS, OWNED_MAX_FARMS } from '../../web/js/core/owned-shared.js';
import { isParentCandidate } from '../../web/js/core/ideal.js';

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
  assert.deepEqual(OWNED_SORTS.map(([key]) => key), ['dex', 'passives', 'level', 'stars', 'talent', 'hp', 'shot', 'defense', 'place']);
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
