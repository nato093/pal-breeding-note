// 所持パルをスプレッドシートで共有するときの形。画面・GAS（npm run build:gas で gas/Shared.js に複写）・開発用 API で同じ定義を使う。
// GAS に複写するため import は使わない。

// 1 体ぶんの列（この順番で配列にして送る）。列を足すときは末尾に足し、GAS を更新する
export const OWNED_FIELDS = [
  'instanceId', 'palId', 'palName', 'characterId', 'nickname', 'gender', 'level', 'rank', 'stars',
  'passiveIds', 'passive1', 'passive2', 'passive3', 'passive4', 'talentHp', 'talentShot', 'talentDefense',
  'lucky', 'alpha', 'egg', 'place', 'placeLabel', 'holderUid', 'holder', 'baseId', 'lastOwner',
];
export const OWNED_MAX_ROWS = 20000;

function ownedText(value, max) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, max);
}

export function ownedWorldId(value) {
  const id = String(value ?? '').trim().toUpperCase();
  return /^[0-9A-F]{32}$/.test(id) ? id : '';
}

/**
 * 所持パルのアップロードを検証して整える。
 * @returns {{ ok: true, value: object } | { ok: false, errors: { field: string, code: string }[] }}
 */
export function validateOwnedUpload(input) {
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
      rows: cleanRows,
    },
  };
}
