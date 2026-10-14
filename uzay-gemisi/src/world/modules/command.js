import * as THREE from 'three';
import { buildShell } from '../structure/shell.js';
import { addBox, addCylinder, addSphere, mergeStatic } from '../utils.js';
import {
  crewMaterials,
  vBox,
  vCyl,
  label,
  addScreen,
  drawNoPower,
  screenDriver,
  draw2d,
  addRail,
  addRod,
  addHose,
  addCableRun,
  addSwitchBank,
  addKnobRow,
  addGauge,
  addSeat,
  addVent,
  addPicture,
  shakePlayer,
  openTerminal,
  createTimers,
  sfx,
} from './crew/kit.js';
import { drawPatch } from './crew/pictures.js';

/**
 * Kumanda Modülü (kokpit) — enerji gelene kadar KİLİTLİ.
 *
 * Dış duvara (uzaya) bakan iki pilot koltuğu, panoramik pencere seti, pencere altında gösterge konsolu
 * (kapaklı anahtarlar, yeşil/amber CRT'ler), tavanda anahtar panelleri, orta konsolda gaz kolları ve
 * "HALKA DÖNÜŞÜ" kontrolü, yan kumanda kolları, arkada 2 mürettebat koltuğu.
 *
 * Etkileşimler:
 *   command-spin        Halka dönüşünü başlat → terminal (RCS ön ısıtma → onay) → state 'ring_spinning'
 *   command-seat-left   Koltuğa otur (hareket edince kalkar)
 *   command-seat-right  Koltuğa otur
 */
const AMBER = '#ffb347';
const GREEN = '#7dff9a';
const TARGET_RPM = 5.29; // r = 32 m → ~1 g
const RING_R = 32;

export default {
  id: 'command',
  name: 'Kumanda Modülü',
  build(mctx) {
    const M = mctx.materials;
    const C = crewMaterials(mctx);
    const root = mctx.group;
    const timers = createTimers(mctx);

    buildShell(mctx, {
      lockedUntil: 'power_restored',
      lockedText: 'KİLİTLİ — Kumanda modülü için enerji gerekli',
      outerWindows: [
        { x: -3.15, w: 2.0, y: 1.0, h: 1.45 },
        { x: -1.05, w: 2.0, y: 1.0, h: 1.45 },
        { x: 1.05, w: 2.0, y: 1.0, h: 1.45 },
        { x: 3.15, w: 2.0, y: 1.0, h: 1.45 },
      ],
      lights: 2,
      lightIntensity: 4.5,
      lightColor: 0xffeedd,
      wall: 'dark',
    });
    // Konsolun sıcak parıltısı + tavan kubbe lambası (toplam 4 ışık)
    mctx.addLight([0, 1.35, -2.1], { color: 0xffd6a0, intensity: 2.4, distance: 5.5, emergency: { color: 0xff3020, intensity: 0.5 } });
    mctx.addLight([0, 2.65, -0.4], { color: 0xfff0dc, intensity: 4, distance: 6.5, emergency: { color: 0xff3020, intensity: 0.9 } });

    // ------------------------------------------------------------------
    // Pencere altı gösterge konsolu
    // ------------------------------------------------------------------
    addBox(root, { size: [8.8, 0.62, 0.6], pos: [0, 0.31, -3.15], material: C.console, collide: true, name: 'dash-body' });
    vBox(root, { size: [8.82, 0.06, 0.62], color: 0x1b1c1e, pos: [0, 0.03, -3.15] });
    addBox(root, { size: [8.8, 0.03, 0.47], pos: [0, 0.975, -3.22], material: C.consoleEdge }); // pencere pervazı rafı
    addBox(root, { size: [8.8, 0.035, 0.06], pos: [0, 1.0, -2.99], material: M.rubber }); // göz siperi kenarı
    // ayak dayama korkuluğu
    addRail(root, [-4.2, 0.18, -2.78], [4.2, 0.18, -2.78], { material: M.handrail, out: [0, 0, 1], depth: 0.07, standoffs: 6, radius: 0.02 });
    for (const x of [-3.4, -1.25, 1.25, 3.4]) addVent(root, { pos: [x, 0.3, -2.845], w: 0.5, h: 0.22, frameMaterial: M.metalDark, slatMaterial: M.panelDark });

    const face = new THREE.Group();
    face.position.set(0, 0.62, -2.85);
    face.rotation.x = -0.35;
    root.add(face);
    addBox(face, { size: [8.8, 0.4, 0.04], pos: [0, 0.2, -0.02], material: C.console });
    // panel bölmeleri (koyu çerçeve çizgileri)
    for (const x of [-3.45, -1.5, -0.95, 0.95, 1.5, 3.45]) addBox(face, { size: [0.012, 0.4, 0.008], pos: [x, 0.2, 0.004], material: C.consoleEdge });

    const scrRing = addScreen(face, { pos: [-1.25, 0.2, 0.002], w: 0.36, h: 0.26, res: [320, 232], color: GREEN, depth: 0.03, hood: true });
    const scrTime = addScreen(face, { pos: [1.25, 0.2, 0.002], w: 0.36, h: 0.26, res: [320, 232], color: GREEN, depth: 0.03, hood: true });
    const scrOrbit = addScreen(face, { pos: [0, 0.2, 0.002], w: 0.4, h: 0.3, res: [320, 240], color: GREEN, depth: 0.03, hood: true });
    const scrAtmo = addScreen(face, { pos: [-3.0, 0.2, 0.002], w: 0.3, h: 0.22, res: [256, 188], color: AMBER, depth: 0.03, hood: true });
    const scrRcs = addScreen(face, { pos: [3.0, 0.2, 0.002], w: 0.3, h: 0.22, res: [256, 188], color: AMBER, depth: 0.03, hood: true });

    addSwitchBank(face, { pos: [-0.62, 0.22, 0], cols: 5, rows: 3, guarded: [2], seed: 31 });
    addSwitchBank(face, { pos: [0.62, 0.22, 0], cols: 5, rows: 3, guarded: [12], seed: 32 });
    addSwitchBank(face, { pos: [-2.15, 0.27, 0], cols: 10, rows: 2, guarded: [0, 1, 10], seed: 33 });
    addSwitchBank(face, { pos: [2.15, 0.27, 0], cols: 10, rows: 2, guarded: [9, 19], seed: 34 });
    addKnobRow(face, { pos: [-2.15, 0.07, 0], n: 6, spacing: 0.09, seed: 35 });
    addKnobRow(face, { pos: [2.15, 0.07, 0], n: 6, spacing: 0.09, seed: 36 });
    for (let i = 0; i < 3; i++) {
      addGauge(face, { pos: [-3.95 + i * 0.0, 0.3 - i * 0.11, 0], radius: 0.04, needle: -0.6 + i * 0.7 });
      addGauge(face, { pos: [3.95, 0.3 - i * 0.11, 0], radius: 0.04, needle: 0.9 - i * 0.5 });
    }
    addKnobRow(face, { pos: [-3.55, 0.06, 0], n: 2, spacing: 0.08, seed: 37 });
    addKnobRow(face, { pos: [3.55, 0.06, 0], n: 2, spacing: 0.08, seed: 38 });
    label(face, 'HALKA DEVRİ', { pos: [-1.25, 0.375, 0.004], height: 0.022, color: '#e8e2d0' });
    label(face, 'ZAMAN GENİŞLEMESİ', { pos: [1.25, 0.375, 0.004], height: 0.022, color: '#e8e2d0' });
    label(face, 'YÖRÜNGE', { pos: [0, 0.385, 0.004], height: 0.022, color: '#e8e2d0' });
    label(face, 'ATMOSFER', { pos: [-3.0, 0.355, 0.004], height: 0.022, color: '#e8e2d0' });
    label(face, 'RCS', { pos: [3.0, 0.355, 0.004], height: 0.022, color: '#e8e2d0' });
    label(face, 'ANA GÜÇ', { pos: [-2.15, 0.37, 0.004], height: 0.02, color: '#e8e2d0' });
    label(face, 'TUTUM KONTROL', { pos: [2.15, 0.37, 0.004], height: 0.02, color: '#e8e2d0' });

    // Uyarı lambaları (pervaz rafında, pencere ortasında)
    const ann = new THREE.Group();
    ann.position.set(0, 0.99, -3.05);
    ann.rotation.x = -Math.PI / 2 + 0.5;
    root.add(ann);
    addBox(ann, { size: [0.7, 0.14, 0.03], pos: [0, 0, -0.015], material: C.consoleEdge });
    const annMats = [C.indGreen, C.indGreen, C.indAmber, C.indGreen, C.indWhite, C.indGreen, M.ledRed, C.indGreen, C.indGreen, C.indAmber, C.indGreen, C.indWhite];
    annMats.forEach((m, i) => addBox(ann, { size: [0.045, 0.035, 0.01], pos: [-0.29 + (i % 6) * 0.116, i < 6 ? 0.03 : -0.03, 0.002], material: m }));

    // pencere çerçevesi dikmeleri (iç taraf)
    for (const x of [-4.2, -2.1, 0, 2.1, 4.2]) {
      addBox(root, { size: [0.12, 1.5, 0.08], pos: [x, 1.725, -3.44], material: M.metalDark });
    }
    addBox(root, { size: [8.6, 0.08, 0.08], pos: [0, 2.48, -3.44], material: M.metalDark });

    // ------------------------------------------------------------------
    // Pilot koltukları + yan kumanda kolları
    // ------------------------------------------------------------------
    const seats = [];
    for (const [sx, name] of [
      [-1, 'Sol pilot koltuğu'],
      [1, 'Sağ pilot koltuğu'],
    ]) {
      const s = addSeat(root, { pos: [sx * 1.25, 0, -1.85], rotY: Math.PI, kind: 'pilot', M });
      s.group.userData.collide = true;
      s.group.name = `seat-${sx < 0 ? 'left' : 'right'}`;
      seats.push({ ...s, x: sx * 1.25, z: -1.85, name });
      // yan kumanda kolu
      const st = new THREE.Group();
      st.position.set(sx * 1.88, 0, -2.05);
      root.add(st);
      addBox(st, { size: [0.2, 0.6, 0.34], pos: [0, 0.3, 0], material: C.console, collide: true, name: 'stick-base' });
      addBox(st, { size: [0.21, 0.04, 0.35], pos: [0, 0.61, 0], material: C.consoleEdge });
      vCyl(st, { radius: 0.04, height: 0.03, color: 0x1a1a1a, pos: [0, 0.645, 0.02] });
      addRod(st, [0, 0.65, 0.02], [0, 0.82, -0.02], { radius: 0.014, material: M.metal });
      vBox(st, { size: [0.045, 0.12, 0.05], color: 0x222222, pos: [0, 0.86, -0.03], rot: [0.25, 0, 0] });
      vBox(st, { size: [0.014, 0.014, 0.014], color: 0xb02a1c, pos: [0, 0.925, -0.04] });
      addSwitchBank(st, { pos: [0, 0.6, 0.15], rot: [-Math.PI / 2, 0, 0], cols: 3, rows: 1, seed: 40 + sx, plate: false });
    }
    label(root, 'PİLOT', { pos: [-1.25, 1.36, -1.55], rot: [0, Math.PI, 0], height: 0.04, color: '#e8e2d0' });
    label(root, 'YARDIMCI PİLOT', { pos: [1.25, 1.36, -1.55], rot: [0, Math.PI, 0], height: 0.04, color: '#e8e2d0' });

    // ------------------------------------------------------------------
    // Orta konsol (gaz kolları + HALKA DÖNÜŞÜ)
    // ------------------------------------------------------------------
    const ped = new THREE.Group();
    ped.position.set(0, 0, -2.2);
    root.add(ped);
    addBox(ped, { size: [0.52, 0.66, 1.2], pos: [0, 0.33, 0], material: C.console, collide: true, name: 'pedestal' });
    const pedTop = new THREE.Group();
    pedTop.position.set(0, 0.66, 0);
    pedTop.rotation.x = -0.12;
    ped.add(pedTop);
    addBox(pedTop, { size: [0.54, 0.05, 1.22], pos: [0, 0.025, 0], material: C.consoleEdge });
    // gaz kolları kadranı
    addBox(pedTop, { size: [0.3, 0.09, 0.36], pos: [0, 0.095, 0.25], material: C.console });
    for (const x of [-0.06, 0.06]) addBox(pedTop, { size: [0.012, 0.012, 0.3], pos: [x, 0.142, 0.25], material: M.rubber });
    const throttles = new THREE.Group();
    throttles.name = 'throttles';
    throttles.userData.dynamic = true;
    throttles.position.set(0, 0.14, 0.25);
    pedTop.add(throttles);
    const levers = [];
    for (const x of [-0.06, 0.06]) {
      const lv = new THREE.Group();
      lv.position.set(x, 0, 0);
      throttles.add(lv);
      addBox(lv, { size: [0.012, 0.2, 0.02], pos: [0, 0.1, 0], material: M.metal });
      addBox(lv, { size: [0.075, 0.035, 0.045], pos: [0, 0.205, 0], material: M.plasticDark });
      lv.rotation.x = 0.45;
      levers.push(lv);
    }
    mergeStatic(throttles.children[0]);
    mergeStatic(throttles.children[1]);
    label(pedTop, 'İTKİ', { pos: [0, 0.141, 0.47], rot: [-Math.PI / 2, 0, 0], height: 0.03, color: '#e8e2d0' });
    addSwitchBank(pedTop, { pos: [0, 0.051, -0.1], rot: [-Math.PI / 2, 0, 0], cols: 4, rows: 2, seed: 44, guarded: [3] });

    // HALKA DÖNÜŞÜ kontrol bloğu (etkileşimli)
    const spin = new THREE.Group();
    spin.name = 'command-spin';
    spin.position.set(0, 0.05, -0.45);
    pedTop.add(spin);
    addBox(spin, { size: [0.36, 0.03, 0.22], pos: [0, 0.015, 0], material: C.consoleEdge });
    // sarı-siyah uyarı çerçevesi
    for (let i = 0; i < 7; i++) vBox(spin, { size: [0.045, 0.006, 0.02], color: i % 2 ? 0x1a1a1a : 0xd8a21a, pos: [-0.135 + i * 0.045, 0.033, 0.095] });
    for (let i = 0; i < 7; i++) vBox(spin, { size: [0.045, 0.006, 0.02], color: i % 2 ? 0xd8a21a : 0x1a1a1a, pos: [-0.135 + i * 0.045, 0.033, -0.095] });
    label(spin, 'HALKA DÖNÜŞÜ', { pos: [0, 0.034, 0.05], rot: [-Math.PI / 2, 0, 0], height: 0.03, color: '#f0ece0' });
    vCyl(spin, { radius: 0.014, height: 0.012, segments: 8, color: 0x8a8a86, pos: [0, 0.036, -0.03] });
    const toggle = new THREE.Group();
    toggle.position.set(0, 0.04, -0.03);
    spin.add(toggle);
    vCyl(toggle, { radius: 0.006, height: 0.06, segments: 8, color: 0xd0d0cc, pos: [0, 0.03, 0] });
    vBox(toggle, { size: [0.016, 0.016, 0.016], color: 0xd0d0cc, pos: [0, 0.062, 0] });
    toggle.rotation.x = -0.5;
    const guard = new THREE.Group();
    guard.position.set(0, 0.035, -0.07);
    spin.add(guard);
    vBox(guard, { size: [0.07, 0.004, 0.09], color: 0xb02a1c, pos: [0, 0.075, 0.045] });
    vBox(guard, { size: [0.004, 0.075, 0.09], color: 0xb02a1c, pos: [-0.034, 0.0375, 0.045] });
    vBox(guard, { size: [0.004, 0.075, 0.09], color: 0xb02a1c, pos: [0.034, 0.0375, 0.045] });
    const spinLed = addBox(spin, { size: [0.03, 0.012, 0.03], pos: [0.12, 0.036, -0.03], material: C.indAmber });
    // geniş etkileşim hedefi
    addBox(spin, { size: [0.4, 0.14, 0.26], pos: [0, 0.07, 0], material: C.proxy, name: 'spin-proxy' });
    mergeStatic(toggle);
    mergeStatic(guard);

    // ------------------------------------------------------------------
    // Tavan anahtar panelleri
    // ------------------------------------------------------------------
    // a) pencere üstü eğimli panel
    const ovA = new THREE.Group();
    ovA.position.set(0, 2.62, -3.38);
    ovA.rotation.x = 0.93;
    root.add(ovA);
    addBox(ovA, { size: [5.2, 0.62, 0.05], pos: [0, 0.31, -0.03], material: C.console });
    for (let i = 0; i < 4; i++) {
      addSwitchBank(ovA, { pos: [-1.95 + i * 1.3, 0.42, 0], cols: 9, rows: 2, seed: 50 + i, guarded: i === 1 ? [0, 1] : [] });
      addKnobRow(ovA, { pos: [-1.95 + i * 1.3, 0.13, 0], n: 5, spacing: 0.08, seed: 60 + i });
    }
    label(ovA, 'ELEKTRİK DAĞITIM', { pos: [-1.3, 0.58, 0.003], height: 0.025, color: '#e8e2d0' });
    label(ovA, 'YAŞAM DESTEK', { pos: [1.3, 0.58, 0.003], height: 0.025, color: '#e8e2d0' });
    // b) koltukların üstünde tavan konsolu
    const ovB = new THREE.Group();
    ovB.position.set(0, 3.06, -1.95);
    ovB.rotation.x = Math.PI / 2 - 0.25;
    root.add(ovB);
    addBox(ovB, { size: [3.6, 0.9, 0.08], pos: [0, 0, -0.04], material: C.console });
    addSwitchBank(ovB, { pos: [-1.25, 0.18, 0], cols: 8, rows: 3, seed: 70, guarded: [0, 7] });
    addSwitchBank(ovB, { pos: [1.25, 0.18, 0], cols: 8, rows: 3, seed: 71, guarded: [16] });
    addSwitchBank(ovB, { pos: [0, 0.22, 0], cols: 5, rows: 2, seed: 72 });
    addKnobRow(ovB, { pos: [-1.25, -0.25, 0], n: 4, spacing: 0.1, seed: 73 });
    addKnobRow(ovB, { pos: [1.25, -0.25, 0], n: 4, spacing: 0.1, seed: 74 });
    addGauge(ovB, { pos: [-0.15, -0.2, 0], radius: 0.05, needle: 0.4 });
    addGauge(ovB, { pos: [0.15, -0.2, 0], radius: 0.05, needle: -0.9 });
    label(ovB, 'RCS DÖRTLÜLERİ', { pos: [-1.25, 0.4, 0.003], height: 0.03, color: '#e8e2d0' });
    label(ovB, 'HALKA YATAKLARI', { pos: [1.25, 0.4, 0.003], height: 0.03, color: '#e8e2d0' });
    for (const sx of [-1, 1]) addRod(root, [sx * 1.7, 3.2, -1.95], [sx * 1.7, 3.0, -1.95], { radius: 0.02, material: M.metalDark });

    // ------------------------------------------------------------------
    // Arka bölüm: mürettebat koltukları, raflar, kasklar
    // ------------------------------------------------------------------
    for (const sx of [-1, 1]) {
      const s = addSeat(root, { pos: [sx * 1.55, 0, 1.75], rotY: Math.PI, kind: 'crew', M });
      s.group.userData.collide = true;
    }
    label(root, 'MÜRETTEBAT 3', { pos: [-1.55, 1.15, 2.18], rot: [0, Math.PI, 0], height: 0.035, color: '#e8e2d0' });
    label(root, 'MÜRETTEBAT 4', { pos: [1.55, 1.15, 2.18], rot: [0, Math.PI, 0], height: 0.035, color: '#e8e2d0' });

    for (const sx of [-1, 1]) {
      // donanım rafları
      const rk = new THREE.Group();
      rk.position.set(sx * 3.9, 0, 3.15);
      rk.rotation.y = Math.PI;
      root.add(rk);
      addBox(rk, { size: [1.3, 2.2, 0.55], pos: [0, 1.1, -0.02], material: M.panelDark, collide: true, name: 'rack' });
      for (let k = 0; k < 6; k++) {
        const y = 0.35 + k * 0.32;
        addBox(rk, { size: [1.2, 0.26, 0.02], pos: [0, y, 0.265], material: C.console });
        vBox(rk, { size: [0.16, 0.12, 0.012], color: 0x16181a, pos: [-0.42, y, 0.28] });
        for (let j = 0; j < 6; j++) addBox(rk, { size: [0.014, 0.014, 0.01], pos: [-0.15 + j * 0.05, y + 0.07, 0.28], material: (j + k) % 4 ? C.indGreen : C.indAmber });
        addBox(rk, { size: [0.02, 0.2, 0.03], pos: [0.55, y, 0.29], material: M.metal });
      }
      label(rk, sx < 0 ? 'SEYİR BİLGİSAYARI A' : 'SEYİR BİLGİSAYARI B', { pos: [0, 2.12, 0.255], height: 0.04, color: '#e8e2d0' });
      addCableRun(root, [sx * 3.5, 2.2, 3.0], [sx * 3.0, 3.15, 2.9], { n: 3, sag: 0.05, radius: 0.012, material: M.cable, seed: 80 + sx });
    }
    // kask rafı
    const hs = new THREE.Group();
    hs.position.set(0, 0, 3.3);
    hs.rotation.y = Math.PI;
    root.add(hs);
    addBox(hs, { size: [1.6, 0.04, 0.32], pos: [0, 1.5, 0], material: M.metalDark });
    addBox(hs, { size: [1.6, 0.04, 0.32], pos: [0, 0.95, 0], material: M.metalDark });
    for (const x of [-0.45, 0.45]) {
      addSphere(hs, { radius: 0.15, widthSegments: 16, heightSegments: 12, pos: [x, 1.68, 0], material: M.plasticWhite });
      vBox(hs, { size: [0.2, 0.1, 0.02], color: 0x15181c, pos: [x, 1.68, 0.14] });
      vCyl(hs, { radius: 0.155, height: 0.04, segments: 16, color: 0x8a8d90, pos: [x, 1.54, 0] });
    }
    vBox(hs, { size: [0.32, 0.22, 0.2], color: 0xd6d0c0, pos: [-0.45, 1.08, 0] }); // eldiven kutusu
    vBox(hs, { size: [0.3, 0.18, 0.22], color: 0xb02a1c, pos: [0.45, 1.06, 0] }); // ilk yardım
    vBox(hs, { size: [0.16, 0.04, 0.005], color: 0xf0f0f0, pos: [0.45, 1.06, 0.112] });
    vBox(hs, { size: [0.04, 0.12, 0.005], color: 0xf0f0f0, pos: [0.45, 1.06, 0.112] });
    label(hs, 'KASK / BASINÇ GİYSİSİ', { pos: [0, 1.95, 0.0], height: 0.045, color: '#e8e2d0' });
    addPicture(root, { key: 'patch', draw: drawPatch, pos: [0, 2.45, 3.47], rot: [0, Math.PI, 0], w: 0.4, h: 0.4, res: [256, 256], tape: false, border: 0 });
    addRail(root, [-2.6, 1.95, 3.38], [2.6, 1.95, 3.38], { material: M.handrail, out: [0, 0, -1], depth: 0.1, standoffs: 5 });

    // Uç duvar köşe konsolları (açılı, koltuklara bakar)
    for (const sx of [-1, 1]) {
      const cc = new THREE.Group();
      cc.position.set(sx * 4.85, 0, -2.6);
      cc.rotation.y = sx * -0.75;
      root.add(cc);
      addBox(cc, { size: [0.9, 1.0, 0.5], pos: [0, 0.5, 0], material: C.console, collide: true, name: 'corner-console' });
      const cf = new THREE.Group();
      cf.position.set(0, 1.0, 0.25);
      cf.rotation.x = -0.8;
      cc.add(cf);
      addBox(cf, { size: [0.9, 0.5, 0.03], pos: [0, 0.25, -0.015], material: C.consoleEdge });
      addGauge(cf, { pos: [-0.25, 0.32, 0], radius: 0.06, needle: 0.3 * sx });
      addGauge(cf, { pos: [0.0, 0.32, 0], radius: 0.06, needle: -0.7 });
      addGauge(cf, { pos: [0.25, 0.32, 0], radius: 0.06, needle: 1.0 });
      addSwitchBank(cf, { pos: [0, 0.1, 0], cols: 7, rows: 2, seed: 90 + sx });
      label(cf, sx < 0 ? 'YAKIT — HİDRAZİN' : 'İTİCİ BASINÇ', { pos: [0, 0.455, 0.002], height: 0.03, color: '#e8e2d0' });
    }

    // Tavan kablo demetleri + etiketler
    addCableRun(root, [-5.3, 3.1, -1.0], [5.3, 3.1, -1.0], { n: 4, sag: 0.07, radius: 0.012, material: M.cable, seed: 3 });
    addHose(root, [[-4.9, 1.0, -3.3], [-5.1, 2.0, -3.35], [-5.0, 3.1, -3.2]], { radius: 0.03, material: M.rubber });
    label(root, 'KUMANDA MODÜLÜ', { pos: [-4.0, 2.8, 3.47], rot: [0, Math.PI, 0], height: 0.08, color: '#d8d2c2' });
    label(root, 'DİKKAT — DÖNÜŞ ÖNCESİ KEMERLERİ BAĞLAYIN', { pos: [3.6, 2.8, 3.47], rot: [0, Math.PI, 0], height: 0.05, color: '#1a1a1a', bg: '#d8a21a' });

    // ------------------------------------------------------------------
    // Durum: halka devri simülasyonu
    // ------------------------------------------------------------------
    const sim = { rpm: 0, target: 0, rcs: 0, rcsTarget: 0, rcsReady: false, preheatStart: 0 };
    mctx.state.when('ring_spinning', () => {
      sim.target = TARGET_RPM;
      sim.rcsReady = true;
      sim.rcsTarget = 1;
    });
    mctx.onUpdate((dt) => {
      if (sim.rpm !== sim.target) {
        sim.rpm += (sim.target - sim.rpm) * (1 - Math.exp(-dt / 7));
        if (Math.abs(sim.rpm - sim.target) < 0.002) sim.rpm = sim.target;
      }
      if (sim.rcs !== sim.rcsTarget) {
        sim.rcs = THREE.MathUtils.clamp(sim.rcs + Math.sign(sim.rcsTarget - sim.rcs) * dt * 0.28, 0, 1);
        if (Math.abs(sim.rcs - sim.rcsTarget) < 0.01) sim.rcs = sim.rcsTarget;
      }
      // gaz kolları + kapak + anahtar
      const spinning = mctx.state.is('ring_spinning');
      const lvTarget = spinning ? -0.35 : 0.45;
      for (const lv of levers) lv.rotation.x = THREE.MathUtils.damp(lv.rotation.x, lvTarget, 2.5, dt);
      guard.rotation.x = THREE.MathUtils.damp(guard.rotation.x, spinning ? -1.9 : 0, 6, dt);
      toggle.rotation.x = THREE.MathUtils.damp(toggle.rotation.x, spinning ? 0.5 : -0.5, 8, dt);
    });
    mctx.state.when('ring_spinning', () => (spinLed.material = C.indGreen));

    // ------------------------------------------------------------------
    // Ekranlar
    // ------------------------------------------------------------------
    const screens = [scrRing, scrTime, scrOrbit, scrAtmo, scrRcs];
    const hist = new Array(40).fill(0.5);
    let histT = 0;
    screenDriver(mctx, {
      hz: 8,
      draw: (t, powered) => {
        if (!powered) {
          for (const s of screens) drawNoPower(s);
          return;
        }
        for (const s of screens) s.material.emissiveIntensity = 1.2;
        if (t - histT > 0.5) {
          histT = t;
          hist.push(0.5 + Math.sin(t * 0.7) * 0.08 + Math.sin(t * 2.3) * 0.03);
          hist.shift();
        }
        drawRing(scrRing, t, sim);
        drawTime(scrTime, t);
        drawOrbit(scrOrbit, t, sim);
        drawAtmo(scrAtmo, t, hist);
        drawRcs(scrRcs, t, sim);
      },
    });

    // ------------------------------------------------------------------
    // Etkileşim: HALKA DÖNÜŞÜNÜ BAŞLAT
    // ------------------------------------------------------------------
    let seqId = 0;
    const statusLines = () => {
      const spinning = mctx.state.is('ring_spinning');
      const rpm = sim.rpm;
      const g = ((rpm * Math.PI * 2) / 60) ** 2 * RING_R / 9.81;
      return [
        'AZİM — HALKA DÖNÜŞ KONTROLÜ',
        '────────────────────────────────────────',
        `Halka durumu ........ ${spinning ? (Math.abs(rpm - TARGET_RPM) < 0.05 ? 'KARARLI' : 'HIZLANIYOR') : 'DURAĞAN'} (${rpm.toFixed(2)} dev/dk)`,
        `Yapay yerçekimi ..... ${g.toFixed(2)} g`,
        `RCS iticileri ....... ${sim.rcsReady ? 'ÇALIŞMA SICAKLIĞINDA' : 'SOĞUK (−61 °C)'}`,
        'Hidrazin ............ %71',
        'Mürettebat .......... 1 uyanık, 3 hiper-uykuda',
        '',
      ];
    };

    const startSpin = () => {
      if (mctx.state.is('ring_spinning')) return;
      mctx.state.set('ring_spinning', true);
      sfx(mctx, 'spin_up');
      sfx(mctx, 'switch');
      shakePlayer(mctx, { duration: 4.5, amplitude: 0.007 });
      mctx.ui?.toast?.('Halka dönmeye başladı — yapay yerçekimi oluşuyor.', 4000);
    };

    const confirmStep = () => {
      const id = ++seqId;
      const term = openTerminal(mctx, {
        title: 'HALKA DÖNÜŞ KONTROLÜ',
        color: AMBER,
        lines: [
          ...statusLines(),
          'RCS HAZIR — 16 nozulun tamamı çalışma sıcaklığında.',
          `Hedef devir: ${TARGET_RPM.toFixed(1)} dev/dk  (yarıçap ${RING_R} m → ~1.0 g)`,
          'UYARI: Dönüş başlarken gevşek nesneler dış duvara',
          'doğru kayabilir. Tutunma korkuluklarını kullanın.',
        ],
        options: [
          { label: 'DÖNÜŞÜ BAŞLAT', action: () => { if (id === seqId) startSpin(); } },
          { label: 'Vazgeç', action: () => {} },
        ],
      });
      if (!term) startSpin(); // arayüz yoksa doğrudan başlat
    };

    const preheat = (term, id, done) => {
      sfx(mctx, 'servo');
      sim.rcsTarget = 1;
      const base = [...statusLines(), 'RCS ÖN ISITMA BAŞLADI…'];
      const pairs = ['A1/A2', 'A3/A4', 'B1/B2', 'B3/B4', 'C1/C2', 'C3/C4', 'D1/D2', 'D3/D4'];
      const lines = [...base];
      pairs.forEach((p, i) => {
        timers.after(0.45 * (i + 1), () => {
          if (id !== seqId) return;
          lines.push(`  Nozul çifti ${p} ...... −61 °C → +${18 + ((i * 7) % 9)} °C  TAMAM`);
          term?.setLines?.(lines.slice());
          sfx(mctx, 'tick');
        });
      });
      timers.after(0.45 * (pairs.length + 1) + 0.4, () => {
        if (id !== seqId) return;
        sim.rcsReady = true;
        sfx(mctx, 'success');
        done();
      });
    };

    const beginSequence = () => {
      const id = ++seqId;
      if (sim.rcsReady) {
        confirmStep();
        return;
      }
      let advancing = false;
      let heating = false;
      const term = openTerminal(mctx, {
        title: 'HALKA DÖNÜŞ KONTROLÜ',
        color: AMBER,
        lines: [...statusLines(), 'Dönüş başlatılmadan önce RCS nozulları ısıtılmalı.'],
        options: [
          {
            label: 'RCS ön ısıtmayı başlat',
            action: () => {
              if (heating) return false;
              heating = true;
              preheat(term, id, () => {
                advancing = true;
                term?.close?.();
                confirmStep();
              });
              return false;
            },
          },
          { label: 'Vazgeç', action: () => {} },
        ],
        onClose: () => {
          if (advancing) return;
          if (id === seqId) seqId++; // bekleyen ısıtma adımlarını iptal et
          if (!sim.rcsReady) sim.rcsTarget = 0;
        },
      });
      if (!term) {
        // arayüz yoksa sekansı kendiliğinden yürüt
        preheat(null, id, () => confirmStep());
      }
    };

    mctx.interactions.add(spin, {
      id: 'command-spin',
      prompt: () => (mctx.state.is('ring_spinning') ? 'Halka durumu' : 'Halka dönüşünü başlat'),
      distance: 2.8,
      onInteract: () => {
        if (!mctx.state.is('power_restored')) {
          sfx(mctx, 'error');
          mctx.ui?.toast?.('ENERJİ YOK — halka sürücüleri çalışmıyor.');
          return;
        }
        if (mctx.state.is('ring_spinning')) {
          sfx(mctx, 'beep');
          openTerminal(mctx, {
            title: 'HALKA DÖNÜŞ KONTROLÜ',
            color: AMBER,
            lines: [...statusLines(), 'Halka dönüyor. Yapay yerçekimi korunuyor.'],
            options: [{ label: 'Kapat', action: () => {} }],
          });
          return;
        }
        sfx(mctx, 'terminal');
        beginSequence();
      },
    });

    // ------------------------------------------------------------------
    // Etkileşim: koltuğa otur
    // ------------------------------------------------------------------
    let seated = null;
    const camera = mctx.camera;
    const standUp = () => {
      if (!seated) return;
      const p = mctx.toWorld(seated.x, 0, -0.95);
      const { yaw, pitch } = mctx.player;
      mctx.player.teleport(p.x, p.z, yaw, pitch);
      seated = null;
    };
    for (const s of seats) {
      mctx.interactions.add(s.soft, {
        id: `command-${s.group.name}`,
        prompt: 'Koltuğa otur',
        distance: 2.4,
        enabled: () => !seated,
        onInteract: () => {
          const w = mctx.toWorld(s.x, 0, s.z + 0.05);
          seated = { ...s, wx: w.x, wz: w.z, t: 0 };
          const yaw = mctx.layout.localYawToWorld(mctx.index, Math.PI / 2);
          mctx.player.teleport(w.x, w.z, yaw, -0.12);
          sfx(mctx, 'click');
          mctx.ui?.toast?.('Kalkmak için hareket et.', 3000);
        },
      });
    }
    mctx.onUpdate((dt) => {
      if (!seated) return;
      seated.t += dt;
      const P = mctx.player;
      P.position.x = seated.wx;
      P.position.z = seated.wz;
      P.velocity.x = 0;
      P.velocity.z = 0;
      camera.position.x = seated.wx;
      camera.position.z = seated.wz;
      camera.position.y = P.position.y + 1.12;
      const inp = mctx.input;
      if (inp.enabled && !P.frozen && seated.t > 0.4) {
        const ax = inp.getMoveAxis?.() ?? { x: 0, y: 0 };
        if (Math.hypot(ax.x, ax.y) > 0.3 || inp.actionPressed('jump')) standUp();
      }
    }, -95);
    mctx.bus.on('player:module', ({ index }) => {
      if (seated && index !== mctx.index) seated = null;
    });
  },
};

// ---------------------------------------------------------------------------
// Ekran çizimleri
// ---------------------------------------------------------------------------
function drawRing(scr, t, sim) {
  const c = GREEN;
  scr.draw((g, w, h) => {
    const status = sim.target === 0 ? 'DURAĞAN' : Math.abs(sim.rpm - sim.target) < 0.05 ? 'KARARLI' : 'HIZLANIYOR';
    const hh = draw2d.header(g, w, h, 'HALKA DEVRİ', c, status);
    g.font = 'bold 64px monospace';
    g.fillStyle = c;
    g.fillText(sim.rpm.toFixed(2), 14, hh + 10);
    draw2d.text(g, 'dev/dk', 200, hh + 44, 20, c);
    const gg = ((sim.rpm * Math.PI * 2) / 60) ** 2 * RING_R / 9.81;
    draw2d.text(g, `YAPAY YERÇEKİMİ  ${gg.toFixed(2)} g`, 14, hh + 90, 18, c);
    draw2d.bar(g, 14, hh + 116, w - 28, 18, sim.rpm / TARGET_RPM, c);
    draw2d.text(g, '0', 14, hh + 138, 14, c);
    draw2d.text(g, `${TARGET_RPM.toFixed(1)}`, w - 14, hh + 138, 14, c, 'right');
    // dönen halka simgesi
    const cx = w - 50;
    const cy = hh + 40;
    g.strokeStyle = c;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, 26, 0, Math.PI * 2);
    g.stroke();
    const a0 = (t * sim.rpm * Math.PI * 2) / 60 * 6;
    for (let i = 0; i < 12; i++) {
      const a = a0 + (i / 12) * Math.PI * 2;
      g.fillRect(cx + Math.cos(a) * 26 - 3, cy + Math.sin(a) * 26 - 3, 6, 6);
    }
  });
}

function fmtDur(totalSec) {
  const y = Math.floor(totalSec / 31557600);
  const d = Math.floor((totalSec % 31557600) / 86400);
  const s = Math.floor(totalSec % 86400);
  return `${y}y ${String(d).padStart(3, '0')}g ${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function drawTime(scr, t) {
  const c = GREEN;
  scr.draw((g, w, h) => {
    const hh = draw2d.header(g, w, h, 'ZAMAN GENİŞLEMESİ', c);
    const ship = 2 * 31557600 + 118 * 86400 + 6 * 3600 + t;
    const gamma = 1.0000231;
    const earth = 23 * 31557600 + 247 * 86400 + 13 * 3600 + t * gamma;
    draw2d.text(g, 'GEMİ SAATİ', 12, hh + 8, 16, c);
    draw2d.text(g, fmtDur(ship), 12, hh + 26, 22, c);
    draw2d.text(g, 'DÜNYA SAATİ', 12, hh + 58, 16, c);
    draw2d.text(g, fmtDur(earth), 12, hh + 76, 22, c);
    draw2d.text(g, `γ = ${gamma.toFixed(7)}  (park yörüngesi)`, 12, hh + 110, 15, c);
    draw2d.text(g, `FARK  +${Math.floor((earth - ship) / 31557600)} yıl`, 12, hh + 132, 18, c);
    if (Math.floor(t * 1.5) % 2 === 0) draw2d.text(g, '▲ BİRİKEN', w - 12, hh + 132, 15, c, 'right');
  });
}

function drawOrbit(scr, t, sim) {
  const c = GREEN;
  scr.draw((g, w, h) => {
    const hh = draw2d.header(g, w, h, 'YÖRÜNGE', c, 'GARGANTUA');
    const cx = w / 2;
    const cy = hh + (h - hh) / 2 + 4;
    g.strokeStyle = c;
    g.lineWidth = 1;
    g.globalAlpha = 0.35;
    for (let i = 1; i <= 3; i++) {
      g.beginPath();
      g.ellipse(cx, cy, i * 34, i * 26, 0, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.fillStyle = c;
    g.beginPath();
    g.arc(cx, cy, 8, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#000';
    g.beginPath();
    g.arc(cx, cy, 5, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = c;
    g.beginPath();
    g.ellipse(cx, cy, 118, 84, 0.15, 0, Math.PI * 2);
    g.stroke();
    const a = t * 0.05;
    const sx = cx + Math.cos(a) * 118 * Math.cos(0.15) - Math.sin(a) * 84 * Math.sin(0.15);
    const sy = cy + Math.cos(a) * 118 * Math.sin(0.15) + Math.sin(a) * 84 * Math.cos(0.15);
    g.fillStyle = c;
    g.fillRect(sx - 5, sy - 5, 10, 10);
    draw2d.text(g, 'AZİM', sx + 8, sy - 6, 14, c);
    draw2d.text(g, 'r = 4.2 AB', 8, h - 22, 14, c);
    draw2d.text(g, `HALKA ${sim.target ? 'DÖNÜYOR' : 'DURUK'}`, w - 8, h - 22, 14, c, 'right');
  });
}

function drawAtmo(scr, t, hist) {
  const c = AMBER;
  scr.draw((g, w, h) => {
    const hh = draw2d.header(g, w, h, 'ATMOSFER', c);
    const o2 = 20.9 + Math.sin(t * 0.21) * 0.08;
    draw2d.text(g, `O₂     %${o2.toFixed(1)}`, 10, hh + 8, 18, c);
    draw2d.text(g, `CO₂    ${Math.round(412 + Math.sin(t * 0.13) * 6)} ppm`, 10, hh + 30, 18, c);
    draw2d.text(g, 'BASINÇ 101.2 kPa', 10, hh + 52, 18, c);
    draw2d.text(g, 'NEM    %38', 10, hh + 74, 18, c);
    draw2d.spark(g, 10, hh + 100, w - 20, h - hh - 112, hist, c);
  });
}

function drawRcs(scr, t, sim) {
  const c = AMBER;
  scr.draw((g, w, h) => {
    const hh = draw2d.header(g, w, h, 'RCS', c, sim.rcsReady ? 'HAZIR' : sim.rcs > 0 ? 'ISITILIYOR' : 'SOĞUK');
    const names = ['A', 'B', 'C', 'D'];
    const cw = (w - 20) / 4;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const x = 10 + i * cw;
        const y = hh + 8 + j * 30;
        const temp = Math.round(-61 + sim.rcs * (79 + ((i + j) % 3) * 3));
        g.strokeStyle = c;
        g.strokeRect(x + 1, y, cw - 6, 26);
        if (sim.rcs > 0.98) {
          g.globalAlpha = 0.35;
          g.fillStyle = c;
          g.fillRect(x + 1, y, cw - 6, 26);
          g.globalAlpha = 1;
        }
        draw2d.text(g, `${names[i]}${j + 1} ${temp > 0 ? '+' : ''}${temp}°`, x + 5, y + 5, 14, c);
      }
    }
  });
}
