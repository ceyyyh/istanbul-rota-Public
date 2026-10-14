import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { PlayerController } from '../../src/player/PlayerController.js';
import { CollisionWorld } from '../../src/player/collision.js';
import { EventBus } from '../../src/core/EventBus.js';
import * as L from '../../src/world/ShipLayout.js';
import { FakeInput, recordEvents } from './_helpers.js';

const DT = 1 / 60;

function setup() {
  const bus = new EventBus();
  const input = new FakeInput();
  const collision = new CollisionWorld();
  const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 100);
  const player = new PlayerController({ camera, input, collision, bus });
  const step = (seconds) => {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) {
      player.update(DT);
      input.endFrame();
    }
  };
  return { bus, input, collision, camera, player, step };
}

describe('PlayerController', () => {
  let t;
  beforeEach(() => {
    t = setup();
  });

  it('yaw=0 iken ileri -Z yönüdür; yürüme hızı ≈ 2.7 m/s', () => {
    const { player, input, step } = t;
    player.teleport(0, 0, 0);
    input.axis.y = 1;
    step(0.5); // hızlanma
    const z0 = player.position.z;
    step(1);
    expect(player.position.x).toBeCloseTo(0, 6);
    expect(z0 - player.position.z).toBeCloseTo(2.7, 1);
    const f = player.getForward();
    expect(f.z).toBeCloseTo(-1, 6);
  });

  it('duvara yürüyünce duvar - yarıçap mesafesinde durur', () => {
    const { player, input, collision, step } = t;
    collision.addSegment(-5, -2, 5, -2);
    player.teleport(0, 0, 0);
    input.axis.y = 1;
    step(3);
    expect(player.position.z).toBeGreaterThanOrEqual(-2 + player.radius - 1e-3);
    expect(player.position.z).toBeLessThan(-2 + player.radius + 0.05);
    // duvara sürtünürken hız gerçek harekete iner (birikmez)
    expect(Math.abs(player.velocity.z)).toBeLessThan(0.1);
  });

  it('duvara çapraz yürüyüşte duvar boyunca kayar', () => {
    const { player, input, collision, step } = t;
    collision.addSegment(-50, -1, 50, -1);
    player.teleport(0, -0.5, -Math.PI / 4); // ileri = (+x, -z) çaprazı
    input.axis.y = 1;
    step(3);
    expect(player.position.z).toBeGreaterThanOrEqual(-1 + player.radius - 1e-3);
    // kayma: x yönünde ilerleme devam eder (≈ hız·cos45·t)
    expect(player.position.x).toBeGreaterThan(4);
  });

  it('zıplama: player:jump, havada y > 0, iniş y = 0 ve player:land', () => {
    const { player, input, bus, step } = t;
    const ev = recordEvents(bus, 'player:jump', 'player:land');
    player.teleport(0, 0, 0);
    input.press('jump');
    player.update(DT);
    input.endFrame();
    expect(ev.map((e) => e.type)).toEqual(['player:jump']);
    expect(player.onGround).toBe(false);
    let maxY = 0;
    let airTime = DT;
    while (!player.onGround && airTime < 3) {
      player.update(DT);
      input.endFrame();
      maxY = Math.max(maxY, player.position.y);
      airTime += DT;
    }
    expect(player.onGround).toBe(true);
    expect(player.position.y).toBe(0);
    expect(ev.map((e) => e.type)).toEqual(['player:jump', 'player:land']);
    // v²/2g = 3.2²/(2·9.81) ≈ 0.52 m ; uçuş ≈ 2v/g ≈ 0.65 s
    expect(maxY).toBeGreaterThan(0.45);
    expect(maxY).toBeLessThan(0.6);
    expect(airTime).toBeGreaterThan(0.55);
    expect(airTime).toBeLessThan(0.75);
  });

  it('havadayken tekrar zıplanamaz; eğilirken zıplanamaz', () => {
    const { player, input, bus, step } = t;
    const ev = recordEvents(bus, 'player:jump');
    player.teleport(0, 0, 0);
    input.press('jump');
    step(DT);
    input.press('jump');
    step(DT);
    expect(ev).toHaveLength(1);
    step(1);
    input.held.add('crouch');
    step(0.5);
    input.press('jump');
    step(DT);
    expect(ev).toHaveLength(1);
  });

  it('eğilme: hız ≈ 1.4 m/s, göz yüksekliği ≈ 1.05 m; bırakınca ayağa kalkar', () => {
    const { player, input, camera, step } = t;
    player.teleport(0, 0, 0);
    player.headBob = false;
    input.held.add('crouch');
    input.axis.y = 1;
    step(1);
    const z0 = player.position.z;
    step(1);
    expect(z0 - player.position.z).toBeCloseTo(1.4, 1);
    expect(player.height).toBeCloseTo(1.2, 2);
    expect(camera.position.y).toBeCloseTo(1.05, 2);
    input.held.delete('crouch');
    step(1);
    expect(player.height).toBeCloseTo(1.8, 2);
    expect(camera.position.y).toBeCloseTo(1.65, 2);
  });

  it('eğilerek alçak kirişin altından geçilir, ayaktayken geçilemez', () => {
    const { player, input, collision, step } = t;
    collision.addSegment(-5, -1.5, 5, -1.5, { yMin: 1.4, yMax: 3 });
    player.teleport(0, 0, 0);
    input.axis.y = 1;
    step(2);
    expect(player.position.z).toBeGreaterThan(-1.5);
    player.teleport(0, 0, 0);
    input.held.add('crouch');
    step(0.5);
    step(2);
    expect(player.position.z).toBeLessThan(-2);
  });

  it('koşu (sprint) ≈ 5 m/s ve FOV artar; eğilirken koşulmaz', () => {
    const { player, input, camera, step } = t;
    player.teleport(0, 0, 0);
    input.axis.y = 1;
    input.held.add('sprint');
    step(1);
    const z0 = player.position.z;
    step(1);
    expect(z0 - player.position.z).toBeCloseTo(5, 1);
    expect(camera.fov).toBeGreaterThan(player.baseFov + 3);
    input.held.add('crouch');
    step(1);
    const z1 = player.position.z;
    step(1);
    expect(z1 - player.position.z).toBeCloseTo(1.4, 1);
  });

  it('frozen veya input.enabled=false iken hareket ve bakış yok', () => {
    const { player, input, step } = t;
    player.teleport(0, 0, 0.3);
    input.axis.y = 1;
    player.frozen = true;
    input.addLookDelta(100, 50);
    step(1);
    expect(player.position.length()).toBeLessThan(1e-6);
    expect(player.yaw).toBeCloseTo(0.3, 9);
    player.frozen = false;
    input.enabled = false;
    input.addLookDelta(100, 50);
    step(1);
    expect(player.position.length()).toBeLessThan(1e-6);
    expect(player.yaw).toBeCloseTo(0.3, 9);
  });

  it('fare bakışı: yaw/pitch değişir, pitch ±1.5 ile sınırlı; invertY', () => {
    const { player, input, step } = t;
    player.teleport(0, 0, 0);
    input.addLookDelta(100, 0);
    step(DT);
    expect(player.yaw).toBeCloseTo(-100 * player.sensitivity, 9);
    input.addLookDelta(0, -100000);
    step(DT);
    expect(player.pitch).toBeCloseTo(1.5, 9);
    player.invertY = true;
    input.addLookDelta(0, -100);
    step(DT);
    expect(player.pitch).toBeLessThan(1.5);
  });

  describe('faceDirection', () => {
    it('verilen yöne süre sonunda bakar (+X → yaw = -π/2)', () => {
      const { player, step } = t;
      player.teleport(0, 0, 0);
      player.faceDirection(new THREE.Vector3(1, 0, 0), 0.5);
      step(0.6);
      const f = player.getForward();
      expect(f.x).toBeCloseTo(1, 4);
      expect(player.yaw).toBeCloseTo(-Math.PI / 2, 4);
    });

    it('yukarı bileşen pitch üretir', () => {
      const { player, step } = t;
      player.teleport(0, 0, 0);
      player.faceDirection(new THREE.Vector3(0, 1, -1), 0.3);
      step(0.4);
      expect(player.pitch).toBeCloseTo(Math.PI / 4, 4);
      expect(player.getForward().y).toBeCloseTo(Math.SQRT1_2, 4);
    });

    it('en kısa yoldan döner (±π sınırında uzun tur atmaz)', () => {
      const { player, step } = t;
      player.teleport(0, 0, 3.0);
      player.faceDirection(new THREE.Vector3(-Math.sin(-3.0), 0, -Math.cos(-3.0)), 0.5);
      let maxDev = 0;
      for (let i = 0; i < 40; i++) {
        step(DT);
        const d = Math.atan2(Math.sin(player.yaw - 3.0), Math.cos(player.yaw - 3.0));
        maxDev = Math.max(maxDev, Math.abs(d));
      }
      // 3.0 → -3.0 en kısa yol 2π-6 ≈ 0.283 rad
      expect(maxDev).toBeLessThan(0.3);
      expect(player.getForward().x).toBeCloseTo(-Math.sin(-3.0), 4);
    });

    it('oyuncu donukken de (sinematik) çalışır ve fare girdisini bastırır', () => {
      const { player, input, step } = t;
      player.teleport(0, 0, 0);
      player.frozen = true;
      player.faceDirection(new THREE.Vector3(-1, 0, 0), 0.2);
      input.addLookDelta(500, 0);
      step(0.3);
      expect(player.yaw).toBeCloseTo(Math.PI / 2, 4);
    });

    it('teleport devam eden yönlendirmeyi iptal eder', () => {
      const { player, step } = t;
      player.teleport(0, 0, 0);
      player.faceDirection(new THREE.Vector3(1, 0, 0), 1);
      step(0.2);
      player.teleport(0, 0, 0.5);
      step(1);
      expect(player.yaw).toBeCloseTo(0.5, 9);
    });
  });

  describe('konum ve player:module', () => {
    it('teleport her zaman player:module yayar ve location günceller', () => {
      const { player, bus } = t;
      const ev = recordEvents(bus, 'player:module');
      const s = L.spawnPoint('engine');
      player.teleport(s.x, s.z, s.yaw);
      expect(ev).toHaveLength(1);
      expect(ev[0].payload).toMatchObject({ index: 6, id: 'engine' });
      expect(player.location).toMatchObject({ index: 6, id: 'engine', region: 'module' });
      player.teleport(s.x, s.z, s.yaw);
      expect(ev).toHaveLength(2); // force
    });

    it('modül sınırını yürüyerek geçince bir kez player:module {index,id,prev}', () => {
      const { player, input, bus, step } = t;
      const s = L.spawnPoint('cryo', 4, 0, 0); // cryo +X ucu, quarters'a bakar
      player.teleport(s.x, s.z, s.yaw);
      const ev = recordEvents(bus, 'player:module');
      input.axis.y = 1;
      step(5);
      expect(ev).toHaveLength(1);
      expect(ev[0].payload).toEqual({ index: 2, id: 'quarters', prev: 1 });
      expect(player.location.id).toBe('quarters');
    });

    it('yürürken player:footstep yayar (index ve sprint ile)', () => {
      const { player, input, bus, step } = t;
      const ev = recordEvents(bus, 'player:footstep');
      const s = L.spawnPoint('lab');
      player.teleport(s.x, s.z, s.yaw);
      input.axis.y = 1;
      step(2);
      expect(ev.length).toBeGreaterThanOrEqual(3);
      expect(ev[0].payload).toEqual({ index: 4, sprint: false });
      input.held.add('sprint');
      step(1);
      expect(ev.at(-1).payload.sprint).toBe(true);
    });

    it('dururken adım sesi yok', () => {
      const { player, bus, step } = t;
      const ev = recordEvents(bus, 'player:footstep');
      player.teleport(0, 0, 0);
      step(2);
      expect(ev).toHaveLength(0);
    });
  });

  it('noclip: bakış yönünde 3B serbest uçuş, çarpışma yok', () => {
    const { player, input, collision, step } = t;
    collision.addSegment(-5, -1, 5, -1);
    player.teleport(0, 0, 0);
    player.noclip = true;
    player.pitch = Math.PI / 4;
    player._face = null;
    input.axis.y = 1;
    step(1);
    expect(player.position.z).toBeLessThan(-3); // duvardan geçti
    expect(player.position.y).toBeGreaterThan(3);
  });

  it('fovOverride: yumuşakça hedef FOV\'a gider, null ile geri döner', () => {
    const { player, camera, step } = t;
    player.teleport(0, 0, 0);
    player.fovOverride = 20;
    step(2);
    expect(camera.fov).toBeCloseTo(20, 0);
    player.fovOverride = null;
    step(2);
    expect(camera.fov).toBeCloseTo(player.baseFov, 0);
  });

  it('büyük dt sıçramasında (sekme değişimi) duvardan geçmez', () => {
    const { player, input, collision } = t;
    collision.addSegment(-5, -1, 5, -1);
    player.teleport(0, 0, 0);
    input.axis.y = 1;
    for (let i = 0; i < 30; i++) player.update(0.25);
    expect(player.position.z).toBeGreaterThan(-1);
  });
});
