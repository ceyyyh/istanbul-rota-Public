import * as THREE from 'three';
import { moduleRoute } from './ringNav.js';
import { INTRO_LINE, EVENTS } from './tarsLines.js';

/**
 * Görev zinciri ve giriş sinematiği. Bayraklar ve akış: docs/ARCHITECTURE.md §11.
 *
 *   missions.start({ skipIntro })
 *   missions.currentTargetId          hedef modül id'si veya null
 *   missions.getObjective()           { flag, text, baseText, targetId, hint, spokenHint }
 *
 * Olay: bus 'mission:objective' { text, targetId, baseText, hint, flag } — metin veya hedef her değiştiğinde.
 * Bayraklar herhangi bir sırayla gelebilir; görev her zaman zincirdeki ilk eksik adımdır.
 */

/** Modül adları (rehberlik metinleri için) */
const NAMES = {
  command: 'Kumanda',
  cryo: 'Hiper-Uyku',
  quarters: 'Yaşam Alanı',
  medical: 'Revir',
  lab: 'Laboratuvar',
  hydro: 'Hidroponik',
  engine: 'Motor',
  robotics: 'Robotik',
  cargo: 'Kargo',
  airlock: 'Hava Kilidi',
  comms: 'İletişim',
  observation: 'Gözlem',
};

export const CHAIN = [
  { flag: 'talked_tars', text: 'TARS ile konuş', target: null },
  { flag: 'power_restored', text: 'Motor modülünde sigorta panelini sıfırla, enerjiyi geri getir', target: 'engine' },
  { flag: 'messages_read', text: 'İletişim modülünde Dünya’dan gelen mesajları dinle', target: 'comms' },
  { flag: 'ring_spinning', text: 'Kumanda modülünde halka dönüşünü başlat', target: 'command' },
  { flag: 'blackhole_observed', text: 'Gözlem güvertesinden teleskopla Gargantua’yı incele', target: 'observation' },
];

const ENDING_TEXT = [
  'AZİM yeniden nefes alıyor.',
  'Halka dönüyor; ayaklarının altında yine bir “aşağı” var. Dünya’dan gelen sesler geride kaldı ama kaybolmadı — onları yanında taşıyorsun.',
  'Önünde haritası çizilmemiş bir karanlık, ufkunda ışığı bile bırakmayan bir dev var. Yine de buradasın.',
  'Çünkü bazı yolculuklar, varılacak yer bulunduğunda değil; vazgeçildiğinde biter.',
  'Ve sen vazgeçmedin.',
].join('\n\n');

export class Missions {
  constructor(ctx) {
    this.ctx = ctx;
    this.started = false;
    this.introRunning = false;
    this.currentTargetId = null;
    this.current = null;
    this._lastText = undefined;
    this._lastTarget = undefined;
    this._recheck = 0;
    this._completeAt = null;
    this._endingShown = false;
    this._timeline = [];
    this._t = 0;

    const { bus } = ctx;
    bus.on('state:changed', () => {
      this._recheck = 0;
    });
    bus.on('player:module', () => {
      this._recheck = 0;
    });
  }

  /** Oyun başladığında main.js çağırır. */
  start({ skipIntro = false } = {}) {
    if (this.started) return;
    this.started = true;
    const { state } = this.ctx;
    if (skipIntro || state.is('intro_done')) {
      state.set('intro_done', true);
      this._refresh(true);
      return;
    }
    this._runIntro();
  }

  // ------------------------------------------------------------------ giriş sinematiği

  _runIntro() {
    const { ctx } = this;
    const { ui, player, tars, audio, layout, state } = ctx;
    this.introRunning = true;
    ui.setObjective?.(null);
    ui.fade?.(true, 0);
    player.frozen = true;
    if (tars) {
      tars.scripted = true;
      const pp = player.position;
      tars.faceTowards(pp.x, pp.z, true);
    }

    // Bakış: boş kapsüle (yerel x=-2.5, z=-2.3), aşağı doğru
    const ci = layout.moduleIndexById('cryo');
    const pod = layout.localToWorld(ci, -2.5, -2.3);
    const p = player.position;
    const dir = new THREE.Vector3(pod.x - p.x, 0.75 - 1.65, pod.z - p.z).normalize();
    player.yaw = Math.atan2(-dir.x, -dir.z);
    player.pitch = Math.asin(dir.y);
    player._face = null;

    const sys = (text, ms) => ui.subtitle?.('SİSTEM', text, ms);
    this._t = 0;
    this._timeline = [
      [0.1, () => audio?.play?.('hiss', { volume: 0.6 })],
      [0.7, () => sys('Hiper-uyku döngüsü tamamlandı…', 3200)],
      [1.6, () => ui.fade?.(false, 3800)],
      [4.2, () => sys('Yaşamsal belirtiler kararlı. Vücut ısısı 36,2 °C.', 2800)],
      [7.2, () => {
        sys('Uyarı: ana enerji devre dışı. Acil durum gücü etkin.', 3000);
        audio?.play?.('alarm', { volume: 0.25 });
      }],
      [9.6, () => {
        if (!tars) return;
        const head = tars.headPosition(new THREE.Vector3());
        const eye = new THREE.Vector3(p.x, 1.65, p.z);
        player.faceDirection(head.sub(eye), 2.4);
        tars.setExpression('happy', 4);
      }],
      [11.2, () => tars?.gesture('wave')],
      [11.6, () => tars?.say(INTRO_LINE, { force: true })],
      [17.5, () => this._endIntro()],
    ];
  }

  _endIntro() {
    if (!this.introRunning) return;
    const { ctx } = this;
    this.introRunning = false;
    this._timeline = [];
    ctx.player.frozen = false;
    if (ctx.tars) ctx.tars.scripted = false;
    ctx.ui.fade?.(false, 400);
    ctx.state.set('intro_done', true);
    this._refresh(true);
    ctx.ui.toast?.('TARS’a bak ve [E] ile konuş', 4500);
  }

  /** Sinematiği atla (Boşluk / E) */
  skipIntro() {
    if (!this.introRunning) return;
    const { tars, player } = this.ctx;
    if (tars) {
      const head = tars.headPosition(new THREE.Vector3());
      const p = player.position;
      player.faceDirection(head.sub(new THREE.Vector3(p.x, 1.65, p.z)), 0.4);
    }
    this._endIntro();
  }

  // ------------------------------------------------------------------ görev zinciri

  /** Zincirdeki ilk eksik adım (talked_tars, enerji zaten geldiyse atlanır). */
  _currentStep() {
    const st = this.ctx.state;
    for (const step of CHAIN) {
      if (st.is(step.flag)) continue;
      if (step.flag === 'talked_tars' && st.is('power_restored')) continue;
      if (step.flag === 'messages_read' && st.is('ring_spinning') && st.is('blackhole_observed')) continue;
      return step;
    }
    return null;
  }

  /** Kilitli kapısı olan modüller (hedef hariç geçilemez) */
  _lockedModules() {
    const set = new Set();
    for (const d of this.ctx.doors || []) {
      if (!d.locked || !d.position) continue;
      const loc = this.ctx.layout.locate(d.position.x, d.position.z);
      set.add(loc.index);
    }
    return set;
  }

  /** Rehberlik: oyuncu hedeften kaç modül uzakta ve hangi yönde */
  _guidance(targetId) {
    const { layout, player } = this.ctx;
    if (!targetId) return null;
    const n = layout.MODULE_COUNT;
    const to = layout.moduleIndexById(targetId);
    const loc = player.location || layout.locate(player.position.x, player.position.z);
    const from = loc.index;
    const locked = this._lockedModules();
    const route = moduleRoute(from, to, n, (i) => locked.has(i));
    if (!route) return { steps: -1, hint: 'yol kapalı', spoken: 'şu an oraya giden yol kapalı' };
    if (route.steps === 0) return { steps: 0, hint: 'buradasın', spoken: 'zaten oradasın' };
    const viaName = NAMES[layout.MODULE_IDS[route.via]];
    // yön: oyuncunun bakışına göre ileri/geri (modül yerel +X = sonraki modül)
    const a = layout.moduleAngle(from);
    const tx = -Math.sin(a) * route.dir;
    const tz = Math.cos(a) * route.dir;
    const f = player.getForward(new THREE.Vector3());
    const dot = (f.x * tx + f.z * tz) / (Math.hypot(f.x, f.z) || 1);
    let rel;
    if (dot > 0.45) rel = 'ileride';
    else if (dot < -0.45) rel = 'arkanda';
    else rel = `${viaName} tarafında`;
    const hint = route.steps === 1 ? `bitişik modül, ${rel}` : `${route.steps} modül ${rel}`;
    const spoken =
      route.steps === 1
        ? `hemen yandaki modül, ${viaName} tarafı`
        : `${viaName} yönünden ${route.steps} modül`;
    return { steps: route.steps, hint, spoken, viaId: layout.MODULE_IDS[route.via], dir: route.dir };
  }

  getObjective() {
    return this.current || { flag: null, text: null, baseText: null, targetId: null, hint: '', spokenHint: '' };
  }

  _refresh(force = false) {
    const { ui, bus, state } = this.ctx;
    if (!this.started || this.introRunning) return;
    const step = this._currentStep();
    let flag = null;
    let base = null;
    let targetId = null;
    let hint = '';
    let spoken = '';
    if (step) {
      flag = step.flag;
      base = step.text;
      targetId = step.target;
      if (step.flag === 'talked_tars') {
        const tars = this.ctx.tars;
        if (tars) {
          const p = this.ctx.player.position;
          const d = Math.hypot(tars.position.x - p.x, tars.position.z - p.z);
          hint = d < 6 ? 'TARS yanında' : `TARS ${Math.round(d)} m uzakta`;
        }
      } else {
        const g = this._guidance(targetId);
        if (g) {
          hint = g.hint;
          spoken = g.spoken;
        }
      }
    } else if (state.is('mission_complete')) {
      if (!state.is('messages_read')) {
        flag = 'messages_read';
        base = '(İsteğe bağlı) İletişim modülünde Dünya’dan gelen mesajları dinle';
        targetId = 'comms';
        const g = this._guidance(targetId);
        if (g) {
          hint = g.hint;
          spoken = g.spoken;
        }
      } else {
        base = 'Serbest dolaşım — gemi senin';
      }
    }
    const text = base ? (hint ? `${base} · ${hint}` : base) : null;
    this.current = { flag, text, baseText: base, targetId, hint, spokenHint: spoken };
    this.currentTargetId = targetId;
    if (force || text !== this._lastText || targetId !== this._lastTarget) {
      this._lastText = text;
      this._lastTarget = targetId;
      ui.setObjective?.(text);
      bus.emit('mission:objective', { text, targetId, baseText: base, hint, flag });
    }
  }

  _checkCompletion(dt) {
    const { state, ui } = this.ctx;
    if (this._endingShown) return;
    if (!(state.is('ring_spinning') && state.is('blackhole_observed'))) {
      this._completeAt = null;
      return;
    }
    // açık terminal/diyalog kapanınca kısa bir bekleme, sonra kapanış
    if (ui.isModalOpen?.()) {
      this._completeAt = null;
      return;
    }
    if (this._completeAt === null) this._completeAt = 2.0;
    this._completeAt -= dt;
    if (this._completeAt > 0) return;
    this._endingShown = true;
    state.set('mission_complete', true);
    this.ctx.audio?.play?.('success', { volume: 0.5 });
    ui.showEnding?.(ENDING_TEXT);
    const tars = this.ctx.tars;
    if (tars) tars.say(tars.humor >= 30 ? EVENTS.mission_complete[0] : EVENTS.mission_complete[1], { delay: 1.5, priority: 4, expires: 600 });
    this._recheck = 0;
  }

  update(dt) {
    if (!this.started) return;
    if (this.introRunning) {
      this._t += dt;
      while (this._timeline.length && this._timeline[0][0] <= this._t) {
        const [, fn] = this._timeline.shift();
        try {
          fn();
        } catch (err) {
          console.error('[görev] sinematik hatası:', err);
        }
      }
      const input = this.ctx.input;
      if (this._t > 1.0 && (input.actionPressed?.('jump') || input.actionPressed?.('interact'))) this.skipIntro();
      return;
    }
    this._checkCompletion(dt);
    this._recheck -= dt;
    if (this._recheck <= 0) {
      this._recheck = 0.25;
      this._refresh();
    }
  }
}
