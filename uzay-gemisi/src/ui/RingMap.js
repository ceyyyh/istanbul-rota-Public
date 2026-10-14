import { MODULE_IDS, MODULE_COUNT, RING_RADIUS } from '../world/ShipLayout.js';

/** Modül adları (arayüzde gösterilir). Sıra = halka indeksi. */
export const MODULE_NAMES = {
  command: 'Kumanda Modülü',
  cryo: 'Hiper-Uyku Bölmesi',
  quarters: 'Yaşam Alanı',
  medical: 'Revir',
  lab: 'Bilim Laboratuvarı',
  hydro: 'Hidroponik Bahçe',
  engine: 'Motor ve Enerji',
  robotics: 'Robotik Atölye',
  cargo: 'Kargo Ambarı',
  airlock: 'Hava Kilidi',
  comms: 'İletişim',
  observation: 'Gözlem Güvertesi',
};

/** Büyük haritadaki kısa etiketler (Türkçe büyük harf elle yazıldı: i → İ). */
export const MODULE_SHORT = {
  command: 'KUMANDA',
  cryo: 'HİPER-UYKU',
  quarters: 'YAŞAM',
  medical: 'REVİR',
  lab: 'LABORATUVAR',
  hydro: 'HİDROPONİK',
  engine: 'MOTOR',
  robotics: 'ROBOTİK',
  cargo: 'KARGO',
  airlock: 'HAVA KİLİDİ',
  comms: 'İLETİŞİM',
  observation: 'GÖZLEM',
};

const NS = 'http://www.w3.org/2000/svg';
/** Büyük harita: etiketler için yatayda geniş kutu / dar ekranda (telefon dikey) yalnızca numaralar için kare kutu */
const WIDE_BOX = '-212 -128 424 256';
const SQUARE_BOX = '-128 -128 256 256';
const DEG = Math.PI / 180;
const STEP = 360 / MODULE_COUNT;

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

/** Ekran açısı (derece, SVG: saat yönü, 0 = sağ). Modül 0 (kumanda) en üstte. */
function screenAngle(i) {
  return i * STEP - 90;
}

function polar(r, deg) {
  return [r * Math.cos(deg * DEG), r * Math.sin(deg * DEG)];
}

/** Halka dilimi (annular sector) yolu */
function sectorPath(r0, r1, a0, a1) {
  const [x0, y0] = polar(r1, a0);
  const [x1, y1] = polar(r1, a1);
  const [x2, y2] = polar(r0, a1);
  const [x3, y3] = polar(r0, a0);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r1} ${r1} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} L${x2.toFixed(2)} ${y2.toFixed(2)} A${r0} ${r0} 0 ${large} 0 ${x3.toFixed(2)} ${y3.toFixed(2)}Z`;
}

/**
 * 12 dilimli halka haritası (SVG). Üstten görünüş, kumanda modülü en üstte, saat yönünde ilerler.
 *   const map = new RingMap({ big: false });
 *   parent.appendChild(map.svg);
 *   map.setCurrent(1); map.setTarget(6); map.setPlayer(x, z, yaw);
 */
export class RingMap {
  constructor({ big = false } = {}) {
    this.big = big;
    const R = big ? 96 : 50; // dış yarıçap
    const r = big ? 74 : 37; // iç yarıçap
    this.R = R;
    this.r = r;
    this.mid = (R + r) / 2;
    const vb = 60;
    this.svg = el('svg', {
      class: `ui-ringmap${big ? ' big' : ''}`,
      viewBox: big ? WIDE_BOX : `${-vb} ${-vb} ${vb * 2} ${vb * 2}`,
      'aria-hidden': 'true',
    });
    this._compact = false;

    // Göbek ve tellikler (Endurance'ın merkez yapısı)
    const hub = el('g', { class: 'rm-hub' }, this.svg);
    for (let k = 0; k < 4; k++) {
      const a = 45 + k * 90;
      const [x0, y0] = polar(big ? 14 : 7, a);
      const [x1, y1] = polar(r - (big ? 2 : 1), a);
      el('line', { x1: x0, y1: y0, x2: x1, y2: y1 }, hub);
    }
    el('circle', { r: big ? 12 : 6 }, hub);
    el('circle', { r: big ? 5 : 2.5, class: 'rm-hub-core' }, hub);

    // Dilimler
    const gap = big ? 3.2 : 4.5;
    this.segments = [];
    this.labels = [];
    const segG = el('g', { class: 'rm-segs' }, this.svg);
    for (let i = 0; i < MODULE_COUNT; i++) {
      const a = screenAngle(i);
      const p = el('path', { d: sectorPath(r, R, a - STEP / 2 + gap / 2, a + STEP / 2 - gap / 2), class: 'rm-seg' }, segG);
      this.segments.push(p);
      if (big) {
        const t = el('text', { class: 'rm-label' }, this.svg);
        const num = el('tspan', { class: 'rm-num' }, t);
        const name = el('tspan', { class: 'rm-name' }, t);
        name.textContent = MODULE_SHORT[MODULE_IDS[i]];
        this.labels.push({ text: t, num, name, a });
      }
    }

    // Hedef işareti (halkanın dışında küçük elmas + dilim çerçevesi)
    this.targetG = el('g', { class: 'rm-target', style: 'display:none' }, this.svg);
    this.targetOutline = el('path', { class: 'rm-target-outline' }, this.targetG);
    this.targetMark = el('path', { class: 'rm-target-mark', d: big ? 'M0 -6 L5 0 L0 6 L-5 0Z' : 'M0 -4 L3.4 0 L0 4 L-3.4 0Z' }, this.targetG);

    // TARS işareti (yalnızca büyük haritada)
    if (big) {
      this.tarsG = el('g', { class: 'rm-tars', style: 'display:none' }, this.svg);
      el('rect', { x: -4, y: -4, width: 8, height: 8 }, this.tarsG);
      const tt = el('text', { x: 0, y: -8, 'text-anchor': 'middle' }, this.tarsG);
      tt.textContent = 'TARS';
    }

    // Oyuncu işareti (bakış yönünü gösteren üçgen)
    this.playerG = el('g', { class: 'rm-player' }, this.svg);
    const s = big ? 1.6 : 1;
    el('circle', { r: 5.5 * s, class: 'rm-player-halo' }, this.playerG);
    this.playerArrow = el('path', { d: `M${6 * s} 0 L${-3.5 * s} ${-4 * s} L${-1.5 * s} 0 L${-3.5 * s} ${4 * s}Z` }, this.playerG);

    this._cur = -1;
    this._target = null;
    this._locked = new Set();
    if (big) this._placeLabels();
  }

  /** Dar ekran kipi: etiketlerde yalnızca modül numarası (adlar arayüzde listelenir). */
  setCompact(c) {
    c = !!c;
    if (!this.big || c === this._compact) return;
    this._compact = c;
    this.svg.setAttribute('viewBox', c ? SQUARE_BOX : WIDE_BOX);
    this.svg.classList.toggle('compact', c);
    this._placeLabels();
  }

  _placeLabels() {
    const R = this.R;
    this.labels.forEach((l, i) => {
      const compact = this._compact;
      const [lx, ly] = polar(R + (compact ? 11 : 12), l.a);
      const cos = Math.cos(l.a * DEG);
      const anchor = compact || Math.abs(cos) < 0.2 ? 'middle' : cos > 0 ? 'start' : 'end';
      l.text.setAttribute('x', lx.toFixed(1));
      l.text.setAttribute('y', (ly + (compact ? 3.4 : 3)).toFixed(1));
      l.text.setAttribute('text-anchor', anchor);
      l.num.textContent = String(i + 1).padStart(2, '0') + (compact ? '' : '  ');
    });
  }

  setCurrent(i) {
    if (i === this._cur) return;
    if (this._cur >= 0) {
      this.segments[this._cur].classList.remove('cur');
      this.labels[this._cur]?.text.classList.remove('cur');
    }
    this._cur = i;
    if (i >= 0 && i < MODULE_COUNT) {
      this.segments[i].classList.add('cur');
      this.labels[i]?.text.classList.add('cur');
    }
  }

  setTarget(i) {
    const idx = Number.isInteger(i) && i >= 0 && i < MODULE_COUNT ? i : null;
    if (idx === this._target) return;
    if (this._target !== null) {
      this.segments[this._target].classList.remove('target');
      this.labels[this._target]?.text.classList.remove('target');
    }
    this._target = idx;
    if (idx === null) {
      this.targetG.style.display = 'none';
      return;
    }
    this.segments[idx].classList.add('target');
    this.labels[idx]?.text.classList.add('target');
    const a = screenAngle(idx);
    const pad = this.big ? 2.5 : 2;
    this.targetOutline.setAttribute('d', sectorPath(this.r - pad, this.R + pad, a - STEP / 2 + 0.6, a + STEP / 2 - 0.6));
    const [mx, my] = polar(this.R + (this.big ? 6 : 6.5), a);
    // Büyük haritada etiketle çakışmasın diye elması halkanın içine koy
    const [ix, iy] = polar(this.r - 7, a);
    const [x, y] = this.big ? [ix, iy] : [mx, my];
    this.targetMark.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
    this.targetG.style.display = '';
  }

  setLocked(i, locked) {
    if (!this.big || !this.labels[i]) return;
    if (locked === this._locked.has(i)) return;
    if (locked) this._locked.add(i);
    else this._locked.delete(i);
    this.labels[i].text.classList.toggle('locked', locked);
    this.labels[i].name.textContent = MODULE_SHORT[MODULE_IDS[i]] + (locked ? ' · KİLİTLİ' : '');
  }

  /** Dünya XZ konumu → harita koordinatı (üstten görünüş; kumanda yukarıda). */
  project(x, z) {
    const k = this.mid / RING_RADIUS;
    return [z * k, -x * k];
  }

  setPlayer(x, z, yaw) {
    const [px, py] = this.project(x, z);
    // bakış (dünya): (-sin yaw, -cos yaw) → harita: (fz, -fx) = (-cos yaw, sin yaw)
    const deg = Math.atan2(Math.sin(yaw), -Math.cos(yaw)) / DEG;
    this.playerG.setAttribute('transform', `translate(${px.toFixed(1)} ${py.toFixed(1)}) rotate(${deg.toFixed(0)})`);
  }

  setTars(pos) {
    if (!this.tarsG) return;
    if (!pos) {
      this.tarsG.style.display = 'none';
      return;
    }
    const [x, y] = this.project(pos.x, pos.z);
    this.tarsG.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
    this.tarsG.style.display = '';
  }
}
