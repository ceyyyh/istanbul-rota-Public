"""İK / personel temin / işe alım danışmanlığı firmalarının kendi sitelerindeki ilanlar.

Yapı:
  * `AGENCIES`: firma yapılandırma tablosu (liste URL'leri, ilan-detay bağlantı deseni,
    sayfalama biçimi, kimlik deseni).
  * `fetch_listing_jsonld`: genel toplayıcı. Liste sayfasını (mümkünse sitenin kendi
    İstanbul filtresiyle) yükler, `link_pattern` ile eşleşen ilan-detay bağlantılarını
    toplar, her detay sayfasını ziyaret eder ve JobPosting JSON-LD'yi
    `jsonld.jobposting_to_job` ile eşler. JSON-LD yoksa sayfadaki başlık / etiketli
    "Lokasyon" alanından asgari bir ilan çıkarır (veri uydurmaz; konum bulunamazsa ilanı atlar).
  * `sources()`: `Source` listesi.

Desenler (Ekim 2026'da arama sonuçlarındaki gerçek URL'lerden çıkarıldı):
  Randstad   https://www.randstad.com.tr/is-ilanlari/istanbul-europe/            (liste, /page-2/)
             https://www.randstad.com.tr/is-ilanlari/marketing-specialist_sisliistanbul_46129455/
  MichaelPage https://www.michaelpage.com.tr/jobs/istanbul
             https://www.michaelpage.com.tr/en/job-detail/finance-manager/ref/jn-012025-6635724
  Adecco     https://www.adecco.com/tr-tr/is-bul/brandcommunication-section-leader-istanbul-istanbul/jn-042026-1019473
  Gi Group   https://tr.gigroup.com/pozisyonlar/marmara-re/istanbul-pr/          (İstanbul il listesi)
             https://tr.gigroup.com/is-ilanlari/sisli-istanbul-sigorta-saha-satis-temsilcisi/?jobid=24589
  Manpower   https://www.manpower.com.tr/en/jobs/industry/i%C5%9Fe-al%C4%B1m-dan%C4%B1%C5%9Fman%C4%B1/117992
             https://hr-link.net/customized/homepage/manpower/index.asp  ->  /Home/detail?id=...
"""
from __future__ import annotations

import html as _html
import re
from typing import Iterator
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse

from ..http import HttpError
from ..jsonld import extract_jobpostings, jobposting_to_job
from ..models import AGENCY, Job
from ..text import clean, fold, strip_html
from .base import FetchContext, Source

DEFAULT_MAX_JOBS = 300
DEFAULT_MAX_PAGES = 20


# --------------------------------------------------------------------------- #
# İstanbul süzgeci
# --------------------------------------------------------------------------- #
def _is_istanbul(text: str) -> bool:
    """geo.is_istanbul; modül henüz tamamlanmadıysa basit bir yedek kontrol."""
    from .. import geo  # geç içe aktarma: testlerde monkeypatch edilebilsin

    try:
        return bool(geo.is_istanbul(text))
    except NotImplementedError:
        return "istanbul" in fold(text)


# --------------------------------------------------------------------------- #
# Yardımcılar
# --------------------------------------------------------------------------- #
def _page_url(base: str, n: int, p: dict) -> str | None:
    """n. sayfanın URL'si (n=1 -> base). Sayfalama yoksa None."""
    if n == 1:
        return base
    style = p.get("page_style")
    if style == "path":  # .../istanbul-europe/page-2/
        fmt = p.get("page_fmt", "page/{n}/")
        return base.rstrip("/") + "/" + fmt.format(n=n)
    if style == "query":  # ...?page=2  (Drupal: ilk sayfa yok, ikinci sayfa page=1)
        value = n - 1 + int(p.get("page_base", 1))
        u = urlparse(base)
        q = [(k, v) for k, v in parse_qsl(u.query, keep_blank_values=True) if k != p.get("page_param", "page")]
        q.append((p.get("page_param", "page"), str(value)))
        return urlunparse(u._replace(query=urlencode(q)))
    return None


def _find_links(page_html: str, base_url: str, pattern: re.Pattern) -> list[str]:
    """Sayfa metninin tamamında (href, JSON, __NEXT_DATA__ ...) desene uyan detay bağlantıları."""
    txt = _html.unescape(page_html.replace("\\/", "/"))
    out, seen = [], set()
    for m in pattern.finditer(txt):
        url = urljoin(base_url, m.group(0))
        if url not in seen:
            seen.add(url)
            out.append(url)
    return out


_META = r"<meta[^>]+(?:property|name)=[\"']{}[\"'][^>]*content=[\"']([^\"']*)[\"']"
_OG_TITLE = re.compile(_META.format("og:title"), re.I)
_DESC = re.compile(_META.format("(?:og:)?description"), re.I)
_H1 = re.compile(r"<h1[^>]*>(.*?)</h1>", re.I | re.S)
_TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
# Etiketli konum alanı: "<dt>Lokasyon</dt><dd>Şişli, İstanbul</dd>", "Konum: Kadıköy / İstanbul" ...
_LOC_FIELD = re.compile(
    r">\s*(?:Lokasyon|Konum|Çalışma Yeri|Çalışma Lokasyonu|İş Yeri|Şehir|Location)"
    r"\s*(?::\s*(?:</[^>]+>\s*)*|(?:</[^>]+>\s*)+)(?:<[^>/][^>]*>\s*)*([^<>]{2,120})",
    re.I,
)


def _html_job(page: str, url: str, src: Source, anchor_title: str = "") -> Job | None:
    """JSON-LD olmayan detay sayfası için asgari ilan: başlık + etiketli konum alanı."""
    title = ""
    for rx in (_H1, _OG_TITLE, _TITLE):
        m = rx.search(page)
        if m and strip_html(m.group(1), None):
            title = strip_html(m.group(1), 300)
            break
    title = title or anchor_title
    m = _LOC_FIELD.search(page)
    location = clean(m.group(1)).strip(" :-|") if m else ""
    if not title or not location:
        return None
    d = _DESC.search(page)
    return Job(
        source=src.name, source_type=AGENCY, external_id=url, title=title,
        company=src.label, url=url, location=location,
        description=strip_html(d.group(1)) if d else "",
    )


def _finish(job: Job, src: Source, ext_id: str | None, list_loc: str, page_url: str) -> Job | None:
    job.url = urljoin(page_url, job.url) if job.url else page_url
    if ext_id:
        job.external_id = ext_id
    job.source, job.source_type = src.name, AGENCY
    if not job.company:
        job.company = src.label
    job.extra = {**job.extra, "agency": src.label}
    if not job.title:
        return None
    if job.location:
        if not _is_istanbul(job.location):
            return None
    elif list_loc and _is_istanbul(list_loc):
        job.location = list_loc  # sitenin kendi İstanbul filtresinden gelen liste
    else:
        return None
    return job


# --------------------------------------------------------------------------- #
# Genel toplayıcı
# --------------------------------------------------------------------------- #
def fetch_listing_jsonld(src: Source, ctx: FetchContext) -> Iterator[Job]:
    """params:
        lists        : [(liste_url, liste_konumu)] — liste_konumu sitenin kendi İstanbul
                       filtresiyse ("İstanbul (Avrupa)") konumu boş ilanlara uygulanır; aksi "".
        list_url     : tek liste URL'si (lists yerine)
        link_pattern : ilan-detay bağlantı regex'i
        id_re        : URL'den ilan kimliği (grup 1) — tekilleştirme ve external_id
        page_style   : None | "query" | "path";  page_param / page_base / page_fmt
        max_jobs     : ziyaret edilecek en fazla detay sayfası (varsayılan 300)
        max_pages    : liste başına en fazla sayfa (varsayılan 20, ctx.max_pages ile sınırlı)
        html_fallback: JSON-LD yoksa başlık + etiketli konumdan asgari ilan (varsayılan True)
    """
    p = src.params
    pattern = re.compile(p["link_pattern"], re.I)
    id_re = re.compile(p["id_re"], re.I) if p.get("id_re") else None
    max_jobs = int(p.get("max_jobs", DEFAULT_MAX_JOBS))
    max_pages = min(int(p.get("max_pages", DEFAULT_MAX_PAGES)), ctx.max_pages or DEFAULT_MAX_PAGES)
    lists = p.get("lists") or [(p["list_url"], p.get("list_location", ""))]

    def key_of(url: str) -> str:
        m = id_re.search(url) if id_re else None
        return m.group(1).lower() if m else url

    seen: set[str] = set()
    visited = 0
    for list_url, list_loc in lists:
        for n in range(1, max_pages + 1):
            if not ctx.time_left() or visited >= max_jobs:
                if visited >= max_jobs:
                    ctx.mark_partial(f"{src.name}: max_jobs={max_jobs}")
                return
            url = _page_url(list_url, n, p)
            if url is None:
                break
            try:
                page = ctx.http.get(url)
            except HttpError as e:
                if n == 1 and list_url == lists[0][0]:
                    raise
                ctx.log.info("%s: liste sayfası alınamadı %s (%s)", src.name, url, e)
                ctx.mark_partial(f"{src.name}: liste sayfası {n}")
                break

            # Liste sayfasının kendisi JobPosting JSON-LD taşıyorsa doğrudan kullan.
            for d in extract_jobpostings(page):
                job_url = urljoin(url, clean(d.get("url")))
                if not d.get("url") or key_of(job_url) in seen:
                    continue
                seen.add(key_of(job_url))
                job = jobposting_to_job(d, source=src.name, source_type=AGENCY, url=job_url)
                job = _finish(job, src, key_of(job_url) if id_re else None, list_loc, job_url)
                if job:
                    yield job

            links = [u for u in _find_links(page, url, pattern) if key_of(u) not in seen]
            if not links:
                break
            for link in links:
                k = key_of(link)
                if k in seen:
                    continue
                seen.add(k)
                if visited >= max_jobs or not ctx.time_left():
                    if visited >= max_jobs:
                        ctx.mark_partial(f"{src.name}: max_jobs={max_jobs}")
                    return
                visited += 1
                try:
                    detail = ctx.http.get(link)
                except HttpError as e:
                    ctx.log.info("%s: detay alınamadı %s (%s)", src.name, link, e)
                    continue
                postings = extract_jobpostings(detail)
                if postings:
                    job = jobposting_to_job(postings[0], source=src.name, source_type=AGENCY, url=link)
                elif p.get("html_fallback", True):
                    job = _html_job(detail, link, src)
                else:
                    job = None
                if job:
                    job = _finish(job, src, k if id_re else None, list_loc, link)
                    if job:
                        yield job
            if not p.get("page_style"):
                break
        else:  # liste sayfa sınırına ulaşıldı (daha fazla sayfa olabilir)
            ctx.mark_partial(f"{src.name}: max_pages={max_pages}")


# --------------------------------------------------------------------------- #
# Yapılandırma tablosu
# --------------------------------------------------------------------------- #
_SLUG = r"[^/\"'\s<>?#]+"

AGENCIES: list[dict] = [
    {   # randstad.com.tr — Randstad küresel iş ilanı platformu; konum yolları istanbul-europe / istanbul-asia
        "name": "agency:randstad",
        "label": "Randstad Türkiye",
        "homepage": "https://www.randstad.com.tr/is-ilanlari/",
        "params": {
            "lists": [
                ("https://www.randstad.com.tr/is-ilanlari/istanbul-europe/", "İstanbul (Avrupa)"),
                ("https://www.randstad.com.tr/is-ilanlari/istanbul-asia/", "İstanbul (Asya)"),
            ],
            "link_pattern": r"/is-ilanlari/[a-z0-9-]+_[a-z0-9-]+_\d+/?",
            "id_re": r"_(\d+)/?$",
            "page_style": "path", "page_fmt": "page-{n}/",
        },
    },
    {   # michaelpage.com.tr — PageGroup (Drupal); ilan kimliği JN-AAYYYY-NNNNNNN
        "name": "agency:michaelpage",
        "label": "Michael Page Türkiye",
        "homepage": "https://www.michaelpage.com.tr/jobs/istanbul",
        "params": {
            "lists": [("https://www.michaelpage.com.tr/jobs/istanbul", "İstanbul")],
            "link_pattern": rf"/(?:en/)?job-detail/{_SLUG}/ref/jn-\d{{6}}-\d+",
            "id_re": r"(jn-\d{6}-\d+)",
            "page_style": "query", "page_param": "page", "page_base": 0,
        },
    },
    {   # adecco.com/tr-tr — Adecco küresel sitesi; İstanbul filtresi detay JSON-LD konumundan
        "name": "agency:adecco",
        "label": "Adecco Türkiye",
        "homepage": "https://www.adecco.com/tr-tr/is-bul",
        "params": {
            "lists": [("https://www.adecco.com/tr-tr/is-bul", "")],
            "link_pattern": rf"/tr-tr/is-bul/{_SLUG}/jn-\d{{6}}-\d+",
            "id_re": r"(jn-\d{6}-\d+)",
            "page_style": "query", "page_param": "page",
        },
    },
    {   # tr.gigroup.com — İstanbul il listesi; detay /is-ilanlari/<slug>/?jobid=N
        "name": "agency:gigroup",
        "label": "Gi Group Türkiye",
        "homepage": "https://tr.gigroup.com/pozisyonlar/",
        "params": {
            "lists": [("https://tr.gigroup.com/pozisyonlar/marmara-re/istanbul-pr/", "İstanbul")],
            "link_pattern": rf"/is-ilanlari/{_SLUG}/\?jobid=\d+",
            "id_re": r"jobid=(\d+)",
            "page_style": "path", "page_fmt": "page/{n}/",
        },
    },
    {   # manpower.com.tr — /<dil>/jobs/<sektör>/<slug>/<id>; liste URL'si doğrulanamadı
        "name": "agency:manpower",
        "label": "ManpowerGroup Türkiye",
        "homepage": "https://www.manpower.com.tr/",
        "params": {
            "lists": [("https://www.manpower.com.tr/tr/jobs", "")],
            "link_pattern": rf"/(?:tr|en|en-us)/jobs/{_SLUG}/{_SLUG}/\d+",
            "id_re": r"/jobs/[^/]+/[^/]+/(\d+)",
            "page_style": "query", "page_param": "page",
        },
    },
    {   # Manpower'ın HR-Link (hr-link.net) kariyer portalı; detay /Home/detail?id=N
        "name": "agency:manpower-hrlink",
        "label": "ManpowerGroup Türkiye",
        "homepage": "https://hr-link.net/customized/homepage/manpower/index.asp",
        "params": {
            "lists": [("https://hr-link.net/customized/homepage/manpower/index.asp", "")],
            "link_pattern": r"(?:https?://(?:www\.)?hr-link\.net)?/Home/detail\?id=\d+[^\"'\s<>]*",
            "id_re": r"[?&]id=(\d+)",
        },
    },
]


def sources() -> list[Source]:
    return [
        Source(
            name=a["name"], source_type=AGENCY, label=a["label"],
            fetcher=a.get("fetcher", fetch_listing_jsonld),
            homepage=a.get("homepage", ""), params=dict(a["params"]),
            enabled=a.get("enabled", True),
        )
        for a in AGENCIES
    ]
