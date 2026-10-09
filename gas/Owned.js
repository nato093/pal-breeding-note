/**
 * 所持パルの共有。ワールドのホスト（セーブを持っている人）の画面がアップロードし、全員が読む。
 * ワールドごとに丸ごと置き換えるので、セーブから消えたパルはシートからも消える。
 * 同じワールドに古いセーブが届いたときは書き込まない（新しいセーブを優先する）。
 */

var OWNED_UPLOAD_FIELDS_ = ['action', 'passcode', 'userId', 'worldId', 'world', 'saveUpdatedAt', 'players', 'bases', 'farms', 'columns', 'rows'];

function ownedJson_(value, fallback) {
  try {
    var parsed = JSON.parse(String(value == null ? '' : value));
    return parsed == null ? fallback : parsed;
  } catch (error) {
    return fallback;
  }
}

function ownedFarmsCell_(table, cell) {
  if (!Object.prototype.hasOwnProperty.call(table.index, 'farms')) return null;
  var farms = ownedJson_(cell('farms'), null);
  return Array.isArray(farms) ? cleanOwnedFarms(farms) : null;
}

function readOwnedWorlds_(env) {
  var table = readTable_(sheetFor_(env, 'ownedWorlds'), OWNED_WORLD_HEADERS_);
  var worlds = [];
  table.rows.forEach(function (values, index) {
    var cell = function (field) { return String(values[table.index[field]] == null ? '' : values[table.index[field]]); };
    var worldId = ownedWorldId(cell('worldId'));
    if (!worldId) return;
    worlds.push({
      rowNumber: index + 2,
      world: {
        worldId: worldId, worldName: cell('worldName'), hostName: cell('hostName'),
        saveUpdatedAt: cell('saveUpdatedAt'), uploadedAt: cell('uploadedAt'), uploadedBy: cell('uploadedBy'),
        palCount: Number(cell('palCount')) || 0,
        players: ownedJson_(cell('players'), []), bases: ownedJson_(cell('bases'), []),
        // farms 列は後から足した列。列がない（setup() を実行し直す前）・牧場を送らない古い画面から共有されたときは null（情報がない）
        farms: ownedFarmsCell_(table, cell)
      }
    });
  });
  return { table: table, worlds: worlds };
}

/** 共有されているワールドの一覧（パルは含めない）。 */
function actionOwnedWorlds_(req, env) {
  return { worlds: readOwnedWorlds_(env).worlds.map(function (entry) { return entry.world; }), serverTime: new Date().toISOString() };
}

/** 1 ワールド分の所持パル。 */
function actionOwned_(req, env) {
  var worldId = ownedWorldId(req.worldId);
  if (!worldId) return validationFailure_('worldId', 'INVALID_WORLD');
  var entry = readOwnedWorlds_(env).worlds.find(function (item) { return item.world.worldId === worldId; });
  var serverTime = new Date().toISOString();
  if (!entry) return { world: null, columns: OWNED_FIELDS, rows: [], serverTime: serverTime };
  var table = readTable_(sheetFor_(env, 'ownedPals'), ownedPalRequiredHeaders_());
  var rows = [];
  table.rows.forEach(function (values) {
    if (String(values[table.index.worldId]) !== worldId) return;
    rows.push(OWNED_FIELDS.map(function (field) {
      // 後から足した列がまだないシートでは空
      var value = Object.prototype.hasOwnProperty.call(table.index, field) ? values[table.index[field]] : '';
      return String(value == null ? '' : value);
    }));
  });
  return { world: entry.world, columns: OWNED_FIELDS, rows: rows, serverTime: serverTime };
}

function ownedSheetValue_(value) {
  return typeof value === 'string' ? quoteForSheet(value) : value;
}

/** ホストの画面から 1 ワールド分を受け取り、そのワールドの行を置き換える。 */
function actionOwnedUpload_(req, env) {
  var unknown = Object.keys(req).find(function (field) { return OWNED_UPLOAD_FIELDS_.indexOf(field) === -1; });
  if (unknown) return validationFailure_(unknown, 'UNKNOWN_FIELD');
  var checked = validateOwnedUpload(req);
  if (!checked.ok) return { ok: false, code: 'VALIDATION', errors: checked.errors };
  var input = checked.value;
  var uploadedBy = sanitizeText(req.userId, 20);
  return withLock_(function () {
    var current = readOwnedWorlds_(env);
    var existing = current.worlds.find(function (item) { return item.world.worldId === input.worldId; });
    var serverTime = new Date().toISOString();
    // 競合したら新しいセーブを残す（同じ時刻なら上書きする）
    if (existing && Date.parse(existing.world.saveUpdatedAt) > Date.parse(input.saveUpdatedAt)) {
      return { stored: false, reason: 'STALE', world: existing.world, serverTime: serverTime };
    }
    var sheet = sheetFor_(env, 'ownedPals');
    var table = readTable_(sheet, ownedPalRequiredHeaders_());
    var width = table.headers.length;
    var kept = table.rows.filter(function (values) {
      return String(values[table.index.worldId]) !== input.worldId && values.some(function (value) { return value !== '' && value != null; });
    }).map(function (values) { return values.map(ownedSheetValue_); });
    var added = input.rows.map(function (cells) {
      var line = table.headers.map(function () { return ''; });
      line[table.index.worldId] = input.worldId;
      line[table.index.updatedAt] = serverTime;
      // 後から足した列がまだないシートには、その列を書かない
      OWNED_FIELDS.forEach(function (field, i) {
        if (Object.prototype.hasOwnProperty.call(table.index, field)) line[table.index[field]] = ownedSheetValue_(cells[i]);
      });
      return line;
    });
    var all = kept.concat(added);
    var last = sheet.getLastRow();
    if (last >= 2) sheet.getRange(2, 1, last - 1, width).clearContent();
    if (all.length) {
      var range = sheet.getRange(2, 1, all.length, width);
      range.setNumberFormat('@');
      range.setValues(all);
    }
    var world = {
      worldId: input.worldId, worldName: input.worldName, hostName: input.hostName, saveUpdatedAt: input.saveUpdatedAt,
      uploadedAt: serverTime, uploadedBy: uploadedBy, palCount: input.rows.length, players: input.players, bases: input.bases,
      farms: input.farms
    };
    var worldSheet = sheetFor_(env, 'ownedWorlds');
    writeTableRow_(worldSheet, current.table, existing ? existing.rowNumber : worldSheet.getLastRow() + 1, {
      worldId: world.worldId, worldName: quoteForSheet(world.worldName), hostName: quoteForSheet(world.hostName),
      saveUpdatedAt: world.saveUpdatedAt, uploadedAt: world.uploadedAt, uploadedBy: quoteForSheet(world.uploadedBy),
      palCount: String(world.palCount), players: quoteForSheet(JSON.stringify(world.players)), bases: quoteForSheet(JSON.stringify(world.bases)),
      // 列がない（setup() を実行し直す前の）シートでは書かれない
      farms: quoteForSheet(JSON.stringify(world.farms))
    });
    return { stored: true, world: world, serverTime: serverTime };
  });
}

/** 1 ワールド分の共有をやめる（シートから消す）。 */
function actionOwnedDelete_(req, env) {
  var worldId = ownedWorldId(req.worldId);
  if (!worldId) return validationFailure_('worldId', 'INVALID_WORLD');
  return withLock_(function () {
    var current = readOwnedWorlds_(env);
    var existing = current.worlds.find(function (item) { return item.world.worldId === worldId; });
    var sheet = sheetFor_(env, 'ownedPals');
    var table = readTable_(sheet, ownedPalRequiredHeaders_());
    var width = table.headers.length;
    var kept = table.rows.filter(function (values) {
      return String(values[table.index.worldId]) !== worldId && values.some(function (value) { return value !== '' && value != null; });
    }).map(function (values) { return values.map(ownedSheetValue_); });
    var removed = table.rows.length - kept.length;
    var last = sheet.getLastRow();
    if (last >= 2) sheet.getRange(2, 1, last - 1, width).clearContent();
    if (kept.length) {
      var range = sheet.getRange(2, 1, kept.length, width);
      range.setNumberFormat('@');
      range.setValues(kept);
    }
    if (existing) sheetFor_(env, 'ownedWorlds').deleteRows(existing.rowNumber, 1);
    return { deleted: Boolean(existing), removed: removed, serverTime: new Date().toISOString() };
  });
}
