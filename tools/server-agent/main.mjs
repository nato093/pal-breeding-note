// 常駐の入口（docs/server/README.md の T5「確かめるための引数」）。引数・二重起動の防止・終了コード。
//   node tools/server-agent/main.mjs [--env test|prod] [--user <ID>] [--world <フォルダ>] [--server-root <フォルダ>] [--instance <ID>] [--verbose]
//   --check                 ネットにつながず、発見と解析の要約だけを出す（名前・ID は出さない）
//   --check --online        ログインと ownedWorlds の読み取りだけ（書かない）
//   --dry-run --once        送る中身を組み立てるが送らない（ownedUpload・create・presence・playerMapSet を記録して要約を出す）
//   --once [--force-host]   1 回だけ読んで送る（--force-host は test 環境だけ。サーバーが止まっていても今のセーブを読む）
//   --accept-world          古い系統の受け入れ（動いている常駐があれば <データ>\<env>\accept.request で伝える）
//   --signup                常駐の ID を作る（先に応答の環境を確かめる）
// 終了コード: 0 正常・1 想定外（通信の失敗を含む）・2 設定や環境の誤り（再起動しても直らない。状態のファイルを保存できなかったときも）・3 二重起動
// 動いている常駐を止めるには <データ>\<env>\stop.request を置く（2 秒以内に KV を書き出して 0 で終わる）。
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createStore, safeStorage } from '../../web/js/store.js';
import { readFiles } from '../../web/js/save/handles.js';
import { readWorldFiles } from '../../web/js/save/import.js';
import { userIdKey } from '../../web/js/core/user.js';
import { ConfigError, loadConfig } from './config.mjs';
import { createLogger } from './log.mjs';
import { createKvStorage } from './kv-storage.mjs';
import { discoverWorld, listWorldFiles } from './discover.mjs';
import { createServerMonitor } from './server-state.mjs';
import { fileHandles } from './fs-handles.mjs';
import { createAgent } from './agent.mjs';
import { createDryRunApi } from './dry-run.mjs';
import { createGasClient, ENV_MISMATCH } from './gas-client.mjs';
import { blockUnreadable, createLineageGuard } from './lineage-guard.mjs';

export const EXIT = Object.freeze({ OK: 0, UNEXPECTED: 1, CONFIG: 2, RUNNING: 3 });
const NAMESPACE = 'pal-note';
// パスワードを入れる環境変数（config.mjs が読む）
const SECRET_ENV_KEYS = ['PAL_AGENT_PASSCODE', 'PAL_TEST_PASSCODE'];

/**
 * 二重起動の防止に使う名前（データの場所の env のフォルダごと）。Windows は名前付きパイプ、ほか（CI の Linux）は抽象名前空間の UNIX ソケット。
 * どちらもファイルを作らず、持っているプロセスが落ちれば OS が外す。大文字と小文字を同じにするのは Windows だけ（Linux では別のフォルダ）
 */
export function lockPathOf(envDir, platform = process.platform) {
  const resolved = path.resolve(envDir);
  const key = platform === 'win32' ? resolved.toLowerCase() : resolved;
  const name = `pal-note-agent-${createHash('sha256').update(key).digest('hex').slice(0, 24)}`;
  return platform === 'win32' ? `\\\\.\\pipe\\${name}` : `\0${name}`;
}

/**
 * 二重起動の防止。lockPath（lockPathOf）を待ち受け、待ち受けられればこのプロセスが持つ。同じ名前は OS が 1 つにしか許さないので、同時に
 * 起動しても 1 つだけが取れる（ファイルと pid の確かめの間の競合・pid の使い回し・落ちた常駐の残りがない）。ほかのプロセスが持っていれば
 * { ok: false }。つながってきたものはすぐ切る（何も受け取らない）
 * @returns {Promise<{ ok: true, release: () => Promise<void> } | { ok: false }>}
 */
export function acquireLock(lockPath, { createServer = net.createServer } = {}) {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => socket.destroy());
    server.once('error', (error) => {
      if (error?.code === 'EADDRINUSE') resolve({ ok: false });
      else reject(error);
    });
    server.listen(lockPath, () => {
      // 待ち受けだけでプロセスを残さない
      server.unref();
      resolve({ ok: true, release: () => new Promise((done) => server.close(() => done())) });
    });
  });
}

// 引数の組み合わせの誤り（なければ ''）
function usageError(flags) {
  if (flags.online && !flags.check) return '--online は --check と一緒に使います';
  if (flags.dryRun && !flags.once) return '--dry-run は --once と一緒に使います';
  if (flags.forceHost && !flags.once) return '--force-host は --once と一緒に使います';
  const modes = [flags.check, flags.once, flags.acceptWorld, flags.signup].filter(Boolean).length;
  if (modes > 1) return '--check・--once・--accept-world・--signup は 1 つだけ指定してください';
  return '';
}

// 書き込みをしない fs（--check・--dry-run の KV。壊れた state.json の写しも残さない）
const readOnlyFs = {
  readFileSync: (...args) => fs.readFileSync(...args),
  copyFileSync() {},
  promises: { async mkdir() {}, async writeFile() {}, async rename() {} },
};

// ワールドの場所の先頭だけ（ドライブ。インスタンス ID・ワールド ID・ユーザー名を出さない）
const placeOf = (dir) => `${path.parse(dir).root}…`;

/**
 * @param {{ argv?: string[], env?: object, stdout?: { write: Function }, stderr?: { write: Function }, deps?: object }} options
 *   deps（テスト）: transport（GAS の代わり）・createMonitor（サーバーの稼働）・runImport（解析）・watch（見張り）
 * @returns {Promise<number>} 終了コード
 */
export async function main({ argv = process.argv.slice(2), env = process.env, stdout = process.stdout, stderr = process.stderr, deps = {} } = {}) {
  let config;
  try {
    config = loadConfig({ argv, env });
  } catch (error) {
    stderr.write(`[error] ${error instanceof ConfigError ? error.message : '設定を読めませんでした'}\n`);
    return error instanceof ConfigError ? EXIT.CONFIG : EXIT.UNEXPECTED;
  } finally {
    // パスワードは設定に読んだら環境変数から消す（この後に起動する PowerShell などの子に受け継がせない。run-agent.ps1 は子の node にだけ渡す）
    for (const key of SECRET_ENV_KEYS) delete env[key];
  }
  const { flags } = config;
  // 確かめるだけの動かし方（--check・--dry-run・--signup）はログのファイルに書かない（標準出力だけ）
  const quiet = flags.check || flags.dryRun || flags.signup;
  const log = createLogger({ dir: quiet ? '' : config.envDir, verbose: flags.verbose, stdout, env, redaction: { secrets: [config.passcode] } });
  try {
    return await run(config, log, deps);
  } catch (error) {
    log.error('unexpected', { error });
    return EXIT.UNEXPECTED;
  }
}

async function run(config, log, deps) {
  const { flags } = config;
  for (const message of config.warnings) log.warn('config-warning', { message });
  const usage = usageError(flags);
  if (usage) {
    log.error('config-error', { message: usage });
    return EXIT.CONFIG;
  }
  const needsLogin = !(flags.check && !flags.online);
  if (needsLogin && (!config.userId || !config.passcode)) {
    log.error('config-error', { message: '常駐の ID（--user か PAL_AGENT_USER_ID）とパスワード（PAL_AGENT_PASSCODE）が要ります' });
    return EXIT.CONFIG;
  }
  // GAS との通信は、どの動かし方でも応答の env を送る 1 回ごとに確かめる（gas-client.mjs。書き込みは env を確かめてから送る）
  const makeClient = () => createGasClient({ expected: config.env, url: config.apiUrl, transport: deps.transport ?? null });
  if (flags.signup) return signup(config, log, makeClient());

  const world = await discoverWorld({
    worldDir: config.worldDir, serverRoot: config.serverRoot, instance: config.instance, localAppData: config.localAppData,
  });
  if (!world.ok) {
    log.error('world-not-found', { reason: world.reason, ...(world.candidates.length ? { candidates: world.candidates } : {}) });
    return EXIT.CONFIG;
  }
  log.setRedaction({
    instanceDirs: [world.instanceDir, world.serverDir, world.savedDir].filter(Boolean), instanceIds: [world.instanceId].filter(Boolean),
  });
  // 名前・ID は出さない（見つけ方と場所の先頭だけ）
  log.info('world', { source: world.source, place: placeOf(world.worldDir), serverSync: Boolean(world.instanceId) });
  const monitor = (deps.createMonitor ?? createServerMonitor)({ instanceId: world.instanceId, serverDir: world.serverDir });
  const runImport = deps.runImport ?? ((files, onProgress) => readWorldFiles(files, { onProgress }));
  const kvFile = path.join(config.envDir, 'state.json');
  const openKv = (readOnly) => {
    const kv = createKvStorage({
      file: kvFile, namespace: NAMESPACE, fs: readOnly ? readOnlyFs : fs, onError: (code) => log.warn('kv-error', { code }),
    });
    // 壊れていた state.json から空で始めた: 止めた状態・受け入れの基準・前に送った値を失ったので、このワールドを止めた状態にする（受け入れで戻る）
    if (kv.brokenState() && blockUnreadable(safeStorage(kv), { namespace: NAMESPACE, env: config.env, worldId: world.worldId })) {
      log.warn('lineage-unreadable', { reason: '状態のファイルが壊れていたため、共有と自動登録を止めます（受け入れるときは --accept-world）' });
    }
    return kv;
  };

  if (flags.check && !flags.online) return check(config, world, { log, monitor, runImport, kv: openKv(true) });
  if (flags.check) return checkOnline(config, world, { log, client: makeClient(), kv: openKv(true) });

  const agentOf = ({ client, api = client.api, kv, forceHost = false }) => createAgent({
    config, world, storage: kv, log, monitor, client, api, runImport, namespace: NAMESPACE, forceHost,
    ...(deps.watch ? { watch: deps.watch } : {}),
  });

  if (flags.dryRun) {
    // KV は読むだけ（牧場の記録・古い系統の値を進めない）。二重起動の防止もしない（何も書かない）
    const client = makeClient();
    const dry = createDryRunApi({ api: client.api, env: config.env });
    const agent = agentOf({ client, api: dry, kv: openKv(true), forceHost: flags.forceHost });
    const code = await agent.runOnce({ dryRun: true });
    printDryRun(log, dry.summary(), agent.measured());
    return code;
  }

  const lock = await acquireLock(lockPathOf(config.envDir));
  if (!lock.ok) {
    if (flags.acceptWorld) {
      fs.mkdirSync(config.envDir, { recursive: true });
      fs.writeFileSync(path.join(config.envDir, 'accept.request'), new Date().toISOString());
      log.info('accept-requested', { message: '動いている常駐に受け入れを伝えました（結果は常駐のログに出ます）' });
      return EXIT.OK;
    }
    log.error('already-running', { message: 'この環境の常駐はすでに動いています' });
    return EXIT.RUNNING;
  }
  try {
    const agent = agentOf({ client: makeClient(), kv: openKv(false), forceHost: flags.forceHost });
    if (flags.acceptWorld) return await acceptWorld(agent, log);
    if (flags.once) return await agent.runOnce();
    return await daemon(agent, log);
  } finally {
    await lock.release();
  }
}

// 常駐として動かす。SIGINT・SIGTERM・SIGBREAK（Windows の Ctrl+Break）で KV を書き出して 0 で終わる
async function daemon(agent, log) {
  const signals = process.platform === 'win32' ? ['SIGINT', 'SIGTERM', 'SIGBREAK'] : ['SIGINT', 'SIGTERM'];
  const onSignal = (name) => {
    log.info('signal', { name });
    agent.stop(EXIT.OK);
  };
  for (const name of signals) process.on(name, onSignal);
  try {
    log.info('started', { pid: process.pid });
    return await agent.start();
  } finally {
    for (const name of signals) process.off(name, onSignal);
  }
}

// 古い系統の受け入れ（動いている常駐がないとき）。ログインし、今のセーブと公開の世代を基準にする
async function acceptWorld(agent, log) {
  const result = await agent.login();
  if (result !== 'ok') {
    await agent.close();
    return result === 'network' ? EXIT.UNEXPECTED : EXIT.CONFIG;
  }
  const outcome = await agent.acceptWorld();
  // 受け入れを state.json に書けなければ、受け入れたことにならない（close が kv-unsaved をログに出す）
  const saved = await agent.close();
  if (outcome.ok && !saved) return EXIT.CONFIG;
  if (outcome.ok) log.info('accept-done', { message: '受け入れました。次に動いたときから共有と自動登録を続けます' });
  return outcome.ok ? EXIT.OK : outcome.retry ? EXIT.UNEXPECTED : EXIT.CONFIG;
}

// --signup: 先に読み取りで応答の環境を確かめてから ID を作る（別の環境のパスワードで作らない。gas-client.mjs が書き込みの前に確かめ、
// 登録の応答の env も確かめる）
async function signup(config, log, client) {
  try {
    const response = await client.api.request('signup', config.passcode, { userId: config.userId });
    log.info('signed-up', { env: response.env, message: '常駐の ID を作りました' });
    return EXIT.OK;
  } catch (error) {
    if (error?.code === ENV_MISMATCH) {
      log.error('env-mismatch', { expected: config.env, got: client.mismatch() ?? '', reason: '応答の環境が設定と違うため、ID を作りません' });
      return EXIT.CONFIG;
    }
    if (error?.code === 'USER_EXISTS') {
      log.info('signup-exists', { message: 'この ID はすでにあります（そのまま使えます）' });
      return EXIT.OK;
    }
    log.error('signup-failed', { code: error?.code || 'ERROR' });
    return ['TIMEOUT', 'CONNECTION', 'BUSY', 'INTERNAL', 'RESPONSE'].includes(error?.code) ? EXIT.UNEXPECTED : EXIT.CONFIG;
  }
}

// 古い系統の守りの状態（KV を読むだけ）。止めているか・受け入れたことがあるか
function lineageState(config, world, kv) {
  const guard = createLineageGuard({
    server: { scope: () => config.env, request: async () => { throw new Error('offline'); } }, storage: safeStorage(kv), namespace: NAMESPACE,
  });
  const status = guard.status(world.worldId);
  return { blocked: status.state === 'blocked', accepted: Boolean(status.baseline) };
}

// --check: ネットにつながず、発見と解析の要約（体数・プレイヤー数・プレイ中の人数・牧場・日数・見つけた場所の先頭）
async function check(config, world, { log, monitor, runImport, kv }) {
  const files = await listWorldFiles(world.worldDir);
  const paths = Object.keys(files);
  log.info('check-files', { files: paths.length, players: paths.filter((rel) => /^Players\/[0-9a-f]{32}\.sav$/i.test(rel)).length });
  if (!files['Level.sav'] || !files['LevelMeta.sav']) {
    log.error('check-failed', { reason: 'Level.sav・LevelMeta.sav が見つかりません' });
    return EXIT.CONFIG;
  }
  const started = performance.now();
  const read = await readFiles(fileHandles(files), paths, ['Level.sav', 'LevelMeta.sav']);
  const snapshot = await runImport(read.files, () => {});
  const players = Array.isArray(snapshot.players) ? snapshot.players : [];
  const farms = Array.isArray(snapshot.breedFarms) ? snapshot.breedFarms : [];
  log.info('check-save', {
    pals: snapshot.pals?.length ?? 0, players: players.length, online: players.filter((player) => player?.online === true).length,
    farms: farms.length, eggs: farms.reduce((sum, farm) => sum + (Array.isArray(farm?.eggs) ? farm.eggs.length : 0), 0),
    day: snapshot.world?.inGameDay ?? 0, clock: Boolean(snapshot.world?.clock), stamp: Boolean(snapshot.world?.savedAtTicks),
    skipped: read.skipped.length + (snapshot.files?.skipped?.length ?? 0), seconds: Math.round((performance.now() - started) / 100) / 10,
  });
  const server = await monitor.check();
  log.info('check-server', { state: server.state, source: server.source, ...(server.reasons?.length ? { reasons: server.reasons } : {}) });
  log.info('check-lineage', lineageState(config, world, kv));
  return EXIT.OK;
}

// --check --online: ログインと ownedWorlds の読み取りだけ（書かない。presence も送らない）。どちらの応答も env を確かめる（gas-client.mjs）
async function checkOnline(config, world, { log, client, kv }) {
  const memory = new Map();
  const store = createStore({
    api: client.api, namespace: NAMESPACE,
    storage: safeStorage({ getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)), removeItem: (key) => memory.delete(key) }),
  });
  const mismatch = () => {
    store.logout();
    log.error('env-mismatch', { expected: config.env, got: client.mismatch() ?? '', reason: '応答の環境が設定と違います' });
    return EXIT.CONFIG;
  };
  try {
    await store.login(config.userId, config.passcode);
  } catch (error) {
    if (error?.code === ENV_MISMATCH) return mismatch();
    log.error('login-failed', { code: error?.code || 'ERROR' });
    return ['TIMEOUT', 'CONNECTION', 'BUSY', 'INTERNAL', 'RESPONSE'].includes(error?.code) ? EXIT.UNEXPECTED : EXIT.CONFIG;
  }
  log.info('check-login', { env: store.state.env, records: store.state.records.length });
  let response;
  try {
    response = await store.call('ownedWorlds');
  } catch (error) {
    if (error?.code === ENV_MISMATCH) return mismatch();
    log.error('check-failed', { code: error?.code || 'ERROR' });
    return EXIT.UNEXPECTED;
  }
  const published = response.worlds.find((item) => item.worldId === world.worldId) ?? null;
  log.info('check-published', published ? {
    published: true, uploadedAt: published.uploadedAt, pals: published.palCount, day: published.inGameDay ?? 0, saveKind: published.saveKind ?? '',
    byThisAgent: userIdKey(published.uploadedBy) === userIdKey(store.state.userId),
  } : { published: false });
  log.info('check-lineage', lineageState(config, world, kv));
  return EXIT.OK;
}

function printDryRun(log, summary, measured) {
  log.info('dry-run', {
    counts: summary.counts, chars: measured.chars, limit: measured.limit ?? 0, refused: measured.refused,
    ...(summary.upload ? { pals: summary.upload.rows, players: summary.upload.players, farms: summary.upload.farms, day: summary.upload.inGameDay } : {}),
  });
  if (summary.presence) {
    const { role, playing, canShare, resident } = summary.presence;
    log.info('dry-run-presence', { role, playing, canShare, resident });
  }
  for (const item of summary.creates) log.info('dry-run-create', { parents: item.parents });
}

// node tools/server-agent/main.mjs で動かしたとき
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => process.exit(code), () => process.exit(EXIT.UNEXPECTED));
}
