/**
 * API の操作一覧。
 * 業務ルールは Service.js、シート入出力は Repo.js に委ねる。
 * probe 系はテスト用パスワードでだけ使える診断用の操作で、テスト用の専用シートにしか書き込まない。
 */

function actions_() {
  return {
    ping: { run: actionPing_ },
    snapshot: { run: actionSnapshot_ },
    login: { run: actionAccount_ },
    signup: { run: actionAccount_ },
    create: { run: actionMutation_ },
    confirm: { run: actionMutation_ },
    update: { run: actionMutation_ },
    merge: { run: actionMutation_ },
    delete: { run: actionMutation_ },
    restore: { run: actionMutation_ },
    ownedWorlds: { run: actionOwnedWorlds_ },
    owned: { run: actionOwned_ },
    ownedUpload: { run: actionOwnedUpload_ },
    ownedDelete: { run: actionOwnedDelete_ },
    probe: { run: actionProbe_, testOnly: true },
    probeStats: { run: actionProbeStats_, testOnly: true },
    probeReset: { run: actionProbeReset_, testOnly: true }
  };
}

function actionPing_() {
  return { serverTime: new Date().toISOString() };
}

/** 整合性検査を通った有効レコードの全件を返す。 */
function actionSnapshot_(req, env) {
  return snapshot_(env);
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
