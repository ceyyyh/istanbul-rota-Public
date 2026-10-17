"""Entegrasyon incelemesinde bulunan hatalar için regresyon testleri (ağ kullanmaz)."""
from __future__ import annotations

import json
import sqlite3
import threading
import urllib.request
from datetime import date, datetime, timedelta, timezone
from http.server import ThreadingHTTPServer

import pytest
import requests

from isilan.db import DB
from isilan.http import Http, HttpError
from isilan.models import COMPANY, PLATFORM, Job
from isilan.pipeline import CrawlOptions, crawl, enrich, norm_date, run_source
from isilan.sources.base import FetchContext, Source
from isilan.sources.careerpage import fetch_careerpage
from isilan.sources.platforms import linkedin
from isilan.sources.platforms._cards import paginate


def _job(i, **kw):
    base = dict(source="t", source_type=PLATFORM, external_id=str(i), title=f"İlan {i}", company="Firma",
                url=f"https://x.test/{i}", location="Kadıköy, İstanbul")
    base.update(kw)
    return Job(**base)


def _src(jobs_or_fn, name="t"):
    fn = jobs_or_fn if callable(jobs_or_fn) else (lambda s, c: iter(list(jobs_or_fn)))
    return Source(name=name, source_type=PLATFORM, label=name, fetcher=fn)


# --- enrich: kaynaklardan gelen beklenmedik tipler ---------------------------------------------

def test_enrich_coerces_odd_types():
    row = enrich(_job(1, location=["Kadıköy", "İstanbul"], company=None, posted_at=1760000000000))
    assert row["district"] == "Kadıköy" and row["company"] == ""
    assert row["posted_at"].startswith("2025-10-")
    row = enrich(_job(2, location={"name": "Beşiktaş, İstanbul"}, posted_at=datetime(2026, 10, 1, 9, 30)))
    assert row["district"] == "Beşiktaş" and row["posted_at"] == "2026-10-01T09:30:00"
    assert enrich(_job(3, title=None)) is None


@pytest.mark.parametrize("raw,want", [
    ("2026-10-15", "2026-10-15"),
    ("2026-10-15T10:00:00+03:00", "2026-10-15T10:00:00+03:00"),
    ("15.10.2026", "2026-10-15"),          # Türk sitelerinin JSON-LD datePosted'ı
    ("12 Ekim 2026", "2026-10-12"),
    ("3 gün önce", None),                   # göreli metin burada uydurulmaz
    ("2026-13-45", None),
    ("", None), (None, None), (0, None),
    (date(2026, 1, 2), "2026-01-02"),
])
def test_norm_date(raw, want):
    assert norm_date(raw) == want


def test_non_iso_posted_at_does_not_break_days_filter(tmp_path):
    db = DB(tmp_path / "d.db")
    recent = (datetime.now(timezone.utc) - timedelta(days=2)).strftime("%d.%m.%Y")
    crawl(db, [_src([_job(1, posted_at=recent), _job(2, posted_at="01.01.2020")])])
    res = db.query(days=7)
    assert [i["external_id"] for i in res["items"]] == ["1"]
    assert db.query(sort="old")["items"][0]["external_id"] == "2"


def test_one_bad_job_does_not_abort_source(tmp_path):
    db = DB(tmp_path / "b.db")
    st = crawl(db, [_src([_job(1), None, _job(2, extra=None)])])  # None: ayrıştırıcı hatası taklidi
    assert st.results["t"]["status"] == "ok" and st.results["t"]["kept"] == 2


def test_unexpected_run_source_error_does_not_stop_crawl(tmp_path, monkeypatch):
    db = DB(tmp_path / "u.db")
    real = db.upsert_jobs

    def flaky(rows, seen):
        if rows and rows[0]["source"] == "bad":
            raise sqlite3.OperationalError("database is locked")
        return real(rows, seen)

    monkeypatch.setattr(db, "upsert_jobs", flaky)
    st = crawl(db, [_src([_job(1)], "bad"), _src([_job(2)], "good")], CrawlOptions(workers=1))
    assert st.results["bad"]["status"] == "error" and st.results["good"]["status"] == "ok"
    assert st.running is False


# --- validThrough ---------------------------------------------------------------------------

def test_valid_through_non_iso_is_normalized_and_not_misexpired(tmp_path):
    db = DB(tmp_path / "v.db")
    crawl(db, [_src([_job(1, extra={"validThrough": "01.11.2099"}),       # "0" < "2": eskiden hemen pasif
                     _job(2, extra={"validThrough": "15.10.2020"}),
                     _job(3, extra={"validThrough": "yakında"})])])
    ids = {i["external_id"]: i for i in db.query()["items"]}
    assert set(ids) == {"1", "3"}
    assert ids["1"]["extra"]["validThrough"] == "2099-11-01"


def test_expire_old_ignores_non_iso_valid_through_already_in_db(tmp_path):
    db = DB(tmp_path / "v2.db")
    row = enrich(_job(1))
    row["extra"] = {"validThrough": "01.12.2099"}
    db.upsert_jobs([row], "2026-10-17T00:00:00.000Z")
    db.expire_old()
    assert db.query()["total"] == 1


# --- eksik (yarıda kesilen) taramalar ---------------------------------------------------------

def test_partial_crawl_does_not_deactivate(tmp_path):
    db = DB(tmp_path / "p.db")
    jobs = [_job(i) for i in range(4)]
    src = _src(lambda s, c: iter(jobs))
    run_source(src, db, Http(), CrawlOptions())
    assert db.query()["total"] == 4

    def cut(s, ctx):
        yield jobs[0]
        ctx.mark_partial("2. sayfada 429")

    res = run_source(_src(cut), db, Http(), CrawlOptions())
    assert res["removed"] == 0 and db.query()["total"] == 4


def test_linkedin_429_on_later_page_marks_partial(fake_http):
    from conftest import FIXTURES
    html = (FIXTURES / "platforms" / "linkedin_page1.html").read_text(encoding="utf-8")
    calls = {"n": 0}

    def route():
        calls["n"] += 1
        if calls["n"] > 1:
            raise HttpError("x", 429)
        return html

    ctx = FetchContext(http=fake_http({linkedin.SEARCH: route}))
    src = linkedin.sources()[0]
    src.params = dict(src.params, delay=0)
    jobs = list(src.fetch(ctx))
    assert jobs and ctx.partial


def test_paginate_http_error_marks_partial():
    ctx = FetchContext(http=Http())

    def page(n):
        if n == 2:
            raise HttpError("x", 503)
        return [_job(n)]

    assert len(list(paginate(ctx, page, source="t"))) == 1 and ctx.partial


# --- careerpage → ATS devri ---------------------------------------------------------------

LIST_HTML = ('<html><body><a href="https://jobs.lever.co/yanlisslug">Lever</a>'
             '<a href="https://ornek.com/kariyer/ilan/1-garson">Garson</a></body></html>')
DETAIL = ('<html><script type="application/ld+json">{"@type":"JobPosting","title":"Garson","identifier":"1",'
          '"jobLocation":{"address":{"addressLocality":"Kadıköy","addressRegion":"İstanbul"}}}</script></html>')


def test_careerpage_falls_back_when_embedded_ats_fails(fake_http):
    http = fake_http({"https://ornek.com/kariyer": LIST_HTML,
                      "https://ornek.com/kariyer/ilan/1-garson": DETAIL})  # Lever API → 404
    src = Source(name="careerpage:ornek", source_type=COMPANY, label="Örnek", fetcher=fetch_careerpage,
                 params={"company": "Örnek", "careers_url": "https://ornek.com/kariyer"})
    ctx = FetchContext(http=http)
    jobs = list(src.fetch(ctx))
    assert [j.title for j in jobs] == ["Garson"] and ctx.partial


def test_careerpage_reports_error_when_nothing_works(fake_http):
    http = fake_http({"https://ornek.com/kariyer": '<a href="https://jobs.lever.co/yanlisslug">x</a>'})
    src = Source(name="careerpage:ornek", source_type=COMPANY, label="Örnek", fetcher=fetch_careerpage,
                 params={"careers_url": "https://ornek.com/kariyer"})
    with pytest.raises(HttpError):
        list(src.fetch(FetchContext(http=http)))


# --- yaka ipucu -----------------------------------------------------------------------------

def test_side_from_kariyernet_style_location(tmp_path):
    db = DB(tmp_path / "s.db")
    crawl(db, [_src([_job(1, location="İstanbul(Avr.)"), _job(2, location="İstanbul (Asya)"),
                     _job(3, location="İstanbul(Asya) | İstanbul(Avr.)")])])
    assert [i["external_id"] for i in db.query(side="avrupa")["items"]] == ["1"]
    assert [i["external_id"] for i in db.query(side="anadolu")["items"]] == ["2"]
    assert db.query(districts=["Kadıköy"], include_unknown=True)["total"] == 3  # ilçe hâlâ belirsiz


# --- sorgu önbelleği / tekilleştirme ----------------------------------------------------------

def test_query_cache_invalidated_by_writes_and_other_connections(tmp_path):
    path = tmp_path / "c.db"
    db = DB(path)
    crawl(db, [_src([_job(1)])])
    assert db.query()["total"] == 1
    crawl(db, [_src([_job(1), _job(2)])])
    assert db.query()["total"] == 2
    other = DB(path)  # ör. ayrı süreçte çalışan `python -m isilan crawl`
    other.deactivate_missing("t", "9999")
    assert db.query()["total"] == 0


def test_query_full_items_and_light_all(tmp_path):
    db = DB(tmp_path / "f.db")
    a = _job(1, description="ayrıntı", source="t")
    b = Job(source="co", source_type=COMPANY, external_id="9", title="İlan 1", company="Firma A.Ş.",
            url="https://co/9", location="Kadıköy / İstanbul")
    crawl(db, [_src([a]), Source(name="co", source_type=COMPANY, label="co", fetcher=lambda s, c: iter([b]))])
    res = db.query(per_page=10**9)
    assert res["total"] == 1
    it = res["items"][0]
    assert it["source"] == "co" and it["duplicates"] == [{"source": "t", "source_type": PLATFORM, "url": "https://x.test/1"}]
    assert it["first_seen"] and isinstance(it["extra"], dict)
    assert [x["district"] for x in res["_all"]] == ["Kadıköy"]
    assert res["_all"].full()[0]["uid"] == it["uid"]


# --- web ------------------------------------------------------------------------------------

def test_web_bad_params(tmp_path, monkeypatch):
    from isilan.web import App, make_handler
    monkeypatch.setattr("isilan.web.source_meta", lambda: {})
    db = DB(tmp_path / "w.db")
    crawl(db, [_src([_job(1)])])
    app = App(db)
    started = []
    monkeypatch.setattr(app, "start_crawl", lambda names=None: started.append(names) or True)
    srv = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(app))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    try:
        with urllib.request.urlopen(base + "/api/jobs?page=abc&per_page=") as r:
            assert json.loads(r.read())["total"] == 1
        req = urllib.request.Request(base + "/api/crawl", data=b'{"sources": "linkedin"}', method="POST",
                                     headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req).read()
        assert started == [["linkedin"]]
    finally:
        srv.shutdown()


# --- Http -----------------------------------------------------------------------------------

def _resp(body: bytes, status=200, ctype="text/html", headers=None):
    r = requests.Response()
    r.status_code = status
    r._content = body
    r.headers.update({"Content-Type": ctype, **(headers or {})})
    r.encoding = requests.utils.get_encoding_from_headers(r.headers)
    return r


def test_http_utf8_without_charset(monkeypatch):
    h = Http(min_interval=0)
    monkeypatch.setattr(requests.Session, "request", lambda self, m, u, **kw: _resp("İstanbul Kadıköy şçğü".encode()))
    assert h.get("https://x.test/") == "İstanbul Kadıköy şçğü"


def test_http_retry_after_is_capped(monkeypatch):
    h = Http(min_interval=0, retries=2)
    seq = iter([_resp(b"", 429, headers={"Retry-After": "3600"}), _resp(b"ok")])
    monkeypatch.setattr(requests.Session, "request", lambda self, m, u, **kw: next(seq))
    slept = []
    monkeypatch.setattr("isilan.http.time.sleep", slept.append)
    assert h.get("https://x.test/") == "ok"
    assert slept and max(slept) <= 60


def test_remote_job_tied_to_other_city_is_dropped():
    from isilan.models import PLATFORM, Job
    from isilan.pipeline import enrich
    mk = lambda loc: Job(source="s", source_type=PLATFORM, external_id=loc, title="Dev", company="C",
                         url="https://x/" + loc, location=loc, work_model="remote")
    assert enrich(mk("Ankara")) is None
    assert enrich(mk("Türkiye")) is not None
    assert enrich(mk("")) is not None
