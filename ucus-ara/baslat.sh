#!/usr/bin/env bash
# macOS / Linux: kurulum + uçuş arama. Örnek: ./baslat.sh LHR 2026-12-05
set -e
cd "$(dirname "$0")"
./kur.sh
.venv/bin/python ucus.py "$@"
