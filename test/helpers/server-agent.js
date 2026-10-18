// 常駐（tools/server-agent）のテストの共通の材料。値はすべてダミー（実在のワールド ID・インスタンス ID・UID ではない）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDevelopmentApi } from '../../dev/mock-api.js';
import { createApi } from '../../web/js/api.js';
import { createLogger } from '../../tools/server-agent/log.mjs';

export const W = 'ABCDEF0123456789ABCDEF0123456789';
export const INSTANCE = 'TESTINSTA0000001';
export const PASS = 'dummy-agent-pass-0001';
export const U1 = '0000000000000000000000000000aa01';
export const U2 = '0000000000000000000000000000aa02';
export const T0 = Date.parse('2026-10-18T05:00:00.000Z');
// GAS に書く操作（これ以外は読み取り）
export const WRITE_ACTIONS = new Set(['ownedUpload', 'ownedDelete', 'presence', 'create', 'update', 'delete', 'merge', 'restore', 'playerMapSet', 'rename']);

// セーブの中の保存時刻（Level.sav の Timestamp のティック）と、ワールドが動いた通算の時間（RealDateTimeTicks。分のティック）
export const stampAt = (seconds) => String(638650000000000000n + BigInt(Math.round(seconds)) * 10_000_000n);
export const clockAt = (minutes) => String(BigInt(minutes) * 600_000_000n);
// キャラクターの InstanceId（GUID の形のダミー）
export const instanceOf = (uid) => `00000000-0000-0000-0000-0000${uid.slice(-8)}`;

const parent = (characterId, gender, uid) => ({ instanceId: `${characterId}-${gender}`, characterId, gender, depositorUid: uid });
const sheepFarm = (eggs, uid) => ({
  id: 'f1', baseId: 'b', status: 'ok', parents: [parent('SheepBall', 'Female', uid), parent('SwordCutlassfish', 'Male', uid)],
  eggs: eggs.map((characterId, i) => ({ localId: `f1-${i}`, characterId, itemId: 'PalEgg_Earth_01' })),
});
/** 牧場の親（SheepBall ♀・SwordCutlassfish ♂）のタマゴを登録したときの記録（registered の形） */
export const SHEEP = 'SheepBall(F)×SwordCutlassfish(M)>GuardianDog:仲間';
export const registered = (store) => store.state.records
  .map((r) => `${r.parent1Id}(${r.parent1Gender})×${r.parent2Id}(${r.parent2Gender})>${r.childId}:${r.registrant}`);

/**
 * 読み込んだセーブ（seconds 秒に保存・通算 minutes 分・day 日目）。プレイヤーの 1 人目は「仲間」（ノートの ID と同じ名前）で、牧場の親を預けた人。
 * pals は個体の数
 */
export function snapshotOf({ seconds, minutes, day, eggs = [], players = [U1], pals = 1, name = '' }) {
  return {
    version: 1, world: { name, hostName: '', savedAtTicks: stampAt(seconds), clock: clockAt(minutes), inGameDay: day },
    players: players.map((uid, i) => ({ uid, name: i === 0 ? '仲間' : `参加者${i + 1}`, level: 10, instanceId: instanceOf(uid), online: true })),
    bases: [],
    pals: Array.from({ length: pals }, (_, i) => ({
      instanceId: `i${i}`, characterId: 'SheepBall', passives: [], talent: {}, location: { kind: 'palbox', playerUid: players[0] },
    })),
    breedFarms: [sheepFarm(eggs, players[0])], stats: {}, files: { used: [], skipped: [] },
  };
}

/**
 * 一時フォルダに ServerSync のインスタンスの形を作る（instances.json・GameUserSettings.ini・SaveGames\0\<W> の Level.sav・LevelMeta.sav・
 * Players）。save(time) はワールドのファイルの更新日時を time にする（サーバーの保存）。addPlayer(uid) は Players にファイルを足す
 */
export function serverWorld(t, { players = [U1], worldId = W } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pal-agent-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, text = 'x') => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
  };
  const instanceDir = path.join(root, 'ServerSync', INSTANCE);
  const saved = path.join(instanceDir, 'bin', 'Pal', 'Saved');
  const worldDir = path.join(saved, 'SaveGames', '0', worldId);
  write(path.join(saved, 'Config', 'WindowsServer', 'GameUserSettings.ini'), `[/Script/Pal.PalGameLocalSettings]\r\nDedicatedServerName=${worldId}\r\n`);
  write(path.join(root, 'Local', 'ServerSync', 'instances.json'), JSON.stringify({ [INSTANCE]: instanceDir }));
  write(path.join(worldDir, 'Level.sav'));
  write(path.join(worldDir, 'LevelMeta.sav'));
  const site = {
    root, worldDir, instanceDir, local: path.join(root, 'Local'), dataDir: path.join(root, 'data'),
    addPlayer(uid) {
      write(path.join(worldDir, 'Players', `${uid}.sav`));
      write(path.join(worldDir, 'Players', `${uid}_dps.sav`));
    },
    files() {
      const players = path.join(worldDir, 'Players');
      return [path.join(worldDir, 'Level.sav'), path.join(worldDir, 'LevelMeta.sav'), ...(fs.existsSync(players) ? fs.readdirSync(players).map((name) => path.join(players, name)) : [])];
    },
    save(time) {
      const seconds = time / 1000;
      for (const file of site.files()) fs.utimesSync(file, seconds, seconds);
    },
  };
  for (const uid of players) site.addPlayer(uid);
  site.save(T0);
  return site;
}

/**
 * GAS の代わり（開発用 API。時計は now）。control.calls は届いた操作の名前、control.requests は書き込みの中身、control.fail は操作ごとの失敗の code、
 * control.env を入れると応答の env をそれにする（環境の違い）。「サーバー」と「仲間」の ID を作っておく
 */
export async function gasOf({ now = Date.now } = {}) {
  const development = createDevelopmentApi({ now });
  const control = { calls: [], requests: [], fail: {}, env: '', gates: {}, sincePresence: 0 };
  const transport = async (request) => {
    control.calls.push(request.action);
    // owned.js が ownedSince に載せる presence（常駐は外して送る）
    if (request.action === 'ownedSince' && request.presence !== undefined) control.sincePresence++;
    if (WRITE_ACTIONS.has(request.action)) control.requests.push({ action: request.action, chars: JSON.stringify(request).length, request: structuredClone(request) });
    await control.gates[request.action];
    const code = control.fail[request.action];
    if (code) return { ok: false, code };
    const response = await development(request);
    return control.env && response?.ok ? { ...response, env: control.env } : response;
  };
  const api = createApi({ transport });
  await api.request('signup', PASS, { userId: 'サーバー' });
  await api.request('signup', PASS, { userId: '仲間' });
  control.calls.length = 0;
  control.requests.length = 0;
  const writes = (action) => control.requests.filter((item) => !action || item.action === action);
  const published = async () => (await api.request('ownedWorlds', PASS)).worlds.find((world) => world.worldId === W) ?? null;
  return { api, transport, control, writes, published };
}

/** 書いた行を覚えるログ（log.mjs の形。パスワードは伏せる） */
export function memoryLog({ secrets = [PASS], verbose = true } = {}) {
  const lines = [];
  const logger = createLogger({ dir: '', stdout: { write: (line) => lines.push(line) }, verbose, redaction: { secrets }, env: {} });
  return { lines, logger, text: () => lines.join('') };
}
