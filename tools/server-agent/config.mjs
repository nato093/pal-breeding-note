// 常駐（server-agent）の設定。優先順位は 引数 > 環境変数 > <データ>\config.json（docs/server/README.md の T5）。
// config.json に秘密は書かない（env・userId・worldDir・serverRoot・instance・worldName・autoRegister だけを読む）。
// パスワードは環境変数 PAL_AGENT_PASSCODE だけ（env が test のときは PAL_TEST_PASSCODE も読む。node --env-file=.env.local で使える）。
// prod は config.json に "env": "prod" があるときだけ動く（引数の --env prod や環境変数だけでは動かない。メインの PC で本番の共有を上書きしないため）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { API_URL } from '../../web/js/config.js';
import { validateUserId } from '../../web/js/core/user.js';

/** 設定の誤り。main は終了コード 2 で終わる（再起動しても直らない）。文には値を入れない（パスワード・パスを出さないため） */
export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
    this.exitCode = 2;
  }
}

const ENVS = new Set(['prod', 'test']);
const FILE_KEYS = ['env', 'userId', 'worldDir', 'serverRoot', 'instance', 'worldName', 'autoRegister'];
// ServerSync のインスタンス ID（またはその先頭）。ローカル API の URL に入れるので、英数字と - _ だけ
const INSTANCE = /^[A-Za-z0-9_-]{1,64}$/;
const WORLD_NAME_MAX = 64;

// 引数。key は設定の項目、flag は動かし方（main が使う）
const OPTIONS = {
  env: { type: 'string', key: 'env' },
  user: { type: 'string', key: 'userId' },
  'world-dir': { type: 'string', key: 'worldDir' },
  // --world は --world-dir と同じ（ワールドのフォルダ SaveGames\0\<ワールド ID>）
  world: { type: 'string', key: 'worldDir' },
  'server-root': { type: 'string', key: 'serverRoot' },
  instance: { type: 'string', key: 'instance' },
  'world-name': { type: 'string', key: 'worldName' },
  'auto-register': { type: 'boolean', key: 'autoRegister', value: true },
  'no-auto-register': { type: 'boolean', key: 'autoRegister', value: false },
  check: { type: 'boolean', flag: 'check' },
  online: { type: 'boolean', flag: 'online' },
  once: { type: 'boolean', flag: 'once' },
  'dry-run': { type: 'boolean', flag: 'dryRun' },
  'force-host': { type: 'boolean', flag: 'forceHost' },
  'accept-world': { type: 'boolean', flag: 'acceptWorld' },
  signup: { type: 'boolean', flag: 'signup' },
  verbose: { type: 'boolean', flag: 'verbose' },
};

// 環境変数（引数の次に強い）
const ENV_KEYS = {
  env: 'PAL_AGENT_ENV', userId: 'PAL_AGENT_USER_ID', worldDir: 'PAL_AGENT_WORLD_DIR', serverRoot: 'PAL_AGENT_SERVER_ROOT',
  instance: 'PAL_AGENT_INSTANCE', worldName: 'PAL_AGENT_WORLD_NAME', autoRegister: 'PAL_AGENT_AUTO_REGISTER',
};

// 知らない引数の名前は、英小文字・数字・- の短いものだけ文に入れる（誤って値を名前の位置に書いても出さない）
const safeName = (name) => (/^[a-z0-9-]{1,32}$/.test(name) ? `--${name}` : '');

/**
 * 引数を読む。値を取る引数は「--name value」か「--name=value」。値を文に入れない。
 * @returns {{ values: object, flags: object }}
 */
export function parseAgentArgs(argv = []) {
  const values = {};
  const flags = Object.fromEntries(Object.values(OPTIONS).filter((spec) => spec.flag).map((spec) => [spec.flag, false]));
  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i]);
    if (!arg.startsWith('--')) throw new ConfigError('余分な引数があります（引数は --名前 の形で指定してください）');
    const eq = arg.indexOf('=');
    const name = eq < 0 ? arg.slice(2) : arg.slice(2, eq);
    const spec = Object.hasOwn(OPTIONS, name) ? OPTIONS[name] : null;
    if (!spec) throw new ConfigError(`知らない引数です${safeName(name) ? `: ${safeName(name)}` : ''}`);
    if (spec.type === 'boolean') {
      if (eq >= 0) throw new ConfigError(`--${name} は値を取りません`);
      if (spec.flag) flags[spec.flag] = true;
      else values[spec.key] = spec.value;
      continue;
    }
    const value = eq >= 0 ? arg.slice(eq + 1) : argv[++i];
    if (value === undefined || (eq < 0 && String(value).startsWith('--'))) throw new ConfigError(`--${name} に値が要ります`);
    values[spec.key] = String(value);
  }
  return { values, flags };
}

/** %LOCALAPPDATA%（ない環境ではホームの AppData\Local） */
export function localAppDataOf(env = process.env) {
  return env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
}

/** データの場所（KV・ログ・config.json）。PAL_AGENT_DATA_DIR で変えられる（テストは一時フォルダ） */
export function dataDirOf(env = process.env) {
  return env.PAL_AGENT_DATA_DIR || path.join(localAppDataOf(env), 'pal-note-agent');
}

// config.json を読む。ないときは空。壊れていれば設定の誤り（中身は文に入れない）
function readConfigFile(file, readFile) {
  let text;
  try {
    text = readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw new ConfigError(`config.json を読めません（${error?.code || 'ERROR'}）`);
  }
  let value;
  // PowerShell 5 の Set-Content -Encoding UTF8 は BOM を付ける
  try { value = JSON.parse(String(text).replace(/^﻿/, '')); } catch { throw new ConfigError('config.json の形が正しくありません（JSON として読めません）'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConfigError('config.json の形が正しくありません（{ … } の形にしてください）');
  return value;
}

const text = (value) => (typeof value === 'string' ? value.trim().replace(/^["']+|["']+$/g, '') : '');

function booleanOf(value, source) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string' && /^(1|true|on|yes)$/i.test(value.trim())) return true;
  if (typeof value === 'string' && /^(0|false|off|no)$/i.test(value.trim())) return false;
  throw new ConfigError(`${source} の autoRegister は true か false にしてください`);
}

function apiUrlOf(value) {
  let url;
  try { url = new URL(value); } catch { throw new ConfigError('PAL_API_URL の形が正しくありません'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new ConfigError('PAL_API_URL は https の URL にしてください');
  return url.href;
}

/**
 * 設定を読む。設定の誤りは ConfigError（exitCode 2）。
 * passcode は列挙しない項目に置く（JSON.stringify・console.log・util.inspect に出さない）。
 * @returns {object} env・userId・worldDir・serverRoot・instance・worldName・autoRegister・apiUrl・dataDir・envDir・configFile・localAppData・flags・warnings・passcode
 */
export function loadConfig({ argv = process.argv.slice(2), env = process.env, readFile = fs.readFileSync } = {}) {
  const { values: args, flags } = parseAgentArgs(argv);
  const dataDir = dataDirOf(env);
  const configFile = path.join(dataDir, 'config.json');
  const file = readConfigFile(configFile, readFile);
  const warnings = Object.keys(file).filter((key) => !FILE_KEYS.includes(key))
    .map((key) => `config.json の知らない項目は使いません: ${/^[A-Za-z0-9_-]{1,32}$/.test(key) ? key : '（名前を伏せます）'}`);
  // 引数 > 環境変数 > config.json（どこに書いたかを誤りの文に出す）
  const pick = (key) => {
    if (args[key] !== undefined) return { value: args[key], source: '引数' };
    const envValue = env[ENV_KEYS[key]];
    if (envValue !== undefined && envValue !== '') return { value: envValue, source: ENV_KEYS[key] };
    if (file[key] !== undefined && file[key] !== null) return { value: file[key], source: 'config.json' };
    return { value: undefined, source: '' };
  };

  const envPick = pick('env');
  const envName = envPick.value === undefined ? 'test' : text(envPick.value);
  if (!ENVS.has(envName)) throw new ConfigError(`${envPick.source} の env は prod か test にしてください`);
  if (envName === 'prod' && file.env !== 'prod') {
    throw new ConfigError('prod は config.json に "env": "prod" があるときだけ動きます（引数や環境変数だけでは本番に送りません）');
  }
  if (flags.forceHost && envName !== 'test') throw new ConfigError('--force-host は test 環境だけで使えます');

  let userId = '';
  const userPick = pick('userId');
  if (userPick.value !== undefined) {
    const checked = validateUserId(userPick.value);
    if (!checked.ok) throw new ConfigError(`${userPick.source} の userId が正しくありません（${checked.errors[0].code}）`);
    userId = checked.value;
  }

  const instancePick = pick('instance');
  const instance = text(instancePick.value);
  if (instance && !INSTANCE.test(instance)) throw new ConfigError(`${instancePick.source} の instance は ServerSync のインスタンス ID（英数字）にしてください`);

  const worldName = text(pick('worldName').value).replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, WORLD_NAME_MAX);
  const autoPick = pick('autoRegister');
  const autoRegister = autoPick.value === undefined ? true : booleanOf(autoPick.value, autoPick.source);

  const config = {
    env: envName, userId,
    worldDir: text(pick('worldDir').value), serverRoot: text(pick('serverRoot').value), instance, worldName, autoRegister,
    apiUrl: apiUrlOf(env.PAL_API_URL || API_URL),
    dataDir, envDir: path.join(dataDir, envName), configFile, localAppData: localAppDataOf(env),
    flags, warnings,
  };
  const passcode = String(env.PAL_AGENT_PASSCODE || (envName === 'test' ? env.PAL_TEST_PASSCODE || '' : '')).trim();
  Object.defineProperty(config, 'passcode', { value: passcode, enumerable: false });
  return config;
}
