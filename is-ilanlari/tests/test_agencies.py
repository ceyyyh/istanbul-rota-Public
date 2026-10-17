"""isilan.sources.agencies testleri (ağ yok; sahte http + fikstürler)."""
from __future__ import annotations

import pathlib

import pytest

from isilan import geo
from isilan.http import HttpError
from isilan.models import AGENCY
from isilan.sources import agencies
from isilan.sources.base import FetchContext, Source
from isilan.text import fold

FIX = pathlib.Path(__file__).parent / "fixtures" / "agencies"


def fx(name: str) -> str:
    return (FIX / name).read_text(encoding="utf-8")


class FakeHttp:
    def __init__(self, pages: dict[str, str]):
        self.pages = pages
        self.calls: list[str] = []

    def get(self, url: str, **kw) -> str:
        self.calls.append(url)
        if url not in self.pages:
            raise HttpError(url, 404)
        return self.pages[url]


@pytest.fixture(autouse=True)
def fake_istanbul(monkeypatch):
    monkeypatch.setattr(geo, "is_istanbul", lambda t: "istanbul" in fold(t))


def src_by_name(name: str) -> Source:
    return next(s for s in agencies.sources() if s.name == name)


def run(src: Source, pages: dict[str, str], **ctx_kw):
    http = FakeHttp(pages)
    jobs = list(src.fetch(FetchContext(http=http, **ctx_kw)))
    return jobs, http


RS = "https://www.randstad.com.tr"
RANDSTAD_PAGES = {
    f"{RS}/is-ilanlari/istanbul-europe/": fx("randstad_list_p1.html"),
    f"{RS}/is-ilanlari/istanbul-europe/page-2/": fx("randstad_list_p2.html"),
    f"{RS}/is-ilanlari/istanbul-asia/": fx("randstad_list_asia.html"),
    f"{RS}/is-ilanlari/marketing-specialist_sisliistanbul_46129455/": fx("randstad_job_46129455.html"),
    f"{RS}/is-ilanlari/dis-ticaret-operasyon-uzmani_istanbul_46200001/": fx("randstad_job_46200001.html"),
    f"{RS}/is-ilanlari/uretim-muhendisi_gebze_46200002/": fx("randstad_job_46200002.html"),
}


def test_sources_are_agencies():
    srcs = agencies.sources()
    assert len(srcs) >= 5
    assert len({s.name for s in srcs}) == len(srcs)
    for s in srcs:
        assert s.source_type == AGENCY and s.name.startswith("agency:")
        assert s.params.get("link_pattern")


def test_randstad_pagination_jsonld_and_istanbul_filter():
    jobs, http = run(src_by_name("agency:randstad"), RANDSTAD_PAGES)
    by_id = {j.external_id: j for j in jobs}
    assert set(by_id) == {"46129455", "46200001"}  # Gebze/Kocaeli ilanı elendi
    j = by_id["46129455"]
    assert j.title == "Marketing Specialist"
    assert j.company == "Randstad Türkiye"
    assert j.location == "Şişli, İstanbul"
    assert j.posted_at == "2025-11-25"
    assert j.url == f"{RS}/is-ilanlari/marketing-specialist_sisliistanbul_46129455/"
    assert j.extra == {"validThrough": "2026-02-28", "agency": "Randstad Türkiye"}
    assert "iş ortağımız" in j.description
    # hiringOrganization yok -> ajans adı
    assert by_id["46200001"].company == "Randstad Türkiye"
    # kategori bağlantısı (s-pazarlama) ziyaret edilmedi; tekrar eden ilan bir kez çekildi
    assert not any("s-pazarlama" in c for c in http.calls)
    assert http.calls.count(f"{RS}/is-ilanlari/marketing-specialist_sisliistanbul_46129455/") == 1
    # 2. sayfadan sonra 3. sayfa 404 -> o liste için durur, Asya listesine geçer
    assert f"{RS}/is-ilanlari/istanbul-europe/page-3/" in http.calls
    assert f"{RS}/is-ilanlari/istanbul-asia/" in http.calls


def test_first_list_page_error_raises():
    with pytest.raises(HttpError):
        run(src_by_name("agency:randstad"), {})


def test_max_jobs_and_deadline_bound():
    src = src_by_name("agency:randstad")
    src.params["max_jobs"] = 1
    jobs, http = run(src, RANDSTAD_PAGES)
    assert len(jobs) == 1
    assert sum("_4" in c for c in http.calls) == 1

    src = src_by_name("agency:randstad")
    jobs, http = run(src, RANDSTAD_PAGES, deadline=1)  # geçmişte kalan son zaman
    assert jobs == [] and http.calls == []


MP = "https://www.michaelpage.com.tr"


def test_michaelpage_dedupes_by_jn_reference():
    pages = {
        f"{MP}/jobs/istanbul": fx("michaelpage_list.html"),
        f"{MP}/jobs/istanbul?page=1": fx("michaelpage_list.html"),  # yeni bağlantı yok -> dur
        f"{MP}/job-detail/finance-manager/ref/jn-022025-6670328": fx("michaelpage_job_6670328.html"),
        f"{MP}/en/job-detail/muhasebe-m%C3%BCd%C3%BCr%C3%BC/ref/jn-062024-6454909": fx("michaelpage_job_6454909.html"),
    }
    jobs, http = run(src_by_name("agency:michaelpage"), pages)
    assert sorted(j.external_id for j in jobs) == ["jn-022025-6670328", "jn-062024-6454909"]
    fm = next(j for j in jobs if j.external_id == "jn-022025-6670328")
    assert fm.company == "Michael Page Türkiye" and fm.extra["agency"] == "Michael Page Türkiye"
    assert fm.location == "Istanbul (Europe)" and fm.employment_type == "Permanent"
    assert fm.posted_at.startswith("2025-02-24")
    assert next(j for j in jobs if j.external_id == "jn-062024-6454909").company == "Michael Page"
    assert not any("lang=tr" in c for c in http.calls)
    assert f"{MP}/jobs/istanbul?page=2" not in http.calls


GG = "https://tr.gigroup.com"


def test_gigroup_jobid_and_html_fallback():
    pages = {
        f"{GG}/pozisyonlar/marmara-re/istanbul-pr/": fx("gigroup_list.html"),
        f"{GG}/is-ilanlari/sisli-istanbul-sigorta-saha-satis-temsilcisi/?jobid=24589": fx("gigroup_job_24589.html"),
        f"{GG}/is-ilanlari/atasehir-istanbul-satin-alma-uzmani/?jobid=30001": fx("gigroup_job_30001.html"),
    }
    jobs, _ = run(src_by_name("agency:gigroup"), pages)
    by_id = {j.external_id: j for j in jobs}
    assert set(by_id) == {"24589", "30001"}
    s = by_id["24589"]
    assert s.salary == "40000-60000 TRY MONTH" and s.company == "Gi Group Türkiye"
    f = by_id["30001"]  # JSON-LD yok -> h1 + "Lokasyon" alanı
    assert f.title == "Satın alma Uzmanı"
    assert f.location == "Ataşehir, İstanbul"
    assert f.description == "Gıda sektöründe geçici pozisyon."
    assert f.extra == {"agency": "Gi Group Türkiye"}


def test_html_fallback_without_location_is_skipped():
    src = Source("agency:t", AGENCY, "T Ajans", agencies.fetch_listing_jsonld, params={
        "list_url": "https://t.example/ilanlar", "link_pattern": r"/ilan/\d+"})
    pages = {"https://t.example/ilanlar": '<a href="/ilan/1">x</a>',
             "https://t.example/ilan/1": "<html><h1>Başlık</h1><p>İstanbul merkezli şirket</p></html>"}
    jobs, _ = run(src, pages)
    assert jobs == []  # etiketli konum yok -> uydurma yok


def test_list_location_used_when_site_filtered_by_istanbul():
    src = Source("agency:t", AGENCY, "T Ajans", agencies.fetch_listing_jsonld, params={
        "lists": [("https://t.example/istanbul", "İstanbul")], "link_pattern": r"/ilan/\d+"})
    pages = {"https://t.example/istanbul": '<a href="/ilan/7">x</a>',
             "https://t.example/ilan/7": '<script type="application/ld+json">{"@type":"JobPosting","title":"Kurye"}</script>'}
    jobs, _ = run(src, pages)
    assert [(j.title, j.location, j.company) for j in jobs] == [("Kurye", "İstanbul", "T Ajans")]


def test_inline_jobpostings_on_listing_page_skip_detail_fetch():
    src = src_by_name("agency:adecco")
    pages = {"https://www.adecco.com/tr-tr/is-bul": fx("inline_list.html")}
    jobs, http = run(src, pages)
    assert [(j.external_id, j.company, j.url) for j in jobs] == [(
        "jn-032026-992700", "Adecco",
        "https://www.adecco.com/tr-tr/is-bul/depo-operatr--stanbul-/jn-032026-992700")]
    assert jobs[0].extra["agency"] == "Adecco Türkiye"
    assert http.calls == ["https://www.adecco.com/tr-tr/is-bul"]  # detaylar zaten listede


def test_geo_not_implemented_fallback(monkeypatch):
    def boom(_):
        raise NotImplementedError
    monkeypatch.setattr(geo, "is_istanbul", boom)
    assert agencies._is_istanbul("Kadıköy, İSTANBUL")
    assert not agencies._is_istanbul("Gebze, Kocaeli")


def test_page_url_styles():
    p = {"page_style": "query", "page_param": "page", "page_base": 0}
    assert agencies._page_url("https://x/jobs/istanbul", 1, p) == "https://x/jobs/istanbul"
    assert agencies._page_url("https://x/jobs/istanbul", 3, p) == "https://x/jobs/istanbul?page=2"
    assert agencies._page_url("https://x/a?q=1", 2, {"page_style": "query"}) == "https://x/a?q=1&page=2"
    assert agencies._page_url("https://x/a/", 2, {"page_style": "path", "page_fmt": "page-{n}/"}) == "https://x/a/page-2/"
    assert agencies._page_url("https://x/a/", 2, {}) is None
