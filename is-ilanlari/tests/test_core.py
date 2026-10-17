from pathlib import Path

from conftest import FIXTURES

from isilan.db import DB, dedupe_key
from isilan.jsonld import extract_jobpostings, jobposting_to_job
from isilan.models import COMPANY, PLATFORM, Job
from isilan.pipeline import CrawlOptions, crawl, enrich
from isilan.sources.base import FetchContext, Source
from isilan.sources.careerpage import collect_job_links, detect_ats, fetch_careerpage

CORE = FIXTURES / "core"


def read(name):
    return (CORE / name).read_text(encoding="utf-8")


def test_jsonld_mapping():
    d = extract_jobpostings(read("job_123.html"))[0]
    job = jobposting_to_job(d, source="x", source_type=COMPANY, url="https://ornek.com/kariyer/ilan/123")
    assert job.title == "Backend Geliştirici"
    assert job.external_id == "123"
    assert job.company == "Örnek Yazılım A.Ş."
    assert "Sarıyer" in job.location and "İstanbul" in job.location
    assert job.posted_at == "2026-10-10"
    assert job.description == "Python & PostgreSQL deneyimi"
    assert job.extra["validThrough"] == "2099-01-01"


def test_collect_links_and_ats_detection():
    links = collect_job_links(read("careers_list.html"), "https://ornek.com/kariyer")
    assert links == ["https://ornek.com/kariyer/ilan/123-backend-gelistirici",
                     "https://ornek.com/kariyer/ilan/124-satis-temsilcisi",
                     "https://ornek.com/kariyer/ilan/125-ankara-muhasebe"]
    html = '<a href="https://jobs.lever.co/ornek/abc">x</a><iframe src="https://boards.greenhouse.io/embed/job_board?for=ornekco"></iframe>'
    assert set(detect_ats(html)) == {("lever", "ornek"), ("greenhouse", "ornekco")}


def test_careerpage_source_end_to_end(fake_http):
    http = fake_http({
        "https://ornek.com/kariyer": read("careers_list.html"),
        "https://ornek.com/kariyer/ilan/123-backend-gelistirici": read("job_123.html"),
        "https://ornek.com/kariyer/ilan/124-satis-temsilcisi": read("job_124.html"),
        "https://ornek.com/kariyer/ilan/125-ankara-muhasebe": read("job_125.html"),
    })
    src = Source(name="careerpage:ornek", source_type=COMPANY, label="Örnek", fetcher=fetch_careerpage,
                 params={"company": "Örnek", "careers_url": "https://ornek.com/kariyer"})
    jobs = list(src.fetch(FetchContext(http=http)))
    titles = [j.title for j in jobs]
    assert "Backend Geliştirici" in titles
    assert "Satış Temsilcisi" in titles  # JSON-LD yok → sezgisel
    rows = [r for r in (enrich(j) for j in jobs) if r]
    by_title = {r["title"]: r for r in rows}
    assert by_title["Backend Geliştirici"]["district"] == "Sarıyer"
    assert by_title["Backend Geliştirici"]["side"] == "avrupa"
    assert by_title["Satış Temsilcisi"]["district"] == "Kadıköy"
    assert "Muhasebe Uzmanı" not in by_title  # Ankara → elendi


def _job(i, **kw):
    base = dict(source="test", source_type=PLATFORM, external_id=str(i), title=f"İlan {i}", company="Firma",
                url=f"https://x.test/{i}", location="Kadıköy, İstanbul")
    base.update(kw)
    return Job(**base)


def test_pipeline_db_dedupe_and_deactivation(tmp_path):
    db = DB(tmp_path / "t.db")
    batch = [
        _job(1),
        _job(2, location="İstanbul(Avr.) - Esenyurt"),
        _job(3, location="Ankara"),
        _job(4, location="Türkiye (Remote)"),
    ]
    other = [Job(source="sirket", source_type=COMPANY, external_id="a", title="İlan 1", company="Firma A.Ş.",
                 url="https://firma.test/1", location="Kadıköy / İstanbul")]
    s1 = Source(name="test", source_type=PLATFORM, label="Test", fetcher=lambda s, c: iter(list(batch)))
    s2 = Source(name="sirket", source_type=COMPANY, label="Şirket", fetcher=lambda s, c: iter(other))
    st = crawl(db, [s1, s2], CrawlOptions(workers=2))
    assert st.results["test"]["kept"] == 3          # Ankara elendi
    res = db.query(per_page=50)
    assert res["total"] == 3                         # İlan 1 iki kaynakta → tek kayıt
    first = [i for i in res["items"] if i["title"] == "İlan 1"][0]
    assert first["source"] == "sirket"               # şirketin kendi sayfası öncelikli
    assert first["duplicates"][0]["source"] == "test"
    assert db.query(districts=["Esenyurt"])["total"] == 1
    assert db.query(districts=["Esenyurt"], include_unknown=True)["total"] == 2  # + uzaktan (ilçesiz)
    assert db.query(side="anadolu")["total"] == 1
    assert db.query(work_models=["remote"])["total"] == 1
    assert db.query(q="esenyurt")["total"] == 1

    # İkinci tarama: ilan 2 artık yok → pasif
    batch[:] = [_job(1), _job(4, location="Türkiye (Remote)")]
    crawl(db, [s1], CrawlOptions(workers=1))
    assert db.query(districts=["Esenyurt"])["total"] == 0
    assert db.last_runs()["test"]["status"] == "ok"


def test_failing_source_does_not_deactivate(tmp_path):
    db = DB(tmp_path / "t.db")
    ok = Source(name="s", source_type=PLATFORM, label="S", fetcher=lambda s, c: iter([_job(1)]))
    crawl(db, [ok])

    def boom(s, c):
        raise RuntimeError("site değişmiş")
        yield  # noqa

    bad = Source(name="s", source_type=PLATFORM, label="S", fetcher=boom)
    st = crawl(db, [bad])
    assert st.results["s"]["status"] == "error"
    assert db.query()["total"] == 1


def test_dedupe_key_normalizes_company():
    assert dedupe_key("Yazılım Uzmanı", "ÖRNEK Teknoloji A.Ş.", "Şişli") == dedupe_key("yazilim uzmani", "Örnek", "Şişli")


def test_truncated_run_keeps_unseen_jobs(tmp_path):
    db = DB(tmp_path / "t.db")
    jobs = [_job(i, source="p") for i in range(5)]

    def paged(s, ctx):  # her sayfa için bir istek yapan kaynak taklidi
        for j in jobs:
            ctx.http.get("https://x.test/page")
            yield j

    class Dummy:
        request_count = 0

        def get(self, url, **kw):
            return ""

    from isilan.pipeline import run_source
    src = Source(name="p", source_type=PLATFORM, label="P", fetcher=paged)
    run_source(src, db, Dummy(), CrawlOptions(max_pages=100))
    jobs[:] = jobs[:2]
    res = run_source(src, db, Dummy(), CrawlOptions(max_pages=2))   # sınıra takıldı → silme yok
    assert res["removed"] == 0 and db.query()["total"] == 5
    res = run_source(src, db, Dummy(), CrawlOptions(max_pages=100))  # eksiksiz → 3 ilan kalktı
    assert res["removed"] == 3 and db.query()["total"] == 2
