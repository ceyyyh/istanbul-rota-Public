/**
 * Basit olay yolu. Modüller arası gevşek bağlantı için kullanılır.
 *   const off = bus.on('state:power_restored', (v) => ...);
 *   bus.emit('player:footstep', { surface: 'grate' });
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this.handlers = new Map();
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.off(type, fn);
  }

  once(type, fn) {
    const off = this.on(type, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }

  off(type, fn) {
    this.handlers.get(type)?.delete(fn);
  }

  emit(type, payload) {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[bus] "${type}" dinleyicisinde hata:`, err);
      }
    }
  }
}
