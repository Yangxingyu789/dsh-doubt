# dsh-doubt offline upgrade launcher. ASCII-only console output; log written under _diag.
param(
  [string]$Profile = 'desktop',
  [string]$Repo = (Split-Path -Parent $PSScriptRoot),
  [string]$App = '',
  [switch]$CheckOnly,
  [int]$WaitMinutes = 15
)
$ErrorActionPreference = 'Continue'
if (-not (Test-Path (Join-Path $Repo 'package.json'))) { $Repo = Split-Path -Parent $PSScriptRoot }
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
  Say "DeepSeek Harness is still running (PID: $($running.Id -join ', '))."
  Say "Please FULLY QUIT DeepSeek Harness now (tray icon -> Exit, or Task Manager: end every 'DeepSeek Harness' process)."
  Say "This window waits up to $WaitMinutes minutes for it to exit, then upgrades and restarts DSH."
  $deadline = (Get-Date).AddMinutes($WaitMinutes)
  while (@(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue).Count -gt 0) {
    if ((Get-Date) -gt $deadline) {
      Say 'ERROR: timed out waiting for DeepSeek Harness to exit; no changes made.'
      exit 2
    }
    Start-Sleep -Seconds 2
  }
  Say 'DeepSeek Harness exited; proceeding with upgrade.'
}
Say 'running scripts\upgrade-offline.ps1 ...'
$out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Repo 'scripts\upgrade-offline.ps1') -Profile $Profile -Repo $Repo 2>&1
$out | ForEach-Object { Say "  $_" }
if ($LASTEXITCODE -ne 0) {
  Say "UPGRADE FAILED exit=$LASTEXITCODE (see messages above; backups under _diag\offline-upgrade-backup-*)"
  exit 1
}
Say 'upgrade OK; starting DeepSeek Harness'
if (-not $App) {
  if ($env:DSH_APP_DIR) {
    $App = Join-Path $env:DSH_APP_DIR 'DeepSeek Harness.exe'
  } else {
    $candidates = @(
      (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\DeepSeek Harness.exe'),
      (Join-Path $env:ProgramFiles 'DeepSeek Harness\DeepSeek Harness.exe')
    )
    $App = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  }
}
if ($App -and (Test-Path $App)) { Start-Process -FilePath $App | Out-Null; Say 'started DeepSeek Harness' }
else { Say 'WARN: DeepSeek Harness not found; start it manually or pass -App <path>' }
Say 'done'
