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
istekleri "basılı tutun" doğrulama sayfası ya da 403 alabilir. Tarama ilk engelde durur ve
kaldığı yeri saklar (aşağıdaki "kibar tarama" bölümü); yalnızca ilk sayfa engellenirse hata
fırlatılır. `--gorunur` ile kullanıcının kendi tarayıcı oturumu (BrowserHttp) kullanılabilir.
Kartlarda kart yoksa JSON-LD (JobPosting/ItemList) yedeği denenir.
"""
from __future__ import annotations

import random
import re
import time
from typing import Iterator

from ...db import now_iso
from ...http import HttpError
from ...jsonld import extract_jobpostings, jobposting_to_job
from ...models import PLATFORM, Job
from ...text import clean, fold
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
               "is yerinde": "onsite", "ofiste": "onsite", "on site": "onsite"}


def page_url(page: int, base: str = LIST_URL) -> str:
    return base if page <= 1 else f"{base}{'&' if '?' in base else '?'}cp={page}"


def _work_model(text: str) -> str:
    t = fold(text or "")
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


# ---------------------------------------------------------------- kibar, kaldığı yerden süren tarama
#
# Gözlem (GitHub Actions, Ekim 2026): ~1 istek/sn hızla 1–22. sayfalar sorunsuz geldi, 23. sayfadan
# itibaren HTTP 403 (PerimeterX). Engel mutlak değil, hız/hacim kaynaklı. Bu yüzden:
#   * sayfalar arası 4–8 sn rastgele bekleme ve her `break_every` sayfada uzun mola,
#   * ilk engelde hemen DUR (yeniden deneme, tarayıcı hilesi, CAPTCHA çözme yok), o ana kadar
#     toplananları koru, taramayı "eksik" işaretle (pipeline yalnızca 7 gündür görünmeyenleri kaldırır),
#   * kaldığı yeri veritabanına yaz (ctx.state, "kariyernet:cursor"); sonraki tarama oradan sürer.
#
# Her tarama: (1) /is-ilanlari/istanbul'un ilk `refresh_pages` sayfası (liste en yeni ilan önde gelir;
# gerçek veritabanında 22 sayfa ≈ son 5 günün ilanları), (2) imleçten devam eden derin tarama
# (`deep_pages` sayfa bütçesi). Derin tarama bölümlere ayrılır:
#   - ilçe bölümleri  /is-ilanlari/istanbul+asya-kadikoy, /is-ilanlari/istanbul+avrupa-besiktas ...
#   - yaka bölümleri  /is-ilanlari/istanbul+asya, /is-ilanlari/istanbul+avrupa
# Kanıt (web araması, 2026-10-17): arama motoru dizininde şu adresler var: istanbul+asya,
# istanbul+avrupa ("100 sayfa", ~8.814 ilan → liste 100 sayfada kesiliyor; tek liste tüm İstanbul'u
# veremez), istanbul+asya-kadikoy (13 sayfa), -umraniye (15 sayfa), -atasehir, -tuzla,
# istanbul+avrupa-esenyurt, -besiktas, -avcilar. Bu ilçeler _VERIFIED'dadır: sayfadaki ilanlara ilçe
# doğrudan atanır (yüksek güven). Diğer ilçelerin adresi aynı kalıpla türetildi (orta güven): aynı
# yapıdaki "istanbul+asya-egitim", "istanbul+avrupa-hizmet" gibi adresler anahtar kelime araması
# olduğundan, tanınmayan bir ilçe adı ilçe süzgeci yerine metin araması olabilir. Bu yüzden türetilmiş
# bölümler yalnızca kapsama için taranır, ilçe ATANMAZ. Tarih sıralaması için belgelenmiş bir URL
# parametresi bulunamadı (kullanılmadı). robots.txt/site haritası için kanıt bulunamadı; ilan detay
# sayfaları da aynı PerimeterX korumasının arkasında olduğundan site haritası geçişi eklenmedi.

_VERIFIED = {("asya", "Kadıköy"), ("asya", "Ümraniye"), ("asya", "Ataşehir"), ("asya", "Tuzla"),
             ("avrupa", "Esenyurt"), ("avrupa", "Beşiktaş"), ("avrupa", "Avcılar")}


def _slug(name: str) -> str:
    return fold(name).replace(" ", "")


def segments() -> list[dict]:
    """Derin tarama bölümleri, sırayla: önce doğrulanmış ilçeler, sonra türetilmiş ilçeler, en son yakalar."""
    from ...geo import _ANADOLU, _AVRUPA

    ver, inf = [], []
    for side, names in (("asya", _ANADOLU), ("avrupa", _AVRUPA)):
        for n in names:
            seg = {"key": f"istanbul+{side}-{_slug(n)}", "district": n if (side, n) in _VERIFIED else None}
            (ver if seg["district"] else inf).append(seg)
    return ver + inf + [{"key": "istanbul+asya", "district": None}, {"key": "istanbul+avrupa", "district": None}]


def seg_url(key: str) -> str:
    return f"{BASE}/is-ilanlari/{key}"


class _Blocked(Exception):
    pass


class _Crawler:
    def __init__(self, src: Source, ctx: FetchContext):
        p = src.params
        self.ctx = ctx
        self.lo = float(p.get("delay_min", 4.0))
        self.hi = max(self.lo, float(p.get("delay_max", 8.0)))
        self.break_every = int(p.get("break_every", 20))
        self.break_s = (float(p.get("break_min", 45.0)), float(p.get("break_max", 90.0)))
        self.requests = 0
        self.seen: set[str] = set()
        self.yielded = 0

    def pause(self) -> None:
        if not self.requests:
            return
        if self.break_every and self.requests % self.break_every == 0:
            d = random.uniform(*self.break_s)
        else:
            d = random.uniform(self.lo, self.hi)
        if d > 0:
            time.sleep(d)

    def page(self, url: str) -> list[Job] | None:
        """Bir liste sayfası. None: liste bitti / sayfa yok. _Blocked: bot koruması."""
        self.pause()
        self.requests += 1
        try:
            html = self.ctx.http.get(url, retries=1)
        except HttpError as e:
            if e.status in (401, 403, 429, 503):
                raise _Blocked(f"HTTP {e.status}") from e
            if e.status == 404:
                return None
            raise
        jobs = parse_cards(html) or _jsonld_jobs(html)
        if not jobs and _blocked(html):
            raise _Blocked("doğrulama sayfası")
        return jobs or None

    def segment(self, base: str, start: int, budget: int, district: str | None, last_page: int,
                pos: dict) -> Iterator[Job]:
        """`start` sayfasından en çok `budget` sayfa. pos["page"]: sıradaki sayfa; pos["done"]: bölüm bitti."""
        page, prev = start, None
        pos.update(page=page, done=False)
        while budget > 0 and self.ctx.time_left():
            if page > last_page:
                pos["done"] = True
                return
            jobs = self.page(page_url(page, base))
            if not jobs:
                pos["done"] = True
                return
            ids = [j.external_id for j in jobs]
            if ids == prev:  # site son sayfadan sonra aynı sayfayı tekrar verebilir
                pos["done"] = True
                return
            prev = ids
            for j in jobs:
                if district and not j.extra.get("district_raw"):
                    j.district = district
                    j.extra["district_from"] = "segment"
                if j.external_id in self.seen and not (district and j.district == district):
                    continue
                self.seen.add(j.external_id)
                self.yielded += 1
                yield j
            page += 1
            budget -= 1
            pos["page"] = page


def fetch(src: Source, ctx: FetchContext) -> Iterator[Job]:
    p = src.params
    cr = _Crawler(src, ctx)
    state = ctx.state
    last_page = int(p.get("segment_max_pages", 100))  # site listeleri 100 sayfada kesiyor
    if state is None or p.get("url"):
        # Durumsuz kullanım (teşhis, testler, özel URL): tek liste, baştan, max_pages kadar
        refresh, deep = ctx.max_pages, 0
    else:
        refresh = min(int(p.get("refresh_pages", 3)), ctx.max_pages)
        # Derin tarama bütçesi: varsayılan, --max-pages'ten kalan; süre sınırı (ctx.time_left) ayrıca keser
        deep = max(0, min(int(p.get("deep_pages") or ctx.max_pages), ctx.max_pages - refresh))
    pos: dict = {}
    try:
        yield from cr.segment(p.get("url", LIST_URL), 1, refresh, None, max(refresh, last_page), pos)
        if not deep:
            return
        segs = segments()
        keys = [s["key"] for s in segs]
        cur = state.get("cursor") or {}
        i = keys.index(cur["seg"]) if cur.get("seg") in keys else 0
        page = int(cur.get("page") or 1) if cur.get("seg") in keys else 1
        try:
            while deep > 0 and ctx.time_left():
                seg = segs[i]
                before = cr.requests
                yield from cr.segment(seg_url(seg["key"]), page, deep, seg["district"], last_page, pos)
                deep -= cr.requests - before
                if not pos["done"]:
                    page = pos["page"]
                    break
                i, page = i + 1, 1
                if i >= len(segs):  # tam tur bitti: imleç başa
                    state.set("last_full_cycle", now_iso())
                    i = 0
                    break
        finally:
            if pos.get("page") and not pos.get("done"):
                page = pos["page"]
            state.set("cursor", {"seg": segs[i]["key"], "page": page, "at": now_iso()})
    except _Blocked as e:
        if not cr.yielded:
            raise RuntimeError(f"kariyer.net bot koruması (PerimeterX, {e}) — ilk sayfada engellendi; "
                               "sonraki taramada yeniden denenecek (ya da: crawl kariyernet --gorunur)") from None
        ctx.mark_partial(f"kariyer.net {cr.requests}. istekte engellendi ({e}); "
                         f"{cr.yielded} ilan alındı, kalan sonraki taramaya")
        return
    except HttpError as e:
        if not cr.yielded:
            raise
        ctx.mark_partial(f"kariyer.net hata ({e}); {cr.yielded} ilan alındı")
        return
    if state is not None and not p.get("url"):
        # Durumlu taramada tek çalıştırma sitenin yalnızca bir dilimini görür
        ctx.mark_partial("kariyer.net dilimli tarama")


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
