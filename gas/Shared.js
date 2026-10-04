// 自動生成・手で編集しない。scripts/build-gas.mjs で生成。

function pairKey(a, b) {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

function normalizeRecord(rec) {
  if (rec.parent1Id <= rec.parent2Id) return { ...rec };
  return {
    ...rec,
    parent1Id: rec.parent2Id,
    parent2Id: rec.parent1Id,
    parent1Gender: rec.parent2Gender,
    parent2Gender: rec.parent1Gender,
  };
}

function identityKey(rec) {
  return `${pairKey(rec.parent1Id, rec.parent2Id)}>${rec.childId}`;
}

function sanitizeText(s, max) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, max);
}

function validateRecordInput(input, palIdSet) {
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

function needsSheetQuote(s) {
  return /^[=+\-@']/.test(String(s ?? ''));
}

function quoteForSheet(s) {
  const text = String(s ?? '');
  return needsSheetQuote(text) ? `'${text}` : text;
}

function userIdKey(userId) {
  return userId.normalize('NFKC').toLowerCase();
}

function validateUserId(input) {
  if (typeof input !== 'string') {
    return { ok: false, errors: [{ field: 'userId', code: input == null ? 'REQUIRED' : 'INVALID_TYPE' }] };
  }
  const value = input.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  const code = !value ? 'REQUIRED' : value.length > 20 ? 'TOO_LONG' : '';
  return code ? { ok: false, errors: [{ field: 'userId', code }] } : { ok: true, value };
}
