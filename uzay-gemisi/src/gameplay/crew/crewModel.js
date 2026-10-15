import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Mürettebatın prosedürel 3B insan modeli (~1.76 m, ≤ 6k üçgen).
 *
 * Yerel eksenler: +Z = ön (yüz), +Y = yukarı, +X = karakterin SOLU.
 * Eklem hiyerarşisi (hepsi THREE.Group; animasyon rotation ile yapılır):
 *
 *   root (ölçek = boy / 1.76)
 *    └ hips (y = HIP_Y)                    — leğen; yürürken sallanır
 *       ├ spine (y = +0.10)                — gövde eğilmesi / dönmesi
 *       │   ├ neck → head (kafa: yüz, saç, sakal, gözlük)
 *       │   └ shoulder[±] → elbow → hand  — kollar
 *       └ hipJ[±] → knee → ankle           — bacaklar (bot ankle altında)
 *
 * Her eklemde üç mesh kümesi vardır: temel (cilt; hep görünür), 'flight' (uçuş tulumu) ve 'eva'
 * (basınç giysisi). `setSuit()` bunları açıp kapatır. Malzemeler modül düzeyinde bir kez üretilir.
 */

export const HIP_Y = 0.932; // kalça ekleminin zeminden yüksekliği
export const THIGH = 0.45;
export const SHIN = 0.43;
export const ANKLE_H = 0.052; // ayak bileğinin zeminden yüksekliği
export const NOMINAL_H = 1.785;
export const SPINE_Y = 0.1;
export const SHOULDER_Y = 0.39;
export const UPPER_ARM = 0.28;
export const FOREARM = 0.24;

// ---------------------------------------------------------------- yardımcılar

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Aynı malzemeli parçaları tek bir mesh'te birleştiren küçük yardımcı. */
class Bake {
  constructor() {
    this.map = new Map();
  }
  add(geo, mat, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
    _m4.compose(_p.set(p[0], p[1], p[2]), _q.setFromEuler(_e.set(r[0], r[1], r[2])), _s.set(s[0], s[1], s[2]));
    geo.applyMatrix4(_m4);
    let a = this.map.get(mat);
    if (!a) this.map.set(mat, (a = []));
    a.push(geo);
    return this;
  }
  /** Bir Group oluşturup içine birleşik mesh'leri koyar; grubu `list`e kaydeder. */
  into(parent, list, name) {
    const g = new THREE.Group();
    g.name = name;
    for (const [mat, geos] of this.map) {
      const geo = geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
      if (geos.length > 1) geos.forEach((x) => x.dispose());
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
    }
    parent.add(g);
    if (list) list.push(g);
    return g;
  }
}

/** Yukarıdan aşağı uzanan (üst uç y=0) kesik koni uzuv. */
const limb = (rTop, rBot, len, seg = 8) => new THREE.CylinderGeometry(rTop, rBot, len, seg, 1).translate(0, -len / 2, 0);
const sph = (ws = 10, hs = 7) => new THREE.SphereGeometry(1, ws, hs);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, seg = 10) => new THREE.CylinderGeometry(rt, rb, h, seg, 1);

// ---------------------------------------------------------------- paylaşılan malzemeler

let SH = null;

function fabricTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const rand = mulberry32(11);
  g.fillStyle = '#ececec';
  g.fillRect(0, 0, 64, 64);
  // dokuma
  for (let y = 0; y < 64; y += 2) {
    g.fillStyle = `rgba(0,0,0,${0.025 + rand() * 0.02})`;
    g.fillRect(0, y, 64, 1);
  }
  for (let i = 0; i < 260; i++) {
    const v = 200 + rand() * 55;
    g.fillStyle = `rgba(${v},${v},${v},0.5)`;
    g.fillRect((rand() * 64) | 0, (rand() * 64) | 0, 1 + ((rand() * 2) | 0), 1);
  }
  // kir lekeleri
  for (let i = 0; i < 5; i++) {
    const x = rand() * 64;
    const y = rand() * 64;
    const r = 6 + rand() * 12;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(70,60,45,0.28)');
    gr.addColorStop(1, 'rgba(70,60,45,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 2;
  return t;
}

function patchTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.beginPath();
  g.arc(64, 64, 61, 0, Math.PI * 2);
  g.fillStyle = '#16233f';
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = '#e07a2f';
  g.stroke();
  // Endurance halkası esinli: etrafında küçük modüller
  g.fillStyle = '#e8e6df';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.save();
    g.translate(64 + Math.cos(a) * 41, 64 + Math.sin(a) * 41);
    g.rotate(a);
    g.fillRect(-5, -6, 10, 12);
    g.restore();
  }
  g.beginPath();
  g.arc(64, 64, 26, 0, Math.PI * 2);
  g.fillStyle = '#05070c';
  g.fill();
  g.fillStyle = '#f4efe4';
  g.font = 'bold 21px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('AZİM', 64, 65);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function flagTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#d52b1e';
  g.fillRect(0, 0, 96, 64);
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(36, 32, 17, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#d52b1e';
  g.beginPath();
  g.arc(41, 32, 13.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
    const x = 56 + Math.cos(a) * 9;
    const y = 32 + Math.sin(a) * 9;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, 93, 61);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function nameTexture(text) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#1d2433';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#e07a2f';
  g.fillRect(0, 0, 10, 64);
  g.fillStyle = '#f4efe4';
  g.font = 'bold 34px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 138, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function shared() {
  if (SH) return SH;
  const fab = fabricTexture();
  const std = (color, rough, metal = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
  SH = {
    suit: std(0xd6d4cb, 0.9, 0, { map: fab }),
    suitGrey: std(0x8f939a, 0.88, 0, { map: fab }),
    suitDark: std(0x3b3f46, 0.8),
    accent: std(0xd9742c, 0.7),
    zip: std(0x4d5056, 0.5, 0.5),
    boot: std(0x2a2b2e, 0.65),
    sole: std(0x141517, 0.9),
    metal: std(0x9aa0a8, 0.35, 0.8),
    evaWhite: std(0xeceae5, 0.78, 0, { map: fab }),
    evaGrey: std(0x9a9ea5, 0.6, 0.2),
    evaDark: std(0x32353b, 0.7, 0.3),
    bubble: new THREE.MeshStandardMaterial({ color: 0xb7dcff, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.17, depthWrite: false }),
    eyeWhite: std(0xe9e6df, 0.35),
    glasses: std(0x1b1c1f, 0.35, 0.7),
    hairGrey: std(0xa9a9a5, 0.9),
    hairWhite: std(0xc4c4c0, 0.9),
    stubble: new THREE.MeshStandardMaterial({ color: 0x2b211b, roughness: 1, transparent: true, opacity: 0.5, depthWrite: false }),
    beardGrey: std(0x8f8f8b, 0.95),
    patch: new THREE.MeshStandardMaterial({ map: patchTexture(), roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2 }),
    flag: new THREE.MeshStandardMaterial({ map: flagTexture(), roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2 }),
    nameTags: new Map(),
  };
  return SH;
}

function nameMat(text) {
  const S = shared();
  let m = S.nameTags.get(text);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map: nameTexture(text), roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2 });
    S.nameTags.set(text, m);
  }
  return m;
}

// ---------------------------------------------------------------- model

/**
 * @param {object} def  { tag, height, skin, lips, iris, hair, hairStyle:'bun'|'short'|'curly', beard:'none'|'stubble',
 *                        glasses, build:{sh, ch, hp} }
 */
export function buildCrewModel(def) {
  const S = shared();
  const b = { sh: 1, ch: 1, hp: 1, ...(def.build || {}) };
  const skin = new THREE.MeshStandardMaterial({ color: def.skin, roughness: 0.72 });
  const lips = new THREE.MeshStandardMaterial({ color: def.lips ?? 0x8a4a42, roughness: 0.6 });
  const iris = new THREE.MeshStandardMaterial({ color: def.iris ?? 0x2a1a10, roughness: 0.3 });
  const hairMat = new THREE.MeshStandardMaterial({ color: def.hair, roughness: 0.92 });

  const root = new THREE.Group();
  root.name = 'crew-model';
  const s = (def.height ?? NOMINAL_H) / NOMINAL_H;
  root.scale.setScalar(s);

  const flightG = [];
  const evaG = [];
  const hairMeshes = [];

  // ------------------------------------------------ leğen
  const hips = new THREE.Group();
  hips.name = 'hips';
  hips.position.y = HIP_Y;
  root.add(hips);
  {
    const f = new Bake();
    f.add(sph(14, 8), S.suit, [0, 0.0, 0], [0, 0, 0], [0.158 * b.hp, 0.105, 0.112]);
    f.into(hips, flightG, 'flight');
    const e = new Bake();
    e.add(sph(14, 8), S.evaWhite, [0, 0.0, 0], [0, 0, 0], [0.21 * b.hp, 0.14, 0.16]);
    e.add(cyl(0.2, 0.2, 0.05, 16), S.evaGrey, [0, 0.1, 0], [0, 0, 0], [1.05, 1, 0.8]);
    e.into(hips, evaG, 'eva');
  }

  // ------------------------------------------------ gövde
  const spine = new THREE.Group();
  spine.name = 'spine';
  spine.position.y = SPINE_Y;
  hips.add(spine);
  const torsoProfile = (k) =>
    [
      [0.13, 0],
      [0.145, 0.06],
      [0.148, 0.16],
      [0.158, 0.28],
      [0.165, 0.36],
      [0.15, 0.42],
      [0.085, 0.455],
      [0.06, 0.47],
    ].map(([r, y]) => new THREE.Vector2(r * k, y));
  {
    const f = new Bake();
    const torso = new THREE.LatheGeometry(torsoProfile(1), 16);
    f.add(torso, S.suit, [0, 0, 0], [0, 0, 0], [1.28 * b.sh, 1, 0.74 * b.ch]);
    // kemer + tokası
    f.add(cyl(0.148, 0.148, 0.045, 16), S.suitDark, [0, 0.02, 0], [0, 0, 0], [1.29 * b.sh, 1, 0.75 * b.ch]);
    f.add(box(0.05, 0.035, 0.01), S.metal, [0, 0.02, 0.112 * b.ch], [0, 0, 0]);
    // boyun halkası (yaka)
    f.add(new THREE.TorusGeometry(0.058, 0.017, 6, 14), S.suitGrey, [0, 0.462, 0.0], [Math.PI / 2 - 0.15, 0, 0], [1.05, 1, 1]);
    // fermuar ve çekmesi
    f.add(box(0.011, 0.38, 0.006), S.zip, [0, 0.235, 0.122 * b.ch + 0.002], [0, 0, 0]);
    f.add(box(0.02, 0.03, 0.008), S.metal, [0, 0.42, 0.125 * b.ch + 0.003], [0, 0, 0]);
    // göğüs cepleri (kapaklı) + cepte kalem
    for (const sx of [-1, 1]) {
      f.add(box(0.075, 0.05, 0.012), S.suitGrey, [sx * 0.105 * b.sh, 0.255, 0.118 * b.ch - 0.002], [0, -sx * 0.36, 0]);
    }
    f.add(box(0.01, 0.05, 0.008), S.accent, [0.13 * b.sh, 0.29, 0.118 * b.ch + 0.004], [0, -0.38, 0]);
    // omuz bantları (trapez)
    for (const sx of [-1, 1]) f.add(box(0.1, 0.012, 0.15), S.suitGrey, [sx * 0.13 * b.sh, 0.428, 0], [0, 0, -sx * 0.18]);
    f.into(spine, flightG, 'flight');

    // görev yaması (sol göğüs) + isim bandı (sağ göğüs)
    const fp = new THREE.Group();
    fp.name = 'flight';
    const patch = new THREE.Mesh(new THREE.CircleGeometry(0.036, 16), S.patch);
    patch.position.set(0.098 * b.sh, 0.31, 0.1075 * b.ch + 0.002);
    patch.rotation.y = 0.5;
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.088, 0.022), nameMat(def.tag));
    tag.position.set(-0.098 * b.sh, 0.305, 0.1075 * b.ch + 0.002);
    tag.rotation.y = -0.5;
    fp.add(patch, tag);
    spine.add(fp);
    flightG.push(fp);

    const e = new Bake();
    e.add(new THREE.LatheGeometry(torsoProfile(1.32), 16), S.evaWhite, [0, 0, 0], [0, 0, 0], [1.3 * b.sh, 1, 0.9 * b.ch]);
    e.add(box(0.2, 0.12, 0.05), S.evaGrey, [0, 0.27, 0.16 * b.ch], [0, 0, 0]);
    for (let i = 0; i < 3; i++) e.add(box(0.03, 0.02, 0.012), i === 1 ? S.accent : S.evaDark, [-0.06 + i * 0.06, 0.28, 0.19 * b.ch], [0, 0, 0]);
    e.add(cyl(0.2, 0.2, 0.05, 16), S.evaGrey, [0, 0.03, 0], [0, 0, 0], [1.3 * b.sh, 1, 0.9 * b.ch]);
    // yaşam destek sırt çantası + hortumlar
    e.add(box(0.38, 0.5, 0.17), S.evaWhite, [0, 0.24, -0.2 * b.ch - 0.06], [0, 0, 0]);
    e.add(box(0.3, 0.1, 0.12), S.evaGrey, [0, 0.52, -0.22 * b.ch - 0.04], [0, 0, 0]);
    e.add(box(0.04, 0.36, 0.02), S.accent, [0.1, 0.24, -0.2 * b.ch - 0.15], [0, 0, 0]);
    for (const sx of [-1, 1]) {
      e.add(cyl(0.015, 0.015, 0.34, 6), S.evaDark, [sx * 0.14, 0.3, -0.04 * b.ch], [0.3, 0, sx * 0.4]);
    }
    // boyun halkası (kask bağlantısı)
    e.add(new THREE.TorusGeometry(0.1, 0.022, 6, 16), S.evaGrey, [0, 0.46, 0.0], [Math.PI / 2, 0, 0]);
    e.into(spine, evaG, 'eva');
  }

  // ------------------------------------------------ boyun + kafa
  const neck = new THREE.Group();
  neck.name = 'neck';
  neck.position.y = 0.46;
  spine.add(neck);
  {
    const base = new Bake();
    base.add(cyl(0.046, 0.052, 0.14, 10), skin, [0, 0.04, 0]);
    base.into(neck, null, 'base');
  }
  const head = new THREE.Group();
  head.name = 'head';
  head.position.y = 0.1;
  neck.add(head);

  const C = 0.06; // kafatası merkezinin head grubuna göre y'si
  const RX = 0.082;
  const RY = 0.108;
  const RZ = 0.097;
  {
    const k = new Bake();
    k.add(sph(18, 12), skin, [0, C, 0], [0, 0, 0], [RX, RY, RZ]); // kafatası
    k.add(sph(14, 9), skin, [0, C - 0.04, 0.012], [0, 0, 0], [0.073, 0.066, 0.088]); // çene/yanak
    k.add(sph(8, 6), skin, [0, C - 0.01, 0.1], [0, 0, 0], [0.012, 0.016, 0.016]); // burun ucu
    k.add(box(0.014, 0.04, 0.012), skin, [0, C + 0.012, 0.092], [0.22, 0, 0]); // burun kemiği
    for (const sx of [-1, 1]) {
      k.add(sph(8, 6), skin, [sx * (RX + 0.003), C - 0.002, -0.004], [0, 0, 0], [0.011, 0.024, 0.017]); // kulak
    }
    k.add(box(0.034, 0.0055, 0.006), lips, [0, C - 0.047, 0.0985]);
    k.into(head, null, 'base');
  }
  // gözler (kırpma için ayrı gruplar)
  const eyes = [];
  for (const sx of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(sx * 0.034, C + 0.016, 0.086);
    const w = new THREE.Mesh(sph(10, 7), S.eyeWhite);
    w.scale.set(0.0125, 0.0085, 0.007);
    const ir = new THREE.Mesh(sph(8, 6), iris);
    ir.scale.set(0.0058, 0.0058, 0.004);
    ir.position.z = 0.0052;
    g.add(w, ir);
    head.add(g);
    eyes.push(g);
  }
  // ağız (konuşurken açılır): koyu içi
  const mouth = new THREE.Mesh(box(0.028, 0.004, 0.004), new THREE.MeshStandardMaterial({ color: 0x2a0f0f, roughness: 0.8 }));
  mouth.position.set(0, C - 0.0475, 0.1);
  head.add(mouth);

  // ---- saç
  const hairBake = new Bake();
  const capRot = -0.5;
  const addCap = (len, scl = 1.025, dy = 0.003) => {
    const g = new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, len);
    hairBake.add(g, hairMat, [0, C + dy, -0.004], [capRot, 0, 0], [(RX + 0.007) * scl, (RY + 0.008) * scl, (RZ + 0.007) * scl]);
  };
  // kaş (saç rengiyle)
  for (const sx of [-1, 1]) hairBake.add(box(0.034, 0.0085, 0.009), hairMat, [sx * 0.035, C + 0.037, 0.0905], [0, -sx * 0.1, sx * -0.14]);
  if (def.hairStyle === 'bun') {
    addCap(1.5);
    hairBake.add(sph(10, 7), hairMat, [0, C + 0.085, -0.09], [0, 0, 0], [0.05, 0.043, 0.05]);
    hairBake.add(new THREE.TorusGeometry(0.047, 0.006, 5, 12), S.accent, [0, C + 0.065, -0.082], [0.9, 0, 0]);
    hairBake.add(sph(10, 7), hairMat, [0, C - 0.01, -0.045], [0, 0, 0], [0.083, 0.088, 0.06]); // ense saçı
  } else if (def.hairStyle === 'short') {
    addCap(1.56, 1.012, 0.004);
    for (const sx of [-1, 1]) hairBake.add(box(0.012, 0.045, 0.03), hairMat, [sx * (RX - 0.003), C - 0.012, 0.025], [0, 0, 0]); // favori
    hairBake.add(sph(10, 7), hairMat, [0, C - 0.012, -0.05], [0, 0, 0], [0.082, 0.08, 0.055]);
  } else if (def.hairStyle === 'curly') {
    addCap(1.5, 1.0);
    const rnd = mulberry32(5);
    const n = 30;
    for (let i = 0; i < n; i++) {
      // küre kepi üzerinde fibonacci dağılımı
      const u = (i + 0.5) / n;
      const th = Math.acos(1 - u * (1 - Math.cos(1.78))); // 0..~102°
      const ph = i * 2.399963;
      const x = Math.sin(th) * Math.cos(ph);
      const z = Math.sin(th) * Math.sin(ph);
      const y = Math.cos(th);
      // eğimi (capRot) uygula
      const cy = y * Math.cos(capRot) - z * Math.sin(capRot);
      const cz = y * Math.sin(capRot) + z * Math.cos(capRot);
      if (cz > 0.25 && cy < 0.6) continue; // alın bölgesini açık bırak
      const r = 0.027 + rnd() * 0.01;
      hairBake.add(sph(7, 5), hairMat, [x * (RX + 0.012), C + cy * (RY + 0.013), cz * (RZ + 0.01) - 0.004], [0, 0, 0], [r, r * 0.9, r]);
    }
    for (const sx of [-1, 1]) hairBake.add(sph(7, 5), hairMat, [sx * (RX + 0.004), C + 0.0, 0.0], [0, 0, 0], [0.018, 0.04, 0.03]); // favori kıvrımı
  }
  const hairG = hairBake.into(head, null, 'hair');
  hairG.traverse((o) => o.isMesh && hairMeshes.push(o));

  // ---- sakal (gölge / yaşlıda gri)
  let beard = null;
  if (def.beard) {
    const bg = new THREE.SphereGeometry(1, 16, 10, 0.18, Math.PI - 0.36, 1.5, 1.55);
    beard = new THREE.Mesh(bg, S.stubble);
    beard.position.set(0, C - 0.04, 0.012);
    beard.scale.set(0.073 * 1.03, 0.066 * 1.04, 0.088 * 1.03);
    beard.visible = def.beard === 'stubble';
    head.add(beard);
  }

  // ---- gözlük
  if (def.glasses) {
    const gl = new Bake();
    for (const sx of [-1, 1]) {
      gl.add(new THREE.TorusGeometry(0.0265, 0.0028, 5, 14), S.glasses, [sx * 0.036, C + 0.016, 0.1]);
      gl.add(box(0.0028, 0.0028, 0.095), S.glasses, [sx * 0.0735, C + 0.019, 0.05], [0, -sx * 0.05, 0]);
    }
    gl.add(box(0.016, 0.0028, 0.0028), S.glasses, [0, C + 0.022, 0.101]);
    gl.into(head, null, 'glasses');
  }

  // EVA kaskı: saydam baloncuk + boyun halkası
  {
    const e = new THREE.Group();
    e.name = 'eva';
    const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.168, 18, 12), S.bubble);
    bubble.position.set(0, C + 0.0, 0.0);
    bubble.renderOrder = 2;
    e.add(bubble);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.128, 0.02, 6, 18), S.evaGrey);
    rim.position.set(0, C - 0.11, 0.0);
    rim.rotation.x = Math.PI / 2;
    rim.castShadow = true;
    e.add(rim);
    const lamp = new THREE.Mesh(box(0.05, 0.03, 0.04), S.evaGrey);
    lamp.position.set(0.14, C + 0.12, 0.05);
    e.add(lamp);
    head.add(e);
    evaG.push(e);
  }

  // ------------------------------------------------ kollar
  const shoulders = [];
  const elbows = [];
  const hands = [];
  const sx0 = 0.215 * b.sh;
  for (const sx of [1, -1]) {
    const sh = new THREE.Group();
    sh.name = sx > 0 ? 'shoulderL' : 'shoulderR';
    sh.position.set(sx * sx0, SHOULDER_Y, 0);
    spine.add(sh);
    shoulders.push(sh);
    {
      const f = new Bake();
      f.add(sph(10, 7), S.suit, [0, -0.005, 0], [0, 0, 0], [0.056, 0.056, 0.056]);
      f.add(limb(0.054, 0.046, UPPER_ARM, 9), S.suit, [0, 0, 0]);
      f.add(cyl(0.056, 0.056, 0.022, 9), S.accent, [0, -0.1, 0]); // turuncu şerit
      f.into(sh, flightG, 'flight');
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.044, 0.03), S.flag);
      fl.position.set(sx * 0.0575, -0.055, 0);
      fl.rotation.y = sx * (Math.PI / 2);
      const fg = new THREE.Group();
      fg.name = 'flight';
      fg.add(fl);
      sh.add(fg);
      flightG.push(fg);
      const e = new Bake();
      e.add(sph(10, 7), S.evaWhite, [0, 0, 0], [0, 0, 0], [0.095, 0.09, 0.09]);
      e.add(limb(0.078, 0.07, UPPER_ARM, 9), S.evaWhite, [0, 0, 0]);
      e.add(cyl(0.08, 0.08, 0.02, 9), S.accent, [0, -0.12, 0]);
      e.into(sh, evaG, 'eva');
    }
    const el = new THREE.Group();
    el.name = sx > 0 ? 'elbowL' : 'elbowR';
    el.position.y = -UPPER_ARM;
    sh.add(el);
    elbows.push(el);
    {
      const f = new Bake();
      f.add(sph(8, 6), S.suit, [0, 0, 0], [0, 0, 0], [0.047, 0.047, 0.047]);
      f.add(limb(0.047, 0.039, FOREARM, 9), S.suit, [0, 0, 0]);
      f.add(cyl(0.042, 0.042, 0.032, 9), S.suitGrey, [0, -FOREARM + 0.016, 0]); // manşet
      f.into(el, flightG, 'flight');
      const e = new Bake();
      e.add(sph(8, 6), S.evaGrey, [0, 0, 0], [0, 0, 0], [0.078, 0.078, 0.078]);
      e.add(limb(0.07, 0.062, FOREARM, 9), S.evaWhite, [0, 0, 0]);
      e.add(cyl(0.07, 0.07, 0.03, 9), S.evaGrey, [0, -FOREARM + 0.015, 0]);
      e.into(el, evaG, 'eva');
    }
    const hd = new THREE.Group();
    hd.name = sx > 0 ? 'handL' : 'handR';
    hd.position.y = -FOREARM;
    el.add(hd);
    hands.push(hd);
    {
      const k = new Bake();
      k.add(box(0.07, 0.078, 0.03), skin, [0, -0.04, 0]); // avuç
      k.add(box(0.068, 0.05, 0.026), skin, [0, -0.1, 0.012], [-0.3, 0, 0]); // parmaklar (hafif kıvrık)
      k.add(box(0.02, 0.05, 0.022), skin, [-sx * 0.04, -0.052, 0.02], [-0.35, 0, -sx * 0.1]); // başparmak
      k.add(cyl(0.032, 0.034, 0.03, 8), skin, [0, -0.005, 0]); // bilek
      k.into(hd, null, 'base');
      const e = new Bake();
      e.add(box(0.1, 0.1, 0.055), S.evaWhite, [0, -0.06, 0.004]);
      e.add(box(0.095, 0.06, 0.05), S.evaWhite, [0, -0.12, 0.02], [-0.3, 0, 0]);
      e.add(box(0.03, 0.06, 0.04), S.evaWhite, [-sx * 0.06, -0.06, 0.025], [-0.35, 0, -sx * 0.1]);
      e.add(cyl(0.062, 0.062, 0.026, 9), S.metal, [0, 0.0, 0]);
      e.into(hd, evaG, 'eva');
    }
  }

  // ------------------------------------------------ bacaklar
  const hipJ = [];
  const knees = [];
  const ankles = [];
  for (const sx of [1, -1]) {
    const hj = new THREE.Group();
    hj.name = sx > 0 ? 'hipL' : 'hipR';
    hj.position.set(sx * 0.093 * b.hp, -0.015, 0);
    hips.add(hj);
    hipJ.push(hj);
    {
      const f = new Bake();
      f.add(limb(0.088, 0.066, THIGH, 10), S.suit, [0, 0, 0]);
      // uyluk cebi (kapaklı)
      f.add(box(0.012, 0.11, 0.095), S.suitGrey, [sx * 0.082, -0.19, 0.0], [0, 0, 0]);
      f.add(box(0.01, 0.012, 0.09), S.suitDark, [sx * 0.088, -0.145, 0.0]);
      f.into(hj, flightG, 'flight');
      const e = new Bake();
      e.add(limb(0.112, 0.09, THIGH, 10), S.evaWhite, [0, 0, 0]);
      e.add(cyl(0.114, 0.114, 0.03, 10), S.evaGrey, [0, -0.02, 0]);
      e.into(hj, evaG, 'eva');
    }
    const kn = new THREE.Group();
    kn.name = sx > 0 ? 'kneeL' : 'kneeR';
    kn.position.y = -THIGH;
    hj.add(kn);
    knees.push(kn);
    {
      const f = new Bake();
      f.add(sph(8, 6), S.suit, [0, 0, 0], [0, 0, 0], [0.066, 0.066, 0.066]);
      f.add(limb(0.064, 0.052, SHIN, 10), S.suit, [0, 0, 0]);
      f.add(box(0.07, 0.07, 0.025), S.suitGrey, [0, 0.0, 0.06]); // dizlik
      f.into(kn, flightG, 'flight');
      const e = new Bake();
      e.add(sph(8, 6), S.evaGrey, [0, 0, 0], [0, 0, 0], [0.1, 0.1, 0.1]);
      e.add(limb(0.092, 0.08, SHIN, 10), S.evaWhite, [0, 0, 0]);
      e.add(box(0.09, 0.1, 0.03), S.evaWhite, [0, 0, 0.09]);
      e.into(kn, evaG, 'eva');
    }
    const an = new THREE.Group();
    an.name = sx > 0 ? 'ankleL' : 'ankleR';
    an.position.y = -SHIN;
    kn.add(an);
    ankles.push(an);
    {
      // bot (uçuş giysisiyle de, EVA'da büyüğü)
      const bt = new Bake();
      bt.add(cyl(0.058, 0.062, 0.11, 10), S.boot, [0, 0.02, 0]);
      bt.add(box(0.104, 0.07, 0.15), S.boot, [0, -0.01, 0.045]);
      bt.add(sph(10, 7), S.boot, [0, -0.012, 0.115], [0, 0, 0], [0.052, 0.04, 0.075]);
      bt.add(box(0.108, 0.022, 0.29), S.sole, [0, -0.04, 0.07]);
      bt.add(box(0.108, 0.018, 0.04), S.suitGrey, [0, 0.062, 0.0]); // bot bağı
      bt.into(an, flightG, 'flight');
      const e = new Bake();
      e.add(cyl(0.085, 0.09, 0.12, 10), S.evaWhite, [0, 0.03, 0]);
      e.add(box(0.14, 0.085, 0.18), S.evaWhite, [0, -0.005, 0.05]);
      e.add(sph(10, 7), S.evaWhite, [0, -0.008, 0.13], [0, 0, 0], [0.07, 0.048, 0.08]);
      e.add(box(0.146, 0.026, 0.31), S.evaDark, [0, -0.04, 0.075]);
      e.into(an, evaG, 'eva');
    }
  }

  // ------------------------------------------------ kontrol
  let suit = 'flight';
  const setSuit = (type) => {
    suit = type === 'eva' ? 'eva' : 'flight';
    flightG.forEach((g) => (g.visible = suit === 'flight'));
    evaG.forEach((g) => (g.visible = suit === 'eva'));
  };
  setSuit('flight');

  const model = {
    root,
    hips,
    spine,
    neck,
    head,
    shoulders, // [L, R]
    elbows,
    hands,
    hipJ,
    knees,
    ankles,
    eyes,
    mouth,
    skin,
    hairMat,
    hairMeshes,
    beard,
    scale: s,
    get suit() {
      return suit;
    },
    setSuit,
    /** Gri saç ve sakal */
    setAgedLook(aged) {
      const grey = def.agedHair === 'white' ? S.hairWhite : S.hairGrey;
      hairMeshes.forEach((m) => (m.material = aged ? grey : hairMat));
      if (beard) {
        if (aged) {
          beard.material = S.beardGrey;
          beard.scale.set(0.073 * 1.1, 0.066 * 1.16, 0.088 * 1.1);
          beard.visible = def.beard !== 'none' && def.agedBeard !== false;
        } else {
          beard.material = S.stubble;
          beard.scale.set(0.073 * 1.03, 0.066 * 1.04, 0.088 * 1.03);
          beard.visible = def.beard === 'stubble';
        }
      }
      skin.color.set(def.skin);
      if (aged) skin.color.lerp(new THREE.Color(0xc8bdb2), 0.22);
    },
    /** Eşleştirilmiş üçgen sayısı (sınama) */
    triangleCount() {
      let n = 0;
      root.traverse((o) => {
        if (!o.isMesh) return;
        let vis = true;
        for (let p = o; p; p = p.parent) if (!p.visible) vis = false;
        if (!vis) return;
        const g = o.geometry;
        n += (g.index ? g.index.count : g.attributes.position.count) / 3;
      });
      return n;
    },
  };
  return model;
}
