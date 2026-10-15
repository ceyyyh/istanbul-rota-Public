import * as THREE from 'three';
import { DOOR_WIDTH, DOOR_HEIGHT, WALL_THICKNESS } from '../ShipLayout.js';
import { addBox } from '../utils.js';
import { addWorldBox, textPlateMaterial } from './kit.js';

/**
 * Sürgülü basınç kapısı (Ajan 1 — Yapı).
 *
 *   const door = createDoor(mctx, {
 *     pos: [x, 0, z],        // mctx.group yerel uzayında kapı boşluğunun alt-orta noktası
 *     rotY: 0,               // 0 → kapı düzlemi yerel YZ (genişlik Z boyunca, normal X)
 *     width: 1.6, height: 2.2,
 *     lockedUntil: 'power_restored',  // opsiyonel: bu bayrak doğru olana dek kilitli
 *     lockedText: 'KİLİTLİ — ENERJİ YOK',
 *     auto: true,            // oyuncu yaklaşınca açılır
 *     depth: 0.35,           // duvar kalınlığı (çerçeve astarı bu kadar derin)
 *   });
 *   door.open(); door.close(); door.isOpen; door.locked; door.setLocked(false);
 *
 * Yapı: duvar boşluğunun içine astar (jamb/header), her iki yüzde sac çerçeve (üst kenarda
 * sarı-siyah uyarı şeridi), zeminde eşik, iki kanat (duvarın içine kayar), durum lambası
 * (kırmızı = kilitli, yeşil = açılabilir) ve kilitliyken görünen küçük "KİLİTLİ" ekranı.
 * Çerçeve STATİK (modülle birleştirilir); yalnızca kanatlar/lamba/ekran dinamiktir.
 *
 * Kapı kapalıyken çarpışma segmenti etkindir.
 * Otomatik kapılar ctx.doorOpeners içindeki herhangi bir konum (oyuncu, TARS) yakındaysa açılır.
 * Her kapı ctx.doors dizisine eklenir.
 * Olaylar: bus 'door:open' / 'door:close' / 'door:locked' { door, position }
 * Sesler: audio.play('door' | 'door_locked', { position })
 */
export function createDoor(mctx, opts = {}) {
  const M = mctx.materials;
  const width = opts.width ?? DOOR_WIDTH;
  const height = opts.height ?? DOOR_HEIGHT;
  const depth = opts.depth ?? WALL_THICKNESS;
  const [px, py, pz] = opts.pos ?? [0, 0, 0];
  const rotY = opts.rotY ?? 0;
  const half = width / 2;

  // --- STATİK çerçeve (birleştirilir) ---
  const frame = new THREE.Group();
  frame.name = 'door-frame';
  frame.position.set(px, py, pz);
  frame.rotation.y = rotY;
  mctx.group.add(frame);

  const liner = 0.02; // boşluk içine giren astar kalınlığı
  // astarlar: iki yan ve üst (duvar kalınlığı boyunca)
  for (const s of [-1, 1]) addBox(frame, { size: [depth, height, liner], pos: [0, height / 2, s * (half - liner / 2)], material: M.metalDark });
  addBox(frame, { size: [depth, liner, width], pos: [0, height - liner / 2, 0], material: M.metalDark });
  // her iki yüzde çerçeve (söve): yan sövelerde sac, üstte uyarı şeridi
  const trim = 0.04;
  const band = 0.09;
  for (const sx of [-1, 1]) {
    const x = sx * (depth / 2 + trim / 2);
    for (const s of [-1, 1]) {
      addBox(frame, { size: [trim, height + band, band], pos: [x, (height + band) / 2, s * (half + band / 2)], material: M.metalDark });
    }
    addWorldBox(frame, { size: [trim, band, width + 2 * band], pos: [x, height + band / 2, 0], material: M.hazardStripe, mpr: 0.45 });
  }
  // eşik: duvar kalınlığını örten çelik plaka + uyarı kenar şeritleri
  addBox(frame, { size: [depth + 0.1, 0.03, width - 2 * liner], pos: [0, 0.015, 0], material: M.floorPanel });
  for (const sx of [-1, 1]) {
    addWorldBox(frame, { size: [0.07, 0.034, width - 2 * liner], pos: [sx * (depth / 2 + 0.05), 0.017, 0], material: M.hazardStripe, mpr: 0.4 });
  }

  // --- DİNAMİK kapı grubu ---
  const root = new THREE.Group();
  root.name = 'door';
  root.userData.dynamic = true;
  root.position.set(px, py, pz);
  root.rotation.y = rotY;
  mctx.group.add(root);

  const leafH = height - liner;
  const leafGeo = new THREE.BoxGeometry(0.07, leafH, half + liner);
  const leafL = new THREE.Mesh(leafGeo, M.doorLeaf);
  const leafR = new THREE.Mesh(leafGeo, M.doorLeaf);
  leafL.position.set(0, leafH / 2, -half / 2);
  leafR.position.set(0, leafH / 2, half / 2);
  for (const l of [leafL, leafR]) {
    l.castShadow = true;
    l.receiveShadow = true;
    l.userData.dynamic = true;
    root.add(l);
  }
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(depth + 0.1, 0.05, 0.28), M.ledRed);
  lamp.position.set(0, height + band / 2, 0);
  lamp.userData.dynamic = true;
  root.add(lamp);

  // "KİLİTLİ" ekranı: söve yanında, iki yüzde; yalnızca kilitliyken görünür (ilk kilitte oluşturulur)
  let screens = null;
  const ensureScreens = () => {
    if (screens) return screens;
    screens = [];
    const mat = textPlateMaterial('door-locked', 'KİLİTLİ', { w: 256, h: 96, fg: '#ff3a2a' });
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.112), mat);
      m.position.set(sx * (depth / 2 + trim + 0.004), 1.5, half + band + 0.2);
      m.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
      m.userData.dynamic = true;
      root.add(m);
      screens.push(m);
    }
    return screens;
  };

  root.updateWorldMatrix(true, false);
  const a = new THREE.Vector3(0, 0, -half).applyMatrix4(root.matrixWorld);
  const b = new THREE.Vector3(0, 0, half).applyMatrix4(root.matrixWorld);
  const collider = mctx.collision.addSegment(a.x, a.z, b.x, b.z, { tag: 'door' });
  const center = new THREE.Vector3(0, 1, 0).applyMatrix4(root.matrixWorld);

  const door = {
    group: root,
    frame,
    position: center,
    openness: 0,
    target: 0,
    locked: false,
    lockedText: opts.lockedText ?? 'KİLİTLİ',
    auto: opts.auto ?? true,
    get isOpen() {
      return this.target > 0.5;
    },
    open() {
      if (this.locked || this.target === 1) return;
      this.target = 1;
      mctx.audio?.play?.('door', { position: center });
      mctx.bus.emit('door:open', { door: this, position: center });
    },
    close() {
      if (this.target === 0) return;
      this.target = 0;
      mctx.audio?.play?.('door', { position: center, volume: 0.6 });
      mctx.bus.emit('door:close', { door: this, position: center });
    },
    setLocked(v) {
      this.locked = v;
      lamp.material = v ? M.ledRed : M.ledGreen;
      if (v) ensureScreens().forEach((s) => (s.visible = true));
      else if (screens) screens.forEach((s) => (s.visible = false));
      if (v) this.close();
    },
  };
  door.setLocked(false);

  if (opts.lockedUntil) {
    door.setLocked(!mctx.state.is(opts.lockedUntil));
    mctx.state.when(opts.lockedUntil, () => door.setLocked(false));
  }

  mctx.doors?.push(door);

  let lockedNotified = -99;
  mctx.onUpdate((dt, t) => {
    const p = mctx.player.position;
    const dist = Math.hypot(p.x - center.x, p.z - center.z);
    let near = Infinity;
    for (const o of mctx.doorOpeners || [p]) near = Math.min(near, Math.hypot(o.x - center.x, o.z - center.z));
    if (door.auto) {
      if (dist < 2.2 && door.locked) {
        if (t - lockedNotified > 4) {
          lockedNotified = t;
          mctx.audio?.play?.('door_locked', { position: center });
          mctx.bus.emit('door:locked', { door, position: center });
          mctx.ui?.toast?.(door.lockedText);
        }
      } else if (near < 2.2) door.open();
      else if (near > 3) door.close();
    }
    // Uzaktaki kapıların animasyon işini atla (yalnızca hareket sırasında güncelle)
    if (Math.abs(door.openness - door.target) > 0.002) {
      door.openness = THREE.MathUtils.damp(door.openness, door.target, 6, dt);
      if (Math.abs(door.openness - door.target) <= 0.002) door.openness = door.target;
      const s = door.openness * (half - 0.04);
      leafL.position.z = -half / 2 - s;
      leafR.position.z = half / 2 + s;
    }
    mctx.collision.setEnabled(collider, door.openness < 0.75);
  });

  return door;
}
