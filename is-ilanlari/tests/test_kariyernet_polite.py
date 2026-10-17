"""Kariyer.net kibar tarama: bekleme, ilk engelde durma, kalıcı imleç, yenileme sayfaları (ağsız)."""
import logging

import pytest

from isilan.db import DB
from isilan.http import HttpError
from isilan.pipeline import CrawlOptions, run_source
from isilan.sources import FetchContext
from isilan.sources.platforms import kariyernet as kn

BLOCK_HTML = ("<html><head><script>window._pxAppId='PX1';</script></head>"
              "<body><div id='px-captcha'></div></body></html>")
LIST = kn.LIST_URL
KADIKOY = kn.seg_url("istanbul+asya-kadikoy")


def cards(*ids, loc="İstanbul(Asya)"):
    out = []
    for i in ids:
        out.append(
            f'<div data-test="ad-card" positionname="Pozisyon {i}" cityname="{loc}" time="1 gün">'
            f'<a data-test="ad-card-item" href="/is-ilani/firma-pozisyon-{i}">'
            f'<img data-test="company-image" alt="Firma {i}">'
            f'<span data-test="ad-card-title">Pozisyon {i}</span>'
            f'<span data-test="location">{loc}</span></a></div>')
    return "<html><body>" + "".join(out) + "</body></html>"


class UrlHttp:
    """Tam URL → yanıt; istisna örneği fırlatılır. Tanımsız URL: 404."""

    def __init__(self, routes):
        self.routes = dict(routes)
        self.calls = []
        self.request_count = 0

    def get(self, url, **kw):
        self.calls.append(url)
        r = self.routes.get(url)
        if r is None:
            raise HttpError(url, 404)
        if isinstance(r, Exception):
            raise r
        return r

    text = get


class DictState:
    def __init__(self, d=None):
        self.d = dict(d or {})

    def get(self, key, default=None):
        return self.d.get(key, default)

    def set(self, key, value):
        self.d[key] = value


@pytest.fixture
def sleeps(monkeypatch):
    rec = []
    monkeypatch.setattr(kn.time, "sleep", lambda s: rec.append(s))
    return rec


def src(**params):
    s = kn.sources()[0]
    s.params = {**s.params, **params}
    return s


def ctx(http, state=None, max_pages=50):
    return FetchContext(http=http, max_pages=max_pages, log=logging.getLogger("test"), state=state)


def p(n, base=LIST):
    return kn.page_url(n, base)


def test_pacing_between_pages(sleeps):
    http = UrlHttp({p(1): cards(1, 2), p(2): cards(3, 4), p(3): cards(5), p(4): "<html></html>"})
    jobs = list(kn.fetch(src(), ctx(http)))
    assert [j.external_id for j in jobs] == ["1", "2", "3", "4", "5"]
    assert len(http.calls) == 4
    assert len(sleeps) == 3  # ilk istekten önce beklenmez
    assert all(4.0 <= s <= 8.0 for s in sleeps)


def test_long_break_every_n_pages(sleeps):
    routes = {p(i): cards(i) for i in range(1, 6)}
    list(kn.fetch(src(break_every=2, break_min=50, break_max=60), ctx(UrlHttp(routes))))
    # istek 2 ve 4'ten sonra uzun mola, diğerlerinde kısa bekleme
    assert [s >= 50 for s in sleeps] == [False, True, False, True, False]


def test_stop_on_first_block_keeps_jobs_and_marks_partial(sleeps):
    http = UrlHttp({p(1): cards(1, 2), p(2): HttpError(p(2), 403), p(3): cards(9)})
    c = ctx(http)
    jobs = list(kn.fetch(src(), c))
    assert [j.external_id for j in jobs] == ["1", "2"]
    assert c.partial is True
    assert http.calls == [p(1), p(2)]  # engelden sonra hiç istek yok


def test_block_page_html_also_stops(sleeps):
    http = UrlHttp({p(1): cards(1), p(2): BLOCK_HTML})
    c = ctx(http)
    assert len(list(kn.fetch(src(), c))) == 1 and c.partial


def test_page1_block_raises(sleeps):
    for resp in (HttpError(p(1), 403), BLOCK_HTML):
        c = ctx(UrlHttp({p(1): resp}), DictState())
        with pytest.raises(RuntimeError, match="PerimeterX"):
            list(kn.fetch(src(), c))


def test_cursor_saved_and_resumed(sleeps, monkeypatch):
    real = {s["key"]: s for s in kn.segments()}
    segs = [real["istanbul+asya-kadikoy"], real["istanbul+asya-umraniye"], real["istanbul+avrupa"]]
    monkeypatch.setattr(kn, "segments", lambda: segs)
    state = DictState()
    routes = {p(1): cards(1, 2), p(2): cards(3),
              KADIKOY: cards(10, 11), p(2, KADIKOY): cards(12), p(3, KADIKOY): HttpError("x", 403)}
    http = UrlHttp(routes)
    c = ctx(http, state)
    jobs = list(kn.fetch(src(refresh_pages=2), c))
    assert [j.external_id for j in jobs] == ["1", "2", "3", "10", "11", "12"]
    assert http.calls == [p(1), p(2), KADIKOY, p(2, KADIKOY), p(3, KADIKOY)]
    assert c.partial
    assert state.d["cursor"]["seg"] == "istanbul+asya-kadikoy" and state.d["cursor"]["page"] == 3
    # Doğrulanmış ilçe bölümü: ilçe doğrudan atanır
    assert {j.district for j in jobs if int(j.external_id) >= 10} == {"Kadıköy"}
    assert all(j.district is None for j in jobs if int(j.external_id) < 10)

    # İkinci tarama: önce en yeni sayfalar (yeni ilan 0), sonra imleçten (Kadıköy 3. sayfa) devam
    routes.update({p(1): cards(0, 1), p(3, KADIKOY): cards(13), p(4, KADIKOY): "<html></html>"})
    nxt = kn.seg_url(kn.segments()[1]["key"])
    routes[nxt] = HttpError(nxt, 403)
    http2 = UrlHttp(routes)
    jobs2 = list(kn.fetch(src(refresh_pages=2), ctx(http2, state)))
    assert http2.calls == [p(1), p(2), p(3, KADIKOY), p(4, KADIKOY), nxt]
    assert [j.external_id for j in jobs2] == ["0", "1", "3", "13"]
    assert state.d["cursor"]["seg"] == kn.segments()[1]["key"] and state.d["cursor"]["page"] == 1


def test_deep_budget_and_full_cycle_reset(sleeps, monkeypatch):
    segs = [{"key": "a", "district": None}, {"key": "b", "district": None}]
    monkeypatch.setattr(kn, "segments", lambda: segs)
    A, B = kn.seg_url("a"), kn.seg_url("b")
    routes = {p(1): cards(1), A: cards(20), p(2, A): cards(21), p(3, A): "<html></html>",  # kart yok → bölüm sonu
              B: cards(30), p(2, B): "<html></html>"}
    state = DictState()
    http = UrlHttp(routes)
    list(kn.fetch(src(refresh_pages=1, deep_pages=2), ctx(http, state)))
    assert http.calls == [p(1), A, p(2, A)]          # derin bütçe: 2 sayfa
    assert state.d["cursor"]["seg"] == "a" and state.d["cursor"]["page"] == 3
    http = UrlHttp(routes)
    list(kn.fetch(src(refresh_pages=1, deep_pages=10), ctx(http, state)))
    assert http.calls == [p(1), p(3, A), B, p(2, B)]
    assert state.d["cursor"]["seg"] == "a" and state.d["cursor"]["page"] == 1  # tur bitti → başa
    assert "last_full_cycle" in state.d


def test_inferred_district_segment_does_not_assign_district():
    segs = kn.segments()
    keys = [s["key"] for s in segs]
    assert keys[:7] and all(s["district"] for s in segs[:7])
    assert "istanbul+avrupa-sisli" in keys and next(s for s in segs if s["key"] == "istanbul+avrupa-sisli")["district"] is None
    assert keys[-2:] == ["istanbul+asya", "istanbul+avrupa"]
    assert len(keys) == len(set(keys)) == 39 + 2


def test_db_state_roundtrip(tmp_path):
    db = DB(tmp_path / "t.db")
    v = db.state_for("kariyernet")
    assert v.get("cursor") is None and v.get("x", 5) == 5
    v.set("cursor", {"seg": "istanbul+asya", "page": 7})
    db.close()
    db = DB(tmp_path / "t.db")
    assert db.state_for("kariyernet").get("cursor") == {"seg": "istanbul+asya", "page": 7}
    assert db.get_state("kariyernet:cursor")["page"] == 7
    assert db.state_for("other").get("cursor") is None


def test_pipeline_persists_cursor_and_reports_partial(tmp_path, sleeps, monkeypatch):
    monkeypatch.setattr(kn, "segments", lambda: [{"key": "istanbul+asya-kadikoy", "district": "Kadıköy"}])
    db = DB(tmp_path / "t.db")
    routes = {p(1): cards(1, 2), KADIKOY: cards(10), p(2, KADIKOY): HttpError("x", 403)}
    opts = CrawlOptions(district_details=-1)
    res = run_source(src(refresh_pages=1), db, UrlHttp(routes), opts)
    assert res["status"] == "ok" and res["kept"] == 3 and res["removed"] == 0
    assert db.get_state("kariyernet:cursor")["page"] == 2
    rows = {r["external_id"]: r for r in db.conn.execute("SELECT external_id, district FROM jobs")}
    assert rows["10"]["district"] == "Kadıköy"
    # Sonraki tarama: blok sürse bile önceki ilanlar silinmez (eksik tarama)
    routes[p(1)] = cards(2)
    res = run_source(src(refresh_pages=1), db, UrlHttp(routes), opts)
    assert res["removed"] == 0
    assert db.conn.execute("SELECT COUNT(*) FROM jobs WHERE active=1").fetchone()[0] == 3
    # İlk sayfa engelli: hata durumu
    res = run_source(src(refresh_pages=1), db, UrlHttp({p(1): HttpError(p(1), 403)}), opts)
    assert res["status"] == "error" and "PerimeterX" in res["error"]
