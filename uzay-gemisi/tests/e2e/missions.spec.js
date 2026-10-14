// (f) Görev akışı: bayraklar belgedeki sırayla ve ters sırayla ayarlanınca mission_complete olmalı.
// (g) Giriş sinematiği: nointro olmadan ~15 sn içinde intro_done olmalı, hata olmamalı.
import { test, expect } from '@playwright/test';
import { openGame, expectNoErrors, installQa } from './helpers.js';

// docs/ARCHITECTURE.md §11 sırası (mission_complete hariç)
const FLAGS = ['intro_done', 'talked_tars', 'power_restored', 'messages_read', 'ring_spinning', 'blackhole_observed'];

/** Kaynak hâlâ taslak mı? (Ajan 5 yeniden yazana kadar görev testleri atlanır) */
async function missionsIsDraft(page) {
  return page.evaluate(async () => {
    try {
      // ?raw → ham kaynak (Vite dev sunucusu satır içi sourcemap ekler; uzunluğa güvenme)
      const src = await (await fetch('/src/gameplay/Missions.js?raw')).text();
      return /\(TASLAK\b/.test(src);
    } catch {
      return false;
    }
  });
}

/**
 * Bayrakları tek tek ayarlar; her birinden sonra simülasyon + gerçek zaman bekler
 * (Missions gerçek zamanlı zamanlayıcı / Promise kullanıyor olabilir). Modal açılırsa kapatır.
 */
async function applyFlags(page, flags) {
  const timeline = [];
  for (const f of flags) {
    const r = await page.evaluate((f) => {
      const g = window.__game;
      const { state } = g.ctx;
      state.set(f, true);
      g.simulate(1.5);
      let closed = 0;
      while (window.__qa.modalOpen() && closed < 5) {
        window.__qa.closeModals();
        closed++;
        g.simulate(0.5);
      }
      return { f, complete: state.is('mission_complete'), objective: document.querySelector('#ui-objective')?.textContent ?? null, closed };
    }, f);
    timeline.push(r);
    await page.waitForTimeout(300);
  }
  return timeline;
}

/** mission_complete olana kadar simülasyon + gerçek zaman (en fazla ~maxSec) */
async function waitComplete(page, maxSec = 40) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxSec * 1000) {
    const done = await page.evaluate(() => {
      const g = window.__game;
      g.simulate(1);
      if (window.__qa.modalOpen()) window.__qa.closeModals();
      return g.ctx.state.is('mission_complete');
    });
    if (done) return (Date.now() - t0) / 1000;
    await page.waitForTimeout(500);
  }
  return -1;
}

for (const [name, order] of [
  ['belgedeki sıra', FLAGS],
  ['ters sıra', [...FLAGS].reverse()],
]) {
  test(`görev akışı — ${name}: mission_complete olur`, async ({ page }) => {
    test.setTimeout(180_000);
    const log = await openGame(page, 'autostart=1&nointro=1&quality=low');
    await installQa(page);
    test.skip(await missionsIsDraft(page), 'Missions.js hâlâ taslak (Ajan 5)');
    const timeline = await applyFlags(page, order);
    const waited = await waitComplete(page, 45);
    const st = await page.evaluate(() => ({ flags: { ...window.__game.ctx.state.flags }, frozen: window.__game.ctx.player.frozen }));
    console.log(`[görev ${name}]`, JSON.stringify(timeline), `bekleme=${waited}s`, JSON.stringify(st));
    expect(st.flags.mission_complete, `mission_complete olmadı; bayraklar: ${JSON.stringify(st.flags)}`).toBe(true);
    // Sonuç bayrakları
    for (const f of FLAGS) expect(st.flags[f], `${f} kayboldu`).toBeTruthy();
    expectNoErrors(log, `görev ${name}`);
  });
}

test('görev akışı — mission_complete erken gelmemeli (son bayrak olmadan)', async ({ page }) => {
  test.setTimeout(120_000);
  const log = await openGame(page, 'autostart=1&nointro=1&quality=low');
  await installQa(page);
  test.skip(await missionsIsDraft(page), 'Missions.js hâlâ taslak (Ajan 5)');
  // blackhole_observed hariç hepsi
  await applyFlags(page, FLAGS.slice(0, -1));
  const complete = await page.evaluate(() => {
    window.__game.simulate(5);
    return window.__game.ctx.state.is('mission_complete');
  });
  expect(complete, 'blackhole_observed olmadan görev bitmemeli').toBe(false);
  expectNoErrors(log);
});

test('giriş sinematiği: hatasız oynar ve intro_done olur', async ({ page }) => {
  test.setTimeout(180_000);
  // Gerçek zamanlı döngü açık kalsın (sinematik gerçek zamanlayıcı kullanabilir), ama çizim kapalı.
  const log = await openGame(page, 'autostart=1&quality=low', { stopLoop: false, render: false });
  await installQa(page);
  const t0 = Date.now();
  const samples = [];
  let done = false;
  let introAt = null;
  // En az ~15 sn oyun zamanı simülasyon + gerçek zaman beklemesi; intro_done gelmezse 60 sn'ye kadar
  for (let i = 0; i < 160; i++) {
    const s = await page.evaluate(() => {
      const g = window.__game;
      g.simulate(0.5);
      const { state, player } = g.ctx;
      return { t: g.ctx.engine.time, intro: state.is('intro_done'), frozen: player.frozen, modal: window.__qa.modalOpen(), loc: player.location.id };
    });
    samples.push(s);
    if (s.intro && !done) {
      done = true;
      introAt = { game: +s.t.toFixed(1), real: +((Date.now() - t0) / 1000).toFixed(1) };
    }
    if (done && s.t >= 15) break;
    if (Date.now() - t0 > 60_000) break;
    await page.waitForTimeout(done ? 20 : 250);
  }
  console.log('[giriş] intro_done anı:', JSON.stringify(introAt), 'donma örnekleri:', samples.filter((s) => s.frozen).length, '/', samples.length);
  const secs = (Date.now() - t0) / 1000;
  const first = samples[0];
  const last = samples[samples.length - 1];
  console.log(`[giriş] intro_done=${done}, gerçek ${secs.toFixed(1)} sn, oyun zamanı ${last.t.toFixed(1)} sn; ilk: ${JSON.stringify(first)} son: ${JSON.stringify(last)}`);
  expect(done, 'intro_done hiç doğru olmadı').toBe(true);
  // Sinematik bittikten sonra oyuncu donuk kalmamalı (modal yoksa)
  const after = await page.evaluate(() => {
    const g = window.__game;
    g.simulate(2);
    return { frozen: g.ctx.player.frozen, modal: window.__qa.modalOpen(), inputEnabled: g.ctx.input.enabled };
  });
  if (!after.modal) expect(after.frozen, 'giriş sonrası oyuncu donuk kaldı').toBe(false);
  expectNoErrors(log, 'giriş');
});
