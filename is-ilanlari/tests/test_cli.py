import json

from isilan.__main__ import main
from isilan.db import DB
from isilan.models import AGENCY, PLATFORM, Job
from isilan.pipeline import crawl
from isilan.sources.base import Source


def _seed(path):
    jobs = [Job(source="t", source_type=PLATFORM, external_id="1", title="Kasiyer", company="Market",
                url="https://t/1", location="Kadıköy, İstanbul"),
            Job(source="a", source_type=AGENCY, external_id="2", title="Depo </script> Elemanı", company="Lojistik",
                url="https://a/2", location="Esenyurt", extra={"agency": "Örnek İK", "secret": "x"})]
    crawl(DB(path), [Source(name="t", source_type=PLATFORM, label="T", fetcher=lambda s, c: iter(jobs[:1])),
                     Source(name="a", source_type=AGENCY, label="A", fetcher=lambda s, c: iter(jobs[1:]))])


def test_build_site_export_list(tmp_path, capsys):
    db = str(tmp_path / "c.db")
    _seed(db)
    out = tmp_path / "site.html"
    main(["--db", db, "build-site", "--out", str(out)])
    html = out.read_text(encoding="utf-8")
    assert "window.__ISILAN_DATA__=" in html and "/*__ISILAN_DATA__*/" not in html
    blob = html.split("window.__ISILAN_DATA__=", 1)[1].split(";</script>", 1)[0]
    assert "</script>" not in blob                       # gömülü veri script etiketini kapatamaz
    data = json.loads(blob)
    assert {j["title"] for j in data["jobs"]} == {"Kasiyer", "Depo </script> Elemanı"}
    agency_job = [j for j in data["jobs"] if j["source"] == "a"][0]
    assert agency_job["extra"] == {"agency": "Örnek İK"}

    csv_out = tmp_path / "k.csv"
    main(["--db", db, "export", "--ilce", "kadikoy", "--out", str(csv_out)])
    rows = csv_out.read_text(encoding="utf-8-sig").splitlines()
    assert len(rows) == 2 and "Kadıköy" in rows[1]

    main(["--db", db, "list", "--yaka", "avrupa"])
    assert "Esenyurt" in capsys.readouterr().out
