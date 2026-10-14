import * as THREE from 'three';
import { buildShell } from '../structure/shell.js';
import { addBox, addCylinder, addMesh } from '../utils.js';
import { getTechMaterials, tiledPlane } from './tech/materials.js';
import { addLabel } from './tech/labels.js';
import { addRod, addScreen, drawNoPower, screenOn, nearChecker, finalizeDynamic, addHazard, addVent, addOpenRack, applyMetricUVs } from './tech/kit.js';

/**
 * Kargo Ambarı (modül 8).
 *
 * Dış duvar: ağ gerilmiş büyük kasa yığınları, palet üzerinde orta kasalar, gaz tüpü rafı,
 *            beyaz ikmal konteyneri. Ön sırada açılabilir kasalar.
 * İç duvar:  raf üniteleri, taşıma arabası, su bidonları, envanter ekranı, ikinci kasa yığını.
 * Etkileşim: üç kasa açılıp kapanır (içerik toast'ı), envanter terminali.
 */

/** Kenar takviyeli kasa (statik). Ön yüz +Z (rotY ile çevrilir). */
function crate(parent, M, { x, y = 0, z, w, h, d, mat, rotY = 0, labels = [], collide = false, side = null }) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  parent.add(g);
  addBox(g, { size: [w, h, d], pos: [0, h / 2, 0], material: mat });
  // köşe takviyeleri
  const e = 0.035;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) addBox(g, { size: [e, h + 0.004, e], pos: [sx * (w / 2 - e / 2 + 0.003), h / 2, sz * (d / 2 - e / 2 + 0.003)], material: M.metalDark });
    addBox(g, { size: [e, e, d + 0.006], pos: [sx * (w / 2 - e / 2 + 0.003), h - e / 2 + 0.002, 0], material: M.metalDark });
    addBox(g, { size: [e, e, d + 0.006], pos: [sx * (w / 2 - e / 2 + 0.003), e / 2, 0], material: M.metalDark });
  }
  labels.forEach(([text, style = 'stencil', hh = 0.08, dy = 0], i) => {
    addLabel(g, text, { pos: [0, h * 0.62 - i * (hh * 1.4) + dy, d / 2 + 0.004], height: hh, style });
  });
  if (side) addLabel(g, side, { pos: [w / 2 + 0.004, h * 0.55, 0], rot: [0, Math.PI / 2, 0], height: 0.07, style: 'stencil' });
  if (collide) g.userData.collide = true;
  return g;
}

/** Kasa üzerine gerilmiş kayış. */
function strap(parent, T, { x, z, w, d, h, y = 0, rotY = 0, along = 'x' }) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  parent.add(g);
  if (along === 'x') {
    addBox(g, { size: [0.05, 0.006, d + 0.02], pos: [0, h + 0.003, 0], material: T.strap });
    addBox(g, { size: [0.05, h, 0.006], pos: [0, h / 2, d / 2 + 0.008], material: T.strap });
    addBox(g, { size: [0.07, 0.06, 0.02], pos: [0, h * 0.55, d / 2 + 0.014], material: T.steelBrushed });
  } else {
    addBox(g, { size: [w + 0.02, 0.006, 0.05], pos: [0, h + 0.003, 0], material: T.strap });
    addBox(g, { size: [0.006, h, 0.05], pos: [w / 2 + 0.008, h / 2, 0], material: T.strap });
  }
}

const CRATES = [
  {
    id: 'cargo.crate.food',
    x: -1.25,
    z: -1.62,
    rotY: 0.04,
    mat: 'crateOlive',
    code: 'İK-12',
    title: 'İKMAL — GIDA',
    content: 'kutular',
    msg: 'Kasa İK-12: 40 paket kurutulmuş mısır unu, 12 kutu protein macunu. Etikette biri not düşmüş: "Tadı karton, ama doyurur."',
  },
  {
    id: 'cargo.crate.parts',
    x: 0.35,
    z: 1.66,
    rotY: Math.PI - 0.05,
    mat: 'crateGray',
    code: 'YP-07',
    title: 'YEDEK PARÇA',
    content: 'parçalar',
    msg: 'Kasa YP-07: 6 adet TARS eklem yatağı, 2 servo motor, bir kutu M4 vida. Sayım fişi eksik — biri bir yatağı "ödünç" almış.',
  },
  {
    id: 'cargo.crate.personal',
    x: 3.55,
    z: -1.62,
    rotY: -0.06,
    mat: 'crateOrange',
    code: 'K-03',
    title: 'KİŞİSEL EŞYALAR',
    content: 'kişisel',
    msg: 'Kasa K-03: Mürettebatın kişisel eşyaları. En üstte kâğıda sarılmış eski bir kol saati ve elle çizilmiş bir kitaplık resmi.',
  },
];

export default {
  id: 'cargo',
  name: 'Kargo Ambarı',
  build(mctx) {
    const M = mctx.materials;
    const T = getTechMaterials();
    const g = mctx.group;
    const { state, audio, ui } = mctx;
    const near = nearChecker(mctx, 12);

    buildShell(mctx, { wall: 'dark', floor: 'panel', accent: 0xd8a21a, outerWindows: [], lights: 3, lightColor: 0xf2f0ea, lightIntensity: 6.5 });

    // ------------------------------------------------------------------
    // Zemin: bağlama halkaları ve yük alanı çizgileri
    // ------------------------------------------------------------------
    for (let i = -2; i <= 2; i++) {
      for (const z of [-1.15, 1.15]) {
        addMesh(g, new THREE.TorusGeometry(0.05, 0.01, 4, 10), M.metal, { pos: [i * 2.1, 0.012, z], rot: [Math.PI / 2, 0, 0] });
        addCylinder(g, { radius: 0.035, height: 0.01, segments: 8, pos: [i * 2.1, 0.005, z], material: M.metalDark });
      }
    }
    addLabel(g, 'YÜK ALANI — A', { pos: [-3.5, 0.007, -1.4], rot: [-Math.PI / 2, 0, 0], height: 0.12, style: 'yellow' });
    addLabel(g, 'YÜK ALANI — B', { pos: [3.5, 0.007, 1.4], rot: [-Math.PI / 2, 0, Math.PI], height: 0.12, style: 'yellow' });

    // ------------------------------------------------------------------
    // Dış duvar
    // ------------------------------------------------------------------
    // A: büyük kasa yığını + ağ
    crate(g, M, { x: -4.4, z: -2.95, w: 1.05, h: 0.85, d: 1.0, mat: T.crateOlive, collide: true, labels: [['TOHUM — MISIR', 'stencil', 0.08], ['AZİM-08-114', 'white', 0.05]] });
    crate(g, M, { x: -3.3, z: -2.95, w: 1.05, h: 0.85, d: 1.0, mat: T.crateOlive, collide: true, labels: [['SU ARITMA FİLTRESİ', 'stencil', 0.07], ['KIRILACAK', 'red', 0.05]] });
    crate(g, M, { x: -4.35, y: 0.85, z: -2.98, w: 1.0, h: 0.8, d: 0.95, mat: T.crateGray, rotY: 0.04, labels: [['TIBBİ MALZEME', 'red', 0.07]] });
    crate(g, M, { x: -3.3, y: 0.85, z: -2.96, w: 1.0, h: 0.8, d: 0.95, mat: T.crateOlive, rotY: -0.03, labels: [['BU TARAF YUKARI ↑', 'stencil', 0.06]] });
    crate(g, M, { x: -3.8, y: 1.65, z: -3.05, w: 0.7, h: 0.5, d: 0.6, mat: T.crateWhite, rotY: 0.1, labels: [['YEDEK FİLTRE', 'stencil', 0.05]] });
    strap(g, T, { x: -4.4, z: -2.95, w: 1.05, d: 1.0, h: 1.65, along: 'x' });
    strap(g, T, { x: -3.3, z: -2.95, w: 1.05, d: 1.0, h: 1.65, along: 'x' });
    {
      const net = addMesh(g, tiledPlane(2.3, 1.75, 0.16), T.net, { pos: [-3.85, 0.95, -2.42], rot: [0.04, 0, 0] });
      net.userData.noShadow = true;
      addMesh(g, tiledPlane(2.3, 1.0, 0.16), T.net, { pos: [-3.85, 1.78, -2.95], rot: [-Math.PI / 2 + 0.1, 0, 0] });
      for (let i = 0; i < 4; i++) addRod(g, [-4.95 + i * 0.73, 1.82, -3.45], [-4.95 + i * 0.73, 1.75, -2.45], { radius: 0.008, material: T.strap, segments: 4 });
    }
    // B: palet + orta kasalar + ağ
    {
      addBox(g, { size: [2.1, 0.12, 1.0], pos: [-1.3, 0.06, -2.95], material: M.metalDark, collide: true });
      const mats = [T.crateGray, T.crateWhite, T.crateOlive];
      const words = ['SU', 'GIDA', 'O₂ KARTUŞU', 'YEDEK PARÇA', 'TIBBİ', 'GIDA'];
      for (let i = 0; i < 3; i++) {
        crate(g, M, { x: -1.98 + i * 0.68, y: 0.12, z: -2.95, w: 0.62, h: 0.6, d: 0.9, mat: mats[i % 3], rotY: (i - 1) * 0.02, labels: [[words[i], 'stencil', 0.07]] });
        if (i < 2) crate(g, M, { x: -1.65 + i * 0.68, y: 0.72, z: -2.97, w: 0.62, h: 0.55, d: 0.85, mat: mats[(i + 1) % 3], rotY: 0.03 - i * 0.05, labels: [[words[i + 3], 'stencil', 0.06]] });
      }
      const net = addMesh(g, tiledPlane(2.0, 1.25, 0.16), T.net, { pos: [-1.3, 0.72, -2.48], rot: [0.03, 0, 0] });
      net.userData.noShadow = true;
    }
    // C: gaz tüpü rafı
    {
      const cx = 1.0;
      addBox(g, { size: [1.7, 0.08, 0.6], pos: [cx, 0.04, -3.15], material: M.metalDark });
      addBox(g, { size: [1.7, 0.06, 0.06], pos: [cx, 1.2, -2.88], material: M.metalDark });
      for (const sx of [-1, 1]) addBox(g, { size: [0.06, 1.3, 0.6], pos: [cx + sx * 0.85, 0.65, -3.15], material: M.metalDark });
      for (let i = 0; i < 5; i++) {
        const x = cx - 0.64 + i * 0.32;
        const o2 = i < 3;
        addCylinder(g, { radius: 0.14, height: 1.35, segments: 14, pos: [x, 0.755, -3.15], material: o2 ? M.plasticWhite : T.pipeBlue });
        addMesh(g, new THREE.SphereGeometry(0.14, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), o2 ? M.plasticWhite : T.pipeBlue, { pos: [x, 1.43, -3.15] });
        addCylinder(g, { radius: 0.035, height: 0.12, segments: 8, pos: [x, 1.6, -3.15], material: T.brass });
        addLabel(g, o2 ? 'O₂' : 'N₂', { pos: [x, 0.95, -3.008], height: 0.09, style: o2 ? 'stencil' : 'white' });
      }
      addRod(g, [cx - 0.85, 0.9, -2.87], [cx + 0.85, 0.9, -2.87], { radius: 0.01, material: M.metal, segments: 5 });
      addLabel(g, 'BASINÇLI GAZ — SABİTLE', { pos: [cx, 1.29, -2.849], height: 0.06, style: 'warn' });
      addBox(g, { size: [1.7, 0.1, 0.6], pos: [cx, 0.7, -3.15], material: M.metalDark, collide: true });
    }
    // D: ikmal konteyneri
    {
      const cx = 3.75;
      addBox(g, { size: [2.3, 1.95, 1.1], pos: [cx, 0.975, -2.92], material: M.hullWhite, collide: true, name: 'ikmal-konteyneri' });
      addBox(g, { size: [2.32, 0.18, 1.12], pos: [cx, 1.55, -2.92], material: T.pipeBlue });
      for (const sx of [-1, 1]) addBox(g, { size: [0.08, 1.95, 1.12], pos: [cx + sx * 1.13, 0.975, -2.92], material: M.metalDark });
      for (let i = 0; i < 3; i++) addBox(g, { size: [0.1, 0.18, 0.04], pos: [cx - 0.7 + i * 0.7, 1.2, -2.35], material: M.metal });
      addLabel(g, 'İKMAL KONTEYNERİ', { pos: [cx, 0.95, -2.365], height: 0.13, style: 'stencil' });
      addLabel(g, 'AZİM-08 / ORTAK İKMAL', { pos: [cx, 0.75, -2.365], height: 0.06, style: 'stencil' });
      addLabel(g, '1.840 kg — FORKLİFT KULLAN', { pos: [cx, 0.42, -2.365], height: 0.05, style: 'warn' });
      addHazard(g, { w: 2.2, h: 0.08, pos: [cx, 0.12, -2.365] });
    }

    // ------------------------------------------------------------------
    // İç duvar
    // ------------------------------------------------------------------
    // raf üniteleri
    for (let u = 0; u < 2; u++) {
      const sx = -4.35 + u * 1.25;
      const W = 1.15;
      const ys = addOpenRack(g, M, { x: sx, z: 3.2, w: W, h: 2.2, d: 0.5, shelves: 4, side: -1 });
      ys.forEach((y, r) => {
        for (let k = 0; k < 3; k++) {
          const bw = 0.3 + ((u + r + k) % 3) * 0.04;
          const bh = r === 3 ? 0.18 + ((u + k) % 2) * 0.05 : 0.22 + ((u * 3 + r + k * 2) % 4) * 0.05;
          const mat = [T.crateGray, M.plasticWhite, T.crateOlive, M.fabricBlue][(u + r * 2 + k) % 4];
          addBox(g, { size: [bw, bh, 0.38], pos: [sx - 0.36 + k * 0.36, y + bh / 2, 3.2], material: mat });
        }
      });
      addLabel(g, u ? 'RAF 2 — HİJYEN / TIBBİ' : 'RAF 1 — GIDA / SU', { pos: [sx, 2.27, 2.948], rot: [0, Math.PI, 0], height: 0.055, style: 'tag' });
    }
    // taşıma arabası
    {
      const tg = new THREE.Group();
      tg.position.set(-1.75, 0, 2.35);
      tg.rotation.y = 0.18;
      g.add(tg);
      addBox(tg, { size: [1.1, 0.06, 0.62], pos: [0, 0.22, 0], material: M.metalDark });
      addBox(tg, { size: [1.08, 0.015, 0.6], pos: [0, 0.256, 0], material: M.rubber });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        addBox(tg, { size: [0.04, 0.12, 0.04], pos: [sx * 0.48, 0.13, sz * 0.25], material: M.metal });
        addCylinder(tg, { radius: 0.07, height: 0.05, segments: 10, pos: [sx * 0.48, 0.07, sz * 0.25], rot: [Math.PI / 2, 0, 0], material: M.rubber });
      }
      addRod(tg, [0.55, 0.25, -0.27], [0.62, 1.0, -0.27], { radius: 0.018, material: M.metal, segments: 8 });
      addRod(tg, [0.55, 0.25, 0.27], [0.62, 1.0, 0.27], { radius: 0.018, material: M.metal, segments: 8 });
      addRod(tg, [0.62, 1.0, -0.27], [0.62, 1.0, 0.27], { radius: 0.02, material: M.rubber, segments: 8 });
      crate(tg, M, { x: -0.18, y: 0.26, z: 0, w: 0.6, h: 0.45, d: 0.5, mat: T.crateGray, labels: [['FİLTRE', 'stencil', 0.06]] });
      crate(tg, M, { x: -0.22, y: 0.71, z: 0.02, w: 0.42, h: 0.3, d: 0.38, mat: T.crateWhite, rotY: 0.2, labels: [['O₂', 'stencil', 0.07]] });
      tg.userData.collide = true;
      addLabel(tg, 'TAŞIMA ARABASI 2', { pos: [0, 0.22, 0.312], height: 0.035, style: 'white' });
    }
    // su bidonları
    for (let i = 0; i < 2; i++) {
      const x = 1.55 + i * 0.62;
      const z = 2.85;
      addCylinder(g, { radius: 0.28, height: 0.9, segments: 16, pos: [x, 0.45, z], material: T.pipeBlue, collide: true });
      addCylinder(g, { radius: 0.29, height: 0.04, segments: 16, pos: [x, 0.3, z], material: M.metalDark });
      addCylinder(g, { radius: 0.29, height: 0.04, segments: 16, pos: [x, 0.65, z], material: M.metalDark });
      addCylinder(g, { radius: 0.06, height: 0.04, segments: 8, pos: [x + 0.1, 0.92, z], material: M.plasticWhite });
      addLabel(g, 'SU — İÇİLEBİLİR', { pos: [x, 0.48, z - 0.285], rot: [0, Math.PI, 0], height: 0.05, style: 'white' });
    }
    addCylinder(g, { radius: 0.28, height: 0.9, segments: 16, pos: [1.85, 1.35, 2.92], material: T.pipeBlue });
    addLabel(g, 'SU', { pos: [1.85, 1.38, 2.635], rot: [0, Math.PI, 0], height: 0.09, style: 'white' });
    addBox(g, { size: [1.3, 0.04, 0.62], pos: [1.86, 0.9, 2.92], material: M.metal });
    // B yığını (iç +X)
    crate(g, M, { x: 4.4, z: 2.95, w: 0.85, h: 0.8, d: 0.85, mat: T.crateWhite, rotY: Math.PI, collide: true, labels: [['TIBBİ', 'red', 0.07], ['STERİL', 'stencil', 0.05]] });
    crate(g, M, { x: 3.5, z: 2.95, w: 0.85, h: 0.8, d: 0.85, mat: T.crateWhite, rotY: Math.PI, collide: true, labels: [['HİJYEN', 'stencil', 0.07]] });
    crate(g, M, { x: 4.0, y: 0.8, z: 2.98, w: 0.8, h: 0.75, d: 0.8, mat: T.crateGray, rotY: Math.PI - 0.06, labels: [['TOHUM — SOYA', 'stencil', 0.06]] });
    crate(g, M, { x: 4.7, y: 0.8, z: 3.05, w: 0.6, h: 0.45, d: 0.6, mat: T.crateOrange, rotY: Math.PI + 0.12, labels: [['KİŞİSEL', 'stencil', 0.05]] });
    {
      const net = addMesh(g, tiledPlane(1.9, 1.55, 0.16), T.net, { pos: [3.95, 0.85, 2.48], rot: [-0.03, Math.PI, 0] });
      net.userData.noShadow = true;
    }
    addVent(g, M, { pos: [0.6, 2.6, 3.49], rot: [0, Math.PI, 0], w: 0.7, h: 0.35 });
    // tavanda vinç rayı
    addBox(g, { size: [10.8, 0.12, 0.12], pos: [0, 3.02, -1.9], material: M.warning });
    addBox(g, { size: [0.3, 0.16, 0.2], pos: [-0.8, 2.9, -1.9], material: M.metalDark });
    addRod(g, [-0.8, 2.82, -1.9], [-0.8, 2.3, -1.9], { radius: 0.008, material: M.metal, segments: 4 });
    addMesh(g, new THREE.TorusGeometry(0.05, 0.012, 4, 10, Math.PI * 1.5), M.metal, { pos: [-0.8, 2.25, -1.9], rot: [0, 0, Math.PI] });

    // Envanter ekranı (iç duvar)
    const inv = addScreen(g, M, { size: [0.7, 0.44], pos: [-0.72, 1.6, 3.46], rot: [0, Math.PI, 0], res: [512, 320], color: '#ffb347', background: '#0a0602' });
    addLabel(g, 'ENVANTER', { pos: [-0.72, 1.89, 3.495], rot: [0, Math.PI, 0], height: 0.05, style: 'black' });

    // ------------------------------------------------------------------
    // Açılabilir kasalar
    // ------------------------------------------------------------------
    const lids = [];
    for (const c of CRATES) {
      const W = 0.85;
      const H = 0.62;
      const D = 0.62;
      const cg = new THREE.Group();
      cg.position.set(c.x, 0, c.z);
      cg.rotation.y = c.rotY;
      g.add(cg);
      const mat = T[c.mat];
      // açık üstlü gövde
      addBox(cg, { size: [W, 0.04, D], pos: [0, 0.02, 0], material: mat });
      addBox(cg, { size: [W, H, 0.04], pos: [0, H / 2, D / 2 - 0.02], material: mat });
      addBox(cg, { size: [W, H, 0.04], pos: [0, H / 2, -D / 2 + 0.02], material: mat });
      addBox(cg, { size: [0.04, H, D - 0.08], pos: [W / 2 - 0.02, H / 2, 0], material: mat });
      addBox(cg, { size: [0.04, H, D - 0.08], pos: [-W / 2 + 0.02, H / 2, 0], material: mat });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) addBox(cg, { size: [0.035, H + 0.004, 0.035], pos: [sx * (W / 2 - 0.015), H / 2, sz * (D / 2 - 0.015)], material: M.metalDark });
      addLabel(cg, c.title, { pos: [0, H * 0.58, D / 2 + 0.004], height: 0.065, style: 'stencil' });
      addLabel(cg, c.code, { pos: [0, H * 0.36, D / 2 + 0.004], height: 0.06, style: 'white' });
      addBox(cg, { size: [0.12, 0.05, 0.025], pos: [0, H - 0.06, D / 2 + 0.012], material: M.metal });
      // içerik
      if (c.content === 'kutular') {
        for (let i = 0; i < 6; i++) addBox(cg, { size: [0.22, 0.16, 0.15], pos: [-0.25 + (i % 3) * 0.25, 0.12 + Math.floor(i / 3) * 0.17, -0.1 + (i % 2) * 0.18], material: i % 2 ? M.plasticWhite : M.warning });
      } else if (c.content === 'parçalar') {
        for (let i = 0; i < 6; i++) addCylinder(cg, { radius: 0.07, height: 0.05, segments: 12, pos: [-0.25 + (i % 3) * 0.25, 0.08 + Math.floor(i / 3) * 0.06, -0.05], material: M.metal });
        addBox(cg, { size: [0.3, 0.12, 0.15], pos: [0.1, 0.1, 0.15], material: T.graphite });
        addBox(cg, { size: [0.7, 0.1, 0.5], pos: [0, 0.06, 0], material: M.padding });
      } else {
        addBox(cg, { size: [0.7, 0.2, 0.5], pos: [0, 0.12, 0], material: M.fabric });
        addBox(cg, { size: [0.14, 0.04, 0.1], pos: [-0.1, 0.24, 0.05], rot: [0, 0.4, 0], material: T.paper });
        addMesh(cg, new THREE.TorusGeometry(0.028, 0.006, 6, 12), M.aluminium, { pos: [-0.1, 0.265, 0.05], rot: [Math.PI / 2, 0, 0.4] });
        addBox(cg, { size: [0.21, 0.004, 0.15], pos: [0.18, 0.225, -0.05], rot: [0, -0.3, 0], material: T.paper });
      }
      cg.userData.collide = true;
      // kapak (arka kenardan menteşeli)
      const lid = new THREE.Group();
      lid.name = `kapak-${c.code}`;
      lid.position.set(0, H, -D / 2);
      addBox(lid, { size: [W + 0.02, 0.05, D + 0.02], pos: [0, 0.025, D / 2], material: mat });
      addBox(lid, { size: [W + 0.03, 0.03, 0.04], pos: [0, 0.03, D - 0.0], material: M.metalDark });
      addLabel(lid, 'AÇ ↑', { pos: [0, 0.051, D * 0.7], rot: [-Math.PI / 2, 0, 0], height: 0.05, style: 'white' });
      cg.add(lid);
      finalizeDynamic(lid);
      const rec = { c, lid, open: false, angle: 0 };
      lids.push(rec);
      mctx.interactions.add(lid, {
        id: c.id,
        prompt: () => (rec.open ? `Kasayı kapat (${c.code})` : `Kasayı aç (${c.code})`),
        distance: 2.6,
        onInteract: () => {
          rec.open = !rec.open;
          audio.play(rec.open ? 'click' : 'door', { position: mctx.toWorld(c.x, 0.6, c.z), volume: 0.6 });
          if (rec.open) ui.toast(c.msg, 5500);
        },
      });
    }

    mctx.interactions.add(inv.mesh, {
      id: 'cargo.inventory',
      prompt: 'Envanteri görüntüle',
      onInteract: () => {
        if (!state.is('power_restored')) {
          audio.play('error');
          ui.toast('Envanter terminali enerjisiz.');
          return;
        }
        audio.play('terminal');
        ui.openTerminal({
          title: 'KARGO AMBARI — ENVANTER (K-8)',
          color: '#ffb347',
          lines: [
            'GIDA ............... 412 gün (4 kişi)    ▓▓▓▓▓▓▓░░░',
            'SU (geri dönüşüm) .. %96 verim           ▓▓▓▓▓▓▓▓▓░',
            'O₂ KARTUŞU ......... 38 adet             ▓▓▓▓▓▓░░░░',
            'TOHUM — MISIR ...... 3 kasa              ▓▓▓▓▓▓▓▓░░',
            'TOHUM — SOYA ....... 1 kasa              ▓▓░░░░░░░░',
            'YEDEK PARÇA ........ eksik: 1 eklem yatağı (YP-07)',
            'TIBBİ .............. tam',
            '',
            'Son sayım: TARS. Not: "Sayım doğru. Mizah ayarım değil."',
          ],
          options: [{ label: 'Kapat', action: () => {} }],
        });
      },
    });

    applyMetricUVs(g, M);

    // ------------------------------------------------------------------
    // Güncelleme
    // ------------------------------------------------------------------
    let screenT = 0;
    let lastPowered = null;
    mctx.onUpdate((dt, t) => {
      for (const r of lids) {
        const target = r.open ? 1.85 : 0;
        if (Math.abs(r.angle - target) > 1e-3) {
          r.angle += (target - r.angle) * Math.min(1, dt * 7);
          r.lid.rotation.x = -r.angle;
        }
      }
      if (!near()) return;
      screenT -= dt;
      const powered = state.is('power_restored');
      if (screenT > 0 && powered === lastPowered) return;
      screenT = 0.5;
      lastPowered = powered;
      const s = inv.screen;
      if (!powered) {
        drawNoPower(s);
        return;
      }
      screenOn(s);
      s.draw((c, w) => {
        c.font = 'bold 22px monospace';
        c.fillText('ENVANTER — K-8', 14, 10);
        c.font = '17px monospace';
        const rows = [
          ['GIDA', 0.68],
          ['SU', 0.96],
          ['O₂', 0.58],
          ['MISIR', 0.8],
          ['SOYA', 0.2],
          ['PARÇA', 0.9],
        ];
        rows.forEach(([k, v], i) => {
          const y = 48 + i * 38;
          c.fillText(k, 14, y);
          c.strokeRect(110, y + 2, w - 130, 18);
          c.fillRect(112, y + 4, (w - 134) * v, 14);
        });
        if (Math.floor(t * 2) % 2) c.fillText('SAYIM GÜNCEL', 14, 285);
      });
    });
  },
};
