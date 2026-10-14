/**
 * Dokunmatik kontroller (TASLAK — Ajan 6 yazacak).
 * Sol yarı: sanal joystick → input.setVirtualMove(x, y)
 * Sağ yarı: sürükleyerek bakış → input.addLookDelta(dx, dy)
 * Düğmeler: Etkileşim (E), Zıpla, Eğil, Koş → input.pressVirtual / holdVirtual
 */
export class TouchControls {
  constructor(ctx) {
    this.ctx = ctx;
  }
  static isTouchDevice() {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  }
  update() {}
}
