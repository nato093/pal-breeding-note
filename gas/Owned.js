/**
 * 所持パルの共有。ワールドのホスト（セーブを持っている人）の画面がアップロードし、全員が読む。
 * ワールドごとに丸ごと置き換えるので、セーブから消えたパルはシートからも消える。
 *
 * 書き込みは世代ごと（F1。docs/sync-fixes/README.md の 3）: 鍵の中で ①新しい世代の行（updatedAt＝サーバーの時刻）をシートの
 * 最後の行の下に足す → ②OwnedWorlds の行の uploadedAt をその時刻にする（ここで公開）→ ③そのワールドの「今と 1 つ前」以外の世代の
 * 行を消す。他のワールドの行は触らず、シート全体を消して書き直さない。読む側は updatedAt が uploadedAt と同じ行だけを使うので、
 * 書いている途中の行・公開の前に落ちた行（孤児。次の ③で消える）は見えない。1 つ前を残すのは、公開の直前に一覧を読んだ読み手のため。
 * 新旧は Level.sav の中の保存時刻（生のティック。列 saveKey）で比べ、識別がなければセーブのファイルの更新日時で比べる
 *（decideOwnedUpload・compareSaves は Shared.js。画面と同じ定義）。
 */

var OWNED_UPLOAD_FIELDS_ = ['action', 'passcode', 'userId', 'worldId', 'world', 'saveUpdatedAt', 'players', 'bases', 'farms', 'columns', 'rows'];
// 共有の書き込みを止める印（Script Properties。compactOwned が立て、resumeOwned が消す）。環境ごと
var OWNED_PAUSED_PREFIX_ = 'OWNED_PAUSED_';
var OWNED_ENVS_ = ['test', 'prod'];

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

// ゲーム内の日数（後から足した列 inGameDay。save-extras）。列がない（setup() を実行し直す前）・空なら null
function ownedDayCell_(table, cell) {
  if (!Object.prototype.hasOwnProperty.call(table.index, 'inGameDay')) return null;
  return ownedInGameDay(cell('inGameDay'));
}

// セーブの識別（後から足した列 saveKey。owned-gas）。列がない・空・先頭の uploadedAt がその行と違えば null（識別なし）
function ownedIdentityCell_(table, cell, uploadedAt) {
  if (!Object.prototype.hasOwnProperty.call(table.index, 'saveKey')) return null;
  return parseOwnedSaveKey(cell('saveKey'), uploadedAt);
}

function readOwnedWorlds_(env) {
  var table = readTable_(sheetFor_(env, 'ownedWorlds'), OWNED_WORLD_HEADERS_);
  var worlds = [];
  table.rows.forEach(function (values, index) {
    var cell = function (field) { return String(values[table.index[field]] == null ? '' : values[table.index[field]]); };
    var worldId = ownedWorldId(cell('worldId'));
    if (!worldId) return;
    var identity = ownedIdentityCell_(table, cell, cell('uploadedAt'));
    worlds.push({
      rowNumber: index + 2,
      identity: identity,
      world: {
        worldId: worldId, worldName: cell('worldName'), hostName: cell('hostName'),
        saveUpdatedAt: cell('saveUpdatedAt'), uploadedAt: cell('uploadedAt'), uploadedBy: cell('uploadedBy'),
        palCount: Number(cell('palCount')) || 0,
        players: ownedJson_(cell('players'), []), bases: ownedJson_(cell('bases'), []),
        // farms 列は後から足した列。列がない（setup() を実行し直す前）・牧場を送らない古い画面から共有されたときは null（情報がない）
        farms: ownedFarmsCell_(table, cell),
        // inGameDay 列も後から足した列（save-extras）。列がない・送らない古い画面から共有されたときは null
        inGameDay: ownedDayCell_(table, cell),
        // セーブの中の保存時刻（生のティック。owned-gas）。識別がなければ ''
        saveStamp: identity ? identity.stamp : ''
      }
    });
  });
  return { table: table, worlds: worlds };
}

function ownedPaused_(env) {
  return Boolean(PropertiesService.getScriptProperties().getProperty(OWNED_PAUSED_PREFIX_ + env));
}

/**
 * 所持パルのシートの、各行の worldId と世代（updatedAt）。全部の列は読まない（2 列だけ）。
 * last はシートの最後の行（見出しを含む。新しい世代はその下に足す）
 */
function readOwnedGenerations_(sheet, header) {
  var last = sheet.getLastRow();
  if (last < 2) return { last: Math.max(last, 1), rows: [] };
  var ids = sheet.getRange(2, header.index.worldId + 1, last - 1, 1).getValues();
  var times = sheet.getRange(2, header.index.updatedAt + 1, last - 1, 1).getValues();
  var rows = ids.map(function (value, i) {
    return {
      rowNumber: i + 2,
      worldId: String(value[0] == null ? '' : value[0]),
      updatedAt: String(times[i][0] == null ? '' : times[i][0])
    };
  });
  return { last: last, rows: rows };
}

// シートの行数（getMaxRows）の余裕。getRange はシートの行数を超えるとエラーになる。巻き戻し先の古い版（版 10）は行数を足さずに
// 全部の行を消してから書き直すので、行数に余裕がないと、消した後の書き込みに失敗して共有が空になる
var OWNED_ROW_MARGIN_ = 1000;

// 足りない行をシートの末尾に足す（余裕の分も）。シートの行数は減らさない（deleteOwnedRows_ は消した分を末尾に足し戻す）
function ensureOwnedRows_(sheet, lastRow) {
  var max = sheet.getMaxRows();
  if (max < lastRow) sheet.insertRowsAfter(max, lastRow - max + OWNED_ROW_MARGIN_);
}

/**
 * 行を塊ごとに消す（下の塊から消し、上の行の番号を変えない）。消した行の数を返す。
 * 先に同じ数の空の行を末尾に足し、シートの行数を変えない（古い版の書き込みの余裕・読み手の getRange が行数を超えないため。
 * 固定していない行を全部消すことにもならない）
 */
function deleteOwnedRows_(sheet, rowNumbers) {
  if (!rowNumbers.length) return 0;
  var sorted = rowNumbers.slice().sort(function (a, b) { return a - b; });
  var blocks = [];
  sorted.forEach(function (row) {
    var block = blocks[blocks.length - 1];
    if (block && block.start + block.count === row) block.count++;
    else if (!block || block.start + block.count < row) blocks.push({ start: row, count: 1 });
  });
  var total = blocks.reduce(function (sum, block) { return sum + block.count; }, 0);
  sheet.insertRowsAfter(sheet.getMaxRows(), total);
  for (var i = blocks.length - 1; i >= 0; i--) sheet.deleteRows(blocks[i].start, blocks[i].count);
  return total;
}

function ownedTime_(value) {
  var time = Date.parse(value);
  return isFinite(time) ? time : NaN;
}

/**
 * ③ そのワールドの「今（current）と 1 つ前（previous）」以外の世代の行を消す。previous が null なら、今より前でいちばん新しい世代を
 * 1 つ前とみなす（書かない結果のとき。公開した順の記録はないため）。失敗しても共有の成否は変えず false を返す（次の呼び出しでもう一度）
 */
function ownedCleanup_(sheet, rows, current, previous) {
  try {
    var keep = previous;
    if (keep === null) {
      var now = ownedTime_(current);
      var best = NaN;
      keep = '';
      rows.forEach(function (row) {
        var time = ownedTime_(row.updatedAt);
        if (isFinite(time) && time < now && !(time <= best)) { best = time; keep = row.updatedAt; }
      });
    }
    var doomed = rows.filter(function (row) {
      return row.updatedAt !== current && !(keep && row.updatedAt === keep);
    }).map(function (row) { return row.rowNumber; });
    deleteOwnedRows_(sheet, doomed);
    return true;
  } catch (error) {
    console.error('ownedCleanup_ failed: ' + (error && error.stack ? error.stack : error));
    return false;
  }
}

/**
 * 新しい世代の時刻（サーバーの時刻）。今の世代と、残っているそのワールドの行の世代より後にする
 *（サーバーの時計のずれで、孤児の行と同じ時刻にならないように）
 */
function ownedGenerationTime_(existing, rows) {
  var latest = existing ? ownedTime_(existing.world.uploadedAt) : NaN;
  rows.forEach(function (row) {
    var time = ownedTime_(row.updatedAt);
    if (isFinite(time) && !(time <= latest)) latest = time;
  });
  var now = Date.now();
  return new Date(isFinite(latest) && now <= latest ? latest + 1 : now).toISOString();
}

/** そのワールドの、公開している世代（uploadedAt）の行。OWNED_FIELDS の順の文字列の配列 */
function readOwnedRows_(env, worldId, uploadedAt) {
  var table = readTable_(sheetFor_(env, 'ownedPals'), ownedPalRequiredHeaders_());
  var rows = [];
  table.rows.forEach(function (values) {
    if (String(values[table.index.worldId]) !== worldId) return;
    if (String(values[table.index.updatedAt] == null ? '' : values[table.index.updatedAt]) !== uploadedAt) return;
    rows.push(OWNED_FIELDS.map(function (field) {
      // 後から足した列がまだないシートでは空
      var value = Object.prototype.hasOwnProperty.call(table.index, field) ? values[table.index[field]] : '';
      return String(value == null ? '' : value);
    }));
  });
  return rows;
}

/**
 * 1 ワールド分の所持パル（{ world, columns, rows, serverTime }）。行の数が palCount と違えば（読む間に共有が 2 回あり、読んだ世代が
 * 消えた）一覧から 1 回だけ読み直し、それでも違えば再試行できるエラー PARTIAL。palCount 0 は正しい空。
 * 世代が合わないときに worldId の全部の行には落とさない（削除したパルが戻るため）
 */
function ownedPayload_(env, worldId) {
  for (var attempt = 0; attempt < 2; attempt++) {
    var entry;
    var rows;
    try {
      entry = readOwnedWorlds_(env).worlds.find(function (item) { return item.world.worldId === worldId; });
      rows = entry ? readOwnedRows_(env, worldId, entry.world.uploadedAt) : [];
    } catch (error) {
      // 読む間に書き込み（鍵の中）が行を動かして読めなかったときも 1 回だけ読み直す。2 回目は今までどおり失敗にする
      if (attempt > 0 || (error && error.code === 'SHEET_HEADER')) throw error;
      continue;
    }
    var serverTime = new Date().toISOString();
    if (!entry) return { world: null, columns: OWNED_FIELDS, rows: [], serverTime: serverTime };
    if (rows.length === entry.world.palCount) return { world: entry.world, columns: OWNED_FIELDS, rows: rows, serverTime: serverTime };
  }
  return fail_('PARTIAL');
}

/** 共有されているワールドの一覧（パルは含めない）。読む間に書き込みが行を動かして読めなかったときは 1 回だけ読み直す */
function actionOwnedWorlds_(req, env) {
  var worlds;
  try {
    worlds = readOwnedWorlds_(env).worlds;
  } catch (error) {
    if (error && error.code === 'SHEET_HEADER') throw error;
    worlds = readOwnedWorlds_(env).worlds;
  }
  return { worlds: worlds.map(function (entry) { return entry.world; }), serverTime: new Date().toISOString() };
}

/** 1 ワールド分の所持パル。 */
function actionOwned_(req, env) {
  var worldId = ownedWorldId(req.worldId);
  if (!worldId) return validationFailure_('worldId', 'INVALID_WORLD');
  return ownedPayload_(env, worldId);
}

/**
 * 画面が持っている共有の版（uploadedAt）から変わったか（G。参加者の読み直しを 1 回に）。
 * 変わっていなければ { changed: false, uploadedAt, uploadedBy, saveUpdatedAt, palCount, saveStamp, presence }、
 * 変わっていれば owned と同じ中身＋{ changed: true, presence }。presence（ページを開いている PC）を渡せば記録してから一覧を返す
 */
function actionOwnedSince_(req, env) {
  var worldId = ownedWorldId(req.worldId);
  if (!worldId) return validationFailure_('worldId', 'INVALID_WORLD');
  var since = typeof req.uploadedAt === 'string' ? req.uploadedAt : '';
  var presence = presenceExchange_(env, worldId, req.presence).presence;
  var entry = readOwnedWorlds_(env).worlds.find(function (item) { return item.world.worldId === worldId; });
  if (entry && since && entry.world.uploadedAt === since) {
    var world = entry.world;
    return {
      changed: false, uploadedAt: world.uploadedAt, uploadedBy: world.uploadedBy, saveUpdatedAt: world.saveUpdatedAt,
      palCount: world.palCount, saveStamp: world.saveStamp, presence: presence, serverTime: new Date().toISOString()
    };
  }
  var payload = ownedPayload_(env, worldId);
  if (payload.ok === false) return payload;
  return Object.assign({ changed: true }, payload, { presence: presence });
}

function ownedSheetValue_(value) {
  return typeof value === 'string' ? quoteForSheet(value) : value;
}

/** ホストの画面から 1 ワールド分を受け取り、そのワールドの新しい世代として公開する。 */
function actionOwnedUpload_(req, env) {
  var unknown = Object.keys(req).find(function (field) { return OWNED_UPLOAD_FIELDS_.indexOf(field) === -1; });
  if (unknown) return validationFailure_(unknown, 'UNKNOWN_FIELD');
  var checked = validateOwnedUpload(req);
  if (!checked.ok) return { ok: false, code: 'VALIDATION', errors: checked.errors };
  var input = checked.value;
  var uploadedBy = sanitizeText(req.userId, 20);
  return withLock_(function () {
    // 巻き戻しの後に遅れて届いた呼び出しが、世代や saveKey を書き戻さないように（compactOwned）
    if (ownedPaused_(env)) return fail_('BUSY');
    var current = readOwnedWorlds_(env);
    var existing = current.worlds.find(function (item) { return item.world.worldId === input.worldId; });
    var decision = decideOwnedUpload(
      existing ? { saveUpdatedAt: existing.world.saveUpdatedAt, uploadedBy: existing.world.uploadedBy, identity: existing.identity } : null,
      { saveUpdatedAt: input.saveUpdatedAt, uploadedBy: uploadedBy, identity: input.identity, force: input.force }
    );
    var sheet = sheetFor_(env, 'ownedPals');
    var header = readHeader_(sheet, ownedPalRequiredHeaders_());
    var generations = readOwnedGenerations_(sheet, header);
    var mine = generations.rows.filter(function (row) { return row.worldId === input.worldId; });
    if (!decision.write) {
      // 書かない結果でも、消す世代が残っていれば消す（前の ③ の失敗・公開の前に落ちた行）
      var kept = { stored: false, result: decision.result, world: existing.world, cleanup: ownedCleanup_(sheet, mine, existing.world.uploadedAt, null), serverTime: new Date().toISOString() };
      if (decision.result === 'stale') kept.reason = 'STALE';
      return kept;
    }
    var serverTime = ownedGenerationTime_(existing, mine);

    // ① 新しい世代の行を最後の行の下に書く（まだ公開しない）
    var width = header.headers.length;
    var added = input.rows.map(function (cells) {
      var line = header.headers.map(function () { return ''; });
      line[header.index.worldId] = input.worldId;
      line[header.index.updatedAt] = serverTime;
      // 後から足した列がまだないシートには、その列を書かない
      OWNED_FIELDS.forEach(function (field, i) {
        if (Object.prototype.hasOwnProperty.call(header.index, field)) line[header.index[field]] = ownedSheetValue_(cells[i]);
      });
      return line;
    });
    if (added.length) {
      var start = generations.last + 1;
      ensureOwnedRows_(sheet, start + added.length - 1);
      var range = sheet.getRange(start, 1, added.length, width);
      range.setNumberFormat('@');
      range.setValues(added);
    }
    SpreadsheetApp.flush();

    // ② ワールドの行を書く（uploadedAt を新しい世代の時刻に＝公開）
    var hasKey = Object.prototype.hasOwnProperty.call(current.table.index, 'saveKey');
    var world = {
      worldId: input.worldId, worldName: input.worldName, hostName: input.hostName, saveUpdatedAt: input.saveUpdatedAt,
      uploadedAt: serverTime, uploadedBy: uploadedBy, palCount: input.rows.length, players: input.players, bases: input.bases,
      farms: input.farms,
      // 列がない（setup() を実行し直す前の）シートには書かないので、返す値も読み直したときと同じ null・'' にする
      inGameDay: Object.prototype.hasOwnProperty.call(current.table.index, 'inGameDay') ? input.inGameDay : null,
      saveStamp: hasKey && input.identity ? input.identity.stamp : ''
    };
    var worldSheet = sheetFor_(env, 'ownedWorlds');
    var worldRow = existing ? existing.rowNumber : worldSheet.getLastRow() + 1;
    // 削除（deleteRows）のたびにシートの行数も減るので、新しいワールドの行が入らなければ足す
    ensureOwnedRows_(worldSheet, worldRow);
    writeTableRow_(worldSheet, current.table, worldRow, {
      worldId: world.worldId, worldName: quoteForSheet(world.worldName), hostName: quoteForSheet(world.hostName),
      saveUpdatedAt: world.saveUpdatedAt, uploadedAt: world.uploadedAt, uploadedBy: quoteForSheet(world.uploadedBy),
      palCount: String(world.palCount), players: quoteForSheet(JSON.stringify(world.players)), bases: quoteForSheet(JSON.stringify(world.bases)),
      // 列がない（setup() を実行し直す前の）シートでは書かれない
      farms: quoteForSheet(JSON.stringify(world.farms)),
      inGameDay: world.inGameDay === null ? '' : String(world.inGameDay),
      // 識別のない共有では空にする（前の識別を残さない。空どうしは同じセーブとみなさない）
      saveKey: ownedSaveKey(serverTime, input.identity)
    });
    SpreadsheetApp.flush();

    // ③ 今と 1 つ前以外の世代を消す（新しいワールドなら、残っている行は全部孤児）
    var cleanup = ownedCleanup_(sheet, mine, serverTime, existing ? existing.world.uploadedAt : '');
    return { stored: true, result: decision.result, world: world, cleanup: cleanup, serverTime: serverTime };
  });
}

/** 1 ワールド分の共有をやめる（シートから消す）。 */
function actionOwnedDelete_(req, env) {
  var worldId = ownedWorldId(req.worldId);
  if (!worldId) return validationFailure_('worldId', 'INVALID_WORLD');
  return withLock_(function () {
    if (ownedPaused_(env)) return fail_('BUSY');
    var current = readOwnedWorlds_(env);
    var existing = current.worlds.find(function (item) { return item.world.worldId === worldId; });
    // 先にワールドの行を消す（公開をやめる）。所持パルの行を消す途中で落ちても、残った行は読まれず、次の削除・共有で消える
    if (existing) {
      deleteOwnedRows_(sheetFor_(env, 'ownedWorlds'), [existing.rowNumber]);
      SpreadsheetApp.flush();
    }
    var sheet = sheetFor_(env, 'ownedPals');
    var header = readHeader_(sheet, ownedPalRequiredHeaders_());
    var mine = readOwnedGenerations_(sheet, header).rows.filter(function (row) { return row.worldId === worldId; });
    var removed = deleteOwnedRows_(sheet, mine.map(function (row) { return row.rowNumber; }));
    return { deleted: Boolean(existing), removed: removed, serverTime: new Date().toISOString() };
  });
}

/**
 * 巻き戻し（本番の deployment を古い版に戻した後）に、GAS の編集画面から実行する: 指定した環境（'test'・'prod'）の共有の書き込みを
 * 止める印を立て、全ワールドを今の世代だけにし（古い版は世代を見ずに worldId の全部の行を読むため）、saveKey の列を空にする。
 * env がそれ以外・省略（編集画面の実行ボタンで引数なし）なら何もせずに止める。実行ボタンからは compactOwnedTest・compactOwnedProd を使う
 */
function compactOwned(env) {
  if (OWNED_ENVS_.indexOf(env) === -1) throw new Error("compactOwned: env に 'test' か 'prod' を指定してください（何もしていません）");
  return withLock_(function () {
    PropertiesService.getScriptProperties().setProperty(OWNED_PAUSED_PREFIX_ + env, new Date().toISOString());
    var current = readOwnedWorlds_(env);
    var published = Object.create(null);
    current.worlds.forEach(function (entry) { published[entry.world.worldId] = entry.world.uploadedAt; });
    var sheet = sheetFor_(env, 'ownedPals');
    var header = readHeader_(sheet, ownedPalRequiredHeaders_());
    var doomed = readOwnedGenerations_(sheet, header).rows.filter(function (row) {
      // 公開していないワールドの行（削除の途中で残った行）も消す。worldId の読めない行は触らない
      return ownedWorldId(row.worldId) === row.worldId && row.worldId && published[row.worldId] !== row.updatedAt;
    }).map(function (row) { return row.rowNumber; });
    var removed = deleteOwnedRows_(sheet, doomed);
    // 古い版は行数を足さないので、いちばん大きいワールドが倍になっても書ける余裕を残す
    var largest = current.worlds.reduce(function (max, entry) { return Math.max(max, entry.world.palCount); }, 0);
    ensureOwnedRows_(sheet, sheet.getLastRow() + Math.max(OWNED_ROW_MARGIN_, largest));
    var table = current.table;
    if (Object.prototype.hasOwnProperty.call(table.index, 'saveKey') && table.rows.length) {
      sheetFor_(env, 'ownedWorlds').getRange(2, table.index.saveKey + 1, table.rows.length, 1).clearContent();
    }
    var result = { env: env, worlds: current.worlds.length, removed: removed, paused: true };
    console.log('compactOwned: ' + JSON.stringify(result));
    return result;
  });
}

/** 共有の書き込みを止める印を消す（新しい版に戻すとき。update-deployment の前に実行する） */
function resumeOwned(env) {
  if (OWNED_ENVS_.indexOf(env) === -1) throw new Error("resumeOwned: env に 'test' か 'prod' を指定してください（何もしていません）");
  return withLock_(function () {
    PropertiesService.getScriptProperties().deleteProperty(OWNED_PAUSED_PREFIX_ + env);
    var result = { env: env, paused: false };
    console.log('resumeOwned: ' + JSON.stringify(result));
    return result;
  });
}

// GAS の編集画面の実行ボタン用（引数を渡せないため）
function compactOwnedTest() { return compactOwned('test'); }
function compactOwnedProd() { return compactOwned('prod'); }
function resumeOwnedTest() { return resumeOwned('test'); }
function resumeOwnedProd() { return resumeOwned('prod'); }
