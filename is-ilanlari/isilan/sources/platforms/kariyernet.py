"""Kariyer.net — Türkiye'nin en büyük iş ilanı sitesi.

Liste sayfası:  https://www.kariyer.net/is-ilanlari/istanbul        (1. sayfa)
                https://www.kariyer.net/is-ilanlari/istanbul?cp=N   (N. sayfa, ~50 kart)

Site Nuxt ile sunucu tarafında render edilir; her ilan kartı verisini HTML
özniteliklerinde taşır (öznitelik adları ayrıştırıcıda küçük harfe iner):

    <div data-test="ad-card" positionname="..." positionid="..." companyid="..."
         cityid="34" cityname="İstanbul(Avr.)" countryname="Türkiye"
         worktypeid="F" worktypetext="Tam zamanlı" workmodeltext="İş Yerinde"
         sectorid="..." sectorname="..." jobcode="..." time="3 gün" jobdatestatus="Updated" ...>
      <a data-test="ad-card-item" href="/is-ilani/<firma>-<pozisyon>-<id>">
        <img data-test="company-image" alt="<Firma adı>" src="...">
        <span data-test="ad-card-title">Pozisyon</span>
        <span data-test="subtitle">Firma</span>
        <span data-test="location">Kadıköy</span>   (ya da "İstanbul(Asya)", "İstanbul(Avr.) +2 il daha")
        ...

İç JSON API'si bulunamadı (sayfa geçişleri sıradan URL gezinmesi; ağ trafiği analitik
ve PerimeterX ölçüm istekleri). Sitede PerimeterX bot koruması vardır: düz HTTP
istekleri "basılı tutun" doğrulama sayfası alabilir. Bu durumda açık bir hata
fırlatılır; `--browser` ile Playwright yedeği devreye girer (BrowserHttp).
Kartlarda kart yoksa JSON-LD (JobPosting/ItemList) yedeği denenir.
"""
from __future__ import annotations

import re
from typing import Iterator

from ...jsonld import extract_jobpostings, jobposting_to_job
from ...models import PLATFORM, Job
from ...text import clean
from ..base import FetchContext, Source
from ._util import abs_url, parse_html, parse_tr_relative_date

NAME = "kariyernet"
BASE = "https://www.kariyer.net"
LIST_URL = BASE + "/is-ilanlari/istanbul"

_ID = re.compile(r"-(\d+)/?(?:[?#].*)?$")
_SIDE = re.compile(r"\((Avr\.?|Avrupa|Asya|Anadolu)\)", re.I)
_MORE = re.compile(r"\+\s*\d+\s*(il|ilçe|şehir)\s*daha", re.I)
_BLOCK_MARKERS = ("px-captcha", "_pxappid", "perimeterx", "basılı tut", "basili tut",
                  "press & hold", "press and hold")

_WORK_MODEL = {"uzaktan": "remote", "remote": "remote", "hibrit": "hybrid", "hybrid": "hybrid",
               "iş yerinde": "onsite", "is yerinde": "onsite", "ofiste": "onsite"}


def page_url(page: int, base: str = LIST_URL) -> str:
    return base if page <= 1 else f"{base}{'&' if '?' in base else '?'}cp={page}"


def _work_model(text: str) -> str:
    t = (text or "").lower()
    for k, v in _WORK_MODEL.items():
        if k in t:
            return v
    return ""


def _side(text: str) -> str:
    m = _SIDE.search(text or "")
    if not m:
        return ""
    return "Anadolu" if m.group(1).lower() in ("asya", "anadolu") else "Avrupa"


def _txt(card, sel: str) -> str:
    el = card.find(attrs={"data-test": sel})
    return clean(el.text()) if el is not None else ""


def parse_cards(html: str) -> list[Job]:
    root = parse_html(html)
    jobs: list[Job] = []
    for card in root.find_all(attrs={"data-test": "ad-card"}):
        link = card.find("a", attrs={"data-test": "ad-card-item"}) or card.find("a", attrs={"href": re.compile(r"/is-ilani/")})
        if card.tag == "a" and not link:
            link = card
        href = (link.get("href") if link is not None else "") or ""
        if not href:
            continue
        url = abs_url(BASE, href).split("?")[0]
        m = _ID.search(url)
        ext_id = m.group(1) if m else (card.get("jobcode") or card.get("positionid") or url)
        title = _txt(card, "ad-card-title") or clean(card.get("positionname"))
        if not title:
            continue
        img = card.find("img", attrs={"data-test": "company-image"})
        company = clean(img.get("alt")) if img is not None else ""
        if not company or company.lower() in ("logo", "firma logosu"):
            company = _txt(card, "subtitle") or company
        # Konum: kartta görünen metin (ilçe varsa ilçe; çok şehirli ilanlarda "+N il daha")
        visible = _txt(card, "location")
        city = clean(card.get("cityname"))
        town = clean(card.get("townname") or card.get("districtname") or card.get("countyname"))
        parts: list[str] = []
        for part in (town, visible, city):
            if part and all(part.lower() not in p.lower() for p in parts):
                parts.append(part)
        location = ", ".join(parts)
        cand = town or (visible if visible and not _SIDE.search(visible) and "istanbul" not in visible.lower()
                        and "i̇stanbul" not in visible.lower() and not _MORE.search(visible) else "")
        extra: dict = {}
        if cand:
            extra["district_raw"] = cand
        side = _side(visible) or _side(city)
        if side:
            extra["side"] = side
        if _MORE.search(visible):
            extra["multi_city"] = True
        status = (card.get("jobdatestatus") or "").strip()
        if status:
            extra["date_status"] = status  # "Updated": tarih güncellenme anıdır
        for k in ("companyid", "positionid", "sectorname"):
            if card.get(k):
                extra[k] = clean(card.get(k))
        time_text = card.get("time") or _txt(card, "ad-date-info") or _txt(card, "date")
        posted = parse_tr_relative_date(time_text) if time_text else None
        jobs.append(Job(
            source=NAME,
            source_type=PLATFORM,
            external_id=str(ext_id),
            title=title,
            company=company,
            url=url,
            location=location,
            posted_at=posted,
            employment_type=clean(card.get("worktypetext")),
            work_model=_work_model(card.get("workmodeltext") or ""),
            category=clean(card.get("sectorname")),
            extra=extra,
        ))
    return jobs


def _jsonld_jobs(html: str) -> list[Job]:
    out = []
    for d in extract_jobpostings(html):
        j = jobposting_to_job(d, source=NAME, source_type=PLATFORM)
        if j.title and j.url:
            j.url = abs_url(BASE, j.url)
            m = _ID.search(j.url)
            if m:
                j.external_id = m.group(1)
            out.append(j)
    return out


def _blocked(html: str) -> bool:
    head = (html or "")[:20000].lower()
    return any(m in head for m in _BLOCK_MARKERS)


def fetch(src: Source, ctx: FetchContext) -> Iterator[Job]:
    base = src.params.get("url", LIST_URL)
    seen: set[str] = set()
    page = 1
    while page <= ctx.max_pages and ctx.time_left():
        html = ctx.http.get(page_url(page, base))
        jobs = parse_cards(html) or _jsonld_jobs(html)
        if not jobs:
            if _blocked(html):
                raise RuntimeError("kariyer.net bot koruması (PerimeterX) — düz HTTP engellendi; "
                                   "--browser ile deneyin")
            return
        new = [j for j in jobs if j.external_id not in seen]
        if not new:  # site son sayfadan sonra aynı sayfayı tekrar verebilir
            return
        for j in new:
            seen.add(j.external_id)
            yield j
        page += 1


def sources() -> list[Source]:
    return [Source(
        name=NAME,
        source_type=PLATFORM,
        label="Kariyer.net",
        homepage=LIST_URL,
        fetcher=fetch,
        # PerimeterX nedeniyle düz HTTP engellenebilir; yine de önce düz HTTP denenir,
        # --browser verilirse BrowserHttp engellenen sayfayı Playwright ile açar.
        needs_browser=False,
    )]
