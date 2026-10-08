// 自動生成・手で編集しない。scripts/build-gas.mjs で生成。

function pairKey(a, b) {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

function normalizeRecord(rec) {
  if (rec.parent1Id <= rec.parent2Id) return { ...rec };
  return {
    ...rec,
    parent1Id: rec.parent2Id,
    parent2Id: rec.parent1Id,
    parent1Gender: rec.parent2Gender,
    parent2Gender: rec.parent1Gender,
  };
}

function identityKey(rec) {
  return `${pairKey(rec.parent1Id, rec.parent2Id)}>${rec.childId}`;
}

function sanitizeText(s, max) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, max);
}

function validateRecordInput(input, palIdSet) {
  const source = input ?? {};
  const value = {};
  const errors = [];
  for (const field of ['parent1Id', 'parent2Id', 'childId']) {
    value[field] = source[field];
    if (!palIdSet.has(value[field])) errors.push({ field, code: 'INVALID_PAL_ID' });
  }
  for (const field of ['parent1Gender', 'parent2Gender']) {
    value[field] = source[field] ?? '';
    if (!['M', 'F', ''].includes(value[field])) errors.push({ field, code: 'INVALID_GENDER' });
  }
  for (const [field, max] of [['registrant', 30], ['memo', 200]]) {
    // 切り詰める前に検証し、長すぎる入力を黙って保存しない。
    value[field] = sanitizeText(source[field], Infinity);
    if (value[field].length > max) errors.push({ field, code: 'TOO_LONG' });
  }
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

function needsSheetQuote(s) {
  return /^[=+\-@']/.test(String(s ?? ''));
}

function quoteForSheet(s) {
  const text = String(s ?? '');
  return needsSheetQuote(text) ? `'${text}` : text;
}

function userIdKey(userId) {
  return userId.normalize('NFKC').toLowerCase();
}

function validateUserId(input) {
  if (typeof input !== 'string') {
    return { ok: false, errors: [{ field: 'userId', code: input == null ? 'REQUIRED' : 'INVALID_TYPE' }] };
  }
  const value = input.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  const code = !value ? 'REQUIRED' : value.length > 20 ? 'TOO_LONG' : '';
  return code ? { ok: false, errors: [{ field: 'userId', code }] } : { ok: true, value };
}

// 所持パルをスプレッドシートで共有するときの形。画面・GAS（npm run build:gas で gas/Shared.js に複写）・開発用 API で同じ定義を使う。
// GAS に複写するため import は使わない。

// 1 体ぶんの列（この順番で配列にして送る）。列を足すときは末尾に足し、GAS を更新する
const OWNED_FIELDS = [
  'instanceId', 'palId', 'palName', 'characterId', 'nickname', 'gender', 'level', 'rank', 'stars',
  'passiveIds', 'passive1', 'passive2', 'passive3', 'passive4', 'talentHp', 'talentShot', 'talentDefense',
  'lucky', 'alpha', 'egg', 'place', 'placeLabel', 'holderUid', 'holder', 'baseId', 'lastOwner',
];
const OWNED_MAX_ROWS = 20000;
// 配合牧場（ワールドの行に JSON で持つ）。牧場の ID・拠点・親（個体 ID、2 体まで）。
// 1 件は JSON で 180 字ほどなので、セル（5 万字まで）に収まる数に限る
const OWNED_MAX_FARMS = 200;

/** 配合牧場の一覧を検証して整える（形の合わないものは捨てる）。 */
function cleanOwnedFarms(value) {
  if (!Array.isArray(value)) return [];
  const farms = [];
  for (const farm of value.slice(0, OWNED_MAX_FARMS)) {
    if (!farm || typeof farm !== 'object') continue;
    const id = ownedText(farm.id, 40);
    const parents = Array.isArray(farm.parents) ? farm.parents.filter((parent) => typeof parent === 'string').map((parent) => ownedText(parent, 40)).filter(Boolean) : [];
    if (!id || parents.length > 2) continue;
    farms.push({ id, baseId: ownedText(farm.baseId, 40), parents });
  }
  return farms;
}

function ownedText(value, max) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, max);
}

function ownedWorldId(value) {
  const id = String(value ?? '').trim().toUpperCase();
  return /^[0-9A-F]{32}$/.test(id) ? id : '';
}

/**
 * 所持パルのアップロードを検証して整える。
 * @returns {{ ok: true, value: object } | { ok: false, errors: { field: string, code: string }[] }}
 */
function validateOwnedUpload(input) {
  const source = input ?? {};
  const errors = [];
  const fail = (field, code) => errors.push({ field, code });
  const worldId = ownedWorldId(source.worldId);
  if (!worldId) fail('worldId', 'INVALID_WORLD');
  const saveTime = Date.parse(source.saveUpdatedAt);
  if (typeof source.saveUpdatedAt !== 'string' || !Number.isFinite(saveTime)) fail('saveUpdatedAt', 'INVALID_TIME');
  const world = source.world && typeof source.world === 'object' ? source.world : {};
  const players = Array.isArray(source.players) ? source.players.slice(0, 100) : [];
  const bases = Array.isArray(source.bases) ? source.bases.slice(0, 200) : [];
  if (!Array.isArray(source.columns) || source.columns.join(',') !== OWNED_FIELDS.join(',')) fail('columns', 'INVALID_COLUMNS');
  const rows = Array.isArray(source.rows) ? source.rows : null;
  if (!rows) fail('rows', 'INVALID_ROWS');
  else if (rows.length > OWNED_MAX_ROWS) fail('rows', 'TOO_MANY');
  else if (rows.some((row) => !Array.isArray(row) || row.length !== OWNED_FIELDS.length
    || row.some((cell) => !['string', 'number', 'boolean'].includes(typeof cell)))) fail('rows', 'INVALID_ROWS');
  if (errors.length) return { ok: false, errors };
  const seen = new Set();
  const cleanRows = [];
  for (const row of rows) {
    const cells = row.map((cell) => ownedText(cell, 200));
    if (!cells[0] || seen.has(cells[0])) continue;
    seen.add(cells[0]);
    cleanRows.push(cells);
  }
  return {
    ok: true,
    value: {
      worldId,
      worldName: ownedText(world.name, 100),
      hostName: ownedText(world.hostName, 50),
      saveUpdatedAt: new Date(saveTime).toISOString(),
      players: players.map((player) => ({ uid: ownedText(player && player.uid, 40), name: ownedText(player && player.name, 50) })).filter((player) => player.uid),
      bases: bases.map((base) => ({ id: ownedText(base && base.id, 40), label: ownedText(base && base.label, 60) })).filter((base) => base.id),
      // 牧場を送らない古い画面からの共有では null（牧場の情報がない）
      farms: source.farms === undefined || source.farms === null ? null : cleanOwnedFarms(source.farms),
      rows: cleanRows,
    },
  };
}
