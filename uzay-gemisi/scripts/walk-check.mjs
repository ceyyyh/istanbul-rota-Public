#!/usr/bin/env node
/**
 * Hızlı kontrol: halkanın tamamı yürüyerek dolaşılabiliyor mu? (çizim yok, oyun döngüsü simulate() ile)
 *
 * Kullanım:
 *   node scripts/walk-check.mjs [URL] [--dir both|fwd|back] [--unpowered] [--timeout 20] [--quiet]
 *
 *   URL          varsayılan: http://127.0.0.1:5187/?autostart=1&nointro=1&flags=power_restored&quality=low
 *   --dir        fwd: i→i+1, back: i→i-1, both (varsayılan): ikisi de
 *   --unpowered  ek senaryo: enerjisizken kumanda modülü kilitli mi (cryo → -X kapıda durmalı),
 *                power_restored sonrası geçilebiliyor mu, kumanda dışındaki halka yürünebiliyor mu
 *   --timeout    ara nokta başına simülasyon saniyesi (varsayılan 20)
 *
 * Çıkış kodu: 0 tamam, 1 takılma / kilit hatası, 2 sayfa/konsol hatası, 3 açılış başarısız.
 */
import { chromium } from '@playwright/test';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const url = argv.find((a) => /^https?:\/\//.test(a)) || 'http://127.0.0.1:5187/?autostart=1&nointro=1&flags=power_restored&quality=low';
const dirOpt = String(opt('dir', 'both'));
const unpowered = !!opt('unpowered', false);
const wpTimeout = Number(opt('timeout', 20));
const quiet = !!opt('quiet', false);

const BENIGN = [/favicon/i, /GPU stall/i, /AudioContext/i, /\[vite\]/i];
const errors = [];
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

/** Sayfa içi yardımcılar: modal kapatma + bir noktaya yürüme */
const PAGE_HELPERS = `
(() => {
  const g = window.__game;
  const { ctx } = g;
  const modalOpen = () => { try { return !!ctx.ui?.isModalOpen?.(); } catch { return false; } };
  const closeModals = () => {
    for (let k = 0; k < 4 && modalOpen(); k++) {
      for (const key of ['_modal', 'modal', '_terminal', '_dialog']) { try { ctx.ui?.[key]?.close?.(); } catch {} }
      try { if (modalOpen() && ctx.ui?._closeEnding) ctx.ui._closeEnding(); } catch {}
      for (const [code, key] of [['KeyQ', 'q'], ['Escape', 'Escape']]) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true }));
      }
      g.simulate(0.1);
    }
    return !modalOpen();
  };
  window.__wc = {
    modalOpen, closeModals,
    walkTo(x, z, maxSec, tol = 0.5) {
      const { player } = ctx;
      const dt = 1 / 60;
      let blocked = null;
      g.hold('KeyW', true);
      try {
        for (let f = 0; f < Math.round(maxSec / dt); f++) {
          const dx = x - player.position.x, dz = z - player.position.z;
          if (Math.hypot(dx, dz) < tol) return { reached: true, s: f * dt, blocked };
          if (modalOpen()) { blocked = 'modal'; closeModals(); }
          if (player.frozen) blocked = 'frozen';
          player.yaw = Math.atan2(-dx, -dz);
          g.simulate(dt, dt);
        }
        return { reached: false, s: maxSec, blocked };
      } finally { g.hold('KeyW', false); }
    },
    where() {
      const l = ctx.player.location;
      return l.id + '/' + l.region + ' lx=' + l.lx.toFixed(2) + ' lz=' + l.lz.toFixed(2);
    },
  };
})();
`;

async function open(u) {
  const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
  if (typeof page.routeWebSocket === 'function') await page.routeWebSocket(/.*/, () => {}); // HMR yeniden yüklemesi olmasın
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error' || BENIGN.some((r) => r.test(m.text()))) return;
    errors.push(`[console.error] ${m.text().split('\n')[0]}`);
  });
  try {
    await page.goto(u, { timeout: 120000 });
    await page.waitForFunction(() => window.__game && document.body.dataset.ready === '1', null, { timeout: 120000 });
  } catch (err) {
    console.log(`AÇILIŞ BAŞARISIZ: ${err.message}`);
    errors.forEach((e) => console.log(e));
    await browser.close();
    process.exit(3);
  }
  await page.evaluate(() => {
    const e = window.__game.ctx.engine;
    e.renderer.setAnimationLoop(null); // gerçek zamanlı döngüyü durdur (belirlenimci)
    e.renderEnabled = false;
  });
  await page.evaluate(PAGE_HELPERS);
  return page;
}

async function ringTour(page, dir) {
  return page.evaluate(
    ({ dir, wpTimeout }) => {
      const g = window.__game;
      const { layout } = g.ctx;
      const path = dir > 0 ? layout.ringPath() : layout.ringPath().reverse();
      g.teleport('cryo', 0, 0, dir > 0 ? 0 : 180);
      const idx = path.findIndex((p) => p.index === 1 && p.kind === 'center');
      const log = [];
      for (let n = 1; n <= path.length; n++) {
        const wp = path[(idx + n) % path.length];
        const r = window.__wc.walkTo(wp.x, wp.z, wpTimeout);
        const tag = `${wp.index}:${layout.MODULE_IDS[wp.index]}:${wp.kind}`;
        log.push(`${tag}:${r.reached ? 'ok ' + r.s.toFixed(1) + 's' : 'TAKILDI @' + window.__wc.where()}${r.blocked ? ' (' + r.blocked + ')' : ''}`);
        if (!r.reached) break;
      }
      return log;
    },
    { dir, wpTimeout },
  );
}

let failed = false;
const dirs = dirOpt === 'fwd' ? [1] : dirOpt === 'back' ? [-1] : [1, -1];
const page = await open(url);
for (const d of dirs) {
  const t0 = Date.now();
  const log = await ringTour(page, d);
  const stuck = log.filter((l) => l.includes('TAKILDI'));
  const name = d > 0 ? 'İLERİ (i→i+1)' : 'GERİ (i→i-1)';
  console.log(`== Halka turu ${name}: ${log.length - stuck.length}/36 ara nokta (${Date.now() - t0} ms)`);
  if (!quiet || stuck.length) console.log(log.join('\n'));
  if (stuck.length || log.length < 36) failed = true;
}

if (unpowered) {
  const u = new URL(url);
  const flags = (u.searchParams.get('flags') || '').split(',').filter((f) => f && f !== 'power_restored');
  if (flags.length) u.searchParams.set('flags', flags.join(','));
  else u.searchParams.delete('flags');
  const p2 = await open(u.toString());
  const res = await p2.evaluate(() => {
    const g = window.__game;
    const { layout, state, player } = g.ctx;
    const out = { powered: state.is('power_restored') };
    g.teleport('cryo', 0, 0, 180);
    const inside = layout.localToWorld(0, 4.9, 0);
    const r1 = window.__wc.walkTo(inside.x, inside.z, 20);
    out.lockHeld = !r1.reached && !(player.location.id === 'command' && player.location.region === 'module');
    out.lockAt = window.__wc.where();
    g.setFlags('power_restored');
    g.simulate(0.5);
    const c = layout.localToWorld(0, 0, 0);
    const r2 = window.__wc.walkTo(c.x, c.z, 25);
    out.afterPower = r2.reached;
    out.afterAt = window.__wc.where();
    return out;
  });
  console.log(`== Enerjisiz kilit: başlangıçta enerji=${res.powered}; kapı tuttu=${res.lockHeld} (${res.lockAt}); enerji sonrası geçildi=${res.afterPower} (${res.afterAt})`);
  if (res.powered || !res.lockHeld || !res.afterPower) failed = true;

  const p3 = await open(u.toString());
  const log3 = await p3.evaluate(() => {
    const g = window.__game;
    const { layout } = g.ctx;
    const path = layout.ringPath();
    g.teleport('cryo', 0, 0, 0);
    const out = [];
    for (let i = path.findIndex((p) => p.index === 1 && p.kind === 'center') + 1; i < path.length; i++) {
      const wp = path[i];
      const r = window.__wc.walkTo(wp.x, wp.z, 20);
      out.push(`${layout.MODULE_IDS[wp.index]}:${wp.kind}:${r.reached ? 'ok' : 'TAKILDI @' + window.__wc.where()}`);
      if (!r.reached) break;
    }
    return out;
  });
  const stuck3 = log3.filter((l) => l.includes('TAKILDI'));
  console.log(`== Enerjisiz halka (cryo → observation): ${log3.length - stuck3.length}/${log3.length} ${stuck3.join(' ')}`);
  if (stuck3.length) failed = true;
}

if (errors.length) {
  console.log(`== ${errors.length} sayfa/konsol hatası:`);
  [...new Set(errors)].slice(0, 20).forEach((e) => console.log('  ' + e));
}
await browser.close();
process.exit(failed ? 1 : errors.length ? 2 : 0);
