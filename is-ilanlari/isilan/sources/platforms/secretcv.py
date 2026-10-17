"""secretcv.com — İstanbul ilanları.

Liste: https://www.secretcv.com/is-ilanlari/istanbul-is-ilanlari/ (sayfa başına 20 kart),
sayfalama `?sf=N`. Kart: `div.cv-job-box` (ör. `class="cv-job-box job-list ..."`),
başlık `a.title` (href `https://www.secretcv.com/<firma>-<firmaId>/<slug>-is-ilanlari-<id>`),
firma `a.company` (href `/firma/...`), şehir `span.city > span` ("İstanbul (Avr.)").
Bazı istemcilere sayfalı adresler 410 döndüğü bildirildiğinden, sayfalama çalışmazsa
İstanbul ilçe listelerinin (`/is-ilanlari/<ilçe>-is-ilanlari`) ilk sayfaları taranır.
Detay sayfalarında JobPosting JSON-LD bulunur (ctx.fetch_details).
"""
from __future__ import annotations

import re
from typing import Iterator

from ...http import HttpError
from ...models import PLATFORM, Job
from ...text import clean
from ..base import FetchContext, Source
from ._cards import maybe_enrich, parse_html
from ._util import abs_url, parse_tr_relative_date

NAME = "secretcv"
BASE = "https://www.secretcv.com"
LIST_URL = BASE + "/is-ilanlari/istanbul-is-ilanlari/"
_ID = re.compile(r"-is-ilanlari-(\d+)")

# Sayfalama reddedilirse taranacak ilçe listeleri (ilk sayfaları)
DISTRICT_SLUGS = [
    "kadikoy", "besiktas", "sisli", "atasehir", "umraniye", "uskudar", "maltepe", "kartal",
    "pendik", "tuzla", "beylikduzu", "esenyurt", "bakirkoy", "bagcilar", "basaksehir",
    "kagithane", "sariyer", "beyoglu", "fatih", "zeytinburnu", "avcilar", "kucukcekmece",
    "bahcelievler", "gunesli", "sancaktepe", "cekmekoy", "eyupsultan", "gaziosmanpasa",
]


def page_url(base_url: str, page: int) -> str:
    if page <= 1:
        return base_url
    return f"{base_url}{'&' if '?' in base_url else '?'}sf={page}"


def parse_list(html: str, source: str = NAME) -> list[Job]:
    root = parse_html(html)
    out: list[Job] = []
    for card in root.find_all("div", "cv-job-box"):
        link = card.find("a", "title")
        if link is None or not link.get("href"):
            continue
        url = abs_url(BASE, link.get("href"))
        m = _ID.search(url)
        ext = m.group(1) if m else url
        title = link.text() or clean(link.get("title"))
        comp = card.find("a", "company")
        city = card.find("span", "city")
        location = ""
        if city is not None:
            inner = city.find("span")
            location = (inner or city).text()
        date_el = card.find(pred=lambda n: any(k in c.lower() for c in n.classes for k in ("date", "time")))
        date_txt = date_el.text() if date_el is not None else ""
        if not title:
            continue
        out.append(Job(
            source=source, source_type=PLATFORM, external_id=ext, title=title,
            company=comp.text() if comp is not None else "", url=url, location=location,
            posted_at=parse_tr_relative_date(date_txt),
            extra={"date_text": date_txt} if date_txt else {},
        ))
    return out


def fetch(src: Source, ctx: FetchContext) -> Iterator[Job]:
    base_url = src.params.get("list_url", LIST_URL)
    seen: set[str] = set()
    budget = max(ctx.max_pages, 1)
    used = 0

    def take(jobs: list[Job]) -> list[Job]:
        fresh = [j for j in jobs if j.external_id not in seen]
        seen.update(j.external_id for j in fresh)
        return fresh

    # 1) ana İstanbul listesi, ?sf=N ile
    paging_ok = True
    page = 1
    while used < budget and (page == 1 or ctx.time_left()):
        try:
            html = ctx.http.get(page_url(base_url, page))
        except HttpError as e:
            if page == 1:
                raise
            ctx.log.info("secretcv: sayfa %d alınamadı (%s)", page, e)
            paging_ok = False
            break
        used += 1
        fresh = take(parse_list(html, src.name))
        if not fresh:
            if page == 2:  # 2. sayfa yeni ilan getirmediyse sayfalama yok sayılıyor demektir
                paging_ok = False
            break
        yield from maybe_enrich(fresh, ctx)
        page += 1

    # 2) sayfalama çalışmadıysa ilçe listelerinin ilk sayfaları
    if paging_ok:
        return
    for slug in src.params.get("district_slugs", DISTRICT_SLUGS):
        if used >= budget or not ctx.time_left():
            break
        try:
            html = ctx.http.get(f"{BASE}/is-ilanlari/{slug}-is-ilanlari")
        except HttpError as e:
            ctx.log.debug("secretcv ilçe listesi %s alınamadı: %s", slug, e)
            continue
        used += 1
        yield from maybe_enrich(take(parse_list(html, src.name)), ctx)


def sources() -> list[Source]:
    return [Source(name=NAME, source_type=PLATFORM, label="SecretCV", fetcher=fetch,
                   homepage=BASE, params={"list_url": LIST_URL})]
