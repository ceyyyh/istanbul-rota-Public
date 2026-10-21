import sqlite3

import pytest

from isilan.db import DB, norm_since
from isilan.enrich import SEMTLER, detect_kidem, detect_semt, has_salary, normalize_istihdam


@pytest.mark.parametrize("title,beklenen", [
    ("Stajyer - İnsan Kaynakları", "stajyer"),
    ("Software Engineering Intern", "stajyer"),
    ("Yaz Dönemi Staj Programı", "stajyer"),
    ("Yeni Mezun Satış Temsilcisi", "yeni_mezun"),
    ("Graduate Program 2026", "yeni_mezun"),
    ("Management Trainee", "yeni_mezun"),
    ("Finans MT Programı", "yeni_mezun"),
    ("Junior Backend Developer", "junior"),
    ("Jr. Data Analyst", "junior"),
    ("Muhasebe Uzman Yardımcısı", "junior"),
    ("Assistant Specialist, Risk", "junior"),
    ("Satış Uzmanı", "uzman"),
    ("Data Specialist", "uzman"),
    ("Kıdemli Yazılım Geliştirici", "kidemli"),
    ("Senior Product Designer", "kidemli"),
    ("Sr. Analyst", "kidemli"),
    ("Tech Lead", "kidemli"),
    ("Principal Engineer", "kidemli"),
    ("Baş Uzman - Bütçe", "kidemli"),
    ("Mağaza Müdürü", "yonetici"),
    ("Proje Yöneticisi", "yonetici"),
    ("Senior Manager, Audit", "yonetici"),
    ("Finance Director", "yonetici"),
    ("Head of Marketing", "yonetici"),
    ("Genel Müdür Yardımcısı", "yonetici"),
])
def test_kidem_olumlu(title, beklenen):
    assert detect_kidem(title) == beklenen


@pytest.mark.parametrize("title", [
    "Internal Audit Analyst",       # "intern" "internal" içinde eşleşmemeli
    "Yönetici Asistanı",           # yönetici değil, asistan
    "Lead Generation Temsilcisi",
    "Garson",
    "Software Engineer",
    "Mt Sinai Sales",               # küçük harf "mt" kelimesi sayılmaz
    "",
])
def test_kidem_olumsuz(title):
    assert detect_kidem(title) == ""


def test_kidem_aciklama_yalniz_guclu_isaret():
    assert detect_kidem("Satış Temsilcisi", "Yeni mezunlar başvurabilir.") == "yeni_mezun"
    assert detect_kidem("Satış Temsilcisi", "Bir manager'a rapor verecek senior bir ekip.") == ""
    assert detect_kidem("Senior Developer", "Yeni mezun değil") == "kidemli"  # başlık öncelikli


@pytest.mark.parametrize("tur,baslik,beklenen", [
    ("FULL_TIME", "", "tam"), ("Tam Zamanlı", "", "tam"), ("full-time", "", "tam"),
    ("PART_TIME", "", "yari"), ("Yarı Zamanlı", "", "yari"),
    ("INTERN", "", "staj"), ("Stajyer", "", "staj"),
    ("CONTRACTOR", "", "proje"), ("TEMPORARY", "", "proje"), ("Sözleşmeli", "", "proje"),
    ("Proje Bazlı", "", "proje"), ("Dönemsel", "", "proje"),
    ("", "Stajyer Avukat", "staj"), ("", "Part Time Garson", "yari"), ("", "Sözleşmeli Teknisyen", "proje"),
    ("", "Muhasebe Uzmanı", ""), ("bilinmeyen", "Garson", ""),
])
def test_istihdam(tur, baslik, beklenen):
    assert normalize_istihdam(tur, baslik) == beklenen


def test_maas():
    assert has_salary("45.000 TL")
    assert has_salary("30000 - 40000")
    assert not has_salary("Belirtilmemiş")
    assert not has_salary("Görüşülecek")
    assert not has_salary("Rekabetçi")
    assert not has_salary("")
    assert has_salary("", "Maaş: 50000 TL net")
    assert has_salary("", "Salary 60k + bonus")
    assert not has_salary("", "Rekabetçi maaş ve yan haklar sunuyoruz.")


def test_semt_tablo_ve_takma_adlar():
    assert detect_semt("Maslak, Sarıyer, İstanbul", "Sarıyer") == "Maslak"
    assert detect_semt("İstanbul", None, "Spine Tower ofisinde çalışacak") == "Maslak"
    assert detect_semt("Vadi İstanbul, Sarıyer", "Sarıyer") == "Ayazağa"
    assert detect_semt("4. Levent, İstanbul", "Beşiktaş") == "Levent"
    assert detect_semt("Kanyon AVM", None) == "Levent"
    assert detect_semt("Zorlu Center", "Beşiktaş") == "Zincirlikuyu"
    assert detect_semt("Torun Center, Şişli", "Şişli") == "Esentepe"
    assert detect_semt("İstanbul", "Kadıköy", "", "Kozyatağı'ndaki ofisimizde") == "Kozyatağı"
    assert detect_semt("Mecidiyeköy / İSTANBUL", "Şişli") == "Mecidiyeköy"


def test_semt_ilce_tutarsizsa_atanmaz():
    assert detect_semt("Göztepe, Bağcılar", "Bağcılar") == ""      # Kadıköy'deki Göztepe değil
    assert detect_semt("Esentepe, Kartal", "Kartal") == ""
    assert detect_semt("Gültepe, Esenyurt", "Esenyurt") == ""
    assert detect_semt("Merkez", "Sarıyer") == ""


def test_semt_konum_once_sonra_baslik():
    assert detect_semt("Etiler", "Beşiktaş", "Levent ofisi") == "Etiler"
    assert detect_semt("İstanbul", "Beşiktaş", "Levent ofisi") == "Levent"


def test_semtler_sabiti():
    ad = {s["ad"]: s["ilce"] for s in SEMTLER}
    assert ad["Maslak"] == "Sarıyer" and ad["Kavacık"] == "Beykoz" and ad["Altunizade"] == "Üsküdar"
    assert all(set(s) == {"ad", "ilce"} for s in SEMTLER)


# ---- db ----
_ESKI_SEMA = """
CREATE TABLE jobs (
    uid TEXT PRIMARY KEY, source TEXT NOT NULL, source_type TEXT NOT NULL, external_id TEXT,
    title TEXT NOT NULL, company TEXT, url TEXT, location TEXT, district TEXT, side TEXT, posted_at TEXT,
    employment_type TEXT, work_model TEXT, description TEXT, salary TEXT, category TEXT, extra TEXT,
    dedupe_key TEXT, search TEXT, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1, collar TEXT, lat REAL, lon REAL, title_search TEXT, grup TEXT
);
"""


def test_eski_sema_goc_ve_doldurma(tmp_path):
    path = tmp_path / "eski.db"
    con = sqlite3.connect(path)
    con.executescript(_ESKI_SEMA)
    con.execute(
        "INSERT INTO jobs (uid, source, source_type, title, company, location, district, employment_type, salary, "
        "description, extra, first_seen, last_seen) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("u1", "t", "platform", "Senior Developer", "Acme A.Ş.", "Maslak, Sarıyer", "Sarıyer", "FULL_TIME", "60.000 TL",
         "açıklama", "{}", "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"))
    con.commit()
    con.close()

    db = DB(path)
    cols = {r[1] for r in db.conn.execute("PRAGMA table_info(jobs)")}
    assert {"semt", "kidem", "istihdam", "maasli"} <= cols
    row = db.get_job("u1")
    assert (row["semt"], row["kidem"], row["istihdam"], row["maasli"]) == ("Maslak", "kidemli", "tam", 1)
    # sorgu filtreleri eski satırlar için de çalışır
    assert db.query(semts=["Maslak"], kidems=["kidemli"], istihdams=["tam"], maasli=True,
                    company="acme a s")["total"] == 1
    db.close()
    DB(path).close()  # ikinci açılışta göç tekrar patlamaz


def test_upsert_yeni_alanlari_hesaplar_ve_gunceller(tmp_path):
    db = DB(tmp_path / "u.db")
    base = dict(uid="a1", source="t", source_type="platform", external_id="1", title="Stajyer", company="Firma",
                url="https://t/1", location="Levent", district="Beşiktaş", employment_type="", salary="",
                description="", extra={}, dedupe_key="k1")
    db.upsert_jobs([base], "2026-10-01T00:00:00.000Z")
    r = db.get_job("a1")
    assert (r["semt"], r["kidem"], r["istihdam"], r["maasli"]) == ("Levent", "stajyer", "staj", 0)
    db.upsert_jobs([dict(base, title="Uzman", salary="40.000 TL", employment_type="PART_TIME")], "2026-10-02T00:00:00.000Z")
    r = db.get_job("a1")
    assert (r["kidem"], r["istihdam"], r["maasli"]) == ("uzman", "yari", 1)


def test_norm_since():
    assert norm_since("2026-10-01T10:00:00Z") == "2026-10-01T10:00:00.000Z"
    assert norm_since("2026-10-01T12:00:00+02:00") == "2026-10-01T10:00:00.000Z"
    assert norm_since("2026-10-01T12:00:00 02:00") == "2026-10-01T10:00:00.000Z"  # '+' boşluğa dönüşmüş
    assert norm_since("2026-10-01") == "2026-10-01T00:00:00.000Z"
    assert norm_since("saçma") is None and norm_since(None) is None
