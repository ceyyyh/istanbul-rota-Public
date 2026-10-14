import * as THREE from 'three';
import { buildShell } from '../structure/shell.js';
import { addBox, addCylinder, mergeStatic } from '../utils.js';
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
  addGauge,
  addLocker,
  addVent,
  createSleeper,
  addPicture,
  sfx,
  rng,
} from './crew/kit.js';
import { CREW } from './crew/texts.js';
import { drawEarth } from './crew/pictures.js';

/**
 * Hiper-Uyku Bölmesi — OYUNCU BURADA UYANIR.
 *
 * Doğma noktası yerel (-2.5, 0), +X'e bakar (boş bırakıldı).
 * Oyuncunun boş kapsülü: merkez (-2.5, z=-2.3), X boyunca uzanır, kapağı AÇIK (giriş sinematiği bunu varsayar).
 * 6 yatay kapsül: 3'ü dış duvarda (z=-2.3), 3'ü iç duvarda (z=+2.3). 2, 4 ve 6'da uyuyan mürettebat.
 * Etkileşim: her kapsül kapağı aç/kapa (menteşe animasyonu + "hiss").
 * Kapsül yaşamsal ekranları yedek bataryayla enerji yokken de çalışır (kırmızı/amber), enerjiyle yeşil.
 *
 * Dış API (diğer sistemler için): mctx.group.userData.cryo = { pods, setLid(podNo, open) }
 */
const POD_Z = 2.3;
const LID_OPEN = 1.78; // ~102°
const RIM_Y = 0.885;

export default {
  id: 'cryo',
  name: 'Hiper-Uyku Bölmesi',
  build(mctx) {
    const M = mctx.materials;
    const C = crewMaterials(mctx);
    const root = mctx.group;

    buildShell(mctx, {
      outerWindows: [
        { x: -2.5, w: 1.3, y: 1.95, h: 0.65 },
        { x: 0.3, w: 1.3, y: 1.95, h: 0.65 },
        { x: 3.1, w: 1.3, y: 1.95, h: 0.65 },
      ],
      lights: 3,
      lightColor: 0xe6f0ff,
      lightIntensity: 6.5,
      accent: 0x5ab4ff,
    });

    // Kapsüllerin soğuk parıltısı (yedek bataryada da hafifçe yanar) — 4. ışık
    mctx.addLight([0, 1.3, 0], {
      color: 0x9fd8ff,
      intensity: 1.6,
      distance: 7.5,
      emergency: { color: 0x7fb0c0, intensity: 0.7 },
    });

    // ------------------------------------------------------------------
    // Kapsüller
    // ------------------------------------------------------------------
    const podDefs = [
      { no: 1, x: -2.5, side: 'outer' },
      { no: 2, x: 0.3, side: 'outer' },
      { no: 3, x: 3.1, side: 'outer' },
      { no: 4, x: -3.1, side: 'inner' },
      { no: 5, x: -0.3, side: 'inner' },
      { no: 6, x: 2.5, side: 'inner' },
    ];
    const pods = podDefs.map((d) => buildPod(mctx, M, C, d, CREW[d.no - 1]));

    // ------------------------------------------------------------------
    // Tavan soğutucu manifoldu + kablo kanalları
    // ------------------------------------------------------------------
    for (const sz of [-1, 1]) {
      const z = sz * 2.95;
      addRod(root, [-5.4, 2.95, z], [5.4, 2.95, z], { radius: 0.045, material: M.aluminium, segments: 10 });
      addRod(root, [-5.4, 2.82, z + sz * -0.12], [5.4, 2.82, z + sz * -0.12], { radius: 0.03, material: M.metal, segments: 8 });
      vBox(root, { size: [10.8, 0.05, 0.3], color: 0x55585c, pos: [0, 3.12, sz * 2.55] }); // kablo kanalı
      for (let x = -5; x <= 5; x += 1.25) {
        addBox(root, { size: [0.05, 0.3, 0.12], pos: [x, 3.0, z], material: M.metalDark });
        vBox(root, { size: [0.06, 0.012, 0.07], color: 0x3d7fb0, pos: [x + 0.4, 2.95, z + sz * 0.03] }); // soğutucu renk bandı
      }
      label(root, 'SOĞUTUCU — GLİKOL  −40 °C', {
        pos: [-1.2, 2.82, z + sz * -0.165],
        rot: [0, sz > 0 ? Math.PI : 0, 0],
        height: 0.035,
        color: '#e8e8e8',
        bg: '#245a8a',
      });
    }
    addCableRun(root, [-5.3, 3.08, 2.3], [5.3, 3.08, 2.3], { n: 4, sag: 0.08, radius: 0.012, material: M.cable, seed: 9 });
    addCableRun(root, [-5.3, 3.08, -2.3], [5.3, 3.08, -2.3], { n: 3, sag: 0.1, radius: 0.012, material: M.cable, seed: 4 });

    // Duvar korkulukları (kapsüllerin üstünde)
    addRail(root, [-5.2, 1.72, -3.38], [5.2, 1.72, -3.38], { material: M.handrail, out: [0, 0, 1], depth: 0.1, standoffs: 6 });
    addRail(root, [-5.2, 1.72, 3.38], [5.2, 1.72, 3.38], { material: M.handrail, out: [0, 0, -1], depth: 0.1, standoffs: 6 });

    // Duvar etiketleri
    label(root, 'HİPER-UYKU BÖLMESİ', { pos: [-1.1, 2.5, -3.47], height: 0.09, color: '#2a2a2a' });
    label(root, 'DİKKAT — KRİYOJENİK SOĞUTUCU', { pos: [1.7, 2.5, -3.47], height: 0.06, color: '#1a1a1a', bg: '#d8a21a' });
    label(root, 'KAPAKLARI ZORLAMAYIN — BASINÇ DENGELENSİN', { pos: [0, 2.5, 3.47], rot: [0, Math.PI, 0], height: 0.055, color: '#1a1a1a', bg: '#d8a21a' });
    label(root, 'MODÜL 02', { pos: [-4.6, 2.65, 3.47], rot: [0, Math.PI, 0], height: 0.07, color: '#3a3a3a' });

    // ------------------------------------------------------------------
    // +X ucu, dış köşe: hiper-uyku kontrol konsolu (−X'e bakar)
    // ------------------------------------------------------------------
    const ctl = new THREE.Group();
    ctl.position.set(4.95, 0, -2.45);
    ctl.rotation.y = -Math.PI / 2;
    root.add(ctl);
    addBox(ctl, { size: [1.5, 0.95, 0.6], pos: [0, 0.475, -0.1], material: M.panelMid, collide: true, name: 'cryo-console' });
    const ctlFace = new THREE.Group();
    ctlFace.position.set(0, 0.95, 0.2);
    ctlFace.rotation.x = -1.0;
    ctl.add(ctlFace);
    addBox(ctlFace, { size: [1.5, 0.45, 0.04], pos: [0, 0.2, -0.02], material: C.console });
    addSwitchBank(ctlFace, { pos: [-0.45, 0.2, 0], cols: 6, rows: 3, guarded: [0, 6, 12], seed: 21 });
    addGauge(ctlFace, { pos: [0.18, 0.28, 0], radius: 0.045, needle: 0.6 });
    addGauge(ctlFace, { pos: [0.32, 0.28, 0], radius: 0.045, needle: -0.4 });
    addGauge(ctlFace, { pos: [0.46, 0.28, 0], radius: 0.045, needle: 1.1 });
    label(ctlFace, 'SOĞUTUCU  BASINÇ  O₂', { pos: [0.32, 0.36, 0.003], height: 0.025, color: '#e8e2d0' });
    // dik ekran paneli
    addBox(ctl, { size: [1.5, 0.9, 0.12], pos: [0, 1.75, -0.32], material: C.console });
    const ctlScreen = addScreen(ctl, { pos: [-0.2, 1.78, -0.25], w: 0.62, h: 0.42, res: [384, 260], color: '#7dff9a' });
    addScreen(ctl, { pos: [0.48, 1.86, -0.25], w: 0.26, h: 0.18, res: [192, 128], color: '#ffb347' }).draw((g, w, h) => {
      g.font = 'bold 22px monospace';
      g.fillText('KAPSÜL', 10, 14);
      g.fillText('ISITICI', 10, 44);
      g.fillStyle = '#ffb347';
      g.fillRect(10, 84, 120, 14);
      g.font = '14px monospace';
      g.fillText('HAZIR', 140, 84);
    });
    addBox(ctl, { size: [0.08, 0.08, 0.02], pos: [0.48, 1.6, -0.25], material: C.indBackup });
    label(ctl, 'YEDEK GÜÇ', { pos: [0.48, 1.53, -0.255], height: 0.03, color: '#e8e2d0' });
    label(ctl, 'HİPER-UYKU KONTROL', { pos: [-0.2, 2.1, -0.255], height: 0.05, color: '#e8e2d0' });
    addVent(ctl, { pos: [0.4, 0.35, 0.205], w: 0.5, h: 0.3, frameMaterial: M.metalDark, slatMaterial: M.panelDark });
    addHose(root, [[5.2, 2.2, -2.9], [5.25, 2.7, -3.1], [5.2, 3.1, -3.0]], { radius: 0.025, material: M.cable });

    // ------------------------------------------------------------------
    // +X ucu, iç köşe: giysi dolapları
    // ------------------------------------------------------------------
    addLocker(root, { pos: [4.35, 0, 3.15], rotY: Math.PI, w: 0.6, h: 2.0, d: 0.55, M, text: 'TULUM 1–3', seed: 3 }).userData.collide = true;
    addLocker(root, { pos: [5.0, 0, 3.15], rotY: Math.PI, w: 0.6, h: 2.0, d: 0.55, M, text: 'TULUM 4–6', seed: 4 }).userData.collide = true;

    // ------------------------------------------------------------------
    // −X ucu, dış köşe: uyanma tezgâhı (havlu, katlanmış tulum, su)
    // ------------------------------------------------------------------
    const wake = new THREE.Group();
    wake.position.set(-4.75, 0, -2.75);
    root.add(wake);
    addBox(wake, { size: [1.1, 0.06, 0.55], pos: [0, 0.46, 0], material: M.panelLight, collide: true, name: 'wake-bench' });
    addBox(wake, { size: [0.05, 0.46, 0.5], pos: [-0.5, 0.23, 0], material: M.metalDark });
    addBox(wake, { size: [0.05, 0.46, 0.5], pos: [0.5, 0.23, 0], material: M.metalDark });
    vBox(wake, { size: [0.42, 0.1, 0.34], color: 0x40536b, matte: true, pos: [-0.22, 0.54, 0.0] }); // katlı tulum
    vBox(wake, { size: [0.4, 0.04, 0.32], color: 0xc9772f, matte: true, pos: [-0.22, 0.61, 0.0] }); // görev yaması rengi şerit
    vBox(wake, { size: [0.36, 0.07, 0.3], color: 0xe9e6dc, matte: true, pos: [0.25, 0.525, 0.02], rot: [0, 0.2, 0] }); // havlu
    vCyl(wake, { radius: 0.035, height: 0.2, color: 0xd6e6ee, pos: [0.42, 0.59, -0.15] }); // su şişesi
    vCyl(wake, { radius: 0.02, height: 0.03, color: 0x2a6fb0, pos: [0.42, 0.705, -0.15] });
    vBox(wake, { size: [0.28, 0.12, 0.12], color: 0x2b2b2b, pos: [-0.2, 0.06, 0.12] }); // botlar
    vBox(wake, { size: [0.28, 0.12, 0.12], color: 0x2b2b2b, pos: [0.1, 0.06, 0.14], rot: [0, 0.25, 0] });
    label(wake, 'UYANINCA: YAVAŞ KALK · SU İÇ · BEKLE', { pos: [0, 1.25, -0.25], height: 0.045, color: '#1a1a1a', bg: '#e8e2cf' });
    addPicture(root, { key: 'earth', draw: drawEarth, pos: [-4.4, 1.55, -3.47], w: 0.2, h: 0.2, res: [192, 192], tilt: 0.04 });

    // −X ucu, iç köşe: yangın söndürücü + O2 maskeleri
    const fe = new THREE.Group();
    fe.position.set(-5.3, 0, 2.6);
    fe.rotation.y = Math.PI / 2;
    root.add(fe);
    vBox(fe, { size: [0.4, 0.55, 0.1], color: 0xd8d2c0, pos: [0, 1.3, 0.05] });
    vCyl(fe, { radius: 0.075, height: 0.45, color: 0xb02a1c, pos: [0, 1.0, 0.13] });
    vCyl(fe, { radius: 0.03, height: 0.06, color: 0x222222, pos: [0, 1.25, 0.13] });
    vBox(fe, { size: [0.12, 0.03, 0.03], color: 0x222222, pos: [0.05, 1.28, 0.13] });
    for (let i = 0; i < 3; i++) vBox(fe, { size: [0.09, 0.06, 0.05], color: 0xe0b020, pos: [-0.12 + i * 0.12, 1.45, 0.12] });
    label(fe, 'O₂ MASKESİ', { pos: [0, 1.53, 0.102], height: 0.035, color: '#1a1a1a', bg: '#e0b020' });
    label(fe, 'YANGIN', { pos: [0, 0.68, 0.11], height: 0.04, color: '#f0f0f0', bg: '#b02a1c' });

    // ------------------------------------------------------------------
    // Ekranlar: kapsül yaşamsal değerleri + kontrol konsolu
    // ------------------------------------------------------------------
    const t0 = { wake: null };
    screenDriver(mctx, {
      hz: 12,
      draw: (t, powered) => {
        for (const pod of pods) drawVitals(pod, t, powered, mctx, t0);
        if (powered) drawControl(ctlScreen, t, pods);
        else drawNoPower(ctlScreen, 'ENERJİ YOK');
        if (powered) ctlScreen.material.emissiveIntensity = 1.2;
      },
    });

    // Diğer sistemler için küçük API (ör. giriş sinematiği)
    root.userData.cryo = {
      pods,
      setLid(no, open) {
        const p = pods.find((q) => q.no === no);
        if (p) p.setOpen(open, true);
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Tek kapsül
// ---------------------------------------------------------------------------
function buildPod(mctx, M, C, def, crew) {
  const root = mctx.group;
  const outer = def.side === 'outer';
  const g = new THREE.Group();
  g.name = `pod-${def.no}`;
  g.position.set(def.x, 0, outer ? -POD_Z : POD_Z);
  g.rotation.y = outer ? 0 : Math.PI;
  root.add(g);
  const r = rng(def.no * 13);
  const isPlayer = !!crew.player;
  const occupied = !!crew.occupied;

  // Kaide (çarpışma) + gövde
  addBox(g, { size: [2.3, 0.36, 0.95], pos: [0, 0.18, 0], material: M.metalDark, collide: true, name: `pod-${def.no}-base` });
  vBox(g, { size: [2.32, 0.04, 0.97], color: 0x2a2b2e, pos: [0, 0.02, 0] }); // tekme bandı
  addBox(g, { size: [2.2, 0.05, 0.85], pos: [0, 0.385, 0], material: M.plasticWhite });
  addBox(g, { size: [2.3, 0.5, 0.06], pos: [0, 0.61, 0.445], material: M.plasticWhite });
  addBox(g, { size: [2.3, 0.5, 0.06], pos: [0, 0.61, -0.445], material: M.plasticWhite });
  addBox(g, { size: [0.06, 0.5, 0.95], pos: [1.12, 0.61, 0], material: M.plasticWhite });
  addBox(g, { size: [0.06, 0.5, 0.95], pos: [-1.12, 0.61, 0], material: M.plasticWhite });
  // kenar profilleri
  addBox(g, { size: [2.34, 0.025, 0.08], pos: [0, RIM_Y - 0.01, 0.445], material: M.aluminium });
  addBox(g, { size: [2.34, 0.025, 0.08], pos: [0, RIM_Y - 0.01, -0.445], material: M.aluminium });
  addBox(g, { size: [0.08, 0.025, 0.95], pos: [1.12, RIM_Y - 0.01, 0], material: M.aluminium });
  addBox(g, { size: [0.08, 0.025, 0.95], pos: [-1.12, RIM_Y - 0.01, 0], material: M.aluminium });
  // ön yüzde servis kapakları, tutamak, isim plakası
  for (const x of [-0.6, 0.15, 0.85]) {
    addBox(g, { size: [0.42, 0.28, 0.01], pos: [x, 0.58, 0.478], material: M.panelLight });
    vBox(g, { size: [0.08, 0.015, 0.012], color: 0x444444, pos: [x, 0.69, 0.484] });
  }
  addRail(g, [-0.9, 0.78, 0.53], [0.9, 0.78, 0.53], { material: M.aluminium, radius: 0.014, out: [0, 0, 1], depth: 0.06, standoffs: 2 });
  label(g, `${def.no}`, { pos: [-0.95, 0.6, 0.485], height: 0.14, color: '#2a2a2a' });
  label(g, crew.player ? 'KAPSÜL 1 — GÖREV PİLOTU' : crew.occupied ? `KAPSÜL ${def.no} — ${crew.name}` : `KAPSÜL ${def.no} — YEDEK`, {
    pos: [0.15, 0.4, 0.483],
    height: 0.035,
    color: '#1d1d1d',
    bg: '#e8e2cf',
  });

  // İç dolgu
  addBox(g, { size: [1.95, 0.05, 0.7], pos: [0, 0.435, 0], material: M.padding });
  addBox(g, { size: [0.28, 0.07, 0.4], pos: [-0.88, 0.47, 0], material: M.padding }); // baş yastığı

  // Sıvı / mürettebat
  if (occupied) {
    addBox(g, { size: [2.18, 0.02, 0.83], pos: [0, 0.66, 0], material: C.milk });
    const s = createSleeper(C.sleeper, C.sleeperWrap, def.no);
    s.position.set(0.02, 0.48, 0);
    g.add(s);
  } else if (isPlayer) {
    // boşaltılmış: dipte ince sıvı kalıntısı, buruşuk örtü
    addBox(g, { size: [1.6, 0.012, 0.5], pos: [0.1, 0.466, 0.04], material: C.milk });
    vBox(g, { size: [0.5, 0.03, 0.4], color: 0xd9dcd8, pos: [0.65, 0.475, -0.1], rot: [0.05, 0.4, 0.08] });
  } else {
    // yedek: katlanmış battaniye
    vBox(g, { size: [0.5, 0.08, 0.4], color: 0x7a8794, matte: true, pos: [0.6, 0.5, 0] });
  }

  // Baş ucu sütunu (yaşam destek ünitesi)
  const col = new THREE.Group();
  col.position.set(-1.27, 0, 0);
  g.add(col);
  addBox(col, { size: [0.18, 1.02, 0.72], pos: [0, 0.51, 0], material: M.panelMid, collide: true, name: `pod-${def.no}-column` });
  addBox(col, { size: [0.19, 0.3, 0.6], pos: [0, 0.6, 0], material: M.panelDark });
  for (let i = 0; i < 4; i++) addBox(col, { size: [0.192, 0.012, 0.5], pos: [0, 0.5 + i * 0.05, 0], material: M.metalDark });
  addBox(col, { size: [0.02, 0.025, 0.025], pos: [0.1, 0.9, 0.25], material: occupied ? C.indGreen : C.indAmber });
  addBox(col, { size: [0.02, 0.025, 0.025], pos: [0.1, 0.9, 0.2], material: M.ledRed });
  // hortumlar: sütundan tekneye
  addHose(g, [[-1.2, 0.85, -0.2], [-1.05, 0.98, -0.2], [-0.95, 0.9, -0.25]], { radius: 0.018, material: M.cable, segments: 10 });
  addHose(g, [[-1.2, 0.8, 0.25], [-1.0, 0.95, 0.3], [-0.9, 0.88, 0.32]], { radius: 0.014, material: M.rubber, segments: 10 });
  // sütundan tavana soğutucu boruları
  addRod(col, [0, 1.02, -0.25], [0, 2.82, -0.25], { radius: 0.022, material: M.aluminium });
  addRod(col, [0, 1.02, -0.12], [0, 2.95, -0.12], { radius: 0.016, material: M.metal });
  // monitör kolu + yaşamsal ekran
  addRod(col, [0, 1.02, 0.15], [0.06, 1.18, 0.3], { radius: 0.015, material: M.metalDark });
  const screen = addScreen(g, {
    pos: [-1.17, 1.28, 0.3],
    rot: [-0.18, 0.35, 0],
    w: 0.3,
    h: 0.2,
    res: [256, 168],
    color: '#7dff9a',
  });

  // Kapak (menteşeli, dış duvar tarafı)
  const hinge = new THREE.Group();
  hinge.name = `pod-${def.no}-lid`;
  hinge.position.set(0, RIM_Y, -0.475);
  g.add(hinge);
  const lidParts = new THREE.Group();
  hinge.add(lidParts);
  addBox(lidParts, { size: [2.34, 0.05, 0.06], pos: [0, 0.025, 0.03], material: M.aluminium });
  addBox(lidParts, { size: [2.34, 0.05, 0.06], pos: [0, 0.025, 0.92], material: M.aluminium });
  addBox(lidParts, { size: [0.06, 0.05, 0.95], pos: [1.14, 0.025, 0.475], material: M.aluminium });
  addBox(lidParts, { size: [0.06, 0.05, 0.95], pos: [-1.14, 0.025, 0.475], material: M.aluminium });
  addBox(lidParts, { size: [2.22, 0.012, 0.52], pos: [0, 0.165, 0.475], material: M.glassFrosted });
  const slant = Math.atan2(0.12, 0.17);
  addBox(lidParts, { size: [2.22, 0.012, 0.21], pos: [0, 0.105, 0.12], rot: [-slant, 0, 0], material: M.glassFrosted });
  addBox(lidParts, { size: [2.22, 0.012, 0.21], pos: [0, 0.105, 0.83], rot: [slant, 0, 0], material: M.glassFrosted });
  addBox(lidParts, { size: [0.012, 0.13, 0.82], pos: [1.11, 0.1, 0.475], material: M.glassFrosted });
  addBox(lidParts, { size: [0.012, 0.13, 0.82], pos: [-1.11, 0.1, 0.475], material: M.glassFrosted });
  // kapak kolu (koridor tarafı)
  addBox(lidParts, { size: [0.3, 0.03, 0.05], pos: [0.3, 0.05, 0.97], material: M.metalDark });
  // menteşeler
  for (const x of [-0.8, 0, 0.8]) addCylinder(hinge, { radius: 0.025, height: 0.14, segments: 8, pos: [x, 0, 0], rot: [0, 0, Math.PI / 2], material: M.metalDark });
  mergeStatic(hinge); // kapak tek bir dinamik birim: birkaç çizim çağrısı

  const pod = {
    no: def.no,
    crew,
    group: g,
    lid: hinge,
    screen,
    open: isPlayer,
    angle: isPlayer ? LID_OPEN : 0,
    phase: r() * 10,
    setOpen(v, silent = false) {
      if (this.open === v) return;
      this.open = v;
      if (!silent) sfx(mctx, 'hiss', { position: mctx.toWorld(def.x, 1, outer ? -POD_Z : POD_Z) });
    },
  };
  hinge.rotation.x = -pod.angle;

  mctx.interactions.add(hinge, {
    id: `cryo-pod-${def.no}`,
    prompt: () => {
      const verb = pod.open ? 'Kapağı kapat' : 'Kapağı aç';
      if (isPlayer) return `${verb} (senin kapsülün)`;
      if (occupied) return `${verb} — Kapsül ${def.no}`;
      return verb;
    },
    onInteract: () => {
      pod.setOpen(!pod.open);
      if (pod.open && occupied) {
        mctx.ui?.subtitle?.(null, `Kapsül ${def.no} — ${crew.name} (${crew.role}). Hiper-uykuda; yaşamsal değerler kararlı.`, 4000);
      } else if (pod.open && isPlayer) {
        mctx.ui?.toast?.('Kapsül hâlâ nemli. Uyku sıvısı kokusu…');
      }
    },
    distance: 2.8,
  });

  // Menteşe animasyonu (yalnızca hareket varken çalışır)
  mctx.onUpdate((dt) => {
    const target = pod.open ? LID_OPEN : 0;
    if (Math.abs(pod.angle - target) < 0.0005) return;
    pod.angle = THREE.MathUtils.damp(pod.angle, target, 3.2, dt);
    if (Math.abs(pod.angle - target) < 0.001) pod.angle = target;
    hinge.rotation.x = -pod.angle;
  });

  return pod;
}

// ---------------------------------------------------------------------------
// Ekran çizimleri
// ---------------------------------------------------------------------------
function fmtCycle(days) {
  const y = Math.floor(days / 365);
  const d = Math.floor(days % 365);
  return `${y}y ${String(d).padStart(3, '0')}g`;
}

function drawVitals(pod, t, powered, mctx, t0) {
  const scr = pod.screen;
  const crew = pod.crew;
  const color = powered ? '#7dff9a' : '#ff5a3a';
  scr.material.emissiveIntensity = powered ? 1.2 : 0.85;
  scr.draw((g, w, h) => {
    const head = powered ? 'YAŞAM DESTEK' : 'YEDEK BATARYA';
    const hh = draw2d.header(g, w, h, `KAPSÜL ${pod.no}`, color, head);
    if (crew.player) {
      if (t0.wake === null) t0.wake = t;
      const s = Math.max(0, Math.floor(t - t0.wake + 197));
      draw2d.text(g, 'BOŞ — UYANDIRMA', 8, hh + 8, 20, color);
      draw2d.text(g, 'TAMAMLANDI', 8, hh + 32, 20, color);
      draw2d.ecg(g, 8, hh + 56, w - 16, 44, t, 60, color, true);
      const hms = `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
      draw2d.text(g, `UYANIK  ${hms}`, 8, h - 26, 18, color);
      return;
    }
    if (!crew.occupied) {
      draw2d.text(g, 'YEDEK KAPSÜL', 8, hh + 10, 20, color);
      draw2d.text(g, 'HAZIR — BOŞ', 8, hh + 36, 20, color);
      g.globalAlpha = 0.4;
      draw2d.ecg(g, 8, hh + 62, w - 16, 40, t, 60, color, true);
      g.globalAlpha = 1;
      return;
    }
    draw2d.text(g, crew.name, 8, hh + 4, 16, color);
    draw2d.ecg(g, 8, hh + 24, w - 16, 50, t + pod.phase, crew.bpm, color);
    const bpm = crew.bpm + Math.round(Math.sin(t * 0.3 + pod.phase));
    draw2d.text(g, `NABIZ ${String(bpm).padStart(2, ' ')}`, 8, hh + 86, 18, color);
    draw2d.text(g, `ISI ${crew.temp.toFixed(1)}°C`, w / 2 + 4, hh + 86, 18, color);
    draw2d.text(g, `DÖNGÜ ${fmtCycle(847 + t / 86400)}`, 8, hh + 110, 16, color);
    if (!powered && Math.floor(t * 2) % 2 === 0) draw2d.text(g, '! ŞEBEKE YOK', w - 8, hh + 110, 16, color, 'right');
  });
}

function drawControl(scr, t, pods) {
  const color = '#7dff9a';
  scr.draw((g, w, h) => {
    const hh = draw2d.header(g, w, h, 'HİPER-UYKU SİSTEMİ', color, 'DÖNGÜ 3/4');
    let y = hh + 8;
    for (const p of pods) {
      const st = p.crew.player ? 'UYANDI ' : p.crew.occupied ? 'UYKUDA ' : 'YEDEK  ';
      const lid = p.open ? 'AÇIK  ' : 'KAPALI';
      draw2d.text(g, `K${p.no}  ${st}  KAPAK ${lid}`, 10, y, 18, color);
      if (p.open && p.crew.occupied && Math.floor(t * 3) % 2 === 0) draw2d.text(g, '!', w - 20, y, 18, '#ffb347');
      y += 24;
    }
    y += 6;
    draw2d.text(g, 'GLİKOL  −40.2 °C', 10, y, 16, color);
    draw2d.bar(g, 200, y + 2, w - 214, 14, 0.72 + Math.sin(t * 0.4) * 0.02, color);
    y += 22;
    draw2d.text(g, 'O₂ KARIŞIM  %38', 10, y, 16, color);
    draw2d.bar(g, 200, y + 2, w - 214, 14, 0.38, color);
  });
}
