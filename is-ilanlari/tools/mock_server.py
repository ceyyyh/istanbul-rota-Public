"""Arayüz geliştirme için sahte API sunucusu (yalnızca standart kütüphane).

    python tools/mock_server.py [--port 8765]

/            -> isilan/static/index.html (sunucu modu)
/static.html -> aynı sayfa, window.__ISILAN_DATA__ gömülü (çevrimdışı mod testi)
/api/...     -> isilan/web.py ile aynı sözleşme (is_tipi, near, max_km, sort=near|fit, kw, haric dahil)

Metin katlama, iş tipi sınıflandırması ve konumlar isilan.text / isilan.classify / isilan.geo'dan alınır
(standart kütüphane dışında bağımlılık yok).

Üretilen ~200 ilan TAMAMEN SAHTE test verisidir (ör. "Örnek A.Ş."); hiçbir yerde yayımlanmaz.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from isilan.classify import collar as classify_collar  # noqa: E402
from isilan.geo import ORIGINS, distance_km, locate  # noqa: E402
from isilan.text import fold  # noqa: E402

INDEX = ROOT / "isilan" / "static" / "index.html"
MARKER = "<script>/*__ISILAN_DATA__*/</script>"

AVRUPA = ("Arnavutköy Avcılar Bağcılar Bahçelievler Bakırköy Başakşehir Bayrampaşa Beşiktaş Beylikdüzü Beyoğlu "
          "Büyükçekmece Çatalca Esenler Esenyurt Eyüpsultan Fatih Gaziosmanpaşa Güngören Kağıthane Küçükçekmece "
          "Sarıyer Silivri Sultangazi Şişli Zeytinburnu").split()
ANADOLU = ("Adalar Ataşehir Beykoz Çekmeköy Kadıköy Kartal Maltepe Pendik Sancaktepe Sultanbeyli Şile Tuzla "
           "Ümraniye Üsküdar").split()
SIDE = {d: "avrupa" for d in AVRUPA} | {d: "anadolu" for d in ANADOLU}
DISTRICTS = AVRUPA + ANADOLU
TYPE_LABELS = {"platform": "Platformlar", "company": "Şirket kariyer sayfaları", "agency": "İK / dış kaynak firmaları"}

SOURCES = [
    # name, label, type, status, needs_browser
    ("kariyernet", "Kariyer.net", "platform", "ok", False),
    ("linkedin", "LinkedIn", "platform", "partial", True),
    ("indeed", "Indeed", "platform", "ok", False),
    ("secretcv", "Secretcv", "platform", "ok", False),
    ("yenibiris", "Yenibiris", "platform", "error", False),
    ("greenhouse:ornek-teknoloji", "Örnek Teknoloji (Greenhouse)", "company", "ok", False),
    ("lever:deneme-yazilim", "Deneme Yazılım (Lever)", "company", "ok", False),
    ("workable:test-lojistik", "Test Lojistik (Workable)", "company", "empty", False),
    ("ornek-ik", "Örnek İK Danışmanlık", "agency", "ok", False),
    ("test-insan-kaynaklari", "Test İnsan Kaynakları", "agency", None, True),
]
LABEL = {s[0]: s[1] for s in SOURCES}
STYPE = {s[0]: s[2] for s in SOURCES}

TITLES = ["Yazılım Geliştirici", "Kıdemli Backend Geliştirici", "Muhasebe Uzmanı", "Satış Temsilcisi",
          "Depo Sorumlusu", "İnsan Kaynakları Uzmanı", "Grafik Tasarımcı", "Müşteri Hizmetleri Temsilcisi",
          "Veri Analisti", "Proje Yöneticisi", "Lojistik Planlama Uzmanı", "Mağaza Müdürü", "Frontend Developer",
          "Elektrik Mühendisi", "Dijital Pazarlama Uzmanı", "Ön Muhasebe Elemanı", "Kurye", "Hemşire",
          "Ürün Yöneticisi", "Çağrı Merkezi Müşteri Temsilcisi (uzun başlık örneği — vardiyalı çalışma)"]
COMPANIES = ["Örnek A.Ş.", "Deneme Ltd. Şti.", "Test Yazılım A.Ş.", "Mock Lojistik A.Ş.", "Örnek Gıda San. Tic. A.Ş.",
             "Sahte Perakende A.Ş.", "Deneme Sağlık Hizmetleri A.Ş."]
# Büyük şirket grupları (sahte örnek; ad, sektör)
GRUPLAR = [("Koç Topluluğu", "Holding"), ("Sabancı Holding", "Holding"), ("Anadolu Grubu", "Gıda & İçecek"),
           ("İş Bankası Grubu", "Bankacılık"), ("Turkcell", "Telekom"), ("Türk Hava Yolları", "Havacılık"),
           ("Unilever", "Tüketim"), ("Doğuş Grubu", "Holding"), ("Zorlu Holding", "Holding")]
GRUP_SEKTOR = dict(GRUPLAR)
CATEGORIES = ["Bilişim", "Finans", "Satış", "Lojistik", "Sağlık", "Pazarlama", ""]


# Konum metnine eklenen semtler (yakınlık testleri için; isilan.geo.PLACE_COORDS'ta tanımlı olanlar)
PLACES = {"Sarıyer": ["Maslak", "İstinye", "Tarabya", "PTT Evleri", "Büyükdere"], "Şişli": ["Mecidiyeköy"],
          "Beşiktaş": ["Levent", "Etiler"], "Kağıthane": ["Seyrantepe"], "Ataşehir": ["Ataşehir Finans Merkezi"]}
TITLES_EXTRA = ["Forklift Operatörü", "Garson", "Temizlik Personeli", "Güvenlik Görevlisi", "Asistan"]


def iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def make_jobs(n: int = 200) -> list[dict]:
    rnd = random.Random(42)
    now = datetime.now(timezone.utc)
    weights = [8 if d in ("Şişli", "Beşiktaş", "Kadıköy", "Ataşehir", "Ümraniye", "Sarıyer", "Kağıthane") else 2
               for d in DISTRICTS]
    weights[DISTRICTS.index("Adalar")] = 0  # 0 sayılı ilçe görünümünü test etmek için
    jobs = []
    for i in range(n):
        src = rnd.choice(SOURCES)
        name, stype = src[0], src[2]
        district = rnd.choices(DISTRICTS, weights)[0] if rnd.random() < 0.8 else None
        loc = (f"{district}, İstanbul" if rnd.random() < 0.7 else f"İstanbul ({SIDE[district].title()}) - {district}") \
            if district else rnd.choice(["İstanbul", "İstanbul, Türkiye", "İstanbul (Tümü)"])
        if district in PLACES and rnd.random() < 0.6:
            loc = f"{rnd.choice(PLACES[district])}, {district}, İstanbul"
        title = rnd.choice(TITLES + TITLES_EXTRA)
        work_model = rnd.choice(["remote", "hybrid", "onsite", "onsite", ""])
        posted = now - timedelta(hours=rnd.randint(1, 24 * 45))
        first_seen = posted + timedelta(hours=rnd.randint(0, 30))
        posted_at = None if rnd.random() < 0.15 else (posted.date().isoformat() if rnd.random() < 0.5 else iso(posted))
        dups = []
        if rnd.random() < 0.25:
            for other in rnd.sample([s for s in SOURCES if s[0] != name], rnd.randint(1, 3)):
                dups.append({"source": other[0], "source_type": other[2], "url": f"https://example.com/{other[0]}/{i}",
                             "source_label": other[1]})
        extra = {"agency": rnd.choice(["Örnek İK Danışmanlık", "Test İnsan Kaynakları"])} if stype == "agency" else {}
        category = rnd.choice(CATEGORIES)
        grup = rnd.choice(GRUPLAR)[0] if rnd.random() < 0.25 else None
        pt = None if work_model == "remote" else locate(f"{loc} {title}", district)
        jobs.append({
            "uid": f"mock{i:04d}", "external_id": str(i), "source": name, "source_label": LABEL[name], "source_type": stype,
            "title": title, "company": rnd.choice(COMPANIES), "url": f"https://example.com/ilan/{i}",
            "location": loc, "district": district, "side": SIDE.get(district) if district else None,
            "posted_at": posted_at, "first_seen": iso(first_seen), "last_seen": iso(now),
            "employment_type": rnd.choice(["Tam zamanlı", "Yarı zamanlı", "Staj", ""]),
            "work_model": work_model,
            "salary": rnd.choice(["", "", "", "35.000 - 45.000 TL", "Asgari ücret + prim"]),
            "category": category, "extra": extra, "grup": grup,
            "collar": classify_collar(title, category, name, stype),
            "lat": pt[0] if pt else None, "lon": pt[1] if pt else None,
            "description": "Bu ilan arayüz testi için üretilmiş SAHTE bir kayıttır. Gerçek bir iş ilanı değildir. "
                           "Görev tanımı, aranan nitelikler ve yan haklar burada yer alır; metin iki satırda kırpılır.",
            "duplicates": dups,
        })
    for j in jobs:  # isilan/db.py "search" sütunu
        j["_search"] = fold(" ".join(str(j.get(k) or "") for k in
                                     ("title", "company", "location", "district", "category", "description")))[:2000]
    return jobs


JOBS = make_jobs()
RUN_STATE: dict[str, dict] = {}


def sources_health() -> list[dict]:
    now = datetime.now(timezone.utc)
    active: dict[str, int] = {}
    for j in JOBS:
        active[j["source"]] = active.get(j["source"], 0) + 1
    out = []
    for i, (name, label, stype, status, nb) in enumerate(SOURCES):
        st = RUN_STATE.get(name, {}).get("status", status)
        out.append({"name": name, "label": label, "source_type": stype, "homepage": f"https://example.com/{name}",
                    "needs_browser": nb, "last_run": None if st is None else iso(now - timedelta(hours=i + 1)),
                    "last_status": st, "last_count": None if st is None else (0 if st == "empty" else 20 + i),
                    "last_error": {"error": "HTTP 403: erişim engellendi (örnek hata mesajı)",
                                   "partial": "3 sayfadan 1'i alınamadı (zaman aşımı)"}.get(st),
                    "active_count": active.get(name, 0)})
    return out


def parse(qs: dict) -> dict:
    def lst(k):
        return [x.strip() for v in qs.get(k, []) for x in v.split(",") if x.strip()]

    def one(k, d=""):
        return (qs.get(k) or [d])[0] or d
    return {"q": one("q"), "ilce": lst("ilce"), "unk": one("ilce_bilinmiyor") in ("1", "true"), "yaka": one("yaka"),
            "st": lst("source_type"), "src": lst("source"), "wm": lst("work_model"), "days": one("days"),
            "sort": one("sort", "new"), "collars": lst("is_tipi"), "near": point(one("near")),
            "max_km": num(one("max_km")), "kw": terms(lst("kw")), "ex": terms(lst("haric")),
            "grup": lst("grup"), "buyuk": one("buyuk") in ("1", "true") or bool(lst("grup"))}


def num(v):
    try:
        return float(v) if v else None
    except ValueError:
        return None


def point(v):
    if not v or "," not in v:
        return None
    a, b = (num(x) for x in v.split(",", 1))
    return (a, b) if a is not None and b is not None and -90 <= a <= 90 and -180 <= b <= 180 else None


def terms(vals: list[str]) -> list[str]:
    out: list[str] = []
    for v in vals:
        t = fold(v)
        if t and t not in out:
            out.append(t)
    return out


def dist2(j: dict, near) -> float | None:
    """isilan/db.py ile aynı: eşdikdörtgen yaklaşımıyla uzaklığın karesi (km²); süzme ve sıralama için."""
    if j["lat"] is None or j["lon"] is None:
        return None
    kx = 111.32 * math.cos(math.radians(near[0]))
    return ((j["lat"] - near[0]) * 111.32) ** 2 + ((j["lon"] - near[1]) * kx) ** 2


def score(j: dict, kw: list[str]) -> int:
    return sum(1 for t in kw if t in j["_search"])


def match(j: dict, f: dict, ignore=()) -> bool:
    if "district" not in ignore and f["ilce"]:
        if j["district"] not in f["ilce"] and not (f["unk"] and j["district"] is None):
            return False
    if "side" not in ignore and f["yaka"] and j["side"] != f["yaka"]:
        return False
    if "source_type" not in ignore and f["st"] and j["source_type"] not in f["st"]:
        return False
    if "source" not in ignore and f["src"] and j["source"] not in f["src"]:
        return False
    if f["wm"] and j["work_model"] not in f["wm"]:
        return False
    if f["days"].isdigit():
        cut = (datetime.now(timezone.utc) - timedelta(days=int(f["days"]))).date().isoformat()
        if ((j["posted_at"] or "")[:10] or j["first_seen"][:10]) < cut:
            return False
    if f["q"] and not all(t in j["_search"] for t in fold(f["q"]).split()):
        return False
    if "collar" not in ignore and f["collars"]:
        if (j["collar"] if j["collar"] in ("beyaz", "mavi") else "belirsiz") not in f["collars"]:
            return False
    if "grup" not in ignore:
        if f["buyuk"] and j["grup"] is None:
            return False
        if f["grup"] and j["grup"] not in f["grup"]:
            return False
    if f["near"] and f["max_km"]:
        d = dist2(j, f["near"])
        if d is None or d > f["max_km"] ** 2:
            return False
    if f["kw"] and not score(j, f["kw"]):
        return False
    if any(t in j["_search"] for t in f["ex"]):
        return False
    return True


def query(f: dict) -> list[dict]:
    items = [j for j in JOBS if match(j, f)]
    key = lambda j: j["posted_at"] or j["first_seen"]  # noqa: E731
    if f["sort"] == "old":
        items.sort(key=key)
    elif f["sort"] == "company":
        items.sort(key=lambda j: (fold(j["company"]), fold(j["title"])))
    else:
        items.sort(key=key, reverse=True)
        if f["sort"] == "near" and f["near"]:  # konumsuzlar sonda, eşitlikte en yeni (kararlı sıralama)
            items.sort(key=lambda j: (j["lat"] is None, dist2(j, f["near"]) or 0))
        elif f["sort"] == "fit" and f["kw"]:
            items.sort(key=lambda j: -score(j, f["kw"]))
    return items


def annotate(j: dict, f: dict) -> dict:
    d = {k: v for k, v in j.items() if not k.startswith("_")}
    if f["near"]:
        d["distance_km"] = round(distance_km(f["near"], (j["lat"], j["lon"])), 1) if j["lat"] is not None else None
    if f["kw"]:
        text = fold(" ".join(str(j.get(k) or "") for k in ("title", "company", "location", "district", "category", "description")))
        hits = [t for t in f["kw"] if t in text]
        d["match"] = {"score": len(hits), "terms": hits}
    return d


def facets(f: dict) -> dict:
    d, st, sc, unk, cc, gc = {}, {}, {}, 0, {}, {}
    for j in JOBS:
        if match(j, f, ("district", "side")):
            if j["district"]:
                d[j["district"]] = d.get(j["district"], 0) + 1
            else:
                unk += 1
        if match(j, f, ("source_type",)):
            st[j["source_type"]] = st.get(j["source_type"], 0) + 1
        if match(j, f, ("source",)):
            sc[j["source"]] = sc.get(j["source"], 0) + 1
        if match(j, f, ("collar",)):
            cc[j["collar"]] = cc.get(j["collar"], 0) + 1
        if j["grup"] and match(j, f, ("grup",)):
            gc[j["grup"]] = gc.get(j["grup"], 0) + 1
    return {"total": sum(1 for j in JOBS if match(j, f)),
            "last_crawl": iso(datetime.now(timezone.utc) - timedelta(hours=2)),
            "districts": [{"name": n, "side": SIDE[n], "count": d.get(n, 0)} for n in DISTRICTS],
            "unknown_district": unk,
            "source_types": [{"name": k, "label": v, "count": st.get(k, 0)} for k, v in TYPE_LABELS.items()],
            "sources": [{"name": n, "label": LABEL[n], "source_type": STYPE[n], "count": c}
                        for n, c in sorted(sc.items(), key=lambda kv: -kv[1])],
            "collars": [{"name": "beyaz", "label": "Beyaz yaka", "count": cc.get("beyaz", 0)},
                        {"name": "mavi", "label": "Mavi yaka", "count": cc.get("mavi", 0)},
                        {"name": "belirsiz", "label": "Belirsiz", "count": cc.get(None, 0)}],
            "gruplar": [{"name": n, "sektor": GRUP_SEKTOR.get(n, ""), "count": c}
                        for n, c in sorted(gc.items(), key=lambda kv: (-kv[1], kv[0]))],
            "buyuk_total": sum(gc.values()),
            "origins": ORIGINS}


class Crawl:
    lock = threading.Lock()
    status = {"running": False, "started_at": None, "finished_at": None,
              "progress": {"done": 0, "total": 0, "current": ""}, "log": [], "results": {}}

    @classmethod
    def start(cls, names):
        if cls.status["running"]:
            return False
        srcs = [s for s in SOURCES if not names or s[0] in names or s[2] in names]
        cls.status.update(running=True, started_at=iso(datetime.now(timezone.utc)), finished_at=None,
                          progress={"done": 0, "total": len(srcs), "current": ""}, log=[], results={})

        def run():
            rnd = random.Random()
            for s in srcs:
                cls.status["progress"]["current"] = s[0]
                cls.status["log"].append(f"{time.strftime('%H:%M:%S')} {s[0]} taranıyor…")
                time.sleep(0.8)
                st = "error" if s[3] == "error" else "ok"
                res = {"status": st, "fetched": rnd.randint(10, 60), "kept": rnd.randint(5, 40), "new": rnd.randint(0, 6),
                       "removed": rnd.randint(0, 3), "error": "HTTP 403 (örnek)" if st == "error" else None}
                cls.status["results"][s[0]] = res
                RUN_STATE[s[0]] = {"status": st}
                cls.status["log"].append(f"{time.strftime('%H:%M:%S')} {s[0]}: {st}, {res['kept']} ilan, {res['new']} yeni")
                cls.status["progress"]["done"] += 1
            cls.status["progress"]["current"] = ""
            cls.status.update(running=False, finished_at=iso(datetime.now(timezone.utc)))
        threading.Thread(target=run, daemon=True).start()
        return True


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body: bytes, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def js(self, obj, code=200):
        self.send(code, json.dumps(obj, ensure_ascii=False).encode(), "application/json; charset=utf-8")

    def do_GET(self):  # noqa: N802
        u = urlparse(self.path)
        qs = parse_qs(u.query)
        if u.path in ("/", "/index.html"):
            return self.send(200, INDEX.read_bytes(), "text/html; charset=utf-8")
        if u.path == "/static.html":
            data = {"generated_at": iso(datetime.now(timezone.utc) - timedelta(hours=5)),
                    "jobs": [{k: v for k, v in j.items() if k not in ("extra", "external_id") and not k.startswith("_")}
                             for j in JOBS],
                    "sources": sources_health(), "origins": ORIGINS,
                    "gruplar": [{"name": n, "sektor": k} for n, k in GRUPLAR]}
            blob = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
            html = INDEX.read_text(encoding="utf-8").replace(MARKER, f"<script>window.__ISILAN_DATA__={blob};</script>")
            return self.send(200, html.encode(), "text/html; charset=utf-8")
        if u.path == "/api/jobs":
            f = parse(qs)
            items = query(f)
            page = max(1, int((qs.get("page") or ["1"])[0] or 1))
            per = min(500, max(1, int((qs.get("per_page") or ["50"])[0] or 50)))
            return self.js({"total": len(items), "page": page, "per_page": per,
                            "items": [annotate(j, f) for j in items[(page - 1) * per: page * per]]})
        if u.path == "/api/facets":
            return self.js(facets(parse(qs)))
        if u.path == "/api/sources":
            return self.js(sources_health())
        if u.path == "/api/crawl":
            return self.js(Crawl.status)
        self.js({"error": "bulunamadı"}, 404)

    def do_POST(self):  # noqa: N802
        if urlparse(self.path).path != "/api/crawl":
            return self.js({"error": "bulunamadı"}, 404)
        n = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(n) or b"{}") if n else {}
        except json.JSONDecodeError:
            body = {}
        started = Crawl.start(body.get("sources") or None)
        self.js({"started": started, "running": Crawl.status["running"]})


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")
    a = ap.parse_args()
    print(f"Sahte sunucu: http://{a.host}:{a.port}/  (çevrimdışı mod: /static.html)")
    ThreadingHTTPServer((a.host, a.port), H).serve_forever()
