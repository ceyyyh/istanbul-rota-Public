import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildShell } from '../structure/shell.js';
import { addBox, addCylinder, addMesh } from '../utils.js';
import {
  crewMaterials,
  vBox,
  vCyl,
  colorize,
  label,
  addScreen,
  drawNoPower,
  screenDriver,
  draw2d,
  addRail,
  addRod,
  addCableRun,
  addLocker,
  addVent,
  addPicture,
  addPlant,
  addProxy,
  place,
  bookGeometry,
  BOOK_COLORS,
  createTimers,
  openTerminal,
  sfx,
  rng,
  pictureMaterial,
} from './crew/kit.js';
import { drawCornfield, drawFarmhouse, drawFamily, drawKidRocket, drawEarth, drawDustStorm } from './crew/pictures.js';
import { MORSE } from './crew/texts.js';

/**
 * Yaşam Alanı — mürettebatın "evi": ranzalar, yemek masası, mutfak köşesi, kitaplık, fotoğraflar.
 *
 * Etkileşimler:
 *   quarters-coffee     Kahve makinesi (enerji gerekir): "Kahve hazır." → ikinci basış kahveyi içer
 *   quarters-bookshelf  Kitaplık: kitaplar sırayla dışarı itilir, Mors "KAL" belirir → state 'found_morse'
 *   quarters-watch      Masadaki kol saati: saniye ibresi Mors ritminde titrer
 *   quarters-photo-*    Fotoğraflar (anı altyazıları)
 *   quarters-bunk-*     Ranzalar (kısa notlar)
 *
 * Yerleşim: dış duvarda (z<0) iki ranza + fotoğraf duvarı + yemek masası; iç duvarda (z>0) dolaplar,
 * kitaplık, ilan panosu, yiyecek dolapları, mutfak tezgâhı ve buzdolabı. Yürüme şeridi (|z| ≤ 0.9) boş.
 */

const PI = Math.PI;
const SLOT = 0.052; // kitap yuvası genişliği (m)

const dashDot = (code) => code.replace(/−/g, '-').replace(/·/g, '.');

export default {
  id: 'quarters',
  name: 'Yaşam Alanı',
  build(mctx) {
    const M = mctx.materials;
    const C = crewMaterials(mctx);
    const root = mctx.group;
    const timers = createTimers(mctx);

    buildShell(mctx, {
      outerWindows: [{ x: 2.3, w: 2.6, y: 1.2, h: 1.0 }],
      lights: 2,
      lightColor: 0xfff0dc,
      lightIntensity: 6,
      accent: 0xd8962a,
    });
    // Yemek masası üstü sıcak lamba + kitaplık okuma ışığı (toplam 4 ışık)
    mctx.addLight([2.3, 2.5, -1.75], { color: 0xffc98a, intensity: 3.4, distance: 6.5, emergency: { color: 0xff4a2a, intensity: 0.55 } });
    mctx.addLight([-2.15, 2.5, 2.1], { color: 0xffe2b0, intensity: 2.4, distance: 5, emergency: { color: 0xff3020, intensity: 0.4 } });

    // ------------------------------------------------------------------
    // Dış duvar: ranzalar
    // ------------------------------------------------------------------
    const bunkA = buildBunk(root, M, C, { x: -4.25, bags: [0x2f5e8c, 0xc9772f], name: 'KOJ 1–2' });
    const bunkB = buildBunk(root, M, C, { x: -2.2, bags: [0x56653a, 0x7a3f35], name: 'KOJ 3–4' });
    bunkA.userData.collide = true;
    bunkB.userData.collide = true;
    mctx.interactions.add(bunkA.userData.bagLow, {
      id: 'quarters-bunk-a',
      prompt: 'Ranzaya bak',
      onInteract: () => mctx.ui?.subtitle?.('SEN', 'Benim ranzam. Tulum yarı açık, yastık çöküntülü. Kalkışta ne kadar aceleyle çıkmışım.', 5200),
    });
    mctx.interactions.add(bunkB.userData.bagLow, {
      id: 'quarters-bunk-b',
      prompt: 'Ranzaya bak',
      onInteract: () => mctx.ui?.subtitle?.('SEN', 'Yastığın altında bir tornavida seti. Savaş\'ın ranzası olmalı; mühendisler uyurken bile alet bırakmıyor.', 5600),
    });

    // Fotoğraf duvarı (dış duvar, ranza ile masa arasında)
    const photos = [
      { id: 'corn', key: 'cornfield', draw: drawCornfield, pos: [-0.2, 1.72, -3.485], w: 0.5, h: 0.31, res: [384, 240], tilt: 0.015, text: 'Kuzey tarlası. Mısır, tozdan önceki yıllar… Bu kadar yeşil olduğunu unutmuşum.' },
      { id: 'farm', key: 'farmhouse', draw: drawFarmhouse, pos: [0.52, 2.05, -3.485], w: 0.32, h: 0.24, res: [320, 240], tilt: -0.03, text: 'Çiftlik evi. Veranda ışığı hep açık kalırdı; Deniz lambayı hiç kapatmazdı.' },
      { id: 'family', key: 'family', draw: drawFamily, pos: [0.5, 1.58, -3.485], w: 0.22, h: 0.17, res: [256, 192], tilt: 0.04, text: 'Üçümüz, verandanın önünde. Fotoğrafta herkes gülüyor; çekilirken hiçbirimiz gülmüyordu.' },
      { id: 'kid', key: 'kidrocket', draw: drawKidRocket, pos: [-0.72, 1.55, -3.485], w: 0.21, h: 0.16, res: [256, 192], tilt: -0.05, text: 'Çocuk çizimi: halka bir gemi, yanında "BABAM" yazısı. Pastel boya, ucu kırık.' },
    ];
    for (const p of photos) {
      const pic = addPicture(root, { key: p.key, draw: p.draw, pos: p.pos, w: p.w, h: p.h, res: p.res, tilt: p.tilt });
      mctx.interactions.add(pic, {
        id: `quarters-photo-${p.id}`,
        prompt: 'Fotoğrafa bak',
        distance: 3.4,
        onInteract: () => mctx.ui?.subtitle?.('SEN', p.text, 5600),
      });
    }
    label(root, 'ANILAR · DOKUNMAYIN, SADECE BAKIN', { pos: [0.05, 1.28, -3.49], height: 0.035, color: '#1c1c1c', bg: '#e8e2cf' });
    label(root, 'YAŞAM ALANI', { pos: [-3.2, 2.62, -3.49], height: 0.09, color: '#2a2a2a' });
    label(root, 'SESSİZ SAATLER 22:00 – 06:00', { pos: [-3.2, 2.42, -3.49], height: 0.04, color: '#1a1a1a', bg: '#d8a21a' });

    // ------------------------------------------------------------------
    // Yemek masası + banklar
    // ------------------------------------------------------------------
    const table = place(root, [2.3, 0, -2.12]);
    addBox(table, { size: [2.5, 0.05, 0.85], pos: [0, 0.745, 0], material: M.panelLight });
    addBox(table, { size: [2.52, 0.02, 0.87], pos: [0, 0.715, 0], material: M.rubber });
    for (const sx of [-1, 1]) {
      addBox(table, { size: [0.12, 0.7, 0.46], pos: [sx * 0.85, 0.36, 0], material: M.metalDark });
      addBox(table, { size: [0.5, 0.03, 0.74], pos: [sx * 0.85, 0.015, 0], material: M.metalDark });
    }
    addBox(table, { size: [1.6, 0.05, 0.05], pos: [0, 0.3, 0], material: M.metal });
    table.userData.collide = true;
    for (const [bz, name] of [
      [-2.88, 'bench-wall'],
      [-1.4, 'bench-lane'],
    ]) {
      const b = place(root, [2.3, 0, bz], 0, name);
      addBox(b, { size: [2.4, 0.06, 0.36], pos: [0, 0.43, 0], material: M.metalDark });
      vBox(b, { size: [2.36, 0.06, 0.34], color: 0x3b4d63, matte: true, pos: [0, 0.49, 0] });
      for (const x of [-1.05, 0, 1.05]) addBox(b, { size: [0.06, 0.4, 0.3], pos: [x, 0.2, 0], material: M.metal });
      b.userData.collide = true;
    }
    // masa üstü: yemek paketleri, tepsiler, kupalar
    const r = rng(17);
    const packColors = [0xc9772f, 0x6f8f4a, 0xb5493a, 0xd6b24a, 0x4a7a9a];
    const foodColors = [0xd9c89a, 0x7e9a5a, 0x9a5a3a, 0xe0d8c0];
    for (const [tx, tz, rot] of [
      [0.2, 0.2, 0.05],
      [-0.55, 0.22, -0.04],
      [0.75, -0.14, 0.1],
    ]) {
      const tray = place(table, [tx, 0.77, tz], rot);
      vBox(tray, { size: [0.36, 0.022, 0.25], color: 0xbfc0bd, pos: [0, 0, 0] });
      for (let k = 0; k < 4; k++) {
        const fx = (k % 2 ? 1 : -1) * 0.085;
        const fz = (k < 2 ? -1 : 1) * 0.05;
        vBox(tray, { size: [0.14, 0.02, 0.085], color: foodColors[(k + Math.floor(r() * 4)) % 4], matte: true, pos: [fx, 0.018, fz] });
      }
      vBox(tray, { size: [0.01, 0.026, 0.25], color: 0x8a8a86, pos: [0, 0.004, 0] });
    }
    for (let i = 0; i < 6; i++) {
      const px = -0.05 + (i % 3) * 0.15;
      const pz = -0.28 + Math.floor(i / 3) * 0.05;
      vBox(table, { size: [0.13, 0.026, 0.19], color: packColors[i % 5], matte: true, pos: [px + 0.98, 0.783 + (i % 2) * 0.012, pz + 0.3], rot: [0, (i - 3) * 0.12, 0] });
    }
    for (const [mx, mz, c] of [
      [-0.95, 0.15, 0xe9e6dc],
      [-0.82, -0.2, 0x2a6fb0],
      [0.45, -0.28, 0xc9772f],
    ]) {
      vCyl(table, { radius: 0.036, height: 0.09, segments: 12, color: c, pos: [mx, 0.82, mz] });
      vCyl(table, { radius: 0.03, height: 0.004, segments: 10, color: 0x3a2417, pos: [mx, 0.862, mz] });
    }
    vCyl(table, { radius: 0.05, height: 0.3, segments: 12, color: 0xb9bcc0, pos: [-0.3, 0.92, -0.22] }); // termos
    vCyl(table, { radius: 0.052, height: 0.05, segments: 12, color: 0x2a2c30, pos: [-0.3, 1.09, -0.22] });
    addPlant(table, { pos: [0.1, 0.77, -0.02], size: 0.42, seed: 8, pot: 0xc9772f, M });
    // asma lamba
    for (const dx of [-0.1, 0.1]) addRod(root, [2.3 + dx, 3.2, -1.85], [2.3 + dx, 2.56, -1.85], { radius: 0.006, material: M.metalDark, segments: 5 });
    addCylinder(root, { radiusTop: 0.05, radiusBottom: 0.3, height: 0.16, segments: 18, pos: [2.3, 2.52, -1.85], material: M.plasticWhite });
    addCylinder(root, { radius: 0.27, height: 0.012, segments: 18, pos: [2.3, 2.435, -1.85], material: M.lightPanel });
    label(root, 'YEMEK 12:00 · 18:30', { pos: [2.3, 0.95, -3.49], height: 0.03, color: '#1a1a1a', bg: '#e8e2cf' });

    // --- Kol saati ---
    const watch = buildWatch(mctx, M, C, timers, table);

    // ------------------------------------------------------------------
    // İç duvar: kişisel dolaplar
    // ------------------------------------------------------------------
    ['PİLOT', 'ERGİN', 'YAVUZ', 'KORAY'].forEach((name, i) => {
      const lk = addLocker(root, { pos: [-5.075 + i * 0.55, 0, 3.225], rotY: PI, w: 0.55, h: 2.0, d: 0.55, M, text: name, seed: 3 + i });
      lk.userData.collide = true;
    });
    label(root, 'KİŞİSEL EŞYA — KİLİTLİ DEĞİL', { pos: [-4.25, 2.2, 3.495], rot: [0, PI, 0], height: 0.04, color: '#1a1a1a', bg: '#e8e2cf' });

    // ------------------------------------------------------------------
    // Kitaplık + Mors
    // ------------------------------------------------------------------
    const shelf = buildBookshelf(mctx, M, C, timers, root);

    // ------------------------------------------------------------------
    // İlan panosu + yiyecek dolapları
    // ------------------------------------------------------------------
    const bd = place(root, [-0.5, 1.55, 3.49], PI);
    addBox(bd, { size: [1.04, 0.74, 0.03], pos: [0, 0, -0.01], material: M.metalDark });
    vBox(bd, { size: [0.98, 0.68, 0.012], color: 0x8a6a45, matte: true, pos: [0, 0, 0.008] });
    const paper = (x, y, w, h, rot, c) => vBox(bd, { size: [w, h, 0.004], color: c, matte: true, pos: [x, y, 0.018], rot: [0, 0, rot] });
    paper(-0.3, 0.12, 0.28, 0.36, 0.03, 0xe8e2cf);
    paper(0.05, 0.14, 0.24, 0.3, -0.04, 0xf0e8b8);
    paper(0.34, 0.1, 0.2, 0.26, 0.06, 0xdfe8ec);
    paper(-0.18, -0.2, 0.3, 0.2, -0.02, 0xe8e2cf);
    paper(0.25, -0.2, 0.34, 0.2, 0.02, 0xe8d8d0);
    for (const [x, y, c] of [
      [-0.3, 0.28, 0xb02a1c],
      [0.05, 0.27, 0x2a6fb0],
      [0.34, 0.21, 0xd8a21a],
      [-0.18, -0.12, 0xb02a1c],
      [0.25, -0.12, 0x3d7a4a],
    ])
      vCyl(bd, { radius: 0.008, height: 0.01, segments: 6, color: c, pos: [x, y, 0.024], rot: [PI / 2, 0, 0] });
    label(bd, 'NÖBET ÇİZELGESİ', { pos: [-0.3, 0.14, 0.022], height: 0.028, color: '#222', width: 0.2 });
    label(bd, 'BU HAFTA: HİDROPONİK', { pos: [0.05, 0.16, 0.022], height: 0.024, color: '#222', width: 0.2 });
    label(bd, 'YEDEK PARÇA LİSTESİ', { pos: [-0.18, -0.2, 0.022], height: 0.026, color: '#222', width: 0.24 });
    label(bd, 'DOĞUM GÜNÜ: 14 EKİM', { pos: [0.25, -0.2, 0.022], height: 0.026, color: '#a02a1c', width: 0.28 });
    addPicture(root, { key: 'earth', draw: drawEarth, pos: [0.38, 2.28, 3.49], rot: [0, PI, 0], w: 0.22, h: 0.22, res: [192, 192], tilt: 0.03 });
    addPicture(root, { key: 'dust', draw: drawDustStorm, pos: [-0.62, 2.28, 3.49], rot: [0, PI, 0], w: 0.3, h: 0.2, res: [256, 170], tilt: -0.02 });

    for (const [x, t, sd] of [
      [0.35, 'YİYECEK 1 · KURU', 21],
      [0.9, 'YİYECEK 2 · SOĞUK', 22],
    ]) {
      const lk = addLocker(root, { pos: [x, 0, 3.225], rotY: PI, w: 0.52, h: 2.1, d: 0.55, M, text: t, seed: sd, vents: false });
      lk.userData.collide = true;
    }

    // ------------------------------------------------------------------
    // Mutfak köşesi
    // ------------------------------------------------------------------
    const galley = buildGalley(mctx, M, C, timers, root);

    // ------------------------------------------------------------------
    // Ayrıntılar: tavan boruları, havalandırma, köşe bitkisi, korkuluk
    // ------------------------------------------------------------------
    for (const sz of [-1, 1]) {
      addRod(root, [-5.4, 3.0, sz * 3.2], [5.4, 3.0, sz * 3.2], { radius: 0.04, material: M.aluminium, segments: 8 });
      for (let x = -4.8; x <= 4.8; x += 1.6) addBox(root, { size: [0.05, 0.14, 0.1], pos: [x, 3.1, sz * 3.2], material: M.metalDark });
    }
    addCableRun(root, [-5.3, 3.12, 1.2], [5.3, 3.12, 1.2], { n: 3, sag: 0.07, radius: 0.012, material: M.cable, seed: 12 });
    addVent(root, { pos: [-0.2, 2.9, -3.49], w: 0.7, h: 0.22, frameMaterial: M.metalDark, slatMaterial: M.panelDark });
    addVent(root, { pos: [-0.2, 2.9, 3.49], rot: [0, PI, 0], w: 0.7, h: 0.22, frameMaterial: M.metalDark, slatMaterial: M.panelDark });
    addPlant(root, { pos: [4.75, 0, -3.0], size: 1.7, seed: 31, pot: 0x6b5a4a, M });
    addRail(root, [3.8, 1.1, -3.4], [5.25, 1.1, -3.4], { material: M.handrail, out: [0, 0, 1], depth: 0.07, standoffs: 3 });
    label(root, 'BİR ÖNCEKİ VARDİYA: TEMİZLİK', { pos: [4.5, 1.65, -3.49], height: 0.04, color: '#1a1a1a', bg: '#d8a21a' });
    label(root, 'MUTFAK · KİTAPLIK · DİNLENME', { pos: [2.9, 2.7, 3.49], rot: [0, PI, 0], height: 0.06, color: '#3a3a3a' });

    // ------------------------------------------------------------------
    // Ekranlar (yalnızca oyuncu yakınken güncellenir)
    // ------------------------------------------------------------------
    screenDriver(mctx, {
      hz: 4,
      draw: (t, powered) => {
        const scr = galley.screen;
        if (!powered) {
          drawNoPower(scr, 'ENERJİ YOK');
          return;
        }
        scr.material.emissiveIntensity = 1.1;
        scr.draw((g, w, h) => {
          const c = '#ffb347';
          const hh = draw2d.header(g, w, h, 'RASYON', c, 'GÜN 847');
          draw2d.text(g, 'KURU GIDA   %61', 8, hh + 8, 16, c);
          draw2d.bar(g, 8, hh + 28, w - 16, 10, 0.61, c);
          draw2d.text(g, 'SU          %78', 8, hh + 46, 16, c);
          draw2d.bar(g, 8, hh + 66, w - 16, 10, 0.78, c);
          draw2d.text(g, 'KAHVE       %34', 8, hh + 84, 16, c);
          draw2d.bar(g, 8, hh + 104, w - 16, 10, 0.34, c);
          if (Math.floor(t * 1.3) % 2 === 0) draw2d.text(g, '_', w - 14, hh + 84, 16, c);
        });
      },
    });

    root.userData.quarters = { watch, shelf, galley };
  },
};

// ---------------------------------------------------------------------------
// Ranza ünitesi (dış duvara yaslı, ön yüz +Z)
// ---------------------------------------------------------------------------
function buildBunk(root, M, C, { x, bags, name }) {
  const g = place(root, [x, 0, -3.02], 0, `bunk-${name}`);
  // dikmeler
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) addBox(g, { size: [0.05, 1.8, 0.05], pos: [sx * 1.0, 0.9, sz * 0.43], material: M.aluminium });
  }
  // üst ve alt döşekler
  for (const [y, bag, k] of [
    [0.36, bags[0], 0],
    [1.32, bags[1], 1],
  ]) {
    addBox(g, { size: [2.0, 0.05, 0.88], pos: [0, y, 0], material: M.metalDark });
    addBox(g, { size: [1.94, 0.11, 0.8], pos: [0, y + 0.08, 0], material: M.padding });
    // uyku tulumu: yarı açık, buruşuk
    const geo = colorize(new THREE.CapsuleGeometry(0.19, 1.22, 4, 12), bag);
    const sb = addMesh(g, geo, C.vcMatte, { pos: [0.1, y + 0.2, 0.02], rot: [0, 0.08 * (k ? -1 : 1), PI / 2], scale: [0.55, 1, 1.05] });
    if (k === 0) g.userData.bagLow = sb;
    vBox(g, { size: [1.15, 0.004, 0.012], color: 0x15181c, pos: [0.1, y + 0.295, 0.05], rot: [0, 0.08 * (k ? -1 : 1), 0] }); // fermuar
    vBox(g, { size: [0.36, 0.09, 0.27], color: 0xe9e6dc, matte: true, pos: [-0.78, y + 0.185, 0.0], rot: [0, 0.12, 0.04] }); // yastık
  }
  // üst ranza korkuluğu + merdiven
  addRod(g, [-0.98, 1.66, 0.43], [0.98, 1.66, 0.43], { radius: 0.014, material: M.handrail, segments: 6 });
  addRod(g, [-0.98, 1.78, 0.43], [0.98, 1.78, 0.43], { radius: 0.014, material: M.handrail, segments: 6 });
  for (const ladX of [0.55, 0.78]) addRod(g, [ladX, 0.05, 0.5], [ladX, 1.55, 0.5], { radius: 0.014, material: M.aluminium, segments: 6 });
  for (let i = 0; i < 5; i++) addRod(g, [0.55, 0.3 + i * 0.28, 0.5], [0.78, 0.3 + i * 0.28, 0.5], { radius: 0.01, material: M.aluminium, segments: 5 });
  // alt çekmeceler
  for (const dx of [-0.45, 0.2]) {
    addBox(g, { size: [0.6, 0.18, 0.03], pos: [dx, 0.18, 0.44], material: M.panelMid });
    addBox(g, { size: [0.16, 0.014, 0.02], pos: [dx, 0.23, 0.46], material: M.metalDark });
  }
  // baş ucu rafı + okuma lambası
  addBox(g, { size: [0.3, 0.025, 0.2], pos: [-0.8, 0.95, -0.32], material: M.metalDark });
  vBox(g, { size: [0.14, 0.2, 0.03], color: 0x5a3a2a, matte: true, pos: [-0.86, 1.075, -0.4] }); // kitap
  addBox(g, { size: [0.04, 0.025, 0.04], pos: [-0.62, 1.12, -0.36], material: C.indWhite });
  label(g, name, { pos: [0.0, 1.72, 0.455], height: 0.035, color: '#1a1a1a', bg: '#e8e2cf' });
  return g;
}

// ---------------------------------------------------------------------------
// Kol saati (masa üstünde)
// ---------------------------------------------------------------------------
function drawWatchFace(g, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  g.fillStyle = '#1a1d22';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#e8e2cf';
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const big = i % 5 === 0;
    const r1 = w * (big ? 0.38 : 0.43);
    g.fillRect(cx + Math.sin(a) * r1 - (big ? 3 : 1), cy - Math.cos(a) * r1 - (big ? 3 : 1), big ? 6 : 2, big ? 6 : 2);
  }
  g.font = 'bold 22px "DejaVu Sans", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const [n, a] of [
    ['12', 0],
    ['3', 90],
    ['6', 180],
    ['9', 270],
  ]) {
    const rr = w * 0.31;
    g.fillText(n, cx + Math.sin((a * Math.PI) / 180) * rr, cy - Math.cos((a * Math.PI) / 180) * rr);
  }
  g.font = '9px "DejaVu Sans", sans-serif';
  g.fillStyle = '#9fb4c8';
  g.fillText('AZİM', cx, cy - h * 0.14);
  g.textAlign = 'left';
}

function buildWatch(mctx, M, C, timers, table) {
  const wRoot = place(table, [-0.62, 0.77, -0.05], 0.55, 'watch');
  const flat = new THREE.Group();
  flat.rotation.x = -PI / 2;
  wRoot.add(flat);
  // kayış
  vBox(flat, { size: [0.03, 0.085, 0.004], color: 0x2b1d14, matte: true, pos: [0, 0.07, 0.0] });
  vBox(flat, { size: [0.03, 0.085, 0.004], color: 0x2b1d14, matte: true, pos: [0, -0.07, 0.0] });
  vBox(flat, { size: [0.032, 0.008, 0.006], color: 0xb9bcc0, pos: [0, -0.105, 0.002] });
  // kasa
  vCyl(flat, { radius: 0.033, height: 0.012, segments: 20, color: 0xb9bcc0, pos: [0, 0, 0.006], rot: [PI / 2, 0, 0] });
  addMesh(flat, new THREE.CircleGeometry(0.029, 24), pictureMaterial('watchface', drawWatchFace, 128, 128), { pos: [0, 0, 0.0125] });
  const hr = vBox(flat, { size: [0.003, 0.016, 0.001], color: 0xe8e2cf, pos: [0.004, 0.006, 0.0135], rot: [0, 0, -0.8] });
  const mn = vBox(flat, { size: [0.0025, 0.023, 0.001], color: 0xe8e2cf, pos: [-0.006, 0.008, 0.014], rot: [0, 0, 0.5] });
  void hr;
  void mn;
  // saniye ibresi: eksen grubu
  const pivot = new THREE.Group();
  pivot.position.set(0, 0, 0.0148);
  flat.add(pivot);
  vBox(pivot, { size: [0.0016, 0.027, 0.0008], color: 0xd23a22, pos: [0, 0.0085, 0] });
  vCyl(pivot, { radius: 0.0032, height: 0.002, segments: 8, color: 0xd23a22, rot: [PI / 2, 0, 0] });
  const proxy = addProxy(wRoot, { size: [0.13, 0.1, 0.2], pos: [0, 0.03, 0] });
  void proxy;

  // Mors: K A L → saniye ibresi ritmi
  const code = MORSE.letters.map((l) => dashDot(l.code));
  const U = 0.2;
  const timeline = []; // { on, off }
  let tcur = 0.4;
  code.forEach((cd, ci) => {
    [...cd].forEach((s, si) => {
      const len = s === '-' ? U * 3 : U;
      timeline.push({ on: tcur, off: tcur + len, dash: s === '-' });
      tcur += len + (si < cd.length - 1 ? U : 0);
    });
    tcur += ci < code.length - 1 ? U * 3 : 0;
  });
  const CYCLE = tcur + 1.6;
  const REPEATS = 2;

  const st = { mode: 'tick', t: 0, hand: 0, kick: 0, fired: 0, sec: -1 };
  mctx.onUpdate((dt, time) => {
    if (!mctx.playerInside() && st.mode === 'tick') return;
    if (st.mode === 'tick') {
      const s = Math.floor(time);
      if (s !== st.sec) {
        st.sec = s;
        st.hand = (s % 60) * (PI / 30);
      }
      pivot.rotation.z = -st.hand;
      return;
    }
    // Mors modu
    st.t += dt;
    const tc = st.t % CYCLE;
    const rep = Math.floor(st.t / CYCLE);
    if (rep >= REPEATS) {
      st.mode = 'tick';
      st.kick = 0;
      mctx.ui?.subtitle?.('SEN', 'Aynı kalıp, aynı sıra… Bir şey anlatmaya çalışıyor. Bunu aklımda tutacağım.', 5200);
      return;
    }
    let active = false;
    for (let i = 0; i < timeline.length; i++) {
      const e = timeline[i];
      if (tc >= e.on && tc < e.off) {
        active = true;
        const key = rep * 100 + i;
        if (key !== st.fired) {
          st.fired = key;
          sfx(mctx, e.dash ? 'click' : 'tick', { position: wRoot.getWorldPosition(new THREE.Vector3()) });
          if (e.dash) sfx(mctx, 'tick');
        }
      }
    }
    st.kick = THREE.MathUtils.damp(st.kick, active ? 0.62 : 0, 40, dt);
    pivot.rotation.z = -(st.hand + st.kick);
  });

  mctx.interactions.add(wRoot, {
    id: 'quarters-watch',
    prompt: () => (st.mode === 'morse' ? 'Kol saati — ibreyi izle' : 'Kol saatine bak'),
    distance: 2.9,
    onInteract: () => {
      if (st.mode === 'morse') return;
      st.mode = 'morse';
      st.t = 0;
      st.fired = -1;
      st.kick = 0;
      sfx(mctx, 'click');
      mctx.ui?.subtitle?.('SEN', 'Bir kol saati. Saniye ibresi düzgün ilerlemiyor: kısa, uzun, kısa… ritmik titriyor.', 5200);
    },
  });
  void timers;
  return { group: wRoot, state: st, cycle: CYCLE };
}

// ---------------------------------------------------------------------------
// Kitaplık: raftan çıkıp düşen kitapların bıraktığı boşluklar Mors "KAL" oluşturur
// ---------------------------------------------------------------------------
function buildBookshelf(mctx, M, C, timers, root) {
  const SH_X = -2.15;
  const g = place(root, [SH_X, 0, 3.34], PI, 'bookshelf');
  const W = 1.9;
  const H = 2.14;
  // gövde (arka panel açık renkli: eksik kitap boşlukları net okunsun)
  addBox(g, { size: [0.045, H, 0.32], pos: [-W / 2 + 0.0225, H / 2, 0], material: C.wood });
  addBox(g, { size: [0.045, H, 0.32], pos: [W / 2 - 0.0225, H / 2, 0], material: C.wood });
  addBox(g, { size: [W - 0.09, H - 0.06, 0.02], pos: [0, H / 2 + 0.02, -0.15], material: M.panelLight });
  const boards = [0.06, 0.46, 0.86, 1.26, 1.66, 2.1];
  for (const y of boards) addBox(g, { size: [W - 0.09, 0.03, 0.3], pos: [0, y, -0.005], material: C.wood });
  addBox(g, { size: [W, 0.06, 0.34], pos: [0, 0.03, 0.0], material: C.woodDark });
  addBox(g, { size: [W + 0.02, 0.03, 0.34], pos: [0, H + 0.02, 0.0], material: C.woodDark });
  label(g, 'KİTAPLIK', { pos: [0, 2.18, 0.175], height: 0.05, color: '#d8d2c2', bg: '#3a2a1c' });

  const r = rng(29);
  const rowTop = (i) => boards[i + 1] - 0.015;
  const rowBottom = (i) => boards[i] + 0.015;
  const BD = 0.22; // kitap derinliği
  const BZ = -0.03; // kitapların rafa göre z konumu (arkaya yakın)

  /** Statik rastgele kitaplar: [x0, x1] aralığı */
  const fillBooks = (row, x0, x1, { sparse = 0 } = {}) => {
    const y0 = rowBottom(row);
    const maxH = rowTop(row) - y0 - 0.03;
    let x = x0;
    const geoms = [];
    while (x < x1 - 0.03) {
      const w = 0.03 + r() * 0.03;
      if (x + w > x1) break;
      if (sparse && r() < sparse) {
        x += w;
        continue;
      }
      const h = maxH * (0.72 + r() * 0.28);
      const tilt = r() < 0.05 ? (r() - 0.5) * 0.35 : 0;
      const geo = bookGeometry(w - 0.002, h, BD, BOOK_COLORS[Math.floor(r() * BOOK_COLORS.length)]);
      geo.translate(0, h / 2, 0);
      if (tilt) geo.rotateZ(tilt);
      geo.translate(x + w / 2, y0, BZ);
      geoms.push(geo);
      x += w;
    }
    if (geoms.length) addMesh(g, mergeGeometries(geoms), C.vcMatte);
  };

  // Alt iki raf: dekoratif (kutular, ciltler, küçük maket)
  fillBooks(0, -0.88, 0.2, { sparse: 0.15 });
  vBox(g, { size: [0.3, 0.26, 0.24], color: 0x8a7a5a, matte: true, pos: [0.4, 0.2, -0.02] });
  vBox(g, { size: [0.28, 0.22, 0.22], color: 0x5a6a7a, matte: true, pos: [0.72, 0.18, -0.02] });
  label(g, 'EVRAK', { pos: [0.4, 0.2, 0.1], height: 0.03, color: '#222', bg: '#e8e2cf' });
  fillBooks(1, -0.88, 0.55);
  const mdl = place(g, [0.74, 0.5, 0.0]);
  addMesh(mdl, new THREE.TorusGeometry(0.1, 0.012, 6, 28), M.aluminium, { pos: [0, 0.12, 0], rot: [0.25, 0.2, 0] });
  vBox(mdl, { size: [0.03, 0.03, 0.05], color: 0xc8962e, pos: [0, 0.12, 0] });
  vBox(mdl, { size: [0.14, 0.012, 0.1], color: 0x2a2c30, pos: [0, 0.006, 0] });

  // Mors satırları: üstten alta K, A, L. Dışarı çıkan kitaplar RAFTA BOŞLUK bırakır:
  // 3 kitaplık boşluk = uzun (−), tek kitaplık boşluk = kısa (·).
  const rows = [
    { row: 4, ch: 'K', code: dashDot(MORSE.letters[0].code) },
    { row: 3, ch: 'A', code: dashDot(MORSE.letters[1].code) },
    { row: 2, ch: 'L', code: dashDot(MORSE.letters[2].code) },
  ];
  const sx = -0.5;
  const units = []; // dışarı itilip düşen kitap grupları (dinamik)
  const makeUnit = (geoms, { kind, ch, cx, y0, n, h, row }) => {
    const mesh = addMesh(g, mergeGeometries(geoms), C.vcMatte, { dynamic: true, pos: [cx, y0, BZ] });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `book-${ch}-${kind}`;
    const u = { mesh, kind, ch, row, cx, y0, n, h, state: 'idle', t: 0, v: new THREE.Vector3(), yaw: (r() - 0.5) * 1.3, T: 0.5, rest: (n * SLOT - 0.003) / 2 };
    units.push(u);
    return u;
  };
  for (const rw of rows) {
    const y0 = rowBottom(rw.row);
    const maxH = rowTop(rw.row) - y0 - 0.03;
    const plan = [];
    let slot = 0;
    [...rw.code].forEach((s, i) => {
      const n = s === '-' ? 3 : 1;
      plan.push({ kind: s === '-' ? 'dash' : 'dot', slot, n });
      slot += n;
      if (i < rw.code.length - 1) slot += 1; // semboller arası: yerinde kalan 1 kitap
    });
    const total = slot;
    const gapGeoms = [];
    for (let s = 0; s < total; s++) {
      if (plan.some((p) => s >= p.slot && s < p.slot + p.n)) continue;
      const h = maxH * (0.8 + r() * 0.2);
      const geo = bookGeometry(SLOT - 0.003, h, BD, BOOK_COLORS[Math.floor(r() * BOOK_COLORS.length)]);
      geo.translate(sx + (s + 0.5) * SLOT, y0 + h / 2, BZ);
      gapGeoms.push(geo);
    }
    if (gapGeoms.length) addMesh(g, mergeGeometries(gapGeoms), C.vcMatte);
    fillBooks(rw.row, -0.88, sx);
    fillBooks(rw.row, sx + total * SLOT, 0.68);
    for (const p of plan) {
      const geoms = [];
      let hMax = 0;
      for (let k = 0; k < p.n; k++) {
        const h = maxH * (0.86 + r() * 0.12);
        hMax = Math.max(hMax, h);
        const geo = bookGeometry(SLOT - 0.003, h, BD, BOOK_COLORS[Math.floor(r() * BOOK_COLORS.length)]);
        geo.translate((k - (p.n - 1) / 2) * SLOT, h / 2, 0);
        geoms.push(geo);
      }
      makeUnit(geoms, { kind: p.kind, ch: rw.ch, cx: sx + (p.slot + p.n / 2) * SLOT, y0, n: p.n, h: hMax, row: rw.row });
    }
  }
  // Rastgele düşen 3 "sahte" kitap (raf uçlarında): Mors'un parçası değil
  [
    [4, 0.74],
    [3, 0.78],
    [2, 0.745],
  ].forEach(([row, x], i) => {
    const y0 = rowBottom(row);
    const h = (rowTop(row) - y0 - 0.03) * 0.92;
    const geo = bookGeometry(SLOT - 0.003, h, BD, BOOK_COLORS[(i * 5 + 2) % BOOK_COLORS.length]);
    geo.translate(0, h / 2, 0);
    makeUnit([geo], { kind: 'decoy', ch: '-', cx: x, y0, n: 1, h, row });
  });
  for (const row of [2, 3, 4]) fillBooks(row, 0.82, 0.88);

  const proxy = addProxy(g, { size: [W, H, 0.5], pos: [0, H / 2, 0.2] });

  const sh = { mode: 'idle', t: 0, events: [], decoded: false, units, group: g };
  const SLIDE = 0.3;
  const OUT = 0.1;

  const decodeLines = [
    'KİTAPLIK — EKSİK KİTAP DİZİLİMİ',
    '────────────────────────────────────────',
    'Raflardan çıkan kitaplar boşluk bıraktı:',
    '  3 kitaplık boşluk  = uzun   (−)',
    '  1 kitaplık boşluk  = kısa   (·)',
    '',
    `  Raf 3 (üst)  ▬ ▪ ▬        ${MORSE.letters[0].code}    →  ${MORSE.letters[0].ch}`,
    `  Raf 2 (orta) ▪ ▬          ${MORSE.letters[1].code}     →  ${MORSE.letters[1].ch}`,
    `  Raf 1 (alt)  ▪ ▬ ▪ ▪      ${MORSE.letters[2].code}   →  ${MORSE.letters[2].ch}`,
    '',
    `ÇÖZÜM: ${MORSE.letters.map((l) => l.ch).join(' · ')}   →   "${MORSE.word}"`,
    '',
    'Bu kayıt kitapların sırasına gömülmüş.',
    'Birisi — ya da bir şey — buraya bir mesaj bırakmış.',
  ];

  const unitPos = (u) => g.localToWorld(new THREE.Vector3(u.cx, u.y0 + 0.15, 0.2));
  const schedule = () => {
    const ev = [];
    const order = units.filter((u) => u.kind !== 'decoy');
    const decoys = units.filter((u) => u.kind === 'decoy');
    let t = 0.2;
    order.forEach((u, i) => {
      ev.push({
        t,
        fn: () => {
          u.state = 'slide';
          u.t = 0;
          sfx(mctx, u.kind === 'dash' ? 'switch' : 'click', { position: unitPos(u) });
        },
      });
      const nxt = order[i + 1];
      t += nxt && nxt.ch !== u.ch ? 1.2 : 0.6;
    });
    [1.1, 3.8, 5.3].forEach((tt, i) =>
      ev.push({
        t: tt,
        fn: () => {
          decoys[i].state = 'slide';
          decoys[i].t = 0;
          sfx(mctx, 'click', { position: unitPos(decoys[i]) });
        },
      }),
    );
    ev.sort((a, b) => a.t - b.t);
    const end = t + 1.2;
    ev.push({
      t: end,
      fn: () => {
        sh.mode = 'revealed';
        mctx.ui?.subtitle?.('SEN', 'Raflarda boşluklar… 3 kitap, 1 kitap, 3 kitap. Bu rastgele değil: uzun, kısa, uzun. Bir Mors.', 4600);
      },
    });
    ev.push({
      t: end + 4.8,
      fn: () => {
        sh.decoded = true;
        mctx.ui?.subtitle?.('SEN', 'Üst raf −·−, ortası ·−, altı ·−··  …  K, A, L.', 4200);
        sfx(mctx, 'success');
        mctx.state.set('found_morse', true);
      },
    });
    ev.push({
      t: end + 9.2,
      fn: () => mctx.ui?.subtitle?.('SEN', '"KAL." Bunu buraya kim bıraktı… ve neden bana?', 5200),
    });
    return ev;
  };

  const GRAV = 9.81;
  mctx.onUpdate((dt) => {
    if (sh.mode === 'playing' || (sh.events.length && sh.mode === 'revealed')) {
      sh.t += dt;
      while (sh.events.length && sh.events[0].t <= sh.t) sh.events.shift().fn();
    }
    for (const u of units) {
      if (u.state === 'idle' || u.state === 'landed') continue;
      const m = u.mesh;
      if (u.state === 'slide') {
        u.t += dt;
        const e = Math.min(1, u.t / SLIDE);
        m.position.z = BZ + OUT * (e * e * (3 - 2 * e));
        if (e >= 1) {
          u.state = 'fall';
          u.t = 0;
          u.v.set((r() - 0.5) * 0.1, 0, 0.35 + r() * 0.25);
          const fall = u.y0 - u.rest;
          u.T = Math.sqrt((2 * Math.max(0.05, fall)) / GRAV);
        }
      } else {
        u.t += dt;
        u.v.y -= GRAV * dt;
        m.position.x += u.v.x * dt;
        m.position.y += u.v.y * dt;
        m.position.z += u.v.z * dt;
        const p = Math.min(1, u.t / u.T);
        m.rotation.set(Math.sin(p * PI) * 0.45, u.yaw * p, p * (PI / 2));
        if (m.position.y <= u.rest && u.v.y < 0) {
          m.position.y = u.rest;
          m.rotation.set(0, u.yaw, PI / 2);
          m.position.x += u.h * 0.35;
          u.state = 'landed';
          sfx(mctx, 'switch', { position: g.localToWorld(new THREE.Vector3(m.position.x, 0.05, m.position.z)), volume: 0.6 });
        }
      }
    }
  });

  mctx.interactions.add(proxy, {
    id: 'quarters-bookshelf',
    prompt: () => {
      if (sh.mode === 'playing') return '';
      return sh.mode === 'revealed' ? 'Mors dizilimini çöz' : 'Kitaplığı incele';
    },
    distance: 3.0,
    enabled: () => sh.mode !== 'playing',
    onInteract: () => {
      if (sh.mode === 'idle') {
        sh.mode = 'playing';
        sh.t = 0;
        sh.events = schedule();
        sfx(mctx, 'servo', { position: g.localToWorld(new THREE.Vector3(0, 1.2, 0.3)) });
        mctx.ui?.subtitle?.('SEN', 'Kitaplık… Raflardan kitaplar kendiliğinden kayıp düşüyor!', 3600);
        return;
      }
      // çözüm terminali
      sfx(mctx, 'terminal');
      openTerminal(mctx, {
        title: 'MORS ÇÖZÜMÜ',
        color: 'amber',
        lines: decodeLines,
        options: [{ label: 'Kapat', action: () => {} }],
      });
      if (!mctx.state.is('found_morse')) {
        mctx.state.set('found_morse', true);
        sh.decoded = true;
      }
    },
  });
  void timers;
  return sh;
}

// ---------------------------------------------------------------------------
// Mutfak köşesi (iç duvar): tezgâh, kahve makinesi, ısıtıcı, üst dolaplar, buzdolabı
// ---------------------------------------------------------------------------
function buildGalley(mctx, M, C, timers, root) {
  const CX = 2.9;
  const LEN = 3.2;
  const g = place(root, [CX, 0, 3.2], PI, 'galley');
  const lx = (xw) => -(xw - CX); // dünya x → yerel x
  // alt dolaplar
  addBox(g, { size: [LEN, 0.84, 0.6], pos: [0, 0.46, 0], material: M.panelMid });
  vBox(g, { size: [LEN, 0.06, 0.6], color: 0x1b1c1e, pos: [0, 0.03, 0.0] });
  addBox(g, { size: [LEN + 0.04, 0.04, 0.64], pos: [0, 0.9, 0.02], material: M.aluminium });
  for (let i = 0; i < 6; i++) {
    const x = -LEN / 2 + 0.27 + i * (LEN - 0.54) / 5;
    addBox(g, { size: [0.49, 0.74, 0.016], pos: [x, 0.47, 0.305], material: M.panelLight });
    addBox(g, { size: [0.14, 0.014, 0.02], pos: [x, 0.78, 0.322], material: M.metalDark });
  }
  g.userData.collide = true;
  // lavabo
  addBox(g, { size: [0.5, 0.012, 0.4], pos: [lx(1.75), 0.918, 0.05], material: M.panelDark });
  addRod(g, [lx(1.75), 0.92, -0.2], [lx(1.75), 1.12, -0.2], { radius: 0.012, material: M.metal, segments: 6 });
  addRod(g, [lx(1.75), 1.12, -0.2], [lx(1.75), 1.12, -0.05], { radius: 0.012, material: M.metal, segments: 6 });
  // sırt paneli
  addBox(g, { size: [LEN, 0.62, 0.025], pos: [0, 1.22, -0.29], material: M.panelDark });
  const hang = [-1.2, -0.95, -0.7].map((x, i) => {
    vCyl(g, { radius: 0.006, height: 0.012, segments: 6, color: 0x9a9a96, pos: [x, 1.42, -0.27], rot: [PI / 2, 0, 0] });
    vBox(g, { size: [0.02, 0.14 + i * 0.03, 0.01], color: 0xb9bcc0, pos: [x, 1.32 - i * 0.015, -0.26] });
    return x;
  });
  void hang;
  // üst dolaplar
  addBox(g, { size: [LEN, 0.74, 0.34], pos: [0, 1.95, -0.13], material: M.panelMid });
  const upLabels = ['KURU GIDA', 'SU / İÇECEK', 'KONSERVE', 'ÇAY · KAHVE'];
  for (let i = 0; i < 4; i++) {
    const x = -LEN / 2 + 0.4 + i * (LEN - 0.8) / 3;
    addBox(g, { size: [0.74, 0.68, 0.016], pos: [x, 1.95, 0.05], material: M.panelLight });
    addBox(g, { size: [0.014, 0.12, 0.02], pos: [x + 0.3, 1.64, 0.068], material: M.metalDark });
    label(g, upLabels[i], { pos: [x, 2.18, 0.062], height: 0.032, color: '#1c1c1c', bg: '#e8e2cf' });
  }
  // ısıtıcı (mikrodalga benzeri)
  const heater = place(g, [lx(3.85), 0.92, 0.0]);
  vBox(heater, { size: [0.5, 0.3, 0.38], color: 0x8e9094, pos: [0, 0.15, 0] });
  addBox(heater, { size: [0.3, 0.2, 0.008], pos: [-0.06, 0.15, 0.194], material: M.glass });
  vBox(heater, { size: [0.3, 0.2, 0.004], color: 0x0c0f12, pos: [-0.06, 0.15, 0.19] });
  vBox(heater, { size: [0.1, 0.24, 0.006], color: 0x2a2c30, pos: [0.19, 0.15, 0.19] });
  addBox(heater, { size: [0.06, 0.02, 0.006], pos: [0.19, 0.21, 0.195], material: C.indAmber });
  addBox(heater, { size: [0.03, 0.03, 0.01], pos: [0.19, 0.12, 0.195], material: M.metalDark });
  label(heater, 'YEMEK ISITICI', { pos: [0.19, 0.06, 0.196], height: 0.018, color: '#e8e2d0' });
  // ekran
  const screen = addScreen(g, { pos: [lx(2.3), 1.24, -0.27], w: 0.4, h: 0.26, res: [320, 208], color: '#ffb347', depth: 0.03 });
  // kahve makinesi (etkileşimli)
  const coffee = buildCoffee(mctx, M, C, timers, g, lx(3.05));
  // buzdolabı
  const fr = place(root, [4.95, 0, 3.17], PI, 'fridge');
  addBox(fr, { size: [0.7, 1.9, 0.62], pos: [0, 0.95, 0], material: M.plasticWhite });
  addBox(fr, { size: [0.68, 0.9, 0.016], pos: [0, 0.5, 0.315], material: M.panelLight });
  addBox(fr, { size: [0.68, 0.9, 0.016], pos: [0, 1.45, 0.315], material: M.panelLight });
  addBox(fr, { size: [0.025, 0.5, 0.03], pos: [-0.28, 0.9, 0.34], material: M.metal });
  addBox(fr, { size: [0.025, 0.4, 0.03], pos: [-0.28, 1.5, 0.34], material: M.metal });
  label(fr, 'SOĞUK DEPO · 4 °C', { pos: [0.04, 1.8, 0.325], height: 0.032, color: '#1c1c1c', bg: '#e8e2cf' });
  addBox(fr, { size: [0.03, 0.03, 0.01], pos: [0.28, 1.72, 0.325], material: C.indGreen });
  fr.userData.collide = true;
  label(root, 'MUTFAK', { pos: [1.5, 2.45, 3.49], rot: [0, PI, 0], height: 0.07, color: '#3a3a3a' });
  return { group: g, screen, coffee };
}

function buildCoffee(mctx, M, C, timers, galleyGroup, lxPos) {
  const g = place(galleyGroup, [lxPos, 0.92, 0.04], 0, 'coffee');
  vBox(g, { size: [0.32, 0.44, 0.3], color: 0x2a2c30, pos: [0, 0.22, -0.04] });
  vBox(g, { size: [0.28, 0.14, 0.24], color: 0xb9bcc0, pos: [0, 0.5, -0.06] }); // su haznesi
  vBox(g, { size: [0.3, 0.06, 0.12], color: 0x1a1c1f, pos: [0, 0.34, 0.1] }); // demleme başlığı
  vCyl(g, { radius: 0.012, height: 0.04, segments: 8, color: 0xb9bcc0, pos: [0, 0.3, 0.13] }); // lüle
  vBox(g, { size: [0.3, 0.02, 0.14], color: 0x15171a, pos: [0, 0.02, 0.1] }); // damlama tepsisi
  vBox(g, { size: [0.28, 0.004, 0.12], color: 0x6a6c70, pos: [0, 0.032, 0.1] });
  // gösterge + düğmeler
  addBox(g, { size: [0.08, 0.035, 0.004], pos: [-0.08, 0.42, 0.112], material: C.indAmber });
  addBox(g, { size: [0.02, 0.02, 0.01], pos: [0.06, 0.42, 0.114], material: C.indGreen });
  for (let i = 0; i < 3; i++) vCyl(g, { radius: 0.012, height: 0.01, segments: 8, color: 0xd8d4c8, pos: [-0.08 + i * 0.05, 0.37, 0.114], rot: [PI / 2, 0, 0] });
  label(g, 'KAHVE', { pos: [0, 0.455, 0.113], height: 0.02, color: '#e8e2d0' });
  // kupa + kahve
  const mug = place(g, [0, 0.032, 0.1]);
  vCyl(mug, { radius: 0.038, height: 0.085, segments: 14, color: 0xe9e6dc, pos: [0, 0.0425, 0] });
  const handle = vBox(mug, { size: [0.025, 0.05, 0.008], color: 0xe9e6dc, pos: [0.05, 0.045, 0] });
  void handle;
  const liquid = vCyl(mug, { radius: 0.034, height: 0.07, segments: 14, color: 0x2b1a10, pos: [0, 0.04, 0] });
  liquid.userData.dynamic = true;
  liquid.scale.y = 0.001;
  liquid.position.y = 0.005;
  // buhar: üç yumuşak düzlem
  const steam = [];
  const steamMat = new THREE.MeshBasicMaterial({ color: 0xe8e8ee, transparent: true, opacity: 0, depthWrite: false });
  steamMat.name = 'crewSteam';
  for (let i = 0; i < 3; i++) {
    const s = addMesh(mug, new THREE.PlaneGeometry(0.04, 0.09), steamMat, { dynamic: true, pos: [(i - 1) * 0.012, 0.12, 0] });
    s.userData.noShadow = true;
    steam.push(s);
  }
  const proxy = addProxy(g, { size: [0.4, 0.62, 0.42], pos: [0, 0.3, 0.02] });
  void proxy;

  const st = { phase: 'idle', t: 0, fill: 0 };
  const worldPos = () => g.getWorldPosition(new THREE.Vector3());
  mctx.onUpdate((dt, time) => {
    if (st.phase === 'idle') return;
    st.t += dt;
    if (st.phase === 'brewing') {
      st.fill = Math.min(1, Math.max(0, (st.t - 0.9) / 2.2));
      liquid.scale.y = Math.max(0.001, st.fill);
      liquid.position.y = 0.005 + 0.035 * st.fill;
      if (st.t > 3.2) {
        st.phase = 'ready';
        st.t = 0;
        sfx(mctx, 'beep', { position: worldPos() });
        mctx.ui?.toast?.('Kahve hazır.', 3200);
      }
    }
    if (st.phase === 'ready' || st.phase === 'brewing') {
      const on = st.phase === 'ready' ? Math.max(0, 1 - st.t / 12) : st.fill;
      steamMat.opacity = on * 0.22;
      steam.forEach((s, i) => {
        const ph = (time * 0.5 + i * 0.33) % 1;
        s.position.y = 0.1 + ph * 0.16;
        s.position.x = (i - 1) * 0.014 + Math.sin(time * 2 + i) * 0.006;
        s.scale.setScalar(0.7 + ph * 0.8);
        s.rotation.y = Math.sin(time + i) * 0.5;
      });
      // buhar düzlemlerini oyuncuya çevir
      const cam = mctx.camera.position;
      steam.forEach((s) => {
        const wp = s.getWorldPosition(new THREE.Vector3());
        s.lookAt(cam.x, wp.y, cam.z);
      });
    } else steamMat.opacity = 0;
  });

  mctx.interactions.add(g, {
    id: 'quarters-coffee',
    prompt: () => (st.phase === 'ready' ? 'Kahveyi al' : st.phase === 'brewing' ? '' : 'Kahve yap'),
    distance: 2.6,
    enabled: () => st.phase !== 'brewing',
    onInteract: () => {
      if (st.phase === 'ready') {
        st.phase = 'idle';
        liquid.scale.y = 0.001;
        steamMat.opacity = 0;
        sfx(mctx, 'click', { position: worldPos() });
        mctx.ui?.subtitle?.('SEN', 'Sıcak, acı, tam kıvamında. Yıllar sonra ilk gerçek kahve.', 4200);
        return;
      }
      if (!mctx.state.is('power_restored')) {
        sfx(mctx, 'error', { position: worldPos() });
        mctx.ui?.toast?.('ENERJİ YOK — kahve makinesi soğuk.', 2800);
        return;
      }
      st.phase = 'brewing';
      st.t = 0;
      st.fill = 0;
      sfx(mctx, 'servo', { position: worldPos(), duration: 1.0 });
      sfx(mctx, 'hiss', { position: worldPos(), volume: 0.5, duration: 1.8 });
      mctx.ui?.toast?.('Demleniyor…', 1800);
    },
  });
  void timers;
  return st;
}
