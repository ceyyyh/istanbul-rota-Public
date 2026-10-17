"""Tarama hattı: kaynakları paralel çalıştırır, İstanbul dışını eler, ilçe tespit eder,
veritabanına yazar ve kaynak sağlığını kaydeder."""
from __future__ import annotations

import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

from .db import DB, dedupe_key, now_iso
from .classify import collar
from .geo import detect_district, is_istanbul, locate, side_of
from .http import Http, HttpError
from .models import Job
from .sources import FetchContext, Source, all_sources
from .text import fold, strip_html

log = logging.getLogger("isilan.pipeline")

_REMOTE_TR = {"turkiye", "turkey", "tr", "remote", "uzaktan", "fully", "full", "work", "from", "home", "evden", "calisma"}


class CountingHttp:
    """Bir kaynağın yaptığı istekleri sayar; sayfa sınırına takılıp takılmadığını anlamak için."""

    def __init__(self, http: Http):
        self._http = http
        self.n = 0

    def __getattr__(self, name):
        attr = getattr(self._http, name)
        if name in ("get", "get_json", "post_json", "text", "request", "browser_get"):
            def counted(*a, **kw):
                self.n += 1
                return attr(*a, **kw)
            return counted
        return attr


STALE_DAYS = 7  # eksik (sayfa/süre sınırına takılan) taramalarda: bu kadar gündür görünmeyen ilan pasife alınır


@dataclass
class CrawlOptions:
    max_pages: int = 150
    per_source_timeout: float = 1200  # saniye
    workers: int = 6
    fetch_details: bool = False
    use_browser: bool = False          # needs_browser kaynaklarını da çalıştır (Playwright gerekir)
    headless: bool = True              # False: tarayıcı penceresi görünür açılır (bot korumasını daha iyi geçer)
    profile_dir: str | None = None     # kalıcı tarayıcı profili (çerezler taramalar arasında saklanır)
    min_interval: float = 1.0          # aynı alan adına iki istek arası en az bekleme
    district_details: int = 200        # kaynak başına, ilçesi belirsiz yeni ilanlardan kaçının detay sayfasına bakılsın


@dataclass
class CrawlStatus:
    running: bool = False
    started_at: str | None = None
    finished_at: str | None = None
    done: int = 0
    total: int = 0
    current: list[str] = field(default_factory=list)
    log: list[str] = field(default_factory=list)
    results: dict[str, dict] = field(default_factory=dict)

    def add_log(self, msg: str):
        self.log.append(f"{time.strftime('%H:%M:%S')} {msg}")
        del self.log[:-200]

    def to_dict(self) -> dict:
        return {"running": self.running, "started_at": self.started_at, "finished_at": self.finished_at,
                "progress": {"done": self.done, "total": self.total, "current": ", ".join(self.current)},
                "log": self.log[-50:], "results": self.results}


def _as_text(v) -> str:
    """Kaynaklardan gelebilecek None / sayı / liste / sözlük değerlerini düz metne çevirir."""
    if v is None:
        return ""
    if isinstance(v, str):
        return v.strip()
    if isinstance(v, dict):
        v = v.get("name") or v.get("label") or v.get("text") or " ".join(str(x) for x in v.values() if isinstance(x, str))
        return _as_text(v)
    if isinstance(v, (list, tuple, set)):
        return ", ".join(t for t in (_as_text(x) for x in v) if t)
    return str(v).strip()


def norm_date(v) -> str | None:
    """posted_at'i sözlük sırasıyla karşılaştırılabilir ISO metnine çevirir ("YYYY-MM-DD" ya da
    "YYYY-MM-DDTHH:MM:SS[+hh:mm]"); tanınmayan biçimde None. Sıralama ve `days` süzgeci
    substr(posted_at,1,10) ile çalıştığından "15.10.2026" gibi değerler veritabanına girmemeli."""
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v.isoformat(timespec="seconds")
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        if v <= 0:
            return None
        try:
            return datetime.fromtimestamp(v / 1000 if v > 1e11 else v, timezone.utc).isoformat(timespec="seconds")
        except (OverflowError, OSError, ValueError):
            return None
    s = str(v).strip()
    if _ISO_DATE.match(s):
        try:
            date.fromisoformat(s[:10])
        except ValueError:
            return None
        return s[:10] if len(s) == 10 else s[:32]
    from .sources.platforms._util import parse_any_date
    return parse_any_date(s)


_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}(?:$|[T ])")


def _sanitize(job: Job) -> None:
    for f in ("title", "company", "url", "location", "employment_type", "work_model", "description",
              "salary", "category", "external_id"):
        v = getattr(job, f)
        if not isinstance(v, str):
            setattr(job, f, _as_text(v))
    if job.district is not None and not isinstance(job.district, str):
        job.district = None
    job.posted_at = norm_date(job.posted_at)
    if not isinstance(job.extra, dict):
        job.extra = {}
    vt = job.extra.get("validThrough")
    if vt:  # db.expire_old bu alanı ISO tarih olarak karşılaştırır
        job.extra["validThrough"] = (norm_date(vt) or "")[:10]


def side_hint(loc: str) -> str | None:
    """İlçe bulunamadığında yaka bilgisi: "İstanbul(Avr.)" (Kariyer.net, SecretCV), "İstanbul (Asya)",
    "Avrupa Yakası", "Asian Side" ... İki yaka birden geçiyorsa None."""
    f = f" {fold(loc)} "
    avr = any(w in f for w in (" avr ", " avrupa ", " european side "))
    ana = any(w in f for w in (" asya ", " anadolu ", " asian side "))
    if avr == ana:
        return None
    return "avrupa" if avr else "anadolu"


def enrich(job: Job) -> dict | None:
    """İstanbul dışı ilanlar için None; aksi halde veritabanı satırı."""
    _sanitize(job)
    loc = job.location or ""
    in_ist = is_istanbul(loc) or is_istanbul(job.title)
    if not in_ist:
        # Konumu yalnızca "Türkiye (Remote)" gibi olan uzaktan ilanlar İstanbul'dan da yapılabilir
        words = set(fold(loc).split())
        turkey_wide = not words or words <= _REMOTE_TR
        if words and turkey_wide and words & {"remote", "uzaktan"}:
            job.work_model = "remote"
        # Başka bir şehre bağlı uzaktan ilan (ör. "Ankara") İstanbul ilanı sayılmaz
        if job.work_model != "remote" or not turkey_wide:
            return None
    district = job.district or detect_district(loc) or detect_district(job.title)
    if not district and job.description:
        district = detect_district(job.description[:600])
        if district:
            job.extra["district_from"] = "description"
    job.district = district
    if not job.title or not job.url:
        return None
    row = job.to_dict()
    row["side"] = side_of(district) or side_hint(loc)
    row["collar"] = collar(job.title, job.category, job.source, job.source_type)
    c = locate(f"{loc} {job.title}", district)
    row["lat"], row["lon"] = (c if c else (None, None))
    row["dedupe_key"] = dedupe_key(job.title, job.company, district)
    return row


_LABELLED_LOC = re.compile(
    r"(?:Lokasyon|Konum|Adres|Çalışma Yeri|İş Yeri Adresi|Çalışma Lokasyonu|Şehir\s*/\s*İlçe|İlçe|Location)"
    r"\s*[:：]?\s*(?:</[^>]+>\s*)*(?:<[^>]+>\s*)*([^<]{2,140})", re.I)


def district_from_detail(html: str) -> str | None:
    """İlan detay sayfasından ilçe: önce JSON-LD konumu, sonra JSON-LD açıklaması, sonra etiketli
    konum alanları. Sayfanın tamamı taranmaz (menü/altbilgideki ilçe bağlantıları yanıltır)."""
    from .jsonld import extract_jobpostings, jobposting_to_job

    postings = extract_jobpostings(html)
    for d in postings:
        j = jobposting_to_job(d, source="", source_type="")
        hit = detect_district(j.location) or detect_district(j.title)
        if hit:
            return hit
    for d in postings:
        hit = detect_district(strip_html(d.get("description", ""), 3000))
        if hit:
            return hit
    for m in _LABELLED_LOC.finditer(html):
        hit = detect_district(m.group(1))
        if hit:
            return hit
    return None


def fill_districts(rows: dict[str, dict], db: DB, http, budget: int, log_=log, seconds: float = 150) -> int:
    """İlçesi belirsiz satırları önce veritabanındaki eski bilgiyle, sonra (yalnızca daha önce
    bakılmamış yeni ilanlar için, `budget` kadar) detay sayfasıyla doldurur. Döner: bulunan sayısı."""
    unknown = [r for r in rows.values() if not r.get("district")]
    if not unknown:
        return 0
    known = db.known_districts([r["uid"] for r in unknown])
    todo = []
    for r in unknown:
        k = known.get(r["uid"])
        if k and k["district"]:
            _set_district(r, k["district"])
        elif k and k["extra"].get("detail_checked"):
            r["extra"]["detail_checked"] = 1
        else:
            todo.append(r)
    found = fails = 0
    deadline = time.monotonic() + seconds
    for r in todo[:max(0, budget)]:
        if fails >= 3 or time.monotonic() > deadline:  # site detayları engelliyorsa vakit kaybetme
            break
        try:
            html = http.get(r["url"], retries=1, no_browser=True)
        except HttpError as e:
            fails = 3 if e.status is None else fails + 1  # bağlantı hiç kurulamıyorsa hemen bırak
            log_.debug("detay alınamadı %s (%s)", r["url"], e)
            continue
        except Exception as e:  # noqa: BLE001
            fails += 1
            log_.debug("detay alınamadı %s (%s)", r["url"], e)
            continue
        from .browser import looks_blocked

        if looks_blocked(html):  # bot koruması sayfası: detay sayfası okunamıyor, sayılı denemeden sonra bırak
            fails += 1
            continue
        fails = 0
        r["extra"]["detail_checked"] = 1
        d = district_from_detail(html)
        if d:
            _set_district(r, d)
            found += 1
    return found


def _set_district(r: dict, d: str):
    r["district"] = d
    r["side"] = side_of(d)
    c = locate(f"{r.get('location') or ''} {r.get('title') or ''}", d)
    r["lat"], r["lon"] = (c if c else (None, None))
    r["dedupe_key"] = dedupe_key(r["title"], r["company"], d)
    r.setdefault("extra", {})["district_from"] = "detail"


def run_source(src: Source, db: DB, http: Http, opts: CrawlOptions, status: CrawlStatus | None = None) -> dict:
    run_id = db.start_run(src.name)
    started = now_iso()
    counted = CountingHttp(http)
    ctx = FetchContext(http=counted, max_pages=opts.max_pages, fetch_details=opts.fetch_details,
                       deadline=time.monotonic() + max(opts.per_source_timeout, float(src.params.get("timeout", 0) or 0)),
                       log=logging.getLogger(f"isilan.source.{src.name}"),
                       state=db.state_for(src.name) if hasattr(db, "state_for") else None)
    rows: dict[str, dict] = {}
    count = 0
    error = None
    try:
        for job in src.fetch(ctx):
            count += 1
            try:
                job.source = src.name  # sağlık takibi ve pasife alma kaynak adına göre yapılır
                row = enrich(job)
            except Exception as e:  # noqa: BLE001 — tek bozuk ilan kaynağın tamamını düşürmesin
                log.debug("%s: ilan atlandı (%r)", src.name, e)
                continue
            if row:
                rows[row["uid"]] = row
            if count % 200 == 0 and status:
                status.add_log(f"{src.label}: {count} ilan okundu…")
    except Exception as e:  # noqa: BLE001
        error = f"{type(e).__name__}: {e}"
        log.warning("%s hata: %s", src.name, error)
    if rows and opts.district_details >= 0:
        try:
            found = fill_districts(rows, db, http, opts.district_details if not src.needs_browser else 0)
            if found and status:
                status.add_log(f"{src.label}: {found} ilanın ilçesi detay sayfasından bulundu")
        except Exception as e:  # noqa: BLE001
            log.warning("%s ilçe tamamlama hatası: %s", src.name, e)
    new, upd = db.upsert_jobs(list(rows.values()), started)
    removed = 0
    if error is None and rows:
        truncated = counted.n >= opts.max_pages or not ctx.time_left() or ctx.partial
        if not truncated:
            # Kaynak baştan sona tarandı: bu taramada görünmeyen ilanlar yayından kalkmıştır
            removed = db.deactivate_missing(src.name, started)
        else:
            # Sayfa/süre sınırına takıldı: eski sayfalardaki ilanları hemen silme, yalnızca uzun süredir görünmeyenleri
            cutoff = (datetime.now(timezone.utc) - timedelta(days=STALE_DAYS)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
            removed = db.deactivate_missing(src.name, cutoff)
    st = "error" if error and not rows else ("partial" if error else ("ok" if rows else "empty"))
    db.finish_run(run_id, st, count, len(rows), error)
    res = {"status": st, "fetched": count, "kept": len(rows), "new": new, "removed": removed, "error": error}
    if status:
        status.results[src.name] = res
    return res


def crawl(db: DB, sources: list[Source] | None = None, opts: CrawlOptions | None = None,
          status: CrawlStatus | None = None) -> CrawlStatus:
    opts = opts or CrawlOptions()
    status = status or CrawlStatus()
    srcs = sources if sources is not None else all_sources()
    skipped = [s for s in srcs if s.needs_browser and not opts.use_browser]
    srcs = [s for s in srcs if s not in skipped]
    if opts.use_browser:
        from .browser import BrowserHttp
        http: Http = BrowserHttp(min_interval=opts.min_interval, headless=opts.headless, profile_dir=opts.profile_dir)
    else:
        http = Http(min_interval=opts.min_interval)
    lock = threading.Lock()
    status.running, status.started_at, status.finished_at = True, now_iso(), None
    status.done, status.total, status.results = 0, len(srcs), {}
    if skipped:
        status.add_log(f"Tarayıcı gerektiren {len(skipped)} kaynak atlandı (--browser ile açılır): "
                       + ", ".join(s.name for s in skipped))
    status.add_log(f"{len(srcs)} kaynak taranıyor…")

    def work(s: Source):
        with lock:
            status.current.append(s.label)
        try:
            return s, run_source(s, db, http, opts, status)
        except Exception as e:  # noqa: BLE001 — ör. veritabanı hatası: diğer kaynaklar ve expire_old sürsün
            log.exception("%s: beklenmeyen hata", s.name)
            res = {"status": "error", "fetched": 0, "kept": 0, "new": 0, "removed": 0,
                   "error": f"{type(e).__name__}: {e}"}
            status.results[s.name] = res
            return s, res
        finally:
            with lock:
                status.current.remove(s.label)

    try:
        with ThreadPoolExecutor(max_workers=opts.workers) as ex:
            futs = [ex.submit(work, s) for s in srcs]
            for f in as_completed(futs):
                s, res = f.result()
                status.done += 1
                msg = f"[{status.done}/{status.total}] {s.label}: {res['status']} — {res['kept']} İstanbul ilanı"
                if res["new"]:
                    msg += f", {res['new']} yeni"
                if res["removed"]:
                    msg += f", {res['removed']} kaldırıldı"
                if res["error"]:
                    msg += f" (hata: {res['error'][:160]})"
                status.add_log(msg)
                log.info(msg)
        expired = db.expire_old()
        if expired:
            status.add_log(f"{expired} eski ilan pasife alındı")
    finally:
        if hasattr(http, "close"):
            http.close()
        status.running = False
        status.finished_at = now_iso()
        status.add_log(f"Tarama bitti. HTTP istek sayısı: {http.request_count}")
    return status
