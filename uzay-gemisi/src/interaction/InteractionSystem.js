import * as THREE from 'three';

/**
 * Bakılan nesneyle etkileşim (FPS tarzı: ekranın ortasından ışın).
 *
 *   const h = ctx.interactions.add(mesh, {
 *     prompt: 'Kapsülü aç',            // veya () => string (duruma göre değişen metin)
 *     onInteract: (e) => { ... },      // e = { object, hit, handle }
 *     enabled: () => true,             // opsiyonel
 *     distance: 2.6,                   // opsiyonel, metre
 *     highlight: true,                 // opsiyonel, bakınca hafif parlama
 *   });
 *   ctx.interactions.remove(h);
 *
 * Kayıtlı nesneler otomatik olarak `userData.dynamic = true` işaretlenir; böylece
 * Ship statik birleştirme (merge) sırasında onlara dokunmaz.
 */
export class InteractionSystem {
  constructor({ camera, input, bus, getUI, collision = null }) {
    this.camera = camera;
    /** Verilirse (CollisionWorld) duvar/kapalı kapı arkasındaki nesneler seçilmez */
    this.collision = collision;
    this.input = input;
    this.bus = bus;
    this.getUI = getUI;
    this.handles = [];
    this.objects = [];
    this.current = null;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 6;
    this._center = new THREE.Vector2(0, 0);
    this._lastPrompt = undefined;
    this.enabled = true;
  }

  add(object, opts) {
    const handle = {
      object,
      prompt: opts.prompt ?? 'Etkileşim',
      onInteract: opts.onInteract ?? (() => {}),
      enabled: opts.enabled ?? null,
      distance: opts.distance ?? 2.6,
      highlight: opts.highlight ?? true,
      id: opts.id ?? object.name ?? null,
    };
    object.userData.dynamic = true;
    object.userData.interactable = handle;
    this.handles.push(handle);
    this.objects.push(object);
    return handle;
  }

  remove(handleOrObject) {
    const handle = handleOrObject?.object ? handleOrObject : handleOrObject?.userData?.interactable;
    if (!handle) return;
    if (this.current === handle) this._setCurrent(null);
    this.handles = this.handles.filter((h) => h !== handle);
    this.objects = this.objects.filter((o) => o !== handle.object);
    delete handle.object.userData.interactable;
  }

  _findHandle(obj) {
    let o = obj;
    while (o) {
      if (o.userData.interactable) return o.userData.interactable;
      o = o.parent;
    }
    return null;
  }

  _isEnabled(h) {
    if (!h.object.visible) return false;
    return typeof h.enabled === 'function' ? !!h.enabled() : h.enabled !== false;
  }

  update() {
    let found = null;
    if (this.enabled && this.input.enabled && this.objects.length) {
      this.raycaster.setFromCamera(this._center, this.camera);
      const hits = this.raycaster.intersectObjects(this.objects, true);
      for (const hit of hits) {
        const h = this._findHandle(hit.object);
        if (!h) continue;
        if (hit.distance > h.distance) break;
        if (!this._isEnabled(h)) continue;
        if (this.collision?.lineBlocked(this.raycaster.ray.origin, hit.point, 0.15, ownColliders(h))) break;
        found = { handle: h, hit };
        break;
      }
    }
    this._setCurrent(found?.handle ?? null);

    const ui = this.getUI();
    const prompt = this.current ? (typeof this.current.prompt === 'function' ? this.current.prompt() : this.current.prompt) : null;
    if (prompt !== this._lastPrompt) {
      this._lastPrompt = prompt;
      ui?.showPrompt?.(prompt);
    }

    if (this.current && this.input.actionPressed('interact')) {
      const h = this.current;
      try {
        h.onInteract({ object: h.object, hit: found?.hit, handle: h });
      } catch (err) {
        console.error('[etkileşim] hata:', err);
      }
      this.bus.emit('interact', { id: h.id, object: h.object });
    }
  }

  _setCurrent(h) {
    if (this.current === h) return;
    if (this.current?.highlight) setHighlight(this.current.object, false);
    this.current = h;
    if (h?.highlight) setHighlight(h.object, true);
  }
}

/** Etkileşimli nesnenin kendisine, alt ağacına ve üst gruplarına ait çarpışma segmentleri (önbellekli). */
function ownColliders(h) {
  if (h._ownColliders) return h._ownColliders;
  const set = new Set();
  const addFrom = (o) => {
    const c = o.userData.collider;
    if (!c) return;
    if (c.type === 'group') c.segments.forEach((sg) => set.add(sg));
    else set.add(c);
  };
  h.object.traverse(addFrom);
  for (let o = h.object.parent; o && !o.isScene; o = o.parent) addFrom(o);
  h._ownColliders = set;
  return set;
}

/** Nesnenin malzemelerini geçici olarak klonlayıp emissive ile parlatır. */
function setHighlight(object, on) {
  object.traverse((o) => {
    if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
    if (on) {
      if (!('emissive' in o.material)) return;
      o.userData._origMaterial = o.material;
      const m = o.material.clone();
      m.emissive = m.emissive.clone().add(new THREE.Color(0x1d2a33));
      m.emissiveIntensity = Math.max(1, m.emissiveIntensity);
      o.userData._hlMaterial = m;
      o.material = m;
    } else if (o.userData._hlMaterial) {
      const clone = o.userData._hlMaterial;
      // Vurgu sırasında malzemeyi başka kod değiştirdiyse yenisini koru
      if (o.material === clone) o.material = o.userData._origMaterial;
      clone.dispose();
      delete o.userData._origMaterial;
      delete o.userData._hlMaterial;
    }
  });
}
