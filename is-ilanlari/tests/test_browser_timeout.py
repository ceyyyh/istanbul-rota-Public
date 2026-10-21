"""Tarayıcı yedeğinin takılma koruması: iş başına sert süre sınırı, devre dışı kalma, hızlı kapanış.

Gerçek Playwright başlatılmaz: `_render` bir Event bekleyen sahteyle değiştirilir; `_ensure/_render/_release`
akışı için de sahte bir `playwright.sync_api` kullanılır."""
from __future__ import annotations

import logging
import sys
import threading
import time
import types

import pytest

from isilan.browser import BrowserHttp
from isilan.http import Http, HttpError

URL = "https://x.test/ilan"
TIMEOUT = 0.4  # testler hızlı kalsın diye kısa sert süre sınırı


class Harness:
    """BrowserHttp'leri ve takılı sahteleri izler; test bitince hepsini serbest bırakıp kapatır (iş parçacığı sızmaz)."""

    def __init__(self):
        self.https, self.gates = [], []

    def http(self, **kw) -> BrowserHttp:
        kw.setdefault("min_interval", 0)
        kw.setdefault("browser_timeout", TIMEOUT)
        kw.setdefault("close_timeout", TIMEOUT)
        h = BrowserHttp(**kw)
        self.https.append(h)
        return h

    def gate(self) -> threading.Event:
        g = threading.Event()
        self.gates.append(g)
        return g

    def hang(self, h: BrowserHttp):
        """`h._render` yerine, `release` kurulana dek bekleyen (yanıt vermeyen sayfa) bir sahte koyar."""
        release = self.gate()

        def render(url, want_json):
            render.calls.append(url)
            release.wait(30)  # test başarısız olsa bile iş parçacığı sonsuza dek kalmasın
            return "<html>geç geldi</html>"

        render.calls, render.release = [], release
        h._render = render
        return render

    def cleanup(self):
        for g in self.gates:
            g.set()
        for h in self.https:
            h.close()
            if h._thread:
                h._thread.join(5)
                assert not h._thread.is_alive(), "tarayıcı iş parçacığı sızdı"


@pytest.fixture
def harness():
    hn = Harness()
    yield hn
    hn.cleanup()


def _call_in_threads(h, n, results):
    """n iş parçacığından aynı anda browser_get çağırır; sonuç ya da hata `results`a eklenir."""
    lock = threading.Lock()

    def call(i):
        try:
            r = h.browser_get(f"{URL}/{i}")
        except Exception as e:  # noqa: BLE001
            r = e
        with lock:
            results.append(r)

    threads = [threading.Thread(target=call, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)


# --- _render sahteyle: süre sınırı, devre dışı kalma, kapanış ------------------------------------------------------

def test_render_result_is_returned_from_one_daemon_thread(harness):
    h = harness.http()
    seen = []

    def render(url, want_json):
        seen.append((threading.current_thread(), url, want_json))
        return "<html>tamam</html>"

    h._render = render
    assert h.browser_get(URL) == "<html>tamam</html>"
    assert h.browser_get(URL + "/2", want_json=True) == "<html>tamam</html>"
    (t1, _, _), (t2, url2, json2) = seen
    assert t1 is t2                                    # Playwright senkron API'si için hep aynı iş parçacığı
    assert t1.daemon and t1 is not threading.current_thread()
    assert (url2, json2) == (URL + "/2", True)
    assert not h.browser_disabled


def test_hung_render_raises_http_error_after_timeout(harness, caplog):
    h = harness.http()
    hang = harness.hang(h)
    t0 = time.monotonic()
    with caplog.at_level(logging.WARNING, logger="isilan.browser"):
        with pytest.raises(HttpError) as ei:
            h.browser_get(URL)
    took = time.monotonic() - t0
    assert TIMEOUT * 0.75 <= took < 5                  # süre dolana dek bekler, sonsuza dek değil
    assert ei.value.status is None and ei.value.url == URL
    assert h.browser_disabled
    assert any(URL in r.getMessage() for r in caplog.records if r.levelno == logging.WARNING)
    assert hang.calls == [URL]


def test_calls_after_timeout_fail_immediately(harness):
    h = harness.http()
    hang = harness.hang(h)
    with pytest.raises(HttpError):
        h.browser_get(URL)
    t0 = time.monotonic()
    for i in range(3):
        with pytest.raises(HttpError) as ei:
            h.browser_get(f"{URL}/baska{i}")
        assert ei.value.status is None
    assert time.monotonic() - t0 < TIMEOUT / 2         # her biri için yeniden süre beklenmez
    assert hang.calls == [URL]                         # tarayıcıya yeni iş gitmedi


def test_close_returns_quickly_even_if_worker_is_stuck(harness, caplog):
    h = harness.http()
    hang = harness.hang(h)
    with pytest.raises(HttpError):
        h.browser_get(URL)
    t0 = time.monotonic()
    with caplog.at_level(logging.WARNING, logger="isilan.browser"):
        h.close()
    assert time.monotonic() - t0 < 3                   # close_timeout kadar bekleyip bırakır
    assert "bırakılıyor" in caplog.text
    assert h._thread.is_alive()                        # takılı iş parçacığı bırakıldı (daemon: süreç çıkışını kilitlemez)
    hang.release.set()                                 # sayfa sonunda yanıt verirse iş parçacığı temiz çıkar
    h._thread.join(5)
    assert not h._thread.is_alive()


def test_close_without_browser_use_is_instant_and_blocks_later_calls(harness):
    h = harness.http()
    t0 = time.monotonic()
    h.close()
    assert time.monotonic() - t0 < TIMEOUT / 2
    assert h._thread is None                           # tarayıcıya hiç düşülmediyse iş parçacığı da açılmaz
    h._render = lambda *a: pytest.fail("kapalı tarayıcıda render çalışmamalı")
    with pytest.raises(HttpError):
        h.browser_get(URL)
    h.close()                                          # ikinci kapatma zararsız


def test_waiting_callers_are_released_as_soon_as_one_job_hangs(harness):
    h = harness.http(browser_timeout=0.5)
    hang = harness.hang(h)
    results = []
    t0 = time.monotonic()
    _call_in_threads(h, 4, results)
    took = time.monotonic() - t0
    assert [type(r) for r in results] == [HttpError] * 4
    assert took < 1.5                                  # 4 × 0.5 sn değil: biri takılınca sıradakiler beklemeden düşer
    assert len(hang.calls) == 1


def test_slow_but_healthy_jobs_do_not_trip_the_timeout(harness):
    h = harness.http(browser_timeout=0.6)

    def render(url, want_json):
        time.sleep(0.25)
        return url

    h._render = render
    results = []
    _call_in_threads(h, 4, results)                    # toplam ~1 sn > 0.6 sn: sırada beklemek süreye sayılmaz
    assert sorted(results) == sorted(f"{URL}/{i}" for i in range(4))
    assert not h.browser_disabled


def test_render_errors_pass_through_and_keep_browser_enabled(harness):
    h = harness.http()
    calls = []

    def render(url, want_json):
        calls.append(url)
        if len(calls) == 1:
            raise ValueError("sayfa açılamadı")
        return "ok"

    h._render = render
    with pytest.raises(ValueError, match="sayfa açılamadı"):
        h.browser_get(URL)
    assert not h.browser_disabled
    assert h.browser_get(URL) == "ok"


def test_timeout_error_from_render_is_not_mistaken_for_hard_timeout(harness):
    h = harness.http()

    def render(url, want_json):
        raise TimeoutError("soket zaman aşımı")        # 3.11+'da concurrent.futures.TimeoutError ile aynı sınıf

    h._render = render
    with pytest.raises(TimeoutError):                  # HttpError değil: işin kendi hatası olduğu gibi gelir
        h.browser_get(URL)
    assert not h.browser_disabled


def test_text_fallback_gives_up_after_timeout_but_plain_http_keeps_working(harness, monkeypatch):
    mode = {"blocked": True}

    def plain(self, url, method="GET", **kw):
        kw.pop("no_browser", None)
        if mode["blocked"]:
            raise HttpError(url, 403)
        return "<html>düz yanıt</html>"

    monkeypatch.setattr(Http, "text", plain)
    h = harness.http()
    hang = harness.hang(h)
    with pytest.raises(HttpError) as ei:
        h.get(URL)                                     # 403 → tarayıcıyla denenir → takılır → zaman aşımı
    assert ei.value.status is None
    with pytest.raises(HttpError):
        h.get(URL + "/2")                              # tarayıcı devre dışı: yedek denemesi beklemeden hata verir
    assert hang.calls == [URL]
    mode["blocked"] = False
    assert h.get(URL + "/3") == "<html>düz yanıt</html>"   # engellenmeyen sayfalar düz HTTP ile gelmeye devam eder


def test_default_timeouts():
    assert BrowserHttp(min_interval=0).browser_timeout == 90
    assert BrowserHttp(min_interval=0, headless=False).browser_timeout > 90   # elle doğrulama için daha geniş
    assert BrowserHttp(min_interval=0, browser_timeout=5).browser_timeout == 5


# --- Sahte playwright.sync_api ile: _ensure / _render / _release akışı ------------------------------------------------

def fake_playwright(monkeypatch):
    """`playwright.sync_api` yerine geçer; çağrıları (ad, iş parçacığı) olarak ve ayarlanan zaman aşımını kaydeder."""
    rec = types.SimpleNamespace(calls=[], default_timeout=None, content=lambda: "<html><body>içerik</body></html>")

    def hit(name):
        rec.calls.append((name, threading.current_thread()))

    class Page:
        def goto(self, url, **kw):
            hit("goto")

        def content(self):
            hit("content")
            return rec.content()

        def wait_for_load_state(self, *a, **kw):
            hit("wait_for_load_state")

        def evaluate(self, expr):
            hit("evaluate")
            return "gövde metni"

        def close(self):
            hit("page.close")

    class Ctx:
        def set_default_timeout(self, ms):
            hit("set_default_timeout")
            rec.default_timeout = ms

        def new_page(self):
            hit("new_page")
            return Page()

        def close(self):
            hit("ctx.close")

    class Browser:
        def new_context(self, **kw):
            hit("new_context")
            return Ctx()

        def close(self):
            hit("browser.close")

    class Chromium:
        def launch(self, **kw):
            hit("launch")
            return Browser()

        def launch_persistent_context(self, profile, **kw):
            hit("launch_persistent_context")
            return Ctx()

    class Playwright:
        chromium = Chromium()

        def stop(self):
            hit("pw.stop")

    class Manager:
        def start(self):
            hit("start")
            return Playwright()

    pkg = types.ModuleType("playwright")
    pkg.__path__ = []
    api = types.ModuleType("playwright.sync_api")
    api.sync_playwright = Manager
    monkeypatch.setitem(sys.modules, "playwright", pkg)
    monkeypatch.setitem(sys.modules, "playwright.sync_api", api)
    rec.names = lambda: [n for n, _ in rec.calls]
    return rec


@pytest.mark.parametrize("profile", [False, True])
def test_context_gets_default_page_timeout(harness, monkeypatch, tmp_path, profile):
    pw = fake_playwright(monkeypatch)
    h = harness.http(profile_dir=str(tmp_path / "profil") if profile else None)
    assert "<body>içerik</body>" in h.browser_get(URL)
    assert pw.default_timeout == 30000                 # bağlamdaki tüm sayfalar için ~30 sn
    assert ("launch_persistent_context" in pw.names()) == profile


def test_close_shuts_browser_down_on_the_worker_thread(harness, monkeypatch):
    pw = fake_playwright(monkeypatch)
    h = harness.http(close_timeout=5)
    assert h.browser_get(URL, want_json=True) == "gövde metni"
    t0 = time.monotonic()
    h.close()
    assert time.monotonic() - t0 < 2
    assert pw.names()[-3:] == ["ctx.close", "browser.close", "pw.stop"]
    assert {t for _, t in pw.calls} == {h._thread}     # tüm Playwright çağrıları tek (özel) iş parçacığında
    h._thread.join(5)
    assert not h._thread.is_alive()


def test_page_stuck_in_content_is_cut_off(harness, monkeypatch):
    """Gerçek olay: sayfa content() aşamasında takıldı; browser_get süre sonunda bırakır, close() takılmaz."""
    pw = fake_playwright(monkeypatch)
    gate = harness.gate()

    def content():
        gate.wait(30)
        return "<html>geç geldi</html>"

    pw.content = content
    h = harness.http(browser_timeout=0.5)
    t0 = time.monotonic()
    with pytest.raises(HttpError) as ei:
        h.browser_get(URL)
    assert ei.value.status is None and time.monotonic() - t0 < 5
    t0 = time.monotonic()
    h.close()
    assert time.monotonic() - t0 < 3
    assert h._thread.is_alive() and "pw.stop" not in pw.names()   # iş parçacığı hâlâ takılı
    gate.set()                                         # sayfa sonunda yanıt verirse tarayıcı yine de temizce kapanır
    h._thread.join(5)
    assert not h._thread.is_alive() and "pw.stop" in pw.names()
