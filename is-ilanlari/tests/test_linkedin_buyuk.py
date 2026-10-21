import logging

import pytest

from isilan.http import HttpError
from isilan.models import PLATFORM, Job
from isilan.sources.base import FetchContext
from isilan.sources.platforms import linkedin_buyuk as lb


class State(dict):
    def get(self, k, d=None):
        return super().get(k, d)

    def set(self, k, v):
        self[k] = v


class Http:
    def __init__(self, fail_at=None):
        self.calls, self.fail_at = [], fail_at

    def get(self, url, **kw):
        self.calls.append(url)
        if self.fail_at is not None and len(self.calls) > self.fail_at:
            raise HttpError(url, 429)
        return "<li>kart</li>"


def _cards(html):
    n = len(_cards.calls)
    _cards.calls.append(1)
    return [Job(source="x", source_type=PLATFORM, external_id=f"a{n}", title="Uzman", company="Arçelik A.Ş.",
                url=f"https://l/{n}", location="İstanbul"),
            Job(source="x", source_type=PLATFORM, external_id=f"b{n}", title="Garson", company="Küçük Kafe",
                url=f"https://l/b{n}", location="İstanbul")]


@pytest.fixture(autouse=True)
def _patch(monkeypatch):
    _cards.calls = []
    monkeypatch.setattr(lb, "parse_cards", _cards)
    monkeypatch.setattr(lb.time, "sleep", lambda s: None)


@pytest.fixture
def no_focus(monkeypatch):
    """Dönüşümlü imleç davranışını odak sorgularından bağımsız sınamak için odak kümesini boşaltır."""
    monkeypatch.setattr(lb, "focus_queries", lambda: [])


def _src(**p):
    s = lb.sources()[0]
    s.params = {**s.params, **p}
    return s


def test_keeps_only_big_companies_and_rotates_cursor(no_focus):
    st, http = State(), Http()
    ctx = FetchContext(http=http, state=st, log=logging.getLogger("t"))
    jobs = list(lb.fetch(_src(per_run=3, pages=1), ctx))
    assert {j.company for j in jobs} == {"Arçelik A.Ş."}      # küçük işletme elendi
    assert st["cursor"] == 3 and ctx.partial
    assert all(j.source == "linkedin-buyuk" for j in jobs)
    list(lb.fetch(_src(per_run=2, pages=1), FetchContext(http=http, state=st, log=logging.getLogger("t"))))
    assert st["cursor"] == 5                                 # kaldığı yerden devam


def test_stops_on_rate_limit_and_saves_cursor(no_focus):
    st = State()
    jobs = list(lb.fetch(_src(per_run=50, pages=1), FetchContext(http=Http(fail_at=2), state=st, log=logging.getLogger("t"))))
    assert len(jobs) == 2 and st["cursor"] == 2              # 3. sorguda 429 → dur, oradan devam edilecek


def test_first_request_blocked_raises(no_focus):
    with pytest.raises(HttpError):
        list(lb.fetch(_src(per_run=5), FetchContext(http=Http(fail_at=0), state=State(), log=logging.getLogger("t"))))


def _kws(http):
    from urllib.parse import parse_qs, urlparse
    return [parse_qs(urlparse(u).query)["keywords"][0] for u in http.calls]


def test_focus_queries_cover_odak_groups_and_are_excluded_from_rotation():
    from isilan.bigco import GROUPS, ODAK
    fq = lb.focus_queries()
    assert {"turkcell", "kpmg", "ericsson", "koc holding"} <= set(fq)
    assert {lb.group_of(q) for q in fq} <= ODAK
    assert len(fq) == len(set(fq)) and len(fq) >= len(ODAK) - 2
    assert ODAK <= {g[0] for g in GROUPS}


def test_focus_searched_first_every_run_and_cursor_only_moves_in_rotation():
    st, http = State(), Http()
    fq = lb.focus_queries()
    per_run = 2 * len(fq)                               # odak payı tam sığsın (per_run // 2)
    list(lb.fetch(_src(per_run=per_run, pages=1), FetchContext(http=http, state=st, log=logging.getLogger("t"))))
    assert _kws(http)[: len(fq)] == fq and st["cursor"] == len(fq)
    http2 = Http()                                      # ikinci taramada odak yine başta, imleç kaldığı yerden
    list(lb.fetch(_src(per_run=per_run, pages=1), FetchContext(http=http2, state=st, log=logging.getLogger("t"))))
    assert _kws(http2)[: len(fq)] == fq and st["cursor"] == 2 * len(fq)
    assert not set(_kws(http2)[len(fq):]) & set(fq)     # dönüşümlü kısım odak sorgularını tekrarlamaz
    assert len(http2.calls) == per_run                  # toplam sınır korunur


def test_rate_limit_during_focus_keeps_cursor():
    st = State()
    st["cursor"] = 7
    http = Http(fail_at=3)
    jobs = list(lb.fetch(_src(per_run=80, pages=1), FetchContext(http=http, state=st, log=logging.getLogger("t"))))
    assert len(jobs) == 3 and len(http.calls) == 4      # 4. odak sorgusunda 429 → dur
    assert st["cursor"] == 7                            # imleç bozulmadı


def test_focus_share_capped_so_rotation_still_advances():
    st, http = State(), Http()
    list(lb.fetch(_src(per_run=10, pages=1), FetchContext(http=http, state=st, log=logging.getLogger("t"))))
    assert len(http.calls) == 10 and st["cursor"] == 5  # odak en çok per_run/2
