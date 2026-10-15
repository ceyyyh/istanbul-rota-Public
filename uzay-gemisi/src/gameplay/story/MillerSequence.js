import * as THREE from 'three';
import * as T from './texts.js';

/**
 * Bölüm 2 anlatısı: hava kilidinden Ranger'a biniş, Miller gezegenine iniş, kaydedici, dalga,
 * kurtarma, kalkış ve yaşlanmış Rami ile dönüş. Akış: docs/ARCHITECTURE.md §15.
 *
 * Tasarım: etkileşimler yalnızca BAYRAK ayarlar (veya kısa bir sahne oynatıp bayrak ayarlar); uzun sekanslar
 * `state:<bayrak>` dinleyicilerinde çalışır. Böylece testler/hata ayıklama bayrakları doğrudan ayarlasa da akış sağlam kalır.
 *
 * Missions bunu kurar: `missions.story`. Dış API:
 *   story.onStart()              oyun başladığında (Missions.start) çağrılır
 *   story.update(dt)             her karede (zaman genişlemesi sayacı, kamera sarsıntısı)
 *   story.earthDays              gezegende Dünya'da geçen gün
 *   story.busy                   bir sinematik sürüyor mu
 */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fwdOf = (yaw) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });
/** Oyuncu yaw'ı: (dx, dz) yönüne bak */
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);

// Dalga ayarları (gezegen API'sinde wave.start({ fromDistance, speed }))
const WAVE_FROM = 320;
const WAVE_SPEED = 11;
const WAVE_RETRY_EXTRA = 140;

export class MillerSequence {
  constructor(ctx) {
    this.ctx = ctx;
    this.busy = false;
    this.earthDays = 0;
    this.elaPinned = false;
    this._bound = false;
    this._boundObjs = {};
    this._fallback = {};
    this._shake = 0;
    this._shakeGoal = 0;
    this._skip = null;
    this._lastInfoDay = -1;
    this._lastWarnAt = -1e9;
    this._hitBusy = false;
    this._started = false;

    const { bus, state } = ctx;

    // Bayrak dinleyicileri (başlamadan gelen bayraklar yok sayılır; onStart durumu yeniden kurar)
    bus.on('state:blackhole_observed', (v) => v && this._started && this._setupAirlockCrew());
    bus.on('state:ranger_launched', (v) => v && this._started && this._launch());
    bus.on('state:beacon_found', (v) => v && this._started && this._onBeacon());
    bus.on('state:ela_rescued', (v) => v && this._started && this._afterRescue());
    bus.on('state:wave_escaped', (v) => v && this._started && this._onEscaped());
    bus.on('state:returned_to_ship', (v) => v && this._started && this._onReturned());
    bus.on('planet:wave_hit', () => this._onWaveHit());
    bus.on('planet:wave_warning', () => this._onWaveWarning());
    bus.on('world:change', ({ to }) => this._onWorldChange(to));

    // Kamera sarsıntısı (oyuncu -100'de kamerayı kurar; sonra biz ekleriz)
    ctx.onUpdate((dt) => this._applyShake(dt), -60);
    void state;
  }

  // ------------------------------------------------------------------ yardımcılar

  get _crew() {
    return this.ctx.crew;
  }

  _npc(id) {
    return this._crew?.get?.(id) || null;
  }

  _say(id, text, ms = 4200) {
    const npc = this._npc(id);
    if (npc?.say) npc.say(text, ms);
    else this.ctx.ui?.subtitle?.(id, text, ms);
  }

  _sub(speaker, text, ms = 3000) {
    this.ctx.ui?.subtitle?.(speaker, text, ms);
  }

  _tarsSay(pair, opts = {}) {
    const tars = this.ctx.tars;
    if (!tars) return;
    const text = Array.isArray(pair) ? tars._variant(pair) : pair;
    tars.say(text, { priority: 5, expires: 30, ...opts });
  }

  _setTalk(id, prompt, onTalk) {
    const npc = this._npc(id);
    if (npc) npc.talk = { prompt, onTalk };
  }

  _sfx(name, opts) {
    this.ctx.audio?.play?.(name, opts);
  }

  _place(id, x, z, lookX, lookZ) {
    const npc = this._npc(id);
    if (!npc) return;
    npc.setVisible?.(true);
    npc.placeAt?.(x, z, 0);
    if (lookX !== undefined) npc.lookAt?.(lookX, lookZ);
    npc.follow?.(null);
    npc.setPose?.('idle');
  }

  /** Gezegen nesnesi (beacon/debris/ramp). Gezegen henüz sağlamadıysa basit yedek oluşturur. */
  _obj(name) {
    const pl = this.ctx.planet;
    if (pl?.objects?.[name]) return pl.objects[name];
    if (this._fallback[name]) return this._fallback[name];
    if (!pl?.root) return null;
    const pts = pl.points || {};
    const base = { beacon: pts.beacon, debris: pts.wreck, ramp: pts.ranger }[name] || pts.ranger;
    if (!base) return null;
    const dims = { beacon: [0.5, 0.35, 0.5], debris: [1.6, 0.9, 0.5], ramp: [1.4, 0.4, 2.2] }[name] || [1, 1, 1];
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(...dims),
      new THREE.MeshStandardMaterial({ color: name === 'beacon' ? 0xff8a30 : 0x6a6e72, roughness: 0.7 }),
    );
    const off = name === 'debris' ? [-6, 4] : name === 'ramp' ? [3, 0] : [0, 0];
    m.position.set(base.x + off[0] - pl.root.position.x, dims[1] / 2, base.z + off[1] - pl.root.position.z);
    m.name = `story-${name}`;
    pl.root.add(m);
    this._fallback[name] = m;
    return m;
  }

  /** Ela'nın sıkıştığı nokta (dünya): gezegen `points.ela` verir; yoksa enkaz nesnesinin yanı */
  _elaPoint() {
    const p = this.ctx.planet?.points?.ela;
    if (p) return { x: p.x, z: p.z };
    const dp = this._objPos('debris');
    return { x: dp.x + 1.1, z: dp.z + 0.7 };
  }

  _objPos(name, out = new THREE.Vector3()) {
    const o = this._obj(name);
    if (!o) return out.set(0, 0, 0);
    o.updateWorldMatrix(true, false);
    return o.getWorldPosition(out);
  }

  /** Gezegen etkileşimlerini bir kez bağla */
  _bindPlanet() {
    if (this._bound) return;
    const { ctx } = this;
    const { interactions, state, world } = ctx;
    const beacon = this._obj('beacon');
    const debris = this._obj('debris');
    const ramp = this._obj('ramp');
    if (!beacon || !debris || !ramp) return;
    this._bound = true;
    const onPlanet = () => !!world?.isPlanet?.();

    interactions.add(beacon, {
      id: 'planet.beacon',
      prompt: 'Veri kaydedicisini al',
      distance: 3.6,
      enabled: () => onPlanet() && !state.is('beacon_found') && !this.busy,
      onInteract: () => {
        this._sfx('success', { volume: 0.5 });
        ctx.ui?.toast?.('Veri kaydedici alındı.', 2600);
        state.set('beacon_found', true);
      },
    });
    interactions.add(debris, {
      id: 'planet.debris',
      prompt: 'Ela’ya yardım et',
      distance: 3.8,
      enabled: () => onPlanet() && state.is('beacon_found') && !state.is('ela_rescued') && this.elaPinned && !this.busy,
      onInteract: () => this._rescue(),
    });
    interactions.add(ramp, {
      id: 'planet.ramp',
      prompt: 'Ranger’a gir',
      distance: 4.2,
      enabled: () => onPlanet() && !state.is('wave_escaped') && !this.busy,
      onInteract: () => this._ramp(),
    });
  }

  // ------------------------------------------------------------------ başlangıç ve güncelleme

  onStart() {
    this._started = true;
    const { state, world } = this.ctx;
    if (world?.isPlanet?.()) this._enterPlanetState();
    else if (state.is('returned_to_ship')) this._setupReturn();
    else if (state.is('blackhole_observed') && !state.is('ranger_launched')) this._setupAirlockCrew();
  }

  update(dt) {
    const { ctx } = this;
    this._bindPlanet();
    // Kaydırma animasyonu (sinematiklerde zamanı atla)
    if (this._skip) {
      const s = this._skip;
      s.t += dt;
      const k = Math.min(1, s.t / s.dur);
      const e = k * k * (3 - 2 * k);
      this.earthDays = s.from + (s.to - s.from) * e;
      if (k >= 1) this._skip = null;
    } else if (ctx.world?.isPlanet?.() && this._clockOn) {
      this.earthDays += dt * T.EARTH_DAYS_PER_SEC;
    }
    if (ctx.world?.isPlanet?.() && this._clockOn) {
      const day = Math.floor(this.earthDays);
      if (day !== this._lastInfoDay) {
        this._lastInfoDay = day;
        ctx.ui?.setInfo?.(T.fmtEarth(this.earthDays));
      }
    }
    // sarsıntı genliği
    this._shake += (this._shakeGoal - this._shake) * Math.min(1, dt * 2.5);
  }

  _applyShake(dt) {
    if (this._shake < 0.002) return;
    const cam = this.ctx.camera;
    const a = this._shake;
    cam.position.x += (Math.random() - 0.5) * a;
    cam.position.y += (Math.random() - 0.5) * a * 0.8;
    cam.rotation.z += (Math.random() - 0.5) * a * 0.08;
    void dt;
  }

  /** Dünya zamanını `days` değerine kadar, `sec` saniyede kaydırarak atla */
  _skipEarthTo(days, sec = 2.5) {
    if (days <= this.earthDays) return;
    this._skip = { from: this.earthDays, to: days, t: 0, dur: sec };
  }

  _onWorldChange(to) {
    if (to === 'planet') {
      this._clockOn = true;
      this._lastInfoDay = -1;
      this.ctx.ui?.setInfo?.(T.fmtEarth(this.earthDays));
    } else {
      this._clockOn = false;
      this.ctx.ui?.setInfo?.(null);
    }
  }

  /** ?world=planet gibi doğrudan gezegende başlanırsa */
  _enterPlanetState() {
    const { state } = this.ctx;
    this._clockOn = true;
    this._layoutLanding();
    if (state.is('beacon_found') && !state.is('ela_rescued')) this._pinElaNow();
  }

  // ------------------------------------------------------------------ 6. hava kilidi: ekip bekler

  _airlockPos(lx, lz) {
    const L = this.ctx.layout;
    return L.localToWorld(L.moduleIndexById('airlock'), lx, lz);
  }

  _setupAirlockCrew() {
    const { state } = this.ctx;
    if (state.is('ranger_launched')) return;
    const center = this._airlockPos(0, 0);
    const e = this._airlockPos(-2.3, 2.1);
    const d = this._airlockPos(2.6, 2.1);
    this._place('ela', e.x, e.z, center.x, center.z);
    this._place('doruk', d.x, d.z, center.x, center.z);
    this._setTalk('ela', 'Ela ile konuş', () => this._say('ela', T.BOARD.elaTalk));
    this._setTalk('doruk', 'Doruk ile konuş', () => this._say('doruk', T.BOARD.dorukTalk));
  }

  // ------------------------------------------------------------------ 6→7. biniş ve iniş

  async _launch() {
    const { ctx } = this;
    const { world, planet, audio, state } = ctx;
    if (this.busy || world.isPlanet() || state.is('miller_landed')) return;
    this.busy = true;
    ctx.player.frozen = true;
    try {
      this._say('ela', T.BOARD.ela, 3600);
      await wait(1800);
      this._say('doruk', T.BOARD.doruk, 2600);
      this._sfx('rumble', { volume: 0.5, duration: 3.5 });
      await wait(1600);
      this._shakeGoal = 0.012;
      await world.go('planet', {
        spawn: planet.spawn,
        fadeMs: 1100,
        holdMs: 700,
        onDark: async () => {
          this._shakeGoal = 0;
          this.earthDays = 0;
          this._skip = null;
          this._layoutLanding();
          this._sfx('rumble', { volume: 0.6, duration: 5 });
          for (const [who, text, ms] of T.LAUNCH_SUBS) {
            this._sub(who, text, ms);
            await wait(ms - 200);
          }
        },
      });
      audio?.play?.('success', { volume: 0.35 });
      state.set('miller_landed', true);
      this._afterLanding();
    } catch (err) {
      console.error('[hikâye] iniş sinematiği hatası:', err);
    } finally {
      this._shakeGoal = 0;
      ctx.player.frozen = false;
      this.busy = false;
    }
  }

  /** İniş sonrası ekip ve TARS konumları (Ranger rampası önü) */
  _layoutLanding() {
    const { planet, tars } = this.ctx;
    if (!planet) return;
    const sp = planet.spawn;
    const f = fwdOf(sp.yaw);
    const r = { x: -f.z, z: f.x };
    const bx = planet.points.beacon.x;
    const bz = planet.points.beacon.z;
    this._place('ela', sp.x + f.x * 2.4 + r.x * 1.6, sp.z + f.z * 2.4 + r.z * 1.6, bx, bz);
    this._place('doruk', sp.x + f.x * 1.2 - r.x * 1.9, sp.z + f.z * 1.2 - r.z * 1.9, bx, bz);
    tars?.placeWorld?.(sp.x + r.x * 2.8 - f.x * 0.4, sp.z + r.z * 2.8 - f.z * 0.4, yawTo(-f.x, -f.z) + Math.PI);
    this._setTalk('ela', 'Ela ile konuş', () => this._say('ela', T.ELA_WAIT));
    this._setTalk('doruk', 'Doruk ile konuş', () => this._say('doruk', T.DORUK_WAIT));
    this.elaPinned = false;
  }

  async _afterLanding() {
    const { planet } = this.ctx;
    this._say('ela', T.LANDED.ela, 4200);
    this._tarsSay(T.LANDED.tars, { delay: 4.4 });
    const bx = planet.points.beacon.x;
    const bz = planet.points.beacon.z;
    const doruk = this._npc('doruk');
    doruk?.follow?.(this.ctx.player.position, { distance: 3 });
    const ela = this._npc('ela');
    try {
      await wait(1500);
      await Promise.resolve(ela?.walkTo?.(bx - 4, bz + 3, { run: true }));
      if (!this.ctx.state.is('beacon_found')) {
        ela?.lookAt?.(bx, bz);
        this._say('ela', T.ELA_AHEAD, 3600);
      }
    } catch (err) {
      console.warn('[hikâye] Ela yürüme hatası:', err);
    }
  }

  // ------------------------------------------------------------------ 8. kaydedici ve dalga

  async _onBeacon() {
    const { ctx } = this;
    if (!ctx.world.isPlanet()) return;
    const { tars, planet, state } = ctx;
    const honest = !tars || tars.humor >= 30;
    const seq = honest ? T.BEACON : T.BEACON_TARS_DRY;
    // Kaydediciyi enkazdan sökmek zaman alır
    this._skipEarthTo(this.earthDays + 7 * 365.25 + 60, 3);
    ctx.ui?.toast?.(T.BEACON_SKIP_TEXT, 3600);
    this._sfx('wave_roar', { volume: 0.25, duration: 8 });
    for (let i = 0; i < seq.length; i++) {
      const [who, text, ms] = seq[i];
      if (who === 'TARS') {
        const t = tars;
        t?.faceTowards?.(planet.points.ranger.x + 400, planet.points.ranger.z);
        this._tarsSay(text, { force: true });
      } else this._sub(who, text, ms);
      await wait(ms - 100);
      if (!state.is('beacon_found') || !ctx.world.isPlanet()) return;
    }
    this._startWave(WAVE_FROM);
    this._pinElaSoon();
  }

  _startWave(from) {
    const { planet } = this.ctx;
    try {
      planet.wave?.reset?.();
      planet.wave?.start?.({ fromDistance: from, speed: WAVE_SPEED });
    } catch (err) {
      console.error('[hikâye] dalga başlatılamadı:', err);
    }
    this._sfx('wave_roar', { volume: 0.5, duration: 9 });
  }

  _onWaveWarning() {
    const { ctx } = this;
    if (!ctx.world?.isPlanet?.()) return;
    const now = performance.now();
    if (now - this._lastWarnAt < 9000) return;
    this._lastWarnAt = now;
    ctx.ui?.toast?.('Dalga yaklaşıyor!', 2400);
  }

  // ------------------------------------------------------------------ 9. Ela enkaza sıkışır

  async _pinElaSoon() {
    const ela = this._npc('ela');
    const ep = this._elaPoint();
    try {
      ela?.follow?.(null);
      await Promise.resolve(ela?.walkTo?.(ep.x + 2, ep.z, { run: true }));
    } catch (err) {
      console.warn('[hikâye] Ela enkaza koşamadı:', err);
    }
    if (!this.ctx.world.isPlanet()) return;
    this._pinElaNow();
  }

  _pinElaNow() {
    const ep = this._elaPoint();
    const ela = this._npc('ela');
    ela?.placeAt?.(ep.x, ep.z, 0);
    ela?.lookAt?.(this.ctx.planet.points.ranger.x, this.ctx.planet.points.ranger.z);
    ela?.setPose?.('sit');
    this.elaPinned = true;
    this._setTalk('ela', 'Ela ile konuş', () => this._say('ela', T.ELA_TRAPPED, 3000));
    this._say('ela', T.ELA_TRAPPED, 4200);
  }

  async _rescue() {
    const { ctx } = this;
    if (this.busy || ctx.state.is('ela_rescued')) return;
    this.busy = true;
    const { player, tars } = ctx;
    player.frozen = true;
    try {
      const dp = this._elaPoint();
      this._say('doruk', T.RESCUE.start, 2400);
      if (tars) {
        tars.scripted = true;
        tars.faceTowards(dp.x, dp.z, true);
        tars.gesture('cheer');
      }
      this._sfx('servo', { volume: 0.5 });
      await wait(1800);
      this._tarsSay(T.RESCUE.tars, { force: true });
      this._sfx('rumble', { volume: 0.35, duration: 2.5 });
      await wait(2400);
      ctx.planet?.releaseDebris?.();
      this._say('ela', T.RESCUE.done, 2600);
      this._sfx('success', { volume: 0.4 });
      await wait(600);
    } finally {
      if (tars) tars.scripted = false;
      // Dalga yakalama karartması sürüyorsa dondurmayı o kaldırır
      if (!this._hitBusy) player.frozen = false;
      this.busy = false;
    }
    ctx.state.set('ela_rescued', true);
  }

  _crewRunToRamp() {
    const rp = this._objPos('ramp');
    const ela = this._npc('ela');
    const doruk = this._npc('doruk');
    ela?.follow?.(null);
    doruk?.follow?.(null);
    ela?.setPose?.('idle');
    Promise.resolve(ela?.walkTo?.(rp.x + 1.4, rp.z - 1.2, { run: true })).catch(() => {});
    Promise.resolve(doruk?.walkTo?.(rp.x + 1.4, rp.z + 1.2, { run: true })).catch(() => {});
  }

  _afterRescue() {
    if (!this.ctx.world.isPlanet()) return;
    this.elaPinned = false;
    this._say('ela', T.RESCUE.go, 3000);
    this._crewRunToRamp();
  }

  // ------------------------------------------------------------------ 10. rampa

  _ramp() {
    const { ctx } = this;
    const { state } = ctx;
    if (!state.is('beacon_found')) {
      this._say('doruk', T.RAMP_EARLY_BEACON, 3000);
      return;
    }
    if (!state.is('ela_rescued')) {
      this._say('doruk', T.RAMP_EARLY_ELA, 3000);
      return;
    }
    try {
      ctx.planet.wave?.stop?.();
    } catch (err) {
      console.warn('[hikâye] dalga durdurulamadı:', err);
    }
    state.set('wave_escaped', true);
  }

  // ------------------------------------------------------------------ dalga yakalarsa

  async _onWaveHit() {
    const { ctx } = this;
    const { state, world, planet, player, ui } = ctx;
    if (!world?.isPlanet?.() || !state.is('beacon_found') || state.is('wave_escaped')) return;
    if (this._hitBusy) return;
    this._hitBusy = true;
    player.frozen = true;
    try {
      planet.wave?.stop?.();
      this._sfx('wave_roar', { volume: 0.7, duration: 3 });
      await ui?.fade?.(true, 700);
      this._sfx('rumble', { volume: 0.5, duration: 3 });
      this._sub(T.WAVE_HIT[0][0], T.WAVE_HIT[0][1], T.WAVE_HIT[0][2]);
      await wait(2800);
      planet.wave?.reset?.();
      // kontrol noktası: enkazın yanı (Ela kurtarıldıysa onunla birlikte)
      const dp = this._elaPoint();
      const rp = planet.points.ranger;
      const dx = dp.x - rp.x;
      const dz = dp.z - rp.z;
      const len = Math.hypot(dx, dz) || 1;
      const px = dp.x - (dx / len) * 3.2 + (dz / len) * 1.2;
      const pz = dp.z - (dz / len) * 3.2 - (dx / len) * 1.2;
      player.teleport(px, pz, yawTo(dp.x - px, dp.z - pz));
      if (state.is('ela_rescued')) {
        this._place('ela', px + 1.3, pz + 0.5, rp.x, rp.z);
        this._place('doruk', px - 1.3, pz + 0.7, rp.x, rp.z);
        this._say('ela', T.RESCUE.go, 2600);
      } else {
        this._pinElaNow();
        this._place('doruk', px - 1.4, pz + 0.6, dp.x, dp.z);
      }
      ctx.tars?.placeWorld?.(px + 2.0, pz - 1.4, 0);
      this._sub(T.WAVE_HIT[1][0], T.WAVE_HIT[1][1], T.WAVE_HIT[1][2]);
      await wait(900);
      await ui?.fade?.(false, 900);
      this._startWave(WAVE_FROM + WAVE_RETRY_EXTRA);
      if (state.is('ela_rescued')) this._crewRunToRamp();
    } catch (err) {
      console.error('[hikâye] dalga sonrası yeniden başlatma hatası:', err);
      ui?.fade?.(false, 300);
    } finally {
      player.frozen = false;
      this._hitBusy = false;
    }
  }

  // ------------------------------------------------------------------ 10→11. kalkış ve dönüş

  _onEscaped() {
    const { ctx } = this;
    if (ctx.world.isPlanet()) this._takeoff();
    else if (!ctx.state.is('returned_to_ship')) {
      // gemideyken bayrak ayarlandıysa (hata ayıklama): doğrudan dönüşü tamamla
      this._setupReturn();
      ctx.state.set('returned_to_ship', true);
    }
  }

  async _takeoff() {
    const { ctx } = this;
    if (this.busy) return;
    this.busy = true;
    const { world, player, state } = ctx;
    try {
      player.frozen = true;
      ctx.planet?.wave?.stop?.();
      this._sub(T.TAKEOFF_SUBS[0][0], T.TAKEOFF_SUBS[0][1], T.TAKEOFF_SUBS[0][2]);
      this._sfx('rumble', { volume: 0.8, duration: 6 });
      this._shakeGoal = 0.05;
      const target = Math.max(this.earthDays + 60, T.MIN_RETURN_DAYS);
      this._skipEarthTo(target, 4.5);
      await wait(2700);
      this._sub(T.TAKEOFF_SUBS[1][0], T.TAKEOFF_SUBS[1][1], T.TAKEOFF_SUBS[1][2]);
      this._shakeGoal = 0.09;
      await wait(2500);
      this._shakeGoal = 0;
      this.earthDays = Math.max(this.earthDays, target);
      this._skip = null;
      const sp = this._shipSpawn();
      await world.go('ship', {
        spawn: sp,
        fadeMs: 1100,
        holdMs: 800,
        onDark: async () => {
          this._setupReturn();
          for (const [who, text, ms] of T.RETURN_SUBS) {
            this._sub(who, text, ms);
            await wait(ms - 300);
          }
        },
      });
      state.set('returned_to_ship', true);
    } catch (err) {
      console.error('[hikâye] kalkış sinematiği hatası:', err);
    } finally {
      this._shakeGoal = 0;
      player.frozen = false;
      this.busy = false;
    }
  }

  _shipSpawn() {
    const L = this.ctx.layout;
    const i = L.moduleIndexById('airlock');
    const a = L.localToWorld(i, 0, 0);
    const b = L.localToWorld(i, 0, 1);
    const s = L.spawnPoint('airlock', 0, 0);
    return { x: s.x, z: s.z, yaw: yawTo(b.x - a.x, b.z - a.z) };
  }

  /** Dönüşte ekip ve Rami (idempotent) */
  _setupReturn() {
    const { state } = this.ctx;
    const center = this._airlockPos(0, 0);
    const r = this._airlockPos(0.2, 2.3);
    const e = this._airlockPos(-2.4, 2.0);
    const d = this._airlockPos(2.7, 2.0);
    const rami = this._npc('rami');
    rami?.setAged?.(true);
    this._place('rami', r.x, r.z, center.x, center.z);
    this._place('ela', e.x, e.z, r.x, r.z);
    this._place('doruk', d.x, d.z, r.x, r.z);
    const tars = this.ctx.tars;
    tars?.placeLocal?.('airlock', -1.7, 0.9, new THREE.Vector3(r.x, 0, r.z));
    this._setTalk('rami', 'Rami ile konuş', () => this._ramiTalk());
    this._setTalk('ela', 'Ela ile konuş', () => this._say('ela', T.ELA_SHIP));
    this._setTalk('doruk', 'Doruk ile konuş', () => this._say('doruk', T.DORUK_SHIP));
    this._clockOn = false;
    if (state.is('rami_met')) this._setTalk('rami', 'Rami ile konuş', () => this._say('rami', T.RAMI_BEFORE));
  }

  async _onReturned() {
    const { ctx } = this;
    if (ctx.world.isPlanet()) {
      // gezegendeyken bayrak ayarlandıysa gemiye taşı
      if (!this.busy) {
        this.busy = true;
        try {
          await ctx.world.go('ship', { spawn: this._shipSpawn(), onDark: () => this._setupReturn() });
        } finally {
          this.busy = false;
        }
      }
    } else {
      this._setupReturn();
    }
    await wait(1200);
    this._say('ela', T.RETURN_CREW.ela, 4200);
    this._tarsSay(T.RETURN_CREW.tars, { delay: 4.6 });
  }

  // ------------------------------------------------------------------ 12. Rami

  _ramiTalk() {
    const { ctx } = this;
    const { state, ui } = ctx;
    if (state.is('rami_met')) {
      this._say('rami', T.RAMI_BEFORE, 4200);
      return;
    }
    if (!ui?.openDialog || ui.isModalOpen?.()) return;
    const pages = T.RAMI_TALK;
    let i = 0;
    let h = null;
    let finished = false;
    const opts = () =>
      i < pages.length - 1
        ? [
            {
              label: 'Devam ▶',
              action: () => {
                i++;
                h?.setText?.(pages[i]);
                h?.setOptions?.(opts());
                return false;
              },
            },
          ]
        : [{ label: 'Teşekkürler, Rami.', action: () => {} }];
    h = ui.openDialog({
      speaker: 'Prof. Rami Kaya',
      text: pages[0],
      options: opts(),
      onClose: () => {
        if (finished || i < pages.length - 1) return;
        finished = true;
        ui.subtitle?.('SEN', T.RAMI_REPLY, 3600);
        state.set('rami_met', true);
        this._setTalk('rami', 'Rami ile konuş', () => this._say('rami', T.RAMI_BEFORE, 4200));
      },
    });
  }
}
