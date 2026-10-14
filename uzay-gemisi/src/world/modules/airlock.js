import * as THREE from 'three';
import { buildShell } from '../structure/shell.js';
import { addBox, addCylinder, addMesh, addSphere } from '../utils.js';
import { getTechMaterials } from './tech/materials.js';
import { addLabel } from './tech/labels.js';
import {
  addRod,
  makeHandwheel,
  addGauge,
  addScreen,
  drawNoPower,
  screenOn,
  nearChecker,
  finalizeDynamic,
  addHitBox,
  addBlocker,
  addHandrail,
  addVent,
  addFloorHazard,
  applyMetricUVs,
} from './tech/kit.js';

/**
 * Hava Kilidi / Ranger Rıhtımı (modül 9).
 *
 * Dış duvar: EVA giysisi rafları (3 giysi + Ranger'daki boş yuva), giyinme bankı, kask rafı, dolaplar.
 * İç duvar (+Z, göbeğe bakar): yuvarlak hava kilidi kapağı (Ranger kenetlenme tüneline açılır),
 *            iki yanında göbeği ve kenetli Ranger'ı gösteren pencereler, kontrol paneli, basınç göstergesi.
 * Etkileşim: "Hava kilidi döngüsü" (uyarı ışıkları, basınç animasyonu, sonunda EVA yetkisi yok),
 *            EVA giysilerini inceleme.
 */

const HATCH_Y = 1.25;
const P_ATM = 101;

const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Ayakta duran EVA giysisi (statik; ön yüz +Z). */
function buildSuit(parent, M, T, { x, z, helmet = true, tag }) {
  const g = new THREE.Group();
  g.position.set(x, 0.06, z);
  parent.add(g);
  const W = T.suitWhite;
  const J = T.suitJoint;
  for (const sx of [-1, 1]) {
    const lx = sx * 0.11;
    addBox(g, { size: [0.14, 0.12, 0.28], pos: [lx, 0.06, 0.03], material: J });
    addCylinder(g, { radiusTop: 0.085, radiusBottom: 0.075, height: 0.38, segments: 10, pos: [lx, 0.31, 0], material: W });
    addMesh(g, new THREE.TorusGeometry(0.085, 0.02, 6, 12), J, { pos: [lx, 0.5, 0], rot: [Math.PI / 2, 0, 0] });
    addCylinder(g, { radiusTop: 0.1, radiusBottom: 0.088, height: 0.38, segments: 10, pos: [lx, 0.69, 0], material: W });
    // kollar
    const s = [sx * 0.29, 1.43, 0];
    const e = [sx * 0.34, 1.13, 0.04];
    const w = [sx * 0.31, 0.9, 0.1];
    addMesh(g, new THREE.TorusGeometry(0.075, 0.022, 6, 12), J, { pos: s, rot: [0, 0, Math.PI / 2] });
    addRod(g, s, e, { radius: 0.072, material: W, segments: 10, openEnded: false });
    addSphere(g, { radius: 0.07, widthSegments: 10, heightSegments: 6, pos: e, material: J });
    addRod(g, e, w, { radius: 0.062, material: W, segments: 10, openEnded: false });
    addMesh(g, new THREE.TorusGeometry(0.058, 0.016, 6, 12), M.metal, { pos: w, rot: [Math.PI / 2 - 0.3, 0, 0] });
    addBox(g, { size: [0.09, 0.13, 0.07], pos: [w[0], w[1] - 0.09, w[2] + 0.01], material: J });
  }
  addBox(g, { size: [0.44, 0.2, 0.28], pos: [0, 0.93, 0], material: W });
  addMesh(g, new THREE.TorusGeometry(0.2, 0.025, 6, 16), J, { pos: [0, 1.04, 0], rot: [Math.PI / 2, 0, 0], scale: [1, 0.72, 1] });
  addCylinder(g, { radius: 0.25, height: 0.5, segments: 14, pos: [0, 1.3, 0], material: W, scale: [1, 1, 0.72] });
  addBox(g, { size: [0.22, 0.12, 0.08], pos: [0, 1.28, 0.2], material: M.plasticDark });
  addBox(g, { size: [0.03, 0.02, 0.01], pos: [-0.06, 1.3, 0.243], material: M.ledGreen });
  addBox(g, { size: [0.03, 0.02, 0.01], pos: [0.0, 1.3, 0.243], material: M.ledAmber });
  addLabel(g, tag, { pos: [0.11, 1.45, 0.178], rot: [0, 0.35, 0], height: 0.04, style: 'tag' });
  addLabel(g, 'AZİM', { pos: [-0.24, 1.42, 0.1], rot: [0, -0.9, 0], height: 0.045, style: 'blue' });
  // sırt çantası (yaşam destek)
  addBox(g, { size: [0.46, 0.62, 0.22], pos: [0, 1.28, -0.27], material: W });
  addBox(g, { size: [0.4, 0.05, 0.2], pos: [0, 1.0, -0.27], material: T.graphite });
  addBox(g, { size: [0.4, 0.05, 0.2], pos: [0, 1.56, -0.27], material: T.graphite });
  // boyun halkası + kask
  addMesh(g, new THREE.TorusGeometry(0.13, 0.025, 6, 16), M.metal, { pos: [0, 1.57, 0.01], rot: [Math.PI / 2, 0, 0] });
  if (helmet) {
    addSphere(g, { radius: 0.165, widthSegments: 16, heightSegments: 10, pos: [0, 1.72, 0.02], material: W });
    addMesh(g, new THREE.SphereGeometry(0.168, 16, 8, Math.PI / 2 - 0.95, 1.9, 0.85, 1.15), T.visorGold, { pos: [0, 1.72, 0.02] });
    for (const sx of [-1, 1]) addBox(g, { size: [0.04, 0.05, 0.08], pos: [sx * 0.15, 1.8, 0.04], material: M.plasticDark });
  }
  return g;
}

/** Ayrı duran kask (raf üstü). */
function buildHelmet(parent, M, T, pos) {
  addSphere(parent, { radius: 0.165, widthSegments: 16, heightSegments: 10, pos, material: T.suitWhite });
  addMesh(parent, new THREE.SphereGeometry(0.168, 16, 8, Math.PI / 2 - 0.95, 1.9, 0.85, 1.15), T.visorGold, { pos });
  addMesh(parent, new THREE.TorusGeometry(0.13, 0.025, 6, 16), M.metal, { pos: [pos[0], pos[1] - 0.15, pos[2]], rot: [Math.PI / 2, 0, 0] });
}

export default {
  id: 'airlock',
  name: 'Hava Kilidi / Ranger Rıhtımı',
  build(mctx) {
    const M = mctx.materials;
    const T = getTechMaterials();
    const g = mctx.group;
    const { state, audio, ui } = mctx;
    const near = nearChecker(mctx, 12);

    buildShell(mctx, {
      wall: 'light',
      floor: 'panel',
      accent: 0xff8a10,
      hull: 'white',
      outerWindows: [{ x: 3.15, w: 1.0, y: 1.3, h: 0.8 }],
      innerWindows: [
        { x: -3.1, w: 1.6, y: 0.85, h: 1.45 },
        { x: 3.1, w: 1.6, y: 0.85, h: 1.45 },
      ],
      lights: 3,
    });

    // Uyarı ışığı (döngü sırasında yanar)
    const beaconLight = mctx.addLight([0, 2.35, 2.7], { color: 0xff8a10, intensity: 0, distance: 6.5, emergency: { color: 0xff8a10, intensity: 0 } });
    const beaconMat = T.beaconAmber.clone();
    beaconMat.name = 'airlock.beacon';
    const AMBER = new THREE.Color(0xff8a10);
    const REDC = new THREE.Color(0xff1a0a);

    // ------------------------------------------------------------------
    // HAVA KİLİDİ KAPAĞI (iç duvar, x = 0)
    // ------------------------------------------------------------------
    addCylinder(g, { radius: 1.05, height: 0.06, segments: 32, pos: [0, HATCH_Y, 3.39], rot: [Math.PI / 2, 0, 0], material: M.panelMid });
    {
      const ring = new THREE.RingGeometry(0.9, 1.04, 32, 1);
      const uv = ring.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 7, uv.getY(i) * 7);
      addMesh(g, ring, T.hazard, { pos: [0, HATCH_Y, 3.356], rot: [0, Math.PI, 0] });
    }
    addMesh(g, new THREE.TorusGeometry(0.81, 0.085, 8, 32), M.metal, { pos: [0, HATCH_Y, 3.32] });
    addCylinder(g, { radius: 0.74, height: 0.04, segments: 28, pos: [0, HATCH_Y, 3.36], rot: [Math.PI / 2, 0, 0], material: M.plasticDark });
    for (const dy of [-0.42, 0.42]) addBox(g, { size: [0.12, 0.16, 0.12], pos: [0.86, HATCH_Y + dy, 3.28], material: M.metalDark });
    // kapak (menteşe +X kenarında)
    const door = new THREE.Group();
    door.name = 'hava-kilidi-kapağı';
    door.position.set(0.78, HATCH_Y, 3.28);
    g.add(door);
    addCylinder(door, { radius: 0.72, height: 0.1, segments: 28, pos: [-0.78, 0, 0], rot: [Math.PI / 2, 0, 0], material: M.panelLight });
    addCylinder(door, { radius: 0.6, height: 0.02, segments: 28, pos: [-0.78, 0, -0.055], rot: [Math.PI / 2, 0, 0], material: M.panelMid });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      addCylinder(door, { radius: 0.022, height: 0.03, segments: 6, pos: [-0.78 + Math.cos(a) * 0.66, Math.sin(a) * 0.66, -0.06], rot: [Math.PI / 2, 0, 0], material: M.metalDark });
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const dog = addBox(door, { size: [0.16, 0.06, 0.05], pos: [-0.78 + Math.cos(a) * 0.72, Math.sin(a) * 0.72, -0.04], material: M.metalDark });
      dog.rotation.z = a;
    }
    addCylinder(door, { radius: 0.12, height: 0.03, segments: 16, pos: [-0.78, 0.4, -0.06], rot: [Math.PI / 2, 0, 0], material: M.metal });
    addCylinder(door, { radius: 0.095, height: 0.01, segments: 16, pos: [-0.78, 0.4, -0.076], rot: [Math.PI / 2, 0, 0], material: M.plasticDark });
    addCylinder(door, { radius: 0.095, height: 0.01, segments: 16, pos: [-0.78, 0.4, -0.082], rot: [Math.PI / 2, 0, 0], material: M.glass });
    addLabel(door, 'İÇ KAPAK  A-1', { pos: [-0.78, -0.33, -0.066], rot: [0, Math.PI, 0], height: 0.05, style: 'stencil' });
    const wheel = makeHandwheel(0.24, M.accentOrange);
    wheel.position.set(-0.78, 0, -0.13);
    wheel.rotation.y = Math.PI;
    door.add(wheel);
    addCylinder(door, { radius: 0.035, height: 0.08, segments: 8, pos: [-0.78, 0, -0.09], rot: [Math.PI / 2, 0, 0], material: M.metal });
    finalizeDynamic(wheel);
    finalizeDynamic(door);
    addLabel(g, 'HAVA KİLİDİ — RANGER KENETLENME TÜNELİ', { pos: [0, 2.5, 3.41], rot: [0, Math.PI, 0], height: 0.075, style: 'warn' });
    addLabel(g, 'BASINÇ FARKI VARKEN AÇMAYIN', { pos: [0, 0.16, 3.41], rot: [0, Math.PI, 0], height: 0.05, style: 'red' });
    addFloorHazard(g, { w: 2.2, d: 0.1, pos: [0, 2.75] });
    addFloorHazard(g, { w: 2.2, d: 0.1, pos: [0, 2.25] });
    // uyarı lambaları
    for (const sx of [-1, 1]) {
      const bx = sx * 1.25;
      addCylinder(g, { radius: 0.08, height: 0.05, segments: 12, pos: [bx, 2.28, 3.42], material: M.metalDark });
      addBox(g, { size: [0.06, 0.06, 0.1], pos: [bx, 2.28, 3.47], material: M.metalDark });
      addCylinder(g, { radius: 0.065, height: 0.12, segments: 12, pos: [bx, 2.36, 3.42], material: beaconMat });
      addSphere(g, { radius: 0.065, widthSegments: 12, heightSegments: 6, pos: [bx, 2.42, 3.42], material: beaconMat });
    }

    // Kontrol paneli (kapağın solunda, +X)
    const CX = 1.62;
    addBox(g, { size: [0.6, 0.85, 0.12], pos: [CX, 1.3, 3.44], material: M.panelMid });
    addLabel(g, 'KİLİT KONTROL', { pos: [CX, 1.66, 3.378], rot: [0, Math.PI, 0], height: 0.045, style: 'black' });
    const scr = addScreen(g, M, { size: [0.46, 0.28], pos: [CX, 1.43, 3.372], rot: [0, Math.PI, 0], res: [448, 272], color: '#ffb347', background: '#0a0602', depth: 0.03 });
    const btn = new THREE.Group();
    btn.name = 'döngü-düğmesi';
    btn.position.set(CX + 0.12, 1.06, 3.368);
    addCylinder(btn, { radius: 0.065, height: 0.03, segments: 14, rot: [Math.PI / 2, 0, 0], material: M.warning });
    const cap = addCylinder(btn, { radius: 0.05, height: 0.05, segments: 14, pos: [0, 0, -0.035], rot: [Math.PI / 2, 0, 0], material: T.toolRed });
    g.add(btn);
    addLabel(g, 'DÖNGÜ', { pos: [CX - 0.12, 1.09, 3.378], rot: [0, Math.PI, 0], height: 0.04, style: 'white' });
    addLabel(g, 'EVA', { pos: [CX - 0.12, 1.03, 3.378], rot: [0, Math.PI, 0], height: 0.03, style: 'orange' });
    addBox(g, { size: [0.05, 0.05, 0.02], pos: [CX - 0.2, 1.2, 3.375], material: M.ledGreen });
    // basınç göstergesi (kapağın sağında, -X)
    addBox(g, { size: [0.5, 0.62, 0.1], pos: [-1.62, 1.42, 3.45], material: M.panelMid });
    const gauge = addGauge(g, { pos: [-1.62, 1.48, 3.38], rot: [0, Math.PI, 0], radius: 0.19, value: P_ATM / 200, dynamic: true });
    addLabel(g, 'KİLİT BASINCI', { pos: [-1.62, 1.19, 3.398], rot: [0, Math.PI, 0], height: 0.045, style: 'black' });

    // pencere altı korkulukları + kenetlenme bilgisi
    for (const sx of [-1, 1]) {
      addHandrail(g, M, { x0: sx * 3.1 - 0.7, x1: sx * 3.1 + 0.7, y: 0.7, z: 3.5, side: -1 });
      addLabel(g, sx < 0 ? 'GÖBEK — KENETLENME HALKASI' : 'RANGER-1  KENETLİ', { pos: [sx * 3.1, 2.42, 3.495], rot: [0, Math.PI, 0], height: 0.05, style: 'tag' });
    }

    // ------------------------------------------------------------------
    // EVA GİYSİLERİ (dış duvar, -X yarısı)
    // ------------------------------------------------------------------
    const suits = [
      { x: -4.25, tag: 'EVA-1', helmet: true, msg: 'EVA-1: Basınç testi GEÇTİ. O₂ %100. Vizörde ince bir çizik var — "karakter katıyor".' },
      { x: -3.1, tag: 'EVA-2', helmet: false, msg: 'EVA-2: Basınç testi GEÇTİ. O₂ %96. Sol eldivende yama; üzerinde "geçici" yazıyor. Üç görevdir geçici.' },
      { x: -1.95, tag: 'EVA-3', helmet: true, msg: 'EVA-3: Basınç testi KALDI — sağ diz contası. KULLANMAYIN. Kask kenarına biri "şanslı" yazmış.' },
    ];
    const SZ = -2.95;
    for (const s of suits) {
      addBox(g, { size: [0.95, 0.06, 0.75], pos: [s.x, 0.03, SZ - 0.05], material: M.metalDark });
      for (const sx of [-1, 1]) addBox(g, { size: [0.05, 2.15, 0.05], pos: [s.x + sx * 0.45, 1.075, -3.42], material: M.metalDark });
      addBox(g, { size: [0.95, 0.06, 0.06], pos: [s.x, 2.12, -3.42], material: M.metalDark });
      addBox(g, { size: [0.7, 0.04, 0.12], pos: [s.x, 1.6, -3.36], material: M.metal });
      addLabel(g, s.tag, { pos: [s.x, 2.0, -3.39], height: 0.07, style: 'white' });
      buildSuit(g, M, T, { x: s.x, z: SZ, helmet: s.helmet, tag: s.tag });
      const hit = addHitBox(g, { size: [0.7, 1.75, 0.55], pos: [s.x, 1.0, SZ + 0.05], name: `giysi-${s.tag}` });
      mctx.interactions.add(hit, {
        id: `airlock.suit.${s.tag}`,
        prompt: `${s.tag} giysisini incele`,
        highlight: false,
        onInteract: () => {
          audio.play('click');
          ui.toast(s.msg, 5000);
        },
      });
    }
    // boş yuva (Ranger'da)
    {
      const x = -0.8;
      addBox(g, { size: [0.95, 0.06, 0.75], pos: [x, 0.03, SZ - 0.05], material: M.metalDark });
      for (const sx of [-1, 1]) addBox(g, { size: [0.05, 2.15, 0.05], pos: [x + sx * 0.45, 1.075, -3.42], material: M.metalDark });
      addBox(g, { size: [0.95, 0.06, 0.06], pos: [x, 2.12, -3.42], material: M.metalDark });
      addBox(g, { size: [0.7, 0.04, 0.12], pos: [x, 1.6, -3.36], material: M.metal });
      addLabel(g, 'EVA-4', { pos: [x, 2.0, -3.39], height: 0.07, style: 'white' });
      addLabel(g, "RANGER'DA", { pos: [x, 1.4, -3.43], height: 0.06, style: 'tag' });
    }
    addBlocker(g, { size: [4.6, 2.0, 0.9], pos: [-2.5, 1.0, -3.0] });
    addLabel(g, 'EVA GİYSİLERİ — KULLANIMDAN SONRA KURULA', { pos: [-2.5, 2.42, -3.41], height: 0.06, style: 'stencil' });

    // giyinme bankı + kask rafı + dolaplar (+X dış)
    addBox(g, { size: [1.7, 0.1, 0.45], pos: [1.55, 0.45, -3.2], material: M.padding, collide: true, name: 'bank' });
    for (const sx of [-1, 1]) addBox(g, { size: [0.06, 0.4, 0.4], pos: [1.55 + sx * 0.75, 0.2, -3.2], material: M.metalDark });
    addBox(g, { size: [0.5, 0.06, 0.3], pos: [1.2, 0.53, -3.15], rot: [0, 0.2, 0], material: M.fabricBlue });
    addBox(g, { size: [1.6, 0.03, 0.32], pos: [1.55, 1.72, -3.33], material: M.metal });
    buildHelmet(g, M, T, [1.2, 1.9, -3.3]);
    for (const sx of [-1, 1]) addBox(g, { size: [0.09, 0.12, 0.08], pos: [1.75 + sx * 0.08, 1.795, -3.3], material: T.suitJoint });
    addLabel(g, 'YEDEK KASK', { pos: [1.55, 1.68, -3.168], height: 0.035, style: 'tag' });
    {
      const names = ['PİLOT', 'BİLİM', 'MÜH.'];
      for (let i = 0; i < 3; i++) {
        const x = 4.15 + i * 0.47;
        addBox(g, { size: [0.45, 2.0, 0.5], pos: [x, 1.0, -3.2], material: i === 1 ? M.panelMid : M.panelLight, collide: true });
        for (let k = 0; k < 4; k++) addBox(g, { size: [0.25, 0.012, 0.01], pos: [x, 1.7 + k * 0.04, -2.948], material: M.metalDark });
        addBox(g, { size: [0.03, 0.15, 0.03], pos: [x + 0.15, 1.1, -2.94], material: M.metal });
        addLabel(g, names[i], { pos: [x, 1.45, -2.946], height: 0.045, style: 'tag' });
      }
    }
    // -X iç köşe: oksijen tüpleri, +X iç köşe: kontrol listesi + bağlama halatı makarası
    for (let i = 0; i < 5; i++) {
      const x = -5.1 + i * 0.2;
      addCylinder(g, { radius: 0.085, height: 0.7, segments: 10, pos: [x, 0.4, 3.3], material: i % 2 ? M.plasticWhite : T.pipeGreen });
      addCylinder(g, { radius: 0.03, height: 0.08, segments: 6, pos: [x, 0.79, 3.3], material: T.brass });
    }
    addBox(g, { size: [1.1, 0.05, 0.3], pos: [-4.7, 0.05, 3.3], material: M.metalDark });
    addBox(g, { size: [1.1, 0.04, 0.04], pos: [-4.7, 0.6, 3.17], material: M.metalDark });
    addLabel(g, 'EVA O₂ TÜPLERİ', { pos: [-4.7, 0.95, 3.455], rot: [0, Math.PI, 0], height: 0.055, style: 'stencil' });
    {
      const bx = 4.7;
      addBox(g, { size: [0.85, 1.0, 0.03], pos: [bx, 1.55, 3.485], material: T.paper });
      const items = ['EVA ÖNCESİ KONTROL', '□ O₂  %100', '□ BASINÇ TESTİ', '□ TELSİZ — KANAL 2', '□ BAĞLAMA HALATI', "□ TARS'A HABER VER", '□ ŞAKA YAPMA (TARS)'];
      items.forEach((t, i) => addLabel(g, t, { pos: [bx, 1.95 - i * 0.12, 3.468], rot: [0, Math.PI, 0], height: i ? 0.05 : 0.06, style: 'stencil' }));
      addCylinder(g, { radius: 0.2, height: 0.15, segments: 16, pos: [bx, 0.55, 3.38], rot: [Math.PI / 2, 0, 0], material: M.warning });
      addCylinder(g, { radius: 0.08, height: 0.17, segments: 10, pos: [bx, 0.55, 3.38], rot: [Math.PI / 2, 0, 0], material: M.metalDark });
      addLabel(g, 'BAĞLAMA HALATI', { pos: [bx, 0.25, 3.455], rot: [0, Math.PI, 0], height: 0.045, style: 'stencil' });
    }
    addVent(g, M, { pos: [-1.5, 2.55, 3.49], rot: [0, Math.PI, 0], w: 0.5, h: 0.3 });

    // ------------------------------------------------------------------
    // Döngü
    // ------------------------------------------------------------------
    let cycleT = -1; // <0 → boşta
    let pressure = P_ATM;
    let crack = 0;
    let failShown = false;
    const fired = new Set();
    const at = (k, time, fn) => {
      if (cycleT >= time && !fired.has(k)) {
        fired.add(k);
        fn();
      }
    };
    const hatchPos = mctx.toWorld(0, HATCH_Y, 3.2);

    mctx.interactions.add(btn, {
      id: 'airlock.cycle',
      prompt: () => (cycleT >= 0 ? 'Döngü sürüyor…' : 'Hava kilidi döngüsünü başlat'),
      enabled: () => cycleT < 0,
      onInteract: () => {
        if (!state.is('power_restored')) {
          audio.play('error');
          ui.toast('Kilit pompaları enerjisiz — döngü başlatılamıyor.');
          return;
        }
        cycleT = 0;
        fired.clear();
        failShown = false;
        cap.position.z = -0.02;
        audio.play('beep', { position: hatchPos });
        audio.play('alarm', { position: hatchPos, volume: 0.4 });
        ui.toast('Hava kilidi döngüsü başlatıldı — iç kapak kilitlendi, basınç düşürülüyor.', 3500);
      },
    });

    let screenT = 0;
    let lastPhase = null;
    let lastPowered = null;
    const phase = () => {
      if (cycleT < 0) return 'idle';
      if (cycleT < 5.0) return 'down';
      if (cycleT < 6.4) return 'open';
      if (cycleT < 7.4) return 'fail';
      return 'up';
    };

    function drawScreen(t) {
      const s = scr.screen;
      const powered = state.is('power_restored');
      if (!powered) {
        drawNoPower(s);
        return;
      }
      screenOn(s);
      const ph = phase();
      s.draw((c, w, h) => {
        c.font = 'bold 21px monospace';
        c.fillText('HAVA KİLİDİ A-1', 12, 10);
        c.font = '16px monospace';
        if (ph === 'idle') {
          c.fillText('DURUM ....... HAZIR', 12, 44);
          c.fillText(`KİLİT ....... ${Math.round(pressure)} kPa`, 12, 68);
          c.fillText('TÜNEL ....... RANGER-1 KENETLİ', 12, 92);
          c.fillStyle = Math.floor(t * 1.5) % 2 ? '#ff6a40' : '#ffb347';
          c.fillText('TÜNEL BASINCI 0 kPa (!)', 12, 116);
          c.fillStyle = '#ffb347';
          c.fillText('[DÖNGÜ] düğmesine basın', 12, 160);
        } else if (ph === 'fail' || (ph === 'up' && failShown)) {
          c.fillStyle = Math.floor(t * 4) % 2 ? '#ff5030' : '#ffb347';
          c.font = 'bold 22px monospace';
          c.fillText('HATA', 12, 44);
          c.font = '16px monospace';
          c.fillText('RANGER KENETLENME TÜNELİ', 12, 76);
          c.fillText('BASINÇSIZ', 12, 98);
          c.fillText('EVA YETKİSİ YOK', 12, 130);
          c.fillStyle = '#ffb347';
          c.fillText(`KİLİT ....... ${Math.round(pressure)} kPa`, 12, 170);
          if (ph === 'up') c.fillText('BASINÇ GERİ VERİLİYOR…', 12, 194);
        } else {
          c.fillText(ph === 'down' ? 'BASINÇ DÜŞÜRÜLÜYOR…' : 'KİLİT DİŞLİLERİ AÇILIYOR…', 12, 44);
          c.fillText(`KİLİT ....... ${Math.round(pressure)} kPa`, 12, 68);
          c.strokeRect(12, 100, w - 24, 26);
          c.fillRect(15, 103, (w - 30) * (pressure / P_ATM), 20);
          c.fillText('UYARI: KAPAKTAN UZAK DURUN', 12, 150);
        }
      });
    }

    applyMetricUVs(g, M);

    mctx.onUpdate((dt, t) => {
      // döngü zaman çizelgesi (çizimden bağımsız ilerler)
      if (cycleT >= 0) {
        cycleT += dt;
        at('pump', 0.6, () => audio.play('airlock', { position: hatchPos }));
        if (cycleT < 5.0) pressure = P_ATM - (P_ATM - 3) * ease((cycleT - 0.6) / 4.4);
        at('unlock', 5.0, () => {
          audio.play('servo', { position: hatchPos });
          audio.play('hiss', { position: hatchPos, volume: 0.5 });
        });
        at('crack', 5.8, () => audio.play('click', { position: hatchPos }));
        if (cycleT >= 5.8 && cycleT < 6.4) crack = ease((cycleT - 5.8) / 0.4);
        at('fail', 6.4, () => {
          failShown = true;
          audio.play('error', { position: hatchPos });
          ui.toast('Ranger kenetlenme tüneli basınçsız — EVA yetkisi yok. Kapak yeniden kilitlendi.', 6000);
        });
        if (cycleT >= 6.4 && cycleT < 7.2) crack = 1 - ease((cycleT - 6.4) / 0.8);
        at('repress', 7.4, () => audio.play('hiss', { position: hatchPos }));
        if (cycleT >= 7.4) pressure = 3 + (P_ATM - 3) * ease((cycleT - 7.4) / 2.6);
        if (cycleT >= 10.2) {
          cycleT = -1;
          crack = 0;
          pressure = P_ATM;
          cap.position.z = -0.035;
          audio.play('success', { position: hatchPos, volume: 0.5 });
        }
      }
      // uyarı ışığı
      if (cycleT >= 0) {
        const red = cycleT >= 6.4 && cycleT < 8.5;
        const f = Math.max(0, Math.cos(t * (red ? 14 : 8)));
        const k = Math.pow(f, 3);
        beaconMat.emissive.copy(red ? REDC : AMBER);
        beaconMat.emissiveIntensity = 0.3 + 4 * k;
        beaconLight.color.copy(red ? REDC : AMBER);
        beaconLight.emergency.color.copy(beaconLight.color);
        beaconLight.intensity = 0.4 + 5 * k;
        beaconLight.emergency.intensity = beaconLight.intensity;
      } else if (beaconLight.intensity !== 0) {
        beaconLight.intensity = 0;
        beaconLight.emergency.intensity = 0;
        beaconMat.emissiveIntensity = 0;
      }
      if (!near()) return;
      gauge.set(pressure / 200 + (cycleT >= 0 ? Math.sin(t * 9) * 0.004 : 0));
      // kapak: tekerlek döner, hafifçe aralanır
      if (cycleT >= 5.0 && cycleT < 5.8) wheel.rotation.z += dt * 6;
      if (cycleT >= 6.6 && cycleT < 7.4) wheel.rotation.z -= dt * 6;
      door.rotation.y = -0.07 * crack;
      door.position.z = 3.28 - 0.02 * crack;
      screenT -= dt;
      const ph = phase();
      const powered = state.is('power_restored');
      if (screenT > 0 && ph === lastPhase && powered === lastPowered) return;
      screenT = cycleT >= 0 ? 0.1 : 0.4;
      lastPhase = ph;
      lastPowered = powered;
      drawScreen(t);
    });
  },
};
