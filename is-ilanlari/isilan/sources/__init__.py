"""Tüm kaynakların kaydı. Her alt modül `sources() -> list[Source]` sunar; bir modül
bozuksa diğerleri etkilenmesin diye hepsi ayrı ayrı yüklenir."""
from __future__ import annotations

import importlib
import logging

from .base import FetchContext, Source

log = logging.getLogger(__name__)

MODULES = ["platforms", "ats", "careerpage", "agencies"]


def all_sources(include_disabled: bool = False) -> list[Source]:
    out: list[Source] = []
    seen: set[str] = set()
    for mod_name in MODULES:
        try:
            mod = importlib.import_module(f"{__name__}.{mod_name}")
            items = mod.sources()
        except Exception as e:  # noqa: BLE001
            log.error("Kaynak modülü yüklenemedi: %s (%s)", mod_name, e)
            continue
        for s in items:
            if s.name in seen or (not s.enabled and not include_disabled):
                continue
            seen.add(s.name)
            out.append(s)
    return out


__all__ = ["FetchContext", "Source", "all_sources"]
