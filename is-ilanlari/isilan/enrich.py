"""İlan zenginleştirme: semt, kıdem, istihdam türü ve maaş bilgisi (saf fonksiyonlar, ağ yok)."""
from __future__ import annotations

import re

from .text import fold

# ---- kıdem ----
# Sıra önemli: ilk eşleşen kazanır (ör. "senior manager" → yönetici; "uzman yardımcısı" → junior, uzman değil)
_KIDEM_RULES: list[tuple[str, re.Pattern]] = [
    ("stajyer", re.compile(r"\b(stajyer\w*|staj|intern|interns|internship)\b")),
    ("yeni_mezun", re.compile(r"\b(yeni mezun\w*|graduate|graduates|management trainee\w*|mt programi?)\b")),
    ("junior", re.compile(r"\b(junior|jr|uzman yardimci\w*|assistant specialist|asistan uzman)\b")),
    # Müdür/manager/direktör asistanı ve sekreteri yönetici değildir ('' döner); "Müdür Yardımcısı" ve
    # "Assistant Manager" yönetici değil ama üst düzey bireysel rol sayılır → kidemli
    ("", re.compile(r"\b(?:mudur\w*|manager\w*|direktor\w*|director\w*)\s+(?:asistan\w*|sekreter\w*|assistant|secretary)\b|"
                    r"\bassistant to (?:the )?(?:general )?(?:manager|director)\b")),
    ("kidemli", re.compile(r"\b(?:mudur\w*|manager\w*|direktor\w*|director\w*)\s+yardimci\w*|"
                           r"\b(?:assistant|deputy) (?:general )?(?:manager|director)\b")),
    ("yonetici", re.compile(r"\b(mudur\w*|manager\w*|yonetici(?! (asistan|sekreter))\w*|direktor\w*|director\w*|"
                            r"head of|genel mudur\w*)\b")),
    ("kidemli", re.compile(r"\b(kidemli|senior|sr|lead(?! generation)|principal|bas uzman\w*)\b")),
    ("uzman", re.compile(r"\b(uzman\w*|specialist)\b")),
]
_MT_UPPER = re.compile(r"\bMT\b")  # "MT" yalnız büyük harfli kelime olarak
# Başlıkta işaret yoksa açıklamanın başında yalnız güçlü, açık işaretler aranır
_KIDEM_DESC = [
    ("stajyer", re.compile(r"\b(stajyer\w*|internship)\b")),
    ("yeni_mezun", re.compile(r"\b(yeni mezun\w*|fresh graduate\w*)\b")),
]


def detect_kidem(title: str, description: str = "") -> str:
    """Başlıktan (yoksa açıklamanın başındaki güçlü işaretlerden) kıdem düzeyi; belirsizse ''."""
    t = fold(title or "")
    for name, rx in _KIDEM_RULES:
        if rx.search(t):
            if name in ("stajyer", "yeni_mezun", "junior"):
                return name
            if _MT_UPPER.search(title or ""):
                return "yeni_mezun"
            return name
    if _MT_UPPER.search(title or ""):
        return "yeni_mezun"
    if not t:
        return ""
    d = fold((description or "")[:300])
    for name, rx in _KIDEM_DESC:
        if rx.search(d):
            return name
    return ""


# ---- istihdam ----
_ISTIHDAM_RULES: list[tuple[str, re.Pattern]] = [
    # "trainee" staj değil: "Management Trainee" tam zamanlı bir programdır
    ("staj", re.compile(r"\b(intern\w*|stajyer\w*|staj)\b")),
    ("proje", re.compile(r"\b(contract\w*|temporary|temp|sozlesmeli|proje\w*|donemsel|gecici|freelance|serbest|seasonal|mevsimlik)\b")),
    ("yari", re.compile(r"\b(part time|parttime|yari zamanli|yari|yarim gun)\b")),
    ("tam", re.compile(r"\b(full time|fulltime|tam zamanli|tam|permanent|surekli)\b")),
]
_ISTIHDAM_TITLE = [
    ("staj", re.compile(r"\b(stajyer\w*|intern|internship)\b")),
    ("yari", re.compile(r"\b(part time|yari zamanli)\b")),
    ("proje", re.compile(r"\b(sozlesmeli|proje bazli|donemsel)\b")),
]


def normalize_istihdam(employment_type: str, title: str = "") -> str:
    """tam | yari | staj | proje | ''. Önce istihdam alanı, anlaşılmazsa başlık."""
    e = fold(employment_type or "")
    if e:
        for name, rx in _ISTIHDAM_RULES:
            if rx.search(e):
                return name
    t = fold(title or "")
    for name, rx in _ISTIHDAM_TITLE:
        if rx.search(t):
            return name
    return ""


# ---- maaş ----
_NONZERO_DIGIT = re.compile(r"[1-9]")
# "maaş: 45.000 TL", "salary 60k" gibi açık ifadeler; yalnız "maaş" kelimesi yetmez
_SALARY_DESC = re.compile(r"\b(?:maas\w*|ucret\w*|salary|compensation)\b[^0-9]{0,25}([1-9][0-9]*)( ?(?:k|bin|tl|try|usd|eur)\b)?")
# Binlik ayırıcılı sayılar ("45.000", "60,000", "1 250 000"): fold noktalamayı boşluğa çevirip sayıyı böleceğinden
# ayırıcılar fold'dan önce atılır
_THOUSANDS = re.compile(r"(?<![\d.,])(\d{1,3})((?:[.,\u00a0 ]\d{3})+)(?!\d)")
# Maaş olmayan "ücret" kullanımları: yemek/yol/servis ücreti, ücretli/ücretsiz izin vb.
_NOT_SALARY = re.compile(r"\b(?:(?:yemek|yol|servis|ulasim|mesai|giris|basvuru|kargo) ucret\w*|ucretli|ucretsiz)\b")
_YEAR = re.compile(r"(?:19[5-9]|20\d|21[0-1])\d$")


def has_salary(salary: str, description: str = "") -> bool:
    """Rakam içeren gerçek bir maaş bilgisi var mı? "Belirtilmemiş", "görüşülecek", "rekabetçi" → False."""
    s = (salary or "").strip()
    if s:
        return bool(_NONZERO_DIGIT.search(s))
    raw = _THOUSANDS.sub(lambda m: m.group(1) + re.sub(r"\D", "", m.group(2)), (description or "")[:1500])
    text = _NOT_SALARY.sub(" ", fold(raw))
    for m in _SALARY_DESC.finditer(text):
        num, unit = m.group(1), m.group(2)
        if unit or (len(num) >= 4 and not _YEAR.fullmatch(num)):  # birimsiz 2024 gibi yıllar maaş sayılmaz
            return True
    return False


# ---- semt ----
# kanonik ad → ilçe
_SEMT_ILCE = {
    "Maslak": "Sarıyer", "Ayazağa": "Sarıyer", "İstinye": "Sarıyer", "Tarabya": "Sarıyer", "PTT Evleri": "Sarıyer",
    "Levent": "Beşiktaş", "Etiler": "Beşiktaş", "Gayrettepe": "Beşiktaş", "Zincirlikuyu": "Beşiktaş",
    "Balmumcu": "Beşiktaş", "Ortaköy": "Beşiktaş",
    "Mecidiyeköy": "Şişli", "Esentepe": "Şişli", "Fulya": "Şişli", "Nişantaşı": "Şişli",
    "Seyrantepe": "Kağıthane", "Çağlayan": "Kağıthane", "Gültepe": "Kağıthane",
    "Kozyatağı": "Kadıköy", "Göztepe": "Kadıköy",
    "Altunizade": "Üsküdar",
    "Kavacık": "Beykoz",
}
SEMTLER = [{"ad": ad, "ilce": ilce} for ad, ilce in _SEMT_ILCE.items()]
# İki ilçeye yayılan semtler: SEMTLER'deki ilçe birincil, buradakiler de geçerli sayılır.
# Levent iş bölgesi Beşiktaş ile Şişli'ye (Büyükdere Cd. Esentepe yakası: Kanyon, Metrocity) yayılır;
# geo.py bu plazaları Şişli'ye atar. Zincirlikuyu'yu geo.py Şişli sayar.
_SEMT_EK_ILCE = {"Levent": {"Şişli"}, "Zincirlikuyu": {"Şişli"}}

# Plaza / bina takma adları → kanonik semt
_SEMT_ALIAS = {
    "Maslak 1453": "Maslak", "Spine Tower": "Maslak", "Vadi İstanbul": "Ayazağa",
    "1. Levent": "Levent", "2. Levent": "Levent", "3. Levent": "Levent", "4. Levent": "Levent",
    "Kanyon": "Levent", "Metrocity": "Levent", "Sabancı Center": "Levent", "İş Kuleleri": "Levent",
    "Yapı Kredi Plaza": "Levent", "Zorlu Center": "Zincirlikuyu", "Torun Center": "Esentepe",
}

_SEMT_RX: list[tuple[re.Pattern, str]] = [
    (re.compile(r"\b" + fold(ad) + r"\b"), _SEMT_ALIAS.get(ad, ad))
    for ad in list(_SEMT_ILCE) + list(_SEMT_ALIAS)
]


_SEMT_RX_ALIAS = [
    (re.compile(r"\b" + fold(ad) + r"\b"), _SEMT_ALIAS[ad]) for ad in _SEMT_ALIAS
]


def _find_semt(text: str, district: str, only_alias: bool = False) -> str:
    """Metindeki ilk (en erken geçen, eşitse en uzun) ilçeyle tutarlı semt. only_alias: yalnız plaza/bina
    takma adları aranır (serbest metinde "Levent Yılmaz", "Fulya Hanım" gibi kişi adları semt sayılmasın)."""
    f = fold(text)
    if not f:
        return ""
    best: tuple[int, int, str] | None = None
    for rx, semt in (_SEMT_RX_ALIAS if only_alias else _SEMT_RX):
        if district and district != _SEMT_ILCE[semt] and district not in _SEMT_EK_ILCE.get(semt, ()):
            continue
        m = rx.search(f)
        if not m:
            continue
        cand = (m.start(), -(m.end() - m.start()), semt)
        if best is None or cand < best:
            best = cand
    return best[2] if best else ""


def detect_semt(location: str, district: str | None, title: str = "", description: str = "") -> str:
    """Kanonik semt adı ya da ''. Önce konum, sonra başlık, sonra açıklamanın başı (yalnız plaza takma adları); semt yalnız ilanın
    ilçesiyle tutarlıysa (ilçe boş olabilir) atanır."""
    dist = district or ""
    for text in (location or "", title or ""):
        s = _find_semt(text, dist)
        if s:
            return s
    return _find_semt((description or "")[:300], dist, only_alias=True)


def enrich_fields(row: dict) -> dict:
    """Bir ilan satırından (db sözlüğü) yeni alanları hesaplar."""
    title = row.get("title") or ""
    desc = row.get("description") or ""
    return {
        "semt": detect_semt(row.get("location") or "", row.get("district"), title, desc),
        "kidem": detect_kidem(title, desc),
        "istihdam": normalize_istihdam(row.get("employment_type") or "", title),
        "maasli": 1 if has_salary(row.get("salary") or "", desc) else 0,
    }
