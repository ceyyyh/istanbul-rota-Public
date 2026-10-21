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


def _yeni_alan_db(tmp_path):
    db = DB(tmp_path / "y.db")
    rows = [
        ("1", "Senior Developer", "Çağrı Yazılım A.Ş.", "Maslak, Sarıyer", "Sarıyer", "FULL_TIME", "50.000 TL"),
        ("2", "Stajyer", "Çağrı Yazılım", "Levent, İstanbul", "Beşiktaş", "INTERN", ""),
        ("3", "Satış Müdürü", "Başka Firma", "Seyrantepe, Kağıthane", "Kağıthane", "PART_TIME", "Görüşülecek"),
        ("4", "Garson", "Kafe", "Kadıköy", "Kadıköy", "", ""),
    ]
    jobs = [{"uid": f"ab{i}", "source": "t", "source_type": PLATFORM, "external_id": i, "title": t, "company": c,
             "url": f"https://t/{i}", "location": loc, "district": d, "employment_type": e, "salary": s,
             "description": f"Tam açıklama {i}", "dedupe_key": f"k{i}",
             "extra": {"validThrough": "2027-01-01", "apply_url": f"https://apply/{i}"}}
            for i, t, c, loc, d, e, s in rows]
    db.upsert_jobs(jobs[:2], "2026-10-01T00:00:00.000Z")
    db.upsert_jobs(jobs[2:], "2026-10-10T00:00:00.000Z")
    return db


def _serve(db):
    srv = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(App(db)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}"


def test_yeni_filtreler_facets_ve_tek_ilan(tmp_path, monkeypatch):
    import urllib.error

    import pytest

    monkeypatch.setattr("isilan.web.source_meta", lambda: {"t": {"name": "t", "label": "Test", "source_type": PLATFORM,
                                                                   "homepage": "", "needs_browser": False}})
    db = _yeni_alan_db(tmp_path)
    srv, base = _serve(db)

    def get(path):
        with urllib.request.urlopen(base + path) as r:
            return json.loads(r.read())

    def titles(qs):
        return sorted(i["title"] for i in get("/api/jobs?" + qs)["items"])

    try:
        assert titles("semt=Maslak") == ["Senior Developer"]
        assert titles("semt=Maslak&semt=Levent") == ["Senior Developer", "Stajyer"]      # tekrarlanabilir
        assert titles("semt=Maslak,Seyrantepe") == ["Satış Müdürü", "Senior Developer"]
        assert titles("kidem=stajyer") == ["Stajyer"]
        assert titles("kidem=kidemli&kidem=yonetici") == ["Satış Müdürü", "Senior Developer"]
        assert titles("istihdam=yari") == ["Satış Müdürü"]
        assert titles("istihdam=tam&istihdam=staj") == ["Senior Developer", "Stajyer"]
        assert titles("sirket=CAGRI%20yazilim") == ["Stajyer"]          # tam eşleşme (A.Ş. ekli olan ayrı)
        assert titles("sirket=%C3%87a%C4%9Fr%C4%B1%20Yaz%C4%B1l%C4%B1m%20A.%C5%9E.") == ["Senior Developer"]
        assert titles("sirket=cagri") == []                              # kısmi eşleşme yok
        assert titles("maasli=1") == ["Senior Developer"]
        assert titles("yeni_since=2026-10-05T00:00:00Z") == ["Garson", "Satış Müdürü"]
        assert titles("yeni_since=2026-10-05T00:00:00%2B00:00") == ["Garson", "Satış Müdürü"]
        assert len(get("/api/jobs")["items"]) == 4                        # filtresiz davranış aynı

        f = get("/api/facets")
        assert f["semt"] == {"Levent": 1, "Maslak": 1, "Seyrantepe": 1}
        assert f["kidem"] == {"kidemli": 1, "stajyer": 1, "yonetici": 1}
        assert f["istihdam"] == {"staj": 1, "tam": 1, "yari": 1}
        assert f["total"] == 4 and "districts" in f and "collars" in f       # mevcut alanlar korunur
        # kendi filtresi sayımda yok sayılır, diğerleri uygulanır
        f2 = get("/api/facets?semt=Maslak&kidem=kidemli")
        assert f2["semt"] == {"Maslak": 1} and f2["kidem"] == {"kidemli": 1}
        assert get("/api/facets?istihdam=tam")["kidem"] == {"kidemli": 1}

        item = get("/api/jobs?semt=Maslak")["items"][0]
        assert (item["semt"], item["kidem"], item["istihdam"], item["maasli"]) == ("Maslak", "kidemli", "tam", 1)

        j = get("/api/job?uid=ab1")
        assert j["title"] == "Senior Developer" and j["description"] == "Tam açıklama 1"
        assert j["extra"]["validThrough"] == "2027-01-01" and j["extra"]["apply_url"] == "https://apply/1"
        assert j["first_seen"] == "2026-10-01T00:00:00.000Z" and j["last_seen"] == "2026-10-01T00:00:00.000Z"
        assert j["source_label"] == "Test" and j["semt"] == "Maslak"
        for bad in ("/api/job?uid=yok", "/api/job"):
            with pytest.raises(urllib.error.HTTPError) as ei:
                get(bad)
            assert ei.value.code == 404 and json.loads(ei.value.read())["error"]
    finally:
        srv.shutdown()


def test_build_site_detay_parcalari_ve_export(tmp_path, monkeypatch):
    from isilan.__main__ import main
    from isilan.enrich import SEMTLER

    monkeypatch.setattr("isilan.web.source_meta", lambda: {"t": {"name": "t", "label": "Test", "source_type": PLATFORM,
                                                                   "homepage": "", "needs_browser": False}})
    db = _yeni_alan_db(tmp_path)
    db.upsert_jobs([{"uid": "ab9", "source": "t", "source_type": PLATFORM, "external_id": "9", "title": "Uzun", "company": "X",
                     "url": "u", "location": "Maslak", "district": "Sarıyer", "description": "a" * 6000, "dedupe_key": "k9",
                     "extra": {"apply_link": "https://apply/link", "agency": "İK"}}], "2026-10-11T00:00:00.000Z")
    db.close()
    site = tmp_path / "cikti" / "index.html"
    (site.parent / "detay").mkdir(parents=True)
    (site.parent / "detay" / "zz.json").write_text("{}")   # eski parça temizlenmeli
    main(["--db", str(tmp_path / "y.db"), "build-site", "--out", str(site)])

    blob = site.read_text(encoding="utf-8").split("window.__ISILAN_DATA__=", 1)[1].split(";</script>", 1)[0]
    data = json.loads(blob)
    assert data["detay_dir"] == "detay/" and data["semtler"] == SEMTLER
    by_uid = {j["uid"]: j for j in data["jobs"]}
    assert len(by_uid) == 5
    assert by_uid["ab1"]["semt"] == "Maslak" and by_uid["ab1"]["kidem"] == "kidemli" and by_uid["ab1"]["maasli"] == 1
    assert by_uid["ab9"]["description"] == "a" * 240                        # ana veride 240'ta kalır
    assert by_uid["ab9"]["extra"] == {"agency": "İK"}

    parts = sorted(p.name for p in (site.parent / "detay").iterdir())
    assert parts == ["ab.json"]                                               # tüm uid'ler "ab" ile başlıyor; eski parça silindi
    part = json.loads((site.parent / "detay" / "ab.json").read_text(encoding="utf-8"))
    assert set(part) == set(by_uid)
    assert part["ab1"] == {"description": "Tam açıklama 1", "apply_url": "https://apply/1", "validThrough": "2027-01-01",
                           "first_seen": "2026-10-01T00:00:00.000Z", "last_seen": "2026-10-01T00:00:00.000Z"}
    assert len(part["ab9"]["description"]) == 5000 and part["ab9"]["apply_url"] == "https://apply/link"

    out = tmp_path / "k.csv"
    main(["--db", str(tmp_path / "y.db"), "export", "--out", str(out)])
    head = out.read_text(encoding="utf-8-sig").splitlines()[0].split(";")
    assert {"semt", "kidem", "istihdam", "maasli"} <= set(head)
    out2 = tmp_path / "k.json"
    main(["--db", str(tmp_path / "y.db"), "export", "--out", str(out2)])
    assert {"semt", "kidem", "istihdam", "maasli"} <= set(json.loads(out2.read_text(encoding="utf-8"))[0])
