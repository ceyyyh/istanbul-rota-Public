# İstanbul Rota

İstanbul Avrupa yakası için tek sayfalık harita/rota uygulaması.

- `npm test` testleri çalıştırır
- `npm run build` dist/index.html üretir

## İstanbul İş İlanları (`is-ilanlari/`)

İstanbul'daki aktif iş ilanlarını iş platformlarından, şirketlerin kendi kariyer sayfalarından ve
İK / dış kaynak firmalarından toplayıp **ilçeye göre filtreleyen** uygulama.
Kurulum ve kullanım: [is-ilanlari/README.md](is-ilanlari/README.md) — kısaca `cd is-ilanlari && ./baslat.sh`

## Uçuş Ara (`ucus-ara/`)

IST ve SAW çıkışlı uçuşları Google Flights'tan (Fli kütüphanesi) arayıp fiyata göre sıralar; ayrıca Claude için
Fli MCP sunucusu `.mcp.json` ile tanımlı. Ayrıntı: [ucus-ara/README.md](ucus-ara/README.md) — kısaca `cd ucus-ara && ./baslat.sh LHR 2026-12-05`
