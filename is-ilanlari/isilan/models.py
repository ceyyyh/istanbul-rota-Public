"""Ortak veri modeli."""
from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass, field

# Kaynak türleri
PLATFORM = "platform"  # kariyer.net, LinkedIn, Indeed ...
COMPANY = "company"    # şirketin kendi kariyer sayfası / ATS'si
AGENCY = "agency"      # İK / dış kaynak / işe alım danışmanlığı firmaları

SOURCE_TYPES = (PLATFORM, COMPANY, AGENCY)


@dataclass
class Job:
    source: str               # kaynak kimliği, ör. "kariyernet", "greenhouse:peakgames"
    source_type: str          # PLATFORM | COMPANY | AGENCY
    external_id: str          # kaynağın kendi ilan kimliği (yoksa URL)
    title: str
    company: str
    url: str
    location: str = ""        # kaynaktan gelen ham konum metni
    district: str | None = None  # kanonik ilçe adı (geo.detect_district ile doldurulur)
    posted_at: str | None = None  # ISO-8601 tarih (YYYY-MM-DD veya tam zaman damgası)
    employment_type: str = ""  # tam zamanlı / yarı zamanlı / staj ...
    work_model: str = ""       # "remote" | "hybrid" | "onsite" | ""
    description: str = ""      # kısa düz metin özet (en fazla ~1000 karakter)
    salary: str = ""
    category: str = ""
    extra: dict = field(default_factory=dict)

    @property
    def uid(self) -> str:
        return hashlib.sha1(f"{self.source}|{self.external_id}".encode()).hexdigest()[:16]

    def to_dict(self) -> dict:
        d = asdict(self)
        d["uid"] = self.uid
        return d
