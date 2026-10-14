import * as THREE from 'three';

/**
 * Prosedürel canvas dokuları (Ajan 1 — Yapı).
 * Başlangıçta BİR KEZ üretilir (materials.js çağırır). Hepsi döşenebilir (tileable):
 * kenarları dikişsiz birleşir, bu yüzden metre tabanlı UV ile (bkz. kit.js) büyük
 * yüzeylerde tekrarlanabilir.
 *
 * Her üretici { map, normalMap, roughnessMap } döndürür (bazıları eksik olabilir).
 * roughnessMap değerleri MUTLAK pürüzlülüktür → malzemede roughness = 1 kullanın.
 */

export const HAS_DOM = typeof document !== 'undefined' && typeof document.createElement === 'function';

export function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  // CPU destekli bağlam: getImageData/putImageData GPU geri okumasına takılmaz (üretim çok hızlanır)
  c.getContext('2d', { willReadFrequently: true });
  return c;
}

/** Tohumlu sözde-rastgele üreteç (mulberry32). */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Döşenebilir değer gürültüsü: px × py kafes hücresi → Float32Array [0,1]. */
function valueNoise(w, h, px, py, rand) {
  const lat = new Float32Array(px * py);
  for (let i = 0; i < lat.length; i++) lat[i] = rand();
  const out = new Float32Array(w * h);
  const cx = w / px;
  const cy = h / py;
  const X0 = new Int32Array(w);
  const X1 = new Int32Array(w);
  const TX = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const f = x / cx;
    const i = Math.floor(f);
    const t = f - i;
    TX[x] = t * t * (3 - 2 * t);
    X0[x] = i % px;
    X1[x] = (i + 1) % px;
  }
  for (let y = 0; y < h; y++) {
    const f = y / cy;
    const j = Math.floor(f);
    let t = f - j;
    t = t * t * (3 - 2 * t);
    const r0 = (j % py) * px;
    const r1 = ((j + 1) % py) * px;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const tx = TX[x];
      const a = lat[r0 + X0[x]];
      const b = lat[r0 + X1[x]];
      const c = lat[r1 + X0[x]];
      const d = lat[r1 + X1[x]];
      const top = a + (b - a) * tx;
      const bot = c + (d - c) * tx;
      out[row + x] = top + (bot - top) * t;
    }
  }
  return out;
}

/** Fraktal (fBm) gürültü, [0,1]'e germeli. ridged → buruşuk/sırt görünümü. */
export function fbm(w, h, { px = 4, py = px, octaves = 4, gain = 0.5, seed = 1, ridged = false } = {}) {
  const rand = rng(seed);
  const out = new Float32Array(w * h);
  let amp = 1;
  let fx = px;
  let fy = py;
  for (let o = 0; o < octaves; o++) {
    if (fx > w || fy > h) break;
    const n = valueNoise(w, h, fx, fy, rand);
    for (let i = 0; i < out.length; i++) {
      let v = n[i];
      if (ridged) {
        v = 1 - Math.abs(v * 2 - 1);
        v *= v;
      }
      out[i] += v * amp;
    }
    amp *= gain;
    fx *= 2;
    fy *= 2;
  }
  return normalize(out);
}

export function normalize(arr) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] < lo) lo = arr[i];
    if (arr[i] > hi) hi = arr[i];
  }
  const k = hi > lo ? 1 / (hi - lo) : 0;
  for (let i = 0; i < arr.length; i++) arr[i] = (arr[i] - lo) * k;
  return arr;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Canvas'ın R kanalını [0,1] yükseklik dizisine çevirir. */
function readHeight(canvas) {
  const { width: w, height: h } = canvas;
  const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4] / 255;
  return out;
}

/** Yükseklikten teğet-uzayı normal haritası (döşenebilir sarma ile). */
function heightToNormal(hgt, w, h, strength = 2) {
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const yu = ((y - 1 + h) % h) * w;
    const yd = ((y + 1) % h) * w;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const l = hgt[row + ((x - 1 + w) % w)];
      const r = hgt[row + ((x + 1) % w)];
      const u = hgt[yu + x];
      const dn = hgt[yd + x];
      let nx = (l - r) * strength;
      let ny = (dn - u) * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (row + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** fn(x, y, i) → [r, g, b] (0..255) ile piksel piksel canvas doldurur. */
function paint(w, h, fn) {
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  const d = img.data;
  const px = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      fn(x, y, i, px);
      const k = i * 4;
      d[k] = px[0];
      d[k + 1] = px[1];
      d[k + 2] = px[2];
      d[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * Kenara taşan çizimleri sararak döşenebilir çizer. bb = [x0, y0, x1, y1] verilirse yalnızca
 * tuvale değen kopyalar çizilir (hız).
 */
function wrapDraw(g, w, h, fn, bb) {
  for (const ox of [-w, 0, w]) {
    for (const oy of [-h, 0, h]) {
      if (bb && (bb[2] + ox < 0 || bb[0] + ox > w || bb[3] + oy < 0 || bb[1] + oy > h)) continue;
      g.save();
      g.translate(ox, oy);
      fn(g);
      g.restore();
    }
  }
}

/** Yükseklik dizisine döşenebilir (sarmalı) küçük kutu bulanıklığı. px: ~yarıçap (piksel). */
function blurArr(src, w, h, px = 1) {
  const passes = Math.max(1, Math.round(px));
  const side = Math.min(1, px / passes);
  const norm = 1 / (1 + 2 * side);
  let a = src;
  let b = new Float32Array(src.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        b[row + x] = (a[row + x] + side * (a[row + ((x + w - 1) % w)] + a[row + ((x + 1) % w)])) * norm;
      }
    }
    const c = a === src ? new Float32Array(src.length) : a;
    for (let y = 0; y < h; y++) {
      const up = ((y + h - 1) % h) * w;
      const dn = ((y + 1) % h) * w;
      const row = y * w;
      for (let x = 0; x < w; x++) c[row + x] = (b[row + x] + side * (b[up + x] + b[dn + x])) * norm;
    }
    a = c;
  }
  return a;
}

export function toTexture(canvas, { srgb = false, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  return t;
}

function pack(color, heightArr, w, h, rough, normalStrength) {
  return {
    map: color ? toTexture(color, { srgb: true }) : null,
    normalMap: heightArr ? toTexture(heightToNormal(heightArr, w, h, normalStrength)) : null,
    roughnessMap: rough ? toTexture(rough) : null,
  };
}

const gray = (v) => {
  const c = Math.max(0, Math.min(255, Math.round(v * 255)));
  return `rgb(${c},${c},${c})`;
};

// ---------------------------------------------------------------------------
// İç duvar paneli: tek panel / döşeme, eğimli derz, köşe vidaları, hafif kir.
// ---------------------------------------------------------------------------
export function panelTextures(S = 512, seed = 11) {
  const hc = makeCanvas(S);
  const hg = hc.getContext('2d');
  hg.fillStyle = gray(0.7);
  hg.fillRect(0, 0, S, S);
  const b = S / 64;
  for (let k = 0; k < 5; k++) {
    hg.strokeStyle = gray(0.12 + k * 0.13);
    hg.lineWidth = (5 - k) * b * 0.9;
    hg.strokeRect(0, 0, S, S);
  }
  hg.strokeStyle = gray(0.55);
  hg.lineWidth = b * 0.5;
  hg.strokeRect(S * 0.09, S * 0.09, S * 0.82, S * 0.82);
  const sr = S * 0.012;
  for (const [x, y] of [[0.045, 0.045], [0.955, 0.045], [0.045, 0.955], [0.955, 0.955], [0.5, 0.045], [0.5, 0.955]]) {
    hg.fillStyle = gray(0.95);
    hg.beginPath();
    hg.arc(x * S, y * S, sr, 0, Math.PI * 2);
    hg.fill();
    hg.fillStyle = gray(0.5);
    hg.fillRect(x * S - sr, y * S - sr * 0.2, sr * 2, sr * 0.4);
  }
  const hgt = blurArr(readHeight(hc), S, S, S / 512);
  const grime = fbm(S, S, { px: 3, octaves: 5, seed });
  const fine = fbm(S, S, { px: 32, octaves: 2, seed: seed + 1 });
  const color = paint(S, S, (x, y, i, o) => {
    const h = hgt[i];
    let v = 0.97 - (grime[i] - 0.5) * 0.09 - (fine[i] - 0.5) * 0.04;
    v *= 0.55 + 0.45 * smooth(0.1, 0.6, h);
    // alt kenara doğru hafif kir birikimi (döşemede tekrarlar)
    o[0] = v * 255;
    o[1] = v * 252;
    o[2] = v * 246;
  });
  const rough = paint(S, S, (x, y, i, o) => {
    const v = 0.62 + (grime[i] - 0.5) * 0.25 + (1 - smooth(0.1, 0.6, hgt[i])) * 0.2;
    o[0] = o[1] = o[2] = clamp01(v) * 255;
  });
  return pack(color, hgt, S, S, rough, 2.2);
}

// ---------------------------------------------------------------------------
// Dolgulu (kapitone) iç duvar: dikişli yastıklar, kumaş kırışıklığı, kir.
// ---------------------------------------------------------------------------
export function quiltTextures(S = 512, seed = 21) {
  const cols = 2;
  const rows = 2;
  const cw = S / cols;
  const ch = S / rows;
  const wr = fbm(S, S, { px: 16, octaves: 3, seed });
  const grime = fbm(S, S, { px: 2, octaves: 5, seed: seed + 3 });
  const hgt = new Float32Array(S * S);
  const stitch = new Uint8Array(S * S);
  const sInset = S / 64;
  const dash = Math.max(3, Math.round(S / 96));
  for (let y = 0; y < S; y++) {
    const v = (y % ch) / ch;
    const ey = Math.abs(v * 2 - 1);
    for (let x = 0; x < S; x++) {
      const u = (x % cw) / cw;
      const ex = Math.abs(u * 2 - 1);
      let p = (1 - ex ** 5) * (1 - ey ** 5);
      p = Math.sqrt(Math.max(0, p));
      const i = y * S + x;
      hgt[i] = 0.15 + 0.7 * p + (wr[i] - 0.5) * 0.08 * p;
      // dikiş: kenardan sInset içeride kesikli çizgi
      const dx = Math.min(x % cw, cw - (x % cw));
      const dy = Math.min(y % ch, ch - (y % ch));
      const onX = Math.abs(dx - sInset) < 0.9 && dy > sInset && Math.floor(y / dash) % 2 === 0;
      const onY = Math.abs(dy - sInset) < 0.9 && dx > sInset && Math.floor(x / dash) % 2 === 0;
      if (onX || onY) {
        stitch[i] = 1;
        hgt[i] -= 0.12;
      }
    }
  }
  const color = paint(S, S, (x, y, i, o) => {
    const h = hgt[i];
    let v = 0.95 - (grime[i] - 0.5) * 0.1;
    v *= 0.8 + 0.2 * smooth(0.1, 0.5, h);
    if (stitch[i]) v *= 0.7;
    o[0] = v * 255;
    o[1] = v * 250;
    o[2] = v * 238;
  });
  const rough = paint(S, S, (x, y, i, o) => {
    o[0] = o[1] = o[2] = clamp01(0.86 + (grime[i] - 0.5) * 0.1) * 255;
  });
  return pack(color, hgt, S, S, rough, 3.5);
}

// ---------------------------------------------------------------------------
// Dış gövde panelleri: kaydırmalı panel sıraları, perçin dizileri, servis kapakları.
// ---------------------------------------------------------------------------
export function hullPanelTextures(S = 512, seed = 31) {
  const rand = rng(seed);
  const hc = makeCanvas(S);
  const hg = hc.getContext('2d');
  const cc = makeCanvas(S);
  const cg = cc.getContext('2d');
  hg.fillStyle = gray(0.7);
  hg.fillRect(0, 0, S, S);
  cg.fillStyle = gray(0.93);
  cg.fillRect(0, 0, S, S);
  const rows = 4;
  const rh = S / rows;
  const seams = []; // [x0, y0, x1, y1]
  const rivetStep = S / 64;
  for (let r = 0; r < rows; r++) {
    const y0 = r * rh;
    const n = 2 + Math.floor(rand() * 2);
    const off = rand() * S;
    const cuts = [];
    for (let k = 0; k < n; k++) cuts.push((off + (k * S) / n + (rand() - 0.5) * S * 0.12) % S);
    cuts.sort((a, b) => a - b);
    // panel tonları
    for (let k = 0; k < cuts.length; k++) {
      const a = cuts[k];
      const b = k + 1 < cuts.length ? cuts[k + 1] : cuts[0] + S;
      const tone = 0.88 + rand() * 0.1;
      const ht = 0.66 + rand() * 0.08;
      wrapDraw(cg, S, S, (g) => {
        g.fillStyle = gray(tone);
        g.fillRect(a, y0, b - a, rh);
      }, [a, y0, b, y0 + rh]);
      wrapDraw(hg, S, S, (g) => {
        g.fillStyle = gray(ht);
        g.fillRect(a, y0, b - a, rh);
      }, [a, y0, b, y0 + rh]);
      seams.push([a, y0, a, y0 + rh]);
    }
    seams.push([0, y0, S, y0]);
  }
  // derzler
  for (const [x0, y0, x1, y1] of seams) {
    wrapDraw(hg, S, S, (g) => {
      g.strokeStyle = gray(0.15);
      g.lineWidth = S / 256;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    }, [Math.min(x0, x1) - 3, Math.min(y0, y1) - 3, Math.max(x0, x1) + 3, Math.max(y0, y1) + 3]);
    wrapDraw(cg, S, S, (g) => {
      g.strokeStyle = 'rgba(40,40,40,0.55)';
      g.lineWidth = S / 400;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    }, [Math.min(x0, x1) - 3, Math.min(y0, y1) - 3, Math.max(x0, x1) + 3, Math.max(y0, y1) + 3]);
    // perçinler: derzin iki yanında
    const len = Math.hypot(x1 - x0, y1 - y0);
    const nx = (y1 - y0) / len;
    const ny = -(x1 - x0) / len;
    for (let t = rivetStep / 2; t < len; t += rivetStep) {
      const px = x0 + ((x1 - x0) * t) / len;
      const py = y0 + ((y1 - y0) * t) / len;
      for (const side of [-1, 1]) {
        const rx = px + nx * side * S * 0.011;
        const ry = py + ny * side * S * 0.011;
        const rb = [rx - 3, ry - 3, rx + 3, ry + 3];
        wrapDraw(hg, S, S, (g) => {
          g.fillStyle = gray(0.95);
          g.beginPath();
          g.arc(rx, ry, S / 420, 0, Math.PI * 2);
          g.fill();
        }, rb);
        wrapDraw(cg, S, S, (g) => {
          g.fillStyle = 'rgba(120,120,115,0.6)';
          g.beginPath();
          g.arc(rx, ry, S / 520, 0, Math.PI * 2);
          g.fill();
        }, rb);
      }
    }
  }
  // servis kapakları ve küçük plakalar
  for (let k = 0; k < 4; k++) {
    const w = S * (0.06 + rand() * 0.08);
    const h = S * (0.04 + rand() * 0.06);
    const x = rand() * S;
    const y = Math.floor(rand() * rows) * rh + rh * 0.25 + rand() * (rh * 0.5 - h);
    wrapDraw(hg, S, S, (g) => {
      g.strokeStyle = gray(0.3);
      g.lineWidth = S / 300;
      g.strokeRect(x, y, w, h);
      g.fillStyle = gray(0.9);
      for (const [a, b] of [[x + 4, y + 4], [x + w - 4, y + 4], [x + 4, y + h - 4], [x + w - 4, y + h - 4]]) {
        g.beginPath();
        g.arc(a, b, S / 400, 0, Math.PI * 2);
        g.fill();
      }
    });
    if (k % 2 === 0) {
      wrapDraw(cg, S, S, (g) => {
        g.fillStyle = k === 0 ? 'rgba(200,150,40,0.85)' : 'rgba(60,62,66,0.7)';
        g.fillRect(x + w * 0.2, y + h * 0.3, w * 0.6, h * 0.4);
      });
    }
  }
  const hgt = blurArr(readHeight(hc), S, S, Math.max(0.7, S / 700));
  const grime = fbm(S, S, { px: 3, octaves: 5, seed: seed + 7 });
  const streak = fbm(S, S, { px: 24, py: 2, octaves: 3, seed: seed + 9 });
  const base = cc.getContext('2d').getImageData(0, 0, S, S).data;
  const color = paint(S, S, (x, y, i, o) => {
    const k = i * 4;
    const dirt = 1 - (grime[i] - 0.4) * 0.12 - Math.max(0, streak[i] - 0.6) * 0.15;
    o[0] = base[k] * dirt;
    o[1] = base[k + 1] * dirt;
    o[2] = base[k + 2] * dirt * 0.985;
  });
  const rough = paint(S, S, (x, y, i, o) => {
    const k = i * 4;
    o[0] = o[1] = o[2] = clamp01(0.5 + (grime[i] - 0.5) * 0.25 + (base[k] / 255 - 0.9) * 0.8) * 255;
  });
  return pack(color, hgt, S, S, rough, 2.5);
}

// ---------------------------------------------------------------------------
// Altın MLI termal folyo: buruşuk, kırışık çizgili, bant dikişli.
// ---------------------------------------------------------------------------
export function mliTextures(S = 512, seed = 41) {
  const rand = rng(seed);
  const ridge = fbm(S, S, { px: 5, octaves: 5, gain: 0.55, seed, ridged: true });
  const soft = fbm(S, S, { px: 3, octaves: 3, seed: seed + 1 });
  const cc = makeCanvas(S);
  const cg = cc.getContext('2d');
  cg.fillStyle = gray(0.5);
  cg.fillRect(0, 0, S, S);
  for (let k = 0; k < 90; k++) {
    const x = rand() * S;
    const y = rand() * S;
    const a = rand() * Math.PI;
    const l = S * (0.04 + rand() * 0.25);
    const bright = rand() > 0.5;
    wrapDraw(cg, S, S, (g) => {
      g.strokeStyle = bright ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)';
      g.lineWidth = 0.6 + rand() * 1.8;
      g.beginPath();
      g.moveTo(x, y);
      // hafif kırık çizgi
      const mx = x + Math.cos(a) * l * 0.5 + (rand() - 0.5) * l * 0.2;
      const my = y + Math.sin(a) * l * 0.5 + (rand() - 0.5) * l * 0.2;
      g.lineTo(mx, my);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    });
  }
  const crease = blurArr(readHeight(cc), S, S, Math.max(0.7, S / 600));
  const tape = S / 40;
  const hgt = new Float32Array(S * S);
  const isTape = new Uint8Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const dx = Math.min(x, S - x);
      const dy = Math.min(y, S - y);
      const t = dx < tape || dy < tape;
      isTape[i] = t ? 1 : 0;
      let h = ridge[i] * 0.6 + (crease[i] - 0.5) * 0.9 + soft[i] * 0.25;
      if (t) {
        h = 0.55 + (soft[i] - 0.5) * 0.05;
        // dikiş noktaları
        const along = dx < tape ? y : x;
        const across = dx < tape ? dx : dy;
        if (Math.abs(across - tape * 0.5) < 1 && along % 8 < 3) h -= 0.2;
      }
      hgt[i] = h;
    }
  }
  const color = paint(S, S, (x, y, i, o) => {
    if (isTape[i]) {
      const v = 0.86 + (soft[i] - 0.5) * 0.08;
      o[0] = v * 236;
      o[1] = v * 214;
      o[2] = v * 160;
      return;
    }
    const s = clamp01(0.35 + hgt[i] * 0.55 + (soft[i] - 0.5) * 0.35);
    // koyu bronz → parlak altın
    o[0] = 120 + s * 135;
    o[1] = 78 + s * 125;
    o[2] = 22 + s * 70;
  });
  const rough = paint(S, S, (x, y, i, o) => {
    const v = isTape[i] ? 0.4 : 0.16 + (1 - ridge[i]) * 0.18 + Math.abs(crease[i] - 0.5) * 0.3;
    o[0] = o[1] = o[2] = clamp01(v) * 255;
  });
  return pack(color, hgt, S, S, rough, 5);
}

// ---------------------------------------------------------------------------
// Metal ızgara (yürüme yolu / havalandırma): taşıyıcı çubuklar + ara çubuklar.
// ---------------------------------------------------------------------------
export function grateTextures(S = 256, seed = 51) {
  const bar = S / 8; // taşıyıcı çubuk aralığı
  const bw = Math.max(2, Math.round(S / 42));
  const cross = S / 4;
  const cw = Math.max(2, Math.round(S / 32));
  const grime = fbm(S, S, { px: 4, octaves: 4, seed });
  const hgt = new Float32Array(S * S);
  const kind = new Uint8Array(S * S); // 0 boşluk, 1 çubuk, 2 ara çubuk
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const bx = Math.abs(((x + bar / 2) % bar) - bar / 2);
      const cy = Math.abs(((y + cross / 2) % cross) - cross / 2);
      if (bx < bw / 2) {
        kind[i] = 1;
        hgt[i] = 0.85 + 0.15 * Math.cos((bx / (bw / 2)) * Math.PI * 0.5);
      } else if (cy < cw / 2) {
        kind[i] = 2;
        hgt[i] = 0.7;
      } else {
        hgt[i] = 0.0;
      }
    }
  }
  const color = paint(S, S, (x, y, i, o) => {
    const g = grime[i];
    let v;
    if (kind[i] === 0) v = 0.07 + g * 0.04;
    else if (kind[i] === 1) v = 0.72 + (hgt[i] - 0.85) * 1.2 - g * 0.15;
    else v = 0.6 - g * 0.15;
    o[0] = v * 255;
    o[1] = v * 255;
    o[2] = v * 250;
  });
  const rough = paint(S, S, (x, y, i, o) => {
    const v = kind[i] === 0 ? 1 : 0.38 + grime[i] * 0.25;
    o[0] = o[1] = o[2] = v * 255;
  });
  return pack(color, hgt, S, S, rough, 3);
}

// ---------------------------------------------------------------------------
// Zemin plakası: kaymaz baklava deseni, plaka derzleri, havşa vidalar, aşınma.
// ---------------------------------------------------------------------------
export function treadTextures(S = 512, seed = 61) {
  const plate = S / 2;
  const cell = S / 16;
  const grime = fbm(S, S, { px: 3, octaves: 5, seed });
  const wear = fbm(S, S, { px: 6, octaves: 3, seed: seed + 2 });
  const hgt = new Float32Array(S * S);
  const top = new Float32Array(S * S);
  const a2 = (cell * 0.36) ** 2;
  const b2 = (cell * 0.1) ** 2;
  const sr = S / 64;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      const lx = (x % cell) - cell / 2;
      const ly = (y % cell) - cell / 2;
      const o = (cx + cy) % 2 ? 1 : -1;
      const a = (lx + o * ly) * Math.SQRT1_2;
      const b = (-o * lx + ly) * Math.SQRT1_2;
      const e = (a * a) / a2 + (b * b) / b2;
      const len = e < 1 ? Math.sqrt(1 - e) : 0;
      let h = 0.4 + 0.35 * len;
      top[i] = len;
      // plaka derzi
      const px = x % plate;
      const py = y % plate;
      const edge = Math.min(px, plate - px, py, plate - py);
      if (edge < S / 200 + 1) h = 0.05;
      else if (edge < S / 100 + 2) h = Math.min(h, 0.3);
      // köşe vidaları
      for (const [vx, vy] of [[S / 28, S / 28], [plate - S / 28, S / 28], [S / 28, plate - S / 28], [plate - S / 28, plate - S / 28]]) {
        const d = Math.hypot(px - vx, py - vy);
        if (d < sr) {
          h = 0.32 + 0.1 * (d / sr);
          if (Math.abs(px - vx) < sr * 0.18) h = 0.2;
          top[i] = 0.3;
        }
      }
      hgt[i] = h;
    }
  }
  const color = paint(S, S, (x, y, i, o) => {
    let v = 0.78 - (grime[i] - 0.5) * 0.18 + top[i] * (0.1 + wear[i] * 0.15);
    if (hgt[i] < 0.1) v *= 0.45;
    o[0] = clamp01(v) * 255;
    o[1] = clamp01(v) * 255;
    o[2] = clamp01(v * 1.02) * 255;
  });
  const rough = paint(S, S, (x, y, i, o) => {
    const v = 0.7 - top[i] * (0.15 + wear[i] * 0.2) + (grime[i] - 0.5) * 0.15;
    o[0] = o[1] = o[2] = clamp01(v) * 255;
  });
  return pack(color, hgt, S, S, rough, 2.8);
}

// ---------------------------------------------------------------------------
// Tavan: delikli akustik paneller (2×2), derzler.
// ---------------------------------------------------------------------------
export function ceilingTextures(S = 512, seed = 71) {
  const plate = S / 2;
  const grime = fbm(S, S, { px: 3, octaves: 4, seed });
  const pitch = S / 48;
  const margin = S / 16;
  const hr = S / 330;
  const hgt = new Float32Array(S * S);
  const hole = new Uint8Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const px = x % plate;
      const py = y % plate;
      const edge = Math.min(px, plate - px, py, plate - py);
      let h = 0.6;
      if (edge < S / 256 + 0.5) h = 0.05;
      else if (edge < S / 128 + 1) h = 0.35;
      else if (edge > margin) {
        const qx = ((px - margin) % pitch) - pitch / 2;
        const qy = ((py - margin) % pitch) - pitch / 2;
        if (qx * qx + qy * qy < hr * hr) {
          h = 0.3;
          hole[i] = 1;
        }
      }
      hgt[i] = h;
    }
  }
  const color = paint(S, S, (x, y, i, o) => {
    let v = 0.95 - (grime[i] - 0.5) * 0.08;
    if (hole[i]) v *= 0.45;
    if (hgt[i] < 0.1) v *= 0.55;
    o[0] = v * 255;
    o[1] = v * 252;
    o[2] = v * 245;
  });
  const rough = paint(S, S, (x, y, i, o) => {
    o[0] = o[1] = o[2] = clamp01(0.82 + (grime[i] - 0.5) * 0.12) * 255;
  });
  return pack(color, hgt, S, S, rough, 1.8);
}

// ---------------------------------------------------------------------------
// Sarı-siyah uyarı şeridi (45°), boya aşınması ve çizikler.
// ---------------------------------------------------------------------------
export function hazardTextures(S = 256, seed = 81) {
  const rand = rng(seed);
  const period = S / 4;
  const chip = fbm(S, S, { px: 4, octaves: 5, seed });
  const grime = fbm(S, S, { px: 2, octaves: 4, seed: seed + 1 });
  const sc = makeCanvas(S);
  const sg = sc.getContext('2d');
  sg.fillStyle = '#000';
  sg.fillRect(0, 0, S, S);
  for (let k = 0; k < 26; k++) {
    const x = rand() * S;
    const y = rand() * S;
    const a = rand() * Math.PI;
    const l = S * (0.05 + rand() * 0.2);
    wrapDraw(sg, S, S, (g) => {
      g.strokeStyle = 'rgba(255,255,255,0.8)';
      g.lineWidth = 0.6 + rand();
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    });
  }
  const scratch = readHeight(sc);
  const hgt = new Float32Array(S * S);
  const metal = new Float32Array(S * S);
  const yellow = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const p = (x + y) % period;
      const d = Math.min(Math.abs(p - period / 2), p, period - p); // banda uzaklık
      yellow[i] = smooth(-1, 1, Math.abs(p - period / 2) < period / 4 ? 1 : -1) * 0 + (p < period / 2 ? 1 : 0);
      // kenar yumuşatma
      const edgeDist = Math.min(Math.abs(p - period / 2), Math.min(p, period - p));
      if (edgeDist < 1) yellow[i] = 0.5 + (p < period / 2 ? 0.5 : -0.5) * edgeDist;
      void d;
      const m = Math.max(smooth(0.7, 0.76, chip[i]), scratch[i] * 0.9);
      metal[i] = m;
      hgt[i] = 0.5 - m * 0.25;
    }
  }
  const color = paint(S, S, (x, y, i, o) => {
    const yv = yellow[i];
    const dirt = 1 - (grime[i] - 0.4) * 0.25;
    let r = (30 + yv * 205) * dirt;
    let g = (30 + yv * 148) * dirt;
    let b = (28 + yv * -8) * dirt;
    const m = metal[i];
    r = r * (1 - m) + 150 * m;
    g = g * (1 - m) + 150 * m;
    b = b * (1 - m) + 148 * m;
    o[0] = r;
    o[1] = g;
    o[2] = b;
  });
  const rough = paint(S, S, (x, y, i, o) => {
    const v = 0.55 * (1 - metal[i]) + 0.35 * metal[i] + (grime[i] - 0.5) * 0.15;
    o[0] = o[1] = o[2] = clamp01(v) * 255;
  });
  return pack(color, hgt, S, S, rough, 2);
}

// ---------------------------------------------------------------------------
// Fırçalanmış alüminyum: tek yönlü ince çizgiler.
// ---------------------------------------------------------------------------
export function brushedTextures(S = 512, seed = 91) {
  const a = fbm(S, S, { px: 2, py: 128, octaves: 3, seed });
  const b = fbm(S, S, { px: 4, py: 256, octaves: 2, seed: seed + 1 });
  const big = fbm(S, S, { px: 2, octaves: 3, seed: seed + 2 });
  const hgt = new Float32Array(S * S);
  for (let i = 0; i < hgt.length; i++) hgt[i] = a[i] * 0.6 + b[i] * 0.4;
  const color = paint(S, S, (x, y, i, o) => {
    const v = 0.84 + hgt[i] * 0.12 + (big[i] - 0.5) * 0.06;
    o[0] = clamp01(v) * 255;
    o[1] = clamp01(v) * 255;
    o[2] = clamp01(v * 1.01) * 255;
  });
  const rough = paint(S, S, (x, y, i, o) => {
    o[0] = o[1] = o[2] = clamp01(0.26 + (1 - hgt[i]) * 0.16 + (big[i] - 0.5) * 0.1) * 255;
  });
  return pack(color, hgt, S, S, rough, 0.6);
}

// ---------------------------------------------------------------------------
// Genel kir/leke (küçük metal parçalar ve koyu gövde için). roughnessMap GÖRELİ (~0.8–1).
// ---------------------------------------------------------------------------
export function grimeTextures(S = 256, seed = 101) {
  const g1 = fbm(S, S, { px: 3, octaves: 5, seed });
  const g2 = fbm(S, S, { px: 16, octaves: 2, seed: seed + 1 });
  const color = paint(S, S, (x, y, i, o) => {
    const v = 0.9 + (g1[i] - 0.5) * 0.16 + (g2[i] - 0.5) * 0.05;
    o[0] = clamp01(v) * 255;
    o[1] = clamp01(v) * 255;
    o[2] = clamp01(v) * 255;
  });
  const rough = paint(S, S, (x, y, i, o) => {
    o[0] = o[1] = o[2] = clamp01(0.88 + (g1[i] - 0.5) * 0.25) * 255;
  });
  return pack(color, null, S, S, rough, 1);
}

// ---------------------------------------------------------------------------
// Sürgülü kapı kanadı (256×512, döşenmez): çerçeve, pencere, uyarı bandı, contalar.
// Yatay simetrik çizilir (iki kanat ve iki yüz aynı dokuyu kullanır).
// ---------------------------------------------------------------------------
export function doorLeafTextures() {
  const W = 256;
  const H = 512;
  const cc = makeCanvas(W, H);
  const cg = cc.getContext('2d');
  const hc = makeCanvas(W, H);
  const hg = hc.getContext('2d');
  cg.fillStyle = 'rgb(196,194,186)';
  cg.fillRect(0, 0, W, H);
  hg.fillStyle = gray(0.6);
  hg.fillRect(0, 0, W, H);
  // kenar contaları (kauçuk)
  cg.fillStyle = 'rgb(28,28,30)';
  cg.fillRect(0, 0, 10, H);
  cg.fillRect(W - 10, 0, 10, H);
  hg.fillStyle = gray(0.45);
  hg.fillRect(0, 0, 10, H);
  hg.fillRect(W - 10, 0, 10, H);
  // girintili çerçeve
  hg.strokeStyle = gray(0.25);
  hg.lineWidth = 4;
  hg.strokeRect(22, 18, W - 44, H - 36);
  cg.strokeStyle = 'rgba(60,60,60,0.7)';
  cg.lineWidth = 2;
  cg.strokeRect(22, 18, W - 44, H - 36);
  // yatay panel çizgileri
  for (const y of [236, 330]) {
    hg.fillStyle = gray(0.3);
    hg.fillRect(22, y, W - 44, 3);
    cg.fillStyle = 'rgba(70,70,70,0.6)';
    cg.fillRect(22, y, W - 44, 2);
  }
  // pencere
  const wx = 70;
  const wy = 62;
  const ww = W - 140;
  const wh = 130;
  hg.fillStyle = gray(0.95);
  hg.fillRect(wx - 12, wy - 12, ww + 24, wh + 24);
  hg.fillStyle = gray(0.2);
  hg.fillRect(wx, wy, ww, wh);
  cg.fillStyle = 'rgb(110,112,116)';
  cg.fillRect(wx - 12, wy - 12, ww + 24, wh + 24);
  const grd = cg.createLinearGradient(wx, wy, wx + ww, wy + wh);
  grd.addColorStop(0, 'rgb(40,58,72)');
  grd.addColorStop(0.45, 'rgb(14,20,26)');
  grd.addColorStop(0.55, 'rgb(60,80,96)');
  grd.addColorStop(1, 'rgb(10,14,18)');
  cg.fillStyle = grd;
  cg.fillRect(wx, wy, ww, wh);
  for (const [x, y] of [[wx - 6, wy - 6], [wx + ww + 6, wy - 6], [wx - 6, wy + wh + 6], [wx + ww + 6, wy + wh + 6]]) {
    hg.fillStyle = gray(1);
    hg.beginPath();
    hg.arc(x, y, 3, 0, Math.PI * 2);
    hg.fill();
  }
  // tutamak girintisi (iki yanda)
  for (const x of [26, W - 46]) {
    hg.fillStyle = gray(0.15);
    hg.fillRect(x, 260, 20, 56);
    cg.fillStyle = 'rgb(50,50,52)';
    cg.fillRect(x, 260, 20, 56);
  }
  // alt uyarı bandı
  const by = 420;
  const bh = 64;
  cg.save();
  cg.beginPath();
  cg.rect(22, by, W - 44, bh);
  cg.clip();
  cg.fillStyle = 'rgb(225,170,25)';
  cg.fillRect(22, by, W - 44, bh);
  cg.fillStyle = 'rgb(26,26,26)';
  for (let x = -bh; x < W + bh; x += 40) {
    cg.beginPath();
    cg.moveTo(x, by + bh);
    cg.lineTo(x + 20, by + bh);
    cg.lineTo(x + 20 + bh, by);
    cg.lineTo(x + bh, by);
    cg.closePath();
    cg.fill();
  }
  cg.restore();
  hg.fillStyle = gray(0.66);
  hg.fillRect(22, by, W - 44, bh);
  // şablon yazı
  cg.fillStyle = 'rgba(40,40,40,0.85)';
  cg.font = 'bold 22px "Arial Narrow", "DejaVu Sans Condensed", Arial, sans-serif';
  cg.textAlign = 'center';
  cg.fillText('BASINÇ KAPISI', W / 2, 382);
  // kir
  const grime = fbm(W, H, { px: 2, py: 4, octaves: 4, seed: 7 });
  const img = cg.getImageData(0, 0, W, H);
  for (let i = 0; i < W * H; i++) {
    const k = 1 - (grime[i] - 0.5) * 0.14 - (i / W / H) * 0.06;
    img.data[i * 4] *= k;
    img.data[i * 4 + 1] *= k;
    img.data[i * 4 + 2] *= k;
  }
  cg.putImageData(img, 0, 0);
  const hgt = blurArr(readHeight(hc), W, H, 0.8);
  const map = toTexture(cc, { srgb: true });
  const normalMap = toTexture(heightToNormal(hgt, W, H, 3));
  for (const t of [map, normalMap]) {
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
  }
  return { map, normalMap, roughnessMap: null };
}
