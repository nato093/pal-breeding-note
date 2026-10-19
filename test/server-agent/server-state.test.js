import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { createServerMonitor, pickStatus, processStateOf } from '../../tools/server-agent/server-state.mjs';

// ダミーの値
const INSTANCE = 'TESTINSTA0000001';
const SERVER_DIR = 'G:\\ServerSync\\TESTINSTA0000001\\bin';
const EXE = `${SERVER_DIR}\\Pal\\Binaries\\Win64\\PalServer-Win64-Shipping-Cmd.exe`;
const SECRETS = ['dummy-admin-pass-0000', 'dummy-server-pass-0000', 'dummy-gas-pass-0000'];

// ServerSync の GET /instances/<ID> の応答（起動の計画と設定に、パスワードのダミーを入れる）
function detail(status) {
  return {
    locked: { id: INSTANCE, game: 'palworld', name: 'テストのインスタンス' },
    editable: { config: { AdminPassword: SECRETS[0], ServerPassword: SECRETS[1] }, port: 8211 },
    status: { installed: true, running: false, pid: null, state: 'Stopped', runningUsers: [], ...status },
    plan: { args: [`-adminpassword=${SECRETS[0]}`, `-serverpassword=${SECRETS[1]}`], env: { PAL_AGENT_PASSCODE: SECRETS[2] } },
    paths: { dir: 'G:\\ServerSync\\TESTINSTA0000001' },
  };
}

function fakeFetch(respond) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    const result = await respond(url, options);
    if (result instanceof Error) throw result;
    const { status = 200, body } = result;
    return { ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
  return { fetch, calls };
}

function fakeExec(respond) {
  const calls = [];
  const execFile = async (file, args, options) => {
    calls.push({ file, args, options });
    const result = await respond();
    if (result instanceof Error) throw result;
    return { stdout: result, stderr: '' };
  };
  return { execFile, calls };
}

const leaks = (value) => SECRETS.filter((secret) => inspect(value, { depth: 10 }).includes(secret) || JSON.stringify(value).includes(secret));

test('サーバーの稼働: ServerSync の status.running と pid で決め、state が Ready になるのを待たない', async () => {
  const { fetch, calls } = fakeFetch(() => ({ body: detail({ running: true, pid: 4242, state: 'Starting' }) }));
  const monitor = createServerMonitor({ instanceId: INSTANCE, serverDir: SERVER_DIR, fetch, platform: 'linux' });
  const result = await monitor.check();
  assert.deepEqual(result, { state: 'running', active: true, running: true, pid: 4242, serverState: 'Starting', source: 'serversync', stoppedFor: null, reasons: [] });
  assert.equal(calls[0].url, `http://127.0.0.1:54866/instances/${INSTANCE}`);
  assert.equal(calls[0].options.method, 'GET', '読み取りの GET だけ');
  assert.equal(calls[0].options.redirect, 'error');
  assert.deepEqual(leaks(result), [], '応答の秘密を残さない');
});

test('サーバーの稼働: 止まってから 60 秒は動いているとみなし（最後の保存を拾う）、その後は止まっている', async () => {
  let running = true;
  let time = 1_000_000;
  const { fetch } = fakeFetch(() => ({ body: detail(running ? { running: true, pid: 7, state: 'Ready' } : {}) }));
  const monitor = createServerMonitor({ instanceId: INSTANCE, fetch, now: () => time, platform: 'linux' });
  assert.equal((await monitor.check()).state, 'running');
  running = false;
  time += 10_000;
  const grace = await monitor.check();
  assert.equal(grace.state, 'grace');
  assert.equal(grace.active, true);
  assert.equal(grace.stoppedFor, 10_000);
  assert.equal(grace.pid, null);
  time += 49_999;
  assert.equal((await monitor.check()).state, 'grace');
  time += 1;
  const stopped = await monitor.check();
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.active, false);
  // 起動したら戻る
  running = true;
  assert.equal((await monitor.check()).active, true);
});

test('サーバーの稼働: 常駐を起動したときにもう止まっていれば、猶予なしで止まっている', async () => {
  const { fetch } = fakeFetch(() => ({ body: detail({}) }));
  const result = await createServerMonitor({ instanceId: INSTANCE, fetch, platform: 'linux' }).check();
  assert.equal(result.state, 'stopped');
  assert.equal(result.active, false);
  assert.equal(result.stoppedFor, null);
});

test('サーバーの稼働: ServerSync から取れなければ、実行ファイルのパスが対象のフォルダの下かで決める（シェルを通さない）', async () => {
  const { fetch } = fakeFetch(() => new TypeError('fetch failed'));
  const exec = fakeExec(() => `>C:\\Other\\PalServer\\PalServer.exe\r\n>${EXE}\r\n`);
  const monitor = createServerMonitor({ instanceId: INSTANCE, serverDir: SERVER_DIR, fetch, execFile: exec.execFile, platform: 'linux' });
  const result = await monitor.check();
  assert.equal(result.state, 'running');
  assert.equal(result.source, 'process');
  assert.deepEqual(result.reasons, ['serversync:unreachable']);
  assert.equal(exec.calls[0].file, 'powershell.exe');
  assert.ok(!exec.calls[0].args.join(' ').includes(SERVER_DIR), '対象のフォルダはコマンドに入れない');
  assert.match(exec.calls[0].args.join(' '), /Get-CimInstance -ClassName Win32_Process/);
  assert.notEqual(exec.calls[0].options.shell, true);
  // 別のインスタンスの PalServer だけなら止まっている
  const other = fakeExec(() => '>G:\\ServerSync\\TESTINSTB0000002\\bin\\PalServer.exe\r\n');
  const stopped = await createServerMonitor({ serverDir: SERVER_DIR, execFile: other.execFile, platform: 'linux' }).check();
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.source, 'process');
  // 前方一致だけのフォルダ（…\bin2）は対象の下ではない
  assert.equal(processStateOf(`>${SERVER_DIR}2\\PalServer.exe`, SERVER_DIR), 'stopped');
  assert.equal(processStateOf(`>${EXE.toUpperCase().replace(/\\/g, '/')}`, SERVER_DIR), 'running');
  assert.equal(processStateOf('', SERVER_DIR), 'stopped');
});

test('サーバーの稼働: ServerSync が動いていると言っても、この PC で対象のフォルダの PalServer が動いていなければ止まっている（別の PC が動かす共有のインスタンス）', async () => {
  let body = detail({ running: true, pid: 4242, state: 'Ready' });
  const { fetch } = fakeFetch(() => ({ body }));
  // pid がこの PC で生きていない: PowerShell を起動せずに止まっているとする
  const none = fakeExec(() => `>${EXE}\r\n`);
  const away = await createServerMonitor({ instanceId: INSTANCE, serverDir: SERVER_DIR, fetch, execFile: none.execFile, alive: () => false, platform: 'linux' }).check();
  assert.deepEqual([away.state, away.active, away.source, away.pid], ['stopped', false, 'serversync', null]);
  assert.deepEqual(away.reasons, ['serversync:not-here']);
  assert.equal(none.calls.length, 0);
  // pid は生きているが（別のプロセスの使い回し）、対象のフォルダの PalServer がない
  const elsewhere = fakeExec(() => '>G:\\ServerSync\\TESTINSTB0000002\\bin\\PalServer.exe\r\n');
  const reused = await createServerMonitor({ instanceId: INSTANCE, serverDir: SERVER_DIR, fetch, execFile: elsewhere.execFile, alive: () => true, platform: 'linux' }).check();
  assert.deepEqual([reused.state, reused.active, reused.reasons], ['stopped', false, ['serversync:not-here']]);
  // この PC で動いている: 同じ pid の間は 30 秒だけ結果を使い回す（10 秒ごとに PowerShell を起動しない）。pid が替わったら確かめ直す
  const here = fakeExec(() => `>${EXE}\r\n`);
  const monitor = createServerMonitor({ instanceId: INSTANCE, serverDir: SERVER_DIR, fetch, execFile: here.execFile, alive: () => true, platform: 'linux' });
  for (let i = 0; i < 3; i++) assert.deepEqual([(await monitor.check()).state, (await monitor.check()).reasons], ['running', []]);
  assert.equal(here.calls.length, 1);
  body = detail({ running: true, pid: 5151, state: 'Ready' });
  assert.equal((await monitor.check()).state, 'running');
  assert.equal(here.calls.length, 2);
});

test('サーバーの稼働: この PC で動いているかの確かめは 30 秒で確かめ直す（最初に見つからなくても、後から動けば拾う）。確かめられなければ unknown で、次の確認でまた確かめる', async () => {
  let time = 1_000_000;
  const { fetch } = fakeFetch(() => ({ body: detail({ running: true, pid: 4242, state: 'Starting' }) }));
  // 起動の途中で、まだ PalServer の実行ファイルが見つからない
  let stdout = '';
  const exec = fakeExec(() => stdout);
  const monitor = createServerMonitor({ instanceId: INSTANCE, serverDir: SERVER_DIR, fetch, execFile: exec.execFile, alive: () => true, now: () => time, platform: 'linux' });
  assert.deepEqual([(await monitor.check()).state, exec.calls.length], ['stopped', 1]);
  stdout = `>${EXE}\r\n`;
  time += 10_000;
  assert.deepEqual([(await monitor.check()).state, exec.calls.length], ['stopped', 1], '30 秒の間は使い回す');
  time += 20_000;
  assert.deepEqual([(await monitor.check()).state, exec.calls.length], ['running', 2], '同じ pid でも確かめ直して拾う');
  // 動いていると確かめた後も、30 秒ごとに確かめ直す（止まった・別のものに替わったのを拾う）
  stdout = '';
  time += 30_000;
  assert.deepEqual([(await monitor.check()).reasons, exec.calls.length], [['serversync:not-here'], 3]);
  // 確かめられない（PowerShell の失敗・パスの取れない PalServer）: ServerSync の答えのままにせず unknown（共有と自動登録をしない）。
  // 結果を使い回さず、次の確認でまた確かめる
  let fail = true;
  const flaky = fakeExec(() => (fail ? new Error('spawn failed') : `>${EXE}\r\n`));
  const unsure = createServerMonitor({ instanceId: INSTANCE, serverDir: SERVER_DIR, fetch, execFile: flaky.execFile, alive: () => true, now: () => time, platform: 'linux' });
  const failed = await unsure.check();
  assert.deepEqual([failed.state, failed.active, failed.reasons], ['unknown', false, ['serversync:unconfirmed', 'process-error']]);
  assert.equal((await unsure.check()).state, 'unknown');
  assert.equal(flaky.calls.length, 2, '失敗は使い回さない');
  fail = false;
  assert.equal((await unsure.check()).state, 'running');
  const pathless = fakeExec(() => '>\r\n');
  const partial = await createServerMonitor({ instanceId: INSTANCE, serverDir: SERVER_DIR, fetch, execFile: pathless.execFile, alive: () => true, platform: 'linux' }).check();
  assert.deepEqual([partial.state, partial.reasons], ['unknown', ['serversync:unconfirmed', 'process-unknown']]);
  // 実行ファイルのパスを調べる手段がない（Windows 以外で execFile を渡さない）ときだけ ServerSync の答えのまま
  assert.equal((await createServerMonitor({ instanceId: INSTANCE, serverDir: SERVER_DIR, fetch, platform: 'linux' }).check()).state, 'running');
});

test('サーバーの稼働: ServerSync に届かない間は、実行ファイルのパスの確認を 30 秒に 1 回にする（PowerShell を 10 秒ごとに起動しない）', async () => {
  let time = 1_000_000;
  const { fetch } = fakeFetch(() => new TypeError('fetch failed'));
  const exec = fakeExec(() => `>${EXE}\r\n`);
  const monitor = createServerMonitor({ instanceId: INSTANCE, serverDir: SERVER_DIR, fetch, execFile: exec.execFile, now: () => time, platform: 'linux' });
  assert.equal((await monitor.check()).state, 'running');
  time += 10_000;
  assert.equal((await monitor.check()).state, 'running');
  time += 10_000;
  assert.equal((await monitor.check()).source, 'process');
  assert.equal(exec.calls.length, 1);
  time += 10_000;
  await monitor.check();
  assert.equal(exec.calls.length, 2);
});

test('サーバーの稼働: どちらでも決められなければ unknown（共有と自動登録をしない）', async () => {
  const cases = [
    // ServerSync に当たらず（404）、PowerShell が失敗
    { fetch: fakeFetch(() => ({ status: 404, body: { error: 'not found' } })).fetch, execFile: fakeExec(() => new Error('spawn failed')).execFile, reasons: ['serversync:http-404', 'process-error'] },
    // パスが取れない PalServer（ほかのユーザーのプロセスなど）がある
    { fetch: fakeFetch(() => ({ body: { status: { running: 'yes' } } })).fetch, execFile: fakeExec(() => '>\r\n').execFile, reasons: ['serversync:bad-response', 'process-unknown'] },
    // インスタンスもフォルダも分からない
    { reasons: ['serversync:no-instance', 'no-process-check'], noInstance: true },
  ];
  for (const { fetch, execFile, reasons, noInstance } of cases) {
    const monitor = createServerMonitor({ instanceId: noInstance ? '' : INSTANCE, serverDir: noInstance ? '' : SERVER_DIR, fetch, execFile, platform: 'linux' });
    const result = await monitor.check();
    assert.equal(result.state, 'unknown');
    assert.equal(result.active, false);
    assert.deepEqual(result.reasons, reasons);
  }
  // Windows 以外では、execFile を渡さなければ実行ファイルのパスでは調べない
  const { fetch } = fakeFetch(() => new TypeError('fetch failed'));
  const linux = await createServerMonitor({ instanceId: INSTANCE, serverDir: SERVER_DIR, fetch, platform: 'linux' }).check();
  assert.deepEqual(linux.reasons, ['serversync:unreachable', 'no-process-check']);
});

test('サーバーの稼働: 応答の秘密（管理者パスワード・ServerPassword・共通パスワード）を結果と理由に残さない', async () => {
  const bodies = [
    { body: detail({ running: true, pid: 1, state: 'Ready' }) },
    // JSON として読めない応答
    { body: `{"plan":{"args":["-adminpassword=${SECRETS[0]}"]}, "status": ` },
    // status の形が違う応答
    { body: { plan: { args: [SECRETS[0]] }, status: { running: SECRETS[1], pid: SECRETS[2], state: SECRETS[0] } } },
    { status: 500, body: `error ${SECRETS[0]}` },
  ];
  for (const respond of bodies) {
    const { fetch } = fakeFetch(() => respond);
    const monitor = createServerMonitor({ instanceId: INSTANCE, fetch, platform: 'linux' });
    const result = await monitor.check();
    assert.deepEqual(leaks(result), []);
    assert.deepEqual(leaks(monitor), []);
  }
  assert.deepEqual(pickStatus({ status: { running: true, pid: 12, state: 'Weird', extra: SECRETS[0] } }), { running: true, pid: 12, state: '' });
  assert.equal(pickStatus({ status: { running: 'true' } }), null);
  assert.equal(pickStatus(null), null);
});
