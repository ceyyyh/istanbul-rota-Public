/**
 * Prosedürel müzik ve ortam sesleri (Ajan 6).
 *
 * OrganMusic: ağır, sabırlı org benzeri pedal akorları (toplamsal dalga + alçak geçiren filtre,
 *   yavaş atak, katedral yankısı). Özgün 8 akorluk yürüyüş (~76 sn döngü); bazı bölümlerde
 *   ~1.25 sn aralıklı yumuşak saat tıkırtısı.
 * Ambience: gemi uğultusu (filtrelenmiş kahverengi gürültü + alçak sinüsler + havalandırma),
 *   'emergency' modunda yavaş alarm darbeleri.
 *
 * Zamanlama: update() her karede çağrılır; sesler ileriye dönük (lookahead) planlanır.
 */
import { noise, tone } from './synth.js';

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** Akor yürüyüşü: bas (pedal), akor sesleri, isteğe bağlı üst ses (MIDI). */
const PROGRESSION = [
  { bass: 33, notes: [45, 52, 59, 60] }, //            Lm(add9)
  { bass: 29, notes: [41, 52, 57, 59] }, //            Fa maj7(#11)
  { bass: 31, notes: [43, 48, 52, 55], top: 76 }, //   Do/Sol  + Mi
  { bass: 28, notes: [40, 45, 47, 52] }, //            Mi sus4
  { bass: 33, notes: [45, 52, 59, 60], top: 71 }, //   Lm(add9) + Si
  { bass: 29, notes: [41, 50, 57, 60, 64] }, //        Rem9/Fa
  { bass: 28, notes: [40, 48, 55, 59, 62], top: 69 }, // Do maj9/Mi + La
  { bass: 28, notes: [40, 47, 52, 56, 59] }, //        Mi (majör, döngüyü açık bırakır)
];
const CHORD_LEN = 9.5; // sn
const ATTACK = 3.6;
const RELEASE = 4.2;
const TICK_EVERY = 1.25;
/** Tıkırtının duyulduğu akorlar (döngü içi indeks) */
const TICK_CHORDS = new Set([2, 3, 4, 5]);

export class OrganMusic {
  constructor(kit, out) {
    this.kit = kit;
    const ac = kit.ac;
    this.ac = ac;
    // dry + yankı
    this.input = ac.createGain();
    this.input.gain.value = 1;
    const dry = ac.createGain();
    dry.gain.value = 0.55;
    const wet = ac.createGain();
    wet.gain.value = 0.75;
    const conv = ac.createConvolver();
    conv.buffer = kit.reverbIR;
    this.input.connect(dry).connect(out);
    this.input.connect(conv).connect(wet).connect(out);
    // tıkırtı veri yolu (kuru, hafif yankı)
    this.tickBus = ac.createGain();
    this.tickBus.gain.value = 0;
    this.tickBus.connect(out);
    const tickWet = ac.createGain();
    tickWet.gain.value = 0.25;
    this.tickBus.connect(tickWet).connect(conv);

    this.playing = false;
    this.nextChord = 0;
    this.chordIndex = 0;
    this.nextTick = 0;
    this._tickOn = false;
    this._tock = false;
  }

  start(delay = 0.6) {
    if (this.playing) return;
    this.playing = true;
    const t = this.ac.currentTime + delay;
    this.nextChord = t;
    this.nextTick = t + TICK_EVERY;
    this.chordIndex = 0;
  }

  stop() {
    this.playing = false;
    this.tickBus.gain.setTargetAtTime(0, this.ac.currentTime, 0.4);
  }

  update() {
    if (!this.playing) return;
    const now = this.ac.currentTime;
    // sekme arka plandaydı vb.: zamanlamayı yeniden hizala
    if (this.nextChord < now - 2) {
      this.nextChord = now + 0.3;
      this.nextTick = now + TICK_EVERY;
    }
    while (this.nextChord < now + 1.5) {
      this._scheduleChord(PROGRESSION[this.chordIndex % PROGRESSION.length], this.nextChord);
      const on = TICK_CHORDS.has(this.chordIndex % PROGRESSION.length);
      if (on !== this._tickOn) {
        this._tickOn = on;
        const g = this.tickBus.gain;
        g.cancelScheduledValues(this.nextChord);
        g.setTargetAtTime(on ? 1 : 0, this.nextChord, on ? 2.5 : 1.8);
      }
      this.chordIndex++;
      this.nextChord += CHORD_LEN;
    }
    while (this.nextTick < now + 0.4) {
      this._tick(this.nextTick);
      this.nextTick += TICK_EVERY;
    }
  }

  _scheduleChord(ch, t) {
    const ac = this.ac;
    const end = t + CHORD_LEN + RELEASE * 0.4;
    const relStart = t + CHORD_LEN - 0.6;
    // akor zarfı + filtre "nefesi"
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + ATTACK);
    g.gain.setValueAtTime(1, relStart);
    g.gain.setTargetAtTime(0, relStart, RELEASE / 4);
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 0.4;
    f.frequency.setValueAtTime(380, t);
    f.frequency.linearRampToValueAtTime(1500, t + ATTACK + 1);
    f.frequency.linearRampToValueAtTime(820, relStart + 1);
    g.connect(f).connect(this.input);

    const stopAt = end + RELEASE;
    const voices = ch.notes.length;
    const vg = 0.075 / Math.sqrt(voices);
    for (const m of ch.notes) {
      for (const det of [-4, 4]) this._osc(this.kit.organWave, mtof(m), det, vg, g, t, stopAt);
    }
    // pedal bas: daha yavaş atak, daha uzun
    const pg = ac.createGain();
    pg.gain.setValueAtTime(0, t);
    pg.gain.linearRampToValueAtTime(0.11, t + ATTACK * 1.3);
    pg.gain.setValueAtTime(0.11, relStart);
    pg.gain.setTargetAtTime(0, relStart + 0.4, RELEASE / 3.5);
    pg.connect(this.input);
    this._osc(this.kit.pedalWave, mtof(ch.bass), 0, 1, pg, t, stopAt + 1);
    this._osc(this.kit.pedalWave, mtof(ch.bass + 12), 3, 0.35, pg, t, stopAt + 1);

    // üst ses: akorun ortasında beliren uzun, yalnız bir nota
    if (ch.top) {
      const tt = t + CHORD_LEN * 0.35;
      const dur = CHORD_LEN * 0.7;
      const ug = ac.createGain();
      ug.gain.setValueAtTime(0, tt);
      ug.gain.linearRampToValueAtTime(0.03, tt + 1.6);
      ug.gain.setTargetAtTime(0, tt + dur - 1.2, 1.1);
      ug.connect(f);
      this._osc(null, mtof(ch.top), 0, 1, ug, tt, tt + dur + 5, 'sine');
      this._osc(null, mtof(ch.top) * 2, 2, 0.12, ug, tt, tt + dur + 5, 'sine');
    }
    // grafiği temizle
    setTimeout(() => {
      try {
        g.disconnect();
        pg.disconnect();
      } catch {
        /* yok say */
      }
    }, (stopAt - ac.currentTime + 2) * 1000);
  }

  _osc(wave, freq, detune, gain, out, t, stopAt, type) {
    const o = this.ac.createOscillator();
    if (wave) o.setPeriodicWave(wave);
    else o.type = type || 'sine';
    o.frequency.value = freq;
    o.detune.value = detune;
    let node = o;
    if (gain !== 1) {
      const g = this.ac.createGain();
      g.gain.value = gain;
      o.connect(g);
      node = g;
    }
    node.connect(out);
    o.start(t);
    o.stop(stopAt);
  }

  _tick(t) {
    // tik-tak: iki tona dönüşümlü
    this._tock = !this._tock;
    const f = this._tock ? 2600 : 2200;
    noise(this.kit, this.tickBus, { t, dur: 0.012, gain: 0.05, freq: f, Q: 5 });
    tone(this.kit, this.tickBus, { t, freq: f * 0.62, dur: 0.03, gain: 0.012 });
  }
}

/** Ortam: uğultu + havalandırma + acil durum darbeleri */
export class Ambience {
  constructor(kit, out) {
    this.kit = kit;
    const ac = kit.ac;
    this.ac = ac;
    this.out = ac.createGain();
    this.out.gain.value = 0;
    this.out.connect(out);
    this.mode = null;
    this.started = false;
    this.nextPulse = 0;
  }

  _start() {
    if (this.started) return;
    this.started = true;
    const ac = this.ac;
    const t = ac.currentTime;
    // uğultu: kahverengi gürültü → alçak geçiren
    const hum = ac.createBufferSource();
    hum.buffer = this.kit.brown;
    hum.loop = true;
    this.humFilter = ac.createBiquadFilter();
    this.humFilter.type = 'lowpass';
    this.humFilter.frequency.value = 150;
    this.humFilter.Q.value = 0.7;
    this.humGain = ac.createGain();
    this.humGain.gain.value = 0;
    hum.connect(this.humFilter).connect(this.humGain).connect(this.out);
    hum.start(t);
    // yavaş dalgalanma
    const lfo = ac.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = ac.createGain();
    lfoG.gain.value = 35;
    lfo.connect(lfoG).connect(this.humFilter.frequency);
    lfo.start(t);
    // makine tonları (hafif akortsuz)
    this.toneGain = ac.createGain();
    this.toneGain.gain.value = 0;
    this.toneGain.connect(this.out);
    for (const [f, g] of [
      [55, 1],
      [110.4, 0.5],
      [165.2, 0.18],
      [219.6, 0.08],
    ]) {
      const o = ac.createOscillator();
      o.frequency.value = f;
      const og = ac.createGain();
      og.gain.value = g;
      o.connect(og).connect(this.toneGain);
      o.start(t);
    }
    // havalandırma
    const air = ac.createBufferSource();
    air.buffer = this.kit.noise;
    air.loop = true;
    const af = ac.createBiquadFilter();
    af.type = 'bandpass';
    af.frequency.value = 850;
    af.Q.value = 0.45;
    this.airGain = ac.createGain();
    this.airGain.gain.value = 0;
    air.connect(af).connect(this.airGain).connect(this.out);
    air.start(t, 0.3);
    // acil durum darbeleri için veri yolu
    this.pulseBus = ac.createGain();
    this.pulseBus.gain.value = 0;
    this.pulseBus.connect(this.out);
  }

  setMode(mode, fade = 2.5) {
    if (mode) this._start();
    if (!this.started) return;
    this.mode = mode;
    const t = this.ac.currentTime;
    const tc = Math.max(0.05, fade / 3);
    const set = (p, v) => {
      p.cancelScheduledValues(t);
      p.setTargetAtTime(v, t, tc);
    };
    const preset =
      mode === 'normal'
        ? { out: 1, hum: 0.34, tone: 0.022, air: 0.05, cut: 170, pulse: 0 }
        : mode === 'emergency'
          ? { out: 1, hum: 0.4, tone: 0.012, air: 0.014, cut: 115, pulse: 1 }
          : { out: 0, hum: 0, tone: 0, air: 0, cut: 150, pulse: 0 };
    set(this.out.gain, preset.out);
    set(this.humGain.gain, preset.hum);
    set(this.toneGain.gain, preset.tone);
    set(this.airGain.gain, preset.air);
    set(this.humFilter.frequency, preset.cut);
    set(this.pulseBus.gain, preset.pulse);
    if (mode === 'emergency' && this.nextPulse < t) this.nextPulse = t + 1.5;
  }

  update() {
    if (!this.started || this.mode !== 'emergency') return;
    const now = this.ac.currentTime;
    if (this.nextPulse < now - 2) this.nextPulse = now + 0.5;
    while (this.nextPulse < now + 0.5) {
      this._pulse(this.nextPulse);
      this.nextPulse += 4.2;
    }
  }

  /** Yavaş, yumuşak alarm darbesi ("vuuu") */
  _pulse(t) {
    const k = this.kit;
    const s = tone(k, this.pulseBus, { t, freq: 392, freqEnd: 311, dur: 1.9, gain: 0.03, a: 0.45, curve: 'lin' });
    void s;
    tone(k, this.pulseBus, { t, type: 'triangle', freq: 196, freqEnd: 156, dur: 1.9, gain: 0.025, a: 0.5, curve: 'lin' });
  }
}
