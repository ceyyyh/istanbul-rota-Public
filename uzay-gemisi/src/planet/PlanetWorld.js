import * as THREE from 'three';
import { PLANET_ORIGIN } from '../core/WorldManager.js';
import { createSharedUniforms, createSky } from './sky.js';
import { createWater } from './water.js';
import { WaveSystem } from './wave.js';
import { buildWreck, WRECK } from './wreck.js';
import { buildLandedRanger, RANGER_POS, RAMP } from './ranger.js';

/**
 * Miller gezegeni (Ajan G).
 *
 * Kök grup PLANET_ORIGIN'de; gezegen YEREL koordinatlarında: zemin y = 0 (diz altı sığ su, yüzey y ≈ 0.28),
 * iniş yapmış Ranger (6, 0) civarı (burun -X, rampa +X'e iner), enkaz ~(60, -40), işaret fişeği (62, -38).
 *
 * API:
 *   planet.root                  THREE.Group (ctx.scene içinde)
 *   planet.setActive(bool)       göster/gizle, kendi ışıklarını aç/kapat (ışık sayısı sabit; visible kullanılmaz)
 *   planet.envIntensity          gezegendeyken ortam haritası şiddeti
 *   planet.spawn                 { x, z, yaw } DÜNYA koordinatında: Ranger rampasının önü
 *   planet.points                { ranger, wreck, beacon, ela:{x,z,yaw}, ramp } DÜNYA koordinatında
 *   planet.objects               { beacon, debris, ramp } etkileşim için THREE nesneleri
 *   planet.toWorld(x, z)         yerel → dünya Vector3
 *   planet.wave                  { active, distance, height, start({fromDistance,speed,height,direction}), stop(), reset() }
 *   planet.releaseDebris()       Ela'yı sıkıştıran levhayı kaldırır (animasyon + çarpışma engelini siler)
 *   planet.resetDebris()         levhayı geri koyar
 *   planet.update(dt, t)
 * Olaylar: 'planet:wave_warning', 'planet:wave_hit' (dalga oyuncuyu yakaladı), 'planet:wave_passed' (geri çekilen dalga ufka vardı)
 */
export class PlanetWorld {
  constructor(ctx) {
    this.ctx = ctx;
    this.root = new THREE.Group();
    this.root.name = 'planet';
    this.root.position.set(PLANET_ORIGIN.x, 0, PLANET_ORIGIN.z);
    this.root.visible = false;
    ctx.scene.add(this.root);
    this.envIntensity = 0.55;
    this.active = false;

    const U = createSharedUniforms(PLANET_ORIGIN);
    this.uniforms = U;

    // --- gökyüzü, su ---
    this.sky = createSky(U);
    this.root.add(this.sky);
    this.water = createWater(U);
    this.root.add(this.water.mesh);

    // --- ışıklar: sahnede kalıcı (sayı sabit), şiddet 0 ↔ aktif ---
    this.sun = new THREE.DirectionalLight(0xdfe9ef, 0);
    this.sun.target.position.set(PLANET_ORIGIN.x, 0, PLANET_ORIGIN.z);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -34;
    sc.right = sc.top = 34;
    sc.near = 1;
    sc.far = 220;
    this.sun.shadow.mapSize.set(ctx.engine?.quality?.shadowMapSize ?? 1024, ctx.engine?.quality?.shadowMapSize ?? 1024);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.castShadow = false;
    this._sunOffset = new THREE.Vector3(60, 110, 35);
    this.sun.position.set(PLANET_ORIGIN.x + 60, 110, PLANET_ORIGIN.z + 35);
    this.hemi = new THREE.HemisphereLight(0xaec3d0, 0x4a5b62, 0);
    this.light = this.sun; // eski ad (uyumluluk)
    ctx.scene.add(this.sun, this.sun.target, this.hemi);

    // --- Ranger ---
    const M = ctx.materials;
    const ranger = buildLandedRanger(M);
    this.root.add(ranger.group);
    this.ranger = ranger.group;
    this.root.add(ranger.ramp);

    // --- enkaz ---
    this.wreck = buildWreck(ctx, M);
    this.root.add(this.wreck.group);

    // --- dalga ---
    this.wave = new WaveSystem(ctx, this.root, U, PLANET_ORIGIN);

    // --- nesneler ve noktalar ---
    this.objects = { beacon: this.wreck.beacon, debris: this.wreck.debris, ramp: ranger.ramp };
    const w = (x, z) => ({ x: PLANET_ORIGIN.x + x, z: PLANET_ORIGIN.z + z });
    const spawnLocal = { x: RAMP.x1 + 2.8, z: 1.2 };
    const toWreck = { x: WRECK.center.x - spawnLocal.x, z: WRECK.center.z - spawnLocal.z };
    this.spawn = { ...w(spawnLocal.x, spawnLocal.z), yaw: Math.atan2(-toWreck.x, -toWreck.z) };
    this.points = {
      ranger: w(RANGER_POS.x, RANGER_POS.z),
      ramp: w(ranger.rampCenter.x, ranger.rampCenter.z),
      wreck: w(WRECK.center.x, WRECK.center.z),
      beacon: w(WRECK.beacon.x, WRECK.beacon.z),
      ela: { ...w(WRECK.ela.x, WRECK.ela.z), yaw: WRECK.ela.yaw },
    };

    this._buildColliders(ranger);

    // adım halkaları
    ctx.bus.on('player:footstep', () => this._stepRipple());
    ctx.bus.on('player:land', () => this._stepRipple());
    this._shakeOn = true;
    this._t = 0;
    this._syncToPlayer();
  }

  /** Çarpışma engelleri (dünya XZ). Gezegen yerelinden dönüştürülür. */
  _buildColliders(ranger) {
    const col = this.ctx.collision;
    if (!col) return;
    const ox = PLANET_ORIGIN.x;
    const oz = PLANET_ORIGIN.z;
    this.colliders = { ranger: null, ramp: null, wreck: [], debris: null };
    this.root.updateMatrixWorld(true);
    this.colliders.ranger = col.addFromObject(ranger.group);
    const rampBox = col.addBox(ox + ranger.rampCenter.x, oz + 0, ranger.rampLen / 2, 1.05, 0);
    this.colliders.ramp = rampBox;
    this.objects.ramp.userData.collider = rampBox;
    for (const c of this.wreck.colliders) {
      let h;
      if (c.r !== undefined) h = col.addCircle(ox + c.x, oz + c.z, c.r);
      else h = col.addBox(ox + c.cx, oz + c.cz, c.hx, c.hz, c.angle);
      this.colliders.wreck.push(h);
      if (c.beacon) this.objects.beacon.userData.collider = h;
      if (c.cx !== undefined && Math.abs(c.cx - 61.5) < 0.01) this.objects.debris.userData.collider = h; // gövde parçası: ışın engeli sayılmasın
    }
  }

  _stepRipple() {
    if (!this.active) return;
    const p = this.ctx.player.position;
    this.water.ripple(p.x - PLANET_ORIGIN.x, p.z - PLANET_ORIGIN.z);
  }

  toWorld(x, z) {
    return new THREE.Vector3(PLANET_ORIGIN.x + x, 0, PLANET_ORIGIN.z + z);
  }

  /** Ela'yı sıkıştıran levhayı kaldırır. */
  releaseDebris() {
    this.wreck.releaseDebris();
  }

  resetDebris() {
    this.wreck.resetDebris();
  }

  setActive(on) {
    this.active = on;
    this.root.visible = on;
    this.sun.intensity = on ? 1.7 : 0;
    this.hemi.intensity = on ? 1.15 : 0;
    this.sun.castShadow = on; // ışık sayısı sabit; gölge yalnızca gezegendeyken
    if (on) this._syncToPlayer();
  }

  /** Gökyüzü, su ve güneş oyuncuyu izler (sonsuz görünüm); dünya koordinatlı gölgelendirme kaymaz. */
  _syncToPlayer() {
    const cam = this.ctx.camera?.position;
    const p = this.ctx.player?.position;
    if (cam) {
      this.sky.position.set(cam.x - PLANET_ORIGIN.x, 0, cam.z - PLANET_ORIGIN.z);
      this.water.mesh.position.x = cam.x - PLANET_ORIGIN.x;
      this.water.mesh.position.z = cam.z - PLANET_ORIGIN.z;
    }
    if (p) {
      this.sun.target.position.set(p.x, 0, p.z);
      this.sun.position.set(p.x + this._sunOffset.x, this._sunOffset.y, p.z + this._sunOffset.z);
      this.sun.target.updateMatrixWorld();
      this.water.uniforms.uSun.value.copy(this._sunOffset).normalize();
    }
  }

  update(dt, t) {
    this._t += dt;
    this.uniforms.uTime.value = this._t;
    this._syncToPlayer();
    this.water.update(dt);
    this.wave.update(dt);
    this.wreck.update(dt, this._t);

    // dalga yaklaşırken kamera sarsıntısı
    const sh = this.wave.shake;
    if (sh > 0.001 && this._shakeOn) {
      const cam = this.ctx.camera;
      const a = sh * 0.9;
      cam.position.x += (Math.random() - 0.5) * 0.05 * a;
      cam.position.y += (Math.random() - 0.5) * 0.07 * a;
      cam.position.z += (Math.random() - 0.5) * 0.05 * a;
      cam.rotation.x += (Math.random() - 0.5) * 0.012 * a;
      cam.rotation.z += (Math.random() - 0.5) * 0.02 * a;
    }
  }
}
