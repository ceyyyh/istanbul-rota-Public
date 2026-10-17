"""İstanbul ilçe tespiti. (Geçici arayüz — districts ajanı tarafından tamamlanacak.)"""
from __future__ import annotations

DISTRICTS: list[str] = []


def detect_district(text: str) -> str | None:
    """Konum/başlık metninden kanonik ilçe adını döner ("Kadıköy" gibi) ya da None."""
    raise NotImplementedError


def is_istanbul(text: str) -> bool:
    """Metin İstanbul'daki bir yeri işaret ediyorsa True."""
    raise NotImplementedError
