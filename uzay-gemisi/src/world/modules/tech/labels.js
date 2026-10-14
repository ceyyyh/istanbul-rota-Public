import * as THREE from 'three';
import { addMesh } from '../../utils.js';

/**
 * Şablon (stencil) etiketleri için ortak doku atlası.
 *
 * Tüm teknik modüllerdeki etiketler aynı 1024×1024 canvas sayfalarına çizilir ve aynı malzemeyi
 * kullanır → statik birleştirmede modül başına tek çizim çağrısı. Sayfa dolarsa yeni sayfa açılır.
 *
 *   addLabel(group, 'BASINÇ', { pos: [x, y, z], rot: [0, Math.PI, 0], height: 0.1, style: 'stencil' })
 *
 * Stiller: 'stencil' (koyu boya), 'white', 'orange', 'yellow' (saydam zemin üzerine boya),
 *          'warn' (sarı zemin siyah yazı), 'red' (kırmızı zemin beyaz yazı), 'tag' (krem plaka),
 *          'blue' (mavi plaka), 'black' (siyah plaka beyaz yazı)
 */
const SIZE = 1024;
const ROW = 72; // satır yüksekliği (px)
const FONT_PX = 50;
const PAD = 6;
const hasDOM = typeof document !== 'undefined';

const pages = [];
const cache = new Map();

const STYLES = {
  stencil: { fg: '#1f1e1b', bg: null, worn: 0.25 },
  white: { fg: '#e9e5d9', bg: null, worn: 0.2 },
  orange: { fg: '#d2602a', bg: null, worn: 0.2 },
  yellow: { fg: '#d8a21a', bg: null, worn: 0.2 },
  warn: { fg: '#141414', bg: '#d6a019', worn: 0.12 },
  red: { fg: '#f4efe4', bg: '#a3241a', worn: 0.1 },
  tag: { fg: '#1d1d1b', bg: '#ddd6c2', worn: 0.08 },
  blue: { fg: '#f0f0ea', bg: '#2d5684', worn: 0.08 },
  black: { fg: '#e8e4da', bg: '#1b1c1e', worn: 0.06 },
};

function newPage() {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, SIZE, SIZE);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.85,
    metalness: 0,
    alphaTest: 0.45,
    transparent: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  material.name = `tech.labels${pages.length}`;
  const page = { canvas, g, texture, material, x: 0, y: 0 };
  pages.push(page);
  return page;
}

// Basit deterministik rastgele (aşınma lekeleri için)
let seed = 12345;
function rnd() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}

function font(bold = true) {
  return `${bold ? 'bold ' : ''}${FONT_PX}px "DejaVu Sans Condensed", "DejaVu Sans", "Arial Narrow", Arial, sans-serif`;
}

/** Etiketi atlasa çizer (önbellekli) ve UV dikdörtgenini döndürür. */
export function getLabel(text, style = 'stencil') {
  const key = style + '|' + text;
  if (cache.has(key)) return cache.get(key);
  if (!hasDOM) {
    const fake = { page: null, u0: 0, v0: 0, u1: 1, v1: 1, aspect: Math.max(1, text.length * 0.6) };
    cache.set(key, fake);
    return fake;
  }
  const st = STYLES[style] || STYLES.stencil;
  let page = pages[pages.length - 1] || newPage();
  const g = page.g;
  g.font = font();
  const tw = Math.ceil(g.measureText(text).width);
  const padX = st.bg ? 18 : 6;
  const w = Math.min(SIZE - 2 * PAD, tw + padX * 2);
  const h = ROW - PAD;
  if (page.x + w + PAD > SIZE) {
    page.x = 0;
    page.y += ROW;
  }
  if (page.y + ROW > SIZE) {
    page = newPage();
  }
  const pg = page.g;
  const x0 = page.x + PAD;
  const y0 = page.y + PAD / 2;
  pg.save();
  pg.beginPath();
  pg.rect(x0, y0, w, h);
  pg.clip();
  if (st.bg) {
    pg.fillStyle = st.bg;
    pg.fillRect(x0, y0, w, h);
    pg.strokeStyle = 'rgba(0,0,0,0.35)';
    pg.lineWidth = 3;
    pg.strokeRect(x0 + 2, y0 + 2, w - 4, h - 4);
  }
  pg.font = font();
  pg.fillStyle = st.fg;
  pg.textBaseline = 'middle';
  pg.textAlign = 'center';
  // Sığmazsa yatay sıkıştır
  const sx = Math.min(1, (w - padX * 2) / Math.max(1, tw));
  pg.translate(x0 + w / 2, y0 + h / 2 + 2);
  pg.scale(sx, 1);
  pg.fillText(text, 0, 0);
  pg.setTransform(1, 0, 0, 1, 0, 0);
  // Şablon boşlukları / aşınma: rastgele küçük silmeler
  if (st.worn > 0) {
    pg.globalCompositeOperation = st.bg ? 'source-atop' : 'destination-out';
    const n = Math.round((w * h) / 140 * st.worn);
    for (let i = 0; i < n; i++) {
      pg.fillStyle = st.bg ? `rgba(40,35,25,${0.25 + rnd() * 0.3})` : 'rgba(0,0,0,1)';
      pg.fillRect(x0 + rnd() * w, y0 + rnd() * h, 1 + rnd() * 3, 1 + rnd() * 2);
    }
    pg.globalCompositeOperation = 'source-over';
  }
  pg.restore();
  page.texture.needsUpdate = true;

  const rect = {
    page,
    u0: x0 / SIZE,
    u1: (x0 + w) / SIZE,
    // canvas y aşağı, UV v yukarı
    v0: 1 - (y0 + h) / SIZE,
    v1: 1 - y0 / SIZE,
    aspect: w / h,
  };
  page.x += w + PAD;
  cache.set(key, rect);
  return rect;
}

/**
 * Etiket düzlemi ekler (normal +Z yönünde; `rot` ile çevirin).
 * @returns {THREE.Mesh}
 */
export function addLabel(parent, text, { pos = [0, 0, 0], rot = [0, 0, 0], height = 0.08, style = 'stencil', name } = {}) {
  const L = getLabel(text, style);
  const w = height * L.aspect;
  const geo = new THREE.PlaneGeometry(w, height);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, L.u0 + uv.getX(i) * (L.u1 - L.u0), L.v0 + uv.getY(i) * (L.v1 - L.v0));
  }
  const mat = L.page ? L.page.material : fallbackMaterial();
  const m = addMesh(parent, geo, mat, { pos, rot, name });
  m.userData.noShadow = true;
  return m;
}

let fallback = null;
function fallbackMaterial() {
  if (!fallback) fallback = new THREE.MeshStandardMaterial({ color: 0x222222 });
  return fallback;
}

/** Etiketin verilen yükseklikteki genişliği (yerleşim hesapları için). */
export function labelWidth(text, height, style = 'stencil') {
  return getLabel(text, style).aspect * height;
}
