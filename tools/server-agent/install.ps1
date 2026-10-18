# 常駐（server-agent）を Windows に入れる（docs/server/README.md の T5「Windows での導入」）。実行はユーザー（管理者は要らない）。
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\server-agent\install.ps1 -Env prod -UserId <常駐の ID> [-WorldName <名前>] [-Instance <ID>] [-SkipCheck]
# - node（22 以上）と git があるかを確かめる。なければ winget の案内を出して止まる
# - <データ>\config.json（秘密なし。prod なら "env": "prod"）を書き、node main.mjs --check で設定と発見を確かめる（ネットにつながない）。
#   前の config.json の項目は残し、引数で渡したものだけを書き換える。--check が通らなければ元に戻して止まる
# - 共通パスワードを 2 回聞き、DPAPI（この Windows ユーザーに結び付く）で暗号化して <データ>\<env>\passcode.dpapi に保存する（平文の環境変数にしない）
# - タスク スケジューラに「PalNoteServerAgent-<env>」を登録する（ログオン時・このユーザー・Interactive・時間の上限なし）。操作は run-agent.ps1
# 共通パスワードを変えたら、もう一度実行する。暗号化はこの PC のこの Windows ユーザーでしか戻せないので、入れる PC・ユーザーごとに実行する。
# <データ> は %LOCALAPPDATA%\pal-note-agent（環境変数 PAL_AGENT_DATA_DIR で変えられる。tools/server-agent/config.mjs の dataDirOf と同じ）。
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('prod', 'test')][string]$Env,
  [Parameter(Mandatory = $true)][string]$UserId,
  [string]$WorldName = '',
  [string]$Instance = '',
  [switch]$SkipCheck
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0

# pwsh 7 から powershell.exe を呼ぶと PSModulePath に pwsh のモジュールが残り、ConvertFrom-SecureString などを読み込めなくなる
if ($PSVersionTable.PSEdition -eq 'Desktop' -and $env:PSModulePath) {
  $env:PSModulePath = (@($env:PSModulePath -split ';') | Where-Object { $_ -and $_ -notmatch '[\\/]PowerShell[\\/]' }) -join ';'
}

$MinNodeMajor = 22
# config.mjs が読む項目（ほかの項目は書かない）
$FileKeys = @('env', 'userId', 'worldDir', 'serverRoot', 'instance', 'worldName', 'autoRegister')
$EnvName = $Env.ToLowerInvariant()
$OtherEnv = if ($EnvName -eq 'prod') { 'test' } else { 'prod' }
$TaskName = "PalNoteServerAgent-$EnvName"
$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$MainScript = Join-Path $PSScriptRoot 'main.mjs'
$RunAgent = Join-Path $PSScriptRoot 'run-agent.ps1'
$DataDir = if ($env:PAL_AGENT_DATA_DIR) { $env:PAL_AGENT_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'pal-note-agent' }
$EnvDir = Join-Path $DataDir $EnvName
$ConfigFile = Join-Path $DataDir 'config.json'
$PasscodeFile = Join-Path $EnvDir 'passcode.dpapi'
$Utf8 = New-Object System.Text.UTF8Encoding($false)

function Stop-Install([string]$Message) {
  Write-Host "[中止] $Message" -ForegroundColor Red
  exit 1
}

# 2 つの SecureString が同じか（平文の文字列を作らずに比べる）
function Test-SameSecret([securestring]$First, [securestring]$Second) {
  if ($First.Length -ne $Second.Length) { return $false }
  $a = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($First)
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Second)
  try {
    $same = $true
    for ($offset = 0; $offset -lt $First.Length * 2; $offset += 2) {
      if ([Runtime.InteropServices.Marshal]::ReadInt16($a, $offset) -ne [Runtime.InteropServices.Marshal]::ReadInt16($b, $offset)) { $same = $false }
    }
    return $same
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($a)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)
  }
}

# ---- 前提（node・git・リポジトリ） ----

$node = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $node) {
  Stop-Install "Node.js が見つかりません。次で入れてから、新しい PowerShell の窓で実行し直してください: winget install --id OpenJS.NodeJS.LTS -e"
}
$nodeVersion = [string](& $node.Source --version)
$nodeMajor = if ($nodeVersion -match '^v(\d+)\.') { [int]$Matches[1] } else { 0 }
if ($nodeMajor -lt $MinNodeMajor) {
  Stop-Install "Node.js $MinNodeMajor 以上が要ります（今は $nodeVersion）。次で新しくしてください: winget upgrade --id OpenJS.NodeJS.LTS -e"
}
if (-not (Get-Command git.exe -CommandType Application -ErrorAction SilentlyContinue)) {
  Stop-Install "git が見つかりません（更新の git pull に使います）。次で入れてから、新しい PowerShell の窓で実行し直してください: winget install --id Git.Git -e"
}
if (-not (Test-Path -LiteralPath $MainScript) -or -not (Test-Path -LiteralPath $RunAgent)) {
  Stop-Install 'tools\server-agent の main.mjs・run-agent.ps1 が見つかりません。git clone したリポジトリの中の install.ps1 を実行してください'
}
# config.json は env で分かれないので、prod と test を同じ Windows ユーザーに入れない（片方の設定で、もう片方が止まるため）
if (Get-ScheduledTask -TaskName "PalNoteServerAgent-$OtherEnv" -ErrorAction SilentlyContinue) {
  Stop-Install "この Windows ユーザーには PalNoteServerAgent-$OtherEnv が入っています。prod と test は同じユーザーに入れられません（先に Unregister-ScheduledTask -TaskName PalNoteServerAgent-$OtherEnv で消してください）"
}
if ($Instance -and $Instance.Trim() -notmatch '^[A-Za-z0-9_-]{1,64}$') {
  Stop-Install '-Instance は ServerSync のインスタンス ID（英数字と - _）にしてください'
}

# ---- config.json（秘密なし） ----

$previousConfig = $null
$config = [ordered]@{}
if (Test-Path -LiteralPath $ConfigFile) {
  $previousConfig = [IO.File]::ReadAllText($ConfigFile)
  $existing = $null
  try { $existing = $previousConfig.TrimStart([char]0xFEFF) | ConvertFrom-Json } catch { $existing = $null }
  if ($existing -isnot [System.Management.Automation.PSCustomObject]) {
    Stop-Install "config.json を読めません（JSON の { … } の形ではありません）。直すか消してから実行し直してください: $ConfigFile"
  }
  foreach ($key in $FileKeys) {
    $property = $existing.PSObject.Properties[$key]
    if ($property -and $null -ne $property.Value) { $config[$key] = $property.Value }
  }
}
$config['env'] = $EnvName
$config['userId'] = $UserId.Trim()
if ($WorldName.Trim()) { $config['worldName'] = $WorldName.Trim() }
if ($Instance.Trim()) { $config['instance'] = $Instance.Trim() }
$ordered = [ordered]@{}
foreach ($key in $FileKeys) {
  if ($config.Contains($key)) { $ordered[$key] = $config[$key] }
}
[IO.Directory]::CreateDirectory($EnvDir) | Out-Null
[IO.File]::WriteAllText($ConfigFile, ($ordered | ConvertTo-Json) + "`n", $Utf8)
Write-Host "config.json を書きました（env=$EnvName。パスワードは書いていません）"

# 設定と発見を確かめる（ネットにつながず、セーブを読むだけ）。通らなければ config.json を元に戻す
if (-not $SkipCheck) {
  Write-Host '設定とワールドの発見を確かめます（node main.mjs --check）'
  & $node.Source $MainScript --env $EnvName --check
  $checkCode = $LASTEXITCODE
  if ($checkCode -ne 0) {
    if ($null -ne $previousConfig) { [IO.File]::WriteAllText($ConfigFile, $previousConfig, $Utf8) } else { Remove-Item -LiteralPath $ConfigFile -Force }
    Stop-Install "--check が終了コード $checkCode で終わったので、config.json を元に戻しました。上の [error] を直してから実行し直してください（サーバーのセーブがまだないときは -SkipCheck）"
  }
}

# ---- 共通パスワード（DPAPI） ----

Write-Host "GAS の共通パスワード（$EnvName）を入れてください。画面には出ず、この Windows ユーザーだけが戻せる形（DPAPI）で保存します"
$first = Read-Host -AsSecureString 'パスワード'
if ($first.Length -eq 0) { Stop-Install 'パスワードが空です' }
$second = Read-Host -AsSecureString 'もう一度'
$same = Test-SameSecret $first $second
$second.Dispose()
if (-not $same) {
  $first.Dispose()
  Stop-Install '2 回の入力が違います（パスワードは保存していません）'
}
$encrypted = ConvertFrom-SecureString -SecureString $first
$first.Dispose()
$temporary = "$PasscodeFile.tmp"
[IO.File]::WriteAllText($temporary, $encrypted, [Text.Encoding]::ASCII)
Move-Item -LiteralPath $temporary -Destination $PasscodeFile -Force
Write-Host 'パスワードを暗号化して保存しました（passcode.dpapi）'

# ---- タスク スケジューラ ----

$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$RunAgent`" -Env $EnvName"
try {
  $action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $RepoRoot
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
  $principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
  # 時間の上限なし（既定の 3 日で止めない）・二重に動かさない・電池でも動く・逃した起動はできるときに
  $settingsOptions = @{
    ExecutionTimeLimit = [TimeSpan]::Zero
    MultipleInstances = 'IgnoreNew'
    AllowStartIfOnBatteries = $true
    DontStopIfGoingOnBatteries = $true
    StartWhenAvailable = $true
  }
  $settings = New-ScheduledTaskSettingsSet @settingsOptions
  $task = @{
    TaskName = $TaskName
    Action = $action
    Trigger = $trigger
    Principal = $principal
    Settings = $settings
    Description = "パル配合ノートの常駐（server-agent・$EnvName）。tools\server-agent\run-agent.ps1 を動かす"
    Force = $true
  }
  Register-ScheduledTask @task | Out-Null
} catch {
  Stop-Install "タスクを登録できませんでした（$($_.Exception.Message)）。管理者ではない、いつもの PowerShell の窓で実行してください"
}

Write-Host ''
Write-Host "入れました（タスク $TaskName）。次のログオンから動きます。" -ForegroundColor Green
$stopFile = Join-Path $EnvDir 'stop.request'
if ((Get-ScheduledTask -TaskName $TaskName).State -eq 'Running') {
  Write-Host '常駐はいま動いていて、前の設定とパスワードのままです。次の順で動かし直してください:'
  Write-Host "  Set-Content -LiteralPath `"$stopFile`" -Value stop    # 常駐が数秒で止まる"
  Write-Host "  (Get-ScheduledTask -TaskName $TaskName).State           # Ready になったら次へ"
  Write-Host "  Start-ScheduledTask -TaskName $TaskName"
} else {
  Write-Host "今すぐ動かすには: Start-ScheduledTask -TaskName $TaskName"
}
Write-Host "ログ: $EnvDir の agent.log（常駐）と run-agent.log（起動と終了コード）"
