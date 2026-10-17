"""Platform modülleri (yenibiris, secretcv, eleman.net, isbul, isinolsun, youthall,
techcareer, iskur, toptalent, coderspace) için ağsız testler.

Fikstürler (tests/fixtures/platforms_b) sitelerin araştırılmış HTML/JSON yapısını taklit
eden test verisidir; gerçek ilan değildir."""
from __future__ import annotations

import json
import logging
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import unquote

import pytest

from isilan.http import HttpError
from isilan.models import PLATFORM
from isilan.sources.base import FetchContext
from isilan.sources.platforms import (coderspace, elemannet, isbul, isinolsun, iskur, secretcv,
                                      techcareer, toptalent, youthall, yenibiris)
from isilan.sources.platforms._cards import parse_html

FX = Path(__file__).parent / "fixtures" / "platforms_b"


def fx(name: str) -> str:
    return (FX / name).read_text(encoding="utf-8")


class Fake:
    """GET/POST yollarını tam URL ile eşleyen sahte Http. Değer str, dict veya
    çağrılabilir (method, url, kw) -> str olabilir; bulunamayan URL 404 fırlatır."""

    def __init__(self, routes: dict):
        self.routes = routes
        self.calls: list[tuple[str, str, dict]] = []
        self.request_count = 0

    def text(self, url, method="GET", **kw):
        self.calls.append((method, url, kw))
        key = (method, url) if (method, url) in self.routes else url
        if key not in self.routes:
            raise HttpError(url, 404)
        v = self.routes[key]
        if callable(v):
            v = v(method, url, kw)
        if isinstance(v, Exception):
            raise v
        return v if isinstance(v, str) else json.dumps(v)

    def get(self, url, **kw):
        return self.text(url, "GET", **kw)

    def get_json(self, url, **kw):
        return json.loads(self.text(url, "GET", **kw))

    def post_json(self, url, payload=None, **kw):
        return json.loads(self.text(url, "POST", json=payload, **kw))


def ctx_for(routes, **kw) -> tuple[FetchContext, Fake]:
    http = Fake(routes)
    return FetchContext(http=http, log=logging.getLogger("test"), **kw), http


def run(mod, routes, **kw):
    src = mod.sources()[0]
    ctx, http = ctx_for(routes, **kw)
    return list(src.fetch(ctx)), http, src


TODAY = date.today()


# --- mini DOM --------------------------------------------------------------------

def test_dom_basics():
    root = parse_html('<div class="a b"><p>x<br>y</p><img src=i><span title="t">z</span></div><p>stray</i>')
    d = root.find("div", "a")
    assert d is not None and d.has_class("a", "b")
    assert d.find("p").lines() == ["x", "y"]
    assert d.find("span", title=True).get("title") == "t"
    assert root.find_all("p")[1].text() == "stray"


# --- yenibiris ------------------------------------------------------------------

def test_yenibiris_parse_and_paginate():
    routes = {
        "https://www.yenibiris.com/is-ilanlari/istanbul": fx("yenibiris_list.html"),
        "https://www.yenibiris.com/is-ilanlari/istanbul?sayfa=2": fx("yenibiris_list.html"),  # tekrar → dur
    }
    jobs, http, src = run(yenibiris, routes)
    assert src.name == "yenibiris" and src.source_type == PLATFORM
    assert [j.external_id for j in jobs] == ["1734567", "1734999"]
    j = jobs[0]
    assert j.title == "Gündüz Vardiya Garson"
    assert j.company == "Örnek Lokanta Gıda A.Ş."
    assert j.location == "İstanbul / Kadıköy"
    assert j.url == "https://www.yenibiris.com/is-ilani/gunduz-vardiya-garson/1734567"
    assert j.posted_at == (TODAY - timedelta(days=3)).isoformat()
    assert jobs[1].location == "İstanbul / Şişli" and jobs[1].posted_at == TODAY.isoformat()
    assert len(http.calls) == 2  # 2. sayfa yeni ilan getirmedi


def test_yenibiris_respects_max_pages():
    routes = {"https://www.yenibiris.com/is-ilanlari/istanbul": fx("yenibiris_list.html")}
    jobs, http, _ = run(yenibiris, routes, max_pages=1)
    assert len(jobs) == 2 and len(http.calls) == 1


def test_yenibiris_first_page_error_propagates():
    with pytest.raises(HttpError):
        run(yenibiris, {})


# --- secretcv ------------------------------------------------------------------

def test_secretcv_parse():
    jobs = secretcv.parse_list(fx("secretcv_list.html"))
    assert [j.external_id for j in jobs] == ["2468101", "2468102"]
    assert jobs[0].title == "Yazılım Geliştirme Uzmanı"
    assert jobs[0].company == "Örnek Teknoloji A.Ş."
    assert jobs[0].location == "İstanbul (Avr.)"
    assert jobs[0].posted_at == (TODAY - timedelta(days=2)).isoformat()
    assert jobs[1].location == "İstanbul (Asya)" and jobs[1].posted_at is None


def test_secretcv_falls_back_to_district_lists_when_paging_refused():
    base = "https://www.secretcv.com/is-ilanlari/"
    routes = {
        base + "istanbul-is-ilanlari/": fx("secretcv_list.html"),
        base + "istanbul-is-ilanlari/?sf=2": HttpError(base + "?sf=2", 410),
        base + "kadikoy-is-ilanlari": fx("secretcv_district.html"),
    }
    jobs, http, _ = run(secretcv, routes, max_pages=4)
    assert [j.external_id for j in jobs] == ["2468101", "2468102", "2468200"]
    assert jobs[-1].location == "İstanbul (Asya) - Kadıköy"
    assert len(http.calls) == 4  # bütçe (max_pages=4) başarısız istekleri de sayar


# --- eleman.net ----------------------------------------------------------------

def test_elemannet_parse_pager_and_detail():
    base = "https://www.eleman.net/is-ilanlari/istanbul"
    routes = {
        base: fx("elemannet_list.html"),
        base + "?sy=2": fx("elemannet_list2.html"),
        "https://www.eleman.net/is-ilani/forklift-operatoru-i3456789": fx("elemannet_detail.html"),
    }
    jobs, http, _ = run(elemannet, routes, fetch_details=True)
    assert [j.external_id for j in jobs] == ["3456789", "3456790", "3456791"]
    f = jobs[0]
    assert f.title == "Forklift Operatörü"  # rozet metni başlığa karışmaz
    assert f.company == "Örnek Depoculuk Ltd. Şti."
    assert f.extra.get("highlighted") and f.extra.get("urgent")
    # detay JSON-LD'den zenginleştirildi
    assert f.posted_at == "2026-10-14" and f.employment_type == "FULL_TIME"
    assert f.location == "İstanbul - Tuzla"  # kart konumu JSON-LD'ninkinden daha az ayrıntılı değil
    assert f.extra.get("validThrough") == "2026-11-13"
    assert jobs[1].location == "İstanbul - Esenyurt" and jobs[1].posted_at is None
    assert jobs[2].location == "İstanbul - Kadıköy"
    # pager "2 / 2" → 3. sayfa istenmez
    assert not any("sy=3" in u for _, u, _ in http.calls)


# --- isbul ---------------------------------------------------------------------

def test_isbul_parse():
    jobs = isbul.parse_list(fx("isbul_list.html"))
    assert len(jobs) == 2  # görsel bağlantısı aynı ilan → tekrar yok
    j = jobs[0]
    assert j.external_id == "satis-danismani-ornek-magazacilik-istanbul-a1b2c3d4e5f6"
    assert j.url == "https://www.isbul.net/is-ilani/satis-danismani-ornek-magazacilik-istanbul-a1b2c3d4e5f6"
    assert (j.title, j.company, j.location) == ("Satış Danışmanı", "Örnek Mağazacılık A.Ş.", "İstanbul / Bakırköy")
    assert j.employment_type == "Tam Zamanlı" and j.work_model == "onsite"
    assert j.posted_at == (TODAY - timedelta(days=2)).isoformat()
    assert jobs[1].work_model == "hybrid" and jobs[1].posted_at == TODAY.isoformat()


def test_isbul_fetch_uses_page_param():
    base = "https://www.isbul.net/is-ilanlari/istanbul"
    routes = {base: fx("isbul_list.html"), base + "?page=2": "<html></html>"}
    jobs, http, _ = run(isbul, routes)
    assert len(jobs) == 2 and [u for _, u, _ in http.calls] == [base, base + "?page=2"]


# --- isinolsun -----------------------------------------------------------------

def test_isinolsun_best_effort():
    src = isinolsun.sources()[0]
    assert src.needs_browser is True
    jobs = isinolsun.parse_list(fx("isinolsun_list.html"))
    assert [j.external_id for j in jobs] == ["898A1B2C3D4E5F60718293A4B5C6D7E8", "D4871B2C3D4E5F60718293A4B5C6D7E9"]
    assert jobs[0].title == "Garson" and jobs[0].location == "İstanbul / Kadıköy, Moda"
    assert jobs[0].company == ""  # güvenle okunamayan alan uydurulmaz
    assert jobs[1].location == ""  # İstanbul geçmeyen satır konum sayılmaz


# --- youthall ------------------------------------------------------------------

def test_youthall_parse_and_stop_on_empty():
    base = "https://www.youthall.com/tr/is-ilanlari/"
    routes = {base: fx("youthall_list.html"), base + "?page=2": fx("youthall_empty.html")}
    jobs, http, _ = run(youthall, routes)
    assert [j.external_id for j in jobs] == ["ornek-banka/yazilim-stajyeri_12", "deneme-holding/management-trainee_3"]
    j = jobs[0]
    assert (j.title, j.company, j.location) == ("Yazılım Stajyeri", "Örnek Banka", "İstanbul")
    assert j.employment_type == "Stajyer" and j.extra["validThrough"] == "2026-10-27"
    assert jobs[1].location == "Ankara"
    assert len(http.calls) == 2


# --- techcareer ----------------------------------------------------------------

def test_techcareer_api_pages():
    routes = {
        techcareer.api_url(1): fx("techcareer_page1.json"),
        techcareer.api_url(2): fx("techcareer_page2.json"),
    }
    jobs, http, _ = run(techcareer, routes)
    assert unquote(techcareer.api_url(2)).endswith("?jobs[isCompleted]=false&jobs[page]=2")
    assert [j.external_id for j in jobs] == ["fullstack-developer-4407035", "veri-analisti-4382680", "qa-engineer-4390001"]
    j = jobs[0]
    assert j.url == "https://www.techcareer.net/jobs/detail/fullstack-developer-4407035"
    assert j.company == "Örnek Yazılım" and j.location == "İstanbul(Asya) | İstanbul(Avr.)"
    assert j.work_model == "hybrid" and j.posted_at == "2026-10-12T09:30:00"
    hidden = jobs[1]
    assert hidden.company == "" and hidden.extra.get("company_hidden") is True and hidden.work_model == "remote"
    assert len(http.calls) == 2  # pageCount=2 → 3. sayfa istenmez


def test_techcareer_falls_back_to_next_data():
    routes = {"https://www.techcareer.net/jobs": fx("techcareer_next.html")}
    jobs, _, _ = run(techcareer, routes)
    assert len(jobs) == 1
    assert (jobs[0].title, jobs[0].company, jobs[0].location) == ("Backend Developer", "Next Şirket", "İstanbul(Avr.)")


# --- iskur ---------------------------------------------------------------------

def test_iskur_form_fields():
    fields = dict(iskur.form_fields(fx("iskur_form.html")))
    assert fields["__VIEWSTATE"] == "VS_FORM" and fields["ctl04$ctlIl"] == ""
    assert "ctl04$btnAra" not in fields and "ctl04$chkEngelli" not in fields
    assert "__EVENTTARGET" not in fields
    assert iskur.istanbul_value(fx("iskur_form.html")) == "34"


def test_iskur_postback_flow():
    posts: list[dict] = []

    def search(method, url, kw):
        data = dict(kw["data"])
        posts.append(data)
        if data["__EVENTTARGET"] == iskur.SEARCH_TARGET:
            assert data["ctl04$ctlIl"] == "34" and data["__VIEWSTATE"] == "VS_FORM"
            return fx("iskur_results1.html")
        assert data["__EVENTTARGET"] == iskur.NEXT_TARGET
        assert data["__VIEWSTATE"] == "VS_RESULTS_1"  # sonuç sayfasının durumu geri gönderilir
        return fx("iskur_results2.html")

    routes = {("GET", iskur.SEARCH): fx("iskur_form.html"), ("POST", iskur.SEARCH): search}
    jobs, http, src = run(iskur, routes)
    assert src.needs_browser is False
    assert [j.external_id for j in jobs] == ["12345678901", "12345678902", "12345678903", "12345678904"]
    g = jobs[0]
    assert g.title == "GARSON" and g.company == ""
    assert g.location == "İl Geneli Başvuru (Çalışma Yeri: İSTANBUL / KADIKÖY)"
    assert g.url == "https://esube.iskur.gov.tr/Istihdam/AcikIsIlanDetay.aspx?uiID=12345678901"
    assert g.employment_type == "Tam Zamanlı"
    assert g.extra["positions"] == 3 and g.extra["validThrough"] == "2026-10-30"
    assert g.extra["employer_type"] == "Özel"
    assert len(posts) == 2  # "/ 2 Sayfaya Git" → 3. sayfa istenmez


def test_iskur_requires_form():
    with pytest.raises(RuntimeError):
        run(iskur, {("GET", iskur.SEARCH): "<html>Request Rejected</html>"})


# --- toptalent -----------------------------------------------------------------

def test_toptalent_loader():
    pages: list[int] = []

    def loader(method, url, kw):
        assert method == "POST"
        p = kw["json"]["PageNumber"]
        pages.append(p)
        assert kw["json"]["PageSize"] == 9 and kw["json"]["OrderBy"] == "newests"
        return fx("toptalent_search_p1.html") if p == 1 else ""

    jobs, _, _ = run(toptalent, {("POST", toptalent.SEARCH_URL): loader})
    assert pages == [1, 2]
    assert [j.external_id for j in jobs] == ["482913", "482914"]  # 4 haneli yıl eki makale sayılmaz
    j = jobs[0]
    assert j.url == "https://toptalent.co/yazilim-gelistirici-yeni-mezun-482913"
    assert (j.title, j.company, j.location) == ("Yazılım Geliştirici (Yeni Mezun)", "Örnek Teknoloji", "İstanbul")
    assert j.extra.get("badge") == "Yeni"
    assert (jobs[1].company, jobs[1].location) == ("Deneme Holding", "İzmir")


def test_toptalent_json_wrapped_fragment():
    body = json.dumps({"html": fx("toptalent_search_p1.html")})
    assert len(toptalent.parse_cards(body)) == 2


def test_toptalent_falls_back_to_list_page():
    routes = {("POST", toptalent.SEARCH_URL): HttpError(toptalent.SEARCH_URL, 500),
              toptalent.LIST_URL: fx("toptalent_search_p1.html")}
    jobs, _, _ = run(toptalent, routes, max_pages=1)
    assert len(jobs) == 2


# --- coderspace ----------------------------------------------------------------

def test_coderspace_jsonld_and_links():
    src = coderspace.sources()[0]
    assert src.needs_browser is True
    jobs = coderspace.parse_list(fx("coderspace_list.html"))
    assert len(jobs) == 1
    assert (jobs[0].external_id, jobs[0].company, jobs[0].posted_at) == ("frontend-developer-ornek", "Örnek Startup", "2026-10-10")
    jobs = coderspace.parse_list(fx("coderspace_links.html"))
    assert [(j.external_id, j.title, j.location) for j in jobs] == [("data-engineer-deneme", "Data Engineer", "İstanbul (Hibrit)")]


# --- ortak ----------------------------------------------------------------------

ALL = [yenibiris, secretcv, elemannet, isbul, isinolsun, youthall, techcareer, iskur, toptalent, coderspace]


@pytest.mark.parametrize("mod", ALL, ids=lambda m: m.__name__.rsplit(".", 1)[-1])
def test_sources_contract(mod):
    srcs = mod.sources()
    assert srcs and all(s.source_type == PLATFORM and callable(s.fetcher) for s in srcs)
    assert srcs[0].name == mod.__name__.rsplit(".", 1)[-1]


def test_registered_in_platform_package():
    from isilan.sources import platforms
    names = {s.name for s in platforms.sources()}
    assert {m.__name__.rsplit(".", 1)[-1] for m in ALL} <= names
