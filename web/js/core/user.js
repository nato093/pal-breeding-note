export function userIdKey(userId) {
  return userId.normalize('NFKC').toLowerCase();
}

export function validateUserId(input) {
  if (typeof input !== 'string') {
    return { ok: false, errors: [{ field: 'userId', code: input == null ? 'REQUIRED' : 'INVALID_TYPE' }] };
  }
  const value = input.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  const code = !value ? 'REQUIRED' : value.length > 20 ? 'TOO_LONG' : '';
  return code ? { ok: false, errors: [{ field: 'userId', code }] } : { ok: true, value };
}
