import json
import threading
import urllib.request
from http.server import ThreadingHTTPServer

from isilan.db import DB
from isilan.models import PLATFORM, Job
from isilan.pipeline import crawl
from isilan.sources.base import Source
from isilan.web import App, make_handler


def test_api_endpoints(tmp_path, monkeypatch):
    monkeypatch.setattr("isilan.web.source_meta", lambda: {"t": {"name": "t", "label": "Test", "source_type": PLATFORM,
                                                                   "homepage": "", "needs_browser": False}})
    db = DB(tmp_path / "w.db")
    jobs = [Job(source="t", source_type=PLATFORM, external_id=str(i), title=f"Garson {i}", company="Kafe",
                url=f"https://t/{i}", location=loc) for i, loc in enumerate(["Beşiktaş, İstanbul", "Kadıköy, İstanbul", "İstanbul"])]
    crawl(db, [Source(name="t", source_type=PLATFORM, label="Test", fetcher=lambda s, c: iter(jobs))])
    srv = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(App(db)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"

    def get(path):
        with urllib.request.urlopen(base + path) as r:
            return json.loads(r.read())

    try:
        r = get("/api/jobs?ilce=Be%C5%9Fikta%C5%9F")
        assert r["total"] == 1 and r["items"][0]["source_label"] == "Test"
        assert get("/api/jobs?ilce=Be%C5%9Fikta%C5%9F,Kad%C4%B1k%C3%B6y&ilce_bilinmiyor=1")["total"] == 3
        f = get("/api/facets?ilce=Be%C5%9Fikta%C5%9F")
        assert f["total"] == 1
        counts = {d["name"]: d["count"] for d in f["districts"]}
        assert counts["Kadıköy"] == 1 and counts["Beşiktaş"] == 1 and len(counts) == 39
        assert f["unknown_district"] == 1
        assert get("/api/sources")[0]["active_count"] == 3
        assert get("/api/crawl")["running"] is False
    finally:
        srv.shutdown()
