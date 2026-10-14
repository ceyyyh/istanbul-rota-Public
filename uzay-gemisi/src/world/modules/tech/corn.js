import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from './materials.js';

/**
 * Prosedürel düşük poligonlu mısır bitkisi (Zea mays).
 * Üç ayrı geometri döner (InstancedMesh için): gövde+yapraklar, koçanlar, kavuz+püskül.
 * Birim bitki ~1.7 m boyunda, tabanı y = 0'da.
 */

/** Yaprak şeridi: gövdeden çıkıp yükselen, sonra sarkan, uca doğru incelen bant. */
function leafGeometry({ length, width, azimuth, baseY, rise = 0.6, droop = 0.9, twist = 0.3, segs = 6 }) {
  const pos = [];
  const uv = [];
  const ca = Math.cos(azimuth);
  const sa = Math.sin(azimuth);
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const r = length * t;
    const out = 0.012 + r * 0.92;
    const y = baseY + r * rise - droop * length * t * t;
    const w = width * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.08)) * (1 - t * 0.35);
    const tw = twist * t;
    // yatay dik yön (azimut + 90°), uca doğru hafif bükülmüş
    const px = -sa * Math.cos(tw);
    const pz = ca * Math.cos(tw);
    const py = Math.sin(tw) * 0.5;
    const cx = ca * out;
    const cz = sa * out;
    pts.push([
      [cx + px * w * 0.5, y + py * w * 0.5, cz + pz * w * 0.5],
      [cx - px * w * 0.5, y - py * w * 0.5 + w * 0.12, cz - pz * w * 0.5],
      t,
    ]);
  }
  for (let i = 0; i < segs; i++) {
    const [a0, b0, t0] = pts[i];
    const [a1, b1, t1] = pts[i + 1];
    pos.push(...a0, ...b0, ...a1, ...b0, ...b1, ...a1);
    uv.push(0, t0, 1, t0, 0, t1, 1, t0, 1, t1, 0, t1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function nonIndexed(g) {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k);
  if (!n.attributes.normal) n.computeVertexNormals();
  return n;
}

/**
 * @param {object} o
 * @param {number} o.height  gövde boyu
 * @param {number} o.seed
 * @returns {{ plant: THREE.BufferGeometry, cob: THREE.BufferGeometry, husk: THREE.BufferGeometry }}
 */
export function createCornGeometries({ height = 1.7, seed = 3, leaves = 9, cobs = 2, tassel = true } = {}) {
  const r = rng(seed);
  const plantParts = [];
  const stalk = new THREE.CylinderGeometry(0.013, 0.024, height, 5, 3, true);
  stalk.translate(0, height / 2, 0);
  plantParts.push(nonIndexed(stalk));
  let az = r() * Math.PI * 2;
  for (let i = 0; i < leaves; i++) {
    const t = i / (leaves - 1);
    const baseY = 0.18 + t * (height - 0.42);
    const length = 0.75 - Math.abs(t - 0.4) * 0.5 + r() * 0.08;
    az += Math.PI + (r() - 0.5) * 0.7;
    plantParts.push(
      leafGeometry({
        length,
        width: 0.075 - t * 0.02,
        azimuth: az,
        baseY,
        rise: 0.75 + r() * 0.3 - t * 0.2,
        droop: 0.85 + r() * 0.35,
        twist: (r() - 0.5) * 0.9,
      }),
    );
  }
  const plant = mergeGeometries(plantParts, false);

  const cobParts = [];
  const huskParts = [];
  for (let i = 0; i < cobs; i++) {
    const y = height * (0.45 + i * 0.13);
    const a = r() * Math.PI * 2;
    const tilt = 0.45 + r() * 0.2;
    const cob = new THREE.CylinderGeometry(0.02, 0.03, 0.17, 6, 1);
    cob.translate(0, 0.1, 0);
    // eğim yerel +X'e doğru: önce z ekseninde eğ, sonra azimut
    const q = new THREE.Matrix4().makeRotationZ(-tilt);
    const yaw = new THREE.Matrix4().makeRotationY(-a);
    const tr = new THREE.Matrix4().makeTranslation(Math.cos(a) * 0.02, y, Math.sin(a) * 0.02);
    const xf = new THREE.Matrix4().multiply(tr).multiply(yaw).multiply(q);
    cob.applyMatrix4(xf);
    cobParts.push(nonIndexed(cob));
    const husk = new THREE.CylinderGeometry(0.012, 0.036, 0.15, 6, 1, true);
    husk.translate(0, 0.075, 0);
    husk.applyMatrix4(xf);
    huskParts.push(nonIndexed(husk));
  }
  if (tassel) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + r();
      const c = new THREE.ConeGeometry(0.006, 0.22, 3, 1, true);
      c.translate(0, 0.11, 0);
      const xf = new THREE.Matrix4()
        .makeTranslation(0, height - 0.02, 0)
        .multiply(new THREE.Matrix4().makeRotationY(a))
        .multiply(new THREE.Matrix4().makeRotationZ(i === 0 ? 0 : 0.5 + r() * 0.3));
      c.applyMatrix4(xf);
      huskParts.push(nonIndexed(c));
    }
  }
  const cob = cobParts.length ? mergeGeometries(cobParts, false) : null;
  const husk = huskParts.length ? mergeGeometries(huskParts, false) : null;
  return { plant, cob, husk };
}

/**
 * Bir mısır tarlası kurar (3 InstancedMesh). positions: [{x, z, s, rot}]
 * @returns {THREE.Group}
 */
export function buildCornField(materials, positions, { seed = 5, height = 1.7, baseY = 0, colors } = {}) {
  const geos = createCornGeometries({ height, seed });
  const group = new THREE.Group();
  group.name = 'mısır';
  const n = positions.length;
  const meshes = {
    plant: new THREE.InstancedMesh(geos.plant, materials.leaf, n),
    cob: new THREE.InstancedMesh(geos.cob, materials.cob, n),
    husk: new THREE.InstancedMesh(geos.husk, materials.husk, n),
  };
  const r = rng(seed * 31 + 7);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const c = new THREE.Color();
  const leafCols = colors?.leaf ?? [0x5d8f2c, 0x689c33, 0x547f27, 0x73a03a, 0x86953a];
  const cobCols = colors?.cob ?? [0xe6c146, 0xf0cf5a, 0xd9b23c];
  const huskCols = colors?.husk ?? [0x9fae5a, 0xb4b26a, 0x8fa04e];
  positions.forEach((p, i) => {
    e.set((r() - 0.5) * 0.08, p.rot ?? r() * Math.PI * 2, (r() - 0.5) * 0.08);
    q.setFromEuler(e);
    const sc = p.s ?? 0.9 + r() * 0.2;
    s.set(sc, sc * (0.95 + r() * 0.1), sc);
    v.set(p.x, p.y ?? baseY, p.z);
    m.compose(v, q, s);
    for (const k of ['plant', 'cob', 'husk']) meshes[k].setMatrixAt(i, m);
    meshes.plant.setColorAt(i, c.set(leafCols[Math.floor(r() * leafCols.length)]));
    meshes.cob.setColorAt(i, c.set(cobCols[Math.floor(r() * cobCols.length)]));
    meshes.husk.setColorAt(i, c.set(huskCols[Math.floor(r() * huskCols.length)]));
  });
  for (const k of ['plant', 'cob', 'husk']) {
    const im = meshes[k];
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  }
  return group;
}
