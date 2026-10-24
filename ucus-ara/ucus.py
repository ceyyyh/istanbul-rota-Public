"""İstanbul çıkışlı uçuş arama: IST ve SAW tek aramada birlikte sorgulanır, fiyata göre sıralanır.

Kullanım:
    python ucus.py LHR 2026-12-05
    python ucus.py LHR 2026-12-05 --donus 2026-12-12
    python ucus.py AYT 2026-12-05 --kalkis SAW --aktarmasiz --ilk 5
    python ucus.py JFK 2026-12-05 --sinif BUSINESS --para EUR --md   # Markdown tablo
"""

import argparse
import sys
from dataclasses import dataclass

ISTANBUL = "IST,SAW"
SINIFLAR = ("ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST")


@dataclass
class Sonuc:
    fiyat: float | None
    para: str
    sure_dk: int
    aktarma: int
    bacaklar: list  # [(havayolu, sefer, nereden, ne zaman, nereye, ne zaman)]


def birlestir(sonuclar, ilk):
    """Fiyata, eşitlikte süreye göre sıralar; fiyatı bilinmeyenler sona kalır."""
    return sorted(sonuclar, key=lambda s: (s.fiyat is None, s.fiyat or 0, s.sure_dk))[:ilk]


def sure_yaz(dk):
    return f"{dk // 60}s {dk % 60:02d}dk"


def fiyat_yaz(s):
    return "fiyat yok" if s.fiyat is None else f"{s.fiyat:,.0f} {s.para}".replace(",", ".")


def aktarma_yaz(n):
    return "aktarmasız" if n == 0 else f"{n} aktarma"


def bacak_yaz(b):
    havayolu, sefer, nereden, kalkis, nereye, varis = b
    return f"{havayolu} {sefer}: {nereden} {kalkis:%d.%m %H:%M} → {nereye} {varis:%d.%m %H:%M}"


def yazdir(sonuclar):
    if not sonuclar:
        print("Uçuş bulunamadı.")
        return
    for i, s in enumerate(sonuclar, 1):
        print(f"{i}. {fiyat_yaz(s)} · {sure_yaz(s.sure_dk)} · {aktarma_yaz(s.aktarma)}")
        for b in s.bacaklar:
            print(f"     {bacak_yaz(b)}")


def markdown(sonuclar, baslik):
    """GitHub iş özeti için telefonda rahat okunan Markdown tablo."""
    satirlar = [f"### {baslik}", ""]
    if not sonuclar:
        return "\n".join(satirlar + ["Uçuş bulunamadı."])
    satirlar += ["| # | Fiyat | Süre | Aktarma | Uçuşlar |", "|---|---|---|---|---|"]
    for i, s in enumerate(sonuclar, 1):
        ucuslar = "<br>".join(bacak_yaz(b) for b in s.bacaklar)
        satirlar.append(f"| {i} | **{fiyat_yaz(s)}** | {sure_yaz(s.sure_dk)} | {aktarma_yaz(s.aktarma)} | {ucuslar} |")
    return "\n".join(satirlar)


def _bacaklar(ucus):
    return [
        (b.airline.name.lstrip("_"), b.flight_number, b.departure_airport.name, b.departure_datetime,
         b.arrival_airport.name, b.arrival_datetime)
        for b in ucus.legs
    ]


def ara(kalkis, varis, tarih, donus=None, sinif="ECONOMY", aktarma="ANY", yolcu=1, para="TRY", ilk=10):
    """fli ile arama yapar. kalkis/varis virgülle birden çok havalimanı olabilir (ör. "IST,SAW")."""
    from fli.core import build_flight_segments, parse_cabin_class, parse_max_stops, resolve_airport
    from fli.models import FlightSearchFilters, PassengerInfo, SortBy
    from fli.search import SearchFlights

    kodlar = lambda metin: [resolve_airport(k.strip()) for k in metin.split(",") if k.strip()]
    bolumler, yolculuk = build_flight_segments(kodlar(kalkis), kodlar(varis), tarih, donus)
    filtre = FlightSearchFilters(
        trip_type=yolculuk,
        passenger_info=PassengerInfo(adults=yolcu),
        flight_segments=bolumler,
        seat_type=parse_cabin_class(sinif),
        stops=parse_max_stops(aktarma),
        sort_by=SortBy.CHEAPEST,
    )
    # Gidiş-dönüşte her gidiş seçeneği için ayrı istek atılır; Google'ın 429 sınırına takılmamak için az tut.
    genislet = min(ilk, 5) if donus else ilk
    ucuslar = SearchFlights().search(filtre, top_n=genislet, currency=para) or []
    sonuclar = []
    for u in ucuslar:
        # Gidiş-dönüşte (gidiş, dönüş) çifti gelir; toplam fiyat gidiş kaydındadır.
        gidis, *donusler = u if isinstance(u, tuple) else (u,)
        sonuclar.append(Sonuc(
            fiyat=gidis.price,
            para=gidis.currency or para,
            sure_dk=gidis.duration + sum(d.duration for d in donusler),
            aktarma=max([gidis.stops] + [d.stops for d in donusler]),
            bacaklar=_bacaklar(gidis) + [b for d in donusler for b in _bacaklar(d)],
        ))
    return sonuclar


def main(argv=None):
    p = argparse.ArgumentParser(description="İstanbul (IST + SAW) çıkışlı uçuş arama")
    p.add_argument("varis", help="Varış havalimanı kodu, ör. LHR (virgülle birden çok: LHR,LGW)")
    p.add_argument("tarih", help="Gidiş tarihi, YYYY-AA-GG")
    p.add_argument("--donus", help="Dönüş tarihi, YYYY-AA-GG (verilirse gidiş-dönüş aranır)")
    p.add_argument("--kalkis", default=ISTANBUL, help="Kalkış kodları (varsayılan IST,SAW)")
    p.add_argument("--sinif", default="ECONOMY", choices=SINIFLAR)
    p.add_argument("--aktarmasiz", action="store_true", help="Sadece direkt uçuşlar")
    p.add_argument("--yolcu", type=int, default=1)
    p.add_argument("--para", default="TRY", help="Para birimi (TRY, EUR, USD...)")
    p.add_argument("--ilk", type=int, default=10, help="Gösterilecek sonuç sayısı")
    p.add_argument("--md", action="store_true", help="Markdown tablo olarak yaz")
    a = p.parse_args(argv)

    try:
        sonuclar = ara(a.kalkis.upper(), a.varis.upper(), a.tarih, a.donus, a.sinif,
                       "NON_STOP" if a.aktarmasiz else "ANY", a.yolcu, a.para.upper(), a.ilk)
    except Exception as e:  # geçersiz kod/tarih ya da Google Flights hatası
        print(f"Arama başarısız: {e}", file=sys.stderr)
        return 1
    sonuclar = birlestir(sonuclar, a.ilk)
    if a.md:
        yon = f"{a.tarih} → {a.donus}" if a.donus else a.tarih
        print(markdown(sonuclar, f"{a.kalkis.upper()} → {a.varis.upper()} · {yon}"))
    else:
        yazdir(sonuclar)
    return 0


if __name__ == "__main__":
    sys.exit(main())
