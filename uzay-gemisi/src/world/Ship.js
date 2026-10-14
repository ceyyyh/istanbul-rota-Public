import * as THREE from 'three';
import { MODULES } from './modules/index.js';
import { MODULE_IDS, MODULE_COUNT, MODULE_LENGTH, MODULE_WIDTH, MODULE_HEIGHT, applyModuleTransform, corridorInfo } from './ShipLayout.js';
import { buildCorridor } from './structure/corridor.js';
import { buildHub } from './exterior/hub.js';
import { buildShell } from './structure/shell.js';
import { mergeStatic } from './utils.js';

/**
 * Gemiyi kurar: 12 modül + 12 koridor + merkez göbek.
 *
 * Her modül için bir "modül bağlamı" (mctx) oluşturulur; modül `build(mctx)`
 * içinde `mctx.group`'a (yerel koordinatlarda) nesne ekler. Ardından:
 *   1) userData.collide işaretli nesnelerden çarpışma engelleri çıkarılır,
 *   2) statik meshler malzemeye göre birleştirilir (dynamic olanlar hariç).
 */
export class Ship {
  constructor(ctx) {
    this.ctx = ctx;
    this.modules = [];
    this.corridors = [];
    this.root = new THREE.Group();
    this.root.name = 'ship';
  }

  build() {
    const ctx = this.ctx;
    if (MODULES.length !== MODULE_COUNT) throw new Error('Modül sayısı 12 olmalı');

    for (let i = 0; i < MODULE_COUNT; i++) {
      const def = MODULES[i];
      if (def.id !== MODULE_IDS[i]) console.warn(`[ship] modül sırası uyuşmuyor: ${def.id} ≠ ${MODULE_IDS[i]}`);
      const group = new THREE.Group();
      group.name = `module-${def.id}`;
      applyModuleTransform(group, i);
      ctx.scene.add(group);
      group.updateMatrixWorld(true);
      const mctx = createModuleContext(ctx, group, i, def);
      const t0 = performance.now();
      try {
        def.build(mctx);
      } catch (err) {
        console.error(`[ship] "${def.id}" modülü kurulamadı, yedek kabuk kullanılıyor:`, err);
        group.clear();
        buildShell(mctx, {});
      }
      const colliders = extractColliders(ctx.collision, group);
      markExterior(group);
      const stats = mergeStatic(group);
      this.modules.push({ index: i, id: def.id, name: def.name, def, group, mctx, colliders, stats, ms: performance.now() - t0 });
    }

    for (let i = 0; i < MODULE_COUNT; i++) {
      const info = corridorInfo(i);
      let g;
      try {
        g = buildCorridor(ctx, info);
      } catch (err) {
        console.error(`[ship] koridor ${i} kurulamadı:`, err);
        continue;
      }
      extractColliders(ctx.collision, g);
      mergeStatic(g);
      this.corridors.push({ index: i, info, group: g });
    }

    // Görünürlük: oyuncudan halka boyunca 1'den uzak modüllerin yalnızca dış gövdesi çizilir
    ctx.bus.on('player:module', ({ index }) => this.updateVisibility(index));
    this.updateVisibility(ctx.player?.location?.index ?? 0);

    try {
      const hub = buildHub(ctx);
      if (hub) {
        mergeStatic(hub);
        this.hub = hub;
      }
    } catch (err) {
      console.error('[ship] göbek kurulamadı:', err);
    }
    return this;
  }

  /** Modül iç mekânlarını oyuncuya halka mesafesine göre göster/gizle (çizim çağrısı ↓). */
  updateVisibility(playerIndex, range = 1) {
    for (const m of this.modules) {
      const d = Math.abs(m.index - playerIndex);
      const near = Math.min(d, MODULE_COUNT - d) <= range;
      if (m._near === near) continue;
      m._near = near;
      for (const c of m.group.children) c.visible = near || !!c.userData.exterior;
    }
  }

  getModule(idOrIndex) {
    return typeof idOrIndex === 'number' ? this.modules[idOrIndex] : this.modules.find((m) => m.id === idOrIndex);
  }
}

/** Modül yazarlarına verilen bağlam. Ayrıntılar: docs/ARCHITECTURE.md */
export function createModuleContext(ctx, group, index, def) {
  const tmp = new THREE.Vector3();
  return {
    ...ctx,
    group,
    index,
    id: def.id,
    name: def.name,
    /** Yerel → dünya konumu */
    toWorld(x, y, z) {
      return group.localToWorld(new THREE.Vector3(x, y, z));
    },
    /** Yerel konumda havuzlu nokta ışığı ekler. opts: color, intensity, distance, emergency, flicker */
    addLight(localPos, opts = {}) {
      group.updateMatrixWorld(true);
      const p = group.localToWorld(new THREE.Vector3(localPos[0], localPos[1], localPos[2]));
      return ctx.lighting.addPointLight({ ...opts, position: p });
    },
    addEmissive(material, opts) {
      return ctx.lighting.addEmissive(material, opts);
    },
    /** Oyuncu bu modülün içinde mi? */
    playerInside() {
      return ctx.player.location.index === index && ctx.player.location.region === 'module';
    },
    /** Oyuncunun modül yerel koordinatlarındaki konumu */
    playerLocal() {
      tmp.copy(ctx.player.position);
      return group.worldToLocal(tmp.clone());
    },
  };
}

/**
 * Modülün iç hacminin tamamen dışında kalan statik meshleri `userData.exterior` ile işaretler
 * (dış gövde, iticiler, antenler). Uzak modüllerde yalnızca bunlar çizilir.
 */
export function markExterior(group) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const m = new THREE.Matrix4();
  const box = new THREE.Box3();
  const hx = MODULE_LENGTH / 2 - 0.02;
  const hz = MODULE_WIDTH / 2 - 0.02;
  const visit = (o) => {
    if (o !== group && (o.userData.dynamic || o.userData.noMerge)) return;
    if (o.isMesh && o.geometry) {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      box.copy(o.geometry.boundingBox).applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld));
      const outside =
        box.min.x >= hx || box.max.x <= -hx || box.min.z >= hz || box.max.z <= -hz || box.min.y >= MODULE_HEIGHT - 0.02 || box.max.y <= 0.02;
      if (outside) o.userData.exterior = true;
    }
    for (const c of o.children) visit(c);
  };
  visit(group);
}

/** userData.collide işaretli nesnelerden çarpışma engeli üretir. */
export function extractColliders(collision, root) {
  const out = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.userData.collide) return;
    const c = collision.addFromObject(o, { tag: o.name || 'obj' });
    if (c) {
      out.push(c);
      o.userData.collider = c;
    }
  });
  return out;
}
