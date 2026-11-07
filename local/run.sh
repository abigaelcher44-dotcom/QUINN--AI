#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."

echo
echo "  QUINN AI"
echo "  Your AI. Your PC. Your rules."
echo

command -v node >/dev/null 2>&1 || {
  echo "Node.js 22+ is required: https://nodejs.org"
  exit 1
}

command -v python3 >/dev/null 2>&1 || {
  echo "Python 3 is required: https://www.python.org"
  exit 1
}

exec python3 main.py
