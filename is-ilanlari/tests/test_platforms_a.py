"""Platform kaynakları (A grubu): kariyernet, linkedin, indeed, glassdoor, careerjet, jooble.

Ağ kullanılmaz; fixture'lar gerçek sayfa/API yapısını taklit eden test verileridir.
"""
import json
import logging
from datetime import datetime
from urllib.parse import parse_qs, urlparse

import pytest
from conftest import FIXTURES

from isilan.http import HttpError
from isilan.models import PLATFORM
from isilan.sources.base import FetchContext
from isilan.sources.platforms import _util, careerjet, glassdoor, indeed, jooble, kariyernet, linkedin
from isilan.sources.platforms import sources as all_platform_sources
from isilan.sources.platforms._util import abs_url, parse_tr_relative_date

FX = FIXTURES / "platforms"


def read(name):
    return (FX / name).read_text(encoding="utf-8")


class ScriptedHttp:
    """(yöntem, URL parçası) → yanıt eşlemesi. Yanıt bir liste ise sırayla tüketilir;
    istisna örneği ise fırlatılır. Tüm çağrılar kaydedilir."""

    def __init__(self, routes):
        self.routes = routes  # [(method, substring, response)]
        self.calls = []
        self.request_count = 0

    def _resolve(self, method, url, payload=None, **kw):
        self.calls.append({"method": method, "url": url, "payload": payload, "headers": kw.get("headers") or {}})
        for i, (m, sub, resp) in enumerate(self.routes):
            if m == method and sub in url:
                if isinstance(resp, list):
                    if not resp:
                        continue
                    resp = resp.pop(0)
                if isinstance(resp, Exception):
                    raise resp
                return resp
        raise HttpError(url, 404)

    def get(self, url, **kw):
        r = self._resolve("GET", url, **kw)
        return r if isinstance(r, str) else json.dumps(r)

    text = get

    def get_json(self, url, **kw):
        r = self._resolve("GET", url, **kw)
        return json.loads(r) if isinstance(r, str) else r

    def post_json(self, url, payload=None, **kw):
        r = self._resolve("POST", url, payload=payload, **kw)
        return json.loads(r) if isinstance(r, str) else r


def ctx_for(http, max_pages=50):
    return FetchContext(http=http, max_pages=max_pages, log=logging.getLogger("test"))


def src_of(mod, **params):
    s = mod.sources()[0]
    s.params = {**s.params, **params}
    return s


# ----------------------------------------------------------------- _util
NOW = datetime(2026, 10, 16, 12, 0, 0)


@pytest.mark.parametrize("text,expected", [
    ("Bugün", "2026-10-16"),
    ("bugün yayınlandı", "2026-10-16"),
    ("Dün", "2026-10-15"),
    ("3 gün önce", "2026-10-13"),
    ("3 gün", "2026-10-13"),
    ("1 hafta önce", "2026-10-09"),
    ("2 hafta önce", "2026-10-02"),
    ("1 ay önce", "2026-09-16"),
    ("30+ gün önce", "2026-09-16"),
    ("2 saat önce", "2026-10-16T10:00:00"),
    ("45 dakika önce", "2026-10-16T11:15:00"),
    ("Az önce", "2026-10-16"),
    ("Just posted", "2026-10-16"),
    ("3 days ago", "2026-10-13"),
    ("3d", "2026-10-13"),
    ("24h", "2026-10-15T12:00:00"),
    ("12.10.2026", "2026-10-12"),
    ("12 Ekim 2026", "2026-10-12"),
    ("2026-10-01", "2026-10-01"),
    ("2026-10-01T10:00:00Z", "2026-10-01T10:00:00"),
    ("", None),
    (None, None),
    ("Data Warehouse Uzmanı", None),
    ("İstanbul", None),
])
def test_parse_tr_relative_date(text, expected):
    assert parse_tr_relative_date(text, NOW) == expected


def test_abs_url():
    assert abs_url("https://www.kariyer.net/is-ilanlari/istanbul", "/is-ilani/a-1") == "https://www.kariyer.net/is-ilani/a-1"
    assert abs_url("https://x.com/a/", "//img.cdn.com/x.png") == "https://img.cdn.com/x.png"
    assert abs_url("https://x.com/a/", "b?c=1") == "https://x.com/a/b?c=1"
    assert abs_url("https://x.com", None) == ""


def test_parse_html_and_js_object():
    root = _util.parse_html('<div class="a b" data-x="1"><p>Merhaba <b>dünya</b></p><img src=x><span>son</span></div>')
    d = root.find("div", cls="b")
    assert d.get("data-x") == "1"
    assert d.find("p").text() == "Merhaba dünya"
    assert d.find("span").text() == "son"
    s = 'x = {"a": "}{\\"", "b": [1, {"c": 2}]}; y = 1'
    assert json.loads(_util.extract_js_object(s, s.index("{"))) == {"a": '}{"', "b": [1, {"c": 2}]}


def test_package_sources_aggregates_and_tolerates_missing_modules():
    names = [s.name for s in all_platform_sources()]
    for n in ("kariyernet", "linkedin", "indeed", "glassdoor", "careerjet", "jooble"):
        assert n in names
    assert len(names) == len(set(names))
    for s in all_platform_sources():
        assert s.source_type == PLATFORM


# ----------------------------------------------------------------- LinkedIn
def test_linkedin_parse_cards():
    jobs = linkedin.parse_cards(read("linkedin_page1.html"))
    assert [j.external_id for j in jobs] == ["4447264118", "4450000001"]  # tekrar eden urn atlandı
    a, b = jobs
    assert a.title == "Software Developer"
    assert a.company == "Örnek Teknoloji A.Ş."
    assert a.location == "Kadıköy, İstanbul, Türkiye"
    assert a.posted_at == "2026-10-13"
    assert a.url == "https://www.linkedin.com/jobs/view/4447264118/"
    assert a.extra["company_url"] == "https://tr.linkedin.com/company/ornek-teknoloji"
    assert a.source == "linkedin" and a.source_type == PLATFORM
    assert b.work_model == "hybrid"
    assert b.salary.startswith("₺80.000")
    assert b.posted_at == "2026-10-16"


def test_linkedin_fetch_paginates_until_empty(monkeypatch):
    http = ScriptedHttp([
        ("GET", "start=0", read("linkedin_page1.html")),
        ("GET", "start=3", read("linkedin_page2.html")),  # 3 kart döndü → start 3 ilerler
        ("GET", "start=4", read("linkedin_empty.html")),
    ])
    jobs = list(linkedin.fetch(src_of(linkedin, delay=0), ctx_for(http)))
    assert [j.external_id for j in jobs] == ["4447264118", "4450000001", "4451111111"]
    assert jobs[2].posted_at is not None  # "1 hafta önce" → tarih
    q = parse_qs(urlparse(http.calls[0]["url"]).query)
    assert q["geoId"] == ["90010422"]
    assert q["f_TPR"] == ["r2592000"]
    assert q["start"] == ["0"]
    assert len(http.calls) == 3


def test_linkedin_respects_max_pages_and_stops_on_429():
    http = ScriptedHttp([("GET", "start=0", read("linkedin_page1.html"))])
    assert len(list(linkedin.fetch(src_of(linkedin, delay=0), ctx_for(http, max_pages=1)))) == 2
    assert len(http.calls) == 1
    http = ScriptedHttp([
        ("GET", "start=0", read("linkedin_page1.html")),
        ("GET", "start=3", HttpError("u", 429)),
    ])
    assert len(list(linkedin.fetch(src_of(linkedin, delay=0), ctx_for(http)))) == 2
    with pytest.raises(HttpError):  # ilk sayfa hatası yukarı iletilir
        list(linkedin.fetch(src_of(linkedin, delay=0), ctx_for(ScriptedHttp([("GET", "start=0", HttpError("u", 429))]))))


# ----------------------------------------------------------------- Kariyer.net
def test_kariyernet_parse_cards():
    jobs = kariyernet.parse_cards(read("kariyernet_page1.html"))
    assert [j.external_id for j in jobs] == ["4522282", "4522300", "4522400"]
    a, b, c = jobs
    assert a.title == "Backend Developer"
    assert a.company == "Örnek Yazılım A.Ş."
    assert a.url == "https://www.kariyer.net/is-ilani/ornek-yazilim-backend-developer-4522282"
    assert a.location == "Kadıköy, İstanbul(Asya)"
    assert a.extra["district_raw"] == "Kadıköy"
    assert a.extra["side"] == "Anadolu"
    assert a.employment_type == "Tam zamanlı"
    assert a.work_model == "hybrid"
    assert a.category == "Bilişim"
    assert a.posted_at is not None
    assert b.location == "İstanbul(Avr.)" and b.extra["side"] == "Avrupa"
    assert "district_raw" not in b.extra
    assert b.work_model == "onsite" and b.employment_type == "Yarı zamanlı"
    assert c.url.endswith("-4522400")  # sorgu dizesi atıldı
    assert c.extra.get("multi_city") is True and c.work_model == "remote"


def test_kariyernet_fetch_pages_and_dedupe():
    http = ScriptedHttp([
        ("GET", "istanbul?cp=2", read("kariyernet_page2.html")),
        ("GET", "istanbul?cp=3", read("kariyernet_page2.html")),  # tekrar → dur
        ("GET", "is-ilanlari/istanbul", read("kariyernet_page1.html")),
    ])
    jobs = list(kariyernet.fetch(src_of(kariyernet, delay_min=0, delay_max=0, break_every=0), ctx_for(http)))
    assert len(jobs) == 4
    assert jobs[-1].location == "Tuzla, İstanbul(Asya)"
    assert [c["url"] for c in http.calls] == [
        "https://www.kariyer.net/is-ilanlari/istanbul",
        "https://www.kariyer.net/is-ilanlari/istanbul?cp=2",
        "https://www.kariyer.net/is-ilanlari/istanbul?cp=3",
    ]


def test_kariyernet_block_page_raises():
    http = ScriptedHttp([("GET", "kariyer.net", read("kariyernet_block.html"))])
    with pytest.raises(RuntimeError, match="PerimeterX"):
        list(kariyernet.fetch(src_of(kariyernet), ctx_for(http)))


# ----------------------------------------------------------------- Indeed
def test_indeed_graphql_paging_and_mapping():
    http = ScriptedHttp([("POST", "apis.indeed.com/graphql",
                          [json.loads(read("indeed_graphql_p1.json")), json.loads(read("indeed_graphql_p2.json"))])])
    jobs = list(indeed.fetch(src_of(indeed), ctx_for(http)))
    assert [j.external_id for j in jobs] == ["a1b2c3d4e5f60718", "ffee00112233aabb", "0000aaaa1111bbbb"]
    a, b, c = jobs
    assert a.title == "Muhasebe Uzmanı" and a.company == "Deneme Holding A.Ş."
    assert a.url == "https://tr.indeed.com/viewjob?jk=a1b2c3d4e5f60718"
    assert a.location == "Ataşehir, 34"
    assert a.posted_at == "2025-10-16"
    assert a.work_model == "hybrid" and a.employment_type == "Tam zamanlı"
    assert a.salary == "40.000-55.000 TRY aylık"
    assert a.description == "Ön muhasebe & ETA bilgisi"
    assert b.company == "Hızlı Teslimat" and b.extra["apply_url"].startswith("https://hizli.example")
    assert c.work_model == "remote" and c.salary == "900.000 TRY yıllık"
    # istek gövdesi ve başlıklar
    first, second = http.calls
    assert first["headers"]["indeed-co"] == "TR" and first["headers"]["indeed-api-key"]
    assert 'where: "İstanbul"' in first["payload"]["query"]
    assert "cursor" not in first["payload"]["query"].split("limit")[1].split("sort")[0]
    assert 'cursor: "CURSOR_2"' in second["payload"]["query"]
    assert 'start: "720h"' in first["payload"]["query"]


def test_indeed_falls_back_to_html_when_api_blocked():
    http = ScriptedHttp([
        ("POST", "apis.indeed.com", HttpError("https://apis.indeed.com/graphql", 403)),
        ("GET", "start=10", read("indeed_mosaic.html")),  # aynı sayfa tekrar → dur
        ("GET", "tr.indeed.com/jobs", read("indeed_mosaic.html")),
    ])
    jobs = list(indeed.fetch(src_of(indeed), ctx_for(http)))
    assert [j.external_id for j in jobs] == ["9f8e7d6c5b4a3921", "1234abcd5678ef90"]
    a, b = jobs
    assert a.title == "Satış Temsilcisi" and a.company == "Örnek Gıda"
    assert a.location == "Ümraniye, İstanbul"
    assert a.posted_at == "2025-10-15"
    assert a.salary == "35.000 TL - 45.000 TL (Aylık)"
    assert a.employment_type == "Tam zamanlı"
    assert "tercih" in a.description
    assert b.posted_at is not None  # "Bugün"
    q = parse_qs(urlparse(http.calls[1]["url"]).query)
    assert q["l"] == ["İstanbul"]


# ----------------------------------------------------------------- Glassdoor
def test_glassdoor_graphql():
    http = ScriptedHttp([
        ("GET", "autocomplete/location", read("glassdoor_autocomplete.json")),
        ("POST", "glassdoor.com/graph", [json.loads(read("glassdoor_graph_p1.json")),
                                         json.loads(read("glassdoor_graph_p2.json"))]),
    ])
    jobs = list(glassdoor.fetch(src_of(glassdoor), ctx_for(http)))
    assert [j.external_id for j in jobs] == ["1009876543210", "1009876543211", "1009876543299"]
    a, b, _ = jobs
    assert a.title == "Product Manager" and a.company == "Örnek Fintech"
    assert a.location == "Istanbul, Turkey"
    assert a.url == "https://www.glassdoor.com/job-listing/j?jl=1009876543210"
    assert a.salary.startswith("60000-90000 TRY")
    assert a.employment_type == "fulltime"
    assert a.posted_at
    assert b.work_model == "remote"
    p1 = http.calls[1]["payload"][0]
    assert p1["operationName"] == "JobSearchResultsQuery"
    assert p1["variables"]["locationId"] == 2988 and p1["variables"]["locationType"] == "CITY"
    assert http.calls[2]["payload"][0]["variables"]["pageCursor"] == "AB:CD:2"
    assert glassdoor.sources()[0].needs_browser is True


def test_glassdoor_html_fallback():
    http = ScriptedHttp([
        ("GET", "autocomplete/location", read("glassdoor_autocomplete.json")),
        ("POST", "/graph", HttpError("graph", 403)),
        ("GET", "_IP2.htm", read("glassdoor_search.html")),  # aynı ilanlar → dur
        ("GET", "SRCH_IL.0,15_IC2988.htm", read("glassdoor_search.html")),
    ])
    jobs = list(glassdoor.fetch(src_of(glassdoor), ctx_for(http)))
    assert [(j.external_id, j.title, j.company) for j in jobs] == [("1009876543500", "Frontend Developer", "Örnek Web")]
    cards = glassdoor.parse_search_html(read("glassdoor_cards.html"))
    assert cards[0].external_id == "1009876543600" and cards[0].company == "Kart Şirketi"
    assert cards[0].title == "Backend Engineer" and cards[0].location == "İstanbul" and cards[0].posted_at


# ----------------------------------------------------------------- Careerjet
def test_careerjet_api(monkeypatch):
    monkeypatch.setenv("CAREERJET_API_KEY", "testkey")
    monkeypatch.setenv("CAREERJET_USER_IP", "203.0.113.5")
    http = ScriptedHttp([("GET", "search.api.careerjet.net/v4/query", read("careerjet_api.json"))])
    jobs = list(careerjet.fetch(src_of(careerjet), ctx_for(http)))
    assert len(jobs) == 2
    a, b = jobs
    assert a.title == "İnsan Kaynakları Uzmanı" and a.company == "Örnek Danışmanlık"
    assert a.location == "Şişli, İstanbul"
    assert a.posted_at == "2026-10-14"
    assert a.salary == "45000-60000 TRY"
    assert a.external_id == "https://jobviewtrack.com/tr-tr/job-1a2b3c/abc"
    assert b.salary == "30.000 TL" and b.posted_at == "2026-10-09"
    call = http.calls[0]
    q = parse_qs(urlparse(call["url"]).query)
    assert q["locale_code"] == ["tr_TR"] and q["location"] == ["İstanbul"] and q["user_ip"] == ["203.0.113.5"]
    assert q["page"] == ["1"] and "user_agent" in q
    assert call["headers"]["Authorization"] == "Basic dGVzdGtleTo="  # base64("testkey:")


def test_careerjet_api_ambiguous_location(monkeypatch):
    monkeypatch.setenv("CAREERJET_AFFID", "eskianahtar")
    monkeypatch.delenv("CAREERJET_API_KEY", raising=False)
    monkeypatch.setenv("CAREERJET_USER_IP", "203.0.113.5")
    http = ScriptedHttp([("GET", "careerjet.net/v4/query", read("careerjet_locations.json"))])
    with pytest.raises(RuntimeError, match="konum"):
        list(careerjet.fetch(src_of(careerjet), ctx_for(http)))


def test_careerjet_html(monkeypatch):
    monkeypatch.setenv("CAREERJET_HTML", "1")
    monkeypatch.delenv("CAREERJET_API_KEY", raising=False)
    monkeypatch.delenv("CAREERJET_AFFID", raising=False)
    http = ScriptedHttp([
        ("GET", "p=2", read("careerjet_search.html")),  # tekrar → dur
        ("GET", "/arama/is-ilanlari", read("careerjet_search.html")),
    ])
    jobs = list(careerjet.fetch(src_of(careerjet), ctx_for(http)))
    assert [j.external_id for j in jobs] == ["tr4b1c0c6f0e9d8a7b6c5d4e3f2a1b0c9d", "tr99887766554433221100aabbccddeeff"]
    a, b = jobs
    assert a.title == "Grafik Tasarımcı" and a.company == "Örnek Ajans"
    assert a.url == "https://www.careerjet.com.tr/jobad/tr4b1c0c6f0e9d8a7b6c5d4e3f2a1b0c9d"
    assert a.location == "Beyoğlu, İstanbul"
    assert a.salary == "25.000 TL - 35.000 TL aylık"
    assert a.description == "Adobe ürünlerine hakim & yaratıcı..."
    assert a.posted_at is not None
    assert b.company == "Lezzet Restoran" and b.posted_at is not None
    q = parse_qs(urlparse(http.calls[0]["url"]).query)
    assert q["l"] == ["İstanbul"]


def test_careerjet_html_tries_alternative_paths(monkeypatch):
    monkeypatch.setenv("CAREERJET_HTML", "1")
    monkeypatch.delenv("CAREERJET_API_KEY", raising=False)
    monkeypatch.delenv("CAREERJET_AFFID", raising=False)
    http = ScriptedHttp([
        ("GET", "/arama/is-ilanlari", HttpError("x", 404)),
        ("GET", "/arama/ilanlar", read("careerjet_search.html")),
    ])
    jobs = list(careerjet.fetch(src_of(careerjet), ctx_for(http, max_pages=1)))
    assert len(jobs) == 2


# ----------------------------------------------------------------- Jooble
def test_jooble_without_key_is_skipped(monkeypatch, caplog):
    monkeypatch.delenv("JOOBLE_API_KEY", raising=False)
    http = ScriptedHttp([])
    with caplog.at_level(logging.WARNING):
        assert list(jooble.fetch(src_of(jooble), ctx_for(http))) == []
    assert http.calls == []
    assert "JOOBLE_API_KEY" in caplog.text


def test_jooble_api(monkeypatch):
    monkeypatch.setenv("JOOBLE_API_KEY", "k123")
    monkeypatch.delenv("JOOBLE_HOST", raising=False)
    http = ScriptedHttp([("POST", "tr.jooble.org/api/k123",
                          [json.loads(read("jooble_p1.json")), json.loads(read("jooble_p2.json"))])])
    jobs = list(jooble.fetch(src_of(jooble), ctx_for(http)))
    assert [j.external_id for j in jobs] == ["-1234567890123456789", "987654321", "555"]
    a, b, c = jobs
    assert a.title == "Lojistik Planlama Uzmanı" and a.company == "Mavi Lojistik"
    assert a.location == "Pendik, İstanbul" and a.posted_at == "2026-10-12"
    assert "SAP bilgisi" in a.description and "<b>" not in a.description
    assert a.extra["via"] == "kariyer.net"
    assert b.work_model == "remote" and b.salary == "28.000 TL"
    assert http.calls[0]["payload"] == {"keywords": "", "location": "İstanbul", "page": 1, "ResultOnPage": 50}
    assert http.calls[1]["payload"]["page"] == 2
    assert len(http.calls) == 2  # totalCount'a ulaşınca durdu


def test_linkedin_splits_by_district_when_capped(monkeypatch):
    # İstanbul geneli sınıra takılırsa (max_results) ilçe aramalarına geçer
    http = ScriptedHttp([
        ("GET", "geoId=90010422", read("linkedin_page1.html")),
        ("GET", "location=Adalar", read("linkedin_page2.html")),
        ("GET", "location=", read("linkedin_empty.html")),
    ])
    jobs = list(linkedin.fetch(src_of(linkedin, delay=0, max_results=1), ctx_for(http)))
    ids = [j.external_id for j in jobs]
    assert len(ids) == len(set(ids))                          # tekrar yok
    assert set(ids) >= {"4447264118", "4450000001", "4451111111"}
    district_calls = [c["url"] for c in http.calls if "geoId" not in c["url"]]
    assert len(district_calls) >= 39                          # her ilçe için en az bir arama


def test_careerjet_skipped_without_key(monkeypatch):
    for k in ("CAREERJET_API_KEY", "CAREERJET_AFFID", "CAREERJET_HTML"):
        monkeypatch.delenv(k, raising=False)
    http = ScriptedHttp([])
    assert list(careerjet.fetch(src_of(careerjet), ctx_for(http))) == []
    assert http.calls == []
