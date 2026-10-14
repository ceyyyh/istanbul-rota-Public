import * as THREE from 'three';

/**
 * Paylaşılan malzeme kütüphanesi (TASLAK — Ajan 1 "Yapı" tarafından zenginleştirilecek).
 * Malzemeleri her yerde yeniden kullanın: aynı malzeme = statik birleştirmede tek çizim çağrısı.
 *
 *   const M = getMaterials();
 *   addBox(group, { size: [1, 1, 1], material: M.panelLight });
 *
 * İSİMLER SÖZLEŞMEDİR (kaldırmayın, yeniden adlandırmayın; yenileri eklenebilir).
 */
let library = null;

function std(name, color, roughness = 0.6, metalness = 0.0, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  m.name = name;
  return m;
}

function createLibrary() {
  return {
    // --- Dış gövde ---
    hullWhite: std('hullWhite', 0xd9d6cf, 0.55, 0.05),
    hullPanel: std('hullPanel', 0xbdb9b0, 0.6, 0.1),
    hullGold: std('hullGold', 0xc8962e, 0.35, 1.0),
    hullDark: std('hullDark', 0x2a2b2e, 0.7, 0.3),
    thruster: std('thruster', 0x3a3a3c, 0.4, 0.9),

    // --- İç mekân ---
    panelLight: std('panelLight', 0xc9c2b2, 0.75, 0.0),
    panelMid: std('panelMid', 0x9a958a, 0.7, 0.05),
    panelDark: std('panelDark', 0x3b3c3e, 0.6, 0.2),
    floorPanel: std('floorPanel', 0x55565a, 0.8, 0.2),
    floorGrate: std('floorGrate', 0x6b6d70, 0.5, 0.8),
    ceiling: std('ceiling', 0xb8b2a4, 0.8, 0.0),
    padding: std('padding', 0xe4dfd2, 0.95, 0.0),

    // --- Metaller / genel ---
    metal: std('metal', 0xa7a9ad, 0.35, 1.0),
    metalDark: std('metalDark', 0x4a4c50, 0.45, 0.9),
    aluminium: std('aluminium', 0xc4c7cc, 0.3, 1.0),
    rubber: std('rubber', 0x18181a, 0.9, 0.0),
    plasticWhite: std('plasticWhite', 0xe8e6e0, 0.45, 0.0),
    plasticDark: std('plasticDark', 0x232427, 0.5, 0.0),
    fabric: std('fabric', 0x5a5650, 0.95, 0.0),
    fabricBlue: std('fabricBlue', 0x2f3b4c, 0.95, 0.0),
    handrail: std('handrail', 0xb9b49f, 0.4, 0.6),
    cable: std('cable', 0x141414, 0.7, 0.0),
    warning: std('warning', 0xd8a21a, 0.6, 0.0),
    accentOrange: std('accentOrange', 0xd2602a, 0.55, 0.0),

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
  };
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
