"""Kaynakların paylaştığı HTTP istemcisi: yeniden deneme, alan adı başına hız sınırı,
tarayıcı benzeri başlıklar ve isteğe bağlı disk önbelleği."""
from __future__ import annotations

import hashlib
import json
import logging
import pathlib
import random
import threading
import time
from urllib.parse import urlparse

import requests

log = logging.getLogger(__name__)

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0",
]


class HttpError(Exception):
    def __init__(self, url: str, status: int | None, msg: str = ""):
        super().__init__(f"{status} {url} {msg}".strip())
        self.url, self.status = url, status


class Http:
    def __init__(self, min_interval: float = 1.0, timeout: float = 25, retries: int = 3,
                 cache_dir: str | None = None, cache_ttl: float = 0):
        self.min_interval = min_interval
        self.timeout = timeout
        self.retries = retries
        self.cache_dir = pathlib.Path(cache_dir) if cache_dir else None
        self.cache_ttl = cache_ttl
        self._local = threading.local()
        self._last: dict[str, float] = {}
        self._lock = threading.Lock()
        self.request_count = 0

    # Her iş parçacığına ayrı Session (requests.Session thread-safe değil)
    @property
    def session(self) -> requests.Session:
        s = getattr(self._local, "s", None)
        if s is None:
            s = requests.Session()
            s.headers.update({
                "User-Agent": random.choice(USER_AGENTS),
                "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
                "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
            })
            self._local.s = s
        return s

    def _throttle(self, url: str) -> None:
        host = urlparse(url).netloc
        while True:
            with self._lock:
                now = time.monotonic()
                wait = self._last.get(host, 0) + self.min_interval - now
                if wait <= 0:
                    self._last[host] = now
                    return
            time.sleep(wait)

    def _cache_path(self, key: str) -> pathlib.Path | None:
        if not self.cache_dir or self.cache_ttl <= 0:
            return None
        return self.cache_dir / (hashlib.sha1(key.encode()).hexdigest() + ".cache")

    def request(self, method: str, url: str, **kw) -> requests.Response:
        kw.setdefault("timeout", self.timeout)
        kw.pop("no_browser", None)
        retries = max(1, int(kw.pop("retries", self.retries)))
        last_exc: Exception | None = None
        for attempt in range(retries):
            self._throttle(url)
            try:
                self.request_count += 1
                r = self.session.request(method, url, **kw)
            except requests.RequestException as e:
                last_exc = e
                if attempt < retries - 1:
                    time.sleep(1.5 * (attempt + 1))
                continue
            if r.status_code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                retry_after = r.headers.get("Retry-After", "")
                # Retry-After saatlerce olabilir; kaynak süre sınırını aşmamak için üst sınır koy
                time.sleep(min(float(retry_after), 60.0) if retry_after.isdigit() else 2.0 * (attempt + 1))
                continue
            if r.status_code >= 400:
                raise HttpError(url, r.status_code)
            return r
        raise HttpError(url, None, repr(last_exc))

    def text(self, url: str, method: str = "GET", **kw) -> str:
        key = f"{method} {url} {json.dumps(kw.get('params'), sort_keys=True)} {kw.get('data') or kw.get('json')}"
        cp = self._cache_path(key)
        if cp and cp.exists() and time.time() - cp.stat().st_mtime < self.cache_ttl:
            return cp.read_text(encoding="utf-8")
        r = self.request(method, url, **kw)
        if not r.encoding or r.encoding.lower() == "iso-8859-1":
            # Başlıkta charset yok: Türk sitelerinin neredeyse tamamı UTF-8; önce onu dene
            # (apparent_encoding büyük sayfalarda yavaş ve kısa metinlerde yanılabiliyor).
            try:
                r.content.decode("utf-8")
                r.encoding = "utf-8"
            except UnicodeDecodeError:
                r.encoding = r.apparent_encoding or "utf-8"
        txt = r.text
        if cp:
            cp.parent.mkdir(parents=True, exist_ok=True)
            cp.write_text(txt, encoding="utf-8")
        return txt

    def get(self, url: str, **kw) -> str:
        return self.text(url, "GET", **kw)

    def get_json(self, url: str, **kw):
        kw.setdefault("headers", {}).setdefault("Accept", "application/json")
        return json.loads(self.text(url, "GET", **kw))

    def post_json(self, url: str, payload=None, **kw):
        kw.setdefault("headers", {}).setdefault("Accept", "application/json")
        return json.loads(self.text(url, "POST", json=payload, **kw))
