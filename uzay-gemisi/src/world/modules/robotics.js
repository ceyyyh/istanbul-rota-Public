import * as THREE from 'three';
import { buildShell } from '../structure/shell.js';
import { addBox, addCylinder, addMesh, addSphere, mergeStatic } from '../utils.js';
import { getTechMaterials, tiledPlane } from './tech/materials.js';
import { addLabel } from './tech/labels.js';
import { addRod, addBench, addCableBundle, addScreen, drawNoPower, screenOn, nearChecker, finalizeDynamic, addHazard, addVent, addShelf, addFloorHazard, addOpenRack, applyMetricUVs } from './tech/kit.js';

/**
 * Robotik Atölye (modül 7).
 *
 * Dış duvar: sökülmüş robot segmentiyle iş tezgâhı + eklem testi ekranı, boşta salınan endüstriyel
 *            robot kol RK-2 (etkileşim: demo hareketi), köşede 3B yazıcı.
 * İç duvar:  şarj istasyonunda uyuyan yedek monolit robot PİRİ, alet duvarı + takım arabası, parça rafı.
 */

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export default {
  id: 'robotics',
  name: 'Robotik Atölye',
  build(mctx) {
    const M = mctx.materials;
    const T = getTechMaterials();
    const g = mctx.group;
    const { state, audio, ui } = mctx;
    const near = nearChecker(mctx, 12);

    buildShell(mctx, {
      wall: 'light',
      floor: 'panel',
      accent: 0xd2602a,
      outerWindows: [{ x: 2.4, w: 1.4, y: 1.1, h: 1.0 }],
      lights: 3,
    });
    // tezgâh lambası (büyüteçli lamba)
    mctx.addLight([-3.4, 1.55, -2.7], { color: 0xffe2b0, intensity: 2.2, distance: 3.2, emergency: { color: 0xffb070, intensity: 0.7 } });

    const chargeMat = new THREE.MeshStandardMaterial({ color: 0x1a0d00, emissive: 0xffa030, emissiveIntensity: 1.2, roughness: 0.4 });
    chargeMat.name = 'robotics.charge';
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x050505, emissive: 0xff8a20, emissiveIntensity: 0.15, roughness: 0.1, metalness: 0.2 });
    eyeMat.name = 'robotics.eye';
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0x222018, emissive: 0xffe2b0, emissiveIntensity: 1.6, roughness: 0.4 });
    bulbMat.name = 'robotics.bulb';
    mctx.addEmissive(bulbMat, { normal: { color: 0xffe2b0, intensity: 1.8 }, emergency: { color: 0xffb070, intensity: 0.6 } });

    // ------------------------------------------------------------------
    // İş tezgâhı + sökülmüş robot segmenti
    // ------------------------------------------------------------------
    addBench(g, M, { x: -3.0, z: -3.08, w: 3.6, d: 0.8, top: T.steelBrushed });
    {
      const sx = -3.3;
      const sy = 0.92;
      const sz = -3.05;
      // yatırılmış segment: gövde + açık kapak
      addBox(g, { size: [1.45, 0.12, 0.42], pos: [sx, sy + 0.08, sz], material: M.aluminium });
      addBox(g, { size: [1.45, 0.03, 0.42], pos: [sx, sy + 0.235, sz - 0.0], material: M.aluminium });
      for (const k of [-1, 1]) addBox(g, { size: [1.45, 0.14, 0.02], pos: [sx, sy + 0.16, sz + k * 0.2], material: M.aluminium });
      // iç: devre kartları, servolar, kablolar
      for (let i = 0; i < 4; i++) addBox(g, { size: [0.22, 0.012, 0.3], pos: [sx - 0.5 + i * 0.3, sy + 0.15, sz], material: T.pcb });
      for (let i = 0; i < 3; i++) addCylinder(g, { radius: 0.04, height: 0.1, segments: 10, pos: [sx - 0.35 + i * 0.35, sy + 0.2, sz + 0.07], rot: [Math.PI / 2, 0, 0], material: M.metalDark });
      addCableBundle(g, [sx - 0.6, sy + 0.2, sz - 0.08], [sx + 0.6, sy + 0.2, sz - 0.08], { sag: -0.05, count: 3, radius: 0.007, spread: 0.02 });
      // çıkarılmış üst kapak duvara yaslı
      const lid = addBox(g, { size: [1.4, 0.4, 0.02], pos: [sx, sy + 0.32, -3.43], material: M.aluminium });
      lid.rotation.x = -0.25;
      addLabel(g, 'TARS-Y SEG.3 — SÖKÜLDÜ', { pos: [sx, sy + 0.3, -3.405], rot: [-0.25, 0, 0], height: 0.04, style: 'stencil' });
      // ayrılmış menteşe/eklem
      addCylinder(g, { radius: 0.06, height: 0.22, segments: 12, pos: [-2.15, sy + 0.06, -2.85], rot: [0, 0, Math.PI / 2], material: M.metal });
      addBox(g, { size: [0.08, 0.14, 0.16], pos: [-2.3, sy + 0.07, -2.85], material: M.metalDark });
      addBox(g, { size: [0.08, 0.14, 0.16], pos: [-2.0, sy + 0.07, -2.85], material: M.metalDark });
      // aletler: tornavida, anahtar, vida tepsisi
      addCylinder(g, { radius: 0.005, height: 0.16, segments: 6, pos: [-2.6, sy + 0.012, -2.78], rot: [0, 0.4, Math.PI / 2], material: M.metal });
      addCylinder(g, { radius: 0.014, height: 0.09, segments: 6, pos: [-2.72, sy + 0.015, -2.73], rot: [0, 0.4, Math.PI / 2], material: T.toolRed });
      addBox(g, { size: [0.22, 0.008, 0.03], pos: [-4.3, sy + 0.005, -2.8], rot: [0, -0.3, 0], material: M.metal });
      addBox(g, { size: [0.2, 0.025, 0.14], pos: [-4.45, sy + 0.012, -3.15], material: M.plasticDark });
      // büyüteçli lamba (eklemli kol)
      addCylinder(g, { radius: 0.06, height: 0.03, segments: 10, pos: [-3.9, sy + 0.015, -3.3], material: M.metalDark });
      addRod(g, [-3.9, sy + 0.03, -3.3], [-3.75, sy + 0.45, -3.2], { radius: 0.01, material: M.metalDark, segments: 6 });
      addRod(g, [-3.75, sy + 0.45, -3.2], [-3.45, sy + 0.55, -2.85], { radius: 0.01, material: M.metalDark, segments: 6 });
      addCylinder(g, { radiusTop: 0.06, radiusBottom: 0.1, height: 0.07, segments: 14, pos: [-3.42, sy + 0.52, -2.82], material: M.plasticWhite });
      addCylinder(g, { radius: 0.085, height: 0.01, segments: 14, pos: [-3.42, sy + 0.48, -2.82], material: bulbMat });
    }
    // Eklem testi ekranı (duvarda)
    const diag = addScreen(g, M, { size: [0.7, 0.42], pos: [-1.95, 1.62, -3.46], res: [512, 300], color: '#62ff9a' });
    addVent(g, M, { pos: [-4.62, 1.75, -3.49], w: 0.45, h: 0.4 });

    // ------------------------------------------------------------------
    // Robot kol RK-2
    // ------------------------------------------------------------------
    const AX = 0.55;
    const AZ = -2.55;
    addCylinder(g, { radius: 0.34, height: 0.1, segments: 20, pos: [AX, 0.05, AZ], material: M.metalDark, collide: true, name: 'robot-kol-taban' });
    addCylinder(g, { radius: 0.2, height: 0.34, segments: 16, pos: [AX, 0.27, AZ], material: T.graphite });
    {
      const ring = new THREE.RingGeometry(0.95, 1.05, 24, 1, Math.PI * 0.95, Math.PI * 1.1);
      const uv = ring.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 7, uv.getY(i) * 7);
      addMesh(g, ring, T.hazard, { pos: [AX, 0.006, AZ], rot: [-Math.PI / 2, 0, 0] });
    }
    addLabel(g, 'RK-2  ÇALIŞMA ALANINA GİRMEYİN', { pos: [AX, 0.0065, AZ + 1.18], rot: [-Math.PI / 2, 0, 0], height: 0.07, style: 'yellow' });
    const turret = new THREE.Group();
    turret.name = 'robot-kol';
    turret.position.set(AX, 0.44, AZ);
    g.add(turret);
    addCylinder(turret, { radius: 0.19, height: 0.1, segments: 16, material: M.accentOrange });
    addBox(turret, { size: [0.24, 0.22, 0.2], pos: [0, 0.15, 0], material: M.accentOrange });
    const shoulder = new THREE.Group();
    shoulder.position.set(0, 0.27, 0);
    turret.add(shoulder);
    addCylinder(shoulder, { radius: 0.09, height: 0.26, segments: 14, rot: [Math.PI / 2, 0, 0], material: T.graphite });
    addBox(shoulder, { size: [0.13, 0.55, 0.13], pos: [0, 0.29, 0], material: M.accentOrange });
    addLabel(shoulder, 'RK-2', { pos: [0, 0.3, 0.0665], height: 0.05, style: 'stencil' });
    const elbow = new THREE.Group();
    elbow.position.set(0, 0.56, 0);
    shoulder.add(elbow);
    addCylinder(elbow, { radius: 0.075, height: 0.2, segments: 12, rot: [Math.PI / 2, 0, 0], material: T.graphite });
    addBox(elbow, { size: [0.095, 0.45, 0.095], pos: [0, 0.23, 0], material: M.accentOrange });
    addCableBundle(shoulder, [0.07, 0.1, 0], [0.06, 0.62, 0.05], { sag: -0.06, count: 1, radius: 0.012 });
    const wrist = new THREE.Group();
    wrist.position.set(0, 0.46, 0);
    elbow.add(wrist);
    addCylinder(wrist, { radius: 0.05, height: 0.14, segments: 10, rot: [Math.PI / 2, 0, 0], material: T.graphite });
    const roll = new THREE.Group();
    roll.position.set(0, 0.05, 0);
    wrist.add(roll);
    addCylinder(roll, { radius: 0.045, height: 0.08, segments: 10, pos: [0, 0.04, 0], material: M.metal });
    addBox(roll, { size: [0.15, 0.03, 0.05], pos: [0, 0.095, 0], material: M.metalDark });
    const finger1 = addBox(roll, { size: [0.02, 0.1, 0.04], pos: [-0.04, 0.155, 0], material: M.metal, dynamic: true });
    const finger2 = addBox(roll, { size: [0.02, 0.1, 0.04], pos: [0.04, 0.155, 0], material: M.metal, dynamic: true });
    for (const grp of [roll, wrist, elbow, shoulder]) grp.userData.dynamic = true;
    for (const grp of [roll, wrist, elbow, shoulder, turret]) finalizeDynamic(grp);

    const REST = { yaw: -1.2, sh: 0.35, el: 1.05, wr: 0.55, ro: 0, gr: 0.6 };
    const LIMP = { yaw: -1.2, sh: 0.75, el: 1.7, wr: 1.2, ro: 0, gr: 0.2 };
    const DEMO = [
      { d: 0.9, yaw: -0.5, sh: 0.05, el: 0.55, wr: 0.15, ro: 0, gr: 1 },
      { d: 1.0, yaw: -2.1, sh: 0.6, el: 1.35, wr: 0.85, ro: 0, gr: 0.0 },
      { d: 0.8, yaw: -2.1, sh: 0.5, el: 1.2, wr: 0.6, ro: Math.PI, gr: 1 },
      { d: 0.9, yaw: -1.2, sh: -0.15, el: 0.3, wr: -0.25, ro: Math.PI, gr: 0.3 },
      { d: 0.5, yaw: -1.0, sh: -0.15, el: 0.3, wr: 0.25, ro: Math.PI, gr: 0.3 },
      { d: 0.5, yaw: -1.4, sh: -0.15, el: 0.3, wr: -0.25, ro: Math.PI, gr: 0.3 },
      { d: 1.1, ...REST },
    ];
    const pose = { ...(state.is('power_restored') ? REST : LIMP) };
    let from = { ...pose };
    let demoIdx = -1;
    let demoT = 0;
    let wakeT = 0;
    const applyPose = (p, t) => {
      const idle = demoIdx < 0 && state.is('power_restored') ? 1 : 0;
      turret.rotation.y = p.yaw + idle * Math.sin(t * 0.4) * 0.12;
      shoulder.rotation.z = p.sh + idle * Math.sin(t * 0.55 + 1) * 0.05;
      elbow.rotation.z = p.el + idle * Math.sin(t * 0.5 + 2) * 0.06;
      wrist.rotation.z = p.wr + idle * Math.sin(t * 0.7) * 0.08;
      roll.rotation.y = p.ro;
      finger1.position.x = -0.02 - 0.03 * p.gr;
      finger2.position.x = 0.02 + 0.03 * p.gr;
    };
    applyPose(pose, 0);
    state.when('power_restored', () => {
      from = { ...pose };
      wakeT = 2.0;
    });
    mctx.interactions.add(turret, {
      id: 'robotics.arm',
      prompt: () => (demoIdx >= 0 ? 'RK-2 çalışıyor…' : 'Robot kolu çalıştır (demo)'),
      enabled: () => demoIdx < 0,
      distance: 3.0,
      onInteract: () => {
        if (!state.is('power_restored')) {
          audio.play('error');
          ui.toast('RK-2 enerjisiz — kol gevşek duruyor.');
          return;
        }
        demoIdx = 0;
        demoT = 0;
        from = { ...pose };
        audio.play('servo', { position: mctx.toWorld(AX, 1.0, AZ) });
        ui.toast('RK-2 kalibrasyon gösterisi başlatıldı.');
      },
    });

    // ------------------------------------------------------------------
    // 3B yazıcı (dış köşe +X)
    // ------------------------------------------------------------------
    const PX = 4.62;
    const PZ = -2.95;
    {
      addBox(g, { size: [1.0, 0.55, 0.9], pos: [PX, 0.275, PZ], material: M.panelMid, collide: true, name: '3b-yazıcı' });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) addBox(g, { size: [0.05, 1.05, 0.05], pos: [PX + sx * 0.475, 1.075, PZ + sz * 0.425], material: M.metalDark });
      addBox(g, { size: [1.0, 0.06, 0.9], pos: [PX, 1.6, PZ], material: M.metalDark });
      addBox(g, { size: [0.9, 1.0, 0.02], pos: [PX, 1.07, PZ - 0.42], material: M.panelDark });
      addBox(g, { size: [0.02, 1.0, 0.8], pos: [PX + 0.47, 1.07, PZ], material: M.panelDark });
      addBox(g, { size: [0.02, 1.0, 0.8], pos: [PX - 0.47, 1.07, PZ], material: M.glass });
      addBox(g, { size: [0.7, 0.03, 0.6], pos: [PX, 0.62, PZ], material: M.metal });
      addBox(g, { size: [0.94, 0.03, 0.03], pos: [PX, 1.35, PZ - 0.3], material: M.metal });
      addBox(g, { size: [0.94, 0.03, 0.03], pos: [PX, 1.35, PZ + 0.3], material: M.metal });
      addMesh(g, new THREE.TorusGeometry(0.13, 0.05, 6, 14), T.pipeWhite, { pos: [PX + 0.2, 1.78, PZ], rot: [0, Math.PI / 2, 0] });
      addBox(g, { size: [0.04, 0.16, 0.04], pos: [PX + 0.2, 1.68, PZ], material: M.metalDark });
      addLabel(g, '3B YAZICI — POLİMER / Tİ', { pos: [PX, 0.45, PZ + 0.452], height: 0.045, style: 'black' });
      addBox(g, { size: [0.22, 0.08, 0.01], pos: [PX + 0.3, 0.3, PZ + 0.452], material: M.screenGreen });
    }
    const pGlass = addBox(g, { size: [0.92, 1.0, 0.02], pos: [PX, 1.07, PZ + 0.43], material: M.glass, name: 'yazıcı-camı' });
    const gantry = new THREE.Group();
    gantry.position.set(PX, 0.635 + 0.35 * 0.64 + 0.17, PZ);
    addBox(gantry, { size: [0.04, 0.04, 0.62], material: M.metalDark });
    const head = new THREE.Group();
    addBox(head, { size: [0.09, 0.12, 0.09], pos: [0, -0.06, 0], material: M.accentOrange });
    addCylinder(head, { radiusTop: 0.012, radiusBottom: 0.003, height: 0.04, segments: 6, pos: [0, -0.14, 0], material: T.brass });
    finalizeDynamic(head);
    gantry.add(head);
    g.add(gantry);
    finalizeDynamic(gantry);
    const printObj = new THREE.Group();
    printObj.position.set(PX, 0.635, PZ);
    addCylinder(printObj, { radius: 0.09, height: 1, segments: 16, pos: [0, 0.5, 0], material: M.plasticWhite });
    addBox(printObj, { size: [0.26, 1, 0.05], pos: [0, 0.5, 0], material: M.plasticWhite });
    finalizeDynamic(printObj);
    g.add(printObj);
    let printPct = 0.64;
    const PRINT_H = 0.35;
    printObj.scale.y = PRINT_H * printPct;
    mctx.interactions.add(pGlass, {
      id: 'robotics.printer',
      prompt: 'Yazıcının durumuna bak',
      onInteract: () => {
        audio.play('beep');
        if (!state.is('power_restored')) ui.toast(`3B yazıcı duraklatılmış (enerji yok). Baskı: TARS eklem pimi (yedek) — %${Math.round(printPct * 100)}`, 4000);
        else ui.toast(`Baskı: TARS eklem pimi (yedek) — %${Math.round(printPct * 100)}. Tahmini bitiş: ${Math.max(1, Math.round((1 - printPct) * 300))} dk.`, 4000);
      },
    });

    // ------------------------------------------------------------------
    // PİRİ — şarj istasyonundaki yedek robot (iç duvar)
    // ------------------------------------------------------------------
    const RX = -2.7;
    const RZ = 3.08;
    addBox(g, { size: [1.05, 2.15, 0.13], pos: [RX, 1.1, 3.435], material: M.metalDark });
    addBox(g, { size: [1.05, 0.04, 0.75], pos: [RX, 0.02, 3.1], material: M.metalDark });
    addFloorHazard(g, { w: 1.05, d: 0.08, pos: [RX, 2.69] });
    for (const sx of [-1, 1]) {
      addBox(g, { size: [0.06, 0.08, 0.42], pos: [RX + sx * 0.46, 0.85, 3.22], material: M.metal });
      addBox(g, { size: [0.06, 0.08, 0.42], pos: [RX + sx * 0.46, 1.45, 3.22], material: M.metal });
    }
    addBox(g, { size: [0.36, 0.08, 0.03], pos: [RX, 2.0, 3.365], material: chargeMat });
    addLabel(g, 'ŞARJ İSTASYONU 2', { pos: [RX, 2.1, 3.367], rot: [0, Math.PI, 0], height: 0.045, style: 'white' });
    addLabel(g, 'PR-3 "PİRİ"', { pos: [RX, 1.88, 3.367], rot: [0, Math.PI, 0], height: 0.06, style: 'tag' });
    addCableBundle(g, [RX + 0.1, 1.3, 3.37], [RX + 0.05, 0.9, 3.28], { sag: 0.12, count: 2, radius: 0.015, spread: 0.035 });
    const piri = new THREE.Group();
    piri.name = 'PİRİ';
    piri.position.set(RX, 0.04, RZ);
    g.add(piri);
    const segs = [];
    for (let i = 0; i < 3; i++) {
      const seg = new THREE.Group();
      const x = (i - 1) * 0.255;
      seg.position.set(x, 0, 0);
      const h = i === 1 ? 1.52 : 1.42;
      addBox(seg, { size: [0.24, h, 0.4], pos: [0, h / 2 + 0.04, 0], material: T.bronzeRobot });
      addBox(seg, { size: [0.2, 0.04, 0.36], pos: [0, 0.02, 0], material: M.rubber });
      addBox(seg, { size: [0.245, 0.05, 0.405], pos: [0, h - 0.12, 0], material: M.accentOrange });
      addBox(seg, { size: [0.18, 0.012, 0.3], pos: [0, h * 0.42, -0.201], rot: [Math.PI / 2, 0, 0], material: M.metalDark });
      if (i === 1) {
        addBox(seg, { size: [0.06, 0.3, 0.012], pos: [0, 1.05, -0.204], material: chargeMat });
        addSphere(seg, { radius: 0.035, widthSegments: 10, heightSegments: 8, pos: [0, 1.33, -0.19], material: eyeMat });
        addCylinder(seg, { radius: 0.12, height: 0.4, segments: 12, pos: [0, h + 0.04, 0], rot: [Math.PI / 2, 0, 0], material: T.bronzeRobot, openEnded: false }).scale.set(1, 1, 0.4);
      }
      piri.add(seg);
      segs.push(seg);
    }
    for (const s of segs) {
      s.userData.dynamic = true;
    }
    for (const s of segs) mergeStatic(s);
    piri.userData.dynamic = true;
    piri.userData.collide = true;
    let twitchT = 0;
    mctx.interactions.add(piri, {
      id: 'robotics.piri',
      prompt: "PİRİ'yi incele",
      distance: 2.8,
      onInteract: () => {
        audio.play('terminal');
        let term = null;
        const info = [
          'Model ............ PR-3 "PİRİ" (yedek, üç segmentli)',
          'Durum ............ UYKU MODU — şarj %87',
          'Mizah ayarı ...... %40',
          'Dürüstlük ayarı .. %100',
          'Ketumluk ......... %95',
          'Görev ............ kargo ve robotik destek; TARS arızalanırsa devralır',
          '',
          'Bakım notu: "Sol segment menteşesi gıcırdıyor. Yağlandı, hâlâ',
          'gıcırdıyor. Sanırım gıcırdamayı seviyor."',
        ];
        term = ui.openTerminal({
          title: 'PİRİ — YEDEK LOJİSTİK ÜNİTESİ',
          color: '#ffb347',
          lines: info,
          options: [
            {
              label: 'Uyandırmayı dene',
              action: () => {
                twitchT = 1.2;
                audio.play('servo', { position: mctx.toWorld(RX, 1.0, RZ) });
                term?.setLines?.([
                  ...info.slice(0, 2),
                  '',
                  'PİRİ (uykulu, hoparlörden):',
                  '  "Beş dakika daha… ya da beş yıl. Görelilik bunu',
                  '   tartışmaya açık bırakıyor."',
                  '',
                  'SİSTEM: Birincil ünite (TARS) çevrimiçiyken yedek ünite uykuda kalır.',
                ]);
                return false;
              },
            },
            { label: 'Kapat', action: () => {} },
          ],
        });
      },
    });

    // ------------------------------------------------------------------
    // Alet duvarı + takım arabası
    // ------------------------------------------------------------------
    {
      const wx = 0.75;
      const wy = 1.86;
      const W = 2.7;
      const H = 1.24;
      addBox(g, { size: [W + 0.08, H + 0.08, 0.03], pos: [wx, wy, 3.405], material: M.metalDark });
      for (const dx of [-1.2, 1.2]) addBox(g, { size: [0.06, 0.06, 0.1], pos: [wx + dx, wy + 0.5, 3.45], material: M.metalDark });
      addMesh(g, tiledPlane(W, H, 0.25), T.pegboard, { pos: [wx, wy, 3.388], rot: [0, Math.PI, 0] });
      addLabel(g, 'ALET DUVARI — KULLANDIĞINI YERİNE KOY', { pos: [wx, wy + H / 2 - 0.08, 3.382], rot: [0, Math.PI, 0], height: 0.055, style: 'white' });
      const zT = 3.37;
      const zS = 3.386;
      const outline = (x, y, w, h) => addBox(g, { size: [w + 0.03, h + 0.03, 0.002], pos: [x, y, zS], material: M.plasticDark });
      // anahtarlar (büyükten küçüğe), sol yarı (oyuncunun solu = +X)
      for (let i = 0; i < 5; i++) {
        const L = 0.34 - i * 0.045;
        const x = wx + 1.15 - i * 0.12;
        const y = wy + 0.05;
        outline(x, y, 0.03, L);
        if (i === 1) continue; // eksik alet (ödünç)
        addBox(g, { size: [0.028, L, 0.01], pos: [x, y, zT], material: M.metal });
        addMesh(g, new THREE.TorusGeometry(0.03 - i * 0.003, 0.009, 4, 8), M.metal, { pos: [x, y + L / 2, zT] });
        addBox(g, { size: [0.05 - i * 0.004, 0.03, 0.01], pos: [x, y - L / 2, zT], material: M.metal });
      }
      addLabel(g, "TARS'ta", { pos: [wx + 1.03, wy - 0.17, 3.375], rot: [0, Math.PI, 0.2], height: 0.035, style: 'tag' });
      // tornavidalar
      const sdMats = [T.toolRed, M.fabricBlue, M.warning, T.toolRed, M.plasticDark];
      for (let i = 0; i < 5; i++) {
        const x = wx + 0.42 - i * 0.09;
        outline(x, wy + 0.05, 0.03, 0.27);
        addCylinder(g, { radius: 0.005, height: 0.15, segments: 6, pos: [x, wy - 0.03, zT], material: M.metal });
        addCylinder(g, { radius: 0.014, height: 0.11, segments: 6, pos: [x, wy + 0.1, zT], material: sdMats[i] });
      }
      // pense, çekiç, testere
      outline(wx - 0.25, wy + 0.05, 0.12, 0.26);
      addBox(g, { size: [0.025, 0.24, 0.01], pos: [wx - 0.28, wy + 0.05, zT], rot: [0, 0, 0.18], material: T.toolRed });
      addBox(g, { size: [0.025, 0.24, 0.01], pos: [wx - 0.22, wy + 0.05, zT], rot: [0, 0, -0.18], material: T.toolRed });
      outline(wx - 0.6, wy + 0.08, 0.16, 0.34);
      addBox(g, { size: [0.03, 0.32, 0.02], pos: [wx - 0.6, wy + 0.05, zT], material: M.plasticDark });
      addBox(g, { size: [0.16, 0.05, 0.03], pos: [wx - 0.6, wy + 0.22, zT], material: M.metal });
      outline(wx - 1.0, wy + 0.05, 0.4, 0.12);
      addBox(g, { size: [0.36, 0.08, 0.005], pos: [wx - 1.0, wy + 0.04, zT], material: M.metal });
      addBox(g, { size: [0.1, 0.09, 0.02], pos: [wx - 0.78, wy + 0.06, zT], material: M.plasticDark });
      // alt sıra: kablo makaraları, multimetre
      for (let i = 0; i < 3; i++) addMesh(g, new THREE.TorusGeometry(0.08, 0.025, 6, 12), [T.toolRed, M.cable, M.warning][i], { pos: [wx + 0.9 - i * 0.24, wy - 0.38, 3.36] });
      addBox(g, { size: [0.12, 0.2, 0.04], pos: [wx - 0.3, wy - 0.36, 3.36], material: M.warning });
      addBox(g, { size: [0.08, 0.06, 0.005], pos: [wx - 0.3, wy - 0.31, 3.338], material: M.screenGreen });
      addLabel(g, 'ZORUNLU: ANTİSTATİK BİLEKLİK', { pos: [wx, wy - H / 2 + 0.07, 3.382], rot: [0, Math.PI, 0], height: 0.04, style: 'warn' });
      // takım arabası
      const cx = wx + 0.1;
      const cz = 3.15;
      addBox(g, { size: [0.95, 0.85, 0.52], pos: [cx, 0.53, cz], material: T.toolRed, collide: true, name: 'takım-arabası' });
      for (let i = 0; i < 4; i++) {
        addBox(g, { size: [0.88, 0.15, 0.01], pos: [cx, 0.3 + i * 0.18, cz - 0.262], material: T.toolRed });
        addBox(g, { size: [0.3, 0.02, 0.025], pos: [cx, 0.36 + i * 0.18, cz - 0.27], material: M.metal });
      }
      addBox(g, { size: [0.97, 0.03, 0.54], pos: [cx, 0.97, cz], material: M.rubber });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) addCylinder(g, { radius: 0.045, height: 0.04, segments: 8, pos: [cx + sx * 0.4, 0.05, cz + sz * 0.2], rot: [Math.PI / 2, 0, 0], material: M.rubber });
      addBox(g, { size: [0.3, 0.1, 0.18], pos: [cx - 0.2, 1.04, cz], material: T.pipeGreen });
      addCylinder(g, { radius: 0.04, height: 0.1, segments: 10, pos: [cx + 0.25, 1.04, cz - 0.05], material: M.plasticWhite });
    }

    // Parça rafı + yaslanmış yedek segmentler (+X iç)
    {
      const sx = 3.85;
      const ys = addOpenRack(g, M, { x: sx, z: 3.24, w: 1.5, h: 2.0, d: 0.45, shelves: 4, side: -1 });
      const bins = ['SERVO', 'YATAK', 'KABLO', 'SENSÖR', 'VİDA M4', 'MENTEŞE', 'PİL', 'DİĞER'];
      ys.forEach((y, r) => {
        for (let c = 0; c < 2; c++) {
          const x = sx - 0.36 + c * 0.72;
          const bh = r === 3 ? 0.14 : 0.2;
          addBox(g, { size: [0.6, bh, 0.36], pos: [x, y + bh / 2, 3.22], material: [M.fabricBlue, M.accentOrange, M.plasticDark, M.warning][(r + c) % 4] });
          addLabel(g, bins[r * 2 + c], { pos: [x, y + bh / 2, 3.038], rot: [0, Math.PI, 0], height: 0.04, style: 'tag' });
        }
      });
      for (let i = 0; i < 2; i++) {
        const slab = addBox(g, { size: [0.24, 1.4, 0.4], pos: [2.55 + i * 0.27, 0.72, 3.25], material: i ? M.aluminium : T.bronzeRobot, collide: true });
        slab.rotation.x = 0.1;
        slab.rotation.z = -0.05 + i * 0.08;
      }
      addLabel(g, 'HURDA DEĞİL — YEDEK', { pos: [2.68, 1.5, 3.04], rot: [0.1, Math.PI, 0], height: 0.04, style: 'orange' });
    }
    addShelf(g, M, { x: -4.6, y: 1.9, z: 3.35, w: 1.2, d: 0.3, side: -1 });
    for (let i = 0; i < 3; i++) addBox(g, { size: [0.3, 0.25, 0.25], pos: [-5.0 + i * 0.38, 2.04, 3.35], material: i === 1 ? M.plasticWhite : T.crateGray });
    addVent(g, M, { pos: [-0.9, 2.65, 3.49], rot: [0, Math.PI, 0], w: 0.6, h: 0.3 });
    addCableBundle(g, [-1.5, 3.1, -3.4], [-0.6, 2.2, -3.42], { sag: 0.3, count: 2 });

    applyMetricUVs(g, M);

    // ------------------------------------------------------------------
    // Güncelleme
    // ------------------------------------------------------------------
    let screenT = 0;
    let lastPowered = null;
    let breathe = 0;
    mctx.onUpdate((dt, t) => {
      const powered = state.is('power_restored');
      // kol pozu
      if (demoIdx >= 0) {
        const k = DEMO[demoIdx];
        demoT += dt;
        const a = ease(Math.min(1, demoT / k.d));
        for (const key of ['yaw', 'sh', 'el', 'wr', 'ro', 'gr']) pose[key] = from[key] + (k[key] - from[key]) * a;
        if (demoT >= k.d) {
          from = { ...pose };
          demoIdx++;
          demoT = 0;
          if (demoIdx >= DEMO.length) demoIdx = -1;
          else if (near()) audio.play('servo', { position: mctx.toWorld(AX, 1.0, AZ), volume: 0.7 });
        }
      } else if (wakeT > 0) {
        wakeT -= dt;
        const a = ease(1 - Math.max(0, wakeT) / 2.0);
        for (const key of ['yaw', 'sh', 'el', 'wr', 'ro', 'gr']) pose[key] = from[key] + (REST[key] - from[key]) * a;
      }
      if (!near()) return;
      applyPose(pose, t);
      // yazıcı
      if (powered) {
        head.position.z = Math.sin(t * 2.3) * 0.2;
        gantry.position.x = PX + Math.sin(t * 0.9) * 0.28;
        printPct = Math.min(0.999, printPct + dt * 0.0006);
        printObj.scale.y = PRINT_H * printPct;
        gantry.position.y = 0.635 + PRINT_H * printPct + 0.17;
      }
      // PİRİ: şarj nefesi, seğirme
      breathe += dt;
      chargeMat.emissiveIntensity = 0.6 + 0.6 * (0.5 + 0.5 * Math.sin(breathe * 1.3));
      eyeMat.emissiveIntensity = twitchT > 0 ? 1.5 : 0.12 + 0.05 * Math.sin(breathe * 0.7);
      if (twitchT > 0) {
        twitchT -= dt;
        const k = Math.max(0, twitchT);
        segs[0].rotation.y = Math.sin(k * 30) * 0.06 * k;
        segs[2].rotation.y = -Math.sin(k * 26) * 0.06 * k;
        segs[1].position.y = Math.abs(Math.sin(k * 12)) * 0.015 * k;
      }
      // ekran
      screenT -= dt;
      if (screenT > 0 && powered === lastPowered) return;
      screenT = 0.15;
      lastPowered = powered;
      const s = diag.screen;
      if (!powered) {
        drawNoPower(s);
        return;
      }
      screenOn(s);
      s.draw((c, w, h) => {
        c.font = 'bold 20px monospace';
        c.fillText('EKLEM TESTİ — TARS-Y SEG.3', 12, 10);
        c.font = '15px monospace';
        c.fillText(`SERVO-A  tork %${72 + Math.round(Math.sin(t) * 3)}   SERVO-B  tork %0 (ARIZA)`, 12, 40);
        c.strokeStyle = '#62ff9a';
        c.lineWidth = 2;
        for (let row = 0; row < 2; row++) {
          const y0 = 110 + row * 95;
          c.globalAlpha = 0.3;
          c.strokeRect(12, y0 - 40, w - 24, 80);
          c.globalAlpha = 1;
          c.beginPath();
          for (let i = 0; i <= 80; i++) {
            const x = 12 + ((w - 24) * i) / 80;
            const v = row === 0 ? Math.sin(i * 0.25 + t * 4) * 0.8 : (Math.random() - 0.5) * 0.08;
            if (i === 0) c.moveTo(x, y0 - v * 35);
            else c.lineTo(x, y0 - v * 35);
          }
          c.stroke();
        }
        if (Math.floor(t * 2) % 2) c.fillText('SERVO-B DEĞİŞTİRİLMELİ', 12, h - 26);
      });
    });
  },
};
