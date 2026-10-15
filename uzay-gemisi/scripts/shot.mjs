#!/usr/bin/env node
/**
 * Oyunun ekran görüntüsünü alır (başsız Chromium + SwiftShader WebGL).
 *
 * Kullanım:
 *   node scripts/shot.mjs --url "http://127.0.0.1:5181/?autostart=1&nointro=1&tp=cryo" --out shots/cryo.png
 *   Seçenekler:
 *     --url      tam adres (zorunlu)
 *     --out      çıktı PNG yolu (varsayılan shots/shot.png)
 *     --wait     hazır olduktan sonra beklenecek ms (varsayılan 1500)
 *     --size     GxY (varsayılan 960x540)
 *     --eval     sayfada çalıştırılacak JS (ör. "__game.teleport('lab', 2, 0, 90)")
 *     --frames   ek bekleme yerine çizilecek kare sayısı
 *
 * Konsol hataları ve sayfa hataları stdout'a yazılır; hata varsa çıkış kodu 2.
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']);
    return acc;
  }, []),
);
if (!args.url) {
  console.error('--url gerekli');
  process.exit(1);
}
const out = args.out || 'shots/shot.png';
const [w, h] = (args.size || '960x540').split('x').map(Number);
fs.mkdirSync(path.dirname(out), { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: w, height: h } });
const errors = [];
page.on('console', (msg) => {
  const t = msg.type();
  if (t === 'error' || t === 'warning') {
    const line = `[${t}] ${msg.text()}`;
    if (t === 'error') errors.push(line);
    console.log(line);
  } else if (args.verbose) console.log(`[${t}] ${msg.text()}`);
});
page.on('pageerror', (err) => {
  errors.push(`[pageerror] ${err.message}`);
  console.log(`[pageerror] ${err.stack || err.message}`);
});

const t0 = Date.now();
page.setDefaultTimeout(240000);
await page.goto(args.url, { waitUntil: 'load', timeout: 240000 });
await page.waitForFunction(() => window.__game && document.body.dataset.ready === '1', null, { timeout: 240000 });
if (args.eval) {
  await page.evaluate(args.eval);
}
await page.waitForTimeout(Number(args.wait || 1500));
await page.screenshot({ path: out, timeout: 240000 });
const info = await page.evaluate(() => {
  const g = window.__game;
  const r = g.ctx.renderer.info;
  return { fps: g.ctx.engine.fps.toFixed(1), calls: r.render.calls, triangles: r.render.triangles, loc: g.ctx.player.location };
});
console.log(`OK ${out} (${Date.now() - t0} ms)`, JSON.stringify(info));
await browser.close();
process.exit(errors.length ? 2 : 0);
