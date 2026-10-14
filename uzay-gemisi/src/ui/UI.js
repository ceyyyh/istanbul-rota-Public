/**
 * Arayüz (TASLAK — Ajan 6 "Arayüz & Ses" yeniden yazacak; API sabit kalmalı).
 * Tüm metinler Türkçe. DOM, #ui-root içine kurulur.
 *
 * API (diğer sistemler kullanır):
 *   ui.showPrompt(text|null)                  — nişangah altında "[E] text"
 *   ui.toast(text, ms?)                        — kısa bildirim
 *   ui.subtitle(speaker, text, ms?)            — altyazı/diyalog satırı
 *   ui.setObjective(text|null)                 — sağ üstte görev metni
 *   ui.openTerminal({ title, lines, options, onClose, color })  → { close(), setLines(lines) }
 *       lines: string[] (retro yeşil ekran), options: [{ label, action: () => void|false }]
 *       action false döndürmezse terminal kapanır.
 *   ui.openDialog({ speaker, text, options })  — karakter diyaloğu (TARS), terminal gibi
 *   ui.fade(toBlack: boolean, ms?) → Promise
 *   ui.isModalOpen()
 *   ui.showStart(onStart)                      — başlangıç ekranı
 *   ui.showEnding(text)
 *   ui.update(dt)
 */
export class UI {
  constructor(ctx) {
    this.ctx = ctx;
    this.root = document.getElementById('ui-root');
    this.root.innerHTML = `
      <div style="position:absolute;left:50%;top:50%;width:4px;height:4px;margin:-2px;background:#fff;border-radius:50%;opacity:.8"></div>
      <div id="ui-prompt" style="position:absolute;left:50%;top:calc(50% + 28px);transform:translateX(-50%);font:15px sans-serif;color:#fff;text-shadow:0 1px 3px #000"></div>
      <div id="ui-objective" style="position:absolute;right:20px;top:20px;font:14px sans-serif;color:#e8e4da;max-width:320px;text-align:right"></div>
      <div id="ui-sub" style="position:absolute;left:50%;bottom:60px;transform:translateX(-50%);font:18px sans-serif;color:#fff;text-shadow:0 1px 4px #000;text-align:center;max-width:80%"></div>
      <div id="ui-toast" style="position:absolute;left:50%;top:80px;transform:translateX(-50%);font:15px sans-serif;color:#ffd9a0"></div>
      <div id="ui-start" style="position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.7);pointer-events:auto;cursor:pointer;flex-direction:column;font:20px sans-serif;color:#fff">
        <div style="font-size:48px;letter-spacing:.4em">AZİM</div><div style="margin-top:16px">Başlamak için tıkla</div>
      </div>
      <div id="ui-fade" style="position:absolute;inset:0;background:#000;opacity:0;transition:opacity 1s"></div>`;
    this.$ = (id) => this.root.querySelector('#' + id);
    this._modal = null;
  }
  showPrompt(text) {
    this.$('ui-prompt').textContent = text ? `[E] ${text}` : '';
  }
  toast(text, ms = 2500) {
    const el = this.$('ui-toast');
    el.textContent = text;
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => (el.textContent = ''), ms);
  }
  subtitle(speaker, text, ms = 4000) {
    const el = this.$('ui-sub');
    el.textContent = speaker ? `${speaker}: ${text}` : text;
    clearTimeout(this._subT);
    this._subT = setTimeout(() => (el.textContent = ''), ms);
  }
  setObjective(text) {
    this.$('ui-objective').textContent = text ? `GÖREV: ${text}` : '';
  }
  openTerminal({ title = '', lines = [], options = [], onClose } = {}) {
    console.log('[terminal]', title, lines, options.map((o) => o.label));
    const handle = { close: () => onClose?.(), setLines: () => {} };
    return handle;
  }
  openDialog(opts) {
    return this.openTerminal({ title: opts.speaker, lines: [opts.text], options: opts.options });
  }
  fade(toBlack, ms = 1000) {
    const el = this.$('ui-fade');
    el.style.transition = `opacity ${ms}ms`;
    el.style.opacity = toBlack ? '1' : '0';
    return new Promise((r) => setTimeout(r, ms));
  }
  isModalOpen() {
    return !!this._modal;
  }
  showStart(onStart) {
    const el = this.$('ui-start');
    el.style.display = 'flex';
    el.onclick = () => {
      el.style.display = 'none';
      onStart();
    };
  }
  showEnding(text) {
    this.subtitle(null, text, 8000);
  }
  update() {}
}
