/**
 * Mürettebat alanlarındaki fotoğraflar ve çizimler (prosedürel canvas).
 * Her fonksiyon (g, w, h) alır; g = CanvasRenderingContext2D.
 */
import { rng } from './kit.js';

function sky(g, w, h, top, bottom, horizon) {
  const gr = g.createLinearGradient(0, 0, 0, h * horizon);
  gr.addColorStop(0, top);
  gr.addColorStop(1, bottom);
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h * horizon + 1);
}

/** Eski fotoğraf efekti: sararma, vinyet, hafif çizik */
function aged(g, w, h, seed = 1, amount = 0.25) {
  const r = rng(seed);
  g.fillStyle = `rgba(150,110,40,${amount * 0.45})`;
  g.globalCompositeOperation = 'multiply';
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
  const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, `rgba(40,25,10,${amount * 1.4})`);
  g.fillStyle = vg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,250,235,0.35)';
  g.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const x = r() * w;
    g.beginPath();
    g.moveTo(x, r() * h * 0.3);
    g.lineTo(x + (r() - 0.5) * 20, h * (0.5 + r() * 0.5));
    g.stroke();
  }
}

/** Mısır tarlası (geniş, ufka uzanan sıralar, tozlu ışık) */
export function drawCornfield(g, w, h) {
  const r = rng(42);
  const hz = 0.42;
  sky(g, w, h, '#9fb6c4', '#e9dcc0', hz);
  // uzak ağaç çizgisi
  g.fillStyle = '#5d6447';
  for (let x = 0; x < w; x += 6) {
    const th = 4 + r() * 7;
    g.fillRect(x, h * hz - th, 7, th + 1);
  }
  // tarla zemini
  const fg = g.createLinearGradient(0, h * hz, 0, h);
  fg.addColorStop(0, '#7f8a4a');
  fg.addColorStop(1, '#46552a');
  g.fillStyle = fg;
  g.fillRect(0, h * hz, w, h);
  // sıralar (perspektif)
  const vx = w * 0.55;
  const vy = h * hz;
  for (let i = -18; i <= 18; i++) {
    g.strokeStyle = i % 2 ? 'rgba(45,58,25,0.55)' : 'rgba(150,160,80,0.35)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(vx, vy);
    g.lineTo(vx + i * w * 0.09, h);
    g.stroke();
  }
  // ön planda mısır sapları
  for (let i = 0; i < 70; i++) {
    const x = r() * w;
    const base = h * (0.62 + r() * 0.38);
    const sh = (base - h * hz) * (0.55 + r() * 0.3);
    g.strokeStyle = r() > 0.5 ? '#5b6e2c' : '#76843a';
    g.lineWidth = 1 + (base / h) * 2;
    g.beginPath();
    g.moveTo(x, base);
    g.quadraticCurveTo(x + (r() - 0.5) * 8, base - sh * 0.5, x + (r() - 0.5) * 10, base - sh);
    g.stroke();
    // yapraklar
    g.strokeStyle = '#8c9846';
    for (let k = 0; k < 3; k++) {
      const ly = base - sh * (0.3 + k * 0.2);
      const dir = r() > 0.5 ? 1 : -1;
      g.beginPath();
      g.moveTo(x, ly);
      g.quadraticCurveTo(x + dir * 9, ly - 6, x + dir * 16, ly + 4);
      g.stroke();
    }
    // püskül
    g.fillStyle = '#d8c27a';
    g.fillRect(x - 1, base - sh - 4, 3, 5);
  }
  // tozlu güneş ışığı
  const sun = g.createRadialGradient(w * 0.82, h * 0.28, 2, w * 0.82, h * 0.28, w * 0.5);
  sun.addColorStop(0, 'rgba(255,240,200,0.55)');
  sun.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, w, h);
  aged(g, w, h, 4, 0.22);
}

/** Çiftlik evi: beyaz iki katlı ev, verandalı; yanında ağaç ve kamyonet */
export function drawFarmhouse(g, w, h) {
  const r = rng(7);
  const hz = 0.6;
  sky(g, w, h, '#a9bccb', '#efe3c8', hz);
  g.fillStyle = '#9b8d5e';
  g.fillRect(0, h * hz, w, h);
  // tarla çizgileri
  g.strokeStyle = 'rgba(80,70,40,0.35)';
  for (let i = 0; i < 12; i++) {
    g.beginPath();
    g.moveTo(0, h * hz + i * 7);
    g.lineTo(w, h * hz + i * 7 + 3);
    g.stroke();
  }
  // ağaç
  g.fillStyle = '#4a3a28';
  g.fillRect(w * 0.12, h * 0.35, 6, h * 0.27);
  g.fillStyle = '#4d5a33';
  for (let i = 0; i < 9; i++) {
    g.beginPath();
    g.arc(w * 0.13 + (r() - 0.5) * 40, h * 0.3 + (r() - 0.5) * 30, 14 + r() * 8, 0, Math.PI * 2);
    g.fill();
  }
  // ev
  const hx = w * 0.36;
  const hy = h * 0.3;
  const hw = w * 0.38;
  const hh = h * 0.32;
  g.fillStyle = '#ece9df';
  g.fillRect(hx, hy, hw, hh);
  g.fillStyle = '#5b5550';
  g.beginPath();
  g.moveTo(hx - 8, hy);
  g.lineTo(hx + hw / 2, hy - h * 0.13);
  g.lineTo(hx + hw + 8, hy);
  g.closePath();
  g.fill();
  // pencereler
  g.fillStyle = '#3b4652';
  for (let i = 0; i < 3; i++) g.fillRect(hx + 12 + i * (hw / 3), hy + 10, 14, 18);
  for (let i = 0; i < 2; i++) g.fillRect(hx + 12 + i * (hw / 3) * 2, hy + hh - 30, 14, 18);
  // veranda
  g.fillStyle = '#d8d3c6';
  g.fillRect(hx - 6, hy + hh - 36, hw + 12, 5);
  g.strokeStyle = '#cfc9bb';
  g.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    g.beginPath();
    g.moveTo(hx + i * (hw / 7), hy + hh - 31);
    g.lineTo(hx + i * (hw / 7), hy + hh);
    g.stroke();
  }
  // kamyonet
  g.fillStyle = '#6d4636';
  g.fillRect(w * 0.8, h * 0.56, 38, 14);
  g.fillRect(w * 0.8 + 6, h * 0.5, 18, 9);
  g.fillStyle = '#222';
  g.beginPath();
  g.arc(w * 0.8 + 8, h * 0.56 + 15, 5, 0, Math.PI * 2);
  g.arc(w * 0.8 + 31, h * 0.56 + 15, 5, 0, Math.PI * 2);
  g.fill();
  // ufukta toz bulutu
  const dust = g.createLinearGradient(0, h * 0.35, 0, h * hz);
  dust.addColorStop(0, 'rgba(180,150,110,0)');
  dust.addColorStop(1, 'rgba(180,150,110,0.45)');
  g.fillStyle = dust;
  g.fillRect(0, h * 0.35, w, h * (hz - 0.35));
  aged(g, w, h, 9, 0.3);
}

/** Çocuk çizimi: halka gemi, gezegen, "BABAM" yazısı (pastel boya) */
export function drawKidRocket(g, w, h) {
  g.fillStyle = '#f2eee2';
  g.fillRect(0, 0, w, h);
  g.lineCap = 'round';
  // yıldızlar
  g.strokeStyle = '#d9a520';
  g.lineWidth = 3;
  const r = rng(5);
  for (let i = 0; i < 9; i++) {
    const x = 15 + r() * (w - 30);
    const y = 12 + r() * h * 0.45;
    g.beginPath();
    g.moveTo(x - 6, y);
    g.lineTo(x + 6, y);
    g.moveTo(x, y - 6);
    g.lineTo(x, y + 6);
    g.stroke();
  }
  // halka gemi
  g.strokeStyle = '#4a6fb5';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(w * 0.38, h * 0.48, h * 0.24, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 3;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.strokeRect(w * 0.38 + Math.cos(a) * h * 0.24 - 5, h * 0.48 + Math.sin(a) * h * 0.24 - 5, 10, 10);
  }
  // gezegen
  g.fillStyle = '#e07b39';
  g.beginPath();
  g.arc(w * 0.8, h * 0.3, 22, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#a0522d';
  g.beginPath();
  g.ellipse(w * 0.8, h * 0.3, 36, 9, -0.3, 0, Math.PI * 2);
  g.stroke();
  // yazı
  g.fillStyle = '#c0392b';
  g.font = 'bold 26px "DejaVu Sans", sans-serif';
  g.fillText('BABAM', w * 0.52, h * 0.88);
  g.fillStyle = '#2e7d32';
  g.font = 'bold 15px "DejaVu Sans", sans-serif';
  g.fillText('D.', w * 0.88, h * 0.94);
}

/** Aile fotoğrafı: ev önünde üç siluet (bulanık, sararmış) */
export function drawFamily(g, w, h) {
  sky(g, w, h, '#b4c2c8', '#e8dcc2', 0.55);
  g.fillStyle = '#a69a6c';
  g.fillRect(0, h * 0.55, w, h);
  g.fillStyle = '#dcd7cb';
  g.fillRect(w * 0.05, h * 0.15, w * 0.9, h * 0.45);
  g.fillStyle = '#6a6460';
  g.fillRect(w * 0.05, h * 0.12, w * 0.9, h * 0.05);
  const fig = (x, s, c) => {
    g.fillStyle = c;
    g.beginPath();
    g.arc(x, h * 0.42 - 30 * s, 9 * s, 0, Math.PI * 2);
    g.fill();
    g.fillRect(x - 11 * s, h * 0.42 - 20 * s, 22 * s, 48 * s);
    g.fillRect(x - 9 * s, h * 0.42 + 28 * s, 7 * s, 30 * s);
    g.fillRect(x + 2 * s, h * 0.42 + 28 * s, 7 * s, 30 * s);
  };
  fig(w * 0.32, 1.25, '#3e4a5a');
  fig(w * 0.52, 0.95, '#7a3f35');
  fig(w * 0.68, 0.8, '#5a6b3a');
  aged(g, w, h, 21, 0.35);
}

/** Mavi bilye: uzaydan Dünya */
export function drawEarth(g, w, h) {
  g.fillStyle = '#020306';
  g.fillRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) * 0.42;
  const oc = g.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R);
  oc.addColorStop(0, '#4c8fd1');
  oc.addColorStop(1, '#0b2b55');
  g.fillStyle = oc;
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.fill();
  g.save();
  g.clip();
  const r = rng(3);
  g.fillStyle = '#8a7a4a';
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    g.ellipse(cx + (r() - 0.5) * R * 1.2, cy + (r() - 0.5) * R * 1.2, R * (0.15 + r() * 0.25), R * (0.1 + r() * 0.2), r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = 'rgba(255,255,255,0.75)';
  for (let i = 0; i < 14; i++) {
    g.beginPath();
    g.ellipse(cx + (r() - 0.5) * R * 1.8, cy + (r() - 0.5) * R * 1.8, R * (0.1 + r() * 0.3), R * 0.04, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const sh = g.createLinearGradient(cx - R, 0, cx + R, 0);
  sh.addColorStop(0, 'rgba(0,0,0,0)');
  sh.addColorStop(0.65, 'rgba(0,0,0,0.1)');
  sh.addColorStop(1, 'rgba(0,0,0,0.85)');
  g.fillStyle = sh;
  g.fillRect(0, 0, w, h);
  g.restore();
}

/** Toz fırtınası: ufuktan yükselen kahverengi duvar */
export function drawDustStorm(g, w, h) {
  sky(g, w, h, '#b8a888', '#d9c7a0', 0.7);
  const r = rng(8);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(${110 + r() * 40},${85 + r() * 30},${55 + r() * 20},${0.25 + r() * 0.3})`;
    g.beginPath();
    g.arc(r() * w, h * (0.35 + r() * 0.35), 20 + r() * 40, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#6b5b3c';
  g.fillRect(0, h * 0.7, w, h);
  g.fillStyle = '#3d362c';
  g.fillRect(w * 0.15, h * 0.58, 30, 22);
  g.beginPath();
  g.moveTo(w * 0.15 - 4, h * 0.58);
  g.lineTo(w * 0.15 + 15, h * 0.5);
  g.lineTo(w * 0.15 + 34, h * 0.58);
  g.fill();
  aged(g, w, h, 12, 0.3);
}

/** Görev arması: "AZİM" + halka gemi */
export function drawPatch(g, w, h) {
  g.fillStyle = 'rgba(0,0,0,0)';
  g.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) * 0.47;
  g.fillStyle = '#1b2433';
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#c8962e';
  g.lineWidth = R * 0.08;
  g.stroke();
  // kara delik
  g.fillStyle = '#f2c27a';
  g.beginPath();
  g.ellipse(cx, cy + R * 0.12, R * 0.62, R * 0.1, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#000';
  g.beginPath();
  g.arc(cx, cy + R * 0.12, R * 0.22, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#f2c27a';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(cx, cy + R * 0.12, R * 0.27, Math.PI * 1.05, Math.PI * 1.95);
  g.stroke();
  // halka gemi
  g.strokeStyle = '#e6e6e6';
  g.lineWidth = 3;
  g.beginPath();
  g.ellipse(cx, cy - R * 0.38, R * 0.3, R * 0.1, 0, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#e6e6e6';
  g.font = `bold ${Math.round(R * 0.3)}px "DejaVu Sans", sans-serif`;
  g.textAlign = 'center';
  g.fillText('AZİM', cx, cy + R * 0.62);
  g.textAlign = 'left';
}

/** Yıldız haritası (gözlem masası için, mavi ışıklı) */
export function drawStarChart(g, w, h) {
  g.fillStyle = '#020812';
  g.fillRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const r = rng(77);
  // ızgara
  g.strokeStyle = 'rgba(90,170,255,0.18)';
  g.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    g.beginPath();
    g.arc(cx, cy, (i * w) / 16, 0, Math.PI * 2);
    g.stroke();
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * w * 0.5, cy + Math.sin(a) * h * 0.5);
    g.stroke();
  }
  // yıldızlar
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(200,225,255,${0.3 + r() * 0.7})`;
    const s = r() < 0.08 ? 2.5 : 1.2;
    g.fillRect(r() * w, r() * h, s, s);
  }
  // Gargantua ve yörüngeler
  g.strokeStyle = 'rgba(255,190,110,0.9)';
  g.lineWidth = 2;
  g.beginPath();
  g.ellipse(cx, cy, w * 0.07, w * 0.02, 0, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#000';
  g.beginPath();
  g.arc(cx, cy, w * 0.03, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#ffbe6e';
  g.stroke();
  const orbits = [
    [0.1, 'MILLER', 0.6],
    [0.2, 'MANN', 2.2],
    [0.3, 'EDMUNDS', 4.1],
  ];
  g.font = 'bold 13px monospace';
  for (const [rr, name, a] of orbits) {
    g.strokeStyle = 'rgba(110,190,255,0.6)';
    g.setLineDash([4, 4]);
    g.beginPath();
    g.ellipse(cx, cy, w * rr, w * rr * 0.92, 0.2, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    const px = cx + Math.cos(a) * w * rr;
    const py = cy + Math.sin(a) * w * rr * 0.92;
    g.fillStyle = '#9fd4ff';
    g.beginPath();
    g.arc(px, py, 4, 0, Math.PI * 2);
    g.fill();
    g.fillText(name, px + 7, py - 6);
  }
  g.fillStyle = '#ffbe6e';
  g.fillText('GARGANTUA', cx + w * 0.04, cy + w * 0.045);
  // AZİM konumu
  g.strokeStyle = '#7dff9a';
  g.lineWidth = 2;
  const ax = cx + Math.cos(-0.9) * w * 0.4;
  const ay = cy + Math.sin(-0.9) * w * 0.37;
  g.strokeRect(ax - 5, ay - 5, 10, 10);
  g.fillStyle = '#7dff9a';
  g.fillText('AZİM', ax + 8, ay - 4);
  g.fillStyle = 'rgba(120,200,255,0.8)';
  g.font = '11px monospace';
  g.fillText('GARGANTUA SİSTEMİ  ·  ÖLÇEK 1:4.2 AB', 8, h - 16);
}
