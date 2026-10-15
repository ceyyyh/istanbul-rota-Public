import * as THREE from 'three';
import { RingNav } from '../ringNav.js';
import { buildCrewModel, HIP_Y, THIGH, SHIN, ANKLE_H } from './crewModel.js';
import { buildRoot } from './crewDialog.js';

/**
 * Konuşulabilen insan mürettebat (NPC): prosedürel model + animasyon + hareket + diyalog.
 *
 * Genel API (Hikâye ajanı kullanır; değişmez):
 *   npc.group                         THREE.Group (ctx.scene içinde, dinamik; position = ayak orta noktası, rotation.y = yaw; +Z ön)
 *   npc.placeAt(x, z, yaw)            dünya koordinatı (ışınlar, hareketi iptal eder)
 *   npc.setPose('idle'|'walk'|'sit'|'type'|'run'|'wave')   ('wave' ~3 sn sonra eski duruşa döner)
 *   npc.walkTo(x, z, { speed, run, then, face, ring }) → Promise<boolean>   (varınca `then`=idle; iptal edilirse false)
 *   npc.follow(vec3 | null, { distance, side })
 *   npc.lookAt(x, z, { instant })     gövdeyi o noktaya çevirir
 *   npc.say(text, ms?)                altyazı + (varsa) konuşma sentezi
 *   npc.setAged(bool) · npc.setVisible(bool) · npc.setSuit('flight'|'eva')
 *   npc.talk = { prompt, onTalk }     etkileşimi değiştir (null/undefined → varsayılan diyalog)
 * Ek:
 *   npc.placeLocal(modulId, lx, lz, faceLx?, faceLz?)   modül yerel koordinatıyla yerleştir (+ bakılacak yerel nokta)
 *   npc.openDialog(düğüm?)            varsayılan (bayraklara göre) ya da verilen diyalog düğümü ({text, options})
 *   npc.setGaze(x, y, z | null)       oyuncu yakında değilken bakılacak dünya noktası
 *   npc.seatY                         oturma yüksekliği (koltuk minderinin üstü, varsayılan 0.51)
 *   npc.speaking · npc.aged · npc.moving · npc.suit
 */

const TAU = Math.PI * 2;
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const damp = (cur, tgt, lambda, dt) => cur + (tgt - cur) * (1 - Math.exp(-lambda * dt));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const PLANET_X = 2000; // bu x'in ötesi gezegen bölgesi
const WALK_SPEED = 1.35;
const RUN_SPEED = 3.4;

/** Eklem anahtarları (radyan / metre). Poz fonksiyonları bunları doldurur. */
const KEYS = [
  'hipY', 'hx', 'hrz', 'hry', // leğen: yükseklik, yanal kayma, yan eğim, dönme
  'sp', 'sry', 'srz', // gövde: öne eğim, dönme, yan eğim
  'nk', 'hd', // boyun ve kafa öne eğim
  'shLx', 'shLz', 'shRx', 'shRz', // omuzlar
  'elLx', 'elRx', 'elLz', 'elRz', // dirsekler
  'wrLx', 'wrRx', // bilekler
  'hLx', 'hRx', 'hLz', 'hRz', // kalçalar
  'knLx', 'knRx', // dizler
];
const newPose = () => Object.fromEntries(KEYS.map((k) => [k, 0]));

// ---------------------------------------------------------------- pozlar

function poseIdle(o, t, ph) {
  const br = Math.sin(t * 1.55 + ph);
  const w = Math.sin(t * 0.37 + ph); // ağırlık aktarma
  o.hx = 0.012 * w;
  o.hrz = 0.02 * w;
  o.sp = 0.03 + 0.01 * br;
  o.sry = 0.02 * Math.sin(t * 0.23 + ph);
  o.srz = -0.014 * w;
  o.shLx = 0.03 * Math.sin(t * 0.6 + ph);
  o.shRx = 0.03 * Math.sin(t * 0.6 + 1 + ph);
  o.shLz = 0.085 + 0.012 * br;
  o.shRz = -0.085 - 0.012 * br;
  o.elLx = o.elRx = -0.17;
  o.wrLx = o.wrRx = -0.05;
  o.hLz = 0.03 + 0.02 * w;
  o.hRz = -0.03 + 0.02 * w;
  o.knLx = 0.025 + 0.05 * Math.max(0, w);
  o.knRx = 0.025 + 0.05 * Math.max(0, -w);
  o.hLx = -0.02 * Math.max(0, w) * 0;
}

function poseSit(o, t, ph, npc) {
  const sitHip = npc.seatY + 0.1; // kalça ekleminin zeminden yüksekliği (dünya)
  const drop = clamp(sitHip / npc.scale - (SHIN + ANKLE_H), 0, THIGH * 0.95);
  const alpha = Math.asin(drop / THIGH); // uyluğun yatayın altındaki açısı
  const hip = -(Math.PI / 2 - alpha);
  o.hipY = sitHip / npc.scale - HIP_Y;
  o.sp = -0.08 + 0.01 * Math.sin(t * 1.4 + ph);
  o.hLx = o.hRx = hip;
  o.knLx = o.knRx = -hip;
  o.hLz = 0.05;
  o.hRz = -0.05;
  // eller kumanda kollarında / dizlerinde
  o.shLx = o.shRx = -0.62;
  o.shLz = 0.12;
  o.shRz = -0.12;
  o.elLx = -0.95;
  o.elRx = -0.95;
  o.wrLx = o.wrRx = -0.1;
  // ara sıra bir el oynar
  const k = Math.max(0, Math.sin(t * 0.55 + ph * 3) - 0.55) * 2.2;
  o.shRx -= 0.28 * k;
  o.elRx -= 0.15 * k;
  o.wrRx += 0.2 * Math.sin(t * 6) * k;
  o.hd = 0.03;
}

function poseType(o, t, ph) {
  const amp = clamp(0.55 + 0.45 * Math.sin(t * 0.8 + ph), 0.2, 1); // dalgalı tempo
  const pause = Math.sin(t * 0.33 + ph) > 0.82 ? 0.0 : 1; // arada ekrana bakıp durur
  o.sp = 0.13;
  o.hd = 0.2 - (1 - pause) * 0.15;
  o.nk = 0.06;
  o.shLx = -0.4;
  o.shRx = -0.4;
  o.shLz = 0.16;
  o.shRz = -0.16;
  o.elLx = -0.98;
  o.elRx = -0.98;
  o.wrLx = -0.22 + 0.13 * Math.sin(t * 17 + ph) * amp * pause;
  o.wrRx = -0.22 + 0.13 * Math.sin(t * 13.3 + 1 + ph) * amp * pause;
  o.elLx += 0.035 * Math.sin(t * 9 + ph) * amp * pause;
  o.elRx += 0.035 * Math.sin(t * 7.5 + 2 + ph) * amp * pause;
  o.hLz = 0.05;
  o.hRz = -0.05;
  o.hx = 0.01 * Math.sin(t * 0.3 + ph);
  o.knLx = o.knRx = 0.02;
}

function poseWave(o, t, ph) {
  poseIdle(o, t, ph);
  const k = Math.sin(t * 9.5);
  o.shRx = -0.28;
  o.shRz = -2.3 + 0.1 * k;
  o.elRx = -0.55 + 0.1 * Math.abs(k);
  o.elRz = 0.5 * k;
  o.wrRx = -0.1;
  o.hd = -0.03;
  o.sp = 0.0;
  o.srz = 0.05;
}

// ---------------------------------------------------------------- Npc

export class Npc {
  constructor(ctx, def) {
    this.ctx = ctx;
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.short = def.short;

    this.model = buildCrewModel(def);
    this.scale = this.model.scale;
    this.group = new THREE.Group();
    this.group.name = `npc-${def.id}`;
    this.group.userData.dynamic = true;
    this.group.add(this.model.root);
    ctx.scene.add(this.group);

    // --- durum
    this.pose = 'idle';
    this._prevPose = 'idle';
    this._poseTimer = 0;
    this.aged = false;
    this._agedAmt = 0;
    this.suit = 'flight';
    this.seatY = 0.51;
    this._visible = true;
    this._time = Math.random() * 20;
    this._ph = def.phase ?? Math.random() * 6;

    // --- hareket
    this.yaw = 0;
    this.targetYaw = 0;
    this.speed = 0;
    this.moving = false;
    this._path = [];
    this._vmax = WALK_SPEED;
    this._resolve = null;
    this._then = 'idle';
    this._face = null;
    this._walkT = 0;
    this._followCfg = null;
    this._nav = null;
    this._phase = 0;
    this._gait = 0;
    this._spBlend = 0;

    // --- bakış
    this._lookYaw = 0;
    this._lookPitch = 0;
    this._gaze = null;
    this._glanceT = 2 + Math.random() * 4;
    this._glanceYaw = 0;
    this._glancePitch = 0;
    this._blinkT = 2 + Math.random() * 3;
    this._blink = 0;
    this._speakUntil = 0;
    this._mouth = 0;
    this.talking = false;
    this._dlg = null;

    // --- poz ağırlıkları
    this.w = { idle: 1, sit: 0, type: 0, wave: 0 };
    this._tmp = { idle: newPose(), sit: newPose(), type: newPose(), wave: newPose() };
    this.cur = newPose();

    // --- kapılar bu kişiye de açılır
    ctx.doorOpeners?.push(this.group.position);
    this._openerOn = true;

    // --- çarpışma (yalnızca dururken)
    this._collider = null;
    this._colliderAt = new THREE.Vector2(1e9, 1e9);

    // --- etkileşim
    const proxy = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.3, 1.75, 8),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    proxy.position.y = 0.88;
    proxy.name = `npc-hit-${def.id}`;
    this.group.add(proxy);
    this._proxy = proxy;
    this.talk = { prompt: `${def.short} ile konuş`, onTalk: () => this.openDialog() };
    this._handle = ctx.interactions.add(proxy, {
      id: `crew-${def.id}`,
      prompt: () => this.talk?.prompt ?? `${def.short} ile konuş`,
      onInteract: () => this._interact(),
      enabled: () => this._shown && !this.talking,
      distance: 3.2,
      highlight: false,
    });

    this._shown = true;
    this.model.setAgedLook(false);
    this._applySuit('flight');
    this._applyWeights(1);
    this._pose(0.016);
    this._applyJoints(0.016);
  }

  // ------------------------------------------------------------------ konum / yerleştirme

  get position() {
    return this.group.position;
  }

  placeAt(x, z, yaw = this.yaw) {
    this._cancelMove(false);
    this.group.position.set(x, 0, z);
    this.yaw = this.targetYaw = yaw;
    this.group.rotation.y = yaw;
    this.speed = 0;
    this.moving = false;
    this._syncCollider(true);
  }

  /** Modül yerel koordinatıyla yerleştir; (faceLx, faceLz) bakılacak yerel nokta. */
  placeLocal(id, lx, lz, faceLx = null, faceLz = null) {
    const L = this.ctx.layout;
    const i = L.moduleIndexById(id);
    const w = L.localToWorld(i, lx, lz);
    let yaw = this.yaw;
    if (faceLx !== null) {
      const f = L.localToWorld(i, faceLx, faceLz ?? lz);
      yaw = Math.atan2(f.x - w.x, f.z - w.z);
    }
    this.placeAt(w.x, w.z, yaw);
  }

  setVisible(v) {
    this._visible = !!v;
    this._applyVisibility();
  }

  get visible() {
    return this._visible;
  }

  setPose(name) {
    if (!['idle', 'walk', 'sit', 'type', 'run', 'wave'].includes(name)) return;
    if (name === 'wave') {
      if (this.pose !== 'wave') this._prevPose = this.pose === 'walk' || this.pose === 'run' ? 'idle' : this.pose;
      this._poseTimer = 3;
    } else {
      this._poseTimer = 0;
    }
    this.pose = name;
    if ((name === 'idle' || name === 'sit' || name === 'type') && this._path.length && !this._followCfg) this._cancelMove(false);
  }

  setSuit(type) {
    this.suit = type === 'eva' ? 'eva' : 'flight';
    this._applySuit(this.suit);
  }

  _applySuit(type) {
    this.model.setSuit(type);
  }

  setAged(v) {
    this.aged = !!v;
    this.model.setAgedLook(this.aged);
  }

  setGaze(x, y, z) {
    this._gaze = x === null || x === undefined ? null : new THREE.Vector3(x, y, z);
  }

  /** Gövdeyi (x,z) noktasına çevirir. */
  lookAt(x, z, { instant = false } = {}) {
    const p = this.group.position;
    const yaw = Math.atan2(x - p.x, z - p.z);
    this.targetYaw = yaw;
    if (instant) {
      this.yaw = yaw;
      this.group.rotation.y = yaw;
    }
  }

  // ------------------------------------------------------------------ hareket

  _cancelMove(arrived) {
    this._path.length = 0;
    const r = this._resolve;
    this._resolve = null;
    if (r) r(!!arrived);
  }

  walkTo(x, z, opts = {}) {
    this._cancelMove(false);
    this._followCfg = null;
    const run = !!opts.run;
    this._vmax = opts.speed ?? (run ? RUN_SPEED : WALK_SPEED);
    this._then = opts.then ?? 'idle';
    this._face = opts.face ?? null;
    this._walkT = 0;
    this._poseTimer = 0;
    const p = this.group.position;
    if (Math.hypot(x - p.x, z - p.z) < 0.06) {
      this._finishWalk();
      return Promise.resolve(true);
    }
    this._path = this._plan(x, z, opts);
    this.pose = this._vmax > 2.4 ? 'run' : 'walk';
    return new Promise((res) => {
      this._resolve = res;
    });
  }

  /** Düz çizgi; uzun mesafede (gemi içinde) halka yolunu izleyen ara noktalar. */
  _plan(x, z, opts) {
    const p = this.group.position;
    const dist = Math.hypot(x - p.x, z - p.z);
    const onShip = (a, b) => Math.hypot(a, b) < 60;
    if ((opts.ring ?? dist > 9) && opts.ring !== false && onShip(p.x, p.z) && onShip(x, z)) {
      try {
        const nav = (this._nav ||= new RingNav(this.ctx.layout));
        const a = nav.project(p.x, p.z, {});
        const b = nav.project(x, z, {});
        const d = nav.delta(a.s, b.s);
        const n = Math.max(1, Math.ceil(Math.abs(d) / 1.2));
        const out = [];
        const tmp = {};
        for (let i = 1; i <= n; i++) {
          const s = a.s + (d * i) / n;
          nav.pointAt(s, tmp, 0);
          let lat = a.lat + ((b.lat - a.lat) * i) / n;
          if (tmp.corridor) lat = clamp(lat, -0.6, 0.6);
          else lat = clamp(lat, -3, 3);
          nav.pointAt(s, tmp, lat);
          out.push({ x: tmp.x, z: tmp.z });
        }
        out.push({ x, z });
        return out;
      } catch (err) {
        console.warn('[mürettebat] halka yolu kurulamadı:', err);
      }
    }
    return [{ x, z }];
  }

  _finishWalk() {
    this.speed = 0;
    this.moving = false;
    if (this.pose === 'walk' || this.pose === 'run') this.pose = this._then || 'idle';
    if (this._face) this.targetYaw = Math.atan2(this._face[0] - this.group.position.x, this._face[1] - this.group.position.z);
    const r = this._resolve;
    this._resolve = null;
    this._path.length = 0;
    if (r) r(true);
  }

  follow(target, opts = {}) {
    if (!target) {
      if (this._followCfg) {
        this._followCfg = null;
        this._path.length = 0;
        if (!this._resolve && (this.pose === 'walk' || this.pose === 'run')) this.pose = 'idle';
      }
      return;
    }
    this._cancelMove(false);
    this._poseTimer = 0;
    this._followCfg = { target, dist: opts.distance ?? 3, side: opts.side ?? 0, active: false };
  }

  _motion(dt) {
    const p = this.group.position;
    const F = this._followCfg;
    const scaleV = this.aged ? 0.6 : 1;
    this._followFaceTarget = null;

    if (F) {
      const T = F.target;
      const dx = T.x - p.x;
      const dz = T.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 45) {
        // çok geride kaldı: arkasına ışınla
        const ux = dx / (d || 1);
        const uz = dz / (d || 1);
        this.placeAt(T.x - ux * F.dist, T.z - uz * F.dist, Math.atan2(ux, uz));
        F.active = false;
      } else {
        if (!F.active && d > F.dist + 0.9) F.active = true;
        else if (F.active && d < F.dist + 0.15) F.active = false;
        if (F.active) {
          const ux = dx / d;
          const uz = dz / d;
          this._path = [{ x: T.x - ux * F.dist - uz * F.side, z: T.z - uz * F.dist + ux * F.side }];
          this._vmax = clamp(1.1 + (d - F.dist) * 0.9, 1.1, 3.9);
          this.pose = this._vmax > 2.4 ? 'run' : 'walk';
        } else {
          this._path.length = 0;
          if (this.pose === 'walk' || this.pose === 'run') this.pose = 'idle';
          this._followFaceTarget = T;
        }
      }
    }

    let desired = 0;
    if (this._path.length) {
      this._walkT += dt;
      let tgt = this._path[0];
      let dx = tgt.x - p.x;
      let dz = tgt.z - p.z;
      let d = Math.hypot(dx, dz);
      const last = this._path.length === 1;
      if (d < (last ? 0.1 : 0.4) || this._walkT > 150) {
        if (last) {
          if (!F) {
            if (this._walkT > 150 || d < 0.1) p.set(tgt.x, 0, tgt.z);
            this._finishWalk();
          } else {
            this._path.length = 0;
          }
          tgt = null;
        } else {
          this._path.shift();
          tgt = this._path[0];
          dx = tgt.x - p.x;
          dz = tgt.z - p.z;
          d = Math.hypot(dx, dz);
        }
      }
      if (tgt) {
        const heading = Math.atan2(dx, dz);
        this.targetYaw = heading;
        const e = Math.abs(angDiff(this.yaw, heading));
        let v = this._vmax * scaleV;
        if (last && !F) v = Math.min(v, 0.35 + d * 2.2);
        if (e > 0.25) v *= Math.pow(Math.max(0, Math.cos(Math.min(e, 1.5708))), 2);
        desired = v;
      }
    }
    this.speed += clamp(desired - this.speed, -7 * dt, 3.5 * dt);
    if (this.speed < 0.005) this.speed = 0;

    // dönüş
    const turnRate = desired > 0.05 || this.speed > 0.3 ? 6.5 : 3.2;
    const dy = angDiff(this.yaw, this.targetYaw);
    this.yaw += clamp(dy * (1 - Math.exp(-9 * dt)), -turnRate * dt, turnRate * dt);
    if (this.yaw > Math.PI) this.yaw -= TAU;
    else if (this.yaw < -Math.PI) this.yaw += TAU;
    this.group.rotation.y = this.yaw;

    if (this.speed > 0) {
      let step = this.speed * dt;
      if (this._path.length === 1 && !F) {
        const t = this._path[0];
        const dd = Math.hypot(t.x - p.x, t.z - p.z);
        if (step > dd) step = dd;
      }
      p.x += Math.sin(this.yaw) * step;
      p.z += Math.cos(this.yaw) * step;
    }
    this.moving = this.speed > 0.08 || this._path.length > 0;
  }

  // ------------------------------------------------------------------ çarpışma

  _syncCollider(force = false) {
    const col = this.ctx.collision;
    if (!col) return;
    const p = this.group.position;
    const want = this._shown && !this.moving && !this._followCfg?.active && this.pose !== 'sit' && this.speed === 0;
    if (!want) {
      if (this._collider) {
        col.remove(this._collider);
        this._collider = null;
      }
      return;
    }
    if (this._collider && !force && Math.hypot(this._colliderAt.x - p.x, this._colliderAt.y - p.z) < 0.05) return;
    if (this._collider) col.remove(this._collider);
    this._collider = col.addCircle(p.x, p.z, 0.26, { tag: `npc-${this.id}` });
    this._colliderAt.set(p.x, p.z);
    this._proxy.userData.collider = this._collider; // etkileşim ışını kendi çarpışmasına takılmasın
    this._handle._ownColliders = null;
  }

  // ------------------------------------------------------------------ görünürlük

  _worldOk() {
    const planet = !!this.ctx.world?.isPlanet?.();
    return (this.group.position.x > PLANET_X) === planet;
  }

  _applyVisibility() {
    const shown = this._visible && this._worldOk();
    this._shown = shown;
    this.group.visible = shown;
    // Kapı açıcı listesi
    const arr = this.ctx.doorOpeners;
    if (arr) {
      const idx = arr.indexOf(this.group.position);
      if (shown && idx < 0) arr.push(this.group.position);
      else if (!shown && idx >= 0) arr.splice(idx, 1);
    }
  }

  // ------------------------------------------------------------------ animasyon

  _applyWeights(dt) {
    const target = { idle: 0, sit: 0, type: 0, wave: 0 };
    let p = this.pose;
    if (this.talking && p === 'type') p = 'idle';
    if (p === 'sit') target.sit = 1;
    else if (p === 'type') target.type = 1;
    else if (p === 'wave') target.wave = 1;
    else target.idle = 1;
    let sum = 0;
    for (const k in target) {
      this.w[k] = dt >= 1 ? target[k] : damp(this.w[k], target[k], 6.5, dt);
      sum += this.w[k];
    }
    if (sum > 0) for (const k in this.w) this.w[k] /= sum;
  }

  _pose(dt) {
    const t = this._time;
    const ph = this._ph;
    const T = this._tmp;
    const w = this.w;
    if (w.idle > 0.002) poseIdle(this._zero(T.idle), t, ph);
    if (w.sit > 0.002) poseSit(this._zero(T.sit), t, ph, this);
    if (w.type > 0.002) poseType(this._zero(T.type), t, ph);
    if (w.wave > 0.002) poseWave(this._zero(T.wave), t, ph);
    const cur = this.cur;
    for (const k of KEYS) {
      let v = 0;
      if (w.idle > 0.002) v += w.idle * T.idle[k];
      if (w.sit > 0.002) v += w.sit * T.sit[k];
      if (w.type > 0.002) v += w.type * T.type[k];
      if (w.wave > 0.002) v += w.wave * T.wave[k];
      cur[k] = v;
    }
    void dt;
  }

  _zero(o) {
    for (const k of KEYS) o[k] = 0;
    return o;
  }

  _animate(dt) {
    this._time += dt;
    const t = this._time;
    this._agedAmt = damp(this._agedAmt, this.aged ? 1 : 0, 1.6, dt);
    this._applyWeights(dt);
    this._pose(dt);
    this._applyJoints(dt);
    void t;
  }

  _applyJoints(dt) {
    const M = this.model;
    const c = this.cur;
    const t = this._time;
    const age = this._agedAmt;

    // ---- yürüyüş döngüsü (ek katman)
    let gaitSpeed = this.speed;
    if (!this.moving && (this.pose === 'walk' || this.pose === 'run')) gaitSpeed = this.pose === 'run' ? RUN_SPEED : WALK_SPEED;
    const seatedish = this.w.sit > 0.5 || this.w.type > 0.5;
    const gaitOn = gaitSpeed > 0.12 && !seatedish ? 1 : 0;
    this._gait = damp(this._gait, gaitOn, 11, dt);
    const g = this._gait;
    const run = clamp((gaitSpeed - 1.9) / 1.5, 0, 1);
    this._spBlend = damp(this._spBlend, run, 6, dt);
    let A = clamp(0.16 + 0.19 * gaitSpeed, 0.12, 0.74);
    if (age > 0) A *= 1 - 0.25 * age;
    const stride = 3.6 * Math.sin(A);
    if (g > 0.01) this._phase += ((TAU * Math.max(gaitSpeed, 0.35)) / stride) * dt;
    const p = this._phase;
    const sL = Math.sin(p);
    const sR = -sL;
    const cL = Math.cos(p);
    const cR = -cL;
    const Aa = A * (0.62 + 0.4 * this._spBlend);
    const Kmax = 0.75 + 0.6 * this._spBlend;

    const hLx = c.hLx + g * -sL * A;
    const hRx = c.hRx + g * -sR * A;
    const knL = c.knLx + g * (0.05 + Kmax * Math.max(0, cL - 0.1));
    const knR = c.knRx + g * (0.05 + Kmax * Math.max(0, cR - 0.1));

    // yaşlı: hafif çökmüş diz/kalça
    const ageHip = -0.07 * age;
    const ageKnee = 0.14 * age;

    const hips = M.hips;
    hips.position.y = HIP_Y + c.hipY - g * 0.03 * sL * sL * (A / 0.43) + g * 0.008;
    hips.position.x = c.hx + g * 0.016 * Math.sin(p);
    hips.rotation.set(0, c.hry + g * 0.09 * sL, c.hrz + g * 0.03 * sL);

    const sp = c.sp + g * (0.03 + 0.2 * this._spBlend) + 0.2 * age;
    M.spine.rotation.set(sp + 0.012 * Math.sin(t * 1.55 + this._ph), c.sry - g * 0.12 * sL, c.srz);

    // ---- bakış
    const ly = this._lookYaw;
    const lp = this._lookPitch;
    M.neck.rotation.set(c.nk + 0.35 * lp + 0.18 * age, 0.4 * ly, 0.03 * ly);
    M.head.rotation.set(c.hd + 0.65 * lp - 0.14 * age, 0.6 * ly, -0.03 * ly);

    // ---- kollar (0 = sol, 1 = sağ)
    const armL = g * sL * Aa;
    const armR = g * sR * Aa;
    const elbowRun = g * (0.14 + 1.25 * this._spBlend);
    const sh = M.shoulders;
    sh[0].rotation.set(c.shLx + armL + 0.04 * age, 0, c.shLz);
    sh[1].rotation.set(c.shRx + armR + 0.04 * age, 0, c.shRz);
    const el = M.elbows;
    el[0].rotation.set(c.elLx - elbowRun, 0, c.elLz);
    el[1].rotation.set(c.elRx - elbowRun, 0, c.elRz);
    M.hands[0].rotation.set(c.wrLx, 0, 0);
    M.hands[1].rotation.set(c.wrRx, 0, 0);

    // ---- bacaklar
    const hj = M.hipJ;
    const kn = M.knees;
    const an = M.ankles;
    const hxL = hLx + ageHip;
    const hxR = hRx + ageHip;
    const kL = knL + ageKnee;
    const kR = knR + ageKnee;
    hj[0].rotation.set(hxL, 0, c.hLz);
    hj[1].rotation.set(hxR, 0, c.hRz);
    kn[0].rotation.set(kL, 0, 0);
    kn[1].rotation.set(kR, 0, 0);
    an[0].rotation.set(-(hxL + kL) * 0.9 + 0.25 * Math.max(0, hxL) * g, 0, 0);
    an[1].rotation.set(-(hxR + kR) * 0.9 + 0.25 * Math.max(0, hxR) * g, 0, 0);

    // ---- yüz: göz kırpma, ağız
    const eyes = M.eyes;
    const bl = this._blink > 0 ? 0.1 : 1;
    eyes[0].scale.y = eyes[1].scale.y = damp(eyes[0].scale.y, bl, 40, dt);
    const speaking = this._time < this._speakUntil;
    const mo = speaking ? 0.5 + 0.5 * Math.abs(Math.sin(t * 13 + Math.sin(t * 4.1) * 2)) : 0;
    this._mouth = damp(this._mouth, mo, 20, dt);
    M.mouth.scale.y = 1 + this._mouth * 3.2;
    M.mouth.scale.x = 1 - this._mouth * 0.15;
  }

  // ------------------------------------------------------------------ bakış / dikkat

  _look(dt) {
    const ctx = this.ctx;
    const p = this.group.position;
    const cam = ctx.camera.position;
    const hx = p.x;
    const hz = p.z;
    const headY = 1.62 * this.scale;
    const dxp = cam.x - hx;
    const dzp = cam.z - hz;
    const dp = Math.hypot(dxp, dzp);
    const near = dp < 6.5 && Math.abs(cam.y - headY) < 3;

    let tx = 0;
    let ty = 0;
    let tz = 0;
    let has = false;
    let player = false;
    if (this.talking || near) {
      tx = cam.x;
      ty = cam.y;
      tz = cam.z;
      has = true;
      player = true;
    } else if (this._followFaceTarget) {
      tx = this._followFaceTarget.x;
      tz = this._followFaceTarget.z;
      ty = headY;
      has = true;
    } else if (this._gaze) {
      tx = this._gaze.x;
      ty = this._gaze.y;
      tz = this._gaze.z;
      has = true;
    }

    let yawT = 0;
    let pitT = 0;
    const seated = this.w.sit > 0.5 || this.w.type > 0.5;
    const lim = seated ? 1.2 : 1.35;
    if (has) {
      const rel = angDiff(this.yaw, Math.atan2(tx - hx, tz - hz));
      const horiz = Math.hypot(tx - hx, tz - hz) || 1;
      yawT = clamp(rel, -lim, lim);
      pitT = clamp(Math.atan2(ty - headY, horiz), -0.5, 0.45);
      // gövde de döner: konuşurken tam, yakınken yumuşak (yalnızca ayakta, serbest duruşta)
      const free = this.pose === 'idle' || this.pose === 'wave' || (this.talking && this.pose !== 'sit');
      if (free && !this.moving && !this._path.length) {
        if (this.talking && player) this.targetYaw = Math.atan2(tx - hx, tz - hz);
        else if (Math.abs(rel) > 0.75 && dp < 4.5) this.targetYaw = this.yaw + rel * 0.6;
        else if (this._followFaceTarget && Math.abs(rel) > 0.4) this.targetYaw = Math.atan2(tx - hx, tz - hz);
      }
      if (this.talking && this.pose === 'sit' && Math.abs(rel) > 1.2) this.targetYaw = this.yaw + rel * 0.4;
    } else {
      // rastgele bakınma
      this._glanceT -= dt;
      if (this._glanceT <= 0) {
        this._glanceT = 2.5 + Math.random() * 5;
        const r = Math.random();
        this._glanceYaw = r < 0.4 ? 0 : (Math.random() - 0.5) * 1.0;
        this._glancePitch = r < 0.4 ? 0 : (Math.random() - 0.5) * 0.25;
      }
      yawT = this._glanceYaw;
      pitT = this._glancePitch;
    }
    if (this.pose === 'type' && !this.talking && !player) {
      yawT = clamp(yawT, -0.2, 0.2);
      pitT = Math.min(pitT, -0.05); // ekrana bakar
    }
    this._lookYaw = damp(this._lookYaw, yawT, 5.5, dt);
    this._lookPitch = damp(this._lookPitch, pitT, 5.5, dt);

    // göz kırpma
    this._blinkT -= dt;
    if (this._blinkT <= 0) {
      this._blink = 0.13;
      this._blinkT = 2.2 + Math.random() * 4;
    }
    if (this._blink > 0) this._blink -= dt;
  }

  // ------------------------------------------------------------------ güncelleme

  update(dt) {
    dt = Math.min(dt, 0.1);
    this._applyVisibility();
    if (this._poseTimer > 0) {
      this._poseTimer -= dt;
      if (this._poseTimer <= 0 && this.pose === 'wave') this.pose = this._prevPose || 'idle';
    }
    this._motion(dt);
    this._syncCollider();
    if (!this._shown) return;
    this._look(dt);
    // uzaktaysa animasyonu atla (yalnızca zaman ilerler)
    const cam = this.ctx.camera.position;
    const p = this.group.position;
    if (Math.abs(cam.x - p.x) + Math.abs(cam.z - p.z) > 90) {
      this._time += dt;
      return;
    }
    this._animate(dt);
  }

  // ------------------------------------------------------------------ konuşma

  say(text, ms = 4000) {
    if (!text) return;
    const { ui, audio } = this.ctx;
    ui?.subtitle?.(this.name, text, ms);
    this._speakUntil = this._time + clamp(0.6 + text.length * 0.062, 1.5, 12);
    this._speak(text);
  }

  _speak(text) {
    try {
      const p = this.ctx.audio?.speak?.(text, { voice: 'crew', pitch: this.def.pitch ?? 1, rate: this.def.rate ?? 1.02 });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (err) {
      console.warn('[mürettebat] konuşma sentezi hatası:', err);
    }
  }

  get speaking() {
    return this._time < this._speakUntil;
  }

  _interact() {
    const { bus } = this.ctx;
    bus.emit('crew:talk', { id: this.id });
    const t = this.talk;
    if (t && typeof t.onTalk === 'function') t.onTalk();
    else this.openDialog();
  }

  /**
   * Diyalog aç. `node` verilmezse oyun bayraklarına göre varsayılan diyalog.
   * Düğüm: { text, options: [{ label, reply?, next?, action? }] } — bkz. crewDialog.js
   */
  openDialog(node = null) {
    const ui = this.ctx.ui;
    if (!ui?.openDialog || ui.isModalOpen?.()) return null;
    const root = node || buildRoot(this.id, this.ctx, this);
    this.talking = true;
    this._startTalk(root, root);
    return root;
  }

  _decorate(node, root) {
    const closeOpt = { label: 'Görüşürüz', close: true };
    const opts = (node.options || []).map((o) => ({ ...o }));
    if (node !== root && node.back !== false) opts.push({ label: 'Başka bir şey soracağım', next: root });
    opts.push(closeOpt);
    return opts;
  }

  _optionsFor(node, root) {
    return this._decorate(node, root).map((o) => ({
      label: o.label,
      action: () => {
        try {
          o.action?.();
        } catch (err) {
          console.error('[mürettebat] diyalog eylemi hatası:', err);
        }
        let next = o.next;
        if (typeof next === 'function') next = next();
        if (!next && o.reply) next = { text: o.reply };
        if (next && !o.close) {
          this._showNode(next, root);
          return false;
        }
        return undefined;
      },
    }));
  }

  _showNode(node, root) {
    const h = this._dlg;
    this._speakNode(node.text);
    if (h && typeof h.setOptions === 'function') {
      h.setText(node.text);
      h.setOptions(this._optionsFor(node, root));
    } else {
      this._startTalk(node, root);
    }
  }

  _speakNode(text) {
    this._speakUntil = this._time + clamp(0.6 + text.length * 0.062, 1.5, 14);
    this._speak(text);
  }

  _startTalk(node, root) {
    const { ui, audio } = this.ctx;
    this.ctx.audio?.play?.('beep', { volume: 0.18 });
    this._speakNode(node.text);
    this._reopening = true;
    this._dlg = ui.openDialog({
      speaker: this.name,
      text: node.text,
      options: this._optionsFor(node, root),
      onClose: () => {
        // yeniden açma (yedek yol) sırasında eski kapanışı yok say
        if (this._reopening) return;
        this.talking = false;
        this._dlg = null;
        try {
          audio?.stopSpeaking?.();
        } catch {
          /* yok say */
        }
        this._speakUntil = 0;
      },
    });
    this._reopening = false;
  }
}
