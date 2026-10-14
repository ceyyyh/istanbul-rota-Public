// Her etkileşimli nesneye yürüme şeridinden bakıp, görüş hattı denetimi (collision.lineBlocked)
// açıkken ve kapalıyken seçilebilirliğini karşılaştırır.
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
page.setDefaultTimeout(300000);
await page.goto('http://127.0.0.1:5180/?autostart=1&nointro=1&quality=low&flags=power_restored');
await page.waitForFunction(() => document.body.dataset.ready === '1');
const res = await page.evaluate(() => {
  const { ctx } = window.__game;
  const THREE = ctx.THREE;
  ctx.engine.renderEnabled = false;
  const sys = ctx.interactions;
  const cam = ctx.camera;
  const out = { ok: 0, blockedOnly: [], unreachable: [] };
  const box = new THREE.Box3();
  const center = new THREE.Vector3();
  for (const h of sys.handles) {
    if (!h.object.visible || !h.object.parent) continue;
    box.setFromObject(h.object);
    box.getCenter(center);
    const loc = ctx.layout.locate(center.x, center.z);
    // Şeritte, nesneye en yakın ve 1.0–2.0 m uzaktaki noktadan bak
    let best = null;
    for (const lz of [0, 0.6, -0.6, 1.2, -1.2]) for (let dx = -1.2; dx <= 1.2; dx += 0.4) {
      const p = ctx.layout.localToWorld(loc.index, loc.lx + dx, lz);
      const d = Math.hypot(p.x - center.x, p.z - center.z);
      if (d < 0.6 || d > 2.2) continue;
      if (!best || d < best.d) best = { ...p, d };
    }
    if (!best) { out.unreachable.push(h.id); continue; }
    const eye = new THREE.Vector3(best.x, 1.6, best.z);
    const test = (useLos) => {
      sys.collision = useLos ? ctx.collision : null;
      cam.position.copy(eye);
      cam.lookAt(center);
      cam.updateMatrixWorld(true);
      sys.update();
      return sys.current === h;
    };
    const without = test(false);
    const withLos = test(true);
    if (without && !withLos) out.blockedOnly.push(`${loc.id}:${h.id}`);
    else if (without) out.ok++;
    else out.unreachable.push(`${loc.id}:${h.id}`);
  }
  sys.collision = ctx.collision;
  return out;
});
console.log(JSON.stringify(res, null, 1));
await browser.close();
