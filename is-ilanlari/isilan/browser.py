"""İsteğe bağlı Playwright desteği.

`--browser` ile çalıştırıldığında, düz HTTP isteği engellenen (403/Cloudflare vb.)
sayfalar gerçek bir başsız Chromium ile yeniden denenir. Kaynak kodunun bundan
haberi olmasına gerek yoktur: aynı `get/get_json` arayüzü kullanılır.

Takılma koruması: tarayıcı işleri tek bir daemon iş parçacığında, her biri sert bir süre sınırıyla
yürütülür. Sayfa yanıt vermezse (page.content()/evaluate() zaman aşımı tanımaz) tarayıcı o tarama için
devre dışı bırakılır; kaynaklar bunu düz HTTP hatası (HttpError) gibi görür ve tarama sürer.

Kurulum:  pip install playwright && python -m playwright install chromium
"""
from __future__ import annotations

import json
import logging
import queue
import threading
import time
from concurrent.futures import Future, wait
from pathlib import Path

from .http import Http, HttpError, USER_AGENTS

log = logging.getLogger(__name__)

_BLOCK_MARKERS = ("cf-chl", "just a moment", "attention required", "captcha", "access denied", "px-captcha")

# Sayfa düzeyinde varsayılan zaman aşımı (ms): `timeout` alan tüm Playwright çağrıları için.
# page.content()/evaluate() zaman aşımı kabul etmez; onlara karşı asıl koruma browser_get'teki sert süre sınırıdır.
_PAGE_TIMEOUT_MS = 30000
# Tek bir tarayıcı işinin (tarayıcıyı açma + sayfa) en uzun süresi (sn). Görünür modda kullanıcıya elle doğrulama
# için ~90 sn daha tanındığından (bkz. _render) sınır orada daha geniştir.
_TIMEOUT_HEADLESS = 90
_TIMEOUT_VISIBLE = 240


def looks_blocked(text: str) -> bool:
    head = (text or "")[:5000].lower()
    return any(m in head for m in _BLOCK_MARKERS)


class BrowserHttp(Http):
    """Http + Playwright yedeği. Playwright senkron API'si iş parçacığına bağlı olduğundan
    tüm tarayıcı işleri tek bir özel iş parçacığında yürütülür (daemon: takılırsa süreç çıkışını kilitlemez).

    Her iş `browser_timeout` sn ile sınırlıdır; aşılırsa tarayıcı bu tarama için devre dışı kalır ve
    `browser_get` HttpError fırlatır. `close()` takılı bir tarayıcıyı en çok `close_timeout` sn bekler."""

    def __init__(self, *a, headless: bool = True, profile_dir: str | None = None,
                 browser_timeout: float | None = None, close_timeout: float = 20, **kw):
        super().__init__(*a, **kw)
        self.headless = headless
        # Kalıcı profil: çerezler saklanır; görünür modda bir kez elle geçilen doğrulama sonraki taramalarda da geçerli olur
        self.profile_dir = profile_dir
        self.browser_timeout = browser_timeout if browser_timeout is not None else (
            _TIMEOUT_HEADLESS if headless else _TIMEOUT_VISIBLE)
        self.close_timeout = close_timeout
        self._q: queue.Queue = queue.Queue()           # tarayıcı iş parçacığına giden işler; None: kapanış işareti
        self._thread: threading.Thread | None = None   # ilk tarayıcı isteğinde başlatılır
        self._lock = threading.Lock()                  # iş gönderme ile close() birbirini ezmesin
        self._turn = threading.Lock()                  # tek seferde tek iş: sırası gelmeyenler burada bekler
        self._stopped = threading.Event()              # tarayıcı iş parçacığı çıktı (tarayıcı kapandı)
        self.browser_disabled = False                  # takılma ya da close() sonrası: tarayıcı yedeği kapalı
        self._pw = self._browser = self._ctx = None
        self.browser_count = 0

    def _ensure(self):
        if self._ctx is None:
            try:
                from playwright.sync_api import sync_playwright
            except ImportError as e:
                raise RuntimeError("Playwright kurulu değil: pip install playwright && "
                                   "python -m playwright install chromium") from e
            self._pw = sync_playwright().start()
            if self.profile_dir:
                Path(self.profile_dir).mkdir(parents=True, exist_ok=True)
                self._ctx = self._pw.chromium.launch_persistent_context(
                    self.profile_dir, headless=self.headless, locale="tr-TR")
            else:
                self._browser = self._pw.chromium.launch(headless=self.headless)
                self._ctx = self._browser.new_context(locale="tr-TR", user_agent=USER_AGENTS[0])
            self._ctx.set_default_timeout(_PAGE_TIMEOUT_MS)

    def _render(self, url: str, want_json: bool) -> str:
        self._ensure()
        page = self._ctx.new_page()
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=45000)
            # Ara doğrulama sayfasının geçmesini bekle; görünür modda kullanıcıya elle tamamlaması için süre tanı
            waits = 10 if self.headless else 60
            for i in range(waits):
                html = page.content()
                if not looks_blocked(html):
                    break
                if i == 3 and not self.headless:
                    log.warning("Doğrulama sayfası: lütfen açılan tarayıcı penceresinde doğrulamayı tamamlayın (%s)", url)
                time.sleep(1.5)
            try:
                page.wait_for_load_state("networkidle", timeout=8000)
            except Exception:  # noqa: BLE001
                pass
            self.browser_count += 1
            return page.evaluate("document.body.innerText") if want_json else page.content()
        finally:
            page.close()

    def _loop(self):
        """Tarayıcı iş parçacığı: işleri sırayla yürütür; None gelince (close) tarayıcıyı kapatıp çıkar."""
        try:
            while True:
                item = self._q.get()
                if item is None:
                    break
                fut, url, want_json = item
                try:
                    fut.set_result(self._render(url, want_json))
                except BaseException as e:  # noqa: BLE001 — hata, bekleyen browser_get'e olduğu gibi iletilir
                    fut.set_exception(e)
        finally:
            self.browser_disabled = True  # bu iş parçacığı artık iş almaz
            self._release()
            self._stopped.set()

    def _release(self):
        """Tarayıcıyı kapatır (Playwright nesneleri yalnızca kendi iş parçacığında kapatılabilir)."""
        for obj in (self._ctx, self._browser):
            try:
                obj and obj.close()
            except Exception:  # noqa: BLE001
                pass
        if self._pw:
            try:
                self._pw.stop()
            except Exception:  # noqa: BLE001
                pass

    def _submit(self, url: str, want_json: bool) -> Future:
        with self._lock:
            if self.browser_disabled:
                raise HttpError(url, None, "tarayıcı devre dışı")
            if self._thread is None:
                th = threading.Thread(target=self._loop, name="browser", daemon=True)
                th.start()
                self._thread = th  # başlatılamazsa (RuntimeError) bir sonraki istek yeniden dener
            fut: Future = Future()
            self._q.put((fut, url, want_json))
            return fut

    def browser_get(self, url: str, want_json: bool = False) -> str:
        # Tek seferde tek iş: sıra bekleyen kaynaklar burada bekler; süre sınırı yalnızca sırası gelmiş işin
        # çalışma süresine uygulanır (sağlıklı işlerin arkasında beklemek tarayıcıyı yanlışlıkla devre dışı
        # bırakmasın). Bir iş takılırsa sıradakiler kilidi alır almaz bayrağı görüp beklemeden HttpError alır.
        with self._turn:
            fut = self._submit(url, want_json)
            done, _ = wait([fut], timeout=self.browser_timeout)
            if not done:
                self.browser_disabled = True
                log.warning("Tarayıcı %g sn içinde yanıt vermedi, bu tarama için devre dışı bırakıldı: %s",
                            self.browser_timeout, url)
                raise HttpError(url, None, f"tarayıcı zaman aşımı ({self.browser_timeout:g} sn)")
        return fut.result()  # işin kendi hatası (ör. Playwright) varsa olduğu gibi fırlatılır

    def text(self, url: str, method: str = "GET", **kw) -> str:
        if kw.pop("no_browser", False):  # hızlı yan istekler (ör. ilçe için detay sayfası): tarayıcıya düşme
            return super().text(url, method, **kw)
        try:
            txt = super().text(url, method, **kw)
        except HttpError as e:
            if method != "GET" or e.status not in (401, 403, 429, 503, None):
                raise
            log.info("Engellendi (%s), tarayıcıyla deneniyor: %s", e.status, url)
            return self._with_params(url, kw)
        if method == "GET" and looks_blocked(txt):
            log.info("Bot koruması algılandı, tarayıcıyla deneniyor: %s", url)
            return self._with_params(url, kw)
        return txt

    def _with_params(self, url: str, kw: dict) -> str:
        if kw.get("params"):
            from urllib.parse import urlencode
            url += ("&" if "?" in url else "?") + urlencode(kw["params"])
        want_json = "json" in str((kw.get("headers") or {}).get("Accept", ""))
        return self.browser_get(url, want_json=want_json)

    def get_json(self, url: str, **kw):
        kw.setdefault("headers", {}).setdefault("Accept", "application/json")
        return json.loads(self.text(url, "GET", **kw))

    def close(self):
        """Tarayıcıyı kapatır. Takılı iş parçacığını en çok `close_timeout` sn bekler, sonra (daemon olduğundan)
        kendi haline bırakır; süreç yine de çıkabilir."""
        with self._lock:
            self.browser_disabled = True
            if self._thread is None:  # tarayıcıya hiç düşülmedi: kapatılacak bir şey yok
                return
            self._q.put(None)
        if not self._stopped.wait(self.close_timeout):
            log.warning("Tarayıcı %g sn içinde kapanmadı, takılı iş parçacığı bırakılıyor", self.close_timeout)
