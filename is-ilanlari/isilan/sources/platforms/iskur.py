"""İŞKUR — esube.iskur.gov.tr açık iş ilanı araması (ASP.NET WebForms).

Akış (tarayıcının yaptığının aynısı, tek oturum çerezleriyle):
  1. GET  /Istihdam/AcikIsIlanAra.aspx  -> __VIEWSTATE, __EVENTVALIDATION, il seçimi `ctl04$ctlIl`
  2. POST tüm form alanları + __EVENTTARGET=ctl04$ctlAcikIsPageCommand$CommandItem_Search,
          ctl04$ctlIl=<İstanbul>  -> «Toplam Kayıt: N», «/ M Sayfaya Git», 15 satır
  3. POST sonuç sayfasının form alanları + __EVENTTARGET=ctl04$ctlDataPagerDetay$btnNext -> sonraki sayfa
Satır verisi, satırdaki paylaş düğmesinin (`a.share-toggle`) data-* özniteliklerinden okunur:
data-ilanno (11 hane), data-meslekler (meslek = başlık), data-isverentur (Özel/Kamu),
data-calismasekli, data-il ("İl Geneli Başvuru (Çalışma Yeri: İSTANBUL / KADIKÖY)"),
data-acikissayi, data-sontarih (son başvuru, GG.AA.YYYY).
İşveren adı yalnızca üye girişiyle görünür; bu yüzden `company` boş bırakılır (uydurulmaz).
"""
from __future__ import annotations

import re
from typing import Iterator

from ...models import PLATFORM, Job
from ...text import clean, fold
from ..base import FetchContext, Source
from ._cards import maybe_enrich, parse_html
from ._util import parse_any_date

NAME = "iskur"
BASE = "https://esube.iskur.gov.tr"
SEARCH = BASE + "/Istihdam/AcikIsIlanAra.aspx"
DETAIL = BASE + "/Istihdam/AcikIsIlanDetay.aspx?uiID="
IL_FIELD = "ctl04$ctlIl"
SEARCH_TARGET = "ctl04$ctlAcikIsPageCommand$CommandItem_Search"
NEXT_TARGET = "ctl04$ctlDataPagerDetay$btnNext"
ISTANBUL_CODE = "34"
_TOTAL = re.compile(r"Toplam Kayıt:\s*([\d.]+)")
_PAGES = re.compile(r"/\s*(\d+)\s*Sayfaya Git")
_SKIP_INPUT = {"submit", "button", "image", "reset", "file"}


def form_fields(html: str) -> list[tuple[str, str]]:
    """Tarayıcının göndereceği alanlar: gizli/metin girdiler, işaretli kutular, her select'in
    seçili seçeneği, textarea'lar — belge sırasıyla; olay çifti (__EVENTTARGET/ARGUMENT) hariç."""
    root = parse_html(html)
    out: list[tuple[str, str]] = []
    for n in root.iter():
        name = n.get("name")
        if not name or name in ("__EVENTTARGET", "__EVENTARGUMENT"):
            continue
        if n.tag == "input":
            typ = n.get("type", "text").lower()
            if typ in _SKIP_INPUT:
                continue
            if typ in ("checkbox", "radio"):
                if "checked" in n.attrs:
                    out.append((name, n.get("value", "on")))
                continue
            out.append((name, n.get("value")))
        elif n.tag == "select":
            opts = n.find_all("option")
            sel = next((o for o in opts if "selected" in o.attrs), opts[0] if opts else None)
            if sel is not None:
                out.append((name, sel.get("value", sel.text())))
        elif n.tag == "textarea":
            out.append((name, n.text()))
    return out


def istanbul_value(html: str) -> str:
    root = parse_html(html)
    sel = root.find("select", name=IL_FIELD)
    if sel is not None:
        for o in sel.find_all("option"):
            if fold(o.text()) == "istanbul":
                return o.get("value") or ISTANBUL_CODE
    return ISTANBUL_CODE


def postback_data(html: str, target: str, override: dict | None = None) -> list[tuple[str, str]]:
    override = override or {}
    fields = [(k, v) for k, v in form_fields(html) if k not in override]
    return [("__EVENTTARGET", target), ("__EVENTARGUMENT", "")] + fields + list(override.items())


def parse_rows(html: str, source: str = NAME) -> list[Job]:
    root = parse_html(html)
    out: list[Job] = []
    seen: set[str] = set()
    for a in root.find_all("a", "share-toggle"):
        d = {k[5:]: clean(v) for k, v in a.attrs.items() if k.startswith("data-")}
        ident = d.get("ilanno", "")
        if not ident or ident in seen:
            continue
        seen.add(ident)
        title = d.get("meslekler") or ""
        if not title:
            continue
        extra: dict = {}
        if d.get("isverentur"):
            extra["employer_type"] = d["isverentur"]
        if d.get("acikissayi", "").isdigit():
            extra["positions"] = int(d["acikissayi"])
        if d.get("sontarih"):
            extra["validThrough"] = parse_any_date(d["sontarih"]) or d["sontarih"]
        extra["company_hidden"] = True  # işveren adı üye girişi gerektirir
        out.append(Job(
            source=source, source_type=PLATFORM, external_id=ident, title=title, company="",
            url=DETAIL + ident, location=re.sub(r"\s+", " ", d.get("il", "")).strip(),
            employment_type=d.get("calismasekli", ""), extra=extra,
        ))
    return out


def total_pages(html: str) -> int | None:
    m = _PAGES.search(html or "")
    return int(m.group(1)) if m else None


def fetch(src: Source, ctx: FetchContext) -> Iterator[Job]:
    http = ctx.http
    page = http.get(SEARCH)
    if "__VIEWSTATE" not in page:
        raise RuntimeError("İŞKUR arama formu alınamadı (__VIEWSTATE yok; güvenlik duvarı sayfası?)")
    il = src.params.get("il") or istanbul_value(page)
    body = http.text(SEARCH, "POST", data=postback_data(page, SEARCH_TARGET, {IL_FIELD: il}),
                     headers={"Referer": SEARCH})
    m = _TOTAL.search(body)
    if m:
        ctx.log.info("iskur: Toplam Kayıt %s", m.group(1))
    pages = total_pages(body)
    seen: set[str] = set()
    for n in range(1, max(ctx.max_pages, 1) + 1):
        jobs = [j for j in parse_rows(body, src.name) if j.external_id not in seen]
        if not jobs:
            break
        seen.update(j.external_id for j in jobs)
        yield from maybe_enrich(jobs, ctx)
        if (pages is not None and n >= pages) or n >= ctx.max_pages or not ctx.time_left():
            break
        try:
            body = http.text(SEARCH, "POST", data=postback_data(body, NEXT_TARGET),
                             headers={"Referer": SEARCH})
        except Exception as e:  # noqa: BLE001 — toplanan ilanları kaybetme
            ctx.log.info("iskur: sayfa %d alınamadı (%r)", n + 1, e)
            break


def sources() -> list[Source]:
    return [Source(name=NAME, source_type=PLATFORM, label="İŞKUR", fetcher=fetch,
                   homepage=SEARCH, params={"il": ""})]

