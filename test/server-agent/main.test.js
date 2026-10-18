// 常駐の入口（tools/server-agent/main.mjs）: 引数・終了コード・二重起動の防止・--check・--check --online・--dry-run --once・--once --force-host・
// --signup。一時フォルダの ServerSync の形と開発用 API（dev/mock-api.js）で動かす。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { acquireLock, lockPathOf, main } from '../../tools/server-agent/main.mjs';
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

// 別のプロセスでロックを取る（取れたら 'held'、取れなければ 'busy' を 1 行出し、kill されるまで待つ）
function holdInChild(lockPath) {
  const script = `
    import { acquireLock } from ${JSON.stringify(new URL('../../tools/server-agent/main.mjs', import.meta.url).href)};
    const lock = await acquireLock(${JSON.stringify(lockPath)});
    console.log(lock.ok ? 'held' : 'busy');
    setInterval(() => {}, 1000);
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
  const first = new Promise((resolve) => child.stdout.once('data', (data) => resolve(String(data).trim())));
  const kill = () => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill();
  });
  return { first, kill };
}

test('常駐の入口: 二重起動の防止は OS が排他を保証する名前（Windows は名前付きパイプ）。同時に取っても 1 つだけ、落ちたプロセスの分は OS が外す', async (t) => {
  const site = serverWorld(t);
  const lockPath = lockPathOf(envDir(site));
  // 同じプロセスの中で同時に取っても 1 つだけ
  const results = await Promise.all(Array.from({ length: 5 }, () => acquireLock(lockPath)));
  assert.equal(results.filter((result) => result.ok).length, 1);
  await results.find((result) => result.ok).release();
  // 別のプロセスどうしで同時に取っても 1 つだけ
  const children = Array.from({ length: 4 }, () => holdInChild(lockPath));
  t.after(() => Promise.all(children.map((child) => child.kill())));
  const firsts = await Promise.all(children.map((child) => child.first));
  assert.deepEqual(firsts.filter((value) => value === 'held').length, 1, firsts.join(','));
  assert.equal((await acquireLock(lockPath)).ok, false);
  // 持っているプロセスが落ちたら（kill）、OS が外す（ロックのファイルの残り・pid の使い回しで止まらない）
  await Promise.all(children.map((child) => child.kill()));
  const after = await acquireLock(lockPath);
  assert.equal(after.ok, true);
  await after.release();
  // データの場所が違えば別の名前。Windows は名前付きパイプ、ほかは抽象名前空間（ファイルを作らない）
  assert.notEqual(lockPathOf(path.join(site.root, 'other')), lockPath);
  assert.match(lockPathOf('D:\\data\\test', 'win32'), /^\\\\\.\\pipe\\pal-note-agent-[0-9a-f]{24}$/);
  assert.match(lockPathOf('/data/test', 'linux'), /^\0pal-note-agent-[0-9a-f]{24}$/);
  // 大文字と小文字の違いは、Windows では同じフォルダ（同じ名前）、Linux では別のフォルダ（別の名前）
  assert.equal(lockPathOf('D:\\Data\\Test', 'win32'), lockPathOf('d:\\data\\test', 'win32'));
  assert.notEqual(lockPathOf('/data/Test', 'linux'), lockPathOf('/data/test', 'linux'));
  assert.equal(fs.existsSync(path.join(envDir(site), 'agent.lock')), false);
});

test('常駐の入口: 動いている常駐がいれば --once は 3、--accept-world は要求のファイルで伝えて 0。前の版の agent.lock（pid の使い回し）では止まらない', async (t) => {
  const site = serverWorld(t);
  const gas = await gasOf();
  const held = await acquireLock(lockPathOf(envDir(site)));
  assert.equal(held.ok, true);
  const busy = await run(site, ['--once'], { gas });
  assert.equal(busy.code, 3);
  assert.deepEqual(gas.control.calls, []);
  const accept = await run(site, ['--accept-world'], { gas });
  assert.equal(accept.code, 0);
  assert.ok(fs.existsSync(path.join(envDir(site), 'accept.request')));
  await held.release();
  fs.rmSync(path.join(envDir(site), 'accept.request'));
  // 前の版が残した agent.lock が、いま生きている別のプロセス（pid の使い回し）を指していても止まらない
  fs.writeFileSync(path.join(envDir(site), 'agent.lock'), String(process.ppid));
  const once = await run(site, ['--once'], { gas });
  assert.equal(once.code, 0);
  assert.ok(gas.control.calls.includes('login'));
});

test('常駐の入口: パスワードは設定に読んだら環境変数から消す（この後に起動する PowerShell などの子に受け継がせない）', async (t) => {
  const site = serverWorld(t);
  const env = {
    LOCALAPPDATA: site.local, PAL_AGENT_DATA_DIR: site.dataDir, PAL_AGENT_USER_ID: 'サーバー', PAL_AGENT_PASSCODE: PASS, PAL_TEST_PASSCODE: 'dummy-test-pass-0002',
  };
  const stdout = output();
  const seen = [];
  // サーバーの稼働を見る時点（PowerShell を起動しうる所）で、環境変数にパスワードが残っていない
  const createMonitor = () => ({ check: async () => {
    seen.push([env.PAL_AGENT_PASSCODE, env.PAL_TEST_PASSCODE]);
    return { state: 'stopped', active: false, source: 'serversync', pid: null, serverState: 'Stopped', stoppedFor: null, reasons: [] };
  } });
  const code = await main({ argv: ['--check'], env, stdout: stdout.stream, stderr: output().stream, deps: { createMonitor, runImport: async () => snapshotOf({ seconds: 0, minutes: 1, day: 1 }) } });
  assert.equal(code, 0);
  assert.deepEqual(seen, [[undefined, undefined]]);
  assert.equal('PAL_AGENT_PASSCODE' in env, false);
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

test('常駐の入口: --once は、読めない・共有の通信の失敗なら 1、止めた状態など再起動しても直らない失敗なら 2 で終わる（0 にしない）', async (t) => {
  const site = serverWorld(t, { players: [U1, U2] });
  const gas = await gasOf();
  // 共有が通信の失敗（createApi の送り直しの後も）
  gas.control.fail.ownedUpload = 'CONNECTION';
  const failed = await run(site, ['--once', '--force-host'], { gas });
  assert.equal(failed.code, 1);
  assert.match(failed.out, /once-failed code="CONNECTION"/);
  gas.control.fail.ownedUpload = '';
  // セーブを読めない（例外の文にパスワードが入っていても、ログでは伏せる）
  const unreadable = await run(site, ['--once', '--force-host'], { gas, deps: { runImport: async () => { throw new Error(`読めません（テスト）${PASS}`); } } });
  assert.equal(unreadable.code, 1);
  assert.match(unreadable.out, /once-failed reason="セーブを読めませんでした"/);
  assert.match(unreadable.out, /read-failed/);
  assert.ok(!unreadable.out.includes(PASS));
  assert.ok(!fs.readFileSync(path.join(envDir(site), 'agent.log'), 'utf8').includes(PASS));
  // 通れば 0
  assert.equal((await run(site, ['--once', '--force-host'], { gas })).code, 0);
  // presence の通信の失敗も 1
  gas.control.fail.presence = 'CONNECTION';
  assert.equal((await run(site, ['--once'], { gas })).code, 1);
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

test('常駐の入口: state.json が壊れていたら（止めた状態などを失った）、このワールドを止めた状態にしてから始める（受け入れで戻る）', async (t) => {
  const site = serverWorld(t, { players: [U1, U2] });
  fs.mkdirSync(envDir(site), { recursive: true });
  const broken = '{ "pal-note.agent.lineage.test.';
  fs.writeFileSync(path.join(envDir(site), 'state.json'), broken);
  // --check（何も書かない）でも止めた状態と出す
  const check = await run(site, ['--check']);
  assert.equal(check.code, 0);
  assert.match(check.out, /lineage-unreadable/);
  assert.match(check.out, /check-lineage blocked=true accepted=false/);
  assert.equal(fs.readFileSync(path.join(envDir(site), 'state.json'), 'utf8'), broken);
  // 動かすと共有しない。止めた状態は新しい state.json に残る
  const gas = await gasOf();
  const once = await run(site, ['--once', '--force-host'], { gas });
  assert.equal(once.code, 2);
  assert.match(once.out, /once-failed code="LINEAGE_BLOCKED"/);
  assert.deepEqual(gas.writes('ownedUpload'), []);
  assert.match(fs.readFileSync(path.join(envDir(site), 'state.json'), 'utf8'), /unreadable/);
  assert.ok(fs.readdirSync(envDir(site)).some((name) => name.startsWith('state.json.broken-')));
});

test('常駐の入口: 壊れた state.json（読めない・値の形が違う）から止めた状態にしたことは、--once がログインに失敗して終わっても次の起動に残る', async (t) => {
  const broken = [
    '{ "pal-note.agent.lineage.test.',
    JSON.stringify({ [`pal-note.agent.lineage.test.${W}`]: { blocked: { against: 'published' } }, 'pal-note.userId': 'サーバー' }),
  ];
  for (const text of broken) {
    const site = serverWorld(t, { players: [U1, U2] });
    fs.mkdirSync(envDir(site), { recursive: true });
    fs.writeFileSync(path.join(envDir(site), 'state.json'), text);
    const gas = await gasOf();
    gas.control.fail.login = 'CONNECTION';
    const once = await run(site, ['--once', '--force-host'], { gas });
    assert.equal(once.code, 1);
    assert.match(once.out, /lineage-unreadable/);
    assert.deepEqual(gas.writes(), []);
    // 次の起動（何も書かない --check）でも止めた状態
    const check = await run(site, ['--check']);
    assert.match(check.out, /check-lineage blocked=true accepted=false/, text);
    assert.match(fs.readFileSync(path.join(envDir(site), 'state.json'), 'utf8'), /unreadable/);
  }
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

test('常駐の入口: --signup の登録の応答と --check --online の一覧の応答の env も確かめ、違えば 2（どの動かし方でも同じ確かめ）', async (t) => {
  const site = serverWorld(t);
  const gas = await gasOf();
  gas.control.envs.signup = 'prod';
  const signedUp = await run(site, ['--signup'], { gas, env: { PAL_AGENT_USER_ID: '常駐4' } });
  assert.equal(signedUp.code, 2);
  assert.match(signedUp.out, /env-mismatch expected="test" got="prod"/);
  gas.control.envs = { ownedWorlds: 'prod' };
  gas.control.calls.length = 0;
  const checked = await run(site, ['--check', '--online'], { gas });
  assert.equal(checked.code, 2);
  assert.deepEqual(gas.control.calls, ['login', 'ownedWorlds']);
  assert.match(checked.out, /env-mismatch expected="test" got="prod"/);
  assert.doesNotMatch(checked.out, /check-published/);
  // 失敗の応答の env が違っても 2
  gas.control.envs = {};
  gas.control.fail.ownedWorlds = { code: 'INTERNAL', env: 'prod' };
  assert.equal((await run(site, ['--check', '--online'], { gas })).code, 2);
  for (const result of [signedUp, checked]) assert.ok(!result.out.includes(PASS));
});
