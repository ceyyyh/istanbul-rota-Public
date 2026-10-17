"""youthall.com — staj, yeni mezun programları ve giriş seviyesi ilanlar.

Liste: https://www.youthall.com/tr/is-ilanlari/?page=N, boş sayfaya kadar (birkaç sayfa).
Yalnızca «Tüm İlanlar» başlıklı blok okunur («Yetenek Programları» kartlarının ilan
bağlantısı yoktur). Kart: `<div class="jobs"><a href="https://www.youthall.com/tr/<firma>/<slug>_<n>/">`
içinde firma logosu `img.jobs-content-logo` (alt="<Firma> logo"), `<h5>` başlık ve üç
`div.jobs-tag` (ikon + metin): çalışma tipi (Stajyer, Tam Zamanlı ...), son başvuru tarihi
(27.09.2026) ve şehir. Liste şehir süzgeci sunmaz; İstanbul süzgeci pipeline'dadır.
Detay sayfasında JobPosting JSON-LD vardır (ctx.fetch_details → yayın tarihi, açıklama).
"""
from __future__ import annotations

import re
from typing import Iterator

from ...models import PLATFORM, Job
from ...text import clean, fold
from ..base import FetchContext, Source
from ._cards import paginate, parse_html
from ._util import abs_url, parse_any_date

NAME = "youthall"
BASE = "https://www.youthall.com"
LIST_URL = BASE + "/tr/is-ilanlari/"
_BLOCK = re.compile(r"<h2[^>]*>\s*Tüm İlanlar\s*</h2>(.*?)(?:<h2[^>]*>|$)", re.S | re.I)
_AD = re.compile(r"/tr/([^/]+)/([^/]+?)_(\d+)/?$")
_DMY = re.compile(r"^\s*\d{1,2}[./]\d{1,2}[./]\d{4}\s*$")
_EMP = ("staj", "tam zamanli", "yari zamanli", "yeni mezun", "part time", "full time",
        "donemsel", "uzun donem", "proje", "gonullu", "freelance")
_WM = {"uzaktan": "remote", "remote": "remote", "hibrit": "hybrid", "hybrid": "hybrid"}


def page_url(base_url: str, page: int) -> str:
    if page <= 1:
        return base_url
    return f"{base_url}{'&' if '?' in base_url else '?'}page={page}"


def parse_list(html: str, source: str = NAME) -> list[Job]:
    m = _BLOCK.search(html or "")
    root = parse_html(m.group(1) if m else html)
    out: list[Job] = []
    for box in root.find_all("div", "jobs"):
        a = box.find("a", href=True)
        if a is None:
            continue
        url = abs_url(BASE, a.get("href"))
        am = _AD.search(url.split("?")[0])
        if not am:
            continue
        ext = f"{am.group(1)}/{am.group(2)}_{am.group(3)}"
        h5 = a.find("h5")
        title = h5.text() if h5 is not None else ""
        logo = a.find("img", "jobs-content-logo")
        company = ""
        if logo is not None:
            company = re.sub(r"\s*logo\s*$", "", clean(logo.get("alt")), flags=re.I)
        emp, wm, deadline, city = "", "", "", ""
        for tag in a.find_all("div", "jobs-tag"):
            t = tag.text()
            f = fold(t)
            if not t:
                continue
            if _DMY.match(t):
                deadline = t
            elif f in _WM:
                wm = _WM[f]
            elif any(e in f for e in _EMP):
                emp = t
            elif not city:
                city = t
        if not title:
            continue
        extra: dict = {}
        if deadline:
            extra["validThrough"] = parse_any_date(deadline) or deadline
        out.append(Job(source=source, source_type=PLATFORM, external_id=ext, title=title,
                       company=company, url=url, location=city, employment_type=emp,
                       work_model=wm, category="Staj / Yeni mezun", extra=extra))
    return out


def fetch(src: Source, ctx: FetchContext) -> Iterator[Job]:
    base_url = src.params.get("list_url", LIST_URL)
    return paginate(ctx, lambda p: parse_list(ctx.http.get(page_url(base_url, p)), src.name), source=src.name)


def sources() -> list[Source]:
    return [Source(name=NAME, source_type=PLATFORM, label="Youthall", fetcher=fetch,
                   homepage=BASE, params={"list_url": LIST_URL})]
