import * as THREE from 'three';
import { buildRanger } from '../world/exterior/vehicles.js';
import { addBox, addMesh, addCylinder, markDynamic, mergeStatic } from '../world/utils.js';
import { addWorldBox, addRod } from '../world/structure/kit.js';
import { WATER_Y } from './water.js';

/** Suya inmiş Ranger: burun -X'e bakar, arka rampa +X'e (oyuncu tarafına) iner. Konum: gezegen yereli. */
export const RANGER_POS = { x: 6, y: 1.75, z: 0 };
export const RAMP = { x0: 7.1, x1: 11.75 }; // yerel x aralığı (rampa kalan uzunluğu)

export function buildLandedRanger(M) {
  const g = new THREE.Group();
  g.name = 'planet-ranger';
  g.position.set(RANGER_POS.x, RANGER_POS.y, RANGER_POS.z);
  g.rotation.y = Math.PI; // yerel +X (burun) → dünya -X

  const body = buildRanger(M);
  g.add(body);

  // iniş ayakları (karından suya)
  const groundY = WATER_Y - RANGER_POS.y - 0.04;
  for (const [x, z] of [[2.2, 1.0], [2.2, -1.0], [8.6, 0.9], [8.6, -0.9]]) {
    const zz = z * 1.7;
    addRod(g, [x, -1.15, z], [x, groundY + 0.08, zz], 0.07, M.metalDark, { segments: 6 });
    addCylinder(g, { radius: 0.42, height: 0.1, segments: 12, pos: [x, groundY + 0.02, zz], material: M.hullDark });
  }

  // arka açıklık: sıcak ışıklı kabin
  const warm = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.16, 0.13, 0.09) });
  const interior = addBox(g, { size: [0.06, 1.75, 1.55], pos: [-1.36, -0.12, 0], material: warm });
  markDynamic(interior);
  const bar = addBox(g, { size: [0.05, 0.08, 1.2], pos: [-1.395, 0.7, 0], material: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.15, 0.85) }) });
  markDynamic(bar);
  addBox(g, { size: [0.14, 1.95, 0.12], pos: [-1.4, -0.1, 0.86], material: M.hullDark });
  addBox(g, { size: [0.14, 1.95, 0.12], pos: [-1.4, -0.1, -0.86], material: M.hullDark });
  addBox(g, { size: [0.14, 0.12, 1.85], pos: [-1.4, 0.88, 0], material: M.hullDark });

  // gövdeyi birleştir (çizim çağrısı ↓); rampa ayrı ve dinamik
  mergeStatic(g);

  // --- rampa ---
  const rampLen = RAMP.x1 - RAMP.x0;
  const rampBottomY = WATER_Y + 0.02;
  const topY = -0.95 + RANGER_POS.y; // kabin tabanı (dünya y)
  const ang = Math.atan2(topY - rampBottomY, rampLen);
  const ramp = new THREE.Group();
  ramp.name = 'ramp';
  // dünya: rampa merkezi
  ramp.position.set((RAMP.x0 + RAMP.x1) / 2, (topY + rampBottomY) / 2, 0);
  ramp.rotation.z = ang; // +x ucu (Ranger tarafı) yüksek
  // not: Ranger grubunun dışında, dünya (gezegen yereli) yönelimde
  addWorldBox(ramp, { size: [rampLen / Math.cos(ang), 0.12, 2.0], pos: [0, 0, 0], material: M.metalDark, mpr: 1 });
  addBox(ramp, { size: [rampLen / Math.cos(ang), 0.2, 0.08], pos: [0, 0.1, 1.0], material: M.warning });
  addBox(ramp, { size: [rampLen / Math.cos(ang), 0.2, 0.08], pos: [0, 0.1, -1.0], material: M.warning });
  for (const sz of [-1, 1]) {
    for (const t of [-0.35, 0.05, 0.4]) addBox(ramp, { size: [0.05, 0.9, 0.05], pos: [t * rampLen, 0.5, sz * 1.0], material: M.handrail });
    addBox(ramp, { size: [rampLen / Math.cos(ang), 0.05, 0.05], pos: [0, 0.96, sz * 1.0], material: M.handrail });
  }
  mergeStatic(ramp);
  markDynamic(ramp);
  return { group: g, ramp, rampCenter: { x: (RAMP.x0 + RAMP.x1) / 2, z: 0 }, rampLen };
}
