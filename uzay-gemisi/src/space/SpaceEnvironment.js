import * as THREE from 'three';
import { bakeMilkyWay, createSky } from './sky.js';
import { createGargantua } from './gargantua.js';
import { createPlanets, dirFromAzEl } from './planets.js';
import { RING_RADIUS, MODULE_WIDTH, WALL_THICKNESS, MODULE_HEIGHT } from '../world/ShipLayout.js';

/**
 * Uzay ortamı (Ajan 2 — Uzay & Görsel Efekt).
 *
 * İçerik engine.spaceScene'e eklenir (sonsuz uzaklıkta; uzay kamerası orijinde, sadece döner):
 *   - gökyüzü küresi: prosedürel yıldızlar + başlangıçta küp haritaya pişirilen soluk Samanyolu
 *   - Gargantua: billboard üzerinde Schwarzschild ışın yürütme (gölge, foton halkası, ince disk,
 *     diskin merceklenmiş arka yüzü, arka plan yıldızlarının merceklenmesi)
 *   - halkalı gaz devi + küresel solucan deliği, Miller (okyanus), Mann (buz)
 * Gemiyi aydınlatan "güneş" (yığılma diskinin ışığı) ve hafif hemisfer ışığı ana sahnededir.
 *
 * API (sözleşme, docs/ARCHITECTURE.md §3):
 *   space.update(dt, t)
 *   space.spinSpeed                     halkanın dönüş hızı (rad/sn). Uzay içeriği dünya Y ekseni etrafında döner.
 *   space.rotation                      birikmiş dönüş açısı (rad)
 *   space.setSpin(radPerSec, rampSeconds)
 *   space.getBlackHoleDirection(out?)   dünya uzayında kara deliğe birim yön (mevcut dönüş dahil; teleskop için)
 *   space.getSunDirection(out?)         dünya uzayında güneş ışığının geldiği yön (birim)
 *   space.sunLight                      THREE.DirectionalLight (ana sahnede, yüksek kalitede gölge atar)
 *   space.hemiLight                     THREE.HemisphereLight
 */

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Kara delik: azimut 345° (atan2(z, x)), yükseklik +3° → hem kumanda (+X) hem gözlem (330°) pencerelerinden görünür. */
const BH_AZ = 345;
const BH_EL = 3;
/**
 * Güneş ışığı aynı azimuttan ama daha yüksekten gelir (13°). Gerekçe: +3°'lik neredeyse yatay ışık
 * pencereden girip zemine ulaşamaz (7 m'de yalnızca ~0.4 m alçalır) ve sadece iç duvara vurur.
 * 13° ile pencere ışık lekeleri zemine düşer; diskin merceklenmiş üst hâlesi de ~+10°'ye uzandığı
 * için görsel olarak tutarlı kalır.
 */
const SUN_EL = 13;
const SUN_DISTANCE = 80;
const SUN_COLOR = 0xffd9ae;
const SUN_INTENSITY = 6.0;
/** Gölgesiz kalitede, kamera geminin içindeyken güneşin çarpanı (duvarlardan sızmayı önler). */
const SUN_INSIDE_NOSHADOW = 0.0;
const HEMI_OUTSIDE = 0.45;
const HEMI_INSIDE = 0.12;

/** Kaliteye göre kara delik ışın yürütme adımı. */
const BH_STEPS = { low: 80, medium: 120, high: 160 };

export class SpaceEnvironment {
  constructor(ctx) {
    this.ctx = ctx;
    const engine = ctx.engine;
    this.root = new THREE.Group();
    this.root.name = 'space';
    engine.spaceScene.add(this.root);

    this.spinSpeed = 0;
    this.rotation = 0;
    this._spinFrom = 0;
    this._spinTarget = 0;
    this._spinRamp = 1;
    this._spinDur = 1;

    /** Kök yerel uzayında (dönüş öncesi) yönler */
    this.blackHoleDir = dirFromAzEl(BH_AZ, BH_EL);
    this.sunDir = dirFromAzEl(BH_AZ, SUN_EL);

    // Paylaşılan uniform'lar (tüm uzay shader'ları aynı nesneleri görür)
    this.uniforms = {
      uTime: { value: 0 },
      uStarPx: { value: 0.8 }, // yıldız Gauss yarıçapı (cihaz pikseli)
      uPixScale: { value: 400 }, // 1 / merkezdeki piksel açısı (radyan)
      uMilky: { value: null },
    };

    // --- Gökyüzü ---
    try {
      this._milkyRT = bakeMilkyWay(engine.renderer, ctx.isTouch ? 256 : 512);
      this.uniforms.uMilky.value = this._milkyRT.texture;
    } catch (err) {
      console.error('[uzay] Samanyolu pişirilemedi:', err);
      this.uniforms.uMilky.value = new THREE.CubeTexture();
    }
    this.sky = createSky(this.uniforms);
    this.root.add(this.sky);

    // --- Gargantua ---
    const bh = createGargantua(this.blackHoleDir, this.uniforms, {
      distance: 1000,
      steps: BH_STEPS[engine.qualityName] ?? BH_STEPS.high,
    });
    this.blackHole = bh.group;
    this.blackHoleMaterial = bh.material;
    this.blackHoleAngularRadius = bh.angularRadius;
    this.root.add(bh.group);

    // --- Gezegenler + solucan deliği ---
    this.planets = createPlanets(this.root, this.blackHoleDir, bh.group, this.uniforms);

    // --- Gemiyi aydınlatan ışıklar (ana sahne) ---
    const sun = new THREE.DirectionalLight(SUN_COLOR, SUN_INTENSITY);
    sun.name = 'gargantua-sun';
    sun.castShadow = true; // her zaman açık: değiştirmek tüm shader'ları yeniden derletir
    const sc = sun.shadow.camera;
    // Işık Y etrafında döner, yüksekliği sabit → halka (yarıçap ~36 m, y ∈ [-2, 7]) için sabit sınırlar.
    // Yatayda ±45 m (halka + dış donanım payı); dikeyde ışık uzayında sıkı sınır → doku yoğunluğu ~3 kat artar.
    const ext = Math.max(45, RING_RADIUS + MODULE_WIDTH / 2 + WALL_THICKNESS + 6);
    const se = Math.sin(THREE.MathUtils.degToRad(SUN_EL));
    const ce = Math.cos(THREE.MathUtils.degToRad(SUN_EL));
    const yTop = MODULE_HEIGHT + 4;
    const yBot = -2;
    sc.left = -ext;
    sc.right = ext;
    sc.top = yTop * ce + ext * se + 1;
    sc.bottom = yBot * ce - ext * se - 1;
    sc.near = SUN_DISTANCE - ext - 5;
    sc.far = SUN_DISTANCE + ext + 5;
    sc.updateProjectionMatrix();
    // Akne/peter-panning dengesi: küçük sabit sapma + normal yönünde ofset (sığ açılı zeminler için)
    sun.shadow.bias = -0.00015;
    sun.shadow.normalBias = 0.045;
    sun.shadow.radius = 2;
    this.sunLight = sun;
    ctx.scene.add(sun);
    ctx.scene.add(sun.target);
    sun.target.position.set(0, 0, 0);

    this.hemiLight = new THREE.HemisphereLight(0x8c9bb0, 0x1c1814, HEMI_INSIDE);
    this.hemiLight.name = 'space-hemi';
    ctx.scene.add(this.hemiLight);
    this.ambient = this.hemiLight; // eski ad (geriye uyumluluk)

    this._insideK = 1; // 1 = kamera geminin içinde
    this._tmp = new THREE.Vector3();
    this._applyQuality(engine.quality, engine.qualityName);
    ctx.bus.on('engine:quality', ({ name, quality }) => this._applyQuality(quality, name));

    ctx.bus.on('state:ring_spinning', (v) => this.setSpin(v ? 0.05 : 0, 7));
    if (ctx.state?.is?.('ring_spinning')) this.setSpin(0.05, 7);

    this.update(0, 0);
  }

  _applyQuality(q, name) {
    const size = q?.shadowMapSize || 1024;
    const sh = this.sunLight.shadow;
    if (sh.mapSize.x !== size) {
      sh.mapSize.set(size, size);
      if (sh.map) {
        sh.map.dispose();
        sh.map = null;
      }
    }
    this._shadows = !!q?.shadows;
    this.blackHoleMaterial.uniforms.uSteps.value = BH_STEPS[name] ?? BH_STEPS.high;
  }

  /** Halka dönüşünü hedef hıza yumuşakça (S-eğrisi) getirir. */
  setSpin(radPerSec, rampSeconds = 7) {
    this._spinFrom = this.spinSpeed;
    this._spinTarget = radPerSec;
    this._spinRamp = 0;
    this._spinDur = Math.max(0.01, rampSeconds);
  }

  /** Dünya uzayında kara deliğe birim yön (mevcut dönüş dahil). */
  getBlackHoleDirection(out = new THREE.Vector3()) {
    return out.copy(this.blackHoleDir).applyAxisAngle(Y_AXIS, this.rotation);
  }

  /** Dünya uzayında güneş ışığının geldiği yön (sahneden ışığa doğru, birim). */
  getSunDirection(out = new THREE.Vector3()) {
    return out.copy(this.sunDir).applyAxisAngle(Y_AXIS, this.rotation);
  }

  update(dt, t) {
    // Dönüş rampası
    if (this._spinRamp < 1) {
      this._spinRamp = Math.min(1, this._spinRamp + dt / this._spinDur);
      const k = this._spinRamp * this._spinRamp * (3 - 2 * this._spinRamp);
      this.spinSpeed = THREE.MathUtils.lerp(this._spinFrom, this._spinTarget, k);
    }
    this.rotation = (this.rotation + this.spinSpeed * dt) % (Math.PI * 2);
    this.root.rotation.y = this.rotation;

    // Güneş
    const d = this.getSunDirection(this._tmp);
    this.sunLight.position.copy(d).multiplyScalar(SUN_DISTANCE);

    // Kamera geminin (halka tüpünün) içinde mi? → gölgesiz modda güneşi kıs, ortam ışığını azalt
    const cam = this.ctx.engine.camera.position;
    const rr = Math.hypot(cam.x, cam.z);
    const inside = Math.abs(rr - RING_RADIUS) < MODULE_WIDTH / 2 + 1.2 && cam.y > -0.6 && cam.y < MODULE_HEIGHT + 0.6;
    const target = inside ? 1 : 0;
    this._insideK += (target - this._insideK) * Math.min(1, dt * 4 || 1);
    const sunK = this._shadows ? 1 : THREE.MathUtils.lerp(1, SUN_INSIDE_NOSHADOW, this._insideK);
    this.sunLight.intensity = SUN_INTENSITY * sunK;
    this.hemiLight.intensity = THREE.MathUtils.lerp(HEMI_OUTSIDE, HEMI_INSIDE, this._insideK);

    // Shader zamanı + yıldızların ekran boyutu (cihaz pikselinde; gölgelendiriciler yıldızları görüntü
    // düzleminde çizer, bkz. glsl.js). Piksel oranı düşükken bile yıldız ≥ ~0.7 px kalır (titreme olmasın).
    this.uniforms.uTime.value = t;
    const renderer = this.ctx.renderer;
    const hDev = renderer.domElement.height || 540;
    const pr = renderer.getPixelRatio();
    const fov = THREE.MathUtils.degToRad(this.ctx.engine.camera.fov);
    this.uniforms.uPixScale.value = hDev / (2 * Math.tan(fov / 2));
    this.uniforms.uStarPx.value = Math.max(0.72 * pr, 0.7);
  }
}
