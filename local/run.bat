@echo off
setlocal
cd /d "%~dp0\.."

echo.
echo   QUINN AI
echo   Your AI. Your PC. Your rules.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js 22+ is required: https://nodejs.org
  exit /b 1
)

if not exist "node_modules\vite\bin\vite.js" (
  echo   Dependencies are missing. Run npm install first.
  exit /b 1
)

npm run dev
