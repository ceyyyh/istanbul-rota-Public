"""SQLite deposu: ilanlar, kaynak çalıştırma geçmişi, sorgular."""
from __future__ import annotations

import json
import math
import os
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .text import fold

DEFAULT_DB = Path(os.environ.get("ISILAN_DB", Path(__file__).resolve().parents[1] / "data" / "isilan.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    uid TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    source_type TEXT NOT NULL,
    external_id TEXT,
    title TEXT NOT NULL,
    company TEXT,
    url TEXT,
    location TEXT,
    district TEXT,
    side TEXT,
    posted_at TEXT,
    employment_type TEXT,
    work_model TEXT,
    description TEXT,
    salary TEXT,
    category TEXT,
    extra TEXT,
    dedupe_key TEXT,
    search TEXT,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    collar TEXT,
    lat REAL,
    lon REAL
);
CREATE INDEX IF NOT EXISTS ix_jobs_active ON jobs(active, district);
CREATE INDEX IF NOT EXISTS ix_jobs_source ON jobs(source, active);
CREATE INDEX IF NOT EXISTS ix_jobs_dedupe ON jobs(dedupe_key);
CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT,
    count INTEGER DEFAULT 0,
    kept INTEGER DEFAULT 0,
    error TEXT
);
CREATE INDEX IF NOT EXISTS ix_runs_source ON runs(source, id);
"""

COLUMNS = ["uid", "source", "source_type", "external_id", "title", "company", "url", "location", "district",
           "side", "posted_at", "employment_type", "work_model", "description", "salary", "category", "extra",
           "dedupe_key", "first_seen", "last_seen", "active", "collar", "lat", "lon"]

# Sonradan eklenen sütunlar: eski veritabanlarına ALTER TABLE ile eklenir ve doldurulur
_ADDED_COLUMNS = {"collar": "TEXT", "lat": "REAL", "lon": "REAL"}

# Aynı ilan birden çok kaynakta varsa hangisi "asıl" gösterilsin: önce şirketin kendi sayfası
TYPE_PRIORITY = {"company": 0, "agency": 1, "platform": 2}

_COMPANY_SUFFIX = (" a s", " as", " ltd sti", " ltd", " sti", " san ve tic", " sanayi ve ticaret", " tic", " san",
                   " inc", " llc", " gmbh", " holding", " teknoloji", " turkiye", " turkey", " anonim sirketi")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def norm_company(name: str) -> str:
    s = fold(name)
    changed = True
    while changed:
        changed = False
        for suf in _COMPANY_SUFFIX:
            if s.endswith(suf) and len(s) > len(suf) + 2:
                s = s[: -len(suf)].strip()
                changed = True
    return s


def dedupe_key(title: str, company: str, district: str | None) -> str:
    return f"{fold(title)}|{norm_company(company)}|{district or ''}"


class DB:
    def __init__(self, path: str | Path = DEFAULT_DB):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self.conn = sqlite3.connect(self.path, check_same_thread=False, timeout=30)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.executescript(SCHEMA)
        self._migrate()
        self._writes = 0          # her yazmada artar (sorgu önbelleği anahtarı)
        self._cache: dict = {}

    def close(self):
        self.conn.close()

    def _migrate(self):
        have = {r[1] for r in self.conn.execute("PRAGMA table_info(jobs)")}
        missing = [c for c in _ADDED_COLUMNS if c not in have]
        if not missing:
            return
        with self.conn:
            for c in missing:
                self.conn.execute(f"ALTER TABLE jobs ADD COLUMN {c} {_ADDED_COLUMNS[c]}")
        self.backfill()

    def backfill(self) -> int:
        """İş tipi (beyaz/mavi yaka) ve yaklaşık koordinatı tüm ilanlar için yeniden hesaplar."""
        from .classify import collar
        from .geo import locate

        rows = self.conn.execute("SELECT uid, title, category, source, source_type, location, district FROM jobs").fetchall()
        upd = []
        for r in rows:
            c = locate(f"{r['location'] or ''} {r['title'] or ''}", r["district"])
            upd.append((collar(r["title"] or "", r["category"] or "", r["source"], r["source_type"]),
                        c[0] if c else None, c[1] if c else None, r["uid"]))
        with self._lock, self.conn:
            self.conn.executemany("UPDATE jobs SET collar=?, lat=?, lon=? WHERE uid=?", upd)
        return len(upd)

    # ---- yazma ----
    def upsert_jobs(self, rows: list[dict], seen_at: str) -> tuple[int, int]:
        """Döner: (yeni, güncellenen)."""
        new = upd = 0
        with self._lock, self.conn:
            self._writes += 1
            for r in rows:
                cur = self.conn.execute("SELECT first_seen FROM jobs WHERE uid=?", (r["uid"],)).fetchone()
                r = dict(r)
                r["extra"] = json.dumps(r.get("extra") or {}, ensure_ascii=False)
                r["search"] = fold(" ".join(str(r.get(k) or "") for k in ("title", "company", "location", "district", "category", "description")))[:2000]
                r["last_seen"] = seen_at
                r["active"] = 1
                if cur:
                    r["first_seen"] = cur["first_seen"]
                    upd += 1
                else:
                    r["first_seen"] = seen_at
                    new += 1
                cols = COLUMNS + ["search"]
                self.conn.execute(
                    f"INSERT OR REPLACE INTO jobs ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                    [r.get(c) for c in cols],
                )
        return new, upd

    def known_districts(self, uids: list[str]) -> dict[str, dict]:
        """Önceki taramalarda (ör. detay sayfasından) bulunmuş ilçe bilgisi; üzerine None yazılmasın diye."""
        out: dict[str, dict] = {}
        with self._lock:
            for i in range(0, len(uids), 500):
                chunk = uids[i:i + 500]
                for r in self.conn.execute(f"SELECT uid, district, side, extra FROM jobs WHERE uid IN ({','.join('?' * len(chunk))})", chunk):
                    try:
                        extra = json.loads(r["extra"] or "{}")
                    except json.JSONDecodeError:
                        extra = {}
                    out[r["uid"]] = {"district": r["district"], "side": r["side"], "extra": extra}
        return out

    def deactivate_missing(self, source: str, before: str) -> int:
        """Bu taramada görülmeyen ilanları pasife çeker (ilan kaldırılmış demektir)."""
        with self._lock, self.conn:
            self._writes += 1
            cur = self.conn.execute("UPDATE jobs SET active=0 WHERE source=? AND active=1 AND last_seen<?", (source, before))
            return cur.rowcount

    def expire_old(self, days: int = 45) -> int:
        """Uzun süredir hiçbir taramada görülmeyen ilanları pasife çeker; geçerlilik tarihi geçenleri de."""
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        today = datetime.now(timezone.utc).date().isoformat()
        with self._lock, self.conn:
            self._writes += 1
            n = self.conn.execute("UPDATE jobs SET active=0 WHERE active=1 AND last_seen<?", (cutoff,)).rowcount
            n += self.conn.execute(
                "UPDATE jobs SET active=0 WHERE active=1 AND json_extract(extra,'$.validThrough') IS NOT NULL "
                "AND json_extract(extra,'$.validThrough') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' AND substr(json_extract(extra,'$.validThrough'),1,10)<?",
                (today,),
            ).rowcount
            return n

    def start_run(self, source: str) -> int:
        with self._lock, self.conn:
            return self.conn.execute("INSERT INTO runs(source, started_at) VALUES (?,?)", (source, now_iso())).lastrowid

    def finish_run(self, run_id: int, status: str, count: int, kept: int, error: str | None = None):
        with self._lock, self.conn:
            self.conn.execute("UPDATE runs SET finished_at=?, status=?, count=?, kept=?, error=? WHERE id=?",
                              (now_iso(), status, count, kept, (error or "")[:1000] or None, run_id))

    # ---- okuma ----
    def last_runs(self) -> dict[str, sqlite3.Row]:
        with self._lock:  # bağlantı tarama iş parçacıklarıyla paylaşılıyor
            rows = self._last_runs()
        return {r["source"]: r for r in rows}

    def _last_runs(self):
        return self.conn.execute(
            "SELECT r.* FROM runs r JOIN (SELECT source, MAX(id) mid FROM runs WHERE finished_at IS NOT NULL GROUP BY source) m "
            "ON r.id=m.mid").fetchall()

    def last_crawl(self) -> str | None:
        with self._lock:
            r = self.conn.execute("SELECT MAX(finished_at) FROM runs").fetchone()
        return r[0] if r else None

    def active_counts_by_source(self) -> dict[str, int]:
        with self._lock:
            return {r[0]: r[1] for r in self.conn.execute("SELECT source, COUNT(*) FROM jobs WHERE active=1 GROUP BY source")}

    def query(self, *, q: str = "", districts: list[str] | None = None, include_unknown: bool = False,
              side: str | None = None, source_types: list[str] | None = None, sources: list[str] | None = None,
              work_models: list[str] | None = None, days: int | None = None, sort: str = "new",
              page: int = 1, per_page: int = 50, dedupe: bool = True, ignore: tuple[str, ...] = (),
              collars: list[str] | None = None, near: tuple[float, float] | None = None,
              max_km: float | None = None, kw: list[str] | None = None, exclude: list[str] | None = None) -> dict:
        """Filtrelenmiş ve (isteğe bağlı) tekilleştirilmiş ilan listesi. `ignore`: faset sayımı için
        yok sayılacak filtre adları."""
        where, args = ["active=1"], []
        if q and "q" not in ignore:
            for tok in fold(q).split():
                where.append("search LIKE ?")
                args.append(f"%{tok}%")
        if "district" not in ignore and districts:  # ilçe seçilmediyse tümü (belirsizler dahil)
            parts = []
            if districts:
                parts.append(f"district IN ({','.join('?' * len(districts))})")
                args.extend(districts)
            if include_unknown:
                parts.append("district IS NULL")
            if parts:
                where.append("(" + " OR ".join(parts) + ")")
        if side and "side" not in ignore:
            where.append("side=?")
            args.append(side)
        if source_types and "source_type" not in ignore:
            where.append(f"source_type IN ({','.join('?' * len(source_types))})")
            args.extend(source_types)
        if sources and "source" not in ignore:
            where.append(f"source IN ({','.join('?' * len(sources))})")
            args.extend(sources)
        if work_models and "work_model" not in ignore:
            where.append(f"work_model IN ({','.join('?' * len(work_models))})")
            args.extend(work_models)
        if days and "days" not in ignore:
            cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).date().isoformat()
            where.append("COALESCE(NULLIF(substr(posted_at,1,10),''), substr(first_seen,1,10)) >= ?")
            args.append(cutoff)
        if collars and "collar" not in ignore:
            known = [c for c in collars if c in ("beyaz", "mavi")]
            parts = [f"collar IN ({','.join('?' * len(known))})"] if known else []
            args.extend(known)
            if "belirsiz" in collars:
                parts.append("collar IS NULL")
            if parts:
                where.append("(" + " OR ".join(parts) + ")")
        dist_sql = None
        if near:
            # Kuş uçuşu uzaklığın karesi (km²), eşdikdörtgen yaklaşımı — sıralama ve süzme için yeterli
            a, b = float(near[0]), float(near[1])
            kx = 111.32 * math.cos(math.radians(a))
            dist_sql = f"(((lat-({a}))*111.32)*((lat-({a}))*111.32)+((lon-({b}))*{kx})*((lon-({b}))*{kx}))"
            if max_km and "max_km" not in ignore:
                where.append(f"lat IS NOT NULL AND {dist_sql} <= {float(max_km) ** 2}")
        kw_terms = _terms(kw)
        score_sql = None
        if kw_terms and "kw" not in ignore:
            score_sql = "(" + "+".join(f"(search LIKE '%{t}%')" for t in kw_terms) + ")"
            where.append(f"{score_sql} > 0")
        for t in _terms(exclude):
            if "exclude" not in ignore:
                where.append(f"search NOT LIKE '%{t}%'")
        newest = "COALESCE(NULLIF(posted_at,''), first_seen) DESC"
        if sort == "near" and dist_sql:
            order = f"lat IS NULL, {dist_sql} ASC, {newest}"
        elif sort == "fit" and score_sql:
            order = f"{score_sql} DESC, {newest}"
        else:
            order = None
        order = order or {
            "new": "COALESCE(NULLIF(posted_at,''), first_seen) DESC",
            "old": "COALESCE(NULLIF(posted_at,''), first_seen) ASC",
            "company": "company COLLATE NOCASE ASC, title ASC",
        }.get(sort, "COALESCE(NULLIF(posted_at,''), first_seen) DESC")
        sql_where = " AND ".join(where)
        reps = self._deduped(sql_where, tuple(args), order, dedupe)
        total = len(reps)
        start = max(0, (page - 1) * per_page)
        items = self._full_items(reps[start:start + per_page])
        for d in items:
            _annotate(d, near, kw_terms)
        return {"total": total, "page": page, "per_page": per_page, "items": items, "_all": _LazyItems(self, reps)}

    # Hafif sütunlar: tekilleştirme ve faset sayımı için tüm satırları (açıklama vb. olmadan) okur
    _LIGHT = "uid, dedupe_key, source, source_type, district, url, collar"

    def _version(self):
        """Veri değiştiğinde değişen anahtar: bu bağlantının yazmaları + başka bağlantıların
        (ör. ayrı süreçte çalışan `crawl`) commit'leri (PRAGMA data_version)."""
        return self._writes, self.conn.execute("PRAGMA data_version").fetchone()[0]

    def _deduped(self, sql_where: str, args: tuple, order: str, dedupe: bool) -> list[tuple]:
        """Döner: [(temsilci_satır, [yinelenen_satırlar])] — satırlar hafif tuple'lardır."""
        with self._lock:
            key = (sql_where, args, order, dedupe)
            ver = self._version()
            hit = self._cache.get(key)
            if hit and hit[0] == ver:
                return hit[1]
            rows = self.conn.execute(f"SELECT {self._LIGHT} FROM jobs WHERE {sql_where} ORDER BY {order}", args).fetchall()
        if dedupe:
            groups: dict[str, list] = {}
            order_keys: list[str] = []
            for r in rows:
                k = r[1] or r[0]
                g = groups.get(k)
                if g is None:
                    groups[k] = [r]
                    order_keys.append(k)
                else:
                    g.append(r)
            reps = []
            for k in order_keys:
                g = groups[k]
                if len(g) > 1:
                    g.sort(key=lambda x: TYPE_PRIORITY.get(x[3], 9))
                reps.append((g[0], g[1:]))
        else:
            reps = [(r, []) for r in rows]
        with self._lock:
            if len(self._cache) >= 64:
                self._cache.pop(next(iter(self._cache)))
            self._cache[key] = (ver, reps)
        return reps

    def _full_items(self, reps: list[tuple]) -> list[dict]:
        uids = [r[0] for r, _ in reps]
        full: dict[str, sqlite3.Row] = {}
        with self._lock:
            for i in range(0, len(uids), 900):
                chunk = uids[i:i + 900]
                for row in self.conn.execute(f"SELECT * FROM jobs WHERE uid IN ({','.join('?' * len(chunk))})", chunk):
                    full[row["uid"]] = row
        out = []
        for r, dups in reps:
            row = full.get(r[0])
            if row is None:  # okuma arasında silinmiş (olağan değil)
                continue
            d = row_to_dict(row)
            d["duplicates"] = [{"source": x[2], "source_type": x[3], "url": x[5]} for x in dups]
            out.append(d)
        return out


class _LazyItems(list):
    """query()["_all"]: tekilleştirilmiş tüm ilanlar. Faset sayımı yalnızca district / source /
    source_type alanlarını okuduğundan bunlar hafif satırlardan verilir; tam satırlar (açıklama,
    extra ...) yalnızca gerektiğinde (`full()`) okunur."""

    def __init__(self, db: "DB", reps: list[tuple]):
        super().__init__({"uid": r[0], "dedupe_key": r[1], "source": r[2], "source_type": r[3], "district": r[4],
                          "url": r[5], "collar": r[6], "duplicates": [{"source": x[2], "source_type": x[3], "url": x[5]} for x in d]}
                         for r, d in reps)
        self._db, self._reps = db, reps

    def full(self) -> list[dict]:
        return self._db._full_items(self._reps)


def _terms(values: list[str] | None) -> list[str]:
    """Katlanmış arama terimleri; fold() yalnızca [a-z0-9 ] bıraktığı için SQL'e güvenle gömülebilir."""
    out: list[str] = []
    for v in values or []:
        t = fold(v)
        if t and t not in out:
            out.append(t)
    return out


def _annotate(d: dict, near, kw_terms: list[str]):
    """Uzaklık (near verildiyse) ve eşleşen anahtar kelimeleri (kw verildiyse) ilana ekler."""
    if near:
        from .geo import distance_km

        d["distance_km"] = round(distance_km(near, (d["lat"], d["lon"])), 1) if d.get("lat") is not None else None
    if kw_terms:
        text = fold(" ".join(str(d.get(k) or "") for k in ("title", "company", "location", "district", "category", "description")))
        hits = [t for t in kw_terms if t in text]
        d["match"] = {"score": len(hits), "terms": hits}


def row_to_dict(r: sqlite3.Row) -> dict:
    d = {k: r[k] for k in r.keys() if k not in ("search",)}
    try:
        d["extra"] = json.loads(d.get("extra") or "{}")
    except json.JSONDecodeError:
        d["extra"] = {}
    return d
