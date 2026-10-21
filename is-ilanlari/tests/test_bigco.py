from isilan.bigco import CATALOG, group_of


def test_subsidiaries_map_to_their_group():
    assert group_of("ARÇELİK A.Ş.") == "Koç Topluluğu"
    assert group_of("Otokoç Otomotiv") == "Koç Topluluğu"
    assert group_of("Carrefoursa Carrefour Sabancı Ticaret Merkezi A.Ş.") == "Sabancı Holding"
    assert group_of("Migros Ticaret A.Ş.") == "Anadolu Grubu"
    assert group_of("Anadolu Hayat Emeklilik") == "İş Bankası Grubu"
    assert group_of("ING Hubs Türkiye") == "ING Türkiye"
    assert group_of("Baykar Makina San ve Tic AŞ") == "Baykar"
    assert group_of("BİM Birleşik Mağazalar A.Ş") == "BİM"


def test_lookalikes_and_dealers_are_not_matched():
    assert group_of("KASTAMONU DOĞUŞ İNŞAAT SANAYİ TİCARET LTD ŞTİ") is None
    assert group_of("Amazon Spor Ve Eğlence Merkezleri İşletmeciliği") is None
    assert group_of("Havas Engage İstanbul") is None
    assert group_of("Tek Kim Otomotiv Bosch Car Servis") is None
    assert group_of("Vodafone İstanbul Şişli Zanes İletişim Mağazası") is None
    assert group_of("Bimeks Bilgi İşlem") is None          # "bim" tek başına eşleşmez
    assert group_of("Şok Etkisi Reklam") is None           # "şok" tek başına eşleşmez
    assert group_of("") is None


def test_catalog_is_unique():
    names = [c["name"] for c in CATALOG]
    assert len(names) == len(set(names)) and len(names) > 150


def test_focus_region_employers():
    from isilan.bigco import GROUPS, ODAK
    assert ODAK <= {n for n, _, _ in GROUPS}
    assert group_of("Ericsson Telekomünikasyon A.Ş.") == "Ericsson"
    assert group_of("AXA Sigorta") == "AXA Sigorta"
    assert group_of("Zorlu Enerji") == "Zorlu Holding"
    assert group_of("EY Türkiye") == "EY"
    assert group_of("Turkcell İletişim Hizmetleri") == "Turkcell"
    assert group_of("Akbank T.A.Ş.") == "Sabancı Holding"
    assert group_of("Garanti BBVA Teknoloji") == "Garanti BBVA"


def test_focus_aliases_have_no_false_positives():
    for name in ("Taxation Consulting", "Axa Plastik Ltd", "Zorluoğlu İnşaat", "Ericssonlar Kafe",
                 "Seyahat Acentesi", "Googler Ltd", "KPMGX Danışmanlık", "Samsunspor Kulübü"):
        assert group_of(name) is None, name
