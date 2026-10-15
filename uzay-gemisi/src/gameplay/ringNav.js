/**
 * Halka boyunca gezinme yardımcıları (saf matematik, THREE bağımlılığı yok).
 *
 * Halkanın yürünebilir merkez çizgisi kapalı bir çoklu çizgi olarak kurulur:
 *   her modül için  [-X kapısı (dış yüzey)] → ringPath() giriş/merkez/çıkış → [+X kapısı]
 *   ve modüller arasında koridor (kapı merkezlerinden geçen düz tüp).
 * Böylece bu çizgi kapı merkezlerinden ve koridor eksenlerinden tam olarak geçer.
 *
 * Konum, çizgi boyunca ölçülen yay uzunluğu `s` (0..length) ile ifade edilir.
 *   nav.project(x, z)  → { s, lat, d2 }   (lat: yerel +Z (hub) yönünde işaretli yan uzaklık)
 *   nav.pointAt(s, out) → { x, z, tx, tz } (tx,tz birim teğet: modül sırası artan yön)
 *   nav.delta(a, b)    → a'dan b'ye en kısa işaretli yol farkı (-L/2, L/2]
 */
export class RingNav {
  /** @param layout ShipLayout modülü (ctx.layout) */
  constructor(layout) {
    this.layout = layout;
    const n = layout.MODULE_COUNT;
    const rp = layout.ringPath();
    const pts = [];
    for (let i = 0; i < n; i++) {
      const before = layout.corridorInfo(i - 1); // b: bu modülün -X kapısı
      const after = layout.corridorInfo(i); // a: bu modülün +X kapısı
      pts.push({ x: before.b.x, z: before.b.z, index: i, kind: 'doorIn' });
      for (const p of rp) if (p.index === i) pts.push({ x: p.x, z: p.z, index: i, kind: p.kind });
      pts.push({ x: after.a.x, z: after.a.z, index: i, kind: 'doorOut' });
    }
    this.points = pts;

    /** Parçalar: her biri pts[k] → pts[k+1] (kapalı) */
    const segs = [];
    let s = 0;
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k];
      const b = pts[(k + 1) % pts.length];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) continue;
      segs.push({ ax: a.x, az: a.z, dx, dz, len, tx: dx / len, tz: dz / len, s0: s, index: a.index, corridor: a.kind === 'doorOut' });
      s += len;
    }
    this.segments = segs;
    this.length = s;

    /** Her modülün merkezinin s değeri */
    this.moduleS = [];
    for (let i = 0; i < n; i++) {
      const c = layout.localToWorld(i, 0, 0);
      this.moduleS.push(this.project(c.x, c.z).s);
    }
  }

  wrap(s) {
    const L = this.length;
    return ((s % L) + L) % L;
  }

  /** a'dan b'ye en kısa işaretli fark */
  delta(a, b) {
    const L = this.length;
    let d = this.wrap(b - a);
    if (d > L / 2) d -= L;
    return d;
  }

  /** dir (+1/-1) yönünde a'dan b'ye yol uzunluğu (0..L) */
  along(a, b, dir) {
    return dir > 0 ? this.wrap(b - a) : this.wrap(a - b);
  }

  /** Dünya (x,z) noktasını çizgiye izdüşürür. */
  project(x, z, out = {}) {
    let best = Infinity;
    let bs = 0;
    let blat = 0;
    for (const g of this.segments) {
      let t = ((x - g.ax) * g.tx + (z - g.az) * g.tz);
      t = t < 0 ? 0 : t > g.len ? g.len : t;
      const cx = g.ax + g.tx * t;
      const cz = g.az + g.tz * t;
      const ex = x - cx;
      const ez = z - cz;
      const d2 = ex * ex + ez * ez;
      if (d2 < best) {
        best = d2;
        bs = g.s0 + t;
        // normal = (-tz, tx) → modül yerel +Z (hub tarafı)
        blat = ex * -g.tz + ez * g.tx;
      }
    }
    out.s = this.wrap(bs);
    out.lat = blat;
    out.d2 = best;
    return out;
  }

  _segAt(s) {
    const segs = this.segments;
    s = this.wrap(s);
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segs[mid].s0 <= s) lo = mid;
      else hi = mid - 1;
    }
    return segs[lo];
  }

  /** s konumundaki nokta ve teğet; lat verilirse yana kaydırılmış nokta. */
  pointAt(s, out = {}, lat = 0) {
    s = this.wrap(s);
    const g = this._segAt(s);
    const t = Math.min(g.len, Math.max(0, s - g.s0));
    out.x = g.ax + g.tx * t + -g.tz * lat;
    out.z = g.az + g.tz * t + g.tx * lat;
    out.tx = g.tx;
    out.tz = g.tz;
    out.index = g.index;
    out.corridor = g.corridor;
    return out;
  }

  /**
   * s, [from → to] aralığında mı (dir yönünde ilerlerken)? Uçlar dahil değil.
   */
  between(s, from, to, dir) {
    const d = this.along(from, s, dir);
    const total = this.along(from, to, dir);
    return d > 1e-6 && d < total - 1e-6;
  }
}

/**
 * Modül sayısı cinsinden en kısa güzergâh (görev rehberliği için).
 * @param from  başlangıç modül indeksi
 * @param to    hedef modül indeksi
 * @param n     modül sayısı
 * @param isBlocked (i) => bool  — geçilemeyen (kilitli) ara modül
 * @returns {{ steps:number, dir:1|-1, via:number } | null}  via: yöndeki ilk komşu modül
 */
export function moduleRoute(from, to, n, isBlocked = () => false) {
  if (from === to) return { steps: 0, dir: 1, via: to };
  const res = [];
  for (const dir of [1, -1]) {
    let steps = 0;
    let ok = true;
    let i = from;
    while (i !== to) {
      i = (((i + dir) % n) + n) % n;
      steps++;
      if (i !== to && isBlocked(i)) {
        ok = false;
        break;
      }
    }
    if (ok) res.push({ steps, dir, via: (((from + dir) % n) + n) % n });
  }
  if (!res.length) return null;
  res.sort((a, b) => a.steps - b.steps || b.dir - a.dir);
  return res[0];
}
