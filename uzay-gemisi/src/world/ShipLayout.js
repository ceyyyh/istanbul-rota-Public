/**
 * AZİM gemisinin geometrik yerleşimi (saf matematik, THREE bağımlılığı yok).
 *
 * Gemi, Interstellar'daki Endurance gibi 12 modülden oluşan bir halkadır.
 * Halka XZ düzleminde, merkezi orijinde; yer çekimi -Y (oyun basitliği için sabit).
 * Tüm iç zeminler y = 0'dadır.
 *
 * MODÜL YEREL KOORDİNATLARI (modül yazarları bunu kullanır):
 *   +X : halka boyunca bir sonraki modüle doğru (i → i+1)
 *   -X : bir önceki modüle doğru
 *   +Z : İÇ duvar, merkeze/hub'a bakar   (z = +MODULE_WIDTH/2)
 *   -Z : DIŞ duvar, uzaya bakar          (z = -MODULE_WIDTH/2)
 *   +Y : yukarı; zemin y = 0, tavan y = MODULE_HEIGHT
 *   Kapı boşlukları: x = ±MODULE_LENGTH/2, z = 0 merkezli, DOOR_WIDTH genişlik.
 */

export const RING_RADIUS = 32;
export const MODULE_COUNT = 12;
/** İç ölçüler (metre) */
export const MODULE_LENGTH = 11;
export const MODULE_WIDTH = 7;
export const MODULE_HEIGHT = 3.2;
/** İç yüzeyden dış gövde yüzeyine duvar kalınlığı */
export const WALL_THICKNESS = 0.35;
export const DOOR_WIDTH = 1.6;
export const DOOR_HEIGHT = 2.2;
/** Koridor (modüller arası tüp) */
export const CORRIDOR_RADIUS = 1.5;
export const CORRIDOR_CENTER_Y = 1.0;
/** Koridorda yürünebilir yarı genişlik (çarpışma duvarları ±bu değerde) */
export const CORRIDOR_HALF_WIDTH = 1.0;

/** Halka sırasıyla modül kimlikleri. Dizi sırası = halka indeksi. */
export const MODULE_IDS = [
  'command', //     0 Kumanda Modülü (kokpit)
  'cryo', //        1 Hiper-Uyku Bölmesi (BAŞLANGIÇ)
  'quarters', //    2 Yaşam Alanı
  'medical', //     3 Revir
  'lab', //         4 Bilim Laboratuvarı
  'hydro', //       5 Hidroponik Bahçe
  'engine', //      6 Motor ve Enerji
  'robotics', //    7 Robotik Atölye
  'cargo', //       8 Kargo Ambarı
  'airlock', //     9 Hava Kilidi / Ranger Rıhtımı
  'comms', //      10 İletişim
  'observation', // 11 Gözlem Güvertesi
];

const TAU = Math.PI * 2;
const STEP = TAU / MODULE_COUNT;

export function wrapIndex(i) {
  return ((i % MODULE_COUNT) + MODULE_COUNT) % MODULE_COUNT;
}

export function moduleIndexById(id) {
  const i = MODULE_IDS.indexOf(id);
  if (i < 0) throw new Error(`Bilinmeyen modül: ${id}`);
  return i;
}

/** Modül merkezinin halka üzerindeki açısı (radyan, atan2(z, x) uzayında). */
export function moduleAngle(i) {
  return wrapIndex(i) * STEP;
}

/** Modül grubuna uygulanacak dönüşüm. */
export function moduleTransform(i) {
  const a = moduleAngle(i);
  return {
    position: { x: RING_RADIUS * Math.cos(a), y: 0, z: RING_RADIUS * Math.sin(a) },
    rotationY: -a - Math.PI / 2,
  };
}

/** Bir THREE.Object3D'yi modül i'nin konumuna yerleştirir. */
export function applyModuleTransform(object3D, i) {
  const t = moduleTransform(i);
  object3D.position.set(t.position.x, t.position.y, t.position.z);
  object3D.rotation.set(0, t.rotationY, 0);
  return object3D;
}

/** Modül yerel (lx, lz) → dünya (x, z) */
export function localToWorld(i, lx, lz) {
  const a = moduleAngle(i);
  const c = Math.cos(a);
  const s = Math.sin(a);
  // t̂ = (-s, c) teğet, inward = (-c, -s)
  return {
    x: RING_RADIUS * c + lx * -s + lz * -c,
    z: RING_RADIUS * s + lx * c + lz * -s,
  };
}

/** Dünya (x, z) → modül i yerel (lx, lz) */
export function worldToLocal(i, x, z) {
  const a = moduleAngle(i);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dx = x - RING_RADIUS * c;
  const dz = z - RING_RADIUS * s;
  return { lx: dx * -s + dz * c, lz: dx * -c + dz * -s };
}

/** Yerel yön açısı (yerel +X'e göre) → dünya yaw (kamera, -Z ileri kuralı) */
export function localYawToWorld(i, localYaw = 0) {
  // Yerel +X'e bakan yaw = PI - açı
  return Math.PI - moduleAngle(i) + localYaw;
}

/**
 * Koridor i: modül i'nin +X ucundan modül i+1'in -X ucuna.
 * a/b dış gövde yüzeyindeki kapı merkezleri (dünya XZ).
 */
export function corridorInfo(i) {
  const from = wrapIndex(i);
  const to = wrapIndex(i + 1);
  const half = MODULE_LENGTH / 2 + WALL_THICKNESS;
  const a = localToWorld(from, half, 0);
  const b = localToWorld(to, -half, 0);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  const dir = { x: dx / length, z: dz / length };
  return {
    index: from,
    from,
    to,
    a,
    b,
    center: { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 },
    length,
    dir,
    /** Grup için Y dönüşü: yerel +X koridor boyunca (a → b) */
    rotationY: Math.atan2(-dir.z, dir.x),
  };
}

/**
 * Oyuncunun/nesnenin nerede olduğunu bulur.
 * @returns {{index:number, id:string, lx:number, lz:number, region:'module'|'corridor'}}
 */
export function locate(x, z) {
  let ang = Math.atan2(z, x);
  if (ang < 0) ang += TAU;
  const index = wrapIndex(Math.round(ang / STEP));
  const { lx, lz } = worldToLocal(index, x, z);
  const inside =
    Math.abs(lx) <= MODULE_LENGTH / 2 + WALL_THICKNESS && Math.abs(lz) <= MODULE_WIDTH / 2 + WALL_THICKNESS;
  return { index, id: MODULE_IDS[index], lx, lz, region: inside ? 'module' : 'corridor' };
}

/** Modül merkezinde, +X yönüne (sonraki modüle) bakan başlangıç noktası. */
export function spawnPoint(indexOrId, lx = 0, lz = 0, localYaw = 0) {
  const i = typeof indexOrId === 'string' ? moduleIndexById(indexOrId) : wrapIndex(indexOrId);
  const p = localToWorld(i, lx, lz);
  return { x: p.x, z: p.z, yaw: localYawToWorld(i, localYaw), index: i };
}

/**
 * Halka boyunca yürüme yolu (takipçiler ve testler için).
 * Her modül için: giriş kapısı, merkez, çıkış kapısı (iç yüzeyde).
 */
export function ringPath() {
  const pts = [];
  for (let i = 0; i < MODULE_COUNT; i++) {
    pts.push({ ...localToWorld(i, -MODULE_LENGTH / 2 + 0.6, 0), index: i, kind: 'enter' });
    pts.push({ ...localToWorld(i, 0, 0), index: i, kind: 'center' });
    pts.push({ ...localToWorld(i, MODULE_LENGTH / 2 - 0.6, 0), index: i, kind: 'exit' });
  }
  return pts;
}
