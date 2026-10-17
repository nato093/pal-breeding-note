// scripts/owned-bench.mjs（所持パルの共有の計測）の形だけを、偽の fetch で確かめる（本物の GAS には送らない）。
// 偽の fetch の先は、GAS のコードを読み込んだハーネス（test/gas/harness.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBench, runRehearsal, parseArgs, checkContent, benchRows } from '../../scripts/owned-bench.mjs';
import { legacyGasFiles } from '../gas/legacy.js';
import { createGas } from '../gas/harness.js';
import { OWNED_FIELDS } from '../../web/js/core/owned-shared.js';

const PROPS = { PASSCODE: 'AAAA-BBBB-CCCC-DDDD', TEST_PASSCODE: 'EEEE-FFFF-GGGG-HHHH' };
const OTHER = 'ABCDEF0123456789ABCDEF0123456789';
const quiet = () => {};
const yieldNow = () => new Promise((resolve) => setImmediate(resolve));

// rewrite(body, response) は GAS が処理した後の応答を差し替える（応答を失った形）。before(body) が値を返せば、GAS に渡さずにそれを返す
function harness({ rewrite, before } = {}) {
  const env = createGas({ properties: PROPS });
  env.gas.setup();
  const actions = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    actions.push(body.action);
    const early = before?.(body);
    if (early) return { text: async () => JSON.stringify(early) };
    let response = JSON.parse(JSON.stringify(env.gas.handleRequest_(init.body)));
    if (rewrite) response = rewrite(body, response) ?? response;
    return { text: async () => JSON.stringify(response) };
  };
  return { env, actions, fetch };
}

test('owned-bench: 引数の読み方', () => {
  assert.deepEqual(parseArgs([]), { mode: 'normal', rounds: 6, readers: 3, probe: true });
  assert.deepEqual(parseArgs(['--mode=load', '--rounds=2', '--readers=0', '--no-probe']), { mode: 'load', rounds: 2, readers: 0, probe: false });
  assert.throws(() => parseArgs(['--mode=fast']), /知らない引数/);
});

test('owned-bench: URL・パスワードがなければ何も送らない', async () => {
  let sent = 0;
  const fetch = async () => { sent++; return { text: async () => '{}' }; };
  assert.match((await runBench({ passcode: 'x', fetch, log: quiet })).reason, /PAL_API_URL/);
  assert.match((await runBench({ url: 'https://example.invalid', fetch, log: quiet })).reason, /PAL_TEST_PASSCODE/);
  assert.equal(sent, 0);
});

test('owned-bench: テスト環境でない・新しい版でない応答なら、書き込みの操作を 1 回も送らずに止める', async () => {
  const prod = harness({ rewrite: (body, response) => ({ ...response, env: 'prod' }) });
  const stopped = await runBench({ url: 'u', passcode: PROPS.TEST_PASSCODE, fetch: prod.fetch, log: quiet });
  assert.match(stopped.reason, /テスト環境/);
  assert.deepEqual(prod.actions, ['ownedWorlds']);
  const old = harness({ rewrite: (body) => (body.action === 'ownedSince' ? { ok: false, code: 'BAD_ACTION' } : undefined) });
  const legacy = await runBench({ url: 'u', passcode: PROPS.TEST_PASSCODE, fetch: old.fetch, log: quiet });
  assert.match(legacy.reason, /ownedSince/);
  assert.deepEqual(old.actions, ['ownedWorlds', 'ownedSince']);
});

test('owned-bench: 世代を書いて読み手が中身を確かめ、終わったら自分の worldId だけを消す（他のワールドは残す）', async () => {
  const { env, actions, fetch } = harness();
  // 他の人のワールド（ベンチは触らない）
  const other = env.gas.handleRequest_(JSON.stringify({
    action: 'ownedUpload', passcode: PROPS.TEST_PASSCODE, userId: '仲間', worldId: OTHER, world: { name: '仲間のワールド' },
    saveUpdatedAt: '2026-10-05T10:00:00.000Z', players: [], bases: [], columns: OWNED_FIELDS, rows: benchRows(9, 1, 2),
  }));
  assert.equal(other.stored, true);
  const result = await runBench({ url: 'u', passcode: PROPS.TEST_PASSCODE, fetch, log: quiet, rounds: 2, readers: 1, interval: 0, sizes: [5, 4, 3], sleep: yieldNow });
  assert.equal(result.ok, true, JSON.stringify(result.stats?.torn));
  assert.equal(result.cleaned, true);
  assert.deepEqual(result.stats.torn, []);
  assert.deepEqual(result.stats.results, { new: 3, newer: 6, unchanged: 3 });
  for (const action of ['ownedUpload', 'ownedSince', 'probe', 'ownedDelete']) assert.ok(actions.includes(action), action);
  const worlds = JSON.parse(JSON.stringify(env.gas.handleRequest_(JSON.stringify({ action: 'ownedWorlds', passcode: PROPS.TEST_PASSCODE })))).worlds;
  assert.deepEqual(worlds.map((world) => world.worldId), [OTHER]);
  const pals = env.spreadsheet.getSheetByName('OwnedPals_test');
  assert.equal(pals.getLastRow(), 1 + 2);
});

test('owned-bench: 途中でテスト環境以外の応答を受けたら止め、その後は何も送らない', async () => {
  let switched = false;
  const { actions, fetch } = harness({ rewrite: (body, response) => {
    if (body.action === 'ownedUpload') switched = true;
    return switched ? { ...response, env: 'prod' } : undefined;
  } });
  const result = await runBench({ url: 'u', passcode: PROPS.TEST_PASSCODE, fetch, log: quiet, rounds: 1, readers: 0, probe: false, interval: 0, sizes: [2, 2, 2], sleep: yieldNow });
  assert.equal(result.ok, false);
  assert.match(result.reason, /テスト環境以外/);
  assert.deepEqual(actions, ['ownedWorlds', 'ownedSince', 'ownedUpload']);
  // 並べて動かしている書き手・読み手があっても、テスト環境以外の応答の後は何も送らない（後片付けも）
  let uploads = 0;
  let at = -1;
  const parallel = harness({ rewrite: (body, response) => {
    if (body.action === 'ownedUpload' && ++uploads === 4) at = parallel.actions.length;
    return at >= 0 ? { ...response, env: 'prod' } : undefined;
  } });
  const stopped = await runBench({ url: 'u', passcode: PROPS.TEST_PASSCODE, fetch: parallel.fetch, log: quiet, rounds: 3, readers: 2, interval: 0, sizes: [2, 2, 2], sleep: yieldNow });
  assert.equal(stopped.ok, false);
  assert.match(stopped.reason, /テスト環境以外/);
  assert.equal(stopped.cleaned, false);
  assert.equal(parallel.actions.length, at, JSON.stringify(parallel.actions.slice(at)));
  // 書き手が待っている間に読み手が先に止まっても（処理されない拒否にならず）同じく止まる
  let readerAt = -1;
  const early = harness({ rewrite: (body, response) => {
    if (body.action === 'ownedSince' && body.presence && readerAt < 0) readerAt = early.actions.length;
    return readerAt >= 0 ? { ...response, env: 'prod' } : undefined;
  } });
  const waitWriters = (ms) => (ms === 1 ? new Promise((resolve) => setTimeout(resolve, 50)) : yieldNow());
  const readerStopped = await runBench({ url: 'u', passcode: PROPS.TEST_PASSCODE, fetch: early.fetch, log: quiet, rounds: 2, readers: 1, probe: false, interval: 1, sizes: [2, 2, 2], sleep: waitWriters });
  assert.match(readerStopped.reason, /テスト環境以外/);
  assert.equal(early.actions.length, readerAt, JSON.stringify(early.actions.slice(readerAt)));
});

// GAS の doGet の応答（echo の URL が 302 で /exec への GET に戻したとき、doPost の応答の代わりに届く）
const DO_GET = { ok: true, service: 'pal-breeding-note', api: 1 };
const benchWorlds = (env) => JSON.parse(JSON.stringify(env.gas.handleRequest_(JSON.stringify({ action: 'ownedWorlds', passcode: PROPS.TEST_PASSCODE })))).worlds;

test('owned-bench: doGet の形の応答（env なし・service あり）は止めずに失敗（NO_ENV）として数え、読むだけの確かめは読み直し、応答を失った世代も最後の読みで認める', async () => {
  const seen = { ownedWorlds: 0, ownedUpload: 0, owned: 0 };
  const { env, actions, fetch } = harness({ rewrite: (body) => {
    const n = seen[body.action] === undefined ? 0 : ++seen[body.action];
    // 最初の一覧（書き込みの前の確かめ）・4 回目の共有（書けた後に応答を失う。その世代は最後に書いた世代）・最初の最後の読み
    if ((body.action === 'ownedWorlds' && n === 1) || (body.action === 'ownedUpload' && n === 4) || (body.action === 'owned' && n === 1)) return DO_GET;
    return undefined;
  } });
  const result = await runBench({ url: 'u', passcode: PROPS.TEST_PASSCODE, fetch, log: quiet, rounds: 1, readers: 0, probe: false, interval: 0, sizes: [2, 2, 2], sleep: yieldNow });
  assert.equal(result.ok, true, JSON.stringify(result.reason ?? result.stats?.torn));
  assert.equal(result.cleaned, true);
  assert.deepEqual(result.stats.torn, []);
  assert.deepEqual(actions.slice(0, 3), ['ownedWorlds', 'ownedWorlds', 'ownedSince']);
  for (const action of ['ownedWorlds', 'ownedUpload', 'owned']) assert.deepEqual(result.stats.ops[action].failures, ['NO_ENV'], action);
  assert.deepEqual(benchWorlds(env), []);
  // env も service もない ok の応答（形の分からない応答）は、今までどおりテスト環境以外の応答として止める
  const unknown = harness({ rewrite: (body, response) => (body.action === 'ownedUpload' ? { ok: true, api: 1, stored: true } : undefined) });
  const stopped = await runBench({ url: 'u', passcode: PROPS.TEST_PASSCODE, fetch: unknown.fetch, log: quiet, rounds: 1, readers: 0, probe: false, interval: 0, sizes: [2, 2, 2], sleep: yieldNow });
  assert.match(stopped.reason, /テスト環境以外/);
  assert.deepEqual(unknown.actions, ['ownedWorlds', 'ownedSince', 'ownedUpload']);
});

test('owned-bench: 送り直しで書けた世代も、最後の読みで載っている世代として扱う（前の送信が BUSY で書けなかったとき）', async () => {
  let uploads = 0;
  // 書き込みは 世代 1 → 世代 2 → 世代 3 → 世代 3 の送り直し（3 の倍数の回）。世代 3 の最初の送信だけ、書かずに BUSY を返す
  const { env, fetch } = harness({ before: (body) => (body.action === 'ownedUpload' && ++uploads === 3 ? { ok: false, code: 'BUSY' } : undefined) });
  const result = await runBench({ url: 'u', passcode: PROPS.TEST_PASSCODE, fetch, log: quiet, rounds: 2, readers: 0, probe: false, interval: 0, sizes: [2], sleep: yieldNow });
  assert.equal(result.ok, true, JSON.stringify(result.stats?.torn));
  assert.deepEqual(result.stats.torn, []);
  assert.deepEqual(result.stats.ops.ownedUpload.failures, ['BUSY']);
  assert.deepEqual(result.stats.results, { new: 1, newer: 2 });
  assert.deepEqual(benchWorlds(env), []);
});

test('owned-bench: 読んだ中身の確かめ（世代の混ざり・数の食い違い）', () => {
  const world = (gen, palCount) => ({ worldName: `bench g${gen}`, palCount });
  assert.deepEqual(checkContent(world(3, 2), benchRows(0, 3, 2), 2), { ok: true, gen: 3 });
  assert.equal(checkContent(world(3, 2), [...benchRows(0, 3, 1), ...benchRows(0, 2, 1)], 2).ok, false);
  assert.equal(checkContent(world(3, 3), benchRows(0, 3, 2), 3).ok, false);
  assert.equal(checkContent(null, [], 2).ok, true);
});

test('owned-bench のリハーサル: prepare（新しい版）→ compactOwnedTest・古い版の legacy-write → resumeOwnedTest・新しい版の finish', { skip: legacyGasFiles() ? false : 'Git の履歴に e984786 がない（浅い複製）' }, async () => {
  const next = createGas({ properties: PROPS });
  next.gas.setup();
  const previous = createGas({ files: legacyGasFiles(), spreadsheet: next.spreadsheet, props: next.props, cacheEntries: next.cache.entries });
  const fetchFrom = (env) => async (url, init) => ({ text: async () => JSON.stringify(env.gas.handleRequest_(init.body)) });
  const recordFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pal-bench-')), 'rehearsal.json');
  const options = { url: 'u', passcode: PROPS.TEST_PASSCODE, log: quiet, size: 5, recordFile };
  const prepared = await runRehearsal({ ...options, step: 'prepare', fetch: fetchFrom(next) });
  assert.equal(prepared.ok, true, prepared.reason);
  const worldId = prepared.worldId;
  // compactOwnedTest() の前の古い版では 2 世代が重なって読めるので、legacy-write は何も書かずに止まる
  const overlapped = await runRehearsal({ ...options, step: 'legacy-write', worldId, fetch: fetchFrom(previous) });
  assert.match(overlapped.reason, /compact の後の読み込み/);
  next.gas.compactOwnedTest();
  // 停止の印が立っている間の新しい版は書けない
  assert.match((await runRehearsal({ ...options, step: 'finish', worldId, fetch: fetchFrom(next) })).reason, /resumeOwnedTest/);
  const legacy = await runRehearsal({ ...options, step: 'legacy-write', worldId, fetch: fetchFrom(previous) });
  assert.equal(legacy.ok, true, legacy.reason);
  // 古い版で体数を 3 倍にして書けた
  assert.equal(JSON.parse(JSON.stringify(next.gas.handleRequest_(JSON.stringify({ action: 'ownedWorlds', passcode: PROPS.TEST_PASSCODE })))).worlds[0].palCount, 15);
  next.gas.resumeOwnedTest();
  const finished = await runRehearsal({ ...options, step: 'finish', worldId, fetch: fetchFrom(next) });
  assert.equal(finished.ok, true, finished.reason);
  assert.equal(next.spreadsheet.getSheetByName('OwnedPals_test').getLastRow(), 1);
  assert.equal(fs.existsSync(recordFile), false, '終わったら記録を消す');
  // この PC の prepare が作っていないワールドには触らない（同じ名前のワールドを他の人が作っていても）
  const lookalike = { action: 'ownedUpload', passcode: PROPS.TEST_PASSCODE, userId: '仲間', worldId: OTHER, world: { name: 'bench g5', hostName: 'bench' },
    saveUpdatedAt: '2026-10-05T10:00:00.000Z', players: [], bases: [], columns: OWNED_FIELDS, rows: benchRows(0, 5, 5) };
  next.gas.handleRequest_(JSON.stringify(lookalike));
  assert.match((await runRehearsal({ ...options, step: 'finish', worldId: OTHER, fetch: fetchFrom(next) })).reason, /prepare が作ったワールド/);
  // 記録が合っていても、共有した人が違えば触らない
  fs.writeFileSync(recordFile, JSON.stringify({ url: 'u', worldId: OTHER }));
  assert.match((await runRehearsal({ ...options, step: 'finish', worldId: OTHER, fetch: fetchFrom(next) })).reason, /ベンチが作ったワールド/);
  assert.equal(JSON.parse(JSON.stringify(next.gas.handleRequest_(JSON.stringify({ action: 'owned', passcode: PROPS.TEST_PASSCODE, worldId: OTHER })))).rows.length, 5);
  // 接続先が違えば触らない
  assert.match((await runRehearsal({ ...options, url: 'other', step: 'finish', worldId: OTHER, fetch: fetchFrom(next) })).reason, /prepare が作ったワールド/);
  fs.rmSync(path.dirname(recordFile), { recursive: true, force: true });
  assert.match((await runRehearsal({ ...options, step: 'other', fetch: fetchFrom(next) })).reason, /--rehearsal/);
});
