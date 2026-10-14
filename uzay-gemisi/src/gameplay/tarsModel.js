import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * TARS'ın 3B modeli: yan yana dört dikey fırçalanmış alüminyum blok.
 *
 * Hiyerarşi (grup yerel +Z = TARS'ın ön yüzü / ekran tarafı):
 *   root
 *    └ body (y = menteşe yüksekliği; yürürken iner/kalkar)
 *       ├ axle   (blokların döndüğü yatay mil — boşluklardan görünür)
 *       └ slabs[0..3]  (her biri menteşe ekseninde döner: rotation.x)
 *            ├ shell   (yuvarlatılmış kutu, fırçalanmış alüminyum)
 *            ├ detail  (vidalar, ızgaralar, dikiş çıtaları, ayak tabanı — tek birleşik mesh)
 *            └ screen  (yalnızca orta iki blok: LED ifade şeridi)
 */

export const SLAB_W = 0.22;
export const SLAB_D = 0.45;
export const SLAB_H = 1.55;
export const SLAB_GAP = 0.03;
/** Menteşe ekseninin ayak tabanından yüksekliği */
export const HINGE = 1.42;
/** Blok merkezleri arası mesafe */
export const PITCH = SLAB_W + SLAB_GAP;
/** Toplam genişlik */
export const TOTAL_W = 4 * SLAB_W + 3 * SLAB_GAP;

/** Bloklardaki dikiş (yatay oluk) yükseklikleri — tabandan */
const SEAMS = [0.11, 0.52, 0.93, 1.29];
const SCREEN_Y = 1.11; // ekranın tabandan yüksekliği
const SCREEN_W = 0.17;
const SCREEN_H = 0.09;

let shared = null;

/** Fırçalanmış alüminyum dokuları (bir kez üretilir). */
function makeBrushedTextures() {
  const W = 128;
  const H = 512;
  const rand = mulberry32(7);
  const yOf = (hb) => Math.round((1 - hb / SLAB_H) * H);

  // Renk dokusu
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#b4b8be';
  g.fillRect(0, 0, W, H);
  // dikey fırça izleri
  for (let i = 0; i < 2600; i++) {
    const x = Math.floor(rand() * W);
    const y = Math.floor(rand() * H) - 60;
    const len = 30 + rand() * 360;
    const light = rand() < 0.5;
    g.fillStyle = light ? `rgba(255,255,255,${0.025 + rand() * 0.06})` : `rgba(20,24,30,${0.02 + rand() * 0.06})`;
    g.fillRect(x, y, 1, len);
  }
  // hafif kirlenme (alt kısımlar biraz daha mat ve koyu)
  const grad = g.createLinearGradient(0, H * 0.75, 0, H);
  grad.addColorStop(0, 'rgba(40,36,30,0)');
  grad.addColorStop(1, 'rgba(40,36,30,0.22)');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // dikişler: koyu oluk + altında ince parlak kenar
  for (const s of SEAMS) {
    const y = yOf(s);
    g.fillStyle = 'rgba(18,20,24,0.9)';
    g.fillRect(0, y - 1, W, 2);
    g.fillStyle = 'rgba(235,238,242,0.45)';
    g.fillRect(0, y + 1, W, 1);
  }
  // erişim kapağı çerçevesi (iki alt dikiş arasında)
  const py0 = yOf(0.88);
  const py1 = yOf(0.57);
  g.strokeStyle = 'rgba(25,28,32,0.6)';
  g.lineWidth = 1;
  g.strokeRect(14.5, py0 + 0.5, W - 29, py1 - py0);

  // Kabartma (bump) dokusu: oluklar çukur
  const b = document.createElement('canvas');
  b.width = W;
  b.height = H;
  const bg = b.getContext('2d');
  bg.fillStyle = '#808080';
  bg.fillRect(0, 0, W, H);
  for (let i = 0; i < 900; i++) {
    const x = Math.floor(rand() * W);
    const v = 118 + Math.floor(rand() * 20);
    bg.fillStyle = `rgb(${v},${v},${v})`;
    bg.fillRect(x, Math.floor(rand() * H) - 40, 1, 40 + rand() * 300);
  }
  bg.fillStyle = '#202020';
  for (const s of SEAMS) bg.fillRect(0, yOf(s) - 1, W, 3);
  bg.strokeStyle = '#505050';
  bg.strokeRect(14.5, py0 + 0.5, W - 29, py1 - py0);

  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const bump = new THREE.CanvasTexture(b);
  bump.anisotropy = 4;
  return { map, bump };
}

/** Küçük deterministik rastgele sayı üreteci */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Yuvarlatılmış kutu; UV'ler kutu yüzlerine göre yeniden atanır (yan yüzler tüm dokuyu,
 * üst/alt yüzler dikişsiz bir bandı kullanır).
 */
function slabGeometry() {
  const geo = new RoundedBoxGeometry(SLAB_W, SLAB_H, SLAB_D, 2, 0.012);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).normalize();
    for (let k = 0; k < 3; k++) {
      const p = k === 0 ? a : k === 1 ? b : c;
      let u;
      let v;
      if (Math.abs(n.y) > 0.7) {
        // üst/alt: dikişsiz band (tabandan ~1.1 m yüksekliğe karşılık gelen bölge)
        u = 0.5 + p.x / SLAB_W;
        v = 0.71 + (p.z / SLAB_D) * 0.02;
      } else {
        u = Math.abs(n.x) > Math.abs(n.z) ? 0.5 + p.z / SLAB_D : 0.5 + p.x / SLAB_W;
        v = (p.y + SLAB_H / 2) / SLAB_H;
      }
      uv.setXY(i + k, u, v);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

/** Bir blok için birleşik detay geometrisi (blok yerel uzayı: menteşe orijinde). */
function detailGeometry(index) {
  const parts = [];
  const yb = (h) => h - HINGE; // tabandan yükseklik → menteşe yerel y
  const hz = SLAB_D / 2;
  const hx = SLAB_W / 2;
  const box = (w, h, d, x, y, z) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    parts.push(g);
  };
  const screw = (x, y, z, axis) => {
    const g = new THREE.CylinderGeometry(0.0085, 0.0085, 0.006, 8);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    else g.rotateZ(Math.PI / 2);
    g.translate(x, y, z);
    parts.push(g);
  };

  // Ayak tabanı (kauçuk görünümlü koyu şerit)
  box(SLAB_W + 0.006, 0.03, SLAB_D + 0.006, 0, yb(0.015), 0);
  // Menteşe göbeği: blok yanlarından hafifçe taşan disk
  const hub = new THREE.CylinderGeometry(0.042, 0.042, SLAB_W + 0.008, 16);
  hub.rotateZ(Math.PI / 2);
  parts.push(hub);
  // Üst kapak dikişi
  box(SLAB_W - 0.03, 0.006, SLAB_D - 0.03, 0, yb(SLAB_H) + 0.002, 0);

  // Ön ve arka yüz vidaları (dikişlerin iki yanında)
  const screwRows = [0.15, 0.48, 0.97, 1.25];
  for (const zf of [hz + 0.002, -hz - 0.002]) {
    for (const r of screwRows) {
      screw(-hx + 0.028, yb(r), zf, 'z');
      screw(hx - 0.028, yb(r), zf, 'z');
    }
  }
  // Yan yüz vidaları
  for (const xf of [hx + 0.002, -hx - 0.002]) {
    for (const r of [0.15, 1.25]) {
      screw(xf, yb(r), hz - 0.03, 'x');
      screw(xf, yb(r), -hz + 0.03, 'x');
    }
  }

  const outer = index === 0 || index === 3;
  const side = index === 0 ? -1 : 1;
  if (outer) {
    // Dış yan yüzde havalandırma ızgarası
    const x0 = side * (hx + 0.001);
    box(0.004, 0.2, 0.3, x0, yb(0.33), 0);
    for (let k = 0; k < 8; k++) box(0.014, 0.009, 0.28, x0 + side * 0.006, yb(0.245 + k * 0.024), 0);
    // Ön yüzde küçük alt ızgara
    for (let k = 0; k < 4; k++) box(0.15, 0.007, 0.01, 0, yb(0.25 + k * 0.022), hz + 0.004);
    // Üstte tutamak/sensör çıtası
    box(0.05, 0.03, 0.2, 0, yb(SLAB_H) + 0.012, 0);
  } else {
    // Ekran çerçevesi
    box(SCREEN_W + 0.026, SCREEN_H + 0.026, 0.012, 0, yb(SCREEN_Y), hz + 0.004);
    // Ekranın altında ince sensör şeridi
    box(0.12, 0.012, 0.008, 0, yb(SCREEN_Y - 0.09), hz + 0.003);
    // Arka yüzde servis kapağı kolu
    box(0.1, 0.02, 0.016, 0, yb(0.72), -hz - 0.006);
  }
  const merged = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false);
  parts.forEach((p) => p.dispose());
  return merged;
}

/** LED ekranı (iki orta bloğa bölünmüş tek canvas). */
export class TarsScreen {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 256;
    this.canvas.height = 64;
    this.g = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false });
    this.material.name = 'tarsScreen';
    this.expression = 'idle';
    this.text = '';
    this._acc = 1;
    this._blink = 0;
    this._nextBlink = 3;
    this._levels = new Float32Array(16);
    this._dirty = true;
    this._time = 0;
  }

  set(expression, text = '') {
    if (expression === this.expression && text === this.text) return;
    this.expression = expression;
    this.text = text;
    this._textStart = this._time;
    this._dirty = true;
  }

  update(dt) {
    this._time += dt;
    this._acc += dt;
    // göz kırpma
    this._nextBlink -= dt;
    if (this._nextBlink <= 0) {
      this._blink = 0.14;
      this._nextBlink = 3 + Math.random() * 4;
      this._dirty = true;
    }
    if (this._blink > 0) {
      this._blink -= dt;
      if (this._blink <= 0) this._dirty = true;
    }
    const animated = this.expression === 'talk' || this.expression === 'think' || this.expression === 'text';
    if ((animated && this._acc > 1 / 14) || this._dirty) {
      this._acc = 0;
      this._dirty = false;
      this._draw();
    }
  }

  _draw() {
    const g = this.g;
    g.fillStyle = '#04070a';
    g.fillRect(0, 0, 256, 64);
    const t = this._time;
    const expr = this.expression;
    if (expr === 'text') {
      g.save();
      g.fillStyle = '#d6ecff';
      g.font = 'bold 30px monospace';
      g.textBaseline = 'middle';
      const w = g.measureText(this.text).width;
      const span = 256 + w + 40;
      const x = 256 - (((t - (this._textStart || 0)) * 70) % span);
      g.fillText(this.text, x, 33);
      g.restore();
      this._dots(() => 0, 0.12);
    } else {
      const blink = this._blink > 0;
      this._dots((c, r, side) => this._pattern(expr, c, r, side, t, blink), 1);
    }
    // ince tarama çizgileri
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let y = 0; y < 64; y += 3) g.fillRect(0, y, 256, 1);
    this.texture.needsUpdate = true;
  }

  /** 2 × (16 × 8) noktalı LED matrisi çizer. fn → parlaklık 0..1 */
  _dots(fn, dimScale) {
    const g = this.g;
    for (let side = 0; side < 2; side++) {
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 16; c++) {
          const v = fn(c, r, side);
          const x = side * 128 + 4 + c * 8;
          const y = 4 + r * 7.5;
          if (v > 0.05) {
            g.fillStyle = `rgba(214,236,255,${Math.min(1, v)})`;
            g.fillRect(x - 0.5, y - 0.5, 6, 5.5);
          } else {
            g.fillStyle = `rgba(60,90,110,${0.22 * dimScale})`;
            g.fillRect(x, y, 5, 4.5);
          }
        }
      }
    }
  }

  _pattern(expr, c, r, side, t, blink) {
    const mid = 7.5;
    const dc = Math.abs(c - mid);
    switch (expr) {
      case 'happy': {
        // ^ şeklinde gülen göz
        if (dc > 5) return 0;
        const rr = Math.round(2 + dc * 0.75);
        return r === rr || r === rr + 1 ? (r === rr ? 1 : 0.45) : 0;
      }
      case 'wink': {
        if (side === 1) {
          if (dc > 5) return 0;
          return r === 4 ? 1 : 0;
        }
        if (dc > 5) return 0;
        const rr = Math.round(2 + dc * 0.75);
        return r === rr ? 1 : 0;
      }
      case 'sad': {
        if (dc > 5) return 0;
        const rr = Math.round(5 - dc * 0.6);
        return r === rr ? 1 : 0;
      }
      case 'alert': {
        if (c < 6 || c > 9) return 0;
        if (r <= 4) return c >= 7 && c <= 8 ? 1 : 0;
        return r === 6 && c >= 7 && c <= 8 ? 1 : 0;
      }
      case 'think': {
        const k = Math.floor(t * 3) % 3;
        const idx = side * 3 + 0;
        for (let d = 0; d < 3; d++) {
          const cx = 3 + d * 4.5;
          if (Math.abs(c - cx) <= 1 && r >= 3 && r <= 4) return (idx + d) % 3 === k ? 1 : 0.35;
        }
        return 0;
      }
      case 'talk': {
        if (c < 1 || c > 14) return 0;
        // ses dalgası: her sütun için rastgele seviye
        const key = side * 8 + Math.floor(c / 2);
        if (c % 2 === 0 && r === 0) this._levels[key] = 0.25 + Math.random() * 0.75 * (0.6 + 0.4 * Math.sin(t * 9 + key));
        const h = this._levels[key] * 4;
        return Math.abs(r - 3.5) <= h ? (Math.abs(r - 3.5) < 1 ? 1 : 0.7) : 0;
      }
      case 'off':
        return 0;
      case 'idle':
      default: {
        if (blink) return r === 4 && dc <= 4 ? 0.8 : 0;
        if (dc > 4.5) return 0;
        // yumuşak köşeli yatay göz
        if (r === 3 || r === 4) return 1;
        if ((r === 2 || r === 5) && dc <= 3.5) return 0.35;
        return 0;
      }
    }
  }
}

/**
 * Modeli kurar.
 * @param ctx oyun bağlamı (malzemeler için)
 * @returns {{ root, body, slabs, screen, axle }}
 */
export function buildTarsModel(ctx) {
  const M = ctx.materials;
  if (!shared) {
    const { map, bump } = makeBrushedTextures();
    const alu = new THREE.MeshStandardMaterial({
      name: 'tarsAluminium',
      color: 0xffffff,
      map,
      bumpMap: bump,
      bumpScale: 1.6,
      metalness: 0.72,
      roughness: 0.4,
      envMapIntensity: 1.4,
    });
    shared = { alu, slabGeo: slabGeometry(), details: [0, 1, 2, 3].map(detailGeometry) };
  }
  const dark = M.metalDark || new THREE.MeshStandardMaterial({ color: 0x3d3f43, metalness: 0.8, roughness: 0.5 });

  const root = new THREE.Group();
  root.name = 'TARS-model';
  const body = new THREE.Group();
  body.name = 'TARS-body';
  body.position.y = HINGE;
  root.add(body);

  // Yatay mil (boşluklarda görünür)
  const axleGeo = new THREE.CylinderGeometry(0.022, 0.022, TOTAL_W + 0.02, 12);
  axleGeo.rotateZ(Math.PI / 2);
  const axle = new THREE.Mesh(axleGeo, dark);
  axle.castShadow = true;
  body.add(axle);

  const screen = new TarsScreen();
  const slabs = [];
  for (let i = 0; i < 4; i++) {
    const pivot = new THREE.Group();
    pivot.name = `TARS-slab-${i}`;
    pivot.position.x = (i - 1.5) * PITCH;
    body.add(pivot);

    const shell = new THREE.Mesh(shared.slabGeo, shared.alu);
    shell.position.y = SLAB_H / 2 - HINGE;
    shell.castShadow = true;
    shell.receiveShadow = true;
    pivot.add(shell);

    const detail = new THREE.Mesh(shared.details[i], dark);
    detail.castShadow = true;
    pivot.add(detail);

    if (i === 1 || i === 2) {
      const sg = new THREE.PlaneGeometry(SCREEN_W, SCREEN_H);
      // her blok canvas'ın kendi yarısını gösterir
      const uv = sg.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setX(k, (i === 1 ? 0 : 0.5) + uv.getX(k) * 0.5);
      const sm = new THREE.Mesh(sg, screen.material);
      sm.position.set(0, SCREEN_Y - HINGE, SLAB_D / 2 + 0.0115);
      pivot.add(sm);
    }
    if (i === 0) {
      // küçük durum LED'i
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.006), M.ledAmber || dark);
      led.position.set(0.06, 1.42 - HINGE + 0.03, SLAB_D / 2 + 0.003);
      pivot.add(led);
    }
    slabs.push(pivot);
  }
  root.traverse((o) => {
    o.userData.dynamic = true;
  });
  return { root, body, slabs, screen, axle };
}
