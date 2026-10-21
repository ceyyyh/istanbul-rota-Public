"""LinkedIn — büyük şirketler ve holdingler için şirket adıyla arama.

Genel İstanbul araması (linkedin.py) ~1000 sonuçla sınırlıdır; büyük şirketlerin ilanlarının çoğu bu
sınıra hiç girmez. Bu kaynak, büyük şirket kataloğundaki (bigco.py) her şirket adını İstanbul konumuyla
ayrı ayrı arar ve yalnızca şirket adı kataloğla eşleşen ilanları tutar.

Nazik ve dönüşümlü çalışır: her taramada önce odak listesinden küçük bir dilim (en çok 8 sorgu, ayrı
`focus_cursor` imleciyle döner), sonra kataloğun bir dilimini (toplam `per_run` sorgu) arar, aramalar arasında
beklenir, LinkedIn 429/999 ile kısıtlarsa hemen durur; kaldığı yer kaydedilir ve sonraki tarama oradan
devam eder. Bu yüzden her tarama "eksik" sayılır; görülmeyen ilanlar yalnızca 7 gün sonra pasife alınır.
"""
from __future__ import annotations

import random
import time
from typing import Iterator

from ...bigco import GROUPS, ODAK, group_of
from ...http import HttpError
from ...models import PLATFORM, Job
from ..base import FetchContext, Source
from .linkedin import EMPTY_PAGE, page_url, parse_cards

NAME = "linkedin-buyuk"
FOCUS_PER_RUN = 8  # her taramada aranacak en çok odak sorgusu (tüm liste focus_cursor ile döner)


def _alias_queries(groups) -> list[str]:
    out: list[str] = []
    for _name, sector, aliases in groups:
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


def queries() -> list[str]:
    """Her grup için ilk birkaç farklı şirket adı ("koc holding", "koc grubu" gibi aynı adın varyantları
    tek sayılır). Holdinglerde bağlı şirketler de aranır (Arçelik, Ford Otosan, Tüpraş ...)."""
    return _alias_queries(GROUPS)


def focus_queries() -> list[str]:
    """Odak bölge işverenlerinin (bigco.ODAK) sorguları: grup başına ilk şirket adı. Her taramada önce aranır."""
    out: list[str] = []
    for g in GROUPS:
        if g[0] in ODAK:
            out.extend(q for q in _alias_queries([(g[0], "", g[2])])[:1] if q not in out)
    return out


class _Throttled(Exception):
    pass


def _search(kw: str, p, ctx: FetchContext, seen: set[str], first: bool) -> Iterator[Job]:
    """Tek sorgunun sayfalarını gezer. Kısıtlamada _Throttled fırlatır (taramanın ilk isteğiyse HttpError)."""
    pages = int(p.get("pages", 2))
    delay = float(p.get("delay", 3.0))
    for page in range(pages):
        if (not first or page) and delay > 0:
            time.sleep(random.uniform(delay, delay * 2))
        url = page_url({"keywords": kw, "f_TPR": p.get("f_TPR", "r2592000")}, page * 10)
        try:
            html = ctx.http.get(url, headers={"Accept": "text/html,*/*;q=0.8"}, retries=1)
        except HttpError as e:
            if e.status in (429, 999, 403, None):
                ctx.log.warning("linkedin-buyuk: '%s' araması kısıtlandı (%s); kaldığı yer kaydedildi", kw, e.status)
                if first and not seen:
                    raise
                raise _Throttled()
            return  # 404 vb.: bu sorguyu atla
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
            return


def fetch(src: Source, ctx: FetchContext) -> Iterator[Job]:
    p = src.params
    all_focus = focus_queries()
    focus_set = set(all_focus)  # kesilmemiş tam liste: dönüşümlü kısımda tekrar aranmaz, odak imleciyle sırayla gezilir
    qs = [q for q in queries() if q not in focus_set]  # dönüşümlü kısım: odak sorguları hariç
    per_run = int(p.get("per_run", 80))
    # odak payı: taramada en çok `focus_per_run` (8) sorgu ve toplam sınırın yarısı; dönüşümlü kısım hep ilerler.
    # Odak listesi kendi imleciyle (focus_cursor) döner: tüm odak grupları birkaç taramada bir aranır.
    n_focus = min(int(p.get("focus_per_run", FOCUS_PER_RUN)), max(per_run // 2, 0), len(all_focus))
    state = ctx.state
    cursor = int(state.get("cursor", 0)) if state is not None else 0
    if cursor >= len(qs):
        cursor = 0
    fcursor = int(state.get("focus_cursor", 0)) % len(all_focus) if state is not None and all_focus else 0
    focus = [all_focus[(fcursor + i) % len(all_focus)] for i in range(n_focus)]
    seen: set[str] = set()
    done = 0
    try:
        for kw in focus:  # her taramada odak diliminden; imleç yalnız tamamlanan sorguyla ilerler (429'da kalır)
            if not ctx.time_left():
                return
            yield from _search(kw, p, ctx, seen, first=not done)
            done += 1
            fcursor = (fcursor + 1) % len(all_focus)
        while done < per_run and ctx.time_left() and qs:
            if cursor >= len(qs):
                cursor = 0
                if state is not None:
                    state.set("last_full_cycle", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
                if done > len(focus):  # bir turu bu taramada tamamladıysak başa sarıp tekrar etme
                    break
            yield from _search(qs[cursor], p, ctx, seen, first=not done)
            cursor += 1
            done += 1
    except _Throttled:
        return
    finally:
        ctx.mark_partial("linkedin-buyuk dönüşümlü tarama")
        if state is not None:
            state.set("cursor", cursor)
            if all_focus:
                state.set("focus_cursor", fcursor)


def sources() -> list[Source]:
    return [Source(
        name=NAME,
        source_type=PLATFORM,
        label="LinkedIn (büyük şirketler)",
        homepage="https://www.linkedin.com/jobs/search?location=Istanbul",
        fetcher=fetch,
        params={"timeout": 1500},
    )]
