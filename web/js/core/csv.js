import { quoteForSheet } from './validate.js';

export function toCsv(rows, columns) {
  const encode = (value) => `"${quoteForSheet(value).replace(/"/g, '""')}"`;
  const lines = [columns.map(encode).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column, position) => encode(Array.isArray(row) ? row[position] : row[column])).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}`;
}

export function parseCsv(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  if (!source) return [];
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char !== '"') {
        cell += char;
      } else if (source[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = false;
      }
      continue;
    }
    if (char === '"' && cell === '') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\r' || char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (char === '\r' && source[i + 1] === '\n') i++;
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error('CSV の引用符が閉じられていません');
  if (row.length || cell || !/[\r\n]$/.test(source)) rows.push([...row, cell]);
  return rows;
}
