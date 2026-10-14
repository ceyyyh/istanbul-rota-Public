import * as THREE from 'three';
import { buildShell } from '../structure/shell.js';
import { addBox, addCylinder, addMesh, addSphere } from '../utils.js';
import { getTechMaterials, rng } from './tech/materials.js';
import { addLabel } from './tech/labels.js';
import { addPipe, addRod, addCollar, addScreen, drawNoPower, screenOn, nearChecker, addHitBox, makeHandwheel, addShelf, applyMetricUVs } from './tech/kit.js';
import { buildCornField } from './tech/corn.js';

/**
 * Hidroponik Bahçe (modül 5) — mısır!
 *
 * İki uzun hidroponik oluk (dış ve iç duvar boyunca), her birinde iki sıra mısır (InstancedMesh),
 * üstte mor/pembe LED büyüme ışıkları. -X ucunda su ve besin tankları + sulama kontrol kürsüsü,
 * +X ucunda tohum bankası ve fide tezgâhı (küf/blight numunesi kavanozu).
 */

const TROUGH_X0 = -3.6;
const TROUGH_X1 = 3.6;
const TROUGH_Z = 2.45; // oluk merkezi |z|
const TROUGH_TOP = 0.6;

export default {
  id: 'hydro',
  name: 'Hidroponik Bahçe',
  build(mctx) {
    const M = mctx.materials;
    const T = getTechMaterials();
    const g = mctx.group;
    const { state, audio, ui } = mctx;
    const near = nearChecker(mctx, 12);

    buildShell(mctx, {
      wall: 'light',
      floor: 'grate',
      accent: 0xff40d0,
      outerWindows: [{ x: 0, w: 1.4, y: 1.4, h: 0.8 }],
      lights: 2,
      lightIntensity: 5,
      lightColor: 0xfff4ea,
    });

    // Büyüme ışıkları (modüle özel malzeme, güç moduna bağlı)
    const growMat = T.growLED.clone();
    growMat.name = 'hydro.growLED';
    mctx.addEmissive(growMat, { normal: { color: 0xff3fd0, intensity: 2.8 }, emergency: { color: 0x9a2080, intensity: 0.35 } });
    for (const sz of [-1, 1]) {
      mctx.addLight([0, 2.45, sz * TROUGH_Z], {
        color: 0xff4fd8,
        intensity: 6,
        distance: 7,
        emergency: { color: 0x902070, intensity: 0.9 },
      });
    }

    // ------------------------------------------------------------------
    // Oluklar + mısır
    // ------------------------------------------------------------------
    const cornPos = [];
    const rowsZ = [];
    const rr = rng(77);
    for (const sz of [-1, 1]) {
      const zc = sz * TROUGH_Z;
      const len = TROUGH_X1 - TROUGH_X0;
      const cx = (TROUGH_X0 + TROUGH_X1) / 2;
      // gövde, ayaklar, kapak
      addBox(g, { size: [len, 0.42, 1.36], pos: [cx, 0.36, zc], material: M.plasticWhite, collide: true, name: 'oluk' });
      addBox(g, { size: [len + 0.04, 0.04, 1.4], pos: [cx, TROUGH_TOP - 0.02, zc], material: M.plasticDark });
      addBox(g, { size: [len - 0.1, 0.02, 0.08], pos: [cx, TROUGH_TOP - 0.005, zc - sz * 0.62], material: T.water });
      for (let i = 0; i <= 4; i++) {
        const x = TROUGH_X0 + 0.15 + ((len - 0.3) * i) / 4;
        for (const k of [-1, 1]) addBox(g, { size: [0.06, 0.15, 0.06], pos: [x, 0.075, zc + k * 0.6], material: M.metalDark });
      }
      // etiketler (koridora bakan yüz)
      const face = zc - sz * 0.681;
      addLabel(g, sz < 0 ? 'SIRA A — MISIR (ZEA MAYS)' : 'SIRA B — MISIR (ZEA MAYS)', { pos: [cx - 1.6, 0.42, face], rot: [0, sz < 0 ? 0 : Math.PI, 0], height: 0.07, style: 'stencil' });
      addLabel(g, 'HASAT: 3. DÖNGÜ', { pos: [cx + 1.9, 0.42, face], rot: [0, sz < 0 ? 0 : Math.PI, 0], height: 0.06, style: 'tag' });
      addLabel(g, 'İÇME SUYU DEĞİLDİR', { pos: [cx + 0.2, 0.27, face], rot: [0, sz < 0 ? 0 : Math.PI, 0], height: 0.045, style: 'warn' });
      // iki sıra bitki + saksılar + damla hattı
      for (const k of [-1, 1]) {
        const z = zc + k * 0.33;
        rowsZ.push(z);
        addRod(g, [TROUGH_X0 + 0.05, TROUGH_TOP + 0.03, z + 0.08], [TROUGH_X1 - 0.05, TROUGH_TOP + 0.03, z + 0.08], { radius: 0.008, material: M.cable, segments: 5 });
        const n = 17;
        for (let i = 0; i < n; i++) {
          const x = TROUGH_X0 + 0.22 + ((len - 0.44) * i) / (n - 1) + (rr() - 0.5) * 0.06;
          const zz = z + (rr() - 0.5) * 0.06;
          addCylinder(g, { radius: 0.055, height: 0.04, segments: 6, openEnded: true, pos: [x, TROUGH_TOP + 0.01, zz], material: M.plasticDark });
          addCylinder(g, { radius: 0.05, height: 0.01, segments: 6, pos: [x, TROUGH_TOP + 0.022, zz], material: T.rockwool });
          // birkaç boş saksı (hasat edilmiş)
          if ((i * 7 + (k + 1) * 3 + (sz + 1)) % 13 === 5) continue;
          cornPos.push({ x, z: zz, y: TROUGH_TOP + 0.02, s: 0.86 + rr() * 0.2 });
        }
      }
      // LED çubukları + askılar
      for (const k of [-1, 0, 1]) {
        const z = zc + k * 0.36;
        addBox(g, { size: [len + 0.1, 0.05, 0.1], pos: [cx, 2.84, z], material: M.metalDark });
        addBox(g, { size: [len, 0.012, 0.06], pos: [cx, 2.81, z], material: growMat });
      }
      for (let i = 0; i < 4; i++) {
        const x = TROUGH_X0 + 0.3 + (i * (len - 0.6)) / 3;
        addRod(g, [x, 2.86, zc - 0.4], [x, 2.86, zc + 0.4], { radius: 0.015, material: M.metal, segments: 6 });
        addRod(g, [x, 2.86, zc], [x, 3.2, zc], { radius: 0.01, material: M.metal, segments: 6 });
      }
    }
    const field = buildCornField({ leaf: T.leaf, cob: T.cob, husk: T.husk }, cornPos, { seed: 11, height: 1.7 });
    g.add(field);

    // ------------------------------------------------------------------
    // -X ucu: su + besin tankları
    // ------------------------------------------------------------------
    const tanks = [];
    for (const sz of [-1, 1]) {
      const tx = -4.75;
      const tz = sz * 2.65;
      addCylinder(g, { radius: 0.5, height: 2.2, segments: 20, pos: [tx, 1.1, tz], material: M.hullWhite, collide: true, name: 'tank' });
      addMesh(g, new THREE.SphereGeometry(0.5, 20, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.hullWhite, { pos: [tx, 2.2, tz] });
      for (const y of [0.3, 1.1, 1.9]) addCylinder(g, { radius: 0.515, height: 0.05, segments: 20, pos: [tx, y, tz], material: sz < 0 ? T.pipeBlue : T.pipeGreen });
      addCylinder(g, { radius: 0.53, height: 0.08, segments: 20, pos: [tx, 0.04, tz], material: M.metalDark });
      // gözetleme borusu (koridora bakan tarafta)
      const sgx = tx + 0.3;
      const sgz = tz - sz * 0.42;
      addCylinder(g, { radius: 0.03, height: 1.7, segments: 8, openEnded: true, pos: [sgx, 1.1, sgz], material: M.glass });
      for (const y of [0.25, 1.95]) addCylinder(g, { radius: 0.04, height: 0.04, segments: 8, pos: [sgx, y, sgz], material: M.metal });
      const level = addCylinder(g, { radius: 0.022, height: 1, segments: 8, pos: [sgx, 0.27, sgz], material: sz < 0 ? T.water : T.pipeGreen, dynamic: true, name: 'su-seviyesi' });
      level.geometry.translate(0, 0.5, 0);
      const frac = sz < 0 ? 0.64 : 0.41;
      level.scale.y = 1.66 * frac;
      tanks.push({ level, frac, target: frac });
      const ang = Math.atan2(sgx - tx, sgz - tz);
      addLabel(g, sz < 0 ? 'T1 — SU' : 'T2 — BESİN', { pos: [tx + Math.sin(ang - 0.6) * 0.545, 1.5, tz + Math.cos(ang - 0.6) * 0.545], rot: [0, ang - 0.6, 0], height: 0.08, style: 'stencil' });
      // tanktan oluğa boru + vana
      addPipe(g, [[tx + 0.45, 0.35, tz - sz * 0.2], [TROUGH_X0 + 0.02, 0.35, tz - sz * 0.2]], { radius: 0.04, material: sz < 0 ? T.pipeBlue : T.pipeGreen });
      const wheel = makeHandwheel(0.08, M.accentOrange);
      wheel.position.set(-3.95, 0.48, tz - sz * 0.2);
      wheel.rotation.x = -Math.PI / 2;
      g.add(wheel);
      addRod(g, [-3.95, 0.35, tz - sz * 0.2], [-3.95, 0.48, tz - sz * 0.2], { radius: 0.012, material: M.metal, segments: 6 });
    }
    // tanklar arası tavan borusu
    addPipe(g, [[-4.75, 2.32, -2.65], [-4.75, 2.98, -2.65], [-4.75, 2.98, 2.65], [-4.75, 2.32, 2.65]], { radius: 0.05, material: T.pipeBlue });
    addCollar(g, [-4.75, 2.98, 0], [0, 0, 1], { radius: 0.065 });

    // Sulama kontrol kürsüsü (dış taraf, tankın önünde)
    const px = -4.3;
    const pz = -1.5;
    addBox(g, { size: [0.5, 1.0, 0.4], pos: [px, 0.5, pz], material: M.panelMid, collide: true, name: 'sulama-kürsüsü' });
    const lectern = addBox(g, { size: [0.56, 0.05, 0.46], pos: [px, 1.03, pz + 0.02], material: M.metalDark });
    lectern.rotation.x = 0.4;
    addLabel(g, 'SULAMA KONTROL', { pos: [px, 0.82, pz + 0.205], height: 0.045, style: 'black' });
    const scr = addScreen(g, M, { size: [0.44, 0.28], pos: [px, 1.37, pz - 0.12], rot: [-0.3, 0, 0], res: [448, 288], color: '#d9a6ff', background: '#06020a' });
    addBox(g, { size: [0.06, 0.32, 0.06], pos: [px, 1.12, pz - 0.18], material: M.metalDark });
    const btn = new THREE.Group();
    btn.name = 'sulama-düğmesi';
    btn.position.set(px + 0.12, 1.032, pz + 0.12);
    btn.rotation.x = 0.4;
    addCylinder(btn, { radius: 0.05, height: 0.03, segments: 14, material: M.metalDark });
    const cap = addCylinder(btn, { radius: 0.038, height: 0.035, segments: 14, pos: [0, 0.02, 0], material: T.pipeBlue });
    g.add(btn);
    addLabel(g, 'SULA', { pos: [px - 0.08, 1.02, pz + 0.12], rot: [-Math.PI / 2 + 0.4, 0, 0], height: 0.04, style: 'white' });

    // Sis (su püskürtme) parçacıkları
    const mistN = 160;
    const mistPos = new Float32Array(mistN * 3);
    const mistVel = new Float32Array(mistN);
    const mistGeo = new THREE.BufferGeometry();
    mistGeo.setAttribute('position', new THREE.BufferAttribute(mistPos, 3));
    const mistMat = new THREE.PointsMaterial({ color: 0xcfe8ff, size: 0.03, transparent: true, opacity: 0.0, depthWrite: false });
    mistMat.name = 'hydro.mist';
    const mist = new THREE.Points(mistGeo, mistMat);
    mist.userData.dynamic = true;
    mist.frustumCulled = false;
    mist.visible = false;
    g.add(mist);
    let mistT = 0;
    const startMist = () => {
      const r = rng((Math.random() * 1e6) | 0);
      for (let i = 0; i < mistN; i++) {
        mistPos[i * 3] = TROUGH_X0 + r() * (TROUGH_X1 - TROUGH_X0);
        mistPos[i * 3 + 1] = TROUGH_TOP + 0.05 + r() * 0.5;
        mistPos[i * 3 + 2] = rowsZ[i % rowsZ.length] + (r() - 0.5) * 0.3;
        mistVel[i] = 0.05 + r() * 0.15;
      }
      mistGeo.attributes.position.needsUpdate = true;
      mistT = 4;
      mist.visible = true;
    };

    let watering = 0;
    let lastWatered = -999;
    mctx.interactions.add(btn, {
      id: 'hydro.water',
      prompt: 'Bitkileri sula',
      enabled: () => watering <= 0,
      onInteract: () => {
        const powered = state.is('power_restored');
        watering = 4;
        lastWatered = mctx.engine.time || 0;
        cap.position.y = 0.005;
        audio.play('click', { position: mctx.toWorld(px, 1.1, pz) });
        audio.play('hiss', { position: mctx.toWorld(0, 1, 0) });
        startMist();
        tanks[0].target = Math.max(0.2, tanks[0].target - 0.05);
        tanks[1].target = Math.max(0.15, tanks[1].target - 0.02);
        ui.toast(
          powered
            ? 'Sulama döngüsü başlatıldı — 42 litre besin çözeltisi, pH 6.1. Mısırlar mutlu.'
            : 'Pompa enerjisiz — yerçekimi beslemesiyle yavaş sulama yapıldı.',
          4000,
        );
      },
    });

    // ------------------------------------------------------------------
    // +X ucu: tohum bankası (dış köşe) + fide tezgâhı ve küf numunesi (iç köşe)
    // ------------------------------------------------------------------
    {
      const bx = 4.85;
      const bz = -3.08;
      addBox(g, { size: [0.9, 1.8, 0.66], pos: [bx, 0.9, bz], material: M.panelMid, collide: true, name: 'tohum-bankası' });
      const names = ['MISIR Z-1', 'MISIR Z-2', 'MISIR Z-3', 'SOYA', 'PATATES', 'FASULYE', 'BUĞDAY (SON)', 'BAMYA (BOŞ)'];
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 2; c++) {
          const x = bx - 0.21 + c * 0.42;
          const y = 0.35 + r * 0.36;
          addBox(g, { size: [0.38, 0.32, 0.02], pos: [x, y, bz + 0.335], material: M.plasticWhite });
          addBox(g, { size: [0.14, 0.02, 0.025], pos: [x, y + 0.1, bz + 0.35], material: M.metal });
          addLabel(g, names[r * 2 + c], { pos: [x, y - 0.03, bz + 0.3465], height: 0.032, style: 'tag' });
        }
      }
      addLabel(g, 'TOHUM BANKASI', { pos: [bx, 1.68, bz + 0.332], height: 0.07, style: 'white' });
      addBox(g, { size: [0.9, 0.04, 0.66], pos: [bx, 1.82, bz], material: M.metalDark });
    }
    // fide tezgâhı
    {
      const bx = 4.75;
      const bz = 3.12;
      addBox(g, { size: [1.15, 0.05, 0.62], pos: [bx, 0.9, bz], material: M.metal });
      addBox(g, { size: [1.1, 0.85, 0.58], pos: [bx, 0.43, bz + 0.01], material: M.panelMid, collide: true, name: 'fide-tezgâhı' });
      addBox(g, { size: [0.7, 0.06, 0.4], pos: [bx - 0.15, 0.955, bz], material: M.plasticDark });
      const seedlings = [];
      for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) seedlings.push({ x: bx - 0.42 + i * 0.12, z: bz - 0.12 + k * 0.12, y: 0.985, s: 0.16 + ((i + k) % 3) * 0.03 });
      const fs = buildCornField({ leaf: T.leaf, cob: T.cob, husk: T.husk }, seedlings, { seed: 4, height: 1.7 });
      fs.remove(fs.children[2]); // fidelerde koçan / püskül yok
      fs.remove(fs.children[1]);
      g.add(fs);
      addLabel(g, 'FİDE — 9. GÜN', { pos: [bx - 0.15, 0.94, bz - 0.205], rot: [0, Math.PI, 0], height: 0.03, style: 'tag' });
      // raf + kavanozlar
      addShelf(g, M, { x: bx, y: 1.55, z: 3.33, w: 1.1, d: 0.3, side: -1 });
      addCylinder(g, { radius: 0.06, height: 0.16, segments: 10, pos: [bx + 0.35, 1.645, 3.33], material: M.glassFrosted });
      addCylinder(g, { radius: 0.05, height: 0.1, segments: 10, pos: [bx + 0.35, 1.615, 3.33], material: T.rockwool });
      // KÜF NUMUNESİ kavanozu (etkileşimli)
      const jar = new THREE.Group();
      jar.name = 'küf-kavanozu';
      jar.position.set(bx - 0.15, 1.5625, 3.32);
      addCylinder(jar, { radius: 0.085, height: 0.24, segments: 14, pos: [0, 0.12, 0], material: M.glass });
      addCylinder(jar, { radius: 0.09, height: 0.035, segments: 14, pos: [0, 0.255, 0], material: T.toolRed });
      addCylinder(jar, { radius: 0.075, height: 0.04, segments: 12, pos: [0, 0.02, 0], material: T.mold });
      const blightCob = addCylinder(jar, { radiusTop: 0.022, radiusBottom: 0.03, height: 0.15, segments: 6, pos: [0, 0.1, 0], material: T.mold });
      blightCob.rotation.z = 0.5;
      addSphere(jar, { radius: 0.03, widthSegments: 6, heightSegments: 4, pos: [0.03, 0.06, 0.02], material: T.mold });
      g.add(jar);
      addLabel(g, 'B-7 KÜF', { pos: [bx - 0.15, 1.69, 3.232], rot: [0, Math.PI, 0], height: 0.032, style: 'red' });
      addLabel(g, 'NUMUNE B-7 — KÜF (BLIGHT)', { pos: [bx - 0.05, 1.95, 3.495], rot: [0, Math.PI, 0], height: 0.05, style: 'red' });
      addLabel(g, 'BİYOTEHLİKE — KAVANOZU AÇMAYIN', { pos: [bx - 0.05, 1.88, 3.495], rot: [0, Math.PI, 0], height: 0.04, style: 'warn' });
      mctx.interactions.add(jar, {
        id: 'hydro.blight',
        prompt: 'Küf (blight) numunesini incele',
        onInteract: () => {
          audio.play('terminal');
          ui.openTerminal({
            title: 'NUMUNE B-7 — KÜF (BLIGHT)',
            color: '#ff7a6a',
            lines: [
              'Kaynak: Dünya, tarım kuşağı — son ortak hasattan',
              'Etken: kökeni belirsiz bitki küfü ("blight")',
              '',
              'Etkilenen türler:',
              '  buğday ........ KAYIP',
              '  bamya ......... KAYIP',
              '  mısır ......... RİSK ALTINDA',
              '',
              'Gemideki mısırdan TAM İZOLASYON. Kavanoz mühürlü.',
              'Bu kavanozun neden gemide olduğunu soran olursa:',
              '"Düşmanını tanımadan tarla ekilmez."',
            ],
            options: [{ label: 'Kapat', action: () => {} }],
          });
        },
      });
    }
    // incelenebilir bir bitki (görünmez etkileşim kutusu, iç oluk, koridora yakın)
    {
      const hit = addHitBox(g, { size: [0.5, 1.6, 0.5], pos: [0.85, 1.4, 2.12], name: 'mısır-bitkisi' });
      mctx.interactions.add(hit, {
        id: 'hydro.corn',
        prompt: 'Mısırı incele',
        highlight: false,
        onInteract: () => {
          audio.play('click');
          const fresh = (mctx.engine.time || 0) - lastWatered < 60;
          ui.toast(
            fresh
              ? 'Yapraklar ıslak ve dik. Koçanlar dolgun — 3. hasat yakında. Küf belirtisi yok.'
              : 'Mısır — 3. hasat döngüsü. Koçanlar dolgun, küf belirtisi yok. Toprak biraz kuru görünüyor.',
            4500,
          );
        },
      });
    }

    // duvar detayları: hortum makarası, korkuluklar, etiket
    addCylinder(g, { radius: 0.22, height: 0.12, segments: 16, pos: [-3.4, 1.62, -3.38], rot: [Math.PI / 2, 0, 0], material: T.pipeGreen });
    addMesh(g, new THREE.TorusGeometry(0.17, 0.025, 6, 16), M.rubber, { pos: [-3.4, 1.62, -3.31] });

    applyMetricUVs(g, M);

    // ------------------------------------------------------------------
    // Güncelleme
    // ------------------------------------------------------------------
    let screenT = 0;
    let lastPowered = null;
    mctx.onUpdate((dt, t) => {
      if (watering > 0) {
        watering -= dt;
        if (watering <= 3.6) cap.position.y = 0.02;
      }
      if (!near()) return;
      for (const tk of tanks) {
        tk.frac += (tk.target - tk.frac) * Math.min(1, dt * 0.6);
        tk.level.scale.y = 1.66 * tk.frac;
      }
      if (mistT > 0) {
        mistT -= dt;
        for (let i = 0; i < mistN; i++) {
          mistPos[i * 3 + 1] -= mistVel[i] * dt;
          mistPos[i * 3] += Math.sin(t * 2 + i) * 0.02 * dt;
        }
        mistGeo.attributes.position.needsUpdate = true;
        mistMat.opacity = Math.min(0.55, mistT * 0.4);
        if (mistT <= 0) mist.visible = false;
      }
      screenT -= dt;
      const powered = state.is('power_restored');
      if (screenT > 0 && powered === lastPowered) return;
      screenT = 0.5;
      lastPowered = powered;
      const s = scr.screen;
      if (!powered) {
        drawNoPower(s);
        return;
      }
      screenOn(s);
      const wet = watering > 0;
      s.draw((c, w) => {
        c.font = 'bold 22px monospace';
        c.fillText('HİDROPONİK KONTROL', 14, 10);
        c.font = '18px monospace';
        const lines = [
          `NEM ........ %${wet ? 86 : 78}`,
          'pH ......... 6.1',
          'EC ......... 1.8 mS/cm',
          `CO₂ ........ ${880 + Math.round(Math.sin(t * 0.3) * 20)} ppm`,
          'LED DÖNGÜSÜ  18 / 6 sa',
          `SU T1 ...... %${Math.round(tanks[0].frac * 100)}`,
          wet ? 'SULAMA ..... ETKİN' : 'SULAMA ..... BEKLEMEDE',
        ];
        lines.forEach((l, i) => c.fillText(l, 14, 44 + i * 30));
        c.fillRect(14, 262, Math.max(4, (w - 28) * tanks[0].frac), 8);
      });
    });
  },
};
