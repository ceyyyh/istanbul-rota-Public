import * as THREE from 'three';
import { addMesh, addBox, addCylinder } from '../../utils.js';
import { createScreen } from '../../materials.js';

/**
 * Mürettebat modülleri (Ajan 3) için ortak yardımcılar.
 *
 * Kural: tüm mobilya yardımcıları kendi yerel uzaylarında ÖN YÜZÜ +Z'ye bakacak şekilde kurulur.
 *   - Dış duvara (z = -3.5) yaslanan, odaya bakan nesne → rotY = 0
 *   - İç duvara (z = +3.5) yaslanan, odaya bakan nesne  → rotY = Math.PI
 *
 * Statik meshler Ship tarafından malzemeye göre birleştirilir; bu yüzden küçük parçalar
 * (anahtarlar, kitaplar, etiketler) ucuzdur. Renkli küçük parçalar için köşe renkli (vertex color)
 * ortak malzeme kullanılır → hepsi tek çizim çağrısında birleşir.
 */

const HAS_DOM = typeof document !== 'undefined';
const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// Deterministik rastgelelik (her açılışta aynı "dağınıklık")
// ---------------------------------------------------------------------------
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Malzemeler (modül seviyesinde bir kez oluşturulur, tüm mürettebat modülleri paylaşır)
// ---------------------------------------------------------------------------
let crewMats = null;
let powerRegistered = false;

function std(name, color, roughness, metalness, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  m.name = name;
  return m;
}

function createCrewMaterials() {
  return {
    /** Köşe renkli boyalı parçalar (anahtar başlıkları, düğmeler, kutular) */
    vc: std('crewVC', 0xffffff, 0.55, 0.1, { vertexColors: true }),
    /** Köşe renkli mat parçalar (kumaş, kâğıt, kitap, yiyecek paketleri) */
    vcMatte: std('crewVCMatte', 0xffffff, 0.92, 0.0, { vertexColors: true }),
    /** Gösterge panelleri: koyu mavimsi gri */
    console: std('crewConsole', 0x33373c, 0.6, 0.35),
    consoleEdge: std('crewConsoleEdge', 0x1d1f22, 0.5, 0.4),
    wood: std('crewWood', 0x7b5434, 0.72, 0.0),
    woodDark: std('crewWoodDark', 0x4a3121, 0.78, 0.0),
    /** Hiper-uyku sıvısı: sütlü, hafif içten aydınlık */
    milk: std('crewMilk', 0xe8ece8, 0.22, 0.0, { emissive: 0xcfe2e8, emissiveIntensity: 0.3 }),
    /** Plastik örtüye sarılı uyuyan mürettebat silueti */
    sleeper: std('crewSleeper', 0xbab6ae, 0.55, 0.0),
    sleeperWrap: std('crewSleeperWrap', 0xd9dcd8, 0.3, 0.0, { transparent: true, opacity: 0.55, depthWrite: false }),
    plant: std('crewPlant', 0x47783c, 0.8, 0.0, { side: THREE.DoubleSide }),
    plantDark: std('crewPlantDark', 0x2d5426, 0.85, 0.0, { side: THREE.DoubleSide }),
    soil: std('crewSoil', 0x3a2a1f, 1.0, 0.0),
    paper: std('crewPaper', 0xe6e0cf, 0.95, 0.0),
    /** Gösterge ışıkları — enerji yokken sönük (registerCrewPower) */
    indGreen: std('crewIndGreen', 0x041004, 0.4, 0.0, { emissive: 0x3dff6a, emissiveIntensity: 1.6 }),
    indAmber: std('crewIndAmber', 0x140a02, 0.4, 0.0, { emissive: 0xffa53a, emissiveIntensity: 1.6 }),
    indWhite: std('crewIndWhite', 0x2a2a28, 0.5, 0.0, { emissive: 0xfff0d8, emissiveIntensity: 0.7 }),
    indBlue: std('crewIndBlue', 0x02060c, 0.4, 0.0, { emissive: 0x5ab4ff, emissiveIntensity: 1.4 }),
    /** Sadece acil durumda yanan "YEDEK GÜÇ" lambası */
    indBackup: std('crewIndBackup', 0x200000, 0.4, 0.0, { emissive: 0xff2a1a, emissiveIntensity: 0 }),
    /** Tıbbi tarayıcı halkası */
    scanRing: std('crewScanRing', 0x0b1a20, 0.3, 0.0, { emissive: 0x7fe6ff, emissiveIntensity: 0.6 }),
    scanBeam: (() => {
      const m = new THREE.MeshBasicMaterial({
        color: 0x7fe6ff,
        transparent: true,
        opacity: 0.0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      m.name = 'crewScanBeam';
      return m;
    })(),
    /** Etkileşim vekil kutuları: görünmez ama ışınla vurulabilir */
    proxy: (() => {
      const m = new THREE.MeshBasicMaterial({ visible: false });
      m.name = 'crewProxy';
      return m;
    })(),
  };
}

/** Ortak mürettebat malzemeleri. mctx verilirse güç moduna bağlı olanlar bir kez kaydedilir. */
export function crewMaterials(mctx) {
  if (!crewMats) crewMats = createCrewMaterials();
  if (mctx?.lighting && !powerRegistered) {
    powerRegistered = true;
    const L = mctx.lighting;
    const C = crewMats;
    L.addEmissive(C.indGreen, { normal: { color: 0x3dff6a, intensity: 1.6 }, emergency: { color: 0x000000, intensity: 0 } });
    L.addEmissive(C.indAmber, { normal: { color: 0xffa53a, intensity: 1.6 }, emergency: { color: 0x000000, intensity: 0 } });
    L.addEmissive(C.indWhite, { normal: { color: 0xfff0d8, intensity: 0.7 }, emergency: { color: 0x000000, intensity: 0 } });
    L.addEmissive(C.indBlue, { normal: { color: 0x5ab4ff, intensity: 1.4 }, emergency: { color: 0x000000, intensity: 0 } });
    L.addEmissive(C.indBackup, { normal: { color: 0x000000, intensity: 0 }, emergency: { color: 0xff2a1a, intensity: 2.2 } });
    L.addEmissive(C.milk, { normal: { color: 0xcfe2e8, intensity: 0.32 }, emergency: { color: 0x9fb8c2, intensity: 0.14 } });
    L.addEmissive(C.scanRing, { normal: { color: 0x7fe6ff, intensity: 0.6 }, emergency: { color: 0x000000, intensity: 0 } });
  }
  return crewMats;
}

// ---------------------------------------------------------------------------
// Köşe renkli geometri
// ---------------------------------------------------------------------------
const _col = new THREE.Color();
/** Geometriye tek renk köşe rengi ekler (vc malzemeleriyle birleştirme için şart). */
export function colorize(geometry, color) {
  _col.set(color);
  const n = geometry.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = _col.r;
    arr[i * 3 + 1] = _col.g;
    arr[i * 3 + 2] = _col.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geometry;
}

/** Renkli kutu (varsayılan malzeme: crew vc). */
export function vBox(parent, { size = [1, 1, 1], color = 0xffffff, matte = false, material, ...opts }) {
  const g = colorize(new THREE.BoxGeometry(size[0], size[1], size[2]), color);
  return addMesh(parent, g, material ?? (matte ? crewMaterials().vcMatte : crewMaterials().vc), opts);
}

/** Renkli silindir. */
export function vCyl(parent, { radius = 0.05, radiusTop, radiusBottom, height = 0.1, segments = 10, color = 0xffffff, matte = false, material, ...opts }) {
  const g = colorize(new THREE.CylinderGeometry(radiusTop ?? radius, radiusBottom ?? radius, height, segments), color);
  return addMesh(parent, g, material ?? (matte ? crewMaterials().vcMatte : crewMaterials().vc), opts);
}

// ---------------------------------------------------------------------------
// Etiket atlası: tüm şablon yazılar tek dokuda → tek çizim çağrısı
// ---------------------------------------------------------------------------
class LabelAtlas {
  constructor() {
    this.size = 1024;
    this.rowH = 64;
    this.pages = [];
    this.cache = new Map();
    if (HAS_DOM) this._newPage();
  }

  _newPage() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = this.size;
    const g = canvas.getContext('2d');
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.45, roughness: 0.85, metalness: 0 });
    mat.name = `crewLabels${this.pages.length}`;
    this.page = { canvas, g, tex, mat, x: 0, y: 0 };
    this.pages.push(this.page);
  }

  _alloc(w) {
    let p = this.page;
    if (p.x + w > this.size) {
      p.x = 0;
      p.y += this.rowH;
    }
    if (p.y + this.rowH > this.size) {
      this._newPage();
      p = this.page;
    }
    const r = { x: p.x, y: p.y, w, page: p };
    p.x += w;
    return r;
  }

  /** Etiket hücresini çizer (önbellekli). */
  cell(text, { color = '#1c1c1c', bg = null, border = null, weight = 'bold', mono = false }) {
    const key = [text, color, bg, border, weight, mono].join('|');
    if (this.cache.has(key)) return this.cache.get(key);
    const px = 40;
    const font = `${weight} ${px}px ${mono ? '"DejaVu Sans Mono", monospace' : '"DejaVu Sans Condensed", "Liberation Sans Narrow", "Arial Narrow", "DejaVu Sans", sans-serif'}`;
    const g = this.page.g;
    g.font = font;
    const tw = g.measureText(text).width;
    const pad = bg ? 16 : 6;
    const w = Math.min(this.size, Math.ceil((tw + pad * 2) / 16) * 16);
    const c = this._alloc(w);
    const pg = c.page.g;
    pg.save();
    pg.clearRect(c.x, c.y, w, this.rowH);
    pg.beginPath();
    pg.rect(c.x + 1, c.y + 1, w - 2, this.rowH - 2);
    pg.clip();
    if (bg) {
      pg.fillStyle = bg;
      pg.fillRect(c.x + 2, c.y + 4, w - 4, this.rowH - 8);
    }
    if (border) {
      pg.strokeStyle = border;
      pg.lineWidth = 3;
      pg.strokeRect(c.x + 5, c.y + 7, w - 10, this.rowH - 14);
    }
    pg.font = font;
    pg.fillStyle = color;
    pg.textBaseline = 'middle';
    pg.textAlign = 'center';
    const sx = Math.min(1, (w - pad * 2) / Math.max(1, tw));
    pg.translate(c.x + w / 2, c.y + this.rowH / 2 + 2);
    pg.scale(sx, 1);
    pg.fillText(text, 0, 0);
    pg.restore();
    c.page.tex.needsUpdate = true;
    this.cache.set(key, c);
    return c;
  }
}

let atlas = null;
function getAtlas() {
  if (!atlas) atlas = new LabelAtlas();
  return atlas;
}

/**
 * Şablon etiket/yazı ekler. Ön yüz +Z (yerel). Yükseklik metre; genişlik metinden hesaplanır.
 *   label(group, 'BASINÇ', { pos: [x, y, z], rot: [0, Math.PI, 0], height: 0.05, color: '#222', bg: '#d8a21a' })
 */
export function label(parent, text, { pos = [0, 0, 0], rot = [0, 0, 0], height = 0.05, width, color = '#1c1c1c', bg = null, border = null, weight = 'bold', mono = false } = {}) {
  if (!HAS_DOM) return null;
  const A = getAtlas();
  const c = A.cell(String(text), { color, bg, border, weight, mono });
  const aspect = c.w / A.rowH;
  const w = width ?? height * aspect;
  const geo = new THREE.PlaneGeometry(w, height);
  const uv = geo.attributes.uv;
  const S = A.size;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    uv.setXY(i, (c.x + u * c.w) / S, 1 - (c.y + (1 - v) * A.rowH) / S);
  }
  const m = addMesh(parent, geo, c.page.mat, { pos, rot });
  m.userData.noShadow = true;
  return m;
}

// ---------------------------------------------------------------------------
// Canvas resimleri (fotoğraflar, çizimler) — anahtar başına bir malzeme
// ---------------------------------------------------------------------------
const pictureCache = new Map();
export function pictureMaterial(key, draw, w = 256, h = 192, { emissive = 0 } = {}) {
  if (pictureCache.has(key)) return pictureCache.get(key);
  let mat;
  if (HAS_DOM) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    draw(g, w, h);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0 });
    if (emissive) {
      mat.emissive = new THREE.Color(0xffffff);
      mat.emissiveMap = tex;
      mat.emissiveIntensity = emissive;
    }
  } else {
    mat = new THREE.MeshStandardMaterial({ color: 0x888888 });
  }
  mat.name = `crewPic:${key}`;
  pictureCache.set(key, mat);
  return mat;
}

/**
 * Duvara iliştirilmiş fotoğraf/çizim (beyaz kenarlı baskı + bant). Ön yüz +Z.
 */
export function addPicture(parent, { key, draw, pos = [0, 0, 0], rot = [0, 0, 0], w = 0.24, h = 0.18, border = 0.012, tape = true, tilt = 0, res = [256, 192] }) {
  const g = new THREE.Group();
  g.position.set(pos[0], pos[1], pos[2]);
  g.rotation.set(rot[0], rot[1], rot[2] + tilt);
  parent.add(g);
  vBox(g, { size: [w + border * 2, h + border * 2, 0.003], color: 0xece6d6, matte: true, pos: [0, 0, 0.0015] });
  addMesh(g, new THREE.PlaneGeometry(w, h), pictureMaterial(key, draw, res[0], res[1]), { pos: [0, 0, 0.0035] });
  if (tape) {
    vBox(g, { size: [0.05, 0.018, 0.001], color: 0xd9cfa5, matte: true, pos: [-w / 2 + 0.01, h / 2 + 0.004, 0.0045], rot: [0, 0, 0.6] });
    vBox(g, { size: [0.05, 0.018, 0.001], color: 0xd9cfa5, matte: true, pos: [w / 2 - 0.01, h / 2 + 0.004, 0.0045], rot: [0, 0, -0.6] });
  }
  return g;
}

// ---------------------------------------------------------------------------
// Ekranlar
// ---------------------------------------------------------------------------
/**
 * Çerçeveli CRT ekran ekler. Ön yüz +Z (yerel). Statik kalabilir: malzeme birleştirmede korunur.
 * @returns createScreen nesnesi + { mesh, group }
 */
export function addScreen(parent, { pos = [0, 0, 0], rot = [0, 0, 0], w = 0.36, h = 0.24, res, color = '#52ff7a', background = '#020602', bezel = 0.022, depth = 0.06, bezelMaterial, hood = false, name } = {}) {
  const rw = res?.[0] ?? Math.min(512, Math.round((w / Math.max(w, h)) * 256 / 16) * 16 || 256);
  const rh = res?.[1] ?? Math.min(512, Math.round(rw * (h / w) / 8) * 8);
  const scr = createScreen({ width: rw, height: rh, color, background });
  const g = new THREE.Group();
  g.position.set(pos[0], pos[1], pos[2]);
  g.rotation.set(rot[0], rot[1], rot[2]);
  if (name) g.name = name;
  parent.add(g);
  const bm = bezelMaterial ?? crewMaterials().consoleEdge;
  addBox(g, { size: [w + bezel * 2, h + bezel * 2, depth], pos: [0, 0, -depth / 2], material: bm });
  if (hood) {
    addBox(g, { size: [w + bezel * 2, 0.012, 0.05], pos: [0, h / 2 + bezel - 0.006, 0.025], material: bm });
    addBox(g, { size: [0.012, h + bezel * 2, 0.05], pos: [-(w / 2 + bezel - 0.006), 0, 0.025], material: bm });
    addBox(g, { size: [0.012, h + bezel * 2, 0.05], pos: [w / 2 + bezel - 0.006, 0, 0.025], material: bm });
  }
  const mesh = addMesh(g, new THREE.PlaneGeometry(w, h), scr.material, { pos: [0, 0, 0.002] });
  mesh.userData.noShadow = true;
  scr.mesh = mesh;
  scr.group = g;
  scr.on = true;
  return scr;
}

/** Enerji yokken ekran görünümü. */
export function drawNoPower(scr, text = 'ENERJİ YOK') {
  scr.draw((g, w, h) => {
    g.fillStyle = '#050101';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#6a1a12';
    g.font = `bold ${Math.round(h / 7)}px monospace`;
    g.textAlign = 'center';
    g.fillText(text, w / 2, h / 2 - h / 14);
    g.textAlign = 'left';
  });
  scr.material.emissiveIntensity = 0.7;
}

/** Ekranı tamamen karartır. */
export function drawBlank(scr) {
  scr.draw((g, w, h) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
  });
}

/**
 * Bir modülün ekranlarını sürer: enerji/durum değişince bir kez, oyuncu yakındayken `hz` sıklıkla çizer.
 *   draw(t, powered, dt)
 */
export function screenDriver(mctx, { hz = 8, draw, near }) {
  const isNear = near ?? (() => mctx.player.location.index === mctx.index);
  let acc = 0;
  let last = 0;
  const run = (t) => {
    try {
      draw(t, mctx.state.is('power_restored'), t - last);
    } catch (err) {
      console.error(`[${mctx.id}] ekran çizim hatası:`, err);
    }
    last = t;
  };
  run(0);
  mctx.bus.on('state:changed', () => run(mctx.engine.time));
  mctx.onUpdate((dt, t) => {
    if (!isNear()) return;
    acc += dt;
    if (acc < 1 / hz) return;
    acc = 0;
    run(t);
  });
  return { redraw: () => run(mctx.engine.time) };
}

/** Ekran çizim yardımcıları (g = CanvasRenderingContext2D). */
export const draw2d = {
  header(g, w, h, text, color, right = '') {
    const hh = Math.round(h * 0.14);
    g.fillStyle = color;
    g.globalAlpha = 0.85;
    g.fillRect(0, 0, w, hh);
    g.globalAlpha = 1;
    g.fillStyle = '#000';
    g.font = `bold ${Math.round(hh * 0.72)}px monospace`;
    g.textBaseline = 'middle';
    g.fillText(text, 6, hh / 2 + 1);
    if (right) {
      g.textAlign = 'right';
      g.fillText(right, w - 6, hh / 2 + 1);
      g.textAlign = 'left';
    }
    g.textBaseline = 'top';
    g.fillStyle = color;
    return hh;
  },
  text(g, str, x, y, size, color, align = 'left') {
    g.fillStyle = color;
    g.font = `${size}px monospace`;
    g.textAlign = align;
    g.fillText(str, x, y);
    g.textAlign = 'left';
  },
  bar(g, x, y, w, h, frac, color) {
    g.strokeStyle = color;
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    g.fillStyle = color;
    g.fillRect(x + 2, y + 2, Math.max(0, (w - 4) * THREE.MathUtils.clamp(frac, 0, 1)), h - 4);
  },
  /** Kaydırmalı EKG / nabız eğrisi */
  ecg(g, x, y, w, h, t, bpm, color, flat = false) {
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.beginPath();
    const period = 60 / Math.max(1, bpm);
    for (let i = 0; i <= w; i += 2) {
      const tt = t - (w - i) * 0.012;
      let v = 0;
      if (!flat) {
        const ph = ((tt % period) + period) % period / period;
        if (ph < 0.08) v = Math.sin((ph / 0.08) * Math.PI) * 0.12;
        else if (ph > 0.16 && ph < 0.19) v = -0.15;
        else if (ph >= 0.19 && ph < 0.23) v = 1.0 - Math.abs(ph - 0.21) * 40;
        else if (ph >= 0.23 && ph < 0.26) v = -0.25;
        else if (ph > 0.4 && ph < 0.55) v = Math.sin(((ph - 0.4) / 0.15) * Math.PI) * 0.22;
      }
      const py = y + h * 0.6 - v * h * 0.5;
      if (i === 0) g.moveTo(x + i, py);
      else g.lineTo(x + i, py);
    }
    g.stroke();
  },
  /** Basit çizgi grafiği: values 0..1 */
  spark(g, x, y, w, h, values, color) {
    g.strokeStyle = color;
    g.lineWidth = 1.5;
    g.beginPath();
    values.forEach((v, i) => {
      const px = x + (i / Math.max(1, values.length - 1)) * w;
      const py = y + h - THREE.MathUtils.clamp(v, 0, 1) * h;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    });
    g.stroke();
  },
};

// ---------------------------------------------------------------------------
// Yapısal ayrıntılar
// ---------------------------------------------------------------------------
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** İki nokta arasında silindir (boru, korkuluk, çubuk). */
export function addRod(parent, a, b, { radius = 0.018, material, segments = 8, ...opts } = {}) {
  _a.set(a[0], a[1], a[2]);
  _b.set(b[0], b[1], b[2]);
  const len = _a.distanceTo(_b);
  const geo = new THREE.CylinderGeometry(radius, radius, len, segments);
  const m = addMesh(parent, geo, material, opts);
  m.position.copy(_a).add(_b).multiplyScalar(0.5);
  _q.setFromUnitVectors(UP, _b.sub(_a).normalize());
  m.quaternion.copy(_q);
  return m;
}

/**
 * Tutunma korkuluğu: a→b boyunca boru + duvara giden ayaklar.
 * `out` korkuluğun duvardan dışarı uzaklığı yönü (ör. [0,0,1] dış duvar için).
 */
export function addRail(parent, a, b, { material, radius = 0.017, standoffs = 3, out = [0, 0, 1], depth = 0.07, bracketMaterial } = {}) {
  addRod(parent, a, b, { radius, material, segments: 8 });
  for (let i = 0; i < standoffs; i++) {
    const t = standoffs === 1 ? 0.5 : 0.08 + (i / (standoffs - 1)) * 0.84;
    const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const q = [p[0] - out[0] * depth, p[1] - out[1] * depth, p[2] - out[2] * depth];
    addRod(parent, p, q, { radius: radius * 0.7, material: bracketMaterial ?? material, segments: 6 });
  }
}

/** Sarkık kablo / hortum (CatmullRom boyunca tüp). points: [[x,y,z], ...] */
export function addHose(parent, points, { radius = 0.02, material, segments = 20, radial = 6, ...opts } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const geo = new THREE.TubeGeometry(curve, segments, radius, radial, false);
  return addMesh(parent, geo, material, opts);
}

/** a→b arasında sarkan kablo demeti (n kablo). */
export function addCableRun(parent, a, b, { n = 3, sag = 0.12, radius = 0.012, material, spread = 0.03, seed = 3 } = {}) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * spread;
    const s = sag * (0.7 + r() * 0.6);
    const mid = [(a[0] + b[0]) / 2 + off, (a[1] + b[1]) / 2 - s, (a[2] + b[2]) / 2 + off * 0.5];
    addHose(parent, [[a[0] + off, a[1], a[2]], mid, [b[0] + off, b[1], b[2]]], { radius, material, segments: 12, radial: 5 });
  }
}

/** Havalandırma ızgarası (ön yüz +Z). */
export function addVent(parent, { pos, rot = [0, 0, 0], w = 0.4, h = 0.25, slats = 6, frameMaterial, slatMaterial }) {
  const g = new THREE.Group();
  g.position.set(pos[0], pos[1], pos[2]);
  g.rotation.set(rot[0], rot[1], rot[2]);
  parent.add(g);
  addBox(g, { size: [w, h, 0.02], pos: [0, 0, 0.01], material: slatMaterial });
  const f = 0.02;
  addBox(g, { size: [w, f, 0.04], pos: [0, h / 2 - f / 2, 0.02], material: frameMaterial });
  addBox(g, { size: [w, f, 0.04], pos: [0, -h / 2 + f / 2, 0.02], material: frameMaterial });
  addBox(g, { size: [f, h, 0.04], pos: [-w / 2 + f / 2, 0, 0.02], material: frameMaterial });
  addBox(g, { size: [f, h, 0.04], pos: [w / 2 - f / 2, 0, 0.02], material: frameMaterial });
  for (let i = 1; i < slats; i++) {
    addBox(g, { size: [w - 2 * f, 0.008, 0.03], pos: [0, -h / 2 + (i * h) / slats, 0.025], rot: [0.5, 0, 0], material: frameMaterial });
  }
  return g;
}

/**
 * Anahtar paneli: plaka + mekanik anahtarlar (bazıları kapaklı). Ön yüz +Z.
 *   addSwitchBank(g, { pos, rot, cols: 6, rows: 2, guarded: [0, 5], seed })
 */
export function addSwitchBank(parent, { pos, rot = [0, 0, 0], cols = 6, rows = 2, dx = 0.05, dy = 0.075, guarded = [], seed = 7, plate = true, plateMaterial, M, leds = true, caps = true }) {
  const C = crewMaterials();
  const r = rng(seed);
  const g = new THREE.Group();
  g.position.set(pos[0], pos[1], pos[2]);
  g.rotation.set(rot[0], rot[1], rot[2]);
  parent.add(g);
  const W = cols * dx + 0.03;
  const H = rows * dy + 0.02;
  if (plate) {
    addBox(g, { size: [W, H, 0.012], pos: [0, 0, 0.006], material: plateMaterial ?? C.console });
    // köşe vidaları
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) vCyl(g, { radius: 0.004, height: 0.004, segments: 6, color: 0x8a8a86, pos: [sx * (W / 2 - 0.008), sy * (H / 2 - 0.008), 0.013], rot: [Math.PI / 2, 0, 0] });
  }
  const capColors = [0xd8d4c8, 0xd8d4c8, 0xd8d4c8, 0x1e1e1e, 0xc9a227, 0xb03020];
  let idx = 0;
  for (let ry = 0; ry < rows; ry++) {
    for (let cx = 0; cx < cols; cx++, idx++) {
      const x = -W / 2 + 0.015 + dx * (cx + 0.5);
      const y = H / 2 - 0.01 - dy * (ry + 0.5) - 0.006;
      // somun + kol
      vCyl(g, { radius: 0.007, height: 0.008, segments: 6, color: 0x9a9a96, pos: [x, y, 0.016], rot: [Math.PI / 2, 0, 0] });
      const up = r() > 0.45;
      const lever = vCyl(g, { radius: 0.0032, height: 0.03, segments: 6, color: 0xc8c8c4, pos: [x, y + (up ? 0.008 : -0.008), 0.03], rot: [Math.PI / 2 + (up ? -0.55 : 0.55), 0, 0] });
      lever.userData.noShadow = true;
      if (caps) vBox(g, { size: [0.008, 0.008, 0.008], color: capColors[Math.floor(r() * capColors.length)], pos: [x, y + (up ? 0.015 : -0.015), 0.042] });
      // açıklama şeridi
      vBox(g, { size: [dx * 0.7, 0.008, 0.002], color: 0xe8e2d0, matte: true, pos: [x, y + dy * 0.36, 0.013] });
      if (guarded.includes(idx)) {
        const gc = 0xb02a1c;
        vBox(g, { size: [0.003, 0.03, 0.04], color: gc, pos: [x - 0.013, y, 0.032] });
        vBox(g, { size: [0.003, 0.03, 0.04], color: gc, pos: [x + 0.013, y, 0.032] });
        vBox(g, { size: [0.029, 0.003, 0.04], color: gc, pos: [x, y - 0.0135, 0.032] });
      }
      if (leds && r() > 0.6) {
        const lm = r() > 0.6 ? C.indAmber : C.indGreen;
        addBox(g, { size: [0.006, 0.006, 0.004], pos: [x + dx * 0.32, y + dy * 0.36, 0.014], material: lm });
      }
    }
  }
  return g;
}

/** Bir sıra döner düğme + ibreli gösterge. Ön yüz +Z. */
export function addKnobRow(parent, { pos, rot = [0, 0, 0], n = 4, spacing = 0.07, radius = 0.016, color = 0x1a1a1a, seed = 11 }) {
  const r = rng(seed);
  const g = new THREE.Group();
  g.position.set(pos[0], pos[1], pos[2]);
  g.rotation.set(rot[0], rot[1], rot[2]);
  parent.add(g);
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * spacing;
    vCyl(g, { radius: radius * 1.35, height: 0.003, segments: 12, color: 0xd8d4c8, pos: [x, 0, 0.0015], rot: [Math.PI / 2, 0, 0] });
    vCyl(g, { radius, height: 0.022, segments: 10, color, pos: [x, 0, 0.012], rot: [Math.PI / 2, 0, 0] });
    vBox(g, { size: [0.003, radius * 0.9, 0.003], color: 0xf0ece0, pos: [x, radius * 0.4, 0.024], rot: [0, 0, (r() - 0.5) * 2.4] });
  }
  return g;
}

/** Analog gösterge kadranı (yuvarlak), ön yüz +Z. */
export function addGauge(parent, { pos, rot = [0, 0, 0], radius = 0.035, needle = 0.3, face = 0xe9e4d4, rim = 0x2a2a2a }) {
  const g = new THREE.Group();
  g.position.set(pos[0], pos[1], pos[2]);
  g.rotation.set(rot[0], rot[1], rot[2]);
  parent.add(g);
  vCyl(g, { radius: radius * 1.18, height: 0.012, segments: 16, color: rim, pos: [0, 0, 0.006], rot: [Math.PI / 2, 0, 0] });
  vCyl(g, { radius, height: 0.002, segments: 16, color: face, matte: true, pos: [0, 0, 0.0125], rot: [Math.PI / 2, 0, 0] });
  for (let i = 0; i < 7; i++) {
    const a = -2.2 + (i / 6) * 4.4;
    vBox(g, { size: [0.002, radius * 0.22, 0.001], color: 0x222222, pos: [Math.sin(a) * radius * 0.8, Math.cos(a) * radius * 0.8, 0.0138], rot: [0, 0, -a] });
  }
  const n = vBox(g, { size: [0.0025, radius * 0.75, 0.0015], color: 0xc0281c, pos: [0, 0, 0.0145] });
  n.geometry.translate(0, radius * 0.35, 0);
  n.rotation.z = -needle;
  return g;
}

/**
 * Dolap / kilitli dolap (ön yüz +Z). Yükseklik zeminden.
 */
export function addLocker(parent, { pos, rotY = 0, w = 0.6, h = 2.0, d = 0.5, M, text, seed = 5, doors = 1, vents = true }) {
  const C = crewMaterials();
  const g = new THREE.Group();
  g.position.set(pos[0], pos[1] ?? 0, pos[2]);
  g.rotation.y = rotY;
  parent.add(g);
  addBox(g, { size: [w, h, d - 0.02], pos: [0, h / 2, -0.01], material: M.panelMid, name: 'locker' });
  const dw = (w - 0.03) / doors;
  for (let i = 0; i < doors; i++) {
    const x = -w / 2 + 0.015 + dw * (i + 0.5);
    addBox(g, { size: [dw - 0.012, h - 0.06, 0.02], pos: [x, h / 2, d / 2 - 0.01], material: M.panelLight });
    // kol
    addBox(g, { size: [0.02, 0.16, 0.025], pos: [x + (i % 2 ? -1 : 1) * (dw / 2 - 0.06), h * 0.52, d / 2 + 0.012], material: M.metalDark });
    if (vents) for (let k = 0; k < 4; k++) addBox(g, { size: [dw * 0.5, 0.012, 0.004], pos: [x, h - 0.18 - k * 0.03, d / 2 + 0.001], material: M.panelDark });
  }
  if (text) label(g, text, { pos: [0, h * 0.72, d / 2 + 0.002], height: 0.045, color: '#1d1d1d', bg: '#e8e2cf' });
  return g;
}

/**
 * Oturak (pilot veya mürettebat koltuğu). Ön yüz +Z (oturan kişi +Z'ye bakar).
 * Dönen: { group, soft } — soft: minder grubu (etkileşim nesnesi olarak kullanılabilir)
 */
export function addSeat(parent, { pos, rotY = 0, kind = 'pilot', M }) {
  const C = crewMaterials();
  const g = new THREE.Group();
  g.position.set(pos[0], 0, pos[2]);
  g.rotation.y = rotY;
  parent.add(g);
  const pilot = kind === 'pilot';
  const sw = pilot ? 0.56 : 0.5;
  // ayak + ray
  addBox(g, { size: [0.5, 0.03, 0.62], pos: [0, 0.015, 0], material: M.metalDark });
  addBox(g, { size: [0.04, 0.035, 0.66], pos: [-0.2, 0.035, 0], material: M.metal });
  addBox(g, { size: [0.04, 0.035, 0.66], pos: [0.2, 0.035, 0], material: M.metal });
  addCylinder(g, { radius: 0.07, height: 0.32, segments: 10, pos: [0, 0.2, 0.02], material: M.metalDark });
  addBox(g, { size: [sw + 0.04, 0.06, 0.56], pos: [0, 0.38, 0], material: M.plasticWhite });
  // minderler
  const soft = new THREE.Group();
  soft.name = 'seatSoft';
  g.add(soft);
  addBox(soft, { size: [sw, 0.1, 0.52], pos: [0, 0.46, 0.0], material: M.fabric });
  // sırtlık (geriye yatık)
  const back = new THREE.Group();
  back.position.set(0, 0.42, -0.26);
  back.rotation.x = -0.22;
  g.add(back);
  addBox(back, { size: [sw + 0.04, pilot ? 0.86 : 0.7, 0.07], pos: [0, (pilot ? 0.86 : 0.7) / 2, -0.05], material: M.plasticWhite });
  const bc = addBox(soft, { size: [sw - 0.04, pilot ? 0.72 : 0.6, 0.08], material: M.fabric });
  // sırt minderini sırtlık dönüşüyle hizala (soft grubu koltuk yerel uzayında)
  bc.position.set(0, 0.42 + Math.cos(-0.22) * (pilot ? 0.4 : 0.34), -0.26 + 0.01 + Math.sin(0.22) * -(pilot ? 0.4 : 0.34));
  bc.rotation.x = -0.22;
  if (pilot) {
    // başlık + yan destekler
    addBox(back, { size: [0.3, 0.2, 0.1], pos: [0, 0.98, 0.0], material: M.fabric });
    addBox(back, { size: [0.06, 0.6, 0.14], pos: [-(sw / 2 + 0.02), 0.4, 0.0], material: M.plasticWhite });
    addBox(back, { size: [0.06, 0.6, 0.14], pos: [sw / 2 + 0.02, 0.4, 0.0], material: M.plasticWhite });
    // emniyet kemerleri (omuz + bel)
    for (const sx of [-1, 1]) {
      vBox(back, { size: [0.05, 0.62, 0.006], color: 0x2b2d30, matte: true, pos: [sx * 0.12, 0.42, 0.05], rot: [0, 0, sx * 0.12] });
    }
    vBox(g, { size: [0.05, 0.006, 0.3], color: 0x2b2d30, matte: true, pos: [-0.16, 0.52, 0.06], rot: [0, 0.35, 0] });
    vBox(g, { size: [0.05, 0.006, 0.3], color: 0x2b2d30, matte: true, pos: [0.16, 0.52, 0.06], rot: [0, -0.35, 0] });
    vCyl(g, { radius: 0.045, height: 0.02, segments: 12, color: 0x9a9ca0, pos: [0, 0.53, 0.16] });
  }
  // kolçaklar
  for (const sx of [-1, 1]) {
    addBox(g, { size: [0.06, 0.05, 0.38], pos: [sx * (sw / 2 + 0.05), 0.66, 0.02], material: M.plasticDark });
    addBox(g, { size: [0.04, 0.22, 0.04], pos: [sx * (sw / 2 + 0.05), 0.53, -0.12], material: M.metalDark });
  }
  return { group: g, soft };
}

/**
 * Sırtüstü yatan mürettebat silueti (plastik örtülü). Yerel +X boyunca uzanır, baş -X'te.
 * Sırt y=0'da.
 */
export function createSleeper(material, wrapMaterial, seed = 1) {
  const r = rng(seed);
  const g = new THREE.Group();
  g.name = 'sleeper';
  const cap = (radius, len, pos, rot = [0, 0, Math.PI / 2], scale) => {
    const geo = new THREE.CapsuleGeometry(radius, len, 3, 10);
    return addMesh(g, geo, material, { pos, rot, scale });
  };
  const s = 0.95 + r() * 0.1;
  // baş + boyun
  addMesh(g, new THREE.SphereGeometry(0.1, 12, 10), material, { pos: [-0.8 * s, 0.11, 0], scale: [1.08, 0.95, 0.9] });
  cap(0.05, 0.06, [-0.67 * s, 0.09, 0]);
  // gövde
  cap(0.15, 0.32, [-0.4 * s, 0.11, 0], [0, 0, Math.PI / 2], [1, 0.72, 1.25]);
  cap(0.14, 0.12, [-0.12 * s, 0.1, 0], [0, 0, Math.PI / 2], [1, 0.7, 1.2]);
  // kollar
  for (const sz of [-1, 1]) {
    cap(0.045, 0.24, [-0.46 * s, 0.07, sz * 0.24], [0, sz * 0.05, Math.PI / 2]);
    cap(0.04, 0.22, [-0.15 * s, 0.065, sz * 0.25], [0, -sz * 0.08, Math.PI / 2]);
  }
  // bacaklar
  for (const sz of [-1, 1]) {
    cap(0.07, 0.34, [0.18 * s, 0.08, sz * 0.09], [0, 0, Math.PI / 2]);
    cap(0.055, 0.34, [0.6 * s, 0.065, sz * 0.09], [0, 0, Math.PI / 2]);
    addBox(g, { size: [0.08, 0.11, 0.07], pos: [0.83 * s, 0.1, sz * 0.09], material });
  }
  // plastik örtü
  if (wrapMaterial) {
    const wrap = addMesh(g, new THREE.CapsuleGeometry(0.24, 1.45 * s, 3, 12), wrapMaterial, { pos: [0, 0.09, 0], rot: [0, 0, Math.PI / 2], scale: [0.7, 1, 1.25] });
    wrap.userData.noShadow = true;
  }
  return g;
}

/** Saksı bitkisi (yaprak kümeleri). Taban y=0. */
export function addPlant(parent, { pos, size = 1, seed = 3, pot = 0x6b5a4a, M }) {
  const C = crewMaterials();
  const r = rng(seed);
  const g = new THREE.Group();
  g.position.set(pos[0], pos[1] ?? 0, pos[2]);
  parent.add(g);
  const ph = 0.28 * size;
  vCyl(g, { radiusTop: 0.16 * size, radiusBottom: 0.12 * size, height: ph, segments: 12, color: pot, matte: true, pos: [0, ph / 2, 0] });
  addCylinder(g, { radius: 0.15 * size, height: 0.02, segments: 12, pos: [0, ph - 0.01, 0], material: C.soil });
  const leaf = new THREE.PlaneGeometry(0.09 * size, 0.28 * size);
  leaf.translate(0, 0.14 * size, 0);
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.4;
    const m = addMesh(g, leaf, r() > 0.5 ? C.plant : C.plantDark, {
      pos: [Math.cos(a) * 0.03, ph, Math.sin(a) * 0.03],
      rot: [0, 0, 0],
    });
    m.rotation.set(0, -a, 0);
    m.rotateZ(-(0.35 + r() * 0.6));
    m.scale.setScalar(0.7 + r() * 0.6);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Oynanış yardımcıları
// ---------------------------------------------------------------------------
/** Görünmez etkileşim vekili (küçük nesneleri kolay hedeflemek için). */
export function addProxy(parent, { size, pos, rot, name }) {
  const m = addBox(parent, { size, pos, rot, material: crewMaterials().proxy, name });
  m.userData.dynamic = true;
  m.castShadow = false;
  return m;
}

/**
 * Oyuncu kamerasını kısa süre sarsar (player.pitch/yaw'a küçük, sönen titreşim; net etkisi sıfır).
 */
export function shakePlayer(mctx, { duration = 3.5, amplitude = 0.006, freq = 9 } = {}) {
  const player = mctx.player;
  let t = 0;
  let pp = 0;
  let py = 0;
  const off = mctx.onUpdate((dt) => {
    t += dt;
    const fadeIn = Math.min(1, t / 0.35);
    const k = Math.max(0, 1 - t / duration) * fadeIn;
    const p = (Math.sin(t * freq * 6.1) * 0.6 + Math.sin(t * freq * 9.7 + 1.3) * 0.4) * amplitude * k;
    const y = (Math.sin(t * freq * 5.3 + 0.5) * 0.6 + Math.sin(t * freq * 8.9) * 0.4) * amplitude * 0.7 * k;
    player.pitch += p - pp;
    player.yaw += y - py;
    pp = p;
    py = y;
    if (t >= duration) {
      player.pitch -= pp;
      player.yaw -= py;
      off();
    }
  }, -99);
  return off;
}

/** Terminal açar; ui yoksa ya da hata verirse null döner. */
export function openTerminal(mctx, opts) {
  try {
    return mctx.ui?.openTerminal?.(opts) ?? null;
  } catch (err) {
    console.error(`[${mctx.id}] terminal açılamadı:`, err);
    return null;
  }
}

/** Metni satırlara böler (terminal için). */
export function wrap(text, width = 58) {
  const out = [];
  for (const para of String(text).split('\n')) {
    if (!para.trim()) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      if ((line + ' ' + word).trim().length > width) {
        out.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    if (line) out.push(line);
  }
  return out;
}

/** Ses çal (güvenli). */
export function sfx(mctx, name, opts) {
  try {
    mctx.audio?.play?.(name, opts);
  } catch (err) {
    /* ses isteğe bağlıdır */
  }
}

/** Zamanlayıcılar: oyun zamanına bağlı (duraklatınca durur) basit gecikmeli çağrılar. */
export function createTimers(mctx) {
  const list = [];
  mctx.onUpdate((dt) => {
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      it.t -= dt;
      if (it.t <= 0) {
        list.splice(i, 1);
        try {
          it.fn();
        } catch (err) {
          console.error(`[${mctx.id}] zamanlayıcı hatası:`, err);
        }
      }
    }
  });
  return {
    after(sec, fn) {
      const it = { t: sec, fn };
      list.push(it);
      return () => {
        const i = list.indexOf(it);
        if (i >= 0) list.splice(i, 1);
      };
    },
    clear() {
      list.length = 0;
    },
  };
}

/** Yerel konum → oyuncu gözüne uzaklık (m). */
export function eyeDistance(mctx, local) {
  const p = mctx.playerLocal();
  return Math.hypot(p.x - local[0], 1.65 - local[1], p.z - local[2]);
}

// ---------------------------------------------------------------------------
// Yerleşim ve mobilya yardımcıları (quarters / medical / comms / observation)
// ---------------------------------------------------------------------------
/** Konumlandırılmış boş grup (yerel mobilya kökü). rotY: 0 → ön yüz +Z, Math.PI → ön yüz -Z. */
export function place(parent, pos = [0, 0, 0], rotY = 0, name) {
  const g = new THREE.Group();
  g.position.set(pos[0], pos[1] ?? 0, pos[2]);
  g.rotation.y = rotY;
  if (name) g.name = name;
  parent.add(g);
  return g;
}

/** Kitap geometrisi (köşe renkli kutu). Sırt +Z yüzünde. */
export function bookGeometry(w, h, d, color) {
  return colorize(new THREE.BoxGeometry(w, h, d), color);
}

export const BOOK_COLORS = [0x7a2e24, 0x2f4a63, 0x3d5a3a, 0x8a6a2a, 0x4a3a5a, 0x6b6257, 0xa0522d, 0x23323f, 0x7b5434, 0x58634a, 0x9a3b2c, 0x394a5d];

/** Dönen büro koltuğu. Oturan kişi +Z'ye bakar. */
export function addChair(parent, { pos, rotY = 0, M, color = 0x2f3b4c, tilt = 0 }) {
  const g = place(parent, pos, rotY);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    addRod(g, [0, 0.1, 0], [Math.cos(a) * 0.27, 0.045, Math.sin(a) * 0.27], { radius: 0.014, material: M.metalDark, segments: 6 });
    vCyl(g, { radius: 0.025, height: 0.03, segments: 8, color: 0x111111, pos: [Math.cos(a) * 0.27, 0.02, Math.sin(a) * 0.27] });
  }
  addCylinder(g, { radius: 0.028, height: 0.3, segments: 8, pos: [0, 0.25, 0], material: M.metal });
  vBox(g, { size: [0.46, 0.07, 0.44], color, matte: true, pos: [0, 0.47, 0] });
  const back = place(g, [0, 0.5, -0.22]);
  back.rotation.x = -0.14 + tilt;
  vBox(back, { size: [0.44, 0.46, 0.06], color, matte: true, pos: [0, 0.3, 0] });
  addBox(back, { size: [0.04, 0.2, 0.04], pos: [0, 0.05, 0.02], material: M.metalDark });
  for (const sx of [-1, 1]) addBox(g, { size: [0.04, 0.03, 0.26], pos: [sx * 0.26, 0.66, -0.02], material: M.plasticDark });
  for (const sx of [-1, 1]) addBox(g, { size: [0.03, 0.16, 0.03], pos: [sx * 0.26, 0.58, 0.04], material: M.plasticDark });
  return g;
}

/** Çalışma masası (yan çekmeceli). Ön yüz +Z (oturan kişi +Z tarafında). */
export function addDesk(parent, { pos, rotY = 0, w = 1.6, d = 0.7, h = 0.76, M, drawers = true, topMaterial }) {
  const C = crewMaterials();
  const g = place(parent, pos, rotY);
  addBox(g, { size: [w, 0.04, d], pos: [0, h - 0.02, 0], material: topMaterial ?? M.panelLight });
  addBox(g, { size: [w + 0.01, 0.012, 0.012], pos: [0, h - 0.045, d / 2], material: M.rubber });
  addBox(g, { size: [0.04, h - 0.04, d - 0.04], pos: [-w / 2 + 0.02, (h - 0.04) / 2, 0], material: M.panelMid });
  addBox(g, { size: [w - 0.04, h * 0.55, 0.02], pos: [0, h * 0.72 - 0.02, -d / 2 + 0.03], material: M.panelMid });
  if (drawers) {
    const dw = 0.44;
    addBox(g, { size: [dw, h - 0.04, d - 0.04], pos: [w / 2 - dw / 2 - 0.02, (h - 0.04) / 2, 0], material: M.panelMid });
    for (let i = 0; i < 3; i++) {
      const y = 0.15 + i * 0.2;
      addBox(g, { size: [dw - 0.04, 0.17, 0.016], pos: [w / 2 - dw / 2 - 0.02, y + 0.02, d / 2 - 0.01], material: M.panelLight });
      addBox(g, { size: [0.14, 0.014, 0.02], pos: [w / 2 - dw / 2 - 0.02, y + 0.08, d / 2 + 0.006], material: M.metalDark });
    }
  } else {
    addBox(g, { size: [0.04, h - 0.04, d - 0.04], pos: [w / 2 - 0.02, (h - 0.04) / 2, 0], material: M.panelMid });
  }
  vBox(g, { size: [w, 0.03, 0.04], color: 0x222426, pos: [0, 0.03, d / 2 - 0.1] });
  void C;
  return g;
}

/** Sunucu / ekipman rafı (ön yüz +Z). LED'ler paylaşılan göstergelerle (güç moduna bağlı). */
export function addRack(parent, { pos, rotY = 0, w = 0.7, h = 2.0, d = 0.55, M, seed = 5, units = 8, text }) {
  const C = crewMaterials();
  const r = rng(seed);
  const g = place(parent, pos, rotY);
  addBox(g, { size: [w, h, d - 0.04], pos: [0, h / 2, -0.02], material: M.panelDark });
  const uh = (h - 0.3) / units;
  for (let k = 0; k < units; k++) {
    const y = 0.15 + uh * (k + 0.5);
    addBox(g, { size: [w - 0.06, uh - 0.015, 0.02], pos: [0, y, d / 2 - 0.03], material: r() > 0.5 ? C.console : M.metalDark });
    vBox(g, { size: [w * 0.34, uh * 0.4, 0.008], color: 0x121416, pos: [-w * 0.2, y, d / 2 - 0.016] });
    const n = 3 + Math.floor(r() * 5);
    for (let j = 0; j < n; j++) addBox(g, { size: [0.011, 0.011, 0.006], pos: [w * 0.05 + j * 0.026, y + uh * 0.18, d / 2 - 0.018], material: r() > 0.7 ? C.indAmber : C.indGreen });
    addBox(g, { size: [0.016, uh * 0.5, 0.02], pos: [w * 0.4, y, d / 2 - 0.012], material: M.metal });
  }
  if (text) label(g, text, { pos: [0, h - 0.07, d / 2 - 0.018], height: 0.04, color: '#e8e2d0' });
  return g;
}

/**
 * Yanıp sönen gösterge malzemesi (modüle özel; enerji yokken sönük). Oyuncu yakınken `update` ile sürülür.
 * Dönen: { material, update(t, powered) }
 */
export function createBlinker(color, { period = 1.2, duty = 0.5, base = 1.6, phase = 0 } = {}) {
  const material = new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.4, emissive: color, emissiveIntensity: 0 });
  material.name = 'crewBlinker';
  return {
    material,
    update(t, powered) {
      const on = powered && (((t + phase) % period) / period < duty);
      material.emissiveIntensity = on ? base : powered ? base * 0.08 : 0;
    },
  };
}

/** Küçük ekran: kapak açıkken yatan/dikey sıvı torbası vb. için saydam plastik malzeme. */
let _bag = null;
export function bagMaterial() {
  if (!_bag) {
    _bag = new THREE.MeshStandardMaterial({ color: 0xdbe9ee, roughness: 0.2, metalness: 0, transparent: true, opacity: 0.55, depthWrite: false });
    _bag.name = 'crewBag';
  }
  return _bag;
}

/** İki nokta arasında esnek (damlayan) hortum — yerel noktalar. */
export function addTube(parent, a, b, { sag = 0.15, radius = 0.006, material, segments = 14 } = {}) {
  const mid = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - sag, (a[2] + b[2]) / 2];
  return addHose(parent, [a, mid, b], { radius, material, segments, radial: 5 });
}
