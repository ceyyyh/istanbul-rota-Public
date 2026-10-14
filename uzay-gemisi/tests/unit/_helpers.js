/**
 * Birim test yardımcıları (Ajan 7 — Test & QA). vitest bu dosyayı test olarak çalıştırmaz.
 */
import { it } from 'vitest';

/**
 * Başka bir ajanın kodundaki BİLİNEN HATA için test.
 * Varsayılan: `it.fails` (beklenen başarısızlık) → `npm test` yeşil kalır, hata belgelenir.
 * Hata düzeltildiğinde bu test "beklenmedik şekilde geçti" diye kırılır → `knownBug` → `it` yapın.
 * QA_STRICT=1 npm test → bilinen hatalar normal (kırmızı) test olarak çalışır.
 */
export function knownBug(name, fn) {
  const runner = process.env.QA_STRICT ? it : it.fails;
  return runner(`[BİLİNEN HATA] ${name}`, fn);
}

/** PlayerController / InteractionSystem için sahte Input (core/Input.js API'sinin alt kümesi). */
export class FakeInput {
  constructor() {
    this.enabled = true;
    this.axis = { x: 0, y: 0 };
    this.held = new Set();
    this.pressedActions = new Set();
    this.look = { dx: 0, dy: 0 };
  }
  getMoveAxis() {
    return { x: this.axis.x, y: this.axis.y };
  }
  actionDown(name) {
    return this.held.has(name);
  }
  actionPressed(name) {
    return this.pressedActions.has(name);
  }
  press(name) {
    this.pressedActions.add(name);
  }
  consumeLook() {
    const d = this.look;
    this.look = { dx: 0, dy: 0 };
    return d;
  }
  addLookDelta(dx, dy) {
    this.look.dx += dx;
    this.look.dy += dy;
  }
  endFrame() {
    this.pressedActions.clear();
  }
}

/** Olay kaydedici: bus.on ile dinler, çağrıları dizide toplar. */
export function recordEvents(bus, ...types) {
  const out = [];
  for (const t of types) bus.on(t, (p) => out.push({ type: t, payload: p }));
  return out;
}
