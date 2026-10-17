"""Beyaz/mavi yaka, yakınlık ve "bana uygun" filtreleri."""
import sqlite3

from isilan.classify import collar
from isilan.db import DB
from isilan.models import COMPANY, PLATFORM, Job
from isilan.pipeline import crawl
from isilan.sources.base import Source

PTT = (41.142, 29.036)


def _seed(path):
    jobs = [
        Job(source="p", source_type=PLATFORM, external_id="1", title="Yazılım Geliştirici (Python)", company="A",
            url="https://x/1", location="Maslak, Sarıyer/İstanbul", description="Django ve PostgreSQL"),
        Job(source="p", source_type=PLATFORM, external_id="2", title="Forklift Operatörü", company="B",
            url="https://x/2", location="Esenyurt, İstanbul"),
        Job(source="p", source_type=PLATFORM, external_id="3", title="Muhasebe Uzmanı", company="C",
            url="https://x/3", location="Levent, İstanbul"),
        Job(source="p", source_type=PLATFORM, external_id="4", title="Resepsiyonist", company="D",
            url="https://x/4", location="İstanbul"),
        Job(source="p", source_type=PLATFORM, external_id="5", title="Python Stajyer", company="E",
            url="https://x/5", location="Kadıköy, İstanbul"),
    ]
    db = DB(path)
    crawl(db, [Source(name="p", source_type=PLATFORM, label="P", fetcher=lambda s, c: iter(jobs))])
    return db


def test_collar_rules():
    assert collar("Üretim Mühendisi") == "beyaz"
    assert collar("CNC Operatörü") == "mavi"
    assert collar("Mağaza Satış Danışmanı") == "mavi"
    assert collar("Depo Sorumlusu") == "mavi"
    assert collar("Bilinmeyen Unvan") is None
    assert collar("Bilinmeyen Unvan", source="lever:x", source_type=COMPANY) == "beyaz"


def test_collar_filter(tmp_path):
    db = _seed(tmp_path / "f.db")
    titles = lambda r: sorted(i["title"] for i in r["items"])  # noqa: E731
    assert titles(db.query(collars=["mavi"])) == ["Forklift Operatörü"]
    assert len(db.query(collars=["beyaz"])["items"]) == 3
    assert titles(db.query(collars=["belirsiz"])) == ["Resepsiyonist"]


def test_proximity_sort_and_radius(tmp_path):
    db = _seed(tmp_path / "f.db")
    r = db.query(near=PTT, sort="near")
    order = [i["title"] for i in r["items"]]
    assert order[0] == "Yazılım Geliştirici (Python)"         # Maslak ≈ 4 km
    assert order[1] == "Muhasebe Uzmanı"                       # Levent ≈ 7 km
    assert order[-1] == "Resepsiyonist"                        # koordinatsız en sonda
    assert r["items"][0]["distance_km"] < 6 and r["items"][-1]["distance_km"] is None
    assert [i["title"] for i in db.query(near=PTT, max_km=10)["items"]].__len__() == 2
    assert db.query(near=PTT, max_km=10, ignore=("max_km",))["total"] == 5


def test_fit_keywords_and_exclusions(tmp_path):
    db = _seed(tmp_path / "f.db")
    r = db.query(kw=["python", "django"], sort="fit")
    assert [i["title"] for i in r["items"]] == ["Yazılım Geliştirici (Python)", "Python Stajyer"]
    assert r["items"][0]["match"] == {"score": 2, "terms": ["python", "django"]}
    r = db.query(kw=["Python"], exclude=["stajyer"])
    assert [i["title"] for i in r["items"]] == ["Yazılım Geliştirici (Python)"]


def test_old_database_is_migrated(tmp_path):
    path = tmp_path / "old.db"
    c = sqlite3.connect(path)
    c.executescript("""CREATE TABLE jobs (uid TEXT PRIMARY KEY, source TEXT NOT NULL, source_type TEXT NOT NULL,
      external_id TEXT, title TEXT NOT NULL, company TEXT, url TEXT, location TEXT, district TEXT, side TEXT,
      posted_at TEXT, employment_type TEXT, work_model TEXT, description TEXT, salary TEXT, category TEXT,
      extra TEXT, dedupe_key TEXT, search TEXT, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1);
      INSERT INTO jobs VALUES ('u1','p','platform','1','Kasiyer','M','https://x','Maslak','Sarıyer','avrupa',NULL,'','',
      '','','','{}','k','kasiyer','2026-10-01','2026-10-01',1);""")
    c.commit()
    c.close()
    db = DB(path)
    it = db.query()["items"][0]
    assert it["collar"] == "mavi" and abs(it["lat"] - 41.110) < 0.01


def test_headquarters_is_not_a_manager_title():
    assert collar("Silahlı Güvenlik Görevlisi-Banka Genel Müdürlük") == "mavi"
    assert collar("Genel Müdürlük Muhasebe Uzmanı") == "beyaz"
