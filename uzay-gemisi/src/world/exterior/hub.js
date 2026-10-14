import * as THREE from 'three';
import { RING_RADIUS, MODULE_WIDTH, WALL_THICKNESS } from '../ShipLayout.js';
import { addMesh, addBox } from '../utils.js';
import { addRod, addBolt, addWorldBox, scaleCylinderUVs } from '../structure/kit.js';
import { buildRanger, buildLander } from './vehicles.js';

/**
 * Halkanın merkezindeki yerleştirme (docking) göbeği, tellikler (spokes)
 * ve kenetlenmiş araçlar (Ranger / Lander). (Ajan 1 — Yapı)
 * Oyuncu buraya yürüyemez; yalnızca iç pencerelerden ve dış kameradan görünür.
 *
 *   - Göbek: dikey silindir (r = 4.2), altın folyo kuşağı, üst/alt kenetlenme portları, anten kümesi
 *   - 4 tellik: modül 1, 4, 7, 10 açılarında, göbekten halkanın iç duvarlarına (r ≈ 28.15)
 *   - Ranger @255° (modül 8–9 arası, hava kilidi önünde), Lander @345° (gözlem güvertesi önünde)
 *   - Boş yan portlar 75° ve 165°'de (kapaklı)
 *
 * @returns THREE.Group (sahneye eklenmiş)
 */
const HUB_R = 4.2;
const HUB_Y = 1.6;
const INNER_R = RING_RADIUS - MODULE_WIDTH / 2 - WALL_THICKNESS; // 28.15: modül iç duvarı (dış yüz)
const deg = (d) => (d * Math.PI) / 180;

/** Yatay (XZ) yönde, açı a'da, r'deki nokta. */
const polar = (a, r, y = HUB_Y) => [Math.cos(a) * r, y, Math.sin(a) * r];

export function buildHub(ctx) {
  const M = ctx.materials;
  const g = new THREE.Group();
  g.name = 'hub';
  ctx.scene.add(g);

  // --- Çekirdek silindir ---
  const coreH = 7.4;
  const core = new THREE.CylinderGeometry(HUB_R, HUB_R, coreH, 32, 1, false);
  scaleCylinderUVs(core, HUB_R, coreH, 4);
  addMesh(g, core, M.hullWhite, { pos: [0, HUB_Y, 0] });
  // altın MLI kuşağı + koyu halkalar
  const band = new THREE.CylinderGeometry(HUB_R + 0.03, HUB_R + 0.03, 2.2, 32, 1, true);
  scaleCylinderUVs(band, HUB_R, 2.2, 2.4);
  addMesh(g, band, M.hullGold, { pos: [0, HUB_Y, 0] });
  for (const dy of [-1.2, 1.2]) addMesh(g, new THREE.CylinderGeometry(HUB_R + 0.12, HUB_R + 0.12, 0.16, 32), M.hullDark, { pos: [0, HUB_Y + dy, 0] });
  for (const dy of [-3.35, 3.35]) addMesh(g, new THREE.CylinderGeometry(HUB_R + 0.18, HUB_R + 0.18, 0.2, 32), M.hullPanel, { pos: [0, HUB_Y + dy, 0] });
  // dikey kaburga şeritleri (koyu) — silindire panel hissi
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.1;
    addBox(g, { size: [0.14, coreH - 0.4, 0.1], pos: [Math.cos(a) * (HUB_R + 0.04), HUB_Y, Math.sin(a) * (HUB_R + 0.04)], rot: [0, -a + Math.PI / 2, 0], material: M.hullDark });
  }

  // --- Üst/alt eksenel kenetlenme portları ---
  for (const s of [-1, 1]) {
    const y0 = HUB_Y + s * (coreH / 2);
    addMesh(g, new THREE.CylinderGeometry(2.3, 2.9, 0.7, 24), M.hullPanel, { pos: [0, y0 + s * 0.35, 0] });
    addMesh(g, new THREE.CylinderGeometry(1.7, 1.7, 0.9, 20), M.hullDark, { pos: [0, y0 + s * 0.95, 0] });
    addMesh(g, new THREE.CylinderGeometry(1.45, 1.45, 0.1, 20), M.metalDark, { pos: [0, y0 + s * 1.43, 0] });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      addBox(g, { size: [0.3, 0.3, 0.5], pos: [Math.cos(a) * 1.75, y0 + s * 1.2, Math.sin(a) * 1.75], rot: [0, -a, 0], material: M.hullGold });
    }
    addWorldBox(g, { size: [4.4, 0.06, 4.4], pos: [0, y0 + s * 0.72, 0], material: M.hazardStripe, mpr: 0.5, rot: [0, 0.4, 0] });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      addRod(g, [Math.cos(a) * 0.9, y0 + s * 1.5, Math.sin(a) * 0.9], [Math.cos(a) * 2.5, y0 + s * 0.8, Math.sin(a) * 2.5], 0.05, M.metalDark, { segments: 5 });
    }
  }
  // üstte anten kümesi
  const top = HUB_Y + coreH / 2 + 1.5;
  addRod(g, [0, top, 0], [0, top + 3.2, 0], 0.09, M.aluminium, { segments: 8 });
  for (const [dy, len] of [[1.0, 1.6], [2.0, 1.1], [2.8, 0.7]]) {
    addRod(g, [-len, top + dy, 0], [len, top + dy, 0], 0.03, M.aluminium, { segments: 5 });
    addRod(g, [0, top + dy, -len], [0, top + dy, len], 0.03, M.aluminium, { segments: 5 });
  }
  addMesh(g, new THREE.SphereGeometry(0.7, 14, 6, 0, Math.PI * 2, Math.PI - 0.8, 0.8).translate(0, 0.7, 0), M.plasticWhite, { pos: [1.9, top - 0.2, 0.0], rot: [-0.5, 0, 0.5] });
  addBox(g, { size: [0.4, 0.4, 0.4], pos: [0, top + 3.3, 0], material: M.ledRed });

  // --- Yan portlar ve tellikler ---
  const spokeAngles = [30, 120, 210, 300].map(deg); // modül 1, 4, 7, 10
  const emptyPorts = [75, 165].map(deg);
  const vehicleAngles = { ranger: deg(255), lander: deg(345) };
  const portAt = (a, kind) => {
    // yerel eksen: +X göbekten dışa (ışınsal), halka düzlemi YZ
    const pg = new THREE.Group();
    pg.position.set(...polar(a, HUB_R));
    pg.rotation.y = -a;
    g.add(pg);
    const cyl = (r0, r1, len, seg = 20) => {
      const geo = new THREE.CylinderGeometry(r0, r1, len, seg);
      geo.rotateZ(Math.PI / 2);
      return geo;
    };
    addMesh(pg, cyl(1.5, 1.7, 1.2), M.hullDark, { pos: [0.55, 0, 0] });
    addMesh(pg, cyl(1.75, 1.75, 0.18), M.hullPanel, { pos: [1.1, 0, 0] });
    for (let i = 0; i < 8; i++) {
      const t = (i / 8) * Math.PI * 2;
      addBox(pg, { size: [0.3, 0.3, 0.34], pos: [1.05, Math.sin(t) * 1.6, Math.cos(t) * 1.6], rot: [-t, 0, 0], material: M.hullGold });
    }
    if (kind === 'empty') {
      addMesh(pg, cyl(1.3, 1.3, 0.12), M.hullPanel, { pos: [1.28, 0, 0] });
      addBox(pg, { size: [0.08, 0.5, 0.5], pos: [1.36, 0, 0], material: M.ledAmber });
    }
  };
  spokeAngles.forEach((a) => portAt(a, 'spoke'));
  emptyPorts.forEach((a) => portAt(a, 'empty'));
  portAt(vehicleAngles.ranger, 'vehicle');
  portAt(vehicleAngles.lander, 'vehicle');

  // --- Tellikler: göbekten halkanın iç duvarlarına ---
  for (const a of spokeAngles) {
    const r0 = HUB_R + 1.2;
    const r1 = INNER_R - 0.02;
    const A = polar(a, r0);
    const B = polar(a, r1);
    const len = r1 - r0;
    addRod(g, A, B, 0.62, M.hullWhite, { segments: 16, openEnded: true, mpr: 3.5 });
    // altın bantlar ve koyu halkalar
    const nBand = 5;
    for (let k = 0; k < nBand; k++) {
      const t = (k + 0.7) / (nBand + 0.4);
      const c0 = r0 + len * (t - 0.035);
      const c1 = r0 + len * (t + 0.035);
      addRod(g, polar(a, c0), polar(a, c1), 0.67, M.hullGold, { segments: 16, mpr: 2.4 });
    }
    // üçgen kafes (üç boyuna çubuk + çerçeve halkaları + çaprazlar)
    const R = 1.0;
    const bays = 9;
    const side = [Math.sin(a), 0, -Math.cos(a)];
    const offs = [0, 1, 2].map((i) => {
      const ang = (i / 3) * Math.PI * 2 + Math.PI / 2;
      return [side[0] * Math.cos(ang) * R, Math.sin(ang) * R, side[2] * Math.cos(ang) * R];
    });
    const at = (i, t) => {
      const p = polar(a, r0 + 1.4 + (len - 2.8) * t);
      return [p[0] + offs[i][0], p[1] + offs[i][1], p[2] + offs[i][2]];
    };
    for (let i = 0; i < 3; i++) addRod(g, at(i, 0), at(i, 1), 0.05, M.hullDark, { segments: 5 });
    for (let k = 0; k <= bays; k++) {
      const t = k / bays;
      for (let i = 0; i < 3; i++) {
        addRod(g, at(i, t), at((i + 1) % 3, t), 0.04, M.hullDark, { segments: 5 });
        addRod(g, at(i, t), polar(a, r0 + 1.4 + (len - 2.8) * t), 0.03, M.hullDark, { segments: 4 });
        if (k < bays) addRod(g, at(i, t), at((i + 1) % 3, t + 1 / bays), 0.03, M.hullDark, { segments: 4 });
      }
    }
    // halkaya bağlanan flanş (modül iç duvarında) + cıvatalar
    const fl = new THREE.Group();
    fl.position.set(...polar(a, INNER_R - 0.14));
    fl.rotation.y = -a;
    addBox(fl, { size: [0.3, 2.6, 2.6], material: M.hullDark });
    addBox(fl, { size: [0.12, 2.0, 2.0], pos: [-0.2, 0, 0], material: M.hullPanel });
    for (const [dy, dz] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]]) addBolt(fl, [-0.2, dy, dz], 'x', M.hullGold, 0.08, 0.1);
    const collar = new THREE.CylinderGeometry(0.8, 0.95, 0.5, 16);
    collar.rotateZ(Math.PI / 2);
    addMesh(fl, collar, M.hullWhite, { pos: [-0.32, 0, 0] });
    g.add(fl);
  }

  // --- Araçlar ---
  const placeVehicle = (obj, a, r) => {
    obj.position.set(...polar(a, r));
    obj.rotation.y = -a;
    g.add(obj);
  };
  placeVehicle(buildRanger(M), vehicleAngles.ranger, HUB_R + 1.9);
  placeVehicle(buildLander(M), vehicleAngles.lander, HUB_R + 1.3);
  return g;
}
