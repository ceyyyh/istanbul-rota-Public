import * as THREE from 'three';
import { CORRIDOR_RADIUS, CORRIDOR_CENTER_Y, CORRIDOR_HALF_WIDTH } from '../ShipLayout.js';
import { addMesh, addBox } from '../utils.js';

/**
 * Modüller arası bağlantı tüpü (TASLAK — Ajan 1 "Yapı" geliştirecek).
 *
 * @param ctx   oyun bağlamı
 * @param info  ShipLayout.corridorInfo(i) çıktısı
 * @returns THREE.Group (dünya uzayında, sahneye eklenmiş olarak döner)
 *
 * Grup yerel uzayı: +X koridor boyunca (a → b), merkez orijinde, zemin y=0.
 * Çarpışma: yan duvarlar ±CORRIDOR_HALF_WIDTH'te iki doğru parçası (uçları
 * modül duvarlarına gömülecek kadar uzatılmış).
 */
export function buildCorridor(ctx, info) {
  const M = ctx.materials;
  const g = new THREE.Group();
  g.name = `corridor-${info.index}`;
  g.position.set(info.center.x, 0, info.center.z);
  g.rotation.y = info.rotationY;
  ctx.scene.add(g);

  const len = info.length + 0.8;
  const tube = new THREE.CylinderGeometry(CORRIDOR_RADIUS, CORRIDOR_RADIUS, len, 24, 1, true);
  tube.rotateZ(Math.PI / 2);
  addMesh(g, tube, M.panelLight, { pos: [0, CORRIDOR_CENTER_Y, 0] }).material.side = THREE.DoubleSide;
  addBox(g, { size: [len, 0.06, CORRIDOR_HALF_WIDTH * 2 + 0.3], pos: [0, -0.03, 0], material: M.floorGrate });

  // Çarpışma
  const ext = 0.45;
  const hw = CORRIDOR_HALF_WIDTH;
  const toWorld = (x, z) => new THREE.Vector3(x, 0, z).applyMatrix4(g.matrixWorld);
  g.updateMatrixWorld(true);
  for (const s of [-1, 1]) {
    const p = toWorld(-info.length / 2 - ext, s * hw);
    const q = toWorld(info.length / 2 + ext, s * hw);
    ctx.collision.addSegment(p.x, p.z, q.x, q.z, { tag: 'corridor' });
  }

  // Koridor ışığı
  const lp = toWorld(0, 0);
  ctx.lighting.addPointLight({
    position: new THREE.Vector3(lp.x, 2.2, lp.z),
    color: 0xe8f0ff,
    intensity: 3,
    distance: 6,
    emergency: { color: 0xff2a1a, intensity: 0.8 },
  });
  return g;
}
