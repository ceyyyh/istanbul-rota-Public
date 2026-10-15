import * as THREE from 'three';
import { buildShell } from '../structure/shell.js';
import { addBox, addCylinder, addMesh } from '../utils.js';
import { getTechMaterials, canvasTex } from './tech/materials.js';
import { addLabel } from './tech/labels.js';
import {
  addPipe,
  addRod,
  addCollar,
  makeHandwheel,
  addGauge,
  addHazard,
  addCableBundle,
  addVent,
  addExtinguisher,
  addBlocker,
  addScreen,
  drawNoPower,
  screenOn,
  nearChecker,
  finalizeDynamic,
  accusative,
  applyMetricUVs,
} from './tech/kit.js';
import { FusePuzzle, FUSE_ORDER, FUSE_NAMES } from './tech/fusePuzzle.js';
import { createSparks } from './tech/sparks.js';

/**
 * Motor ve Enerji (modül 6) — GÖREVİN KİLİT NOKTASI.
 *
 * - Dış duvar tarafında (z ≈ -2.25) tavana kadar uzanan silindirik reaktör çekirdeği; dönen
 *   manyetik halkalar, cam pencereden görünen çekirdek (acil modda sönük kırmızı, enerjiyle parlak mavi-beyaz).
 * - İç duvarda (+Z) 5 kollu sigorta paneli (PDU-2). Doğru sıra teşhis ekranında: 3-1-4-2-5.
 *   Yanlış sıra → kıvılcım + kırmızı flaş + hepsi atar. Doğru sıra → state.set('power_restored').
 * - Pompalar, borular, basınç göstergeleri, soğutucu ana vanası (etkileşimli), yedek batarya rafı.
 */

const RZ = -2.25; // reaktör merkezi (yerel z)
const LEVER_UP = THREE.MathUtils.degToRad(55);
const LEVER_DOWN = THREE.MathUtils.degToRad(-55);
const FUSE_Y = 1.35;
const FUSE_Z = 3.06; // kol mafsalı
const fuseX = (n) => 3.0 - (n - 1) * 0.55; // oyuncu +Z'ye bakınca 1 solda, 5 sağda

const RED = new THREE.Color(0xff2a10);
const CYAN = new THREE.Color(0x9fe2ff);
const ROD_RED = new THREE.Color(0xff5020);
const ROD_CYAN = new THREE.Color(0x6ad0ff);

export default {
  id: 'engine',
  name: 'Motor ve Enerji',
  build(mctx) {
    const M = mctx.materials;
    const T = getTechMaterials();
    const g = mctx.group;
    const { state, audio, ui } = mctx;

    buildShell(mctx, { wall: 'dark', floor: 'grate', hull: 'engine', outerWindows: [], lights: 2, accent: 0xd2602a });

    // Modüle özel (animasyonlu) malzemeler — paylaşılan kütüphaneyi bozmamak için kopya
    const coreMat = T.reactorCore.clone();
    coreMat.name = 'engine.core';
    const rodMat = T.reactorRod.clone();
    rodMat.name = 'engine.rods';
    const strobeMat = T.beaconRed.clone();
    strobeMat.name = 'engine.strobe';
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x222018, emissive: 0xffd9a0, emissiveIntensity: 1.5, roughness: 0.4 });
    lampMat.name = 'engine.worklamp';
    mctx.addEmissive(lampMat, { normal: { color: 0xfff0d8, intensity: 1.6 }, emergency: { color: 0xff9a40, intensity: 1.8 } });
    const ledOff = new THREE.MeshStandardMaterial({ color: 0x1a0606, roughness: 0.5 });
    ledOff.name = 'engine.ledOff';

    const near = nearChecker(mctx, 13);

    // ------------------------------------------------------------------
    // Işıklar: kabuk 2 + reaktör parıltısı + sigorta paneli çalışma lambası = 4
    // ------------------------------------------------------------------
    const reactorLight = mctx.addLight([0, 1.5, -0.9], {
      color: 0x8fd0ff,
      intensity: 7,
      distance: 7.5,
      emergency: { color: 0xff2a10, intensity: 2.4 },
    });
    const panelLight = mctx.addLight([1.9, 2.55, 2.3], {
      color: 0xfff0dc,
      intensity: 3.2,
      distance: 5,
      emergency: { color: 0xff9a40, intensity: 2.6 },
    });
    const panelLightBase = {
      color: panelLight.color.clone(),
      intensity: panelLight.intensity,
      eColor: panelLight.emergency.color.clone(),
      eIntensity: panelLight.emergency.intensity,
    };

    // ------------------------------------------------------------------
    // REAKTÖR
    // ------------------------------------------------------------------
    const R = new THREE.Group();
    R.name = 'reaktör';
    R.position.set(0, 0, RZ);
    g.add(R);
    // kaide + zemin tehlike halkası
    addCylinder(R, { radius: 1.2, height: 0.2, segments: 24, pos: [0, 0.1, 0], material: M.metalDark });
    {
      const ring = new THREE.RingGeometry(1.28, 1.46, 24, 1);
      const uv = ring.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 10, uv.getY(i) * 10);
      const m = addMesh(R, ring, T.hazard, { pos: [0, 0.006, 0], rot: [-Math.PI / 2, 0, 0] });
      m.userData.noShadow = true;
    }
    // alt gövde (çarpışma: tüm reaktör için tek kutu)
    addCylinder(R, { radius: 0.95, height: 0.65, segments: 24, pos: [0, 0.52, 0], material: T.graphite });
    addBlocker(R, { size: [2.2, 2.4, 2.2], pos: [0, 1.4, 0] });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const rib = addBox(R, { size: [0.08, 0.6, 0.06], pos: [Math.cos(a) * 0.97, 0.52, Math.sin(a) * 0.97], material: M.metalDark });
      rib.rotation.y = -a;
    }
    addCylinder(R, { radius: 0.82, height: 0.08, segments: 24, pos: [0, 0.88, 0], material: M.metal });
    addCylinder(R, { radius: 0.82, height: 0.08, segments: 24, pos: [0, 2.14, 0], material: M.metal });
    // çekirdek + yakıt çubukları + cam
    addCylinder(R, { radius: 0.3, height: 1.2, segments: 20, pos: [0, 1.51, 0], material: coreMat });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      addCylinder(R, { radius: 0.045, height: 1.2, segments: 8, pos: [Math.cos(a) * 0.5, 1.51, Math.sin(a) * 0.5], material: rodMat });
    }
    addCylinder(R, { radius: 0.72, height: 1.18, segments: 24, openEnded: true, pos: [0, 1.51, 0], material: M.glass });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const s = addBox(R, { size: [0.07, 1.2, 0.07], pos: [Math.cos(a) * 0.76, 1.51, Math.sin(a) * 0.76], material: M.metal });
      s.rotation.y = -a;
    }
    // halka yatak rayları (sabit)
    for (const y of [1.05, 1.97]) {
      addMesh(R, new THREE.TorusGeometry(1.06, 0.022, 6, 32), M.metalDark, { pos: [0, y - 0.11, 0], rot: [Math.PI / 2, 0, 0] });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        addRod(R, [Math.cos(a) * 0.79, y - 0.11, Math.sin(a) * 0.79], [Math.cos(a) * 1.06, y - 0.11, Math.sin(a) * 1.06], { radius: 0.018, material: M.metalDark, segments: 6 });
      }
    }
    // dönen manyetik halkalar (dinamik, kendi içinde birleştirilmiş)
    const makeRing = (y, n) => {
      const ring = new THREE.Group();
      ring.position.set(0, y, 0);
      addMesh(ring, new THREE.TorusGeometry(0.98, 0.045, 8, 36), M.metal, { rot: [Math.PI / 2, 0, 0] });
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const c = addBox(ring, { size: [0.12, 0.18, 0.2], pos: [Math.cos(a) * 0.98, 0, Math.sin(a) * 0.98], material: T.coil });
        c.rotation.y = -a;
        const cap = addBox(ring, { size: [0.035, 0.2, 0.16], pos: [Math.cos(a) * 1.05, 0, Math.sin(a) * 1.05], material: T.graphite });
        cap.rotation.y = -a;
      }
      R.add(ring);
      return finalizeDynamic(ring);
    };
    const ringA = makeRing(1.05, 8);
    const ringB = makeRing(1.97, 10);
    // üst gövde + taç + tavana çıkan iletkenler
    addCylinder(R, { radius: 0.95, height: 0.5, segments: 24, pos: [0, 2.43, 0], material: T.graphite });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.13;
      const rib = addBox(R, { size: [0.06, 0.46, 0.05], pos: [Math.cos(a) * 0.96, 2.43, Math.sin(a) * 0.96], material: M.metalDark });
      rib.rotation.y = -a;
    }
    addCylinder(R, { radiusTop: 0.5, radiusBottom: 0.9, height: 0.28, segments: 24, pos: [0, 2.82, 0], material: M.metalDark });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      addCylinder(R, { radius: 0.09, height: 0.3, segments: 10, pos: [Math.cos(a) * 0.3, 3.08, Math.sin(a) * 0.3], material: T.copper });
    }
    addCylinder(R, { radius: 0.62, height: 0.06, segments: 24, pos: [0, 3.17, 0], material: M.metal });
    // reaktör etiketleri (koridora bakan yüz)
    addLabel(R, 'REAKTÖR ÇEKİRDEĞİ  RX-1', { pos: [0, 0.62, 0.975], height: 0.07, style: 'tag' });
    addLabel(R, 'YETKİSİZ MÜDAHALE YASAK', { pos: [0, 0.48, 0.975], height: 0.045, style: 'warn' });
    addLabel(R, 'YÜKSEK SICAKLIK', { pos: [0, 2.43, 0.975], height: 0.06, style: 'yellow' });

    // reaktörden pompalara soğutucu hatları (mavi) ve sıcak hatlar (kırmızı)
    for (const sx of [-1, 1]) {
      addPipe(R, [[sx * 0.9, 0.5, -0.3], [sx * 2.8, 0.5, -0.3]], { radius: 0.075, material: T.pipeBlue });
      addCollar(R, [sx * 1.6, 0.5, -0.3], [1, 0, 0], { radius: 0.095 });
      addBlocker(R, { size: [1.8, 0.7, 0.5], pos: [sx * 1.95, 0.5, -0.3] });
      addPipe(R, [[sx * 0.95, 2.43, -0.2], [sx * 2.2, 2.43, -0.2], [sx * 2.2, 2.95, -0.2], [sx * 5.45, 2.95, -0.2]], { radius: 0.085, material: T.pipeRed });
      addCollar(R, [sx * 3.6, 2.95, -0.2], [1, 0, 0], { radius: 0.11 });
      addLabel(R, sx > 0 ? 'SICAK HAT →' : '← SICAK HAT', { pos: [sx * 3.0, 2.95, -0.11], height: 0.05, style: 'white' });
      addLabel(R, 'SOĞUTUCU', { pos: [sx * 2.1, 0.5, -0.22], height: 0.045, style: 'white' });
    }

    // ------------------------------------------------------------------
    // POMPALAR (dış duvar boyunca, reaktörün iki yanında)
    // ------------------------------------------------------------------
    const pumpGauges = [];
    for (const sx of [-1, 1]) {
      const px = sx * 3.4;
      const pz = -2.75;
      addBox(g, { size: [1.2, 1.25, 1.1], pos: [px, 0.625, pz], material: M.panelMid, collide: true, name: 'pompa' });
      addBox(g, { size: [1.26, 0.08, 1.16], pos: [px, 0.04, pz], material: M.metalDark });
      addBox(g, { size: [1.24, 0.05, 1.14], pos: [px, 1.27, pz], material: M.metalDark });
      // motor (yatay silindir) + soğutma kanatçıkları
      addCylinder(g, { radius: 0.26, height: 0.8, segments: 16, pos: [px, 1.55, pz - 0.05], rot: [0, 0, Math.PI / 2], material: T.pipeGreen });
      for (let i = 0; i < 6; i++) addCylinder(g, { radius: 0.29, height: 0.025, segments: 16, pos: [px - 0.3 + i * 0.12, 1.55, pz - 0.05], rot: [0, 0, Math.PI / 2], material: M.metalDark });
      addCylinder(g, { radius: 0.12, height: 0.12, segments: 12, pos: [px + sx * 0.46, 1.55, pz - 0.05], rot: [0, 0, Math.PI / 2], material: M.metal });
      addVent(g, M, { pos: [px, 0.45, pz + 0.555], w: 0.8, h: 0.4 });
      addLabel(g, sx > 0 ? 'POMPA B' : 'POMPA A', { pos: [px, 1.12, pz + 0.556], height: 0.08, style: 'stencil' });
      addHazard(g, { w: 1.2, h: 0.06, pos: [px, 0.12, pz + 0.556] });
      for (const k of [-1, 1]) {
        const gg = addGauge(g, { pos: [px + k * 0.3, 0.86, pz + 0.565], radius: 0.085, value: 0.12, dynamic: true });
        pumpGauges.push({ ...gg, base: k > 0 ? 0.55 : 0.62, phase: Math.random() * 10 });
      }
      // pompadan tavana hidrojen hattı (sarı)
      addPipe(g, [[px - sx * 0.35, 1.27, pz - 0.3], [px - sx * 0.35, 2.7, pz - 0.3], [px - sx * 0.35, 2.7, -3.42]], { radius: 0.05, material: M.warning });
      addLabel(g, 'HİDROJEN', { pos: [px - sx * 0.35, 2.05, pz - 0.24], rot: [0, 0, Math.PI / 2], height: 0.045, style: 'stencil' });
    }

    // Yedek batarya rafı (+X, dış köşe) — acil durum gücünü sağlıyor
    {
      const bx = 4.85;
      const bz = -2.85;
      addBox(g, { size: [0.9, 2.1, 0.9], pos: [bx, 1.05, bz], material: M.panelDark, collide: true, name: 'batarya' });
      for (let r = 0; r < 4; r++) {
        const y = 0.35 + r * 0.45;
        addBox(g, { size: [0.8, 0.36, 0.04], pos: [bx, y, bz + 0.45], material: M.metalDark });
        for (let c = 0; c < 3; c++) addBox(g, { size: [0.05, 0.03, 0.02], pos: [bx - 0.25 + c * 0.25, y + 0.12, bz + 0.475], material: r < 1 ? M.ledAmber : ledOff });
      }
      addLabel(g, 'YEDEK BATARYA', { pos: [bx, 2.0, bz + 0.455], height: 0.07, style: 'white' });
      addLabel(g, 'ŞARJ %23', { pos: [bx, 1.88, bz + 0.455], height: 0.045, style: 'yellow' });
    }
    // -X dış köşe: soğutucu genleşme tankı
    {
      const tx = -4.85;
      const tz = -2.8;
      addCylinder(g, { radius: 0.42, height: 2.0, segments: 20, pos: [tx, 1.1, tz], material: M.hullWhite, collide: true, name: 'tank' });
      addMesh(g, new THREE.SphereGeometry(0.42, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.hullWhite, { pos: [tx, 2.1, tz] });
      addCylinder(g, { radius: 0.44, height: 0.1, segments: 20, pos: [tx, 0.05, tz], material: M.metalDark });
      addCylinder(g, { radius: 0.43, height: 0.05, segments: 20, pos: [tx, 1.5, tz], material: T.pipeBlue });
      addLabel(g, 'SOĞUTUCU TANKI', { pos: [tx + 0.32, 1.25, tz + 0.32], rot: [0, Math.PI / 4, 0], height: 0.05, style: 'stencil' });
      addPipe(g, [[tx + 0.3, 0.35, tz + 0.3], [-4.0, 0.35, -2.45], [-4.0, 0.35, -2.3]], { radius: 0.045, material: T.pipeBlue, flanges: false });
    }

    // dış duvar: elektrik kutuları + kablo demetleri
    for (const sx of [-1, 1]) {
      addBox(g, { size: [0.5, 0.6, 0.18], pos: [sx * 1.85, 1.75, -3.41], material: M.panelMid });
      addLabel(g, '400 V', { pos: [sx * 1.85, 1.95, -3.315], height: 0.06, style: 'warn' });
      addBox(g, { size: [0.06, 0.06, 0.02], pos: [sx * 1.85 + 0.15, 1.6, -3.315], material: M.ledGreen });
      addCableBundle(g, [sx * 1.85, 2.05, -3.4], [sx * 1.0, 2.6, -3.3], { sag: 0.18, count: 3 });
      addCableBundle(g, [sx * 2.1, 1.45, -3.38], [sx * 2.85, 1.3, -3.3], { sag: 0.12, count: 2 });
    }

    // ------------------------------------------------------------------
    // SİGORTA PANELİ (iç duvar, +Z)
    // ------------------------------------------------------------------
    const P = new THREE.Group();
    P.name = 'sigorta-paneli';
    g.add(P);
    const cabX = 1.9;
    addBox(P, { size: [2.9, 1.8, 0.3], pos: [cabX, 1.45, 3.35], material: M.panelMid, collide: true, name: 'PDU-2' });
    addBox(P, { size: [2.98, 0.06, 0.34], pos: [cabX, 2.38, 3.33], material: M.metalDark });
    addBox(P, { size: [2.98, 0.06, 0.34], pos: [cabX, 0.52, 3.33], material: M.metalDark });
    addHazard(P, { w: 2.8, h: 0.07, pos: [cabX, 2.28, 3.197], rot: [0, Math.PI, 0] });
    addHazard(P, { w: 2.8, h: 0.07, pos: [cabX, 0.62, 3.197], rot: [0, Math.PI, 0] });
    addLabel(P, 'ANA GÜÇ DAĞITIM PANELİ  —  PDU-2', { pos: [cabX, 2.15, 3.196], rot: [0, Math.PI, 0], height: 0.075, style: 'white' });
    addLabel(P, 'DİKKAT: YÜKSEK GERİLİM', { pos: [cabX, 0.74, 3.196], rot: [0, Math.PI, 0], height: 0.06, style: 'warn' });
    // panel üstünde kafesli çalışma lambası + flaşör
    addBox(P, { size: [0.5, 0.05, 0.16], pos: [cabX, 2.62, 3.38], material: M.metalDark });
    addBox(P, { size: [0.42, 0.05, 0.1], pos: [cabX, 2.585, 3.33], material: lampMat });
    for (let i = 0; i < 4; i++) addBox(P, { size: [0.01, 0.06, 0.12], pos: [cabX - 0.18 + i * 0.12, 2.56, 3.33], material: M.metalDark });
    addCylinder(P, { radius: 0.06, height: 0.1, segments: 12, pos: [cabX + 1.25, 2.47, 3.3], material: strobeMat });
    addCylinder(P, { radius: 0.07, height: 0.03, segments: 12, pos: [cabX + 1.25, 2.42, 3.3], material: M.metalDark });

    const ledMats = { red: M.ledRed, green: M.ledGreen, amber: M.ledAmber, off: ledOff };
    const levers = [];
    const ledGroup = new THREE.Group();
    ledGroup.name = 'sigorta-ledleri';
    ledGroup.userData.dynamic = true;
    P.add(ledGroup);
    for (let n = 1; n <= 5; n++) {
      const x = fuseX(n);
      // gövde, yuva, AÇIK/KAPALI işaretleri
      addBox(P, { size: [0.38, 0.62, 0.12], pos: [x, FUSE_Y, 3.14], material: T.graphite });
      addBox(P, { size: [0.2, 0.44, 0.012], pos: [x, FUSE_Y, 3.077], material: M.plasticDark });
      addLabel(P, 'AÇIK', { pos: [x, FUSE_Y + 0.27, 3.0785], rot: [0, Math.PI, 0], height: 0.032, style: 'white' });
      addLabel(P, 'KAPALI', { pos: [x, FUSE_Y - 0.27, 3.0785], rot: [0, Math.PI, 0], height: 0.032, style: 'white' });
      // büyük numara + alt sistem adı
      addLabel(P, String(n), { pos: [x, 1.96, 3.196], rot: [0, Math.PI, 0], height: 0.16, style: 'white' });
      addLabel(P, FUSE_NAMES[n], { pos: [x, 0.95, 3.196], rot: [0, Math.PI, 0], height: 0.036, style: 'tag' });
      // LED
      const led = addBox(ledGroup, { size: [0.07, 0.07, 0.02], pos: [x, 1.78, 3.19], material: M.ledRed });
      // kol (mafsal X ekseni; yerel -Z'ye doğru uzanır)
      const arm = new THREE.Group();
      arm.name = `sigorta-${n}`;
      arm.position.set(x, FUSE_Y, FUSE_Z);
      addCylinder(arm, { radius: 0.035, height: 0.24, segments: 10, rot: [0, 0, Math.PI / 2], material: M.metalDark });
      for (const k of [-1, 1]) addBox(arm, { size: [0.025, 0.03, 0.27], pos: [k * 0.075, 0, -0.135], material: M.metal });
      addCylinder(arm, { radius: 0.028, height: 0.22, segments: 10, pos: [0, 0, -0.27], rot: [0, 0, Math.PI / 2], material: M.accentOrange });
      for (const k of [-1, 1]) addCylinder(arm, { radius: 0.032, height: 0.02, segments: 10, pos: [k * 0.1, 0, -0.27], rot: [0, 0, Math.PI / 2], material: M.rubber });
      arm.rotation.x = LEVER_DOWN;
      P.add(arm);
      finalizeDynamic(arm);
      levers.push({ n, x, arm, led, angle: LEVER_DOWN, target: LEVER_DOWN });
    }
    // panelden reaktöre giden kablo kanalı (zeminde, yürünebilir rampa)
    addBox(g, { size: [0.3, 0.04, 4.2], pos: [0.25, 0.02, 1.0], material: M.warning });
    addBox(g, { size: [0.22, 0.045, 4.2], pos: [0.25, 0.022, 1.0], material: M.plasticDark });
    addCableBundle(g, [0.6, 0.6, 3.2], [0.25, 0.05, 3.0], { sag: 0.05, count: 3, spread: 0.04 });

    // Teşhis ekranı (yedek bataryayla çalışır → her zaman açık, amber)
    const diag = addScreen(g, M, {
      size: [0.78, 0.52],
      pos: [-0.55, 1.6, 3.46],
      rot: [0, Math.PI, 0],
      res: [512, 340],
      color: '#ffb347',
      background: '#0a0602',
    });
    diag.mesh.name = 'teşhis-ekranı';
    addLabel(g, 'TEŞHİS — YEDEK GÜÇ', { pos: [-0.55, 1.93, 3.495], rot: [0, Math.PI, 0], height: 0.045, style: 'black' });
    // Kâğıt not (bantlı)
    {
      const tex = canvasTex(256, 320, (c, w, h) => {
        c.fillStyle = '#e9e2cc';
        c.fillRect(0, 0, w, h);
        c.fillStyle = 'rgba(120,100,60,0.12)';
        c.fillRect(0, h - 40, w, 40);
        c.fillStyle = '#1d2f6b';
        c.font = 'italic bold 26px "DejaVu Serif", serif';
        const lines = ['PDU-2 sıfırlama:', 'ekrandaki sırayı izle!', '', `${FUSE_ORDER.join(' → ')}`, '', 'Yanlış sıra =', 'hepsi atar. (Kaşlarım', 'hâlâ uzamadı.)', '        — Müh. Aras'];
        lines.forEach((l, i) => c.fillText(l, 14, 34 + i * 31));
        c.strokeStyle = '#a3241a';
        c.lineWidth = 3;
        c.beginPath();
        c.ellipse(118, 125, 110, 24, 0, 0, Math.PI * 2);
        c.stroke();
      });
      const noteMat = new THREE.MeshStandardMaterial({ map: tex, color: tex ? 0xffffff : 0xe9e2cc, roughness: 0.9 });
      noteMat.name = 'engine.note';
      addMesh(g, new THREE.PlaneGeometry(0.2, 0.25), noteMat, { pos: [0.25, 1.52, 3.465], rot: [0, Math.PI, 0.06] });
      addBox(g, { size: [0.09, 0.025, 0.002], pos: [0.25, 1.645, 3.463], rot: [0, 0, 0.3], material: T.tape });
    }

    // ------------------------------------------------------------------
    // Soğutucu ana vanası (iç duvar, -X tarafı) — etkileşimli
    // ------------------------------------------------------------------
    const VX = -3.2;
    addPipe(g, [[VX, 0.0, 3.3], [VX, 3.2, 3.3]], { radius: 0.07, material: T.pipeBlue, flanges: false });
    addPipe(g, [[VX, 0.35, 3.3], [-4.15, 0.35, 3.3], [-4.15, 0.0, 3.3]], { radius: 0.06, material: T.pipeBlue, flanges: false });
    addMesh(g, new THREE.SphereGeometry(0.075, 10, 6), T.pipeBlue, { pos: [VX, 0.35, 3.3] });
    addBox(g, { size: [0.22, 0.26, 0.22], pos: [VX, 1.2, 3.3], material: M.metalDark });
    addCylinder(g, { radius: 0.03, height: 0.16, segments: 8, pos: [VX, 1.2, 3.13], rot: [Math.PI / 2, 0, 0], material: M.metal });
    for (const y of [0.9, 1.5, 2.4]) addCollar(g, [VX, y, 3.3], [0, 1, 0], { radius: 0.09, width: 0.04 });
    const wheel = makeHandwheel(0.17, T.pipeRed);
    wheel.position.set(VX, 1.2, 3.05);
    wheel.rotation.y = Math.PI;
    g.add(wheel);
    addLabel(g, 'SOĞUTUCU ANA VANA  V-12', { pos: [VX - 0.62, 1.6, 3.465], rot: [0, Math.PI, 0], height: 0.045, style: 'blue' });
    const valveGauge = addGauge(g, { pos: [VX - 0.32, 1.25, 3.4], rot: [0, Math.PI, 0], radius: 0.1, value: 0.15, dynamic: true });
    addPipe(g, [[VX - 0.32, 1.25, 3.42], [VX - 0.32, 1.25, 3.48]], { radius: 0.015, material: M.metal, flanges: false });
    let valveSpin = 0;
    let valveOpen = false;
    mctx.interactions.add(wheel, {
      id: 'engine.valve',
      prompt: () => (valveOpen ? 'Soğutucu vanasını kıs' : 'Soğutucu vanasını aç'),
      enabled: () => valveSpin <= 0,
      onInteract: () => {
        valveSpin = 1.2;
        valveOpen = !valveOpen;
        audio.play('hiss', { position: mctx.toWorld(VX, 1.2, 3.05) });
        if (!state.is('power_restored')) ui.toast('Vana döndü ama hatta basınç yok — pompalar enerjisiz.');
        else ui.toast(valveOpen ? 'Soğutucu akışı artırıldı. Reaktör sıcaklığı düşüyor.' : 'Soğutucu akışı normale alındı.');
      },
    });

    // -X iç köşe: alet dolabı, söndürücü, korkuluk
    addBox(g, { size: [0.9, 2.0, 0.55], pos: [-4.75, 1.0, 3.2], material: T.pipeGreen, collide: true, name: 'alet-dolabı' });
    addBox(g, { size: [0.02, 1.8, 0.01], pos: [-4.75, 1.0, 2.92], material: M.metalDark });
    for (const sx of [-1, 1]) addBox(g, { size: [0.03, 0.18, 0.03], pos: [-4.75 + sx * 0.06, 1.1, 2.91], material: M.metal });
    addLabel(g, 'ALET DOLABI', { pos: [-4.75, 1.8, 2.92], rot: [0, Math.PI, 0], height: 0.06, style: 'white' });
    addExtinguisher(g, M, { x: -1.6, z: 3.42, side: -1 });
    addVent(g, M, { pos: [-1.6, 2.6, 3.49], rot: [0, Math.PI, 0], w: 0.6, h: 0.35 });
    // tavanda iç tarafta borular (askılı)
    for (const [z, mat, r] of [
      [1.7, T.pipeWhite, 0.06],
      [2.05, T.pipeGreen, 0.05],
      [2.35, M.warning, 0.04],
    ]) {
      addPipe(g, [[-5.45, 2.95, z], [5.45, 2.95, z]], { radius: r, material: mat, flanges: false, joints: false });
    }
    for (const x of [-4.4, -2.2, 0, 2.2, 4.4]) {
      addBox(g, { size: [0.03, 0.2, 0.8], pos: [x, 3.05, 2.05], material: M.metalDark });
    }
    addLabel(g, 'O₂ HATTI', { pos: [-1.2, 2.95, 1.635], rot: [0, Math.PI, 0], height: 0.045, style: 'stencil' });
    // tavan kirişinden sarkan kablolar (dış taraf)
    for (let i = 0; i < 6; i++) addCableBundle(g, [-5.2 + i * 1.8, 3.08, -1.78], [-3.6 + i * 1.8, 3.08, -1.78], { sag: 0.12, count: 2, spread: 0.05 });

    // ------------------------------------------------------------------
    // Reaktör durum konsolu (enerji gerekir)
    // ------------------------------------------------------------------
    {
      const cx = 2.0;
      const cz = -1.5;
      addBox(g, { size: [0.7, 0.95, 0.4], pos: [cx, 0.475, cz], material: M.panelMid, collide: true, name: 'konsol' });
      const top = addBox(g, { size: [0.74, 0.05, 0.5], pos: [cx, 1.0, cz + 0.02], material: M.metalDark });
      top.rotation.x = 0.35;
      addLabel(g, 'ÇEKİRDEK DURUMU', { pos: [cx, 0.8, cz + 0.205], height: 0.05, style: 'black' });
    }
    const coreScr = addScreen(g, M, {
      size: [0.56, 0.34],
      pos: [2.0, 1.28, -1.62],
      rot: [-0.35, 0, 0],
      res: [448, 272],
      color: '#7fd8ff',
      background: '#01060a',
    });
    coreScr.mesh.name = 'çekirdek-ekranı';
    addBox(g, { size: [0.08, 0.3, 0.08], pos: [2.0, 1.05, -1.7], material: M.metalDark });

    // ------------------------------------------------------------------
    // Bulmaca mantığı
    // ------------------------------------------------------------------
    const puzzle = new FusePuzzle(FUSE_ORDER);
    const sparks = createSparks(g, { count: 56 });
    let faultT = 0; // >0 → aşırı akım arızası sürüyor
    let faultDropAt = 0; // arıza başında kollar bu süre sonra düşer
    let faultLever = null;
    let power = state.is('power_restored') ? 1 : 0;
    let celebrateT = 0;

    const pos3 = (x, y, z) => mctx.toWorld(x, y, z);

    function drawDiag(t = 0) {
      const s = diag.screen;
      if (!s.ctx) return;
      const solved = puzzle.solved || state.is('power_restored');
      s.draw((c, w, h) => {
        c.font = 'bold 22px monospace';
        c.fillText('PDU-2  GÜÇ DAĞITIM TEŞHİSİ', 16, 12);
        c.font = '17px monospace';
        c.fillStyle = 'rgba(255,179,71,0.75)';
        c.fillText(solved ? 'KAYNAK: ANA BARA' : 'KAYNAK: YEDEK BATARYA %23', 16, 42);
        c.fillRect(16, 66, w - 32, 2);
        c.fillStyle = '#ffb347';
        c.font = '20px monospace';
        if (solved) {
          c.fillText('ANA BARA ........ ENERJİLİ', 16, 80);
          c.fillText('REAKTÖR ......... ÇEVRİMİÇİ', 16, 106);
          c.fillText('SİGORTALAR ...... 5/5 DEVREDE', 16, 132);
        } else {
          c.fillText('ANA BARA ........ DEVRE DIŞI', 16, 80);
          c.fillText('REAKTÖR ......... BEKLEMEDE', 16, 106);
          c.fillStyle = faultT > 0 && Math.floor(t * 8) % 2 ? '#ff5030' : '#ffb347';
          c.fillText(faultT > 0 ? 'HATA: AŞIRI AKIM! TÜMÜ ATTI' : `SİGORTALAR ...... ${puzzle.progress}/5 DEVREDE`, 16, 132);
          c.fillStyle = '#ffb347';
        }
        c.font = 'bold 20px monospace';
        c.fillText('SIFIRLAMA SIRASI:', 16, 168);
        // sıra kutuları
        const bw = 72;
        const gap = 20;
        const x0 = (w - (bw * 5 + gap * 4)) / 2;
        for (let i = 0; i < 5; i++) {
          const n = FUSE_ORDER[i];
          const done = solved || i < puzzle.progress;
          const next = !solved && faultT <= 0 && i === puzzle.progress;
          const bx = x0 + i * (bw + gap);
          c.strokeStyle = '#ffb347';
          c.lineWidth = next && Math.floor(t * 2.5) % 2 ? 5 : 2;
          if (done) {
            c.fillStyle = '#ffb347';
            c.fillRect(bx, 198, bw, 64);
            c.fillStyle = '#0a0602';
          } else {
            c.strokeRect(bx, 198, bw, 64);
            c.fillStyle = '#ffb347';
          }
          c.font = 'bold 46px monospace';
          c.textAlign = 'center';
          c.fillText(String(n), bx + bw / 2, 206);
          c.textAlign = 'left';
          c.fillStyle = '#ffb347';
        }
        c.font = '17px monospace';
        c.fillStyle = 'rgba(255,179,71,0.8)';
        c.fillText(solved ? 'Panel normal. İyi iş, mühendis.' : 'UYARI: Yanlış sıra → panel tümünü atar.', 16, 282);
        if (!solved && Math.floor(t * 2) % 2) c.fillRect(16, 310, 12, 18);
      });
    }

    function drawCore(t) {
      const s = coreScr.screen;
      if (!s.ctx) return;
      if (!state.is('power_restored')) {
        drawNoPower(s);
        return;
      }
      screenOn(s);
      s.draw((c, w, h) => {
        c.font = 'bold 22px monospace';
        c.fillText('RX-1 ÇEKİRDEK', 14, 10);
        c.font = '18px monospace';
        const pct = Math.round(power * 100);
        c.fillText(`ÇIKIŞ   : %${pct}`, 14, 44);
        c.fillText(`SICAKLIK: ${Math.round(310 + 420 * power + Math.sin(t) * 4)} K`, 14, 68);
        c.fillText(`HALKA   : ${Math.round(power * 1180 + Math.sin(t * 3) * 6)} dev/dk`, 14, 92);
        c.fillText(`SOĞUTMA : ${valveOpen ? 'YÜKSEK' : 'NORMAL'}`, 14, 116);
        // akış grafiği
        c.strokeStyle = '#7fd8ff';
        c.lineWidth = 2;
        c.strokeRect(14, 148, w - 28, h - 162);
        c.beginPath();
        for (let i = 0; i <= 60; i++) {
          const x = 14 + ((w - 28) * i) / 60;
          const v = 0.55 + 0.25 * Math.sin(i * 0.35 + t * 3) * Math.sin(i * 0.11 + t) * power;
          const y = 148 + (h - 162) * (1 - v);
          if (i === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
        c.stroke();
      });
    }

    function setLed(l, mat) {
      if (l.led.material !== mat) l.led.material = mat;
    }

    function showSolved(animate) {
      puzzle.solve();
      if (!animate) power = 1;
      for (const l of levers) {
        l.target = LEVER_UP;
        if (!animate) {
          l.angle = LEVER_UP;
          l.arm.rotation.x = LEVER_UP;
        }
        setLed(l, ledMats.green);
      }
      faultT = 0;
      drawDiag(0);
      drawCore(0);
    }

    function raise(n) {
      if (puzzle.solved || faultT > 0) return;
      const l = levers[n - 1];
      const at = pos3(l.x, FUSE_Y, FUSE_Z - 0.2);
      const res = puzzle.raise(n);
      if (res === 'ignored') return;
      l.target = LEVER_UP;
      audio.play('switch', { position: at });
      if (res === 'ok') {
        setLed(l, ledMats.green);
        ui.toast(`Sigorta ${n} devrede (${puzzle.progress}/5) — ${FUSE_NAMES[n]}`);
        audio.play('beep', { position: at, volume: 0.5 });
      } else if (res === 'wrong') {
        faultT = 1.6;
        faultDropAt = 1.6 - 0.45;
        faultLever = l;
        setLed(l, ledMats.amber);
      } else if (res === 'solved') {
        setLed(l, ledMats.green);
        celebrateT = 1.5;
        ui.toast('Ana bara enerjilendi — GÜÇ GERİ GELDİ!', 4000);
        audio.play('power_up');
        state.set('power_restored', true);
      }
      drawDiag(mctx.engine.time || 0);
    }

    for (const l of levers) {
      mctx.interactions.add(l.arm, {
        id: `engine.fuse${l.n}`,
        prompt: () => `Sigorta ${accusative(l.n)} kaldır`,
        enabled: () => !puzzle.solved && !puzzle.isUp(l.n) && faultT <= 0 && l.target === LEVER_DOWN,
        distance: 2.8,
        onInteract: () => raise(l.n),
      });
    }

    mctx.interactions.add(diag.mesh, {
      id: 'engine.diag',
      prompt: 'Teşhis ekranını oku',
      distance: 3.0,
      onInteract: () => {
        audio.play('terminal');
        const solved = puzzle.solved || state.is('power_restored');
        ui.openTerminal({
          title: 'PDU-2 — GÜÇ DAĞITIM TEŞHİSİ',
          color: '#ffb347',
          lines: solved
            ? [
                'KAYNAK ........ ANA BARA (RX-1)',
                'SİGORTALAR .... 5/5 DEVREDE',
                '',
                'Tüm alt sistemler beslemede.',
                'İletişim ve kumanda modülleri artık enerjili.',
              ]
            : [
                'KAYNAK ........ YEDEK BATARYA (%23)',
                'ANA BARA ...... DEVRE DIŞI (aşırı akım koruması)',
                '',
                `SIFIRLAMA SIRASI:  ${FUSE_ORDER.join(' - ')}`,
                '',
                ...FUSE_ORDER.map((n, i) => `  ${i + 1}. adım → Sigorta ${n}  (${FUSE_NAMES[n]})`),
                '',
                'Kolları bu sırayla tek tek kaldırın.',
                'Yanlış sıra → panel tüm sigortaları yeniden atar.',
              ],
          options: [{ label: 'Kapat', action: () => {} }],
        });
      },
    });
    mctx.interactions.add(coreScr.mesh, {
      id: 'engine.core',
      prompt: 'Çekirdek durumunu incele',
      distance: 2.6,
      onInteract: () => {
        if (!state.is('power_restored')) {
          ui.toast('Ekran karanlık — reaktör beklemede. Sigorta panelini sıfırla.');
          audio.play('error');
          return;
        }
        audio.play('terminal');
        ui.openTerminal({
          title: 'RX-1 ÇEKİRDEK DURUMU',
          lines: [
            `Çıkış gücü ......... %${Math.round(power * 100)}`,
            'Manyetik halkalar .. SENKRON',
            `Soğutma ............ ${valveOpen ? 'YÜKSEK AKIŞ' : 'NORMAL'}`,
            'Yakıt ömrü ......... tahmini 41 yıl (Dünya zamanı)',
            '',
            'Not: Kütleçekim kuyusuna yaklaşıldığında yakıt',
            'tüketimi yeniden hesaplanmalıdır.',
          ],
          options: [{ label: 'Kapat', action: () => {} }],
        });
      },
    });

    // Enerji başka bir yoldan gelirse (bayrak, hata ayıklama) paneli tamamlanmış göster
    state.when('power_restored', () => {
      if (!puzzle.solved) showSolved(false);
    });
    if (state.is('power_restored')) showSolved(false);
    drawDiag(0);
    drawCore(0);

    // ------------------------------------------------------------------
    // Güncelleme
    // ------------------------------------------------------------------
    let screenTimer = 0;
    let wasNear = false;
    mctx.onUpdate((dt, t) => {
      const powered = state.is('power_restored');
      power += ((powered ? 1 : 0) - power) * Math.min(1, dt * 0.45);
      if (powered && power > 0.995) power = 1;

      // Arıza zamanlayıcısı (çizim olmadan da ilerler)
      if (faultT > 0) {
        const prev = faultT;
        faultT -= dt;
        if (prev > faultDropAt && faultT <= faultDropAt) {
          // aşırı akım: kıvılcım, hata sesi, tüm kollar düşer
          const l = faultLever || levers[0];
          sparks.burst([l.x, FUSE_Y + 0.05, FUSE_Z - 0.05], { dir: [0, 0.3, -1], speed: 2.4 });
          audio.play('error', { position: pos3(l.x, FUSE_Y, FUSE_Z) });
          audio.play('power_down', { position: pos3(l.x, FUSE_Y, FUSE_Z), volume: 0.5 });
          ui.toast('AŞIRI AKIM! Tüm sigortalar attı — teşhis ekranındaki sırayı izle.', 3500);
          for (const k of levers) k.target = LEVER_DOWN;
        }
        if (faultT <= 0) {
          faultT = 0;
          faultLever = null;
          panelLight.color.copy(panelLightBase.color);
          panelLight.intensity = panelLightBase.intensity;
          panelLight.emergency.color.copy(panelLightBase.eColor);
          panelLight.emergency.intensity = panelLightBase.eIntensity;
          strobeMat.emissiveIntensity = 0;
          drawDiag(t);
        }
      }
      if (celebrateT > 0) celebrateT -= dt;

      // Kol animasyonu (her zaman — ucuz)
      for (const l of levers) {
        if (l.angle !== l.target) {
          const speed = l.target === LEVER_DOWN && faultT > 0 ? 14 : 9;
          const d = l.target - l.angle;
          const step = Math.sign(d) * Math.min(Math.abs(d), speed * dt);
          l.angle += step;
          l.arm.rotation.x = l.angle;
        }
      }

      const isNear = near();
      if (!isNear) {
        wasNear = false;
        return;
      }

      // LED'ler: atık sigortalar kırmızı yanıp söner, arızada hepsi hızlı flaş
      const blink = Math.floor(t * 2) % 2 === 0;
      const fastBlink = Math.floor(t * 10) % 2 === 0;
      for (const l of levers) {
        if (puzzle.solved) setLed(l, ledMats.green);
        else if (faultT > 0) setLed(l, l === faultLever && faultT > faultDropAt ? ledMats.amber : fastBlink ? ledMats.red : ledOff);
        else if (puzzle.isUp(l.n)) setLed(l, ledMats.green);
        else setLed(l, blink ? ledMats.red : ledOff);
      }

      // Arıza flaşı: panel ışığı ve flaşör kırmızı
      if (faultT > 0 && faultT <= faultDropAt) {
        const f = fastBlink ? 1 : 0.15;
        panelLight.color.copy(RED);
        panelLight.intensity = 6 * f;
        panelLight.emergency.color.copy(RED);
        panelLight.emergency.intensity = 5 * f;
        strobeMat.emissiveIntensity = 4 * f;
      } else if (!puzzle.solved && !powered) {
        strobeMat.emissiveIntensity = Math.sin(t * 3) > 0.6 ? 2.5 : 0.1;
      } else {
        strobeMat.emissiveIntensity = 0;
      }

      sparks.update(dt);

      // Reaktör: halkalar ve çekirdek parıltısı
      const p2 = power * power;
      ringA.rotation.y += dt * (0.15 + 2.6 * p2);
      ringB.rotation.y -= dt * (0.1 + 1.9 * p2);
      let flick = 1;
      if (power > 0.02 && power < 0.75) flick = Math.sin(t * 47) * Math.sin(t * 13.1) > 0.3 ? 0.4 : 1;
      const pulse = 0.85 + 0.15 * Math.sin(t * (1.6 + 4 * power));
      coreMat.emissive.lerpColors(RED, CYAN, power);
      coreMat.emissiveIntensity = (0.55 + 3.2 * power) * pulse * flick + (celebrateT > 0 ? celebrateT : 0);
      rodMat.emissive.lerpColors(ROD_RED, ROD_CYAN, power);
      rodMat.emissiveIntensity = (0.25 + 1.4 * power) * (0.9 + 0.1 * Math.sin(t * 5.3)) * flick;
      reactorLight.intensity = 7 * (0.9 + 0.1 * pulse) * flick;

      // Göstergeler
      for (const gg of pumpGauges) {
        const target = 0.12 + (gg.base - 0.12) * power + Math.sin(t * 2.3 + gg.phase) * 0.012 * (0.3 + power);
        gg.set(target);
      }
      valveGauge.set(0.1 + power * (valveOpen ? 0.72 : 0.5) + Math.sin(t * 3.1) * 0.01 * power);
      if (valveSpin > 0) {
        valveSpin -= dt;
        wheel.rotation.z += dt * (valveOpen ? 5.2 : -5.2);
      }

      // Ekranlar (~8 Hz)
      screenTimer -= dt;
      if (screenTimer <= 0 || !wasNear) {
        screenTimer = 0.125;
        drawDiag(t);
        drawCore(t);
      }
      wasNear = true;
    });

    applyMetricUVs(g, M);
    // Testler / diğer sistemler için küçük bir kapı (salt okunur kullanım önerilir)
    mctx.group.userData.fusePuzzle = puzzle;
  },
};
