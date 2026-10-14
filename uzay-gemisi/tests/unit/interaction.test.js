import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { InteractionSystem } from '../../src/interaction/InteractionSystem.js';
import { EventBus } from '../../src/core/EventBus.js';
import { FakeInput, knownBug, recordEvents } from './_helpers.js';

/** Kamera (0, 1.6, 0)'da -Z'ye bakar. Nesneler z<0'a konur. */
function setup() {
  const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 100);
  camera.position.set(0, 1.6, 0);
  camera.updateMatrixWorld(true);
  const input = new FakeInput();
  const bus = new EventBus();
  const ui = { showPrompt: vi.fn() };
  const sys = new InteractionSystem({ camera, input, bus, getUI: () => ui });
  const scene = new THREE.Scene();
  scene.add(camera);
  return { camera, input, bus, ui, sys, scene };
}

function box(scene, z, { x = 0, y = 1.6, size = 0.5, material } = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), material ?? new THREE.MeshStandardMaterial({ color: 0x888888 }));
  m.position.set(x, y, z);
  scene.add(m);
  m.updateMatrixWorld(true);
  return m;
}

function tick(t) {
  t.scene.updateMatrixWorld(true);
  t.sys.update();
  t.input.endFrame();
}

describe('InteractionSystem', () => {
  let t;
  beforeEach(() => {
    t = setup();
  });

  it('add: nesneyi dinamik işaretler, tutamaç alanları varsayılanlarla dolar', () => {
    const m = box(t.scene, -2);
    m.name = 'kapak';
    const h = t.sys.add(m, { prompt: 'Aç' });
    expect(m.userData.dynamic).toBe(true);
    expect(m.userData.interactable).toBe(h);
    expect(h).toMatchObject({ object: m, prompt: 'Aç', distance: 2.6, highlight: true, id: 'kapak' });
    expect(typeof h.onInteract).toBe('function');
  });

  it('bakılan en yakın nesneyi seçer ve ipucunu gösterir', () => {
    const near = box(t.scene, -1.5);
    const far = box(t.scene, -2.4);
    t.sys.add(far, { prompt: 'Uzak' });
    t.sys.add(near, { prompt: 'Yakın' });
    tick(t);
    expect(t.sys.current.object).toBe(near);
    expect(t.ui.showPrompt).toHaveBeenLastCalledWith('Yakın');
  });

  it('ipucu yalnızca değişince gönderilir (her kare değil)', () => {
    const m = box(t.scene, -1.5);
    t.sys.add(m, { prompt: 'Aç' });
    tick(t);
    tick(t);
    tick(t);
    expect(t.ui.showPrompt).toHaveBeenCalledTimes(1);
  });

  it('dinamik ipucu (fonksiyon) her kare değerlendirilir', () => {
    const m = box(t.scene, -1.5);
    let n = 0;
    t.sys.add(m, { prompt: () => `Sayaç ${n}` });
    tick(t);
    n = 5;
    tick(t);
    expect(t.ui.showPrompt).toHaveBeenLastCalledWith('Sayaç 5');
  });

  it('mesafe sınırı: varsayılan 2.6 m ötesi seçilmez; distance ile genişletilir', () => {
    const m = box(t.scene, -3.5); // ön yüz ≈ 3.25 m
    const h = t.sys.add(m, { prompt: 'X' });
    tick(t);
    expect(t.sys.current).toBeNull();
    h.distance = 4;
    tick(t);
    expect(t.sys.current).toBe(h);
  });

  it('raycaster.far (6 m) ötesi hiçbir zaman seçilmez', () => {
    const m = box(t.scene, -8);
    t.sys.add(m, { prompt: 'X', distance: 20 });
    tick(t);
    expect(t.sys.current).toBeNull();
  });

  it('bakış dışındaki nesne seçilmez', () => {
    const m = box(t.scene, -1.5, { x: 2 });
    t.sys.add(m, { prompt: 'X' });
    tick(t);
    expect(t.sys.current).toBeNull();
  });

  it('enabled() false → seçilmez, ipucu null', () => {
    const m = box(t.scene, -1.5);
    let on = false;
    t.sys.add(m, { prompt: 'X', enabled: () => on });
    tick(t);
    expect(t.sys.current).toBeNull();
    on = true;
    tick(t);
    expect(t.sys.current).not.toBeNull();
    on = false;
    tick(t);
    expect(t.sys.current).toBeNull();
    expect(t.ui.showPrompt).toHaveBeenLastCalledWith(null);
  });

  it('enabled: false (sabit) ve görünmez nesne seçilmez', () => {
    const a = box(t.scene, -1.5);
    t.sys.add(a, { prompt: 'X', enabled: false });
    tick(t);
    expect(t.sys.current).toBeNull();
    const t2 = setup();
    const b = box(t2.scene, -1.5);
    t2.sys.add(b, { prompt: 'Y' });
    b.visible = false;
    tick(t2);
    expect(t2.sys.current).toBeNull();
  });

  it('sistem enabled=false veya input.enabled=false iken seçim yok, E tetiklemez', () => {
    const m = box(t.scene, -1.5);
    const fn = vi.fn();
    t.sys.add(m, { prompt: 'X', onInteract: fn });
    t.sys.enabled = false;
    t.input.press('interact');
    tick(t);
    expect(t.sys.current).toBeNull();
    t.sys.enabled = true;
    t.input.enabled = false;
    t.input.press('interact');
    tick(t);
    expect(t.sys.current).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it('E basılınca onInteract({object, hit, handle}) çağrılır ve "interact" olayı yayılır', () => {
    const m = box(t.scene, -1.5);
    m.name = 'sigorta';
    const fn = vi.fn();
    const h = t.sys.add(m, { prompt: 'Sıfırla', onInteract: fn });
    const ev = recordEvents(t.bus, 'interact');
    tick(t);
    expect(fn).not.toHaveBeenCalled();
    t.input.press('interact');
    tick(t);
    expect(fn).toHaveBeenCalledTimes(1);
    const arg = fn.mock.calls[0][0];
    expect(arg.object).toBe(m);
    expect(arg.handle).toBe(h);
    expect(arg.hit.distance).toBeGreaterThan(1);
    expect(ev).toEqual([{ type: 'interact', payload: { id: 'sigorta', object: m } }]);
    // basılı tutmak tekrar tetiklemez (actionPressed tek kare)
    tick(t);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('onInteract hatası yakalanır, console.error yazılır, olay yine yayılır', () => {
    const m = box(t.scene, -1.5);
    t.sys.add(m, {
      onInteract: () => {
        throw new Error('bozuk');
      },
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ev = recordEvents(t.bus, 'interact');
    t.input.press('interact');
    expect(() => tick(t)).not.toThrow();
    expect(err).toHaveBeenCalled();
    expect(ev).toHaveLength(1);
    err.mockRestore();
  });

  it('çocuk mesh vurulunca ebeveyn gruptaki tutamaç bulunur', () => {
    const g = new THREE.Group();
    g.position.set(0, 1.6, -1.5);
    t.scene.add(g);
    const child = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshStandardMaterial());
    g.add(child);
    const h = t.sys.add(g, { prompt: 'Panel' });
    tick(t);
    expect(t.sys.current).toBe(h);
  });

  // InteractionSystem.update(): intersectObjects yalnızca kayıtlı nesnelere bakar; araya giren duvar/kapı
  // ışını kesmez → 2.6 m içindeki nesneyle duvarın/kapalı kapının arkasından etkileşilebilir.
  knownBug('araya giren (kayıtsız) duvar arkasındaki nesneyi seçtirmemeli', () => {
    const wall = box(t.scene, -1.0, { size: 0.6 }); // kayıtsız "duvar"
    wall.name = 'duvar';
    const m = box(t.scene, -2.0);
    t.sys.add(m, { prompt: 'Arkadaki' });
    tick(t);
    expect(t.sys.current).toBeNull();
  });

  it('devre dışı öndeki nesne arkadaki etkin nesneyi seçtirir', () => {
    const front = box(t.scene, -1.2);
    const back = box(t.scene, -2.0);
    t.sys.add(front, { prompt: 'Ön', enabled: () => false });
    const hb = t.sys.add(back, { prompt: 'Arka' });
    tick(t);
    expect(t.sys.current).toBe(hb);
  });

  describe('vurgulama (highlight)', () => {
    it('bakınca malzeme klonlanıp parlatılır; bakış ayrılınca özgün malzeme geri gelir', () => {
      const mat = new THREE.MeshStandardMaterial({ color: 0x777777 });
      const m = box(t.scene, -1.5, { material: mat });
      t.sys.add(m, { prompt: 'X' });
      tick(t);
      expect(m.material).not.toBe(mat);
      expect(m.material.emissive.getHex()).not.toBe(mat.emissive.getHex());
      expect(m.material.emissiveIntensity).toBeGreaterThanOrEqual(1);
      expect(mat.emissive.getHex()).toBe(0x000000); // paylaşılan malzeme değişmedi
      const clone = m.material;
      const dispose = vi.spyOn(clone, 'dispose');
      // bakışı çevir
      t.camera.rotation.y = Math.PI / 2;
      t.camera.updateMatrixWorld(true);
      tick(t);
      expect(m.material).toBe(mat);
      expect(dispose).toHaveBeenCalled();
      expect(m.userData._origMaterial).toBeUndefined();
    });

    it('highlight:false → malzemeye dokunulmaz', () => {
      const mat = new THREE.MeshStandardMaterial();
      const m = box(t.scene, -1.5, { material: mat });
      t.sys.add(m, { prompt: 'X', highlight: false });
      tick(t);
      expect(t.sys.current).not.toBeNull();
      expect(m.material).toBe(mat);
    });

    it('grup: tüm alt meshler vurgulanır ve geri alınır; emissive olmayan (Basic) atlanır', () => {
      const g = new THREE.Group();
      g.position.set(0, 1.6, -1.5);
      t.scene.add(g);
      const std = new THREE.MeshStandardMaterial();
      const basic = new THREE.MeshBasicMaterial();
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), std);
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), basic);
      b.position.x = 0.3;
      g.add(a, b);
      t.sys.add(g, { prompt: 'Panel' });
      tick(t);
      expect(a.material).not.toBe(std);
      expect(b.material).toBe(basic);
      t.camera.rotation.y = Math.PI;
      t.camera.updateMatrixWorld(true);
      tick(t);
      expect(a.material).toBe(std);
      expect(b.material).toBe(basic);
    });

    it('remove(): o an vurgulanan nesne geri alınır ve artık seçilmez', () => {
      const mat = new THREE.MeshStandardMaterial();
      const m = box(t.scene, -1.5, { material: mat });
      const h = t.sys.add(m, { prompt: 'X' });
      tick(t);
      expect(t.sys.current).toBe(h);
      t.sys.remove(h);
      expect(m.material).toBe(mat);
      expect(m.userData.interactable).toBeUndefined();
      tick(t);
      expect(t.sys.current).toBeNull();
      expect(t.sys.handles).toHaveLength(0);
      expect(t.sys.objects).toHaveLength(0);
    });

    it('remove(nesne) da çalışır; bilinmeyenler güvenli', () => {
      const m = box(t.scene, -1.5);
      t.sys.add(m, { prompt: 'X' });
      t.sys.remove(m);
      expect(t.sys.handles).toHaveLength(0);
      expect(() => t.sys.remove(null)).not.toThrow();
      expect(() => t.sys.remove(new THREE.Object3D())).not.toThrow();
    });

    it('enabled false olunca vurgulama kalkar', () => {
      const mat = new THREE.MeshStandardMaterial();
      const m = box(t.scene, -1.5, { material: mat });
      let on = true;
      t.sys.add(m, { prompt: 'X', enabled: () => on });
      tick(t);
      expect(m.material).not.toBe(mat);
      on = false;
      tick(t);
      expect(m.material).toBe(mat);
    });

    // InteractionSystem.js setHighlight(false): vurgu sırasında modül kodu malzemeyi değiştirirse
    // (ör. LED: mesh.material = M.ledGreen), geri alırken YENİ (paylaşılan kütüphane) malzeme dispose
    // edilir ve değişiklik eski malzemeyle ezilir.
    knownBug('vurgu sırasında değiştirilen malzeme geri almada korunmalı ve paylaşılan malzeme dispose edilmemeli', () => {
      const orig = new THREE.MeshStandardMaterial({ name: 'ledRed' });
      const shared = new THREE.MeshStandardMaterial({ name: 'ledGreen' });
      const disposeShared = vi.spyOn(shared, 'dispose');
      const m = box(t.scene, -1.5, { material: orig });
      t.sys.add(m, { prompt: 'Anahtar', onInteract: () => (m.material = shared) });
      tick(t); // vurgulandı
      t.input.press('interact');
      tick(t); // modül malzemeyi değiştirdi
      t.camera.rotation.y = Math.PI;
      t.camera.updateMatrixWorld(true);
      tick(t); // bakış ayrıldı → geri alma
      expect(disposeShared).not.toHaveBeenCalled();
      expect(m.material).toBe(shared);
    });
  });
});
