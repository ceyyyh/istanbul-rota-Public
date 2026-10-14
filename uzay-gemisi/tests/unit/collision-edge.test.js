import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CollisionWorld, convexHull, localBounds } from '../../src/player/collision.js';
import { knownBug } from './_helpers.js';

const R = 0.3;
// Oyuncu gövdesi: ayak + 0.3 (basamak) … ayak + 1.8
const BODY = [0.3, 1.8];

/** Bir doğrultuda adım adım yürür (dt=1/60, hız m/s) */
function walk(w, from, dir, seconds, speed = 2.7, yMin = BODY[0], yMax = BODY[1]) {
  let p = { x: from.x, z: from.z };
  const n = Math.round(seconds * 60);
  const len = Math.hypot(dir.x, dir.z) || 1;
  for (let i = 0; i < n; i++) {
    const to = { x: p.x + (dir.x / len) * speed / 60, z: p.z + (dir.z / len) * speed / 60 };
    const r = w.move(p, to, R, yMin, yMax);
    p = { x: r.x, z: r.z };
  }
  return p;
}

/** Noktanın (r yarıçaplı daire) hiçbir aktif segmente r'den yakın olmadığını doğrular */
function penetration(w, p, yMin = BODY[0], yMax = BODY[1]) {
  let worst = 0;
  for (const c of w.query(p.x, p.z, 5, yMin, yMax)) {
    if (c.type !== 'seg') continue;
    let t = ((p.x - c.ax) * c.dx + (p.z - c.az) * c.dz) / c.len2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(p.x - (c.ax + c.dx * t), p.z - (c.az + c.dz * t));
    worst = Math.max(worst, R - d);
  }
  return worst;
}

describe('CollisionWorld — kenar durumları', () => {
  describe('köşeler', () => {
    it('iç köşeye (iki dik duvar) doğru yürürken iki duvarın da dışında kalır', () => {
      const w = new CollisionWorld();
      w.addSegment(1, -5, 1, 5); // x = 1 duvarı
      w.addSegment(-5, 1, 5, 1); // z = 1 duvarı
      const p = walk(w, { x: 0, z: 0 }, { x: 1, z: 1 }, 3);
      expect(p.x).toBeLessThanOrEqual(1 - R + 1e-3);
      expect(p.z).toBeLessThanOrEqual(1 - R + 1e-3);
      expect(p.x).toBeGreaterThan(0.6);
      expect(p.z).toBeGreaterThan(0.6);
      expect(penetration(w, p)).toBeLessThan(1e-3);
    });

    it('dar açılı (V) köşeye sıkışınca duvarların içinden geçmez', () => {
      const w = new CollisionWorld();
      // tepe (4,0)'da birleşen iki duvar, ~30° açı
      w.addSegment(0, -1.1, 4, 0);
      w.addSegment(0, 1.1, 4, 0);
      const p = walk(w, { x: 0.5, z: 0 }, { x: 1, z: 0 }, 4, 5);
      expect(p.x).toBeLessThan(4);
      expect(Math.abs(p.z)).toBeLessThan(1);
      // dar açılı köşede 4 çözüm yinelemesi ~2 cm'ye kadar sızmaya izin verir (kabul edilebilir)
      expect(penetration(w, p)).toBeLessThan(0.05);
    });

    it('dış köşe (kutu kenarı) etrafında kayarak döner, içine girmez', () => {
      const w = new CollisionWorld();
      w.addBox(0, 0, 1, 1); // [-1,1]²
      // köşeye çapraz yaklaş
      const p = walk(w, { x: -3, z: -3 }, { x: 1, z: 1 }, 3);
      const inside = Math.abs(p.x) < 1 + R - 1e-3 && Math.abs(p.z) < 1 + R - 1e-3 && Math.hypot(Math.abs(p.x) - 1, Math.abs(p.z) - 1) < R - 1e-3;
      expect(inside).toBe(false);
      expect(penetration(w, p)).toBeLessThan(1e-3);
    });

    it('kutuya kenarından teğet yürüyüşte kayar ve ilerlemeye devam eder', () => {
      const w = new CollisionWorld();
      w.addBox(0, 0, 1, 1);
      // alt yüze (z = -1) sığ açıyla yaklaş: yüz boyunca kayıp öbür tarafa geçmeli
      const p = walk(w, { x: -3, z: -1.5 }, { x: 1, z: 0.1 }, 3);
      expect(p.x).toBeGreaterThan(1.5); // kutunun öbür tarafına geçti
      expect(penetration(w, p)).toBeLessThan(1e-3);
    });
  });

  describe('iç içe çokgenler', () => {
    // Dış oda 10×10, ortada 2×2 sütun → aradaki halka biçimli alanda kalmalı
    function room() {
      const w = new CollisionWorld();
      w.addBox(0, 0, 5, 5);
      w.addBox(0, 0, 1, 1);
      return w;
    }

    it('dış duvarları geçemez (içeriden)', () => {
      const w = room();
      for (const dir of [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }, { x: 1, z: 1 }]) {
        const p = walk(w, { x: 3, z: 3 }, dir, 4, 5);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(5 - R + 1e-3);
        expect(Math.abs(p.z)).toBeLessThanOrEqual(5 - R + 1e-3);
      }
    });

    it('iç sütunu geçemez', () => {
      const w = room();
      const p = walk(w, { x: -3, z: 0 }, { x: 1, z: 0 }, 4, 5);
      expect(p.x).toBeLessThanOrEqual(-1 - R + 1e-3);
    });

    it('sütunun etrafını dolaşabilir (halka koridor)', () => {
      const w = room();
      let p = { x: -3, z: -3 };
      for (const target of [{ x: 3, z: -3 }, { x: 3, z: 3 }, { x: -3, z: 3 }, { x: -3, z: -3 }]) {
        const dir = { x: target.x - p.x, z: target.z - p.z };
        p = walk(w, p, dir, Math.hypot(dir.x, dir.z) / 2.7);
        expect(Math.hypot(p.x - target.x, p.z - target.z)).toBeLessThan(0.1);
      }
    });

    it('çokgenin içine (dolu bölgeye) ışınlanan daire kenara yakınsa dışarı itilir', () => {
      const w = new CollisionWorld();
      w.addBox(0, 0, 1, 1);
      const p = { x: 0.9, z: 0 };
      w.resolve(p, R, ...BODY);
      // en yakın kenara (x=1) göre itilir: ya dışarıda ya da içeride ama kenardan R uzakta
      expect(Math.abs(Math.abs(p.x) - 1)).toBeGreaterThanOrEqual(R - 1e-3);
    });
  });

  describe('kaldırma ve etkinleştirme', () => {
    it('remove: segment artık engellemez, count azalır', () => {
      const w = new CollisionWorld();
      const s = w.addSegment(1, -5, 1, 5);
      expect(w.count).toBe(1);
      w.remove(s);
      expect(w.count).toBe(0);
      const r = w.move({ x: 0, z: 0 }, { x: 3, z: 0 }, R);
      expect(r.collided).toBe(false);
      expect(r.x).toBeCloseTo(3, 6);
    });

    it('remove(grup): tüm kenarlar kaldırılır', () => {
      const w = new CollisionWorld();
      const box = w.addBox(0, 0, 1, 1);
      expect(w.count).toBe(4);
      w.remove(box);
      expect(w.count).toBe(0);
      expect(w.query(0, 0, 3)).toHaveLength(0);
    });

    it('çok hücreye yayılan uzun segment kaldırılınca hiçbir hücrede kalmaz', () => {
      const w = new CollisionWorld({ cellSize: 2 });
      const s = w.addSegment(-50, 0.5, 50, 0.5);
      w.remove(s);
      let left = 0;
      for (const arr of w.cells.values()) left += arr.length;
      expect(left).toBe(0);
    });

    it('remove(null/undefined) güvenli', () => {
      const w = new CollisionWorld();
      expect(() => w.remove(null)).not.toThrow();
      expect(() => w.setEnabled(undefined, false)).not.toThrow();
    });

    it('setEnabled(grup) tüm kenarları kapatır/açar', () => {
      const w = new CollisionWorld();
      const box = w.addBox(2, 0, 0.5, 0.5);
      w.setEnabled(box, false);
      expect(w.move({ x: 0, z: 0 }, { x: 4, z: 0 }, R).x).toBeCloseTo(4, 6);
      w.setEnabled(box, true);
      expect(w.move({ x: 0, z: 0 }, { x: 4, z: 0 }, R).x).toBeLessThan(1.5);
    });

    it('circle: kaldırma ve devre dışı bırakma', () => {
      const w = new CollisionWorld();
      const c = w.addCircle(2, 0, 0.5);
      expect(w.move({ x: 0, z: 0 }, { x: 4, z: 0 }, R).x).toBeLessThan(2 - 0.5 - R + 1e-3);
      w.setEnabled(c, false);
      expect(w.move({ x: 0, z: 0 }, { x: 4, z: 0 }, R).x).toBeCloseTo(4, 6);
      w.setEnabled(c, true);
      w.remove(c);
      expect(w.move({ x: 0, z: 0 }, { x: 4, z: 0 }, R).x).toBeCloseTo(4, 6);
    });

    // collision.js remove(): aynı engel iki kez kaldırılınca `count` yine azalır (negatife düşebilir).
    it('aynı engeli iki kez kaldırmak count değerini bozmamalı', () => {
      const w = new CollisionWorld();
      const s = w.addSegment(0, 0, 1, 0);
      w.addSegment(0, 1, 1, 1);
      w.remove(s);
      w.remove(s);
      expect(w.count).toBe(1);
    });
  });

  describe('dikey aralık (yMin / yMax)', () => {
    it('tavan borusu (y 2.5–3) yürümeyi engellemez, ayakta duran gövdeyle kesişen engeller', () => {
      const w = new CollisionWorld();
      w.addSegment(1, -5, 1, 5, { yMin: 2.5, yMax: 3 });
      expect(w.move({ x: 0, z: 0 }, { x: 3, z: 0 }, R, ...BODY).x).toBeCloseTo(3, 6);
      const w2 = new CollisionWorld();
      w2.addSegment(1, -5, 1, 5, { yMin: 1.0, yMax: 3 });
      expect(w2.move({ x: 0, z: 0 }, { x: 3, z: 0 }, R, ...BODY).x).toBeLessThan(1);
    });

    it('alçak engel (0–0.2 m, ör. kablo kanalı) basamak yüksekliğinin altında: geçilir', () => {
      const w = new CollisionWorld();
      w.addSegment(1, -5, 1, 5, { yMin: 0, yMax: 0.2 });
      expect(w.move({ x: 0, z: 0 }, { x: 3, z: 0 }, R, ...BODY).x).toBeCloseTo(3, 6);
    });

    it('eğilince (gövde 0.3–1.2) alçak kiriş (1.5–3) altından geçilir, ayaktayken geçilemez', () => {
      const w = new CollisionWorld();
      w.addSegment(1, -5, 1, 5, { yMin: 1.5, yMax: 3 });
      expect(w.move({ x: 0, z: 0 }, { x: 3, z: 0 }, R, 0.3, 1.8).x).toBeLessThan(1);
      expect(w.move({ x: 0, z: 0 }, { x: 3, z: 0 }, R, 0.3, 1.2).x).toBeCloseTo(3, 6);
    });

    it('zıplarken (ayak 0.5 m) 0.6 m yüksekliğindeki sandığın üstünden geçilir', () => {
      const w = new CollisionWorld();
      w.addBox(2, 0, 0.5, 2, 0, { yMin: 0, yMax: 0.6 });
      // ayakta: 0.3 > 0.6? hayır → engeller
      expect(w.move({ x: 0, z: 0 }, { x: 4, z: 0 }, R, 0.3, 1.8).x).toBeLessThan(1.5);
      // havada: gövde 0.8–2.3
      expect(w.move({ x: 0, z: 0 }, { x: 4, z: 0 }, R, 0.8, 2.3).x).toBeCloseTo(4, 6);
    });

    it('addFromObject: dünya Y aralığını doğru çıkarır (yükseltilmiş nesne)', () => {
      const w = new CollisionWorld();
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 0.4, 1));
      m.position.set(0, 2.6, 0); // 2.4 … 2.8
      const c = w.addFromObject(m);
      expect(c.segments[0].yMin).toBeCloseTo(2.4, 5);
      expect(c.segments[0].yMax).toBeCloseTo(2.8, 5);
      expect(w.move({ x: -2, z: 0 }, { x: 2, z: 0 }, R, ...BODY).x).toBeCloseTo(2, 6);
    });

    // Belge §4: "Zeminden ≤0.3 m yükseklikteki … engeller oyuncuyu durdurmaz."
    // Gerçekte 0.3 m'lik kutu (Float32 sınır kutusu ≈ 0.30000001) ve tam 0.3 sınırı oyuncuyu durdurur
    // (collision.js query: `c.yMax < yMin` katı karşılaştırma, epsilon yok).
    it('tam 0.3 m yüksekliğindeki engel (addFromObject) oyuncuyu durdurmamalı', () => {
      const w = new CollisionWorld();
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 0.3, 4));
      m.position.set(1.5, 0.15, 0);
      w.addFromObject(m);
      const r = w.move({ x: 0, z: 0 }, { x: 3, z: 0 }, R, 0.3, 1.8);
      expect(r.x).toBeCloseTo(3, 6);
    });
  });

  describe('ızgara ve sorgu', () => {
    it('negatif koordinatlarda da çalışır', () => {
      const w = new CollisionWorld();
      w.addSegment(-41, -50, -41, -30);
      const r = w.move({ x: -38, z: -40 }, { x: -45, z: -40 }, R);
      expect(r.x).toBeGreaterThanOrEqual(-41 + R - 1e-3);
    });

    it('birçok hücreye yayılan engel sorguda bir kez döner', () => {
      const w = new CollisionWorld({ cellSize: 1 });
      w.addSegment(-10, 0, 10, 0);
      expect(w.query(0, 0, 5)).toHaveLength(1);
      // ardışık sorgular da (damga) doğru çalışır
      expect(w.query(3, 0, 5)).toHaveLength(1);
    });

    it('çaptan dar aralığa (0.5 m) girilemez', () => {
      const w = new CollisionWorld();
      w.addSegment(-0.25, 1, -0.25, 5);
      w.addSegment(0.25, 1, 0.25, 5);
      for (const x0 of [0, 0.02, -0.05]) {
        const p = walk(w, { x: x0, z: -1 }, { x: 0, z: 1 }, 3);
        expect(p.z, `x0=${x0}`).toBeLessThan(1);
      }
    });

    it('çok büyük adımda (dt sıçraması) bile ince duvardan tünellenmez', () => {
      const w = new CollisionWorld();
      w.addSegment(5, -5, 5, 5);
      const r = w.move({ x: 0, z: 0 }, { x: 1000, z: 0 }, R);
      expect(r.x).toBeLessThan(5);
    });

    it('sıfır uzunluklu segment nokta engel gibi davranır', () => {
      const w = new CollisionWorld();
      w.addSegment(2, 0, 2, 0);
      const r = w.move({ x: 0, z: 0 }, { x: 4, z: 0 }, R);
      expect(r.x).toBeLessThan(2);
      expect(Number.isFinite(r.z)).toBe(true);
    });

    it('oyuncu tam segment üzerindeyse sonlu bir yöne itilir (NaN yok)', () => {
      const w = new CollisionWorld();
      w.addSegment(-1, 0, 1, 0);
      const p = { x: 0, z: 0 };
      w.resolve(p, R);
      expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
      expect(Math.abs(p.z)).toBeGreaterThanOrEqual(R - 1e-3);
    });
  });

  describe('addFromObject / localBounds', () => {
    it('ölçeklenmiş ve döndürülmüş grup: alt meshlerin birleşik kutusu', () => {
      const w = new CollisionWorld();
      const g = new THREE.Group();
      const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
      a.position.set(-1, 0.5, 0);
      const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
      b.position.set(1, 0.5, 0);
      g.add(a, b);
      g.position.set(10, 0, 0);
      g.rotation.y = Math.PI / 2; // grup yerel X → dünya -Z
      g.scale.setScalar(2);
      const c = w.addFromObject(g);
      expect(c).not.toBeNull();
      const xs = c.segments.flatMap((s) => [s.ax, s.bx]);
      const zs = c.segments.flatMap((s) => [s.az, s.bz]);
      expect(Math.min(...xs)).toBeCloseTo(10 - 1, 5);
      expect(Math.max(...xs)).toBeCloseTo(10 + 1, 5);
      expect(Math.min(...zs)).toBeCloseTo(-3, 5);
      expect(Math.max(...zs)).toBeCloseTo(3, 5);
    });

    it('boş grup null döner', () => {
      const w = new CollisionWorld();
      expect(w.addFromObject(new THREE.Group())).toBeNull();
      expect(w.count).toBe(0);
    });

    it('localBounds alt nesneleri nesnenin yerel uzayında birleştirir', () => {
      const g = new THREE.Group();
      g.position.set(5, 0, 5);
      g.rotation.y = 1;
      const m = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
      m.position.set(3, 1, 0);
      g.add(m);
      g.updateWorldMatrix(true, true);
      const box = localBounds(g);
      expect(box.min.x).toBeCloseTo(2, 5);
      expect(box.max.x).toBeCloseTo(4, 5);
      expect(box.min.y).toBeCloseTo(0, 5);
    });

    it('convexHull: eşdoğrusal ve tekrarlı noktalar', () => {
      expect(convexHull([[0, 0], [1, 0], [2, 0]])).toHaveLength(2);
      expect(convexHull([[0, 0], [0, 0], [0, 0]])).toHaveLength(1);
      const h = convexHull([[0, 0], [2, 0], [2, 2], [0, 2], [1, 1], [2, 1], [0, 0]]);
      expect(h).toHaveLength(4);
    });
  });
});
