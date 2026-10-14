import * as THREE from 'three';
import { GLSL_COMMON, GLSL_STARS } from './glsl.js';

/**
 * Uzaktaki cisimler (hepsi uzay kökünün çocukları, sonsuz uzaklıkta kabul edilir):
 *   - halkalı Satürn benzeri gaz devi
 *   - Satürn yakınında küresel solucan deliği (içinde başka bir galaksi; kenarında merceklenme)
 *   - Gargantua'ya yakın küçük mavi okyanus gezegeni Miller
 *   - uzakta buzlu Mann gezegeni
 * Işık kaynağı kara deliğin yığılma diskidir (yön kök uzayında hesaplanır).
 */

const PLANET_VERT = /* glsl */ `
varying vec3 vPos;
varying vec3 vViewN;
varying vec3 vViewP;
void main() {
  vPos = position;
  vViewN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewP = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const PLANET_FRAG = /* glsl */ `
uniform vec3 uLight;      // nesne uzayında ışık yönü
uniform int uKind;        // 0 gaz devi, 1 okyanus (Miller), 2 buz (Mann)
uniform float uTime;
uniform float uSun;       // ışık şiddeti
uniform vec2 uRing;       // halka iç/dış yarıçapı (gölge için; 0 → yok)
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uAtmo;
varying vec3 vPos;
varying vec3 vViewN;
varying vec3 vViewP;
${GLSL_COMMON}

float ringDensity(float rr) {
  float t = (rr - uRing.x) / (uRing.y - uRing.x);
  if (t < 0.0 || t > 1.0) return 0.0;
  float d = 0.66 + 0.2 * sin(t * 47.0) + 0.07 * sin(t * 131.0 + 1.3);
  d *= smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.9, 1.0, t));
  d *= 1.0 - 0.92 * exp(-pow((t - 0.63) / 0.025, 2.0)); // Cassini boşluğu
  return clamp(d, 0.0, 1.0);
}

void main() {
  vec3 n = normalize(vPos);
  float ndl = dot(n, uLight);
  vec3 albedo;
  if (uKind == 0) {
    float lat = n.y;
    float w = vnoise3(n * vec3(4.0, 22.0, 4.0) + vec3(uTime * 0.002, 0.0, 0.0));
    float bands = 0.5 + 0.5 * sin(lat * 26.0 + w * 2.2) * 0.8 + 0.2 * sin(lat * 71.0);
    albedo = mix(uColA, uColB, bands);
    albedo *= 0.92 + 0.16 * vnoise3(n * vec3(9.0, 40.0, 9.0));
  } else if (uKind == 1) {
    float clouds = smoothstep(0.52, 0.78, fbm3(n * 3.2 + vec3(0.0, 0.0, uTime * 0.004)));
    albedo = mix(uColA, uColB, 0.5 + 0.5 * vnoise3(n * 6.0));
    albedo = mix(albedo, vec3(0.85, 0.9, 0.95), clouds * 0.75);
  } else {
    float f = fbm3(n * 4.5);
    float cracks = smoothstep(0.47, 0.5, abs(vnoise3(n * 11.0) - 0.5) + 0.48);
    albedo = mix(uColA, uColB, f);
    albedo *= 1.0 - 0.25 * cracks;
  }
  // gündüz/gece sınırı yumuşak
  float diff = smoothstep(-0.05, 0.35, ndl) * max(ndl + 0.05, 0.0);
  // halkanın gezegen üzerindeki gölgesi
  if (uRing.y > 0.0 && abs(uLight.y) > 1e-3) {
    float t = -vPos.y / uLight.y;
    if (t > 0.0) {
      vec3 q = vPos + uLight * t;
      diff *= 1.0 - 0.8 * ringDensity(length(q.xz));
    }
  }
  vec3 col = albedo * diff * uSun;
  // atmosfer kenarı (aydınlık tarafta)
  float rim = 1.0 - max(dot(normalize(vViewN), normalize(-vViewP)), 0.0);
  col += uAtmo * pow(rim, 3.0) * smoothstep(-0.2, 0.4, ndl) * uSun;
  gl_FragColor = vec4(col, 1.0);
}
`;

const RING_VERT = /* glsl */ `
varying vec3 vPos;
void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const RING_FRAG = /* glsl */ `
uniform vec3 uLight;
uniform vec2 uRing;
uniform float uSun;
varying vec3 vPos;
${GLSL_COMMON}
float ringDensity(float rr) {
  float t = (rr - uRing.x) / (uRing.y - uRing.x);
  if (t < 0.0 || t > 1.0) return 0.0;
  float d = 0.66 + 0.2 * sin(t * 47.0) + 0.07 * sin(t * 131.0 + 1.3);
  d *= smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.9, 1.0, t));
  d *= 1.0 - 0.92 * exp(-pow((t - 0.63) / 0.025, 2.0));
  return clamp(d, 0.0, 1.0);
}
void main() {
  float rr = length(vPos.xz);
  float a = ringDensity(rr);
  if (a <= 0.002) discard;
  float t = (rr - uRing.x) / (uRing.y - uRing.x);
  vec3 col = mix(vec3(0.78, 0.70, 0.58), vec3(0.62, 0.58, 0.52), 0.5 + 0.5 * sin(t * 37.0));
  col *= 0.9 + 0.2 * hash12(vec2(floor(rr * 400.0), 1.0));
  // ince halka iki yandan da aydınlanır
  float lit = 0.25 + 0.75 * abs(uLight.y);
  // gezegenin halkaya düşen gölgesi (birim küre)
  float tb = -dot(vPos, uLight);
  vec3 c = vPos + uLight * tb;
  if (tb > 0.0 && dot(c, c) < 1.0) lit *= 0.06;
  gl_FragColor = vec4(col * lit * uSun, a * 0.85);
}
`;

const WORM_VERT = /* glsl */ `
varying vec2 vLocal;
void main() {
  vLocal = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const WORM_FRAG = /* glsl */ `
uniform float uDq;
uniform float uTheta;     // kürenin açısal yarıçapı (radyan)
uniform float uOuter;     // merceklenme bölgesinin dış sınırı (uTheta katı)
uniform mat3 uToSky;
uniform samplerCube uMilky;
uniform float uTime;
varying vec2 vLocal;
${GLSL_COMMON}
${GLSL_STARS}

// Öteki evrendeki sarmal galaksi
vec3 galaxy(vec3 d) {
  vec3 gc = normalize(vec3(0.25, 0.15, -1.0));
  vec3 gn = normalize(vec3(0.2, 1.0, 0.45));   // galaksi diski normali (eğik)
  vec3 gx = normalize(cross(gn, gc));
  vec3 gy = cross(gc, gx);
  vec3 off = d - gc * dot(d, gc);
  vec2 p = vec2(dot(off, gx), dot(off, gy)) / 0.55;
  p.y /= 0.45; // eğiklik → elips
  float r = length(p);
  float a = atan(p.y, p.x);
  float arms = 0.5 + 0.5 * cos(2.0 * (a - log(r + 0.02) * 2.4));
  float disk = exp(-r * 3.2) * (0.35 + 0.9 * arms);
  float core = exp(-r * r * 60.0) * 2.5;
  float facing = smoothstep(0.0, 0.3, dot(d, gc));
  vec3 col = disk * mix(vec3(0.55, 0.65, 1.0), vec3(1.0, 0.86, 0.7), exp(-r * 4.0)) + core * vec3(1.0, 0.9, 0.75);
  return col * facing * 0.55;
}

vec3 otherSky(vec3 d, vec3 J1, vec3 J2) {
  // öteki evren bizimkinden belirgin biçimde parlak ve mavi-mor: küre "başka bir gökyüzüne açılan pencere"
  vec3 c = starField(d, J1, J2, 1.0, 40.0) * 2.2;
  c += galaxy(d) * 2.4;
  float neb = fbm3(d * 2.4 + 7.0);
  c += vec3(0.10, 0.13, 0.34) * smoothstep(0.40, 0.85, neb) * 0.55;
  return c + vec3(0.012, 0.018, 0.045);
}

vec3 ourSky(vec3 s, vec3 J1, vec3 J2, float gain) {
  return textureCube(uMilky, s).rgb + starField(s, J1, J2, gain, 0.0);
}

void main() {
  vec3 dl = normalize(vec3(vLocal, -uDq));
  float th = acos(clamp(-dl.z, -1.0, 1.0));
  float rho = th / uTheta;
  vec2 az = normalize(vLocal + vec2(1e-6));
  // küre içi: öteki evrenin tüm gökyüzü küçük bir diske sıkışır (kenara doğru aşırı bükülme)
  float tho = PI * pow(min(rho, 1.0), 1.35) * 0.98;
  vec3 od = vec3(az * sin(tho), -cos(tho));
  // kendi gökyüzümüz: dışarıda nokta mercek (dış sınırda sapma → 0), içeride kenara sarılan görüntü
  float thE = uTheta * 1.25;
  float bOut = mix(th, th - thE * thE / max(th, 1e-6), smoothstep(uOuter, uOuter * 0.55, rho));
  float bIn = -uTheta * (2.0 - rho) * 1.4;
  float bs = rho < 1.0 ? bIn : bOut;
  vec3 s = uToSky * normalize(vec3(az * tan(bs), -1.0));
  vec3 nom = uToSky * dl;
  // türevler (Jacobian) dallanmadan önce
  vec3 Jo1 = dFdx(od);
  vec3 Jo2 = dFdy(od);
  vec3 Js1 = dFdx(s);
  vec3 Js2 = dFdy(s);
  float gS = lensGain(Js1, Js2, dFdx(nom), dFdy(nom), 6.0);
  float rw = max(0.012, 1.1 * fwidth(rho)); // kenar parıltısı ekranda ≥ ~1 px
  if (rho > uOuter) discard;
  vec3 col;
  if (rho < 1.0) {
    col = otherSky(od, Jo1, Jo2);
    float edge = smoothstep(0.82, 1.0, rho);
    col = mix(col, ourSky(s, Js1, Js2, gS) * 1.3, edge * 0.7);
    col *= 0.85 + 0.15 * smoothstep(1.0, 0.6, rho);
  } else {
    col = ourSky(s, Js1, Js2, gS);
  }
  // küre kenarı: ince, soğuk beyaz parıltı (iki yandan yumuşak)
  col += vec3(0.62, 0.78, 1.0) * exp(-pow((rho - 1.0) / rw, 2.0)) * 0.9;
  gl_FragColor = vec4(col, 1.0);
}
`;

function planetMaterial(kind, light, shared, opts) {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uLight: { value: light.clone() },
      uKind: { value: kind },
      uTime: shared.uTime,
      uSun: { value: opts.sun ?? 1.6 },
      uRing: { value: new THREE.Vector2(opts.ringIn || 0, opts.ringOut || 0) },
      uColA: { value: new THREE.Color(opts.colA) },
      uColB: { value: new THREE.Color(opts.colB) },
      uAtmo: { value: new THREE.Color(opts.atmo ?? 0x000000) },
    },
    vertexShader: PLANET_VERT,
    fragmentShader: PLANET_FRAG,
  });
  m.name = `planet-${kind}`;
  return m;
}

/** Azimut (atan2(z, x), derece) ve yükseklikten (derece) birim yön. */
export function dirFromAzEl(azDeg, elDeg, out = new THREE.Vector3()) {
  const az = THREE.MathUtils.degToRad(azDeg);
  const el = THREE.MathUtils.degToRad(elDeg);
  return out.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
}

/**
 * Bir gezegeni kök uzayına yerleştirir.
 * @param lightPos  ışık kaynağının (kara delik) "fiziksel" konumu, kök uzayında
 */
function makePlanet(parent, { dir, distance, angRadiusDeg, kind, tilt = [0, 0, 0], lightPos, shared, ...opts }) {
  const R = distance * Math.tan(THREE.MathUtils.degToRad(angRadiusDeg));
  const segs = kind === 0 ? 48 : 32;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, segs, Math.round(segs / 2)));
  mesh.position.copy(dir).multiplyScalar(distance);
  mesh.rotation.set(tilt[0], tilt[1], tilt[2]);
  mesh.scale.setScalar(R);
  mesh.updateMatrix();
  // ışık yönü (nesne uzayı)
  const L = lightPos.clone().sub(mesh.position).normalize();
  L.applyQuaternion(mesh.quaternion.clone().invert());
  mesh.material = planetMaterial(kind, L, shared, opts);
  mesh.name = opts.name || 'planet';
  parent.add(mesh);
  return { mesh, light: L, radius: R };
}

/**
 * Tüm gezegenleri ve solucan deliğini kurar.
 * @param root      uzay kökü
 * @param bhDir     kara delik yönü (kök yerel)
 * @param bhFrame   Gargantua billboard grubu (yerel eksenleri Miller'ı konumlandırmak için)
 * @param shared    paylaşılan uniform'lar
 */
export function createPlanets(root, bhDir, bhFrame, shared) {
  const out = {};
  // Işık kaynağının fiziksel konumu: uzak gezegenler için yön yeterli
  const lightFar = bhDir.clone().multiplyScalar(60000);

  // --- Satürn benzeri gaz devi (kara deliğe ~90° yanda → yarım evre) ---
  const satDir = dirFromAzEl(256, -7);
  const sat = makePlanet(root, {
    name: 'saturn',
    dir: satDir,
    distance: 3000,
    angRadiusDeg: 4.0,
    kind: 0,
    tilt: [0.38, 0.0, 0.42],
    lightPos: lightFar,
    shared,
    colA: 0xd8c08e,
    colB: 0x9c7a50,
    atmo: 0x6a5a40,
    ringIn: 1.28,
    ringOut: 2.35,
    sun: 1.7,
  });
  const ringGeo = new THREE.RingGeometry(1.28, 2.35, 128, 1);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.ShaderMaterial({
    uniforms: {
      uLight: { value: sat.light.clone() },
      uRing: { value: new THREE.Vector2(1.28, 2.35) },
      uSun: { value: 1.7 },
    },
    vertexShader: RING_VERT,
    fragmentShader: RING_FRAG,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  });
  ringMat.name = 'saturn-rings';
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.name = 'saturn-rings';
  ring.renderOrder = 5;
  sat.mesh.add(ring);
  out.saturn = sat.mesh;

  // --- Küresel solucan deliği (Satürn'ün yakınında) ---
  const wDir = dirFromAzEl(236, 3.5);
  const wDist = 2000;
  const wTheta = THREE.MathUtils.degToRad(3.0);
  const wOuter = 2.6;
  const wGroup = new THREE.Object3D();
  wGroup.name = 'wormhole';
  wGroup.position.copy(wDir).multiplyScalar(wDist);
  wGroup.lookAt(0, 0, 0);
  wGroup.updateMatrix();
  const wHalf = wDist * Math.tan(wTheta * wOuter) * 1.02;
  const wMat = new THREE.ShaderMaterial({
    uniforms: {
      uDq: { value: wDist },
      uTheta: { value: wTheta },
      uOuter: { value: wOuter },
      uToSky: { value: new THREE.Matrix3().setFromMatrix4(wGroup.matrix) },
      uMilky: shared.uMilky,
      uStarPx: shared.uStarPx,
      uPixScale: shared.uPixScale,
      uTime: shared.uTime,
    },
    vertexShader: WORM_VERT,
    fragmentShader: WORM_FRAG,
  });
  wMat.name = 'wormhole';
  const wQuad = new THREE.Mesh(new THREE.PlaneGeometry(wHalf * 2, wHalf * 2), wMat);
  wQuad.frustumCulled = false;
  wQuad.renderOrder = -40;
  wGroup.add(wQuad);
  root.add(wGroup);
  out.wormhole = wGroup;

  // --- Miller: Gargantua'nın sağ altında, diskin dışında (billboard yerel açılarıyla) ---
  const mLocal = new THREE.Vector3(Math.tan(THREE.MathUtils.degToRad(11)), Math.tan(THREE.MathUtils.degToRad(-12.5)), -1).normalize();
  const millerDir = mLocal.applyQuaternion(bhFrame.quaternion).normalize();
  // ışık: gezegenden kara deliğe (aynı uzaklıkta kabul edilir) + biraz kameraya doğru
  const millerLightPos = bhDir.clone().multiplyScalar(800).addScaledVector(millerDir, -60);
  const miller = makePlanet(root, {
    name: 'miller',
    dir: millerDir,
    distance: 800,
    angRadiusDeg: 1.1,
    kind: 1,
    tilt: [0.2, 0, 0.1],
    lightPos: millerLightPos,
    shared,
    colA: 0x0e3a6a,
    colB: 0x1d5f8c,
    atmo: 0x4a8fd0,
    sun: 2.2,
  });
  out.miller = miller.mesh;

  // --- Mann: uzakta, buzlu ---
  const mann = makePlanet(root, {
    name: 'mann',
    dir: dirFromAzEl(118, 14),
    distance: 3500,
    angRadiusDeg: 0.9,
    kind: 2,
    tilt: [0.5, 0, -0.3],
    lightPos: lightFar,
    shared,
    colA: 0xd6dde4,
    colB: 0x8d9aa6,
    atmo: 0x9fb6cc,
    sun: 1.6,
  });
  out.mann = mann.mesh;
  return out;
}
