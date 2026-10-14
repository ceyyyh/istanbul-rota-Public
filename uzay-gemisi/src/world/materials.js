import * as THREE from 'three';
import * as TX from './structure/textures.js';

/**
 * Paylaşılan malzeme kütüphanesi (Ajan 1 — Yapı).
 * Malzemeleri her yerde yeniden kullanın: aynı malzeme = statik birleştirmede tek çizim çağrısı.
 *
 *   const M = getMaterials();
 *   addBox(group, { size: [1, 1, 1], material: M.panelLight });
 *
 * İSİMLER SÖZLEŞMEDİR (kaldırmayın, yeniden adlandırmayın; yenileri eklenebilir).
 *
 * DOKULAR: structure/textures.js prosedürel dokuları başlangıçta BİR KEZ üretilir (≤512 px).
 *  - Genel adlar (panelLight, metal, plasticWhite …) kir/fırçalanmış metal gibi gerilmeye dayanıklı
 *    dokular kullanır: BoxGeometry'nin 0..1 UV'siyle her boyutta düzgün görünür.
 *  - Yapı yüzeyleri (wallQuilt, wallPanel, hullWhite, hullGold, floorPanel, floorGrate, ceiling,
 *    hazardStripe) metre tabanlı UV ister → structure/kit.js `addWorldBox(..., { mpr })` kullanın.
 *    Önerilen mpr: wallQuilt [2.75, 2.0] · wallPanel [1.375, 1.1] · hullWhite/hullPanel 4 · hullGold 2.4 ·
 *    floorPanel 2 · floorGrate 1 · ceiling 2 · hazardStripe 0.5
 *  - Yeni adlar: wallQuilt, wallQuiltDark, wallPanel, wallPanelDark, hazardStripe, doorLeaf, heatShield.
 */
let library = null;

function std(name, color, roughness = 0.6, metalness = 0.0, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  m.name = name;
  return m;
}

/** Doku kümesinden malzeme: roughnessMap MUTLAK değerlidir → roughness = 1. */
function textured(name, set, { color = 0xffffff, metalness = 0, roughness, normalScale = 1, relativeRough = false, extra = {} } = {}) {
  const opts = { color, metalness, roughness: roughness ?? 1, ...extra };
  if (set) {
    if (set.map) opts.map = set.map;
    if (set.normalMap) {
      opts.normalMap = set.normalMap;
      opts.normalScale = new THREE.Vector2(normalScale, normalScale);
    }
    if (set.roughnessMap) {
      opts.roughnessMap = set.roughnessMap;
      if (!relativeRough && roughness === undefined) opts.roughness = 1;
    }
  }
  const m = new THREE.MeshStandardMaterial(opts);
  m.name = name;
  return m;
}

function createTextures() {
  if (!TX.HAS_DOM) return {};
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const T = {
    panel: TX.panelTextures(512),
    quilt: TX.quiltTextures(512),
    hull: TX.hullPanelTextures(512),
    mli: TX.mliTextures(512),
    grate: TX.grateTextures(256),
    tread: TX.treadTextures(512),
    ceiling: TX.ceilingTextures(512),
    hazard: TX.hazardTextures(256),
    brushed: TX.brushedTextures(512),
    grime: TX.grimeTextures(256),
    door: TX.doorLeafTextures(),
  };
  T._ms = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
  return T;
}

function createLibrary() {
  const T = createTextures();
  const tint = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
  // kir dokusu ortalama ~0.9 → ana rengi biraz açarak telafi et
  const G = (hex) => tint(hex, 1.1);

  const lib = {
    // --- Dış gövde ---
    hullWhite: textured('hullWhite', T.hull, { color: 0xe8e5de, metalness: 0.05, normalScale: 0.8 }),
    hullPanel: textured('hullPanel', T.hull, { color: 0xc4c0b6, metalness: 0.1, normalScale: 0.8 }),
    // altın termal folyo (MLI): buruşuk, parlak
    hullGold: textured('hullGold', T.mli, { color: 0xffffff, metalness: 0.8, normalScale: 1.1 }),
    hullDark: textured('hullDark', T.hull, { color: 0x4a4c51, metalness: 0.3, normalScale: 0.7 }),
    thruster: textured('thruster', T.grime, { color: 0x4c4c50, metalness: 0.9, roughness: 0.42, relativeRough: true }),

    // --- İç mekân (genel adlar: gerilmeye dayanıklı) ---
    panelLight: textured('panelLight', T.grime, { color: G(0xc9c2b2), roughness: 0.78, relativeRough: true }),
    panelMid: textured('panelMid', T.grime, { color: G(0x9a958a), roughness: 0.72, relativeRough: true, metalness: 0.05 }),
    panelDark: textured('panelDark', T.grime, { color: G(0x3b3c3e), roughness: 0.62, relativeRough: true, metalness: 0.2 }),
    floorPanel: textured('floorPanel', T.tread, { color: 0x8a8c91, metalness: 0.25, normalScale: 1.0 }),
    floorGrate: textured('floorGrate', T.grate, { color: 0xc4c7cc, metalness: 0.75, normalScale: 1.0 }),
    ceiling: textured('ceiling', T.ceiling, { color: 0xcbc5b8, metalness: 0.0, normalScale: 0.9 }),
    padding: textured('padding', T.quilt, { color: 0xe4dfd2, metalness: 0.0, normalScale: 1.0 }),

    // --- Metaller / genel ---
    metal: textured('metal', T.brushed, { color: 0xb9bbc0, metalness: 1.0, normalScale: 0.6 }),
    metalDark: textured('metalDark', T.grime, { color: G(0x4f5156), roughness: 0.45, relativeRough: true, metalness: 0.9 }),
    aluminium: textured('aluminium', T.brushed, { color: 0xd4d7dc, metalness: 1.0, normalScale: 0.6 }),
    rubber: std('rubber', 0x18181a, 0.9, 0.0),
    plasticWhite: textured('plasticWhite', T.grime, { color: G(0xe8e6e0), roughness: 0.46, relativeRough: true }),
    plasticDark: textured('plasticDark', T.grime, { color: G(0x232427), roughness: 0.5, relativeRough: true }),
    fabric: textured('fabric', T.grime, { color: G(0x5a5650), roughness: 0.95, relativeRough: true }),
    fabricBlue: textured('fabricBlue', T.grime, { color: G(0x2f3b4c), roughness: 0.95, relativeRough: true }),
    handrail: textured('handrail', T.grime, { color: G(0xb9b49f), roughness: 0.4, relativeRough: true, metalness: 0.6 }),
    cable: std('cable', 0x141414, 0.7, 0.0),
    warning: textured('warning', T.grime, { color: G(0xd8a21a), roughness: 0.6, relativeRough: true }),
    accentOrange: textured('accentOrange', T.grime, { color: G(0xd2602a), roughness: 0.55, relativeRough: true }),

    // --- Saydam ---
    glass: std('glass', 0x9fb6c8, 0.05, 0.0, { transparent: true, opacity: 0.18, depthWrite: false }),
    glassFrosted: std('glassFrosted', 0xcfe4ee, 0.4, 0.0, { transparent: true, opacity: 0.45, depthWrite: false }),

    // --- Işık yayan (emissive). Güç durumuna göre Lighting yönetebilir ---
    lightPanel: std('lightPanel', 0x222222, 0.4, 0.0, { emissive: 0xfff4e0, emissiveIntensity: 2.2 }),
    emergencyStrip: std('emergencyStrip', 0x220000, 0.5, 0.0, { emissive: 0xff2010, emissiveIntensity: 1.5 }),
    screenGreen: std('screenGreen', 0x050805, 0.3, 0.0, { emissive: 0x52ff7a, emissiveIntensity: 0.9 }),
    screenAmber: std('screenAmber', 0x080502, 0.3, 0.0, { emissive: 0xffa640, emissiveIntensity: 0.9 }),
    screenBlue: std('screenBlue', 0x02050a, 0.3, 0.0, { emissive: 0x6ab8ff, emissiveIntensity: 0.9 }),
    ledRed: std('ledRed', 0x200000, 0.4, 0.0, { emissive: 0xff2a1a, emissiveIntensity: 2.0 }),
    ledGreen: std('ledGreen', 0x002000, 0.4, 0.0, { emissive: 0x3dff6a, emissiveIntensity: 2.0 }),
    ledAmber: std('ledAmber', 0x201000, 0.4, 0.0, { emissive: 0xffb030, emissiveIntensity: 2.0 }),

    // --- Yapı yüzeyleri (metre tabanlı UV ister; bkz. structure/kit.js) ---
    wallQuilt: textured('wallQuilt', T.quilt, { color: 0xddd6c6, normalScale: 1.0 }),
    wallQuiltDark: textured('wallQuiltDark', T.quilt, { color: 0x6b6e73, normalScale: 1.0 }),
    wallPanel: textured('wallPanel', T.panel, { color: 0xb7b6b0, metalness: 0.05, normalScale: 1.0 }),
    wallPanelDark: textured('wallPanelDark', T.panel, { color: 0x5b5e63, metalness: 0.2, normalScale: 1.0 }),
    hazardStripe: textured('hazardStripe', T.hazard, { color: 0xffffff, metalness: 0.1, normalScale: 0.8 }),
    doorLeaf: textured('doorLeaf', T.door, { color: 0xffffff, metalness: 0.15, normalScale: 1.0 }),
    // Ranger/Lander alt yüzü: siyah ısı kalkanı
    heatShield: textured('heatShield', T.grime, { color: 0x1b1b1d, roughness: 0.8, relativeRough: true, metalness: 0.2 }),
  };
  lib._texMs = T._ms || 0;
  return lib;
}

export function getMaterials() {
  if (!library) library = createLibrary();
  return library;
}

/**
 * Güç durumuna (acil / normal) göre ışık yayan kütüphane malzemelerini
 * LightingManager'a kaydeder. main.js tarafından bir kez çağrılır.
 */
export function registerPowerMaterials(M, lighting) {
  lighting.addEmissive(M.lightPanel, {
    normal: { color: 0xfff4e0, intensity: 2.2 },
    emergency: { color: 0x401010, intensity: 0.4 },
  });
  lighting.addEmissive(M.emergencyStrip, {
    normal: { color: 0xff2010, intensity: 0.15 },
    emergency: { color: 0xff2010, intensity: 1.8 },
  });
}

/**
 * Canvas tabanlı dinamik ekran (CRT/monokrom terminal görünümü).
 *   const scr = createScreen({ width: 512, height: 320, color: '#52ff7a' });
 *   scr.draw((g, w, h) => { g.fillText('MERHABA', 20, 40); });   // g = CanvasRenderingContext2D
 *   mesh.material = scr.material;
 * Her ekran kendi malzemesine sahiptir (dinamik → userData.dynamic önerilir).
 */
export function createScreen({ width = 512, height = 320, color = '#52ff7a', background = '#020402', emissiveIntensity = 1.2 } = {}) {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (canvas) {
    canvas.width = width;
    canvas.height = height;
  }
  const g = canvas ? canvas.getContext('2d') : null;
  const texture = canvas ? new THREE.CanvasTexture(canvas) : null;
  if (texture) texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({
    color: 0x000000,
    roughness: 0.25,
    metalness: 0,
    emissive: 0xffffff,
    emissiveMap: texture,
    emissiveIntensity,
  });
  material.name = 'screen';
  const screen = {
    canvas,
    ctx: g,
    texture,
    material,
    width,
    height,
    color,
    background,
    draw(fn) {
      if (!g) return;
      g.fillStyle = background;
      g.fillRect(0, 0, width, height);
      g.fillStyle = color;
      g.strokeStyle = color;
      g.font = `${Math.round(height / 12)}px monospace`;
      g.textBaseline = 'top';
      fn(g, width, height);
      // tarama çizgileri
      g.fillStyle = 'rgba(0,0,0,0.18)';
      for (let y = 0; y < height; y += 3) g.fillRect(0, y, width, 1);
      texture.needsUpdate = true;
    },
  };
  return screen;
}
