import * as THREE from 'three';
import { DOOR_WIDTH, DOOR_HEIGHT } from '../ShipLayout.js';
import { addBox } from '../utils.js';

/**
 * Sürgülü kapı (TASLAK — Ajan 1 "Yapı" geliştirecek; API sabit kalmalı).
 *
 *   const door = createDoor(mctx, {
 *     pos: [x, 0, z],        // mctx.group yerel uzayında kapı boşluğunun alt-orta noktası
 *     rotY: 0,               // 0 → kapı düzlemi yerel YZ (genişlik Z boyunca, normal X)
 *     width: 1.6, height: 2.2,
 *     lockedUntil: 'power_restored',  // opsiyonel: bu bayrak doğru olana dek kilitli
 *     lockedText: 'KİLİTLİ — ENERJİ YOK',
 *     auto: true,            // oyuncu yaklaşınca açılır
 *   });
 *   door.open(); door.close(); door.isOpen; door.locked; door.setLocked(false);
 *
 * Kapı kapalıyken çarpışma segmenti etkindir.
 * Otomatik kapılar ctx.doorOpeners içindeki herhangi bir konum (oyuncu, TARS) yakındaysa açılır.
 * Her kapı ctx.doors dizisine eklenir.
 * Olaylar: bus 'door:open' / 'door:close' / 'door:locked' { door, position }
 */
export function createDoor(mctx, opts = {}) {
  const M = mctx.materials;
  const width = opts.width ?? DOOR_WIDTH;
  const height = opts.height ?? DOOR_HEIGHT;
  const root = new THREE.Group();
  root.name = 'door';
  root.userData.dynamic = true;
  const [px, py, pz] = opts.pos ?? [0, 0, 0];
  root.position.set(px, py, pz);
  root.rotation.y = opts.rotY ?? 0;
  mctx.group.add(root);

  const half = width / 2;
  const leafL = addBox(root, { size: [0.06, height, half], pos: [0, height / 2, -half / 2], material: M.panelMid });
  const leafR = addBox(root, { size: [0.06, height, half], pos: [0, height / 2, half / 2], material: M.panelMid });
  const lamp = addBox(root, { size: [0.08, 0.06, 0.3], pos: [0.06, height + 0.12, 0], material: M.ledRed });

  root.updateWorldMatrix(true, false);
  const a = new THREE.Vector3(0, 0, -half).applyMatrix4(root.matrixWorld);
  const b = new THREE.Vector3(0, 0, half).applyMatrix4(root.matrixWorld);
  const collider = mctx.collision.addSegment(a.x, a.z, b.x, b.z, { tag: 'door' });
  const center = new THREE.Vector3(0, 1, 0).applyMatrix4(root.matrixWorld);

  const door = {
    group: root,
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
      mctx.bus.emit('door:open', { door: this, position: center });
    },
    close() {
      if (this.target === 0) return;
      this.target = 0;
      mctx.bus.emit('door:close', { door: this, position: center });
    },
    setLocked(v) {
      this.locked = v;
      lamp.material = v ? M.ledRed : M.ledGreen;
      if (v) this.close();
    },
  };
  door.setLocked(false);

  if (opts.lockedUntil) {
    door.setLocked(!mctx.state.is(opts.lockedUntil));
    mctx.state.when(opts.lockedUntil, () => door.setLocked(false));
  }

  mctx.doors?.push(door);

  let lockedNotified = 0;
  mctx.onUpdate((dt, t) => {
    const p = mctx.player.position;
    const dist = Math.hypot(p.x - center.x, p.z - center.z);
    let near = Infinity;
    for (const o of mctx.doorOpeners || [p]) near = Math.min(near, Math.hypot(o.x - center.x, o.z - center.z));
    if (door.auto) {
      if (dist < 2.2 && door.locked) {
        if (t - lockedNotified > 4) {
          lockedNotified = t;
          mctx.bus.emit('door:locked', { door, position: center });
          mctx.ui?.toast?.(door.lockedText);
        }
      } else if (near < 2.2) door.open();
      else if (near > 3) door.close();
    }
    door.openness = THREE.MathUtils.damp(door.openness, door.target, 6, dt);
    const s = door.openness * (half - 0.05);
    leafL.position.z = -half / 2 - s;
    leafR.position.z = half / 2 + s;
    mctx.collision.setEnabled(collider, door.openness < 0.75);
  });

  return door;
}
