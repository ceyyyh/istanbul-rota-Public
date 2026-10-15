import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Modül yazarları için küçük yardımcılar. Hepsi `parent`'a ekler ve mesh döndürür.
 * Konumlar parent'ın yerel uzayındadır.
 *
 *   addBox(group, { size: [w, h, d], pos: [x, y, z], material, collide: true })
 *   addCylinder(group, { radius: 0.3, height: 1, pos: [...], rot: [...], material })
 *   addMesh(group, geometry, material, { pos, rot, scale, collide })
 *
 * collide: true → Ship bu nesnenin sınır kutusundan çarpışma engeli üretir.
 * dynamic: true → statik birleştirmeye girmez (hareket eden/animasyonlu nesneler için ŞART).
 */
export function addMesh(parent, geometry, material, opts = {}) {
  const m = new THREE.Mesh(geometry, material);
  if (opts.pos) m.position.set(opts.pos[0], opts.pos[1], opts.pos[2]);
  if (opts.rot) m.rotation.set(opts.rot[0], opts.rot[1], opts.rot[2]);
  if (opts.scale) {
    if (typeof opts.scale === 'number') m.scale.setScalar(opts.scale);
    else m.scale.set(opts.scale[0], opts.scale[1], opts.scale[2]);
  }
  if (opts.name) m.name = opts.name;
  if (opts.collide) m.userData.collide = true;
  if (opts.dynamic) m.userData.dynamic = true;
  if (parent) parent.add(m);
  return m;
}

export function addBox(parent, { size = [1, 1, 1], material, ...opts }) {
  return addMesh(parent, new THREE.BoxGeometry(size[0], size[1], size[2]), material, opts);
}

export function addCylinder(
  parent,
  { radius = 0.5, radiusTop, radiusBottom, height = 1, segments = 24, openEnded = false, material, ...opts },
) {
  const g = new THREE.CylinderGeometry(radiusTop ?? radius, radiusBottom ?? radius, height, segments, 1, openEnded);
  return addMesh(parent, g, material, opts);
}

export function addSphere(parent, { radius = 0.5, widthSegments = 24, heightSegments = 16, material, ...opts }) {
  return addMesh(parent, new THREE.SphereGeometry(radius, widthSegments, heightSegments), material, opts);
}

/** Bir nesneyi ve alt ağacını dinamik işaretler (birleştirilmez). */
export function markDynamic(object) {
  object.userData.dynamic = true;
  return object;
}

/**
 * root altındaki statik meshleri malzemeye göre tek meshlerde birleştirir
 * (çizim çağrısı sayısını büyük ölçüde düşürür).
 * userData.exterior işaretli meshler ayrı kovalarda birleştirilir (görünürlük ayıklaması için).
 * Atlananlar: userData.dynamic / userData.noMerge alt ağaçları, çoklu malzemeli,
 * InstancedMesh, SkinnedMesh, görünmez meshler.
 */
export function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map();
  const sources = [];
  const rel = new THREE.Matrix4();

  const visit = (o) => {
    if (o !== root && (o.userData.dynamic || o.userData.noMerge)) return;
    if (
      o !== root &&
      o.isMesh &&
      !o.isInstancedMesh &&
      !o.isSkinnedMesh &&
      o.visible &&
      o.geometry?.attributes?.position &&
      o.material &&
      !Array.isArray(o.material) &&
      !o.morphTargetInfluences
    ) {
      const useColor = !!o.material.vertexColors && !!o.geometry.attributes.color;
      let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const name of Object.keys(g.attributes)) {
        if (name !== 'position' && name !== 'normal' && name !== 'uv' && !(useColor && name === 'color')) {
          g.deleteAttribute(name);
        }
      }
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) {
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      }
      g.morphAttributes = {};
      g.clearGroups();
      rel.multiplyMatrices(inv, o.matrixWorld);
      g.applyMatrix4(rel);
      const exterior = !!o.userData.exterior;
      const key = o.material.uuid + (useColor ? ':c' : '') + (exterior ? ':x' : '');
      if (!buckets.has(key)) buckets.set(key, { material: o.material, geoms: [], noShadow: false, exterior });
      const b = buckets.get(key);
      b.geoms.push(g);
      if (o.userData.noShadow) b.noShadow = true;
      sources.push(o);
    }
    for (const c of [...o.children]) visit(c);
  };
  visit(root);

  // Kaynak meshleri kaldır (çocukları varsa onları koru)
  for (const o of sources) {
    const parent = o.parent;
    if (!parent) continue;
    if (o.children.length) {
      const holder = new THREE.Object3D();
      holder.name = o.name;
      holder.position.copy(o.position);
      holder.quaternion.copy(o.quaternion);
      holder.scale.copy(o.scale);
      for (const c of [...o.children]) holder.add(c);
      parent.add(holder);
    }
    parent.remove(o);
  }

  let mergedCount = 0;
  for (const { material, geoms, noShadow, exterior } of buckets.values()) {
    const merged = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false);
    if (!merged) {
      console.warn('[mergeStatic] birleştirilemedi:', material.name);
      continue;
    }
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `merged:${material.name || material.type}`;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.castShadow = !material.transparent && !noShadow;
    mesh.receiveShadow = true;
    mesh.userData.merged = true;
    if (exterior) mesh.userData.exterior = true;
    root.add(mesh);
    mergedCount++;
  }
  return { sources: sources.length, merged: mergedCount };
}
