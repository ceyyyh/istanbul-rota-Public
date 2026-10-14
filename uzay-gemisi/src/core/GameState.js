/**
 * Oyun bayrakları (görev ilerlemesi, enerji durumu vb.).
 * set() her değişiklikte iki olay yayar:
 *   'state:changed' → { key, value, prev }
 *   'state:<key>'   → value
 *
 * Bilinen bayraklar (docs/ARCHITECTURE.md'de ayrıntılı):
 *   intro_done, talked_tars, power_restored, messages_read,
 *   ring_spinning, blackhole_observed, found_morse, mission_complete
 */
export class GameState {
  constructor(bus) {
    this.bus = bus;
    this.flags = Object.create(null);
  }

  get(key, fallback = undefined) {
    return key in this.flags ? this.flags[key] : fallback;
  }

  is(key) {
    return !!this.flags[key];
  }

  set(key, value = true) {
    const prev = this.flags[key];
    if (prev === value) return;
    this.flags[key] = value;
    this.bus.emit('state:changed', { key, value, prev });
    this.bus.emit(`state:${key}`, value);
  }

  /** Bayrak zaten doğruysa hemen, değilse doğru olduğunda bir kez çağırır. */
  when(key, fn) {
    if (this.is(key)) {
      fn(this.flags[key]);
      return () => {};
    }
    const off = this.bus.on(`state:${key}`, (v) => {
      if (v) {
        off();
        fn(v);
      }
    });
    return off;
  }
}
