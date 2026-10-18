"""Büyük şirketler ve holdingler kataloğu.

İlanın şirket adı (Kariyer.net, LinkedIn, Indeed gibi genel sitelerden gelenler dahil) bu katalogla
eşleştirilir; eşleşen ilan, şirketin bağlı olduğu grubun adıyla etiketlenir ("Arçelik" → "Koç Topluluğu").

Eşleştirme: şirket adı fold() ile sadeleştirilir ve takma adlar sözcük sınırında aranır. Kısa ya da
başka anlamı olan adlar (ING, TEB, BİM, ŞOK, Efes ...) yalnızca tam/uzun biçimleriyle yazılmıştır.
"""
from __future__ import annotations

import re
from functools import lru_cache

from .text import fold

# (grup adı, sektör, takma adlar). Takma adlar fold() sonrası biçimiyle yazılmasa da olur; yüklenirken katlanır.
GROUPS: list[tuple[str, str, list[str]]] = [
    # --- Holdingler ve grupları ---
    ("Koç Topluluğu", "Holding", [
        "koc holding", "koc toplulugu", "koc grubu", "arcelik", "beko", "ford otomotiv", "ford otosan", "tofas",
        "tupras", "yapi kredi", "yapi ve kredi bankasi", "aygaz", "opet", "otokoc", "otokar", "turk traktor",
        "koc sistem", "kocsistem", "koctas", "setur", "divan grubu", "divan otel", "entek", "zer merkezi",
        "koc finansman", "yapi kredi yatirim", "koc universitesi", "vkv amerikan hastanesi", "amerikan hastanesi",
        "marmaris altinyunus", "demir export", "ram dis ticaret", "inventram", "wat motor", "token financial",
    ]),
    ("Sabancı Holding", "Holding", [
        "sabanci holding", "haci omer sabanci", "akbank", "enerjisa", "brisa", "kordsa", "cimsa", "aksigorta",
        "agesa", "teknosa", "carrefoursa", "carrefour sa", "sabanci dx", "sabanci universitesi", "temsa", "akcansa",
        "ak yatirim", "aklease", "ak finansal",
    ]),
    ("Anadolu Grubu", "Holding", [
        "anadolu grubu", "ag anadolu grubu", "anadolu efes", "efes pazarlama", "coca cola icecek", "cci ",
        "migros", "macrocenter", "anadolu isuzu", "isuzu", "mcdonald s", "mcdonalds", "anadolu motor",
        "anadolu etap", "adel kalemcilik", "faber castell", "anadolu saglik",
    ]),
    ("Yıldız Holding", "Holding", ["yildiz holding", "ulker", "pladis", "sok marketler", "sok market", "godiva",
                                    "bizim toptan", "horizon pazarlama", "dogadan", "kerevitas", "polinas", "gozde girisim"]),
    ("Eczacıbaşı Topluluğu", "Holding", ["eczacibasi", "vitra", "artema", "ipek kagit", "selpak", "intema",
                                         "eczacibasi ilac", "eczacibasi monrol", "kale kilit"]),
    ("OYAK Grubu", "Holding", ["oyak", "erdemir", "isdemir", "oyak renault", "oyak cimento", "omsan", "oyak yatirim"]),
    ("Zorlu Holding", "Holding", ["zorlu holding", "vestel", "zorlu enerji", "korteks", "zorlu center", "taç ev tekstili"]),
    ("Borusan Holding", "Holding", ["borusan", "borusan otomotiv", "borusan lojistik", "borusan mannesmann",
                                    "borusan cat", "borusan enbw", "supsan"]),
    ("Doğuş Grubu", "Holding", ["dogus holding", "dogus grubu", "dogus otomotiv", "dogus teknoloji", "d ream",
                                "d marin"]),
    ("Doğan Holding", "Holding", ["dogan holding", "dogan sirketler grubu", "aytemiz akaryakit", "ditas"]),
    ("Alarko Holding", "Holding", ["alarko"]),
    ("Enka İnşaat", "Holding", ["enka insaat", "enka"]),
    ("Limak Holding", "Holding", ["limak"]),
    ("Kalyon Holding", "Holding", ["kalyon"]),
    ("Cengiz Holding", "Holding", ["cengiz holding", "cengiz insaat", "cengiz enerji"]),
    ("Kolin İnşaat", "Holding", ["kolin insaat", "kolin holding"]),
    ("Rönesans Holding", "Holding", ["ronesans"]),
    ("Fiba Holding", "Holding", ["fiba holding", "fibabanka", "fiba gayrimenkul"]),
    ("Boyner Grup", "Perakende", ["boyner", "beymen", "ys yargici", "network giyim"]),
    ("Kibar Holding", "Holding", ["kibar holding", "assan aluminyum", "assan panel"]),
    ("Sanko Holding", "Holding", ["sanko holding", "sanko tekstil"]),
    ("Hayat Holding", "Holding", ["hayat kimya", "hayat holding", "kastamonu entegre", "molfix"]),
    ("Şişecam", "Sanayi", ["sisecam", "pasabahce", "trakya cam"]),
    ("Tekfen Holding", "Holding", ["tekfen"]),
    ("Demirören Holding", "Holding", ["demiroren"]),
    ("Elginkan Topluluğu", "Holding", ["eca ", "elginkan"]),
    ("Nurol Holding", "Holding", ["nurol"]),
    ("Esas Holding", "Holding", ["esas holding"]),
    ("Park Holding", "Holding", ["park holding", "ciner"]),
    ("Kale Grubu", "Holding", ["kale grubu", "kaleseramik", "kale seramik", "kalekim"]),
    ("Abdi İbrahim", "İlaç & Sağlık", ["abdi ibrahim"]),
    # --- Bankalar ve finans ---
    ("İş Bankası Grubu", "Banka & Finans", ["is bankasi", "turkiye is bankasi", "isbank", "is yatirim", "anadolu hayat",
                                             "anadolu sigorta", "softtech", "is leasing", "is faktoring", "is gyo"]),
    ("Garanti BBVA", "Banka & Finans", ["garanti bbva", "garanti bankasi", "garanti teknoloji", "garanti emeklilik",
                                        "garanti filo", "garanti bbva teknoloji"]),
    ("Ziraat Bankası", "Banka & Finans", ["ziraat bankasi", "ziraat katilim", "ziraat teknoloji", "ziraat finans"]),
    ("Halkbank", "Banka & Finans", ["halkbank", "halk bankasi", "halk yatirim"]),
    ("VakıfBank", "Banka & Finans", ["vakifbank", "vakiflar bankasi", "vakif katilim"]),
    ("QNB Türkiye", "Banka & Finans", ["qnb", "finansbank", "enpara"]),
    ("DenizBank", "Banka & Finans", ["denizbank", "deniz yatirim"]),
    ("TEB", "Banka & Finans", ["turk ekonomi bankasi", "teb arval", "teb yatirim"]),
    ("ING Türkiye", "Banka & Finans", ["ing turkiye", "ing bank", "ing hubs"]),
    ("HSBC Türkiye", "Banka & Finans", ["hsbc"]),
    ("Kuveyt Türk", "Banka & Finans", ["kuveyt turk"]),
    ("Türkiye Finans", "Banka & Finans", ["turkiye finans"]),
    ("Albaraka Türk", "Banka & Finans", ["albaraka"]),
    ("Şekerbank", "Banka & Finans", ["sekerbank"]),
    ("Odeabank", "Banka & Finans", ["odeabank"]),
    ("Allianz Türkiye", "Banka & Finans", ["allianz"]),
    ("AXA Sigorta", "Banka & Finans", ["axa sigorta", "axa hayat"]),
    ("Papara", "Banka & Finans", ["papara"]),
    ("Param", "Banka & Finans", ["param teknoloji", "turkiye param"]),
    ("iyzico", "Banka & Finans", ["iyzico"]),
    ("Borsa İstanbul", "Banka & Finans", ["borsa istanbul"]),
    # --- Telekom ve teknoloji ---
    ("Turkcell", "Telekom & Teknoloji", ["turkcell", "superonline", "turkcell teknoloji", "paycell", "lifecell"]),
    ("Türk Telekom", "Telekom & Teknoloji", ["turk telekom", "turk telekomunikasyon", "argela", "innova bilisim",
                                             "ttnet", "netas"]),
    ("Vodafone Türkiye", "Telekom & Teknoloji", ["vodafone"]),
    ("Trendyol", "Telekom & Teknoloji", ["trendyol"]),
    ("Hepsiburada", "Telekom & Teknoloji", ["hepsiburada", "d market elektronik", "hepsijet", "hepsiexpress"]),
    ("Getir", "Telekom & Teknoloji", ["getir"]),
    ("Yemeksepeti", "Telekom & Teknoloji", ["yemeksepeti", "delivery hero"]),
    ("Insider", "Telekom & Teknoloji", ["insider one", "useinsider", "insider teknoloji"]),
    ("Logo Yazılım", "Telekom & Teknoloji", ["logo yazilim", "logo yazilim sanayi"]),
    ("Peak / Dream Games / Oyun", "Telekom & Teknoloji", ["peak games", "dream games", "rollic", "spyke games",
                                                          "good job games", "codeway"]),
    ("Microsoft", "Telekom & Teknoloji", ["microsoft"]),
    ("Google", "Telekom & Teknoloji", ["google"]),
    ("Amazon", "Telekom & Teknoloji", ["amazon turkiye", "amazon com", "amazon web services", "aws turkiye", "amazon development"]),
    ("Huawei", "Telekom & Teknoloji", ["huawei"]),
    ("Samsung", "Telekom & Teknoloji", ["samsung"]),
    ("IBM", "Telekom & Teknoloji", ["ibm"]),
    ("Oracle", "Telekom & Teknoloji", ["oracle"]),
    ("SAP", "Telekom & Teknoloji", ["sap turkiye", "sap tr"]),
    ("Accenture", "Danışmanlık", ["accenture"]),
    # --- Danışmanlık (Big4) ---
    ("Deloitte", "Danışmanlık", ["deloitte"]),
    ("PwC", "Danışmanlık", ["pwc", "pricewaterhousecoopers"]),
    ("EY", "Danışmanlık", ["ey turkiye", "ernst young", "ernst and young"]),
    ("KPMG", "Danışmanlık", ["kpmg"]),
    # --- Havacılık, lojistik ---
    ("Türk Hava Yolları", "Havacılık & Lojistik", ["turk hava yollari", "turkish airlines", "thy teknik", "thy a o",
                                                   "turkish technic", "turkish cargo", "turkish do co", "ajet",
                                                   "thy opet", "turkish ground services"]),
    ("Pegasus", "Havacılık & Lojistik", ["pegasus"]),
    ("İGA İstanbul Havalimanı", "Havacılık & Lojistik", ["iga istanbul", "iga havalimani", "istanbul havalimani isletmeciligi"]),
    ("Havaş / TAV", "Havacılık & Lojistik", ["havas ground", "havas havalimanlari", "havas hava", "tav havalimanlari", "tav teknoloji", "btaso"]),
    ("Çelebi", "Havacılık & Lojistik", ["celebi hava", "celebi ground"]),
    ("Sabiha Gökçen", "Havacılık & Lojistik", ["sabiha gokcen"]),
    ("Aras Kargo", "Havacılık & Lojistik", ["aras kargo"]),
    ("Yurtiçi Kargo", "Havacılık & Lojistik", ["yurtici kargo"]),
    ("MNG Kargo", "Havacılık & Lojistik", ["mng kargo"]),
    ("Sürat Kargo", "Havacılık & Lojistik", ["surat kargo"]),
    ("PTT", "Havacılık & Lojistik", ["ptt a s", "posta ve telgraf"]),
    ("DHL", "Havacılık & Lojistik", ["dhl"]),
    ("UPS", "Havacılık & Lojistik", ["ups"]),
    ("FedEx", "Havacılık & Lojistik", ["fedex"]),
    ("Maersk", "Havacılık & Lojistik", ["maersk"]),
    ("Ekol Lojistik", "Havacılık & Lojistik", ["ekol lojistik", "ekol uluslararasi"]),
    ("Horoz Lojistik", "Havacılık & Lojistik", ["horoz lojistik"]),
    ("Arkas Holding", "Havacılık & Lojistik", ["arkas"]),
    ("Netlog Lojistik", "Havacılık & Lojistik", ["netlog"]),
    ("Kuehne+Nagel", "Havacılık & Lojistik", ["kuehne nagel", "kuehne"]),
    ("DSV", "Havacılık & Lojistik", ["dsv"]),
    # --- Perakende ---
    ("BİM", "Perakende", ["bim birlesik", "bim magazalar", "bim birlesik magazalar"]),
    ("A101", "Perakende", ["a101", "yeni magazacilik"]),
    ("Metro Türkiye", "Perakende", ["metro turkiye", "metro grosmarket"]),
    ("LC Waikiki", "Perakende", ["lc waikiki"]),
    ("DeFacto", "Perakende", ["defacto"]),
    ("Koton", "Perakende", ["koton"]),
    ("Mavi", "Perakende", ["mavi giyim"]),
    ("Flo / Ziylan", "Perakende", ["flo magazacilik", "ziylan"]),
    ("English Home / Madame Coco", "Perakende", ["english home", "madame coco"]),
    ("IKEA", "Perakende", ["ikea"]),
    ("Decathlon", "Perakende", ["decathlon"]),
    ("MediaMarkt", "Perakende", ["mediamarkt", "media markt"]),
    ("Watsons", "Perakende", ["watsons"]),
    ("Gratis", "Perakende", ["gratis"]),
    ("Rossmann", "Perakende", ["rossmann"]),
    ("Inditex (Zara)", "Perakende", ["inditex", "zara", "pull bear", "bershka", "massimo dutti", "stradivarius"]),
    ("H&M", "Perakende", ["h m group", "h m hennes", "hennes mauritz"]),
    ("Starbucks", "Perakende", ["starbucks"]),
    ("Domino's", "Perakende", ["domino s pizza", "dominos pizza"]),
    ("Burger King / TAB Gıda", "Perakende", ["tab gida", "burger king"]),
    ("Mado", "Perakende", ["mado"]),
    # --- Hızlı tüketim, gıda ---
    ("Unilever", "Hızlı tüketim", ["unilever"]),
    ("Procter & Gamble", "Hızlı tüketim", ["procter gamble", "p g turkiye", "procter and gamble"]),
    ("Nestlé", "Hızlı tüketim", ["nestle"]),
    ("PepsiCo", "Hızlı tüketim", ["pepsico", "frito lay"]),
    ("Coca-Cola", "Hızlı tüketim", ["coca cola"]),
    ("Danone", "Hızlı tüketim", ["danone"]),
    ("Mondelez", "Hızlı tüketim", ["mondelez", "kent gida"]),
    ("Philip Morris", "Hızlı tüketim", ["philip morris", "pmi "]),
    ("JTI", "Hızlı tüketim", ["japan tobacco", "jti "]),
    ("BAT", "Hızlı tüketim", ["british american tobacco"]),
    ("Henkel", "Hızlı tüketim", ["henkel"]),
    ("L'Oréal", "Hızlı tüketim", ["l oreal", "loreal"]),
    ("Reckitt", "Hızlı tüketim", ["reckitt"]),
    ("Colgate-Palmolive", "Hızlı tüketim", ["colgate"]),
    ("Sütaş", "Hızlı tüketim", ["sutas"]),
    ("Banvit / BRF", "Hızlı tüketim", ["banvit"]),
    ("Torku / Konya Şeker", "Hızlı tüketim", ["torku", "konya seker"]),
    # --- Otomotiv, sanayi, enerji ---
    ("Mercedes-Benz Türk", "Otomotiv & Sanayi", ["mercedes benz"]),
    ("Toyota", "Otomotiv & Sanayi", ["toyota"]),
    ("Hyundai", "Otomotiv & Sanayi", ["hyundai"]),
    ("Renault", "Otomotiv & Sanayi", ["renault"]),
    ("Bosch", "Otomotiv & Sanayi", ["bosch"]),
    ("Siemens", "Otomotiv & Sanayi", ["siemens"]),
    ("ABB", "Otomotiv & Sanayi", ["abb elektrik", "abb turkiye", "abb ltd"]),
    ("Schneider Electric", "Otomotiv & Sanayi", ["schneider electric"]),
    ("Philips", "Otomotiv & Sanayi", ["philips"]),
    ("Petrol Ofisi", "Enerji", ["petrol ofisi"]),
    ("Shell", "Enerji", ["shell"]),
    ("BP", "Enerji", ["bp turkiye", "bp petrolleri"]),
    ("İGDAŞ / İBB", "Kamu & Belediye", ["igdas", "iett", "iski", "istanbul buyuksehir", "ibb ", "metro istanbul",
                                        "isbak", "kiptas", "isfalt", "ispark", "boğaziçi yönetim", "bimtas", "beltur"]),
    # --- Savunma ---
    ("Baykar", "Savunma", ["baykar"]),
    ("ASELSAN", "Savunma", ["aselsan"]),
    ("TUSAŞ", "Savunma", ["tusas", "turk havacilik ve uzay"]),
    ("Roketsan", "Savunma", ["roketsan"]),
    ("HAVELSAN", "Savunma", ["havelsan"]),
    ("STM", "Savunma", ["stm savunma"]),
    # --- Sağlık ---
    ("Acıbadem", "İlaç & Sağlık", ["acibadem saglik", "acibadem hastane", "acibadem universitesi", "acibadem labmed"]),
    ("Memorial", "İlaç & Sağlık", ["memorial saglik", "memorial hastane"]),
    ("Medical Park / MLP", "İlaç & Sağlık", ["medical park", "mlp saglik", "liv hospital", "vm medical"]),
    ("Medipol", "İlaç & Sağlık", ["medipol"]),
    ("Florence Nightingale", "İlaç & Sağlık", ["florence nightingale"]),
    ("Pfizer", "İlaç & Sağlık", ["pfizer"]),
    ("Novartis / Sandoz", "İlaç & Sağlık", ["novartis", "sandoz"]),
    ("Roche", "İlaç & Sağlık", ["roche"]),
    ("Sanofi", "İlaç & Sağlık", ["sanofi"]),
    ("AstraZeneca", "İlaç & Sağlık", ["astrazeneca"]),
    ("GSK", "İlaç & Sağlık", ["glaxosmithkline", "gsk "]),
    ("Johnson & Johnson", "İlaç & Sağlık", ["johnson johnson", "janssen"]),
    ("Abbott", "İlaç & Sağlık", ["abbott"]),
    ("Medtronic", "İlaç & Sağlık", ["medtronic"]),
    ("Bayer", "İlaç & Sağlık", ["bayer"]),
    # --- Tesis yönetimi / dış kaynak (büyük işverenler) ---
    ("ISS Türkiye", "Tesis yönetimi", ["iss tesis", "iss hazir yemek", "iss proser", "iss facility"]),
    ("Tepe Grubu", "Tesis yönetimi", ["tepe guvenlik", "tepe tesis", "tepe servis", "tepe insaat", "bilkent holding"]),
    ("Sodexo", "Tesis yönetimi", ["sodexo"]),
    ("Atalian", "Tesis yönetimi", ["atalian"]),
    ("Uluslararası otel zincirleri", "Turizm", ["accor", "hilton", "marriott", "radisson", "wyndham", "hyatt",
                                           "four seasons", "swissotel", "rixos", "titanic hotels"]),
]

_ALIASES: list[tuple[str, str]] = []
for _name, _sector, _als in GROUPS:
    for _a in _als:
        f = fold(_a)
        if f:
            _ALIASES.append((f, _name))
_ALIASES.sort(key=lambda x: -len(x[0]))  # uzun takma ad önce ("yapi kredi yatirim" > "yapi kredi")
_RX = re.compile(r"(?:^| )(" + "|".join(re.escape(a) for a, _ in _ALIASES) + r")(?= |$)")
_BY_ALIAS = dict(_ALIASES)

SECTOR_OF: dict[str, str] = {n: s for n, s, _ in GROUPS}
CATALOG: list[dict] = [{"name": n, "sektor": s} for n, s, _ in GROUPS]


# Bayi, yetkili servis ve distribütörler markanın adını taşır ama o şirketin kendisi değildir
_NOT_THE_COMPANY = re.compile(r"(?:^| )(?:bayi|bayii|bayisi|distributor|distributoru|yetkili servis|car servis|"
                              r"magazasi|plaza|bellona|avm|iletisim magazasi)(?= |$)")


@lru_cache(maxsize=50000)
def group_of(company: str) -> str | None:
    """Şirket adından grup adı; büyük şirket değilse None. ("ARÇELİK A.Ş." → "Koç Topluluğu")"""
    t = fold(company or "")
    if not t or _NOT_THE_COMPANY.search(t):
        return None
    m = _RX.search(t)
    return _BY_ALIAS[m.group(1)] if m else None
