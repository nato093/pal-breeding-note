# 常駐（server-agent）を動かす（install.ps1 が登録するタスクの操作。docs/server/README.md の T5「Windows での導入」）。
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\server-agent\run-agent.ps1 -Env prod [-Mode Run|Check|CheckOnline|AcceptWorld|Signup] [-DataDir <データの場所>]
# - <データ>\<env>\passcode.dpapi を DPAPI で戻し、子の node の環境変数 PAL_AGENT_PASSCODE にだけ渡す
#   （ProcessStartInfo の写しに置くので、このプロセスの環境変数・ユーザーの環境変数には残らない）
# - Run（既定。タスク）: node main.mjs --env <env> を動かす。終了コードが 0・2・3 以外なら 30 秒後に起動し直す（待つ間に stop.request があれば止まる）
# - ほか: 1 回だけ動かし、node の終了コードで終わる。Check は --check（パスワードを使わない）、CheckOnline は --check --online、
#   AcceptWorld は --accept-world、Signup は --signup
# ログ（<データ>\<env>\run-agent.log）には起動・終了コード・起動し直しだけを書く（パスワード・パス・ID を書かない）。常駐のログは agent.log
param(
  [Parameter(Mandatory = $true)][ValidateSet('prod', 'test')][string]$Env,
  [ValidateSet('Run', 'Check', 'CheckOnline', 'AcceptWorld', 'Signup')][string]$Mode = 'Run',
  # データの場所（install.ps1 がタスクの引数に入れる。なければ PAL_AGENT_DATA_DIR・%LOCALAPPDATA%\pal-note-agent）。子の node にも渡す
  [string]$DataDir = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0

# pwsh 7 から powershell.exe を呼ぶと PSModulePath に pwsh のモジュールが残り、ConvertTo-SecureString などを読み込めなくなる
if ($PSVersionTable.PSEdition -eq 'Desktop' -and $env:PSModulePath) {
  $env:PSModulePath = (@($env:PSModulePath -split ';') | Where-Object { $_ -and $_ -notmatch '[\\/]PowerShell[\\/]' }) -join ';'
}

# main.mjs の終了コード（EXIT）のうち、起動し直しても直らないもの: 0 正常・2 設定や環境の誤り・3 二重起動
$NoRestartCodes = @(0, 2, 3)
$RestartDelaySeconds = 30
$StopPollSeconds = 2
$LogMaxBytes = 1MB
$ModeArgs = @{
  Run = @()
  Check = @('--check')
  CheckOnline = @('--check', '--online')
  AcceptWorld = @('--accept-world')
  Signup = @('--signup')
}

$EnvName = $Env.ToLowerInvariant()
$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$MainScript = Join-Path $PSScriptRoot 'main.mjs'
$DataDir = if ($DataDir) { $DataDir } elseif ($env:PAL_AGENT_DATA_DIR) { $env:PAL_AGENT_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'pal-note-agent' }
$EnvDir = Join-Path $DataDir $EnvName
$PasscodeFile = Join-Path $EnvDir 'passcode.dpapi'
$StopFile = Join-Path $EnvDir 'stop.request'
$LogFile = Join-Path $EnvDir 'run-agent.log'
$Utf8 = New-Object System.Text.UTF8Encoding($false)

function Write-RunLog([string]$Level, [string]$Message) {
  $line = '{0} [{1}] {2}' -f [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ'), $Level, $Message
  if ($Mode -ne 'Run') { Write-Host $line }
  try {
    [IO.Directory]::CreateDirectory($EnvDir) | Out-Null
    if ((Test-Path -LiteralPath $LogFile) -and (Get-Item -LiteralPath $LogFile).Length -gt $LogMaxBytes) {
      Move-Item -LiteralPath $LogFile -Destination "$LogFile.1" -Force
    }
    [IO.File]::AppendAllText($LogFile, $line + [Environment]::NewLine, $Utf8)
  } catch {
    # ログに書けなくても常駐は動かす
  }
}

# passcode.dpapi を戻す。ないとき・戻せないときは $null（例外の文はパスワードを含みえないが、決まった文だけをログに出す）
function Read-Passcode {
  if (-not (Test-Path -LiteralPath $PasscodeFile)) {
    Write-RunLog 'error' 'passcode.dpapi がありません。install.ps1 を実行してください'
    return $null
  }
  $secure = $null
  try {
    $secure = ConvertTo-SecureString -String ([IO.File]::ReadAllText($PasscodeFile).Trim())
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
      return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
  } catch {
    Write-RunLog 'error' 'passcode.dpapi を戻せません（別の Windows ユーザー・別の PC で作ったか、壊れています）。install.ps1 をやり直してください'
    return $null
  } finally {
    if ($secure) { $secure.Dispose() }
  }
}

# node main.mjs --env <env> <引数> を動かし、終わるまで待って終了コードを返す。パスワードは子の環境変数にだけ置く
function Invoke-Agent([string]$NodePath, [string[]]$AgentArgs, [string]$Passcode) {
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $NodePath
  $info.Arguments = (@("`"$MainScript`"", '--env', $EnvName) + $AgentArgs) -join ' '
  $info.WorkingDirectory = $RepoRoot
  $info.UseShellExecute = $false
  # 子の node（config.mjs の dataDirOf）が、このスクリプトと同じデータの場所を使うように
  $info.EnvironmentVariables['PAL_AGENT_DATA_DIR'] = $DataDir
  if ($Passcode) { $info.EnvironmentVariables['PAL_AGENT_PASSCODE'] = $Passcode } else { $info.EnvironmentVariables.Remove('PAL_AGENT_PASSCODE') }
  $process = [System.Diagnostics.Process]::Start($info)
  $info.EnvironmentVariables.Remove('PAL_AGENT_PASSCODE')
  try {
    $process.WaitForExit()
    return $process.ExitCode
  } finally {
    $process.Dispose()
  }
}

$node = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $node) {
  Write-RunLog 'error' 'node が見つかりません（Node.js 22 以上を入れてください: winget install --id OpenJS.NodeJS.LTS -e）'
  exit 2
}
if (-not (Test-Path -LiteralPath $MainScript)) {
  Write-RunLog 'error' 'main.mjs が見つかりません（git clone したリポジトリの run-agent.ps1 を動かしてください）'
  exit 2
}

# 確かめるための 1 回だけの動かし方（窓に出す）
if ($Mode -ne 'Run') {
  $passcode = $null
  if ($Mode -ne 'Check') {
    $passcode = Read-Passcode
    if (-not $passcode) { exit 2 }
  }
  $code = Invoke-Agent $node.Source $ModeArgs[$Mode] $passcode
  $passcode = $null
  exit $code
}

# 常駐（タスク）。前に残った stop.request は消す（動いていない間に置かれたもので、今の起動を止めないため）
if (Test-Path -LiteralPath $StopFile) {
  Remove-Item -LiteralPath $StopFile -Force
  Write-RunLog 'info' '前に残った stop.request を消しました'
}
Write-RunLog 'info' "start env=$EnvName"
while ($true) {
  $passcode = Read-Passcode
  if (-not $passcode) { exit 2 }
  try {
    $code = Invoke-Agent $node.Source $ModeArgs['Run'] $passcode
  } catch {
    Write-RunLog 'error' 'node を起動できませんでした'
    $code = 1
  } finally {
    $passcode = $null
  }
  Write-RunLog 'info' "exit code=$code"
  if ($NoRestartCodes -contains $code) { exit $code }
  Write-RunLog 'warn' "$RestartDelaySeconds 秒後に起動し直します"
  for ($waited = 0; $waited -lt $RestartDelaySeconds; $waited += $StopPollSeconds) {
    Start-Sleep -Seconds $StopPollSeconds
    if (Test-Path -LiteralPath $StopFile) {
      Remove-Item -LiteralPath $StopFile -Force
      Write-RunLog 'info' 'stop.request があったので起動し直さずに止めます'
      exit 0
    }
  }
}
