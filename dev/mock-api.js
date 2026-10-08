// Node のテストと /dev/ 配信で同じモジュールを使うため、公開 URL に合わせる。
const webRoot = new URL(import.meta.url.startsWith('file:') ? '../web/' : '../', import.meta.url);
const [{ default: pals }, { normalizeRecord, identityKey, pairKey }, { validateRecordInput }, { validateUserId, userIdKey }, { OWNED_FIELDS, validateOwnedUpload, ownedWorldId }] = await Promise.all([
  import(new URL('data/pals.js', webRoot)), import(new URL('js/core/pair.js', webRoot)), import(new URL('js/core/validate.js', webRoot)), import(new URL('js/core/user.js', webRoot)),
  import(new URL('js/core/owned-shared.js', webRoot)),
]);

const fields = {
  login: ['userId'], signup: ['userId', 'opId'], rename: ['opId', 'userId', 'newUserId'],
  snapshot: [], create: ['opId', 'record', 'allowDifferentChild'], confirm: ['opId', 'id'],
  update: ['opId', 'id', 'expectedEtag', 'record', 'allowDifferentChild'],
  merge: ['opId', 'sourceId', 'targetId', 'expectedEtags'], delete: ['opId', 'id', 'expectedEtag'], restore: ['opId', 'id', 'expectedEtag'],
  ownedWorlds: [], owned: ['worldId'], ownedDelete: ['worldId'],
  ownedUpload: ['userId', 'worldId', 'world', 'saveUpdatedAt', 'players', 'bases', 'farms', 'columns', 'rows'],
};
const inputFields = ['parent1Id', 'parent2Id', 'childId', 'parent1Gender', 'parent2Gender', 'registrant', 'memo'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = (field, code) => ({ ok: false, code: 'VALIDATION', errors: [{ field, code }] });
const fail = (code, data = {}) => ({ ok: false, code, ...data });

export function createDevelopmentApi({ seed, passcode } = {}) {
  const records = new Map();
  const users = [];
  const operations = new Map();
  // 所持パルの共有（ワールド ID → { world, rows }）。GAS の OwnedPals / OwnedWorlds と同じ規則で扱う
  const ownedWorlds = new Map();
  const palIds = new Set(pals.map((pal) => pal.id));
  let revision = 0;
  let acceptedPasscode = passcode?.trim();
  const active = () => [...records.values()].filter((record) => !record.deleted);
  const publish = (record) => {
    const updated = { ...record, etag: `local-${++revision}` };
    records.set(updated.id, updated);
    return updated;
  };

  function snapshot() {
    const visible = active().map(({ deleted, ...record }) => record);
    const identities = new Map();
    for (const record of visible) {
      const key = identityKey(record);
      identities.set(key, (identities.get(key) ?? 0) + 1);
    }
    const warnings = visible.filter((record) => identities.get(identityKey(record)) > 1)
      .map((record) => ({ code: 'DUPLICATE_RECORD', id: record.id }));
    return { records: visible, warnings, serverTime: new Date().toISOString(), users: [...users] };
  }

  function duplicates(record, checkPair, allowDifferentChild) {
    const others = active().filter((other) => other.id !== record.id);
    const duplicate = others.find((other) => identityKey(other) === identityKey(record));
    if (duplicate) return fail('DUPLICATE', { existing: duplicate });
    if (!checkPair || allowDifferentChild === true) return null;
    const conflicts = others.filter((other) => pairKey(other.parent1Id, other.parent2Id) === pairKey(record.parent1Id, record.parent2Id)
      && other.childId !== record.childId);
    return conflicts.length ? fail('PAIR_CONFLICT', { existing: conflicts }) : null;
  }

  function checkedInput(input, create) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid('record', 'INVALID_RECORD');
    const allowed = create ? ['id', ...inputFields] : inputFields;
    const unknown = Object.keys(input).find((key) => !allowed.includes(key));
    if (unknown) return invalid(unknown, 'UNKNOWN_FIELD');
    if (create && !uuid.test(input.id ?? '')) return invalid('id', 'INVALID_UUID');
    const checked = validateRecordInput(input, palIds);
    if (!checked.ok) return { ok: false, code: 'VALIDATION', errors: checked.errors };
    return { value: normalizeRecord(checked.value) };
  }

  function create(request, now) {
    const checked = checkedInput(request.record, true);
    if (checked.ok === false) return checked;
    const input = { id: request.record.id, ...checked.value };
    const same = records.get(input.id);
    if (same) {
      if (!Object.keys(input).every((key) => input[key] === same[key])) return fail('ID_CONFLICT');
      return { record: same, idempotent: true };
    }
    const conflict = duplicates(input, true, request.allowDifferentChild);
    if (conflict) return conflict;
    return { record: publish({ ...input, confirmCount: 1, createdAt: now, updatedAt: now, deleted: false }) };
  }

  function merge(request, now) {
    const source = records.get(request.sourceId);
    const target = records.get(request.targetId);
    if (!source || !target || source.deleted || target.deleted) return fail('NOT_FOUND');
    if (source.etag !== request.expectedEtags?.source || target.etag !== request.expectedEtags?.target) {
      return fail('CONFLICT', { latest: { source, target } });
    }
    const count = identityKey(source) === identityKey(target) ? source.confirmCount : 1;
    publish({ ...source, deleted: true, updatedAt: now });
    return { record: publish({ ...target, confirmCount: target.confirmCount + count, updatedAt: now }), removed: source.id };
  }

  function mutate(request, now) {
    if (request.action === 'create') return create(request, now);
    if (request.action === 'merge') return merge(request, now);
    const record = records.get(request.id);
    if (!record || (record.deleted && ['confirm', 'update'].includes(request.action))) return fail('NOT_FOUND');
    if (request.action === 'confirm') {
      return { record: publish({ ...record, confirmCount: record.confirmCount + 1, updatedAt: now }) };
    }
    if ((request.action === 'delete' && record.deleted) || (request.action === 'restore' && !record.deleted)) {
      return { record, idempotent: true };
    }
    if (record.etag !== request.expectedEtag) return fail('CONFLICT', { latest: record });
    if (request.action === 'delete') return { record: publish({ ...record, deleted: true, updatedAt: now }) };
    if (request.action === 'restore') {
      const existing = active().find((other) => other.id !== record.id && identityKey(other) === identityKey(record));
      if (existing) return {
        record: publish({ ...existing, confirmCount: existing.confirmCount + 1, updatedAt: now }), mergedInto: existing.id,
      };
      return { record: publish({ ...record, deleted: false, updatedAt: now }) };
    }
    const checked = checkedInput(request.record, false);
    if (checked.ok === false) return checked;
    const updated = { ...record, ...checked.value, updatedAt: now };
    const changed = identityKey(record) !== identityKey(updated);
    const conflict = duplicates(updated, changed, request.allowDifferentChild);
    if (conflict) return conflict;
    if (changed) updated.confirmCount = 1;
    return { record: publish(updated) };
  }

  // 明示された件数だけ架空のランダム配合を用意し、既定では一件も作らない。
  const count = Number(seed);
  if (seed !== null && seed !== undefined && Number.isSafeInteger(count) && count > 0) {
    users.push('架空データ');
    const available = pals.filter((pal) => pal.active);
    const max = available.length * (available.length + 1) / 2 * available.length;
    const identities = new Set();
    while (records.size < Math.min(count, max)) {
      const randomId = () => available[Math.floor(Math.random() * available.length)].id;
      const input = normalizeRecord({ parent1Id: randomId(), parent2Id: randomId(), childId: randomId() });
      if (identities.has(identityKey(input))) continue;
      identities.add(identityKey(input));
      const now = new Date().toISOString();
      publish({ id: crypto.randomUUID(), ...input, parent1Gender: '', parent2Gender: '', registrant: '架空データ',
        memo: '動作確認用のランダムな配合です。ゲームの配合を示すものではありません。',
        confirmCount: 1, createdAt: now, updatedAt: now, deleted: false });
    }
  }

  function owned(request) {
    const serverTime = new Date().toISOString();
    if (request.action === 'ownedWorlds') return { worlds: [...ownedWorlds.values()].map((entry) => entry.world), serverTime };
    if (request.action === 'ownedUpload') {
      const checked = validateOwnedUpload(request);
      if (!checked.ok) return { ok: false, code: 'VALIDATION', errors: checked.errors };
      const input = checked.value;
      const existing = ownedWorlds.get(input.worldId);
      if (existing && Date.parse(existing.world.saveUpdatedAt) > Date.parse(input.saveUpdatedAt)) {
        return { stored: false, reason: 'STALE', world: existing.world, serverTime };
      }
      const world = {
        worldId: input.worldId, worldName: input.worldName, hostName: input.hostName, saveUpdatedAt: input.saveUpdatedAt,
        uploadedAt: serverTime, uploadedBy: String(request.userId ?? '').slice(0, 20), palCount: input.rows.length, players: input.players, bases: input.bases,
        farms: input.farms,
      };
      ownedWorlds.set(input.worldId, { world, rows: input.rows });
      return { stored: true, world, serverTime };
    }
    const worldId = ownedWorldId(request.worldId);
    if (!worldId) return invalid('worldId', 'INVALID_WORLD');
    if (request.action === 'ownedDelete') {
      const existing = ownedWorlds.get(worldId);
      ownedWorlds.delete(worldId);
      return { deleted: Boolean(existing), removed: existing?.rows.length ?? 0, serverTime };
    }
    const entry = ownedWorlds.get(worldId);
    return { world: entry?.world ?? null, columns: OWNED_FIELDS, rows: entry?.rows ?? [], serverTime };
  }

  // 名前の変更。配合の登録者名と所持パルの共有者名も新しい名前にそろえる（GAS の actionRename_ と同じ判定）。
  function rename(request) {
    if (!uuid.test(request.opId ?? '')) return invalid('opId', 'INVALID_UUID');
    const current = validateUserId(request.userId);
    if (!current.ok) return { ok: false, code: 'VALIDATION', errors: current.errors };
    const next = validateUserId(request.newUserId);
    if (!next.ok) return invalid('newUserId', next.errors[0].code);
    if (next.value === current.value) return invalid('newUserId', 'SAME_ID');
    const key = request.opId.toLowerCase();
    if (operations.has(key)) return { ...operations.get(key), ...snapshot() };
    const index = users.findIndex((userId) => userIdKey(userId) === userIdKey(current.value));
    if (index < 0) return fail('USER_NOT_FOUND');
    if (users.some((userId, i) => i !== index && userIdKey(userId) === userIdKey(next.value))) return fail('USER_EXISTS');
    const from = userIdKey(current.value);
    for (const record of records.values()) if (userIdKey(record.registrant) === from) publish({ ...record, registrant: next.value });
    for (const { world } of ownedWorlds.values()) if (userIdKey(world.uploadedBy) === from) world.uploadedBy = next.value;
    users[index] = next.value;
    const result = { userId: next.value };
    operations.set(key, result);
    return { ...result, ...snapshot() };
  }

  return async (request) => {
    if (!request || !fields[request.action]) return fail('BAD_REQUEST');
    if (typeof request.passcode !== 'string' || !request.passcode.trim()) return fail('AUTH');
    // ローカルの初回入力をセッションのコードとし、以後の誤入力も検証できるようにする。
    if (acceptedPasscode === undefined) acceptedPasscode = request.passcode.trim();
    if (request.passcode.trim() !== acceptedPasscode) return fail('AUTH');
    const unknown = Object.keys(request).find((key) => !['action', 'passcode', ...fields[request.action]].includes(key));
    if (unknown) return invalid(unknown, 'UNKNOWN_FIELD');
    const base = { ok: true, env: 'test', api: 'pal-note-local-v1' };
    if (request.action === 'snapshot') return { ...base, ...snapshot() };
    if (request.action.startsWith('owned')) return structuredClone({ ...base, ...owned(request) });
    if (request.action === 'rename') {
      const result = rename(request);
      return structuredClone(result.ok === false ? result : { ...base, ...result });
    }
    if (['login', 'signup'].includes(request.action)) {
      if (request.action === 'signup' && !uuid.test(request.opId ?? '')) return invalid('opId', 'INVALID_UUID');
      const checked = validateUserId(request.userId);
      if (!checked.ok) return { ok: false, code: 'VALIDATION', errors: checked.errors };
      const key = request.opId?.toLowerCase();
      if (request.action === 'signup' && operations.has(key)) {
        return structuredClone({ ...base, ...operations.get(key), ...snapshot() });
      }
      const existing = users.find((userId) => userIdKey(userId) === userIdKey(checked.value));
      if (request.action === 'login') {
        return existing ? { ...base, userId: existing, ...snapshot() } : fail('USER_NOT_FOUND');
      }
      if (existing) return fail('USER_EXISTS');
      users.push(checked.value);
      const result = { userId: checked.value };
      operations.set(key, result);
      return { ...base, ...result, ...snapshot() };
    }
    if (!uuid.test(request.opId ?? '')) return invalid('opId', 'INVALID_UUID');
    const idFields = request.action === 'merge' ? ['sourceId', 'targetId'] : request.action === 'create' ? [] : ['id'];
    for (const key of idFields) if (!uuid.test(request[key] ?? '')) return invalid(key, 'INVALID_UUID');
    if (request.action === 'merge' && request.sourceId === request.targetId) return invalid('targetId', 'SAME_RECORD');
    const key = request.opId.toLowerCase();
    if (operations.has(key)) return structuredClone({ ...base, ...operations.get(key), snapshot: snapshot() });
    const result = mutate(request, new Date().toISOString());
    if (result.ok === false) return structuredClone(result);
    const output = { ...result, record: { ...result.record } };
    if (!['delete', 'restore'].includes(request.action)) delete output.record.deleted;
    operations.set(key, structuredClone(output));
    return structuredClone({ ...base, ...output, snapshot: snapshot() });
  };
}
