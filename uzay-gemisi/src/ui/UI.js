import './ui.css';
import { MODULE_IDS, locate } from '../world/ShipLayout.js';
import { RingMap, MODULE_NAMES, MODULE_SHORT } from './RingMap.js';
import { Modal } from './Terminal.js';
import { loadSettings, saveSettings, BASE_SENSITIVITY } from './settings.js';

/**
 * Arayüz (Ajan 6). Tüm metinler Türkçe. DOM, #ui-root içine kurulur; stiller ui.css'te.
 *
 * API (sözleşme — docs/ARCHITECTURE.md §8):
 *   ui.showPrompt(text|null)                  — nişangâh altında "[E] text" (dokunmatikte düğme simgesi)
 *   ui.toast(text, ms?)                        — kısa bildirim
 *   ui.subtitle(speaker, text, ms?)            — altyazı (TARS farklı renkte)
 *   ui.setObjective(text|null)                 — sağ üstte görev metni
 *   ui.openTerminal({ title, lines, options, onClose, color })  → { close(), setLines(lines) }
 *   ui.openDialog({ speaker, text, options, onClose })          → { close(), setLines(lines), setText(text) }
 *   ui.fade(toBlack, ms?) → Promise
 *   ui.isModalOpen()
 *   ui.showStart(onStart), ui.showEnding(text)
 *   ui.setInfo(text|null)                      — sol üstte bilgi etiketi (gezegende zaman genişlemesi sayacı)
 *   ui.update(dt)
 *
 * Ek yardımcılar: ui.toggleMap(force?), ui.showPause(), ui.setHudVisible(bool), ui.isBlocked(),
 *   ui.setObjectiveTarget(moduleId|null)
 *
 * Olaylar: dinler → 'pointerlock:change', 'pointerlock:error', 'game:start', 'player:module',
 *   'mission:objective' {text, targetId}, 'state:power_restored', 'engine:quality'
 *   yayar  → 'ui:modal' {open}, 'ui:pause' {open}, 'ui:ending' {open}
 */

const ICON_TAP = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/></svg>`;
const ICON_CURSOR = `<svg viewBox="0 0 18 18" width="18" height="18"><path d="M1.5 1.5 L1.5 14.5 L5 11.2 L7.6 16.6 L9.9 15.5 L7.3 10.2 L12.4 10.2 Z" fill="#f4efe4" stroke="#0a0c0e" stroke-width="1.1" stroke-linejoin="round"/></svg>`;

/** Görev metninden hedef modül çıkarımı (Ajan 5 hedef vermezse yedek). Küçük harf, tr-TR. */
const TARGET_HINTS = [
  [/kumanda|kokpit/, 'command'],
  [/hiper-uyku|hiper uyku|kapsül/, 'cryo'],
  [/yaşam alan|kitaplık|kamara/, 'quarters'],
  [/revir/, 'medical'],
  [/laboratuvar/, 'lab'],
  [/hidroponik|bahçe/, 'hydro'],
  [/motor|sigorta/, 'engine'],
  [/robotik|atölye/, 'robotics'],
  [/kargo|ambar/, 'cargo'],
  [/hava kilidi|ranger|rıhtım/, 'airlock'],
  [/iletişim/, 'comms'],
  [/gözlem|teleskop/, 'observation'],
  [/\btars\b/, 'tars'],
];

const KEYS_DESKTOP = [
  [['W', 'A', 'S', 'D'], 'Hareket'],
  [['Fare'], 'Etrafa bak'],
  [['Shift'], 'Koş'],
  [['C'], 'Eğil'],
  [['Space'], 'Zıpla'],
  [['E'], 'Etkileşim'],
  [['F'], 'El feneri'],
  [['M', 'Tab'], 'Harita'],
  [['1–9'], 'Terminalde seç'],
  [['Esc'], 'Duraklat · Ayarlar'],
];
const KEYS_TOUCH = [
  [['Sol'], 'Sürükle: hareket'],
  [['Sağ'], 'Sürükle: etrafa bak'],
  [['◎'], 'Etkileşim'],
  [['↑'], 'Zıpla'],
  [['⌄'], 'Eğil (aç/kapa)'],
  [['»'], 'Koş (aç/kapa)'],
  [['◇'], 'Harita'],
  [['≡'], 'Menü · Ayarlar'],
];

const now = () => performance.now();

function keysHTML(list, cls = '') {
  return `<div class="ui-keys ${cls}">${list
    .map(([keys, desc]) => `<div class="k">${keys.map((k) => `<kbd>${k}</kbd>`).join('')}</div><div class="d">${desc}</div>`)
    .join('')}</div>`;
}

function upperTR(s) {
  return String(s ?? '').toLocaleUpperCase('tr-TR');
}

export class UI {
  constructor(ctx) {
    this.ctx = ctx;
    this.isTouch = !!ctx.isTouch;
    this.root = document.getElementById('ui-root');
    this.settings = loadSettings();

    /** Mevcut modal (Modal örneği) */
    this._modal = null;
    this._started = false;
    this._startVisible = false;
    this._pauseVisible = false;
    this._endingVisible = false;
    this._mapVisible = false;
    this._hudVisible = true;
    this._enableInputPending = false;
    this._everLocked = false;
    this._lockLostAt = -1e9;
    this._lockFailures = 0;
    this._pauseShownAt = 0;
    this._settingsApplied = false;
    this._objective = null;
    this._objectiveTargetExplicit = undefined; // undefined: verilmedi, null: hedef yok
    this._targetIndex = null;
    this._curIndex = -1;
    this._curRegion = '';
    this._frame = 0;
    this._targetPoll = 0;
    this._lastHintAt = -1e9;
    this._vc = { x: 0, y: 0, active: false, hover: null };

    this._build();
    this._bindEvents();
  }

  // ===================================================================== kurulum
  _build() {
    const ui = document.createElement('div');
    ui.className = 'azim-ui' + (this.isTouch ? ' touch' : '');
    ui.innerHTML = `
      <div class="ui-layer ui-hud">
        <div class="ui-cross"><i></i></div>
        <div class="ui-prompt"><span class="key">${this.isTouch ? ICON_TAP : 'E'}</span><span class="txt"></span></div>
        <div class="ui-tr">
          <div class="ui-obj empty"><div class="lbl"><b>YENİ</b>GÖREV</div><div class="txt"></div><div class="tgt"></div></div>
          <div class="ui-mini"><div class="ui-mini-map"></div><div class="ui-mini-loc"></div><div class="ui-mini-hint">M · HARİTA</div></div>
        </div>
        <div class="ui-hint"></div>
        <div class="ui-info" hidden></div>
      </div>
      <div class="ui-layer ui-map">
        <div class="ui-map-inner">
          <div class="ui-map-head">HALKA PLANI · AZİM</div>
          <div class="ui-map-svg"></div>
          <div class="ui-map-legend">${MODULE_IDS.map((id, i) => `<span data-i="${i}"><b>${String(i + 1).padStart(2, '0')}</b>${MODULE_SHORT[id]}</span>`).join('')}</div>
          <div class="ui-map-info"><span class="c">KONUM&nbsp; <b></b></span><span class="t">HEDEF&nbsp; <b></b></span></div>
          <div class="ui-map-close">${this.isTouch ? 'KAPATMAK İÇİN DOKUN' : 'M · KAPAT'}</div>
        </div>
      </div>
      <div class="ui-layer ui-fade"></div>
      <div class="ui-sub"><div class="spk"></div><div class="txt"></div></div>
      <div class="ui-toasts"></div>
      <div class="ui-layer ui-modal-layer"></div>
      <div class="ui-layer ui-pause"></div>
      <div class="ui-layer ui-start" hidden></div>
      <div class="ui-layer ui-ending"></div>
      <div class="ui-vcursor">${ICON_CURSOR}</div>`;
    this.root.appendChild(ui);
    this.el = ui;
    const q = (s) => ui.querySelector(s);
    this.$ = {
      hud: q('.ui-hud'),
      cross: q('.ui-cross'),
      prompt: q('.ui-prompt'),
      promptTxt: q('.ui-prompt .txt'),
      obj: q('.ui-obj'),
      objTxt: q('.ui-obj .txt'),
      objTgt: q('.ui-obj .tgt'),
      miniLoc: q('.ui-mini-loc'),
      hint: q('.ui-hint'),
      info: q('.ui-info'),
      map: q('.ui-map'),
      mapCur: q('.ui-map-info .c b'),
      mapTgt: q('.ui-map-info .t b'),
      mapTgtWrap: q('.ui-map-info .t'),
      fade: q('.ui-fade'),
      sub: q('.ui-sub'),
      subSpk: q('.ui-sub .spk'),
      subTxt: q('.ui-sub .txt'),
      toasts: q('.ui-toasts'),
      modalLayer: q('.ui-modal-layer'),
      pause: q('.ui-pause'),
      start: q('.ui-start'),
      ending: q('.ui-ending'),
      vcursor: q('.ui-vcursor'),
    };
    // Geriye uyumluluk: eski taslaktaki kimlikler
    this.$.prompt.id = 'ui-prompt';
    this.$.objTxt.id = 'ui-objective';
    this.$.fade.id = 'ui-fade';

    this.miniMap = new RingMap({ big: false });
    q('.ui-mini-map').appendChild(this.miniMap.svg);
    this.bigMap = new RingMap({ big: true });
    q('.ui-map-svg').appendChild(this.bigMap.svg);
    this.$.map.addEventListener('click', () => this.toggleMap(false));
    this._legend = [...ui.querySelectorAll('.ui-map-legend [data-i]')];
    this._checkCompact();
    this._refreshTargetText();
  }

  /** Dar (telefon dikey) ekranda büyük haritada yalnızca numaralar; adlar altta liste olarak. */
  _checkCompact() {
    const compact = window.innerWidth < 560;
    this.$.map.classList.toggle('compact', compact);
    this.bigMap.setCompact(compact);
  }

  _syncLegend() {
    const locked = !this.ctx.state?.is?.('power_restored');
    this._legend?.forEach((el, i) => {
      el.classList.toggle('cur', i === this._curIndex);
      el.classList.toggle('target', i === this._targetIndex);
      el.classList.toggle('locked', i === 0 && locked);
    });
  }

  _syncOverlay() {
    this.el.classList.toggle('overlay', !!(this._modal || this._pauseVisible || this._mapVisible));
  }

  _bindEvents() {
    const { bus } = this.ctx;
    bus.on('pointerlock:change', (locked) => this._onLockChange(locked));
    bus.on('pointerlock:error', () => this._onLockError());
    bus.on('game:start', () => this._onGameStart());
    bus.on('player:module', ({ index }) => this._setCurrentModule(index));
    bus.on('mission:objective', (p) => {
      if (!p || typeof p !== 'object') return;
      if ('text' in p) this.setObjective(p.text);
      if ('targetId' in p) this._objectiveTargetExplicit = p.targetId ?? null;
      this._resolveTarget();
    });
    bus.on('state:power_restored', () => this._refreshLocks());
    // Gezegende halka mini haritası ve büyük harita kapanır
    bus.on('world:change', ({ to }) => {
      this.el.classList.toggle('planet', to === 'planet');
      if (to === 'planet') this.toggleMap(false);
      if (to !== 'planet') this.setInfo(null);
    });
    bus.on('engine:quality', ({ name }) => this._syncQualityButtons(name));

    window.addEventListener('keydown', (e) => this._onKey(e));
    document.addEventListener('mousemove', (e) => this._onMouseMove(e));
    document.addEventListener('mousedown', (e) => this._onMouseDown(e), true);
    // Oyun başladıysa ve kilit yoksa tuvale tıklamak fare kilidini yeniden ister
    this.ctx.renderer?.domElement?.addEventListener('click', () => {
      if (!this._started || this.isTouch || this.ctx.input.isLocked || this.isBlocked()) return;
      if (this._lockFailures >= 2) return;
      this._requestLock();
    });
    window.addEventListener('resize', () => {
      this._clampCursor();
      this._checkCompact();
    });
  }

  // ===================================================================== API
  showPrompt(text) {
    const on = !!text;
    if (on) this.$.promptTxt.textContent = String(text);
    this.$.prompt.classList.toggle('show', on);
    this.$.cross.classList.toggle('active', on);
    this._promptActive = on;
  }

  toast(text, ms = 2600) {
    if (!text) return;
    const t = document.createElement('div');
    t.className = 'ui-toast';
    t.textContent = String(text);
    this.$.toasts.appendChild(t);
    while (this.$.toasts.children.length > 4) this.$.toasts.firstElementChild.remove();
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 400);
    }, Math.max(600, ms));
  }

  subtitle(speaker, text, ms) {
    clearTimeout(this._subT);
    const el = this.$.sub;
    if (!text) {
      el.classList.remove('show');
      return;
    }
    const spk = speaker ? String(speaker) : '';
    this.$.subSpk.textContent = upperTR(spk);
    this.$.subTxt.textContent = String(text);
    el.classList.toggle('tars', /^tars$/i.test(spk.trim()));
    el.classList.add('show');
    const dur = ms ?? Math.max(3200, 1400 + String(text).length * 62);
    this._subT = setTimeout(() => el.classList.remove('show'), dur);
  }

  setObjective(text) {
    const t = text ? String(text) : null;
    if (t === this._objective) return;
    const had = this._objective !== null;
    this._objective = t;
    // yeni görev: önceki görevin açık hedefi geçersiz ('mission:objective' hemen ardından yenisini verebilir)
    this._objectiveTargetExplicit = undefined;
    const o = this.$.obj;
    if (!t) {
      o.classList.add('empty');
      this._resolveTarget();
      return;
    }
    this.$.objTxt.textContent = t;
    o.classList.remove('empty');
    o.classList.remove('fresh');
    void o.offsetWidth; // animasyonu yeniden başlat
    o.classList.add('fresh');
    clearTimeout(this._freshT);
    this._freshT = setTimeout(() => o.classList.remove('fresh'), 5000);
    if (had) this._sfx('success', 0.45);
    this._resolveTarget();
  }

  /** Ek: sol üstte küçük bilgi etiketi (ör. "Dünya'da geçen: 3 yıl 2 ay"); null → gizle. */
  setInfo(text) {
    const t = text ? String(text) : '';
    const el = this.$.info;
    if (!el || el.textContent === t) return;
    el.textContent = t;
    el.hidden = !t;
  }

  /** Ek: görev hedefini doğrudan ayarla (modül kimliği, 'tars' ya da null). */
  setObjectiveTarget(id) {
    this._objectiveTargetExplicit = id ?? null;
    this._resolveTarget();
  }

  openTerminal(opts = {}) {
    return this._openModal('terminal', opts || {});
  }

  openDialog(opts = {}) {
    return this._openModal('dialog', opts || {});
  }

  fade(toBlack, ms = 1000) {
    const el = this.$.fade;
    el.style.transition = `opacity ${Math.max(0, ms)}ms ease`;
    el.style.opacity = toBlack ? '1' : '0';
    return new Promise((r) => setTimeout(r, Math.max(0, ms)));
  }

  isModalOpen() {
    return !!this._modal || this._endingVisible;
  }

  /** Ek: oyuncunun girişini engelleyen herhangi bir katman açık mı */
  isBlocked() {
    return !!this._modal || this._pauseVisible || this._endingVisible || this._startVisible;
  }

  setHudVisible(v) {
    this._hudVisible = !!v;
    this._syncHud();
  }

  showStart(onStart) {
    const el = this.$.start;
    const touch = this.isTouch;
    el.innerHTML = `
      <div class="st-inner">
        <div class="st-kicker">ENDURANCE SINIFI HALKA GEMİSİ</div>
        <h1 class="st-title">AZİM</h1>
        <div class="st-sub">Bir Interstellar esintisi</div>
        <div class="st-line"></div>
        ${keysHTML(touch ? KEYS_TOUCH : KEYS_DESKTOP, 'st-keys')}
        <div class="st-cta">${touch ? 'DOKUN VE BAŞLA' : 'BAŞLAMAK İÇİN TIKLA'}</div>
        <div class="st-foot">${touch ? 'Yatay tutmanız önerilir · Kulaklık önerilir' : 'Kulaklık önerilir'}</div>
      </div>`;
    el.hidden = false;
    el.classList.remove('out');
    this._startVisible = true;
    this._syncHud();
    this._blockInput();
    let fired = false;
    const go = () => {
      if (fired) return;
      fired = true;
      this._startCallback = null;
      this._startVisible = false;
      el.classList.add('out');
      setTimeout(() => (el.hidden = true), 950);
      this._started = true;
      this._syncHud();
      this._scheduleInputEnable();
      // Telefonda adres çubuğu oyun alanını yemesin: mümkünse tam ekran (başarısızlık sessizce yok sayılır)
      if (this.isTouch && !document.fullscreenElement) {
        try {
          document.documentElement.requestFullscreen?.()?.catch?.(() => {});
        } catch {
          /* desteklenmiyor (ör. iPhone Safari) */
        }
      }
      try {
        onStart?.();
      } catch (err) {
        console.error('[arayüz] başlatma hatası:', err);
      }
    };
    this._startCallback = go;
    el.onclick = go;
  }

  showEnding(text) {
    if (this._modal) this._modal.close('ending');
    this.toggleMap(false);
    this._hidePause(false);
    const el = this.$.ending;
    const paras = String(text ?? '')
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    el.innerHTML = `
      <div class="en-text">${paras.map(() => '<p></p>').join('')}</div>
      <div class="en-credits">
        <div class="t">AZİM</div>
        <div class="s">BİR INTERSTELLAR ESİNTİSİ</div>
        <dl>
          <dt>Gemi</dt><dd>Endurance sınıfı halka, 12 modül</dd>
          <dt>Mürettebat</dt><dd>Sen, TARS, Ela, Doruk ve Rami</dd>
          <dt>Ses ve müzik</dt><dd>Prosedürel WebAudio org tonları</dd>
          <dt>Yapım</dt><dd>Yedi ajanlık bir ekip</dd>
          <dt>Saygıyla</dt><dd>Interstellar (2014)</dd>
        </dl>
      </div>
      <div class="en-cont"><button class="ui-btn-line" data-cont>SERBEST DOLAŞMAYA DEVAM ET</button></div>`;
    el.querySelectorAll('.en-text p').forEach((p, i) => (p.textContent = paras[i]));
    el.querySelector('[data-cont]').addEventListener('click', () => this._closeEnding());
    this._endingVisible = true;
    this._endingReady = false;
    this._blockInput();
    this._syncHud();
    requestAnimationFrame(() => el.classList.add('show'));
    this.ctx.bus.emit('ui:ending', { open: true });
    this._updateCursorMode(true);

    // Sırayla beliren satırlar → jenerik → devam düğmesi
    const ps = [...el.querySelectorAll('.en-text p')];
    const timers = (this._endingTimers = []);
    let t = 2200;
    ps.forEach((p) => {
      timers.push(setTimeout(() => p.classList.add('in'), t));
      t += 2600;
    });
    timers.push(setTimeout(() => el.querySelector('.en-credits').classList.add('in'), t + 600));
    timers.push(
      setTimeout(() => {
        el.querySelector('.en-cont').classList.add('in');
        this._endingReady = true;
      }, t + 3200),
    );
  }

  _closeEnding() {
    if (!this._endingVisible) return;
    (this._endingTimers || []).forEach(clearTimeout);
    this._endingVisible = false;
    this.$.ending.classList.remove('show');
    this._syncHud();
    this._scheduleInputEnable();
    this.ctx.bus.emit('ui:ending', { open: false });
    this._updateCursorMode();
    if (!this.isTouch && !this.ctx.input.isLocked) this._requestLock();
  }

  toggleMap(force) {
    const show = typeof force === 'boolean' ? force : !this._mapVisible;
    if (show && (!this._started || this.isBlocked() || this.ctx.world?.isPlanet?.())) return;
    if (show === this._mapVisible) return;
    this._mapVisible = show;
    this.$.map.classList.toggle('show', show);
    this.$.map.style.pointerEvents = show ? 'auto' : '';
    this._syncOverlay();
    if (show) {
      this._updateBigMap();
      this._sfx('beep', 0.25);
    }
  }

  showPause() {
    if (this._pauseVisible || this._endingVisible || this._startVisible) return;
    if (this._modal) this._modal.close('pause');
    this.toggleMap(false);
    this._pauseVisible = true;
    this._pauseShownAt = now();
    this._renderPause('main');
    this.$.pause.classList.add('show');
    this._syncOverlay();
    this._blockInput();
    this.ctx.bus.emit('ui:pause', { open: true });
  }

  update(dt) {
    this._frame++;
    const { input, player } = this.ctx;

    if (!this._settingsApplied && player) {
      this._settingsApplied = true;
      this._applySettings(true);
    }

    if (this._enableInputPending) {
      this._enableInputPending = false;
      if (!this.isBlocked()) input.enabled = true;
    }

    if (this._started && !this.isBlocked() && input.actionPressed('map')) this.toggleMap();

    this._modal?.update(dt);

    // Konum (mini harita)
    if (player) {
      const loc = player.location;
      if (loc) {
        if (loc.index !== this._curIndex) this._setCurrentModule(loc.index);
        if (loc.region !== this._curRegion) {
          this._curRegion = loc.region;
          this._refreshLocation();
        }
      }
      if (this._frame % 2 === 0) {
        this.miniMap.setPlayer(player.position.x, player.position.z, player.yaw);
        if (this._mapVisible) this._updateBigMap();
      }
    }

    // Görev hedefi (Missions.currentTargetId veya TARS konumu değişebilir)
    this._targetPoll -= dt;
    if (this._targetPoll <= 0) {
      this._targetPoll = 0.3;
      this._resolveTarget();
    }
  }

  // ===================================================================== modallar
  _openModal(kind, opts) {
    const wasOpen = !!this._modal;
    if (this._modal) {
      this._replacing = true;
      this._modal.close('replaced');
      this._replacing = false;
    }
    this.toggleMap(false);
    const m = new Modal(this, kind, opts);
    this._modal = m;
    const layer = this.$.modalLayer;
    layer.appendChild(m.el);
    layer.classList.add('open');
    requestAnimationFrame(() => {
      if (!m.closed) m.el.classList.add('show');
    });
    if (kind === 'terminal') this._sfx('terminal', 0.6);
    this._syncOverlay();
    if (!wasOpen) {
      this._blockInput();
      this.ctx.bus.emit('ui:modal', { open: true });
    }
    this._updateCursorMode(true);
    return m.handle;
  }

  /** Modal.close() çağırır. */
  _onModalClosed(m) {
    if (this._modal !== m) return;
    this._modal = null;
    if (this._replacing) return;
    this._syncOverlay();
    this.$.modalLayer.classList.remove('open');
    this.ctx.bus.emit('ui:modal', { open: false });
    this._scheduleInputEnable();
    this._updateCursorMode();
  }

  // ===================================================================== giriş durumu
  _blockInput() {
    this._enableInputPending = false;
    this.ctx.input.enabled = false;
  }

  /** Bir sonraki karede (ui.update) girişi aç: kapatmak için basılan E aynı karede etkileşimi tetiklemesin. */
  _scheduleInputEnable() {
    if (this.isBlocked()) return;
    this._enableInputPending = true;
  }

  _syncHud() {
    const hidden = !this._hudVisible || this._startVisible || this._endingVisible;
    this.el.classList.toggle('hud-hidden', hidden);
  }

  // ===================================================================== fare kilidi / duraklatma
  _requestLock() {
    if (this.isTouch) return;
    const input = this.ctx.input;
    // Esc ile çıkıştan hemen sonra tarayıcı kilidi reddeder: ~1 sn bekle (kullanıcı etkinliği 5 sn geçerli)
    const wait = Math.max(0, 1150 - (now() - this._lockLostAt));
    clearTimeout(this._lockT);
    if (wait > 0) this._lockT = setTimeout(() => input.requestLock(), wait);
    else input.requestLock();
  }

  _onLockChange(locked) {
    if (locked) {
      this._everLocked = true;
      this._lockFailures = 0;
      if (this._pauseVisible) this._hidePause(true);
      this._showHint(null);
      this._updateCursorMode();
      return;
    }
    this._lockLostAt = now();
    this._updateCursorMode();
    if (!this._started || this._endingVisible || this._startVisible || this.isTouch) return;
    // Esc fare kilidini bıraktı. Terminal/diyalog açıksa yalnızca onu kapat (duraklatma menüsü açma):
    // tarayıcı ilk Esc'yi kilit için tüketir; oyuncu çoğunlukla terminalden çıkmak istemiştir.
    if (this._modal) {
      this._modal.close('escape');
      this._showHint('Devam etmek için ekrana tıkla', 60000);
      return;
    }
    this.showPause();
  }

  _onLockError() {
    this._lockFailures++;
    this._showHint('Fareyi sürükleyerek bak', 7000);
    if (this._pauseVisible) this._hidePause(true);
  }

  _onGameStart() {
    this._started = true;
    if (this._startVisible && this._startCallback) {
      // başlangıç ekranı açıkken oyun başka yoldan başladı
      this._startVisible = false;
      this.$.start.hidden = true;
      this._scheduleInputEnable();
    }
    this._syncHud();
    // Sürükleyerek bakış modundaysak ipucu ver
    setTimeout(() => {
      const input = this.ctx.input;
      if (!this.isTouch && input.dragLook && !input.isLocked) this._showHint('Fareyi sürükleyerek bak', 7000);
    }, 600);
  }

  _showHint(text, ms = 5000) {
    clearTimeout(this._hintT);
    const el = this.$.hint;
    if (!text) {
      el.classList.remove('show');
      return;
    }
    if (now() - this._lastHintAt < 1500 && el.textContent === text) return;
    this._lastHintAt = now();
    el.textContent = text;
    el.classList.add('show');
    this._hintT = setTimeout(() => el.classList.remove('show'), ms);
  }

  _hidePause(resumeInput = true) {
    if (!this._pauseVisible) return;
    this._pauseVisible = false;
    this.$.pause.classList.remove('show');
    this._syncOverlay();
    this.ctx.bus.emit('ui:pause', { open: false });
    if (resumeInput) this._scheduleInputEnable();
  }

  _resume() {
    this._hidePause(true);
    if (!this.isTouch && !this.ctx.input.isLocked) this._requestLock();
  }

  _renderPause(view) {
    this._pauseView = view;
    const el = this.$.pause;
    const titles = { main: 'DURAKLATILDI', settings: 'AYARLAR', controls: 'KONTROLLER' };
    let body = '';
    if (view === 'main') {
      const fs = this.isTouch && document.fullscreenEnabled;
      const input = this.ctx.input;
      let note = '';
      if (!this.isTouch && input.dragLook && !input.isLocked)
        note = 'Fare kilitlenemiyor: oyun penceresinde fareyi basılı tutup sürükleyerek etrafa bakabilirsin.';
      else if (!this.isTouch) note = 'Devam ettiğinde fare yeniden kilitlenir. Esc ile istediğin an buraya dönebilirsin.';
      body = `
        <button class="ui-btn primary" data-act="resume">DEVAM</button>
        <button class="ui-btn" data-act="settings">AYARLAR</button>
        <button class="ui-btn" data-act="controls">KONTROLLER</button>
        ${fs ? `<button class="ui-btn" data-act="fullscreen">${document.fullscreenElement ? 'TAM EKRANDAN ÇIK' : 'TAM EKRAN'}</button>` : ''}
        ${note ? `<div class="pz-note">${note}</div>` : ''}`;
    } else if (view === 'controls') {
      body = `${keysHTML(this.isTouch ? KEYS_TOUCH : KEYS_DESKTOP)}
        <div class="pz-note">Terminallerde: 1–9 doğrudan seç · W/S veya ↑/↓ gezin · E/Enter onayla · Q/Backspace kapat.</div>
        <div class="pz-back"><button class="ui-btn" data-act="back">‹  GERİ</button></div>`;
    } else {
      body = this._settingsHTML();
    }
    el.innerHTML = `<div class="pz-panel ${view}"><div class="pz-brand">AZİM</div><div class="pz-title">${titles[view]}</div>${body}</div>`;
    el.onclick = (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      this._sfx('click', 0.4);
      if (act === 'resume') this._resume();
      else if (act === 'settings' || act === 'controls') this._renderPause(act);
      else if (act === 'back') this._renderPause('main');
      else if (act === 'fullscreen') {
        try {
          if (document.fullscreenElement) document.exitFullscreen?.();
          else document.documentElement.requestFullscreen?.()?.catch?.(() => {});
        } catch {
          /* desteklenmiyor */
        }
        setTimeout(() => this._pauseVisible && this._pauseView === 'main' && this._renderPause('main'), 300);
      }
    };
    if (view === 'settings') this._bindSettings();
  }

  // ===================================================================== ayarlar
  _settingsHTML() {
    const s = this.settings;
    const q = this.ctx.engine?.qualityName || s.quality || 'high';
    const range = (key, label, min, max, step, val, fmt) =>
      `<div class="pz-row"><label for="set-${key}">${label}</label><input id="set-${key}" type="range" data-set="${key}" min="${min}" max="${max}" step="${step}" value="${val}"><span class="v" data-val="${key}">${fmt(val)}</span></div>`;
    const toggle = (key, label, on) =>
      `<div class="pz-row"><span class="l">${label}</span><button class="ui-toggle${on ? ' on' : ''}" data-tog="${key}" aria-pressed="${on}"></button></div>`;
    return `
      <div class="pz-cols">
      <div class="pz-sec-title">KONTROL</div>
      ${range('sensitivity', this.isTouch ? 'Bakış hassasiyeti' : 'Fare hassasiyeti', 0.2, 3, 0.05, s.sensitivity, this._fmt.sensitivity)}
      ${toggle('invertY', 'Y eksenini ters çevir', s.invertY)}
      ${range('fov', 'Görüş alanı (FOV)', 55, 100, 1, s.fov, this._fmt.fov)}
      ${toggle('headBob', 'Kafa sallanması', s.headBob)}
      <div class="pz-sec-title">SES</div>
      ${range('masterVolume', 'Ana ses', 0, 1, 0.01, s.masterVolume, this._fmt.pct)}
      ${range('musicVolume', 'Müzik', 0, 1, 0.01, s.musicVolume, this._fmt.pct)}
      <div class="pz-sec-title">GRAFİK</div>
      <div class="pz-row"><span class="l">Kalite</span><div class="ui-seg" data-quality>
        <button data-q="low" class="${q === 'low' ? 'on' : ''}">DÜŞÜK</button><button data-q="medium" class="${q === 'medium' ? 'on' : ''}">ORTA</button><button data-q="high" class="${q === 'high' ? 'on' : ''}">YÜKSEK</button>
      </div></div>
      </div>
      <div class="pz-back"><button class="ui-btn" data-act="back">‹  GERİ</button></div>`;
  }

  get _fmt() {
    return {
      sensitivity: (v) => `${Number(v).toFixed(2)}×`,
      fov: (v) => `${Math.round(v)}°`,
      pct: (v) => `%${Math.round(v * 100)}`,
    };
  }

  _bindSettings() {
    const el = this.$.pause;
    const fmt = this._fmt;
    el.querySelectorAll('input[data-set]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const key = inp.dataset.set;
        const v = Number(inp.value);
        this.settings[key] = v;
        const out = el.querySelector(`[data-val="${key}"]`);
        if (out) out.textContent = (key === 'sensitivity' ? fmt.sensitivity : key === 'fov' ? fmt.fov : fmt.pct)(v);
        this._applySettings();
        saveSettings(this.settings);
      });
      // sürgü değişimi sonrası küçük ses örneği
      if (inp.dataset.set === 'masterVolume') inp.addEventListener('change', () => this._sfx('beep', 0.6));
    });
    el.querySelectorAll('[data-tog]').forEach((b) => {
      b.addEventListener('click', () => {
        const key = b.dataset.tog;
        this.settings[key] = !this.settings[key];
        b.classList.toggle('on', this.settings[key]);
        b.setAttribute('aria-pressed', String(this.settings[key]));
        this._applySettings();
        saveSettings(this.settings);
      });
    });
    el.querySelectorAll('[data-q]').forEach((b) => {
      b.addEventListener('click', () => {
        const name = b.dataset.q;
        this.settings.quality = name;
        saveSettings(this.settings);
        try {
          this.ctx.engine?.setQuality?.(name);
        } catch (err) {
          console.error('[arayüz] kalite değiştirilemedi:', err);
        }
        this._syncQualityButtons(name);
      });
    });
  }

  _syncQualityButtons(name) {
    this.$.pause.querySelectorAll('[data-q]').forEach((b) => b.classList.toggle('on', b.dataset.q === name));
  }

  _applySettings(initial = false) {
    const s = this.settings;
    const { player, audio, engine, params } = this.ctx;
    if (player) {
      if (this._baseSens === undefined) this._baseSens = player.sensitivity || BASE_SENSITIVITY;
      player.sensitivity = this._baseSens * s.sensitivity;
      player.invertY = !!s.invertY;
      player.baseFov = s.fov;
      player.headBob = !!s.headBob;
    }
    audio?.setMasterVolume?.(s.masterVolume);
    audio?.setMusicVolume?.(s.musicVolume);
    // Kayıtlı kalite: URL ?quality= verilmişse ona dokunma
    if (initial && s.quality && engine && !params?.has?.('quality') && engine.qualityName !== s.quality) {
      try {
        engine.setQuality(s.quality);
      } catch (err) {
        console.error('[arayüz] kalite uygulanamadı:', err);
      }
    }
  }

  // ===================================================================== harita / görev hedefi
  _setCurrentModule(index) {
    if (!Number.isInteger(index)) return;
    this._curIndex = index;
    this.miniMap.setCurrent(index);
    this.bigMap.setCurrent(index);
    this._refreshLocation();
    this._refreshTargetText();
    this._syncLegend();
  }

  _refreshLocation() {
    const id = MODULE_IDS[this._curIndex];
    const name = this._moduleName(id);
    // dar ekranda mini haritanın altında kısa ad (CSS .f / .s seçer)
    const loc = this.$.miniLoc;
    loc.textContent = '';
    const full = document.createElement('span');
    full.className = 'f';
    const short = document.createElement('span');
    short.className = 's';
    if (this._curRegion === 'corridor') full.textContent = short.textContent = 'KORİDOR';
    else {
      full.textContent = upperTR(name);
      short.textContent = MODULE_SHORT[id] || upperTR(name);
    }
    loc.append(full, short);
    this.$.mapCur.textContent = this._curRegion === 'corridor' ? `Koridor · ${name}` : name;
  }

  _moduleName(id) {
    return this.ctx.ship?.getModule?.(id)?.name || MODULE_NAMES[id] || id || '';
  }

  _refreshLocks() {
    const locked = !this.ctx.state?.is?.('power_restored');
    this.bigMap.setLocked(0, locked);
    this._syncLegend();
  }

  _inferTarget(text) {
    if (!text) return null;
    const low = String(text).toLocaleLowerCase('tr-TR');
    let best = null;
    let bestAt = Infinity;
    for (const [re, id] of TARGET_HINTS) {
      const m = re.exec(low);
      if (m && m.index < bestAt) {
        bestAt = m.index;
        best = id;
      }
    }
    return best;
  }

  _tarsIndex() {
    const t = this.ctx.tars;
    const p = t?.group?.position || t?.position;
    if (!p || Math.hypot(p.x, p.z) < 20) return null;
    return locate(p.x, p.z).index;
  }

  /** Hedef öncelik sırası: missions.currentTargetId → 'mission:objective' targetId → metinden çıkarım */
  _resolveTarget() {
    let id;
    const m = this.ctx.missions;
    if (m && m.currentTargetId !== undefined) id = m.currentTargetId;
    else if (this._objectiveTargetExplicit !== undefined) id = this._objectiveTargetExplicit;
    else id = this._objective ? this._inferTarget(this._objective) : null;
    if (!this._objective && (m?.currentTargetId === undefined || m?.currentTargetId === null)) id = null;

    let index = null;
    if (id === 'tars') index = this._tarsIndex();
    else if (typeof id === 'number') index = id;
    else if (id) {
      const i = MODULE_IDS.indexOf(id);
      index = i >= 0 ? i : null;
    }
    if (index === this._targetIndex) return;
    this._targetIndex = index;
    this.miniMap.setTarget(index);
    this.bigMap.setTarget(index);
    this._refreshTargetText();
    this._syncLegend();
  }

  _refreshTargetText() {
    const i = this._targetIndex;
    const tgt = this.$.objTgt;
    if (i === null || i === undefined) {
      tgt.textContent = '';
      this.$.mapTgtWrap.style.display = 'none';
      return;
    }
    const name = this._moduleName(MODULE_IDS[i]);
    const here = i === this._curIndex;
    tgt.textContent = `HEDEF · ${upperTR(name)}${here ? '  ◆ BURADASIN' : ''}`;
    this.$.mapTgt.textContent = name;
    this.$.mapTgtWrap.style.display = '';
  }

  _updateBigMap() {
    const p = this.ctx.player;
    if (p) this.bigMap.setPlayer(p.position.x, p.position.z, p.yaw);
    const t = this.ctx.tars;
    const tp = t?.group?.position || t?.position;
    this.bigMap.setTars(tp && Math.hypot(tp.x, tp.z) > 20 ? tp : null);
    this._refreshLocks();
  }

  // ===================================================================== klavye
  _onKey(e) {
    const code = e.code;
    // Başlangıç ekranı: Enter / Space ile de başlat
    if (this._startVisible) {
      if ((code === 'Enter' || code === 'Space') && !e.repeat) this._startCallback?.();
      return;
    }
    if (this._endingVisible) {
      if (this._endingReady && !e.repeat && (code === 'Enter' || code === 'Space' || code === 'KeyE')) this._closeEnding();
      return;
    }
    if (this._modal) {
      if (this._modal.onKey(e)) e.preventDefault();
      return;
    }
    if (this._pauseVisible) {
      if (code === 'Escape' && now() - this._pauseShownAt > 400) {
        if (this._pauseView !== 'main') this._renderPause('main');
        else this._resume();
      }
      return;
    }
    if (code === 'Escape') {
      if (this._mapVisible) {
        this.toggleMap(false);
        return;
      }
      // Kilit yokken (sürükleyerek bakış / autostart / dokunmatik) Esc duraklatır.
      // Kilitliyken Esc'yi tarayıcı tüketir; kilit kaybı olayı menüyü açar.
      if (this._started && !this.ctx.input.isLocked && now() - this._lockLostAt > 400) this.showPause();
    }
  }

  // ===================================================================== sanal imleç
  /** Fare kilitliyken modal/kapanış ekranında görünür imleç: kilidi bırakmadan tıklanabilir. */
  _updateCursorMode(recenter = false) {
    const active = !!(this._modal || this._endingVisible) && this.ctx.input.isLocked && !this.isTouch;
    const vc = this._vc;
    if (active && (!vc.active || recenter)) {
      const r = this._modal?.el?.querySelector('.t-opts')?.getBoundingClientRect();
      vc.x = r && r.width ? r.left + 40 : window.innerWidth / 2;
      vc.y = r && r.height ? r.top + r.height / 2 : window.innerHeight * 0.6;
      if (!r || !r.width) {
        vc.x = window.innerWidth / 2;
        vc.y = window.innerHeight * 0.62;
      }
    }
    vc.active = active;
    this.$.vcursor.classList.toggle('show', active);
    if (active) this._placeCursor();
    else this._setVHover(null);
  }

  _clampCursor() {
    const vc = this._vc;
    vc.x = Math.min(window.innerWidth - 2, Math.max(0, vc.x));
    vc.y = Math.min(window.innerHeight - 2, Math.max(0, vc.y));
  }

  _placeCursor() {
    this._clampCursor();
    this.$.vcursor.style.transform = `translate(${this._vc.x}px, ${this._vc.y}px)`;
  }

  _onMouseMove(e) {
    const vc = this._vc;
    if (!vc.active) return;
    if (!this.ctx.input.isLocked) return this._updateCursorMode();
    vc.x += e.movementX || 0;
    vc.y += e.movementY || 0;
    this._placeCursor();
    const t = document.elementFromPoint(vc.x, vc.y);
    const opt = t?.closest?.('[data-opt]');
    if (opt && this._modal) this._modal.setSel(Number(opt.dataset.opt), true);
    this._setVHover(t?.closest?.('button') || null);
  }

  _setVHover(el) {
    if (this._vc.hover === el) return;
    this._vc.hover?.classList.remove('vhover');
    this._vc.hover = el;
    el?.classList.add('vhover');
  }

  _onMouseDown(e) {
    const vc = this._vc;
    if (!vc.active || e.button !== 0 || !this.ctx.input.isLocked) return;
    const t = document.elementFromPoint(vc.x, vc.y);
    const target = t?.closest?.('.ui-term, .ui-dlg, .ui-ending') ? t : null;
    if (target) {
      e.preventDefault();
      e.stopPropagation();
      target.click?.();
    }
  }

  // ===================================================================== ses kısayolu
  _sfx(name, volume = 1) {
    try {
      this.ctx.audio?.play?.(name, { volume });
    } catch {
      /* ses hazır değil */
    }
  }
}
