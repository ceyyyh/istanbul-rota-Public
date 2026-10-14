import * as THREE from 'three';
import { GLSL_COMMON, GLSL_STARS } from './glsl.js';

/**
 * GARGANTUA — kameraya bakan büyük bir billboard + fragment shader'da Schwarzschild ışın yürütme.
 *
 * Birimler: Schwarzschild yarıçapı r_s = 1 (olay ufku r = 1, foton küresi r = 1.5,
 * gölge yarıçapı b_c = 3√3/2 ≈ 2.6, ISCO r = 3).
 * Foton yolu (Binet denkleminin Kartezyen biçimi):  x'' = -1.5 · h² · x / r⁵,  h = |x × x'| (sabit).
 *
 * Billboard yerel uzayı: +Z kameraya bakar, kamera (0, 0, uDq)'da. Her piksel için ışın yönü
 * normalize(x, y, -uDq). "Kara delik uzayı"nda disk y = 0 düzlemindedir ve kamera disk
 * düzleminin uTilt kadar üstündedir.
 *
 * Merceklenmiş arka plan, gökyüzüyle AYNI fonksiyonla (küp harita Samanyolu + starField)
 * örneklenir; integrasyon küresi kenarında sapma sıfıra indiği için dikiş yoktur.
 */

/** Şekil parametreleri (r_s birimi) */
export const BH = {
  camDist: 32, // kameranın kara deliğe uzaklığı → açısal boyut
  sphere: 13.5, // ışın integrasyon küresi (billboard yarıçapı bunun açısal karşılığı)
  diskIn: 2.1, // yığılma diskinin iç kenarı (filmdeki hızlı dönen delik gibi foton küresine yakın → hâle gölgeye yapışık)
  diskOut: 10.5, // dış kenar
  tiltDeg: 9.5, // kameranın disk düzlemine göre yüksekliği (neredeyse kenardan)
};

const VERT = /* glsl */ `
varying vec2 vLocal;
void main() {
  vLocal = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
#define MAX_STEPS 180
uniform float uTime;
uniform float uDq;
uniform float uRcam;
uniform float uRb;
uniform float uSinE;
uniform float uCosE;
uniform float uDiskIn;
uniform float uDiskOut;
uniform float uDiskGain;
uniform float uRingGain;
uniform int uSteps;
uniform mat3 uToSky;
uniform samplerCube uMilky;
varying vec2 vLocal;
${GLSL_COMMON}
${GLSL_STARS}

// Diskteki türbülans: Kepler kaymasıyla gerilen açısal çizgiler.
float diskPattern(float r, float phi, float seed) {
  float u = phi / TAU;
  float a = pnoise2(vec2(r * 2.2 + seed * 17.0, u * 20.0), 20.0);
  float b = pnoise2(vec2(r * 6.5 + seed * 5.0, u * 56.0), 56.0);
  float c = pnoise2(vec2(r * 17.0 + seed * 3.0, u * 120.0), 120.0);
  return a * 0.5 + b * 0.32 + c * 0.18;
}

// Disk emisyonu: rgb = parlaklık (HDR), a = örtücülük
vec4 diskSample(vec3 hp, float r, vec3 rayDir) {
  float phi = atan(hp.z, hp.x);
  // Kepler açısal hızı (iç kenarda ~70 sn/tur), iki fazlı akış: desen sonsuza dek sarılmaz
  float om = 0.09 * pow(uDiskIn / r, 1.5);
  const float T = 46.0;
  float ph = fract(uTime / T);
  float n1 = diskPattern(r, phi - om * ph * T, 0.0);
  float n2 = diskPattern(r, phi - om * fract(ph + 0.5) * T, 1.0);
  float n = mix(n2, n1, 1.0 - abs(2.0 * ph - 1.0));
  float x = (r - uDiskIn) / (uDiskOut - uDiskIn);
  float edge = smoothstep(0.0, 0.035, x) * (1.0 - smoothstep(0.45, 1.0, x));
  // Sıcaklık/parlaklık profili, kütleçekimsel kızıla kayma
  float grav = sqrt(max(1.0 - 1.0 / r, 0.0));
  float prof = pow(uDiskIn / r, 2.1) * grav * grav;
  // Hafif Doppler asimetrisi (film neredeyse simetrik; çok az bırakıldı)
  vec3 orb = vec3(-hp.z, 0.0, hp.x) / r;
  float beta = sqrt(0.5 / max(r - 1.0, 0.5));
  float dop = 1.0 + 0.22 * beta * dot(orb, -rayDir);
  float streak = 0.45 + 1.1 * n * n;
  float bright = uDiskGain * prof * dop * streak;
  // iç kenar beyaz-sıcak, dışa doğru turuncu
  vec3 hot = vec3(1.0, 0.92, 0.78);
  vec3 warm = vec3(1.0, 0.50, 0.19);
  vec3 col = mix(warm, hot, smoothstep(0.08, 0.75, prof * 1.5 + 0.2 * (n - 0.5)));
  float a = edge * clamp(0.55 + 0.9 * (n - 0.35) + 0.5 * (1.0 - x), 0.0, 1.0);
  return vec4(col * bright, a);
}

void main() {
  vec3 dl = normalize(vec3(vLocal, -uDq));
  // billboard yerel → kara delik uzayı (X ekseni etrafında eğim)
  vec3 d = vec3(dl.x, dl.y * uCosE + dl.z * uSinE, -dl.y * uSinE + dl.z * uCosE);
  vec3 cam = uRcam * vec3(0.0, uSinE, uCosE);
  float tca = -dot(cam, d);
  float b2 = dot(cam, cam) - tca * tca;
  bool inside = b2 <= uRb * uRb;   // integrasyon küresinin dışı: ışın yürütme yok (köşeler ucuz)
  float b = sqrt(max(b2, 0.0));
  float fwb = length(vec2(dFdx(b), dFdy(b)));

  vec3 col = vec3(0.0);
  float alpha = 0.0;
  float rmin = 1e9;
  bool captured = false;
  vec3 vel = d;
  if (inside) {
    // integrasyon küresine giriş noktası (dışarıda düz çizgi)
    vec3 pos = cam + d * (tca - sqrt(max(uRb * uRb - b2, 0.0)));
    vec3 hv = cross(pos, vel);
    float h2 = dot(hv, hv);
    bool escaped = false;
    for (int i = 0; i < MAX_STEPS; i++) {
      if (i >= uSteps) break;
      float r2 = dot(pos, pos);
      float r = sqrt(r2);
      rmin = min(rmin, r);
      float ds = clamp(0.075 * r, 0.04, 1.6);
      float dt = ds / length(vel);
      vel += (-1.5 * h2 / (r2 * r2 * r)) * pos * dt;
      vec3 npos = pos + vel * dt;
      // disk düzlemi (y = 0) geçişi
      if (pos.y * npos.y < 0.0) {
        vec3 hp = mix(pos, npos, pos.y / (pos.y - npos.y));
        float rh = length(hp.xz);
        if (rh > uDiskIn && rh < uDiskOut) {
          vec4 dc = diskSample(hp, rh, normalize(vel));
          col += (1.0 - alpha) * dc.a * dc.rgb;
          alpha += (1.0 - alpha) * dc.a;
          if (alpha > 0.985) break;
        }
      }
      pos = npos;
      float nr2 = dot(pos, pos);
      if (nr2 < 1.0) { captured = true; break; }
      if (nr2 > uRb * uRb && dot(pos, vel) > 0.0) { escaped = true; break; }
    }
    if (!escaped && rmin < 3.0) captured = true;
  }

  // Kaçan ışının yönü → gökyüzü. Türevler (Jacobian) dallanmanın DIŞINDA hesaplanır.
  vec3 vd = normalize(vel);
  // kenara doğru sapmayı yumuşakça sıfırla (gökyüzüyle dikişsiz birleşim)
  float w = smoothstep(uRb, uRb * 0.72, b);
  vd = normalize(mix(d, vd, w));
  vec3 bl = vec3(vd.x, vd.y * uCosE - vd.z * uSinE, vd.y * uSinE + vd.z * uCosE);
  vec3 sky = uToSky * bl;       // merceklenmiş yön
  vec3 nom = uToSky * dl;       // merceksiz (piksel yönü)
  vec3 J1 = dFdx(sky);
  vec3 J2 = dFdy(sky);
  // büyütme: merceksiz piksel alanı / merceklenmiş piksel alanı (yıldız parlaklığı bununla ölçeklenir)
  float gain = lensGain(J1, J2, dFdx(nom), dFdy(nom), 7.0);

  if (!inside) discard;

  vec3 bg = vec3(0.0);
  if (!captured && alpha < 0.985) {
    bg = textureCube(uMilky, sky).rgb + starField(sky, J1, J2, gain, 0.0);
  }
  // foton halkası: kritik çarpma parametresinde (b_c = 3√3/2 ≈ 2.598) ince parıltı. Analitik → pürüzsüz;
  // genişliği ekran pikseline bağlı (her görüş alanında ≥ ~1.2 px) ki titreşmesin.
  float bc = 2.598;
  float rw = max(0.03, 1.1 * fwb);
  float ring = exp(-pow((b - bc - 0.4 * rw) / rw, 2.0));
  col += (1.0 - alpha) * ring * vec3(1.0, 0.86, 0.66) * uRingGain;
  gl_FragColor = vec4(col + (1.0 - alpha) * bg, 1.0);
}
`;

/**
 * Gargantua billboard'unu oluşturur.
 * @param {THREE.Vector3} dirLocal  kök yerel uzayında kara deliğe birim yön
 * @param shared {uTime, uStarPx, uPixScale, uMilky}
 * @returns {{ group: THREE.Object3D, material: THREE.ShaderMaterial, angularRadius: number }}
 */
export function createGargantua(dirLocal, shared, { distance = 1000, steps = 120 } = {}) {
  const group = new THREE.Object3D();
  group.name = 'gargantua';
  group.position.copy(dirLocal).multiplyScalar(distance);
  group.lookAt(0, 0, 0); // +Z kameraya (orijine) bakar, yerel Y dünya yukarısına yakın
  group.updateMatrix();

  const tilt = THREE.MathUtils.degToRad(BH.tiltDeg);
  const angR = Math.asin(BH.sphere / BH.camDist);
  const half = distance * Math.tan(angR) * 1.01;

  const toSky = new THREE.Matrix3().setFromMatrix4(group.matrix);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: shared.uTime,
      uStarPx: shared.uStarPx,
      uPixScale: shared.uPixScale,
      uMilky: shared.uMilky,
      uDq: { value: distance },
      uRcam: { value: BH.camDist },
      uRb: { value: BH.sphere },
      uSinE: { value: Math.sin(tilt) },
      uCosE: { value: Math.cos(tilt) },
      uDiskIn: { value: BH.diskIn },
      uDiskOut: { value: BH.diskOut },
      uDiskGain: { value: 2.7 },
      uRingGain: { value: 1.1 },
      uSteps: { value: steps },
      uToSky: { value: toSky },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    depthWrite: true,
  });
  material.name = 'gargantua';
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, half * 2), material);
  quad.name = 'gargantua-billboard';
  quad.frustumCulled = false;
  quad.renderOrder = -50;
  group.add(quad);
  return { group, material, angularRadius: angR };
}
