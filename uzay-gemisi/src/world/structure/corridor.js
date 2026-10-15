import * as THREE from 'three';
import { CORRIDOR_RADIUS, CORRIDOR_CENTER_Y, CORRIDOR_HALF_WIDTH, moduleAngle } from '../ShipLayout.js';
import { addMesh } from '../utils.js';
import { worldBox, addRod } from './kit.js';

/**
 * Modüller arası bağlantı tüpü — Endurance "bağlantı tüpü" (Ajan 1 — Yapı).
 *
 * @param ctx   oyun bağlamı
 * @param info  ShipLayout.corridorInfo(i) çıktısı
 * @returns THREE.Group (dünya uzayında, sahneye eklenmiş olarak döner)
 *
 * Grup yerel uzayı: +X koridor boyunca (a → b), merkez orijinde, zemin y=0.
 * Çarpışma: yan duvarlar ±CORRIDOR_HALF_WIDTH'te iki doğru parçası (uçları
 * modül duvarlarına gömülecek kadar uzatılmış).
 *
 * UÇLAR: koridor ekseni modülün uç yüzüne ~15° eğik gelir. Tüp uçları dik kesilirse modülün
 * içine ~0.4 m taşar. Bu yüzden tüm tüp yüzeylerinin halkaları modülün uç yüzü düzlemine
 * PARALEL (eğik) dizilir: tüp, yüzü tam o düzlemde (duvar kalınlığı içinde, 5 cm gömülü) bitirir.
 * Dışta körük + yaka halkası birleşimi örter; içte eğik uç levhası (elips) duvarı kapatır.
 */
const SEG = 24;
const R_IN = CORRIDOR_RADIUS; // 1.5 iç yarıçap
const R_OUT = CORRIDOR_RADIUS + 0.06; // dış gövde yarıçapı
const CY = CORRIDOR_CENTER_Y;

/**
 * Halkaları (z) => x işlevleri olan, eksen etrafında açık tüp geometrisi.
 * rings: [{ x: (z) => number, r: yarıçap }]; inward → yüzler içe bakar (iç yüzey).
 */
function tubeGeo(rings, { inward = false, mpr = [4, 4] } = {}) {
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i < rings.length; i++) {
    const { x, r } = rings[i];
    for (let j = 0; j <= SEG; j++) {
      const th = (j / SEG) * Math.PI * 2;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const xx = x(r * s);
      pos.push(xx, CY + r * c, r * s);
      nor.push(0, inward ? -c : c, inward ? -s : s);
      uv.push(xx / mpr[0], (th * R_IN) / mpr[1]);
    }
  }
  const row = SEG + 1;
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < SEG; j++) {
      const a = i * row + j;
      const b = a + row;
      // dışa bakan: (a, a+1, b); içe bakan: ters
      if (inward) idx.push(a, b, a + 1, a + 1, b, b + 1);
      else idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Geometrinin köşelerinin x'ini iki eğik düzlem arasına kırpar (her köşe kendi z'siyle). */
function clampX(geo, lo, hi) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    p.setX(i, Math.min(Math.max(p.getX(i), lo(z)), hi(z)));
  }
  p.needsUpdate = true;
  return geo;
}

export function buildCorridor(ctx, info) {
  const M = ctx.materials;
  const g = new THREE.Group();
  g.name = `corridor-${info.index}`;
  g.position.set(info.center.x, 0, info.center.z);
  g.rotation.y = info.rotationY;
  ctx.scene.add(g);
  g.updateMatrixWorld(true);

  // --- Modül uç yüzü düzlemleri (koridor yerel uzayında) ---
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  const dirL = (wx, wz) => new THREE.Vector3(wx, 0, wz).transformDirection(inv);
  const ptL = (p) => new THREE.Vector3(p.x, 0, p.z).applyMatrix4(inv);
  const aF = moduleAngle(info.from);
  const aT = moduleAngle(info.to);
  const nA = dirL(-Math.sin(aF), Math.cos(aF)); // A modülünün +X (koridora bakan) yönü
  const nB = dirL(Math.sin(aT), -Math.cos(aT)); // B modülünün -X yüzünün dışa normali
  const pa = ptL(info.a);
  const pb = ptL(info.b);
  /** A düzlemi, d kadar koridora doğru kaydırılmış: x ≥ lo(z) */
  const lo = (d) => (z) => pa.x + (d - nA.z * (z - pa.z)) / nA.x;
  /** B düzlemi: x ≤ hi(z) */
  const hi = (d) => (z) => pb.x + (d - nB.z * (z - pb.z)) / nB.x;
  const R = R_IN;
  const loMax = Math.max(lo(0)(R), lo(0)(-R));
  const hiMin = Math.min(hi(0)(R), hi(0)(-R));
  const usable = hiMin - loMax;
  const A = (d, r) => ({ x: lo(d), r });
  const B = (d, r) => ({ x: hi(d), r });
  const mix = (t, d0, d1, r) => ({ x: (z) => lo(d0)(z) + (hi(d1)(z) - lo(d0)(z)) * t, r });

  // ---------------------------------------------------------------
  // İÇ YÜZ: gri dolgulu tüp, kaburga halkaları, ızgara zemin, korkuluklar, ışık şeritleri
  // ---------------------------------------------------------------
  const innerRings = [A(-0.05, R)];
  const nIn = Math.max(2, Math.round(usable / 1.2));
  for (let k = 0; k <= nIn; k++) innerRings.push(mix(k / nIn, 0, 0, R));
  innerRings.push(B(-0.05, R));
  addMesh(g, tubeGeo(innerRings, { inward: true, mpr: [2.75, (2 * Math.PI * R) / 4] }), M.wallQuiltDark);

  // kaburga halkaları (~0.8 m): eksene dik; eğik uç bölgesinden sonra başlar
  const ribStart = loMax + 0.22;
  const ribEnd = hiMin - 0.22;
  const nRib = Math.max(1, Math.round((ribEnd - ribStart) / 0.8));
  const profile = [new THREE.Vector2(R + 0.012, 0.075), new THREE.Vector2(R - 0.07, 0.04), new THREE.Vector2(R - 0.07, -0.04), new THREE.Vector2(R + 0.012, -0.075)];
  let ribGeo = new THREE.LatheGeometry(profile, SEG);
  ribGeo.rotateZ(Math.PI / 2);
  // yüzler eksene (içe) bakmalı: ilk yüzün normali eksene doğruysa dokunma, değilse ters çevir
  {
    const p = ribGeo.attributes.position;
    const n = ribGeo.attributes.normal;
    const ix = ribGeo.index.array;
    const i0 = ix[0];
    const toAxis = new THREE.Vector3(0, -(p.getY(i0)), -(p.getZ(i0)));
    if (toAxis.dot(new THREE.Vector3(n.getX(i0), n.getY(i0), n.getZ(i0))) < 0) {
      for (let i = 0; i < ix.length; i += 3) {
        const t = ix[i + 1];
        ix[i + 1] = ix[i + 2];
        ix[i + 2] = t;
      }
      for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
    }
  }
  for (let k = 0; k <= nRib; k++) {
    const x = nRib === 0 ? (ribStart + ribEnd) / 2 : ribStart + ((ribEnd - ribStart) * k) / nRib;
    addMesh(g, ribGeo, M.panelMid, { pos: [x, CY, 0] });
  }

  // zemin: düz ızgara (uçları eğik kırpılır) + kenar çerçeveleri
  const floorLen = hiMin - loMax + 2;
  const fx = (loMax + hiMin) / 2;
  const floorGeo = worldBox(floorLen, 0.06, 2.3, 1, [fx, -0.03, 0]);
  floorGeo.translate(fx, -0.03, 0);
  addMesh(g, clampX(floorGeo, lo(-0.04), hi(-0.04)), M.floorGrate);
  for (const s of [-1, 1]) {
    const eg = new THREE.BoxGeometry(floorLen, 0.07, 0.08);
    eg.translate(fx, 0, s * 1.08);
    addMesh(g, clampX(eg, lo(-0.04), hi(-0.04)), M.metalDark);
  }

  // korkuluklar: iki yanda, çarpışma duvarının hemen dışında (z = ±1.06)
  const railA = loMax + 0.45;
  const railB = hiMin - 0.45;
  const nPost = Math.max(1, Math.round((railB - railA) / 1.3));
  for (const s of [-1, 1]) {
    const z = s * 1.07;
    addRod(g, [railA, 0.98, z], [railB, 0.98, z], 0.026, M.handrail, { segments: 8 });
    addRod(g, [railA, 0.52, z], [railB, 0.52, z], 0.016, M.handrail, { segments: 6 });
    for (let k = 0; k <= nPost; k++) {
      const x = railA + ((railB - railA) * k) / nPost;
      addRod(g, [x, 0, z], [x, 0.98, z], 0.022, M.metalDark, { segments: 6 });
    }
  }

  // ince ışık şeritleri (üstte iki sıra), acil durum şeritleri (alt yanlarda), kablo demetleri
  const stripA = loMax + 0.3;
  const stripB = hiMin - 0.3;
  for (const s of [-1, 1]) {
    const th = s * 0.68; // ~39° (tepeden)
    const r = R - 0.012;
    const light = new THREE.BoxGeometry(stripB - stripA, 0.025, 0.12);
    addMesh(g, light, M.lightPanel, { pos: [(stripA + stripB) / 2, CY + r * Math.cos(th), r * Math.sin(th)], rot: [th, 0, 0] });
    const th2 = s * 1.9; // alt yan
    const r2 = R - 0.012;
    addMesh(g, new THREE.BoxGeometry(stripB - stripA, 0.02, 0.05), M.emergencyStrip, { pos: [(stripA + stripB) / 2, CY + r2 * Math.cos(th2), r2 * Math.sin(th2)], rot: [th2, 0, 0] });
    for (const [tt, rr, rad] of [[s * 2.12, R - 0.05, 0.04], [s * 2.3, R - 0.04, 0.03]]) {
      addRod(g, [stripA, CY + rr * Math.cos(tt), rr * Math.sin(tt)], [stripB, CY + rr * Math.cos(tt), rr * Math.sin(tt)], rad, M.cable, { segments: 6 });
    }
  }

  // eğik uç levhaları: tüp kesitinde (elips) bulkhead — duvarın dışa bakan yüzünü koridor içinde kapatır
  const disc = (nrm, off, fn) => {
    const geo = new THREE.CylinderGeometry(1, 1, 0.02, 32);
    geo.rotateZ(Math.PI / 2); // eksen X
    geo.scale(1, R + 0.035, (R + 0.035) / Math.abs(nrm.x));
    const psi = -Math.atan2(nrm.z, nrm.x);
    geo.rotateY(psi);
    const z0 = 0;
    geo.translate(fn(z0) + nrm.x * off, CY, 0);
    addMesh(g, geo, M.wallPanelDark);
  };
  disc(nA, 0.012, lo(0));
  disc(nB, 0.012, hi(0));

  // ---------------------------------------------------------------
  // DIŞ YÜZ: beyaz gövde tüpü, altın folyo kılıf, körükler, yaka halkaları
  // ---------------------------------------------------------------
  const wave = [0, 0.05, 0.1, 0.05];
  const bellowsRings = (fn) => {
    const rs = [];
    for (let i = 0; i <= 12; i++) rs.push(fn(-0.06 + i * 0.05, R_OUT + wave[i % 4] * (i === 0 ? 0 : 1)));
    return rs;
  };
  addMesh(g, tubeGeo(bellowsRings(A), { mpr: [1, 1] }), M.hullDark);
  addMesh(g, tubeGeo(bellowsRings(B).reverse(), { mpr: [1, 1] }), M.hullDark);
  const collar = (fn) => [fn(0.55, R_OUT + 0.02), fn(0.6, 1.7), fn(0.72, 1.7), fn(0.77, R_OUT + 0.02)];
  addMesh(g, tubeGeo(collar(A), { mpr: [1, 1] }), M.hullPanel);
  addMesh(g, tubeGeo(collar(B).reverse(), { mpr: [1, 1] }), M.hullPanel);
  // dış gövde tüpü
  const outer = [A(0.77, R_OUT)];
  for (let k = 1; k < 4; k++) outer.push(mix(k / 4, 0.77, 0.77, R_OUT));
  outer.push(B(0.77, R_OUT));
  addMesh(g, tubeGeo(outer, { mpr: [4, 4] }), M.hullWhite);
  // altın MLI kılıf (orta bölüm) + koyu bant halkaları
  addMesh(g, tubeGeo([mix(0.32, 0.77, 0.77, R_OUT + 0.025), mix(0.68, 0.77, 0.77, R_OUT + 0.025)], { mpr: [2.4, 2.4] }), M.hullGold);
  for (const t of [0.31, 0.69]) addMesh(g, tubeGeo([mix(t - 0.012, 0.77, 0.77, R_OUT + 0.045), mix(t + 0.012, 0.77, 0.77, R_OUT + 0.045)], { mpr: [1, 1] }), M.hullDark);
  // tüpün üstünde tutunma çubuğu (dışta)
  addRod(g, [loMax + 1.3, CY + R_OUT + 0.16, 0], [hiMin - 1.3, CY + R_OUT + 0.16, 0], 0.025, M.metal, { segments: 6 });
  for (let k = 0; k < 4; k++) {
    const x = loMax + 1.3 + ((hiMin - loMax - 2.6) * k) / 3;
    addRod(g, [x, CY + R_OUT - 0.02, 0], [x, CY + R_OUT + 0.16, 0], 0.02, M.metalDark, { segments: 5 });
  }

  // ---------------------------------------------------------------
  // Çarpışma (ŞERİTLER KORUNDU: ±CORRIDOR_HALF_WIDTH)
  // ---------------------------------------------------------------
  const ext = 0.45;
  const hw = CORRIDOR_HALF_WIDTH;
  const toWorld = (x, z) => new THREE.Vector3(x, 0, z).applyMatrix4(g.matrixWorld);
  g.updateMatrixWorld(true);
  for (const s of [-1, 1]) {
    const p = toWorld(-info.length / 2 - ext, s * hw);
    const q = toWorld(info.length / 2 + ext, s * hw);
    ctx.collision.addSegment(p.x, p.z, q.x, q.z, { tag: 'corridor' });
  }

  // Koridor ışığı
  const lp = toWorld(0, 0);
  ctx.lighting.addPointLight({
    position: new THREE.Vector3(lp.x, 2.2, lp.z),
    color: 0xe8f0ff,
    intensity: 3,
    distance: 6,
    emergency: { color: 0xff2a1a, intensity: 0.8 },
  });
  return g;
}
