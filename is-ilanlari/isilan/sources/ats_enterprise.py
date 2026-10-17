"""Kurumsal ATS platformları için uyarlayıcılar (büyük Türk işverenlerin kariyer siteleri).

`ats.py`'deki uyarlayıcılara dokunmadan aynı kayıt defterini (data/companies.json) okur ve yalnızca
aşağıdaki `ats` türlerine sahip kayıtları işler:

* successfactors (takma ad: sitemap) — SAP SuccessFactors Recruiting Marketing / jobs2web kariyer
  siteleri: `https://<host>/sitemap.xml` içindeki `/job/<konum-başlık>/<id>/` bağlantıları, detay
  sayfalarında schema.org JobPosting JSON-LD. params: host, sitemap, max_jobs (300), link_pattern,
  fetch_all_locations.
* phenom — Phenom People kariyer siteleri: `POST https://<host>/widgets` (ddoKey=refineSearch).
  params: host, locale (en/tr), lang, country, location, page_size, ref_page_id.
* eightfold — `GET https://<host>/api/apply/v2/jobs?domain=<domain>&start=&num=&location=`.
  params: host, domain, location, page_size.
* taleo — Oracle Taleo Enterprise (`/careersection/rest/jobboard/searchjobs`).
  params: host, section (careersection kimliği), portal, lang, location.
* icims — iCIMS portalları: `/jobs/search?ss=1&in_iframe=1` liste sayfası + detay JSON-LD.
  params: host, max_jobs, location.

Hepsi yalnızca İstanbul ilanlarını (ve "Remote, Türkiye" gibi Türkiye'ye açık uzaktan ilanları) döner.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from typing import Callable, Iterator
from urllib.parse import quote, unquote, urljoin

from ..jsonld import extract_jobpostings, jobposting_to_job
from ..models import COMPANY, SOURCE_TYPES, Job
from ..text import clean, fold, strip_html
from .ats import _decide, _emp, _iso, _job, _work_model
from .base import FetchContext, Source

log = logging.getLogger(__name__)

_LOC_TAG = re.compile(r"<loc>\s*([^<\s]+)\s*</loc>", re.I)


def _slugify(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", fold(title)).strip("-")[:100]


def _key(src: Source) -> str:
    p = src.params
    return clean(p.get("host") or p.get("slug") or p.get("tenant") or src.name)


# ---------------------------------------------------------------------------
# JSON-LD yardımcıları (SuccessFactors / iCIMS ortak)
# ---------------------------------------------------------------------------

def _countries(raw_loc) -> list[str]:
    out: list[str] = []
    for item in raw_loc if isinstance(raw_loc, list) else [raw_loc]:
        if not isinstance(item, dict):
            continue
        addr = item.get("address", item)
        c = addr.get("addressCountry") if isinstance(addr, dict) else None
        if isinstance(c, dict):
            c = c.get("name")
        c = clean(c)
        if c:
            out.append("Turkey" if c.upper() in ("TR", "TUR") else c)
    return out


def _from_jsonld(src: Source, ats: str, d: dict, url: str) -> Job | None:
    j = jobposting_to_job(d, source="x", source_type=COMPANY, url=url, company=src.label)
    locs = [j.location] + _countries(d.get("jobLocation"))
    if str(d.get("jobLocationType", "")).upper() == "TELECOMMUTE":
        locs += [clean(a) for a in (d.get("applicantLocationRequirements") or []) if isinstance(a, str)]
    keep, loc, wm = _decide(src, locs, j.work_model, remote_flag=j.work_model == "remote")
    if not keep:
        return None
    return _job(src, ats, external_id=j.external_id or url, title=j.title,
                url=j.url if j.url.startswith("http") else url, location=loc, company=j.company,
                posted_at=_iso(j.posted_at), employment_type=_emp(j.employment_type), work_model=wm,
                description=j.description[:1000], salary=j.salary, category=j.category, extra=j.extra)


def _sitemap_urls(ctx: FetchContext, url: str, depth: int = 0) -> list[str]:
    xml = ctx.http.get(url)
    locs = _LOC_TAG.findall(xml)
    if "<sitemapindex" in xml.lower() and depth < 2:
        out: list[str] = []
        for child in locs[:20]:
            if not ctx.time_left():
                ctx.mark_partial("sitemap dizini yarım kaldı")
                break
            try:
                out.extend(_sitemap_urls(ctx, child, depth + 1))
            except Exception as e:  # noqa: BLE001
                ctx.log.debug("alt sitemap atlandı %s (%s)", child, e)
        return out
    return locs


# ---------------------------------------------------------------------------
# SAP SuccessFactors Recruiting Marketing — sitemap + JSON-LD
# ---------------------------------------------------------------------------

_SF_JOB = re.compile(r"/job/[^/]+/\d+", re.I)


def fetch_successfactors(src: Source, ctx: FetchContext) -> Iterator[Job]:
    p = src.params
    host = p["host"]
    max_jobs = int(p.get("max_jobs", 300))
    rx = re.compile(p["link_pattern"]) if p.get("link_pattern") else _SF_JOB
    urls = [u for u in dict.fromkeys(_sitemap_urls(ctx, p.get("sitemap") or f"https://{host}/sitemap.xml")) if rx.search(u)]
    ist = [u for u in urls if "istanbul" in fold(unquote(u))]
    # Konum URL'de kodlanıyorsa yalnızca İstanbul bağlantıları; kodlanmıyorsa ilk max_jobs bağlantı
    if ist and not p.get("fetch_all_locations"):
        chosen = ist
    else:
        chosen = ist + [u for u in urls if u not in set(ist)]
    if len(chosen) > max_jobs:
        ctx.mark_partial(f"{src.name}: max_jobs={max_jobs} ({len(chosen)} bağlantı)")
    seen: set[str] = set()
    for link in chosen[:max_jobs]:
        if not ctx.time_left():
            ctx.mark_partial(f"{src.name}: süre doldu")
            return
        try:
            html = ctx.http.get(link)
        except Exception as e:  # noqa: BLE001
            ctx.log.debug("%s: %s atlandı (%s)", src.name, link, e)
            continue
        for d in extract_jobpostings(html):
            job = _from_jsonld(src, "successfactors", d, link)
            if job and job.external_id not in seen:
                seen.add(job.external_id)
                yield job


# ---------------------------------------------------------------------------
# Phenom People — POST /widgets (refineSearch)
# ---------------------------------------------------------------------------

def _phenom_body(p: dict, offset: int, size: int) -> dict:
    return {
        "lang": p.get("lang", "en_global"), "deviceType": "desktop", "country": p.get("country", "global"),
        "pageName": "search-results", "ddoKey": "refineSearch", "sortBy": "Most recent", "subsearch": "",
        "from": offset, "jobs": True, "counts": True, "all_fetch": False, "pageType": "landing",
        "size": size, "clearAll": False, "jdsource": "facets", "isSliderEnable": False,
        "pageId": p.get("ref_page_id", "page11"), "siteType": "external",
        "keywords": p.get("keyword", ""), "global": True, "selected_fields": {},
        "sort": {"order": "desc", "field": "postedDate"}, "locationData": {},
        "location": p.get("location", "Istanbul, Turkey"),
    }


def fetch_phenom(src: Source, ctx: FetchContext) -> Iterator[Job]:
    p = src.params
    host, locale = p["host"], p.get("locale", "en")
    size, offset = int(p.get("page_size", 50)), 0
    seen: set[str] = set()
    for _ in range(max(1, ctx.max_pages)):
        resp = ctx.http.post_json(f"https://{host}/widgets", _phenom_body(p, offset, size),
                                  headers={"Content-Type": "application/json", "Referer": f"https://{host}/"})
        rs = (resp or {}).get("refineSearch") or {}
        jobs = (rs.get("data") or {}).get("jobs") or []
        total = int(rs.get("totalHits") or 0)
        for j in jobs:
            locs = [clean(j.get("location")), clean(j.get("cityStateCountry")),
                    clean(", ".join(x for x in (j.get("city"), j.get("country")) if x))]
            locs += [clean(x) for x in j.get("multi_location") or [] if isinstance(x, str)]
            wm = "remote" if j.get("isRemote") or fold(str(j.get("remote", ""))) == "yes" else ""
            keep, loc, wm = _decide(src, locs, wm)
            if not keep:
                continue
            jid = clean(j.get("jobId") or j.get("reqId"))
            if jid in seen:
                continue
            seen.add(jid)
            url = clean(p.get("job_url_base") and f"{p['job_url_base'].rstrip('/')}/{jid}") \
                or f"https://{host}/{locale}/job/{jid}/{_slugify(j.get('title', ''))}"
            yield _job(src, "phenom", external_id=jid, title=j.get("title"), url=url, location=loc,
                       posted_at=_iso(j.get("postedDate") or j.get("dateCreated")),
                       employment_type=_emp(j.get("type")), work_model=wm,
                       description=strip_html(j.get("descriptionTeaser") or j.get("description") or "")[:1000],
                       category=clean(j.get("category")))
        offset += len(jobs)
        if not jobs or offset >= total:
            return
        if not ctx.time_left():
            ctx.mark_partial(f"{src.name}: süre doldu")
            return
    ctx.mark_partial(f"{src.name}: max_pages={ctx.max_pages}")


# ---------------------------------------------------------------------------
# Eightfold — /api/apply/v2/jobs
# ---------------------------------------------------------------------------

def fetch_eightfold(src: Source, ctx: FetchContext) -> Iterator[Job]:
    p = src.params
    host = p["host"]
    domain = p.get("domain") or host
    num, start = int(p.get("page_size", 10)), 0
    seen: set[str] = set()
    for _ in range(max(1, ctx.max_pages)):
        url = (f"https://{host}/api/apply/v2/jobs?domain={quote(domain)}&start={start}&num={num}"
               f"&location={quote(p.get('location', 'Istanbul'))}&sort_by=timestamp")
        data = ctx.http.get_json(url)
        pos = (data or {}).get("positions") or []
        total = int((data or {}).get("count") or 0)
        for j in pos:
            locs = [clean(j.get("location"))] + [clean(x) for x in j.get("locations") or [] if isinstance(x, str)]
            wm = _work_model(j.get("work_location_option"))
            keep, loc, wm = _decide(src, locs, wm)
            if not keep:
                continue
            jid = clean(j.get("id") or j.get("ats_job_id") or j.get("display_job_id"))
            if jid in seen:
                continue
            seen.add(jid)
            yield _job(src, "eightfold", external_id=jid, title=j.get("name"),
                       url=clean(j.get("canonical_url")) or f"https://{host}/careers/job/{jid}",
                       location=loc, posted_at=_iso(j.get("t_create") or j.get("t_update")), work_model=wm,
                       description=strip_html(j.get("job_description") or "")[:1000],
                       category=clean(j.get("department") or j.get("business_unit")))
        start += len(pos)
        if not pos or start >= total:
            return
        if not ctx.time_left():
            ctx.mark_partial(f"{src.name}: süre doldu")
            return
    ctx.mark_partial(f"{src.name}: max_pages={ctx.max_pages}")


# ---------------------------------------------------------------------------
# Oracle Taleo Enterprise — /careersection/rest/jobboard/searchjobs
# ---------------------------------------------------------------------------

def _taleo_date(s: str) -> str | None:
    for fmt in ("%b %d, %Y", "%d.%m.%Y", "%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(clean(s), fmt).date().isoformat()
        except ValueError:
            continue
    return _iso(s)


def _taleo_locations(raw) -> list[str]:
    raw = clean(raw) if not isinstance(raw, list) else raw
    if isinstance(raw, str) and raw.startswith("["):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            pass
    if isinstance(raw, list):
        return [clean(x) for x in raw if clean(x)]
    return [raw] if raw else []


def fetch_taleo(src: Source, ctx: FetchContext) -> Iterator[Job]:
    p = src.params
    host, section, lang = p["host"], p.get("section", "2"), p.get("lang", "en")
    api = f"https://{host}/careersection/rest/jobboard/searchjobs?lang={lang}&portal={p.get('portal', '101430233')}"
    seen: set[str] = set()
    page = 1
    for _ in range(max(1, ctx.max_pages)):
        body = {"multilineEnabled": False,
                "sortingSelection": {"sortBySelectionParam": "3", "ascendingSortingOrder": "false"},
                "fieldData": {"fields": {"KEYWORD": p.get("keyword", ""), "LOCATION": p.get("location", "")},
                              "valid": True},
                "filterSelectionParam": {"searchFilterSelections": []},
                "advancedSearchFiltersSelectionParam": {"searchFilterSelectionsList": []},
                "pageNo": page}
        data = ctx.http.post_json(api, body, headers={"Content-Type": "application/json", "tz": "GMT+03:00"})
        reqs = (data or {}).get("requisitionList") or []
        paging = (data or {}).get("pagingData") or {}
        for r in reqs:
            col = r.get("column") or []
            title = clean(col[0]) if col else clean(r.get("title"))
            locs = _taleo_locations(col[1] if len(col) > 1 else r.get("location"))
            keep, loc, wm = _decide(src, locs)
            if not keep:
                continue
            cno = clean(r.get("contestNo") or r.get("jobId"))
            if cno in seen:
                continue
            seen.add(cno)
            yield _job(src, "taleo", external_id=cno, title=title,
                       url=f"https://{host}/careersection/{section}/jobdetail.ftl?job={cno}&lang={lang}",
                       location=loc, posted_at=_taleo_date(col[2]) if len(col) > 2 else None, work_model=wm)
        size = int(paging.get("pageSize") or len(reqs) or 1)
        total = int(paging.get("totalCount") or 0)
        if not reqs or page * size >= total:
            return
        if not ctx.time_left():
            ctx.mark_partial(f"{src.name}: süre doldu")
            return
        page += 1
    ctx.mark_partial(f"{src.name}: max_pages={ctx.max_pages}")


# ---------------------------------------------------------------------------
# iCIMS — liste sayfası bağlantıları + detay JSON-LD
# ---------------------------------------------------------------------------

_ICIMS_LINK = re.compile(r"""href\s*=\s*["']([^"']*?/jobs/\d+/[^"']*?/job[^"']*)["']""", re.I)


def fetch_icims(src: Source, ctx: FetchContext) -> Iterator[Job]:
    p = src.params
    host = p["host"]
    max_jobs = int(p.get("max_jobs", 300))
    links: list[str] = []
    for page in range(max(1, min(ctx.max_pages, 30))):
        url = (f"https://{host}/jobs/search?ss=1&in_iframe=1&pr={page}"
               f"&searchLocation={quote(p.get('location', ''))}")
        html = ctx.http.get(url)
        new = []
        for h in _ICIMS_LINK.findall(html):
            u = urljoin(url, h.replace("&amp;", "&"))
            u = u.split("?")[0]
            if u not in links and u not in new:
                new.append(u)
        links.extend(new)
        if not new or len(links) >= max_jobs or not ctx.time_left():
            break
    else:
        ctx.mark_partial(f"{src.name}: max_pages")
    if len(links) > max_jobs:
        ctx.mark_partial(f"{src.name}: max_jobs={max_jobs}")
    seen: set[str] = set()
    for link in links[:max_jobs]:
        if not ctx.time_left():
            ctx.mark_partial(f"{src.name}: süre doldu")
            return
        try:
            html = ctx.http.get(link + "?in_iframe=1")
        except Exception as e:  # noqa: BLE001
            ctx.log.debug("%s: %s atlandı (%s)", src.name, link, e)
            continue
        for d in extract_jobpostings(html):
            job = _from_jsonld(src, "icims", d, link)
            if job and job.external_id not in seen:
                seen.add(job.external_id)
                yield job


# ---------------------------------------------------------------------------
# Kayıt defteri
# ---------------------------------------------------------------------------

FETCHERS: dict[str, Callable[[Source, FetchContext], Iterator[Job]]] = {
    "successfactors": fetch_successfactors,
    "phenom": fetch_phenom,
    "eightfold": fetch_eightfold,
    "taleo": fetch_taleo,
    "icims": fetch_icims,
}
ALIASES = {"sitemap": "successfactors", "sap": "successfactors"}


def make_source(entry: dict) -> Source | None:
    params = dict(entry)
    ats = clean(params.get("ats")).lower()
    ats = ALIASES.get(ats, ats)
    fetcher = FETCHERS.get(ats)
    if fetcher is None:
        return None
    if not params.get("host"):
        log.warning("%s kaydında host yok: %s", ats, entry.get("company"))
        return None
    params["ats"] = ats
    st = params.get("source_type") or COMPANY
    return Source(name=f"{ats}:{_key_from(params)}", source_type=st if st in SOURCE_TYPES else COMPANY,
                  label=clean(params.get("company")) or params["host"], fetcher=fetcher,
                  homepage=clean(params.get("careers_url")), params=params,
                  enabled=bool(params.get("enabled", True)))


def _key_from(params: dict) -> str:
    return clean(params.get("host"))


def sources(entries: list[dict] | None = None) -> list[Source]:
    if entries is None:
        from .registry import load_registry
        entries = load_registry()
    out: dict[str, Source] = {}
    for e in entries:
        s = make_source(e) if isinstance(e, dict) else None
        if s and s.name not in out:
            out[s.name] = s
    return list(out.values())
