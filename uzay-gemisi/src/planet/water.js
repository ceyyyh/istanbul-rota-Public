import * as THREE from 'three';
import { SKY_GLSL } from './sky.js';

/** Su yüzeyi yüksekliği (zemin y = 0; oyuncu ayak bileği hizası). */
export const WATER_Y = 0.28;
export const RIPPLE_COUNT = 6;

/** Sis: mesafeye göre ufuk rengine karışma (su, dalga ve uzak nesneler için ortak). */
export const FOG_GLSL = /* glsl */ `
float fogAmount(float d) {
  float k = d * 0.00105;
  float f = 1.0 - exp(-pow(k, 1.5));
  return max(f, smoothstep(1150.0, 1420.0, d));
}
`;

/**
 * Sonsuz görünen sığ okyanus: tek düzlem, tüm iş parçacık gölgelendiricisinde.
 * Dünya koordinatlarıyla dalgacık normali, Fresnel'li gökyüzü yansıması, sığ taban, adım halkaları.
 */
export function createWater(U) {
  const ripples = [];
  for (let i = 0; i < RIPPLE_COUNT; i++) ripples.push(new THREE.Vector4(0, 0, 9, 0)); // x, z, yaş, aktif
  const uniforms = { ...U, uRip: { value: ripples }, uSun: { value: new THREE.Vector3(0.4, 0.8, 0.2).normalize() } };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      uniform vec3 uOrigin;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz - uOrigin;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vWorld;
      uniform vec4 uRip[${RIPPLE_COUNT}];
      uniform vec3 uSun;
      ${SKY_GLSL}
      ${FOG_GLSL}

      float heightField(vec2 p, float t) {
        float h = vnoise(p * 1.6 + vec2(t * 0.22, t * 0.15)) * 0.55;
        h += vnoise(p * 3.9 - vec2(t * 0.30, -t * 0.21)) * 0.30;
        h += vnoise(p * 9.0 + vec2(-t * 0.4, t * 0.5)) * 0.06;
        h += sin(dot(p, vec2(0.62, 0.78)) * 0.9 + t * 0.9) * 0.18;   // uzun, yavaş kabarma
        return h;
      }

      void main() {
        vec3 toCam = cameraPosition - uOrigin - vWorld;
        float dist = length(toCam);
        vec3 v = toCam / dist;
        vec2 p = vWorld.xz;
        float t = uTime;

        // dalgacık normali (mesafe arttıkça sönümlenir: aliasing yok)
        float e = 0.06;
        float h0 = heightField(p, t);
        float hx = heightField(p + vec2(e, 0.0), t);
        float hz = heightField(p + vec2(0.0, e), t);
        float amp = 0.026 / (1.0 + dist * 0.02);
        vec3 n = normalize(vec3(-(hx - h0) / e * amp * 6.0, 1.0, -(hz - h0) / e * amp * 6.0));

        // adım halkaları
        float foam = 0.0;
        for (int i = 0; i < ${RIPPLE_COUNT}; i++) {
          vec4 r = uRip[i];
          if (r.w < 0.5) continue;
          vec2 dp = p - r.xy;
          float dd = length(dp) + 1e-4;
          float rad = r.z * 1.25 + 0.08;
          float fade = 1.0 - r.z / 2.6;
          float w = exp(-pow((dd - rad) / 0.07, 2.0)) * fade;
          n.xz += dp / dd * w * 0.55 * sin((dd - rad) * 38.0);
          foam += w * 0.5;
        }
        n = normalize(n);

        // yansıma
        vec3 rd = reflect(-v, n);
        rd.y = abs(rd.y) + 0.002;
        vec3 refl = skyColor(normalize(rd), 1.0);
        float cosT = max(dot(n, v), 0.0);
        float fres = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);

        // sığ taban (kum/kaya) ve derinleşme
        vec2 fp = p + n.xz * 0.35;
        float sand = vnoise(fp * 0.6) * 0.55 + vnoise(fp * 2.7) * 0.30 + vnoise(fp * 11.0) * 0.15;
        vec3 floorCol = mix(vec3(0.060, 0.070, 0.068), vec3(0.150, 0.158, 0.145), sand);
        float caus = pow(vnoise(fp * 3.2 + vec2(t * 0.35, -t * 0.27)), 3.0);
        floorCol += caus * 0.05;
        vec3 deep = vec3(0.022, 0.050, 0.062);
        float depthMix = smoothstep(3.0, 110.0, dist);
        vec3 under = mix(floorCol, deep, depthMix);

        vec3 col = mix(under, refl, clamp(fres, 0.0, 1.0));
        float sun = pow(max(dot(rd, uSun), 0.0), 120.0) * 0.20;
        col += vec3(0.9, 0.95, 1.0) * sun + vec3(0.7, 0.8, 0.85) * foam;

        col = mix(col, uHorizon, fogAmount(dist));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2900, 2900).rotateX(-Math.PI / 2), mat);
  mesh.name = 'planet-water';
  mesh.position.y = WATER_Y;
  mesh.frustumCulled = false;
  mesh.renderOrder = -50;

  let next = 0;
  return {
    mesh,
    uniforms,
    /** Dünya XZ'de halka başlat. */
    ripple(x, z) {
      const r = ripples[next];
      r.set(x, z, 0, 1);
      next = (next + 1) % RIPPLE_COUNT;
    },
    update(dt) {
      for (const r of ripples) {
        if (r.w < 0.5) continue;
        r.z += dt;
        if (r.z > 2.6) r.w = 0;
      }
    },
  };
}
