"""LinkedIn — oturum açmadan erişilen "jobs-guest" uç noktası.

    GET https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search
        ?keywords=&location=Istanbul, Türkiye&geoId=90010422&start=N&sortBy=DD&f_TPR=r604800

Yanıt bir HTML parçasıdır: her ilan bir `<li>` içinde
`<div class="base-card ... base-search-card ..." data-entity-urn="urn:li:jobPosting:<id>">`
  - başlık   : h3.base-search-card__title
  - şirket   : h4.base-search-card__subtitle (> a.hidden-nested-link)
  - konum    : span.job-search-card__location        ("İstanbul, Türkiye", "Kadıköy, İstanbul, Türkiye")
  - tarih    : time.job-search-card__listdate[datetime="YYYY-MM-DD"]  ("3 gün önce")
               (yeni ilanlarda sınıf job-search-card__listdate--new)
  - maaş     : span.job-search-card__salary-info (nadiren)
  - bağlantı : a.base-card__full-link[href]

Notlar (python-jobspy ve açık kaynak tarayıcılarda gözlenen davranış):
- geoId=90010422 "Greater Istanbul" bölgesidir; yalnız `location=` metni misafirler için
  yok sayılabildiğinden geoId şarttır.
- Uç nokta istek başına ~10 kart döner (eskiden 25); `start` döndürülen kart sayısı kadar
  ilerletilir. LinkedIn misafirlere en fazla ~1000 sonuç verir.
- Çok hızlı istekte 429 / boş sayfa döner; sayfalar arasında rastgele bekleme yapılır.
"""
from __future__ import annotations

import random
import re
import time
from typing import Iterator
from urllib.parse import urlencode

from ...http import HttpError
from ...models import PLATFORM, Job
from ...text import clean, fold
from ..base import FetchContext, Source
from ._util import parse_html, parse_tr_relative_date

NAME = "linkedin"
BASE = "https://www.linkedin.com"
SEARCH = BASE + "/jobs-guest/jobs/api/seeMoreJobPostings/search"
GEO_ID_GREATER_ISTANBUL = "90010422"
MAX_RESULTS = 1000
EMPTY_PAGE = "<!DOCTYPE html>\n\n<!---->"

_URN_ID = re.compile(r"jobPosting:(\d+)")
_URN_RAW = re.compile(r"data-entity-urn=[\"']urn:li:jobPosting:\d+")
_VIEW_ID = re.compile(r"/jobs/view/(?:[^/?#]*-)?(\d{6,})")


def page_url(params: dict, start: int) -> str:
    q = {
        "keywords": params.get("keywords", ""),
        "location": params.get("location", "Istanbul, Türkiye"),
        "geoId": params.get("geoId", GEO_ID_GREATER_ISTANBUL),
        "sortBy": params.get("sortBy", "DD"),  # DD = en yeni önce
    }
    if not q["geoId"]:
        del q["geoId"]
    if params.get("f_TPR"):
        q["f_TPR"] = params["f_TPR"]  # r86400 (24s), r604800 (hafta), r2592000 (ay)
    q["start"] = start
    return SEARCH + "?" + urlencode(q)


def _work_model(text: str) -> str:
    t = fold(text)
    if "remote" in t or "uzaktan" in t:
        return "remote"
    if "hybrid" in t or "hibrit" in t:
        return "hybrid"
    if "on site" in t or "is yerinde" in t:
        return "onsite"
    return ""


def parse_cards(html: str) -> list[Job]:
    """seeMoreJobPostings HTML parçasını Job listesine çevirir."""
    root = parse_html(html)
    jobs: list[Job] = []
    seen: set[str] = set()
    cards = root.find_all(attrs={"data-entity-urn": re.compile(r"jobPosting:\d+")})
    if not cards:  # bazı varyantlarda urn yalnızca bağlantıda olur
        cards = root.find_all(cls="base-search-card")
    for card in cards:
        m = _URN_ID.search(card.get("data-entity-urn", ""))
        link = card.find("a", cls="base-card__full-link")
        if link is None and card.tag == "a":
            link = card
        href = (link.get("href") if link else "") or ""
        job_id = m.group(1) if m else ""
        if not job_id:
            m2 = _VIEW_ID.search(href)
            job_id = m2.group(1) if m2 else ""
        if not job_id or job_id in seen:
            continue
        title_el = card.find("h3", cls="base-search-card__title")
        title = clean(title_el.text()) if title_el else ""
        if not title:
            sr = card.find("span", cls="sr-only")
            title = clean(sr.text()) if sr else ""
        if not title:
            continue
        seen.add(job_id)
        comp_el = card.find("h4", cls="base-search-card__subtitle")
        company = clean(comp_el.text()) if comp_el else ""
        loc_el = card.find("span", cls="job-search-card__location")
        location = clean(loc_el.text()) if loc_el else ""
        time_el = card.find("time")
        posted = None
        if time_el is not None:
            dt = (time_el.get("datetime") or "").strip()
            posted = parse_tr_relative_date(dt) if dt else None
            posted = posted or parse_tr_relative_date(time_el.text())
        sal_el = card.find("span", cls="job-search-card__salary-info")
        extra = {}
        comp_link = comp_el.find("a") if comp_el else None
        if comp_link is not None and comp_link.get("href"):
            extra["company_url"] = comp_link.get("href").split("?")[0]
        jobs.append(Job(
            source=NAME,
            source_type=PLATFORM,
            external_id=job_id,
            title=title,
            company=company,
            url=f"{BASE}/jobs/view/{job_id}/",
            location=location,
            posted_at=posted,
            work_model=_work_model(location),
            salary=clean(sal_el.text()) if sal_el else "",
            extra=extra,
        ))
    return jobs


def _district_queries(p: dict) -> list[dict]:
    """Tek arama ~1000 sonuçla sınırlı; İstanbul geneli sınıra takılırsa ilçe ilçe aranır."""
    from ...geo import DISTRICTS

    out = []
    for d in DISTRICTS:
        q = {k: v for k, v in p.items() if k not in ("geoId", "location")}
        q["location"] = f"{d}, İstanbul, Türkiye"
        q["geoId"] = ""
        out.append(q)
    return out


def fetch(src: Source, ctx: FetchContext) -> Iterator[Job]:
    seen: set[str] = set()
    capped = yield from _fetch_query(src.params, ctx, seen)
    if capped and src.params.get("split_districts", True):
        ctx.log.info("linkedin: İstanbul geneli %s sonuç sınırına ulaştı, ilçe bazında aranıyor", MAX_RESULTS)
        yield from _fetch_districts(src.params, ctx, seen)


def _fetch_districts(p: dict, ctx: FetchContext, seen: set[str]) -> Iterator[Job]:
    """İlçeleri sırayla arar. Süre ya da LinkedIn kısıtı yetmezse kalınan ilçe kaydedilir ve sonraki
    tarama oradan devam eder: ilçeler birkaç taramaya yayılır, son ilçeler hiç atlanmaz."""
    qs = _district_queries(p)
    idx = int(ctx.state.get("district", 0)) % len(qs) if ctx.state is not None else 0
    try:
        for _ in range(len(qs)):
            if not ctx.time_left():
                ctx.mark_partial("linkedin süre doldu (ilçe aramaları)")
                return
            try:
                yield from _fetch_query(qs[idx], ctx, seen)
            except HttpError as e:
                ctx.log.warning("linkedin: %s araması alınamadı (%s)", qs[idx]["location"], e.status)
                ctx.mark_partial("linkedin ilçe araması")
                idx = (idx + 1) % len(qs)  # bu ilçe bu turda atlanır, sıra bir sonrakine geçer
                return
            if not ctx.time_left():  # ilçe yarıda kaldı: sıra değişmez, sonraki taramada baştan
                ctx.mark_partial("linkedin süre doldu (ilçe aramaları)")
                return
            idx = (idx + 1) % len(qs)
    finally:
        if ctx.state is not None:
            ctx.state.set("district", idx)


def _fetch_query(p: dict, ctx: FetchContext, seen: set[str]):
    """Bir arama sorgusunu sayfa sayfa tarar; sonuç sınırına takıldıysa True döner."""
    delay = float(p.get("delay", 2.0))
    max_results = int(p.get("max_results", MAX_RESULTS))
    headers = {"Accept": "text/html,*/*;q=0.8"}
    start, page, stale = 0, 0, 0
    while start < max_results and page < ctx.max_pages and ctx.time_left():
        if page and delay > 0:
            time.sleep(random.uniform(delay, delay * 2))
        url = page_url(p, start)
        try:
            html = ctx.http.get(url, headers=headers)
        except HttpError as e:
            if page == 0:
                raise
            # 429 / 999: LinkedIn kısıtlaması — elde edilenlerle yetin
            ctx.log.warning("linkedin: start=%s alınamadı (%s); tarama burada kesildi", start, e.status)
            ctx.mark_partial(f"linkedin start={start}")
            return False
        page += 1
        cards = parse_cards(html)
        if not cards:
            if html.strip() and html.strip() != EMPTY_PAGE and "base-card" not in html and page == 1:
                ctx.log.warning("linkedin: beklenmeyen yanıt (engellenmiş olabilir)")
            return False
        new = [j for j in cards if j.external_id not in seen]
        if not new:
            # sayfalar kısmen örtüşebilir; art arda iki "yenisiz" sayfada dur
            stale += 1
            if stale >= 2:
                return False
        else:
            stale = 0
        for j in new:
            seen.add(j.external_id)
            yield j
        # LinkedIn sayfa başına ~10 kart döner; ham kart sayısı kadar ilerle
        start += max(len(cards), len(_URN_RAW.findall(html)))
    if start >= max_results:  # LinkedIn'in misafir sonuç sınırı: daha fazla ilan olabilir
        return True
    if page >= ctx.max_pages:
        ctx.mark_partial("linkedin max_pages")
    return False


def sources() -> list[Source]:
    return [Source(
        name=NAME,
        source_type=PLATFORM,
        label="LinkedIn",
        homepage="https://www.linkedin.com/jobs/search?location=Istanbul&geoId=" + GEO_ID_GREATER_ISTANBUL,
        fetcher=fetch,
        params={"f_TPR": "r2592000", "timeout": 1500},  # son 30 gün; ilçe aramaları birkaç taramaya yayılır
    )]
