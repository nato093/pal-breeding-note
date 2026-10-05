// ゲーム本体（Pal-Windows.pak）から、人間のキャラクター（密猟団・賞金首など）の日本語名とアイコンを取り出す。
// 所持パルの一覧で、パルのマスターにないキャラクターを表示するのに使う。
//   web/data/humans.js … キャラクター ID → 日本語名・アイコンのファイル名
//   web/img/humans/    … アイコン（128×128 の PNG）
// 使い方: npm run extract:humans -- "<Palworld のインストール先>"（省略時は環境変数 PALWORLD_DIR か既定の場所）
// 読み取りのみ。使う表: DT_PalCharacterIconDataTable_Common（アイコン）・DT_PalHumanParameter_Common（名前の ID）・
// DT_HumanNameText_Common（日本語名。ゲームの元の言語が日本語のため、この表の文字列がそのまま日本語名）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPak, readTexture, encodePng } from './extract-passive-icons.mjs';
import pals from '../web/data/pals.js';

const TABLE_DIR = 'Pal/Content/Pal/DataTable/';
const TABLES = {
  icons: `${TABLE_DIR}Character/DT_PalCharacterIconDataTable_Common`,
  humans: `${TABLE_DIR}Character/DT_PalHumanParameter_Common`,
  names: `${TABLE_DIR}Text/DT_HumanNameText_Common`,
};

function fstring(buffer, offset) {
  const n = buffer.readInt32LE(offset);
  if (n >= 0) return { value: n ? buffer.toString('utf8', offset + 4, offset + 4 + n - 1) : '', next: offset + 4 + n };
  return { value: buffer.toString('utf16le', offset + 4, offset + 4 - n * 2 - 2), next: offset + 4 - n * 2 };
}

// .uasset の名前表。概要の中の（件数, 位置）を探し、その位置から件数ぶんの文字列が読めるものを採る
export function nameMap(uasset) {
  const tryRead = (count, offset) => {
    const names = [];
    let o = offset;
    for (let i = 0; i < count; i++) {
      if (o + 4 > uasset.length) return null;
      const n = uasset.readInt32LE(o);
      if (n === 0 || Math.abs(n) > 1024) return null;
      const end = o + 4 + (n > 0 ? n : -n * 2);
      if (end > uasset.length) return null;
      if (n > 0 ? uasset[end - 1] !== 0 : uasset.readUInt16LE(end - 2) !== 0) return null;
      names.push(fstring(uasset, o).value);
      o = end + 4; // 名前のハッシュ
    }
    return names;
  };
  for (let p = 0; p + 8 <= Math.min(uasset.length, 3000); p++) {
    const count = uasset.readInt32LE(p);
    const offset = uasset.readInt32LE(p + 4);
    if (count > 3 && count < 50000 && offset > 0 && offset < uasset.length) {
      const names = tryRead(count, offset);
      if (names) return names;
    }
  }
  throw new Error('名前表が見つかりません');
}

function fname(names, buffer, offset) {
  const index = buffer.readInt32LE(offset);
  const number = buffer.readInt32LE(offset + 4);
  if (index < 0 || index >= names.length) throw new Error(`名前の番号が範囲外です: ${index}`);
  return number ? `${names[index]}_${number - 1}` : names[index];
}

// データ表の行の並び（先頭 10 バイトの後に行数、各行は名前と、属性の有無を表す 2 バイト 00 03 で始まる）
function rows(names, uexp, readRow) {
  const count = uexp.readInt32LE(10);
  let o = 14;
  const out = new Map();
  for (let i = 0; i < count; i++) {
    const key = fname(names, uexp, o);
    if (uexp[o + 8] !== 0 || uexp[o + 9] !== 3) throw new Error(`想定と違う行の形式です: ${key}`);
    const result = readRow(o + 10);
    out.set(key, result.value);
    o = result.next;
  }
  return out;
}

export function readIconTable(names, uexp) {
  return rows(names, uexp, (o) => {
    const pkg = fname(names, uexp, o);
    const sub = fstring(uexp, o + 16);
    return { value: pkg, next: sub.next };
  });
}

export function readNameText(names, uexp) {
  return rows(names, uexp, (o) => {
    let p = o + 4; // flags
    const history = uexp.readInt8(p); p += 1;
    if (history === 0) {
      const ns = fstring(uexp, p); const key = fstring(uexp, ns.next); const source = fstring(uexp, key.next);
      return { value: source.value, next: source.next };
    }
    if (history === -1) {
      const has = uexp.readInt32LE(p); p += 4;
      if (!has) return { value: '', next: p };
      const source = fstring(uexp, p);
      return { value: source.value, next: source.next };
    }
    throw new Error(`未対応の文字列の形式です: ${history}`);
  });
}

// 人間の能力表から、行ごとの名前の ID（NAME_…）を拾う。行の中身は形式の情報がないため、行名の 22 バイト後にある名前を読む
export function readHumanNameIds(names, uexp, ids) {
  const index = new Map(names.map((name, i) => [name, i]));
  const out = new Map();
  for (const id of ids) {
    if (!index.has(id)) continue;
    const marker = Buffer.alloc(8);
    marker.writeInt32LE(index.get(id), 0);
    const at = uexp.indexOf(marker, 14);
    if (at < 0 || at + 30 > uexp.length) continue;
    try {
      const nameId = fname(names, uexp, at + 22);
      if (nameId.startsWith('NAME_')) out.set(id, nameId);
    } catch { /* この行は名前なし */ }
  }
  return out;
}

function main() {
  const gameDir = process.argv[2] || process.env.PALWORLD_DIR || 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Palworld';
  const pakFile = path.join(gameDir, 'Pal', 'Content', 'Paks', 'Pal-Windows.pak');
  if (!fs.existsSync(pakFile)) throw new Error(`pak が見つかりません: ${pakFile}`);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const imgDir = path.join(root, 'web', 'img', 'humans');
  fs.mkdirSync(imgDir, { recursive: true });
  const pak = openPak(pakFile);
  try {
    const load = (base) => ({ names: nameMap(pak.get(`${base}.uasset`)), uexp: pak.get(`${base}.uexp`) });
    const iconTable = load(TABLES.icons);
    const humanTable = load(TABLES.humans);
    const nameTable = load(TABLES.names);
    const icons = readIconTable(iconTable.names, iconTable.uexp);
    const texts = readNameText(nameTable.names, nameTable.uexp);
    const palIds = new Set(pals.map((pal) => pal.id.toLowerCase()));
    const humanIds = [...icons.keys()].filter((id) => humanTable.names.includes(id) && !palIds.has(id.toLowerCase()));
    const nameIds = readHumanNameIds(humanTable.names, humanTable.uexp, humanIds);
    const written = new Set();
    const list = [];
    for (const id of humanIds.sort()) {
      const texture = icons.get(id);
      if (!texture || /dummy/i.test(texture)) continue;
      const file = `${texture.split('/').pop()}.png`;
      if (!written.has(file)) {
        const asset = texture.replace(/^\/Game\//, 'Pal/Content/');
        const bulk = pak.has(`${asset}.ubulk`) ? pak.get(`${asset}.ubulk`) : null;
        const { width, height, rgba } = readTexture(pak.get(`${asset}.uexp`), bulk);
        fs.writeFileSync(path.join(imgDir, file), encodePng(width, height, rgba));
        written.add(file);
      }
      const ja = texts.get(nameIds.get(id) ?? '') ?? '';
      list.push({ id, ja: ja && ja !== '-' ? ja : '', icon: file });
    }
    const body = list.map((h) => `  ${JSON.stringify(h)},`).join('\n');
    fs.writeFileSync(path.join(root, 'web', 'data', 'humans.js'),
      `// 人間のキャラクターの日本語名とアイコン（ゲーム本体から npm run extract:humans で生成。手で直さない）\nexport default [\n${body}\n];\n`);
    console.log(`人間のキャラクター: ${list.length} 件（名前あり ${list.filter((h) => h.ja).length} 件）、アイコン ${written.size} 枚`);
  } finally {
    pak.close();
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try { main(); } catch (error) { console.error(error.message); process.exit(1); }
}
