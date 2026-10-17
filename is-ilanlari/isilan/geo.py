"""İstanbul ilçe sözlüğü (gazetteer) ve serbest metinden ilçe tespiti.

Genel API
---------
- ``DISTRICTS``      : 39 ilçenin kanonik Türkçe yazımı, Türkçe alfabeye göre sıralı.
- ``DISTRICT_SIDE``  : ilçe -> "avrupa" | "anadolu".
- ``ALIASES``        : katlanmış (``text.fold``) semt/mahalle/OSB/plaza adı -> ilçe.
- ``PROVINCES``      : Türkiye'nin 81 ili (kanonik yazım).
- ``detect_district(text)`` -> kanonik ilçe ya da ``None``.
- ``is_istanbul(text)``     -> metin İstanbul'daki bir yeri işaret ediyor mu.
- ``side_of(district)``     -> "avrupa" | "anadolu" | ``None``.

Eşleştirme nasıl çalışır
------------------------
Metin ``fold`` ile katlanır ("Kadıköy / İSTANBUL" -> "kadikoy istanbul") ve kelimelere
bölünür. Her konumda en uzun n-gram (en fazla ``_MAX_N`` kelime) tek bir sözlükte aranır;
böylece kelime sınırı kendiliğinden sağlanır ("fatihsultan" "fatih" ile eşleşmez) ve
uzun girdiler kısa olanları "yutar" ("istanbul havalimani" -> Arnavutköy, "ordu caddesi"
-> Fatih; "fatih sultan mehmet" -> nötr tuzak). Regex yok; çağrı başına birkaç sözlük
bakışı + ``lru_cache``.

Öncelik (her katmanda metinde ilk geçen kazanır):
  0. Açık ilçe adı (ve yazım varyantları: "Eyüp", "GOP", "K.Çekmece" ...).
  1. Güçlü takma ad (Maslak, Kozyatağı, İkitelli OSB ...).
  2. Zayıf takma ad (genel kelime / başka yerde de olan ad: Moda, Bebek, Yeniköy,
     Acıbadem ...). Yalnızca metinde başka bir İstanbul işareti varsa ya da metin kısa
     (<= ``_SHORT_TOKENS`` kelime, yani tipik bir konum alanı) ise sayılır.
  3. Sokak/cadde/bulvar adı olarak geçen ilçe adı ("Ataşehir Bulvarı") — son çare.
     "<İlçe> Mah." ise hiç sayılmaz (Fatih Mah., Esenler Mah., Güngören Mah. ... pek çok
     ilçede bu adlarla mahalle var).

Başka il koruması: metin İstanbul dışındaki bir ili (81 il listesi) ya da o illerin
iyi bilinen ilçelerini (Çankaya, Bornova, Gebze ...) anıyor ve "İstanbul" geçmiyorsa
sonuç ``None`` / ``False`` olur ("Bahçelievler, Ankara", "Gebze, Kocaeli").

Bilinçli kararlar / belirsizlikler
----------------------------------
- Acıbadem: resmi Acıbadem Mahallesi Üsküdar'dadır -> Üsküdar (zayıf; ayrıca bir hastane
  zinciri adı olduğu için "Acıbadem Hastanesi" nötr, "Acıbadem Üniversitesi" -> Ataşehir).
- 4. Levent: Kağıthane (Sanayi Mah.) ile Beşiktaş sınırı; büyük plazaların adresleri
  (İş Kuleleri, Sabancı Center, Yapı Kredi Plaza) "Levent/Beşiktaş" olduğu için -> Beşiktaş.
- Gayrettepe -> Beşiktaş; Esentepe, Mecidiyeköy, Zincirlikuyu (zayıf) -> Şişli.
- Topkapı -> Zeytinburnu (otogar/Maltepe bölgesi); "Topkapı Sarayı" -> Fatih.
- Kozyatağı -> Kadıköy, İçerenköy/Kayışdağı -> Ataşehir.
- Finanskent / İstanbul Finans Merkezi -> Ümraniye (Finanskent Mah. Ümraniye'dedir).
- Seyrantepe -> Kağıthane; Büyükdere -> Sarıyer (zayıf; "Büyükdere Caddesi" nötr).
- Aksaray ve Osmaniye hem il hem İstanbul semtidir (Fatih, Bakırköy): tek başına il
  sayılır (None), başka bir İstanbul işaretiyle birlikte semt sayılır.
- Arnavutköy hem ilçe hem Beşiktaş'ta semttir: "Arnavutköy, Beşiktaş" -> Beşiktaş.
- "Avrupa Yakası" / "Anadolu Yakası" ilçe değildir: ``detect_district`` None,
  ``is_istanbul`` True. ("Anadolu Yakası OSB" -> Tuzla.)
- Kabul edilen riskler: "Fatih", "Levent", "Kartal" kişi/şirket adı olarak da geçer;
  açık ilçe adı her zaman takma addan önce gelir.
"""
from __future__ import annotations

import re
from functools import lru_cache

from .text import fold

__all__ = [
    "ALIASES",
    "DISTRICTS",
    "DISTRICT_SIDE",
    "PROVINCES",
    "detect_district",
    "is_istanbul",
    "side_of",
]

# ---------------------------------------------------------------------------
# İlçeler
# ---------------------------------------------------------------------------

_ANADOLU = (
    "Adalar", "Ataşehir", "Beykoz", "Çekmeköy", "Kadıköy", "Kartal", "Maltepe", "Pendik",
    "Sancaktepe", "Sultanbeyli", "Şile", "Tuzla", "Ümraniye", "Üsküdar",
)
_AVRUPA = (
    "Arnavutköy", "Avcılar", "Bağcılar", "Bahçelievler", "Bakırköy", "Başakşehir", "Bayrampaşa",
    "Beşiktaş", "Beylikdüzü", "Beyoğlu", "Büyükçekmece", "Çatalca", "Esenler", "Esenyurt",
    "Eyüpsultan", "Fatih", "Gaziosmanpaşa", "Güngören", "Kağıthane", "Küçükçekmece", "Sarıyer",
    "Silivri", "Sultangazi", "Şişli", "Zeytinburnu",
)

_TR_ALPHABET = "abcçdefgğhıijklmnoöprsştuüvwxyz"
_TR_ORDER = {c: i for i, c in enumerate(_TR_ALPHABET)}


def _tr_sort_key(s: str) -> tuple[int, ...]:
    low = s.replace("I", "ı").replace("İ", "i").lower()
    return tuple(_TR_ORDER.get(c, 100 + ord(c)) for c in low)


DISTRICTS: list[str] = sorted(_ANADOLU + _AVRUPA, key=_tr_sort_key)
DISTRICT_SIDE: dict[str, str] = {
    **{d: "anadolu" for d in _ANADOLU},
    **{d: "avrupa" for d in _AVRUPA},
}

# İlçe adının yaygın yazım varyantları (açık ilçe adı kadar güçlü sayılır).
_DISTRICT_VARIANTS: dict[str, list[str]] = {
    "Arnavutköy": ["Arnavut Köy"],
    "Ataşehir": ["Ata Şehir"],
    "Bahçelievler": ["Bahçeli Evler"],
    "Başakşehir": ["Başak Şehir"],
    "Bayrampaşa": ["Bayram Paşa"],
    "Beylikdüzü": ["Beylik Düzü"],
    "Büyükçekmece": ["Büyük Çekmece", "B.Çekmece", "B. Çekmece"],
    "Çekmeköy": ["Çekme Köy"],
    "Esenyurt": ["Esen Yurt"],
    "Eyüpsultan": ["Eyüp", "Eyüp Sultan", "Eyup"],
    "Gaziosmanpaşa": ["Gazi Osmanpaşa", "Gazi Osman Paşa", "GOP", "G.O.P.", "G.O.Paşa", "G.Osmanpaşa"],
    "Kağıthane": ["Kağıtane", "Kağıt Hane"],
    "Küçükçekmece": ["Küçük Çekmece", "K.Çekmece", "K. Çekmece"],
    "Sancaktepe": ["Sancak Tepe"],
    "Sultanbeyli": ["Sultan Beyli"],
    # Son ikisi: Zeytinburnu'ndaki Maltepe semti (Anadolu'daki Maltepe ilçesi değil).
    "Zeytinburnu": ["Zeytin Burnu", "Maltepe Zeytinburnu", "Maltepe Topkapı"],
    # Beşiktaş'taki Arnavutköy semti (Avrupa'nın kuzeyindeki Arnavutköy ilçesi değil).
    "Beşiktaş": ["Arnavutköy Beşiktaş", "Arnavutköy Bebek", "Bebek Arnavutköy"],
}

# ---------------------------------------------------------------------------
# Semt / mahalle / iş merkezi / OSB takma adları
# (strong = güçlü, weak = genel kelime ya da başka yerde de bulunan ad)
# ---------------------------------------------------------------------------

_ALIAS_SPEC: dict[str, tuple[str, str]] = {
    # district: (strong, weak) — virgülle ayrılmış adlar
    "Adalar": (
        "Büyükada, Heybeliada, Burgazada, Kınalıada, Sedefadası, Sedef Adası, Prens Adaları",
        "Burgaz",
    ),
    "Arnavutköy": (
        "Hadımköy, Hadımköy OSB, Taşoluk, Bolluca, Haraççı, Bahşayiş, Sazlıbosna, "
        "İstanbul Havalimanı, İstanbul Havaalanı, Yeni Havalimanı, Yeni Havaalanı, "
        "3. Havalimanı, Üçüncü Havalimanı, İstanbul Airport, IST Airport, Istanbul New Airport",
        "Durusu, Boğazköy, Yassıören, Karaburun, İmrahor, Terkos",
    ),
    "Ataşehir": (
        "İçerenköy, Kayışdağı, Ferhatpaşa, Yenisahra, Yeni Sahra, Küçükbakkalköy, Esatpaşa, "
        "Brandium, Watergarden, Metropol İstanbul, Acıbadem Üniversitesi, Batı Ataşehir",
        "Aşıkveysel",
    ),
    "Avcılar": (
        "Ambarlı, Firuzköy, Denizköşkler, Gümüşpala, İÜ Avcılar",
        "Yeşilkent",
    ),
    "Bağcılar": (
        "Güneşli, Mahmutbey, Kirazlı, Yıldıztepe, Demirkapı, İSTOÇ, Bağcılar Meydan",
        "",
    ),
    "Bahçelievler": (
        "Yenibosna, Yeni Bosna, Şirinevler, Soğanlı, Kocasinan, Siyavuşpaşa, Çobançeşme",
        "",
    ),
    "Bakırköy": (
        "Ataköy, Yeşilköy, Florya, Yeşilyurt, Zeytinlik, Sakızağacı, Şenlikköy, Basınköy, "
        "Zuhuratbaba, Atatürk Havalimanı, Atatürk Havaalanı, Marmara Forum",
        "Cevizlik, İncirli",
    ),
    "Başakşehir": (
        "İkitelli, İkitelli OSB, İkitelli Organize, İOSB, Kayabaşı, Kayaşehir, Bahçeşehir, "
        "Güvercintepe, Şahintepe, Şamlar, Masko, Mall of Istanbul, Atatürk Olimpiyat Stadı, "
        "Olimpiyat Stadı",
        "Altınşehir, Hoşdere",
    ),
    "Bayrampaşa": (
        "Altıntepsi, Sağmalcılar, Terazidere, Forum İstanbul",
        "Muratpaşa, Cevatpaşa",
    ),
    "Beşiktaş": (
        "Levent, 1. Levent, 2. Levent, 3. Levent, 4. Levent, Etiler, Ortaköy, Gayrettepe, "
        "Balmumcu, Dikilitaş, Akatlar, Kuruçeşme, Nispetiye, Nisbetiye, Levazım, Vişnezade, "
        "Abbasağa, Türkali, Cihannüma, Çırağan, Dolmabahçe, Barbaros Bulvarı, Akaretler, "
        "Serencebey, Akmerkez, Zorlu Center, Zorlu Plaza, Sabancı Center, İş Kuleleri, "
        "Yapı Kredi Plaza, Boğaziçi Üniversitesi",
        "Bebek, Ulus, Konaklar, Sinanpaşa, Muradiye, Yıldız Sarayı, Zorlu",
    ),
    "Beykoz": (
        "Kavacık, Çubuklu, Anadoluhisarı, Anadolu Hisarı, Kanlıca, Riva, Polonezköy, Acarkent, "
        "Rüzgarlıbahçe, Anadolukavağı, Anadolu Kavağı, Beykoz Kundura",
        "Paşabahçe, Yalıköy, Soğuksu, Ortaçeşme",
    ),
    "Beylikdüzü": (
        "Yakuplu, Gürpınar, Dereağzı, BOSB",
        "Kavaklı, Adnan Kahveci",
    ),
    "Beyoğlu": (
        "Taksim, Karaköy, Cihangir, Galata, Tophane, Kasımpaşa, Şişhane, Tepebaşı, Tarlabaşı, "
        "İstiklal Caddesi, İstiklal Cad, İstiklal Cd, Hasköy, Sütlüce, Piyalepaşa, Asmalımescit, "
        "Gümüşsuyu, Firuzağa, Çukurcuma, Kuledibi, Galata Kulesi, Perşembe Pazarı, Talimhane, "
        "Galataport, Kabataş, Halıcıoğlu, Örnektepe, Kulaksız, Kalyoncukulluğu, Tünel Meydanı",
        "Fındıklı, Pera",
    ),
    "Büyükçekmece": (
        "Kumburgaz, Celaliye, Güzelce, Mimaroba, Sinanoba, Alkent 2000, Batıköy, Muratçeşme, "
        "Türkoba",
        "Alkent, Kamiloba, Pınartepe",
    ),
    "Çatalca": (
        "Binkılıç, İnceğiz",
        "Karacaköy, Muratbey, Ormanlı, Kabakça, Gökçeali, Oklalı",
    ),
    "Çekmeköy": (
        "Ömerli, Taşdelen, Alemdağ, Nişantepe, Koçullu, Sırapınar, Ekşioğlu, Çatalmeşe, "
        "Kirazlıdere, Özyeğin Üniversitesi",
        "Reşadiye, Soğukpınar, Hüseyinli, Aydınlar",
    ),
    "Esenler": (
        "Tekstilkent, Davutpaşa, Atışalanı, Yıldız Teknopark, YTÜ Davutpaşa, Esenler Otogarı",
        "Nine Hatun",
    ),
    "Esenyurt": (
        "Kıraç, Akçaburgaz, Ardıçlı, Saadetdere, İncirtepe, Mehterçeşme, Bağlarçeşme",
        "Yenikent, Esenkent, Sultaniye, Güzelyurt, Akevler",
    ),
    "Eyüpsultan": (
        "Alibeyköy, Göktürk, Kemerburgaz, Topçular, Yeşilpınar, Defterdar, Düğmeciler, "
        "Emniyettepe, Çırçır, İslambey, Karadolap, Silahtarağa, Ağaçlı, Odayeri, Vialand, "
        "Isfanbul, Santralistanbul",
        "Rami, Nişanca",
    ),
    "Fatih": (
        "Sultanahmet, Laleli, Eminönü, Sirkeci, Beyazıt, Kumkapı, Balat, Fener Balat, "
        "Karagümrük, Cerrahpaşa, Yenikapı, Unkapanı, Tahtakale, Kapalıçarşı, Kapalı Çarşı, "
        "Mahmutpaşa, Zeyrek, Şehzadebaşı, Vezneciler, Edirnekapı, Edirne Kapı, Topkapı Sarayı, "
        "Fındıkzade, Haseki, Samatya, Yedikule, Kocamustafapaşa, Cibali, Ayvansaray, Şehremini, "
        "Silivrikapı, Silivri Kapı, Mevlanakapı, Molla Gürani, Küçükpazar, Süleymaniye, Kadırga, "
        "Cankurtaran, Mısır Çarşısı, Vatan Caddesi, Millet Caddesi, Ordu Caddesi, Yusufpaşa, "
        "Hırka-i Şerif, Beyazıt Meydanı",
        "Vefa, Çapa, Mercan, Tarihi Yarımada",
    ),
    "Gaziosmanpaşa": (
        "Yıldıztabya, Küçükköy, Sarıgöl, Pazariçi, Şemsipaşa, Karlıtepe",
        "Karayolları",
    ),
    "Güngören": (
        "Merter, Tozkoparan, Haznedar, Gençosman, Güneştepe, Abdurrahman Nafiz Gürman",
        "Akıncılar, Mareşal Çakmak",
    ),
    "Kadıköy": (
        "Kozyatağı, Bostancı, Fikirtepe, Göztepe, Erenköy, Suadiye, Caddebostan, Feneryolu, "
        "Fenerbahçe, Kalamış, Koşuyolu, Rasimpaşa, Osmanağa, Caferağa, Zühtüpaşa, Merdivenköy, "
        "Sahrayıcedit, Sahrayıcedid, Söğütlüçeşme, Yeldeğirmeni, Altıyol, Bahariye, Haydarpaşa, "
        "Çiftehavuzlar, Selamiçeşme, Kızıltoprak, Bağdat Caddesi, Bağdat Cad, Bağdat Cd",
        "Moda, Hasanpaşa",
    ),
    "Kağıthane": (
        "Çağlayan, Çeliktepe, Ortabayır, Nurtepe, Emniyet Evleri, Emniyetevleri, Şirintepe, "
        "Telsizler, Harmantepe, Seyrantepe, Sadabad, Sadabat",
        "Gürsel, Gültepe, Yeşilce",
    ),
    "Kartal": (
        "Soğanlık, Yakacık, Kordonboyu, Topselvi, Orhantepe, Karlıktepe",
        "Atalar, Gümüşpınar, Çavuşoğlu",
    ),
    "Küçükçekmece": (
        "Halkalı, Sefaköy, Kanarya, Tevfikbey, Beşyol, Yarımburgaz",
        "Cennet",
    ),
    "Maltepe": (
        "Altayçeşme, Altıntepe, Gülsuyu, Gülensu, İdealtepe, Küçükyalı, Zümrütevler, "
        "Başıbüyük, Aydınevler, Büyükbakkalköy",
        "Cevizli, Feyzullah, Girne",
    ),
    "Pendik": (
        "Kurtköy, Sabiha Gökçen, Sabiha Gökçen Havalimanı, Sabiha Gökçen Havaalanı, Çamçeşme, "
        "Esenyalı, Velibaba, Dolayoba, Yayalar, Harmandere, Çınardere, Güllübağlar, "
        "Teknopark İstanbul, Göçbeyli, Sapanbağları, Seyhli",
        "Kaynarca, Güzelyalı, Yenişehir, Kavakpınar, Ramazanoğlu, Ballıca, Emirli",
    ),
    "Sancaktepe": (
        "Samandıra, Sarıgazi, Paşaköy",
        "Kemal Türkler, Yenidoğan",
    ),
    "Sarıyer": (
        "Maslak, Ayazağa, İstinye, İstinye Park, İstinyePark, Tarabya, Emirgan, Rumelihisarı, "
        "Rumeli Hisarı, Rumelikavağı, Rumeli Kavağı, Rumelifeneri, Rumeli Feneri, Baltalimanı, "
        "Kilyos, Zekeriyaköy, Bahçeköy, Kireçburnu, Uskumruköy, Garipçe, Darüşşafaka, "
        "Ferahevler, Hacıosman, Boyacıköy, Vadi İstanbul, Vadistanbul, İTÜ Ayazağa, "
        "Arı Teknokent, İTÜ Arı Teknokent, Koç Üniversitesi, Maslak 1453",
        "Büyükdere, Yeniköy, Kumköy, Demirciköy, Çayırbaşı, Kocataş, Poligon, Reşitpaşa, "
        "Gümüşdere, PTT Evleri",
    ),
    "Silivri": (
        "Selimpaşa, Gümüşyaka, Değirmenköy, Kurfallı, Büyükçavuşlu, Danamandıra",
        "Çanta, Sinekli, Seymen, Gazitepe, Alipaşa",
    ),
    "Sultanbeyli": (
        "",
        "Battalgazi",
    ),
    "Sultangazi": (
        "Habipler, Gazi Mahallesi, Gazi Mah, Malkoçoğlu, Sultançiftliği",
        "Cebeci, Zübeyde Hanım",
    ),
    "Şile": (
        "Ağva, Kumbaba",
        "Sahilköy, Kabakoz",
    ),
    "Şişli": (
        "Mecidiyeköy, Esentepe, Nişantaşı, Teşvikiye, Osmanbey, Pangaltı, Harbiye, Feriköy, "
        "Bomonti, Fulya, Halaskargazi, Kuştepe, İzzetpaşa, Elmadağ, Trump Towers",
        "Kurtuluş, Gülbahar, Mahmut Şevket Paşa, Meşrutiyet, Halide Edip Adıvar, Duatepe, "
        "Ergenekon, Maçka, Zincirlikuyu, Cevahir",
    ),
    "Tuzla": (
        "Aydınlı, Aydıntepe, Orhanlı, Tepeören, Akfırat, İTOSB, Tuzla OSB, Deri OSB, "
        "İstanbul Deri OSB, Anadolu Yakası OSB, AYOSB, Kimya Sanayicileri OSB, "
        "Sabancı Üniversitesi, Tuzla Tersaneler",
        "İçmeler, Şifa, Evliya Çelebi, Postane",
    ),
    "Ümraniye": (
        "Dudullu, Yukarı Dudullu, Yukarıdudullu, Aşağı Dudullu, Aşağıdudullu, İMES, İMES OSB, "
        "Dudullu OSB, Şerifali, Ihlamurkuyu, Esenşehir, Tatlısu, Armağanevler, Yamanevler, "
        "Tantavi, Hekimbaşı, Elmalıkent, Esenevler, Finanskent, İstanbul Finans Merkezi, "
        "Tepeüstü, MODOKO, Alemdağ Caddesi, Alemdağ Cad, Alemdağ Cd",
        "Madenler, Parseller, Cemil Meriç",
    ),
    "Üsküdar": (
        "Altunizade, Çengelköy, Kuzguncuk, Beylerbeyi, Kısıklı, Ünalan, Bulgurlu, Kandilli, "
        "Vaniköy, Salacak, Doğancılar, İcadiye, Burhaniye, Sultantepe, Küplüce, Kirazlıtepe, "
        "Çamlıca, Büyük Çamlıca, Küçük Çamlıca, Nakkaştepe, Validebağ, Fıstıkağacı, Selamsız, "
        "Zeynep Kamil, Capitol AVM, Emaar Square, Akasya AVM",
        "Acıbadem, Bağlarbaşı, Harem, Selimiye, Mihrimah",
    ),
    "Zeytinburnu": (
        "Topkapı, Merkezefendi, Kazlıçeşme, Seyitnizam, Beştelsiz, Çırpıcı, Nuripaşa, Olivium",
        "Telsiz, Yeşiltepe, Sümer, Veliefendi",
    ),
}

# Hem il adı hem İstanbul semti olanlar: tek başına il sayılır (bkz. modül açıklaması).
_PROVINCE_ALIASES = {"Aksaray": "Fatih", "Osmaniye": "Bakırköy"}

# Bir İstanbul adını "yutan" ama hiçbir ilçeye işaret etmeyen kalıplar (tuzaklar).
_NEUTRAL = [
    "Fatih Sultan Mehmet", "Fatih Sultan", "FSM",
    "Büyükdere Caddesi", "Büyükdere Cad", "Büyükdere Cd", "Büyükdere Cadde",
    "Bahçeşehir Üniversitesi", "Bahçeşehir Koleji", "Bahçeşehir Okulları",
    "Acıbadem Hastanesi", "Acıbadem Hastaneleri", "Acıbadem Sağlık", "Acıbadem Sağlık Grubu",
    "Bebek Bakıcısı", "Bebek Bakıcı", "Bebek Bakımı", "Bebek Bakım", "Bebek Giyim",
    "Bebek Ürünleri", "Bebek Maması",
    "Moda Tasarım", "Moda Tasarımı", "Moda Tasarımcı", "Moda Tasarımcısı", "Moda Sektörü",
    "Moda Evi", "Moda Markası", "Moda Perakende", "Moda Danışmanı",
    "Paşabahçe Mağazaları", "Paşabahçe Mağaza", "Galatasaray",
]

# İstanbul'un kendisi (çeşitli dillerde / yazımlarda) ve yaka ifadeleri.
_ISTANBUL_WORDS = [
    "İstanbul", "Istanbul", "Istambul", "Estambul", "Stambul", "Stamboul", "Istanbuł",
    "İstanbulda", "İstanbuldaki", "İstanbuldan", "İstanbula", "İstanbulun",
    "İst Avr", "İst Avrupa", "İst Anadolu", "Ist Asya",
]
_SIDE_WORDS = ["Avrupa Yakası", "Anadolu Yakası", "Asya Yakası", "European Side", "Asian Side"]

# ---------------------------------------------------------------------------
# Diğer iller ve iyi bilinen ilçeleri (başka il koruması)
# ---------------------------------------------------------------------------

PROVINCES: list[str] = [
    "Adana", "Adıyaman", "Afyonkarahisar", "Ağrı", "Aksaray", "Amasya", "Ankara", "Antalya",
    "Ardahan", "Artvin", "Aydın", "Balıkesir", "Bartın", "Batman", "Bayburt", "Bilecik",
    "Bingöl", "Bitlis", "Bolu", "Burdur", "Bursa", "Çanakkale", "Çankırı", "Çorum", "Denizli",
    "Diyarbakır", "Düzce", "Edirne", "Elazığ", "Erzincan", "Erzurum", "Eskişehir", "Gaziantep",
    "Giresun", "Gümüşhane", "Hakkari", "Hatay", "Iğdır", "Isparta", "İstanbul", "İzmir",
    "Kahramanmaraş", "Karabük", "Karaman", "Kars", "Kastamonu", "Kayseri", "Kilis", "Kırıkkale",
    "Kırklareli", "Kırşehir", "Kocaeli", "Konya", "Kütahya", "Malatya", "Manisa", "Mardin",
    "Mersin", "Muğla", "Muş", "Nevşehir", "Niğde", "Ordu", "Osmaniye", "Rize", "Sakarya",
    "Samsun", "Siirt", "Sinop", "Sivas", "Şanlıurfa", "Şırnak", "Tekirdağ", "Tokat", "Trabzon",
    "Tunceli", "Uşak", "Van", "Yalova", "Yozgat", "Zonguldak",
]
_PROVINCE_EXTRA = ["Afyon", "Maraş", "K.Maraş", "Urfa", "Antep", "İçel", "Dersim"]
# Kişi/şirket adı olarak da yaygın iller: yalnızca açık bir ilçe adı yoksa korumayı tetikler.
_WEAK_PROVINCES = {"aydin", "van", "mus", "ordu", "batman", "karaman", "kars"}

# Başka illerin iyi bilinen ilçe/semtleri. "Sert" olanlar İstanbul ilçesi geçse bile
# (İstanbul kelimesi yoksa) sonucu iptal eder; "yumuşak" olanlar (İstanbul'a komşu sanayi
# bölgeleri; "Tuzla / Gebze" gibi çoklu konumlar olağandır) yalnızca açık ilçe adı yoksa.
_FOREIGN_HARD = [
    "Çankaya", "Keçiören", "Etimesgut", "Sincan", "Mamak", "Kızılay", "Ostim", "İvedik",
    "Esenboğa", "Bornova", "Karşıyaka", "Buca", "Çiğli", "Gaziemir", "Bayraklı", "Karabağlar",
    "Alsancak", "Nilüfer", "Görükle", "Odunpazarı", "Adapazarı", "Serdivan", "Seyhan",
    "Çukurova", "Selçuklu", "Meram", "Karatay", "Kepez", "Konyaaltı", "Alanya", "Bodrum",
    "Fethiye", "Marmaris", "Şahinbey", "Şehitkamil", "Lüleburgaz",
]
_FOREIGN_SOFT = [
    "Gebze", "İzmit", "Darıca", "Dilovası", "Çayırova", "Gölcük", "Körfez", "Derince",
    "Kartepe", "Çorlu", "Çerkezköy", "Kapaklı", "Ergene", "Süleymanpaşa",
]

# ---------------------------------------------------------------------------
# Sokak / cadde / mahalle ekleri
# ---------------------------------------------------------------------------

_MAH_SUFFIX = frozenset({"mah", "mahallesi", "mahalle", "mh", "mahalesi"})
_STREET_SUFFIX = frozenset({
    "cad", "cadde", "caddesi", "cd", "cadd", "sok", "sokak", "sokagi", "sk", "skk",
    "bulvari", "bulvar", "blv", "bulv", "blvd", "bul", "yolu", "asfalti", "otoyolu", "sitesi",
})

# ---------------------------------------------------------------------------
# Sözlüğün kurulumu
# ---------------------------------------------------------------------------

_K_DISTRICT, _K_STRONG, _K_WEAK, _K_PALIAS, _K_NEUTRAL, _K_IST, _K_SIDE = range(7)
_K_PROV, _K_PROV_WEAK, _K_FOREIGN_HARD, _K_FOREIGN_SOFT = range(7, 11)

_TABLE: dict[str, tuple[int, str | None]] = {}
ALIASES: dict[str, str] = {}


def _split(spec: str) -> list[str]:
    return [p.strip() for p in spec.split(",") if p.strip()]


def _put(name: str, kind: int, district: str | None) -> None:
    key = fold(name)
    if not key:
        raise ValueError(f"boş anahtar: {name!r}")
    old = _TABLE.get(key)
    if old is not None:
        if old == (kind, district):
            return
        raise ValueError(f"çakışan geo anahtarı {key!r}: {old} / {(kind, district)}")
    _TABLE[key] = (kind, district)


def _build() -> None:
    for d in DISTRICTS:
        _put(d, _K_DISTRICT, d)
    for d, variants in _DISTRICT_VARIANTS.items():
        for v in variants:
            _put(v, _K_DISTRICT, d)
    for d, (strong, weak) in _ALIAS_SPEC.items():
        if d not in DISTRICT_SIDE:
            raise ValueError(f"bilinmeyen ilçe: {d}")
        for a in _split(strong):
            _put(a, _K_STRONG, d)
            ALIASES[fold(a)] = d
        for a in _split(weak):
            _put(a, _K_WEAK, d)
            ALIASES[fold(a)] = d
    for p, d in _PROVINCE_ALIASES.items():
        _put(p, _K_PALIAS, d)
        ALIASES[fold(p)] = d
    for n in _NEUTRAL:
        _put(n, _K_NEUTRAL, None)
    for w in _ISTANBUL_WORDS:
        _put(w, _K_IST, None)
    for w in _SIDE_WORDS:
        _put(w, _K_SIDE, None)
    for p in PROVINCES + _PROVINCE_EXTRA:
        key = fold(p)
        if key == "istanbul" or key in _TABLE and _TABLE[key][0] == _K_PALIAS:
            continue
        _put(p, _K_PROV_WEAK if key in _WEAK_PROVINCES else _K_PROV, None)
    for f in _FOREIGN_HARD:
        _put(f, _K_FOREIGN_HARD, None)
    for f in _FOREIGN_SOFT:
        _put(f, _K_FOREIGN_SOFT, None)


_build()
_MAX_N = max(k.count(" ") + 1 for k in _TABLE)
_FIRST_TOKENS = frozenset(k.split(" ", 1)[0] for k in _TABLE)
_SHORT_TOKENS = 6
_FOLD_TO_DISTRICT = {fold(d): d for d in DISTRICTS}

# "İst." kısaltması (ör. "Kadıköy / İst."); katlamadan önce ham metinde aranır.
_IST_ABBR = re.compile(r"(?<![^\W\d_])[İIiı][Ss][Tt]\.")
_PRE = str.maketrans({"ł": "l", "Ł": "L"})


# ---------------------------------------------------------------------------
# Çözümleme
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1 << 16)
def _analyze(text: str) -> tuple[str | None, bool]:
    """(ilçe, istanbul_mu) döner."""
    if not text:
        return None, False
    raw = text.translate(_PRE)
    toks = fold(raw).split()
    if not toks:
        return None, False
    n = len(toks)

    ist = bool(_IST_ABBR.search(raw))
    side = False
    prov_hard = prov_soft = False
    tier0 = tier1 = tier3 = None
    weak: str | None = None          # ilk zayıf takma ad
    palias: str | None = None        # ilk il/semt adı (Aksaray, Osmaniye)
    weak_pos = palias_pos = n

    i = 0
    table = _TABLE
    first = _FIRST_TOKENS
    while i < n:
        if toks[i] not in first:
            i += 1
            continue
        entry = None
        span = 0
        for size in range(min(_MAX_N, n - i), 0, -1):
            key = toks[i] if size == 1 else " ".join(toks[i:i + size])
            entry = table.get(key)
            if entry is not None:
                span = size
                break
        if entry is None:
            i += 1
            continue
        kind, district = entry
        nxt = toks[i + span] if i + span < n else ""
        suffixed = nxt in _STREET_SUFFIX or nxt in _MAH_SUFFIX
        if kind == _K_DISTRICT:
            if nxt in _MAH_SUFFIX:
                pass  # "Fatih Mah." vb. — başka ilçelerdeki mahalle adı
            elif nxt in _STREET_SUFFIX:
                tier3 = tier3 or district
            else:
                tier0 = tier0 or district
        elif kind == _K_STRONG:
            tier1 = tier1 or district
        elif kind == _K_WEAK:
            if weak is None:
                weak, weak_pos = district, i
        elif kind == _K_PALIAS:
            if palias is None:
                palias, palias_pos = district, i
        elif kind == _K_IST:
            if not suffixed:  # "İstanbul Cad." başka şehirlerde de var
                ist = True
        elif kind == _K_SIDE:
            side = True
        elif kind == _K_PROV or kind == _K_FOREIGN_HARD:
            if not suffixed:  # "Ankara Asfaltı", "Sakarya Mah." İstanbul'da da var
                prov_hard = True
        elif kind == _K_PROV_WEAK or kind == _K_FOREIGN_SOFT:
            if not suffixed:
                prov_soft = True
        i += span

    if not ist and not side:
        if prov_hard or (prov_soft and tier0 is None):
            return None, False

    district = tier0 or tier1
    if district is None:
        signal = ist or side or tier3 is not None
        candidates = []
        if weak is not None and (signal or n <= _SHORT_TOKENS):
            candidates.append((weak_pos, weak))
        if palias is not None and (signal or weak is not None):
            candidates.append((palias_pos, palias))
        if candidates:
            district = min(candidates)[1]
        else:
            district = tier3
    return district, bool(ist or side or district)


def detect_district(text: str) -> str | None:
    """Konum/başlık metninden kanonik ilçe adını döner ("Kadıköy" gibi) ya da None."""
    return _analyze(text or "")[0]


def is_istanbul(text: str) -> bool:
    """Metin İstanbul'daki bir yeri işaret ediyorsa True."""
    return _analyze(text or "")[1]


def side_of(district: str | None) -> str | None:
    """İlçenin yakasını ("avrupa" / "anadolu") döner; bilinmiyorsa None.
    Kanonik ad beklenir ama "kadikoy" gibi katlanmış yazımlar da kabul edilir."""
    if not district:
        return None
    side = DISTRICT_SIDE.get(district)
    if side is None:
        canon = _FOLD_TO_DISTRICT.get(fold(district))
        side = DISTRICT_SIDE.get(canon) if canon else None
    return side


# ---------------------------------------------------------------------------
# Yaklaşık konum ve uzaklık (yakınlık sıralaması için; kuş uçuşu)
# ---------------------------------------------------------------------------
import math as _math

# İlçe merkezleri (yaklaşık; ilçenin yerleşik/iş yoğunluğu merkezi)
DISTRICT_COORDS: dict[str, tuple[float, float]] = {
    "Adalar": (40.876, 29.091), "Arnavutköy": (41.184, 28.740), "Ataşehir": (40.984, 29.127),
    "Avcılar": (40.980, 28.721), "Bağcılar": (41.039, 28.856), "Bahçelievler": (41.000, 28.860),
    "Bakırköy": (40.978, 28.872), "Başakşehir": (41.093, 28.802), "Bayrampaşa": (41.047, 28.912),
    "Beşiktaş": (41.043, 29.007), "Beykoz": (41.134, 29.092), "Beylikdüzü": (40.982, 28.640),
    "Beyoğlu": (41.037, 28.977), "Büyükçekmece": (41.020, 28.585), "Çatalca": (41.143, 28.461),
    "Çekmeköy": (41.033, 29.183), "Esenler": (41.043, 28.876), "Esenyurt": (41.029, 28.673),
    "Eyüpsultan": (41.048, 28.934), "Fatih": (41.019, 28.949), "Gaziosmanpaşa": (41.057, 28.915),
    "Güngören": (41.022, 28.872), "Kadıköy": (40.990, 29.029), "Kağıthane": (41.081, 28.972),
    "Kartal": (40.890, 29.190), "Küçükçekmece": (41.000, 28.780), "Maltepe": (40.935, 29.131),
    "Pendik": (40.877, 29.235), "Sancaktepe": (40.990, 29.230), "Sarıyer": (41.135, 29.045),
    "Silivri": (41.073, 28.246), "Sultanbeyli": (40.968, 29.262), "Sultangazi": (41.106, 28.867),
    "Şile": (41.176, 29.613), "Şişli": (41.060, 28.987), "Tuzla": (40.816, 29.301),
    "Ümraniye": (41.016, 29.124), "Üsküdar": (41.023, 29.015), "Zeytinburnu": (40.994, 28.904),
}

# Mahalle / semt / iş merkezi noktaları (ilçe merkezinden daha hassas yakınlık için)
PLACE_COORDS: dict[str, tuple[str, float, float]] = {
    # Sarıyer ve çevresi
    "ptt evleri": ("Sarıyer", 41.142, 29.036), "hacıosman": ("Sarıyer", 41.140, 29.033),
    "kozdere": ("Sarıyer", 41.145, 29.040), "kocataş": ("Sarıyer", 41.146, 29.042),
    "darüşşafaka": ("Sarıyer", 41.130, 29.041), "ferahevler": ("Sarıyer", 41.126, 29.046),
    "pınar mahallesi": ("Sarıyer", 41.136, 29.034), "tarabya": ("Sarıyer", 41.138, 29.056),
    "kireçburnu": ("Sarıyer", 41.145, 29.053), "yeniköy": ("Sarıyer", 41.121, 29.067),
    "istinye": ("Sarıyer", 41.113, 29.057), "emirgan": ("Sarıyer", 41.105, 29.056),
    "reşitpaşa": ("Sarıyer", 41.103, 29.045), "baltalimanı": ("Sarıyer", 41.095, 29.056),
    "rumelihisarı": ("Sarıyer", 41.085, 29.056), "maslak": ("Sarıyer", 41.110, 29.020),
    "ayazağa": ("Sarıyer", 41.107, 29.012), "huzur": ("Sarıyer", 41.112, 29.027),
    "vadi istanbul": ("Sarıyer", 41.105, 28.990), "bahçeköy": ("Sarıyer", 41.175, 28.990),
    "zekeriyaköy": ("Sarıyer", 41.200, 29.030), "kumköy": ("Sarıyer", 41.250, 29.030),
    "rumelifeneri": ("Sarıyer", 41.233, 29.110), "büyükdere": ("Sarıyer", 41.160, 29.050),
    "çayırbaşı": ("Sarıyer", 41.157, 29.045), "sarıyer merkez": ("Sarıyer", 41.167, 29.057),
    # Beşiktaş / Şişli / Kağıthane iş merkezleri
    "levent": ("Beşiktaş", 41.080, 29.011), "4 levent": ("Beşiktaş", 41.085, 29.008),
    "etiler": ("Beşiktaş", 41.081, 29.033), "gayrettepe": ("Beşiktaş", 41.068, 29.008),
    "zincirlikuyu": ("Şişli", 41.069, 29.010), "ortaköy": ("Beşiktaş", 41.048, 29.027),
    "bebek": ("Beşiktaş", 41.077, 29.043), "mecidiyeköy": ("Şişli", 41.067, 28.995),
    "esentepe": ("Şişli", 41.075, 29.005), "nişantaşı": ("Şişli", 41.050, 28.993),
    "seyrantepe": ("Kağıthane", 41.100, 28.990), "çağlayan": ("Kağıthane", 41.068, 28.980),
    # Anadolu yakası iş merkezleri
    "kavacık": ("Beykoz", 41.090, 29.090), "kozyatağı": ("Kadıköy", 40.975, 29.098),
    "altunizade": ("Üsküdar", 41.022, 29.044), "dudullu": ("Ümraniye", 41.005, 29.155),
    "kurtköy": ("Pendik", 40.910, 29.300), "içerenköy": ("Ataşehir", 40.972, 29.110),
    # Avrupa yakası diğer merkezler
    "ikitelli": ("Başakşehir", 41.065, 28.795), "halkalı": ("Küçükçekmece", 41.035, 28.780),
    "merter": ("Güngören", 41.008, 28.890), "yenibosna": ("Bahçelievler", 40.997, 28.833),
    "güneşli": ("Bağcılar", 41.040, 28.820), "hadımköy": ("Arnavutköy", 41.130, 28.630),
    "istanbul havalimanı": ("Arnavutköy", 41.262, 28.742), "ataköy": ("Bakırköy", 40.980, 28.850),
}

_PLACE_IDX = sorted(((fold(k), v) for k, v in PLACE_COORDS.items()), key=lambda kv: -len(kv[0]))

ORIGINS: list[dict] = [{"name": "PTT Evleri (Sarıyer)", "lat": 41.142, "lon": 29.036}] + [
    {"name": d, "lat": c[0], "lon": c[1]} for d, c in DISTRICT_COORDS.items()]


def locate(text: str, district: str | None) -> tuple[float, float] | None:
    """Konum metninden yaklaşık koordinat: tanınan mahalle/semt (ilçeyle uyumluysa), yoksa ilçe merkezi."""
    t = " " + fold(text or "") + " "
    for key, (pd, lat, lon) in _PLACE_IDX:
        if f" {key} " in t and (district is None or district == pd):
            return lat, lon
    if district and district in DISTRICT_COORDS:
        return DISTRICT_COORDS[district]
    return None


def distance_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    """İki nokta arası kuş uçuşu uzaklık (haversine, km)."""
    la1, lo1, la2, lo2 = map(_math.radians, (a[0], a[1], b[0], b[1]))
    h = _math.sin((la2 - la1) / 2) ** 2 + _math.cos(la1) * _math.cos(la2) * _math.sin((lo2 - lo1) / 2) ** 2
    return 6371.0 * 2 * _math.asin(_math.sqrt(h))
