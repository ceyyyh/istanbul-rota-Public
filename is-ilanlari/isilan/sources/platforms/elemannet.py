"""eleman.net — İstanbul ilanları (mavi yaka ağırlıklı, ilçe bilgisi var).

Liste: https://www.eleman.net/is-ilanlari/istanbul, sayfalama `?sy=N`; sayfa sayısı
sayfalayıcının seçili `<option>` metninde ("1 / 243"). Kart:
`<div class="c-box__body ilan_listeleme_bol [renkli-ilan]"><a href="https://www.eleman.net/is-ilani/<slug>-i<id>">`
içinde `<h3>` başlık (içinde `div.ilantik-grubu` rozetleri olabilir),
`span.c-showcase-box__subtitle` = "Firma<br>İstanbul - Kadıköy".
Detay sayfalarında JobPosting JSON-LD (tarih, istihdam türü, il+ilçe) var.
"""
from __future__ import annotations

import re
from typing import Iterator

from ...models import PLATFORM, Job
from ..base import FetchContext, Source
from ._cards import Node, paginate, parse_html
from ._util import abs_url

NAME = "elemannet"
BASE = "https://www.eleman.net"
LIST_URL = BASE + "/is-ilanlari/istanbul"
_ID = re.compile(r"-i(\d+)/?(?:[?#].*)?$")
_PAGER = re.compile(r"^\s*(\d+)\s*/\s*(\d+)\s*$")


def page_url(base_url: str, page: int) -> str:
    if page <= 1:
        return base_url
    return f"{base_url}{'&' if '?' in base_url else '?'}sy={page}"


def _title(h3: Node | None) -> str:
    if h3 is None:
        return ""
    parts: list[str] = []
    for c in h3.children:
        if isinstance(c, str):
            parts.append(c)
        elif not (c.tag == "div" and c.has_class("ilantik-grubu")):
            parts.append(c.text())
    return " ".join(" ".join(parts).split())


def parse_pager(root: Node) -> int | None:
    for opt in root.find_all("option", selected=True):
        m = _PAGER.match(opt.text())
        if m:
            return int(m.group(2))
    return None


def parse_list(html: str, source: str = NAME) -> tuple[list[Job], int | None]:
    root = parse_html(html)
    out: list[Job] = []
    for box in root.find_all("div", "ilan_listeleme_bol"):
        link = box.find("a", pred=lambda n: "/is-ilani/" in n.get("href"))
        if link is None:
            continue
        url = abs_url(BASE, link.get("href"))
        m = _ID.search(url)
        ext = m.group(1) if m else url
        title = _title(link.find("h3"))
        sub = link.find("span", "c-showcase-box__subtitle")
        lines = sub.lines() if sub is not None else []
        company = lines[0] if lines else ""
        place = lines[1] if len(lines) > 1 else ""
        if not title:
            continue
        extra = {}
        if box.has_class("renkli-ilan"):
            extra["highlighted"] = True
        text = link.text()
        if "ACİL" in text.upper():
            extra["urgent"] = True
        out.append(Job(source=source, source_type=PLATFORM, external_id=ext, title=title,
                       company=company, url=url, location=place, extra=extra))
    return out, parse_pager(root)


def fetch(src: Source, ctx: FetchContext) -> Iterator[Job]:
    base_url = src.params.get("list_url", LIST_URL)
    state: dict = {}

    def fetch_page(p: int) -> list[Job]:
        jobs, pages = parse_list(ctx.http.get(page_url(base_url, p)), src.name)
        state["pages"] = pages
        return jobs

    return paginate(ctx, fetch_page, source=src.name, last_page=lambda: state.get("pages"))


def sources() -> list[Source]:
    return [Source(name=NAME, source_type=PLATFORM, label="Eleman.net", fetcher=fetch,
                   homepage=BASE, params={"list_url": LIST_URL})]
