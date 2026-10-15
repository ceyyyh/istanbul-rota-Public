// Belirli etkileşimlere oyuncu gözünden (yerde, 1.65 m) en yakın yürünebilir noktadan erişilebiliyor mu?
import { chromium } from '@playwright/test';
const noLos = process.argv.includes('--no-los');
const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
page.setDefaultTimeout(300000);
await page.goto('http://127.0.0.1:5180/?autostart=1&nointro=1&quality=low' + (process.env.FLAGS ? '&flags=' + process.env.FLAGS : ''));
await page.waitForFunction(() => document.body.dataset.ready === '1');
const res = await page.evaluate(([ids, noLos]) => {
  const { ctx } = window.__game;
  const THREE = ctx.THREE;
  ctx.engine.renderEnabled = false;
  const sys = ctx.interactions;
  if (noLos) sys.collision = null;
  const out = {};
  for (const h of sys.handles.filter((x) => ids.some((i) => String(x.id).startsWith(i)))) {
    const c = new THREE.Box3().setFromObject(h.object).getCenter(new THREE.Vector3());
    const loc = ctx.layout.locate(c.x, c.z);
    let found = null;
    // Nesnenin çevresinde, çarpışmasız noktaları dene
    for (let r = 0.7; r <= 2.0 && !found; r += 0.1) for (let a = 0; a < 24 && !found; a++) {
      const ang = (a / 24) * Math.PI * 2;
      const p = { x: c.x + Math.cos(ang) * r, z: c.z + Math.sin(ang) * r };
      const q = { ...p };
      ctx.collision.resolve(q, 0.3, 0.3, 1.8);
      if (Math.hypot(q.x - p.x, q.z - p.z) > 1e-3) continue; // engel içinde
      const l = ctx.layout.locate(p.x, p.z);
      if (l.index !== loc.index || l.region !== 'module' || Math.abs(l.lz) > 3.2 || Math.abs(l.lx) > 5.3) continue;
      ctx.camera.position.set(p.x, 1.65, p.z);
      ctx.camera.lookAt(c);
      ctx.camera.updateMatrixWorld(true);
      sys.update();
      if (sys.current === h) found = `ok r=${r.toFixed(1)}`;
    }
    out[h.id] = found || 'ERİŞİLEMEZ';
  }
  return out;
}, [ids, noLos]);
console.log(JSON.stringify(res, null, 1));
await browser.close();
