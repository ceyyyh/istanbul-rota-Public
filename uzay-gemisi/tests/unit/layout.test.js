import { describe, it, expect } from 'vitest';
import * as L from '../../src/world/ShipLayout.js';

describe('ShipLayout', () => {
  it('12 modül kimliği var', () => {
    expect(L.MODULE_IDS).toHaveLength(L.MODULE_COUNT);
    expect(new Set(L.MODULE_IDS).size).toBe(12);
  });

  it('localToWorld ve worldToLocal birbirinin tersi', () => {
    for (let i = 0; i < 12; i++) {
      const w = L.localToWorld(i, 2.3, -1.7);
      const l = L.worldToLocal(i, w.x, w.z);
      expect(l.lx).toBeCloseTo(2.3, 6);
      expect(l.lz).toBeCloseTo(-1.7, 6);
    }
  });

  it('yerel +Z merkeze (hub) doğru bakar', () => {
    for (let i = 0; i < 12; i++) {
      const c = L.localToWorld(i, 0, 0);
      const inner = L.localToWorld(i, 0, 1);
      expect(Math.hypot(inner.x, inner.z)).toBeLessThan(Math.hypot(c.x, c.z));
    }
  });

  it('moduleTransform dönüşü localToWorld ile tutarlı', () => {
    for (let i = 0; i < 12; i++) {
      const t = L.moduleTransform(i);
      const c = Math.cos(t.rotationY);
      const s = Math.sin(t.rotationY);
      const lx = 1.5;
      const lz = -0.75;
      // THREE Y dönüşü
      const x = t.position.x + lx * c + lz * s;
      const z = t.position.z - lx * s + lz * c;
      const w = L.localToWorld(i, lx, lz);
      expect(x).toBeCloseTo(w.x, 6);
      expect(z).toBeCloseTo(w.z, 6);
    }
  });

  it('koridor uçları modül kapılarına denk gelir', () => {
    for (let i = 0; i < 12; i++) {
      const info = L.corridorInfo(i);
      expect(info.length).toBeGreaterThan(4);
      expect(info.length).toBeLessThan(7);
      const la = L.worldToLocal(i, info.a.x, info.a.z);
      expect(la.lz).toBeCloseTo(0, 6);
      expect(la.lx).toBeCloseTo(L.MODULE_LENGTH / 2 + L.WALL_THICKNESS, 6);
      // rotationY yerel +X'i a→b yönüne çevirir
      expect(Math.cos(info.rotationY)).toBeCloseTo(info.dir.x, 6);
      expect(-Math.sin(info.rotationY)).toBeCloseTo(info.dir.z, 6);
    }
  });

  it('locate modülü ve bölgeyi bulur', () => {
    const p = L.localToWorld(6, 1, 1);
    const loc = L.locate(p.x, p.z);
    expect(loc.id).toBe('engine');
    expect(loc.region).toBe('module');
    const c = L.corridorInfo(6).center;
    expect(L.locate(c.x, c.z).region).toBe('corridor');
  });

  it('spawnPoint yaw yerel +X yönüne bakar', () => {
    for (let i = 0; i < 12; i++) {
      const s = L.spawnPoint(i);
      const fwd = { x: -Math.sin(s.yaw), z: -Math.cos(s.yaw) };
      const ahead = L.worldToLocal(i, s.x + fwd.x, s.z + fwd.z);
      expect(ahead.lx).toBeCloseTo(1, 6);
      expect(ahead.lz).toBeCloseTo(0, 6);
    }
  });
});

describe('ShipLayout.ringPath', () => {
  const path = L.ringPath();

  it('modül başına giriş/merkez/çıkış: 36 nokta, halka sırasıyla', () => {
    expect(path).toHaveLength(L.MODULE_COUNT * 3);
    path.forEach((p, k) => {
      expect(p.index).toBe(Math.floor(k / 3));
      expect(p.kind).toBe(['enter', 'center', 'exit'][k % 3]);
      expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
    });
  });

  it('her nokta kendi modülünün içinde ve kapıdan kapıya şeridinde (lz = 0, |lx| ≤ 5.5)', () => {
    for (const p of path) {
      const loc = L.locate(p.x, p.z);
      expect(loc.index).toBe(p.index);
      expect(loc.region).toBe('module');
      expect(Math.abs(loc.lz)).toBeLessThan(1e-9);
      expect(Math.abs(loc.lx)).toBeLessThanOrEqual(L.MODULE_LENGTH / 2);
    }
  });

  it('noktalar halka yarıçapında (RING_RADIUS civarı)', () => {
    for (const p of path) {
      const r = Math.hypot(p.x, p.z);
      expect(Math.abs(r - L.RING_RADIUS)).toBeLessThan(1);
    }
  });

  it('ardışık noktalar arası mesafe makul ve döngü kapalı (son çıkış → ilk giriş)', () => {
    for (let k = 0; k < path.length; k++) {
      const a = path[k];
      const b = path[(k + 1) % path.length];
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      if (a.kind === 'exit') {
        // koridor: kapıdan kapıya ≈ 0.6 + duvar + koridor + duvar + 0.6
        const c = L.corridorInfo(a.index);
        expect(d).toBeGreaterThan(c.length);
        expect(d).toBeLessThan(c.length + 2 * (0.6 + L.WALL_THICKNESS) + 0.2);
      } else {
        expect(d).toBeCloseTo(L.MODULE_LENGTH / 2 - 0.6, 6);
      }
    }
  });

  it('ileri yön saat yönünün tersine (artan açı) ilerler', () => {
    const ang = (p) => Math.atan2(p.z, p.x);
    for (let i = 0; i < L.MODULE_COUNT; i++) {
      const enter = path[i * 3];
      const exit = path[i * 3 + 2];
      let d = ang(exit) - ang(enter);
      d = Math.atan2(Math.sin(d), Math.cos(d));
      expect(d).toBeGreaterThan(0);
    }
  });

  it('koridor merkezi iki modülün kapıları arasında ve region=corridor', () => {
    for (let i = 0; i < L.MODULE_COUNT; i++) {
      const c = L.corridorInfo(i);
      expect(L.locate(c.center.x, c.center.z).region).toBe('corridor');
      // koridor yarıçapı modül genişliğinin içinde: tüp, kapı boşluğuna oturur
      expect(L.CORRIDOR_HALF_WIDTH * 2).toBeGreaterThanOrEqual(L.DOOR_WIDTH);
    }
  });

  it('wrapIndex ve moduleIndexById kenar durumları', () => {
    expect(L.wrapIndex(-1)).toBe(11);
    expect(L.wrapIndex(12)).toBe(0);
    expect(L.wrapIndex(25)).toBe(1);
    expect(L.moduleIndexById('observation')).toBe(11);
    expect(() => L.moduleIndexById('yok')).toThrow();
    expect(L.spawnPoint('cryo').index).toBe(1);
    expect(L.spawnPoint(13).index).toBe(1);
  });

  it('locate: tam halka açısı sınırlarında (modüller arası orta çizgi) geçerli indeks', () => {
    for (let i = 0; i < L.MODULE_COUNT; i++) {
      const a = (i + 0.5) * ((Math.PI * 2) / L.MODULE_COUNT);
      const loc = L.locate(L.RING_RADIUS * Math.cos(a), L.RING_RADIUS * Math.sin(a));
      expect(loc.index).toBeGreaterThanOrEqual(0);
      expect(loc.index).toBeLessThan(12);
      expect(L.MODULE_IDS[loc.index]).toBe(loc.id);
    }
  });
});
