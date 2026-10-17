"""techcareer.net — teknoloji ilanları (Kariyer.net grubu).

Herkese açık BFF JSON API'si (sitenin kendi istemcisinin kullandığı):
  GET https://www.techcareer.net/api/bff/jobs/job-list?jobs[isCompleted]=false&jobs[page]=N
  -> {"jobs": [{id, title, slug, company: {companyProfileName}, location: {locationName},
                otherLocations: [{locationName}], workPlaces: [{workPlaceName}], ...}],
      "totalCount", "pageCount"}
İlan adresi: https://www.techcareer.net/jobs/detail/<slug>.
API yanıt vermezse yedek yol: /jobs sayfasının __NEXT_DATA__ blobu
(props.pageProps.initialJobList.jobListItems — yalnızca ilk sayfa).
Liste şehir süzgeci kullanılmaz (parametresi doğrulanmadı); İstanbul süzgeci pipeline'dadır.
"""
from __future__ import annotations

from typing import Iterator
from urllib.parse import urlencode

from ...http import HttpError
from ...models import PLATFORM, Job
from ...text import clean, fold, strip_html
from ..base import FetchContext, Source
from ._cards import dig, maybe_enrich, next_data
from ._util import parse_any_date

NAME = "techcareer"
BASE = "https://www.techcareer.net"
API = BASE + "/api/bff/jobs/job-list"
DETAIL = BASE + "/jobs/detail/"
_WM = {"uzaktan": "remote", "remote": "remote", "hibrit": "hybrid", "hybrid": "hybrid",
       "ofiste": "onsite", "is yerinde": "onsite", "isyerinde": "onsite", "on site": "onsite",
       "onsite": "onsite", "office": "onsite"}
_DATE_KEYS = ("publishDate", "publishedDate", "publishedAt", "postedDate", "datePosted",
              "createdDate", "createdAt", "startDate")


def api_url(page: int) -> str:
    return API + "?" + urlencode({"jobs[isCompleted]": "false", "jobs[page]": page})


def _name(v, *keys) -> str:
    if isinstance(v, str):
        return clean(v)
    if isinstance(v, dict):
        for k in keys:
            if v.get(k):
                return clean(v[k])
    return ""


def item_to_job(j: dict, source: str = NAME) -> Job | None:
    slug = clean(j.get("slug"))
    title = clean(j.get("title") or j.get("jobTitle") or j.get("positionName"))
    if not slug or not title:
        return None
    company = (_name(j.get("company"), "companyProfileName", "name", "companyName")
               or _name(j.get("owner"), "name", "companyProfileName"))
    locs = [_name(j.get("location"), "locationName", "name")]
    locs += [_name(x, "locationName", "name") for x in j.get("otherLocations") or []]
    locs = [x for i, x in enumerate(locs) if x and x not in locs[:i]]
    places = [_name(w, "workPlaceName", "name") for w in j.get("workPlaces") or []]
    places = [p for p in places if p]
    wm = ""
    for p in places:
        wm = _WM.get(fold(p), "")
        if wm:
            break
    posted = None
    for k in _DATE_KEYS:
        if j.get(k):
            posted = parse_any_date(str(j[k]))
            if posted:
                break
    emp = ""
    tow = j.get("typeOfWork") or j.get("workingTypes") or j.get("typeOfWorks")
    if isinstance(tow, list):
        emp = ", ".join(n for n in (_name(t, "name", "typeOfWorkName", "workingTypeName") for t in tow) if n)
    else:
        emp = _name(tow, "name", "typeOfWorkName")
    extra = {}
    if j.get("id") is not None:
        extra["id"] = j["id"]
    if places:
        extra["work_places"] = places
    if j.get("applyLink"):
        extra["apply_link"] = clean(j["applyLink"])
    if j.get("isCompanyHidden"):
        extra["company_hidden"] = True
    return Job(
        source=source, source_type=PLATFORM, external_id=slug, title=title,
        company=company,
        url=DETAIL + slug, location=" | ".join(locs), posted_at=posted, employment_type=emp,
        work_model=wm, description=strip_html(j.get("description") or "", 500), extra=extra,
    )


def fetch(src: Source, ctx: FetchContext) -> Iterator[Job]:
    seen: set[str] = set()
    page_count: int | None = None
    for page in range(1, max(ctx.max_pages, 1) + 1):
        if page > 1 and not ctx.time_left():
            break
        try:
            data = ctx.http.get_json(api_url(page))
        except (HttpError, ValueError) as e:
            if page > 1:
                ctx.log.info("techcareer: sayfa %d alınamadı (%s)", page, e)
                ctx.mark_partial(f"techcareer sayfa {page}")
                break
            ctx.log.info("techcareer API alınamadı (%s); __NEXT_DATA__ deneniyor", e)
            yield from _fallback(src, ctx)
            return
        items = (data or {}).get("jobs") or []
        page_count = data.get("pageCount") if isinstance(data, dict) else None
        jobs = [j for j in (item_to_job(i, src.name) for i in items if isinstance(i, dict)) if j]
        fresh = [j for j in jobs if j.external_id not in seen]
        if not fresh:
            break
        seen.update(j.external_id for j in fresh)
        yield from maybe_enrich(fresh, ctx)
        if isinstance(page_count, int) and page >= page_count:
            break


def _fallback(src: Source, ctx: FetchContext) -> Iterator[Job]:
    data = next_data(ctx.http.get(BASE + "/jobs")) or {}
    items = dig(data, "props.pageProps.initialJobList.jobListItems") or []
    jobs = [j for j in (item_to_job(i, src.name) for i in items if isinstance(i, dict)) if j]
    yield from maybe_enrich(jobs, ctx)


def sources() -> list[Source]:
    return [Source(name=NAME, source_type=PLATFORM, label="Techcareer.net", fetcher=fetch,
                   homepage=BASE + "/jobs")]
