"""Beyaz yaka / mavi yaka sınıflandırması (ilan başlığına göre kural tabanlı).

Önce başlığa bakılır: beyaz yaka unvanları (mühendis, uzman, yönetici, muhasebe ...) mavi yaka
sözcüklerinden önce gelir; "Üretim Mühendisi" beyaz, "Forklift Operatörü" mavidir. Başlık yetmezse
kaynağın türüne göre tahmin edilir; emin olunamayan ilanlar None (belirsiz) kalır.
"""
from __future__ import annotations

import re

from .text import fold

# Katlanmış (fold) biçimde, sözcük başında aranır: "muhendis" → "Mühendisi", "Mühendisliği" de yakalanır
WHITE = [
    "muhendis", "engineer", "yazilim", "developer", "gelistirici", "programci", "software", "uzman", "specialist",
    "analist", "analyst", "yonetici", "manager", "mudur", "direktor", "director", "head of", "lead", "sef ",
    "muhasebe", "accountant", "accounting", "finans", "finance", "mali isler", "denetci", "auditor", "controller",
    "insan kaynaklari", "human resources", "hr ", "ik uzmani", "recruiter", "ise alim", "pazarlama", "marketing",
    "dijital", "digital", "seo", "sosyal medya", "icerik", "content", "editor", "musteri temsilcisi",
    "satis temsilcisi", "satis yoneticisi", "account executive", "business development", "is gelistirme",
    "avukat", "hukuk", "lawyer", "legal", "mimar", "architect", "tasarimci", "designer", "grafik", "ui ", "ux",
    "asistan", "assistant", "sekreter", "yonetici asistani", "danisman", "consultant", "koordinator", "coordinator",
    "planlama", "planner", "satin alma", "purchasing", "procurement", "lojistik uzmani", "ithalat", "ihracat",
    "dis ticaret", "data", "veri", "product", "urun yoneticisi", "proje", "project", "ar ge", "r d", "arastirma",
    "researcher", "scientist", "devops", "test", "qa ", "quality assurance", "cyber", "siber", "network",
    "sistem yoneticisi", "system admin", "it ", "bilgi islem", "destek uzmani", "support engineer", "teknik ofis",
    "ogretmen", "teacher", "egitmen", "trainer", "akademisyen", "doktor", "hekim", "eczaci", "psikolog",
    "diyetisyen", "fizyoterapist", "veteriner", "intern", "stajyer", "management trainee", "yonetici adayi",
    "operasyon uzmani", "operations", "risk", "kredi", "yatirim", "investment", "aktuer", "bankaci", "portfoy",
    "cagri merkezi yoneticisi", "office", "ofis", "idari isler", "administrative", "executive", "officer",
    "hemsire", "ebe", "optisyen", "biyolog", "kimyager", "modelist", "teknik ressam", "merchandiser",
    "buro memuru", "memur", "e ticaret", "yurt disi satis", "ihracat", "halkla iliskiler", "reservation",
    "rezervasyon", "kalite kontrol sorumlusu", "kalite guvence", "satis sorumlusu", "supervizor", "supervisor",
    "game", "oyun", "unity", "frontend", "backend", "full stack", "mobile", "ios", "android", "java", "python",
]
BLUE = [
    "sofor", "surucu", "driver", "kurye", "courier", "motorlu kurye", "garson", "komi", "asci", "chef", "kasap",
    "bulasik", "temizlik", "temizlikci", "housekeeping", "kat gorevlisi", "guvenlik", "security guard", "bekci",
    "depo", "warehouse", "forklift", "istif", "operator", "operatoru", "kaynakci", "kaynak", "welder", "tornaci",
    "frezeci", "cnc", "elektrikci", "tesisatci", "usta", "ustasi", "cirak", "isci", "worker", "paketleme",
    "montaj", "boyaci", "sivaci", "insaat iscisi", "kalipci", "dokumcu", "uretim elemani", "uretim personeli",
    "makine operatoru", "kasiyer", "cashier", "reyon", "tezgahtar", "satis danismani", "magaza", "store",
    "barista", "kuafor", "berber", "terzi", "dikis", "konfeksiyon", "utucu", "overlokcu", "hostes", "valet",
    "vale", "bahcivan", "hamal", "yukleme", "bosaltma", "dagitim", "toplayici", "picker", "packer",
    "servis elemani", "mutfak", "pastaci", "firinci", "bulasikci", "cay ocagi", "mesaci", "ofis boy", "ofis gorevlisi",
    "bakici", "hasta bakici", "cocuk bakici", "ev hanimi", "temizlik gorevlisi", "oto yikama", "lastikci",
    "kaporta", "mekanik", "tamirci", "teknisyen", "technician", "bakim onarim", "kombi", "klima", "asansor",
    "cayci", "bellboy", "sevkiyat", "meydanci", "ortaci", "ayakci", "marangoz", "kat hizmetleri",
    "kalite kontrolcu", "manav", "dosemeci", "makine bakim", "teknikeri", "tekniker", "santral", "sofor",
    "eleman", "personel",  # "Depo Elemanı", "Mağaza Personeli" — beyaz unvan yoksa mavi sayılır
]
# Beyaz sözcük içerse de aslında mavi olan kalıplar
BLUE_OVERRIDE = ["satis danismani", "servis supervizoru", "temizlik sefi", "kat sefi", "vardiya sefi", "ustabasi", "forklift operatoru", "depo sorumlusu",
                 "magaza sorumlusu", "reyon sorumlusu", "mutfak sefi", "sef garson", "sous chef", "servis sefi",
                 "uretim sefi"]

# Unvan değil kurum/yer adı olan ifadeler: eşleşmeden önce metinden çıkarılır
# ("Güvenlik Görevlisi - Banka Genel Müdürlük" müdür değildir)
_NOISE = re.compile(r"(?:^| )(?:genel mudurluk\w*|bolge mudurlug\w*|il mudurlug\w*|mudurlugu|mudurlukte|mudurlugumuz\w*)")

# Kaynak türüne göre son çare tahmini
BLUE_SOURCES = {"elemannet", "isinolsun"}


def _rx(words: list[str]) -> re.Pattern:
    alts = sorted({w.strip() for w in words if w.strip()}, key=len, reverse=True)
    return re.compile(r"(?:^| )(?:" + "|".join(re.escape(a) for a in alts) + r")")


_WHITE, _BLUE, _BLUE_OV = _rx(WHITE), _rx(BLUE), _rx(BLUE_OVERRIDE)


def collar(title: str, category: str = "", source: str = "", source_type: str = "") -> str | None:
    t = " " + _NOISE.sub(" ", fold(f"{title} {category}")) + " "
    if _BLUE_OV.search(t):
        return "mavi"
    if _WHITE.search(t):
        return "beyaz"
    if _BLUE.search(t):
        return "mavi"
    if source in BLUE_SOURCES:
        return "mavi"
    if source_type == "company" and source.split(":")[0] in {"greenhouse", "lever", "workable", "ashby",
                                                              "smartrecruiters", "recruitee", "teamtailor",
                                                              "personio", "breezy", "workday", "oracle"}:
        return "beyaz"  # şirketlerin ATS panolarındaki ilanlar büyük çoğunlukla beyaz yaka
    return None
