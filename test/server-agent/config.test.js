import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { inspect } from 'node:util';
import { API_URL } from '../../web/js/config.js';
import { ConfigError, loadConfig, parseAgentArgs } from '../../tools/server-agent/config.mjs';

const DATA = path.join(path.sep, 'agent-data');
const CONFIG_FILE = path.join(DATA, 'config.json');
const SECRET = 'dummy-shared-pass-1234';

// config.json を差し替えて読む（text が null ならファイルがない）
function load({ argv = [], env = {}, file = null } = {}) {
  const readFile = (target) => {
    if (target === CONFIG_FILE && file !== null) return typeof file === 'string' ? file : JSON.stringify(file);
    throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  };
  return loadConfig({ argv, env: { PAL_AGENT_DATA_DIR: DATA, ...env }, readFile });
}

function rejects(fn, pattern, secret = SECRET) {
  let error;
  try { fn(); } catch (caught) { error = caught; }
  assert.ok(error instanceof ConfigError, '設定の誤りになる');
  assert.equal(error.exitCode, 2);
  if (pattern) assert.match(error.message, pattern);
  assert.ok(!error.message.includes(secret), '誤りの文に値を出さない');
  return error;
}

test('常駐の設定: 何も書かなければ test・既定の接続先・データの場所の下の env のフォルダ', () => {
  const config = load();
  assert.equal(config.env, 'test');
  assert.equal(config.userId, '');
  assert.equal(config.autoRegister, true);
  assert.equal(config.apiUrl, API_URL);
  assert.equal(config.dataDir, DATA);
  assert.equal(config.envDir, path.join(DATA, 'test'));
  assert.equal(config.configFile, CONFIG_FILE);
  assert.deepEqual(config.flags, { check: false, online: false, once: false, dryRun: false, forceHost: false, acceptWorld: false, signup: false, verbose: false });
});

test('常駐の設定: データの場所の既定は %LOCALAPPDATA%\\pal-note-agent', () => {
  const local = path.join(path.sep, 'local-app-data');
  const config = loadConfig({ argv: [], env: { LOCALAPPDATA: local }, readFile: () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); } });
  assert.equal(config.dataDir, path.join(local, 'pal-note-agent'));
  assert.equal(config.localAppData, local);
});

test('常駐の設定: 引数 > 環境変数 > config.json の順に使う', () => {
  const file = { userId: 'ファイル', worldName: 'ファイルの名前', instance: 'FILE0001', serverRoot: 'C:\\from-file', autoRegister: false };
  assert.deepEqual(
    (({ userId, worldName, instance, serverRoot, autoRegister }) => ({ userId, worldName, instance, serverRoot, autoRegister }))(load({ file })),
    { userId: 'ファイル', worldName: 'ファイルの名前', instance: 'FILE0001', serverRoot: 'C:\\from-file', autoRegister: false },
  );
  const env = { PAL_AGENT_USER_ID: '環境', PAL_AGENT_INSTANCE: 'ENV0001', PAL_AGENT_AUTO_REGISTER: 'true' };
  const fromEnv = load({ file, env });
  assert.equal(fromEnv.userId, '環境');
  assert.equal(fromEnv.instance, 'ENV0001');
  assert.equal(fromEnv.autoRegister, true);
  assert.equal(fromEnv.worldName, 'ファイルの名前');
  const fromArgs = load({ file, env, argv: ['--user', '引数', '--instance=ARG0001', '--no-auto-register', '--world-dir', '"D:\\x\\SaveGames\\0\\y"'] });
  assert.equal(fromArgs.userId, '引数');
  assert.equal(fromArgs.instance, 'ARG0001');
  assert.equal(fromArgs.autoRegister, false);
  assert.equal(fromArgs.worldDir, 'D:\\x\\SaveGames\\0\\y', '貼り付けた引用符は外す');
});

test('常駐の設定: prod は config.json に "env": "prod" があるときだけ動く', () => {
  rejects(() => load({ argv: ['--env', 'prod'] }), /config\.json/);
  rejects(() => load({ env: { PAL_AGENT_ENV: 'prod' } }), /config\.json/);
  rejects(() => load({ argv: ['--env', 'prod'], file: { env: 'test' } }), /config\.json/);
  assert.equal(load({ file: { env: 'prod' } }).env, 'prod');
  assert.equal(load({ argv: ['--env', 'prod'], file: { env: 'prod' } }).envDir, path.join(DATA, 'prod'));
  // 本番の PC でも、引数で test に切り替えるのはよい
  assert.equal(load({ argv: ['--env', 'test'], file: { env: 'prod' } }).env, 'test');
  rejects(() => load({ argv: ['--env', 'staging'] }), /prod か test/);
  rejects(() => load({ argv: ['--force-host'], file: { env: 'prod' } }), /test 環境だけ/);
  assert.equal(load({ argv: ['--force-host', '--once'] }).flags.forceHost, true);
});

test('常駐の設定: パスワードは環境変数だけから読み、設定の中身として出さない', () => {
  const prod = load({ file: { env: 'prod', passcode: 'file-pass-0000' }, env: { PAL_AGENT_PASSCODE: SECRET, PAL_TEST_PASSCODE: 'test-pass-0000' } });
  assert.equal(prod.passcode, SECRET);
  assert.ok(prod.warnings.some((line) => line.includes('passcode')), 'config.json のパスワードは使わずに知らせる');
  assert.ok(!prod.warnings.join('\n').includes('file-pass-0000'));
  // prod では PAL_TEST_PASSCODE を読まない
  assert.equal(load({ file: { env: 'prod' }, env: { PAL_TEST_PASSCODE: 'test-pass-0000' } }).passcode, '');
  // test では PAL_TEST_PASSCODE も読む（node --env-file=.env.local）
  assert.equal(load({ env: { PAL_TEST_PASSCODE: SECRET } }).passcode, SECRET);
  assert.equal(load({ file: { passcode: 'file-pass-0000' } }).passcode, '', 'config.json のパスワードは使わない');
  for (const text of [JSON.stringify(prod), inspect(prod, { depth: 5 }), String(Object.keys(prod))]) {
    assert.ok(!text.includes(SECRET), '設定を出力してもパスワードは出ない');
  }
  // 引数では渡せない（値を誤りの文に出さない）
  rejects(() => load({ argv: [`--passcode=${SECRET}`] }), /--passcode/);
  rejects(() => load({ argv: ['--passcode', SECRET] }), /--passcode/);
  rejects(() => load({ argv: [SECRET] }), /余分な引数/);
  // 名前の位置に書いた値も、引数の名前の形（英小文字・数字・-）でなければ出さない
  rejects(() => load({ argv: ['--Dummy!Pass#99'] }), /知らない引数/, 'Dummy!Pass#99');
});

test('常駐の設定: 値の誤りは終了コード 2 の設定の誤り（値は文に出さない）', () => {
  rejects(() => load({ file: `{ "env": "test", "x": "${SECRET}"` }), /JSON/);
  rejects(() => load({ file: '[]' }), /config\.json/);
  rejects(() => load({ argv: ['--user', 'あ'.repeat(21)] }), /TOO_LONG/);
  rejects(() => load({ argv: ['--user', ' '] }), /REQUIRED/);
  rejects(() => load({ argv: ['--instance', '../../x'] }), /instance/);
  rejects(() => load({ argv: ['--env'] }), /値が要ります/);
  rejects(() => load({ argv: ['--env', '--check'] }), /値が要ります/);
  rejects(() => load({ argv: ['--check=yes'] }), /値を取りません/);
  rejects(() => load({ file: { autoRegister: 'maybe' } }), /autoRegister/);
  rejects(() => load({ env: { PAL_API_URL: 'http://example.com/exec' } }), /https/);
  assert.equal(load({ env: { PAL_API_URL: 'http://127.0.0.1:8787/api' } }).apiUrl, 'http://127.0.0.1:8787/api');
});

test('常駐の設定: config.json の BOM と ID の前後の空白・制御文字を受ける', () => {
  const config = load({ file: `\uFEFF${JSON.stringify({ userId: '  サーバー\u0007 ', worldName: ' テストのワールド\n' })}` });
  assert.equal(config.userId, 'サーバー');
  assert.equal(config.worldName, 'テストのワールド');
});

test('常駐の設定: 動かし方の引数を読む', () => {
  const { flags, values } = parseAgentArgs(['--check', '--online', '--verbose', '--accept-world', '--dry-run', '--server-root', 'G:\\x']);
  assert.deepEqual(flags, { check: true, online: true, once: false, dryRun: true, forceHost: false, acceptWorld: true, signup: false, verbose: true });
  assert.deepEqual(values, { serverRoot: 'G:\\x' });
  // --signup（ID を作る）と、--world-dir と同じ --world
  const signup = parseAgentArgs(['--signup', '--world', 'G:\\w']);
  assert.equal(signup.flags.signup, true);
  assert.deepEqual(signup.values, { worldDir: 'G:\\w' });
});
