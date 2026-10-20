import logging
from urllib.parse import parse_qs, urlparse

from isilan.http import HttpError
from isilan.models import PLATFORM, Job
from isilan.sources.base import FetchContext
from isilan.sources.platforms import linkedin as li


class State(dict):
    def get(self, k, d=None):
        return super().get(k, d)

    def set(self, k, v):
        self[k] = v


class Http:
    def __init__(self, fail_on=()):
        self.locations, self.fail_on = [], set(fail_on)

    def get(self, url, **kw):
        loc = parse_qs(urlparse(url).query).get("location", [""])[0]
        self.locations.append(loc)
        if loc in self.fail_on:
            raise HttpError(url, 429)
        return "<li>kart</li>"


def _cards(html):
    return [Job(source="linkedin", source_type=PLATFORM, external_id=f"id{len(html)}", title="Uzman",
                company="Arçelik A.Ş.", url="https://l/x", location="İstanbul")]


def _names():
    return [q["location"] for q in li._district_queries({})]


def _run(st, http, limit=None):
    """Genel İstanbul sorgusu (max_results=1 ile sınırda) + ilçe aramaları; `limit` çağrıdan sonra süre dolar."""
    ctx = FetchContext(http=http, state=st, log=logging.getLogger("t"))
    if limit is not None:
        ctx.time_left = lambda: len(http.locations) < limit
    src = li.sources()[0]
    src.params = {**src.params, "max_results": 1}
    list(li.fetch(src, ctx))
    return ctx


def test_district_search_resumes_where_time_ran_out(monkeypatch):
    monkeypatch.setattr(li, "parse_cards", _cards)
    names, st, http = _names(), State(), Http()
    ctx = _run(st, http, limit=3)  # genel sorgu + 2 ilçe, sonra süre doldu
    assert http.locations[1:] == names[:2]
    assert st["district"] == 1 and ctx.partial  # yarıda kalan ilçe bir sonraki taramada baştan aranır


def test_district_search_continues_next_run_and_wraps(monkeypatch):
    monkeypatch.setattr(li, "parse_cards", _cards)
    names, st, http = _names(), State({"district": 1}), Http()
    ctx = _run(st, http)
    assert http.locations[1:] == names[1:] + names[:1]  # kaldığı yerden, tur sonunda başa sararak
    assert st["district"] == 1 and not ctx.partial


def test_blocked_district_is_skipped_and_run_stops(monkeypatch):
    monkeypatch.setattr(li, "parse_cards", _cards)
    names, st = _names(), State()
    http = Http(fail_on={names[0]})
    ctx = _run(st, http)
    assert http.locations[1:] == [names[0]]  # 429 alınca tarama durur
    assert st["district"] == 1 and ctx.partial  # bir sonraki tur bu ilçeyi değil sıradakini arar
