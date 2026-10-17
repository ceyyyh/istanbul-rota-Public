"""Platform modüllerinin (yenibiris, secretcv, eleman.net ...) paylaştığı yardımcılar.

- Bağımlılıksız küçük bir HTML ağacı (`parse_html`), ilan kartlarını sınıf/öznitelikle
  bulmak için. Yalnızca stdlib `html.parser` kullanır; bozuk HTML'e karşı hoşgörülüdür.
- `enrich_from_detail`: detay sayfasındaki JobPosting JSON-LD ile karttan gelen ilanın
  boş alanlarını doldurur (asla uydurmaz; yalnızca sayfada olanı kullanır).
- `paginate`: ctx.max_pages / ctx.time_left() kurallarına uyan sayfa döngüsü.
"""
from __future__ import annotations

import json
import re
from html.parser import HTMLParser
from typing import Callable, Iterable, Iterator

from ...http import HttpError
from ...jsonld import extract_jobpostings, jobposting_to_job
from ...models import Job
from ...text import clean
from ..base import FetchContext

_VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
         "param", "source", "track", "wbr"}
_BLOCK = {"p", "div", "li", "br", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "ul", "ol",
          "section", "article", "header", "footer", "table", "dd", "dt"}
_WS = re.compile(r"\s+")


class Node:
    __slots__ = ("tag", "attrs", "children", "parent")

    def __init__(self, tag: str, attrs: dict[str, str] | None = None, parent: "Node | None" = None):
        self.tag = tag
        self.attrs = attrs or {}
        self.children: list["Node | str"] = []
        self.parent = parent

    # --- öznitelikler -------------------------------------------------------
    def get(self, name: str, default: str = "") -> str:
        v = self.attrs.get(name)
        return default if v is None else v

    @property
    def classes(self) -> list[str]:
        return self.get("class").split()

    def has_class(self, *names: str) -> bool:
        cs = self.classes
        return all(n in cs for n in names)

    # --- metin --------------------------------------------------------------
    def _texts(self, out: list[str], sep_blocks: bool) -> None:
        for c in self.children:
            if isinstance(c, str):
                out.append(c)
            elif c.tag in ("script", "style", "noscript"):
                continue
            else:
                if sep_blocks and c.tag in _BLOCK:
                    out.append("\n")
                c._texts(out, sep_blocks)
                if sep_blocks and c.tag in _BLOCK:
                    out.append("\n")

    def text(self) -> str:
        out: list[str] = []
        self._texts(out, False)
        return clean(_WS.sub(" ", "".join(out)))

    def lines(self) -> list[str]:
        """Metni <br> ve blok öğelerinden bölerek boş olmayan satırlar halinde döner."""
        out: list[str] = []
        self._texts(out, True)
        return [s for s in (clean(x) for x in "".join(out).split("\n")) if s]

    def raw_text(self) -> str:
        """script içeriği dahil ham metin (JSON blokları için)."""
        return "".join(c if isinstance(c, str) else c.raw_text() for c in self.children)

    # --- arama --------------------------------------------------------------
    def iter(self) -> Iterator["Node"]:
        for c in self.children:
            if isinstance(c, Node):
                yield c
                yield from c.iter()

    def find_all(self, tag: str | None = None, cls: str | None = None,
                 pred: Callable[["Node"], bool] | None = None, **attrs: str | bool) -> list["Node"]:
        """tag/sınıf/öznitelik eşleşen tüm alt düğümler. attrs değeri True ise yalnızca
        özniteliğin varlığı aranır; `data_ad_id` gibi adlar `data-ad-id`e çevrilir."""
        out = []
        tags = set(tag.split("|")) if tag else None
        want = {k.rstrip("_").replace("_", "-"): v for k, v in attrs.items()}
        for n in self.iter():
            if tags and n.tag not in tags:
                continue
            if cls and cls not in n.classes:
                continue
            ok = True
            for k, v in want.items():
                if k not in n.attrs or (v is not True and n.attrs.get(k) != v):
                    ok = False
                    break
            if ok and (pred is None or pred(n)):
                out.append(n)
        return out

    def find(self, tag: str | None = None, cls: str | None = None,
             pred: Callable[["Node"], bool] | None = None, **attrs: str | bool) -> "Node | None":
        r = self.find_all(tag, cls, pred, **attrs)
        return r[0] if r else None

    def ancestor(self, tag: str | None = None, cls: str | None = None) -> "Node | None":
        p = self.parent
        while p is not None:
            if (tag is None or p.tag == tag) and (cls is None or cls in p.classes):
                return p
            p = p.parent
        return None

    def __repr__(self) -> str:  # pragma: no cover
        return f"<{self.tag} {self.attrs}>"


class _Builder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("#root")
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = Node(tag, {k: (v if v is not None else "") for k, v in attrs}, self.stack[-1])
        self.stack[-1].children.append(node)
        if tag not in _VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        node = Node(tag, {k: (v if v is not None else "") for k, v in attrs}, self.stack[-1])
        self.stack[-1].children.append(node)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                return
        # eşleşmeyen kapanış etiketi: yok say

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def parse_html(html: str) -> Node:
    b = _Builder()
    try:
        b.feed(html or "")
        b.close()
    except Exception:  # noqa: BLE001 — bozuk HTML: o ana kadar kurulan ağaç kullanılır
        pass
    return b.root


# --- JSON blokları -----------------------------------------------------------

_NEXT_DATA = re.compile(r'<script[^>]+id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>', re.S | re.I)


def next_data(html: str) -> dict | None:
    m = _NEXT_DATA.search(html or "")
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError:
        return None


def dig(obj, path: str):
    for key in path.split("."):
        if isinstance(obj, dict):
            obj = obj.get(key)
        else:
            return None
    return obj


# --- detay zenginleştirme ------------------------------------------------------

def enrich_from_detail(job: Job, html: str) -> Job:
    """Detay sayfasındaki ilk JobPosting'den, karttaki boş alanları doldurur."""
    postings = extract_jobpostings(html)
    if not postings:
        return job
    d = jobposting_to_job(postings[0], source=job.source, source_type=job.source_type, url=job.url)
    for f in ("title", "company", "posted_at", "employment_type", "work_model", "description",
              "salary", "category"):
        if not getattr(job, f) and getattr(d, f):
            setattr(job, f, getattr(d, f))
    # JSON-LD konumu genelde il + ilçe içerir; karttaki konumdan daha ayrıntılıysa kullan
    if d.location and (not job.location or len(d.location) > len(job.location)):
        if job.location and job.location != d.location:
            job.extra.setdefault("list_location", job.location)
        job.location = d.location
    for k, v in d.extra.items():
        job.extra.setdefault(k, v)
    return job


def maybe_enrich(jobs: Iterable[Job], ctx: FetchContext, fetch: Callable[[str], str] | None = None) -> Iterator[Job]:
    """ctx.fetch_details açıksa her ilan için detay sayfasını çekip zenginleştirir.
    Tek bir detay sayfasındaki hata ilanı düşürmez."""
    fetch = fetch or ctx.http.get
    for job in jobs:
        if ctx.fetch_details and job.url and ctx.time_left():
            try:
                enrich_from_detail(job, fetch(job.url))
            except Exception as e:  # noqa: BLE001
                ctx.log.debug("%s detay alınamadı %s: %r", job.source, job.url, e)
        yield job


def paginate(ctx: FetchContext, fetch_page: Callable[[int], list[Job]], *, source: str,
             start: int = 1, last_page: Callable[[], int | None] | None = None) -> Iterator[Job]:
    """Sayfa sayfa ilan üretir. Yeni ilan çıkmayan sayfada, ctx.max_pages'te veya süre
    dolunca durur. İlk sayfadaki ağ hatası yukarı fırlatılır (kaynak 'hatalı' sayılır);
    sonraki sayfalardaki hata toplanan ilanları kaybetmemek için yalnızca günlüğe yazılır."""
    seen: set[str] = set()
    for page in range(start, start + max(ctx.max_pages, 1)):
        if page > start and not ctx.time_left():
            break
        try:
            jobs = fetch_page(page)
        except HttpError as e:
            if page == start:
                raise
            ctx.log.info("%s: sayfa %d alınamadı (%s); durduruluyor", source, page, e)
            break
        fresh = [j for j in jobs if j.external_id not in seen]
        if not fresh:
            break
        for j in fresh:
            seen.add(j.external_id)
        yield from maybe_enrich(fresh, ctx)
        lp = last_page() if last_page else None
        if lp is not None and page >= lp:
            break


# --- JS ağırlıklı siteler için genel (en iyi çaba) liste ayrıştırıcı ---------------

def generic_list(html: str, *, base: str, link_re: "re.Pattern[str]", source: str,
                 source_type: str, location_hint: str = "") -> list[Job]:
    """Önce sayfadaki JobPosting JSON-LD'lerini, yoksa `link_re` ile eşleşen ilan
    bağlantılarını okur. `link_re` 1. grubu ilan kimliği olmalıdır. Bağlantı kartında
    yalnızca başlık güvenle okunabilir; konum yalnızca `location_hint` (ör. "istanbul")
    geçen bir satırdan alınır, firma bilinmiyorsa boş kalır."""
    from ._util import abs_url  # döngüsel içe aktarmayı önlemek için yerel
    from ...text import fold

    out: list[Job] = []
    seen: set[str] = set()
    for d in extract_jobpostings(html):
        j = jobposting_to_job(d, source=source, source_type=source_type)
        if not j.url or not j.title:
            continue
        j.url = abs_url(base, j.url)
        m = link_re.search(j.url)
        j.external_id = m.group(1) if m else (j.external_id or j.url)
        if j.external_id not in seen:
            seen.add(j.external_id)
            out.append(j)
    if out:
        return out
    root = parse_html(html)
    for a in root.find_all("a", href=True):
        url = abs_url(base, a.get("href")).split("#")[0]
        m = link_re.search(url)
        if not m or m.group(1) in seen:
            continue
        head = a.find("h1|h2|h3|h4|h5|h6")
        title = (head.text() if head is not None else "") or clean(a.get("title"))
        # yaprak öğelerin metinleri (bitişik <span>'ler birleşmesin diye) + satırlar
        leaves = [n.text() for n in a.iter() if not any(isinstance(c, Node) for c in n.children)]
        lines = [x for x in leaves if x] + a.lines()
        if not title and lines:
            title = lines[0]
        if not title:
            continue
        seen.add(m.group(1))
        loc = ""
        if location_hint:
            loc = next((ln for ln in lines if location_hint in fold(ln) and ln != title), "")
        out.append(Job(source=source, source_type=source_type, external_id=m.group(1),
                       title=title, company="", url=url, location=loc))
    return out
