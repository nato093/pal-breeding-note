// 配合牧場からの自動登録。ホストのセーブを読み込むたびに、牧場の親 2 体と産んだタマゴを配合表で照合し、
// 合ったものを登録する。合わないもの・登録できないものは通知だけ出す。
// 配合表は照合にだけ使う（INV-2 の例外）。画面での表示や検索には使わない。
import pals from '../data/pals.js';
import { decodeBreeding, breedChild, isGenderDependent } from './core/breeding.js';
import { findFarmBreedings, mappedUser, resolveRegistrant } from './core/auto-breeding.js';
import { createSpeciesResolver } from './core/owned.js';
import { findConflict } from './core/index.js';
import { userIdKey } from './core/user.js';

// 重複などの失敗は決着として送り直さない。通信やサーバの失敗は、次に新しいセーブを読んだときにもう一度送る。
// 認証切れ（ログアウトされる）は記録せずに止める。ログインし直すと候補の状態を捨てるので、そこで送り直す。
const MUTATION_ERRORS = new Set(['DUPLICATE', 'PAIR_CONFLICT', 'ID_CONFLICT', 'VALIDATION', 'CONFLICT', 'NOT_FOUND']);
const FLIP = { M: 'F', F: 'M' };
const NOTICE_MAX = 50;
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
  const noticeKey = (env, userId) => `${namespace}.autoBreeding.notices.${env}.${userIdKey(userId)}`;
  // 候補（identityKey）ごとの状態。決着したもの・通信で失敗したとき読んでいたセーブ（importedAt）。
  // ログイン・環境・ID・連携しているワールド・役割が変わったら捨てる（戻ったときに、その間に変わった登録で判定し直す）
  let seen = null;
  let generation = 0;
  const done = new Set();
  const failedAt = new Map();

  // 自動登録が動かない間（参加している側・ログアウト中など）の切り替えも見逃さないよう、呼ばれるたびに確かめる
  function observe() {
    const s = store.state;
    const o = owned.state;
    const key = [s.passcode ? s.env : '', s.passcode ? userIdKey(s.userId) : '', o.role, o.linkedWorldId].join('|');
    if (key === seen) return;
    seen = key;
    generation++;
    done.clear();
    failedAt.clear();
  }
  let tablePromise = null;
  let running = false;
  let again = false;
  let active = Promise.resolve();

  const readJson = (key, fallback) => {
    try { return JSON.parse(storage.get(key)) ?? fallback; } catch { return fallback; }
  };
  const enabled = () => readJson(settingsKey, {}).enabled !== false;

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
    if (!enabled() || o.role !== 'host' || !o.uploadReady || o.busy || !local?.snapshot || local.world.id !== o.linkedWorldId) return null;
    if (!s.passcode || !s.userId || !s.env || s.cached) return null;
    return { env: s.env, userId: s.userId, worldId: local.world.id, importedAt: local.importedAt, snapshot: local.snapshot };
  }
  const same = (a, b) => Boolean(b) && a.env === b.env && userIdKey(a.userId) === userIdKey(b.userId)
    && a.worldId === b.worldId && a.importedAt === b.importedAt;

  function readNotices(env, userId) {
    const list = env && userId ? readJson(noticeKey(env, userId), []) : [];
    return Array.isArray(list) ? list : [];
  }

  // 同じ ID の通知は足さない。新しい順に NOTICE_MAX 件まで残す
  function saveNotices(ctx, added, removedIds = new Set()) {
    const before = readNotices(ctx.env, ctx.userId);
    const ids = new Set(before.map((n) => n.id));
    const next = [...before.filter((n) => !removedIds.has(n.id)), ...added.filter((n) => !ids.has(n.id) && ids.add(n.id))]
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, NOTICE_MAX);
    if (next.length === before.length && next.every((n, i) => n.id === before[i].id)) return;
    storage.set(noticeKey(ctx.env, ctx.userId), JSON.stringify(next));
    onNotice();
  }

  const pairText = (a, b) => `${palName(a)}×${palName(b)}`;
  const mismatchNotice = (ctx, m) => ({
    id: `auto-breed:${ctx.env}:mismatch:${m.farmId}:${m.eggLocalId}`, date: ctx.importedAt,
    title: '配合の照合が合いません',
    body: `${pairText(...m.parents)}：表は${m.expected ? palName(m.expected) : '不明'}、タマゴは${palName(m.actual)}`,
  });
  const conflictNotice = (ctx, candidate, existing) => ({
    id: `auto-breed:${ctx.env}:conflict:${candidate.evidence[0].farmId}:${candidate.evidence[0].eggLocalId}`, date: ctx.importedAt,
    title: '登録済みの配合と違います',
    body: `${pairText(candidate.record.parent1Id, candidate.record.parent2Id)}：タマゴは${palName(candidate.record.childId)}、登録は${
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
    // 途中で状態を捨てたら、捨てる前の判定を新しい状態に残さない
    const started = generation;
    const settle = (key) => { if (generation === started) done.add(key); };
    const { candidates, mismatches } = findFarmBreedings(ctx.snapshot, { resolveSpecies, table });
    const players = ctx.snapshot.players ?? [];
    const notices = mismatches.map((m) => mismatchNotice(ctx, m));
    let registered = 0;
    for (const candidate of candidates) {
      if (done.has(candidate.key) || failedAt.get(candidate.key) === ctx.importedAt) continue;
      // 1 件ごとに、始めたときと同じ ID・環境・セーブ・設定のままかを確かめる。
      // ほかの操作の送信待ちがある間は、確定していない登録で判定しないよう、送り終わってから続ける
      if (!same(ctx, current()) || store.state.syncing) break;
      const mapping = mappingOf(ctx.env, ctx.worldId);
      const who = resolveRegistrant(candidate, { players, mapping, users: store.state.users, currentUserId: store.state.userId });
      if (who.unmapped) {
        notices.push(unmappedNotice(ctx, who.unmapped, players));
        continue;
      }
      const record = { id: crypto.randomUUID(), ...candidate.record, registrant: who.userId, memo: '' };
      const conflict = findConflict(store.state.index, record);
      if (conflict?.code === 'DUPLICATE') {
        settle(candidate.key);
        continue;
      }
      const allowDifferentChild = conflict?.code === 'PAIR_CONFLICT' && isOtherGenderResult(table, record, conflict.existing);
      if (conflict?.code === 'PAIR_CONFLICT' && !allowDifferentChild) {
        settle(candidate.key);
        notices.push(conflictNotice(ctx, candidate, conflict.existing));
        continue;
      }
      try {
        await store.mutate('create', allowDifferentChild ? { record, allowDifferentChild } : { record });
        settle(candidate.key);
        registered++;
      } catch (error) {
        if (MUTATION_ERRORS.has(error.code)) settle(candidate.key);
        else if (!store.state.passcode) break;
        else if (generation === started) failedAt.set(candidate.key, ctx.importedAt);
        if (error.code === 'PAIR_CONFLICT') notices.push(conflictNotice(ctx, candidate, findConflict(store.state.index, record)?.existing ?? []));
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
    setEnabled(value) {
      storage.set(settingsKey, JSON.stringify({ enabled: Boolean(value) }));
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
