/** 業務ルールの判定を先に完了し、成功した変更だけを書き込む。 */
var UUID_PATTERN_ = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var MUTATION_FIELDS_ = {
  create: ['record', 'allowDifferentChild'],
  confirm: ['id'],
  update: ['id', 'expectedEtag', 'record', 'allowDifferentChild'],
  merge: ['sourceId', 'targetId', 'expectedEtags'],
  delete: ['id', 'expectedEtag'],
  restore: ['id', 'expectedEtag']
};

function actionAccount_(req, env) {
  var allowed = ['action', 'passcode', 'userId'];
  if (req.action === 'signup') allowed.push('opId');
  var unknown = Object.keys(req).find(function (field) { return allowed.indexOf(field) === -1; });
  if (unknown) return validationFailure_(unknown, 'UNKNOWN_FIELD');
  if (req.action === 'signup' && !isUuid_(req.opId)) return validationFailure_('opId', 'INVALID_UUID');
  var checked = validateUserId(req.userId);
  if (!checked.ok) return { ok: false, code: 'VALIDATION', errors: checked.errors };
  var run = function () {
    var cache;
    var key;
    if (req.action === 'signup') {
      cache = CacheService.getScriptCache();
      key = 'op:' + env + ':' + req.opId.toLowerCase();
      var cached = cache.get(key);
      if (cached) return Object.assign(JSON.parse(cached), snapshot_(env));
    }
    // 応答に必要なシートの不備で、登録だけが残ることを避ける。
    var snapshot = snapshot_(env);
    var existing = snapshot.users.find(function (userId) { return userIdKey(userId) === userIdKey(checked.value); });
    if (req.action === 'login') {
      return existing ? Object.assign({ userId: existing }, snapshot) : fail_('USER_NOT_FOUND');
    }
    if (existing) return fail_('USER_EXISTS');
    appendUser_(env, checked.value);
    snapshot.users.push(checked.value);
    var result = { userId: checked.value };
    // キャッシュを成功の証拠として使うため、シートの確定後に保存する。
    SpreadsheetApp.flush();
    cache.put(key, JSON.stringify(result), 21600);
    return Object.assign({}, result, snapshot);
  };
  return req.action === 'signup' ? withLock_(run) : run();
}

var RENAME_FIELDS_ = ['action', 'passcode', 'opId', 'userId', 'newUserId'];

/**
 * 自分の名前（ID）を変え、配合の登録者名・所持パルの共有者名も新しい名前にそろえる。
 * 開始と完了を Log に opId で残し、途中で止まっても同じ opId で続きから行えるようにする。
 * Users を最後に書くので、途中で止まっても旧名でやり直せる。
 */
function actionRename_(req, env) {
  var unknown = Object.keys(req).find(function (field) { return RENAME_FIELDS_.indexOf(field) === -1; });
  if (unknown) return validationFailure_(unknown, 'UNKNOWN_FIELD');
  if (!isUuid_(req.opId)) return validationFailure_('opId', 'INVALID_UUID');
  var current = validateUserId(req.userId);
  if (!current.ok) return { ok: false, code: 'VALIDATION', errors: current.errors };
  var next = validateUserId(req.newUserId);
  if (!next.ok) return validationFailure_('newUserId', next.errors[0].code);
  if (next.value === current.value) return validationFailure_('newUserId', 'SAME_ID');
  return withLock_(function () {
    var cache = CacheService.getScriptCache();
    var key = 'op:' + env + ':' + req.opId.toLowerCase();
    var cached = cache.get(key);
    if (cached) return Object.assign(JSON.parse(cached), snapshot_(env));
    var log = findRenameLog_(env, req.opId);
    // 完了の記録があれば、今の名前に関係なく完了済み（旧名が他の人に再登録されていても取り違えない）
    if (log.done) return Object.assign({ userId: log.done.after.userId }, snapshot_(env));
    var from = log.started ? log.started.before.userId : current.value;
    var to = log.started ? log.started.after.userId : next.value;
    var users = readUserRows_(env);
    var findUser = function (userId) {
      return users.rows.find(function (row) { return userIdKey(row.userId) === userIdKey(userId); });
    };
    var own = findUser(from);
    // 途中で止まった改名で、Users まで書き換え済みなら、残りの記録だけを行う
    var usersDone = !own && Boolean(log.started) && Boolean(findUser(to));
    if (!own && !usersDone) return fail_('USER_NOT_FOUND');
    if (own && users.rows.some(function (row) { return row !== own && userIdKey(row.userId) === userIdKey(to); })) {
      return fail_('USER_EXISTS');
    }
    // シートの不備で、書き換えが途中まで残ることを避ける。
    var dataSheet = sheetFor_(env, 'data');
    var dataTable = readHeader_(dataSheet, BREEDING_HEADERS_);
    var records = readRecords_(env).rows.filter(function (row) {
      return userIdKey(row.record.registrant) === userIdKey(from);
    });
    var worlds = readOwnedWorlds_(env);
    var uploads = worlds.worlds.filter(function (entry) { return userIdKey(entry.world.uploadedBy) === userIdKey(from); });
    var logTable = readHeader_(sheetFor_(env, 'log'), LOG_HEADERS_);
    var now = new Date().toISOString();

    if (!log.started) appendRecordLog_(env, logTable, 'rename', req.opId, { userId: from }, { userId: to }, now);
    // 削除済みの配合も書き換える（復元したときに旧名が戻らないように）。並び順を保つため updatedAt は変えない。
    writeCells_(dataSheet, dataTable.index.registrant + 1, records.map(function (row) { return row.rowNumber; }), to);
    writeCells_(sheetFor_(env, 'ownedWorlds'), worlds.table.index.uploadedBy + 1,
      uploads.map(function (entry) { return entry.rowNumber; }), to);
    if (own) writeCells_(sheetFor_(env, 'users'), users.table.index.userId + 1, [own.rowNumber], to);
    appendRecordLog_(env, logTable, 'renamed', req.opId, { userId: from }, { userId: to, records: records.length }, now);

    var result = { userId: to };
    // キャッシュを成功の証拠として使うため、シートの確定後に保存する。
    SpreadsheetApp.flush();
    cache.put(key, JSON.stringify(result), 21600);
    return Object.assign({}, result, snapshot_(env));
  });
}

function isUuid_(value) {
  return typeof value === 'string' && UUID_PATTERN_.test(value);
}

function validationFailure_(field, code) {
  return { ok: false, code: 'VALIDATION', errors: [{ field: field, code: code }] };
}

function validateMutation_(req) {
  if (!isUuid_(req.opId)) return validationFailure_('opId', 'INVALID_UUID');
  var allowed = ['action', 'passcode', 'opId'].concat(MUTATION_FIELDS_[req.action]);
  var unknown = Object.keys(req).find(function (field) { return allowed.indexOf(field) === -1; });
  if (unknown) return validationFailure_(unknown, 'UNKNOWN_FIELD');
  var ids = req.action === 'merge' ? ['sourceId', 'targetId'] : req.action === 'create' ? [] : ['id'];
  for (var i = 0; i < ids.length; i++) {
    if (!isUuid_(req[ids[i]])) return validationFailure_(ids[i], 'INVALID_UUID');
  }
  if (req.action === 'create' && (!req.record || !isUuid_(req.record.id))) {
    return validationFailure_('id', 'INVALID_UUID');
  }
  if (req.action === 'merge' && req.sourceId === req.targetId) {
    return validationFailure_('targetId', 'SAME_RECORD');
  }
  return null;
}

function validatedRecord_(input, allowId) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return validationFailure_('record', 'INVALID_RECORD');
  }
  var fields = ['parent1Id', 'parent2Id', 'childId', 'parent1Gender', 'parent2Gender', 'registrant', 'memo'];
  if (allowId) fields.push('id');
  var unknown = Object.keys(input).find(function (field) { return fields.indexOf(field) === -1; });
  if (unknown) return validationFailure_(unknown, 'UNKNOWN_FIELD');
  var checked = validateRecordInput(input, new Set(Object.keys(PAL_MASTER_)));
  if (!checked.ok) return { ok: false, code: 'VALIDATION', errors: checked.errors };
  return { value: normalizeRecord(checked.value) };
}

function activeRow_(data, id) {
  return data.rows.find(function (row) {
    return row.valid && row.record.id === id && row.record.deletedAt === '';
  });
}

function validRow_(data, id) {
  return data.rows.find(function (row) { return row.valid && row.record.id === id; });
}

function duplicateRecord_(data, record) {
  return data.records.find(function (other) {
    return other.id !== record.id && identityKey(other) === identityKey(record);
  });
}

function pairConflicts_(data, record) {
  return data.records.filter(function (other) {
    return other.id !== record.id && pairKey(other.parent1Id, other.parent2Id) === pairKey(record.parent1Id, record.parent2Id)
      && other.childId !== record.childId;
  });
}

function checkDuplicates_(req, data, record, checkPair) {
  var duplicate = duplicateRecord_(data, record);
  if (duplicate) return { ok: false, code: 'DUPLICATE', existing: duplicate };
  if (!checkPair || req.allowDifferentChild === true) return null;
  var conflicts = pairConflicts_(data, record);
  return conflicts.length ? { ok: false, code: 'PAIR_CONFLICT', existing: conflicts } : null;
}

function changedRecord_(row, record) {
  return { rowNumber: row ? row.rowNumber : null, before: row ? row.record : null, after: record };
}

function recordResult_(record, changes, extra) {
  return {
    result: Object.assign({ record: clientRecord_(record) }, extra || {}),
    changes: changes || []
  };
}

function createRecord_(req, data, now) {
  var checked = validatedRecord_(req.record, true);
  if (checked.ok === false) return checked;
  var input = Object.assign({ id: req.record.id }, checked.value);
  var sameId = data.rows.filter(function (row) { return row.record.id === input.id; });
  if (sameId.length) {
    var row = sameId[0];
    var matches = sameId.length === 1 && row.valid && Object.keys(checked.value).every(function (field) {
      return row.record[field] === input[field];
    });
    if (!matches) return fail_('ID_CONFLICT');
    return recordResult_(row.record, [], { idempotent: true });
  }
  var conflict = checkDuplicates_(req, data, input, true);
  if (conflict) return conflict;
  var record = Object.assign({}, input, { confirmCount: 1, createdAt: now, updatedAt: now, deletedAt: '' });
  return recordResult_(record, [changedRecord_(null, record)]);
}

function confirmRecord_(req, data, now) {
  var row = activeRow_(data, req.id);
  if (!row) return fail_('NOT_FOUND');
  var record = Object.assign({}, row.record, { confirmCount: row.record.confirmCount + 1, updatedAt: now });
  return recordResult_(record, [changedRecord_(row, record)]);
}

function updateRecord_(req, data, now) {
  var row = activeRow_(data, req.id);
  if (!row) return fail_('NOT_FOUND');
  if (recordEtag_(row.record) !== req.expectedEtag) {
    return { ok: false, code: 'CONFLICT', latest: clientRecord_(row.record) };
  }
  var checked = validatedRecord_(req.record, false);
  if (checked.ok === false) return checked;
  var record = Object.assign({}, row.record, checked.value, { updatedAt: now });
  var identityChanged = identityKey(record) !== identityKey(row.record);
  var conflict = checkDuplicates_(req, data, record, identityChanged);
  if (conflict) return conflict;
  if (identityChanged) record.confirmCount = 1;
  return recordResult_(record, [changedRecord_(row, record)]);
}

function mergeRecords_(req, data, now) {
  var source = activeRow_(data, req.sourceId);
  var target = activeRow_(data, req.targetId);
  if (!source || !target) return fail_('NOT_FOUND');
  var expected = req.expectedEtags || {};
  if (recordEtag_(source.record) !== expected.source || recordEtag_(target.record) !== expected.target) {
    return { ok: false, code: 'CONFLICT', latest: {
      source: clientRecord_(source.record), target: clientRecord_(target.record)
    } };
  }
  var increment = identityKey(source.record) === identityKey(target.record) ? source.record.confirmCount : 1;
  var removed = Object.assign({}, source.record, { deletedAt: now, updatedAt: now });
  var merged = Object.assign({}, target.record, { confirmCount: target.record.confirmCount + increment, updatedAt: now });
  return recordResult_(merged, [changedRecord_(source, removed), changedRecord_(target, merged)], { removed: req.sourceId });
}

function deleteRecord_(req, data, now) {
  var row = validRow_(data, req.id);
  if (!row) return fail_('NOT_FOUND');
  if (row.record.deletedAt !== '') return recordResult_(row.record, [], { idempotent: true });
  if (recordEtag_(row.record) !== req.expectedEtag) {
    return { ok: false, code: 'CONFLICT', latest: clientRecord_(row.record) };
  }
  var record = Object.assign({}, row.record, { deletedAt: now, updatedAt: now });
  return recordResult_(record, [changedRecord_(row, record)]);
}

function restoreRecord_(req, data, now) {
  var row = validRow_(data, req.id);
  if (!row) return fail_('NOT_FOUND');
  if (row.record.deletedAt === '') return recordResult_(row.record, [], { idempotent: true });
  if (recordEtag_(row.record) !== req.expectedEtag) {
    return { ok: false, code: 'CONFLICT', latest: clientRecord_(row.record, true) };
  }
  var duplicate = duplicateRecord_(data, row.record);
  if (duplicate) {
    var target = activeRow_(data, duplicate.id);
    var merged = Object.assign({}, target.record, { confirmCount: target.record.confirmCount + 1, updatedAt: now });
    return recordResult_(merged, [changedRecord_(target, merged)], { mergedInto: duplicate.id });
  }
  var record = Object.assign({}, row.record, { deletedAt: '', updatedAt: now });
  return recordResult_(record, [changedRecord_(row, record)]);
}

function applyMutation_(req, env, mutation) {
  if (!mutation.changes.length) return;
  // Log のヘッダー不備も、レコードを書き換える前に検出する。
  var logTable = readHeader_(sheetFor_(env, 'log'), LOG_HEADERS_);
  mutation.changes.forEach(function (change) { writeRecord_(env, change.rowNumber, change.after); });
  var before = mutation.changes.map(function (change) { return change.before; });
  var after = mutation.changes.map(function (change) { return change.after; });
  appendRecordLog_(env, logTable, req.action, req.id || req.targetId || req.record.id,
    before.length === 1 ? before[0] : before,
    after.length === 1 ? after[0] : after, after[0].updatedAt);
}

function actionMutation_(req, env) {
  var invalid = validateMutation_(req);
  if (invalid) return invalid;
  return withLock_(function () {
    var cache = CacheService.getScriptCache();
    var key = 'op:' + env + ':' + req.opId.toLowerCase();
    var cached = cache.get(key);
    if (cached) return Object.assign(JSON.parse(cached), { snapshot: snapshot_(env) });
    var data = readRecords_(env);
    var operations = {
      create: createRecord_, confirm: confirmRecord_, update: updateRecord_,
      merge: mergeRecords_, delete: deleteRecord_, restore: restoreRecord_
    };
    var mutation = operations[req.action](req, data, new Date().toISOString());
    if (mutation.ok === false) return mutation;
    var users = readUsers_(env);
    applyMutation_(req, env, mutation);
    var latest = readRecords_(env);
    var result = mutation.result;
    var row = validRow_(latest, result.record.id);
    result.record = clientRecord_(row.record, req.action === 'delete' || req.action === 'restore');
    var snapshot = { records: latest.records, warnings: latest.warnings, serverTime: new Date().toISOString(), users: users };
    // キャッシュを成功の証拠として使うため、シートの確定後に保存する。
    SpreadsheetApp.flush();
    cache.put(key, JSON.stringify(result), 21600);
    return Object.assign({}, result, { snapshot: snapshot });
  });
}
