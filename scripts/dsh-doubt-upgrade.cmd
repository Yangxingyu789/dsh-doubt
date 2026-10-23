@echo off
title dsh-doubt upgrade launcher
echo Starting dsh-doubt upgrade launcher...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-upgrade.ps1" %*
echo.
echo ==========================================
echo Launcher exit code: %errorlevel%
echo Log: %~dp0..\_diag\upgrade-console.log
echo ==========================================
echo.
pause
