import * as THREE from 'three';
import { RING_RADIUS } from '../ShipLayout.js';
import { addMesh } from '../utils.js';

/**
 * Halkanın merkezindeki yerleştirme (docking) göbeği, tellikler (spokes)
 * ve kenetlenmiş araçlar (Ranger / Lander).
 * (TASLAK — Ajan 1 "Yapı" detaylandıracak. Oyuncu buraya yürüyemez; sadece
 * iç pencerelerden görünür.)
 *
 * @returns THREE.Group (sahneye eklenmiş)
 */
export function buildHub(ctx) {
  const M = ctx.materials;
  const g = new THREE.Group();
  g.name = 'hub';
  ctx.scene.add(g);
  addMesh(g, new THREE.CylinderGeometry(4, 4, 6, 32), M.hullWhite, { pos: [0, 1.6, 0] });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 12;
    const spoke = new THREE.CylinderGeometry(0.5, 0.5, RING_RADIUS - 8, 12);
    spoke.rotateZ(Math.PI / 2);
    const m = addMesh(g, spoke, M.metal, { pos: [Math.cos(a) * (RING_RADIUS / 2), 1.6, Math.sin(a) * (RING_RADIUS / 2)] });
    m.rotation.y = -a;
  }
  return g;
}
