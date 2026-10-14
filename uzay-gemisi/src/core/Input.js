/**
 * Klavye / fare / dokunmatik girişi.
 *
 * Eylem adları: 'interact' (E), 'jump' (Space), 'crouch' (C / Ctrl), 'sprint' (Shift),
 *               'flashlight' (F), 'map' (M / Tab), 'noclip' (N, yalnızca ?debug)
 *
 * Dokunmatik kontroller (ui/TouchControls.js) şu kancaları kullanır:
 *   input.setVirtualMove(x, y)   // -1..1; y>0 ileri
 *   input.addLookDelta(dx, dy)   // piksel benzeri delta
 *   input.pressVirtual(action)   // tek seferlik basış
 *   input.holdVirtual(action, bool)
 */
const ACTION_KEYS = {
  interact: ['KeyE'],
  jump: ['Space'],
  crouch: ['KeyC', 'ControlLeft', 'ControlRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  flashlight: ['KeyF'],
  map: ['KeyM', 'Tab'],
  noclip: ['KeyN'],
};

export class Input {
  /** @param {HTMLElement} dom  @param {import('./EventBus.js').EventBus} bus */
  constructor(dom, bus) {
    this.dom = dom;
    this.bus = bus;
    /** false iken oyuncu hareketi/bakışı yok sayılır (terminal, menü açıkken) */
    this.enabled = true;
    this.down = new Set();
    this.pressed = new Set();
    this.lookDX = 0;
    this.lookDY = 0;
    this.virtualMove = { x: 0, y: 0 };
    this.virtualHeld = new Set();
    this.virtualPressed = new Set();
    this.isLocked = false;
    /** Pointer lock yoksa (iframe vb.) sürükleyerek bakış */
    this.dragLook = false;
    this._dragging = false;
    this._lastX = 0;
    this._lastY = 0;

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
      this.bus.emit('input:keydown', e);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
    });
    window.addEventListener('blur', () => this.down.clear());

    document.addEventListener('mousemove', (e) => {
      if (this.isLocked) {
        this.lookDX += e.movementX || 0;
        this.lookDY += e.movementY || 0;
      } else if (this.dragLook && this._dragging) {
        this.lookDX += (e.clientX - this._lastX) * 1.5;
        this.lookDY += (e.clientY - this._lastY) * 1.5;
        this._lastX = e.clientX;
        this._lastY = e.clientY;
      }
    });
    dom.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this._dragging = true;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
    });
    window.addEventListener('mouseup', () => (this._dragging = false));

    document.addEventListener('pointerlockchange', () => {
      this.isLocked = document.pointerLockElement === this.dom;
      this.bus.emit('pointerlock:change', this.isLocked);
    });
    document.addEventListener('pointerlockerror', () => {
      // iframe/sandbox gibi ortamlarda kilit alınamazsa sürükleyerek bakışa geç
      this.dragLook = true;
      this.bus.emit('pointerlock:error');
    });
  }

  /** Kullanıcı hareketi (tıklama) içinde çağrılmalı. */
  requestLock() {
    if (!this.dom.requestPointerLock) {
      this.dragLook = true;
      return;
    }
    try {
      const p = this.dom.requestPointerLock();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          this.dragLook = true;
          this.bus.emit('pointerlock:error');
        });
      }
    } catch {
      this.dragLook = true;
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(code) {
    return this.down.has(code);
  }

  wasPressed(code) {
    return this.pressed.has(code);
  }

  actionDown(name) {
    if (this.virtualHeld.has(name)) return true;
    return (ACTION_KEYS[name] || []).some((c) => this.down.has(c));
  }

  actionPressed(name) {
    if (this.virtualPressed.has(name)) return true;
    return (ACTION_KEYS[name] || []).some((c) => this.pressed.has(c));
  }

  /** {x: sağ(+)/sol(-), y: ileri(+)/geri(-)} — uzunluk ≤ 1 */
  getMoveAxis() {
    let x = 0;
    let y = 0;
    if (this.down.has('KeyW') || this.down.has('ArrowUp')) y += 1;
    if (this.down.has('KeyS') || this.down.has('ArrowDown')) y -= 1;
    if (this.down.has('KeyD') || this.down.has('ArrowRight')) x += 1;
    if (this.down.has('KeyA') || this.down.has('ArrowLeft')) x -= 1;
    x += this.virtualMove.x;
    y += this.virtualMove.y;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  consumeLook() {
    const d = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = 0;
    this.lookDY = 0;
    return d;
  }

  addLookDelta(dx, dy) {
    this.lookDX += dx;
    this.lookDY += dy;
  }

  setVirtualMove(x, y) {
    this.virtualMove.x = x;
    this.virtualMove.y = y;
  }

  pressVirtual(action) {
    this.virtualPressed.add(action);
  }

  holdVirtual(action, held) {
    if (held) this.virtualHeld.add(action);
    else this.virtualHeld.delete(action);
  }

  /** Her karenin sonunda çağrılır. */
  endFrame() {
    this.pressed.clear();
    this.virtualPressed.clear();
  }
}
