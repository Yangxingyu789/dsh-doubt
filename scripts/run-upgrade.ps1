# dsh-doubt 升级启动器（ASCII 输出，始终留下控制台/日志，避免闪退看不到错误）
param(
  [string]$Profile = 'desktop',
  [string]$Repo = 'C:\work\dsh-doubt',
  [switch]$CheckOnly
)
$ErrorActionPreference = 'Continue'
$log = Join-Path $Repo '_diag\upgrade-console.log'
New-Item -ItemType Directory -Path (Split-Path $log) -Force | Out-Null
function Say([string]$m) {
  Write-Host $m
  Add-Content -Path $log -Value ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) -Encoding utf8
}
Say '=========================================='
Say ' dsh-doubt offline upgrade launcher'
Say '=========================================='
Say "now=$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') repo=$Repo profile=$Profile"
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
$pnpm = (Get-Command pnpm.cmd -ErrorAction SilentlyContinue).Source
if (-not $pnpm) { foreach ($c in @("$env:APPDATA\npm\pnpm.cmd", "$env:USERPROFILE\AppData\Roaming\npm\pnpm.cmd")) { if (Test-Path $c) { $pnpm = $c; break } } }
Say "node=$node"
Say "pnpm=$pnpm"
$running = @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)
Say "deepseek-harness-running=$($running.Count)"
if ($CheckOnly) { Say 'CHECK-ONLY: launcher works, no upgrade attempted'; exit 0 }
if ($running.Count -gt 0) {
  Say 'ERROR: DeepSeek Harness is still running.'
  Say 'Fully quit it first (Task Manager: end every "DeepSeek Harness" process), then run again.'
  exit 2
}
Say 'running scripts\upgrade-offline.ps1 ...'
$out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Repo 'scripts\upgrade-offline.ps1') -Profile $Profile -Repo $Repo 2>&1
$out | ForEach-Object { Say "  $_" }
if ($LASTEXITCODE -ne 0) {
  Say "UPGRADE FAILED exit=$LASTEXITCODE (see messages above; backups under _diag\offline-upgrade-backup-*)"
  exit 1
}
Say 'upgrade OK; starting DeepSeek Harness'
$app = 'E:\dsh\DeepSeek Harness.exe'
if (Test-Path $app) { Start-Process -FilePath $app | Out-Null; Say 'started DeepSeek Harness' }
else { Say "WARN: $app not found; start it manually" }
Say 'done'
