import * as THREE from 'three';
import { buildShell } from '../structure/shell.js';
import { addBox, addCylinder, addMesh } from '../utils.js';
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
  addCableRun,
  addLocker,
  addPlant,
  addPicture,
  addProxy,
  place,
  pictureMaterial,
  createTimers,
  openTerminal,
  sfx,
  rng,
} from './crew/kit.js';
import { drawStarChart, drawEarth } from './crew/pictures.js';
import { TELESCOPE_LINES } from './crew/texts.js';

/**
 * Gözlem Güvertesi — panoramik pencere, bankler, yıldız haritası masası, bitkiler, TELESKOP.
 *
 * Etkileşimler:
 *   observation-telescope  Teleskop: Gargantua pencere normalinden ≤ 50° içindeyse oyuncu dondurulur,
 *                          bakış kara deliğe çevrilir (FOV 15), altyazılar akar, ~8 sn sonra serbest kalır
 *                          ve state 'blackhole_observed' ayarlanır. Değilse uyarı verilir.
 *   observation-chart      Yıldız haritası masası: sistemin terminal özeti
 *
 * Yerleşim: dış duvarın tamamı panoramik pencere (x ∈ [-4.2, 4.2]); önünde teleskop (z≈-2.55) ve iki bank
 * (z≈-1.95). İç duvarda durum panosu, harita masası ve bitki jardiniyeri. Yürüme şeridi (|z| ≤ 0.9) boş.
 */
const PI = Math.PI;
const MAX_ANGLE = THREE.MathUtils.degToRad(50);
const SCOPE_POS = [0, 0, -2.55];
const OBSERVE_SECONDS = 8.2;

let vignetteEl = null;
function getVignette() {
  if (vignetteEl || typeof document === 'undefined') return vignetteEl;
  try {
    const el = document.createElement('div');
    el.id = 'azim-scope-vignette';
    el.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:5;opacity:0;transition:opacity 1.1s ease;' +
      'background:radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0.82) 58%, #000 70%);';
    document.body.appendChild(el);
    vignetteEl = el;
  } catch {
    vignetteEl = null;
  }
  return vignetteEl;
}

export default {
  id: 'observation',
  name: 'Gözlem Güvertesi',
  build(mctx) {
    const M = mctx.materials;
    const C = crewMaterials(mctx);
    const root = mctx.group;
    const timers = createTimers(mctx);

    buildShell(mctx, {
      outerWindows: [{ x: 0, w: 8.4, y: 0.45, h: 2.35 }],
      lights: 2,
      lightColor: 0xffe6c8,
      lightIntensity: 4.6,
      accent: 0x8ab4ff,
      wall: 'dark',
    });
    // jardinyer büyütme lambası + harita masası soğuk ışığı (toplam 4 ışık)
    mctx.addLight([3.0, 2.3, 2.3], { color: 0xffc6e8, intensity: 2.2, distance: 5.5, emergency: null });
    mctx.addLight([-2.6, 2.0, 1.9], { color: 0x6ab8ff, intensity: 2.2, distance: 5, emergency: null });

    // ------------------------------------------------------------------
    // Pencere çerçevesi, denizlik (alt raf), korkuluklar
    // ------------------------------------------------------------------
    for (const x of [-4.2, -2.1, 2.1, 4.2]) addBox(root, { size: [0.12, 2.4, 0.1], pos: [x, 1.65, -3.43], material: M.metalDark });
    addBox(root, { size: [8.6, 0.1, 0.1], pos: [0, 2.82, -3.43], material: M.metalDark });
    addBox(root, { size: [8.6, 0.06, 0.4], pos: [0, 0.45, -3.3], material: M.metalDark });
    // pencere önü korkuluk (yalnızca yanlarda; teleskop önü serbest)
    for (const sx of [-1, 1]) {
      addRail(root, [sx * 1.4, 1.0, -3.1], [sx * 4.1, 1.0, -3.1], { material: M.handrail, out: [0, 0, 1], depth: 0.0, standoffs: 2, radius: 0.02 });
      for (const x of [1.4, 4.1]) addRod(root, [sx * x, 0.0, -3.1], [sx * x, 1.0, -3.1], { radius: 0.02, material: M.handrail, segments: 6 });
    }
    // denizlik üstü: küçük bitkiler, dürbün, kupa
    addPlant(root, { pos: [-3.5, 0.48, -3.3], size: 0.55, seed: 4, pot: 0xc9772f, M });
    addPlant(root, { pos: [3.7, 0.48, -3.3], size: 0.5, seed: 9, pot: 0x6b5a4a, M });
    addPlant(root, { pos: [-1.2, 0.48, -3.3], size: 0.4, seed: 14, pot: 0x7a8794, M });
    const binoc = place(root, [1.5, 0.52, -3.3], 0.4);
    for (const sx of [-1, 1]) vCyl(binoc, { radius: 0.035, height: 0.16, segments: 10, color: 0x1a1c1f, pos: [sx * 0.045, 0.04, 0], rot: [PI / 2, 0, 0] });
    vBox(binoc, { size: [0.06, 0.03, 0.06], color: 0x2a2c30, pos: [0, 0.04, 0] });
    vCyl(root, { radius: 0.035, height: 0.09, segments: 10, color: 0xe9e6dc, pos: [-2.4, 0.525, -3.3] });
    label(root, 'GÖZLEM GÜVERTESİ', { pos: [-3.0, 2.95, -3.49], height: 0.1, color: '#d8d2c2' });

    // kilim
    for (const sx of [-1, 1]) {
      vBox(root, { size: [2.8, 0.012, 1.3], color: 0x2c3a52, matte: true, pos: [sx * 3.1, 0.006, -2.0] });
      vBox(root, { size: [2.6, 0.014, 1.1], color: 0x3f5473, matte: true, pos: [sx * 3.1, 0.006, -2.0] });
    }

    // ------------------------------------------------------------------
    // Banklar
    // ------------------------------------------------------------------
    for (const sx of [-1, 1]) {
      const b = place(root, [sx * 3.1, 0, -1.95], PI, `bench-${sx}`);
      addBox(b, { size: [2.6, 0.06, 0.52], pos: [0, 0.41, 0], material: M.metalDark });
      vBox(b, { size: [2.54, 0.09, 0.5], color: 0x3a4a63, matte: true, pos: [0, 0.48, 0.0] });
      const back = place(b, [0, 0.52, -0.25]);
      back.rotation.x = -0.14;
      vBox(back, { size: [2.54, 0.5, 0.09], color: 0x3a4a63, matte: true, pos: [0, 0.27, 0] });
      for (const x of [-1.2, 0, 1.2]) addBox(b, { size: [0.07, 0.38, 0.4], pos: [x, 0.19, 0.0], material: M.metal });
      for (const x of [-1.2, 1.2]) addBox(b, { size: [0.08, 0.08, 0.5], pos: [x * 1.06, 0.62, -0.02], material: M.metalDark });
      b.userData.collide = true;
    }
    // yastıklar
    vBox(root, { size: [0.4, 0.12, 0.3], color: 0xc9772f, matte: true, pos: [-3.9, 0.57, -1.95], rot: [0, 0.2, 0] });
    vBox(root, { size: [0.4, 0.12, 0.3], color: 0x8a9a6a, matte: true, pos: [2.4, 0.57, -1.95], rot: [0, -0.3, 0] });

    // ------------------------------------------------------------------
    // Teleskop
    // ------------------------------------------------------------------
    const scope = buildTelescope(mctx, M, C, timers, root);

    // ------------------------------------------------------------------
    // İç duvar: durum panosu, yıldız haritası masası, jardinyer, ayrıntılar
    // ------------------------------------------------------------------
    const board = addScreen(root, { pos: [0.1, 1.65, 3.46], rot: [0, PI, 0], w: 1.5, h: 0.84, res: [512, 288], color: '#ffb347', depth: 0.05 });
    label(root, 'GARGANTUA — GÖZLEM DURUMU', { pos: [0.1, 2.2, 3.49], rot: [0, PI, 0], height: 0.05, color: '#e8e2d0' });
    addPicture(root, { key: 'bh-diagram', draw: drawBhDiagram, pos: [-1.35, 1.65, 3.49], rot: [0, PI, 0], w: 0.42, h: 0.6, res: [256, 360], tilt: 0.02 });
    addPicture(root, { key: 'earth', draw: drawEarth, pos: [1.65, 1.8, 3.49], rot: [0, PI, 0], w: 0.26, h: 0.26, res: [192, 192], tilt: -0.03 });
    label(root, 'EVİMİZ, UZAKTA', { pos: [1.65, 1.58, 3.49], rot: [0, PI, 0], height: 0.032, color: '#d8d2c2' });

    const chart = buildChartTable(mctx, M, C, root);
    buildPlanter(mctx, M, C, root);
    // sol uç: dürbün / kamera dolabı
    const lk = addLocker(root, { pos: [-5.0, 0, 3.2], rotY: PI, w: 0.55, h: 2.0, d: 0.55, M, text: 'OPTİK', seed: 7 });
    lk.userData.collide = true;
    const lk2 = addLocker(root, { pos: [-4.4, 0, 3.2], rotY: PI, w: 0.55, h: 2.0, d: 0.55, M, text: 'YEDEK LENS', seed: 8 });
    lk2.userData.collide = true;
    label(root, 'ISIK KİRLİLİĞİ YOK — LAMBALARI KISIN', { pos: [-4.7, 2.3, 3.49], rot: [0, PI, 0], height: 0.04, color: '#1a1a1a', bg: '#d8a21a' });
    for (const sz of [-1, 1]) addRod(root, [-5.4, 3.02, sz * 3.2], [5.4, 3.02, sz * 3.2], { radius: 0.035, material: M.aluminium, segments: 8 });
    addCableRun(root, [-5.3, 3.12, 1.2], [5.3, 3.12, 1.2], { n: 3, sag: 0.07, radius: 0.012, material: M.cable, seed: 23 });

    // ------------------------------------------------------------------
    // Ekranlar + durum hesabı (yalnızca oyuncu yakınken)
    // ------------------------------------------------------------------
    screenDriver(mctx, {
      hz: 5,
      draw: (t, powered) => {
        scope.measure();
        if (!powered) {
          drawNoPower(board, 'ENERJİ YOK');
          drawNoPower(scope.screen, 'ENERJİ YOK');
        } else {
          board.material.emissiveIntensity = 1.15;
          scope.screen.material.emissiveIntensity = 1.15;
          drawBoard(board, t, scope.state, mctx.state.is('blackhole_observed'));
          drawScopeScreen(scope.screen, t, scope.state, mctx.state.is('blackhole_observed'));
        }
      },
    });
    // harita masasının ışıklı yüzeyi enerjiyle yanar
    const setChartLight = () => {
      chart.mat.emissiveIntensity = mctx.state.is('power_restored') ? 0.95 : 0.04;
    };
    setChartLight();
    mctx.state.when('power_restored', setChartLight);

    root.userData.observation = { scope, chart };
  },
};

// ---------------------------------------------------------------------------
// Teleskop
// ---------------------------------------------------------------------------
function buildTelescope(mctx, M, C, timers, root) {
  const g = place(root, SCOPE_POS, 0, 'telescope');
  // gövde: kaide, sütun, kafa
  addCylinder(g, { radius: 0.34, height: 0.07, segments: 20, pos: [0, 0.035, 0], material: M.metalDark, collide: true });
  addCylinder(g, { radius: 0.09, height: 1.1, segments: 14, pos: [0, 0.62, 0], material: M.aluminium });
  addCylinder(g, { radius: 0.13, height: 0.1, segments: 16, pos: [0, 1.22, 0], material: M.metalDark });
  addBox(g, { size: [0.3, 0.16, 0.22], pos: [0, 1.34, 0], material: M.plasticWhite });
  for (const sx of [-1, 1]) addBox(g, { size: [0.05, 0.3, 0.2], pos: [sx * 0.19, 1.5, 0], material: M.metalDark });
  vBox(g, { size: [0.1, 0.06, 0.04], color: 0x2a2c30, pos: [0, 1.28, 0.12] });
  // ayak izleri: kauçuk kaydırmaz
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * PI * 2 + 0.5;
    vCyl(g, { radius: 0.05, height: 0.03, segments: 10, color: 0x16181a, pos: [Math.cos(a) * 0.28, 0.01, Math.sin(a) * 0.28] });
  }
  // tüp (dinamik alt grup): -Z'ye bakar, hafif yukarı
  const tube = new THREE.Group();
  tube.position.set(0, 1.55, 0);
  tube.rotation.order = 'YXZ';
  g.add(tube);
  const axis = (len, r, mat, z, name) => {
    const m = addCylinder(tube, { radius: r, height: len, segments: 18, material: mat, pos: [0, 0, z], rot: [PI / 2, 0, 0] });
    m.name = name || '';
    return m;
  };
  axis(1.05, 0.085, M.plasticWhite, -0.38, 'tube-body');
  axis(0.26, 0.098, M.plasticWhite, -1.0, 'tube-dew');
  axis(0.03, 0.082, M.plasticDark, -1.14, 'tube-cap');
  addCylinder(tube, { radius: 0.088, height: 0.04, segments: 18, pos: [0, 0, -0.9], rot: [PI / 2, 0, 0], material: M.metalDark });
  // arka: ayna kutusu + yıldız çaprazı + göz merceği
  addBox(tube, { size: [0.14, 0.14, 0.14], pos: [0, 0, 0.2], material: M.plasticDark });
  addCylinder(tube, { radius: 0.025, height: 0.16, segments: 10, pos: [0, -0.1, 0.22], material: M.metal });
  addCylinder(tube, { radius: 0.033, height: 0.04, segments: 10, pos: [0, -0.19, 0.22], material: M.rubber });
  addCylinder(tube, { radius: 0.018, height: 0.16, segments: 10, pos: [0, 0, 0.32], rot: [PI / 2, 0, 0], material: M.metal });
  addCylinder(tube, { radius: 0.03, height: 0.04, segments: 10, pos: [0, 0, 0.42], rot: [PI / 2, 0, 0], material: M.rubber });
  // bulucu dürbün + odak düğmesi
  addCylinder(tube, { radius: 0.028, height: 0.36, segments: 10, pos: [0, 0.14, -0.3], rot: [PI / 2, 0, 0], material: M.plasticDark });
  for (const z of [-0.15, -0.45]) addBox(tube, { size: [0.02, 0.05, 0.03], pos: [0, 0.1, z], material: M.metalDark });
  addCylinder(tube, { radius: 0.03, height: 0.04, segments: 12, pos: [0.1, 0, 0.0], rot: [0, 0, PI / 2], material: M.rubber });
  // eksen muylusu (yoke içinde)
  for (const sx of [-1, 1]) addCylinder(tube, { radius: 0.03, height: 0.06, segments: 10, pos: [sx * 0.15, 0, -0.1], rot: [0, 0, PI / 2], material: M.metal });
  tube.rotation.set(0.14, 0, 0);

  // kontrol sütunu + ekran
  const cb = place(root, [0.62, 0, -2.4], -0.35);
  addBox(cb, { size: [0.3, 0.9, 0.2], pos: [0, 0.45, 0], material: C.console, collide: true });
  vBox(cb, { size: [0.32, 0.03, 0.22], color: 0x1d1f22, pos: [0, 0.9, 0] });
  const screen = addScreen(cb, { pos: [0, 0.96, 0.02], w: 0.34, h: 0.24, res: [320, 224], color: '#ffb347', depth: 0.04, rot: [-0.5, 0, 0] });
  addBox(cb, { size: [0.06, 0.02, 0.01], pos: [-0.08, 0.7, 0.104], material: C.indGreen });
  addBox(cb, { size: [0.06, 0.02, 0.01], pos: [0.08, 0.7, 0.104], material: C.indAmber });
  label(cb, 'TELESKOP', { pos: [0, 0.82, 0.104], height: 0.035, color: '#e8e2d0' });

  const proxy = addProxy(g, { size: [0.9, 1.9, 1.7], pos: [0, 1.0, -0.2] });
  proxy.userData.dynamic = false;

  const state = { observing: false, t: 0, angle: 0, visible: false, hasDir: false };
  const dirW = new THREE.Vector3();
  const outW = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const quat = new THREE.Quaternion();

  /** Pencere dış normali ile kara delik yönü arasındaki açıyı ölçer. */
  const measure = () => {
    try {
      mctx.space.getBlackHoleDirection(dirW);
      mctx.group.updateMatrixWorld(true);
      const a = mctx.toWorld(0, 0, -1);
      const b = mctx.toWorld(0, 0, 0);
      outW.copy(a).sub(b).normalize();
      state.angle = dirW.angleTo(outW);
      state.visible = state.angle <= MAX_ANGLE;
      state.hasDir = true;
    } catch {
      state.hasDir = false;
      state.visible = false;
    }
    return state;
  };

  // tüpü hedefe yumuşakça çevir
  const aim = { yaw: 0, pitch: 0.14, tYaw: 0, tPitch: 0.14 };
  mctx.onUpdate((dt) => {
    if (!state.observing && Math.abs(aim.yaw - aim.tYaw) < 0.001 && Math.abs(aim.pitch - aim.tPitch) < 0.001) return;
    aim.yaw = THREE.MathUtils.damp(aim.yaw, aim.tYaw, 2.2, dt);
    aim.pitch = THREE.MathUtils.damp(aim.pitch, aim.tPitch, 2.2, dt);
    tube.rotation.set(aim.pitch, aim.yaw, 0);
  });

  const player = mctx.player;
  const finish = () => {
    player.fovOverride = null;
    player.frozen = false;
    state.observing = false;
    aim.tYaw = 0;
    aim.tPitch = 0.14;
    const v = getVignette();
    if (v) v.style.opacity = '0';
    mctx.state.set('blackhole_observed', true);
    sfx(mctx, 'success');
  };

  mctx.interactions.add(g, {
    id: 'observation-telescope',
    prompt: () => (state.observing ? '' : 'Teleskoptan Gargantua\'ya bak'),
    distance: 3.2,
    enabled: () => !state.observing,
    onInteract: () => {
      measure();
      if (!state.visible) {
        sfx(mctx, 'error');
        mctx.ui?.toast?.('Gargantua şu an görüş alanında değil — halkanın dönmesini bekle.', 4200);
        return;
      }
      // gözlem başlar
      state.observing = true;
      state.t = 0;
      player.frozen = true;
      const dir = mctx.space.getBlackHoleDirection(new THREE.Vector3());
      player.faceDirection(dir, 1.5);
      player.fovOverride = 15;
      // tüpü modül yerel uzayında hedefe çevir
      mctx.group.getWorldQuaternion(quat);
      quat.invert();
      tmp.copy(dir).applyQuaternion(quat);
      aim.tYaw = Math.atan2(-tmp.x, -tmp.z);
      aim.tPitch = Math.asin(THREE.MathUtils.clamp(tmp.y, -1, 1));
      const v = getVignette();
      if (v) v.style.opacity = '0.9';
      sfx(mctx, 'servo');
      TELESCOPE_LINES.forEach(([spk, line], i) => {
        timers.after(1.4 + i * 1.65, () => mctx.ui?.subtitle?.(spk, line, 3400));
      });
      timers.after(OBSERVE_SECONDS, finish);
    },
  });
  void timers;
  return { group: g, tube, screen, state, measure, finish };
}

// ---------------------------------------------------------------------------
// Yıldız haritası masası
// ---------------------------------------------------------------------------
function buildChartTable(mctx, M, C, root) {
  const g = place(root, [-2.6, 0, 2.3], PI, 'chart-table');
  addBox(g, { size: [1.4, 0.82, 0.72], pos: [0, 0.41, -0.1], material: M.panelMid });
  vBox(g, { size: [1.42, 0.05, 0.74], color: 0x1b1c1e, pos: [0, 0.025, -0.1] });
  for (let i = 0; i < 3; i++) {
    addBox(g, { size: [0.4, 0.22, 0.016], pos: [-0.46 + i * 0.46, 0.55 - (i % 2) * 0.0, 0.265], material: M.panelLight });
    addBox(g, { size: [0.12, 0.014, 0.02], pos: [-0.46 + i * 0.46, 0.62, 0.28], material: M.metalDark });
  }
  for (let i = 0; i < 3; i++) addBox(g, { size: [0.4, 0.22, 0.016], pos: [-0.46 + i * 0.46, 0.25, 0.265], material: M.panelLight });
  // eğik çizim tahtası
  const board = place(g, [0, 0.9, -0.05]);
  board.rotation.x = 0.22;
  addBox(board, { size: [1.5, 0.045, 1.0], pos: [0, 0, 0], material: M.panelDark });
  addBox(board, { size: [1.5, 0.03, 0.04], pos: [0, 0.03, 0.48], material: M.aluminium }); // ön çıta
  const mat = pictureMaterial('starchart', drawStarChart, 512, 512, { emissive: 0.95 });
  const plane = addMesh(board, new THREE.PlaneGeometry(0.92, 0.92), mat, { pos: [-0.2, 0.0235, 0], rot: [-PI / 2, 0, 0] });
  plane.userData.noShadow = true;
  // pergel, cetvel, kalem
  vBox(board, { size: [0.5, 0.008, 0.04], color: 0xd8c27a, matte: true, pos: [0.52, 0.026, -0.2], rot: [0, 0.4, 0] });
  vBox(board, { size: [0.14, 0.01, 0.014], color: 0xb02a1c, pos: [0.5, 0.028, 0.1], rot: [0, -0.5, 0] });
  vCyl(board, { radius: 0.01, height: 0.16, segments: 6, color: 0xd8a21a, pos: [0.55, 0.03, 0.25], rot: [0, 0, PI / 2] });
  vBox(board, { size: [0.2, 0.004, 0.14], color: 0xe8e2cf, matte: true, pos: [0.55, 0.026, 0.0], rot: [0, 0.2, 0] });
  // gooseneck lamba
  addRod(g, [0.62, 1.0, -0.4], [0.62, 1.38, -0.4], { radius: 0.01, material: M.metalDark, segments: 6 });
  addRod(g, [0.62, 1.38, -0.4], [0.5, 1.42, -0.22], { radius: 0.01, material: M.metalDark, segments: 6 });
  vCyl(g, { radiusTop: 0.015, radiusBottom: 0.05, height: 0.07, segments: 10, color: 0x2a2c30, pos: [0.5, 1.4, -0.22], rot: [0.2, 0, 0] });
  addBox(g, { size: [0.05, 0.01, 0.05], pos: [0.5, 1.363, -0.215], material: C.indWhite });
  label(g, 'YILDIZ HARİTASI · GARGANTUA SİSTEMİ', { pos: [0, 0.8, 0.28], height: 0.035, color: '#1c1c1c', bg: '#e8e2cf' });
  g.userData.collide = true;
  // etkileşim: harita
  board.userData.dynamic = true;
  mctx.interactions.add(board, {
    id: 'observation-chart',
    prompt: 'Yıldız haritasını incele',
    distance: 2.9,
    onInteract: () => {
      sfx(mctx, 'terminal');
      const t = openTerminal(mctx, {
        title: 'YILDIZ HARİTASI — GARGANTUA SİSTEMİ',
        color: 'blue',
        lines: [
          'GARGANTUA — dev kara delik, ince yığılma diski',
          '────────────────────────────────────────────',
          'MILLER   Sığ okyanus gezegeni. Dev gelgitler, kara',
          '         deliğe çok yakın: zaman burada neredeyse durur.',
          'MANN     Donmuş bulutlar ve buz kabuğu. Sert, soğuk, ıssız.',
          'EDMUNDS  Kayalık, ılıman. Yörünge kara delikten uzakta.',
          '',
          'AZİM     Park yörüngesi. Halka yapay yerçekimi için',
          '         döndürülmeyi bekliyor.',
          '',
          'Not: Teleskop, kara delik pencere yönüne yakın',
          'olduğunda çalışır. Halka döndükçe yön değişir.',
        ],
        options: [{ label: 'Kapat', action: () => {} }],
      });
      void t;
    },
  });
  return { group: g, board, mat };
}

// ---------------------------------------------------------------------------
// Bitki jardinyeri (iç duvar)
// ---------------------------------------------------------------------------
function buildPlanter(mctx, M, C, root) {
  const g = place(root, [3.1, 0, 3.2], PI, 'planter');
  addBox(g, { size: [3.6, 0.5, 0.55], pos: [0, 0.25, 0], material: M.panelMid });
  addBox(g, { size: [3.5, 0.03, 0.45], pos: [0, 0.505, 0], material: C.soil });
  addBox(g, { size: [3.62, 0.04, 0.58], pos: [0, 0.52, 0], material: M.aluminium });
  const r = rng(19);
  const sizes = [1.5, 1.0, 1.9, 1.2, 1.6, 1.1];
  for (let i = 0; i < 6; i++) {
    const p = addPlant(g, { pos: [-1.5 + i * 0.6, 0.52, (r() - 0.5) * 0.1], size: sizes[i], seed: 40 + i, pot: 0x6b5a4a, M });
    p.scale.setScalar(0.92 + r() * 0.2);
  }
  // büyütme lambası şeridi (pembemsi-mor, güç moduna bağlı)
  addBox(g, { size: [3.5, 0.04, 0.1], pos: [0, 2.35, -0.05], material: M.panelDark });
  addBox(g, { size: [3.4, 0.015, 0.07], pos: [0, 2.325, -0.05], material: M.lightPanel });
  for (const x of [-1.6, 1.6]) addRod(g, [x, 2.35, -0.2], [x, 3.1, -0.2], { radius: 0.015, material: M.metalDark, segments: 6 });
  label(g, 'HİDROPONİK ÖRNEKLER · SULAMAYI UNUTMAYIN', { pos: [0, 0.2, 0.28], height: 0.04, color: '#1a1a1a', bg: '#e8e2cf' });
  g.userData.collide = true;
  // tavandan asılı saksılar
  for (const x of [1.6, 4.1]) {
    const hp = place(root, [x, 2.4, 1.6]);
    vCyl(hp, { radiusTop: 0.13, radiusBottom: 0.09, height: 0.16, segments: 12, color: 0x7a5a3a, matte: true, pos: [0, 0, 0] });
    for (let i = 0; i < 3; i++) addRod(hp, [Math.cos(i * 2.1) * 0.1, 0.06, Math.sin(i * 2.1) * 0.1], [0, 0.75, 0], { radius: 0.003, material: M.cable, segments: 4 });
    addPlant(hp, { pos: [0, 0.07, 0], size: 0.55, seed: 90 + x, pot: 0x7a5a3a, M });
  }
  return g;
}

// ---------------------------------------------------------------------------
// Ekran çizimleri
// ---------------------------------------------------------------------------
function drawBoard(scr, t, st, observed) {
  const c = '#ffb347';
  scr.draw((g, w, h) => {
    const hh = draw2d.header(g, w, h, 'GARGANTUA', c, observed ? 'GÖZLENDİ' : 'GÖZLEM BEKLİYOR');
    const cx = w * 0.28;
    const cy = hh + (h - hh) / 2;
    // pencere görüş konisi
    g.fillStyle = 'rgba(255,179,71,0.14)';
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, 100, -Math.PI / 2 - 0.87, -Math.PI / 2 + 0.87);
    g.closePath();
    g.fill();
    g.strokeStyle = c;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, 100, 0, Math.PI * 2);
    g.stroke();
    // kara delik yönü: pencere normali yukarı
    const a = st.hasDir ? signedAngle(st) : 0;
    const bx = cx + Math.sin(a) * 100;
    const by = cy - Math.cos(a) * 100;
    g.fillStyle = '#000';
    g.beginPath();
    g.arc(bx, by, 10, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = c;
    g.beginPath();
    g.arc(bx, by, 10, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.ellipse(bx, by, 17, 5, a, 0, Math.PI * 2);
    g.stroke();
    // AZİM merkezi
    g.fillStyle = c;
    g.fillRect(cx - 4, cy - 4, 8, 8);
    draw2d.text(g, 'PENCERE', cx, cy - 118, 12, c, 'center');
    // sağ sütun
    const x = w * 0.58;
    draw2d.text(g, 'AÇI (pencere normali)', x, hh + 10, 14, c);
    draw2d.text(g, `${((st.angle * 180) / Math.PI).toFixed(0)}°`, x, hh + 30, 34, c);
    draw2d.text(g, st.visible ? 'GÖRÜŞ ALANINDA' : 'GÖRÜŞ DIŞI', x, hh + 84, 18, c);
    draw2d.text(g, 'sınır: 50°', x, hh + 108, 14, c);
    draw2d.text(g, st.visible ? '→ teleskopa bakın' : '→ halkanın dönmesini bekleyin', x, hh + 134, 13, c);
    if (Math.floor(t * 1.5) % 2 === 0 && st.visible) draw2d.text(g, '●', w - 20, hh + 10, 16, c);
  });
}

/** Kara delik yönünün pencere normaline göre işaretli yatay açısı (radyan; ekran çizimi için). */
function signedAngle(st) {
  return st.sign * st.angle || st.angle;
}

function drawScopeScreen(scr, t, st, observed) {
  const c = '#ffb347';
  scr.draw((g, w, h) => {
    const hh = draw2d.header(g, w, h, 'TELESKOP', c, st.observing ? 'GÖZLEM' : 'HAZIR');
    draw2d.text(g, 'HEDEF  GARGANTUA', 10, hh + 8, 16, c);
    draw2d.text(g, `AÇI    ${((st.angle * 180) / Math.PI).toFixed(0)}°`, 10, hh + 30, 16, c);
    draw2d.text(g, st.visible ? 'DURUM  UYGUN' : 'DURUM  GÖRÜŞ DIŞI', 10, hh + 52, 16, c);
    draw2d.bar(g, 10, hh + 80, w - 20, 12, st.observing ? Math.min(1, st.t / OBSERVE_SECONDS) : observed ? 1 : 0, c);
    draw2d.text(g, observed ? 'KAYIT: ALINDI' : 'KAYIT: YOK', 10, hh + 102, 14, c);
  });
}

function drawBhDiagram(g, w, h) {
  g.fillStyle = '#0b1220';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#8ab4ff';
  g.fillStyle = '#e8e2cf';
  g.font = 'bold 18px "DejaVu Sans", sans-serif';
  g.textAlign = 'center';
  g.fillText('GARGANTUA', w / 2, 28);
  g.font = '12px "DejaVu Sans", sans-serif';
  g.fillText('olay ufku · foton halkası · yığılma diski', w / 2, 46);
  const cx = w / 2;
  const cy = h * 0.5;
  // disk
  g.strokeStyle = '#ffb347';
  g.lineWidth = 3;
  g.beginPath();
  g.ellipse(cx, cy, 100, 22, 0, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 1.5;
  g.beginPath();
  g.ellipse(cx, cy, 70, 14, 0, 0, Math.PI * 2);
  g.stroke();
  // mercekleme yayı
  g.strokeStyle = '#ffd89a';
  g.beginPath();
  g.arc(cx, cy, 46, Math.PI * 1.1, Math.PI * 1.9);
  g.stroke();
  g.beginPath();
  g.arc(cx, cy, 46, Math.PI * 0.1, Math.PI * 0.9);
  g.stroke();
  g.fillStyle = '#000';
  g.beginPath();
  g.arc(cx, cy, 34, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#8ab4ff';
  g.lineWidth = 1;
  g.stroke();
  g.fillStyle = '#e8e2cf';
  g.font = '12px "DejaVu Sans", sans-serif';
  g.fillText('ışık bükülür', cx, cy + 62);
  g.fillText('zaman yavaşlar', cx, cy + 80);
  g.fillText('Burada 1 saat ≈ Dünya\'da yıllar', cx, h - 30);
  g.textAlign = 'left';
}
