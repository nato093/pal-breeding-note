// 専用サーバーのゲームの設定（PalWorldSettings.ini の OptionSettings）を、協力プレイのワールドの設定（WorldOption.sav）と比べる。
// 使い方: node scripts/server-settings.mjs --coop "<協力プレイのワールドのフォルダ>" --instance "<ServerSync のインスタンスのフォルダ>" [--apply game|<キー,キー>]
//   --ini "<PalWorldSettings.ini>" でファイルを直接指定してもよい。既定は読み取りだけ（差の表を出す）。
//   --apply は PalServer が動いていないときだけ、ini の OptionSettings の中の対象の Key=Value だけを協力プレイの値に書き換える
//   （ほかの部分は 1 バイトも変えない。書く前に同じフォルダへ写しを残す。ServerSync は止まっている間の手での編集を取り込む）。
// パスワードの項目（/password/i）は読まない・比べない・書かない・出さない（docs/server/README.md の P0）。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readGvas } from '../web/js/save/gvas.js';
import { decompressSav } from '../web/js/save/import.js';

const SECRET = /password/i;

// サーバーだけの値（協力プレイの値に合わせない）。Difficulty は協力プレイの画面の呼び名（Custom）で、個々の値が効く
export const SERVER_KEYS = new Set([
  'ServerName', 'ServerDescription', 'ServerPlayerMaxNum', 'PublicPort', 'PublicIP', 'RCONEnabled', 'RCONPort', 'Region', 'bUseAuth',
  'BanListURL', 'RESTAPIEnabled', 'RESTAPIPort', 'bShowPlayerList', 'CrossplayPlatforms', 'LogFormatType', 'bIsMultiplay',
  'CoopPlayerMaxNum', 'bIsUseBackupSaveData', 'AutoSaveSpan', 'bAllowClientMod', 'Difficulty',
].map((key) => key.toLowerCase()));

// 協力プレイに合わせる前に確かめる値（公式の説明: ギルドのメンバーが誰もログインしないと、拠点と建物を消す。
// 遊ぶときだけ動かすサーバーでは、間を空けて再開すると消えうる）
export const REVIEW_KEYS = new Set(['bAutoResetGuildNoOnlinePlayers'].map((key) => key.toLowerCase()));

// 画面に出さない値（手元の出力でも伏せる）
const MASKED_KEYS = new Set(['ServerName', 'ServerDescription', 'PublicIP'].map((key) => key.toLowerCase()));

/**
 * ini の本文から OptionSettings=( … ) の中の Key=Value を、位置つきで取り出す（引用符と括弧の入れ子を考える）。
 * @returns {{ entries: Array<{ key: string, raw: string, start: number, end: number }> } | null}
 */
export function parseOptionSettings(text) {
  const head = /OptionSettings=\(/.exec(text);
  if (!head) return null;
  const entries = [];
  let i = head.index + head[0].length;
  let depth = 1;
  let quoted = false;
  let tokenStart = i;
  const flush = (end) => {
    const token = text.slice(tokenStart, end);
    const eq = token.indexOf('=');
    if (eq > 0) {
      const key = token.slice(0, eq).trim();
      const valueStart = tokenStart + eq + 1;
      entries.push({ key, raw: text.slice(valueStart, end), start: valueStart, end });
    }
  };
  for (; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        flush(i);
        return { entries };
      }
    } else if (ch === ',' && depth === 1) {
      flush(i);
      tokenStart = i + 1;
    }
  }
  return null;
}

// ini の値を比べられる形にする: "…" → 文字列、True/False → 真偽値、数 → 数、(a,b) → 配列、ほかは列挙の名前
export function iniValue(raw) {
  const text = String(raw).trim();
  if (/^".*"$/s.test(text)) return text.slice(1, -1);
  if (/^true$/i.test(text)) return true;
  if (/^false$/i.test(text)) return false;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (/^\(.*\)$/s.test(text)) {
    const inner = text.slice(1, -1).trim();
    return inner ? inner.split(',').map((item) => item.trim().replace(/^"(.*)"$/s, '$1')) : [];
  }
  return text;
}

// WorldOption.sav の値を同じ形にする（列挙の EPal…::Item は Item に）
const enumName = (value) => (typeof value === 'string' && value.includes('::') ? value.slice(value.lastIndexOf('::') + 2) : value);
function worldValue(value) {
  if (Array.isArray(value)) return value.map(enumName);
  return enumName(value);
}

/** WorldOption.sav の properties から、設定の { キー: 値 } を作る（パスワードの項目は入れない） */
export function worldOptionSettings(properties) {
  const settings = properties?.OptionWorldData?.Settings;
  if (!settings || typeof settings !== 'object') return null;
  const out = {};
  for (const [key, value] of Object.entries(settings)) {
    if (SECRET.test(key)) continue;
    out[key] = worldValue(value);
  }
  return out;
}

/** ini の本文から、設定の { キー: 値 } を作る（パスワードの項目は入れない） */
export function iniSettings(text) {
  const parsed = parseOptionSettings(text);
  if (!parsed) return null;
  const out = {};
  for (const entry of parsed.entries) {
    if (SECRET.test(entry.key)) continue;
    out[entry.key] = iniValue(entry.raw);
  }
  return out;
}

function sameValue(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => String(item) === String(b[i]));
  return a === b;
}

/**
 * 差の一覧（キーの大文字小文字は区別しない）。kind: game（協力プレイに合わせる候補）・server（サーバーだけの値）・review（合わせる前に確かめる）・
 * only-coop（ini にない。サーバーは既定の値で動く）・only-server（WorldOption.sav にない）
 */
export function compareSettings(coop, server) {
  const coopKeys = new Map(Object.keys(coop).map((key) => [key.toLowerCase(), key]));
  const serverKeys = new Map(Object.keys(server).map((key) => [key.toLowerCase(), key]));
  const rows = [];
  for (const lower of new Set([...coopKeys.keys(), ...serverKeys.keys()])) {
    if (SECRET.test(lower)) continue;
    const coopKey = coopKeys.get(lower);
    const serverKey = serverKeys.get(lower);
    const key = serverKey ?? coopKey;
    if (!coopKey || !serverKey) {
      rows.push({ key, coop: coopKey ? coop[coopKey] : undefined, server: serverKey ? server[serverKey] : undefined, kind: coopKey ? 'only-coop' : 'only-server' });
      continue;
    }
    if (sameValue(coop[coopKey], server[serverKey])) continue;
    const kind = SERVER_KEYS.has(lower) ? 'server' : REVIEW_KEYS.has(lower) ? 'review' : 'game';
    rows.push({ key, coop: coop[coopKey], server: server[serverKey], kind });
  }
  const order = { game: 0, review: 1, server: 2, 'only-coop': 3, 'only-server': 4 };
  return rows.sort((a, b) => order[a.kind] - order[b.kind] || a.key.localeCompare(b.key));
}

/** 値を ini の書き方にする（数の小数の桁と引用符は今のトークンに合わせる） */
export function formatIniValue(value, previousRaw = '') {
  const previous = String(previousRaw).trim();
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') {
    const decimals = /^-?\d+\.(\d+)$/.exec(previous)?.[1].length ?? 0;
    return decimals ? value.toFixed(decimals) : String(Math.round(value));
  }
  if (Array.isArray(value)) return `(${value.join(',')})`;
  if (/^".*"$/s.test(previous)) return `"${value}"`;
  return String(value);
}

/**
 * ini の本文の対象の Key=Value だけを書き換えた本文を返す（ほかは同じバイト）。ini にないキーは足さない。
 * @param {Map<string, unknown>|Record<string, unknown>} changes キー（大文字小文字は区別しない）→ 新しい値
 */
export function replaceOptionSettings(text, changes) {
  const parsed = parseOptionSettings(text);
  if (!parsed) throw new Error('OptionSettings が見つかりません');
  const wanted = new Map([...(changes instanceof Map ? changes : Object.entries(changes))].map(([key, value]) => [key.toLowerCase(), value]));
  for (const key of wanted.keys()) if (SECRET.test(key)) throw new Error('パスワードの項目は書き換えません');
  let out = text;
  // 後ろから置き換えると、前の位置がずれない
  for (const entry of [...parsed.entries].reverse()) {
    const lower = entry.key.toLowerCase();
    if (!wanted.has(lower)) continue;
    out = out.slice(0, entry.start) + formatIniValue(wanted.get(lower), entry.raw) + out.slice(entry.end);
  }
  return out;
}

const show = (key, value) => {
  if (value === undefined) return '（なし）';
  if (MASKED_KEYS.has(key.toLowerCase())) return '（伏せた）';
  return Array.isArray(value) ? `(${value.join(',')})` : String(value);
};

const KIND_LABEL = { game: '合わせる候補', review: '要確認', server: 'サーバーだけの値', 'only-coop': 'ini にない（既定で動く）', 'only-server': 'WorldOption.sav にない' };

export function formatRows(rows) {
  if (!rows.length) return '差はありません。';
  return rows.map((row) => `[${KIND_LABEL[row.kind]}] ${row.key}: 協力プレイ ${show(row.key, row.coop)} ／ サーバー ${show(row.key, row.server)}`).join('\n');
}

function palServerRunning() {
  try {
    const out = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
    return /"PalServer[^"]*\.exe"/i.test(out);
  } catch {
    return null;
  }
}

function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const coopArg = argValue(args, '--coop');
  const instance = argValue(args, '--instance');
  const iniPath = argValue(args, '--ini') ?? (instance ? path.join(instance, 'bin', 'Pal', 'Saved', 'Config', 'WindowsServer', 'PalWorldSettings.ini') : undefined);
  const apply = argValue(args, '--apply');
  if (!coopArg || !iniPath) throw new Error('使い方: node scripts/server-settings.mjs --coop "<協力プレイのワールドのフォルダ>" --instance "<インスタンスのフォルダ>" [--apply game|<キー,キー>]');
  const optionFile = coopArg.toLowerCase().endsWith('.sav') ? coopArg : path.join(coopArg, 'WorldOption.sav');
  const { properties } = readGvas(await decompressSav(new Uint8Array(fs.readFileSync(optionFile))));
  const coop = worldOptionSettings(properties);
  if (!coop) throw new Error('WorldOption.sav に設定がありません');
  const text = fs.readFileSync(iniPath, 'utf8');
  const server = iniSettings(text);
  if (!server) throw new Error('ini に OptionSettings がありません');
  const rows = compareSettings(coop, server);
  console.log(formatRows(rows));
  if (!apply) return;
  const keys = apply === 'game'
    ? rows.filter((row) => row.kind === 'game').map((row) => row.key)
    : apply.split(',').map((key) => key.trim()).filter(Boolean);
  const changes = new Map();
  for (const key of keys) {
    const row = rows.find((item) => item.key.toLowerCase() === key.toLowerCase());
    if (!row || row.coop === undefined || row.server === undefined) throw new Error(`書き換えられない項目です: ${key}`);
    changes.set(row.key, row.coop);
  }
  if (!changes.size) {
    console.log('書き換える項目はありません。');
    return;
  }
  const running = palServerRunning();
  if (running !== false) throw new Error(running ? 'PalServer が動いています。止めてから書き換えてください' : 'PalServer が動いているかを確かめられませんでした');
  const next = replaceOptionSettings(text, changes);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
  fs.copyFileSync(iniPath, `${iniPath}.before-${stamp}`);
  fs.writeFileSync(iniPath, next);
  console.log(`書き換えました（${[...changes.keys()].join('・')}）。元の写し: ${path.basename(iniPath)}.before-${stamp}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}
