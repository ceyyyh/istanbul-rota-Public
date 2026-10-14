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
