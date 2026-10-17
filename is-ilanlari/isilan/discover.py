"""Bir şirketin hangi ATS'yi kullandığını, olası slug'ları deneyerek bulur."""
from __future__ import annotations

import logging

from .geo import is_istanbul
from .http import Http, HttpError
from .text import fold

log = logging.getLogger(__name__)

# ats -> (liste URL'si, json'dan ilan listesine, ilandan konum metnine, insan için URL)
PROBES = {
    "greenhouse": ("https://boards-api.greenhouse.io/v1/boards/{s}/jobs", lambda j: j.get("jobs", []),
                   lambda x: (x.get("location") or {}).get("name", ""), "https://boards.greenhouse.io/{s}"),
    "lever": ("https://api.lever.co/v0/postings/{s}?mode=json", lambda j: j if isinstance(j, list) else [],
              lambda x: (x.get("categories") or {}).get("location", ""), "https://jobs.lever.co/{s}"),
    "lever-eu": ("https://api.eu.lever.co/v0/postings/{s}?mode=json", lambda j: j if isinstance(j, list) else [],
                 lambda x: (x.get("categories") or {}).get("location", ""), "https://jobs.eu.lever.co/{s}"),
    "workable": ("https://apply.workable.com/api/v1/widget/accounts/{s}", lambda j: j.get("jobs", []),
                 lambda x: f"{x.get('city', '')} {x.get('country', '')}", "https://apply.workable.com/{s}"),
    "smartrecruiters": ("https://api.smartrecruiters.com/v1/companies/{s}/postings?limit=100", lambda j: j.get("content", []),
                        lambda x: " ".join(str(v) for v in (x.get("location") or {}).values() if isinstance(v, str)),
                        "https://jobs.smartrecruiters.com/{s}"),
    "ashby": ("https://api.ashbyhq.com/posting-api/job-board/{s}", lambda j: j.get("jobs", []),
              lambda x: x.get("location", ""), "https://jobs.ashbyhq.com/{s}"),
    "recruitee": ("https://{s}.recruitee.com/api/offers/", lambda j: j.get("offers", []),
                  lambda x: x.get("location", ""), "https://{s}.recruitee.com"),
    "breezy": ("https://{s}.breezy.hr/json", lambda j: j if isinstance(j, list) else [],
               lambda x: (x.get("location") or {}).get("name", ""), "https://{s}.breezy.hr"),
}


def slug_candidates(name: str) -> list[str]:
    f = fold(name)
    for suf in (" a s", " as", " teknoloji", " turkiye", " turkey", " inc", " ltd", " holding"):
        f = f.removesuffix(suf)
    words = f.split()
    cands = ["".join(words), "-".join(words), "_".join(words)]
    if words:
        cands.append(words[0])
    if name.strip() and " " not in name.strip():
        cands.insert(0, name.strip())
    out: list[str] = []
    for c in cands:
        if c and c not in out:
            out.append(c)
    return out


def probe_company(name_or_slug: str, company: str | None = None, http: Http | None = None) -> list[dict]:
    http = http or Http(min_interval=0.3, retries=1, timeout=15)
    found = []
    for slug in slug_candidates(name_or_slug):
        for ats, (url, items_of, loc_of, human) in PROBES.items():
            try:
                data = http.get_json(url.format(s=slug))
            except (HttpError, ValueError) as e:
                log.debug("%s/%s yok (%s)", ats, slug, e)
                continue
            items = items_of(data)
            if not items:
                continue
            ist = sum(1 for x in items if is_istanbul(loc_of(x) or ""))
            ats_name, extra = (("lever", {"region": "eu"}) if ats == "lever-eu" else (ats, {}))
            found.append({"ats": ats_name, "slug": slug, "jobs": len(items), "istanbul_jobs": ist,
                          "url": human.format(s=slug), **extra})
    return found
