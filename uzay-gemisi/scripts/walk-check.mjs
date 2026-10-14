// Hızlı kontrol: halkanın tamamını yürüyerek dolaşılabiliyor mu? (render yok)
import { chromium } from '@playwright/test';
const url = process.argv[2] || 'http://127.0.0.1:5180/?autostart=1&nointro=1&flags=power_restored&quality=low';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('[error]', m.text()));
await page.goto(url);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
const res = await page.evaluate(() => {
  const g = window.__game;
  const { player, layout } = g.ctx;
  g.ctx.engine.renderEnabled = false;
  const path = layout.ringPath();
  const start = layout.spawnPoint('cryo');
  player.teleport(start.x, start.z, start.yaw);
  // cryo merkezinden başlayıp tüm halkayı dolaş
  let idx = path.findIndex((p) => p.index === 1 && p.kind === 'center');
  const log = [];
  g.hold('KeyW', true);
  for (let n = 0; n < path.length + 1; n++) {
    const wp = path[(idx + n) % path.length];
    let reached = false;
    for (let f = 0; f < 60 * 20; f++) {
      const dx = wp.x - player.position.x;
      const dz = wp.z - player.position.z;
      if (Math.hypot(dx, dz) < 0.5) { reached = true; break; }
      player.yaw = Math.atan2(-dx, -dz);
      g.simulate(1 / 60);
    }
    log.push(`${wp.index}:${wp.kind}:${reached ? 'ok' : 'TAKILDI @' + player.location.id + ' ' + player.location.lx.toFixed(2) + ',' + player.location.lz.toFixed(2)}`);
    if (!reached) break;
  }
  g.hold('KeyW', false);
  return log;
});
console.log(res.join('\n'));
await browser.close();
process.exit(res.some((l) => l.includes('TAKILDI')) ? 1 : 0);
