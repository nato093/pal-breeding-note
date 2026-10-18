import { API_URL } from './config.js';
import { cleanSnapshot, cleanOwnedWorlds, cleanOwnedPayload, cleanPresenceList, isoTime, int, text } from './core/boundary.js';
import {
  OWNED_MAX_ROWS, OWNED_RESULTS, ownedSaveStamp, ownedWorldId, PLAYER_MAP_ENTRY_FIELDS, PLAYER_MAP_SET_MAX, cleanPlayerMapEntries,
} from './core/owned-shared.js';

const messages = {
  AUTH: 'パスワードが違います。もう一度入力してください。',
  USER_NOT_FOUND: 'この ID は見つかりません。初めての方は新規登録へ。',
  USER_EXISTS: 'この ID はすでに使われています。別の ID にするか、ログインしてください。',
  CONFIG: 'サーバの設定が完了していません。管理者に確認してください。',
  BUSY: 'サーバが混み合っています。少し待ってからお試しください。',
  INTERNAL: 'サーバでエラーが発生しました。時間をおいてお試しください。',
  SHEET_HEADER: '保存先の項目に問題があります。管理者に確認してください。',
  BAD_REQUEST: 'リクエストを処理できませんでした。',
  TOO_LARGE: '送る内容が大きすぎます。',
  DUPLICATE: '同じ配合がすでに登録されています。',
  PAIR_CONFLICT: '同じ組み合わせで別の子が登録されています。',
  ID_CONFLICT: '登録の識別情報が重複しています。登録画面を開き直してください。',
  VALIDATION: '入力内容を確認してください。',
  CONFLICT: '他の人が先に更新しました。最新の内容を確認してください。',
  NOT_FOUND: 'この登録は見つかりません。削除された可能性があります。',
  CONNECTION: 'サーバに接続できません',
  TIMEOUT: '応答に時間がかかっています。右上の同期状況を押して、結果を確かめてください。',
  RESPONSE: 'サーバの応答を読み取れませんでした。もう一度お試しください。',
  // 画面は前置き「共有された所持パルを読めませんでした: 」に続けて出し、自分で読み直す（owned.js）
  PARTIAL: '共有の書き込みと重なりました。少し待つと自動で読み直します。',
  RENAMING: 'ID を変更しています。終わってからもう一度お試しください。',
  STORAGE: 'この端末に保存できないため、ID を変更できません。',
  LOCAL_SAVE: 'この端末への保存（下書き・ウィッシュリスト・目標・このワールドでの自分）に失敗しています。保存できる状態にしてからお試しください。',
  LOCAL_MOVE: 'ID は変更しました。この端末の下書きなどを移せなかったので、設定の「ID の変更を再試行」を押してください。',
};

export function errorMessage(code) {
  return messages[code] ?? '処理を完了できませんでした。もう一度お試しください。';
}

export class ApiError extends Error {
  constructor(code, response = {}) {
    super(errorMessage(code));
    this.code = code;
    this.response = response;
  }
}

const actionFields = {
  login: ['userId'], signup: ['userId', 'opId'], rename: ['opId', 'userId', 'newUserId'],
  snapshot: [], create: ['opId', 'record', 'allowDifferentChild'],
  update: ['opId', 'id', 'expectedEtag', 'record', 'allowDifferentChild'],
  merge: ['opId', 'sourceId', 'targetId', 'expectedEtags'],
  delete: ['opId', 'id', 'expectedEtag'], restore: ['opId', 'id', 'expectedEtag'],
  ownedWorlds: [], owned: ['worldId'], ownedDelete: ['worldId'],
  // ownedUpload の最上位の項目は増やさない（古い GAS が UNKNOWN_FIELD で断る。セーブの識別は world の中に入れる）
  ownedUpload: ['userId', 'worldId', 'world', 'saveUpdatedAt', 'players', 'bases', 'farms', 'columns', 'rows'],
  // 共有が変わったか（uploadedAt は画面が持っている共有の版）と、ページを開いている PC（owned-gas。古い GAS は BAD_ACTION）
  ownedSince: ['worldId', 'uploadedAt', 'presence'], presence: ['worldId', 'presence'],
  // プレイヤーの対応（server の mapping。古い GAS は BAD_ACTION）。entries の 1 件は PLAYER_MAP_ENTRY_FIELDS の項目だけを送る
  playerMap: ['worldId'], playerMapSet: ['userId', 'worldId', 'entries', 'onlyMissing'],
};
// 所持パルの共有（スプレッドシート）。配合の全件（snapshot）は返さない
const ownedActions = new Set(['ownedWorlds', 'owned', 'ownedUpload', 'ownedDelete', 'ownedSince', 'presence']);
// プレイヤーの対応（server の mapping）。配合の全件（snapshot）は返さない
const playerMapActions = new Set(['playerMap', 'playerMapSet']);
// ページを開いている PC として送る項目（core/owned-shared.js の cleanPresenceInput）
const presenceFields = ['pageId', 'device', 'user', 'role', 'playing', 'canShare'];
const recordFields = ['parent1Id', 'parent2Id', 'childId', 'parent1Gender', 'parent2Gender', 'registrant', 'memo'];

function pick(source, fields) {
  return Object.fromEntries(fields.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

export function buildRequest(action, passcode, input = {}) {
  if (!actionFields[action]) throw new ApiError('BAD_REQUEST');
  const request = { action, passcode, ...pick(input, actionFields[action]) };
  if (request.record) request.record = pick(request.record, action === 'create' ? ['id', ...recordFields] : recordFields);
  if (request.expectedEtags) request.expectedEtags = pick(request.expectedEtags, ['source', 'target']);
  if (request.presence && typeof request.presence === 'object') request.presence = pick(request.presence, presenceFields);
  if (action === 'playerMapSet' && Array.isArray(request.entries)) {
    request.entries = request.entries.map((entry) => (entry && typeof entry === 'object' ? pick(entry, PLAYER_MAP_ENTRY_FIELDS) : entry));
  }
  return request;
}

export function validSnapshot(value) {
  return value && Array.isArray(value.records) && Array.isArray(value.warnings) && typeof value.serverTime === 'string'
    && Array.isArray(value.users) && value.users.every((userId) => typeof userId === 'string');
}

export function validateResponse(response, action) {
  if (!response || typeof response.ok !== 'boolean') throw new ApiError('RESPONSE');
  if (!response.ok) {
    if (typeof response.code !== 'string') throw new ApiError('RESPONSE');
    throw new ApiError(response.code, response);
  }
  if (ownedActions.has(action)) return validateOwnedResponse(response, action);
  if (playerMapActions.has(action)) return validatePlayerMapResponse(response, action);
  const account = ['login', 'signup', 'rename'].includes(action);
  if (!['prod', 'test'].includes(response.env) || !response.api
    || !validSnapshot(action === 'snapshot' || account ? response : response.snapshot)
    || (account ? typeof response.userId !== 'string' : action !== 'snapshot' && !response.record)) throw new ApiError('RESPONSE');
  // 形を確かめた後で、全件の要素を整える（壊れた要素だけを捨てる。core/boundary.js）
  return action === 'snapshot' || account ? cleanSnapshot(response) : { ...response, snapshot: cleanSnapshot(response.snapshot) };
}

function validateOwnedResponse(response, action) {
  const world = (value) => value && typeof value === 'object' && typeof value.worldId === 'string';
  const payload = () => (response.world === null || world(response.world)) && Array.isArray(response.columns) && Array.isArray(response.rows);
  // presence は配列か null（サーバーのキャッシュを読めなかった）
  const presence = () => response.presence === null || Array.isArray(response.presence);
  const ok = ['prod', 'test'].includes(response.env) && response.api && typeof response.serverTime === 'string' && ({
    ownedWorlds: () => Array.isArray(response.worlds) && response.worlds.every(world),
    owned: payload,
    ownedUpload: () => typeof response.stored === 'boolean' && world(response.world),
    ownedDelete: () => typeof response.deleted === 'boolean',
    ownedSince: () => typeof response.changed === 'boolean' && presence()
      && (response.changed ? payload() : typeof response.uploadedAt === 'string'),
    presence: () => presence(),
  })[action]();
  if (!ok) throw new ApiError('RESPONSE');
  // 形を確かめた後で、中身を整える（壊れた要素だけを捨てる。core/boundary.js）。所持パルの中身には、受け取った生の行の数（重複・壊れた行を
  // 除く前）を receivedRows に残す（画面が world.palCount と比べ、違えば前の表示を残して読み直す。sync-fixes の share-fetch）
  if (action === 'ownedWorlds') return { ...response, worlds: cleanOwnedWorlds(response.worlds) };
  if (action === 'owned') return { ...response, ...cleanOwnedPayload(response), receivedRows: response.rows.length };
  if (action === 'ownedUpload') {
    const [world] = cleanOwnedWorlds([response.world]);
    if (!world) throw new ApiError('RESPONSE');
    const cleaned = { ...response, world };
    // 結果の種類（result）と、古い世代の掃除の成否（cleanup）は新しい GAS だけが返す。形が違えば付いていないものとして扱う
    if (!OWNED_RESULTS.includes(cleaned.result)) delete cleaned.result;
    if (typeof cleaned.cleanup !== 'boolean') delete cleaned.cleanup;
    return cleaned;
  }
  if (action === 'ownedSince') {
    const list = cleanPresenceList(response.presence);
    if (response.changed) return { ...response, ...cleanOwnedPayload(response), receivedRows: response.rows.length, presence: list };
    const cleaned = {
      ...response, uploadedAt: isoTime(response.uploadedAt), uploadedBy: text(response.uploadedBy, 20),
      saveUpdatedAt: isoTime(response.saveUpdatedAt), palCount: int(response.palCount, { min: 0, max: OWNED_MAX_ROWS }), presence: list,
    };
    if (typeof response.saveStamp === 'string') cleaned.saveStamp = ownedSaveStamp(response.saveStamp);
    else delete cleaned.saveStamp;
    return cleaned;
  }
  if (action === 'presence') return { ...response, presence: cleanPresenceList(response.presence), saved: response.saved === true };
  return response;
}

// プレイヤーの対応（{ worldId, entries, serverTime }。playerMapSet は changed・skipped も）。形を確かめた後で、対応の要素を整える
//（形の違う要素を捨て、同じ鍵は後の要素。core/owned-shared.js の cleanPlayerMapEntries）
function validatePlayerMapResponse(response, action) {
  const worldId = ownedWorldId(response.worldId);
  const ok = ['prod', 'test'].includes(response.env) && response.api && typeof response.serverTime === 'string'
    && worldId && Array.isArray(response.entries);
  if (!ok) throw new ApiError('RESPONSE');
  const cleaned = { ...response, worldId, entries: cleanPlayerMapEntries(response.entries) };
  if (action === 'playerMapSet') {
    cleaned.changed = int(response.changed, { min: 0, max: PLAYER_MAP_SET_MAX });
    cleaned.skipped = int(response.skipped, { min: 0, max: PLAYER_MAP_SET_MAX });
  }
  return cleaned;
}

export function createApi({ fetcher = globalThis.fetch, url = API_URL, timeoutMs = 35000, transport } = {}) {
  async function attempt(request) {
    const controller = new AbortController();
    let timedOut = false;
    let timer;
    try {
      // ヘッダー取得後の本文読み取りにも同じ期限を適用する。
      const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new ApiError('TIMEOUT'));
        }, timeoutMs);
      });
      const execute = async () => {
        if (transport) return transport(request);
        if (!url) throw new ApiError('CONFIG');
        const response = await fetcher(url, {
          method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(request), credentials: 'omit', redirect: 'follow', signal: controller.signal,
        });
        if (!response.ok) throw new ApiError('RESPONSE');
        try { return await response.json(); } catch (error) {
          if (error instanceof TypeError) throw error;
          throw new ApiError('RESPONSE');
        }
      };
      return validateResponse(await Promise.race([execute(), timeout]), request.action);
    } catch (error) {
      if (timedOut || error.name === 'AbortError') throw new ApiError('TIMEOUT');
      if (error instanceof TypeError) throw new ApiError('CONNECTION');
      throw error;
    } finally { clearTimeout(timer); }
  }
  return {
    async request(action, passcode, input) {
      if (['signup', 'rename'].includes(action)) input = { ...input, opId: input?.opId ?? crypto.randomUUID() };
      const request = buildRequest(action, passcode, input);
      for (let attemptNumber = 0; attemptNumber < 2; attemptNumber++) {
        try { return await attempt(request); } catch (error) {
          if (attemptNumber === 0 && ['TIMEOUT', 'CONNECTION', 'BUSY', 'RESPONSE'].includes(error.code)) continue;
          throw error;
        }
      }
    },
  };
}
