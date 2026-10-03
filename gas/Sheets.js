/**
 * シート操作の共通部品。列は位置ではなくヘッダー名で対応付ける。
 */

var SHEET_NAMES_ = {
  prod: { data: 'Breedings', log: 'Log' },
  test: { data: 'Breedings_test', log: 'Log_test' }
};

var BREEDING_HEADERS_ = [
  'id', 'parent1Id', 'parent2Id', 'childId', 'parent1Gender', 'parent2Gender',
  'registrant', 'memo', 'confirmCount', 'createdAt', 'updatedAt', 'deletedAt',
  'parent1Name', 'parent2Name', 'childName'
];

var LOG_HEADERS_ = ['at', 'action', 'recordId', 'before', 'after'];

var LOCK_TIMEOUT_MS_ = 10000;

function spreadsheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('bound spreadsheet is not available');
  return ss;
}

function sheetFor_(env, kind) {
  var name = SHEET_NAMES_[env] && SHEET_NAMES_[env][kind];
  if (!name) throw new Error('unknown sheet: ' + env + '/' + kind);
  var sheet = spreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('sheet not found (run setup): ' + name);
  return sheet;
}

/**
 * シート全体を読み、ヘッダー名 → 列番号（0 始まり）の対応とデータ行を返す。
 * ヘッダーの欠落・重複はデータの取り違えにつながるため例外にする。
 */
function readTable_(sheet, requiredHeaders) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) throw new Error('header row is missing: ' + sheet.getName());

  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var index = {};
  headers.forEach(function (h, i) {
    if (!h) return;
    if (Object.prototype.hasOwnProperty.call(index, h)) throw new Error('duplicate header: ' + h);
    index[h] = i;
  });
  (requiredHeaders || []).forEach(function (h) {
    if (!Object.prototype.hasOwnProperty.call(index, h)) throw new Error('missing header: ' + h);
  });
  return { headers: headers, index: index, rows: values.slice(1) };
}

/**
 * スクリプトロック内で fn を実行する。
 * 書き込みを確定させてから解放しないと、次の実行が古いシートを読むため flush → release の順を守る。
 */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS_)) {
    var busy = new Error('lock timeout');
    busy.code = 'BUSY';
    throw busy;
  }
  try {
    var result = fn();
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}
