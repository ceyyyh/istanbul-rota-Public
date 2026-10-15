import * as THREE from 'three';
import { addBox, addMesh } from '../utils.js';
import { addWorldBox, addRod, addBolt } from '../structure/kit.js';

/**
 * Kenetlenmiş araçlar (Ajan 1 — Yapı): Ranger (~14 m köşeli mekik) ve Lander (~12 m kutumsu iniş aracı).
 * Yerel eksenler: +X burun (göbekten dışa), +Y yukarı, +Z yan. x = 0 kenetlenme noktasıdır.
 * Kesitlerden "loft" ile köşeli gövde üretilir (düz gölgeli, düşük üçgen).
 */

let glassMat = null;
function cockpitGlass() {
  if (!glassMat) {
    glassMat = new THREE.MeshStandardMaterial({ color: 0x0a1218, roughness: 0.08, metalness: 0.75, emissive: 0x0c2233, emissiveIntensity: 0.55 });
    glassMat.name = 'cockpitGlass';
  }
  return glassMat;
}

/**
 * Kesit dizisinden köşeli şerit geometri. stations: [{ x, pts: [[z, y], ...] }], edges: [[i, j], ...].
 * Yüzler eksenden dışa bakacak şekilde yönlendirilir.
 */
export function loftGeo(stations, edges, mpr = 3) {
  const pos = [];
  const uv = [];
  const push = (p, u, v) => {
    pos.push(p[0], p[1], p[2]);
    uv.push(u, v);
  };
  const tri = (a, b, c) => {
    const ab = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const ac = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const n = ab.cross(ac);
    const cy = (a[1] + b[1] + c[1]) / 3;
    const cz = (a[2] + b[2] + c[2]) / 3;
    const flip = n.y * cy + n.z * cz < 0;
    const order = flip ? [a, c, b] : [a, b, c];
    for (const p of order) push(p, p[0] / mpr, (p[2] * 0.8 + p[1]) / mpr);
  };
  const P = (st, i) => [st.x, st.pts[i][1], st.pts[i][0]];
  for (let s = 0; s < stations.length - 1; s++) {
    for (const [i, j] of edges) {
      const a0 = P(stations[s], i);
      const a1 = P(stations[s], j);
      const b0 = P(stations[s + 1], i);
      const b1 = P(stations[s + 1], j);
      tri(a0, a1, b1);
      tri(a0, b1, b0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals(); // düz gölge: üçgenler köşe paylaşmıyor
  return g;
}

/** Bir kesit için kapak (üçgen yelpazesi); dir: +1 → +X'e, -1 → -X'e bakar. */
function capGeo(st, dir) {
  const pos = [];
  const n = st.pts.length;
  const cz = st.pts.reduce((a, p) => a + p[0], 0) / n;
  const cy = st.pts.reduce((a, p) => a + p[1], 0) / n;
  for (let i = 0; i < n; i++) {
    const a = st.pts[i];
    const b = st.pts[(i + 1) % n];
    const t = [[st.x, cy, cz], [st.x, a[1], a[0]], [st.x, b[1], b[0]]];
    // normalin X bileşeni dir yönünde olmalı
    const nx = (t[1][1] - t[0][1]) * (t[2][2] - t[0][2]) - (t[1][2] - t[0][2]) * (t[2][1] - t[0][1]);
    const o = nx * dir >= 0 ? t : [t[0], t[2], t[1]];
    for (const p of o) pos.push(p[0], p[1], p[2]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.computeVertexNormals();
  return g;
}

const section = (w, top, bot) => [
  [-w, 0.3 * top],
  [-0.72 * w, top],
  [0.72 * w, top],
  [w, 0.3 * top],
  [w, -0.35 * bot],
  [0.78 * w, -bot],
  [-0.78 * w, -bot],
  [-w, -0.35 * bot],
];

function rcsQuad(parent, M, pos, rot) {
  const grp = new THREE.Group();
  grp.position.set(pos[0], pos[1], pos[2]);
  grp.rotation.set(rot[0], rot[1], rot[2]);
  addBox(grp, { size: [0.46, 0.46, 0.08], pos: [0, 0, 0.04], material: M.hullDark });
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const geo = new THREE.CylinderGeometry(0.085, 0.035, 0.2, 8, 1, true);
    geo.rotateX(Math.PI / 2);
    addMesh(grp, geo, M.thruster, { pos: [sx * 0.11, sy * 0.11, 0.16] });
  }
  parent.add(grp);
}

/** Ranger: köşeli mekik. Üst beyaz, alt siyah ısı kalkanı, ön tarafta kokpit camları. */
export function buildRanger(M) {
  const g = new THREE.Group();
  g.name = 'ranger';
  const st = [
    { x: 0.0, w: 1.9, top: 1.5, bot: 1.2 },
    { x: 2.0, w: 2.5, top: 1.65, bot: 1.25 },
    { x: 6.0, w: 2.5, top: 1.85, bot: 1.2 },
    { x: 9.0, w: 2.0, top: 1.6, bot: 1.0 },
    { x: 11.6, w: 1.3, top: 1.1, bot: 0.75 },
    { x: 14.0, w: 0.45, top: 0.45, bot: 0.4 },
  ].map((s) => ({ x: s.x, pts: section(s.w, s.top, s.bot) }));
  const upper = [[7, 0], [0, 1], [1, 2], [2, 3], [3, 4]];
  const lower = [[4, 5], [5, 6], [6, 7]];
  addMesh(g, loftGeo(st, upper, 3), M.hullWhite);
  addMesh(g, loftGeo(st, lower, 1.2), M.heatShield);
  addMesh(g, capGeo(st[0], -1), M.hullDark);
  addMesh(g, capGeo(st[st.length - 1], 1), M.hullDark);

  // kokpit kanopisi (cam): üst yüzeyin üstünde kama
  const gl = cockpitGlass();
  const canopy = [
    { x: 9.2, pts: [[-1.0, 1.52], [-0.62, 1.95], [0.62, 1.95], [1.0, 1.52]] },
    { x: 10.6, pts: [[-0.85, 1.3], [-0.5, 1.62], [0.5, 1.62], [0.85, 1.3]] },
    { x: 12.4, pts: [[-0.5, 0.75], [-0.3, 0.88], [0.3, 0.88], [0.5, 0.75]] },
  ];
  addMesh(g, loftGeo(canopy, [[0, 1], [1, 2], [2, 3]], 2), gl);
  // kanopi çerçevesi
  for (const sx of [-1, 1]) addRod(g, [9.2, 1.5, sx * 1.0], [12.4, 0.74, sx * 0.5], 0.04, M.hullDark, { segments: 5 });
  addBox(g, { size: [0.1, 0.07, 1.3], pos: [10.6, 1.64, 0], material: M.hullDark });
  addBox(g, { size: [0.08, 0.06, 0.6], pos: [11.5, 1.22, 0], rot: [0, 0, -0.2], material: M.hullDark });
  // kabin yan pencereleri
  for (const sx of [-1, 1]) {
    for (const x of [4.2, 5.4, 6.6, 7.8]) addBox(g, { size: [0.7, 0.34, 0.06], pos: [x, 0.95, sx * 2.5], material: gl });
  }
  // kanatçıklar + motor bölmeleri
  for (const sx of [-1, 1]) {
    addWorldBox(g, { size: [4.6, 0.16, 2.3], pos: [3.8, 0.35, sx * 3.35], rot: [sx * 0.05, 0, 0], material: M.hullWhite, mpr: 3 });
    addBox(g, { size: [2.8, 0.95, 1.0], pos: [2.0, 0.25, sx * 3.9], material: M.hullDark });
    const nozzle = new THREE.CylinderGeometry(0.62, 0.38, 0.9, 12, 1, true);
    nozzle.rotateZ(Math.PI / 2);
    addMesh(g, nozzle, M.thruster, { pos: [0.65, 0.25, sx * 3.9] });
    addBox(g, { size: [0.3, 0.12, 0.12], pos: [4.3, 0.46, sx * 4.55], material: sx < 0 ? M.ledRed : M.ledGreen });
    // turuncu şerit
    addBox(g, { size: [3.0, 0.12, 0.05], pos: [5.0, 0.2, sx * 2.52], material: M.accentOrange });
  }
  // sırt: dorsal kaburga ve anten
  addBox(g, { size: [4.2, 0.22, 0.9], pos: [4.0, 1.95, 0], material: M.hullPanel });
  addRod(g, [3.0, 2.0, 0.3], [3.0, 3.1, 0.3], 0.018, M.aluminium, { segments: 5 });
  // kenetlenme yakası (göbeğe)
  const collar = new THREE.CylinderGeometry(1.15, 1.25, 1.5, 16);
  collar.rotateZ(Math.PI / 2);
  addMesh(g, collar, M.hullDark, { pos: [-0.6, 0.0, 0] });
  addWorldBox(g, { size: [0.3, 2.7, 2.7], pos: [0.1, 0.0, 0], material: M.hazardStripe, mpr: 0.8 });
  rcsQuad(g, M, [8.4, 1.0, 2.0], [0, Math.PI / 2, 0]);
  rcsQuad(g, M, [8.4, 1.0, -2.0], [0, -Math.PI / 2, 0]);
  return g;
}

/** Lander: kutumsu, bacaklı iniş aracı (~12 m). */
export function buildLander(M) {
  const g = new THREE.Group();
  g.name = 'lander';
  const gl = cockpitGlass();
  // ana gövde
  addWorldBox(g, { size: [8.4, 3.4, 4.2], pos: [5.6, 0, 0], material: M.hullWhite, mpr: 3 });
  // burun kaması
  const nose = [
    { x: 9.8, pts: [[-2.1, 1.7], [2.1, 1.7], [2.1, -1.7], [-2.1, -1.7]] },
    { x: 12.0, pts: [[-1.4, 0.95], [1.4, 0.95], [1.4, -1.35], [-1.4, -1.35]] },
  ];
  addMesh(g, loftGeo(nose, [[0, 1], [1, 2], [2, 3], [3, 0]], 3), M.hullWhite);
  addMesh(g, capGeo(nose[1], 1), M.hullDark);
  addBox(g, { size: [0.08, 0.7, 2.0], pos: [11.95, 0.3, 0], material: gl });
  addBox(g, { size: [2.3, 0.08, 2.2], pos: [10.9, 0.97, 0], rot: [0, 0, -0.32], material: gl });
  // koyu paneller, turuncu şerit
  for (const sx of [-1, 1]) {
    addBox(g, { size: [3.2, 1.7, 0.06], pos: [4.0, 0.15, sx * 2.12], material: M.hullDark });
    addBox(g, { size: [2.4, 1.1, 0.06], pos: [8.0, 0.2, sx * 2.12], material: M.hullPanel });
    for (const x of [3.0, 3.8, 4.6, 5.4]) addBox(g, { size: [0.06, 1.7, 0.08], pos: [x, 0.15, sx * 2.12], material: M.hullPanel });
  }
  addBox(g, { size: [0.5, 3.46, 4.26], pos: [6.8, 0, 0], material: M.accentOrange });
  addBox(g, { size: [8.0, 0.06, 3.6], pos: [5.6, 1.72, 0], material: M.hullDark });
  // bacaklar (açık)
  for (const x of [2.6, 8.6]) {
    for (const sx of [-1, 1]) {
      const dx = x < 5 ? -0.9 : 0.9;
      addRod(g, [x, -1.5, sx * 2.0], [x + dx, -3.0, sx * 3.6], 0.1, M.metalDark, { segments: 6 });
      addRod(g, [x + 0.7 * dx, -1.0, sx * 2.1], [x + dx, -3.0, sx * 3.6], 0.05, M.metalDark, { segments: 5 });
      addBox(g, { size: [0.9, 0.12, 0.9], pos: [x + dx, -3.06, sx * 3.6], material: M.hullDark });
    }
  }
  // yan iticiler, radyatör, anten
  for (const sx of [-1, 1]) {
    rcsQuad(g, M, [2.0, 1.1, sx * 2.1], [0, sx * Math.PI / 2, 0]);
    rcsQuad(g, M, [9.4, -1.1, sx * 2.1], [0, sx * Math.PI / 2, 0]);
    addBox(g, { size: [3.2, 0.07, 1.0], pos: [4.2, 2.1, sx * 1.0], material: M.hullPanel });
    addRod(g, [3.0, 1.7, sx * 1.0], [3.0, 2.1, sx * 1.0], 0.04, M.hullDark, { segments: 5 });
    addRod(g, [5.4, 1.7, sx * 1.0], [5.4, 2.1, sx * 1.0], 0.04, M.hullDark, { segments: 5 });
  }
  addRod(g, [7.4, 1.7, 0.8], [7.4, 3.0, 0.8], 0.016, M.aluminium, { segments: 5 });
  addMesh(g, new THREE.SphereGeometry(0.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.plasticWhite, { pos: [8.4, 1.7, -0.5] });
  // kargo kapağı çizgileri
  addBox(g, { size: [2.8, 0.03, 0.06], pos: [5.6, 1.72, 1.9], material: M.hullDark });
  // kenetlenme yakası
  const collar = new THREE.CylinderGeometry(1.1, 1.2, 1.5, 16);
  collar.rotateZ(Math.PI / 2);
  addMesh(g, collar, M.hullDark, { pos: [0.65, 0, 0] });
  addWorldBox(g, { size: [0.3, 2.5, 2.5], pos: [0.1, 0, 0], material: M.hazardStripe, mpr: 0.8 });
  addBolt(g, [1.45, 1.4, 0], 'x', M.hullGold, 0.08, 0.2);
  return g;
}
