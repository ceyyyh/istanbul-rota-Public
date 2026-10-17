"""yenibiris.com — İstanbul ilanları.

Sunucu tarafında üretilen (ASP.NET) liste: https://www.yenibiris.com/is-ilanlari/istanbul,
sayfalama `?sayfa=N`. Her ilan kartı `div.listViewRows`; başlık bağlantısı `a.gtmTitle`
(`data-ad-id`, `title` öznitelikleri; href `/is-ilani/<slug>/<sayısal id>` biçiminde),
firma `.gtmCompanyName` (title özniteliği), konum `.gtmLocation` ("İstanbul / Kadıköy"),
tarih "Bugün / Dün / 3 gün önce" metnini taşıyan bir `title` özniteliğinde.
Detay sayfaları (ctx.fetch_details) JSON-LD JobPosting için taranır.
"""
from __future__ import annotations

import re
from typing import Iterator

from ...models import PLATFORM, Job
from ...text import clean
from ..base import FetchContext, Source
from ._cards import Node, paginate, parse_html
from ._util import abs_url, parse_tr_relative_date

NAME = "yenibiris"
BASE = "https://www.yenibiris.com"
LIST_URL = BASE + "/is-ilanlari/istanbul"
_ID_TAIL = re.compile(r"/(\d+)/?(?:[?#].*)?$")
_DATE_HINT = re.compile(
    r"^\s*(bug[üu]n|d[üu]n|\d+\+?\s*(g[üu]n|hafta|saat|dakika|ay)\b.*|\d{1,2}[./]\d{1,2}[./]\d{4})\s*$", re.I)


def page_url(base_url: str, page: int) -> str:
    if page <= 1:
        return base_url
    return f"{base_url}{'&' if '?' in base_url else '?'}sayfa={page}"


def _title_link(card: Node) -> Node | None:
    return (card.find("a", "gtmTitle")
            or card.find("a", data_test="AdSearch-ad-title-field")
            or card.find("a", data_ad_id=True))


def _date_text(card: Node) -> str:
    for n in card.iter():
        t = n.get("title")
        if t and _DATE_HINT.match(t):
            return t
    for n in card.iter():
        if any("date" in c.lower() or "time" in c.lower() for c in n.classes):
            if n.text():
                return n.text()
    for n in card.iter():  # son çare: tek başına tarih metni taşıyan yaprak öğe
        if n.tag in ("span", "div", "small", "p") and not any(isinstance(c, Node) for c in n.children):
            t = n.text()
            if t and _DATE_HINT.match(t):
                return t
    return ""


def parse_list(html: str, source: str = NAME) -> list[Job]:
    root = parse_html(html)
    out: list[Job] = []
    for card in root.find_all("div", "listViewRows"):
        link = _title_link(card)
        if link is None or not link.get("href"):
            continue
        url = abs_url(BASE, link.get("href"))
        ext = link.get("data-ad-id")
        if not ext:
            m = _ID_TAIL.search(url)
            ext = m.group(1) if m else url
        title = clean(link.get("title")) or link.text()
        comp_el = card.find(cls="gtmCompanyName")
        company = (clean(comp_el.get("title")) or comp_el.text()) if comp_el else ""
        loc_el = card.find(cls="gtmLocation")
        location = (clean(loc_el.get("title")) or loc_el.text()) if loc_el else ""
        date_txt = _date_text(card)
        if not title:
            continue
        out.append(Job(
            source=source, source_type=PLATFORM, external_id=ext, title=title,
            company=company, url=url, location=location,
            posted_at=parse_tr_relative_date(date_txt),
            extra={"date_text": date_txt} if date_txt else {},
        ))
    return out


def fetch(src: Source, ctx: FetchContext) -> Iterator[Job]:
    base_url = src.params.get("list_url", LIST_URL)
    return paginate(ctx, lambda p: parse_list(ctx.http.get(page_url(base_url, p)), src.name), source=src.name)


def sources() -> list[Source]:
    return [Source(name=NAME, source_type=PLATFORM, label="Yenibiriş", fetcher=fetch,
                   homepage=BASE, params={"list_url": LIST_URL})]
