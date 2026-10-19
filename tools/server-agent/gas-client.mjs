// 常駐の GAS との通信（docs/server/README.md の T5）。web/js/api.js の createApi に、送る 1 回ごと（createApi の自動の再送を含む）に次を
// 確かめる transport を渡す。常駐・--once・--accept-world・--signup・--check --online・--dry-run の読み取りで同じものを使う。
// - 応答の env: 形の検証と再送より前に、設定の env と比べる（失敗の応答でも env があれば比べる。GAS は認証の後の失敗にも env を付ける）。
//   違えば onMismatch に 1 回だけ知らせ、それ以後は何も送らない（ENV_MISMATCH）。成功の応答に env がなければ違うとみなす
// - 書き込みの前: env を確かめられていない（起動の直後・env のない失敗の応答〔認証の前の失敗・古い GAS の失敗〕の後）なら、先に読み取り
//   （ownedWorlds）で確かめてから送る。確かめられなければ送らない（その読み取りの失敗の code）
// - 送る直前: gate(request) が理由のエラーを返したら送らない（常駐の停止・最後の送信の期限・attach の世代）
import { ApiError, createApi } from '../../web/js/api.js';

/** 応答の env が設定と違うと分かった後の通信の code（それ以後は GAS に何も送らない） */
export const ENV_MISMATCH = 'ENV_MISMATCH';
/** GAS に書く操作（応答の env を確かめてから送る） */
export const WRITE_ACTIONS = Object.freeze(new Set([
  'ownedUpload', 'ownedDelete', 'presence', 'create', 'update', 'delete', 'merge', 'restore', 'rename', 'signup', 'playerMapSet',
]));
// env を確かめる読み取り（パスワードだけで読め、書き込みのない操作）
const PROBE_ACTION = 'ownedWorlds';

// GAS へ 1 回送る（createApi の fetch と同じ形。期限で中断する）。応答の JSON（形はまだ確かめない）を返す
function fetchSender({ url, fetcher, timeoutMs }) {
  return async (request) => {
    if (!url) throw new ApiError('CONFIG');
    try {
      const response = await fetcher(url, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(request),
        credentials: 'omit', redirect: 'follow', signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new ApiError('RESPONSE');
      try { return await response.json(); } catch (error) {
        if (error instanceof TypeError || error?.name === 'TimeoutError' || error?.name === 'AbortError') throw error;
        throw new ApiError('RESPONSE');
      }
    } catch (error) {
      // 期限の中断は createApi と同じ TIMEOUT（TypeError は createApi が CONNECTION にする）
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new ApiError('TIMEOUT');
      throw error;
    }
  };
}

/**
 * @param {{ expected: string, url?: string, transport?: Function|null, fetcher?: Function, timeoutMs?: number }} options
 *   expected は設定の env。transport（テスト・開発用 API）を渡せば fetch の代わりに使う
 * @returns {{ api: { request: Function }, setGate: (gate: (request: object) => Error|null) => void,
 *   onMismatch: (listener: (got: string) => void) => () => void, mismatch: () => string|null }}
 *   api は createApi の形。mismatch() は違うと分かった env（分かるまで null）
 */
export function createGasClient({ expected, url = '', transport = null, fetcher = globalThis.fetch, timeoutMs = 35_000 }) {
  const send = transport ?? fetchSender({ url, fetcher, timeoutMs });
  let got = null;
  let confirmed = false;
  let gate = () => null;
  const listeners = new Set();

  // 受け取った応答の env を比べる（違えば ENV_MISMATCH の例外）。env のない失敗の応答は、どの環境の応答か分からないので確かめていない扱いにする
  function inspect(response) {
    if (got !== null) throw new ApiError(ENV_MISMATCH);
    const env = response && typeof response === 'object' ? response.env : undefined;
    if (typeof env !== 'string' && response?.ok !== true) {
      confirmed = false;
      return;
    }
    if (env === expected) {
      confirmed = true;
      return;
    }
    got = typeof env === 'string' ? env : '';
    confirmed = false;
    for (const listener of listeners) listener(got);
    throw new ApiError(ENV_MISMATCH);
  }

  function refuse(request) {
    if (got !== null) throw new ApiError(ENV_MISMATCH);
    const reason = gate(request);
    if (reason) throw reason;
  }

  // createApi の 1 回の試行（自動の再送のたびにも呼ばれる）
  async function attempt(request) {
    refuse(request);
    if (WRITE_ACTIONS.has(request.action) && !confirmed) {
      const probe = await send({ action: PROBE_ACTION, passcode: request.passcode });
      inspect(probe);
      if (!confirmed) throw new ApiError(probe?.ok === false && typeof probe.code === 'string' ? probe.code : 'RESPONSE');
      // 確かめている間に止めた・期限が過ぎたものは送らない
      refuse(request);
    }
    const response = await send(request);
    inspect(response);
    return response;
  }

  return {
    api: createApi({ transport: attempt, timeoutMs }),
    setGate(next) { gate = typeof next === 'function' ? next : () => null; },
    onMismatch(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    mismatch: () => got,
  };
}
