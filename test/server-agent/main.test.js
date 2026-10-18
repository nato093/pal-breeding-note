// 常駐の入口（tools/server-agent/main.mjs）: 引数・終了コード・二重起動の防止・--check・--check --online・--dry-run --once・--once --force-host・
// --signup。一時フォルダの ServerSync の形と開発用 API（dev/mock-api.js）で動かす。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { acquireLock, main } from '../../tools/server-agent/main.mjs';
import { W, INSTANCE, PASS, U1, U2, snapshotOf, serverWorld, gasOf } from '../helpers/server-agent.js';

// 世界の名前・プレイヤーの名前（出力に出ないことを確かめる）
const WORLD_NAME = 'ダミーのワールド名';
const NAMES = ['仲間', '参加者2'];

function output() {
  const lines = [];
  return { lines, stream: { write: (line) => lines.push(String(line)) }, text: () => lines.join('') };
}

function stoppedServer() {
  return () => ({ check: async () => ({ state: 'stopped', active: false, source: 'serversync', pid: null, serverState: 'Stopped', stoppedFor: null, reasons: [] }) });
}

// main を一時フォルダの ServerSync の形で動かす（env は LOCALAPPDATA・データの場所・ID・パスワード）
async function run(site, argv, { gas = null, env = {}, deps = {} } = {}) {
  const stdout = output();
  const stderr = output();
  const code = await main({
    argv, stdout: stdout.stream, stderr: stderr.stream,
    env: { LOCALAPPDATA: site.local, PAL_AGENT_DATA_DIR: site.dataDir, PAL_AGENT_USER_ID: 'サーバー', PAL_AGENT_PASSCODE: PASS, ...env },
    deps: {
      createMonitor: stoppedServer(), runImport: async () => snapshotOf({ seconds: 0, minutes: 100, day: 680, players: [U1, U2], name: WORLD_NAME, pals: 3 }),
      ...(gas ? { transport: gas.transport } : {}), ...deps,
    },
  });
  return { code, out: stdout.text(), err: stderr.text() };
}

const envDir = (site) => path.join(site.dataDir, 'test');

test('常駐の入口: 引数の誤り・組み合わせの誤り・ID とパスワードがないときは終了コード 2', async (t) => {
  const site = serverWorld(t);
  assert.equal((await run(site, ['--bogus'])).code, 2);
  const dry = await run(site, ['--dry-run']);
  assert.equal(dry.code, 2);
  assert.match(dry.out, /--dry-run は --once と一緒に使います/);
  assert.equal((await run(site, ['--online'])).code, 2);
  assert.equal((await run(site, ['--force-host'])).code, 2);
  assert.equal((await run(site, ['--check', '--once'])).code, 2);
  const missing = await run(site, ['--once'], { env: { PAL_AGENT_PASSCODE: '' } });
  assert.equal(missing.code, 2);
  assert.match(missing.out, /パスワード/);
  // prod は config.json に env: prod があるときだけ（--force-host は test だけ）
  assert.equal((await run(site, ['--env', 'prod', '--once'])).code, 2);
  // ワールドが見つからない
  assert.equal((await run(site, ['--check'], { env: { LOCALAPPDATA: path.join(site.root, 'nowhere') } })).code, 2);
  assert.ok(!fs.existsSync(path.join(envDir(site), 'agent.lock')));
});

test('常駐の入口: 二重起動の防止（agent.lock に pid。生きていれば終了コード 3、落ちた常駐の残りは取り直す）', async (t) => {
  const site = serverWorld(t);
  const file = path.join(envDir(site), 'agent.lock');
  const first = acquireLock(file, { pid: 101, alive: () => true });
  assert.equal(first.ok, true);
  assert.equal(fs.readFileSync(file, 'utf8'), '101');
  assert.deepEqual(acquireLock(file, { pid: 202, alive: (pid) => pid === 101 }), { ok: false, pid: 101 });
  // 101 が落ちた（生きていない）: 202 が取り直す。101 の release は 202 の印を消さない
  const second = acquireLock(file, { pid: 202, alive: () => false });
  assert.equal(second.ok, true);
  first.release();
  assert.equal(fs.readFileSync(file, 'utf8'), '202');
  second.release();
  assert.equal(fs.existsSync(file), false);

  // 動いている常駐がある: --once は 3。--accept-world は要求のファイルで伝えて 0
  fs.mkdirSync(envDir(site), { recursive: true });
  fs.writeFileSync(file, '424242');
  const gas = await gasOf();
  const busy = await run(site, ['--once'], { gas, deps: { alive: (pid) => pid === 424242 } });
  assert.equal(busy.code, 3);
  assert.deepEqual(gas.control.calls, []);
  const accept = await run(site, ['--accept-world'], { gas, deps: { alive: (pid) => pid === 424242 } });
  assert.equal(accept.code, 0);
  assert.ok(fs.existsSync(path.join(envDir(site), 'accept.request')));
  assert.equal(fs.readFileSync(file, 'utf8'), '424242');
});

test('常駐の入口: --check はネットにつながず、発見と解析の要約だけを出す（名前・ID・パスは出さない。何も書かない）', async (t) => {
  const site = serverWorld(t, { players: [U1, U2] });
  const gas = await gasOf();
  const result = await run(site, ['--check'], { gas });
  assert.equal(result.code, 0);
  assert.match(result.out, /world source="serversync" place="[^"]*…" serverSync=true/);
  assert.match(result.out, /check-files files=6 players=2/);
  assert.match(result.out, /check-save pals=3 players=2 online=2 farms=1 eggs=0 day=680 clock=true stamp=true skipped=0/);
  assert.match(result.out, /check-server state="stopped"/);
  assert.match(result.out, /check-lineage blocked=false accepted=false/);
  for (const secret of [W, W.slice(0, 8), INSTANCE, INSTANCE.slice(0, 4), U1, U1.slice(0, 8), WORLD_NAME, ...NAMES, PASS, site.root]) {
    assert.ok(!result.out.includes(secret) && !result.err.includes(secret), `出さない: ${secret.slice(0, 4)}`);
  }
  assert.deepEqual(gas.control.calls, []);
  assert.equal(fs.existsSync(site.dataDir), false);
});

test('常駐の入口: --check --online はログインと ownedWorlds の読み取りだけ（書かない）', async (t) => {
  const site = serverWorld(t);
  const gas = await gasOf();
  const result = await run(site, ['--check', '--online'], { gas });
  assert.equal(result.code, 0);
  assert.deepEqual(gas.control.calls, ['login', 'ownedWorlds']);
  assert.match(result.out, /check-login env="test"/);
  assert.match(result.out, /check-published published=false/);
  assert.ok(!result.out.includes(PASS));
  assert.equal(fs.existsSync(site.dataDir), false);
  // 応答の環境が違えば 2
  gas.control.env = 'prod';
  assert.equal((await run(site, ['--check', '--online'], { gas })).code, 2);
});

test('常駐の入口: --dry-run --once は送る中身を組み立てるが送らない（ownedUpload・presence を記録して要約。KV・ログ・ロックも書かない）', async (t) => {
  const site = serverWorld(t, { players: [U1, U2] });
  const gas = await gasOf();
  const result = await run(site, ['--dry-run', '--once'], { gas });
  assert.equal(result.code, 0);
  assert.deepEqual(gas.writes(), []);
  assert.ok(gas.control.calls.includes('login'));
  assert.match(result.out, /dry-run counts=\{"ownedUpload":1,"presence":1\} chars=\d+ limit=4194304 refused=false pals=3 players=2 farms=1 day=680/);
  assert.match(result.out, /dry-run-presence role="host" playing=false canShare=true resident=true/);
  for (const secret of [WORLD_NAME, ...NAMES, PASS]) assert.ok(!result.out.includes(secret));
  assert.equal(fs.existsSync(site.dataDir), false);
});

test('常駐の入口: --once --force-host（test だけ）はサーバーが止まっていても今のセーブを 1 回読んで送り、presence を 1 回送って終わる', async (t) => {
  const site = serverWorld(t, { players: [U1, U2] });
  const gas = await gasOf();
  const result = await run(site, ['--once', '--force-host'], { gas });
  assert.equal(result.code, 0);
  assert.deepEqual(gas.writes().map((item) => item.action), ['ownedUpload', 'presence']);
  const presence = gas.writes('presence')[0].request.presence;
  assert.deepEqual([presence.role, presence.resident, presence.canShare], ['host', true, true]);
  assert.equal(fs.existsSync(path.join(envDir(site), 'agent.lock')), false);
  const saved = fs.readFileSync(path.join(envDir(site), 'state.json'), 'utf8');
  assert.ok(!saved.includes(PASS));
  assert.ok(!fs.readFileSync(path.join(envDir(site), 'agent.log'), 'utf8').includes(PASS));
  // サーバーが止まっていて --force-host がなければ読まない（presence だけ）
  const plain = await run(site, ['--once'], { gas });
  assert.equal(plain.code, 0);
  assert.deepEqual(gas.writes().map((item) => item.action), ['ownedUpload', 'presence', 'presence']);
  assert.match(plain.out, /once-skipped/);
});

test('常駐の入口: 応答の env が設定と違えば、何も書かずに終了コード 2（KV を作らず、ロックも残さない）', async (t) => {
  const site = serverWorld(t);
  const gas = await gasOf();
  gas.control.env = 'prod';
  const result = await run(site, ['--once', '--force-host'], { gas });
  assert.equal(result.code, 2);
  assert.deepEqual(gas.writes(), []);
  assert.match(result.out, /env-mismatch expected="test" got="prod"/);
  assert.equal(fs.existsSync(path.join(envDir(site), 'state.json')), false);
  assert.equal(fs.existsSync(path.join(envDir(site), 'agent.lock')), false);
});

test('常駐の入口: --signup は先に応答の環境を確かめてから ID を作る（すでにあれば 0、環境が違えば作らずに 2）', async (t) => {
  const site = serverWorld(t);
  const gas = await gasOf();
  const created = await run(site, ['--signup'], { gas, env: { PAL_AGENT_USER_ID: '常駐2' } });
  assert.equal(created.code, 0);
  assert.deepEqual(gas.control.calls, ['ownedWorlds', 'signup']);
  assert.equal((await run(site, ['--signup'], { gas, env: { PAL_AGENT_USER_ID: '常駐2' } })).code, 0);
  gas.control.calls.length = 0;
  gas.control.env = 'prod';
  assert.equal((await run(site, ['--signup'], { gas, env: { PAL_AGENT_USER_ID: '常駐3' } })).code, 2);
  assert.deepEqual(gas.control.calls, ['ownedWorlds']);
});
