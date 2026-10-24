# Uçuş Ara (`ucus-ara/`)

İstanbul çıkışlı uçuşları **IST ve SAW'dan birlikte** arayıp fiyata göre sıralayan küçük bir araç.
Altta [Fli](https://github.com/punitarani/fli) (`pip install flights`, MIT lisanslı) kullanılır. Fli,
Google Flights'ın kendi API'siyle doğrudan konuşur; HTML kazıma ya da tarayıcı otomasyonu yoktur.

## 1. Komut satırı

```bash
cd ucus-ara
./baslat.sh LHR 2026-12-05                          # IST + SAW → Londra, en ucuz 10
./baslat.sh AYT 2026-12-05 --kalkis SAW --aktarmasiz
./baslat.sh JFK 2026-12-05 --sinif BUSINESS --yolcu 2 --ilk 5
```

`baslat.sh` ilk çalıştırmada `.venv` kurar. Gidiş-dönüş, tarih aralığında en ucuz gün ve çok
şehirli rota için Fli'nin kendi komutları:

```bash
.venv/bin/fli flights IST LHR 2026-12-05 --return 2026-12-12 --currency TRY
.venv/bin/fli dates IST LHR --from 2026-12-01 --to 2026-12-31 --friday
.venv/bin/fli multi -l IST,FCO,2026-12-05 -l FCO,IST,2026-12-10
```

> Not: `ucus.py` fiyatları Fli'nin varsayılan para biriminde (USD) gösterir.

## 2. MCP sunucusu: Claude'a uçuş aratmak

Fli bir MCP sunucusu da içerir. Bu sunucu iki araç sunar: `search_flights` (tek gün arama,
filtreli) ve `search_dates` (aralıktaki en ucuz günler). Bağlandığında Claude'a
"5 Aralık'ta İstanbul'dan Londra'ya en ucuz direkt uçuş?" diye doğrudan sorabilirsin.

**Claude Code:** Depo kökündeki [`.mcp.json`](../.mcp.json) dosyası sunucuyu `uvx` ile başlatır
([uv](https://docs.astral.sh/uv/) kurulu olmalı). Depoyu açınca Claude Code bu sunucuyu
onaylamanı ister. Elle eklemek için:

```bash
claude mcp add fli -- uvx --from flights fli-mcp
```

**Claude Desktop:** Önce `pipx install flights`, ardından `claude_desktop_config.json` dosyasına:

```json
{ "mcpServers": { "fli": { "command": "fli-mcp" } } }
```

`fli-mcp` PATH'te değilse tam yolunu yaz (ör. `~/.local/bin/fli-mcp`). HTTP üzerinden
çalıştırmak için `fli-mcp-http` kullanılır; adres `http://127.0.0.1:8000/mcp/` olur.

## Testler

```bash
.venv/bin/pip install pytest && .venv/bin/pytest -q tests
```

Testler ağa çıkmaz; yalnızca sıralama ve çıktı biçimini sınar.
