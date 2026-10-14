import * as THREE from 'three';

/**
 * TARS robotu (TASLAK — Ajan 5 "TARS & Oynanış" yeniden yazacak).
 */
export class Tars {
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.name = 'TARS';
    const mat = ctx.materials.metal;
    for (let i = 0; i < 4; i++) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.6, 0.4), mat);
      slab.position.set((i - 1.5) * 0.24, 0.8, 0);
      this.group.add(slab);
    }
    ctx.scene.add(this.group);
  }
  placeAt(x, z, yaw = 0) {
    this.group.position.set(x, 0, z);
    this.group.rotation.y = yaw;
  }
  update() {}
}
