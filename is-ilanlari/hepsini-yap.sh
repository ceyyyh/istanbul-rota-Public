#!/usr/bin/env bash
# macOS / Linux: tarayıcı desteğini kurar, tüm iyileştirme adımlarını sırayla çalıştırır, sonra arayüzü açar
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then python3 -m venv .venv; fi
.venv/bin/pip install -q -r requirements.txt playwright
.venv/bin/python -m playwright install chromium
.venv/bin/python -m isilan tam "$@"
.venv/bin/python -m isilan serve
