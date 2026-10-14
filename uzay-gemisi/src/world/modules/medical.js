import * as THREE from 'three';
import { buildShell } from '../structure/shell.js';
import { addBox, addCylinder, addMesh } from '../utils.js';
import {
  crewMaterials,
  vBox,
  vCyl,
  colorize,
  label,
  addScreen,
  addMonitor,
  drawNoPower,
  screenDriver,
  draw2d,
  addRail,
  addRod,
  addHose,
  addCableRun,
  addVent,
  addDesk,
  addChair,
  addGauge,
  addPicture,
  addProxy,
  addTube,
  bagMaterial,
  createSleeper,
  place,
  pictureMaterial,
  createTimers,
  openTerminal,
  sfx,
  rng,
} from './crew/kit.js';

/**
 * Revir — tıbbi tarayıcı kemerli yatak, ilaç çekmeceleri, serum askısı, santrifüj, defibrilatör.
 *
 * Etkileşimler:
 *   medical-scanner   Tarama yatağı (enerji gerekir): kemer yatağın üstünden geçer, hologram siluet belirir,
 *                     sonra terminalde yaşamsal değerler gösterilir
 *   medical-centrifuge  Santrifüj: kapak kapanır, rotor döner, durur
 *   medical-defib     Defibrilatör (bataryalı; enerjisiz de çalışır): şarj sekansı
 *   medical-drawer-a/b  İlaç çekmeceleri (kayarak açılır)
 *
 * Yerleşim: dış duvarda (z<0) yatak + kemer, pencere, çalışma masası, ilaç arabası; iç duvarda (z>0)
 * çekmeceli dolap, camlı dolap, defibrilatör, poster, buzdolabı, tezgâh (santrifüj, mikroskop). Şerit boş.
 */
const PI = Math.PI;
const BED_X = -3.0;
const BED_Z = -2.0;
const ARCH_HOME = -3.95; // kemer park konumu (baş ucu)
const ARCH_END = -2.1; // tarama sonu (ayak ucu)

let holoMat = null;
function hologramMaterial() {
  if (!holoMat) {
    holoMat = new THREE.MeshBasicMaterial({ color: 0x7fe6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    holoMat.name = 'crewHologram';
  }
  return holoMat;
}

export default {
  id: 'medical',
  name: 'Revir',
  build(mctx) {
    const M = mctx.materials;
    const C = crewMaterials(mctx);
    const root = mctx.group;
    const timers = createTimers(mctx);

    buildShell(mctx, {
      outerWindows: [{ x: -0.4, w: 1.6, y: 1.2, h: 0.9 }],
      lights: 3,
      lightColor: 0xeaf6ff,
      lightIntensity: 6.5,
      accent: 0x4fd0e0,
    });
    // Tarama sırasında yanan soğuk ışık (4. ışık). Başta kapalı: intensity 0 → havuzu boşa harcamaz.
    const scanLight = mctx.addLight([BED_X, 1.5, -1.5], { color: 0x7fe6ff, intensity: 0, distance: 5, emergency: null });

    // ------------------------------------------------------------------
    // Tarama yatağı + kemer
    // ------------------------------------------------------------------
    const scanner = buildScanner(mctx, M, C, timers, root, scanLight);

    // yatak başı gaz paneli + serum askısı
    const gas = place(root, [-4.6, 1.15, -3.48]);
    addBox(gas, { size: [0.7, 0.34, 0.04], pos: [0, 0, 0], material: M.metalDark });
    for (let i = 0; i < 3; i++) {
      vCyl(gas, { radius: 0.04, height: 0.03, segments: 12, color: [0x2a6fb0, 0xd8d4c8, 0x3d7a4a][i], pos: [-0.22 + i * 0.22, 0.02, 0.03], rot: [PI / 2, 0, 0] });
      vCyl(gas, { radius: 0.016, height: 0.035, segments: 8, color: 0x15181c, pos: [-0.22 + i * 0.22, 0.02, 0.04], rot: [PI / 2, 0, 0] });
      label(gas, ['O₂', 'VAKUM', 'HAVA'][i], { pos: [-0.22 + i * 0.22, -0.09, 0.025], height: 0.032, color: '#e8e2d0' });
    }
    buildIvStand(mctx, M, C, root, [-4.45, 0, -1.45]);

    label(root, 'REVİR', { pos: [-4.1, 2.62, -3.49], height: 0.16, color: '#2a3a46' });
    label(root, 'TARAMA ÖNCESİ ÇELİK EŞYA ÇIKARIN', { pos: [-4.1, 2.38, -3.49], height: 0.05, color: '#1a1a1a', bg: '#d8a21a' });

    // ------------------------------------------------------------------
    // Dış duvar: çalışma masası + ilaç arabası
    // ------------------------------------------------------------------
    const desk = addDesk(root, { pos: [2.0, 0, -3.1], w: 1.8, d: 0.7, M });
    desk.userData.collide = true;
    const mon1 = addMonitor(root, { pos: [1.6, 0.76, -3.15], w: 0.42, h: 0.28, res: [360, 240], color: '#8ef5ff' });
    const mon2 = addMonitor(root, { pos: [2.25, 0.76, -3.15], w: 0.36, h: 0.26, res: [320, 232], color: '#7dff9a' });
    mon1.group.rotation.y = 0.12;
    mon2.group.rotation.y = -0.15;
    vBox(root, { size: [0.3, 0.012, 0.2], color: 0xe8e2cf, matte: true, pos: [1.15, 0.766, -2.9], rot: [0, 0.2, 0] }); // evrak
    vCyl(root, { radius: 0.035, height: 0.09, segments: 10, color: 0xe9e6dc, pos: [2.7, 0.805, -2.85] });
    addChair(root, { pos: [2.0, 0, -2.35], rotY: PI, M, color: 0x3a6a78 });
    // masa üstü pano + poster
    addPicture(root, { key: 'anatomy', draw: drawAnatomy, pos: [3.2, 1.55, -3.49], w: 0.46, h: 0.64, res: [320, 448], tilt: 0.02 });
    label(root, 'HASTA KAYITLARI', { pos: [2.0, 1.45, -3.49], height: 0.05, color: '#1a1a1a', bg: '#e8e2cf' });

    buildCart(root, M, C, [4.55, 0, -3.05]);
    // ------------------------------------------------------------------
    // İç duvar: çekmeceli dolap, camlı dolap, defibrilatör, buzdolabı, tezgâh
    // ------------------------------------------------------------------
    const drawers = buildDrawerCabinet(mctx, M, C, root, -4.35);
    buildGlassCabinet(mctx, M, C, root, -2.55);
    const defib = buildDefib(mctx, M, C, timers, root, -0.9);
    addPicture(root, { key: 'eye', draw: drawEyeChart, pos: [-0.15, 1.6, 3.49], rot: [0, PI, 0], w: 0.32, h: 0.46, res: [256, 368], tilt: -0.02 });
    // ilk yardım dolabı
    const fa = place(root, [0.75, 1.5, 3.46], PI);
    addBox(fa, { size: [0.42, 0.34, 0.12], pos: [0, 0, 0], material: M.plasticWhite });
    vBox(fa, { size: [0.12, 0.04, 0.01], color: 0xb02a1c, pos: [0, 0.01, 0.065] });
    vBox(fa, { size: [0.04, 0.12, 0.01], color: 0xb02a1c, pos: [0, 0.01, 0.065] });
    label(fa, 'İLK YARDIM', { pos: [0, -0.12, 0.062], height: 0.035, color: '#1a1a1a' });

    buildFridge(mctx, M, C, root, 2.05);
    const lab = buildBench(mctx, M, C, timers, root);

    label(root, 'TIBBİ MÜDAHALE ALANI', { pos: [0.4, 2.62, 3.49], rot: [0, PI, 0], height: 0.1, color: '#2a3a46' });
    label(root, 'DEFİBRİLATÖR → SOL', { pos: [-1.1, 2.1, 3.49], rot: [0, PI, 0], height: 0.04, color: '#1a1a1a', bg: '#d8a21a' });

    // tavan boruları ve kablolar
    for (const sz of [-1, 1]) addRod(root, [-5.4, 3.02, sz * 3.2], [5.4, 3.02, sz * 3.2], { radius: 0.035, material: M.aluminium, segments: 8 });
    addCableRun(root, [-5.3, 3.12, 1.4], [5.3, 3.12, 1.4], { n: 3, sag: 0.07, radius: 0.012, material: M.cable, seed: 41 });
    addVent(root, { pos: [0.3, 2.95, -3.49], w: 0.7, h: 0.2, frameMaterial: M.metalDark, slatMaterial: M.panelDark });

    // ------------------------------------------------------------------
    // Ekranlar
    // ------------------------------------------------------------------
    const t0 = { v: 0 };
    screenDriver(mctx, {
      hz: 6,
      draw: (t, powered) => {
        const sc = scanner.screens;
        if (!powered) {
          drawNoPower(sc.wall, 'ENERJİ YOK');
          drawNoPower(sc.head, 'ENERJİ YOK');
          drawNoPower(mon1.screen, 'ENERJİ YOK');
          drawNoPower(mon2.screen, 'ENERJİ YOK');
        } else {
          drawWallScan(sc.wall, t, scanner.state);
          drawHeadMonitor(sc.head, t, scanner.state);
          drawRecords(mon1.screen, t);
          drawEcgDesk(mon2.screen, t);
          for (const s of [sc.wall, sc.head, mon1.screen, mon2.screen]) s.material.emissiveIntensity = 1.15;
        }
        drawDefib(defib.screen, t, powered, defib.state);
        drawBench(lab.screen, t, powered, lab.state);
        void t0;
      },
    });

    root.userData.medical = { scanner, defib, lab, drawers };
  },
};

// ---------------------------------------------------------------------------
// Tarayıcı kemerli tıbbi yatak
// ---------------------------------------------------------------------------
function buildScanner(mctx, M, C, timers, root, scanLight) {
  // yatak
  const bed = place(root, [BED_X, 0, BED_Z], 0, 'med-bed');
  addBox(bed, { size: [1.5, 0.5, 0.5], pos: [0, 0.33, 0], material: M.panelMid });
  addBox(bed, { size: [2.05, 0.06, 0.72], pos: [0, 0.6, 0], material: M.metalDark });
  vBox(bed, { size: [1.96, 0.12, 0.66], color: 0xd6dfe3, matte: true, pos: [0, 0.69, 0] });
  vBox(bed, { size: [0.4, 0.09, 0.5], color: 0xf0f0ea, matte: true, pos: [-0.74, 0.8, 0], rot: [0, 0, 0.06] });
  vBox(bed, { size: [0.9, 0.035, 0.66], color: 0x7fb4c4, matte: true, pos: [0.52, 0.765, 0] });
  addBox(bed, { size: [0.05, 0.4, 0.74], pos: [-1.04, 0.74, 0], material: M.panelLight });
  addBox(bed, { size: [0.05, 0.24, 0.74], pos: [1.04, 0.7, 0], material: M.panelLight });
  for (const sz of [-1, 1]) {
    addRod(bed, [-0.7, 0.92, sz * 0.37], [0.15, 0.92, sz * 0.37], { radius: 0.012, material: M.handrail, segments: 6 });
    for (const x of [-0.7, 0.15]) addRod(bed, [x, 0.74, sz * 0.37], [x, 0.92, sz * 0.37], { radius: 0.01, material: M.handrail, segments: 5 });
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    vCyl(bed, { radius: 0.05, height: 0.06, segments: 10, color: 0x16181a, pos: [sx * 0.8, 0.05, sz * 0.25], rot: [PI / 2, 0, 0] });
  }
  label(bed, 'TARAMA YATAĞI · MOD-3', { pos: [0.0, 0.5, 0.26], height: 0.035, color: '#1a1a1a', bg: '#e8e2cf' });
  bed.userData.collide = true;
  // kemer rayları (zemine yakın, çarpışma yok)
  for (const sz of [-1, 1]) addBox(root, { size: [2.5, 0.04, 0.12], pos: [BED_X - 0.1, 0.02, BED_Z + sz * 0.58], material: M.metalDark });
  addCableRun(root, [-5.0, 0.3, BED_Z - 0.75], [-4.0, 0.08, BED_Z - 0.62], { n: 2, sag: 0.04, radius: 0.015, material: M.cable, seed: 7 });

  // tarama kemeri (dinamik)
  const arch = place(root, [ARCH_HOME, 0, BED_Z], 0, 'med-arch');
  const half = new THREE.TorusGeometry(0.62, 0.075, 8, 28, PI);
  addMesh(arch, half, M.plasticWhite, { pos: [0, 0.76, 0], rot: [0, PI / 2, 0] });
  addMesh(arch, new THREE.TorusGeometry(0.54, 0.014, 6, 28, PI), C.scanRing, { pos: [0, 0.76, 0], rot: [0, PI / 2, 0] });
  for (const sz of [-1, 1]) {
    addBox(arch, { size: [0.26, 0.64, 0.17], pos: [0, 0.4, sz * 0.62], material: M.plasticWhite });
    addBox(arch, { size: [0.28, 0.06, 0.2], pos: [0, 0.06, sz * 0.62], material: M.metalDark });
    addBox(arch, { size: [0.04, 0.06, 0.02], pos: [0.1, 0.6, sz * 0.7], material: C.indGreen });
  }
  addBox(arch, { size: [0.16, 0.1, 0.5], pos: [0, 1.4, 0], material: M.metalDark });
  const beam = addMesh(arch, new THREE.PlaneGeometry(1.0, 0.62), C.scanBeam, { pos: [0, 1.08, 0], rot: [0, PI / 2, 0] });
  beam.userData.noShadow = true;
  const beamFloor = addMesh(arch, new THREE.PlaneGeometry(0.5, 1.2), C.scanBeam, { pos: [0, 0.77, 0], rot: [-PI / 2, 0, 0] });
  beamFloor.userData.noShadow = true;
  arch.userData.dynamic = true;

  // hologram siluet (tarama sırasında belirir)
  const holo = createSleeper(hologramMaterial(), null, 3);
  const holoRoot = place(root, [BED_X + 0.05, 0.775, BED_Z], 0, 'med-hologram');
  holoRoot.add(holo);
  holoRoot.visible = false;
  holoRoot.userData.dynamic = true;

  // ekranlar
  const wall = addScreen(root, { pos: [BED_X, 1.85, -3.46], w: 1.1, h: 0.62, res: [512, 288], color: '#8ef5ff', depth: 0.05 });
  const head = addScreen(root, { pos: [-4.1, 1.35, -3.47], w: 0.3, h: 0.2, res: [256, 168], color: '#7dff9a', depth: 0.04 });
  label(root, 'TARAMA · MOD-3', { pos: [BED_X, 2.26, -3.49], height: 0.05, color: '#d8e8ec' });

  // etkileşim vekili (yatak + kemer)
  const proxy = addProxy(root, { size: [2.4, 1.2, 1.0], pos: [BED_X, 0.7, BED_Z] });
  proxy.userData.dynamic = true;

  const st = { phase: 'idle', t: 0, progress: 0, reported: false };
  const T_SCAN = 4.6;
  const vitals = [
    'TIBBİ TARAMA — GÖREV PİLOTU',
    '────────────────────────────────────────',
    'Nabız .............. 61 atım/dk',
    'Tansiyon ........... 118 / 76 mmHg',
    'SpO₂ ............... %98',
    'Vücut ısısı ........ 36.4 °C',
    'Solunum ............ 14 / dk',
    'Kas kütlesi ........ %94 (hafif azalma)',
    'Kemik yoğunluğu .... sınırın alt ucu',
    'Radyasyon birikimi . 41 mSv (güvenli sınır altında)',
    'Hiper-uyku süresi .. 2 yıl 4 ay (gemi saati)',
    'Biyolojik yaş ...... 34.2 yıl',
    'Takvim yaşı ........ HESAPLANAMIYOR (zaman genişlemesi)',
    '────────────────────────────────────────',
    'DEĞERLENDİRME: Göreve elverişli.',
    'Öneri: bol su iç, ani hareketlerden kaçın, bir şeyler ye.',
  ];

  const finish = () => {
    st.phase = 'idle';
    st.t = 0;
    st.progress = 0;
  };

  mctx.onUpdate((dt) => {
    if (st.phase === 'idle' && arch.position.x <= ARCH_HOME + 0.001) {
      if (holoRoot.visible && C.scanBeam.opacity <= 0.001) holoRoot.visible = false;
      return;
    }
    st.t += dt;
    if (st.phase === 'scan') {
      st.progress = Math.min(1, st.t / T_SCAN);
      const e = st.progress < 0.5 ? 2 * st.progress * st.progress : 1 - Math.pow(-2 * st.progress + 2, 2) / 2;
      arch.position.x = THREE.MathUtils.lerp(ARCH_HOME, ARCH_END, e);
      const fade = Math.min(1, st.t / 0.8);
      hologramMaterial().opacity = 0.55 * fade * (0.85 + 0.15 * Math.sin(st.t * 9));
      C.scanBeam.opacity = 0.28 * fade;
      scanLight.intensity = 3.2 * fade;
      if (st.progress >= 1) {
        st.phase = 'report';
        st.t = 0;
        sfx(mctx, 'beep');
        sfx(mctx, 'terminal');
        openTerminal(mctx, {
          title: 'TIBBİ TARAMA SONUCU',
          color: 'blue',
          lines: vitals,
          options: [
            { label: 'Raporu kapat', action: () => {} },
          ],
          onClose: () => {
            st.phase = 'return';
            st.t = 0;
          },
        }) || (st.phase = 'return');
      }
    } else if (st.phase === 'report') {
      // terminal açıkken kemer sonda bekler, ışıma sönük
      hologramMaterial().opacity = 0.4 + 0.06 * Math.sin(st.t * 5);
      C.scanBeam.opacity = 0.05;
    } else if (st.phase === 'return') {
      const k = Math.min(1, st.t / 2.4);
      arch.position.x = THREE.MathUtils.lerp(ARCH_END, ARCH_HOME, k * k * (3 - 2 * k));
      hologramMaterial().opacity = Math.max(0, 0.4 * (1 - st.t / 1.2));
      C.scanBeam.opacity = 0;
      scanLight.intensity = Math.max(0, scanLight.intensity - dt * 3);
      if (k >= 1 && st.t > 2.5) {
        arch.position.x = ARCH_HOME;
        hologramMaterial().opacity = 0;
        scanLight.intensity = 0;
        holoRoot.visible = false;
        sfx(mctx, 'servo');
        finish();
      }
    }
  });

  mctx.interactions.add(proxy, {
    id: 'medical-scanner',
    prompt: () => (st.phase === 'idle' ? 'Tarayıcıyı çalıştır' : ''),
    distance: 3.0,
    enabled: () => st.phase === 'idle',
    onInteract: () => {
      if (!mctx.state.is('power_restored')) {
        sfx(mctx, 'error');
        mctx.ui?.toast?.('ENERJİ YOK — tarayıcı kemeri soğuk. Önce enerjiyi geri getirmelisin.', 3200);
        return;
      }
      st.phase = 'scan';
      st.t = 0;
      st.progress = 0;
      holoRoot.visible = true;
      sfx(mctx, 'servo');
      mctx.ui?.subtitle?.('SEN', 'Tarayıcı çalışıyor. Kemer yatağın üstünden geçerken biyolojik profilimi çıkarıyor.', 4200);
    },
  });
  void timers;
  return { group: arch, state: st, screens: { wall, head }, bed };
}

// ---------------------------------------------------------------------------
// Serum askısı
// ---------------------------------------------------------------------------
function buildIvStand(mctx, M, C, root, pos) {
  const g = place(root, pos, 0, 'iv-stand');
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * PI * 2 + 0.2;
    addRod(g, [0, 0.07, 0], [Math.cos(a) * 0.3, 0.05, Math.sin(a) * 0.3], { radius: 0.016, material: M.aluminium, segments: 6 });
    vCyl(g, { radius: 0.025, height: 0.03, segments: 8, color: 0x16181a, pos: [Math.cos(a) * 0.3, 0.025, Math.sin(a) * 0.3], rot: [PI / 2, 0, 0] });
  }
  const pole = addCylinder(g, { radius: 0.014, height: 1.95, segments: 8, pos: [0, 0.99, 0], material: M.aluminium, collide: true });
  void pole;
  addCylinder(g, { radius: 0.03, height: 0.1, segments: 8, pos: [0, 0.12, 0], material: M.metalDark });
  // askı kolları
  for (const sx of [-1, 1]) addRod(g, [0, 1.95, 0], [sx * 0.2, 1.88, 0], { radius: 0.008, material: M.aluminium, segments: 5 });
  addBox(g, { size: [0.06, 0.04, 0.06], pos: [0, 1.97, 0], material: M.metalDark });
  // serum torbaları
  for (const [sx, c] of [
    [-0.2, 0xcfe6f0],
    [0.2, 0xe8e2b0],
  ]) {
    const bag = place(g, [sx, 1.7, 0]);
    addMesh(bag, new THREE.BoxGeometry(0.12, 0.26, 0.05), bagMaterial(), {});
    vBox(bag, { size: [0.105, 0.17, 0.035], color: c, pos: [0, -0.04, 0] });
    label(bag, sx < 0 ? 'SF %0.9' : 'GLK %5', { pos: [0, 0.05, 0.027], height: 0.03, color: '#1a1a1a' });
    addRod(bag, [0, -0.13, 0], [0, -0.24, 0], { radius: 0.006, material: M.rubber, segments: 5 });
    vCyl(bag, { radius: 0.012, height: 0.06, segments: 8, color: 0xd9dcd8, pos: [0, -0.3, 0] });
  }
  addTube(g, [0.2, 1.38, 0.02], [0.55, 0.84, -0.28], { sag: 0.3, radius: 0.006, material: M.rubber });
  const s = place(g, [0, 1.2, 0.05]);
  vBox(s, { size: [0.22, 0.14, 0.1], color: 0xd8d4c8, pos: [0, 0, 0] });
  addBox(s, { size: [0.14, 0.06, 0.01], pos: [0, 0.01, 0.055], material: C.indGreen });
  return g;
}

// ---------------------------------------------------------------------------
// Tıbbi araba
// ---------------------------------------------------------------------------
function buildCart(root, M, C, pos) {
  const g = place(root, pos, 0, 'med-cart');
  addBox(g, { size: [0.64, 0.04, 0.46], pos: [0, 0.88, 0], material: M.aluminium });
  addBox(g, { size: [0.6, 0.62, 0.42], pos: [0, 0.54, 0], material: M.plasticWhite });
  for (let i = 0; i < 3; i++) {
    addBox(g, { size: [0.56, 0.17, 0.014], pos: [0, 0.3 + i * 0.2, 0.218], material: M.panelLight });
    addBox(g, { size: [0.14, 0.016, 0.02], pos: [0, 0.35 + i * 0.2, 0.232], material: M.metalDark });
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) vCyl(g, { radius: 0.045, height: 0.04, segments: 10, color: 0x16181a, pos: [sx * 0.25, 0.05, sz * 0.17], rot: [0, 0, PI / 2] });
  // üst: kapaklı tepsi, bandaj, şırınga kutusu
  vBox(g, { size: [0.28, 0.025, 0.2], color: 0xb9bcc0, pos: [-0.12, 0.915, 0.0] });
  vBox(g, { size: [0.1, 0.03, 0.08], color: 0xe8e2cf, matte: true, pos: [-0.14, 0.94, 0.0] });
  for (let i = 0; i < 3; i++) vCyl(g, { radius: 0.025, height: 0.05, segments: 10, color: 0xe8e2cf, matte: true, pos: [0.14 + i * 0.07, 0.94, 0.08], rot: [PI / 2, 0, 0] });
  vBox(g, { size: [0.16, 0.06, 0.1], color: 0xb02a1c, pos: [0.15, 0.94, -0.08] });
  vBox(g, { size: [0.1, 0.012, 0.012], color: 0xf0f0f0, pos: [0.15, 0.972, -0.08] });
  vBox(g, { size: [0.012, 0.1, 0.012], color: 0xf0f0f0, pos: [0.15, 0.972, -0.08], rot: [PI / 2, 0, 0] });
  addRail(g, [-0.31, 0.92, 0.2], [0.31, 0.92, 0.2], { material: M.handrail, out: [0, 0, 1], depth: 0.05, standoffs: 2, radius: 0.01 });
  label(g, 'İLAÇ ARABASI', { pos: [0, 0.86, 0.222], height: 0.03, color: '#1c1c1c', bg: '#e8e2cf' });
  g.userData.collide = true;
  return g;
}

// ---------------------------------------------------------------------------
// İlaç çekmeceleri
// ---------------------------------------------------------------------------

const DRAWER_NAMES = ['ELDİVEN', 'SARGI', 'ŞIRINGA', 'KAN ŞEKERİ', 'ANTİBİYOTİK', 'ANTİSEPTİK', 'STERİL GAZ', 'VİTAMİN', 'ATEŞ', 'ANALJEZİK', 'KAS GEVŞ.', 'ALERJİ', 'KAN BASINCI', 'BAĞIŞIKLIK', 'AMPUL · SERUM', 'YEDEK', 'MORFİN', 'SERUM SETİ'];

function buildDrawerCabinet(mctx, M, C, root, cx) {
  const g = place(root, [cx, 0, 3.25], PI, 'med-drawers');
  const W = 1.7;
  const H = 1.9;
  addBox(g, { size: [W, H, 0.5], pos: [0, H / 2, 0], material: M.panelMid });
  vBox(g, { size: [W, 0.07, 0.5], color: 0x1b1c1e, pos: [0, 0.035, 0] });
  addBox(g, { size: [W + 0.04, 0.04, 0.52], pos: [0, H + 0.02, 0], material: M.aluminium });
  const cols = 3;
  const rows = 6;
  const dw = (W - 0.08) / cols;
  const dh = (H - 0.2) / rows;
  const special = { a: [3, 0], b: [4, 2] }; // [satır, sütun]
  const specials = {};
  for (let rr = 0; rr < rows; rr++) {
    for (let cc = 0; cc < cols; cc++) {
      const x = -W / 2 + 0.04 + dw * (cc + 0.5);
      const y = 0.12 + dh * (rr + 0.5);
      const name = DRAWER_NAMES[rr * cols + cc];
      const key = rr === special.a[0] && cc === special.a[1] ? 'a' : rr === special.b[0] && cc === special.b[1] ? 'b' : null;
      const front = key ? place(g, [x, y, 0.25]) : g;
      const fx = key ? 0 : x;
      const fy = key ? 0 : y;
      const fz = key ? 0.008 : 0.258;
      addBox(front, { size: [dw - 0.014, dh - 0.014, 0.016], pos: [fx, fy, fz], material: M.panelLight });
      addBox(front, { size: [dw * 0.4, 0.014, 0.02], pos: [fx, fy + dh * 0.28, fz + 0.015], material: M.metalDark });
      label(front, name, { pos: [fx, fy - dh * 0.12, fz + 0.01], height: dh * 0.26, color: '#1c1c1c', bg: '#e8e2cf', width: dw * 0.78 });
      // renkli etiket şeridi
      vBox(front, { size: [dw - 0.014, 0.012, 0.004], color: [0xb02a1c, 0x2a6fb0, 0x3d7a4a, 0xd8a21a][(rr + cc) % 4], pos: [fx, fy + dh * 0.4, fz + 0.01] });
      if (key) {
        // çekmece gövdesi (açılınca görünen iç): küçük şişeler
        addBox(front, { size: [dw - 0.05, 0.07, 0.4], pos: [0, -dh * 0.15, -0.2], material: M.metalDark });
        const items = key === 'a' ? [0xe8e2cf, 0xd8a21a, 0xcfe6f0, 0xb02a1c] : [0xcfe6f0, 0xcfe6f0, 0xe8e2b0, 0xcfe6f0];
        items.forEach((c, i) => vCyl(front, { radius: 0.022, height: 0.1, segments: 8, color: c, pos: [-0.2 + i * 0.1, -dh * 0.06, -0.12 - (i % 2) * 0.1] }));
        specials[key] = front;
      }
    }
  }
  g.userData.collide = true;
  label(g, 'İLAÇLAR — KİLİTSİZ · KAYIT TUTUN', { pos: [0, H + 0.12, 0.262], height: 0.045, color: '#1a1a1a', bg: '#d8a21a' });

  const state = { a: false, b: false, ta: 0, tb: 0 };
  const texts = {
    a: 'Analjezikler, antiseptik, steril gazlı bez… Etiketlerin yarısı solmuş, ama miat tarihleri tutarlı.',
    b: 'Serum ampulleri ve kan şekeri çubukları. Kapakta mühür var: bu çekmece daha önce hiç açılmamış.',
  };
  for (const key of ['a', 'b']) {
    const d = specials[key];
    d.userData.dynamic = true;
    mctx.interactions.add(d, {
      id: `medical-drawer-${key}`,
      prompt: () => (state[key] ? 'Çekmeceyi kapat' : 'Çekmeceyi aç'),
      distance: 2.7,
      onInteract: () => {
        state[key] = !state[key];
        sfx(mctx, 'click', { position: d.getWorldPosition(new THREE.Vector3()) });
        if (state[key]) mctx.ui?.subtitle?.('SEN', texts[key], 5200);
      },
    });
  }
  mctx.onUpdate((dt) => {
    for (const key of ['a', 'b']) {
      const d = specials[key];
      const target = 0.25 + (state[key] ? 0.32 : 0);
      if (Math.abs(d.position.z - target) > 0.0005) d.position.z = THREE.MathUtils.damp(d.position.z, target, 8, dt);
    }
  });
  return { group: g, state, specials };
}

// ---------------------------------------------------------------------------
// Camlı dolap (şişeler, numune kapları) + alt dolap
// ---------------------------------------------------------------------------
function buildGlassCabinet(mctx, M, C, root, cx) {
  const g = place(root, [cx, 0, 3.25], PI, 'med-glass-cab');
  const W = 1.5;
  // alt dolap + tezgâh
  addBox(g, { size: [W, 0.86, 0.5], pos: [0, 0.43, 0], material: M.panelMid });
  addBox(g, { size: [W + 0.03, 0.04, 0.54], pos: [0, 0.88, 0.01], material: M.aluminium });
  for (let i = 0; i < 3; i++) {
    addBox(g, { size: [W / 3 - 0.03, 0.76, 0.016], pos: [-W / 3 + (i * W) / 3, 0.43, 0.258], material: M.panelLight });
    addBox(g, { size: [0.14, 0.014, 0.02], pos: [-W / 3 + (i * W) / 3, 0.74, 0.272], material: M.metalDark });
  }
  // üst camlı dolap
  addBox(g, { size: [W, 1.0, 0.04], pos: [0, 1.85, -0.2], material: M.panelDark });
  addBox(g, { size: [0.04, 1.0, 0.3], pos: [-W / 2 + 0.02, 1.85, -0.07], material: M.panelMid });
  addBox(g, { size: [0.04, 1.0, 0.3], pos: [W / 2 - 0.02, 1.85, -0.07], material: M.panelMid });
  addBox(g, { size: [W, 0.04, 0.3], pos: [0, 2.37, -0.07], material: M.panelMid });
  const shelfYs = [1.4, 1.72, 2.04];
  const r = rng(61);
  for (const y of shelfYs) {
    addBox(g, { size: [W - 0.08, 0.025, 0.28], pos: [0, y, -0.07], material: M.glassFrosted });
  }
  const cols = [0xcfe6f0, 0xe8c97a, 0xb5d6a0, 0xe0e0e0, 0xd8a290, 0xa8c4e0];
  for (let s = 0; s < 3; s++) {
    const y = shelfYs[s] + 0.0125;
    for (let i = 0; i < 12; i++) {
      const x = -W / 2 + 0.1 + i * ((W - 0.2) / 11);
      const h = 0.08 + r() * 0.1;
      vCyl(g, { radius: 0.025 + r() * 0.012, height: h, segments: 8, color: cols[Math.floor(r() * cols.length)], pos: [x, y + h / 2, -0.07 + (r() - 0.5) * 0.08] });
      if (r() > 0.6) vCyl(g, { radius: 0.014, height: 0.02, segments: 6, color: 0x2a2c30, pos: [x, y + h + 0.01, -0.07] });
    }
  }
  addBox(g, { size: [W - 0.08, 0.9, 0.012], pos: [0, 1.86, 0.078], material: M.glass });
  addBox(g, { size: [0.02, 0.9, 0.024], pos: [0, 1.86, 0.086], material: M.metalDark });
  label(g, 'NUMUNE & REAKTİF', { pos: [0, 2.43, 0.0], height: 0.045, color: '#1a1a1a', bg: '#e8e2cf' });
  g.userData.collide = true;
  return g;
}

// ---------------------------------------------------------------------------
// Defibrilatör (duvar tutucusu) — bataryalı: enerjisiz de çalışır
// ---------------------------------------------------------------------------
function buildDefib(mctx, M, C, timers, root, cx) {
  const g = place(root, [cx, 1.45, 3.46], PI, 'med-defib');
  addBox(g, { size: [0.5, 0.52, 0.04], pos: [0, 0.07, 0.0], material: M.plasticWhite });
  vBox(g, { size: [0.46, 0.48, 0.006], color: 0xb02a1c, pos: [0, 0.07, 0.022] });
  vBox(g, { size: [0.4, 0.3, 0.2], color: 0xe0a218, pos: [0, 0.06, 0.12] }); // gövde
  vBox(g, { size: [0.3, 0.05, 0.1], color: 0x2a2c30, pos: [0, 0.23, 0.12] }); // tutamak
  addBox(g, { size: [0.14, 0.06, 0.01], pos: [0.12, -0.04, 0.222], material: C.indAmber });
  for (let i = 0; i < 3; i++) vCyl(g, { radius: 0.016, height: 0.012, segments: 10, color: i === 1 ? 0xb02a1c : 0x15181c, pos: [-0.14 + i * 0.05, -0.08, 0.222], rot: [PI / 2, 0, 0] });
  const screen = addScreen(g, { pos: [-0.03, 0.08, 0.226], w: 0.22, h: 0.15, res: [256, 176], color: '#7dff9a', depth: 0.03 });
  // pedler
  for (const sx of [-1, 1]) {
    vBox(g, { size: [0.1, 0.12, 0.05], color: 0x2a2c30, pos: [sx * 0.3, 0.05, 0.06] });
    vBox(g, { size: [0.07, 0.07, 0.01], color: 0xb9bcc0, pos: [sx * 0.3, 0.05, 0.088] });
  }
  addTube(g, [-0.3, 0.0, 0.07], [-0.16, -0.12, 0.2], { sag: 0.1, radius: 0.007, material: M.cable });
  addTube(g, [0.3, 0.0, 0.07], [0.16, -0.12, 0.2], { sag: 0.1, radius: 0.007, material: M.cable });
  label(g, 'DEFİBRİLATÖR', { pos: [0, -0.25, 0.026], height: 0.05, color: '#f0f0f0', bg: '#b02a1c' });
  label(g, 'BATARYALI · 200 J', { pos: [0, 0.37, 0.026], height: 0.032, color: '#1a1a1a', bg: '#e8e2cf' });
  const proxy = addProxy(g, { size: [0.7, 0.7, 0.4], pos: [0, 0.07, 0.15] });
  proxy.userData.dynamic = false;
  g.userData.dynamic = false;

  const st = { phase: 'idle', t: 0, joules: 0 };
  mctx.onUpdate((dt) => {
    if (st.phase === 'idle') return;
    st.t += dt;
    if (st.phase === 'charge') {
      st.joules = Math.min(200, (st.t / 2.4) * 200);
      if (st.t >= 2.4) {
        st.phase = 'ready';
        st.t = 0;
        sfx(mctx, 'beep', { position: g.getWorldPosition(new THREE.Vector3()) });
        mctx.ui?.toast?.('Defibrilatör şarjlı — 200 J hazır.', 2800);
      }
    } else if (st.phase === 'ready' && st.t > 5) {
      st.phase = 'idle';
      st.joules = 0;
      sfx(mctx, 'click', { position: g.getWorldPosition(new THREE.Vector3()) });
      mctx.ui?.toast?.('Defibrilatör güvenli moda döndü.', 2200);
    }
  });
  mctx.interactions.add(g, {
    id: 'medical-defib',
    prompt: () => (st.phase === 'idle' ? 'Defibrilatörü şarj et' : ''),
    distance: 2.8,
    enabled: () => st.phase === 'idle',
    onInteract: () => {
      st.phase = 'charge';
      st.t = 0;
      st.joules = 0;
      sfx(mctx, 'servo', { position: g.getWorldPosition(new THREE.Vector3()), duration: 2.4 });
      mctx.ui?.subtitle?.('SEN', 'Cihaz bataryayla çalışıyor; şebeke olmasa da şarj oluyor. Umarım kimsenin buna ihtiyacı olmaz.', 4600);
    },
  });
  void timers;
  return { group: g, screen, state: st };
}

// ---------------------------------------------------------------------------
// Buzdolabı (aşı / kan)
// ---------------------------------------------------------------------------
function buildFridge(mctx, M, C, root, cx) {
  const g = place(root, [cx, 0, 3.17], PI, 'med-fridge');
  addBox(g, { size: [0.72, 1.95, 0.62], pos: [0, 0.975, 0], material: M.plasticWhite });
  addBox(g, { size: [0.68, 1.88, 0.016], pos: [0, 0.98, 0.318], material: M.glass });
  vBox(g, { size: [0.64, 1.8, 0.01], color: 0xd4dde0, pos: [0, 0.98, 0.3] });
  for (let i = 0; i < 4; i++) {
    addBox(g, { size: [0.62, 0.012, 0.5], pos: [0, 0.4 + i * 0.4, 0.04], material: M.aluminium });
    for (let j = 0; j < 4; j++) vBox(g, { size: [0.1, 0.12 + (j % 2) * 0.04, 0.08], color: [0xc0392b, 0x2a6fb0, 0xe8e2cf, 0xd8a21a][(i + j) % 4], pos: [-0.22 + j * 0.15, 0.46 + i * 0.4, 0.05] });
  }
  addBox(g, { size: [0.025, 0.7, 0.03], pos: [0.3, 1.1, 0.34], material: M.metal });
  label(g, 'AŞI · KAN ÜRÜNLERİ · 2–6 °C', { pos: [0, 1.88, 0.327], height: 0.034, color: '#1c1c1c', bg: '#e8e2cf' });
  addBox(g, { size: [0.05, 0.03, 0.01], pos: [0.27, 1.8, 0.327], material: C.indGreen });
  g.userData.collide = true;
  return g;
}

// ---------------------------------------------------------------------------
// Tezgâh: santrifüj (etkileşimli), mikroskop, lavabo, üst dolaplar, atık kovası
// ---------------------------------------------------------------------------
function buildBench(mctx, M, C, timers, root) {
  const CX = 3.75;
  const LEN = 2.4;
  const g = place(root, [CX, 0, 3.2], PI, 'med-bench');
  const lx = (xw) => -(xw - CX);
  addBox(g, { size: [LEN, 0.84, 0.6], pos: [0, 0.46, 0], material: M.panelMid });
  vBox(g, { size: [LEN, 0.06, 0.6], color: 0x1b1c1e, pos: [0, 0.03, 0] });
  addBox(g, { size: [LEN + 0.04, 0.04, 0.64], pos: [0, 0.9, 0.02], material: M.aluminium });
  for (let i = 0; i < 5; i++) {
    const x = -LEN / 2 + 0.25 + (i * (LEN - 0.5)) / 4;
    addBox(g, { size: [0.44, 0.74, 0.016], pos: [x, 0.47, 0.305], material: M.panelLight });
    addBox(g, { size: [0.12, 0.014, 0.02], pos: [x, 0.78, 0.322], material: M.metalDark });
  }
  g.userData.collide = true;
  // lavabo
  addBox(g, { size: [0.45, 0.012, 0.36], pos: [lx(4.55), 0.918, 0.05], material: M.panelDark });
  addRod(g, [lx(4.55), 0.92, -0.2], [lx(4.55), 1.14, -0.2], { radius: 0.012, material: M.metal, segments: 6 });
  addRod(g, [lx(4.55), 1.14, -0.2], [lx(4.55), 1.14, -0.04], { radius: 0.012, material: M.metal, segments: 6 });
  // sırt paneli + üst dolaplar
  addBox(g, { size: [LEN, 0.55, 0.025], pos: [0, 1.2, -0.29], material: M.panelDark });
  addBox(g, { size: [LEN, 0.7, 0.34], pos: [0, 1.95, -0.13], material: M.panelMid });
  const upl = ['STERİL ARAÇ', 'SARF', 'TEMİZLİK'];
  for (let i = 0; i < 3; i++) {
    const x = -LEN / 2 + 0.4 + i * ((LEN - 0.8) / 2);
    addBox(g, { size: [0.7, 0.64, 0.016], pos: [x, 1.95, 0.05], material: M.panelLight });
    addBox(g, { size: [0.014, 0.12, 0.02], pos: [x + 0.28, 1.65, 0.068], material: M.metalDark });
    label(g, upl[i], { pos: [x, 2.2, 0.062], height: 0.034, color: '#1c1c1c', bg: '#e8e2cf' });
  }
  // mikroskop
  const mic = place(g, [lx(3.3), 0.92, 0.05]);
  vBox(mic, { size: [0.2, 0.03, 0.26], color: 0x2a2c30, pos: [0, 0.015, 0] });
  vBox(mic, { size: [0.05, 0.3, 0.05], color: 0xd8d4c8, pos: [0, 0.17, -0.08] });
  vCyl(mic, { radius: 0.025, height: 0.22, segments: 8, color: 0x2a2c30, pos: [0, 0.3, 0.0], rot: [0.35, 0, 0] });
  vCyl(mic, { radius: 0.015, height: 0.06, segments: 8, color: 0xb9bcc0, pos: [0, 0.18, 0.06], rot: [0, 0, 0] });
  vBox(mic, { size: [0.14, 0.012, 0.12], color: 0x15181c, pos: [0, 0.1, 0.04] });
  // numune tüp rafı
  const rack = place(g, [lx(2.9), 0.92, 0.1]);
  vBox(rack, { size: [0.3, 0.02, 0.1], color: 0xb9bcc0, pos: [0, 0.07, 0] });
  for (let i = 0; i < 6; i++) vCyl(rack, { radius: 0.013, height: 0.09, segments: 6, color: [0xd8a290, 0xe8c97a, 0xcfe6f0][i % 3], pos: [-0.12 + i * 0.048, 0.12, 0] });
  // santrifüj
  const cf = place(g, [lx(3.95), 0.92, 0.02], 0, 'centrifuge');
  vBox(cf, { size: [0.5, 0.2, 0.44], color: 0xd8dde0, pos: [0, 0.1, 0] });
  addBox(cf, { size: [0.44, 0.012, 0.38], pos: [0, 0.206, 0], material: M.metalDark });
  vCyl(cf, { radius: 0.17, height: 0.014, segments: 20, color: 0x2a2c30, pos: [0, 0.213, 0.0] });
  const rotor = place(cf, [0, 0.226, 0]);
  vCyl(rotor, { radius: 0.15, height: 0.016, segments: 20, color: 0x8a9096, pos: [0, 0, 0] });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI * 2;
    vCyl(rotor, { radius: 0.014, height: 0.075, segments: 6, color: [0xd8a290, 0xe8c97a, 0xcfe6f0, 0xb5d6a0][i % 4], pos: [Math.cos(a) * 0.115, 0.04, Math.sin(a) * 0.115] });
  }
  vCyl(rotor, { radius: 0.02, height: 0.03, segments: 8, color: 0x2a2c30, pos: [0, 0.02, 0] });
  // kapak (menteşe arkada)
  const lid = place(cf, [0, 0.206, -0.19]);
  addBox(lid, { size: [0.46, 0.04, 0.38], pos: [0, 0.02, 0.19], material: M.glassFrosted });
  addBox(lid, { size: [0.46, 0.05, 0.03], pos: [0, 0.025, 0.37], material: M.plasticWhite });
  addBox(lid, { size: [0.03, 0.05, 0.38], pos: [-0.215, 0.025, 0.19], material: M.plasticWhite });
  addBox(lid, { size: [0.03, 0.05, 0.38], pos: [0.215, 0.025, 0.19], material: M.plasticWhite });
  addBox(lid, { size: [0.14, 0.03, 0.02], pos: [0, 0.035, 0.39], material: M.metalDark });
  // ön panel: ekran + düğmeler
  const screen = addScreen(cf, { pos: [-0.1, 0.1, 0.222], w: 0.17, h: 0.09, res: [192, 104], color: '#ffb347', depth: 0.02 });
  vCyl(cf, { radius: 0.025, height: 0.02, segments: 12, color: 0x15181c, pos: [0.14, 0.12, 0.226], rot: [PI / 2, 0, 0] });
  addBox(cf, { size: [0.05, 0.02, 0.008], pos: [0.14, 0.05, 0.224], material: C.indGreen });
  label(cf, 'SANTRİFÜJ SF-8', { pos: [0, 0.172, 0.222], height: 0.02, color: '#1a1a1a' });
  cf.userData.dynamic = true;
  // gizli vekil
  const proxy = addProxy(cf, { size: [0.6, 0.4, 0.55], pos: [0, 0.15, 0] });
  proxy.userData.dynamic = false;

  const st = { phase: 'idle', t: 0, omega: 0, lid: 1.9 };
  lid.rotation.x = -st.lid;
  mctx.onUpdate((dt) => {
    if (st.phase === 'idle' && st.omega === 0 && Math.abs(st.lid - 1.9) < 0.001) return;
    st.t += dt;
    if (st.phase === 'closing') {
      st.lid = Math.max(0, st.lid - dt * 2.2);
      if (st.lid <= 0) {
        st.phase = 'spin';
        st.t = 0;
        sfx(mctx, 'switch', { position: cf.getWorldPosition(new THREE.Vector3()) });
        sfx(mctx, 'servo', { position: cf.getWorldPosition(new THREE.Vector3()), duration: 3.4 });
      }
    } else if (st.phase === 'spin') {
      st.omega = Math.min(38, st.omega + dt * 14);
      if (st.t > 4.2) {
        st.phase = 'spindown';
        st.t = 0;
      }
    } else if (st.phase === 'spindown') {
      st.omega = Math.max(0, st.omega - dt * 16);
      if (st.omega <= 0) {
        st.phase = 'opening';
        st.t = 0;
      }
    } else if (st.phase === 'opening') {
      st.lid = Math.min(1.9, st.lid + dt * 2.2);
      if (st.lid >= 1.9) {
        st.phase = 'idle';
        sfx(mctx, 'beep', { position: cf.getWorldPosition(new THREE.Vector3()) });
        mctx.ui?.subtitle?.('SEN', 'Tüpler ayrışmış: üstte berrak sıvı, dipte koyu tortu. Numuneler hâlâ iyi durumda.', 4600);
      }
    }
    rotor.rotation.y += st.omega * dt;
    lid.rotation.x = -st.lid;
  });
  mctx.interactions.add(cf, {
    id: 'medical-centrifuge',
    prompt: () => (st.phase === 'idle' ? 'Santrifüjü çalıştır' : ''),
    distance: 2.8,
    enabled: () => st.phase === 'idle',
    onInteract: () => {
      if (!mctx.state.is('power_restored')) {
        sfx(mctx, 'error', { position: cf.getWorldPosition(new THREE.Vector3()) });
        mctx.ui?.toast?.('ENERJİ YOK — santrifüj çalışmıyor.', 2800);
        return;
      }
      st.phase = 'closing';
      st.t = 0;
      sfx(mctx, 'click', { position: cf.getWorldPosition(new THREE.Vector3()) });
    },
  });

  // atık kovası (biyotehlike)
  const bin = place(root, [5.22, 0, 3.1], PI / 2);
  vCyl(bin, { radius: 0.19, height: 0.5, segments: 14, color: 0xc0392b, pos: [0, 0.25, 0] });
  vCyl(bin, { radius: 0.2, height: 0.04, segments: 14, color: 0x2a2c30, pos: [0, 0.52, 0] });
  label(bin, 'BİYOLOJİK ATIK', { pos: [0, 0.28, 0.192], height: 0.05, color: '#1a1a1a', bg: '#e0b020' });
  bin.userData.collide = true;
  void timers;
  return { group: g, screen, state: st };
}

// ---------------------------------------------------------------------------
// Ekran çizimleri
// ---------------------------------------------------------------------------
function drawWallScan(scr, t, st) {
  const c = '#8ef5ff';
  scr.draw((g, w, h) => {
    const head = st.phase === 'idle' ? 'BEKLEMEDE' : st.phase === 'scan' ? 'TARANIYOR' : st.phase === 'report' ? 'TAMAMLANDI' : 'YATAK SIFIRLANIYOR';
    const hh = draw2d.header(g, w, h, 'TIBBİ TARAMA MOD-3', c, head);
    // gövde dış hattı
    const cx = w * 0.3;
    const cy = hh + (h - hh) / 2;
    g.strokeStyle = c;
    g.globalAlpha = st.phase === 'idle' ? 0.3 : 0.9;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy - 78, 16, 0, Math.PI * 2);
    g.moveTo(cx - 24, cy - 56);
    g.lineTo(cx + 24, cy - 56);
    g.lineTo(cx + 28, cy + 10);
    g.lineTo(cx + 18, cy + 10);
    g.lineTo(cx + 14, cy + 80);
    g.lineTo(cx + 4, cy + 80);
    g.lineTo(cx, cy + 14);
    g.lineTo(cx - 4, cy + 80);
    g.lineTo(cx - 14, cy + 80);
    g.lineTo(cx - 18, cy + 10);
    g.lineTo(cx - 28, cy + 10);
    g.closePath();
    g.stroke();
    g.globalAlpha = 1;
    if (st.phase === 'scan' || st.phase === 'report') {
      const p = st.phase === 'scan' ? st.progress : 1;
      const sy = cy - 90 + p * 180;
      g.fillStyle = 'rgba(142,245,255,0.18)';
      g.fillRect(cx - 50, cy - 94, 100, (sy - (cy - 94)));
      g.fillStyle = c;
      g.fillRect(cx - 54, sy, 108, 2);
    }
    // sağ sütun: değerler
    const x = w * 0.58;
    draw2d.text(g, 'HASTA', x, hh + 10, 14, c);
    draw2d.text(g, st.phase === 'idle' ? '— YOK —' : 'GÖREV PİLOTU', x, hh + 28, 18, c);
    if (st.phase === 'idle') {
      draw2d.text(g, 'Taramayı başlatmak', x, hh + 70, 14, c);
      draw2d.text(g, 'için yatağa bakın.', x, hh + 88, 14, c);
      draw2d.ecg(g, x, hh + 130, w * 0.4, 50, t, 60, c, true);
    } else {
      const done = st.phase === 'scan' ? st.progress : 1;
      draw2d.text(g, `NABIZ      ${st.phase === 'scan' ? Math.round(58 + Math.sin(t * 2) * 3) : 61}`, x, hh + 56, 14, c);
      draw2d.text(g, `SpO2       %${done > 0.35 ? 98 : '--'}`, x, hh + 76, 14, c);
      draw2d.text(g, `ISI        ${done > 0.55 ? '36.4' : '--.-'}`, x, hh + 96, 14, c);
      draw2d.text(g, `KEMİK      ${done > 0.8 ? 'SINIR' : '---'}`, x, hh + 116, 14, c);
      draw2d.bar(g, x, hh + 140, w * 0.4, 14, done, c);
      draw2d.text(g, `%${Math.round(done * 100)}`, x + w * 0.4 + 6, hh + 142, 12, c);
    }
  });
}

function drawHeadMonitor(scr, t, st) {
  const c = '#7dff9a';
  scr.draw((g, w, h) => {
    const hh = draw2d.header(g, w, h, 'YATAK MONİTÖRÜ', c);
    const live = st.phase === 'scan' || st.phase === 'report';
    draw2d.ecg(g, 6, hh + 6, w - 12, 50, t, live ? 61 : 60, c, !live);
    draw2d.text(g, live ? 'NABIZ 61' : 'NABIZ --', 8, hh + 62, 16, c);
    draw2d.text(g, live ? 'SpO2 98%' : 'SpO2 --', 8, hh + 84, 16, c);
  });
}

function drawRecords(scr, t) {
  const c = '#8ef5ff';
  scr.draw((g, w, h) => {
    const hh = draw2d.header(g, w, h, 'HASTA KAYITLARI', c, 'REVİR');
    const rows = [
      ['K2 A.YAVUZ', 'HİPER-UYKU', 'KARARLI'],
      ['K4 S.ERGİN', 'HİPER-UYKU', 'KARARLI'],
      ['K6 M.KORAY', 'HİPER-UYKU', 'KARARLI'],
      ['K1 PİLOT', 'UYANIK', 'İZLEMEDE'],
    ];
    let y = hh + 8;
    for (const [n, s, d] of rows) {
      draw2d.text(g, n, 8, y, 15, c);
      draw2d.text(g, s, 130, y, 15, c);
      draw2d.text(g, d, w - 8, y, 15, c, 'right');
      y += 24;
    }
    y += 10;
    draw2d.text(g, 'SON KONTROL: bu sabah 06:12', 8, y, 14, c);
    if (Math.floor(t * 1.2) % 2 === 0) draw2d.text(g, '_', w - 14, y, 14, c);
  });
}

function drawEcgDesk(scr, t) {
  const c = '#7dff9a';
  scr.draw((g, w, h) => {
    const hh = draw2d.header(g, w, h, 'EKG · KANAL 2', c);
    draw2d.ecg(g, 6, hh + 10, w - 12, 60, t, 62, c);
    draw2d.ecg(g, 6, hh + 80, w - 12, 60, t + 0.4, 62, c);
    draw2d.text(g, 'D1', 10, hh + 14, 12, c);
    draw2d.text(g, 'D2', 10, hh + 84, 12, c);
  });
}

function drawDefib(scr, t, powered, st) {
  const c = powered ? '#7dff9a' : '#ffb347';
  scr.material.emissiveIntensity = 1.1;
  scr.draw((g, w, h) => {
    const hh = draw2d.header(g, w, h, 'DEFİB', c, powered ? 'ŞEBEKE' : 'BATARYA');
    draw2d.ecg(g, 6, hh + 4, w - 12, 44, t, 60, c, true);
    draw2d.text(g, st.phase === 'idle' ? 'HAZIR · KAPALI' : st.phase === 'charge' ? 'ŞARJ EDİLİYOR' : 'ŞARJLI — HAZIR', 8, hh + 56, 16, c);
    draw2d.bar(g, 8, hh + 82, w - 16, 12, st.joules / 200, c);
    draw2d.text(g, `${Math.round(st.joules)} J`, w - 8, hh + 98, 14, c, 'right');
  });
}

function drawBench(scr, t, powered, st) {
  if (!powered) {
    drawNoPower(scr, 'KAPALI');
    return;
  }
  const c = '#ffb347';
  scr.material.emissiveIntensity = 1.1;
  scr.draw((g, w, h) => {
    const run = st.phase === 'spin' || st.phase === 'spindown';
    draw2d.text(g, run ? 'ÇALIŞIYOR' : st.phase === 'idle' ? 'HAZIR' : 'KAPAK', 8, 8, 18, c);
    draw2d.text(g, `${Math.round((st.omega / 38) * 4200)} dev/dk`, 8, 40, 16, c);
    draw2d.bar(g, 8, 70, w - 16, 12, st.omega / 38, c);
  });
}

// ---------------------------------------------------------------------------
// Posterler (canvas)
// ---------------------------------------------------------------------------
function drawAnatomy(g, w, h) {
  g.fillStyle = '#e9e4d2';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#2a3a46';
  g.font = 'bold 26px "DejaVu Sans", sans-serif';
  g.textAlign = 'center';
  g.fillText('İNSAN İSKELETİ', w / 2, 38);
  g.strokeStyle = '#5a5648';
  g.lineWidth = 3;
  g.fillStyle = '#d8d1b8';
  const cx = w / 2;
  g.beginPath();
  g.arc(cx, 92, 26, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.beginPath();
  g.moveTo(cx, 118);
  g.lineTo(cx, 280);
  g.stroke();
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    g.ellipse(cx, 150 + i * 14, 38 - i * 2, 10, 0, 0, Math.PI * 2);
    g.stroke();
  }
  g.beginPath();
  g.ellipse(cx, 300, 52, 22, 0, 0, Math.PI * 2);
  g.stroke();
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(cx + s * 38, 140);
    g.lineTo(cx + s * 78, 230);
    g.lineTo(cx + s * 70, 300);
    g.moveTo(cx + s * 24, 320);
    g.lineTo(cx + s * 32, 400);
    g.lineTo(cx + s * 26, 440);
    g.stroke();
  }
  g.fillStyle = '#7a3a2a';
  g.font = '15px "DejaVu Sans", sans-serif';
  g.fillText('kafatası', cx + 70, 84);
  g.fillText('omurga', cx + 70, 200);
  g.fillText('leğen', cx + 80, 306);
  g.fillText('uyluk', cx - 78, 380);
  g.textAlign = 'left';
}

function drawEyeChart(g, w, h) {
  g.fillStyle = '#f0ede2';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#16181a';
  g.textAlign = 'center';
  const rows = [
    ['E', 120],
    ['F P', 92],
    ['T O Z', 70],
    ['L P E D', 52],
    ['P E C F D', 40],
    ['E D F C Z P', 30],
    ['F E L O P Z D', 24],
  ];
  let y = 14;
  for (const [txt, size] of rows) {
    g.font = `bold ${size}px "DejaVu Sans Mono", monospace`;
    y += size * 0.95;
    g.fillText(txt, w / 2, y);
    y += 6;
  }
  g.textAlign = 'left';
}
