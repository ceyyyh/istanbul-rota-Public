"""data/companies.json kayıt defterini okur."""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path

log = logging.getLogger(__name__)

DEFAULT_PATH = Path(__file__).resolve().parents[2] / "data" / "companies.json"


def registry_paths() -> list[Path]:
    paths = [DEFAULT_PATH]
    extra = os.environ.get("ISILAN_COMPANIES")  # kullanıcının kendi listesi (virgülle ayrılmış yollar)
    if extra:
        paths += [Path(p) for p in extra.split(",") if p]
    user = DEFAULT_PATH.with_name("companies.local.json")
    if user.exists():
        paths.append(user)
    return paths


def load_registry() -> list[dict]:
    out: list[dict] = []
    for p in registry_paths():
        if not p.exists():
            continue
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            log.error("%s okunamadı: %s", p, e)
            continue
        out.extend(e for e in data if isinstance(e, dict) and e.get("enabled", True))
    return out
