// ゲーム本体から、パルの作業適性（火おこし・採掘など、作業の種類ごとの Lv）と作業の日本語名を取り出して web/data/work.js に書き出す。
// パル詳細の「作業適性」の行と、所持パルのキーワード（「採掘」「採掘3」＝採掘 Lv 3 以上）に使う（UI 改善フェーズ 4 の game-assets）。
// 使い方: npm run extract:work -- "<Palworld のインストール先>"（省略時は環境変数 PALWORLD_DIR か既定の場所）
// 読み取りのみ。使う表:
//   DT_PalMonsterParameter_Common（行の構造体 PalCharacterParameterDatabaseRow の WorkSuitability_〈作業の鍵〉。int）。型の情報のない表なので、
//     プロパティの並びは実行ファイルの反射データから取る（scripts/game-tables.mjs）
//   DT_UI_Common_Text_Common（COMMON_WORK_SUITABILITY_〈作業の鍵〉。作業の日本語名）
// INV-2: 同じ行にある配合の値（CombiRank など）は読み進めるために読むが、残さず・書き出さない（keep で WorkSuitability_* だけを残す）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPak } from './extract-passive-icons.mjs';
import { nameMap, readNameText } from './extract-humans.mjs';
import { gameFiles, openExecutable, readDataTable, readers } from './game-tables.mjs';
import { UI_ICONS } from './extract-ui-icons.mjs';
import pals from '../web/data/pals.js';

const TABLES = {
  monsters: 'Pal/Content/Pal/DataTable/Character/DT_PalMonsterParameter_Common',
  ui: 'Pal/Content/Pal/DataTable/Text/DT_UI_Common_Text_Common',
};
const ROW_STRUCT = 'PalCharacterParameterDatabaseRow';
const WORK_PREFIX = 'WorkSuitability_';

/**
 * 表の行から、パル ID → { 作業の鍵: Lv }（Lv 1 以上の整数だけ）と、作業の鍵の並び（表の列の順。どのパルも持たない作業は外す）を作る。
 * パル ID はマスター（pals.js）の ID。表の行の名前とは大文字小文字をそろえて引く
 * @param {Map<string, object>} rows 行の名前 → { WorkSuitability_〈鍵〉: Lv }
 * @param {string[]} columns 構造体の WorkSuitability_* の列の名前（並び順）
 * @param {string[]} palIds
 */
export function buildWork(rows, columns, palIds) {
  const byLower = new Map([...rows.keys()].map((key) => [key.toLowerCase(), key]));
  const keys = columns.map((column) => column.slice(WORK_PREFIX.length));
  const work = {};
  const missing = [];
  for (const id of palIds) {
    const row = rows.get(byLower.get(id.toLowerCase()));
    if (!row) { missing.push(id); continue; }
    const entry = {};
    for (const key of keys) {
      const level = row[`${WORK_PREFIX}${key}`];
      if (Number.isInteger(level) && level > 0) entry[key] = level;
    }
    work[id] = entry;
  }
  const used = keys.filter((key) => Object.values(work).some((entry) => entry[key]));
  return { work, keys: used, missing };
}

/** work.js の本文（作業の鍵 → 日本語名・アイコン、既定の書き出しはパル ID → { 作業の鍵: Lv }） */
export function workModule({ work, keys }, labels) {
  const kinds = keys.map((key) => `  ${JSON.stringify(key)}: ${JSON.stringify({ ja: labels.get(key) ?? key, icon: UI_ICONS[`work/${key}`] ? `${key}.png` : '' })},`);
  const lines = Object.entries(work).map(([id, entry]) => `  ${JSON.stringify(id)}: ${JSON.stringify(entry)},`);
  return [
    '// 作業適性（ゲーム本体の DT_PalMonsterParameter_Common の WorkSuitability_* と、DT_UI_Common_Text_Common の作業の名前）。',
    '// 自動生成（npm run extract:work = scripts/extract-work.mjs）。手で編集しない。配合の値（CombiRank など）は含めない（INV-2）。',
    '// WORKS: 作業の鍵 → { ja: 日本語名, icon: web/img/work/ のファイル名（なければ空） }。並びはゲームの表の列の順',
    'export const WORKS = {',
    ...kinds,
    '};',
    '',
    '// パル ID（pals.js の ID）→ { 作業の鍵: Lv }（Lv 1 以上だけ）',
    'export default {',
    ...lines,
    '};',
    '',
  ].join('\n');
}

function main() {
  const gameDir = process.argv[2] || process.env.PALWORLD_DIR || 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Palworld';
  const files = gameFiles(gameDir);
  if (!fs.existsSync(files.pak)) throw new Error(`pak が見つかりません: ${files.pak}`);
  if (!fs.existsSync(files.exe)) throw new Error(`実行ファイルが見つかりません: ${files.exe}`);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const schema = openExecutable(files.exe).structSchema(ROW_STRUCT);
  const columns = schema.filter((p) => p.name.startsWith(WORK_PREFIX) && p.type === 'Int').map((p) => p.name);
  if (!columns.length) throw new Error(`${ROW_STRUCT} に ${WORK_PREFIX}* の列がありません`);
  const pak = openPak(files.pak);
  try {
    const load = (base) => ({ names: nameMap(pak.get(`${base}.uasset`)), uexp: pak.get(`${base}.uexp`) });
    const monsters = load(TABLES.monsters);
    // 入れ子の構造体（絵の位置の FVector）は読み方を渡す。残すのは作業適性の列だけ（INV-2）
    const rows = readDataTable(schema, monsters.uexp, monsters.names, {
      keep: (name) => columns.includes(name),
      overrides: { MeshRelativeLocation: readers.vector },
    });
    const ui = load(TABLES.ui);
    const texts = readNameText(ui.names, ui.uexp);
    const result = buildWork(rows, columns, pals.map((pal) => pal.id));
    const labels = new Map(result.keys.map((key) => [key, texts.get(`COMMON_WORK_SUITABILITY_${key}`)]).filter(([, ja]) => ja && ja !== '-'));
    for (const key of result.keys) if (!labels.has(key)) console.warn(`作業の名前がありません: ${key}`);
    fs.writeFileSync(path.join(root, 'web', 'data', 'work.js'), workModule(result, labels));
    console.log(`作業の種類: ${result.keys.length}（${result.keys.map((key) => `${key}=${labels.get(key) ?? '?'}`).join('・')}）`);
    console.log(`パル: ${Object.keys(result.work).length} 体（表にない ${result.missing.length} 体${result.missing.length ? `: ${result.missing.join(', ')}` : ''}）`);
  } finally {
    pak.close();
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try { main(); } catch (error) { console.error(error.message); process.exit(1); }
}
