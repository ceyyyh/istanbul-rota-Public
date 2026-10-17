"""İsteğe bağlı Playwright desteği.

`--browser` ile çalıştırıldığında, düz HTTP isteği engellenen (403/Cloudflare vb.)
sayfalar gerçek bir başsız Chromium ile yeniden denenir. Kaynak kodunun bundan
haberi olmasına gerek yoktur: aynı `get/get_json` arayüzü kullanılır.

Kurulum:  pip install playwright && python -m playwright install chromium
"""
from __future__ import annotations

import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor

from .http import Http, HttpError, USER_AGENTS

log = logging.getLogger(__name__)

_BLOCK_MARKERS = ("cf-chl", "just a moment", "attention required", "captcha", "access denied", "px-captcha")


def looks_blocked(text: str) -> bool:
    head = (text or "")[:5000].lower()
    return any(m in head for m in _BLOCK_MARKERS)


class BrowserHttp(Http):
    """Http + Playwright yedeği. Playwright senkron API'si iş parçacığına bağlı olduğundan
    tüm tarayıcı işleri tek bir özel iş parçacığında yürütülür."""

    def __init__(self, *a, headless: bool = True, **kw):
        super().__init__(*a, **kw)
        self.headless = headless
        self._exec = ThreadPoolExecutor(max_workers=1, thread_name_prefix="browser")
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
            self._browser = self._pw.chromium.launch(headless=self.headless)
            self._ctx = self._browser.new_context(locale="tr-TR", user_agent=USER_AGENTS[0])

    def _render(self, url: str, want_json: bool) -> str:
        self._ensure()
        page = self._ctx.new_page()
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=45000)
            for _ in range(10):  # Cloudflare/benzeri ara sayfaların geçmesini bekle
                html = page.content()
                if not looks_blocked(html):
                    break
                time.sleep(1.5)
            try:
                page.wait_for_load_state("networkidle", timeout=8000)
            except Exception:  # noqa: BLE001
                pass
            self.browser_count += 1
            return page.evaluate("document.body.innerText") if want_json else page.content()
        finally:
            page.close()

    def browser_get(self, url: str, want_json: bool = False) -> str:
        return self._exec.submit(self._render, url, want_json).result()

    def text(self, url: str, method: str = "GET", **kw) -> str:
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
        def _close():
            for obj in (self._ctx, self._browser):
                try:
                    obj and obj.close()
                except Exception:  # noqa: BLE001
                    pass
            if self._pw:
                self._pw.stop()
        self._exec.submit(_close).result()
        self._exec.shutdown()
