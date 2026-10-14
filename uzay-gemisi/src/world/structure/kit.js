import * as THREE from 'three';
import { addMesh } from '../utils.js';
import { HAS_DOM, makeCanvas } from './textures.js';

/**
 * Yapı yapım kiti (Ajan 1): metre tabanlı UV'li kutular, çubuk/boru, etiket dekalleri.
 *
 * NEDEN: BoxGeometry her yüzde UV'yi 0..1 yapar; 11 m'lik duvara kaplanan doku tek seferde gerilir.
 * Buradaki yardımcılar UV'yi metreye çevirir: `mpr` (metre/tekrar) = dokunun bir tekrarının metre boyu.
 * UV, kutunun parent'taki konumundan hesaplanır → yan yana kutularda doku kesintisiz devam eder.
 *
 *   // 11 m'lik duvar şeridi; doku her 2.75 m'de bir tekrarlanır
 *   addWorldBox(g, { size: [11, 1, 0.1], pos: [0, 2, -3.5], material: M.wallQuilt, mpr: 2.75 });
 *   // mpr bir çift de olabilir: [yatay, dikey]
 *   addWorldBox(g, { ..., mpr: [2.75, 2.0] });
 */

/** Kutu geometrisinin UV'lerini metre tabanlıya çevirir (yerinde). center: kutunun parent'taki konumu. */
export function scaleBoxUVs(geo, mpr = 1, center = [0, 0, 0], offset = [0, 0]) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const [mu, mv] = Array.isArray(mpr) ? mpr : [mpr, mpr];
  for (let i = 0; i < pos.count; i++) {
    const face = (i / 4) | 0; // BoxGeometry sırası: +x, -x, +y, -y, +z, -z
    const x = pos.getX(i) + center[0];
    const y = pos.getY(i) + center[1];
    const z = pos.getZ(i) + center[2];
    let u;
    let v;
    if (face < 2) {
      u = z;
      v = y;
    } else if (face < 4) {
      u = x;
      v = z;
    } else {
      u = x;
      v = y;
    }
    uv.setXY(i, u / mu + offset[0], v / mv + offset[1]);
  }
  uv.needsUpdate = true;
  return geo;
}

/** Metre tabanlı UV'li kutu geometrisi. */
export function worldBox(w, h, d, mpr = 1, center = [0, 0, 0], offset = [0, 0]) {
  return scaleBoxUVs(new THREE.BoxGeometry(w, h, d), mpr, center, offset);
}

/** addBox gibi, ama UV'ler metre tabanlı. `mpr` ve `uvOffset` ek seçenekler. */
export function addWorldBox(parent, { size = [1, 1, 1], pos = [0, 0, 0], material, mpr = 1, uvOffset, ...opts }) {
  const geo = worldBox(size[0], size[1], size[2], mpr, pos, uvOffset);
  return addMesh(parent, geo, material, { pos, ...opts });
}

/** İki nokta arasında çubuk/boru (açık uçlu silindir). Kafes kirişler, borular için. */
export function addRod(parent, a, b, radius, material, { segments = 6, openEnded = true, ...opts } = {}) {
  const va = new THREE.Vector3(a[0], a[1], a[2]);
  const vb = new THREE.Vector3(b[0], b[1], b[2]);
  const len = va.distanceTo(vb);
  const geo = new THREE.CylinderGeometry(radius, radius, len, segments, 1, openEnded);
  const m = addMesh(parent, geo, material, opts);
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.sub(va).normalize());
  return m;
}

/** Altıgen başlı cıvata/perçin: yüzey düzlemine dik eksen verilir ('x' | 'y' | 'z'). */
export function addBolt(parent, pos, axis, material, r = 0.02, h = 0.02) {
  const geo = new THREE.CylinderGeometry(r, r, h, 6);
  const m = addMesh(parent, geo, material, { pos });
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  else if (axis === 'z') m.rotation.x = Math.PI / 2;
  return m;
}

// ---------------------------------------------------------------------------
// Etiket dekalleri (canvas → doku). Her etiket bir kez üretilir, önbellekten gelir.
// ---------------------------------------------------------------------------
const FONT = '"DejaVu Sans Condensed", "Arial Narrow", "Liberation Sans Narrow", Arial, sans-serif';
const cache = new Map();

/** Türkçe büyük harf (i → İ). */
export const upperTR = (s) => String(s).toLocaleUpperCase('tr-TR');

function plateMaterial(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: 0.1 });
  m.name = 'label';
  return m;
}

/**
 * Modül başlığı levhası: "MODÜL 06 — MOTOR VE ENERJİ" (koyu levha, sıcak beyaz şablon yazı).
 * `tag` küçük yan yazıdır (örn. "◄ 05"). Dönen malzeme önbellekten gelir.
 */
export function moduleLabelMaterial(index, name, tag = '') {
  const key = `mod:${index}:${name}:${tag}`;
  if (cache.has(key)) return cache.get(key);
  let mat;
  if (!HAS_DOM) mat = new THREE.MeshStandardMaterial({ color: 0x2a2c2e });
  else {
    const W = 1024;
    const H = 80;
    const c = makeCanvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = '#26282b';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#d9a21b';
    g.fillRect(0, 0, 14, H);
    g.fillRect(W - 14, 0, 14, H);
    g.strokeStyle = 'rgba(255,255,255,0.22)';
    g.lineWidth = 2;
    g.strokeRect(20, 6, W - 40, H - 12);
    g.fillStyle = '#efe6cf';
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.font = `bold 44px ${FONT}`;
    const title = `MODÜL ${String(index).padStart(2, '0')} — ${upperTR(name)}`;
    g.fillText(title, W / 2, H / 2 + 2, W - 190);
    if (tag) {
      g.font = `bold 26px ${FONT}`;
      g.fillStyle = '#d9a21b';
      g.textAlign = 'left';
      g.fillText(tag, 34, H / 2 + 2);
    }
    // eskime
    g.fillStyle = 'rgba(0,0,0,0.16)';
    for (let i = 0; i < 40; i++) g.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 30, 1);
    mat = plateMaterial(c);
  }
  cache.set(key, mat);
  return mat;
}

/** Şablon levha atlası: tek doku, birçok küçük etiket (bir modülde tek çizim çağrısı). */
const STENCILS = [
  { id: 'basinc', text: 'BASINÇ', bg: '#d9a21b', fg: '#1a1a1a' },
  { id: 'dikkat', text: 'DİKKAT', bg: '#c9531f', fg: '#f3ead4' },
  { id: 'acil', text: 'ACİL ÇIKIŞ', bg: '#1f7a46', fg: '#f3ead4' },
  { id: 'hava', text: 'HAVALANDIRMA', bg: '#3b3f44', fg: '#e6dfcc' },
  { id: 'kablo', text: 'KABLO KANALI', bg: '#3b3f44', fg: '#e6dfcc' },
  { id: 'servis', text: 'SERVİS KAPAĞI', bg: '#cfc8b6', fg: '#222' },
  { id: 'alcak', text: 'ALÇAK TAVAN', bg: '#d9a21b', fg: '#1a1a1a' },
  { id: 'tutun', text: 'TUTUNMA HATTI', bg: '#cfc8b6', fg: '#222' },
];
let sheet = null;

function getSheet() {
  if (sheet) return sheet;
  const W = 1024;
  const cellH = 64;
  const H = cellH * STENCILS.length;
  const rects = {};
  let mat;
  if (!HAS_DOM) mat = new THREE.MeshStandardMaterial({ color: 0x888888 });
  else {
    const c = makeCanvas(W, H);
    const g = c.getContext('2d');
    c.getContext('2d').fillStyle = '#000';
    STENCILS.forEach((s, i) => {
      const y = i * cellH;
      g.font = `bold 40px ${FONT}`;
      const pw = Math.min(W, Math.ceil(g.measureText(s.text).width) + 56); // levha genişliği yazıya göre
      g.fillStyle = s.bg;
      g.fillRect(0, y, pw, cellH);
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.lineWidth = 3;
      g.strokeRect(3, y + 3, pw - 6, cellH - 6);
      g.fillStyle = s.fg;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(s.text, pw / 2, y + cellH / 2 + 2);
      rects[s.id] = { u0: 0, u1: pw / W, v0: 1 - (y + cellH) / H, v1: 1 - y / H, aspect: pw / cellH };
    });
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let i = 0; i < 160; i++) g.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 40, 1);
    mat = plateMaterial(c);
    mat.name = 'stencil';
  }
  sheet = { mat, rects };
  return sheet;
}

/**
 * Şablon etiketi (düzlem). id: basinc | dikkat | acil | hava | kablo | servis | alcak | tutun
 * Düzlem +Z'ye bakar; döndürmek için rot verin. height: metre (genişlik otomatik).
 */
export function addStencil(parent, id, { pos, rot = [0, 0, 0], height = 0.09, width } = {}) {
  const sh = getSheet();
  const r = sh.rects[id] || { u0: 0, u1: 1, v0: 0, v1: 1, aspect: 4 };
  const w = width ?? height * r.aspect;
  const geo = new THREE.PlaneGeometry(w, height);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) ? r.u1 : r.u0, uv.getY(i) ? r.v1 : r.v0);
  return addMesh(parent, geo, sh.mat, { pos, rot });
}

/** Kısa yazı levhası: tek seferlik canvas dokusu, önbellekli (örn. KİLİTLİ ekranı). */
export function textPlateMaterial(key, text, { w = 256, h = 96, bg = '#050505', fg = '#ff3a2a', font = 'bold 44px', glow = true } = {}) {
  if (cache.has(key)) return cache.get(key);
  let mat;
  if (!HAS_DOM) mat = new THREE.MeshStandardMaterial({ color: 0x110000 });
  else {
    const c = makeCanvas(w, h);
    const g = c.getContext('2d');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = fg;
    g.font = `${font} ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (glow) {
      g.shadowColor = fg;
      g.shadowBlur = 8;
    }
    g.fillText(text, w / 2, h / 2 + 2, w - 16);
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    mat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.3, roughness: 0.4 });
    mat.name = 'plate:' + key;
  }
  cache.set(key, mat);
  return mat;
}

/** Çizgi tabanlı rastgele yardımcı: tohumlu, tekrarlanabilir (dış gövde yerleşimleri için). */
export function seeded(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
