/**
 * API の操作一覧。
 * P1（縦串）では接続確認用の最小限だけを置く。業務ルール（登録・編集・削除など）は P4 で追加する。
 * probe 系はテスト用パスコードでだけ使える診断用の操作で、テスト用の専用シートにしか書き込まない。
 */

function actions_() {
  return {
    ping: { run: actionPing_ },
    snapshot: { run: actionSnapshot_ },
    probe: { run: actionProbe_, testOnly: true },
    probeStats: { run: actionProbeStats_, testOnly: true },
    probeReset: { run: actionProbeReset_, testOnly: true }
  };
}

function actionPing_() {
  return { serverTime: new Date().toISOString() };
}

/** 有効レコードの全件（P1 では整合性検査なしの最小版。P4 で置き換える） */
function actionSnapshot_(req, env) {
  var table = readTable_(sheetFor_(env, 'data'), BREEDING_HEADERS_);
  var records = [];
  table.rows.forEach(function (row) {
    if (String(row[table.index.id]).trim() === '') return;
    if (String(row[table.index.deletedAt]).trim() !== '') return;
    var rec = {};
    BREEDING_HEADERS_.forEach(function (h) { rec[h] = row[table.index[h]]; });
    records.push(rec);
  });
  return { records: records };
}

var PROBE_SHEET_ = '_probe_test';
var PROBE_HEADERS_ = ['tag', 'text', 'at'];

function probeSheet_() {
  var ss = spreadsheet_();
  var sheet = ss.getSheetByName(PROBE_SHEET_);
  if (!sheet) {
    sheet = ss.insertSheet(PROBE_SHEET_);
    sheet.getRange(1, 1, 1, PROBE_HEADERS_.length).setValues([PROBE_HEADERS_]);
  }
  return sheet;
}

/**
 * 書式なしテキストのセルに text を書き、実際にどう保存されたかを返す（数式インジェクションの実機確認用）。
 * mode=quoted のときは、数式の開始文字で始まる値の先頭に ' を付けて書く。
 */
function actionProbe_(req) {
  var text = String(req.text == null ? '' : req.text).slice(0, 200);
  var tag = String(req.tag == null ? '' : req.tag).slice(0, 40);
  var mode = req.mode === 'quoted' ? 'quoted' : 'raw';
  var value = mode === 'quoted' && /^[=+\-@]/.test(text) ? "'" + text : text;

  return withLock_(function () {
    var sheet = probeSheet_();
    var row = sheet.getLastRow() + 1;
    var range = sheet.getRange(row, 1, 1, PROBE_HEADERS_.length);
    range.setNumberFormat('@');
    range.setValues([[tag, value, new Date().toISOString()]]);
    SpreadsheetApp.flush();
    var cell = sheet.getRange(row, 2);
    return { row: row, mode: mode, stored: cell.getValue(), display: cell.getDisplayValue(), formula: cell.getFormula() };
  });
}

function actionProbeStats_(req) {
  var tag = String(req.tag == null ? '' : req.tag);
  var sheet = probeSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return { count: 0, rows: [] };
  var values = sheet.getRange(2, 1, last - 1, PROBE_HEADERS_.length).getValues();
  var rows = [];
  values.forEach(function (v, i) {
    if (String(v[0]) === tag) rows.push(i + 2);
  });
  return { count: rows.length, rows: rows };
}

function actionProbeReset_() {
  return withLock_(function () {
    var sheet = probeSheet_();
    var last = sheet.getLastRow();
    if (last >= 2) sheet.deleteRows(2, last - 1);
    return { cleared: Math.max(0, last - 1) };
  });
}
