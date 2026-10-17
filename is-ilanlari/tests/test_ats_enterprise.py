"""isilan.sources.ats_enterprise testleri — ağ yok; fixture'lar araştırılan biçimleri taklit eder (yalnızca test için)."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from isilan.http import HttpError
from isilan.models import COMPANY
from isilan.sources import ats, ats_enterprise as ent
from isilan.sources.base import FetchContext, Source
from isilan.text import fold

FIX = Path(__file__).parent / "fixtures" / "ats_enterprise"


def _load(name):
    txt = (FIX / name).read_text(encoding="utf-8")
    return json.loads(txt) if name.endswith(".json") else txt


class FakeHttp:
    def __init__(self, routes):
        self.routes, self.calls = routes, []

    def _r(self, url, payload=None):
        self.calls.append((url, payload))
        if url not in self.routes:
            raise HttpError(url, 404)
        r = self.routes[url]
        r = r(payload) if callable(r) else r
        return _load(r) if isinstance(r, str) else r

    def get(self, url, **kw):
        r = self._r(url)
        return r if isinstance(r, str) else json.dumps(r)

    def get_json(self, url, **kw):
        r = self._r(url)
        return json.loads(r) if isinstance(r, str) else r

    def post_json(self, url, payload=None, **kw):
        return self._r(url, payload)


@pytest.fixture(autouse=True)
def _geo(monkeypatch):
    try:
        ats.is_istanbul("Kadıköy, İstanbul")
        ent._decide  # noqa: B018
    except NotImplementedError:
        monkeypatch.setattr(ats, "is_istanbul", lambda t: "istanbul" in fold(t))


def _src(name, **params):
    params.setdefault("ats", name)
    return Source(name=f"{name}:{params['host']}", source_type=COMPANY, label=params.get("company", "X"),
                  fetcher=ent.FETCHERS[name], params=params)


def _run(src, routes, **kw):
    http = FakeHttp(routes)
    return list(src.fetch(FetchContext(http=http, **kw))), http


def test_successfactors_prefers_istanbul_urls():
    routes = {
        "https://jobs.example.com/sitemap.xml": "sf_sitemap.xml",
        "https://jobs.example.com/job/Istanbul-Senior-Developer/1001-en_US/": "sf_job_1001.html",
        "https://jobs.example.com/job/Istanbul-Sales-Manager/1003-en_US/": "sf_job_1003.html",
    }
    jobs, http = _run(_src("successfactors", host="jobs.example.com", company="Example"), routes)
    assert {j.title for j in jobs} == {"Senior Developer", "Sales Manager"}
    assert not any("Walldorf" in c[0] for c in http.calls)
    j = next(j for j in jobs if j.external_id == "1001")
    assert j.source == "successfactors:jobs.example.com" and j.posted_at == "2026-10-01"
    assert "Istanbul" in j.location and j.employment_type == "Full-time"


def test_successfactors_sitemap_index_and_cap():
    routes = {
        "https://jobs.example.com/sitemap.xml": "sf_index.xml",
        "https://jobs.example.com/sitemap1.xml": "sf_sitemap.xml",
        "https://jobs.example.com/job/Istanbul-Senior-Developer/1001-en_US/": "sf_job_1001.html",
        "https://jobs.example.com/job/Istanbul-Sales-Manager/1003-en_US/": "sf_job_1003.html",
    }
    ctx_http = FakeHttp(routes)
    ctx = FetchContext(http=ctx_http)
    src = _src("successfactors", host="jobs.example.com", max_jobs=1)
    jobs = list(src.fetch(ctx))
    assert len(jobs) == 1 and ctx.partial


def test_successfactors_non_istanbul_jsonld_dropped():
    routes = {"https://h.example.com/sitemap.xml": "sf_sitemap.xml"}
    for u in ("Istanbul-Senior-Developer/1001", "Istanbul-Sales-Manager/1003"):
        routes[f"https://jobs.example.com/job/{u}-en_US/"] = "icims_3002.html"
    routes["https://h.example.com/sitemap.xml"] = "sf_sitemap.xml"
    jobs, _ = _run(_src("successfactors", host="h.example.com"), routes)
    assert jobs == []  # tüm detaylar 404 / İstanbul dışı


def test_phenom_paging_and_filter():
    def handler(payload):
        assert payload["ddoKey"] == "refineSearch"
        return "phenom_p1.json" if payload["from"] == 0 else "phenom_p2.json"
    jobs, http = _run(_src("phenom", host="careers.example.com", page_size=2),
                      {"https://careers.example.com/widgets": handler})
    by = {j.title: j for j in jobs}
    assert set(by) == {"Data Analyst", "Remote Support"}
    assert by["Remote Support"].work_model == "remote"
    assert by["Data Analyst"].url == "https://careers.example.com/en/job/R100/data-analyst"
    assert len(http.calls) == 2


def test_eightfold():
    base = "https://careers.example.com/api/apply/v2/jobs?domain=example.com&start={}&num=2&location=Istanbul&sort_by=timestamp"
    routes = {base.format(0): "eightfold_p1.json", base.format(2): {"count": 12, "positions": []}}
    jobs, _ = _run(_src("eightfold", host="careers.example.com", domain="example.com", page_size=2), routes)
    assert [j.title for j in jobs] == ["Risk Officer"]
    assert jobs[0].work_model == "hybrid" and jobs[0].posted_at.startswith("2025-10")


def test_eightfold_max_pages_partial():
    url = "https://c.example.com/api/apply/v2/jobs?domain=c.example.com&start=0&num=2&location=Istanbul&sort_by=timestamp"
    http = FakeHttp({url: "eightfold_p1.json"})
    ctx = FetchContext(http=http, max_pages=1)
    list(_src("eightfold", host="c.example.com", page_size=2).fetch(ctx))
    assert ctx.partial


def test_taleo():
    api = "https://x.taleo.net/careersection/rest/jobboard/searchjobs?lang=en&portal=101430233"
    jobs, _ = _run(_src("taleo", host="x.taleo.net", section="ex_ext"),
                   {api: lambda pl: "taleo_p1.json" if pl["pageNo"] == 1 else "taleo_p2.json"})
    assert {j.title for j in jobs} == {"Finance Specialist", "IT Auditor"}
    fin = next(j for j in jobs if j.title == "Finance Specialist")
    assert fin.url == "https://x.taleo.net/careersection/ex_ext/jobdetail.ftl?job=26000001&lang=en"
    assert fin.posted_at == "2026-10-12"


def test_icims():
    routes = {
        "https://careers-ex.icims.com/jobs/search?ss=1&in_iframe=1&pr=0&searchLocation=": "icims_list0.html",
        "https://careers-ex.icims.com/jobs/search?ss=1&in_iframe=1&pr=1&searchLocation=": "icims_empty.html",
        "https://careers-ex.icims.com/jobs/3001/hr-specialist/job?in_iframe=1": "icims_3001.html",
        "https://careers-ex.icims.com/jobs/3002/driver/job?in_iframe=1": "icims_3002.html",
    }
    jobs, _ = _run(_src("icims", host="careers-ex.icims.com"), routes)
    assert [j.title for j in jobs] == ["HR Specialist"]


def test_registry_routing():
    entries = [
        {"company": "A", "ats": "successfactors", "host": "jobs.a.com", "enabled": True},
        {"company": "B", "ats": "sitemap", "host": "jobs.b.com"},
        {"company": "C", "ats": "greenhouse", "slug": "c"},
        {"company": "D", "ats": "phenom"},  # host yok -> atlanır
    ]
    names = [s.name for s in ent.sources(entries)]
    assert names == ["successfactors:jobs.a.com", "successfactors:jobs.b.com"]
    assert all(ats.make_source(e) is None for e in entries[:2])
    assert ats.make_source(entries[2]) is not None


def test_module_registered():
    from isilan.sources import MODULES
    assert "ats_enterprise" in MODULES
