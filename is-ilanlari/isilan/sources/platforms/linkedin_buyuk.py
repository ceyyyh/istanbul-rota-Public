"""LinkedIn — büyük şirketler ve holdingler için şirket adıyla arama.

Genel İstanbul araması (linkedin.py) ~1000 sonuçla sınırlıdır; büyük şirketlerin ilanlarının çoğu bu
sınıra hiç girmez. Bu kaynak, büyük şirket kataloğundaki (bigco.py) her şirket adını İstanbul konumuyla
ayrı ayrı arar ve yalnızca şirket adı kataloğla eşleşen ilanları tutar.

Nazik ve dönüşümlü çalışır: her taramada kataloğun bir dilimini (`per_run` sorgu) arar, aramalar arasında
beklenir, LinkedIn 429/999 ile kısıtlarsa hemen durur; kaldığı yer kaydedilir ve sonraki tarama oradan
devam eder. Bu yüzden her tarama "eksik" sayılır; görülmeyen ilanlar yalnızca 7 gün sonra pasife alınır.
"""
from __future__ import annotations

import random
import time
from typing import Iterator

from ...bigco import GROUPS, group_of
from ...http import HttpError
from ...models import PLATFORM, Job
from ..base import FetchContext, Source
from .linkedin import EMPTY_PAGE, page_url, parse_cards

NAME = "linkedin-buyuk"


def queries() -> list[str]:
    """Her grup için ilk birkaç farklı şirket adı ("koc holding", "koc grubu" gibi aynı adın varyantları
    tek sayılır). Holdinglerde bağlı şirketler de aranır (Arçelik, Ford Otosan, Tüpraş ...)."""
    out: list[str] = []
    for _name, sector, aliases in GROUPS:
        limit = 6 if sector == "Holding" else 2
        firsts: set[str] = set()
        for a in aliases:
            a = a.strip()
            first = a.split()[0] if a else ""
            if len(a) < 4 or first in firsts or a in out:
                continue
            firsts.add(first)
            out.append(a)
            if len(firsts) >= limit:
                break
    return out


def fetch(src: Source, ctx: FetchContext) -> Iterator[Job]:
    p = src.params
    qs = queries()
    per_run = int(p.get("per_run", 80))
    delay = float(p.get("delay", 3.0))
    pages = int(p.get("pages", 2))
    state = ctx.state
    cursor = int(state.get("cursor", 0)) if state is not None else 0
    if cursor >= len(qs):
        cursor = 0
    seen: set[str] = set()
    done = 0
    try:
        while done < per_run and ctx.time_left():
            if cursor >= len(qs):
                cursor = 0
                if state is not None:
                    state.set("last_full_cycle", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
                if done:  # bir turu bu taramada tamamladıysak başa sarıp tekrar etme
                    break
            kw = qs[cursor]
            for page in range(pages):
                if done and delay > 0:
                    time.sleep(random.uniform(delay, delay * 2))
                url = page_url({"keywords": kw, "f_TPR": p.get("f_TPR", "r2592000")}, page * 10)
                try:
                    html = ctx.http.get(url, headers={"Accept": "text/html,*/*;q=0.8"}, retries=1)
                except HttpError as e:
                    if e.status in (429, 999, 403, None):
                        ctx.log.warning("linkedin-buyuk: '%s' araması kısıtlandı (%s); kaldığı yer kaydedildi", kw, e.status)
                        if not done and not seen:
                            raise
                        return
                    break  # 404 vb.: bu sorguyu atla
                cards = parse_cards(html) if html.strip() and html.strip() != EMPTY_PAGE else []
                matched = 0
                for j in cards:
                    if j.external_id in seen or not group_of(j.company):
                        continue
                    seen.add(j.external_id)
                    matched += 1
                    j.source, j.source_type = NAME, PLATFORM
                    yield j
                if len(cards) < 10 or not matched:  # son sayfa ya da şirketle ilgisiz sonuçlar
                    break
            cursor += 1
            done += 1
    finally:
        ctx.mark_partial("linkedin-buyuk dönüşümlü tarama")
        if state is not None:
            state.set("cursor", cursor)


def sources() -> list[Source]:
    return [Source(
        name=NAME,
        source_type=PLATFORM,
        label="LinkedIn (büyük şirketler)",
        homepage="https://www.linkedin.com/jobs/search?location=Istanbul",
        fetcher=fetch,
        params={"timeout": 1500},
    )]
