import { chromium } from '@playwright/test';
const base = process.argv[2] || 'http://127.0.0.1:5180/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.setDefaultTimeout(240000);
await page.goto(base + '?autostart=1&nointro=1&quality=low&debug=1');
await page.waitForFunction(() => document.body.dataset.ready === '1');
const info = await page.evaluate(async () => {
  const g = window.__game;
  const out = { modules: g.ctx.ship.modules.map((m) => `${m.id}:${m.ms.toFixed(0)}ms/${m.stats.merged}m/${m.stats.sources}s`), corridors: g.ctx.ship.corridors.length, interactables: g.ctx.interactions.handles.length, doors: g.ctx.doors.length, colliders: g.ctx.collision.count };
  out.views = [];
  for (const m of g.ctx.ship.modules) {
    g.teleport(m.id, -4, 0, 0);
    g.ctx.engine.step(1 / 60, true);
    const r = g.ctx.renderer.info.render;
    out.views.push(`${m.id}: ${r.calls} calls, ${(r.triangles / 1000).toFixed(0)}k tri`);
  }
  return out;
});
console.log(JSON.stringify(info, null, 1));
console.log('--- konsol ---');
console.log([...new Set(logs)].join('\n') || '(temiz)');
await browser.close();
