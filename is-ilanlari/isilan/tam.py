"""`python -m isilan tam`: iyileştirme adımlarının hepsini sırayla uygular.

1. Teşhis: platform ve İK kaynakları kısa taramayla denenir, sorunlu olanlar sınıflandırılır.
2. Derin tarama: engellenmeyen tüm kaynaklar yüksek sayfa sınırıyla taranır
   (LinkedIn sınıra ulaşırsa kendiliğinden ilçe ilçe arar).
3. Bot korumalı kaynaklar görünür tarayıcıyla (kalıcı profil) yeniden taranır;
   doğrulama çıkarsa kullanıcı pencerede tamamlar.
4. Hâlâ sorunlu kaynakların teşhis dosyaları gönderilmek üzere tek bir zip'te toplanır.
"""
from __future__ import annotations

import shutil
import zipfile
from pathlib import Path

from .db import DB
from .http import Http
from .pipeline import CrawlOptions, crawl
from .sources import all_sources
from .teshis import diagnose

BLOCKED, UNPARSED, NOCONN, OK = "engelli", "ayristirilamadi", "baglanti", "ok"


def classify(verdict: str) -> str:
    if "engelliyor" in verdict:
        return BLOCKED
    if "bağlanılamadı" in verdict or "İstek yapılamadı" in verdict:
        return NOCONN
    if "ayrıştırılamadı" in verdict or "tanınmadı" in verdict:
        return UNPARSED
    return OK


def playwright_ready() -> bool:
    try:
        import playwright  # noqa: F401
    except ImportError:
        return False
    return True


def run(db_path: str, out_dir: Path, max_pages: int = 400, timeout: float = 3600, workers: int = 6,
        use_browser: bool = True, say=print) -> dict:
    db = DB(db_path)
    srcs = all_sources()
    diag_dir = out_dir / "teshis"
    if diag_dir.exists():
        shutil.rmtree(diag_dir)

    # 1) Teşhis — tek tek çok kaynağı (122 şirket) denemek gereksiz; şirket ATS'leri tek istektir
    probe = [s for s in srcs if s.source_type != "company"]
    say(f"\n[1/4] Teşhis: {len(probe)} platform / İK kaynağı kısa taramayla deneniyor…")
    status: dict[str, str] = {}
    http = Http(min_interval=1.0)
    for s in probe:
        if s.needs_browser:
            status[s.name] = BLOCKED
            say(f"   {s.name:<30} tarayıcı gerektiriyor")
            continue
        r = diagnose(s, diag_dir, http, max_pages=1, timeout=90)
        status[s.name] = classify(r["verdict"])
        say(f"   {s.name:<30} okunan={r['fetched']:<4} → {r['verdict']}")

    # 2) Derin tarama (engellenmeyenler + tüm şirketler)
    normal = [s for s in srcs if status.get(s.name, OK) != BLOCKED]
    say(f"\n[2/4] Derin tarama: {len(normal)} kaynak (sayfa sınırı {max_pages})…")
    st = crawl(db, normal, CrawlOptions(max_pages=max_pages, per_source_timeout=timeout, workers=workers))
    results = dict(st.results)

    # 3) Korumalı kaynaklar görünür tarayıcıyla
    blocked = [s for s in srcs if status.get(s.name) == BLOCKED]
    if blocked and use_browser:
        if playwright_ready():
            say(f"\n[3/4] {len(blocked)} korumalı kaynak görünür tarayıcıyla taranıyor. "
                "Doğrulama sayfası çıkarsa açılan pencerede tamamlayın…")
            opts = CrawlOptions(max_pages=max_pages, per_source_timeout=timeout, workers=1, use_browser=True,
                                headless=False, profile_dir=str(out_dir / "tarayici-profili"))
            results.update(crawl(db, blocked, opts).results)
        else:
            say("\n[3/4] Atlandı: Playwright kurulu değil. Kurmak için:\n"
                "      pip install playwright && python -m playwright install chromium")
    else:
        say("\n[3/4] Korumalı kaynak yok, atlandı.")

    # 4) Hâlâ sorunlu olanların teşhis dosyalarını paketle
    bad = sorted(n for n, r in results.items() if r["status"] in ("error", "empty"))
    bad += [n for n, c in status.items() if c in (UNPARSED, NOCONN) and n not in bad]
    zip_path = out_dir / "teshis.zip"
    if bad and diag_dir.exists():
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
            for d in diag_dir.iterdir():
                if d.is_dir() and any(d.name == n.replace(":", "_") for n in bad):
                    for f in d.rglob("*"):
                        z.write(f, f.relative_to(diag_dir))
    total = db.query(per_page=1)["total"]
    say(f"\n[4/4] Bitti. Toplam aktif İstanbul ilanı: {total}")
    rows = sorted(((r["kept"], n) for n, r in results.items() if r["kept"]), reverse=True)[:15]
    for kept, n in rows:
        say(f"   {n:<32} {kept}")
    if bad:
        say(f"\nSorunlu kaynaklar ({len(bad)}): {', '.join(bad[:25])}")
        if zip_path.exists():
            say(f"Teşhis dosyaları: {zip_path}  ← bu dosyayı gönderirseniz ayrıştırıcılar düzeltilebilir")
    return {"total": total, "results": results, "status": status, "bad": bad,
            "zip": str(zip_path) if zip_path.exists() else None}
