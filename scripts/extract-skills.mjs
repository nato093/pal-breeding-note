// ゲーム本体（Pal-Windows.pak）から、アクティブスキルとパートナースキルの日本語名と説明を取り出す。
// 所持パルのキーワード検索で、覚えているアクティブスキルとパートナースキルを名前と説明で探すのに使う。
//   web/data/skills.js … アクティブスキルの ID（セーブの EquipWaza・MasteredWaza から EPalWazaID:: を外したもの）→ 日本語名・説明、
//                        パル ID → パートナースキルの日本語名・説明
// 使い方: npm run extract:skills -- "<Palworld のインストール先>"（省略時は環境変数 PALWORLD_DIR か既定の場所）
// 読み取りのみ。使う表（名前のない行は「-」）:
//   DT_SkillNameText_Common（ACTION_SKILL_〈ID〉・PARTNERSKILL_〈パル ID〉の名前）、DT_SkillDescText_Common（ACTION_SKILL_〈ID〉の説明）、
//   DT_PalFirstActivatedInfoText（PAL_FIRST_SPAWN_DESC_〈パル ID〉。パートナースキルの説明）、
//   説明の中の参照を引く表: DT_PalNameText_Common・DT_ItemNameText_Common・DT_MapObjectNameText_Common・DT_UI_Common_Text_Common
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPak } from './extract-passive-icons.mjs';
import { nameMap, readNameText } from './extract-humans.mjs';
import pals from '../web/data/pals.js';

const TEXT_DIR = 'Pal/Content/Pal/DataTable/Text/';
const TABLES = {
  names: 'DT_SkillNameText_Common',
  activeDescs: 'DT_SkillDescText_Common',
  partnerDescs: 'DT_PalFirstActivatedInfoText',
  palNames: 'DT_PalNameText_Common',
  itemNames: 'DT_ItemNameText_Common',
  mapObjectNames: 'DT_MapObjectNameText_Common',
  ui: 'DT_UI_Common_Text_Common',
};

// 説明の中の参照（<タグ id=|ID|/>）と、それを引く表・行名の接頭辞
const REFERENCES = {
  characterName: ['palNames', 'PAL_NAME_'],
  itemName: ['itemNames', 'ITEM_NAME_'],
  mapObjectName: ['mapObjectNames', 'MAPOBJECT_NAME_'],
  activeSkillName: ['names', 'ACTION_SKILL_'],
  uiCommon: ['ui', ''],
};

const sorted = (object) => Object.fromEntries(Object.entries(object).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const named = (value) => Boolean(value) && value !== '-';
const lowerKeys = (table) => new Map([...table].map(([key, value]) => [key.toLowerCase(), value]));

/**
 * 説明の文字列を、読める文字だけにする。参照（パル名・属性名など）は名前に置き換え、アイコンと文字の飾りは外す。
 * レベル（パル濃縮）で変わる数値は ○ にし、レベルで変わる追記（{ReferenceMsgId_…}）は外す。
 * @param {string} text
 * @param {(tag: string, id: string) => string | undefined} resolve 参照の名前を引く（なければ undefined）
 * @param {(tag: string, id: string) => void} [onMissing] 引けなかった参照（ID のまま残す）
 */
export function plainText(text, resolve, onMissing = () => {}) {
  return String(text)
    .replace(/<img\b[^>]*\/>/g, '')
    .replace(/<(\w+) id=\|([^|]*)\|[^>]*\/>/g, (match, tag, id) => {
      const name = resolve(tag, id);
      if (name === undefined) onMissing(tag, id);
      return name ?? id;
    })
    .replace(/<\/?\w*>/g, '')
    .replace(/\{ReferenceMsgId_\w+\}/g, '')
    .replace(/\{\w+\}/g, '○')
    // 改行は日本語の文の途中にも入るので、空白にせずつなぐ
    .replace(/\s*\r?\n\s*/g, '')
    .trim();
}

/**
 * スキルの表から、アクティブスキルとパートナースキルの名前と説明を取り出す。
 * @param {Record<keyof TABLES, Map<string, string>>} tables 表ごとの行名 → 文字列
 * @param {string[]} palIds パルのマスターの ID
 * @returns {{ active: object, partner: object, activeDescs: object, partnerDescs: object, missing: string[] }}
 */
export function buildSkills(tables, palIds) {
  const lookups = Object.fromEntries(Object.keys(TABLES).map((key) => [key, lowerKeys(tables[key] ?? new Map())]));
  const missing = new Set();
  const resolve = (tag, id) => {
    const [table, prefix] = REFERENCES[tag] ?? [];
    const value = table ? lookups[table].get(`${prefix}${id}`.toLowerCase()) : undefined;
    return named(value) ? value : undefined;
  };
  const plain = (text) => plainText(text, resolve, (tag, id) => missing.add(`${tag}:${id}`));
  const active = {};
  const partners = new Map();
  for (const [key, value] of tables.names ?? []) {
    if (!named(value)) continue;
    if (key.startsWith('ACTION_SKILL_')) active[key.slice('ACTION_SKILL_'.length)] = value;
    else if (key.startsWith('PARTNERSKILL_')) partners.set(key.slice('PARTNERSKILL_'.length).toLowerCase(), value);
  }
  const activeDescs = {};
  for (const [key, value] of tables.activeDescs ?? []) {
    if (key.startsWith('ACTION_SKILL_') && named(value)) activeDescs[key.slice('ACTION_SKILL_'.length)] = plain(value);
  }
  const partnerTexts = new Map();
  for (const [key, value] of tables.partnerDescs ?? []) {
    if (key.startsWith('PAL_FIRST_SPAWN_DESC_') && named(value)) partnerTexts.set(key.slice('PAL_FIRST_SPAWN_DESC_'.length).toLowerCase(), value);
  }
  const partner = {};
  const partnerDescs = {};
  // 表にない姿違い（ナエモチ（花）など）は、元のパル（最後の _ より前の ID）のものを使う
  const find = (map, id) => map.get(id.toLowerCase()) ?? map.get(id.replace(/_[^_]*$/, '').toLowerCase());
  for (const id of palIds) {
    const name = find(partners, id);
    if (name) partner[id] = name;
    const desc = find(partnerTexts, id);
    if (desc) partnerDescs[id] = plain(desc);
  }
  return {
    active: sorted(active), partner: sorted(partner), activeDescs: sorted(activeDescs), partnerDescs: sorted(partnerDescs), missing: [...missing].sort(),
  };
}

export function renderSkills({ active, partner, activeDescs, partnerDescs }) {
  const block = (name, object) => `export const ${name} = {\n${Object.entries(object).map(([id, text]) => `  ${JSON.stringify(id)}: ${JSON.stringify(text)},`).join('\n')}\n};\n`;
  return '// アクティブスキルとパートナースキルの日本語名と説明（ゲーム本体から npm run extract:skills で生成。手で直さない）\n'
    + '// ACTIVE_SKILLS: アクティブスキルの ID（セーブの EPalWazaID:: を外したもの）→ 名前。PARTNER_SKILLS: パル ID → パートナースキルの名前\n'
    + '// …_DESCS: 同じ ID → 説明。レベル（パル濃縮）で変わる数値は ○\n'
    + [block('ACTIVE_SKILLS', active), block('PARTNER_SKILLS', partner), block('ACTIVE_SKILL_DESCS', activeDescs), block('PARTNER_SKILL_DESCS', partnerDescs)].join('\n');
}

function main() {
  const gameDir = process.argv[2] || process.env.PALWORLD_DIR || 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Palworld';
  const pakFile = path.join(gameDir, 'Pal', 'Content', 'Paks', 'Pal-Windows.pak');
  if (!fs.existsSync(pakFile)) throw new Error(`pak が見つかりません: ${pakFile}`);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const pak = openPak(pakFile);
  try {
    const tables = Object.fromEntries(Object.entries(TABLES).map(([key, table]) => {
      const base = `${TEXT_DIR}${table}`;
      return [key, readNameText(nameMap(pak.get(`${base}.uasset`)), pak.get(`${base}.uexp`))];
    }));
    const skills = buildSkills(tables, pals.map((pal) => pal.id));
    fs.writeFileSync(path.join(root, 'web', 'data', 'skills.js'), renderSkills(skills));
    const count = (object) => Object.keys(object).length;
    const lacking = pals.filter((pal) => !skills.partner[pal.id] || !skills.partnerDescs[pal.id]).map((pal) => pal.id);
    console.log(`アクティブスキル: 名前 ${count(skills.active)} 件・説明 ${count(skills.activeDescs)} 件、`
      + `パートナースキル: 名前 ${count(skills.partner)} 件・説明 ${count(skills.partnerDescs)} 件`
      + (lacking.length ? `（名前か説明のないパル: ${lacking.join(', ')}）` : ''));
    if (skills.missing.length) console.log(`引けなかった参照（ID のまま残した）: ${skills.missing.join(', ')}`);
  } finally {
    pak.close();
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try { main(); } catch (error) { console.error(error.message); process.exit(1); }
}
