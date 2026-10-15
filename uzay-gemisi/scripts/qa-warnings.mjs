#!/usr/bin/env node
/**
 * QA: açılış + 12 modüle ışınlanıp 1 kare çizim sırasında oluşan console.warn / console.error / sayfa hatalarını toplar.
 * Kullanım: node scripts/qa-warnings.mjs [URL]
 * Çıkış: 0 temiz, 2 uyarı/hata bulundu.
 */
import { chromium } from '@playwright/test';

const url = process.argv.find((a) => /^https?:\/\//.test(a)) || 'http://127.0.0.1:5187/?autostart=1&nointro=1&flags=power_restored&quality=low';
const BENIGN = [/favicon/i, /GPU stall due to ReadPixels/i, /GL Driver Message/i, /Automatic fallback to software WebGL/i, /AudioContext/i, /speechSynthesis/i, /\[vite\]/i];
const seen = new Map();
const add = (kind, text) => {
  const key = `${kind}: ${text.split('\n')[0].slice(0, 220)}`;
  seen.set(key, (seen.get(key) || 0) + 1);
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
if (typeof page.routeWebSocket === 'function') await page.routeWebSocket(/.*/, () => {});
page.on('pageerror', (e) => add('pageerror', e.message));
page.on('console', (m) => {
  const t = m.text();
  if (BENIGN.some((r) => r.test(t))) return;
  if (m.type() === 'error') add('console.error', t);
  else if (m.type() === 'warning') add('console.warn', t);
});
await page.goto(url, { timeout: 120000 });
await page.waitForFunction(() => window.__game && document.body.dataset.ready === '1', null, { timeout: 150000 });
await page.evaluate(() => {
  const e = window.__game.ctx.engine;
  e.renderer.setAnimationLoop(null);
  e.renderEnabled = false;
});

const ids = await page.evaluate(() => window.__game.ctx.layout.MODULE_IDS);
for (const id of ids) {
  await page.evaluate((id) => {
    const g = window.__game;
    g.teleport(id, -3, 0, 0);
    g.simulate(0.25);
    g.ctx.engine.step(1 / 60, true);
  }, id);
}
await page.evaluate(() => window.__game.simulate(5));
await browser.close();

console.log(`== qa-warnings: ${seen.size} farklı ileti (12 modül + 5 sn simülasyon)`);
for (const [k, n] of seen) console.log(`  x${n}  ${k}`);
process.exit(seen.size ? 2 : 0);
