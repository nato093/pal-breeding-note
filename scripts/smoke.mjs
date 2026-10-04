// 本番 API の疎通確認（Node から）。テスト用パスワードは .env.local から読み、画面やログには出さない。
// CORS と CSP はブラウザでしか確かめられないので、ここでは認証と応答の形だけを見る。
import fs from 'node:fs';
import { API_URL } from '../web/js/config.js';

function readEnv(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs.readFileSync(file, 'utf8').split(/\r?\n/)
      .map((line) => line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  );
}

async function post(body) {
  const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify(body), redirect: 'follow' });
  return JSON.parse(await res.text());
}

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push(ok);
  console.log(`${ok ? 'OK' : 'NG'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const passcode = readEnv('.env.local').PAL_TEST_PASSCODE;
check('.env.local に PAL_TEST_PASSCODE がある', Boolean(passcode));

const health = await (await fetch(API_URL, { redirect: 'follow' })).json();
check('GET はデータを返さず稼働状況だけを返す', health.ok === true && !('records' in health), `api=${health.api}`);

const wrong = await post({ action: 'ping', passcode: 'WRONG-CODE-0000-0000' });
check('誤ったパスワードは拒否される', wrong.ok === false && wrong.code === 'AUTH', wrong.code);

if (passcode) {
  const ping = await post({ action: 'ping', passcode });
  // 本番パスワードが入っていたら、AI が本番データに触れられる状態なので失敗にする（INV-4）
  check('テスト用パスワードがテスト環境に届く', ping.ok === true && ping.env === 'test', ping.ok ? `env=${ping.env}` : ping.code);
}

process.exit(checks.every(Boolean) ? 0 : 1);
