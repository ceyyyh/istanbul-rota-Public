import * as THREE from 'three';
import { buildShell } from '../structure/shell.js';
import { addBox, addCylinder, addMesh } from '../utils.js';
import {
  crewMaterials,
  vBox,
  vCyl,
  label,
  addScreen,
  addMonitor,
  drawNoPower,
  screenDriver,
  draw2d,
  addRail,
  addRod,
  addHose,
  addCableRun,
  addSwitchBank,
  addKnobRow,
  addGauge,
  addVent,
  addDesk,
  addChair,
  addRack,
  addPicture,
  addProxy,
  createBlinker,
  place,
  pictureMaterial,
  createTimers,
  openTerminal,
  sfx,
  wrap,
  rng,
} from './crew/kit.js';
import { EARTH_MESSAGES, CLOCK, fmtDur } from './crew/texts.js';
import { drawEarth } from './crew/pictures.js';

/**
 * İletişim Modülü — Dünya'dan gelen mesajlar.
 *
 * Etkileşimler:
 *   comms-console   Ana konsol (enerji gerekir; yoksa "ENERJİ YOK"): terminalde tarihli mesajlar sırayla
 *                   ("Mesaj 1 — 2 yıl 4 ay sonra" …). Altıncı mesaj gösterilince state 'messages_read'.
 *   comms-radio     Telsiz (bataryalı): parazit sesi + kısa altyazılar
 *   comms-antenna   Anten paneli (enerji gerekir): anteni Dünya yönüne hizalar
 *
 * Yerleşim: dış duvarda (z<0) sunucu rafları, ana konsol, anten paneli, telsiz masası; iç duvarda sinyal yolu
 * panosu, yedek parça rafı, yama paneli, saatler. Yürüme şeridi (|z| ≤ 0.9) boş.
 */
const PI = Math.PI;
const TOTAL = EARTH_MESSAGES.length;

const RADIO_LINES = [
  'Telsizde yalnızca parazit. Kar yağışına benzeyen düzgün bir hışırtı…',
  'Frekansı çevirdikçe parazitin içinde ritmik, çok uzaktan bir vızıltı beliriyor.',
  'Bir an için bir ses gibi bir şey duydum. Sonra yine hışırtı. Yıllar uzaktan geliyor olmalı.',
  'Eski yayınların sönük bir yankısı. Anlamıyorum — ama dinlemek iyi geliyor.',
];

export default {
  id: 'comms',
  name: 'İletişim',
  build(mctx) {
    const M = mctx.materials;
    const C = crewMaterials(mctx);
    const root = mctx.group;
    const timers = createTimers(mctx);

    buildShell(mctx, {
      outerWindows: [
        { x: -1.8, w: 2.6, y: 1.75, h: 0.75 },
        { x: 3.4, w: 1.6, y: 1.3, h: 0.95 },
      ],
      lights: 3,
      lightColor: 0xe8f0ff,
      lightIntensity: 6,
      accent: 0x5ab4ff,
    });
    // Konsol ekranlarının mavi yansıması (4. ışık) — yalnızca enerji varken yanar
    mctx.addLight([-1.8, 1.35, -2.4], { color: 0x6ab8ff, intensity: 1.8, distance: 5, emergency: null });

    const blinkG = createBlinker(0x3dff6a, { period: 1.3, duty: 0.5, phase: 0 });
    const blinkA = createBlinker(0xffa53a, { period: 0.9, duty: 0.35, phase: 0.4 });
    const blinkR = createBlinker(0xff3a2a, { period: 2.2, duty: 0.2, phase: 1.1 });

    // ------------------------------------------------------------------
    // Dış duvar: sunucu rafları
    // ------------------------------------------------------------------
    [
      [-5.0, 'KAYIT-A'],
      [-4.4, 'KAYIT-B'],
      [-3.8, 'RÖLE'],
    ].forEach(([x, t], i) => {
      const rk = addRack(root, { pos: [x, 0, -3.2], w: 0.58, h: 2.05, d: 0.55, M, seed: 11 + i, units: 9, text: t });
      rk.userData.collide = true;
      // yanıp sönen ledler
      for (let k = 0; k < 4; k++) {
        const bm = [blinkG, blinkA, blinkG, blinkR][k];
        addBox(rk, { size: [0.014, 0.014, 0.008], pos: [-0.2 + k * 0.04, 1.93 - (i % 2) * 0.02, 0.255], material: bm.material });
      }
    });
    label(root, 'KAYIT & RÖLE', { pos: [-4.4, 2.42, -3.49], height: 0.1, color: '#2a3a46' });
    addCableRun(root, [-5.0, 2.1, -3.0], [-3.8, 2.9, -2.9], { n: 3, sag: 0.1, radius: 0.014, material: M.cable, seed: 5 });

    // ------------------------------------------------------------------
    // Ana konsol (dış duvar)
    // ------------------------------------------------------------------
    const desk = addDesk(root, { pos: [-1.8, 0, -3.12], w: 2.8, d: 0.72, M, drawers: false });
    desk.userData.collide = true;
    const monMain = addMonitor(root, { pos: [-1.8, 0.76, -3.22], w: 0.64, h: 0.42, res: [480, 316], color: '#8ef5ff', tilt: -0.12 });
    const monL = addMonitor(root, { pos: [-2.7, 0.76, -3.15], w: 0.4, h: 0.28, res: [320, 224], color: '#7dff9a' });
    const monR = addMonitor(root, { pos: [-0.9, 0.76, -3.15], w: 0.4, h: 0.28, res: [320, 224], color: '#ffb347' });
    monL.group.rotation.y = 0.38;
    monR.group.rotation.y = -0.38;
    // klavye + kulaklık + mikrofon
    vBox(root, { size: [0.46, 0.018, 0.17], color: 0x2a2c30, pos: [-1.8, 0.769, -2.9] });
    for (let i = 0; i < 4; i++) vBox(root, { size: [0.42, 0.006, 0.02], color: 0x6a6c70, pos: [-1.8, 0.781, -2.95 + i * 0.035] });
    addMesh(root, new THREE.TorusGeometry(0.075, 0.009, 6, 16, PI), M.plasticDark, { pos: [-0.95, 0.9, -2.82], rot: [0, 0.4, 0] });
    for (const sx of [-1, 1]) vBox(root, { size: [0.03, 0.06, 0.05], color: 0x2a2c30, pos: [-0.95 + sx * 0.07, 0.82, -2.82 + sx * 0.03] });
    addRod(root, [-2.2, 0.77, -2.85], [-2.2, 0.98, -2.9], { radius: 0.006, material: M.metal, segments: 5 });
    vCyl(root, { radius: 0.02, height: 0.05, segments: 8, color: 0x2a2c30, pos: [-2.2, 1.0, -2.93], rot: [0.5, 0, 0] });
    addChair(root, { pos: [-1.8, 0, -2.25], rotY: PI, M, color: 0x2f3b4c });
    label(root, 'DÜNYA HATTI · ANA KONSOL', { pos: [-1.8, 1.47, -3.49], height: 0.05, color: '#d8e8ec' });
    // konsol üstü ışıklı çubuk + etiket şeridi
    addBox(root, { size: [2.8, 0.03, 0.05], pos: [-1.8, 1.62, -3.47], material: C.consoleEdge });

    // ------------------------------------------------------------------
    // Anten paneli (dış duvar, x≈1)
    // ------------------------------------------------------------------
    const ant = buildAntennaPanel(mctx, M, C, root, 0.95);

    // ------------------------------------------------------------------
    // Telsiz masası (dış duvar, sağ)
    // ------------------------------------------------------------------
    const rdesk = addDesk(root, { pos: [3.4, 0, -3.1], w: 1.8, d: 0.7, M });
    rdesk.userData.collide = true;
    const radio = buildRadio(mctx, M, C, timers, root, [3.0, 0.76, -3.1]);
    // kulaklık ve mikrofon
    addMesh(root, new THREE.TorusGeometry(0.075, 0.009, 6, 16, PI), M.plasticDark, { pos: [3.8, 0.9, -2.88], rot: [0, -0.3, 0] });
    for (const sx of [-1, 1]) vBox(root, { size: [0.03, 0.06, 0.05], color: 0x2a2c30, pos: [3.8 + sx * 0.07, 0.82, -2.88] });
    addRod(root, [4.25, 0.77, -3.0], [4.25, 1.0, -3.05], { radius: 0.007, material: M.metal, segments: 5 });
    vCyl(root, { radius: 0.025, height: 0.05, segments: 8, color: 0x2a2c30, pos: [4.25, 1.02, -3.07], rot: [0.5, 0, 0] });
    vBox(root, { size: [0.22, 0.012, 0.16], color: 0xe8e2cf, matte: true, pos: [3.5, 0.766, -2.88], rot: [0, 0.3, 0] });
    addChair(root, { pos: [3.4, 0, -2.3], rotY: PI, M, color: 0x4a5a3a });
    label(root, 'TELSİZ ODASI · KISA DALGA', { pos: [3.4, 1.0, -3.49], height: 0.04, color: '#1a1a1a', bg: '#e8e2cf' });
    addPicture(root, { key: 'earth', draw: drawEarth, pos: [4.8, 1.8, -3.49], w: 0.22, h: 0.22, res: [192, 192], tilt: -0.04 });

    // ------------------------------------------------------------------
    // İç duvar: sinyal yolu panosu, yedek parça rafı, yama paneli, saatler, rafı
    // ------------------------------------------------------------------
    const wall = addScreen(root, { pos: [-3.85, 1.65, 3.46], rot: [0, PI, 0], w: 2.2, h: 1.1, res: [640, 320], color: '#8ef5ff', depth: 0.05 });
    label(root, 'SİNYAL YOLU', { pos: [-3.85, 2.4, 3.49], rot: [0, PI, 0], height: 0.1, color: '#2a3a46' });
    const bench = place(root, [-3.85, 0, 3.2], PI);
    addBox(bench, { size: [2.4, 0.78, 0.5], pos: [0, 0.39, 0], material: M.panelMid });
    addBox(bench, { size: [2.44, 0.04, 0.54], pos: [0, 0.8, 0.0], material: M.aluminium });
    for (let i = 0; i < 4; i++) {
      addBox(bench, { size: [0.54, 0.68, 0.016], pos: [-0.9 + i * 0.6, 0.38, 0.258], material: M.panelLight });
      addBox(bench, { size: [0.14, 0.014, 0.02], pos: [-0.9 + i * 0.6, 0.65, 0.272], material: M.metalDark });
    }
    bench.userData.collide = true;
    // tezgâh üstü: kablo makarası, ölçü aleti, lehim istasyonu
    vCyl(bench, { radius: 0.12, height: 0.06, segments: 14, color: 0x2a2c30, pos: [-0.8, 0.86, 0.0] });
    vCyl(bench, { radius: 0.07, height: 0.1, segments: 12, color: 0xc9772f, pos: [-0.8, 0.9, 0.0] });
    vBox(bench, { size: [0.3, 0.1, 0.2], color: 0x3a4a3a, pos: [-0.1, 0.87, 0.0] });
    addBox(bench, { size: [0.14, 0.05, 0.008], pos: [-0.1, 0.9, 0.102], material: C.indAmber });
    vBox(bench, { size: [0.2, 0.03, 0.14], color: 0xd8a21a, pos: [0.5, 0.835, 0.02], rot: [0, 0.3, 0] });
    vBox(bench, { size: [0.3, 0.02, 0.08], color: 0xb9bcc0, pos: [0.9, 0.82, 0.05], rot: [0, -0.2, 0] });

    // yedek parça rafı
    const shelf = place(root, [-1.55, 0, 3.22], PI);
    addBox(shelf, { size: [1.5, 2.0, 0.5], pos: [0, 1.0, 0], material: M.panelDark });
    addBox(shelf, { size: [1.44, 1.9, 0.02], pos: [0, 1.0, 0.255], material: C.console });
    const r = rng(77);
    for (let k = 0; k < 5; k++) {
      const y = 0.3 + k * 0.4;
      addBox(shelf, { size: [1.44, 0.03, 0.46], pos: [0, y, 0.0], material: M.metalDark });
      for (let j = 0; j < 5; j++) {
        const c = [0x8a7a5a, 0x5a6a7a, 0x4a5a3a, 0x9a8a6a, 0x3a4a5a][Math.floor(r() * 5)];
        const w = 0.18 + r() * 0.1;
        vBox(shelf, { size: [w, 0.14 + r() * 0.1, 0.3], color: c, matte: true, pos: [-0.55 + j * 0.27, y + 0.1, 0.1] });
      }
    }
    label(shelf, 'YEDEK PARÇA · İLETİŞİM', { pos: [0, 2.08, 0.257], height: 0.04, color: '#e8e2d0' });
    shelf.userData.collide = true;

    // yama paneli
    const patch = place(root, [0.15, 1.5, 3.47], PI);
    addBox(patch, { size: [1.0, 0.9, 0.05], pos: [0, 0, 0], material: M.panelDark });
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 10; col++) {
        const px = -0.42 + col * 0.093;
        const py = 0.34 - row * 0.12;
        vCyl(patch, { radius: 0.013, height: 0.012, segments: 8, color: 0x0b0c0e, pos: [px, py, 0.03], rot: [PI / 2, 0, 0] });
        if ((row * 7 + col * 3) % 5 === 0) addBox(patch, { size: [0.01, 0.01, 0.006], pos: [px + 0.03, py + 0.03, 0.03], material: (row + col) % 2 ? C.indGreen : C.indAmber });
      }
    }
    for (let i = 0; i < 6; i++) addHose(patch, [[-0.4 + i * 0.16, 0.34 - (i % 3) * 0.12, 0.04], [-0.4 + i * 0.16 + 0.08, 0.1 - (i % 3) * 0.05, 0.16], [-0.3 + i * 0.12, -0.45, 0.04]], { radius: 0.007, material: i % 2 ? M.cable : M.accentOrange, segments: 12, radial: 5 });
    label(patch, 'YAMA PANELİ · 04', { pos: [0, 0.52, 0.03], height: 0.04, color: '#e8e2d0' });

    // saatler (Dünya / Gemi)
    const clockE = addScreen(root, { pos: [1.55, 1.9, 3.46], rot: [0, PI, 0], w: 0.62, h: 0.26, res: [320, 136], color: '#8ef5ff', depth: 0.04 });
    const clockS = addScreen(root, { pos: [2.4, 1.9, 3.46], rot: [0, PI, 0], w: 0.62, h: 0.26, res: [320, 136], color: '#7dff9a', depth: 0.04 });
    label(root, 'DÜNYA', { pos: [1.55, 2.12, 3.49], rot: [0, PI, 0], height: 0.045, color: '#e8e2d0' });
    label(root, 'GEMİ', { pos: [2.4, 2.12, 3.49], rot: [0, PI, 0], height: 0.045, color: '#e8e2d0' });
    label(root, 'ZAMAN GENİŞLEMESİ: SAATLER SENKRON DEĞİL', { pos: [2.0, 1.62, 3.49], rot: [0, PI, 0], height: 0.04, color: '#1a1a1a', bg: '#d8a21a' });

    // sağ uç: iki ekipman rafı + dolap
    [
      [4.2, 'ANTEN-1'],
      [4.85, 'ANTEN-2'],
    ].forEach(([x, t], i) => {
      const rk = addRack(root, { pos: [x, 0, 3.2], rotY: PI, w: 0.58, h: 2.05, d: 0.55, M, seed: 31 + i, units: 9, text: t });
      rk.userData.collide = true;
      for (let k = 0; k < 4; k++) addBox(rk, { size: [0.014, 0.014, 0.008], pos: [-0.2 + k * 0.04, 1.93, 0.255], material: [blinkA, blinkG, blinkR, blinkG][k].material });
    });
    label(root, 'ANTEN SÜRÜCÜLERİ', { pos: [4.5, 2.45, 3.49], rot: [0, PI, 0], height: 0.08, color: '#2a3a46' });

    // dalga kılavuzları (altın borular): anten panelinden tavana
    addRod(root, [0.55, 2.2, -3.38], [0.55, 3.15, -3.38], { radius: 0.045, material: M.hullGold, segments: 10 });
    addRod(root, [0.7, 2.2, -3.38], [0.7, 3.15, -3.38], { radius: 0.03, material: M.hullGold, segments: 10 });
    addRod(root, [0.55, 3.0, -3.38], [-0.9, 3.05, -2.0], { radius: 0.035, material: M.hullGold, segments: 10 });
    addRod(root, [-0.9, 3.05, -2.0], [-0.9, 3.12, 3.0], { radius: 0.035, material: M.hullGold, segments: 10 });
    for (const sz of [-1, 1]) addRod(root, [-5.4, 3.0, sz * 3.2], [5.4, 3.0, sz * 3.2], { radius: 0.035, material: M.aluminium, segments: 8 });
    addCableRun(root, [-5.3, 3.12, 1.0], [5.3, 3.12, 1.0], { n: 4, sag: 0.08, radius: 0.012, material: M.cable, seed: 19 });
    addVent(root, { pos: [-0.2, 2.9, -3.49], w: 0.6, h: 0.2, frameMaterial: M.metalDark, slatMaterial: M.panelDark });
    label(root, 'İLETİŞİM MODÜLÜ', { pos: [1.4, 2.7, 3.49], rot: [0, PI, 0], height: 0.12, color: '#2a3a46' });

    // ------------------------------------------------------------------
    // Ana konsol etkileşimi: Dünya'dan gelen mesajlar
    // ------------------------------------------------------------------
    const inbox = { idx: 0, opened: false, term: null };
    const consoleProxy = addProxy(root, { size: [3.0, 1.6, 1.0], pos: [-1.8, 0.95, -2.95] });

    const msgLines = (i) => {
      const m = EARTH_MESSAGES[i];
      return [`MESAJ ${i + 1}/${TOTAL} — ${m.when}`, `GÖNDEREN: ${m.from}`, '────────────────────────────────────────────', '', ...wrap(m.text, 58), ''];
    };
    const headerLines = () => [
      'DÜNYA — GELEN KUTUSU',
      '────────────────────────────────────────────',
      `${TOTAL} kayıtlı mesaj bekliyor.`,
      'Zaman genişlemesi yüzünden tarihler, yola çıkışından',
      'itibaren Dünya saatiyle "sonra" olarak verilir.',
      '',
      inbox.idx === 0 ? 'Hiçbiri açılmadı.' : inbox.idx >= TOTAL ? 'Tüm mesajlar okundu.' : `${inbox.idx}/${TOTAL} mesaj okundu.`,
    ];

    const openInbox = () => {
      sfx(mctx, 'terminal');
      const allRead = mctx.state.is('messages_read') && inbox.idx >= TOTAL;
      if (allRead) inbox.idx = 0; // yeniden dinleme
      let shown = false;
      const opts = () =>
        inbox.idx >= TOTAL
          ? [{ label: 'Kapat', action: () => {} }]
          : [
        {
          label: shown ? `Sonraki mesaj (${inbox.idx + 1}/${TOTAL}) ▶` : inbox.idx === 0 ? 'İlk mesajı oynat ▶' : `Mesajı oynat (${inbox.idx + 1}/${TOTAL}) ▶`,
          action: () => {
            if (inbox.idx >= TOTAL) return undefined;
            const i = inbox.idx++;
            shown = true;
            sfx(mctx, 'beep');
            const lines = msgLines(i);
            if (inbox.idx >= TOTAL) {
              lines.push('══ KAYIT SONU — kutuda başka mesaj yok ══');
              mctx.state.set('messages_read', true);
            }
            inbox.term?.setLines?.(lines);
            inbox.term?.setOptions?.(opts());
            return false;
          },
        },
        { label: 'Kapat', action: () => {} },
      ];
      const term = openTerminal(mctx, {
        title: 'DÜNYA HATTI — MESAJLAR',
        color: 'blue',
        lines: headerLines(),
        options: opts(),
        onClose: () => {
          inbox.term = null;
          if (inbox.idx >= TOTAL) {
            mctx.ui?.subtitle?.('SEN', 'Emre baba olmuş. Deniz benim yaşıma gelmiş. Benim içinse yalnızca iki yıl geçti…', 6400);
          } else if (inbox.idx > 0) {
            mctx.ui?.subtitle?.('SEN', 'Daha dinleyecek mesajlar var. Yarım bırakmak istemiyorum.', 4200);
          }
        },
      });
      inbox.term = term;
      inbox.opened = true;
      if (!term) {
        // arayüz yoksa tüm mesajları okunmuş say
        inbox.idx = TOTAL;
        mctx.state.set('messages_read', true);
      }
    };

    mctx.interactions.add(consoleProxy, {
      id: 'comms-console',
      prompt: () => (mctx.state.is('power_restored') ? (mctx.state.is('messages_read') ? "Dünya'dan gelen mesajlar (arşiv)" : "Dünya'dan gelen mesajları dinle") : "Dünya'dan gelen mesajlar"),
      distance: 3.4,
      onInteract: () => {
        if (!mctx.state.is('power_restored')) {
          sfx(mctx, 'error');
          mctx.ui?.toast?.('ENERJİ YOK — iletişim konsolu çalışmıyor.', 3000);
          return;
        }
        openInbox();
      },
    });

    // ------------------------------------------------------------------
    // Ekranlar + yanıp sönen ledler (oyuncu yakınken)
    // ------------------------------------------------------------------
    const spec = new Array(24).fill(0.3);
    screenDriver(mctx, {
      hz: 6,
      draw: (t, powered) => {
        const all = [monMain.screen, monL.screen, monR.screen, wall, clockE, clockS, ant.screens.a, ant.screens.b];
        if (!powered) {
          for (const s of all) drawNoPower(s, 'ENERJİ YOK');
          return;
        }
        for (const s of all) s.material.emissiveIntensity = 1.15;
        drawMain(monMain.screen, t, inbox, mctx.state.is('messages_read'));
        drawSpectrum(monL.screen, t, spec, ant.state.aligned);
        drawDelay(monR.screen, t, ant.state.aligned);
        drawSignalPath(wall, t, ant.state.aligned);
        drawClock(clockE, t, 'earth');
        drawClock(clockS, t, 'ship');
        drawAntenna(ant.screens.a, ant.screens.b, t, ant.state);
      },
    });
    mctx.onUpdate((dt, t) => {
      if (!mctx.playerInside()) return;
      const p = mctx.state.is('power_restored');
      blinkG.update(t, p);
      blinkA.update(t, p);
      blinkR.update(t, p);
    });

    root.userData.comms = { inbox, antenna: ant, radio };
  },
};

// ---------------------------------------------------------------------------
// Anten paneli
// ---------------------------------------------------------------------------
function buildAntennaPanel(mctx, M, C, root, cx) {
  const g = place(root, [cx, 1.5, -3.46], 0, 'antenna-panel');
  addBox(g, { size: [1.5, 1.35, 0.05], pos: [0, 0, 0.0], material: C.console });
  addBox(g, { size: [1.56, 0.04, 0.07], pos: [0, 0.69, 0.0], material: C.consoleEdge });
  addBox(g, { size: [1.56, 0.04, 0.07], pos: [0, -0.69, 0.0], material: C.consoleEdge });
  const a = addScreen(g, { pos: [-0.38, 0.32, 0.028], w: 0.54, h: 0.36, res: [384, 256], color: '#8ef5ff', depth: 0.04 });
  const b = addScreen(g, { pos: [0.38, 0.32, 0.028], w: 0.54, h: 0.36, res: [384, 256], color: '#ffb347', depth: 0.04 });
  addSwitchBank(g, { pos: [-0.38, -0.05, 0.026], cols: 7, rows: 2, guarded: [0, 6], seed: 51 });
  addSwitchBank(g, { pos: [0.38, -0.05, 0.026], cols: 7, rows: 2, guarded: [13], seed: 52 });
  addGauge(g, { pos: [-0.55, -0.35, 0.026], radius: 0.05, needle: -0.4 });
  addGauge(g, { pos: [-0.38, -0.35, 0.026], radius: 0.05, needle: 0.5 });
  addGauge(g, { pos: [-0.21, -0.35, 0.026], radius: 0.05, needle: 1.2 });
  addKnobRow(g, { pos: [0.3, -0.37, 0.026], n: 4, spacing: 0.11, seed: 53 });
  // büyük HİZALA düğmesi (kırmızı, kapaklı)
  const btn = place(g, [0.64, -0.35, 0.026]);
  vCyl(btn, { radius: 0.045, height: 0.02, segments: 14, color: 0x2a2c30, pos: [0, 0, 0.0], rot: [PI / 2, 0, 0] });
  const cap = vCyl(btn, { radius: 0.032, height: 0.03, segments: 14, color: 0xb02a1c, pos: [0, 0, 0.02], rot: [PI / 2, 0, 0] });
  void cap;
  const lockLed = new THREE.MeshStandardMaterial({ color: 0x041004, roughness: 0.4, emissive: 0x3dff6a, emissiveIntensity: 0 });
  lockLed.name = 'commsLockLed';
  addBox(g, { size: [0.05, 0.025, 0.008], pos: [0.64, -0.2, 0.03], material: lockLed });
  label(g, 'KİLİT', { pos: [0.64, -0.14, 0.03], height: 0.026, color: '#e8e2d0' });
  label(g, 'HİZALA', { pos: [0.64, -0.46, 0.03], height: 0.03, color: '#e8e2d0' });
  label(g, 'ANTEN HİZALAMA · AZ / EL', { pos: [0, 0.6, 0.03], height: 0.045, color: '#e8e2d0' });
  label(g, 'SİNYAL GÜCÜ', { pos: [0.38, 0.54, 0.03], height: 0.03, color: '#e8e2d0' });
  label(g, 'YÖNELİM', { pos: [-0.38, 0.54, 0.03], height: 0.03, color: '#e8e2d0' });

  const st = { aligned: false, t: 0, moving: false, az: 41.2, el: 12.8 };
  const proxy = addProxy(g, { size: [1.7, 1.5, 0.5], pos: [0, 0, 0.25] });
  proxy.userData.dynamic = false;
  const TARGET = { az: 184.6, el: 27.3 };
  mctx.onUpdate((dt) => {
    if (!st.moving) return;
    st.t += dt;
    const k = Math.min(1, st.t / 3.6);
    const e = k * k * (3 - 2 * k);
    st.az = THREE.MathUtils.lerp(41.2, TARGET.az, e);
    st.el = THREE.MathUtils.lerp(12.8, TARGET.el, e);
    if (k >= 1) {
      st.moving = false;
      st.aligned = true;
      lockLed.emissiveIntensity = 2;
      sfx(mctx, 'success');
      mctx.ui?.toast?.('Anten Dünya yönüne kilitlendi — sinyal gücü %92.', 3600);
    }
  });
  mctx.interactions.add(g, {
    id: 'comms-antenna',
    prompt: () => (st.aligned ? 'Anten paneli (kilitli)' : st.moving ? '' : 'Anteni Dünya yönüne hizala'),
    distance: 3.0,
    enabled: () => !st.moving,
    onInteract: () => {
      if (!mctx.state.is('power_restored')) {
        sfx(mctx, 'error');
        mctx.ui?.toast?.('ENERJİ YOK — anten sürücüleri çalışmıyor.', 2800);
        return;
      }
      if (st.aligned) {
        sfx(mctx, 'beep');
        mctx.ui?.toast?.(`Anten kilitli: AZ ${st.az.toFixed(1)}°  EL ${st.el.toFixed(1)}°`, 2600);
        return;
      }
      st.moving = true;
      st.t = 0;
      sfx(mctx, 'servo', { duration: 3.6 });
      mctx.ui?.subtitle?.('SEN', 'Anten motorları çalışıyor. Çanak Dünya\'nın yönüne dönüyor…', 3600);
    },
  });
  return { group: g, state: st, screens: { a, b } };
}

// ---------------------------------------------------------------------------
// Telsiz
// ---------------------------------------------------------------------------
function drawDial(g, w, h) {
  g.fillStyle = '#1b1a12';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#e8d8a0';
  g.fillStyle = '#e8d8a0';
  g.lineWidth = 1;
  g.font = 'bold 16px "DejaVu Sans", sans-serif';
  g.textAlign = 'center';
  for (let i = 0; i <= 40; i++) {
    const x = 20 + (i / 40) * (w - 40);
    g.beginPath();
    g.moveTo(x, h * 0.45);
    g.lineTo(x, h * (i % 5 === 0 ? 0.7 : 0.6));
    g.stroke();
    if (i % 10 === 0) g.fillText(String(3 + (i / 10) * 3), x, h * 0.9);
  }
  g.font = '12px "DejaVu Sans", sans-serif';
  g.fillText('MHz · KISA DALGA', w / 2, h * 0.3);
  g.textAlign = 'left';
}

function buildRadio(mctx, M, C, timers, root, pos) {
  const g = place(root, pos, 0.1, 'radio');
  vBox(g, { size: [0.52, 0.26, 0.26], color: 0x4a5a3a, pos: [0, 0.13, 0] });
  vBox(g, { size: [0.5, 0.24, 0.012], color: 0x2a2c26, pos: [0, 0.13, 0.131] });
  vBox(g, { size: [0.52, 0.02, 0.28], color: 0x3a4630, pos: [0, 0.265, 0] });
  // kadran penceresi (güç/pil durumuna göre yanar)
  const dialMat = new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.9, emissiveMap: null });
  const dial = createDialTexture();
  dialMat.map = dial.texture;
  dialMat.emissiveMap = dial.texture;
  dialMat.name = 'commsRadioDial';
  addMesh(g, new THREE.PlaneGeometry(0.24, 0.1), dialMat, { pos: [-0.08, 0.17, 0.1385] });
  // kadran ibresi + düğmeler
  const needle = new THREE.Group();
  needle.position.set(-0.08, 0.17, 0.141);
  g.add(needle);
  vBox(needle, { size: [0.003, 0.1, 0.002], color: 0xd23a22, pos: [0, 0, 0] });
  const knobs = [];
  for (const [kx, ky] of [
    [0.19, 0.19],
    [0.19, 0.08],
    [-0.08, 0.06],
  ]) {
    const k = place(g, [kx, ky, 0.14]);
    vCyl(k, { radius: 0.03, height: 0.03, segments: 14, color: 0x1a1a18, pos: [0, 0, 0.012], rot: [PI / 2, 0, 0] });
    vBox(k, { size: [0.004, 0.02, 0.004], color: 0xe8e2d0, pos: [0, 0.015, 0.03] });
    knobs.push(k);
  }
  // hoparlör ızgarası
  for (let i = 0; i < 5; i++) vBox(g, { size: [0.11, 0.008, 0.004], color: 0x0a0a0a, pos: [0.06, 0.035 + i * 0.02, 0.1385] });
  addBox(g, { size: [0.03, 0.02, 0.01], pos: [0.0, 0.245, 0.135], material: C.indAmber });
  // VU göstergesi
  addGauge(g, { pos: [-0.2, 0.06, 0.137], radius: 0.028, needle: 0.2 });
  // anten
  addRod(g, [0.22, 0.27, -0.05], [0.22, 0.58, -0.05], { radius: 0.006, material: M.aluminium, segments: 6 });
  addRod(g, [0.22, 0.58, -0.05], [0.24, 0.86, -0.05], { radius: 0.0035, material: M.aluminium, segments: 5 });
  vCyl(g, { radius: 0.01, height: 0.012, segments: 8, color: 0x2a2c26, pos: [0.24, 0.866, -0.05] });
  // el mikrofonu
  vBox(g, { size: [0.05, 0.14, 0.04], color: 0x1a1a18, pos: [-0.36, 0.07, 0.05], rot: [0, 0, 0.1] });
  vBox(g, { size: [0.07, 0.05, 0.05], color: 0x1a1a18, pos: [-0.36, 0.16, 0.05] });
  addHose(g, [[-0.34, 0.03, 0.04], [-0.3, 0.02, 0.16], [-0.26, 0.05, 0.14]], { radius: 0.008, material: M.cable, segments: 10, radial: 5 });
  label(g, 'TELSİZ · SW-4', { pos: [0.0, 0.245, 0.14], height: 0.022, color: '#e8e2d0' });
  const proxy = addProxy(g, { size: [0.7, 0.55, 0.45], pos: [0, 0.27, 0.05] });
  proxy.userData.dynamic = false;

  const st = { on: false, t: 0, freq: 0.2, target: 0.2, line: 0 };
  mctx.onUpdate((dt) => {
    if (!st.on && Math.abs(st.freq - st.target) < 0.0005) return;
    st.t += dt;
    st.freq = THREE.MathUtils.damp(st.freq, st.target, 2.4, dt);
    if (st.on) st.freq += Math.sin(st.t * 7) * 0.0012;
    needle.position.x = -0.08 - 0.115 + st.freq * 0.23;
    knobs[0].rotation.z = -st.freq * 6.0;
    if (st.on && st.t > 3.2) {
      st.on = false;
      st.t = 0;
    }
  });
  mctx.interactions.add(g, {
    id: 'comms-radio',
    prompt: () => (st.on ? 'Telsiz — frekansı çeviriyorsun…' : 'Telsizi dinle'),
    distance: 2.8,
    onInteract: () => {
      st.on = true;
      st.t = 0;
      st.target = 0.12 + ((st.line * 0.27 + 0.18) % 0.78);
      const pos = g.getWorldPosition(new THREE.Vector3());
      sfx(mctx, 'click', { position: pos });
      sfx(mctx, 'hiss', { position: pos, volume: 0.9, duration: 3.0 });
      sfx(mctx, 'hiss', { volume: 0.25, duration: 3.2 });
      mctx.ui?.subtitle?.('SEN', RADIO_LINES[st.line % RADIO_LINES.length], 5000);
      st.line++;
    },
  });
  void timers;
  return { group: g, state: st, dialTex: dial };
}

function createDialTexture() {
  const hasDom = typeof document !== 'undefined';
  if (!hasDom) return { texture: null, canvas: null };
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 132;
  const g = c.getContext('2d');
  drawDial(g, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { texture: tex, canvas: c };
}

// ---------------------------------------------------------------------------
// Ekran çizimleri
// ---------------------------------------------------------------------------
function drawMain(scr, t, inbox, read) {
  const c = '#8ef5ff';
  scr.draw((g, w, h) => {
    const hh = draw2d.header(g, w, h, 'DÜNYA HATTI', c, read ? 'ARŞİV' : 'BEKLEYEN');
    // Dünya simgesi
    const cx = 70;
    const cy = hh + 90;
    const og = g.createRadialGradient(cx - 14, cy - 14, 4, cx, cy, 46);
    og.addColorStop(0, '#6fb4f0');
    og.addColorStop(1, '#0b2b55');
    g.fillStyle = og;
    g.beginPath();
    g.arc(cx, cy, 44, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = c;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(cx, cy, 52 + (Math.sin(t * 2) + 1) * 3, 0, Math.PI * 2);
    g.stroke();
    const x = 150;
    if (!read) {
      draw2d.text(g, `${TOTAL} YENİ MESAJ`, x, hh + 18, 26, c);
      draw2d.text(g, 'Aile hattı · şifresiz', x, hh + 54, 16, c);
      draw2d.text(g, 'Dinlemek için konsola bak.', x, hh + 76, 16, c);
      if (Math.floor(t * 1.6) % 2 === 0) draw2d.text(g, '▶ [E] AÇ', x, hh + 120, 20, c);
    } else {
      draw2d.text(g, 'TÜM MESAJLAR OKUNDU', x, hh + 18, 22, c);
      draw2d.text(g, `SON: ${EARTH_MESSAGES[TOTAL - 1].when}`, x, hh + 56, 16, c);
      draw2d.text(g, 'Yanıt gönderilemiyor:', x, hh + 84, 16, c);
      draw2d.text(g, 'hat tek yönlü.', x, hh + 104, 16, c);
    }
    // alt şerit: ilerleme
    draw2d.bar(g, 10, h - 40, w - 20, 12, read ? 1 : inbox.idx / TOTAL, c);
    draw2d.text(g, `${inbox.idx}/${TOTAL}`, w - 12, h - 24, 14, c, 'right');
  });
}

function drawSpectrum(scr, t, spec, aligned) {
  const c = '#7dff9a';
  for (let i = 0; i < spec.length; i++) {
    const noise = aligned ? 0.12 : 0.45;
    const peak = Math.exp(-Math.pow((i - 12) / 2.2, 2)) * (aligned ? 0.9 : 0.3);
    const tgt = noise * (0.4 + 0.6 * Math.abs(Math.sin(t * 3 + i * 1.7))) + peak;
    spec[i] += (tgt - spec[i]) * 0.5;
  }
  scr.draw((g, w, h) => {
    const hh = draw2d.header(g, w, h, 'SPEKTRUM', c, aligned ? 'KİLİTLİ' : 'ARANIYOR');
    const bw = (w - 16) / spec.length;
    for (let i = 0; i < spec.length; i++) {
      const bh = spec[i] * (h - hh - 24);
      g.fillStyle = c;
      g.fillRect(8 + i * bw + 1, h - 12 - bh, bw - 2, bh);
    }
    draw2d.text(g, '7.2 MHz', 8, h - 12 + 0, 11, c);
  });
}

function drawDelay(scr, t, aligned) {
  const c = '#ffb347';
  scr.draw((g, w, h) => {
    const hh = draw2d.header(g, w, h, 'GECİKME', c);
    draw2d.text(g, 'SİNYAL YOLU', 10, hh + 6, 14, c);
    draw2d.text(g, '6 sa 14 dk', 10, hh + 26, 24, c);
    draw2d.text(g, 'GÜÇ', 10, hh + 62, 14, c);
    draw2d.bar(g, 10, hh + 80, w - 20, 12, aligned ? 0.92 : 0.34, c);
    draw2d.text(g, `PAKET KAYBI %${aligned ? 3 : 41}`, 10, hh + 100, 14, c);
    if (Math.floor(t * 2) % 2 === 0) draw2d.text(g, '●', w - 16, hh + 6, 14, c);
  });
}

function drawSignalPath(scr, t, aligned) {
  const c = '#8ef5ff';
  scr.draw((g, w, h) => {
    const hh = draw2d.header(g, w, h, 'DÜNYA ↔ AZİM · SİNYAL YOLU', c, aligned ? 'ANTEN KİLİTLİ' : 'ANTEN SERBEST');
    const y = hh + (h - hh) * 0.42;
    // Dünya
    const eg = g.createRadialGradient(60, y - 8, 4, 70, y, 34);
    eg.addColorStop(0, '#6fb4f0');
    eg.addColorStop(1, '#0b2b55');
    g.fillStyle = eg;
    g.beginPath();
    g.arc(70, y, 32, 0, Math.PI * 2);
    g.fill();
    draw2d.text(g, 'DÜNYA', 70, y + 40, 14, c, 'center');
    // röle (Satürn geçidi)
    g.strokeStyle = c;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(w * 0.5, y, 18, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.ellipse(w * 0.5, y, 30, 8, -0.3, 0, Math.PI * 2);
    g.stroke();
    draw2d.text(g, 'RÖLE (SATÜRN)', w * 0.5, y + 40, 14, c, 'center');
    // AZİM
    g.strokeRect(w - 100, y - 14, 60, 28);
    draw2d.text(g, 'AZİM', w - 70, y + 40, 14, c, 'center');
    // yol + paketler
    g.setLineDash([6, 6]);
    g.beginPath();
    g.moveTo(104, y);
    g.lineTo(w * 0.5 - 20, y);
    g.moveTo(w * 0.5 + 34, y);
    g.lineTo(w - 104, y);
    g.stroke();
    g.setLineDash([]);
    for (let i = 0; i < 6; i++) {
      const p = ((t * 0.25 + i / 6) % 1);
      const lost = !aligned && i % 3 === 0;
      const px = 104 + p * (w - 208);
      g.fillStyle = lost ? '#ff6a4a' : c;
      g.fillRect(px - 4, y - 4, 8, 8);
    }
    // istatistikler
    const sy = hh + (h - hh) * 0.72;
    draw2d.text(g, 'SİNYAL GÜCÜ', 16, sy, 14, c);
    draw2d.bar(g, 16, sy + 20, 200, 12, aligned ? 0.92 : 0.34, c);
    draw2d.text(g, 'HAT YÖNÜ', 250, sy, 14, c);
    draw2d.text(g, 'TEK YÖNLÜ (DÜNYA → GEMİ)', 250, sy + 20, 14, c);
    draw2d.text(g, 'GECİKME: 6 sa 14 dk', 16, sy + 44, 14, c);
  });
}

function drawClock(scr, t, which) {
  const c = which === 'earth' ? '#8ef5ff' : '#7dff9a';
  scr.draw((g, w, h) => {
    const v = which === 'earth' ? CLOCK.earth0 + t * CLOCK.gamma : CLOCK.ship0 + t;
    draw2d.text(g, which === 'earth' ? 'DÜNYA SAATİ' : 'GEMİ SAATİ', 8, 8, 16, c);
    draw2d.text(g, fmtDur(v), 8, 36, 28, c);
    draw2d.text(g, which === 'earth' ? 'T + yola çıkıştan' : 'T + uyanıştan', 8, 78, 14, c);
  });
}

function drawAntenna(a, b, t, st) {
  const c = '#8ef5ff';
  a.draw((g, w, h) => {
    const hh = draw2d.header(g, w, h, 'YÖNELİM', c, st.aligned ? 'KİLİTLİ' : st.moving ? 'DÖNÜYOR' : 'SERBEST');
    draw2d.text(g, `AZ  ${st.az.toFixed(1)}°`, 12, hh + 10, 24, c);
    draw2d.text(g, `EL  ${st.el.toFixed(1)}°`, 12, hh + 44, 24, c);
    // pusula
    const cx = w - 70;
    const cy = hh + 70;
    g.strokeStyle = c;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, 44, 0, Math.PI * 2);
    g.stroke();
    const a0 = (st.az / 180) * Math.PI - Math.PI / 2;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a0) * 40, cy + Math.sin(a0) * 40);
    g.stroke();
    draw2d.text(g, st.aligned ? 'HEDEF: DÜNYA ✓' : 'HEDEF: DÜNYA', 12, h - 30, 16, c);
  });
  const o = '#ffb347';
  b.draw((g, w, h) => {
    const hh = draw2d.header(g, w, h, 'SİNYAL', o);
    const bars = 12;
    const lvl = st.aligned ? 0.92 : st.moving ? 0.3 + st.t / 3.6 * 0.5 : 0.34;
    for (let i = 0; i < bars; i++) {
      const bh = 20 + i * 6;
      const on = i / bars < lvl + Math.sin(t * 6 + i) * 0.03;
      g.fillStyle = on ? o : 'rgba(255,179,71,0.18)';
      g.fillRect(14 + i * ((w - 28) / bars), h - 16 - bh, (w - 28) / bars - 4, bh);
    }
    draw2d.text(g, `%${Math.round(lvl * 100)}`, 12, hh + 6, 26, o);
  });
}
