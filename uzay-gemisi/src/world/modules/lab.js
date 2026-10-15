import * as THREE from 'three';
import { buildShell } from '../structure/shell.js';
import { addBox, addCylinder, addMesh, addSphere } from '../utils.js';
import { getTechMaterials, canvasTex, rng } from './tech/materials.js';
import { addLabel } from './tech/labels.js';
import { addRod, addBench, addShelf, addCableBundle, addScreen, drawNoPower, screenOn, nearChecker, finalizeDynamic, addVent, addOpenRack, applyMetricUVs } from './tech/kit.js';

/**
 * Bilim Laboratuvarı (modül 4).
 *
 * Dış duvar: uzun tezgâh (mikroskop, parlayan numune şişeleri, spektrometre ekranı, santrifüj),
 *            pencerenin altında gezegen kaya numuneleri vitrini.
 * İç duvar:  denklemlerle dolu beyaz tahta, eldivenli kutu (Mann buz çekirdeği), -80 °C dondurucu, kimyasal rafı.
 */

/** Beyaz tahta: kütleçekim karalamaları (canvas 1024×512). */
function drawWhiteboard(c, w, h) {
  c.fillStyle = '#e9eae4';
  c.fillRect(0, 0, w, h);
  const r = rng(42);
  // silinmiş eski yazı gölgeleri
  for (let i = 0; i < 40; i++) {
    c.fillStyle = `rgba(90,110,140,${0.03 + r() * 0.05})`;
    c.save();
    c.translate(r() * w, r() * h);
    c.rotate((r() - 0.5) * 0.3);
    c.fillRect(-60, -8, 80 + r() * 160, 10 + r() * 14);
    c.restore();
  }
  const ink = { blue: '#1f3f9a', black: '#1d1d22', red: '#b02020', green: '#1f7a3a' };
  const write = (text, x, y, { size = 34, color = ink.blue, rot = 0, italic = true } = {}) => {
    c.save();
    c.translate(x, y);
    c.rotate(rot);
    c.fillStyle = color;
    c.font = `${italic ? 'italic ' : ''}${size}px "DejaVu Serif", serif`;
    c.fillText(text, 0, 0);
    c.restore();
  };
  write('KÜTLEÇEKİM  ↔  KUANTUM ?', 30, 52, { size: 40, color: ink.black, rot: -0.015 });
  c.strokeStyle = ink.black;
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(30, 62);
  c.lineTo(560, 56);
  c.stroke();
  write('Gμν + Λgμν = (8πG / c⁴) Tμν', 40, 118, { size: 36 });
  write('F = G m₁m₂ / r²', 40, 172, { size: 32, color: ink.black, rot: 0.01 });
  write("Δt' = Δt · √(1 − 2GM / rc²)", 40, 230, { size: 34, rot: -0.01 });
  write('rₛ = 2GM / c²', 40, 284, { size: 32, color: ink.black });
  write('S = kc³A / 4Għ', 330, 284, { size: 30, color: ink.green, rot: 0.02 });
  // üstü çizili deneme
  write('Ψ(t) = e^(-iHt/ħ) Ψ₀  ??', 40, 340, { size: 30, color: ink.blue });
  c.strokeStyle = ink.red;
  c.lineWidth = 4;
  c.beginPath();
  c.moveTo(34, 330);
  c.lineTo(420, 326);
  c.moveTo(34, 336);
  c.lineTo(420, 318);
  c.stroke();
  write('YANLIŞ → tekillik verisi lazım', 60, 382, { size: 28, color: ink.red, rot: -0.02 });
  // daire içinde ana soru
  c.strokeStyle = ink.red;
  c.lineWidth = 3;
  c.beginPath();
  c.ellipse(250, 450, 230, 40, -0.02, 0, Math.PI * 2);
  c.stroke();
  write('olay ufkunun içinden veri?', 72, 460, { size: 30, color: ink.black });
  // kara delik + disk çizimi
  const cx = 780;
  const cy = 210;
  c.fillStyle = ink.black;
  c.beginPath();
  c.arc(cx, cy, 52, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = ink.blue;
  c.lineWidth = 4;
  c.beginPath();
  c.ellipse(cx, cy, 150, 30, -0.08, 0, Math.PI * 2);
  c.stroke();
  c.beginPath();
  c.ellipse(cx, cy - 6, 80, 70, 0, Math.PI * 1.05, Math.PI * 1.95);
  c.stroke();
  write('Gargantua', cx - 70, cy - 92, { size: 30, color: ink.black, rot: -0.03 });
  // yörünge ve ok
  c.strokeStyle = ink.green;
  c.setLineDash([10, 8]);
  c.beginPath();
  c.ellipse(cx, cy, 205, 95, -0.08, 0, Math.PI * 2);
  c.stroke();
  c.setLineDash([]);
  c.fillStyle = ink.green;
  c.beginPath();
  c.arc(cx + 196, cy + 30, 12, 0, Math.PI * 2);
  c.fill();
  write('Miller', cx + 150, cy + 76, { size: 28, color: ink.green });
  write('1 sa ≈ 7 yıl (!!)', cx + 70, cy + 116, { size: 28, color: ink.red, rot: 0.03 });
  write('M ≈ 10⁸ M☉ ?', 640, 420, { size: 30, color: ink.blue });
  // yapışkan not
  c.save();
  c.translate(880, 370);
  c.rotate(0.06);
  c.fillStyle = '#f2df5c';
  c.fillRect(0, 0, 120, 110);
  c.fillStyle = '#4a3a10';
  c.font = 'italic 19px "DejaVu Serif", serif';
  ['Numuneleri', '-80\'e koy!', '', 'TARS mizah', '→ %60'].forEach((l, i) => c.fillText(l, 10, 26 + i * 20));
  c.restore();
  // kenar kiri
  const grd = c.createLinearGradient(0, h - 40, 0, h);
  grd.addColorStop(0, 'rgba(100,100,100,0)');
  grd.addColorStop(1, 'rgba(100,100,100,0.18)');
  c.fillStyle = grd;
  c.fillRect(0, 0, w, h);
}

const SAMPLES = [
  { key: 'miller', title: 'Miller gezegeni su numunesi', lines: [
    'Örnek: Miller gezegeni su numunesi',
    'Kaynak: sığ okyanus yüzeyi, dev dalga geçişinden önce',
    'Büyütme: 400×  |  Aydınlatma: polarize',
    '',
    'Tuzluluk ......... %3.1  (Dünya okyanuslarına yakın)',
    'Askıda tortu ..... ince kalsit taneleri, yoğun',
    'Organik iz ....... YOK',
    'Mikroorganizma ... saptanmadı',
    '',
    'Değerlendirme: Su var, yaşam yok. Yaşanabilirlik: DÜŞÜK.',
    'Not: Numunenin kayıt saati ile gemi saati arasında yıllar var.',
    'Saat bozuk değil — gelgit kuvveti ve zaman genişlemesi.',
  ] },
  { key: 'mann', title: 'Mann gezegeni buz çekirdeği', lines: [
    'Örnek: Mann gezegeni buz çekirdeği (derinlik 40 m)',
    'Büyütme: 100×  |  Sıcaklık: -78 °C',
    '',
    'Kristal yapı ..... düzensiz, sıkışmış bulut buzu',
    'Gaz kabarcıkları . amonyak izleri',
    'Organik iz ....... YOK',
    '',
    'Değerlendirme: Uzaktan gönderilen veriler iyimserdi.',
    'Numune o kadar iyimser değil.',
  ] },
  { key: 'edmunds', title: 'Edmunds — numune bekleniyor', lines: [
    'Örnek: — YOK —',
    'Edmunds gezegeni numune tepsisi boş.',
    '',
    'Son işaret: olumlu (zayıf, kesintili).',
    'Tepsi etiketine biri kurşun kalemle "umut" yazmış.',
  ] },
];

export default {
  id: 'lab',
  name: 'Bilim Laboratuvarı',
  build(mctx) {
    const M = mctx.materials;
    const T = getTechMaterials();
    const g = mctx.group;
    const { state, audio, ui } = mctx;
    const near = nearChecker(mctx, 12);

    buildShell(mctx, {
      wall: 'light',
      floor: 'panel',
      accent: 0x6ab8ff,
      outerWindows: [{ x: 3.0, w: 1.8, y: 1.0, h: 1.2 }],
      lights: 3,
      lightColor: 0xf4f7ff,
    });
    // Numune parıltısı (acil durumda da hafif yeşil — biyolüminesan kültürler)
    mctx.addLight([-2.9, 1.25, -2.5], { color: 0x7dffc0, intensity: 1.6, distance: 3.2, emergency: { color: 0x40ff90, intensity: 1.1 } });

    // ------------------------------------------------------------------
    // Dış duvar: uzun tezgâh + üst dolaplar
    // ------------------------------------------------------------------
    addBench(g, M, { x: -2.0, z: -3.1, w: 5.8, d: 0.75 });
    addBox(g, { size: [5.6, 0.6, 0.36], pos: [-2.1, 2.05, -3.31], material: M.panelLight });
    for (let i = 0; i < 7; i++) {
      const x = -4.7 + i * 0.8;
      addBox(g, { size: [0.76, 0.56, 0.015], pos: [x, 2.05, -3.12], material: M.plasticWhite });
      addBox(g, { size: [0.12, 0.02, 0.02], pos: [x, 1.82, -3.105], material: M.metal });
    }
    addBox(g, { size: [5.4, 0.025, 0.08], pos: [-2.1, 1.74, -3.2], material: M.lightPanel });
    addCableBundle(g, [-4.9, 1.72, -3.4], [-0.9, 1.72, -3.4], { sag: 0.06, count: 2, spread: 0.02, radius: 0.008 });

    // Mikroskop (+Z'ye, oyuncuya doğru bakar) — etkileşimli
    const mic = new THREE.Group();
    mic.name = 'mikroskop';
    mic.position.set(-3.95, 0.92, -3.05);
    g.add(mic);
    addBox(mic, { size: [0.22, 0.04, 0.28], pos: [0, 0.02, 0], material: M.plasticWhite });
    addBox(mic, { size: [0.07, 0.34, 0.08], pos: [0, 0.2, -0.09], material: M.plasticWhite });
    addBox(mic, { size: [0.09, 0.08, 0.2], pos: [0, 0.37, -0.03], material: M.plasticWhite });
    addBox(mic, { size: [0.17, 0.015, 0.15], pos: [0, 0.15, 0.02], material: M.plasticDark });
    addBox(mic, { size: [0.075, 0.004, 0.026], pos: [0, 0.16, 0.025], material: T.vialGlow });
    addCylinder(mic, { radius: 0.035, height: 0.03, segments: 12, pos: [0, 0.31, 0.03], material: M.metal });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      addRod(mic, [Math.cos(a) * 0.018, 0.3, 0.03 + Math.sin(a) * 0.018], [Math.cos(a) * 0.024, 0.24, 0.03 + Math.sin(a) * 0.024], { radius: 0.009, material: M.metal, openEnded: false });
    }
    for (const sx of [-1, 1]) {
      addRod(mic, [sx * 0.02, 0.4, 0.03], [sx * 0.032, 0.47, 0.12], { radius: 0.013, material: M.plasticDark, openEnded: false });
      addCylinder(mic, { radius: 0.025, height: 0.025, segments: 10, pos: [sx * 0.05, 0.18, -0.09], rot: [0, 0, Math.PI / 2], material: M.plasticDark });
    }
    addCylinder(mic, { radius: 0.02, height: 0.01, segments: 10, pos: [0, 0.045, 0.02], material: M.lightPanel });
    finalizeDynamic(mic);
    let microIndex = 0;
    mctx.interactions.add(mic, {
      id: 'lab.microscope',
      prompt: 'Mikroskoba bak',
      onInteract: () => {
        if (!state.is('power_restored')) {
          audio.play('error');
          ui.toast('Mikroskobun ışık kaynağı çalışmıyor — enerji yok. Önce motor modülünde gücü geri getir.', 4000);
          return;
        }
        audio.play('terminal');
        microIndex = 0;
        let term = null;
        const show = () => SAMPLES[microIndex].lines;
        term = ui.openTerminal({
          title: 'MİKROSKOP — NUMUNE ANALİZİ',
          lines: show(),
          options: [
            {
              label: 'Sonraki numune',
              action: () => {
                microIndex = (microIndex + 1) % SAMPLES.length;
                audio.play('click');
                term?.setLines?.(show());
                return false;
              },
            },
            { label: 'Kapat', action: () => {} },
          ],
        });
      },
    });

    // Numune şişeleri (parlayan) — rafta 2 sıra
    {
      const rx = -3.05;
      const rz = -3.1;
      addBox(g, { size: [0.5, 0.05, 0.18], pos: [rx, 0.945, rz], material: M.plasticWhite });
      addBox(g, { size: [0.5, 0.02, 0.18], pos: [rx, 1.03, rz], material: M.plasticWhite });
      for (const sx of [-1, 1]) addBox(g, { size: [0.02, 0.1, 0.18], pos: [rx + sx * 0.24, 0.99, rz], material: M.plasticWhite });
      for (let row = 0; row < 2; row++) {
        for (let i = 0; i < 6; i++) {
          const x = rx - 0.19 + i * 0.076;
          const z = rz - 0.04 + row * 0.08;
          const mat = (i + row) % 3 === 0 ? T.vialGlowAmber : T.vialGlow;
          addCylinder(g, { radius: 0.014, height: 0.09, segments: 8, pos: [x, 1.0, z], material: mat });
          addCylinder(g, { radius: 0.016, height: 0.02, segments: 8, pos: [x, 1.055, z], material: row ? M.accentOrange : M.fabricBlue });
        }
      }
      addLabel(g, 'KÜLTÜR — DOKUNMA', { pos: [rx, 0.955, rz + 0.092], height: 0.025, style: 'tag' });
    }

    // Spektrometre + ekran (enerji gerekir)
    addBox(g, { size: [0.5, 0.18, 0.36], pos: [-2.15, 1.01, -3.15], material: M.plasticWhite });
    addBox(g, { size: [0.3, 0.02, 0.02], pos: [-2.15, 1.06, -2.965], material: M.ledGreen });
    addLabel(g, 'SPEKTROMETRE', { pos: [-2.15, 0.975, -2.968], height: 0.03, style: 'stencil' });
    const spec = addScreen(g, M, { size: [0.52, 0.32], pos: [-1.5, 1.32, -3.3], rot: [-0.1, 0.25, 0], res: [448, 272], color: '#62ff9a' });
    addBox(g, { size: [0.05, 0.25, 0.05], pos: [-1.5, 1.05, -3.33], material: M.metalDark });
    addBox(g, { size: [0.42, 0.015, 0.14], pos: [-1.55, 0.93, -2.9], rot: [0, 0.2, 0], material: M.plasticDark });

    // Santrifüj (dönen rotor, cam kapak) — etkileşimli
    const cfx = -0.65;
    const cfz = -3.05;
    const cfBody = addCylinder(g, { radius: 0.21, height: 0.24, segments: 20, pos: [cfx, 1.04, cfz], material: M.plasticWhite, name: 'santrifüj' });
    addCylinder(g, { radius: 0.215, height: 0.03, segments: 20, pos: [cfx, 0.935, cfz], material: M.plasticDark });
    addBox(g, { size: [0.12, 0.05, 0.02], pos: [cfx, 1.05, cfz + 0.205], material: M.screenGreen });
    addCylinder(g, { radius: 0.19, height: 0.02, segments: 20, pos: [cfx, 1.17, cfz], material: M.glass });
    const rotor = new THREE.Group();
    rotor.position.set(cfx, 1.12, cfz);
    addCylinder(rotor, { radius: 0.15, height: 0.03, segments: 16, material: M.metal });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const tube = addCylinder(rotor, { radius: 0.018, height: 0.08, segments: 8, pos: [Math.cos(a) * 0.11, 0.025, Math.sin(a) * 0.11], material: i % 2 ? T.vialGlowAmber : M.accentOrange });
      tube.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
    }
    g.add(rotor);
    finalizeDynamic(rotor);
    let cfRunning = false;
    let cfSpeed = 0;
    state.when('power_restored', () => (cfRunning = true));
    mctx.interactions.add(cfBody, {
      id: 'lab.centrifuge',
      prompt: () => (cfRunning ? 'Santrifüjü durdur' : 'Santrifüjü çalıştır'),
      onInteract: () => {
        if (!state.is('power_restored')) {
          audio.play('error');
          ui.toast('Santrifüj enerjisiz.');
          return;
        }
        cfRunning = !cfRunning;
        audio.play(cfRunning ? 'spin_up' : 'power_down', { position: mctx.toWorld(cfx, 1.1, cfz), volume: 0.6 });
        ui.toast(cfRunning ? 'Santrifüj: 12 000 dev/dk — Miller tortu numunesi ayrıştırılıyor.' : 'Santrifüj durduruldu.');
      },
    });

    // Beherler, pipet standı, kupa, defter
    for (const [x, z, r, hh, liquid] of [
      [-0.2, -3.2, 0.045, 0.12, T.water],
      [-0.05, -3.0, 0.035, 0.09, T.vialGlowAmber],
      [0.25, -3.15, 0.05, 0.14, null],
    ]) {
      addCylinder(g, { radius: r, height: hh, segments: 12, pos: [x, 0.92 + hh / 2, z], material: M.glassFrosted, openEnded: true });
      if (liquid) addCylinder(g, { radius: r * 0.92, height: hh * 0.5, segments: 12, pos: [x, 0.92 + hh * 0.25, z], material: liquid });
    }
    addBox(g, { size: [0.25, 0.015, 0.08], pos: [0.55, 0.93, -3.25], material: M.plasticWhite });
    for (let i = 0; i < 4; i++) addRod(g, [0.46 + i * 0.06, 0.94, -3.25], [0.46 + i * 0.06, 1.18, -3.25], { radius: 0.006, material: M.plasticWhite, openEnded: false });
    addCylinder(g, { radius: 0.04, height: 0.1, segments: 12, pos: [-2.75, 0.97, -2.85], material: M.accentOrange });
    addBox(g, { size: [0.22, 0.012, 0.3], pos: [-3.45, 0.926, -2.9], rot: [0, 0.3, 0], material: T.paper });
    addBox(g, { size: [0.006, 0.006, 0.14], pos: [-3.38, 0.936, -2.88], rot: [0, 0.5, 0], material: M.fabricBlue });

    // Tabureler
    for (const x of [-3.7, -1.7]) {
      addCylinder(g, { radius: 0.19, height: 0.06, segments: 16, pos: [x, 0.68, -2.35], material: M.fabricBlue, collide: true });
      addCylinder(g, { radius: 0.025, height: 0.6, segments: 8, pos: [x, 0.35, -2.35], material: M.metal });
      addCylinder(g, { radius: 0.22, height: 0.03, segments: 5, pos: [x, 0.03, -2.35], material: M.metalDark });
    }

    // Pencere altı: gezegen numuneleri vitrini
    const vx = 3.0;
    const vz = -3.1;
    addBox(g, { size: [2.6, 0.65, 0.7], pos: [vx, 0.325, vz], material: M.panelMid, collide: true });
    addBox(g, { size: [2.64, 0.04, 0.74], pos: [vx, 0.67, vz], material: M.metalDark });
    const caseGlass = addBox(g, { size: [2.4, 0.28, 0.55], pos: [vx, 0.83, vz + 0.02], material: M.glass, name: 'numune-vitrini' });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) addBox(g, { size: [0.025, 0.3, 0.025], pos: [vx + sx * 1.2, 0.83, vz + 0.02 + sz * 0.275], material: M.aluminium });
    addBox(g, { size: [2.42, 0.02, 0.57], pos: [vx, 0.98, vz + 0.02], material: M.aluminium });
    addLabel(g, 'GEZEGEN NUMUNELERİ', { pos: [vx, 0.5, vz + 0.352], height: 0.06, style: 'stencil' });
    {
      const rocks = [
        { x: -0.95, mat: T.sediment, label: 'MILLER — TORTU', r: 0.07 },
        { x: -0.55, mat: T.rockRed, label: 'MILLER — KALSİT', r: 0.06 },
        { x: -0.12, mat: T.rockIce, label: 'MANN — BUZ', r: 0.075 },
        { x: 0.3, mat: T.rockIce, label: 'MANN — DONMUŞ BULUT', r: 0.055 },
        { x: 0.7, mat: T.rockDark, label: 'SATÜRN — HALKA TOZU', r: 0.05 },
        { x: 1.05, mat: null, label: 'EDMUNDS — ?', r: 0 },
      ];
      const rr = rng(9);
      for (const k of rocks) {
        addBox(g, { size: [0.3, 0.015, 0.22], pos: [vx + k.x, 0.7, vz + 0.02], material: M.plasticDark });
        addLabel(g, k.label, { pos: [vx + k.x, 0.7, vz + 0.135], rot: [-0.6, 0, 0], height: 0.022, style: 'tag' });
        if (!k.mat) continue;
        const geo = new THREE.IcosahedronGeometry(k.r, 1);
        const p = geo.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const s = 0.75 + rr() * 0.45;
          p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.75, p.getZ(i) * s);
        }
        geo.computeVertexNormals();
        addMesh(g, geo, k.mat, { pos: [vx + k.x, 0.7 + k.r * 0.6, vz + 0.01], rot: [rr(), rr() * 3, rr()] });
      }
    }
    mctx.interactions.add(caseGlass, {
      id: 'lab.rocks',
      prompt: 'Kaya numunelerini incele',
      onInteract: () => {
        audio.play('terminal');
        ui.openTerminal({
          title: 'GEZEGEN NUMUNELERİ — ENVANTER',
          lines: [
            'MILLER — TORTU ........ kalsit çamuru, okyanus tabanı',
            'MILLER — KALSİT ....... dalga aşındırması, organik iz yok',
            'MANN — BUZ ............ sıkışmış bulut buzu, amonyak kabarcıkları',
            'MANN — DONMUŞ BULUT ... havada asılı buz parçası (!)',
            'SATÜRN — HALKA TOZU ... silikat + su buzu, yörüngeden',
            'EDMUNDS — ? ........... TEPSİ BOŞ',
            '',
            'Not: Boş tepsiye kimse dokunmasın. O tepsinin bir sahibi var.',
          ],
          options: [{ label: 'Kapat', action: () => {} }],
        });
      },
    });

    // ------------------------------------------------------------------
    // İç duvar: beyaz tahta
    // ------------------------------------------------------------------
    {
      const bx = -3.0;
      const tex = canvasTex(1024, 512, drawWhiteboard);
      const wbMat = new THREE.MeshStandardMaterial({ map: tex, color: tex ? 0xffffff : 0xe9eae4, roughness: 0.35, metalness: 0 });
      wbMat.name = 'lab.whiteboard';
      addBox(g, { size: [2.92, 1.42, 0.04], pos: [bx, 1.65, 3.4], material: M.aluminium });
      const board = addMesh(g, new THREE.PlaneGeometry(2.8, 1.3), wbMat, { pos: [bx, 1.65, 3.378], rot: [0, Math.PI, 0], name: 'beyaz-tahta' });
      addBox(g, { size: [2.4, 0.03, 0.08], pos: [bx, 0.97, 3.35], material: M.aluminium });
      for (const [x, mat] of [
        [-0.5, M.fabricBlue],
        [-0.3, M.accentOrange],
        [0.2, M.plasticDark],
      ]) addCylinder(g, { radius: 0.01, height: 0.13, segments: 6, pos: [bx + x, 0.995, 3.34], rot: [0, 0, Math.PI / 2], material: mat });
      addBox(g, { size: [0.14, 0.05, 0.06], pos: [bx + 0.6, 1.01, 3.34], material: M.plasticDark });
      for (const dx of [-1.25, 0.25]) addBox(g, { size: [0.06, 0.06, 0.1], pos: [bx + dx, 2.2, 3.44], material: M.metalDark });
      mctx.interactions.add(board, {
        id: 'lab.whiteboard',
        prompt: 'Tahtadaki notları oku',
        distance: 3.2,
        onInteract: () => {
          audio.play('click');
          ui.openTerminal({
            title: 'BEYAZ TAHTA — EL YAZISI NOTLAR',
            lines: [
              'KÜTLEÇEKİM ↔ KUANTUM ?  (altı çizili)',
              '',
              '• Gμν + Λgμν = (8πG/c⁴) Tμν      — alan denklemleri',
              "• Δt' = Δt · √(1 − 2GM/rc²)      — zaman genişlemesi",
              '• rₛ = 2GM/c²                     — olay ufku yarıçapı',
              '• S = kc³A / 4Għ                  — kara delik entropisi',
              '• Ψ(t) = e^(−iHt/ħ) Ψ₀ ??  → üstü çizili, "YANLIŞ"',
              '',
              'Daire içinde: "olay ufkunun içinden veri?"',
              'Çizim: Gargantua, yığılma diski, Miller yörüngesi: "1 sa ≈ 7 yıl (!!)"',
              'Yapışkan not: "Numuneleri -80\'e koy! TARS mizah → %60"',
            ],
            options: [{ label: 'Kapat', action: () => {} }],
          });
        },
      });
    }

    // Eldivenli kutu (Mann buz çekirdeği)
    {
      const gx = 0.4;
      const gz = 3.08;
      addBox(g, { size: [1.4, 0.85, 0.68], pos: [gx, 0.425, gz], material: M.panelLight, collide: true, name: 'eldivenli-kutu' });
      addBox(g, { size: [1.44, 0.04, 0.72], pos: [gx, 0.87, gz], material: M.metalDark });
      addLabel(g, 'ELDİVENLİ KUTU — İNERT ATMOSFER', { pos: [gx, 0.7, gz - 0.342], rot: [0, Math.PI, 0], height: 0.04, style: 'tag' });
      // çerçeve
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) addBox(g, { size: [0.03, 0.66, 0.03], pos: [gx + sx * 0.64, 1.22, gz + sz * 0.29], material: M.aluminium });
      addBox(g, { size: [1.31, 0.03, 0.61], pos: [gx, 1.55, gz], material: M.aluminium });
      const gb = addBox(g, { size: [1.26, 0.64, 0.58], pos: [gx, 1.22, gz], material: M.glass, name: 'eldivenli-kutu-cam' });
      for (const sx of [-1, 1]) {
        addMesh(g, new THREE.TorusGeometry(0.085, 0.02, 6, 16), M.rubber, { pos: [gx + sx * 0.3, 1.15, gz - 0.29] });
        addRod(g, [gx + sx * 0.3, 1.15, gz - 0.28], [gx + sx * 0.24, 1.02, gz - 0.02], { radius: 0.06, material: M.rubber, segments: 8 });
        addSphere(g, { radius: 0.065, widthSegments: 8, heightSegments: 6, pos: [gx + sx * 0.24, 1.0, gz], material: M.rubber });
      }
      addBox(g, { size: [0.5, 0.02, 0.2], pos: [gx, 0.9, gz + 0.08], material: M.metal });
      addCylinder(g, { radius: 0.05, height: 0.36, segments: 10, pos: [gx, 0.96, gz + 0.08], rot: [0, 0, Math.PI / 2], material: T.rockIce });
      addLabel(g, 'MANN — DERİN BUZ', { pos: [gx, 0.92, gz + 0.183], rot: [0, Math.PI, 0], height: 0.022, style: 'tag' });
      addBox(g, { size: [0.14, 0.08, 0.04], pos: [gx + 0.5, 1.45, gz - 0.29], material: M.plasticDark });
      addBox(g, { size: [0.03, 0.03, 0.01], pos: [gx + 0.5, 1.45, gz - 0.312], material: M.ledGreen });
      mctx.interactions.add(gb, {
        id: 'lab.glovebox',
        prompt: 'Eldivenli kutuya bak',
        onInteract: () => {
          audio.play('hiss', { volume: 0.3 });
          ui.toast('Mühürlü kutu: "MANN — derin buz çekirdeği". Basınç −12 Pa (negatif, sızıntı yok). Eldivenler buz gibi.', 5000);
        },
      });
    }

    // -80 °C dondurucu
    {
      const fx = 2.2;
      const fz = 3.12;
      addBox(g, { size: [0.82, 2.0, 0.66], pos: [fx, 1.0, fz], material: M.plasticWhite, collide: true, name: 'dondurucu' });
      const door = addBox(g, { size: [0.76, 1.6, 0.04], pos: [fx, 1.05, fz - 0.345], material: M.plasticWhite, name: 'dondurucu-kapak' });
      addBox(g, { size: [0.04, 0.5, 0.05], pos: [fx + 0.3, 1.1, fz - 0.38], material: M.metal });
      addBox(g, { size: [0.3, 0.12, 0.02], pos: [fx, 1.8, fz - 0.335], material: M.plasticDark });
      addLabel(g, '−80 °C', { pos: [fx - 0.04, 1.8, fz - 0.346], rot: [0, Math.PI, 0], height: 0.06, style: 'black' });
      addLabel(g, 'BİYOLOJİK NUMUNE', { pos: [fx, 1.55, fz - 0.368], rot: [0, Math.PI, 0], height: 0.045, style: 'red' });
      const led = addBox(g, { size: [0.03, 0.03, 0.01], pos: [fx + 0.1, 1.8, fz - 0.348], material: M.ledRed, dynamic: true });
      state.when('power_restored', () => (led.material = M.ledGreen));
      mctx.interactions.add(door, {
        id: 'lab.freezer',
        prompt: 'Dondurucuyu kontrol et',
        onInteract: () => {
          audio.play('beep');
          if (state.is('power_restored')) ui.toast('Dondurucu: −80 °C, kararlı. 214 numune tüpü, 6 tohum kültürü güvende.', 4000);
          else ui.toast('Dondurucu −52 °C\'ye ısınmış! Güç gelmezse numuneler bozulacak.', 4000);
        },
      });
    }

    // Kimyasal rafı + laboratuvar önlüğü
    {
      const sx = 4.0;
      const ys = addOpenRack(g, M, { x: sx, z: 3.25, w: 1.3, h: 1.95, d: 0.42, shelves: 4, side: -1 });
      ys.forEach((y, i) => {
        for (let k = 0; k < 6; k++) {
          const x = sx - 0.5 + k * 0.2;
          const tall = 0.12 + ((k * 7 + i * 3) % 5) * 0.03;
          const mat = [M.plasticWhite, T.pipeBlue, M.accentOrange, M.glassFrosted, M.plasticDark][(k + i) % 5];
          if (i === 3 && tall > 0.2) continue;
          addCylinder(g, { radius: 0.04, height: tall, segments: 8, pos: [x, y + tall / 2, 3.2], material: mat });
        }
      });
      addBox(g, { size: [1.0, 0.09, 0.015], pos: [sx, 2.02, 3.05], material: M.metalDark });
      addLabel(g, 'KİMYASAL — KAPAĞI KAPALI TUT', { pos: [sx, 2.02, 3.041], rot: [0, Math.PI, 0], height: 0.045, style: 'warn' });
      // askıda önlük
      addCylinder(g, { radius: 0.012, height: 0.08, segments: 6, pos: [3.05, 1.85, 3.46], rot: [Math.PI / 2, 0, 0], material: M.metal });
      addBox(g, { size: [0.42, 0.95, 0.06], pos: [3.05, 1.35, 3.42], material: M.padding });
      addBox(g, { size: [0.36, 0.08, 0.07], pos: [3.05, 1.8, 3.42], material: M.padding });
      addLabel(g, 'Dr. B', { pos: [2.94, 1.6, 3.385], rot: [0, Math.PI, 0], height: 0.03, style: 'stencil' });
    }
    addVent(g, M, { pos: [-0.9, 2.65, 3.49], rot: [0, Math.PI, 0], w: 0.7, h: 0.35 });
    addShelf(g, M, { x: 0.4, y: 2.2, z: 3.35, w: 1.3, d: 0.3, side: -1 });
    for (let i = 0; i < 5; i++) addBox(g, { size: [0.18, 0.22, 0.24], pos: [-0.1 + i * 0.25, 2.33, 3.35], material: i % 2 ? M.plasticWhite : M.fabricBlue });
    addLabel(g, 'GÖZ DUŞU', { pos: [1.42, 1.5, 3.41], rot: [0, Math.PI, 0], height: 0.05, style: 'blue' });

    applyMetricUVs(g, M);

    // ------------------------------------------------------------------
    // Güncelleme: santrifüj ve spektrometre (sadece yakındayken)
    // ------------------------------------------------------------------
    let screenT = 0;
    let lastPowered = null;
    mctx.onUpdate((dt, t) => {
      const powered = state.is('power_restored');
      const target = cfRunning && powered ? 14 : 0;
      cfSpeed += (target - cfSpeed) * Math.min(1, dt * (target ? 0.8 : 0.5));
      if (!near()) return;
      if (cfSpeed > 0.01) rotor.rotation.y += cfSpeed * dt;
      screenT -= dt;
      if (screenT > 0 && powered === lastPowered) return;
      screenT = 0.15;
      lastPowered = powered;
      const s = spec.screen;
      if (!powered) {
        drawNoPower(s);
        return;
      }
      screenOn(s);
      s.draw((c, w, h) => {
        c.font = 'bold 20px monospace';
        c.fillText('KÜTLE SPEKTROMETRESİ', 12, 10);
        c.font = '15px monospace';
        c.fillText('NUMUNE: MILLER-03 / TORTU', 12, 38);
        const base = h - 30;
        c.strokeStyle = 'rgba(98,255,154,0.35)';
        c.beginPath();
        c.moveTo(12, base);
        c.lineTo(w - 12, base);
        c.stroke();
        c.strokeStyle = '#62ff9a';
        c.lineWidth = 2;
        c.beginPath();
        for (let i = 0; i <= 100; i++) {
          const x = 12 + ((w - 24) * i) / 100;
          const peak = Math.exp(-((i - 22) ** 2) / 6) * 0.9 + Math.exp(-((i - 47) ** 2) / 10) * 0.55 + Math.exp(-((i - 71) ** 2) / 4) * 0.7;
          const v = peak + 0.04 * Math.abs(Math.sin(i * 1.7 + t * 6));
          const y = base - v * (h - 100);
          if (i === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
        c.stroke();
        c.font = '14px monospace';
        c.fillText('Ca', 12 + (w - 24) * 0.2, base + 6);
        c.fillText('H₂O', 12 + (w - 24) * 0.44, base + 6);
        c.fillText('Si', 12 + (w - 24) * 0.69, base + 6);
        if (Math.floor(t * 2) % 2) c.fillText('TARANIYOR…', w - 120, 40);
      });
    });
  },
};
