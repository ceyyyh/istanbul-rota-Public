import * as THREE from 'three';
import { addBox, addMesh, addCylinder, markDynamic, mergeStatic } from '../world/utils.js';
import { addWorldBox, addRod } from '../world/structure/kit.js';

/**
 * Önceki görevin parçalanmış iniş aracı (Lander). Tüm koordinatlar GEZEGEN YERELİNDE (root altı).
 * Merkez ≈ (60, -40). Dönüş: { group, beacon, debris, ela, points, colliders(list), update(dt,t), releaseDebris() }
 */
export const WRECK = {
  center: { x: 60, z: -40 },
  beacon: { x: 62, z: -38 },
  ela: { x: 56.4, z: -38.3, yaw: Math.PI / 2 }, // yaw: -X'e (Ranger'a / oyuncuya) bakar
};

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Yırtık kenarlı dikey levha geometrisi (UV metre/4). */
function jaggedSheet(w, h, r) {
  const sh = new THREE.Shape();
  sh.moveTo(0, 0);
  sh.lineTo(w, 0);
  sh.lineTo(w, h * (0.5 + r() * 0.15));
  sh.lineTo(w * (0.8 + r() * 0.05), h * (0.68 + r() * 0.1));
  sh.lineTo(w * (0.62 + r() * 0.08), h * (0.9 + r() * 0.1));
  sh.lineTo(w * (0.38 + r() * 0.08), h);
  sh.lineTo(w * (0.2 + r() * 0.05), h * (0.78 + r() * 0.1));
  sh.lineTo(0, h * (0.86 + r() * 0.08));
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.09, bevelEnabled: false });
  g.translate(-w / 2, 0, -0.045);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.25, uv.getY(i) * 0.25);
  return g;
}

export function buildWreck(ctx, M) {
  const r = rng(7);
  const group = new THREE.Group();
  group.name = 'planet-wreck';
  const colliders = []; // { cx, cz, hx, hz, angle } | { x, z, r }
  const mats = [M.hullWhite, M.hullDark, M.heatShield, M.hullGold, M.metalDark];
  const scatterMats = [M.hullWhite, M.hullDark, M.heatShield, M.hullWhite, M.metalDark, M.hullDark, M.hullWhite, M.hullGold];

  // --- Ana gövde parçası (Ela'nın yanında) ---
  const F = { x: 61.5, z: -41.5, yaw: 0.5 };
  const fus = new THREE.Group();
  fus.position.set(F.x, 1.15, F.z);
  fus.rotation.set(0, F.yaw, 0.12);
  group.add(fus);
  addWorldBox(fus, { size: [8, 2.8, 4.4], pos: [0, 0, 0], material: M.hullWhite, mpr: 3 });
  addWorldBox(fus, { size: [8.05, 0.3, 4.45], pos: [0, -1.25, 0], material: M.heatShield, mpr: 3 });
  addBox(fus, { size: [0.25, 2.3, 3.8], pos: [-4.05, 0, 0], material: M.hullDark }); // yırtılmış uç
  addBox(fus, { size: [3.2, 0.12, 0.35], pos: [1.0, 1.43, 1.2], material: M.accentOrange });
  addWorldBox(fus, { size: [2.6, 0.2, 2.2], pos: [2.0, 1.5, -0.6], rot: [0.1, 0.2, 0], material: M.hullGold, mpr: 1 });
  for (let i = 0; i < 6; i++) {
    const z = -1.7 + i * 0.68;
    const len = 1.2 + r() * 1.5;
    addRod(fus, [-4.0, -1.0 + r() * 2, z], [-4.0 - len, -0.2 + r() * 2.2 + (r() - 0.5), z + (r() - 0.5) * 0.9], 0.05, M.aluminium, {
      segments: 5,
    });
  }
  // gövde kabuğundan sarkan paneller
  addWorldBox(fus, { size: [2.4, 1.6, 0.1], pos: [-1.5, 0.3, 2.35], rot: [0.0, 0.0, 0.0], material: M.hullDark, mpr: 2 });
  colliders.push({ cx: F.x, cz: F.z, hx: 4.2, hz: 2.3, angle: F.yaw });

  // --- Kanat: yarı batmış ---
  const wing = new THREE.Group();
  wing.position.set(68, 0.7, -34.5);
  wing.rotation.set(0.1, -0.5, 0.32);
  group.add(wing);
  addWorldBox(wing, { size: [7, 0.22, 3.2], pos: [0, 0, 0], material: M.hullWhite, mpr: 3 });
  addBox(wing, { size: [6.9, 0.05, 0.4], pos: [0, 0.13, 1.0], material: M.accentOrange });
  addBox(wing, { size: [0.3, 0.9, 3.0], pos: [3.4, 0.0, 0], material: M.hullDark });
  colliders.push({ cx: 68, cz: -34.5, hx: 3.3, hz: 1.5, angle: 0.5 });

  // --- Motor nozulu, yakıt tankı, ayak payandaları ---
  const noz = new THREE.CylinderGeometry(1.0, 0.65, 2.2, 14, 1, true);
  noz.rotateZ(Math.PI / 2);
  const nozMat = M.thruster.clone();
  nozMat.side = THREE.DoubleSide;
  addMesh(group, noz, nozMat, { pos: [51.5, 0.75, -47], rot: [0.2, 0.9, 0.15] });
  addCylinder(group, { radius: 1.1, height: 0.25, segments: 14, pos: [52.4, 0.8, -47.5], rot: [0.2, 0, Math.PI / 2 + 0.15], material: M.metalDark });
  colliders.push({ x: 51.8, z: -47, r: 1.3 });
  const tank = new THREE.CapsuleGeometry(0.6, 2.4, 3, 10);
  tank.rotateZ(Math.PI / 2);
  addMesh(group, tank, M.aluminium, { pos: [67.5, 0.55, -46.5], rot: [0, 0.7, 0.1] });
  colliders.push({ x: 67.5, z: -46.5, r: 1.4 });
  addRod(group, [57.5, 0.2, -47.2], [59.8, 3.4, -44.6], 0.07, M.metalDark, { segments: 6 });
  addRod(group, [59.8, 3.4, -44.6], [60.6, 4.2, -44.0], 0.05, M.metalDark, { segments: 6 });
  addRod(group, [71.5, 0.3, -41.0], [70.0, 2.7, -42.3], 0.07, M.metalDark, { segments: 6 });
  colliders.push({ x: 59.8, z: -44.6, r: 0.5 });

  // --- Sudan çıkan dikey levhalar ---
  const sheetSpots = [
    [47, -28, 3.6], [49.5, -30.5, 4.5], [66.5, -29.5, 3.0], [73, -43, 4.2], [57, -31.5, 2.4], [44, -46, 3.3], [64.5, -50.5, 2.8],
    [36, -22, 2.4], [28, -20, 2.0],
  ];
  sheetSpots.forEach(([x, z, h], i) => {
    const w = 1.6 + r() * 2.2;
    addMesh(group, jaggedSheet(w, h, r), mats[i % 4 === 1 ? 4 : i % 3 === 0 ? 1 : 0], {
      pos: [x, 0.0, z],
      rot: [(r() - 0.5) * 0.35, r() * Math.PI * 2, (r() - 0.5) * 0.45],
    });
    if (h > 2.2) colliders.push({ x, z, r: Math.min(1.0, w * 0.3) });
  });

  // --- Dağınık yassı parçalar (yarı batmış) ---
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2;
    const rad = 2.5 + Math.pow(r(), 0.8) * 26;
    const x = WRECK.center.x + Math.cos(a) * rad;
    const z = WRECK.center.z + Math.sin(a) * rad * 0.8;
    const dEla = Math.hypot(x - WRECK.ela.x, z - WRECK.ela.z);
    if (dEla < 2.6) continue;
    addBox(group, {
      size: [1 + r() * 3, 0.05 + r() * 0.08, 0.8 + r() * 2.2],
      pos: [x, 0.12 + r() * 0.35, z],
      rot: [(r() - 0.5) * 0.5, r() * Math.PI * 2, (r() - 0.5) * 0.5],
      material: scatterMats[Math.floor(r() * scatterMats.length)],
    });
  }
  // Ranger'dan enkaza düşen iz: yol boyunca küçük parçalar
  for (const [x, z] of [[18, -9], [24, -14], [31, -17], [40, -24], [46, -35], [41, -31]]) {
    addBox(group, { size: [0.8 + r() * 1.2, 0.06, 0.6 + r()], pos: [x, 0.25, z], rot: [(r() - 0.5) * 0.4, r() * 3, (r() - 0.5) * 0.4], material: scatterMats[Math.floor(r() * 7)] });
  }

  // --- Veri kaydedici (işaret fişeği) ---
  const B = WRECK.beacon;
  const beacon = new THREE.Group();
  beacon.name = 'beacon';
  beacon.position.set(B.x, 0, B.z);
  group.add(beacon);
  addBox(beacon, { size: [2.4, 0.14, 1.7], pos: [0, 0.38, 0], rot: [0.06, 0.4, 0.1], material: M.hullDark });
  addCylinder(beacon, { radius: 0.22, height: 0.75, segments: 14, pos: [0, 0.85, 0], material: M.accentOrange });
  addCylinder(beacon, { radius: 0.25, height: 0.08, segments: 14, pos: [0, 0.5, 0], material: M.metalDark });
  addCylinder(beacon, { radius: 0.25, height: 0.08, segments: 14, pos: [0, 1.22, 0], material: M.metalDark });
  addBox(beacon, { size: [0.2, 0.14, 0.02], pos: [0, 0.85, 0.225], material: M.screenGreen });
  addRod(beacon, [0.1, 1.25, 0], [0.18, 2.2, 0.05], 0.014, M.aluminium, { segments: 4 });
  const blinkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.15, 0.08) });
  const blink = addMesh(beacon, new THREE.SphereGeometry(0.06, 8, 6), blinkMat, { pos: [0.18, 2.22, 0.05] });
  markDynamic(blink);
  // yanan fişek: parlama sprite'ları
  const glowTex = makeGlowTexture();
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xff3a1a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const glow = new THREE.Sprite(glowMat);
  glow.position.copy(blink.position);
  glow.scale.setScalar(1.4);
  beacon.add(glow);
  const flareMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xffa860, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const flare = new THREE.Sprite(flareMat);
  flare.position.set(-0.6, 0.62, 0.3);
  flare.scale.setScalar(0.7);
  beacon.add(flare);
  const flareCore = addMesh(beacon, new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.2, 0.8) }), {
    pos: [-0.6, 0.66, 0.3],
    rot: [0, 0, 0.3],
  });
  markDynamic(flareCore);
  colliders.push({ x: B.x, z: B.z, r: 0.35, beacon: true });

  // --- Ela'yı sıkıştıran büyük levha + kiriş (objects.debris) ---
  const E = WRECK.ela;
  const debris = new THREE.Group();
  debris.name = 'debris';
  debris.position.set(E.x + 1.9, 0.9, E.z - 0.3);
  debris.rotation.set(0.05, 0.12, -0.3);
  group.add(debris);
  addWorldBox(debris, { size: [3.8, 0.2, 2.4], pos: [0, 0, 0], material: M.hullWhite, mpr: 3 });
  addBox(debris, { size: [0.15, 0.5, 2.4], pos: [-1.9, 0.1, 0], material: M.hullDark });
  addBox(debris, { size: [4.6, 0.32, 0.32], pos: [0.3, 0.26, 0.6], rot: [0, 0.08, 0], material: M.metalDark });
  addBox(debris, { size: [2.0, 0.1, 0.9], pos: [0.8, 0.16, -0.6], material: M.accentOrange });
  markDynamic(debris);
  debris.userData.restPos = debris.position.clone();
  debris.userData.restRot = debris.rotation.clone();

  // statik parçaları malzemeye göre birleştir (çizim çağrısı ↓); dinamikler (debris, beacon göstergeleri) muaf
  markDynamic(beacon); // etkileşim nesnesi: birleştirme dışı
  mergeStatic(group);
  mergeStatic(beacon); // beacon/debris kendi gruplarında birleşir (grup etkileşim nesnesi olarak kalır)
  mergeStatic(debris);

  // --- güncelleme ---
  let released = 0; // 0 → 1 (kaldırma animasyonu)
  let releasing = false;
  const update = (dt, t) => {
    const pulse = (t % 1.4) < 0.18 ? 1 : 0.0;
    blinkMat.color.setRGB(1.0 * (0.25 + pulse * 2.4), 0.15 * (0.25 + pulse * 2), 0.08);
    glowMat.opacity = 0.15 + pulse * 0.85;
    const fl = 0.75 + 0.25 * Math.sin(t * 23) * Math.sin(t * 9.7) + (hashT(t * 18) - 0.5) * 0.3;
    flareMat.opacity = Math.max(0.35, fl);
    flare.scale.setScalar(0.6 + fl * 0.35);
    if (releasing && released < 1) {
      released = Math.min(1, released + dt / 2.2);
      const e = released * released * (3 - 2 * released);
      debris.position.set(
        debris.userData.restPos.x + 1.2 * e,
        debris.userData.restPos.y + 1.4 * Math.sin(Math.PI * Math.min(1, e * 1.1)) + 0.0 * e - 0.2 * e,
        debris.userData.restPos.z - 1.6 * e,
      );
      debris.rotation.set(debris.userData.restRot.x, debris.userData.restRot.y + 0.5 * e, debris.userData.restRot.z - 0.2 * e);
    }
  };

  return {
    group,
    beacon,
    debris,
    colliders,
    update,
    releaseDebris() {
      releasing = true;
    },
    resetDebris() {
      releasing = false;
      released = 0;
      debris.position.copy(debris.userData.restPos);
      debris.rotation.copy(debris.userData.restRot);
    },
  };
}

function hashT(x) {
  const s = Math.sin(Math.floor(x) * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
