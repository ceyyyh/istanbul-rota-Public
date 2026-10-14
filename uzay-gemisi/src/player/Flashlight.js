import * as THREE from 'three';

/**
 * Oyuncunun el feneri (F tuşu). Acil durum modunda karanlık koridorlarda işe yarar.
 * Işık sahnede hep vardır; kapalıyken yoğunluğu 0'dır (shader yeniden derlenmesin diye).
 *
 * Olay: 'player:flashlight' (bool)
 */
export class Flashlight {
  constructor({ camera, input, bus, audio }) {
    this.input = input;
    this.bus = bus;
    this.getAudio = audio;
    this.on = false;
    this.power = 22;
    this.light = new THREE.SpotLight(0xfff1dc, 0, 16, 0.42, 0.55, 1.6);
    this.light.position.set(0.18, -0.12, 0);
    this.light.target.position.set(0.05, -0.1, -1);
    camera.add(this.light);
    camera.add(this.light.target);
    this._level = 0;
  }

  toggle(force) {
    this.on = force ?? !this.on;
    this.getAudio()?.play?.('click', { volume: 0.5 });
    this.bus.emit('player:flashlight', this.on);
  }

  update(dt) {
    if (this.input.enabled && this.input.actionPressed('flashlight')) this.toggle();
    this._level = THREE.MathUtils.damp(this._level, this.on ? 1 : 0, 18, dt);
    this.light.intensity = this._level * this.power;
  }
}
