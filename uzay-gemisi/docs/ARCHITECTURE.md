# AZİM — Mimari ve Ekip Sözleşmesi

Interstellar'daki **Endurance**'tan esinlenen, içinde birinci şahıs (FPS) olarak dolaşılan
3B uzay gemisi. Three.js 0.170 + Vite, saf JavaScript (ES modülleri). Tüm oyun içi metinler **Türkçe**.

> Bu belge paralel çalışan ajanlar arasındaki **sözleşmedir**. API'leri burada yazıldığı gibi koruyun.

---

## 1. Hızlı başlangıç

```bash
cd uzay-gemisi
npm test                 # birim testleri (vitest)
npm run build            # dist/ üretir
npx vite --port 5181 --strictPort &      # her ajan KENDİ portunu kullanır (aşağıya bakın)
node scripts/shot.mjs --url "http://127.0.0.1:5181/?autostart=1&nointro=1&tp=cryo&flags=power_restored&quality=medium" --out shots/x.png
node scripts/walk-check.mjs "http://127.0.0.1:5181/?autostart=1&nointro=1&flags=power_restored&quality=low"   # halka yürünebilir mi?
```

Sunucuyu `NO_HMR=1 npx vite ...` ile başlatırsanız başka ajanların değişiklikleri çekim sırasında sayfayı yeniden yüklemez.
Ekran görüntüsü SwiftShader (CPU) ile alınır: yavaştır (~5–20 sn). Küçük boyut ve `quality=low|medium` kullanın.
`shots/` git'e girmez.

### URL parametreleri
| Parametre | Anlamı |
|---|---|
| `autostart=1` | Başlangıç ekranını atla (fare kilidi yok) |
| `nointro=1` | Giriş sinematiğini atla |
| `tp=<modülId>` | O modülün merkezinde başla |
| `pos=lx,lz,yawDerece` | `tp` ile birlikte: modül içi konum ve bakış. yaw **0 → +X (sonraki modül)**, **90 → dış duvar / uzay (-Z)**, **-90 → iç duvar / hub (+Z)**, 180 → önceki modül |
| `cam=x,y,z,yaw,pitch` | Serbest kamera (dünya koordinatı, derece, noclip). Dış çekimler için |
| `flags=a,b` | Bayrakları başlangıçta doğru yap (ör. `power_restored`) |
| `quality=low\|medium\|high` | Grafik kalitesi |
| `debug=1` | FPS/çizim çağrısı göstergesi, `N` tuşu ile noclip |

Sayfada `window.__game` vardır: `ctx`, `ready` (Promise), `teleport(id, lx, lz, yawDeg)`, `setFlags(...)`,
`hold(code, bool)`, `press(code)`, `simulate(saniye)` (çizim yapmadan mantığı ilerletir).

---

## 2. Koordinat sistemi ve yerleşim (`src/world/ShipLayout.js`)

- Birim: metre. **Y yukarı.** Yer çekimi sabit -Y. Tüm iç zeminler **y = 0**.
- Halka XZ düzleminde, merkezi orijinde, yarıçap `RING_RADIUS = 32`. 12 modül, 30° aralıklarla.
- Modüller arasında ~5.3 m'lik tüp koridorlar (`corridorInfo(i)`: modül i → i+1).
- Merkezde yerleştirme göbeği (hub), tellikler ve kenetlenmiş Ranger/Lander (yürünemez, iç pencerelerden görünür).

### Modül yerel koordinatları (modül yazarları bunu kullanır)
```
           +Z  İÇ DUVAR (hub'a bakar)   z = +3.5
   ┌───────────────────────────────────────────┐
   │                                           │
 kapı  -X (önceki modül)      +X (sonraki) → kapı      x = ±5.5, kapı genişliği 1.6, yüksekliği 2.2
   │                                           │
   └───────────────────────────────────────────┘
           -Z  DIŞ DUVAR (uzaya bakar)  z = -3.5
   İç ölçü: 11 (X) × 7 (Z) × 3.2 (Y), duvar kalınlığı 0.35
```
- **Kapıdan kapıya yürüme yolu açık kalmalı**: z ∈ [-0.9, 0.9], x ∈ [-5.5, 5.5] şeridinde engel koymayın
  (dekoratif şeyler duvarlar boyunca). Tavan 3.2 m.
- Modül sırası (`MODULE_IDS`):

| # | id | Ad | Sahibi |
|---|---|---|---|
| 0 | `command` | Kumanda Modülü (kokpit) — **enerji gelene kadar kilitli** | Ajan 3 |
| 1 | `cryo` | Hiper-Uyku Bölmesi — **oyuncu burada uyanır** | Ajan 3 |
| 2 | `quarters` | Yaşam Alanı | Ajan 3 |
| 3 | `medical` | Revir | Ajan 3 |
| 4 | `lab` | Bilim Laboratuvarı | Ajan 4 |
| 5 | `hydro` | Hidroponik Bahçe (mısır!) | Ajan 4 |
| 6 | `engine` | Motor ve Enerji — **sigorta bulmacası** | Ajan 4 |
| 7 | `robotics` | Robotik Atölye | Ajan 4 |
| 8 | `cargo` | Kargo Ambarı | Ajan 4 |
| 9 | `airlock` | Hava Kilidi / Ranger Rıhtımı | Ajan 4 |
| 10 | `comms` | İletişim — **Dünya'dan mesajlar** | Ajan 3 |
| 11 | `observation` | Gözlem Güvertesi — **teleskop** | Ajan 3 |

---

## 3. Oyun bağlamı `ctx` (main.js kurar)

| Alan | Açıklama |
|---|---|
| `THREE` | three.js modülü |
| `engine` | `Engine`: `renderer`, `scene`, `camera`, `spaceScene`, `spaceCamera`, `composer`, `bloomPass`, `quality`, `qualityName`, `setQuality(name)`, `onUpdate(fn, prio)`, `time` |
| `scene` / `camera` / `renderer` | kısayollar |
| `bus` | `EventBus`: `on(type, fn) → off`, `once`, `emit(type, payload)` |
| `state` | `GameState`: `get(k)`, `is(k)`, `set(k, v=true)`, `when(k, fn)` |
| `input` | `Input`: `enabled`, `actionPressed('interact'|'jump'|...)`, `actionDown`, `isDown(code)`, `wasPressed(code)`, `requestLock()`, `exitLock()`, `isLocked`, `setVirtualMove`, `addLookDelta`, `pressVirtual`, `holdVirtual` |
| `collision` | `CollisionWorld`: `addSegment`, `addCircle`, `addBox(cx,cz,hx,hz,angle,opts)`, `addPolygon`, `addFromObject(obj)`, `setEnabled(c, bool)`, `remove(c)` — tümü **dünya** XZ |
| `lighting` | `LightingManager` (havuzlu ışıklar, güç modu) — bkz. §6 |
| `materials` | paylaşılan malzeme kütüphanesi — bkz. §5 |
| `layout` | `ShipLayout` modülü |
| `player` | `PlayerController`: `position` (ayak), `yaw`, `pitch`, `frozen`, `noclip`, `teleport(x,z,yaw)`, `faceDirection(dirVec3, sn)`, `fovOverride`, `baseFov`, `sensitivity`, `invertY`, `headBob`, `getForward()`, `location {index,id,lx,lz,region}` |
| `interactions` | `InteractionSystem` — bkz. §7 |
| `ui` | `UI` — bkz. §8 |
| `audio` | `AudioManager` — bkz. §9 |
| `space` | `SpaceEnvironment` — `spinSpeed`, `setSpin(radPerSn, rampSn)`, `getBlackHoleDirection(out?)`, `sunLight` |
| `doors` | tüm kapılar (createDoor ekler) |
| `doorOpeners` | otomatik kapıları açan konumlar (Vector3 dizisi; oyuncu + TARS) |
| `ship` | `Ship` (kurulumdan sonra): `modules[]`, `getModule(id)` |
| `flashlight` | `Flashlight`: `on`, `toggle(force?)` — F tuşu; olay `player:flashlight` (bool) |
| `tars` / `missions` / `touch` | oynanış sistemleri |
| `params`, `debug`, `isTouch` | URL parametreleri, hata ayıklama, dokunmatik cihaz |
| `onUpdate(fn(dt, t), priority?)` | her kare çağrılır; `off` fonksiyonu döner |

Güncelleme önceliği: dokunmatik -110, oyuncu -100, etkileşim -50, varsayılan 0, ses 10, arayüz 20, ışıklar 100.

---

## 4. Modül sözleşmesi (`src/world/modules/<id>.js`)

```js
import { buildShell } from '../structure/shell.js';
import { addBox, addCylinder, addMesh } from '../utils.js';

export default {
  id: 'cryo',
  name: 'Hiper-Uyku Bölmesi',
  build(mctx) {
    const M = mctx.materials;
    const shell = buildShell(mctx, { outerWindows: [...], lights: 3 });
    addBox(mctx.group, { size: [1, 0.9, 2], pos: [2, 0.45, -2.5], material: M.metal, collide: true });
    // etkileşim
    const lid = addBox(mctx.group, { ..., dynamic: true });
    mctx.interactions.add(lid, { prompt: 'Kapağı aç', onInteract: () => {...} });
    // animasyon
    mctx.onUpdate((dt, t) => { ... });
  },
};
```

`build(mctx)` **bir kez** çağrılır. `mctx` = `ctx` + şunlar:

| Alan | Açıklama |
|---|---|
| `group` | Modülün kök `THREE.Group`'u — yerel koordinatlarda buraya ekleyin |
| `index`, `id`, `name` | |
| `toWorld(x, y, z)` | yerel → dünya `Vector3` |
| `addLight([x,y,z], { color, intensity, distance, emergency: {color,intensity}\|null, flicker })` | havuzlu nokta ışığı (yerel konum). **Modül başına en fazla 4.** |
| `addEmissive(material, { normal:{color,intensity}, emergency:{color,intensity} })` | güç moduna bağlı parlayan malzeme |
| `playerInside()` | oyuncu bu modülde mi |
| `playerLocal()` | oyuncunun yerel konumu (Vector3) |

Kurulumdan sonra Ship otomatik olarak:
1. `userData.collide = true` olan nesnelerin sınır kutusundan çarpışma engeli üretir (dönmüş kutular dahil;
   gruplar bütün olarak). Zeminden ≤0.3 m yükseklikteki veya kafa üstündeki (>1.8 m'den başlayan) engeller oyuncuyu durdurmaz.
2. Statik meshleri **malzemeye göre birleştirir** (çizim çağrısı ↓). Hareket eden, animasyonlu, malzemesi değişen
   veya etkileşimli her nesne **`userData.dynamic = true`** olmalı (`interactions.add` bunu otomatik yapar; `addBox(..., { dynamic: true })`).
   Dinamik bir grubun altındaki her şey birleştirmeden muaftır.

Hata olursa Ship yedek boş bir kabuk kurar ve konsola yazar — ama hatasız çalışmalı.

### Kabuk API'si (`src/world/structure/shell.js`, Ajan 1)
`buildShell(mctx, opts) → { length, width, height, halfL, halfW, outerZ, innerZ, doors: {start, end}, group }`

| opts | Açıklama |
|---|---|
| `outerWindows: [{x, w, y, h}]` | dış duvarda (uzay) pencereler; x merkez, w genişlik, y alt kenar, h yükseklik. Varsayılan: 2 küçük pencere. `[]` → penceresiz |
| `innerWindows: [{x, w, y, h}]` | iç duvarda (hub tarafı) pencereler. Varsayılan: yok |
| `floor: 'panel'\|'grate'`, `wall: 'light'\|'dark'`, `accent: 0xRRGGBB` | iç görünüm |
| `lights` (varsayılan 3), `lightColor`, `lightIntensity` | tavan lambaları (bunlar addLight kullanır; modül bütçesinden sayılır) |
| `hull: 'white'\|'gold'\|'dark'\|'engine'` | dış gövde stili |
| `lockedUntil: 'bayrak'`, `lockedText` | iki kapı da bayrak doğru olana dek kilitli |
| `doors: false` | kapı oluşturma |

### Kapı API'si (`src/world/structure/door.js`, Ajan 1)
`createDoor(mctx, { pos:[x,y,z], rotY, width, height, lockedUntil, lockedText, auto }) → { group, open(), close(), isOpen, locked, setLocked(bool), position }`

---

## 5. Malzeme kütüphanesi (`src/world/materials.js`, Ajan 1)

`ctx.materials` (= `getMaterials()`) — **adlar sözleşmedir** (yenisi eklenebilir, var olan silinmez/yeniden adlandırılmaz):

- Dış gövde: `hullWhite`, `hullPanel`, `hullGold` (altın termal folyo), `hullDark`, `thruster`
- İç: `panelLight`, `panelMid`, `panelDark`, `floorPanel`, `floorGrate`, `ceiling`, `padding`
- Genel: `metal`, `metalDark`, `aluminium`, `rubber`, `plasticWhite`, `plasticDark`, `fabric`, `fabricBlue`, `handrail`, `cable`, `warning`, `accentOrange`
- Saydam: `glass`, `glassFrosted`
- Işık yayan: `lightPanel`, `emergencyStrip`, `screenGreen`, `screenAmber`, `screenBlue`, `ledRed`, `ledGreen`, `ledAmber`

`createScreen({ width, height, color, background }) → { material, canvas, ctx, texture, draw(fn(g, w, h)) }` — CRT tarzı canvas ekran.
`registerPowerMaterials(M, lighting)` — main.js çağırır; güç moduna bağlı kütüphane malzemelerini kaydeder.

**Malzemeleri yeniden kullanın.** Bir modülde yeni malzeme gerekiyorsa modül dosyasında modül-seviyesinde bir kez oluşturun.

---

## 6. Işıklandırma ve güç

- Gerçek `PointLight` sayısı sabittir (kaliteye göre 4/6/8). `mctx.addLight` sanal ışık ekler; kameraya en yakın olanlar gerçek ışıklara atanır.
  **`visible = false` ile ışık kapatmayın** (shader yeniden derlenir) — `rec.on = false` veya `intensity = 0` kullanın.
- Güç modları: oyun **acil durum** modunda (loş kırmızı) başlar. `state.set('power_restored')` → normal (titreyerek açılır).
  Kendi ışıklarınızda `emergency` tanımı verin (yoksa acil modda kapalıdır). Ekranlar enerji yokken kapalı/“ENERJİ YOK” olabilir:
  `mctx.state.is('power_restored')`, `mctx.state.when('power_restored', fn)`.
- Güneş (kara deliğin diski) `space.sunLight` — yönlü ışık, yüksek kalitede gölge atar; pencerelerden içeri ışık hüzmesi düşer.
- Gölgeler: birleştirilmiş statik meshler gölge atar/alır. Dinamik meshlerde `castShadow/receiveShadow`'u kendiniz açın.

---

## 7. Etkileşim (`ctx.interactions`)

```js
const h = ctx.interactions.add(object3D, {
  prompt: 'Kapsülü aç',            // veya () => 'dinamik metin'
  onInteract: ({ object, hit }) => {},
  enabled: () => true,             // opsiyonel
  distance: 2.6,                   // opsiyonel
  highlight: true,                 // bakınca hafif parlama
});
ctx.interactions.remove(h);
```
Ekran ortasından ışın atılır; **E** (dokunmatikte düğme) ile tetiklenir. Arayüz `[E] prompt` gösterir.

---

## 8. Arayüz API'si (`ctx.ui`, Ajan 6)

| Metot | Açıklama |
|---|---|
| `showPrompt(text\|null)` | etkileşim ipucu (InteractionSystem çağırır) |
| `toast(text, ms?)` | kısa bildirim |
| `subtitle(speaker, text, ms?)` | altyazı / diyalog satırı |
| `setObjective(text\|null)` | aktif görev |
| `openTerminal({ title, lines: string[], options: [{label, action}], onClose, color? })` → `{ close(), setLines(lines) }` | retro yeşil terminal. `action()` `false` döndürmezse kapanır. Klavye: 1–9, W/S/↑/↓ + E/Enter, Q/Backspace kapat; fare ile tıklanabilir |
| `openDialog({ speaker, text, options })` | karakter diyaloğu (TARS) |
| `fade(toBlack, ms?) → Promise` | ekran karartma |
| `isModalOpen()` | |
| `showStart(onStart)`, `showEnding(text)` | |

Modal açıkken arayüz `input.enabled = false` yapar (oyuncu donar) ve `bus.emit('ui:modal', { open })` yayar.
Esc ile fare kilidi kaybolunca (modal yokken) duraklatma menüsü gösterilir.

---

## 9. Ses API'si (`ctx.audio`, Ajan 6) — tamamen prosedürel WebAudio

`unlock()`, `play(name, { volume, position })`, `setAmbient('emergency'|'normal'|null)`, `speak(text, { voice: 'tars' }) → Promise`,
`setMasterVolume(v)`, `setMusicVolume(v)`, `update(dt)`.

Ses adları: `beep`, `click`, `switch`, `door`, `door_locked`, `hiss`, `airlock`, `footstep`, `alarm`, `power_up`, `power_down`,
`error`, `success`, `tick`, `spin_up`, `terminal`, `servo`.
Bilinmeyen adlar sessizce yok sayılır.

---

## 10. Olaylar (`ctx.bus`)

| Olay | Yük |
|---|---|
| `game:start` | — |
| `player:footstep` | `{ index, sprint }` |
| `player:module` | `{ index, id, prev }` |
| `player:jump`, `player:land` | — |
| `door:open` / `door:close` / `door:locked` | `{ door, position }` |
| `interact` | `{ id, object }` |
| `state:changed` | `{ key, value, prev }` |
| `state:<bayrak>` | `value` |
| `pointerlock:change` | `bool` |
| `engine:quality` | `{ name, quality }` |
| `ui:modal` | `{ open }` |
| `tars:say` | `{ text }` |

---

## 11. Görev akışı ve bayraklar

Oyuncu hiper-uykudan uyanır; gemi acil durum enerjisindedir.

| # | Görev (arayüzde) | Tamamlayan bayrak | Kim ayarlar |
|---|---|---|---|
| 0 | (giriş sinematiği) | `intro_done` | Missions (Ajan 5) |
| 1 | TARS ile konuş | `talked_tars` | Tars (Ajan 5) |
| 2 | Motor modülünde sigorta panelini sıfırla, enerjiyi geri getir | `power_restored` | engine.js (Ajan 4) |
| 3 | İletişim modülünde Dünya'dan gelen mesajları dinle | `messages_read` | comms.js (Ajan 3) — enerji gerekir |
| 4 | Kumanda modülünde halka dönüşünü başlat | `ring_spinning` | command.js (Ajan 3) — modül enerjiye kadar kilitli |
| 5 | Gözlem güvertesinden teleskopla Gargantua'yı incele | `blackhole_observed` | observation.js (Ajan 3) |
| 6 | (son) | `mission_complete` | Missions (Ajan 5) |
| — | Gizli: kitaplıktaki Mors mesajı "KAL" | `found_morse` | quarters.js (Ajan 3) |

Bayraklar herhangi bir sırada gelebilir; Missions buna dayanıklı olmalı.

---

## 12. Görsel stil rehberi (Interstellar)

- **Dış gövde (Endurance):** dikdörtgen kutu modüller, beyaz/açık gri paneller, bazı yüzeylerde buruşuk **altın termal folyo**,
  koyu gri/siyah kafes kirişler, tüp bağlantılar, küçük RCS iticileri (4'lü nozullar), antenler. Sade, işlevsel, NASA gerçekçiliği.
- **İç mekân:** pratik ve “kullanılmış” — kirli beyaz/bej dolgulu paneller, gri metal çerçeveler, açıkta kaburgalar, tutunma
  korkulukları, kablo demetleri, ayak tutucular, Türkçe şablon etiketler (ör. “BASINÇ”, “DİKKAT”, “HİDROJEN”). Küçük ekranlar
  yeşil/amber monokrom metin. Kapaklı (guard'lı) mekanik anahtarlar. Normal ışık sıcak beyaz; acil durumda loş kırmızı.
- **Kokpit:** iki pilot koltuğu büyük pencerelere bakar, tavanda anahtar panelleri, orta konsol, kumanda kolları.
- **Hiper-uyku:** yatay kapsüller, buzlu cam kapaklar, sütlü beyaz sıvı içinde uyuyan mürettebat silüetleri.
- **TARS:** 4 adet ~1.6 m'lik dikdörtgen fırçalanmış alüminyum blok, ortada küçük ekran şeridi; blokları döndürerek yürür.
  Mizah ayarı (%), dürüstlük ayarı (%). **Filmden replik kopyalamayın** — özgün Türkçe espriler yazın.
- **Uzay:** çok karanlık, seyrek yıldızlar; **Gargantua**: ince yığılma diski + diskin arka yüzünün kütleçekimsel merceklenmeyle
  karadeliğin üstünden ve altından bükülerek görünen hâlesi; sıcak beyaz-turuncu. Satürn + küresel solucan deliği (mercek küresi),
  Miller (okyanus) ve Mann (buz) gezegenleri.
- **Ses:** org benzeri ağır, sabırlı pedal tonlar (özgün, prosedürel), saatin tıkırtısı, gemi uğultusu.

---

## 13. Performans kuralları

- Modül başına hedef: ≤ 40k üçgen, ≤ 25 dinamik nesne, ≤ 4 `addLight`. Silindir segmentleri ≤ 24.
- Kütüphane malzemelerini paylaşın; canvas dokuları ≤ 1024 px; her karede yeni nesne (`new Vector3`) yaratmayın.
- `onUpdate` içindeki ağır işleri oyuncu yakındaysa yapın (`mctx.playerInside()` veya mesafe kontrolü).
- Nokta ışıkları gölge atmaz. Yeni `PointLight`/`SpotLight` eklemeyin — `addLight` kullanın
  (istisna: oyuncunun el feneri gibi tek, kalıcı ışıklar; sayıları değişmemeli).

---

## 14. Ekip kuralları

1. **Sadece kendi dosyalarınızı düzenleyin** (aşağıdaki tablo). Başkasının dosyasında değişiklik gerekiyorsa kendi
   dosyanızda geçici bir çözüm yapın ve son raporunuzda “istenen değişiklik” olarak yazın.
2. **Yeni npm bağımlılığı eklemeyin.** `git commit/push` yapmayın (koordinatör yapar).
3. Paylaşılan bir dosyayı her kaydettiğinizde çalışır hâlde bırakın (diğer ajanlar aynı anda kullanıyor).
4. Bitirmeden önce: `npm test` geçmeli, `npm run build` hatasız olmalı, kendi alanınızın ekran görüntüsünü alıp **bakın**,
   tarayıcı konsolunda hata olmamalı. `walk-check` halkanın yürünebilir olduğunu doğrulamalı.
5. Kod yorumları ve oyun metinleri Türkçe; değişken adları İngilizce olabilir.

| Sahip | Dosyalar |
|---|---|
| Koordinatör | `src/main.js`, `src/core/*`, `src/player/*`, `src/interaction/*`, `src/world/{Ship,ShipLayout,Lighting,utils}.js`, `src/world/modules/index.js`, `index.html`, `package.json`, `vite.config.js`, `scripts/shot.mjs`, `docs/` |
| Ajan 1 — Yapı & Dış Gövde | `src/world/materials.js`, `src/world/structure/**`, `src/world/exterior/**` |
| Ajan 2 — Uzay & Görsel Efekt | `src/space/**` |
| Ajan 3 — Mürettebat Modülleri | `src/world/modules/{command,cryo,quarters,medical,comms,observation}.js`, `src/world/modules/crew/**` |
| Ajan 4 — Teknik Modüller | `src/world/modules/{lab,hydro,engine,robotics,cargo,airlock}.js`, `src/world/modules/tech/**` |
| Ajan 5 — TARS & Oynanış | `src/gameplay/**` |
| Ajan 6 — Arayüz & Ses | `src/ui/**`, `src/audio/**` |
| Ajan 7 — Test & QA | `tests/**`, `playwright.config.js`, `scripts/walk-check.mjs`, `scripts/qa-*.mjs` |

Geliştirme sunucusu portları: Ajan 1 → 5181, Ajan 2 → 5182, … Ajan 7 → 5187.

---

## 15. Bölüm 2: Miller gezegeni ve mürettebat

### Dünyalar (`src/core/WorldManager.js`, koordinatör)
- `ctx.world.current` → `'ship' | 'planet'`, `ctx.world.isPlanet()`, `await ctx.world.go(name, { spawn:{x,z,yaw}, onDark, holdMs })`
  (karartır, gizler/gösterir, ışınlar, açar). Olay: `world:change { from, to }`.
- Gezegen aynı sahnede, `PLANET_ORIGIN = { x: 4000, z: 0 }`'da kurulur. Zemin yine y = 0 (diz altı sığ su).
  Gezegendeyken gemi gizlenir, uzay geçişi kapanır (gökyüzü kubbesi onun yerini alır), uzay güneşi sönük olur,
  `player.location.region === 'planet'`.
- `?world=planet` → doğrudan gezegende başla (geliştirme).

### Gezegen (`src/planet/**`, Ajan G) — `ctx.planet`
`root`, `setActive(bool)`, `envIntensity`, `spawn` (dünya), `points { ranger, wreck, beacon }` (dünya),
`toWorld(x,z)`, `objects { beacon, debris, ramp }` (etkileşim için THREE nesneleri; etkileşimi Hikâye ajanı ekler),
`wave { active, distance, height, start({ fromDistance, speed }), stop(), reset() }`, `update(dt,t)`.
Olaylar: `planet:wave_warning`, `planet:wave_hit`, `planet:wave_passed`.

### Mürettebat (`src/gameplay/crew/**`, Ajan M) — `ctx.crew`
Kadro: `ela` (Dr. Ela Yıldız, biyolog, iniş ekibi), `doruk` (Doruk Aral, görev uzmanı, iniş ekibi),
`rami` (Prof. Rami Kaya, fizikçi, gemide kalır; dönüşte 23 yıl yaşlanmış).
`crew.get(id)` → `npc`: `group`, `placeAt(x,z,yaw)`, `setPose('idle'|'walk'|'sit'|'type'|'run'|'wave')`,
`walkTo(x,z,{speed,run}) → Promise`, `follow(vec3|null,{distance})`, `lookAt(x,z)`, `say(text,ms)`,
`setAged(bool)`, `setVisible(bool)`, `talk = { prompt, onTalk }` (görev akışı değiştirebilir). Olay: `crew:talk { id }`.

### Görev akışı (devam) — Ajan S (Hikâye)
Bölüm 1 (`blackhole_observed`'a kadar) aynı kalır; artık orada **bitmez**.

| # | Görev | Bayrak |
|---|---|---|
| 6 | Hava kilidinde iniş ekibine katıl, Ranger'a bin | `ranger_launched` |
| 7 | (iniş sinematiği) Miller gezegeni | `miller_landed` |
| 8 | Enkazdaki veri kaydedicisini bul | `beacon_found` |
| 9 | Enkaza sıkışan Ela'ya yardım et | `ela_rescued` |
| 10 | Dalga gelmeden Ranger'a koş | `wave_escaped` (dalga yakalarsa son kontrol noktasından tekrar) |
| 11 | (kalkış sinematiği) gemiye dönüş — 23 yıl geçmiştir | `returned_to_ship` |
| 12 | Yaşlanmış Rami ile konuş | `rami_met` |
| 13 | İletişimde 23 yıllık mesajları dinle | `messages_23y_read` |
| 14 | (son) | `mission_complete` |

Gezegende HUD'da zaman genişlemesi sayacı: gezegende geçen her saniye ≈ Dünya'da 0,7 gün (1 saat = 7 yıl).
Ölüm yok: dalga yakalarsa karartma + kontrol noktasından tekrar.

### Sahiplik (Bölüm 2)
| Sahip | Dosyalar |
|---|---|
| Koordinatör | `src/core/WorldManager.js`, `src/main.js`, `Ship.setVisible` |
| Ajan G — Gezegen | `src/planet/**` |
| Ajan M — Mürettebat | `src/gameplay/crew/**` |
| Ajan S — Hikâye | `src/gameplay/Missions.js`, `src/gameplay/story/**`, `src/gameplay/Tars.js` (gezegen takip kipi), `src/world/modules/airlock.js` (binme), `src/world/modules/comms.js` (23 yıllık mesajlar), `src/ui/**` (zaman sayacı vb. küçük eklemeler), `src/audio/**` (yeni ses adları) |
