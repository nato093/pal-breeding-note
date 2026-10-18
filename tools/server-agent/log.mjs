// 常駐のログ（<データ>\<env>\agent.log。1MB ごとに回し、agent.log・agent.log.1・agent.log.2 の 3 世代）と標準出力。
// 書く前に redact() で ID・パス・IP を伏せる。プレイヤー名・パスワード・GAS の応答の中身は呼ぶ側が渡さない（数と結果の種類だけ）。
import fs from 'node:fs';
import path from 'node:path';

export const LOG_MAX_BYTES = 1024 * 1024;
export const LOG_GENERATIONS = 3;
const MESSAGE_MAX = 300;
const LEVELS = ['debug', 'info', 'warn', 'error'];

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// フォルダのパスに当たる正規表現（\ と / のどちらでも、JSON の \\ でも、大文字と小文字を区別しない）
const pathPattern = (dir) => new RegExp(escapeRegExp(String(dir).replace(/[\\/]+$/, '')).replace(/\\\\|\//g, '[\\\\/]+'), 'gi');

/**
 * ログに出す文の ID・パス・IP を伏せる。
 * - secrets（パスワードなど）は <secret>
 * - インスタンスのフォルダは <instance>、ユーザーのフォルダ（userProfile と C:\Users\<名前>）は %USERPROFILE%
 * - GUID と 32 桁の 16 進（ワールド ID・UID）は先頭 8 字＋…、SteamID64 は 7656…、instanceIds は先頭 4 字＋…
 * - IPv4 は <ip>
 */
export function redact(input, { secrets = [], instanceDirs = [], userProfile = '', instanceIds = [] } = {}) {
  let text = String(input ?? '');
  for (const secret of secrets) if (secret && String(secret).length >= 4) text = text.split(String(secret)).join('<secret>');
  for (const dir of instanceDirs) if (dir) text = text.replace(pathPattern(dir), '<instance>');
  if (userProfile) text = text.replace(pathPattern(userProfile), '%USERPROFILE%');
  text = text.replace(/(?<![A-Za-z])[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'<>|:*?]+/gi, '%USERPROFILE%');
  for (const id of instanceIds) if (id && id.length >= 8) text = text.replace(new RegExp(escapeRegExp(id), 'gi'), `${id.slice(0, 4)}…`);
  // 前後は英数字の境目ではなく 16 進・数字の境目で見る（<uid>_dps.sav の _ の前でも伏せる）
  text = text.replace(/(?<![0-9a-f])([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-f])/gi, '$1…');
  text = text.replace(/(?<![0-9a-f])([0-9a-f]{8})[0-9a-f]{24}(?![0-9a-f])/gi, '$1…');
  text = text.replace(/(?<!\d)7656\d{13}(?!\d)/g, '7656…');
  text = text.replace(/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g, '<ip>');
  return text;
}

// 項目の値を 1 行の文にする（文字列は JSON の引用、ほかは JSON。長いものは切る）
function formatValue(value) {
  if (value instanceof Error) return JSON.stringify(`${value.code || value.name || 'Error'}: ${value.message}`.slice(0, MESSAGE_MAX));
  if (typeof value === 'string') return JSON.stringify(value.length > MESSAGE_MAX ? `${value.slice(0, MESSAGE_MAX)}…` : value);
  if (value === undefined) return 'null';
  let text;
  try { text = JSON.stringify(value); } catch { text = '"[unserializable]"'; }
  return text.length > MESSAGE_MAX ? JSON.stringify(`${text.slice(0, MESSAGE_MAX)}…`) : text;
}

/**
 * @param {{ dir: string, file?: string, maxBytes?: number, generations?: number, verbose?: boolean, stdout?: { write: Function },
 *   now?: () => number, fs?: object, redaction?: object, env?: object }} options
 *   redaction は redact() の第 2 引数（secrets・instanceDirs・userProfile・instanceIds）。setRedaction で後から足せる。
 *   userProfile の既定は環境変数 USERPROFILE
 * @returns {{ debug, info, warn, error, setRedaction, file: string }} 各関数は (event, fields) を受ける
 */
export function createLogger({
  dir, file = 'agent.log', maxBytes = LOG_MAX_BYTES, generations = LOG_GENERATIONS, verbose = false,
  stdout = process.stdout, now = Date.now, fs: fileSystem = fs, redaction = {}, env = process.env,
} = {}) {
  const target = dir ? path.join(dir, file) : '';
  let options = { userProfile: env.USERPROFILE || '', ...redaction };
  let size = null;
  let failed = false;

  const rotate = () => {
    for (let i = generations - 1; i >= 1; i--) {
      const from = i === 1 ? target : `${target}.${i - 1}`;
      try { fileSystem.renameSync(from, `${target}.${i}`); } catch { /* ない世代は飛ばす */ }
    }
    size = 0;
  };

  const writeFile = (line) => {
    if (!target) return;
    try {
      if (size === null) {
        fileSystem.mkdirSync(dir, { recursive: true });
        try { size = fileSystem.statSync(target).size; } catch { size = 0; }
      }
      const bytes = Buffer.byteLength(line);
      if (size > 0 && size + bytes > maxBytes) rotate();
      fileSystem.appendFileSync(target, line);
      size += bytes;
      failed = false;
    } catch (error) {
      // 書けなくても常駐は止めない（標準出力には出る）。続けて同じ知らせを出さない
      if (!failed) stdout?.write?.(`${new Date(now()).toISOString()} [warn] log-write-failed code=${formatValue(error?.code || 'ERROR')}\n`);
      failed = true;
      size = null;
    }
  };

  const write = (level, event, fields = {}) => {
    if (level === 'debug' && !verbose) return;
    const parts = Object.entries(fields ?? {}).map(([key, value]) => `${key}=${formatValue(value)}`);
    const line = `${redact(`${new Date(now()).toISOString()} [${level}] ${event}${parts.length ? ` ${parts.join(' ')}` : ''}`, options)}\n`;
    stdout?.write?.(line);
    writeFile(line);
  };

  const logger = Object.fromEntries(LEVELS.map((level) => [level, (event, fields) => write(level, event, fields)]));
  return {
    ...logger,
    /** 伏せる値を足す（ワールドを見つけた後のインスタンスのフォルダ、ログインの後のパスワードなど） */
    setRedaction(next) { options = { ...options, ...next }; },
    file: target,
  };
}
