import * as THREE from 'three';
import { moduleRoute } from './ringNav.js';
import { INTRO_LINE, EVENTS } from './tarsLines.js';
import { MillerSequence } from './story/MillerSequence.js';
import { ENDING_TEXT as ENDING_TEXT_2 } from './story/texts.js';

/**
 * Görev zinciri ve giriş sinematiği. Bayraklar ve akış: docs/ARCHITECTURE.md §11.
 *
 *   missions.start({ skipIntro })
 *   missions.currentTargetId          hedef modül id'si veya null
 *   missions.getObjective()           { flag, text, baseText, targetId, hint, spokenHint }
 *
 * Bölüm 2 (Miller gezegeni): `missions.story` (MillerSequence) sekansları yürütür; adımlar CHAIN'in sonunda.
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
  { flag: 'talked_tars', text: 'TARS ile konuş', target: 'cryo' },
  { flag: 'power_restored', text: 'Motor modülünde sigorta panelini sıfırla, enerjiyi geri getir', target: 'engine' },
  { flag: 'messages_read', text: 'İletişim modülünde Dünya’dan gelen mesajları dinle', target: 'comms' },
  { flag: 'ring_spinning', text: 'Kumanda modülünde halka dönüşünü başlat', target: 'command' },
  { flag: 'blackhole_observed', text: 'Gözlem güvertesinden teleskopla Gargantua’yı incele', target: 'observation' },
  // --- Bölüm 2 (docs/ARCHITECTURE.md §15): bu adımlar, sonraki bir adımın bayrağı geldiyse tamamlanmış sayılır
  { flag: 'ranger_launched', text: 'Hava kilidinde iniş ekibine katıl, Ranger’a bin', target: 'airlock', part2: true },
  { flag: 'miller_landed', text: 'Ranger Miller gezegenine iniyor…', target: null, part2: true },
  { flag: 'beacon_found', text: 'Enkazdaki veri kaydedicisini bul', target: null, part2: true },
  { flag: 'ela_rescued', text: 'Enkaza sıkışan Ela’ya yardım et', target: null, part2: true },
  { flag: 'wave_escaped', text: 'Dalga gelmeden Ranger’a koş!', target: null, part2: true },
  { flag: 'returned_to_ship', text: 'Ranger kalkıyor — AZİM’e dönülüyor…', target: null, part2: true },
  { flag: 'rami_met', text: 'Yaşlanmış Rami ile konuş', target: 'airlock', part2: true },
  { flag: 'messages_23y_read', text: 'İletişim modülünde 23 yıllık mesajları dinle', target: 'comms', part2: true },
];

// Bölüm 1 kapanışı artık gösterilmez; bitiş metni story/texts.js içinde (ENDING_TEXT_2).

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
    /** Bölüm 2 anlatısı (Ranger, Miller, dalga, dönüş) */
    this.story = new MillerSequence(ctx);

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
    this.story?.onStart();
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
    // Zamanlama (oyun zamanı, sn): toplam ~14,5 sn
    this._timeline = [
      [0.1, () => audio?.play?.('hiss', { volume: 0.6 })],
      [0.7, () => sys('Hiper-uyku döngüsü tamamlandı…', 3000)],
      [1.6, () => ui.fade?.(false, 3600)],
      [3.8, () => sys('Yaşamsal belirtiler kararlı. Vücut ısısı 36,2 °C.', 2600)],
      [6.4, () => {
        sys('Uyarı: ana enerji devre dışı. Acil durum gücü etkin.', 2800);
        audio?.play?.('alarm', { volume: 0.25 });
      }],
      [8.4, () => {
        if (!tars) return;
        const head = tars.headPosition(new THREE.Vector3());
        const eye = new THREE.Vector3(p.x, 1.65, p.z);
        player.faceDirection(head.sub(eye), 2.2);
        tars.setExpression('happy', 4);
      }],
      [9.8, () => tars?.gesture('wave')],
      [10.2, () => tars?.say(INTRO_LINE, { force: true })],
      [14.5, () => this._endIntro()],
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
    const p2 = CHAIN.filter((c) => c.part2);
    for (const step of CHAIN) {
      if (st.is(step.flag)) continue;
      // Bölüm 2: daha sonraki bir adımın bayrağı geldiyse bu adım da yapılmış sayılır
      if (step.part2 && p2.slice(p2.indexOf(step) + 1).some((c) => st.is(c.flag))) continue;
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
    if (!route) return { steps: -1, short: 'yol kapalı', hint: 'yol kapalı', spoken: 'şu an oraya giden yol kapalı' };
    if (route.steps === 0) return { steps: 0, short: 'buradasın', hint: 'buradasın', spoken: 'zaten oradasın' };
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
    const short = route.steps === 1 ? 'bitişik modül' : `${route.steps} modül uzakta`;
    const spoken =
      route.steps === 1
        ? `hemen yandaki modül, ${viaName} tarafı`
        : `${viaName} yönünden ${route.steps} modül`;
    return { steps: route.steps, short, hint, spoken, viaId: layout.MODULE_IDS[route.via], dir: route.dir };
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
    let hint = ''; // ayrıntılı ipucu (getObjective / olay yükü)
    let short = ''; // ekranda görünen kısa ipucu: yalnızca anlamlı durumlarda değişir
    let spoken = '';
    // Kapanış tamamlandıktan sonra kalan adımlar (bayraklar farklı sırayla geldiyse) isteğe bağlıdır
    if (step && !state.is('mission_complete')) {
      flag = step.flag;
      base = step.text;
      targetId = step.target;
      if (step.flag === 'talked_tars') {
        const tars = this.ctx.tars;
        if (tars) {
          const p = this.ctx.player.position;
          const d = Math.hypot(tars.position.x - p.x, tars.position.z - p.z);
          short = d < 6 ? 'TARS yanında' : 'TARS uzakta';
          hint = d < 6 ? 'TARS yanında' : `TARS ${Math.round(d)} m uzakta`;
        }
      } else {
        const g = this._guidance(targetId);
        if (g) {
          hint = g.hint;
          short = g.short;
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
          short = g.short;
          spoken = g.spoken;
        }
      } else {
        base = 'Serbest dolaşım — gemi senin';
      }
    } else {
      // Enerji, halka ve gözlem tamam: kapanış bir-iki saniye sonra (açık modal varsa daha sonra) gelir
      base = 'Son kontroller yapılıyor…';
    }
    const text = base ? (short ? `${base} · ${short}` : base) : null;
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
    if (!(state.is('ring_spinning') && state.is('blackhole_observed') && state.is('messages_23y_read'))) {
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
    ui.showEnding?.(ENDING_TEXT_2);
    const tars = this.ctx.tars;
    if (tars) tars.say(tars.humor >= 30 ? EVENTS.mission_complete[0] : EVENTS.mission_complete[1], { delay: 1.5, priority: 4, expires: 600 });
    this._recheck = 0;
  }

  update(dt) {
    if (!this.started) return;
    this.story?.update(dt);
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
