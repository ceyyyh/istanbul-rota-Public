import * as THREE from 'three';
import { locate } from '../world/ShipLayout.js';

const STAND_HEIGHT = 1.8;
const CROUCH_HEIGHT = 1.2;
const STAND_EYE = 1.65;
const CROUCH_EYE = 1.05;
const GRAVITY = 9.81;
const JUMP_SPEED = 3.2;
const STEP_HEIGHT = 0.3;

/**
 * Birinci şahıs oyuncu kontrolcüsü.
 *
 * Herkese açık API (diğer sistemler kullanabilir):
 *   player.position        THREE.Vector3 — ayak konumu (dünya)
 *   player.yaw / pitch     radyan (yaw=0 → -Z'ye bakar)
 *   player.frozen          true → hareket ve bakış kapalı (sinematik, terminal)
 *   player.noclip          true → serbest uçuş (hata ayıklama)
 *   player.sensitivity     fare hassasiyeti (radyan/piksel)
 *   player.invertY         dikey bakışı ters çevir
 *   player.baseFov         temel görüş alanı (derece)
 *   player.fovOverride     sayı → yumuşakça bu FOV'a geç (teleskop), null → normal
 *   player.teleport(x, z, yaw?, pitch?)
 *   player.faceDirection(dirVec3, seconds?) — bakışı bir yöne yumuşakça çevirir
 *   player.getForward(out?) — bakış yönü (birim vektör)
 *   player.location         { index, id, lx, lz, region } (her kare güncellenir)
 *
 * Olaylar: 'player:footstep' {index, sprint}, 'player:module' {index, id, prev}, 'player:jump', 'player:land'
 */
export class PlayerController {
  constructor({ camera, input, collision, bus }) {
    this.camera = camera;
    this.input = input;
    this.collision = collision;
    this.bus = bus;

    this.position = new THREE.Vector3(0, 0, 0);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.radius = 0.3;
    this.onGround = true;
    this.crouch = 0; // 0..1
    this.frozen = false;
    this.noclip = false;

    this.walkSpeed = 2.7;
    this.sprintSpeed = 5.0;
    this.crouchSpeed = 1.4;
    this.sensitivity = 0.0022;
    this.invertY = false;
    this.baseFov = 75;
    this.fovOverride = null;
    this.headBob = true;

    this._bob = 0;
    this._bobAmount = 0;
    this._lastStepPhase = 0;
    this._face = null;
    this.location = locate(0, 0);
    this._moduleIndex = -1;
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
  }

  get height() {
    return THREE.MathUtils.lerp(STAND_HEIGHT, CROUCH_HEIGHT, this.crouch);
  }

  get eyeHeight() {
    return THREE.MathUtils.lerp(STAND_EYE, CROUCH_EYE, this.crouch);
  }

  teleport(x, z, yaw = this.yaw, pitch = 0) {
    this.position.set(x, 0, z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = pitch;
    this._face = null;
    this._syncCamera(0);
    this._updateLocation(true);
  }

  getForward(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyEuler(this._euler.set(this.pitch, this.yaw, 0, 'YXZ'));
  }

  /** Bakışı verilen dünya yönüne `seconds` sürede çevirir. */
  faceDirection(dir, seconds = 0.8) {
    const d = dir.clone().normalize();
    const targetYaw = Math.atan2(-d.x, -d.z);
    const targetPitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
    // en kısa yoldan dön
    let dy = targetYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this._face = {
      fromYaw: this.yaw,
      toYaw: this.yaw + dy,
      fromPitch: this.pitch,
      toPitch: targetPitch,
      t: 0,
      dur: Math.max(0.01, seconds),
    };
  }

  update(dt) {
    const input = this.input;
    const active = !this.frozen && input.enabled;

    // --- Bakış ---
    const look = input.consumeLook();
    if (this._face) {
      const f = this._face;
      f.t = Math.min(1, f.t + dt / f.dur);
      const e = f.t * f.t * (3 - 2 * f.t);
      this.yaw = THREE.MathUtils.lerp(f.fromYaw, f.toYaw, e);
      this.pitch = THREE.MathUtils.lerp(f.fromPitch, f.toPitch, e);
      if (f.t >= 1) this._face = null;
    } else if (active) {
      this.yaw -= look.dx * this.sensitivity;
      this.pitch -= look.dy * this.sensitivity * (this.invertY ? -1 : 1);
      this.pitch = THREE.MathUtils.clamp(this.pitch, -1.5, 1.5);
    }

    // --- Hareket ---
    const axis = active ? input.getMoveAxis() : { x: 0, y: 0 };
    const wantsCrouch = active && input.actionDown('crouch');
    this.crouch = THREE.MathUtils.damp(this.crouch, wantsCrouch ? 1 : 0, 12, dt);
    const sprinting = active && input.actionDown('sprint') && axis.y > 0.1 && this.crouch < 0.3;

    if (this.noclip) {
      this._updateNoclip(dt, axis, active);
    } else {
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      // ileri = (-sin, -cos), sağ = (cos, -sin)
      const wishX = -sin * axis.y + cos * axis.x;
      const wishZ = -cos * axis.y - sin * axis.x;
      const speed = this.crouch > 0.5 ? this.crouchSpeed : sprinting ? this.sprintSpeed : this.walkSpeed;
      const accel = this.onGround ? 14 : 3;
      this.velocity.x = THREE.MathUtils.damp(this.velocity.x, wishX * speed, accel, dt);
      this.velocity.z = THREE.MathUtils.damp(this.velocity.z, wishZ * speed, accel, dt);

      // Dikey
      if (active && this.onGround && input.actionPressed('jump') && this.crouch < 0.3) {
        this.velocity.y = JUMP_SPEED;
        this.onGround = false;
        this.bus.emit('player:jump');
      }
      if (!this.onGround) {
        this.velocity.y -= GRAVITY * dt;
        this.position.y += this.velocity.y * dt;
        if (this.position.y <= 0) {
          this.position.y = 0;
          this.velocity.y = 0;
          this.onGround = true;
          this.bus.emit('player:land');
        }
      }

      // Yatay + çarpışma
      const target = { x: this.position.x + this.velocity.x * dt, z: this.position.z + this.velocity.z * dt };
      const yMin = this.position.y + STEP_HEIGHT;
      const yMax = this.position.y + this.height;
      const res = this.collision.move(this.position, target, this.radius, yMin, yMax);
      if (dt > 0) {
        // duvara sürtünürken hızı gerçek harekete indir (kaymayı korur)
        this.velocity.x = (res.x - this.position.x) / dt;
        this.velocity.z = (res.z - this.position.z) / dt;
      }
      this.position.x = res.x;
      this.position.z = res.z;

      // Kafa sallanması ve adım sesleri
      const hSpeed = Math.hypot(this.velocity.x, this.velocity.z);
      const moving = this.onGround && hSpeed > 0.4;
      this._bobAmount = THREE.MathUtils.damp(this._bobAmount, moving ? Math.min(1, hSpeed / this.walkSpeed) : 0, 8, dt);
      if (moving) {
        this._bob += dt * (sprinting ? 11.5 : 8.2);
        const phase = Math.floor(this._bob / Math.PI);
        if (phase !== this._lastStepPhase) {
          this._lastStepPhase = phase;
          this.bus.emit('player:footstep', { index: this.location.index, sprint: sprinting });
        }
      }
    }

    this._syncCamera(dt, sprinting);
    this._updateLocation(false);
  }

  _updateNoclip(dt, axis, active) {
    const fwd = this.getForward(new THREE.Vector3());
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const speed = this.input.actionDown('sprint') ? 25 : 8;
    const up = active ? (this.input.actionDown('jump') ? 1 : 0) - (this.input.actionDown('crouch') ? 1 : 0) : 0;
    this.position.addScaledVector(fwd, axis.y * speed * dt);
    this.position.addScaledVector(right, axis.x * speed * dt);
    this.position.y += up * speed * dt;
  }

  _syncCamera(dt, sprinting = false) {
    const bob = this.headBob ? this._bobAmount : 0;
    const by = Math.abs(Math.sin(this._bob)) * 0.045 * bob;
    const bx = Math.cos(this._bob) * 0.025 * bob;
    const eye = this.noclip ? 0 : this.eyeHeight;
    this.camera.position.set(this.position.x, this.position.y + eye + by, this.position.z);
    this.camera.rotation.set(this.pitch, this.yaw, Math.sin(this._bob) * 0.004 * bob, 'YXZ');
    // yan sallanmayı kameranın sağ eksenine uygula
    this.camera.position.x += Math.cos(this.yaw) * bx;
    this.camera.position.z += -Math.sin(this.yaw) * bx;

    const targetFov = this.fovOverride ?? this.baseFov + (sprinting ? 6 : 0);
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov = dt > 0 ? THREE.MathUtils.damp(this.camera.fov, targetFov, 6, dt) : targetFov;
      this.camera.updateProjectionMatrix();
    }
  }

  _updateLocation(force) {
    this.location = locate(this.position.x, this.position.z);
    if (force || this.location.index !== this._moduleIndex) {
      const prev = this._moduleIndex;
      this._moduleIndex = this.location.index;
      this.bus.emit('player:module', { index: this.location.index, id: this.location.id, prev });
    }
  }
}
