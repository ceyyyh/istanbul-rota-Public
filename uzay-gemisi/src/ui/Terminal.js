/**
 * Modal pencereler: retro CRT terminal ve karakter diyaloğu (TARS).
 * UI sınıfı oluşturur ve klavye olaylarını buraya iletir (bkz. UI.openTerminal / openDialog).
 *
 * Seçenek: { label, action?: () => any, disabled? }  — action() `false` döndürmezse modal kapanır.
 * Klavye: 1–9 doğrudan seç, W/S/↑/↓ gezin, E/Enter/Space onayla, Q/Backspace/Esc kapat.
 * Yazım (daktilo) sürerken E/Enter/Space/tıklama önce metni tamamlar.
 */

const TERM_COLORS = {
  green: '#8ef5a8',
  amber: '#ffc775',
  blue: '#9fd6ff',
  red: '#ff8f80',
  white: '#e6efe8',
};

function toRgb(color) {
  const hex = TERM_COLORS[color] || color;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = parseInt(h, 16);
  return { hex: '#' + h, rgb: `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}` };
}

function normLines(lines) {
  if (lines == null) return [];
  if (typeof lines === 'string') return lines.split('\n');
  if (!Array.isArray(lines)) return [String(lines)];
  const out = [];
  for (const l of lines) out.push(...String(l ?? '').split('\n'));
  return out;
}

const SELECT_KEYS = new Set(['KeyE', 'Enter', 'NumpadEnter', 'Space']);
const CLOSE_KEYS = new Set(['KeyQ', 'Backspace', 'Escape']);
const UP_KEYS = new Set(['KeyW', 'ArrowUp']);
const DOWN_KEYS = new Set(['KeyS', 'ArrowDown']);

let _uid = 0;

export class Modal {
  /**
   * @param {import('./UI.js').UI} ui
   * @param {'terminal'|'dialog'} kind
   */
  constructor(ui, kind, opts = {}) {
    this.ui = ui;
    this.kind = kind;
    this.id = ++_uid;
    this.onClose = typeof opts.onClose === 'function' ? opts.onClose : null;
    this.closed = false;
    this.lines = [];
    this.options = [];
    this.sel = 0;
    this.typed = 0;
    this.total = 0;
    this.speed = kind === 'terminal' ? 260 : 62; // karakter / sn
    this.openedAt = performance.now();
    this._tickAcc = 0;
    this._lineEls = [];
    this._optEls = [];
    this._starts = [];

    this._build(opts);
    this.setLines(kind === 'dialog' ? opts.text ?? opts.lines : opts.lines);
    this.setOptions(opts.options);

    /** Dışarıya verilen tutamaç (API sözleşmesi: close, setLines) */
    this.handle = {
      close: () => this.close('api'),
      setLines: (lines) => this.setLines(lines),
      setText: (text) => this.setLines(text),
      setOptions: (options) => this.setOptions(options),
      setTitle: (title) => this.setTitle(title),
      get isOpen() {
        return !this._m.closed;
      },
      _m: this,
    };
  }

  _build(opts) {
    const isTerm = this.kind === 'terminal';
    const touch = this.ui.isTouch;
    const el = document.createElement('div');
    this.el = el;
    if (isTerm) {
      el.className = 'ui-term';
      const c = toRgb(opts.color || 'green') || toRgb('green');
      el.style.setProperty('--term', c.hex);
      el.style.setProperty('--term-rgb', c.rgb);
      el.innerHTML = `
        <div class="roll"></div>
        <div class="t-head"><span class="t-title"></span><span class="t-sys">AZİM·OS 4.2</span>
          <button class="t-x" data-close aria-label="Kapat">✕</button></div>
        <div class="t-body"></div>
        <div class="t-opts"></div>
        <div class="t-foot"></div>`;
      this.titleEl = el.querySelector('.t-title');
      this.setTitle(opts.title || 'TERMİNAL');
    } else {
      el.className = 'ui-dlg';
      const spk = String(opts.speaker ?? '');
      if (/^tars$/i.test(spk.trim())) el.classList.add('tars');
      el.innerHTML = `<div class="d-spk"></div><div class="d-text"></div><div class="t-opts"></div><div class="t-foot"></div>`;
      el.querySelector('.d-spk').textContent = spk.toLocaleUpperCase('tr-TR');
      if (!spk) el.querySelector('.d-spk').style.display = 'none';
    }
    this.bodyEl = el.querySelector(isTerm ? '.t-body' : '.d-text');
    this.optsEl = el.querySelector('.t-opts');
    this.footEl = el.querySelector('.t-foot');
    this.caret = document.createElement('span');
    this.caret.className = 't-caret';

    // Fare / dokunma
    el.addEventListener('click', (e) => {
      if (this.closed) return;
      const closeBtn = e.target.closest('[data-close]');
      if (closeBtn) {
        this.ui._sfx('click', 0.5);
        this.close('user');
        return;
      }
      const opt = e.target.closest('[data-opt]');
      if (opt) {
        this.choose(Number(opt.dataset.opt));
        return;
      }
      if (!this.done) this.finishTyping();
      else if (!this.options.length && this.kind === 'dialog') this.close('user');
    });
    el.addEventListener('mouseover', (e) => {
      const opt = e.target.closest('[data-opt]');
      if (opt) this.setSel(Number(opt.dataset.opt), true);
    });

    this._footText = (n) => {
      if (touch) return n ? 'SEÇENEĞE DOKUN' : this.kind === 'dialog' ? 'DEVAM İÇİN DOKUN' : 'KAPATMAK İÇİN ✕';
      if (isTerm) return n ? '[1–9] SEÇ   [W/S] GEZİN   [E] ONAYLA   [Q] ÇIKIŞ' : '[E] TAMAM   [Q] ÇIKIŞ';
      return n ? '1–9 · W/S  SEÇ    E  ONAYLA    Q  KAPAT' : 'E  DEVAM';
    };
  }

  setTitle(title) {
    if (this.titleEl) this.titleEl.textContent = String(title ?? '');
  }

  get done() {
    return this.typed >= this.total;
  }

  /** Satırları canlı günceller. Değişmeyen baştaki satırlar yeniden yazılmaz. */
  setLines(lines) {
    const next = normLines(lines);
    let common = 0;
    while (common < next.length && common < this.lines.length && next[common] === this.lines[common]) common++;
    // ortak önekteki karakter sayısı (her satır sonu +1 duraklama)
    let prefixChars = 0;
    for (let i = 0; i < common; i++) prefixChars += next[i].length + 1;
    this.lines = next;
    this._starts = [];
    let acc = 0;
    for (const l of next) {
      this._starts.push(acc);
      acc += l.length + 1;
    }
    this.total = Math.max(0, acc - 1);
    this.typed = Math.min(this.typed, prefixChars, this.total);
    // DOM: ortak önekten sonrasını yeniden kur
    while (this._lineEls.length > common) this._lineEls.pop().remove();
    for (let i = common; i < next.length; i++) {
      const d = document.createElement('div');
      d.className = 't-line';
      d.dataset.n = '-1';
      d.style.display = 'none';
      this.bodyEl.appendChild(d);
      this._lineEls.push(d);
    }
    this._render(true);
  }

  setOptions(options) {
    this.options = Array.isArray(options) ? options.filter(Boolean) : [];
    this.optsEl.textContent = '';
    this._optEls = this.options.map((o, i) => {
      const b = document.createElement('button');
      b.className = 't-opt' + (o.disabled ? ' disabled' : '');
      b.dataset.opt = String(i);
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = i < 9 ? `[${i + 1}]` : '[ ]';
      const m = document.createElement('span');
      m.className = 'm';
      m.textContent = '▶';
      const l = document.createElement('span');
      l.className = 'l';
      l.textContent = String(o.label ?? '');
      b.append(m, n, l);
      this.optsEl.appendChild(b);
      return b;
    });
    this.optsEl.style.display = this.options.length ? '' : 'none';
    this.footEl.textContent = this._footText(this.options.length);
    const first = this.options.findIndex((o) => !o.disabled);
    this.sel = -1;
    this.setSel(first < 0 ? 0 : first);
    this.optsEl.classList.toggle('pending', !this.done);
  }

  setSel(i, fromPointer = false) {
    if (!this.options.length) return;
    const n = this.options.length;
    i = ((i % n) + n) % n;
    if (i === this.sel) return;
    this._optEls[this.sel]?.classList.remove('sel');
    this.sel = i;
    this._optEls[i]?.classList.add('sel');
    if (!fromPointer) this._optEls[i]?.scrollIntoView?.({ block: 'nearest' });
    else this.ui._sfx('tick', 0.35);
  }

  _move(dir) {
    const n = this.options.length;
    if (!n) return;
    let i = this.sel;
    for (let k = 0; k < n; k++) {
      i = (((i + dir) % n) + n) % n;
      if (!this.options[i].disabled) break;
    }
    if (i !== this.sel) this.ui._sfx('click', 0.35);
    this.setSel(i);
  }

  finishTyping() {
    this.typed = this.total;
    this._render();
  }

  choose(i) {
    if (this.closed) return;
    const o = this.options[i];
    if (!o || o.disabled) {
      this.ui._sfx('error', 0.4);
      return;
    }
    this.setSel(i);
    this.ui._sfx(this.kind === 'terminal' ? 'beep' : 'click', 0.6);
    let res;
    try {
      res = typeof o.action === 'function' ? o.action() : undefined;
    } catch (err) {
      console.error('[arayüz] seçenek hatası:', err);
    }
    if (res !== false) this.close('action');
  }

  /** @returns {boolean} olay işlendi mi */
  onKey(e) {
    if (this.closed) return false;
    const code = e.code;
    const guard = performance.now() - this.openedAt < 140;
    if (CLOSE_KEYS.has(code)) {
      if (e.repeat || guard) return true;
      this.ui._sfx('click', 0.4);
      this.close('user');
      return true;
    }
    if (UP_KEYS.has(code)) {
      this._move(-1);
      return true;
    }
    if (DOWN_KEYS.has(code)) {
      this._move(1);
      return true;
    }
    if (SELECT_KEYS.has(code)) {
      if (e.repeat || guard) return true;
      if (!this.done) this.finishTyping();
      else if (this.options.length) this.choose(this.sel);
      else this.close('user');
      return true;
    }
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
    if (m) {
      if (e.repeat || guard) return true;
      const i = Number(m[1]) - 1;
      if (i < this.options.length) {
        this.finishTyping();
        this.choose(i);
      }
      return true;
    }
    return false;
  }

  update(dt) {
    if (this.closed || this.done) return;
    this.typed = Math.min(this.total, this.typed + dt * this.speed);
    this._render();
    if (this.kind === 'terminal') {
      this._tickAcc += dt;
      if (this._tickAcc > 0.075) {
        this._tickAcc = 0;
        this.ui._sfx('tick', 0.12);
      }
    }
  }

  _render(force = false) {
    const p = Math.floor(this.typed);
    let caretLine = -1;
    for (let i = 0; i < this.lines.length; i++) {
      const el = this._lineEls[i];
      const start = this._starts[i];
      const text = this.lines[i];
      const shown = p < start ? -1 : Math.min(text.length, p - start);
      if (shown >= 0 && p <= start + text.length) caretLine = i;
      if (!force && Number(el.dataset.n) === shown) continue;
      el.dataset.n = String(shown);
      if (shown < 0) {
        el.style.display = 'none';
        el.textContent = '';
      } else {
        el.style.display = '';
        el.textContent = text.slice(0, shown);
      }
    }
    const done = this.done;
    if (done && this.kind === 'terminal') caretLine = this.lines.length - 1;
    if (caretLine >= 0 && !(done && this.kind === 'dialog')) {
      const el = this._lineEls[caretLine];
      if (this.caret.parentNode !== el || this.caret !== el.lastChild) el.appendChild(this.caret);
    } else this.caret.remove();
    this.optsEl.classList.toggle('pending', !done);
    // en alttaki yazılan satırı görünür tut
    if (this.kind === 'terminal' && !done) this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
  }

  close(reason = 'api') {
    if (this.closed) return;
    this.closed = true;
    const el = this.el;
    el.classList.remove('show');
    setTimeout(() => el.remove(), 220);
    this.ui._onModalClosed(this, reason);
    try {
      this.onClose?.(reason);
    } catch (err) {
      console.error('[arayüz] onClose hatası:', err);
    }
  }
}
