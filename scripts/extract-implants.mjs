// ゲーム本体から、パル手術台で付けられるパッシブの表（パッシブ・必要なアイテム・その種類）と、アイテムの日本語名を取り出して
// web/data/implants.js に書き出す（UI 改善フェーズ 4 の implants。理想個体の足りないパッシブの案内・目標の「手術で完成できる」に使う）。
// 使い方: npm run extract:implants -- "<Palworld のインストール先>" [--game-version=v1.0.5]（インストール先の省略時は環境変数 PALWORLD_DIR か
//   既定の場所。--game-version は生成物の先頭のコメントに書くゲームの版。ゲームの画面のタイトルで確かめた値を渡す）
// 読み取りのみ。使う表:
//   DT_OperatingTablePassiveSkillDataTable（行の構造体 PalOperatingTablePassiveSkillData の PassiveSkill・RequireItemId）。型の情報のない
//     表なので、プロパティの並びは実行ファイルの反射データから取る（scripts/game-tables.mjs）
//   DT_ItemNameText_Common（ITEM_NAME_〈アイテム ID〉。インプラントとパルリバーサーの日本語名）
// INV-2: 手術台は配合ではない。取り込むのはパッシブ・アイテム・種類だけ。同じ行の数値（Price。意味は確かめていない）は読み進めるために
// 読むが、残さず・書き出さない（keep で PassiveSkill・RequireItemId だけを残す）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPak } from './extract-passive-icons.mjs';
import { nameMap, readNameText } from './extract-humans.mjs';
import { gameFiles, openExecutable, readDataTable } from './game-tables.mjs';
import passives from '../web/data/passives.js';

const TABLES = {
  operating: 'Pal/Content/Pal/DataTable/MapObject/DT_OperatingTablePassiveSkillDataTable',
  itemNames: 'Pal/Content/Pal/DataTable/Text/DT_ItemNameText_Common',
};
const ROW_STRUCT = 'PalOperatingTablePassiveSkillData';
const KEEP = ['PassiveSkill', 'RequireItemId'];
// 性別を変えるアイテム（パルリバーサー）。手術台の表の行ではないが、同じ手術台で使うので名前をいっしょに書き出す
export const GENDER_REVERSE_ITEM = 'PalGenderReverse';
// アイテム ID の形 → 種類（何度でも使えるインプラント・使い切りのインプラント）。アイテムのない行は free
const CONSUMABLE = /^PalPassiveSkillChange_Consumable_/;
const REUSABLE = /^PalPassiveSkillChange_/;

/**
 * 手術台の表の行から、パッシブごとの { passiveId, item, itemName, kind } を作る。
 * パッシブ ID は passives.js の ID（大文字小文字が違えば passives.js の書き方にそろえる）。passives.js にないパッシブ・知らない形の
 * アイテム・名前のないアイテム・同じパッシブの行が 2 つあるときは投げる（取り出しを止める）
 * @param {Map<string, { PassiveSkill?: string, RequireItemId?: string }>} rows 行の名前 → 値
 * @param {Map<string, string>} itemNames ITEM_NAME_〈ID〉 → 日本語名
 * @param {string[]} passiveIds passives.js の ID
 */
export function buildImplants(rows, itemNames, passiveIds) {
  const byLower = new Map(passiveIds.map((id) => [id.toLowerCase(), id]));
  const out = [];
  const seen = new Set();
  const problems = [];
  for (const [row, value] of rows) {
    const raw = value.PassiveSkill && value.PassiveSkill !== 'None' ? value.PassiveSkill : row;
    const passiveId = byLower.get(String(raw).toLowerCase());
    if (!passiveId) { problems.push(`passives.js にないパッシブ: ${raw}（行 ${row}）`); continue; }
    if (seen.has(passiveId)) { problems.push(`同じパッシブの行が 2 つあります: ${passiveId}`); continue; }
    seen.add(passiveId);
    const item = value.RequireItemId && value.RequireItemId !== 'None' ? value.RequireItemId : '';
    if (!item) { out.push({ passiveId, item: '', itemName: '', kind: 'free' }); continue; }
    const kind = CONSUMABLE.test(item) ? 'consumable' : REUSABLE.test(item) ? 'reusable' : '';
    if (!kind) { problems.push(`知らない形のアイテム: ${item}（${passiveId}）`); continue; }
    const itemName = itemNames.get(`ITEM_NAME_${item}`);
    if (!itemName) { problems.push(`アイテムの名前がありません: ${item}`); continue; }
    out.push({ passiveId, item, itemName, kind });
  }
  if (problems.length) throw new Error(`手術台の表を取り込めません:\n  ${problems.join('\n  ')}`);
  return out;
}

/** implants.js の本文（既定の書き出しは手術台の表の行の順。GENDER_REVERSE_ITEM・GENDER_REVERSE_NAME はパルリバーサー） */
export function implantsModule(list, genderReverseName, { version = '', date = '' } = {}) {
  return [
    `// パル手術台で付けられるパッシブ（ゲーム本体${version ? ` ${version}` : ''} の DT_OperatingTablePassiveSkillDataTable と、DT_ItemNameText_Common のアイテム名${date ? `。${date} に取り出し` : ''}）。`,
    '// 自動生成（npm run extract:implants = scripts/extract-implants.mjs）。手で編集しない。INV-2: 手術台は配合ではない。パッシブ・アイテム・種類だけ（表の数値は含めない）。',
    "// kind: 'free'（アイテム不要）| 'reusable'（インプラント。表の行は何度でも使える種類）| 'consumable'（使い切りインプラント）。item・itemName は free では空",
    'export default [',
    ...list.map((entry) => `  ${JSON.stringify(entry)},`),
    '];',
    '',
    '// 性別を変えるアイテム（パルリバーサー。同じパル手術台で使う）',
    `export const GENDER_REVERSE_ITEM = ${JSON.stringify(GENDER_REVERSE_ITEM)};`,
    `export const GENDER_REVERSE_NAME = ${JSON.stringify(genderReverseName)};`,
    '',
  ].join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const version = args.find((arg) => arg.startsWith('--game-version='))?.slice('--game-version='.length) ?? '';
  const gameDir = args.find((arg) => !arg.startsWith('--')) || process.env.PALWORLD_DIR || 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Palworld';
  const files = gameFiles(gameDir);
  if (!fs.existsSync(files.pak)) throw new Error(`pak が見つかりません: ${files.pak}`);
  if (!fs.existsSync(files.exe)) throw new Error(`実行ファイルが見つかりません: ${files.exe}`);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const schema = openExecutable(files.exe).structSchema(ROW_STRUCT);
  for (const name of KEEP) if (!schema.some((p) => p.name === name)) throw new Error(`${ROW_STRUCT} に ${name} の列がありません`);
  const pak = openPak(files.pak);
  try {
    const load = (base) => ({ names: nameMap(pak.get(`${base}.uasset`)), uexp: pak.get(`${base}.uexp`) });
    const table = load(TABLES.operating);
    // 残すのはパッシブとアイテムだけ（INV-2。数値の Price は書き出さない）
    const rows = readDataTable(schema, table.uexp, table.names, { keep: (name) => KEEP.includes(name) });
    const items = load(TABLES.itemNames);
    const itemNames = readNameText(items.names, items.uexp);
    const list = buildImplants(rows, itemNames, passives.map((p) => p.id));
    const genderReverseName = itemNames.get(`ITEM_NAME_${GENDER_REVERSE_ITEM}`);
    if (!genderReverseName) throw new Error(`アイテムの名前がありません: ${GENDER_REVERSE_ITEM}`);
    // 取り出した日（この PC の日付）
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    fs.writeFileSync(path.join(root, 'web', 'data', 'implants.js'), implantsModule(list, genderReverseName, { version, date }));
    const count = (kind) => list.filter((entry) => entry.kind === kind).length;
    console.log(`手術台の表: ${list.length} 行（アイテム不要 ${count('free')}・インプラント ${count('reusable')}・使い切り ${count('consumable')}）。すべて passives.js にあります`);
    console.log(`パルリバーサー: ${GENDER_REVERSE_ITEM} = ${genderReverseName}`);
  } finally {
    pak.close();
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try { main(); } catch (error) { console.error(error.message); process.exit(1); }
}
