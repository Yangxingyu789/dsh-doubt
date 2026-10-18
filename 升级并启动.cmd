@echo off
chcp 65001 >nul
title dsh-doubt 升级并启动
echo ============================================
echo  dsh-doubt 离线升级（0.7.0 -^> 0.8.1）
echo  前提：DeepSeek Harness 必须已经完全退出
echo ============================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\work\dsh-doubt\scripts\upgrade-offline.ps1" -Profile desktop -Repo "C:\work\dsh-doubt"
if errorlevel 1 (
  echo.
  echo [FAIL] 升级失败。上面有错误信息；升级前备份在 C:\work\dsh-doubt\_diag\offline-upgrade-backup-* 下。
  echo        如需回滚：见上面打印的命令，或在 DSH 关闭时恢复备份。
  echo.
  pause
  exit /b 1
)
echo.
echo [OK] 升级完成，正在启动 DeepSeek Harness...
start "" "E:\dsh\DeepSeek Harness.exe"
echo 启动请求已发出。回到 DSH 会话里告诉 Lead「已启动」即可。
timeout /t 3 >nul
