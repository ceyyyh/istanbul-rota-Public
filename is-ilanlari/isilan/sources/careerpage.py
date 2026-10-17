"""Genel kariyer sayfası tarayıcısı.

Şirketin (ya da İK firmasının) ilan listesi sayfasını açar, ilan detay bağlantılarını
toplar ve detay sayfalarındaki schema.org JobPosting JSON-LD verisini okur. Sayfa
bilinen bir ATS'ye (Greenhouse, Lever, Workable ...) bağlanıyorsa doğrudan o ATS'nin
API'sine devreder — bu hem daha hızlı hem daha güvenilirdir.

params: careers_url (zorunlu), company, link_pattern (regex), page_param, max_list_pages,
        max_jobs, sitemap
"""
from __future__ import annotations

import re
from typing import Iterator
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse

from ..jsonld import extract_jobpostings, jobposting_to_job
from ..models import COMPANY, Job
from ..text import clean, fold, strip_html
from .base import FetchContext, Source

_HREF = re.compile(r"""<a\b[^>]*?href\s*=\s*["']([^"'#]+)["']""", re.I)
_SRC = re.compile(r"""<(?:iframe|script)\b[^>]*?src\s*=\s*["']([^"']+)["']""", re.I)
_LOC = re.compile(r"<loc>\s*([^<\s]+)\s*</loc>", re.I)
_TITLE = re.compile(r"<h1\b[^>]*>(.*?)</h1>", re.I | re.S)
_OG_TITLE = re.compile(r"""<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)""", re.I)
_BODY = re.compile(r"<body\b.*?</body>", re.I | re.S)
_SCRIPTS = re.compile(r"<(script|style|noscript)\b.*?</\1>", re.I | re.S)

# Detay sayfası olması muhtemel yollar
_JOB_PATH = re.compile(
    r"(/jobs?/|/job-|/is-ilan|/ilan/|/ilanlar/|/pozisyon|/position|/vacanc|/opening|/requisition|"
    r"/acik-pozisyon|/kariyer/.+/.+|/careers?/.+/.+|/apply/|[?&](job|jobid|job_id|id|ilanid|reqid)=)",
    re.I,
)
_SKIP_PATH = re.compile(r"(login|signin|sign-in|register|kayit|uye|privacy|gizlilik|kvkk|cookie|\.pdf$|\.jpg$|\.png$|mailto:|tel:|javascript:)", re.I)

# Gömülü ATS tespiti: (regex, ats, parametre üretici)
_ATS_PATTERNS = [
    (re.compile(r"(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io/(?:embed/job_board\?for=)?([A-Za-z0-9_-]+)"), "greenhouse"),
    (re.compile(r"boards-api\.greenhouse\.io/v1/boards/([A-Za-z0-9_-]+)"), "greenhouse"),
    (re.compile(r"jobs\.eu\.lever\.co/([A-Za-z0-9_.-]+)"), "lever-eu"),
    (re.compile(r"jobs\.lever\.co/([A-Za-z0-9_.-]+)"), "lever"),
    (re.compile(r"apply\.workable\.com/(?:api/v\d/(?:widget/)?accounts/)?([A-Za-z0-9_-]+)"), "workable"),
    (re.compile(r"jobs\.smartrecruiters\.com/([A-Za-z0-9_-]+)"), "smartrecruiters"),
    (re.compile(r"jobs\.ashbyhq\.com/([A-Za-z0-9_.-]+)"), "ashby"),
    (re.compile(r"([A-Za-z0-9-]+)\.recruitee\.com"), "recruitee"),
    (re.compile(r"([A-Za-z0-9-]+)\.breezy\.hr"), "breezy"),
    (re.compile(r"([A-Za-z0-9-]+)\.jobs\.personio\.(?:de|com)"), "personio"),
]
_ATS_SLUG_STOP = {"embed", "api", "v1", "jobs", "www", "j", "app", "assets", "static", "widget", "careers"}


def detect_ats(html: str) -> list[tuple[str, str]]:
    """Sayfa kaynağında geçen ATS panolarını (ats, slug) olarak döner."""
    found: list[tuple[str, str]] = []
    for rx, ats in _ATS_PATTERNS:
        for slug in rx.findall(html):
            if slug.lower() in _ATS_SLUG_STOP:
                continue
            item = (ats, slug)
            if item not in found:
                found.append(item)
    return found


def _same_site(a: str, b: str) -> bool:
    ha, hb = urlparse(a).netloc.lower(), urlparse(b).netloc.lower()
    root = lambda h: ".".join(h.split(".")[-3:]) if h.endswith((".com.tr", ".org.tr", ".gov.tr", ".net.tr")) else ".".join(h.split(".")[-2:])  # noqa: E731
    return root(ha) == root(hb)


def _with_page(url: str, param: str, page: int) -> str:
    u = urlparse(url)
    q = dict(parse_qsl(u.query))
    q[param] = str(page)
    return urlunparse(u._replace(query=urlencode(q)))


def collect_job_links(html: str, base_url: str, link_pattern: str | None = None) -> list[str]:
    rx = re.compile(link_pattern) if link_pattern else None
    out: list[str] = []
    base_norm = base_url.rstrip("/")
    for href in _HREF.findall(html):
        url = urljoin(base_url, clean(href))
        if not url.startswith("http") or _SKIP_PATH.search(url) or url.rstrip("/") == base_norm:
            continue
        if rx:
            if not rx.search(url):
                continue
        elif not (_same_site(url, base_url) and _JOB_PATH.search(urlparse(url).path + "?" + urlparse(url).query)):
            continue
        if url not in out:
            out.append(url)
    return out


def _heuristic_job(html: str, url: str, src: Source) -> Job | None:
    """JSON-LD olmayan detay sayfası için en iyi tahmin: başlık + İstanbul geçiyorsa konum."""
    from ..geo import detect_district, is_istanbul

    m = _TITLE.search(html) or _OG_TITLE.search(html)
    if not m:
        return None
    title = strip_html(m.group(1), 200)
    body = _BODY.search(html)
    text = strip_html(_SCRIPTS.sub(" ", body.group(0) if body else html), 4000)
    if not title or not is_istanbul(text):
        return None
    district = detect_district(text)
    return Job(source=src.name, source_type=src.source_type, external_id=url, title=title,
               company=src.params.get("company") or src.label, url=url,
               location=f"{district}, İstanbul" if district else "İstanbul",
               description=text[:1000], extra={"parsed": "heuristic"})


def _delegate_to_ats(ats: str, slug: str, src: Source, ctx: FetchContext) -> Iterator[Job]:
    from . import ats as ats_mod

    region = None
    if ats == "lever-eu":
        ats, region = "lever", "eu"
    fn = getattr(ats_mod, f"fetch_{ats}", None)
    if fn is None:
        return iter(())
    params = {"company": src.params.get("company") or src.label, "slug": slug, "ats": ats}
    if region:
        params["region"] = region
    sub = Source(name=src.name, source_type=src.source_type, label=src.label, fetcher=fn,
                 homepage=src.homepage, params=params)
    return fn(sub, ctx)


def fetch_careerpage(src: Source, ctx: FetchContext) -> Iterator[Job]:
    p = src.params
    list_url = p["careers_url"]
    company = p.get("company") or src.label
    max_jobs = int(p.get("max_jobs", 200))
    max_list_pages = int(p.get("max_list_pages", 1 if not p.get("page_param") else min(ctx.max_pages, 20)))

    detail_links: list[str] = []
    seen_ids: set[str] = set()
    delegate_err: Exception | None = None
    yielded = 0
    for page in range(1, max_list_pages + 1):
        url = _with_page(list_url, p["page_param"], page) if p.get("page_param") and page > 1 else list_url
        html = ctx.http.get(url)
        if page == 1 and not p.get("no_ats_detect"):
            embedded = detect_ats(html)
            if embedded:
                ctx.log.info("%s: gömülü ATS bulundu %s", src.name, embedded)
                ok = 0
                for ats, slug in embedded[:3]:
                    # Tespit edilen slug yanlış olabilir (ör. altbilgideki başka bir panoya bağlantı):
                    # bir ATS'nin hatası diğerlerini ve sayfanın kendi taramasını engellemesin.
                    try:
                        for job in _delegate_to_ats(ats, slug, src, ctx):
                            yielded += 1
                            yield job
                        ok += 1
                    except Exception as e:  # noqa: BLE001
                        delegate_err = e
                        ctx.mark_partial(f"{src.name}: {ats}/{slug} başarısız ({e})")
                if ok:
                    return
                ctx.log.info("%s: gömülü ATS'ler okunamadı; sayfa taranıyor", src.name)
        # Liste sayfasının kendisi JobPosting içeriyorsa
        for d in extract_jobpostings(html):
            job = jobposting_to_job(d, source=src.name, source_type=src.source_type, url=url, company=company)
            if job.external_id not in seen_ids:
                seen_ids.add(job.external_id)
                yielded += 1
                yield job
        new = [u for u in collect_job_links(html, url, p.get("link_pattern")) if u not in detail_links]
        detail_links.extend(new)
        if not new or not ctx.time_left():
            break
    else:
        if max_list_pages > 1:
            ctx.mark_partial(f"{src.name}: max_list_pages={max_list_pages}")

    if p.get("sitemap"):
        try:
            xml = ctx.http.get(p["sitemap"])
            rx = re.compile(p["link_pattern"]) if p.get("link_pattern") else _JOB_PATH
            detail_links.extend(u for u in _LOC.findall(xml) if rx.search(u) and u not in detail_links)
        except Exception as e:  # noqa: BLE001
            ctx.log.warning("%s: sitemap okunamadı: %s", src.name, e)

    if len(detail_links) > max_jobs:
        ctx.mark_partial(f"{src.name}: max_jobs={max_jobs}")
    for link in detail_links[:max_jobs]:
        if not ctx.time_left():
            break
        try:
            html = ctx.http.get(link)
        except Exception as e:  # noqa: BLE001
            ctx.log.debug("%s: %s atlandı (%s)", src.name, link, e)
            continue
        postings = extract_jobpostings(html)
        if postings:
            for d in postings:
                job = jobposting_to_job(d, source=src.name, source_type=src.source_type, url=link, company=company)
                job.url = job.url if job.url.startswith("http") else link
                if job.external_id not in seen_ids:
                    seen_ids.add(job.external_id)
                    yielded += 1
                    yield job
        else:
            job = _heuristic_job(html, link, src)
            if job and job.external_id not in seen_ids:
                seen_ids.add(job.external_id)
                yielded += 1
                yield job
    if delegate_err is not None and not yielded:
        raise delegate_err  # ne ATS ne sayfa ilan verdi: kaynak "hatalı" görünsün


def make_source(entry: dict, source_type: str = COMPANY) -> Source:
    name = entry.get("name") or "careerpage:" + (fold(entry["company"]).replace(" ", "-") or urlparse(entry["careers_url"]).netloc)
    return Source(name=name, source_type=entry.get("source_type", source_type), label=entry["company"],
                  fetcher=fetch_careerpage, homepage=entry["careers_url"], params=dict(entry),
                  enabled=entry.get("enabled", True))


def sources() -> list[Source]:
    from .registry import load_registry

    return [make_source(e) for e in load_registry() if e.get("ats") == "careerpage" and e.get("careers_url")]
