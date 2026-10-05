// セーブ連携ツール（scripts/save-bridge.mjs）との通信。この PC の 127.0.0.1 だけに接続する（index.html の CSP で許可）。
export const BRIDGE_ORIGIN = 'http://127.0.0.1:5175';

function bridgeError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// 初回は Chrome の「ローカル ネットワーク」の許可を待つことがあるため、時間切れは長めにする。
// 連携ツールが起動していなければ、接続はすぐに拒否されて失敗する。
async function request(path, read, { timeout = 60000, fetchImpl = globalThis.fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let response;
  try {
    response = await fetchImpl(`${BRIDGE_ORIGIN}${path}`, { signal: controller.signal, cache: 'no-store', credentials: 'omit' });
  } catch (error) {
    clearTimeout(timer);
    if (error?.name === 'AbortError') throw bridgeError('セーブ連携ツールの応答がありません', 'BRIDGE_TIMEOUT');
    throw bridgeError('セーブ連携ツールにつながりません。起動しているか、ブラウザの「ローカル ネットワーク」の許可を確認してください', 'BRIDGE_OFFLINE');
  }
  try {
    if (response.status === 404) throw bridgeError('セーブ連携ツールにファイルがありません', 'BRIDGE_NOT_FOUND');
    if (response.status === 403) throw bridgeError('セーブ連携ツールがこの画面からの読み込みを断りました（配信元を確認してください）', 'BRIDGE_FORBIDDEN');
    if (!response.ok) throw bridgeError(`セーブ連携ツールの応答がエラーでした（${response.status}）`, 'BRIDGE_ERROR');
    return await read(response);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 連携ツールが見つけたワールドの一覧（最後に遊んだ順）。
 * role は 'host'（この PC にワールドのセーブがある）か 'guest'（他の人のワールドに参加しただけ）。
 */
export async function listBridgeWorlds(options) {
  const body = await request('/worlds', (response) => response.json(), options);
  return Array.isArray(body?.worlds)
    ? body.worlds.filter((world) => typeof world?.dir === 'string' && Array.isArray(world.files)
      && (world.role === 'guest' || world.files.includes('Level.sav')))
      .map((world) => ({ ...world, role: world.role === 'guest' ? 'guest' : 'host' }))
    : [];
}

/**
 * ワールドのセーブ一式を読む。Level.sav 以外は、途中で消えた（ゲームの保存中など）ものを飛ばす。
 * @returns {Promise<{ path: string, bytes: Uint8Array }[]>}
 */
export async function readBridgeWorld(world, options = {}) {
  const files = [];
  for (const name of world.files) {
    const query = new URLSearchParams({ world: world.dir, name });
    try {
      const bytes = await request(`/file?${query}`, async (response) => new Uint8Array(await response.arrayBuffer()), options);
      files.push({ path: name, bytes });
    } catch (error) {
      if (name === 'Level.sav' || error.code !== 'BRIDGE_NOT_FOUND') throw error;
    }
  }
  return files;
}
