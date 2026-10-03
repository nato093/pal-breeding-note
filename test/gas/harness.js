// GAS のコードを Node の vm で読み込み、Google サービスの偽物を差し込むテスト用ハーネス。
// 本物の GAS と同じく、gas/*.js をすべて同じグローバル空間に読み込む。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const GAS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../gas');

// ---- Spreadsheet の偽物 -------------------------------------------------

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const line = [];
      for (let c = 0; c < this.numCols; c++) line.push(this.sheet.cell(this.row + r, this.col + c));
      out.push(line);
    }
    return out;
  }
  setValues(values) {
    if (values.length !== this.numRows || values.some((v) => v.length !== this.numCols)) {
      throw new Error('setValues: size mismatch');
    }
    // 実機は数式対策の先頭の ' を外して返すが、この偽物は評価も除去もせず値をそのまま返す。
    this.sheet.log.push({ op: 'setValues', row: this.row });
    values.forEach((line, r) => line.forEach((v, c) => this.sheet.setCell(this.row + r, this.col + c, v)));
    return this;
  }
  getValue() { return this.sheet.cell(this.row, this.col); }
  getDisplayValue() { return String(this.getValue()); }
  getFormula() { return ''; }
  setNumberFormat(fmt) {
    this.sheet.log.push({ op: 'setNumberFormat', row: this.row, fmt });
    this.sheet.formats.push({ row: this.row, numRows: this.numRows, fmt });
    return this;
  }
  protect() {
    const p = new FakeProtection();
    this.sheet.protections.push(p);
    return p;
  }
}

class FakeProtection {
  constructor() { this.description = ''; this.warningOnly = false; }
  setDescription(d) { this.description = d; return this; }
  getDescription() { return this.description; }
  setWarningOnly(w) { this.warningOnly = w; return this; }
}

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.data = [];
    this.formats = [];
    this.protections = [];
    this.frozenRows = 0;
    this.log = [];
  }
  getName() { return this.name; }
  cell(r, c) { return (this.data[r - 1] && this.data[r - 1][c - 1] !== undefined) ? this.data[r - 1][c - 1] : ''; }
  setCell(r, c, v) {
    while (this.data.length < r) this.data.push([]);
    const line = this.data[r - 1];
    while (line.length < c) line.push('');
    line[c - 1] = v;
  }
  getLastRow() {
    for (let r = this.data.length; r >= 1; r--) {
      if (this.data[r - 1].some((v) => v !== '' && v !== null && v !== undefined)) return r;
    }
    return 0;
  }
  getLastColumn() {
    let max = 0;
    this.data.forEach((line) => line.forEach((v, i) => { if (v !== '' && v !== null && v !== undefined) max = Math.max(max, i + 1); }));
    return max;
  }
  getMaxRows() { return Math.max(1000, this.data.length); }
  getRange(row, col, numRows = 1, numCols = 1) { return new FakeRange(this, row, col, numRows, numCols); }
  setFrozenRows(n) { this.frozenRows = n; }
  getProtections() { return this.protections; }
  deleteRows(start, count) { this.data.splice(start - 1, count); }
  /** テスト用: ヘッダーとデータ行をまとめて入れる */
  seed(rows) { rows.forEach((line, r) => line.forEach((v, c) => this.setCell(r + 1, c + 1, v))); }
}

class FakeSpreadsheet {
  constructor() { this.sheets = [new FakeSheet('シート1')]; }
  getSheetByName(name) { return this.sheets.find((s) => s.name === name) || null; }
  insertSheet(name) {
    if (this.getSheetByName(name)) throw new Error('sheet exists: ' + name);
    const s = new FakeSheet(name);
    this.sheets.push(s);
    return s;
  }
  getSheets() { return this.sheets.slice(); }
  deleteSheet(sheet) { this.sheets = this.sheets.filter((s) => s !== sheet); }
}

// ---- その他のサービス ---------------------------------------------------

function createProperties(initial = {}) {
  const store = { ...initial };
  return {
    store,
    getProperty: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setProperty(k, v) { store[k] = String(v); return this; },
    deleteProperty(k) { delete store[k]; return this; },
  };
}

/**
 * GAS のコードを読み込んだ実行環境を作る。
 * events には flush と releaseLock の呼び出し順が記録される（flush → release の順序を検査するため）。
 */
export function createGas({ properties = {}, lockAvailable = true, spreadsheet = new FakeSpreadsheet() } = {}) {
  const events = [];
  const logs = { log: [], error: [] };
  const props = createProperties(properties);
  const cacheEntries = new Map();
  const cache = {
    get: (key) => cacheEntries.get(key) ?? null,
    put: (key, value, seconds) => {
      events.push('cachePut');
      cacheEntries.set(key, String(value));
      cache.puts.push({ key, seconds });
    },
    remove: (key) => cacheEntries.delete(key),
    puts: [],
  };

  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      flush: () => events.push('flush'),
      ProtectionType: { RANGE: 'RANGE', SHEET: 'SHEET' },
    },
    PropertiesService: { getScriptProperties: () => props },
    CacheService: { getScriptCache: () => cache },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => { events.push('tryLock'); return lockAvailable; },
        releaseLock: () => events.push('releaseLock'),
      }),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({ text, mime: null, setMimeType(m) { this.mime = m; return this; } }),
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' },
      // GAS は符号付きバイト（-128〜127）の配列を返す
      computeDigest: (alg, value) => Array.from(crypto.createHash(alg).update(String(value), 'utf8').digest(), (b) => (b > 127 ? b - 256 : b)),
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes.map((b) => b & 255)).toString('base64url'),
    },
    console: {
      log: (...a) => logs.log.push(a.join(' ')),
      error: (...a) => logs.error.push(a.join(' ')),
    },
  };
  const context = vm.createContext(sandbox);
  for (const file of fs.readdirSync(GAS_DIR).filter((f) => f.endsWith('.js')).sort()) {
    vm.runInContext(fs.readFileSync(path.join(GAS_DIR, file), 'utf8'), context, { filename: file });
  }
  return { gas: context, spreadsheet, props, events, logs, cache };
}

export { FakeSpreadsheet, FakeSheet };
