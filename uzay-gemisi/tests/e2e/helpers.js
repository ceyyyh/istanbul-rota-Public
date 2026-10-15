/**
 * E2E test yardımcıları (Ajan 7 — Test & QA).
 *
 * İlkeler:
 *  - Testler docs/ARCHITECTURE.md'deki API'ye dayanır (window.__game, ctx.*), görsel/metin ayrıntısına değil.
 *  - SwiftShader yavaş olduğundan mantık testlerinde oyun döngüsü durdurulur ve
 *    __game.simulate() ile (çizimsiz) ilerletilir. Çizim gerekiyorsa engine.step(dt, true).
 *  - Vite HMR soketi taklit edilir: diğer ajanlar dosya kaydettikçe test sırasında sayfa yeniden yüklenmesin.
 */
import { expect } from '@playwright/test';

export const DEFAULT_QUERY = 'autostart=1&nointro=1&quality=low';

/** Hata sayılmayacak (tarayıcı/ortam kaynaklı) konsol iletileri */
export const BENIGN = [
  /favicon/i,
  /GPU stall due to ReadPixels/i,
  /GL Driver Message/i,
  /Automatic fallback to software WebGL/i,
  /AudioContext was not allowed to start/i,
  /The AudioContext was not allowed/i,
  /speechSynthesis/i,
  /\[vite\]/i,
];

/**
 * Sayfa hatalarını ve konsol iletilerini toplar.
 * @returns {{errors:string[], warnings:string[], logs:{type:string,text:string}[]}}
 */
export function trackConsole(page) {
  const out = { errors: [], warnings: [], logs: [] };
  page.on('pageerror', (e) => out.errors.push(`[pageerror] ${e.stack || e.message}`));
  page.on('crash', () => out.errors.push('[crash] sayfa çöktü'));
  page.on('console', (msg) => {
    const type = msg.type();
    const text = msg.text();
    out.logs.push({ type, text });
    if (BENIGN.some((r) => r.test(text))) return;
    if (type === 'error') out.errors.push(`[console.error] ${text}`);
    else if (type === 'warning') out.warnings.push(text);
  });
  return out;
}

/** Vite HMR WebSocket'ini taklit eder (sunucuya bağlanmaz → test sırasında tam yeniden yükleme olmaz). */
export async function blockHmr(page) {
  if (typeof page.routeWebSocket !== 'function') return;
  await page.routeWebSocket(/.*/, () => {
    /* bilerek boş: sunucuya bağlanma */
  });
}

/** console.error/warn çağrılarını sayfa içinde de kaydeder (etkileşim başına hata ilişkilendirmesi için). */
async function installPageLog(page) {
  await page.addInitScript(() => {
    window.__qaLog = [];
    const fmt = (a) => {
      if (a instanceof Error) return a.stack || a.message;
      if (typeof a === 'object' && a !== null) {
        try {
          return JSON.stringify(a).slice(0, 300);
        } catch {
          return String(a);
        }
      }
      return String(a);
    };
    for (const k of ['error', 'warn']) {
      const orig = console[k].bind(console);
      console[k] = (...args) => {
        try {
          window.__qaLog.push({ k, t: args.map(fmt).join(' ') });
        } catch {
          /* yoksay */
        }
        return orig(...args);
      };
    }
    window.addEventListener('error', (e) => window.__qaLog.push({ k: 'pageerror', t: String(e.error?.stack || e.message) }));
    window.addEventListener('unhandledrejection', (e) =>
      window.__qaLog.push({ k: 'unhandledrejection', t: String(e.reason?.stack || e.reason) }),
    );
  });
}

/**
 * Oyunu açar ve hazır olmasını bekler.
 * @param {import('@playwright/test').Page} page
 * @param {string} query  URL sorgusu (? olmadan)
 * @param {{ stopLoop?: boolean, render?: boolean }} opts
 *   stopLoop: gerçek zamanlı döngüyü durdur (varsayılan true) — mantık simulate() ile ilerler
 *   render:   stopLoop=false iken çizim açık kalsın mı (varsayılan false)
 */
export async function openGame(page, query = DEFAULT_QUERY, opts = {}) {
  const { stopLoop = true, render = false } = opts;
  const log = trackConsole(page);
  await blockHmr(page);
  await installPageLog(page);
  const t0 = Date.now();
  await page.goto('/?' + query, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 120_000 });
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 150_000 });
  await page.evaluate(() => window.__game.ready);
  log.bootMs = Date.now() - t0;
  await page.evaluate(
    ({ stopLoop, render }) => {
      const e = window.__game.ctx.engine;
      if (stopLoop) e.renderer.setAnimationLoop(null);
      e.renderEnabled = !!render && !stopLoop;
    },
    { stopLoop, render },
  );
  return log;
}

/** Hata listesi boş olmalı (mesajda tüm hatalar listelenir). */
export function expectNoErrors(log, label = '') {
  expect(log.errors, `${label} hatalar:\n${log.errors.join('\n')}`).toEqual([]);
}

/** Sayfa içi kayıt uzunluğu (etkileşim başına hata ilişkilendirmesi için) */
export async function pageLogMark(page) {
  return page.evaluate(() => window.__qaLog?.length ?? 0);
}

/** Açık modalları (terminal/diyalog) kapatmaya çalışır. Başarılıysa true. */
export async function closeModals(page) {
  return page.evaluate(() => (window.__qa ? window.__qa.closeModals() : true));
}

/**
 * Sayfa içinde tanımlanacak yardımcıları yükler (evaluate içinde kullanılabilsin diye).
 * window.__qa: { closeModals(), simulateUntil(fn, maxSec), ... }
 */
export async function installQa(page) {
  await page.evaluate(() => {
    const g = window.__game;
    const { ctx } = g;
    const qa = {
      modalOpen() {
        try {
          return !!ctx.ui?.isModalOpen?.();
        } catch {
          return false;
        }
      },
      /** Modalı kapatmaya çalışır: UI'nin bilinen tutamaçları, sonra klavye (Q / Escape / Backspace) */
      closeModals() {
        const ui = ctx.ui;
        for (let attempt = 0; attempt < 4 && qa.modalOpen(); attempt++) {
          for (const key of ['_modal', 'modal', '_terminal', 'terminal', '_dialog', 'dialog', 'current']) {
            const m = ui?.[key];
            if (m && typeof m.close === 'function') {
              try {
                m.close();
              } catch {
                /* yoksay */
              }
            }
          }
          if (typeof ui?.closeModal === 'function') {
            try {
              ui.closeModal();
            } catch {
              /* yoksay */
            }
          }
          // Bitiş ekranı (showEnding) de modal sayılır: devam düğmesi / iç kapatıcı
          if (qa.modalOpen()) {
            try {
              if (typeof ui?._closeEnding === 'function') ui._closeEnding();
            } catch {
              /* yoksay */
            }
            document.querySelectorAll('[data-cont]').forEach((b) => b.click());
          }
          if (!qa.modalOpen()) break;
          for (const [code, key] of [
            ['KeyQ', 'q'],
            ['Escape', 'Escape'],
            ['Backspace', 'Backspace'],
          ]) {
            for (const target of [window, document, document.body]) {
              target.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true }));
              target.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true, cancelable: true }));
            }
            if (!qa.modalOpen()) break;
          }
          g.simulate(0.1);
        }
        return !qa.modalOpen();
      },
      /** fn() doğru olana kadar (en fazla maxSec) simüle eder. Geçen simülasyon süresini döner, olmazsa -1. */
      simulateUntil(fn, maxSec = 10, dt = 1 / 60) {
        const n = Math.round(maxSec / dt);
        for (let i = 0; i < n; i++) {
          if (fn()) return i * dt;
          g.simulate(dt, dt);
        }
        return fn() ? maxSec : -1;
      },
    };
    window.__qa = qa;
  });
}

/**
 * Sayfa içinde: oyuncuyu (x,z) noktasına doğru yönlendirip W basılı yürütür.
 * Döner: { reached, seconds, blockedBy?: 'modal'|'frozen'|null, loc }
 * Not: evaluate içine kopyalanacak şekilde saf fonksiyon olarak yazıldı.
 */
export const walkToInPage = `
window.__qaWalkTo = function (x, z, maxSec = 20, tol = 0.5) {
  const g = window.__game;
  const { player, input, ui } = g.ctx;
  const dt = 1 / 60;
  const n = Math.round(maxSec / dt);
  let blocked = null;
  let modalClosed = 0;
  g.hold('KeyW', true);
  try {
    for (let f = 0; f < n; f++) {
      const dx = x - player.position.x;
      const dz = z - player.position.z;
      if (Math.hypot(dx, dz) < tol) return { reached: true, seconds: f * dt, blocked, modalClosed, loc: { ...player.location } };
      if (ui && typeof ui.isModalOpen === 'function' && ui.isModalOpen()) {
        blocked = 'modal';
        if (window.__qa && window.__qa.closeModals()) modalClosed++;
      }
      if (player.frozen) blocked = 'frozen';
      player.yaw = Math.atan2(-dx, -dz);
      g.simulate(dt, dt);
    }
    return { reached: false, seconds: maxSec, blocked, modalClosed, loc: { ...player.location }, pos: [player.position.x, player.position.z] };
  } finally {
    g.hold('KeyW', false);
  }
};
`;

export async function installWalk(page) {
  await page.evaluate(walkToInPage);
}

/** Basit metin tablosu */
export function table(rows, cols) {
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const line = (vals) => vals.map((v, i) => String(v ?? '').padEnd(widths[i])).join(' | ');
  return [line(cols), widths.map((w) => '-'.repeat(w)).join('-|-'), ...rows.map((r) => line(cols.map((c) => r[c])))].join('\n');
}
