"""Komut satırı: python -m isilan <komut>

  crawl        Kaynakları tara ve veritabanını güncelle
  serve        Web arayüzünü başlat (http://127.0.0.1:8000)
  list         İlanları terminalde listele (ilçe/arama filtresiyle)
  export       CSV veya JSON olarak dışa aktar
  sources      Kaynakları ve son tarama durumlarını göster
  build-site   Verileri gömülü tek bir HTML dosyası üret (sunucusuz paylaşım için)
  ilceler      İlçe listesini ve ilan sayılarını göster
  add-company  Bir şirket adını/slug'ını bilinen ATS'lerde deneyip kayıt defterine ekle
"""
from __future__ import annotations

import argparse
import csv
import json
import logging
import sys
from collections import Counter
from pathlib import Path

from .db import DB, DEFAULT_DB, now_iso
from .geo import DISTRICTS
from .text import fold

CSV_COLS = ["title", "company", "district", "side", "location", "source", "source_type", "posted_at",
            "first_seen", "work_model", "employment_type", "salary", "url"]


def _match_districts(values: list[str] | None) -> list[str] | None:
    """Kullanıcı 'kadikoy' yazsa da 'Kadıköy'e eşler."""
    if not values:
        return None
    out = []
    by_fold = {fold(d): d for d in DISTRICTS}
    for v in values:
        for part in v.split(","):
            f = fold(part)
            if not f:
                continue
            if f in by_fold:
                out.append(by_fold[f])
            else:
                cands = [d for k, d in by_fold.items() if k.startswith(f)]
                if len(cands) == 1:
                    out.append(cands[0])
                else:
                    sys.exit(f"Bilinmeyen ilçe: {part!r}. Seçenekler: {', '.join(DISTRICTS)}")
    return out


def _filters(a) -> dict:
    return dict(q=a.q or "", districts=_match_districts(a.ilce), include_unknown=a.belirsiz,
                side=a.yaka, source_types=a.tur, sources=a.kaynak, work_models=a.calisma,
                days=a.gun, sort=a.sirala)


def add_filter_args(p):
    p.add_argument("--ilce", action="append", help="İlçe (birden çok kez ya da virgülle: --ilce Kadıköy,Ataşehir)")
    p.add_argument("--belirsiz", action="store_true", help="İlçesi belirlenemeyen ilanları da dahil et")
    p.add_argument("--yaka", choices=["avrupa", "anadolu"])
    p.add_argument("-q", "--q", help="Arama (başlık, şirket, açıklama)")
    p.add_argument("--tur", action="append", choices=["platform", "company", "agency"], help="Kaynak türü")
    p.add_argument("--kaynak", action="append", help="Kaynak adı (ör. kariyernet, linkedin)")
    p.add_argument("--calisma", action="append", choices=["remote", "hybrid", "onsite"])
    p.add_argument("--gun", type=int, help="Son N günde yayınlananlar")
    p.add_argument("--sirala", default="new", choices=["new", "old", "company"])


def cmd_crawl(a):
    from .pipeline import CrawlOptions, crawl
    from .sources import all_sources

    srcs = all_sources()
    if a.source:
        wanted = set(a.source)
        srcs = [s for s in srcs if s.name in wanted or s.source_type in wanted
                or any(s.name.startswith(w.rstrip("*")) for w in wanted if w.endswith("*"))]
        if not srcs:
            sys.exit("Eşleşen kaynak yok. `python -m isilan sources` ile listeye bakın.")
    if a.haric:
        skip = {x for v in a.haric for x in v.split(",") if x}
        srcs = [s for s in srcs if s.name not in skip and s.source_type not in skip]
    opts = CrawlOptions(max_pages=a.max_pages, per_source_timeout=a.timeout, workers=a.workers,
                        fetch_details=a.details, use_browser=a.browser or a.gorunur, headless=not a.gorunur,
                        profile_dir=a.profil or (str(DEFAULT_DB.parent / "tarayici-profili") if a.gorunur else None),
                        min_interval=a.interval)
    db = DB(a.db)
    st = crawl(db, srcs, opts)
    ok = sum(1 for r in st.results.values() if r["status"] in ("ok", "partial"))
    kept = sum(r["kept"] for r in st.results.values())
    print(f"\nBitti: {ok}/{len(st.results)} kaynak başarılı, {kept} İstanbul ilanı işlendi.")
    print(f"Toplam aktif ilan: {db.query(per_page=1)['total']}  →  `python -m isilan serve` ile görüntüleyin.")


def cmd_serve(a):
    from .pipeline import CrawlOptions
    from .web import serve

    opts = CrawlOptions(max_pages=a.max_pages, workers=a.workers, use_browser=a.browser)
    serve(DB(a.db), a.host, a.port, crawl_every=a.crawl_every, crawl_opts=opts, crawl_on_start=a.crawl_now)


def cmd_list(a):
    res = DB(a.db).query(**_filters(a), page=1, per_page=a.limit)
    for it in res["items"]:
        d = it["district"] or "?"
        date = (it["posted_at"] or it["first_seen"] or "")[:10]
        print(f"{date}  [{d:<13}] {(it['title'] or '')[:70]:<70}  {(it['company'] or '')[:30]:<30}  {it['source']}")
        if a.url:
            print(f"            {it['url']}")
    print(f"\n{res['total']} ilan (ilk {min(a.limit, res['total'])} gösterildi)")


def cmd_export(a):
    res = DB(a.db).query(**_filters(a), page=1, per_page=10**9)
    items = res["items"]
    out = Path(a.out)
    if a.format == "json" or out.suffix == ".json":
        out.write_text(json.dumps(items, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    else:
        with out.open("w", encoding="utf-8-sig", newline="") as fh:  # Excel Türkçe karakterleri doğru açsın
            w = csv.writer(fh, delimiter=";")
            w.writerow(CSV_COLS + ["diger_kaynaklar"])
            for it in items:
                w.writerow([it.get(c) or "" for c in CSV_COLS] + [" ".join(d["url"] for d in it["duplicates"])])
    print(f"{len(items)} ilan → {out}")


def cmd_sources(a):
    from .web import sources_health

    rows = sources_health(DB(a.db))
    for r in rows:
        if a.tur and r["source_type"] not in a.tur:
            continue
        st = r["last_status"] or "-"
        flag = " (tarayıcı)" if r["needs_browser"] else ""
        err = f"  ! {r['last_error'][:90]}" if r["last_error"] and a.verbose else ""
        print(f"{r['source_type']:<9} {r['name']:<40} {st:<8} aktif={r['active_count']:<6}{flag}{err}")
    print(f"\n{len(rows)} kaynak")


def cmd_build_site(a):
    from .web import TYPE_LABELS, decorate, sources_health  # noqa: F401

    db = DB(a.db)
    items = db.query(page=1, per_page=10**9)["items"]
    jobs = []
    for it in items:
        it = decorate(it)
        it["description"] = (it.get("description") or "")[: a.desc_len]
        agency = (it.get("extra") or {}).get("agency")
        it["extra"] = {"agency": agency} if agency else {}
        it.pop("external_id", None)
        jobs.append(it)
    from .geo import ORIGINS

    data = {"generated_at": now_iso(), "jobs": jobs, "sources": sources_health(db), "origins": ORIGINS}
    blob = json.dumps(data, ensure_ascii=False, separators=(",", ":"), default=str).replace("</", "<\\/")
    tpl = (Path(__file__).resolve().parent / "static" / "index.html").read_text(encoding="utf-8")
    marker = "<script>/*__ISILAN_DATA__*/</script>"
    if marker not in tpl:
        sys.exit("index.html içinde veri yer tutucusu bulunamadı")
    extra = ""
    if a.profil:  # "Bana uygun" için hazır profil (kişisel; herkese açık yayınlara koymayın)
        prof = json.loads(Path(a.profil).read_text(encoding="utf-8"))
        extra = "window.__ISILAN_PROFIL__=" + json.dumps(prof, ensure_ascii=False).replace("</", "<\\/") + ";"
    html = tpl.replace(marker, f"<script>window.__ISILAN_DATA__={blob};{extra}</script>")
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(f"{len(jobs)} ilan → {out} ({out.stat().st_size / 1e6:.1f} MB)")


def cmd_ilceler(a):
    from .geo import DISTRICT_SIDE

    db = DB(a.db)
    counts = {}
    for it in db.query(page=1, per_page=1)["_all"]:
        counts[it["district"]] = counts.get(it["district"], 0) + 1
    for side in ("avrupa", "anadolu"):
        print(f"\n{side.capitalize()} Yakası")
        for d in DISTRICTS:
            if DISTRICT_SIDE.get(d) == side:
                print(f"  {d:<15} {counts.get(d, 0):>6}")
    print(f"\n  {'(belirsiz)':<15} {counts.get(None, 0):>6}")


def cmd_teshis(a):
    from .pipeline import CrawlOptions  # noqa: F401
    from .sources import all_sources
    from .teshis import diagnose

    srcs = all_sources(include_disabled=True)
    if a.source:
        wanted = set(a.source)
        srcs = [s for s in srcs if s.name in wanted or s.source_type in wanted]
        if not srcs:
            sys.exit("Eşleşen kaynak yok. `python -m isilan sources` ile listeye bakın.")
    if a.browser or a.gorunur:
        from .browser import BrowserHttp
        http = BrowserHttp(min_interval=1.0, headless=not a.gorunur,
                           profile_dir=a.profil or (str(DEFAULT_DB.parent / "tarayici-profili") if a.gorunur else None))
    else:
        from .http import Http
        http = Http(min_interval=1.0)
    out = Path(a.out)
    try:
        for s in srcs:
            r = diagnose(s, out, http, max_pages=a.max_pages, timeout=a.timeout)
            st = Counter(str(q.get("status")) for q in r["requests"])
            print(f"{s.name:<32} okunan={r['fetched']:<5} istanbul={r['kept']:<5} istek={dict(st)}  → {r['verdict']}")
            if r["error"] and a.verbose:
                print(f"    hata: {r['error'][:200]}")
    finally:
        if hasattr(http, "close"):
            http.close()
    print(f"\nAyrıntılar ve kaydedilen sayfalar: {out}/<kaynak>/ (rapor.json + ham yanıtlar)")
    print("Az ilan gelen kaynakların klasörünü zip'leyip gönderirseniz ayrıştırıcı gerçek sayfaya göre düzeltilebilir.")


def cmd_tam(a):
    from .tam import run

    run(a.db, DEFAULT_DB.parent if a.db == str(DEFAULT_DB) else Path(a.db).parent,
        max_pages=a.max_pages, timeout=a.timeout, workers=a.workers, use_browser=not a.tarayicisiz)
    print("Sonuçları görmek için: python -m isilan serve  →  http://127.0.0.1:8000")


def cmd_add_company(a):
    from .discover import probe_company

    found = probe_company(a.slug or a.company, company=a.company)
    if not found:
        sys.exit("Bilinen ATS'lerin hiçbirinde bulunamadı. Kariyer sayfası URL'si ile eklemek için --url kullanın.")
    for f in found:
        print(f"  {f['ats']:<16} slug={f['slug']:<25} ilan={f['jobs']} (İstanbul: {f['istanbul_jobs']})")
    best = max(found, key=lambda f: (f["istanbul_jobs"], f["jobs"]))
    _append_local({"company": a.company, "ats": best["ats"], "slug": best["slug"], "source_type": a.tur or "company",
                   "careers_url": best.get("url", ""), **({"region": best["region"]} if best.get("region") else {}),
                   "enabled": True})


def cmd_add_url(a):
    _append_local({"company": a.company, "ats": "careerpage", "careers_url": a.url, "source_type": a.tur or "company",
                   **({"link_pattern": a.link_pattern} if a.link_pattern else {}), "enabled": True})


def _append_local(entry: dict):
    from .sources.registry import DEFAULT_PATH

    p = DEFAULT_PATH.with_name("companies.local.json")
    data = json.loads(p.read_text(encoding="utf-8")) if p.exists() else []
    data.append(entry)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Eklendi → {p}")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m isilan", description="İstanbul iş ilanı toplayıcı")
    ap.add_argument("--db", default=str(DEFAULT_DB), help="SQLite dosyası (varsayılan: data/isilan.db)")
    ap.add_argument("-v", "--verbose", action="store_true")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("crawl", help="Kaynakları tara")
    p.add_argument("source", nargs="*", help="Yalnızca bu kaynaklar/türler (ör. kariyernet linkedin agency 'greenhouse:*')")
    p.add_argument("--max-pages", type=int, default=150)
    p.add_argument("--timeout", type=float, default=1200, help="Kaynak başına süre sınırı (sn)")
    p.add_argument("--workers", type=int, default=6)
    p.add_argument("--interval", type=float, default=1.0, help="Aynı siteye iki istek arası bekleme (sn)")
    p.add_argument("--details", action="store_true", help="Detay sayfalarını da çek (yavaş, daha zengin veri)")
    p.add_argument("--browser", action="store_true", help="Playwright gerektiren kaynakları da çalıştır")
    p.add_argument("--gorunur", action="store_true", help="Tarayıcıyı görünür pencerede aç (Kariyer.net gibi korumalı siteler için)")
    p.add_argument("--profil", default=None, help="Kalıcı tarayıcı profili klasörü (varsayılan --gorunur ile data/tarayici-profili)")
    p.add_argument("--haric", action="append", help="Bu kaynakları atla (ör. --haric kariyernet)")
    p.set_defaults(fn=cmd_crawl)

    p = sub.add_parser("serve", help="Web arayüzü")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--crawl-every", type=float, default=0, help="Her N saatte bir otomatik tara")
    p.add_argument("--crawl-now", action="store_true", help="Açılışta hemen taramaya başla")
    p.add_argument("--max-pages", type=int, default=150)
    p.add_argument("--workers", type=int, default=6)
    p.add_argument("--browser", action="store_true")
    p.set_defaults(fn=cmd_serve)

    p = sub.add_parser("list", help="İlanları listele")
    add_filter_args(p)
    p.add_argument("--limit", type=int, default=50)
    p.add_argument("--url", action="store_true", help="Bağlantıları da yazdır")
    p.set_defaults(fn=cmd_list)

    p = sub.add_parser("export", help="CSV/JSON dışa aktar")
    add_filter_args(p)
    p.add_argument("--out", default="ilanlar.csv")
    p.add_argument("--format", choices=["csv", "json"], default="csv")
    p.set_defaults(fn=cmd_export)

    p = sub.add_parser("sources", help="Kaynak listesi ve sağlık durumu")
    p.add_argument("--tur", action="append", choices=["platform", "company", "agency"])
    p.set_defaults(fn=cmd_sources)

    p = sub.add_parser("build-site", help="Tek dosyalık statik site üret")
    p.add_argument("--out", default="site/index.html")
    p.add_argument("--desc-len", type=int, default=240)
    p.add_argument("--profil", help="Gömülecek 'Bana uygun' profili (JSON: kw, haric, beyaz, km)")
    p.set_defaults(fn=cmd_build_site)

    p = sub.add_parser("ilceler", help="İlçe bazında ilan sayıları")
    p.set_defaults(fn=cmd_ilceler)

    p = sub.add_parser("tam", help="Hepsini sırayla: teşhis → derin tarama → korumalı siteler tarayıcıyla → teşhis zip'i")
    p.add_argument("--max-pages", type=int, default=400)
    p.add_argument("--timeout", type=float, default=3600)
    p.add_argument("--workers", type=int, default=6)
    p.add_argument("--tarayicisiz", action="store_true", help="Görünür tarayıcı adımını atla")
    p.set_defaults(fn=cmd_tam)

    p = sub.add_parser("teshis", help="Az/hiç ilan getiren kaynakları teşhis et, ham sayfaları kaydet")
    p.add_argument("source", nargs="*", help="Kaynak adları ya da tür (platform/company/agency); boşsa hepsi")
    p.add_argument("--max-pages", type=int, default=2)
    p.add_argument("--timeout", type=float, default=180)
    p.add_argument("--out", default=str(DEFAULT_DB.parent / "teshis"))
    p.add_argument("--browser", action="store_true")
    p.add_argument("--gorunur", action="store_true")
    p.add_argument("--profil", default=None, help="Kalıcı tarayıcı profili klasörü")
    p.set_defaults(fn=cmd_teshis)

    p = sub.add_parser("add-company", help="Şirketi ATS'lerde arayıp ekle")
    p.add_argument("company", help="Şirket adı (ör. 'Peak Games')")
    p.add_argument("--slug", help="ATS slug tahmini (varsayılan: şirket adından türetilir)")
    p.add_argument("--tur", choices=["company", "agency"])
    p.set_defaults(fn=cmd_add_company)

    p = sub.add_parser("add-url", help="Kariyer sayfası URL'si ile şirket ekle")
    p.add_argument("company")
    p.add_argument("url")
    p.add_argument("--link-pattern", help="İlan detay bağlantılarını seçen regex")
    p.add_argument("--tur", choices=["company", "agency"])
    p.set_defaults(fn=cmd_add_url)

    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if a.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s", datefmt="%H:%M:%S")
    a.fn(a)


if __name__ == "__main__":
    main()
