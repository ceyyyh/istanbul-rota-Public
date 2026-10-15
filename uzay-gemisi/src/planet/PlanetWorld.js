import * as THREE from 'three';
import { PLANET_ORIGIN } from '../core/WorldManager.js';

/**
 * Miller gezegeni (TASLAK — Ajan G "Gezegen" yeniden yazacak; API sabit kalmalı).
 *
 * Kök grup PLANET_ORIGIN'de; gezegen YEREL koordinatlarında: zemin y = 0 (diz altı sığ su),
 * iniş yapmış Ranger yaklaşık (0, 0), enkaz/işaret fişeği ~(60, -40) civarı.
 *
 * API:
 *   planet.root                  THREE.Group (ctx.scene içinde)
 *   planet.setActive(bool)       göster/gizle, kendi ışıklarını aç/kapat
 *   planet.envIntensity          gezegendeyken ortam haritası şiddeti
 *   planet.spawn                 { x, z, yaw } DÜNYA koordinatında: Ranger rampasının önü
 *   planet.points                { ranger:{x,z}, wreck:{x,z}, beacon:{x,z} } DÜNYA koordinatında
 *   planet.toWorld(x, z)         yerel → dünya Vector3
 *   planet.wave                  { active, distance (m, oyuncuya), height, start(opts), stop() }
 *   planet.update(dt, t)
 * Olaylar: 'planet:wave_warning', 'planet:wave_hit' (dalga oyuncuyu yakaladı), 'planet:wave_passed'
 */
export class PlanetWorld {
  constructor(ctx) {
    this.ctx = ctx;
    this.root = new THREE.Group();
    this.root.name = 'planet';
    this.root.position.set(PLANET_ORIGIN.x, 0, PLANET_ORIGIN.z);
    this.root.visible = false;
    ctx.scene.add(this.root);
    this.envIntensity = 0.6;

    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x6f8790, roughness: 0.15, metalness: 0.2 }),
    );
    this.root.add(water);
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(1400, 32, 16),
      new THREE.MeshBasicMaterial({ color: 0xb8c4c8, side: THREE.BackSide, fog: false }),
    );
    this.root.add(this.sky);
    this.light = new THREE.DirectionalLight(0xfff4e8, 0);
    this.light.position.set(PLANET_ORIGIN.x + 40, 80, PLANET_ORIGIN.z + 20);
    this.light.target.position.set(PLANET_ORIGIN.x, 0, PLANET_ORIGIN.z);
    ctx.scene.add(this.light, this.light.target);

    this.spawn = { x: PLANET_ORIGIN.x + 4, z: PLANET_ORIGIN.z, yaw: -Math.PI / 2 };
    this.points = {
      ranger: { x: PLANET_ORIGIN.x, z: PLANET_ORIGIN.z },
      wreck: { x: PLANET_ORIGIN.x + 60, z: PLANET_ORIGIN.z - 40 },
      beacon: { x: PLANET_ORIGIN.x + 62, z: PLANET_ORIGIN.z - 38 },
    };
    this.wave = { active: false, distance: Infinity, height: 0, start() {}, stop() {} };
  }

  toWorld(x, z) {
    return new THREE.Vector3(PLANET_ORIGIN.x + x, 0, PLANET_ORIGIN.z + z);
  }

  setActive(on) {
    this.root.visible = on;
    this.light.intensity = on ? 2.2 : 0;
  }

  update() {}
}
