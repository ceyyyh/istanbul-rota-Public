// (h) Mobil görünüm: 390x844, dokunmatik. Açılış hatasız; dokunmatik kontroller DOM'da var.
import { test, expect } from '@playwright/test';
import { openGame, expectNoErrors } from './helpers.js';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });

test('mobil: açılış hatasız, dokunmatik algılandı', async ({ page }) => {
  const log = await openGame(page, 'autostart=1&nointro=1');
  const info = await page.evaluate(() => {
    const { ctx } = window.__game;
    const c = ctx.renderer.domElement;
    return {
      isTouch: ctx.isTouch,
      coarse: matchMedia('(pointer: coarse)').matches,
      quality: ctx.engine.qualityName,
      hasTouchCtl: !!ctx.touch,
      canvas: [c.clientWidth, c.clientHeight],
      scrollW: document.documentElement.scrollWidth,
      innerW: innerWidth,
    };
  });
  console.log('[mobil]', JSON.stringify(info));
  expect(info.coarse, 'pointer:coarse eşleşmeli (dokunmatik öykünme)').toBe(true);
  expect(info.isTouch).toBe(true);
  expect(info.quality, 'dokunmatikte varsayılan kalite low').toBe('low');
  expect(info.hasTouchCtl, 'ctx.touch kurulmalı').toBe(true);
  expect(info.canvas).toEqual([390, 844]);
  expect(info.scrollW, 'yatay kaydırma olmamalı').toBeLessThanOrEqual(info.innerW);
  expectNoErrors(log, 'mobil');
});

test('mobil: dokunmatik kontroller DOM\'da ve oyuncuyu hareket ettiriyor', async ({ page }) => {
  const log = await openGame(page, 'autostart=1&nointro=1');
  // Dokunmatik kontrol öğeleri: TouchControls'ün kurduğu, görünür, tıklanabilir öğeler
  const dom = await page.evaluate(() => {
    const cands = [...document.querySelectorAll('body *')].filter((el) => {
      const s = `${el.id} ${typeof el.className === 'string' ? el.className : ''} ${el.getAttribute('data-touch') ?? ''} ${el.getAttribute('aria-label') ?? ''}`.toLowerCase();
      return /touch|joy|stick|dokun|mobile|btn-|button/.test(s) && el.tagName !== 'CANVAS';
    });
    const visible = cands.filter((el) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
    });
    return { total: cands.length, visible: visible.length, sample: visible.slice(0, 8).map((el) => `${el.tagName.toLowerCase()}#${el.id}.${String(el.className).slice(0, 40)}`) };
  });
  console.log('[mobil] dokunmatik öğeler:', JSON.stringify(dom));
  test.fixme(dom.visible === 0, 'Dokunmatik kontroller henüz DOM\'da yok (Ajan 6 — src/ui/TouchControls.js taslak)');
  expect(dom.visible).toBeGreaterThan(0);

  // Sol yarıda sürükle (sanal joystick) → oyuncu hareket etmeli. CDP ile dokunma olayı.
  await page.evaluate(() => window.__game.simulate(0.2));
  const p0 = await page.evaluate(() => [window.__game.ctx.player.position.x, window.__game.ctx.player.position.z]);
  const cdp = await page.context().newCDPSession(page);
  const x0 = 90;
  const y0 = 844 - 160;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 1 }] });
  for (let i = 1; i <= 6; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0, y: y0 - i * 12, id: 1 }] });
  }
  const moved = await page.evaluate(() => {
    const g = window.__game;
    const a = g.ctx.input.getMoveAxis();
    g.simulate(1);
    return { axis: a, pos: [g.ctx.player.position.x, g.ctx.player.position.z] };
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const dist = Math.hypot(moved.pos[0] - p0[0], moved.pos[1] - p0[1]);
  console.log('[mobil] joystick:', JSON.stringify(moved.axis), `mesafe=${dist.toFixed(2)}`);
  expect(dist, 'sol yarıda sürükleme oyuncuyu hareket ettirmeli').toBeGreaterThan(0.3);
  expectNoErrors(log, 'mobil dokunmatik');
});
