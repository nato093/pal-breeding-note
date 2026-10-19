// 常駐の Windows での導入（tools/server-agent/install.ps1・run-agent.ps1）。CI は Linux なので動かさず、
// 中身の決まり（文字コード・パスワードの扱い・終了コード・データの場所・タスクの設定）を main.mjs・config.mjs と照らす。
// pwsh があれば構文も確かめる（なければ飛ばす）。タスクが動かすのは Windows PowerShell 5.1（install.ps1 の powershell.exe）なので、
// Windows ではそちらでも -Mode Check と構文を確かめる（最終レビュー）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EXIT } from '../../tools/server-agent/main.mjs';
import { dataDirOf, loadConfig, parseAgentArgs } from '../../tools/server-agent/config.mjs';

const DIR = fileURLToPath(new URL('../../tools/server-agent/', import.meta.url));
const INSTALL = path.join(DIR, 'install.ps1');
const RUN_AGENT = path.join(DIR, 'run-agent.ps1');
const read = (file) => fs.readFileSync(file, 'utf8');
// PowerShell の @('a', 'b') の中身
const listOf = (text) => [...text.matchAll(/'([^']*)'|(-?\d+)/g)].map((match) => match[1] ?? Number(match[2]));
// 確かめる PowerShell（pwsh 7 と、Windows では Windows PowerShell 5.1）
const SHELLS = [['pwsh', 'pwsh'], ...(process.platform === 'win32'
  ? [['Windows PowerShell 5.1', path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')]] : [])];

test('常駐の導入: Windows PowerShell 5.1 が日本語を読めるよう、どちらも UTF-8 の BOM 付き', () => {
  for (const file of [INSTALL, RUN_AGENT]) {
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.subarray(0, 3).toString('hex'), 'efbbbf', `${path.basename(file)} に BOM がある`);
  }
});

test('常駐の導入: パスワードは DPAPI で保存し、自分やユーザーの環境変数に置かず、子の node にだけ渡す', () => {
  const install = read(INSTALL);
  const runAgent = read(RUN_AGENT);
  for (const [name, text] of [['install.ps1', install], ['run-agent.ps1', runAgent]]) {
    assert.doesNotMatch(text, /\$env:PAL_AGENT_PASSCODE\s*=/i, `${name} は自分の環境変数に置かない`);
    assert.doesNotMatch(text, /SetEnvironmentVariable/i, `${name} はユーザーの環境変数に置かない`);
    assert.doesNotMatch(text, /-AsPlainText/i, `${name} は平文から SecureString を作らない`);
  }
  assert.match(install, /Read-Host -AsSecureString/);
  assert.match(install, /ConvertFrom-SecureString -SecureString/);
  assert.doesNotMatch(install, /ConvertFrom-SecureString[^\n]*-Key/i, 'DPAPI（鍵を渡さない）');
  assert.match(install, /'passcode\.dpapi'/);
  assert.match(runAgent, /'passcode\.dpapi'/);
  assert.match(runAgent, /ConvertTo-SecureString -String/);
  assert.match(runAgent, /\.EnvironmentVariables\['PAL_AGENT_PASSCODE'\] = \$Passcode/);
  assert.match(runAgent, /UseShellExecute = \$false/);
});

test('常駐の導入: 起動し直さない終了コードは main.mjs の 0 正常・2 設定の誤り・3 二重起動', () => {
  const match = read(RUN_AGENT).match(/\$NoRestartCodes = @\(([^)]*)\)/);
  assert.ok(match);
  assert.deepEqual(listOf(match[1]).sort(), [EXIT.OK, EXIT.CONFIG, EXIT.RUNNING].sort());
  assert.match(read(RUN_AGENT), /\$RestartDelaySeconds = 30\b/);
});

test('常駐の導入: run-agent.ps1 の動かし方は main.mjs の引数として読める', () => {
  const text = read(RUN_AGENT);
  const block = text.match(/\$ModeArgs = @\{([\s\S]*?)\n\}/);
  assert.ok(block);
  const modes = Object.fromEntries([...block[1].matchAll(/^\s*(\w+) = @\(([^)]*)\)/gm)].map((match) => [match[1], listOf(match[2])]));
  assert.deepEqual(Object.keys(modes).sort(), ['AcceptWorld', 'Check', 'CheckOnline', 'Run', 'Signup']);
  const validate = text.match(/\[ValidateSet\(([^)]*)\)\]\[string\]\$Mode/);
  assert.deepEqual(listOf(validate[1]).sort(), Object.keys(modes).sort(), '-Mode の選択肢と引数の表が同じ');
  for (const [mode, args] of Object.entries(modes)) {
    const { flags } = parseAgentArgs(['--env', 'test', ...args]);
    assert.equal(flags.check, args.includes('--check'), mode);
  }
  assert.deepEqual(modes.CheckOnline, ['--check', '--online']);
  // 子には --env <env> を必ず付ける
  assert.match(text, /@\("`"\$MainScript`"", '--env', \$EnvName\)/);
});

test('常駐の導入: データの場所と config.json の項目は config.mjs と同じ', () => {
  for (const text of [read(INSTALL), read(RUN_AGENT)]) {
    assert.match(text, /\$env:PAL_AGENT_DATA_DIR\) \{ \$env:PAL_AGENT_DATA_DIR \} else \{ Join-Path \$env:LOCALAPPDATA 'pal-note-agent' \}/);
  }
  assert.equal(dataDirOf({ LOCALAPPDATA: 'L' }), path.join('L', 'pal-note-agent'));
  assert.equal(dataDirOf({ LOCALAPPDATA: 'L', PAL_AGENT_DATA_DIR: 'D' }), 'D');

  const keys = listOf(read(INSTALL).match(/\$FileKeys = @\(([^)]*)\)/)[1]);
  const file = { env: 'prod', userId: 'サーバー', worldDir: 'C:\\w', serverRoot: 'C:\\s', instance: 'TESTINSTA0000001', worldName: 'ダミー', autoRegister: false };
  assert.deepEqual([...keys].sort(), Object.keys(file).sort());
  const config = loadConfig({
    argv: ['--env', 'prod'], env: { PAL_AGENT_DATA_DIR: 'D' },
    readFile: () => `\uFEFF${JSON.stringify(file, null, 4)}\n`,
  });
  assert.deepEqual(config.warnings, [], 'install.ps1 が書く項目はどれも config.mjs が読む');
  assert.equal(config.env, 'prod');
});

test('常駐の導入: タスクはログオン時・このユーザー・Interactive・時間の上限なし・二重に動かさない・電池でも動く', () => {
  const text = read(INSTALL);
  assert.match(text, /\$TaskName = "PalNoteServerAgent-\$EnvName"/);
  // データの場所は引数で渡す（ログオン時のタスクは、導入した窓だけの PAL_AGENT_DATA_DIR を受け継がない）
  assert.match(text, /"-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"\$RunAgent`" -Env \$EnvName -DataDir `"\$DataDir`""/);
  assert.match(text, /\$DataDir = \[IO\.Path\]::GetFullPath\(\$DataDir\)\.TrimEnd\('\\', '\/'\)/);
  assert.match(text, /New-ScheduledTaskTrigger -AtLogOn -User \$identity/);
  assert.match(text, /New-ScheduledTaskPrincipal -UserId \$identity -LogonType Interactive -RunLevel Limited/);
  for (const setting of [
    /ExecutionTimeLimit = \[TimeSpan\]::Zero/, /MultipleInstances = 'IgnoreNew'/, /AllowStartIfOnBatteries = \$true/,
    /DontStopIfGoingOnBatteries = \$true/, /StartWhenAvailable = \$true/,
  ]) assert.match(text, setting);
  assert.match(text, /winget install --id OpenJS\.NodeJS\.LTS -e/);
  assert.match(text, /winget install --id Git\.Git -e/);
});

test('常駐の導入: run-agent.ps1 は -DataDir のデータの場所を使い、子の node にも渡す（Windows で、pwsh と Windows PowerShell 5.1 があれば動かす）', async (t) => {
  const runAgent = read(RUN_AGENT);
  assert.match(runAgent, /\[string\]\$DataDir = ''/);
  assert.match(runAgent, /\$info\.EnvironmentVariables\['PAL_AGENT_DATA_DIR'\] = \$DataDir/);
  if (process.platform !== 'win32') {
    t.skip('Windows だけ（run-agent.ps1 は node.exe を探す）');
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pal-agent-ps-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // config.json はデータの場所にだけ置く（%LOCALAPPDATA% は空。データの場所が子に届かなければワールドが見つからない）
  const dataDir = path.join(root, 'data dir');
  const worldDir = path.join(root, 'srv', 'Pal', 'Saved', 'SaveGames', '0', 'ABCDEF0123456789ABCDEF0123456789');
  fs.mkdirSync(worldDir, { recursive: true });
  for (const name of ['Level.sav', 'LevelMeta.sav']) fs.writeFileSync(path.join(worldDir, name), 'x');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ env: 'test', worldDir }));
  const env = { ...process.env, LOCALAPPDATA: path.join(root, 'empty') };
  delete env.PAL_AGENT_DATA_DIR;
  for (const [name, shell] of SHELLS) {
    await t.test(name, (s) => {
      const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', RUN_AGENT, '-Env', 'test', '-Mode', 'Check', '-DataDir', dataDir], {
        encoding: 'utf8', env, timeout: 60_000,
      });
      if (result.error?.code === 'ENOENT') {
        s.skip(`${name} がない`);
        return;
      }
      assert.match(result.stdout, /world source="worldDir"/, `${result.stdout}\n${result.stderr}`);
    });
  }
});

test('常駐の導入: pwsh（Windows では Windows PowerShell 5.1 も）で構文の誤りがない', async (t) => {
  const quote = (file) => `'${file.replace(/'/g, "''")}'`;
  const script = [INSTALL, RUN_AGENT].map((file) => (
    `$e = $null; [System.Management.Automation.Language.Parser]::ParseFile(${quote(file)}, [ref]$null, [ref]$e) | Out-Null; `
    + `foreach ($x in $e) { [Console]::Out.WriteLine(${quote(path.basename(file))} + ':' + $x.Extent.StartLineNumber + ': ' + $x.Message) }`
  )).join('; ');
  for (const [name, shell] of SHELLS) {
    await t.test(name, (s) => {
      const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 60_000 });
      if (result.error?.code === 'ENOENT') {
        s.skip(`${name} がない`);
        return;
      }
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), '', '構文の誤り');
    });
  }
});
