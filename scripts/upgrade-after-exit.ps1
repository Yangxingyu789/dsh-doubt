# dsh-doubt 退出后自动升级（由会话内启动的独立进程运行）
#
# 用途：当前运行中的 0.7.0 前置闸门会拒绝「宿主运行时的 live 安装/写入」，
# 所以升级必须等 DSH 完全退出。本脚本由 Lead 在会话里用 Start-Process 启动，
# 它独立于 DSH 进程；你只需要彻底退出 DSH（任务管理器结束所有 "DeepSeek Harness"），
# 它会：
#   1) 等待宿主进程全部退出（最多 30 分钟）
#   2) 调用 scripts/upgrade-offline.ps1（构建/备份/复制/pnpm offline/hash 校验）
#   3) 成功后自动重新启动 DeepSeek Harness
#   4) 全程日志写到 _diag\upgrade-after-exit.log
#
# 手动运行方式（如自动进程没跑）：
#   pwsh -NoProfile -ExecutionPolicy Bypass -File C:\work\dsh-doubt\scripts\upgrade-after-exit.ps1
param(
  [string]$Profile = 'desktop',
  [string]$Repo = (Split-Path -Parent $PSScriptRoot),
  [string]$AppPath = 'E:\dsh\DeepSeek Harness.exe',
  [int]$TimeoutMinutes = 30
)
$logDir = Join-Path $Repo '_diag'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$log = Join-Path $logDir 'upgrade-after-exit.log'
function Log([string]$text) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $text"
  Add-Content -Path $log -Value $line -Encoding utf8
}

Log "start: waiting for DeepSeek Harness to exit (timeout ${TimeoutMinutes}m, profile=$Profile, repo=$Repo)"
$deadline = (Get-Date).AddMinutes($TimeoutMinutes)
while ((Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue).Count -gt 0) {
  if ((Get-Date) -gt $deadline) { Log 'FAIL: timeout waiting for host exit; no files changed'; exit 1 }
  Start-Sleep -Seconds 2
}
Log 'host exited; running offline upgrade'

try {
  $out = & pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'upgrade-offline.ps1') -Profile $Profile -Repo $Repo 2>&1
  $out | ForEach-Object { Log "  $_" }
  if ($LASTEXITCODE -ne 0) {
    Log "FAIL: upgrade-offline exited $LASTEXITCODE; DSH not restarted. Rollback commands are in the log above / backup folder."
    exit 1
  }
} catch {
  Log "FAIL: upgrade-offline threw: $($_.Exception.Message)"
  exit 1
}

Log 'upgrade OK; restarting DeepSeek Harness'
if (Test-Path $AppPath) {
  Start-Process -FilePath $AppPath | Out-Null
  Log 'host restart requested'
} else {
  Log "WARN: app not found at $AppPath; start DeepSeek Harness manually"
}
Log 'done'
