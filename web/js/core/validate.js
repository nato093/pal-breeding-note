export function sanitizeText(s, max) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, max);
}

export function validateRecordInput(input, palIdSet) {
  const source = input ?? {};
  const value = {};
  const errors = [];
  for (const field of ['parent1Id', 'parent2Id', 'childId']) {
    value[field] = source[field];
    if (!palIdSet.has(value[field])) errors.push({ field, code: 'INVALID_PAL_ID' });
  }
  for (const field of ['parent1Gender', 'parent2Gender']) {
    value[field] = source[field] ?? '';
    if (!['M', 'F', ''].includes(value[field])) errors.push({ field, code: 'INVALID_GENDER' });
  }
  for (const [field, max] of [['registrant', 30], ['memo', 200]]) {
    // 切り詰める前に検証し、長すぎる入力を黙って保存しない。
    value[field] = sanitizeText(source[field], Infinity);
    if (value[field].length > max) errors.push({ field, code: 'TOO_LONG' });
  }
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

export function needsSheetQuote(s) {
  return /^[=+\-@']/.test(String(s ?? ''));
}

export function quoteForSheet(s) {
  const text = String(s ?? '');
  return needsSheetQuote(text) ? `'${text}` : text;
}
