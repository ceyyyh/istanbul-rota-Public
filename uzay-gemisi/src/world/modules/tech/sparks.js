import * as THREE from 'three';

/**
 * Basit kıvılcım efekti (THREE.Points, toplamalı karışım). Dinamik nesnedir.
 *
 *   const sparks = createSparks(group, { count: 48 });
 *   sparks.burst([x, y, z], { dir: [0, 0, -1] });
 *   mctx.onUpdate((dt) => sparks.update(dt));
 */
export function createSparks(parent, { count = 48, size = 0.035, color = 0xffc070 } = {}) {
  const positions = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const life = new Float32Array(count);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color,
    size,
    sizeAttenuation: true,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  mat.name = 'tech.sparks';
  const points = new THREE.Points(geo, mat);
  points.name = 'kıvılcım';
  points.frustumCulled = false;
  points.visible = false;
  points.userData.dynamic = true;
  parent.add(points);
  let active = 0;

  return {
    points,
    get active() {
      return active > 0;
    },
    burst(origin, { dir = [0, 0, -1], speed = 2.2, spread = 1.4 } = {}) {
      for (let i = 0; i < count; i++) {
        positions[i * 3] = origin[0];
        positions[i * 3 + 1] = origin[1];
        positions[i * 3 + 2] = origin[2];
        const s = speed * (0.4 + Math.random() * 0.8);
        vel[i * 3] = (dir[0] + (Math.random() - 0.5) * spread) * s;
        vel[i * 3 + 1] = (dir[1] + Math.random() * 0.8 * spread) * s;
        vel[i * 3 + 2] = (dir[2] + (Math.random() - 0.5) * spread) * s;
        life[i] = 0.35 + Math.random() * 0.55;
      }
      active = 1.0;
      points.visible = true;
      mat.opacity = 1;
      geo.attributes.position.needsUpdate = true;
    },
    update(dt) {
      if (active <= 0) return;
      active -= dt;
      let alive = 0;
      for (let i = 0; i < count; i++) {
        if (life[i] <= 0) {
          positions[i * 3 + 1] = -100;
          continue;
        }
        life[i] -= dt;
        alive++;
        vel[i * 3 + 1] -= 9.8 * dt;
        positions[i * 3] += vel[i * 3] * dt;
        positions[i * 3 + 1] += vel[i * 3 + 1] * dt;
        positions[i * 3 + 2] += vel[i * 3 + 2] * dt;
        if (positions[i * 3 + 1] < 0.01) {
          positions[i * 3 + 1] = 0.01;
          vel[i * 3 + 1] *= -0.3;
          vel[i * 3] *= 0.5;
          vel[i * 3 + 2] *= 0.5;
        }
      }
      mat.opacity = Math.min(1, active * 2);
      geo.attributes.position.needsUpdate = true;
      if (!alive || active <= 0) {
        active = 0;
        points.visible = false;
      }
    },
  };
}
