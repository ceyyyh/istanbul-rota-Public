"""İstanbul çıkışlı uçuş arama: IST ve SAW'dan aynı anda arar, fiyata göre birleştirir.

Kullanım:
    python ucus.py LHR 2026-12-05
    python ucus.py AYT 2026-12-05 --kalkis IST --aktarmasiz --ilk 5
    python ucus.py LHR 2026-12-05 --kalkis "IST,SAW" --sinif BUSINESS
"""

import argparse
import sys
from dataclasses import dataclass

ISTANBUL = ("IST", "SAW")
SINIFLAR = ("ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST")


@dataclass
class Sonuc:
    kalkis: str
    fiyat: float
    sure_dk: int
    aktarma: int
    bacaklar: list  # [(havayolu, sefer, nereden, ne zaman, nereye, ne zaman)]


def birlestir(sonuclar, ilk):
    """Tüm havalimanlarından gelen sonuçları fiyata, eşitlikte süreye göre sıralar."""
    return sorted(sonuclar, key=lambda s: (s.fiyat, s.sure_dk))[:ilk]


def sure_yaz(dk):
    return f"{dk // 60}s {dk % 60:02d}dk"


def yazdir(sonuclar, para):
    if not sonuclar:
        print("Uçuş bulunamadı.")
        return
    for i, s in enumerate(sonuclar, 1):
        aktarma = "aktarmasız" if s.aktarma == 0 else f"{s.aktarma} aktarma"
        print(f"{i}. {s.fiyat:.0f} {para} · {sure_yaz(s.sure_dk)} · {aktarma} · {s.kalkis} çıkış")
        for havayolu, sefer, nereden, kalkis, nereye, varis in s.bacaklar:
            print(f"     {havayolu} {sefer}: {nereden} {kalkis:%d.%m %H:%M} → {nereye} {varis:%d.%m %H:%M}")


def ara(kalkis, varis, tarih, sinif, aktarmasiz, yolcu):
    """fli kütüphanesiyle tek havalimanından tek yön arama yapar."""
    from fli.models import (
        Airport, FlightSearchFilters, FlightSegment, MaxStops, PassengerInfo, SeatType, SortBy,
    )
    from fli.search import SearchFlights

    filtre = FlightSearchFilters(
        passenger_info=PassengerInfo(adults=yolcu),
        flight_segments=[
            FlightSegment(
                departure_airport=[[Airport[kalkis], 0]],
                arrival_airport=[[Airport[varis], 0]],
                travel_date=tarih,
            )
        ],
        seat_type=SeatType[sinif],
        stops=MaxStops.NON_STOP if aktarmasiz else MaxStops.ANY,
        sort_by=SortBy.CHEAPEST,
    )
    ucuslar = SearchFlights().search(filtre) or []
    return [
        Sonuc(
            kalkis=kalkis,
            fiyat=u.price,
            sure_dk=u.duration,
            aktarma=u.stops,
            bacaklar=[
                (b.airline.value, b.flight_number, b.departure_airport.name, b.departure_datetime,
                 b.arrival_airport.name, b.arrival_datetime)
                for b in u.legs
            ],
        )
        for u in ucuslar
    ]


def main(argv=None):
    p = argparse.ArgumentParser(description="İstanbul (IST + SAW) çıkışlı uçuş arama")
    p.add_argument("varis", help="Varış havalimanı kodu, ör. LHR")
    p.add_argument("tarih", help="Gidiş tarihi, YYYY-AA-GG")
    p.add_argument("--kalkis", default=",".join(ISTANBUL), help="Virgülle kalkış kodları (varsayılan IST,SAW)")
    p.add_argument("--sinif", default="ECONOMY", choices=SINIFLAR)
    p.add_argument("--aktarmasiz", action="store_true", help="Sadece direkt uçuşlar")
    p.add_argument("--yolcu", type=int, default=1)
    p.add_argument("--ilk", type=int, default=10, help="Gösterilecek sonuç sayısı")
    a = p.parse_args(argv)

    varis = a.varis.upper()
    tum = []
    for kod in [k.strip().upper() for k in a.kalkis.split(",") if k.strip()]:
        try:
            tum += ara(kod, varis, a.tarih, a.sinif, a.aktarmasiz, a.yolcu)
        except KeyError as e:
            print(f"Bilinmeyen havalimanı kodu: {e}", file=sys.stderr)
            return 2
        except Exception as e:  # ağ / Google Flights hatası: diğer havalimanıyla devam et
            print(f"{kod} araması başarısız: {e}", file=sys.stderr)
    yazdir(birlestir(tum, a.ilk), "USD")
    return 0


if __name__ == "__main__":
    sys.exit(main())
