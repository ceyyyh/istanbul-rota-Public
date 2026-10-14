import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { LightingManager } from '../../src/world/Lighting.js';
import { knownBug } from './_helpers.js';

const V = (x, y = 2.5, z = 0) => new THREE.Vector3(x, y, z);
const EMERG = { color: 0xff2a1a, intensity: 1.2 };

function pointLights(scene) {
  const out = [];
  scene.traverse((o) => o.isPointLight && out.push(o));
  return out;
}

/** dt adımlarla `seconds` boyunca günceller */
function run(lm, cam, seconds, dt = 1 / 60, t0 = 0) {
  let t = t0;
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    t += dt;
    lm.update(dt, cam, t);
  }
  return t;
}

describe('LightingManager', () => {
  it('havuz boyutu kadar gerçek PointLight oluşturur (gölgesiz)', () => {
    const scene = new THREE.Scene();
    const lm = new LightingManager(scene, 4);
    const lights = pointLights(scene);
    expect(lights).toHaveLength(4);
    expect(lights.every((l) => l.castShadow === false)).toBe(true);
  });

  it('kameraya en yakın ışıkları seçer (normal mod)', () => {
    const scene = new THREE.Scene();
    const lm = new LightingManager(scene, 4);
    lm.setMode('normal', 0);
    for (let i = 0; i < 10; i++) lm.addPointLight({ position: V(i * 3), intensity: 5, distance: 9, emergency: EMERG });
    const cam = V(0, 1.6, 0);
    lm.update(1 / 60, cam, 0);
    const xs = lm.pool.map((l) => l.position.x).sort((a, b) => a - b);
    expect(xs).toEqual([0, 3, 6, 9]);
    expect(lm.pool.every((l) => l.intensity === 5)).toBe(true);

    // Kamera öbür uca gidince havuz yeniden atanır
    lm.update(1 / 60, V(27, 1.6, 0), 0.1);
    const xs2 = lm.pool.map((l) => l.position.x).sort((a, b) => a - b);
    expect(xs2).toEqual([18, 21, 24, 27]);
  });

  it('acil modda yalnızca emergency tanımlı ışıklar, acil renk/şiddetle yanar', () => {
    const scene = new THREE.Scene();
    const lm = new LightingManager(scene, 4);
    expect(lm.mode).toBe('emergency');
    lm.addPointLight({ position: V(0), color: 0xffffff, intensity: 7, distance: 9, emergency: null });
    lm.addPointLight({ position: V(1), color: 0xffffff, intensity: 7, distance: 9, emergency: EMERG });
    lm.update(1 / 60, V(0, 1.6, 0), 0);
    const lit = lm.pool.filter((l) => l.intensity > 0);
    expect(lit).toHaveLength(1);
    expect(lit[0].position.x).toBe(1);
    expect(lit[0].intensity).toBeCloseTo(1.2, 6);
    expect(lit[0].color.getHex()).toBe(0xff2a1a);
  });

  it('normal moda geçiş: titreşimli geçişten sonra tam şiddet ve normal renk', () => {
    const scene = new THREE.Scene();
    const lm = new LightingManager(scene, 4);
    lm.addPointLight({ position: V(0), color: 0xfff0dc, intensity: 7, distance: 9, emergency: EMERG });
    const cam = V(0, 1.6, 0);
    lm.update(1 / 60, cam, 0);
    lm.setMode('normal', 2.5);
    expect(lm.mode).toBe('normal');
    let maxDuring = 0;
    let t = 0;
    for (let i = 0; i < 60; i++) {
      t += 1 / 60;
      lm.update(1 / 60, cam, t);
      maxDuring = Math.max(maxDuring, lm.pool[0].intensity);
    }
    // geçişin ilk saniyesinde tam şiddete ulaşılmaz
    expect(maxDuring).toBeLessThan(7);
    run(lm, cam, 2, 1 / 60, t);
    const l = lm.pool.find((p) => p.intensity > 0);
    expect(l.intensity).toBeCloseTo(7, 6);
    expect(l.color.getHex()).toBe(new THREE.Color(0xfff0dc).getHex());
  });

  it('ışık sayısı her durumda sabit; visible asla false olmaz; kullanılmayanlar intensity=0', () => {
    const scene = new THREE.Scene();
    const lm = new LightingManager(scene, 6);
    const recs = [];
    for (let i = 0; i < 3; i++) recs.push(lm.addPointLight({ position: V(i * 2), intensity: 4, distance: 8, emergency: i === 0 ? EMERG : null }));
    const cam = V(0, 1.6, 0);
    const check = () => {
      const ls = pointLights(scene);
      expect(ls).toHaveLength(6);
      expect(ls.every((l) => l.visible === true)).toBe(true);
    };
    run(lm, cam, 0.5);
    check();
    expect(lm.pool.filter((l) => l.intensity === 0)).toHaveLength(5); // acil modda yalnızca 1 ışık
    lm.setMode('normal', 1);
    run(lm, cam, 2, 1 / 60, 1);
    check();
    expect(lm.pool.filter((l) => l.intensity > 0)).toHaveLength(3);
    recs[1].on = false;
    run(lm, cam, 0.1, 1 / 60, 4);
    check();
    expect(lm.pool.filter((l) => l.intensity > 0)).toHaveLength(2);
    lm.removePointLight(recs[2]);
    run(lm, cam, 0.1, 1 / 60, 5);
    check();
    expect(lm.pool.filter((l) => l.intensity > 0)).toHaveLength(1);
    lm.setMode('emergency', 0.5);
    run(lm, cam, 1, 1 / 60, 6);
    check();
    // Hiç ışık kalmasa da havuz sahnede kalır
    lm.records.length = 0;
    run(lm, cam, 0.1, 1 / 60, 8);
    check();
    expect(lm.pool.every((l) => l.intensity === 0)).toBe(true);
  });

  it('uzak ışıklar (distance + 14 m ötesi) elenir', () => {
    const scene = new THREE.Scene();
    const lm = new LightingManager(scene, 4);
    lm.setMode('normal', 0);
    lm.addPointLight({ position: V(40), intensity: 5, distance: 9 });
    lm.update(1 / 60, V(0, 1.6, 0), 0);
    expect(lm.pool.every((l) => l.intensity === 0)).toBe(true);
    lm.update(1 / 60, V(20, 1.6, 0), 0.1);
    expect(lm.pool.some((l) => l.intensity === 5)).toBe(true);
  });

  it('setPoolSize eski ışıkları kaldırır, yenilerini ekler', () => {
    const scene = new THREE.Scene();
    const lm = new LightingManager(scene, 8);
    expect(pointLights(scene)).toHaveLength(8);
    lm.setPoolSize(4);
    expect(pointLights(scene)).toHaveLength(4);
    expect(lm.pool).toHaveLength(4);
  });

  it('titreme (flicker) şiddeti [taban·(1-flicker), taban] aralığında tutar', () => {
    const scene = new THREE.Scene();
    const lm = new LightingManager(scene, 4);
    lm.setMode('normal', 0);
    lm.addPointLight({ position: V(0), intensity: 6, distance: 9, flicker: 0.5 });
    let min = Infinity;
    let max = -Infinity;
    let t = 0;
    for (let i = 0; i < 600; i++) {
      t += 1 / 60;
      lm.update(1 / 60, V(0, 1.6, 0), t);
      const l = lm.pool.find((p) => p.position.x === 0 && p.intensity > 0) ?? lm.pool[0];
      min = Math.min(min, l.intensity);
      max = Math.max(max, l.intensity);
    }
    expect(min).toBeGreaterThanOrEqual(6 * 0.5 - 1e-6);
    expect(max).toBeLessThanOrEqual(6 + 1e-6);
    expect(max - min).toBeGreaterThan(0.1); // gerçekten titriyor
  });

  it('addEmissive: eklenince mevcut moda göre uygulanır; geçişten sonra normal değerler', () => {
    const scene = new THREE.Scene();
    const lm = new LightingManager(scene, 4);
    const mat = new THREE.MeshStandardMaterial();
    lm.addEmissive(mat, { normal: { color: 0xffffff, intensity: 2 }, emergency: { color: 0x330000, intensity: 0.3 } });
    expect(mat.emissive.getHex()).toBe(0x330000);
    expect(mat.emissiveIntensity).toBeCloseTo(0.3, 6);
    lm.setMode('normal', 1);
    run(lm, V(0), 1.5);
    expect(mat.emissive.getHex()).toBe(0xffffff);
    expect(mat.emissiveIntensity).toBeCloseTo(2, 6);
  });

  it('addEmissive: emergency verilmezse acil modda karanlık (siyah, 0)', () => {
    const scene = new THREE.Scene();
    const lm = new LightingManager(scene, 4);
    const mat = new THREE.MeshStandardMaterial({ emissive: 0xffffff, emissiveIntensity: 3 });
    lm.addEmissive(mat, { normal: { color: 0xffffff, intensity: 2 } });
    expect(mat.emissive.getHex()).toBe(0x000000);
    expect(mat.emissiveIntensity).toBe(0);
  });

  it('emissive özelliği olmayan malzemede hata vermez', () => {
    const scene = new THREE.Scene();
    const lm = new LightingManager(scene, 4);
    const mat = new THREE.MeshBasicMaterial();
    expect(() => lm.addEmissive(mat, { normal: { intensity: 1 } })).not.toThrow();
    lm.setMode('normal', 0.5);
    expect(() => run(lm, V(0), 1)).not.toThrow();
  });

  // Lighting.js: setMode(mode, 0) → _transition = 1 olduğu için update() emissive malzemeleri hiç güncellemez.
  // Anında mod değişimi (ör. güç kesintisi efekti) ekranları/lambaları eski modda bırakır.
  knownBug('setMode(…, 0) anında geçişte emissive malzemeler de güncellenmeli', () => {
    const scene = new THREE.Scene();
    const lm = new LightingManager(scene, 4);
    const mat = new THREE.MeshStandardMaterial();
    lm.addEmissive(mat, { normal: { color: 0xffffff, intensity: 2 }, emergency: { color: 0x330000, intensity: 0.3 } });
    lm.setMode('normal', 0);
    lm.update(1 / 60, V(0), 0);
    expect(mat.emissive.getHex()).toBe(0xffffff);
    expect(mat.emissiveIntensity).toBeCloseTo(2, 6);
  });
});
