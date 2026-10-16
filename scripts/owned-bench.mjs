// 所持パルの共有（F1 の世代の書き込み・G の ownedSince）の計測。テスト用の deployment に対して、テスト用のシートだけで動かす
//（docs/sync-fixes/README.md の 3 の「計測」・「GAS の反映・巻き戻し」の 3）。
//
//   PAL_API_URL=<テスト用の deployment の /exec URL> node scripts/owned-bench.mjs [--mode=normal|load] [--rounds=6] [--readers=3] [--no-probe]
//   巻き戻しのリハーサル: ... --rehearsal=prepare → --rehearsal=legacy-write --world=<ID> → --rehearsal=finish --world=<ID>（runRehearsal。手順は docs/OPERATIONS.md）
//
// - テスト用パスワードは .env.local の PAL_TEST_PASSCODE から読み、表示しない（scripts/api-check.mjs と同じ）。
// - 最初に読み取りの操作（ownedWorlds）で応答がテスト環境か、ownedSince がある新しい版かを確かめ、だめなら何も書かずに止める。
//   以後も、テスト環境以外の応答を受けたらその場で止める。
// - ランダムな worldId を 3 つだけ使い（計約 4600 行）、終わったら（失敗・Ctrl+C でも）finally でその 3 つだけを消す。
//   api-check はテスト環境の記録を全部消す作りなので、同時に流さない。鍵とキャッシュは本番と共用なので、遊んでいない時間に流す。
// - probe（鍵を取る診断の操作）の行はテスト用の専用シート _probe_test に残る（診断ページ /diag.html が次に開いたときに消す）。
// - 計るもの: 操作ごとの時間（中央値・95%・最大）と失敗率、読み手が受け取った途中の中身（世代の混ざり・数の食い違い。0 回が目標）、
//   PARTIAL（読み直しを求める応答）の回数、鍵の待ち（probe の時間）、結果の種類の内訳。
import fs from 'node:fs';
import os from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { OWNED_FIELDS } from '../web/js/core/owned-shared.js';

const MODES = { normal: 30000, load: 15000 };
// 3 ワールドの体数（計 4600 行）
const WORLD_SIZES = [2000, 1600, 1000];
const TICK_BASE = 638650000000000000n;

export function readEnvFile(file = '.env.local') {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .map((line) => line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]));
}

export function parseArgs(argv) {
  const options = { mode: 'normal', rounds: 6, readers: 3, probe: true };
  for (const arg of argv) {
    const [name, value] = arg.replace(/^--/, '').split('=');
    if (name === 'mode' && MODES[value]) options.mode = value;
    else if (name === 'rounds' && Number.isInteger(Number(value)) && Number(value) > 0) options.rounds = Number(value);
    else if (name === 'readers' && Number.isInteger(Number(value)) && Number(value) >= 0) options.readers = Number(value);
    else if (name === 'no-probe') options.probe = false;
    else if (name === 'rehearsal' && REHEARSAL_STEPS.includes(value)) options.rehearsal = value;
    else if (name === 'world' && /^[0-9A-Fa-f]{32}$/.test(value ?? '')) options.worldId = value.toUpperCase();
    else throw new Error(`知らない引数です: ${arg}`);
  }
  return options;
}

// 巻き戻しのリハーサル（docs/OPERATIONS.md）の手順: prepare（新しい版）→ legacy-write（古い版に戻した間）→ finish（新しい版に戻した後）
const REHEARSAL_STEPS = ['prepare', 'legacy-write', 'finish'];

const randomWorldId = () => randomBytes(16).toString('hex').toUpperCase();

// 世代 gen の行（個体 ID と値に世代を入れ、読み手が中身の一致を確かめられるようにする）
export function benchRows(worldIndex, gen, count) {
  return Array.from({ length: count }, (_, i) => OWNED_FIELDS.map((field) => ({
    instanceId: `bench-${worldIndex}-${gen}-${i}`, palId: 'SheepBall', palName: 'モコロン', characterId: 'SheepBall',
    nickname: `g${gen}`, gender: i % 2 ? 'M' : 'F', level: String(1 + (gen % 50)), rank: '1', stars: '0', place: 'palbox',
  })[field] ?? ''));
}

/** 読んだ中身が 1 つの世代だけで、数も合っているか。{ ok, gen, reason } */
export function checkContent(world, rows, expectedCount) {
  if (!world) return { ok: true, gen: null };
  const gen = Number(/bench g(\d+)$/.exec(world.worldName ?? '')?.[1]);
  const at = OWNED_FIELDS.indexOf('nickname');
  if (!Number.isInteger(gen)) return { ok: false, reason: 'ワールドの名前に世代がない' };
  if (rows.length !== world.palCount || rows.length !== expectedCount) return { ok: false, gen, reason: `数 ${rows.length}／palCount ${world.palCount}／期待 ${expectedCount}` };
  const mixed = rows.find((row) => row[at] !== `g${gen}` || !String(row[0]).includes(`-${gen}-`));
  if (mixed) return { ok: false, gen, reason: `世代 ${gen} に別の行（${mixed[0]}）` };
  return { ok: true, gen };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

export function summarize(stats) {
  const lines = [];
  for (const [action, item] of Object.entries(stats.ops)) {
    const sorted = [...item.times].sort((a, b) => a - b);
    const total = item.times.length + item.failures.length;
    const codes = item.failures.reduce((acc, code) => ({ ...acc, [code]: (acc[code] ?? 0) + 1 }), {});
    lines.push(`${action.padEnd(12)} ${String(total).padStart(4)} 回  中央値 ${percentile(sorted, 50)}ms  95% ${percentile(sorted, 95)}ms  最大 ${sorted[sorted.length - 1] ?? 0}ms  失敗 ${item.failures.length}（${(total ? (item.failures.length / total) * 100 : 0).toFixed(1)}%）${Object.keys(codes).length ? ` ${JSON.stringify(codes)}` : ''}`);
  }
  lines.push(`途中の中身 ${stats.torn.length} 回${stats.torn.length ? `: ${stats.torn.slice(0, 5).join(' / ')}` : ''}`);
  lines.push(`PARTIAL ${stats.partial} 回・結果の種類 ${JSON.stringify(stats.results)}・cleanup の失敗 ${stats.cleanupFailed} 回`);
  return lines.join('\n');
}

class Fatal extends Error {}

const newStats = () => ({ ops: {}, torn: [], partial: 0, results: {}, cleanupFailed: 0 });

// 1 回の呼び出し（時間と失敗を stats に残す）。テスト環境以外の応答を受けたら Fatal を投げ、それ以後の呼び出しは送らずに
// Fatal を投げる（並べて動かしている書き手・読み手・後片付けも、その場で止まる）
function createCaller({ url, passcode, fetcher, now, stats }) {
  let halted = '';
  return async function call(action, fields = {}) {
    if (halted) throw new Fatal(halted);
    const started = now();
    const op = (stats.ops[action] ??= { times: [], failures: [] });
    let json;
    try {
      const response = await fetcher(url, { method: 'POST', body: JSON.stringify({ ...fields, action, passcode }), redirect: 'follow' });
      json = JSON.parse(await response.text());
    } catch (error) {
      op.failures.push('NETWORK');
      return { ok: false, code: 'NETWORK', message: String(error?.message ?? error) };
    }
    if (json.ok && json.env !== 'test') {
      halted = `テスト環境以外の応答を受けたため止めます（action=${action} env=${json.env}）`;
      throw new Fatal(halted);
    }
    if (json.ok) op.times.push(now() - started);
    else op.failures.push(json.code ?? 'UNKNOWN');
    if (json.code === 'PARTIAL') stats.partial++;
    return json;
  };
}

const missingSetup = (url, passcode) => (!url ? 'PAL_API_URL（テスト用の deployment の /exec URL）がありません'
  : !passcode ? '.env.local に PAL_TEST_PASSCODE がありません' : '');

/**
 * 計測の本体。fetch・sleep・log を差し替えられる（テスト）。終わったら { ok, stats, worldIds, cleaned } を返す。
 * 書き込みの前の確かめで止めたときは { ok: false, reason } で、書き込みの操作は 1 回も送らない
 */
export async function runBench({
  url, passcode, mode = 'normal', rounds = 6, readers = 3, probe = true,
  fetch: fetcher = globalThis.fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), log = console.log, now = Date.now,
  interval = MODES[mode], sizes = WORLD_SIZES, signal = { stopped: false },
} = {}) {
  const missing = missingSetup(url, passcode);
  if (missing) return { ok: false, reason: missing };
  const stats = newStats();
  const call = createCaller({ url, passcode, fetcher, now, stats });

  // 書き込みの前の確かめ（読み取りだけ）
  const first = await call('ownedWorlds').catch((error) => ({ ok: false, code: error.message }));
  if (!first.ok) return { ok: false, reason: `テスト環境だと確かめられませんでした（${first.code}）。何も書いていません` };
  const worldIds = sizes.map(() => randomWorldId());
  if (first.worlds.some((world) => worldIds.includes(world.worldId))) return { ok: false, reason: 'ランダムな worldId が既にありました。何も書いていません' };
  const since = await call('ownedSince', { worldId: worldIds[0], uploadedAt: '' }).catch((error) => ({ ok: false, code: error.message }));
  if (!since.ok) return { ok: false, reason: `ownedSince がありません（${since.code}。新しい版の deployment ではない）。何も書いていません` };

  const generation = worldIds.map(() => 0);
  const lastRequest = worldIds.map(() => null);
  const userId = 'owned-bench';
  const upload = async (index, gen, { resend = false } = {}) => {
    const request = resend && lastRequest[index] ? lastRequest[index] : {
      userId, worldId: worldIds[index], saveUpdatedAt: new Date(now()).toISOString(),
      world: {
        name: `bench g${gen}`, hostName: 'bench', saveStamp: String(TICK_BASE + BigInt(gen)), contentHash: randomBytes(32).toString('hex'),
        format: 1, fileCount: 6, missingCount: 0,
      },
      players: [], bases: [], columns: OWNED_FIELDS, rows: benchRows(index, gen, sizes[index]),
    };
    lastRequest[index] = request;
    const result = await call('ownedUpload', request);
    if (result.ok) {
      stats.results[result.result ?? 'stored'] = (stats.results[result.result ?? 'stored'] ?? 0) + 1;
      if (result.cleanup === false) stats.cleanupFailed++;
      if (!resend && result.stored) generation[index] = gen;
    }
    return result;
  };

  let cleaned = false;
  let fatal = null;
  try {
    // 最初の世代を入れる（計約 4600 行）
    for (let i = 0; i < worldIds.length; i++) await upload(i, 1);
    log(`${worldIds.length} ワールド（${sizes.join('・')} 体）を入れました。${mode}（${interval / 1000} 秒ごと）を ${rounds} 回`);
    let running = true;
    const writers = worldIds.map(async (_, index) => {
      for (let round = 2; round <= rounds + 1 && !signal.stopped; round++) {
        await sleep(interval);
        await upload(index, round);
        // 3 回に 1 回は同じ要求を送り直す（応答を失った後の再送。unchanged が返るはず）
        if (round % 3 === 0) await upload(index, round, { resend: true });
      }
    });
    const reader = async (n) => {
      const pageId = `bench-page-${randomUUID().slice(0, 8)}`;
      const known = new Map();
      while (running && !signal.stopped) {
        const index = Math.floor(Math.random() * worldIds.length);
        const worldId = worldIds[index];
        const response = await call('ownedSince', {
          worldId, uploadedAt: known.get(worldId) ?? '',
          presence: { pageId, device: `bench-device-${n}`, user: 'owned-bench', role: 'guest', playing: false, canShare: false },
        });
        if (response.ok && response.changed) {
          const check = checkContent(response.world, response.rows, sizes[index]);
          if (!check.ok) stats.torn.push(`${worldId.slice(0, 6)} ${check.reason}`);
          else if (response.world) known.set(worldId, response.world.uploadedAt);
        }
        // 古い画面の読み方（一覧 → 中身）も混ぜる
        if (Math.random() < 0.3) {
          const owned = await call('owned', { worldId });
          if (owned.ok) {
            const check = checkContent(owned.world, owned.rows, sizes[index]);
            if (!check.ok) stats.torn.push(`${worldId.slice(0, 6)} ${check.reason}`);
          }
        }
        await sleep(2000 + Math.floor(Math.random() * 3000));
      }
    };
    const prober = async () => {
      while (running && !signal.stopped) {
        await call('probe', { text: 'owned-bench', tag: 'owned-bench' });
        await sleep(5000);
      }
    };
    // 読み手の結果はすぐに受け取っておく（書き手を待つ間に読み手が Fatal で止まっても、処理されない拒否にしない）
    const othersSettled = Promise.allSettled([...Array.from({ length: readers }, (_, n) => reader(n)), ...(probe ? [prober()] : [])]);
    // 全部の書き手が終わってから読み手を止め、全部が止まるのを待つ（1 つが Fatal で止まっても、他は次の呼び出しで止まる）
    const settled = await Promise.allSettled(writers);
    running = false;
    const stopped = await othersSettled;
    const failure = [...settled, ...stopped].find((item) => item.status === 'rejected');
    if (failure) throw failure.reason;
    // 最後の世代を読んで、全部のワールドが最後に書いた世代か
    for (let i = 0; i < worldIds.length; i++) {
      const owned = await call('owned', { worldId: worldIds[i] });
      const check = owned.ok ? checkContent(owned.world, owned.rows, sizes[i]) : { ok: false, reason: owned.code };
      if (!check.ok || check.gen !== generation[i]) stats.torn.push(`最後の読み ${worldIds[i].slice(0, 6)} ${check.reason ?? `世代 ${check.gen}≠${generation[i]}`}`);
    }
  } catch (error) {
    if (error instanceof Fatal) fatal = error.message;
    else throw error;
  } finally {
    // 自分の worldId だけを消す（テスト環境以外の応答を受けた後は、何も送らない）
    if (!fatal) {
      cleaned = true;
      cleanup: for (const worldId of worldIds) {
        let done = false;
        for (let attempt = 0; attempt < 3 && !done; attempt++) {
          let removed;
          try {
            removed = await call('ownedDelete', { worldId });
          } catch (error) {
            if (!(error instanceof Fatal)) throw error;
            fatal = error.message;
            cleaned = false;
            break cleanup;
          }
          done = removed.ok === true;
          if (!done) await sleep(3000);
        }
        if (!done) {
          cleaned = false;
          log(`後片付けに失敗: ${worldId}（テスト用のシートに残っています）`);
        }
      }
    }
  }
  if (fatal) return { ok: false, reason: fatal, stats, worldIds, cleaned };
  log(summarize(stats));
  return { ok: stats.torn.length === 0, stats, worldIds, cleaned };
}

// リハーサルの記録（prepare が作った worldId と接続先。この PC の一時フォルダに置き、リポジトリには入れない）
export const REHEARSAL_RECORD = path.join(os.tmpdir(), 'pal-owned-bench-rehearsal.json');

function readRecord(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

/**
 * 巻き戻しのリハーサル（テスト用の deployment で、版を切り替えながら 3 回に分けて流す）。触るのは、この PC の prepare が作り、
 * 記録（REHEARSAL_RECORD）に残したワールドだけ（接続先も同じとき。名前 bench g〈数〉・共有した人 owned-bench も確かめる）。
 * - prepare: 新しい版で、識別つきの 2 世代のワールドを 1 つ作り、worldId を出す（消さない）
 * - legacy-write --world=ID: 古い版に戻して compactOwnedTest() を実行した後。今の世代だけが読めること（2 世代が重ならない）を確かめ、
 *   体数を 3 倍にした識別のない次の世代を書いて読み直す（古い版の画面の共有と同じ形。圧縮の後に行数が足りるか）
 * - finish --world=ID: resumeOwnedTest() → 新しい版に戻した後。識別つきの次の世代が書けて読めること・ownedSince を確かめ、ワールドを消す
 */
export async function runRehearsal({
  step, worldId, url, passcode, fetch: fetcher = globalThis.fetch, log = console.log, now = Date.now, size = 100, recordFile = REHEARSAL_RECORD,
} = {}) {
  const missing = missingSetup(url, passcode);
  if (missing) return { ok: false, reason: missing };
  if (!REHEARSAL_STEPS.includes(step)) return { ok: false, reason: `--rehearsal は ${REHEARSAL_STEPS.join('・')} のどれか` };
  if (step !== 'prepare' && !worldId) return { ok: false, reason: '--world=<prepare で出た worldId> がありません' };
  if (step !== 'prepare') {
    const record = readRecord(recordFile);
    if (!record || record.worldId !== worldId || record.url !== url) {
      return { ok: false, reason: `この PC の prepare が作ったワールド（記録 ${recordFile}）と違います。何も書いていません` };
    }
  }
  const stats = newStats();
  const call = createCaller({ url, passcode, fetcher, now, stats });
  const upload = (id, gen, withIdentity, count = size) => call('ownedUpload', {
    userId: 'owned-bench', worldId: id, saveUpdatedAt: new Date(now()).toISOString(),
    world: {
      name: `bench g${gen}`, hostName: 'bench',
      ...(withIdentity ? { saveStamp: String(TICK_BASE + BigInt(gen)), contentHash: randomBytes(32).toString('hex'), format: 1, fileCount: 6, missingCount: 0 } : {}),
    },
    players: [], bases: [], columns: OWNED_FIELDS, rows: benchRows(0, gen, count),
  });
  const readBack = async (id, gen, count = size) => {
    const owned = await call('owned', { worldId: id });
    if (!owned.ok) return `読めません（${owned.code}）`;
    const check = checkContent(owned.world, owned.rows, count);
    if (!check.ok) return `中身が合いません（${check.reason}）`;
    return gen === undefined || check.gen === gen ? '' : `世代が ${check.gen}（期待 ${gen}）`;
  };
  try {
    const first = await call('ownedWorlds');
    if (!first.ok) return { ok: false, reason: `テスト環境だと確かめられませんでした（${first.code}）。何も書いていません` };
    if (step === 'prepare') {
      const since = await call('ownedSince', { worldId: randomWorldId(), uploadedAt: '' });
      if (!since.ok) return { ok: false, reason: `ownedSince がありません（${since.code}。新しい版の deployment ではない）。何も書いていません` };
      const id = randomWorldId();
      fs.writeFileSync(recordFile, JSON.stringify({ url, worldId: id, at: new Date(now()).toISOString() }), 'utf8');
      for (const gen of [1, 2]) {
        const result = await upload(id, gen, true);
        if (!result.ok || !result.stored) return { ok: false, reason: `書けませんでした（${result.code ?? result.result}）`, worldId: id };
      }
      const problem = await readBack(id, 2);
      if (problem) return { ok: false, reason: problem, worldId: id };
      log(`prepare: worldId ${id}（2 世代・識別あり）。次は古い版に戻し、GAS の編集画面で compactOwnedTest() を実行してから --rehearsal=legacy-write --world=${id}`);
      return { ok: true, worldId: id };
    }
    const current = first.worlds.find((world) => world.worldId === worldId);
    const gen = Number(/^bench g(\d+)$/.exec(current?.worldName ?? '')?.[1]);
    if (!current || !Number.isInteger(gen) || current.uploadedBy !== 'owned-bench' || current.hostName !== 'bench') {
      return { ok: false, reason: `ベンチが作ったワールド（${worldId}）が共有にありません。何も書いていません` };
    }
    if (step === 'legacy-write') {
      // compactOwnedTest() の後の古い版は worldId の全部の行を読むので、2 世代が残っていれば数が食い違う
      const before = await readBack(worldId, gen, current.palCount);
      if (before) return { ok: false, reason: `compact の後の読み込み: ${before}`, worldId };
      // 体数を増やして書く（古い版は行数を足さずに書くので、圧縮の後に行数の余裕が残っているか）
      const grown = current.palCount * 3;
      const result = await upload(worldId, gen + 1, false, grown);
      if (!result.ok || !result.stored) return { ok: false, reason: `古い版で書けませんでした（${result.code ?? result.reason}）`, worldId };
      const after = await readBack(worldId, gen + 1, grown);
      if (after) return { ok: false, reason: `古い版の書き込みの後: ${after}`, worldId };
      log(`legacy-write: 古い版で世代 ${gen + 1} を書いて読めました。次は resumeOwnedTest() → 新しい版に戻してから --rehearsal=finish --world=${worldId}`);
      return { ok: true, worldId };
    }
    const result = await upload(worldId, gen + 1, true);
    if (!result.ok) {
      return { ok: false, reason: result.code === 'BUSY' ? '停止の印が立っています（GAS の編集画面で resumeOwnedTest() を先に）' : `書けませんでした（${result.code}）`, worldId };
    }
    if (!result.stored || result.result !== 'newer') return { ok: false, reason: `結果が newer ではありません（${result.result}）`, worldId };
    const problem = await readBack(worldId, gen + 1);
    if (problem) return { ok: false, reason: problem, worldId };
    const since = await call('ownedSince', { worldId, uploadedAt: result.world.uploadedAt });
    if (!since.ok || since.changed !== false) return { ok: false, reason: `ownedSince が「変わらない」を返しません（${since.code ?? since.changed}）`, worldId };
    const removed = await call('ownedDelete', { worldId });
    if (!removed.ok || !removed.deleted) return { ok: false, reason: `後片付けに失敗（${removed.code}）`, worldId };
    fs.rmSync(recordFile, { force: true });
    log('finish: 新しい版で書けて読め、ワールドを消しました。リハーサルは終わりです');
    return { ok: true, worldId };
  } catch (error) {
    if (error instanceof Fatal) return { ok: false, reason: error.message, worldId };
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (options.rehearsal) {
    const result = await runRehearsal({ step: options.rehearsal, worldId: options.worldId, url: process.env.PAL_API_URL, passcode: readEnvFile().PAL_TEST_PASSCODE });
    if (!result.ok) console.error(result.reason);
    process.exit(result.ok ? 0 : 1);
  }
  const signal = { stopped: false };
  // Ctrl+C では書き込みを止め、後片付け（自分の worldId の削除）をしてから終わる
  process.once('SIGINT', () => {
    signal.stopped = true;
    console.log('止めています（後片付けをしてから終わります）…');
  });
  const result = await runBench({ ...options, signal, url: process.env.PAL_API_URL, passcode: readEnvFile().PAL_TEST_PASSCODE });
  if (result.reason) console.error(result.reason);
  process.exit(result.ok && result.cleaned !== false ? 0 : 1);
}
