"""isbul.net — İstanbul ilanları.

Liste: https://www.isbul.net/is-ilanlari/istanbul, sayfalama `?page=N`. JSON-LD yok;
kartlar `/is-ilani/<slug>` bağlantısı olan `<a>` öğeleri: başlık `title` öznitelikli ilk
`<div>`, firma `title` öznitelikli `<p>`, ardından `<span>`'ler — sırasıyla şehir/ilçe,
iş tipi (Tam Zamanlı ...), çalışma şekli (İş Yerinde/Uzaktan/Hibrit) ve en sonda göreli
tarih ("3 gün önce"); "|" ayraçları atlanır.
"""
from __future__ import annotations

import re
from typing import Iterator
from urllib.parse import urlparse

from ...models import PLATFORM, Job
from ...text import clean, fold
from ..base import FetchContext, Source
from ._cards import paginate, parse_html
from ._util import abs_url, parse_tr_relative_date

NAME = "isbul"
BASE = "https://www.isbul.net"
LIST_URL = BASE + "/is-ilanlari/istanbul"
_EMP = ("tam zamanli", "yari zamanli", "part time", "full time", "stajyer", "staj", "donemsel",
        "proje bazli", "serbest", "sozlesmeli", "gecici", "freelance")
_WM = {"uzaktan": "remote", "remote": "remote", "hibrit": "hybrid", "hybrid": "hybrid",
       "is yerinde": "onsite", "isyerinde": "onsite", "ofiste": "onsite"}


def page_url(base_url: str, page: int) -> str:
    if page <= 1:
        return base_url
    return f"{base_url}{'&' if '?' in base_url else '?'}page={page}"


def parse_list(html: str, source: str = NAME) -> list[Job]:
    root = parse_html(html)
    out: list[Job] = []
    seen: set[str] = set()
    for a in root.find_all("a", pred=lambda n: "/is-ilani/" in n.get("href")):
        url = abs_url(BASE, a.get("href")).split("#")[0]
        path = urlparse(url).path.rstrip("/")
        ext = path.rsplit("/", 1)[-1]
        if not ext or ext in seen:
            continue
        tnode = a.find("div", title=True) or a.find("h2|h3")
        title = (clean(tnode.get("title")) or tnode.text()) if tnode is not None else ""
        if not title:
            continue  # aynı ilana giden logo/görsel bağlantıları
        seen.add(ext)
        cnode = a.find("p", title=True)
        company = (clean(cnode.get("title")) or cnode.text()) if cnode is not None else ""
        spans = [s for s in (sp.text() for sp in a.find_all("span")) if s and s != "|"]
        location, emp, wm, date_txt = "", "", "", ""
        if spans:
            location = spans[0]
            rest = spans[1:]
            # tarih en sondaki span ("3 gün önce", "Bugün")
            if rest and fold(rest[-1]) != "yeni" and parse_tr_relative_date(rest[-1]):
                date_txt = rest.pop()
            for s in rest:
                f = fold(s)
                if not emp and any(e in f for e in _EMP):
                    emp = s
                elif not wm and f in _WM:
                    wm = _WM[f]
        out.append(Job(
            source=source, source_type=PLATFORM, external_id=ext, title=title, company=company,
            url=url, location=location, employment_type=emp, work_model=wm,
            posted_at=parse_tr_relative_date(date_txt),
            extra={"date_text": date_txt} if date_txt else {},
        ))
    return out


def fetch(src: Source, ctx: FetchContext) -> Iterator[Job]:
    base_url = src.params.get("list_url", LIST_URL)
    return paginate(ctx, lambda p: parse_list(ctx.http.get(page_url(base_url, p)), src.name), source=src.name)


def sources() -> list[Source]:
    return [Source(name=NAME, source_type=PLATFORM, label="İşbul.net", fetcher=fetch,
                   homepage=BASE, params={"list_url": LIST_URL})]

