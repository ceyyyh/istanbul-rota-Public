"""schema.org JobPosting (JSON-LD) çıkarıcı.

Çoğu iş platformu ve kariyer sitesi Google for Jobs için ilan detay sayfalarına
JobPosting JSON-LD gömer; bu nedenle siteye özel ayrıştırıcı olmayan her yerde
genel ve dayanıklı bir yöntemdir.
"""
from __future__ import annotations

import json
import re

from .models import Job
from .text import clean, strip_html

_SCRIPT = re.compile(r"<script[^>]+type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>", re.S | re.I)


def _walk(obj):
    if isinstance(obj, list):
        for x in obj:
            yield from _walk(x)
    elif isinstance(obj, dict):
        yield obj
        for k in ("@graph", "itemListElement", "item", "mainEntity"):
            if k in obj:
                yield from _walk(obj[k])


def _is_type(d: dict, t: str) -> bool:
    v = d.get("@type")
    return v == t or (isinstance(v, list) and t in v)


def extract_jobpostings(html: str) -> list[dict]:
    """Sayfadaki tüm JobPosting nesnelerini döner."""
    out = []
    for raw in _SCRIPT.findall(html or ""):
        raw = raw.strip().removeprefix("<!--").removesuffix("-->").strip()
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            try:  # bazı siteler kaçışsız satır sonu bırakır
                data = json.loads(re.sub(r"[\r\n\t]+", " ", raw))
            except json.JSONDecodeError:
                continue
        out.extend(d for d in _walk(data) if _is_type(d, "JobPosting"))
    return out


def _location_text(loc) -> str:
    parts: list[str] = []
    for item in loc if isinstance(loc, list) else [loc]:
        if isinstance(item, str):
            parts.append(item)
            continue
        if not isinstance(item, dict):
            continue
        addr = item.get("address", item)
        if isinstance(addr, str):
            parts.append(addr)
        elif isinstance(addr, dict):
            seg = [clean(addr.get(k)) for k in ("streetAddress", "addressLocality", "addressRegion")]
            parts.append(", ".join(s for s in seg if s and not isinstance(s, dict)))
    return " | ".join(p for p in parts if p)


def _org_name(org) -> str:
    if isinstance(org, dict):
        return clean(org.get("name"))
    if isinstance(org, list) and org:
        return _org_name(org[0])
    return clean(org) if isinstance(org, str) else ""


def _salary(s) -> str:
    if not isinstance(s, dict):
        return clean(s) if s else ""
    cur = s.get("currency", "")
    v = s.get("value", {})
    if isinstance(v, dict):
        lo, hi, unit = v.get("minValue"), v.get("maxValue"), v.get("unitText", "")
        val = v.get("value")
        rng = f"{lo}-{hi}" if lo and hi else str(val or lo or hi or "")
        return clean(f"{rng} {cur} {unit}") if rng else ""
    return clean(f"{v} {cur}")


def jobposting_to_job(d: dict, *, source: str, source_type: str, url: str = "",
                      company: str = "") -> Job:
    ident = d.get("identifier")
    if isinstance(ident, dict):
        ident = ident.get("value")
    emp = d.get("employmentType", "")
    if isinstance(emp, list):
        emp = ", ".join(map(str, emp))
    loc = _location_text(d.get("jobLocation"))
    work_model = ""
    if str(d.get("jobLocationType", "")).upper() == "TELECOMMUTE":
        work_model = "remote"
    job_url = clean(d.get("url")) or url
    return Job(
        source=source,
        source_type=source_type,
        external_id=clean(ident) or job_url,
        title=clean(d.get("title")),
        company=_org_name(d.get("hiringOrganization")) or company,
        url=job_url,
        location=loc,
        posted_at=clean(d.get("datePosted"))[:25] or None,
        employment_type=clean(emp),
        work_model=work_model,
        description=strip_html(d.get("description", "")),
        salary=_salary(d.get("baseSalary")),
        category=clean(d.get("occupationalCategory") if isinstance(d.get("occupationalCategory"), str) else ""),
        extra={"validThrough": clean(d.get("validThrough"))} if d.get("validThrough") else {},
    )
