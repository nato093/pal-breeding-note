// 端末や共有から読み戻すデータ（IndexedDB・ブラウザのストレージ・サーバの応答）を、使う前に確かめて整える。DOM には触れない。
// - 形が根本から違う（配列のはずが配列でない・object でない）ものは、呼び出す側が「データなし」（null）かエラーにする
// - 要素ごとの不正は、その要素だけを捨てるか既定の値に直す（読める分は残す）
// - 保存し直さず、読み出すたびに直す（旧コードのまま開いているタブが書いた値も、読み出しで直る）
// - 正しいデータでは、結果が今と同じになるようにする
// 上限は GAS と同じ値（core/owned-shared.js）にそろえる。GAS には複写しない（scripts/build-gas.mjs の SHARED_FILES に入れない）。
//
// 項目ごとの既定値（欠けている・壊れているとき。後から項目を足すテーマは、ここと docs/ui-refactor/phase-1a-foundation.md の表に足す）
// - 個体値 0〜100（既定 0）・レベル 1〜999（既定 1、タマゴは 0）・ランク 1〜5（既定 1）: core/owned.js
// - 後から足す項目は intOrNull などで「不明」（null）を表し、欠けと 0 を区別する
import { sanitizeText } from './validate.js';
import { OWNED_MAX_ROWS, cleanOwnedFarms, ownedWorldId } from './owned-shared.js';

export const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** 有限の整数にして範囲に収める。数にならなければ fallback（欠けている・壊れている）。'12' は 12、12.7 は 12 */
export function int(value, { min = -Infinity, max = Infinity, fallback = 0 } = {}) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

/** 欠けている（undefined・null・''）なら null、それ以外は int と同じ（数にならなければ fallback。既定は null＝不明）。「0」と「欠けている」を区別するとき */
export function intOrNull(value, range = {}) {
  if (value === undefined || value === null || value === '') return null;
  return int(value, { fallback: null, ...range });
}

// 整える必要のない（制御文字も前後の空白もなく、上限に収まる）文字列は、そのまま使う（共有の 20,000 行 × 27 列でも置き換えを繰り返さない）。
// \s は String.prototype.trim が除く空白と同じ
const NEEDS_CLEAN = /[\u0000-\u001f\u007f-\u009f]|^\s|\s$/;

/** 文字列だけを受け取り、制御文字を除いて max 字で切る（前後の空白も除く。core/validate.js の sanitizeText と同じ）。文字列でなければ fallback */
export function text(value, max, fallback = '') {
  if (typeof value !== 'string') return fallback;
  if (!value) return value;
  return value.length <= max && !NEEDS_CLEAN.test(value) ? value : sanitizeText(value, max);
}

/** ID のように、そのまま比べる文字列。1〜max 字の文字列ならそのまま、違えば ''（切り詰めると別の ID になるので切らない） */
export function idText(value, max = 64) {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : '';
}

export const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

/** 範囲の中の整数ならそのまま、違えば fallback（範囲に丸めない。保存した画面の条件のように、合わない値を既定に戻すとき） */
export function intIn(value, { min = -Infinity, max = Infinity, fallback = 0 } = {}) {
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

/** 真偽値ならそのまま、違えば fallback */
export const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);

/** 画面内のハッシュ（#/ で始まり max 字まで）ならそのまま、違えば ''。外部の URL や script を開かないよう、通知の href などに使う */
export function screenHref(value, max = 300) {
  return typeof value === 'string' && value.startsWith('#/') && value.length <= max ? value : '';
}

/** Date.parse できる文字列ならそのまま、でなければ '' */
export function isoTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : '';
}

/** 配列でなければ []。max 件まで。map が null（undefined）を返した要素は捨てる。key があれば同じ key の後の要素を捨てる（先勝ち） */
export function list(value, { max = Infinity, map = (item) => item, key } = {}) {
  if (!Array.isArray(value)) return [];
  const result = [];
  const seen = key ? new Set() : null;
  for (const item of value) {
    if (result.length >= max) break;
    const mapped = map(item);
    if (mapped === null || mapped === undefined) continue;
    if (seen) {
      const name = key(mapped);
      if (seen.has(name)) continue;
      seen.add(name);
    }
    result.push(mapped);
  }
  return result;
}

/** 32 桁の 16 進を大文字に。違えば '' */
export const worldId = (value) => ownedWorldId(value);

/**
 * schema の項目ごとに、合わない値だけ既定に戻す（版では捨てず、項目ごとの形で捨てる）。schema にない項目は残さない。
 * @param {Record<string, (value: unknown) => unknown>} schema 項目の名前 → 値を直す関数（合わなければ既定の値を返す）
 */
export function cleanSaved(value, schema) {
  const source = isObject(value) ? value : {};
  return Object.fromEntries(Object.entries(schema).map(([name, clean]) => [name, clean(source[name])]));
}

// ---------------------------------------------------------------------------
// 配合の記録（サーバの応答・端末に残したキャッシュ）
// ---------------------------------------------------------------------------

// 長さの上限（core/validate.js の registrant 30 字・memo 200 字と同じ）。パルの ID はマスターにないものも捨てない（新しいパルの登録を古い画面で消さない）
const RECORD_TEXT = { parent1Id: 64, parent2Id: 64, childId: 64, registrant: 30, memo: 200, etag: 200 };
const USERS_MAX = 1000;
const WARNINGS_MAX = 1000;

// 届いた項目だけを直す（欠けている項目は足さない。知らない項目はそのまま残す）
function cleanRecord(value) {
  if (!isObject(value) || !idText(value.id)) return null;
  const record = { ...value };
  for (const [field, max] of Object.entries(RECORD_TEXT)) if (value[field] !== undefined) record[field] = text(value[field], max);
  for (const field of ['parent1Gender', 'parent2Gender']) if (value[field] !== undefined) record[field] = oneOf(value[field], ['M', 'F', ''], '');
  if (value.confirmCount !== undefined) record.confirmCount = int(value.confirmCount, { min: 0 });
  for (const field of ['createdAt', 'updatedAt']) if (value[field] !== undefined) record[field] = isoTime(value[field]);
  return record;
}

/** 配合の記録の一覧。id（1〜64 字）がないものと、同じ id の後のものを捨てる */
export const cleanRecords = (records) => list(records, { map: cleanRecord, key: (record) => record.id });

/** 登録しているユーザーの ID（1〜64 字）。重複を除き、最大 1000 件 */
export const cleanUsers = (users) => list(users, { max: USERS_MAX, map: (userId) => idText(userId) || null, key: (userId) => userId });

/** 全件（records・warnings・users）を整える。形の確認（サーバとの通信の validSnapshot）を通ったものに使う */
export function cleanSnapshot(snapshot) {
  return {
    ...snapshot,
    records: cleanRecords(snapshot.records),
    warnings: list(snapshot.warnings, { max: WARNINGS_MAX, map: (warning) => (isObject(warning) ? warning : null) }),
    users: cleanUsers(snapshot.users),
  };
}

// ---------------------------------------------------------------------------
// 所持パルの共有（サーバの応答・IndexedDB のキャッシュ）
// ---------------------------------------------------------------------------

const WORLDS_MAX = 200;
// core/owned-shared.js の validateOwnedUpload と同じ上限（プレイヤー 100 件・拠点 200 件・セル 200 字、skillIds は 1000 字）
export const PLAYERS_MAX = 100;
export const BASES_MAX = 200;
const CELL_MAX = 200;
const CELL_LONG = { skillIds: 1000 };

/** 共有のプレイヤー（uid 40 字・名前 50 字。uid が空・40 字を超えるものは捨てる。uid は個体の所持者と比べるので切り詰めない） */
export const cleanSharedPlayers = (value) => list(value, {
  max: PLAYERS_MAX, map: (player) => (isObject(player) && idText(player.uid, 40) ? { uid: player.uid, name: text(player.name, 50) } : null),
});

/** 共有の拠点（id 40 字・名前 60 字。id が空・40 字を超えるものは捨てる） */
export const cleanSharedBases = (value) => list(value, {
  max: BASES_MAX, map: (base) => (isObject(base) && idText(base.id, 40) ? { id: base.id, label: text(base.label, 60) } : null),
});

// 共有されたワールドの行（GAS の readOwnedWorlds_ と同じ項目・同じ順。owned.js は JSON の文字列で変化を比べる）
function cleanWorld(value) {
  if (!isObject(value)) return null;
  const id = worldId(value.worldId);
  if (!id) return null;
  return {
    worldId: id, worldName: text(value.worldName, 100), hostName: text(value.hostName, 50),
    saveUpdatedAt: isoTime(value.saveUpdatedAt), uploadedAt: isoTime(value.uploadedAt), uploadedBy: text(value.uploadedBy, 20),
    palCount: int(value.palCount, { min: 0, max: OWNED_MAX_ROWS }),
    players: cleanSharedPlayers(value.players), bases: cleanSharedBases(value.bases),
    // 牧場を共有する前のデータ（farms がない）は null のまま（「牧場の情報がない」を「牧場なし」の [] と区別する）
    farms: Array.isArray(value.farms) ? cleanOwnedFarms(value.farms) : null,
  };
}

/** 共有されたワールドの一覧。worldId（32 桁）が不正なもの・同じ worldId の後のものを捨て、最大 200 件 */
export const cleanOwnedWorlds = (worlds) => list(worlds, { max: WORLDS_MAX, map: cleanWorld, key: (world) => world.worldId });

const cellText = (value, max) => (typeof value === 'string' ? text(value, max)
  : typeof value === 'number' || typeof value === 'boolean' ? String(value) : '');

/**
 * 1 ワールドの所持パル（{ world, columns, rows }）を整える。columns・rows が配列でなければ null。
 * world は不正なら null（データなし）。行は列の幅にそろえ、配列でない行・個体 ID が空の行・同じ個体 ID の後の行を捨て、最大 OWNED_MAX_ROWS 行。
 * 列は位置を保ち、文字列でない列名は ''（どの項目にも使わない）にする（core/owned.js の ownedFromShared は列名で引く）。
 */
export function cleanOwnedPayload(value) {
  if (!isObject(value) || !Array.isArray(value.columns) || !Array.isArray(value.rows)) return null;
  const columns = value.columns.map((field) => (typeof field === 'string' ? field : ''));
  const limits = columns.map((field) => CELL_LONG[field] ?? CELL_MAX);
  // 同じ列名が 2 つあれば、ownedFromShared と同じく後の列を使う
  const idAt = new Map(columns.map((field, i) => [field, i])).get('instanceId');
  const seen = new Set();
  const rows = [];
  for (const row of value.rows) {
    if (rows.length >= OWNED_MAX_ROWS) break;
    if (!Array.isArray(row)) continue;
    // 直すセルがなく幅も同じ行（ふつうの行）は、元の配列をそのまま使う（20,000 行の配列を作り直さない）
    let cells = row.length === columns.length ? null : new Array(columns.length);
    for (let i = 0; i < columns.length; i++) {
      const cell = cellText(row[i], limits[i]);
      if (cells) cells[i] = cell;
      else if (cell !== row[i]) { cells = row.slice(); cells[i] = cell; }
    }
    cells ??= row;
    const id = idAt === undefined ? '' : cells[idAt];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rows.push(cells);
  }
  return { world: cleanWorld(value.world), columns, rows };
}
