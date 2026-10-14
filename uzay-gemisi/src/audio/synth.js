/**
 * Prosedürel ses sentezi yardımcıları ve efekt tanımları (Ajan 6).
 * Harici ses dosyası yok: her şey osilatör + gürültü + filtre + zarf.
 *
 * Kit: createKit(ac) → { ac, noise, brown, organWave, pedalWave, reverbIR }
 * Efekt: SFX[name](kit, out, t, opts) → süre (sn). `out` hedef düğümdür (ses/3B zinciri).
 */

/** Gürültü tamponu: 'white' | 'brown' */
function makeNoise(ac, seconds, kind = 'white') {
  const len = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'brown') {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = w;
  }
  // döngü noktasında tık olmasın diye uçları yumuşat
  const fade = Math.min(2048, len >> 4);
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    d[i] *= k;
    d[len - 1 - i] *= k;
  }
  return buf;
}

/** Yapay yankı (salon/katedral) dürtü yanıtı */
function makeReverbIR(ac, seconds = 3.6, decay = 2.6) {
  const len = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // erken yansımalar seyrek, kuyruk yoğun
      const early = i < ac.sampleRate * 0.08 ? (Math.random() < 0.02 ? 1 : 0.15) : 1;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * early;
    }
  }
  return buf;
}

/** Org sesi: "drawbar" benzeri toplamsal harmonikler */
function makeWave(ac, amps) {
  const real = new Float32Array(amps.length);
  const imag = new Float32Array(amps);
  return ac.createPeriodicWave(real, imag, { disableNormalization: false });
}

export function createKit(ac) {
  return {
    ac,
    noise: makeNoise(ac, 2, 'white'),
    brown: makeNoise(ac, 4, 'brown'),
    //               DC  1    2     3     4     5     6     8 ...
    organWave: makeWave(ac, [0, 1, 0.62, 0.34, 0.24, 0.07, 0.12, 0.03, 0.08, 0.02, 0.03]),
    pedalWave: makeWave(ac, [0, 1, 0.45, 0.12, 0.06]),
    reverbIR: makeReverbIR(ac),
  };
}

// ------------------------------------------------------------------ yardımcılar
const ramp = (param, v, t) => param.linearRampToValueAtTime(v, t);
const expRamp = (param, v, t) => param.exponentialRampToValueAtTime(Math.max(1e-4, v), t);

/** Zarflı tek ton. freqEnd verilirse üstel kayar. */
export function tone(kit, out, { t, type = 'sine', freq = 440, freqEnd, dur = 0.2, gain = 0.2, a = 0.005, curve = 'exp', detune = 0, wave }) {
  const ac = kit.ac;
  const o = ac.createOscillator();
  if (wave) o.setPeriodicWave(wave);
  else o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (detune) o.detune.value = detune;
  if (freqEnd) expRamp(o.frequency, freqEnd, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  ramp(g.gain, gain, t + a);
  if (curve === 'exp') expRamp(g.gain, 0.0001, t + dur);
  else ramp(g.gain, 0, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
  return { o, g };
}

/** Filtrelenmiş gürültü patlaması */
export function noise(kit, out, { t, dur = 0.1, gain = 0.2, a = 0.002, type = 'bandpass', freq = 1000, freqEnd, Q = 1, brown = false, curve = 'exp', hold = 0 }) {
  const ac = kit.ac;
  const s = ac.createBufferSource();
  s.buffer = brown ? kit.brown : kit.noise;
  s.loop = true;
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (freqEnd) expRamp(f.frequency, freqEnd, t + dur);
  f.Q.value = Q;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  ramp(g.gain, gain, t + a);
  if (hold) g.gain.setValueAtTime(gain, t + a + hold);
  if (curve === 'exp') expRamp(g.gain, 0.0001, t + dur);
  else ramp(g.gain, 0, t + dur);
  s.connect(f).connect(g).connect(out);
  s.start(t, Math.random() * 1.5);
  s.stop(t + dur + 0.02);
  return { s, f, g };
}

/** Alçak "tok" vuruş (kapı kapanışı, adım) */
function thump(kit, out, t, { freq = 90, end = 40, dur = 0.14, gain = 0.4 } = {}) {
  tone(kit, out, { t, freq, freqEnd: end, dur, gain, a: 0.003 });
}

/** Rölesi / mekanik tık */
function relay(kit, out, t, gain = 0.2, freq = 2200) {
  noise(kit, out, { t, dur: 0.018, gain, freq, Q: 2.2 });
  tone(kit, out, { t, freq: freq * 0.8, dur: 0.02, gain: gain * 0.3, type: 'square' });
}

const rnd = (a, b) => a + Math.random() * (b - a);

// ------------------------------------------------------------------ efektler
export const SFX = {
  beep(k, out, t) {
    tone(k, out, { t, freq: 1046.5, dur: 0.11, gain: 0.2, a: 0.004 });
    tone(k, out, { t, freq: 2093, dur: 0.06, gain: 0.03, a: 0.004 });
    return 0.15;
  },

  click(k, out, t) {
    noise(k, out, { t, dur: 0.014, gain: 0.28, type: 'highpass', freq: 2400, Q: 0.7 });
    tone(k, out, { t, freq: 2300, dur: 0.018, gain: 0.05 });
    return 0.05;
  },

  switch(k, out, t) {
    thump(k, out, t, { freq: 150, end: 60, dur: 0.06, gain: 0.22 });
    relay(k, out, t, 0.32, 1700);
    relay(k, out, t + 0.038, 0.16, 2600);
    return 0.12;
  },

  tick(k, out, t) {
    noise(k, out, { t, dur: 0.007, gain: 0.18, type: 'highpass', freq: 3500, Q: 0.7 });
    tone(k, out, { t, freq: rnd(3000, 3400), dur: 0.01, gain: 0.04 });
    return 0.03;
  },

  door(k, out, t, opts = {}) {
    const closing = opts.variant === 'close';
    // pnömatik hava
    noise(k, out, {
      t,
      dur: 0.85,
      gain: 0.22,
      a: 0.05,
      freq: closing ? 900 : 2600,
      freqEnd: closing ? 2400 : 800,
      Q: 0.8,
    });
    // motor
    tone(k, out, { t, type: 'sawtooth', freq: closing ? 70 : 55, freqEnd: closing ? 52 : 78, dur: 0.75, gain: 0.05, a: 0.08, curve: 'lin' });
    noise(k, out, { t, dur: 0.7, gain: 0.08, type: 'lowpass', freq: 260, brown: true, a: 0.1 });
    // kenetlenme
    thump(k, out, t + 0.68, { freq: closing ? 110 : 85, end: 38, dur: 0.18, gain: 0.42 });
    noise(k, out, { t: t + 0.68, dur: 0.08, gain: 0.14, type: 'lowpass', freq: 700 });
    relay(k, out, t + 0.72, 0.12, 1500);
    return 1.0;
  },

  door_locked(k, out, t) {
    for (let i = 0; i < 2; i++) {
      const tt = t + i * 0.17;
      const o = tone(k, out, { t: tt, type: 'square', freq: 128, dur: 0.12, gain: 0.1, a: 0.004, curve: 'lin' });
      o.o.frequency.setValueAtTime(128, tt);
    }
    tone(k, out, { t, freq: 392, dur: 0.12, gain: 0.06 });
    tone(k, out, { t: t + 0.17, freq: 330, dur: 0.18, gain: 0.06 });
    relay(k, out, t, 0.12, 1800);
    return 0.4;
  },

  hiss(k, out, t, opts = {}) {
    const dur = opts.duration ?? 1.3;
    noise(k, out, { t, dur, gain: 0.2, a: 0.04, type: 'highpass', freq: 1800, Q: 0.6, curve: 'lin', hold: dur * 0.3 });
    noise(k, out, { t, dur: dur * 0.8, gain: 0.06, freq: 5200, freqEnd: 3000, Q: 1.5 });
    return dur;
  },

  airlock(k, out, t) {
    thump(k, out, t, { freq: 70, end: 32, dur: 0.4, gain: 0.5 });
    relay(k, out, t + 0.05, 0.2, 1400);
    // basınç boşalması
    noise(k, out, { t: t + 0.25, dur: 2.6, gain: 0.26, a: 0.35, type: 'highpass', freq: 900, Q: 0.5, curve: 'lin', hold: 1.2 });
    noise(k, out, { t: t + 0.1, dur: 3.0, gain: 0.32, a: 0.6, type: 'lowpass', freq: 140, brown: true, curve: 'lin', hold: 1.2 });
    // servo vınlaması
    tone(k, out, { t: t + 0.6, type: 'sawtooth', freq: 300, freqEnd: 520, dur: 1.6, gain: 0.025, a: 0.3, curve: 'lin' });
    thump(k, out, t + 3.0, { freq: 80, end: 35, dur: 0.35, gain: 0.5 });
    relay(k, out, t + 3.05, 0.2, 1200);
    return 3.5;
  },

  footstep(k, out, t, opts = {}) {
    const grate = opts.surface === 'grate';
    const tube = opts.surface === 'corridor';
    const v = (opts.sprint ? 1.15 : 1) * (opts.land ? 1.4 : 1);
    const p = rnd(0.93, 1.07);
    thump(k, out, t, { freq: 105 * p, end: 52, dur: 0.075, gain: 0.3 * v });
    noise(k, out, { t, dur: grate ? 0.06 : 0.045, gain: (grate ? 0.16 : 0.1) * v, freq: (grate ? 3000 : tube ? 2000 : 1300) * p, Q: grate ? 1.6 : 1 });
    // metalik ızgara tınısı (uyumsuz kısmi tonlar)
    const ring = grate ? 0.035 : tube ? 0.02 : 0.008;
    const base = (grate ? 520 : 430) * p;
    for (const m of [1, 2.76, 5.4]) tone(k, out, { t, freq: base * m, dur: grate ? 0.16 : 0.09, gain: (ring * v) / m ** 0.3 });
    return 0.2;
  },

  alarm(k, out, t) {
    for (let i = 0; i < 2; i++) {
      const tt = t + i * 0.7;
      const s = tone(k, out, { t: tt, type: 'sawtooth', freq: 660, dur: 0.62, gain: 0.1, a: 0.02, curve: 'lin' });
      s.o.frequency.setValueAtTime(660, tt);
      s.o.frequency.setValueAtTime(520, tt + 0.31);
      tone(k, out, { t: tt, freq: 660, dur: 0.6, gain: 0.07, a: 0.02, curve: 'lin' }).o.frequency.setValueAtTime(520, tt + 0.31);
    }
    return 1.5;
  },

  power_up(k, out, t) {
    thump(k, out, t, { freq: 72, end: 30, dur: 0.5, gain: 0.55 });
    noise(k, out, { t, dur: 0.25, gain: 0.2, type: 'lowpass', freq: 500 });
    tone(k, out, { t: t + 0.1, freq: 110, freqEnd: 1250, dur: 2.3, gain: 0.07, a: 0.6, curve: 'lin' });
    const hum = tone(k, out, { t: t + 0.15, type: 'sawtooth', freq: 45, freqEnd: 60, dur: 2.6, gain: 0.12, a: 1.2, curve: 'lin' });
    void hum;
    noise(k, out, { t: t + 0.2, dur: 2.4, gain: 0.12, type: 'lowpass', freq: 120, freqEnd: 600, brown: true, a: 1.0, curve: 'lin' });
    for (const d of [0.55, 0.8, 1.15, 1.4, 1.75]) relay(k, out, t + d, 0.16, rnd(1300, 2400));
    tone(k, out, { t: t + 2.1, freq: 523.25, dur: 1.4, gain: 0.05, a: 0.05 });
    tone(k, out, { t: t + 2.1, freq: 784, dur: 1.4, gain: 0.035, a: 0.05 });
    return 3.6;
  },

  power_down(k, out, t) {
    tone(k, out, { t, freq: 1200, freqEnd: 70, dur: 1.9, gain: 0.07, a: 0.02, curve: 'lin' });
    tone(k, out, { t, type: 'sawtooth', freq: 60, freqEnd: 28, dur: 2.0, gain: 0.12, a: 0.05, curve: 'lin' });
    relay(k, out, t + 0.05, 0.2, 1600);
    thump(k, out, t + 1.9, { freq: 70, end: 30, dur: 0.4, gain: 0.45 });
    return 2.5;
  },

  error(k, out, t) {
    tone(k, out, { t, type: 'square', freq: 240, dur: 0.12, gain: 0.11, curve: 'lin' });
    tone(k, out, { t: t + 0.14, type: 'square', freq: 180, dur: 0.2, gain: 0.11, curve: 'lin' });
    return 0.4;
  },

  success(k, out, t) {
    const notes = [784, 987.8, 1318.5];
    notes.forEach((f, i) => {
      tone(k, out, { t: t + i * 0.09, freq: f, dur: 0.9, gain: 0.1, a: 0.006 });
      tone(k, out, { t: t + i * 0.09, type: 'triangle', freq: f * 2, dur: 0.35, gain: 0.012 });
    });
    return 1.2;
  },

  spin_up(k, out, t) {
    thump(k, out, t, { freq: 60, end: 28, dur: 0.6, gain: 0.5 });
    relay(k, out, t + 0.05, 0.22, 1300);
    noise(k, out, { t, dur: 8, gain: 0.34, a: 4, type: 'lowpass', freq: 70, freqEnd: 320, brown: true, curve: 'lin', hold: 2 });
    tone(k, out, { t: t + 0.4, type: 'sawtooth', freq: 28, freqEnd: 92, dur: 7.4, gain: 0.08, a: 3.5, curve: 'lin' });
    tone(k, out, { t: t + 0.8, freq: 140, freqEnd: 560, dur: 7, gain: 0.03, a: 3, curve: 'lin' });
    // metal gövdenin gerilme gıcırtıları
    for (const d of [1.6, 3.4, 5.1]) noise(k, out, { t: t + d, dur: 1.2, gain: 0.05, a: 0.4, freq: rnd(280, 420), freqEnd: rnd(380, 560), Q: 9, curve: 'lin' });
    return 8.4;
  },

  terminal(k, out, t) {
    thump(k, out, t, { freq: 70, end: 45, dur: 0.08, gain: 0.18 });
    [1200, 1600, 2000].forEach((f, i) => tone(k, out, { t: t + 0.06 + i * 0.055, type: 'square', freq: f, dur: 0.035, gain: 0.025, curve: 'lin' }));
    noise(k, out, { t, dur: 0.3, gain: 0.04, type: 'highpass', freq: 4500 });
    return 0.4;
  },

  servo(k, out, t, opts = {}) {
    const dur = opts.duration ?? 0.7;
    const s = tone(k, out, { t, type: 'sawtooth', freq: 150, dur, gain: 0.1, a: 0.05, curve: 'lin' });
    s.o.frequency.linearRampToValueAtTime(260, t + dur * 0.4);
    s.o.frequency.linearRampToValueAtTime(170, t + dur);
    noise(k, out, { t, dur, gain: 0.08, freq: 900, Q: 3, a: 0.05, curve: 'lin' });
    relay(k, out, t + dur, 0.1, 1900);
    return dur + 0.1;
  },

  /** TARS konuşmadan önce kısa robot sinyali */
  blip(k, out, t) {
    tone(k, out, { t, type: 'square', freq: 1480, dur: 0.035, gain: 0.1, curve: 'lin' });
    tone(k, out, { t: t + 0.055, type: 'square', freq: 1975, dur: 0.045, gain: 0.1, curve: 'lin' });
    return 0.12;
  },
};
