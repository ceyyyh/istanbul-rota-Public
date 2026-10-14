/**
 * Dokunmatik kontroller (Ajan 6) — yalnızca dokunmatik cihazlarda kurulur (main.js).
 *
 *   Sol yarı : yüzen sanal joystick   → input.setVirtualMove(x, y)   (y > 0 ileri)
 *   Sağ yarı : sürükleyerek bakış     → input.addLookDelta(dx, dy)
 *   Düğmeler : Etkileşim  → input.pressVirtual('interact')
 *              Zıpla      → input.pressVirtual('jump')
 *              Eğil       → input.holdVirtual('crouch', bool)   (aç/kapa)
 *              Koş        → input.holdVirtual('sprint', bool)   (aç/kapa)
 *              Fener      → input.pressVirtual('flashlight')
 *              Harita     → input.pressVirtual('map')
 *              Menü (≡)   → ui.showPause()
 *
 * #ui-root pointer-events:none olduğundan bölgeler ve düğmeler kendi pointer-events:auto değerini taşır.
 * Arayüzde bir modal / duraklatma / başlangıç ekranı açıkken katman gizlenir ve tüm girişler bırakılır.
 */
const SVG = (d, extra = '') => `<svg viewBox="0 0 24 24" ${extra}>${d}</svg>`;
const ICONS = {
  use: SVG('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/>'),
  jump: SVG('<path d="M6 14l6-6 6 6"/><path d="M6 19h12"/>'),
  crouch: SVG('<path d="M6 10l6 6 6-6"/><path d="M6 5h12"/>'),
  sprint: SVG('<path d="M5 6l6 6-6 6"/><path d="M12 6l6 6-6 6"/>'),
  light: SVG('<path d="M8 3h8l-2 6v11h-4V9z"/><path d="M10 13h4"/>'),
  map: SVG('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.2"/><path d="M12 3.5v4.3M12 16.2v4.3M3.5 12h4.3M16.2 12h4.3"/>'),
  menu: SVG('<path d="M5 7h14M5 12h14M5 17h14"/>'),
};

/** Dokunmatikte bakış çarpanı (fare pikseline göre) */
const LOOK_GAIN = 1.7;
const JOY_RADIUS = 52;
const DEAD_ZONE = 0.12;

export class TouchControls {
  constructor(ctx) {
    this.ctx = ctx;
    this.input = ctx.input;
    this.sprint = false;
    this.crouch = false;
    this._joy = null; // { id, ox, oy }
    this._look = null; // { id, x, y }
    this._hidden = false;
    this._build();
  }

  /** Dokunmatik cihaz mı? (`?touch=1` ile masaüstünde de zorlanabilir) */
  static isTouchDevice() {
    try {
      if (typeof location !== 'undefined' && /[?&]touch=1\b/.test(location.search)) return true;
    } catch {
      /* yok say */
    }
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  }

  _build() {
    const host = this.ctx.ui?.el || document.getElementById('ui-root');
    const el = document.createElement('div');
    el.className = 'ui-layer ui-touch';
    const pos = (r, b, extra = '') =>
      `style="right:calc(${r}px + var(--safe-r));bottom:calc(${b}px + var(--safe-b));${extra}"`;
    const posTL = (l, t) => `style="left:calc(${l}px + var(--safe-l));top:calc(${t}px + var(--safe-t))"`;
    el.innerHTML = `
      <div class="tz tz-left"></div>
      <div class="tz tz-right"></div>
      <div class="joy" style="left:calc(96px + var(--safe-l));top:calc(100% - 128px - var(--safe-b))"><i></i></div>
      <button class="tb tb-use" data-b="use" ${pos(40, 76)}>${ICONS.use}<span>ETKİLEŞİM</span></button>
      <button class="tb" data-b="jump" ${pos(142, 40)}>${ICONS.jump}<span>ZIPLA</span></button>
      <button class="tb" data-b="crouch" ${pos(136, 128)}>${ICONS.crouch}<span>EĞİL</span></button>
      <button class="tb" data-b="sprint" ${pos(49, 176)}>${ICONS.sprint}<span>KOŞ</span></button>
      <button class="tb tb-sm" data-b="menu" ${posTL(14, 14)} aria-label="Menü">${ICONS.menu}</button>
      <button class="tb tb-sm" data-b="map" ${posTL(66, 14)} aria-label="Harita">${ICONS.map}</button>
      <button class="tb tb-sm" data-b="light" ${posTL(118, 14)} aria-label="El feneri">${ICONS.light}</button>`;
    host.appendChild(el);
    this.el = el;
    this.joyEl = el.querySelector('.joy');
    this.knobEl = this.joyEl.querySelector('i');
    this._joyHome = { left: this.joyEl.style.left, top: this.joyEl.style.top };
    this.btn = {};
    el.querySelectorAll('[data-b]').forEach((b) => (this.btn[b.dataset.b] = b));

    el.addEventListener('contextmenu', (e) => e.preventDefault());

    // --- Sol: joystick
    const left = el.querySelector('.tz-left');
    left.addEventListener('pointerdown', (e) => {
      if (this._joy) return;
      e.preventDefault();
      try {
        left.setPointerCapture(e.pointerId);
      } catch {
        /* yok say */
      }
      const w = window.innerWidth;
      const h = window.innerHeight;
      const ox = Math.min(w / 2 - JOY_RADIUS, Math.max(JOY_RADIUS + 8, e.clientX));
      const oy = Math.min(h - JOY_RADIUS - 8, Math.max(JOY_RADIUS + 8, e.clientY));
      this._joy = { id: e.pointerId, ox, oy };
      this.joyEl.style.left = `${ox}px`;
      this.joyEl.style.top = `${oy}px`;
      this.joyEl.classList.add('active');
      this._joyMove(e.clientX, e.clientY);
    });
    left.addEventListener('pointermove', (e) => {
      if (this._joy?.id === e.pointerId) this._joyMove(e.clientX, e.clientY);
    });
    const joyEnd = (e) => {
      if (this._joy?.id === e.pointerId) this._releaseJoy();
    };
    left.addEventListener('pointerup', joyEnd);
    left.addEventListener('pointercancel', joyEnd);

    // --- Sağ: bakış
    const right = el.querySelector('.tz-right');
    right.addEventListener('pointerdown', (e) => {
      if (this._look) return;
      e.preventDefault();
      try {
        right.setPointerCapture(e.pointerId);
      } catch {
        /* yok say */
      }
      this._look = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    right.addEventListener('pointermove', (e) => {
      const l = this._look;
      if (!l || l.id !== e.pointerId) return;
      const dx = e.clientX - l.x;
      const dy = e.clientY - l.y;
      l.x = e.clientX;
      l.y = e.clientY;
      this.input.addLookDelta(dx * LOOK_GAIN, dy * LOOK_GAIN);
    });
    const lookEnd = (e) => {
      if (this._look?.id === e.pointerId) this._look = null;
    };
    right.addEventListener('pointerup', lookEnd);
    right.addEventListener('pointercancel', lookEnd);

    // --- Düğmeler
    for (const [name, b] of Object.entries(this.btn)) {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        b.classList.add('down');
        this._press(name);
      });
      const up = () => b.classList.remove('down');
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
    }
  }

  _press(name) {
    const input = this.input;
    const audio = this.ctx.audio;
    switch (name) {
      case 'use':
        input.pressVirtual('interact');
        break;
      case 'jump':
        input.pressVirtual('jump');
        break;
      case 'crouch':
        this.crouch = !this.crouch;
        input.holdVirtual('crouch', this.crouch);
        this.btn.crouch.classList.toggle('on', this.crouch);
        if (this.crouch && this.sprint) this._setSprint(false);
        audio?.play?.('click', { volume: 0.3 });
        break;
      case 'sprint':
        this._setSprint(!this.sprint);
        if (this.sprint && this.crouch) {
          this.crouch = false;
          input.holdVirtual('crouch', false);
          this.btn.crouch.classList.remove('on');
        }
        audio?.play?.('click', { volume: 0.3 });
        break;
      case 'light':
        input.pressVirtual('flashlight');
        break;
      case 'map':
        input.pressVirtual('map');
        break;
      case 'menu':
        this.ctx.ui?.showPause?.();
        break;
    }
  }

  _setSprint(on) {
    this.sprint = on;
    this.input.holdVirtual('sprint', on);
    this.btn.sprint.classList.toggle('on', on);
  }

  _joyMove(cx, cy) {
    const j = this._joy;
    let dx = (cx - j.ox) / JOY_RADIUS;
    let dy = (cy - j.oy) / JOY_RADIUS;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    this.knobEl.style.transform = `translate(${dx * JOY_RADIUS}px, ${dy * JOY_RADIUS}px)`;
    const m = Math.min(1, len);
    if (m < DEAD_ZONE) this.input.setVirtualMove(0, 0);
    else {
      // ölü bölge sonrası yumuşak eğri
      const k = (m - DEAD_ZONE) / (1 - DEAD_ZONE) / m;
      this.input.setVirtualMove(dx * k, -dy * k);
    }
  }

  _releaseJoy() {
    this._joy = null;
    this.input.setVirtualMove(0, 0);
    this.knobEl.style.transform = '';
    this.joyEl.classList.remove('active');
    this.joyEl.style.left = this._joyHome.left;
    this.joyEl.style.top = this._joyHome.top;
  }

  /** Tüm basılı girişleri bırak (modal açılınca vb.) */
  releaseAll() {
    if (this._joy) this._releaseJoy();
    this._look = null;
    this.input.setVirtualMove(0, 0);
  }

  update() {
    const ui = this.ctx.ui;
    const hidden = !!ui?.isBlocked?.();
    if (hidden !== this._hidden) {
      this._hidden = hidden;
      this.el.classList.toggle('off', hidden);
      if (hidden) this.releaseAll();
    }
    this.btn.use.classList.toggle('ready', !!ui?._promptActive);
  }
}
