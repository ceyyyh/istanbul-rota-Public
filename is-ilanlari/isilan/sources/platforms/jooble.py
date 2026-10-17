"""Jooble — resmî REST API (ücretsiz anahtar: https://tr.jooble.org/api/about).

    POST https://tr.jooble.org/api/<JOOBLE_API_KEY>
         {"keywords": "", "location": "İstanbul", "page": N, "ResultOnPage": 50}
    →    {"totalCount": N, "jobs": [{"id", "title", "location", "snippet", "salary",
                                    "source", "type", "link", "company", "updated"}]}

Notlar:
- Anahtarlar bölgeseldir (jooble.org anahtarı yalnızca ABD ilanı döndürür); Türkiye için
  tr.jooble.org'dan alınmış anahtar gerekir. Farklı alan için JOOBLE_HOST kullanılabilir.
- Ücretsiz planın toplam istek kotası düşüktür; bu yüzden varsayılan sayfa sınırı 5'tir
  (params["max_pages"]).
- "updated" alanı ilanın Jooble dizinindeki güncellenme zamanıdır (yayın tarihi değil).
- HTML siteleri Cloudflare korumalı olduğundan anahtar yoksa kaynak atlanır.
"""
from __future__ import annotations

from typing import Iterator

from ...models import PLATFORM, Job
from ...text import clean, strip_html
from ..base import FetchContext, Source
from ._util import env, parse_any_date

NAME = "jooble"
PAGE_SIZE = 50


def api_url() -> str | None:
    key = env("JOOBLE_API_KEY")
    if not key:
        return None
    host = env("JOOBLE_HOST", "tr.jooble.org")
    return f"https://{host}/api/{key}"


def to_job(d: dict) -> Job | None:
    title = clean(d.get("title"))
    link = clean(d.get("link"))
    if not title or not link:
        return None
    ext = d.get("id")
    emp = clean(d.get("type"))
    work_model = "remote" if any(w in (clean(d.get("location")) + " " + emp).lower()
                                 for w in ("uzaktan", "remote")) else ""
    extra = {"via": clean(d.get("source"))} if d.get("source") else {}
    if d.get("updated"):
        extra["updated"] = clean(d.get("updated"))
    return Job(
        source=NAME,
        source_type=PLATFORM,
        external_id=str(ext) if ext not in (None, "") else link,
        title=title,
        company=clean(d.get("company")),
        url=link,
        location=clean(d.get("location")),
        posted_at=parse_any_date(d.get("updated")),
        employment_type=emp,
        work_model=work_model,
        description=strip_html(d.get("snippet", "")),
        salary=clean(d.get("salary")),
        extra=extra,
    )


def fetch(src: Source, ctx: FetchContext) -> Iterator[Job]:
    url = api_url()
    if not url:
        ctx.log.warning("jooble: JOOBLE_API_KEY tanımlı değil — kaynak atlandı "
                        "(ücretsiz anahtar: https://tr.jooble.org/api/about)")
        return
    p = src.params
    max_pages = min(ctx.max_pages, int(p.get("max_pages", 5)))
    seen: set[str] = set()
    total = None
    for page in range(1, max_pages + 1):
        if not ctx.time_left():
            return
        payload = {"keywords": p.get("keywords", ""), "location": p.get("location", "İstanbul"),
                   "page": page, "ResultOnPage": int(p.get("page_size", PAGE_SIZE))}
        data = ctx.http.post_json(url, payload, headers={"Content-Type": "application/json"})
        if total is None and isinstance(data, dict):
            total = data.get("totalCount")
        new = 0
        for d in (data or {}).get("jobs") or []:
            j = to_job(d)
            if j and j.external_id not in seen:
                seen.add(j.external_id)
                new += 1
                yield j
        if not new or (isinstance(total, int) and len(seen) >= total):
            return


def sources() -> list[Source]:
    return [Source(
        name=NAME,
        source_type=PLATFORM,
        label="Jooble",
        homepage="https://tr.jooble.org/is-ilanlari/%C4%B0stanbul",
        fetcher=fetch,
    )]
