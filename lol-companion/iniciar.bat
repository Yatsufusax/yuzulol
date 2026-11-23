@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Necesitas instalar Node.js desde https://nodejs.org y volver a abrir este archivo.
  pause
  exit /b
)
if not exist node_modules call npm install
call npm start
pause
