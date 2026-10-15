import * as THREE from 'three';
import { SKY_GLSL } from './sky.js';
import { FOG_GLSL } from './water.js';

/**
 * Dev dalga: profili (kesit) ve yanal uzantısı CPU'da üretilen tek geometri; ufuktaki "dağ" dalgalar ve
 * yaklaşan dalga aynı geometri/malzemeyi paylaşır (her biri 1 çizim çağrısı).
 *
 * Yerel eksenler: x = ilerleme ekseninin tersi... dalga AYAĞI x = 0'dadır, tepe x ≈ +100'dedir (arka yamaç +x),
 * y yukarı (taban profil yüksekliği 100 m), z yanal (±HALF_W). Mesh uniform ölçeklenir.
 */
export const WAVE_BASE_H = 100;
const HALF_W = 520;

// (x, y) kesit: dik ön yüz (oyuncuya bakan), hafif öne sarkan tepe, uzun arka yamaç
const PROFILE = [
  [0, 0], [8, 4], [15, 14], [21, 28], [26, 44], [32, 60], [39, 76], [48, 89], [60, 97], [74, 100],
  [88, 97], [110, 88], [150, 72], [200, 52], [260, 32], [330, 14], [400, 4], [460, 0],
];

function hashN(i) {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function buildWaveGeometry(segZ = 72) {
  const np = PROFILE.length;
  const pos = [];
  const hf = []; // yükseklik oranı (köpük için)
  for (let j = 0; j <= segZ; j++) {
    const u = j / segZ;
    const z = (u * 2 - 1) * HALF_W;
    const edge = 1 - Math.pow(Math.abs(u * 2 - 1), 5.5);
    // pürüz: yavaş değişen genlik
    const k = Math.floor(j / 2);
    const f = (j % 2) * 0.5;
    const rough = 0.82 + 0.18 * (hashN(k) * (1 - f) + hashN(k + 1) * f);
    const m = Math.max(0.04, edge * rough);
    const bow = Math.pow(u * 2 - 1, 2) * 55; // uçlar geriye kıvrılır
    for (let i = 0; i < np; i++) {
      const [px, py] = PROFILE[i];
      pos.push(px + bow, py * m, z);
      hf.push(py / WAVE_BASE_H);
    }
  }
  const idx = [];
  for (let j = 0; j < segZ; j++) {
    for (let i = 0; i < np - 1; i++) {
      const a = j * np + i;
      const b = a + 1;
      const c = a + np;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aH', new THREE.Float32BufferAttribute(hf, 1));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

export function createWaveMaterial(U) {
  return new THREE.ShaderMaterial({
    uniforms: U,
    side: THREE.DoubleSide,
    fog: false,
    vertexShader: /* glsl */ `
      uniform vec3 uOrigin;
      attribute float aH;
      varying vec3 vWorld;
      varying vec3 vN;
      varying float vH;
      varying float vY;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz - uOrigin;
        vN = normalize(mat3(modelMatrix) * normal);
        vH = aH;
        vY = position.y / ${WAVE_BASE_H.toFixed(1)};
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vN;
      varying float vH;
      varying float vY;
      ${SKY_GLSL}
      ${FOG_GLSL}
      void main() {
        vec3 toCam = cameraPosition - uOrigin - vWorld;
        float dist = length(toCam);
        vec3 v = toCam / dist;
        vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);

        // yüzey kırışıklığı (iri, uzamış)
        vec2 q = vec2(vWorld.x + vWorld.z, vWorld.y * 0.5);
        float rip = vnoise(q * 0.045 + vec2(uTime * 0.05, 0.0)) - 0.5;
        n = normalize(n + vec3(rip * 0.22, rip * 0.10, -rip * 0.22));

        vec3 rd = reflect(-v, n);
        rd.y = abs(rd.y) + 0.002;
        vec3 refl = skyColor(normalize(rd), 0.0);
        float fres = 0.03 + 0.97 * pow(1.0 - max(dot(n, v), 0.0), 5.0);

        vec3 deep = vec3(0.005, 0.014, 0.020);
        // tepeye doğru yarı saydam yeşil-mavi ışık geçirme
        vec3 sss = vec3(0.05, 0.12, 0.125) * smoothstep(0.5, 1.0, vH);
        vec3 body = deep + sss;
        // eski ufuk: yüksek yüzey hafif aydınlanır
        body += vec3(0.008, 0.012, 0.014) * vY;
        vec3 col = mix(body, refl, clamp(fres, 0.0, 1.0));

        // köpük: tepe ve düşey şeritler
        float streak = fbm4(vec2(vWorld.x * 0.05 + vWorld.z * 0.035, vY * 6.0 + vWorld.z * 0.02));
        float foam = smoothstep(0.86, 0.97, vH + (streak - 0.5) * 0.18);
        foam += smoothstep(0.75, 0.93, vH) * smoothstep(0.55, 0.8, streak) * 0.35;
        col = mix(col, vec3(0.62, 0.70, 0.73), clamp(foam, 0.0, 1.0));

        col = mix(col, uHorizon, fogAmount(dist));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

/**
 * Dalga sistemi (oyuncuya göre ilerler).
 *   wave.active / distance / height
 *   wave.start({ fromDistance = 600, speed = 22, height = 110, direction })   direction: radyan (planet yerelinde XZ'de gelen yön)
 *   wave.stop()      dalga durur (donar), uyarı sıfırlanır
 *   wave.reset()     dalgayı ufka (≈1150 m) geri koyar; ufukta dağ gibi görünür
 * Olaylar: planet:wave_warning { distance }, planet:wave_hit, planet:wave_passed
 */
export class WaveSystem {
  constructor(ctx, root, U, origin) {
    this.ctx = ctx;
    this.origin = origin;
    this.active = false;
    this.distance = Infinity;
    this.height = 110;
    this.speed = 22;
    this.warnAt = 350;
    this.hitAt = 8;
    this._warned = false;
    this._stopped = false;
    this._retreating = false;
    this._s = 0; // dalga ayağının ilerleme ekseni üzerindeki konumu (yerel)
    this._lat = 0; // yanal merkez
    this._dir = new THREE.Vector2(0.75, -0.66).normalize();

    const geo = buildWaveGeometry();
    const mat = createWaveMaterial(U);
    this.group = new THREE.Group();
    this.group.name = 'planet-waves';
    root.add(this.group);

    // ufuktaki durağan "dağ" dalgalar (ana dalganın kendisi de ufukta bekler)
    this.mountains = [];
    const spots = [
      [-2.35, 1180, 1.25], [-1.55, 1060, 1.05], [-0.7, 1240, 1.5], [0.35, 1120, 0.95],
      [1.25, 1210, 1.35], [2.0, 1090, 1.1], [2.75, 1230, 1.45],
    ];
    for (const [ang, r, sc] of spots) {
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      const dx = Math.cos(ang);
      const dz = Math.sin(ang);
      m.position.set(dx * r, 0, dz * r);
      m.rotation.y = Math.atan2(-dz, dx);
      m.scale.setScalar(sc);
      this.group.add(m);
      this.mountains.push(m);
    }
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'planet-wave';
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    this._applyDir(Math.atan2(this._dir.y, this._dir.x));
    this.reset();
  }

  _playerLocal(out) {
    const p = this.ctx.player.position;
    return out.set(p.x - this.origin.x, p.z - this.origin.z);
  }

  _applyDir(angle) {
    this._dir.set(Math.cos(angle), Math.sin(angle));
    this.mesh.rotation.y = Math.atan2(-this._dir.y, this._dir.x);
  }

  start({ fromDistance = 600, speed = 22, height = 110, direction } = {}) {
    if (direction !== undefined) this._applyDir(direction);
    this.speed = speed;
    this.height = height;
    this.mesh.scale.setScalar(height / WAVE_BASE_H);
    const p = this._playerLocal(_v2);
    this._s = p.dot(this._dir) + fromDistance;
    this._lat = p.x * -this._dir.y + p.y * this._dir.x;
    this.distance = fromDistance;
    this.active = true;
    this._stopped = false;
    this._retreating = false;
    this._warned = false;
    this._place();
  }

  stop() {
    this.active = false;
    this._stopped = true;
    this._retreating = false;
  }

  reset() {
    const p = this._playerLocal(_v2);
    this.active = false;
    this._stopped = false;
    this._retreating = false;
    this._warned = false;
    this.height = 110;
    this.mesh.scale.setScalar(this.height / WAVE_BASE_H);
    this._s = p.dot(this._dir) + 1150;
    this._lat = p.x * -this._dir.y + p.y * this._dir.x;
    this.distance = 1150;
    this._place();
  }

  _place() {
    const d = this._dir;
    this.mesh.position.set(d.x * this._s - d.y * this._lat, 0, d.y * this._s + d.x * this._lat);
  }

  update(dt) {
    const bus = this.ctx.bus;
    const p = this._playerLocal(_v2);
    const proj = p.dot(this._dir);
    const latP = p.x * -this._dir.y + p.y * this._dir.x;

    if (!this._stopped) {
      // yanal merkez oyuncuyu yumuşakça izler (dalga kaçırılamaz)
      this._lat += (latP - this._lat) * Math.min(1, dt * 0.3);
      if (this.active) this._s -= this.speed * dt;
      else if (this._retreating) this._s += 80 * dt;
    }
    this.distance = this._s - proj;

    if (this.active) {
      if (!this._warned && this.distance < this.warnAt) {
        this._warned = true;
        bus.emit('planet:wave_warning', { distance: this.distance });
        this.ctx.audio?.play('alarm');
      }
      if (this.distance <= this.hitAt) {
        this.active = false;
        this._retreating = true;
        bus.emit('planet:wave_hit', { distance: this.distance });
        this.ctx.audio?.play('alarm');
      }
    } else if (this._retreating && this.distance > 1100) {
      this._retreating = false;
      bus.emit('planet:wave_passed', {});
    }
    this._place();
  }

  /** Kamera sarsıntı şiddeti 0..1 (dalga yaklaştıkça artar). */
  get shake() {
    if (!this.active && !this._retreating) return 0;
    const d = Math.max(0, this.distance);
    const k = 1 - Math.min(1, d / 280);
    return k * k;
  }
}

const _v2 = new THREE.Vector2();
