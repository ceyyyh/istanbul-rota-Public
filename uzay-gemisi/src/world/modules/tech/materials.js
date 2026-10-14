import * as THREE from 'three';

/**
 * Teknik modüllerin (lab, hydro, engine, robotics, cargo, airlock) paylaştığı ek malzemeler.
 * Kütüphane malzemeleri (ctx.materials) yetmediğinde burada BİR KEZ oluşturulur ve tüm teknik
 * modüllerde yeniden kullanılır (aynı malzeme = statik birleştirmede tek çizim çağrısı).
 *
 * Canvas dokuları yalnızca tarayıcıda üretilir (node/vitest ortamında doku yok, renk var).
 */
let lib = null;

const hasDOM = typeof document !== 'undefined';

function std(name, color, roughness = 0.6, metalness = 0, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  m.name = name;
  return m;
}

function canvasTex(w, h, paint, { repeat = false, srgb = true } = {}) {
  if (!hasDOM) return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  paint(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Basit tekrarlanabilir gürültü (deterministik) */
function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Sarı-siyah çapraz tehlike şeridi (tekrarlı; UV 1 birim = 0.3 m önerilir) */
function hazardTexture() {
  return canvasTex(
    128,
    128,
    (g, w, h) => {
      g.fillStyle = '#d6a019';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#151515';
      for (let i = -2; i < 4; i++) {
        g.beginPath();
        g.moveTo(i * 64, 0);
        g.lineTo(i * 64 + 32, 0);
        g.lineTo(i * 64 + 32 + 128, 128);
        g.lineTo(i * 64 + 128, 128);
        g.closePath();
        g.fill();
      }
      // aşınma
      const r = rng(7);
      for (let i = 0; i < 260; i++) {
        g.fillStyle = r() > 0.5 ? 'rgba(60,55,45,0.35)' : 'rgba(230,220,190,0.18)';
        g.fillRect(r() * w, r() * h, 1 + r() * 4, 1 + r() * 2);
      }
    },
    { repeat: true },
  );
}

/** Kadran yüzü (basınç göstergesi): beyaz kadran, çentikler, kırmızı bölge */
function gaugeTexture() {
  return canvasTex(256, 256, (g, w) => {
    const c = w / 2;
    g.fillStyle = '#ebe6d8';
    g.beginPath();
    g.arc(c, c, c - 2, 0, Math.PI * 2);
    g.fill();
    const a0 = (-225 * Math.PI) / 180; // canvas açısı: 0 = +x, saat yönü
    const span = (270 * Math.PI) / 180;
    // kırmızı bölge (son %20)
    g.strokeStyle = '#c0281c';
    g.lineWidth = 14;
    g.beginPath();
    g.arc(c, c, c - 26, a0 + span * 0.8 + Math.PI / 2, a0 + span + Math.PI / 2);
    g.stroke();
    // yeşil bölge
    g.strokeStyle = '#3d8a3a';
    g.beginPath();
    g.arc(c, c, c - 26, a0 + span * 0.35 + Math.PI / 2, a0 + span * 0.7 + Math.PI / 2);
    g.stroke();
    g.strokeStyle = '#1b1b1b';
    for (let i = 0; i <= 20; i++) {
      const a = a0 + (span * i) / 20 + Math.PI / 2;
      const r0 = i % 5 === 0 ? c - 44 : c - 34;
      g.lineWidth = i % 5 === 0 ? 4 : 2;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
      g.lineTo(c + Math.cos(a) * (c - 18), c + Math.sin(a) * (c - 18));
      g.stroke();
    }
    g.fillStyle = '#1b1b1b';
    g.font = 'bold 26px "DejaVu Sans", sans-serif';
    g.textAlign = 'center';
    g.fillText('kPa', c, c + 62);
    g.font = 'bold 20px "DejaVu Sans", sans-serif';
    for (let i = 0; i <= 4; i++) {
      const a = a0 + (span * i) / 4 + Math.PI / 2;
      g.fillText(String(i * 50), c + Math.cos(a) * (c - 66), c + Math.sin(a) * (c - 66) + 7);
    }
    // kir lekesi
    const grd = g.createRadialGradient(c * 1.3, c * 0.7, 4, c * 1.3, c * 0.7, c);
    grd.addColorStop(0, 'rgba(120,100,60,0.18)');
    grd.addColorStop(1, 'rgba(120,100,60,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, w);
  });
}

/** Delikli alet panosu (pegboard) */
function pegboardTexture() {
  return canvasTex(
    128,
    128,
    (g, w, h) => {
      g.fillStyle = '#6e6a60';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#26241f';
      for (let y = 8; y < h; y += 16) for (let x = 8; x < w; x += 16) {
        g.beginPath();
        g.arc(x, y, 2.6, 0, Math.PI * 2);
        g.fill();
      }
    },
    { repeat: true },
  );
}

/** Kargo ağı (alfa testli) */
function netTexture() {
  return canvasTex(
    128,
    128,
    (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = '#3b3a33';
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(w, h);
      g.moveTo(w, 0);
      g.lineTo(0, h);
      g.stroke();
      g.fillStyle = '#2a2925';
      g.fillRect(w / 2 - 6, h / 2 - 6, 12, 12);
    },
    { repeat: true },
  );
}

/** Kompozit kasa yüzeyi: hafif çizik ve kir */
function grimeTexture(base, seed) {
  return canvasTex(
    256,
    256,
    (g, w, h) => {
      g.fillStyle = base;
      g.fillRect(0, 0, w, h);
      const r = rng(seed);
      for (let i = 0; i < 900; i++) {
        const a = r() * 0.12;
        g.fillStyle = r() > 0.6 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a * 1.4})`;
        g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3);
      }
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      for (let i = 0; i < 18; i++) {
        g.lineWidth = 0.6 + r();
        g.beginPath();
        const x = r() * w;
        const y = r() * h;
        g.moveTo(x, y);
        g.lineTo(x + (r() - 0.5) * 60, y + (r() - 0.5) * 20);
        g.stroke();
      }
      // kenarlarda kir
      const grd = g.createLinearGradient(0, h, 0, h * 0.6);
      grd.addColorStop(0, 'rgba(30,25,15,0.35)');
      grd.addColorStop(1, 'rgba(30,25,15,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    },
    { repeat: true },
  );
}

function withMap(m, tex) {
  if (tex) {
    m.map = tex;
    m.color.set(0xffffff);
  }
  return m;
}

function createLib() {
  const L = {
    // --- Metaller ---
    copper: std('tech.copper', 0xb4703f, 0.38, 1.0),
    brass: std('tech.brass', 0xb39a4e, 0.35, 1.0),
    steelBrushed: std('tech.steel', 0x8d9196, 0.42, 0.85),
    graphite: std('tech.graphite', 0x2c2d30, 0.55, 0.6),
    bronzeRobot: std('tech.bronzeRobot', 0x6d6253, 0.45, 0.75),
    pipeBlue: std('tech.pipeBlue', 0x2d5a86, 0.5, 0.3),
    pipeRed: std('tech.pipeRed', 0x8e2a1e, 0.5, 0.3),
    pipeGreen: std('tech.pipeGreen', 0x3f6b3a, 0.55, 0.2),
    pipeWhite: std('tech.pipeWhite', 0xcfcbc0, 0.5, 0.2),
    // --- Tehlike / etiket ---
    hazard: withMap(std('tech.hazard', 0xd6a019, 0.7, 0), hazardTexture()),
    gaugeFace: withMap(std('tech.gaugeFace', 0xebe6d8, 0.5, 0), gaugeTexture()),
    needle: std('tech.needle', 0xb01e14, 0.5, 0),
    // --- Reaktör ---
    reactorCore: std('tech.reactorCore', 0x050505, 0.3, 0, { emissive: 0xff3010, emissiveIntensity: 0.6 }),
    reactorRod: std('tech.reactorRod', 0x101418, 0.3, 0.4, { emissive: 0x6ad0ff, emissiveIntensity: 0.4 }),
    coil: std('tech.coil', 0x8a5a2b, 0.35, 1.0),
    // --- Bitki / su ---
    leaf: std('tech.leaf', 0xffffff, 0.75, 0, { side: THREE.DoubleSide }),
    cob: std('tech.cob', 0xffffff, 0.6, 0),
    husk: std('tech.husk', 0xffffff, 0.8, 0, { side: THREE.DoubleSide }),
    rockwool: std('tech.rockwool', 0x4a3c2c, 0.95, 0),
    water: std('tech.water', 0x2f7894, 0.1, 0, { transparent: true, opacity: 0.55, depthWrite: false }),
    growLED: std('tech.growLED', 0x200818, 0.4, 0, { emissive: 0xff40d0, emissiveIntensity: 2.5 }),
    mold: std('tech.mold', 0x6f7258, 0.95, 0),
    // --- Lab ---
    vialGlow: std('tech.vialGlow', 0x061008, 0.2, 0, { emissive: 0x5dffb0, emissiveIntensity: 1.6 }),
    vialGlowAmber: std('tech.vialGlowAmber', 0x100804, 0.2, 0, { emissive: 0xffa040, emissiveIntensity: 1.4 }),
    epoxy: std('tech.epoxy', 0x24282b, 0.35, 0.1),
    rockRed: std('tech.rockRed', 0x6b4a3a, 0.95, 0, { flatShading: true }),
    rockIce: std('tech.rockIce', 0xb9d3dc, 0.25, 0, { flatShading: true }),
    rockDark: std('tech.rockDark', 0x3a3836, 0.9, 0, { flatShading: true }),
    sediment: std('tech.sediment', 0x8c8166, 0.95, 0, { flatShading: true }),
    // --- Robotik ---
    pcb: std('tech.pcb', 0x1d5a33, 0.5, 0.1),
    pegboard: withMap(std('tech.pegboard', 0x6e6a60, 0.85, 0), pegboardTexture()),
    toolRed: std('tech.toolRed', 0xa8261c, 0.5, 0.1),
    // --- Kargo ---
    crateOlive: withMap(std('tech.crateOlive', 0x5d6146, 0.8, 0.05), grimeTexture('#5d6146', 11)),
    crateGray: withMap(std('tech.crateGray', 0x8b8e8f, 0.7, 0.1), grimeTexture('#8b8e8f', 12)),
    crateWhite: withMap(std('tech.crateWhite', 0xd8d4c8, 0.75, 0.0), grimeTexture('#d8d4c8', 13)),
    crateOrange: withMap(std('tech.crateOrange', 0xb4582a, 0.7, 0.0), grimeTexture('#b4582a', 14)),
    strap: std('tech.strap', 0x2d3a52, 0.9, 0),
    net: withMap(
      std('tech.net', 0x3b3a33, 0.9, 0, { alphaTest: 0.5, side: THREE.DoubleSide, transparent: false }),
      netTexture(),
    ),
    // --- EVA ---
    suitWhite: std('tech.suitWhite', 0xe6e3da, 0.92, 0),
    suitJoint: std('tech.suitJoint', 0xb8b4a8, 0.85, 0),
    visorGold: std('tech.visorGold', 0xd2a24a, 0.12, 1.0),
    // --- Genel ---
    paper: std('tech.paper', 0xe8e2cf, 0.9, 0),
    tape: std('tech.tape', 0x9c9a8e, 0.8, 0),
    beaconAmber: std('tech.beaconAmber', 0x2a1500, 0.3, 0, { emissive: 0xff8a10, emissiveIntensity: 0.0 }),
    beaconRed: std('tech.beaconRed', 0x200000, 0.3, 0, { emissive: 0xff1a0a, emissiveIntensity: 0.0 }),
  };
  return L;
}

/** Teknik modül malzemeleri (önbellekli). */
export function getTechMaterials() {
  if (!lib) lib = createLib();
  return lib;
}

/**
 * Metreye göre UV ölçekli düzlem (tekrarlı dokular için).
 * @param tile  dokunun bir tekrarının metre cinsinden boyu
 */
export function tiledPlane(w, h, tile = 0.3) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * h) / tile);
  return g;
}

/** Metreye göre UV ölçekli kutu (her yüzde doku metre başına `tile`). */
export function tiledBox(w, h, d, tile = 0.5) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // BoxGeometry yüz sırası: +x, -x, +y, -y, +z, -z (her biri 4 köşe)
  const dims = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile);
    }
  }
  return g;
}

export { canvasTex, rng };
