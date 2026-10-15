import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CollisionWorld, convexHull } from '../../src/player/collision.js';

describe('CollisionWorld', () => {
  it('duvar oyuncuyu durdurur', () => {
    const w = new CollisionWorld();
    w.addSegment(1, -5, 1, 5);
    const r = w.move({ x: 0, z: 0 }, { x: 3, z: 0 }, 0.3);
    expect(r.x).toBeLessThanOrEqual(0.7 + 1e-3);
    expect(r.collided).toBe(true);
  });

  it('duvar boyunca kayar', () => {
    const w = new CollisionWorld();
    w.addSegment(1, -5, 1, 5);
    const r = w.move({ x: 0.6, z: 0 }, { x: 1.6, z: 1 }, 0.3);
    expect(r.x).toBeLessThanOrEqual(0.7 + 1e-3);
    expect(r.z).toBeCloseTo(1, 1);
  });

  it('kapı boşluğundan geçilir, devre dışı engel engellemez', () => {
    const w = new CollisionWorld();
    w.addSegment(1, -5, 1, -0.8);
    w.addSegment(1, 0.8, 1, 5);
    const door = w.addSegment(1, -0.8, 1, 0.8);
    let r = w.move({ x: 0, z: 0 }, { x: 3, z: 0 }, 0.3);
    expect(r.x).toBeLessThan(1);
    w.setEnabled(door, false);
    r = w.move({ x: 0, z: 0 }, { x: 3, z: 0 }, 0.3);
    expect(r.x).toBeCloseTo(3, 5);
  });

  it('dikey aralık dışındaki engeller yok sayılır', () => {
    const w = new CollisionWorld();
    w.addSegment(1, -5, 1, 5, { yMin: 2.5, yMax: 3 }); // tavan borusu
    const r = w.move({ x: 0, z: 0 }, { x: 3, z: 0 }, 0.3, 0.3, 1.8);
    expect(r.x).toBeCloseTo(3, 5);
  });

  it('döndürülmüş nesneden engel üretir', () => {
    const w = new CollisionWorld();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 0.2));
    mesh.position.set(5, 0.5, 0);
    mesh.rotation.y = Math.PI / 2; // artık Z boyunca uzanıyor
    const c = w.addFromObject(mesh);
    expect(c.segments.length).toBe(4);
    const r = w.move({ x: 3, z: 0 }, { x: 7, z: 0 }, 0.3, 0.3, 1.8);
    expect(r.x).toBeLessThan(5);
  });

  it('hızlı harekette tünelleme olmaz', () => {
    const w = new CollisionWorld();
    w.addSegment(1, -5, 1, 5);
    const r = w.move({ x: 0, z: 0 }, { x: 50, z: 0 }, 0.3);
    expect(r.x).toBeLessThan(1);
  });

  it('dışbükey zarf', () => {
    const hull = convexHull([[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]]);
    expect(hull).toHaveLength(4);
  });
});
