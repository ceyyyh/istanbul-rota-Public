import * as THREE from 'three';

/**
 * Havuzlu ışık yöneticisi.
 *
 * Gemide yüzlerce "sanal" nokta ışığı olabilir ama sahnede sabit sayıda gerçek
 * PointLight vardır (shader yeniden derlemesini önlemek için). Her karede
 * kameraya en yakın sanal ışıklar havuzdaki gerçek ışıklara atanır.
 *
 * Güç modları:
 *   'emergency' → sadece `emergency` tanımı olan ışıklar yanar (kırmızımsı, loş)
 *   'normal'    → normal ışıklar
 * Oyun 'emergency' modunda başlar; 'power_restored' bayrağıyla 'normal' olur.
 *
 *   const rec = lighting.addPointLight({
 *     position: worldVec3, color: 0xfff1e0, intensity: 6, distance: 9,
 *     emergency: { color: 0xff2a1a, intensity: 1.2 } // veya null (acil modda kapalı)
 *   });
 *   rec.on = false; // tek tek kapatılabilir
 *
 *   lighting.addEmissive(material, {
 *     normal: { color: 0xffffff, intensity: 2 },
 *     emergency: { color: 0x330000, intensity: 0.3 },
 *   });
 */
export class LightingManager {
  constructor(scene, poolSize = 8) {
    this.scene = scene;
    this.records = [];
    this.emissives = [];
    this.mode = 'emergency';
    this._transition = 1; // 0..1 geçiş ilerlemesi
    this._flicker = 0;
    this.pool = [];
    this.setPoolSize(poolSize);
    this._tmp = new THREE.Vector3();
  }

  setPoolSize(n) {
    for (const l of this.pool) this.scene.remove(l);
    this.pool = [];
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.castShadow = false;
      this.scene.add(l);
      this.pool.push(l);
    }
  }

  addPointLight({ position, color = 0xffffff, intensity = 5, distance = 10, decay = 2, emergency = null, flicker = 0 }) {
    const rec = {
      position: position.clone(),
      color: new THREE.Color(color),
      intensity,
      distance,
      decay,
      emergency: emergency ? { color: new THREE.Color(emergency.color), intensity: emergency.intensity } : null,
      flicker,
      on: true,
      _score: 0,
    };
    this.records.push(rec);
    return rec;
  }

  removePointLight(rec) {
    this.records = this.records.filter((r) => r !== rec);
  }

  addEmissive(material, { normal, emergency = null }) {
    const rec = {
      material,
      normal: { color: new THREE.Color(normal.color ?? 0xffffff), intensity: normal.intensity ?? 1 },
      emergency: emergency
        ? { color: new THREE.Color(emergency.color ?? 0x000000), intensity: emergency.intensity ?? 0 }
        : { color: new THREE.Color(0x000000), intensity: 0 },
    };
    this.emissives.push(rec);
    this._applyEmissive(rec, 1);
    return rec;
  }

  /** @param {'normal'|'emergency'} mode */
  setMode(mode, transitionSeconds = 2.5) {
    if (mode === this.mode) return;
    this.mode = mode;
    this._transition = transitionSeconds > 0 ? 0 : 1;
    this._transitionDur = transitionSeconds;
  }

  _applyEmissive(rec, k) {
    const target = this.mode === 'normal' ? rec.normal : rec.emergency;
    const m = rec.material;
    if (!m.emissive) return;
    m.emissive.copy(target.color);
    m.emissiveIntensity = target.intensity * k;
  }

  update(dt, cameraPos, time) {
    // Geçiş sırasında floresan titremesi
    let k = 1;
    if (this._transition < 1) {
      this._transition = Math.min(1, this._transition + dt / this._transitionDur);
      const t = this._transition;
      const flick = Math.sin(time * 53) * Math.sin(time * 17.3) > 0.2 ? 1 : 0.15;
      k = t < 0.85 ? flick * t : 1;
      for (const e of this.emissives) this._applyEmissive(e, k);
    }

    // En yakın ışıkları seç
    const candidates = [];
    for (const r of this.records) {
      if (!r.on) continue;
      const params = this.mode === 'normal' ? r : r.emergency;
      if (!params || params.intensity <= 0) continue;
      const d = r.position.distanceTo(cameraPos);
      if (d > r.distance + 14) continue;
      r._score = d - r.distance * 0.5;
      candidates.push(r);
    }
    candidates.sort((a, b) => a._score - b._score);

    for (let i = 0; i < this.pool.length; i++) {
      const light = this.pool[i];
      const r = candidates[i];
      // Not: visible=false yapmayın — ışık sayısı değişir ve tüm shader'lar yeniden derlenir.
      if (!r) {
        light.intensity = 0;
        continue;
      }
      const params = this.mode === 'normal' ? r : r.emergency;
      light.position.copy(r.position);
      light.color.copy(params.color);
      light.distance = r.distance;
      light.decay = r.decay;
      let intensity = params.intensity * k;
      if (r.flicker > 0) intensity *= 1 - r.flicker * (0.5 + 0.5 * Math.sin(time * 31 + r.position.x * 7) * Math.sin(time * 7.7));
      light.intensity = intensity;
    }
  }
}
