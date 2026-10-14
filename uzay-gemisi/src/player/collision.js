import * as THREE from 'three';

/**
 * 2B (XZ düzlemi) çarpışma dünyası. Oyuncu bir daire (yarıçap r) olarak modellenir.
 * Engeller: doğru parçaları ve daireler. Her engelin isteğe bağlı bir dikey
 * aralığı vardır [yMin, yMax]; oyuncunun gövde aralığıyla kesişmeyen engeller
 * yok sayılır (ör. yerdeki ızgara veya tavandaki boru).
 *
 * Tüm engeller bir uzamsal karma ızgarasında tutulur.
 */
export class CollisionWorld {
  constructor({ cellSize = 4 } = {}) {
    this.cellSize = cellSize;
    /** @type {Map<string, Array<object>>} */
    this.cells = new Map();
    this.count = 0;
    this._stamp = 0;
  }

  _cellRange(minX, minZ, maxX, maxZ) {
    const s = this.cellSize;
    return [Math.floor(minX / s), Math.floor(minZ / s), Math.floor(maxX / s), Math.floor(maxZ / s)];
  }

  _insert(c, minX, minZ, maxX, maxZ) {
    const [x0, z0, x1, z1] = this._cellRange(minX, minZ, maxX, maxZ);
    c._cells = [];
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const key = ix + ',' + iz;
        let arr = this.cells.get(key);
        if (!arr) this.cells.set(key, (arr = []));
        arr.push(c);
        c._cells.push(key);
      }
    }
    this.count++;
  }

  _base(opts) {
    return {
      yMin: opts.yMin ?? -Infinity,
      yMax: opts.yMax ?? Infinity,
      enabled: opts.enabled ?? true,
      tag: opts.tag ?? null,
      _stamp: 0,
    };
  }

  /** Doğru parçası ekler. */
  addSegment(ax, az, bx, bz, opts = {}) {
    const dx = bx - ax;
    const dz = bz - az;
    const seg = { type: 'seg', ax, az, bx, bz, dx, dz, len2: dx * dx + dz * dz || 1e-9, ...this._base(opts) };
    this._insert(seg, Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz));
    return seg;
  }

  /** Daire engel ekler (sütun, kapsül vb.). */
  addCircle(x, z, r, opts = {}) {
    const c = { type: 'circle', x, z, r, ...this._base(opts) };
    this._insert(c, x - r, z - r, x + r, z + r);
    return c;
  }

  /** Kapalı çokgen ekler (noktalar [[x,z], ...]). Grup nesnesi döner. */
  addPolygon(points, opts = {}) {
    const segments = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const q = points[(i + 1) % points.length];
      segments.push(this.addSegment(p[0], p[1], q[0], q[1], opts));
    }
    return { type: 'group', segments, tag: opts.tag ?? null };
  }

  /** Merkez (cx,cz), yarı boyutlar (hx,hz), Y açısı (radyan) ile dikdörtgen. */
  addBox(cx, cz, hx, hz, angle = 0, opts = {}) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    // THREE Y dönüşü: x' = x c + z s ; z' = -x s + z c
    const pts = [
      [-hx, -hz],
      [hx, -hz],
      [hx, hz],
      [-hx, hz],
    ].map(([x, z]) => [cx + x * c + z * s, cz - x * s + z * c]);
    return this.addPolygon(pts, opts);
  }

  /**
   * Bir THREE nesnesinin yerel sınır kutusunu dünya uzayına taşıyıp XZ'deki
   * dışbükey zarfını engel olarak ekler. Grup verilirse tüm alt meshler
   * nesnenin yerel uzayında birleştirilir.
   */
  addFromObject(object, opts = {}) {
    object.updateWorldMatrix(true, true);
    const box = localBounds(object);
    if (box.isEmpty()) return null;
    const pts = [];
    let yMin = Infinity;
    let yMax = -Infinity;
    const v = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      v.applyMatrix4(object.matrixWorld);
      pts.push([v.x, v.z]);
      yMin = Math.min(yMin, v.y);
      yMax = Math.max(yMax, v.y);
    }
    const hull = convexHull(pts);
    if (hull.length < 2) return null;
    return this.addPolygon(hull, { yMin, yMax, ...opts });
  }

  setEnabled(collider, enabled) {
    if (!collider) return;
    if (collider.type === 'group') collider.segments.forEach((s) => (s.enabled = enabled));
    else collider.enabled = enabled;
  }

  remove(collider) {
    if (!collider) return;
    if (collider.type === 'group') {
      collider.segments.forEach((s) => this.remove(s));
      return;
    }
    if (collider._removed) return;
    collider._removed = true;
    for (const key of collider._cells || []) {
      const arr = this.cells.get(key);
      if (!arr) continue;
      const idx = arr.indexOf(collider);
      if (idx >= 0) arr.splice(idx, 1);
    }
    collider._cells = [];
    this.count--;
  }

  /** (x,z) çevresindeki r yarıçaplı alandaki aktif engelleri döndürür. */
  query(x, z, r, yMin = -Infinity, yMax = Infinity) {
    const out = [];
    const stamp = ++this._stamp;
    const [x0, z0, x1, z1] = this._cellRange(x - r, z - r, x + r, z + r);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const arr = this.cells.get(ix + ',' + iz);
        if (!arr) continue;
        for (const c of arr) {
          if (c._stamp === stamp) continue;
          c._stamp = stamp;
          if (!c.enabled) continue;
          // Sınıra tam değen engeller (ör. tam 0.3 m basamak) engellemez; Float32 sınır kutuları için tolerans
          if (c.yMax <= yMin + 1e-4 || c.yMin >= yMax - 1e-4) continue;
          out.push(c);
        }
      }
    }
    return out;
  }

  /**
   * Daireyi (pos.x, pos.z, radius) engellerin dışına iter. pos'u yerinde değiştirir.
   * @returns {boolean} çarpışma oldu mu
   */
  resolve(pos, radius, yMin = -Infinity, yMax = Infinity, iterations = 4) {
    let collided = false;
    const r2 = radius * radius;
    for (let it = 0; it < iterations; it++) {
      let moved = false;
      const list = this.query(pos.x, pos.z, radius + 0.05, yMin, yMax);
      for (const c of list) {
        if (c.type === 'seg') {
          let t = ((pos.x - c.ax) * c.dx + (pos.z - c.az) * c.dz) / c.len2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const cx = c.ax + c.dx * t;
          const cz = c.az + c.dz * t;
          const ddx = pos.x - cx;
          const ddz = pos.z - cz;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 >= r2) continue;
          const d = Math.sqrt(d2);
          let nx;
          let nz;
          if (d > 1e-6) {
            nx = ddx / d;
            nz = ddz / d;
          } else {
            const l = Math.sqrt(c.len2);
            nx = -c.dz / l;
            nz = c.dx / l;
          }
          const push = radius - d + 1e-4;
          pos.x += nx * push;
          pos.z += nz * push;
          moved = collided = true;
        } else if (c.type === 'circle') {
          const ddx = pos.x - c.x;
          const ddz = pos.z - c.z;
          const rr = radius + c.r;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 >= rr * rr) continue;
          const d = Math.sqrt(d2) || 1e-6;
          const push = rr - d + 1e-4;
          pos.x += (ddx / d) * push;
          pos.z += (ddz / d) * push;
          moved = collided = true;
        }
      }
      if (!moved) break;
    }
    return collided;
  }

  /**
   * Görüş hattı: from → to (3B noktalar) arasındaki XZ doğru parçası etkin bir engeli kesiyor mu?
   * Kesişme noktasındaki ışın yüksekliği engelin [yMin, yMax] aralığındaysa engellenmiş sayılır.
   * Hedefe `endTolerance` metreden yakın kesişmeler yok sayılır (hedef engelin yüzeyindeyse).
   * `ignore`: yok sayılacak segmentlerin Set'i (ör. hedef nesnenin kendi engelleri).
   */
  lineBlocked(from, to, endTolerance = 0.15, ignore = null) {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return false;
    const list = this.query((from.x + to.x) / 2, (from.z + to.z) / 2, len / 2 + 0.1);
    const tMax = 1 - endTolerance / len;
    for (const c of list) {
      if (c.type !== 'seg' || ignore?.has(c)) continue;
      const denom = dx * c.dz - dz * c.dx;
      if (Math.abs(denom) < 1e-12) continue;
      const ox = c.ax - from.x;
      const oz = c.az - from.z;
      const t = (ox * c.dz - oz * c.dx) / denom; // ışın parametresi
      const u = (ox * dz - oz * dx) / denom; // segment parametresi
      if (t <= 0 || t >= tMax || u < 0 || u > 1) continue;
      const y = from.y + (to.y - from.y) * t;
      if (y >= c.yMin && y <= c.yMax) return true;
    }
    return false;
  }

  /**
   * Hareket et ve çarpış: başlangıçtan hedefe adım adım ilerler (tünelleme olmasın).
   * @returns {{x:number, z:number, collided:boolean}}
   */
  move(from, to, radius, yMin, yMax) {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(dist / (radius * 0.5)));
    const p = { x: from.x, z: from.z };
    let collided = false;
    for (let i = 0; i < steps; i++) {
      p.x += dx / steps;
      p.z += dz / steps;
      if (this.resolve(p, radius, yMin, yMax)) collided = true;
    }
    return { x: p.x, z: p.z, collided };
  }
}

/** Nesnenin kendi yerel uzayındaki sınır kutusu (alt meshler dahil). */
export function localBounds(object) {
  const box = new THREE.Box3();
  const inv = new THREE.Matrix4().copy(object.matrixWorld).invert();
  const m = new THREE.Matrix4();
  const tmp = new THREE.Box3();
  object.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    tmp.copy(o.geometry.boundingBox);
    if (o !== object) {
      m.multiplyMatrices(inv, o.matrixWorld);
      tmp.applyMatrix4(m);
    }
    box.union(tmp);
  });
  return box;
}

/** Monoton zincir dışbükey zarf. points: [[x,z], ...] */
export function convexHull(points) {
  const pts = points
    .map((p) => [p[0], p[1]])
    .sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  const uniq = pts.filter((p, i) => i === 0 || Math.abs(p[0] - pts[i - 1][0]) > 1e-7 || Math.abs(p[1] - pts[i - 1][1]) > 1e-7);
  if (uniq.length < 3) return uniq;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of uniq) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-9) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = uniq.length - 1; i >= 0; i--) {
    const p = uniq[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-9) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}
