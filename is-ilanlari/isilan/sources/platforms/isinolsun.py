"""isinolsun.com — Kariyer.net'in mavi yaka platformu (İstanbul, semt bilgili).

Bilinenler: ilan adresleri `https://isinolsun.com/is-ilani/<slug>-0ioj<32 hex>`; site
haritası `sitemaps/jobdetailsitemap1.xml` + `jobdetailsitemap2.xml` (~87 bin URL, `lastmod`)
ama URL'de şehir yok. `/is-ilanlari` ve `/is-ilanlari/istanbul` ile `/is-ilani/...`
sayfaları düz HTTP istemcisine hiç yanıt vermeden bekletiyor (kök ve site haritaları
anında 200 dönüyor) — yani sayfa bir tarayıcı gerektiriyor: `needs_browser=True`.

Bu modül, tarayıcıyla işlenmiş (veya bir gün düz istemciye açılan) liste sayfasını en iyi
çabayla ayrıştırır: önce JobPosting JSON-LD, yoksa ilan bağlantıları; başlık bağlantıdan,
konum yalnızca "İstanbul" geçen satırdan alınır, firma bilinmiyorsa boş kalır.
"""
from __future__ import annotations

import re
from typing import Iterator

from ...models import PLATFORM, Job
from ..base import FetchContext, Source
from ._cards import generic_list, paginate

NAME = "isinolsun"
BASE = "https://isinolsun.com"
LIST_URL = BASE + "/is-ilanlari/istanbul"
AD_RE = re.compile(r"isinolsun\.com/is-ilani/[^/?#]+?-0ioj([0-9A-Fa-f]{32})/?(?:[?#]|$)")


def page_url(base_url: str, page: int) -> str:
    if page <= 1:
        return base_url
    return f"{base_url}{'&' if '?' in base_url else '?'}page={page}"


def parse_list(html: str, source: str = NAME) -> list[Job]:
    return generic_list(html, base=BASE, link_re=AD_RE, source=source, source_type=PLATFORM,
                        location_hint="istanbul")


def fetch(src: Source, ctx: FetchContext) -> Iterator[Job]:
    base_url = src.params.get("list_url", LIST_URL)
    return paginate(ctx, lambda p: parse_list(ctx.http.get(page_url(base_url, p)), src.name), source=src.name)


def sources() -> list[Source]:
    return [Source(name=NAME, source_type=PLATFORM, label="İşin Olsun", fetcher=fetch,
                   homepage=BASE, params={"list_url": LIST_URL}, needs_browser=True)]
