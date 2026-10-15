// 配合牧場からの自動登録。ホストのセーブを読み込むたびに、牧場の親 2 体と産んだタマゴを見て、
// 前に読んだときと親が同じ牧場に新しく現れたタマゴを、その親の配合として登録する（子は配合表で決める）。
// 登録できないもの（登録済みと食い違う・登録者が未設定・表と合わない）は通知だけ出す。登録できた配合も、ベルの通知に残す。
// 配合表を使うのは照合だけ（INV-2 の例外）。画面での表示や検索には使わず、通知にも配合表の答え（表の子）を出さない
// （登録できた配合の通知は、登録したレコード〔登録済みの記録〕だけで作る）。
import pals from '../data/pals.js';
import { decodeBreeding, breedChild, isGenderDependent } from './core/breeding.js';
import { findNewBreedings, mappedUser, resolveRegistrant } from './core/auto-breeding.js';
import { createSpeciesResolver } from './core/owned.js';
import { findConflict } from './core/index.js';
import { userIdKey } from './core/user.js';
import { isObject, isoTime, text, idText, list, screenHref } from './core/boundary.js';
import { buildHash, settingsHash } from './router.js';
import { notificationTags } from './notifications.js';

// 重複などの失敗は決着として送り直さない。通信やサーバの失敗は、次に新しいセーブを読んだときにもう一度送る。
// 認証切れ（ログアウトされる）は記録せずに止める。ログインし直したら送り直す。
const MUTATION_ERRORS = new Set(['DUPLICATE', 'PAIR_CONFLICT', 'ID_CONFLICT', 'VALIDATION', 'CONFLICT', 'NOT_FOUND']);
const FLIP = { M: 'F', F: 'M' };
// 未設定・見送り・保留の通知（既存のキー autoBreeding.notices）は新しい 50 件まで残す（前の版と同じ）
const NOTICE_MAX = 50;
const PENDING_MAX = 200;
// 登録できた配合（成功）の通知は別のキー（autoBreeding.registered）に持つ。既存のキーは旧版のまま開いているタブも読み、日時順に 50 件で
// 切って kind・worldId・batchId を捨てて書き戻すので、成功を同じキーに入れると、成功の分だけ古い未設定・見送りが押し出され、まとめも消える。
// 成功は新しい読み込み（batchId）20 回分を残す。1 回の読み込みの分は全部残し（通知欄の「ほか N 件」をトーストの件数と合わせる。
// 1 回の読み込みで登録できるのは、まだ登録を終えていない候補の上限 PENDING_MAX 件まで）、全体でも REGISTERED_MAX 件まで
// （入り切らない読み込みから先は丸ごと外す）
const REGISTERED_BATCHES = 20;
const REGISTERED_MAX = PENDING_MAX;
const SUCCESS = 'auto-registered';
// 成功の通知の id（auto-breed:<環境>:registered:<レコードの ID>）。既存のキーに残っている成功の形の通知（未配信の版が書いたもの）は読まない
const REGISTERED = /^auto-breed:[^:]*:registered:/;
const EVIDENCE_MAX = 10;
// セーブのプレイヤーと登録者の対応（ワールドごと）。プレイヤーは共有と同じ 100 人まで、uid 40 字・ノートの ID 20 字
const MAPPING_MAX = 100;
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

// 配合表の答えは通知に出さない（INV-2。配合表を使うのは照合だけ。data/SOURCES.md）。
// 出すのは、親・観測したタマゴの中身・登録済みの記録だけ
export const AUTO_NOTICE_TITLES = Object.freeze({ anomaly: '自動登録しなかったタマゴ', conflict: '自動登録を保留した配合' });
export const anomalyText = (pair, eggName) => `${pair} のタマゴ（${eggName}）は照合が合わず、自動登録しませんでした`;
export const conflictText = (pair, registered) => `${pair}：登録済みの配合（子 ${registered}）と食い違うため、保留しました`;
// 前の版の本文の形（親・配合表の子・新しいタマゴの中身か登録済みの子を並べたもの）
const OLD_ANOMALY = /^(.+?)：表は.*?、新しいタマゴは(.+)$/;
const OLD_CONFLICT = /^(.+?)：表は.*?、登録は(.+)$/;
// 「プレイヤーの対応が未設定です」の id（auto-breed:<環境>:unmapped:<ワールド ID>:<プレイヤーの UID>）
const UNMAPPED_NOTICE = /^auto-breed:[^:]*:unmapped:([^:]+):/;

// 保存した通知の形を確かめる（id 200 字・日時が読めること・題名 40 字・本文 200 字・href は画面内のハッシュ 300 字まで。
// 種類・ワールド・まとめの単位は notifications.js の notificationTags で正しい値だけ）。
// 通知欄に出すときは notifications.js の cleanNotification がさらに 20 字・60 字に切る
function cleanSavedNotice(value) {
  if (!isObject(value) || !idText(value.id, 200) || LEGACY_NOTICE.test(value.id)) return null;
  const date = isoTime(value.date);
  if (!date) return null;
  const notice = { id: value.id, date, title: text(value.title, 40), body: text(value.body, 200) };
  const href = screenHref(value.href);
  if (href) notice.href = href;
  return Object.assign(notice, notificationTags(value));
}

const isSuccess = (notice) => notice.kind === SUCCESS || REGISTERED.test(notice.id);
const newestFirst = (a, b) => Date.parse(b.date) - Date.parse(a.date);
// まとめの単位（通知欄の groupNotifications と同じく、ワールドと読み込んだ日時）。batchId がなければ 1 件ずつ
const batchOf = (notice) => `${notice.worldId ?? ''}\n${notice.batchId ?? notice.id}`;

/**
 * 成功の通知（新しい順）を、新しい読み込み REGISTERED_BATCHES 回分・全体 REGISTERED_MAX 件までにする（並びは変えない）。
 * 入り切らない読み込みから先は丸ごと外す（1 回の読み込みを途中で切ると、通知欄の「ほか N 件」が登録した件数より少なくなるため）。
 * いちばん新しい読み込みだけは、REGISTERED_MAX 件を超えても REGISTERED_MAX 件までは残す
 */
function capRegistered(notices) {
  const counts = new Map();
  for (const notice of notices) counts.set(batchOf(notice), (counts.get(batchOf(notice)) ?? 0) + 1);
  const left = new Map();
  let total = 0;
  for (const [batch, count] of counts) {
    if (left.size >= REGISTERED_BATCHES || (left.size && total + count > REGISTERED_MAX)) break;
    const kept = Math.min(count, REGISTERED_MAX - total);
    left.set(batch, kept);
    total += kept;
  }
  return notices.filter((notice) => {
    const rest = left.get(batchOf(notice)) ?? 0;
    left.set(batchOf(notice), rest - 1);
    return rest > 0;
  });
}

const genderMark = (gender) => (gender === 'M' ? '♂' : gender === 'F' ? '♀' : '');
/**
 * 登録できた配合の通知（成功）。id はレコードごと（同じ読み込みで後から登録した分も、同じ id で捨てられない）。
 * まとめは通知欄の表示だけで行う（notifications.js の groupNotifications。同じワールド・同じ batchId〔読み込んだ日時〕を 1 行に）。
 * 本文は登録したレコードの親・性別・子と牧場の拠点だけ（配合表で求めた子を「表は」「予想は」として出さない。INV-2）
 */
function registeredNotice(ctx, record, farmLabel) {
  const parentText = (id, gender) => `${palName(id)}${genderMark(gender)}`;
  return {
    id: `auto-breed:${ctx.env}:registered:${record.id}`, date: ctx.importedAt,
    kind: SUCCESS, worldId: ctx.worldId, batchId: ctx.importedAt,
    title: '配合を自動登録しました',
    body: `${parentText(record.parent1Id, record.parent1Gender)}＋${parentText(record.parent2Id, record.parent2Gender)} → ${palName(record.childId)}（${farmLabel}）`,
    href: buildHash('search', { p1: record.parent1Id, p2: record.parent2Id }),
  };
}

/**
 * 前の版が保存した「プレイヤーの対応が未設定です」の行き先（設定タブの先頭 '#/settings'。未配信の版の `open=auto` も）を、そのワールドの行を
 * 開いて未設定の登録者にフォーカスする URL（router.js の settingsHash の 'registrant'）にする。id は変えない（既読の記録が効く）。
 * 保存し直さず、読み出すたびに直す
 */
export function unmappedHref(notice) {
  const worldId = UNMAPPED_NOTICE.exec(notice.id)?.[1];
  const old = worldId && (notice.href === '#/settings' || notice.href === settingsHash(worldId, 'auto'));
  return old ? { ...notice, href: settingsHash(worldId, 'registrant') } : notice;
}

/**
 * 保存済みの通知を、配合表の答えを含まない文にする（前の版が保存した通知と、旧コードのまま開いているタブが書いた通知のため）。
 * 自動登録の見送り（anomaly）・保留（conflict）の通知だけを直し、id はそのまま（既読の記録が効く）。
 * 形の分からない古い本文に配合表の子の言い回しがあれば、本文を出さずに題名だけにする
 */
export function safeAutoNotice(notice) {
  const kind = /^auto-breed:[^:]*:(anomaly|conflict):/.exec(notice.id)?.[1];
  if (!kind) return notice;
  const body = String(notice.body ?? '');
  const old = (kind === 'anomaly' ? OLD_ANOMALY : OLD_CONFLICT).exec(body);
  const next = old ? (kind === 'anomaly' ? anomalyText(old[1], old[2]) : conflictText(old[1], old[2]))
    : body.includes('表は') ? '' : body;
  return { ...notice, title: AUTO_NOTICE_TITLES[kind], body: next };
}

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
  // 登録できた配合の通知（旧版のタブが知らないキー。名前の変更では user-rename.js が既存のキーと同じく移す）
  const registeredKey = (env, userId) => `${namespace}.autoBreeding.registered.${env}.${userIdKey(userId)}`;
  // 通信で失敗した候補と、そのとき読んでいたセーブ（importedAt）。
  // ログイン・環境・ID・連携しているワールド・役割が変わったら捨てる
  let seen = null;
  let generation = 0;
  const failedAt = new Map();

  // 自動登録が動かない間（参加している側・ログアウト中など）の切り替えも見逃さないよう、呼ばれるたびに確かめる
  function observe() {
    const s = store.state;
    const o = owned.state;
    // 大小・全半角だけ名前を変えたときも、実行中の判定を捨てて新しい表記でやり直すよう、ID はそのまま比べる
    const key = [s.passcode ? s.env : '', s.passcode ? s.userId : '', o.role, o.linkedWorldId].join('|');
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
    if (!s.passcode || !s.userId || !s.env || s.cached || s.renaming) return null;
    // savedAt: セーブのファイルの更新日時（なければ読み込んだ日時）。別のタブの古いセーブで記録を巻き戻さないために使う
    return {
      env: s.env, userId: s.userId, worldId: local.world.id, importedAt: local.importedAt,
      savedAt: local.world.updatedAt || local.importedAt, snapshot: local.snapshot,
    };
  }
  const same = (a, b) => Boolean(b) && a.env === b.env && a.userId === b.userId
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

  // 未設定・見送り・保留の通知（既存のキー）。成功の形の通知は読まない（成功は registeredKey にだけ持つ）
  function readNotices(env, userId) {
    const saved = env && userId ? readJson(noticeKey(env, userId), []) : [];
    const map = (value) => {
      const notice = cleanSavedNotice(value);
      return notice && !isSuccess(notice) ? notice : null;
    };
    // 保存し直しはせず、読み出すたびに直す（次に保存するときは、直した文で書き直す）。形を確かめてから、配合表の答えを外し、
    // 前の版の「未設定」の行き先を直す
    return list(saved, { max: NOTICE_MAX, map }).map(safeAutoNotice).map(unmappedHref);
  }
  // 登録できた配合の通知（新しい順。capRegistered の数まで）
  function readRegistered(env, userId) {
    const saved = env && userId ? readJson(registeredKey(env, userId), []) : [];
    const map = (value) => {
      const notice = cleanSavedNotice(value);
      return notice && REGISTERED.test(notice.id) ? notice : null;
    };
    // 1 件多く読む（REGISTERED_MAX 件目をまたぐ読み込みを、入り切らないと分かるように）
    return capRegistered(list(saved, { max: REGISTERED_MAX + 1, map }).sort(newestFirst));
  }
  // 並び（id）が保存先と同じなら書かない
  function writeNotices(key, next) {
    const stored = readJson(key, []);
    const unchanged = Array.isArray(stored) && next.length === stored.length && next.every((n, i) => n.id === stored[i]?.id);
    if (unchanged) return;
    storage.set(key, JSON.stringify(next));
    onNotice();
  }

  // 未設定・見送り・保留の通知。同じ ID の通知は足さない。新しい順に NOTICE_MAX 件まで残す
  function saveNotices(ctx, added, removedIds = new Set()) {
    const before = readNotices(ctx.env, ctx.userId);
    const ids = new Set(before.map((n) => n.id));
    const next = [...before.filter((n) => !removedIds.has(n.id)), ...added.filter((n) => !ids.has(n.id) && ids.add(n.id))]
      .sort(newestFirst).slice(0, NOTICE_MAX);
    writeNotices(noticeKey(ctx.env, ctx.userId), next);
  }
  // 登録できた配合の通知を 1 件足す（同じ ID なら足さない）
  function saveRegistered(ctx, notice) {
    const before = readRegistered(ctx.env, ctx.userId);
    if (before.some((n) => n.id === notice.id)) return;
    writeNotices(registeredKey(ctx.env, ctx.userId), capRegistered([...before, notice].sort(newestFirst)));
  }

  // 親の組の記号は用語表の「＋」（copy-dead-ends。前は「×」。前の版が保存した本文は「×」のまま読み替える＝OLD_ANOMALY・OLD_CONFLICT）
  const pairText = (a, b) => `${palName(a)}＋${palName(b)}`;
  // 表と合わない新しいタマゴ（見たタマゴとして記録し、二度と判定しない）。表の子（m.expected）は出さない
  const anomalyNotice = (ctx, m) => ({
    id: `auto-breed:${ctx.env}:anomaly:${m.farmId}:${m.eggLocalId}`, date: ctx.importedAt,
    title: AUTO_NOTICE_TITLES.anomaly, body: anomalyText(pairText(...m.parents), palName(m.actual)),
  });
  // 登録済みと食い違う候補（対応や登録が変わったら、次の判定でやり直す）。候補の子は表の子
  // （突然変異タマゴならタマゴの中身とも違う）なので出さず、登録済みの子だけを出す
  const conflictNotice = (ctx, candidate, existing) => ({
    id: `auto-breed:${ctx.env}:conflict:${candidate.evidence[0].farmId}:${candidate.evidence[0].eggLocalId}`, date: ctx.importedAt,
    title: AUTO_NOTICE_TITLES.conflict,
    body: conflictText(pairText(candidate.record.parent1Id, candidate.record.parent2Id), [...new Set(existing.map((e) => palName(e.childId)))].join('・')),
    href: '#/list',
  });
  const unmappedId = (ctx, uid) => `auto-breed:${ctx.env}:unmapped:${ctx.worldId}:${uid}`;
  const unmappedNotice = (ctx, uid, players) => ({
    id: unmappedId(ctx, uid), date: ctx.importedAt,
    title: 'プレイヤーの対応が未設定です',
    body: `${players.find((p) => p.uid === uid)?.name || 'セーブのプレイヤー'}の配合を登録できません。設定で登録者を選んでください。`,
    // 押すと設定のそのワールドの行を開き、未設定の登録者の選択にフォーカスする
    href: settingsHash(ctx.worldId, 'registrant'),
  });
  // 登録した配合の牧場がある拠点の名前（例「拠点 1」）。表示中の所持パルが同じワールドのときだけ引き、分からなければ「配合牧場」
  const farmLabel = (ctx, candidate) => {
    const farmId = candidate.evidence[0]?.farmId;
    const baseId = (ctx.snapshot.breedFarms ?? []).find((farm) => farm?.id === farmId)?.baseId;
    const base = baseId && owned.state.meta?.worldId === ctx.worldId ? owned.state.owned?.bases?.find((b) => b.id === baseId) : null;
    return base?.label || '配合牧場';
  };

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
      if (!same(ctx, current()) || generation !== started || store.state.syncing) break;
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
        // 確定した登録は、この後で止まっても（セーブ・ログイン・設定が変わった）失わないよう、すぐに始めたときの保存先へ残す
        saveRegistered(ctx, registeredNotice(ctx, record, farmLabel(ctx, candidate)));
        // 別の結果として送ると、サーバは食い違いを調べない。送るまでの間に、性別の並びまで同じ食い違う登録が
        // 増えていないかを、応答の全件で確かめ直す
        if (allowDifferentChild) {
          const after = findConflict(store.state.index, record);
          if (after?.code === 'PAIR_CONFLICT' && !isOtherGenderResult(table, record, after.existing)) {
            notices.push(conflictNotice(ctx, candidate, after.existing));
          }
        }
      } catch (error) {
        // 手元にない登録との食い違いもあるため、サーバが返した食い違う登録で知らせる（object の要素だけ。null などで止まらないように）
        const existing = Array.isArray(error.response?.existing) ? list(error.response.existing, { map: (item) => (isObject(item) ? item : null) })
          : findConflict(store.state.index, record)?.existing ?? [];
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

  // 形の合わない対応（数値・長すぎる ID など）は、その対応だけ無視する
  function mappingOf(env, worldId) {
    const value = readJson(mappingKey(env, worldId), {});
    if (!isObject(value)) return {};
    const entries = Object.entries(value).filter(([uid, userId]) => idText(uid, 40) && idText(userId, 20));
    return Object.fromEntries(entries.slice(0, MAPPING_MAX));
  }

  // 設定（オン・オフ・登録者の対応）の変化を知らせる先（ヘッダーのセーブ連携の状態）
  const listeners = new Set();
  const changed = () => listeners.forEach((listener) => listener());

  return {
    evaluate,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
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
      changed();
      evaluate();
    },
    mapping(worldId = owned.state.local?.world.id ?? '') {
      const env = store.state.env;
      return env && worldId ? mappingOf(env, worldId) : {};
    },
    /**
     * 別のタブの storage イベント。今の環境の登録者の対応表のキーなら、設定の変化として知らせて true を返す（対応表はキャッシュせず
     * 読むたびに保存先から読むので、捨てるものはない）。対応表は自分のプレイヤーの決め方にも使うので、app.js は true のとき
     * 本人の変化として知らせる（self-player.js の changed）。登録し直し（evaluate）は、変えたタブが行う
     */
    reload(key) {
      const env = store.state.env;
      if (!env || typeof key !== 'string' || !key.startsWith(`${namespace}.autoBreeding.players.${env}.`)) return false;
      changed();
      return true;
    },
    // セーブのプレイヤーを、登録者にするアプリのユーザーに対応づける（空にすると同じ名前のユーザーに戻す）
    setMapping(playerUid, userId, worldId = owned.state.local?.world.id ?? '') {
      const env = store.state.env;
      if (!env || !worldId) return;
      const next = { ...mappingOf(env, worldId) };
      if (userId) next[playerUid] = userId;
      else delete next[playerUid];
      storage.set(mappingKey(env, worldId), JSON.stringify(next));
      changed();
      evaluate();
    },
    /**
     * 通知欄の元（createNotificationStore の sources に渡す）。未設定・見送り・保留の通知と、登録できた配合の通知（別のキー）を
     * 合わせて新しい順に返す（同じ日時なら、対応の要る未設定・見送り・保留が先）
     */
    notices() {
      const { env, userId, passcode } = store.state;
      return passcode ? [...readNotices(env, userId), ...readRegistered(env, userId)].sort(newestFirst) : [];
    },
  };
}
