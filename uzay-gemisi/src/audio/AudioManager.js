/**
 * Ses (TASLAK — Ajan 6 "Arayüz & Ses" yeniden yazacak; API sabit kalmalı).
 * Tamamen prosedürel WebAudio (harici ses dosyası yok).
 *
 * API:
 *   audio.unlock()                         — ilk kullanıcı hareketinde (tıklama) çağrılır
 *   audio.play(name, { volume, position }) — name: 'beep' | 'click' | 'door' | 'door_locked' | 'footstep' |
 *        'alarm' | 'power_up' | 'power_down' | 'error' | 'success' | 'tick' | 'spin_up' | 'terminal' |
 *        'switch' | 'hiss' | 'servo' | 'airlock'
 *        position (THREE.Vector3, opsiyonel) → 3B konumlu ses
 *   audio.setAmbient(name|null)            — 'emergency' | 'normal' | null
 *   audio.speak(text, { voice: 'tars' })   — konuşma sentezi (TARS); Promise döner
 *   audio.setMasterVolume(0..1), audio.setMusicVolume(0..1)
 *   audio.update(dt)
 */
export class AudioManager {
  constructor(ctx) {
    this.ctx = ctx;
    this.master = 0.8;
  }
  unlock() {}
  play() {}
  setAmbient() {}
  speak() {
    return Promise.resolve();
  }
  setMasterVolume(v) {
    this.master = v;
  }
  setMusicVolume() {}
  update() {}
}
