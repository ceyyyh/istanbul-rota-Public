import * as THREE from 'three';

/**
 * Dünyalar arası geçiş: 'ship' (AZİM) ↔ 'planet' (Miller gezegeni).
 *
 * Gezegen, aynı sahnede gemiden çok uzakta (PLANET_ORIGIN) kurulur; böylece fizik, çarpışma,
 * etkileşim ve ışık sistemleri değişmeden çalışır. Aktif olmayan dünya gizlenir.
 *
 *   await ctx.world.go('planet', { spawn: { x, z, yaw } });   // karartma + ışınlama + açılma
 *   ctx.world.current          // 'ship' | 'planet'
 *   ctx.world.isPlanet()
 * Olay: 'world:change' { from, to }
 */
export const PLANET_ORIGIN = { x: 4000, z: 0 };

export class WorldManager {
  constructor(ctx) {
    this.ctx = ctx;
    this.current = 'ship';
    this.busy = false;
  }

  isPlanet() {
    return this.current === 'planet';
  }

  /** Görünürlük, uzay geçişi ve ortam ışığını hemen uygular (karartma yok). */
  apply(name) {
    const { ctx } = this;
    const planet = name === 'planet';
    ctx.ship?.setVisible(!planet);
    ctx.planet?.setActive(planet);
    // Gezegende gökyüzü kubbesi uzay geçişinin yerini alır
    ctx.engine.spacePass.enabled = !planet;
    ctx.engine.shipPass.clear = planet;
    if (planet) ctx.engine.scene.environmentIntensity = ctx.planet?.envIntensity ?? 0.6;
    else ctx.engine.scene.environmentIntensity = ctx.lighting.envIntensity[ctx.lighting.mode];
    ctx.player.onPlanet = planet;
    const from = this.current;
    this.current = name;
    if (from !== name) ctx.bus.emit('world:change', { from, to: name });
  }

  /**
   * Karartarak dünya değiştirir.
   * @param {'ship'|'planet'} name
   * @param {{ spawn?: {x:number, z:number, yaw?:number}, fadeMs?: number, holdMs?: number, onDark?: Function }} opts
   *   spawn: dünya koordinatı (gezegen için PLANET_ORIGIN'e göre DEĞİL, mutlak)
   *   onDark: ekran kararmışken çağrılır (ör. altyazı, NPC yerleştirme)
   */
  async go(name, opts = {}) {
    if (this.busy) return;
    this.busy = true;
    const { ctx } = this;
    const fadeMs = opts.fadeMs ?? 900;
    ctx.player.frozen = true;
    try {
      await ctx.ui?.fade?.(true, fadeMs);
      this.apply(name);
      if (opts.spawn) ctx.player.teleport(opts.spawn.x, opts.spawn.z, opts.spawn.yaw ?? ctx.player.yaw);
      await opts.onDark?.();
      await new Promise((r) => setTimeout(r, opts.holdMs ?? 400));
      await ctx.ui?.fade?.(false, fadeMs);
    } finally {
      ctx.player.frozen = false;
      this.busy = false;
    }
  }

  /** Gezegen yerel (x, z) → dünya. */
  planetToWorld(x, z) {
    return new THREE.Vector3(PLANET_ORIGIN.x + x, 0, PLANET_ORIGIN.z + z);
  }
}
