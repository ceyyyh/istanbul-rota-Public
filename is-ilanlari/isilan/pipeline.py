"""Tarama hattı: kaynakları paralel çalıştırır, İstanbul dışını eler, ilçe tespit eder,
veritabanına yazar ve kaynak sağlığını kaydeder."""
from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field

from .db import DB, dedupe_key, now_iso
from .geo import detect_district, is_istanbul, side_of
from .http import Http
from .models import Job
from .sources import FetchContext, Source, all_sources
from .text import fold

log = logging.getLogger("isilan.pipeline")

_REMOTE_TR = {"turkiye", "turkey", "tr", "remote", "uzaktan", "fully", "full", "work", "from", "home", "evden", "calisma"}


@dataclass
class CrawlOptions:
    max_pages: int = 40
    per_source_timeout: float = 600   # saniye
    workers: int = 6
    fetch_details: bool = False
    use_browser: bool = False          # needs_browser kaynaklarını da çalıştır (Playwright gerekir)
    min_interval: float = 1.0          # aynı alan adına iki istek arası en az bekleme


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


def enrich(job: Job) -> dict | None:
    """İstanbul dışı ilanlar için None; aksi halde veritabanı satırı."""
    loc = job.location or ""
    in_ist = is_istanbul(loc) or is_istanbul(job.title)
    if not in_ist:
        # Konumu yalnızca "Türkiye (Remote)" gibi olan uzaktan ilanlar İstanbul'dan da yapılabilir
        words = set(fold(loc).split())
        if words and words <= _REMOTE_TR and words & {"remote", "uzaktan"}:
            job.work_model = "remote"
        if job.work_model != "remote":
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
    row["side"] = side_of(district)
    row["dedupe_key"] = dedupe_key(job.title, job.company, district)
    return row


def run_source(src: Source, db: DB, http: Http, opts: CrawlOptions, status: CrawlStatus | None = None) -> dict:
    run_id = db.start_run(src.name)
    started = now_iso()
    ctx = FetchContext(http=http, max_pages=opts.max_pages, fetch_details=opts.fetch_details,
                       deadline=time.monotonic() + opts.per_source_timeout,
                       log=logging.getLogger(f"isilan.source.{src.name}"))
    rows: dict[str, dict] = {}
    count = 0
    error = None
    try:
        for job in src.fetch(ctx):
            count += 1
            row = enrich(job)
            if row:
                rows[row["uid"]] = row
            if count % 200 == 0 and status:
                status.add_log(f"{src.label}: {count} ilan okundu…")
    except Exception as e:  # noqa: BLE001
        error = f"{type(e).__name__}: {e}"
        log.warning("%s hata: %s", src.name, error)
    new, upd = db.upsert_jobs(list(rows.values()), started)
    removed = 0
    if error is None and rows and ctx.time_left():
        # Kaynak eksiksiz tarandıysa görünmeyen ilanlar yayından kalkmıştır
        removed = db.deactivate_missing(src.name, started)
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
        http: Http = BrowserHttp(min_interval=opts.min_interval)
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
