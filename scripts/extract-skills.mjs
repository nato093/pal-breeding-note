// ゲーム本体（Pal-Windows.pak）から、アクティブスキルとパートナースキルの日本語名を取り出す。
// 所持パルのキーワード検索で、覚えているアクティブスキルとパートナースキルを名前で探すのに使う。
//   web/data/skills.js … アクティブスキルの ID（セーブの EquipWaza・MasteredWaza から EPalWazaID:: を外したもの）→ 日本語名、
//                        パル ID → パートナースキルの日本語名
// 使い方: npm run extract:skills -- "<Palworld のインストール先>"（省略時は環境変数 PALWORLD_DIR か既定の場所）
// 読み取りのみ。使う表: DT_SkillNameText_Common（行名が ACTION_SKILL_〈ID〉・PARTNERSKILL_〈パル ID〉。名前のない行は「-」）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPak } from './extract-passive-icons.mjs';
import { nameMap, readNameText } from './extract-humans.mjs';
import pals from '../web/data/pals.js';

const TABLE = 'Pal/Content/Pal/DataTable/Text/DT_SkillNameText_Common';

const sorted = (object) => Object.fromEntries(Object.entries(object).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/**
 * スキル名の表から、アクティブスキルとパートナースキルの名前を取り出す。
 * @param {Map<string, string>} texts 行名 → 文字列
 * @param {string[]} palIds パルのマスターの ID
 */
export function buildSkills(texts, palIds) {
  const active = {};
  const partners = new Map();
  for (const [key, value] of texts) {
    if (!value || value === '-') continue;
    if (key.startsWith('ACTION_SKILL_')) active[key.slice('ACTION_SKILL_'.length)] = value;
    else if (key.startsWith('PARTNERSKILL_')) partners.set(key.slice('PARTNERSKILL_'.length).toLowerCase(), value);
  }
  const partner = {};
  for (const id of palIds) {
    // 表にない姿違い（ナエモチ（花）など）は、元のパル（最後の _ より前の ID）の名前を使う
    const name = partners.get(id.toLowerCase()) ?? partners.get(id.replace(/_[^_]*$/, '').toLowerCase());
    if (name) partner[id] = name;
  }
  return { active: sorted(active), partner: sorted(partner) };
}

export function renderSkills({ active, partner }) {
  const lines = (object) => Object.entries(object).map(([id, name]) => `  ${JSON.stringify(id)}: ${JSON.stringify(name)},`).join('\n');
  return '// アクティブスキルとパートナースキルの日本語名（ゲーム本体から npm run extract:skills で生成。手で直さない）\n'
    + '// ACTIVE_SKILLS: アクティブスキルの ID（セーブの EPalWazaID:: を外したもの）→ 名前。PARTNER_SKILLS: パル ID → パートナースキルの名前\n'
    + `export const ACTIVE_SKILLS = {\n${lines(active)}\n};\n\n`
    + `export const PARTNER_SKILLS = {\n${lines(partner)}\n};\n`;
}

function main() {
  const gameDir = process.argv[2] || process.env.PALWORLD_DIR || 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Palworld';
  const pakFile = path.join(gameDir, 'Pal', 'Content', 'Paks', 'Pal-Windows.pak');
  if (!fs.existsSync(pakFile)) throw new Error(`pak が見つかりません: ${pakFile}`);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const pak = openPak(pakFile);
  try {
    const texts = readNameText(nameMap(pak.get(`${TABLE}.uasset`)), pak.get(`${TABLE}.uexp`));
    const skills = buildSkills(texts, pals.map((pal) => pal.id));
    fs.writeFileSync(path.join(root, 'web', 'data', 'skills.js'), renderSkills(skills));
    const missing = pals.filter((pal) => !skills.partner[pal.id]).map((pal) => pal.id);
    console.log(`アクティブスキル: ${Object.keys(skills.active).length} 件、パートナースキル: ${Object.keys(skills.partner).length} 件`
      + (missing.length ? `（名前のないパル: ${missing.join(', ')}）` : ''));
  } finally {
    pak.close();
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try { main(); } catch (error) { console.error(error.message); process.exit(1); }
}
