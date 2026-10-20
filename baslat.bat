@echo off
chcp 65001 >nul
title Canli Olay Haritasi
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js bulunamadi. https://nodejs.org adresinden kurup tekrar deneyin.
  pause
  exit /b 1
)
start "" http://localhost:8080
node scripts\serve.mjs
pause
