import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSkills, renderSkills, plainText } from '../../scripts/extract-skills.mjs';
import pals from '../../web/data/pals.js';
import { ACTIVE_SKILLS, PARTNER_SKILLS, ACTIVE_SKILL_DESCS, PARTNER_SKILL_DESCS } from '../../web/data/skills.js';

test('スキル名の取り出し: アクティブスキルは ID ごと、パートナースキルはパル ID ごとに名前と説明を取り、名前のない行（-）は捨てる', () => {
  const tables = {
    names: new Map([
      ['ACTION_SKILL_AirCanon', 'エアーキャノン'],
      ['ACTION_SKILL_Throw', '-'],
      ['ACTION_SKILL_EnergyShot', ''],
      ['PARTNERSKILL_SheepBall', 'モコモコの盾'],
      ['PARTNERSKILL_plantslime', '木こり応援'],
      ['PARTNERSKILL_NotInMaster', '使わない'],
      ['PASSIVE_Rare', '希少'],
    ]),
    activeDescs: new Map([['ACTION_SKILL_AirCanon', '高速で飛ぶ空気の塊を\r\n発射する。'], ['ACTION_SKILL_Throw', '-']]),
    partnerDescs: new Map([
      ['PAL_FIRST_SPAWN_DESC_SheepBall', '<mapObjectName id=|MonsterFarm|/>にアサインすると、<itemName id=|Wool| style=|Status_Keyword|/>を落とす。'],
      ['PAL_FIRST_SPAWN_DESC_PlantSlime', '木を切る。'],
    ]),
    palNames: new Map(),
    itemNames: new Map([['ITEM_NAME_Wool', '羊毛']]),
    mapObjectNames: new Map([['MAPOBJECT_NAME_MonsterFarm', '家畜牧場']]),
    ui: new Map(),
  };
  const skills = buildSkills(tables, ['SheepBall', 'PlantSlime', 'PlantSlime_Flower', 'PinkCat']);
  // 大文字小文字の違いは吸収し、表にない姿違いは元のパルのものを使う。名前のないパルは載せない
  assert.deepEqual(skills, {
    active: { AirCanon: 'エアーキャノン' },
    partner: { PlantSlime: '木こり応援', PlantSlime_Flower: '木こり応援', SheepBall: 'モコモコの盾' },
    activeDescs: { AirCanon: '高速で飛ぶ空気の塊を発射する。' },
    partnerDescs: { PlantSlime: '木を切る。', PlantSlime_Flower: '木を切る。', SheepBall: '家畜牧場にアサインすると、羊毛を落とす。' },
    missing: [],
  });
  const rendered = renderSkills(skills);
  assert.match(rendered, /export const ACTIVE_SKILLS = \{\n {2}"AirCanon": "エアーキャノン",\n\};/);
  assert.match(rendered, /export const PARTNER_SKILL_DESCS = \{\n/);
});

test('スキルの説明: 参照は名前に、アイコンと飾りは外し、レベルで変わる数値は ○、レベルで変わる追記は外す。引けない参照は ID のまま残して知らせる', () => {
  const names = { 'characterName:GhostDragon': 'レイバーン', 'uiCommon:COMMON_ELEMENT_NAME_Dark': '闇属性' };
  const missing = [];
  const text = plainText(
    '手持ちにいる<characterName id=|GhostDragon|/>以外の<img id=|ElemIcon_Dark|/><uiCommon id=|COMMON_ELEMENT_NAME_Dark| style=|Elem_Dark|/>パルの数×'
      + '<Status_Up>{Passive1_EffectValue1}%</>増加する。\r\n{ReferenceMsgId_DamageUp}\r\n<characterName id=|Unknown|/>',
    (tag, id) => names[`${tag}:${id}`],
    (tag, id) => missing.push(`${tag}:${id}`),
  );
  assert.equal(text, '手持ちにいるレイバーン以外の闇属性パルの数×○%増加する。Unknown');
  assert.deepEqual(missing, ['characterName:Unknown']);
});

test('スキル名のデータ: マスターのパルすべてにパートナースキルの名前と説明があり、説明に目印が残っていない', () => {
  for (const pal of pals) {
    assert.ok(PARTNER_SKILLS[pal.id], pal.id);
    assert.ok(PARTNER_SKILL_DESCS[pal.id], pal.id);
  }
  assert.equal(ACTIVE_SKILLS.AirCanon, 'エアーキャノン');
  assert.equal(ACTIVE_SKILLS.Unique_SheepBall_Roll, 'コロコロモコロン');
  assert.ok(Object.keys(ACTIVE_SKILLS).length >= 300);
  assert.ok(Object.keys(ACTIVE_SKILL_DESCS).length >= 300);
  for (const text of [...Object.values(ACTIVE_SKILL_DESCS), ...Object.values(PARTNER_SKILL_DESCS)]) assert.doesNotMatch(text, /[<>{}|\r\n]/, text);
});

test('タマゴの名前の取り出し: ITEM_NAME_PalEgg_* の行だけを、名前のない行を捨てて ID の順に。書き出しは EGG_NAMES', async () => {
  const { buildEggNames, renderEggNames } = await import('../../scripts/extract-skills.mjs');
  const eggs = buildEggNames(new Map([
    ['ITEM_NAME_PalEgg_Fire_01', '炎のタマゴ'], ['ITEM_NAME_PalEgg_MutationPal_01', '突然変異タマゴ'], ['ITEM_NAME_PalEgg_Dark_09', '-'],
    ['ITEM_NAME_Wool', '羊毛'], ['ITEM_DESC_PalEgg_Fire_01', '説明'],
  ]));
  assert.deepEqual(eggs, { PalEgg_Fire_01: '炎のタマゴ', PalEgg_MutationPal_01: '突然変異タマゴ' });
  assert.match(renderEggNames(eggs), /export const EGG_NAMES = \{\n {2}"PalEgg_Fire_01": "炎のタマゴ",\n {2}"PalEgg_MutationPal_01": "突然変異タマゴ",\n\};/);
  // 配信する表は取り出したもの（突然変異のタマゴも名前がある）
  const { EGG_NAMES } = await import('../../web/data/items.js');
  assert.ok(Object.keys(EGG_NAMES).length >= 40);
  assert.ok(Object.keys(EGG_NAMES).every((id) => /^PalEgg_\w+$/.test(id)));
});

test('ケーキの名前の取り出し: ITEM_NAME_Cake・Cake02 などの行だけを、名前のない行を捨てて ID の順に。書き出しは CAKE_NAMES（save-extras）', async () => {
  const { buildCakeNames, renderEggNames } = await import('../../scripts/extract-skills.mjs');
  const cakes = buildCakeNames(new Map([
    ['ITEM_NAME_Cake05', 'スペシャルケーキ'], ['ITEM_NAME_Cake', 'ケーキ'], ['ITEM_NAME_Cake09', '-'],
    ['ITEM_NAME_CakeMix', 'ケーキの素'], ['ITEM_DESC_Cake', '説明'], ['ITEM_NAME_PalEgg_Fire_01', '炎のタマゴ'],
  ]));
  assert.deepEqual(cakes, { Cake: 'ケーキ', Cake05: 'スペシャルケーキ' });
  const text = renderEggNames({ PalEgg_Fire_01: '炎のタマゴ' }, cakes);
  assert.match(text, /export const EGG_NAMES = \{\n {2}"PalEgg_Fire_01": "炎のタマゴ",\n\};/);
  assert.match(text, /export const CAKE_NAMES = \{\n {2}"Cake": "ケーキ",\n {2}"Cake05": "スペシャルケーキ",\n\};/);
  // 配信する表は取り出したもの（ゲームの 5 種）
  const { CAKE_NAMES } = await import('../../web/data/items.js');
  assert.deepEqual(CAKE_NAMES, { Cake: 'ケーキ', Cake02: 'キノコケーキ', Cake03: '野菜ケーキ', Cake04: '豪華野菜ケーキ', Cake05: 'スペシャルケーキ' });
});
