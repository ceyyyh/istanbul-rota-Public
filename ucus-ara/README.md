# Uçuş Ara (`ucus-ara/`)

İstanbul çıkışlı uçuşları **IST ve SAW'dan tek aramada** sorgulayıp fiyata göre sıralayan araç.
Fiyatlar varsayılan olarak TL. Altta [Fli](https://github.com/punitarani/fli) (`flights` paketi, MIT)
var. Fli, Google Flights'ın kendi API'siyle doğrudan konuşur; HTML kazıma ya da tarayıcı yoktur.

## 📱 Telefondan

### A) GitHub uygulaması (kurulum gerektirmez)

1. GitHub uygulamasında depoyu aç → **Actions** → **ucus-ara** → **Run workflow**.
2. Varışı (`LHR`, `AYT`, `ESB`…) ve gidiş tarihini (`2026-12-05`) yaz. İstersen dönüş tarihini,
   "sadece direkt" seçeneğini, kabini ve para birimini de değiştir.
3. 1–2 dakika sonra çalıştırmayı aç; sonuç tablosu **Summary** sayfasında görünür.

### B) Claude'a sordurmak (claude.ai/code, telefondaki Claude uygulamasının Code sekmesi)

Bu depoyla açılan her Claude Code oturumu, kökteki [`.mcp.json`](../.mcp.json) dosyasından
Fli MCP sunucusunu tanır. Sunucu ilk açılışta kendini kurar (`mcp.sh` → `kur.sh`, yaklaşık 1 dakika).
Oturum MCP sunucusunu onaylamanı isteyebilir; onayla. Sonra doğrudan sorabilirsin:

> "5 Aralık'ta İstanbul'dan Londra'ya en ucuz direkt uçuş?"
> "Aralıkta Antalya'ya 3 günlük gidiş-dönüş için en ucuz tarihler?"

Sunucunun araçları: `search_flights` (tek gün, filtreli), `search_dates` (aralıktaki en ucuz günler),
`find_airports` (şehir adından havalimanı kodu).

## 💻 Bilgisayardan

```bash
cd ucus-ara
./baslat.sh LHR 2026-12-05                        # IST + SAW → Londra, en ucuz 10
./baslat.sh LHR 2026-12-05 --donus 2026-12-12     # gidiş-dönüş
./baslat.sh AYT 2026-12-05 --kalkis SAW --aktarmasiz
./baslat.sh JFK 2026-12-05 --sinif BUSINESS --yolcu 2 --para EUR --ilk 5
```

`baslat.sh` ilk çalıştırmada `.venv` kurar. Tarih aralığında en ucuz gün ve çok şehirli rota için
Fli'nin kendi komutları da kullanılabilir:

```bash
.venv/bin/fli dates IST LHR --from 2026-12-01 --to 2026-12-31 --friday --currency TRY
.venv/bin/fli multi -l IST,FCO,2026-12-05 -l FCO,IST,2026-12-10
```

**Claude Desktop:** `claude_desktop_config.json` dosyasına şunu ekle (yolu kendi klonuna göre düzelt):

```json
{ "mcpServers": { "fli": { "command": "bash", "args": ["/TAM/YOL/istanbul-rota-Public/ucus-ara/mcp.sh"] } } }
```

## Bilinen sınırlar

- Gidiş-dönüş aramasında her gidiş seçeneği için ayrı istek atılır. Arka arkaya çok arama yapınca
  Google `HTTP 429` dönebilir; bir dakika bekleyip tekrar dene.
- `ratelimit` bağımlılığı `setuptools` olmadan derlenmiyor, Fli'nin CLI'si de `click` paketini kendisi
  kurmuyor. `kur.sh` ikisini de hallediyor; elle kuracaksan önce `pip install -U setuptools`, sonra
  `pip install -r requirements.txt` çalıştır.

## Testler

```bash
.venv/bin/pip install pytest && .venv/bin/pytest -q tests
```

Testler ağa çıkmaz; sıralama ve çıktı biçimini sınar. PR'larda GitHub Actions testleri ve bir
deneme aramasını çalıştırır.
