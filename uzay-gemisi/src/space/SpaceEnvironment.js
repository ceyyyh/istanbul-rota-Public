import * as THREE from 'three';

/**
 * Uzay ortamı (TASLAK — Ajan 2 "Uzay" yeniden yazacak; API sabit kalmalı).
 *
 * İçerik engine.spaceScene'e eklenir (sonsuz uzaklıkta, kamera orijinde).
 * Gemiyi aydınlatan "güneş" (kara deliğin yığılma diski ışığı) ana sahnededir.
 *
 * API:
 *   space.update(dt, t)
 *   space.spinSpeed               halkanın dönüş hızı (rad/s). Uzay, gemiye göre ters yönde döner.
 *   space.setSpin(radPerSec, rampSeconds)
 *   space.getBlackHoleDirection(out?)   dünya uzayında kara deliğe birim yön (teleskop için)
 *   space.sunLight                THREE.DirectionalLight (ana sahnede)
 */
export class SpaceEnvironment {
  constructor(ctx) {
    this.ctx = ctx;
    this.root = new THREE.Group();
    this.root.name = 'space';
    ctx.engine.spaceScene.add(this.root);
    this.spinSpeed = 0;
    this._spinTarget = 0;
    this._spinRamp = 1;
    this.rotation = 0;

    // Yıldızlar
    const n = 6000;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(5000);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.root.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, sizeAttenuation: false })));

    // Kara delik (yer tutucu)
    this.blackHoleDir = new THREE.Vector3(1, 0.08, 0.15).normalize();
    const bh = new THREE.Group();
    bh.position.copy(this.blackHoleDir).multiplyScalar(4000);
    bh.lookAt(0, 0, 0);
    bh.add(new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), new THREE.MeshBasicMaterial({ color: 0x000000 })));
    const disk = new THREE.Mesh(
      new THREE.RingGeometry(380, 900, 64),
      new THREE.MeshBasicMaterial({ color: 0xffc070, side: THREE.DoubleSide }),
    );
    disk.rotation.x = Math.PI / 2 - 0.1;
    bh.add(disk);
    this.blackHole = bh;
    this.root.add(bh);

    // Gemiyi aydınlatan ışık
    this.sunLight = new THREE.DirectionalLight(0xffe2b8, 2.0);
    this.sunLight.position.copy(this.blackHoleDir).multiplyScalar(80);
    ctx.scene.add(this.sunLight);
    ctx.scene.add(this.sunLight.target);
    this.ambient = new THREE.HemisphereLight(0x8090a0, 0x202020, 0.15);
    ctx.scene.add(this.ambient);

    ctx.bus.on('state:ring_spinning', (v) => this.setSpin(v ? 0.05 : 0, 6));
  }

  setSpin(radPerSec, rampSeconds = 4) {
    this._spinFrom = this.spinSpeed;
    this._spinTarget = radPerSec;
    this._spinRamp = 0;
    this._spinDur = Math.max(0.01, rampSeconds);
  }

  getBlackHoleDirection(out = new THREE.Vector3()) {
    return out.copy(this.blackHoleDir).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.rotation);
  }

  update(dt) {
    if (this._spinRamp < 1) {
      this._spinRamp = Math.min(1, this._spinRamp + dt / this._spinDur);
      this.spinSpeed = THREE.MathUtils.lerp(this._spinFrom, this._spinTarget, this._spinRamp);
    }
    this.rotation += this.spinSpeed * dt;
    this.root.rotation.y = this.rotation;
    const d = this.getBlackHoleDirection();
    this.sunLight.position.copy(d).multiplyScalar(80);
  }
}
