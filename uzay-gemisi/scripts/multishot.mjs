// Tek tarayıcı oturumunda birden çok görünüm çeker.
// node scripts/multishot.mjs <base-url-params> <out-dir> "ad|teleport-js" ...
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const [, , params, outDir, ...views] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(300000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('[error]', m.text().slice(0, 200)));
await page.goto(`http://127.0.0.1:5180/?${params}`);
await page.waitForFunction(() => document.body.dataset.ready === '1');
for (const v of views) {
  const [name, js] = v.split('|');
  await page.evaluate(js);
  await page.evaluate(() => { const e = window.__game.ctx.engine; for (let i = 0; i < 4; i++) e.step(1 / 30, true); });
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log('ok', name);
}
await browser.close();
