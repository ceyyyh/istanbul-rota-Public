#!/usr/bin/env bash
# Fli MCP sunucusunu STDIO üzerinden başlatır (.mcp.json bunu çağırır).
# Kurulum çıktısı MCP protokolüne karışmasın diye stderr'e gider.
set -e
cd "$(dirname "$0")"
./kur.sh >&2
exec .venv/bin/fli-mcp
