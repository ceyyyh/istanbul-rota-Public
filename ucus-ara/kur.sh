#!/usr/bin/env bash
# Sanal ortamı kurar (zaten varsa hiçbir şey yapmaz). baslat.sh ve mcp.sh kullanır.
set -e
cd "$(dirname "$0")"
if [ ! -x .venv/bin/fli-mcp ]; then
  python3 -m venv .venv
  # Python 3.12+ sanal ortamlarında setuptools yok; flights'ın bağımlılığı ratelimit onsuz derlenmiyor.
  .venv/bin/pip install -q -U pip setuptools wheel
  .venv/bin/pip install -q -r requirements.txt
fi
