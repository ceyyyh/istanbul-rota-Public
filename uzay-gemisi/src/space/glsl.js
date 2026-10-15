/**
 * Uzay shader'larının ortak GLSL parçaları: karma (hash), gürültü ve prosedürel yıldız alanı.
 *
 * Gökyüzü küresi, Gargantua ışın yürütücüsü ve solucan deliği AYNI `starField` fonksiyonunu
 * kullanır; böylece merceklenmiş bölge ile normal gökyüzü arasında dikiş oluşmaz.
 * Tüm yönler "uzay kökü" (SpaceEnvironment.root) yerel uzayındadır.
 */

/** Galaktik düzlemin (Samanyolu bandı) normali — kök yerel uzayında, birim vektör. */
export const GAL_NORMAL = [-0.75, 0.5, 0.4330127];
/** Galaktik merkez yönü (bant üzerinde, ufukta az = 60°). GAL_NORMAL'a dik. */
export const GAL_CENTER = [0.5, 0.0, 0.8660254];

const v3 = (a) => `vec3(${a.map((x) => x.toFixed(7)).join(', ')})`;

export const GLSL_COMMON = /* glsl */ `
const vec3 GAL_N = ${v3(GAL_NORMAL)};
const vec3 GAL_C = ${v3(GAL_CENTER)};
const float PI = 3.14159265;
const float TAU = 6.28318531;

// --- Sinüssüz karma fonksiyonları (Dave Hoskins) ---
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

// --- Değer gürültüsü ---
float vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash13(i);
  float b = hash13(i + vec3(1.0, 0.0, 0.0));
  float c = hash13(i + vec3(0.0, 1.0, 0.0));
  float d = hash13(i + vec3(1.0, 1.0, 0.0));
  float e = hash13(i + vec3(0.0, 0.0, 1.0));
  float g = hash13(i + vec3(1.0, 0.0, 1.0));
  float h = hash13(i + vec3(0.0, 1.0, 1.0));
  float k = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}
float fbm3(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise3(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s / 0.96875;
}
// y ekseninde periyodik 2B değer gürültüsü (açısal koordinatlar için)
float pnoise2(vec2 p, float per) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0); // beşinci derece geçiş: ızgara çizgileri belirginleşmez
  float y0 = mod(i.y, per);
  float y1 = mod(i.y + 1.0, per);
  float a = hash12(vec2(i.x, y0));
  float b = hash12(vec2(i.x + 1.0, y0));
  float c = hash12(vec2(i.x, y1));
  float d = hash12(vec2(i.x + 1.0, y1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`;

/**
 * Prosedürel yıldız alanı. Gökyüzü eşaçılı bir küp ızgarasına bölünür; her hücrede en fazla
 * bir yıldız vardır (hücre kenarlarından pay bırakılarak — komşu hücre aramaya gerek kalmaz).
 * Üç katman: az sayıda parlak, orta, çok sayıda sönük yıldız (sönükler Samanyolu bandında yoğunlaşır).
 *
 * Yıldızlar nokta kaynaktır: Gauss profili GÖRÜNTÜ (ekran) düzleminde çizilir. Kaynak yönündeki
 * fark, ekran-uzayı türevleriyle (Jacobian J = [dFdx(d), dFdy(d)]) piksel ofsetine çevrilir.
 * Böylece mercek bölgesinde yıldızlar yay gibi uzamaz; nokta kalır ve parlaklıkları büyütme
 * oranıyla (gain) ölçeklenir — DNGR'deki gibi.
 *
 * starField(d, J1, J2, gain, seed):
 *   d      birim yön (kök yerel), J1/J2 = dFdx(d), dFdy(d) (dallanma DIŞINDA hesaplanmalı)
 *   gain   parlaklık çarpanı (merceklenmede büyütme oranı; normal gökyüzünde 1)
 *   seed   farklı bir evren için farklı tohum
 * Uniform'lar: uStarPx (yıldız Gauss yarıçapı, cihaz pikseli = CSS px · piksel oranı → boyut
 * piksel oranından bağımsız), uPixScale (1 / merkezdeki piksel açısı; sayısal ölçek için).
 */
export const GLSL_STARS = /* glsl */ `
uniform float uStarPx;
uniform float uPixScale;
vec3 starTint(float t) {
  // Renk sıcaklığı: çoğu beyaz/sarımsı, azı turuncu, azı mavimsi
  vec3 c = mix(vec3(1.0, 0.64, 0.40), vec3(1.0, 0.85, 0.66), smoothstep(0.02, 0.16, t));
  c = mix(c, vec3(1.0, 0.97, 0.93), smoothstep(0.30, 0.50, t));
  c = mix(c, vec3(0.74, 0.84, 1.0), smoothstep(0.78, 0.94, t));
  return c;
}

void cubeCoord(vec3 d, out vec3 A, out vec3 U, out vec3 V, out vec2 e, out float face) {
  vec3 ad = abs(d);
  if (ad.x >= ad.y && ad.x >= ad.z) {
    A = vec3(sign(d.x), 0.0, 0.0); U = vec3(0.0, 1.0, 0.0); V = vec3(0.0, 0.0, 1.0);
    face = 0.5 + 0.5 * sign(d.x);
  } else if (ad.y >= ad.z) {
    A = vec3(0.0, sign(d.y), 0.0); U = vec3(1.0, 0.0, 0.0); V = vec3(0.0, 0.0, 1.0);
    face = 2.5 + 0.5 * sign(d.y);
  } else {
    A = vec3(0.0, 0.0, sign(d.z)); U = vec3(1.0, 0.0, 0.0); V = vec3(0.0, 1.0, 0.0);
    face = 4.5 + 0.5 * sign(d.z);
  }
  float m = dot(d, A);
  // eşaçılı küp koordinatı ∈ [-1, 1]
  e = atan(vec2(dot(d, U), dot(d, V)) / m) * 1.27323954;
}

// Jacobian'ın ters Gram matrisi (piksel ofseti = Ginv · [J1·df, J2·df]); m.w = en büyük tekil değer
vec4 starJac(vec3 J1, vec3 J2) {
  float a = dot(J1, J1);
  float b = dot(J1, J2);
  float c = dot(J2, J2);
  float det = max(a * c - b * b, 1e-12);
  float smax = sqrt(0.5 * (a + c) + sqrt(0.25 * (a - c) * (a - c) + b * b));
  return vec4(c / det, -b / det, a / det, smax);
}

vec3 starLayer(vec3 d, vec3 J1, vec3 J2, vec4 G, vec3 A, vec3 U, vec3 V, vec2 e, float face,
               float N, float seed, float prob, float fmin, float fmax, float sizeK, float bandBoost) {
  vec2 cell = floor((e * 0.5 + 0.5) * N);
  vec3 h = hash33(vec3(cell, face * 7.0 + seed));
  // yıldız merkezi hücrenin iç %50'sinde → kenarda kesilme olmaz
  vec2 se = (cell + 0.25 + 0.5 * h.xy) / N * 2.0 - 1.0;
  vec2 suv = tan(se * 0.78539816);
  vec3 sd = normalize(A + suv.x * U + suv.y * V);
  float gl = dot(sd, GAL_N);
  float band = exp(-gl * gl * 25.0);
  if (h.z > prob * (1.0 + bandBoost * band)) return vec3(0.0);
  vec3 h2 = hash33(vec3(cell.yx * 1.37 + 11.0, face * 3.0 + seed * 1.7 + 5.0));
  // kaynak düzlemindeki fark → piksel ofseti
  vec3 df = (sd - d) * uPixScale;
  vec2 rhs = vec2(dot(J1, df), dot(J2, df));
  vec2 p = vec2(G.x * rhs.x + G.y * rhs.y, G.y * rhs.x + G.z * rhs.y);
  // pay sınırı: Gauss kuyruğu (≈2.2σ) hücre dışına taşmasın; taşacaksa küçült, akıyı koru
  float sig = uStarPx * sizeK;
  float s = min(sig, 0.125 * uPixScale / (N * G.w));
  float g = exp(-0.5 * dot(p, p) / (s * s)) * min((sig * sig) / (s * s), 6.0);
  // parlaklık: çoğu sönük (güç yasası)
  float flux = fmin * pow(fmax / fmin, pow(h2.x, 3.2));
  return flux * g * starTint(h2.y);
}

vec3 starField(vec3 d, vec3 J1, vec3 J2, float gain, float seed) {
  J1 *= uPixScale;
  J2 *= uPixScale;
  vec4 G = starJac(J1, J2);
  vec3 A; vec3 U; vec3 V; vec2 e; float face;
  cubeCoord(d, A, U, V, e, face);
  vec3 c = starLayer(d, J1, J2, G, A, U, V, e, face, 11.0, seed + 1.0, 0.16, 0.5, 5.0, 1.3, 0.0);
  c += starLayer(d, J1, J2, G, A, U, V, e, face, 27.0, seed + 2.0, 0.16, 0.09, 0.6, 1.0, 0.6);
  c += starLayer(d, J1, J2, G, A, U, V, e, face, 50.0, seed + 3.0, 0.17, 0.018, 0.11, 1.0, 1.8);
  return c * gain;
}

// Merceklenmiş yön ile merceksiz yönün piksel başına kapladığı alanların oranı (büyütme)
float lensGain(vec3 J1, vec3 J2, vec3 K1, vec3 K2, float maxGain) {
  float a = length(cross(K1, K2));
  float b = length(cross(J1, J2));
  return min(a / max(b, 1e-14), maxGain);
}
`;
