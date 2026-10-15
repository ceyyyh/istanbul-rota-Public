import * as THREE from 'three';

/**
 * Miller gezegeni gökyüzü: bulutlu soğuk gri-mavi kubbe + ufukta sisle solmuş devasa Gargantua.
 * Aynı GLSL işlevi (skyColor) su ve dalga gölgelendiricilerinde yansıma için de kullanılır.
 */

/** Ufuk / sis rengi (doğrusal). Su ve dalga sisi de buna karışır → dikişsiz ufuk. */
export const HORIZON = new THREE.Vector3(0.36, 0.43, 0.47);

/** Gargantua'nın gökteki yönü (birim vektör, gezegen yereli). */
export const GARGANTUA_DIR = new THREE.Vector3(0.42, 0.34, -0.84).normalize();

/** Gölgelendiriciler arası paylaşılan uniform'lar. */
export function createSharedUniforms(origin = { x: 0, z: 0 }) {
  const F = GARGANTUA_DIR.clone();
  const R = new THREE.Vector3().crossVectors(F, new THREE.Vector3(0, 1, 0)).normalize(); // sağ
  const U = new THREE.Vector3().crossVectors(R, F).normalize();
  return {
    uTime: { value: 0 },
    uGF: { value: F },
    uGR: { value: R },
    uGU: { value: U },
    uHorizon: { value: HORIZON.clone() },
    uOrigin: { value: new THREE.Vector3(origin.x, 0, origin.z) },
  };
}

/** Ortak GLSL: gürültü, bulutlar, Gargantua, skyColor(dir). */
export const SKY_GLSL = /* glsl */ `
uniform float uTime;
uniform vec3 uGF;
uniform vec3 uGR;
uniform vec3 uGU;
uniform vec3 uHorizon;
uniform vec3 uOrigin;   // gezegen kökü (kayan nokta hassasiyeti için yerel koordinata çevirmek)

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm4(vec2 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.7);
    a *= 0.5;
  }
  return s;
}

// Gargantua: gölge, foton halkası, merceklenmiş disk yayları, ince disk. Dönüş: ışıma; shadow: karanlık maskesi
vec3 gargantua(vec3 d, out float shadow) {
  shadow = 0.0;
  float f = dot(d, uGF);
  if (f < 0.25) return vec3(0.0);
  const float GS = 0.15;                      // gölge yarıçapı (tan uzayı) ≈ 8.5°
  vec2 p = vec2(dot(d, uGR), dot(d, uGU)) / f / GS;
  float ca = cos(0.10);
  float sa = sin(0.10);
  p = vec2(ca * p.x + sa * p.y, -sa * p.x + ca * p.y);
  float r = length(p);
  if (r > 8.0) return vec3(0.0);
  shadow = 1.0 - smoothstep(0.95, 1.0, r);
  float ring = exp(-pow((r - 1.07) / 0.05, 2.0));
  float arcU = exp(-pow((r - 1.32) / 0.30, 2.0)) * smoothstep(-0.2, 0.3, p.y) * 0.9;
  float arcL = exp(-pow((r - 1.15) / 0.11, 2.0)) * smoothstep(0.15, -0.35, p.y) * 0.45;
  float thick = 0.040 + 0.014 * abs(p.x);
  float band = exp(-pow((p.y + 0.03) / thick, 2.0)) * smoothstep(4.2, 1.1, abs(p.x));
  float dop = 0.45 + 0.55 * smoothstep(-2.5, 2.5, -p.x);   // sol taraf daha parlak
  float halo = 0.10 * exp(-(r - 1.0) * 0.9) * step(1.0, r);
  float I = ring * 1.15 + arcU * 0.55 + arcL + band * dop * 1.05 + halo;
  I *= 1.0 - smoothstep(5.0, 8.0, r);
  return vec3(1.0, 0.74, 0.46) * I;
}

vec3 skyColor(vec3 d, float withGarg) {
  float h = max(d.y, 0.0);
  vec3 zenith = vec3(0.085, 0.125, 0.170);
  vec3 base = mix(uHorizon, zenith, pow(h, 0.5));

  // bulutlar: düzlem izdüşümü
  vec2 uv = d.xz / (h * 0.85 + 0.11);
  uv = uv * 0.50 + vec2(uTime * 0.0035, uTime * 0.0015);
  float c1 = fbm4(uv);
  float c2 = fbm4(uv * 2.3 + 5.0);
  float dens = smoothstep(0.32, 0.80, c1 * 0.78 + c2 * 0.32);
  vec3 cLit = vec3(0.50, 0.56, 0.60);
  vec3 cDark = vec3(0.14, 0.18, 0.22);
  vec3 cloud = mix(cLit, cDark, clamp(smoothstep(0.30, 0.85, c2) * 0.75 + (1.0 - h) * 0.0, 0.0, 1.0));
  float fadeLow = smoothstep(0.0, 0.20, h);
  vec3 col = base;

  if (withGarg > 0.5) {
    float sh;
    vec3 g = gargantua(d, sh);
    float haze = 0.62;
    float vis = (1.0 - dens * 0.72) * haze;
    col = col * (1.0 - sh * 0.95 * vis) + g * vis;
  }
  col = mix(col, cloud, dens * (0.35 + 0.65 * fadeLow) * fadeLow);
  // ufukta yaklaştıkça sis
  col = mix(col, uHorizon, 1.0 - smoothstep(0.0, 0.14, h));
  return col;
}
`;

export function createSky(U) {
  const mat = new THREE.ShaderMaterial({
    uniforms: U,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      ${SKY_GLSL}
      void main() {
        gl_FragColor = vec4(skyColor(normalize(vDir), 1.0), 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1300, 32, 20), mat);
  mesh.name = 'planet-sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  return mesh;
}
