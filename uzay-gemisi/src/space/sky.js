import * as THREE from 'three';
import { GLSL_COMMON, GLSL_STARS } from './glsl.js';

/**
 * Gökyüzü: çok soluk Samanyolu bandı (başlangıçta bir kez küp haritaya "pişirilir")
 * + her pikselde prosedürel yıldızlar. Kamera orijinde olduğundan küre yarıçapı önemsizdir.
 */

/** Samanyolu (GLSL) — sadece pişirme sırasında çalışır, çalışma anında maliyeti yok. */
export const GLSL_MILKYWAY = /* glsl */ `
vec3 milkyWay(vec3 d) {
  float lat = dot(d, GAL_N);
  vec3 gy = cross(GAL_N, GAL_C);
  float lon = atan(dot(d, gy), dot(d, GAL_C));
  float n1 = fbm3(d * 2.6);
  float n2 = fbm3(d * 6.5 + 4.3);
  float n3 = fbm3(d * 19.0 + 9.1);
  float bulge = exp(-lon * lon / 0.30);
  float w = (0.10 + 0.08 * bulge) * (0.7 + 0.7 * n1);
  float band = exp(-lat * lat / (w * w));
  float halo = exp(-lat * lat / 0.09) * 0.18;
  float core = exp(-lat * lat / 0.0035) * exp(-lon * lon / 0.10);
  // toz şeritleri (karanlık yarıklar) — bant merkezine yakın
  float laneLat = lat - 0.025 * sin(lon * 3.0 + 1.0);
  float lane = smoothstep(0.42, 0.68, n2) * exp(-laneLat * laneLat / 0.0016);
  float clouds = 0.30 + 0.75 * smoothstep(0.30, 0.78, n2) + 0.55 * (n3 - 0.5);
  vec3 tint = mix(vec3(0.68, 0.76, 1.0), vec3(1.0, 0.84, 0.64), bulge);
  vec3 col = tint * (band * max(clouds, 0.0) + halo) + vec3(1.0, 0.82, 0.60) * core * 1.4;
  col *= 1.0 - 0.85 * lane;
  // birkaç çok soluk kızıl/mavi bulutsu lekesi
  float neb = smoothstep(0.62, 0.85, fbm3(d * 3.3 + 21.0)) * band;
  col += neb * vec3(0.55, 0.12, 0.10) * 0.5;
  // çözülemeyen yıldız tozu (ince taneli)
  float grain = pow(vnoise3(d * 260.0), 6.0) * (band + 0.15);
  col += grain * vec3(0.9, 0.92, 1.0) * 0.8;
  return col * MILKY_GAIN + vec3(0.00030, 0.00034, 0.00048);
}
`;

const BAKE_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BAKE_FRAG = /* glsl */ `
#define MILKY_GAIN 0.028
varying vec3 vDir;
${GLSL_COMMON}
${GLSL_MILKYWAY}
void main() {
  gl_FragColor = vec4(milkyWay(normalize(vDir)), 1.0);
}
`;

/**
 * Samanyolu'nu bir küp haritaya pişirir (tek seferlik). HalfFloat → çok soluk değerlerde bantlanma yok.
 * @returns {THREE.WebGLCubeRenderTarget}
 */
export function bakeMilkyWay(renderer, size = 512) {
  const rt = new THREE.WebGLCubeRenderTarget(size, {
    type: THREE.HalfFloatType,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    vertexShader: BAKE_VERT,
    fragmentShader: BAKE_FRAG,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
  });
  const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), mat);
  scene.add(box);
  const cam = new THREE.CubeCamera(0.1, 10, rt);
  const prevAutoClear = renderer.autoClear;
  renderer.autoClear = true;
  cam.update(renderer, scene);
  renderer.autoClear = prevAutoClear;
  box.geometry.dispose();
  mat.dispose();
  return rt;
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = /* glsl */ `
uniform samplerCube uMilky;
varying vec3 vDir;
${GLSL_COMMON}
${GLSL_STARS}
void main() {
  vec3 d = normalize(vDir);
  // yıldızlar ekran düzleminde çizilir: yön türevleri (Jacobian) piksel ofsetine çevirir
  vec3 c = textureCube(uMilky, d).rgb + starField(d, dFdx(d), dFdy(d), 1.0, 0.0);
  // 8 bit çıktıda bantlanmayı önlemek için çok küçük titreşim (dither)
  c += (hash12(gl_FragCoord.xy) - 0.5) * 0.0003;
  gl_FragColor = vec4(max(c, 0.0), 1.0);
}
`;

/**
 * Gökyüzü küresi (kök grubun çocuğu → halka dönüşüyle birlikte döner).
 * @param shared  { uStarPx, uPixScale, uMilky } paylaşılan uniform nesneleri
 */
export function createSky(shared) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMilky: shared.uMilky, uStarPx: shared.uStarPx, uPixScale: shared.uPixScale },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
  });
  mat.name = 'space-sky';
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(20000, 48, 24), mat);
  mesh.name = 'sky';
  mesh.renderOrder = -100;
  mesh.frustumCulled = false;
  return mesh;
}
