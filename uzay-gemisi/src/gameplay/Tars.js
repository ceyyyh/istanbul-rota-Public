import * as THREE from 'three';
import { RingNav } from './ringNav.js';
import { buildTarsModel, HINGE, SLAB_D } from './tarsModel.js';
import * as LINES from './tarsLines.js';

/*
 * TARS — dört bloklu yardımcı robot.
 *
 * Herkese açık API (Missions ve hata ayıklama için):
 *   tars.group                 THREE.Group (dünya; position = ayak orta noktası)
 *   tars.position              = group.position (ctx.doorOpeners içinde)
 *   tars.scripted              true → kendi başına hareket etmez (sinematik)
 *   tars.humor / tars.honesty  0..100
 *   tars.say(text, { priority, force, delay, expires })
 *   tars.placeLocal(modulId, lx, lz, faceWorldPos?)  /  tars.placeAt(x, z, yaw)
 *   tars.faceTowards(x, z) · tars.gesture('wave'|'cheer') · tars.setExpression(ad, sn?)
 *   tars.headPosition(out)     ekranın dünya konumu (kamera çevirmek için)
 *   tars.openDialog()          konuşma menüsü
 */

const FOLLOW_DIST = 2.8; // oyuncunun bu kadar gerisinde durur (yol boyunca)
const START_DIST = 4.2; // yol mesafesi bundan büyükse yürümeye başlar
const STOP_EUCLID = 2.5; // oyuncuya bu kadar yaklaşınca durur
const PERSONAL = 1.2; // kişisel alan: oyuncu bundan yakınsa kenara çekilir
const MAX_SPEED = 4.6;
const TELEPORT_DIST = 18; // ~1 modül
const GAIT_A = 0.3; // adım açısı (radyan)
const LEG = HINGE; // menteşe → taban

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _frustum = new THREE.Frustum();
const _sphere = new THREE.Sphere(new THREE.Vector3(), 0.95);

function dampAngle(a, b, lambda, dt, maxRate = Infinity) {
  let d = b - a;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  let step = d * (1 - Math.exp(-lambda * dt));
  const lim = maxRate * dt;
  if (step > lim) step = lim;
  else if (step < -lim) step = -lim;
  return a + step;
}

const fmt = (s, v) => s.replace('{v}', String(v));

export class Tars {
  constructor(ctx) {
    this.ctx = ctx;
    this.nav = new RingNav(ctx.layout);

    this.group = new THREE.Group();
    this.group.name = 'TARS';
    const model = buildTarsModel(ctx);
    this.model = model;
    this.group.add(model.root);
    ctx.scene.add(this.group);
    /** kapılar TARS'a da açılır */
    ctx.doorOpeners?.push(this.group.position);

    // --- hareket durumu ---
    this.s = 0;
    this.lat = 0;
    this.latTarget = 0;
    this.vs = 0; // yol boyunca işaretli hız
    this.yaw = 0;
    this.walking = false;
    this.scripted = false;
    this.talking = false;
    this.mode = 'idle';
    this._tpCooldown = 0;
    this._prev = new THREE.Vector3();
    this._pp = { s: 0, lat: 0, d2: 0 };
    this._prevSP = null;
    this._playerVS = 0;
    this._pt = {};

    // --- animasyon ---
    this._phase = 0;
    this._amp = 0;
    this._time = 0;
    this._gesture = null;
    this._exprUntil = 0;
    this._lastStepHalf = 0;

    // --- kişilik ---
    this.humor = 70;
    this.honesty = 90;

    // --- konuşma ---
    this._speechEnd = 0;
    this._queue = [];
    this._idleT = 70 + Math.random() * 40;
    this._seenModules = new Set();
    this._started = false;
    this._doorLockedSaid = -1e9;

    this._doors = null; // ilk güncellemede hesaplanır

    // Başlangıç: hiper-uyku bölmesinde, oyuncunun doğduğu yere dönük
    const spawn = ctx.layout.localToWorld(ctx.layout.moduleIndexById('cryo'), -2.5, 0);
    this.placeLocal('cryo', 1.5, 1.2, spawn);

    // --- etkileşim ---
    this.handle = ctx.interactions.add(this.group, {
      prompt: 'TARS ile konuş',
      onInteract: () => this.openDialog(),
      enabled: () => !this.talking && !this.scripted,
      distance: 3.3,
      id: 'tars',
    });

    this._bindEvents();
  }

  get position() {
    return this.group.position;
  }

  // ------------------------------------------------------------------ yerleşim

  placeAt(x, z, yaw = this.yaw) {
    const p = this.nav.project(x, z, {});
    this.s = p.s;
    this.lat = p.lat;
    this.latTarget = p.lat;
    this.vs = 0;
    this.walking = false;
    this.yaw = yaw;
    this._syncPosition();
    this._prev.copy(this.group.position);
    this.group.rotation.y = this.yaw;
  }

  placeLocal(id, lx, lz, faceWorld = null) {
    const L = this.ctx.layout;
    const w = L.localToWorld(L.moduleIndexById(id), lx, lz);
    let yaw = this.yaw;
    if (faceWorld) yaw = Math.atan2(faceWorld.x - w.x, faceWorld.z - w.z);
    this.placeAt(w.x, w.z, yaw);
  }

  faceTowards(x, z, instant = false) {
    const p = this.group.position;
    this._faceYaw = Math.atan2(x - p.x, z - p.z);
    if (instant) {
      this.yaw = this._faceYaw;
      this.group.rotation.y = this.yaw;
    }
  }

  headPosition(out = new THREE.Vector3()) {
    const p = this.group.position;
    return out.set(p.x + Math.sin(this.yaw) * 0.2, 1.12, p.z + Math.cos(this.yaw) * 0.2);
  }

  _syncPosition() {
    const pt = this.nav.pointAt(this.s, this._pt, this.lat);
    this.group.position.set(pt.x, 0, pt.z);
  }

  // ------------------------------------------------------------------ olaylar

  _bindEvents() {
    const { bus, state } = this.ctx;
    bus.on('game:start', () => {
      this._started = true;
    });
    bus.on('state:changed', ({ key, value }) => {
      if (!this._started || !value) return;
      const delays = { power_restored: 2.6, messages_read: 1.2, ring_spinning: 3.5, blackhole_observed: 1.2, found_morse: 1.5 };
      if (key in delays) {
        this.say(this._variant(LINES.EVENTS[key]), { delay: delays[key], priority: 3, expires: 40 });
        if (key === 'power_restored' || key === 'ring_spinning') this._pendingGesture = { name: 'cheer', at: this._time + delays[key] };
      }
    });
    bus.on('player:module', ({ id, prev }) => {
      if (prev === undefined || prev < 0) {
        // ilk konumlandırma (doğma / ışınlanma) — yorum yok
        this._seenModules.add(id);
        return;
      }
      if (this._seenModules.has(id)) return;
      this._seenModules.add(id);
      if (!this._started || !state.is('intro_done')) return;
      let key = id;
      if (id === 'engine' && state.is('power_restored')) key = 'engine_powered';
      if (id === 'comms' && !state.is('power_restored')) key = 'comms_dark';
      const pair = LINES.MODULE_FIRST[key];
      if (pair) this.say(this._variant(pair), { delay: 1.1, priority: 1, expires: 12 });
    });
    bus.on('door:locked', ({ door }) => {
      if (!this._started || state.is('power_restored')) return;
      if (this._time - this._doorLockedSaid < 90) return;
      this._doorLockedSaid = this._time;
      this.say(this._variant(LINES.EVENTS.door_locked), { delay: 0.4, priority: 2, expires: 6 });
      void door;
    });
    bus.on('ui:modal', ({ open }) => {
      if (!open && this.talking && !this._navigating) this._dialogClosed();
    });
  }

  /** [esprili, kuru] çiftinden mizah ayarına göre seç */
  _variant(pair) {
    if (!pair) return '';
    return this.humor >= 30 ? pair[0] : pair[1];
  }

  // ------------------------------------------------------------------ konuşma

  /**
   * TARS konuşur: ses + altyazı + 'tars:say'. Meşgulse kuyruğa alır.
   * opts: priority (yüksek önce), force (hemen, kuyruğu temizler), delay (sn), expires (sn)
   */
  say(text, { priority = 1, force = false, delay = 0, expires = 30 } = {}) {
    if (!text) return;
    if (force) {
      this._queue.length = 0;
      this._speak(text);
      return;
    }
    const item = { text, priority, at: this._time + delay, expires: this._time + delay + expires };
    this._queue.push(item);
    this._queue.sort((a, b) => b.priority - a.priority || a.at - b.at);
    if (this._queue.length > 4) this._queue.length = 4;
  }

  get speaking() {
    return this._time < this._speechEnd;
  }

  _speak(text) {
    const { ui, audio, bus } = this.ctx;
    const dur = THREE.MathUtils.clamp(1.4 + text.length * 0.065, 2.5, 14);
    this._speechEnd = this._time + dur;
    this._idleT = Math.max(this._idleT, 45 + Math.random() * 30);
    ui?.subtitle?.('TARS', text, Math.round(dur * 1000 + 600));
    bus.emit('tars:say', { text });
    try {
      const p = audio?.speak?.(text, { voice: 'tars' });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (err) {
      console.warn('[TARS] konuşma sentezi hatası:', err);
    }
    if (this._exprUntil < this._time) this.model.screen.set('talk');
  }

  _updateSpeech(dt) {
    const ui = this.ctx.ui;
    if (!this.speaking && this.model.screen.expression === 'talk' && this._exprUntil < this._time) this.model.screen.set('idle');
    if (this.speaking || !this._queue.length) return;
    if (this._time < this._speechEnd + 0.7) return;
    const modal = !!ui?.isModalOpen?.();
    // süresi dolanları at
    this._queue = this._queue.filter((q) => q.expires > this._time);
    if (modal || this.scripted) return;
    const idx = this._queue.findIndex((q) => q.at <= this._time);
    if (idx < 0) return;
    const [item] = this._queue.splice(idx, 1);
    this._speak(item.text);
    void dt;
  }

  setExpression(name, seconds = 0, text = '') {
    this.model.screen.set(name, text);
    this._exprUntil = seconds > 0 ? this._time + seconds : 0;
  }

  gesture(name) {
    this._gesture = { name, t: 0, dur: name === 'wave' ? 2.2 : 1.6 };
    this.ctx.audio?.play?.('servo', { volume: 0.35, position: this.group.position });
  }

  // ------------------------------------------------------------------ diyalog

  openDialog() {
    const { ui, state } = this.ctx;
    if (!ui?.openDialog || ui.isModalOpen?.()) return;
    this.talking = true;
    this.walking = false;
    let text;
    if (!state.is('talked_tars')) {
      text = LINES.FIRST_TALK;
      state.set('talked_tars', true);
    } else {
      text = LINES.pick(LINES.GREETINGS[LINES.humorBand(this.humor)]);
    }
    this._menu(text);
  }

  _open(text, options) {
    this.ctx.audio?.play?.('beep', { volume: 0.3 });
    this._lastDialog = { text, options };
    this._dlg = this.ctx.ui.openDialog({ speaker: 'TARS', text, options, onClose: () => this._onDialogClose() });
  }

  /** Bir seçenekten başka bir menüye geç (mevcut diyalog kapanır, yenisi açılır) */
  _goto(fn) {
    this._navigating = true;
    setTimeout(() => {
      this._navigating = false;
      if (!this.talking) return;
      fn();
    }, 0);
  }

  _onDialogClose() {
    if (this._navigating) return;
    // ui:modal olayı gelmeyebilir — güvenli tarafta kal
    setTimeout(() => {
      if (!this._navigating && this.talking && !this.ctx.ui.isModalOpen?.()) this._dialogClosed();
    }, 0);
  }

  _dialogClosed() {
    this.talking = false;
  }

  _menu(text) {
    this.say(text, { force: true });
    this._open(text, [
      { label: 'Durum raporu', action: () => this._goto(() => this._menu(this._statusReport())) },
      { label: `Mizah ayarı (%${this.humor})`, action: () => this._goto(() => this._settingMenu('humor')) },
      { label: `Dürüstlük ayarı (%${this.honesty})`, action: () => this._goto(() => this._settingMenu('honesty')) },
      { label: 'Görevimiz ne?', action: () => this._goto(() => this._menu(this._missionText())) },
      {
        label: 'Şimdilik bu kadar',
        action: () => {
          this.talking = false;
          this.say(LINES.pick(LINES.GOODBYES[LINES.humorBand(this.humor)]), { force: true });
        },
      },
    ]);
  }

  _settingMenu(kind) {
    const isHumor = kind === 'humor';
    const cur = isHumor ? this.humor : this.honesty;
    const levels = isHumor ? [0, 25, 50, 75, 100] : [0, 50, 75, 90, 100];
    const title = isHumor ? 'Mizah' : 'Dürüstlük';
    const text = `${title} ayarı şu an %${cur}. Yeni değer?`;
    this.say(text, { force: true });
    this._open(text, [
      ...levels.map((v) => ({
        label: `%${v}${v === cur ? '  (şu anki)' : ''}`,
        action: () =>
          this._goto(() => {
            if (isHumor) this.humor = v;
            else this.honesty = v;
            const pool = isHumor ? LINES.HUMOR_SET[LINES.humorBand(v)] : LINES.HONESTY_SET[LINES.honestyBand(v)];
            this.setExpression(v >= 75 && isHumor ? 'happy' : v <= 10 ? 'idle' : 'wink', 3);
            this._menu(fmt(LINES.pick(pool), v));
            this.setExpression('text', 3.2, `${title.toLocaleUpperCase('tr-TR')} %${v}`);
          }),
      })),
      { label: 'Geri', action: () => this._goto(() => this._menu('Ayar aynı kaldı. Başka bir şey?')) },
    ]);
  }

  _statusReport() {
    const st = this.ctx.state;
    const hb = LINES.honestyBand(this.honesty);
    const power = st.is('power_restored');
    if (hb === 'low') {
      return (
        'Durum raporu: her şey kusursuz! Enerji bol, kahve sıcak, kara delik son derece sevimli ve mürettebat bize el sallıyor. ' +
        `Hatırlatma: dürüstlük ayarım %${this.honesty}.`
      );
    }
    const parts = [];
    if (power) parts.push('Ana enerji çevrimiçi, reaktör kararlı.');
    else
      parts.push(
        hb === 'high'
          ? 'Ana enerji kapalı. Acil durum bataryaları %31 seviyesinde ve saatte yaklaşık bir puan düşüyor.'
          : 'Ana enerji kapalı; bataryalar bir süre daha idare eder.',
      );
    parts.push(
      st.is('ring_spinning')
        ? 'Halka dönüyor, yapay yer çekimi 0,9 g.'
        : 'Halka sabit; şu an seni yerde tutan şey manyetik botların.',
    );
    if (st.is('messages_read')) parts.push('Dünya’dan gelen mesajlar dinlendi.');
    else if (power) parts.push('İletişim modülünde dinlenmemiş mesajlar var.');
    else parts.push('İletişim alıcıları enerji bekliyor.');
    parts.push('Mürettebatın geri kalanı hiper-uykuda; yaşamsal belirtileri kararlı.');
    parts.push(hb === 'high' ? 'Oksijen rezervi 41 gün; hidroponik tam kapasiteye geçerse süresiz.' : 'Oksijen yeterli.');
    if (st.is('blackhole_observed')) parts.push('Gargantua gözlem verileri kaydedildi.');
    else
      parts.push(
        hb === 'high'
          ? 'Gargantua’ya uzaklığımız güvenli sınırın içinde. Daha doğrusu, şimdilik güvenli sınırın içinde.'
          : 'Gargantua’yla aramızda rahat bir mesafe var.',
      );
    return 'Durum raporu: ' + parts.join(' ');
  }

  _missionText() {
    const info = this.ctx.missions?.getObjective?.() || {};
    const key = info.flag && LINES.MISSION_TALK[info.flag] ? info.flag : 'done';
    const body = LINES.MISSION_TALK[key].replace('{hint}', info.spokenHint || 'halka boyunca ilerle');
    if (key === 'done' || key === 'talked_tars') return body;
    const hb = LINES.honestyBand(this.honesty);
    return `${LINES.BIG_PICTURE[hb]} ${body}`;
  }

  // ------------------------------------------------------------------ gezinme

  _initDoors() {
    this._doors = [];
    for (const door of this.ctx.doors || []) {
      const p = door.position;
      if (!p) continue;
      const pr = this.nav.project(p.x, p.z, {});
      if (pr.d2 > 1.2) continue; // halka yolu üzerinde olmayan kapı (ör. dış hava kilidi)
      this._doors.push({ door, s: pr.s });
    }
  }

  /** from → to (dir yönünde) arasında kilitli kapı var mı? En yakınını döndürür. */
  _blockingDoor(from, to, dir) {
    let best = null;
    let bestD = Infinity;
    for (const d of this._doors) {
      if (!d.door.locked) continue;
      if (!this.nav.between(d.s, from, to, dir)) continue;
      const dd = this.nav.along(from, d.s, dir);
      if (dd < bestD) {
        bestD = dd;
        best = { s: d.s, dist: dd };
      }
    }
    return best;
  }

  /** TARS'tan oyuncuya gidilecek yön ve mesafe (kilitli kapılar hesaba katılır). */
  _route(from, to) {
    const L = this.nav.length;
    const fwd = this.nav.along(from, to, 1);
    const bwd = L - fwd;
    const bF = this._blockingDoor(from, to, 1);
    const bB = this._blockingDoor(from, to, -1);
    if (!bF && (fwd <= bwd || bB)) return { dir: 1, dist: fwd, block: null };
    if (!bB) return { dir: -1, dist: bwd, block: null };
    const dir = fwd <= bwd ? 1 : -1;
    return { dir, dist: dir > 0 ? fwd : bwd, block: dir > 0 ? bF : bB };
  }

  _isVisible(x, z) {
    const cam = this.ctx.camera;
    cam.updateMatrixWorld();
    _m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_m);
    _sphere.center.set(x, 0.8, z);
    if (!_frustum.intersectsSphere(_sphere)) return false;
    // iki modülden uzaktaysa halkanın eğimi ve duvarlar görüşü keser
    const a = this.ctx.layout.locate(x, z).index;
    const b = this.ctx.player.location?.index ?? a;
    const n = this.ctx.layout.MODULE_COUNT;
    const diff = Math.min((a - b + n) % n, (b - a + n) % n);
    return diff < 2;
  }

  _tryTeleport(sP) {
    if (this._tpCooldown > 0) return false;
    const P = this.ctx.player;
    const here = this.group.position;
    if (this._isVisible(here.x, here.z)) return false;
    const fwd = P.getForward(_v);
    const t = this.nav.pointAt(sP, {});
    const face = fwd.x * t.tx + fwd.z * t.tz >= 0 ? 1 : -1;
    let sNew = sP - face * 3.0;
    const blk = this._blockingDoor(sP, sNew, -face);
    if (blk) {
      sNew = blk.s + face * 1.0;
      if (this.nav.along(sP, sNew, -face) < 1.2 || this.nav.along(sP, sNew, -face) > 3.5) {
        this._tpCooldown = 1;
        return false;
      }
    }
    const np = this.nav.pointAt(sNew, {});
    if (this._isVisible(np.x, np.z)) {
      this._tpCooldown = 0.5;
      return false;
    }
    this.s = this.nav.wrap(sNew);
    this.lat = 0;
    this.latTarget = 0;
    this.vs = 0;
    this.walking = false;
    this._syncPosition();
    this._prev.copy(this.group.position);
    this.yaw = Math.atan2(P.position.x - np.x, P.position.z - np.z);
    this._tpCooldown = 3;
    return true;
  }

  // ------------------------------------------------------------------ güncelleme

  update(dt, t) {
    if (!(dt > 0)) return;
    this._time += dt;
    if (!this._doors) this._initDoors();
    if (this._tpCooldown > 0) this._tpCooldown -= dt;

    const ctx = this.ctx;
    const P = ctx.player.position;
    const pos = this.group.position;
    const sp = this.nav.project(P.x, P.z, this._pp);
    const sP = sp.s;
    if (this._prevSP !== null) {
      const v = this.nav.delta(this._prevSP, sP) / dt;
      // ışınlanmada sıçramayı yok say
      this._playerVS = Math.abs(v) > 20 ? 0 : THREE.MathUtils.damp(this._playerVS, v, 8, dt);
    }
    this._prevSP = sP;
    const dx = P.x - pos.x;
    const dz = P.z - pos.z;
    const euclid = Math.hypot(dx, dz);
    const dP = this.nav.delta(this.s, sP); // + : oyuncu yol boyunca önde

    let desired = 0;
    let latGoal = this.latTarget;
    let latRate = 0;
    let faceMode = 'player'; // 'player' | 'motion' | 'keep'
    this.mode = 'idle';

    if (this.scripted) {
      this.walking = false;
      faceMode = this._faceYaw !== undefined ? 'script' : 'keep';
    } else if (this.talking) {
      this.walking = false;
      // diyalog kapanmış ama haber gelmemişse (ör. Esc) serbest kal
      if (!ctx.ui?.isModalOpen?.() && !this._navigating) {
        this._noModalT = (this._noModalT || 0) + dt;
        if (this._noModalT > 0.5) this._dialogClosed();
      } else this._noModalT = 0;
    } else {
      const route = this._route(this.s, sP);
      if (!route.block && route.dist > TELEPORT_DIST && this._tryTeleport(sP)) {
        return this._animate(dt, t, true);
      }
      // Aynı modülün içindeysek oyuncunun yan konumuna biraz yaklaş (geniş modülde köşeye giden oyuncu)
      const sameRoom =
        this._inModuleInterior() && ctx.player.location?.region === 'module' &&
        ctx.player.location.index === ctx.layout.locate(pos.x, pos.z).index;
      const latWant = sameRoom ? THREE.MathUtils.clamp(sp.lat * 0.8, -0.9, 0.9) : 0;
      const dLat = sp.lat - latWant;
      const gap = Math.sqrt(Math.max(0.36, FOLLOW_DIST * FOLLOW_DIST - dLat * dLat));
      let travel = route.dist - gap;
      if (route.block) travel = Math.min(travel, route.block.dist - 1.3);
      const away = this._playerVS * route.dir; // oyuncu bizden uzaklaşıyorsa +
      if (!this.walking) {
        if (route.dist > START_DIST && euclid > 3.3 && travel > 0.9) this.walking = true;
      } else if ((travel <= 0.05 && Math.abs(this._playerVS) < 0.6) || euclid < STOP_EUCLID || (route.block && travel <= 0.05)) {
        this.walking = false;
      }
      if (this.walking) {
        // oyuncunun hızına uy + aradaki farkı kapat
        const v = Math.max(0, away) * 0.9 + 0.45 + travel * 1.25;
        desired = route.dir * THREE.MathUtils.clamp(v, 0, MAX_SPEED);
        latGoal = latWant;
        latRate = Math.abs(this.vs) * 0.9;
        faceMode = 'motion';
        this.mode = route.block ? 'wait' : 'follow';
      } else if (sameRoom && euclid > 3.2 && Math.abs(latWant - this.lat) > 0.3) {
        // durduğu yerde yana bir-iki adım
        latGoal = latWant;
        latRate = 1.2;
      }

      // Kişisel alan: oyuncu üstümüze geliyorsa veya çok yakınsa yol ver
      const awayDir = dP >= 0 ? -1 : 1; // oyuncudan uzaklaşan yol yönü
      const approach = -this._playerVS * Math.sign(dP || 1); // oyuncu bize doğru geliyorsa +
      const lookingAtMe = ctx.interactions?.current === this.handle;
      const inLane = Math.abs(this.lat - sp.lat) < 0.75;
      const interior = this._inModuleInterior();
      const rushing = approach > 0.6 && euclid < 2.8 && inLane && Math.abs(dP) < 2.8 && (!lookingAtMe || euclid < 0.9);
      if (rushing || euclid < PERSONAL) {
        if (this._yieldSide === undefined) this._yieldSide = sp.lat >= this.lat ? -1 : 1;
        latGoal = this._yieldSide * 0.9;
        latRate = rushing ? 4 : 3;
        this.walking = false;
        if (rushing && !interior) {
          // dar yerde (koridor/kapı): önden yürüyüp ilk modülde kenara çekil
          desired = awayDir * Math.min(MAX_SPEED, approach + 0.5);
          faceMode = 'motion';
          this.mode = 'yield';
        } else if (!rushing && Math.abs(dP) < 1.0 && inLane) {
          desired = awayDir * 0.7;
          faceMode = 'player';
          this.mode = 'backoff';
        } else {
          desired = 0;
          faceMode = 'player';
          this.mode = 'aside';
        }
      } else if (euclid > 2.2) {
        this._yieldSide = undefined;
      }
    }

    // Kapı önünde yavaşla (kapı açılırken bekle)
    if (Math.abs(desired) > 0.01) desired = this._doorLimit(desired);

    this.vs = THREE.MathUtils.damp(this.vs, desired, desired === 0 ? 6 : 3.5, dt);
    if (Math.abs(this.vs) < 0.005 && desired === 0) this.vs = 0;
    this.s = this.nav.wrap(this.s + this.vs * dt);

    // Yanal konum (koridor ve kapılarda daralır)
    const maxLat = this._maxLat();
    this.latTarget = latGoal;
    const allowed = Math.abs(this.vs) > 0.1 || latRate > 0 ? maxLat : Math.max(maxLat, Math.abs(this.lat));
    const goal = THREE.MathUtils.clamp(latGoal, -allowed, allowed);
    const k = 1 - Math.exp(-(latRate + (Math.abs(this.lat) > maxLat ? Math.abs(this.vs) * 1.5 : 0)) * dt);
    this.lat += (goal - this.lat) * k;
    if (Math.abs(this.lat) > allowed + 0.4) this.lat = Math.sign(this.lat) * (allowed + 0.4);
    this._syncPosition();

    // Yönelim
    let yawT = this.yaw;
    const mvx = pos.x - this._prev.x;
    const mvz = pos.z - this._prev.z;
    const mv = Math.hypot(mvx, mvz) / dt;
    if (faceMode === 'script') yawT = this._faceYaw;
    else if (faceMode === 'motion' && mv > 0.3) yawT = Math.atan2(mvx, mvz);
    else if (faceMode === 'player' && euclid < 12 && euclid > 0.3) yawT = Math.atan2(dx, dz);
    this.yaw = dampAngle(this.yaw, yawT, 5, dt, 2.8);

    this._animate(dt, t, false);
  }

  _inModuleInterior() {
    const loc = this.ctx.layout.locate(this.group.position.x, this.group.position.z);
    return loc.region === 'module' && Math.abs(loc.lx) < 4.2;
  }

  _maxLat() {
    const loc = this.ctx.layout.locate(this.group.position.x, this.group.position.z);
    if (loc.region !== 'module') return 0.3;
    const ax = Math.abs(loc.lx);
    if (ax < 4.0) return 0.9;
    if (ax > 5.2) return 0.25;
    return THREE.MathUtils.lerp(0.9, 0.25, (ax - 4.0) / 1.2);
  }

  _doorLimit(desired) {
    const dir = Math.sign(desired);
    let limit = Math.abs(desired);
    for (const d of this._doors) {
      const ahead = this.nav.along(this.s, d.s, dir);
      if (ahead > 1.4) continue;
      const door = d.door;
      const open = (door.openness ?? (door.isOpen ? 1 : 0)) > 0.6;
      if (door.locked) limit = Math.min(limit, Math.max(0, (ahead - 0.9) * 2));
      else if (!open) limit = Math.min(limit, Math.max(0.15, (ahead - 0.5) * 1.5));
    }
    return dir * limit;
  }

  // ------------------------------------------------------------------ animasyon

  _animate(dt, t, teleported) {
    const { body, slabs, screen } = this.model;
    const pos = this.group.position;
    this.group.rotation.y = this.yaw;

    // Gerçek hareketten yürüyüş fazı
    let vx = 0;
    let vz = 0;
    if (!teleported) {
      vx = (pos.x - this._prev.x) / dt;
      vz = (pos.z - this._prev.z) / dt;
    }
    this._prev.copy(pos);
    const speed = Math.hypot(vx, vz);
    const fwd = vx * Math.sin(this.yaw) + vz * Math.cos(this.yaw);
    const yawRate = this._lastYaw === undefined ? 0 : Math.abs(Math.atan2(Math.sin(this.yaw - this._lastYaw), Math.cos(this.yaw - this._lastYaw))) / dt;
    this._lastYaw = this.yaw;

    let ampT = THREE.MathUtils.clamp(speed / 1.3, 0, 1);
    let rate = fwd / (4 * LEG * Math.sin(GAIT_A)) + (speed > 0.1 && Math.abs(fwd) < speed * 0.5 ? 0.6 : 0);
    if (speed < 0.15 && yawRate > 0.6) {
      // yerinde dönerken küçük adımlar
      ampT = 0.35;
      rate = 1.1;
    }
    this._amp = THREE.MathUtils.damp(this._amp, ampT, 5, dt);
    this._phase += rate * dt;

    const A = GAIT_A * this._amp;
    const p = this._phase - Math.floor(this._phase);
    const half = p < 0.5 ? 0 : 1;
    const u = (p - half * 0.5) * 2;
    const stance = A * (1 - 2 * u);
    const swing = -A * Math.cos(Math.PI * u);
    const lift = 0.07 * this._amp * Math.sin(Math.PI * u);
    const outerA = half === 0 ? swing : stance;
    const innerA = half === 0 ? stance : swing;
    const outerLift = half === 0 ? lift : 0;
    const innerLift = half === 0 ? 0 : lift;

    // Adım sesi (her yarım döngüde bir blok yere değer)
    const stepIdx = Math.floor(this._phase * 2);
    if (stepIdx !== this._lastStepHalf) {
      this._lastStepHalf = stepIdx;
      if (this._amp > 0.4 && speed > 0.3) this.ctx.audio?.play?.('servo', { volume: 0.18, position: pos });
    }

    // Boşta salınım (yürürken söner)
    const idle = 1 - this._amp;
    const talk = this.speaking ? 1 : 0;
    body.position.y = LEG * Math.cos(stance) + (SLAB_D / 2) * Math.abs(Math.sin(stance)) + idle * 0.004 * Math.sin(t * 1.6);
    body.rotation.z = idle * 0.01 * Math.sin(t * 0.8);
    body.rotation.x = 0;

    for (let i = 0; i < 4; i++) {
      const outer = i === 0 || i === 3;
      let a = outer ? outerA : innerA;
      let y = outer ? outerLift : innerLift;
      a += idle * 0.012 * Math.sin(t * 1.1 + i * 1.7);
      if (!outer) a += talk * idle * 0.025 * Math.sin(t * 7 + i * 2.1);
      slabs[i].rotation.x = -a;
      slabs[i].position.y = y;
    }

    // Jestler
    if (this._pendingGesture && this._time >= this._pendingGesture.at) {
      if (!this.walking) this.gesture(this._pendingGesture.name);
      this._pendingGesture = null;
    }
    if (this._gesture) {
      const g = this._gesture;
      g.t += dt;
      const k = Math.min(1, g.t / g.dur);
      const env = Math.sin(Math.PI * k);
      if (g.name === 'wave') {
        const s = slabs[3];
        s.rotation.x += -(1.0 * env + 0.18 * env * Math.sin(g.t * 11));
        s.position.y += 0.06 * env;
      } else if (g.name === 'cheer') {
        const w = env * (0.35 + 0.12 * Math.sin(g.t * 9));
        slabs[0].rotation.x += -w;
        slabs[3].rotation.x += -w;
        slabs[0].position.y += 0.05 * env;
        slabs[3].position.y += 0.05 * env;
      }
      if (k >= 1) this._gesture = null;
    }

    // Ekran
    if (this._exprUntil && this._time > this._exprUntil) {
      this._exprUntil = 0;
      screen.set(this.speaking ? 'talk' : 'idle');
    }
    screen.update(dt);

    this._updateSpeech(dt);
    this._updateIdleChatter(dt);
  }

  _updateIdleChatter(dt) {
    if (!this._started || this.scripted || this.talking || !this.ctx.state.is('intro_done')) return;
    if (this.speaking || this._queue.length) return;
    this._idleT -= dt;
    if (this._idleT > 0) return;
    const band = LINES.humorBand(this.humor);
    this._idleT = (band === 'zero' ? 150 : 85) + Math.random() * 60;
    const P = this.ctx.player.position;
    const near = Math.hypot(P.x - this.group.position.x, P.z - this.group.position.z) < 9;
    if (!near || this.ctx.ui?.isModalOpen?.()) return;
    const line = LINES.pick(LINES.IDLE[band], this._lastIdle);
    this._lastIdle = line;
    this.say(line, { priority: 0, expires: 5 });
    if (band === 'high' || band === 'max') this.setExpression('wink', 2.5);
  }
}
