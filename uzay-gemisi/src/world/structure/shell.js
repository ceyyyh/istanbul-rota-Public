import * as THREE from 'three';
import { MODULE_LENGTH, MODULE_WIDTH, MODULE_HEIGHT, WALL_THICKNESS, DOOR_WIDTH, DOOR_HEIGHT } from '../ShipLayout.js';
import { addBox } from '../utils.js';
import { createDoor } from './door.js';

/**
 * Modül kabuğu: zemin, tavan, duvarlar (kapı ve pencere boşluklarıyla), dış gövde,
 * tavan ışıkları ve iki uçtaki sürgülü kapılar.
 * (TASLAK — Ajan 1 "Yapı" zenginleştirecek; imza ve dönen bilgi sabit kalmalı.)
 *
 * @param mctx  Modül bağlamı (Ship tarafından verilir)
 * @param opts
 *   outerWindows: [{ x, w, y, h }]  dış duvarda (z = -W/2, uzaya bakan) pencereler.
 *                 x: merkez (yerel X), w: genişlik, y: alt kenar yüksekliği, h: yükseklik
 *   innerWindows: [{ x, w, y, h }]  iç duvarda (z = +W/2, hub'a bakan) pencereler
 *   floor: 'panel' | 'grate'
 *   wall: 'light' | 'dark'
 *   accent: renk (hex) — iç mekân vurgu rengi (şeritler vb.)
 *   lights: tavan lambası sayısı (varsayılan 3), lightColor, lightIntensity
 *   hull: 'white' | 'gold' | 'dark' | 'engine' — dış gövde stili
 *   lockedUntil: bayrak adı — iki kapı da bu bayrak doğru olana dek kilitli
 *   lockedText: kilitli kapı mesajı
 *   doors: false → kapı oluşturma
 * @returns {{ length, width, height, halfL, halfW, outerZ, innerZ, doors: {start, end}, group }}
 */
export function buildShell(mctx, opts = {}) {
  const M = mctx.materials;
  const L = MODULE_LENGTH;
  const W = MODULE_WIDTH;
  const H = MODULE_HEIGHT;
  const t = WALL_THICKNESS;
  const halfL = L / 2;
  const halfW = W / 2;
  const g = new THREE.Group();
  g.name = 'shell';
  mctx.group.add(g);

  const wallMat = opts.wall === 'dark' ? M.panelDark : M.panelLight;
  const floorMat = opts.floor === 'grate' ? M.floorGrate : M.floorPanel;

  // Zemin ve tavan
  addBox(g, { size: [L + 2 * t, 0.3, W + 2 * t], pos: [0, -0.15, 0], material: floorMat });
  addBox(g, { size: [L + 2 * t, 0.3, W + 2 * t], pos: [0, H + 0.15, 0], material: M.ceiling });

  // Uzun duvarlar (pencereli)
  const longWall = (z, windows = []) => {
    const sorted = [...windows].sort((a, b) => a.x - b.x);
    let cursor = -halfL;
    for (const win of sorted) {
      const x0 = win.x - win.w / 2;
      const x1 = win.x + win.w / 2;
      if (x0 > cursor) addBox(g, { size: [x0 - cursor, H, t], pos: [(cursor + x0) / 2, H / 2, z], material: wallMat, collide: true });
      // pencere altı ve üstü
      addBox(g, { size: [win.w, win.y, t], pos: [win.x, win.y / 2, z], material: wallMat, collide: true });
      const top = win.y + win.h;
      addBox(g, { size: [win.w, H - top, t], pos: [win.x, (H + top) / 2, z], material: wallMat });
      addBox(g, { size: [win.w, win.h, 0.04], pos: [win.x, win.y + win.h / 2, z], material: M.glass, collide: true });
      cursor = x1;
    }
    if (cursor < halfL) addBox(g, { size: [halfL - cursor, H, t], pos: [(cursor + halfL) / 2, H / 2, z], material: wallMat, collide: true });
  };
  longWall(-halfW - t / 2, opts.outerWindows ?? [{ x: -2.5, w: 1.6, y: 1.0, h: 1.1 }, { x: 2.5, w: 1.6, y: 1.0, h: 1.1 }]);
  longWall(halfW + t / 2, opts.innerWindows ?? []);

  // Uç duvarlar (kapı boşluklu)
  const dw = DOOR_WIDTH / 2;
  for (const sx of [-1, 1]) {
    const x = sx * (halfL + t / 2);
    const side = (halfW + t - dw) ;
    addBox(g, { size: [t, H, side], pos: [x, H / 2, -(dw + side / 2)], material: wallMat, collide: true });
    addBox(g, { size: [t, H, side], pos: [x, H / 2, dw + side / 2], material: wallMat, collide: true });
    addBox(g, { size: [t, H - DOOR_HEIGHT, DOOR_WIDTH], pos: [x, (H + DOOR_HEIGHT) / 2, 0], material: wallMat });
  }

  // Tavan lambaları
  const n = opts.lights ?? 3;
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 0 : -halfL + 1.5 + (i * (L - 3)) / (n - 1);
    addBox(g, { size: [1.2, 0.05, 0.5], pos: [x, H - 0.03, 0], material: M.lightPanel });
    mctx.addLight([x, H - 0.4, 0], {
      color: opts.lightColor ?? 0xfff0dc,
      intensity: opts.lightIntensity ?? 7,
      distance: 9,
      emergency: { color: 0xff3020, intensity: 1.4 },
    });
  }
  // Acil durum şeritleri
  addBox(g, { size: [L, 0.04, 0.04], pos: [0, 0.08, -halfW + 0.03], material: M.emergencyStrip });
  addBox(g, { size: [L, 0.04, 0.04], pos: [0, 0.08, halfW - 0.03], material: M.emergencyStrip });

  const doors = {};
  if (opts.doors !== false) {
    const doorOpts = { lockedUntil: opts.lockedUntil, lockedText: opts.lockedText };
    doors.start = createDoor(mctx, { pos: [-halfL - t / 2, 0, 0], ...doorOpts });
    doors.end = createDoor(mctx, { pos: [halfL + t / 2, 0, 0], ...doorOpts });
  }

  return { length: L, width: W, height: H, halfL, halfW, outerZ: -halfW, innerZ: halfW, doors, group: g };
}
