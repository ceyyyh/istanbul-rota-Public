import * as THREE from 'three';
import { addBox, addMesh } from '../utils.js';
import { addWorldBox, addRod, addBolt, seeded } from './kit.js';

/**
 * Dış gövde detayları (Ajan 1 — Yapı): kenar profilleri, altın folyo (MLI) örtüleri, koyu kafes kirişler,
 * 4'lü RCS nozulları, antenler, modüle özgü donanım.
 * Pencere açıklıkları ve önlerindeki alan boş bırakılır (uzay görünümü kesilmesin).
 *
 * @param g      kabuk grubu (modül yerel uzayı)
 * @param style  'white' | 'gold' | 'dark' | 'engine'
 * @param G      { winsOut, winsIn, halfL, halfW, H, t, OUT, END, freeX, hullMat }
 */
let dishMat = null;

export function buildExteriorDetail(g, mctx, M, style, G) {
  const { winsOut, winsIn, halfL, H, t, OUT, END, freeX } = G;
  const rand = seeded(1000 + mctx.index * 31);
  const id = mctx.id;
  const TOP = H + t; // çatı yüzeyi
  const BOT = -t;
  const darkHull = style === 'dark' || style === 'engine';
  const trimMat = darkHull ? M.hullPanel : M.hullDark;
  const trussMat = darkHull ? M.metal : M.hullDark;

  // --- 1) Kenar profilleri: çatı çevresi, taban çevresi, dikey köşeler ---
  const E = 0.14;
  for (const [y, sy] of [[TOP + 0.025, 0.07], [BOT - 0.025, 0.07]]) {
    for (const s of [-1, 1]) {
      addBox(g, { size: [2 * END + 0.02, sy, E], pos: [0, y, s * (OUT - E / 2)], material: trimMat });
      addBox(g, { size: [E, sy, 2 * OUT - 2 * E], pos: [s * (END - E / 2), y, 0], material: trimMat });
    }
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      addBox(g, { size: [E, H + 2 * t + 0.14, E], pos: [sx * (END - E / 2 + 0.005), H / 2, sz * (OUT - E / 2 + 0.005)], material: trimMat });
    }
  }

  // --- 2) Altın MLI örtüleri ---
  const gold = M.hullGold;
  const TH = 0.022;
  const patch = (kind, a0, a1, b0, b1, sx = 1) => {
    if (a1 - a0 < 0.3 || b1 - b0 < 0.3) return;
    let size;
    let pos;
    if (kind === 'roof') {
      size = [a1 - a0, TH, b1 - b0];
      pos = [(a0 + a1) / 2, TOP + TH / 2, (b0 + b1) / 2];
    } else if (kind === 'outer' || kind === 'inner') {
      const s = kind === 'outer' ? -1 : 1;
      size = [a1 - a0, b1 - b0, TH];
      pos = [(a0 + a1) / 2, (b0 + b1) / 2, s * (OUT + TH / 2)];
    } else {
      size = [TH, b1 - b0, a1 - a0];
      pos = [sx * (END + TH / 2), (b0 + b1) / 2, (a0 + a1) / 2];
    }
    addWorldBox(g, { size, pos, material: gold, mpr: 2.4, uvOffset: [rand() * 3, rand() * 3] });
  };
  if (style === 'gold') {
    patch('roof', -5.45, -0.2, -3.45, 3.45);
    patch('roof', 0.2, 5.45, -3.45, 3.45);
    for (const [a, b] of freeX(winsOut, -5.45, 5.45, -1, 4, 0.4)) patch('outer', a, b, 0.25, 3.15);
    for (const [a, b] of freeX(winsIn, -5.45, 5.45, -1, 4, 0.4)) patch('inner', a, b, 0.25, 3.15);
    for (const sx of [-1, 1]) {
      patch('end', 2.0, 3.45, 0.1, 3.3, sx);
      patch('end', -3.45, -2.0, 0.1, 3.3, sx);
    }
  } else if (style === 'white') {
    const rx = -4.8 + rand() * 1.5;
    patch('roof', rx, rx + 1.7, -2.6, -0.9);
    patch('roof', rx + 6, rx + 8.4 > 5.4 ? 5.4 : rx + 8.4, 0.9, 2.7);
  }

  // --- 3) Koyu kafes kirişler (çatı üstünde iki sıra) ---
  const girder = (z) => {
    const x0 = -5.2;
    const x1 = 5.2;
    const yB = TOP + 0.14;
    const yT = TOP + 0.58;
    const bays = 8;
    const dx = (x1 - x0) / bays;
    addRod(g, [x0, yB, z], [x1, yB, z], 0.045, trussMat, { segments: 6 });
    addRod(g, [x0, yT, z], [x1, yT, z], 0.045, trussMat, { segments: 6 });
    for (let i = 0; i <= bays; i++) {
      const x = x0 + i * dx;
      addRod(g, [x, yB, z], [x, yT, z], 0.03, trussMat, { segments: 5 });
      if (i < bays) addRod(g, i % 2 ? [x, yT, z] : [x, yB, z], i % 2 ? [x + dx, yB, z] : [x + dx, yT, z], 0.03, trussMat, { segments: 5 });
      if (i % 4 === 0) addRod(g, [x, TOP, z], [x, yB, z], 0.04, trussMat, { segments: 6 });
    }
  };
  girder(-2.4);
  girder(2.4);

  // --- 4) RCS nozul kümeleri (4'lü) ---
  const RCS = new Set(['command', 'medical', 'engine', 'cargo', 'observation', 'lab', 'airlock']);
  const rcs = (pos, rot) => {
    const grp = new THREE.Group();
    grp.position.set(pos[0], pos[1], pos[2]);
    grp.rotation.set(rot[0], rot[1], rot[2]);
    addBox(grp, { size: [0.5, 0.5, 0.08], pos: [0, 0, 0.04], material: M.hullDark });
    addBox(grp, { size: [0.56, 0.56, 0.03], pos: [0, 0, 0.012], material: M.hullPanel });
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const geo = new THREE.CylinderGeometry(0.085, 0.035, 0.2, 8, 1, true);
      geo.rotateX(Math.PI / 2);
      addMesh(grp, geo, M.thruster, { pos: [sx * 0.12, sy * 0.12, 0.16] });
      addBolt(grp, [sx * 0.12, sy * 0.12, 0.085], 'z', M.hullGold, 0.045, 0.02);
    }
    g.add(grp);
  };
  if (RCS.has(id) || style === 'engine') {
    for (const sx of [-1, 1]) {
      const x = sx * 5.05;
      if (!winsOut.some((w) => Math.abs(x - w.x) < w.w / 2 + 0.7)) rcs([x, 2.8, -OUT - 0.02], [0, Math.PI, 0]);
      if (style === 'engine' || id === 'cargo') if (!winsIn.some((w) => Math.abs(x - w.x) < w.w / 2 + 0.7)) rcs([x, 2.8, OUT + 0.02], [0, 0, 0]);
      if (style === 'engine') rcs([x, 0.5, -OUT - 0.02], [0, Math.PI, 0]);
    }
  }

  // --- 5) Antenler ---
  const whip = (x, z, len = 1.6) => {
    addRod(g, [x, TOP, z], [x, TOP + len, z], 0.014, M.aluminium, { segments: 5 });
    addBox(g, { size: [0.14, 0.06, 0.14], pos: [x, TOP + 0.03, z], material: M.hullDark });
  };
  if (id === 'comms') {
    if (!dishMat) {
      dishMat = M.plasticWhite.clone();
      dishMat.side = THREE.DoubleSide;
      dishMat.name = 'dish';
    }
    const dx = -2.6;
    addRod(g, [dx, TOP, 0.4], [dx, TOP + 0.9, 0.4], 0.07, M.hullDark, { segments: 8 });
    const dish = new THREE.SphereGeometry(1.15, 22, 8, 0, Math.PI * 2, Math.PI - 0.62, 0.62);
    dish.translate(0, 1.15, 0); // dip noktası orijinde, içbükey yüz +Y'ye bakar
    addMesh(g, dish, dishMat, { pos: [dx, TOP + 1.0, 0.4], rot: [-0.55, 0.4, 0] });
    addRod(g, [dx, TOP + 0.9, 0.4], [dx + 0.45, TOP + 1.95, -0.25], 0.025, M.metalDark, { segments: 5 });
    addMesh(g, new THREE.CylinderGeometry(0.1, 0.045, 0.22, 8), M.hullGold, { pos: [dx + 0.45, TOP + 1.95, -0.25] });
    whip(3.0, -2.9, 2.4);
    whip(4.2, 2.9, 1.8);
    whip(-5.0, 2.9, 2.0);
    // küçük yönlü anten dizisi
    for (let i = 0; i < 3; i++) addBox(g, { size: [0.5, 0.35, 0.05], pos: [0.9 + i * 0.7, TOP + 0.22, 0.6], rot: [-0.5, 0, 0], material: M.hullPanel });
  } else if (id === 'command') {
    whip(-4.6, -2.9, 2.0);
    whip(4.6, 2.9, 1.5);
    addMesh(g, new THREE.SphereGeometry(0.45, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.plasticWhite, { pos: [0, TOP, 0.2] });
    addBox(g, { size: [0.9, 0.05, 0.9], pos: [0, TOP + 0.025, 0.2], material: M.hullDark });
  } else {
    whip(-4.9 + rand() * 1.2, -2.9 + rand() * 0.4, 1.0 + rand() * 1.0);
    if (rand() > 0.4) whip(4.9 - rand() * 1.0, 2.9 - rand() * 0.4, 0.8 + rand() * 1.0);
  }

  // --- 6) Modüle özgü donanım ---
  if (id === 'airlock' && !winsOut.some((w) => Math.abs(w.x) < w.w / 2 + 1.2)) {
    // dış hava kilidi kapağı: uyarı şeritli çerçeve + tutunma çubukları
    const z = -OUT - 0.03;
    addBox(g, { size: [1.7, 0.1, 0.06], pos: [0, 2.35, z], material: M.hullDark });
    addWorldBox(g, { size: [1.7, 0.12, 0.062], pos: [0, 2.46, z - 0.001], material: M.hazardStripe, mpr: 0.45 });
    addBox(g, { size: [0.1, 2.3, 0.06], pos: [-0.8, 1.2, z], material: M.hullDark });
    addBox(g, { size: [0.1, 2.3, 0.06], pos: [0.8, 1.2, z], material: M.hullDark });
    addWorldBox(g, { size: [1.5, 2.25, 0.04], pos: [0, 1.15, -OUT - 0.012], material: M.hullPanel, mpr: 1.5 });
    for (const sx of [-1, 1]) addRod(g, [sx * 1.15, 0.6, z - 0.12], [sx * 1.15, 1.8, z - 0.12], 0.02, M.handrail, { segments: 6 });
    addBox(g, { size: [0.3, 0.3, 0.05], pos: [1.2, 1.2, z - 0.01], material: M.ledAmber });
  }
  if (style === 'engine') {
    // radyatör tarağı + soğutma boruları
    for (let i = 0; i < 4; i++) {
      const x = -3.6 + i * 2.4;
      addBox(g, { size: [0.05, 1.5, 3.4], pos: [x, TOP + 0.9, 0], material: M.hullWhite });
      addBox(g, { size: [0.09, 0.07, 3.4], pos: [x, TOP + 1.66, 0], material: M.hullDark });
      addBox(g, { size: [0.14, 0.2, 0.2], pos: [x, TOP + 0.1, -1.4], material: M.hullDark });
      addBox(g, { size: [0.14, 0.2, 0.2], pos: [x, TOP + 0.1, 1.4], material: M.hullDark });
    }
    for (const z of [-3.1, 3.1]) addRod(g, [-5.3, TOP + 0.2, z], [5.3, TOP + 0.2, z], 0.11, M.metal, { segments: 10, openEnded: false });
  } else if (id === 'cargo') {
    for (const [x, z, w, d] of [[-3.0, -0.4, 2.6, 1.7], [2.0, 0.6, 2.2, 1.5]]) {
      addWorldBox(g, { size: [w, 0.9, d], pos: [x, TOP + 0.5, z], material: M.hullPanel, mpr: 1.6 });
      for (const dx of [-w / 3, w / 3]) addBox(g, { size: [0.05, 0.94, d + 0.04], pos: [x + dx, TOP + 0.5, z], material: M.hullDark });
    }
  } else if (id === 'hydro') {
    for (let i = 0; i < 3; i++) {
      const dm = new THREE.SphereGeometry(0.6, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      addMesh(g, dm, M.glassFrosted, { pos: [-3.2 + i * 3.2, TOP + 0.02, 0.0 + (i % 2 ? 0.8 : -0.8)] });
      addBox(g, { size: [1.3, 0.05, 1.3], pos: [-3.2 + i * 3.2, TOP + 0.025, 0.0 + (i % 2 ? 0.8 : -0.8)], material: M.hullDark });
    }
  }
}
