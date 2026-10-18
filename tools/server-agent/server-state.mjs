// 対象のインスタンスのサーバーが動いているか（docs/server/README.md の T5 と「P0 で決めたこと」）。
// 第一に ServerSync のローカル API の GET /instances/<ID> の status.running と pid（state が Ready になるのを待たない。
// 誰かが接続するまで Starting のままのため）。応答には起動の計画（管理者パスワードを含みうる）が入るので、
// status の running・pid・state だけを取り出して残りはすぐ捨てる（ログ・例外の文・状態に残さない）。
// 取れなければ PowerShell の Get-CimInstance Win32_Process で、PalServer の実行ファイルが対象のフォルダの下にあるか（シェルを通さない）。
// ServerSync が動いていると言うときも、この PC で動いているかを確かめる（ServerSync の共有で、別の PC が動かしているインスタンスの写しを
// 読んで送らないため）: pid がこの PC で生きていなければ止まっている。生きていれば、対象のフォルダの PalServer があるかを実行ファイルのパスで
// 確かめる。確かめた結果は同じ pid の間 30 秒だけ使い回し、過ぎたら確かめ直す（起動の途中で見つからなかった・後から替わったのを拾う）。
// 確かめられなかった（PowerShell の失敗・パスの取れない PalServer）ときは使い回さず次の確認でまた確かめ、その間は決められない（'unknown'）。
// 実行ファイルのパスを調べる手段がないとき（Windows 以外〔CI〕で execFile を渡さない）だけは ServerSync の答えのまま。
// ServerSync に届かない間の実行ファイルのパスの確認は 30 秒に 1 回（PowerShell を 10 秒ごとに起動しない）。
// どちらでも決められなければ 'unknown'（共有と自動登録をしない）。止まってから graceMs（60 秒）は動いているとみなす（最後の保存を拾う）。
// 起動・停止・保存の操作は持たない（読み取りの GET だけ）。REST（8212）は使わない（server の決定 9）。
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

export const SERVERSYNC_API = 'http://127.0.0.1:54866';
export const GRACE_MS = 60_000;
/** 実行ファイルのパスの確認の結果を使い回す長さ（ServerSync に届かない間・ServerSync が動いていると言う pid の確かめ） */
export const PROCESS_RECHECK_MS = 30_000;
const STATES = new Set(['Stopped', 'Installing', 'Starting', 'Ready']);
// 名前が PalServer で始まるプロセスの実行ファイルのパスを、1 行に 1 つ「>パス」で出す（パスが取れないものは「>」だけ）。
// 対象のフォルダは文に入れず、Node の側で比べる（コマンドに外の値を混ぜない）
const PROCESS_SCRIPT = "Get-CimInstance -ClassName Win32_Process -Filter \"Name LIKE 'PalServer%'\" | ForEach-Object { '>' + $_.ExecutablePath }";

/** ServerSync の GET /instances/<ID> の応答から、status の running・pid・state だけを取り出す。形が違えば null */
export function pickStatus(body) {
  const status = body && typeof body === 'object' ? body.status : null;
  if (!status || typeof status !== 'object' || typeof status.running !== 'boolean') return null;
  return {
    running: status.running,
    pid: Number.isSafeInteger(status.pid) && status.pid > 0 ? status.pid : null,
    state: STATES.has(status.state) ? status.state : '',
  };
}

// パスを比べる形（\ にそろえ、小文字にし、末尾の \ を外す）
const comparable = (value) => String(value ?? '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();

/** 実行ファイルのパスの一覧に、dir の下のものがあるか。'running'・'stopped'・'unknown'（パスが取れない PalServer がある） */
export function processStateOf(stdout, dir) {
  const base = comparable(dir);
  if (!base) return 'unknown';
  const paths = String(stdout ?? '').split(/\r?\n/).filter((line) => line.startsWith('>')).map((line) => comparable(line.slice(1).trim()));
  if (paths.some((exe) => exe.startsWith(`${base}\\`))) return 'running';
  // ほかのユーザーのプロセスなどでパスが取れないと、対象のサーバーかどうか決められない
  return paths.some((exe) => !exe) ? 'unknown' : 'stopped';
}

const defaultExecFile = promisify(execFileCallback);

/** pid のプロセスがこの PC で生きているか（ほかのユーザーのプロセスで EPERM なら生きている） */
export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

/**
 * サーバーの稼働の見張り。check() を呼ぶたびに今の状態を返す。
 * @param {{ instanceId?: string, serverDir?: string, fetch?: Function, execFile?: Function, alive?: Function|null, now?: () => number,
 *   graceMs?: number, apiBase?: string, timeoutMs?: number, platform?: string }} options
 *   fetch・execFile・alive は差し替えられる（テスト）。execFile(file, args, options) は { stdout } を返す Promise。alive(pid) は真偽。
 *   Windows 以外（CI）では、execFile・alive を渡さなければ実行ファイルのパス・pid では調べない
 */
export function createServerMonitor({
  instanceId = '', serverDir = '', fetch = globalThis.fetch, execFile, alive, now = Date.now, graceMs = GRACE_MS,
  apiBase = SERVERSYNC_API, timeoutMs = 3000, platform = process.platform,
} = {}) {
  const runFile = execFile ?? (platform === 'win32' ? defaultExecFile : null);
  const pidAlive = alive === undefined ? (platform === 'win32' ? isAlive : null) : alive;
  let lastRunningAt = null;
  // ServerSync が動いていると言う pid を、この PC で確かめた結果（{ pid, here: true|false, at }。確かめられなかったときは残さない）
  let confirmed = null;
  // ServerSync に届かない間の、実行ファイルのパスの確認の結果と時刻
  let processResult = null;

  // ServerSync のローカル API。{ running, pid, state } か、取れなければ失敗の種類（文に応答の中身を入れない）
  async function fromServerSync() {
    if (!instanceId || typeof fetch !== 'function') return { error: 'no-instance' };
    let status = null;
    try {
      const response = await fetch(`${apiBase}/instances/${encodeURIComponent(instanceId)}`, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return { error: `http-${response.status}` };
      // 応答の本文はここだけで使い、status の 3 項目を取り出したら捨てる
      status = pickStatus(JSON.parse(await response.text()));
    } catch (error) {
      return { error: error?.name === 'SyntaxError' ? 'bad-response' : 'unreachable' };
    }
    return status ?? { error: 'bad-response' };
  }

  async function fromProcess() {
    if (!serverDir || !runFile) return { error: 'no-process-check' };
    try {
      const { stdout } = await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PROCESS_SCRIPT], {
        windowsHide: true, timeout: timeoutMs * 3, maxBuffer: 1024 * 1024,
      });
      const state = processStateOf(stdout, serverDir);
      return state === 'unknown' ? { error: 'process-unknown' } : { running: state === 'running' };
    } catch {
      return { error: 'process-error' };
    }
  }

  // ServerSync が動いていると言う pid のサーバーが、この PC で動いているか（{ here: true|false }、確かめられなければ { error }）。
  // 同じ pid の確かめた結果は PROCESS_RECHECK_MS の間だけ使い回す
  async function runningHere(pid) {
    if (pid && pidAlive && !pidAlive(pid)) return { here: false };
    // 実行ファイルのパスを調べる手段がない（Windows 以外〔CI〕）: ServerSync の答えのまま
    if (!runFile) return { here: true };
    const key = pid ?? 0;
    if (confirmed?.pid === key && now() - confirmed.at < PROCESS_RECHECK_MS) return { here: confirmed.here };
    const proc = await fromProcess();
    if (proc.error) {
      confirmed = null;
      return { error: proc.error };
    }
    confirmed = { pid: key, here: proc.running, at: now() };
    return { here: proc.running };
  }

  // ServerSync に届かない間の実行ファイルのパスの確認（PROCESS_RECHECK_MS の間は前の結果を使い回す）
  async function fromProcessThrottled() {
    if (processResult && now() - processResult.at < PROCESS_RECHECK_MS) return processResult.value;
    const value = await fromProcess();
    processResult = { value, at: now() };
    return value;
  }

  return {
    /**
     * @returns {Promise<{ state: 'running'|'grace'|'stopped'|'unknown', active: boolean, source: 'serversync'|'process'|'',
     *   pid: number|null, serverState: string, stoppedFor: number|null, reasons: string[] }>}
     *   active は読み込み・共有・自動登録をしてよいか（running と grace）。reasons は取れなかった理由の種類（応答の中身は入れない）。
     *   serversync:not-here は、ServerSync は動いていると言うが、この PC では対象のサーバーが動いていない。serversync:unconfirmed は、
     *   この PC で動いているかを確かめられなかった（unknown）
     */
    async check() {
      const reasons = [];
      let decided = null;
      const api = await fromServerSync();
      if (api.error) {
        reasons.push(`serversync:${api.error}`);
      } else if (!api.running) {
        confirmed = null;
        decided = { running: false, pid: null, serverState: api.state, source: 'serversync' };
      } else {
        const here = await runningHere(api.pid);
        if (here.error) reasons.push('serversync:unconfirmed', here.error);
        else if (!here.here) reasons.push('serversync:not-here');
        if (!here.error) decided = { running: here.here, pid: here.here ? api.pid : null, serverState: api.state, source: 'serversync' };
      }
      // ServerSync に届いたら、使い回していた結果は捨てる（次に届かなくなったら、すぐ確かめる）
      if (!api.error) processResult = null;
      // ServerSync に届かないときだけ、実行ファイルのパスで決める（届いて確かめられなかったときは、いま確かめたばかりなので決められない）
      if (!decided && api.error) {
        const proc = await fromProcessThrottled();
        if (proc.error) reasons.push(proc.error);
        else decided = { running: proc.running, pid: null, serverState: '', source: 'process' };
      }
      const time = now();
      if (!decided) return { state: 'unknown', active: false, source: '', pid: null, serverState: '', stoppedFor: null, reasons };
      if (decided.running) {
        lastRunningAt = time;
        return { state: 'running', active: true, ...decided, stoppedFor: null, reasons };
      }
      const stoppedFor = lastRunningAt === null ? null : time - lastRunningAt;
      const grace = stoppedFor !== null && stoppedFor < graceMs;
      return { state: grace ? 'grace' : 'stopped', active: grace, ...decided, stoppedFor, reasons };
    },
  };
}
