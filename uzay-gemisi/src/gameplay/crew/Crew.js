import { Npc } from './Npc.js';

/**
 * Mürettebat NPC'leri — Ajan M "Mürettebat".
 *
 * Kadro (özgün karakterler, filmden esinli roller):
 *   'ela'   — Dr. Ela Yıldız, biyolog; kararlı ve idealist; iniş ekibinde
 *   'doruk' — Doruk Aral, görev uzmanı/pilot; alaycı ve pratik; iniş ekibinde
 *   'rami'  — Prof. Rami Kaya, fizikçi; düşünceli, kara delik takıntılı; gemide kalır, dönüşte 23 yıl yaşlanmış
 *
 * API (sözleşme: docs/ARCHITECTURE.md §15 — Npc.js başlığında ayrıntılı):
 *   crew.get(id) → npc
 *   npc.group · npc.id · npc.name
 *   npc.placeAt(x, z, yaw) · npc.placeLocal(modül, lx, lz, bakılanLx, bakılanLz)
 *   npc.setPose('idle'|'walk'|'sit'|'type'|'run'|'wave')
 *   npc.walkTo(x, z, { speed, run, then, face, ring }) → Promise
 *   npc.follow(vec3 | null, { distance, side }) · npc.lookAt(x, z) · npc.say(text, ms?)
 *   npc.setAged(bool) · npc.setSuit('flight'|'eva') · npc.setVisible(bool)
 *   npc.talk = { prompt, onTalk } · npc.openDialog(düğüm?)
 *   crew.update(dt, t)
 * Olay: 'crew:talk' { id }
 *
 * Varsayılan yerleşim (gemide):
 *   Ela   — Laboratuvar, dış duvardaki tezgâhta spektrometrenin önünde, ayakta `type`
 *   Doruk — Kumanda modülü, sağ pilot koltuğunda `sit` (oyuncu için sol koltuk boş kalır)
 *   Rami  — Gözlem güvertesi, teleskobun yanında `idle`, bakışı pencereden dışarı
 */

const DEFS = {
  ela: {
    id: 'ela',
    name: 'Dr. Ela Yıldız',
    short: 'Ela',
    tag: 'YILDIZ',
    height: 1.7,
    skin: 0xc79a7b,
    lips: 0x93504a,
    iris: 0x2b1b12,
    hair: 0x1b1411,
    hairStyle: 'bun',
    beard: null,
    build: { sh: 0.93, ch: 0.94, hp: 1.04 },
    pitch: 1.2,
    rate: 1.05,
    phase: 0.4,
  },
  doruk: {
    id: 'doruk',
    name: 'Doruk Aral',
    short: 'Doruk',
    tag: 'ARAL',
    height: 1.82,
    skin: 0xb3835f,
    lips: 0x84473f,
    iris: 0x3a2514,
    hair: 0x45301f,
    hairStyle: 'short',
    beard: 'stubble',
    build: { sh: 1.08, ch: 1.06, hp: 1.0 },
    pitch: 0.82,
    rate: 1.0,
    phase: 2.1,
  },
  rami: {
    id: 'rami',
    name: 'Prof. Rami Kaya',
    short: 'Rami',
    tag: 'KAYA',
    height: 1.76,
    skin: 0xd0a181,
    lips: 0x94524a,
    iris: 0x241810,
    hair: 0x0e0c0b,
    hairStyle: 'curly',
    beard: 'stubble',
    agedHair: 'white',
    build: { sh: 0.97, ch: 0.98, hp: 0.98 },
    glasses: true,
    pitch: 0.95,
    rate: 0.98,
    phase: 4.2,
  },
};
// Rami gençken traşlı: sakal yalnızca yaşlanınca görünür
DEFS.rami.beard = 'aged';

export class Crew {
  constructor(ctx) {
    this.ctx = ctx;
    this.members = new Map();
    for (const id of ['ela', 'doruk', 'rami']) {
      this.members.set(id, new Npc(ctx, DEFS[id]));
    }
    this._placeDefaults();
    this._guardSeat();
  }

  /** Varsayılan gemi yerleşimi. */
  _placeDefaults() {
    const ela = this.members.get('ela');
    const doruk = this.members.get('doruk');
    const rami = this.members.get('rami');

    // Ela: tezgâhın önünde (spektrometre ekranına bakar)
    ela.placeLocal('lab', -1.5, -2.2, -1.5, -3.4);
    ela.setPose('type');
    ela.setGaze(...this._localPoint('lab', -1.5, 1.35, -3.3));

    // Doruk: sağ pilot koltuğu (koltuk x=+1.25, z=-1.85, dış duvara bakar)
    doruk.seatY = 0.51;
    doruk.placeLocal('command', 1.25, -1.77, 1.25, -3.4);
    doruk.setPose('sit');
    doruk.setGaze(...this._localPoint('command', 1.25, 1.35, -6));

    // Rami: teleskobun yanında, pencereden dışarı bakar
    rami.placeLocal('observation', 1.0, -2.05, 0.0, -3.4);
    rami.setPose('idle');
    rami.setGaze(...this._localPoint('observation', 0.4, 1.5, -8));
  }

  _localPoint(id, lx, y, lz) {
    const L = this.ctx.layout;
    const w = L.localToWorld(L.moduleIndexById(id), lx, lz);
    return [w.x, y, w.z];
  }

  /** Doruk koltuktayken oyuncu aynı koltuğa "otur"amasın. */
  _guardSeat() {
    const doruk = this.members.get('doruk');
    const handles = this.ctx.interactions?.handles || [];
    const h = handles.find((x) => x.id === 'command-seat-right');
    if (!h) return;
    const orig = h.enabled;
    const L = this.ctx.layout;
    const seat = L.localToWorld(L.moduleIndexById('command'), 1.25, -1.85);
    h.enabled = () => {
      const near = Math.hypot(doruk.group.position.x - seat.x, doruk.group.position.z - seat.z) < 0.7;
      if (doruk.visible && doruk.pose === 'sit' && near) return false;
      return typeof orig === 'function' ? orig() : orig !== false;
    };
  }

  get(id) {
    return this.members.get(id);
  }

  /** Tüm üyelerin listesi */
  get all() {
    return [...this.members.values()];
  }

  update(dt, t) {
    for (const npc of this.members.values()) npc.update(dt, t);
  }
}
