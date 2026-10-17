"""Glassdoor — İstanbul ilanları.

Glassdoor'un Türkiye'ye özel bir iş arama alanı yoktur (python-jobspy'nin ülke
listesinde Türkiye için Glassdoor alanı tanımlı değildir); İstanbul ilanları
www.glassdoor.com üzerinden konum kimliğiyle aranır.

Yöntem (python-jobspy jobspy/glassdoor ile aynı):
  1. GET  https://www.glassdoor.com/autocomplete/location?locationTypeFilters=CITY,STATE,COUNTRY
          &caller=jobs&term=Istanbul        → [{"locationId": ..., "locationType": "C", ...}]
  2. POST https://www.glassdoor.com/graph   (gövde bir LİSTE: [{"operationName": "JobSearchResultsQuery",
          "variables": {...,"locationId","locationType":"CITY","pageNumber","pageCursor"}, "query": ...}])
          başlık: gd-csrf-token (jobspy'deki sabit belirteç)
     yanıt: [{"data": {"jobListings": {"jobListings": [{"jobview": {header, job, map, overview}}],
              "paginationCursors": [{"cursor", "pageNumber"}]}}}]

jobspy bu istekleri curl_cffi (tarayıcı TLS parmak izi) ile yapar; düz `requests` ile
Cloudflare 403 verebilir. Bu yüzden kaynak needs_browser=True işaretlidir. GraphQL
başarısız olursa arama sayfası (…/Job/istanbul-turkey-jobs-SRCH_IL.0,15_IC<id>.htm)
GET ile alınır — `--browser` modunda BrowserHttp bunu Playwright ile açar — ve
sayfadaki JSON-LD, gömülü "jobview" nesneleri veya `li[data-test=jobListing]` kartları
ayrıştırılır (en iyi çaba).
"""
from __future__ import annotations

import json
import re
from datetime import date, timedelta
from typing import Iterator
from urllib.parse import quote

from ...http import HttpError
from ...jsonld import extract_jobpostings, jobposting_to_job
from ...models import PLATFORM, Job
from ...text import clean
from ..base import FetchContext, Source
from ._util import abs_url, extract_js_object, parse_html, parse_tr_relative_date

NAME = "glassdoor"
BASE = "https://www.glassdoor.com"
PAGE_SIZE = 30

HEADERS = {
    "gd-csrf-token": "Ft6oHEWlRZrxDww95Cpazw:0pGUrkb2y3TyOpAIqF2vbPmUXoXVkD3oEGDVkvfeCerceQ5-n8mBg3BovySUIjmCPHCaW0H2nQVdqzbtsYqf4Q:wcqRqeegRUa9MVLJGyujVXB7vWFPjdaS1CtrrzJq-ok",
    "content-type": "application/json",
    "accept": "*/*",
}
LOCATION_TYPES = {"C": "CITY", "S": "STATE", "N": "COUNTRY"}

SEARCH_QUERY = """
query JobSearchResultsQuery(
    $keyword: String, $locationId: Int, $locationType: LocationTypeEnum, $numJobsToShow: Int!,
    $pageCursor: String, $pageNumber: Int, $filterParams: [FilterParams], $parameterUrlInput: String
) {
    jobListings(
        contextHolder: {
            searchParams: {
                keyword: $keyword, locationId: $locationId, locationType: $locationType,
                numPerPage: $numJobsToShow, pageCursor: $pageCursor, pageNumber: $pageNumber,
                filterParams: $filterParams, parameterUrlInput: $parameterUrlInput, searchType: SR
            }
        }
    ) {
        jobListings {
            jobview {
                header {
                    ageInDays
                    employer { id }
                    employerNameFromSearch
                    jobTypeKeys
                    locationName
                    locationType
                    payCurrency
                    payPeriod
                    payPeriodAdjustedPay { p10 p90 }
                    remoteWorkTypes
                }
                job { jobTitleText listingId }
                map { country }
            }
        }
        paginationCursors { cursor pageNumber }
    }
}
"""


def jobview_to_job(view: dict, today: date | None = None) -> Job | None:
    job = view.get("job") or {}
    header = view.get("header") or {}
    lid = job.get("listingId")
    title = clean(job.get("jobTitleText"))
    if not lid or not title:
        return None
    age = header.get("ageInDays")
    posted = None
    if isinstance(age, int):
        posted = ((today or date.today()) - timedelta(days=age)).isoformat()
    company = clean(header.get("employerNameFromSearch"))
    loc = clean(header.get("locationName"))
    country = clean((view.get("map") or {}).get("country"))
    location = loc
    if country and country not in loc:
        location = f"{loc}, {country}" if loc else country
    remote = "WORK_FROM_HOME" in (header.get("remoteWorkTypes") or []) or loc == "Remote"
    pay = header.get("payPeriodAdjustedPay") or {}
    salary = ""
    if pay.get("p10") or pay.get("p90"):
        salary = clean(f"{pay.get('p10', '')}-{pay.get('p90', '')} {header.get('payCurrency') or ''} "
                       f"{(header.get('payPeriod') or '').lower()}")
    emp = ", ".join(k.rpartition(".")[2].lower() for k in header.get("jobTypeKeys") or [])
    return Job(
        source=NAME,
        source_type=PLATFORM,
        external_id=str(lid),
        title=title,
        company=company,
        url=f"{BASE}/job-listing/j?jl={lid}",
        location=location,
        posted_at=posted,
        employment_type=emp,
        work_model="remote" if remote else "",
        salary=salary,
    )


def resolve_location(ctx: FetchContext, term: str) -> tuple[int, str] | None:
    url = (f"{BASE}/autocomplete/location?locationTypeFilters=CITY,STATE,COUNTRY&caller=jobs"
           f"&term={quote(term)}")
    places = ctx.http.get_json(url, headers={"accept": "application/json"})
    if not places:
        return None
    p = places[0]
    return int(p["locationId"]), LOCATION_TYPES.get(p.get("locationType"), "CITY")


def _fetch_graph(src: Source, ctx: FetchContext, loc_id: int, loc_type: str) -> Iterator[Job]:
    variables = {
        "keyword": src.params.get("keywords", ""),
        "numJobsToShow": PAGE_SIZE,
        "filterParams": [{"filterKey": "fromAge", "values": str(src.params["from_age"])}]
        if src.params.get("from_age") else [],
        "locationId": loc_id,
        "locationType": loc_type,
        "parameterUrlInput": f"IL.0,12_I{loc_type[0]}{loc_id}",
    }
    page, cursor, seen = 1, None, set()
    while page <= ctx.max_pages and ctx.time_left():
        payload = [{"operationName": "JobSearchResultsQuery",
                    "variables": {**variables, "pageNumber": page, "pageCursor": cursor},
                    "query": SEARCH_QUERY}]
        resp = ctx.http.post_json(f"{BASE}/graph", payload, headers=dict(HEADERS))
        answer = resp[0] if isinstance(resp, list) and resp else resp
        result = ((answer or {}).get("data") or {}).get("jobListings")
        if not result:
            raise RuntimeError(f"Glassdoor API hatası: {str((answer or {}).get('errors'))[:200]}")
        new = 0
        for listing in result.get("jobListings") or []:
            j = jobview_to_job((listing or {}).get("jobview") or {})
            if j and j.external_id not in seen:
                seen.add(j.external_id)
                new += 1
                yield j
        cursors = {c.get("pageNumber"): c.get("cursor") for c in result.get("paginationCursors") or []}
        cursor = cursors.get(page + 1)
        if not new or not cursor:
            return
        page += 1


# ------------------------------------------------------------ HTML / JSON-LD yedeği
_NEXT = re.compile(r'<script[^>]+id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)


def _walk_jobviews(obj, out: list):
    if isinstance(obj, dict):
        if "jobview" in obj and isinstance(obj["jobview"], dict):
            out.append(obj["jobview"])
        for v in obj.values():
            _walk_jobviews(v, out)
    elif isinstance(obj, list):
        for v in obj:
            _walk_jobviews(v, out)


def parse_search_html(html: str) -> list[Job]:
    jobs: list[Job] = []
    # 1) gömülü Next.js / Apollo durumu
    views: list[dict] = []
    m = _NEXT.search(html or "")
    if m:
        try:
            _walk_jobviews(json.loads(m.group(1)), views)
        except json.JSONDecodeError:
            pass
    if not views:
        for mm in re.finditer(r'"jobview"\s*:\s*', html or ""):
            raw = extract_js_object(html, mm.end())
            if raw:
                try:
                    views.append(json.loads(raw))
                except json.JSONDecodeError:
                    continue
    for v in views:
        j = jobview_to_job(v)
        if j:
            jobs.append(j)
    if jobs:
        return jobs
    # 2) JSON-LD
    for d in extract_jobpostings(html):
        j = jobposting_to_job(d, source=NAME, source_type=PLATFORM)
        if j.title:
            jobs.append(j)
    if jobs:
        return jobs
    # 3) kart HTML'i
    root = parse_html(html)
    for li in root.find_all(attrs={"data-test": "jobListing"}):
        lid = li.get("data-jobid") or li.get("data-id")
        a = li.find("a", attrs={"data-test": "job-title"}) or li.find("a", attrs={"data-test": "job-link"})
        if not lid or a is None:
            continue
        emp = li.find(cls=None, attrs={"class": re.compile(r"EmployerProfile_compactEmployerName|employer-name")})
        loc = li.find(attrs={"data-test": "emp-location"})
        age = li.find(attrs={"data-test": "job-age"})
        jobs.append(Job(
            source=NAME, source_type=PLATFORM, external_id=str(lid), title=clean(a.text()),
            company=clean(emp.text()) if emp else "",
            url=abs_url(BASE, a.get("href")) or f"{BASE}/job-listing/j?jl={lid}",
            location=clean(loc.text()) if loc else "",
            posted_at=parse_tr_relative_date(age.text()) if age else None,
        ))
    return jobs


def search_page_url(loc_id: int, page: int, slug: str = "istanbul-turkey") -> str:
    suffix = f"_IP{page}" if page > 1 else ""
    return f"{BASE}/Job/{slug}-jobs-SRCH_IL.0,{len(slug)}_IC{loc_id}{suffix}.htm"


def _fetch_html(src: Source, ctx: FetchContext, loc_id: int) -> Iterator[Job]:
    seen: set[str] = set()
    for page in range(1, min(ctx.max_pages, 30) + 1):
        if not ctx.time_left():
            return
        jobs = parse_search_html(ctx.http.get(search_page_url(loc_id, page)))
        new = [j for j in jobs if j.external_id not in seen]
        if not new:
            return
        for j in new:
            seen.add(j.external_id)
            yield j


def fetch(src: Source, ctx: FetchContext) -> Iterator[Job]:
    p = src.params
    if p.get("location_id"):
        loc = (int(p["location_id"]), p.get("location_type", "CITY"))
    else:
        loc = resolve_location(ctx, p.get("location", "Istanbul"))
    if not loc:
        raise RuntimeError("Glassdoor: İstanbul konum kimliği bulunamadı")
    got = 0
    try:
        for j in _fetch_graph(src, ctx, *loc):
            got += 1
            yield j
    except (HttpError, RuntimeError, ValueError, KeyError, TypeError, IndexError) as e:
        ctx.log.warning("glassdoor: GraphQL başarısız (%s); HTML yedeğine geçiliyor", e)
    if not got:
        yield from _fetch_html(src, ctx, loc[0])


def sources() -> list[Source]:
    return [Source(
        name=NAME,
        source_type=PLATFORM,
        label="Glassdoor",
        homepage=f"{BASE}/Job/istanbul-turkey-jobs-SRCH_IL.0,15.htm",
        fetcher=fetch,
        params={"location": "Istanbul", "from_age": 30},
        needs_browser=True,
    )]
