// この端末にだけあるデータ（下書き・目標と観測・通知の既読・自動登録の通知・登録者の対応）の書き出しの組み立てと、読み込みの検証・併合
//（settings。F081）。DOM・保存先は持たない（書き込みは各ストアの関数が行う。キャッシュと別のタブの決まりを守るため）。
// 含めないもの: パスワード・記録のキャッシュ・所持パル（セーブから読み直せる）・自動登録の牧場の記録（端末をまたぐと照合を取り違える）・
// 理想個体の計画の記憶・画面の状態。読み込むファイルは信用しない（大きさ・形・版・環境を確かめ、各項目を今の検証で整える）
import pals from '../data/pals.js';
import { cleanGoal, goalKey, GOAL_LIMIT } from './core/ideal-goals.js';
import { cleanObservations, mergeObservation } from './core/goal-observations.js';
import { idText, worldId as cleanWorldId, isObject } from './core/boundary.js';
import { userIdKey, validateUserId } from './core/user.js';

export const DEVICE_FORMAT = 'pal-breeding-note/device-data';
export const DEVICE_VERSION = 1;
// 読み込むファイルの大きさの上限（バイト）
export const DEVICE_MAX_BYTES = 1024 * 1024;
// 項目ごとの数の上限（極端に大きいファイルで画面が止まらないように）
const DRAFTS_MAX = 500;
const READ_MAX = 5000;
const NOTICES_MAX = 300;
const WORLDS_MAX = 50;
const MAPPING_MAX = 100;
const ID_MAX = 200;
const ENV_LABELS = { test: 'テスト', prod: '本番' };
const palIds = new Set(pals.map((pal) => pal.id));

const list = (value, max) => (Array.isArray(value) ? value.slice(0, max) : []);
const envLabel = (env) => ENV_LABELS[env] ?? '不明な環境';

/** 書き出しのファイル名（pal-note-device-<環境>-<日付>.json） */
export function deviceFileName(env, now = new Date()) {
  const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('');
  return `pal-note-device-${env || 'unknown'}-${date}.json`;
}

/**
 * 書き出す値を組み立てる（各ストアの今の値を受け取る）。drafts はストアの下書き（親の性別つき）で、保存の形（性別なし）と
 * 性別の対応（draftGenders）に分けて書く。mappings は { worldId: { playerUid: userId } }（空のワールドは書かない）
 */
export function buildDeviceData({ env, userId, drafts = [], goals = [], observations = null, read = [], notices = [], mappings = {}, now = Date.now }) {
  const draftGenders = {};
  for (const draft of drafts) {
    if (draft.parent1Gender || draft.parent2Gender) {
      draftGenders[draft.id] = { parent1Gender: draft.parent1Gender ?? '', parent2Gender: draft.parent2Gender ?? '', parent1Id: draft.parent1Id, parent2Id: draft.parent2Id };
    }
  }
  return {
    format: DEVICE_FORMAT, version: DEVICE_VERSION, exportedAt: new Date(now()).toISOString(), env, userId,
    drafts: drafts.map(({ id, parent1Id, parent2Id, childId, registrant, memo }) => ({ id, parent1Id, parent2Id, childId, registrant, memo })),
    draftGenders,
    goals,
    goalsObs: cleanObservations(observations),
    notificationsRead: read.filter((id) => typeof id === 'string' && id.length <= ID_MAX),
    autoBreedingNotices: notices,
    playerMappings: Object.fromEntries(Object.entries(mappings).filter(([, mapping]) => isObject(mapping) && Object.keys(mapping).length)),
  };
}

/** 下書きと性別の対応を合わせる（性別は、控えた親の ID が今の下書きの親と同じ枠だけ。drafts.js の読み方と同じ） */
function combineDrafts(drafts, genders) {
  return list(drafts, DRAFTS_MAX).filter(isObject).map((draft) => {
    const saved = isObject(genders) && Object.hasOwn(genders, draft.id) && isObject(genders[draft.id]) ? genders[draft.id] : null;
    return {
      ...draft,
      parent1Gender: saved && saved.parent1Id === draft.parent1Id ? saved.parent1Gender : '',
      parent2Gender: saved && saved.parent2Id === draft.parent2Id ? saved.parent2Gender : '',
    };
  });
}

function cleanMappings(value) {
  const result = {};
  if (!isObject(value)) return result;
  for (const [world, mapping] of Object.entries(value).slice(0, WORLDS_MAX)) {
    const id = cleanWorldId(world);
    if (!id || !isObject(mapping)) continue;
    const entries = Object.entries(mapping).filter(([uid, user]) => idText(uid, 40) && idText(user, 20)).slice(0, MAPPING_MAX);
    if (entries.length) result[id] = Object.fromEntries(entries);
  }
  return result;
}

/**
 * 読み込んだ文字列を確かめて整える。合わなければ { ok: false, reason }（画面に出す 1 文）。
 * 合えば { ok: true, data, otherUser }（otherUser: 書き出した ID が今の ID と違う。画面が確かめる）。
 * data の下書き・目標・観測・既読・対応は形を整えた値（下書きの中身と目標の重複・上限は各ストアの取り込みで決まる）
 */
export function parseDeviceData(text, { env, userId }) {
  if (typeof text !== 'string' || text.length > DEVICE_MAX_BYTES) return { ok: false, reason: 'ファイルが大きすぎます（1MB まで）。' };
  let value = null;
  try { value = JSON.parse(text); } catch { return { ok: false, reason: '読めないファイルです（JSON ではありません）。' }; }
  if (!isObject(value) || value.format !== DEVICE_FORMAT) return { ok: false, reason: 'この端末のデータの書き出しのファイルではありません。' };
  if (value.version !== DEVICE_VERSION) return { ok: false, reason: '形式の版が違うため読み込めません（このページを最新にしてから試してください）。' };
  if (value.env !== env) return { ok: false, reason: `${envLabel(value.env)}のデータです。いまは${envLabel(env)}なので読み込めません。` };
  // マスターにないパルの目標は外す（画面に名前も画像も出せず、完成も確かめられないため）
  const goals = list(value.goals, GOAL_LIMIT * 2).map(cleanGoal).filter((goal) => goal && palIds.has(goal.palId));
  const data = {
    drafts: combineDrafts(value.drafts, value.draftGenders),
    goals,
    goalsObs: cleanObservations(value.goalsObs),
    notificationsRead: [...new Set(list(value.notificationsRead, READ_MAX).filter((id) => typeof id === 'string' && id && id.length <= ID_MAX))],
    autoBreedingNotices: list(value.autoBreedingNotices, NOTICES_MAX).filter(isObject),
    playerMappings: cleanMappings(value.playerMappings),
  };
  const checked = validateUserId(value.userId);
  const sourceUser = checked.ok ? checked.value : '';
  const same = typeof userId === 'string' && sourceUser && userIdKey(sourceUser) === userIdKey(userId);
  return { ok: true, data, otherUser: sourceUser && !same ? sourceUser : '' };
}

/** 下書きを id で併せる（今のものを優先し、無い id だけ後ろに足す）。足した下書きを返す */
export function draftsToAdd(current, incoming) {
  const ids = new Set(current.map((draft) => draft.id));
  const added = [];
  for (const draft of incoming) {
    if (!draft || ids.has(draft.id)) continue;
    ids.add(draft.id);
    added.push(draft);
  }
  return added;
}

/**
 * 目標を併せる（goalKey と id で重複を除き、上限まで。今のものを優先）。{ goals（今の後ろに足した全体）, added, skipped（重複・上限で入らなかった数） }
 */
export function mergeGoals(current, incoming, limit = GOAL_LIMIT) {
  const keys = new Set(current.map(goalKey));
  const ids = new Set(current.map((goal) => goal.id));
  const goals = [...current];
  let added = 0;
  for (const goal of incoming) {
    if (keys.has(goalKey(goal)) || ids.has(goal.id) || goals.length >= limit) continue;
    keys.add(goalKey(goal));
    ids.add(goal.id);
    goals.push(goal);
    added++;
  }
  return { goals, added, skipped: incoming.length - added };
}

/** 観測を併せる（今の観測があれば mergeObservation、なければ取り込んだ観測。species だけ。移行の記録は今のまま） */
export function mergeObservationSpecies(current, incoming, palIds) {
  const next = cleanObservations(current);
  const source = cleanObservations(incoming);
  // 辞書は自分のプロパティだけを引く（palId が constructor などでも継承したものを拾わない）
  const own = (species, palId) => (Object.hasOwn(species, palId) ? species[palId] : null);
  for (const palId of palIds) {
    const entry = own(source.species, palId);
    if (entry) next.species[palId] = mergeObservation(own(next.species, palId), entry);
  }
  return next;
}

/** 取り込む前の確認の文（「下書き 3・目標 5・既読 120・自動登録の記録 4・登録者の対応 2 件を取り込みます」） */
export function importSummary(data) {
  const mappings = Object.values(data.playerMappings).reduce((sum, mapping) => sum + Object.keys(mapping).length, 0);
  const parts = [
    ['下書き', data.drafts.length], ['目標', data.goals.length], ['既読', data.notificationsRead.length],
    ['自動登録の記録', data.autoBreedingNotices.length], ['登録者の対応', mappings],
  ].filter(([, count]) => count).map(([label, count]) => `${label} ${count}`);
  return parts.length ? `${parts.join('・')} 件を取り込みます。今のデータは消さずに足します。` : '';
}
