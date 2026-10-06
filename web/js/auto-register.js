// 配合牧場からの自動登録。ホストのセーブを読み込むたびに、牧場の親 2 体と産んだタマゴを見て、
// 前に読んだときと親が同じ牧場に新しく現れたタマゴを、その親の配合として登録する（子は配合表で決める）。
// 登録できないもの（登録済みと食い違う・登録者が未設定・表と合わない）は通知だけ出す。
// 配合表は照合にだけ使う（INV-2 の例外）。画面での表示や検索には使わない。
import pals from '../data/pals.js';
import { decodeBreeding, breedChild, isGenderDependent } from './core/breeding.js';
import { findNewBreedings, mappedUser, resolveRegistrant } from './core/auto-breeding.js';
import { createSpeciesResolver } from './core/owned.js';
import { findConflict } from './core/index.js';
import { userIdKey } from './core/user.js';

// 重複などの失敗は決着として送り直さない。通信やサーバの失敗は、次に新しいセーブを読んだときにもう一度送る。
// 認証切れ（ログアウトされる）は記録せずに止める。ログインし直したら送り直す。
const MUTATION_ERRORS = new Set(['DUPLICATE', 'PAIR_CONFLICT', 'ID_CONFLICT', 'VALIDATION', 'CONFLICT', 'NOT_FOUND']);
const FLIP = { M: 'F', F: 'M' };
const NOTICE_MAX = 50;
const PENDING_MAX = 200;
const EVIDENCE_MAX = 10;
// 前の版の「照合が合いません」は、親を入れ替える前の古いタマゴを誤って知らせていたので出さない
const LEGACY_NOTICE = /^auto-breed:[^:]*:mismatch:/;
const RECORD_FIELDS = ['parent1Id', 'parent1Gender', 'parent2Id', 'parent2Gender', 'childId'];
const isText = (value) => typeof value === 'string';
const timeOf = (value) => Date.parse(value) || 0;
// 記録の新しさ: 新しいセーブで書いた方、同じセーブなら後から書いた方（rev が大きい方）
const isNewer = (a, b) => timeOf(a.savedAt) > timeOf(b.savedAt)
  || (timeOf(a.savedAt) === timeOf(b.savedAt) && (Number(a.rev) || 0) > (Number(b.rev) || 0));
const palsById = new Map(pals.map((pal) => [pal.id, pal]));
const palName = (id) => palsById.get(id)?.ja ?? id ?? '不明';

// 親の性別で子が変わる組み合わせで、登録済みの別の子がどれも「親の性別を入れ替えたときの子」で、
// 同じ性別の並びの登録でもなければ、別の結果として登録してよい
function isOtherGenderResult(table, record, existing) {
  if (!isGenderDependent(table, record.parent1Id, record.parent2Id)) return false;
  const other = breedChild(table, record.parent1Id, FLIP[record.parent1Gender], record.parent2Id, FLIP[record.parent2Gender]);
  return Boolean(other) && existing.every((e) => e.childId === other
    && !(e.parent1Gender === record.parent1Gender && e.parent2Gender === record.parent2Gender));
}

export function createAutoRegister({
  store, owned, storage, namespace = 'pal-note', toast = () => {}, onNotice = () => {},
  loadTable = () => import('../data/breeding.js'),
}) {
  const resolveSpecies = createSpeciesResolver(pals);
  const settingsKey = `${namespace}.autoBreeding.settings`;
  const mappingKey = (env, worldId) => `${namespace}.autoBreeding.players.${env}.${worldId}`;
  // 牧場ごとの前に見た親とタマゴ・まだ登録を終えていない候補（ワールド・環境ごと。読み込み直しても続きから）
  const farmsKey = (env, worldId) => `${namespace}.autoBreeding.farms.${env}.${worldId}`;
  const noticeKey = (env, userId) => `${namespace}.autoBreeding.notices.${env}.${userIdKey(userId)}`;
  // 通信で失敗した候補と、そのとき読んでいたセーブ（importedAt）。
  // ログイン・環境・ID・連携しているワールド・役割が変わったら捨てる
  let seen = null;
  let generation = 0;
  const failedAt = new Map();

  // 自動登録が動かない間（参加している側・ログアウト中など）の切り替えも見逃さないよう、呼ばれるたびに確かめる
  function observe() {
    const s = store.state;
    const o = owned.state;
    const key = [s.passcode ? s.env : '', s.passcode ? userIdKey(s.userId) : '', o.role, o.linkedWorldId].join('|');
    if (key === seen) return;
    seen = key;
    generation++;
    failedAt.clear();
  }
  let tablePromise = null;
  let running = false;
  let again = false;
  let active = Promise.resolve();

  const readJson = (key, fallback) => {
    try { return JSON.parse(storage.get(key)) ?? fallback; } catch { return fallback; }
  };
  // オン・オフはワールドごと（新しく登録したワールドはオン）。前の版の端末共通の設定は、ワールドごとの設定がないときに使う
  const linkedWorld = () => owned.state.local?.world.id ?? '';
  const settings = () => {
    const value = readJson(settingsKey, {});
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  };
  const enabled = (worldId = linkedWorld()) => {
    const value = settings();
    const own = value.worlds && typeof value.worlds === 'object' ? value.worlds[worldId] : undefined;
    return typeof own === 'boolean' ? own : value.enabled !== false;
  };

  function getTable() {
    tablePromise ??= loadTable().then((module) => decodeBreeding(module.default ?? module)).catch((error) => {
      tablePromise = null;
      throw error;
    });
    return tablePromise;
  }

  // 自動登録してよい状態か。復元しただけのセーブ（uploadReady が false）や、読み込み中・連携の解除中は動かない
  function current() {
    const o = owned.state;
    const s = store.state;
    const local = o.local;
    if (!local || !enabled(local.world.id) || o.role !== 'host' || !o.uploadReady || o.busy || !local?.snapshot || local.world.id !== o.linkedWorldId) return null;
    if (!s.passcode || !s.userId || !s.env || s.cached) return null;
    // savedAt: セーブのファイルの更新日時（なければ読み込んだ日時）。別のタブの古いセーブで記録を巻き戻さないために使う
    return {
      env: s.env, userId: s.userId, worldId: local.world.id, importedAt: local.importedAt,
      savedAt: local.world.updatedAt || local.importedAt, snapshot: local.snapshot,
    };
  }
  const same = (a, b) => Boolean(b) && a.env === b.env && userIdKey(a.userId) === userIdKey(b.userId)
    && a.worldId === b.worldId && a.importedAt === b.importedAt;

  // 保存した記録は別のタブや古い版が書いたものもあるので、形を確かめ、おかしい牧場・候補の分だけ捨てる
  // （捨てた牧場は、初めて読んだものとして記録し直す）
  function cleanFarms(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const farms = {};
    for (const [id, farm] of Object.entries(value)) {
      // タマゴの一部だけ壊れていても、前にあったタマゴを新しいものと取り違えないよう、その牧場の記録ごと捨てる
      if (!farm || !isText(farm.parents) || !Array.isArray(farm.eggs) || !farm.eggs.every(isText)) continue;
      farms[id] = { parents: farm.parents, eggs: farm.eggs };
      // 前に読んだときの親（牧場の外で見つかったタマゴの照合に使う）。形がおかしければ使わない
      const parent = (p) => p && isText(p.palId) && ['M', 'F'].includes(p.gender) && isText(p.depositorUid);
      if (farm.pair && parent(farm.pair.a) && parent(farm.pair.b) && farm.pair.a.gender !== farm.pair.b.gender) {
        farms[id].pair = { a: { ...farm.pair.a }, b: { ...farm.pair.b } };
      }
    }
    return farms;
  }
  function cleanCandidate(value) {
    if (!value || !isText(value.key) || !value.record || !RECORD_FIELDS.every((f) => isText(value.record[f])) || !Array.isArray(value.evidence)) return null;
    const evidence = value.evidence.filter((e) => e && isText(e.farmId) && isText(e.eggLocalId)
      && Array.isArray(e.depositorUids) && e.depositorUids.length === 2 && e.depositorUids.every(isText));
    return evidence.length ? { key: value.key, record: Object.fromEntries(RECORD_FIELDS.map((f) => [f, value.record[f]])), evidence } : null;
  }

  // 保存できない端末（localStorage が使えない・容量不足）でも、ページを開いている間は動くよう、メモリにも持つ。
  // 保存先とメモリでは新しいセーブの方を使う（保存に失敗したときはメモリ、別のタブが書いたときは保存先が新しい）
  const memory = new Map();
  // このタブで登録を終えた候補（保存先が別のタブに書き換えられても、このタブでは送り直さない）
  const finished = new Map();
  function readFarms(ctx) {
    const key = farmsKey(ctx.env, ctx.worldId);
    const stored = readJson(key, null);
    const kept = memory.get(key) ?? null;
    const value = !stored || (kept && isNewer(kept, stored)) ? kept ?? stored : stored;
    if (!value || typeof value !== 'object') return { rev: 0, importedAt: '', savedAt: '', farms: null, seenEggs: null, pending: [] };
    return {
      rev: Number.isInteger(value.rev) ? value.rev : 0,
      importedAt: isText(value.importedAt) ? value.importedAt : '',
      savedAt: isText(value.savedAt) ? value.savedAt : '',
      farms: cleanFarms(value.farms),
      // 見たことのあるタマゴ（前の版の記録にはない。そのときは、いまのタマゴを記録するだけ）
      seenEggs: Array.isArray(value.seenEggs) && value.seenEggs.every(isText) ? value.seenEggs : null,
      pending: Array.isArray(value.pending)
        ? value.pending.map(cleanCandidate).filter((c) => c && !finished.get(key)?.has(c.key)) : [],
    };
  }
  // 書くたびに rev を増やす。保存先への書き込みだけ失敗したとき（同じセーブのまま候補を外したなど）も、メモリの新しい方を使う
  function writeFarms(ctx, value) {
    const key = farmsKey(ctx.env, ctx.worldId);
    const next = { ...value, rev: readFarms(ctx).rev + 1 };
    memory.set(key, next);
    storage.set(key, JSON.stringify(next));
  }

  // 新しく読んだセーブの牧場を前と比べ、新しいタマゴの候補を「まだ登録を終えていない候補」に足す
  function absorb(ctx, table) {
    const saved = readFarms(ctx);
    if (saved.importedAt === ctx.importedAt) return { pending: saved.pending, anomalies: [] };
    // 別のタブが新しいセーブで書いた記録を、このタブの古い（同じ）セーブで書き換えない
    if (saved.savedAt && !(timeOf(ctx.savedAt) > timeOf(saved.savedAt))) return { pending: saved.pending, anomalies: [] };
    const previous = saved.farms ? { farms: saved.farms, eggs: saved.seenEggs } : null;
    const { candidates, anomalies, history } = findNewBreedings(ctx.snapshot, { resolveSpecies, table, history: previous });
    const pending = saved.pending.slice();
    for (const candidate of candidates) {
      const existing = pending.find((c) => c.key === candidate.key);
      if (existing) existing.evidence = [...existing.evidence, ...candidate.evidence].slice(-EVIDENCE_MAX);
      else pending.push(candidate);
    }
    const next = { importedAt: ctx.importedAt, savedAt: ctx.savedAt, farms: history.farms, seenEggs: history.eggs, pending: pending.slice(-PENDING_MAX) };
    writeFarms(ctx, next);
    return { pending: next.pending, anomalies };
  }

  // 登録を終えた候補（登録した・重複・決着した失敗）を外す
  function finish(ctx, key) {
    const storeKey = farmsKey(ctx.env, ctx.worldId);
    if (!finished.has(storeKey)) finished.set(storeKey, new Set());
    finished.get(storeKey).add(key);
    const saved = readFarms(ctx);
    writeFarms(ctx, { ...saved, pending: saved.pending.filter((c) => c.key !== key) });
  }

  function readNotices(env, userId) {
    const list = env && userId ? readJson(noticeKey(env, userId), []) : [];
    return Array.isArray(list) ? list.filter((n) => n && typeof n.id === 'string' && !LEGACY_NOTICE.test(n.id)) : [];
  }

  // 同じ ID の通知は足さない。新しい順に NOTICE_MAX 件まで残す
  function saveNotices(ctx, added, removedIds = new Set()) {
    const stored = readJson(noticeKey(ctx.env, ctx.userId), []);
    const before = readNotices(ctx.env, ctx.userId);
    const ids = new Set(before.map((n) => n.id));
    const next = [...before.filter((n) => !removedIds.has(n.id)), ...added.filter((n) => !ids.has(n.id) && ids.add(n.id))]
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, NOTICE_MAX);
    const unchanged = Array.isArray(stored) && next.length === stored.length && next.every((n, i) => n.id === stored[i]?.id);
    if (unchanged) return;
    storage.set(noticeKey(ctx.env, ctx.userId), JSON.stringify(next));
    onNotice();
  }

  const pairText = (a, b) => `${palName(a)}×${palName(b)}`;
  const anomalyNotice = (ctx, m) => ({
    id: `auto-breed:${ctx.env}:anomaly:${m.farmId}:${m.eggLocalId}`, date: ctx.importedAt,
    title: '配合の結果が表と違います',
    body: `${pairText(...m.parents)}：表は${m.expected ? palName(m.expected) : '不明'}、新しいタマゴは${palName(m.actual)}`,
  });
  const conflictNotice = (ctx, candidate, existing) => ({
    id: `auto-breed:${ctx.env}:conflict:${candidate.evidence[0].farmId}:${candidate.evidence[0].eggLocalId}`, date: ctx.importedAt,
    title: '登録済みの配合と違います',
    body: `${pairText(candidate.record.parent1Id, candidate.record.parent2Id)}：表は${palName(candidate.record.childId)}、登録は${
      [...new Set(existing.map((e) => palName(e.childId)))].join('・')}`,
    href: '#/list',
  });
  const unmappedId = (ctx, uid) => `auto-breed:${ctx.env}:unmapped:${ctx.worldId}:${uid}`;
  const unmappedNotice = (ctx, uid, players) => ({
    id: unmappedId(ctx, uid), date: ctx.importedAt,
    title: 'プレイヤーの対応が未設定です',
    body: `${players.find((p) => p.uid === uid)?.name || 'セーブのプレイヤー'}の配合を登録できません。設定で登録者を選んでください。`,
    href: '#/settings',
  });

  async function run(ctx) {
    const table = await getTable();
    if (!same(ctx, current())) return;
    const started = generation;
    const { pending, anomalies } = absorb(ctx, table);
    // 異常なタマゴは記録したので、次からは「前に見たタマゴ」になる。登録の途中でセーブが変わっても失わないよう、すぐ知らせる
    if (anomalies.length) saveNotices(ctx, anomalies.map((m) => anomalyNotice(ctx, m)));
    const players = ctx.snapshot.players ?? [];
    const notices = [];
    let registered = 0;
    for (const candidate of pending) {
      if (failedAt.get(candidate.key) === ctx.importedAt) continue;
      // 1 件ごとに、始めたときと同じ ID・環境・セーブ・設定のままかを確かめる。
      // ほかの操作の送信待ちがある間は、確定していない登録で判定しないよう、送り終わってから続ける
      if (!same(ctx, current()) || store.state.syncing) break;
      const mapping = mappingOf(ctx.env, ctx.worldId);
      const who = resolveRegistrant(candidate, { players, mapping, users: store.state.users, currentUserId: store.state.userId });
      // 登録者が決まらない・登録済みと食い違う候補は残し、対応づけや登録が変わったら次の判定で登録する
      if (who.unmapped) {
        notices.push(unmappedNotice(ctx, who.unmapped, players));
        continue;
      }
      const record = { id: crypto.randomUUID(), ...candidate.record, registrant: who.userId, memo: '' };
      const conflict = findConflict(store.state.index, record);
      if (conflict?.code === 'DUPLICATE') {
        finish(ctx, candidate.key);
        continue;
      }
      const allowDifferentChild = conflict?.code === 'PAIR_CONFLICT' && isOtherGenderResult(table, record, conflict.existing);
      if (conflict?.code === 'PAIR_CONFLICT' && !allowDifferentChild) {
        notices.push(conflictNotice(ctx, candidate, conflict.existing));
        continue;
      }
      try {
        await store.mutate('create', allowDifferentChild ? { record, allowDifferentChild } : { record });
        finish(ctx, candidate.key);
        registered++;
        // 別の結果として送ると、サーバは食い違いを調べない。送るまでの間に、性別の並びまで同じ食い違う登録が
        // 増えていないかを、応答の全件で確かめ直す
        if (allowDifferentChild) {
          const after = findConflict(store.state.index, record);
          if (after?.code === 'PAIR_CONFLICT' && !isOtherGenderResult(table, record, after.existing)) {
            notices.push(conflictNotice(ctx, candidate, after.existing));
          }
        }
      } catch (error) {
        // 手元にない登録との食い違いもあるため、サーバが返した食い違う登録で知らせる
        const existing = Array.isArray(error.response?.existing) ? error.response.existing : findConflict(store.state.index, record)?.existing ?? [];
        if (error.code === 'PAIR_CONFLICT') {
          notices.push(conflictNotice(ctx, candidate, existing));
          // 手元の一覧にない登録との食い違いは、手元では判定できず送り直してしまう。新しいセーブを読むまで送らず、
          // その間に一覧を取り直して、次からは手元で食い違いと分かるようにする
          if (generation === started) failedAt.set(candidate.key, ctx.importedAt);
          store.refresh?.()?.catch?.(() => {});
        } else if (MUTATION_ERRORS.has(error.code)) finish(ctx, candidate.key);
        else if (!store.state.passcode) break;
        else if (generation === started) failedAt.set(candidate.key, ctx.importedAt);
      }
    }
    // 対応づけが済んだプレイヤーの「未設定」の通知は消す
    const mapping = mappingOf(ctx.env, ctx.worldId);
    const resolved = new Set(players.filter((p) => mappedUser(p, { mapping, users: store.state.users })).map((p) => unmappedId(ctx, p.uid)));
    if (same(ctx, current())) saveNotices(ctx, notices, resolved);
    if (registered) toast(`配合を自動登録しました（${registered}件）`);
  }

  // 実行中に呼ばれたら、終わってから 1 回だけやり直す（store の更新は購読者を同期で呼ぶため、送信中にも呼ばれる）
  function evaluate() {
    observe();
    if (running) {
      again = true;
      return;
    }
    const ctx = current();
    if (!ctx) return;
    running = true;
    active = run(ctx).catch(() => {}).finally(() => {
      running = false;
      if (again) {
        again = false;
        evaluate();
      }
    });
  }

  function mappingOf(env, worldId) {
    const value = readJson(mappingKey(env, worldId), {});
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  return {
    evaluate,
    // 実行中の照合・登録（やり直しを含む）が終わるまで待つ
    async idle() {
      let waiting;
      do {
        waiting = active;
        await waiting;
      } while (waiting !== active);
    },
    enabled,
    setEnabled(on, worldId = linkedWorld()) {
      if (!worldId) return;
      const value = settings();
      storage.set(settingsKey, JSON.stringify({ ...value, worlds: { ...(value.worlds ?? {}), [worldId]: Boolean(on) } }));
      evaluate();
    },
    mapping(worldId = owned.state.local?.world.id ?? '') {
      const env = store.state.env;
      return env && worldId ? mappingOf(env, worldId) : {};
    },
    // セーブのプレイヤーを、登録者にするアプリのユーザーに対応づける（空にすると同じ名前のユーザーに戻す）
    setMapping(playerUid, userId, worldId = owned.state.local?.world.id ?? '') {
      const env = store.state.env;
      if (!env || !worldId) return;
      const next = { ...mappingOf(env, worldId) };
      if (userId) next[playerUid] = userId;
      else delete next[playerUid];
      storage.set(mappingKey(env, worldId), JSON.stringify(next));
      evaluate();
    },
    /** 通知欄の元（createNotificationStore の sources に渡す） */
    notices() {
      const { env, userId, passcode } = store.state;
      return passcode ? readNotices(env, userId) : [];
    },
  };
}
