import * as THREE from 'three';
import { addBox, addCylinder, addMesh, mergeStatic } from '../../utils.js';
import { createScreen } from '../../materials.js';
import { getTechMaterials, tiledPlane } from './materials.js';
import { addLabel } from './labels.js';

/**
 * Teknik modüller için geometri ve davranış yardımcıları (Ajan 4).
 * Tüm konumlar parent'ın yerel uzayındadır (modül yerel koordinatları).
 */

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** İki nokta arasında silindir (açık uçlu). */
export function addRod(parent, from, to, { radius = 0.04, material, segments = 10, openEnded = true, dynamic, name } = {}) {
  _a.set(from[0], from[1], from[2]);
  _b.set(to[0], to[1], to[2]);
  const len = _a.distanceTo(_b);
  if (len < 1e-4) return null;
  const geo = new THREE.CylinderGeometry(radius, radius, len, segments, 1, openEnded);
  const m = addMesh(parent, geo, material, { dynamic, name });
  m.position.copy(_a).add(_b).multiplyScalar(0.5);
  _b.sub(_a).normalize();
  _q.setFromUnitVectors(UP, _b);
  m.quaternion.copy(_q);
  return m;
}

/**
 * Boru hattı: noktalar arası silindirler + dirsek küreleri + uçlarda flanşlar.
 * points: [[x,y,z], ...]
 */
export function addPipe(parent, points, { radius = 0.05, material, segments = 10, flanges = true, flangeMaterial, joints = true } = {}) {
  const M = getTechMaterials();
  for (let i = 0; i < points.length - 1; i++) addRod(parent, points[i], points[i + 1], { radius, material, segments });
  if (joints) {
    for (let i = 1; i < points.length - 1; i++) {
      addMesh(parent, new THREE.SphereGeometry(radius * 1.12, segments, Math.max(4, segments >> 1)), material, { pos: points[i] });
    }
  }
  if (flanges) {
    const fm = flangeMaterial || M.steelBrushed;
    for (const [i, j] of [
      [0, 1],
      [points.length - 1, points.length - 2],
    ]) {
      const p = points[i];
      const q = points[j];
      _a.set(q[0] - p[0], q[1] - p[1], q[2] - p[2]).normalize();
      const f = [p[0] + _a.x * 0.03, p[1] + _a.y * 0.03, p[2] + _a.z * 0.03];
      const f2 = [p[0] + _a.x * 0.07, p[1] + _a.y * 0.07, p[2] + _a.z * 0.07];
      addRod(parent, f, f2, { radius: radius * 1.5, material: fm, segments, openEnded: false });
    }
  }
}

/** Boru üzerindeki ara flanş/kelepçe halkası. */
export function addCollar(parent, at, dir, { radius = 0.06, width = 0.05, material } = {}) {
  const M = getTechMaterials();
  _a.set(dir[0], dir[1], dir[2]).normalize();
  const h = width / 2;
  return addRod(
    parent,
    [at[0] - _a.x * h, at[1] - _a.y * h, at[2] - _a.z * h],
    [at[0] + _a.x * h, at[1] + _a.y * h, at[2] + _a.z * h],
    { radius, material: material || M.steelBrushed, openEnded: false, segments: 12 },
  );
}

/** Vana el çarkı (yerel +Z'ye bakar, XY düzleminde). Grup döndürür. */
export function makeHandwheel(radius = 0.14, material) {
  const M = getTechMaterials();
  const mat = material || M.pipeRed;
  const g = new THREE.Group();
  g.name = 'el-çarkı';
  addMesh(g, new THREE.TorusGeometry(radius, radius * 0.13, 6, 18), mat);
  for (let i = 0; i < 3; i++) {
    const s = addBox(g, { size: [radius * 2, radius * 0.12, radius * 0.1], material: mat });
    s.rotation.z = (i * Math.PI) / 3;
  }
  addCylinder(g, { radius: radius * 0.22, height: radius * 0.4, segments: 10, material: M.steelBrushed, rot: [Math.PI / 2, 0, 0] });
  return g;
}

/**
 * Basınç göstergesi (kadran + ibre). Yüz +Z'ye bakar.
 * @returns {{ group, needle, set(v01) }}  — needle'ı animasyonlu yapacaksanız group'u dinamik yapın
 */
export function addGauge(parent, { pos = [0, 0, 0], rot = [0, 0, 0], radius = 0.09, value = 0.3, dynamic = false } = {}) {
  const M = getTechMaterials();
  const g = new THREE.Group();
  g.position.set(pos[0], pos[1], pos[2]);
  g.rotation.set(rot[0], rot[1], rot[2]);
  parent.add(g);
  addCylinder(g, { radius: radius * 1.12, height: 0.04, segments: 18, material: M.steelBrushed, rot: [Math.PI / 2, 0, 0], pos: [0, 0, -0.01] });
  addMesh(g, new THREE.CircleGeometry(radius, 20), M.gaugeFace, { pos: [0, 0, 0.0105] });
  const needle = new THREE.Group();
  needle.position.z = 0.016;
  addBox(needle, { size: [radius * 0.06, radius * 0.85, 0.004], pos: [0, radius * 0.38, 0], material: M.needle });
  addCylinder(needle, { radius: radius * 0.09, height: 0.006, segments: 8, material: M.needle, rot: [Math.PI / 2, 0, 0] });
  g.add(needle);
  if (dynamic) finalizeDynamic(needle);
  const set = (v) => {
    const c = Math.min(1.05, Math.max(-0.02, v));
    // 0 → -135°, 1 → +135° (saat yönünde artar)
    needle.rotation.z = THREE.MathUtils.degToRad(135 - 270 * c);
  };
  set(value);
  return { group: g, needle, set };
}

/** Sarı-siyah tehlike şeridi düzlemi (normal +Z). */
export function addHazard(parent, { w = 1, h = 0.1, pos = [0, 0, 0], rot = [0, 0, 0], tile = 0.3 } = {}) {
  const M = getTechMaterials();
  const m = addMesh(parent, tiledPlane(w, h, tile), M.hazard, { pos, rot });
  m.userData.noShadow = true;
  return m;
}

/** Zemine yatay tehlike şeridi (y = 0.005). */
export function addFloorHazard(parent, { w = 1, d = 0.12, pos = [0, 0], rotY = 0 } = {}) {
  return addHazard(parent, { w, h: d, pos: [pos[0], 0.006, pos[1]], rot: [-Math.PI / 2, 0, rotY] });
}

/** Sarkık kablo demeti (TubeGeometry, birkaç kablo). from/to: [x,y,z] */
export function addCableBundle(parent, from, to, { sag = 0.25, count = 3, radius = 0.012, material, spread = 0.03, segments = 12 } = {}) {
  const M = getTechMaterials();
  const mat = material || M.graphite;
  for (let i = 0; i < count; i++) {
    const off = (i - (count - 1) / 2) * spread;
    const a = new THREE.Vector3(from[0], from[1], from[2] + off);
    const b = new THREE.Vector3(to[0], to[1], to[2] + off);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y -= sag * (0.85 + i * 0.12);
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    addMesh(parent, new THREE.TubeGeometry(curve, segments, radius, 5, false), mat);
  }
}

/** Duvara monte tutunma korkuluğu (X boyunca), duvar normali `side` (+1 → +Z'ye bakar). */
export function addHandrail(parent, M, { x0, x1, y = 1.1, z, side = 1 }) {
  const zr = z + side * 0.07;
  addRod(parent, [x0, y, zr], [x1, y, zr], { radius: 0.018, material: M.handrail, segments: 8 });
  const n = Math.max(2, Math.round((x1 - x0) / 1.2) + 1);
  for (let i = 0; i < n; i++) {
    const x = x0 + ((x1 - x0) * i) / (n - 1);
    addRod(parent, [x, y, z], [x, y, zr], { radius: 0.014, material: M.handrail, segments: 6 });
  }
}

/** Kenarlı çalışma tezgâhı. Üst yüzey yüksekliği h. Grup döndürür (collide). */
export function addBench(parent, M, { x, z, w, d, h = 0.92, top, body, drawers = true, legs = false, rotY = 0 }) {
  const T = getTechMaterials();
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  parent.add(g);
  addBox(g, { size: [w, 0.05, d], pos: [0, h - 0.025, 0], material: top || T.epoxy });
  if (legs) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) addBox(g, { size: [0.05, h - 0.05, 0.05], pos: [sx * (w / 2 - 0.05), (h - 0.05) / 2, sz * (d / 2 - 0.05)], material: M.metalDark });
    addBox(g, { size: [w - 0.1, 0.03, d - 0.1], pos: [0, 0.25, 0], material: M.metalDark });
  } else {
    addBox(g, { size: [w - 0.04, h - 0.12, d - 0.06], pos: [0, (h - 0.12) / 2 + 0.07, -0.01], material: body || M.panelMid });
    addBox(g, { size: [w - 0.1, 0.07, d - 0.14], pos: [0, 0.035, -0.03], material: M.plasticDark });
    if (drawers) {
      const n = Math.max(1, Math.floor(w / 0.55));
      const dw = (w - 0.08) / n;
      for (let i = 0; i < n; i++) {
        const cx = -w / 2 + 0.04 + dw * (i + 0.5);
        for (let r = 0; r < 2; r++) {
          const cy = 0.32 + r * 0.32;
          addBox(g, { size: [dw - 0.03, 0.28, 0.012], pos: [cx, cy, d / 2 - 0.035], material: M.panelLight });
          addBox(g, { size: [0.14, 0.02, 0.025], pos: [cx, cy + 0.09, d / 2 - 0.02], material: M.metal });
        }
      }
    }
  }
  g.userData.collide = true;
  return g;
}

/** Duvar rafı (konsol + raf tahtası). side: duvarın baktığı yön (+1 → +Z, -1 → -Z). */
export function addShelf(parent, M, { x, y, z, w, d = 0.3, side = -1, material }) {
  addBox(parent, { size: [w, 0.025, d], pos: [x, y, z], material: material || M.metal });
  for (const sx of [-1, 1]) {
    addBox(parent, { size: [0.025, 0.12, d * 0.85], pos: [x + sx * (w / 2 - 0.06), y - 0.07, z - side * 0.02], material: M.metalDark });
  }
  addBox(parent, { size: [w, 0.04, 0.012], pos: [x, y + 0.02, z + side * (d / 2)], material: M.metalDark });
}

/** Havalandırma ızgarası (duvar düzleminde, normal +Z). */
export function addVent(parent, M, { pos, rot = [0, 0, 0], w = 0.5, h = 0.3 }) {
  const g = new THREE.Group();
  g.position.set(pos[0], pos[1], pos[2]);
  g.rotation.set(rot[0], rot[1], rot[2]);
  parent.add(g);
  addBox(g, { size: [w, h, 0.02], material: M.panelDark });
  const n = Math.max(3, Math.round(h / 0.045));
  for (let i = 0; i < n; i++) {
    const s = addBox(g, { size: [w - 0.04, 0.012, 0.03], pos: [0, -h / 2 + (h * (i + 0.5)) / n, 0.015], material: M.metalDark });
    s.rotation.x = -0.6;
  }
  return g;
}

/** Yangın söndürücü (duvar braketli). side: duvarın baktığı yön (+1 → +Z, -1 → -Z). */
export function addExtinguisher(parent, M, { x, z, side = 1, y = 0.45 }) {
  const T = getTechMaterials();
  addCylinder(parent, { radius: 0.075, height: 0.5, segments: 12, pos: [x, y + 0.25, z], material: T.toolRed });
  addCylinder(parent, { radius: 0.03, height: 0.08, segments: 8, pos: [x, y + 0.54, z], material: M.metalDark });
  addBox(parent, { size: [0.12, 0.03, 0.04], pos: [x, y + 0.6, z + side * 0.01], material: M.plasticDark });
  addBox(parent, { size: [0.18, 0.06, 0.1], pos: [x, y + 0.35, z - side * 0.05], material: M.metalDark });
  addLabel(parent, 'YANGIN', { pos: [x, y + 0.26, z + side * 0.077], rot: [0, side > 0 ? 0 : Math.PI, 0], height: 0.04, style: 'white' });
}

/** Görünmez çarpışma kutusu (statik; görünmez malzemeyle birleşir, çizilmez). */
let blockMat = null;
export function addBlocker(parent, { size, pos, rotY = 0 }) {
  if (!blockMat) {
    blockMat = new THREE.MeshBasicMaterial({ visible: false });
    blockMat.name = 'tech.blocker';
  }
  return addBox(parent, { size, pos, rot: [0, rotY, 0], material: blockMat, collide: true, name: 'engel' });
}

/** Ayak tutucu (zemin halkası, eski bir sıfır-g alışkanlığı). */
export function addFootLoop(parent, M, { x, z, rotY = 0 }) {
  const m = addMesh(parent, new THREE.TorusGeometry(0.12, 0.012, 5, 10, Math.PI), M.handrail, { pos: [x, 0.0, z], rot: [0, rotY, 0] });
  return m;
}

/**
 * Canvas ekran + çerçeve. Çerçeve statik birleşir, ekran yüzü dinamik kalır.
 * @returns {{ screen, mesh, holder }}  screen = createScreen() sonucu
 */
export function addScreen(parent, M, { size = [0.6, 0.38], pos = [0, 0, 0], rot = [0, 0, 0], res = [512, 320], color = '#52ff7a', background = '#020402', bezel = 0.035, depth = 0.05, emissiveIntensity = 1.2 } = {}) {
  const holder = new THREE.Group();
  holder.position.set(pos[0], pos[1], pos[2]);
  holder.rotation.set(rot[0], rot[1], rot[2]);
  parent.add(holder);
  addBox(holder, { size: [size[0] + bezel * 2, size[1] + bezel * 2, depth], pos: [0, 0, -depth / 2], material: M.plasticDark });
  const screen = createScreen({ width: res[0], height: res[1], color, background, emissiveIntensity });
  const mesh = addMesh(holder, new THREE.PlaneGeometry(size[0], size[1]), screen.material, { pos: [0, 0, 0.002], dynamic: true });
  mesh.userData.noShadow = true;
  screen.baseIntensity = emissiveIntensity;
  return { screen, mesh, holder };
}

/** "ENERJİ YOK" ekranı çizer (karartılmış). */
export function drawNoPower(screen, text = 'ENERJİ YOK') {
  if (!screen.ctx) return;
  screen.draw((g, w, h) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,70,50,0.55)';
    g.font = `bold ${Math.round(h / 8)}px monospace`;
    g.textAlign = 'center';
    g.fillText(text, w / 2, h / 2 - h / 16);
    g.textAlign = 'left';
  });
  screen.material.emissiveIntensity = 0.35;
}

/** Ekranın parlaklığını normale döndürür. */
export function screenOn(screen) {
  screen.material.emissiveIntensity = screen.baseIntensity ?? 1.2;
}

/**
 * Oyuncu yakın mı? (modül merkezine yatay uzaklık). Her karede ucuz.
 * @returns {() => boolean}
 */
export function nearChecker(mctx, radius = 12, local = [0, 0, 0]) {
  const c = mctx.toWorld(local[0], local[1], local[2]);
  const r2 = radius * radius;
  return () => {
    const p = mctx.player.position;
    const dx = p.x - c.x;
    const dz = p.z - c.z;
    return dx * dx + dz * dz < r2;
  };
}

/** Yerel bir noktanın dünya konumu (ses konumu için). */
export function worldPoint(mctx, x, y, z) {
  return mctx.toWorld(x, y, z);
}

/**
 * Bir alt grubu dinamik yapar ve kendi içinde malzemeye göre birleştirir
 * (dönen/hareketli çok parçalı nesnelerde çizim çağrısını azaltır).
 */
export function finalizeDynamic(group) {
  mergeStatic(group);
  group.userData.dynamic = true;
  group.traverse((o) => {
    if (o.isMesh && !o.material.transparent) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return group;
}

/** Görünmez etkileşim kutusu (malzeme görünmez ama ışın çarpar). */
let hitMat = null;
export function addHitBox(parent, { size, pos = [0, 0, 0], rot = [0, 0, 0], name }) {
  if (!hitMat) {
    hitMat = new THREE.MeshBasicMaterial({ visible: false });
    hitMat.name = 'tech.hitbox';
  }
  const m = addBox(parent, { size, pos, rot, material: hitMat, name, dynamic: true });
  return m;
}

/** Bir gruptaki tüm meshlerin malzemesini değiştirir (LED'ler vb.). */
export function setMaterial(obj, mat) {
  obj.traverse((o) => {
    if (o.isMesh) o.material = mat;
  });
}

/** Türkçe belirtme hâli eki: 1'i, 2'yi, 3'ü, 4'ü, 5'i, 6'yı ... */
export function accusative(n) {
  const map = { 0: "'ı", 1: "'i", 2: "'yi", 3: "'ü", 4: "'ü", 5: "'i", 6: "'yı", 7: "'yi", 8: "'i", 9: "'u" };
  return `${n}${map[n % 10]}`;
}

/** Basit kaba metin kaydırma (ekranlar için). */
export function wrapText(g, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (g.measureText(t).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Kütüphane malzemeli (ctx.materials) kutu / silindir / düzlem geometrilerinin UV'lerini metreye
 * göre ölçekler (döşenebilir dokular yüzey boyunca doğru tekrarlansın diye). Kabuk ve kapılar
 * (Ajan 1) atlanır; etiket atlası, ekranlar ve teknik malzemeler dokunulmaz.
 * Her build() sonunda bir kez çağrılır. tile: dokunun bir tekrarının metre cinsinden boyu.
 */
export function applyMetricUVs(root, M, tile = 1) {
  const lib = new Set(Object.values(M));
  const visit = (o) => {
    if (o !== root && (o.name === 'shell' || o.name === 'door')) return;
    if (o.isMesh && !o.isInstancedMesh && lib.has(o.material)) {
      const geo = o.geometry;
      const p = geo.parameters;
      const uv = geo.attributes.uv;
      if (p && uv && !geo.userData.metricUV) {
        geo.userData.metricUV = true;
        if (geo.type === 'BoxGeometry' && p.widthSegments === 1 && p.heightSegments === 1 && p.depthSegments === 1) {
          const dims = [
            [p.depth, p.height],
            [p.depth, p.height],
            [p.width, p.depth],
            [p.width, p.depth],
            [p.width, p.height],
            [p.width, p.height],
          ];
          for (let f = 0; f < 6; f++) {
            for (let k = 0; k < 4; k++) {
              const i = f * 4 + k;
              uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile);
            }
          }
        } else if (geo.type === 'CylinderGeometry') {
          const r = (p.radiusTop + p.radiusBottom) / 2;
          const torso = (p.radialSegments + 1) * (p.heightSegments + 1);
          for (let i = 0; i < uv.count; i++) {
            if (i < torso) uv.setXY(i, (uv.getX(i) * 2 * Math.PI * r) / tile, (uv.getY(i) * p.height) / tile);
            else uv.setXY(i, (uv.getX(i) * 2 * r) / tile, (uv.getY(i) * 2 * r) / tile);
          }
        } else if (geo.type === 'PlaneGeometry') {
          for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * p.width) / tile, (uv.getY(i) * p.height) / tile);
        }
        uv.needsUpdate = true;
      }
    }
    for (const c of o.children) visit(c);
  };
  visit(root);
}

/**
 * Açık raf ünitesi (arka panel + dikmeler + raflar); içerik görünür kalır. Çarpışma kutusu dahil.
 * Ön yüz `side` yönüne bakar (-1 → -Z, iç duvar rafları; +1 → +Z, dış duvar rafları).
 * @returns {number[]} raf tablası yükseklikleri
 */
export function addOpenRack(parent, M, { x, z, w, h = 2.0, d = 0.45, shelves = 4, side = -1, material, y0 = 0.12 }) {
  const mat = material || M.metalDark;
  const back = z - side * (d / 2 - 0.015);
  addBox(parent, { size: [w, h, 0.03], pos: [x, h / 2, back], material: mat });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) addBox(parent, { size: [0.04, h, 0.04], pos: [x + sx * (w / 2 - 0.02), h / 2, z + sz * (d / 2 - 0.02)], material: mat });
  for (const sx of [-1, 1]) addBox(parent, { size: [0.02, h - 0.04, d - 0.06], pos: [x + sx * (w / 2 - 0.02), h / 2, z], material: M.metal });
  const ys = [];
  for (let r = 0; r < shelves; r++) {
    const y = y0 + (r * (h - y0 - 0.1)) / Math.max(1, shelves - 1);
    addBox(parent, { size: [w - 0.04, 0.025, d - 0.02], pos: [x, y, z], material: M.metal });
    addBox(parent, { size: [w - 0.04, 0.04, 0.015], pos: [x, y + 0.02, z + side * (d / 2 - 0.01)], material: M.warning });
    ys.push(y + 0.0125);
  }
  addBlocker(parent, { size: [w, Math.min(h, 1.8), d], pos: [x, Math.min(h, 1.8) / 2 + 0.05, z] });
  return ys;
}
