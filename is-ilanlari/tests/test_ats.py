"""isilan.sources.ats testleri — ağ kullanmaz; fixture'lar resmi API biçimlerine göre hazırlanmıştır."""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest

from isilan.http import HttpError
from isilan.models import AGENCY, COMPANY
from isilan.sources import ats
from isilan.sources.base import FetchContext, Source
from isilan.text import fold

FIX = Path(__file__).parent / "fixtures" / "ats"


def _load(name: str):
    txt = (FIX / name).read_text(encoding="utf-8")
    return json.loads(txt) if name.endswith(".json") else txt


class FakeHttp:
    """URL -> fixture adı (ya da çağrılabilir) eşlemesiyle çalışan sahte Http."""

    def __init__(self, routes: dict):
        self.routes = routes
        self.calls: list[tuple[str, str, object]] = []

    def _resolve(self, method, url, payload=None):
        self.calls.append((method, url, payload))
        if url not in self.routes:
            raise HttpError(url, 404)
        r = self.routes[url]
        if callable(r):
            r = r(payload)
        if isinstance(r, Exception):
            raise r
        return _load(r) if isinstance(r, str) else r

    def get_json(self, url, **kw):
        return self._resolve("GET", url)

    def post_json(self, url, payload=None, **kw):
        return self._resolve("POST", url, payload)

    def get(self, url, **kw):
        return self._resolve("GET", url)


@pytest.fixture(autouse=True)
def _geo(monkeypatch):
    """geo.py henüz uygulanmamışsa basit bir yedek kullan."""
    try:
        ats.is_istanbul("Kadıköy, İstanbul")
    except NotImplementedError:
        monkeypatch.setattr(ats, "is_istanbul", lambda t: "istanbul" in fold(t))
    try:
        ats.detect_district("Kadıköy")
    except NotImplementedError:
        monkeypatch.setattr(ats, "detect_district", lambda t: None)


def _src(ats_name: str, **params) -> Source:
    params.setdefault("ats", ats_name)
    return Source(name=f"{ats_name}:{params.get('slug') or params.get('tenant')}", source_type=COMPANY,
                  label=params.get("company", "X"), fetcher=ats.FETCHERS[ats_name], params=params)


def _run(src: Source, routes: dict, **ctx_kw):
    http = FakeHttp(routes)
    jobs = list(src.fetch(FetchContext(http=http, **ctx_kw)))
    return jobs, http


def _by_title(jobs):
    return {j.title: j for j in jobs}


# --------------------------------------------------------------------------- greenhouse

def test_greenhouse():
    jobs, _ = _run(_src("greenhouse", slug="peakgames", company="Peak Games"), {
        "https://boards-api.greenhouse.io/v1/boards/peakgames/jobs?content=true": "greenhouse_jobs.json"})
    t = _by_title(jobs)
    assert set(t) == {"Senior Backend Engineer", "Data Analyst"}
    j = t["Senior Backend Engineer"]
    assert j.source == "greenhouse:peakgames" and j.source_type == COMPANY
    assert j.company == "Peak Games"
    assert j.external_id == "5512345"
    assert j.url == "https://boards.greenhouse.io/peakgames/jobs/5512345"
    assert j.location == "Istanbul, Turkey"
    assert j.posted_at.startswith("2024-04-18T10:00:00")
    assert j.work_model == "hybrid"
    assert j.description.startswith("We are looking for a Senior Backend Engineer")
    assert "<" not in j.description
    assert j.category == "Engineering"
    assert t["Data Analyst"].work_model == "remote"
    assert t["Data Analyst"].posted_at.startswith("2024-05-03")


def test_greenhouse_remote_tr_can_be_disabled():
    jobs, _ = _run(_src("greenhouse", slug="peakgames", include_remote_tr=False), {
        "https://boards-api.greenhouse.io/v1/boards/peakgames/jobs?content=true": "greenhouse_jobs.json"})
    assert [j.title for j in jobs] == ["Senior Backend Engineer"]


# --------------------------------------------------------------------------- lever

def test_lever_eu():
    jobs, http = _run(_src("lever", slug="getir", company="Getir", region="eu"), {
        "https://api.eu.lever.co/v0/postings/getir?mode=json": "lever_postings.json"})
    t = _by_title(jobs)
    assert set(t) == {"Android Developer", "Data Engineer"}
    a = t["Android Developer"]
    assert a.location == "İstanbul" and a.work_model == "onsite"
    assert a.employment_type == "Full-time"
    assert a.posted_at == "2024-04-25T10:00:00+00:00"
    assert a.url == "https://jobs.lever.co/getir/8d2f6c1e-3b4a-4c55-9e1a-0a1b2c3d4e5f"
    assert a.salary == "90000-120000 TRY per-month-salary"
    assert a.description == "Build our mobile apps from Kadıköy."
    assert t["Data Engineer"].work_model == "remote"
    assert http.calls[0][1].startswith("https://api.eu.lever.co/")


def test_lever_global_host():
    jobs, _ = _run(_src("lever", slug="getir"), {
        "https://api.lever.co/v0/postings/getir?mode=json": "lever_postings.json"})
    assert len(jobs) == 2


# --------------------------------------------------------------------------- workable

WK_V3 = "https://apply.workable.com/api/v3/accounts/insider/jobs"


def test_workable_v3_paginates():
    def route(payload):
        return "workable_v3_page2.json" if payload.get("token") == "eyJvZmZzZXQiOjJ9" else "workable_v3_page1.json"

    jobs, http = _run(_src("workable", slug="insider", company="Insider"), {WK_V3: route})
    assert [c[0] for c in http.calls] == ["POST", "POST"]
    t = _by_title(jobs)
    assert set(t) == {"Product Designer", "QA Engineer"}
    d = t["Product Designer"]
    assert d.url == "https://apply.workable.com/insider/j/A1B2C3D4E5/"
    assert d.external_id == "A1B2C3D4E5"
    assert d.work_model == "hybrid" and d.employment_type == "Full-time"
    assert d.location == "Istanbul, İstanbul, Turkey"
    assert d.posted_at.startswith("2024-06-01T00:00:00")
    assert d.category == "Design"
    assert t["QA Engineer"].work_model == "remote" and t["QA Engineer"].employment_type == "Contract"


def test_workable_respects_max_pages():
    jobs, http = _run(_src("workable", slug="insider"), {WK_V3: "workable_v3_page1.json"}, max_pages=1)
    assert len(http.calls) == 1 and [j.title for j in jobs] == ["Product Designer"]


def test_workable_falls_back_to_v1_widget():
    jobs, http = _run(_src("workable", slug="insider"), {
        WK_V3: HttpError(WK_V3, 404),
        "https://apply.workable.com/api/v1/widget/accounts/insider": "workable_v1_widget.json"})
    assert [j.title for j in jobs] == ["Customer Success Manager"]
    j = jobs[0]
    assert j.url == "https://apply.workable.com/insider/j/C5D6E7F8G9/"
    assert j.posted_at == "2024-06-05" and j.employment_type == "Full-time"


# --------------------------------------------------------------------------- smartrecruiters

def test_smartrecruiters():
    url = "https://api.smartrecruiters.com/v1/companies/Bosch/postings?offset=0&limit=100&country=tr"
    jobs, http = _run(_src("smartrecruiters", slug="Bosch"), {url: "smartrecruiters_postings.json"})
    assert len(http.calls) == 1  # totalFound=2 -> tek sayfa
    assert [j.title for j in jobs] == ["Finans Uzmanı"]
    j = jobs[0]
    assert j.company == "Bosch Group"  # params'ta company yoksa API değeri
    assert j.url == "https://jobs.smartrecruiters.com/Bosch/744000012345678"
    assert j.location == "Istanbul, Istanbul, Türkiye"
    assert j.work_model == "hybrid" and j.employment_type == "Full-time"
    assert j.posted_at.startswith("2024-05-20T09:12:44")
    assert j.category == "Finance"


# --------------------------------------------------------------------------- ashby

def test_ashby():
    jobs, _ = _run(_src("ashby", slug="papara", company="Papara"), {
        "https://api.ashbyhq.com/posting-api/job-board/papara?includeCompensation=true": "ashby_board.json"})
    assert [j.title for j in jobs] == ["Software Engineer, Payments"]  # unlisted + Amsterdam elendi
    j = jobs[0]
    assert j.location == "Istanbul" and j.work_model == "hybrid"
    assert j.employment_type == "Full-time"
    assert j.salary == "₺100K - ₺150K"
    assert j.url == "https://jobs.ashbyhq.com/papara/4c8e2b1a-1111-2222-3333-444455556666"
    assert j.category == "Engineering, Payments"


# --------------------------------------------------------------------------- recruitee

def test_recruitee():
    jobs, _ = _run(_src("recruitee", slug="modanisa"), {
        "https://modanisa.recruitee.com/api/offers/": "recruitee_offers.json"})
    assert [j.title for j in jobs] == ["Frontend Developer"]
    j = jobs[0]
    assert j.company == "Modanisa"
    assert j.url == "https://modanisa.recruitee.com/o/frontend-developer-istanbul"
    assert j.posted_at == "2024-06-10T07:45:12+00:00"
    assert j.work_model == "hybrid" and j.employment_type == "Full-time"
    assert j.description == "React & TypeScript, ofisimiz Ataşehir'de."
    assert j.salary == "70000-95000 TRY month"


# --------------------------------------------------------------------------- teamtailor

def test_teamtailor_rss():
    jobs, _ = _run(_src("teamtailor", slug="trendyol", company="Trendyol"), {
        "https://trendyol.teamtailor.com/jobs.rss?per_page=500": "teamtailor_jobs.rss"})
    t = _by_title(jobs)
    assert set(t) == {"Backend Developer (Go)", "Customer Support Agent"}
    b = t["Backend Developer (Go)"]
    assert b.location == "Istanbul Maslak Office, Istanbul, Turkey"
    assert b.work_model == "hybrid"
    assert b.posted_at == "2024-06-11T09:30:00+03:00"
    assert b.external_id == "6f1d2c3b-aaaa-bbbb-cccc-1234567890ab"
    assert b.url == "https://trendyol.teamtailor.com/jobs/4412233-backend-developer-go"
    assert b.description == "Join us in Maslak , Sarıyer."
    assert b.category == "Engineering, Backend"
    assert t["Customer Support Agent"].work_model == "remote"


def test_teamtailor_custom_host():
    jobs, _ = _run(_src("teamtailor", slug="trendyol", host="kariyer.example.com"), {
        "https://kariyer.example.com/jobs.rss?per_page=500": "teamtailor_jobs.rss"})
    assert len(jobs) == 2


# --------------------------------------------------------------------------- personio

def test_personio_with_com_fallback():
    jobs, http = _run(_src("personio", slug="getir"), {
        "https://getir.jobs.personio.com/xml?language=en": "personio_feed.xml"})
    assert [c[1] for c in http.calls] == ["https://getir.jobs.personio.de/xml?language=en",
                                          "https://getir.jobs.personio.com/xml?language=en"]
    assert [j.title for j in jobs] == ["Financial Analyst"]
    j = jobs[0]
    assert j.url == "https://getir.jobs.personio.com/job/1234567"
    assert j.company == "Getir Perakende Lojistik A.Ş."
    assert j.location == "Istanbul"
    assert j.employment_type == "Full-time, Permanent"
    assert j.posted_at == "2024-06-14T08:12:01+00:00"
    assert "Own monthly reporting for our Beşiktaş office." in j.description
    assert j.category == "Finance, Finance & Accounting"
    assert j.extra == {"seniority": "experienced"}


# --------------------------------------------------------------------------- breezy

def test_breezy():
    jobs, _ = _run(_src("breezy", slug="codeway"), {"https://codeway.breezy.hr/json": "breezy_jobs.json"})
    t = _by_title(jobs)
    assert set(t) == {"iOS Developer", "Community Manager"}
    i = t["iOS Developer"]
    assert i.url == "https://codeway.breezy.hr/p/5d1f2e3a4b5c-ios-developer"
    assert i.company == "Codeway" and i.employment_type == "Full-time"
    assert "Istanbul" in i.location and i.posted_at.startswith("2024-06-20T10:11:12")
    c = t["Community Manager"]
    assert c.work_model == "remote" and c.employment_type == "Part-time"


# --------------------------------------------------------------------------- workday

WD = "https://bigcorp.wd3.myworkdayjobs.com/wday/cxs/bigcorp/External/jobs"


def test_workday_uses_istanbul_location_facet():
    def route(payload):
        if not payload["appliedFacets"]:
            return "workday_facets.json"
        assert payload["appliedFacets"] == {"locations": ["loc-ist-1", "loc-ist-2"]}
        assert payload["limit"] == 20
        return {0: "workday_page1.json", 20: "workday_page2.json"}[payload["offset"]]

    src = _src("workday", company="BigCorp", host="bigcorp.wd3.myworkdayjobs.com", tenant="bigcorp", site="External")
    jobs, http = _run(src, {WD: route})
    assert len(http.calls) == 3  # facet keşfi + 2 sayfa (total=21)
    t = _by_title(jobs)
    assert set(t) == {"Software Engineer", "Supply Chain Analyst", "HR Business Partner"}
    s = t["Software Engineer"]
    assert s.source == "workday:bigcorp"
    assert s.url == "https://bigcorp.wd3.myworkdayjobs.com/External/job/Istanbul/Software-Engineer_R0123456"
    assert s.external_id == "R0123456"
    assert s.location == "Istanbul, Turkey"
    assert s.posted_at is not None and len(s.posted_at) == 10
    assert t["Supply Chain Analyst"].location == "Istanbul, Turkey (2 Locations)"


def test_workday_falls_back_to_search_text():
    seen = []

    def route(payload):
        seen.append(payload)
        if not payload["searchText"]:
            return {"total": 1, "jobPostings": [], "facets": []}
        return "workday_page1.json"

    src = _src("workday", host="bigcorp.wd3.myworkdayjobs.com", tenant="bigcorp", site="External")
    jobs, _ = _run(src, {WD: route}, max_pages=1)
    assert seen[-1]["searchText"] == "Istanbul" and seen[-1]["appliedFacets"] == {}
    assert [j.title for j in jobs] == ["Software Engineer"]  # "2 Locations" yerel süzgeçte elenir


def test_relative_date():
    today = date(2024, 7, 10)
    assert ats._relative_date("Posted Today", today) == "2024-07-10"
    assert ats._relative_date("Posted Yesterday", today) == "2024-07-09"
    assert ats._relative_date("Posted 3 Days Ago", today) == "2024-07-07"
    assert ats._relative_date("Posted 30+ Days Ago", today) == "2024-06-10"
    assert ats._relative_date("3 Gün Önce Yayınlandı", today) == "2024-07-07"
    assert ats._relative_date("", today) is None


# --------------------------------------------------------------------------- oracle

def test_oracle():
    src = _src("oracle", tenant="acme", host="ekxx.fa.em2.oraclecloud.com", site="CX_1")
    url = ("https://ekxx.fa.em2.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions"
           "?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=CX_1,"
           "facetsList=NONE,limit=100,offset=0,sortBy=POSTING_DATES_DESC")
    jobs, _ = _run(src, {url: "oracle_reqs.json"})
    assert [j.title for j in jobs] == ["Treasury Specialist"]
    j = jobs[0]
    assert j.url == "https://ekxx.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/25001234"
    assert j.work_model == "hybrid" and j.posted_at == "2024-06-25"
    assert j.description == "Treasury operations in Şişli."


# --------------------------------------------------------------------------- helpers

def test_iso_formats():
    assert ats._iso(1714039200000) == "2024-04-25T10:00:00+00:00"
    assert ats._iso("2024-06-10 07:45:12 UTC") == "2024-06-10T07:45:12+00:00"
    assert ats._iso("2024-06-01T00:00:00.000Z") == "2024-06-01T00:00:00+00:00"
    assert ats._iso("Tue, 11 Jun 2024 09:30:00 +0300") == "2024-06-11T09:30:00+03:00"
    assert ats._iso("2024-06-25") == "2024-06-25"
    assert ats._iso("") is None and ats._iso(None) is None


def test_work_model_normalization():
    assert ats._work_model("OnSite") == "onsite"
    assert ats._work_model("on_site") == "onsite"
    assert ats._work_model("on-site") == "onsite"
    assert ats._work_model("ORA_HYBRID") == "hybrid"
    assert ats._work_model("Remote") == "remote"
    assert ats._work_model("unspecified") == ""


# --------------------------------------------------------------------------- registry

def test_sources_from_registry_entries():
    srcs = ats.sources(_load("companies_sample.json"))
    names = [s.name for s in srcs]
    assert names == ["greenhouse:peakgames", "lever:getir", "workable:kariyerdanismanlik", "workday:bigcorp"]
    gh = srcs[0]
    assert gh.label == "Peak" and gh.homepage == "https://peak.com/careers"
    assert gh.fetcher is ats.fetch_greenhouse and gh.source_type == COMPANY
    assert srcs[1].params["region"] == "eu"
    assert srcs[2].source_type == AGENCY
    assert srcs[3].fetcher is ats.fetch_workday


def test_sources_uses_registry(monkeypatch):
    from isilan.sources import registry
    monkeypatch.setattr(registry, "load_registry", lambda: _load("companies_sample.json"))
    assert len(ats.sources()) == 4


def test_careerpage_style_delegation_params():
    """careerpage.py adaptörleri yalnızca {company, slug, ats} ile çağırır."""
    src = Source(name="careerpage:peak", source_type=AGENCY, label="Peak", fetcher=ats.fetch_greenhouse,
                 params={"company": "Peak", "slug": "peakgames", "ats": "greenhouse"})
    jobs = list(ats.fetch_greenhouse(src, FetchContext(http=FakeHttp({
        "https://boards-api.greenhouse.io/v1/boards/peakgames/jobs?content=true": "greenhouse_jobs.json"}))))
    assert jobs and all(j.source == "greenhouse:peakgames" and j.source_type == AGENCY for j in jobs)
