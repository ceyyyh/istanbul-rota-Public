import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { mergeStatic, addBox, addMesh, markDynamic } from '../../src/world/utils.js';
import { CollisionWorld } from '../../src/player/collision.js';
import { applyModuleTransform } from '../../src/world/ShipLayout.js';

// Ship.js modül listesini ve diğer ajanların yapı kodunu içe aktarır; birim testinde bunları
// küçük sahtelerle değiştiriyoruz (DOM/canvas gerektirebilirler ve sürekli değişiyorlar).
const h = vi.hoisted(() => ({ modules: [], shellCalls: 0 }));
vi.mock('../../src/world/modules/index.js', () => ({ MODULES: h.modules }));
vi.mock('../../src/world/structure/corridor.js', async () => {
  const THREE = await import('three');
  return {
    buildCorridor: (ctx, info) => {
      const g = new THREE.Group();
      g.name = `corridor-${info.index}`;
      ctx.scene.add(g);
      return g;
    },
  };
});
vi.mock('../../src/world/exterior/hub.js', () => ({ buildHub: () => null }));
vi.mock('../../src/world/structure/shell.js', async () => {
  const THREE = await import('three');
  return {
    buildShell: (mctx) => {
      h.shellCalls++;
      const m = new THREE.Mesh(new THREE.BoxGeometry(11, 3.2, 0.35), mctx.materials.wall);
      m.name = 'fallback-wall';
      m.position.set(0, 1.6, -3.675);
      m.userData.collide = true;
      mctx.group.add(m);
      return {};
    },
  };
});

const { Ship, extractColliders, createModuleContext } = await import('../../src/world/Ship.js');
const { MODULE_IDS } = await import('../../src/world/ShipLayout.js');
const { EventBus } = await import('../../src/core/EventBus.js');
const { GameState } = await import('../../src/core/GameState.js');
const { LightingManager } = await import('../../src/world/Lighting.js');
const { InteractionSystem } = await import('../../src/interaction/InteractionSystem.js');
const L = await import('../../src/world/ShipLayout.js');

const { knownBug: knownBugShip } = await import('./_helpers.js');

const matA = new THREE.MeshStandardMaterial({ name: 'A' });
const matB = new THREE.MeshStandardMaterial({ name: 'B' });
const matGlass = new THREE.MeshStandardMaterial({ name: 'glass', transparent: true, opacity: 0.2 });

function worldBox(root) {
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root, true); // kesin: köşe başına (döndürülmüş AABB şişmesi olmasın)
}

function countMeshes(root, pred = () => true) {
  let n = 0;
  root.traverse((o) => o.isMesh && pred(o) && n++);
  return n;
}

describe('mergeStatic', () => {
  it('statik meshleri malzeme kovalarına göre birleştirir; kaynak/kova sayısı doğru', () => {
    const root = new THREE.Group();
    for (let i = 0; i < 3; i++) addBox(root, { size: [1, 1, 1], pos: [i * 2, 0.5, 0], material: matA });
    for (let i = 0; i < 2; i++) addBox(root, { size: [1, 2, 1], pos: [0, 1, i * 2 + 3], material: matB });
    const stats = mergeStatic(root);
    expect(stats).toEqual({ sources: 5, merged: 2 });
    const meshes = root.children.filter((c) => c.isMesh);
    expect(meshes).toHaveLength(2);
    expect(meshes.every((m) => m.userData.merged)).toBe(true);
    const a = meshes.find((m) => m.material === matA);
    const b = meshes.find((m) => m.material === matB);
    // BoxGeometry indeksli 36 köşe → indekssiz 36 köşe/kutu
    expect(a.geometry.attributes.position.count).toBe(3 * 36);
    expect(b.geometry.attributes.position.count).toBe(2 * 36);
    expect(a.geometry.index).toBeNull();
  });

  it('dönüşümlü kökte (modül konumu) dünya sınırları korunur', () => {
    const root = new THREE.Group();
    applyModuleTransform(root, 5);
    addBox(root, { size: [1, 1, 1], pos: [3, 0.5, -2], rot: [0, 0.7, 0], material: matA });
    addBox(root, { size: [0.5, 2, 0.5], pos: [-4, 1, 2], scale: [1, 1.5, 1], material: matA });
    addBox(root, { size: [2, 0.1, 2], pos: [0, 3, 0], material: matB });
    const before = worldBox(root);
    mergeStatic(root);
    const after = worldBox(root);
    expect(after.min.distanceTo(before.min)).toBeLessThan(1e-4);
    expect(after.max.distanceTo(before.max)).toBeLessThan(1e-4);
  });

  it('dinamik meshler ve dinamik grupların altı birleştirilmez (aynı nesne, aynı malzeme)', () => {
    const root = new THREE.Group();
    addBox(root, { size: [1, 1, 1], material: matA });
    const dyn = addBox(root, { size: [1, 1, 1], pos: [2, 0, 0], material: matA, dynamic: true });
    const dynGroup = markDynamic(new THREE.Group());
    root.add(dynGroup);
    const inner = addBox(dynGroup, { size: [1, 1, 1], pos: [4, 0, 0], material: matA });
    const noMerge = addBox(root, { size: [1, 1, 1], pos: [6, 0, 0], material: matA });
    noMerge.userData.noMerge = true;
    const stats = mergeStatic(root);
    expect(stats.sources).toBe(1);
    expect(dyn.parent).toBe(root);
    expect(inner.parent).toBe(dynGroup);
    expect(dynGroup.parent).toBe(root);
    expect(noMerge.parent).toBe(root);
    expect(dyn.material).toBe(matA);
    expect(dyn.userData.merged).toBeUndefined();
  });

  it('çocuklu statik mesh: çocuklar aynı ad ve dönüşümle bir tutucuda korunur', () => {
    const root = new THREE.Group();
    const parent = addBox(root, { size: [1, 1, 1], pos: [1, 2, 3], rot: [0, 0.5, 0], material: matA, name: 'masa' });
    const lamp = addBox(parent, { size: [0.2, 0.2, 0.2], pos: [0, 1, 0], material: matB, dynamic: true, name: 'lamba' });
    root.updateMatrixWorld(true);
    const lampWorld = lamp.matrixWorld.clone();
    const stats = mergeStatic(root);
    expect(stats.sources).toBe(1);
    expect(lamp.parent).not.toBeNull();
    expect(lamp.parent).not.toBe(parent);
    expect(lamp.parent.name).toBe('masa');
    expect(lamp.parent.parent).toBe(root);
    root.updateMatrixWorld(true);
    const e1 = lamp.matrixWorld.elements;
    lampWorld.elements.forEach((v, i) => expect(e1[i]).toBeCloseTo(v, 6));
    expect(parent.parent).toBeNull(); // kaynak mesh kaldırıldı
  });

  it('çoklu malzeme, görünmez, InstancedMesh ve morph hedefli meshler atlanır', () => {
    const root = new THREE.Group();
    const multi = addMesh(root, new THREE.BoxGeometry(1, 1, 1), [matA, matB]);
    const hidden = addBox(root, { size: [1, 1, 1], material: matA });
    hidden.visible = false;
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), matA, 4);
    root.add(inst);
    const stats = mergeStatic(root);
    expect(stats.sources).toBe(0);
    expect(multi.parent).toBe(root);
    expect(hidden.parent).toBe(root);
    expect(inst.parent).toBe(root);
  });

  it('farklı öznitelikli geometriler (uv/normal yok, indeksli/indekssiz) aynı kovada birleşir', () => {
    const root = new THREE.Group();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    addBox(root, { size: [1, 1, 1], material: matA });
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
    addMesh(root, tri, matA, { pos: [3, 0, 0] });
    const withExtra = new THREE.BoxGeometry(1, 1, 1);
    withExtra.setAttribute('uv1', withExtra.attributes.uv.clone());
    addMesh(root, withExtra, matA, { pos: [5, 0, 0] });
    const stats = mergeStatic(root);
    expect(warn).not.toHaveBeenCalled();
    expect(stats).toEqual({ sources: 3, merged: 1 });
    const m = root.children.find((c) => c.userData.merged);
    expect(m.geometry.attributes.position.count).toBe(36 + 3 + 36);
    expect(m.geometry.attributes.uv).toBeDefined();
    expect(m.geometry.attributes.normal).toBeDefined();
    warn.mockRestore();
  });

  it('paylaşılan geometri kaynağı değiştirilmez', () => {
    const root = new THREE.Group();
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const pos0 = geo.attributes.position.array.slice();
    addMesh(root, geo, matA, { pos: [5, 5, 5], rot: [0.3, 0.2, 0.1] });
    addMesh(root, geo, matA, { pos: [-5, 0, 0] });
    mergeStatic(root);
    expect(Array.from(geo.attributes.position.array)).toEqual(Array.from(pos0));
    expect(geo.index).not.toBeNull();
  });

  it('saydam malzeme gölge atmaz; noShadow bayrağı uyulur', () => {
    const root = new THREE.Group();
    addBox(root, { size: [1, 1, 1], material: matGlass });
    const ns = addBox(root, { size: [1, 1, 1], material: matB });
    ns.userData.noShadow = true;
    addBox(root, { size: [1, 1, 1], material: matA });
    mergeStatic(root);
    const by = (mat) => root.children.find((c) => c.userData.merged && c.material === mat);
    expect(by(matGlass).castShadow).toBe(false);
    expect(by(matB).castShadow).toBe(false);
    expect(by(matA).castShadow).toBe(true);
    expect(by(matA).receiveShadow).toBe(true);
  });

  it('köşe renkli malzeme: renkli ve renksiz geometriler ayrı kovaya düşer', () => {
    const root = new THREE.Group();
    const vc = new THREE.MeshStandardMaterial({ vertexColors: true });
    const g1 = new THREE.BoxGeometry(1, 1, 1);
    g1.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g1.attributes.position.count * 3).fill(0.5), 3));
    addMesh(root, g1, vc);
    addMesh(root, new THREE.BoxGeometry(1, 1, 1), vc, { pos: [2, 0, 0] });
    const stats = mergeStatic(root);
    expect(stats.merged).toBe(2);
    const colored = root.children.find((c) => c.userData.merged && c.geometry.attributes.color);
    expect(colored).toBeDefined();
  });

  it('ikinci kez çağrılınca zaten birleşmiş meshleri yeniden birleştirir ama geometri kaybolmaz', () => {
    const root = new THREE.Group();
    for (let i = 0; i < 3; i++) addBox(root, { size: [1, 1, 1], pos: [i, 0, 0], material: matA });
    mergeStatic(root);
    const before = worldBox(root);
    mergeStatic(root);
    const after = worldBox(root);
    expect(countMeshes(root)).toBe(1);
    expect(after.min.distanceTo(before.min)).toBeLessThan(1e-5);
    expect(after.max.distanceTo(before.max)).toBeLessThan(1e-5);
  });
});

describe('extractColliders', () => {
  it('collide işaretli nesnelerden dünya uzayında engel üretir; userData.collider atanır', () => {
    const world = new CollisionWorld();
    const root = new THREE.Group();
    applyModuleTransform(root, 3);
    const box = addBox(root, { size: [1, 1, 1], pos: [2, 0.5, 0], material: matA, collide: true, name: 'kasa' });
    addBox(root, { size: [1, 1, 1], pos: [-2, 0.5, 0], material: matA }); // collide yok
    const out = extractColliders(world, root);
    expect(out).toHaveLength(1);
    expect(box.userData.collider).toBe(out[0]);
    expect(out[0].tag).toBe('kasa');
    expect(world.count).toBe(4);
    // Dünya uzayında doğru yerde: modül 3 yerel (2,0) merkezli kutu
    const c = L.localToWorld(3, 2, 0);
    const from = L.localToWorld(3, 0, 0);
    const r = world.move(from, c, 0.3, 0.3, 1.8);
    expect(Math.hypot(r.x - c.x, r.z - c.z)).toBeGreaterThan(0.5 + 0.3 - 1e-3);
  });

  it('collide işaretli grup tek bir zarf olarak eklenir (alt meshler dahil)', () => {
    const world = new CollisionWorld();
    const root = new THREE.Group();
    const g = new THREE.Group();
    g.userData.collide = true;
    addBox(g, { size: [1, 1, 1], pos: [-1, 0.5, 0], material: matA });
    addBox(g, { size: [1, 1, 1], pos: [1, 0.5, 0], material: matA });
    root.add(g);
    const out = extractColliders(world, root);
    expect(out).toHaveLength(1);
    const xs = out[0].segments.flatMap((s) => [s.ax, s.bx]);
    expect(Math.min(...xs)).toBeCloseTo(-1.5, 5);
    expect(Math.max(...xs)).toBeCloseTo(1.5, 5);
  });

  it('boş collide grubu engel üretmez', () => {
    const world = new CollisionWorld();
    const root = new THREE.Group();
    const g = new THREE.Group();
    g.userData.collide = true;
    root.add(g);
    expect(extractColliders(world, root)).toHaveLength(0);
  });

  it('birleştirmeden önce çıkarılan engeller birleştirmeden sonra da geçerli', () => {
    const world = new CollisionWorld();
    const root = new THREE.Group();
    addBox(root, { size: [0.4, 2, 6], pos: [1, 1, 0], material: matA, collide: true });
    extractColliders(world, root);
    mergeStatic(root);
    const r = world.move({ x: 0, z: 0 }, { x: 3, z: 0 }, 0.3, 0.3, 1.8);
    expect(r.x).toBeLessThan(0.8 - 0.3 + 1e-3);
  });
});

// ---------------- Ship (sahte modüllerle) ----------------

function makeCtx() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 100);
  const bus = new EventBus();
  const input = { enabled: true, actionPressed: () => false };
  const updaters = [];
  const ctx = {
    THREE,
    scene,
    camera,
    bus,
    state: new GameState(bus),
    input,
    collision: new CollisionWorld(),
    lighting: new LightingManager(scene, 4),
    materials: { wall: matA, metal: matB },
    player: { position: new THREE.Vector3(), location: { index: 1, id: 'cryo', region: 'module' } },
    doors: [],
    doorOpeners: [],
    onUpdate: (fn) => {
      updaters.push(fn);
      return () => updaters.splice(updaters.indexOf(fn), 1);
    },
    _updaters: updaters,
  };
  ctx.interactions = new InteractionSystem({ camera, input, bus, getUI: () => null });
  return ctx;
}

function simpleModule(id, extra) {
  return {
    id,
    name: id,
    build: vi.fn((mctx) => {
      addBox(mctx.group, { size: [1, 1, 1], pos: [3, 0.5, -2], material: mctx.materials.metal, collide: true });
      addBox(mctx.group, { size: [1, 1, 1], pos: [-3, 0.5, -2], material: mctx.materials.metal });
      extra?.(mctx);
    }),
  };
}

describe('Ship (sahte modüllerle)', () => {
  let errSpy;
  let warnSpy;
  beforeEach(() => {
    h.modules.length = 0;
    h.shellCalls = 0;
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('12 modülü sırayla bir kez kurar; engeller çıkarılır ve statikler birleştirilir', () => {
    MODULE_IDS.forEach((id) => h.modules.push(simpleModule(id)));
    const ctx = makeCtx();
    const ship = new Ship(ctx).build();
    expect(ship.modules).toHaveLength(12);
    expect(ship.corridors).toHaveLength(12);
    h.modules.forEach((m) => expect(m.build).toHaveBeenCalledTimes(1));
    for (const m of ship.modules) {
      expect(m.colliders).toHaveLength(1);
      expect(m.stats).toEqual({ sources: 2, merged: 1 });
      expect(m.group.name).toBe(`module-${m.id}`);
    }
    expect(ship.getModule('engine').index).toBe(6);
    expect(ship.getModule(6).id).toBe('engine');
    expect(errSpy).not.toHaveBeenCalled();
    expect(h.shellCalls).toBe(0);
  });

  it('modül sayısı 12 değilse hata fırlatır', () => {
    MODULE_IDS.slice(0, 11).forEach((id) => h.modules.push(simpleModule(id)));
    expect(() => new Ship(makeCtx()).build()).toThrow();
  });

  it('modül sırası uyuşmazsa uyarır', () => {
    const ids = [...MODULE_IDS];
    [ids[2], ids[3]] = [ids[3], ids[2]];
    ids.forEach((id) => h.modules.push(simpleModule(id)));
    new Ship(makeCtx()).build();
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('[ship]'))).toBe(true);
  });

  it('kurulumda hata atan modül için yedek kabuk kurulur ve [ship] hatası yazılır', () => {
    MODULE_IDS.forEach((id) =>
      h.modules.push(
        id === 'lab'
          ? {
              id,
              name: id,
              build: (mctx) => {
                addBox(mctx.group, { size: [1, 1, 1], material: matA, name: 'yarım' });
                throw new Error('bozuk modül');
              },
            }
          : simpleModule(id),
      ),
    );
    const ship = new Ship(makeCtx()).build();
    expect(h.shellCalls).toBe(1);
    const lab = ship.getModule('lab');
    expect(lab.colliders).toHaveLength(1); // yedek duvar
    expect(lab.group.getObjectByName('yarım')).toBeUndefined();
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes('[ship]') && String(c[0]).includes('lab'))).toBe(true);
  });

  it('mctx: toWorld ShipLayout ile tutarlı; addLight yerel konumu dünyaya çevirir; playerInside', () => {
    let captured = null;
    MODULE_IDS.forEach((id) =>
      h.modules.push(
        simpleModule(id, (mctx) => {
          if (id === 'hydro') {
            captured = {
              w: mctx.toWorld(1.5, 2, -0.75),
              rec: mctx.addLight([1.5, 2, -0.75], { intensity: 3, emergency: null }),
              inside: mctx.playerInside(),
              ok: typeof mctx.addEmissive === 'function' && typeof mctx.playerLocal === 'function',
              index: mctx.index,
            };
          }
        }),
      ),
    );
    const ctx = makeCtx();
    new Ship(ctx).build();
    const exp = L.localToWorld(5, 1.5, -0.75);
    expect(captured.index).toBe(5);
    expect(captured.w.x).toBeCloseTo(exp.x, 5);
    expect(captured.w.z).toBeCloseTo(exp.z, 5);
    expect(captured.w.y).toBeCloseTo(2, 5);
    expect(captured.rec.position.x).toBeCloseTo(exp.x, 5);
    expect(captured.rec.position.z).toBeCloseTo(exp.z, 5);
    expect(captured.inside).toBe(false); // oyuncu cryo'da
    expect(captured.ok).toBe(true);
  });

  // Ship.js: build() hata atınca yalnızca group.clear() yapılır. Modülün o ana kadar kaydettiği
  // etkileşimler (sahne dışı ama görünür → hayalet etkileşim), çarpışma engelleri (görünmez duvar),
  // ışıklar ve onUpdate geri çağrıları geride kalır.
  knownBugShip('yarım kalan modülün kayıtları (etkileşim/engel/ışık/onUpdate) yedek kabukta temizlenmeli', () => {
    MODULE_IDS.forEach((id) =>
      h.modules.push(
        id === 'cargo'
          ? {
              id,
              name: id,
              build: (mctx) => {
                const crate = addBox(mctx.group, { size: [1, 1, 1], pos: [0, 0.5, 0], material: matA });
                mctx.interactions.add(crate, { prompt: 'Aç', onInteract: () => {} });
                const p = mctx.toWorld(0, 0, 0);
                mctx.collision.addSegment(p.x - 1, p.z, p.x + 1, p.z, { tag: 'yarım' });
                mctx.addLight([0, 2.8, 0], { intensity: 5 });
                mctx.onUpdate(() => crate.rotation.y++);
                throw new Error('yarıda kaldı');
              },
            }
          : simpleModule(id),
      ),
    );
    const ctx = makeCtx();
    const ship = new Ship(ctx).build();
    const cargo = ship.getModule('cargo');
    // Sahnede olmayan nesneye bağlı etkileşim kalmamalı
    const orphan = ctx.interactions.handles.filter((hd) => {
      let o = hd.object;
      while (o.parent) o = o.parent;
      return o !== ctx.scene;
    });
    expect(orphan).toHaveLength(0);
    // 'yarım' etiketli engel kalmamalı
    const c = L.localToWorld(8, 0, 0);
    expect(ctx.collision.query(c.x, c.z, 2).filter((s) => s.tag === 'yarım')).toHaveLength(0);
    // modülün yarım kurulumdan kalan ışığı olmamalı (yedek kabuk sahtesi ışık eklemiyor)
    const lightsInCargo = ctx.lighting.records.filter((r) => L.locate(r.position.x, r.position.z).id === 'cargo');
    expect(lightsInCargo).toHaveLength(0);
    expect(cargo.group.children.length).toBeGreaterThan(0);
  });

  it('playerLocal oyuncunun modül yerel konumunu verir', () => {
    const ctx = makeCtx();
    const group = new THREE.Group();
    applyModuleTransform(group, 7);
    group.updateMatrixWorld(true);
    const mctx = createModuleContext(ctx, group, 7, { id: 'robotics', name: 'r' });
    const w = L.localToWorld(7, -2, 1.25);
    ctx.player.position.set(w.x, 0, w.z);
    ctx.player.location = L.locate(w.x, w.z);
    const p = mctx.playerLocal();
    expect(p.x).toBeCloseTo(-2, 5);
    expect(p.z).toBeCloseTo(1.25, 5);
    expect(mctx.playerInside()).toBe(true);
  });
});

export {}; // (vitest üst düzey await için ESM)
