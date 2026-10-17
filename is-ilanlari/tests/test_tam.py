import zipfile

from isilan import tam
from isilan.models import AGENCY, COMPANY, PLATFORM, Job
from isilan.sources.base import Source


def _job(i, loc="Kadıköy, İstanbul"):
    return Job(source="x", source_type=PLATFORM, external_id=str(i), title=f"İlan {i}", company="F",
               url=f"https://x.test/{i}", location=loc)


def test_tam_runs_all_steps(tmp_path, monkeypatch):
    def good(s, ctx):
        yield from (_job(i) for i in range(3))

    def changed(s, ctx):  # sayfa geliyor ama ilan çıkmıyor (yapı değişmiş)
        ctx.http.get("https://x.test/liste")
        yield from ()

    srcs = [Source(name="iyi", source_type=PLATFORM, label="İyi", fetcher=good),
            Source(name="agency:degisti", source_type=AGENCY, label="Değişti", fetcher=changed),
            Source(name="korumali", source_type=PLATFORM, label="Korumalı", fetcher=good, needs_browser=True),
            Source(name="lever:firma", source_type=COMPANY, label="Firma", fetcher=good)]
    monkeypatch.setattr(tam, "all_sources", lambda: srcs)
    monkeypatch.setattr(tam, "playwright_ready", lambda: False)

    class FakeHttp:
        def __init__(self, *a, **k):
            pass

        def text(self, url, method="GET", **kw):
            return "<html><body>yeni tasarım</body></html>"

        def get(self, url, **kw):
            return self.text(url)

    monkeypatch.setattr(tam, "Http", FakeHttp)
    import isilan.teshis as teshis_mod
    monkeypatch.setattr(teshis_mod, "looks_blocked", lambda t: False)

    lines = []
    r = tam.run(str(tmp_path / "t.db"), tmp_path, workers=1, say=lines.append)
    assert r["status"] == {"iyi": "ok", "agency:degisti": "ayristirilamadi", "korumali": "engelli"}
    assert "korumali" not in r["results"]                 # Playwright yok → atlandı
    assert r["results"]["lever:firma"]["kept"] == 3       # şirketler teşhissiz derin taranır
    assert r["total"] == 3                                # aynı ilanlar tekilleşti
    assert "agency:degisti" in r["bad"]
    names = zipfile.ZipFile(r["zip"]).namelist()
    assert any(n.startswith("agency_degisti/") for n in names)
    assert any("Playwright kurulu değil" in l for l in lines)
