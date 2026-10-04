import { API_URL } from './config.js';

const messages = {
  AUTH: 'パスワードが違います。もう一度入力してください。',
  USER_NOT_FOUND: 'このIDは登録されていません（ID が見つかりません）。初めて使う方は新規登録してください。',
  USER_EXISTS: 'このIDはすでに使われています。別のIDを入力するか、ログインしてください。',
  CONFIG: 'サーバの設定が完了していません。管理者に確認してください。',
  BUSY: 'サーバが混み合っています。少し待ってからお試しください。',
  INTERNAL: 'サーバでエラーが発生しました。時間をおいてお試しください。',
  SHEET_HEADER: '保存先の項目に問題があります。管理者に確認してください。',
  BAD_REQUEST: 'リクエストを処理できませんでした。',
  DUPLICATE: '同じ配合がすでに登録されています。',
  PAIR_CONFLICT: '同じ組み合わせで別の子が登録されています。',
  ID_CONFLICT: '登録の識別情報が重複しています。登録画面を開き直してください。',
  VALIDATION: '入力内容を確認してください。',
  CONFLICT: '他の人が先に更新しました。最新の内容を確認してください。',
  NOT_FOUND: 'この登録は見つかりません。削除された可能性があります。',
  CONNECTION: 'サーバに接続できません',
  TIMEOUT: '応答に時間がかかっています。最新に更新して結果を確認してください。',
  RESPONSE: 'サーバの応答を読み取れませんでした。もう一度お試しください。',
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
  login: ['userId'], signup: ['userId', 'opId'],
  snapshot: [], create: ['opId', 'record', 'allowDifferentChild'],
  update: ['opId', 'id', 'expectedEtag', 'record', 'allowDifferentChild'],
  merge: ['opId', 'sourceId', 'targetId', 'expectedEtags'],
  delete: ['opId', 'id', 'expectedEtag'], restore: ['opId', 'id', 'expectedEtag'],
};
const recordFields = ['parent1Id', 'parent2Id', 'childId', 'parent1Gender', 'parent2Gender', 'registrant', 'memo'];

function pick(source, fields) {
  return Object.fromEntries(fields.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

export function buildRequest(action, passcode, input = {}) {
  if (!actionFields[action]) throw new ApiError('BAD_REQUEST');
  const request = { action, passcode, ...pick(input, actionFields[action]) };
  if (request.record) request.record = pick(request.record, action === 'create' ? ['id', ...recordFields] : recordFields);
  if (request.expectedEtags) request.expectedEtags = pick(request.expectedEtags, ['source', 'target']);
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
  const account = ['login', 'signup'].includes(action);
  if (!['prod', 'test'].includes(response.env) || !response.api
    || !validSnapshot(action === 'snapshot' || account ? response : response.snapshot)
    || (account ? typeof response.userId !== 'string' : action !== 'snapshot' && !response.record)) throw new ApiError('RESPONSE');
  return response;
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
      if (action === 'signup') input = { ...input, opId: input?.opId ?? crypto.randomUUID() };
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
