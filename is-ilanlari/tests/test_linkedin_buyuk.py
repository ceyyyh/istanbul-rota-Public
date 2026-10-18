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


def _src(**p):
    s = lb.sources()[0]
    s.params = {**s.params, **p}
    return s


def test_keeps_only_big_companies_and_rotates_cursor():
    st, http = State(), Http()
    ctx = FetchContext(http=http, state=st, log=logging.getLogger("t"))
    jobs = list(lb.fetch(_src(per_run=3, pages=1), ctx))
    assert {j.company for j in jobs} == {"Arçelik A.Ş."}      # küçük işletme elendi
    assert st["cursor"] == 3 and ctx.partial
    assert all(j.source == "linkedin-buyuk" for j in jobs)
    list(lb.fetch(_src(per_run=2, pages=1), FetchContext(http=http, state=st, log=logging.getLogger("t"))))
    assert st["cursor"] == 5                                 # kaldığı yerden devam


def test_stops_on_rate_limit_and_saves_cursor():
    st = State()
    jobs = list(lb.fetch(_src(per_run=50, pages=1), FetchContext(http=Http(fail_at=2), state=st, log=logging.getLogger("t"))))
    assert len(jobs) == 2 and st["cursor"] == 2              # 3. sorguda 429 → dur, oradan devam edilecek


def test_first_request_blocked_raises():
    with pytest.raises(HttpError):
        list(lb.fetch(_src(per_run=5), FetchContext(http=Http(fail_at=0), state=State(), log=logging.getLogger("t"))))
