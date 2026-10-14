// Oyuncuyu bir modülde konumlandırıp baktığı etkileşimi yazdırır: node scripts/qa-look.mjs comms -1.8 -1.2 90 [pitchDeg]
import { chromium } from '@playwright/test';
const [id, lx, lz, yaw, pitch = '-15'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
page.setDefaultTimeout(300000);
await page.goto('http://127.0.0.1:5180/?autostart=1&nointro=1&quality=low' + (process.env.FLAGS ? '&flags=' + process.env.FLAGS : ''));
await page.waitForFunction(() => document.body.dataset.ready === '1');
const r = await page.evaluate(([id, lx, lz, yaw, pitch]) => {
  const g = window.__game; const { ctx } = g;
  ctx.engine.renderEnabled = false;
  g.teleport(id, +lx, +lz, +yaw);
  ctx.player.pitch = (+pitch * Math.PI) / 180;
  g.simulate(0.1);
  const rc = ctx.interactions.raycaster;
  const hits = rc.intersectObjects(ctx.interactions.objects, true).slice(0, 4).map((h) => {
    let o = h.object; while (o && !o.userData.interactable) o = o.parent;
    return `${o?.userData.interactable?.id}@${h.distance.toFixed(2)}`;
  });
  return { current: ctx.interactions.current?.id ?? null, hits };
}, [id, lx, lz, yaw, pitch]);
console.log(JSON.stringify(r));
await browser.close();
