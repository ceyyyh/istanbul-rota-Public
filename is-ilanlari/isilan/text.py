"""Metin yardımcıları."""
from __future__ import annotations

import html
import re
import unicodedata

_TR_LOWER = str.maketrans({"I": "ı", "İ": "i"})
_TR_ASCII = str.maketrans({"ı": "i", "ğ": "g", "ü": "u", "ş": "s", "ö": "o", "ç": "c", "â": "a", "î": "i", "û": "u"})
_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")


def tr_lower(s: str) -> str:
    """Türkçe kurallarına göre küçük harfe çevirir (I→ı, İ→i)."""
    return s.translate(_TR_LOWER).lower()


def fold(s: str) -> str:
    """Karşılaştırma için: küçük harf, Türkçe karakterleri ASCII'ye indir, aksanları at,
    harf/rakam dışını boşluğa çevir. "Kadıköy / İSTANBUL" -> "kadikoy istanbul"."""
    s = tr_lower(s or "").translate(_TR_ASCII)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return s.strip()


def strip_html(s: str, limit: int | None = 1000) -> str:
    """HTML'i düz metne çevirir ve isteğe bağlı olarak kısaltır."""
    if not s:
        return ""
    s = html.unescape(_TAG.sub(" ", html.unescape(s)))
    s = _WS.sub(" ", s).strip()
    if limit and len(s) > limit:
        s = s[: limit - 1].rstrip() + "…"
    return s


def clean(s) -> str:
    if s is None:
        return ""
    return _WS.sub(" ", html.unescape(str(s))).strip()
