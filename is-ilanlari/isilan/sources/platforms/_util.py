"""Platform modüllerinin paylaştığı küçük yardımcılar.

- parse_tr_relative_date: "Bugün", "Dün", "3 gün önce", "1 hafta önce", "2 saat önce",
  "30+ gün önce", "Just posted", "3 days ago", "12.10.2026", "2026-10-12" ... -> ISO tarih
- abs_url: göreli bağlantıyı mutlak URL'ye çevirir
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from urllib.parse import urljoin

from ...text import fold

__all__ = ["parse_tr_relative_date", "abs_url", "parse_any_date", "TR_MONTHS", "Node", "parse_html",
           "extract_js_object", "env"]

TR_MONTHS = {
    "ocak": 1, "subat": 2, "mart": 3, "nisan": 4, "mayis": 5, "haziran": 6,
    "temmuz": 7, "agustos": 8, "eylul": 9, "ekim": 10, "kasim": 11, "aralik": 12,
    # İngilizce kısaltmalar / adlar
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8,
    "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12,
    "january": 1, "february": 2, "march": 3, "april": 4, "june": 6, "july": 7,
    "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
    # Türkçe kısaltmalar
    "oca": 1, "sub": 2, "nis": 4, "haz": 6, "tem": 7, "agu": 8, "eyl": 9, "eki": 10,
    "kas": 11, "ara": 12,
}

# birim -> timedelta argümanı (gün cinsinden çarpan veya saat/dakika)
_UNITS = {
    "saniye": ("seconds", 1), "sn": ("seconds", 1), "second": ("seconds", 1), "seconds": ("seconds", 1),
    "dakika": ("minutes", 1), "dk": ("minutes", 1), "minute": ("minutes", 1), "minutes": ("minutes", 1),
    "min": ("minutes", 1), "mins": ("minutes", 1),
    "saat": ("hours", 1), "sa": ("hours", 1), "hour": ("hours", 1), "hours": ("hours", 1), "hr": ("hours", 1),
    "hrs": ("hours", 1), "h": ("hours", 1),
    "gun": ("days", 1), "day": ("days", 1), "days": ("days", 1), "d": ("days", 1),
    "hafta": ("days", 7), "week": ("days", 7), "weeks": ("days", 7), "w": ("days", 7),
    "ay": ("days", 30), "month": ("days", 30), "months": ("days", 30), "mo": ("days", 30),
    "yil": ("days", 365), "sene": ("days", 365), "year": ("days", 365), "years": ("days", 365),
}
_NUM_WORDS = {"bir": 1, "iki": 2, "uc": 3, "dort": 4, "bes": 5, "alti": 6, "yedi": 7,
              "sekiz": 8, "dokuz": 9, "on": 10, "a": 1, "an": 1, "one": 1}

_REL = re.compile(r"\b(\d+|bir|iki|uc|dort|bes|alti|yedi|sekiz|dokuz|on|an|a|one)\s*\+?\s*"
                  r"(saniye|sn|dakika|dk|saat|sa|gun|hafta|ay|yil|sene|seconds?|minutes?|mins?|hours?|hrs?|"
                  r"days?|weeks?|months?|years?|mo|h|d|w)\b")
_ISO = re.compile(r"(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?")
_DMY = re.compile(r"\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b")
_DMONY = re.compile(r"\b(\d{1,2})\s+([a-z]+)\s+(\d{4})\b")
_MONDY = re.compile(r"\b([a-z]+)\s+(\d{1,2}),?\s+(\d{4})\b")


def _fmt(d: datetime | date, with_time: bool) -> str:
    if with_time and isinstance(d, datetime):
        return d.replace(microsecond=0, tzinfo=None).isoformat()
    return (d.date() if isinstance(d, datetime) else d).isoformat()


def parse_any_date(text: str | None) -> str | None:
    """Mutlak tarihleri ISO'ya çevirir: 2026-10-12, 12.10.2026, 12 Ekim 2026, Oct 12, 2026.
    Bulamazsa None."""
    if not text:
        return None
    s = str(text).strip()
    m = _ISO.search(s)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            if m.group(4):
                return datetime(y, mo, d, int(m.group(4)), int(m.group(5)), int(m.group(6) or 0)).isoformat()
            return date(y, mo, d).isoformat()
        except ValueError:
            return None
    m = _DMY.search(s)
    if m:
        try:
            return date(int(m.group(3)), int(m.group(2)), int(m.group(1))).isoformat()
        except ValueError:
            return None
    f = fold(s)
    m = _DMONY.search(f)
    if m and m.group(2) in TR_MONTHS:
        try:
            return date(int(m.group(3)), TR_MONTHS[m.group(2)], int(m.group(1))).isoformat()
        except ValueError:
            return None
    m = _MONDY.search(f)
    if m and m.group(1) in TR_MONTHS:
        try:
            return date(int(m.group(3)), TR_MONTHS[m.group(1)], int(m.group(2))).isoformat()
        except ValueError:
            return None
    return None


def parse_tr_relative_date(text: str | None, now: datetime | None = None) -> str | None:
    """Göreli (Türkçe/İngilizce) veya mutlak tarih metnini ISO-8601'e çevirir.

    Gün ve üstü birimlerde "YYYY-MM-DD", saat/dakika birimlerinde "YYYY-MM-DDTHH:MM:SS"
    döner. Tanınmayan metinde None döner (asla uydurmaz).

    >>> parse_tr_relative_date("3 gün önce", datetime(2026, 10, 16, 12))
    '2026-10-13'
    """
    if not text:
        return None
    now = now or datetime.now()
    f = fold(str(text))
    if not f:
        return None
    # Mutlak tarih önce (ör. "Yayın tarihi: 12.10.2026")
    absolute = parse_any_date(text)
    if absolute:
        return absolute
    if re.search(r"\b(bugun|today|just posted|just now|simdi|az once|yeni|new|bugun yayinlandi)\b", f):
        return _fmt(now, False)
    if re.search(r"\b(dun|yesterday)\b", f):
        return _fmt(now - timedelta(days=1), False)
    if re.search(r"\bevvelsi gun\b|\bonceki gun\b", f):
        return _fmt(now - timedelta(days=2), False)
    if re.search(r"\b(gecen|last)\s+(hafta|week)\b", f):
        return _fmt(now - timedelta(days=7), False)
    if re.search(r"\b(gecen|last)\s+(ay|month)\b", f):
        return _fmt(now - timedelta(days=30), False)
    m = _REL.search(f)
    if m:
        n_raw, unit = m.group(1), m.group(2)
        n = int(n_raw) if n_raw.isdigit() else _NUM_WORDS.get(n_raw, 1)
        kind, mult = _UNITS[unit]
        delta = timedelta(**{kind: n * mult})
        return _fmt(now - delta, kind in ("seconds", "minutes", "hours"))
    return None


def abs_url(base: str, href: str | None) -> str:
    """Göreli bağlantıyı `base`e göre mutlak yapar; boş href için "" döner."""
    if not href:
        return ""
    href = href.strip()
    if href.startswith("//"):
        return "https:" + href
    return urljoin(base, href)


# ---------------------------------------------------------------------------
# Hafif HTML ağacı (yalnızca standart kütüphane; bs4 bağımlılığı yok)
# ---------------------------------------------------------------------------
from html.parser import HTMLParser as _HTMLParser  # noqa: E402

_VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
         "param", "source", "track", "wbr"}


class Node:
    """Basit DOM düğümü. `find`/`find_all` etiket, sınıf ve öznitelik ile arar."""

    __slots__ = ("tag", "attrs", "children", "parent")

    def __init__(self, tag: str, attrs: dict | None = None, parent: "Node | None" = None):
        self.tag = tag
        self.attrs = attrs or {}
        self.children: list = []  # Node veya str
        self.parent = parent

    def get(self, name: str, default=None):
        return self.attrs.get(name.lower(), default)

    @property
    def classes(self) -> list[str]:
        return (self.attrs.get("class") or "").split()

    def text(self, sep: str = " ") -> str:
        parts: list[str] = []

        def walk(n):
            for c in n.children:
                if isinstance(c, str):
                    parts.append(c)
                elif c.tag not in ("script", "style"):
                    walk(c)
        walk(self)
        return re.sub(r"\s+", " ", sep.join(parts)).strip()

    def _match(self, tag, cls, attrs) -> bool:
        if tag and self.tag not in ((tag,) if isinstance(tag, str) else tag):
            return False
        if cls:
            mine = self.classes
            for c in cls.split():
                if c not in mine:
                    return False
        for k, v in (attrs or {}).items():
            have = self.attrs.get(k.lower())
            if v is True:
                if have is None:
                    return False
            elif hasattr(v, "search"):
                if have is None or not v.search(have):
                    return False
            elif have != v:
                return False
        return True

    def iter(self):
        for c in self.children:
            if isinstance(c, Node):
                yield c
                yield from c.iter()

    def find_all(self, tag=None, cls: str | None = None, attrs: dict | None = None) -> list["Node"]:
        return [n for n in self.iter() if n._match(tag, cls, attrs)]

    def find(self, tag=None, cls: str | None = None, attrs: dict | None = None) -> "Node | None":
        for n in self.iter():
            if n._match(tag, cls, attrs):
                return n
        return None

    def __repr__(self):
        return f"<Node {self.tag} {self.attrs}>"


class _TreeBuilder(_HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("#root")
        self.cur = self.root

    def handle_starttag(self, tag, attrs):
        node = Node(tag, {k.lower(): (v if v is not None else "") for k, v in attrs}, self.cur)
        self.cur.children.append(node)
        if tag not in _VOID:
            self.cur = node

    def handle_startendtag(self, tag, attrs):
        node = Node(tag, {k.lower(): (v if v is not None else "") for k, v in attrs}, self.cur)
        self.cur.children.append(node)

    def handle_endtag(self, tag):
        n = self.cur
        while n is not None and n.tag != tag:
            n = n.parent
        if n is not None and n.parent is not None:
            self.cur = n.parent

    def handle_data(self, data):
        if data:
            self.cur.children.append(data)


def parse_html(html: str) -> Node:
    """HTML'i hoşgörülü biçimde ağaca çevirir (hatalı iç içelik tolere edilir)."""
    b = _TreeBuilder()
    try:
        b.feed(html or "")
        b.close()
    except Exception:  # pragma: no cover - HTMLParser nadiren fırlatır
        pass
    return b.root


def extract_js_object(text: str, start: int) -> str | None:
    """`text[start]` '{' veya '[' iken dengeli JSON/JS nesnesinin metnini döner
    (dize içindeki parantezleri ve kaçışları dikkate alır)."""
    if start < 0 or start >= len(text) or text[start] not in "{[":
        return None
    depth, in_str, esc, quote = 0, False, False, ""
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == quote:
                in_str = False
        elif ch in "\"'":
            in_str, quote = True, ch
        elif ch in "{[":
            depth += 1
        elif ch in "}]":
            depth -= 1
            if depth == 0:
                return text[start:i + 1]
    return None


def env(name: str, default: str = "") -> str:
    import os
    return (os.environ.get(name) or default).strip()
