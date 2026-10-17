"""coderspace.io — yazılım/teknoloji ilanları.

Liste sayfası https://coderspace.io/is-ilanlari/ (arama `?search=`), istemci tarafında
JavaScript ile dolduruluyor; yapısı doğrulanamadı → `needs_browser=True`.
En iyi çaba: önce JobPosting JSON-LD, sonra __NEXT_DATA__ içindeki ilan benzeri kayıtlar
(slug + başlık), en son `/is-ilanlari/<slug>/` biçimli bağlantılar. Detay sayfaları
(ctx.fetch_details) JSON-LD için taranır.
"""
from __future__ import annotations

import re
from typing import Iterator

from ...models import PLATFORM, Job
from ...text import clean
from ..base import FetchContext, Source
from ._cards import generic_list, next_data, paginate

NAME = "coderspace"
BASE = "https://coderspace.io"
LIST_URL = BASE + "/is-ilanlari/"
AD_RE = re.compile(r"coderspace\.io/(?:tr/|en/)?is-ilanlari/([a-z0-9][a-z0-9-]{2,})/?(?:[?#]|$)")


def page_url(base_url: str, page: int) -> str:
    if page <= 1:
        return base_url
    return f"{base_url}{'&' if '?' in base_url else '?'}page={page}"


def _walk(obj):
    if isinstance(obj, dict):
        yield obj
        for v in obj.values():
            yield from _walk(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk(v)


def _from_next_data(html: str, source: str) -> list[Job]:
    data = next_data(html)
    if not data:
        return []
    out: list[Job] = []
    seen: set[str] = set()
    for d in _walk(data.get("props", {})):
        slug = d.get("slug")
        title = d.get("title") or d.get("position") or d.get("jobTitle")
        if not (isinstance(slug, str) and isinstance(title, str)):
            continue
        # yalnızca ilanlara benzeyen kayıtlar (şirket ya da konum alanı taşıyan)
        comp = d.get("company") or d.get("companyName")
        loc = d.get("location") or d.get("city") or d.get("locationName")
        if comp is None and loc is None:
            continue
        if slug in seen:
            continue
        seen.add(slug)
        company = clean(comp.get("name") if isinstance(comp, dict) else comp) if comp else ""
        location = clean(loc.get("name") if isinstance(loc, dict) else loc) if isinstance(loc, (str, dict)) else ""
        out.append(Job(source=source, source_type=PLATFORM, external_id=slug, title=clean(title),
                       company=company, url=f"{BASE}/is-ilanlari/{slug}/", location=location))
    return out


def parse_list(html: str, source: str = NAME) -> list[Job]:
    jobs = generic_list(html, base=BASE, link_re=AD_RE, source=source, source_type=PLATFORM,
                        location_hint="istanbul")
    if jobs:
        return jobs
    return _from_next_data(html, source)


def fetch(src: Source, ctx: FetchContext) -> Iterator[Job]:
    base_url = src.params.get("list_url", LIST_URL)
    return paginate(ctx, lambda p: parse_list(ctx.http.get(page_url(base_url, p)), src.name), source=src.name)


def sources() -> list[Source]:
    return [Source(name=NAME, source_type=PLATFORM, label="Coderspace", fetcher=fetch,
                   homepage=LIST_URL, params={"list_url": LIST_URL}, needs_browser=True)]
