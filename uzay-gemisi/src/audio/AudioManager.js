/**
 * Ses (Ajan 6 "Arayüz & Ses") — tamamen prosedürel WebAudio, harici ses dosyası yok.
 *
 * API (sözleşme — docs/ARCHITECTURE.md §9):
 *   audio.unlock()                         — ilk kullanıcı hareketinde çağrılır (AudioContext oluşturur / resume eder).
 *                                            Öncesinde tüm çağrılar hatasız, sessizce yok sayılır.
 *   audio.play(name, { volume, position }) — name: beep click switch door door_locked hiss airlock footstep alarm
 *                                            power_up power_down error success tick spin_up terminal servo
 *                                            position (THREE.Vector3 | {x,y,z}) → PannerNode ile 3B konumlu.
 *                                            Bilinmeyen ad sessizce yok sayılır. Çalındıysa true döner.
 *   audio.setAmbient('emergency'|'normal'|null)
 *   audio.speak(text, { voice: 'tars' })   — Promise; konuşma bitince (ya da tahmini sürede) çözülür
 *   audio.setMasterVolume(0..1), audio.setMusicVolume(0..1)
 *   audio.update(dt)                       — dinleyiciyi kameraya eşitler, müzik/ortam zamanlayıcıları
 *
 * Ek: audio.startMusic(), audio.stopMusic(), audio.stopSpeaking(), audio.running, audio.status()
 *
 * Veri yolları:
 *   sfxBus ───────────────────────┐
 *   müzik → musicDuck → musicBus ─┴→ duck → pauseFilter → master → sıkıştırıcı → hoparlör
 *   (ortam uğultusu sfxBus'a bağlıdır; müzik düzeyi 0 olsa da gemi uğultusu sürer)
 *
 * Dinlenen olaylar: player:footstep / jump / land, door:open|close|locked, state:power_restored,
 *   state:ring_spinning, game:start, ui:pause.
 */
import { createKit, SFX, noise } from './synth.js';
import { OrganMusic, Ambience } from './music.js';
import { loadSettings } from '../ui/settings.js';
import { locate } from '../world/ShipLayout.js';

const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
/** Sürgü (doğrusal) → kazanç (algısal eğri) */
const curve = (v) => Math.pow(clamp01(v), 1.6);

/** Efekt adı → aynı anda en fazla kaç ses (taşan en eski değil, yeni olan atılır) */
const VOICE_LIMIT = { footstep: 3, tick: 3, click: 4, servo: 3, switch: 3, beep: 4, door: 3, hiss: 3, default: 5 };
/** Efekt adı → iki çağrı arası en az süre (sn) */
const MIN_GAP = { tick: 0.02, click: 0.02, footstep: 0.14, servo: 0.12 };
/** Konumsuz çağrıları art arda çalınmasın (birden çok yerden tetiklenen uzun sesler) */
const DEDUPE = { power_up: 4, spin_up: 4 };
const GLOBAL_LIMIT = 30;
/** Düzey ayarları (çevrimdışı ölçüme göre: müzik ≈ -24 dBFS, uğultu ≈ -23 dBFS ham RMS) */
const MUSIC_TRIM = 1.5;
const AMBIENT_TRIM = 0.5;
/** Izgara zeminli modüller (metalik adım sesi) */
const GRATE_MODULES = new Set(['engine', 'cargo']);

const VOWELS = {
  a: [700, 1220],
  e: [530, 1840],
  ı: [400, 1300],
  i: [300, 2300],
  o: [500, 900],
  ö: [450, 1500],
  u: [330, 900],
  ü: [300, 1600],
};

function splitSentences(text, max = 170) {
  const raw = text.split(/(?<=[.!?…])\s+/);
  const out = [];
  for (let s of raw) {
    s = s.trim();
    while (s.length > max) {
      let cut = s.lastIndexOf(' ', max);
      if (cut < 40) cut = max;
      out.push(s.slice(0, cut).trim());
      s = s.slice(cut).trim();
    }
    if (s) out.push(s);
  }
  return out;
}

export class AudioManager {
  constructor(ctx) {
    this.ctx = ctx;
    const st = loadSettings();
    this.masterVol = clamp01(st.masterVolume);
    this.musicVol = clamp01(st.musicVolume);

    this.ac = null;
    this.kit = null;
    this.music = null;
    this.ambience = null;
    this.ambient = null; // istenen ortam kipi
    this._appliedAmbient = undefined;
    this._wantMusic = false;
    this._failed = false;
    this._gestured = false;
    this._resumeAt = 0;
    this._hiddenSuspend = false;
    this._live = []; // { name, end }
    this._last = {}; // ad → son çalma zamanı (ac.currentTime)
    this._speech = null;
    this._voice = null;
    this._paused = false;
    this._duckT = -1;
    this.hrtf = !ctx?.isTouch;

    this._bindEvents();
    this._bindPage();
  }

  /** AudioContext çalışıyor mu */
  get running() {
    return !!this.ac && this.ac.state === 'running';
  }

  /** Test / hata ayıklama için küçük durum özeti */
  status() {
    return {
      state: this.ac ? this.ac.state : 'yok',
      failed: this._failed,
      ambient: this.ambient,
      music: !!this.music?.playing,
      live: this._live.length,
      master: this.masterVol,
      musicVolume: this.musicVol,
      speaking: !!this._speech,
    };
  }

  // ===================================================================== kurulum
  unlock() {
    if (this._failed) return false;
    // Gerçek bir kullanıcı hareketi olmadan (ör. ?autostart=1) bağlam oluşturmak yalnızca tarayıcı uyarısı üretir:
    // ilk dokunuşta/tuşta pencere dinleyicisi (_bindPage) yeniden çağırır.
    const act = typeof navigator !== 'undefined' ? navigator.userActivation : null;
    if (!this._gestured && act && !act.hasBeenActive) return false;
    this._gestured = true;
    try {
      if (!this.ac) this._init();
      const ac = this.ac;
      if (ac && ac.state !== 'running') {
        const p = ac.resume();
        p?.catch?.(() => {});
        p?.then?.(() => this._onRunning());
      }
      if (ac && !this._primed) {
        // iOS / Safari: ses sistemini ilk dokunuş içinde sessiz bir tamponla uyandır
        this._primed = true;
        const b = ac.createBuffer(1, 1, ac.sampleRate);
        const s = ac.createBufferSource();
        s.buffer = b;
        s.connect(ac.destination);
        s.start(0);
      }
      this._onRunning();
    } catch (err) {
      console.warn('[ses] başlatılamadı, oyun sessiz sürecek:', err);
      this._failed = true;
      try {
        this.ac?.close?.();
      } catch {
        /* yok say */
      }
      this.ac = null;
    }
    return this.running;
  }

  _init() {
    const AC = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
    if (!AC) throw new Error('WebAudio desteklenmiyor');
    let ac;
    try {
      ac = new AC({ latencyHint: 'interactive' });
    } catch {
      ac = new AC();
    }
    this.ac = ac;
    this.kit = createKit(ac);

    // --- ana zincir
    this.comp = ac.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 14;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.28;
    this.comp.connect(ac.destination);

    this.master = ac.createGain();
    this.master.gain.value = curve(this.masterVol);
    this.master.connect(this.comp);

    this.pauseFilter = ac.createBiquadFilter();
    this.pauseFilter.type = 'lowpass';
    this.pauseFilter.frequency.value = 20000;
    this.pauseFilter.Q.value = 0.5;
    this.pauseFilter.connect(this.master);

    this.duck = ac.createGain();
    this.duck.gain.value = 1;
    this.duck.connect(this.pauseFilter);

    // --- veri yolları
    this.sfxBus = ac.createGain();
    this.sfxBus.gain.value = 1;
    this.sfxBus.connect(this.duck);

    this.musicBus = ac.createGain();
    this.musicBus.gain.value = curve(this.musicVol) * MUSIC_TRIM;
    this.musicDuck = ac.createGain();
    this.musicDuck.gain.value = 1;
    this.musicBus.connect(this.musicDuck).connect(this.duck);

    this.music = new OrganMusic(this.kit, this.musicBus);
    // gemi uğultusu arka planda kalsın: efekt yoluna kısılmış girişle bağlanır
    this.ambBus = ac.createGain();
    this.ambBus.gain.value = AMBIENT_TRIM;
    this.ambBus.connect(this.sfxBus);
    this.ambience = new Ambience(this.kit, this.ambBus);

    this._live.length = 0;
  }

  /** Bağlam çalışır duruma geçtiğinde bekleyen müzik / ortam isteklerini uygula. */
  _onRunning() {
    if (!this.running || this._failed) return;
    try {
      if (this._appliedAmbient !== this.ambient) {
        this._appliedAmbient = this.ambient;
        this.ambience.setMode(this.ambient, this.ambient ? 3 : 2);
      }
      if (this._wantMusic && !this.music.playing) this.music.start(0.8);
    } catch (err) {
      console.warn('[ses] ortam/müzik hatası:', err);
    }
  }

  _bindEvents() {
    const bus = this.ctx?.bus;
    if (!bus) return;
    const surface = () => {
      const loc = this.ctx.player?.location;
      if (!loc) return 'panel';
      if (loc.region === 'corridor') return 'corridor';
      return GRATE_MODULES.has(loc.id) ? 'grate' : 'panel';
    };
    bus.on('player:footstep', (e) => {
      const sprint = !!e?.sprint;
      this.play('footstep', { volume: sprint ? 0.75 : 0.5, surface: surface(), sprint });
    });
    bus.on('player:jump', () => this.play('footstep', { volume: 0.3, surface: surface() }));
    bus.on('player:land', () => this.play('footstep', { volume: 0.6, surface: surface(), land: true }));
    bus.on('door:open', (e) => this.play('door', { position: e?.position, variant: 'open', volume: 0.8 }));
    bus.on('door:close', (e) => this.play('door', { position: e?.position, variant: 'close', volume: 0.8 }));
    bus.on('door:locked', (e) => this.play('door_locked', { position: e?.position }));
    bus.on('state:power_restored', () => {
      this.play('power_up', { volume: 0.9 });
      this.setAmbient('normal');
    });
    bus.on('state:ring_spinning', () => this.play('spin_up', { volume: 0.9 }));
    bus.on('game:start', () => {
      this.setAmbient(this.ctx.state?.is?.('power_restored') ? 'normal' : 'emergency');
      this.startMusic();
    });
    bus.on('ui:pause', (e) => {
      this._paused = !!e?.open;
      if (!this.ac) return;
      const t = this.ac.currentTime;
      this.pauseFilter.frequency.setTargetAtTime(this._paused ? 700 : 20000, t, 0.12);
      this.duck.gain.setTargetAtTime(this._paused ? 0.45 : 1, t, 0.15);
    });
  }

  _bindPage() {
    if (typeof window === 'undefined') return;
    // Tarayıcılar ses için kullanıcı hareketi ister: ilk dokunuş / tuş / tıklamada bağlamı hazırla.
    const onGesture = () => {
      this._gestured = true;
      this.unlock();
      if (this.running) {
        for (const ev of ['pointerdown', 'keydown', 'touchend', 'click']) window.removeEventListener(ev, onGesture, true);
      }
    };
    for (const ev of ['pointerdown', 'keydown', 'touchend', 'click']) window.addEventListener(ev, onGesture, true);
    // Sekme arka plana geçince sesi durdur (özellikle telefonda)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        try {
          window.speechSynthesis?.cancel?.();
        } catch {
          /* yok say */
        }
        if (this.ac && this.ac.state === 'running') {
          this._hiddenSuspend = true;
          this.ac.suspend().catch(() => {});
        }
      } else if (this._hiddenSuspend && this.ac) {
        this._hiddenSuspend = false;
        this.ac.resume().catch(() => {});
      }
    });
  }

  // ===================================================================== efektler
  /**
   * Efekt çal. `position` (THREE.Vector3 | {x,y,z}) verilirse 3B konumlu (PannerNode).
   * @returns {boolean} gerçekten çalındı mı
   */
  play(name, opts = {}) {
    if (!this.running || this._failed) return false;
    const fn = SFX[name];
    if (typeof fn !== 'function') return false;
    opts = opts || {};
    try {
      const ac = this.ac;
      const now = ac.currentTime;

      // --- sınırlamalar
      const live = this._live;
      for (let i = live.length - 1; i >= 0; i--) if (live[i].end < now) live.splice(i, 1);
      if (live.length >= GLOBAL_LIMIT) return false;
      let same = 0;
      for (const v of live) if (v.name === name) same++;
      if (same >= (VOICE_LIMIT[name] ?? VOICE_LIMIT.default)) return false;
      const key = opts.position ? `${name}@` : name;
      const gap = Math.max(MIN_GAP[name] ?? 0, opts.position ? 0 : (DEDUPE[name] ?? 0));
      if (gap && now - (this._last[key] ?? -1e9) < gap) return false;
      this._last[key] = now;

      // --- çıkış zinciri
      let volume = opts.volume ?? 1;
      volume = Math.min(2, Math.max(0, Number.isFinite(volume) ? volume : 1));
      if (volume <= 0) return false;
      const out = ac.createGain();
      out.gain.value = volume;
      const nodes = [out];
      const pos = this._vec(opts.position);
      if (pos) {
        const panner = this._makePanner(pos);
        nodes.push(panner);
        // başka bir bölümdeyse duvarların ardından gelen boğuk ses
        if (this._muffled(pos)) {
          const lp = ac.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.value = 850;
          lp.Q.value = 0.5;
          const dim = ac.createGain();
          dim.gain.value = 0.6;
          out.connect(lp).connect(dim).connect(panner);
          nodes.push(lp, dim);
        } else out.connect(panner);
        panner.connect(this.sfxBus);
      } else out.connect(this.sfxBus);

      const sfxOpts = { ...opts };
      if (name === 'servo' && sfxOpts.duration == null && volume < 0.25) sfxOpts.duration = 0.4;
      const dur = fn(this.kit, out, now + 0.005, sfxOpts) || 0.5;
      live.push({ name, end: now + dur + 0.3 });
      setTimeout(() => {
        for (const n of nodes) {
          try {
            n.disconnect();
          } catch {
            /* zaten bağlı değil */
          }
        }
      }, (dur + 1.2) * 1000);
      return true;
    } catch (err) {
      if (!this._warnedPlay) {
        this._warnedPlay = true;
        console.warn(`[ses] '${name}' çalınamadı:`, err);
      }
      return false;
    }
  }

  _vec(p) {
    if (!p) return null;
    if (Array.isArray(p)) return p.length >= 3 && p.every(Number.isFinite) ? { x: p[0], y: p[1], z: p[2] } : null;
    return Number.isFinite(p.x) && Number.isFinite(p.z) ? { x: p.x, y: Number.isFinite(p.y) ? p.y : 1.2, z: p.z } : null;
  }

  _makePanner(pos) {
    const ac = this.ac;
    const p = ac.createPanner();
    p.panningModel = this.hrtf ? 'HRTF' : 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 2;
    p.maxDistance = 120;
    p.rolloffFactor = 1.1;
    p.coneInnerAngle = 360;
    if (p.positionX) {
      p.positionX.value = pos.x;
      p.positionY.value = pos.y;
      p.positionZ.value = pos.z;
    } else p.setPosition(pos.x, pos.y, pos.z);
    return p;
  }

  /** Ses kaynağı oyuncudan başka bir bölümde ve uzaksa true */
  _muffled(pos) {
    const loc = this.ctx.player?.location;
    const pp = this.ctx.player?.position;
    if (!loc || !pp) return false;
    const d = Math.hypot(pos.x - pp.x, pos.z - pp.z);
    if (d < 6) return false;
    const lr = locate(pos.x, pos.z);
    return lr.index !== loc.index || lr.region !== loc.region;
  }

  // ===================================================================== ortam & müzik
  setAmbient(name) {
    const mode = name === 'emergency' || name === 'normal' ? name : null;
    this.ambient = mode;
    if (this.running) this._onRunning();
  }

  startMusic() {
    this._wantMusic = true;
    if (this.running) this._onRunning();
  }

  stopMusic() {
    this._wantMusic = false;
    this.music?.stop();
  }

  setMasterVolume(v) {
    this.masterVol = clamp01(v);
    if (this.ac) this.master.gain.setTargetAtTime(curve(this.masterVol), this.ac.currentTime, 0.04);
    if (this.masterVol <= 0.001) this.stopSpeaking();
  }

  setMusicVolume(v) {
    this.musicVol = clamp01(v);
    if (this.ac) this.musicBus.gain.setTargetAtTime(curve(this.musicVol) * MUSIC_TRIM, this.ac.currentTime, 0.08);
  }

  // ===================================================================== konuşma
  _refreshVoice() {
    try {
      const list = window.speechSynthesis?.getVoices?.() || [];
      const tr = list.filter((v) => /^tr([-_]|$)/i.test(v.lang || ''));
      this._voice = tr.find((v) => /tr[-_]TR/i.test(v.lang) && v.localService) || tr.find((v) => /tr[-_]TR/i.test(v.lang)) || tr[0] || null;
    } catch {
      this._voice = null;
    }
    return this._voice;
  }

  stopSpeaking() {
    const s = this._speech;
    if (!s) return;
    s.finish?.();
  }

  /**
   * TARS konuşması: önce robot "blip", sonra tr-TR sentez sesi (alçak perde). Sesi yoksa kısık "mırıltı"
   * ile tahmini sürede biter. Promise konuşma bitince çözülür; hata fırlatmaz.
   */
  speak(text, opts = {}) {
    text = String(text ?? '').trim();
    if (!text) return Promise.resolve();
    this.stopSpeaking();
    const chars = text.length;
    const est = Math.min(30, Math.max(1, 0.7 + chars * 0.068));
    const tok = { done: false, timers: [], bus: null };
    const promise = new Promise((resolve) => {
      tok.finish = () => {
        if (tok.done) return;
        tok.done = true;
        tok.timers.forEach(clearTimeout);
        try {
          window.speechSynthesis?.cancel?.();
        } catch {
          /* yok say */
        }
        if (tok.bus && this.ac) {
          try {
            tok.bus.gain.cancelScheduledValues(this.ac.currentTime);
            tok.bus.gain.setTargetAtTime(0, this.ac.currentTime, 0.03);
            setTimeout(() => {
              try {
                tok.bus.disconnect();
              } catch {
                /* yok say */
              }
            }, 400);
          } catch {
            /* yok say */
          }
        }
        if (this._speech === tok) this._speech = null;
        resolve();
      };
    });
    this._speech = tok;

    const robot = (opts.voice ?? 'tars') === 'tars';
    if (robot) this.play('blip', { volume: 1 });

    const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    const canTalk = !!synth && typeof SpeechSynthesisUtterance !== 'undefined' && this.masterVol > 0.001;
    const voice = canTalk ? this._refreshVoice() : null;
    // güvenlik: hiçbir olay gelmese de çözülsün
    tok.timers.push(setTimeout(() => tok.finish(), (voice ? est * 2.2 + 3 : est) * 1000 + 250));

    if (voice) {
      const chunks = splitSentences(text);
      let i = 0;
      const next = () => {
        if (tok.done) return;
        if (i >= chunks.length) return tok.finish();
        try {
          const u = new SpeechSynthesisUtterance(chunks[i++]);
          u.voice = voice;
          u.lang = voice.lang || 'tr-TR';
          u.pitch = opts.pitch ?? (robot ? 0.6 : 1);
          u.rate = opts.rate ?? 1.05;
          u.volume = Math.min(1, Math.pow(this.masterVol, 0.7) * 1.1);
          u.onend = () => next();
          u.onerror = () => tok.finish();
          if (i === 1) synth.cancel();
          synth.speak(u);
        } catch {
          tok.finish();
        }
      };
      tok.timers.push(setTimeout(next, robot ? 170 : 0));
    } else if (this.running && this.masterVol > 0.001) {
      this._mumble(tok, text, est, robot ? 0.2 : 0.05);
    }
    return promise;
  }

  /**
   * Konuşma sesi yoksa yedek: gerçek harflerden (ünlüler) ünlü-formant "mırıltısı".
   * Kısık ve monoton; yalnızca altyazıya eşlik eden bir robot dili hissi verir.
   */
  _mumble(tok, text, est, delay = 0.2) {
    const ac = this.ac;
    const t0 = ac.currentTime + delay;
    const bus = ac.createGain();
    bus.gain.value = 0.9;
    bus.connect(this.sfxBus);
    tok.bus = bus;
    const kit = this.kit;
    const low = text.toLocaleLowerCase('tr-TR');
    const n = low.length;
    const span = Math.max(0.4, est - delay - 0.35);
    let syl = 0;
    for (let i = 0; i < n && syl < 140; i++) {
      const ch = low[i];
      const t = t0 + (i / n) * span;
      const f = VOWELS[ch];
      if (f) {
        const f0 = 104 + ((i * 7) % 5) * 3;
        const dur = Math.min(0.11, (span / n) * 2.4);
        const g = ac.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(1, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        const o = ac.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f0;
        for (const [fc, q, gain] of [
          [f[0], 6, 1],
          [f[1], 8, 0.55],
        ]) {
          const bp = ac.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.value = fc;
          bp.Q.value = q;
          const bg = ac.createGain();
          bg.gain.value = gain * 0.55;
          o.connect(bp).connect(bg).connect(g);
        }
        g.connect(bus);
        o.start(t);
        o.stop(t + dur + 0.02);
        syl++;
      } else if ('sşfhçzjc'.includes(ch)) {
        noise(kit, bus, { t, dur: 0.045, gain: 0.05, type: 'highpass', freq: 3800, Q: 0.8 });
      }
    }
  }

  // ===================================================================== her kare
  update(dt) {
    if (!this.ac || this._failed) return;
    const ac = this.ac;
    if (ac.state !== 'running') {
      // dokunuş sonrası askıda kaldıysa (iOS "interrupted" vb.) zaman zaman yeniden dene
      if (this._gestured && !this._hiddenSuspend) {
        this._resumeAt -= dt;
        if (this._resumeAt <= 0) {
          this._resumeAt = 1;
          ac.resume().then(() => this._onRunning()).catch(() => {});
        }
      }
      return;
    }
    this._onRunning();
    this._updateListener();
    try {
      this.music.update();
      this.ambience.update();
    } catch (err) {
      if (!this._warnedUpd) {
        this._warnedUpd = true;
        console.warn('[ses] güncelleme hatası:', err);
      }
    }
    // konuşurken müziği kıs
    const talk = this._speech ? 0.45 : 1;
    if (talk !== this._duckT) {
      this._duckT = talk;
      this.musicDuck.gain.setTargetAtTime(talk, ac.currentTime, 0.25);
    }
  }

  /** Dinleyiciyi oyuncu kamerasına eşitle */
  _updateListener() {
    const cam = this.ctx.camera;
    const L = this.ac.listener;
    if (!cam || !L) return;
    cam.updateMatrixWorld();
    const e = cam.matrixWorld.elements;
    if (L.positionX) {
      L.positionX.value = e[12];
      L.positionY.value = e[13];
      L.positionZ.value = e[14];
      L.forwardX.value = -e[8];
      L.forwardY.value = -e[9];
      L.forwardZ.value = -e[10];
      L.upX.value = e[4];
      L.upY.value = e[5];
      L.upZ.value = e[6];
    } else {
      L.setPosition(e[12], e[13], e[14]);
      L.setOrientation(-e[8], -e[9], -e[10], e[4], e[5], e[6]);
    }
  }
}
