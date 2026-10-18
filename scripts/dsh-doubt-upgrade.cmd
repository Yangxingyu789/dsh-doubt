@echo off
title dsh-doubt upgrade launcher
echo Starting dsh-doubt upgrade launcher...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\work\dsh-doubt\scripts\run-upgrade.ps1"
echo.
echo ==========================================
echo Launcher exit code: %errorlevel%
echo Log: C:\work\dsh-doubt\_diag\upgrade-console.log
echo ==========================================
echo.
pause
