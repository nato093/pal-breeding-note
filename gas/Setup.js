/**
 * 初期設定（所有者がスクリプトエディタから 1 回実行する）。何度実行しても既存のデータとパスワードは変えない。
 */

function setup() {
  var ss = spreadsheet_();
  ['prod', 'test'].forEach(function (env) {
    ensureSheet_(ss, SHEET_NAMES_[env].data, BREEDING_HEADERS_);
    ensureSheet_(ss, SHEET_NAMES_[env].log, LOG_HEADERS_);
    ensureSheet_(ss, SHEET_NAMES_[env].users, USER_HEADERS_);
  });
  var settings = ensureSheet_(ss, SETTINGS_SHEET_, SETTINGS_HEADERS_);
  var table = readTable_(settings, SETTINGS_HEADERS_);
  settings.getRange(1, table.index['値'] + 1, settings.getMaxRows(), 1).setNumberFormat('@');
  var index = table.rows.findIndex(function (row) { return row[table.index['項目']] === '共通パスワード'; });
  var props = PropertiesService.getScriptProperties();
  var current = index >= 0 ? table.rows[index][table.index['値']] : '';
  var password = String(current == null ? '' : current);
  if (!trimPassword_(password)) {
    password = props.getProperty('PASSCODE') || generatePasscode_();
    writeTableRow_(settings, table, index >= 0 ? index + 2 : settings.getLastRow() + 1, {
      '項目': '共通パスワード', '値': quoteForSheet(password)
    });
  }
  // 移行先の保存を確認できるまでは、復旧に使える旧プロパティを残す。
  SpreadsheetApp.flush();
  var savedTable = readTable_(settings, SETTINGS_HEADERS_);
  var savedRow = savedTable.rows.find(function (row) { return row[savedTable.index['項目']] === '共通パスワード'; });
  var saved = savedRow ? String(savedRow[savedTable.index['値']]) : '';
  if (!trimPassword_(saved) || saved !== password) throw new Error('共通パスワードの移行を確認できませんでした。旧プロパティは保持しています。');
  props.deleteProperty('PASSCODE');
  if (!props.getProperty('TEST_PASSCODE')) {
    var test = generatePasscode_();
    while (trimPassword_(test) === productionPassword_()) test = generatePasscode_();
    props.setProperty('TEST_PASSCODE', test);
  }
  removeEmptyDefaultSheet_(ss);
  console.log('セットアップ完了。共通パスワードは設定シート、テスト用は Script Properties で確認してください。');
}

function ensureSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  // 値を数式として解釈させないよう、使う列全体を書式なしテキストにする
  sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).setNumberFormat('@');

  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  var current = headerRange.getValues()[0];
  if (current.join('') === '') {
    headerRange.setValues([headers]);
    sheet.setFrozenRows(1);
  }

  var description = 'ヘッダー行（列名を変えるとアプリが読めなくなります）';
  var protections = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
  var exists = protections.some(function (p) { return p.getDescription() === description; });
  if (!exists) headerRange.protect().setDescription(description).setWarningOnly(true);
  return sheet;
}

function removeEmptyDefaultSheet_(ss) {
  var ours = {};
  ours[SETTINGS_SHEET_] = true;
  Object.keys(SHEET_NAMES_).forEach(function (env) {
    ours[SHEET_NAMES_[env].data] = true;
    ours[SHEET_NAMES_[env].log] = true;
    ours[SHEET_NAMES_[env].users] = true;
  });
  ss.getSheets().forEach(function (sheet) {
    if (ours[sheet.getName()]) return;
    if (sheet.getLastRow() === 0 && sheet.getLastColumn() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sheet);
  });
}
