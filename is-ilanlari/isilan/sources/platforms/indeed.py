"""Indeed Türkiye (tr.indeed.com).

UYARI — KIRILGAN: tr.indeed.com HTML sayfaları Cloudflare ile yoğun biçimde korunur
(403 + `cf-mitigated: challenge`, anonim 2. sayfada oturum duvarı). Bu modül önce
python-jobspy'nin kullandığı yöntemi dener: Indeed iOS uygulamasının GraphQL API'si

    POST https://apis.indeed.com/graphql
    başlıklar: indeed-api-key (uygulamaya gömülü, herkese açık anahtar), indeed-co: TR,
               indeed-locale: tr-TR, iOS uygulaması user-agent'ı
    gövde   : {"query": "query GetJobData { jobSearch(location: {where: \"İstanbul\" ...}
               limit: 100, cursor: ..., ...) { pageInfo { nextCursor } results { job { ... } } } }"}

Anahtar/sorgu şeması Indeed tarafından her an değiştirilebilir veya engellenebilir; bu
durumda HTML yedeğine düşülür:

    GET https://tr.indeed.com/jobs?q=&l=İstanbul&sort=date&start=N   (sayfa başına ~15 kart)
    window.mosaic.providerData["mosaic-provider-jobcards"] = {...
        "metaData": {"mosaicProviderJobCardsModel": {"results": [ {jobkey, displayTitle,
         company, formattedLocation, pubDate, formattedRelativeTime, snippet, ...} ]}}}

HTML yedeği düz HTTP ile çoğunlukla engellenir; `--browser` ile Playwright açılır.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Iterator
from urllib.parse import urlencode

from ...http import HttpError
from ...models import PLATFORM, Job
from ...text import clean, strip_html
from ..base import FetchContext, Source
from ._util import extract_js_object, parse_tr_relative_date

NAME = "indeed"
BASE = "https://tr.indeed.com"
API_URL = "https://apis.indeed.com/graphql"
PAGE_SIZE = 100

# python-jobspy (jobspy/indeed/constant.py) ile aynı; Indeed iOS uygulamasının başlıkları.
API_HEADERS = {
    "content-type": "application/json",
    "indeed-api-key": "161092c2017b5bbab13edb12461a62d5a833871e7cad6d9d475304573de67ac8",
    "accept": "application/json",
    "accept-language": "tr-TR,tr;q=0.9",
    "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6_1 like Mac OS X) AppleWebKit/605.1.15 "
                  "(KHTML, like Gecko) Mobile/15E148 Indeed App 193.1",
    "indeed-app-info": "appv=193.1; appid=com.indeed.jobsearch; osv=16.6.1; os=ios; dtype=phone",
    "indeed-co": "TR",
    "indeed-locale": "tr-TR",
}

# jobspy sorgusunun sadeleştirilmiş hali (yalnızca ihtiyaç duyulan alanlar).
QUERY = """
query GetJobData {{
    jobSearch(
        {what}
        {location}
        limit: {limit}
        {cursor}
        sort: {sort}
        {filters}
    ) {{
        pageInfo {{ nextCursor }}
        results {{
            job {{
                key
                title
                sourceEmployerName
                dateOnIndeed
                description {{ html }}
                location {{ countryCode admin1Code city }}
                compensation {{
                    baseSalary {{
                        unitOfWork
                        range {{
                            ... on Range {{ min max }}
                            ... on AtLeast {{ min }}
                            ... on AtMost {{ max }}
                            ... on Exactly {{ value }}
                        }}
                    }}
                    currencyCode
                }}
                attributes {{ key label }}
                employer {{ name }}
                recruit {{ viewJobUrl }}
            }}
        }}
    }}
}}
"""

JOB_TYPE_KEYS = {"CF3CP", "75GKK", "NJXCK", "T9BXE", "T65DZ", "VDTG7", "4HKF7", "CJWTS", "TQKYQ", "UXQZ8", "5QWDV"}
REMOTE_KEY, HYBRID_KEY = "DSQF7", "PAXZC"
_UNIT = {"HOUR": "saatlik", "DAY": "günlük", "WEEK": "haftalık", "MONTH": "aylık", "YEAR": "yıllık"}


def build_query(params: dict, cursor: str | None) -> str:
    what = params.get("keywords", "")
    where = params.get("location", "İstanbul")
    radius = int(params.get("radius", 25))
    filters = []
    if params.get("hours_old"):
        filters.append('{ date: { field: "dateOnIndeed", start: "%sh" } }' % int(params["hours_old"]))
    return QUERY.format(
        what=f"what: {json.dumps(what, ensure_ascii=False)}" if what else "",
        location=f"location: {{where: {json.dumps(where, ensure_ascii=False)}, radius: {radius}, radiusUnit: MILES}}",
        limit=int(params.get("limit", PAGE_SIZE)),
        cursor=f'cursor: "{cursor}"' if cursor else "",
        sort=params.get("sort", "RELEVANCE"),
        filters=f"filters: [{', '.join(filters)}]" if filters else "",
    )


def _salary(comp: dict | None) -> str:
    if not comp:
        return ""
    base = comp.get("baseSalary") or {}
    rng = base.get("range") or {}
    lo, hi, val = rng.get("min"), rng.get("max"), rng.get("value")
    if lo is None and hi is None and val is None:
        return ""
    fmt = lambda x: f"{x:,.0f}".replace(",", ".") if isinstance(x, (int, float)) else str(x)  # noqa: E731
    amount = fmt(val) if val is not None else "-".join(fmt(x) for x in (lo, hi) if x is not None)
    return clean(f"{amount} {comp.get('currencyCode') or ''} {_UNIT.get(base.get('unitOfWork'), '')}")


def api_job_to_job(job: dict) -> Job | None:
    key = job.get("key")
    title = clean(job.get("title"))
    if not key or not title:
        return None
    loc = job.get("location") or {}
    location = ", ".join(x for x in (clean(loc.get("city")), clean(loc.get("admin1Code"))) if x)
    if loc.get("countryCode") and loc.get("countryCode") != "TR":
        location = ", ".join(x for x in (location, loc["countryCode"]) if x)
    posted = None
    if isinstance(job.get("dateOnIndeed"), (int, float)):
        posted = datetime.fromtimestamp(job["dateOnIndeed"] / 1000, tz=timezone.utc).date().isoformat()
    attrs = job.get("attributes") or []
    keys = {a.get("key") for a in attrs}
    work_model = "hybrid" if HYBRID_KEY in keys else ("remote" if REMOTE_KEY in keys else "")
    emp = ", ".join(clean(a.get("label")) for a in attrs if a.get("key") in JOB_TYPE_KEYS and a.get("label"))
    employer = job.get("employer") or {}
    extra = {}
    apply = ((job.get("recruit") or {}).get("viewJobUrl") or "")
    if apply and "indeed.com" not in apply:
        extra["apply_url"] = apply
    return Job(
        source=NAME,
        source_type=PLATFORM,
        external_id=key,
        title=title,
        company=clean(employer.get("name") or job.get("sourceEmployerName")),
        url=f"{BASE}/viewjob?jk={key}",
        location=location,
        posted_at=posted,
        employment_type=emp,
        work_model=work_model,
        description=strip_html((job.get("description") or {}).get("html", "")),
        salary=_salary(job.get("compensation")),
        extra=extra,
    )


def _fetch_api(src: Source, ctx: FetchContext) -> Iterator[Job]:
    cursor, page, seen = None, 0, set()
    while page < ctx.max_pages and ctx.time_left():
        data = ctx.http.post_json(API_URL, {"query": build_query(src.params, cursor)}, headers=dict(API_HEADERS))
        search = (data.get("data") or {}).get("jobSearch") if isinstance(data, dict) else None
        if not search:
            raise RuntimeError(f"Indeed GraphQL hatası: {str((data or {}).get('errors'))[:200]}")
        page += 1
        new = 0
        for r in search.get("results") or []:
            j = api_job_to_job((r or {}).get("job") or {})
            if j and j.external_id not in seen:
                seen.add(j.external_id)
                new += 1
                yield j
        cursor = (search.get("pageInfo") or {}).get("nextCursor")
        if not new or not cursor:
            return


# ---------------------------------------------------------------- HTML yedeği
_MOSAIC = re.compile(r"""window\.mosaic\.providerData\[["']mosaic-provider-jobcards["']\]\s*=\s*""")


def parse_mosaic(html: str) -> list[dict]:
    m = _MOSAIC.search(html or "")
    if not m:
        return []
    raw = extract_js_object(html, m.end())
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    model = (data.get("metaData") or {}).get("mosaicProviderJobCardsModel") or {}
    return model.get("results") or []


def mosaic_to_job(r: dict) -> Job | None:
    key = r.get("jobkey")
    title = clean(r.get("displayTitle") or r.get("title"))
    if not key or not title:
        return None
    posted = None
    if isinstance(r.get("pubDate"), (int, float)):
        posted = datetime.fromtimestamp(r["pubDate"] / 1000, tz=timezone.utc).date().isoformat()
    posted = posted or parse_tr_relative_date(r.get("formattedRelativeTime"))
    sal = r.get("salarySnippet") or {}
    tax = {t.get("label"): t.get("attributes") for t in r.get("taxonomyAttributes") or [] if isinstance(t, dict)}
    jt = ", ".join(a.get("label", "") for a in (tax.get("job-types") or []) if isinstance(a, dict))
    loc = clean(r.get("formattedLocation"))
    remote = r.get("remoteLocation") or "uzaktan" in loc.lower()
    return Job(
        source=NAME,
        source_type=PLATFORM,
        external_id=key,
        title=title,
        company=clean(r.get("company")),
        url=f"{BASE}/viewjob?jk={key}",
        location=loc,
        posted_at=posted,
        employment_type=clean(jt) or ", ".join(r.get("jobTypes") or []),
        work_model="remote" if remote else "",
        description=strip_html(r.get("snippet", "")),
        salary=clean(sal.get("text")) if isinstance(sal, dict) else "",
    )


def html_page_url(params: dict, start: int) -> str:
    q = {"q": params.get("keywords", ""), "l": params.get("location", "İstanbul"), "sort": "date"}
    if start:
        q["start"] = start
    return f"{BASE}/jobs?{urlencode(q)}"


def _fetch_html(src: Source, ctx: FetchContext) -> Iterator[Job]:
    start, page, seen = 0, 0, set()
    while page < ctx.max_pages and ctx.time_left():
        html = ctx.http.get(html_page_url(src.params, start))
        page += 1
        results = parse_mosaic(html)
        new = 0
        for r in results:
            j = mosaic_to_job(r)
            if j and j.external_id not in seen:
                seen.add(j.external_id)
                new += 1
                yield j
        if not new:  # son sayfadan sonra Indeed son sayfayı tekrarlar
            return
        start += 10


def fetch(src: Source, ctx: FetchContext) -> Iterator[Job]:
    got = 0
    try:
        for j in _fetch_api(src, ctx):
            got += 1
            yield j
    except (HttpError, RuntimeError, ValueError, KeyError, TypeError) as e:
        ctx.log.warning("indeed: GraphQL API başarısız (%s); HTML yedeğine geçiliyor", e)
        if got:
            return
    else:
        if got:
            return
    yield from _fetch_html(src, ctx)


def sources() -> list[Source]:
    return [Source(
        name=NAME,
        source_type=PLATFORM,
        label="Indeed Türkiye",
        homepage=f"{BASE}/jobs?l=%C4%B0stanbul",
        fetcher=fetch,
        params={"hours_old": 720},
    )]
