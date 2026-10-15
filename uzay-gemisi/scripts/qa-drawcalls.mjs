// Bir görünümde kamera kesik konisindeki görünür meshleri üst gruplara göre sayar.
import { chromium } from '@playwright/test';
const [id = 'comms', lx = '-4', lz = '0', yaw = '0'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
page.setDefaultTimeout(300000);
await page.goto('http://127.0.0.1:5180/?autostart=1&nointro=1&quality=low&flags=power_restored');
await page.waitForFunction(() => document.body.dataset.ready === '1');
const res = await page.evaluate(([id, lx, lz, yaw]) => {
  const g = window.__game; const { ctx } = g; const THREE = ctx.THREE;
  g.teleport(id, +lx, +lz, +yaw); ctx.engine.step(1 / 60, true);
  const cam = ctx.camera; cam.updateMatrixWorld(true);
  const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const counts = {};
  ctx.scene.traverseVisible((o) => {
    if (!o.isMesh && !o.isPoints && !o.isLine) return;
    if (o.frustumCulled && !fr.intersectsObject(o)) return;
    let top = o; while (top.parent && top.parent !== ctx.scene) top = top.parent;
    const key = top.name || top.type;
    counts[key] = (counts[key] || 0) + 1;
  });
  const mod = ctx.ship.getModule(id).group;
  const sub = {};
  for (const c of mod.children) {
    let n = 0; c.traverse((o) => { if (o.isMesh) n++; });
    if (n > 3) sub[`${c.name || c.type}${c.userData.dynamic ? ' [dyn]' : ''}${c.userData.noMerge ? ' [noMerge]' : ''}`] = n;
  }
  return [...Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8), ['--- modül alt grupları ---', 0], ...Object.entries(sub).sort((a, b) => b[1] - a[1]).slice(0, 20)];
}, [id, lx, lz, yaw]);
console.log(res.map(([k, v]) => `${v}\t${k}`).join('\n'));
await browser.close();
