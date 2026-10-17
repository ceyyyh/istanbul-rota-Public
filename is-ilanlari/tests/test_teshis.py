import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from isilan.http import Http
from isilan.models import PLATFORM, Job
from isilan.sources.base import Source
from isilan.teshis import diagnose


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):  # noqa: N802
        if self.path.startswith("/blok"):
            self.send_response(403)
            self.end_headers()
            return
        body = "<html><body><div class=kart>Kasiyer</div></body></html>".encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(body)


def _server():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}"


def test_diagnose_reports_working_blocked_and_unparsed(tmp_path):
    srv, base = _server()
    try:
        def ok(s, ctx):
            ctx.http.get(base + "/liste")
            yield Job(source="x", source_type=PLATFORM, external_id="1", title="Kasiyer", company="M",
                      url=base + "/1", location="Kadıköy, İstanbul")
            yield Job(source="x", source_type=PLATFORM, external_id="2", title="Şoför", company="M",
                      url=base + "/2", location="Ankara")

        def blocked(s, ctx):
            ctx.http.get(base + "/blok")
            yield from ()

        def unparsed(s, ctx):
            ctx.http.get(base + "/yeni-tasarim")
            yield from ()

        http = Http(min_interval=0, retries=1)
        r = diagnose(Source(name="ok", source_type=PLATFORM, label="OK", fetcher=ok), tmp_path, http)
        assert r["fetched"] == 2 and r["kept"] == 1 and r["verdict"] == "Çalışıyor"
        saved = json.loads((tmp_path / "ok" / "rapor.json").read_text(encoding="utf-8"))
        assert saved["requests"][0]["file"].endswith(".html")
        assert (tmp_path / "ok" / saved["requests"][0]["file"]).read_text(encoding="utf-8").count("Kasiyer") == 1

        r = diagnose(Source(name="b", source_type=PLATFORM, label="B", fetcher=blocked), tmp_path, http)
        assert "engelliyor" in r["verdict"] and r["requests"][0]["status"] == 403

        r = diagnose(Source(name="u", source_type=PLATFORM, label="U", fetcher=unparsed), tmp_path, http)
        assert "ayrıştırılamadı" in r["verdict"]
    finally:
        srv.shutdown()
