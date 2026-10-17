"""Şirketlerin kendi kariyer sayfalarında kullandığı ATS'lerin (aday takip sistemi) herkese
açık iş panosu API'leri için uyarlayıcılar.

Her uyarlayıcı `fetch_<ats>(src, ctx) -> Iterator[Job]` imzasına sahiptir ve ayarlarını
`src.params` içinden okur (bkz. data/companies.json). Yalnızca İstanbul ilanları (ve
`include_remote_tr` açıksa "Remote, Türkiye" gibi Türkiye'ye açık uzaktan ilanlar) döner.

Desteklenenler: greenhouse, lever, workable, smartrecruiters, ashby, recruitee, teamtailor,
personio, breezy, workday, oracle (Oracle Recruiting Cloud / HCM Candidate Experience).
"""
from __future__ import annotations

import logging
import re
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Callable, Iterable, Iterator
from urllib.parse import quote, urlencode

from ..geo import detect_district, is_istanbul
from ..http import HttpError
from ..models import COMPANY, SOURCE_TYPES, Job
from ..text import clean, fold, strip_html
from .base import FetchContext, Source

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Ortak yardımcılar
# ---------------------------------------------------------------------------

_TR_TOKENS = {"turkey", "turkiye", "tr", "tur"}
_REMOTE_TOKENS = ("remote", "uzaktan", "home office", "work from home", "anywhere")


def _ist(text: str) -> bool:
    if not text:
        return False
    try:
        return bool(is_istanbul(text))
    except NotImplementedError:  # geo henüz hazır değilse kaba yedek
        return "istanbul" in fold(text)


def _district(text: str) -> str | None:
    try:
        return detect_district(text) if text else None
    except NotImplementedError:
        return None


def _mentions_turkey(text: str) -> bool:
    return bool(_TR_TOKENS & set(fold(text).split()))


def _mentions_remote(text: str) -> bool:
    f = fold(text)
    return any(t in f for t in _REMOTE_TOKENS)


def _work_model(value) -> str:
    """API'lerin farklı yazımlarını "remote" / "hybrid" / "onsite" / "" değerine indirger."""
    f = fold(str(value or ""))
    if not f or f in ("unspecified", "none", "null"):
        return ""
    if "hybrid" in f or "hibrit" in f:
        return "hybrid"
    if "remote" in f or "uzaktan" in f or f in ("fully", "telecommute"):
        return "remote"
    if f.replace(" ", "") in ("onsite", "oraonsite", "office", "inoffice") or "on site" in f or "ofis" in f:
        return "onsite"
    return ""


_EMP = {
    "fulltime": "Full-time", "full": "Full-time", "full time": "Full-time", "permanent": "Permanent",
    "parttime": "Part-time", "part": "Part-time", "part time": "Part-time",
    "intern": "Internship", "internship": "Internship", "contract": "Contract", "contractor": "Contract",
    "temporary": "Temporary", "temp": "Temporary", "freelance": "Freelance", "trainee": "Trainee",
    "other": "", "": "",
}


def _emp(value) -> str:
    raw = clean(value)
    key = fold(raw).replace("_", " ")
    for k in (key, key.replace(" ", "")):
        if k in _EMP:
            return _EMP[k]
    return raw


def _iso(value) -> str | None:
    """Zaman damgasını ISO-8601 metnine çevirir (ms epoch, ISO, RFC-822, "... UTC")."""
    if value in (None, "", 0):
        return None
    if isinstance(value, (int, float)):
        ts = value / 1000 if value > 1e11 else value
        return datetime.fromtimestamp(ts, timezone.utc).isoformat(timespec="seconds")
    s = clean(value)
    s2 = re.sub(r"\s+UTC$", "+00:00", s)
    try:
        return datetime.fromisoformat(s2).isoformat(timespec="seconds") if "T" in s2 or " " in s2 \
            else date.fromisoformat(s2[:10]).isoformat()
    except ValueError:
        pass
    try:
        return parsedate_to_datetime(s).isoformat(timespec="seconds")
    except (TypeError, ValueError, IndexError):
        pass
    m = re.match(r"\d{4}-\d{2}-\d{2}", s)
    return m.group(0) if m else None


def _relative_date(text: str, today: date | None = None) -> str | None:
    """Workday "Posted 3 Days Ago" / "Posted Yesterday" / "30+ Gün Önce" -> ISO tarih."""
    f = fold(text or "")
    if not f:
        return None
    today = today or datetime.now(timezone.utc).date()
    if "today" in f or "bugun" in f:
        return today.isoformat()
    if "yesterday" in f or "dun" in f.split():
        return (today - timedelta(days=1)).isoformat()
    m = re.search(r"(\d+)", f)
    if m and ("day" in f or "gun" in f):
        return (today - timedelta(days=int(m.group(1)))).isoformat()
    return None


def _join(*parts) -> str:
    out: list[str] = []
    for p in parts:
        p = clean(p)
        if p and p not in out:
            out.append(p)
    return ", ".join(out)


def _name(v) -> str:
    """{"name": ..} / {"label": ..} / düz metin alanlarını metne çevirir."""
    if isinstance(v, dict):
        return clean(v.get("name") or v.get("label") or v.get("descriptor") or v.get("text"))
    if isinstance(v, list):
        return ", ".join(x for x in (_name(i) for i in v) if x)
    return clean(v)


def _ats_key(src: Source) -> str:
    p = src.params
    return clean(p.get("slug") or p.get("tenant") or p.get("host") or src.name)


def _decide(src: Source, locations: Iterable[str], work_model: str = "",
            remote_flag: bool = False) -> tuple[bool, str, str]:
    """İlan tutulmalı mı? -> (tut, konum metni, çalışma modeli)."""
    locs = [clean(l) for l in locations if clean(l)]
    for loc in locs:
        if _ist(loc):
            return True, loc, work_model
    if src.params.get("include_remote_tr", True):
        all_text = " | ".join(locs)
        remote = remote_flag or work_model == "remote" or _mentions_remote(all_text)
        if remote and _mentions_turkey(all_text):
            tr_locs = [l for l in locs if _mentions_turkey(l)]
            return True, tr_locs[0] if tr_locs else all_text, "remote"
    return False, " | ".join(locs), work_model


def _job(src: Source, ats: str, *, external_id, title, url, location, company="", **kw) -> Job:
    district = _district(location) or _district(title)
    return Job(
        source=f"{ats}:{_ats_key(src)}",
        source_type=src.source_type if src.source_type in SOURCE_TYPES else COMPANY,
        external_id=clean(external_id) or url,
        title=clean(title),
        company=clean(src.params.get("company")) or clean(company) or src.label,
        url=url,
        location=location,
        district=district,
        **kw,
    )


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _child(el: ET.Element, name: str) -> ET.Element | None:
    for c in el:
        if _local(c.tag) == name:
            return c
    return None


def _ctext(el: ET.Element | None, name: str) -> str:
    c = _child(el, name) if el is not None else None
    return clean(c.text) if c is not None and c.text else ""


def _parse_xml(txt: str) -> ET.Element:
    return ET.fromstring(txt.lstrip("﻿").strip().encode("utf-8"))


# ---------------------------------------------------------------------------
# Greenhouse — https://developers.greenhouse.io/job-board.html
# ---------------------------------------------------------------------------

def _greenhouse_board_page(src: Source, ctx: FetchContext, slug: str) -> Iterator[Job]:
    from .careerpage import fetch_careerpage

    host = "job-boards.eu.greenhouse.io" if src.params.get("region") == "eu" else "job-boards.greenhouse.io"
    params = {"company": src.params.get("company") or src.label, "careers_url": f"https://{host}/{slug}",
              "link_pattern": rf"/{re.escape(slug)}/jobs/\d+", "no_ats_detect": True, "max_jobs": 150}
    sub = Source(name=src.name, source_type=src.source_type, label=src.label, fetcher=fetch_careerpage,
                 homepage=params["careers_url"], params=params)
    yield from fetch_careerpage(sub, ctx)


def fetch_greenhouse(src: Source, ctx: FetchContext) -> Iterator[Job]:
    slug = src.params["slug"]
    # AB panoları (job-boards.eu.greenhouse.io): boards-api.eu.greenhouse.io gerçek taramada çözümlenmedi;
    # genel API başarısız olursa pano sayfası genel kariyer sayfası tarayıcısıyla okunur
    try:
        data = ctx.http.get_json(f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true")
    except HttpError as e:
        if src.params.get("region") != "eu" and e.status != 404:
            raise
        yield from _greenhouse_board_page(src, ctx, slug)
        return
    for j in data.get("jobs", []):
        locs = [_name(j.get("location"))]
        for o in j.get("offices") or []:
            locs += [clean(o.get("location")), clean(o.get("name"))]
        wm = _work_model(" ".join(locs))
        for m in j.get("metadata") or []:
            if "workplace" in fold(m.get("name", "")) or "remote" in fold(m.get("name", "")):
                wm = _work_model(_name(m.get("value"))) or wm
        keep, loc, wm = _decide(src, locs, wm)
        if not keep:
            continue
        yield _job(src, "greenhouse", external_id=j.get("id"), title=j.get("title"),
                   url=clean(j.get("absolute_url")), location=loc, company=j.get("company_name", ""),
                   posted_at=_iso(j.get("first_published") or j.get("updated_at")),
                   work_model=wm, description=strip_html(j.get("content", "")),
                   category=_name(j.get("departments")),
                   extra={"requisition_id": clean(j.get("requisition_id"))} if j.get("requisition_id") else {})


# ---------------------------------------------------------------------------
# Lever — https://github.com/lever/postings-api
# ---------------------------------------------------------------------------

def fetch_lever(src: Source, ctx: FetchContext) -> Iterator[Job]:
    slug = src.params["slug"]
    host = "api.eu.lever.co" if src.params.get("region") == "eu" else "api.lever.co"
    data = ctx.http.get_json(f"https://{host}/v0/postings/{slug}?mode=json")
    for p in data if isinstance(data, list) else []:
        cat = p.get("categories") or {}
        locs = [clean(cat.get("location"))] + [clean(x) for x in cat.get("allLocations") or []]
        country = clean(p.get("country")).upper()
        wm = _work_model(p.get("workplaceType"))
        keep, loc, wm = _decide(src, locs + (["Turkey"] if country == "TR" else []), wm)
        if not keep:
            continue
        sal = p.get("salaryRange") or {}
        salary = " ".join(x for x in (f"{sal.get('min')}-{sal.get('max')}", clean(sal.get("currency")),
                                      clean(sal.get("interval"))) if x) if sal.get("min") else ""
        yield _job(src, "lever", external_id=p.get("id"), title=p.get("text"),
                   url=clean(p.get("hostedUrl") or p.get("applyUrl")), location=loc,
                   posted_at=_iso(p.get("createdAt")), employment_type=_emp(cat.get("commitment")),
                   work_model=wm,
                   description=strip_html(p.get("descriptionPlain") or p.get("description") or ""),
                   salary=salary, category=_join(cat.get("team"), cat.get("department")))


# ---------------------------------------------------------------------------
# Workable — POST apply.workable.com/api/v3/accounts/{slug}/jobs (nextPage -> token);
# yedek: GET apply.workable.com/api/v1/widget/accounts/{slug}
# ---------------------------------------------------------------------------

def _workable_loc(loc: dict | None) -> str:
    loc = loc or {}
    return _join(loc.get("city"), loc.get("region"), loc.get("country"))


def _workable_v3(src: Source, ctx: FetchContext) -> Iterator[Job]:
    slug = src.params["slug"]
    url = f"https://apply.workable.com/api/v3/accounts/{slug}/jobs"
    body: dict = {"query": "", "location": [], "department": [], "worktype": [], "remote": []}
    seen: set[str] = set()
    for _page in range(max(1, ctx.max_pages)):
        data = ctx.http.post_json(url, body)
        for r in data.get("results") or []:
            sc = clean(r.get("shortcode"))
            if not sc or sc in seen or r.get("isInternal"):
                continue
            seen.add(sc)
            locs = [_workable_loc(r.get("location"))] + [_workable_loc(x) for x in r.get("locations") or []]
            wm = _work_model(r.get("workplace")) or ("remote" if r.get("remote") else "")
            keep, loc, wm = _decide(src, locs, wm, bool(r.get("remote")))
            if not keep:
                continue
            dep = r.get("department")
            yield _job(src, "workable", external_id=sc, title=r.get("title"),
                       url=f"https://apply.workable.com/{slug}/j/{sc}/", location=loc,
                       posted_at=_iso(r.get("published")), employment_type=_emp(r.get("type")),
                       work_model=wm, description=strip_html(r.get("description", "")),
                       category=", ".join(map(clean, dep)) if isinstance(dep, list) else clean(dep))
        token = data.get("nextPage")
        if not token or not ctx.time_left():
            break
        body = {**body, "token": token}


def _workable_v1(src: Source, ctx: FetchContext) -> Iterator[Job]:
    slug = src.params["slug"]
    data = ctx.http.get_json(f"https://apply.workable.com/api/v1/widget/accounts/{slug}")
    for j in data.get("jobs") or []:
        locs = [_join(j.get("city"), j.get("state"), j.get("country"))]
        locs += [_workable_loc(x) for x in j.get("locations") or [] if not x.get("hidden")]
        remote = bool(j.get("telecommuting"))
        keep, loc, wm = _decide(src, locs, "remote" if remote else "", remote)
        if not keep:
            continue
        sc = clean(j.get("shortcode"))
        yield _job(src, "workable", external_id=sc or j.get("url"), title=j.get("title"),
                   url=f"https://apply.workable.com/{slug}/j/{sc}/" if sc else clean(j.get("url")),
                   location=loc, posted_at=_iso(j.get("published_on") or j.get("created_at")),
                   employment_type=_emp(j.get("employment_type")), work_model=wm,
                   description=strip_html(j.get("description", "")), category=clean(j.get("department")))


def fetch_workable(src: Source, ctx: FetchContext) -> Iterator[Job]:
    if src.params.get("api") == "v1":
        yield from _workable_v1(src, ctx)
        return
    started = False
    try:
        for job in _workable_v3(src, ctx):
            started = True
            yield job
    except HttpError as e:
        if started:
            raise
        ctx.log.info("workable v3 başarısız (%s), v1 widget deneniyor", e)
        yield from _workable_v1(src, ctx)


# ---------------------------------------------------------------------------
# SmartRecruiters — https://developers.smartrecruiters.com/docs/posting-api
# ---------------------------------------------------------------------------

def fetch_smartrecruiters(src: Source, ctx: FetchContext) -> Iterator[Job]:
    slug = src.params["slug"]
    base = f"https://api.smartrecruiters.com/v1/companies/{slug}/postings"
    country = src.params.get("country", "tr")  # "" -> süzgeçsiz
    offset, limit, total = 0, 100, None
    for _page in range(max(1, ctx.max_pages)):
        q = {"offset": offset, "limit": limit}
        if country:
            q["country"] = country
        data = ctx.http.get_json(f"{base}?{urlencode(q)}")
        content = data.get("content") or []
        total = data.get("totalFound", total)
        for p in content:
            loc = p.get("location") or {}
            full = clean(loc.get("fullLocation")) or _join(loc.get("city"), loc.get("region"), loc.get("country"))
            c = clean(loc.get("country")).lower()
            remote = bool(loc.get("remote"))
            wm = "remote" if remote else "hybrid" if loc.get("hybrid") else ""
            keep, lt, wm = _decide(src, [full] + (["Turkey"] if c == "tr" else []), wm, remote)
            if not keep:
                continue
            pid = clean(p.get("id"))
            desc, url = "", f"https://jobs.smartrecruiters.com/{slug}/{pid}"
            if ctx.fetch_details and p.get("ref") and ctx.time_left():
                try:
                    d = ctx.http.get_json(p["ref"])
                    secs = (d.get("jobAd") or {}).get("sections") or {}
                    desc = strip_html(" ".join((secs.get(k) or {}).get("text", "")
                                               for k in ("jobDescription", "qualifications")))
                    url = clean(d.get("postingUrl")) or url
                except HttpError as e:
                    ctx.log.debug("smartrecruiters detay hatası: %s", e)
            yield _job(src, "smartrecruiters", external_id=pid, title=p.get("name"), url=url,
                       location=lt, company=_name(p.get("company")), posted_at=_iso(p.get("releasedDate")),
                       employment_type=_emp(_name(p.get("typeOfEmployment"))), work_model=wm,
                       description=desc, category=_name(p.get("department")) or _name(p.get("function")))
        offset += len(content)
        if not content or (total is not None and offset >= total) or not ctx.time_left():
            break


# ---------------------------------------------------------------------------
# Ashby — https://developers.ashbyhq.com/docs/public-job-posting-api
# ---------------------------------------------------------------------------

def _ashby_addr(a) -> str:
    pa = (a or {}).get("postalAddress") or {}
    return _join(pa.get("addressLocality"), pa.get("addressRegion"), pa.get("addressCountry"))


def fetch_ashby(src: Source, ctx: FetchContext) -> Iterator[Job]:
    slug = src.params["slug"]
    data = ctx.http.get_json(f"https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true")
    for j in data.get("jobs") or []:
        if j.get("isListed") is False:
            continue
        locs = [clean(j.get("location")), _ashby_addr(j.get("address"))]
        for s in j.get("secondaryLocations") or []:
            locs += [clean(s.get("location")), _ashby_addr(s.get("address"))]
        remote = bool(j.get("isRemote"))
        wm = _work_model(j.get("workplaceType")) or ("remote" if remote else "")
        keep, loc, wm = _decide(src, locs, wm, remote)
        if not keep:
            continue
        comp = j.get("compensation") or {}
        yield _job(src, "ashby", external_id=j.get("id") or j.get("jobUrl"), title=j.get("title"),
                   url=clean(j.get("jobUrl") or j.get("applyUrl")), location=loc,
                   posted_at=_iso(j.get("publishedAt")), employment_type=_emp(j.get("employmentType")),
                   work_model=wm,
                   description=strip_html(j.get("descriptionPlain") or j.get("descriptionHtml") or ""),
                   salary=clean(comp.get("scrapeableCompensationSalarySummary")
                                or comp.get("compensationTierSummary")),
                   category=_join(j.get("department"), j.get("team")))


# ---------------------------------------------------------------------------
# Recruitee — GET https://{slug}.recruitee.com/api/offers/
# ---------------------------------------------------------------------------

def fetch_recruitee(src: Source, ctx: FetchContext) -> Iterator[Job]:
    slug = src.params["slug"]
    data = ctx.http.get_json(f"https://{slug}.recruitee.com/api/offers/")
    for o in data.get("offers") or []:
        if o.get("status") not in (None, "published"):
            continue
        locs = [clean(o.get("location")), _join(o.get("city"), o.get("state_name"), o.get("country"))]
        for l in o.get("locations") or []:
            locs.append(_join(l.get("name"), l.get("city"), l.get("state"), l.get("country")))
        if clean(o.get("country_code")).upper() == "TR":
            locs.append("Turkey")
        wm = ("remote" if o.get("remote") else "hybrid" if o.get("hybrid")
              else "onsite" if o.get("on_site") else "")
        keep, loc, wm = _decide(src, locs, wm, bool(o.get("remote")))
        if not keep:
            continue
        sal = o.get("salary")
        salary = ""
        if isinstance(sal, dict) and (sal.get("min") or sal.get("max")):
            salary = " ".join(x for x in (f"{sal.get('min') or ''}-{sal.get('max') or ''}".strip("-"),
                                          clean(sal.get("currency")), clean(sal.get("period"))) if x)
        slug_o = clean(o.get("slug"))
        yield _job(src, "recruitee", external_id=o.get("id"), title=o.get("title"),
                   url=clean(o.get("careers_url")) or f"https://{slug}.recruitee.com/o/{slug_o}",
                   location=loc, company=o.get("company_name", ""),
                   posted_at=_iso(o.get("published_at") or o.get("created_at")),
                   employment_type=_emp(o.get("employment_type_code")), work_model=wm,
                   description=strip_html(o.get("description", "")), salary=salary,
                   category=clean(o.get("department")))


# ---------------------------------------------------------------------------
# Teamtailor — kariyer sitesinin herkese açık RSS'i: https://{slug}.teamtailor.com/jobs.rss
# (ad alanı xmlns:tt="https://teamtailor.com/locations"; remoteStatus: fully/hybrid/onsite/none)
# ---------------------------------------------------------------------------

def fetch_teamtailor(src: Source, ctx: FetchContext) -> Iterator[Job]:
    p = src.params
    host = clean(p.get("host")) or f"{p['slug']}.teamtailor.com"
    root = _parse_xml(ctx.http.get(f"https://{host}/jobs.rss?per_page=500"))
    for item in root.iter():
        if _local(item.tag) != "item":
            continue
        locs: list[str] = []
        lwrap = _child(item, "locations")
        for l in (lwrap if lwrap is not None else []):
            locs.append(_join(_ctext(l, "name"), _ctext(l, "city"), _ctext(l, "country")))
        rs = _ctext(item, "remoteStatus")
        wm = {"fully": "remote", "hybrid": "hybrid", "onsite": "onsite"}.get(rs.lower(), "")
        keep, loc, wm = _decide(src, locs, wm, wm == "remote")
        if not keep:
            continue
        link = _ctext(item, "link")
        yield _job(src, "teamtailor", external_id=_ctext(item, "guid") or link, title=_ctext(item, "title"),
                   url=link, location=loc, posted_at=_iso(_ctext(item, "pubDate")), work_model=wm,
                   description=strip_html(_ctext(item, "description")),
                   category=_join(_ctext(item, "department"), _ctext(item, "role")))


# ---------------------------------------------------------------------------
# Personio — XML: https://{slug}.jobs.personio.de/xml (".com" de aynı içerik)
# ---------------------------------------------------------------------------

def fetch_personio(src: Source, ctx: FetchContext) -> Iterator[Job]:
    p = src.params
    slug = p["slug"]
    tlds = [p["tld"]] if p.get("tld") else ["de", "com"]
    lang = p.get("language", "en")
    txt, tld = "", tlds[0]
    for i, tld in enumerate(tlds):
        try:
            txt = ctx.http.get(f"https://{slug}.jobs.personio.{tld}/xml?language={lang}")
            break
        except HttpError:
            if i == len(tlds) - 1:
                raise
    root = _parse_xml(txt)
    for pos in root.iter("position"):
        offices = [_ctext(pos, "office")]
        add = _child(pos, "additionalOffices")
        offices += [clean(o.text) for o in (add if add is not None else []) if o.text]
        keep, loc, wm = _decide(src, offices, _work_model(" ".join(offices)))
        if not keep:
            continue
        descs = []
        jd = _child(pos, "jobDescriptions")
        for d in (jd if jd is not None else []):
            descs.append(f"{_ctext(d, 'name')}: {_ctext(d, 'value')}")
        pid = _ctext(pos, "id")
        yield _job(src, "personio", external_id=pid, title=_ctext(pos, "name"),
                   url=f"https://{slug}.jobs.personio.{tld}/job/{pid}", location=loc,
                   company=_ctext(pos, "subcompany"), posted_at=_iso(_ctext(pos, "createdAt")),
                   employment_type=_join(_emp(_ctext(pos, "schedule")), _emp(_ctext(pos, "employmentType"))),
                   work_model=wm, description=strip_html(" ".join(descs)),
                   category=_join(_ctext(pos, "department"), _ctext(pos, "recruitingCategory")),
                   extra={"seniority": _ctext(pos, "seniority")} if _ctext(pos, "seniority") else {})


# ---------------------------------------------------------------------------
# Breezy HR — GET https://{slug}.breezy.hr/json
# ---------------------------------------------------------------------------

def _breezy_loc(l) -> tuple[str, bool]:
    if not isinstance(l, dict):
        return clean(l), False
    country = l.get("country")
    country_s = _name(country)
    code = clean(country.get("id")) if isinstance(country, dict) else ""
    txt = _join(l.get("name"), l.get("city"), _name(l.get("state")), country_s)
    if code.upper() == "TR" and not _mentions_turkey(txt):
        txt = _join(txt, "Turkey")
    return txt, bool(l.get("is_remote"))


def fetch_breezy(src: Source, ctx: FetchContext) -> Iterator[Job]:
    slug = src.params["slug"]
    data = ctx.http.get_json(f"https://{slug}.breezy.hr/json")
    for j in data if isinstance(data, list) else []:
        pairs = [_breezy_loc(j.get("location"))] + [_breezy_loc(l) for l in j.get("locations") or []]
        remote = any(r for _, r in pairs)
        keep, loc, wm = _decide(src, [t for t, _ in pairs], "remote" if remote else "", remote)
        if not keep:
            continue
        fid = clean(j.get("friendly_id"))
        yield _job(src, "breezy", external_id=j.get("id") or fid, title=j.get("name"),
                   url=clean(j.get("url")) or f"https://{slug}.breezy.hr/p/{fid}", location=loc,
                   company=_name(j.get("company")), posted_at=_iso(j.get("published_date")),
                   employment_type=_emp(_name(j.get("type"))), work_model=wm,
                   description=strip_html(j.get("description", "")), salary=clean(j.get("salary")),
                   category=_name(j.get("department")))


# ---------------------------------------------------------------------------
# Workday — POST https://{host}/wday/cxs/{tenant}/{site}/jobs
# ---------------------------------------------------------------------------

def _walk_facets(facets, parent_param: str = ""):
    """(facetParameter, descriptor, id, count) dörtlüleri; iç içe gruplar dahil."""
    for f in facets or []:
        if not isinstance(f, dict):
            continue
        param = f.get("facetParameter") or parent_param
        if "id" in f and "descriptor" in f and "values" not in f:
            yield param, clean(f.get("descriptor")), f["id"], int(f.get("count") or 0)
        if f.get("values"):
            yield from _walk_facets(f["values"], param)


def _workday_istanbul_facet(facets) -> tuple[str, list[str], str] | None:
    """Konum facet'leri arasında İstanbul geçen değerleri bulur; en çok ilanı kapsayan
    tek facet parametresini seçer -> (param, [id], açıklama)."""
    groups: dict[str, list[tuple[str, str, int]]] = {}
    for param, desc, fid, count in _walk_facets(facets):
        if "location" in param.lower() and _ist(desc):
            groups.setdefault(param, []).append((desc, fid, count))
    if not groups:
        return None
    param, vals = max(groups.items(), key=lambda kv: sum(v[2] for v in kv[1]))
    return param, [v[1] for v in vals], vals[0][0]


def fetch_workday(src: Source, ctx: FetchContext) -> Iterator[Job]:
    p = src.params
    host, tenant, site = p["host"], p["tenant"], p["site"]
    api = f"https://{host}/wday/cxs/{tenant}/{site}"
    headers = {"Accept-Language": "en-US,en;q=0.9"}
    limit = 20  # Workday sayfa boyutunu 20 ile sınırlar

    warmed = False

    def warm_up():
        """Tarayıcı gibi önce kariyer sayfasını açıp oturum çerezlerini ve CSRF anahtarını al.
        Workday bu çerezler olmadan API'ye JSON yerine HTML/boş yanıt dönebiliyor."""
        nonlocal warmed
        warmed = True
        site_url = p.get("job_url_base") or f"https://{host}/{site}"
        try:
            ctx.http.get(site_url, headers={"Accept": "text/html"})
        except HttpError as e:
            ctx.log.debug("workday karşılama sayfası alınamadı: %s", e)
        sess = getattr(ctx.http, "session", None)
        token = sess.cookies.get("CALYPSO_CSRF_TOKEN") if sess is not None else None
        headers.update({"Origin": f"https://{host}", "Referer": site_url, "Content-Type": "application/json"})
        if token:
            headers["X-CALYPSO-CSRF-TOKEN"] = token

    def page(offset: int, facets: dict, search: str) -> dict:
        body = {"appliedFacets": facets, "limit": limit, "offset": offset, "searchText": search}
        try:
            data = ctx.http.post_json(f"{api}/jobs", body, headers=headers)
        except (ValueError, HttpError) as e:
            if warmed or (isinstance(e, HttpError) and e.status not in (400, 401, 403, 422)):
                raise
            warm_up()
            data = ctx.http.post_json(f"{api}/jobs", body, headers=headers)
        if not isinstance(data, dict):
            raise ValueError(f"workday beklenmeyen yanıt: {str(data)[:120]}")
        return data

    first = page(0, {}, "")
    fac = _workday_istanbul_facet(first.get("facets"))
    if fac:
        param, ids, ist_desc = fac
        applied, search = {param: ids}, ""
    else:  # facet yoksa metin aramasına düş, yerel süzgeç uygula
        applied, search, ist_desc = {}, p.get("search_text", "Istanbul"), ""
    seen: set[str] = set()
    total = 0
    offset = 0
    for n in range(max(1, ctx.max_pages)):
        data = page(offset, applied, search)
        posts = data.get("jobPostings") or []
        total = max(total, int(data.get("total") or 0))  # sonraki sayfalarda total=0 dönebilir
        for j in posts:
            path = clean(j.get("externalPath"))
            if not path or path in seen:
                continue
            seen.add(path)
            lt = clean(j.get("locationsText"))
            keep, loc, wm = _decide(src, [lt], _work_model(lt))
            desc, emp, posted = "", clean(j.get("timeType")), _relative_date(j.get("postedOn", ""))
            if ctx.fetch_details and ctx.time_left():
                try:
                    info = ctx.http.get_json(f"{api}{path}", headers=headers).get("jobPostingInfo") or {}
                    dlocs = [clean(info.get("location"))] + [clean(x) for x in info.get("additionalLocations") or []]
                    keep2, loc2, wm2 = _decide(src, dlocs, _work_model(info.get("remoteType")))
                    if keep2:
                        keep, loc, wm = True, loc2, wm2 or wm
                    desc = strip_html(info.get("jobDescription", ""))
                    emp = clean(info.get("timeType")) or emp
                    posted = _iso(info.get("startDate")) or posted
                except HttpError as e:
                    ctx.log.debug("workday detay hatası: %s", e)
            if not keep and ist_desc:  # İstanbul facet'iyle süzülmüş "2 Locations" gibi ilanlar
                keep, loc = True, f"{ist_desc} ({lt})" if lt else ist_desc
            if not keep:
                continue
            bullets = j.get("bulletFields") or []
            yield _job(src, "workday", external_id=bullets[0] if bullets else path, title=j.get("title"),
                       url=f"{p.get('job_url_base') or f'https://{host}/{site}'}{path}", location=loc,
                       posted_at=posted, employment_type=_emp(emp), work_model=wm, description=desc)
        offset += limit
        if not posts or offset >= total or not ctx.time_left():
            break


# ---------------------------------------------------------------------------
# Oracle Recruiting Cloud (HCM Candidate Experience)
# GET https://{host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true
#     &expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber={site},limit=..,offset=..
# ---------------------------------------------------------------------------

def fetch_oracle(src: Source, ctx: FetchContext) -> Iterator[Job]:
    p = src.params
    host, site, lang = p["host"], p.get("site", "CX_1"), p.get("language", "en")
    limit, offset = int(p.get("page_size", 100)), 0
    for _page in range(max(1, ctx.max_pages)):
        finder = f"findReqs;siteNumber={site},facetsList=NONE,limit={limit},offset={offset},sortBy=POSTING_DATES_DESC"
        if p.get("keyword"):
            finder += f',keyword="{p["keyword"]}"'
        if p.get("location_filter"):  # ülke adı kabul eder (ör. "Turkey"); şehir adlarını yok sayar
            finder += f',location="{p["location_filter"]}"'
        url = (f"https://{host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true"
               f"&expand=requisitionList.secondaryLocations&finder={quote(finder, safe=';,=')}")
        data = ctx.http.get_json(url)
        items = data.get("items") or []
        reqs = (items[0].get("requisitionList") if items else None) or []
        total = int(items[0].get("TotalJobsCount") or 0) if items else 0
        for r in reqs:
            locs = [clean(r.get("PrimaryLocation"))] + [clean(s.get("Name")) for s in r.get("secondaryLocations") or []]
            if clean(r.get("PrimaryLocationCountry")).upper() == "TR":
                locs.append("Turkey")
            wm = _work_model(r.get("WorkplaceTypeCode") or r.get("WorkplaceType"))
            keep, loc, wm = _decide(src, locs, wm)
            if not keep:
                continue
            rid = clean(r.get("Id"))
            yield _job(src, "oracle", external_id=rid, title=r.get("Title"),
                       url=f"https://{host}/hcmUI/CandidateExperience/{lang}/sites/{site}/job/{rid}",
                       location=loc, posted_at=_iso(r.get("PostedDate")),
                       employment_type=_emp(r.get("JobSchedule") or r.get("ContractType")), work_model=wm,
                       description=strip_html(r.get("ShortDescriptionStr") or r.get("ExternalDescriptionStr") or ""),
                       category=_join(r.get("JobFamily"), r.get("Department")))
        offset += len(reqs)
        if not reqs or offset >= total or not ctx.time_left():
            break


# ---------------------------------------------------------------------------
# Kayıt defteri
# ---------------------------------------------------------------------------

FETCHERS: dict[str, Callable[[Source, FetchContext], Iterator[Job]]] = {
    "greenhouse": fetch_greenhouse,
    "lever": fetch_lever,
    "workable": fetch_workable,
    "smartrecruiters": fetch_smartrecruiters,
    "ashby": fetch_ashby,
    "recruitee": fetch_recruitee,
    "teamtailor": fetch_teamtailor,
    "personio": fetch_personio,
    "breezy": fetch_breezy,
    "workday": fetch_workday,
    "oracle": fetch_oracle,
}


_ENTERPRISE_ATS = {"successfactors", "sitemap", "sap", "phenom", "eightfold", "taleo", "icims"}


def make_source(entry: dict) -> Source | None:
    params = dict(entry)
    ats = clean(params.get("ats")).lower()
    if ats == "lever-eu":
        ats, params["region"] = "lever", "eu"
    if ats == "careerpage" or ats in _ENTERPRISE_ATS:  # kurumsal türleri ats_enterprise.py işler
        return None
    fetcher = FETCHERS.get(ats)
    if fetcher is None:
        log.warning("Bilinmeyen ATS %r (%s) atlandı", entry.get("ats"), entry.get("company"))
        return None
    key = clean(params.get("slug") or params.get("tenant") or params.get("host"))
    if not key:
        log.warning("%s kaydında slug/tenant yok: %s", ats, entry.get("company"))
        return None
    params["ats"] = ats
    st = params.get("source_type") or COMPANY
    return Source(name=f"{ats}:{key}", source_type=st if st in SOURCE_TYPES else COMPANY,
                  label=clean(params.get("company")) or key, fetcher=fetcher,
                  homepage=clean(params.get("careers_url")), params=params,
                  enabled=bool(params.get("enabled", True)))


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
