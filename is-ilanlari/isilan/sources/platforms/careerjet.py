"""Careerjet Türkiye (careerjet.com.tr) — ilan toplayıcı (aggregator).

1) Resmî Publisher API v4 (anahtar varsa):
       GET https://search.api.careerjet.net/v4/query
           ?locale_code=tr_TR&location=İstanbul&keywords=&sort=date&page=N&page_size=100
           &user_ip=<son kullanıcı IP>&user_agent=<son kullanıcı UA>
       Kimlik doğrulama: HTTP Basic (kullanıcı adı = API anahtarı, parola boş).
       Ayrıca yayıncı hesabında beyan edilen Referer başlığı ve beyaz listedeki çıkış IP'si
       gerekebilir. Yanıt: {"type": "JOBS", "hits", "pages", "jobs": [{title, company, date,
       description, locations, salary, salary_min, salary_max, salary_currency_code,
       salary_type, site, url}]} — konum belirsizse {"type": "LOCATIONS", ...}.
       Eski `public.api.careerjet.net/search?affid=` uç noktası emekliye ayrıldı ("use v4").

   Ortam değişkenleri:
       CAREERJET_API_KEY   (veya eski ad CAREERJET_AFFID) — yayıncı API anahtarı
       CAREERJET_USER_IP   — çıkış IP'si (yoksa api.ipify.org'dan öğrenilir)
       CAREERJET_REFERER   — yayıncı hesabında beyan edilen sayfa (vars.: https://www.careerjet.com.tr/)

2) Anahtar yoksa HTML arama sayfası (Cloudflare Turnstile ile korunabilir; `--browser`):
       https://www.careerjet.com.tr/arama/is-ilanlari?l=İstanbul&p=N
       <ul class="jobs"><li><article class="job clicky" data-url="/jobad/tr...">
           <header><h2><a href="/jobad/tr...">Başlık</a></h2></header>
           <p class="company"><a>Firma</a></p>
           <ul class="location"><li>İstanbul</li></ul>
           <ul class="salary"><li>...</li></ul>
           <div class="desc">...</div>
           <footer><ul class="tags"><li><span class="badge ...">3 gün önce</span></li></ul></footer>
       </article></li>...</ul>
"""
from __future__ import annotations

import base64
import re
from email.utils import parsedate_to_datetime
from typing import Iterator
from urllib.parse import urlencode

from ...browser import looks_blocked
from ...http import USER_AGENTS, HttpError
from ...models import PLATFORM, Job
from ...text import clean, strip_html
from ..base import FetchContext, Source
from ._util import abs_url, env, parse_any_date, parse_html, parse_tr_relative_date

NAME = "careerjet"
BASE = "https://www.careerjet.com.tr"
API_URL = "https://search.api.careerjet.net/v4/query"
API_PAGE_SIZE = 100
API_MAX_PAGES = 10  # v4: page 1..10
# TR arama yolu doğrulanamadı; sırayla denenir, kart dönen ilk yol kullanılır.
HTML_PATHS = ("/arama/is-ilanlari", "/arama/ilanlar", "/search/jobs")
_ID = re.compile(r"/jobad/([A-Za-z0-9]+)")


def api_key() -> str:
    return env("CAREERJET_API_KEY") or env("CAREERJET_AFFID")


def _date(s) -> str | None:
    if not s:
        return None
    try:
        return parsedate_to_datetime(str(s)).date().isoformat()  # "Tue, 14 Oct 2026 08:00:00 GMT"
    except (TypeError, ValueError, IndexError):
        return parse_any_date(str(s)) or parse_tr_relative_date(str(s))


def api_job_to_job(d: dict) -> Job | None:
    title = clean(d.get("title"))
    url = clean(d.get("url"))
    if not title or not url:
        return None
    locs = d.get("locations")
    if isinstance(locs, list):
        locs = " | ".join(clean(x if isinstance(x, str) else (x or {}).get("name", "")) for x in locs)
    salary = clean(d.get("salary"))
    if not salary and (d.get("salary_min") or d.get("salary_max")):
        salary = clean(f"{d.get('salary_min') or ''}-{d.get('salary_max') or ''} {d.get('salary_currency_code') or ''}")
    extra = {"site": clean(d.get("site"))} if d.get("site") else {}
    return Job(
        source=NAME,
        source_type=PLATFORM,
        external_id=url.split("?")[0],
        title=title,
        company=clean(d.get("company")),
        url=url,
        location=clean(locs),
        posted_at=_date(d.get("date")),
        description=strip_html(d.get("description", "")),
        salary=salary,
        extra=extra,
    )


def _user_ip(ctx: FetchContext) -> str:
    ip = env("CAREERJET_USER_IP")
    if ip:
        return ip
    try:
        return ctx.http.get("https://api.ipify.org").strip()
    except Exception:  # noqa: BLE001
        return ""


def api_url(params: dict, page: int, user_ip: str) -> str:
    q = {
        "locale_code": params.get("locale_code", "tr_TR"),
        "location": params.get("location", "İstanbul"),
        "keywords": params.get("keywords", ""),
        "sort": "date",
        "page": page,
        "page_size": API_PAGE_SIZE,
        "user_ip": user_ip,
        "user_agent": USER_AGENTS[0],
    }
    return API_URL + "?" + urlencode(q)


def _fetch_api(src: Source, ctx: FetchContext, key: str) -> Iterator[Job]:
    auth = base64.b64encode(f"{key}:".encode()).decode()
    headers = {"Authorization": f"Basic {auth}", "Accept": "application/json",
               "Referer": env("CAREERJET_REFERER", BASE + "/")}
    ip = _user_ip(ctx)
    seen: set[str] = set()
    for page in range(1, min(ctx.max_pages, API_MAX_PAGES) + 1):
        if not ctx.time_left():
            return
        data = ctx.http.get_json(api_url(src.params, page, ip), headers=headers)
        if data.get("type") == "LOCATIONS":
            raise RuntimeError(f"Careerjet konum belirsiz: {data.get('message')} {str(data.get('locations'))[:200]}")
        if data.get("type") not in (None, "JOBS"):
            raise RuntimeError(f"Careerjet API yanıtı: {str(data)[:200]}")
        new = 0
        for d in data.get("jobs") or []:
            j = api_job_to_job(d)
            if j and j.external_id not in seen:
                seen.add(j.external_id)
                new += 1
                yield j
        pages = data.get("pages")
        if not new or (isinstance(pages, int) and page >= pages):
            return


# ------------------------------------------------------------------ HTML yolu
def parse_html_page(html: str) -> list[Job]:
    root = parse_html(html)
    jobs: list[Job] = []
    for art in root.find_all("article", cls="job"):
        a = None
        h2 = art.find("h2")
        if h2 is not None:
            a = h2.find("a")
        href = art.get("data-url") or (a.get("href") if a is not None else "")
        title = clean((a or h2).text()) if (a or h2) is not None else ""
        if not href or not title:
            continue
        url = abs_url(BASE, href)
        m = _ID.search(url)
        comp = art.find("p", cls="company")
        locs = [clean(li.text()) for ul in art.find_all("ul", cls="location") for li in ul.find_all("li")]
        sal = art.find("ul", cls="salary")
        desc = art.find("div", cls="desc")
        date_txt = ""
        footer = art.find("footer")
        for b in (footer or art).find_all("span", cls="badge"):
            t = clean(b.text())
            if parse_tr_relative_date(t):
                date_txt = t
                break
        jobs.append(Job(
            source=NAME,
            source_type=PLATFORM,
            external_id=m.group(1) if m else url,
            title=title,
            company=clean(comp.text()) if comp is not None else "",
            url=url,
            location=", ".join(x for x in locs if x),
            posted_at=parse_tr_relative_date(date_txt) if date_txt else None,
            description=clean(desc.text()) if desc is not None else "",
            salary=clean(sal.text()) if sal is not None else "",
        ))
    return jobs


def html_url(path: str, params: dict, page: int) -> str:
    q = {"s": params.get("keywords", ""), "l": params.get("location", "İstanbul"), "sort": "date"}
    if page > 1:
        q["p"] = page
    return BASE + path + "?" + urlencode(q)


def _fetch_html(src: Source, ctx: FetchContext) -> Iterator[Job]:
    paths = [src.params["path"]] if src.params.get("path") else list(HTML_PATHS)
    path, first, last_err, blocked = None, [], None, False
    for cand in paths:
        try:
            html = ctx.http.get(html_url(cand, src.params, 1))
        except HttpError as e:
            last_err = e
            if e.status not in (404, 410):
                raise
            continue
        first = parse_html_page(html)
        if first:
            path = cand
            break
        blocked = blocked or looks_blocked(html)
    if path is None:
        if blocked:
            raise RuntimeError("careerjet: bot koruması (Cloudflare) — CAREERJET_API_KEY tanımlayın "
                               "veya --browser ile deneyin")
        if last_err:
            raise last_err
        return
    seen: set[str] = set()
    jobs, page = first, 1
    while True:
        new = [j for j in jobs if j.external_id not in seen]
        if not new:
            return
        for j in new:
            seen.add(j.external_id)
            yield j
        page += 1
        if page > ctx.max_pages or not ctx.time_left():
            return
        jobs = parse_html_page(ctx.http.get(html_url(path, src.params, page)))


def fetch(src: Source, ctx: FetchContext) -> Iterator[Job]:
    key = api_key()
    if key:
        yield from _fetch_api(src, ctx, key)
    else:
        ctx.log.info("careerjet: CAREERJET_API_KEY yok; HTML arama sayfası taranıyor")
        yield from _fetch_html(src, ctx)


def sources() -> list[Source]:
    return [Source(
        name=NAME,
        source_type=PLATFORM,
        label="Careerjet",
        homepage=BASE + "/arama/is-ilanlari?l=%C4%B0stanbul",
        fetcher=fetch,
    )]
