"""toptalent.co — yeni mezun / genç yetenek ilanları.

`/is-ilanlari` ilk dokuz kartı sunar, gerisini sitenin kendi yükleyicisi getirir:
  POST https://toptalent.co/Job/SearchJob  (JSON gövde)
  {PageSize: 9, PageNumber: p, IsCardView: false, SearchKey: "", DepartmentIds: [], CityIds: [],
   PositionLevelIds: [], OrderBy: "newests", FilterTags: [], DepartmentSeo: "", CitySeo: ""}
  -> `a.position` kartlarından oluşan HTML parçası (boş sayfa = son).
Kart: `<a href="/<slug>-<id>" class="position">` içinde `h5.card-title` başlık ve
`p.card-text` (satır 1 firma, satır 2 konum). İlan kimliği 5-8 haneli sayı.
Şehir süzgeci parametresinin değerleri doğrulanmadığından kullanılmıyor; İstanbul süzgeci
pipeline'dadır.
"""
from __future__ import annotations

import json
import re
from typing import Iterator

from ...http import HttpError
from ...models import PLATFORM, Job
from ..base import FetchContext, Source
from ._cards import paginate, parse_html
from ._util import abs_url

NAME = "toptalent"
BASE = "https://toptalent.co"
LIST_URL = BASE + "/is-ilanlari"
SEARCH_URL = BASE + "/Job/SearchJob"
PAGE_SIZE = 9
_AD = re.compile(r"^/?([a-z0-9-]+-(\d{5,8}))/?$")


def payload(page: int, q: str = "", city_seo: str = "") -> dict:
    return {"PageSize": PAGE_SIZE, "PageNumber": page, "IsCardView": False, "SearchKey": q,
            "DepartmentIds": [], "CityIds": [], "PositionLevelIds": [], "OrderBy": "newests",
            "FilterTags": [], "DepartmentSeo": "", "CitySeo": city_seo}


def _unwrap(body: str) -> str:
    """Yanıt bazen JSON içinde HTML parçası olabilir: {"html": "..."} ya da "\"...\""."""
    s = (body or "").strip()
    if s[:1] in ('{', '"'):
        try:
            v = json.loads(s)
        except json.JSONDecodeError:
            return body
        if isinstance(v, str):
            return v
        if isinstance(v, dict):
            for k in ("html", "Html", "data", "Data", "result", "Result", "view", "View"):
                if isinstance(v.get(k), str):
                    return v[k]
    return body


def parse_cards(html: str, source: str = NAME) -> list[Job]:
    root = parse_html(_unwrap(html))
    out: list[Job] = []
    for a in root.find_all("a", "position"):
        href = a.get("href")
        path = href.split("?")[0]
        if path.startswith("http"):
            path = "/" + path.split("/", 3)[-1]
        m = _AD.match(path)
        if not m:
            continue  # makale vb. bağlantılar ("...-2023" gibi yıl ekleri 4 hanelidir)
        h5 = a.find("h5", "card-title") or a.find("h5")
        title = h5.text() if h5 is not None else ""
        p = a.find("p", "card-text")
        lines = p.lines() if p is not None else []
        if not title:
            continue
        badge = a.find(pred=lambda n: any(c.startswith("badge-circle") for c in n.classes))
        extra = {"badge": badge.text()} if badge is not None and badge.text() else {}
        out.append(Job(source=source, source_type=PLATFORM, external_id=m.group(2), title=title,
                       company=lines[0] if lines else "", url=abs_url(BASE, "/" + m.group(1)),
                       location=lines[1] if len(lines) > 1 else "", extra=extra))
    return out


def fetch(src: Source, ctx: FetchContext) -> Iterator[Job]:
    city_seo = src.params.get("city_seo", "")

    def fetch_page(p: int) -> list[Job]:
        try:
            body = ctx.http.text(SEARCH_URL, "POST", json=payload(p, city_seo=city_seo),
                                 headers={"X-Requested-With": "XMLHttpRequest",
                                          "Accept": "text/html, */*; q=0.01"})
        except HttpError:
            if p != 1:
                raise
            body = ctx.http.get(LIST_URL)  # yükleyici yanıt vermezse en azından ilk 9 kart
        return parse_cards(body, src.name)

    return paginate(ctx, fetch_page, source=src.name)


def sources() -> list[Source]:
    return [Source(name=NAME, source_type=PLATFORM, label="Toptalent", fetcher=fetch,
                   homepage=LIST_URL)]
