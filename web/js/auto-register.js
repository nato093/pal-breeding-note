// 配合牧場からの自動登録。ホストのセーブを読み込むたびに、牧場の親 2 体と産んだタマゴを見て、
// 前に読んだときと親が同じ牧場に新しく現れたタマゴを、その親の配合として登録する（子は配合表で決める）。
// 証拠を集めることと、登録してよいと決めることは分ける（sync-fixes の host-rotation）: 読んだセーブの証拠は「配合のキー＋そのセーブの
// 保存時刻（saveStamp）」の候補として保留し、そのセーブの共有の結果（owned.js の state.upload）で、自分のプレイの証拠なら登録してよい、
// 別の PC の担当なら捨てる、と決める（同期で受け取ったセーブを、ゲームをしていない PC のページが登録しないため）。
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
import {
  compareSaves, ownedSaveStamp, ownedWorldId, HOST_UID, hostIsPlayer, formerLabel, playerGuid, playerKeyOf, playerMapKey,
} from './core/owned-shared.js';
import { isPlaying } from './core/playing.js';
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
// 候補の状態（host-rotation）: 保留（共有の結果を待つ）・登録してよい。捨てた候補は記録から外す。前の版の候補（状態がない）は登録してよい
const HOLD = 'hold';
const OK = 'ok';
// 保留のまま決まらない候補を捨てるまで（読んだ日時から）
const HOLD_MAX_MS = 7 * 24 * 60 * 60 * 1000;
// 共有の結果（owned.js の state.upload.status）→ 判定の種類。done は自分の共有が載った（new・newer・resent・自分の前の送信が届いていた
// unchanged・古い GAS の stored）、same は同じセーブを別の人が共有済み（same・他人の unchanged。公開しているのが自分の ID なら mine）、
// stale は別の人が新しいセーブを共有済み。
// sending・error・'' は何も決めない（保留のまま）
const VERDICT_KINDS = { done: 'mine', same: 'same', stale: 'stale' };
// 牧場の記録に残す判定の数（新しい方から）
const VERDICTS_MAX = 20;
// セーブのプレイヤーと登録者の対応（ワールドごと）。プレイヤーは共有と同じ 100 人まで、uid 40 字・ノートの ID 20 字
const MAPPING_MAX = 100;
// プレイヤーの対応（GAS。server の mapping）を読み直す間隔: 自動登録の判定のたび（写しがこれより古ければ読む）
const MAPPING_RUN_AGE = 60 * 1000;
// 前の版の「照合が合いません」は、親を入れ替える前の古いタマゴを誤って知らせていたので出さない
const LEGACY_NOTICE = /^auto-breed:[^:]*:mismatch:/;
const RECORD_FIELDS = ['parent1Id', 'parent1Gender', 'parent2Id', 'parent2Gender', 'childId'];
const isText = (value) => typeof value === 'string';
// セーブの新旧（core/owned-shared.js の compareSaves）。saveStamp は Level.sav の中の保存時刻、savedAt はファイルの更新日時
//（両方に saveStamp があればそれで比べる。前の版の記録にはないので、そのときは savedAt で比べる。sync-fixes の owned-gas）
const saveOf = (value) => ({ stamp: value.saveStamp, updatedAt: value.savedAt });
// 記録の新しさ: 新しいセーブで書いた方、同じセーブなら後から書いた方（rev が大きい方）
const isNewer = (a, b) => {
  const order = compareSaves(saveOf(a), saveOf(b));
  return order > 0 || (order === 0 && (Number(a.rev) || 0) > (Number(b.rev) || 0));
};
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

// 登録待ちの候補を画面から指す ID（候補の key は子を含むので、そのまま返さない。INV-2）。key の FNV-1a（32 ビット）の 16 進
function pendingId(key) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 0x01000193) >>> 0;
  return `p${hash.toString(16).padStart(8, '0')}`;
}
const newestFirst = (a, b) => Date.parse(b.date) - Date.parse(a.date);
// まとめの単位（通知欄の groupNotifications と同じく、ワールドと読み込んだ日時）。batchId がなければ 1 件ずつ
const batchOf = (notice) => `${notice.worldId ?? ''}\n${notice.batchId ?? notice.id}`;

/**
 * 成功の通知（新しい順）を、新しい読み込み REGISTERED_BATCHES 回分・全体 REGISTERED_MAX 件までにする（並びは変えない）。
 * 入り切らない読み込みから先は丸ごと外す（1 回の読み込みを途中で切ると、通知欄の「ほか N 件」が登録した件数より少なくなるため）。
 * いちばん新しい読み込みだけは、REGISTERED_MAX 件を超えても REGISTERED_MAX 件までは残す
 */
// 今の通知（current）を全部残したまま、取り込む通知を新しい順に 1 件ずつ、上限（cap: 新しい順の一覧 → 残す一覧）に入る分だけ足す
function fitNotices(current, incoming, cap) {
  let kept = [...current].sort(newestFirst);
  let added = 0;
  for (const notice of [...incoming].sort(newestFirst)) {
    const next = cap([...kept, notice].sort(newestFirst));
    if (next.length !== kept.length + 1) continue;
    kept = next;
    added++;
  }
  return { kept, added, skipped: incoming.length - added };
}

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
    // 通知欄の行の画像は登録した記録の子（登録済みなので出してよい）
    kind: SUCCESS, worldId: ctx.worldId, batchId: ctx.importedAt, palId: record.childId,
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

/**
 * 1 つの判定（{ kind, stamp: S }）で、保留の候補（stamp が S 以前）を決める。決めるのは S 以前の候補だけ（S より後に読んだ候補は、その判定では
 * 決めない）。mine → 登録してよい。same → stamp が S と同じ候補は捨てる（null。そのセーブは別の PC の担当）、S より前は保留のまま。
 * stale → このページがホスト中（推定）の間に読んだ候補は登録してよい（自分のプレイの証拠）、それ以外は保留のまま（推定が立たなかった
 * だけで、同期で受け取ったとは言い切れないため）。一度登録してよいになった候補は、後の判定で取り消さない。
 * 識別のないセーブの mine（{ kind: 'mine', stamp: '', savedAt }）は、候補の更新日時（savedAt）が送ったセーブの更新日時以前かで決める
 */
function judge(unit, verdict) {
  if (unit.state !== HOLD || !unit.stamp) return unit;
  if (!verdict.stamp && verdict.kind !== 'mine') return unit;
  const order = verdict.stamp ? compareSaves({ stamp: unit.stamp }, { stamp: verdict.stamp })
    : compareSaves({ stamp: unit.stamp, updatedAt: unit.savedAt }, { stamp: '', updatedAt: verdict.savedAt });
  if (order > 0) return unit;
  if (verdict.kind === 'mine') return { ...unit, state: OK };
  if (verdict.kind === 'same') return order === 0 ? null : unit;
  return unit.playing ? { ...unit, state: OK } : unit;
}

/** 牧場ごとの前に見た親とタマゴ・まだ登録を終えていない候補の保存先のキー（ワールド・環境ごと。常駐の古い系統の受け入れも捨てる） */
export const autoRegisterFarmsKey = (namespace, env, worldId) => `${namespace}.autoBreeding.farms.${env}.${worldId}`;

/**
 * playerMaps: プレイヤーの対応の GAS のストア（player-map.js の createPlayerMapStore）。渡さなければ、前の版と同じくこの端末の対応だけを使う
 * paused: 古い系統の守り（常駐の tools/server-agent/lineage-guard.mjs。server の T5）。paused(worldId, stamp) が真なら、そのセーブの候補を
 * 取り込まず、登録も送らない。ページは渡さない（今の動きのまま）
 */
export function createAutoRegister({
  store, owned, storage, namespace = 'pal-note', toast = () => {}, onNotice = () => {}, navigate = () => {},
  loadTable = () => import('../data/breeding.js'), now = Date.now, playerMaps = null, paused = null,
}) {
  const resolveSpecies = createSpeciesResolver(pals);
  const settingsKey = `${namespace}.autoBreeding.settings`;
  // 前の版のプレイヤーの対応（この端末の uid → ID）と、それを GAS へ上げた印（上げた対応の JSON。server の mapping の移行）
  const mappingKey = (env, worldId) => `${namespace}.autoBreeding.players.${env}.${worldId}`;
  const migratedKey = (env, worldId) => `${namespace}.autoBreeding.playersMigrated.${env}.${worldId}`;
  // 牧場ごとの前に見た親とタマゴ・まだ登録を終えていない候補（ワールド・環境ごと。読み込み直しても続きから）
  const farmsKey = (env, worldId) => autoRegisterFarmsKey(namespace, env, worldId);
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

  // 読み込んだ配合表（登録待ちの集計で、親の性別で子が変わる組み合わせを除くのに使う。まだなければ null）
  let loadedTable = null;
  function getTable() {
    tablePromise ??= loadTable().then((module) => {
      loadedTable = decodeBreeding(module.default ?? module);
      return loadedTable;
    }).catch((error) => {
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
    // savedAt: セーブのファイルの更新日時（なければ読み込んだ日時）、saveStamp: Level.sav の中の保存時刻（生のティック。なければ ''）。
    // 別のタブの古いセーブで記録を巻き戻さないために使う
    return {
      env: s.env, userId: s.userId, worldId: local.world.id, importedAt: local.importedAt,
      savedAt: local.world.updatedAt || local.importedAt, saveStamp: ownedSaveStamp(local.snapshot.world?.savedAtTicks), snapshot: local.snapshot,
    };
  }
  const same = (a, b) => Boolean(b) && a.env === b.env && a.userId === b.userId
    && a.worldId === b.worldId && a.importedAt === b.importedAt;
  // 古い系統の守り（常駐の paused）で、そのセーブを止めているか。確かめられなければ止める
  const isPaused = (ctx) => {
    if (!paused) return false;
    try { return Boolean(paused(ctx.worldId, ctx.saveStamp)); } catch { return true; }
  };

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
  // 候補（配合のキー＋セーブの保存時刻ごと）。前の版の候補（stamp・state がない）は、今までどおり登録してよい候補として読む。
  // 保留の候補で、保存時刻か読んだ日時が読めないものは、決められず期限も分からないので捨てる
  function cleanCandidate(value) {
    if (!value || !isText(value.key) || !value.record || !RECORD_FIELDS.every((f) => isText(value.record[f])) || !Array.isArray(value.evidence)) return null;
    const evidence = value.evidence.filter((e) => e && isText(e.farmId) && isText(e.eggLocalId)
      && Array.isArray(e.depositorUids) && e.depositorUids.length === 2 && e.depositorUids.every(isText));
    if (!evidence.length) return null;
    const stamp = ownedSaveStamp(value.stamp);
    const seenAt = isoTime(value.seenAt);
    const state = value.state === HOLD ? HOLD : OK;
    if (state === HOLD && (!stamp || !seenAt)) return null;
    return {
      key: value.key, stamp, savedAt: isText(value.savedAt) ? value.savedAt : '', seenAt, playing: value.playing === true, state,
      record: Object.fromEntries(RECORD_FIELDS.map((f) => [f, value.record[f]])), evidence,
    };
  }
  // 牧場の記録に残した判定（形の違うものは捨てる）。stamp が空なのは、識別のないセーブの mine（送ったセーブの更新日時 savedAt で決める）だけ
  const cleanVerdicts = (value) => list(value, {
    map: (item) => {
      if (!isObject(item) || !Object.values(VERDICT_KINDS).includes(item.kind)) return null;
      const stamp = ownedSaveStamp(item.stamp);
      if (stamp) return { kind: item.kind, stamp };
      const savedAt = isoTime(item.savedAt);
      return item.kind === 'mine' && savedAt ? { kind: 'mine', stamp: '', savedAt } : null;
    },
  }).slice(-VERDICTS_MAX);
  // 同じ判定か（種類・保存時刻・識別のないセーブの mine は更新日時も）
  const sameVerdict = (a, b) => a.kind === b.kind && a.stamp === b.stamp && (a.savedAt ?? '') === (b.savedAt ?? '');
  // 7 日たっても保留のままの候補を外す
  const unexpired = (pending, time = now()) => pending.filter((unit) => unit.state !== HOLD || time - Date.parse(unit.seenAt) <= HOLD_MAX_MS);
  // 判定を古い順に当てる（捨てた候補は外す）
  const judgeAll = (pending, verdicts) => pending.map((unit) => verdicts.reduce((next, verdict) => next && judge(next, verdict), unit)).filter(Boolean);
  // 登録してよい候補を、配合のキーごとに証拠をまとめた形（今の登録の流れ〔resolveRegistrant など〕に渡す { key, record, evidence }）
  function readyCandidates(pending) {
    const byKey = new Map();
    for (const unit of pending) {
      if (unit.state !== OK) continue;
      const group = byKey.get(unit.key);
      if (group) group.evidence = [...group.evidence, ...unit.evidence].slice(-EVIDENCE_MAX);
      else byKey.set(unit.key, { key: unit.key, record: unit.record, evidence: unit.evidence.slice(-EVIDENCE_MAX) });
    }
    return [...byKey.values()];
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
    if (!value || typeof value !== 'object') return { rev: 0, importedAt: '', savedAt: '', saveStamp: '', farms: null, seenEggs: null, verdicts: [], pending: [] };
    return {
      rev: Number.isInteger(value.rev) ? value.rev : 0,
      importedAt: isText(value.importedAt) ? value.importedAt : '',
      savedAt: isText(value.savedAt) ? value.savedAt : '',
      saveStamp: ownedSaveStamp(value.saveStamp),
      farms: cleanFarms(value.farms),
      // 見たことのあるタマゴ（前の版の記録にはない。そのときは、いまのタマゴを記録するだけ）
      seenEggs: Array.isArray(value.seenEggs) && value.seenEggs.every(isText) ? value.seenEggs : null,
      // 共有の結果の判定（host-rotation。前の版の記録にはない）。読み込み直しの後に読んだ候補にも当てる
      verdicts: cleanVerdicts(value.verdicts),
      pending: Array.isArray(value.pending)
        ? value.pending.map(cleanCandidate).filter((c) => c && !finished.get(key)?.has(c.key)) : [],
    };
  }
  // 書くたびに rev を増やす。保存先への書き込みだけ失敗したとき（同じセーブのまま候補を外したなど）も、メモリの新しい方を使う。
  // 別のタブが、この記録を読んでから書くまでの間に判定を足していることがある（保存先はタブの間で共通）ので、書く直前の最新の記録の判定と
  // 和を取り（最新の並びを先に、ないものだけ足す）、書く候補にその判定を当て直してから書く（判定が消えて、捨てた候補が戻る・登録してよい
  // 候補が保留に戻るのを防ぐ。Codex のレビュー）。候補そのものの和は取らない（読み込みどうしの重なりは前からある競合）。書いた記録を返す
  function writeFarms(ctx, value) {
    const key = farmsKey(ctx.env, ctx.worldId);
    const latest = readFarms(ctx);
    const added = (value.verdicts ?? []).filter((verdict) => !latest.verdicts.some((other) => sameVerdict(verdict, other)));
    const verdicts = [...latest.verdicts, ...added].slice(-VERDICTS_MAX);
    const next = { ...value, verdicts, pending: judgeAll(value.pending ?? [], verdicts), rev: latest.rev + 1 };
    memory.set(key, next);
    storage.set(key, JSON.stringify(next));
    return next;
  }

  // 新しく読んだセーブの牧場を前と比べ、新しいタマゴの候補を「まだ登録を終えていない候補」に足す
  function absorb(ctx, table) {
    const saved = readFarms(ctx);
    if (saved.importedAt === ctx.importedAt) return { pending: saved.pending, anomalies: [] };
    // 別のタブが新しいセーブで書いた記録を、このタブの古い（同じ）セーブで書き換えない
    if ((saved.savedAt || saved.saveStamp) && !(compareSaves(saveOf(ctx), saveOf(saved)) > 0)) return { pending: saved.pending, anomalies: [] };
    const previous = saved.farms ? { farms: saved.farms, eggs: saved.seenEggs } : null;
    const { candidates, anomalies, history } = findNewBreedings(ctx.snapshot, { resolveSpecies, table, history: previous });
    const pending = unexpired(saved.pending);
    // 読んだときにこのページがホスト中（推定）だったか（別の人が新しいセーブを共有済み〔stale〕のときに、自分のプレイの証拠とみなすため）
    const playing = isPlaying(owned.state.play, { worldId: ctx.worldId, role: 'host' }, now());
    for (const candidate of candidates) {
      // 同じ配合のキー・同じセーブの証拠はまとめる（違うセーブの証拠は、共有の結果で別々に決めるので分ける）
      const existing = pending.find((c) => c.key === candidate.key && c.stamp === ctx.saveStamp);
      if (existing) {
        existing.evidence = [...existing.evidence, ...candidate.evidence].slice(-EVIDENCE_MAX);
        continue;
      }
      // 識別のないセーブ（保存時刻が読めない）は、共有の結果で決められないので今までどおり登録してよい。ほかは保留にし、残っている判定
      //（読む前に届いた共有の結果）を古い順に当てる
      const unit = {
        key: candidate.key, stamp: ctx.saveStamp, savedAt: ctx.savedAt, seenAt: ctx.importedAt, playing,
        state: ctx.saveStamp ? HOLD : OK, record: candidate.record, evidence: candidate.evidence,
      };
      const [decided] = judgeAll([unit], saved.verdicts);
      if (decided) pending.push(decided);
    }
    const next = {
      importedAt: ctx.importedAt, savedAt: ctx.savedAt, saveStamp: ctx.saveStamp, farms: history.farms, seenEggs: history.eggs,
      verdicts: saved.verdicts, pending: pending.slice(-PENDING_MAX),
    };
    // 書いた記録（別のタブが足した判定を当て直した後）の候補で登録する
    return { pending: writeFarms(ctx, next).pending, anomalies };
  }

  /**
   * 共有の結果（owned.js の state.upload）を判定として、そのワールドの牧場の記録に足し、保留の候補を決め直す（host-rotation）。
   * 応答の通知のときに読み込み中（current() が null）でも取りこぼさないよう、evaluate の最初に同期で行う（owned.js は応答をキャッシュの
   * 保存の前に知らせる）。同じ種類・同じ stamp の判定は足さない。登録はしない（決まった候補は、次に判定できるときに run が登録する）
   */
  let lastVerdict = '';
  function noteVerdict() {
    const s = store.state;
    const upload = owned.state.upload ?? {};
    // 送ったときの環境の結果だけ（環境を切り替えた後に残っている前の環境の結果を、新しい環境の判定にしない。Codex のレビュー）
    if (!s.passcode || !s.env || upload.scope !== s.env) return;
    // 同じセーブを共有済み（same）でも、公開しているのが自分の ID（送ったときの ID）なら、同じ PC の別のタブ（中身の良い方）が載せた自分の
    // 共有（牧場の記録はタブの間で共通なので、捨てると、そのタブの mine で決める候補がなくなる）
    const own = isText(upload.userId) && Boolean(upload.userId) && userIdKey(upload.published?.uploadedBy ?? '') === userIdKey(upload.userId);
    const kind = upload.status === 'same' && own ? 'mine' : VERDICT_KINDS[upload.status];
    const stamp = ownedSaveStamp(upload.stamp);
    const savedAt = isoTime(upload.savedAt);
    const worldId = isText(upload.worldId) ? upload.worldId : '';
    if (!kind || !worldId) return;
    // 識別のないセーブ（stamp が空）は、自分の共有が載ったとき（mine）だけ、送ったセーブの更新日時で判定する（same・stale は同じセーブかを
    // 見分けられないので何もしない。更新日時は同期で書き換わるので、同じセーブの判定には使わない。Codex のレビュー）
    const verdict = stamp ? { kind, stamp } : kind === 'mine' && savedAt ? { kind, stamp: '', savedAt } : null;
    if (!verdict) return;
    const mark = JSON.stringify([s.env, worldId, verdict]);
    if (mark === lastVerdict) return;
    lastVerdict = mark;
    const ctx = { env: s.env, worldId };
    const saved = readFarms(ctx);
    if (saved.verdicts.some((other) => sameVerdict(other, verdict))) return;
    const pending = judgeAll(unexpired(saved.pending), [verdict]);
    writeFarms(ctx, { ...saved, verdicts: [...saved.verdicts, verdict].slice(-VERDICTS_MAX), pending });
    // 登録待ち（登録してよい候補）が変わったかもしれない
    changed();
  }

  // 登録を終えた候補（登録した・重複・決着した失敗）を外す。その配合は登録済みなので、別のセーブの候補（保留の分も）も全部外す
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
  // 通知欄の行の画像はセーブで見た新しいタマゴの種族（m.actual）。押すと配合を探すでその親の組の登録（D-03。id は前と同じ）
  const anomalyNotice = (ctx, m) => ({
    id: `auto-breed:${ctx.env}:anomaly:${m.farmId}:${m.eggLocalId}`, date: ctx.importedAt,
    title: AUTO_NOTICE_TITLES.anomaly, body: anomalyText(pairText(...m.parents), palName(m.actual)), palId: m.actual,
    href: buildHash('search', { p1: m.parents[0], p2: m.parents[1] }),
  });
  // 登録済みと食い違う候補（対応や登録が変わったら、次の判定でやり直す）。候補の子は表の子
  // （突然変異タマゴならタマゴの中身とも違う）なので出さず、登録済みの子だけを出す。押すと配合を探すでその組の登録を出す
  //（前は一覧〔#/list〕。前に保存した通知の #/list は、ルーターが配合を探すに読み替える）
  const conflictNotice = (ctx, candidate, existing) => ({
    id: `auto-breed:${ctx.env}:conflict:${candidate.evidence[0].farmId}:${candidate.evidence[0].eggLocalId}`, date: ctx.importedAt,
    title: AUTO_NOTICE_TITLES.conflict,
    body: conflictText(pairText(candidate.record.parent1Id, candidate.record.parent2Id), [...new Set(existing.map((e) => palName(e.childId)))].join('・')),
    href: buildHash('search', { p1: candidate.record.parent1Id, p2: candidate.record.parent2Id }),
    // 通知欄の行の画像は親1（候補の子は配合表で決めた値なので使わない。INV-2）
    palId: candidate.record.parent1Id,
  });
  const unmappedId = (ctx, uid) => `auto-breed:${ctx.env}:unmapped:${ctx.worldId}:${uid}`;
  // プレイヤーにいない UID（以前の持ち主）は、設定の欄の行と同じ名前（formerLabel。H は「以前のホスト」）
  const playerName = (uid, players) => {
    const player = players.find((p) => p.uid === uid);
    return player ? player.name || 'セーブのプレイヤー' : formerLabel(uid);
  };
  const unmappedNotice = (ctx, uid, players) => ({
    id: unmappedId(ctx, uid), date: ctx.importedAt,
    title: 'プレイヤーの対応が未設定です',
    // 呼び名は設定の欄と同じ「プレイヤーの対応」（roles。C-04）
    body: `${playerName(uid, players)}の配合を登録できません。設定の「プレイヤーの対応」で選んでください。`,
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
    // 古い系統の守り（常駐）: そのセーブの判定が済むまで・止めている間は、候補を取り込まない（牧場の記録も進めないので、解除の後の判定で前の記録と
    // 比べて取り込む）。前に登録してよいと決めた候補も送らない
    if (isPaused(ctx)) return;
    const started = generation;
    const { pending: units, anomalies } = absorb(ctx, table);
    // 登録するのは、登録してよい候補だけ（配合のキーごとに証拠をまとめる）
    const pending = readyCandidates(units);
    // 異常なタマゴは記録したので、次からは「前に見たタマゴ」になる。登録の途中でセーブが変わっても失わないよう、すぐ知らせる
    if (anomalies.length) saveNotices(ctx, anomalies.map((m) => anomalyNotice(ctx, m)));
    // この PC がホストとして遊んでいるか（同期で受け取った仲間のホストのセーブの H は、この PC の人ではない。反証のレビュー）
    const playing = hostPlaying(ctx.worldId);
    // プレイヤーの対応（GAS）を、写しが 60 秒より古ければ読み、前の版の対応を一度だけ上げる（H の対応は、遊んでいるときだけこのスナップショットの
    // H のキャラクターに移す）。牧場の記録は通信を待たずに済ませておく（GAS が遅い・失敗しても記録は止めない。反証のレビュー）
    if (playerMaps) {
      await syncPlayerMap(ctx.env, ctx.worldId, ctx.snapshot.players ?? [], { hostLocal: playing, maxAge: MAPPING_RUN_AGE });
      if (!same(ctx, current())) {
        changed();
        return;
      }
    }
    const players = ctx.snapshot.players ?? [];
    // 判定には GAS に書けたと分かっている対応だけを使う（送っている途中の対応は表示だけ。Codex のレビュー）
    const options = { confirmed: true, playing };
    const notices = [];
    let registered = 0;
    // トーストの「見る」の行き先（1 件ならその組、2 件以上なら更新日の新しい順の配合を探す。成功の通知と同じ）
    let lastRecord = null;
    for (const candidate of pending) {
      if (failedAt.get(candidate.key) === ctx.importedAt) continue;
      // プレイヤーの対応を送っている間は、書けたかが決まるまで待つ（書けなければ、その対応では登録しない。Codex のレビュー）
      if (playerMaps?.saving(ctx.env, ctx.worldId)) await playerMaps.settled(ctx.env, ctx.worldId);
      // 1 件ごとに、始めたときと同じ ID・環境・セーブ・設定のままかを確かめる。
      // ほかの操作の送信待ちがある間は、確定していない登録で判定しないよう、送り終わってから続ける
      if (!same(ctx, current()) || generation !== started || store.state.syncing) break;
      // 対応は、その回のセーブのプレイヤーで鍵から引く（docs/server/README.md の「テーマ間の取り決め」）
      const mapping = mappingFor(ctx.env, ctx.worldId, players, options);
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
      // 送る直前にも確かめる（取り込んだ後に止めた。共有のエラーだけでは、前に登録してよいと決めた候補が送られるため）
      if (isPaused(ctx)) break;
      try {
        await store.mutate('create', allowDifferentChild ? { record, allowDifferentChild } : { record });
        finish(ctx, candidate.key);
        registered++;
        lastRecord = record;
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
    // 対応づけが済んだプレイヤーの「未設定」の通知は消す（プレイヤーにいない UID〔以前のホストなど〕も、対応を決めたら消す）
    const mapping = mappingFor(ctx.env, ctx.worldId, players, options);
    const uids = new Set([...players.map((p) => p.uid), ...Object.keys(mapping)]);
    const resolved = new Set([...uids].filter((uid) => mappedUser(players.find((p) => p.uid === uid) ?? { uid, name: '' }, { mapping, users: store.state.users }))
      .map((uid) => unmappedId(ctx, uid)));
    if (same(ctx, current())) saveNotices(ctx, notices, resolved);
    if (registered) {
      const href = registered === 1 && lastRecord ? buildHash('search', { p1: lastRecord.parent1Id, p2: lastRecord.parent2Id }) : buildHash('search', { sort: 'updated' });
      toast(`配合を自動登録しました（${registered}件）`, { actionLabel: '見る', action: () => navigate(href) });
    }
    // 登録待ちの候補が変わったかもしれない（設定の「登録待ち」の行が読み直す）
    changed();
  }

  // 実行中に呼ばれたら、終わってから 1 回だけやり直す（store の更新は購読者を同期で呼ぶため、送信中にも呼ばれる）
  function evaluate() {
    observe();
    noteVerdict();
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

  // 前の版の対応（この端末の uid → ID）。形の合わない対応（数値・長すぎる ID など）は、その対応だけ無視する
  function legacyMappingOf(env, worldId) {
    const value = readJson(mappingKey(env, worldId), {});
    if (!isObject(value)) return {};
    const entries = Object.entries(value).filter(([uid, userId]) => idText(uid, 40) && idText(userId, 20));
    return Object.fromEntries(entries.slice(0, MAPPING_MAX));
  }
  function writeLegacyMapping(env, worldId, uid, userId) {
    const next = { ...legacyMappingOf(env, worldId) };
    if (userId) next[uid] = userId;
    else delete next[uid];
    storage.set(mappingKey(env, worldId), JSON.stringify(next));
  }
  const sameWorld = (a, b) => Boolean(a) && (a === b || (Boolean(ownedWorldId(a)) && ownedWorldId(a) === ownedWorldId(b)));
  // 表示と設定の欄の対応に使うプレイヤー: 今表示しているデータ（共有でも手元でも）がそのワールドならそのプレイヤー。そうでなければ手元の
  // スナップショット（そのワールドのとき）。協力プレイの古い H が手元に残り、共有では U になっているときに、表示と食い違わないため
  function playersOf(worldId) {
    const o = owned.state;
    if (sameWorld(o.meta?.worldId, worldId) && Array.isArray(o.owned?.players)) return o.owned.players;
    return sameWorld(o.local?.world.id, worldId) ? o.local.snapshot?.players ?? [] : [];
  }
  // GAS の対応で動いているか（古い GAS・まだ読めていなければ前の版の対応）。confirmed は送っている途中の対応を重ねない（判定用）
  const sharedEntries = (env, worldId, { confirmed = false } = {}) => (playerMaps && env && worldId ? playerMaps.entries(env, worldId, { confirmed }) : null);
  // この PC がホストとしてそのワールドを遊んでいるか（手元のセーブの保存が続けて見えている。core/playing.js）。同期で受け取った仲間のホストの
  // セーブ（ゲームをしていない PC でも役割は host）の H は仲間のキャラクターなので、前の版の H の対応（この PC がホストしたときの人）を当てない
  function hostPlaying(worldId) {
    const o = owned.state;
    const id = o.local?.world.id ?? '';
    return o.role === 'host' && sameWorld(id, worldId) && isPlaying(o.play, { worldId: id, role: 'host' }, now());
  }

  // 前の版の対応を GAS へ上げた印（上げた対応の JSON。ファイルの読み込み・ID の変更で前の対応が変われば、もう一度上げる）。
  // 'all'（全部上げた）・'host'（H だけ残した。H はこの PC がホストとして遊んでいるときに上げる）・''（まだ）
  const migratedMemory = new Map();
  const withoutHost = (legacy) => Object.fromEntries(Object.entries(legacy).filter(([uid]) => uid !== HOST_UID));
  function migration(env, worldId, legacy) {
    if (!Object.keys(legacy).length) return 'all';
    const key = migratedKey(env, worldId);
    const marks = [storage.get(key), migratedMemory.get(key)];
    if (marks.includes(JSON.stringify(legacy))) return 'all';
    return Object.hasOwn(legacy, HOST_UID) && marks.includes(JSON.stringify(withoutHost(legacy))) ? 'host' : '';
  }

  /**
   * 鍵から UID への解決（ここだけで行う。docs/server/README.md の「テーマ間の取り決め」）。players はその回のセーブ・表示しているデータの
   * プレイヤー。返す形は今までどおり uid → ノートの ID（core/auto-breeding.js の mappedUser・core/ideal-goals.js の ownPlayerUids が引く）。
   * - GAS の対応: プレイヤーごとに 'i:<InstanceId>'、なければ（H でないときだけ）'u:<uid>'。値 '' は外した印（同じ名前の規則に戻る）。
   *   'u:H' は H がプレイヤーにいないとき（サーバーのワールドの以前のホスト）だけ効く（協力プレイのホストを以前のホストと取り違えない）。
   *   プレイヤーにいない 'u:' の鍵（以前の持ち主）も uid で返す。前の版の対応を上げ終えるまでは、GAS に鍵のないプレイヤー（H を除く）に
   *   前の版の対応を使う（上げ終えるまでの間に「未設定」にならないように）。H は、playing（判定で、この PC がホストとして遊んでいる）の
   *   ときだけ、上げ終えるまで前の版の H を使う（前の版と同じ動き）
   * - 古い GAS・まだ読めていない: 前の版の対応。H の対応は H がプレイヤーにいるワールドだけ（サーバーのワールドの H は以前のホストで、
   *   この PC の人ではない）
   * confirmed: 送っている途中の対応を重ねない（判定用）
   */
  function mappingFor(env, worldId, players, { confirmed = false, playing = false } = {}) {
    const list = (Array.isArray(players) ? players : []).filter((player) => isObject(player) && typeof player.uid === 'string' && player.uid);
    const legacy = env && worldId ? legacyMappingOf(env, worldId) : {};
    const shared = sharedEntries(env, worldId, { confirmed });
    if (!shared) {
      if (!hostIsPlayer(list)) delete legacy[HOST_UID];
      return legacy;
    }
    const state = migration(env, worldId, legacy);
    // 上げ終えるまでの前の版の対応: H 以外はまだ上げていないとき、H は判定で遊んでいて H をまだ上げていないとき
    const fallback = (uid) => {
      if (uid === HOST_UID) return playing && state !== 'all' ? legacy[uid] : undefined;
      return state === '' ? legacy[uid] : undefined;
    };
    const pick = (key) => (key && Object.hasOwn(shared, key) ? shared[key] : undefined);
    const out = {};
    const present = new Set();
    for (const player of list) {
      present.add(player.uid.toLowerCase());
      const instanceId = playerGuid(player.instanceId);
      const host = player.uid === HOST_UID;
      const chosen = pick(instanceId ? `i:${instanceId}` : '') ?? (host ? undefined : pick(playerMapKey(`u:${player.uid}`))) ?? fallback(player.uid);
      if (chosen) out[player.uid] = chosen;
    }
    for (const [key, userId] of Object.entries(shared)) {
      if (userId && key.startsWith('u:') && !present.has(key.slice(2))) out[key.slice(2)] = userId;
    }
    return out;
  }

  // 前の版の対応（uid → ID）を GAS の鍵にする。ノートにない ID は捨てる。H は hostLocal（この PC がホストとして遊んでいる手元のデータ）で、
  // そのデータの H に InstanceId があるときだけ 'i:'（協力プレイの H はその PC がホストしていたときの本人）。上げられない H は hostLeft で
  // 返す（印から外し、ホストとして遊んでいるときに上げる）。H 以外は InstanceId があれば 'i:'、なければ 'u:'（H 以外の UID は人ごとに変わらない）
  function migrationEntries(legacy, players, { hostLocal }) {
    const users = store.state.users ?? [];
    const list = (Array.isArray(players) ? players : []).filter((player) => isObject(player) && typeof player.uid === 'string');
    const entries = [];
    let hostLeft = false;
    for (const [uid, userId] of Object.entries(legacy)) {
      const user = users.find((item) => userIdKey(item) === userIdKey(userId));
      if (!user) continue;
      const player = list.find((item) => item.uid === uid);
      const instanceId = playerGuid(player?.instanceId);
      const key = uid !== HOST_UID ? (player ? playerKeyOf(player) : playerMapKey(`u:${uid}`))
        : hostLocal && instanceId ? `i:${instanceId}` : '';
      if (key) entries.push({ key, userId: user, playerName: text(player?.name, 50) });
      else if (uid === HOST_UID) hostLeft = true;
    }
    return { entries, hostLeft };
  }

  /**
   * GAS の対応の写しを maxAge より古ければ読み（player-map.js の ensure）、前の版の対応がまだ上がっていなければ一度だけ onlyMissing で上げる
   *（GAS にある鍵〔外した印を含む〕は上書きしない）。上げられたら印を書く。H を上げられない（hostLocal でない）ときは、H を除いた印にして
   * H だけ残し、hostLocal のときに H だけを上げる（最初の移行が共有の表示のときでも、後でホストとして遊べば上がる。反証のレビュー）。
   * 古い GAS・読めない・ノートの一覧がまだないときは何もしない（印を書かず、次の機会にやり直す）。失敗しても例外にしない。送れなかったら
   * MAPPING_RUN_AGE の間は送り直さない（先に反映した分を戻した知らせで判定し直し、また送る、を繰り返さないため）
   */
  const migrations = new Map();
  const migrationRetry = new Map();
  async function syncPlayerMap(env, worldId, players, { hostLocal = false, maxAge = 0 } = {}) {
    if (!playerMaps || !env || !worldId) return;
    await playerMaps.ensure(env, worldId, { maxAge });
    if (!sharedEntries(env, worldId)) return;
    const legacy = legacyMappingOf(env, worldId);
    const state = migration(env, worldId, legacy);
    if (state === 'all' || (state === 'host' && !hostLocal) || !store.state.users?.length) return;
    const key = migratedKey(env, worldId);
    if (!migrations.has(key)) {
      if (migrationRetry.get(key) > now()) return;
      const task = (async () => {
        const { entries, hostLeft } = migrationEntries(state === 'host' ? { [HOST_UID]: legacy[HOST_UID] } : legacy, players, { hostLocal });
        if (entries.length) await playerMaps.set(env, worldId, entries, { onlyMissing: true });
        const mark = JSON.stringify(hostLeft ? withoutHost(legacy) : legacy);
        migratedMemory.set(key, mark);
        storage.set(key, mark);
      })().catch(() => { migrationRetry.set(key, now() + MAPPING_RUN_AGE); }).finally(() => migrations.delete(key));
      migrations.set(key, task);
    }
    await migrations.get(key);
  }

  // 設定（オン・オフ・登録者の対応）の変化を知らせる先（ヘッダーのセーブ連携の状態）
  const listeners = new Set();
  const changed = () => listeners.forEach((listener) => listener());
  // GAS の対応が変わった（このタブ・ほかの PC で決めた対応を読み直した）: 知らせて判定し直す（保留していた未設定の候補を次の判定で登録する）
  playerMaps?.subscribe(() => {
    changed();
    evaluate();
  });

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
    /** そのワールドの対応（uid → ノートの ID）。今表示しているデータのプレイヤーで鍵から引く（mappingFor） */
    mapping(worldId = linkedWorld()) {
      const env = store.state.env;
      return env && worldId ? mappingFor(env, worldId, playersOf(worldId)) : {};
    },
    /** 対応がどこにあるか: 'gas'（GAS のシート。誰の画面からでも選べる）・'legacy'（前の版。この端末だけ） */
    mappingMode(worldId = linkedWorld()) {
      return sharedEntries(store.state.env, worldId) ? 'gas' : 'legacy';
    },
    /**
     * GAS の対応を、写しが maxAge より古ければ読み直す（設定の欄は 15 秒、app.js の 10 秒ごとのタイマーは表のタブで 5 分）。前の版の対応が
     * まだ上がっていなければ上げる（H は、この PC がホストとして遊んでいる手元のデータを表示しているときだけ）。失敗しても例外にしない
     */
    refreshMapping(worldId = linkedWorld(), maxAge = 0) {
      const s = store.state;
      if (!playerMaps || !s.passcode || !s.env || !worldId) return Promise.resolve();
      const o = owned.state;
      const hostLocal = sameWorld(o.meta?.worldId, worldId) && o.meta?.source === 'local' && hostPlaying(worldId);
      return syncPlayerMap(s.env, worldId, playersOf(worldId), { hostLocal, maxAge });
    },
    /**
     * 別のタブの storage イベント。今の環境の前の版の対応（と GAS へ上げた印）のキーなら、設定の変化として知らせて true を返す（対応表は
     * キャッシュせず読むたびに保存先から読むので、捨てるものはない）。対応表は自分のプレイヤーの決め方にも使うので、app.js は true のとき
     * 本人の変化として知らせる（self-player.js の changed）。登録し直し（evaluate）は、変えたタブが行う。GAS の対応の写しは player-map.js の reload
     */
    reload(key) {
      const env = store.state.env;
      const prefixes = [`${namespace}.autoBreeding.players.${env}.`, `${namespace}.autoBreeding.playersMigrated.${env}.`];
      if (!env || typeof key !== 'string' || !prefixes.some((prefix) => key.startsWith(prefix))) return false;
      changed();
      return true;
    },
    /**
     * セーブのプレイヤー（またはプレイヤーにいない UID）を、登録者にするアプリのユーザーに対応づける（空にすると同じ名前のユーザーに戻す）。
     * GAS で動いているときは、設定の欄と同じプレイヤー（表示しているデータ）から鍵を作って GAS に書く（先に反映し、失敗したら戻して投げる）。
     * 前の版で動いているときは、この端末に書く
     * @returns {Promise<void>}
     */
    setMapping(playerUid, userId, worldId = linkedWorld()) {
      const env = store.state.env;
      if (!env || !worldId) return Promise.resolve();
      if (!sharedEntries(env, worldId)) {
        writeLegacyMapping(env, worldId, playerUid, userId);
        changed();
        evaluate();
        return Promise.resolve();
      }
      const player = playersOf(worldId).find((item) => item?.uid === playerUid);
      const key = player ? playerKeyOf(player) : playerMapKey(`u:${playerUid}`);
      // 協力プレイのホスト（H がプレイヤー）は InstanceId の鍵でだけ決める（'u:H' は以前のホストの鍵）
      if (!key || (player && key === `u:${HOST_UID}`)) {
        return Promise.reject(Object.assign(new Error('このプレイヤーは今のデータでは見分けられないため、対応を選べません。'), { code: 'PLAYER_KEY' }));
      }
      const user = userId ? (store.state.users ?? []).find((item) => userIdKey(item) === userIdKey(userId)) ?? userId : '';
      return playerMaps.set(env, worldId, [{ key, userId: user, playerName: text(player?.name, 50) }]).then(() => {});
    },
    /** 前の版の対応（この端末のデータの書き出し用。device-data.js の形 v1） */
    legacyMapping(worldId = linkedWorld()) {
      const env = store.state.env;
      return env && worldId ? legacyMappingOf(env, worldId) : {};
    },
    /** 前の版の対応に 1 件足す（この端末のデータの読み込み。GAS で動いていれば、次の syncPlayerMap が onlyMissing で上げる） */
    setLegacyMapping(playerUid, userId, worldId = linkedWorld()) {
      const env = store.state.env;
      if (!env || !worldId) return;
      writeLegacyMapping(env, worldId, playerUid, userId);
      changed();
      evaluate();
    },
    /**
     * 登録されずに残っている候補（設定のワールドの行の「登録待ち」。D-08）。保存した候補を今の判定（登録者の対応・登録済みとの食い違い）で
     * 分ける。**候補の子（配合表で決めた値）は返さない**（INV-2。親と理由だけ）。登録者が決まって食い違いもない候補（次の判定で登録する）・
     * 登録済みと同じ候補・親の性別で子が変わる別の結果は数えない。保留の候補（共有の結果を待っているだけ。host-rotation）も数えない
     * @returns {{ unmapped: { uid: string, name: string, parents: string[] }[], conflict: { id: string, parents: string[] }[] }} id は破棄に渡す（子を含まない）
     */
    pendingSummary(worldId = linkedWorld()) {
      const s = store.state;
      const summary = { unmapped: [], conflict: [] };
      if (!s.passcode || !s.env || !s.userId || !worldId) return summary;
      const pending = readyCandidates(readFarms({ env: s.env, worldId }).pending);
      // 設定の欄と同じプレイヤー・対応で分ける
      const players = playersOf(worldId);
      const mapping = mappingFor(s.env, worldId, players);
      for (const candidate of pending) {
        const parents = [candidate.record.parent1Id, candidate.record.parent2Id];
        const who = resolveRegistrant(candidate, { players, mapping, users: s.users, currentUserId: s.userId });
        if (who.unmapped) {
          const player = players.find((p) => p.uid === who.unmapped);
          summary.unmapped.push({ uid: who.unmapped, name: player ? player.name ?? '' : formerLabel(who.unmapped), parents });
          continue;
        }
        const record = { ...candidate.record, registrant: who.userId };
        const conflict = s.index ? findConflict(s.index, record) : null;
        if (conflict?.code !== 'PAIR_CONFLICT') continue;
        if (loadedTable && isOtherGenderResult(loadedTable, record, conflict.existing)) continue;
        summary.conflict.push({ id: pendingId(candidate.key), parents });
      }
      return summary;
    },
    /**
     * 書き出したファイルの自動登録の通知を足す（settings の「この端末のデータ」の読み込み）。保存した通知と同じ確かめ方で整え
     *（配合表の答えを外し、前の版の行き先を直す）、同じ id は足さない。登録できた配合は別のキー（capRegistered）、ほかは既存のキー
     *（NOTICE_MAX 件）。今の通知は押し出さず、空きに入る分だけ足す。{ added（足した数）, skipped（上限で入らなかった数） }。ログイン前は 0 件
     */
    importNotices(values) {
      const { env, userId, passcode } = store.state;
      if (!passcode || !env || !userId || !Array.isArray(values)) return { added: 0, skipped: 0 };
      const cleaned = values.map(cleanSavedNotice).filter(Boolean).map(safeAutoNotice).map(unmappedHref);
      const beforeRegistered = readRegistered(env, userId);
      const beforeNotices = readNotices(env, userId);
      const ids = new Set([...beforeRegistered, ...beforeNotices].map((n) => n.id));
      const fresh = cleaned.filter((n) => !ids.has(n.id) && ids.add(n.id));
      const registered = fitNotices(beforeRegistered, fresh.filter((n) => REGISTERED.test(n.id)), capRegistered);
      const others = fitNotices(beforeNotices, fresh.filter((n) => !isSuccess(n)), (list) => list.slice(0, NOTICE_MAX));
      if (registered.added) writeNotices(registeredKey(env, userId), registered.kept);
      if (others.added) writeNotices(noticeKey(env, userId), others.kept);
      const added = registered.added + others.added;
      if (added) onNotice();
      return { added, skipped: registered.skipped + others.skipped };
    },
    /**
     * そのワールドの牧場の記録（前に見た親とタマゴ・候補・判定）を捨てる（常駐の古い系統の受け入れ）。次の読み込みは、最初の読み込みと同じく
     * 記録するだけ。実行中の登録は止める
     */
    forgetFarms(worldId, env = store.state.env) {
      if (!env || !worldId) return;
      const key = farmsKey(env, worldId);
      memory.delete(key);
      finished.delete(key);
      storage.remove(key);
      generation++;
      changed();
    },
    /** 登録待ちの候補を 1 件捨てる（設定の「登録待ち」の「破棄」。id は pendingSummary の id。登録を終えた候補と同じく外し、このタブでは送り直さない）。捨てたら true */
    discardPending(id, worldId = linkedWorld()) {
      const s = store.state;
      if (!s.env || !worldId || typeof id !== 'string') return false;
      const ctx = { env: s.env, worldId };
      const candidate = readFarms(ctx).pending.find((c) => pendingId(c.key) === id);
      if (!candidate) return false;
      finish(ctx, candidate.key);
      changed();
      return true;
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
