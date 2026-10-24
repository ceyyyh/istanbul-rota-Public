import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ucus


def s(kalkis, fiyat, sure):
    t = datetime(2026, 12, 5, 9, 30)
    return ucus.Sonuc(kalkis, fiyat, sure, 0, [("TK", "1979", kalkis, t, "LHR", t)])


def test_birlestir_fiyat_sonra_sure():
    sonuc = ucus.birlestir([s("IST", 300, 240), s("SAW", 200, 260), s("IST", 200, 230)], 2)
    assert [(x.kalkis, x.fiyat, x.sure_dk) for x in sonuc] == [("IST", 200, 230), ("SAW", 200, 260)]


def test_yazdir(capsys):
    ucus.yazdir([s("SAW", 199, 245)], "USD")
    cikti = capsys.readouterr().out
    assert "199 USD · 4s 05dk · aktarmasız · SAW çıkış" in cikti
    assert "TK 1979: SAW 05.12 09:30" in cikti


def test_bos(capsys):
    ucus.yazdir([], "USD")
    assert "bulunamadı" in capsys.readouterr().out
