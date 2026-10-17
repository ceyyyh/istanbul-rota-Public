"""Kullanıcının ilk gerçek taramasında görülen sorunların regresyon testleri."""
import json

from conftest import FakeHttp

from isilan.db import DB
from isilan.http import HttpError
from isilan.models import COMPANY, PLATFORM, Job
from isilan.pipeline import CrawlOptions, district_from_detail, run_source
from isilan.sources import ats
from isilan.sources.base import FetchContext, Source

DETAIL_JSONLD = """<html><head><script type="application/ld+json">
{"@type":"JobPosting","title":"Kasiyer","jobLocation":{"address":{"addressLocality":"Ataşehir","addressRegion":"İstanbul"}}}
</script></head><body><footer><a>Kadıköy iş ilanları</a></footer></body></html>"""
DETAIL_LABEL = "<html><body><nav>Beşiktaş Şişli Fatih</nav><dl><dt>Lokasyon:</dt><dd>İstanbul / Pendik</dd></dl></body></html>"
DETAIL_NONE = "<html><body><nav>Beşiktaş iş ilanları</nav><p>Güzel bir iş.</p></body></html>"


def test_district_from_detail_ignores_navigation():
    assert district_from_detail(DETAIL_JSONLD) == "Ataşehir"
    assert district_from_detail(DETAIL_LABEL) == "Pendik"
    assert district_from_detail(DETAIL_NONE) is None


def test_details_fill_unknown_districts_once_and_keep_them(tmp_path):
    db = DB(tmp_path / "d.db")
    jobs = [Job(source="k", source_type=PLATFORM, external_id=str(i), title=f"İlan {i}", company="F",
                url=f"https://k.test/{i}", location="İstanbul(Asya)") for i in range(3)]
    http = FakeHttp({"https://k.test/0": DETAIL_JSONLD, "https://k.test/1": DETAIL_LABEL,
                     "https://k.test/2": DETAIL_NONE})
    src = Source(name="k", source_type=PLATFORM, label="K", fetcher=lambda s, c: iter(jobs))
    run_source(src, db, http, CrawlOptions())
    got = {r["external_id"]: r["district"] for r in db.query(per_page=10)["items"]}
    assert got == {"0": "Ataşehir", "1": "Pendik", "2": None}
    assert db.query(side="anadolu")["total"] == 3            # ilçe bulunamasa da yaka korunur
    n = len(http.calls)
    run_source(src, db, http, CrawlOptions())                # ikinci tarama: detaylara tekrar gidilmez
    assert len(http.calls) == n
    got = {r["external_id"]: r["district"] for r in db.query(per_page=10)["items"]}
    assert got["0"] == "Ataşehir" and got["1"] == "Pendik"   # liste sayfası ilçesizdi ama bilgi kaybolmadı


class _Cookies(dict):
    pass


class _Sess:
    def __init__(self):
        self.cookies = _Cookies()


class WorkdayHttp:
    """İlk API çağrısı HTML döner (çerez yok); karşılama sayfasından sonra JSON döner."""

    def __init__(self):
        self.session = _Sess()
        self.posts = []

    def get(self, url, **kw):
        self.session.cookies["CALYPSO_CSRF_TOKEN"] = "tok123"
        return "<html>careers</html>"

    def post_json(self, url, payload=None, headers=None, **kw):
        self.posts.append(dict(headers or {}))
        if "X-CALYPSO-CSRF-TOKEN" not in (headers or {}):
            raise json.JSONDecodeError("Expecting value", "<html>", 0)
        return {"total": 1, "facets": [], "jobPostings": [
            {"title": "Medical Rep", "externalPath": "/job/Istanbul/Medical-Rep_R1", "locationsText": "Istanbul, Turkey",
             "postedOn": "Posted Today", "bulletFields": ["R1"]}]}


def test_workday_warms_up_session_and_sends_csrf():
    http = WorkdayHttp()
    src = Source(name="workday:x", source_type=COMPANY, label="X", fetcher=ats.fetch_workday,
                 params={"company": "X", "host": "x.wd3.myworkdayjobs.com", "tenant": "x", "site": "Ext"})
    jobs = list(src.fetch(FetchContext(http=http)))
    assert [j.title for j in jobs] == ["Medical Rep"]
    assert http.posts[-1]["X-CALYPSO-CSRF-TOKEN"] == "tok123"


def test_greenhouse_eu_falls_back_to_board_page():
    board = '<a href="https://job-boards.eu.greenhouse.io/acme/jobs/123">Backend</a>'
    detail = """<script type="application/ld+json">{"@type":"JobPosting","title":"Backend Engineer",
      "jobLocation":{"address":{"addressLocality":"Istanbul"}}}</script>"""

    def api_down():
        raise HttpError("https://boards-api.greenhouse.io/x", None)

    http = FakeHttp({"https://boards-api.greenhouse.io/v1/boards/acme/jobs": api_down,
                     "https://job-boards.eu.greenhouse.io/acme/jobs/123": detail,
                     "https://job-boards.eu.greenhouse.io/acme": board})
    src = Source(name="greenhouse:acme", source_type=COMPANY, label="Acme", fetcher=ats.fetch_greenhouse,
                 params={"company": "Acme", "slug": "acme", "region": "eu"})
    jobs = list(src.fetch(FetchContext(http=http)))
    assert [j.title for j in jobs] == ["Backend Engineer"]


def test_detail_lookups_never_fall_back_to_browser(monkeypatch):
    """İlçe için detay sayfası bakılırken engel → tarayıcıya düşülmez (her biri ~45 sn sürüyordu)."""
    import pytest

    from isilan.browser import BrowserHttp
    from isilan.http import Http

    def blocked(self, url, method="GET", **kw):
        kw.pop("no_browser", None)
        raise HttpError(url, 401)

    monkeypatch.setattr(Http, "text", blocked)
    h = BrowserHttp(min_interval=0)
    monkeypatch.setattr(h, "browser_get", lambda *a, **k: pytest.fail("tarayıcı açılmamalı"))
    with pytest.raises(HttpError):
        h.get("https://x.test/job/1", no_browser=True)


def test_blocked_detail_pages_stop_district_lookup(tmp_path):
    db = DB(tmp_path / "b.db")
    jobs = [Job(source="k", source_type=PLATFORM, external_id=str(i), title=f"İlan {i}", company="F",
                url=f"https://k.test/{i}", location="İstanbul") for i in range(10)]
    http = FakeHttp({"https://k.test/": "<html><title>Just a moment...</title></html>"})
    run_source(Source(name="k", source_type=PLATFORM, label="K", fetcher=lambda s, c: iter(jobs)), db, http, CrawlOptions())
    assert len(http.calls) == 3   # 3 engel sayfasından sonra vazgeçildi
