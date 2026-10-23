# dsh-doubt offline upgrade. Run only after DeepSeek Harness has fully exited.
# Builds the plugin, backs up the plugin/profile files, copies the build and verifies hashes.
# Usage: pwsh -NoProfile -ExecutionPolicy Bypass -File <repo>\scripts\upgrade-offline.ps1
param(
  [string]$Profile = 'desktop',
  [string]$Repo = (Split-Path -Parent $PSScriptRoot),
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path (Join-Path $Repo 'package.json'))) {
  $Repo = Split-Path -Parent $PSScriptRoot
}

Write-Host "== dsh-doubt offline upgrade =="
Write-Host "repo   : $Repo"
Write-Host "profile: $Profile"

$running = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue
if ($running -and -not $DryRun) {
  Write-Host "FAIL: DeepSeek Harness 仍在运行（PID: $($running.Id -join ', ')）。请先在任务管理器结束所有进程再运行本脚本。" -ForegroundColor Red
  exit 1
}
if ($running) { Write-Host "WARN: host is running (DryRun only, no changes will be made): $($running.Id -join ', ')" }

$homeDir = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$pluginDir = Join-Path $homeDir 'plugins\dsh-doubt'
$profileDir = Join-Path $homeDir "profiles\$Profile"
if (-not (Test-Path $profileDir)) { Write-Host "FAIL: profile 不存在：$profileDir" -ForegroundColor Red; exit 1 }
if (-not (Test-Path (Join-Path $Repo 'package.json'))) { Write-Host "FAIL: 仓库路径不对：$Repo" -ForegroundColor Red; exit 1 }

$repoPkg = [System.IO.File]::ReadAllText((Join-Path $Repo 'package.json'), [System.Text.Encoding]::UTF8) | ConvertFrom-Json
Write-Host "target version: $($repoPkg.version)"
$current = if (Test-Path (Join-Path $pluginDir 'package.json')) { ([System.IO.File]::ReadAllText((Join-Path $pluginDir 'package.json'), [System.Text.Encoding]::UTF8) | ConvertFrom-Json).version } else { 'not-installed' }

$nodeExe = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) { foreach ($c in @("$env:ProgramFiles\nodejs\node.exe", 'C:\Program Files\nodejs\node.exe')) { if (Test-Path $c) { $nodeExe = $c; break } } }
if (-not $nodeExe) { Write-Host 'FAIL: 找不到 node.exe' -ForegroundColor Red; exit 1 }
$pnpmExe = (Get-Command pnpm.cmd -ErrorAction SilentlyContinue).Source
if (-not $pnpmExe) { foreach ($c in @("$env:APPDATA\npm\pnpm.cmd", "$env:USERPROFILE\AppData\Roaming\npm\pnpm.cmd")) { if (Test-Path $c) { $pnpmExe = $c; break } } }
if (-not $pnpmExe) { Write-Host 'FAIL: 找不到 pnpm.cmd（无法离线安装 profile 依赖）' -ForegroundColor Red; exit 1 }
$gitExe = (Get-Command git.exe -ErrorAction SilentlyContinue).Source
Write-Host "tools: node=$nodeExe pnpm=$pnpmExe git=$gitExe"

if ($DryRun) {
  Write-Host "DRYRUN OK: old=$current new=$($repoPkg.version) node=$nodeExe pnpm=$pnpmExe (no files changed)"
  exit 0
}

Write-Host '-- build (tsc) --'
& $nodeExe (Join-Path $Repo 'node_modules\typescript\bin\tsc') -p (Join-Path $Repo 'tsconfig.json')
if ($LASTEXITCODE -ne 0) { Write-Host 'FAIL: 构建失败' -ForegroundColor Red; exit 1 }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $Repo "_diag\offline-upgrade-backup-$stamp"
New-Item -ItemType Directory -Path $backup -Force | Out-Null
if (Test-Path $pluginDir) { Copy-Item $pluginDir (Join-Path $backup 'plugins-dsh-doubt') -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $backup 'profile-files') -Force | Out-Null
foreach ($f in @('package.json','pnpm-lock.yaml','cordis.patch.yml')) {
  $src = Join-Path $profileDir $f
  if (Test-Path $src) { Copy-Item $src (Join-Path $backup "profile-files\$f") -Force }
}
$repoHead = if ($gitExe) { try { (& $gitExe -C $Repo rev-parse HEAD) } catch { 'unknown' } } else { 'unknown' }
@(
  "backup_time=$stamp"
  "repo_head=$repoHead"
  "old_version=$current"
  "new_version=$($repoPkg.version)"
) | Set-Content (Join-Path $backup 'manifest.txt') -Encoding utf8
Write-Host "-- backup: $backup (old=$current new=$($repoPkg.version)) --"

Write-Host '-- copy plugin files --'
New-Item -ItemType Directory -Path $pluginDir -Force | Out-Null
foreach ($item in @('lib','cordis.patch.yml','dsh-plugin.json','package.json','README.md','README.zh-CN.md','LICENSE','CHANGELOG.md')) {
  $src = Join-Path $Repo $item
  if (-not (Test-Path $src)) { continue }
  $dst = Join-Path $pluginDir $item
  if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
  Copy-Item $src $dst -Recurse -Force
}
Write-Host '-- pnpm install --offline --'
Push-Location $profileDir
try { & $pnpmExe install --offline } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { Write-Host 'FAIL: pnpm install --offline 失败（pnpm store 可能不完整）' -ForegroundColor Red; exit 1 }

$installedPkg = [System.IO.File]::ReadAllText((Join-Path $pluginDir 'package.json'), [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$repoLib = Get-ChildItem (Join-Path $Repo 'lib') -Recurse -File
$diff = @()
foreach ($f in $repoLib) {
  $rel = $f.FullName.Substring((Join-Path $Repo 'lib').Length + 1)
  $t = Join-Path $pluginDir "lib\$rel"
  if (-not (Test-Path $t)) { $diff += "MISSING $rel"; continue }
  if ((Get-FileHash $f.FullName -Algorithm SHA256).Hash -ne (Get-FileHash $t -Algorithm SHA256).Hash) { $diff += "DIFF $rel" }
}
Write-Host "installed version: $($installedPkg.version)  lib files: $($repoLib.Count)  diffs: $($diff.Count)"
if ($installedPkg.version -ne $repoPkg.version -or $diff.Count -ne 0) {
  Write-Host 'FAIL: 校验不一致。回滚命令：' -ForegroundColor Red
  Write-Host "  Copy-Item '$backup\plugins-dsh-doubt\*' '$pluginDir\' -Recurse -Force"
  Write-Host "  Copy-Item '$backup\profile-files\package.json' '$(Join-Path $profileDir 'package.json')' -Force"
  Write-Host "  Copy-Item '$backup\profile-files\pnpm-lock.yaml' '$(Join-Path $profileDir 'pnpm-lock.yaml')' -Force"
  Write-Host '  然后在 profile 目录运行 pnpm install --offline'
  exit 1
}

Write-Host ''
Write-Host "OK: 升级完成 -> $($installedPkg.version)。备份：$backup" -ForegroundColor Green
Write-Host '现在启动 DeepSeek Harness，然后回到会话告诉 Lead「已启动」。'
Write-Host ''
Write-Host '回滚（如需）：'
Write-Host "  Copy-Item '$backup\plugins-dsh-doubt\*' '$pluginDir\' -Recurse -Force"
Write-Host "  Copy-Item '$backup\profile-files\package.json' '$(Join-Path $profileDir 'package.json')' -Force"
Write-Host "  Copy-Item '$backup\profile-files\pnpm-lock.yaml' '$(Join-Path $profileDir 'pnpm-lock.yaml')' -Force"
Write-Host "  Set-Location '$profileDir'; pnpm.cmd install --offline"
Write-Host '  然后重启 DeepSeek Harness。'
