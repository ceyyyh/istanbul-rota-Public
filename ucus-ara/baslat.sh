#!/usr/bin/env bash
# macOS / Linux: kurulum + uçuş arama. Örnek: ./baslat.sh LHR 2026-12-05
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  python3 -m venv .venv
  .venv/bin/pip install -q -r requirements.txt
fi
.venv/bin/python ucus.py "$@"
