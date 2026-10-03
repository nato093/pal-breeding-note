/** シートの列配置を隠し、正規化・整合性検査・etag 計算を行う。 */
var RECORD_FIELDS_ = [
  'id', 'parent1Id', 'parent2Id', 'childId', 'parent1Gender', 'parent2Gender',
  'registrant', 'memo', 'confirmCount', 'createdAt', 'updatedAt', 'deletedAt'
];

function recordEtag_(record) {
  var content = {};
  RECORD_FIELDS_.forEach(function (field) { content[field] = record[field]; });
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(content));
  return Utilities.base64EncodeWebSafe(digest).slice(0, 16);
}

function clientRecord_(record, includeDeleted) {
  var result = {};
  RECORD_FIELDS_.forEach(function (field) {
    if (field !== 'deletedAt') result[field] = record[field];
  });
  result.etag = recordEtag_(record);
  if (includeDeleted) result.deleted = record.deletedAt !== '';
  return result;
}

function readRecords_(env) {
  var table = readTable_(sheetFor_(env, 'data'), BREEDING_HEADERS_);
  var rows = [];
  var warnings = [];
  var idCounts = Object.create(null);
  table.rows.forEach(function (values, index) {
    var record = {};
    RECORD_FIELDS_.forEach(function (field) {
      var value = values[table.index[field]];
      record[field] = field === 'confirmCount' ? Number(value) : String(value == null ? '' : value);
    });
    if (record.id.trim() === '') return;
    record = normalizeRecord(record);
    rows.push({ rowNumber: index + 2, record: record, valid: true });
    idCounts[record.id] = (idCounts[record.id] || 0) + 1;
  });

  rows.forEach(function (row) {
    var record = row.record;
    var codes = [];
    if (idCounts[record.id] > 1) codes.push('DUPLICATE_ID');
    if (['parent1Id', 'parent2Id', 'childId'].some(function (field) {
      return !Object.prototype.hasOwnProperty.call(PAL_MASTER_, record[field]);
    })) codes.push('UNKNOWN_PAL');
    if (!Number.isInteger(record.confirmCount) || record.confirmCount <= 0) codes.push('BAD_COUNT');
    row.valid = codes.length === 0;
    codes.forEach(function (code) {
      warnings.push({ code: code, rowNumber: row.rowNumber, id: record.id });
    });
  });

  var activeRows = rows.filter(function (row) { return row.valid && row.record.deletedAt === ''; });
  var identities = Object.create(null);
  activeRows.forEach(function (row) {
    var key = identityKey(row.record);
    identities[key] = (identities[key] || 0) + 1;
  });
  activeRows.forEach(function (row) {
    if (identities[identityKey(row.record)] > 1) {
      warnings.push({ code: 'DUPLICATE_RECORD', rowNumber: row.rowNumber, id: row.record.id });
    }
  });
  return {
    records: activeRows.map(function (row) { return clientRecord_(row.record); }),
    warnings: warnings,
    rows: rows
  };
}

function snapshot_(env) {
  var data = readRecords_(env);
  return { records: data.records, warnings: data.warnings, serverTime: new Date().toISOString() };
}

function writeTableRow_(sheet, table, rowNumber, values) {
  // 追加された独自列は更新時に保持する。新規行の未知の列は空欄にする。
  var previous = rowNumber <= sheet.getLastRow()
    ? sheet.getRange(rowNumber, 1, 1, table.headers.length).getValues()[0] : [];
  var columns = table.headers.map(function (header, index) {
    return Object.prototype.hasOwnProperty.call(values, header)
      ? values[header] : (previous[index] == null ? '' : previous[index]);
  });
  var range = sheet.getRange(rowNumber, 1, 1, columns.length);
  range.setNumberFormat('@');
  range.setValues([columns]);
}

function writeRecord_(env, rowNumber, record) {
  var sheet = sheetFor_(env, 'data');
  var table = readHeader_(sheet, BREEDING_HEADERS_);
  var values = Object.assign({}, record, {
    registrant: quoteForSheet(record.registrant),
    memo: quoteForSheet(record.memo),
    parent1Name: PAL_MASTER_[record.parent1Id],
    parent2Name: PAL_MASTER_[record.parent2Id],
    childName: PAL_MASTER_[record.childId]
  });
  writeTableRow_(sheet, table, rowNumber || sheet.getLastRow() + 1, values);
}

function appendRecordLog_(env, table, action, recordId, before, after, at) {
  var sheet = sheetFor_(env, 'log');
  writeTableRow_(sheet, table, sheet.getLastRow() + 1, {
    at: at, action: action, recordId: recordId,
    before: quoteForSheet(JSON.stringify(before)),
    after: quoteForSheet(JSON.stringify(after))
  });
}
