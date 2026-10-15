import * as THREE from 'three';
import { MODULE_LENGTH, MODULE_WIDTH, MODULE_HEIGHT, WALL_THICKNESS, DOOR_WIDTH, DOOR_HEIGHT } from '../ShipLayout.js';
import { addBox, addCylinder, addMesh } from '../utils.js';
import { createDoor } from './door.js';
import { addWorldBox, addBolt, addStencil, moduleLabelMaterial } from './kit.js';
import { buildExteriorDetail } from './hullDetail.js';

/**
 * Modül kabuğu (Ajan 1 — Yapı): "kullanılmış" Endurance içi + dış gövde + iki uçta sürgülü kapı.
 *
 * KATMANLAR (iç ve dış yüzler AYRI meshlerdir; çoklu malzeme dizisi yok):
 *   iç kaplama  (0.12 m)  → dolgulu/paneli duvar, tavan, zemin           [iç malzemeler]
 *   dış gövde   (0.23 m)  → beyaz panel / altın folyo / koyu gövde        [hull malzemeleri]
 * Pencere boşlukları iki katmanda da aynı dikdörtgenle açılır (duvar boyunca açık).
 * Çarpışma: ayrı, görünmez "proxy" kutular (duvarlar collide: true); kapı boşlukları x=±L/2, z=0.
 *
 * @param mctx  Modül bağlamı (Ship tarafından verilir)
 * @param opts
 *   outerWindows: [{ x, w, y, h }]  dış duvarda (z = -W/2, uzaya bakan) pencereler.
 *                 x: merkez (yerel X), w: genişlik, y: alt kenar yüksekliği, h: yükseklik
 *   innerWindows: [{ x, w, y, h }]  iç duvarda (z = +W/2, hub'a bakan) pencereler
 *   floor: 'panel' | 'grate'
 *   wall: 'light' | 'dark'
 *   accent: renk (hex) — iç mekân vurgu rengi (duvar kuşağı şeridi)
 *   lights: tavan lambası sayısı (varsayılan 3, en çok 3), lightColor, lightIntensity
 *   hull: 'white' | 'gold' | 'dark' | 'engine' — dış gövde stili (verilmezse modül kimliğine göre)
 *   lockedUntil: bayrak adı — iki kapı da bu bayrak doğru olana dek kilitli
 *   lockedText: kilitli kapı mesajı
 *   doors: false → kapı oluşturma
 * @returns {{ length, width, height, halfL, halfW, outerZ, innerZ, doors: {start, end}, group }}
 */

const TI = 0.12; // iç kaplama kalınlığı
const BAY = MODULE_LENGTH / 8; // 1.375 m: kaburga aralığı
const DEFAULT_OUTER = [
  { x: -2.5, w: 1.6, y: 1.0, h: 1.1 },
  { x: 2.5, w: 1.6, y: 1.0, h: 1.1 },
];
/** Modül kimliğine göre varsayılan dış gövde stili */
const DEFAULT_HULL = {
  command: 'white',
  cryo: 'white',
  quarters: 'gold',
  medical: 'white',
  lab: 'gold',
  hydro: 'white',
  engine: 'engine',
  robotics: 'gold',
  cargo: 'dark',
  airlock: 'white',
  comms: 'gold',
  observation: 'white',
};

const accentCache = new Map();
function accentMaterial(color) {
  if (!accentCache.has(color)) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1 });
    m.name = 'accent:' + color.toString(16);
    accentCache.set(color, m);
  }
  return accentCache.get(color);
}

/** Pencere listesini sırala, duvar sınırlarına kırp, çakışanları ele. */
function normWins(list, x0, x1) {
  const out = [];
  let cur = x0;
  for (const w of [...(list || [])].sort((a, b) => a.x - b.x)) {
    const a = Math.max(x0, w.x - w.w / 2);
    const b = Math.min(x1, w.x + w.w / 2);
    if (b - a < 0.05 || a < cur) continue;
    out.push({ x: (a + b) / 2, w: b - a, y: Math.max(0, w.y), h: w.h, x0: a, x1: b });
    cur = b;
  }
  return out;
}

/** Duvar düzlemini pencere boşluklarıyla dikdörtgenlere böler. */
function wallRects(wins, x0, x1, y0, y1) {
  const out = [];
  let cur = x0;
  for (const w of wins) {
    if (w.x0 > cur) out.push({ x0: cur, x1: w.x0, y0, y1 });
    if (w.y > y0) out.push({ x0: w.x0, x1: w.x1, y0, y1: w.y });
    const top = w.y + w.h;
    if (top < y1) out.push({ x0: w.x0, x1: w.x1, y0: top, y1 });
    cur = w.x1;
  }
  if (cur < x1) out.push({ x0: cur, x1, y0, y1 });
  return out;
}

/** [lo, hi] aralığında, verilen y bandını kesen pencerelerden (kenar payıyla) boş x aralıkları. */
function freeX(wins, lo, hi, yLo, yHi, margin = 0.1) {
  const out = [];
  let cur = lo;
  for (const w of wins) {
    if (w.y > yHi || w.y + w.h < yLo) continue;
    const a = w.x0 - margin;
    const b = w.x1 + margin;
    if (a > cur) out.push([cur, Math.min(a, hi)]);
    cur = Math.max(cur, b);
  }
  if (cur < hi) out.push([cur, hi]);
  return out.filter(([a, b]) => b - a > 0.05);
}

const blockedX = (wins, x, pad = 0.12) => wins.some((w) => x > w.x0 - pad && x < w.x1 + pad);

export function buildShell(mctx, opts = {}) {
  const M = mctx.materials;
  const L = MODULE_LENGTH;
  const W = MODULE_WIDTH;
  const H = MODULE_HEIGHT;
  const t = WALL_THICKNESS;
  const halfL = L / 2;
  const halfW = W / 2;
  const TS = t - TI; // dış gövde kalınlığı
  const OUT = halfW + t; // dış yüz |z|
  const END = halfL + t; // uç yüz |x|
  const g = new THREE.Group();
  g.name = 'shell';
  mctx.group.add(g);

  const dark = opts.wall === 'dark';
  const style = opts.hull || DEFAULT_HULL[mctx.id] || 'white';
  const hullMat = style === 'dark' || style === 'engine' ? M.hullDark : M.hullWhite;
  const winsOut = normWins(opts.outerWindows ?? DEFAULT_OUTER, -END, END);
  const winsIn = normWins(opts.innerWindows ?? [], -END, END);

  // iç yüzey malzemeleri
  const upper = dark ? M.wallPanelDark : M.wallQuilt;
  const upperMpr = dark ? [BAY, 1.0] : [BAY * 2, 2.0];
  const upperOff = dark ? [0, 0] : [0, -0.6];
  const rib = dark ? M.metalDark : M.panelMid;
  const wain = dark ? M.wallPanelDark : M.wallPanel;
  const trimMat = M.metalDark;
  const accent = accentMaterial(opts.accent ?? (dark ? 0xd2602a : 0x6d7378));
  const floorMat = opts.floor === 'grate' ? M.floorGrate : M.floorPanel;
  const floorMpr = opts.floor === 'grate' ? 1 : 2;
  const walkMat = opts.floor === 'grate' ? M.floorPanel : M.floorGrate;
  const walkMpr = opts.floor === 'grate' ? 2 : 1;

  // ---------------------------------------------------------------------
  // 1) KATMANLI KABUK: iç kaplama + dış gövde
  // ---------------------------------------------------------------------
  const zIn = halfW + TI / 2;
  const zSk = halfW + TI + TS / 2;
  for (const side of [-1, 1]) {
    const wins = side < 0 ? winsOut : winsIn;
    const hullOff = [mctx.index * 0.37, 0.13 * mctx.index];
    // iç kaplama
    for (const r of wallRects(wins, -halfL, halfL, 0, H)) {
      addWorldBox(g, { size: [r.x1 - r.x0, r.y1 - r.y0, TI], pos: [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, side * zIn], material: upper, mpr: upperMpr, uvOffset: upperOff });
    }
    // dış gövde (tüm yükseklik; köşeyi sararak)
    for (const r of wallRects(wins, -END, END, -t, H + t)) {
      addWorldBox(g, { size: [r.x1 - r.x0, r.y1 - r.y0, TS], pos: [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, side * zSk], material: hullMat, mpr: 4, uvOffset: hullOff });
    }
  }
  // uç duvarlar (kapı boşluklu): iç kaplama + dış gövde
  const dw = DOOR_WIDTH / 2;
  const zEnd = halfW + TI;
  for (const sx of [-1, 1]) {
    const xi = sx * (halfL + TI / 2);
    const xs = sx * (halfL + TI + TS / 2);
    const sideW = zEnd - dw;
    for (const s of [-1, 1]) {
      addWorldBox(g, { size: [TI, H, sideW], pos: [xi, H / 2, s * (dw + sideW / 2)], material: upper, mpr: upperMpr, uvOffset: upperOff });
      addWorldBox(g, { size: [TS, H + 2 * t, sideW], pos: [xs, H / 2, s * (dw + sideW / 2)], material: hullMat, mpr: 4, uvOffset: [0.2 * mctx.index, 0] });
    }
    addWorldBox(g, { size: [TI, H - DOOR_HEIGHT, DOOR_WIDTH], pos: [xi, (H + DOOR_HEIGHT) / 2, 0], material: upper, mpr: upperMpr, uvOffset: upperOff });
    addWorldBox(g, { size: [TS, H + t - DOOR_HEIGHT, DOOR_WIDTH], pos: [xs, (H + t + DOOR_HEIGHT) / 2, 0], material: hullMat, mpr: 4 });
    addWorldBox(g, { size: [TS, t, DOOR_WIDTH], pos: [xs, -t / 2, 0], material: hullMat, mpr: 4 });
  }
  // zemin / tavan: iç kaplama + dış gövde
  const SX = halfL + TI;
  const SZ = halfW + TI;
  addWorldBox(g, { size: [2 * SX, TI, 2 * SZ], pos: [0, -TI / 2, 0], material: floorMat, mpr: floorMpr });
  addWorldBox(g, { size: [2 * SX, t - TI, 2 * SZ], pos: [0, -TI - (t - TI) / 2, 0], material: M.hullDark, mpr: 4 });
  addWorldBox(g, { size: [2 * SX, TI, 2 * SZ], pos: [0, H + TI / 2, 0], material: M.ceiling, mpr: 2 });
  addWorldBox(g, { size: [2 * SX, t - TI, 2 * SZ], pos: [0, H + TI + (t - TI) / 2, 0], material: hullMat, mpr: 4, uvOffset: [0.31 * mctx.index, 0.1] });

  // ---------------------------------------------------------------------
  // 2) ÇARPIŞMA (görünmez proxy kutular): duvarlar collide: true
  // ---------------------------------------------------------------------
  const proxy = (size, pos, name) => {
    const m = addBox(g, { size, pos, material: M.metal, collide: true, name });
    m.visible = false;
    return m;
  };
  for (const side of [-1, 1]) proxy([L + 2 * t, H + 2 * t, t], [0, H / 2, side * (halfW + t / 2)], side < 0 ? 'duvar-dis' : 'duvar-ic');
  for (const sx of [-1, 1]) {
    for (const s of [-1, 1]) {
      const sideW = OUT - dw;
      proxy([t, H, sideW], [sx * (halfL + t / 2), H / 2, s * (dw + sideW / 2)], 'duvar-uc');
    }
  }

  // ---------------------------------------------------------------------
  // 3) İÇ DETAYLAR
  // ---------------------------------------------------------------------
  // 3a) Duvar kuşağı altı paneller (girintili görünüm), kaburgalar, kuşak şeridi
  for (const side of [-1, 1]) {
    const wins = side < 0 ? winsOut : winsIn;
    const zf = side * halfW; // iç yüzey
    for (let k = 0; k < 8; k++) {
      const x0 = -halfL + k * BAY;
      const x1 = x0 + BAY;
      const cx = (x0 + x1) / 2;
      if (!wins.some((w) => w.y < 1.25 && w.x0 < x1 + 0.1 && w.x1 > x0 - 0.1)) {
        addBox(g, { size: [BAY - 0.14, 1.1, 0.03], pos: [cx, 0.65, zf - side * 0.015], material: wain });
      }
    }
    for (let k = 1; k < 8; k++) {
      const x = -halfL + k * BAY;
      if (blockedX(wins, x, 0.1)) continue;
      addBox(g, { size: [0.1, H, 0.08], pos: [x, H / 2, zf - side * 0.04], material: rib });
    }
    // kuşak (wainscot üst kenarı) + vurgu şeridi
    for (const [a, b] of freeX(wins, -halfL + 0.07, halfL - 0.07, 1.1, 1.3, 0.1)) {
      addBox(g, { size: [b - a, 0.06, 0.05], pos: [(a + b) / 2, 1.23, zf - side * 0.025], material: rib });
      addBox(g, { size: [b - a, 0.025, 0.055], pos: [(a + b) / 2, 1.28, zf - side * 0.0275], material: accent });
    }
    // süpürgelik + acil durum şeridi
    addBox(g, { size: [L, 0.1, 0.04], pos: [0, 0.05, zf - side * 0.02], material: trimMat });
    addBox(g, { size: [L - 0.3, 0.018, 0.012], pos: [0, 0.075, zf - side * 0.046], material: M.emergencyStrip });
  }
  // uç duvarlar: kaburga, kuşak, süpürgelik, köşe sütunları
  for (const sx of [-1, 1]) {
    const xf = sx * halfL;
    for (const s of [-1, 1]) {
      const z = s * 2.2;
      addBox(g, { size: [0.08, H, 0.1], pos: [xf - sx * 0.04, H / 2, z], material: rib });
      const zc = s * (0.88 + (2.2 - 0.88) / 2);
      addBox(g, { size: [0.03, 1.1, 2.2 - 0.88 - 0.14], pos: [xf - sx * 0.015, 0.65, zc], material: wain });
      const zc2 = s * ((2.2 + halfW) / 2);
      addBox(g, { size: [0.03, 1.1, halfW - 2.2 - 0.14], pos: [xf - sx * 0.015, 0.65, zc2], material: wain });
      addBox(g, { size: [0.05, 0.06, halfW - 0.88], pos: [xf - sx * 0.025, 1.23, s * (0.88 + halfW) / 2], material: rib });
      addBox(g, { size: [0.055, 0.025, halfW - 0.88], pos: [xf - sx * 0.0275, 1.28, s * (0.88 + halfW) / 2], material: accent });
      addBox(g, { size: [0.04, 0.1, halfW - 0.88], pos: [xf - sx * 0.02, 0.05, s * (0.88 + halfW) / 2], material: trimMat });
      // köşe sütunu
      addBox(g, { size: [0.16, H, 0.16], pos: [xf - sx * 0.08, H / 2, s * (halfW - 0.08)], material: rib });
    }
  }

  // 3b) Pencere çerçeveleri (iç: kalın cıvatalı; dış: koyu halka)
  const hullTrim = M.hullDark;
  const frameWindow = (w, side) => {
    const zf = side * halfW;
    const y1 = w.y + w.h;
    const zc = side * (halfW + t / 2);
    // pencere dibi içine astar (boşluk boyunca)
    addBox(g, { size: [w.w, 0.02, t], pos: [w.x, w.y + 0.01, zc], material: trimMat });
    addBox(g, { size: [w.w, 0.02, t], pos: [w.x, y1 - 0.01, zc], material: trimMat });
    for (const sx of [-1, 1]) addBox(g, { size: [0.02, w.h, t], pos: [w.x + sx * (w.w / 2 - 0.01), w.y + w.h / 2, zc], material: trimMat });
    // iç çerçeve
    const fz = zf - side * 0.035;
    addBox(g, { size: [w.w + 0.2, 0.08, 0.07], pos: [w.x, y1 + 0.04, fz], material: trimMat });
    addBox(g, { size: [w.w + 0.3, 0.05, 0.15], pos: [w.x, w.y + 0.02, zf - side * 0.075], material: M.metal });
    for (const sx of [-1, 1]) addBox(g, { size: [0.09, w.h + 0.08, 0.07], pos: [w.x + sx * (w.w / 2 + 0.045), w.y + w.h / 2 + 0.04, fz], material: trimMat });
    // cıvatalar
    const bz = zf - side * 0.072;
    const nTop = Math.max(2, Math.round(w.w / 0.4));
    for (let i = 0; i <= nTop; i++) addBolt(g, [w.x - w.w / 2 + (i * w.w) / nTop, y1 + 0.04, bz], 'z', M.metal, 0.018, 0.016);
    const nSide = Math.max(1, Math.round(w.h / 0.4));
    for (const sx of [-1, 1]) {
      for (let i = 0; i <= nSide; i++) addBolt(g, [w.x + sx * (w.w / 2 + 0.045), w.y + 0.04 + (i * (w.h - 0.04)) / nSide, bz], 'z', M.metal, 0.018, 0.016);
    }
    // cam
    addBox(g, { size: [w.w + 0.02, w.h + 0.02, 0.03], pos: [w.x, w.y + w.h / 2, zc], material: M.glass });
    // dış halka
    const oz = side * (OUT + 0.025);
    addBox(g, { size: [w.w + 0.3, 0.1, 0.05], pos: [w.x, y1 + 0.05, oz], material: hullTrim });
    addBox(g, { size: [w.w + 0.3, 0.1, 0.05], pos: [w.x, w.y - 0.05, oz], material: hullTrim });
    for (const sx of [-1, 1]) {
      addBox(g, { size: [0.1, w.h + 0.2, 0.05], pos: [w.x + sx * (w.w / 2 + 0.05), w.y + w.h / 2, oz], material: hullTrim });
      for (const sy of [w.y - 0.05, y1 + 0.05]) addBolt(g, [w.x + sx * (w.w / 2 + 0.05), sy, oz + side * 0.03], 'z', M.metal, 0.02, 0.02);
    }
  };
  winsOut.forEach((w) => frameWindow(w, -1));
  winsIn.forEach((w) => frameWindow(w, 1));

  // 3c) Duvar korkulukları (duvardan ≤ 0.15 m): pencerelerde kesilir
  const railMat = dark ? M.metal : M.handrail;
  for (const side of [-1, 1]) {
    const wins = side < 0 ? winsOut : winsIn;
    const zr = side * (halfW - 0.12);
    for (const [a, b] of freeX(wins, -halfL + 0.2, halfL - 0.2, 0.95, 1.25, 0.15)) {
      const len = b - a;
      addMesh(g, new THREE.CylinderGeometry(0.022, 0.022, len, 8), railMat, { pos: [(a + b) / 2, 1.1, zr], rot: [0, 0, Math.PI / 2] });
      for (let k = 0; k < 8; k++) {
        const x = -halfL + (k + 0.5) * BAY;
        if (x > a + 0.05 && x < b - 0.05) addBox(g, { size: [0.035, 0.035, 0.1], pos: [x, 1.1, side * (halfW - 0.06)], material: M.metalDark });
      }
    }
  }

  // 3d) Tavan: uzun kirişler, köşe kablo kanalları / borular, havalandırma ızgaraları
  for (const s of [-1, 1]) addBox(g, { size: [L, 0.1, 0.16], pos: [0, H - 0.05, s * 1.9], material: rib });
  for (const side of [-1, 1]) {
    addBox(g, { size: [L - 0.05, 0.18, 0.2], pos: [0, H - 0.09, side * (halfW - 0.1)], material: rib }); // kablo kanalı
    addMesh(g, new THREE.CylinderGeometry(0.05, 0.05, L - 0.2, 10), M.metal, { pos: [0, H - 0.26, side * (halfW - 0.07)], rot: [0, 0, Math.PI / 2] });
    addMesh(g, new THREE.CylinderGeometry(0.032, 0.032, L - 0.2, 8), M.accentOrange, { pos: [0, H - 0.22, side * (halfW - 0.2)], rot: [0, 0, Math.PI / 2] });
    for (const dz of [0.3, 0.34, 0.38]) addMesh(g, new THREE.CylinderGeometry(0.014, 0.014, L - 0.3, 6), M.cable, { pos: [0, H - 0.014, side * (halfW - dz)], rot: [0, 0, Math.PI / 2] });
    for (let k = 0; k < 8; k++) {
      const x = -halfL + (k + 0.5) * BAY;
      addBox(g, { size: [0.07, 0.1, 0.34], pos: [x, H - 0.24, side * (halfW - 0.18)], material: trimMat }); // kelepçe
    }
  }
  for (const [x, z] of [[-2.1, 1.25], [2.1, -1.25]]) {
    addBox(g, { size: [0.78, 0.04, 0.54], pos: [x, H - 0.02, z], material: trimMat });
    addWorldBox(g, { size: [0.68, 0.03, 0.44], pos: [x, H - 0.045, z], material: M.floorGrate, mpr: 0.7 });
  }

  // 3e) Tavan lambaları (armatür + yayıcı panel + ışık)
  const n = Math.min(opts.lights ?? 3, 3);
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 0 : -halfL + 1.5 + (i * (L - 3)) / (n - 1);
    addBox(g, { size: [1.4, 0.06, 0.62], pos: [x, H - 0.03, 0], material: trimMat });
    addBox(g, { size: [1.22, 0.02, 0.44], pos: [x, H - 0.07, 0], material: M.lightPanel });
    for (const sx of [-1, 1]) addBox(g, { size: [0.05, 0.1, 0.05], pos: [x + sx * 0.62, H - 0.1, 0.27], material: trimMat });
    mctx.addLight([x, H - 0.4, 0], {
      color: opts.lightColor ?? 0xfff0dc,
      intensity: opts.lightIntensity ?? 7,
      distance: 9,
      emergency: { color: 0xff3020, intensity: 1.4 },
    });
  }

  // 3f) Zemin: ızgara yürüme şeridi + kenar çerçevesi + sarı kılavuz çizgileri
  addWorldBox(g, { size: [L, 0.03, 1.6], pos: [0, 0.015, 0], material: walkMat, mpr: walkMpr });
  for (const s of [-1, 1]) {
    addBox(g, { size: [L, 0.034, 0.05], pos: [0, 0.017, s * 0.825], material: M.metalDark });
    addBox(g, { size: [L - 0.8, 0.012, 0.035], pos: [0, 0.006, s * 0.9], material: M.warning });
  }

  // 3g) Havalandırma ızgaraları (uç duvarlar), şablon etiketler
  for (const sx of [-1, 1]) {
    for (const s of [-1, 1]) {
      addBox(g, { size: [0.05, 0.42, 0.62], pos: [sx * (halfL - 0.025), 2.5, s * 2.85], material: trimMat });
      addWorldBox(g, { size: [0.056, 0.34, 0.54], pos: [sx * (halfL - 0.028), 2.5, s * 2.85], material: M.floorGrate, mpr: 0.6 });
    }
    addStencil(g, 'basinc', { pos: [sx * (halfL - 0.006), 1.9, -sx * 1.55], rot: [0, -sx * Math.PI / 2, 0], height: 0.08 });
    addStencil(g, 'kablo', { pos: [sx * (halfL - 0.006), 2.0, sx * 2.85], rot: [0, -sx * Math.PI / 2, 0], height: 0.05 });
  }
  if (!blockedX(winsIn, -2.06, 0.5)) addStencil(g, 'dikkat', { pos: [-2.06, 0.66, halfW - 0.032], rot: [0, Math.PI, 0], height: 0.07 });
  if (!blockedX(winsOut, 2.06, 0.6)) addStencil(g, 'tutun', { pos: [2.06, 1.52, -(halfW - 0.005)], rot: [0, 0, 0], height: 0.06 });
  if (!blockedX(winsOut, -3.44, 0.5)) addStencil(g, 'servis', { pos: [-3.44, 0.66, -(halfW - 0.032)], rot: [0, 0, 0], height: 0.06 });

  // 3h) Modül etiketi: kapı lentolarının üstü ("MODÜL 06 — MOTOR VE ENERJİ")
  const idx = mctx.index;
  const prev = (idx + 11) % 12;
  const next = (idx + 1) % 12;
  for (const sx of [-1, 1]) {
    const tag = sx < 0 ? `◄ ${String(prev).padStart(2, '0')}` : `${String(next).padStart(2, '0')} ►`;
    const mat = moduleLabelMaterial(idx, mctx.name, tag);
    const plane = new THREE.PlaneGeometry(3.5, 0.273);
    addMesh(g, plane, mat, { pos: [sx * (halfL - 0.004), 2.72, 0], rot: [0, -sx * Math.PI / 2, 0] });
  }

  // ---------------------------------------------------------------------
  // 4) DIŞ GÖVDE DETAYLARI (altın folyo, kafes kirişler, RCS, antenler)
  // ---------------------------------------------------------------------
  buildExteriorDetail(g, mctx, M, style, { winsOut, winsIn, halfL, halfW, H, t, OUT, END, freeX, hullMat });

  // ---------------------------------------------------------------------
  // 5) Kapılar
  // ---------------------------------------------------------------------
  const doors = {};
  if (opts.doors !== false) {
    const doorOpts = { lockedUntil: opts.lockedUntil, lockedText: opts.lockedText };
    doors.start = createDoor(mctx, { pos: [-halfL - t / 2, 0, 0], ...doorOpts });
    doors.end = createDoor(mctx, { pos: [halfL + t / 2, 0, 0], ...doorOpts });
  }

  return { length: L, width: W, height: H, halfL, halfW, outerZ: -halfW, innerZ: halfW, doors, group: g };
}
