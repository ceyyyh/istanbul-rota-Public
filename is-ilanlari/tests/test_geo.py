"""geo: İstanbul ilçe sözlüğü ve eşleştirici testleri."""
from __future__ import annotations

import pytest

from isilan import geo
from isilan.geo import (
    ALIASES,
    DISTRICT_COORDS,
    DISTRICT_SIDE,
    DISTRICTS,
    PLACE_COORDS,
    PROVINCES,
    detect_district,
    distance_km,
    is_istanbul,
    locate,
    side_of,
)
from isilan.text import fold

# ---------------------------------------------------------------------------
# Sabit listeler
# ---------------------------------------------------------------------------

EXPECTED = [
    "Adalar", "Arnavutköy", "Ataşehir", "Avcılar", "Bağcılar", "Bahçelievler", "Bakırköy",
    "Başakşehir", "Bayrampaşa", "Beşiktaş", "Beykoz", "Beylikdüzü", "Beyoğlu", "Büyükçekmece",
    "Çatalca", "Çekmeköy", "Esenler", "Esenyurt", "Eyüpsultan", "Fatih", "Gaziosmanpaşa",
    "Güngören", "Kadıköy", "Kağıthane", "Kartal", "Küçükçekmece", "Maltepe", "Pendik",
    "Sancaktepe", "Sarıyer", "Silivri", "Sultanbeyli", "Sultangazi", "Şile", "Şişli", "Tuzla",
    "Ümraniye", "Üsküdar", "Zeytinburnu",
]


def test_districts_exact_and_sorted_turkish():
    assert DISTRICTS == EXPECTED
    assert len(DISTRICTS) == 39 and len(set(DISTRICTS)) == 39


def test_district_side_complete():
    assert set(DISTRICT_SIDE) == set(DISTRICTS)
    assert set(DISTRICT_SIDE.values()) == {"avrupa", "anadolu"}
    assert sum(1 for s in DISTRICT_SIDE.values() if s == "anadolu") == 14
    assert DISTRICT_SIDE["Kadıköy"] == "anadolu"
    assert DISTRICT_SIDE["Adalar"] == "anadolu"
    assert DISTRICT_SIDE["Beşiktaş"] == "avrupa"
    assert DISTRICT_SIDE["Şile"] == "anadolu"


def test_side_of():
    assert side_of("Üsküdar") == "anadolu"
    assert side_of("Esenyurt") == "avrupa"
    assert side_of("kadikoy") == "anadolu"  # katlanmış yazım da kabul
    assert side_of(None) is None
    assert side_of("") is None
    assert side_of("Gebze") is None


def test_provinces_81():
    assert len(PROVINCES) == 81
    assert "İstanbul" in PROVINCES


def test_alias_table_is_large_and_valid():
    assert len(ALIASES) >= 400
    assert set(ALIASES.values()) <= set(DISTRICTS)
    # her ilçenin en az bir semti var (Sultanbeyli dahil)
    assert set(ALIASES.values()) == set(DISTRICTS)
    # anahtarlar katlanmış biçimde
    assert all(k == fold(k) for k in ALIASES)


def test_every_district_detects_itself_in_all_spellings():
    for d in DISTRICTS:
        assert detect_district(d) == d
        assert detect_district(d.upper()) == d
        assert detect_district(fold(d)) == d  # ASCII
        assert detect_district(f"{d} / İSTANBUL") == d
        assert is_istanbul(d)


def test_every_alias_detects_its_district_with_istanbul():
    for alias, d in ALIASES.items():
        assert detect_district(f"{alias}, İstanbul") == d, alias


# ---------------------------------------------------------------------------
# Gerçek dünyadan konum metinleri
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("text, expected", [
    ("Maslak, Sarıyer/İstanbul", "Sarıyer"),
    ("Istanbul (Kozyatağı)", "Kadıköy"),
    ("İstanbul(Avr.) - Esenyurt", "Esenyurt"),
    ("Levent, Istanbul, Turkey", "Beşiktaş"),
    ("ISTANBUL - ATASEHIR", "Ataşehir"),
    ("Kadikoy", "Kadıköy"),
    ("İkitelli OSB", "Başakşehir"),
    ("KADIKÖY", "Kadıköy"),
    ("kağıthane", "Kağıthane"),
    ("Kagithane, Istanbul", "Kağıthane"),
    ("Umraniye", "Ümraniye"),
    ("USKUDAR / ISTANBUL", "Üsküdar"),
    ("Sisli", "Şişli"),
    ("Gayrettepe, İstanbul", "Beşiktaş"),
    ("Esentepe", "Şişli"),
    ("Mecidiyeköy / İstanbul", "Şişli"),
    ("4. Levent", "Beşiktaş"),
    ("Etiler", "Beşiktaş"),
    ("Ortaköy", "Beşiktaş"),
    ("Bostancı", "Kadıköy"),
    ("Göztepe, İstanbul", "Kadıköy"),
    ("Erenköy", "Kadıköy"),
    ("Suadiye", "Kadıköy"),
    ("Fikirtepe", "Kadıköy"),
    ("İçerenköy", "Ataşehir"),
    ("Kayışdağı", "Ataşehir"),
    ("Kavacık", "Beykoz"),
    ("Altunizade", "Üsküdar"),
    ("Acıbadem", "Üsküdar"),
    ("Halkalı", "Küçükçekmece"),
    ("Merter", "Güngören"),
    ("Yenibosna", "Bahçelievler"),
    ("Yeni Bosna, İstanbul", "Bahçelievler"),
    ("Ataköy", "Bakırköy"),
    ("Yeşilköy", "Bakırköy"),
    ("Florya", "Bakırköy"),
    ("Karaköy", "Beyoğlu"),
    ("Taksim", "Beyoğlu"),
    ("Cihangir", "Beyoğlu"),
    ("Sultanahmet", "Fatih"),
    ("Laleli", "Fatih"),
    ("Kurtköy", "Pendik"),
    ("Sabiha Gökçen Havalimanı", "Pendik"),
    ("Hadımköy", "Arnavutköy"),
    ("İstanbul Havalimanı", "Arnavutköy"),
    ("Istanbul Airport", "Arnavutköy"),
    ("Dudullu OSB", "Ümraniye"),
    ("İMES", "Ümraniye"),
    ("Şerifali", "Ümraniye"),
    ("Topkapı", "Zeytinburnu"),
    ("Topkapı Sarayı", "Fatih"),
    ("Eyüp", "Eyüpsultan"),
    ("Eyüp Sultan", "Eyüpsultan"),
    ("GOP", "Gaziosmanpaşa"),
    ("G.O.P. İstanbul", "Gaziosmanpaşa"),
    ("K.Çekmece", "Küçükçekmece"),
    ("Büyük Çekmece", "Büyükçekmece"),
    ("Tuzla Deri OSB", "Tuzla"),
    ("Anadolu Yakası OSB", "Tuzla"),
    ("Büyükada", "Adalar"),
    ("Ağva", "Şile"),
    ("Kilyos", "Sarıyer"),
    ("Bahçeşehir", "Başakşehir"),
    ("Güneşli", "Bağcılar"),
    ("Samandıra", "Sancaktepe"),
    ("Habipler", "Sultangazi"),
    ("Kıraç", "Esenyurt"),
    ("Selimpaşa", "Silivri"),
    ("Finanskent", "Ümraniye"),
    ("Kadıköy'de", "Kadıköy"),
])
def test_detect_district_examples(text, expected):
    assert detect_district(text) == expected
    assert is_istanbul(text)


# ---------------------------------------------------------------------------
# Öncelik kuralları ve tuzaklar
# ---------------------------------------------------------------------------

def test_explicit_district_beats_neighborhood():
    assert detect_district("Levent, Şişli") == "Şişli"
    assert detect_district("Kozyatağı, Ataşehir") == "Ataşehir"
    assert detect_district("Cihangir Mah., Avcılar") == "Avcılar"


def test_first_district_in_text_wins():
    assert detect_district("Kadıköy, Ataşehir") == "Kadıköy"
    assert detect_district("Ataşehir, Kadıköy") == "Ataşehir"
    assert detect_district("Maslak veya Kozyatağı ofisi") == "Sarıyer"


def test_mahalle_named_like_a_district_is_ignored():
    assert detect_district("Fatih Mah., Esenyurt") == "Esenyurt"
    assert detect_district("Esenler Mahallesi, Pendik/İstanbul") == "Pendik"
    assert detect_district("Güngören Mh. Çekmeköy") == "Çekmeköy"
    assert detect_district("Bahçelievler Mah. Bahçelievler") == "Bahçelievler"
    assert detect_district("Eyüp Sultan Mah., Sancaktepe") == "Sancaktepe"
    assert detect_district("Fatih Mah.") is None


def test_street_named_like_a_district_is_last_resort():
    assert detect_district("Ataşehir Bulvarı No:5, İstanbul") == "Ataşehir"
    assert detect_district("Kartal Cad. No:3, Maltepe") == "Maltepe"
    assert detect_district("Ankara Asfaltı, Kartal") == "Kartal"  # il adı cadde olarak


def test_neutral_traps():
    assert detect_district("Fatih Sultan Mehmet Mah., Ümraniye") == "Ümraniye"
    assert detect_district("Büyükdere Caddesi No:185, Şişli") == "Şişli"
    assert detect_district("Büyükdere Cad., Levent") == "Beşiktaş"
    assert detect_district("Bebek bakıcısı aranıyor, İstanbul") is None
    assert detect_district("Moda Tasarımcısı - İstanbul") is None
    assert detect_district("Acıbadem Hastanesi Maslak") == "Sarıyer"
    assert detect_district("Bahçeşehir Üniversitesi, İstanbul") is None


def test_word_boundaries():
    assert detect_district("Fatihsultan") is None
    assert detect_district("Kartaltepe") is None
    assert detect_district("Silivrikapı, İstanbul") == "Fatih"
    assert detect_district("Silivri Kapı") == "Fatih"
    assert detect_district("Edirnekapı") == "Fatih"


def test_ambiguous_names_documented_choices():
    assert detect_district("Arnavutköy, Beşiktaş") == "Beşiktaş"
    assert detect_district("Arnavutköy") == "Arnavutköy"
    assert detect_district("Maltepe, Zeytinburnu") == "Zeytinburnu"
    assert detect_district("Seyrantepe") == "Kağıthane"


def test_weak_aliases_need_context_in_long_text():
    long_text = ("Moda sektöründe deneyimli, kreatif ve takım çalışmasına yatkın "
                 "çalışma arkadaşları arıyoruz")
    assert detect_district(long_text) is None
    assert not is_istanbul(long_text)
    assert detect_district("Moda") == "Kadıköy"            # kısa konum alanı
    assert detect_district("Bebek, İstanbul") == "Beşiktaş"
    assert detect_district(long_text + " Ofisimiz İstanbul'da") == "Kadıköy"


def test_province_alias_aksaray():
    assert detect_district("Aksaray") is None
    assert not is_istanbul("Aksaray")
    assert detect_district("Aksaray, İstanbul") == "Fatih"
    assert detect_district("Aksaray / Fatih") == "Fatih"
    assert detect_district("Osmaniye Mah., Bakırköy") == "Bakırköy"
    assert not is_istanbul("Osmaniye")


# ---------------------------------------------------------------------------
# Yaka ifadeleri ve İstanbul tespiti
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("text", [
    "Avrupa Yakası", "Anadolu Yakası", "İstanbul Avrupa Yakası", "İstanbul(Avr.)",
    "Istanbul, Turkey", "ISTANBUL", "İst.", "İstanbul (Anadolu)",
])
def test_sides_are_not_districts(text):
    assert detect_district(text) is None
    assert is_istanbul(text)


@pytest.mark.parametrize("text", [
    "istanbul", "İstanbul", "ISTANBUL", "Istanbul, Turkey", "İstanbul(Avr.)", "Stambuł",
    "Estambul, Turquía", "Kadıköy / İst.", "İstanbul'da çalışacak", "Maslak", "Kozyatağı",
])
def test_is_istanbul_true(text):
    assert is_istanbul(text)


@pytest.mark.parametrize("text", [
    "", "   ", "Remote", "Turkey", "Türkiye", "Ankara", "İzmir", "Berlin, Germany",
    "Gebze, Kocaeli", "Çorlu, Tekirdağ", "Ankara Çankaya", "İzmir Bornova",
    "Bahçelievler, Ankara", "Göztepe, İzmir", "Kartal, Kocaeli", "Maltepe / Ankara",
    "Bursa Nilüfer", "Das ist gut", "Specialist.",
])
def test_is_istanbul_false(text):
    assert not is_istanbul(text)
    assert detect_district(text) is None


def test_other_province_with_istanbul_mention_still_detects():
    assert detect_district("İstanbul, Kocaeli - Tuzla") == "Tuzla"
    assert is_istanbul("İstanbul, Ankara, İzmir")
    assert detect_district("İstanbul, Ankara, İzmir") is None


def test_neighbouring_industrial_towns():
    # İstanbul'a komşu sanayi bölgeleri: açık ilçe adıyla birlikte çoklu konum sayılır.
    assert detect_district("Tuzla / Gebze") == "Tuzla"
    assert detect_district("Gebze") is None
    assert detect_district("Çerkezköy OSB") is None


def test_istanbul_street_in_other_city():
    assert not is_istanbul("İstanbul Caddesi, Bursa")
    assert not is_istanbul("İstanbul Yolu, Ankara")


def test_none_and_empty():
    assert detect_district("") is None
    assert detect_district(None) is None  # type: ignore[arg-type]
    assert not is_istanbul(None)  # type: ignore[arg-type]
    assert detect_district("—, ()") is None


def test_cache_is_bounded_and_consistent():
    geo._analyze.cache_clear()
    for _ in range(3):
        assert detect_district("Maslak, Sarıyer/İstanbul") == "Sarıyer"
    info = geo._analyze.cache_info()
    assert info.hits >= 2 and info.maxsize is not None


# ---------------------------------------------------------------------------
# Odak bölge (Maslak, Levent, Esentepe, Kağıthane, Sarıyer): plazalar, ortak adlar, koordinatlar
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("text, expected", [
    ("Kanyon", "Şişli"),
    ("Kanyon AVM, İstanbul", "Şişli"),
    ("Metrocity AVM", "Şişli"),
    ("Kristal Kule, Büyükdere Cad.", "Şişli"),
    ("Torun Center", "Şişli"),
    ("Spine Tower", "Sarıyer"),
    ("Spine Tower, Büyükdere Cad. No:243", "Sarıyer"),
    ("Palladium AVM", "Ataşehir"),
    ("Palladium Ataşehir", "Ataşehir"),
    ("Derbent, İstanbul", "Sarıyer"),
    ("Koç University", "Sarıyer"),
    ("Boğaziçi University", "Beşiktaş"),
    ("Sabancı University", "Tuzla"),
    ("Özyeğin University", "Çekmeköy"),
])
def test_focus_area_names(text, expected):
    assert detect_district(text) == expected
    assert is_istanbul(text)


@pytest.mark.parametrize("text, expected", [
    ("Ferahevler Mah.", "Sarıyer"),
    ("Baltalimanı, İstanbul", "Sarıyer"),
    ("Emirgan", "Sarıyer"),
    ("Rumelihisarı", "Sarıyer"),
    ("Zekeriyaköy, İstanbul", "Sarıyer"),
    ("Poligon", "Sarıyer"),
    ("PTT Evleri", "Sarıyer"),
    ("Ortabayır Mah.", "Kağıthane"),
    ("Harmantepe", "Kağıthane"),
    ("Emniyet Evleri", "Kağıthane"),
    ("Çağlayan Adliyesi", "Kağıthane"),
])
def test_sariyer_and_kagithane_neighbourhoods(text, expected):
    assert detect_district(text) == expected


def test_plaza_written_before_levent_wins():
    # Kanyon/Metrocity Levent'te sayılır ama Esentepe (Şişli) yakasındadır; Levent'in kendisi Beşiktaş
    assert detect_district("Kanyon Ofis Blokları, Büyükdere Cad. No:185 Levent") == "Şişli"
    assert detect_district("Kanyon, Levent") == "Şişli"
    assert detect_district("Levent, İstanbul") == "Beşiktaş"
    assert detect_district("Zorlu Center, Levent") == "Beşiktaş"   # önceki eşleşmeler bozulmadı


def test_palladium_alone_is_not_a_district():
    assert detect_district("Palladium") is None
    assert not is_istanbul("Palladium Hotel Group Barcelona")


def test_derbent_is_a_weak_alias():
    long_text = "Derbent bölgesinde faaliyet gösteren firmamız için deneyimli satış temsilcisi arıyoruz"
    assert detect_district(long_text) is None                       # genel kelime: bağlamsız uzun metinde sayılmaz
    assert detect_district(long_text + " İstanbul") == "Sarıyer"
    assert detect_district("Derbent, Konya") is None                # başka il


def test_university_campuses_are_not_bound_to_the_name_district():
    assert detect_district("İstinye Üniversitesi") is None          # kampüs Topkapı'da (Zeytinburnu)
    assert detect_district("İstinye University") is None
    assert detect_district("İstinye Üniversitesi, Topkapı") == "Zeytinburnu"
    assert detect_district("Koç Üniversitesi Hastanesi") is None
    assert detect_district("Koç University Hospital, Zeytinburnu") == "Zeytinburnu"
    assert detect_district("Koç Üniversitesi") == "Sarıyer"          # ana kampüs
    assert detect_district("İstinye Park AVM") == "Sarıyer"          # AVM adı etkilenmez


SHARED_NAMES = ["Cumhuriyet", "Hürriyet", "Merkez", "Huzur", "Sanayi", "Hamidiye", "Pınar", "Mehmet Akif Ersoy"]


def test_shared_names_are_registered_and_kept_out_of_the_tables():
    for name in SHARED_NAMES + ["Kazım Karabekir", "Yahya Kemal", "Talatpaşa"]:
        assert name in geo._AMBIGUOUS
    for name in geo._AMBIGUOUS:
        assert fold(name) not in ALIASES and fold(name) not in geo._TABLE, name


def test_shared_name_cannot_be_added_as_alias(monkeypatch):
    monkeypatch.setattr(geo, "_AMBIGUOUS", geo._AMBIGUOUS + ("Maslak",))
    with pytest.raises(ValueError):
        geo._check_ambiguous()


@pytest.mark.parametrize("name", list(geo._AMBIGUOUS) + ["Fatih Sultan Mehmet"])
def test_shared_names_alone_assign_no_district(name):
    for text in (name, f"{name} Mah.", f"{name} Mahallesi", f"{name} Mah., İstanbul"):
        assert detect_district(text) is None, text
    assert not is_istanbul(f"{name} Mah.")


@pytest.mark.parametrize("name", list(geo._AMBIGUOUS) + ["Fatih Sultan Mehmet"])
@pytest.mark.parametrize("district", ["Kağıthane", "Sarıyer", "Şişli", "Esenyurt", "Ümraniye"])
def test_shared_names_follow_the_district_in_the_text(name, district):
    assert detect_district(f"{name} Mah., {district}") == district
    assert detect_district(f"{district} / {name} Mahallesi") == district


def test_shared_names_resolve_through_a_semt_name():
    assert detect_district("Hamidiye Mah. Çağlayan") == "Kağıthane"
    assert detect_district("Huzur Mahallesi, Maslak") == "Sarıyer"
    assert detect_district("Merkez Mah., Seyrantepe, İstanbul") == "Kağıthane"


def test_locate_shared_names_need_a_district():
    for text in ("Huzur Mahallesi", "Huzur Mah.", "Pınar Mah.", "Pınar Mahallesi", "Kozdere"):
        assert locate(text, None) is None, text                    # ilçesi bilinmeyen ilan koordinat almaz
    assert locate("Huzur Mah.", "Sarıyer") == (41.112, 29.027)
    assert locate("Pınar Mahallesi", "Sarıyer") == (41.136, 29.034)
    assert locate("Pınar Mh.", "Sarıyer") == (41.136, 29.034)
    assert locate("Kozdere", "Sarıyer") == (41.145, 29.040)
    assert locate("Huzur", "Sarıyer") == (41.112, 29.027)          # yalın "huzur" da Sarıyer'de koordinat verir
    assert locate("Huzur", None) is None and locate("Huzur", "Kağıthane") == DISTRICT_COORDS["Kağıthane"]
    # başka ilçedeki aynı adlı mahalle Sarıyer'in noktasını almaz: ilçe merkezi
    assert locate("Huzur Mah.", "Kağıthane") == DISTRICT_COORDS["Kağıthane"]
    assert locate("Pınar Mah.", "Esenyurt") == DISTRICT_COORDS["Esenyurt"]
    # tek başına ilçe belirleyen adlar ilçesiz metinde de yer belirler
    assert locate("Maslak", None) == PLACE_COORDS["maslak"][1:]


def test_locate_ignores_neutral_traps():
    # "Büyükdere Caddesi" Maslak/Levent/Şişli boyunca uzanır: Büyükdere semtini göstermez
    assert locate("Büyükdere Cad. No:100 Maslak", "Sarıyer") == PLACE_COORDS["maslak"][1:]
    assert locate("Büyükdere Mah.", "Sarıyer") == PLACE_COORDS["büyükdere"][1:]
    assert locate("Bebek Bakıcısı, İstanbul", None) is None


def test_locate_plazas_are_near_their_semt():
    for text, district, semt in [("Kanyon", "Şişli", "levent"), ("Metrocity", "Şişli", "levent"),
                                 ("Spine Tower", "Sarıyer", "maslak"), ("Torun Center", "Şişli", "esentepe")]:
        pt = locate(text, detect_district(text))
        assert pt is not None and distance_km(pt, PLACE_COORDS[semt][1:]) < 0.6, text
        assert PLACE_COORDS[text.lower()][0] == district


def test_place_coords_are_consistent_with_the_alias_table():
    """Koordinatı olan her ad ya tek başına aynı ilçeyi veriyor (ALIASES), ya ortak ad ya da ilçe adıyla başlıyor."""
    shared = {fold(a) for a in geo._AMBIGUOUS}
    districts = {fold(d) for d in DISTRICTS}
    for key, (d, lat, lon) in PLACE_COORDS.items():
        f = fold(key)
        if f in ALIASES:
            assert ALIASES[f] == d, key
        else:
            assert f.removesuffix(" mahallesi") in shared or f.split()[0] in districts, key
        assert distance_km(DISTRICT_COORDS[d], (lat, lon)) < 15, key

