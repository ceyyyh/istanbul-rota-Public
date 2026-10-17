"""Yerel web sunucusu (yalnızca standart kütüphane): arayüz + JSON API."""
from __future__ import annotations

import json
import logging
import threading
import time
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .db import DB
from .geo import DISTRICT_SIDE, DISTRICTS
from .models import AGENCY, COMPANY, PLATFORM
from .pipeline import CrawlOptions, CrawlStatus, crawl
from .sources import all_sources

log = logging.getLogger("isilan.web")

STATIC = Path(__file__).resolve().parent / "static"
TYPE_LABELS = {PLATFORM: "Platformlar", COMPANY: "Şirket kariyer sayfaları", AGENCY: "İK / dış kaynak firmaları"}


@lru_cache(maxsize=1)
def source_meta() -> dict[str, dict]:
    return {s.name: {"name": s.name, "label": s.label, "source_type": s.source_type, "homepage": s.homepage,
                     "needs_browser": s.needs_browser}
            for s in all_sources(include_disabled=True)}


def label_of(name: str) -> str:
    return source_meta().get(name, {}).get("label") or name


def decorate(item: dict) -> dict:
    item = dict(item)
    item["source_label"] = label_of(item["source"])
    item["duplicates"] = [dict(d, source_label=label_of(d["source"])) for d in item.get("duplicates", [])]
    item.pop("dedupe_key", None)
    return item


def parse_filters(qs: dict[str, list[str]]) -> dict:
    def lst(key):
        vals = []
        for v in qs.get(key, []):
            vals += [x.strip() for x in v.split(",") if x.strip()]
        return vals or None

    def one(key, default=None):
        v = qs.get(key, [default])[0]
        return v if v not in ("", None) else default

    days = one("days")
    return {
        "q": one("q", ""),
        "districts": lst("ilce"),
        "include_unknown": one("ilce_bilinmiyor") in ("1", "true", "evet"),
        "side": one("yaka"),
        "source_types": lst("source_type"),
        "sources": lst("source"),
        "work_models": lst("work_model"),
        "days": int(days) if days and days.isdigit() else None,
        "sort": one("sort", "new"),
    }


def _int(v, default: int) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def facets(db: DB, f: dict) -> dict:
    def items(ignore):
        return db.query(**f, page=1, per_page=1, ignore=ignore)["_all"]

    base = items(())
    by_d = items(("district", "side"))
    d_counts: dict[str | None, int] = {}
    for it in by_d:
        d_counts[it["district"]] = d_counts.get(it["district"], 0) + 1
    st_counts: dict[str, int] = {}
    for it in items(("source_type",)):
        st_counts[it["source_type"]] = st_counts.get(it["source_type"], 0) + 1
    s_counts: dict[str, int] = {}
    for it in items(("source",)):
        s_counts[it["source"]] = s_counts.get(it["source"], 0) + 1
    meta = source_meta()
    srcs = [{"name": n, "label": label_of(n), "source_type": meta.get(n, {}).get("source_type", ""), "count": c}
            for n, c in sorted(s_counts.items(), key=lambda kv: -kv[1])]
    return {
        "total": len(base),
        "last_crawl": db.last_crawl(),
        "districts": [{"name": d, "side": DISTRICT_SIDE.get(d), "count": d_counts.get(d, 0)} for d in DISTRICTS],
        "unknown_district": d_counts.get(None, 0),
        "source_types": [{"name": t, "label": TYPE_LABELS[t], "count": st_counts.get(t, 0)} for t in (PLATFORM, COMPANY, AGENCY)],
        "sources": srcs,
    }


def sources_health(db: DB) -> list[dict]:
    runs = db.last_runs()
    active = db.active_counts_by_source()
    out = []
    for name, m in sorted(source_meta().items(), key=lambda kv: (kv[1]["source_type"], kv[1]["label"].lower())):
        r = runs.get(name)
        out.append({**m, "last_run": r["finished_at"] if r else None, "last_status": r["status"] if r else None,
                    "last_count": r["kept"] if r else None, "last_error": r["error"] if r else None,
                    "active_count": active.get(name, 0)})
    return out


class App:
    def __init__(self, db: DB, crawl_opts: CrawlOptions | None = None):
        self.db = db
        self.crawl_opts = crawl_opts or CrawlOptions()
        self.status = CrawlStatus()
        self._crawl_lock = threading.Lock()

    def start_crawl(self, names: list[str] | None = None) -> bool:
        if not self._crawl_lock.acquire(blocking=False):
            return False
        srcs = all_sources()
        if names:
            srcs = [s for s in srcs if s.name in names or s.source_type in names]

        def run():
            try:
                crawl(self.db, srcs, self.crawl_opts, self.status)
            finally:
                self._crawl_lock.release()

        threading.Thread(target=run, daemon=True).start()
        return True

    def schedule(self, every_hours: float):
        def loop():
            while True:
                time.sleep(every_hours * 3600)
                self.start_crawl()
        threading.Thread(target=loop, daemon=True).start()


def make_handler(app: App):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):  # sessiz
            log.debug(fmt, *args)

        def _send(self, code: int, body: bytes, ctype: str):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, obj, code: int = 200):
            self._send(code, json.dumps(obj, ensure_ascii=False, default=str).encode(), "application/json; charset=utf-8")

        def do_GET(self):  # noqa: N802
            u = urlparse(self.path)
            qs = parse_qs(u.query)
            try:
                if u.path in ("/", "/index.html"):
                    self._send(200, (STATIC / "index.html").read_bytes(), "text/html; charset=utf-8")
                elif u.path == "/api/jobs":
                    f = parse_filters(qs)
                    page = max(1, _int(qs.get("page", ["1"])[0], 1))
                    per_page = min(500, max(1, _int(qs.get("per_page", ["50"])[0], 50)))
                    res = app.db.query(**f, page=page, per_page=per_page)
                    res.pop("_all")
                    res["items"] = [decorate(i) for i in res["items"]]
                    self._json(res)
                elif u.path == "/api/facets":
                    self._json(facets(app.db, parse_filters(qs)))
                elif u.path == "/api/sources":
                    self._json(sources_health(app.db))
                elif u.path == "/api/crawl":
                    self._json(app.status.to_dict())
                else:
                    self._json({"error": "bulunamadı"}, 404)
            except Exception as e:  # noqa: BLE001
                log.exception("istek hatası")
                self._json({"error": str(e)}, 500)

        def do_POST(self):  # noqa: N802
            if urlparse(self.path).path != "/api/crawl":
                return self._json({"error": "bulunamadı"}, 404)
            n = int(self.headers.get("Content-Length") or 0)
            body = {}
            if n:
                try:
                    body = json.loads(self.rfile.read(n) or b"{}")
                except json.JSONDecodeError:
                    body = {}
            names = body.get("sources") if isinstance(body, dict) else None
            if isinstance(names, str):  # {"sources": "linkedin"} → alt dize eşleşmesi olmasın
                names = [names]
            started = app.start_crawl(names or None)
            self._json({"started": started, "running": app.status.running})

    return Handler


def serve(db: DB, host: str = "127.0.0.1", port: int = 8000, crawl_every: float = 0,
          crawl_opts: CrawlOptions | None = None, crawl_on_start: bool = False):
    app = App(db, crawl_opts)
    if crawl_every:
        app.schedule(crawl_every)
    if crawl_on_start:
        app.start_crawl()
    srv = ThreadingHTTPServer((host, port), make_handler(app))
    print(f"İstanbul İş İlanları: http://{host}:{port}  (durdurmak için Ctrl+C)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
