/**
 * プレイヤーの対応（server の mapping。docs/server/README.md の T3）。ワールドのプレイヤーの鍵（i:<キャラクターの InstanceId>・u:<PlayerUId>。
 * Shared.js の playerMapKey）→ ノートの ID を、シート PlayerMap（本番）・PlayerMap_test（テスト）に 1 行 1 鍵で置く。誰の画面からでも設定でき、
 * サーバーの常駐も読む。
 * - 外した対応は行を消さずに userId を '' にした行（墓標）として残す（行の番号がずれない。別の PC の移行〔onlyMissing〕が書き戻さない）
 * - 同じ（worldId, key）の行が手で重複して作られたら、読むときも書くときも最後の行を使う
 * - updatedBy は書いた人の ID（自己申告。ownedUpload の uploadedBy と同じ）、updatedAt はサーバーの時刻。playerName は設定したときの
 *   ゲーム内の名前（所有者がシートを読むため）。画面と常駐が使うのは userId だけ
 * - 検査と書き込みの規則（onlyMissing・同じ内容は書かない・上限）は Shared.js の validatePlayerMapSet・planPlayerMapSet（開発用 API と同じ）
 */

var PLAYER_MAP_HEADERS_ = ['worldId', 'key', 'userId', 'playerName', 'updatedBy', 'updatedAt'];

// シートがない（GAS を更新した後、setup() を実行する前）ときは SHEET_HEADER（画面は前の対応に落とす）
function playerMapSheet_(env) {
  var name = SHEET_NAMES_[env].playerMap;
  var sheet = spreadsheet_().getSheetByName(name);
  if (!sheet) throw sheetHeaderError_('sheet not found (run setup): ' + name);
  return sheet;
}

/**
 * そのワールドの対応を読む。{ sheet, table, rowOf: 鍵 → 行の番号（同じ鍵の最後の行）, entries: 鍵ごとの最後の行の対応（鍵が最初に現れた順。
 * 上限では切らない） }。worldId・鍵の大文字小文字は問わず、形の違う行は使わない
 */
function readPlayerMap_(env, worldId) {
  var sheet = playerMapSheet_(env);
  var table = readTable_(sheet, PLAYER_MAP_HEADERS_);
  var rowOf = Object.create(null);
  var byKey = Object.create(null);
  var keys = [];
  table.rows.forEach(function (values, index) {
    var cell = function (field) { return String(values[table.index[field]] == null ? '' : values[table.index[field]]); };
    if (ownedWorldId(cell('worldId')) !== worldId) return;
    var entry = cleanPlayerMapEntry({
      key: cell('key'), userId: cell('userId'), playerName: cell('playerName'), updatedBy: cell('updatedBy'), updatedAt: cell('updatedAt')
    });
    if (!entry) return;
    if (!byKey[entry.key]) keys.push(entry.key);
    byKey[entry.key] = entry;
    rowOf[entry.key] = index + 2;
  });
  return { sheet: sheet, table: table, rowOf: rowOf, entries: keys.map(function (key) { return byKey[key]; }) };
}

/** そのワールドの対応（外した印を含む）。読む間に行が動いて読めなかったときは 1 回だけ読み直す（actionOwnedWorlds_ と同じ） */
function actionPlayerMap_(req, env) {
  var worldId = ownedWorldId(req.worldId);
  if (!worldId) return validationFailure_('worldId', 'INVALID_WORLD');
  var map;
  try {
    map = readPlayerMap_(env, worldId);
  } catch (error) {
    if (error && error.code === 'SHEET_HEADER') throw error;
    map = readPlayerMap_(env, worldId);
  }
  return { worldId: worldId, entries: cleanPlayerMapEntries(map.entries), serverTime: new Date().toISOString() };
}

// 1 行の値（文字は数式として解釈させないよう quoteForSheet を通す）
function playerMapRow_(worldId, entry) {
  return {
    worldId: worldId, key: entry.key, userId: quoteForSheet(entry.userId), playerName: quoteForSheet(entry.playerName),
    updatedBy: quoteForSheet(entry.updatedBy), updatedAt: entry.updatedAt
  };
}

/**
 * 対応を書く（1 回 PLAYER_MAP_SET_MAX 件まで）。鍵の中で表を読み、今ある鍵は最後の行を書き換え、新しい鍵はまとめて末尾に足す。
 * entries の ID は Users の表記で保存する。ノートにない ID（USER_NOT_FOUND）・鍵を増やして 1 ワールド PLAYER_MAP_WORLD_MAX を超える
 * 書き込み（TOO_MANY）は、何も書かずに VALIDATION。同じ内容の送り直しは書かないので、opId は要らない（画面の 1 回の送り直しにも耐える）。
 * { worldId, entries（書いた後の全部。外した印を含む）, changed, skipped, serverTime }
 */
function actionPlayerMapSet_(req, env) {
  // 形は鍵の外で先に確かめる（ノートにある ID かは、鍵の中で Users を読んでから）
  var shape = validatePlayerMapSet(req, { checkUserId: validateUserId });
  if (!shape.ok) return { ok: false, code: 'VALIDATION', errors: shape.errors };
  return withLock_(function () {
    var map = readPlayerMap_(env, shape.value.worldId);
    var users = readUsers_(env);
    var checked = validatePlayerMapSet(req, {
      checkUserId: validateUserId,
      findUser: function (userId) {
        return users.find(function (user) { return userIdKey(user) === userIdKey(userId); }) || '';
      }
    });
    if (!checked.ok) return { ok: false, code: 'VALIDATION', errors: checked.errors };
    var input = checked.value;
    var serverTime = new Date().toISOString();
    var plan = planPlayerMapSet(map.entries, input, serverTime);
    if (!plan.ok) return { ok: false, code: 'VALIDATION', errors: plan.errors };
    var added = [];
    plan.writes.forEach(function (entry) {
      var values = playerMapRow_(input.worldId, entry);
      var row = map.rowOf[entry.key];
      if (row) {
        // 今ある行は書き換える（利用者が足した列は writeTableRow_ が残す）
        writeTableRow_(map.sheet, map.table, row, values);
        return;
      }
      added.push(map.table.headers.map(function (header) {
        return Object.prototype.hasOwnProperty.call(values, header) ? values[header] : '';
      }));
    });
    if (added.length) {
      var start = map.sheet.getLastRow() + 1;
      ensureOwnedRows_(map.sheet, start + added.length - 1);
      var range = map.sheet.getRange(start, 1, added.length, map.table.headers.length);
      range.setNumberFormat('@');
      range.setValues(added);
    }
    return {
      worldId: input.worldId, entries: cleanPlayerMapEntries(plan.entries), changed: plan.changed, skipped: plan.skipped, serverTime: serverTime
    };
  });
}

/**
 * ID の変更（Service.js の actionRename_）で書き換える対応の行: userId の列と updatedBy の列で、from と同じ ID（表記ゆれを含む）の行の番号。
 * 書き換えの前に読む（シートの不備で、書き換えが途中まで残ることを避ける）。シートがなければ（setup() の前）null で、書き換えを飛ばす
 */
function playerMapRenameRows_(env, from) {
  var sheet = spreadsheet_().getSheetByName(SHEET_NAMES_[env].playerMap);
  if (!sheet) return null;
  var table = readTable_(sheet, PLAYER_MAP_HEADERS_);
  var rowsOf = function (field) {
    var rows = [];
    table.rows.forEach(function (values, index) {
      var value = String(values[table.index[field]] == null ? '' : values[table.index[field]]);
      if (value && userIdKey(value) === userIdKey(from)) rows.push(index + 2);
    });
    return rows;
  };
  return {
    sheet: sheet,
    userId: { column: table.index.userId + 1, rows: rowsOf('userId') },
    updatedBy: { column: table.index.updatedBy + 1, rows: rowsOf('updatedBy') }
  };
}

/** playerMapRenameRows_ で見つけた行の ID を to にする（対象のセルだけ。外した印〔userId が ''〕の行は対象にならない） */
function renamePlayerMap_(rename, to) {
  if (!rename) return;
  writeCells_(rename.sheet, rename.userId.column, rename.userId.rows, to);
  writeCells_(rename.sheet, rename.updatedBy.column, rename.updatedBy.rows, to);
}
