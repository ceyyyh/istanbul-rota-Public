#!/usr/bin/env bash
# macOS / Linux: kurulum + ilk tarama + web arayüzü
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  python3 -m venv .venv
  .venv/bin/pip install -q -r requirements.txt
fi
.venv/bin/python -m isilan serve --crawl-now --crawl-every 6 "$@"
