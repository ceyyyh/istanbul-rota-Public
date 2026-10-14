import * as THREE from 'three';
import { EventBus } from './core/EventBus.js';
import { Engine } from './core/Engine.js';
import { GameState } from './core/GameState.js';
import { Input } from './core/Input.js';
import { CollisionWorld } from './player/collision.js';
import { PlayerController } from './player/PlayerController.js';
import { InteractionSystem } from './interaction/InteractionSystem.js';
import { LightingManager } from './world/Lighting.js';
import { getMaterials, registerPowerMaterials } from './world/materials.js';
import * as ShipLayout from './world/ShipLayout.js';
import { Ship } from './world/Ship.js';
import { SpaceEnvironment } from './space/SpaceEnvironment.js';
import { UI } from './ui/UI.js';
import { TouchControls } from './ui/TouchControls.js';
import { AudioManager } from './audio/AudioManager.js';
import { Tars } from './gameplay/Tars.js';
import { Missions } from './gameplay/Missions.js';

/*
 * URL parametreleri (geliştirme / test):
 *   ?autostart=1          başlangıç ekranını atla (fare kilidi yok; ekran görüntüsü için)
 *   ?nointro=1            giriş sinematiğini atla
 *   ?tp=engine            belirtilen modülde başla   (&pos=lx,lz,yerelYawDerece)
 *   ?cam=x,y,z,yaw,pitch  serbest kamera (derece; noclip açılır)
 *   ?flags=a,b            başlangıçta bayrakları doğru yap (ör. power_restored)
 *   ?quality=low|medium|high
 *   ?debug=1              N: noclip, FPS göstergesi, konsol günlükleri
 */
function showBootError(err) {
  const el = document.getElementById('boot-error');
  if (!el) return;
  el.style.display = 'block';
  el.textContent += `${err?.stack || err?.message || err}\n`;
}
window.addEventListener('error', (e) => showBootError(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => showBootError(e.reason));

function boot() {
  const params = new URLSearchParams(location.search);
  const debug = params.has('debug');
  const container = document.getElementById('app');

  const bus = new EventBus();
  const engine = new Engine(container, bus);
  const isTouch = TouchControls.isTouchDevice();
  const qualityName = params.get('quality') || (isTouch ? 'low' : 'high');
  engine.setQuality(qualityName);

  const state = new GameState(bus);
  const input = new Input(engine.renderer.domElement, bus);
  const collision = new CollisionWorld();
  const lighting = new LightingManager(engine.scene, engine.quality.lights);
  bus.on('engine:quality', ({ quality }) => lighting.setPoolSize(quality.lights));

  /** Tüm sistemlerin paylaştığı oyun bağlamı. Sözleşme: docs/ARCHITECTURE.md */
  const ctx = {
    THREE,
    engine,
    scene: engine.scene,
    camera: engine.camera,
    renderer: engine.renderer,
    bus,
    state,
    input,
    collision,
    lighting,
    layout: ShipLayout,
    materials: getMaterials(),
    params,
    debug,
    isTouch,
    onUpdate: (fn, priority) => engine.onUpdate(fn, priority),
  };

  ctx.ui = new UI(ctx);
  ctx.audio = new AudioManager(ctx);
  ctx.player = new PlayerController({ camera: engine.camera, input, collision, bus });
  ctx.interactions = new InteractionSystem({ camera: engine.camera, input, bus, getUI: () => ctx.ui });
  ctx.space = new SpaceEnvironment(ctx);
  /** createDoor() her kapıyı buraya ekler */
  ctx.doors = [];
  /** Kapıları otomatik açan konumlar (THREE.Vector3). TARS kendi konumunu ekler. */
  ctx.doorOpeners = [ctx.player.position];
  registerPowerMaterials(ctx.materials, lighting);

  const t0 = performance.now();
  ctx.ship = new Ship(ctx).build();
  if (debug) console.info(`[boot] gemi ${(performance.now() - t0).toFixed(0)} ms'de kuruldu`, ctx.ship.modules.map((m) => `${m.id}:${m.ms.toFixed(0)}ms`));

  ctx.tars = new Tars(ctx);
  ctx.missions = new Missions(ctx);
  if (isTouch) ctx.touch = new TouchControls(ctx);

  // Başlangıç konumu: hiper-uyku bölmesi
  const sp = ShipLayout.spawnPoint('cryo', -2.5, 0);
  ctx.player.teleport(sp.x, sp.z, sp.yaw);

  // Güç durumu → ışıklar
  lighting.setMode('emergency', 0);
  state.when('power_restored', () => lighting.setMode('normal', 2.5));

  // Güncelleme sırası
  engine.onUpdate((dt) => ctx.player.update(dt), -100);
  engine.onUpdate(() => ctx.interactions.update(), -50);
  engine.onUpdate((dt, t) => ctx.space.update(dt, t), 0);
  engine.onUpdate((dt, t) => ctx.tars.update(dt, t), 0);
  engine.onUpdate((dt, t) => ctx.missions.update(dt, t), 0);
  engine.onUpdate((dt, t) => ctx.audio.update(dt, t), 10);
  engine.onUpdate((dt, t) => ctx.ui.update(dt, t), 20);
  if (ctx.touch) engine.onUpdate((dt, t) => ctx.touch.update(dt, t), -110);
  engine.onUpdate((dt, t) => lighting.update(dt, engine.camera.position, t), 100);
  engine.onUpdate(() => input.endFrame(), 1000);

  // --- Hata ayıklama parametreleri ---
  const flags = params.get('flags');
  if (flags) flags.split(',').filter(Boolean).forEach((f) => state.set(f.trim(), true));
  const tp = params.get('tp');
  if (tp) {
    const [lx = 0, lz = 0, lyaw = 0] = (params.get('pos') || '').split(',').map(Number);
    const s = ShipLayout.spawnPoint(tp, lx || 0, lz || 0, THREE.MathUtils.degToRad(lyaw || 0));
    ctx.player.teleport(s.x, s.z, s.yaw);
  }
  const cam = params.get('cam');
  if (cam) {
    const [x, y, z, yaw = 0, pitch = 0] = cam.split(',').map(Number);
    ctx.player.noclip = true;
    ctx.player.position.set(x, y, z);
    ctx.player.yaw = THREE.MathUtils.degToRad(yaw);
    ctx.player.pitch = THREE.MathUtils.degToRad(pitch);
  }
  if (debug) {
    bus.on('input:keydown', (e) => {
      if (e.code === 'KeyN') {
        ctx.player.noclip = !ctx.player.noclip;
        ctx.ui.toast(`Noclip: ${ctx.player.noclip ? 'AÇIK' : 'KAPALI'}`);
      }
    });
    const fpsEl = document.createElement('div');
    fpsEl.style.cssText = 'position:fixed;left:8px;top:8px;font:12px monospace;color:#0f0;z-index:50;pointer-events:none';
    document.body.appendChild(fpsEl);
    engine.onUpdate(() => {
      if (engine.frame % 15) return;
      const p = ctx.player.position;
      const loc = ctx.player.location;
      fpsEl.textContent = `${engine.fps.toFixed(0)} fps | ${engine.renderer.info.render.calls} çağrı | ${loc.id} (${loc.region}) lx=${loc.lx.toFixed(1)} lz=${loc.lz.toFixed(1)} | ${p.x.toFixed(1)},${p.z.toFixed(1)}`;
    }, 50);
  }

  // --- Başlat ---
  let started = false;
  const begin = () => {
    ctx.audio.unlock();
    if (!started) {
      started = true;
      bus.emit('game:start');
      ctx.missions.start({ skipIntro: params.has('nointro') || !!tp || !!cam });
    }
  };
  ctx.begin = begin;
  if (params.has('autostart')) begin();
  else
    ctx.ui.showStart(() => {
      if (!isTouch) input.requestLock();
      begin();
    });

  engine.start();

  // Testler ve ekran görüntüleri için
  let resolveReady;
  const ready = new Promise((r) => (resolveReady = r));
  window.__game = {
    ctx,
    ready,
    get started() {
      return started;
    },
    teleport(id, lx = 0, lz = 0, localYawDeg = 0) {
      const s = ShipLayout.spawnPoint(id, lx, lz, THREE.MathUtils.degToRad(localYawDeg));
      ctx.player.noclip = false;
      ctx.player.teleport(s.x, s.z, s.yaw);
    },
    setFlags(...names) {
      names.forEach((n) => state.set(n, true));
    },
    /** Tuşu basılı tut / bırak (testler): hold('KeyW', true) */
    hold(code, down = true) {
      if (down) input.down.add(code);
      else input.down.delete(code);
    },
    /** Tek seferlik tuş basışı (bir sonraki karede işlenir) */
    press(code) {
      input.pressed.add(code);
    },
    /** Çizim yapmadan `seconds` kadar oyun mantığını ilerletir (sabit 1/60 adım). */
    simulate(seconds, dt = 1 / 60) {
      const n = Math.round(seconds / dt);
      for (let i = 0; i < n; i++) engine.step(dt, false);
    },
  };
  // İlk birkaç kare çizildikten sonra hazır say
  let frames = 0;
  const off = engine.onUpdate(() => {
    if (++frames === 3) {
      off();
      resolveReady(true);
      document.body.dataset.ready = '1';
    }
  }, 2000);
}

try {
  boot();
} catch (err) {
  console.error(err);
  showBootError(err);
}
