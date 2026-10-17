# İstanbul İş İlanları

İstanbul'daki aktif iş ilanlarını **tek yerde** toplayan ve **ilçeye göre filtreleyen** program.
Üç tür kaynağı tarar:

| Tür | Kaynaklar |
|---|---|
| **İş platformları** | Kariyer.net, LinkedIn, Indeed, Yenibiris, SecretCV, Eleman.net, İşbul.net, İşin Olsun, Youthall, Techcareer.net, İŞKUR, Toptalent, Coderspace, Glassdoor, Careerjet, Jooble |
| **Şirketlerin kendi kariyer sayfaları** | ~125 şirket (Trendyol, iyzico, Insider, Dream Games, Peak, Midas, Getir, Koç Grubu, Pfizer, Unilever, Bosch…): Greenhouse, Lever, Workable, SmartRecruiters, Ashby, Recruitee, Teamtailor, Personio, Breezy, Workday, Oracle API'leri + genel kariyer sayfası tarayıcısı |
| **İK / dış kaynak firmaları** | Randstad, Michael Page, Adecco, Gi Group, ManpowerGroup ve kayıt defterindeki diğer ajanslar |

Her ilan için konum metninden **39 ilçeden hangisi olduğu** tespit edilir (600+ mahalle/semt/plaza/OSB
eşlemesi: Maslak→Sarıyer, Kozyatağı→Kadıköy, İkitelli→Başakşehir, Kurtköy→Pendik …). Aynı ilan birden
çok sitede yayınlandıysa tek kartta birleştirilir ("+2 kaynakta daha"). Yayından kalkan ilanlar bir sonraki
taramada otomatik olarak pasife alınır, böylece yalnızca **aktif** ilanlar görünür.

## Kurulum ve çalıştırma

Gereken tek şey Python 3.11+ (internet bağlantısı olan kendi bilgisayarınızda çalıştırın).

**En kolay yol** — çift tıkla / tek komut (sanal ortamı kurar, taramayı başlatır, arayüzü açar):

```bash
./baslat.sh          # macOS / Linux
baslat.bat           # Windows
```

Sonra tarayıcıda **http://127.0.0.1:8000** adresini açın. İlk tarama arka planda sürerken ilanlar
gelmeye başlar; "Kaynaklar" sekmesinden hangi sitenin kaç ilan getirdiğini görebilirsiniz. Program açık
kaldıkça 6 saatte bir kendiliğinden yeniden tarar.

**Elle:**

```bash
cd is-ilanlari
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

python -m isilan crawl                  # tüm kaynakları tara (ilk sefer 20-40 dk sürebilir)
python -m isilan serve                  # web arayüzü → http://127.0.0.1:8000
```

## Komutlar

```bash
python -m isilan crawl                          # her şeyi tara
python -m isilan crawl kariyernet linkedin      # yalnızca bazı kaynaklar
python -m isilan crawl agency                   # yalnızca İK firmaları (platform / company / agency)
python -m isilan crawl "lever:*"                # Lever kullanan tüm şirketler
python -m isilan crawl --browser                # bot korumalı siteleri Playwright ile de dene
python -m isilan crawl --gorunur                # tarayıcıyı görünür pencerede aç (Kariyer.net için en iyisi)

python -m isilan list --ilce Kadıköy --ilce Ataşehir -q yazılım --gun 7 --url
python -m isilan list --yaka anadolu --tur company
python -m isilan ilceler                        # ilçe başına ilan sayısı
python -m isilan export --ilce Beşiktaş --out besiktas.csv     # Excel'de açılır (; ayraçlı, UTF-8)
python -m isilan export --format json --out ilanlar.json
python -m isilan build-site --out site/index.html   # sunucusuz, tek dosyalık paylaşılabilir sayfa
python -m isilan -v sources                     # kaynakların son tarama durumu ve hataları

python -m isilan add-company "Şirket Adı"       # Greenhouse/Lever/Workable/... üzerinde arar ve ekler
python -m isilan add-url "Şirket" https://sirket.com/kariyer   # kendi kariyer sayfası olan şirket
```

İlçe adlarını Türkçe karakter olmadan da yazabilirsiniz (`--ilce kadikoy`).

## Web arayüzü

- **İlçe filtresi**: Avrupa / Anadolu yakası grupları, ilçe başına ilan sayısı, çoklu seçim, ilçe arama,
  "ilçesi belirsiz ilanları da göster" seçeneği
- Arama, kaynak türü, tek tek kaynaklar, çalışma şekli (uzaktan/hibrit/ofis), yayın tarihi, sıralama
- Filtreler adres çubuğunda saklanır → bağlantıyı paylaşınca aynı görünüm açılır
- **Kaynaklar** sekmesi: her kaynağın durumu, ilan sayısı, son hata; tek kaynağı yeniden tarama
- Telefonda da çalışır, koyu tema destekler

## İsteğe bağlı ayarlar

| Ne | Nasıl |
|---|---|
| Bot korumalı siteler (Kariyer.net, Glassdoor, İşin Olsun, Coderspace) | `pip install playwright && python -m playwright install chromium`, sonra `crawl --browser` (ya da `--gorunur`) |
| Jooble | Ücretsiz anahtar: https://tr.jooble.org/api/about → `export JOOBLE_API_KEY=...` |
| Careerjet API | Yayıncı hesabı → `export CAREERJET_API_KEY=...` (yoksa HTML sayfaları denenir) |
| Kendi şirket listeniz | `data/companies.local.json` (aynı biçim; `add-company`/`add-url` buraya yazar) |
| Veritabanı yeri | `--db yol/isilan.db` ya da `ISILAN_DB` ortam değişkeni |
| Daha nazik tarama | `crawl --interval 2` (aynı siteye iki istek arası saniye) |

## Bir siteden az ilan geliyorsa

**Hepsini tek seferde:** `hepsini-yap.bat` (Windows) ya da `./hepsini-yap.sh` — ya da `python -m isilan tam`.
Aşağıdaki adımları sırayla uygular: teşhis → derin tarama (400 sayfa) → korumalı siteler görünür tarayıcıyla →
hâlâ sorunlu kaynakların dosyalarını `data/teshis.zip` içinde toplar. Bitince arayüz açılır.
İlk çalıştırma uzun sürebilir (1-2 saat); tarayıcı penceresi açılırsa ve doğrulama isterse siz tamamlayın.

Adımları elle yapmak isterseniz:

1. **Teşhis edin:** `python -m isilan teshis kariyernet linkedin` (ya da tüm platformlar için `teshis platform`).
   Her kaynak için kısa bir tarama yapar ve nedenini söyler: *engelliyor*, *sayfa geldi ama ayrıştırılamadı*,
   *İstanbul olarak tanınmadı*, *bağlanılamadı*. Ham sayfalar `data/teshis/<kaynak>/` klasörüne kaydedilir.
   Bu klasörü zip'leyip paylaşırsanız ayrıştırıcı gerçek sayfaya göre düzeltilebilir.
2. **Bot koruması varsa** (Kariyer.net, Indeed, Glassdoor): `python -m isilan crawl kariyernet --gorunur`.
   Tarayıcı görünür açılır; doğrulama sayfası çıkarsa **siz** pencerede tamamlarsınız. Çerezler
   `data/tarayici-profili/` içinde saklandığı için sonraki taramalarda genellikle tekrar gerekmez.
3. **Sayfa sınırı:** büyük sitelerde varsayılan 150 sayfa yetmeyebilir: `crawl kariyernet --max-pages 600 --timeout 3600`.
4. **LinkedIn** tek aramada en fazla ~1000 ilan döndürür; program bu sınıra ulaşınca otomatik olarak
   39 ilçeyi ayrı ayrı arar (son 30 günün ilanları).
5. **Resmî API'si olanlar** için anahtar alın (Jooble, Careerjet) — en sağlam yol budur.

## Önemli notlar (lütfen okuyun)

- **Canlı sitelerde henüz denenmedi.** Program, internete kısıtlı erişimi olan bir bulut ortamında
  geliştirildi; iş sitelerine bağlanılamadığı için her kaynağın ayrıştırıcısı, araştırılan gerçek
  sayfa/API yapısını taklit eden test verileriyle doğrulandı (250'den fazla otomatik test). Bazı sitelerin
  yapısı tahminden farklı çıkabilir. İlk taramadan sonra **Kaynaklar** sekmesine bakın: "hatalı" ya da
  "ilan yok" görünen kaynaklar düzeltilmesi gerekenlerdir. Bir kaynağın bozulması diğerlerini etkilemez.
- Tahmini güvenilirlik: ATS API'leri (Greenhouse, Lever, Recruitee, Personio…) ve LinkedIn **yüksek**;
  Yenibiris, Eleman.net, Youthall, Techcareer, Randstad **orta-yüksek**; Kariyer.net (PerimeterX bot
  koruması → `--gorunur` önerilir), Indeed, Glassdoor, Careerjet HTML, İşin Olsun, Coderspace **düşük**.
- Siteleri yormamak için her alan adına en fazla saniyede bir istek gönderilir. Sitelerin kullanım
  koşullarına uymak kullanıcının sorumluluğundadır; verileri kişisel iş araması için kullanın.
- Şirket listesi (`data/companies.json`) web araştırmasıyla derlendi; `confidence` alanı ne kadar emin
  olunduğunu gösterir. Hatalı bir giriş yalnızca o kaynakta "hatalı" durumu üretir.

## Geliştirme

```bash
pip install pytest
python -m pytest -q                       # tüm testler (ağ kullanmaz)
python tools/mock_server.py --port 8765   # arayüzü sahte verilerle dene
```

Yapı:

```
isilan/
  models.py       ortak Job modeli
  geo.py          İstanbul ilçe/mahalle sözlüğü ve eşleştirici
  pipeline.py     paralel tarama, İstanbul süzgeci, ilçe tespiti, tekilleştirme
  db.py           SQLite deposu ve sorgular
  web.py          JSON API + arayüz sunucusu (yalnızca standart kütüphane)
  browser.py      Playwright yedeği (engellenen sayfalar)
  jsonld.py       schema.org JobPosting okuyucu
  sources/
    platforms/    iş platformları (her site ayrı modül)
    ats.py        ATS API bağdaştırıcıları + şirket kayıt defteri
    careerpage.py genel kariyer sayfası tarayıcısı (JSON-LD + gömülü ATS tespiti)
    agencies.py   İK / dış kaynak firmaları
  static/index.html  web arayüzü
data/companies.json  şirket → ATS kayıt defteri
```

Yeni bir kaynak eklemek için `sources/` altına `sources() -> list[Source]` döndüren bir modül yazmanız
yeterli; `Source.fetch` bir `Job` üreteci döndürür.
