"""İş platformu kaynakları (source_type = PLATFORM).

Her modül `sources() -> list[Source]` sunar. Modüller savunmacı biçimde içe aktarılır:
eksik veya hatalı bir modül diğerlerini engellemez.
"""
from __future__ import annotations

import importlib
import logging

from ..base import Source

log = logging.getLogger(__name__)

MODULES = [
    "kariyernet", "linkedin", "indeed", "glassdoor", "careerjet", "jooble",
    "yenibiris", "secretcv", "elemannet", "isbul", "isinolsun", "youthall",
    "techcareer", "iskur", "toptalent", "coderspace",
]


def sources() -> list[Source]:
    out: list[Source] = []
    seen: set[str] = set()
    for name in MODULES:
        try:
            mod = importlib.import_module(f"{__name__}.{name}")
        except ImportError as e:
            log.debug("platform modülü yüklenemedi: %s (%s)", name, e)
            continue
        except Exception as e:  # sözdizimi vb. hatalar diğerlerini durdurmasın
            log.warning("platform modülü hatalı: %s (%r)", name, e)
            continue
        fn = getattr(mod, "sources", None)
        if not callable(fn):
            continue
        try:
            for s in fn():
                if s.name not in seen:
                    seen.add(s.name)
                    out.append(s)
        except Exception as e:
            log.warning("platform %s sources() hatası: %r", name, e)
    return out
