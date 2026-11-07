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

where python >nul 2>nul
if errorlevel 1 (
  echo   Python 3 is required: https://www.python.org
  exit /b 1
)

python main.py
