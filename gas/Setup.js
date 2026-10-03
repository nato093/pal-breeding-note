/**
 * 初期設定（所有者がスクリプトエディタから 1 回実行する）。何度実行しても既存のデータとパスコードは変えない。
 */

function setup() {
  var ss = spreadsheet_();
  ['prod', 'test'].forEach(function (env) {
    ensureSheet_(ss, SHEET_NAMES_[env].data, BREEDING_HEADERS_);
    ensureSheet_(ss, SHEET_NAMES_[env].log, LOG_HEADERS_);
  });
  removeEmptyDefaultSheet_(ss);

  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PASSCODE')) props.setProperty('PASSCODE', generatePasscode_());
  if (!props.getProperty('TEST_PASSCODE')) {
    var test = generatePasscode_();
    while (normalizePasscode_(test) === normalizePasscode_(props.getProperty('PASSCODE'))) test = generatePasscode_();
    props.setProperty('TEST_PASSCODE', test);
  }

  console.log('セットアップ完了');
  console.log('本番パスコード（友人に配る）: ' + props.getProperty('PASSCODE'));
  console.log('テスト用パスコード（.env.local の PAL_TEST_PASSCODE に保存）: ' + props.getProperty('TEST_PASSCODE'));
}

/** 本番パスコードだけを作り直す。全端末が再入力になるので、新しい招待リンクを配り直すこと。 */
function rotatePasscode() {
  var props = PropertiesService.getScriptProperties();
  var test = normalizePasscode_(props.getProperty('TEST_PASSCODE'));
  var next = generatePasscode_();
  while (normalizePasscode_(next) === test) next = generatePasscode_();
  props.setProperty('PASSCODE', next);
  console.log('新しい本番パスコード: ' + next);
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
  Object.keys(SHEET_NAMES_).forEach(function (env) {
    ours[SHEET_NAMES_[env].data] = true;
    ours[SHEET_NAMES_[env].log] = true;
  });
  ss.getSheets().forEach(function (sheet) {
    if (ours[sheet.getName()]) return;
    if (sheet.getLastRow() === 0 && sheet.getLastColumn() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sheet);
  });
}
