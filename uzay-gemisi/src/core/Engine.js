import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/** Grafik kalite ön ayarları. */
export const QUALITY = {
  low: { pixelRatio: 0.75, shadows: false, bloom: false, grain: false, lights: 4, shadowMapSize: 1024 },
  medium: { pixelRatio: 1, shadows: false, bloom: true, grain: true, lights: 6, shadowMapSize: 1024 },
  high: { pixelRatio: 1.5, shadows: true, bloom: true, grain: true, lights: 8, shadowMapSize: 2048 },
};

/** Film greni + vinyet + hafif renk sapması (IMAX/35mm hissi). sRGB çıktısı üzerinde çalışır. */
const FilmShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.045 },
    uVignette: { value: 0.32 },
    uAberration: { value: 0.0012 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uGrain, uVignette, uAberration;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * uAberration * (1.0 + r2 * 4.0);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      float n = hash(vUv * 1000.0 + fract(uTime * 7.13) * 100.0) - 0.5;
      col += n * uGrain;
      col *= 1.0 - uVignette * smoothstep(0.08, 0.55, r2);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/**
 * Oluşturucu, sahneler, kamera, işlem sonrası efektler ve ana döngü.
 *
 * İki sahne çizilir:
 *   1) engine.spaceScene / spaceCamera — uzay (yıldızlar, kara delik, gezegenler).
 *      Kamera her zaman orijinde, sadece dönüş ana kameradan kopyalanır (sonsuz uzaklık).
 *   2) engine.scene / camera — gemi (iç mekân + dış gövde). Arka planı şeffaf, derinliği temizlenir.
 */
export class Engine {
  constructor(container, bus) {
    this.container = container;
    this.bus = bus;
    this.updaters = [];
    this.time = 0;
    this.frame = 0;
    this.paused = false;
    this.renderEnabled = true;
    this.fps = 60;

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    renderer.info.autoReset = false; // birden çok geçiş var; istatistikleri kare başına biz sıfırlarız
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 1500);
    this.scene.add(this.camera);

    this.spaceScene = new THREE.Scene();
    this.spaceScene.background = new THREE.Color(0x000000);
    this.spaceCamera = new THREE.PerspectiveCamera(75, 1, 1, 2e6);

    // PBR yansımaları için ortam haritası (iç mekân için hafif)
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    pmrem.dispose();

    // Çok örnekli (MSAA) ara hedef: kenar yumuşatma işlem sonrası zincirde de korunur
    const isTouch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: isTouch ? 0 : 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.spacePass = new RenderPass(this.spaceScene, this.spaceCamera);
    this.shipPass = new RenderPass(this.scene, this.camera);
    this.shipPass.clear = false;
    this.shipPass.clearDepth = true;
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.6, 0.85);
    this.outputPass = new OutputPass();
    this.filmPass = new ShaderPass(FilmShader);
    this.composer.addPass(this.spacePass);
    this.composer.addPass(this.shipPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.outputPass);
    this.composer.addPass(this.filmPass);

    this.qualityName = 'high';
    this.quality = QUALITY.high;

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
    this._clock = new THREE.Clock();
    this._fpsAcc = 0;
    this._fpsFrames = 0;
  }

  /**
   * Her kare çağrılacak fonksiyon ekler: fn(dt, time).
   * Öncelik küçük olan önce çalışır (oyuncu -100, etkileşim -50, varsayılan 0, ışıklar 100).
   */
  onUpdate(fn, priority = 0) {
    const entry = { fn, priority };
    this.updaters.push(entry);
    this.updaters.sort((a, b) => a.priority - b.priority);
    return () => {
      this.updaters = this.updaters.filter((e) => e !== entry);
    };
  }

  setQuality(name) {
    const q = QUALITY[name] || QUALITY.high;
    const shadowsChanged = this.quality.shadows !== q.shadows || this.renderer.shadowMap.enabled !== q.shadows;
    this.qualityName = QUALITY[name] ? name : 'high';
    this.quality = q;
    this.renderer.shadowMap.enabled = q.shadows;
    this.bloomPass.enabled = q.bloom;
    this.filmPass.enabled = q.grain;
    if (shadowsChanged) {
      this.scene.traverse((o) => {
        if (!o.material) return;
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true));
      });
    }
    this.resize();
    this.bus.emit('engine:quality', { name: this.qualityName, quality: q });
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloomPass.resolution.set(w * pr * 0.5, h * pr * 0.5);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.spaceCamera.aspect = w / h;
    this.spaceCamera.updateProjectionMatrix();
  }

  start() {
    this.renderer.setAnimationLoop(() => this._tick());
  }

  /** Tek bir kare ilerletir (testler için). render=false → sadece mantık. */
  step(dt = 1 / 60, render = true) {
    const prev = this.renderEnabled;
    this.renderEnabled = render;
    this._tick(dt);
    this.renderEnabled = prev;
  }

  _tick(forcedDt) {
    const raw = forcedDt ?? this._clock.getDelta();
    const dt = Math.min(raw, 0.05);
    this._fpsAcc += raw;
    this._fpsFrames++;
    if (this._fpsAcc >= 0.5) {
      this.fps = this._fpsFrames / this._fpsAcc;
      this._fpsAcc = 0;
      this._fpsFrames = 0;
    }
    if (!this.paused) {
      this.time += dt;
      for (const { fn } of this.updaters) {
        try {
          fn(dt, this.time);
        } catch (err) {
          console.error('[engine] güncelleme hatası:', err);
        }
      }
    }
    if (this.renderEnabled) this.render();
    this.frame++;
  }

  render() {
    // Uzay kamerası ana kameranın yönünü ve görüş alanını izler
    this.camera.updateMatrixWorld();
    this.spaceCamera.quaternion.copy(this.camera.quaternion);
    if (this.spaceCamera.fov !== this.camera.fov) {
      this.spaceCamera.fov = this.camera.fov;
      this.spaceCamera.updateProjectionMatrix();
    }
    this.filmPass.uniforms.uTime.value = this.time;
    this.renderer.info.reset();
    this.composer.render();
  }
}
