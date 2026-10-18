// 常駐の --dry-run（docs/server/README.md の T5「確かめるための引数」）。api（createApi の形）を包み、書き込みの操作（ownedUpload・create・
// presence・playerMapSet など）は GAS に送らずに中身の要約を記録する。読み取り（login・snapshot・ownedWorlds・ownedSince・playerMap）は送る。
// ownedUpload と presence は、GAS と同じ検査（core/owned-shared.js の validateOwnedUpload）を通した仮の成功を返す（自動登録が、共有の結果の
// 判定の後に登録を組み立てるところまで進むため）。ほかの書き込みは DRY_RUN の失敗にする（自動登録は記録を変えずに次の候補へ進む）。
// 要約には人の名前・ID と配合表の子を入れない（数・親の種族・presence の値だけ）。
import { buildRequest, validateResponse } from '../../web/js/api.js';
import { validateOwnedUpload } from '../../web/js/core/owned-shared.js';

/** GAS に送らずに記録する操作 */
export const DRY_RUN_WRITES = Object.freeze(new Set([
  'ownedUpload', 'ownedDelete', 'presence', 'create', 'update', 'delete', 'merge', 'restore', 'rename', 'signup', 'playerMapSet',
]));

// 記録する要約（人の名前・ID は入れない）
function summaryOf(action, request, chars) {
  if (action === 'ownedUpload') {
    return {
      action, chars, rows: Array.isArray(request.rows) ? request.rows.length : 0, players: Array.isArray(request.players) ? request.players.length : 0,
      farms: Array.isArray(request.farms) ? request.farms.length : 0, inGameDay: request.world?.inGameDay ?? 0, saveKind: request.world?.saveKind ?? '',
    };
  }
  if (action === 'presence') {
    const { role, playing, canShare, resident } = request.presence ?? {};
    return { action, role, playing, canShare, resident: resident === true };
  }
  // 子（配合表で決めた値）は出さない（INV-2）
  if (action === 'create') return { action, parents: [request.record?.parent1Id ?? '', request.record?.parent2Id ?? ''] };
  if (action === 'playerMapSet') return { action, entries: Array.isArray(request.entries) ? request.entries.length : 0 };
  return { action };
}

/**
 * @param {{ api: { request: Function }, env: string, now?: () => number }} options env は仮の応答の環境（設定の env）
 * @returns {{ request: Function, sent: object[], summary: () => object }}
 */
export function createDryRunApi({ api, env, now = Date.now }) {
  const sent = [];
  const base = () => ({ ok: true, env, api: 1, serverTime: new Date(now()).toISOString() });

  // GAS の応答の形の仮の成功（ownedUpload は開発用 API〔dev/mock-api.js〕と同じ規則で world を作る）
  function fakeResponse(action, request) {
    if (action === 'presence') return { ...base(), presence: [], saved: true };
    if (action !== 'ownedUpload') return { ok: false, code: 'DRY_RUN' };
    const checked = validateOwnedUpload(request);
    if (!checked.ok) return { ok: false, code: 'VALIDATION', errors: checked.errors };
    const input = checked.value;
    const head = base();
    const world = {
      worldId: input.worldId, worldName: input.worldName, hostName: input.hostName, saveUpdatedAt: input.saveUpdatedAt,
      uploadedAt: head.serverTime, uploadedBy: String(request.userId ?? '').slice(0, 20), palCount: input.rows.length,
      players: input.players, bases: input.bases, farms: input.farms, inGameDay: input.inGameDay,
      saveStamp: input.identity ? input.identity.stamp : '', ...(input.extras ?? {}),
    };
    return { ...head, stored: true, result: 'new', world, cleanup: true };
  }

  return {
    sent,
    async request(action, passcode, input) {
      if (!DRY_RUN_WRITES.has(action)) return api.request(action, passcode, input);
      const request = buildRequest(action, passcode, input);
      sent.push(summaryOf(action, request, JSON.stringify(request).length));
      return validateResponse(fakeResponse(action, request), action);
    },
    /** 操作ごとの数と、最後の共有・presence の要約 */
    summary() {
      const counts = {};
      for (const item of sent) counts[item.action] = (counts[item.action] ?? 0) + 1;
      const last = (action) => [...sent].reverse().find((item) => item.action === action) ?? null;
      return { counts, upload: last('ownedUpload'), presence: last('presence'), creates: sent.filter((item) => item.action === 'create') };
    },
  };
}
