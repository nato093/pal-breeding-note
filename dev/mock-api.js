// Node のテストと /dev/ 配信で同じモジュールを使うため、公開 URL に合わせる。
const webRoot = new URL(import.meta.url.startsWith('file:') ? '../web/' : '../', import.meta.url);
const [
  { default: pals }, { normalizeRecord, identityKey, pairKey }, { validateRecordInput }, { validateUserId, userIdKey },
  {
    OWNED_FIELDS, OWNED_PRESENCE_MAX, OWNED_PRESENCE_TTL_S, validateOwnedUpload, ownedWorldId, decideOwnedUpload, cleanPresenceInput,
    validatePlayerMapSet, planPlayerMapSet, cleanPlayerMapEntries,
  },
] = await Promise.all([
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
  // 共有が変わったか・ページを開いている PC（GAS の ownedSince・presence と同じ動き。owned-gas）
  ownedSince: ['worldId', 'uploadedAt', 'presence'], presence: ['worldId', 'presence'],
  // プレイヤーの対応（GAS の playerMap・playerMapSet と同じ規則。server の mapping）
  playerMap: ['worldId'], playerMapSet: ['userId', 'worldId', 'entries', 'onlyMissing'],
};
const inputFields = ['parent1Id', 'parent2Id', 'childId', 'parent1Gender', 'parent2Gender', 'registrant', 'memo'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = (field, code) => ({ ok: false, code: 'VALIDATION', errors: [{ field, code }] });
const fail = (code, data = {}) => ({ ok: false, code, ...data });

// as=viewer で入れておく共有ワールド（roles。X-12）。3 人・拠点 2・牧場 3・パル 30 体
export const VIEWER_WORLD_ID = 'D1E2A3B4C5F60718293A4B5C6D7E8F90';

export function createDevelopmentApi({ seed, passcode, as, now: clock = () => Date.now() } = {}) {
  const records = new Map();
  const users = [];
  const operations = new Map();
  // 所持パルの共有（ワールド ID → { world, rows, identity }）。GAS の OwnedPals / OwnedWorlds と同じ規則で扱う
  //（世代は今の 1 つだけを持つ。メモリの中なので、書いている途中を読まれることはない）
  const ownedWorlds = new Map();
  // ページを開いている PC（ワールド ID → ページの ID → { entry, at }）。GAS の CacheService と同じく 6 時間・1 ワールド 50 件
  const presences = new Map();
  // プレイヤーの対応（ワールド ID → 鍵 → { key, userId, playerName, updatedBy, updatedAt }）。GAS のシート PlayerMap と同じく、外した対応は
  // userId '' の印として残す
  const playerMaps = new Map();
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
  // 乱数は件数から決まる並び（mulberry32）。同じ件数なら毎回同じ配合になり、テスト（「この親の配合はまだ登録されていません」など、
  // たまたまその親の配合ができると落ちる確かめ）と画面の確かめが揺れない（フェーズ 4 の終わりのレビュー。前は Math.random）
  const count = Number(seed);
  if (seed !== null && seed !== undefined && Number.isSafeInteger(count) && count > 0) {
    users.push('架空データ');
    const available = pals.filter((pal) => pal.active);
    const max = available.length * (available.length + 1) / 2 * available.length;
    const identities = new Set();
    let state = (0x5eed0000 + count) | 0;
    const random = () => {
      state = (state + 0x6D2B79F5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    while (records.size < Math.min(count, max)) {
      const randomId = () => available[Math.floor(random() * available.length)].id;
      const input = normalizeRecord({ parent1Id: randomId(), parent2Id: randomId(), childId: randomId() });
      if (identities.has(identityKey(input))) continue;
      identities.add(identityKey(input));
      const now = new Date().toISOString();
      publish({ id: crypto.randomUUID(), ...input, parent1Gender: '', parent2Gender: '', registrant: '架空データ',
        memo: '動作確認用のランダムな配合です。ゲームの配合を示すものではありません。',
        confirmCount: 1, createdAt: now, updatedAt: now, deleted: false });
    }
  }

  // 開発用の役割の切り替え: as=viewer は、ホスト（Alice）が 3 分前に共有したワールドを 1 つ入れておく（未連携で共有を見ている人の画面を
  // 確かめる。ホスト・参加者はファイルのハンドルのスタブが要るので、必要になってから足す）
  if (as === 'viewer') seedViewerWorld();
  function seedViewerWorld() {
    const now = Date.now();
    // Lv とプレイ中（save-extras。players の JSON の中）。Alice と Bob はプレイ中。Alice には捕獲数（server の share-extras）
    const players = [
      { uid: '00000000-0000-0000-0000-00000000a11c', name: 'Alice', level: 52, online: true, captures: { SheepBall: 12, PinkCat: 3 } },
      { uid: '00000000-0000-0000-0000-00000000b0b0', name: 'Bob', level: 47, online: true },
      { uid: '00000000-0000-0000-0000-00000000ca01', name: 'Carol', level: 31, online: false },
    ];
    const bases = [{ id: 'base-1', label: '拠点 1' }, { id: 'base-2', label: '拠点 2' }];
    const species = ['SheepBall', 'PinkCat', 'CuteFox', 'FlowerDoll', 'CatMage', 'Kitsunebi', 'ChickenPal', 'Anubis', 'BlackCentaur', 'LongCat'].filter((id) => palIds.has(id));
    const passiveSets = [['CraftSpeed_up2'], ['Rare', 'CraftSpeed_up2'], ['Noukin'], [], ['PAL_sadist', 'Rare'], ['PAL_rude']];
    const rows = Array.from({ length: 30 }, (_, index) => {
      const palId = species[index % species.length];
      const holder = players[index % players.length];
      const atBase = index % 4 === 3;
      const base = bases[index % bases.length];
      const page = 1 + Math.floor(index / 30);
      // 最後の 3 体は拠点 1 の配合牧場の上のタマゴ（farm-data の牧場のタマゴの共有を確かめる）
      if (index >= 27) {
        return OWNED_FIELDS.map((field) => ({
          instanceId: `viewer-${String(index).padStart(3, '0')}`, palId, palName: pals.find((pal) => pal.id === palId)?.ja ?? palId, characterId: palId,
          rank: '1', stars: '0', egg: '1', place: 'egg-ground', placeLabel: 'タマゴ（地面）・拠点 1', holder: '拠点 1', baseId: 'base-1',
        })[field] ?? '');
      }
      const value = {
        instanceId: `viewer-${String(index).padStart(3, '0')}`, palId, palName: pals.find((pal) => pal.id === palId)?.ja ?? palId, characterId: palId, nickname: '',
        gender: index % 2 ? 'M' : 'F', level: String(5 + (index * 7) % 50), rank: '1', stars: String(index % 5), passiveIds: passiveSets[index % passiveSets.length].join('|'),
        talentHp: String((index * 13) % 101), talentShot: String((index * 29) % 101), talentDefense: String((index * 41) % 101), lucky: index === 7 ? '1' : '', alpha: '', egg: '',
        place: atBase ? 'base' : 'palbox', placeLabel: atBase ? base.label : `パルボックス ${page} ページ・${1 + (index % 5)} 行 ${1 + (index % 6)} 列`,
        holderUid: atBase ? '' : holder.uid, holder: atBase ? base.label : holder.name, baseId: atBase ? base.id : '', lastOwner: atBase ? holder.name : '', skillIds: '',
        // 入手した時刻（save-extras）。後の個体ほど新しい（最後の個体は共有の 6 分前）
        ownedAt: new Date(now - (6 + (26 - index) * 37) * 60 * 1000).toISOString(),
        // 魂の強化と状態（server の share-extras）。拠点の個体は空腹か病気
        soul: index === 7 ? '10|0|0|1' : '0|0|0|0', condition: atBase && index % 8 === 3 ? '|Starvation|62' : atBase ? 'Cold||88' : '||100',
      };
      return OWNED_FIELDS.map((field) => value[field] ?? '');
    });
    // 牧場の短い鍵（farm-data）: n はタマゴの数、eggs は中身（m: 1 は突然変異）
    const egg = (index) => ({ id: `viewer-${String(index).padStart(3, '0')}`, p: species[index % species.length] });
    // c はケーキ（server の share-extras。[] はケーキ切れ）
    const farms = [
      { id: 'farm-1', baseId: 'base-1', parents: ['viewer-000', 'viewer-001'], n: 3, eggs: [egg(27), { ...egg(28), m: 1 }, egg(29)], c: [{ i: 'Cake02', n: 51 }] },
      { id: 'farm-2', baseId: 'base-1', parents: ['viewer-002'], n: 0, eggs: [], c: [] },
      { id: 'farm-3', baseId: 'base-2', parents: [], n: 0, eggs: [] },
    ];
    // 在庫（server の share-extras。world の中で受けて列 extras に入る）
    const items = [{ id: 'PalGenderReverse', t: 4, p: [{ l: '拠点 1 の箱', n: 3 }, { l: 'Alice の所持品', n: 1 }] }, { id: 'PalPassiveSkillChange_Rare', t: 1 }];
    const checked = validateOwnedUpload({
      worldId: VIEWER_WORLD_ID, world: { name: 'みんなのワールド', hostName: 'Alice', inGameDay: 123, saveKind: 'coop', items },
      saveUpdatedAt: new Date(now - 4 * 60 * 1000).toISOString(), players, bases, farms, columns: OWNED_FIELDS, rows,
    });
    if (!checked.ok) return;
    const input = checked.value;
    const world = {
      worldId: input.worldId, worldName: input.worldName, hostName: input.hostName, saveUpdatedAt: input.saveUpdatedAt,
      uploadedAt: new Date(now - 3 * 60 * 1000).toISOString(), uploadedBy: 'Alice', palCount: input.rows.length, players: input.players, bases: input.bases, farms: input.farms,
      inGameDay: input.inGameDay, saveStamp: '', ...(input.extras ?? {}),
    };
    ownedWorlds.set(input.worldId, { world, rows: input.rows, identity: null });
  }

  // ページを開いている PC の一覧（新しい順。期限切れは除く）
  function presenceList(worldId) {
    const pages = presences.get(worldId);
    if (!pages) return [];
    const at = clock();
    for (const [pageId, item] of pages) if (at - item.at >= OWNED_PRESENCE_TTL_S * 1000) pages.delete(pageId);
    // 新しい順（同じ時刻なら後に記録したページを先に。GAS と同じ）
    return [...pages.values()].reverse().sort((a, b) => b.at - a.at).map((item) => ({ ...item.entry }));
  }
  function recordPresence(worldId, value) {
    const input = cleanPresenceInput(value);
    if (!input) return false;
    const pages = presences.get(worldId) ?? new Map();
    presences.set(worldId, pages);
    const at = clock();
    const { pageId, ...rest } = input;
    pages.delete(pageId);
    pages.set(pageId, { entry: { ...rest, at: new Date(at).toISOString() }, at });
    // 古い順に 50 件を超えた分を外す
    while (pages.size > OWNED_PRESENCE_MAX) pages.delete([...pages.entries()].sort((a, b) => a[1].at - b[1].at)[0][0]);
    return true;
  }

  function owned(request) {
    const serverTime = new Date(clock()).toISOString();
    if (request.action === 'ownedWorlds') return { worlds: [...ownedWorlds.values()].map((entry) => entry.world), serverTime };
    if (request.action === 'ownedUpload') {
      const checked = validateOwnedUpload(request);
      if (!checked.ok) return { ok: false, code: 'VALIDATION', errors: checked.errors };
      const input = checked.value;
      const uploadedBy = String(request.userId ?? '').slice(0, 20);
      const existing = ownedWorlds.get(input.worldId);
      // 結果の種類は GAS と同じ関数で決める（core/owned-shared.js の decideOwnedUpload）
      const decision = decideOwnedUpload(
        existing ? { saveUpdatedAt: existing.world.saveUpdatedAt, uploadedBy: existing.world.uploadedBy, identity: existing.identity } : null,
        { saveUpdatedAt: input.saveUpdatedAt, uploadedBy, identity: input.identity, force: input.force },
      );
      if (!decision.write) {
        return { stored: false, result: decision.result, ...(decision.result === 'stale' ? { reason: 'STALE' } : {}), world: existing.world, cleanup: true, serverTime };
      }
      // 同じミリ秒の送り直しでも、世代（uploadedAt）は前より後にする（GAS の ownedGenerationTime_ と同じ）
      const previous = existing ? Date.parse(existing.world.uploadedAt) : NaN;
      const uploadedAt = Number.isFinite(previous) && Date.parse(serverTime) <= previous ? new Date(previous + 1).toISOString() : serverTime;
      const world = {
        worldId: input.worldId, worldName: input.worldName, hostName: input.hostName, saveUpdatedAt: input.saveUpdatedAt,
        uploadedAt, uploadedBy, palCount: input.rows.length, players: input.players, bases: input.bases,
        farms: input.farms, inGameDay: input.inGameDay, saveStamp: input.identity ? input.identity.stamp : '',
        // 追加の情報（server。GAS の列 extras）は、分かるときだけ world に広げる（validateOwnedUpload でセルに入るよう縮めてある）
        ...(input.extras ?? {}),
      };
      ownedWorlds.set(input.worldId, { world, rows: input.rows, identity: input.identity });
      return { stored: true, result: decision.result, world, cleanup: true, serverTime: uploadedAt };
    }
    const worldId = ownedWorldId(request.worldId);
    if (!worldId) return invalid('worldId', 'INVALID_WORLD');
    if (request.action === 'ownedDelete') {
      const existing = ownedWorlds.get(worldId);
      ownedWorlds.delete(worldId);
      return { deleted: Boolean(existing), removed: existing?.rows.length ?? 0, serverTime };
    }
    if (request.action === 'presence') {
      if (!cleanPresenceInput(request.presence)) return invalid('presence', 'INVALID_PRESENCE');
      const saved = recordPresence(worldId, request.presence);
      return { presence: presenceList(worldId), saved, serverTime };
    }
    const entry = ownedWorlds.get(worldId);
    if (request.action === 'ownedSince') {
      // 形の違う presence は記録しないだけ（本体は断らない。GAS と同じ）
      if (request.presence !== undefined && request.presence !== null) recordPresence(worldId, request.presence);
      const presence = presenceList(worldId);
      const since = typeof request.uploadedAt === 'string' ? request.uploadedAt : '';
      if (entry && since && entry.world.uploadedAt === since) {
        const { world } = entry;
        return {
          changed: false, uploadedAt: world.uploadedAt, uploadedBy: world.uploadedBy, saveUpdatedAt: world.saveUpdatedAt,
          palCount: world.palCount, saveStamp: world.saveStamp, presence, serverTime,
        };
      }
      return { changed: true, world: entry?.world ?? null, columns: OWNED_FIELDS, rows: entry?.rows ?? [], serverTime, presence };
    }
    return { world: entry?.world ?? null, columns: OWNED_FIELDS, rows: entry?.rows ?? [], serverTime };
  }

  // プレイヤーの対応の読み書き（GAS の gas/PlayerMap.js と同じ規則。検査と書き込みの規則は core/owned-shared.js の関数）
  function playerMap(request) {
    const serverTime = new Date(clock()).toISOString();
    if (request.action === 'playerMap') {
      const worldId = ownedWorldId(request.worldId);
      if (!worldId) return invalid('worldId', 'INVALID_WORLD');
      return { worldId, entries: cleanPlayerMapEntries([...(playerMaps.get(worldId)?.values() ?? [])]), serverTime };
    }
    const checked = validatePlayerMapSet(request, {
      checkUserId: validateUserId,
      findUser: (userId) => users.find((user) => userIdKey(user) === userIdKey(userId)) ?? '',
    });
    if (!checked.ok) return { ok: false, code: 'VALIDATION', errors: checked.errors };
    const input = checked.value;
    const current = playerMaps.get(input.worldId) ?? new Map();
    const plan = planPlayerMapSet([...current.values()], input, serverTime);
    if (!plan.ok) return { ok: false, code: 'VALIDATION', errors: plan.errors };
    for (const entry of plan.writes) current.set(entry.key, entry);
    playerMaps.set(input.worldId, current);
    return { worldId: input.worldId, entries: cleanPlayerMapEntries(plan.entries), changed: plan.changed, skipped: plan.skipped, serverTime };
  }

  // 名前の変更。配合の登録者名と所持パルの共有者名、プレイヤーの対応の ID（userId・updatedBy）も新しい名前にそろえる（GAS の actionRename_ と同じ判定）。
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
    for (const entries of playerMaps.values()) {
      for (const entry of entries.values()) {
        // 外した印（userId が ''）は対象にならない
        if (entry.userId && userIdKey(entry.userId) === from) entry.userId = next.value;
        if (entry.updatedBy && userIdKey(entry.updatedBy) === from) entry.updatedBy = next.value;
      }
    }
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
    if (request.action.startsWith('owned') || request.action === 'presence') {
      const result = owned(request);
      return structuredClone(result.ok === false ? result : { ...base, ...result });
    }
    if (request.action === 'playerMap' || request.action === 'playerMapSet') {
      const result = playerMap(request);
      return structuredClone(result.ok === false ? result : { ...base, ...result });
    }
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
