import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ucus

T = datetime(2026, 12, 5, 9, 30)


def s(fiyat, sure, aktarma=0):
    return ucus.Sonuc(fiyat, "TRY", sure, aktarma, [("TK", "1979", "IST", T, "LHR", T)])


def test_birlestir_fiyat_sonra_sure_fiyatsiz_sonda():
    sonuc = ucus.birlestir([s(None, 100), s(3000, 240), s(2000, 260), s(2000, 230)], 3)
    assert [(x.fiyat, x.sure_dk) for x in sonuc] == [(2000, 230), (2000, 260), (3000, 240)]


def test_yazdir(capsys):
    ucus.yazdir([s(4658, 245), s(None, 300, 1)])
    cikti = capsys.readouterr().out
    assert "1. 4.658 TRY · 4s 05dk · aktarmasız" in cikti
    assert "TK 1979: IST 05.12 09:30 → LHR 05.12 09:30" in cikti
    assert "2. fiyat yok · 5s 00dk · 1 aktarma" in cikti


def test_markdown():
    md = ucus.markdown([s(2802, 150)], "IST,SAW → AYT")
    assert md.startswith("### IST,SAW → AYT")
    assert "| 1 | **2.802 TRY** | 2s 30dk | aktarmasız | TK 1979: IST" in md
    assert "bulunamadı" in ucus.markdown([], "x")


def test_bos(capsys):
    ucus.yazdir([])
    assert "bulunamadı" in capsys.readouterr().out
