"""Kaynak teşhisi: bir kaynağı kısa bir taramayla çalıştırır, her HTTP yanıtını diske kaydeder
ve neden az/hiç ilan geldiğini raporlar. Çıktı klasörü geliştiriciye gönderilerek
ayrıştırıcılar gerçek sayfalara göre düzeltilebilir."""
from __future__ import annotations

import json
import logging
import re
import time
from collections import Counter
from pathlib import Path

from .browser import looks_blocked
from .http import Http, HttpError
from .pipeline import CountingHttp, enrich
from .sources.base import FetchContext, Source

_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


def recording_http(base: Http, out: Path, limit: int = 30) -> Http:
    """`base` ile aynı sınıftan, her yanıtı `out` klasörüne yazan bir Http döner."""
    out.mkdir(parents=True, exist_ok=True)
    log: list[dict] = []
    cls = type(base)

    class Recording(cls):  # type: ignore[misc, valid-type]
        def text(self, url, method="GET", **kw):
            n = len(log) + 1
            entry = {"n": n, "method": method, "url": url}
            t = time.time()
            try:
                txt = super().text(url, method, **kw)
            except HttpError as e:
                entry.update(status=e.status, error=str(e)[:300], secs=round(time.time() - t, 2))
                log.append(entry)
                raise
            entry.update(status=200, bytes=len(txt), secs=round(time.time() - t, 2), blocked=looks_blocked(txt))
            if n <= limit:
                ext = "json" if txt.lstrip()[:1] in "[{" else "html"
                fname = f"{n:02d}_{_SAFE.sub('_', url.split('//', 1)[-1])[:80]}.{ext}"
                (out / fname).write_text(txt, encoding="utf-8")
                entry["file"] = fname
            log.append(entry)
            return txt

    rec = Recording.__new__(Recording)
    rec.__dict__.update(base.__dict__)
    rec._teshis_log = log
    return rec


def diagnose(src: Source, out_root: Path, http: Http, max_pages: int = 2, timeout: float = 180) -> dict:
    out = out_root / _SAFE.sub("_", src.name)
    rec = recording_http(http, out)
    counted = CountingHttp(rec)
    ctx = FetchContext(http=counted, max_pages=max_pages, deadline=time.monotonic() + timeout,
                       log=logging.getLogger(f"isilan.teshis.{src.name}"))
    fetched, kept, drops, samples, error = 0, 0, Counter(), [], None
    try:
        for job in src.fetch(ctx):
            fetched += 1
            row = enrich(job)
            if row:
                kept += 1
            else:
                drops["istanbul_disi_veya_eksik"] += 1
            if len(samples) < 15:
                samples.append({"title": job.title, "company": job.company, "location": job.location,
                                "url": job.url, "kept": bool(row), "district": row and row.get("district")})
    except Exception as e:  # noqa: BLE001
        error = f"{type(e).__name__}: {e}"
    reqs = rec._teshis_log
    blocked = [r for r in reqs if r.get("blocked") or r.get("status") in (401, 403, 429, 503)]
    ok_reqs = [r for r in reqs if r.get("status") == 200]
    if error and not reqs:
        verdict = "İstek yapılamadı (kod hatası)"
    elif reqs and not ok_reqs and not blocked:
        verdict = "Siteye bağlanılamadı (internet/DNS/güvenlik duvarı)"
    elif blocked and fetched == 0:
        verdict = "Site engelliyor (bot koruması). --browser / --gorunur ile deneyin"
    elif reqs and fetched == 0:
        verdict = "Sayfa geldi ama ilan ayrıştırılamadı → site yapısı değişmiş olabilir; kayıtlı dosyaları gönderin"
    elif fetched and kept == 0:
        verdict = "İlanlar okundu ama hiçbiri İstanbul olarak tanınmadı → konum metinlerine bakın (örnekler)"
    elif error:
        verdict = "Kısmen çalıştı, sonra hata verdi"
    else:
        verdict = "Çalışıyor"
    report = {"source": src.name, "label": src.label, "verdict": verdict, "fetched": fetched, "kept": kept,
              "drops": dict(drops), "error": error, "requests": reqs, "samples": samples,
              "partial": getattr(ctx, "partial", None)}
    (out / "rapor.json").write_text(json.dumps(report, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    report["dir"] = str(out)
    return report
