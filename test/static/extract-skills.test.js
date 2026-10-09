import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSkills, renderSkills } from '../../scripts/extract-skills.mjs';
import pals from '../../web/data/pals.js';
import { ACTIVE_SKILLS, PARTNER_SKILLS } from '../../web/data/skills.js';

test('スキル名の取り出し: アクティブスキルは ID ごと、パートナースキルはパル ID ごとに名前を取り、名前のない行（-）は捨てる', () => {
  const texts = new Map([
    ['ACTION_SKILL_AirCanon', 'エアーキャノン'],
    ['ACTION_SKILL_Throw', '-'],
    ['ACTION_SKILL_EnergyShot', ''],
    ['PARTNERSKILL_SheepBall', 'モコモコの盾'],
    ['PARTNERSKILL_plantslime', '木こり応援'],
    ['PARTNERSKILL_NotInMaster', '使わない'],
    ['PASSIVE_Rare', '希少'],
  ]);
  const skills = buildSkills(texts, ['SheepBall', 'PlantSlime', 'PlantSlime_Flower', 'PinkCat']);
  // 大文字小文字の違いは吸収し、表にない姿違いは元のパルの名前を使う。名前のないパルは載せない
  assert.deepEqual(skills, {
    active: { AirCanon: 'エアーキャノン' },
    partner: { PlantSlime: '木こり応援', PlantSlime_Flower: '木こり応援', SheepBall: 'モコモコの盾' },
  });
  assert.match(renderSkills(skills), /export const ACTIVE_SKILLS = \{\n {2}"AirCanon": "エアーキャノン",\n\};/);
});

test('スキル名のデータ: マスターのパルすべてにパートナースキルの名前があり、セーブで見たアクティブスキルの名前がある', () => {
  for (const pal of pals) assert.ok(PARTNER_SKILLS[pal.id], pal.id);
  assert.equal(ACTIVE_SKILLS.AirCanon, 'エアーキャノン');
  assert.equal(ACTIVE_SKILLS.Unique_SheepBall_Roll, 'コロコロモコロン');
  assert.ok(Object.keys(ACTIVE_SKILLS).length >= 300);
});
