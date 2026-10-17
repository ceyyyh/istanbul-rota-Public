"""Kaynak arayüzü.

Her kaynak modülü `sources() -> list[Source]` fonksiyonu sunar. `Source.fetch` bir
`Job` üreteci döner; ağ hataları yukarı fırlatılabilir (pipeline yakalar ve kaynağı
"hatalı" olarak raporlar). Kaynak, mümkünse yalnızca İstanbul ilanlarını istemelidir;
pipeline yine de `geo.is_istanbul` ile son bir süzgeç uygular.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Callable, Iterator

from ..http import Http
from ..models import Job


@dataclass
class FetchContext:
    http: Http
    max_pages: int = 50          # sayfalı kaynaklarda üst sınır
    deadline: float = 0          # time.monotonic() cinsinden; 0 = sınırsız
    fetch_details: bool = False  # detay sayfalarını da çek (yavaş ama zengin)
    log: logging.Logger = field(default_factory=lambda: logging.getLogger("isilan.source"))

    def time_left(self) -> bool:
        return not self.deadline or time.monotonic() < self.deadline


@dataclass
class Source:
    name: str                                  # benzersiz kimlik, ör. "kariyernet"
    source_type: str                           # models.PLATFORM / COMPANY / AGENCY
    label: str                                 # arayüzde görünen ad
    fetcher: Callable[["Source", FetchContext], Iterator[Job]]
    homepage: str = ""
    params: dict = field(default_factory=dict)  # kaynağa özel ayarlar (slug, url ...)
    needs_browser: bool = False                # yalnızca Playwright ile çalışıyorsa True
    enabled: bool = True

    def fetch(self, ctx: FetchContext) -> Iterator[Job]:
        return self.fetcher(self, ctx)
